-- ============================================================
--  آپدیت ۱ — این فایل رو تو SQL Editor پروژه‌ی موجودت اجرا کن
--  (یه‌بار کافیه؛ روی چیزی که از قبل هست خرابی ایجاد نمی‌کنه)
-- ============================================================

-- ۱) وضعیت جدید «draft» برای هفته: بین «رأی‌گیری» و «انتشار نهایی»،
--    یه حالت میانی که مدیر برنامه‌ی خودکارتولیدشده رو مرور/ویرایش می‌کنه
--    (تا وقتی منتشر نشده، باریستاها نمی‌بیننش)
alter table weeks drop constraint if exists weeks_status_check;
alter table weeks add constraint weeks_status_check
  check (status in ('bidding','draft','published','locked'));

-- ۲) جلوگیری از انتخاب هم‌زمان «شیفت» و «آف» در یه روز + رعایت سقف ۲تایی
--    (این حالا سمت دیتابیسه، یعنی حتی اگه یه باگ تو فرانت‌اند باشه، دیتا خراب نمی‌شه)
create or replace function check_pick_limits() returns trigger
language plpgsql as $$
declare
  v_conflict_kind text;
  v_same_kind_count int;
begin
  select kind into v_conflict_kind from shift_picks
    where week_id = new.week_id and barista_id = new.barista_id and date = new.date
      and kind <> new.kind
    limit 1;

  if v_conflict_kind is not null then
    if new.kind = 'shift' then
      raise exception 'این روز رو قبلاً به‌عنوان آف انتخاب کردی؛ نمی‌تونی همون روز شیفت هم بزنی';
    else
      raise exception 'این روز رو قبلاً برای شیفت انتخاب کردی؛ نمی‌تونی همون روز رو آف هم بزنی';
    end if;
  end if;

  select count(*) into v_same_kind_count from shift_picks
    where week_id = new.week_id and barista_id = new.barista_id and kind = new.kind;

  if v_same_kind_count >= 2 then
    if new.kind = 'shift' then
      raise exception 'حداکثر ۲ شیفت می‌تونی انتخاب کنی';
    else
      raise exception 'حداکثر ۲ روز آف می‌تونی انتخاب کنی';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_check_pick_limits on shift_picks;
create trigger trg_check_pick_limits before insert on shift_picks
  for each row execute function check_pick_limits();

-- ============================================================
-- ۳) موتور تولید خودکار برنامه‌ی هفته
--    منطق: اول انتخاب‌های خودشون رو اعمال می‌کنه (اگه دو نفر یه اسلات رو
--    خواستن، اولین ثبت‌شده برنده‌ست)، بعد برای کسایی که آف انتخاب نکردن
--    خودش یه روز آف منصفانه بهشون می‌ده، بعد بقیه‌ی اسلات‌های خالی رو
--    با اولویت «کسی که کمتر شیفت داره» پر می‌کنه و تا حد امکان از
--    شیفتِ شب و صبحِ فردا برای یه نفر جلوگیری می‌کنه.
-- ============================================================
create or replace function generate_schedule(p_week_id uuid)
returns void
language plpgsql
security definer set search_path = public as $$
declare
  v_week record;
  v_pick record;
  v_slot record;
  v_barista record;
  v_off_date date;
  v_chosen uuid;
begin
  if not is_admin() then
    raise exception 'فقط مدیر اجازه‌ی تولید برنامه رو داره';
  end if;

  select * into v_week from weeks where id = p_week_id;
  if v_week is null then raise exception 'هفته پیدا نشد'; end if;

  create temp table t_days (d date, idx int) on commit drop;
  insert into t_days select (v_week.start_date + g)::date, g from generate_series(0,6) g;

  insert into shift_assignments (week_id, date, period)
  select p_week_id, t.d, per
  from t_days t cross join unnest(array['morning','middle','night']) as per
  on conflict (week_id, date, period) do nothing;

  create temp table t_off (barista_id uuid, off_date date) on commit drop;
  insert into t_off
    select barista_id, date from shift_picks
    where week_id = p_week_id and kind = 'day_off';

  -- به کسایی که هیچ آفی انتخاب نکردن، یه روز آف منصفانه بده
  for v_barista in select id from profiles where role = 'barista' loop
    if not exists (select 1 from t_off where barista_id = v_barista.id) then
      select t.d into v_off_date
      from t_days t
      where t.d not in (
        select date from shift_picks
        where week_id = p_week_id and barista_id = v_barista.id and kind = 'shift'
      )
      order by (select count(*) from t_off o where o.off_date = t.d) asc, random()
      limit 1;
      if v_off_date is not null then
        insert into t_off (barista_id, off_date) values (v_barista.id, v_off_date);
      end if;
    end if;
  end loop;

  create temp table t_count (barista_id uuid primary key, cnt int default 0) on commit drop;
  insert into t_count select id, 0 from profiles where role = 'barista';

  -- پاس اول: اعمال انتخاب‌های خودشون
  for v_pick in
    select sp.*, a.id as assignment_id, a.barista_id as current_barista
    from shift_picks sp
    join shift_assignments a
      on a.week_id = sp.week_id and a.date = sp.date and a.period = sp.period
    where sp.week_id = p_week_id and sp.kind = 'shift'
    order by sp.created_at
  loop
    if v_pick.current_barista is not null then continue; end if;
    if exists (select 1 from t_off where barista_id = v_pick.barista_id and off_date = v_pick.date) then
      continue;
    end if;
    update shift_assignments set barista_id = v_pick.barista_id, source = 'pick'
      where id = v_pick.assignment_id;
    update t_count set cnt = cnt + 1 where barista_id = v_pick.barista_id;
  end loop;

  update t_count tc set cnt = sub.c
  from (
    select barista_id, count(*) c from shift_assignments
    where week_id = p_week_id and barista_id is not null group by barista_id
  ) sub
  where tc.barista_id = sub.barista_id;

  -- پاس دوم: پر کردن بقیه‌ی اسلات‌های خالی، منصفانه و با کمترین آزار
  for v_slot in
    select * from shift_assignments
    where week_id = p_week_id and barista_id is null
    order by date, period
  loop
    select bc.barista_id into v_chosen
    from t_count bc
    where not exists (select 1 from t_off o where o.barista_id = bc.barista_id and o.off_date = v_slot.date)
      and not (
        v_slot.period = 'morning' and exists (
          select 1 from shift_assignments sa
          where sa.week_id = p_week_id and sa.date = v_slot.date - 1
            and sa.period = 'night' and sa.barista_id = bc.barista_id
        )
      )
    order by bc.cnt asc, random()
    limit 1;

    if v_chosen is null then
      -- اگه با رعایت «نه شب‌وصبح‌پشت‌سرهم» کسی پیدا نشد، این قانون رو نرم‌تر بگیر
      select bc.barista_id into v_chosen
      from t_count bc
      where not exists (select 1 from t_off o where o.barista_id = bc.barista_id and o.off_date = v_slot.date)
      order by bc.cnt asc, random()
      limit 1;
    end if;

    if v_chosen is not null then
      update shift_assignments set barista_id = v_chosen, source = 'auto' where id = v_slot.id;
      update t_count set cnt = cnt + 1 where barista_id = v_chosen;
    end if;

    v_chosen := null;
  end loop;
end;
$$;

-- بستن رأی‌گیری + تولید خودکار، هر دو با یه دکمه/فراخوانی
create or replace function finalize_bidding(p_week_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'فقط مدیر اجازه داره'; end if;
  update weeks set status = 'draft' where id = p_week_id;
  perform generate_schedule(p_week_id);
end;
$$;

-- پاک کردن پیشنهادهای خودکار قبل از تولید دوباره (دستی‌ها و انتخابی‌ها دست‌نخورده می‌مونن)
create or replace function clear_auto_assignments(p_week_id uuid) returns void
language sql security definer set search_path = public as $$
  update shift_assignments set barista_id = null, source = 'admin'
    where week_id = p_week_id and source = 'auto';
$$;

-- تا وضعیت هفته (bidding/draft/published) هم لحظه‌ای sync بشه
do $$
begin
  alter publication supabase_realtime add table weeks;
exception when others then
  raise notice 'skip: %', sqlerrm;
end $$;

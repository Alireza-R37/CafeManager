-- ============================================================
--  آپدیت ۳ — تولید خودکار برنامه: هیچ‌کس دو شیفت «پشت‌سرهم» نمی‌گیره
--  (صبح→میدل، میدل→شب، و شبِ امروز→صبحِ فردا؛ حتی بین دو هفته)
--  تو SQL Editor اجرا کن (یه‌بار کافیه، روی اطلاعات موجود اثری نداره)
-- ============================================================

-- شماره‌ی پشت‌سرهم هر شیفت؛ دو شیفتِ پشت‌سرهم یعنی اختلافشون دقیقاً ۱ باشه
create or replace function slot_index(p_date date, p_period text) returns int
language sql immutable as $$
  select (p_date - date '2000-01-01') * 3 +
    case p_period when 'morning' then 0 when 'middle' then 1 else 2 end
$$;

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
  v_idx int;
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

  -- به کسی که آف انتخاب نکرده، یه روز آف منصفانه بده
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

  -- پاس اول: انتخاب‌های خودِ باریستاها (اولین ثبت‌شده برنده‌ست)
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

  -- پاس دوم: پر کردن بقیه، منصفانه و بدون شیفتِ پشت‌سرهم
  for v_slot in
    select * from shift_assignments
    where week_id = p_week_id and barista_id is null
    order by slot_index(date, period)
  loop
    v_idx := slot_index(v_slot.date, v_slot.period);

    select bc.barista_id into v_chosen
    from t_count bc
    where not exists (select 1 from t_off o where o.barista_id = bc.barista_id and o.off_date = v_slot.date)
      and not exists (
        select 1 from shift_assignments sa
        where sa.barista_id = bc.barista_id
          and abs(slot_index(sa.date, sa.period) - v_idx) = 1
      )
    order by bc.cnt asc, random()
    limit 1;

    -- فقط اگه هیچ‌کس بدون شیفتِ پشت‌سرهم پیدا نشد، این قانون رو برای همین یه اسلات نرم‌تر می‌گیره
    if v_chosen is null then
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

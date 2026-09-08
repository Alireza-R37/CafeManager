-- ============================================================
--  Cafe Shift Manager — Supabase schema
--  اجرا: کل این فایل رو در Supabase Dashboard → SQL Editor بچسبون و Run بزن
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) profiles — یک ردیف به‌ازای هر کاربر Supabase Auth
--    (۴ باریستا + حداقل ۱ ادمین/مدیر کافه)
-- ------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'barista' check (role in ('admin','barista')),
  color text not null default '#C9A227',      -- رنگ اختصاصی روی تقویم
  telegram_chat_id text,                       -- برای ارسال نوتیف تلگرام
  phone text,                                   -- برای پیامک در آینده
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) weeks — هر هفته‌ی برنامه‌ریزی
-- ------------------------------------------------------------
create table weeks (
  id uuid primary key default gen_random_uuid(),
  start_date date not null unique,              -- شنبه‌ی شروع هفته
  status text not null default 'bidding' check (status in ('bidding','draft','published','locked')),
  bidding_deadline timestamptz,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3) shift_picks — انتخاب‌های اولیه‌ی هر باریستا (۲ شیفت + ۱-۲ آف)
-- ------------------------------------------------------------
create table shift_picks (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  barista_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  period text check (period in ('morning','middle','night')),  -- برای day_off می‌تونه null باشه
  kind text not null check (kind in ('shift','day_off')),
  created_at timestamptz not null default now(),
  unique (week_id, barista_id, date, period, kind)
);

-- جلوگیری از انتخاب هم‌زمان «شیفت» و «آف» در یه روز + رعایت سقف ۲تایی
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

create trigger trg_check_pick_limits before insert on shift_picks
  for each row execute function check_pick_limits();

-- ------------------------------------------------------------
-- 4) shift_assignments — تقویم نهایی: ۲۱ اسلات در هفته
-- ------------------------------------------------------------
create table shift_assignments (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  date date not null,
  period text not null check (period in ('morning','middle','night')),
  barista_id uuid references profiles(id),
  source text not null default 'admin' check (source in ('pick','admin','swap')),
  created_at timestamptz not null default now(),
  unique (week_id, date, period)
);

-- ------------------------------------------------------------
-- 5) swap_requests — درخواست جایگزینی شیفت
-- ------------------------------------------------------------
create table swap_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references shift_assignments(id) on delete cascade,
  requested_by uuid not null references profiles(id),
  note text,
  status text not null default 'open' check (status in ('open','accepted','cancelled')),
  accepted_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index one_open_swap_per_assignment
  on swap_requests(assignment_id) where (status = 'open');

-- ------------------------------------------------------------
-- 6) چک‌لیست باز/بست کافه
-- ------------------------------------------------------------
create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  type text not null unique check (type in ('open','close')),
  title text not null
);

create table checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  order_index int not null,
  label text not null
);

create table checklist_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id),
  run_date date not null,
  started_by uuid references profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (template_id, run_date)
);

create table checklist_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references checklist_runs(id) on delete cascade,
  item_id uuid not null references checklist_template_items(id),
  checked_at timestamptz,
  checked_by uuid references profiles(id),
  unique (run_id, item_id)
);

-- ============================================================
--  Row Level Security
-- ============================================================
alter table profiles enable row level security;
alter table weeks enable row level security;
alter table shift_picks enable row level security;
alter table shift_assignments enable row level security;
alter table swap_requests enable row level security;
alter table checklist_templates enable row level security;
alter table checklist_template_items enable row level security;
alter table checklist_runs enable row level security;
alter table checklist_run_items enable row level security;

-- تیم کوچیک و قابل‌اعتماده: همه‌ی کاربرانِ لاگین‌کرده همه‌چیز رو می‌بینن
create policy "read all - profiles" on profiles for select using (auth.role() = 'authenticated');
create policy "read all - weeks" on weeks for select using (auth.role() = 'authenticated');
create policy "read all - picks" on shift_picks for select using (auth.role() = 'authenticated');
create policy "read all - assignments" on shift_assignments for select using (auth.role() = 'authenticated');
create policy "read all - swaps" on swap_requests for select using (auth.role() = 'authenticated');
create policy "read all - tmpl" on checklist_templates for select using (auth.role() = 'authenticated');
create policy "read all - tmpl items" on checklist_template_items for select using (auth.role() = 'authenticated');
create policy "read all - runs" on checklist_runs for select using (auth.role() = 'authenticated');
create policy "read all - run items" on checklist_run_items for select using (auth.role() = 'authenticated');

-- helper: آیا کاربر جاری ادمینه؟
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- profiles: خود فرد فقط پروفایل خودش رو ادیت می‌کنه؛ ادمین همه رو
create policy "update own profile" on profiles for update
  using (id = auth.uid() or is_admin());
create policy "admin inserts profiles" on profiles for insert
  with check (is_admin() or id = auth.uid());

-- weeks: فقط ادمین می‌سازه/می‌بنده
create policy "admin manage weeks" on weeks for all
  using (is_admin()) with check (is_admin());

-- shift_picks: هر باریستا فقط پیک‌های خودش رو در هفته‌ی «در حال رأی‌گیری» می‌زنه/پاک می‌کنه
create policy "barista manage own picks" on shift_picks for insert
  with check (
    barista_id = auth.uid()
    and exists (select 1 from weeks w where w.id = week_id and w.status = 'bidding')
  );
create policy "barista delete own picks" on shift_picks for delete
  using (
    barista_id = auth.uid()
    and exists (select 1 from weeks w where w.id = week_id and w.status = 'bidding')
  );
create policy "admin manage all picks" on shift_picks for all
  using (is_admin()) with check (is_admin());

-- shift_assignments: نهایی‌سازی فقط با ادمین؛ جابه‌جایی از طریق تابع accept_swap انجام می‌شه
create policy "admin manage assignments" on shift_assignments for all
  using (is_admin()) with check (is_admin());

-- swap_requests: هرکس فقط برای شیفتِ خودش درخواست می‌ذاره، و خودش می‌تونه لغوش کنه
create policy "barista create own swap" on swap_requests for insert
  with check (
    requested_by = auth.uid()
    and exists (
      select 1 from shift_assignments a
      where a.id = assignment_id and a.barista_id = auth.uid()
    )
  );
create policy "barista cancel own swap" on swap_requests for update
  using (requested_by = auth.uid() and status = 'open')
  with check (status in ('cancelled'));
create policy "admin manage swaps" on swap_requests for all
  using (is_admin()) with check (is_admin());

-- checklist: ادمین قالب می‌سازه؛ run/run_items رو هر کاربر لاگین‌شده می‌تونه بسازه/آپدیت کنه
create policy "admin manage templates" on checklist_templates for all
  using (is_admin()) with check (is_admin());
create policy "admin manage template items" on checklist_template_items for all
  using (is_admin()) with check (is_admin());
create policy "auth create runs" on checklist_runs for insert
  with check (auth.role() = 'authenticated');
create policy "auth update runs" on checklist_runs for update
  using (auth.role() = 'authenticated');
create policy "auth create run items" on checklist_run_items for insert
  with check (auth.role() = 'authenticated');

-- ============================================================
--  RPC: تولید خودکار برنامه‌ی هفته (توضیح کامل در supabase/updates_1.sql)
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

create or replace function finalize_bidding(p_week_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'فقط مدیر اجازه داره'; end if;
  update weeks set status = 'draft' where id = p_week_id;
  perform generate_schedule(p_week_id);
end;
$$;

create or replace function clear_auto_assignments(p_week_id uuid) returns void
language sql security definer set search_path = public as $$
  update shift_assignments set barista_id = null, source = 'admin'
    where week_id = p_week_id and source = 'auto';
$$;

-- ============================================================
--  RPC: قبول‌کردن جایگزینی شیفت (اتمیک، امن)
-- ============================================================
create or replace function accept_swap(p_request_id uuid)
returns void
language plpgsql
security definer set search_path = public as $$
declare
  v_assignment_id uuid;
  v_requested_by uuid;
begin
  select assignment_id, requested_by into v_assignment_id, v_requested_by
  from swap_requests where id = p_request_id and status = 'open'
  for update;

  if v_assignment_id is null then
    raise exception 'این درخواست دیگه معتبر نیست';
  end if;

  if v_requested_by = auth.uid() then
    raise exception 'نمی‌تونی درخواست خودت رو قبول کنی';
  end if;

  update swap_requests
    set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
    where id = p_request_id;

  update shift_assignments
    set barista_id = auth.uid(), source = 'swap'
    where id = v_assignment_id;
end;
$$;

-- ============================================================
--  RPC: تیک زدن آیتم چک‌لیست به‌ترتیب (نمی‌ذاره آیتم بعدی قبل از قبلی تیک بخوره)
-- ============================================================
create or replace function toggle_checklist_item(p_run_item_id uuid)
returns void
language plpgsql
security definer set search_path = public as $$
declare
  v_run_id uuid;
  v_order int;
  v_template_id uuid;
  v_checked timestamptz;
  v_prev_incomplete int;
begin
  select ri.run_id, ti.order_index, ti.template_id, ri.checked_at
    into v_run_id, v_order, v_template_id, v_checked
  from checklist_run_items ri
  join checklist_template_items ti on ti.id = ri.item_id
  where ri.id = p_run_item_id;

  if v_checked is not null then
    -- باز کردن تیک همیشه مجازه (برگشت به عقب)
    update checklist_run_items set checked_at = null, checked_by = null
      where id = p_run_item_id;
    update checklist_runs set completed_at = null where id = v_run_id;
    return;
  end if;

  select count(*) into v_prev_incomplete
  from checklist_run_items ri
  join checklist_template_items ti on ti.id = ri.item_id
  where ri.run_id = v_run_id and ti.order_index < v_order and ri.checked_at is null;

  if v_prev_incomplete > 0 then
    raise exception 'اول باید مرحله‌های قبلی رو تیک بزنی';
  end if;

  update checklist_run_items
    set checked_at = now(), checked_by = auth.uid()
    where id = p_run_item_id;

  -- اگه همه‌ی آیتم‌های این run تیک خوردن، run رو کامل علامت بزن
  if not exists (
    select 1 from checklist_run_items where run_id = v_run_id and checked_at is null
  ) then
    update checklist_runs set completed_at = now() where id = v_run_id;
  end if;
end;
$$;

-- ============================================================
--  داده‌ی اولیه‌ی چک‌لیست‌ها (نمونه — از داخل اپ هم قابل ویرایشه)
-- ============================================================
insert into checklist_templates (type, title) values
  ('open', 'چک‌لیست باز کردن کافه'),
  ('close', 'چک‌لیست بستن کافه');

insert into checklist_template_items (template_id, order_index, label)
select id, 1, 'روشن کردن چراغ‌ها و تهویه' from checklist_templates where type = 'open'
union all select id, 2, 'روشن کردن دستگاه اسپرسو و گرم شدن' from checklist_templates where type = 'open'
union all select id, 3, 'آسیاب تازه‌ی دان روز' from checklist_templates where type = 'open'
union all select id, 4, 'چک کردن موجودی شیر و سیروپ‌ها' from checklist_templates where type = 'open'
union all select id, 5, 'شست‌وشوی پیچرها و ابزار' from checklist_templates where type = 'open'
union all select id, 6, 'چیدمان ویترین و منو' from checklist_templates where type = 'open'
union all select id, 7, 'باز کردن صندوق و شمارش خرد' from checklist_templates where type = 'open';

insert into checklist_template_items (template_id, order_index, label)
select id, 1, 'بستن سفارش‌گیری و اطلاع به مشتری‌های حاضر' from checklist_templates where type = 'close'
union all select id, 2, 'خاموش کردن و تخلیه‌ی دستگاه اسپرسو' from checklist_templates where type = 'close'
union all select id, 3, 'شست‌وشوی کامل ابزار و سطل زباله‌ی قهوه' from checklist_templates where type = 'close'
union all select id, 4, 'نظافت میزها و ویترین' from checklist_templates where type = 'close'
union all select id, 5, 'گذاشتن شیر و مواد فاسدشدنی در یخچال' from checklist_templates where type = 'close'
union all select id, 6, 'شمارش صندوق و ثبت فروش روز' from checklist_templates where type = 'close'
union all select id, 7, 'خاموش کردن چراغ‌ها و قفل کردن درها' from checklist_templates where type = 'close';

-- ============================================================
--  team_directory — ویو محدود و عمومی برای صفحه‌ی ورود
--  (قبل از لاگین باید بشه اسم‌ها رو نشون داد و ایمیل داخلی‌شون رو
--   برای signInWithPassword فرستاد؛ فقط ستون‌های بی‌ضرر رو می‌ذاریم)
-- ============================================================
create view team_directory as
  select p.id, p.name, p.color, u.email
  from profiles p join auth.users u on u.id = p.id;

grant select on team_directory to anon, authenticated;

-- ============================================================
--  Realtime — برای sync لحظه‌ای بین دستگاه‌ها
-- ============================================================
alter publication supabase_realtime add table shift_assignments;
alter publication supabase_realtime add table swap_requests;
alter publication supabase_realtime add table checklist_run_items;
alter publication supabase_realtime add table checklist_runs;
alter publication supabase_realtime add table weeks;

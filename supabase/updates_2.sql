-- ============================================================
--  آپدیت ۲ — ثبت ساعت کاری + حذف امن کاربر
--  کل این فایل رو تو SQL Editor اجرا کن (یه‌بار کافیه)
-- ============================================================

-- ---------- بخش الف: ساعت کاری ----------
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  barista_id uuid not null references profiles(id) on delete cascade,
  clock_in timestamptz not null,
  clock_out timestamptz,
  edited_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (clock_out is null or clock_out >= clock_in)
);
create unique index if not exists one_open_entry_per_barista
  on time_entries(barista_id) where clock_out is null;
create index if not exists time_entries_barista_in on time_entries(barista_id, clock_in);

alter table time_entries enable row level security;

drop policy if exists "own or admin read hours" on time_entries;
create policy "own or admin read hours" on time_entries for select
  using (barista_id = auth.uid() or is_admin());

-- نوشتن مستقیم فقط برای مدیر؛ باریستا فقط از طریق دو تابع پایین ثبت می‌کنه
drop policy if exists "admin manage hours" on time_entries;
create policy "admin manage hours" on time_entries for all
  using (is_admin()) with check (is_admin());

-- زمان همیشه از ساعت «سرور» گرفته می‌شه (now())، نه از ساعت گوشی
create or replace function clock_in() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'barista') then
    raise exception 'فقط باریستاها می‌تونن ساعت ثبت کنن';
  end if;
  if exists (select 1 from time_entries where barista_id = auth.uid() and clock_out is null) then
    raise exception 'یه ساعت کاری باز داری؛ اول پایانش رو بزن';
  end if;
  insert into time_entries (barista_id, clock_in) values (auth.uid(), now());
end;
$$;

create or replace function clock_out() returns void
language plpgsql security definer set search_path = public as $$
begin
  update time_entries set clock_out = now()
    where barista_id = auth.uid() and clock_out is null;
  if not found then
    raise exception 'ساعت کاری بازی پیدا نشد';
  end if;
end;
$$;

create or replace function server_now() returns timestamptz
language sql stable as $$ select now() $$;

do $$
begin
  alter publication supabase_realtime add table time_entries;
exception when others then
  raise notice 'skip: %', sqlerrm;
end $$;

-- ---------- بخش ب: حذف امن کاربر ----------
-- با حذف یه باریستا، تاریخچه‌ی شیفت/چک‌لیست می‌مونه (فقط اسم صاحبش خالی می‌شه)
alter table shift_assignments drop constraint if exists shift_assignments_barista_id_fkey;
alter table shift_assignments add constraint shift_assignments_barista_id_fkey
  foreign key (barista_id) references profiles(id) on delete set null;

alter table swap_requests drop constraint if exists swap_requests_requested_by_fkey;
alter table swap_requests add constraint swap_requests_requested_by_fkey
  foreign key (requested_by) references profiles(id) on delete cascade;

alter table swap_requests drop constraint if exists swap_requests_accepted_by_fkey;
alter table swap_requests add constraint swap_requests_accepted_by_fkey
  foreign key (accepted_by) references profiles(id) on delete set null;

alter table checklist_runs drop constraint if exists checklist_runs_started_by_fkey;
alter table checklist_runs add constraint checklist_runs_started_by_fkey
  foreign key (started_by) references profiles(id) on delete set null;

alter table checklist_run_items drop constraint if exists checklist_run_items_checked_by_fkey;
alter table checklist_run_items add constraint checklist_run_items_checked_by_fkey
  foreign key (checked_by) references profiles(id) on delete set null;

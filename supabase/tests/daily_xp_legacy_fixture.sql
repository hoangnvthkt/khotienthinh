-- Disposable pre-migration fixture for daily_xp_repair_and_rpc_smoke.sql.
-- Run only against an isolated local database stopped at the migration before
-- repair_and_harden_daily_xp, then apply that migration and run the smoke file.

create table if not exists public.user_xp (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  total_xp integer default 0,
  level integer default 1,
  streak_days integer default 0,
  last_active_date date,
  badges jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  event_type text not null,
  xp_amount integer not null,
  description text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.xp_events
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists idempotency_key text;

alter table public.user_xp enable row level security;
alter table public.xp_events enable row level security;

drop policy if exists xp_fixture_permissive_all on public.user_xp;
create policy xp_fixture_permissive_all
on public.user_xp
for all
to public
using (true)
with check (true);

drop policy if exists xp_event_fixture_permissive_all on public.xp_events;
create policy xp_event_fixture_permissive_all
on public.xp_events
for all
to public
using (true)
with check (true);

grant all privileges on table public.user_xp, public.xp_events to anon, authenticated;
grant select (user_id), update (total_xp) on table public.user_xp to anon, authenticated;
grant select (user_id), update (xp_amount), references (event_type)
  on table public.xp_events to anon, authenticated;

create schema if not exists app_private;
grant usage on schema app_private to public, anon, authenticated;

create or replace function public.add_xp(p_user_id text, p_amount integer)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.xp_events(user_id, event_type, xp_amount)
  values (p_user_id, 'legacy_add_xp', p_amount);
end;
$function$;

create or replace function public.get_xp(p_user_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select to_jsonb(profile)
  from public.user_xp profile
  where profile.user_id = p_user_id
  limit 1;
$function$;

create or replace procedure app_private.record_xp(p_user_id text, p_amount integer)
language plpgsql
security definer
set search_path = ''
as $procedure$
begin
  insert into public.xp_events(user_id, event_type, xp_amount)
  values (p_user_id, 'legacy_record_xp', p_amount);
end;
$procedure$;

create or replace function public.award_my_daily_xp(
  p_legacy_event_type text,
  p_legacy_source_id uuid default null
)
returns text
language sql
security definer
set search_path = ''
as $function$
  select 'legacy-untrusted-wrapper'::text;
$function$;

grant execute on function public.add_xp(text, integer) to public, anon, authenticated;
grant execute on function public.get_xp(text) to public, anon, authenticated;
grant execute on procedure app_private.record_xp(text, integer) to public, anon, authenticated;
grant execute on function public.award_my_daily_xp(text, uuid) to public, anon, authenticated;

drop index if exists public.xp_events_user_id_idempotency_key_uidx;
create index xp_events_user_id_idempotency_key_uidx
  on public.xp_events (idempotency_key, user_id);

drop index if exists public.xp_events_user_created_at_idx;
create index xp_events_user_created_at_idx on public.xp_events (created_at);

drop index if exists public.user_xp_leaderboard_idx;
create index user_xp_leaderboard_idx on public.user_xp (level);

alter table public.user_xp drop constraint if exists user_xp_user_id_fkey;
alter table public.user_xp
  add constraint user_xp_user_id_fkey check (id is not null);

alter table public.xp_events drop constraint if exists xp_events_user_id_fkey;
alter table public.xp_events
  add constraint xp_events_user_id_fkey check (id is not null);

do $fixture_guard$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_xp'
      and column_name = 'user_id'
      and data_type = 'text'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'xp_events'
      and column_name = 'user_id'
      and data_type = 'text'
  ) then
    raise exception 'daily XP legacy fixture requires pre-repair text user_id columns';
  end if;
end
$fixture_guard$;

delete from public.xp_events
where user_id in (
  'aaaaaaaa-1000-4000-8000-000000000001',
  'aaaaaaaa-2000-4000-8000-000000000002',
  'eeeeeeee-1000-4000-8000-000000000001',
  'eeeeeeee-2000-4000-8000-000000000002',
  'xp-orphan-not-a-uuid'
)
or user_id in (
  select md5('xp-level-user-' || level_no)::uuid::text
  from generate_series(1, 10) as levels(level_no)
)
or user_id = md5('xp-streak-30-user')::uuid::text;

delete from public.user_xp
where user_id in (
  'aaaaaaaa-1000-4000-8000-000000000001',
  'aaaaaaaa-2000-4000-8000-000000000002',
  'eeeeeeee-1000-4000-8000-000000000001',
  'eeeeeeee-2000-4000-8000-000000000002',
  'xp-orphan-not-a-uuid'
)
or user_id in (
  select md5('xp-level-user-' || level_no)::uuid::text
  from generate_series(1, 10) as levels(level_no)
)
or user_id = md5('xp-streak-30-user')::uuid::text;

delete from public.hrm_attendance
where id in (
  'abababab-1000-4000-8000-000000000001',
  'abababab-2000-4000-8000-000000000002'
);

delete from public.employees
where id in (
  'eeeeeeee-1000-4000-8000-000000000001',
  'eeeeeeee-2000-4000-8000-000000000002'
);

delete from public.users
where id in (
  'aaaaaaaa-1000-4000-8000-000000000001',
  'aaaaaaaa-2000-4000-8000-000000000002'
)
or id in (
  select md5('xp-level-user-' || level_no)::uuid
  from generate_series(1, 10) as levels(level_no)
)
or id = md5('xp-streak-30-user')::uuid;

delete from auth.users
where id in (
  '91919191-9191-4191-8191-919191919191',
  '92929292-9292-4292-8292-929292929292'
);

insert into auth.users (id, email)
values
  ('91919191-9191-4191-8191-919191919191', 'xp.level.1@example.test'),
  ('92929292-9292-4292-8292-929292929292', 'xp.level.2@example.test')
on conflict (id) do update set email = excluded.email;

insert into public.users (id, name, email, username, role, is_active)
values
  (
    'aaaaaaaa-1000-4000-8000-000000000001',
    'XP Repair Direct User',
    'xp.repair.direct@example.test',
    'xp_repair_direct',
    'EMPLOYEE',
    true
  ),
  (
    'aaaaaaaa-2000-4000-8000-000000000002',
    'XP Repair Employee User',
    'xp.repair.employee@example.test',
    'xp_repair_employee',
    'EMPLOYEE',
    true
  )
on conflict (id) do update
set name = excluded.name,
    email = excluded.email,
    username = excluded.username,
    role = excluded.role,
    is_active = excluded.is_active,
    auth_id = null;

insert into public.users (id, name, email, username, role, is_active)
select
  md5('xp-level-user-' || level_no)::uuid,
  'XP Level Fixture ' || level_no,
  'xp.level.' || level_no || '@example.test',
  'xp_level_fixture_' || level_no,
  'EMPLOYEE',
  true
from generate_series(1, 10) as levels(level_no)
on conflict (id) do update
set name = excluded.name,
    email = excluded.email,
    username = excluded.username,
    role = excluded.role,
    is_active = excluded.is_active,
    auth_id = null;

update public.users
set auth_id = case id
  when md5('xp-level-user-1')::uuid then '91919191-9191-4191-8191-919191919191'::uuid
  when md5('xp-level-user-2')::uuid then '92929292-9292-4292-8292-929292929292'::uuid
end
where id in (md5('xp-level-user-1')::uuid, md5('xp-level-user-2')::uuid);

insert into public.users (id, name, email, username, role, is_active)
values (
  md5('xp-streak-30-user')::uuid,
  'XP Thirty Day Streak Fixture',
  'xp.streak.30@example.test',
  'xp_streak_30_fixture',
  'EMPLOYEE',
  true
)
on conflict (id) do update
set name = excluded.name,
    email = excluded.email,
    username = excluded.username,
    role = excluded.role,
    is_active = excluded.is_active,
    auth_id = null;

insert into public.employees (id, employee_code, full_name, email, user_id)
values
  (
    'eeeeeeee-1000-4000-8000-000000000001',
    'XP-REPAIR-A',
    'XP Repair Direct Employee',
    'xp.repair.direct@example.test',
    'aaaaaaaa-1000-4000-8000-000000000001'
  ),
  (
    'eeeeeeee-2000-4000-8000-000000000002',
    'XP-REPAIR-B',
    'XP Repair Legacy Employee',
    'xp.repair.employee@example.test',
    'aaaaaaaa-2000-4000-8000-000000000002'
  )
on conflict (id) do update
set employee_code = excluded.employee_code,
    full_name = excluded.full_name,
    email = excluded.email,
    user_id = excluded.user_id;

insert into public.hrm_attendance (id, "employeeId", date, status, "checkIn", "createdAt")
values
  (
    'abababab-1000-4000-8000-000000000001',
    'eeeeeeee-1000-4000-8000-000000000001',
    '2026-07-15',
    'present',
    '07:30',
    '2026-07-15 00:30:00+00'
  ),
  (
    'abababab-2000-4000-8000-000000000002',
    'eeeeeeee-2000-4000-8000-000000000002',
    '2026-07-08',
    'present',
    '08:00',
    '2026-07-08 01:00:00+00'
  )
on conflict (id) do update
set "employeeId" = excluded."employeeId",
    date = excluded.date,
    status = excluded.status,
    "checkIn" = excluded."checkIn",
    "createdAt" = excluded."createdAt";

insert into public.user_xp (
  id, user_id, total_xp, level, streak_days, last_active_date, badges, created_at, updated_at
)
values
  (
    '71000000-0000-4000-8000-000000000001',
    ' {AAAAAAAA-1000-4000-8000-000000000001} ',
    9999,
    10,
    999,
    '1999-01-01',
    '[{"id":"stale","earnedAt":"1999-01-01T00:00:00Z"}]'::jsonb,
    '2026-01-01 00:00:00+00',
    '2026-01-01 00:00:00+00'
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    'eeeeeeee-1000-4000-8000-000000000001',
    8888,
    9,
    888,
    '1998-01-01',
    '[]'::jsonb,
    '2025-01-01 00:00:00+00',
    '2025-01-01 00:00:00+00'
  ),
  (
    '71000000-0000-4000-8000-000000000003',
    'eeeeeeee-2000-4000-8000-000000000002',
    7777,
    8,
    777,
    '1997-01-01',
    '[]'::jsonb,
    '2024-01-01 00:00:00+00',
    '2024-01-01 00:00:00+00'
  ),
  (
    '71000000-0000-4000-8000-000000000004',
    'xp-orphan-not-a-uuid',
    123,
    2,
    1,
    '2026-01-01',
    '[]'::jsonb,
    '2026-01-01 00:00:00+00',
    '2026-01-01 00:00:00+00'
  );

insert into public.user_xp (id, user_id, total_xp, level, streak_days, badges, created_at, updated_at)
select
  md5('xp-level-profile-' || level_no)::uuid,
  md5('xp-level-user-' || level_no)::uuid::text,
  -1,
  99,
  99,
  '[]'::jsonb,
  '2026-01-01 00:00:00+00',
  '2026-01-01 00:00:00+00'
from generate_series(1, 10) as levels(level_no);

insert into public.user_xp (id, user_id, total_xp, level, streak_days, badges, created_at, updated_at)
values (
  md5('xp-streak-30-profile')::uuid,
  md5('xp-streak-30-user')::uuid::text,
  -1,
  99,
  99,
  '[]'::jsonb,
  '2026-01-01 00:00:00+00',
  '2026-01-01 00:00:00+00'
);

insert into public.xp_events (
  id, user_id, event_type, xp_amount, description, metadata, created_at
)
values
  (
    '72000000-0000-4000-8000-000000000001',
    'eeeeeeee-1000-4000-8000-000000000001',
    'daily_login',
    99,
    'earliest canonical login',
    '{}'::jsonb,
    '2026-07-14 17:30:00+00'
  ),
  (
    '72000000-0000-4000-8000-000000000002',
    '{AAAAAAAA-1000-4000-8000-000000000001}',
    'daily_login',
    77,
    'later duplicate canonical login',
    '{}'::jsonb,
    '2026-07-15 16:59:00+00'
  ),
  (
    '72000000-0000-4000-8000-000000000003',
    'aaaaaaaa-1000-4000-8000-000000000001',
    'daily_checkin',
    88,
    'earliest canonical check-in',
    '{}'::jsonb,
    '2026-07-14 17:40:00+00'
  ),
  (
    '72000000-0000-4000-8000-000000000004',
    'eeeeeeee-1000-4000-8000-000000000001',
    'daily_checkin',
    66,
    'later duplicate canonical check-in',
    '{}'::jsonb,
    '2026-07-14 19:00:00+00'
  ),
  (
    '72000000-0000-4000-8000-000000000005',
    'eeeeeeee-1000-4000-8000-000000000001',
    'create_request',
    17,
    'non-daily amount must survive',
    '{}'::jsonb,
    '2026-07-14 10:00:00+00'
  ),
  (
    '72000000-0000-4000-8000-000000000006',
    'xp-orphan-not-a-uuid',
    'create_request',
    123,
    'orphan event must be archived and removed',
    '{}'::jsonb,
    '2026-01-01 00:00:00+00'
  ),
  (
    '72000000-0000-4000-8000-000000000010',
    'eeeeeeee-2000-4000-8000-000000000002',
    'create_request',
    60,
    'first XP condition',
    '{}'::jsonb,
    '2026-06-30 01:00:00+00'
  ),
  (
    '72000000-0000-4000-8000-000000000018',
    'eeeeeeee-2000-4000-8000-000000000002',
    'daily_checkin',
    999,
    'check-in must not extend login streak',
    '{}'::jsonb,
    '2026-07-08 01:00:00+00'
  );

insert into public.xp_events (id, user_id, event_type, xp_amount, description, metadata, created_at)
select
  ('73000000-0000-4000-8000-' || lpad(day_no::text, 12, '0'))::uuid,
  'eeeeeeee-2000-4000-8000-000000000002',
  'daily_login',
  50 + day_no,
  'legacy login day ' || day_no,
  '{}'::jsonb,
  make_timestamptz(2026, 7, day_no, 1, 0, 0, 'UTC')
from generate_series(1, 7) as login_days(day_no);

insert into public.xp_events (id, user_id, event_type, xp_amount, description, metadata, created_at)
select
  md5('xp-level-event-' || level_no)::uuid,
  md5('xp-level-user-' || level_no)::uuid::text,
  'level_fixture',
  threshold_xp,
  'level threshold fixture ' || threshold_xp,
  '{}'::jsonb,
  make_timestamptz(2026, 1, level_no, 0, 0, 0, 'UTC')
from (
  values
    (2, 100),
    (3, 300),
    (4, 600),
    (5, 1000),
    (6, 1500),
    (7, 2500),
    (8, 4000),
    (9, 6000),
    (10, 10000)
) as thresholds(level_no, threshold_xp);

insert into public.xp_events (id, user_id, event_type, xp_amount, description, metadata, created_at)
select
  md5('xp-streak-30-event-' || day_no)::uuid,
  md5('xp-streak-30-user')::uuid::text,
  'daily_login',
  91,
  'legacy thirty-day login ' || day_no,
  '{}'::jsonb,
  make_timestamptz(2026, 5, day_no, 1, 0, 0, 'UTC')
from generate_series(1, 30) as login_days(day_no);

update public.xp_events
set idempotency_key = case id
  when '72000000-0000-4000-8000-000000000001' then 'legacy:noncanonical-login-key'
  when '72000000-0000-4000-8000-000000000005' then 'daily_login:2026-07-15'
  else idempotency_key
end
where id in (
  '72000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000005'
);

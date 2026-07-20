-- V2 admin monitoring: durable user sessions, session events, and richer
-- web push delivery/device linkage.

alter table public.notification_deliveries
  add column if not exists subscription_id uuid references public.web_push_subscriptions(id) on delete set null;

create index if not exists idx_notification_deliveries_subscription_id
  on public.notification_deliveries(subscription_id);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  auth_id uuid,
  login_at timestamptz not null default now(),
  logout_at timestamptz,
  last_seen_at timestamptz not null default now(),
  duration_seconds integer not null default 0,
  status text not null default 'active',
  ip_address text,
  user_agent text,
  device_type text,
  platform text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_sessions_status_check
    check (status in ('active', 'logout', 'timeout'))
);

create index if not exists idx_user_sessions_user_login
  on public.user_sessions(user_id, login_at desc);

create index if not exists idx_user_sessions_status_last_seen
  on public.user_sessions(status, last_seen_at desc);

create index if not exists idx_user_sessions_login_at
  on public.user_sessions(login_at desc);

create table if not exists public.user_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.user_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_session_events_event_type_check
    check (event_type in ('login', 'logout', 'heartbeat', 'timeout'))
);

create index if not exists idx_user_session_events_session_created
  on public.user_session_events(session_id, created_at desc);

create index if not exists idx_user_session_events_user_created
  on public.user_session_events(user_id, created_at desc);

create index if not exists idx_user_session_events_type_created
  on public.user_session_events(event_type, created_at desc);

alter table public.user_sessions enable row level security;
alter table public.user_session_events enable row level security;

drop policy if exists user_sessions_select on public.user_sessions;
drop policy if exists user_sessions_insert on public.user_sessions;
drop policy if exists user_sessions_update on public.user_sessions;
drop policy if exists user_session_events_select on public.user_session_events;
drop policy if exists user_session_events_insert on public.user_session_events;

create policy user_sessions_select
  on public.user_sessions
  for select
  to authenticated
  using (user_id = public.current_app_user_id() or public.is_admin());

create policy user_sessions_insert
  on public.user_sessions
  for insert
  to authenticated
  with check (user_id = public.current_app_user_id() or public.is_admin());

create policy user_sessions_update
  on public.user_sessions
  for update
  to authenticated
  using (user_id = public.current_app_user_id() or public.is_admin())
  with check (user_id = public.current_app_user_id() or public.is_admin());

create policy user_session_events_select
  on public.user_session_events
  for select
  to authenticated
  using (user_id = public.current_app_user_id() or public.is_admin());

create policy user_session_events_insert
  on public.user_session_events
  for insert
  to authenticated
  with check (user_id = public.current_app_user_id() or public.is_admin());

revoke all on table public.user_sessions from anon;
revoke all on table public.user_sessions from public;
revoke all on table public.user_session_events from anon;
revoke all on table public.user_session_events from public;

grant select, insert, update on table public.user_sessions to authenticated;
grant select, insert on table public.user_session_events to authenticated;
grant all on table public.user_sessions to service_role;
grant all on table public.user_session_events to service_role;

create or replace function public.timeout_stale_user_sessions(p_timeout_minutes integer default 5)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admin can timeout stale sessions'
      using errcode = '42501';
  end if;

  with timed_out as (
    update public.user_sessions
    set status = 'timeout',
        logout_at = coalesce(logout_at, last_seen_at),
        duration_seconds = greatest(0, floor(extract(epoch from (coalesce(logout_at, last_seen_at) - login_at)))::integer),
        updated_at = now()
    where status = 'active'
      and last_seen_at < now() - make_interval(mins => greatest(1, p_timeout_minutes))
    returning id, user_id
  ),
  inserted as (
    insert into public.user_session_events (session_id, user_id, event_type, metadata)
    select id, user_id, 'timeout', jsonb_build_object('timeoutMinutes', greatest(1, p_timeout_minutes))
    from timed_out
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.timeout_stale_user_sessions(integer) from public;
grant execute on function public.timeout_stale_user_sessions(integer) to authenticated;

notify pgrst, 'reload schema';

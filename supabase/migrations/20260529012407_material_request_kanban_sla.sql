-- Kanban/SLA layer for project material requests.
-- Core WMS stock movement stays in transactions/fulfillment batches.

create extension if not exists pgcrypto;

alter table public.requests
  add column if not exists workflow_step text,
  add column if not exists workflow_step_started_at timestamptz,
  add column if not exists workflow_step_due_at timestamptz,
  add column if not exists workflow_step_sla_hours integer,
  add column if not exists workflow_step_actor_user_id text;

alter table public.requests
  drop constraint if exists requests_workflow_step_sla_hours_nonnegative;

alter table public.requests
  add constraint requests_workflow_step_sla_hours_nonnegative
  check (workflow_step_sla_hours is null or workflow_step_sla_hours >= 0);

create index if not exists idx_requests_project_workflow_step
  on public.requests(project_id, workflow_step, status, created_date desc)
  where request_origin = 'project';

create index if not exists idx_requests_workflow_due
  on public.requests(workflow_step_due_at)
  where request_origin = 'project' and workflow_step_due_at is not null;

create table if not exists public.material_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.requests(id) on delete cascade,
  project_id text not null,
  from_step text,
  to_step text,
  action text not null,
  actor_user_id text not null,
  target_user_id text,
  target_permission text,
  note text,
  sla_hours integer,
  due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.material_request_events
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists request_id text,
  add column if not exists project_id text,
  add column if not exists from_step text,
  add column if not exists to_step text,
  add column if not exists action text,
  add column if not exists actor_user_id text,
  add column if not exists target_user_id text,
  add column if not exists target_permission text,
  add column if not exists note text,
  add column if not exists sla_hours integer,
  add column if not exists due_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_material_request_events_request_created
  on public.material_request_events(request_id, created_at desc);

create index if not exists idx_material_request_events_project_created
  on public.material_request_events(project_id, created_at desc);

create index if not exists idx_material_request_events_target_created
  on public.material_request_events(target_user_id, created_at desc);

alter table public.material_request_events enable row level security;

create or replace function app_private.material_request_event_can_select(
  p_request_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests r
    where r.id = p_request_id
      and app_private.material_request_can_select(
        r.request_origin,
        r.project_id,
        r.requester_id,
        r.submitted_to_user_id,
        r.source_warehouse_id,
        r.site_warehouse_id
      )
  );
$$;

create or replace function app_private.material_request_event_can_insert(
  p_request_id text,
  p_project_id text,
  p_actor_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_user_id = public.current_app_user_id()::text
    and exists (
      select 1
      from public.requests r
      where r.id = p_request_id
        and coalesce(r.request_origin, 'wms') = 'project'
        and r.project_id = p_project_id
        and (
          public.is_admin()
          or r.requester_id = public.current_app_user_id()
          or r.submitted_to_user_id = public.current_app_user_id()::text
          or app_private.project_request_can_write(r.project_id)
          or app_private.project_user_has_permission(r.project_id, null, 'approve')
          or app_private.project_user_has_permission(r.project_id, null, 'confirm')
          or app_private.project_user_has_permission(r.project_id, null, 'verify')
        )
    );
$$;

drop policy if exists material_request_events_select on public.material_request_events;
drop policy if exists material_request_events_insert on public.material_request_events;
drop policy if exists material_request_events_update on public.material_request_events;
drop policy if exists material_request_events_delete on public.material_request_events;

revoke all on table public.material_request_events from anon;
revoke all on table public.material_request_events from public;
revoke all on table public.material_request_events from authenticated;
grant select, insert on table public.material_request_events to authenticated;

create policy material_request_events_select
  on public.material_request_events
  for select
  to authenticated
  using (app_private.material_request_event_can_select(request_id));

create policy material_request_events_insert
  on public.material_request_events
  for insert
  to authenticated
  with check (app_private.material_request_event_can_insert(request_id, project_id, actor_user_id));

notify pgrst, 'reload schema';

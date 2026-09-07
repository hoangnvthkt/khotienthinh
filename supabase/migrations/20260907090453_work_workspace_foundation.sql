-- Vioo Work Workspace foundation (WS1).
--
-- This migration is intentionally additive.  The workspace_id bridges below do
-- not widen the existing scope_type checks and the existing task/configuration
-- RPCs continue to resolve their legacy department/project scopes unchanged.
-- Cross-workspace task/group/calendar/policy validation belongs to WS4/WS5.

create table public.work_workspaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  department_id uuid references public.org_units(id) on delete restrict,
  project_id text references public.projects(id) on delete restrict,
  name text not null,
  description text,
  icon_key text not null default 'folder',
  color_key text not null default 'blue',
  cover_key text not null default 'plain',
  status text not null default 'active',
  access_mode text not null default 'legacy',
  lock_version bigint not null default 1,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_workspaces_kind_check check (kind in ('department', 'project', 'collaboration')),
  constraint work_workspaces_scope_shape_check check (
    (kind = 'department' and department_id is not null and project_id is null)
    or (kind = 'project' and project_id is not null and department_id is null)
    or (kind = 'collaboration' and department_id is null and project_id is null)
  ),
  constraint work_workspaces_name_check check (char_length(btrim(name)) between 2 and 160),
  constraint work_workspaces_description_check check (
    description is null or char_length(description) <= 2000
  ),
  constraint work_workspaces_icon_key_check check (icon_key in (
    'folder', 'building', 'briefcase', 'users', 'rocket', 'target', 'layers', 'calendar'
  )),
  constraint work_workspaces_color_key_check check (color_key in (
    'slate', 'blue', 'teal', 'green', 'amber', 'orange', 'rose', 'violet'
  )),
  constraint work_workspaces_cover_key_check check (cover_key in (
    'plain', 'grid', 'waves', 'dots', 'blueprint', 'sunrise'
  )),
  constraint work_workspaces_status_check check (status in ('active', 'archived')),
  constraint work_workspaces_access_mode_check check (access_mode in ('legacy', 'workspace')),
  constraint work_workspaces_lock_version_check check (lock_version > 0)
);

-- Source uniqueness intentionally includes archived rows so a source cannot
-- acquire a second Workspace while its original Workspace is archived.
create unique index work_workspace_department_unique
  on public.work_workspaces(department_id)
  where department_id is not null;
create unique index work_workspace_project_unique
  on public.work_workspaces(project_id)
  where project_id is not null;
create index work_workspaces_created_by_idx
  on public.work_workspaces(created_by);
create index work_workspaces_lookup_idx
  on public.work_workspaces(status, kind, updated_at desc, id desc);

create table public.work_workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.work_workspaces(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  role text not null default 'member',
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  added_by uuid not null references public.users(id) on delete restrict,
  origin text not null default 'manual',
  source_reference text,
  lock_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_workspace_members_workspace_user_key unique (workspace_id, user_id),
  constraint work_workspace_members_role_check check (role in ('admin', 'member')),
  constraint work_workspace_members_status_check check (status in ('active', 'removed')),
  constraint work_workspace_members_time_range_check check (
    isfinite(starts_at)
    and (expires_at is null or (isfinite(expires_at) and expires_at > starts_at))
  ),
  constraint work_workspace_members_origin_check check (
    origin in ('manual', 'organization', 'project')
  ),
  constraint work_workspace_members_source_reference_check check (
    source_reference is null or char_length(btrim(source_reference)) between 1 and 255
  ),
  constraint work_workspace_members_lock_version_check check (lock_version > 0)
);

create index work_workspace_members_workspace_lookup_idx
  on public.work_workspace_members(workspace_id, status, role, user_id);
create index work_workspace_members_user_lookup_idx
  on public.work_workspace_members(user_id, status, workspace_id);
create index work_workspace_members_added_by_idx
  on public.work_workspace_members(added_by);

create table public.work_workspace_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  workspace_id uuid not null references public.work_workspaces(id) on delete restrict,
  pinned boolean not null default false,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_workspace_preferences_user_workspace_key unique (user_id, workspace_id),
  constraint work_workspace_preferences_last_opened_at_check check (
    last_opened_at is null or isfinite(last_opened_at)
  )
);

create index work_workspace_preferences_workspace_idx
  on public.work_workspace_preferences(workspace_id, pinned, last_opened_at desc, user_id);
create index work_workspace_preferences_user_idx
  on public.work_workspace_preferences(user_id, pinned, last_opened_at desc, workspace_id);

create table app_private.work_workspace_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  workspace_id uuid not null references public.work_workspaces(id) on delete restrict,
  kind text not null,
  before_value jsonb,
  after_value jsonb,
  reason text not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint work_workspace_events_kind_check check (char_length(btrim(kind)) between 1 and 120),
  constraint work_workspace_events_reason_check check (char_length(btrim(reason)) between 1 and 2000)
);

create index work_workspace_events_workspace_idx
  on app_private.work_workspace_events(workspace_id, created_at desc, id desc);
create index work_workspace_events_actor_idx
  on app_private.work_workspace_events(actor_user_id, created_at desc, id desc);
create index work_workspace_events_kind_idx
  on app_private.work_workspace_events(workspace_id, kind, created_at desc, id desc);
create index work_workspace_events_idempotency_idx
  on app_private.work_workspace_events(idempotency_key);

-- Workspace source identity is permanent; reorganization is a separate
-- migration/command and cannot be achieved by editing this row in place.
create function app_private.work_workspace_source_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind
     or new.department_id is distinct from old.department_id
     or new.project_id is distinct from old.project_id then
    raise exception 'WORK_WORKSPACE_SOURCE_IMMUTABLE' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger work_workspace_source_immutable
before update of kind, department_id, project_id
on public.work_workspaces
for each row execute function app_private.work_workspace_source_immutable();

create function app_private.work_workspace_reject_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'WORK_WORKSPACE_DELETE_FORBIDDEN' using errcode = '42501';
end;
$$;

create trigger work_workspace_reject_delete
before delete on public.work_workspaces
for each row execute function app_private.work_workspace_reject_delete();

create function app_private.work_workspace_event_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'WORK_WORKSPACE_EVENT_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger work_workspace_event_append_only
before update or delete on app_private.work_workspace_events
for each row execute function app_private.work_workspace_event_append_only();

revoke all on table
  public.work_workspaces,
  public.work_workspace_members,
  public.work_workspace_preferences
from public, anon, authenticated;
revoke all on table app_private.work_workspace_events from public, anon, authenticated;

alter table public.work_workspaces enable row level security;
alter table public.work_workspace_members enable row level security;
alter table public.work_workspace_preferences enable row level security;
alter table app_private.work_workspace_events enable row level security;

revoke all on function app_private.work_workspace_source_immutable() from public, anon, authenticated;
revoke all on function app_private.work_workspace_reject_delete() from public, anon, authenticated;
revoke all on function app_private.work_workspace_event_append_only() from public, anon, authenticated;

-- Additive scope bridges.  Existing scope shape constraints intentionally stay
-- unchanged; WS4/WS5 will add the server-side cross-workspace invariants.
alter table public.work_tasks
  add column workspace_id uuid references public.work_workspaces(id) on delete restrict;
alter table public.work_task_groups
  add column workspace_id uuid references public.work_workspaces(id) on delete restrict;
alter table public.work_sla_calendars
  add column workspace_id uuid references public.work_workspaces(id) on delete restrict;
alter table public.work_sla_policies
  add column workspace_id uuid references public.work_workspaces(id) on delete restrict;

create index work_tasks_workspace_idx
  on public.work_tasks(workspace_id, updated_at desc, id desc)
  where workspace_id is not null;
create index work_task_groups_workspace_idx
  on public.work_task_groups(workspace_id, updated_at desc, id desc)
  where workspace_id is not null;
create index work_sla_calendars_workspace_idx
  on public.work_sla_calendars(workspace_id, updated_at desc, id desc)
  where workspace_id is not null;
create index work_sla_policies_workspace_idx
  on public.work_sla_policies(workspace_id, updated_at desc, id desc)
  where workspace_id is not null;

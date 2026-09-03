-- Principal - Permission - Scope - Assignment pilot for Daily Log.
-- Internal ERP links remain identifiers only; PostgreSQL authorization remains
-- the authoritative check for viewing a subject and acting on a workflow step.

create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
grant usage on schema app_private to authenticated;

create table if not exists public.app_responsibility_slots (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type = 'daily_log'),
  responsibility text not null check (responsibility in ('current_verifier', 'current_approver')),
  scope_type text not null check (scope_type in ('global', 'project', 'construction_site')),
  scope_id text not null,
  assignee_user_id uuid not null references public.users(id) on delete restrict,
  permission_code text not null check (permission_code in ('project.daily_log.verify', 'project.daily_log.approve')),
  priority integer not null default 100,
  status text not null default 'active' check (status in ('active', 'inactive')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_responsibility_slots_scope_check check (
    (scope_type = 'global' and scope_id = '*')
    or (scope_type in ('project', 'construction_site') and nullif(btrim(scope_id), '') is not null)
  ),
  constraint app_responsibility_slots_effective_range_check check (
    expires_at is null or expires_at > starts_at
  ),
  constraint app_responsibility_slots_permission_check check (
    (responsibility = 'current_verifier' and permission_code = 'project.daily_log.verify')
    or (responsibility = 'current_approver' and permission_code = 'project.daily_log.approve')
  )
);

create unique index if not exists ux_app_responsibility_slots_candidate
  on public.app_responsibility_slots (
    subject_type,
    responsibility,
    scope_type,
    scope_id,
    assignee_user_id
  );

create index if not exists idx_app_responsibility_slots_resolution
  on public.app_responsibility_slots (
    subject_type,
    responsibility,
    status,
    scope_type,
    scope_id,
    priority,
    starts_at
  );

create table if not exists public.app_responsibility_slot_events (
  id uuid primary key default gen_random_uuid(),
  responsibility_slot_id uuid not null references public.app_responsibility_slots(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'updated')),
  actor_user_id uuid references public.users(id) on delete set null,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_responsibility_slot_events_slot_created
  on public.app_responsibility_slot_events (responsibility_slot_id, created_at desc);

create table if not exists public.app_assignments (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id text not null,
  workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  workflow_step_id text,
  principal_type text not null default 'user' check (principal_type = 'user'),
  principal_id uuid not null references public.users(id) on delete restrict,
  responsibility text not null,
  permission_code text,
  scope_type text not null check (scope_type in ('global', 'project', 'construction_site', 'own', 'assigned', 'warehouse', 'department')),
  scope_id text not null,
  status text not null default 'active' check (status in ('active', 'closed', 'cancelled', 'expired')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  assigned_by uuid references public.users(id) on delete set null,
  assigned_reason text,
  closed_at timestamptz,
  closed_by uuid references public.users(id) on delete set null,
  close_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_assignments_effective_range_check check (
    expires_at is null or expires_at > starts_at
  )
);

create unique index if not exists ux_app_assignments_active_responsibility
  on public.app_assignments (subject_type, subject_id, responsibility)
  where status = 'active';

create index if not exists idx_app_assignments_active_principal
  on public.app_assignments (principal_id, starts_at desc)
  where status = 'active';

create index if not exists idx_app_assignments_active_subject
  on public.app_assignments (subject_type, subject_id, starts_at desc)
  where status = 'active';

create table if not exists public.app_assignment_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.app_assignments(id) on delete cascade,
  event_type text not null check (event_type in ('assigned', 'closed', 'cancelled', 'expired')),
  actor_user_id uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_assignment_events_assignment_created
  on public.app_assignment_events (assignment_id, created_at desc);

alter table public.app_responsibility_slots enable row level security;
alter table public.app_responsibility_slot_events enable row level security;
alter table public.app_assignments enable row level security;
alter table public.app_assignment_events enable row level security;

revoke all on table public.app_responsibility_slots, public.app_assignments from public, anon, authenticated;
revoke all on table public.app_responsibility_slot_events from public, anon, authenticated;
revoke all on table public.app_assignment_events from public, anon, authenticated;

create or replace function app_private.daily_log_user_can_receive_assignment(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.users u
      where u.id = p_user_id
        and coalesce(u.is_active, true)
    )
    and app_private.project_has_permission_v2(
      p_project_id,
      p_construction_site_id,
      p_permission_code,
      p_user_id
    );
$$;

revoke all on function app_private.daily_log_user_can_receive_assignment(text, text, text, uuid) from public, anon, authenticated;

create or replace function app_private.resolve_daily_log_responsibility(
  p_project_id text,
  p_construction_site_id text,
  p_responsibility text,
  p_permission_code text
)
returns table (
  responsibility_slot_id uuid,
  assignee_user_id uuid,
  scope_type text,
  scope_id text,
  permission_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidate_slots as (
    select
      slot.id as responsibility_slot_id,
      slot.assignee_user_id,
      slot.scope_type,
      slot.scope_id,
      slot.permission_code,
      slot.priority,
      slot.created_at,
      case
        when slot.scope_type = 'construction_site' and slot.scope_id = p_construction_site_id then 1
        when slot.scope_type = 'project' and slot.scope_id = p_project_id then 2
        when slot.scope_type = 'global' and slot.scope_id = '*' then 3
        else 99
      end as scope_rank
    from public.app_responsibility_slots slot
    where slot.subject_type = 'daily_log'
      and slot.responsibility = p_responsibility
      and slot.permission_code = p_permission_code
      and slot.status = 'active'
      and slot.starts_at <= now()
      and (slot.expires_at is null or slot.expires_at > now())
      and (
        (slot.scope_type = 'construction_site' and slot.scope_id = p_construction_site_id)
        or (slot.scope_type = 'project' and slot.scope_id = p_project_id)
        or (slot.scope_type = 'global' and slot.scope_id = '*')
      )
  )
  select
    candidate_slots.responsibility_slot_id,
    candidate_slots.assignee_user_id,
    candidate_slots.scope_type,
    candidate_slots.scope_id,
    candidate_slots.permission_code
  from candidate_slots
  where app_private.daily_log_user_can_receive_assignment(
    p_project_id,
    p_construction_site_id,
    candidate_slots.permission_code,
    candidate_slots.assignee_user_id
  )
  order by scope_rank asc, priority asc, created_at asc
  limit 1;
$$;

revoke all on function app_private.resolve_daily_log_responsibility(text, text, text, text) from public, anon, authenticated;

create or replace function app_private.daily_log_assignment_is_active(
  p_log_id text,
  p_actor_user_id uuid,
  p_responsibilities text[],
  p_permission_code text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_user_id is not null
    and exists (
      select 1
      from public.app_assignments assignment_row
      join public.users assignee on assignee.id = assignment_row.principal_id
      where assignment_row.subject_type = 'daily_log'
        and assignment_row.subject_id = p_log_id
        and assignment_row.principal_type = 'user'
        and assignment_row.principal_id = p_actor_user_id
        and assignment_row.status = 'active'
        and assignment_row.starts_at <= now()
        and (assignment_row.expires_at is null or assignment_row.expires_at > now())
        and coalesce(assignee.is_active, true)
        and assignment_row.responsibility = any(coalesce(p_responsibilities, '{}'::text[]))
        and (p_permission_code is null or assignment_row.permission_code = p_permission_code)
    );
$$;

revoke all on function app_private.daily_log_assignment_is_active(text, uuid, text[], text) from public, anon, authenticated;

create or replace function app_private.create_daily_log_assignment(
  p_log_id text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.daily_logs%rowtype;
  v_responsibility text;
  v_permission_code text;
  v_slot record;
  v_assignment_id uuid;
begin
  select *
  into v_log
  from public.daily_logs
  where id = p_log_id
  for update;

  if not found then
    raise exception 'Không tìm thấy nhật ký công trường.' using errcode = 'P0002';
  end if;

  v_responsibility := case
    when coalesce(v_log.submitted_to_permission, '') = 'approve' then 'current_approver'
    else 'current_verifier'
  end;
  v_permission_code := case
    when v_responsibility = 'current_approver' then 'project.daily_log.approve'
    else 'project.daily_log.verify'
  end;

  select *
  into v_slot
  from app_private.resolve_daily_log_responsibility(
    v_log.project_id::text,
    v_log.construction_site_id::text,
    v_responsibility,
    v_permission_code
  );

  if not found then
    raise exception 'Chưa cấu hình người chịu trách nhiệm % cho phạm vi nhật ký này.', v_responsibility
      using errcode = '42501',
            hint = 'Cấu hình responsibility slot tại Tổ chức dự án trước khi gửi nhật ký.';
  end if;

  with cancelled_assignments as (
    update public.app_assignments
    set status = 'cancelled',
        closed_at = now(),
        closed_by = p_actor_user_id,
        close_reason = 'reassigned',
        updated_at = now()
    where subject_type = 'daily_log'
      and subject_id = p_log_id
      and status = 'active'
    returning id
  )
  insert into public.app_assignment_events (assignment_id, event_type, actor_user_id, metadata)
  select id, 'cancelled', p_actor_user_id, jsonb_build_object('reason', 'reassigned')
  from cancelled_assignments;

  insert into public.app_assignments (
    subject_type,
    subject_id,
    workflow_step_id,
    principal_type,
    principal_id,
    responsibility,
    permission_code,
    scope_type,
    scope_id,
    status,
    assigned_by,
    assigned_reason,
    metadata
  )
  values (
    'daily_log',
    p_log_id,
    v_responsibility,
    'user',
    v_slot.assignee_user_id,
    v_responsibility,
    v_permission_code,
    v_slot.scope_type,
    v_slot.scope_id,
    'active',
    p_actor_user_id,
    'resolved_from_responsibility_slot',
    jsonb_build_object('responsibility_slot_id', v_slot.responsibility_slot_id)
  )
  returning id into v_assignment_id;

  insert into public.app_assignment_events (assignment_id, event_type, actor_user_id, metadata)
  values (
    v_assignment_id,
    'assigned',
    p_actor_user_id,
    jsonb_build_object('responsibility_slot_id', v_slot.responsibility_slot_id)
  );

  return v_assignment_id;
end;
$$;

revoke all on function app_private.create_daily_log_assignment(text, uuid) from public, anon, authenticated;

create or replace function app_private.create_daily_log_revision_assignment(
  p_log_id text,
  p_owner_user_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.daily_logs%rowtype;
  v_assignment_id uuid;
  v_scope_type text;
  v_scope_id text;
begin
  if p_owner_user_id is null then
    return null;
  end if;

  select *
  into v_log
  from public.daily_logs
  where id = p_log_id
  for update;

  if not found then
    return null;
  end if;

  v_scope_type := case when nullif(v_log.construction_site_id::text, '') is not null then 'construction_site' else 'project' end;
  v_scope_id := coalesce(nullif(v_log.construction_site_id::text, ''), nullif(v_log.project_id::text, ''));

  with cancelled_assignments as (
    update public.app_assignments
    set status = 'cancelled',
        closed_at = now(),
        closed_by = p_actor_user_id,
        close_reason = 'superseded_revision_owner',
        updated_at = now()
    where subject_type = 'daily_log'
      and subject_id = p_log_id
      and responsibility = 'revision_owner'
      and status = 'active'
    returning id
  )
  insert into public.app_assignment_events (assignment_id, event_type, actor_user_id, metadata)
  select id, 'cancelled', p_actor_user_id, jsonb_build_object('reason', 'superseded_revision_owner')
  from cancelled_assignments;

  insert into public.app_assignments (
    subject_type,
    subject_id,
    workflow_step_id,
    principal_type,
    principal_id,
    responsibility,
    permission_code,
    scope_type,
    scope_id,
    status,
    assigned_by,
    assigned_reason
  )
  values (
    'daily_log',
    p_log_id,
    'revision',
    'user',
    p_owner_user_id,
    'revision_owner',
    'project.daily_log.edit_own',
    v_scope_type,
    v_scope_id,
    'active',
    p_actor_user_id,
    'returned_to_owner'
  )
  returning id into v_assignment_id;

  insert into public.app_assignment_events (assignment_id, event_type, actor_user_id)
  values (v_assignment_id, 'assigned', p_actor_user_id);

  return v_assignment_id;
end;
$$;

revoke all on function app_private.create_daily_log_revision_assignment(text, uuid, uuid) from public, anon, authenticated;

create or replace function app_private.close_daily_log_assignments(
  p_log_id text,
  p_actor_user_id uuid,
  p_close_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with closed_assignments as (
    update public.app_assignments
    set status = 'closed',
        closed_at = now(),
        closed_by = p_actor_user_id,
        close_reason = p_close_reason,
        updated_at = now()
    where subject_type = 'daily_log'
      and subject_id = p_log_id
      and status = 'active'
    returning id
  )
  insert into public.app_assignment_events (assignment_id, event_type, actor_user_id, metadata)
  select id, 'closed', p_actor_user_id, jsonb_build_object('reason', p_close_reason)
  from closed_assignments;
end;
$$;

revoke all on function app_private.close_daily_log_assignments(text, uuid, text) from public, anon, authenticated;

-- Preserve the current handler for in-flight legacy logs. The user id is joined
-- as text rather than cast so stale display values cannot abort this migration.
with legacy_submitted_daily_log_backfill as (
  insert into public.app_assignments (
    subject_type,
    subject_id,
    workflow_step_id,
    principal_type,
    principal_id,
    responsibility,
    permission_code,
    scope_type,
    scope_id,
    status,
    assigned_reason,
    metadata
  )
  select
    'daily_log',
    daily_log.id,
    case when coalesce(daily_log.submitted_to_permission, '') = 'approve' then 'current_approver' else 'current_verifier' end,
    'user',
    assignee.id,
    case when coalesce(daily_log.submitted_to_permission, '') = 'approve' then 'current_approver' else 'current_verifier' end,
    case when coalesce(daily_log.submitted_to_permission, '') = 'approve' then 'project.daily_log.approve' else 'project.daily_log.verify' end,
    case when nullif(daily_log.construction_site_id::text, '') is not null then 'construction_site' else 'project' end,
    coalesce(nullif(daily_log.construction_site_id::text, ''), nullif(daily_log.project_id::text, '')),
    'active',
    'legacy_submitted_daily_log_backfill',
    jsonb_build_object('backfilled_at', now())
  from public.daily_logs daily_log
  join public.users assignee on assignee.id::text = coalesce(nullif(daily_log.requested_verifier_id, ''), nullif(daily_log.submitted_to_user_id, ''))
  where daily_log.status = 'submitted'
    and coalesce(assignee.is_active, true)
  on conflict (subject_type, subject_id, responsibility) where status = 'active' do nothing
  returning id
)
insert into public.app_assignment_events (assignment_id, event_type, metadata)
select id, 'assigned', jsonb_build_object('source', 'legacy_submitted_daily_log_backfill')
from legacy_submitted_daily_log_backfill;

create or replace function app_private.can_view_subject_impl(
  p_subject_type text,
  p_subject_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_log public.daily_logs%rowtype;
begin
  if v_actor_user_id is null
    or not exists (
      select 1 from public.users user_row
      where user_row.id = v_actor_user_id
        and coalesce(user_row.is_active, true)
    ) then
    return false;
  end if;

  if p_subject_type <> 'daily_log' or nullif(btrim(coalesce(p_subject_id, '')), '') is null then
    return false;
  end if;

  select * into v_log from public.daily_logs where id = p_subject_id;
  if not found then
    return false;
  end if;

  return app_private.daily_log_has_action(
    v_log.project_id::text,
    v_log.construction_site_id::text,
    'project.daily_log.view',
    v_actor_user_id
  );
end;
$$;

revoke all on function app_private.can_view_subject_impl(text, text) from public, anon, authenticated;

create or replace function app_private.can_act_on_subject_impl(
  p_subject_type text,
  p_subject_id text,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_log public.daily_logs%rowtype;
  v_owner_id uuid;
  v_required_permission text;
  v_responsibilities text[];
begin
  if v_actor_user_id is null or not app_private.can_view_subject_impl(p_subject_type, p_subject_id) then
    return false;
  end if;

  if p_subject_type <> 'daily_log' then
    return false;
  end if;

  select * into v_log from public.daily_logs where id = p_subject_id;
  if not found then
    return false;
  end if;

  if p_action = 'view' then
    return true;
  end if;

  if p_action = 'submit' then
    select owner_user.id
    into v_owner_id
    from public.users owner_user
    where owner_user.id::text = coalesce(
      nullif(v_log.created_by_id, ''),
      nullif(v_log.submitted_by_id, ''),
      nullif(v_log.submitted_by, ''),
      nullif(v_log.created_by, '')
    )
    limit 1;

    return coalesce(v_log.status, 'draft') in ('draft', 'rejected')
      and v_owner_id = v_actor_user_id
      and app_private.daily_log_has_action(
        v_log.project_id::text,
        v_log.construction_site_id::text,
        'project.daily_log.submit',
        v_actor_user_id
      );
  end if;

  if p_action = 'verify' then
    v_required_permission := 'project.daily_log.verify';
    v_responsibilities := array['current_verifier'];
  elsif p_action = 'approve' then
    v_required_permission := 'project.daily_log.approve';
    v_responsibilities := array['current_approver'];
  elsif p_action = 'return' then
    v_required_permission := 'project.daily_log.return';
    v_responsibilities := array['current_verifier', 'current_approver'];
  else
    return false;
  end if;

  return coalesce(v_log.status, 'draft') = 'submitted'
    and app_private.daily_log_has_action(
      v_log.project_id::text,
      v_log.construction_site_id::text,
      v_required_permission,
      v_actor_user_id
    )
    and app_private.daily_log_assignment_is_active(
      p_subject_id,
      v_actor_user_id,
      v_responsibilities,
      case when p_action = 'return' then null else v_required_permission end
    );
end;
$$;

revoke all on function app_private.can_act_on_subject_impl(text, text, text) from public, anon, authenticated;

create or replace function public.can_view_subject(
  p_subject_type text,
  p_subject_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.can_view_subject_impl(p_subject_type, p_subject_id);
$$;

revoke all on function public.can_view_subject(text, text) from public, anon;
grant execute on function public.can_view_subject(text, text) to authenticated;

create or replace function public.can_act_on_subject(
  p_subject_type text,
  p_subject_id text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.can_act_on_subject_impl(p_subject_type, p_subject_id, p_action);
$$;

revoke all on function public.can_act_on_subject(text, text, text) from public, anon;
grant execute on function public.can_act_on_subject(text, text, text) to authenticated;

create or replace function app_private.get_daily_log_responsibility_target(
  p_log_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_log public.daily_logs%rowtype;
  v_responsibility text;
  v_permission_code text;
  v_slot record;
  v_actor_user_id uuid := public.current_app_user_id();
  v_assignee_name text;
begin
  if not app_private.can_act_on_subject_impl('daily_log', p_log_id, 'submit') then
    raise exception 'Bạn không có quyền gửi nhật ký này.' using errcode = '42501';
  end if;

  select * into v_log from public.daily_logs where id = p_log_id;
  v_responsibility := case when coalesce(v_log.submitted_to_permission, '') = 'approve' then 'current_approver' else 'current_verifier' end;
  v_permission_code := case when v_responsibility = 'current_approver' then 'project.daily_log.approve' else 'project.daily_log.verify' end;

  select * into v_slot
  from app_private.resolve_daily_log_responsibility(
    v_log.project_id::text,
    v_log.construction_site_id::text,
    v_responsibility,
    v_permission_code
  );

  if not found then
    raise exception 'Chưa cấu hình người chịu trách nhiệm % cho phạm vi nhật ký này.', v_responsibility
      using errcode = '42501';
  end if;

  select coalesce(name, username, email, id::text)
  into v_assignee_name
  from public.users
  where id = v_slot.assignee_user_id;

  return jsonb_build_object(
    'userId', v_slot.assignee_user_id,
    'name', v_assignee_name,
    'responsibility', v_responsibility,
    'permissionCode', v_permission_code,
    'scopeType', v_slot.scope_type,
    'scopeId', v_slot.scope_id,
    'resolvedBy', 'responsibility_slot',
    'requestedBy', v_actor_user_id
  );
end;
$$;

revoke all on function app_private.get_daily_log_responsibility_target(text) from public, anon, authenticated;

create or replace function public.get_daily_log_responsibility_target(
  p_log_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.get_daily_log_responsibility_target(p_log_id);
$$;

revoke all on function public.get_daily_log_responsibility_target(text) from public, anon;
grant execute on function public.get_daily_log_responsibility_target(text) to authenticated;

create or replace function app_private.get_daily_log_assignment_context(
  p_log_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'assignmentId', assignment_row.id,
    'userId', assignment_row.principal_id,
    'name', coalesce(assignee.name, assignee.username, assignee.email, assignee.id::text),
    'responsibility', assignment_row.responsibility,
    'permissionCode', assignment_row.permission_code,
    'status', assignment_row.status,
    'startsAt', assignment_row.starts_at,
    'expiresAt', assignment_row.expires_at
  )
  from public.app_assignments assignment_row
  join public.users assignee on assignee.id = assignment_row.principal_id
  where assignment_row.subject_type = 'daily_log'
    and assignment_row.subject_id = p_log_id
    and assignment_row.status = 'active'
    and assignment_row.starts_at <= now()
    and (assignment_row.expires_at is null or assignment_row.expires_at > now())
    and app_private.can_view_subject_impl('daily_log', p_log_id)
  order by assignment_row.created_at desc
  limit 1;
$$;

revoke all on function app_private.get_daily_log_assignment_context(text) from public, anon, authenticated;

create or replace function public.get_daily_log_assignment_context(
  p_log_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.get_daily_log_assignment_context(p_log_id);
$$;

revoke all on function public.get_daily_log_assignment_context(text) from public, anon;
grant execute on function public.get_daily_log_assignment_context(text) to authenticated;

create or replace function app_private.upsert_daily_log_responsibility_slot(
  p_slot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_id uuid := nullif(p_slot->>'id', '')::uuid;
  v_responsibility text := nullif(p_slot->>'responsibility', '');
  v_scope_type text := nullif(p_slot->>'scope_type', '');
  v_scope_id text := nullif(p_slot->>'scope_id', '');
  v_assignee_user_id uuid := nullif(p_slot->>'assignee_user_id', '')::uuid;
  v_permission_code text;
  v_actor_user_id uuid := public.current_app_user_id();
  v_result_id uuid;
  v_existing_slot public.app_responsibility_slots%rowtype;
  v_existing_scope_type text;
  v_existing_scope_id text;
  v_previous_slot jsonb;
  v_effective_status text;
begin
  if v_actor_user_id is null then
    raise exception 'Không xác định được người dùng đang thao tác.' using errcode = '42501';
  end if;

  if v_responsibility not in ('current_verifier', 'current_approver')
    or v_scope_type not in ('global', 'project', 'construction_site')
    or v_assignee_user_id is null then
    raise exception 'Responsibility slot Daily Log không hợp lệ.' using errcode = '22023';
  end if;

  if v_slot_id is not null then
    select *
    into v_existing_slot
    from public.app_responsibility_slots
    where id = v_slot_id
      and subject_type = 'daily_log'
    for update;

    if not found then
      raise exception 'Không tìm thấy Daily Log responsibility slot.' using errcode = 'P0002';
    end if;

    v_existing_scope_type := v_existing_slot.scope_type;
    v_existing_scope_id := v_existing_slot.scope_id;
    v_previous_slot := to_jsonb(v_existing_slot);

    if v_existing_scope_type = 'global' then
      if not (public.is_admin() or public.is_module_admin('DA')) then
        raise exception 'Chỉ quản trị viên dự án được sửa slot toàn cục.' using errcode = '42501';
      end if;
    elsif not app_private.can_manage_project_staff_assignment(
      case when v_existing_scope_type = 'project' then v_existing_scope_id else null end,
      case when v_existing_scope_type = 'construction_site' then v_existing_scope_id else null end
    ) then
      raise exception 'Bạn không có quyền sửa responsibility slot hiện tại.' using errcode = '42501';
    end if;
  end if;

  v_effective_status := coalesce(
    nullif(p_slot->>'status', ''),
    v_existing_slot.status,
    'active'
  );

  if v_effective_status not in ('active', 'inactive') then
    raise exception 'Trạng thái responsibility slot không hợp lệ.' using errcode = '22023';
  end if;

  if v_scope_type = 'global' then
    v_scope_id := '*';
    if not (public.is_admin() or public.is_module_admin('DA')) then
      raise exception 'Chỉ quản trị viên dự án được cấu hình slot toàn cục.' using errcode = '42501';
    end if;
  elsif nullif(v_scope_id, '') is null then
    raise exception 'Responsibility slot phải có phạm vi project hoặc construction site.' using errcode = '23502';
  elsif not app_private.can_manage_project_staff_assignment(
    case when v_scope_type = 'project' then v_scope_id else null end,
    case when v_scope_type = 'construction_site' then v_scope_id else null end
  ) then
    raise exception 'Bạn không có quyền cấu hình responsibility slot ở phạm vi này.' using errcode = '42501';
  end if;

  v_permission_code := case
    when v_responsibility = 'current_approver' then 'project.daily_log.approve'
    else 'project.daily_log.verify'
  end;

  if v_effective_status = 'active'
    and not app_private.daily_log_user_can_receive_assignment(
      case when v_scope_type = 'project' then v_scope_id else null end,
      case when v_scope_type = 'construction_site' then v_scope_id else null end,
      v_permission_code,
      v_assignee_user_id
    ) then
      raise exception 'Người được giao chưa có grant % còn hiệu lực trong phạm vi slot.', v_permission_code
        using errcode = '42501';
  end if;

  if v_slot_id is null then
    insert into public.app_responsibility_slots (
      subject_type, responsibility, scope_type, scope_id, assignee_user_id,
      permission_code, priority, status, starts_at, expires_at, metadata, created_by
    )
    values (
      'daily_log', v_responsibility, v_scope_type, v_scope_id, v_assignee_user_id,
      v_permission_code, coalesce((p_slot->>'priority')::integer, 100),
      v_effective_status,
      coalesce(nullif(p_slot->>'starts_at', '')::timestamptz, now()),
      nullif(p_slot->>'expires_at', '')::timestamptz,
      coalesce(p_slot->'metadata', '{}'::jsonb), v_actor_user_id
    )
    returning id into v_result_id;
  else
    update public.app_responsibility_slots
    set responsibility = v_responsibility,
        scope_type = v_scope_type,
        scope_id = v_scope_id,
        assignee_user_id = v_assignee_user_id,
        permission_code = v_permission_code,
        priority = coalesce((p_slot->>'priority')::integer, priority),
        status = v_effective_status,
        starts_at = coalesce(nullif(p_slot->>'starts_at', '')::timestamptz, starts_at),
        expires_at = case when p_slot ? 'expires_at' then nullif(p_slot->>'expires_at', '')::timestamptz else expires_at end,
        metadata = coalesce(p_slot->'metadata', metadata),
        updated_at = now()
    where id = v_slot_id
      and subject_type = 'daily_log'
    returning id into v_result_id;

  end if;

  insert into public.app_responsibility_slot_events (
    responsibility_slot_id,
    event_type,
    actor_user_id,
    before_data,
    after_data
  )
  select
    v_result_id,
    case when v_previous_slot is null then 'created' else 'updated' end,
    v_actor_user_id,
    v_previous_slot,
    to_jsonb(slot)
  from public.app_responsibility_slots slot
  where slot.id = v_result_id;

  return v_result_id;
end;
$$;

revoke all on function app_private.upsert_daily_log_responsibility_slot(jsonb) from public, anon, authenticated;

create or replace function public.upsert_daily_log_responsibility_slot(
  p_slot jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app_private.upsert_daily_log_responsibility_slot(p_slot);
$$;

revoke all on function public.upsert_daily_log_responsibility_slot(jsonb) from public, anon;
grant execute on function public.upsert_daily_log_responsibility_slot(jsonb) to authenticated;

create or replace function app_private.daily_log_can_select(
  p_project_id text,
  p_construction_site_id text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.daily_log_has_action(
    p_project_id,
    p_construction_site_id,
    'project.daily_log.view',
    p_user_id
  );
$$;

revoke all on function app_private.daily_log_can_select(text, text, uuid) from public, anon;
grant execute on function app_private.daily_log_can_select(text, text, uuid) to authenticated;

-- The legacy p_requested_verifier_* parameters are retained only for API
-- compatibility. p_requested_verifier_id is ignored: responsibility slots
-- decide the assignee and prevent a submitter from picking a permission peer.
create or replace function public.transition_daily_log_status(
  p_log_id text,
  p_status text,
  p_requested_verifier_id text default null,
  p_requested_verifier_name text default null,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.daily_logs%rowtype;
  v_actor_user_id uuid := public.current_app_user_id();
  v_actor_user_id_text text := public.current_app_user_id()::text;
  v_actor_name text;
  v_assignment_id uuid;
  v_assignment public.app_assignments%rowtype;
  v_owner_user_id uuid;
  v_previous_guard text;
  v_action text;
begin
  if v_actor_user_id is null then
    raise exception 'Không xác định được người dùng đang thao tác.' using errcode = '42501';
  end if;

  if p_status not in ('submitted', 'verified', 'rejected') then
    raise exception 'Trạng thái nhật ký không hợp lệ: %', p_status using errcode = '22023';
  end if;

  select * into v_log from public.daily_logs where id = p_log_id for update;
  if not found then
    raise exception 'Không tìm thấy nhật ký công trường.' using errcode = 'P0002';
  end if;

  select coalesce(name, username, email, id::text)
  into v_actor_name
  from public.users
  where id = v_actor_user_id;

  v_action := case
    when p_status = 'submitted' then 'submit'
    when p_status = 'verified' and coalesce(v_log.submitted_to_permission, '') = 'approve' then 'approve'
    when p_status = 'verified' then 'verify'
    else 'return'
  end;

  if not app_private.can_act_on_subject_impl('daily_log', p_log_id, v_action) then
    raise exception 'Bạn không có assignment, grant hoặc trạng thái workflow hợp lệ để % nhật ký này.', v_action
      using errcode = '42501';
  end if;

  if p_status = 'rejected' and nullif(btrim(coalesce(p_rejection_reason, '')), '') is null then
    raise exception 'Vui lòng nhập lý do trả lại nhật ký.' using errcode = '22023';
  end if;

  v_previous_guard := current_setting('app.daily_log_transition_context', true);
  perform set_config('app.daily_log_transition_context', 'on', true);

  if p_status = 'submitted' then
    update public.daily_logs
    set status = 'submitted',
        verified = false,
        submitted_by = v_actor_user_id_text,
        submitted_by_id = v_actor_user_id_text,
        submitted_at = now(),
        requested_verifier_id = null,
        requested_verifier_name = null,
        submitted_to_user_id = null,
        submitted_to_name = null,
        submitted_to_permission = case when coalesce(submitted_to_permission, '') = 'approve' then 'approve' else 'verify' end,
        submission_note = null,
        ever_submitted = true,
        rejected_by = null,
        rejected_by_id = null,
        rejected_at = null,
        rejection_reason = null,
        last_action_by = v_actor_user_id_text,
        last_action_at = now()
    where id = p_log_id;

    v_assignment_id := app_private.create_daily_log_assignment(p_log_id, v_actor_user_id);
    select * into v_assignment from public.app_assignments where id = v_assignment_id;

    update public.daily_logs
    set requested_verifier_id = v_assignment.principal_id::text,
        requested_verifier_name = (select coalesce(name, username, email, id::text) from public.users where id = v_assignment.principal_id),
        submitted_to_user_id = v_assignment.principal_id::text,
        submitted_to_name = (select coalesce(name, username, email, id::text) from public.users where id = v_assignment.principal_id),
        submitted_to_permission = case when v_assignment.permission_code = 'project.daily_log.approve' then 'approve' else 'verify' end
    where id = p_log_id;
  elsif p_status = 'verified' then
    update public.daily_logs
    set status = 'verified',
        verified = true,
        verified_by = coalesce(v_actor_name, v_actor_user_id_text),
        verified_by_id = v_actor_user_id_text,
        verified_at = now(),
        rejected_by = null,
        rejected_by_id = null,
        rejected_at = null,
        rejection_reason = null,
        last_action_by = v_actor_user_id_text,
        last_action_at = now()
    where id = p_log_id;

    perform app_private.close_daily_log_assignments(p_log_id, v_actor_user_id, 'completed');
  else
    select owner_user.id
    into v_owner_user_id
    from public.users owner_user
    where owner_user.id::text = coalesce(
      nullif(v_log.created_by_id, ''),
      nullif(v_log.submitted_by_id, ''),
      nullif(v_log.submitted_by, ''),
      nullif(v_log.created_by, '')
    )
    limit 1;

    update public.daily_logs
    set status = 'rejected',
        verified = false,
        rejected_by = coalesce(v_actor_name, v_actor_user_id_text),
        rejected_by_id = v_actor_user_id_text,
        rejected_at = now(),
        rejection_reason = p_rejection_reason,
        submitted_to_user_id = v_owner_user_id::text,
        submitted_to_name = (select coalesce(name, username, email, id::text) from public.users where id = v_owner_user_id),
        submitted_to_permission = 'edit',
        submission_note = p_rejection_reason,
        last_action_by = v_actor_user_id_text,
        last_action_at = now()
    where id = p_log_id;

    perform app_private.close_daily_log_assignments(p_log_id, v_actor_user_id, 'returned');
    perform app_private.create_daily_log_revision_assignment(p_log_id, v_owner_user_id, v_actor_user_id);
  end if;

  perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
exception
  when others then
    perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function public.transition_daily_log_status(text, text, text, text, text) from public, anon;
grant execute on function public.transition_daily_log_status(text, text, text, text, text) to authenticated;

-- Public wrappers above bind the actor from the JWT inside SECURITY DEFINER
-- functions. Never expose helpers that accept a caller/assignee argument: a
-- direct RPC or SQL call must not be able to manufacture an assignment.
revoke all on function app_private.daily_log_user_can_receive_assignment(text, text, text, uuid) from public, anon, authenticated;
revoke all on function app_private.resolve_daily_log_responsibility(text, text, text, text) from public, anon, authenticated;
revoke all on function app_private.daily_log_assignment_is_active(text, uuid, text[], text) from public, anon, authenticated;
revoke all on function app_private.create_daily_log_assignment(text, uuid) from public, anon, authenticated;
revoke all on function app_private.create_daily_log_revision_assignment(text, uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.close_daily_log_assignments(text, uuid, text) from public, anon, authenticated;
revoke all on function app_private.can_view_subject_impl(text, text) from public, anon, authenticated;
revoke all on function app_private.can_act_on_subject_impl(text, text, text) from public, anon, authenticated;
revoke all on function app_private.get_daily_log_responsibility_target(text) from public, anon, authenticated;
revoke all on function app_private.get_daily_log_assignment_context(text) from public, anon, authenticated;
revoke all on function app_private.upsert_daily_log_responsibility_slot(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';

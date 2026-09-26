-- Per-step watchers for the plain Quy trình engine (public.workflow_instances).
--
-- Context: workflow node config already carries `stepWatcherTargets`, and the
-- project-workflow runtime honours it via
-- app_private.project_workflow_insert_assignment_pool -> WATCHER participants.
-- The plain WF engine (process_workflow_instance_fast / reopen_workflow_instance)
-- has no participant table: visibility and notification both key off
-- workflow_instances.watchers. So a stage configured with step watchers silently
-- did nothing there — the builder saved the config and nothing ever read it.
--
-- Fix: when an instance arrives at a node, merge that node's configured step
-- watchers into instances.watchers. A trigger rather than a change to
-- process_workflow_instance_fast, because the same rule must hold for every path
-- that moves current_node_id (approve, revision, reopen, and the project runtime),
-- and because it keeps the existing overloads untouched.
--
-- Merge-only by design: watchers are never removed here. Leaving a stage should
-- not silently revoke visibility from someone who has already commented, and
-- removal stays an explicit act through update_workflow_instance_watchers.

create or replace function app_private.workflow_resolve_step_watchers(p_node_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with targets as (
    select target.value as target
    from public.workflow_nodes wn
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(wn.config -> 'stepWatcherTargets') = 'array'
        then coalesce(wn.config -> 'stepWatcherTargets', '[]'::jsonb)
        else '[]'::jsonb end
    ) target(value)
    where wn.id = p_node_id
  ),
  resolved as (
    -- Explicit users.
    select case when (target ->> 'userId') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (target ->> 'userId')::uuid end as user_id
    from targets
    where coalesce(target ->> 'type', '') = 'user'
      and nullif(target ->> 'userId', '') is not null
      and (target ->> 'userId') ~* '^[0-9a-f-]{36}$'

    union

    -- Department / org-unit pools, resolved the same way the project runtime
    -- resolves them (employees.department_id or employees.org_unit_id).
    select distinct e.user_id
    from targets
    join public.employees e
      on e.user_id is not null
     and coalesce(e.status, 'Đang làm việc') = 'Đang làm việc'
     and (
       e.department_id::text = targets.target ->> 'orgUnitId'
       or e.org_unit_id::text = targets.target ->> 'orgUnitId'
     )
    where coalesce(targets.target ->> 'type', '') = 'department'
      and nullif(targets.target ->> 'orgUnitId', '') is not null
  )
  select coalesce(array_agg(distinct u.id::text), '{}'::text[])
  from resolved
  join public.users u
    on u.id = resolved.user_id
   and u.is_active
   and u.account_status = 'ACTIVE';
$$;

revoke all on function app_private.workflow_resolve_step_watchers(uuid) from public, anon, authenticated, service_role;

comment on function app_private.workflow_resolve_step_watchers(uuid) is
  'Active user ids configured as stepWatcherTargets on a workflow node (users + department members).';

create or replace function app_private.workflow_instance_autotag_step_watchers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step_watchers text[];
begin
  if new.current_node_id is null then
    return new;
  end if;

  -- Only on arrival at a node: either a fresh instance or a stage change.
  if tg_op = 'UPDATE'
     and old.current_node_id is not distinct from new.current_node_id then
    return new;
  end if;

  -- The project runtime resolves watchers from its immutable node snapshot.
  -- Do not introduce live-template watchers into an in-flight project request.
  if exists (select 1 from public.workflow_subjects where workflow_instance_id = new.id) then
    return new;
  end if;

  v_step_watchers := app_private.workflow_resolve_step_watchers(new.current_node_id);

  if coalesce(cardinality(v_step_watchers), 0) = 0 then
    return new;
  end if;

  select coalesce(array_agg(distinct watcher_id), '{}'::text[])
  into new.watchers
  from (
    select unnest(coalesce(new.watchers, '{}'::text[])) as watcher_id
    union
    select unnest(v_step_watchers)
  ) merged;

  return new;
end;
$$;

revoke all on function app_private.workflow_instance_autotag_step_watchers() from public, anon, authenticated, service_role;

comment on function app_private.workflow_instance_autotag_step_watchers() is
  'Merges a node''s configured step watchers into workflow_instances.watchers when the instance arrives at that node. Additive only.';

drop trigger if exists trg_workflow_instance_autotag_step_watchers on public.workflow_instances;

create trigger trg_workflow_instance_autotag_step_watchers
before insert or update of current_node_id on public.workflow_instances
for each row
execute function app_private.workflow_instance_autotag_step_watchers();

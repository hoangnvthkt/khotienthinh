-- Project workflow runtime v3: snapshot + participants + multi-assignee.
-- Scope remains material_request only. Inventory ledger / reservation stays out
-- of this track.

create extension if not exists pgcrypto;
create schema if not exists app_private;

create table if not exists public.workflow_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.workflow_templates(id) on delete cascade,
  version_number integer not null,
  name text not null,
  description text,
  custom_fields jsonb not null default '[]'::jsonb,
  managers text[] not null default '{}'::text[],
  default_watchers text[] not null default '{}'::text[],
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(template_id, version_number)
);

create index if not exists idx_workflow_template_versions_template
  on public.workflow_template_versions(template_id, version_number desc);

create table if not exists public.workflow_instance_nodes (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  template_version_id uuid references public.workflow_template_versions(id) on delete set null,
  template_node_id uuid references public.workflow_nodes(id) on delete set null,
  type public.workflow_node_type not null,
  label text not null,
  config jsonb not null default '{}'::jsonb,
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  created_at timestamptz not null default now(),
  unique(workflow_instance_id, template_node_id)
);

create index if not exists idx_workflow_instance_nodes_instance
  on public.workflow_instance_nodes(workflow_instance_id);

create table if not exists public.workflow_instance_edges (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  template_version_id uuid references public.workflow_template_versions(id) on delete set null,
  template_edge_id uuid references public.workflow_edges(id) on delete set null,
  source_instance_node_id uuid not null references public.workflow_instance_nodes(id) on delete cascade,
  target_instance_node_id uuid not null references public.workflow_instance_nodes(id) on delete cascade,
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_workflow_instance_edges_source
  on public.workflow_instance_edges(workflow_instance_id, source_instance_node_id);

create table if not exists public.workflow_participants (
  id uuid primary key default gen_random_uuid(),
  workflow_subject_id uuid not null references public.workflow_subjects(id) on delete cascade,
  workflow_instance_id uuid references public.workflow_instances(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('ADMIN', 'WATCHER', 'CREATOR', 'ASSIGNEE')),
  source text not null default 'manual',
  source_ref text,
  node_id uuid references public.workflow_nodes(id) on delete set null,
  instance_node_id uuid references public.workflow_instance_nodes(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  is_active boolean not null default true
);

create unique index if not exists ux_workflow_participants_active_role
  on public.workflow_participants(workflow_subject_id, user_id, role, coalesce(node_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active;

create index if not exists idx_workflow_participants_user
  on public.workflow_participants(user_id, role, is_active);

create table if not exists public.project_document_links (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  target_type text not null,
  target_id text not null,
  project_id text references public.projects(id) on delete set null,
  relation_type text not null default 'downstream',
  status text not null default 'active'
    check (status in ('active', 'reversed', 'cancelled', 'returned', 'void')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_type, source_id, target_type, target_id, relation_type)
);

create index if not exists idx_project_document_links_source
  on public.project_document_links(source_type, source_id, status);

create index if not exists idx_project_document_links_target
  on public.project_document_links(target_type, target_id, status);

alter table public.workflow_instances
  add column if not exists template_version_id uuid references public.workflow_template_versions(id) on delete set null,
  add column if not exists current_instance_node_id uuid references public.workflow_instance_nodes(id) on delete set null;

alter table public.workflow_subjects
  add column if not exists template_version_id uuid references public.workflow_template_versions(id) on delete set null,
  add column if not exists current_instance_node_id uuid references public.workflow_instance_nodes(id) on delete set null,
  add column if not exists current_assignee_user_ids uuid[] not null default '{}'::uuid[],
  add column if not exists return_to_assignee_user_ids uuid[] not null default '{}'::uuid[];

alter table public.workflow_step_assignments
  add column if not exists instance_node_id uuid references public.workflow_instance_nodes(id) on delete set null,
  add column if not exists due_at timestamptz,
  add column if not exists sla_hours integer,
  add column if not exists assignment_source text,
  add column if not exists assignment_group_type text,
  add column if not exists assignment_group_id text;

create index if not exists idx_workflow_step_assignments_instance_node_v3
  on public.workflow_step_assignments(workflow_instance_id, instance_node_id, status)
  where instance_node_id is not null;

create index if not exists idx_workflow_subjects_current_pool
  on public.workflow_subjects using gin(current_assignee_user_ids);

drop trigger if exists trg_project_document_links_updated_at on public.project_document_links;
create trigger trg_project_document_links_updated_at
  before update on public.project_document_links
  for each row execute function public.set_project_workflow_updated_at();

create or replace function app_private.project_workflow_distinct_uuid_array(p_ids uuid[])
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct id order by id), '{}'::uuid[])
  from unnest(coalesce(p_ids, '{}'::uuid[])) as ids(id)
  where id is not null;
$$;

create or replace function app_private.project_workflow_first_assignee_name(p_assignee_ids uuid[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_assignee_ids);
  v_first uuid;
  v_first_name text;
  v_count integer;
begin
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    return null;
  end if;

  v_first := v_ids[1];
  select u.name into v_first_name from public.users u where u.id = v_first;
  if v_count = 1 then
    return coalesce(v_first_name, v_first::text);
  end if;
  return coalesce(v_first_name, v_first::text) || ' + ' || (v_count - 1)::text || ' người';
end;
$$;

create or replace function app_private.project_workflow_node_sla_due_at(p_node_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app_private.project_workflow_node_sla_hours(p_node_id) is null then null
    else now() + make_interval(hours => app_private.project_workflow_node_sla_hours(p_node_id))
  end;
$$;

create or replace function app_private.project_workflow_to_coarse_step(
  p_template_id uuid,
  p_node_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_node_id is null then null
    when p_node_id = app_private.project_workflow_first_task_node(p_template_id) then 'site_manager_review'
    else 'material_department_review'
  end;
$$;

create or replace function app_private.project_workflow_register_participant(
  p_workflow_subject_id uuid,
  p_workflow_instance_id uuid,
  p_user_id uuid,
  p_role text,
  p_source text default 'manual',
  p_source_ref text default null,
  p_node_id uuid default null,
  p_instance_node_id uuid default null,
  p_created_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_role not in ('ADMIN', 'WATCHER', 'CREATOR', 'ASSIGNEE') then
    return;
  end if;

  update public.workflow_participants
  set workflow_instance_id = p_workflow_instance_id,
      source = coalesce(nullif(p_source, ''), 'manual'),
      source_ref = p_source_ref,
      instance_node_id = p_instance_node_id,
      created_by = p_created_by,
      is_active = true
  where workflow_subject_id = p_workflow_subject_id
    and user_id = p_user_id
    and role = p_role
    and coalesce(node_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_node_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(is_active, true);

  if not found then
    insert into public.workflow_participants(
      workflow_subject_id,
      workflow_instance_id,
      user_id,
      role,
      source,
      source_ref,
      node_id,
      instance_node_id,
      created_by,
      is_active
    )
    values (
      p_workflow_subject_id,
      p_workflow_instance_id,
      p_user_id,
      p_role,
      coalesce(nullif(p_source, ''), 'manual'),
      p_source_ref,
      p_node_id,
      p_instance_node_id,
      p_created_by,
      true
    );
  end if;
end;
$$;

create or replace function app_private.project_workflow_actor_is_admin(
  p_workflow_subject_id uuid,
  p_actor uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('WF')
    or exists (
      select 1
      from public.workflow_participants wp
      where wp.workflow_subject_id = p_workflow_subject_id
        and wp.user_id = p_actor
        and wp.role = 'ADMIN'
        and coalesce(wp.is_active, true)
    ),
    false
  );
$$;

create or replace function app_private.project_workflow_actor_can_select(
  p_workflow_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.workflow_subject_can_select(p_workflow_subject_id)
    or exists (
      select 1
      from public.workflow_participants wp
      where wp.workflow_subject_id = p_workflow_subject_id
        and wp.user_id = public.current_app_user_id()
        and coalesce(wp.is_active, true)
    ),
    false
  );
$$;

create or replace function app_private.project_workflow_actor_can_act(
  p_workflow_subject_id uuid,
  p_actor uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.project_workflow_actor_is_admin(p_workflow_subject_id, p_actor)
    or exists (
      select 1
      from public.workflow_subjects ws
      join public.workflow_step_assignments wsa
        on wsa.workflow_subject_id = ws.id
       and wsa.workflow_instance_id = ws.workflow_instance_id
       and wsa.node_id = ws.current_node_id
       and wsa.assignee_user_id = p_actor
       and wsa.status = 'PENDING'
      where ws.id = p_workflow_subject_id
        and ws.status = 'RUNNING'
    ),
    false
  );
$$;

create or replace function app_private.project_workflow_assignees_are_eligible(
  p_subject_type text,
  p_subject_id text,
  p_node_id uuid,
  p_assignee_user_ids uuid[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_assignee_user_ids);
  v_id uuid;
begin
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return false;
  end if;

  foreach v_id in array v_ids loop
    if not app_private.project_workflow_assignee_is_eligible(p_subject_type, p_subject_id, p_node_id, v_id) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function app_private.project_workflow_ensure_template_version(
  p_template_id uuid,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.workflow_templates%rowtype;
  v_version_number integer;
  v_version_id uuid;
  v_snapshot jsonb;
begin
  select *
    into v_template
  from public.workflow_templates
  where id = p_template_id;

  if not found then
    raise exception 'workflow template not found: %', p_template_id;
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_version_number
  from public.workflow_template_versions
  where template_id = p_template_id;

  v_snapshot := jsonb_build_object(
    'template', to_jsonb(v_template),
    'nodes', coalesce((
      select jsonb_agg(to_jsonb(wn) order by wn.position_y nulls first, wn.position_x nulls first)
      from public.workflow_nodes wn
      where wn.template_id = p_template_id
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(to_jsonb(we) order by we.id)
      from public.workflow_edges we
      where we.template_id = p_template_id
    ), '[]'::jsonb)
  );

  insert into public.workflow_template_versions(
    template_id,
    version_number,
    name,
    description,
    custom_fields,
    managers,
    default_watchers,
    snapshot,
    created_by
  )
  values (
    p_template_id,
    v_version_number,
    v_template.name,
    v_template.description,
    coalesce(v_template.custom_fields, '[]'::jsonb),
    coalesce(v_template.managers, '{}'::text[]),
    coalesce(v_template.default_watchers, '{}'::text[]),
    v_snapshot,
    p_actor
  )
  returning id into v_version_id;

  return v_version_id;
end;
$$;

create or replace function app_private.project_workflow_snapshot_instance(
  p_workflow_instance_id uuid,
  p_template_version_id uuid,
  p_template_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workflow_instance_nodes(
    workflow_instance_id,
    template_version_id,
    template_node_id,
    type,
    label,
    config,
    position_x,
    position_y
  )
  select
    p_workflow_instance_id,
    p_template_version_id,
    wn.id,
    wn.type,
    wn.label,
    coalesce(wn.config, '{}'::jsonb),
    coalesce(wn.position_x, 0),
    coalesce(wn.position_y, 0)
  from public.workflow_nodes wn
  where wn.template_id = p_template_id
  on conflict (workflow_instance_id, template_node_id) do nothing;

  insert into public.workflow_instance_edges(
    workflow_instance_id,
    template_version_id,
    template_edge_id,
    source_instance_node_id,
    target_instance_node_id,
    label
  )
  select
    p_workflow_instance_id,
    p_template_version_id,
    we.id,
    source_node.id,
    target_node.id,
    we.label
  from public.workflow_edges we
  join public.workflow_instance_nodes source_node
    on source_node.workflow_instance_id = p_workflow_instance_id
   and source_node.template_node_id = we.source_node_id
  join public.workflow_instance_nodes target_node
    on target_node.workflow_instance_id = p_workflow_instance_id
   and target_node.template_node_id = we.target_node_id
  where we.template_id = p_template_id;
end;
$$;

create or replace function app_private.project_workflow_instance_node_for_template(
  p_workflow_instance_id uuid,
  p_template_node_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select win.id
  from public.workflow_instance_nodes win
  where win.workflow_instance_id = p_workflow_instance_id
    and win.template_node_id = p_template_node_id
  limit 1;
$$;

create or replace function app_private.project_workflow_step_assignees_json(
  p_node_id uuid,
  p_assignee_user_ids uuid[]
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_node_id is null then '{}'::jsonb
    else jsonb_build_object(p_node_id::text, to_jsonb(app_private.project_workflow_distinct_uuid_array(p_assignee_user_ids)))
  end;
$$;

create or replace function app_private.project_workflow_insert_assignment_pool(
  p_workflow_subject_id uuid,
  p_workflow_instance_id uuid,
  p_node_id uuid,
  p_instance_node_id uuid,
  p_assignee_user_ids uuid[],
  p_assigned_by uuid,
  p_comment text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_assignment_source text default 'manual',
  p_assignment_group_type text default null,
  p_assignment_group_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_assignee_user_ids);
  v_id uuid;
  v_sla_hours integer := app_private.project_workflow_node_sla_hours(p_node_id);
  v_due_at timestamptz := app_private.project_workflow_node_sla_due_at(p_node_id);
  v_node_config jsonb := '{}'::jsonb;
  v_target jsonb;
  v_watcher_user_id uuid;
begin
  foreach v_id in array v_ids loop
    insert into public.workflow_step_assignments(
      workflow_subject_id,
      workflow_instance_id,
      node_id,
      instance_node_id,
      assignee_user_id,
      assigned_by,
      status,
      assigned_at,
      action_comment,
      metadata,
      due_at,
      sla_hours,
      assignment_source,
      assignment_group_type,
      assignment_group_id
    )
    values (
      p_workflow_subject_id,
      p_workflow_instance_id,
      p_node_id,
      p_instance_node_id,
      v_id,
      p_assigned_by,
      'PENDING',
      now(),
      nullif(coalesce(p_comment, ''), ''),
      coalesce(p_metadata, '{}'::jsonb),
      v_due_at,
      v_sla_hours,
      p_assignment_source,
      p_assignment_group_type,
      p_assignment_group_id
    );

    perform app_private.project_workflow_register_participant(
      p_workflow_subject_id,
      p_workflow_instance_id,
      v_id,
      'ASSIGNEE',
      p_assignment_source,
      p_assignment_group_id,
      p_node_id,
      p_instance_node_id,
      p_assigned_by
    );
  end loop;

  select coalesce(wn.config, '{}'::jsonb)
    into v_node_config
  from public.workflow_nodes wn
  where wn.id = p_node_id;

  for v_target in
    select value
    from jsonb_array_elements(coalesce(v_node_config -> 'stepWatcherTargets', '[]'::jsonb)) as target(value)
  loop
    if coalesce(v_target ->> 'type', '') = 'user' and nullif(v_target ->> 'userId', '') is not null then
      perform app_private.project_workflow_register_participant(
        p_workflow_subject_id,
        p_workflow_instance_id,
        (v_target ->> 'userId')::uuid,
        'WATCHER',
        'step_watcher',
        p_node_id::text,
        p_node_id,
        p_instance_node_id,
        p_assigned_by
      );
    elsif coalesce(v_target ->> 'type', '') = 'department' and nullif(v_target ->> 'orgUnitId', '') is not null then
      for v_watcher_user_id in
        select distinct e.user_id
        from public.employees e
        where e.user_id is not null
          and coalesce(e.status, 'Đang làm việc') = 'Đang làm việc'
          and (
            e.department_id::text = v_target ->> 'orgUnitId'
            or e.org_unit_id::text = v_target ->> 'orgUnitId'
          )
      loop
        perform app_private.project_workflow_register_participant(
          p_workflow_subject_id,
          p_workflow_instance_id,
          v_watcher_user_id,
          'WATCHER',
          'step_watcher_department',
          v_target ->> 'orgUnitId',
          p_node_id,
          p_instance_node_id,
          p_assigned_by
        );
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function app_private.project_workflow_pending_assignee_ids(
  p_workflow_subject_id uuid,
  p_node_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(wsa.assignee_user_id order by wsa.assigned_at, wsa.assignee_user_id), '{}'::uuid[])
  from public.workflow_step_assignments wsa
  where wsa.workflow_subject_id = p_workflow_subject_id
    and wsa.node_id = p_node_id
    and wsa.status = 'PENDING'
    and wsa.assignee_user_id is not null;
$$;

create or replace function public.get_project_workflow_rollback_dependencies(
  p_subject_type text,
  p_subject_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_active_count integer := 0;
begin
  if p_subject_type <> 'material_request' then
    return jsonb_build_object('allowed', false, 'activeCount', 1, 'dependencies', jsonb_build_array(
      jsonb_build_object('type', 'unsupported_subject', 'status', 'active')
    ));
  end if;

  if to_regclass('public.project_document_links') is not null then
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'type', pdl.target_type,
        'id', pdl.target_id,
        'status', pdl.status,
        'relationType', pdl.relation_type,
        'source', 'project_document_links'
      )), '[]'::jsonb),
      count(*) filter (where pdl.status = 'active')
    into v_items, v_active_count
    from public.project_document_links pdl
    where pdl.source_type = p_subject_type
      and pdl.source_id = p_subject_id
      and pdl.relation_type = 'downstream';
  end if;

  if to_regclass('public.material_request_fulfillment_batches') is not null then
    with deps as (
      select
        'fulfillment_batch'::text as type,
        mrfb.id::text as id,
        case
          when lower(coalesce(mrfb.status::text, '')) in ('cancelled', 'canceled', 'returned', 'reversed', 'void')
            then 'reversed'
          else 'active'
        end as status
      from public.material_request_fulfillment_batches mrfb
      where mrfb.material_request_id = p_subject_id
    )
    select
      v_items || coalesce(jsonb_agg(jsonb_build_object('type', type, 'id', id, 'status', status, 'source', 'fulfillment_batches')), '[]'::jsonb),
      v_active_count + count(*) filter (where status = 'active')
    into v_items, v_active_count
    from deps;
  end if;

  if to_regclass('public.purchase_orders') is not null then
    with deps as (
      select distinct
        'purchase_order'::text as type,
        po.id::text as id,
        case
          when lower(coalesce(po.status::text, '')) in ('cancelled', 'canceled', 'reversed', 'void', 'closed')
            then 'reversed'
          else 'active'
        end as status
      from public.purchase_orders po
      where coalesce(po.material_request_id::text, '') = p_subject_id
    )
    select
      v_items || coalesce(jsonb_agg(jsonb_build_object('type', type, 'id', id, 'status', status, 'source', 'purchase_orders')), '[]'::jsonb),
      v_active_count + count(*) filter (where status = 'active')
    into v_items, v_active_count
    from deps;
  end if;

  if to_regclass('public.purchase_order_request_lines') is not null then
    with deps as (
      select distinct
        'purchase_order'::text as type,
        po.id::text as id,
        case
          when lower(coalesce(po.status::text, '')) in ('cancelled', 'canceled', 'reversed', 'void', 'closed')
            then 'reversed'
          else 'active'
        end as status
      from public.purchase_order_request_lines porl
      join public.purchase_orders po
        on po.id = porl.purchase_order_id
      where porl.material_request_id = p_subject_id
    )
    select
      v_items || coalesce(jsonb_agg(jsonb_build_object('type', type, 'id', id, 'status', status, 'source', 'purchase_order_request_lines')), '[]'::jsonb),
      v_active_count + count(*) filter (where status = 'active')
    into v_items, v_active_count
    from deps;
  end if;

  if to_regclass('public.transactions') is not null then
    with deps as (
      select
        'transaction'::text as type,
        t.id::text as id,
        case
          when lower(coalesce(t.status::text, '')) in ('cancelled', 'canceled', 'reversed', 'void')
            then 'reversed'
          else 'active'
        end as status
      from public.transactions t
      where coalesce(t.related_request_id, '') = p_subject_id
         or exists (
           select 1
           from jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) as item(value)
           where coalesce(item.value ->> 'materialRequestId', item.value ->> 'material_request_id') = p_subject_id
         )
    )
    select
      v_items || coalesce(jsonb_agg(jsonb_build_object('type', type, 'id', id, 'status', status, 'source', 'transactions')), '[]'::jsonb),
      v_active_count + count(*) filter (where status = 'active')
    into v_items, v_active_count
    from deps;
  end if;

  return jsonb_build_object(
    'allowed', v_active_count = 0,
    'activeCount', v_active_count,
    'dependencies', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

-- Harden project-workflow RLS around participants.
alter table public.workflow_template_versions enable row level security;
alter table public.workflow_instance_nodes enable row level security;
alter table public.workflow_instance_edges enable row level security;
alter table public.workflow_participants enable row level security;
alter table public.project_document_links enable row level security;

drop policy if exists workflow_subjects_select on public.workflow_subjects;
create policy workflow_subjects_select
  on public.workflow_subjects
  for select
  to authenticated
  using (app_private.project_workflow_actor_can_select(id));

drop policy if exists workflow_subjects_update on public.workflow_subjects;
create policy workflow_subjects_update
  on public.workflow_subjects
  for update
  to authenticated
  using (
    app_private.project_workflow_actor_can_act(id, public.current_app_user_id())
    or app_private.project_workflow_actor_is_admin(id, public.current_app_user_id())
  )
  with check (
    app_private.project_workflow_actor_can_act(id, public.current_app_user_id())
    or app_private.project_workflow_actor_is_admin(id, public.current_app_user_id())
  );

drop policy if exists workflow_step_assignments_select on public.workflow_step_assignments;
create policy workflow_step_assignments_select
  on public.workflow_step_assignments
  for select
  to authenticated
  using (app_private.project_workflow_actor_can_select(workflow_subject_id));

drop policy if exists workflow_step_assignments_insert on public.workflow_step_assignments;
create policy workflow_step_assignments_insert
  on public.workflow_step_assignments
  for insert
  to authenticated
  with check (
    app_private.project_workflow_actor_can_act(workflow_subject_id, public.current_app_user_id())
    or app_private.project_workflow_actor_is_admin(workflow_subject_id, public.current_app_user_id())
  );

drop policy if exists workflow_step_assignments_update on public.workflow_step_assignments;
create policy workflow_step_assignments_update
  on public.workflow_step_assignments
  for update
  to authenticated
  using (
    app_private.project_workflow_actor_can_act(workflow_subject_id, public.current_app_user_id())
    or app_private.project_workflow_actor_is_admin(workflow_subject_id, public.current_app_user_id())
  )
  with check (
    app_private.project_workflow_actor_can_act(workflow_subject_id, public.current_app_user_id())
    or app_private.project_workflow_actor_is_admin(workflow_subject_id, public.current_app_user_id())
  );

drop policy if exists workflow_template_versions_select on public.workflow_template_versions;
create policy workflow_template_versions_select
  on public.workflow_template_versions
  for select
  to authenticated
  using (
    public.is_admin()
    or public.is_module_admin('WF')
    or exists (
      select 1
      from public.workflow_subjects ws
      where ws.template_version_id = workflow_template_versions.id
        and app_private.project_workflow_actor_can_select(ws.id)
    )
  );

drop policy if exists workflow_template_versions_write on public.workflow_template_versions;
create policy workflow_template_versions_write
  on public.workflow_template_versions
  for all
  to authenticated
  using (public.is_admin() or public.is_module_admin('WF'))
  with check (public.is_admin() or public.is_module_admin('WF'));

drop policy if exists workflow_instance_nodes_select on public.workflow_instance_nodes;
create policy workflow_instance_nodes_select
  on public.workflow_instance_nodes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workflow_subjects ws
      where ws.workflow_instance_id = workflow_instance_nodes.workflow_instance_id
        and app_private.project_workflow_actor_can_select(ws.id)
    )
  );

drop policy if exists workflow_instance_nodes_write on public.workflow_instance_nodes;
create policy workflow_instance_nodes_write
  on public.workflow_instance_nodes
  for all
  to authenticated
  using (public.is_admin() or public.is_module_admin('WF'))
  with check (public.is_admin() or public.is_module_admin('WF'));

drop policy if exists workflow_instance_edges_select on public.workflow_instance_edges;
create policy workflow_instance_edges_select
  on public.workflow_instance_edges
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workflow_subjects ws
      where ws.workflow_instance_id = workflow_instance_edges.workflow_instance_id
        and app_private.project_workflow_actor_can_select(ws.id)
    )
  );

drop policy if exists workflow_instance_edges_write on public.workflow_instance_edges;
create policy workflow_instance_edges_write
  on public.workflow_instance_edges
  for all
  to authenticated
  using (public.is_admin() or public.is_module_admin('WF'))
  with check (public.is_admin() or public.is_module_admin('WF'));

drop policy if exists workflow_participants_select on public.workflow_participants;
create policy workflow_participants_select
  on public.workflow_participants
  for select
  to authenticated
  using (app_private.project_workflow_actor_can_select(workflow_subject_id));

drop policy if exists workflow_participants_write on public.workflow_participants;
create policy workflow_participants_write
  on public.workflow_participants
  for all
  to authenticated
  using (app_private.project_workflow_actor_is_admin(workflow_subject_id, public.current_app_user_id()))
  with check (app_private.project_workflow_actor_is_admin(workflow_subject_id, public.current_app_user_id()));

drop policy if exists project_document_links_select on public.project_document_links;
create policy project_document_links_select
  on public.project_document_links
  for select
  to authenticated
  using (
    public.is_admin()
    or public.is_module_admin('WF')
    or exists (
      select 1
      from public.workflow_subjects ws
      where ws.subject_type = project_document_links.source_type
        and ws.subject_id = project_document_links.source_id
        and app_private.project_workflow_actor_can_select(ws.id)
    )
  );

drop policy if exists project_document_links_write on public.project_document_links;
create policy project_document_links_write
  on public.project_document_links
  for all
  to authenticated
  using (public.is_admin() or public.is_module_admin('WF'))
  with check (public.is_admin() or public.is_module_admin('WF'));

revoke all on table public.workflow_template_versions from anon;
revoke all on table public.workflow_template_versions from public;
grant select, insert, update, delete on table public.workflow_template_versions to authenticated;

revoke all on table public.workflow_instance_nodes from anon;
revoke all on table public.workflow_instance_nodes from public;
grant select, insert, update, delete on table public.workflow_instance_nodes to authenticated;

revoke all on table public.workflow_instance_edges from anon;
revoke all on table public.workflow_instance_edges from public;
grant select, insert, update, delete on table public.workflow_instance_edges to authenticated;

revoke all on table public.workflow_participants from anon;
revoke all on table public.workflow_participants from public;
grant select, insert, update, delete on table public.workflow_participants to authenticated;

revoke all on table public.project_document_links from anon;
revoke all on table public.project_document_links from public;
grant select, insert, update, delete on table public.project_document_links to authenticated;

create or replace function public.start_project_workflow_v2(
  p_subject_type text,
  p_subject_id text,
  p_template_id uuid default null,
  p_first_assignee_user_ids uuid[] default '{}'::uuid[],
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.requests%rowtype;
  v_template_id uuid;
  v_template public.workflow_templates%rowtype;
  v_template_version_id uuid;
  v_start_node_id uuid;
  v_first_node_id uuid;
  v_first_instance_node_id uuid;
  v_instance public.workflow_instances%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_assignee_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_first_assignee_user_ids);
  v_first_assignee uuid;
  v_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_manager text;
  v_watcher text;
  v_next_code text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select *
    into v_request
  from public.requests
  where id = p_subject_id
  for update;

  if not found then
    raise exception 'material request not found: %', p_subject_id;
  end if;

  if not (
    public.is_admin()
    or public.is_module_admin('WF')
    or v_request.requester_id::uuid = v_actor
    or app_private.project_workflow_binding_can_manage(v_request.project_id, v_request.construction_site_id)
  ) then
    raise exception 'user cannot start workflow for this material request';
  end if;

  v_template_id := coalesce(
    p_template_id,
    v_request.workflow_template_id,
    app_private.project_workflow_resolve_template(p_subject_type, v_request.project_id, v_request.construction_site_id)
  );

  if v_template_id is null then
    raise exception 'project workflow binding/template not found';
  end if;

  select *
    into v_template
  from public.workflow_templates
  where id = v_template_id
    and coalesce(is_active, true);

  if not found then
    raise exception 'workflow template is not active: %', v_template_id;
  end if;

  if exists (
    select 1
    from public.workflow_subjects ws
    where ws.subject_type = p_subject_type
      and ws.subject_id = p_subject_id
      and ws.status in ('RUNNING', 'RETURNED')
  ) then
    raise exception 'workflow is already running for this material request';
  end if;

  v_start_node_id := app_private.project_workflow_start_node(v_template_id);
  v_first_node_id := app_private.project_workflow_first_task_node(v_template_id);
  if v_start_node_id is null or v_first_node_id is null then
    raise exception 'workflow template must have START and first task nodes';
  end if;

  if not app_private.project_workflow_assignees_are_eligible(p_subject_type, p_subject_id, v_first_node_id, v_assignee_ids) then
    raise exception 'first assignee pool is not eligible for this workflow step';
  end if;

  v_first_assignee := v_assignee_ids[1];
  v_assignee_name := app_private.project_workflow_first_assignee_name(v_assignee_ids);
  v_sla_hours := app_private.project_workflow_node_sla_hours(v_first_node_id);
  v_due_at := app_private.project_workflow_node_sla_due_at(v_first_node_id);
  v_template_version_id := app_private.project_workflow_ensure_template_version(v_template_id, v_actor);

  v_next_code := public.next_workflow_code();

  insert into public.workflow_instances(
    template_id,
    code,
    title,
    created_by,
    current_node_id,
    status,
    form_data,
    watchers,
    step_assignees,
    template_version_id
  )
  values (
    v_template_id,
    v_next_code,
    coalesce(v_request.code, 'MR') || ' - Đề xuất vật tư',
    v_actor,
    v_first_node_id,
    'RUNNING'::public.workflow_instance_status,
    jsonb_build_object('subjectType', p_subject_type, 'subjectId', p_subject_id),
    coalesce(v_template.default_watchers, '{}'::text[]),
    app_private.project_workflow_step_assignees_json(v_first_node_id, v_assignee_ids),
    v_template_version_id
  )
  returning * into v_instance;

  perform app_private.project_workflow_snapshot_instance(v_instance.id, v_template_version_id, v_template_id);
  v_first_instance_node_id := app_private.project_workflow_instance_node_for_template(v_instance.id, v_first_node_id);

  update public.workflow_instances
  set current_instance_node_id = v_first_instance_node_id,
      updated_at = now()
  where id = v_instance.id
  returning * into v_instance;

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_instance.id, v_start_node_id, 'SUBMITTED'::public.workflow_instance_action, v_actor, coalesce(p_comment, ''));

  insert into public.workflow_subjects(
    workflow_instance_id,
    subject_type,
    subject_id,
    project_id,
    construction_site_id,
    current_assignee_user_id,
    current_assignee_user_ids,
    current_node_id,
    current_instance_node_id,
    template_version_id,
    status,
    created_by
  )
  values (
    v_instance.id,
    p_subject_type,
    p_subject_id,
    v_request.project_id,
    v_request.construction_site_id,
    v_first_assignee,
    v_assignee_ids,
    v_first_node_id,
    v_first_instance_node_id,
    v_template_version_id,
    'RUNNING',
    v_actor
  )
  on conflict (subject_type, subject_id) do update
  set workflow_instance_id = excluded.workflow_instance_id,
      project_id = excluded.project_id,
      construction_site_id = excluded.construction_site_id,
      current_assignee_user_id = excluded.current_assignee_user_id,
      current_assignee_user_ids = excluded.current_assignee_user_ids,
      current_node_id = excluded.current_node_id,
      current_instance_node_id = excluded.current_instance_node_id,
      template_version_id = excluded.template_version_id,
      status = excluded.status,
      updated_at = now()
  returning * into v_subject;

  perform app_private.project_workflow_register_participant(v_subject.id, v_instance.id, v_actor, 'CREATOR', 'requester', p_subject_id, null, null, v_actor);

  foreach v_manager in array coalesce(v_template.managers, '{}'::text[]) loop
    if nullif(v_manager, '') is not null then
      perform app_private.project_workflow_register_participant(v_subject.id, v_instance.id, v_manager::uuid, 'ADMIN', 'template_manager', v_template_id::text, null, null, v_actor);
    end if;
  end loop;

  foreach v_watcher in array coalesce(v_template.default_watchers, '{}'::text[]) loop
    if nullif(v_watcher, '') is not null then
      perform app_private.project_workflow_register_participant(v_subject.id, v_instance.id, v_watcher::uuid, 'WATCHER', 'template_watcher', v_template_id::text, null, null, v_actor);
    end if;
  end loop;

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id,
    v_instance.id,
    v_first_node_id,
    v_first_instance_node_id,
    v_assignee_ids,
    v_actor,
    p_comment,
    jsonb_build_object('submitted', true, 'approvalPolicy', 'ANY_ONE'),
    'start'
  );

  update public.requests
  set status = 'PENDING'::public.request_status,
      submitted_to_user_id = v_first_assignee::text,
      submitted_to_name = v_assignee_name,
      submitted_to_permission = app_private.project_workflow_node_primary_permission(v_first_node_id),
      submission_note = nullif(coalesce(p_comment, ''), ''),
      ever_submitted = true,
      last_action_by = v_actor,
      last_action_at = now(),
      workflow_step = 'site_manager_review',
      workflow_step_started_at = now(),
      workflow_step_due_at = v_due_at,
      workflow_step_sla_hours = v_sla_hours,
      workflow_step_actor_user_id = v_actor::text,
      workflow_instance_id = v_instance.id,
      workflow_subject_id = v_subject.id,
      workflow_template_id = v_template_id
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id,
    project_id,
    from_step,
    to_step,
    action,
    actor_user_id,
    target_user_id,
    target_permission,
    note,
    sla_hours,
    due_at,
    metadata
  )
  values (
    p_subject_id,
    v_request.project_id,
    coalesce(v_request.workflow_step, 'draft'),
    'site_manager_review',
    'SUBMITTED',
    v_actor::text,
    v_first_assignee::text,
    app_private.project_workflow_node_primary_permission(v_first_node_id),
    nullif(coalesce(p_comment, ''), ''),
    v_sla_hours,
    v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_instance.id,
      'workflowSubjectId', v_subject.id,
      'templateVersionId', v_template_version_id,
      'toNodeId', v_first_node_id,
      'assigneeUserIds', v_assignee_ids
    )
  );

  return v_subject;
end;
$$;

create or replace function public.advance_project_workflow_v2(
  p_subject_type text,
  p_subject_id text,
  p_next_assignee_user_ids uuid[] default '{}'::uuid[],
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_request public.requests%rowtype;
  v_current_node public.workflow_nodes%rowtype;
  v_next_node public.workflow_nodes%rowtype;
  v_next_instance_node_id uuid;
  v_next_assignee_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_next_assignee_user_ids);
  v_first_next_assignee uuid;
  v_next_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_to_step text;
  v_dependency jsonb;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select *
    into v_subject
  from public.workflow_subjects
  where subject_type = p_subject_type
    and subject_id = p_subject_id
  for update;

  if not found then
    raise exception 'workflow subject not found';
  end if;

  select *
    into v_request
  from public.requests
  where id = p_subject_id
  for update;

  if not found then
    raise exception 'material request not found: %', p_subject_id;
  end if;

  if v_subject.status <> 'RUNNING' then
    raise exception 'workflow subject is not running';
  end if;

  if not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user is not assigned to current workflow step';
  end if;

  select *
    into v_current_node
  from public.workflow_nodes
  where id = v_subject.current_node_id;

  if not found then
    raise exception 'current workflow node not found';
  end if;

  select n.*
    into v_next_node
  from public.workflow_edges e
  join public.workflow_nodes n
    on n.id = e.target_node_id
  where e.source_node_id = v_subject.current_node_id
  order by n.position_y nulls last, n.position_x nulls last
  limit 1;

  if not found then
    raise exception 'next workflow node not found';
  end if;

  update public.workflow_step_assignments
  set status = 'APPROVED',
      acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), ''),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('approvedByUserId', v_actor, 'approvalPolicy', 'ANY_ONE')
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and node_id = v_subject.current_node_id
    and assignee_user_id = v_actor
    and status = 'PENDING';

  update public.workflow_step_assignments
  set status = 'SKIPPED',
      acted_at = now(),
      action_comment = 'Skipped because another assignee approved this step',
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('skippedByPolicy', 'ANY_ONE', 'approvedByUserId', v_actor)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and node_id = v_subject.current_node_id
    and status = 'PENDING';

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (
    v_subject.workflow_instance_id,
    v_subject.current_node_id,
    'APPROVED'::public.workflow_instance_action,
    v_actor,
    coalesce(p_comment, '')
  );

  v_next_instance_node_id := app_private.project_workflow_instance_node_for_template(v_subject.workflow_instance_id, v_next_node.id);

  if v_next_node.type = 'END'::public.workflow_node_type then
    v_dependency := public.get_project_workflow_rollback_dependencies(p_subject_type, p_subject_id);

    update public.workflow_instances
    set current_node_id = v_next_node.id,
        current_instance_node_id = v_next_instance_node_id,
        status = 'COMPLETED'::public.workflow_instance_status,
        updated_at = now()
    where id = v_subject.workflow_instance_id;

    update public.workflow_subjects
    set current_assignee_user_id = null,
        current_assignee_user_ids = '{}'::uuid[],
        current_node_id = v_next_node.id,
        current_instance_node_id = v_next_instance_node_id,
        status = 'COMPLETED',
        updated_at = now()
    where id = v_subject.id
    returning * into v_subject;

    update public.requests
    set status = 'APPROVED'::public.request_status,
        submitted_to_user_id = null,
        submitted_to_name = null,
        submitted_to_permission = null,
        submission_note = nullif(coalesce(p_comment, ''), ''),
        last_action_by = v_actor,
        last_action_at = now(),
        workflow_step = 'batch_planning',
        workflow_step_started_at = now(),
        workflow_step_due_at = null,
        workflow_step_sla_hours = null,
        workflow_step_actor_user_id = v_actor::text
    where id = p_subject_id;

    insert into public.material_request_events(
      request_id,
      project_id,
      from_step,
      to_step,
      action,
      actor_user_id,
      note,
      metadata
    )
    values (
      p_subject_id,
      v_request.project_id,
      coalesce(v_request.workflow_step, 'material_department_review'),
      'batch_planning',
      'APPROVED',
      v_actor::text,
      nullif(coalesce(p_comment, ''), ''),
      jsonb_build_object(
        'workflowInstanceId', v_subject.workflow_instance_id,
        'workflowSubjectId', v_subject.id,
        'toNodeId', v_next_node.id,
        'rollbackDependencies', v_dependency
      )
    );

    return v_subject;
  end if;

  if not app_private.project_workflow_assignees_are_eligible(p_subject_type, p_subject_id, v_next_node.id, v_next_assignee_ids) then
    raise exception 'next assignee pool is not eligible for this workflow step';
  end if;

  v_first_next_assignee := v_next_assignee_ids[1];
  v_next_assignee_name := app_private.project_workflow_first_assignee_name(v_next_assignee_ids);
  v_sla_hours := app_private.project_workflow_node_sla_hours(v_next_node.id);
  v_due_at := app_private.project_workflow_node_sla_due_at(v_next_node.id);
  v_to_step := app_private.project_workflow_to_coarse_step(v_request.workflow_template_id, v_next_node.id);

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id,
    v_subject.workflow_instance_id,
    v_next_node.id,
    v_next_instance_node_id,
    v_next_assignee_ids,
    v_actor,
    p_comment,
    jsonb_build_object('approvedFromNodeId', v_subject.current_node_id, 'approvalPolicy', 'ANY_ONE'),
    'transition'
  );

  update public.workflow_instances
  set current_node_id = v_next_node.id,
      current_instance_node_id = v_next_instance_node_id,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || app_private.project_workflow_step_assignees_json(v_next_node.id, v_next_assignee_ids),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_first_next_assignee,
      current_assignee_user_ids = v_next_assignee_ids,
      current_node_id = v_next_node.id,
      current_instance_node_id = v_next_instance_node_id,
      status = 'RUNNING',
      updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'PENDING'::public.request_status,
      submitted_to_user_id = v_first_next_assignee::text,
      submitted_to_name = v_next_assignee_name,
      submitted_to_permission = app_private.project_workflow_node_primary_permission(v_next_node.id),
      submission_note = nullif(coalesce(p_comment, ''), ''),
      last_action_by = v_actor,
      last_action_at = now(),
      workflow_step = v_to_step,
      workflow_step_started_at = now(),
      workflow_step_due_at = v_due_at,
      workflow_step_sla_hours = v_sla_hours,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id,
    project_id,
    from_step,
    to_step,
    action,
    actor_user_id,
    target_user_id,
    target_permission,
    note,
    sla_hours,
    due_at,
    metadata
  )
  values (
    p_subject_id,
    v_request.project_id,
    coalesce(v_request.workflow_step, 'material_department_review'),
    v_to_step,
    'APPROVED',
    v_actor::text,
    v_first_next_assignee::text,
    app_private.project_workflow_node_primary_permission(v_next_node.id),
    nullif(coalesce(p_comment, ''), ''),
    v_sla_hours,
    v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'toNodeId', v_next_node.id,
      'assigneeUserIds', v_next_assignee_ids
    )
  );

  return v_subject;
end;
$$;

create or replace function public.return_project_workflow_v2(
  p_subject_type text,
  p_subject_id text,
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_request public.requests%rowtype;
  v_requester_id uuid;
  v_requester_name text;
  v_return_assignee_ids uuid[];
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;
  if nullif(coalesce(p_comment, ''), '') is null then
    raise exception 'return reason is required';
  end if;

  select *
    into v_subject
  from public.workflow_subjects
  where subject_type = p_subject_type
    and subject_id = p_subject_id
  for update;

  if not found then
    raise exception 'workflow subject not found';
  end if;

  select *
    into v_request
  from public.requests
  where id = p_subject_id
  for update;

  if not found then
    raise exception 'material request not found: %', p_subject_id;
  end if;

  if v_subject.status <> 'RUNNING' then
    raise exception 'workflow subject is not running';
  end if;

  if not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user is not assigned to current workflow step';
  end if;

  v_requester_id := v_request.requester_id::uuid;
  v_return_assignee_ids := app_private.project_workflow_pending_assignee_ids(v_subject.id, v_subject.current_node_id);

  update public.workflow_step_assignments
  set status = case when assignee_user_id = v_actor then 'RETURNED' else 'SKIPPED' end,
      acted_at = now(),
      action_comment = p_comment,
      return_to_node_id = v_subject.current_node_id,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'returnedToCreator', true,
          'returnedByUserId', v_actor,
          'returnToNodeId', v_subject.current_node_id,
          'returnToAssigneeUserIds', v_return_assignee_ids
        )
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and node_id = v_subject.current_node_id
    and status = 'PENDING';

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (
    v_subject.workflow_instance_id,
    v_subject.current_node_id,
    'REVISION_REQUESTED'::public.workflow_instance_action,
    v_actor,
    p_comment
  );

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id,
    v_subject.workflow_instance_id,
    v_subject.current_node_id,
    v_subject.current_instance_node_id,
    array[v_requester_id],
    v_actor,
    p_comment,
    jsonb_build_object(
      'returnedToCreator', true,
      'returnToNodeId', v_subject.current_node_id,
      'returnToAssigneeUserIds', v_return_assignee_ids
    ),
    'return_to_creator'
  );

  update public.workflow_instances
  set current_node_id = v_subject.current_node_id,
      current_instance_node_id = v_subject.current_instance_node_id,
      status = 'RUNNING'::public.workflow_instance_status,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || app_private.project_workflow_step_assignees_json(v_subject.current_node_id, array[v_requester_id]),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  select u.name into v_requester_name from public.users u where u.id = v_requester_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_requester_id,
      current_assignee_user_ids = array[v_requester_id],
      status = 'RETURNED',
      return_to_node_id = v_subject.current_node_id,
      return_to_assignee_user_id = v_return_assignee_ids[1],
      return_to_assignee_user_ids = v_return_assignee_ids,
      returned_by_user_id = v_actor,
      returned_at = now(),
      updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'DRAFT'::public.request_status,
      submitted_to_user_id = v_requester_id::text,
      submitted_to_name = v_requester_name,
      submitted_to_permission = 'edit',
      submission_note = p_comment,
      last_action_by = v_actor,
      last_action_at = now(),
      workflow_step = 'returned_to_creator',
      workflow_step_started_at = now(),
      workflow_step_due_at = null,
      workflow_step_sla_hours = null,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id,
    project_id,
    from_step,
    to_step,
    action,
    actor_user_id,
    target_user_id,
    target_permission,
    note,
    metadata
  )
  values (
    p_subject_id,
    v_request.project_id,
    coalesce(v_request.workflow_step, 'material_department_review'),
    'returned_to_creator',
    'RETURNED',
    v_actor::text,
    v_requester_id::text,
    'edit',
    p_comment,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'returnToNodeId', v_subject.return_to_node_id,
      'returnToAssigneeUserIds', v_return_assignee_ids
    )
  );

  return v_subject;
end;
$$;

create or replace function public.resubmit_project_workflow_v2(
  p_subject_type text,
  p_subject_id text,
  p_assignee_user_ids uuid[] default null,
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_request public.requests%rowtype;
  v_target_node_id uuid;
  v_target_instance_node_id uuid;
  v_target_assignee_ids uuid[];
  v_first_assignee uuid;
  v_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_to_step text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select *
    into v_subject
  from public.workflow_subjects
  where subject_type = p_subject_type
    and subject_id = p_subject_id
  for update;

  if not found then
    raise exception 'workflow subject not found';
  end if;

  select *
    into v_request
  from public.requests
  where id = p_subject_id
  for update;

  if not found then
    raise exception 'material request not found: %', p_subject_id;
  end if;

  if v_subject.status <> 'RETURNED' then
    raise exception 'workflow subject is not returned';
  end if;

  if not (
    public.is_admin()
    or public.is_module_admin('WF')
    or v_request.requester_id::uuid = v_actor
    or app_private.project_workflow_actor_is_admin(v_subject.id, v_actor)
  ) then
    raise exception 'only requester or workflow admin can resubmit this material request';
  end if;

  v_target_node_id := coalesce(v_subject.return_to_node_id, v_subject.current_node_id, app_private.project_workflow_first_task_node(v_request.workflow_template_id));
  v_target_instance_node_id := app_private.project_workflow_instance_node_for_template(v_subject.workflow_instance_id, v_target_node_id);
  v_target_assignee_ids := app_private.project_workflow_distinct_uuid_array(coalesce(p_assignee_user_ids, v_subject.return_to_assignee_user_ids));

  if not app_private.project_workflow_assignees_are_eligible(p_subject_type, p_subject_id, v_target_node_id, v_target_assignee_ids) then
    raise exception 'resubmit assignee pool is not eligible for this workflow step';
  end if;

  update public.workflow_step_assignments
  set status = 'APPROVED',
      acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), ''),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('resubmittedByCreator', true)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and assignee_user_id = v_request.requester_id::uuid
    and status = 'PENDING';

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (
    v_subject.workflow_instance_id,
    v_target_node_id,
    'REOPENED'::public.workflow_instance_action,
    v_actor,
    coalesce(p_comment, '')
  );

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id,
    v_subject.workflow_instance_id,
    v_target_node_id,
    v_target_instance_node_id,
    v_target_assignee_ids,
    v_actor,
    p_comment,
    jsonb_build_object('resubmitted', true, 'approvalPolicy', 'ANY_ONE'),
    'resubmit'
  );

  v_first_assignee := v_target_assignee_ids[1];
  v_assignee_name := app_private.project_workflow_first_assignee_name(v_target_assignee_ids);
  v_sla_hours := app_private.project_workflow_node_sla_hours(v_target_node_id);
  v_due_at := app_private.project_workflow_node_sla_due_at(v_target_node_id);
  v_to_step := app_private.project_workflow_to_coarse_step(v_request.workflow_template_id, v_target_node_id);

  update public.workflow_instances
  set current_node_id = v_target_node_id,
      current_instance_node_id = v_target_instance_node_id,
      status = 'RUNNING'::public.workflow_instance_status,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || app_private.project_workflow_step_assignees_json(v_target_node_id, v_target_assignee_ids),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_first_assignee,
      current_assignee_user_ids = v_target_assignee_ids,
      current_node_id = v_target_node_id,
      current_instance_node_id = v_target_instance_node_id,
      status = 'RUNNING',
      return_to_node_id = null,
      return_to_assignee_user_id = null,
      return_to_assignee_user_ids = '{}'::uuid[],
      returned_by_user_id = null,
      returned_at = null,
      updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'PENDING'::public.request_status,
      submitted_to_user_id = v_first_assignee::text,
      submitted_to_name = v_assignee_name,
      submitted_to_permission = app_private.project_workflow_node_primary_permission(v_target_node_id),
      submission_note = nullif(coalesce(p_comment, ''), ''),
      ever_submitted = true,
      last_action_by = v_actor,
      last_action_at = now(),
      workflow_step = v_to_step,
      workflow_step_started_at = now(),
      workflow_step_due_at = v_due_at,
      workflow_step_sla_hours = v_sla_hours,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id,
    project_id,
    from_step,
    to_step,
    action,
    actor_user_id,
    target_user_id,
    target_permission,
    note,
    sla_hours,
    due_at,
    metadata
  )
  values (
    p_subject_id,
    v_request.project_id,
    coalesce(v_request.workflow_step, 'returned_to_creator'),
    v_to_step,
    'RESUBMITTED',
    v_actor::text,
    v_first_assignee::text,
    app_private.project_workflow_node_primary_permission(v_target_node_id),
    nullif(coalesce(p_comment, ''), ''),
    v_sla_hours,
    v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'toNodeId', v_target_node_id,
      'assigneeUserIds', v_target_assignee_ids
    )
  );

  return v_subject;
end;
$$;

create or replace function public.reassign_project_workflow_v2(
  p_subject_type text,
  p_subject_id text,
  p_new_assignee_user_ids uuid[],
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_request public.requests%rowtype;
  v_node public.workflow_nodes%rowtype;
  v_new_assignee_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_new_assignee_user_ids);
  v_first_assignee uuid;
  v_assignee_name text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select *
    into v_subject
  from public.workflow_subjects
  where subject_type = p_subject_type
    and subject_id = p_subject_id
  for update;

  if not found then
    raise exception 'workflow subject not found';
  end if;

  select *
    into v_request
  from public.requests
  where id = p_subject_id
  for update;

  if not found then
    raise exception 'material request not found: %', p_subject_id;
  end if;

  if v_subject.status <> 'RUNNING' then
    raise exception 'workflow subject is not running';
  end if;

  if not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user cannot reassign this workflow step';
  end if;

  select *
    into v_node
  from public.workflow_nodes
  where id = v_subject.current_node_id;

  if not found or v_node.type = 'END'::public.workflow_node_type then
    raise exception 'current workflow node cannot be reassigned';
  end if;

  if coalesce((v_node.config ->> 'allowReassign')::boolean, true) = false then
    raise exception 'workflow step does not allow reassign';
  end if;

  if not app_private.project_workflow_assignees_are_eligible(p_subject_type, p_subject_id, v_subject.current_node_id, v_new_assignee_ids) then
    raise exception 'new assignee pool is not eligible for this workflow step';
  end if;

  update public.workflow_step_assignments
  set status = 'SKIPPED',
      acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), ''),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('reassignedToUserIds', v_new_assignee_ids)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and node_id = v_subject.current_node_id
    and status = 'PENDING';

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id,
    v_subject.workflow_instance_id,
    v_subject.current_node_id,
    v_subject.current_instance_node_id,
    v_new_assignee_ids,
    v_actor,
    p_comment,
    jsonb_build_object('reassigned', true, 'fromAssigneeUserIds', v_subject.current_assignee_user_ids),
    'reassign'
  );

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (
    v_subject.workflow_instance_id,
    v_subject.current_node_id,
    'REOPENED'::public.workflow_instance_action,
    v_actor,
    coalesce(nullif(p_comment, ''), 'Reassigned workflow step')
  );

  v_first_assignee := v_new_assignee_ids[1];
  v_assignee_name := app_private.project_workflow_first_assignee_name(v_new_assignee_ids);

  update public.workflow_instances
  set step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || app_private.project_workflow_step_assignees_json(v_subject.current_node_id, v_new_assignee_ids),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_first_assignee,
      current_assignee_user_ids = v_new_assignee_ids,
      updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set submitted_to_user_id = v_first_assignee::text,
      submitted_to_name = v_assignee_name,
      submitted_to_permission = app_private.project_workflow_node_primary_permission(v_subject.current_node_id),
      submission_note = nullif(coalesce(p_comment, ''), ''),
      last_action_by = v_actor,
      last_action_at = now(),
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id,
    project_id,
    from_step,
    to_step,
    action,
    actor_user_id,
    target_user_id,
    target_permission,
    note,
    metadata
  )
  values (
    p_subject_id,
    v_request.project_id,
    coalesce(v_request.workflow_step, 'material_department_review'),
    coalesce(v_request.workflow_step, 'material_department_review'),
    'REASSIGNED',
    v_actor::text,
    v_first_assignee::text,
    app_private.project_workflow_node_primary_permission(v_subject.current_node_id),
    nullif(coalesce(p_comment, ''), ''),
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'nodeId', v_subject.current_node_id,
      'fromAssigneeUserIds', v_subject.current_assignee_user_ids,
      'assigneeUserIds', v_new_assignee_ids
    )
  );

  return v_subject;
end;
$$;

create or replace function public.reject_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_request public.requests%rowtype;
  v_dependency jsonb;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;
  if nullif(coalesce(p_comment, ''), '') is null then
    raise exception 'reject reason is required';
  end if;

  select *
    into v_subject
  from public.workflow_subjects
  where subject_type = p_subject_type
    and subject_id = p_subject_id
  for update;

  if not found then
    raise exception 'workflow subject not found';
  end if;

  select *
    into v_request
  from public.requests
  where id = p_subject_id
  for update;

  if not found then
    raise exception 'material request not found: %', p_subject_id;
  end if;

  if v_subject.status not in ('RUNNING', 'RETURNED', 'COMPLETED') then
    raise exception 'workflow subject cannot be rejected from current status';
  end if;

  if not (
    app_private.project_workflow_actor_can_act(v_subject.id, v_actor)
    or app_private.project_workflow_actor_is_admin(v_subject.id, v_actor)
  ) then
    raise exception 'user is not allowed to reject this workflow';
  end if;

  v_dependency := public.get_project_workflow_rollback_dependencies(p_subject_type, p_subject_id);
  if coalesce((v_dependency ->> 'allowed')::boolean, false) = false then
    raise exception 'rollback/reject is locked by active downstream dependencies: %', v_dependency;
  end if;

  update public.workflow_step_assignments
  set status = case when assignee_user_id = v_actor then 'REJECTED' else 'SKIPPED' end,
      acted_at = now(),
      action_comment = p_comment,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('rejectedByUserId', v_actor)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and node_id = v_subject.current_node_id
    and status = 'PENDING';

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (
    v_subject.workflow_instance_id,
    v_subject.current_node_id,
    'REJECTED'::public.workflow_instance_action,
    v_actor,
    p_comment
  );

  update public.workflow_instances
  set status = 'REJECTED'::public.workflow_instance_status,
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  update public.workflow_subjects
  set current_assignee_user_id = null,
      current_assignee_user_ids = '{}'::uuid[],
      status = 'REJECTED',
      updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'REJECTED'::public.request_status,
      submitted_to_user_id = null,
      submitted_to_name = null,
      submitted_to_permission = null,
      submission_note = p_comment,
      last_action_by = v_actor,
      last_action_at = now(),
      workflow_step = 'rejected',
      workflow_step_started_at = now(),
      workflow_step_due_at = null,
      workflow_step_sla_hours = null,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id,
    project_id,
    from_step,
    to_step,
    action,
    actor_user_id,
    note,
    metadata
  )
  values (
    p_subject_id,
    v_request.project_id,
    coalesce(v_request.workflow_step, 'material_department_review'),
    'rejected',
    'REJECTED',
    v_actor::text,
    p_comment,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'rollbackDependencies', v_dependency
    )
  );

  return v_subject;
end;
$$;

create or replace function public.return_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_comment text default ''
)
returns public.workflow_subjects
language sql
security definer
set search_path = ''
as $$
  select public.return_project_workflow_v2(p_subject_type, p_subject_id, p_comment);
$$;

create or replace function public.start_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_template_id uuid default null,
  p_first_assignee_user_id uuid default null,
  p_comment text default ''
)
returns public.workflow_subjects
language sql
security definer
set search_path = ''
as $$
  select public.start_project_workflow_v2(
    p_subject_type,
    p_subject_id,
    p_template_id,
    case when p_first_assignee_user_id is null then '{}'::uuid[] else array[p_first_assignee_user_id] end,
    p_comment
  );
$$;

create or replace function public.advance_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_next_assignee_user_id uuid default null,
  p_comment text default ''
)
returns public.workflow_subjects
language sql
security definer
set search_path = ''
as $$
  select public.advance_project_workflow_v2(
    p_subject_type,
    p_subject_id,
    case when p_next_assignee_user_id is null then '{}'::uuid[] else array[p_next_assignee_user_id] end,
    p_comment
  );
$$;

create or replace function public.resubmit_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_assignee_user_id uuid default null,
  p_comment text default ''
)
returns public.workflow_subjects
language sql
security definer
set search_path = ''
as $$
  select public.resubmit_project_workflow_v2(
    p_subject_type,
    p_subject_id,
    case when p_assignee_user_id is null then null else array[p_assignee_user_id] end,
    p_comment
  );
$$;

create or replace function public.reassign_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_new_assignee_user_id uuid,
  p_comment text default ''
)
returns public.workflow_subjects
language sql
security definer
set search_path = ''
as $$
  select public.reassign_project_workflow_v2(
    p_subject_type,
    p_subject_id,
    array[p_new_assignee_user_id],
    p_comment
  );
$$;

revoke execute on function public.start_project_workflow_v2(text, text, uuid, uuid[], text) from anon;
revoke execute on function public.start_project_workflow_v2(text, text, uuid, uuid[], text) from public;
grant execute on function public.start_project_workflow_v2(text, text, uuid, uuid[], text) to authenticated;

revoke execute on function public.advance_project_workflow_v2(text, text, uuid[], text) from anon;
revoke execute on function public.advance_project_workflow_v2(text, text, uuid[], text) from public;
grant execute on function public.advance_project_workflow_v2(text, text, uuid[], text) to authenticated;

revoke execute on function public.return_project_workflow_v2(text, text, text) from anon;
revoke execute on function public.return_project_workflow_v2(text, text, text) from public;
grant execute on function public.return_project_workflow_v2(text, text, text) to authenticated;

revoke execute on function public.resubmit_project_workflow_v2(text, text, uuid[], text) from anon;
revoke execute on function public.resubmit_project_workflow_v2(text, text, uuid[], text) from public;
grant execute on function public.resubmit_project_workflow_v2(text, text, uuid[], text) to authenticated;

revoke execute on function public.reassign_project_workflow_v2(text, text, uuid[], text) from anon;
revoke execute on function public.reassign_project_workflow_v2(text, text, uuid[], text) from public;
grant execute on function public.reassign_project_workflow_v2(text, text, uuid[], text) to authenticated;

revoke execute on function public.get_project_workflow_rollback_dependencies(text, text) from anon;
revoke execute on function public.get_project_workflow_rollback_dependencies(text, text) from public;
grant execute on function public.get_project_workflow_rollback_dependencies(text, text) to authenticated;

notify pgrst, 'reload schema';

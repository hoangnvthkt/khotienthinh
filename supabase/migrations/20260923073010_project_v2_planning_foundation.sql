-- Project V2 is an opt-in workspace over the existing project identity.
-- No project or workspace is enrolled by this migration.
create table public.project_v2_workspaces (
  id uuid primary key default gen_random_uuid(),
  project_id text not null unique references public.projects(id),
  primary_construction_site_id uuid references public.hrm_construction_sites(id),
  lifecycle text not null default 'pilot' check (lifecycle in ('pilot', 'active', 'archived')),
  version bigint not null default 1 check (version > 0),
  enrolled_by uuid not null references public.users(id),
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_v2_crews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.project_v2_workspaces(id),
  name text not null check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table public.project_v2_crew_members (
  crew_id uuid not null references public.project_v2_crews(id),
  user_id uuid not null references public.users(id),
  joined_on date not null,
  left_on date,
  primary key (crew_id, user_id, joined_on),
  check (left_on is null or left_on >= joined_on)
);

create table public.project_v2_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.project_v2_workspaces(id),
  plan_type text not null check (plan_type in ('month', 'construction', 'material')),
  code text not null check (length(btrim(code)) > 0),
  title text not null check (length(btrim(title)) > 0),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'returned', 'approved', 'superseded', 'cancelled')),
  period_start date not null,
  period_end date not null,
  owner_user_id uuid references public.users(id),
  follower_user_id uuid references public.users(id),
  creator_user_id uuid not null references public.users(id),
  submitter_user_id uuid references public.users(id),
  approver_user_id uuid references public.users(id),
  approved_at timestamptz,
  version bigint not null default 1 check (version > 0),
  revision_no integer not null default 1 check (revision_no > 0),
  predecessor_revision_no integer,
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, plan_type, code),
  unique (id, revision_no),
  unique (id, plan_type),
  check (period_end >= period_start),
  check (predecessor_revision_no is null or predecessor_revision_no < revision_no),
  check (status <> 'approved' or (approver_user_id is not null and approved_at is not null and content_hash is not null)),
  check (approver_user_id is null or (approver_user_id <> creator_user_id and approver_user_id is distinct from submitter_user_id))
);

create table public.project_v2_plan_lines (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.project_v2_plans(id),
  revision_no integer not null,
  plan_type text not null check (plan_type in ('month', 'construction', 'material')),
  sort_order integer not null default 0,
  contract_item_id uuid references public.contract_items(id),
  baseline_revision text,
  work_item_id text,
  inventory_item_id text references public.items(id),
  unit text,
  quantity numeric(20,6),
  unit_price_snapshot numeric(20,6),
  currency text,
  work_start date,
  work_end date,
  crew_id uuid references public.project_v2_crews(id),
  needed_date date,
  destination_id text,
  baseline_exception_reason text,
  note text,
  foreign key (plan_id, plan_type) references public.project_v2_plans(id, plan_type),
  unique (id, revision_no),
  unique (id, plan_id, revision_no),
  check (quantity is null or quantity >= 0),
  check (work_end is null or work_start is null or work_end >= work_start),
  check (
    (plan_type = 'month' and work_item_id is null and inventory_item_id is null
      and (contract_item_id is not null or baseline_revision is not null))
    or (plan_type = 'construction' and inventory_item_id is null and work_item_id is not null)
    or (plan_type = 'material' and inventory_item_id is not null)
  )
);

create table public.project_v2_plan_line_sources (
  id uuid primary key default gen_random_uuid(),
  target_line_id uuid not null references public.project_v2_plan_lines(id),
  source_plan_id uuid references public.project_v2_plans(id),
  source_plan_revision_no integer,
  source_plan_line_id uuid references public.project_v2_plan_lines(id),
  source_plan_hash text,
  source_work_quantity numeric(20,6),
  source_unit text,
  norm_resource_id text,
  norm_revision text,
  norm_factor numeric(20,6),
  coefficient numeric(20,6),
  conversion_numerator numeric(20,6),
  conversion_denominator numeric(20,6),
  derived_quantity numeric(20,6),
  created_at timestamptz not null default now(),
  foreign key (source_plan_line_id, source_plan_id, source_plan_revision_no)
    references public.project_v2_plan_lines(id, plan_id, revision_no),
  check ((source_plan_id is null and source_plan_line_id is null and source_plan_revision_no is null)
      or (source_plan_id is not null and source_plan_line_id is not null and source_plan_revision_no is not null and source_plan_hash is not null)),
  check (source_work_quantity is null or source_work_quantity >= 0),
  check (norm_factor is null or norm_factor >= 0),
  check (coefficient is null or coefficient >= 0),
  check (conversion_numerator is null or conversion_numerator > 0),
  check (conversion_denominator is null or conversion_denominator > 0),
  check (derived_quantity is null or derived_quantity >= 0)
);

create table public.project_v2_plan_revisions (
  plan_id uuid not null references public.project_v2_plans(id),
  revision_no integer not null,
  predecessor_revision_no integer,
  content_hash text not null,
  approved_snapshot jsonb not null,
  approved_by uuid not null references public.users(id),
  approved_at timestamptz not null default now(),
  primary key (plan_id, revision_no)
);

alter table public.project_v2_plan_line_sources
  add constraint project_v2_source_approved_revision_fk
  foreign key (source_plan_id, source_plan_revision_no)
  references public.project_v2_plan_revisions(plan_id, revision_no);

create table public.project_v2_plan_comments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.project_v2_plans(id),
  revision_no integer not null,
  author_user_id uuid not null references public.users(id),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  check (revision_no > 0)
);

create table public.project_v2_plan_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.project_v2_plans(id),
  revision_no integer not null,
  event_type text not null,
  actor_user_id uuid not null references public.users(id),
  reason text,
  payload jsonb not null default '{}'::jsonb,
  command_id uuid,
  occurred_at timestamptz not null default now(),
  check (revision_no > 0)
);

create table app_private.project_v2_commands (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.users(id),
  workspace_id uuid not null references public.project_v2_workspaces(id),
  operation text not null,
  idempotency_key text not null,
  payload_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (actor_user_id, workspace_id, operation, idempotency_key)
);

create index project_v2_plans_list_idx on public.project_v2_plans(workspace_id, plan_type, status, created_at desc, id desc);
create index project_v2_plan_lines_plan_idx on public.project_v2_plan_lines(plan_id, revision_no, sort_order, id);
create index project_v2_plan_line_sources_source_idx on public.project_v2_plan_line_sources(source_plan_id, source_plan_revision_no, source_plan_line_id);
create index project_v2_plan_line_sources_target_idx on public.project_v2_plan_line_sources(target_line_id);
create index project_v2_plan_events_plan_idx on public.project_v2_plan_events(plan_id, occurred_at desc, id desc);

alter table public.project_v2_workspaces enable row level security;
alter table public.project_v2_crews enable row level security;
alter table public.project_v2_crew_members enable row level security;
alter table public.project_v2_plans enable row level security;
alter table public.project_v2_plan_lines enable row level security;
alter table public.project_v2_plan_line_sources enable row level security;
alter table public.project_v2_plan_revisions enable row level security;
alter table public.project_v2_plan_comments enable row level security;
alter table public.project_v2_plan_events enable row level security;
alter table app_private.project_v2_commands enable row level security;

revoke all on public.project_v2_workspaces from public, anon, authenticated;
revoke all on public.project_v2_crews from public, anon, authenticated;
revoke all on public.project_v2_crew_members from public, anon, authenticated;
revoke all on public.project_v2_plans from public, anon, authenticated;
revoke all on public.project_v2_plan_lines from public, anon, authenticated;
revoke all on public.project_v2_plan_line_sources from public, anon, authenticated;
revoke all on public.project_v2_plan_revisions from public, anon, authenticated;
revoke all on public.project_v2_plan_comments from public, anon, authenticated;
revoke all on public.project_v2_plan_events from public, anon, authenticated;
revoke all on app_private.project_v2_commands from public, anon, authenticated;

create or replace function app_private.project_v2_plan_revision_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'PROJECT_V2_APPROVED_REVISION_IMMUTABLE';
end;
$$;
create trigger project_v2_plan_revision_immutable
before update or delete on public.project_v2_plan_revisions
for each row execute function app_private.project_v2_plan_revision_immutable();
create trigger project_v2_plan_event_immutable
before update or delete on public.project_v2_plan_events
for each row execute function app_private.project_v2_plan_revision_immutable();
revoke all on function app_private.project_v2_plan_revision_immutable() from public, anon, authenticated;

create or replace function app_private.project_v2_plan_capabilities(
  p_project_id text, p_site_id text, p_plan_type text, p_actor uuid
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'view', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.view', p_actor),
    'create', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.create', p_actor),
    'edit', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.edit_all', p_actor),
    'submit', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.submit', p_actor),
    'approve', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.approve', p_actor)
  );
$$;
revoke all on function app_private.project_v2_plan_capabilities(text, text, text, uuid) from public, anon, authenticated;

-- Public RPCs are reviewed SECURITY DEFINER wrappers because direct table
-- privileges are revoked. Every wrapper resolves the session actor itself.
create or replace function public.activate_project_v2_workspace_v1(
  p_project_id text, p_primary_construction_site_id uuid, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_workspace public.project_v2_workspaces%rowtype;
begin
  if not public.is_admin() or v_actor is null then
    raise exception using errcode = '42501', message = 'PROJECT_V2_ACTIVATION_DENIED';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'PROJECT_V2_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id
    and (p_primary_construction_site_id is null or p.construction_site_id = p_primary_construction_site_id)) then
    raise exception using errcode = '22023', message = 'PROJECT_V2_INVALID_PROJECT_OR_SITE';
  end if;
  insert into public.project_v2_workspaces(project_id, primary_construction_site_id, enrolled_by)
  values (p_project_id, p_primary_construction_site_id, v_actor)
  on conflict (project_id) do nothing;
  select * into v_workspace from public.project_v2_workspaces where project_id = p_project_id;
  if v_workspace.primary_construction_site_id is distinct from p_primary_construction_site_id
    or v_workspace.lifecycle = 'archived' then
    raise exception using errcode = '23505', message = 'PROJECT_V2_WORKSPACE_CONFLICT';
  end if;
  return jsonb_build_object('id', v_workspace.id, 'projectId', v_workspace.project_id,
    'lifecycle', v_workspace.lifecycle, 'version', v_workspace.version);
end;
$$;

create or replace function public.list_project_v2_workspaces_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  with actor as (select public.current_app_user_id() as id),
  visible as (
    select w.id, w.project_id, w.primary_construction_site_id, w.lifecycle, w.version,
      p.name as project_name
    from public.project_v2_workspaces w
    join public.projects p on p.id = w.project_id
    cross join actor a
    where a.id is not null and w.lifecycle <> 'archived'
      and (app_private.project_has_permission_v2(w.project_id, w.primary_construction_site_id::text,
        'project.v2_month_plan.view', a.id)
        or app_private.project_has_permission_v2(w.project_id, w.primary_construction_site_id::text,
          'project.v2_construction_plan.view', a.id)
        or app_private.project_has_permission_v2(w.project_id, w.primary_construction_site_id::text,
          'project.v2_material_plan.view', a.id))
  )
  select jsonb_build_object('asOf', now(), 'workspaces', coalesce(jsonb_agg(to_jsonb(visible) order by project_name, id), '[]'::jsonb))
  from visible;
$$;

create or replace function public.list_project_v2_plans_v1(
  p_workspace_id uuid, p_plan_type text default null, p_status text default null,
  p_limit integer default 30, p_before_created_at timestamptz default null,
  p_before_id uuid default null, p_snapshot_token timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_workspace public.project_v2_workspaces%rowtype;
  v_data jsonb;
  v_snapshot timestamptz;
begin
  select * into v_workspace from public.project_v2_workspaces where id = p_workspace_id and lifecycle <> 'archived';
  if v_actor is null or v_workspace.id is null then
    raise exception using errcode = '42501', message = 'PROJECT_V2_READ_DENIED';
  end if;
  if p_plan_type is not null and p_plan_type not in ('month', 'construction', 'material') then
    raise exception using errcode = '22023', message = 'PROJECT_V2_INVALID_FILTER';
  end if;
  if p_status is not null and p_status not in ('draft', 'pending_approval', 'returned', 'approved', 'superseded', 'cancelled') then
    raise exception using errcode = '22023', message = 'PROJECT_V2_INVALID_FILTER';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or (p_before_created_at is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'PROJECT_V2_INVALID_PAGE';
  end if;
  if not (app_private.project_has_permission_v2(v_workspace.project_id, v_workspace.primary_construction_site_id::text,
    'project.v2_month_plan.view', v_actor)
    or app_private.project_has_permission_v2(v_workspace.project_id, v_workspace.primary_construction_site_id::text,
      'project.v2_construction_plan.view', v_actor)
    or app_private.project_has_permission_v2(v_workspace.project_id, v_workspace.primary_construction_site_id::text,
      'project.v2_material_plan.view', v_actor)) then
    raise exception using errcode = '42501', message = 'PROJECT_V2_READ_DENIED';
  end if;
  select max(p.updated_at) into v_snapshot
  from public.project_v2_plans p
  where p.workspace_id = p_workspace_id
    and (p_plan_type is null or p.plan_type = p_plan_type)
    and (p_status is null or p.status = p_status)
    and app_private.project_has_permission_v2(v_workspace.project_id,
      v_workspace.primary_construction_site_id::text,
      'project.v2_' || p.plan_type || '_plan.view', v_actor);
  if p_snapshot_token is not null and p_snapshot_token is distinct from v_snapshot then
    raise exception using errcode = '40001', message = 'PROJECT_V2_SNAPSHOT_STALE';
  end if;
  with scoped as (
    select p.* from public.project_v2_plans p
    where p.workspace_id = p_workspace_id and (p_plan_type is null or p.plan_type = p_plan_type)
      and (p_status is null or p.status = p_status)
      and app_private.project_has_permission_v2(v_workspace.project_id,
        v_workspace.primary_construction_site_id::text, 'project.v2_' || p.plan_type || '_plan.view', v_actor)
  ), page as (
    select * from scoped p
    where p_before_created_at is null or (p.created_at, p.id) < (p_before_created_at, p_before_id)
    order by p.created_at desc, p.id desc limit p_limit
  )
  select jsonb_build_object('asOf', now(), 'snapshotToken', max(s.updated_at),
    'totalCount', count(distinct s.id),
    'statusCounts', coalesce((select jsonb_object_agg(status, count) from
      (select status, count(*) as count from scoped group by status) counters), '{}'::jsonb),
    'capabilities', jsonb_build_object(
      'month', app_private.project_v2_plan_capabilities(v_workspace.project_id, v_workspace.primary_construction_site_id::text, 'month', v_actor),
      'construction', app_private.project_v2_plan_capabilities(v_workspace.project_id, v_workspace.primary_construction_site_id::text, 'construction', v_actor),
      'material', app_private.project_v2_plan_capabilities(v_workspace.project_id, v_workspace.primary_construction_site_id::text, 'material', v_actor)),
    'plans', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc) from page), '[]'::jsonb))
  into v_data from scoped s;
  return v_data;
end;
$$;

create or replace function public.get_project_v2_plan_v1(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_v2_plans%rowtype;
  v_workspace public.project_v2_workspaces%rowtype;
begin
  select * into v_plan from public.project_v2_plans where id = p_plan_id;
  select * into v_workspace from public.project_v2_workspaces where id = v_plan.workspace_id and lifecycle <> 'archived';
  if v_actor is null or v_workspace.id is null or not app_private.project_has_permission_v2(
    v_workspace.project_id, v_workspace.primary_construction_site_id::text,
    'project.v2_' || v_plan.plan_type || '_plan.view', v_actor) then
    raise exception using errcode = '42501', message = 'PROJECT_V2_READ_DENIED';
  end if;
  return jsonb_build_object('asOf', now(), 'plan', to_jsonb(v_plan),
    'capabilities', app_private.project_v2_plan_capabilities(v_workspace.project_id,
      v_workspace.primary_construction_site_id::text, v_plan.plan_type, v_actor),
    'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order, l.id)
      from public.project_v2_plan_lines l where l.plan_id = v_plan.id and l.revision_no = v_plan.revision_no), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.id)
      from public.project_v2_plan_line_sources s
      join public.project_v2_plan_lines l on l.id = s.target_line_id
      where l.plan_id = v_plan.id and l.revision_no = v_plan.revision_no), '[]'::jsonb));
end;
$$;

revoke all on function public.activate_project_v2_workspace_v1(text, uuid, text) from public, anon, authenticated;
revoke all on function public.list_project_v2_workspaces_v1() from public, anon, authenticated;
revoke all on function public.list_project_v2_plans_v1(uuid, text, text, integer, timestamptz, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_project_v2_plan_v1(uuid) from public, anon, authenticated;
grant execute on function public.activate_project_v2_workspace_v1(text, uuid, text) to authenticated;
grant execute on function public.list_project_v2_workspaces_v1() to authenticated;
grant execute on function public.list_project_v2_plans_v1(uuid, text, text, integer, timestamptz, uuid, timestamptz) to authenticated;
grant execute on function public.get_project_v2_plan_v1(uuid) to authenticated;

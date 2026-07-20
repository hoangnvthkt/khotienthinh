-- Dynamic project workflow adapter, v1.
-- Scope: material requests only. Inventory/WMS ledger logic is intentionally
-- untouched in this phase.

create extension if not exists pgcrypto;
create schema if not exists app_private;

alter table if exists public.requests
  add column if not exists workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  add column if not exists workflow_subject_id uuid,
  add column if not exists workflow_template_id uuid references public.workflow_templates(id) on delete set null;

create table if not exists public.workflow_subjects (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  subject_type text not null check (subject_type in ('material_request')),
  subject_id text not null,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  current_assignee_user_id uuid references public.users(id) on delete set null,
  current_node_id uuid references public.workflow_nodes(id) on delete set null,
  status text not null default 'RUNNING'
    check (status in ('RUNNING', 'RETURNED', 'COMPLETED', 'REJECTED', 'CANCELLED')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workflow_subjects
  add column if not exists workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  add column if not exists subject_type text,
  add column if not exists subject_id text,
  add column if not exists project_id text references public.projects(id) on delete set null,
  add column if not exists construction_site_id text,
  add column if not exists current_assignee_user_id uuid references public.users(id) on delete set null,
  add column if not exists current_node_id uuid references public.workflow_nodes(id) on delete set null,
  add column if not exists status text not null default 'RUNNING',
  add column if not exists created_by uuid references public.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_workflow_subjects_subject
  on public.workflow_subjects(subject_type, subject_id);

create index if not exists idx_workflow_subjects_instance
  on public.workflow_subjects(workflow_instance_id)
  where workflow_instance_id is not null;

create index if not exists idx_workflow_subjects_assignee
  on public.workflow_subjects(current_assignee_user_id, status, updated_at desc)
  where current_assignee_user_id is not null;

create index if not exists idx_workflow_subjects_project
  on public.workflow_subjects(project_id, subject_type, updated_at desc)
  where project_id is not null;

create table if not exists public.workflow_step_assignments (
  id uuid primary key default gen_random_uuid(),
  workflow_subject_id uuid not null references public.workflow_subjects(id) on delete cascade,
  workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  node_id uuid references public.workflow_nodes(id) on delete set null,
  assignee_user_id uuid references public.users(id) on delete set null,
  assigned_by uuid references public.users(id) on delete set null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'RETURNED', 'REJECTED', 'SKIPPED')),
  assigned_at timestamptz not null default now(),
  acted_at timestamptz,
  action_comment text,
  return_to_node_id uuid references public.workflow_nodes(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_workflow_step_assignments_subject
  on public.workflow_step_assignments(workflow_subject_id, assigned_at desc);

create index if not exists idx_workflow_step_assignments_instance_node
  on public.workflow_step_assignments(workflow_instance_id, node_id, status);

create index if not exists idx_workflow_step_assignments_assignee
  on public.workflow_step_assignments(assignee_user_id, status, assigned_at desc)
  where assignee_user_id is not null;

create table if not exists public.project_workflow_bindings (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('material_request')),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  workflow_template_id uuid not null references public.workflow_templates(id) on delete cascade,
  is_default boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_workflow_bindings_lookup
  on public.project_workflow_bindings(subject_type, project_id, construction_site_id, is_active, is_default);

create unique index if not exists ux_project_workflow_bindings_default_scope
  on public.project_workflow_bindings(
    subject_type,
    coalesce(project_id, ''),
    coalesce(construction_site_id, '')
  )
  where is_default and is_active;

alter table public.requests
  drop constraint if exists requests_workflow_subject_id_fkey;

alter table public.requests
  add constraint requests_workflow_subject_id_fkey
  foreign key (workflow_subject_id) references public.workflow_subjects(id) on delete set null;

create index if not exists idx_requests_workflow_instance
  on public.requests(workflow_instance_id)
  where workflow_instance_id is not null;

create index if not exists idx_requests_workflow_subject
  on public.requests(workflow_subject_id)
  where workflow_subject_id is not null;

create or replace function public.set_project_workflow_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_workflow_subjects_updated_at on public.workflow_subjects;
create trigger trg_workflow_subjects_updated_at
  before update on public.workflow_subjects
  for each row execute function public.set_project_workflow_updated_at();

drop trigger if exists trg_project_workflow_bindings_updated_at on public.project_workflow_bindings;
create trigger trg_project_workflow_bindings_updated_at
  before update on public.project_workflow_bindings
  for each row execute function public.set_project_workflow_updated_at();

create or replace function app_private.workflow_subject_can_select(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workflow_subjects ws
    join public.requests r
      on ws.subject_type = 'material_request'
     and r.id = ws.subject_id
    where ws.id = p_subject_id
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

create or replace function app_private.workflow_subject_can_mutate(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workflow_subjects ws
    where ws.id = p_subject_id
      and (
        public.is_admin()
        or public.is_module_admin('WF')
        or ws.current_assignee_user_id = public.current_app_user_id()
      )
  );
$$;

create or replace function app_private.project_workflow_binding_can_manage(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('WF')
    or (
      p_project_id is not null
      and (
        app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit')
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'approve')
      )
    );
$$;

create or replace function app_private.project_workflow_first_task_node(p_template_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.target_node_id
  from public.workflow_nodes start_node
  join public.workflow_edges e
    on e.source_node_id = start_node.id
  join public.workflow_nodes target_node
    on target_node.id = e.target_node_id
  where start_node.template_id = p_template_id
    and start_node.type = 'START'::public.workflow_node_type
    and target_node.type <> 'END'::public.workflow_node_type
  order by target_node.position_y nulls last
  limit 1;
$$;

create or replace function app_private.project_workflow_start_node(p_template_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.workflow_nodes
  where template_id = p_template_id
    and type = 'START'::public.workflow_node_type
  order by position_y nulls first
  limit 1;
$$;

create or replace function app_private.project_workflow_node_primary_permission(p_node_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select value
      from jsonb_array_elements_text(coalesce(wn.config -> 'eligiblePermissionCodes', '[]'::jsonb)) as code(value)
      limit 1
    ),
    nullif(wn.config ->> 'eligiblePermissionCode', ''),
    nullif(wn.config ->> 'requiredPermissionCode', ''),
    nullif(wn.config ->> 'assigneePermissionCode', '')
  )
  from public.workflow_nodes wn
  where wn.id = p_node_id;
$$;

create or replace function app_private.project_workflow_node_sla_hours(p_node_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(wn.config ->> 'slaHours', '')::integer
  from public.workflow_nodes wn
  where wn.id = p_node_id
    and (wn.config ->> 'slaHours') ~ '^[0-9]+$';
$$;

create or replace function app_private.project_workflow_assignee_is_eligible(
  p_subject_type text,
  p_subject_id text,
  p_node_id uuid,
  p_assignee_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_node public.workflow_nodes%rowtype;
  v_request public.requests%rowtype;
  v_mode text;
  v_fixed_user text;
  v_role text;
  v_code_count integer := 0;
begin
  if p_subject_type <> 'material_request' or p_assignee_user_id is null then
    return false;
  end if;

  select *
    into v_node
  from public.workflow_nodes
  where id = p_node_id;

  if not found or v_node.type = 'END'::public.workflow_node_type then
    return false;
  end if;

  select *
    into v_request
  from public.requests
  where id = p_subject_id;

  if not found then
    return false;
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = p_assignee_user_id
      and coalesce(u.is_active, true)
  ) then
    return false;
  end if;

  v_mode := coalesce(nullif(v_node.config ->> 'assignmentMode', ''), 'select_on_transition');
  v_fixed_user := nullif(v_node.config ->> 'assigneeUserId', '');
  v_role := nullif(v_node.config ->> 'assigneeRole', '');

  if v_fixed_user is not null then
    return v_fixed_user = p_assignee_user_id::text;
  end if;

  if v_mode = 'creator' then
    return v_request.requester_id = p_assignee_user_id;
  end if;

  if v_role is not null and not exists (
    select 1
    from public.users u
    where u.id = p_assignee_user_id
      and u.role::text = v_role
      and coalesce(u.is_active, true)
  ) then
    return false;
  end if;

  select count(*)
    into v_code_count
  from jsonb_array_elements_text(coalesce(v_node.config -> 'eligiblePermissionCodes', '[]'::jsonb)) as code(value);

  if v_code_count > 0 then
    return public.is_admin()
      or exists (
        select 1
        from public.project_staff ps
        join public.project_staff_permissions psp
          on psp.staff_id = ps.id
         and coalesce(psp.is_active, true)
        join public.project_permission_types ppt
          on ppt.id = psp.permission_type_id
         and coalesce(ppt.is_active, true)
        join jsonb_array_elements_text(coalesce(v_node.config -> 'eligiblePermissionCodes', '[]'::jsonb)) as code(value)
          on code.value = ppt.code
        where ps.user_id::text = p_assignee_user_id::text
          and ps.end_date is null
          and (
            (v_request.project_id is not null and ps.project_id::text = v_request.project_id)
            or (v_request.construction_site_id is not null and ps.construction_site_id::text = v_request.construction_site_id)
          )
      );
  end if;

  return true;
end;
$$;

create or replace function app_private.project_workflow_resolve_template(
  p_subject_type text,
  p_project_id text,
  p_construction_site_id text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pwb.workflow_template_id
  from public.project_workflow_bindings pwb
  join public.workflow_templates wt
    on wt.id = pwb.workflow_template_id
   and coalesce(wt.is_active, true)
  where pwb.subject_type = p_subject_type
    and coalesce(pwb.is_active, true)
    and coalesce(pwb.is_default, true)
    and (
      (p_construction_site_id is not null and pwb.construction_site_id = p_construction_site_id)
      or (p_project_id is not null and pwb.project_id = p_project_id and pwb.construction_site_id is null)
      or (pwb.project_id is null and pwb.construction_site_id is null)
    )
  order by case
    when p_construction_site_id is not null and pwb.construction_site_id = p_construction_site_id then 1
    when p_project_id is not null and pwb.project_id = p_project_id and pwb.construction_site_id is null then 2
    else 3
  end
  limit 1;
$$;

alter table public.workflow_subjects enable row level security;
alter table public.workflow_step_assignments enable row level security;
alter table public.project_workflow_bindings enable row level security;

drop policy if exists workflow_subjects_select on public.workflow_subjects;
drop policy if exists workflow_subjects_insert on public.workflow_subjects;
drop policy if exists workflow_subjects_update on public.workflow_subjects;
drop policy if exists workflow_subjects_delete on public.workflow_subjects;

create policy workflow_subjects_select
  on public.workflow_subjects
  for select
  to authenticated
  using (app_private.workflow_subject_can_select(id));

create policy workflow_subjects_insert
  on public.workflow_subjects
  for insert
  to authenticated
  with check (
    public.is_admin()
    or public.is_module_admin('WF')
    or app_private.project_workflow_binding_can_manage(project_id, construction_site_id)
  );

create policy workflow_subjects_update
  on public.workflow_subjects
  for update
  to authenticated
  using (app_private.workflow_subject_can_mutate(id))
  with check (app_private.workflow_subject_can_mutate(id));

create policy workflow_subjects_delete
  on public.workflow_subjects
  for delete
  to authenticated
  using (public.is_admin() or public.is_module_admin('WF'));

drop policy if exists workflow_step_assignments_select on public.workflow_step_assignments;
drop policy if exists workflow_step_assignments_insert on public.workflow_step_assignments;
drop policy if exists workflow_step_assignments_update on public.workflow_step_assignments;
drop policy if exists workflow_step_assignments_delete on public.workflow_step_assignments;

create policy workflow_step_assignments_select
  on public.workflow_step_assignments
  for select
  to authenticated
  using (app_private.workflow_subject_can_select(workflow_subject_id));

create policy workflow_step_assignments_insert
  on public.workflow_step_assignments
  for insert
  to authenticated
  with check (app_private.workflow_subject_can_mutate(workflow_subject_id));

create policy workflow_step_assignments_update
  on public.workflow_step_assignments
  for update
  to authenticated
  using (app_private.workflow_subject_can_mutate(workflow_subject_id))
  with check (app_private.workflow_subject_can_mutate(workflow_subject_id));

create policy workflow_step_assignments_delete
  on public.workflow_step_assignments
  for delete
  to authenticated
  using (public.is_admin() or public.is_module_admin('WF'));

drop policy if exists project_workflow_bindings_select on public.project_workflow_bindings;
drop policy if exists project_workflow_bindings_insert on public.project_workflow_bindings;
drop policy if exists project_workflow_bindings_update on public.project_workflow_bindings;
drop policy if exists project_workflow_bindings_delete on public.project_workflow_bindings;

create policy project_workflow_bindings_select
  on public.project_workflow_bindings
  for select
  to authenticated
  using (true);

create policy project_workflow_bindings_insert
  on public.project_workflow_bindings
  for insert
  to authenticated
  with check (app_private.project_workflow_binding_can_manage(project_id, construction_site_id));

create policy project_workflow_bindings_update
  on public.project_workflow_bindings
  for update
  to authenticated
  using (app_private.project_workflow_binding_can_manage(project_id, construction_site_id))
  with check (app_private.project_workflow_binding_can_manage(project_id, construction_site_id));

create policy project_workflow_bindings_delete
  on public.project_workflow_bindings
  for delete
  to authenticated
  using (app_private.project_workflow_binding_can_manage(project_id, construction_site_id));

revoke all on table public.workflow_subjects from anon;
revoke all on table public.workflow_subjects from public;
revoke all on table public.workflow_subjects from authenticated;
grant select, insert, update, delete on table public.workflow_subjects to authenticated;

revoke all on table public.workflow_step_assignments from anon;
revoke all on table public.workflow_step_assignments from public;
revoke all on table public.workflow_step_assignments from authenticated;
grant select, insert, update, delete on table public.workflow_step_assignments to authenticated;

revoke all on table public.project_workflow_bindings from anon;
revoke all on table public.project_workflow_bindings from public;
revoke all on table public.project_workflow_bindings from authenticated;
grant select, insert, update, delete on table public.project_workflow_bindings to authenticated;

create or replace function public.start_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_template_id uuid default null,
  p_first_assignee_user_id uuid default null,
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
  v_template_id uuid := p_template_id;
  v_template public.workflow_templates%rowtype;
  v_start_node_id uuid;
  v_first_node_id uuid;
  v_instance_id uuid;
  v_subject public.workflow_subjects%rowtype;
  v_subject_id uuid;
  v_code text;
  v_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_from_step text;
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

  if coalesce(v_request.request_origin, 'wms') <> 'project' then
    raise exception 'only project material requests can use project workflow';
  end if;

  if not (
    public.is_admin()
    or v_request.requester_id = v_actor
    or app_private.project_user_has_permission(v_request.project_id, v_request.construction_site_id, 'submit')
    or app_private.project_user_has_permission(v_request.project_id, v_request.construction_site_id, 'edit')
  ) then
    raise exception 'user is not allowed to submit this material request';
  end if;

  v_template_id := coalesce(
    v_template_id,
    app_private.project_workflow_resolve_template(p_subject_type, v_request.project_id, v_request.construction_site_id)
  );

  if v_template_id is null then
    raise exception 'no workflow template binding found for material request';
  end if;

  select *
    into v_template
  from public.workflow_templates
  where id = v_template_id
    and coalesce(is_active, true);

  if not found then
    raise exception 'workflow template not found or inactive: %', v_template_id;
  end if;

  v_start_node_id := app_private.project_workflow_start_node(v_template_id);
  v_first_node_id := app_private.project_workflow_first_task_node(v_template_id);

  if v_start_node_id is null or v_first_node_id is null then
    raise exception 'workflow template must have START and first task node';
  end if;

  if p_first_assignee_user_id is null then
    raise exception 'first assignee is required';
  end if;

  if not app_private.project_workflow_assignee_is_eligible(p_subject_type, p_subject_id, v_first_node_id, p_first_assignee_user_id) then
    raise exception 'first assignee is not eligible for this workflow step';
  end if;

  select *
    into v_subject
  from public.workflow_subjects
  where subject_type = p_subject_type
    and subject_id = p_subject_id
  for update;

  if found and v_subject.status = 'COMPLETED' then
    raise exception 'workflow for this material request is already completed';
  end if;

  if found and v_subject.status = 'RUNNING' and coalesce(v_request.workflow_step, '') <> 'returned_to_creator' then
    raise exception 'workflow for this material request is already running';
  end if;

  if found and v_subject.workflow_instance_id is not null then
    update public.workflow_instances
    set status = 'CANCELLED'::public.workflow_instance_status,
        updated_at = now()
    where id = v_subject.workflow_instance_id
      and status = 'RUNNING'::public.workflow_instance_status;
  end if;

  v_code := public.next_workflow_code();

  insert into public.workflow_instances(
    template_id,
    code,
    title,
    created_by,
    current_node_id,
    status,
    form_data,
    watchers,
    step_assignees
  )
  values (
    v_template_id,
    v_code,
    coalesce(v_request.code, p_subject_id),
    v_actor,
    v_first_node_id,
    'RUNNING'::public.workflow_instance_status,
    jsonb_build_object('subjectType', p_subject_type, 'subjectId', p_subject_id, 'requestCode', v_request.code),
    coalesce(v_template.default_watchers, '{}'::text[]),
    jsonb_build_object(v_first_node_id::text, p_first_assignee_user_id::text)
  )
  returning id into v_instance_id;

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_instance_id, v_start_node_id, 'SUBMITTED'::public.workflow_instance_action, v_actor, coalesce(p_comment, ''));

  if v_subject.id is null then
    insert into public.workflow_subjects(
      workflow_instance_id,
      subject_type,
      subject_id,
      project_id,
      construction_site_id,
      current_assignee_user_id,
      current_node_id,
      status,
      created_by
    )
    values (
      v_instance_id,
      p_subject_type,
      p_subject_id,
      v_request.project_id,
      v_request.construction_site_id,
      p_first_assignee_user_id,
      v_first_node_id,
      'RUNNING',
      v_actor
    )
    returning * into v_subject;
  else
    update public.workflow_subjects
    set workflow_instance_id = v_instance_id,
        project_id = v_request.project_id,
        construction_site_id = v_request.construction_site_id,
        current_assignee_user_id = p_first_assignee_user_id,
        current_node_id = v_first_node_id,
        status = 'RUNNING',
        updated_at = now()
    where id = v_subject.id
    returning * into v_subject;
  end if;

  update public.workflow_step_assignments
  set status = 'SKIPPED',
      acted_at = now(),
      action_comment = coalesce(action_comment, 'Restarted workflow')
  where workflow_subject_id = v_subject.id
    and status = 'PENDING';

  insert into public.workflow_step_assignments(
    workflow_subject_id,
    workflow_instance_id,
    node_id,
    assignee_user_id,
    assigned_by,
    status,
    action_comment
  )
  values (
    v_subject.id,
    v_instance_id,
    v_first_node_id,
    p_first_assignee_user_id,
    v_actor,
    'PENDING',
    p_comment
  );

  select u.name
    into v_assignee_name
  from public.users u
  where u.id = p_first_assignee_user_id;

  v_sla_hours := app_private.project_workflow_node_sla_hours(v_first_node_id);
  v_due_at := case
    when v_sla_hours is null then null
    else now() + make_interval(hours => v_sla_hours)
  end;
  v_from_step := coalesce(v_request.workflow_step, 'draft');

  update public.requests
  set status = 'PENDING'::public.request_status,
      workflow_instance_id = v_instance_id,
      workflow_subject_id = v_subject.id,
      workflow_template_id = v_template_id,
      submitted_to_user_id = p_first_assignee_user_id::text,
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
    v_from_step,
    'site_manager_review',
    'SUBMITTED',
    v_actor::text,
    p_first_assignee_user_id::text,
    app_private.project_workflow_node_primary_permission(v_first_node_id),
    nullif(coalesce(p_comment, ''), ''),
    v_sla_hours,
    v_due_at,
    jsonb_build_object('workflowInstanceId', v_instance_id, 'workflowSubjectId', v_subject.id, 'nodeId', v_first_node_id)
  );

  return v_subject;
end;
$$;

create or replace function public.advance_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_next_assignee_user_id uuid default null,
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
  v_processed record;
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

  if v_subject.status <> 'RUNNING' then
    raise exception 'workflow subject is not running';
  end if;

  if not (
    public.is_admin()
    or public.is_module_admin('WF')
    or v_subject.current_assignee_user_id = v_actor
  ) then
    raise exception 'user is not current workflow assignee';
  end if;

  select *
    into v_current_node
  from public.workflow_nodes
  where id = v_subject.current_node_id;

  select n.*
    into v_next_node
  from public.workflow_edges e
  join public.workflow_nodes n
    on n.id = e.target_node_id
  where e.source_node_id = v_subject.current_node_id
  order by n.position_y nulls last
  limit 1;

  if not found then
    raise exception 'next workflow node not found';
  end if;

  if v_next_node.type <> 'END'::public.workflow_node_type then
    if p_next_assignee_user_id is null then
      raise exception 'next assignee is required';
    end if;
    if not app_private.project_workflow_assignee_is_eligible(p_subject_type, p_subject_id, v_next_node.id, p_next_assignee_user_id) then
      raise exception 'next assignee is not eligible for this workflow step';
    end if;
  end if;

  update public.workflow_step_assignments
  set status = 'APPROVED',
      acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), '')
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and node_id = v_subject.current_node_id
    and status = 'PENDING';

  select *
    into v_processed
  from public.process_workflow_instance_fast(
    v_subject.workflow_instance_id,
    'APPROVED'::public.workflow_instance_action,
    v_actor,
    coalesce(p_comment, ''),
    case when v_next_node.type = 'END'::public.workflow_node_type then null else p_next_assignee_user_id end
  )
  limit 1;

  if v_next_node.type = 'END'::public.workflow_node_type then
    update public.workflow_subjects
    set current_assignee_user_id = null,
        current_node_id = v_next_node.id,
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

    v_to_step := 'batch_planning';
  else
    insert into public.workflow_step_assignments(
      workflow_subject_id,
      workflow_instance_id,
      node_id,
      assignee_user_id,
      assigned_by,
      status,
      action_comment
    )
    values (
      v_subject.id,
      v_subject.workflow_instance_id,
      v_next_node.id,
      p_next_assignee_user_id,
      v_actor,
      'PENDING',
      p_comment
    );

    select u.name
      into v_assignee_name
    from public.users u
    where u.id = p_next_assignee_user_id;

    v_sla_hours := app_private.project_workflow_node_sla_hours(v_next_node.id);
    v_due_at := case
      when v_sla_hours is null then null
      else now() + make_interval(hours => v_sla_hours)
    end;

    update public.workflow_subjects
    set current_assignee_user_id = p_next_assignee_user_id,
        current_node_id = v_next_node.id,
        status = 'RUNNING',
        updated_at = now()
    where id = v_subject.id
    returning * into v_subject;

    update public.requests
    set status = 'PENDING'::public.request_status,
        submitted_to_user_id = p_next_assignee_user_id::text,
        submitted_to_name = v_assignee_name,
        submitted_to_permission = app_private.project_workflow_node_primary_permission(v_next_node.id),
        submission_note = nullif(coalesce(p_comment, ''), ''),
        last_action_by = v_actor,
        last_action_at = now(),
        workflow_step = 'material_department_review',
        workflow_step_started_at = now(),
        workflow_step_due_at = v_due_at,
        workflow_step_sla_hours = v_sla_hours,
        workflow_step_actor_user_id = v_actor::text
    where id = p_subject_id;

    v_to_step := 'material_department_review';
  end if;

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
    coalesce(v_request.workflow_step, 'site_manager_review'),
    v_to_step,
    'APPROVED',
    v_actor::text,
    case when v_next_node.type = 'END'::public.workflow_node_type then null else p_next_assignee_user_id::text end,
    case when v_next_node.type = 'END'::public.workflow_node_type then null else app_private.project_workflow_node_primary_permission(v_next_node.id) end,
    nullif(coalesce(p_comment, ''), ''),
    case when v_next_node.type = 'END'::public.workflow_node_type then null else app_private.project_workflow_node_sla_hours(v_next_node.id) end,
    case when v_next_node.type = 'END'::public.workflow_node_type then null else v_due_at end,
    jsonb_build_object('workflowInstanceId', v_subject.workflow_instance_id, 'workflowSubjectId', v_subject.id, 'fromNodeId', v_current_node.id, 'toNodeId', v_next_node.id)
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_request public.requests%rowtype;
  v_first_node_id uuid;
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

  if not (
    public.is_admin()
    or public.is_module_admin('WF')
    or v_subject.current_assignee_user_id = v_actor
  ) then
    raise exception 'user is not current workflow assignee';
  end if;

  if nullif(coalesce(p_comment, ''), '') is null then
    raise exception 'return reason is required';
  end if;

  v_first_node_id := app_private.project_workflow_first_task_node(v_request.workflow_template_id);

  if v_first_node_id is null then
    v_first_node_id := v_subject.current_node_id;
  end if;

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_subject.workflow_instance_id, v_subject.current_node_id, 'REVISION_REQUESTED'::public.workflow_instance_action, v_actor, coalesce(p_comment, ''));

  update public.workflow_step_assignments
  set status = 'RETURNED',
      acted_at = now(),
      action_comment = p_comment,
      return_to_node_id = v_first_node_id
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and node_id = v_subject.current_node_id
    and status = 'PENDING';

  insert into public.workflow_step_assignments(
    workflow_subject_id,
    workflow_instance_id,
    node_id,
    assignee_user_id,
    assigned_by,
    status,
    action_comment,
    metadata
  )
  values (
    v_subject.id,
    v_subject.workflow_instance_id,
    v_first_node_id,
    v_request.requester_id,
    v_actor,
    'PENDING',
    p_comment,
    jsonb_build_object('returnedToCreator', true)
  );

  update public.workflow_instances
  set current_node_id = v_first_node_id,
      status = 'RUNNING'::public.workflow_instance_status,
      step_assignees = coalesce(step_assignees, '{}'::jsonb) || jsonb_build_object(v_first_node_id::text, v_request.requester_id::text),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  select u.name
    into v_assignee_name
  from public.users u
  where u.id = v_request.requester_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_request.requester_id,
      current_node_id = v_first_node_id,
      status = 'RETURNED',
      updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'DRAFT'::public.request_status,
      submitted_to_user_id = v_request.requester_id::text,
      submitted_to_name = v_assignee_name,
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
    v_request.requester_id::text,
    'edit',
    p_comment,
    jsonb_build_object('workflowInstanceId', v_subject.workflow_instance_id, 'workflowSubjectId', v_subject.id, 'returnToNodeId', v_first_node_id)
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
  v_processed record;
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

  if not (
    public.is_admin()
    or public.is_module_admin('WF')
    or v_subject.current_assignee_user_id = v_actor
  ) then
    raise exception 'user is not current workflow assignee';
  end if;

  if nullif(coalesce(p_comment, ''), '') is null then
    raise exception 'reject reason is required';
  end if;

  update public.workflow_step_assignments
  set status = 'REJECTED',
      acted_at = now(),
      action_comment = p_comment
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and node_id = v_subject.current_node_id
    and status = 'PENDING';

  select *
    into v_processed
  from public.process_workflow_instance_fast(
    v_subject.workflow_instance_id,
    'REJECTED'::public.workflow_instance_action,
    v_actor,
    coalesce(p_comment, ''),
    null
  )
  limit 1;

  update public.workflow_subjects
  set current_assignee_user_id = null,
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
    jsonb_build_object('workflowInstanceId', v_subject.workflow_instance_id, 'workflowSubjectId', v_subject.id)
  );

  return v_subject;
end;
$$;

revoke all on function public.set_project_workflow_updated_at() from public;

revoke execute on function public.start_project_workflow(text, text, uuid, uuid, text) from anon;
revoke execute on function public.start_project_workflow(text, text, uuid, uuid, text) from public;
grant execute on function public.start_project_workflow(text, text, uuid, uuid, text) to authenticated;

revoke execute on function public.advance_project_workflow(text, text, uuid, text) from anon;
revoke execute on function public.advance_project_workflow(text, text, uuid, text) from public;
grant execute on function public.advance_project_workflow(text, text, uuid, text) to authenticated;

revoke execute on function public.return_project_workflow(text, text, text) from anon;
revoke execute on function public.return_project_workflow(text, text, text) from public;
grant execute on function public.return_project_workflow(text, text, text) to authenticated;

revoke execute on function public.reject_project_workflow(text, text, text) from anon;
revoke execute on function public.reject_project_workflow(text, text, text) from public;
grant execute on function public.reject_project_workflow(text, text, text) to authenticated;

notify pgrst, 'reload schema';

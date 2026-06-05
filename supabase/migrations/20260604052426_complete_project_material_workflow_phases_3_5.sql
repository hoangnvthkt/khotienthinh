-- Complete the project material-request workflow runtime.
-- Existing Phase 1-2 public RPC signatures remain compatible, while project
-- workflow behavior is made authoritative from the instance snapshot.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create schema if not exists app_private;

alter table public.workflow_subjects
  add column if not exists return_to_instance_node_id uuid references public.workflow_instance_nodes(id) on delete set null,
  add column if not exists last_action_instance_node_id uuid references public.workflow_instance_nodes(id) on delete set null;

alter table public.workflow_step_assignments
  add column if not exists assignment_round_id uuid;

create index if not exists idx_workflow_step_assignments_round
  on public.workflow_step_assignments(workflow_subject_id, assignment_round_id)
  where assignment_round_id is not null;

create table if not exists public.workflow_sla_notifications (
  id uuid primary key default gen_random_uuid(),
  workflow_step_assignment_id uuid not null references public.workflow_step_assignments(id) on delete cascade,
  workflow_subject_id uuid not null references public.workflow_subjects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  notification_kind text not null check (notification_kind in ('DUE_SOON', 'OVERDUE')),
  notified_at timestamptz not null default now(),
  unique(workflow_step_assignment_id, notification_kind)
);

create index if not exists idx_workflow_sla_notifications_subject
  on public.workflow_sla_notifications(workflow_subject_id, notified_at desc);

create index if not exists idx_workflow_sla_notifications_user
  on public.workflow_sla_notifications(user_id, notified_at desc);

create index if not exists idx_workflow_subjects_current_instance_node
  on public.workflow_subjects(current_instance_node_id)
  where current_instance_node_id is not null;

create index if not exists idx_workflow_subjects_last_action_instance_node
  on public.workflow_subjects(last_action_instance_node_id)
  where last_action_instance_node_id is not null;

create index if not exists idx_workflow_subjects_return_instance_node
  on public.workflow_subjects(return_to_instance_node_id)
  where return_to_instance_node_id is not null;

create index if not exists idx_workflow_subjects_current_node
  on public.workflow_subjects(current_node_id)
  where current_node_id is not null;

create index if not exists idx_workflow_subjects_template_version
  on public.workflow_subjects(template_version_id)
  where template_version_id is not null;

create index if not exists idx_workflow_subjects_created_by
  on public.workflow_subjects(created_by)
  where created_by is not null;

create index if not exists idx_workflow_subjects_returned_by
  on public.workflow_subjects(returned_by_user_id)
  where returned_by_user_id is not null;

create index if not exists idx_workflow_step_assignments_assigned_by
  on public.workflow_step_assignments(assigned_by)
  where assigned_by is not null;

create index if not exists idx_workflow_step_assignments_return_to_node
  on public.workflow_step_assignments(return_to_node_id)
  where return_to_node_id is not null;

create index if not exists idx_workflow_template_versions_created_by
  on public.workflow_template_versions(created_by)
  where created_by is not null;

create index if not exists idx_workflow_instance_nodes_template_version
  on public.workflow_instance_nodes(template_version_id)
  where template_version_id is not null;

create index if not exists idx_workflow_instance_edges_target_node
  on public.workflow_instance_edges(target_instance_node_id);

create index if not exists idx_workflow_instance_edges_template_edge
  on public.workflow_instance_edges(template_edge_id)
  where template_edge_id is not null;

create index if not exists idx_workflow_instance_edges_template_version
  on public.workflow_instance_edges(template_version_id)
  where template_version_id is not null;

create index if not exists idx_workflow_participants_instance
  on public.workflow_participants(workflow_instance_id, role, is_active);

create index if not exists idx_workflow_participants_node
  on public.workflow_participants(node_id)
  where node_id is not null;

create index if not exists idx_workflow_participants_instance_node
  on public.workflow_participants(instance_node_id)
  where instance_node_id is not null;

create index if not exists idx_workflow_participants_created_by
  on public.workflow_participants(created_by)
  where created_by is not null;

create index if not exists idx_project_document_links_project
  on public.project_document_links(project_id)
  where project_id is not null;

alter table public.workflow_sla_notifications enable row level security;

create or replace function app_private.project_workflow_template_manager(
  p_template_id uuid,
  p_actor uuid default public.current_app_user_id()
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
      from public.workflow_templates wt
      where wt.id = p_template_id
        and p_actor::text = any(coalesce(wt.managers, '{}'::text[]))
    ),
    false
  );
$$;

create or replace function app_private.project_user_has_permission(
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
  select coalesce(
    exists (
      select 1
      from public.project_staff ps
      join public.project_staff_permissions psp
        on psp.staff_id = ps.id
       and coalesce(psp.is_active, true)
      join public.project_permission_types ppt
        on ppt.id = psp.permission_type_id
       and ppt.code = p_permission_code
       and coalesce(ppt.is_active, true)
      where ps.user_id::text = p_user_id::text
        and ps.end_date is null
        and (
          (p_project_id is not null and ps.project_id::text = p_project_id)
          or (p_construction_site_id is not null and ps.construction_site_id::text = p_construction_site_id)
        )
    ),
    false
  );
$$;

create or replace function app_private.project_workflow_binding_can_manage(
  p_project_id text,
  p_construction_site_id text,
  p_template_id uuid default null
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
    or (
      p_project_id is not null
      and app_private.project_user_has_permission(
        p_project_id, p_construction_site_id, 'edit', public.current_app_user_id()
      )
      and (
        public.is_module_admin('DA')
        or (
          (
            (p_template_id is not null and app_private.project_workflow_template_manager(p_template_id, public.current_app_user_id()))
            or (
              p_template_id is null
              and exists (
                select 1
                from public.workflow_templates wt
                where public.current_app_user_id()::text = any(coalesce(wt.managers, '{}'::text[]))
              )
            )
          )
        )
      )
    ),
    false
  );
$$;

drop function if exists app_private.project_workflow_binding_can_manage(text, text) cascade;

create or replace function app_private.project_workflow_validate_template(p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_template_active boolean := false;
  v_start_count integer := 0;
  v_end_count integer := 0;
  v_task_count integer := 0;
  v_path_reaches_end boolean := false;
  v_invalid_step_count integer := 0;
  v_errors text[] := '{}'::text[];
begin
  select coalesce(wt.is_active, true)
    into v_template_active
  from public.workflow_templates wt
  where wt.id = p_template_id;

  if not found then
    return jsonb_build_object('valid', false, 'errors', jsonb_build_array('Không tìm thấy mẫu workflow.'));
  end if;

  if not v_template_active then
    v_errors := array_append(v_errors, 'Mẫu workflow đang ngừng hoạt động.');
  end if;

  select
    count(*) filter (where wn.type = 'START'::public.workflow_node_type),
    count(*) filter (where wn.type = 'END'::public.workflow_node_type),
    count(*) filter (where wn.type not in ('START'::public.workflow_node_type, 'END'::public.workflow_node_type)),
    count(*) filter (
      where wn.type not in ('START'::public.workflow_node_type, 'END'::public.workflow_node_type)
        and (
          coalesce(nullif(wn.label, ''), '') = ''
          or coalesce(nullif(wn.config ->> 'approvalPolicy', ''), 'ANY_ONE') <> 'ANY_ONE'
        )
    )
  into v_start_count, v_end_count, v_task_count, v_invalid_step_count
  from public.workflow_nodes wn
  where wn.template_id = p_template_id;

  if v_start_count <> 1 then
    v_errors := array_append(v_errors, 'Workflow phải có đúng một bước Bắt đầu.');
  end if;
  if v_end_count <> 1 then
    v_errors := array_append(v_errors, 'Workflow phải có đúng một bước Kết thúc.');
  end if;
  if v_task_count < 1 then
    v_errors := array_append(v_errors, 'Workflow phải có ít nhất một bước xử lý.');
  end if;
  if v_invalid_step_count > 0 then
    v_errors := array_append(v_errors, 'Có bước xử lý thiếu tên hoặc dùng approval policy chưa được hỗ trợ.');
  end if;

  with recursive walk(node_id, visited) as (
    select wn.id, array[wn.id]
    from public.workflow_nodes wn
    where wn.template_id = p_template_id
      and wn.type = 'START'::public.workflow_node_type
    union all
    select we.target_node_id, walk.visited || we.target_node_id
    from walk
    join public.workflow_edges we on we.source_node_id = walk.node_id
    where not (we.target_node_id = any(walk.visited))
  )
  select exists (
    select 1
    from walk
    join public.workflow_nodes wn on wn.id = walk.node_id
    where wn.type = 'END'::public.workflow_node_type
  ) into v_path_reaches_end;

  if not v_path_reaches_end then
    v_errors := array_append(v_errors, 'Không có đường đi hợp lệ từ Bắt đầu tới Kết thúc.');
  end if;

  return jsonb_build_object(
    'valid', coalesce(array_length(v_errors, 1), 0) = 0,
    'errors', to_jsonb(v_errors),
    'startCount', v_start_count,
    'endCount', v_end_count,
    'taskCount', v_task_count
  );
end;
$$;

create or replace function public.get_project_workflow_configuration(
  p_subject_type text,
  p_project_id text default null,
  p_construction_site_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_binding public.project_workflow_bindings%rowtype;
  v_scope text;
  v_validation jsonb;
begin
  if public.current_app_user_id() is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select pwb.*
    into v_binding
  from public.project_workflow_bindings pwb
  join public.workflow_templates wt on wt.id = pwb.workflow_template_id
  where pwb.subject_type = p_subject_type
    and pwb.is_active
    and pwb.is_default
    and (
      (p_construction_site_id is not null and pwb.project_id is not distinct from p_project_id and pwb.construction_site_id = p_construction_site_id)
      or (p_project_id is not null and pwb.project_id = p_project_id and pwb.construction_site_id is null)
      or (pwb.project_id is null and pwb.construction_site_id is null)
    )
  order by
    case
      when p_construction_site_id is not null and pwb.construction_site_id = p_construction_site_id then 1
      when p_project_id is not null and pwb.project_id = p_project_id and pwb.construction_site_id is null then 2
      else 3
    end
  limit 1;

  if not found then
    return jsonb_build_object(
      'subjectType', p_subject_type,
      'projectId', p_project_id,
      'constructionSiteId', p_construction_site_id,
      'binding', null,
      'scope', null,
      'valid', false,
      'errors', jsonb_build_array('Chưa cấu hình workflow cho đề xuất vật tư.'),
      'canManage', app_private.project_workflow_binding_can_manage(p_project_id, p_construction_site_id)
    );
  end if;

  v_scope := case
    when v_binding.construction_site_id is not null then 'site'
    when v_binding.project_id is not null then 'project'
    else 'global'
  end;
  v_validation := app_private.project_workflow_validate_template(v_binding.workflow_template_id);

  return jsonb_build_object(
    'subjectType', p_subject_type,
    'projectId', p_project_id,
    'constructionSiteId', p_construction_site_id,
    'binding', to_jsonb(v_binding),
    'scope', v_scope,
    'valid', coalesce((v_validation ->> 'valid')::boolean, false),
    'errors', coalesce(v_validation -> 'errors', '[]'::jsonb),
    'validation', v_validation,
    'canManage', app_private.project_workflow_binding_can_manage(
      p_project_id, p_construction_site_id, v_binding.workflow_template_id
    )
  );
end;
$$;

create or replace function public.set_project_workflow_binding(
  p_subject_type text,
  p_workflow_template_id uuid,
  p_project_id text default null,
  p_construction_site_id text default null
)
returns public.project_workflow_bindings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_validation jsonb;
  v_binding public.project_workflow_bindings%rowtype;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;
  if p_construction_site_id is not null and p_project_id is null then
    raise exception 'site binding requires project id';
  end if;
  if not app_private.project_workflow_binding_can_manage(p_project_id, p_construction_site_id, p_workflow_template_id) then
    raise exception 'user cannot manage this project workflow binding';
  end if;

  v_validation := app_private.project_workflow_validate_template(p_workflow_template_id);
  if not coalesce((v_validation ->> 'valid')::boolean, false) then
    raise exception 'workflow template is invalid: %', v_validation;
  end if;

  update public.project_workflow_bindings pwb
  set is_active = false,
      updated_at = now()
  where pwb.subject_type = p_subject_type
    and pwb.is_default
    and pwb.is_active
    and pwb.project_id is not distinct from p_project_id
    and pwb.construction_site_id is not distinct from p_construction_site_id;

  insert into public.project_workflow_bindings(
    subject_type, project_id, construction_site_id, workflow_template_id,
    is_default, is_active, created_by
  )
  values (
    p_subject_type, p_project_id, p_construction_site_id, p_workflow_template_id,
    true, true, v_actor
  )
  returning * into v_binding;

  return v_binding;
end;
$$;

create or replace function public.remove_project_workflow_binding(
  p_subject_type text,
  p_project_id text default null,
  p_construction_site_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_template_id uuid;
begin
  if public.current_app_user_id() is null then
    raise exception 'authentication required';
  end if;
  select pwb.workflow_template_id into v_template_id
  from public.project_workflow_bindings pwb
  where pwb.subject_type = p_subject_type
    and pwb.project_id is not distinct from p_project_id
    and pwb.construction_site_id is not distinct from p_construction_site_id
    and pwb.is_active
  order by pwb.updated_at desc
  limit 1;

  if not app_private.project_workflow_binding_can_manage(p_project_id, p_construction_site_id, v_template_id) then
    raise exception 'user cannot manage this project workflow binding';
  end if;

  update public.project_workflow_bindings pwb
  set is_active = false,
      updated_at = now()
  where pwb.subject_type = p_subject_type
    and pwb.project_id is not distinct from p_project_id
    and pwb.construction_site_id is not distinct from p_construction_site_id
    and pwb.is_active;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function app_private.project_workflow_runtime_node_config(p_instance_node_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(win.config, '{}'::jsonb)
  from public.workflow_instance_nodes win
  where win.id = p_instance_node_id;
$$;

create or replace function app_private.project_workflow_runtime_sla_hours(p_instance_node_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(win.config ->> 'slaHours', '')::integer
  from public.workflow_instance_nodes win
  where win.id = p_instance_node_id
    and (win.config ->> 'slaHours') ~ '^[0-9]+$';
$$;

create or replace function app_private.project_workflow_runtime_sla_due_at(p_instance_node_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app_private.project_workflow_runtime_sla_hours(p_instance_node_id) is null then null
    else now() + make_interval(hours => app_private.project_workflow_runtime_sla_hours(p_instance_node_id))
  end;
$$;

create or replace function app_private.project_workflow_runtime_primary_permission(p_instance_node_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select value
      from jsonb_array_elements_text(coalesce(win.config -> 'eligiblePermissionCodes', '[]'::jsonb)) as code(value)
      limit 1
    ),
    nullif(win.config ->> 'eligiblePermissionCode', ''),
    nullif(win.config ->> 'requiredPermissionCode', ''),
    nullif(win.config ->> 'assigneePermissionCode', '')
  )
  from public.workflow_instance_nodes win
  where win.id = p_instance_node_id;
$$;

create or replace function app_private.project_workflow_runtime_to_coarse_step(
  p_workflow_instance_id uuid,
  p_instance_node_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_instance_node_id is null then null
    when p_instance_node_id = (
      select wie.target_instance_node_id
      from public.workflow_instance_nodes start_node
      join public.workflow_instance_edges wie
        on wie.workflow_instance_id = start_node.workflow_instance_id
       and wie.source_instance_node_id = start_node.id
      join public.workflow_instance_nodes target_node
        on target_node.id = wie.target_instance_node_id
      where start_node.workflow_instance_id = p_workflow_instance_id
        and start_node.type = 'START'::public.workflow_node_type
        and target_node.type <> 'END'::public.workflow_node_type
      order by target_node.position_y, target_node.position_x
      limit 1
    ) then 'site_manager_review'
    else 'material_department_review'
  end;
$$;

create or replace function app_private.project_workflow_runtime_assignee_is_eligible(
  p_subject_type text,
  p_subject_id text,
  p_instance_node_id uuid,
  p_assignee_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_node public.workflow_instance_nodes%rowtype;
  v_request public.requests%rowtype;
  v_mode text;
  v_fixed_user text;
  v_role text;
  v_code_count integer := 0;
  v_target_count integer := 0;
begin
  if p_subject_type <> 'material_request' or p_assignee_user_id is null then
    return false;
  end if;

  select * into v_node
  from public.workflow_instance_nodes win
  where win.id = p_instance_node_id;
  if not found or v_node.type = 'END'::public.workflow_node_type then
    return false;
  end if;

  select * into v_request from public.requests r where r.id = p_subject_id;
  if not found then return false; end if;

  if not exists (
    select 1 from public.users u
    where u.id = p_assignee_user_id and coalesce(u.is_active, true)
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
    select 1 from public.users u
    where u.id = p_assignee_user_id and u.role::text = v_role and coalesce(u.is_active, true)
  ) then
    return false;
  end if;

  select count(*) into v_target_count
  from jsonb_array_elements(coalesce(v_node.config -> 'assignmentTargets', '[]'::jsonb)) target(value);

  if v_target_count > 0 then
    return exists (
      select 1
      from jsonb_array_elements(coalesce(v_node.config -> 'assignmentTargets', '[]'::jsonb)) target(value)
      where (
        target.value ->> 'type' = 'user'
        and target.value ->> 'userId' = p_assignee_user_id::text
      ) or (
        target.value ->> 'type' = 'creator'
        and v_request.requester_id = p_assignee_user_id
      ) or (
        target.value ->> 'type' = 'department'
        and exists (
          select 1
          from public.employees e
          where e.user_id = p_assignee_user_id
            and coalesce(e.status, 'Đang làm việc') = 'Đang làm việc'
            and (
              e.department_id::text = target.value ->> 'orgUnitId'
              or e.org_unit_id::text = target.value ->> 'orgUnitId'
            )
        )
      ) or (
        target.value ->> 'type' = 'project_permission'
        and app_private.project_user_has_permission(
          v_request.project_id,
          v_request.construction_site_id,
          target.value ->> 'permissionCode',
          p_assignee_user_id
        )
      )
    );
  end if;

  select count(*) into v_code_count
  from jsonb_array_elements_text(coalesce(v_node.config -> 'eligiblePermissionCodes', '[]'::jsonb)) code(value);

  if v_code_count > 0 then
    return exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_node.config -> 'eligiblePermissionCodes', '[]'::jsonb)) code(value)
      where app_private.project_user_has_permission(
        v_request.project_id,
        v_request.construction_site_id,
        code.value,
        p_assignee_user_id
      )
    );
  end if;

  return exists (
    select 1
    from public.project_staff ps
    where ps.user_id::text = p_assignee_user_id::text
      and ps.end_date is null
      and (
        (v_request.project_id is not null and ps.project_id::text = v_request.project_id)
        or (v_request.construction_site_id is not null and ps.construction_site_id::text = v_request.construction_site_id)
      )
  );
end;
$$;

create or replace function app_private.project_workflow_runtime_assignees_are_eligible(
  p_subject_type text,
  p_subject_id text,
  p_instance_node_id uuid,
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
  if coalesce(array_length(v_ids, 1), 0) = 0 then return false; end if;
  foreach v_id in array v_ids loop
    if not app_private.project_workflow_runtime_assignee_is_eligible(
      p_subject_type, p_subject_id, p_instance_node_id, v_id
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
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
  v_target_count integer := 0;
begin
  if p_subject_type <> 'material_request' or p_assignee_user_id is null then return false; end if;
  select * into v_node from public.workflow_nodes wn where wn.id = p_node_id;
  if not found or v_node.type = 'END'::public.workflow_node_type then return false; end if;
  select * into v_request from public.requests r where r.id = p_subject_id;
  if not found then return false; end if;

  if not exists (
    select 1 from public.users u
    where u.id = p_assignee_user_id and coalesce(u.is_active, true)
  ) then return false; end if;

  v_mode := coalesce(nullif(v_node.config ->> 'assignmentMode', ''), 'select_on_transition');
  v_fixed_user := nullif(v_node.config ->> 'assigneeUserId', '');
  v_role := nullif(v_node.config ->> 'assigneeRole', '');
  if v_fixed_user is not null then return v_fixed_user = p_assignee_user_id::text; end if;
  if v_mode = 'creator' then return v_request.requester_id = p_assignee_user_id; end if;
  if v_role is not null and not exists (
    select 1 from public.users u
    where u.id = p_assignee_user_id and u.role::text = v_role and coalesce(u.is_active, true)
  ) then return false; end if;

  select count(*) into v_target_count
  from jsonb_array_elements(coalesce(v_node.config -> 'assignmentTargets', '[]'::jsonb)) target(value);
  if v_target_count > 0 then
    return exists (
      select 1
      from jsonb_array_elements(coalesce(v_node.config -> 'assignmentTargets', '[]'::jsonb)) target(value)
      where (
        target.value ->> 'type' = 'user'
        and target.value ->> 'userId' = p_assignee_user_id::text
      ) or (
        target.value ->> 'type' = 'creator'
        and v_request.requester_id = p_assignee_user_id
      ) or (
        target.value ->> 'type' = 'department'
        and exists (
          select 1 from public.employees e
          where e.user_id = p_assignee_user_id
            and coalesce(e.status, 'Đang làm việc') = 'Đang làm việc'
            and (
              e.department_id::text = target.value ->> 'orgUnitId'
              or e.org_unit_id::text = target.value ->> 'orgUnitId'
            )
        )
      ) or (
        target.value ->> 'type' = 'project_permission'
        and app_private.project_user_has_permission(
          v_request.project_id, v_request.construction_site_id,
          target.value ->> 'permissionCode', p_assignee_user_id
        )
      )
    );
  end if;

  select count(*) into v_code_count
  from jsonb_array_elements_text(coalesce(v_node.config -> 'eligiblePermissionCodes', '[]'::jsonb)) code(value);
  if v_code_count > 0 then
    return exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_node.config -> 'eligiblePermissionCodes', '[]'::jsonb)) code(value)
      where app_private.project_user_has_permission(
        v_request.project_id, v_request.construction_site_id, code.value, p_assignee_user_id
      )
    );
  end if;

  return exists (
    select 1 from public.project_staff ps
    where ps.user_id::text = p_assignee_user_id::text
      and ps.end_date is null
      and (
        (v_request.project_id is not null and ps.project_id::text = v_request.project_id)
        or (v_request.construction_site_id is not null and ps.construction_site_id::text = v_request.construction_site_id)
      )
  );
end;
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
    exists (
      select 1
      from public.workflow_subjects ws
      join public.workflow_step_assignments wsa
        on wsa.workflow_subject_id = ws.id
       and wsa.workflow_instance_id = ws.workflow_instance_id
       and wsa.instance_node_id = ws.current_instance_node_id
       and wsa.assignee_user_id = p_actor
       and wsa.status = 'PENDING'
      where ws.id = p_workflow_subject_id
        and ws.status = 'RUNNING'
    ),
    false
  );
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
  join public.workflow_subjects ws on ws.id = wsa.workflow_subject_id
  where wsa.workflow_subject_id = p_workflow_subject_id
    and wsa.workflow_instance_id = ws.workflow_instance_id
    and (
      (ws.current_instance_node_id is not null and wsa.instance_node_id = ws.current_instance_node_id)
      or (ws.current_instance_node_id is null and wsa.node_id = p_node_id)
    )
    and wsa.status = 'PENDING'
    and wsa.assignee_user_id is not null;
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
  v_sla_hours integer := app_private.project_workflow_runtime_sla_hours(p_instance_node_id);
  v_due_at timestamptz := app_private.project_workflow_runtime_sla_due_at(p_instance_node_id);
  v_node_config jsonb := app_private.project_workflow_runtime_node_config(p_instance_node_id);
  v_target jsonb;
  v_watcher_user_id uuid;
  v_round_id uuid := gen_random_uuid();
begin
  foreach v_id in array v_ids loop
    insert into public.workflow_step_assignments(
      workflow_subject_id, workflow_instance_id, node_id, instance_node_id,
      assignee_user_id, assigned_by, status, assigned_at, action_comment,
      metadata, due_at, sla_hours, assignment_source, assignment_group_type,
      assignment_group_id
    )
    values (
      p_workflow_subject_id, p_workflow_instance_id, p_node_id, p_instance_node_id,
      v_id, p_assigned_by, 'PENDING', now(), nullif(coalesce(p_comment, ''), ''),
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('assignmentRoundId', v_round_id),
      v_due_at, v_sla_hours,
      p_assignment_source, p_assignment_group_type, p_assignment_group_id
    );

    update public.workflow_step_assignments
    set assignment_round_id = v_round_id
    where id = (
      select wsa.id
      from public.workflow_step_assignments wsa
      where wsa.workflow_subject_id = p_workflow_subject_id
        and wsa.workflow_instance_id = p_workflow_instance_id
        and wsa.assignee_user_id = v_id
        and wsa.status = 'PENDING'
      order by wsa.assigned_at desc
      limit 1
    );

    perform app_private.project_workflow_register_participant(
      p_workflow_subject_id, p_workflow_instance_id, v_id, 'ASSIGNEE',
      p_assignment_source, p_assignment_group_id, p_node_id, p_instance_node_id, p_assigned_by
    );
  end loop;

  for v_target in
    select value
    from jsonb_array_elements(coalesce(v_node_config -> 'stepWatcherTargets', '[]'::jsonb)) target(value)
  loop
    if coalesce(v_target ->> 'type', '') = 'user' and nullif(v_target ->> 'userId', '') is not null then
      perform app_private.project_workflow_register_participant(
        p_workflow_subject_id, p_workflow_instance_id, (v_target ->> 'userId')::uuid,
        'WATCHER', 'step_watcher', p_instance_node_id::text, p_node_id,
        p_instance_node_id, p_assigned_by
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
          p_workflow_subject_id, p_workflow_instance_id, v_watcher_user_id,
          'WATCHER', 'step_watcher_department', v_target ->> 'orgUnitId',
          p_node_id, p_instance_node_id, p_assigned_by
        );
      end loop;
    end if;
  end loop;
end;
$$;

do $$
begin
  if to_regprocedure('public.start_project_workflow_v2(text,text,uuid,uuid[],text)') is not null
     and to_regprocedure('public.start_project_workflow_v2_legacy(text,text,uuid,uuid[],text)') is null then
    alter function public.start_project_workflow_v2(text, text, uuid, uuid[], text)
      rename to start_project_workflow_v2_legacy;
  end if;
end $$;

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
  v_request public.requests%rowtype;
  v_config jsonb;
  v_effective_template_id uuid;
  v_subject public.workflow_subjects%rowtype;
  v_pending public.workflow_step_assignments%rowtype;
begin
  if public.current_app_user_id() is null then raise exception 'authentication required'; end if;
  select * into v_request from public.requests r where r.id = p_subject_id;
  if not found then raise exception 'material request not found: %', p_subject_id; end if;

  v_config := public.get_project_workflow_configuration(
    p_subject_type, v_request.project_id, v_request.construction_site_id
  );
  if not coalesce((v_config ->> 'valid')::boolean, false) then
    raise exception 'material request workflow is not configured or invalid: %', v_config -> 'errors';
  end if;
  v_effective_template_id := (v_config -> 'binding' ->> 'workflow_template_id')::uuid;
  if p_template_id is not null and p_template_id <> v_effective_template_id then
    raise exception 'selected workflow template is not the effective project binding';
  end if;

  v_subject := public.start_project_workflow_v2_legacy(
    p_subject_type, p_subject_id, v_effective_template_id,
    p_first_assignee_user_ids, p_comment
  );

  select * into v_pending
  from public.workflow_step_assignments wsa
  where wsa.workflow_subject_id = v_subject.id
    and wsa.instance_node_id = v_subject.current_instance_node_id
    and wsa.status = 'PENDING'
  order by wsa.assigned_at desc
  limit 1;

  update public.requests
  set submitted_to_permission = app_private.project_workflow_runtime_primary_permission(v_subject.current_instance_node_id),
      workflow_step_due_at = v_pending.due_at,
      workflow_step_sla_hours = v_pending.sla_hours
  where id = p_subject_id;

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
  v_current_node public.workflow_instance_nodes%rowtype;
  v_next_node public.workflow_instance_nodes%rowtype;
  v_next_assignee_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_next_assignee_user_ids);
  v_first_next_assignee uuid;
  v_next_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_to_step text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select * into v_subject
  from public.workflow_subjects ws
  where ws.subject_type = p_subject_type and ws.subject_id = p_subject_id
  for update;
  if not found then raise exception 'workflow subject not found'; end if;

  select * into v_request from public.requests r where r.id = p_subject_id for update;
  if not found then raise exception 'material request not found: %', p_subject_id; end if;
  if v_subject.status <> 'RUNNING' then raise exception 'workflow subject is not running'; end if;
  if not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user is not assigned to current workflow step';
  end if;

  select * into v_current_node
  from public.workflow_instance_nodes win
  where win.id = v_subject.current_instance_node_id
    and win.workflow_instance_id = v_subject.workflow_instance_id;
  if not found then raise exception 'current runtime workflow node not found'; end if;

  select target_node.* into v_next_node
  from public.workflow_instance_edges wie
  join public.workflow_instance_nodes target_node on target_node.id = wie.target_instance_node_id
  where wie.workflow_instance_id = v_subject.workflow_instance_id
    and wie.source_instance_node_id = v_subject.current_instance_node_id
  order by wie.sort_order, target_node.position_y, target_node.position_x
  limit 1;
  if not found then raise exception 'next runtime workflow node not found'; end if;

  update public.workflow_step_assignments
  set status = 'APPROVED', acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), ''),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('approvedByUserId', v_actor, 'approvalPolicy', 'ANY_ONE')
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and instance_node_id = v_subject.current_instance_node_id
    and assignee_user_id = v_actor
    and status = 'PENDING';

  update public.workflow_step_assignments
  set status = 'SKIPPED', acted_at = now(),
      action_comment = 'Skipped because another assignee approved this step',
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('skippedByPolicy', 'ANY_ONE', 'approvedByUserId', v_actor)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and instance_node_id = v_subject.current_instance_node_id
    and status = 'PENDING';

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_subject.workflow_instance_id, v_current_node.template_node_id,
    'APPROVED'::public.workflow_instance_action, v_actor, coalesce(p_comment, ''));

  if v_next_node.type = 'END'::public.workflow_node_type then
    update public.workflow_instances
    set current_node_id = v_next_node.template_node_id,
        current_instance_node_id = v_next_node.id,
        status = 'COMPLETED'::public.workflow_instance_status,
        updated_at = now()
    where id = v_subject.workflow_instance_id;

    update public.workflow_subjects
    set current_assignee_user_id = null,
        current_assignee_user_ids = '{}'::uuid[],
        current_node_id = v_next_node.template_node_id,
        current_instance_node_id = v_next_node.id,
        last_action_instance_node_id = v_current_node.id,
        status = 'COMPLETED',
        updated_at = now()
    where id = v_subject.id
    returning * into v_subject;

    update public.requests
    set status = 'APPROVED'::public.request_status,
        submitted_to_user_id = null, submitted_to_name = null,
        submitted_to_permission = null,
        submission_note = nullif(coalesce(p_comment, ''), ''),
        last_action_by = v_actor, last_action_at = now(),
        workflow_step = 'batch_planning', workflow_step_started_at = now(),
        workflow_step_due_at = null, workflow_step_sla_hours = null,
        workflow_step_actor_user_id = v_actor::text
    where id = p_subject_id;

    insert into public.material_request_events(
      request_id, project_id, from_step, to_step, action, actor_user_id, note, metadata
    )
    values (
      p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'material_department_review'),
      'batch_planning', 'APPROVED', v_actor::text, nullif(coalesce(p_comment, ''), ''),
      jsonb_build_object(
        'workflowInstanceId', v_subject.workflow_instance_id,
        'workflowSubjectId', v_subject.id,
        'fromInstanceNodeId', v_current_node.id,
        'toInstanceNodeId', v_next_node.id
      )
    );
    return v_subject;
  end if;

  if not app_private.project_workflow_runtime_assignees_are_eligible(
    p_subject_type, p_subject_id, v_next_node.id, v_next_assignee_ids
  ) then
    raise exception 'next assignee pool is not eligible for this runtime workflow step';
  end if;

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id, v_subject.workflow_instance_id, v_next_node.template_node_id, v_next_node.id,
    v_next_assignee_ids, v_actor, p_comment,
    jsonb_build_object('approvedFromInstanceNodeId', v_current_node.id, 'approvalPolicy', 'ANY_ONE'),
    'transition'
  );

  v_first_next_assignee := v_next_assignee_ids[1];
  v_next_assignee_name := app_private.project_workflow_first_assignee_name(v_next_assignee_ids);
  v_sla_hours := app_private.project_workflow_runtime_sla_hours(v_next_node.id);
  v_due_at := app_private.project_workflow_runtime_sla_due_at(v_next_node.id);
  v_to_step := app_private.project_workflow_runtime_to_coarse_step(v_subject.workflow_instance_id, v_next_node.id);

  update public.workflow_instances
  set current_node_id = v_next_node.template_node_id,
      current_instance_node_id = v_next_node.id,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || app_private.project_workflow_step_assignees_json(v_next_node.template_node_id, v_next_assignee_ids),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_first_next_assignee,
      current_assignee_user_ids = v_next_assignee_ids,
      current_node_id = v_next_node.template_node_id,
      current_instance_node_id = v_next_node.id,
      last_action_instance_node_id = v_current_node.id,
      status = 'RUNNING', updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'PENDING'::public.request_status,
      submitted_to_user_id = v_first_next_assignee::text,
      submitted_to_name = v_next_assignee_name,
      submitted_to_permission = app_private.project_workflow_runtime_primary_permission(v_next_node.id),
      submission_note = nullif(coalesce(p_comment, ''), ''),
      last_action_by = v_actor, last_action_at = now(),
      workflow_step = v_to_step, workflow_step_started_at = now(),
      workflow_step_due_at = v_due_at, workflow_step_sla_hours = v_sla_hours,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id, project_id, from_step, to_step, action, actor_user_id,
    target_user_id, target_permission, note, sla_hours, due_at, metadata
  )
  values (
    p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'material_department_review'),
    v_to_step, 'APPROVED', v_actor::text, v_first_next_assignee::text,
    app_private.project_workflow_runtime_primary_permission(v_next_node.id),
    nullif(coalesce(p_comment, ''), ''), v_sla_hours, v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'fromInstanceNodeId', v_current_node.id,
      'toInstanceNodeId', v_next_node.id,
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
  v_round_id uuid := gen_random_uuid();
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if nullif(coalesce(p_comment, ''), '') is null then raise exception 'return reason is required'; end if;

  select * into v_subject from public.workflow_subjects ws
  where ws.subject_type = p_subject_type and ws.subject_id = p_subject_id for update;
  if not found then raise exception 'workflow subject not found'; end if;
  select * into v_request from public.requests r where r.id = p_subject_id for update;
  if not found then raise exception 'material request not found: %', p_subject_id; end if;
  if v_subject.status <> 'RUNNING' then raise exception 'workflow subject is not running'; end if;
  if not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user is not assigned to current workflow step';
  end if;

  v_requester_id := v_request.requester_id::uuid;
  v_return_assignee_ids := app_private.project_workflow_pending_assignee_ids(v_subject.id, v_subject.current_node_id);

  update public.workflow_step_assignments
  set status = case when assignee_user_id = v_actor then 'RETURNED' else 'SKIPPED' end,
      acted_at = now(), action_comment = p_comment, return_to_node_id = v_subject.current_node_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'returnedToCreator', true, 'returnedByUserId', v_actor,
        'returnToInstanceNodeId', v_subject.current_instance_node_id,
        'returnToAssigneeUserIds', v_return_assignee_ids
      )
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and instance_node_id = v_subject.current_instance_node_id
    and status = 'PENDING';

  insert into public.workflow_step_assignments(
    workflow_subject_id, workflow_instance_id, node_id, instance_node_id,
    assignee_user_id, assigned_by, status, assigned_at, action_comment,
    assignment_source, assignment_round_id, metadata
  )
  values (
    v_subject.id, v_subject.workflow_instance_id, v_subject.current_node_id,
    v_subject.current_instance_node_id, v_requester_id, v_actor, 'PENDING', now(),
    p_comment, 'return_to_creator', v_round_id,
    jsonb_build_object(
      'returnedToCreator', true, 'returnToInstanceNodeId', v_subject.current_instance_node_id,
      'returnToAssigneeUserIds', v_return_assignee_ids, 'assignmentRoundId', v_round_id
    )
  );

  perform app_private.project_workflow_register_participant(
    v_subject.id, v_subject.workflow_instance_id, v_requester_id, 'CREATOR',
    'return_to_creator', p_subject_id, v_subject.current_node_id,
    v_subject.current_instance_node_id, v_actor
  );

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_subject.workflow_instance_id, v_subject.current_node_id,
    'REVISION_REQUESTED'::public.workflow_instance_action, v_actor, p_comment);

  select u.name into v_requester_name from public.users u where u.id = v_requester_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_requester_id,
      current_assignee_user_ids = array[v_requester_id],
      status = 'RETURNED',
      return_to_node_id = v_subject.current_node_id,
      return_to_instance_node_id = v_subject.current_instance_node_id,
      return_to_assignee_user_id = v_return_assignee_ids[1],
      return_to_assignee_user_ids = v_return_assignee_ids,
      returned_by_user_id = v_actor, returned_at = now(), updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'DRAFT'::public.request_status,
      submitted_to_user_id = v_requester_id::text, submitted_to_name = v_requester_name,
      submitted_to_permission = 'edit', submission_note = p_comment,
      last_action_by = v_actor, last_action_at = now(),
      workflow_step = 'returned_to_creator', workflow_step_started_at = now(),
      workflow_step_due_at = null, workflow_step_sla_hours = null,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id, project_id, from_step, to_step, action, actor_user_id,
    target_user_id, target_permission, note, metadata
  )
  values (
    p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'material_department_review'),
    'returned_to_creator', 'RETURNED', v_actor::text, v_requester_id::text, 'edit',
    p_comment, jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'returnToInstanceNodeId', v_subject.return_to_instance_node_id,
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
  v_target_node public.workflow_instance_nodes%rowtype;
  v_target_assignee_ids uuid[];
  v_first_assignee uuid;
  v_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_to_step text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_subject from public.workflow_subjects ws
  where ws.subject_type = p_subject_type and ws.subject_id = p_subject_id for update;
  if not found then raise exception 'workflow subject not found'; end if;
  select * into v_request from public.requests r where r.id = p_subject_id for update;
  if not found then raise exception 'material request not found: %', p_subject_id; end if;
  if v_subject.status <> 'RETURNED' then raise exception 'workflow subject is not returned'; end if;
  if v_request.requester_id::uuid <> v_actor then
    raise exception 'only requester can resubmit this material request';
  end if;

  select * into v_target_node
  from public.workflow_instance_nodes win
  where win.id = coalesce(v_subject.return_to_instance_node_id, v_subject.current_instance_node_id)
    and win.workflow_instance_id = v_subject.workflow_instance_id;
  if not found or v_target_node.type = 'END'::public.workflow_node_type then
    raise exception 'return runtime workflow node not found';
  end if;

  v_target_assignee_ids := app_private.project_workflow_distinct_uuid_array(
    coalesce(p_assignee_user_ids, v_subject.return_to_assignee_user_ids)
  );
  if not app_private.project_workflow_runtime_assignees_are_eligible(
    p_subject_type, p_subject_id, v_target_node.id, v_target_assignee_ids
  ) then
    raise exception 'resubmit assignee pool is not eligible for this runtime workflow step';
  end if;

  update public.workflow_step_assignments
  set status = 'APPROVED', acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), ''),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('resubmittedByCreator', true)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and assignee_user_id = v_request.requester_id::uuid
    and status = 'PENDING'
    and assignment_source = 'return_to_creator';

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id, v_subject.workflow_instance_id, v_target_node.template_node_id, v_target_node.id,
    v_target_assignee_ids, v_actor, p_comment,
    jsonb_build_object('resubmitted', true, 'approvalPolicy', 'ANY_ONE'), 'resubmit'
  );

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_subject.workflow_instance_id, v_target_node.template_node_id,
    'REOPENED'::public.workflow_instance_action, v_actor, coalesce(p_comment, ''));

  v_first_assignee := v_target_assignee_ids[1];
  v_assignee_name := app_private.project_workflow_first_assignee_name(v_target_assignee_ids);
  v_sla_hours := app_private.project_workflow_runtime_sla_hours(v_target_node.id);
  v_due_at := app_private.project_workflow_runtime_sla_due_at(v_target_node.id);
  v_to_step := app_private.project_workflow_runtime_to_coarse_step(v_subject.workflow_instance_id, v_target_node.id);

  update public.workflow_instances
  set current_node_id = v_target_node.template_node_id,
      current_instance_node_id = v_target_node.id,
      status = 'RUNNING'::public.workflow_instance_status,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || app_private.project_workflow_step_assignees_json(v_target_node.template_node_id, v_target_assignee_ids),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_first_assignee,
      current_assignee_user_ids = v_target_assignee_ids,
      current_node_id = v_target_node.template_node_id,
      current_instance_node_id = v_target_node.id,
      status = 'RUNNING',
      return_to_node_id = null, return_to_instance_node_id = null,
      return_to_assignee_user_id = null, return_to_assignee_user_ids = '{}'::uuid[],
      returned_by_user_id = null, returned_at = null, updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'PENDING'::public.request_status,
      submitted_to_user_id = v_first_assignee::text, submitted_to_name = v_assignee_name,
      submitted_to_permission = app_private.project_workflow_runtime_primary_permission(v_target_node.id),
      submission_note = nullif(coalesce(p_comment, ''), ''), ever_submitted = true,
      last_action_by = v_actor, last_action_at = now(),
      workflow_step = v_to_step, workflow_step_started_at = now(),
      workflow_step_due_at = v_due_at, workflow_step_sla_hours = v_sla_hours,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id, project_id, from_step, to_step, action, actor_user_id,
    target_user_id, target_permission, note, sla_hours, due_at, metadata
  )
  values (
    p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'returned_to_creator'),
    v_to_step, 'RESUBMITTED', v_actor::text, v_first_assignee::text,
    app_private.project_workflow_runtime_primary_permission(v_target_node.id),
    nullif(coalesce(p_comment, ''), ''), v_sla_hours, v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'toInstanceNodeId', v_target_node.id,
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
  v_node public.workflow_instance_nodes%rowtype;
  v_new_assignee_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_new_assignee_user_ids);
  v_first_assignee uuid;
  v_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_subject from public.workflow_subjects ws
  where ws.subject_type = p_subject_type and ws.subject_id = p_subject_id for update;
  if not found then raise exception 'workflow subject not found'; end if;
  select * into v_request from public.requests r where r.id = p_subject_id for update;
  if not found then raise exception 'material request not found: %', p_subject_id; end if;
  if v_subject.status <> 'RUNNING' then raise exception 'workflow subject is not running'; end if;
  if not (
    app_private.project_workflow_actor_can_act(v_subject.id, v_actor)
    or app_private.project_workflow_actor_is_admin(v_subject.id, v_actor)
  ) then
    raise exception 'user cannot reassign this workflow step';
  end if;

  select * into v_node from public.workflow_instance_nodes win
  where win.id = v_subject.current_instance_node_id;
  if not found or v_node.type = 'END'::public.workflow_node_type then
    raise exception 'current runtime workflow node cannot be reassigned';
  end if;
  if coalesce((v_node.config ->> 'allowReassign')::boolean, true) = false then
    raise exception 'workflow step does not allow reassign';
  end if;
  if not app_private.project_workflow_runtime_assignees_are_eligible(
    p_subject_type, p_subject_id, v_node.id, v_new_assignee_ids
  ) then
    raise exception 'new assignee pool is not eligible for this runtime workflow step';
  end if;

  update public.workflow_step_assignments
  set status = 'SKIPPED', acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), ''),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reassignedToUserIds', v_new_assignee_ids)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and instance_node_id = v_node.id
    and status = 'PENDING';

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id, v_subject.workflow_instance_id, v_node.template_node_id, v_node.id,
    v_new_assignee_ids, v_actor, p_comment,
    jsonb_build_object('reassigned', true, 'fromAssigneeUserIds', v_subject.current_assignee_user_ids),
    'reassign'
  );

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_subject.workflow_instance_id, v_node.template_node_id,
    'REOPENED'::public.workflow_instance_action, v_actor,
    coalesce(nullif(p_comment, ''), 'Reassigned workflow step'));

  v_first_assignee := v_new_assignee_ids[1];
  v_assignee_name := app_private.project_workflow_first_assignee_name(v_new_assignee_ids);
  v_sla_hours := app_private.project_workflow_runtime_sla_hours(v_node.id);
  v_due_at := app_private.project_workflow_runtime_sla_due_at(v_node.id);

  update public.workflow_subjects
  set current_assignee_user_id = v_first_assignee,
      current_assignee_user_ids = v_new_assignee_ids, updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set submitted_to_user_id = v_first_assignee::text, submitted_to_name = v_assignee_name,
      submitted_to_permission = app_private.project_workflow_runtime_primary_permission(v_node.id),
      submission_note = nullif(coalesce(p_comment, ''), ''),
      last_action_by = v_actor, last_action_at = now(),
      workflow_step_due_at = v_due_at, workflow_step_sla_hours = v_sla_hours,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id, project_id, from_step, to_step, action, actor_user_id,
    target_user_id, target_permission, note, sla_hours, due_at, metadata
  )
  values (
    p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'material_department_review'),
    coalesce(v_request.workflow_step, 'material_department_review'), 'REASSIGNED', v_actor::text,
    v_first_assignee::text, app_private.project_workflow_runtime_primary_permission(v_node.id),
    nullif(coalesce(p_comment, ''), ''), v_sla_hours, v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'instanceNodeId', v_node.id,
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
  v_node public.workflow_instance_nodes%rowtype;
  v_dependency jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if nullif(coalesce(p_comment, ''), '') is null then raise exception 'reject reason is required'; end if;
  select * into v_subject from public.workflow_subjects ws
  where ws.subject_type = p_subject_type and ws.subject_id = p_subject_id for update;
  if not found then raise exception 'workflow subject not found'; end if;
  select * into v_request from public.requests r where r.id = p_subject_id for update;
  if not found then raise exception 'material request not found: %', p_subject_id; end if;
  if v_subject.status <> 'RUNNING' then raise exception 'workflow subject can only be rejected while running'; end if;
  if not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user is not allowed to reject this workflow';
  end if;

  select * into v_node from public.workflow_instance_nodes win where win.id = v_subject.current_instance_node_id;
  if not found or coalesce((v_node.config ->> 'allowReject')::boolean, true) = false then
    raise exception 'runtime workflow step does not allow reject';
  end if;
  v_dependency := public.get_project_workflow_rollback_dependencies(p_subject_type, p_subject_id);
  if not coalesce((v_dependency ->> 'allowed')::boolean, false) then
    raise exception 'reject is locked by active downstream dependencies: %', v_dependency;
  end if;

  update public.workflow_step_assignments
  set status = case when assignee_user_id = v_actor then 'REJECTED' else 'SKIPPED' end,
      acted_at = now(), action_comment = p_comment,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('rejectedByUserId', v_actor)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and instance_node_id = v_node.id
    and status = 'PENDING';

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_subject.workflow_instance_id, v_node.template_node_id,
    'REJECTED'::public.workflow_instance_action, v_actor, p_comment);

  update public.workflow_instances
  set status = 'REJECTED'::public.workflow_instance_status, updated_at = now()
  where id = v_subject.workflow_instance_id;
  update public.workflow_subjects
  set current_assignee_user_id = null, current_assignee_user_ids = '{}'::uuid[],
      last_action_instance_node_id = v_node.id, status = 'REJECTED', updated_at = now()
  where id = v_subject.id
  returning * into v_subject;
  update public.requests
  set status = 'REJECTED'::public.request_status,
      submitted_to_user_id = null, submitted_to_name = null, submitted_to_permission = null,
      submission_note = p_comment, last_action_by = v_actor, last_action_at = now(),
      workflow_step = 'rejected', workflow_step_started_at = now(),
      workflow_step_due_at = null, workflow_step_sla_hours = null,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id, project_id, from_step, to_step, action, actor_user_id, note, metadata
  )
  values (
    p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'material_department_review'),
    'rejected', 'REJECTED', v_actor::text, p_comment,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'instanceNodeId', v_node.id,
      'rollbackDependencies', v_dependency
    )
  );
  return v_subject;
end;
$$;

create or replace function public.rollback_completed_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_comment text
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
  v_target_node public.workflow_instance_nodes%rowtype;
  v_dependency jsonb;
  v_round_id uuid;
  v_assignee_ids uuid[];
  v_first_assignee uuid;
  v_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_to_step text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if nullif(coalesce(p_comment, ''), '') is null then raise exception 'rollback reason is required'; end if;

  select * into v_subject from public.workflow_subjects ws
  where ws.subject_type = p_subject_type and ws.subject_id = p_subject_id for update;
  if not found then raise exception 'workflow subject not found'; end if;
  select * into v_request from public.requests r where r.id = p_subject_id for update;
  if not found then raise exception 'material request not found: %', p_subject_id; end if;
  if v_subject.status <> 'COMPLETED' then raise exception 'only completed workflow can be rolled back'; end if;
  if not app_private.project_workflow_actor_is_admin(v_subject.id, v_actor) then
    raise exception 'only workflow admin can rollback a completed workflow';
  end if;

  v_dependency := public.get_project_workflow_rollback_dependencies(p_subject_type, p_subject_id);
  if not coalesce((v_dependency ->> 'allowed')::boolean, false) then
    raise exception 'rollback is locked by active downstream dependencies: %', v_dependency;
  end if;

  select * into v_target_node
  from public.workflow_instance_nodes win
  where win.id = v_subject.last_action_instance_node_id
    and win.workflow_instance_id = v_subject.workflow_instance_id;

  if not found then
    select win.* into v_target_node
    from public.workflow_step_assignments wsa
    join public.workflow_instance_nodes win on win.id = wsa.instance_node_id
    where wsa.workflow_subject_id = v_subject.id
      and win.type <> 'END'::public.workflow_node_type
      and wsa.status in ('APPROVED', 'SKIPPED')
    order by wsa.acted_at desc nulls last, wsa.assigned_at desc
    limit 1;
  end if;
  if not found then raise exception 'last actionable runtime workflow step not found'; end if;

  select wsa.assignment_round_id into v_round_id
  from public.workflow_step_assignments wsa
  where wsa.workflow_subject_id = v_subject.id
    and wsa.instance_node_id = v_target_node.id
    and wsa.assignment_round_id is not null
    and wsa.assignment_source not in ('return_to_creator', 'rollback')
  order by wsa.assigned_at desc
  limit 1;

  if v_round_id is not null then
    select coalesce(array_agg(distinct wsa.assignee_user_id), '{}'::uuid[])
      into v_assignee_ids
    from public.workflow_step_assignments wsa
    where wsa.workflow_subject_id = v_subject.id
      and wsa.assignment_round_id = v_round_id
      and wsa.assignee_user_id is not null;
  else
    select coalesce(array_agg(distinct wsa.assignee_user_id), '{}'::uuid[])
      into v_assignee_ids
    from public.workflow_step_assignments wsa
    where wsa.workflow_subject_id = v_subject.id
      and wsa.instance_node_id = v_target_node.id
      and wsa.assignment_source not in ('return_to_creator', 'rollback')
      and wsa.assignee_user_id is not null;
  end if;

  if not app_private.project_workflow_runtime_assignees_are_eligible(
    p_subject_type, p_subject_id, v_target_node.id, v_assignee_ids
  ) then
    raise exception 'previous assignee pool is no longer eligible; reassign before rollback is required';
  end if;

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id, v_subject.workflow_instance_id, v_target_node.template_node_id, v_target_node.id,
    v_assignee_ids, v_actor, p_comment,
    jsonb_build_object('rollbackCompletedWorkflow', true, 'rollbackDependencies', v_dependency),
    'rollback'
  );

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_subject.workflow_instance_id, v_target_node.template_node_id,
    'REOPENED'::public.workflow_instance_action, v_actor, p_comment);

  v_first_assignee := v_assignee_ids[1];
  v_assignee_name := app_private.project_workflow_first_assignee_name(v_assignee_ids);
  v_sla_hours := app_private.project_workflow_runtime_sla_hours(v_target_node.id);
  v_due_at := app_private.project_workflow_runtime_sla_due_at(v_target_node.id);
  v_to_step := app_private.project_workflow_runtime_to_coarse_step(v_subject.workflow_instance_id, v_target_node.id);

  update public.workflow_instances
  set current_node_id = v_target_node.template_node_id,
      current_instance_node_id = v_target_node.id,
      status = 'RUNNING'::public.workflow_instance_status,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || app_private.project_workflow_step_assignees_json(v_target_node.template_node_id, v_assignee_ids),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_first_assignee,
      current_assignee_user_ids = v_assignee_ids,
      current_node_id = v_target_node.template_node_id,
      current_instance_node_id = v_target_node.id,
      status = 'RUNNING', updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'PENDING'::public.request_status,
      submitted_to_user_id = v_first_assignee::text, submitted_to_name = v_assignee_name,
      submitted_to_permission = app_private.project_workflow_runtime_primary_permission(v_target_node.id),
      submission_note = p_comment, last_action_by = v_actor, last_action_at = now(),
      workflow_step = v_to_step, workflow_step_started_at = now(),
      workflow_step_due_at = v_due_at, workflow_step_sla_hours = v_sla_hours,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id, project_id, from_step, to_step, action, actor_user_id,
    target_user_id, target_permission, note, sla_hours, due_at, metadata
  )
  values (
    p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'batch_planning'),
    v_to_step, 'ROLLED_BACK', v_actor::text, v_first_assignee::text,
    app_private.project_workflow_runtime_primary_permission(v_target_node.id),
    p_comment, v_sla_hours, v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'toInstanceNodeId', v_target_node.id,
      'assigneeUserIds', v_assignee_ids,
      'rollbackDependencies', v_dependency
    )
  );
  return v_subject;
end;
$$;

create or replace function public.save_workflow_template_structure(
  p_template_id uuid,
  p_template jsonb,
  p_nodes jsonb,
  p_edges jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_validation jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not app_private.project_workflow_template_manager(p_template_id, v_actor) then
    raise exception 'user cannot edit this workflow template';
  end if;
  if jsonb_typeof(coalesce(p_nodes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_edges, '[]'::jsonb)) <> 'array' then
    raise exception 'nodes and edges must be arrays';
  end if;

  update public.workflow_templates
  set name = coalesce(nullif(p_template ->> 'name', ''), name),
      description = coalesce(p_template ->> 'description', description),
      is_active = coalesce((p_template ->> 'is_active')::boolean, is_active),
      custom_fields = coalesce(p_template -> 'custom_fields', custom_fields, '[]'::jsonb),
      managers = coalesce(array(select jsonb_array_elements_text(p_template -> 'managers')), managers, '{}'::text[]),
      default_watchers = coalesce(array(select jsonb_array_elements_text(p_template -> 'default_watchers')), default_watchers, '{}'::text[]),
      updated_at = now()
  where id = p_template_id;
  if not found then raise exception 'workflow template not found'; end if;

  delete from public.workflow_edges we where we.template_id = p_template_id;

  delete from public.workflow_nodes wn
  where wn.template_id = p_template_id
    and not exists (
      select 1
      from jsonb_array_elements(p_nodes) node(value)
      where node.value ->> 'id' = wn.id::text
    );

  insert into public.workflow_nodes(id, template_id, type, label, config, position_x, position_y)
  select
    (node.value ->> 'id')::uuid,
    p_template_id,
    (node.value ->> 'type')::public.workflow_node_type,
    node.value ->> 'label',
    coalesce(node.value -> 'config', '{}'::jsonb),
    coalesce((node.value ->> 'position_x')::double precision, 0),
    coalesce((node.value ->> 'position_y')::double precision, 0)
  from jsonb_array_elements(p_nodes) node(value)
  on conflict (id) do update
  set type = excluded.type, label = excluded.label, config = excluded.config,
      position_x = excluded.position_x, position_y = excluded.position_y;

  insert into public.workflow_edges(id, template_id, source_node_id, target_node_id, label)
  select
    (edge.value ->> 'id')::uuid,
    p_template_id,
    (edge.value ->> 'source_node_id')::uuid,
    (edge.value ->> 'target_node_id')::uuid,
    coalesce(edge.value ->> 'label', '')
  from jsonb_array_elements(p_edges) edge(value);

  v_validation := app_private.project_workflow_validate_template(p_template_id);
  if not coalesce((v_validation ->> 'valid')::boolean, false) then
    raise exception 'invalid workflow template structure: %', v_validation;
  end if;
  return v_validation;
end;
$$;

create or replace function app_private.prevent_used_workflow_template_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.project_workflow_bindings b where b.workflow_template_id = old.id)
     or exists (select 1 from public.workflow_template_versions v where v.template_id = old.id)
     or exists (select 1 from public.workflow_instances i where i.template_id = old.id) then
    raise exception 'workflow template has bindings/versions/instances and must be deactivated instead of deleted';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_prevent_used_workflow_template_delete on public.workflow_templates;
create trigger trg_prevent_used_workflow_template_delete
before delete on public.workflow_templates
for each row execute function app_private.prevent_used_workflow_template_delete();

create or replace function app_private.material_request_workflow_participant_can_select(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workflow_subjects ws
    where ws.subject_type = 'material_request'
      and ws.subject_id = p_request_id
      and app_private.project_workflow_actor_can_select(ws.id)
  );
$$;

create or replace function app_private.project_workflow_instance_can_select(p_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.workflow_subjects ws where ws.workflow_instance_id = p_instance_id
  ) or exists (
    select 1
    from public.workflow_subjects ws
    where ws.workflow_instance_id = p_instance_id
      and app_private.project_workflow_actor_can_select(ws.id)
  );
$$;

create or replace function app_private.prevent_project_workflow_instance_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.workflow_subjects ws where ws.workflow_instance_id = old.id
  ) then
    raise exception 'project-linked workflow instances cannot be deleted';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_prevent_project_workflow_instance_delete on public.workflow_instances;
create trigger trg_prevent_project_workflow_instance_delete
before delete on public.workflow_instances
for each row execute function app_private.prevent_project_workflow_instance_delete();

create or replace function app_private.material_request_batch_is_fully_reversed(p_batch_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_batch public.material_request_fulfillment_batches%rowtype;
  v_transaction_status text;
  v_return_transaction_ids text[] := '{}'::text[];
  v_has_unfinished_return boolean := false;
  v_has_insufficient_return boolean := false;
begin
  select * into v_batch
  from public.material_request_fulfillment_batches b
  where b.id = p_batch_id;

  if not found
     or lower(coalesce(v_batch.status::text, '')) not in ('cancelled', 'canceled', 'returned', 'reversed', 'void') then
    return false;
  end if;

  if v_batch.transaction_id is null then
    return not exists (
      select 1
      from public.material_request_fulfillment_lines line
      where line.batch_id = p_batch_id
        and case when coalesce(line.received_qty, 0) > 0
          then coalesce(line.received_qty, 0) else coalesce(line.issued_qty, 0) end > 0
    );
  end if;

  select upper(coalesce(t.status::text, '')) into v_transaction_status
  from public.transactions t
  where t.id::text = v_batch.transaction_id::text;

  if coalesce(v_transaction_status, '') = 'CANCELLED' then
    return true;
  end if;
  if coalesce(v_transaction_status, '') <> 'COMPLETED' then
    return false;
  end if;

  select coalesce(array_agg(distinct match[1]), '{}'::text[])
    into v_return_transaction_ids
  from regexp_matches(
    coalesce(v_batch.note, ''),
    'Phiếu hoàn kho:[[:space:]]*([^[:space:]|]+)',
    'gi'
  ) as match;

  if coalesce(array_length(v_return_transaction_ids, 1), 0) = 0 then
    return false;
  end if;

  select exists (
    select 1
    from unnest(v_return_transaction_ids) return_id
    left join public.transactions t
      on t.id::text = return_id
     and upper(coalesce(t.status::text, '')) = 'COMPLETED'
    where t.id is null
  ) into v_has_unfinished_return;
  if v_has_unfinished_return then
    return false;
  end if;

  select exists (
    with line_required as (
      select line.item_id::text as item_id,
        sum(case when coalesce(line.received_qty, 0) > 0
          then coalesce(line.received_qty, 0) else coalesce(line.issued_qty, 0) end)::numeric as qty
      from public.material_request_fulfillment_lines line
      where line.batch_id = p_batch_id
        and line.item_id is not null
        and case when coalesce(line.received_qty, 0) > 0
          then coalesce(line.received_qty, 0) else coalesce(line.issued_qty, 0) end > 0
      group by line.item_id::text
    ),
    transaction_required as (
      select
        coalesce(item.value ->> 'itemId', item.value ->> 'item_id') as item_id,
        sum(coalesce(nullif(item.value ->> 'quantity', '')::numeric, 0))::numeric as qty
      from public.transactions t
      cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) item(value)
      where t.id::text = v_batch.transaction_id::text
        and coalesce(item.value ->> 'itemId', item.value ->> 'item_id') is not null
      group by coalesce(item.value ->> 'itemId', item.value ->> 'item_id')
    ),
    required as (
      select item_id, qty from line_required
      union all
      select item_id, qty from transaction_required
      where not exists (select 1 from line_required)
    ),
    returned as (
      select
        coalesce(item.value ->> 'itemId', item.value ->> 'item_id') as item_id,
        sum(coalesce(nullif(item.value ->> 'quantity', '')::numeric, 0))::numeric as qty
      from public.transactions t
      cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) item(value)
      where t.id::text = any(v_return_transaction_ids)
        and upper(coalesce(t.status::text, '')) = 'COMPLETED'
        and coalesce(item.value ->> 'itemId', item.value ->> 'item_id') is not null
      group by coalesce(item.value ->> 'itemId', item.value ->> 'item_id')
    )
    select 1
    from required req
    left join returned ret on ret.item_id = req.item_id
    where coalesce(ret.qty, 0) + 0.000000001 < req.qty
    limit 1
  ) into v_has_insufficient_return;

  return not v_has_insufficient_return;
end;
$$;

create or replace function app_private.material_request_transaction_dependency_status(
  p_transaction_id text,
  p_request_id text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_is_original_batch_transaction boolean := false;
  v_is_return_transaction boolean := false;
begin
  select upper(coalesce(t.status::text, '')) into v_status
  from public.transactions t
  where t.id::text = p_transaction_id;

  if coalesce(v_status, '') in ('CANCELLED', 'CANCELED', 'REVERSED', 'VOID') then
    return 'reversed';
  end if;

  select exists (
    select 1
    from public.material_request_fulfillment_batches b
    where b.material_request_id = p_request_id
      and b.transaction_id::text = p_transaction_id
  ) into v_is_original_batch_transaction;

  if v_is_original_batch_transaction
     and not exists (
       select 1
       from public.material_request_fulfillment_batches b
       where b.material_request_id = p_request_id
         and b.transaction_id::text = p_transaction_id
         and not app_private.material_request_batch_is_fully_reversed(b.id)
     ) then
    return 'reversed';
  end if;

  select exists (
    select 1
    from public.material_request_fulfillment_batches b
    cross join lateral regexp_matches(
      coalesce(b.note, ''),
      'Phiếu hoàn kho:[[:space:]]*([^[:space:]|]+)',
      'gi'
    ) match
    where b.material_request_id = p_request_id
      and match[1] = p_transaction_id
  ) into v_is_return_transaction;

  if v_is_return_transaction
     and coalesce(v_status, '') = 'COMPLETED'
     and not exists (
       select 1
       from public.material_request_fulfillment_batches b
       cross join lateral regexp_matches(
         coalesce(b.note, ''),
         'Phiếu hoàn kho:[[:space:]]*([^[:space:]|]+)',
         'gi'
       ) match
       where b.material_request_id = p_request_id
         and match[1] = p_transaction_id
         and not app_private.material_request_batch_is_fully_reversed(b.id)
     ) then
    return 'reversed';
  end if;

  return 'active';
end;
$$;

create or replace function app_private.sync_material_request_downstream_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id text;
  v_target_type text;
  v_target_id text;
  v_project_id text;
  v_status text;
  v_transaction_id text;
begin
  if tg_table_name = 'material_request_fulfillment_batches' then
    v_request_id := new.material_request_id;
    v_target_type := 'fulfillment_batch';
    v_target_id := new.id::text;
    v_project_id := new.project_id;
    v_status := case when app_private.material_request_batch_is_fully_reversed(new.id)
      then 'reversed' else 'active' end;
  elsif tg_table_name = 'purchase_order_request_lines' then
    v_request_id := coalesce(new.material_request_id, old.material_request_id);
    v_target_type := 'purchase_order';
    v_target_id := coalesce(new.purchase_order_id, old.purchase_order_id);
    v_project_id := coalesce(new.project_id, old.project_id);
    v_status := case when tg_op = 'DELETE' then 'void' else 'active' end;
  elsif tg_table_name = 'transactions' then
    v_request_id := new.related_request_id;
    v_target_type := 'transaction';
    v_target_id := new.id::text;
    select r.project_id into v_project_id from public.requests r where r.id = v_request_id;
    v_status := app_private.material_request_transaction_dependency_status(new.id::text, v_request_id);
  else
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if coalesce(v_request_id, '') <> '' then
    insert into public.project_document_links(
      source_type, source_id, target_type, target_id, project_id,
      relation_type, status, metadata
    )
    values (
      'material_request', v_request_id, v_target_type, v_target_id, v_project_id,
      'downstream', v_status, jsonb_build_object('syncedFrom', tg_table_name)
    )
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set status = excluded.status, project_id = excluded.project_id,
      metadata = coalesce(public.project_document_links.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now();
  end if;

  if tg_table_name = 'material_request_fulfillment_batches' then
    for v_transaction_id in
      select distinct transaction_id
      from (
        select nullif(new.transaction_id::text, '') as transaction_id
        union all
        select match[1]
        from regexp_matches(
          coalesce(new.note, ''),
          'Phiếu hoàn kho:[[:space:]]*([^[:space:]|]+)',
          'gi'
        ) match
      ) transaction_ids
      where transaction_id is not null
    loop
      insert into public.project_document_links(
        source_type, source_id, target_type, target_id, project_id,
        relation_type, status, metadata
      )
      values (
        'material_request', v_request_id, 'transaction', v_transaction_id, v_project_id,
        'downstream',
        app_private.material_request_transaction_dependency_status(v_transaction_id, v_request_id),
        jsonb_build_object('syncedFrom', 'material_request_fulfillment_batches')
      )
      on conflict (source_type, source_id, target_type, target_id, relation_type)
      do update set status = excluded.status, project_id = excluded.project_id,
        metadata = coalesce(public.project_document_links.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();
    end loop;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function app_private.sync_purchase_order_request_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.project_document_links pdl
  set status = case
        when not exists (
          select 1
          from public.purchase_order_request_lines porl
          where porl.material_request_id = pdl.source_id
            and porl.purchase_order_id = new.id::text
        ) then 'void'
        when lower(coalesce(new.status::text, '')) in ('cancelled', 'canceled', 'returned', 'reversed', 'void')
          then 'reversed' else 'active' end,
      updated_at = now(),
      metadata = coalesce(pdl.metadata, '{}'::jsonb) || jsonb_build_object('syncedFrom', 'purchase_orders')
  where pdl.source_type = 'material_request'
    and pdl.target_type = 'purchase_order'
    and pdl.target_id = new.id::text
    and pdl.relation_type = 'downstream';
  return new;
end;
$$;

drop trigger if exists trg_sync_mr_fulfillment_dependency on public.material_request_fulfillment_batches;
create trigger trg_sync_mr_fulfillment_dependency
after insert or update of status on public.material_request_fulfillment_batches
for each row execute function app_private.sync_material_request_downstream_link();

drop trigger if exists trg_sync_mr_po_dependency on public.purchase_order_request_lines;
create trigger trg_sync_mr_po_dependency
after insert or update or delete on public.purchase_order_request_lines
for each row execute function app_private.sync_material_request_downstream_link();

drop trigger if exists trg_sync_po_request_dependency_status on public.purchase_orders;
create trigger trg_sync_po_request_dependency_status
after update of status on public.purchase_orders
for each row execute function app_private.sync_purchase_order_request_dependencies();

drop trigger if exists trg_sync_mr_transaction_dependency on public.transactions;
create trigger trg_sync_mr_transaction_dependency
after insert or update of status on public.transactions
for each row when (new.related_request_id is not null)
execute function app_private.sync_material_request_downstream_link();

insert into public.project_document_links(
  source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata
)
select
  'material_request', b.material_request_id, 'fulfillment_batch', b.id::text, b.project_id,
  'downstream',
  case when app_private.material_request_batch_is_fully_reversed(b.id)
    then 'reversed' else 'active' end,
  jsonb_build_object('backfilledFrom', 'material_request_fulfillment_batches')
from public.material_request_fulfillment_batches b
on conflict (source_type, source_id, target_type, target_id, relation_type)
do update set status = excluded.status, updated_at = now();

insert into public.project_document_links(
  source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata
)
select
  'material_request', po.material_request_id::text, 'purchase_order', po.id::text,
  po.project_id, 'downstream',
  case when lower(coalesce(po.status::text, '')) in ('cancelled', 'canceled', 'returned', 'reversed', 'void')
    then 'reversed' else 'active' end,
  jsonb_build_object('backfilledFrom', 'purchase_orders')
from public.purchase_orders po
where po.material_request_id is not null
on conflict (source_type, source_id, target_type, target_id, relation_type)
do update set status = excluded.status, project_id = excluded.project_id, updated_at = now();

insert into public.project_document_links(
  source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata
)
select distinct
  'material_request', porl.material_request_id, 'purchase_order', porl.purchase_order_id,
  porl.project_id, 'downstream',
  case when lower(coalesce(po.status::text, '')) in ('cancelled', 'canceled', 'returned', 'reversed', 'void')
    then 'reversed' else 'active' end,
  jsonb_build_object('backfilledFrom', 'purchase_order_request_lines')
from public.purchase_order_request_lines porl
join public.purchase_orders po on po.id = porl.purchase_order_id
on conflict (source_type, source_id, target_type, target_id, relation_type)
do update set status = excluded.status, updated_at = now();

insert into public.project_document_links(
  source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata
)
select
  'material_request', t.related_request_id, 'transaction', t.id::text, r.project_id,
  'downstream',
  app_private.material_request_transaction_dependency_status(t.id::text, t.related_request_id),
  jsonb_build_object('backfilledFrom', 'transactions')
from public.transactions t
left join public.requests r on r.id = t.related_request_id
where t.related_request_id is not null
on conflict (source_type, source_id, target_type, target_id, relation_type)
do update set status = excluded.status, updated_at = now();

insert into public.project_document_links(
  source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata
)
select distinct
  'material_request', b.material_request_id, 'transaction', transaction_ids.transaction_id, b.project_id,
  'downstream',
  app_private.material_request_transaction_dependency_status(transaction_ids.transaction_id, b.material_request_id),
  jsonb_build_object('backfilledFrom', 'material_request_fulfillment_batches')
from public.material_request_fulfillment_batches b
cross join lateral (
  select nullif(b.transaction_id::text, '') as transaction_id
  union
  select match[1]
  from regexp_matches(
    coalesce(b.note, ''),
    'Phiếu hoàn kho:[[:space:]]*([^[:space:]|]+)',
    'gi'
  ) match
) transaction_ids
where transaction_ids.transaction_id is not null
on conflict (source_type, source_id, target_type, target_id, relation_type)
do update set status = excluded.status, project_id = excluded.project_id,
  metadata = coalesce(public.project_document_links.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

create or replace function public.process_project_workflow_sla_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_kind text;
  v_inserted_id uuid;
  v_count integer := 0;
begin
  for v_row in
    select
      wsa.id as assignment_id,
      wsa.workflow_subject_id,
      wsa.assignee_user_id,
      wsa.assigned_at,
      wsa.due_at,
      win.label as node_label,
      ws.subject_id,
      ws.project_id,
      ws.construction_site_id,
      r.code as request_code
    from public.workflow_step_assignments wsa
    join public.workflow_subjects ws on ws.id = wsa.workflow_subject_id
    join public.workflow_instance_nodes win on win.id = wsa.instance_node_id
    join public.requests r on r.id = ws.subject_id
    where wsa.status = 'PENDING'
      and ws.status = 'RUNNING'
      and wsa.due_at is not null
      and wsa.assignee_user_id is not null
      and now() >= wsa.assigned_at + ((wsa.due_at - wsa.assigned_at) * 0.75)
  loop
    v_kind := case when now() > v_row.due_at then 'OVERDUE' else 'DUE_SOON' end;
    v_inserted_id := null;
    insert into public.workflow_sla_notifications(
      workflow_step_assignment_id, workflow_subject_id, user_id, notification_kind
    )
    values (v_row.assignment_id, v_row.workflow_subject_id, v_row.assignee_user_id, v_kind)
    on conflict (workflow_step_assignment_id, notification_kind) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is not null then
      insert into public.notifications(
        user_id, type, category, title, message, icon, link, severity,
        source_type, source_id, construction_site_id, metadata
      )
      values (
        v_row.assignee_user_id::text,
        case when v_kind = 'OVERDUE' then 'error' else 'warning' end,
        'material',
        case when v_kind = 'OVERDUE' then 'Phiếu vật tư đã quá SLA' else 'Phiếu vật tư sắp đến hạn SLA' end,
        coalesce(v_row.request_code, v_row.subject_id) || ' - bước ' || v_row.node_label,
        null,
        '/da?projectId=' || coalesce(v_row.project_id, '') || '&siteId=' || coalesce(v_row.construction_site_id, '') || '&tab=material&materialTab=request',
        case when v_kind = 'OVERDUE' then 'critical' else 'warning' end,
        'workflow_sla',
        v_row.assignment_id::text || ':' || v_kind,
        v_row.construction_site_id,
        jsonb_build_object(
          'workflowSubjectId', v_row.workflow_subject_id,
          'assignmentId', v_row.assignment_id,
          'requestId', v_row.subject_id,
          'notificationKind', v_kind,
          'dueAt', v_row.due_at
        )
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'project-workflow-sla-reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'project-workflow-sla-reminders',
    '*/10 * * * *',
    'select public.process_project_workflow_sla_reminders();'
  );
end $$;

do $$
begin
  if to_regprocedure('public.get_project_workflow_rollback_dependencies(text,text)') is not null
     and to_regprocedure('public.get_project_workflow_rollback_dependencies_legacy(text,text)') is null then
    alter function public.get_project_workflow_rollback_dependencies(text, text)
      rename to get_project_workflow_rollback_dependencies_legacy;
  end if;
end $$;

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
  v_subject_id uuid;
  v_result jsonb;
begin
  if public.current_app_user_id() is null then raise exception 'authentication required'; end if;
  select ws.id into v_subject_id
  from public.workflow_subjects ws
  where ws.subject_type = p_subject_type and ws.subject_id = p_subject_id;
  if v_subject_id is null then raise exception 'workflow subject not found'; end if;
  if not app_private.project_workflow_actor_can_select(v_subject_id) then
    raise exception 'user cannot view workflow rollback dependencies';
  end if;

  if p_subject_type <> 'material_request' then
    return jsonb_build_object(
      'allowed', false,
      'activeCount', 1,
      'dependencies', jsonb_build_array(
        jsonb_build_object('type', 'unsupported_subject', 'status', 'active')
      )
    );
  end if;

  with candidates as (
    select
      pdl.target_type as type,
      pdl.target_id as id,
      pdl.status,
      'project_document_links'::text as source,
      10 as priority
    from public.project_document_links pdl
    where pdl.source_type = p_subject_type
      and pdl.source_id = p_subject_id
      and pdl.relation_type = 'downstream'

    union all

    select
      'fulfillment_batch'::text,
      b.id::text,
      case when app_private.material_request_batch_is_fully_reversed(b.id)
        then 'reversed' else 'active' end,
      'material_request_fulfillment_batches'::text,
      100
    from public.material_request_fulfillment_batches b
    where b.material_request_id = p_subject_id

    union all

    select
      'purchase_order'::text,
      po.id::text,
      case when lower(coalesce(po.status::text, '')) in ('cancelled', 'canceled', 'returned', 'reversed', 'void')
        then 'reversed' else 'active' end,
      'purchase_orders'::text,
      100
    from public.purchase_orders po
    where coalesce(po.material_request_id::text, '') = p_subject_id

    union all

    select distinct
      'purchase_order'::text,
      po.id::text,
      case when lower(coalesce(po.status::text, '')) in ('cancelled', 'canceled', 'returned', 'reversed', 'void')
        then 'reversed' else 'active' end,
      'purchase_order_request_lines'::text,
      100
    from public.purchase_order_request_lines porl
    join public.purchase_orders po on po.id = porl.purchase_order_id
    where porl.material_request_id = p_subject_id

    union all

    select
      'transaction'::text,
      t.id::text,
      app_private.material_request_transaction_dependency_status(t.id::text, p_subject_id),
      'transactions'::text,
      100
    from public.transactions t
    where coalesce(t.related_request_id, '') = p_subject_id
       or exists (
         select 1
         from jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) item(value)
         where coalesce(
           item.value ->> 'materialRequestId',
           item.value ->> 'material_request_id'
         ) = p_subject_id
       )
  ),
  ranked as (
    select
      type, id, status, source,
      row_number() over (
        partition by type, id
        order by priority desc, case when status = 'active' then 0 else 1 end, source
      ) as row_number
    from candidates
  ),
  dependencies as (
    select type, id, status, source
    from ranked
    where row_number = 1
  )
  select jsonb_build_object(
    'allowed', count(*) filter (where status = 'active') = 0,
    'activeCount', count(*) filter (where status = 'active'),
    'dependencies', coalesce(
      jsonb_agg(
        jsonb_build_object('type', type, 'id', id, 'status', status, 'source', source)
        order by type, id
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from dependencies;

  return coalesce(
    v_result,
    jsonb_build_object('allowed', true, 'activeCount', 0, 'dependencies', '[]'::jsonb)
  );
end;
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
    p_subject_type, p_subject_id, p_template_id,
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
    p_subject_type, p_subject_id,
    case when p_next_assignee_user_id is null then '{}'::uuid[] else array[p_next_assignee_user_id] end,
    p_comment
  );
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
    p_subject_type, p_subject_id,
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
    p_subject_type, p_subject_id, array[p_new_assignee_user_id], p_comment
  );
$$;

-- Template managers and WF module admins can edit assigned/visible templates,
-- but only System Admin can create or delete templates.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('workflow_templates', 'workflow_nodes', 'workflow_edges')
  loop
    execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_policy.tablename);
  end loop;
end $$;

alter table public.workflow_templates enable row level security;
alter table public.workflow_nodes enable row level security;
alter table public.workflow_edges enable row level security;

create policy workflow_templates_select
  on public.workflow_templates for select to authenticated using (true);
create policy workflow_templates_insert
  on public.workflow_templates for insert to authenticated
  with check (public.is_admin());
create policy workflow_templates_update
  on public.workflow_templates for update to authenticated
  using (app_private.project_workflow_template_manager(id, public.current_app_user_id()))
  with check (app_private.project_workflow_template_manager(id, public.current_app_user_id()));
create policy workflow_templates_delete
  on public.workflow_templates for delete to authenticated
  using (public.is_admin());

create policy workflow_nodes_select
  on public.workflow_nodes for select to authenticated using (true);
create policy workflow_nodes_insert
  on public.workflow_nodes for insert to authenticated
  with check (app_private.project_workflow_template_manager(template_id, public.current_app_user_id()));
create policy workflow_nodes_update
  on public.workflow_nodes for update to authenticated
  using (app_private.project_workflow_template_manager(template_id, public.current_app_user_id()))
  with check (app_private.project_workflow_template_manager(template_id, public.current_app_user_id()));
create policy workflow_nodes_delete
  on public.workflow_nodes for delete to authenticated
  using (app_private.project_workflow_template_manager(template_id, public.current_app_user_id()));

create policy workflow_edges_select
  on public.workflow_edges for select to authenticated using (true);
create policy workflow_edges_insert
  on public.workflow_edges for insert to authenticated
  with check (app_private.project_workflow_template_manager(template_id, public.current_app_user_id()));
create policy workflow_edges_update
  on public.workflow_edges for update to authenticated
  using (app_private.project_workflow_template_manager(template_id, public.current_app_user_id()))
  with check (app_private.project_workflow_template_manager(template_id, public.current_app_user_id()));
create policy workflow_edges_delete
  on public.workflow_edges for delete to authenticated
  using (app_private.project_workflow_template_manager(template_id, public.current_app_user_id()));

drop policy if exists requests_select on public.requests;
create policy requests_select
  on public.requests for select to authenticated
  using (
    app_private.material_request_can_select(
      request_origin, project_id, requester_id, submitted_to_user_id,
      source_warehouse_id, site_warehouse_id
    )
    or app_private.material_request_workflow_participant_can_select(id)
  );

drop policy if exists wf_inst_select on public.workflow_instances;
create policy wf_inst_select
  on public.workflow_instances for select to authenticated
  using (app_private.project_workflow_instance_can_select(id));

drop policy if exists wf_logs_select on public.workflow_instance_logs;
create policy wf_logs_select
  on public.workflow_instance_logs for select to authenticated
  using (app_private.project_workflow_instance_can_select(instance_id));

drop policy if exists wf_inst_delete on public.workflow_instances;
create policy wf_inst_delete
  on public.workflow_instances for delete to authenticated
  using (
    not exists (
      select 1 from public.workflow_subjects ws where ws.workflow_instance_id = workflow_instances.id
    )
    and (
      public.is_admin()
      or created_by = public.current_app_user_id()
    )
  );

drop policy if exists workflow_sla_notifications_select on public.workflow_sla_notifications;
create policy workflow_sla_notifications_select
  on public.workflow_sla_notifications for select to authenticated
  using (app_private.project_workflow_actor_can_select(workflow_subject_id));

revoke all on table public.workflow_sla_notifications from anon;
revoke all on table public.workflow_sla_notifications from public;
revoke all on table public.workflow_sla_notifications from authenticated;
grant select on table public.workflow_sla_notifications to authenticated;

revoke insert, update, delete on table public.project_workflow_bindings from authenticated;
grant select on table public.project_workflow_bindings to authenticated;

-- Runtime state and assignment history are write-only through the guarded RPCs.
-- This also guarantees workflow managers cannot delete instance/audit data.
drop policy if exists workflow_subjects_insert on public.workflow_subjects;
drop policy if exists workflow_subjects_update on public.workflow_subjects;
drop policy if exists workflow_subjects_delete on public.workflow_subjects;
drop policy if exists workflow_step_assignments_insert on public.workflow_step_assignments;
drop policy if exists workflow_step_assignments_update on public.workflow_step_assignments;
drop policy if exists workflow_step_assignments_delete on public.workflow_step_assignments;

revoke insert, update, delete on table public.workflow_subjects from public;
revoke insert, update, delete on table public.workflow_subjects from anon;
revoke insert, update, delete on table public.workflow_subjects from authenticated;
grant select on table public.workflow_subjects to authenticated;

revoke insert, update, delete on table public.workflow_step_assignments from public;
revoke insert, update, delete on table public.workflow_step_assignments from anon;
revoke insert, update, delete on table public.workflow_step_assignments from authenticated;
grant select on table public.workflow_step_assignments to authenticated;

-- Project workflow snapshots, participants and dependency links are immutable
-- through the Data API. Guarded functions/triggers remain the only writers.
drop policy if exists workflow_template_versions_write on public.workflow_template_versions;
drop policy if exists workflow_instance_nodes_write on public.workflow_instance_nodes;
drop policy if exists workflow_instance_edges_write on public.workflow_instance_edges;
drop policy if exists workflow_participants_write on public.workflow_participants;
drop policy if exists project_document_links_write on public.project_document_links;

revoke all on table public.workflow_template_versions from authenticated;
grant select on table public.workflow_template_versions to authenticated;
revoke all on table public.workflow_instance_nodes from authenticated;
grant select on table public.workflow_instance_nodes to authenticated;
revoke all on table public.workflow_instance_edges from authenticated;
grant select on table public.workflow_instance_edges to authenticated;
revoke all on table public.workflow_participants from authenticated;
grant select on table public.workflow_participants to authenticated;
revoke all on table public.project_document_links from authenticated;
grant select on table public.project_document_links to authenticated;

-- Generic workflow instances/logs keep their existing write model. Once an
-- instance is linked to a project subject, only SECURITY DEFINER RPCs may
-- mutate it or append audit logs.
drop policy if exists project_workflow_instances_no_direct_update on public.workflow_instances;
create policy project_workflow_instances_no_direct_update
  on public.workflow_instances
  as restrictive
  for update
  to authenticated
  using (
    not exists (
      select 1 from public.workflow_subjects ws
      where ws.workflow_instance_id = workflow_instances.id
    )
  )
  with check (
    not exists (
      select 1 from public.workflow_subjects ws
      where ws.workflow_instance_id = workflow_instances.id
    )
  );

drop policy if exists project_workflow_logs_no_direct_insert on public.workflow_instance_logs;
create policy project_workflow_logs_no_direct_insert
  on public.workflow_instance_logs
  as restrictive
  for insert
  to authenticated
  with check (
    not exists (
      select 1 from public.workflow_subjects ws
      where ws.workflow_instance_id = workflow_instance_logs.instance_id
    )
  );

drop policy if exists project_workflow_logs_no_direct_update on public.workflow_instance_logs;
create policy project_workflow_logs_no_direct_update
  on public.workflow_instance_logs
  as restrictive
  for update
  to authenticated
  using (
    not exists (
      select 1 from public.workflow_subjects ws
      where ws.workflow_instance_id = workflow_instance_logs.instance_id
    )
  )
  with check (
    not exists (
      select 1 from public.workflow_subjects ws
      where ws.workflow_instance_id = workflow_instance_logs.instance_id
    )
  );

drop policy if exists project_workflow_logs_no_direct_delete on public.workflow_instance_logs;
create policy project_workflow_logs_no_direct_delete
  on public.workflow_instance_logs
  as restrictive
  for delete
  to authenticated
  using (
    not exists (
      select 1 from public.workflow_subjects ws
      where ws.workflow_instance_id = workflow_instance_logs.instance_id
    )
  );

revoke execute on function public.start_project_workflow_v2_legacy(text, text, uuid, uuid[], text) from public;
revoke execute on function public.start_project_workflow_v2_legacy(text, text, uuid, uuid[], text) from anon;
revoke execute on function public.start_project_workflow_v2_legacy(text, text, uuid, uuid[], text) from authenticated;

revoke execute on function public.get_project_workflow_rollback_dependencies_legacy(text, text) from public;
revoke execute on function public.get_project_workflow_rollback_dependencies_legacy(text, text) from anon;
revoke execute on function public.get_project_workflow_rollback_dependencies_legacy(text, text) from authenticated;
revoke execute on function public.get_project_workflow_rollback_dependencies(text, text) from public;
revoke execute on function public.get_project_workflow_rollback_dependencies(text, text) from anon;
grant execute on function public.get_project_workflow_rollback_dependencies(text, text) to authenticated;

revoke execute on function public.get_project_workflow_configuration(text, text, text) from public;
revoke execute on function public.get_project_workflow_configuration(text, text, text) from anon;
grant execute on function public.get_project_workflow_configuration(text, text, text) to authenticated;

revoke execute on function public.set_project_workflow_binding(text, uuid, text, text) from public;
revoke execute on function public.set_project_workflow_binding(text, uuid, text, text) from anon;
grant execute on function public.set_project_workflow_binding(text, uuid, text, text) to authenticated;

revoke execute on function public.remove_project_workflow_binding(text, text, text) from public;
revoke execute on function public.remove_project_workflow_binding(text, text, text) from anon;
grant execute on function public.remove_project_workflow_binding(text, text, text) to authenticated;

revoke execute on function public.save_workflow_template_structure(uuid, jsonb, jsonb, jsonb) from public;
revoke execute on function public.save_workflow_template_structure(uuid, jsonb, jsonb, jsonb) from anon;
grant execute on function public.save_workflow_template_structure(uuid, jsonb, jsonb, jsonb) to authenticated;

revoke execute on function public.rollback_completed_project_workflow(text, text, text) from public;
revoke execute on function public.rollback_completed_project_workflow(text, text, text) from anon;
grant execute on function public.rollback_completed_project_workflow(text, text, text) to authenticated;

revoke execute on function public.process_project_workflow_sla_reminders() from public;
revoke execute on function public.process_project_workflow_sla_reminders() from anon;
revoke execute on function public.process_project_workflow_sla_reminders() from authenticated;

revoke execute on function public.start_project_workflow_v2(text, text, uuid, uuid[], text) from public;
revoke execute on function public.start_project_workflow_v2(text, text, uuid, uuid[], text) from anon;
grant execute on function public.start_project_workflow_v2(text, text, uuid, uuid[], text) to authenticated;

revoke execute on function public.advance_project_workflow_v2(text, text, uuid[], text) from public;
revoke execute on function public.advance_project_workflow_v2(text, text, uuid[], text) from anon;
grant execute on function public.advance_project_workflow_v2(text, text, uuid[], text) to authenticated;

revoke execute on function public.return_project_workflow_v2(text, text, text) from public;
revoke execute on function public.return_project_workflow_v2(text, text, text) from anon;
grant execute on function public.return_project_workflow_v2(text, text, text) to authenticated;

revoke execute on function public.resubmit_project_workflow_v2(text, text, uuid[], text) from public;
revoke execute on function public.resubmit_project_workflow_v2(text, text, uuid[], text) from anon;
grant execute on function public.resubmit_project_workflow_v2(text, text, uuid[], text) to authenticated;

revoke execute on function public.reassign_project_workflow_v2(text, text, uuid[], text) from public;
revoke execute on function public.reassign_project_workflow_v2(text, text, uuid[], text) from anon;
grant execute on function public.reassign_project_workflow_v2(text, text, uuid[], text) to authenticated;

revoke execute on function public.reject_project_workflow(text, text, text) from public;
revoke execute on function public.reject_project_workflow(text, text, text) from anon;
grant execute on function public.reject_project_workflow(text, text, text) to authenticated;

notify pgrst, 'reload schema';

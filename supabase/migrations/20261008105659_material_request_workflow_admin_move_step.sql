-- Quản trị quy trình duyệt Đề xuất vật tư: một action Room mới ('manage') cho phép
-- chuyển phiếu tới bất kỳ bước nào của quy trình, tiến hoặc lùi, không cần người
-- đang xử lý duyệt. Chuyển bước luôn bắt buộc lý do và để lại dấu vết trong
-- workflow_instance_logs + material_request_events.

alter table public.project_permission_rooms
  drop constraint project_permission_rooms_allowed_actions_check;

alter table public.project_permission_rooms
  add constraint project_permission_rooms_allowed_actions_check check (
    allowed_actions <@ array[
      'view', 'edit', 'delete', 'submit', 'return', 'verify', 'confirm',
      'approve', 'publish_progress', 'view_available_stock', 'view_resource_evidence',
      'manage'
    ]::text[]
  );

alter table public.project_permission_room_member_actions
  drop constraint project_permission_room_member_actions_code_check;

alter table public.project_permission_room_member_actions
  add constraint project_permission_room_member_actions_code_check check (
    action_code = any(array[
      'view', 'edit', 'delete', 'submit', 'return', 'verify', 'confirm',
      'approve', 'publish_progress', 'view_available_stock', 'view_resource_evidence',
      'manage'
    ]::text[])
  );

update public.project_permission_rooms
set allowed_actions = case
      when 'manage' = any(allowed_actions) then allowed_actions
      else array_append(allowed_actions, 'manage')
    end,
    updated_at = now()
where code = 'material_request';

-- Mã quyền project.material_request.manage đã có sẵn trong permission_actions; room action
-- 'manage' chỉ ánh xạ vào mã đó.
-- Chưa từng cấp qua đường PBAC cho nghiệp vụ này nên tắt fallback, chỉ tin Room.
insert into app_private.project_permission_room_action_bindings (
  room_code, action_code, legacy_permission_codes, enforcement_status,
  relationship_description, pbac_fallback_enabled, prerequisite_action_codes,
  verified_at, verified_source, created_at, updated_at
) values (
  'material_request', 'manage',
  array['project.material_request.manage']::text[], 'enforced',
  'Workflow administrators may move a material request to any step; requires room view.',
  false, array['view']::text[],
  now(), 'material_request_workflow_admin_move_step', now(), now()
)
on conflict (room_code, action_code) do update
set legacy_permission_codes = excluded.legacy_permission_codes,
    enforcement_status = 'enforced',
    relationship_description = excluded.relationship_description,
    pbac_fallback_enabled = false,
    prerequisite_action_codes = excluded.prerequisite_action_codes,
    verified_at = now(),
    verified_source = excluded.verified_source,
    updated_at = now();

create or replace function public.admin_move_project_workflow_step(
  p_subject_type text,
  p_subject_id text,
  p_target_template_node_id uuid,
  p_assignee_user_ids uuid[],
  p_comment text
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.requests%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_from_node public.workflow_instance_nodes%rowtype;
  v_target public.workflow_instance_nodes%rowtype;
  v_assignee_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_assignee_user_ids);
  v_first_assignee uuid;
  v_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_to_step text;
  v_previous_context text := current_setting('app.material_request_workflow_context', true);
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;
  if v_comment is null then
    raise exception 'Bắt buộc nhập lý do khi chuyển bước.' using errcode = '23514';
  end if;

  select * into v_subject from public.workflow_subjects ws
  where ws.subject_type = p_subject_type and ws.subject_id = p_subject_id
  for update;
  if not found then raise exception 'workflow subject not found'; end if;
  select * into v_request from public.requests r where r.id = p_subject_id for update;
  if not found then raise exception 'material request not found: %', p_subject_id; end if;

  if not public.is_admin()
     and not app_private.project_actor_has_effective_room_action(
       v_actor, v_request.project_id, v_request.construction_site_id, 'material_request', 'manage'
     ) then
    raise exception 'Cần quyền Quản trị quy trình duyệt trong room Đề xuất vật tư.' using errcode = '42501';
  end if;

  if v_subject.status not in ('RUNNING', 'RETURNED') then
    raise exception 'Chỉ chuyển bước được khi phiếu đang xử lý hoặc đang được trả lại.' using errcode = '22023';
  end if;

  select * into v_target from public.workflow_instance_nodes win
  where win.workflow_instance_id = v_subject.workflow_instance_id
    and win.template_node_id = p_target_template_node_id;
  if not found or v_target.type in ('START'::public.workflow_node_type, 'END'::public.workflow_node_type) then
    raise exception 'Bước đích không hợp lệ.' using errcode = '22023';
  end if;
  if v_subject.status = 'RUNNING' and v_target.id = v_subject.current_instance_node_id then
    raise exception 'Phiếu đang ở bước này rồi. Dùng "Đổi người" nếu chỉ cần đổi người xử lý.' using errcode = '22023';
  end if;

  if coalesce(array_length(v_assignee_ids, 1), 0) = 0 then
    raise exception 'Chưa chọn người xử lý ở bước đích.' using errcode = '23514';
  end if;
  if not app_private.project_workflow_runtime_assignees_are_eligible(
    p_subject_type, p_subject_id, v_target.id, v_assignee_ids
  ) then
    raise exception 'next assignee pool is not eligible for this runtime workflow step';
  end if;
  perform app_private.assert_material_request_room_recipients(p_subject_id, v_assignee_ids, 'approve');

  select * into v_from_node from public.workflow_instance_nodes win
  where win.id = v_subject.current_instance_node_id;

  perform set_config('app.material_request_workflow_context', 'on', true);

  update public.workflow_step_assignments
  set status = 'SKIPPED', acted_at = now(),
      action_comment = v_comment,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('adminMovedByUserId', v_actor, 'adminMovedToInstanceNodeId', v_target.id)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and status = 'PENDING';

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id, v_subject.workflow_instance_id, v_target.template_node_id, v_target.id,
    v_assignee_ids, v_actor, v_comment,
    jsonb_build_object('adminMoved', true, 'fromInstanceNodeId', v_subject.current_instance_node_id),
    'admin_move'
  );

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_subject.workflow_instance_id, v_target.template_node_id,
    'REOPENED'::public.workflow_instance_action, v_actor,
    'Quản trị chuyển bước: ' || v_comment);

  v_first_assignee := v_assignee_ids[1];
  v_assignee_name := app_private.project_workflow_first_assignee_name(v_assignee_ids);
  v_sla_hours := app_private.project_workflow_runtime_sla_hours(v_target.id);
  v_due_at := app_private.project_workflow_runtime_sla_due_at(v_target.id);
  v_to_step := app_private.project_workflow_runtime_to_coarse_step(v_subject.workflow_instance_id, v_target.id);

  update public.workflow_instances
  set current_node_id = v_target.template_node_id,
      current_instance_node_id = v_target.id,
      status = 'RUNNING'::public.workflow_instance_status,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || app_private.project_workflow_step_assignees_json(v_target.template_node_id, v_assignee_ids),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_first_assignee,
      current_assignee_user_ids = v_assignee_ids,
      current_node_id = v_target.template_node_id,
      current_instance_node_id = v_target.id,
      last_action_instance_node_id = v_subject.current_instance_node_id,
      status = 'RUNNING',
      return_to_node_id = null,
      return_to_instance_node_id = null,
      return_to_assignee_user_id = null,
      return_to_assignee_user_ids = '{}'::uuid[],
      updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'PENDING'::public.request_status,
      submitted_to_user_id = v_first_assignee::text,
      submitted_to_name = v_assignee_name,
      submitted_to_permission = app_private.project_workflow_runtime_primary_permission(v_target.id),
      submission_note = v_comment,
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
    v_to_step, 'ADMIN_MOVED', v_actor::text, v_first_assignee::text,
    app_private.project_workflow_runtime_primary_permission(v_target.id),
    v_comment, v_sla_hours, v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'fromInstanceNodeId', v_from_node.id,
      'fromLabel', v_from_node.label,
      'toInstanceNodeId', v_target.id,
      'toLabel', v_target.label,
      'assigneeUserIds', v_assignee_ids
    )
  );

  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true);
  return v_subject;
exception when others then
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true);
  raise;
end;
$$;

revoke all on function public.admin_move_project_workflow_step(text, text, uuid, uuid[], text)
  from public, anon;
grant execute on function public.admin_move_project_workflow_step(text, text, uuid, uuid[], text)
  to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from public.project_permission_rooms room
    where room.code = 'material_request' and 'manage' = any(room.allowed_actions)
  ) then
    raise exception 'MATERIAL_REQUEST_MANAGE_ROOM_ACTION_MISSING';
  end if;
  if not exists (
    select 1 from app_private.project_permission_room_action_bindings binding
    where binding.room_code = 'material_request' and binding.action_code = 'manage'
      and binding.enforcement_status = 'enforced'
  ) then
    raise exception 'MATERIAL_REQUEST_MANAGE_BINDING_MISSING';
  end if;
end;
$$;

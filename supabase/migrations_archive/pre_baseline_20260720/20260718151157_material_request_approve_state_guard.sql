create or replace function public.transition_project_material_request_status(
  p_request_id text,
  p_status text,
  p_action text,
  p_actor_user_id text,
  p_target_user_id text default null,
  p_target_permission text default null,
  p_note text default null,
  p_patch jsonb default '{}'::jsonb
)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.requests%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_required_permission text;
  v_previous_guard text;
begin
  if v_user_id is null or p_actor_user_id is distinct from v_user_id::text then
    raise exception 'Không xác định được người dùng chuyển bước phiếu vật tư.'
      using errcode = '42501';
  end if;

  select *
  into v_request
  from public.requests
  where id = p_request_id
    and coalesce(request_origin, 'wms') = 'project'
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu vật tư dự án.';
  end if;

  v_required_permission := case
    when upper(coalesce(p_action, '')) in ('SUBMITTED', 'RESUBMITTED') then 'project.material_request.submit'
    when upper(coalesce(p_action, '')) in ('RETURNED', 'REJECTED') then 'project.material_request.return'
    when upper(coalesce(p_action, '')) in ('FULFILLED', 'CONFIRMED', 'CONFIRM_FULFILLMENT') then 'project.material_request.confirm_fulfillment'
    when coalesce(p_patch->>'workflow_step', '') in ('site_quality_check', 'completed')
      or upper(coalesce(p_status, '')) in ('COMPLETED', 'IN_TRANSIT') then 'project.material_request.confirm_fulfillment'
    else 'project.material_request.approve'
  end;

  if v_required_permission = 'project.material_request.approve'
    and (
      v_request.status is distinct from 'PENDING'::public.request_status
      or upper(coalesce(p_status, '')) <> 'APPROVED'
      or upper(coalesce(p_action, '')) <> 'APPROVED'
    )
  then
    raise exception 'Chỉ phiếu đang chờ duyệt mới được duyệt.'
      using errcode = '23514';
  end if;

  if v_required_permission = 'project.material_request.submit' then
    if coalesce(v_request.status::text, 'DRAFT') not in ('DRAFT', 'REJECTED') then
      raise exception 'Chỉ phiếu nháp hoặc bị trả lại mới được gửi duyệt.';
    end if;
    if not (public.is_admin() or public.is_module_admin('DA')) and v_request.requester_id is distinct from v_user_id then
      raise exception 'Chỉ người tạo phiếu mới được gửi duyệt.'
        using errcode = '42501';
    end if;
  elsif not (public.is_admin() or public.is_module_admin('DA')) then
    if v_request.submitted_to_user_id is not null
      and v_request.submitted_to_user_id <> v_user_id::text then
      raise exception 'Bạn không phải người đang được giao xử lý phiếu vật tư này.'
        using errcode = '42501';
    end if;
  end if;

  if not app_private.material_has_action(v_request.project_id, v_request.construction_site_id, v_required_permission, v_user_id) then
    raise exception 'Bạn cần quyền % để chuyển bước phiếu vật tư.', v_required_permission
      using errcode = '42501';
  end if;

  if nullif(p_target_user_id, '') is not null and nullif(p_target_permission, '') is not null then
    if not app_private.material_has_action(
      v_request.project_id,
      v_request.construction_site_id,
      p_target_permission,
      p_target_user_id::uuid
    ) then
      raise exception 'Người được chọn chưa có quyền % trong Tổ chức dự án.', p_target_permission
        using errcode = '42501';
    end if;
  end if;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.requests
  set
    status = coalesce(nullif(p_status, '')::public.request_status, status),
    logs = case when p_patch ? 'logs' then p_patch->'logs' else logs end,
    ever_submitted = case when p_patch ? 'ever_submitted' then coalesce((p_patch->>'ever_submitted')::boolean, ever_submitted) else ever_submitted end,
    last_action_by = case when p_patch ? 'last_action_by' then nullif(p_patch->>'last_action_by', '') else last_action_by end,
    last_action_at = case when p_patch ? 'last_action_at' then nullif(p_patch->>'last_action_at', '')::timestamptz else last_action_at end,
    workflow_step = case when p_patch ? 'workflow_step' then nullif(p_patch->>'workflow_step', '') else workflow_step end,
    workflow_step_started_at = case when p_patch ? 'workflow_step_started_at' then nullif(p_patch->>'workflow_step_started_at', '')::timestamptz else workflow_step_started_at end,
    workflow_step_due_at = case when p_patch ? 'workflow_step_due_at' then nullif(p_patch->>'workflow_step_due_at', '')::timestamptz else workflow_step_due_at end,
    workflow_step_sla_hours = case when p_patch ? 'workflow_step_sla_hours' then nullif(p_patch->>'workflow_step_sla_hours', '')::integer else workflow_step_sla_hours end,
    workflow_step_actor_user_id = case when p_patch ? 'workflow_step_actor_user_id' then nullif(p_patch->>'workflow_step_actor_user_id', '') else workflow_step_actor_user_id end,
    submitted_to_user_id = case when p_patch ? 'submitted_to_user_id' then nullif(p_patch->>'submitted_to_user_id', '') else submitted_to_user_id end,
    submitted_to_name = case when p_patch ? 'submitted_to_name' then nullif(p_patch->>'submitted_to_name', '') else submitted_to_name end,
    submitted_to_permission = case when p_patch ? 'submitted_to_permission' then nullif(p_patch->>'submitted_to_permission', '') else submitted_to_permission end,
    submission_note = case when p_patch ? 'submission_note' then nullif(p_patch->>'submission_note', '') else submission_note end
  where id = p_request_id
  returning * into v_request;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  return v_request;
end;
$$;

revoke all on function public.transition_project_material_request_status(text, text, text, text, text, text, text, jsonb) from public;
revoke all on function public.transition_project_material_request_status(text, text, text, text, text, text, text, jsonb) from anon;
grant execute on function public.transition_project_material_request_status(text, text, text, text, text, text, text, jsonb) to authenticated;

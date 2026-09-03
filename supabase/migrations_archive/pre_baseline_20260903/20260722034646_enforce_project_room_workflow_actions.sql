-- Room is the authoritative workflow gate for Project Material / PO actions.
-- The existing UI already filters recipients by Room; these checks make the
-- same rule effective for direct RPC/API calls as well.

create or replace function app_private.assert_project_permission_room_action(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_action_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'Không xác định được người dùng đang thao tác.'
      using errcode = '42501';
  end if;

  if not app_private.project_user_has_room_action(
    p_user_id,
    p_project_id,
    p_construction_site_id,
    p_room_code,
    p_action_code
  ) then
    raise exception 'Bạn chưa có quyền % trong Room % của dự án này.', p_action_code, p_room_code
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_project_permission_room_action(text, text, text, text, uuid) from public, anon, authenticated;

create or replace function app_private.project_room_action_from_material_permission(
  p_permission_code text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_permission_code in ('project.material_request.submit', 'project.material_po.create') then 'submit'
    when p_permission_code in ('project.material_request.confirm_fulfillment', 'project.material_po.receive') then 'confirm'
    else 'approve'
  end;
$$;

revoke all on function app_private.project_room_action_from_material_permission(text) from public, anon, authenticated;

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
  v_room_action text;
  v_target_room_action text;
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
    when upper(coalesce(p_action, '')) in ('RETURNED', 'REJECTED') then 'project.material_request.approve'
    when upper(coalesce(p_action, '')) in ('FULFILLED', 'CONFIRMED', 'CONFIRM_FULFILLMENT') then 'project.material_request.confirm_fulfillment'
    when coalesce(p_patch->>'workflow_step', '') in ('site_quality_check', 'completed')
      or upper(coalesce(p_status, '')) in ('COMPLETED', 'IN_TRANSIT') then 'project.material_request.confirm_fulfillment'
    else 'project.material_request.approve'
  end;
  v_room_action := app_private.project_room_action_from_material_permission(v_required_permission);

  if v_required_permission = 'project.material_request.submit' then
    if coalesce(v_request.status::text, 'DRAFT') not in ('DRAFT', 'REJECTED') then
      raise exception 'Chỉ phiếu nháp hoặc bị trả lại mới được gửi duyệt.';
    end if;
    if v_request.requester_id is distinct from v_user_id then
      raise exception 'Chỉ người tạo phiếu mới được gửi duyệt.'
        using errcode = '42501';
    end if;
  elsif v_request.submitted_to_user_id is not null
    and v_request.submitted_to_user_id <> v_user_id::text then
    raise exception 'Bạn không phải người đang được giao xử lý phiếu vật tư này.'
      using errcode = '42501';
  end if;

  perform app_private.assert_project_permission_room_action(
    v_request.project_id::text,
    v_request.construction_site_id::text,
    'material_request',
    v_room_action,
    v_user_id
  );

  if nullif(p_target_user_id, '') is not null then
    v_target_room_action := app_private.project_room_action_from_material_permission(p_target_permission);
    perform app_private.assert_project_permission_room_action(
      v_request.project_id::text,
      v_request.construction_site_id::text,
      'material_request',
      v_target_room_action,
      p_target_user_id::uuid
    );
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
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function public.transition_project_material_request_status(text, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.transition_project_material_request_status(text, text, text, text, text, text, text, jsonb) to authenticated;

create or replace function public.transition_project_purchase_order_status(
  p_po_id text,
  p_status text,
  p_patch jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_required_permission text;
  v_room_action text;
  v_previous_guard text;
begin
  if v_user_id is null then
    raise exception 'Không xác định được người dùng chuyển trạng thái PO.'
      using errcode = '42501';
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Không tìm thấy PO.';
  end if;

  v_required_permission := case
    when coalesce(p_status, '') in ('in_transit', 'partial', 'delivered', 'closed')
      or p_patch ? 'received_transaction_ids'
      or p_patch ? 'actual_delivery_date' then 'project.material_po.receive'
    when coalesce(p_status, '') in ('sent', 'confirmed', 'returned', 'cancelled') then 'project.material_po.approve'
    else 'project.material_po.create'
  end;

  -- Company procurement and warehouse receiving keep their existing specialized
  -- controls. Project PO submission/approval is now exclusively Room-based.
  if coalesce(v_po.source_mode, 'project') <> 'company_consolidated'
    and coalesce(p_status, '') in ('sent', 'confirmed', 'returned', 'cancelled') then
    v_room_action := case when p_status = 'sent' then 'submit' else 'approve' end;
    perform app_private.assert_project_permission_room_action(
      v_po.project_id::text,
      v_po.construction_site_id::text,
      'material_po',
      v_room_action,
      v_user_id
    );

    if p_status = 'sent' and nullif(p_patch->>'submitted_to_user_id', '') is not null then
      perform app_private.assert_project_permission_room_action(
        v_po.project_id::text,
        v_po.construction_site_id::text,
        'material_po',
        'approve',
        (p_patch->>'submitted_to_user_id')::uuid
      );
    end if;
  elsif not (
    public.is_admin()
    or public.is_module_admin('DA')
    or (v_po.source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
    or (
      v_required_permission = 'project.material_po.receive'
      and (app_private.current_user_is_global_wms_keeper() or app_private.current_user_is_wms_keeper_for(v_po.target_warehouse_id))
    )
    or app_private.material_has_action(v_po.project_id, v_po.construction_site_id, v_required_permission, v_user_id)
  ) then
    raise exception 'Bạn cần quyền % để chuyển trạng thái PO.', v_required_permission
      using errcode = '42501';
  end if;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.purchase_orders
  set
    status = coalesce(nullif(p_status, ''), status),
    submitted_to_user_id = case when p_patch ? 'submitted_to_user_id' then nullif(p_patch->>'submitted_to_user_id', '') else submitted_to_user_id end,
    submitted_to_name = case when p_patch ? 'submitted_to_name' then nullif(p_patch->>'submitted_to_name', '') else submitted_to_name end,
    submitted_to_permission = case when p_patch ? 'submitted_to_permission' then nullif(p_patch->>'submitted_to_permission', '') else submitted_to_permission end,
    submission_note = case when p_patch ? 'submission_note' then nullif(p_patch->>'submission_note', '') else submission_note end,
    ever_submitted = case when p_patch ? 'ever_submitted' then coalesce((p_patch->>'ever_submitted')::boolean, ever_submitted) else ever_submitted end,
    last_action_by = case when p_patch ? 'last_action_by' then nullif(p_patch->>'last_action_by', '') else last_action_by end,
    last_action_at = case when p_patch ? 'last_action_at' then nullif(p_patch->>'last_action_at', '')::timestamptz else last_action_at end,
    received_transaction_ids = case when p_patch ? 'received_transaction_ids' then coalesce(p_patch->'received_transaction_ids', '[]'::jsonb) else received_transaction_ids end,
    actual_delivery_date = case when p_patch ? 'actual_delivery_date' then nullif(p_patch->>'actual_delivery_date', '') else actual_delivery_date end
  where id = p_po_id;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function public.transition_project_purchase_order_status(text, text, jsonb) from public, anon;
grant execute on function public.transition_project_purchase_order_status(text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

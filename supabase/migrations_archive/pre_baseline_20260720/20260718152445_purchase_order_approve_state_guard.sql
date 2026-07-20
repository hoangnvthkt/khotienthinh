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
  v_previous_guard text;
begin
  if v_user_id is null then
    raise exception 'Không xác định được người dùng chuyển trạng thái PO.'
      using errcode = '42501';
  end if;

  select *
  into v_po
  from public.purchase_orders
  where id = p_po_id
  for update;

  if not found then
    raise exception 'Không tìm thấy PO.';
  end if;

  if coalesce(p_status, '') = 'cancelled' then
    raise exception 'PO không được hủy qua luồng duyệt; dùng luồng Quy trình hoặc Yêu cầu.'
      using errcode = '23514';
  end if;

  v_required_permission := case
    when coalesce(p_status, '') in ('in_transit', 'partial', 'delivered', 'closed')
      or p_patch ? 'received_transaction_ids'
      or p_patch ? 'actual_delivery_date' then 'project.material_po.receive'
    when coalesce(p_status, '') = 'sent' then 'project.material_po.create'
    when coalesce(p_status, '') in ('confirmed', 'returned') then 'project.material_po.approve'
    else 'project.material_po.create'
  end;

  if v_required_permission = 'project.material_po.approve'
    and (
      lower(coalesce(v_po.status, '')) <> 'sent'
      or lower(coalesce(p_status, '')) not in ('confirmed', 'returned')
    )
  then
    raise exception 'Chỉ PO đang chờ duyệt mới được duyệt hoặc trả lại.'
      using errcode = '23514';
  end if;

  if coalesce(p_status, '') = 'sent'
    and lower(coalesce(v_po.status, '')) not in ('draft', 'returned')
  then
    raise exception 'Chỉ PO nháp hoặc bị trả lại mới được gửi duyệt.'
      using errcode = '23514';
  end if;

  if not (
    public.is_admin()
    or public.is_module_admin('DA')
    or (v_po.source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
    or (
      v_required_permission = 'project.material_po.receive'
      and (
        app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(v_po.target_warehouse_id)
      )
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
end;
$$;

revoke all on function public.transition_project_purchase_order_status(text, text, jsonb) from public;
revoke all on function public.transition_project_purchase_order_status(text, text, jsonb) from anon;
grant execute on function public.transition_project_purchase_order_status(text, text, jsonb) to authenticated;

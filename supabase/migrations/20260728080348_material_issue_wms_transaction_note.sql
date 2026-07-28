create or replace function public.submit_material_issue_order(
  p_order_id uuid,
  p_override_reason text default null
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_transaction_id text := 'tx-material-issue-' || replace(gen_random_uuid()::text, '-', '');
  v_items jsonb := '[]'::jsonb;
  v_line record;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_order from public.material_issue_orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in ('draft', 'submitted') then raise exception 'Chỉ gửi duyệt phiếu ở trạng thái nháp.'; end if;
  if not (
    public.is_admin()
    or public.is_module_admin('WMS')
    or v_order.created_by = v_actor
    or app_private.material_issue_can_manage_project(v_order.project_id, v_order.construction_site_id)
  ) then
    raise exception 'Bạn không có quyền gửi phiếu xuất cấp này.';
  end if;

  for v_line in
    select * from public.material_issue_lines where issue_order_id = p_order_id order by created_at
  loop
    if v_line.approved_qty <= 0 then raise exception 'Phiếu có dòng số lượng không hợp lệ.'; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id,
      'quantity', v_line.approved_qty,
      'price', v_line.unit_price,
      'materialIssueOrderId', v_order.id,
      'materialIssueLineId', v_line.id,
      'recipientType', v_order.recipient_type,
      'recipientNameSnapshot', v_order.recipient_name
    ));
  end loop;

  if jsonb_array_length(v_items) = 0 then raise exception 'Phiếu xuất cấp chưa có dòng vật tư.'; end if;

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id, pending_items
  ) values (
    v_transaction_id, 'EXPORT', now(), v_items, v_order.source_warehouse_id, null,
    v_actor, null, 'PENDING',
    coalesce(
      nullif(trim(v_order.note), ''),
      'Xuất cấp thi công ' || v_order.issue_no || ' cho ' || v_order.recipient_name
    ),
    v_order.material_request_id, '[]'::jsonb
  );

  update public.material_issue_orders
  set status = 'wms_pending',
      transaction_id = v_transaction_id,
      submitted_by = v_actor,
      submitted_at = now(),
      override_reason = nullif(trim(coalesce(p_override_reason, '')), '')
  where id = p_order_id
  returning * into v_order;

  if to_regclass('public.project_document_links') is not null then
    if v_order.material_request_id is not null then
      insert into public.project_document_links(source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata)
      values ('material_request', v_order.material_request_id, 'material_issue_order', v_order.id::text, v_order.project_id, 'downstream', 'active', jsonb_build_object('issueNo', v_order.issue_no, 'transactionId', v_transaction_id))
      on conflict (source_type, source_id, target_type, target_id, relation_type)
      do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();
    end if;

    insert into public.project_document_links(source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata)
    values ('material_issue_order', v_order.id::text, 'transaction', v_transaction_id, v_order.project_id, 'downstream', 'active', jsonb_build_object('kind', 'external_issue'))
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();

    if v_order.subcontractor_contract_id is not null then
      insert into public.project_document_links(source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata)
      values ('subcontractor_contract', v_order.subcontractor_contract_id, 'material_issue_order', v_order.id::text, v_order.project_id, 'downstream', 'active', jsonb_build_object('issueNo', v_order.issue_no))
      on conflict (source_type, source_id, target_type, target_id, relation_type)
      do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();
    end if;
  end if;

  return v_order;
end;
$$;

update public.transactions tx
set note = nullif(trim(material_issue.note), '')
from public.material_issue_orders material_issue
where tx.id = material_issue.transaction_id
  and nullif(trim(material_issue.note), '') is not null
  and (
    tx.note is null
    or tx.note = 'Xuất cấp thi công ' || material_issue.issue_no || ' cho ' || material_issue.recipient_name
  );

revoke all on function public.submit_material_issue_order(uuid, text) from public, anon;
grant execute on function public.submit_material_issue_order(uuid, text) to authenticated;

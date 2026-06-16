-- Fix material issue returns failing with material_issue_returns_transaction_id_fkey.
-- The return row has a required FK to transactions(id), so the transaction must
-- exist before material_issue_returns is inserted.

create or replace function public.create_material_issue_return(
  p_order_id uuid,
  p_target_warehouse_id text,
  p_lines jsonb,
  p_reason text,
  p_note text default null
)
returns public.material_issue_returns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_return public.material_issue_returns%rowtype;
  v_return_id uuid := gen_random_uuid();
  v_transaction_id text := 'tx-material-return-' || replace(gen_random_uuid()::text, '-', '');
  v_return_no text;
  v_items jsonb := '[]'::jsonb;
  v_return_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_issue_line public.material_issue_lines%rowtype;
  v_qty numeric;
  v_available numeric;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Bắt buộc nhập lý do hoàn trả.'; end if;

  select * into v_order from public.material_issue_orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;

  if v_order.status not in ('issued', 'partially_received', 'received', 'settling', 'partially_returned') then
    raise exception 'Phiếu chưa sẵn sàng hoàn trả.';
  end if;

  if not app_private.material_issue_can_process(v_order.source_warehouse_id, v_order.created_by, v_order.responsible_user_id, v_order.recipient_type, v_order.recipient_id) then
    raise exception 'Bạn không có quyền tạo phiếu hoàn trả.';
  end if;

  v_return_no := 'MRET-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(v_return_id::text, '-', ''), 1, 6));

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_qty := coalesce(nullif(v_line ->> 'returnQty', '')::numeric, 0);
    if v_qty <= 0 then raise exception 'Số lượng hoàn trả phải lớn hơn 0.'; end if;

    select * into v_issue_line
    from public.material_issue_lines
    where id = (v_line ->> 'issueLineId')::uuid
      and issue_order_id = p_order_id
    for update;
    if not found then raise exception 'Không tìm thấy dòng phiếu xuất cấp.'; end if;

    v_available := greatest(v_issue_line.issued_qty - v_issue_line.returned_qty - v_issue_line.consumed_qty - v_issue_line.lost_qty, 0);
    if v_qty > v_available then raise exception 'Số lượng hoàn trả vượt số lượng còn quyết toán.'; end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_issue_line.item_id,
      'quantity', v_qty,
      'price', v_issue_line.unit_price,
      'materialIssueOrderId', p_order_id,
      'materialIssueLineId', v_issue_line.id,
      'materialIssueReturnId', v_return_id,
      'recipientType', v_order.recipient_type,
      'recipientNameSnapshot', v_order.recipient_name
    ));

    v_return_lines := v_return_lines || jsonb_build_array(jsonb_build_object(
      'issueLineId', v_issue_line.id,
      'itemId', v_issue_line.item_id,
      'returnQty', v_qty,
      'unit', v_issue_line.unit,
      'reason', nullif(trim(coalesce(v_line ->> 'reason', '')), '')
    ));
  end loop;

  if jsonb_array_length(v_items) = 0 then raise exception 'Phiếu hoàn trả chưa có dòng vật tư.'; end if;

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id, pending_items
  ) values (
    v_transaction_id, 'IMPORT', now(), v_items, null, p_target_warehouse_id,
    v_actor, null, 'PENDING',
    'Hoàn trả vật tư từ ' || v_order.recipient_name || ' theo phiếu ' || v_order.issue_no,
    v_order.material_request_id, '[]'::jsonb
  );

  insert into public.material_issue_returns(
    id, issue_order_id, return_no, target_warehouse_id, status,
    transaction_id, reason, note, created_by
  ) values (
    v_return_id, p_order_id, v_return_no, p_target_warehouse_id, 'pending',
    v_transaction_id, trim(p_reason), nullif(trim(coalesce(p_note, '')), ''), v_actor
  )
  returning * into v_return;

  for v_line in select value from jsonb_array_elements(v_return_lines)
  loop
    insert into public.material_issue_return_lines(
      issue_return_id, issue_line_id, item_id, return_qty, unit, reason
    ) values (
      v_return_id,
      (v_line ->> 'issueLineId')::uuid,
      v_line ->> 'itemId',
      coalesce(nullif(v_line ->> 'returnQty', '')::numeric, 0),
      nullif(v_line ->> 'unit', ''),
      nullif(v_line ->> 'reason', '')
    );
  end loop;

  if to_regclass('public.project_document_links') is not null then
    insert into public.project_document_links(source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata)
    values ('material_issue_order', v_order.id::text, 'material_issue_return', v_return_id::text, v_order.project_id, 'downstream', 'active', jsonb_build_object('returnNo', v_return_no, 'transactionId', v_transaction_id))
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();

    insert into public.project_document_links(source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata)
    values ('material_issue_order', v_order.id::text, 'transaction', v_transaction_id, v_order.project_id, 'downstream', 'active', jsonb_build_object('kind', 'material_issue_return', 'returnId', v_return_id))
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();
  end if;

  return v_return;
end;
$$;

notify pgrst, 'reload schema';

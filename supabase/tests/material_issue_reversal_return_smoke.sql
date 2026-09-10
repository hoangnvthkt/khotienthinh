begin;

create temporary table material_issue_reversal_smoke_context (
  actor_id uuid not null,
  actor_auth_id uuid not null,
  actor_email text not null,
  wrong_actor_id uuid not null,
  wrong_actor_auth_id uuid not null,
  wrong_actor_email text not null,
  warehouse_id text not null,
  other_warehouse_id text not null,
  reversal_order_id uuid not null,
  reversal_line_id uuid not null,
  return_order_id uuid not null,
  return_line_id uuid not null,
  eligibility_order_id uuid not null,
  eligibility_line_id uuid not null,
  draft_order_id uuid not null,
  reversal_item_id text not null,
  return_item_id text not null,
  eligibility_item_id text not null,
  original_reversal_tx_id text not null,
  original_return_tx_id text not null,
  original_eligibility_tx_id text not null
) on commit drop;

do $$
declare
  v_actor_id uuid := gen_random_uuid();
  v_actor_auth_id uuid := gen_random_uuid();
  v_wrong_actor_id uuid := gen_random_uuid();
  v_wrong_actor_auth_id uuid := gen_random_uuid();
  v_actor_email text := 'material-reversal-' || replace(v_actor_id::text, '-', '') || '@invalid.local';
  v_wrong_actor_email text := 'material-reversal-wrong-' || replace(v_wrong_actor_id::text, '-', '') || '@invalid.local';
  v_warehouse_id text := 'smoke-wh-' || replace(gen_random_uuid()::text, '-', '');
  v_other_warehouse_id text := 'smoke-wh-other-' || replace(gen_random_uuid()::text, '-', '');
  v_reversal_order_id uuid := gen_random_uuid();
  v_reversal_line_id uuid := gen_random_uuid();
  v_return_order_id uuid := gen_random_uuid();
  v_return_line_id uuid := gen_random_uuid();
  v_eligibility_order_id uuid := gen_random_uuid();
  v_eligibility_line_id uuid := gen_random_uuid();
  v_draft_order_id uuid := gen_random_uuid();
  v_reversal_item_id text := 'smoke-item-reversal-' || replace(gen_random_uuid()::text, '-', '');
  v_return_item_id text := 'smoke-item-return-' || replace(gen_random_uuid()::text, '-', '');
  v_eligibility_item_id text := 'smoke-item-eligibility-' || replace(gen_random_uuid()::text, '-', '');
  v_original_reversal_tx_id text := 'smoke-export-reversal-' || replace(gen_random_uuid()::text, '-', '');
  v_original_return_tx_id text := 'smoke-export-return-' || replace(gen_random_uuid()::text, '-', '');
  v_original_eligibility_tx_id text := 'smoke-export-eligibility-' || replace(gen_random_uuid()::text, '-', '');
  v_warehouse_type text;
begin
  select code into v_warehouse_type
  from public.warehouse_types
  where is_active
  order by sort_order, code
  limit 1;
  if v_warehouse_type is null then raise exception 'SMOKE_ACTIVE_WAREHOUSE_TYPE_REQUIRED'; end if;

  insert into public.warehouses(id, name, address, type)
  values
    (v_warehouse_id, 'Kho smoke đảo/hoàn', 'Smoke only', v_warehouse_type),
    (v_other_warehouse_id, 'Kho smoke sai quyền', 'Smoke only', v_warehouse_type);

  insert into public.users(
    id, name, email, username, role, assigned_warehouse_id,
    is_active, account_status
  ) values
    (
      v_actor_id, 'Material Reversal Smoke Actor', v_actor_email,
      'material-reversal-' || replace(v_actor_id::text, '-', ''),
      'EMPLOYEE', v_warehouse_id, true, 'ACTIVE'
    ),
    (
      v_wrong_actor_id, 'Material Reversal Wrong Warehouse', v_wrong_actor_email,
      'material-reversal-wrong-' || replace(v_wrong_actor_id::text, '-', ''),
      'EMPLOYEE', v_other_warehouse_id, true, 'ACTIVE'
    );

  insert into public.user_permission_grants(
    user_id, permission_code, scope_type, scope_id, is_active,
    granted_by, granted_at, expires_at, grant_reason
  ) values
    (
      v_actor_id, 'wms.transaction.reverse', 'warehouse', v_warehouse_id,
      true, v_actor_id, now(), now() + interval '1 day', 'rollback smoke'
    ),
    (
      v_wrong_actor_id, 'wms.transaction.reverse', 'warehouse', v_other_warehouse_id,
      true, v_actor_id, now(), now() + interval '1 day', 'rollback smoke wrong scope'
    );

  insert into public.items(
    id, sku, name, category, unit, price_in, price_out, min_stock,
    stock_by_warehouse
  ) values
    (
      v_reversal_item_id, 'SMOKE-REV-' || left(v_reversal_item_id, 12),
      'Mũ bảo hộ smoke reversal', 'Smoke', 'Cái', 100, 100, 0,
      jsonb_build_object(v_warehouse_id, 100)
    ),
    (
      v_return_item_id, 'SMOKE-RET-' || left(v_return_item_id, 12),
      'Mũ bảo hộ smoke return', 'Smoke', 'Cái', 100, 100, 0,
      jsonb_build_object(v_warehouse_id, 100)
    ),
    (
      v_eligibility_item_id, 'SMOKE-ELI-' || left(v_eligibility_item_id, 12),
      'Mũ bảo hộ smoke eligibility', 'Smoke', 'Cái', 100, 100, 0,
      jsonb_build_object(v_warehouse_id, 100)
    );

  insert into public.material_issue_orders(
    id, issue_no, source_warehouse_id, recipient_type, recipient_id,
    recipient_name, responsible_user_id, status, created_by
  ) values
    (
      v_reversal_order_id, 'SMOKE-REV-' || left(v_reversal_order_id::text, 8),
      v_warehouse_id, 'employee', v_actor_id::text, 'Smoke recipient',
      v_actor_id, 'wms_pending', v_actor_id
    ),
    (
      v_return_order_id, 'SMOKE-RET-' || left(v_return_order_id::text, 8),
      v_warehouse_id, 'employee', v_actor_id::text, 'Smoke recipient',
      v_actor_id, 'wms_pending', v_actor_id
    ),
    (
      v_eligibility_order_id, 'SMOKE-ELI-' || left(v_eligibility_order_id::text, 8),
      v_warehouse_id, 'employee', v_actor_id::text, 'Smoke recipient',
      v_actor_id, 'wms_pending', v_actor_id
    ),
    (
      v_draft_order_id, 'SMOKE-DRAFT-' || left(v_draft_order_id::text, 8),
      v_warehouse_id, 'employee', v_actor_id::text, 'Smoke recipient',
      v_actor_id, 'draft', v_actor_id
    );

  insert into public.material_issue_lines(
    id, issue_order_id, item_id, item_name_snapshot, unit, requested_qty,
    approved_qty, issued_qty, unit_price
  ) values
    (v_reversal_line_id, v_reversal_order_id, v_reversal_item_id,
      'Mũ bảo hộ smoke reversal', 'Cái', 10, 10, 0, 100),
    (v_return_line_id, v_return_order_id, v_return_item_id,
      'Mũ bảo hộ smoke return', 'Cái', 10, 10, 0, 100),
    (v_eligibility_line_id, v_eligibility_order_id, v_eligibility_item_id,
      'Mũ bảo hộ smoke eligibility', 'Cái', 10, 10, 0, 100);

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, requester_id, approver_id,
    status, note, pending_items, source_type, source_id, business_event_type
  ) values
    (
      v_original_reversal_tx_id, 'EXPORT', now(),
      jsonb_build_array(jsonb_build_object(
        'itemId', v_reversal_item_id, 'quantity', 10, 'price', 100,
        'materialIssueOrderId', v_reversal_order_id,
        'materialIssueLineId', v_reversal_line_id
      )), v_warehouse_id, v_actor_id, null, 'PENDING',
      'Smoke issue for reversal', '[]'::jsonb, 'material_issue_order',
      v_reversal_order_id::text, 'construction_issue'
    ),
    (
      v_original_return_tx_id, 'EXPORT', now(),
      jsonb_build_array(jsonb_build_object(
        'itemId', v_return_item_id, 'quantity', 10, 'price', 100,
        'materialIssueOrderId', v_return_order_id,
        'materialIssueLineId', v_return_line_id
      )), v_warehouse_id, v_actor_id, null, 'PENDING',
      'Smoke issue for return', '[]'::jsonb, 'material_issue_order',
      v_return_order_id::text, 'construction_issue'
    ),
    (
      v_original_eligibility_tx_id, 'EXPORT', now(),
      jsonb_build_array(jsonb_build_object(
        'itemId', v_eligibility_item_id, 'quantity', 10, 'price', 100,
        'materialIssueOrderId', v_eligibility_order_id,
        'materialIssueLineId', v_eligibility_line_id
      )), v_warehouse_id, v_actor_id, null, 'PENDING',
      'Smoke issue for eligibility', '[]'::jsonb, 'material_issue_order',
      v_eligibility_order_id::text, 'construction_issue'
    );

  update public.material_issue_orders
  set transaction_id = case id
    when v_reversal_order_id then v_original_reversal_tx_id
    when v_return_order_id then v_original_return_tx_id
    when v_eligibility_order_id then v_original_eligibility_tx_id
  end
  where id in (v_reversal_order_id, v_return_order_id, v_eligibility_order_id);

  update public.items
  set stock_by_warehouse = jsonb_set(
    stock_by_warehouse,
    array[v_warehouse_id],
    to_jsonb(90),
    true
  )
  where id in (v_reversal_item_id, v_return_item_id, v_eligibility_item_id);

  update public.transactions
  set status = 'COMPLETED', approver_id = v_actor_id, approved_at = now()
  where id in (
    v_original_reversal_tx_id,
    v_original_return_tx_id,
    v_original_eligibility_tx_id
  );

  insert into material_issue_reversal_smoke_context values (
    v_actor_id, v_actor_auth_id, v_actor_email,
    v_wrong_actor_id, v_wrong_actor_auth_id, v_wrong_actor_email,
    v_warehouse_id, v_other_warehouse_id,
    v_reversal_order_id, v_reversal_line_id,
    v_return_order_id, v_return_line_id,
    v_eligibility_order_id, v_eligibility_line_id,
    v_draft_order_id,
    v_reversal_item_id, v_return_item_id, v_eligibility_item_id,
    v_original_reversal_tx_id, v_original_return_tx_id,
    v_original_eligibility_tx_id
  );
end;
$$;

do $$
declare
  v_context material_issue_reversal_smoke_context%rowtype;
  v_return public.material_issue_returns%rowtype;
  v_second_return public.material_issue_returns%rowtype;
  v_stock numeric;
  v_blocked boolean;
begin
  select * into v_context from material_issue_reversal_smoke_context;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.actor_auth_id,
    'email', v_context.actor_email,
    'role', 'authenticated'
  )::text, true);

  v_return := public.create_material_issue_return_v2(
    v_context.return_order_id,
    v_context.warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'issueLineId', v_context.return_line_id,
      'returnQty', 3,
      'reason', 'Còn thừa'
    )),
    'Nhập hoàn một phần',
    'Chờ kho kiểm nhận',
    'smoke-return-first'
  );
  if (public.create_material_issue_return_v2(
    v_context.return_order_id,
    v_context.warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'issueLineId', v_context.return_line_id,
      'returnQty', 3,
      'reason', 'Còn thừa'
    )),
    'Nhập hoàn một phần',
    'Chờ kho kiểm nhận',
    'smoke-return-first'
  )).id <> v_return.id then
    raise exception 'SMOKE_RETURN_RETRY_CHANGED_DOCUMENT';
  end if;
  if (select count(*) from public.transactions where idempotency_key = 'smoke-return-first') <> 1 then
    raise exception 'SMOKE_RETURN_RETRY_DUPLICATED_TRANSACTION';
  end if;

  select (stock_by_warehouse ->> v_context.warehouse_id)::numeric into v_stock
  from public.items where id = v_context.return_item_id;
  if v_stock <> 90 then raise exception 'SMOKE_PENDING_RETURN_CHANGED_STOCK'; end if;

  perform public.process_transaction_status(v_return.transaction_id, 'APPROVED', v_context.actor_id);
  select (stock_by_warehouse ->> v_context.warehouse_id)::numeric into v_stock
  from public.items where id = v_context.return_item_id;
  if v_stock <> 90 then raise exception 'SMOKE_APPROVED_RETURN_CHANGED_STOCK'; end if;

  perform public.process_transaction_status(v_return.transaction_id, 'COMPLETED', v_context.actor_id);
  select (stock_by_warehouse ->> v_context.warehouse_id)::numeric into v_stock
  from public.items where id = v_context.return_item_id;
  if v_stock <> 93 then raise exception 'SMOKE_COMPLETED_RETURN_STOCK_INVALID'; end if;
  if (select returned_qty from public.material_issue_lines where id = v_context.return_line_id) <> 3 then
    raise exception 'SMOKE_COMPLETED_RETURN_QTY_INVALID';
  end if;

  v_second_return := public.create_material_issue_return_v2(
    v_context.return_order_id,
    v_context.warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'issueLineId', v_context.return_line_id,
      'returnQty', 5
    )),
    'Giữ chỗ hoàn tiếp', null, 'smoke-return-second'
  );
  if v_second_return.status <> 'pending' then raise exception 'SMOKE_SECOND_RETURN_NOT_PENDING'; end if;

  v_blocked := false;
  begin
    perform public.create_material_issue_return_v2(
      v_context.return_order_id,
      v_context.warehouse_id,
      jsonb_build_array(jsonb_build_object(
        'issueLineId', v_context.return_line_id,
        'returnQty', 3
      )),
      'Vượt phần còn giữ', null, 'smoke-return-overbook'
    );
  exception when others then
    v_blocked := position('vượt số lượng còn có thể hoàn' in sqlerrm) > 0;
  end;
  if not v_blocked then raise exception 'SMOKE_PENDING_OVERBOOK_NOT_BLOCKED'; end if;

  v_blocked := false;
  begin
    perform public.post_material_issue_settlement_v1(
      v_context.return_order_id,
      'consume', current_date,
      jsonb_build_array(jsonb_build_object(
        'issueLineId', v_context.return_line_id,
        'quantity', 3
      )),
      'Cố quyết toán phần đang chờ hoàn',
      'smoke-settlement-overbook',
      '[]'::jsonb
    );
  exception when others then
    v_blocked := position('sau khi giữ chỗ nhập hoàn' in sqlerrm) > 0;
  end;
  if not v_blocked then raise exception 'SMOKE_PENDING_SETTLEMENT_NOT_BLOCKED'; end if;

  perform public.post_material_issue_settlement_v1(
    v_context.return_order_id,
    'consume', current_date,
    jsonb_build_array(jsonb_build_object(
      'issueLineId', v_context.return_line_id,
      'quantity', 2
    )),
    'Quyết toán đúng phần còn lại',
    'smoke-settlement-allowed',
    '[]'::jsonb
  );

  v_blocked := false;
  begin
    update public.material_issue_lines
    set lost_qty = lost_qty + 1
    where id = v_context.return_line_id;
    perform public.process_transaction_status(
      v_second_return.transaction_id,
      'COMPLETED',
      v_context.actor_id
    );
  exception when others then
    v_blocked := position('không còn khả dụng' in sqlerrm) > 0;
  end;
  if not v_blocked then raise exception 'SMOKE_COMPLETION_RECHECK_NOT_BLOCKED'; end if;
  if (select status from public.transactions where id = v_second_return.transaction_id) <> 'PENDING' then
    raise exception 'SMOKE_FAILED_COMPLETION_CHANGED_WMS_STATUS';
  end if;
  select (stock_by_warehouse ->> v_context.warehouse_id)::numeric into v_stock
  from public.items where id = v_context.return_item_id;
  if v_stock <> 93 then raise exception 'SMOKE_FAILED_COMPLETION_CHANGED_STOCK'; end if;

  perform public.process_transaction_status(v_second_return.transaction_id, 'CANCELLED', v_context.actor_id);
  if (select status from public.material_issue_returns where id = v_second_return.id) <> 'cancelled' then
    raise exception 'SMOKE_CANCELLED_RETURN_NOT_RELEASED';
  end if;
  select (stock_by_warehouse ->> v_context.warehouse_id)::numeric into v_stock
  from public.items where id = v_context.return_item_id;
  if v_stock <> 93 then raise exception 'SMOKE_CANCELLED_RETURN_CHANGED_STOCK'; end if;

  v_second_return := public.create_material_issue_return_v2(
    v_context.return_order_id,
    v_context.warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'issueLineId', v_context.return_line_id,
      'returnQty', 5
    )),
    'Hoàn toàn bộ phần còn lại', null, 'smoke-return-final'
  );
  perform public.process_transaction_status(v_second_return.transaction_id, 'COMPLETED', v_context.actor_id);
  select (stock_by_warehouse ->> v_context.warehouse_id)::numeric into v_stock
  from public.items where id = v_context.return_item_id;
  if v_stock <> 98 then raise exception 'SMOKE_MULTI_RETURN_FINAL_STOCK_INVALID'; end if;
  if (select status from public.material_issue_orders where id = v_context.return_order_id) <> 'closed' then
    raise exception 'SMOKE_RETURN_ORDER_NOT_CLOSED';
  end if;
  if (public.create_material_issue_return_v2(
    v_context.return_order_id,
    v_context.warehouse_id,
    jsonb_build_array(jsonb_build_object(
      'issueLineId', v_context.return_line_id,
      'returnQty', 5
    )),
    'Hoàn toàn bộ phần còn lại', null, 'smoke-return-final'
  )).id <> v_second_return.id then
    raise exception 'SMOKE_COMPLETED_RETURN_RETRY_CHANGED_DOCUMENT';
  end if;
end;
$$;

do $$
declare
  v_context material_issue_reversal_smoke_context%rowtype;
begin
  select * into v_context from material_issue_reversal_smoke_context;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.actor_auth_id,
    'email', v_context.actor_email,
    'role', 'authenticated'
  )::text, true);

  perform public.cancel_material_issue_order(v_context.draft_order_id, 'Phiếu chưa xuất');
  if (select status from public.material_issue_orders where id = v_context.draft_order_id) <> 'cancelled' then
    raise exception 'SMOKE_DRAFT_CANCEL_FAILED';
  end if;
  if (select (stock_by_warehouse ->> v_context.warehouse_id)::numeric
      from public.items where id = v_context.eligibility_item_id) <> 90 then
    raise exception 'SMOKE_DRAFT_CANCEL_CHANGED_STOCK';
  end if;

  begin
    update public.material_issue_lines set received_qty = 1
    where id = v_context.eligibility_line_id;
    perform public.reverse_material_issue_approval_v1(
      v_context.eligibility_order_id, 'received must block', 'smoke-block-received'
    );
    raise exception 'SMOKE_RECEIVED_REVERSAL_NOT_BLOCKED';
  exception when others then
    if sqlerrm = 'SMOKE_RECEIVED_REVERSAL_NOT_BLOCKED'
       or position('đã được xác nhận nhận' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    update public.material_issue_lines set consumed_qty = 1
    where id = v_context.eligibility_line_id;
    perform public.reverse_material_issue_approval_v1(
      v_context.eligibility_order_id, 'consume must block', 'smoke-block-consume'
    );
    raise exception 'SMOKE_CONSUMED_REVERSAL_NOT_BLOCKED';
  exception when others then
    if sqlerrm = 'SMOKE_CONSUMED_REVERSAL_NOT_BLOCKED'
       or position('phát sinh sử dụng hoặc hao hụt' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    update public.material_issue_lines set returned_qty = 1
    where id = v_context.eligibility_line_id;
    perform public.reverse_material_issue_approval_v1(
      v_context.eligibility_order_id, 'return must block', 'smoke-block-returned'
    );
    raise exception 'SMOKE_RETURNED_REVERSAL_NOT_BLOCKED';
  exception when others then
    if sqlerrm = 'SMOKE_RETURNED_REVERSAL_NOT_BLOCKED'
       or position('phát sinh nhập hoàn' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    update public.material_issue_lines set lost_qty = 1
    where id = v_context.eligibility_line_id;
    perform public.reverse_material_issue_approval_v1(
      v_context.eligibility_order_id, 'loss must block', 'smoke-block-loss'
    );
    raise exception 'SMOKE_LOST_REVERSAL_NOT_BLOCKED';
  exception when others then
    if sqlerrm = 'SMOKE_LOST_REVERSAL_NOT_BLOCKED'
       or position('phát sinh sử dụng hoặc hao hụt' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.create_material_issue_return_v2(
      v_context.eligibility_order_id,
      v_context.warehouse_id,
      jsonb_build_array(jsonb_build_object(
        'issueLineId', v_context.eligibility_line_id,
        'returnQty', 1
      )),
      'pending must block reversal', null, 'smoke-pending-before-reversal'
    );
    perform public.reverse_material_issue_approval_v1(
      v_context.eligibility_order_id, 'pending must block', 'smoke-block-pending'
    );
    raise exception 'SMOKE_PENDING_REVERSAL_NOT_BLOCKED';
  exception when others then
    if sqlerrm = 'SMOKE_PENDING_REVERSAL_NOT_BLOCKED'
       or position('phát sinh nhập hoàn' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.create_material_issue_return_v2(
      v_context.eligibility_order_id,
      v_context.other_warehouse_id,
      jsonb_build_array(jsonb_build_object(
        'issueLineId', v_context.eligibility_line_id,
        'returnQty', 1
      )),
      'wrong return warehouse', null, 'smoke-wrong-return-warehouse'
    );
    raise exception 'SMOKE_WRONG_RETURN_WAREHOUSE_NOT_BLOCKED';
  exception when others then
    if sqlerrm = 'SMOKE_WRONG_RETURN_WAREHOUSE_NOT_BLOCKED'
       or position('đúng kho xuất nguồn' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

do $$
declare
  v_context material_issue_reversal_smoke_context%rowtype;
  v_blocked boolean := false;
begin
  select * into v_context from material_issue_reversal_smoke_context;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.wrong_actor_auth_id,
    'email', v_context.wrong_actor_email,
    'role', 'authenticated'
  )::text, true);

  begin
    perform public.reverse_material_issue_approval_v1(
      v_context.eligibility_order_id,
      'Sai phạm vi kho phải bị chặn',
      'smoke-wrong-warehouse'
    );
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'SMOKE_WRONG_WAREHOUSE_PERMISSION_NOT_BLOCKED'; end if;
end;
$$;

do $$
declare
  v_context material_issue_reversal_smoke_context%rowtype;
  v_order public.material_issue_orders%rowtype;
  v_reversal_transaction public.transactions%rowtype;
  v_stock_before numeric;
  v_stock_after numeric;
  v_report jsonb;
  v_report_row jsonb;
begin
  select * into v_context from material_issue_reversal_smoke_context;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.actor_auth_id,
    'email', v_context.actor_email,
    'role', 'authenticated'
  )::text, true);

  select (stock_by_warehouse ->> v_context.warehouse_id)::numeric
  into v_stock_before
  from public.items where id = v_context.reversal_item_id;
  if v_stock_before <> 90 then raise exception 'SMOKE_REVERSAL_OPENING_STOCK_INVALID'; end if;

  v_order := public.reverse_material_issue_approval_v1(
    v_context.reversal_order_id,
    'Duyệt nhầm, hàng chưa rời kho',
    'smoke-reversal-idempotency-key'
  );
  if v_order.status <> 'reversed' then raise exception 'SMOKE_ORDER_NOT_REVERSED'; end if;

  select * into v_reversal_transaction
  from public.transactions
  where reversal_of_transaction_id = v_context.original_reversal_tx_id;
  if v_reversal_transaction.status <> 'COMPLETED'
     or v_reversal_transaction.type <> 'IMPORT'
     or v_reversal_transaction.business_event_type <> 'reversal' then
    raise exception 'SMOKE_REVERSAL_TRANSACTION_INVALID';
  end if;

  select (stock_by_warehouse ->> v_context.warehouse_id)::numeric
  into v_stock_after
  from public.items where id = v_context.reversal_item_id;
  if v_stock_after <> 100 then raise exception 'SMOKE_REVERSAL_STOCK_NOT_RESTORED'; end if;

  perform public.reverse_material_issue_approval_v1(
    v_context.reversal_order_id,
    'Duyệt nhầm, hàng chưa rời kho',
    'smoke-reversal-idempotency-key'
  );
  select (stock_by_warehouse ->> v_context.warehouse_id)::numeric
  into v_stock_after
  from public.items where id = v_context.reversal_item_id;
  if v_stock_after <> 100 then raise exception 'SMOKE_REVERSAL_RETRY_CHANGED_STOCK'; end if;
  if (select count(*) from public.transactions
      where reversal_of_transaction_id = v_context.original_reversal_tx_id) <> 1 then
    raise exception 'SMOKE_REVERSAL_RETRY_DUPLICATED_TRANSACTION';
  end if;

  begin
    perform public.reverse_material_issue_approval_v1(
      v_context.reversal_order_id,
      'Payload khác',
      'smoke-reversal-idempotency-key'
    );
    raise exception 'SMOKE_IDEMPOTENCY_CONFLICT_NOT_BLOCKED';
  exception when others then
    if sqlerrm = 'SMOKE_IDEMPOTENCY_CONFLICT_NOT_BLOCKED' then raise; end if;
    if sqlerrm <> 'MATERIAL_ISSUE_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  if (select status from public.transactions where id = v_context.original_reversal_tx_id) <> 'COMPLETED' then
    raise exception 'SMOKE_ORIGINAL_WMS_MUTATED';
  end if;
  if (select returned_qty from public.material_issue_lines where id = v_context.reversal_line_id) <> 10 then
    raise exception 'SMOKE_REVERSAL_RETURNED_QTY_INVALID';
  end if;
  if (select coalesce(sum(quantity_delta), 0) from public.material_party_ledger
      where issue_order_id = v_context.reversal_order_id) <> 0 then
    raise exception 'SMOKE_PARTY_LEDGER_NOT_BALANCED';
  end if;
  if (select coalesce(sum(quantity_delta), 0)
      from public.inventory_ledger_entries
      where source_id in (v_context.original_reversal_tx_id, v_reversal_transaction.id)) <> 0 then
    raise exception 'SMOKE_INVENTORY_LEDGER_NOT_BALANCED';
  end if;
  if not exists (
    select 1
    from public.inventory_transactions reversal
    join public.inventory_transactions original
      on original.id = reversal.reversal_of_inventory_transaction_id
    where reversal.source_id = v_reversal_transaction.id
      and reversal.transaction_type = 'reversal'
      and original.source_id = v_context.original_reversal_tx_id
      and original.status = 'reversed'
  ) then
    raise exception 'SMOKE_INVENTORY_REVERSAL_LINK_MISSING';
  end if;

  v_report := public.get_inventory_ledger_report(
    jsonb_build_object(
      'warehouseId', v_context.warehouse_id,
      'materialId', v_context.reversal_item_id
    ),
    50,
    null
  );
  select value into v_report_row
  from jsonb_array_elements(v_report -> 'stockRows')
  limit 1;
  if coalesce((v_report_row ->> 'in_reversal')::numeric, 0) <> 10
     or coalesce((v_report_row ->> 'in_import')::numeric, 0) <> 0
     or coalesce((v_report_row ->> 'total_in')::numeric, 0) <> 10 then
    raise exception 'SMOKE_REVERSAL_REPORT_CLASSIFICATION_INVALID: %', v_report_row;
  end if;
end;
$$;

select jsonb_build_object(
  'materialIssueApprovalReversal', 'ok',
  'safeUnusedReturn', 'ok',
  'transaction', 'rollback'
) as material_issue_reversal_return_smoke;

rollback;

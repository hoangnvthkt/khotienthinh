-- V2 Kho một màn (doc 13 mục 26, chủ SP duyệt câu 33–38 ngày 10/10/2026).
--   * Bỏ phiếu nhập tự do: không tạo phiếu NHẬP theo đối tác / HĐ gõ tay (nguồn business_partner, supplier_contract
--     không gắn phiếu giao nhận HĐ). Hàng vào kho chỉ từ đợt giao Mua hàng, hàng chuyển đến, hàng trả lại từ công trình;
--     tồn đầu kỳ / hàng thừa đi qua kiểm đếm.
--   * Xuất cấp 1 bước (issue_material_now_v1): lập phiếu xuất cấp + gửi + xuất kho trong một lần, thủ kho kho xuất làm.
--     Không chờ duyệt, người nhận xác nhận không bắt buộc, không quyết toán từng phiếu.
--   * Chuyển kho: gửi hàng mang quy cách của dòng phiếu xuống sổ kho (kho nhận giữ đúng quy cách).
--   * Sửa lỗi cũ: duyệt phiếu làm tròn số lượng thành số nguyên khi cập nhật bản sao tồn trong danh mục → vật tư tồn lẻ
--     (52,6 tấn xi măng) báo lỗi khi xuất; nay dùng số lẻ.

create or replace function app_private.trg_block_free_import()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.type = 'IMPORT'::public.transaction_type
     and lower(coalesce(new.source_type, '')) in ('business_partner', 'supplier_contract')
     and not exists (select 1 from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x
       where nullif(x.value->>'supplierDirectDeliveryNoteId', '') is not null)
     and coalesce(current_setting('app.wms_allow_free_import', true), '') <> 'on' then
    raise exception using errcode = '22023', message = 'WMS_FREE_IMPORT_REMOVED';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_block_free_import on public.transactions;
create trigger trg_block_free_import before insert on public.transactions
  for each row execute function app_private.trg_block_free_import();

-- Xuất cấp 1 bước.
create or replace function public.issue_material_now_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_date timestamptz := nullif(p->>'transactionDate', '')::timestamptz;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if not app_private.wms_has_action('wms.transaction.approve', p->>'sourceWarehouseId', p->>'sourceWarehouseId') then
    raise exception using errcode = '42501', message = 'WMS_ISSUE_DENIED'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception using errcode = '22023', message = 'WMS_ISSUE_LINES_REQUIRED'; end if;
  v_order := public.create_material_issue_order(
    nullif(p->>'projectId', ''), nullif(p->>'constructionSiteId', ''), p->>'sourceWarehouseId',
    p->>'recipientType', nullif(p->>'recipientId', ''), p->>'recipientName', null,
    nullif(p->>'subcontractorContractId', ''), null, nullif(p->>'workBoqItemId', ''), null,
    nullif(btrim(coalesce(p->>'note', '')), ''), p->'lines',
    nullif(p->>'recipientSourceType', ''), nullif(p->>'recipientSourceId', ''));
  v_order := public.submit_material_issue_order_with_date(v_order.id, null, v_date);
  v_tx := public.process_transaction_approval(v_order.transaction_id, 'COMPLETED'::public.transaction_status, v_actor, null, null);
  select * into v_order from public.material_issue_orders where id = v_order.id;
  return jsonb_build_object('orderId', v_order.id, 'issueNo', v_order.issue_no, 'status', v_order.status,
    'transactionId', v_tx.id, 'transactionStatus', v_tx.status::text,
    'code', (select it.code from public.inventory_transactions it where it.source_id = v_tx.id order by it.created_at limit 1));
end;
$$;

CREATE OR REPLACE FUNCTION app_private.dispatch_wms_transfer_v1(p_transaction_id text, p_expected_version bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_tx public.transactions%rowtype;
  v_existing app_private.wms_commands%rowtype;
  v_payload_hash text;
  v_line record;
  v_transfer_line public.wms_transfer_lines%rowtype;
  v_qty numeric;
  v_lines jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'WMS_IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  v_payload_hash := md5(jsonb_build_object(
    'transactionId', p_transaction_id, 'expectedVersion', p_expected_version
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':dispatch_wms_transfer_v1:' || p_idempotency_key, 0
  ));
  select * into v_existing from app_private.wms_commands
  where actor_user_id = v_actor and command_name = 'dispatch_wms_transfer_v1'
    and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.payload_hash <> v_payload_hash then
      raise exception 'WMS_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_tx from public.transactions where id = p_transaction_id for update;
  if not found or v_tx.type <> 'TRANSFER'::public.transaction_type then
    raise exception 'WMS_TRANSFER_NOT_FOUND' using errcode = '22023';
  end if;
  if v_tx.row_version <> p_expected_version then
    raise exception 'WMS_TRANSFER_STALE_VERSION' using errcode = '40001';
  end if;
  if v_tx.status <> 'PENDING'::public.transaction_status then
    raise exception 'WMS_TRANSFER_NOT_PENDING' using errcode = '22023';
  end if;
  if nullif(v_tx.source_warehouse_id, '') is null
     or nullif(v_tx.target_warehouse_id, '') is null
     or v_tx.source_warehouse_id = v_tx.target_warehouse_id then
    raise exception 'WMS_TRANSFER_WAREHOUSE_INVALID' using errcode = '22023';
  end if;
  if not app_private.wms_transaction_has_action(
    'wms.transaction.approve', v_tx.type, v_tx.source_warehouse_id,
    v_tx.target_warehouse_id, v_tx.items, v_tx.requester_id, v_tx.approver_id, v_actor
  ) then
    raise exception 'WMS_TRANSFER_DISPATCH_DENIED' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(v_tx.items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(v_tx.items) = 0 then
    raise exception 'WMS_TRANSFER_LINES_REQUIRED' using errcode = '22023';
  end if;

  perform 1 from public.items item
  where item.id in (
    select payload.value ->> 'itemId'
    from jsonb_array_elements(v_tx.items) payload(value)
  ) order by item.id for update;

  if exists (
    select 1 from jsonb_array_elements(v_tx.items) payload(value)
    where nullif(payload.value ->> 'itemId', '') is null
      or coalesce(nullif(payload.value ->> 'quantity', '')::numeric, 0) <= 0
  ) then
    raise exception 'WMS_TRANSFER_LINE_INVALID' using errcode = '22023';
  end if;
  for v_line in
    select payload.value ->> 'itemId' item_id,
      sum((payload.value ->> 'quantity')::numeric) quantity
    from jsonb_array_elements(v_tx.items) payload(value)
    group by payload.value ->> 'itemId'
  loop
    if app_private.assert_wms_stock_authoritative(
      v_line.item_id, v_tx.source_warehouse_id
    ) < v_line.quantity then
      raise exception 'WMS_TRANSFER_STOCK_INSUFFICIENT' using errcode = '22023';
    end if;
  end loop;

  for v_line in
    select payload.value, payload.ordinality
    from jsonb_array_elements(v_tx.items) with ordinality payload(value, ordinality)
  loop
    v_qty := coalesce(nullif(v_line.value ->> 'quantity', '')::numeric, 0);
    insert into public.wms_transfer_lines(
      transaction_id, line_key, item_id, unit, dispatched_qty
    ) values (
      v_tx.id,
      coalesce(
        nullif(v_line.value ->> 'lineId', ''),
        nullif(v_line.value ->> 'purchaseOrderDeliveryLineId', ''),
        nullif(v_line.value ->> 'materialIssueLineId', ''),
        nullif(v_line.value ->> 'requestLineId', ''),
        (v_line.value ->> 'itemId') || ':' || v_line.ordinality::text
      ),
      v_line.value ->> 'itemId',
      nullif(coalesce(v_line.value ->> 'unit', v_line.value ->> 'unitSnapshot'), ''),
      v_qty
    ) returning * into v_transfer_line;
    perform public.apply_stock_change(v_transfer_line.item_id, v_tx.source_warehouse_id, -v_qty);
    if current_setting('app.g6_fault_after_transfer_stock', true) = 'on' then
      raise exception 'G6_INJECTED_FAILURE_AFTER_TRANSFER_STOCK';
    end if;
    insert into public.wms_transfer_events(
      transaction_id, transfer_line_id, event_type, quantity,
      warehouse_id, command_key, created_by
    ) values (
      v_tx.id, v_transfer_line.id, 'dispatched', v_qty,
      v_tx.source_warehouse_id, p_idempotency_key, v_actor
    );
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'transferLineId', v_transfer_line.id,
      'itemId', v_transfer_line.item_id,
      'quantity', v_qty,
      'unit', v_transfer_line.unit,
      'price', coalesce(nullif(v_line.value ->> 'price', '')::numeric, 0)
    ) || case when nullif(btrim(coalesce(v_line.value ->> 'specification', '')), '') is not null
      then jsonb_build_object('specification', btrim(v_line.value ->> 'specification')) else '{}'::jsonb end);
  end loop;

  perform app_private.post_wms_transfer_movement_v1(
    v_tx, 'dispatch:' || v_tx.id || ':' || p_idempotency_key,
    v_tx.source_warehouse_id, 'out', 'transfer_issue', 'dispatched',
    v_lines, v_actor
  );
  perform set_config('app.wms_transfer_command', 'on', true);
  update public.transactions
  set status = 'APPROVED'::public.transaction_status,
      approver_id = v_actor, approved_at = now(), row_version = row_version + 1
  where id = v_tx.id returning * into v_tx;
  perform set_config('app.wms_transfer_command', '', true);

  v_result := jsonb_build_object(
    'transactionId', v_tx.id, 'status', v_tx.status,
    'rowVersion', v_tx.row_version, 'inTransitQty', (
      select coalesce(sum(dispatched_qty - received_qty - returned_qty - lost_qty), 0)
      from public.wms_transfer_lines where transaction_id = v_tx.id
    ), 'replayed', false
  );
  insert into app_private.wms_commands(
    actor_user_id, command_name, idempotency_key, payload_hash, result, committed_at
  ) values (
    v_actor, 'dispatch_wms_transfer_v1', p_idempotency_key,
    v_payload_hash, v_result, now()
  );
  return v_result;
exception when others then
  perform set_config('app.wms_transfer_command', '', true);
  raise;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.process_transaction_status(p_transaction_id text, p_status transaction_status, p_approver_id uuid)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_line jsonb;
  v_pending jsonb;
  v_item_id text;
  v_qty numeric;
  v_can_approve boolean := false;
  v_can_complete boolean := false;
begin
  if p_status is null or p_status not in (
    'APPROVED'::public.transaction_status,
    'COMPLETED'::public.transaction_status,
    'CANCELLED'::public.transaction_status
  ) then
    raise exception 'unsupported transaction status target: %', p_status
      using errcode = '22023';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  if p_approver_id is not null and p_approver_id is distinct from v_user.id then
    raise exception 'approver id must match the authenticated user'
      using errcode = '42501';
  end if;

  v_can_approve := app_private.wms_transaction_has_action(
    'wms.transaction.approve', v_tx.type,
    v_tx.source_warehouse_id, v_tx.target_warehouse_id, v_tx.items,
    v_tx.requester_id, v_tx.approver_id, v_user.id
  );

  v_can_complete := app_private.wms_transaction_has_action(
    'wms.transaction.complete', v_tx.type,
    v_tx.source_warehouse_id, v_tx.target_warehouse_id, v_tx.items,
    v_tx.requester_id, v_tx.approver_id, v_user.id
  );

  -- V1-2: người Duyệt ngoại lệ duyệt / hoàn tất được phiếu xuất hủy, điều chỉnh (tách nhiệm kiểm ở trg_guard_wms_exception_approval).
  if v_tx.type::text in ('LIQUIDATION', 'ADJUSTMENT')
     and app_private.wms_user_can_approve_exception(v_user.id, coalesce(v_tx.source_warehouse_id, v_tx.target_warehouse_id)) then
    v_can_approve := true;
    v_can_complete := true;
  end if;

  if p_status = 'APPROVED'::public.transaction_status and not v_can_approve then
    raise exception 'insufficient privilege to approve transaction'
      using errcode = '42501';
  end if;

  if p_status = 'CANCELLED'::public.transaction_status
     and not v_can_approve
     and v_tx.requester_id is distinct from v_user.id then
    raise exception 'insufficient privilege to cancel transaction'
      using errcode = '42501';
  end if;

  if p_status = 'COMPLETED'::public.transaction_status and not v_can_complete then
    raise exception 'insufficient privilege to complete transaction'
      using errcode = '42501';
  end if;

  if v_tx.status = p_status then
    return v_tx;
  end if;
  if v_tx.status = 'CANCELLED'::public.transaction_status then
    raise exception 'cancelled transaction cannot be changed';
  end if;
  if v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'completed transaction cannot be changed';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_pending in
      select value from jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb))
    loop
      insert into public.items (
        id, sku, name, category, unit, purchase_unit,
        price_in, price_out, min_stock, supplier_id, image_url,
        stock_by_warehouse, location
      )
      values (
        v_pending->>'id',
        v_pending->>'sku',
        v_pending->>'name',
        coalesce(nullif(v_pending->>'category', ''), 'Khác'),
        coalesce(nullif(v_pending->>'unit', ''), 'Cái'),
        nullif(v_pending->>'purchaseUnit', ''),
        coalesce(nullif(v_pending->>'priceIn', '')::numeric, 0),
        coalesce(nullif(v_pending->>'priceOut', '')::numeric, 0),
        coalesce(nullif(v_pending->>'minStock', '')::integer, 0),
        nullif(v_pending->>'supplierId', ''),
        nullif(v_pending->>'imageUrl', ''),
        coalesce(v_pending->'stockByWarehouse', '{}'::jsonb),
        nullif(v_pending->>'location', '')
      )
      on conflict (id) do nothing;
    end loop;
  end if;

  if p_status = 'COMPLETED'::public.transaction_status then
    for v_line in
      select value from jsonb_array_elements(v_tx.items)
    loop
      v_item_id := v_line->>'itemId';
      v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
      if v_item_id is null or v_qty <= 0 then
        raise exception 'invalid transaction item payload';
      end if;

      if v_tx.type = 'IMPORT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type) then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
      elsif v_tx.type = 'TRANSFER'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type = 'ADJUSTMENT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  end if;

  update public.transactions
  set status = p_status,
      approver_id = v_user.id
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$function$
;


revoke all on function app_private.trg_block_free_import() from public, anon;
revoke all on function public.issue_material_now_v1(jsonb) from public, anon;
grant execute on function public.issue_material_now_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';

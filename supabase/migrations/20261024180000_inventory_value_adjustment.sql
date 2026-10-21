-- Bổ sung đơn giá cho dòng nhập kho giá 0 (21/10/2026, chủ SP duyệt "mỗi nhóm đúng luồng").
--
-- 1. Lỗi gốc PO-261: đợt giao lập khi Đơn mua chưa có giá → dòng đợt giao 0 đ; "giao tiếp phần còn lại" chép lại 0 đ.
--    Nay khi dòng đợt giao 0 đ thì lấy giá dòng Đơn mua (prepare… ghi lại vào dòng đợt giao; continue… dùng giá Đơn mua).
-- 2. Phiếu điều chỉnh giá trị (DCGT): Kế toán kho (wms.accounting.manage) bổ sung đơn giá cho dòng nhập giá 0 không có
--    luồng nào khác (nhập tay cũ, phiếu giao HĐ, phiếu dọn dữ liệu). Phiếu cũ giữ nguyên; phiếu mới ghi theo ngày lập:
--      giá trị nhập = SL nhập × đơn giá; phần của dòng nhập còn trong kho (nhập trước – xuất trước) vào giá trị tồn,
--      phần đã xuất vào giá trị xuất.
--    Phiếu nhập trực tiếp NCC chưa ghi công nợ phải bổ sung giá ở Tài chính → Phiếu nhập NCC (ghi luôn công nợ) — RPC từ chối.
-- 3. get_inventory_nxt_report_v1 cộng giá trị phiếu điều chỉnh; dòng nhập đã điều chỉnh không còn tính "thiếu đơn giá".

-- ---------------------------------------------------------------------------------------------------------
-- 1. Giá dòng Đơn mua (đơn vị mua) theo lineId.
create or replace function app_private.procurement_po_line_unit_price(p_items jsonb, p_line_id text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select nullif(x ->> 'unitPrice', '')::numeric
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
    where x ->> 'lineId' = p_line_id
    limit 1
  ), 0);
$$;

revoke all on function app_private.procurement_po_line_unit_price(jsonb, text) from public, anon, authenticated;

create or replace function app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(p_delivery_batch_id uuid, p_actor_user_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_line public.purchase_order_delivery_lines%rowtype;
  v_qr_token text := 'pod_' || replace(gen_random_uuid()::text, '-', '');
  v_tx_id text := 'tx-po-delivery-' || replace(gen_random_uuid()::text, '-', '');
  v_wms_items jsonb := '[]'::jsonb;
  v_purchase_unit_price numeric;
  v_stock_unit_price numeric;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if coalesce(v_po.source_mode, '') <> 'from_request' and not exists(select 1 from app_private.request_purchase_po_links where purchase_order_id=v_po.id)
     and not app_private.procurement_po_is_hub(v_po.metadata) then -- 08/10/2026: đơn do màn Mua hàng quản lý
    raise exception 'Chi chuan bi Dot giao cho Goi mua hang V2 tao tu MR.' using errcode = '22023';
  end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception 'Chi chuan bi Dot giao sau khi Goi da duyet.' using errcode = '22023';
  end if;
  if coalesce(v_batch.status, 'planned') not in ('planned', 'waiting_delivery', 'receiving', 'wms_pending') then
    raise exception 'Trang thai Dot giao khong cho phep tao WMS/QR: %', v_batch.status using errcode = '22023';
  end if;
  if coalesce(v_batch.wms_transaction_id, '') <> '' and coalesce(v_batch.qr_token, '') <> '' then
    return app_private.purchase_delivery_command_result_v2(v_batch.id);
  end if;
  if nullif(trim(coalesce(v_batch.target_warehouse_id, v_po.target_warehouse_id, '')), '') is null then
    raise exception 'Kho nhan hang la bat buoc de tao WMS/QR Dot giao.' using errcode = '22023';
  end if;

  for v_line in
    select *
    from public.purchase_order_delivery_lines
    where delivery_batch_id = v_batch.id
    order by id
  loop
    if coalesce(v_line.planned_qty, 0) <= 0 or coalesce(v_line.stock_planned_qty, 0) <= 0 then
      raise exception 'So luong Dot giao phai lon hon 0.' using errcode = '22023';
    end if;
    v_purchase_unit_price := coalesce(v_line.delivery_unit_price, 0);
    -- 21/10/2026 (PO-261): đợt giao lập khi Đơn mua chưa có giá → lấy giá dòng Đơn mua và ghi lại vào dòng đợt giao,
    -- để phiếu nhập, sổ kho và công nợ không bị 0 đ.
    if v_purchase_unit_price = 0 then
      v_purchase_unit_price := app_private.procurement_po_line_unit_price(v_po.items, v_line.purchase_order_line_id);
      if v_purchase_unit_price > 0 then
        update public.purchase_order_delivery_lines set delivery_unit_price = v_purchase_unit_price, updated_at = now() where id = v_line.id;
      end if;
    end if;
    if v_purchase_unit_price < 0 then
      raise exception 'Don gia Dot giao khong duoc am.' using errcode = '22023';
    end if;
    v_stock_unit_price := case
      when coalesce(v_line.stock_planned_qty, 0) > 0
        then v_purchase_unit_price * coalesce(v_line.planned_qty, 0) / coalesce(v_line.stock_planned_qty, 1)
      else 0
    end;

    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id,
      'quantity', v_line.stock_planned_qty,
      'orderedQty', v_line.stock_planned_qty,
      'price', v_stock_unit_price,
      'accountingQty', v_line.planned_qty,
      'accountingUnit', coalesce(v_line.unit, 'DV mua'),
      'accountingPrice', v_purchase_unit_price,
      'purchaseOrderLineId', v_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', v_batch.id,
      'purchaseOrderDeliveryLineId', v_line.id,
      'fulfillmentMode', coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode)
    ));
  end loop;

  if jsonb_array_length(v_wms_items) = 0 then
    raise exception 'Dot giao phai co it nhat mot dong vat tu.' using errcode = '22023';
  end if;

  insert into public.transactions (
    id, type, date, items, target_warehouse_id, supplier_id,
    requester_id, created_by, approver_id, status, note,
    business_partner_id, business_partner_name_snapshot, source_type, source_id
  ) values (
    v_tx_id, 'IMPORT'::public.transaction_type, now(), v_wms_items, coalesce(v_batch.target_warehouse_id, v_po.target_warehouse_id), nullif(coalesce(v_batch.supplier_id, v_po.vendor_id), ''),
    p_actor_user_id, p_actor_user_id, p_actor_user_id, 'PENDING'::public.transaction_status,
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(v_batch.delivery_no::text, 2, '0') || ' dang giao',
    null, nullif(coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name), ''), 'po_delivery_batch', v_batch.id::text
  );

  update public.purchase_order_delivery_batches
  set supplier_id = nullif(coalesce(v_batch.supplier_id, v_po.vendor_id), ''),
      supplier_name_snapshot = nullif(coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name), ''),
      fulfillment_mode = coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode),
      vat_rate = coalesce(v_batch.vat_rate, v_po.vat_rate, 0),
      qr_token = coalesce(v_batch.qr_token, v_qr_token),
      idempotency_key = coalesce(v_batch.idempotency_key, p_idempotency_key),
      wms_transaction_id = v_tx_id,
      status = 'receiving',
      updated_at = now()
  where id = v_batch.id;

  return app_private.purchase_delivery_command_result_v2(v_batch.id);
end;
$$;

create or replace function public.continue_purchase_delivery_v1(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_wh text;
  v_existing uuid;
  v_new uuid := gen_random_uuid();
  v_no integer;
  v_line public.purchase_order_delivery_lines%rowtype;
  v_rem numeric; v_factor numeric; v_amount numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_batch from public.purchase_order_delivery_batches where id = nullif(p->>'deliveryId', '')::uuid for update;
  if not found then raise exception using errcode = '22023', message = 'PURCHASE_CONTINUE_NOT_FOUND'; end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id for update;
  v_wh := coalesce(v_batch.target_warehouse_id, v_po.target_warehouse_id);
  if not (public.is_admin() or app_private.wms_has_action('wms.transaction.approve', v_wh, v_wh) or app_private.procurement_can('manage')) then
    raise exception using errcode = '42501', message = 'PURCHASE_CONTINUE_DENIED'; end if;

  -- Bấm lại: trả đợt đã sinh.
  select nullif(e.payload->>'deliveryId', '')::uuid into v_existing from public.procurement_hub_events e
  where e.entity_type = 'purchase_order' and e.entity_id = v_po.id and e.action = 'delivery_continue' and e.payload->>'fromDeliveryId' = v_batch.id::text
  order by e.created_at desc limit 1;
  if v_existing is not null then
    return (select jsonb_build_object('deliveryId', b.id, 'deliveryNo', b.delivery_no, 'wmsTransactionId', b.wms_transaction_id, 'replayed', true)
      from public.purchase_order_delivery_batches b where b.id = v_existing);
  end if;

  if v_batch.status <> 'received_short' then raise exception using errcode = '22023', message = 'PURCHASE_CONTINUE_NOT_SHORT'; end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then raise exception using errcode = '22023', message = 'PURCHASE_CONTINUE_PO_STATE'; end if;

  for v_line in select * from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id order by created_at, id loop
    v_rem := least(coalesce(v_line.planned_qty, 0) - coalesce(v_line.accepted_qty, 0),
      app_private.procurement_po_line_undelivered(v_po.id, v_po.items, v_line.purchase_order_line_id));
    if v_rem > 0.0000005 then
      v_factor := case when coalesce(v_line.planned_qty, 0) > 0 and coalesce(v_line.stock_planned_qty, 0) > 0
        then v_line.stock_planned_qty / v_line.planned_qty else 1 end;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('purchaseOrderLineId', v_line.purchase_order_line_id, 'itemId', v_line.item_id,
        'purchaseQty', v_rem, 'purchaseUnit', v_line.unit, 'stockQty', round(v_rem * v_factor, 6), 'stockUnit', v_line.stock_unit,
        'purchaseUnitPrice', coalesce(nullif(v_line.delivery_unit_price, 0), app_private.procurement_po_line_unit_price(v_po.items, v_line.purchase_order_line_id))));
      v_amount := v_amount + v_rem * coalesce(nullif(v_line.delivery_unit_price, 0), app_private.procurement_po_line_unit_price(v_po.items, v_line.purchase_order_line_id));
    end if;
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception using errcode = '22023', message = 'PURCHASE_CONTINUE_NOTHING_LEFT'; end if;

  select coalesce(max(delivery_no), 0) + 1 into v_no from public.purchase_order_delivery_batches where purchase_order_id = v_po.id;
  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  perform app_private.write_purchase_order_draft_batch_v1(v_po, jsonb_build_object('id', v_new, 'delivery_no', v_no,
    'planned_delivery_date', current_date, 'status', 'planned', 'approval_status', 'draft',
    'fulfillment_mode', coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode), 'vat_rate', coalesce(v_batch.vat_rate, 0),
    'note', 'NCC giao tiếp phần còn lại của đợt ' || v_batch.delivery_no, 'lines', v_lines), v_actor);
  update public.purchase_order_delivery_batches
  set target_warehouse_id = v_batch.target_warehouse_id, allocation_mode = v_batch.allocation_mode,
      project_id = v_batch.project_id, construction_site_id = v_batch.construction_site_id,
      supplier_id = coalesce(v_batch.supplier_id, supplier_id), supplier_name_snapshot = coalesce(v_batch.supplier_name_snapshot, supplier_name_snapshot),
      approval_status = 'approved', approval_requested_by = v_actor, approval_requested_at = now(),
      approval_decided_by = v_actor, approval_decided_at = now()
  where id = v_new;
  v_result := app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(v_new, v_actor, gen_random_uuid());
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('purchase_order', v_po.id, 'delivery_continue', v_actor,
    jsonb_build_object('fromDeliveryId', v_batch.id, 'fromDeliveryNo', v_batch.delivery_no, 'deliveryId', v_new, 'deliveryNo', v_no, 'amount', v_amount));
  if v_po.created_by_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and v_po.created_by_id <> v_actor::text then
    perform app_private.procurement_notify(v_po.created_by_id::uuid, 'NCC giao tiếp phần còn lại',
      coalesce(v_po.po_number, v_po.id) || ' — kho nhận thiếu đợt ' || v_batch.delivery_no || ', đã mở đợt ' || v_no || ' cho phần còn lại.', v_po.id, 'assigned');
  end if;
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('deliveryId', v_new, 'deliveryNo', v_no, 'wmsTransactionId', (select wms_transaction_id from public.purchase_order_delivery_batches where id = v_new),
    'amount', v_amount, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Phiếu điều chỉnh giá trị tồn kho.
create sequence if not exists public.inventory_value_adjustment_seq;

create table if not exists public.inventory_value_adjustments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  adjustment_date timestamptz not null default now(),
  reason text not null,
  total_in numeric(18, 2) not null default 0,
  total_out numeric(18, 2) not null default 0,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_value_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.inventory_value_adjustments(id) on delete restrict,
  ledger_entry_id uuid not null unique references public.inventory_ledger_entries(id) on delete restrict,
  material_id text not null,
  warehouse_id text not null,
  project_id text,
  construction_site_id text,
  quantity numeric not null check (quantity > 0),
  issued_quantity numeric not null default 0 check (issued_quantity >= 0),
  unit_price numeric not null check (unit_price > 0),
  value_in numeric(18, 2) not null,
  value_out numeric(18, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists inventory_value_adjustment_lines_item_idx
  on public.inventory_value_adjustment_lines (warehouse_id, material_id);
create index if not exists inventory_value_adjustment_lines_adjustment_idx
  on public.inventory_value_adjustment_lines (adjustment_id);

-- Chỉ đọc/ghi qua RPC (SECURITY DEFINER).
alter table public.inventory_value_adjustments enable row level security;
alter table public.inventory_value_adjustment_lines enable row level security;
revoke all on public.inventory_value_adjustments, public.inventory_value_adjustment_lines from anon, authenticated;
revoke all on sequence public.inventory_value_adjustment_seq from anon, authenticated;

-- Phiếu nhập trực tiếp NCC chưa ghi công nợ: bổ sung giá ở Tài chính (cùng điều kiện finance_direct_receipt_rows).
create or replace function app_private.inventory_receipt_is_finance_direct(p_tx_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.transactions t
    where t.id = p_tx_id and t.type::text = 'IMPORT' and t.status::text = 'COMPLETED'
      and t.business_event_type = 'direct_supplier_receipt' and t.source_type in ('supplier_contract', 'business_partner')
      and not exists (select 1 from public.supplier_payable_documents d where d.source_type = 'direct_supplier_receipt' and d.source_id = t.id)
  );
$$;

revoke all on function app_private.inventory_receipt_is_finance_direct(text) from public, anon, authenticated;

-- Phần của dòng nhập còn trong kho theo nhập trước – xuất trước: tồn hiện tại thuộc các dòng nhập mới nhất.
-- Không phụ thuộc thứ tự lập phiếu điều chỉnh; phần còn lại của dòng nhập coi là đã xuất.
create or replace function app_private.inventory_receipt_remaining_qty(p_entry_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(least(e.quantity_in,
    coalesce((select sum(x.quantity_delta) from public.inventory_ledger_entries x
      where x.material_id = e.material_id and x.warehouse_id = e.warehouse_id), 0)
    - coalesce((select sum(x.quantity_in) from public.inventory_ledger_entries x
      where x.material_id = e.material_id and x.warehouse_id = e.warehouse_id and x.movement_direction = 'in'
        and (x.transaction_date, x.created_at, x.id) > (e.transaction_date, e.created_at, e.id)), 0)), 0)
  from public.inventory_ledger_entries e
  where e.id = p_entry_id;
$$;

revoke all on function app_private.inventory_receipt_remaining_qty(uuid) from public, anon, authenticated;

-- Dòng nhập giá 0 của một (kho, vật tư) cho màn Bổ sung đơn giá.
create or replace function public.get_inventory_unpriced_receipts_v1(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_warehouse_id text := nullif(p_filters ->> 'warehouseId', '');
  v_material_id text := nullif(p_filters ->> 'materialId', '');
  v_view_tokens text[];
  v_keeper_tokens text[];
  v_can boolean;
  v_lines jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_warehouse_id is null or v_material_id is null then
    raise exception using errcode = '22023', message = 'INVENTORY_VALUE_SCOPE_REQUIRED'; end if;
  v_view_tokens := app_private.wms_action_scope_tokens(array['wms.inventory.view']);
  v_keeper_tokens := app_private.permission_scope_tokens(array['wms.transaction.keeper']);
  v_can := app_private.wms_has_action('wms.accounting.manage', v_warehouse_id, v_warehouse_id, null, null, v_actor);

  with lines as (
    select e.*, i.unit as item_unit, i.price_in, t.business_partner_name_snapshot, t.note as tx_note,
      (select max(coalesce(nullif(x ->> 'price', '')::numeric, 0)) from jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) x
        where x ->> 'itemId' = e.material_id) as document_price
    from public.inventory_ledger_entries e
    left join public.items i on i.id = e.material_id
    left join public.transactions t on t.id = e.source_id
    where e.warehouse_id = v_warehouse_id and e.material_id = v_material_id
      and e.movement_direction = 'in' and e.quantity_in > 0 and coalesce(e.unit_price, 0) = 0
      and not exists (select 1 from public.inventory_value_adjustment_lines l where l.ledger_entry_id = e.id)
      and (
        v_view_tokens && array['global:*', 'warehouse:*', 'warehouse:' || e.warehouse_id,
          case when e.created_by = v_actor then 'own:*' end, case when e.approved_by = v_actor then 'assigned:*' end]
        or e.created_by = v_actor or e.approved_by = v_actor
        or v_keeper_tokens && array['global:*', 'warehouse:*', 'warehouse:' || e.warehouse_id]
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'ledgerEntryId', l.id,
      'date', l.transaction_date,
      'documentCode', l.document_code,
      'transactionId', l.source_id,
      'quantity', l.quantity_in,
      'unit', coalesce(l.unit, l.item_unit),
      'partner', nullif(l.business_partner_name_snapshot, ''),
      'note', nullif(l.tx_note, ''),
      'route', case when app_private.inventory_receipt_is_finance_direct(l.source_id) then 'finance' else 'adjust' end,
      'suggestedPrice', coalesce(nullif(l.document_price, 0), nullif(l.price_in, 0)),
      'suggestedSource', case when coalesce(l.document_price, 0) > 0 then 'document' when coalesce(l.price_in, 0) > 0 then 'catalog' end,
      'remainingQty', app_private.inventory_receipt_remaining_qty(l.id)
    ) order by l.transaction_date, l.entry_no), '[]'::jsonb)
  into v_lines
  from lines l;

  return jsonb_build_object('canAdjust', v_can, 'lines', v_lines);
end;
$$;

revoke all on function public.get_inventory_unpriced_receipts_v1(jsonb) from public, anon;
grant execute on function public.get_inventory_unpriced_receipts_v1(jsonb) to authenticated, service_role;

-- Ghi phiếu điều chỉnh giá trị. p = { reason, lines: [{ ledgerEntryId, unitPrice }] }
create or replace function public.post_inventory_value_adjustment_v1(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := nullif(btrim(coalesce(p ->> 'reason', '')), '');
  v_id uuid := gen_random_uuid();
  v_code text;
  v_line jsonb;
  v_e public.inventory_ledger_entries%rowtype;
  v_price numeric;
  v_issued numeric;
  v_in numeric;
  v_out numeric;
  v_total_in numeric := 0;
  v_total_out numeric := 0;
  v_n integer;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'INVENTORY_VALUE_REASON_REQUIRED'; end if;
  if jsonb_typeof(p -> 'lines') is distinct from 'array' or jsonb_array_length(p -> 'lines') = 0 then
    raise exception using errcode = '22023', message = 'INVENTORY_VALUE_LINES_REQUIRED'; end if;

  v_code := 'DCGT-' || to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'YYMM') || '-'
    || lpad(nextval('public.inventory_value_adjustment_seq')::text, 4, '0');
  insert into public.inventory_value_adjustments (id, code, reason, created_by) values (v_id, v_code, v_reason, v_actor);

  for v_line in select value from jsonb_array_elements(p -> 'lines') loop
    select * into v_e from public.inventory_ledger_entries where id = nullif(v_line ->> 'ledgerEntryId', '')::uuid for update;
    if not found or v_e.movement_direction <> 'in' or coalesce(v_e.quantity_in, 0) <= 0 then
      raise exception using errcode = '22023', message = 'INVENTORY_VALUE_LINE_INVALID'; end if;
    if not app_private.wms_has_action('wms.accounting.manage', v_e.warehouse_id, v_e.warehouse_id, null, null, v_actor) then
      raise exception using errcode = '42501', message = 'INVENTORY_VALUE_DENIED'; end if;
    if coalesce(v_e.unit_price, 0) <> 0 or exists (select 1 from public.inventory_value_adjustment_lines l where l.ledger_entry_id = v_e.id) then
      raise exception using errcode = '22023', message = 'INVENTORY_VALUE_ALREADY_PRICED', detail = v_e.document_code; end if;
    if app_private.inventory_receipt_is_finance_direct(v_e.source_id) then
      raise exception using errcode = '22023', message = 'INVENTORY_VALUE_FINANCE_ROUTE', detail = v_e.document_code; end if;
    v_price := round(nullif(v_line ->> 'unitPrice', '')::numeric, 6);
    if v_price is null or v_price <= 0 then
      raise exception using errcode = '22023', message = 'INVENTORY_VALUE_PRICE_INVALID', detail = v_e.document_code; end if;

    v_issued := v_e.quantity_in - coalesce(app_private.inventory_receipt_remaining_qty(v_e.id), 0);
    v_in := round(v_e.quantity_in * v_price, 2);
    v_out := round(v_issued * v_price, 2);

    insert into public.inventory_value_adjustment_lines (adjustment_id, ledger_entry_id, material_id, warehouse_id, project_id, construction_site_id,
      quantity, issued_quantity, unit_price, value_in, value_out)
    values (v_id, v_e.id, v_e.material_id, v_e.warehouse_id, v_e.project_id, v_e.construction_site_id,
      v_e.quantity_in, v_issued, v_price, v_in, v_out);

    -- Giá trị tồn: phần còn trong kho.
    update public.inventory_balances b set total_value = b.total_value + (v_in - v_out),
      average_unit_cost = case when b.on_hand_qty = 0 then 0 else (b.total_value + (v_in - v_out)) / b.on_hand_qty end, updated_at = now()
    where b.material_id = v_e.material_id and b.warehouse_id = v_e.warehouse_id
      and b.project_id is not distinct from v_e.project_id and b.construction_site_id is not distinct from v_e.construction_site_id;
    get diagnostics v_n = row_count;
    if v_n <> 1 and abs(v_in - v_out) > 0.004 then
      raise exception using errcode = 'P0001', message = 'INVENTORY_VALUE_BALANCE_MISMATCH', detail = v_e.document_code; end if;

    v_total_in := v_total_in + v_in;
    v_total_out := v_total_out + v_out;
  end loop;

  update public.inventory_value_adjustments set total_in = v_total_in, total_out = v_total_out where id = v_id;

  insert into public.audit_trail (table_name, record_id, action, new_data, user_id, user_name, module, description, record_label,
    entity_type, change_count, impact_level, context)
  values ('inventory_value_adjustments', v_id::text, 'INSERT', jsonb_build_object('totalIn', v_total_in, 'totalOut', v_total_out),
    v_actor::text, (select u.name from public.users u where u.id = v_actor), 'WMS',
    'Phiếu điều chỉnh giá trị ' || v_code || ': nhập +' || trim(to_char(v_total_in, 'FM999G999G999G990')) || ' đ, xuất +'
      || trim(to_char(v_total_out, 'FM999G999G999G990')) || ' đ',
    v_code, 'Phiếu điều chỉnh giá trị', jsonb_array_length(p -> 'lines'), 'normal', jsonb_build_object('reason', v_reason));

  return jsonb_build_object('id', v_id, 'code', v_code, 'totalIn', v_total_in, 'totalOut', v_total_out, 'totalStock', v_total_in - v_total_out);
end;
$$;

revoke all on function public.post_inventory_value_adjustment_v1(jsonb) from public, anon;
grant execute on function public.post_inventory_value_adjustment_v1(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Báo cáo NXT cộng phiếu điều chỉnh giá trị.
create or replace function public.get_inventory_nxt_report_v1(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_view_tokens text[];
  v_keeper_tokens text[];
  v_warehouse_id text := nullif(nullif(coalesce(p_filters ->> 'warehouseId', ''), ''), 'ALL');
  v_material_id text := nullif(nullif(coalesce(p_filters ->> 'materialId', ''), ''), 'ALL');
  v_from timestamptz := app_private.inventory_report_day_start(p_filters ->> 'dateFrom');
  v_to timestamptz := app_private.inventory_report_day_end(p_filters ->> 'dateTo');
  v_search text := lower(trim(coalesce(p_filters ->> 'search', '')));
  v_rows jsonb;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_from is null or v_to is null then
    raise exception 'Chọn Từ ngày và Đến ngày' using errcode = '22023';
  end if;
  if v_from > v_to then
    raise exception 'Từ ngày phải trước Đến ngày' using errcode = '22023';
  end if;

  v_view_tokens := app_private.wms_action_scope_tokens(array['wms.inventory.view']);
  v_keeper_tokens := app_private.permission_scope_tokens(array['wms.transaction.keeper']);

  with scoped as (
    select
      e.id as entry_id,
      e.warehouse_id,
      e.material_id,
      (
        e.transaction_date < v_from
        or coalesce(e.business_event_type, e.metadata ->> 'businessEventType') = 'opening_balance'
      ) as is_opening,
      e.movement_direction,
      coalesce(e.quantity_in, 0) as quantity_in,
      coalesce(e.quantity_out, 0) as quantity_out,
      coalesce(e.quantity_delta, 0) as quantity_delta,
      coalesce(e.amount, 0) as amount
    from public.inventory_ledger_entries e
    left join public.items i on i.id = e.material_id
    where e.transaction_date <= v_to
      and (v_warehouse_id is null or e.warehouse_id = v_warehouse_id)
      and (v_material_id is null or e.material_id = v_material_id)
      and (
        v_search = ''
        or lower(coalesce(i.sku, '') || ' ' || coalesce(i.name, '')) like '%' || v_search || '%'
      )
      and (
        v_view_tokens && array[
          'global:*',
          case when e.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || e.warehouse_id,
          case when e.created_by = v_actor then 'own:*' end,
          case when e.approved_by = v_actor then 'assigned:*' end
        ]
        or e.created_by = v_actor
        or e.approved_by = v_actor
        or v_keeper_tokens && array[
          'global:*',
          case when e.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || e.warehouse_id
        ]
      )
  ),
  -- Phiếu điều chỉnh giá trị (bổ sung đơn giá cho dòng nhập giá 0): chỉ có giá trị, ghi theo ngày phiếu.
  -- Phần đã xuất vào cột Xuất kho giá trị, phần còn tồn vào giá trị cuối kỳ.
  adjusted as (
    select s.warehouse_id, s.material_id, l.value_in, l.value_out, h.adjustment_date < v_from as is_opening
    from public.inventory_value_adjustment_lines l
    join public.inventory_value_adjustments h on h.id = l.adjustment_id
    join scoped s on s.entry_id = l.ledger_entry_id
    where h.adjustment_date <= v_to
  ),
  moves as (
    select s.warehouse_id, s.material_id, s.is_opening, s.movement_direction, s.quantity_in, s.quantity_out, s.quantity_delta, s.amount,
      s.movement_direction = 'in' and s.quantity_in > 0 and s.amount = 0
        and not exists (
          select 1 from public.inventory_value_adjustment_lines l
          join public.inventory_value_adjustments h on h.id = l.adjustment_id
          where l.ledger_entry_id = s.entry_id and h.adjustment_date <= v_to
        ) as unpriced
    from scoped s
    union all
    select warehouse_id, material_id, is_opening, 'in', 0, 0, 0, value_in, false from adjusted
    union all
    select warehouse_id, material_id, is_opening, 'out', 0, 0, 0, -value_out, false from adjusted where value_out <> 0
  ),
  grouped as (
    select
      warehouse_id,
      material_id,
      coalesce(sum(quantity_delta) filter (where is_opening), 0) as opening_qty,
      coalesce(sum(amount) filter (where is_opening), 0) as opening_value,
      coalesce(sum(quantity_in) filter (where not is_opening), 0) as in_qty,
      coalesce(sum(amount) filter (where not is_opening and movement_direction = 'in'), 0) as in_value,
      coalesce(sum(quantity_out) filter (where not is_opening), 0) as out_qty,
      -coalesce(sum(amount) filter (where not is_opening and movement_direction = 'out'), 0) as out_value,
      count(*) filter (where not is_opening and unpriced) as unpriced_in_lines
    from moves
    group by warehouse_id, material_id
  ),
  shaped as (
    select
      g.*,
      g.opening_qty + g.in_qty - g.out_qty as closing_qty,
      g.opening_value + g.in_value - g.out_value as closing_value,
      i.sku,
      i.name as material_name,
      i.unit,
      w.name as warehouse_name
    from grouped g
    left join public.items i on i.id = g.material_id
    left join public.warehouses w on w.id = g.warehouse_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'warehouseId', s.warehouse_id,
      'warehouseName', coalesce(s.warehouse_name, s.warehouse_id),
      'materialId', s.material_id,
      'sku', coalesce(s.sku, s.material_id),
      'name', coalesce(s.material_name, s.material_id),
      'unit', s.unit,
      'openingQty', round(s.opening_qty, 4),
      'openingValue', round(s.opening_value, 0),
      'inQty', round(s.in_qty, 4),
      'inValue', round(s.in_value, 0),
      'outQty', round(s.out_qty, 4),
      'outValue', round(s.out_value, 0),
      'closingQty', round(s.closing_qty, 4),
      'closingValue', round(s.closing_value, 0),
      'unpricedInLines', s.unpriced_in_lines,
      'itemMissing', s.material_name is null
    ) order by s.material_name is null, coalesce(s.sku, s.material_id), coalesce(s.warehouse_name, s.warehouse_id)), '[]'::jsonb)
  into v_rows
  from shaped s
  -- Bỏ dòng không có số liệu (như MISA "Không hiển thị dòng không có số liệu").
  where abs(s.opening_qty) >= 0.00005 or abs(s.opening_value) >= 0.5
     or s.in_qty <> 0 or s.out_qty <> 0
     or abs(s.closing_qty) >= 0.00005 or abs(s.closing_value) >= 0.5;

  return jsonb_build_object(
    'dateFrom', p_filters ->> 'dateFrom',
    'dateTo', p_filters ->> 'dateTo',
    'rows', v_rows
  );
end;
$$;

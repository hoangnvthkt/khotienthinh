-- A PO sourced from an MR and split into several deliveries is a demand
-- package.  Commercial approval belongs to each delivery, not to the parent
-- PO.  Warehouse status deliberately remains a separate lifecycle.
alter table public.purchase_order_delivery_batches
  add column if not exists approval_status text not null default 'draft',
  add column if not exists approval_requested_by uuid null,
  add column if not exists approval_requested_at timestamptz null,
  add column if not exists approval_decided_by uuid null,
  add column if not exists approval_decided_at timestamptz null,
  add column if not exists approval_decision_note text null;

alter table public.purchase_order_delivery_batches
  drop constraint if exists purchase_order_delivery_batches_approval_status_check;
alter table public.purchase_order_delivery_batches
  add constraint purchase_order_delivery_batches_approval_status_check
  check (approval_status in ('draft', 'pending_approval', 'approved', 'revision_requested', 'rejected'));

create index if not exists idx_po_delivery_batches_approval
  on public.purchase_order_delivery_batches (purchase_order_id, approval_status, delivery_no);

create or replace function app_private.assert_multiple_delivery_batch_overage_reason_v1(
  p_purchase_order_id text,
  p_delivery_batch_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  select variance_reason into v_reason
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id and purchase_order_id = p_purchase_order_id;

  if coalesce(trim(v_reason), '') <> '' then
    return;
  end if;

  if exists (
    with allocated as (
      select line.purchase_order_line_id, sum(coalesce(line.stock_planned_qty, 0)) as allocated_qty
      from public.purchase_order_delivery_batches batch
      join public.purchase_order_delivery_lines line on line.delivery_batch_id = batch.id
      where batch.purchase_order_id = p_purchase_order_id
        and batch.status <> 'cancelled'
      group by line.purchase_order_line_id
    ), requested as (
      select coalesce(item.value ->> 'lineId', item.value ->> 'itemId') as line_id,
        coalesce(nullif(item.value ->> 'requestedQtySnapshot', '')::numeric,
                 nullif(item.value ->> 'qty', '')::numeric, 0) as requested_qty
      from public.purchase_orders po
      cross join lateral jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) item(value)
      where po.id = p_purchase_order_id
    )
    select 1
    from allocated
    join requested on requested.line_id = allocated.purchase_order_line_id
    where allocated.allocated_qty > requested.requested_qty + 0.000001
  ) then
    raise exception 'Đợt giao vượt nhu cầu MR; phải nhập lý do vượt nhu cầu.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.submit_purchase_order_delivery_batch_approval_v1(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  select * into v_batch from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;
  if not found then raise exception 'Không tìm thấy đợt giao.' using errcode = '22023'; end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id for update;
  if coalesce(v_po.source_mode, '') <> 'from_request' or coalesce(v_po.purchase_mode, '') <> 'multiple' then
    raise exception 'Chỉ áp dụng duyệt đợt cho PO MR chia nhiều đợt.' using errcode = '22023';
  end if;
  perform app_private.assert_project_permission_room_action(v_po.project_id, v_po.construction_site_id, 'material_po', 'submit', v_actor);
  if v_batch.status <> 'planned' or v_batch.wms_transaction_id is not null or v_batch.qr_token is not null then
    raise exception 'Chỉ gửi duyệt đợt nháp chưa tạo WMS/QR.' using errcode = '22023';
  end if;
  if coalesce(v_batch.approval_status, 'draft') not in ('draft', 'revision_requested', 'rejected') then
    raise exception 'Đợt giao đang chờ duyệt hoặc đã duyệt.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.purchase_order_delivery_lines
    where delivery_batch_id = v_batch.id and planned_qty > 0 and stock_planned_qty > 0 and delivery_unit_price >= 0
  ) then
    raise exception 'Đợt giao phải có SL yêu cầu và SL mua lớn hơn 0.' using errcode = '22023';
  end if;
  perform app_private.assert_multiple_delivery_batch_overage_reason_v1(v_po.id, v_batch.id);

  update public.purchase_order_delivery_batches
  set approval_status = 'pending_approval', approval_requested_by = v_actor, approval_requested_at = now(),
      approval_decided_by = null, approval_decided_at = null, approval_decision_note = null, updated_at = now()
  where id = v_batch.id;
  return jsonb_build_object('deliveryBatchId', v_batch.id, 'approvalStatus', 'pending_approval');
end;
$$;

create or replace function public.return_purchase_order_delivery_batch_approval_v1(
  p_delivery_batch_id uuid,
  p_decision text,
  p_note text default null,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_next_status text;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  v_next_status := case p_decision when 'revision_requested' then 'revision_requested' when 'rejected' then 'rejected' else null end;
  if v_next_status is null then raise exception 'Quyết định duyệt không hợp lệ.' using errcode = '22023'; end if;
  select * into v_batch from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;
  if not found then raise exception 'Không tìm thấy đợt giao.' using errcode = '22023'; end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id for update;
  perform app_private.assert_project_permission_room_action(v_po.project_id, v_po.construction_site_id, 'material_po', 'approve', v_actor);
  if coalesce(v_batch.approval_status, 'draft') <> 'pending_approval' or v_batch.wms_transaction_id is not null then
    raise exception 'Chỉ trả lại hoặc từ chối đợt đang chờ duyệt.' using errcode = '22023';
  end if;
  update public.purchase_order_delivery_batches
  set approval_status = v_next_status, approval_decided_by = v_actor, approval_decided_at = now(),
      approval_decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  where id = v_batch.id;
  return jsonb_build_object('deliveryBatchId', v_batch.id, 'approvalStatus', v_next_status);
end;
$$;

create or replace function public.approve_purchase_order_delivery_batch_v1(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_line public.purchase_order_delivery_lines%rowtype;
  v_item jsonb;
  v_wms_items jsonb := '[]'::jsonb;
  v_tx_id text := 'tx-po-delivery-' || replace(gen_random_uuid()::text, '-', '');
  v_qr_token text := 'pod_' || replace(gen_random_uuid()::text, '-', '');
  v_previous_guard text;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  select * into v_batch from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;
  if not found then raise exception 'Không tìm thấy đợt giao.' using errcode = '22023'; end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id for update;
  if coalesce(v_po.source_mode, '') <> 'from_request' or coalesce(v_po.purchase_mode, '') <> 'multiple' then
    raise exception 'Chỉ áp dụng duyệt đợt cho PO MR chia nhiều đợt.' using errcode = '22023';
  end if;
  perform app_private.assert_project_permission_room_action(v_po.project_id, v_po.construction_site_id, 'material_po', 'approve', v_actor);
  if coalesce(v_batch.approval_status, 'draft') = 'approved' and v_batch.wms_transaction_id is not null then
    return jsonb_build_object('deliveryBatchId', v_batch.id, 'wmsTransactionId', v_batch.wms_transaction_id, 'qrToken', v_batch.qr_token);
  end if;
  if coalesce(v_batch.approval_status, 'draft') <> 'pending_approval' or v_batch.wms_transaction_id is not null then
    raise exception 'Chỉ duyệt đợt đang chờ duyệt và chưa có WMS/QR.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(v_po.target_warehouse_id, '')), '') is null then
    raise exception 'PO thiếu kho nhận hàng.' using errcode = '22023';
  end if;
  perform app_private.assert_multiple_delivery_batch_overage_reason_v1(v_po.id, v_batch.id);

  for v_line in select * from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id loop
    if v_line.planned_qty <= 0 or v_line.stock_planned_qty <= 0 then
      raise exception 'SL yêu cầu và SL mua của đợt phải lớn hơn 0.' using errcode = '22023';
    end if;
    select item.value into v_item
    from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) as item(value)
    where coalesce(item.value ->> 'lineId', item.value ->> 'itemId') = v_line.purchase_order_line_id
    limit 1;
    if v_item is null or coalesce(v_item ->> 'itemId', '') <> v_line.item_id then
      raise exception 'Dòng đợt giao không khớp với PO.' using errcode = '22023';
    end if;
    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id, 'quantity', v_line.stock_planned_qty, 'orderedQty', v_line.stock_planned_qty,
      'price', v_line.delivery_unit_price, 'accountingQty', v_line.planned_qty, 'accountingUnit', v_line.unit,
      'accountingPrice', v_line.delivery_unit_price, 'purchaseOrderLineId', v_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', v_batch.id, 'purchaseOrderDeliveryLineId', v_line.id,
      'fulfillmentMode', v_po.fulfillment_mode
    ));
  end loop;
  if jsonb_array_length(v_wms_items) = 0 then raise exception 'Đợt giao không có dòng hàng.' using errcode = '22023'; end if;

  insert into public.transactions (
    id, type, date, items, target_warehouse_id, supplier_id, requester_id, created_by, approver_id, status, note,
    business_partner_id, business_partner_name_snapshot, source_type, source_id
  ) values (
    v_tx_id, 'IMPORT'::public.transaction_type, now(), v_wms_items, v_po.target_warehouse_id, v_po.vendor_id,
    v_actor, v_actor, v_actor, 'PENDING'::public.transaction_status,
    coalesce(v_po.po_number, v_po.id) || '-Đợt ' || v_batch.delivery_no || ' đã duyệt',
    null, v_po.vendor_name, 'po_delivery_batch', v_batch.id::text
  );
  update public.purchase_order_delivery_batches
  set approval_status = 'approved', approval_decided_by = v_actor, approval_decided_at = now(),
      qr_token = v_qr_token, idempotency_key = gen_random_uuid(), wms_transaction_id = v_tx_id,
      status = 'receiving', updated_at = now()
  where id = v_batch.id;
  if v_po.status in ('draft', 'sent', 'returned') then
    v_previous_guard := current_setting('app.material_transition_context', true);
    perform set_config('app.material_transition_context', 'on', true);
    update public.purchase_orders set status = 'in_transit', ever_submitted = true, last_action_by = v_actor::text, last_action_at = now()
    where id = v_po.id;
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  end if;
  return jsonb_build_object('deliveryBatchId', v_batch.id, 'wmsTransactionId', v_tx_id, 'qrToken', v_qr_token);
exception when others then
  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  raise;
end;
$$;

revoke all on function public.submit_purchase_order_delivery_batch_approval_v1(uuid, uuid) from public, anon;
revoke all on function public.return_purchase_order_delivery_batch_approval_v1(uuid, text, text, uuid) from public, anon;
revoke all on function public.approve_purchase_order_delivery_batch_v1(uuid, uuid) from public, anon;
grant execute on function public.submit_purchase_order_delivery_batch_approval_v1(uuid, uuid) to authenticated;
grant execute on function public.return_purchase_order_delivery_batch_approval_v1(uuid, text, text, uuid) to authenticated;
grant execute on function public.approve_purchase_order_delivery_batch_v1(uuid, uuid) to authenticated;

-- Existing open multiple-delivery PO lines retain the MR snapshot as their
-- parent demand.  Do not recalculate it from the catalog conversion factor.
update public.purchase_orders po
set items = (
  select jsonb_agg(
    case
      when link.id is null then item.value
      else item.value || jsonb_build_object(
        'requestedQtySnapshot', coalesce(nullif(item.value ->> 'requestedQtySnapshot', '')::numeric, link.requested_qty_snapshot, link.requested_qty, nullif(item.value ->> 'qty', '')::numeric),
        'requestedUnitSnapshot', coalesce(nullif(item.value ->> 'requestedUnitSnapshot', ''), nullif(item.value ->> 'stockUnitSnapshot', ''), nullif(item.value ->> 'unitSnapshot', ''), item.value ->> 'unit'),
        'qty', coalesce(nullif(item.value ->> 'requestedQtySnapshot', '')::numeric, link.requested_qty_snapshot, link.requested_qty, nullif(item.value ->> 'qty', '')::numeric),
        'unit', coalesce(nullif(item.value ->> 'requestedUnitSnapshot', ''), nullif(item.value ->> 'stockUnitSnapshot', ''), nullif(item.value ->> 'unitSnapshot', ''), item.value ->> 'unit'),
        'unitPrice', 0
      )
    end
  )
  from jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) item(value)
  left join lateral (
    select id, requested_qty_snapshot, requested_qty
    from public.purchase_order_request_lines link
    where link.purchase_order_id = po.id
      and link.purchase_order_line_id = coalesce(item.value ->> 'lineId', item.value ->> 'itemId')
    limit 1
  ) link on true
)
where po.source_mode = 'from_request'
  and po.purchase_mode = 'multiple'
  and po.status not in ('cancelled', 'closed');

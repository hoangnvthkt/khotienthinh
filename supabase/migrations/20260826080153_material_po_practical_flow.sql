-- One practical material PO flow on top of the existing V2 PO/WMS foundation.
-- MR quantities are references. Physical delivery/acceptance quantities may
-- differ when the variance is explained; inventory is posted only at finalize.

alter table public.purchase_order_delivery_lines
  add column if not exists delivered_qty numeric not null default 0,
  add column if not exists delivered_stock_qty numeric not null default 0;

update public.purchase_order_delivery_lines
set delivered_qty = greatest(delivered_qty, accepted_qty),
    delivered_stock_qty = greatest(delivered_stock_qty, accepted_stock_qty);

alter table public.purchase_order_delivery_lines
  drop constraint if exists purchase_order_delivery_lines_practical_qty_check;
alter table public.purchase_order_delivery_lines
  add constraint purchase_order_delivery_lines_practical_qty_check check (
    delivered_qty >= 0
    and accepted_qty >= 0
    and delivered_stock_qty >= 0
    and accepted_stock_qty >= 0
    and accepted_qty <= delivered_qty
    and accepted_stock_qty <= delivered_stock_qty
  ) not valid;
alter table public.purchase_order_delivery_lines
  validate constraint purchase_order_delivery_lines_practical_qty_check;

create or replace function app_private.assert_material_po_batch_overage_reason(
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
  select batch.variance_reason
  into v_reason
  from public.purchase_order_delivery_batches batch
  where batch.id = p_delivery_batch_id
    and batch.purchase_order_id = p_purchase_order_id;

  if coalesce(trim(v_reason), '') <> '' then
    return;
  end if;

  if exists (
    with active_allocated as (
      select
        line.purchase_order_line_id,
        sum(coalesce(line.stock_planned_qty, line.planned_qty, 0)) as allocated_qty
      from public.purchase_order_delivery_batches batch
      join public.purchase_order_delivery_lines line
        on line.delivery_batch_id = batch.id
      where batch.purchase_order_id = p_purchase_order_id
        and batch.status <> 'cancelled'
        and (
          batch.id = p_delivery_batch_id
          or coalesce(batch.approval_status, 'draft') in ('pending_approval', 'approved')
        )
      group by line.purchase_order_line_id
    ), requested as (
      select
        coalesce(item.value ->> 'lineId', item.value ->> 'itemId') as line_id,
        coalesce(
          nullif(item.value ->> 'requestedQtySnapshot', '')::numeric,
          nullif(item.value ->> 'qty', '')::numeric,
          0
        ) as requested_qty
      from public.purchase_orders po
      cross join lateral jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) item(value)
      where po.id = p_purchase_order_id
    )
    select 1
    from active_allocated allocated
    join requested on requested.line_id = allocated.purchase_order_line_id
    where allocated.allocated_qty > requested.requested_qty + 0.000001
  ) then
    raise exception 'Tổng các đợt đang duyệt/đã duyệt vượt nhu cầu MR; phải nhập lý do.'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function app_private.assert_material_po_batch_overage_reason(text, uuid)
  from public, anon, authenticated;

create or replace function app_private.ensure_material_po_batch_wms(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_id text;
  v_po public.purchase_orders%rowtype;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_line public.purchase_order_delivery_lines%rowtype;
  v_tx public.transactions%rowtype;
  v_tx_id text := 'tx-po-delivery-' || replace(gen_random_uuid()::text, '-', '');
  v_qr_token text := 'pod_' || replace(gen_random_uuid()::text, '-', '');
  v_wms_items jsonb := '[]'::jsonb;
  v_stock_unit_price numeric;
  v_previous_guard text;
begin
  if p_actor_user_id is null then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;

  select batch.purchase_order_id
  into v_po_id
  from public.purchase_order_delivery_batches batch
  where batch.id = p_delivery_batch_id;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders po
  where po.id = v_po_id
  for update;

  select * into v_batch
  from public.purchase_order_delivery_batches batch
  where batch.id = p_delivery_batch_id
  for update;

  if public.current_app_user_id() is not null then
    if public.current_app_user_id() <> p_actor_user_id then
      raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
    end if;
    perform app_private.assert_project_permission_room_action(
      v_po.project_id,
      v_po.construction_site_id,
      'material_po',
      'approve',
      p_actor_user_id
    );
  end if;

  if coalesce(v_po.source_mode, '') <> 'from_request' then
    raise exception 'Chỉ áp dụng cho PO vật tư tạo từ phiếu đề xuất.' using errcode = '22023';
  end if;
  if v_batch.supplier_id is not null
     and v_batch.supplier_id is distinct from v_po.vendor_id then
    raise exception 'Nhà cung cấp của đợt giao không khớp PO.' using errcode = '22023';
  end if;
  if coalesce(v_batch.vat_rate, v_po.vat_rate, 0) < 0
     or coalesce(v_batch.vat_rate, v_po.vat_rate, 0) > 100 then
    raise exception 'Thuế VAT phải trong khoảng 0 đến 100.' using errcode = '22023';
  end if;
  if v_batch.status in ('cancelled', 'received', 'received_short', 'received_over') then
    raise exception 'Đợt giao đã kết thúc, không thể tạo phiếu WMS.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(v_po.target_warehouse_id, '')), '') is null then
    raise exception 'PO thiếu kho nhận hàng.' using errcode = '22023';
  end if;

  if nullif(coalesce(v_batch.wms_transaction_id, ''), '') is not null then
    select * into v_tx
    from public.transactions tx
    where tx.id = v_batch.wms_transaction_id
    for update;
    if not found
       or v_tx.source_type <> 'po_delivery_batch'
       or v_tx.source_id <> v_batch.id::text then
      raise exception 'WMS hiện tại không liên kết đúng đợt giao.' using errcode = 'P0001';
    end if;

    update public.purchase_order_delivery_batches
    set qr_token = coalesce(qr_token, v_qr_token),
        idempotency_key = coalesce(idempotency_key, gen_random_uuid()),
        status = case
          when v_tx.status = 'PENDING'::public.transaction_status
            and status in ('planned', 'wms_pending', 'waiting_delivery') then 'receiving'
          else status
        end,
        updated_at = now()
    where id = v_batch.id
    returning * into v_batch;

    return jsonb_build_object(
      'deliveryBatchId', v_batch.id,
      'deliveryNo', v_batch.delivery_no,
      'deliveryCode', coalesce(v_po.po_number, v_po.id) || '-' || lpad(v_batch.delivery_no::text, 2, '0'),
      'wmsTransactionId', v_batch.wms_transaction_id,
      'qrToken', v_batch.qr_token
    );
  end if;

  for v_line in
    select *
    from public.purchase_order_delivery_lines line
    where line.delivery_batch_id = v_batch.id
    order by line.id
  loop
    if coalesce(v_line.planned_qty, 0) <= 0
       or coalesce(v_line.stock_planned_qty, 0) <= 0 then
      raise exception 'Số lượng của đợt giao phải lớn hơn 0.' using errcode = '22023';
    end if;
    if coalesce(v_line.delivery_unit_price, 0) < 0 then
      raise exception 'Đơn giá đợt giao không được âm.' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) item(value)
      where coalesce(item.value ->> 'lineId', item.value ->> 'itemId') = v_line.purchase_order_line_id
        and item.value ->> 'itemId' = v_line.item_id
    ) then
      raise exception 'Dòng đợt giao không thuộc PO.' using errcode = '22023';
    end if;

    v_stock_unit_price := case
      when coalesce(v_line.stock_planned_qty, 0) > 0 then
        coalesce(v_line.delivery_unit_price, 0)
          * coalesce(v_line.planned_qty, 0)
          / v_line.stock_planned_qty
      else 0
    end;

    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id,
      'quantity', v_line.stock_planned_qty,
      'orderedQty', v_line.stock_planned_qty,
      'price', v_stock_unit_price,
      'accountingQty', v_line.planned_qty,
      'accountingUnit', coalesce(v_line.unit, v_line.stock_unit, ''),
      'accountingPrice', coalesce(v_line.delivery_unit_price, 0),
      'purchaseOrderLineId', v_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', v_batch.id,
      'purchaseOrderDeliveryLineId', v_line.id,
      'fulfillmentMode', coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode)
    ));
  end loop;

  if jsonb_array_length(v_wms_items) = 0 then
    raise exception 'Đợt giao phải có ít nhất một dòng vật tư.' using errcode = '22023';
  end if;

  insert into public.transactions (
    id, type, date, items, target_warehouse_id, supplier_id,
    requester_id, created_by, approver_id, status, note,
    business_partner_id, business_partner_name_snapshot, source_type, source_id
  ) values (
    v_tx_id,
    'IMPORT'::public.transaction_type,
    now(),
    v_wms_items,
    v_po.target_warehouse_id,
    nullif(coalesce(v_batch.supplier_id, v_po.vendor_id), ''),
    p_actor_user_id,
    p_actor_user_id,
    p_actor_user_id,
    'PENDING'::public.transaction_status,
    coalesce(v_po.po_number, v_po.id) || '-Đợt ' || v_batch.delivery_no || ' chờ nhận',
    null,
    nullif(coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name), ''),
    'po_delivery_batch',
    v_batch.id::text
  );

  update public.purchase_order_delivery_batches
  set supplier_id = nullif(coalesce(supplier_id, v_po.vendor_id), ''),
      supplier_name_snapshot = nullif(coalesce(supplier_name_snapshot, v_po.vendor_name), ''),
      fulfillment_mode = coalesce(fulfillment_mode, v_po.fulfillment_mode),
      vat_rate = coalesce(vat_rate, v_po.vat_rate, 0),
      qr_token = coalesce(qr_token, v_qr_token),
      idempotency_key = coalesce(idempotency_key, gen_random_uuid()),
      wms_transaction_id = v_tx_id,
      status = 'receiving',
      updated_at = now()
  where id = v_batch.id
  returning * into v_batch;

  if v_po.status in ('draft', 'sent', 'returned', 'confirmed') then
    v_previous_guard := current_setting('app.material_transition_context', true);
    perform set_config('app.material_transition_context', 'on', true);
    update public.purchase_orders
    set status = 'in_transit',
        ever_submitted = true,
        last_action_by = p_actor_user_id::text,
        last_action_at = now()
    where id = v_po.id;
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  end if;

  return jsonb_build_object(
    'deliveryBatchId', v_batch.id,
    'deliveryNo', v_batch.delivery_no,
    'deliveryCode', coalesce(v_po.po_number, v_po.id) || '-' || lpad(v_batch.delivery_no::text, 2, '0'),
    'wmsTransactionId', v_batch.wms_transaction_id,
    'qrToken', v_batch.qr_token
  );
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function app_private.ensure_material_po_batch_wms(uuid, uuid)
  from public, anon, authenticated;

create or replace function app_private.submit_material_po_batch(
  p_delivery_batch_id uuid,
  p_approver_user_id uuid,
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
  if p_approver_user_id is null then
    raise exception 'Phải chọn người duyệt đợt giao.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = '22023';
  end if;
  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;

  if coalesce(v_po.source_mode, '') <> 'from_request'
     or coalesce(v_po.purchase_mode, '') <> 'multiple' then
    raise exception 'Chỉ gửi duyệt từng đợt cho PO vật tư giao nhiều lần.' using errcode = '22023';
  end if;
  perform app_private.assert_project_permission_room_action(
    v_po.project_id, v_po.construction_site_id, 'material_po', 'submit', v_actor
  );
  perform app_private.assert_project_permission_room_action(
    v_po.project_id, v_po.construction_site_id, 'material_po', 'approve', p_approver_user_id
  );

  if v_batch.status <> 'planned'
     or v_batch.wms_transaction_id is not null
     or v_batch.qr_token is not null then
    raise exception 'Chỉ gửi duyệt đợt nháp chưa tạo WMS/QR.' using errcode = '22023';
  end if;
  if coalesce(v_batch.approval_status, 'draft') not in ('draft', 'revision_requested', 'rejected') then
    raise exception 'Đợt giao đang chờ duyệt hoặc đã duyệt.' using errcode = '22023';
  end if;
  if v_batch.supplier_id is not null
     and v_batch.supplier_id is distinct from v_po.vendor_id then
    raise exception 'Nhà cung cấp của đợt giao không khớp PO.' using errcode = '22023';
  end if;
  if coalesce(v_batch.vat_rate, v_po.vat_rate, 0) < 0
     or coalesce(v_batch.vat_rate, v_po.vat_rate, 0) > 100 then
    raise exception 'Thuế VAT phải trong khoảng 0 đến 100.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.purchase_order_delivery_lines line
    where line.delivery_batch_id = v_batch.id
      and line.planned_qty > 0
      and line.stock_planned_qty > 0
      and coalesce(line.delivery_unit_price, 0) >= 0
  ) then
    raise exception 'Đợt giao phải có số lượng lớn hơn 0 và đơn giá không âm.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.purchase_order_delivery_lines line
    where line.delivery_batch_id = v_batch.id
      and (
        line.planned_qty <= 0
        or line.stock_planned_qty <= 0
        or coalesce(line.delivery_unit_price, 0) < 0
      )
  ) then
    raise exception 'Mọi dòng đợt giao phải có số lượng lớn hơn 0 và đơn giá không âm.'
      using errcode = '22023';
  end if;

  perform app_private.assert_material_po_batch_overage_reason(v_po.id, v_batch.id);

  update public.purchase_order_delivery_batches
  set approval_status = 'pending_approval',
      approval_requested_by = v_actor,
      approval_requested_at = now(),
      approval_decided_by = null,
      approval_decided_at = null,
      approval_decision_note = null,
      updated_at = now()
  where id = v_batch.id;

  return jsonb_build_object(
    'deliveryBatchId', v_batch.id,
    'approvalStatus', 'pending_approval',
    'approverUserId', p_approver_user_id
  );
end;
$$;

create or replace function app_private.decide_material_po_batch(
  p_delivery_batch_id uuid,
  p_decision text,
  p_note text,
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
  if p_decision not in ('revision_requested', 'rejected') then
    raise exception 'Quyết định duyệt không hợp lệ.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = '22023';
  end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id;
  perform app_private.assert_project_permission_room_action(
    v_po.project_id, v_po.construction_site_id, 'material_po', 'approve', v_actor
  );

  if coalesce(v_batch.approval_status, 'draft') <> 'pending_approval'
     or v_batch.wms_transaction_id is not null then
    raise exception 'Chỉ xử lý đợt đang chờ duyệt.' using errcode = '22023';
  end if;

  update public.purchase_order_delivery_batches
  set approval_status = p_decision,
      approval_decided_by = v_actor,
      approval_decided_at = now(),
      approval_decision_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = v_batch.id;

  return jsonb_build_object(
    'deliveryBatchId', v_batch.id,
    'approvalStatus', p_decision
  );
end;
$$;

create or replace function app_private.approve_material_po_batch(
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
  v_result jsonb;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = '22023';
  end if;
  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;

  if coalesce(v_po.source_mode, '') <> 'from_request'
     or coalesce(v_po.purchase_mode, '') <> 'multiple' then
    raise exception 'Chỉ duyệt từng đợt cho PO vật tư giao nhiều lần.' using errcode = '22023';
  end if;
  perform app_private.assert_project_permission_room_action(
    v_po.project_id, v_po.construction_site_id, 'material_po', 'approve', v_actor
  );

  if coalesce(v_batch.approval_status, 'draft') = 'approved'
     and v_batch.wms_transaction_id is not null then
    return app_private.ensure_material_po_batch_wms(v_batch.id, v_actor)
      || jsonb_build_object('approvalStatus', 'approved');
  end if;
  if coalesce(v_batch.approval_status, 'draft') not in ('pending_approval', 'approved')
     or (v_batch.wms_transaction_id is not null and v_batch.approval_status <> 'approved') then
    raise exception 'Chỉ duyệt đợt đang chờ duyệt hoặc khôi phục đợt đã duyệt thiếu WMS.'
      using errcode = '22023';
  end if;

  perform app_private.assert_material_po_batch_overage_reason(v_po.id, v_batch.id);
  v_result := app_private.ensure_material_po_batch_wms(v_batch.id, v_actor);

  update public.purchase_order_delivery_batches
  set approval_status = 'approved',
      approval_decided_by = coalesce(approval_decided_by, v_actor),
      approval_decided_at = coalesce(approval_decided_at, now()),
      approval_decision_note = null,
      updated_at = now()
  where id = v_batch.id;

  return v_result || jsonb_build_object('approvalStatus', 'approved');
end;
$$;

revoke all on function app_private.submit_material_po_batch(uuid, uuid, uuid)
  from public, anon;
revoke all on function app_private.decide_material_po_batch(uuid, text, text, uuid)
  from public, anon;
revoke all on function app_private.approve_material_po_batch(uuid, uuid)
  from public, anon;
grant execute on function app_private.submit_material_po_batch(uuid, uuid, uuid)
  to authenticated;
grant execute on function app_private.decide_material_po_batch(uuid, text, text, uuid)
  to authenticated;
grant execute on function app_private.approve_material_po_batch(uuid, uuid)
  to authenticated;

create or replace function public.submit_material_po_batch(
  p_delivery_batch_id uuid,
  p_approver_user_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  return app_private.submit_material_po_batch(
    p_delivery_batch_id,
    p_approver_user_id,
    v_actor
  );
end;
$$;

create or replace function public.decide_material_po_batch(
  p_delivery_batch_id uuid,
  p_decision text,
  p_note text,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  return app_private.decide_material_po_batch(
    p_delivery_batch_id,
    p_decision,
    p_note,
    v_actor
  );
end;
$$;

create or replace function public.approve_material_po_batch(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  return app_private.approve_material_po_batch(p_delivery_batch_id, v_actor);
end;
$$;

create or replace function public.approve_single_material_po(
  p_purchase_order_id text,
  p_actor_user_id uuid default null,
  p_idempotency_key uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_mode text;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  select po.purchase_mode into v_mode
  from public.purchase_orders po
  where po.id = p_purchase_order_id;
  if not found or coalesce(v_mode, 'single') <> 'single' then
    raise exception 'Chỉ duyệt đơn mua hàng giao một lần bằng lệnh này.' using errcode = '22023';
  end if;

  return app_private.approve_purchase_package_and_prepare_single_batch_v2(
    p_purchase_order_id,
    v_actor,
    coalesce(p_idempotency_key, gen_random_uuid())
  );
end;
$$;

create or replace function app_private.approve_material_po_quality(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid,
  p_quality_result text,
  p_lines jsonb,
  p_attachments jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_id text;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_tx public.transactions%rowtype;
  v_line jsonb;
  v_delivery_line public.purchase_order_delivery_lines%rowtype;
  v_delivery_line_id uuid;
  v_item_id text;
  v_delivered_purchase_qty numeric;
  v_accepted_purchase_qty numeric;
  v_delivered_stock_qty numeric;
  v_accepted_stock_qty numeric;
  v_variance_reason text;
  v_seen_line_ids uuid[] := '{}'::uuid[];
  v_expected_line_count integer;
  v_wms_items jsonb := '[]'::jsonb;
  v_gross numeric := 0;
  v_combined_reason text;
  v_stock_factor numeric;
  v_stock_unit_price numeric;
begin
  if p_actor_user_id is null
     or public.current_app_user_id() is null
     or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  if p_quality_result not in ('passed', 'partial', 'rejected') then
    raise exception 'Kết quả kiểm tra SL/CL không hợp lệ.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Dữ liệu nhận hàng không hợp lệ.' using errcode = '22023';
  end if;

  select batch.purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches batch
  where batch.id = p_delivery_batch_id;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = '22023';
  end if;

  perform 1 from public.purchase_orders where id = v_po_id for update;
  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if v_batch.wms_transaction_id is distinct from p_wms_transaction_id
     or v_batch.status <> 'receiving' then
    raise exception 'Đợt giao không còn ở trạng thái chờ duyệt SL/CL.' using errcode = '22023';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_wms_transaction_id
  for update;
  if not found
     or v_tx.source_type <> 'po_delivery_batch'
     or v_tx.source_id <> p_delivery_batch_id::text then
    raise exception 'WMS không liên kết đúng đợt giao.' using errcode = '22023';
  end if;
  if v_tx.status <> 'PENDING'::public.transaction_status then
    raise exception 'Phiếu WMS không còn chờ duyệt SL/CL.' using errcode = '22023';
  end if;
  if not app_private.current_user_can_receive_purchase_batch_v2(
    p_actor_user_id,
    v_tx.target_warehouse_id
  ) then
    raise exception 'Người dùng không có quyền duyệt SL/CL tại kho nhận.' using errcode = '42501';
  end if;

  select count(*) into v_expected_line_count
  from public.purchase_order_delivery_lines
  where delivery_batch_id = p_delivery_batch_id;
  if v_expected_line_count = 0
     or jsonb_array_length(p_lines) <> v_expected_line_count then
    raise exception 'Payload nhận hàng phải khớp 1-1 với dòng đợt giao.' using errcode = '22023';
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines) line(value)
  loop
    v_delivery_line_id := nullif(coalesce(
      v_line ->> 'deliveryLineId', v_line ->> 'delivery_line_id'
    ), '')::uuid;
    v_item_id := nullif(coalesce(v_line ->> 'itemId', v_line ->> 'item_id'), '');
    v_accepted_purchase_qty := coalesce(nullif(coalesce(
      v_line ->> 'acceptedPurchaseQty', v_line ->> 'accepted_purchase_qty'
    ), '')::numeric, 0);
    v_delivered_purchase_qty := coalesce(nullif(coalesce(
      v_line ->> 'deliveredPurchaseQty', v_line ->> 'delivered_purchase_qty'
    ), '')::numeric, v_accepted_purchase_qty);
    v_accepted_stock_qty := coalesce(nullif(coalesce(
      v_line ->> 'acceptedStockQty', v_line ->> 'accepted_stock_qty'
    ), '')::numeric, 0);
    v_delivered_stock_qty := coalesce(nullif(coalesce(
      v_line ->> 'deliveredStockQty', v_line ->> 'delivered_stock_qty'
    ), '')::numeric, v_accepted_stock_qty);
    v_variance_reason := nullif(trim(coalesce(
      v_line ->> 'varianceReason', v_line ->> 'variance_reason', ''
    )), '');

    if v_delivery_line_id is null or v_item_id is null then
      raise exception 'Dòng nhận hàng thiếu deliveryLineId hoặc itemId.' using errcode = '22023';
    end if;
    if v_delivery_line_id = any(v_seen_line_ids) then
      raise exception 'Dòng nhận hàng bị lặp.' using errcode = '22023';
    end if;
    if v_delivered_purchase_qty < 0
       or v_accepted_purchase_qty < 0
       or v_delivered_stock_qty < 0
       or v_accepted_stock_qty < 0 then
      raise exception 'Số lượng thực tế không được âm.' using errcode = '22023';
    end if;
    if v_accepted_purchase_qty > v_delivered_purchase_qty then
      raise exception 'Số chấp nhận không được lớn hơn số giao thực tế.' using errcode = '22023';
    end if;
    if v_accepted_stock_qty > v_delivered_stock_qty then
      raise exception 'Số nhập kho không được lớn hơn số giao theo đơn vị tồn kho.' using errcode = '22023';
    end if;

    select * into v_delivery_line
    from public.purchase_order_delivery_lines
    where id = v_delivery_line_id
      and delivery_batch_id = p_delivery_batch_id
    for update;
    if not found or v_delivery_line.item_id <> v_item_id then
      raise exception 'Dòng nhận hàng không thuộc đợt giao.' using errcode = '22023';
    end if;

    if (
      v_delivered_purchase_qty is distinct from coalesce(v_delivery_line.planned_qty, 0)
      or v_accepted_purchase_qty is distinct from v_delivered_purchase_qty
      or v_accepted_stock_qty is distinct from v_delivered_stock_qty
    ) and v_variance_reason is null then
      raise exception 'Phải nhập lý do khi số đặt, giao hoặc chấp nhận chênh lệch.' using errcode = '22023';
    end if;

    update public.purchase_order_delivery_lines
    set delivered_qty = v_delivered_purchase_qty,
        accepted_qty = v_accepted_purchase_qty,
        delivered_stock_qty = v_delivered_stock_qty,
        accepted_stock_qty = v_accepted_stock_qty,
        updated_at = now()
    where id = v_delivery_line.id;

    v_seen_line_ids := array_append(v_seen_line_ids, v_delivery_line.id);
    if v_variance_reason is not null then
      v_combined_reason := concat_ws('; ', v_combined_reason, v_variance_reason);
    end if;
    v_stock_factor := case
      when coalesce(v_delivery_line.planned_qty, 0) > 0
        and coalesce(v_delivery_line.stock_planned_qty, 0) > 0 then
          v_delivery_line.stock_planned_qty / v_delivery_line.planned_qty
      else 1
    end;
    v_stock_unit_price := case
      when v_stock_factor > 0 then coalesce(v_delivery_line.delivery_unit_price, 0) / v_stock_factor
      else coalesce(v_delivery_line.delivery_unit_price, 0)
    end;
    v_gross := v_gross
      + v_accepted_purchase_qty
      * coalesce(v_delivery_line.delivery_unit_price, 0)
      * (1 + coalesce(v_batch.vat_rate, 0) / 100);

    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_delivery_line.item_id,
      'quantity', v_accepted_stock_qty,
      'orderedQty', coalesce(v_delivery_line.stock_planned_qty, v_delivery_line.planned_qty, 0),
      'deliveredStockQty', v_delivered_stock_qty,
      'price', v_stock_unit_price,
      'accountingQty', v_accepted_purchase_qty,
      'orderedPurchaseQty', v_delivery_line.planned_qty,
      'deliveredPurchaseQty', v_delivered_purchase_qty,
      'accountingUnit', coalesce(v_delivery_line.unit, v_delivery_line.stock_unit, ''),
      'accountingPrice', coalesce(v_delivery_line.delivery_unit_price, 0),
      'varianceQty', v_accepted_purchase_qty - coalesce(v_delivery_line.planned_qty, 0),
      'varianceReason', v_variance_reason,
      'purchaseOrderLineId', v_delivery_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', p_delivery_batch_id,
      'purchaseOrderDeliveryLineId', v_delivery_line.id,
      'fulfillmentMode', coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK')
    ));
  end loop;

  if coalesce(array_length(v_seen_line_ids, 1), 0) <> v_expected_line_count then
    raise exception 'Payload nhận hàng thiếu dòng đợt giao.' using errcode = '22023';
  end if;

  update public.transactions
  set items = v_wms_items,
      attachments = coalesce(p_attachments, '[]'::jsonb),
      status = 'APPROVED'::public.transaction_status,
      approver_id = p_actor_user_id,
      approved_at = now()
  where id = p_wms_transaction_id;

  update public.purchase_order_delivery_batches
  set status = 'quality_approved',
      quality_result = p_quality_result,
      variance_reason = v_combined_reason,
      quality_approved_by = p_actor_user_id,
      quality_approved_at = now(),
      accepted_gross_amount = round(v_gross, 2),
      updated_at = now()
  where id = p_delivery_batch_id;

  return app_private.purchase_receipt_command_result_v2(p_delivery_batch_id, false);
end;
$$;

revoke all on function app_private.approve_material_po_quality(uuid, text, uuid, text, jsonb, jsonb)
  from public, anon;
grant execute on function app_private.approve_material_po_quality(uuid, text, uuid, text, jsonb, jsonb)
  to authenticated;

create or replace function public.approve_material_po_quality(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid default null,
  p_quality_result text default 'passed',
  p_lines jsonb default '[]'::jsonb,
  p_attachments jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  return app_private.approve_material_po_quality(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor,
    p_quality_result,
    p_lines,
    p_attachments
  );
end;
$$;

create or replace function public.finalize_material_po_receipt(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_result jsonb;
  v_po_id text;
  v_purchase_mode text;
  v_previous_guard text;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;

  v_result := app_private.finalize_purchase_receipt_v2(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor
  );

  select batch.purchase_order_id, po.purchase_mode
  into v_po_id, v_purchase_mode
  from public.purchase_order_delivery_batches batch
  join public.purchase_orders po on po.id = batch.purchase_order_id
  where batch.id = p_delivery_batch_id;

  if coalesce(v_purchase_mode, 'single') = 'single'
     and v_result ->> 'transactionStatus' = 'COMPLETED' then
    v_previous_guard := current_setting('app.material_transition_context', true);
    perform set_config('app.material_transition_context', 'on', true);
    update public.purchase_orders
    set status = 'delivered',
        actual_delivery_date = coalesce(actual_delivery_date, current_date::text)
    where id = v_po_id;
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    v_result := v_result || jsonb_build_object('purchaseOrderStatus', 'delivered');
  else
    v_result := v_result || jsonb_build_object(
      'purchaseOrderStatus', (select status from public.purchase_orders where id = v_po_id)
    );
  end if;

  return v_result;
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function public.submit_material_po_batch(uuid, uuid, uuid) from public, anon;
revoke all on function public.decide_material_po_batch(uuid, text, text, uuid) from public, anon;
revoke all on function public.approve_material_po_batch(uuid, uuid) from public, anon;
revoke all on function public.approve_single_material_po(text, uuid, uuid) from public, anon;
revoke all on function public.approve_material_po_quality(uuid, text, uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.finalize_material_po_receipt(uuid, text, uuid) from public, anon;

grant execute on function public.submit_material_po_batch(uuid, uuid, uuid) to authenticated;
grant execute on function public.decide_material_po_batch(uuid, text, text, uuid) to authenticated;
grant execute on function public.approve_material_po_batch(uuid, uuid) to authenticated;
grant execute on function public.approve_single_material_po(text, uuid, uuid) to authenticated;
grant execute on function public.approve_material_po_quality(uuid, text, uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.finalize_material_po_receipt(uuid, text, uuid) to authenticated;

-- Convert only the three POs affected by the rejected V3/V4 experiments.
-- IDs, WMS links, QR tokens, fulfillment links, audits and quality values stay intact.
update public.purchase_orders
set procurement_flow_version = 2
where po_number in ('PO-211', 'PO-259', 'PO-414')
  and procurement_flow_version in (3, 4);

update public.purchase_order_delivery_batches batch
set approval_status = 'approved',
    updated_at = now()
from public.purchase_orders po
where po.id = batch.purchase_order_id
  and po.po_number in ('PO-211', 'PO-259', 'PO-414')
  and batch.status <> 'cancelled'
  and (
    batch.wms_transaction_id is not null
    or batch.status in ('waiting_delivery', 'receiving', 'quality_approved', 'received', 'received_short', 'received_over')
  )
  and batch.approval_status <> 'approved';

do $$
declare
  v_batch record;
begin
  for v_batch in
    select
      batch.id,
      coalesce(
        batch.approval_decided_by,
        batch.quality_approved_by,
        batch.created_by,
        case
          when po.last_action_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then po.last_action_by::uuid
          else null
        end
      ) as actor_id
    from public.purchase_order_delivery_batches batch
    join public.purchase_orders po on po.id = batch.purchase_order_id
    where po.po_number in ('PO-211', 'PO-259', 'PO-414')
      and batch.approval_status = 'approved'
      and batch.status not in ('cancelled', 'received', 'received_short', 'received_over')
      and (batch.wms_transaction_id is null or batch.qr_token is null)
    order by batch.id
  loop
    if v_batch.actor_id is null then
      raise exception 'Đợt giao % thiếu người duyệt/người tạo để khôi phục WMS.', v_batch.id;
    end if;
    perform app_private.ensure_material_po_batch_wms(v_batch.id, v_batch.actor_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

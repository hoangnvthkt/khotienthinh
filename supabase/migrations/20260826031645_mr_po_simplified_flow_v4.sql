-- Simplified MR purchase-order flow v4.
-- One PO-level QR, at most one approved unfinished batch, and exactly one
-- warehouse receipt per approved batch. Flow v3 contracts remain untouched.

alter table public.purchase_orders
  drop constraint if exists purchase_orders_procurement_flow_version_check;
alter table public.purchase_orders
  add constraint purchase_orders_procurement_flow_version_check
  check (procurement_flow_version in (2, 3, 4));

-- Only upgrade v3 POs that can enter the one-shot model without rewriting
-- receipt history or abandoning an in-progress warehouse workflow.
update public.purchase_orders po
set procurement_flow_version = 4
where po.procurement_flow_version = 3
  and po.source_mode = 'from_request'
  and not exists (
    select 1
    from public.purchase_order_receipts receipt
    where receipt.purchase_order_id = po.id
  )
  and not exists (
    select 1
    from public.purchase_order_delivery_batches batch
    where batch.purchase_order_id = po.id
      and batch.status in ('wms_pending', 'receiving', 'quality_approved')
  )
  and (
    select count(*)
    from public.purchase_order_delivery_batches batch
    where batch.purchase_order_id = po.id
      and batch.approval_status = 'approved'
      and batch.status not in ('received', 'received_short', 'received_over', 'cancelled')
  ) <= 1;

do $$
begin
  if exists (
    select 1
    from public.purchase_orders po
    where po.po_number = 'PO-259'
      and po.procurement_flow_version <> 3
      and (
        select count(*)
        from public.purchase_order_delivery_batches batch
        where batch.purchase_order_id = po.id
          and batch.approval_status = 'approved'
          and batch.status not in ('received', 'received_short', 'received_over', 'cancelled')
      ) >= 2
  ) then
    raise exception 'PO-259 có nhiều đợt đã duyệt và bắt buộc phải giữ flow v3.';
  end if;
end;
$$;

create or replace function app_private.assert_mr_po_flow_v4_actor_v1(
  p_purchase_order_id text,
  p_action text,
  p_actor_user_id uuid
) returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  if p_actor_user_id is null
    or public.current_app_user_id() is null
    or p_actor_user_id <> public.current_app_user_id()
  then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then raise exception 'Không tìm thấy PO.' using errcode = '22023'; end if;
  if v_po.procurement_flow_version <> 4 or v_po.source_mode <> 'from_request' then
    raise exception 'Lệnh này chỉ áp dụng cho PO từ MR dùng flow v4.' using errcode = '22023';
  end if;
  perform app_private.assert_project_permission_room_action(
    v_po.project_id, v_po.construction_site_id, 'material_po', p_action, p_actor_user_id
  );
  return v_po;
end;
$$;

create or replace function app_private.save_purchase_order_delivery_batch_draft_v4(
  p_purchase_order_id text,
  p_delivery_batch_id uuid,
  p_planned_delivery_date date,
  p_vat_rate numeric,
  p_variance_reason text,
  p_note text,
  p_lines jsonb,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_line jsonb;
  v_line_key text;
  v_item_id text;
  v_request_qty numeric;
  v_purchase_qty numeric;
  v_price numeric;
  v_count integer := 0;
  v_delivery_no integer;
begin
  v_po := app_private.assert_mr_po_flow_v4_actor_v1(p_purchase_order_id, 'edit', p_actor_user_id);
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0
  then raise exception 'Đợt đặt hàng phải có ít nhất một dòng.' using errcode = '22023'; end if;
  if coalesce(p_vat_rate, 0) < 0 or coalesce(p_vat_rate, 0) > 100 then
    raise exception 'VAT không hợp lệ.' using errcode = '22023';
  end if;

  if p_delivery_batch_id is null then
    select coalesce(max(delivery_no), 0) + 1 into v_delivery_no
    from public.purchase_order_delivery_batches
    where purchase_order_id = v_po.id;
    insert into public.purchase_order_delivery_batches (
      purchase_order_id, project_id, construction_site_id, supplier_id,
      supplier_name_snapshot, delivery_no, planned_delivery_date, status,
      approval_status, fulfillment_mode, vat_rate, variance_reason, note, created_by
    ) values (
      v_po.id, v_po.project_id, v_po.construction_site_id, v_po.vendor_id,
      v_po.vendor_name, v_delivery_no, p_planned_delivery_date, 'planned',
      'draft', v_po.fulfillment_mode, coalesce(p_vat_rate, 0),
      nullif(trim(coalesce(p_variance_reason, '')), ''),
      nullif(trim(coalesce(p_note, '')), ''), p_actor_user_id
    ) returning * into v_batch;
  else
    select * into v_batch
    from public.purchase_order_delivery_batches
    where id = p_delivery_batch_id and purchase_order_id = v_po.id
    for update;
    if not found then raise exception 'Không tìm thấy đợt đặt hàng.' using errcode = '22023'; end if;
    if coalesce(v_batch.approval_status, 'draft') not in ('draft', 'revision_requested', 'rejected')
      or v_batch.wms_transaction_id is not null
      or exists (select 1 from public.purchase_order_receipts r where r.delivery_batch_id = v_batch.id)
    then raise exception 'Đợt đã gửi duyệt hoặc đã nhận hàng nên không thể sửa.' using errcode = '22023'; end if;
    update public.purchase_order_delivery_batches set
      supplier_id = v_po.vendor_id,
      supplier_name_snapshot = v_po.vendor_name,
      planned_delivery_date = p_planned_delivery_date,
      vat_rate = coalesce(p_vat_rate, 0),
      variance_reason = nullif(trim(coalesce(p_variance_reason, '')), ''),
      note = nullif(trim(coalesce(p_note, '')), ''),
      approval_status = 'draft', approval_decided_by = null,
      approval_decided_at = null, approval_decision_note = null, updated_at = now()
    where id = v_batch.id returning * into v_batch;
    delete from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) line(value)
  loop
    v_line_key := nullif(coalesce(v_line ->> 'purchaseOrderLineId', v_line ->> 'purchase_order_line_id'), '');
    v_item_id := nullif(coalesce(v_line ->> 'itemId', v_line ->> 'item_id'), '');
    v_request_qty := coalesce(nullif(coalesce(v_line ->> 'requestQty', v_line ->> 'stock_planned_qty'), '')::numeric, 0);
    v_purchase_qty := coalesce(nullif(coalesce(v_line ->> 'purchaseQty', v_line ->> 'planned_qty'), '')::numeric, 0);
    v_price := coalesce(nullif(coalesce(v_line ->> 'purchaseUnitPrice', v_line ->> 'delivery_unit_price'), '')::numeric, 0);
    if v_line_key is null or v_item_id is null or v_request_qty <= 0 or v_purchase_qty <= 0 or v_price < 0 then
      raise exception 'Dòng đợt đặt hàng thiếu hoặc sai số lượng/đơn giá.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_po.items) item(value)
      where coalesce(item.value ->> 'lineId', item.value ->> 'itemId') = v_line_key
        and item.value ->> 'itemId' = v_item_id
    ) then raise exception 'Dòng đợt không thuộc PO gốc.' using errcode = '22023'; end if;
    insert into public.purchase_order_delivery_lines (
      delivery_batch_id, purchase_order_id, purchase_order_line_id, item_id,
      planned_qty, unit, stock_planned_qty, stock_unit, delivery_unit_price
    ) values (
      v_batch.id, v_po.id, v_line_key, v_item_id,
      v_purchase_qty, nullif(coalesce(v_line ->> 'purchaseUnit', v_line ->> 'unit'), ''),
      v_request_qty, nullif(coalesce(v_line ->> 'requestUnit', v_line ->> 'stock_unit'), ''), v_price
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'deliveryBatchId', v_batch.id, 'deliveryNo', v_batch.delivery_no,
    'approvalStatus', 'draft', 'lineCount', v_count
  );
end;
$$;

create or replace function public.save_purchase_order_delivery_batch_draft_v4(
  p_purchase_order_id text,
  p_delivery_batch_id uuid default null,
  p_planned_delivery_date date default null,
  p_vat_rate numeric default 0,
  p_variance_reason text default null,
  p_note text default null,
  p_lines jsonb default '[]'::jsonb,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return app_private.save_purchase_order_delivery_batch_draft_v4(
    p_purchase_order_id, p_delivery_batch_id, p_planned_delivery_date, p_vat_rate,
    p_variance_reason, p_note, p_lines, coalesce(p_actor_user_id, public.current_app_user_id())
  );
end;
$$;

create or replace function app_private.delete_purchase_order_delivery_batch_draft_v4(
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
begin
  select purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id;
  if not found then raise exception 'Không tìm thấy đợt đặt hàng.' using errcode = '22023'; end if;
  v_po := app_private.assert_mr_po_flow_v4_actor_v1(v_po_id, 'edit', p_actor_user_id);
  select * into v_batch
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;
  if coalesce(v_batch.approval_status, 'draft') not in ('draft', 'revision_requested', 'rejected')
    or v_batch.wms_transaction_id is not null
    or exists (select 1 from public.purchase_order_receipts receipt where receipt.delivery_batch_id = v_batch.id)
  then raise exception 'Chỉ được xóa đợt nháp chưa nhận hàng.' using errcode = '22023'; end if;
  delete from public.purchase_order_delivery_batches where id = v_batch.id;
  return jsonb_build_object('deliveryBatchId', v_batch.id, 'deleted', true);
end;
$$;

create or replace function public.delete_purchase_order_delivery_batch_draft_v4(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return app_private.delete_purchase_order_delivery_batch_draft_v4(
    p_delivery_batch_id, coalesce(p_actor_user_id, public.current_app_user_id())
  );
end;
$$;

create or replace function app_private.submit_purchase_order_delivery_batch_approval_v4(
  p_delivery_batch_id uuid,
  p_approver_user_id uuid,
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
  v_approver uuid;
  v_approver_name text;
  v_previous_guard text;
begin
  select purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id;
  if not found then raise exception 'Không tìm thấy đợt đặt hàng.' using errcode = '22023'; end if;
  v_po := app_private.assert_mr_po_flow_v4_actor_v1(v_po_id, 'submit', p_actor_user_id);
  select * into v_batch
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;
  if coalesce(v_batch.approval_status, 'draft') not in ('draft', 'revision_requested', 'rejected')
    or v_batch.wms_transaction_id is not null
    or exists (select 1 from public.purchase_order_receipts r where r.delivery_batch_id = v_batch.id)
  then raise exception 'Đợt không còn ở trạng thái có thể gửi duyệt.' using errcode = '22023'; end if;
  if not exists (select 1 from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id) then
    raise exception 'Đợt đặt hàng chưa có dòng vật tư.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.purchase_order_delivery_batches other
    where other.purchase_order_id = v_po.id and other.id <> v_batch.id
      and other.approval_status = 'approved'
      and other.status not in ('received', 'received_short', 'received_over', 'cancelled')
  ) then raise exception 'PO đang có một đợt đã duyệt chờ nhận; chưa thể gửi duyệt đợt tiếp theo.' using errcode = '22023'; end if;

  v_approver := coalesce(nullif(v_po.submitted_to_user_id, '')::uuid, p_approver_user_id);
  if v_approver is null then raise exception 'Phải chọn người duyệt cho đợt đầu tiên.' using errcode = '22023'; end if;
  select name into v_approver_name from public.users
  where id = v_approver and is_active and account_status = 'ACTIVE';
  if not found then raise exception 'Người duyệt không còn hoạt động.' using errcode = '22023'; end if;
  if nullif(v_po.submitted_to_user_id, '') is not null and p_approver_user_id is not null
    and p_approver_user_id::text <> v_po.submitted_to_user_id
  then raise exception 'Các đợt phải kế thừa cùng người duyệt của PO.' using errcode = '22023'; end if;
  if not app_private.project_actor_has_effective_room_action(
    v_approver, v_po.project_id, v_po.construction_site_id, 'material_po', 'approve'
  ) then raise exception 'Người được chọn chưa có quyền duyệt PO tại dự án.' using errcode = '42501'; end if;
  perform app_private.assert_delivery_batch_overage_reason_v2(v_po.id, v_batch.id);

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);
  update public.purchase_orders set
    submitted_to_user_id = v_approver::text, submitted_to_name = v_approver_name,
    submitted_to_permission = 'approve', ever_submitted = true,
    last_action_by = p_actor_user_id::text, last_action_at = now()
  where id = v_po.id;
  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);

  update public.purchase_order_delivery_batches set
    approval_status = 'pending_approval', approval_requested_by = p_actor_user_id,
    approval_requested_at = now(), approval_decided_by = null,
    approval_decided_at = null, approval_decision_note = null, updated_at = now()
  where id = v_batch.id;
  return jsonb_build_object(
    'deliveryBatchId', v_batch.id, 'approvalStatus', 'pending_approval',
    'approverUserId', v_approver, 'approverName', v_approver_name
  );
exception when others then
  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  raise;
end;
$$;

create or replace function public.submit_purchase_order_delivery_batch_approval_v4(
  p_delivery_batch_id uuid,
  p_approver_user_id uuid default null,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return app_private.submit_purchase_order_delivery_batch_approval_v4(
    p_delivery_batch_id, p_approver_user_id,
    coalesce(p_actor_user_id, public.current_app_user_id())
  );
end;
$$;

create or replace function app_private.decide_purchase_order_delivery_batch_approval_v4(
  p_delivery_batch_id uuid,
  p_decision text,
  p_note text,
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
begin
  if p_decision not in ('revision_requested', 'rejected') then
    raise exception 'Quyết định duyệt không hợp lệ.' using errcode = '22023';
  end if;
  select purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id;
  if not found then raise exception 'Không tìm thấy đợt đặt hàng.' using errcode = '22023'; end if;
  v_po := app_private.assert_mr_po_flow_v4_actor_v1(v_po_id, 'approve', p_actor_user_id);
  select * into v_batch
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;
  if v_batch.approval_status <> 'pending_approval' then
    raise exception 'Chỉ xử lý đợt đang chờ duyệt.' using errcode = '22023';
  end if;
  if not public.is_admin() and nullif(v_po.submitted_to_user_id, '')::uuid <> p_actor_user_id then
    raise exception 'Đợt này được giao cho người duyệt khác.' using errcode = '42501';
  end if;
  update public.purchase_order_delivery_batches set
    approval_status = p_decision, approval_decided_by = p_actor_user_id,
    approval_decided_at = now(), approval_decision_note = nullif(trim(coalesce(p_note, '')), ''),
    updated_at = now()
  where id = v_batch.id;
  return jsonb_build_object('deliveryBatchId', v_batch.id, 'approvalStatus', p_decision);
end;
$$;

create or replace function public.decide_purchase_order_delivery_batch_approval_v4(
  p_delivery_batch_id uuid,
  p_decision text,
  p_note text default null,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return app_private.decide_purchase_order_delivery_batch_approval_v4(
    p_delivery_batch_id, p_decision, p_note,
    coalesce(p_actor_user_id, public.current_app_user_id())
  );
end;
$$;

create or replace function app_private.approve_purchase_order_delivery_batch_v4(
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
  v_po_qr_token text;
  v_previous_guard text;
begin
  select purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id;
  if not found then raise exception 'Không tìm thấy đợt đặt hàng.' using errcode = '22023'; end if;
  v_po := app_private.assert_mr_po_flow_v4_actor_v1(v_po_id, 'approve', p_actor_user_id);
  select * into v_batch
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;

  if v_batch.approval_status = 'approved'
    and v_batch.status not in ('received', 'received_short', 'received_over', 'cancelled')
  then
    v_po_qr_token := coalesce(v_po.qr_token, 'po_' || gen_random_uuid()::text);
    if v_po.qr_token is null then update public.purchase_orders set qr_token = v_po_qr_token where id = v_po.id; end if;
    return jsonb_build_object(
      'deliveryBatchId', v_batch.id, 'approvalStatus', 'approved',
      'purchaseOrderQrToken', v_po_qr_token
    );
  end if;
  if v_batch.approval_status <> 'pending_approval' or v_batch.wms_transaction_id is not null then
    raise exception 'Chỉ duyệt đợt đang chờ duyệt và chưa có WMS.' using errcode = '22023';
  end if;
  if not public.is_admin() and nullif(v_po.submitted_to_user_id, '')::uuid <> p_actor_user_id then
    raise exception 'Đợt này được giao cho người duyệt khác.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.purchase_order_delivery_batches other
    where other.purchase_order_id = v_po.id and other.id <> v_batch.id
      and other.approval_status = 'approved'
      and other.status not in ('received', 'received_short', 'received_over', 'cancelled')
    for update
  ) then raise exception 'PO đã có một đợt khác được duyệt chờ nhận.' using errcode = '22023'; end if;
  perform app_private.assert_delivery_batch_overage_reason_v2(v_po.id, v_batch.id);

  v_po_qr_token := coalesce(v_po.qr_token, 'po_' || gen_random_uuid()::text);
  update public.purchase_order_delivery_batches set
    approval_status = 'approved', approval_decided_by = p_actor_user_id,
    approval_decided_at = now(), status = 'waiting_delivery', qr_token = null,
    updated_at = now()
  where id = v_batch.id;
  perform app_private.ensure_mr_fulfillment_for_delivery_batch_v3(v_batch.id, p_actor_user_id);

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);
  update public.purchase_orders set
    qr_token = v_po_qr_token,
    status = case when status in ('draft', 'sent', 'returned') then 'in_transit' else status end,
    ever_submitted = true, last_action_by = p_actor_user_id::text, last_action_at = now()
  where id = v_po.id;
  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);

  return jsonb_build_object(
    'deliveryBatchId', v_batch.id, 'approvalStatus', 'approved',
    'purchaseOrderQrToken', v_po_qr_token
  );
exception when others then
  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  raise;
end;
$$;

create or replace function public.approve_purchase_order_delivery_batch_v4(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return app_private.approve_purchase_order_delivery_batch_v4(
    p_delivery_batch_id, coalesce(p_actor_user_id, public.current_app_user_id())
  );
end;
$$;

create or replace function app_private.record_purchase_order_receipt_v4(
  p_delivery_batch_id uuid,
  p_idempotency_key uuid,
  p_quality_result text,
  p_variance_reason text,
  p_lines jsonb,
  p_attachments jsonb,
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
  v_existing public.purchase_order_receipts%rowtype;
  v_receipt_id uuid := gen_random_uuid();
  v_tx_id text := 'tx-po-receipt-' || replace(gen_random_uuid()::text, '-', '');
  v_line jsonb;
  v_delivery_line public.purchase_order_delivery_lines%rowtype;
  v_delivery_line_id uuid;
  v_item_id text;
  v_delivered_purchase numeric;
  v_accepted_purchase numeric;
  v_delivered_stock numeric;
  v_accepted_stock numeric;
  v_line_reason text;
  v_seen uuid[] := '{}';
  v_expected_count integer;
  v_wms_items jsonb := '[]'::jsonb;
  v_gross numeric := 0;
  v_batch_status text;
  v_total_planned numeric;
  v_total_accepted numeric;
  v_next_items jsonb;
  v_previous_guard text;
  v_material_request_id text;
  v_request_line_id text;
  v_related_request_id text;
  v_has_variance boolean := false;
begin
  if p_idempotency_key is null then raise exception 'Thiếu idempotency key.' using errcode = '22023'; end if;
  if p_quality_result not in ('passed', 'partial', 'rejected') then
    raise exception 'Kết quả SL/CL không hợp lệ.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array'
  then raise exception 'Payload lần nhập không hợp lệ.' using errcode = '22023'; end if;

  select purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id;
  if not found then raise exception 'Không tìm thấy đợt đặt hàng.' using errcode = '22023'; end if;
  v_po := app_private.assert_mr_po_flow_v4_actor_v1(v_po_id, 'confirm', p_actor_user_id);
  select * into v_batch
  from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;

  select * into v_existing
  from public.purchase_order_receipts
  where delivery_batch_id = v_batch.id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'receiptId', v_existing.id, 'deliveryBatchId', v_existing.delivery_batch_id,
      'receiptNo', v_existing.receipt_no, 'wmsTransactionId', v_existing.wms_transaction_id,
      'financeStatus', v_existing.finance_status, 'batchStatus', v_batch.status,
      'idempotentReplay', true
    );
  end if;
  if exists (
    select 1 from public.purchase_order_receipts receipt
    where receipt.delivery_batch_id = v_batch.id
  ) then raise exception 'Đợt V4 đã được nhận một lần; mua bù phải tạo đợt mới.' using errcode = '22023'; end if;
  if v_batch.approval_status <> 'approved'
    or v_batch.status in ('received', 'received_short', 'received_over', 'cancelled')
  then raise exception 'Đợt chưa duyệt hoặc đã kết thúc nhận hàng.' using errcode = '22023'; end if;
  if v_batch.wms_transaction_id is not null then
    raise exception 'Flow v4 không dùng WMS tạo sẵn ở cấp đợt.' using errcode = 'P0001';
  end if;
  if not app_private.current_user_can_receive_purchase_batch_v2(p_actor_user_id, v_po.target_warehouse_id) then
    raise exception 'Không có quyền nhận hàng tại kho này.' using errcode = '42501';
  end if;

  select count(*) into v_expected_count
  from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id;
  if v_expected_count = 0 or jsonb_array_length(p_lines) <> v_expected_count then
    raise exception 'Payload phải khớp 1-1 với dòng đợt đặt hàng.' using errcode = '22023';
  end if;
  perform 1 from public.purchase_order_delivery_lines
  where delivery_batch_id = v_batch.id order by id for update;

  for v_line in select value from jsonb_array_elements(p_lines) line(value)
  loop
    v_delivery_line_id := nullif(coalesce(v_line ->> 'deliveryLineId', v_line ->> 'delivery_line_id'), '')::uuid;
    v_item_id := nullif(coalesce(v_line ->> 'itemId', v_line ->> 'item_id'), '');
    v_delivered_purchase := coalesce(nullif(coalesce(v_line ->> 'deliveredPurchaseQty', v_line ->> 'delivered_purchase_qty'), '')::numeric, 0);
    v_accepted_purchase := coalesce(nullif(coalesce(v_line ->> 'acceptedPurchaseQty', v_line ->> 'accepted_purchase_qty'), '')::numeric, 0);
    v_delivered_stock := coalesce(nullif(coalesce(v_line ->> 'deliveredStockQty', v_line ->> 'delivered_stock_qty'), '')::numeric, 0);
    v_accepted_stock := coalesce(nullif(coalesce(v_line ->> 'acceptedStockQty', v_line ->> 'accepted_stock_qty'), '')::numeric, 0);
    v_line_reason := nullif(trim(coalesce(v_line ->> 'varianceReason', v_line ->> 'variance_reason', '')), '');
    if v_delivery_line_id is null or v_item_id is null or v_delivery_line_id = any(v_seen)
      or v_delivered_purchase < 0 or v_accepted_purchase < 0
      or v_delivered_stock < 0 or v_accepted_stock < 0
      or v_accepted_purchase > v_delivered_purchase or v_accepted_stock > v_delivered_stock
    then raise exception 'Dòng nhận hàng không hợp lệ.' using errcode = '22023'; end if;
    select * into v_delivery_line
    from public.purchase_order_delivery_lines
    where id = v_delivery_line_id and delivery_batch_id = v_batch.id;
    if not found or v_delivery_line.item_id <> v_item_id then
      raise exception 'Dòng nhận hàng không thuộc đợt.' using errcode = '22023';
    end if;

    v_has_variance := abs(v_delivered_purchase - v_delivery_line.planned_qty) > 0.000001
      or abs(v_accepted_purchase - v_delivery_line.planned_qty) > 0.000001
      or abs(v_accepted_stock - v_delivery_line.stock_planned_qty) > 0.000001;
    if v_has_variance
      and v_line_reason is null
      and nullif(trim(coalesce(p_variance_reason, '')), '') is null
    then raise exception 'Dòng giao, đạt hoặc nhập kho lệch số đã duyệt; phải nhập lý do.' using errcode = '22023'; end if;

    v_material_request_id := null;
    v_request_line_id := null;
    select porl.material_request_id, porl.request_line_id
    into v_material_request_id, v_request_line_id
    from public.purchase_order_request_lines porl
    where porl.purchase_order_id = v_po.id
      and porl.purchase_order_line_id = v_delivery_line.purchase_order_line_id
      and porl.allocation_status <> 'cancelled'
    order by porl.created_at
    limit 1;
    if v_related_request_id is null then v_related_request_id := v_material_request_id; end if;
    v_seen := array_append(v_seen, v_delivery_line_id);
    v_gross := v_gross + v_accepted_purchase * v_delivery_line.delivery_unit_price
      * (1 + coalesce(v_batch.vat_rate, 0) / 100);
    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id, 'quantity', v_accepted_stock,
      'orderedQty', v_delivery_line.stock_planned_qty,
      'price', v_delivery_line.delivery_unit_price,
      'accountingQty', v_accepted_purchase, 'accountingUnit', v_delivery_line.unit,
      'accountingPrice', v_delivery_line.delivery_unit_price,
      'purchaseOrderLineId', v_delivery_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', v_batch.id,
      'purchaseOrderDeliveryLineId', v_delivery_line.id,
      'purchaseOrderReceiptId', v_receipt_id,
      'materialRequestId', v_material_request_id, 'requestLineId', v_request_line_id,
      'varianceReason', coalesce(v_line_reason, nullif(trim(coalesce(p_variance_reason, '')), ''))
    ));
  end loop;
  if coalesce(array_length(v_seen, 1), 0) <> v_expected_count then
    raise exception 'Payload nhận hàng thiếu dòng.' using errcode = '22023';
  end if;

  insert into public.transactions (
    id, type, date, items, target_warehouse_id, supplier_id,
    requester_id, created_by, approver_id, status, note,
    related_request_id, business_partner_name_snapshot, source_type, source_id,
    attachments, approved_at
  ) values (
    v_tx_id, 'IMPORT'::public.transaction_type, now(), v_wms_items,
    v_po.target_warehouse_id, v_po.vendor_id,
    p_actor_user_id, p_actor_user_id, p_actor_user_id,
    'COMPLETED'::public.transaction_status,
    coalesce(v_po.po_number, v_po.id) || ' / Đợt ' || v_batch.delivery_no,
    v_related_request_id, v_po.vendor_name, 'po_receipt', v_receipt_id::text,
    coalesce(p_attachments, '[]'::jsonb), now()
  );

  insert into public.purchase_order_receipts (
    id, delivery_batch_id, purchase_order_id, project_id, construction_site_id,
    receipt_no, finance_status, quality_result, is_final, variance_reason,
    attachments, accepted_gross_amount, wms_transaction_id, idempotency_key, received_by
  ) values (
    v_receipt_id, v_batch.id, v_po.id, v_po.project_id, v_po.construction_site_id,
    1, 'ready', p_quality_result, true,
    nullif(trim(coalesce(p_variance_reason, '')), ''), coalesce(p_attachments, '[]'::jsonb),
    round(v_gross, 2), v_tx_id, p_idempotency_key, p_actor_user_id
  );

  for v_line in select value from jsonb_array_elements(p_lines) line(value)
  loop
    v_delivery_line_id := nullif(coalesce(v_line ->> 'deliveryLineId', v_line ->> 'delivery_line_id'), '')::uuid;
    select * into v_delivery_line from public.purchase_order_delivery_lines where id = v_delivery_line_id;
    v_delivered_purchase := coalesce(nullif(coalesce(v_line ->> 'deliveredPurchaseQty', v_line ->> 'delivered_purchase_qty'), '')::numeric, 0);
    v_accepted_purchase := coalesce(nullif(coalesce(v_line ->> 'acceptedPurchaseQty', v_line ->> 'accepted_purchase_qty'), '')::numeric, 0);
    v_delivered_stock := coalesce(nullif(coalesce(v_line ->> 'deliveredStockQty', v_line ->> 'delivered_stock_qty'), '')::numeric, 0);
    v_accepted_stock := coalesce(nullif(coalesce(v_line ->> 'acceptedStockQty', v_line ->> 'accepted_stock_qty'), '')::numeric, 0);
    v_line_reason := nullif(trim(coalesce(v_line ->> 'varianceReason', v_line ->> 'variance_reason', '')), '');
    insert into public.purchase_order_receipt_lines (
      receipt_id, delivery_batch_id, delivery_line_id, purchase_order_id,
      purchase_order_line_id, item_id, purchase_unit, stock_unit,
      delivered_purchase_qty, accepted_purchase_qty, delivered_stock_qty,
      accepted_stock_qty, purchase_unit_price, variance_reason
    ) values (
      v_receipt_id, v_batch.id, v_delivery_line.id, v_po.id,
      v_delivery_line.purchase_order_line_id, v_delivery_line.item_id,
      v_delivery_line.unit, v_delivery_line.stock_unit,
      v_delivered_purchase, v_accepted_purchase, v_delivered_stock,
      v_accepted_stock, v_delivery_line.delivery_unit_price,
      coalesce(v_line_reason, nullif(trim(coalesce(p_variance_reason, '')), ''))
    );
    update public.purchase_order_delivery_lines set
      accepted_qty = v_accepted_purchase, accepted_stock_qty = v_accepted_stock,
      updated_at = now()
    where id = v_delivery_line.id;
    if coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK') = 'RECEIVE_TO_STOCK'
      and v_accepted_stock > 0
    then perform public.apply_stock_change(v_delivery_line.item_id, v_po.target_warehouse_id, v_accepted_stock); end if;
  end loop;

  select sum(planned_qty), sum(accepted_qty)
  into v_total_planned, v_total_accepted
  from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id;
  v_batch_status := case
    when v_total_accepted > v_total_planned + 0.000001 then 'received_over'
    when v_total_accepted < v_total_planned - 0.000001 then 'received_short'
    else 'received'
  end;
  update public.purchase_order_delivery_batches set
    status = v_batch_status, quality_result = p_quality_result,
    variance_reason = coalesce(nullif(trim(coalesce(p_variance_reason, '')), ''), variance_reason),
    received_by = p_actor_user_id, received_at = now(),
    accepted_gross_amount = round(v_gross, 2), updated_at = now()
  where id = v_batch.id;

  with received_by_line as (
    select delivery_line.purchase_order_line_id, sum(receipt_line.accepted_stock_qty) as qty
    from public.purchase_order_receipt_lines receipt_line
    join public.purchase_order_delivery_lines delivery_line on delivery_line.id = receipt_line.delivery_line_id
    where receipt_line.receipt_id = v_receipt_id
    group by delivery_line.purchase_order_line_id
  ), item_rows as (
    select item.value, item.ordinality,
      coalesce(item.value ->> 'lineId', item.value ->> 'itemId') as line_key
    from jsonb_array_elements(v_po.items) with ordinality item(value, ordinality)
  )
  select jsonb_agg(
    case when received.qty is null then item_rows.value else jsonb_set(
      item_rows.value, '{receivedQty}', to_jsonb(
        coalesce(nullif(item_rows.value ->> 'receivedQty', '')::numeric, 0) + received.qty
      ), true
    ) end order by item_rows.ordinality
  ) into v_next_items
  from item_rows left join received_by_line received on received.purchase_order_line_id = item_rows.line_key;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);
  update public.purchase_orders set
    items = coalesce(v_next_items, items), status = 'partial',
    received_transaction_ids = coalesce(received_transaction_ids, '[]'::jsonb) || jsonb_build_array(v_tx_id)
  where id = v_po.id;
  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);

  update public.material_request_fulfillment_lines mfl set
    received_qty = receipt_line.accepted_stock_qty
      * case when allocation.total_committed > 0
        then mfl.committed_qty_snapshot / allocation.total_committed else 1 end,
    variance_reason = coalesce(receipt_line.variance_reason, mfl.variance_reason), updated_at = now()
  from public.purchase_order_receipt_lines receipt_line
  join lateral (
    select coalesce(sum(peer.committed_qty_snapshot), 0) total_committed
    from public.material_request_fulfillment_lines peer
    where peer.po_delivery_line_id = receipt_line.delivery_line_id
  ) allocation on true
  where receipt_line.receipt_id = v_receipt_id
    and mfl.po_delivery_line_id = receipt_line.delivery_line_id;
  update public.purchase_order_request_lines porl set
    actual_received_qty_snapshot = coalesce(summary.received_qty, 0)
  from (
    select line.purchase_order_request_line_id, sum(line.received_qty) received_qty
    from public.material_request_fulfillment_lines line
    where line.purchase_order_request_line_id is not null
    group by line.purchase_order_request_line_id
  ) summary
  where porl.id = summary.purchase_order_request_line_id and porl.purchase_order_id = v_po.id;
  update public.material_request_fulfillment_batches set
    status = 'received', received_by = p_actor_user_id, received_at = now(), updated_at = now()
  where po_delivery_batch_id = v_batch.id and status = 'issued';

  return jsonb_build_object(
    'receiptId', v_receipt_id, 'deliveryBatchId', v_batch.id,
    'receiptNo', 1, 'wmsTransactionId', v_tx_id,
    'financeStatus', 'ready', 'batchStatus', v_batch_status,
    'idempotentReplay', false
  );
exception when others then
  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  raise;
end;
$$;

create or replace function public.record_purchase_order_receipt_v4(
  p_delivery_batch_id uuid,
  p_idempotency_key uuid,
  p_quality_result text default 'passed',
  p_variance_reason text default null,
  p_lines jsonb default '[]'::jsonb,
  p_attachments jsonb default '[]'::jsonb,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return app_private.record_purchase_order_receipt_v4(
    p_delivery_batch_id, p_idempotency_key, p_quality_result,
    p_variance_reason, p_lines, p_attachments,
    coalesce(p_actor_user_id, public.current_app_user_id())
  );
end;
$$;

revoke all on function app_private.assert_mr_po_flow_v4_actor_v1(text, text, uuid) from public, anon, authenticated;
revoke all on function app_private.save_purchase_order_delivery_batch_draft_v4(text, uuid, date, numeric, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function app_private.delete_purchase_order_delivery_batch_draft_v4(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.submit_purchase_order_delivery_batch_approval_v4(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.decide_purchase_order_delivery_batch_approval_v4(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function app_private.approve_purchase_order_delivery_batch_v4(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.record_purchase_order_receipt_v4(uuid, uuid, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;

grant execute on function app_private.assert_mr_po_flow_v4_actor_v1(text, text, uuid) to authenticated;
grant execute on function app_private.save_purchase_order_delivery_batch_draft_v4(text, uuid, date, numeric, text, text, jsonb, uuid) to authenticated;
grant execute on function app_private.delete_purchase_order_delivery_batch_draft_v4(uuid, uuid) to authenticated;
grant execute on function app_private.submit_purchase_order_delivery_batch_approval_v4(uuid, uuid, uuid) to authenticated;
grant execute on function app_private.decide_purchase_order_delivery_batch_approval_v4(uuid, text, text, uuid) to authenticated;
grant execute on function app_private.approve_purchase_order_delivery_batch_v4(uuid, uuid) to authenticated;
grant execute on function app_private.record_purchase_order_receipt_v4(uuid, uuid, text, text, jsonb, jsonb, uuid) to authenticated;

revoke all on function public.save_purchase_order_delivery_batch_draft_v4(text, uuid, date, numeric, text, text, jsonb, uuid) from public, anon;
revoke all on function public.delete_purchase_order_delivery_batch_draft_v4(uuid, uuid) from public, anon;
revoke all on function public.submit_purchase_order_delivery_batch_approval_v4(uuid, uuid, uuid) from public, anon;
revoke all on function public.decide_purchase_order_delivery_batch_approval_v4(uuid, text, text, uuid) from public, anon;
revoke all on function public.approve_purchase_order_delivery_batch_v4(uuid, uuid) from public, anon;
revoke all on function public.record_purchase_order_receipt_v4(uuid, uuid, text, text, jsonb, jsonb, uuid) from public, anon;

grant execute on function public.save_purchase_order_delivery_batch_draft_v4(text, uuid, date, numeric, text, text, jsonb, uuid) to authenticated;
grant execute on function public.delete_purchase_order_delivery_batch_draft_v4(uuid, uuid) to authenticated;
grant execute on function public.submit_purchase_order_delivery_batch_approval_v4(uuid, uuid, uuid) to authenticated;
grant execute on function public.decide_purchase_order_delivery_batch_approval_v4(uuid, text, text, uuid) to authenticated;
grant execute on function public.approve_purchase_order_delivery_batch_v4(uuid, uuid) to authenticated;
grant execute on function public.record_purchase_order_receipt_v4(uuid, uuid, text, text, jsonb, jsonb, uuid) to authenticated;

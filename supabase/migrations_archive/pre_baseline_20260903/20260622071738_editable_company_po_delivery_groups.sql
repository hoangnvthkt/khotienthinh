-- Allow PO creators/admins to edit a company delivery group before stock receipt.
-- Quantities and prices are kept in sync with the pending WMS transaction atomically.

create or replace function app_private.project_po_update_transaction_delivery_item_v1(
  p_item jsonb,
  p_batch_id uuid,
  p_request_line_id text,
  p_item_id text,
  p_issued_qty numeric,
  p_unit_price numeric
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb := p_item;
  v_old_qty numeric := coalesce(nullif(p_item ->> 'quantity', '')::numeric, 0);
  v_old_accounting_qty numeric := coalesce(nullif(p_item ->> 'accountingQty', '')::numeric, 0);
  v_factor numeric := 1;
begin
  if coalesce(p_item ->> 'fulfillmentBatchId', p_item ->> 'fulfillment_batch_id', '') <> p_batch_id::text
     or coalesce(p_item ->> 'requestLineId', p_item ->> 'request_line_id', '') <> p_request_line_id
     or coalesce(p_item ->> 'itemId', p_item ->> 'item_id', '') <> p_item_id then
    return p_item;
  end if;

  if v_old_qty > 0 and v_old_accounting_qty > 0 then
    v_factor := v_old_qty / v_old_accounting_qty;
  end if;

  v_result := jsonb_set(v_result, '{quantity}', to_jsonb(p_issued_qty), true);
  v_result := jsonb_set(v_result, '{price}', to_jsonb(p_unit_price), true);

  if p_item ? 'accountingQty' then
    v_result := jsonb_set(
      v_result,
      '{accountingQty}',
      to_jsonb(round(p_issued_qty / nullif(v_factor, 0), 6)),
      true
    );
  end if;

  if p_item ? 'accountingPrice' then
    v_result := jsonb_set(
      v_result,
      '{accountingPrice}',
      to_jsonb(round(p_unit_price * v_factor, 6)),
      true
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.update_purchase_order_delivery_group_v1(
  p_delivery_group_id uuid,
  p_planned_date timestamptz,
  p_note text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.purchase_order_delivery_groups%rowtype;
  v_po public.purchase_orders%rowtype;
  v_line_row public.material_request_fulfillment_lines%rowtype;
  v_batch_row public.material_request_fulfillment_batches%rowtype;
  v_payload jsonb;
  v_payload_count integer := 0;
  v_line_count integer := 0;
  v_issued_qty numeric;
  v_unit_price numeric;
begin
  if p_planned_date is null then
    raise exception 'Ngày giao dự kiến không được để trống.';
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách vật tư của đợt giao không hợp lệ.';
  end if;

  select *
    into v_delivery
  from public.purchase_order_delivery_groups delivery_group
  where delivery_group.id = p_delivery_group_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt giao cần sửa.';
  end if;

  select *
    into v_po
  from public.purchase_orders purchase_order
  where purchase_order.id = v_delivery.purchase_order_id
  for update;

  if not found then
    raise exception 'Không tìm thấy PO của đợt giao.';
  end if;

  if not (
    public.is_admin()
    or nullif(v_po.created_by_id, '') = public.current_app_user_id()::text
  ) then
    raise exception 'Chỉ Admin hoặc người tạo PO được sửa đợt giao này.'
      using errcode = '42501';
  end if;

  if lower(coalesce(v_delivery.status, '')) not in ('draft', 'issued') then
    raise exception 'Chỉ sửa được đợt giao chưa nhập kho và chưa bị huỷ/từ chối.';
  end if;

  perform 1
  from public.material_request_fulfillment_batches batch
  where batch.po_delivery_group_id = p_delivery_group_id
  for update;

  perform 1
  from public.transactions transaction_row
  where transaction_row.id::text in (
    select batch.transaction_id::text
    from public.material_request_fulfillment_batches batch
    where batch.po_delivery_group_id = p_delivery_group_id
      and batch.transaction_id is not null
  )
  for update;

  if exists (
    select 1
    from public.material_request_fulfillment_batches batch
    where batch.po_delivery_group_id = p_delivery_group_id
      and lower(coalesce(batch.status::text, '')) not in ('draft', 'issued')
  ) then
    raise exception 'Đợt giao đã được kho xử lý hoặc đã bị từ chối, không thể sửa.';
  end if;

  if exists (
    select 1
    from public.material_request_fulfillment_batches batch
    join public.transactions transaction_row
      on transaction_row.id::text = batch.transaction_id::text
    where batch.po_delivery_group_id = p_delivery_group_id
      and transaction_row.status <> 'PENDING'::public.transaction_status
  ) then
    raise exception 'Phiếu kho của đợt giao đã được xử lý, không thể sửa.';
  end if;

  if exists (
    select 1
    from public.material_request_fulfillment_lines line
    join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
    where batch.po_delivery_group_id = p_delivery_group_id
      and coalesce(line.received_qty, 0) > 0
  ) then
    raise exception 'Đợt giao đã phát sinh thực nhận, không thể sửa.';
  end if;

  if to_regclass('public.inventory_ledger_entries') is not null
     and exists (
       select 1
       from public.inventory_ledger_entries entry
       where entry.source_type = 'wms_transaction'
         and entry.source_id in (
           select batch.transaction_id::text
           from public.material_request_fulfillment_batches batch
           where batch.po_delivery_group_id = p_delivery_group_id
             and batch.transaction_id is not null
         )
     ) then
    raise exception 'Đợt giao đã phát sinh ledger kho, không thể sửa.';
  end if;

  select count(*)
    into v_line_count
  from public.material_request_fulfillment_lines line
  join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
  where batch.po_delivery_group_id = p_delivery_group_id;

  select count(*)
    into v_payload_count
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb));

  if v_payload_count <> v_line_count then
    raise exception 'Không được thêm hoặc xoá dòng vật tư khi sửa đợt giao.';
  end if;

  if (
    select count(distinct value ->> 'id')
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) payload(value)
  ) <> v_payload_count then
    raise exception 'Danh sách vật tư có dòng bị trùng.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) payload(value)
    left join public.material_request_fulfillment_lines line
      on line.id::text = payload.value ->> 'id'
    left join public.material_request_fulfillment_batches batch
      on batch.id = line.batch_id
     and batch.po_delivery_group_id = p_delivery_group_id
    where line.id is null or batch.id is null
  ) then
    raise exception 'Có dòng vật tư không thuộc đợt giao này.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) payload(value)
    where coalesce(payload.value ->> 'issuedQty', '') !~ '^\s*[0-9]+([.][0-9]+)?\s*$'
       or coalesce(payload.value ->> 'deliveryUnitPrice', '') !~ '^\s*[0-9]+([.][0-9]+)?\s*$'
       or (payload.value ->> 'issuedQty')::numeric <= 0
       or (payload.value ->> 'deliveryUnitPrice')::numeric < 0
  ) then
    raise exception 'Số lượng phải lớn hơn 0 và đơn giá không được âm.';
  end if;

  update public.purchase_order_delivery_groups delivery_group
  set planned_date = p_planned_date,
      note = nullif(trim(coalesce(p_note, '')), '')
  where delivery_group.id = p_delivery_group_id;

  for v_payload in
    select value
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) payload(value)
  loop
    v_issued_qty := (v_payload ->> 'issuedQty')::numeric;
    v_unit_price := (v_payload ->> 'deliveryUnitPrice')::numeric;

    select line.*
      into v_line_row
    from public.material_request_fulfillment_lines line
    join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
    where line.id::text = v_payload ->> 'id'
      and batch.po_delivery_group_id = p_delivery_group_id
    for update of line;

    select *
      into v_batch_row
    from public.material_request_fulfillment_batches batch
    where batch.id = v_line_row.batch_id;

    if v_batch_row.transaction_id is not null and not exists (
      select 1
      from public.transactions transaction_row,
           jsonb_array_elements(coalesce(transaction_row.items, '[]'::jsonb)) transaction_item(value)
      where transaction_row.id::text = v_batch_row.transaction_id::text
        and coalesce(transaction_item.value ->> 'fulfillmentBatchId', transaction_item.value ->> 'fulfillment_batch_id', '') = v_batch_row.id::text
        and coalesce(transaction_item.value ->> 'requestLineId', transaction_item.value ->> 'request_line_id', '') = v_line_row.request_line_id
        and coalesce(transaction_item.value ->> 'itemId', transaction_item.value ->> 'item_id', '') = v_line_row.item_id
    ) then
      raise exception 'Không đồng bộ được dòng vật tư với phiếu kho liên quan.';
    end if;

    update public.material_request_fulfillment_lines line
    set issued_qty = v_issued_qty,
        committed_qty_snapshot = greatest(coalesce(line.committed_qty_snapshot, 0), v_issued_qty),
        delivery_unit_price = v_unit_price
    where line.id = v_line_row.id;

    if v_batch_row.transaction_id is not null then
      update public.transactions transaction_row
      set items = (
        select coalesce(
          jsonb_agg(
            app_private.project_po_update_transaction_delivery_item_v1(
              transaction_item.value,
              v_batch_row.id,
              v_line_row.request_line_id,
              v_line_row.item_id,
              v_issued_qty,
              v_unit_price
            )
            order by transaction_item.ordinality
          ),
          '[]'::jsonb
        )
        from jsonb_array_elements(coalesce(transaction_row.items, '[]'::jsonb))
          with ordinality as transaction_item(value, ordinality)
      )
      where transaction_row.id::text = v_batch_row.transaction_id::text;
    end if;
  end loop;

  return jsonb_build_object(
    'id', v_delivery.id,
    'purchaseOrderId', v_delivery.purchase_order_id,
    'deliveryNo', v_delivery.delivery_no,
    'lineCount', v_line_count,
    'updatedAt', now()
  );
end;
$$;

revoke all on function app_private.project_po_update_transaction_delivery_item_v1(jsonb, uuid, text, text, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.update_purchase_order_delivery_group_v1(uuid, timestamptz, text, jsonb)
  from public, anon;
grant execute on function public.update_purchase_order_delivery_group_v1(uuid, timestamptz, text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';

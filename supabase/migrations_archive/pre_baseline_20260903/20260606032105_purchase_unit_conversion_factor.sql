alter table if exists public.items
  add column if not exists purchase_conversion_factor numeric default 1;

update public.items
set purchase_conversion_factor = 1
where purchase_conversion_factor is null
   or purchase_conversion_factor <= 0;

alter table if exists public.items
  alter column purchase_conversion_factor set not null;

alter table if exists public.items
  drop constraint if exists items_purchase_conversion_factor_positive;

alter table if exists public.items
  add constraint items_purchase_conversion_factor_positive
  check (purchase_conversion_factor > 0);

create or replace function public.create_purchase_order_supplier_return(
  p_purchase_order_id text,
  p_source_warehouse_id text,
  p_lines jsonb,
  p_reason text,
  p_note text default null
)
returns public.purchase_order_supplier_returns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po public.purchase_orders%rowtype;
  v_return public.purchase_order_supplier_returns%rowtype;
  v_return_id uuid := gen_random_uuid();
  v_transaction_id text := 'tx-supplier-return-' || replace(gen_random_uuid()::text, '-', '');
  v_return_no text;
  v_line jsonb;
  v_po_item jsonb;
  v_po_line_id text;
  v_item_id text;
  v_qty numeric;
  v_stock_qty numeric;
  v_received_qty numeric;
  v_returned_qty numeric;
  v_on_hand numeric;
  v_reserved numeric;
  v_purchase_unit text;
  v_stock_unit text;
  v_conversion_factor numeric;
  v_purchase_unit_price numeric;
  v_stock_unit_price numeric;
  v_is_converted boolean;
  v_transaction_items jsonb := '[]'::jsonb;
  v_return_line_rows jsonb := '[]'::jsonb;
  v_item_total record;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not (
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
  ) then
    raise exception 'Chỉ Admin, quản trị WMS hoặc thủ kho tổng được tạo phiếu trả hàng NCC.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Bắt buộc nhập lý do trả hàng NCC.';
  end if;
  if coalesce(p_source_warehouse_id, '') = '' then
    raise exception 'Chưa chọn kho xuất trả NCC.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Phiếu trả NCC chưa có dòng vật tư.';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;
  if not found then raise exception 'Không tìm thấy PO cần trả hàng.'; end if;
  if lower(coalesce(v_po.status::text, '')) not in ('partial', 'delivered', 'closed') then
    raise exception 'Chỉ trả NCC cho PO đã phát sinh nhận hàng và đang ở trạng thái giao một phần, hoàn thành hoặc đã đóng.';
  end if;
  if not exists (select 1 from public.warehouses w where w.id = p_source_warehouse_id) then
    raise exception 'Kho xuất trả NCC không tồn tại.';
  end if;

  v_return_no := 'SR-' || regexp_replace(coalesce(v_po.po_number, 'PO'), '[^A-Za-z0-9]+', '-', 'g')
    || '-' || upper(substr(replace(v_return_id::text, '-', ''), 1, 6));

  for v_line in
    select value from jsonb_array_elements(p_lines)
  loop
    v_po_line_id := coalesce(v_line ->> 'purchaseOrderLineId', v_line ->> 'poLineId', v_line ->> 'lineId');
    v_qty := coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0);
    if coalesce(v_po_line_id, '') = '' or v_qty <= 0 then
      raise exception 'Dòng trả NCC không hợp lệ.';
    end if;

    select item.value into v_po_item
    from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) item(value)
    where coalesce(item.value ->> 'lineId', item.value ->> 'itemId') = v_po_line_id
    limit 1;
    if v_po_item is null then raise exception 'Dòng PO không tồn tại: %', v_po_line_id; end if;

    v_item_id := v_po_item ->> 'itemId';
    v_received_qty := coalesce(nullif(v_po_item ->> 'receivedQty', '')::numeric, 0);
    v_purchase_unit_price := coalesce(nullif(v_po_item ->> 'unitPrice', '')::numeric, 0);

    select coalesce(sum(line.return_qty), 0)
    into v_returned_qty
    from public.purchase_order_supplier_return_lines line
    join public.purchase_order_supplier_returns r on r.id = line.supplier_return_id
    where r.purchase_order_id = p_purchase_order_id
      and line.purchase_order_line_id = v_po_line_id
      and r.status in ('pending', 'completed');

    if v_qty > greatest(0, v_received_qty - v_returned_qty) then
      raise exception 'Số lượng trả của dòng % vượt khối lượng đã nhận còn có thể trả. Đã nhận %, đã/đang trả %, yêu cầu trả %.',
        v_po_line_id, v_received_qty, v_returned_qty, v_qty;
    end if;

    select
      coalesce((coalesce(i.stock_by_warehouse, '{}'::jsonb) ->> p_source_warehouse_id)::numeric, 0),
      coalesce(nullif(v_po_item ->> 'stockUnitSnapshot', ''), nullif(v_po_item ->> 'unitSnapshot', ''), i.unit, nullif(v_po_item ->> 'unit', '')),
      coalesce(nullif(v_po_item ->> 'purchaseUnitSnapshot', ''), nullif(v_po_item ->> 'unit', ''), i.purchase_unit, i.unit),
      coalesce(nullif(v_po_item ->> 'purchaseConversionFactor', '')::numeric, i.purchase_conversion_factor, 1)
    into v_on_hand, v_stock_unit, v_purchase_unit, v_conversion_factor
    from public.items i
    where i.id = v_item_id;
    if not found then raise exception 'Không tìm thấy vật tư: %', v_item_id; end if;

    v_conversion_factor := case when coalesce(v_conversion_factor, 0) > 0 then v_conversion_factor else 1 end;
    v_is_converted := coalesce(trim(v_stock_unit), '') <> ''
      and coalesce(trim(v_purchase_unit), '') <> ''
      and lower(trim(v_stock_unit)) <> lower(trim(v_purchase_unit));
    v_stock_qty := case when v_is_converted then v_qty * v_conversion_factor else v_qty end;
    v_stock_unit_price := case when v_is_converted then v_purchase_unit_price / v_conversion_factor else v_purchase_unit_price end;

    select coalesce(sum(coalesce(nullif(item.value ->> 'quantity', '')::numeric, 0)), 0)
    into v_reserved
    from public.transactions t
    cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) item(value)
    where t.source_warehouse_id = p_source_warehouse_id
      and t.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
      and t.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type)
      and item.value ->> 'itemId' = v_item_id;

    if v_stock_qty > greatest(0, v_on_hand - v_reserved) then
      raise exception 'Kho xuất trả không đủ tồn khả dụng cho vật tư %. Tồn %, đang giữ %, khả dụng %, cần trả %.',
        coalesce(v_po_item ->> 'name', v_item_id), v_on_hand, v_reserved, greatest(0, v_on_hand - v_reserved), v_stock_qty;
    end if;

    v_transaction_items := v_transaction_items || jsonb_build_array(
      jsonb_build_object(
        'itemId', v_item_id,
        'quantity', v_stock_qty,
        'price', v_stock_unit_price,
        'supplierReturnId', v_return_id::text,
        'purchaseOrderId', p_purchase_order_id,
        'purchaseOrderLineId', v_po_line_id
      )
      || case when v_is_converted then jsonb_build_object(
        'accountingQty', v_qty,
        'accountingUnit', v_purchase_unit,
        'accountingPrice', v_purchase_unit_price
      ) else '{}'::jsonb end
    );

    v_return_line_rows := v_return_line_rows || jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_po_line_id,
      'itemId', v_item_id,
      'receivedQtySnapshot', v_received_qty,
      'previouslyReturnedQtySnapshot', v_returned_qty,
      'returnQty', v_qty,
      'unit', v_purchase_unit,
      'unitPrice', v_purchase_unit_price
    ));
  end loop;

  for v_item_total in
    select
      item.value ->> 'itemId' as item_id,
      sum(coalesce(nullif(item.value ->> 'quantity', '')::numeric, 0)) as quantity
    from jsonb_array_elements(v_transaction_items) item(value)
    group by item.value ->> 'itemId'
  loop
    select coalesce((coalesce(i.stock_by_warehouse, '{}'::jsonb) ->> p_source_warehouse_id)::numeric, 0)
    into v_on_hand
    from public.items i
    where i.id = v_item_total.item_id
    for update;

    select coalesce(sum(coalesce(nullif(item.value ->> 'quantity', '')::numeric, 0)), 0)
    into v_reserved
    from public.transactions t
    cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) item(value)
    where t.source_warehouse_id = p_source_warehouse_id
      and t.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
      and t.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type)
      and item.value ->> 'itemId' = v_item_total.item_id;

    if v_item_total.quantity > greatest(0, v_on_hand - v_reserved) then
      raise exception 'Tổng số lượng trả NCC vượt tồn khả dụng của vật tư %. Tồn %, đang giữ %, khả dụng %, cần trả %.',
        v_item_total.item_id, v_on_hand, v_reserved, greatest(0, v_on_hand - v_reserved), v_item_total.quantity;
    end if;
  end loop;

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, requester_id,
    status, note
  ) values (
    v_transaction_id,
    'EXPORT'::public.transaction_type,
    now(),
    v_transaction_items,
    p_source_warehouse_id,
    v_actor,
    'PENDING'::public.transaction_status,
    'Trả hàng NCC ' || v_return_no || ' theo PO ' || coalesce(v_po.po_number, p_purchase_order_id)
      || case when coalesce(v_po.vendor_name, '') <> '' then ' - ' || v_po.vendor_name else '' end
  );

  insert into public.purchase_order_supplier_returns(
    id, return_no, purchase_order_id, project_id, construction_site_id,
    vendor_id, source_warehouse_id, status, transaction_id,
    reason, note, created_by
  ) values (
    v_return_id, v_return_no, v_po.id, v_po.project_id, v_po.construction_site_id,
    v_po.vendor_id, p_source_warehouse_id, 'pending', v_transaction_id,
    trim(p_reason), nullif(trim(coalesce(p_note, '')), ''), v_actor
  )
  returning * into v_return;

  insert into public.purchase_order_supplier_return_lines(
    supplier_return_id, purchase_order_line_id, item_id,
    received_qty_snapshot, previously_returned_qty_snapshot,
    return_qty, unit, unit_price
  )
  select
    v_return_id,
    line.value ->> 'purchaseOrderLineId',
    line.value ->> 'itemId',
    coalesce(nullif(line.value ->> 'receivedQtySnapshot', '')::numeric, 0),
    coalesce(nullif(line.value ->> 'previouslyReturnedQtySnapshot', '')::numeric, 0),
    coalesce(nullif(line.value ->> 'returnQty', '')::numeric, 0),
    nullif(line.value ->> 'unit', ''),
    coalesce(nullif(line.value ->> 'unitPrice', '')::numeric, 0)
  from jsonb_array_elements(v_return_line_rows) line(value);

  return v_return;
end;
$$;

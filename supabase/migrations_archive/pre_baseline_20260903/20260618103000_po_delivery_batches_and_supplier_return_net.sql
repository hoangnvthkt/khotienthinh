-- PO delivery schedule v1 + supplier return net quantities.
-- One PO can have many planned delivery batches. Each batch may create its own
-- WMS receipt transaction while the original PO receipt history remains gross.

create schema if not exists app_private;

create table if not exists public.purchase_order_delivery_batches (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id text not null references public.purchase_orders(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  delivery_no integer not null default 1 check (delivery_no > 0),
  planned_delivery_date date,
  status text not null default 'planned'
    check (status in ('planned', 'wms_pending', 'received', 'cancelled')),
  fulfillment_batch_ids text[] not null default '{}',
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(purchase_order_id, delivery_no)
);

create table if not exists public.purchase_order_delivery_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_batch_id uuid not null references public.purchase_order_delivery_batches(id) on delete cascade,
  purchase_order_id text not null references public.purchase_orders(id) on delete cascade,
  purchase_order_line_id text not null,
  item_id text not null references public.items(id) on delete restrict,
  planned_qty numeric not null check (planned_qty > 0),
  unit text,
  stock_planned_qty numeric not null default 0 check (stock_planned_qty >= 0),
  stock_unit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(delivery_batch_id, purchase_order_line_id)
);

alter table if exists public.material_request_fulfillment_batches
  add column if not exists po_delivery_batch_id uuid references public.purchase_order_delivery_batches(id) on delete set null;

alter table if exists public.material_request_fulfillment_lines
  add column if not exists po_delivery_line_id uuid references public.purchase_order_delivery_lines(id) on delete set null;

alter table if exists public.purchase_order_supplier_return_lines
  add column if not exists stock_return_qty numeric not null default 0 check (stock_return_qty >= 0),
  add column if not exists stock_unit text;

create index if not exists idx_po_delivery_batches_po_no
  on public.purchase_order_delivery_batches(purchase_order_id, delivery_no);

create index if not exists idx_po_delivery_batches_project_date
  on public.purchase_order_delivery_batches(project_id, planned_delivery_date, delivery_no)
  where project_id is not null;

create index if not exists idx_po_delivery_batches_site_date
  on public.purchase_order_delivery_batches(construction_site_id, planned_delivery_date, delivery_no)
  where construction_site_id is not null;

create index if not exists idx_po_delivery_lines_batch
  on public.purchase_order_delivery_lines(delivery_batch_id);

create index if not exists idx_po_delivery_lines_po_line
  on public.purchase_order_delivery_lines(purchase_order_id, purchase_order_line_id);

create index if not exists idx_mrf_batches_po_delivery_batch
  on public.material_request_fulfillment_batches(po_delivery_batch_id)
  where po_delivery_batch_id is not null;

create index if not exists idx_mrf_lines_po_delivery_line
  on public.material_request_fulfillment_lines(po_delivery_line_id)
  where po_delivery_line_id is not null;

create or replace function app_private.set_po_delivery_batch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_private.set_po_delivery_line_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_po_delivery_batches_updated_at on public.purchase_order_delivery_batches;
create trigger trg_po_delivery_batches_updated_at
before update on public.purchase_order_delivery_batches
for each row execute function app_private.set_po_delivery_batch_updated_at();

drop trigger if exists trg_po_delivery_lines_updated_at on public.purchase_order_delivery_lines;
create trigger trg_po_delivery_lines_updated_at
before update on public.purchase_order_delivery_lines
for each row execute function app_private.set_po_delivery_line_updated_at();

create or replace function app_private.purchase_order_delivery_can_view(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          or app_private.project_doc_can_view(
            po.project_id::text,
            po.construction_site_id::text,
            po.submitted_to_user_id
          )
        )
    );
$$;

create or replace function app_private.purchase_order_delivery_can_mutate(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          or app_private.project_doc_can_view(
            po.project_id::text,
            po.construction_site_id::text,
            po.submitted_to_user_id
          )
        )
    );
$$;

alter table public.purchase_order_delivery_batches enable row level security;
alter table public.purchase_order_delivery_lines enable row level security;

drop policy if exists po_delivery_batches_select on public.purchase_order_delivery_batches;
create policy po_delivery_batches_select
on public.purchase_order_delivery_batches
for select to authenticated
using (app_private.purchase_order_delivery_can_view(purchase_order_id));

drop policy if exists po_delivery_batches_insert on public.purchase_order_delivery_batches;
create policy po_delivery_batches_insert
on public.purchase_order_delivery_batches
for insert to authenticated
with check (app_private.purchase_order_delivery_can_mutate(purchase_order_id));

drop policy if exists po_delivery_batches_update on public.purchase_order_delivery_batches;
create policy po_delivery_batches_update
on public.purchase_order_delivery_batches
for update to authenticated
using (app_private.purchase_order_delivery_can_mutate(purchase_order_id))
with check (app_private.purchase_order_delivery_can_mutate(purchase_order_id));

drop policy if exists po_delivery_batches_delete on public.purchase_order_delivery_batches;
create policy po_delivery_batches_delete
on public.purchase_order_delivery_batches
for delete to authenticated
using (app_private.purchase_order_delivery_can_mutate(purchase_order_id));

drop policy if exists po_delivery_lines_select on public.purchase_order_delivery_lines;
create policy po_delivery_lines_select
on public.purchase_order_delivery_lines
for select to authenticated
using (app_private.purchase_order_delivery_can_view(purchase_order_id));

drop policy if exists po_delivery_lines_insert on public.purchase_order_delivery_lines;
create policy po_delivery_lines_insert
on public.purchase_order_delivery_lines
for insert to authenticated
with check (app_private.purchase_order_delivery_can_mutate(purchase_order_id));

drop policy if exists po_delivery_lines_update on public.purchase_order_delivery_lines;
create policy po_delivery_lines_update
on public.purchase_order_delivery_lines
for update to authenticated
using (app_private.purchase_order_delivery_can_mutate(purchase_order_id))
with check (app_private.purchase_order_delivery_can_mutate(purchase_order_id));

drop policy if exists po_delivery_lines_delete on public.purchase_order_delivery_lines;
create policy po_delivery_lines_delete
on public.purchase_order_delivery_lines
for delete to authenticated
using (app_private.purchase_order_delivery_can_mutate(purchase_order_id));

revoke all on table public.purchase_order_delivery_batches from anon;
revoke all on table public.purchase_order_delivery_batches from public;
revoke all on table public.purchase_order_delivery_batches from authenticated;
grant select, insert, update, delete on table public.purchase_order_delivery_batches to authenticated;

revoke all on table public.purchase_order_delivery_lines from anon;
revoke all on table public.purchase_order_delivery_lines from public;
revoke all on table public.purchase_order_delivery_lines from authenticated;
grant select, insert, update, delete on table public.purchase_order_delivery_lines to authenticated;

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
      'unitPrice', v_purchase_unit_price,
      'stockReturnQty', v_stock_qty,
      'stockUnit', v_stock_unit
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
    return_qty, unit, unit_price, stock_return_qty, stock_unit
  )
  select
    v_return_id,
    line.value ->> 'purchaseOrderLineId',
    line.value ->> 'itemId',
    coalesce(nullif(line.value ->> 'receivedQtySnapshot', '')::numeric, 0),
    coalesce(nullif(line.value ->> 'previouslyReturnedQtySnapshot', '')::numeric, 0),
    coalesce(nullif(line.value ->> 'returnQty', '')::numeric, 0),
    nullif(line.value ->> 'unit', ''),
    coalesce(nullif(line.value ->> 'unitPrice', '')::numeric, 0),
    coalesce(nullif(line.value ->> 'stockReturnQty', '')::numeric, 0),
    nullif(line.value ->> 'stockUnit', '')
  from jsonb_array_elements(v_return_line_rows) line(value);

  return v_return;
end;
$$;

create or replace function app_private.sync_purchase_order_supplier_return_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.purchase_order_supplier_returns%rowtype;
  v_po public.purchase_orders%rowtype;
  v_next_items jsonb;
  v_is_fully_returned boolean := false;
begin
  if new.status not in ('COMPLETED'::public.transaction_status, 'CANCELLED'::public.transaction_status) then
    return new;
  end if;

  select * into v_return
  from public.purchase_order_supplier_returns r
  where r.transaction_id = new.id
  for update;
  if not found or v_return.status <> 'pending' then return new; end if;

  if new.status = 'CANCELLED'::public.transaction_status then
    update public.purchase_order_supplier_returns
    set status = 'cancelled', cancelled_at = now()
    where id = v_return.id;
    return new;
  end if;

  update public.purchase_order_supplier_returns
  set status = 'completed', completed_by = new.approver_id, completed_at = now()
  where id = v_return.id;

  select * into v_po
  from public.purchase_orders po
  where po.id = v_return.purchase_order_id
  for update;

  with returned_by_line as (
    select line.purchase_order_line_id, sum(line.return_qty) as returned_qty
    from public.purchase_order_supplier_return_lines line
    join public.purchase_order_supplier_returns r on r.id = line.supplier_return_id
    where r.purchase_order_id = v_return.purchase_order_id
      and r.status = 'completed'
    group by line.purchase_order_line_id
  ),
  po_items as (
    select item.value, item.ordinality,
      coalesce(item.value ->> 'lineId', item.value ->> 'itemId') as line_id
    from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality item(value, ordinality)
  )
  select coalesce(jsonb_agg(
    jsonb_set(p.value, '{returnedQty}', to_jsonb(coalesce(r.returned_qty, 0)), true)
    order by p.ordinality
  ), '[]'::jsonb)
  into v_next_items
  from po_items p
  left join returned_by_line r on r.purchase_order_line_id = p.line_id;

  select
    coalesce(bool_and(
      coalesce(nullif(item.value ->> 'receivedQty', '')::numeric, 0) <=
      coalesce(nullif(item.value ->> 'returnedQty', '')::numeric, 0)
    ), false)
    and coalesce(sum(coalesce(nullif(item.value ->> 'receivedQty', '')::numeric, 0)), 0) > 0
  into v_is_fully_returned
  from jsonb_array_elements(v_next_items) item(value);

  update public.purchase_orders
  set items = v_next_items,
      status = case when v_is_fully_returned then 'returned' else status end,
      delivery_note = concat_ws(
        ' | ',
        nullif(delivery_note, ''),
        case when v_is_fully_returned
          then 'Đã hoàn trả đủ hàng cho NCC qua phiếu ' || v_return.return_no
          else 'Đã hoàn trả một phần cho NCC qua phiếu ' || v_return.return_no
        end
      )
  where id = v_return.purchase_order_id;

  -- Do not mutate historical PO receipt fulfillment batches here.
  -- Gross received stays gross; return quantities are displayed beside it.

  return new;
end;
$$;

drop trigger if exists trg_sync_po_supplier_return_transaction on public.transactions;
create trigger trg_sync_po_supplier_return_transaction
after update of status on public.transactions
for each row execute function app_private.sync_purchase_order_supplier_return_from_transaction();

revoke all on function public.create_purchase_order_supplier_return(text, text, jsonb, text, text) from public;
revoke all on function public.create_purchase_order_supplier_return(text, text, jsonb, text, text) from anon;
grant execute on function public.create_purchase_order_supplier_return(text, text, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';

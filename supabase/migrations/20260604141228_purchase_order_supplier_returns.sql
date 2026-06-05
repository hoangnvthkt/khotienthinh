-- Supplier returns are separate downstream documents. They never mutate or
-- delete the original PO receipt transaction. Stock leaves the company only
-- after the linked pending EXPORT transaction is completed by WMS.

create schema if not exists app_private;

create table if not exists public.purchase_order_supplier_returns (
  id uuid primary key default gen_random_uuid(),
  return_no text not null unique,
  purchase_order_id text not null references public.purchase_orders(id) on delete restrict,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  vendor_id text,
  source_warehouse_id text not null references public.warehouses(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'cancelled')),
  transaction_id text not null unique references public.transactions(id) on delete restrict,
  reason text not null,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_by uuid references public.users(id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_supplier_return_lines (
  id uuid primary key default gen_random_uuid(),
  supplier_return_id uuid not null references public.purchase_order_supplier_returns(id) on delete restrict,
  purchase_order_line_id text not null,
  item_id text not null references public.items(id) on delete restrict,
  received_qty_snapshot numeric not null default 0 check (received_qty_snapshot >= 0),
  previously_returned_qty_snapshot numeric not null default 0 check (previously_returned_qty_snapshot >= 0),
  return_qty numeric not null check (return_qty > 0),
  unit text,
  unit_price numeric not null default 0,
  created_at timestamptz not null default now(),
  unique(supplier_return_id, purchase_order_line_id)
);

create index if not exists idx_po_supplier_returns_po_created
  on public.purchase_order_supplier_returns(purchase_order_id, created_at desc);

create index if not exists idx_po_supplier_returns_transaction
  on public.purchase_order_supplier_returns(transaction_id);

create index if not exists idx_po_supplier_returns_source_warehouse
  on public.purchase_order_supplier_returns(source_warehouse_id, status, created_at desc);

create index if not exists idx_po_supplier_return_lines_return
  on public.purchase_order_supplier_return_lines(supplier_return_id);

create or replace function app_private.set_purchase_order_supplier_return_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_po_supplier_returns_updated_at on public.purchase_order_supplier_returns;
create trigger trg_po_supplier_returns_updated_at
before update on public.purchase_order_supplier_returns
for each row execute function app_private.set_purchase_order_supplier_return_updated_at();

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
  v_received_qty numeric;
  v_returned_qty numeric;
  v_on_hand numeric;
  v_reserved numeric;
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

    select coalesce((coalesce(i.stock_by_warehouse, '{}'::jsonb) ->> p_source_warehouse_id)::numeric, 0)
    into v_on_hand
    from public.items i
    where i.id = v_item_id;
    if not found then raise exception 'Không tìm thấy vật tư: %', v_item_id; end if;

    select coalesce(sum(coalesce(nullif(item.value ->> 'quantity', '')::numeric, 0)), 0)
    into v_reserved
    from public.transactions t
    cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) item(value)
    where t.source_warehouse_id = p_source_warehouse_id
      and t.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
      and t.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type)
      and item.value ->> 'itemId' = v_item_id;

    if v_qty > greatest(0, v_on_hand - v_reserved) then
      raise exception 'Kho xuất trả không đủ tồn khả dụng cho vật tư %. Tồn %, đang giữ %, khả dụng %, cần trả %.',
        coalesce(v_po_item ->> 'name', v_item_id), v_on_hand, v_reserved, greatest(0, v_on_hand - v_reserved), v_qty;
    end if;

    v_transaction_items := v_transaction_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id,
      'quantity', v_qty,
      'price', coalesce(nullif(v_po_item ->> 'unitPrice', '')::numeric, 0),
      'supplierReturnId', v_return_id::text,
      'purchaseOrderId', p_purchase_order_id,
      'purchaseOrderLineId', v_po_line_id
    ));

    v_return_line_rows := v_return_line_rows || jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_po_line_id,
      'itemId', v_item_id,
      'receivedQtySnapshot', v_received_qty,
      'previouslyReturnedQtySnapshot', v_returned_qty,
      'returnQty', v_qty,
      'unit', nullif(v_po_item ->> 'unit', ''),
      'unitPrice', coalesce(nullif(v_po_item ->> 'unitPrice', '')::numeric, 0)
    ));
  end loop;

  -- Validate aggregate quantity once more because a PO may contain multiple
  -- lines for the same inventory item.
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

create or replace function app_private.sync_supplier_return_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id text;
  v_link_status text;
begin
  v_link_status := case
    when new.status = 'pending' then 'active'
    when new.status = 'cancelled' then 'cancelled'
    else 'reversed'
  end;

  insert into public.project_document_links(
    source_type, source_id, target_type, target_id, project_id,
    relation_type, status, metadata
  ) values (
    'purchase_order', new.purchase_order_id, 'supplier_return', new.id::text, new.project_id,
    'downstream', v_link_status, jsonb_build_object('transactionId', new.transaction_id, 'returnNo', new.return_no)
  )
  on conflict (source_type, source_id, target_type, target_id, relation_type)
  do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();

  insert into public.project_document_links(
    source_type, source_id, target_type, target_id, project_id,
    relation_type, status, metadata
  ) values (
    'purchase_order', new.purchase_order_id, 'transaction', new.transaction_id, new.project_id,
    'downstream', v_link_status, jsonb_build_object('kind', 'supplier_return', 'supplierReturnId', new.id)
  )
  on conflict (source_type, source_id, target_type, target_id, relation_type)
  do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();

  for v_request_id in
    select distinct porl.material_request_id
    from public.purchase_order_request_lines porl
    where porl.purchase_order_id = new.purchase_order_id
  loop
    insert into public.project_document_links(
      source_type, source_id, target_type, target_id, project_id,
      relation_type, status, metadata
    ) values (
      'material_request', v_request_id, 'supplier_return', new.id::text, new.project_id,
      'downstream', v_link_status, jsonb_build_object('purchaseOrderId', new.purchase_order_id, 'returnNo', new.return_no)
    )
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();

    insert into public.project_document_links(
      source_type, source_id, target_type, target_id, project_id,
      relation_type, status, metadata
    ) values (
      'material_request', v_request_id, 'transaction', new.transaction_id, new.project_id,
      'downstream', v_link_status, jsonb_build_object('kind', 'supplier_return', 'supplierReturnId', new.id)
    )
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_sync_supplier_return_dependencies on public.purchase_order_supplier_returns;
create trigger trg_sync_supplier_return_dependencies
after insert or update of status on public.purchase_order_supplier_returns
for each row execute function app_private.sync_supplier_return_dependencies();

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
  v_request_id text;
  v_total_committed numeric;
  v_total_issued numeric;
  v_total_received numeric;
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

  if v_is_fully_returned then
    update public.material_request_fulfillment_batches b
    set status = 'returned',
        reason = coalesce(b.reason, 'PO đã hoàn trả đủ hàng cho NCC'),
        cancel_reason = coalesce(b.cancel_reason, 'PO đã hoàn trả đủ hàng cho NCC'),
        note = concat_ws(' | ', nullif(b.note, ''), 'Phiếu hoàn kho: ' || new.id)
    where b.id in (
      select distinct line.batch_id
      from public.material_request_fulfillment_lines line
      where line.po_id = v_return.purchase_order_id
    );

    for v_request_id in
      select distinct porl.material_request_id
      from public.purchase_order_request_lines porl
      where porl.purchase_order_id = v_return.purchase_order_id
    loop
      select
        coalesce(sum(coalesce(nullif(item.value ->> 'requestQty', '')::numeric, 0)), 0)
      into v_total_committed
      from public.requests r
      cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) item(value)
      where r.id = v_request_id;

      select
        coalesce(sum(case when b.status not in ('draft', 'cancelled', 'returned') then line.issued_qty else 0 end), 0),
        coalesce(sum(case when b.status = 'received' then line.received_qty else 0 end), 0)
      into v_total_issued, v_total_received
      from public.material_request_fulfillment_lines line
      join public.material_request_fulfillment_batches b on b.id = line.batch_id
      where line.material_request_id = v_request_id;

      update public.requests
      set status = case
            when v_total_committed > 0 and v_total_received >= v_total_committed then 'COMPLETED'::public.request_status
            when v_total_issued > 0 or v_total_received > 0 then 'IN_TRANSIT'::public.request_status
            else 'APPROVED'::public.request_status
          end,
          workflow_step = case
            when v_total_committed > 0 and v_total_received >= v_total_committed then 'completed'
            when v_total_issued > 0 or v_total_received > 0 then 'site_quality_check'
            else 'batch_planning'
          end,
          workflow_step_started_at = now(),
          submission_note = 'PO đã hoàn trả đủ hàng cho NCC; phiếu đề xuất được đồng bộ lại theo phần cấp còn hiệu lực.'
      where id = v_request_id
        and status not in ('DRAFT'::public.request_status, 'PENDING'::public.request_status, 'REJECTED'::public.request_status);
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_po_supplier_return_transaction on public.transactions;
create trigger trg_sync_po_supplier_return_transaction
after update of status on public.transactions
for each row execute function app_private.sync_purchase_order_supplier_return_from_transaction();

alter table public.purchase_order_supplier_returns enable row level security;
alter table public.purchase_order_supplier_return_lines enable row level security;

drop policy if exists purchase_order_supplier_returns_select on public.purchase_order_supplier_returns;
create policy purchase_order_supplier_returns_select
on public.purchase_order_supplier_returns
for select to authenticated
using (
  app_private.project_doc_can_view(project_id, construction_site_id, null)
  or app_private.current_user_is_global_wms_keeper()
  or app_private.current_user_is_wms_keeper_for(source_warehouse_id)
);

drop policy if exists purchase_order_supplier_return_lines_select on public.purchase_order_supplier_return_lines;
create policy purchase_order_supplier_return_lines_select
on public.purchase_order_supplier_return_lines
for select to authenticated
using (
  exists (
    select 1
    from public.purchase_order_supplier_returns r
    where r.id = supplier_return_id
      and (
        app_private.project_doc_can_view(r.project_id, r.construction_site_id, null)
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(r.source_warehouse_id)
      )
  )
);

revoke all on table public.purchase_order_supplier_returns from public, anon, authenticated;
revoke all on table public.purchase_order_supplier_return_lines from public, anon, authenticated;
grant select on table public.purchase_order_supplier_returns to authenticated;
grant select on table public.purchase_order_supplier_return_lines to authenticated;

revoke all on function public.create_purchase_order_supplier_return(text, text, jsonb, text, text) from public, anon;
grant execute on function public.create_purchase_order_supplier_return(text, text, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';

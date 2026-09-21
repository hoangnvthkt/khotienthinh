-- G6: authoritative WMS quantities, receipt custody, transfer legs and counts.

alter table public.purchase_order_delivery_lines
  add column physical_counted_qty numeric,
  add column physical_counted_stock_qty numeric;

alter table public.purchase_order_delivery_lines
  drop constraint if exists purchase_order_delivery_lines_practical_qty_check,
  add column custody_qty numeric generated always as (
    case when physical_counted_qty is null then null
      else greatest(physical_counted_qty - accepted_qty, 0) end
  ) stored,
  add column custody_stock_qty numeric generated always as (
    case when physical_counted_stock_qty is null then null
      else greatest(physical_counted_stock_qty - accepted_stock_qty, 0) end
  ) stored,
  add constraint purchase_order_delivery_lines_physical_count_check check (
    delivered_qty >= 0
    and delivered_stock_qty >= 0
    and (physical_counted_qty is null or (
      physical_counted_qty >= 0 and accepted_qty <= physical_counted_qty
    ))
    and (physical_counted_stock_qty is null or (
      physical_counted_stock_qty >= 0 and accepted_stock_qty <= physical_counted_stock_qty
    ))
  );

alter table public.transactions
  add column if not exists row_version bigint not null default 1;

create table public.wms_inventory_reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  material_id text not null references public.items(id) on delete restrict,
  warehouse_id text not null references public.warehouses(id) on delete restrict,
  classification text not null check (classification in (
    'cache_missing', 'quantity_mismatch', 'negative_quantity',
    'source_movement', 'opening_balance', 'uom', 'reversal', 'cache'
  )),
  cache_qty numeric,
  ledger_qty numeric not null,
  difference_qty numeric,
  status text not null default 'open' check (status in ('open', 'resolved')),
  disposition text,
  owner_user_id uuid references public.users(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_wms_reconciliation_open_pair
  on public.wms_inventory_reconciliation_issues(material_id, warehouse_id)
  where status = 'open';

create table public.wms_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null references public.transactions(id) on delete restrict,
  line_key text not null,
  item_id text not null references public.items(id) on delete restrict,
  unit text,
  dispatched_qty numeric(18,6) not null,
  received_qty numeric(18,6) not null default 0,
  returned_qty numeric(18,6) not null default 0,
  lost_qty numeric(18,6) not null default 0,
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(transaction_id, line_key),
  check (dispatched_qty > 0),
  check (received_qty >= 0 and returned_qty >= 0 and lost_qty >= 0),
  check (returned_qty + received_qty + lost_qty <= dispatched_qty)
);

create table public.wms_transfer_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null references public.transactions(id) on delete restrict,
  transfer_line_id uuid not null references public.wms_transfer_lines(id) on delete restrict,
  event_type text not null check (event_type in ('dispatched', 'received', 'returned', 'lost')),
  quantity numeric(18,6) not null check (quantity > 0),
  warehouse_id text references public.warehouses(id) on delete restrict,
  reason text,
  command_key text not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(created_by, command_key, transfer_line_id, event_type)
);

create table app_private.wms_commands (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  command_name text not null,
  idempotency_key text not null,
  payload_hash text not null,
  result jsonb,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(actor_user_id, command_name, idempotency_key)
);

create table public.wms_inventory_counts (
  id uuid primary key default gen_random_uuid(),
  count_no text not null unique,
  warehouse_id text not null references public.warehouses(id) on delete restrict,
  status text not null default 'counting' check (status in ('counting', 'posted', 'cancelled')),
  snapshot_at timestamptz not null default now(),
  reason text not null,
  row_version bigint not null default 1,
  adjustment_transaction_id text references public.transactions(id) on delete restrict,
  created_by uuid not null references public.users(id) on delete restrict,
  approved_by uuid references public.users(id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wms_inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  inventory_count_id uuid not null references public.wms_inventory_counts(id) on delete restrict,
  item_id text not null references public.items(id) on delete restrict,
  unit text,
  snapshot_qty numeric(18,6) not null,
  movement_qty numeric(18,6),
  expected_qty_at_post numeric(18,6),
  counted_qty numeric(18,6),
  variance_qty numeric(18,6),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(inventory_count_id, item_id),
  check (snapshot_qty >= 0),
  check (counted_qty is null or counted_qty >= 0)
);

create index idx_wms_transfer_lines_transaction on public.wms_transfer_lines(transaction_id);
create index idx_wms_transfer_lines_item on public.wms_transfer_lines(item_id);
create index idx_wms_transfer_events_transaction on public.wms_transfer_events(transaction_id, created_at);
create index idx_wms_transfer_events_line on public.wms_transfer_events(transfer_line_id);
create index idx_wms_transfer_events_warehouse on public.wms_transfer_events(warehouse_id);
create index idx_wms_inventory_counts_warehouse on public.wms_inventory_counts(warehouse_id, created_at desc);
create index idx_wms_inventory_counts_adjustment on public.wms_inventory_counts(adjustment_transaction_id);
create index idx_wms_inventory_counts_created_by on public.wms_inventory_counts(created_by);
create index idx_wms_inventory_counts_approved_by on public.wms_inventory_counts(approved_by);
create index idx_wms_inventory_count_lines_count on public.wms_inventory_count_lines(inventory_count_id);
create index idx_wms_inventory_count_lines_item on public.wms_inventory_count_lines(item_id);
create index idx_wms_reconciliation_warehouse_status on public.wms_inventory_reconciliation_issues(warehouse_id, status);
create index idx_wms_reconciliation_owner on public.wms_inventory_reconciliation_issues(owner_user_id);
create index idx_wms_reconciliation_resolved_by on public.wms_inventory_reconciliation_issues(resolved_by);

alter table public.wms_inventory_reconciliation_issues enable row level security;
alter table public.wms_transfer_lines enable row level security;
alter table public.wms_transfer_events enable row level security;
alter table public.wms_inventory_counts enable row level security;
alter table public.wms_inventory_count_lines enable row level security;
alter table app_private.wms_commands enable row level security;

revoke all on public.wms_inventory_reconciliation_issues from anon, authenticated;
revoke all on public.wms_transfer_lines from anon, authenticated;
revoke all on public.wms_transfer_events from anon, authenticated;
revoke all on public.wms_inventory_counts from anon, authenticated;
revoke all on public.wms_inventory_count_lines from anon, authenticated;
revoke all on app_private.wms_commands from anon, authenticated;
grant select on public.wms_inventory_reconciliation_issues to authenticated;
grant select on public.wms_transfer_lines to authenticated;
grant select on public.wms_transfer_events to authenticated;
grant select on public.wms_inventory_counts to authenticated;
grant select on public.wms_inventory_count_lines to authenticated;
grant all on public.wms_inventory_reconciliation_issues, public.wms_transfer_lines,
  public.wms_transfer_events, public.wms_inventory_counts,
  public.wms_inventory_count_lines to service_role;
grant all on app_private.wms_commands to service_role;

create policy wms_transfer_lines_select on public.wms_transfer_lines
for select to authenticated using (
  exists (
    select 1 from public.transactions transaction_row
    where transaction_row.id = transaction_id
      and app_private.wms_has_action(
        'wms.transaction.view', transaction_row.source_warehouse_id,
        transaction_row.target_warehouse_id, transaction_row.requester_id,
        transaction_row.approver_id
      )
  )
);

create policy wms_transfer_events_select on public.wms_transfer_events
for select to authenticated using (
  exists (
    select 1 from public.transactions transaction_row
    where transaction_row.id = transaction_id
      and app_private.wms_has_action(
        'wms.transaction.view', transaction_row.source_warehouse_id,
        transaction_row.target_warehouse_id, transaction_row.requester_id,
        transaction_row.approver_id
      )
  )
);

create policy wms_reconciliation_select on public.wms_inventory_reconciliation_issues
for select to authenticated using (
  app_private.wms_has_action('wms.inventory.view', warehouse_id)
  or app_private.wms_has_action('wms.inventory.edit', warehouse_id)
);

create policy wms_inventory_counts_select on public.wms_inventory_counts
for select to authenticated using (
  app_private.wms_has_action('wms.inventory.view', warehouse_id)
  or app_private.wms_has_action('wms.inventory.edit', warehouse_id)
);

create policy wms_inventory_count_lines_select on public.wms_inventory_count_lines
for select to authenticated using (
  exists (
    select 1 from public.wms_inventory_counts count_row
    where count_row.id = inventory_count_id
      and (
        app_private.wms_has_action('wms.inventory.view', count_row.warehouse_id)
        or app_private.wms_has_action('wms.inventory.edit', count_row.warehouse_id)
      )
  )
);

create or replace function app_private.wms_stock_pair(
  p_material_id text,
  p_warehouse_id text
) returns table(cache_qty numeric, ledger_qty numeric)
language sql stable security definer set search_path = '' as $$
  select
    case
      when item.stock_by_warehouse ? p_warehouse_id
        then (item.stock_by_warehouse ->> p_warehouse_id)::numeric
      else null
    end,
    coalesce((
      select sum(balance.on_hand_qty)
      from public.inventory_balances balance
      where balance.material_id = p_material_id
        and balance.warehouse_id = p_warehouse_id
    ), 0)::numeric
  from public.items item
  where item.id = p_material_id;
$$;

create or replace function app_private.assert_wms_stock_authoritative(
  p_material_id text,
  p_warehouse_id text
) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pair record;
begin
  select * into v_pair from app_private.wms_stock_pair(p_material_id, p_warehouse_id);
  if not found or v_pair.cache_qty is null then
    raise exception 'WMS_STOCK_CACHE_MISSING' using errcode = 'P0001';
  end if;
  if v_pair.cache_qty < 0 or v_pair.ledger_qty < 0 then
    raise exception 'WMS_STOCK_NEGATIVE_RECONCILIATION_REQUIRED' using errcode = 'P0001';
  end if;
  if v_pair.cache_qty is distinct from v_pair.ledger_qty then
    raise exception 'WMS_STOCK_RECONCILIATION_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.wms_inventory_reconciliation_issues issue
    where issue.material_id = p_material_id
      and issue.warehouse_id = p_warehouse_id
      and issue.status = 'open'
  ) then
    raise exception 'WMS_STOCK_RECONCILIATION_REQUIRED' using errcode = 'P0001';
  end if;
  return v_pair.ledger_qty;
end;
$$;

revoke all on function app_private.wms_stock_pair(text, text) from public, anon, authenticated;
revoke all on function app_private.assert_wms_stock_authoritative(text, text) from public, anon, authenticated;
grant execute on function app_private.wms_stock_pair(text, text) to authenticated, service_role;
grant execute on function app_private.assert_wms_stock_authoritative(text, text) to authenticated, service_role;

create or replace function app_private.approve_material_po_quality(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid,
  p_quality_result text,
  p_lines jsonb,
  p_attachments jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_po_id text;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_tx public.transactions%rowtype;
  v_line jsonb;
  v_delivery_line public.purchase_order_delivery_lines%rowtype;
  v_delivery_line_id uuid;
  v_item_id text;
  v_documented_purchase_qty numeric;
  v_counted_purchase_qty numeric;
  v_accepted_purchase_qty numeric;
  v_documented_stock_qty numeric;
  v_counted_stock_qty numeric;
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
  if not found then raise exception 'Không tìm thấy đợt giao.' using errcode = '22023'; end if;

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
    p_actor_user_id, v_tx.target_warehouse_id
  ) then
    raise exception 'Người dùng không có quyền duyệt SL/CL tại kho nhận.' using errcode = '42501';
  end if;

  select count(*) into v_expected_line_count
  from public.purchase_order_delivery_lines
  where delivery_batch_id = p_delivery_batch_id;
  if v_expected_line_count = 0 or jsonb_array_length(p_lines) <> v_expected_line_count then
    raise exception 'Payload nhận hàng phải khớp 1-1 với dòng đợt giao.' using errcode = '22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) line(value)
  loop
    v_delivery_line_id := nullif(coalesce(
      v_line ->> 'deliveryLineId', v_line ->> 'delivery_line_id'
    ), '')::uuid;
    v_item_id := nullif(coalesce(v_line ->> 'itemId', v_line ->> 'item_id'), '');
    v_accepted_purchase_qty := coalesce(nullif(coalesce(
      v_line ->> 'acceptedPurchaseQty', v_line ->> 'accepted_purchase_qty'
    ), '')::numeric, 0);
    v_documented_purchase_qty := coalesce(nullif(coalesce(
      v_line ->> 'documentedPurchaseQty', v_line ->> 'documented_purchase_qty',
      v_line ->> 'deliveredPurchaseQty', v_line ->> 'delivered_purchase_qty'
    ), '')::numeric, v_accepted_purchase_qty);
    v_counted_purchase_qty := coalesce(nullif(coalesce(
      v_line ->> 'countedPurchaseQty', v_line ->> 'counted_purchase_qty'
    ), '')::numeric, v_documented_purchase_qty);
    v_accepted_stock_qty := coalesce(nullif(coalesce(
      v_line ->> 'acceptedStockQty', v_line ->> 'accepted_stock_qty'
    ), '')::numeric, 0);
    v_documented_stock_qty := coalesce(nullif(coalesce(
      v_line ->> 'documentedStockQty', v_line ->> 'documented_stock_qty',
      v_line ->> 'deliveredStockQty', v_line ->> 'delivered_stock_qty'
    ), '')::numeric, v_accepted_stock_qty);
    v_counted_stock_qty := coalesce(nullif(coalesce(
      v_line ->> 'countedStockQty', v_line ->> 'counted_stock_qty'
    ), '')::numeric, v_documented_stock_qty);
    v_variance_reason := nullif(trim(coalesce(
      v_line ->> 'varianceReason', v_line ->> 'variance_reason', ''
    )), '');

    if v_delivery_line_id is null or v_item_id is null then
      raise exception 'Dòng nhận hàng thiếu deliveryLineId hoặc itemId.' using errcode = '22023';
    end if;
    if v_delivery_line_id = any(v_seen_line_ids) then
      raise exception 'Dòng nhận hàng bị lặp.' using errcode = '22023';
    end if;
    if least(
      v_documented_purchase_qty, v_counted_purchase_qty, v_accepted_purchase_qty,
      v_documented_stock_qty, v_counted_stock_qty, v_accepted_stock_qty
    ) < 0 then
      raise exception 'Số lượng thực tế không được âm.' using errcode = '22023';
    end if;
    if v_accepted_purchase_qty > v_counted_purchase_qty then
      raise exception 'Số đạt không được lớn hơn số đếm/cân thực tế.' using errcode = '22023';
    end if;
    if v_accepted_stock_qty > v_counted_stock_qty then
      raise exception 'Số đạt theo đơn vị kho không được lớn hơn số đếm/cân.' using errcode = '22023';
    end if;

    select * into v_delivery_line
    from public.purchase_order_delivery_lines
    where id = v_delivery_line_id and delivery_batch_id = p_delivery_batch_id
    for update;
    if not found or v_delivery_line.item_id <> v_item_id then
      raise exception 'Dòng nhận hàng không thuộc đợt giao.' using errcode = '22023';
    end if;

    v_stock_factor := case
      when coalesce(v_delivery_line.planned_qty, 0) > 0
       and coalesce(v_delivery_line.stock_planned_qty, 0) > 0
        then v_delivery_line.stock_planned_qty / v_delivery_line.planned_qty
      else 1
    end;
    if abs(round(v_counted_purchase_qty * v_stock_factor, 6) - round(v_counted_stock_qty, 6)) > 0.000001
       or abs(round(v_accepted_purchase_qty * v_stock_factor, 6) - round(v_accepted_stock_qty, 6)) > 0.000001 then
      raise exception 'Số lượng đếm/đạt không khớp snapshot quy đổi.' using errcode = '22023';
    end if;
    if (
      v_documented_purchase_qty is distinct from coalesce(v_delivery_line.planned_qty, 0)
      or v_counted_purchase_qty is distinct from v_documented_purchase_qty
      or v_accepted_purchase_qty is distinct from v_counted_purchase_qty
      or v_counted_stock_qty is distinct from v_documented_stock_qty
      or v_accepted_stock_qty is distinct from v_counted_stock_qty
    ) and v_variance_reason is null then
      raise exception 'Phải nhập lý do khi số đặt, chứng từ, đếm/cân hoặc số đạt chênh lệch.' using errcode = '22023';
    end if;

    update public.purchase_order_delivery_lines
    set delivered_qty = v_documented_purchase_qty,
        physical_counted_qty = v_counted_purchase_qty,
        accepted_qty = v_accepted_purchase_qty,
        delivered_stock_qty = v_documented_stock_qty,
        physical_counted_stock_qty = v_counted_stock_qty,
        accepted_stock_qty = v_accepted_stock_qty,
        updated_at = now()
    where id = v_delivery_line.id;

    v_seen_line_ids := array_append(v_seen_line_ids, v_delivery_line.id);
    if v_variance_reason is not null then
      v_combined_reason := concat_ws('; ', v_combined_reason, v_variance_reason);
    end if;
    v_stock_unit_price := case when v_stock_factor > 0
      then coalesce(v_delivery_line.delivery_unit_price, 0) / v_stock_factor
      else coalesce(v_delivery_line.delivery_unit_price, 0) end;
    v_gross := v_gross + v_accepted_purchase_qty
      * coalesce(v_delivery_line.delivery_unit_price, 0)
      * (1 + coalesce(v_batch.vat_rate, 0) / 100);

    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_delivery_line.item_id,
      'quantity', v_accepted_stock_qty,
      'orderedQty', coalesce(v_delivery_line.stock_planned_qty, v_delivery_line.planned_qty, 0),
      'documentedStockQty', v_documented_stock_qty,
      'countedStockQty', v_counted_stock_qty,
      'custodyStockQty', greatest(v_counted_stock_qty - v_accepted_stock_qty, 0),
      'price', v_stock_unit_price,
      'accountingQty', v_accepted_purchase_qty,
      'orderedPurchaseQty', v_delivery_line.planned_qty,
      'documentedPurchaseQty', v_documented_purchase_qty,
      'countedPurchaseQty', v_counted_purchase_qty,
      'custodyPurchaseQty', greatest(v_counted_purchase_qty - v_accepted_purchase_qty, 0),
      'accountingUnit', coalesce(v_delivery_line.unit, v_delivery_line.stock_unit, ''),
      'accountingPrice', coalesce(v_delivery_line.delivery_unit_price, 0),
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
  set items = v_wms_items, attachments = coalesce(p_attachments, '[]'::jsonb),
      status = 'APPROVED'::public.transaction_status,
      approver_id = p_actor_user_id, approved_at = now(), row_version = row_version + 1
  where id = p_wms_transaction_id;

  update public.purchase_order_delivery_batches
  set status = 'quality_approved', quality_result = p_quality_result,
      variance_reason = v_combined_reason, quality_approved_by = p_actor_user_id,
      quality_approved_at = now(), accepted_gross_amount = round(v_gross, 2),
      updated_at = now()
  where id = p_delivery_batch_id;

  return app_private.purchase_receipt_command_result_v2(p_delivery_batch_id, false);
end;
$$;

create or replace function app_private.post_wms_transfer_movement_v1(
  p_transaction public.transactions,
  p_command_key text,
  p_warehouse_id text,
  p_direction text,
  p_transaction_type text,
  p_event_type text,
  p_lines jsonb,
  p_actor_user_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_inventory_transaction_id uuid;
  v_code text;
  v_scope record;
  v_line jsonb;
  v_entry_no integer := 0;
begin
  if p_direction not in ('in', 'out') or p_transaction_type not in ('transfer_issue', 'transfer_receipt') then
    raise exception 'WMS_TRANSFER_LEDGER_PAYLOAD_INVALID' using errcode = '22023';
  end if;
  select id into v_inventory_transaction_id
  from public.inventory_transactions
  where source_type = 'wms_transfer_event' and source_id = p_command_key;
  if v_inventory_transaction_id is not null then return v_inventory_transaction_id; end if;

  v_code := app_private.next_inventory_ledger_code(p_direction);
  select * into v_scope from app_private.resolve_warehouse_project_scope(p_warehouse_id);
  insert into public.inventory_transactions(
    code, transaction_type, status, transaction_date,
    source_type, source_id, source_code, related_request_id,
    project_id, construction_site_id, business_event_type,
    description, metadata, created_by, approved_by, posted_at
  ) values (
    v_code, p_transaction_type, 'posted', now(),
    'wms_transfer_event', p_command_key, p_transaction.id, p_transaction.related_request_id,
    v_scope.project_id, v_scope.construction_site_id, 'warehouse_transfer',
    p_transaction.note,
    jsonb_build_object(
      'wmsTransactionId', p_transaction.id,
      'eventType', p_event_type,
      'warehouseId', p_warehouse_id,
      'lines', p_lines
    ),
    p_transaction.requester_id, p_actor_user_id, now()
  ) returning id into v_inventory_transaction_id;

  for v_line in select value from jsonb_array_elements(p_lines) line(value)
  loop
    v_entry_no := v_entry_no + 1;
    perform app_private.post_inventory_ledger_entry(
      v_inventory_transaction_id, v_entry_no, v_code, now(),
      p_transaction_type, p_direction,
      v_line ->> 'itemId', p_warehouse_id,
      v_scope.project_id, v_scope.construction_site_id,
      'wms_transfer_event', p_command_key, p_transaction.id,
      v_line ->> 'transferLineId', p_transaction.related_request_id,
      (v_line ->> 'quantity')::numeric,
      coalesce(nullif(v_line ->> 'price', '')::numeric, 0),
      p_transaction.note,
      v_line || jsonb_build_object(
        'businessEventType', 'warehouse_transfer',
        'transferEventType', p_event_type,
        'wmsTransactionId', p_transaction.id
      ),
      p_transaction.requester_id, p_actor_user_id
    );
  end loop;
  return v_inventory_transaction_id;
end;
$$;

create or replace function app_private.dispatch_wms_transfer_v1(
  p_transaction_id text,
  p_expected_version bigint,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
    ));
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
$$;

create or replace function app_private.receive_wms_transfer_v1(
  p_transaction_id text,
  p_lines jsonb,
  p_expected_version bigint,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_tx public.transactions%rowtype;
  v_existing app_private.wms_commands%rowtype;
  v_payload_hash text;
  v_line jsonb;
  v_transfer_line public.wms_transfer_lines%rowtype;
  v_qty numeric;
  v_remaining numeric;
  v_movement_lines jsonb := '[]'::jsonb;
  v_in_transit numeric;
  v_result jsonb;
  v_pair record;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'WMS_TRANSFER_RECEIPT_LINES_REQUIRED' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'WMS_IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  v_payload_hash := md5(jsonb_build_object(
    'transactionId', p_transaction_id, 'lines', p_lines,
    'expectedVersion', p_expected_version
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':receive_wms_transfer_v1:' || p_idempotency_key, 0
  ));
  select * into v_existing from app_private.wms_commands
  where actor_user_id = v_actor and command_name = 'receive_wms_transfer_v1'
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
  if v_tx.status <> 'APPROVED'::public.transaction_status then
    raise exception 'WMS_TRANSFER_NOT_IN_TRANSIT' using errcode = '22023';
  end if;
  if not app_private.wms_transaction_has_action(
    'wms.transaction.complete', v_tx.type, v_tx.source_warehouse_id,
    v_tx.target_warehouse_id, v_tx.items, v_tx.requester_id, v_tx.approver_id, v_actor
  ) then
    raise exception 'WMS_TRANSFER_RECEIVE_DENIED' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) payload(value)
    group by payload.value ->> 'transferLineId' having count(*) > 1
  ) then
    raise exception 'WMS_TRANSFER_DUPLICATE_LINE' using errcode = '22023';
  end if;

  perform 1 from public.wms_transfer_lines line
  where line.transaction_id = v_tx.id order by line.id for update;
  perform 1 from public.items item
  where item.id in (
    select line.item_id from public.wms_transfer_lines line
    where line.transaction_id = v_tx.id
  ) order by item.id for update;

  for v_pair in
    select distinct transfer_line.item_id
    from jsonb_array_elements(p_lines) payload(value)
    join public.wms_transfer_lines transfer_line
      on transfer_line.id = (payload.value ->> 'transferLineId')::uuid
     and transfer_line.transaction_id = v_tx.id
  loop
    select * into v_pair from app_private.wms_stock_pair(
      v_pair.item_id, v_tx.target_warehouse_id
    );
    if v_pair.cache_qty is null and v_pair.ledger_qty <> 0
       or v_pair.cache_qty is not null and v_pair.cache_qty is distinct from v_pair.ledger_qty
       or coalesce(v_pair.cache_qty, 0) < 0 or v_pair.ledger_qty < 0 then
      raise exception 'WMS_STOCK_RECONCILIATION_REQUIRED' using errcode = 'P0001';
    end if;
  end loop;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce(nullif(coalesce(
      v_line ->> 'quantity', v_line ->> 'receiveQty'
    ), '')::numeric, 0);
    if v_qty <= 0 then raise exception 'WMS_TRANSFER_RECEIVE_QTY_INVALID' using errcode = '22023'; end if;
    select * into v_transfer_line
    from public.wms_transfer_lines
    where id = (v_line ->> 'transferLineId')::uuid
      and transaction_id = v_tx.id
    for update;
    if not found then raise exception 'WMS_TRANSFER_LINE_NOT_FOUND' using errcode = '22023'; end if;
    v_remaining := v_transfer_line.dispatched_qty - v_transfer_line.received_qty
      - v_transfer_line.returned_qty - v_transfer_line.lost_qty;
    if v_qty > v_remaining then
      raise exception 'WMS_TRANSFER_DISPOSITION_EXCEEDED' using errcode = '22023';
    end if;
    perform public.apply_stock_change(v_transfer_line.item_id, v_tx.target_warehouse_id, v_qty);
    update public.wms_transfer_lines
    set received_qty = received_qty + v_qty,
        row_version = row_version + 1, updated_at = now()
    where id = v_transfer_line.id;
    insert into public.wms_transfer_events(
      transaction_id, transfer_line_id, event_type, quantity,
      warehouse_id, command_key, created_by
    ) values (
      v_tx.id, v_transfer_line.id, 'received', v_qty,
      v_tx.target_warehouse_id, p_idempotency_key, v_actor
    );
    v_movement_lines := v_movement_lines || jsonb_build_array(jsonb_build_object(
      'transferLineId', v_transfer_line.id,
      'itemId', v_transfer_line.item_id,
      'quantity', v_qty,
      'unit', v_transfer_line.unit,
      'price', coalesce((
        select nullif(item ->> 'price', '')::numeric
        from jsonb_array_elements(v_tx.items) item
        where item ->> 'itemId' = v_transfer_line.item_id limit 1
      ), 0)
    ));
  end loop;

  perform app_private.post_wms_transfer_movement_v1(
    v_tx, 'receive:' || v_tx.id || ':' || p_idempotency_key,
    v_tx.target_warehouse_id, 'in', 'transfer_receipt', 'received',
    v_movement_lines, v_actor
  );
  select coalesce(sum(dispatched_qty - received_qty - returned_qty - lost_qty), 0)
  into v_in_transit from public.wms_transfer_lines where transaction_id = v_tx.id;
  perform set_config('app.wms_transfer_command', 'on', true);
  update public.transactions
  set status = case when v_in_transit = 0
      then 'COMPLETED'::public.transaction_status else status end,
      approver_id = v_actor,
      approved_at = coalesce(approved_at, now()),
      row_version = row_version + 1
  where id = v_tx.id returning * into v_tx;
  perform set_config('app.wms_transfer_command', '', true);

  v_result := jsonb_build_object(
    'transactionId', v_tx.id, 'status', v_tx.status,
    'rowVersion', v_tx.row_version, 'inTransitQty', v_in_transit,
    'replayed', false
  );
  insert into app_private.wms_commands(
    actor_user_id, command_name, idempotency_key, payload_hash, result, committed_at
  ) values (
    v_actor, 'receive_wms_transfer_v1', p_idempotency_key,
    v_payload_hash, v_result, now()
  );
  return v_result;
exception when others then
  perform set_config('app.wms_transfer_command', '', true);
  raise;
end;
$$;

create or replace function app_private.dispose_wms_transfer_v1(
  p_transaction_id text,
  p_disposition text,
  p_lines jsonb,
  p_reason text,
  p_expected_version bigint,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_tx public.transactions%rowtype;
  v_existing app_private.wms_commands%rowtype;
  v_payload_hash text;
  v_line jsonb;
  v_item_id text;
  v_transfer_line public.wms_transfer_lines%rowtype;
  v_qty numeric;
  v_remaining numeric;
  v_movement_lines jsonb := '[]'::jsonb;
  v_in_transit numeric;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_disposition not in ('returned', 'lost') then
    raise exception 'WMS_TRANSFER_DISPOSITION_INVALID' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'WMS_TRANSFER_DISPOSITION_REASON_REQUIRED' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'WMS_TRANSFER_DISPOSITION_LINES_REQUIRED' using errcode = '22023';
  end if;
  v_payload_hash := md5(jsonb_build_object(
    'transactionId', p_transaction_id, 'disposition', p_disposition,
    'lines', p_lines, 'reason', btrim(p_reason),
    'expectedVersion', p_expected_version
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':dispose_wms_transfer_v1:' || p_idempotency_key, 0
  ));
  select * into v_existing from app_private.wms_commands
  where actor_user_id = v_actor and command_name = 'dispose_wms_transfer_v1'
    and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.payload_hash <> v_payload_hash then
      raise exception 'WMS_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;
  select * into v_tx from public.transactions where id = p_transaction_id for update;
  if not found or v_tx.type <> 'TRANSFER'::public.transaction_type
     or v_tx.status <> 'APPROVED'::public.transaction_status then
    raise exception 'WMS_TRANSFER_NOT_IN_TRANSIT' using errcode = '22023';
  end if;
  if v_tx.row_version <> p_expected_version then
    raise exception 'WMS_TRANSFER_STALE_VERSION' using errcode = '40001';
  end if;
  if not app_private.wms_transaction_has_action(
    'wms.transaction.complete', v_tx.type, v_tx.source_warehouse_id,
    v_tx.target_warehouse_id, v_tx.items, v_tx.requester_id, v_tx.approver_id, v_actor
  ) then
    raise exception 'WMS_TRANSFER_DISPOSITION_DENIED' using errcode = '42501';
  end if;
  perform 1 from public.wms_transfer_lines line
  where line.transaction_id = v_tx.id order by line.id for update;
  perform 1 from public.items item
  where item.id in (
    select line.item_id from public.wms_transfer_lines line
    where line.transaction_id = v_tx.id
  ) order by item.id for update;

  if p_disposition = 'returned' then
    for v_item_id in
      select distinct transfer_line.item_id
      from jsonb_array_elements(p_lines) payload(value)
      join public.wms_transfer_lines transfer_line
        on transfer_line.id = (payload.value ->> 'transferLineId')::uuid
       and transfer_line.transaction_id = v_tx.id
    loop
      perform app_private.assert_wms_stock_authoritative(
        v_item_id, v_tx.source_warehouse_id
      );
    end loop;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0);
    if v_qty <= 0 then raise exception 'WMS_TRANSFER_DISPOSITION_QTY_INVALID' using errcode = '22023'; end if;
    select * into v_transfer_line from public.wms_transfer_lines
    where id = (v_line ->> 'transferLineId')::uuid
      and transaction_id = v_tx.id for update;
    if not found then raise exception 'WMS_TRANSFER_LINE_NOT_FOUND' using errcode = '22023'; end if;
    v_remaining := v_transfer_line.dispatched_qty - v_transfer_line.received_qty
      - v_transfer_line.returned_qty - v_transfer_line.lost_qty;
    if v_qty > v_remaining then
      raise exception 'WMS_TRANSFER_DISPOSITION_EXCEEDED' using errcode = '22023';
    end if;
    if p_disposition = 'returned' then
      perform public.apply_stock_change(v_transfer_line.item_id, v_tx.source_warehouse_id, v_qty);
      v_movement_lines := v_movement_lines || jsonb_build_array(jsonb_build_object(
        'transferLineId', v_transfer_line.id, 'itemId', v_transfer_line.item_id,
        'quantity', v_qty, 'unit', v_transfer_line.unit, 'price', 0
      ));
    end if;
    update public.wms_transfer_lines
    set returned_qty = returned_qty + case when p_disposition = 'returned' then v_qty else 0 end,
        lost_qty = lost_qty + case when p_disposition = 'lost' then v_qty else 0 end,
        row_version = row_version + 1, updated_at = now()
    where id = v_transfer_line.id;
    insert into public.wms_transfer_events(
      transaction_id, transfer_line_id, event_type, quantity,
      warehouse_id, reason, command_key, created_by
    ) values (
      v_tx.id, v_transfer_line.id, p_disposition, v_qty,
      case when p_disposition = 'returned' then v_tx.source_warehouse_id else null end,
      btrim(p_reason), p_idempotency_key, v_actor
    );
  end loop;
  if p_disposition = 'returned' then
    perform app_private.post_wms_transfer_movement_v1(
      v_tx, 'return:' || v_tx.id || ':' || p_idempotency_key,
      v_tx.source_warehouse_id, 'in', 'transfer_receipt', 'returned',
      v_movement_lines, v_actor
    );
  end if;
  select coalesce(sum(dispatched_qty - received_qty - returned_qty - lost_qty), 0)
  into v_in_transit from public.wms_transfer_lines where transaction_id = v_tx.id;
  perform set_config('app.wms_transfer_command', 'on', true);
  update public.transactions
  set status = case when v_in_transit = 0
      then 'COMPLETED'::public.transaction_status else status end,
      row_version = row_version + 1
  where id = v_tx.id returning * into v_tx;
  perform set_config('app.wms_transfer_command', '', true);
  v_result := jsonb_build_object(
    'transactionId', v_tx.id, 'status', v_tx.status,
    'rowVersion', v_tx.row_version, 'inTransitQty', v_in_transit,
    'replayed', false
  );
  insert into app_private.wms_commands(
    actor_user_id, command_name, idempotency_key, payload_hash, result, committed_at
  ) values (
    v_actor, 'dispose_wms_transfer_v1', p_idempotency_key,
    v_payload_hash, v_result, now()
  );
  return v_result;
exception when others then
  perform set_config('app.wms_transfer_command', '', true);
  raise;
end;
$$;

create or replace function app_private.guard_wms_transfer_status_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'TRANSFER'::public.transaction_type
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and new.status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status)
     and coalesce(current_setting('app.wms_transfer_command', true), '') <> 'on' then
    raise exception 'WMS_TRANSFER_COMMAND_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_wms_transfer_status_v1 on public.transactions;
create trigger trg_guard_wms_transfer_status_v1
before insert or update on public.transactions
for each row execute function app_private.guard_wms_transfer_status_v1();

create or replace function app_private.trg_sync_wms_transaction_inventory_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status::text = 'COMPLETED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not (
       new.type = 'TRANSFER'::public.transaction_type
       and exists (
         select 1 from public.wms_transfer_lines line
         where line.transaction_id = new.id
       )
     )
     and not (
       new.source_type = 'po_delivery_batch'
       and exists (
         select 1 from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) item(value)
         where item.value ->> 'fulfillmentMode' = 'DIRECT_CONSUMPTION'
       )
     ) then
    perform app_private.sync_wms_transaction_to_inventory_ledger(new.id);
  end if;
  return new;
end;
$$;

revoke all on function app_private.post_wms_transfer_movement_v1(
  public.transactions, text, text, text, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function app_private.dispatch_wms_transfer_v1(text, bigint, text) from public, anon, authenticated;
revoke all on function app_private.receive_wms_transfer_v1(text, jsonb, bigint, text) from public, anon, authenticated;
revoke all on function app_private.dispose_wms_transfer_v1(text, text, jsonb, text, bigint, text) from public, anon, authenticated;
revoke all on function app_private.guard_wms_transfer_status_v1() from public, anon, authenticated;
grant execute on function app_private.dispatch_wms_transfer_v1(text, bigint, text) to authenticated, service_role;
grant execute on function app_private.receive_wms_transfer_v1(text, jsonb, bigint, text) to authenticated, service_role;
grant execute on function app_private.dispose_wms_transfer_v1(text, text, jsonb, text, bigint, text) to authenticated, service_role;

create function public.dispatch_wms_transfer_v1(
  p_transaction_id text, p_expected_version bigint, p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.dispatch_wms_transfer_v1(
    p_transaction_id, p_expected_version, p_idempotency_key
  );
$$;
create function public.receive_wms_transfer_v1(
  p_transaction_id text, p_lines jsonb, p_expected_version bigint,
  p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.receive_wms_transfer_v1(
    p_transaction_id, p_lines, p_expected_version, p_idempotency_key
  );
$$;
create function public.dispose_wms_transfer_v1(
  p_transaction_id text, p_disposition text, p_lines jsonb, p_reason text,
  p_expected_version bigint, p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.dispose_wms_transfer_v1(
    p_transaction_id, p_disposition, p_lines, p_reason,
    p_expected_version, p_idempotency_key
  );
$$;
revoke all on function public.dispatch_wms_transfer_v1(text, bigint, text) from public, anon;
revoke all on function public.receive_wms_transfer_v1(text, jsonb, bigint, text) from public, anon;
revoke all on function public.dispose_wms_transfer_v1(text, text, jsonb, text, bigint, text) from public, anon;
grant execute on function public.dispatch_wms_transfer_v1(text, bigint, text) to authenticated, service_role;
grant execute on function public.receive_wms_transfer_v1(text, jsonb, bigint, text) to authenticated, service_role;
grant execute on function public.dispose_wms_transfer_v1(text, text, jsonb, text, bigint, text) to authenticated, service_role;

create or replace function app_private.start_wms_inventory_count_v1(
  p_warehouse_id text,
  p_item_ids text[],
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_existing app_private.wms_commands%rowtype;
  v_payload_hash text;
  v_count public.wms_inventory_counts%rowtype;
  v_item record;
  v_snapshot numeric;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if nullif(p_warehouse_id, '') is null or nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'WMS_COUNT_WAREHOUSE_REASON_REQUIRED' using errcode = '22023';
  end if;
  if not app_private.wms_has_action('wms.inventory.edit', p_warehouse_id) then
    raise exception 'WMS_COUNT_DENIED' using errcode = '42501';
  end if;
  v_payload_hash := md5(jsonb_build_object(
    'warehouseId', p_warehouse_id,
    'itemIds', coalesce(to_jsonb(p_item_ids), 'null'::jsonb),
    'reason', btrim(p_reason)
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':start_wms_inventory_count_v1:' || p_idempotency_key, 0
  ));
  select * into v_existing from app_private.wms_commands
  where actor_user_id = v_actor and command_name = 'start_wms_inventory_count_v1'
    and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.payload_hash <> v_payload_hash then
      raise exception 'WMS_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  insert into public.wms_inventory_counts(
    count_no, warehouse_id, reason, created_by
  ) values (
    'KK-' || to_char(now(), 'YYYYMMDD') || '-'
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    p_warehouse_id, btrim(p_reason), v_actor
  ) returning * into v_count;

  for v_item in
    select item.id, item.unit
    from public.items item
    where (
      p_item_ids is not null and item.id = any(p_item_ids)
    ) or (
      p_item_ids is null and (
        item.stock_by_warehouse ? p_warehouse_id
        or exists (
          select 1 from public.inventory_balances balance
          where balance.material_id = item.id
            and balance.warehouse_id = p_warehouse_id
        )
      )
    )
    order by item.id
    for update
  loop
    v_snapshot := app_private.assert_wms_stock_authoritative(v_item.id, p_warehouse_id);
    insert into public.wms_inventory_count_lines(
      inventory_count_id, item_id, unit, snapshot_qty
    ) values (v_count.id, v_item.id, v_item.unit, v_snapshot);
  end loop;
  if not exists (
    select 1 from public.wms_inventory_count_lines line
    where line.inventory_count_id = v_count.id
  ) then
    raise exception 'WMS_COUNT_ITEMS_REQUIRED' using errcode = '22023';
  end if;
  v_result := jsonb_build_object(
    'inventoryCountId', v_count.id, 'countNo', v_count.count_no,
    'warehouseId', v_count.warehouse_id, 'status', v_count.status,
    'rowVersion', v_count.row_version, 'snapshotAt', v_count.snapshot_at,
    'replayed', false
  );
  insert into app_private.wms_commands(
    actor_user_id, command_name, idempotency_key, payload_hash, result, committed_at
  ) values (
    v_actor, 'start_wms_inventory_count_v1', p_idempotency_key,
    v_payload_hash, v_result, now()
  );
  return v_result;
end;
$$;

create or replace function app_private.post_wms_inventory_count_v1(
  p_inventory_count_id uuid,
  p_lines jsonb,
  p_expected_version bigint,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_existing app_private.wms_commands%rowtype;
  v_payload_hash text;
  v_count public.wms_inventory_counts%rowtype;
  v_line jsonb;
  v_count_line public.wms_inventory_count_lines%rowtype;
  v_current numeric;
  v_counted numeric;
  v_variance numeric;
  v_items jsonb := '[]'::jsonb;
  v_transaction_id text;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'WMS_COUNT_LINES_REQUIRED' using errcode = '22023';
  end if;
  v_payload_hash := md5(jsonb_build_object(
    'inventoryCountId', p_inventory_count_id,
    'lines', p_lines, 'expectedVersion', p_expected_version
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':post_wms_inventory_count_v1:' || p_idempotency_key, 0
  ));
  select * into v_existing from app_private.wms_commands
  where actor_user_id = v_actor and command_name = 'post_wms_inventory_count_v1'
    and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.payload_hash <> v_payload_hash then
      raise exception 'WMS_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_count from public.wms_inventory_counts
  where id = p_inventory_count_id for update;
  if not found then raise exception 'WMS_COUNT_NOT_FOUND' using errcode = '22023'; end if;
  if v_count.row_version <> p_expected_version then
    raise exception 'WMS_COUNT_STALE_VERSION' using errcode = '40001';
  end if;
  if v_count.status <> 'counting' then
    raise exception 'WMS_COUNT_NOT_OPEN' using errcode = '22023';
  end if;
  if not app_private.wms_has_action('wms.inventory.edit', v_count.warehouse_id) then
    raise exception 'WMS_COUNT_DENIED' using errcode = '42501';
  end if;
  if jsonb_array_length(p_lines) <> (
    select count(*) from public.wms_inventory_count_lines line
    where line.inventory_count_id = v_count.id
  ) then
    raise exception 'WMS_COUNT_LINES_MUST_MATCH_SNAPSHOT' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) payload(value)
    group by payload.value ->> 'countLineId' having count(*) > 1
  ) then
    raise exception 'WMS_COUNT_DUPLICATE_LINE' using errcode = '22023';
  end if;

  perform 1 from public.wms_inventory_count_lines line
  where line.inventory_count_id = v_count.id order by line.id for update;
  perform 1 from public.items item
  where item.id in (
    select line.item_id from public.wms_inventory_count_lines line
    where line.inventory_count_id = v_count.id
  ) order by item.id for update;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_counted := nullif(v_line ->> 'countedQty', '')::numeric;
    if v_counted is null or v_counted < 0 then
      raise exception 'WMS_COUNT_QTY_INVALID' using errcode = '22023';
    end if;
    select * into v_count_line from public.wms_inventory_count_lines
    where id = (v_line ->> 'countLineId')::uuid
      and inventory_count_id = v_count.id for update;
    if not found then raise exception 'WMS_COUNT_LINE_NOT_FOUND' using errcode = '22023'; end if;
    v_current := app_private.assert_wms_stock_authoritative(
      v_count_line.item_id, v_count.warehouse_id
    );
    v_variance := v_counted - v_current;
    update public.wms_inventory_count_lines
    set movement_qty = v_current - snapshot_qty,
        expected_qty_at_post = v_current,
        counted_qty = v_counted,
        variance_qty = v_variance,
        evidence = coalesce(v_line -> 'evidence', '[]'::jsonb),
        note = nullif(btrim(coalesce(v_line ->> 'note', '')), ''),
        updated_at = now()
    where id = v_count_line.id;
    if v_variance <> 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'itemId', v_count_line.item_id,
        'quantity', v_variance,
        'unit', v_count_line.unit,
        'price', 0,
        'inventoryCountId', v_count.id,
        'inventoryCountLineId', v_count_line.id,
        'snapshotQty', v_count_line.snapshot_qty,
        'expectedQtyAtPost', v_current,
        'countedQty', v_counted
      ));
    end if;
  end loop;

  if jsonb_array_length(v_items) > 0 then
    v_transaction_id := 'tx-inventory-count-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.transactions(
      id, type, date, items, source_warehouse_id, target_warehouse_id,
      requester_id, status, note, pending_items,
      source_type, source_id, business_event_type, business_event_reason,
      idempotency_key
    ) values (
      v_transaction_id, 'ADJUSTMENT'::public.transaction_type, now(), v_items,
      v_count.warehouse_id, v_count.warehouse_id,
      v_actor, 'PENDING'::public.transaction_status,
      'Kiểm kê ' || v_count.count_no, '[]'::jsonb,
      'wms_inventory_count', v_count.id::text,
      'inventory_adjustment', v_count.reason, p_idempotency_key
    );
    for v_line in select value from jsonb_array_elements(v_items)
    loop
      perform public.apply_stock_change(
        v_line ->> 'itemId', v_count.warehouse_id,
        (v_line ->> 'quantity')::numeric
      );
    end loop;
    if current_setting('app.g6_fault_after_stock', true) = 'on' then
      raise exception 'G6_INJECTED_FAILURE_AFTER_STOCK';
    end if;
    update public.transactions
    set status = 'COMPLETED'::public.transaction_status,
        approver_id = v_actor, approved_at = now(), row_version = row_version + 1
    where id = v_transaction_id;
  end if;

  update public.wms_inventory_counts
  set status = 'posted', adjustment_transaction_id = v_transaction_id,
      approved_by = v_actor, posted_at = now(),
      row_version = row_version + 1, updated_at = now()
  where id = v_count.id returning * into v_count;
  v_result := jsonb_build_object(
    'inventoryCountId', v_count.id, 'countNo', v_count.count_no,
    'status', v_count.status, 'rowVersion', v_count.row_version,
    'adjustmentTransactionId', v_count.adjustment_transaction_id,
    'replayed', false
  );
  insert into app_private.wms_commands(
    actor_user_id, command_name, idempotency_key, payload_hash, result, committed_at
  ) values (
    v_actor, 'post_wms_inventory_count_v1', p_idempotency_key,
    v_payload_hash, v_result, now()
  );
  return v_result;
end;
$$;

revoke all on function app_private.start_wms_inventory_count_v1(text, text[], text, text) from public, anon, authenticated;
revoke all on function app_private.post_wms_inventory_count_v1(uuid, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function app_private.start_wms_inventory_count_v1(text, text[], text, text) to authenticated, service_role;
grant execute on function app_private.post_wms_inventory_count_v1(uuid, jsonb, bigint, text) to authenticated, service_role;

create function public.start_wms_inventory_count_v1(
  p_warehouse_id text, p_item_ids text[], p_reason text, p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.start_wms_inventory_count_v1(
    p_warehouse_id, p_item_ids, p_reason, p_idempotency_key
  );
$$;
create function public.post_wms_inventory_count_v1(
  p_inventory_count_id uuid, p_lines jsonb, p_expected_version bigint,
  p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.post_wms_inventory_count_v1(
    p_inventory_count_id, p_lines, p_expected_version, p_idempotency_key
  );
$$;
revoke all on function public.start_wms_inventory_count_v1(text, text[], text, text) from public, anon;
revoke all on function public.post_wms_inventory_count_v1(uuid, jsonb, bigint, text) from public, anon;
grant execute on function public.start_wms_inventory_count_v1(text, text[], text, text) to authenticated, service_role;
grant execute on function public.post_wms_inventory_count_v1(uuid, jsonb, bigint, text) to authenticated, service_role;

create or replace function app_private.get_wms_inventory_workspace_v1(
  p_warehouse_id text default null,
  p_search text default null,
  p_cursor text default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_limit integer := least(200, greatest(1, coalesce(p_limit, 50)));
  v_rows jsonb;
  v_next_cursor text;
  v_issue_count integer;
  v_receipt_unknown_count integer;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_warehouse_id is not null and not (
    app_private.wms_has_action('wms.inventory.view', p_warehouse_id)
    or app_private.wms_has_action('wms.inventory.edit', p_warehouse_id)
  ) then
    raise exception 'WMS_INVENTORY_VIEW_DENIED' using errcode = '42501';
  end if;

  with authorized_warehouses as (
    select warehouse.id, warehouse.name
    from public.warehouses warehouse
    where (p_warehouse_id is null or warehouse.id = p_warehouse_id)
      and (
        app_private.wms_has_action('wms.inventory.view', warehouse.id)
        or app_private.wms_has_action('wms.inventory.edit', warehouse.id)
      )
  ),
  cache_pairs as (
    select item.id material_id, cache.key warehouse_id,
      case when cache.value #>> '{}' ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (cache.value #>> '{}')::numeric else null end cache_qty
    from public.items item
    cross join lateral jsonb_each(coalesce(item.stock_by_warehouse, '{}'::jsonb)) cache
    join authorized_warehouses warehouse on warehouse.id = cache.key
  ),
  ledger_pairs as (
    select balance.material_id, balance.warehouse_id,
      sum(balance.on_hand_qty)::numeric ledger_qty
    from public.inventory_balances balance
    join authorized_warehouses warehouse on warehouse.id = balance.warehouse_id
    group by balance.material_id, balance.warehouse_id
  ),
  candidate_pairs as (
    select material_id, warehouse_id from cache_pairs
    union select material_id, warehouse_id from ledger_pairs
    union
    select line.item_id, transaction_row.target_warehouse_id
    from public.wms_transfer_lines line
    join public.transactions transaction_row on transaction_row.id = line.transaction_id
    join authorized_warehouses warehouse on warehouse.id = transaction_row.target_warehouse_id
    where line.dispatched_qty > line.received_qty + line.returned_qty + line.lost_qty
    union
    select line.item_id, transaction_row.target_warehouse_id
    from public.purchase_order_delivery_lines line
    join public.purchase_order_delivery_batches batch on batch.id = line.delivery_batch_id
    join public.transactions transaction_row on transaction_row.id = batch.wms_transaction_id
    join authorized_warehouses warehouse on warehouse.id = transaction_row.target_warehouse_id
    where batch.status <> 'cancelled'
      and (line.custody_stock_qty > 0 or line.physical_counted_stock_qty is null)
  ),
  transit as (
    select line.item_id material_id, transaction_row.target_warehouse_id warehouse_id,
      sum(line.dispatched_qty - line.received_qty - line.returned_qty - line.lost_qty)::numeric qty
    from public.wms_transfer_lines line
    join public.transactions transaction_row on transaction_row.id = line.transaction_id
    join authorized_warehouses warehouse on warehouse.id = transaction_row.target_warehouse_id
    group by line.item_id, transaction_row.target_warehouse_id
  ),
  receipt_custody as (
    select line.item_id material_id, transaction_row.target_warehouse_id warehouse_id,
      sum(coalesce(line.custody_stock_qty, 0))::numeric qty,
      bool_and(line.physical_counted_stock_qty is not null) complete
    from public.purchase_order_delivery_lines line
    join public.purchase_order_delivery_batches batch on batch.id = line.delivery_batch_id
    join public.transactions transaction_row on transaction_row.id = batch.wms_transaction_id
    join authorized_warehouses warehouse on warehouse.id = transaction_row.target_warehouse_id
    where batch.status <> 'cancelled'
    group by line.item_id, transaction_row.target_warehouse_id
  ),
  team_custody as (
    select line.item_id material_id, issue.source_warehouse_id warehouse_id,
      sum(greatest(line.issued_qty - line.consumed_qty - line.returned_qty - line.lost_qty, 0))::numeric qty
    from public.material_issue_lines line
    join public.material_issue_orders issue on issue.id = line.issue_order_id
    join authorized_warehouses warehouse on warehouse.id = issue.source_warehouse_id
    group by line.item_id, issue.source_warehouse_id
  ),
  reservations as (
    select payload.value ->> 'itemId' material_id,
      transaction_row.source_warehouse_id warehouse_id,
      sum(coalesce(nullif(payload.value ->> 'quantity', '')::numeric, 0))::numeric qty
    from public.transactions transaction_row
    cross join lateral jsonb_array_elements(coalesce(transaction_row.items, '[]'::jsonb)) payload(value)
    join authorized_warehouses warehouse on warehouse.id = transaction_row.source_warehouse_id
    where transaction_row.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
      and transaction_row.type in (
        'EXPORT'::public.transaction_type,
        'TRANSFER'::public.transaction_type,
        'LIQUIDATION'::public.transaction_type
      )
      and not (
        transaction_row.type = 'TRANSFER'::public.transaction_type
        and exists (
          select 1 from public.wms_transfer_lines transfer_line
          where transfer_line.transaction_id = transaction_row.id
        )
      )
    group by payload.value ->> 'itemId', transaction_row.source_warehouse_id
  ),
  source_rows as (
    select
      pair.warehouse_id,
      warehouse.name warehouse_name,
      pair.material_id,
      item.sku,
      item.name material_name,
      item.unit,
      cache.cache_qty,
      coalesce(ledger.ledger_qty, 0)::numeric ledger_qty,
      coalesce(reservation.qty, 0)::numeric reserved_qty,
      coalesce(transit.qty, 0)::numeric in_transit_qty,
      case when receipt.complete is false then null
        else coalesce(receipt.qty, 0)::numeric end receipt_custody_qty,
      coalesce(receipt.complete, true) receipt_custody_complete,
      coalesce(team.qty, 0)::numeric team_custody_qty,
      issue.id reconciliation_issue_id,
      issue.classification issue_classification,
      issue.owner_user_id,
      issue.disposition,
      (pair.warehouse_id || ':' || pair.material_id) row_key
    from candidate_pairs pair
    join authorized_warehouses warehouse on warehouse.id = pair.warehouse_id
    join public.items item on item.id = pair.material_id
    left join cache_pairs cache using(material_id, warehouse_id)
    left join ledger_pairs ledger using(material_id, warehouse_id)
    left join reservations reservation using(material_id, warehouse_id)
    left join transit using(material_id, warehouse_id)
    left join receipt_custody receipt using(material_id, warehouse_id)
    left join team_custody team using(material_id, warehouse_id)
    left join public.wms_inventory_reconciliation_issues issue
      on issue.material_id = pair.material_id
     and issue.warehouse_id = pair.warehouse_id
     and issue.status = 'open'
    where (p_search is null or btrim(p_search) = ''
      or item.sku ilike '%' || btrim(p_search) || '%'
      or item.name ilike '%' || btrim(p_search) || '%')
      and (p_cursor is null or pair.warehouse_id || ':' || pair.material_id > p_cursor)
  ),
  page as (
    select * from source_rows order by row_key limit v_limit + 1
  ),
  visible as (
    select * from page order by row_key limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', row_key,
    'warehouseId', warehouse_id,
    'warehouseName', warehouse_name,
    'materialId', material_id,
    'sku', sku,
    'materialName', material_name,
    'unit', unit,
    'cacheQty', cache_qty,
    'onHandQty', ledger_qty,
    'reservedQty', reserved_qty,
    'availableQty', case
      when (coalesce(cache_qty, 0) = ledger_qty)
       and coalesce(cache_qty, 0) >= 0 and ledger_qty >= 0
       and reconciliation_issue_id is null
       and receipt_custody_complete
        then greatest(ledger_qty - reserved_qty, 0)
      else null end,
    'inTransitQty', in_transit_qty,
    'receiptCustodyQty', receipt_custody_qty,
    'teamCustodyQty', team_custody_qty,
    'authoritative', (
      coalesce(cache_qty, 0) = ledger_qty
      and coalesce(cache_qty, 0) >= 0 and ledger_qty >= 0
      and reconciliation_issue_id is null
      and receipt_custody_complete
    ),
    'classification', case
      when coalesce(cache_qty, 0) < 0 or ledger_qty < 0 then 'negative_quantity'
      when cache_qty is null and ledger_qty <> 0 then 'cache_missing'
      when coalesce(cache_qty, 0) is distinct from ledger_qty then 'quantity_mismatch'
      when reconciliation_issue_id is not null then issue_classification
      when not receipt_custody_complete then 'receipt_count_unknown'
      else 'matched' end,
    'reconciliationIssueId', reconciliation_issue_id,
    'ownerUserId', owner_user_id,
    'disposition', disposition
  ) order by row_key), '[]'::jsonb)
  into v_rows from visible;

  select count(*) into v_receipt_unknown_count
  from jsonb_array_elements(v_rows) row(value)
  where row.value ->> 'receiptCustodyQty' is null;

  with authorized_warehouses as (
    select warehouse.id from public.warehouses warehouse
    where (p_warehouse_id is null or warehouse.id = p_warehouse_id)
      and (app_private.wms_has_action('wms.inventory.view', warehouse.id)
        or app_private.wms_has_action('wms.inventory.edit', warehouse.id))
  )
  select count(*) into v_issue_count
  from public.wms_inventory_reconciliation_issues issue
  join authorized_warehouses warehouse on warehouse.id = issue.warehouse_id
  where issue.status = 'open';

  if jsonb_array_length(v_rows) = v_limit then
    v_next_cursor := v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'key';
  end if;
  return jsonb_build_object(
    'asOf', now(), 'metricVersion', 'g6.wms.quantity.v1',
    'warehouseId', p_warehouse_id, 'rows', v_rows,
    'nextCursor', v_next_cursor,
    'completeness', jsonb_build_object(
      'authoritative', v_issue_count = 0
        and v_receipt_unknown_count = 0
        and not exists (
          select 1 from jsonb_array_elements(v_rows) row(value)
          where coalesce((row.value ->> 'authoritative')::boolean, false) is false
        ),
      'openReconciliationIssues', v_issue_count,
      'unknownReceiptCounts', v_receipt_unknown_count
    )
  );
end;
$$;

create or replace function app_private.get_material_custody_v1(
  p_project_id text default null,
  p_construction_site_id text default null,
  p_recipient_type text default null,
  p_recipient_id text default null,
  p_limit integer default 200
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_rows jsonb;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'issueOrderId', source.issue_order_id,
    'issueNo', source.issue_no,
    'issueLineId', source.issue_line_id,
    'projectId', source.project_id,
    'constructionSiteId', source.construction_site_id,
    'sourceWarehouseId', source.source_warehouse_id,
    'recipientType', source.recipient_type,
    'recipientId', source.recipient_id,
    'recipientName', source.recipient_name,
    'responsibleUserId', source.responsible_user_id,
    'itemId', source.item_id,
    'itemName', source.item_name_snapshot,
    'unit', source.unit,
    'issuedQty', source.issued_qty,
    'receivedConfirmedQty', source.received_qty,
    'consumedQty', source.consumed_qty,
    'returnedQty', source.returned_qty,
    'lostQty', source.lost_qty,
    'custodyQty', source.custody_qty,
    'workBoqItemId', source.work_boq_item_id,
    'materialBudgetItemId', source.material_budget_item_id,
    'allocationComplete', source.work_boq_item_id is not null
      and source.material_budget_item_id is not null,
    'status', source.status,
    'neededDate', source.needed_date
  ) order by source.created_at desc, source.issue_line_id), '[]'::jsonb)
  into v_rows
  from (
    select issue.id issue_order_id, issue.issue_no, line.id issue_line_id,
      issue.project_id, issue.construction_site_id, issue.source_warehouse_id,
      issue.recipient_type, issue.recipient_id, issue.recipient_name,
      issue.responsible_user_id, line.item_id, line.item_name_snapshot,
      line.unit, line.issued_qty, line.received_qty, line.consumed_qty,
      line.returned_qty, line.lost_qty,
      greatest(line.issued_qty - line.consumed_qty - line.returned_qty - line.lost_qty, 0) custody_qty,
      line.work_boq_item_id, line.material_budget_item_id,
      issue.status, issue.needed_date, issue.created_at
    from public.material_issue_lines line
    join public.material_issue_orders issue on issue.id = line.issue_order_id
    where (p_project_id is null or issue.project_id = p_project_id)
      and (p_construction_site_id is null or issue.construction_site_id = p_construction_site_id)
      and (p_recipient_type is null or issue.recipient_type = p_recipient_type)
      and (p_recipient_id is null or issue.recipient_id = p_recipient_id)
      and line.issued_qty - line.consumed_qty - line.returned_qty - line.lost_qty > 0
      and app_private.material_issue_can_view(
        issue.project_id, issue.construction_site_id, issue.source_warehouse_id,
        issue.created_by, issue.responsible_user_id,
        issue.recipient_type, issue.recipient_id
      )
    order by issue.created_at desc, line.id
    limit least(500, greatest(1, coalesce(p_limit, 200)))
  ) source;
  return jsonb_build_object(
    'asOf', now(), 'metricVersion', 'g6.material-custody.v1',
    'rows', v_rows,
    'completeness', jsonb_build_object(
      'allocationComplete', not exists (
        select 1 from jsonb_array_elements(v_rows) row(value)
        where coalesce((row.value ->> 'allocationComplete')::boolean, false) is false
      )
    )
  );
end;
$$;

revoke all on function app_private.get_wms_inventory_workspace_v1(text, text, text, integer) from public, anon, authenticated;
revoke all on function app_private.get_material_custody_v1(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function app_private.get_wms_inventory_workspace_v1(text, text, text, integer) to authenticated, service_role;
grant execute on function app_private.get_material_custody_v1(text, text, text, text, integer) to authenticated, service_role;

create function public.get_wms_inventory_workspace_v1(
  p_warehouse_id text default null,
  p_search text default null,
  p_cursor text default null,
  p_limit integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_wms_inventory_workspace_v1(
    p_warehouse_id, p_search, p_cursor, p_limit
  );
$$;
create function public.get_material_custody_v1(
  p_project_id text default null,
  p_construction_site_id text default null,
  p_recipient_type text default null,
  p_recipient_id text default null,
  p_limit integer default 200
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_material_custody_v1(
    p_project_id, p_construction_site_id, p_recipient_type,
    p_recipient_id, p_limit
  );
$$;
revoke all on function public.get_wms_inventory_workspace_v1(text, text, text, integer) from public, anon;
revoke all on function public.get_material_custody_v1(text, text, text, text, integer) from public, anon;
grant execute on function public.get_wms_inventory_workspace_v1(text, text, text, integer) to authenticated, service_role;
grant execute on function public.get_material_custody_v1(text, text, text, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

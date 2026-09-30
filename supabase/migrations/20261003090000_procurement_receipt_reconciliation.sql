-- Kho & Công nợ — Đối chiếu nhận hàng tồn đọng (chủ sản phẩm duyệt 30/09/2026).
--
-- Đợt giao theo PO nằm ở kho quá 3 ngày chưa nhập (Mua hàng và kho lệch nhau) được chốt một lần:
-- * Mua hàng (Room/quyền Mua hàng — Quản lý) và thủ kho của kho nhận cùng chốt từng đợt:
--     Về đủ / Về thiếu hoặc dư (SL thực nhận từng dòng) / Không về, kèm ngày hàng về thực tế và lý do.
-- * Mỗi lần sửa nội dung tăng revision và xóa các xác nhận cũ; một người không xác nhận cả hai phía.
-- * Thủ kho (hoặc Admin) ghi sổ khi đủ 2 xác nhận:
--     - Về đủ/lệch: kiểm SL/CL + nhập kho trong một bước; sổ kho, chi phí dự án và công nợ NCC
--       lấy ngày hàng về (lùi ngày chỉ cho phép ở màn này); công nợ gắn nhãn nguồn để kế toán đối chiếu.
--     - Không về: hủy đợt giao và phiếu kho; phần chưa giao mở lại cho PO.
--     - Phần còn thiếu: chờ NCC giao tiếp, hoặc chốt thiếu (PO đóng, phần còn lại về Cần mua).
-- * Đợt mà kho đã nhập phiếu WMS nhưng PO chưa ghi nhận (lệch ngược): không nhập kho lại; chỉ nhập bổ sung
--   phần kho còn thiếu (phiếu nhập riêng theo ngày hàng về), rồi cập nhật PO và công nợ theo SL thực nhận.
--   Không cho chốt thấp hơn số kho đã nhập — điều chỉnh giảm đi qua kiểm kê.
-- * Phía còn lại có thể Từ chối (bắt buộc lý do): xác nhận của phía kia bị gỡ, phiếu hiện "Bị từ chối — cần sửa".
-- * Phân quyền: Xem (Mua hàng — Xem, thủ kho, quản trị WMS, Admin) · Mua hàng xác nhận/từ chối (Mua hàng — Quản lý)
--   · Thủ kho xác nhận/từ chối/ghi sổ (thủ kho được giao đúng kho nhận, quản trị WMS, Admin).
-- * Mọi thao tác ghi vào nhật ký bất biến (ai, lúc nào, trước/sau).

create table public.procurement_receipt_reconciliations (
  id uuid primary key default gen_random_uuid(),
  delivery_batch_id uuid not null references public.purchase_order_delivery_batches(id),
  purchase_order_id text not null references public.purchase_orders(id),
  warehouse_id text not null,
  wms_transaction_id text not null,
  status text not null default 'open' check (status in ('open', 'posted', 'voided')),
  decision text not null check (decision in ('full', 'partial', 'none')),
  remainder text not null default 'keep_open' check (remainder in ('keep_open', 'close')),
  arrival_date date,
  lines jsonb not null default '[]'::jsonb,
  reason text,
  revision integer not null default 1,
  buyer_confirmed_by uuid references public.users(id),
  buyer_confirmed_at timestamptz,
  keeper_confirmed_by uuid references public.users(id),
  keeper_confirmed_at timestamptz,
  posted_by uuid references public.users(id),
  posted_at timestamptz,
  result jsonb,
  rejection jsonb,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  check (decision = 'none' or arrival_date is not null)
);
create unique index procurement_receipt_recon_active_batch_idx
  on public.procurement_receipt_reconciliations (delivery_batch_id) where status <> 'voided';

create table public.procurement_receipt_reconciliation_events (
  id bigint generated always as identity primary key,
  reconciliation_id uuid not null references public.procurement_receipt_reconciliations(id),
  action text not null check (action in ('create', 'save', 'confirm_buyer', 'confirm_keeper', 'revoke_buyer', 'revoke_keeper', 'reject_buyer', 'reject_keeper', 'post')),
  actor_id uuid references public.users(id),
  revision integer not null,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index procurement_receipt_recon_events_idx on public.procurement_receipt_reconciliation_events (reconciliation_id, id);

alter table public.procurement_receipt_reconciliations enable row level security;
alter table public.procurement_receipt_reconciliation_events enable row level security;
revoke all on public.procurement_receipt_reconciliations, public.procurement_receipt_reconciliation_events from public, anon, authenticated;

create function app_private.trg_receipt_recon_events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'RECEIPT_RECON_HISTORY_IMMUTABLE';
end;
$$;
create trigger trg_receipt_recon_events_immutable
  before update or delete on public.procurement_receipt_reconciliation_events
  for each row execute function app_private.trg_receipt_recon_events_immutable();

-- Đợt giao nhập kho theo PO còn mở ở kho (chưa nhập, chưa hủy).
-- stocked = kho đã hoàn tất phiếu WMS nhưng đợt giao/PO chưa ghi nhận.
create function app_private.receipt_recon_candidates()
returns table (batch_id uuid, purchase_order_id text, warehouse_id text, tx_id text, age_days integer, stocked boolean)
language sql stable security definer set search_path = '' as $$
  select b.id, b.purchase_order_id, t.target_warehouse_id, t.id,
    ((now() at time zone 'Asia/Ho_Chi_Minh')::date - (coalesce(t.date, t.created_at) at time zone 'Asia/Ho_Chi_Minh')::date),
    t.status::text = 'COMPLETED'
  from public.purchase_order_delivery_batches b
  join public.purchase_orders po on po.id = b.purchase_order_id
  join public.transactions t on t.id = b.wms_transaction_id
    and t.source_type = 'po_delivery_batch' and t.source_id = b.id::text
  where b.status in ('wms_pending', 'receiving', 'quality_approved')
    and t.status::text in ('PENDING', 'APPROVED', 'COMPLETED') and t.type::text = 'IMPORT'
    and coalesce(b.fulfillment_mode, 'RECEIVE_TO_STOCK') = 'RECEIVE_TO_STOCK'
    and coalesce(po.procurement_flow_version, 2) = 2
    and po.archived_at is null
    and po.status in ('confirmed', 'in_transit', 'partial');
$$;

-- SL kho đã nhập theo từng dòng đợt giao (đơn vị kho), khi phiếu WMS đã hoàn tất.
create function app_private.receipt_recon_stocked(p_batch_id uuid)
returns table (delivery_line_id uuid, stocked_stock_qty numeric, stock_factor numeric)
language sql stable security definer set search_path = '' as $$
  select l.id,
    coalesce((select sum(coalesce(nullif(x->>'quantity', '')::numeric, 0)) from jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) x
      where x->>'purchaseOrderDeliveryLineId' = l.id::text
        or (nullif(x->>'purchaseOrderDeliveryLineId', '') is null and x->>'itemId' = l.item_id)), 0),
    case when coalesce(l.planned_qty, 0) > 0 and coalesce(l.stock_planned_qty, 0) > 0 then l.stock_planned_qty / l.planned_qty else 1 end
  from public.purchase_order_delivery_lines l
  join public.purchase_order_delivery_batches b on b.id = l.delivery_batch_id
  join public.transactions t on t.id = b.wms_transaction_id and t.status::text = 'COMPLETED'
  where l.delivery_batch_id = p_batch_id;
$$;

create function app_private.receipt_recon_is_buyer()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and (public.is_admin() or app_private.procurement_can('manage'));
$$;

-- Phía kho: thủ kho được giao đúng kho nhận, quản trị WMS hoặc Admin.
create function app_private.receipt_recon_is_keeper(p_warehouse_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and (public.is_admin() or public.is_module_admin('WMS')
    or public.current_app_user_id() in (select app_private.wms_warehouse_keepers(p_warehouse_id)));
$$;

create function app_private.receipt_recon_snapshot(r public.procurement_receipt_reconciliations)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('decision', r.decision, 'remainder', r.remainder, 'arrivalDate', r.arrival_date,
    'lines', r.lines, 'reason', r.reason, 'buyerConfirmedBy', r.buyer_confirmed_by, 'keeperConfirmedBy', r.keeper_confirmed_by);
$$;

-- Một dòng màn đối chiếu: đợt giao, PO, dòng hàng, đối chiếu hiện tại, lịch sử và quyền của người xem.
create function app_private.receipt_recon_item(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_b public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_r public.procurement_receipt_reconciliations%rowtype;
  v_open boolean;
  v_buyer boolean := app_private.receipt_recon_is_buyer();
  v_keeper boolean;
begin
  select * into v_b from public.purchase_order_delivery_batches where id = p_batch_id;
  select * into v_po from public.purchase_orders where id = v_b.purchase_order_id;
  select * into v_tx from public.transactions where id = v_b.wms_transaction_id;
  select * into v_r from public.procurement_receipt_reconciliations
  where delivery_batch_id = p_batch_id and status <> 'voided' order by created_at desc limit 1;
  v_open := exists (select 1 from app_private.receipt_recon_candidates() c where c.batch_id = p_batch_id);
  v_keeper := app_private.receipt_recon_is_keeper(v_tx.target_warehouse_id);
  return jsonb_build_object(
    'deliveryBatchId', v_b.id, 'deliveryNo', v_b.delivery_no, 'batchStatus', v_b.status, 'plannedDate', v_b.planned_delivery_date,
    'purchaseOrderId', v_po.id, 'poNumber', v_po.po_number, 'poStatus', v_po.status, 'purchaseMode', coalesce(v_po.purchase_mode, 'single'),
    'orderDate', nullif(v_po.order_date, ''), 'vendorName', coalesce(v_b.supplier_name_snapshot, v_po.vendor_name),
    'projectId', v_po.project_id, 'projectCode', (select code from public.projects where id = v_po.project_id),
    'warehouseId', v_tx.target_warehouse_id, 'warehouseName', (select name from public.warehouses where id = v_tx.target_warehouse_id),
    'wmsTransactionId', v_tx.id, 'txStatus', v_tx.status::text, 'docDate', coalesce(v_tx.date, v_tx.created_at),
    'ageDays', ((now() at time zone 'Asia/Ho_Chi_Minh')::date - (coalesce(v_tx.date, v_tx.created_at) at time zone 'Asia/Ho_Chi_Minh')::date),
    'createdByName', (select name from public.users where id::text = v_tx.requester_id::text),
    'vatRate', coalesce(v_b.vat_rate, v_po.vat_rate, 0),
    'open', v_open,
    'stocked', v_tx.status::text = 'COMPLETED' and v_open,
    'checked', case when v_open and v_b.quality_approved_by is not null then jsonb_build_object(
      'byName', (select name from public.users where id = v_b.quality_approved_by), 'at', v_b.quality_approved_at) end,
    -- Phần PO chưa nằm trong đợt giao nào (ngoài SL đợt này) — để chọn chờ giao tiếp hay chốt thiếu.
    'poUnscheduled', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(i.name, x.value->>'name'), 'unit', coalesce(nullif(x.value->>'unit', ''), i.unit),
        'qty', round(u.qty, 6)) order by x.ord), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality x(value, ord)
      left join public.items i on i.id = x.value->>'itemId'
      cross join lateral (select app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')) qty) u
      where u.qty > 0.000001),
    'otherOpenDeliveries', (select count(*) from public.purchase_order_delivery_batches o
      where o.purchase_order_id = v_po.id and o.id <> v_b.id and o.status = any (app_private.procurement_po_open_delivery_statuses())),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('deliveryLineId', l.id, 'itemId', l.item_id,
        'name', coalesce(i.name, l.item_id), 'sku', i.sku, 'unit', coalesce(nullif(l.unit, ''), i.unit),
        'plannedQty', coalesce(l.planned_qty, 0), 'unitPrice', coalesce(l.delivery_unit_price, 0),
        'checkedQty', case when v_open and v_b.quality_approved_by is not null then l.accepted_qty end,
        'stockedQty', case when v_open and st.delivery_line_id is not null then round(st.stocked_stock_qty / st.stock_factor, 6) end)
        order by coalesce(i.name, l.item_id), l.id), '[]'::jsonb)
      from public.purchase_order_delivery_lines l left join public.items i on i.id = l.item_id
      left join app_private.receipt_recon_stocked(v_b.id) st on st.delivery_line_id = l.id
      where l.delivery_batch_id = v_b.id),
    'recon', case when v_r.id is not null then jsonb_build_object(
      'id', v_r.id, 'status', v_r.status, 'decision', v_r.decision, 'remainder', v_r.remainder, 'arrivalDate', v_r.arrival_date,
      'lines', v_r.lines, 'reason', v_r.reason, 'revision', v_r.revision,
      'buyer', case when v_r.buyer_confirmed_by is not null then jsonb_build_object('id', v_r.buyer_confirmed_by,
        'name', (select name from public.users where id = v_r.buyer_confirmed_by), 'at', v_r.buyer_confirmed_at) end,
      'keeper', case when v_r.keeper_confirmed_by is not null then jsonb_build_object('id', v_r.keeper_confirmed_by,
        'name', (select name from public.users where id = v_r.keeper_confirmed_by), 'at', v_r.keeper_confirmed_at) end,
      'postedByName', (select name from public.users where id = v_r.posted_by), 'postedAt', v_r.posted_at, 'result', v_r.result,
      'rejection', v_r.rejection,
      'updatedByName', (select name from public.users where id = v_r.updated_by), 'updatedAt', v_r.updated_at,
      'events', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'actorName', u.name, 'at', e.created_at,
          'revision', e.revision, 'before', e.before, 'after', e.after, 'note', e.note) order by e.id), '[]'::jsonb)
        from public.procurement_receipt_reconciliation_events e left join public.users u on u.id = e.actor_id
        where e.reconciliation_id = v_r.id)) end,
    'can', jsonb_build_object(
      'edit', coalesce(v_open and (v_buyer or v_keeper) and coalesce(v_r.status, 'open') = 'open', false),
      'buyer', v_buyer, 'keeper', v_keeper,
      'confirmBuyer', coalesce(v_open and v_buyer and v_r.status = 'open' and v_r.buyer_confirmed_by is null
        and v_r.keeper_confirmed_by is distinct from v_actor, false),
      'confirmKeeper', coalesce(v_open and v_keeper and v_r.status = 'open' and v_r.keeper_confirmed_by is null
        and v_r.buyer_confirmed_by is distinct from v_actor, false),
      'rejectBuyer', coalesce(v_open and v_buyer and v_r.status = 'open' and v_r.buyer_confirmed_by is null
        and v_r.keeper_confirmed_by is not null and v_r.keeper_confirmed_by <> v_actor, false),
      'rejectKeeper', coalesce(v_open and v_keeper and v_r.status = 'open' and v_r.keeper_confirmed_by is null
        and v_r.buyer_confirmed_by is not null and v_r.buyer_confirmed_by <> v_actor, false),
      'post', coalesce(v_open and v_keeper and v_r.status = 'open' and v_r.buyer_confirmed_by is not null
        and v_r.keeper_confirmed_by is not null, false))
  );
end;
$$;

create function public.list_receipt_reconciliations_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_buyer boolean;
  v_all boolean;
  v_keeper_any boolean;
  v_wh text := nullif(p_filter->>'warehouseId', '');
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  v_buyer := app_private.receipt_recon_is_buyer();
  v_keeper_any := exists (select 1 from public.warehouses w where v_actor in (select app_private.wms_warehouse_keepers(w.id)));
  -- Bậc xem toàn công ty: Mua hàng (Xem/Quản lý), quản trị WMS, Admin. Thủ kho chỉ thấy kho được giao.
  v_all := v_buyer or public.is_admin() or public.is_module_admin('WMS') or app_private.procurement_can('view');
  if not v_all and not v_keeper_any then
    raise exception using errcode = '42501', message = 'RECEIPT_RECON_VIEW_DENIED';
  end if;
  return (
    with scope as (
      select c.batch_id, c.warehouse_id from app_private.receipt_recon_candidates() c
      where c.age_days >= 3 or exists (select 1 from public.procurement_receipt_reconciliations r
        where r.delivery_batch_id = c.batch_id and r.status = 'open')
      union
      select r.delivery_batch_id, r.warehouse_id from public.procurement_receipt_reconciliations r
      where r.status = 'posted' and r.posted_at > now() - interval '120 days'
    ), visible as (
      select s.batch_id from scope s
      where (v_wh is null or s.warehouse_id = v_wh) and (v_all or app_private.receipt_recon_is_keeper(s.warehouse_id))
    ), items as (select app_private.receipt_recon_item(v.batch_id) j from visible v)
    select jsonb_build_object(
      'canBuyer', v_buyer,
      'role', jsonb_build_object('buyer', v_buyer, 'keeper', v_keeper_any or public.is_admin() or public.is_module_admin('WMS'),
        'admin', public.is_admin(), 'readOnly', not (v_buyer or v_keeper_any or public.is_admin() or public.is_module_admin('WMS'))),
      'warehouses', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', j->>'warehouseId', 'name', j->>'warehouseName')), '[]'::jsonb) from items),
      'items', coalesce((select jsonb_agg(j order by (j->>'open')::boolean desc, j->>'poNumber', (j->>'deliveryNo')::int) from items), '[]'::jsonb))
  );
end;
$$;

-- Lưu quyết định đối chiếu (và xác nhận phía người lưu nếu chọn).
create function public.save_receipt_reconciliation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_batch_id uuid := nullif(p_input->>'deliveryBatchId', '')::uuid;
  v_decision text := p_input->>'decision';
  v_remainder text := coalesce(nullif(p_input->>'remainder', ''), 'keep_open');
  v_arrival date := nullif(p_input->>'arrivalDate', '')::date;
  v_reason text := nullif(btrim(coalesce(p_input->>'reason', '')), '');
  v_confirm text := nullif(p_input->>'confirmAs', '');
  v_expected integer := nullif(p_input->>'expectedRevision', '')::integer;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_c record;
  v_b public.purchase_order_delivery_batches%rowtype;
  v_r public.procurement_receipt_reconciliations%rowtype;
  v_before jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_l record;
  v_qty numeric;
  v_given jsonb := coalesce(p_input->'lines', '[]'::jsonb);
  v_diff boolean := false;
  v_shortfall boolean := false;
  v_any boolean := false;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_b from public.purchase_order_delivery_batches where id = v_batch_id for update;
  if not found then raise exception using errcode = '22023', message = 'RECEIPT_RECON_BATCH_CLOSED'; end if;
  select * into v_c from app_private.receipt_recon_candidates() c where c.batch_id = v_batch_id;
  if not found then raise exception using errcode = '22023', message = 'RECEIPT_RECON_BATCH_CLOSED'; end if;
  if not (app_private.receipt_recon_is_buyer() or app_private.receipt_recon_is_keeper(v_c.warehouse_id)) then
    raise exception using errcode = '42501', message = 'RECEIPT_RECON_EDIT_DENIED'; end if;
  if v_confirm = 'buyer' and not app_private.receipt_recon_is_buyer()
     or v_confirm = 'keeper' and not app_private.receipt_recon_is_keeper(v_c.warehouse_id)
     or v_confirm not in ('buyer', 'keeper') then
    raise exception using errcode = '42501', message = 'RECEIPT_RECON_CONFIRM_DENIED'; end if;
  if v_decision is null or v_decision not in ('full', 'partial', 'none') then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_DECISION_INVALID'; end if;
  if v_remainder not in ('keep_open', 'close') then raise exception using errcode = '22023', message = 'RECEIPT_RECON_DECISION_INVALID'; end if;

  if v_decision = 'none' then
    v_arrival := null;
  elsif v_arrival is null or v_arrival > v_today or v_arrival < date '2026-01-01' then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_ARRIVAL_INVALID';
  end if;

  if v_decision <> 'none' then
    if jsonb_typeof(v_given) <> 'array' then raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_INVALID'; end if;
    for v_l in select l.id, coalesce(l.planned_qty, 0) planned, st.stocked_stock_qty, st.stock_factor
      from public.purchase_order_delivery_lines l left join app_private.receipt_recon_stocked(v_batch_id) st on st.delivery_line_id = l.id
      where l.delivery_batch_id = v_batch_id order by l.id
    loop
      if v_decision = 'full' then
        v_qty := v_l.planned;
      else
        select (x->>'receivedQty')::numeric into v_qty from jsonb_array_elements(v_given) x
        where x->>'deliveryLineId' = v_l.id::text limit 1;
        if v_qty is null or v_qty < 0 or v_qty > 1e12 then
          raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_INVALID'; end if;
      end if;
      v_qty := round(v_qty, 6);
      if v_l.stocked_stock_qty is not null and v_qty * v_l.stock_factor < v_l.stocked_stock_qty - 0.000001 then
        raise exception using errcode = '22023', message = 'RECEIPT_RECON_BELOW_STOCKED'; end if;
      v_diff := v_diff or v_qty <> v_l.planned;
      v_shortfall := v_shortfall or v_qty < v_l.planned;
      v_any := v_any or v_qty > 0;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('deliveryLineId', v_l.id, 'receivedQty', v_qty));
    end loop;
    if jsonb_array_length(v_lines) = 0 then raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_INVALID'; end if;
    if v_decision = 'partial' and jsonb_array_length(v_given) <> jsonb_array_length(v_lines) then
      raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_INVALID'; end if;
    if not v_any then raise exception using errcode = '22023', message = 'RECEIPT_RECON_USE_NONE'; end if;
    if v_decision = 'partial' and not v_diff then v_decision := 'full'; end if;
  else
    if v_c.stocked then raise exception using errcode = '22023', message = 'RECEIPT_RECON_BELOW_STOCKED'; end if;
    v_shortfall := true;
  end if;
  if v_decision <> 'full' and v_reason is null then raise exception using errcode = '22023', message = 'RECEIPT_RECON_REASON_REQUIRED'; end if;

  select * into v_r from public.procurement_receipt_reconciliations
  where delivery_batch_id = v_batch_id and status = 'open' for update;
  if v_r.id is null then
    if v_expected is not null then raise exception using errcode = '40001', message = 'RECEIPT_RECON_REVISION_CONFLICT'; end if;
    insert into public.procurement_receipt_reconciliations (delivery_batch_id, purchase_order_id, warehouse_id, wms_transaction_id,
      decision, remainder, arrival_date, lines, reason, created_by, updated_by)
    values (v_batch_id, v_c.purchase_order_id, v_c.warehouse_id, v_c.tx_id, v_decision, v_remainder, v_arrival, v_lines, v_reason, v_actor, v_actor)
    returning * into v_r;
    insert into public.procurement_receipt_reconciliation_events (reconciliation_id, action, actor_id, revision, after)
    values (v_r.id, 'create', v_actor, v_r.revision, app_private.receipt_recon_snapshot(v_r));
  else
    if v_expected is distinct from v_r.revision then raise exception using errcode = '40001', message = 'RECEIPT_RECON_REVISION_CONFLICT'; end if;
    if (v_r.decision, v_r.remainder, v_r.arrival_date, v_r.lines, coalesce(v_r.reason, ''))
       is distinct from (v_decision, v_remainder, v_arrival, v_lines, coalesce(v_reason, '')) then
      v_before := app_private.receipt_recon_snapshot(v_r);
      -- Nội dung đổi: mọi xác nhận trước đó mất hiệu lực.
      update public.procurement_receipt_reconciliations
      set decision = v_decision, remainder = v_remainder, arrival_date = v_arrival, lines = v_lines, reason = v_reason,
        revision = revision + 1, buyer_confirmed_by = null, buyer_confirmed_at = null, keeper_confirmed_by = null, keeper_confirmed_at = null,
        rejection = null, updated_by = v_actor, updated_at = now()
      where id = v_r.id returning * into v_r;
      insert into public.procurement_receipt_reconciliation_events (reconciliation_id, action, actor_id, revision, before, after)
      values (v_r.id, 'save', v_actor, v_r.revision, v_before, app_private.receipt_recon_snapshot(v_r));
    end if;
  end if;

  if v_confirm is not null then
    perform public.confirm_receipt_reconciliation_v1(jsonb_build_object('reconciliationId', v_r.id, 'side', v_confirm, 'revision', v_r.revision));
  end if;
  return app_private.receipt_recon_item(v_batch_id);
end;
$$;

create function public.confirm_receipt_reconciliation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_side text := p_input->>'side';
  v_revoke boolean := coalesce((p_input->>'revoke')::boolean, false);
  v_r public.procurement_receipt_reconciliations%rowtype;
  v_before jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_r from public.procurement_receipt_reconciliations
  where id = nullif(p_input->>'reconciliationId', '')::uuid for update;
  if v_r.id is null or v_r.status <> 'open' then raise exception using errcode = 'PT404', message = 'RECEIPT_RECON_NOT_FOUND'; end if;
  if v_r.revision is distinct from nullif(p_input->>'revision', '')::integer then
    raise exception using errcode = '40001', message = 'RECEIPT_RECON_REVISION_CONFLICT'; end if;
  if not exists (select 1 from app_private.receipt_recon_candidates() c where c.batch_id = v_r.delivery_batch_id) then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_BATCH_CLOSED'; end if;
  if v_side = 'buyer' then
    if not app_private.receipt_recon_is_buyer() then raise exception using errcode = '42501', message = 'RECEIPT_RECON_CONFIRM_DENIED'; end if;
  elsif v_side = 'keeper' then
    if not app_private.receipt_recon_is_keeper(v_r.warehouse_id) then raise exception using errcode = '42501', message = 'RECEIPT_RECON_CONFIRM_DENIED'; end if;
  else
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_CONFIRM_DENIED';
  end if;
  v_before := app_private.receipt_recon_snapshot(v_r);

  if v_revoke then
    -- Chỉ người đã xác nhận (hoặc Admin) được bỏ xác nhận của mình.
    if (case v_side when 'buyer' then v_r.buyer_confirmed_by else v_r.keeper_confirmed_by end) is null then
      return app_private.receipt_recon_item(v_r.delivery_batch_id); end if;
    if (case v_side when 'buyer' then v_r.buyer_confirmed_by else v_r.keeper_confirmed_by end) <> v_actor and not public.is_admin() then
      raise exception using errcode = '42501', message = 'RECEIPT_RECON_CONFIRM_DENIED'; end if;
    if v_side = 'buyer' then
      update public.procurement_receipt_reconciliations set buyer_confirmed_by = null, buyer_confirmed_at = null, updated_by = v_actor, updated_at = now()
      where id = v_r.id returning * into v_r;
    else
      update public.procurement_receipt_reconciliations set keeper_confirmed_by = null, keeper_confirmed_at = null, updated_by = v_actor, updated_at = now()
      where id = v_r.id returning * into v_r;
    end if;
  else
    -- Hai phía phải là hai người khác nhau.
    if (case v_side when 'buyer' then v_r.keeper_confirmed_by else v_r.buyer_confirmed_by end) = v_actor then
      raise exception using errcode = '22023', message = 'RECEIPT_RECON_SAME_PERSON'; end if;
    if (case v_side when 'buyer' then v_r.buyer_confirmed_by else v_r.keeper_confirmed_by end) is not null then
      return app_private.receipt_recon_item(v_r.delivery_batch_id); end if;
    if v_side = 'buyer' then
      -- Phía đã từ chối nay đồng ý thì lời từ chối hết hiệu lực.
      update public.procurement_receipt_reconciliations set buyer_confirmed_by = v_actor, buyer_confirmed_at = now(),
        rejection = case when rejection->>'side' = 'buyer' then null else rejection end
      where id = v_r.id returning * into v_r;
    else
      update public.procurement_receipt_reconciliations set keeper_confirmed_by = v_actor, keeper_confirmed_at = now(),
        rejection = case when rejection->>'side' = 'keeper' then null else rejection end
      where id = v_r.id returning * into v_r;
    end if;
  end if;
  insert into public.procurement_receipt_reconciliation_events (reconciliation_id, action, actor_id, revision, before, after)
  values (v_r.id, (case when v_revoke then 'revoke_' else 'confirm_' end) || v_side, v_actor, v_r.revision, v_before, app_private.receipt_recon_snapshot(v_r));
  return app_private.receipt_recon_item(v_r.delivery_batch_id);
end;
$$;

-- Phía chưa xác nhận không đồng ý: gỡ xác nhận phía kia, ghi lý do để người lập sửa lại.
create function public.reject_receipt_reconciliation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_side text := p_input->>'side';
  v_reason text := nullif(btrim(coalesce(p_input->>'reason', '')), '');
  v_r public.procurement_receipt_reconciliations%rowtype;
  v_before jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'RECEIPT_RECON_REJECT_REASON_REQUIRED'; end if;
  select * into v_r from public.procurement_receipt_reconciliations
  where id = nullif(p_input->>'reconciliationId', '')::uuid for update;
  if v_r.id is null or v_r.status <> 'open' then raise exception using errcode = 'PT404', message = 'RECEIPT_RECON_NOT_FOUND'; end if;
  if v_r.revision is distinct from nullif(p_input->>'revision', '')::integer then
    raise exception using errcode = '40001', message = 'RECEIPT_RECON_REVISION_CONFLICT'; end if;
  if v_side = 'buyer' then
    if not app_private.receipt_recon_is_buyer() then raise exception using errcode = '42501', message = 'RECEIPT_RECON_CONFIRM_DENIED'; end if;
    if v_r.keeper_confirmed_by is null or v_r.buyer_confirmed_by is not null then
      raise exception using errcode = '22023', message = 'RECEIPT_RECON_NOTHING_TO_REJECT'; end if;
  elsif v_side = 'keeper' then
    if not app_private.receipt_recon_is_keeper(v_r.warehouse_id) then raise exception using errcode = '42501', message = 'RECEIPT_RECON_CONFIRM_DENIED'; end if;
    if v_r.buyer_confirmed_by is null or v_r.keeper_confirmed_by is not null then
      raise exception using errcode = '22023', message = 'RECEIPT_RECON_NOTHING_TO_REJECT'; end if;
  else
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_CONFIRM_DENIED';
  end if;
  if (case v_side when 'buyer' then v_r.keeper_confirmed_by else v_r.buyer_confirmed_by end) = v_actor then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_SAME_PERSON'; end if;
  v_before := app_private.receipt_recon_snapshot(v_r);
  update public.procurement_receipt_reconciliations
  set buyer_confirmed_by = null, buyer_confirmed_at = null, keeper_confirmed_by = null, keeper_confirmed_at = null,
    rejection = jsonb_build_object('side', v_side, 'byId', v_actor, 'byName', (select name from public.users where id = v_actor),
      'at', now(), 'reason', v_reason),
    updated_by = v_actor, updated_at = now()
  where id = v_r.id returning * into v_r;
  insert into public.procurement_receipt_reconciliation_events (reconciliation_id, action, actor_id, revision, before, after, note)
  values (v_r.id, 'reject_' || v_side, v_actor, v_r.revision, v_before, app_private.receipt_recon_snapshot(v_r), v_reason);
  return app_private.receipt_recon_item(v_r.delivery_batch_id);
end;
$$;

-- Ghi sổ một đợt đã đủ 2 xác nhận.
create function public.post_receipt_reconciliation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_r public.procurement_receipt_reconciliations%rowtype;
  v_po public.purchase_orders%rowtype;
  v_b public.purchase_order_delivery_batches%rowtype;
  v_tx public.transactions%rowtype;
  v_l public.purchase_order_delivery_lines%rowtype;
  v_line jsonb;
  v_qty numeric;
  v_factor numeric;
  v_stocked numeric;
  v_is_stocked boolean;
  v_items jsonb := '[]'::jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_extra_tx text;
  v_arrival_ts timestamptz;
  v_gross numeric := 0;
  v_planned_total numeric := 0;
  v_accepted_total numeric := 0;
  v_next_items jsonb;
  v_delivered boolean;
  v_before jsonb;
  v_ap_id uuid;
  v_short numeric;
  v_closed boolean := false;
  v_note text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_r from public.procurement_receipt_reconciliations
  where id = nullif(p_input->>'reconciliationId', '')::uuid for update;
  if v_r.id is null or v_r.status <> 'open' then raise exception using errcode = 'PT404', message = 'RECEIPT_RECON_NOT_FOUND'; end if;
  if v_r.revision is distinct from nullif(p_input->>'revision', '')::integer then
    raise exception using errcode = '40001', message = 'RECEIPT_RECON_REVISION_CONFLICT'; end if;
  if v_r.buyer_confirmed_by is null or v_r.keeper_confirmed_by is null then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_NOT_CONFIRMED'; end if;
  if not app_private.receipt_recon_is_keeper(v_r.warehouse_id) then
    raise exception using errcode = '42501', message = 'RECEIPT_RECON_POST_DENIED'; end if;

  select * into v_po from public.purchase_orders where id = v_r.purchase_order_id for update;
  select * into v_b from public.purchase_order_delivery_batches where id = v_r.delivery_batch_id for update;
  select * into v_tx from public.transactions where id = v_b.wms_transaction_id for update;
  if v_b.wms_transaction_id is distinct from v_r.wms_transaction_id
     or v_b.status not in ('wms_pending', 'receiving', 'quality_approved')
     or v_tx.status::text not in ('PENDING', 'APPROVED', 'COMPLETED')
     or v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_BATCH_CLOSED'; end if;
  v_is_stocked := v_tx.status::text = 'COMPLETED';
  if v_is_stocked and v_r.decision = 'none' then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_BELOW_STOCKED'; end if;
  v_before := jsonb_build_object('batchStatus', v_b.status, 'txStatus', v_tx.status::text, 'txDate', v_tx.date, 'poStatus', v_po.status,
    'qualityApprovedBy', v_b.quality_approved_by, 'acceptedGross', v_b.accepted_gross_amount,
    'lines', (select jsonb_agg(jsonb_build_object('deliveryLineId', l.id, 'acceptedQty', l.accepted_qty) order by l.id)
      from public.purchase_order_delivery_lines l where l.delivery_batch_id = v_b.id));
  v_note := 'Đối chiếu nhận hàng: ' || case v_r.decision when 'none' then 'hàng không về — ' || v_r.reason
    else 'về ' || to_char(v_r.arrival_date, 'DD/MM/YYYY') || coalesce(' — ' || v_r.reason, '') end;
  v_arrival_ts := (v_r.arrival_date + time '12:00') at time zone 'Asia/Ho_Chi_Minh';

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);

  if v_r.decision = 'none' then
    update public.purchase_order_delivery_batches
    set status = 'cancelled', note = concat_ws(E'\n', nullif(note, ''), v_note), updated_at = now()
    where id = v_b.id;
    update public.purchase_order_delivery_lines set accepted_qty = 0, accepted_stock_qty = 0
    where delivery_batch_id = v_b.id and coalesce(accepted_qty, 0) <> 0;
    update public.transactions
    set status = 'CANCELLED'::public.transaction_status, note = concat_ws(E'\n', nullif(note, ''), v_note), updated_by = v_actor
    where id = v_tx.id;
  else
    if (select count(*) from public.purchase_order_delivery_lines where delivery_batch_id = v_b.id) <> jsonb_array_length(v_r.lines) then
      raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_CHANGED'; end if;
    for v_line in select value from jsonb_array_elements(v_r.lines) loop
      select * into v_l from public.purchase_order_delivery_lines
      where id = (v_line->>'deliveryLineId')::uuid and delivery_batch_id = v_b.id for update;
      if v_l.id is null then raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_CHANGED'; end if;
      v_qty := (v_line->>'receivedQty')::numeric;
      v_factor := case when coalesce(v_l.planned_qty, 0) > 0 and coalesce(v_l.stock_planned_qty, 0) > 0
        then v_l.stock_planned_qty / v_l.planned_qty else 1 end;
      update public.purchase_order_delivery_lines
      set accepted_qty = v_qty, accepted_stock_qty = round(v_qty * v_factor, 6), updated_at = now()
      where id = v_l.id;
      v_gross := v_gross + v_qty * coalesce(v_l.delivery_unit_price, 0) * (1 + coalesce(v_b.vat_rate, 0) / 100);
      v_planned_total := v_planned_total + coalesce(v_l.planned_qty, 0);
      v_accepted_total := v_accepted_total + v_qty;
      v_line := jsonb_build_object(
        'itemId', v_l.item_id, 'quantity', round(v_qty * v_factor, 6),
        'orderedQty', coalesce(v_l.stock_planned_qty, v_l.planned_qty, 0),
        'price', case when v_factor > 0 then coalesce(v_l.delivery_unit_price, 0) / v_factor else coalesce(v_l.delivery_unit_price, 0) end,
        'accountingQty', v_qty, 'accountingUnit', coalesce(v_l.unit, v_l.stock_unit, ''),
        'accountingPrice', coalesce(v_l.delivery_unit_price, 0),
        'varianceQty', v_qty - coalesce(v_l.planned_qty, 0),
        'varianceReason', case when v_qty <> coalesce(v_l.planned_qty, 0) then v_r.reason end,
        'purchaseOrderLineId', v_l.purchase_order_line_id, 'purchaseOrderDeliveryBatchId', v_b.id,
        'purchaseOrderDeliveryLineId', v_l.id, 'fulfillmentMode', coalesce(v_b.fulfillment_mode, 'RECEIVE_TO_STOCK'));
      v_items := v_items || jsonb_build_array(v_line);
      if v_is_stocked then
        select st.stocked_stock_qty into v_stocked from app_private.receipt_recon_stocked(v_b.id) st where st.delivery_line_id = v_l.id;
        if round(v_qty * v_factor, 6) < coalesce(v_stocked, 0) - 0.000001 then
          raise exception using errcode = '22023', message = 'RECEIPT_RECON_BELOW_STOCKED'; end if;
        if round(v_qty * v_factor, 6) > coalesce(v_stocked, 0) + 0.000001 then
          v_extra := v_extra || jsonb_build_array(v_line || jsonb_build_object('quantity', round(v_qty * v_factor - coalesce(v_stocked, 0), 6),
            'accountingQty', round(v_qty - coalesce(v_stocked, 0) / v_factor, 6), 'reconciliationId', v_r.id));
        end if;
      end if;
    end loop;

    if not v_is_stocked then
      -- Kiểm SL/CL theo số đã chốt rồi nhập kho — một lần, theo ngày hàng về.
      update public.transactions
      set items = v_items, status = 'APPROVED'::public.transaction_status, date = v_arrival_ts,
        approver_id = v_r.keeper_confirmed_by, approved_at = now(), note = concat_ws(E'\n', nullif(note, ''), v_note)
      where id = v_tx.id;
      update public.purchase_order_delivery_batches
      set status = 'quality_approved', quality_result = case when v_r.decision = 'full' then 'passed' else 'partial' end,
        variance_reason = case when v_r.decision = 'partial' then v_r.reason end,
        quality_approved_by = v_r.keeper_confirmed_by, quality_approved_at = now(),
        accepted_gross_amount = round(v_gross, 2), updated_at = now()
      where id = v_b.id;
      perform app_private.finalize_purchase_receipt_v2(v_b.id, v_tx.id, v_actor);
    else
      -- Kho đã nhập phiếu gốc: chỉ nhập bổ sung phần còn thiếu, phiếu riêng theo ngày hàng về.
      if jsonb_array_length(v_extra) > 0 then
        v_extra_tx := 'tx-recon-' || replace(v_r.id::text, '-', '');
        for v_line in select value from jsonb_array_elements(v_extra) loop
          perform public.apply_stock_change(v_line->>'itemId', v_tx.target_warehouse_id, (v_line->>'quantity')::numeric);
        end loop;
        insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, approver_id, approved_at, status, note,
          source_type, source_id, business_event_type, business_event_reason, related_request_id)
        values (v_extra_tx, 'IMPORT', v_arrival_ts, v_extra, v_tx.target_warehouse_id, v_actor, v_r.keeper_confirmed_by, now(),
          'COMPLETED', coalesce(v_po.po_number, v_po.id) || ' - đợt ' || coalesce(v_b.delivery_no::text, '') || ' — nhập bổ sung phần kho chưa ghi. ' || v_note,
          'receipt_reconciliation', v_r.id::text, 'request_po_receipt', 'Đối chiếu nhận hàng: nhập bổ sung', v_tx.related_request_id);
      end if;
      update public.purchase_order_delivery_batches
      set quality_result = case when v_r.decision = 'full' then 'passed' else 'partial' end,
        variance_reason = case when v_r.decision = 'partial' then v_r.reason end,
        quality_approved_by = coalesce(quality_approved_by, v_r.keeper_confirmed_by), quality_approved_at = coalesce(quality_approved_at, now()),
        accepted_gross_amount = round(v_gross, 2), updated_at = now()
      where id = v_b.id;
      -- Ghi nhận PO như finalize (không cộng kho lần nữa); công nợ tự ghi khi đợt chuyển sang đã nhận.
      update public.purchase_order_delivery_batches
      set status = case when v_accepted_total > v_planned_total then 'received_over'
          when v_accepted_total < v_planned_total then 'received_short' else 'received' end,
        received_by = v_actor, received_at = now(), updated_at = now()
      where id = v_b.id;
      with receipt_by_line as (
        select purchase_order_line_id, sum(coalesce(accepted_qty, 0)) accepted
        from public.purchase_order_delivery_lines where delivery_batch_id = v_b.id group by purchase_order_line_id
      ), rows as (
        select case when coalesce(r.accepted, 0) > 0
            then jsonb_set(it.value, '{receivedQty}', to_jsonb(coalesce(nullif(it.value->>'receivedQty', '')::numeric, 0) + r.accepted), true)
            else it.value end item, it.ordinality
        from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality it(value, ordinality)
        left join receipt_by_line r on r.purchase_order_line_id = coalesce(it.value->>'lineId', it.value->>'line_id', it.value->>'itemId', it.value->>'item_id')
      )
      select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) into v_next_items from rows;
      select coalesce(bool_and(coalesce(nullif(x->>'receivedQty', '')::numeric, 0) >= coalesce(nullif(x->>'qty', '')::numeric, 0)), false)
      into v_delivered from jsonb_array_elements(v_next_items) x;
      update public.purchase_orders
      set items = v_next_items, status = case when v_delivered then 'delivered' else 'partial' end,
        received_transaction_ids = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(
          coalesce(received_transaction_ids, '[]'::jsonb) || jsonb_build_array(v_tx.id) || coalesce(to_jsonb(v_extra_tx), '[]'::jsonb)) x
          where jsonb_typeof(x) = 'string')
      where id = v_po.id;
      update public.material_request_fulfillment_lines mfl
      set received_qty = coalesce(line.accepted_stock_qty, line.accepted_qty, 0), updated_at = now()
      from public.purchase_order_delivery_lines line
      where mfl.po_delivery_line_id = line.id and line.delivery_batch_id = v_b.id;
    end if;

    -- Chứng từ tài chính theo ngày hàng về; công nợ gắn nhãn nguồn để kế toán đối chiếu hóa đơn/thanh toán.
    update public.supplier_payable_documents
    set document_date = v_r.arrival_date,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('origin', 'receipt_reconciliation',
        'reconciliationId', v_r.id, 'arrivalDate', v_r.arrival_date, 'recordedAt', now())
    where source_type = 'purchase_delivery_receipt' and source_id = v_b.id::text
    returning id into v_ap_id;
    update public.project_transactions set date = v_r.arrival_date::text
    where source_ref = 'purchase_receipt:' || v_b.id::text;
    update public.purchase_orders set actual_delivery_date = v_r.arrival_date::text
    where id = v_po.id and status = 'delivered';
  end if;

  if v_r.remainder = 'close' then
    if app_private.procurement_po_has_open_delivery(v_po.id) then
      raise exception using errcode = '22023', message = 'RECEIPT_RECON_REMAINDER_OPEN'; end if;
    select * into v_po from public.purchase_orders where id = v_po.id for update;
    if v_po.status in ('confirmed', 'in_transit', 'partial') then
      -- Như "Kết thúc thiếu" của Mua hàng: nhu cầu chỉ giữ phần thực nhận, phần còn lại về Cần mua.
      select coalesce(sum(greatest(q.ordered_qty - app_private.procurement_link_received(v_po.id, v_po.items, q.line_id, q.ordered_qty), 0)), 0)
      into v_short from (
        select purchase_order_line_id line_id, ordered_qty from public.purchase_order_request_lines where purchase_order_id = v_po.id
        union all select purchase_order_line_id, ordered_qty from public.procurement_po_plan_links where purchase_order_id = v_po.id) q;
      update public.purchase_order_request_lines l
      set ordered_qty = r.received, ordered_stock_qty_snapshot = r.received
      from (select id, round(app_private.procurement_link_received(v_po.id, v_po.items, purchase_order_line_id, ordered_qty), 6) received
            from public.purchase_order_request_lines where purchase_order_id = v_po.id) r
      where l.id = r.id;
      delete from public.procurement_po_plan_links k
      where k.purchase_order_id = v_po.id and app_private.procurement_link_received(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty) <= 0;
      update public.procurement_po_plan_links k
      set ordered_qty = round(app_private.procurement_link_received(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty), 6)
      where k.purchase_order_id = v_po.id;
      update public.purchase_orders
      set status = 'closed', closed_need_qty = coalesce(closed_need_qty, 0) + v_short,
        last_action_by = v_actor::text, last_action_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('shortClose', jsonb_build_object('reason', v_r.reason, 'returnToNeed', true,
          'shortStockQty', round(v_short, 3), 'at', now(), 'by', (select name from public.users where id = v_actor),
          'via', 'receipt_reconciliation', 'reconciliationId', v_r.id,
          'lines', (select jsonb_agg(jsonb_build_object('lineId', coalesce(x->>'lineId', x->>'itemId'), 'name', x->>'name',
            'qty', x->'qty', 'receivedQty', coalesce(x->'receivedQty', '0'::jsonb))) from jsonb_array_elements(v_po.items) x)))
      where id = v_po.id;
      insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
      values ('purchase_order', v_po.id, 'close_short', v_actor, v_r.reason,
        jsonb_build_object('returnToNeed', true, 'shortStockQty', v_short, 'via', 'receipt_reconciliation', 'reconciliationId', v_r.id));
      v_closed := true;
    end if;
  end if;

  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'receipt_reconciled', v_actor, v_r.reason, jsonb_build_object('deliveryNo', v_b.delivery_no,
    'decision', v_r.decision, 'arrivalDate', v_r.arrival_date, 'reconciliationId', v_r.id));

  select * into v_b from public.purchase_order_delivery_batches where id = v_b.id;
  select * into v_po from public.purchase_orders where id = v_po.id;
  update public.procurement_receipt_reconciliations
  set status = 'posted', posted_by = v_actor, posted_at = now(),
    result = jsonb_build_object('batchStatus', v_b.status, 'poStatus', v_po.status, 'acceptedGross', v_b.accepted_gross_amount,
      'payableId', v_ap_id, 'closedShort', v_closed)
  where id = v_r.id returning * into v_r;
  insert into public.procurement_receipt_reconciliation_events (reconciliation_id, action, actor_id, revision, before, after)
  values (v_r.id, 'post', v_actor, v_r.revision, v_before, v_r.result);

  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return app_private.receipt_recon_item(v_b.id);
end;
$$;

revoke all on function app_private.trg_receipt_recon_events_immutable(), app_private.receipt_recon_candidates(),
  app_private.receipt_recon_stocked(uuid),
  app_private.receipt_recon_is_buyer(), app_private.receipt_recon_is_keeper(text),
  app_private.receipt_recon_snapshot(public.procurement_receipt_reconciliations), app_private.receipt_recon_item(uuid)
  from public, anon, authenticated;
revoke all on function public.list_receipt_reconciliations_v1(jsonb), public.save_receipt_reconciliation_v1(jsonb),
  public.confirm_receipt_reconciliation_v1(jsonb), public.reject_receipt_reconciliation_v1(jsonb), public.post_receipt_reconciliation_v1(jsonb) from public, anon;
grant execute on function public.list_receipt_reconciliations_v1(jsonb), public.save_receipt_reconciliation_v1(jsonb),
  public.confirm_receipt_reconciliation_v1(jsonb), public.reject_receipt_reconciliation_v1(jsonb), public.post_receipt_reconciliation_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';

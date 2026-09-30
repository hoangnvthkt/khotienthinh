-- Kho & Công nợ — K5: Kiểm kê có duyệt (chủ sản phẩm yêu cầu 30/09/2026).
--
-- Dựng trên bảng G6 (wms_inventory_counts / wms_inventory_count_lines, chưa từng dùng):
-- * Lập phiên: chụp tồn SỔ KHO (inventory_balances) + tồn danh mục (để truy vết lệch cũ). Không chặn khi hai số lệch.
-- * Đếm (lưu dần, nhiều người), mặc định ĐẾM MÙ: người đếm không thấy số sổ. Thêm dòng cho hàng có thật ngoài sổ.
-- * Nộp: mọi dòng có số đếm; chênh lệch chốt = số đếm − tồn sổ lúc nộp. Sau khi nộp (đã thấy chênh lệch),
--   người đếm giải trình nguyên nhân từng dòng chênh; người duyệt chỉ duyệt khi mọi dòng chênh có nguyên nhân hợp chiều.
-- * Duyệt (Admin / quản trị kho, khác người lập và người nộp): ghi sổ —
--     thiếu do "đã dùng thi công chưa lập phiếu" → phiếu XUẤT DÙNG vào dự án; còn lại → phiếu ĐIỀU CHỈNH;
--     giá trị theo đơn giá bình quân; sau đó đồng bộ tồn danh mục = tồn sổ kho.
--   Từ chối (lý do) → quay lại đang đếm. Hủy phiên (lý do) khi chưa ghi sổ.
-- * Nhật ký bất biến. Đóng lối tắt G6 (đếm xong tự ghi sổ) và đọc trực tiếp bảng dòng (để giữ đếm mù).

alter table public.wms_inventory_counts drop constraint wms_inventory_counts_status_check;
alter table public.wms_inventory_counts
  add constraint wms_inventory_counts_status_check check (status in ('counting', 'submitted', 'posted', 'cancelled')),
  add column blind boolean not null default true,
  add column submitted_by uuid references public.users(id),
  add column submitted_at timestamptz,
  add column rejection jsonb,
  add column cancelled_by uuid references public.users(id),
  add column cancelled_at timestamptz,
  add column cancel_reason text,
  add column issue_transaction_id text references public.transactions(id),
  add column metadata jsonb not null default '{}'::jsonb;

alter table public.wms_inventory_count_lines
  add column cache_qty_at_snapshot numeric(18,6),
  add column variance_reason text check (variance_reason in ('NATURAL_LOSS', 'DAMAGE', 'THEFT', 'MEASUREMENT', 'EXPIRED', 'PROCESS_WASTE',
    'UNRECORDED_ISSUE', 'RECORDING_ERROR', 'UNRECORDED_RECEIPT', 'RETURNED_FROM_SITE')),
  add column counted_by uuid references public.users(id),
  add column counted_at timestamptz,
  add column unit_cost numeric(18,4),
  add column added_during_count boolean not null default false;

create table public.wms_inventory_count_events (
  id bigint generated always as identity primary key,
  inventory_count_id uuid not null references public.wms_inventory_counts(id),
  action text not null check (action in ('start', 'add_item', 'save', 'submit', 'reject', 'approve', 'cancel')),
  actor_id uuid references public.users(id),
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index wms_inventory_count_events_idx on public.wms_inventory_count_events (inventory_count_id, id);
alter table public.wms_inventory_count_events enable row level security;
revoke all on public.wms_inventory_count_events from public, anon, authenticated;
create trigger trg_wms_inventory_count_events_immutable
  before update or delete on public.wms_inventory_count_events
  for each row execute function app_private.trg_receipt_recon_events_immutable();

-- Đếm mù: số sổ chỉ đọc qua RPC; lối tắt G6 (chốt không duyệt) đóng lại.
revoke select on public.wms_inventory_count_lines from authenticated;
revoke execute on function public.start_wms_inventory_count_v1(text, text[], text, text) from authenticated;
revoke execute on function public.post_wms_inventory_count_v1(uuid, jsonb, bigint, text) from authenticated;

create function app_private.stock_count_can_count(p_warehouse_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and (public.is_admin() or public.is_module_admin('WMS')
    or public.current_app_user_id() in (select app_private.wms_warehouse_keepers(p_warehouse_id))
    or app_private.wms_has_action('wms.inventory.edit', p_warehouse_id, p_warehouse_id));
$$;

create function app_private.stock_count_can_approve()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and (public.is_admin() or public.is_module_admin('WMS'));
$$;

create function app_private.stock_count_ledger_qty(p_item_id text, p_warehouse_id text)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(b.on_hand_qty) from public.inventory_balances b
    where b.material_id = p_item_id and b.warehouse_id = p_warehouse_id), 0);
$$;

create function app_private.stock_count_unit_cost(p_item_id text, p_warehouse_id text)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select case when sum(b.on_hand_qty) > 0 then sum(b.total_value) / sum(b.on_hand_qty) end
      from public.inventory_balances b where b.material_id = p_item_id and b.warehouse_id = p_warehouse_id),
    (select nullif(i.price_in, 0) from public.items i where i.id = p_item_id), 0);
$$;

create function app_private.stock_count_log(p_count_id uuid, p_action text, p_note text, p_payload jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.wms_inventory_count_events (inventory_count_id, action, actor_id, note, payload)
  values (p_count_id, p_action, public.current_app_user_id(), p_note, coalesce(p_payload, '{}'::jsonb));
$$;

-- Một phiên kiểm kê đầy đủ cho người xem (ẩn số sổ khi đếm mù và người xem không phải người duyệt).
create function app_private.stock_count_detail(p_count_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_c public.wms_inventory_counts%rowtype;
  v_approver boolean := app_private.stock_count_can_approve();
  v_counter boolean;
  v_show boolean;
begin
  select * into v_c from public.wms_inventory_counts where id = p_count_id;
  if not found then return null; end if;
  v_counter := app_private.stock_count_can_count(v_c.warehouse_id);
  v_show := not v_c.blind or v_c.status <> 'counting' or v_approver;
  return jsonb_build_object(
    'id', v_c.id, 'countNo', v_c.count_no, 'warehouseId', v_c.warehouse_id,
    'warehouseName', (select name from public.warehouses where id = v_c.warehouse_id),
    'status', v_c.status, 'reason', v_c.reason, 'blind', v_c.blind, 'revision', v_c.row_version,
    'snapshotAt', v_c.snapshot_at, 'createdAt', v_c.created_at,
    'createdBy', jsonb_build_object('id', v_c.created_by, 'name', (select name from public.users where id = v_c.created_by)),
    'submittedBy', case when v_c.submitted_by is not null then jsonb_build_object('id', v_c.submitted_by,
      'name', (select name from public.users where id = v_c.submitted_by), 'at', v_c.submitted_at) end,
    'approvedBy', case when v_c.approved_by is not null and v_c.status = 'posted' then jsonb_build_object('id', v_c.approved_by,
      'name', (select name from public.users where id = v_c.approved_by), 'at', v_c.posted_at) end,
    'cancelled', case when v_c.status = 'cancelled' then jsonb_build_object('name', (select name from public.users where id = v_c.cancelled_by),
      'at', v_c.cancelled_at, 'reason', v_c.cancel_reason) end,
    'rejection', v_c.rejection, 'metadata', v_c.metadata,
    'adjustmentTransactionId', v_c.adjustment_transaction_id, 'issueTransactionId', v_c.issue_transaction_id,
    'systemVisible', v_show,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'itemId', l.item_id, 'name', coalesce(i.name, l.item_id), 'sku', i.sku, 'unit', coalesce(l.unit, i.unit),
        'snapshotQty', case when v_show then l.snapshot_qty end,
        'cacheQtyAtSnapshot', case when v_show then l.cache_qty_at_snapshot end,
        'expectedQty', case when v_show then l.expected_qty_at_post end,
        'countedQty', l.counted_qty, 'varianceQty', case when v_show then l.variance_qty end,
        'varianceReason', l.variance_reason, 'note', l.note, 'unitCost', case when v_show then l.unit_cost end,
        'countedBy', (select name from public.users where id = l.counted_by), 'countedAt', l.counted_at,
        'addedDuringCount', l.added_during_count) order by coalesce(i.name, l.item_id)), '[]'::jsonb)
      from public.wms_inventory_count_lines l left join public.items i on i.id = l.item_id
      where l.inventory_count_id = v_c.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'actorName', u.name, 'at', e.created_at,
        'note', e.note, 'payload', e.payload) order by e.id), '[]'::jsonb)
      from public.wms_inventory_count_events e left join public.users u on u.id = e.actor_id where e.inventory_count_id = v_c.id),
    'can', jsonb_build_object(
      'count', v_c.status = 'counting' and v_counter,
      'explain', v_c.status = 'submitted' and v_counter,
      'submit', v_c.status = 'counting' and v_counter,
      'approve', v_c.status = 'submitted' and v_approver and v_actor is distinct from v_c.created_by and v_actor is distinct from v_c.submitted_by,
      'reject', v_c.status = 'submitted' and v_approver and v_actor is distinct from v_c.submitted_by,
      'cancel', v_c.status in ('counting', 'submitted') and (v_actor = v_c.created_by or v_approver))
  );
end;
$$;

create function public.list_stock_counts_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_all boolean;
  v_wh text := nullif(p_filter->>'warehouseId', '');
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  v_all := public.is_admin() or public.is_module_admin('WMS');
  return jsonb_build_object(
    'canApprove', app_private.stock_count_can_approve(),
    'warehouses', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name,
        'openDocs', (select count(*) from public.transactions t where t.status::text in ('PENDING', 'APPROVED')
          and (t.target_warehouse_id = w.id or t.source_warehouse_id = w.id)),
        'openReconciliations', (select count(*) from app_private.receipt_recon_candidates() c where c.warehouse_id = w.id and c.age_days >= 3))
        order by w.name), '[]'::jsonb)
      from public.warehouses w where coalesce(w.is_archived, false) = false and app_private.stock_count_can_count(w.id)),
    'counts', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'countNo', c.count_no, 'warehouseId', c.warehouse_id,
        'warehouseName', w.name, 'status', c.status, 'reason', c.reason, 'blind', c.blind, 'createdAt', c.created_at,
        'createdByName', (select name from public.users where id = c.created_by), 'submittedAt', c.submitted_at, 'postedAt', c.posted_at,
        'rejected', c.rejection is not null,
        'lineCount', (select count(*) from public.wms_inventory_count_lines l where l.inventory_count_id = c.id),
        'countedCount', (select count(*) from public.wms_inventory_count_lines l where l.inventory_count_id = c.id and l.counted_qty is not null),
        'varianceCount', case when c.status in ('submitted', 'posted') then (select count(*) from public.wms_inventory_count_lines l
          where l.inventory_count_id = c.id and coalesce(l.variance_qty, 0) <> 0) end,
        'varianceValue', case when c.status in ('submitted', 'posted') then (select coalesce(sum(l.variance_qty * coalesce(l.unit_cost, 0)), 0)
          from public.wms_inventory_count_lines l where l.inventory_count_id = c.id) end)
        order by (c.status in ('counting', 'submitted')) desc, c.created_at desc), '[]'::jsonb)
      from public.wms_inventory_counts c join public.warehouses w on w.id = c.warehouse_id
      where (v_wh is null or c.warehouse_id = v_wh) and (v_all or app_private.stock_count_can_count(c.warehouse_id))
        and (c.status in ('counting', 'submitted') or c.created_at > now() - interval '365 days'))
  );
end;
$$;

create function public.get_stock_count_v1(p_count_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c public.wms_inventory_counts%rowtype;
begin
  select * into v_c from public.wms_inventory_counts where id = p_count_id;
  if not found or not (app_private.stock_count_can_count(v_c.warehouse_id) or app_private.stock_count_can_approve()) then
    raise exception using errcode = 'PT404', message = 'STOCK_COUNT_NOT_FOUND'; end if;
  return app_private.stock_count_detail(p_count_id);
end;
$$;

create function public.start_stock_count_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_wh text := nullif(p_input->>'warehouseId', '');
  v_reason text := nullif(btrim(coalesce(p_input->>'reason', '')), '');
  v_items text[] := case when jsonb_typeof(p_input->'itemIds') = 'array'
    then array(select jsonb_array_elements_text(p_input->'itemIds')) end;
  v_c public.wms_inventory_counts%rowtype;
  v_open_docs integer;
  v_open_recon integer;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_wh is null or v_reason is null then raise exception using errcode = '22023', message = 'STOCK_COUNT_WAREHOUSE_REASON_REQUIRED'; end if;
  if not app_private.stock_count_can_count(v_wh) then raise exception using errcode = '42501', message = 'STOCK_COUNT_DENIED'; end if;
  if exists (select 1 from public.wms_inventory_counts where warehouse_id = v_wh and status in ('counting', 'submitted')) then
    raise exception using errcode = '22023', message = 'STOCK_COUNT_ALREADY_OPEN'; end if;
  select count(*) into v_open_docs from public.transactions t
  where t.status::text in ('PENDING', 'APPROVED') and (t.target_warehouse_id = v_wh or t.source_warehouse_id = v_wh);
  select count(*) into v_open_recon from app_private.receipt_recon_candidates() c where c.warehouse_id = v_wh and c.age_days >= 3;

  insert into public.wms_inventory_counts (count_no, warehouse_id, reason, created_by, blind, metadata)
  values ('KK-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5)),
    v_wh, v_reason, v_actor, coalesce((p_input->>'blind')::boolean, true),
    jsonb_build_object('openDocsAtStart', v_open_docs, 'openReconciliationsAtStart', v_open_recon,
      'scope', case when v_items is null then 'full' else 'partial' end))
  returning * into v_c;

  insert into public.wms_inventory_count_lines (inventory_count_id, item_id, unit, snapshot_qty, cache_qty_at_snapshot)
  select v_c.id, i.id, i.unit, greatest(app_private.stock_count_ledger_qty(i.id, v_wh), 0),
    case when i.stock_by_warehouse ? v_wh then (i.stock_by_warehouse->>v_wh)::numeric end
  from public.items i
  where (v_items is not null and i.id = any(v_items))
     or (v_items is null and (i.stock_by_warehouse ? v_wh
       or exists (select 1 from public.inventory_balances b where b.material_id = i.id and b.warehouse_id = v_wh)))
  order by i.id;
  if not found then raise exception using errcode = '22023', message = 'STOCK_COUNT_ITEMS_REQUIRED'; end if;

  perform app_private.stock_count_log(v_c.id, 'start', v_reason, v_c.metadata || jsonb_build_object('blind', v_c.blind,
    'lines', (select count(*) from public.wms_inventory_count_lines where inventory_count_id = v_c.id)));
  return app_private.stock_count_detail(v_c.id);
end;
$$;

-- Hàng có thật nhưng chưa có trong phiên (ngoài sổ): thêm dòng khi đang đếm.
create function public.add_stock_count_item_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c public.wms_inventory_counts%rowtype;
  v_item text := nullif(p_input->>'itemId', '');
begin
  select * into v_c from public.wms_inventory_counts where id = nullif(p_input->>'countId', '')::uuid for update;
  if not found or v_c.status <> 'counting' then raise exception using errcode = '22023', message = 'STOCK_COUNT_NOT_COUNTING'; end if;
  if not app_private.stock_count_can_count(v_c.warehouse_id) then raise exception using errcode = '42501', message = 'STOCK_COUNT_DENIED'; end if;
  if not exists (select 1 from public.items where id = v_item) then raise exception using errcode = '22023', message = 'STOCK_COUNT_ITEM_INVALID'; end if;
  if exists (select 1 from public.wms_inventory_count_lines where inventory_count_id = v_c.id and item_id = v_item) then
    return app_private.stock_count_detail(v_c.id); end if;
  insert into public.wms_inventory_count_lines (inventory_count_id, item_id, unit, snapshot_qty, cache_qty_at_snapshot, added_during_count)
  select v_c.id, i.id, i.unit, greatest(app_private.stock_count_ledger_qty(i.id, v_c.warehouse_id), 0),
    case when i.stock_by_warehouse ? v_c.warehouse_id then (i.stock_by_warehouse->>v_c.warehouse_id)::numeric end, true
  from public.items i where i.id = v_item;
  update public.wms_inventory_counts set row_version = row_version + 1, updated_at = now() where id = v_c.id;
  perform app_private.stock_count_log(v_c.id, 'add_item', null, jsonb_build_object('itemId', v_item));
  return app_private.stock_count_detail(v_c.id);
end;
$$;

-- Lưu dần số đếm / nguyên nhân / ghi chú (không cần đủ dòng).
create function public.save_stock_count_lines_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_c public.wms_inventory_counts%rowtype;
  v_line jsonb;
  v_qty numeric;
  v_n integer := 0;
begin
  select * into v_c from public.wms_inventory_counts where id = nullif(p_input->>'countId', '')::uuid for update;
  if not found or v_c.status not in ('counting', 'submitted') then raise exception using errcode = '22023', message = 'STOCK_COUNT_NOT_COUNTING'; end if;
  if not app_private.stock_count_can_count(v_c.warehouse_id) then raise exception using errcode = '42501', message = 'STOCK_COUNT_DENIED'; end if;
  -- Đã nộp: số đếm khóa, chỉ còn giải trình nguyên nhân / ghi chú.
  if v_c.status = 'submitted' and exists (select 1 from jsonb_array_elements(p_input->'lines') x where x ? 'countedQty') then
    raise exception using errcode = '22023', message = 'STOCK_COUNT_COUNTS_LOCKED'; end if;
  if jsonb_typeof(p_input->'lines') <> 'array' then raise exception using errcode = '22023', message = 'STOCK_COUNT_LINES_INVALID'; end if;
  for v_line in select value from jsonb_array_elements(p_input->'lines') loop
    v_qty := case when v_line ? 'countedQty' and nullif(v_line->>'countedQty', '') is not null then (v_line->>'countedQty')::numeric end;
    if v_qty is not null and (v_qty < 0 or v_qty > 1e12) then raise exception using errcode = '22023', message = 'STOCK_COUNT_QTY_INVALID'; end if;
    update public.wms_inventory_count_lines l
    set counted_qty = case when v_line ? 'countedQty' then round(v_qty, 6) else l.counted_qty end,
      counted_by = case when v_line ? 'countedQty' then v_actor else l.counted_by end,
      counted_at = case when v_line ? 'countedQty' then now() else l.counted_at end,
      variance_reason = case when v_line ? 'varianceReason' and coalesce(l.variance_qty, 1) <> 0 then nullif(v_line->>'varianceReason', '') else l.variance_reason end,
      note = case when v_line ? 'note' then nullif(btrim(coalesce(v_line->>'note', '')), '') else l.note end,
      updated_at = now()
    where l.id = nullif(v_line->>'lineId', '')::uuid and l.inventory_count_id = v_c.id;
    if not found then raise exception using errcode = '22023', message = 'STOCK_COUNT_LINE_NOT_FOUND'; end if;
    v_n := v_n + 1;
  end loop;
  update public.wms_inventory_counts set row_version = row_version + 1, updated_at = now() where id = v_c.id;
  perform app_private.stock_count_log(v_c.id, 'save', null, jsonb_build_object('lines', v_n));
  return app_private.stock_count_detail(v_c.id);
end;
$$;

-- Nộp duyệt: chốt chênh lệch theo tồn sổ lúc nộp.
create function public.submit_stock_count_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_c public.wms_inventory_counts%rowtype;
  v_l record;
  v_expected numeric;
begin
  select * into v_c from public.wms_inventory_counts where id = nullif(p_input->>'countId', '')::uuid for update;
  if not found or v_c.status <> 'counting' then raise exception using errcode = '22023', message = 'STOCK_COUNT_NOT_COUNTING'; end if;
  if v_c.row_version is distinct from nullif(p_input->>'revision', '')::bigint then
    raise exception using errcode = '40001', message = 'STOCK_COUNT_REVISION_CONFLICT'; end if;
  if not app_private.stock_count_can_count(v_c.warehouse_id) then raise exception using errcode = '42501', message = 'STOCK_COUNT_DENIED'; end if;
  if exists (select 1 from public.wms_inventory_count_lines where inventory_count_id = v_c.id and counted_qty is null) then
    raise exception using errcode = '22023', message = 'STOCK_COUNT_UNCOUNTED_LINES'; end if;

  for v_l in select * from public.wms_inventory_count_lines where inventory_count_id = v_c.id for update loop
    v_expected := app_private.stock_count_ledger_qty(v_l.item_id, v_c.warehouse_id);
    update public.wms_inventory_count_lines
    set movement_qty = v_expected - snapshot_qty, expected_qty_at_post = v_expected,
      variance_qty = round(counted_qty - v_expected, 6),
      unit_cost = round(app_private.stock_count_unit_cost(item_id, v_c.warehouse_id), 4),
      variance_reason = case when round(counted_qty - v_expected, 6) = 0 then null else variance_reason end,
      updated_at = now()
    where id = v_l.id;
  end loop;
  update public.wms_inventory_counts
  set status = 'submitted', submitted_by = v_actor, submitted_at = now(), row_version = row_version + 1, updated_at = now()
  where id = v_c.id returning * into v_c;
  perform app_private.stock_count_log(v_c.id, 'submit', null, jsonb_build_object(
    'varianceLines', (select count(*) from public.wms_inventory_count_lines where inventory_count_id = v_c.id and variance_qty <> 0),
    'varianceValue', (select coalesce(sum(variance_qty * coalesce(unit_cost, 0)), 0) from public.wms_inventory_count_lines where inventory_count_id = v_c.id)));
  return app_private.stock_count_detail(v_c.id);
end;
$$;

create function public.decide_stock_count_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(coalesce(p_input->>'reason', '')), '');
  v_c public.wms_inventory_counts%rowtype;
  v_adj jsonb := '[]'::jsonb;
  v_issue jsonb := '[]'::jsonb;
  v_l record;
  v_adj_id text;
  v_issue_id text;
begin
  select * into v_c from public.wms_inventory_counts where id = nullif(p_input->>'countId', '')::uuid for update;
  if not found or v_c.status <> 'submitted' then raise exception using errcode = '22023', message = 'STOCK_COUNT_NOT_SUBMITTED'; end if;
  if v_c.row_version is distinct from nullif(p_input->>'revision', '')::bigint then
    raise exception using errcode = '40001', message = 'STOCK_COUNT_REVISION_CONFLICT'; end if;
  if not app_private.stock_count_can_approve() then raise exception using errcode = '42501', message = 'STOCK_COUNT_APPROVE_DENIED'; end if;
  if v_actor = v_c.submitted_by or (v_action = 'approve' and v_actor = v_c.created_by) then
    raise exception using errcode = '22023', message = 'STOCK_COUNT_SAME_PERSON'; end if;

  if v_action = 'reject' then
    if v_reason is null then raise exception using errcode = '22023', message = 'STOCK_COUNT_REJECT_REASON_REQUIRED'; end if;
    update public.wms_inventory_counts
    set status = 'counting', rejection = jsonb_build_object('byName', (select name from public.users where id = v_actor), 'at', now(), 'reason', v_reason),
      submitted_by = null, submitted_at = null, row_version = row_version + 1, updated_at = now()
    where id = v_c.id;
    perform app_private.stock_count_log(v_c.id, 'reject', v_reason, '{}'::jsonb);
    return app_private.stock_count_detail(v_c.id);
  elsif v_action <> 'approve' then
    raise exception using errcode = '22023', message = 'STOCK_COUNT_ACTION_INVALID';
  end if;
  if exists (select 1 from public.wms_inventory_count_lines where inventory_count_id = v_c.id
      and variance_qty <> 0 and variance_reason is null) then
    raise exception using errcode = '22023', message = 'STOCK_COUNT_REASON_REQUIRED'; end if;
  if exists (select 1 from public.wms_inventory_count_lines where inventory_count_id = v_c.id and (
      (variance_qty < 0 and variance_reason in ('UNRECORDED_RECEIPT', 'RETURNED_FROM_SITE'))
      or (variance_qty > 0 and variance_reason in ('NATURAL_LOSS', 'DAMAGE', 'THEFT', 'EXPIRED', 'PROCESS_WASTE', 'UNRECORDED_ISSUE')))) then
    raise exception using errcode = '22023', message = 'STOCK_COUNT_REASON_DIRECTION'; end if;


  for v_l in select l.*, i.unit item_unit from public.wms_inventory_count_lines l join public.items i on i.id = l.item_id
    where l.inventory_count_id = v_c.id and l.variance_qty <> 0 order by l.item_id loop
    if v_l.variance_reason = 'UNRECORDED_ISSUE' then
      v_issue := v_issue || jsonb_build_array(jsonb_build_object('itemId', v_l.item_id, 'quantity', -v_l.variance_qty, 'unit', v_l.unit,
        'price', coalesce(v_l.unit_cost, 0), 'inventoryCountId', v_c.id, 'inventoryCountLineId', v_l.id));
    else
      v_adj := v_adj || jsonb_build_array(jsonb_build_object('itemId', v_l.item_id, 'quantity', v_l.variance_qty, 'unit', v_l.unit,
        'price', coalesce(v_l.unit_cost, 0), 'varianceReason', v_l.variance_reason, 'inventoryCountId', v_c.id,
        'inventoryCountLineId', v_l.id, 'snapshotQty', v_l.snapshot_qty, 'expectedQtyAtSubmit', v_l.expected_qty_at_post,
        'countedQty', v_l.counted_qty));
    end if;
  end loop;

  if jsonb_array_length(v_issue) > 0 then
    v_issue_id := 'tx-count-issue-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.transactions (id, type, date, items, source_warehouse_id, requester_id, approver_id, approved_at, status, note,
      pending_items, source_type, source_id, business_event_type, business_event_reason)
    values (v_issue_id, 'EXPORT', now(), v_issue, v_c.warehouse_id, v_c.submitted_by, v_actor, now(), 'COMPLETED',
      'Xuất dùng thi công bổ sung theo kiểm kê ' || v_c.count_no, '[]'::jsonb,
      'wms_inventory_count', v_c.id::text, 'construction_issue', 'Đã dùng cho thi công, chưa lập phiếu xuất (kiểm kê ' || v_c.count_no || ')');
  end if;
  if jsonb_array_length(v_adj) > 0 then
    v_adj_id := 'tx-inventory-count-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.transactions (id, type, date, items, source_warehouse_id, target_warehouse_id, requester_id, approver_id, approved_at,
      status, note, pending_items, source_type, source_id, business_event_type, business_event_reason)
    values (v_adj_id, 'ADJUSTMENT', now(), v_adj, v_c.warehouse_id, v_c.warehouse_id, v_c.submitted_by, v_actor, now(), 'COMPLETED',
      'Điều chỉnh theo kiểm kê ' || v_c.count_no, '[]'::jsonb, 'wms_inventory_count', v_c.id::text, 'inventory_adjustment', v_c.reason);
  end if;

  -- Tồn danh mục theo đúng sổ kho sau ghi sổ (xóa lệch cũ giữa hai nơi).
  update public.items i
  set stock_by_warehouse = jsonb_set(coalesce(i.stock_by_warehouse, '{}'::jsonb), array[v_c.warehouse_id],
    to_jsonb(app_private.stock_count_ledger_qty(i.id, v_c.warehouse_id)), true)
  where i.id in (select item_id from public.wms_inventory_count_lines where inventory_count_id = v_c.id);

  update public.wms_inventory_counts
  set status = 'posted', approved_by = v_actor, posted_at = now(), adjustment_transaction_id = v_adj_id, issue_transaction_id = v_issue_id,
    rejection = null, row_version = row_version + 1, updated_at = now()
  where id = v_c.id;
  perform app_private.stock_count_log(v_c.id, 'approve', v_reason, jsonb_build_object('adjustmentTransactionId', v_adj_id, 'issueTransactionId', v_issue_id,
    'adjustLines', jsonb_array_length(v_adj), 'issueLines', jsonb_array_length(v_issue)));
  return app_private.stock_count_detail(v_c.id);
end;
$$;

create function public.cancel_stock_count_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := nullif(btrim(coalesce(p_input->>'reason', '')), '');
  v_c public.wms_inventory_counts%rowtype;
begin
  select * into v_c from public.wms_inventory_counts where id = nullif(p_input->>'countId', '')::uuid for update;
  if not found or v_c.status not in ('counting', 'submitted') then raise exception using errcode = '22023', message = 'STOCK_COUNT_NOT_OPEN'; end if;
  if not (v_actor = v_c.created_by or app_private.stock_count_can_approve()) then raise exception using errcode = '42501', message = 'STOCK_COUNT_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'STOCK_COUNT_CANCEL_REASON_REQUIRED'; end if;
  update public.wms_inventory_counts
  set status = 'cancelled', cancelled_by = v_actor, cancelled_at = now(), cancel_reason = v_reason, row_version = row_version + 1, updated_at = now()
  where id = v_c.id;
  perform app_private.stock_count_log(v_c.id, 'cancel', v_reason, '{}'::jsonb);
  return app_private.stock_count_detail(v_c.id);
end;
$$;

revoke all on function app_private.stock_count_can_count(text), app_private.stock_count_can_approve(),
  app_private.stock_count_ledger_qty(text, text), app_private.stock_count_unit_cost(text, text),
  app_private.stock_count_log(uuid, text, text, jsonb), app_private.stock_count_detail(uuid) from public, anon, authenticated;
revoke all on function public.list_stock_counts_v1(jsonb), public.get_stock_count_v1(uuid), public.start_stock_count_v1(jsonb),
  public.add_stock_count_item_v1(jsonb), public.save_stock_count_lines_v1(jsonb), public.submit_stock_count_v1(jsonb),
  public.decide_stock_count_v1(jsonb), public.cancel_stock_count_v1(jsonb) from public, anon;
grant execute on function public.list_stock_counts_v1(jsonb), public.get_stock_count_v1(uuid), public.start_stock_count_v1(jsonb),
  public.add_stock_count_item_v1(jsonb), public.save_stock_count_lines_v1(jsonb), public.submit_stock_count_v1(jsonb),
  public.decide_stock_count_v1(jsonb), public.cancel_stock_count_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';

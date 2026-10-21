-- V4 Kiểm kê theo quy cách + in quy cách trên phiếu xuất (doc 13 mục 9.4, 16.3; làm 10/10/2026).
--   * Kiểm kê: mã có quy cách tại kho → dòng đếm tách theo quy cách (wms_inventory_count_lines.spec_counts:
--     [{specification, snapshotQty, countedQty}]); số đếm của mã = cộng các quy cách. Thêm được quy cách lạ khi đếm.
--     Đếm mù: ẩn số sổ từng quy cách như số sổ của mã.
--   * Duyệt: điều chỉnh lệch tổng của mã như cũ, rồi chuyển quy cách (wms_spec_transfers) để tồn từng quy cách khớp số đếm.
--     Phiếu chuyển quy cách được về "Chưa ghi quy cách" (to_spec null) khi đếm ra hàng không rõ quy cách.
--   * get_wms_tx_spec_allocations_v1: quy cách thực xuất/nhập của một phiếu kho (từ sổ kho) — để in và xem phiếu.

alter table public.wms_inventory_count_lines add column if not exists spec_counts jsonb;
comment on column public.wms_inventory_count_lines.spec_counts is 'Đếm theo quy cách: [{specification, snapshotQty, countedQty}]; số đếm của mã = cộng các quy cách.';

alter table public.wms_spec_transfers alter column to_spec drop not null;
alter table public.wms_spec_transfers drop constraint if exists wms_spec_transfers_to_spec_check;
alter table public.wms_spec_transfers add constraint wms_spec_transfers_to_spec_check
  check (to_spec is null or length(btrim(to_spec)) between 1 and 80);

-- Dòng đếm mới: chụp tồn từng quy cách khi mã có quy cách đặt tên tại kho.
create or replace function app_private.trg_stock_count_line_specs()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_wh text; v_specs jsonb;
begin
  if new.spec_counts is not null then return new; end if;
  select warehouse_id into v_wh from public.wms_inventory_counts where id = new.inventory_count_id;
  select jsonb_agg(jsonb_build_object('specification', b.specification, 'snapshotQty', b.qty, 'countedQty', null) order by b.first_in nulls last, b.spec_key)
  into v_specs from app_private.wms_spec_balances(new.item_id, v_wh) b where abs(b.qty) > 0.0000005;
  if exists (select 1 from jsonb_array_elements(coalesce(v_specs, '[]'::jsonb)) x where x->>'specification' is not null) then
    new.spec_counts := v_specs;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_stock_count_line_specs on public.wms_inventory_count_lines;
create trigger trg_stock_count_line_specs before insert on public.wms_inventory_count_lines
  for each row execute function app_private.trg_stock_count_line_specs();

-- Gộp số đếm theo quy cách gửi lên vào danh sách đang có (khớp theo khóa quy cách; quy cách mới thêm vào, sổ = 0).
create or replace function app_private.stock_count_merge_specs(p_old jsonb, p_new jsonb)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare v_out jsonb := coalesce(p_old, '[]'::jsonb); x jsonb; v_i integer; v_qty numeric; v_spec text;
begin
  if jsonb_typeof(p_new) is distinct from 'array' then raise exception using errcode = '22023', message = 'STOCK_COUNT_LINES_INVALID'; end if;
  for x in select value from jsonb_array_elements(p_new) loop
    v_spec := left(nullif(btrim(regexp_replace(coalesce(x->>'specification', ''), '\s+', ' ', 'g')), ''), 80);
    v_qty := case when nullif(x->>'countedQty', '') is not null then round((x->>'countedQty')::numeric, 6) end;
    if v_qty is not null and (v_qty < 0 or v_qty > 1e12) then raise exception using errcode = '22023', message = 'STOCK_COUNT_QTY_INVALID'; end if;
    select o.i - 1 into v_i from jsonb_array_elements(v_out) with ordinality o(v, i)
    where app_private.spec_key(o.v->>'specification') = app_private.spec_key(v_spec) limit 1;
    if v_i is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('specification', v_spec, 'snapshotQty', 0, 'countedQty', v_qty, 'added', true));
    else
      v_out := jsonb_set(v_out, array[v_i::text, 'countedQty'], coalesce(to_jsonb(v_qty), 'null'::jsonb));
    end if;
  end loop;
  return v_out;
end;
$$;

-- Sau khi ghi sổ điều chỉnh: chuyển quy cách để tồn từng quy cách = số đếm.
create or replace function app_private.stock_count_apply_specs(p_count_id uuid, p_actor uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_c public.wms_inventory_counts%rowtype; l record; s record; d record; v_take numeric; v_n integer := 0; v_id uuid;
begin
  select * into v_c from public.wms_inventory_counts where id = p_count_id;
  for l in select * from public.wms_inventory_count_lines where inventory_count_id = p_count_id and jsonb_typeof(spec_counts) = 'array'
      and not exists (select 1 from jsonb_array_elements(spec_counts) x where nullif(x->>'countedQty', '') is null) loop
    create temp table if not exists pg_temp.cnt_spec (k text primary key, name text, diff numeric) on commit drop;
    truncate pg_temp.cnt_spec;
    insert into pg_temp.cnt_spec
    select k, max(name), sum(q) from (
      select app_private.spec_key(x->>'specification') k, nullif(btrim(x->>'specification'), '') name, (x->>'countedQty')::numeric q
      from jsonb_array_elements(l.spec_counts) x
      union all select b.spec_key, b.specification, -b.qty from app_private.wms_spec_balances(l.item_id, v_c.warehouse_id) b) z
    group by k;
    -- Quy cách thừa trên sổ (diff < 0) chuyển sang quy cách đếm được nhiều hơn sổ (diff > 0).
    for s in select * from pg_temp.cnt_spec where diff < -0.0000005 order by k loop
      for d in select * from pg_temp.cnt_spec where diff > 0.0000005 order by k loop
        exit when s.diff >= -0.0000005;
        v_take := least(-s.diff, d.diff);
        v_id := gen_random_uuid();
        insert into public.wms_spec_transfers (id, code, material_id, warehouse_id, from_spec, to_spec, qty, reason, transfer_date, created_by)
        values (v_id, 'CQC-' || to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYMMDD') || '-' || upper(substr(md5(v_id::text), 1, 5)),
          l.item_id, v_c.warehouse_id, s.name, d.name, round(v_take, 6), 'Kiểm kê ' || v_c.count_no || ' — tồn từng quy cách theo số đếm',
          (now() at time zone 'Asia/Ho_Chi_Minh')::date, p_actor);
        update pg_temp.cnt_spec set diff = diff - v_take where k = d.k;
        s.diff := s.diff + v_take; v_n := v_n + 1;
      end loop;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- Quy cách thực của từng dòng sổ kho thuộc một phiếu kho (xuất tự lấy nhập trước cũng có).
create or replace function public.get_wms_tx_spec_allocations_v1(p_transaction_id text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_tx public.transactions%rowtype;
begin
  select * into v_tx from public.transactions where id = p_transaction_id;
  if not found then return '[]'::jsonb; end if;
  if not (public.is_admin() or app_private.wms_has_action('wms.transaction.view', v_tx.source_warehouse_id, v_tx.target_warehouse_id)
      or app_private.wms_has_action('wms.inventory.view', coalesce(v_tx.source_warehouse_id, v_tx.target_warehouse_id), coalesce(v_tx.source_warehouse_id, v_tx.target_warehouse_id))
      or v_tx.requester_id = public.current_app_user_id()) then
    raise exception using errcode = '42501', message = 'WMS_STOCK_VIEW_DENIED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('itemId', e.material_id, 'direction', e.movement_direction, 'qty', e.quantity_in + e.quantity_out,
      'allocations', e.metadata->'specAllocations') order by e.created_at, e.entry_no)
    from public.inventory_ledger_entries e where e.source_id = p_transaction_id or e.source_code = p_transaction_id), '[]'::jsonb);
end;
$$;

CREATE OR REPLACE FUNCTION public.save_stock_count_lines_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_c public.wms_inventory_counts%rowtype;
  v_line jsonb;
  v_qty numeric;
  v_n integer := 0;
  v_specs jsonb;
begin
  select * into v_c from public.wms_inventory_counts where id = nullif(p_input->>'countId', '')::uuid for update;
  if not found or v_c.status not in ('counting', 'submitted') then raise exception using errcode = '22023', message = 'STOCK_COUNT_NOT_COUNTING'; end if;
  if not app_private.stock_count_can_count(v_c.warehouse_id) then raise exception using errcode = '42501', message = 'STOCK_COUNT_DENIED'; end if;
  -- Đã nộp: số đếm khóa, chỉ còn giải trình nguyên nhân / ghi chú.
  if v_c.status = 'submitted' and exists (select 1 from jsonb_array_elements(p_input->'lines') x where x ? 'countedQty' or x ? 'specCounts') then
    raise exception using errcode = '22023', message = 'STOCK_COUNT_COUNTS_LOCKED'; end if;
  if jsonb_typeof(p_input->'lines') <> 'array' then raise exception using errcode = '22023', message = 'STOCK_COUNT_LINES_INVALID'; end if;
  for v_line in select value from jsonb_array_elements(p_input->'lines') loop
    -- V4: đếm theo quy cách → số đếm của mã = cộng các quy cách (chưa đủ mọi quy cách = chưa đếm xong).
    v_specs := null;
    if v_line ? 'specCounts' then
      -- Dòng chưa tách quy cách: phần sổ hiện có coi là "Chưa ghi quy cách".
      v_specs := app_private.stock_count_merge_specs((select coalesce(l.spec_counts, jsonb_build_array(jsonb_build_object('specification', null,
          'snapshotQty', l.snapshot_qty, 'countedQty', null))) from public.wms_inventory_count_lines l
        where l.id = nullif(v_line->>'lineId', '')::uuid and l.inventory_count_id = v_c.id), v_line->'specCounts');
      v_line := v_line || jsonb_build_object('countedQty', (select case when bool_and(nullif(x->>'countedQty', '') is not null)
        then sum((x->>'countedQty')::numeric) end from jsonb_array_elements(v_specs) x));
    end if;
    v_qty := case when v_line ? 'countedQty' and nullif(v_line->>'countedQty', '') is not null then (v_line->>'countedQty')::numeric end;
    if v_qty is not null and (v_qty < 0 or v_qty > 1e12) then raise exception using errcode = '22023', message = 'STOCK_COUNT_QTY_INVALID'; end if;
    update public.wms_inventory_count_lines l
    set counted_qty = case when v_line ? 'countedQty' then round(v_qty, 6) else l.counted_qty end,
      spec_counts = case when v_specs is not null then v_specs else l.spec_counts end,
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
$function$
;

CREATE OR REPLACE FUNCTION app_private.stock_count_detail(p_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'addedDuringCount', l.added_during_count,
        'specCounts', case when v_show then l.spec_counts else (select jsonb_agg(x - 'snapshotQty') from jsonb_array_elements(l.spec_counts) x) end) order by coalesce(i.name, l.item_id)), '[]'::jsonb)
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
$function$
;

CREATE OR REPLACE FUNCTION public.decide_stock_count_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- V4: tồn từng quy cách theo số đếm (chuyển quy cách sau khi đã điều chỉnh lệch tổng).
  perform app_private.stock_count_apply_specs(v_c.id, v_actor);

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
$function$
;


revoke all on function app_private.trg_stock_count_line_specs(), app_private.stock_count_merge_specs(jsonb, jsonb),
  app_private.stock_count_apply_specs(uuid, uuid) from public, anon;
revoke all on function public.get_wms_tx_spec_allocations_v1(text) from public, anon;
grant execute on function public.get_wms_tx_spec_allocations_v1(text) to authenticated;

notify pgrst, 'reload schema';

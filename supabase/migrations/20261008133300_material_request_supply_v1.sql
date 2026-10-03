-- Đề xuất vật tư — bỏ bước "Tạo đợt giao" (việc 1, chủ SP duyệt mockup mr-v1 + 5 câu ngày 02/10/2026).
--
-- Luật nghiệp vụ:
-- 1. Lập → CT duyệt → Phòng vật tư duyệt giữ nguyên. Duyệt xong là "Đang cung ứng" (giữ mã bước nội bộ
--    workflow_step = 'batch_planning' để không phải sửa luồng duyệt; giao diện hiển thị "Đang cung ứng").
--    Không còn bước tạo đợt giao: Mua hàng → Cần mua xử lý từng dòng bằng Mua mới (PO) hoặc Cấp từ kho.
-- 2. Cấp từ kho: Mua hàng lập phiếu chuyển kho PENDING gắn dòng đề xuất (transactions.source_type =
--    'material_request_supply', source_id = mã đề xuất, items[].requestLineId). Kho gửi xuất, kho công trường
--    nhận theo luồng chuyển kho 2 bước hiện có; chi phí đi theo hàng (K3a-2). Phần còn thiếu vẫn ở Cần mua.
-- 3. Số nhận theo dòng (đơn vị kho) = nhận qua PO (đã quy đổi) + nhận qua phiếu chuyển + đợt cấp cũ từ kho
--    đã nhận. Dòng đủ khi đã nhận ≥ 98% số cần (dung sai lệch quy đổi).
-- 4. Tự hoàn tất khi mọi dòng đã nhận đủ hoặc đã đóng. Hàng bị trả NCC làm thiếu lại thì phiếu mở lại.
-- 5. Kết thúc đề xuất: CHT (quyền Duyệt trong room Đề xuất vật tư) hoặc người lập phiếu, bắt buộc lý do.
--    Dòng còn thiếu ghi vào material_request_line_need_closures và rời Cần mua. PO đang chờ vẫn giao,
--    hàng về thành tồn kho công trường. Phiếu kết thúc: status COMPLETED, workflow_step 'ended'.
-- 6. Không xóa bảng đợt cấp cũ (material_request_fulfillment_*) — còn đợt cũ cần truy vết.

-- ---------------------------------------------------------------------------
-- Tiến độ cung ứng theo dòng. p_request_ids null = mọi đề xuất dự án đang cung ứng.
-- ---------------------------------------------------------------------------
create or replace function app_private.material_request_supply_lines_v1(p_request_ids text[] default null)
returns table(request_id text, line_id text, item_id text, item_name text, sku text, unit text,
  need_qty numeric, po_ordered_qty numeric, po_received_qty numeric, transfer_open_qty numeric,
  transfer_received_qty numeric, stock_batch_received_qty numeric, closed_qty numeric,
  sourced_qty numeric, received_qty numeric, line_state text)
language sql stable security definer set search_path = ''
as $$
  select s.*,
    case when s.need_qty > 0 and s.received_qty >= s.need_qty * 0.98 or s.need_qty <= 0 then 'done'
      when s.closed_qty > 0 then 'closed'
      when s.sourced_qty > 0 then 'waiting'
      else 'none' end
  from (
    select r.id, x.value->>'lineId', x.value->>'itemId',
      coalesce(i.name, x.value->>'itemNameSnapshot', x.value->>'itemName', x.value->>'itemId'), i.sku,
      coalesce(nullif(x.value->>'unitSnapshot', ''), i.unit),
      -- Đề xuất cũ duyệt giữ nguyên SL có approvedQty = 0.
      coalesce(nullif(nullif(x.value->>'approvedQty', '')::numeric, 0), nullif(x.value->>'requestQty', '')::numeric, 0) need,
      coalesce(po.ordered_qty, 0), coalesce(po.received_qty, 0), coalesce(tr.open_qty, 0), coalesce(tr.received_qty, 0),
      coalesce(bt.received_qty, 0), coalesce(cl.closed_qty, 0),
      coalesce(po.ordered_qty, 0) + coalesce(tr.open_qty, 0) + coalesce(tr.received_qty, 0) + coalesce(bt.received_qty, 0),
      coalesce(po.received_qty, 0) + coalesce(tr.received_qty, 0) + coalesce(bt.received_qty, 0)
    from public.requests r
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end) x
    left join public.items i on i.id = x.value->>'itemId'
    left join lateral (
      select round(sum(l.ordered_qty - app_private.procurement_link_credited(o.id, l.purchase_order_line_id, l.ordered_qty)), 6) ordered_qty,
        sum(app_private.procurement_link_received(o.id, o.items, l.purchase_order_line_id, l.ordered_qty)) received_qty
      from public.purchase_order_request_lines l
      join public.purchase_orders o on o.id = l.purchase_order_id and o.status not in ('cancelled', 'returned') and o.archived_at is null
      where l.material_request_id = r.id and l.request_line_id = x.value->>'lineId'
    ) po on true
    left join lateral (
      -- Phiếu chuyển "Cấp từ kho": chưa xuất tính theo SL phiếu; đã xuất tính phần đang đi đường + đã nhận.
      select sum(case when w.id is null then case when t.status = 'PENDING'::public.transaction_status then (y.value->>'quantity')::numeric else 0 end
          else greatest(w.dispatched_qty - w.received_qty - w.returned_qty - w.lost_qty, 0) end) open_qty,
        sum(coalesce(w.received_qty, 0)) received_qty
      from public.transactions t
      cross join lateral jsonb_array_elements(t.items) y
      left join public.wms_transfer_lines w on w.transaction_id = t.id and w.line_key = y.value->>'requestLineId'
      where t.source_type = 'material_request_supply' and t.source_id = r.id and t.type = 'TRANSFER'::public.transaction_type
        and y.value->>'requestLineId' = x.value->>'lineId'
    ) tr on true
    left join lateral (
      -- Đợt cấp cũ lấy từ kho (nguồn PO đã tính ở phần PO).
      select sum(fl.received_qty) received_qty
      from public.material_request_fulfillment_lines fl
      join public.material_request_fulfillment_batches b on b.id = fl.batch_id and b.status = 'received' and b.source_type = 'stock'
      where fl.material_request_id = r.id and fl.request_line_id = x.value->>'lineId'
    ) bt on true
    left join lateral (
      select sum(c.closed_qty) closed_qty from public.material_request_line_need_closures c
      where c.material_request_id = r.id and c.request_line_id = x.value->>'lineId' and c.status = 'active'
    ) cl on true
    where r.request_origin = 'project'
      and (case when p_request_ids is null then r.status in ('APPROVED', 'IN_TRANSIT') else r.id = any(p_request_ids) end)
  ) s(request_id, line_id, item_id, item_name, sku, unit, need_qty, po_ordered_qty, po_received_qty, transfer_open_qty,
      transfer_received_qty, stock_batch_received_qty, closed_qty, sourced_qty, received_qty);
$$;
revoke all on function app_private.material_request_supply_lines_v1(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tự hoàn tất / mở lại theo tiến độ dòng. Đang cung ứng thì giữ nguyên bước hiện có.
-- ---------------------------------------------------------------------------
create or replace function app_private.refresh_material_request_supply_v1(p_request_id text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_req public.requests%rowtype; v_done boolean; v_closed boolean;
  v_status public.request_status; v_step text;
begin
  select * into v_req from public.requests where id = p_request_id and request_origin = 'project' for update;
  if not found or v_req.status not in ('APPROVED', 'IN_TRANSIT', 'COMPLETED') then return; end if;
  select bool_and(s.line_state in ('done', 'closed')), bool_or(s.line_state = 'closed') into v_done, v_closed
  from app_private.material_request_supply_lines_v1(array[p_request_id]) s;
  if v_done is null then return; end if;
  if v_done then
    v_status := 'COMPLETED'; v_step := case when v_closed then 'ended' else 'completed' end;
  elsif v_req.status = 'COMPLETED' then
    v_status := 'IN_TRANSIT'; v_step := 'batch_planning';
  else
    return;
  end if;
  if v_req.status = v_status and v_req.workflow_step is not distinct from v_step then return; end if;
  update public.requests
  set status = v_status, workflow_step = v_step, workflow_step_started_at = now(),
    workflow_step_due_at = null, workflow_step_sla_hours = null,
    submitted_to_user_id = case when v_status = 'COMPLETED' then null else submitted_to_user_id end,
    submitted_to_name = case when v_status = 'COMPLETED' then null else submitted_to_name end,
    submitted_to_permission = case when v_status = 'COMPLETED' then null else submitted_to_permission end
  where id = p_request_id;
  insert into public.material_request_events (request_id, project_id, from_step, to_step, action, actor_user_id, note, metadata)
  values (p_request_id, v_req.project_id, v_req.workflow_step, v_step,
    case when v_status = 'COMPLETED' then 'SUPPLY_COMPLETED' else 'SUPPLY_REOPENED' end,
    coalesce(public.current_app_user_id()::text, 'system'),
    case when v_status = 'COMPLETED' then 'Tự hoàn tất: mọi dòng đã nhận đủ (≥ 98%) hoặc đã đóng.'
      else 'Mở lại: có dòng thiếu lại sau khi trả hàng / hủy phiếu nhận.' end,
    jsonb_build_object('fromStatus', v_req.status, 'toStatus', v_status));
end $$;
revoke all on function app_private.refresh_material_request_supply_v1(text) from public, anon, authenticated;

-- Nhận hàng PO (receivedQty / returnedQty trong purchase_orders.items) → làm mới các đề xuất gắn đơn.
create or replace function app_private.trg_material_request_supply_from_po()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_id text;
begin
  for v_id in select distinct l.material_request_id from public.purchase_order_request_lines l
    where l.purchase_order_id = new.id and l.material_request_id is not null loop
    perform app_private.refresh_material_request_supply_v1(v_id);
  end loop;
  return new;
end $$;
drop trigger if exists zz_trg_material_request_supply_from_po on public.purchase_orders;
create trigger zz_trg_material_request_supply_from_po
after update of items, status, archived_at on public.purchase_orders
for each row when (old.items is distinct from new.items or old.status is distinct from new.status or old.archived_at is distinct from new.archived_at)
execute function app_private.trg_material_request_supply_from_po();

-- Kho công trường nhận / trả phiếu chuyển "Cấp từ kho" → làm mới đề xuất.
create or replace function app_private.trg_material_request_supply_from_transfer()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_id text;
begin
  select t.source_id into v_id from public.transactions t
  where t.id = new.transaction_id and t.source_type = 'material_request_supply';
  if v_id is not null then perform app_private.refresh_material_request_supply_v1(v_id); end if;
  return new;
end $$;
drop trigger if exists zz_trg_material_request_supply_from_transfer on public.wms_transfer_lines;
create trigger zz_trg_material_request_supply_from_transfer
after update of received_qty, returned_qty, lost_qty on public.wms_transfer_lines
for each row execute function app_private.trg_material_request_supply_from_transfer();

-- ---------------------------------------------------------------------------
-- Mua hàng → Cần mua → Cấp từ kho: lập phiếu chuyển PENDING gắn dòng đề xuất.
-- Chỉ cho lập khi cả kho gửi và kho nhận đã bật lệnh chuyển kho 2 bước (rollout ERP), nếu không
-- phiếu sẽ treo vì thủ kho không xuất/nhận được.
-- ---------------------------------------------------------------------------
create or replace function app_private.material_request_transfer_ready(p_warehouse_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from app_private.resolve_warehouse_project_scope(p_warehouse_id) w
    join app_private.erp_completion_rollout_scopes s on s.mode = 'pilot'
      and s.starts_at <= statement_timestamp() and s.expires_at > statement_timestamp()
      and s.enabled_commands @> array['wms.transfer.dispatch', 'wms.transfer.receive']
      and (s.project_id is null or s.project_id = w.project_id)
      and (s.construction_site_id is null or s.construction_site_id = w.construction_site_id)
      and (cardinality(s.warehouse_ids) = 0 or p_warehouse_id = any(s.warehouse_ids)));
$$;
revoke all on function app_private.material_request_transfer_ready(text) from public, anon, authenticated;

create or replace function public.create_material_request_supply_transfer_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := public.current_app_user_id(); v_req public.requests%rowtype; v_line record;
  v_src text := nullif(btrim(p_input->>'sourceWarehouseId'), ''); v_qty numeric; v_available numeric;
  v_tx text := 'tx-mrs-' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 5);
  v_src_name text; v_tgt_name text;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  begin v_qty := round((p_input->>'qty')::numeric, 6);
  exception when others then raise exception using errcode = '22023', message = 'MR_SUPPLY_QTY_INVALID'; end;
  if v_qty is null or v_qty <= 0 then raise exception using errcode = '22023', message = 'MR_SUPPLY_QTY_INVALID'; end if;
  select * into v_req from public.requests where id = p_input->>'requestId' and request_origin = 'project' for update;
  if not found then raise exception using errcode = '22023', message = 'MR_SUPPLY_NOT_FOUND'; end if;
  if v_req.status not in ('APPROVED', 'IN_TRANSIT') then
    raise exception using errcode = '22023', message = 'MR_SUPPLY_STATE'; end if;
  if exists (select 1 from public.procurement_need_closures c where c.source_type = 'material_request' and c.source_id = v_req.id) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_NEED_CLOSED'; end if;
  select name into v_src_name from public.warehouses where id = v_src and not coalesce(is_archived, false);
  select name into v_tgt_name from public.warehouses where id = v_req.site_warehouse_id;
  if v_src_name is null or v_tgt_name is null or v_src = v_req.site_warehouse_id then
    raise exception using errcode = '22023', message = 'MR_SUPPLY_WAREHOUSE_INVALID'; end if;
  if not app_private.material_request_transfer_ready(v_src) or not app_private.material_request_transfer_ready(v_req.site_warehouse_id) then
    raise exception using errcode = '22023', message = 'MR_SUPPLY_TRANSFER_NOT_ENABLED'; end if;
  select * into v_line from app_private.material_request_supply_lines_v1(array[v_req.id]) s where s.line_id = p_input->>'lineId';
  if not found or v_line.item_id is null then raise exception using errcode = '22023', message = 'MR_SUPPLY_LINE_NOT_FOUND'; end if;
  if v_qty > greatest(v_line.need_qty - greatest(v_line.sourced_qty, v_line.received_qty), 0) + 0.0005 then
    raise exception using errcode = '22023', message = 'MR_SUPPLY_OVER_NEED'; end if;
  perform 1 from public.items where id = v_line.item_id for update;
  -- Khả dụng = tồn kho gửi − phiếu chuyển đang chờ xuất từ kho đó.
  select coalesce((select sum(b.on_hand_qty) from public.inventory_balances b where b.material_id = v_line.item_id and b.warehouse_id = v_src), 0)
    - coalesce((select sum((y.value->>'quantity')::numeric) from public.transactions t cross join lateral jsonb_array_elements(t.items) y
        where t.type = 'TRANSFER'::public.transaction_type and t.status = 'PENDING'::public.transaction_status
          and t.source_warehouse_id = v_src and y.value->>'itemId' = v_line.item_id), 0)
    into v_available;
  if v_qty > v_available + 0.0005 then raise exception using errcode = '22023', message = 'MR_SUPPLY_STOCK_INSUFFICIENT'; end if;

  insert into public.transactions (id, type, date, items, source_warehouse_id, target_warehouse_id, requester_id, status, note,
    related_request_id, source_type, source_id, business_event_type)
  values (v_tx, 'TRANSFER'::public.transaction_type, now(),
    jsonb_build_array(jsonb_build_object('itemId', v_line.item_id, 'quantity', v_qty, 'unit', v_line.unit,
      'requestLineId', v_line.line_id, 'materialRequestId', v_req.id)),
    v_src, v_req.site_warehouse_id, v_actor, 'PENDING'::public.transaction_status,
    left(concat_ws(' · ', 'Cấp từ kho cho đề xuất ' || v_req.code, v_line.item_name, nullif(btrim(p_input->>'note'), '')), 500),
    v_req.id, 'material_request_supply', v_req.id, 'warehouse_transfer');
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('need', 'material_request:' || v_req.id, 'supply_transfer', v_actor, null,
    jsonb_build_object('transactionId', v_tx, 'lineId', v_line.line_id, 'itemId', v_line.item_id, 'qty', v_qty,
      'sourceWarehouseId', v_src, 'targetWarehouseId', v_req.site_warehouse_id));
  return jsonb_build_object('transactionId', v_tx, 'qty', v_qty, 'unit', v_line.unit, 'itemName', v_line.item_name,
    'sourceWarehouseName', v_src_name, 'targetWarehouseName', v_tgt_name, 'code', v_req.code);
end $$;
revoke all on function public.create_material_request_supply_transfer_v1(jsonb) from public, anon;
grant execute on function public.create_material_request_supply_transfer_v1(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Kết thúc đề xuất (CHT hoặc người lập phiếu), một hoặc nhiều phiếu, bắt buộc lý do.
-- ---------------------------------------------------------------------------
create or replace function app_private.material_request_can_end_supply(p_request public.requests)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_app_user_id() is not null and (
    public.is_admin() or public.is_module_admin('DA')
    or p_request.requester_id = public.current_app_user_id()
    or app_private.current_actor_has_effective_room_action(p_request.project_id, p_request.construction_site_id, 'material_request', 'approve'));
$$;
revoke all on function app_private.material_request_can_end_supply(public.requests) from public, anon, authenticated;

create or replace function public.end_material_request_supply_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := public.current_app_user_id(); v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_id text; v_req public.requests%rowtype; v_n integer := 0; v_lines integer := 0; v_closed integer;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'MR_SUPPLY_END_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'MR_SUPPLY_REASON_REQUIRED'; end if;
  if jsonb_typeof(p_input->'requestIds') is distinct from 'array' or jsonb_array_length(p_input->'requestIds') = 0 then
    raise exception using errcode = '22023', message = 'MR_SUPPLY_NOT_FOUND'; end if;
  for v_id in select distinct value from jsonb_array_elements_text(p_input->'requestIds') loop
    select * into v_req from public.requests where id = v_id and request_origin = 'project' for update;
    if not found then raise exception using errcode = '22023', message = 'MR_SUPPLY_NOT_FOUND'; end if;
    if v_req.status not in ('APPROVED', 'IN_TRANSIT') then
      raise exception using errcode = '22023', message = 'MR_SUPPLY_STATE'; end if;
    if not app_private.material_request_can_end_supply(v_req) then
      raise exception using errcode = '42501', message = 'MR_SUPPLY_END_DENIED'; end if;
    insert into public.material_request_line_need_closures (project_id, construction_site_id, material_request_id, request_line_id,
      item_id, work_boq_item_id, material_budget_item_id, closed_qty, actual_received_qty_snapshot, reason, status, closed_by, closed_at)
    select v_req.project_id, v_req.construction_site_id, v_req.id, s.line_id, s.item_id,
      (select b.id from public.project_work_boq_items b where b.id::text = x.value->>'workBoqItemId'),
      (select m.id from public.material_budget_items m where m.id::text = x.value->>'materialBudgetItemId'),
      greatest(s.need_qty - s.received_qty, 0), greatest(s.received_qty, 0), v_reason, 'active', v_actor, now()
    from app_private.material_request_supply_lines_v1(array[v_req.id]) s
    join lateral jsonb_array_elements(v_req.items) x on x.value->>'lineId' = s.line_id
    where s.line_state in ('waiting', 'none') and s.item_id is not null;
    get diagnostics v_closed = row_count;
    v_lines := v_lines + v_closed;
    update public.requests
    set status = 'COMPLETED'::public.request_status, workflow_step = 'ended', workflow_step_started_at = now(),
      workflow_step_due_at = null, workflow_step_sla_hours = null, workflow_step_actor_user_id = v_actor::text,
      submitted_to_user_id = null, submitted_to_name = null, submitted_to_permission = null,
      last_action_by = v_actor, last_action_at = now()
    where id = v_req.id;
    insert into public.material_request_events (request_id, project_id, from_step, to_step, action, actor_user_id, note, metadata)
    values (v_req.id, v_req.project_id, v_req.workflow_step, 'ended', 'SUPPLY_ENDED', v_actor::text, v_reason,
      jsonb_build_object('closedLines', v_closed, 'fromStatus', v_req.status));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ended', v_n, 'closedLines', v_lines);
end $$;
revoke all on function public.end_material_request_supply_v1(jsonb) from public, anon;
grant execute on function public.end_material_request_supply_v1(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Đọc: chi tiết cung ứng một đề xuất, và tóm tắt các đề xuất đang cung ứng của dự án.
-- ---------------------------------------------------------------------------
create or replace function public.get_material_request_supply_v1(p_request_id text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_req public.requests%rowtype;
begin
  select * into v_req from public.requests where id = p_request_id and request_origin = 'project';
  if not found or not app_private.material_request_parent_can_view(p_request_id) then
    raise exception using errcode = '42501', message = 'MR_SUPPLY_NOT_FOUND'; end if;
  return jsonb_build_object(
    'requestId', v_req.id, 'status', v_req.status, 'workflowStep', v_req.workflow_step,
    'phase', case when v_req.status in ('APPROVED', 'IN_TRANSIT') then 'supplying'
      when v_req.status = 'COMPLETED' and v_req.workflow_step = 'ended' then 'ended'
      when v_req.status = 'COMPLETED' then 'completed' else 'other' end,
    'canEnd', v_req.status in ('APPROVED', 'IN_TRANSIT') and app_private.material_request_can_end_supply(v_req),
    'ending', (select jsonb_build_object('reason', e.note, 'at', e.created_at,
        'byName', (select u.name from public.users u where u.id::text = e.actor_user_id))
      from public.material_request_events e where e.request_id = v_req.id and e.action = 'SUPPLY_ENDED'
      order by e.created_at desc limit 1),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('lineId', s.line_id, 'itemId', s.item_id, 'itemName', s.item_name,
        'sku', s.sku, 'unit', s.unit, 'needQty', s.need_qty, 'sourcedQty', round(s.sourced_qty, 3), 'receivedQty', round(s.received_qty, 3),
        'closedQty', round(s.closed_qty, 3), 'state', s.line_state,
        'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'poNumber', o.po_number, 'status', o.status, 'qty', k.qty) order by o.po_number)
          from (select l.purchase_order_id, sum(l.ordered_qty) qty from public.purchase_order_request_lines l
                where l.material_request_id = v_req.id and l.request_line_id = s.line_id group by 1) k
          join public.purchase_orders o on o.id = k.purchase_order_id and o.archived_at is null and o.status not in ('cancelled', 'returned')), '[]'::jsonb),
        'transfers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'qty', (y.value->>'quantity')::numeric,
            'sourceWarehouseName', (select w.name from public.warehouses w where w.id = t.source_warehouse_id)) order by t.date)
          from public.transactions t cross join lateral jsonb_array_elements(t.items) y
          where t.source_type = 'material_request_supply' and t.source_id = v_req.id and y.value->>'requestLineId' = s.line_id), '[]'::jsonb))
      order by s.item_name)
      from app_private.material_request_supply_lines_v1(array[v_req.id]) s), '[]'::jsonb));
end $$;
revoke all on function public.get_material_request_supply_v1(text) from public, anon;
grant execute on function public.get_material_request_supply_v1(text) to authenticated;

create or replace function public.list_material_request_supply_v1(p_project_id text, p_construction_site_id text default null)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(r.id, jsonb_build_object('lineCount', q.line_count, 'doneLines', q.done_lines,
      'unsourcedLines', q.unsourced_lines, 'sourcedAny', q.sourced_any, 'canEnd', app_private.material_request_can_end_supply(r))), '{}'::jsonb)
  from (
    select s.request_id, count(*) line_count, count(*) filter (where s.line_state in ('done', 'closed')) done_lines,
      count(*) filter (where s.line_state = 'none') unsourced_lines, bool_or(s.sourced_qty > 0 or s.received_qty > 0) sourced_any
    from app_private.material_request_supply_lines_v1(null) s group by s.request_id
  ) q
  join public.requests r on r.id = q.request_id
  where r.project_id = p_project_id and (p_construction_site_id is null or r.construction_site_id = p_construction_site_id)
    and app_private.material_request_parent_can_view(r.id);
$$;
revoke all on function public.list_material_request_supply_v1(text, text) from public, anon;
grant execute on function public.list_material_request_supply_v1(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Hàm có sẵn: Cần mua tính cả phiếu chuyển; chi tiết nhu cầu có tồn kho khác + phiếu chuyển;
-- đồng bộ đợt cấp cũ / hủy phiếu nhận PO gọi tiến độ theo dòng.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.procurement_inbox_lines()
 RETURNS TABLE(source_type text, source_id text, line_id text, item_id text, item_name text, sku text, unit text, need_qty numeric, ordered_qty numeric, received_qty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  -- Việc 1: số đã đặt gồm PO + phiếu chuyển "Cấp từ kho" + đợt cấp cũ từ kho; số đã nhận theo đơn vị kho.
  select 'material_request', s.request_id, s.line_id, s.item_id, s.item_name, s.sku, s.unit, s.need_qty, s.sourced_qty, s.received_qty
  from app_private.material_request_supply_lines_v1(null) s
  union all
  select 'material_plan', p.id::text, l.id::text, l.item_id, l.item_name_snapshot, l.sku_snapshot, l.unit,
    l.requested_qty, coalesce(po.ordered_qty, 0), coalesce(po.received_qty, 0)
  from public.project_material_plans p
  join public.project_material_plan_lines l on l.plan_id = p.id and l.requested_qty > 0
  left join lateral (
    select round(sum(k.ordered_qty - app_private.procurement_link_credited(o.id, k.purchase_order_line_id, k.ordered_qty)), 6) ordered_qty,
      sum(app_private.procurement_link_received(o.id, o.items, k.purchase_order_line_id, k.ordered_qty)) received_qty
    from public.procurement_po_plan_links k
    join public.purchase_orders o on o.id = k.purchase_order_id and o.status not in ('cancelled', 'returned') and o.archived_at is null
    where k.material_plan_line_id = l.id
  ) po on true
  where p.status = 'approved';
$$;

CREATE OR REPLACE FUNCTION public.get_procurement_inbox_document_v1(p_source_type text, p_source_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_doc record;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select d.*, pr.code project_code, pr.name project_name, w.name warehouse_name into v_doc
  from app_private.procurement_inbox_documents() d
  left join public.projects pr on pr.id = d.project_id
  left join public.warehouses w on w.id = d.warehouse_id
  where d.source_type = p_source_type and d.source_id = p_source_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  return jsonb_build_object(
    'sourceType', v_doc.source_type, 'sourceId', v_doc.source_id, 'code', v_doc.code, 'title', v_doc.title,
    'projectId', v_doc.project_id, 'projectCode', v_doc.project_code, 'projectName', v_doc.project_name,
    'warehouseId', v_doc.warehouse_id, 'warehouseName', v_doc.warehouse_name, 'neededDate', v_doc.needed_date,
    'requesterName', v_doc.requester_name, 'approvedAt', v_doc.approved_at, 'approvedByName', v_doc.approved_by_name,
    'constructionSiteId', v_doc.construction_site_id, 'periodType', v_doc.period_type, 'periodStart', v_doc.period_start,
    'closure', case when v_doc.closed_at is null then null else jsonb_build_object(
      'closedAt', v_doc.closed_at, 'reason', v_doc.close_reason, 'closedByName', v_doc.closed_by_name) end,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('lineId', l.line_id, 'itemId', l.item_id, 'itemName', l.item_name,
        'sku', l.sku, 'unit', l.unit, 'needQty', l.need_qty, 'orderedQty', l.ordered_qty, 'receivedQty', round(l.received_qty, 3),
        'purchaseUnit', (select i.purchase_unit from public.items i where i.id = l.item_id and nullif(btrim(i.purchase_unit), '') is not null
          and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, ''))) and coalesce(i.purchase_conversion_factor, 0) > 0),
        'purchaseFactor', (select nullif(i.purchase_conversion_factor, 0) from public.items i where i.id = l.item_id),
        'remainingQty', greatest(l.need_qty - l.ordered_qty, 0),
        'stockQty', case when v_doc.warehouse_id is null then null else coalesce((select sum(b.on_hand_qty)
          from public.inventory_balances b where b.material_id = l.item_id and b.warehouse_id = v_doc.warehouse_id), 0) end,
        -- Việc 1 — Cấp từ kho: tồn khả dụng ở kho khác (trừ phiếu chuyển chờ xuất) và phiếu chuyển đã lập cho dòng.
        'otherStock', case when p_source_type = 'material_request' then coalesce((select jsonb_agg(jsonb_build_object('warehouseId', w.id,
            'warehouseName', w.name, 'warehouseType', w.type, 'qty', round(q.qty, 3),
            'transferReady', app_private.material_request_transfer_ready(w.id) and app_private.material_request_transfer_ready(v_doc.warehouse_id)) order by q.qty desc)
          from (select b.warehouse_id, sum(b.on_hand_qty) - coalesce((select sum((y.value->>'quantity')::numeric)
                from public.transactions t cross join lateral jsonb_array_elements(t.items) y
                where t.type = 'TRANSFER'::public.transaction_type and t.status = 'PENDING'::public.transaction_status
                  and t.source_warehouse_id = b.warehouse_id and y.value->>'itemId' = l.item_id), 0) qty
            from public.inventory_balances b where b.material_id = l.item_id and b.warehouse_id is distinct from v_doc.warehouse_id
            group by b.warehouse_id) q
          join public.warehouses w on w.id = q.warehouse_id and not coalesce(w.is_archived, false)
          where q.qty > 0.0005), '[]'::jsonb) end,
        'transfers', case when p_source_type = 'material_request' then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status,
            'qty', (y.value->>'quantity')::numeric, 'sourceWarehouseName', (select w.name from public.warehouses w where w.id = t.source_warehouse_id)) order by t.date)
          from public.transactions t cross join lateral jsonb_array_elements(t.items) y
          where t.source_type = 'material_request_supply' and t.source_id = p_source_id and y.value->>'requestLineId' = l.line_id), '[]'::jsonb) end,
        'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'poNumber', o.po_number, 'status', o.status,
            'vendorName', o.vendor_name, 'expectedDeliveryDate', o.expected_delivery_date, 'orderedQty', k.qty) order by o.po_number)
          from (select prl.purchase_order_id, sum(prl.ordered_qty) qty from public.purchase_order_request_lines prl
                where p_source_type = 'material_request' and prl.material_request_id = p_source_id and prl.request_line_id = l.line_id group by 1
                union all
                select pl.purchase_order_id, sum(pl.ordered_qty) from public.procurement_po_plan_links pl
                where p_source_type = 'material_plan' and pl.material_plan_line_id::text = l.line_id group by 1) k
          join public.purchase_orders o on o.id = k.purchase_order_id and o.archived_at is null), '[]'::jsonb))
        order by l.item_name)
      from app_private.procurement_inbox_lines() l where l.source_type = p_source_type and l.source_id = p_source_id), '[]'::jsonb),
    'assignment', (select jsonb_build_object('assigneeUserId', a.assignee_user_id,
        'assigneeName', (select u.name from public.users u where u.id = a.assignee_user_id), 'assignedAt', a.assigned_at, 'note', a.note)
      from public.procurement_inbox_assignments a where a.source_type = p_source_type and a.source_id = p_source_id)
  );
end;
$$;

CREATE OR REPLACE FUNCTION app_private.sync_material_request_receipt_status_v1(p_request_id text, p_actor_user_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $$
declare
  v_request public.requests%rowtype;
  v_total_committed numeric := 0;
  v_total_issued numeric := 0;
  v_total_received numeric := 0;
  v_total_closed numeric := 0;
  v_open_need numeric := 0;
  v_has_open_batch boolean := false;
  v_next_status public.request_status;
  v_next_step text;
  v_step_changed boolean := false;
  v_sla_hours integer;
begin
  if coalesce(p_request_id, '') = '' then
    return jsonb_build_object('synced', false, 'reason', 'missing_request_id');
  end if;

  select *
  into v_request
  from public.requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('synced', false, 'reason', 'request_not_found', 'requestId', p_request_id);
  end if;

  if v_request.status in (
    'DRAFT'::public.request_status,
    'PENDING'::public.request_status,
    'REJECTED'::public.request_status
  ) then
    return jsonb_build_object(
      'synced', false,
      'reason', 'request_waiting_approval_or_rejected',
      'requestId', p_request_id,
      'status', v_request.status
    );
  end if;

  select coalesce(sum(coalesce(
    nullif(item.value ->> 'requestQty', '')::numeric,
    nullif(item.value ->> 'request_qty', '')::numeric,
    nullif(item.value ->> 'approvedQty', '')::numeric,
    nullif(item.value ->> 'approved_qty', '')::numeric,
    0
  )), 0)
  into v_total_committed
  from jsonb_array_elements(coalesce(v_request.items, '[]'::jsonb)) item(value);

  select
    coalesce(sum(case when b.status not in ('draft', 'cancelled', 'returned') then coalesce(l.issued_qty, 0) else 0 end), 0),
    coalesce(sum(case when b.status = 'received' then coalesce(l.received_qty, 0) else 0 end), 0),
    coalesce(bool_or(b.status in ('issued', 'variance_pending')), false)
  into v_total_issued, v_total_received, v_has_open_batch
  from public.material_request_fulfillment_batches b
  left join public.material_request_fulfillment_lines l on l.batch_id = b.id
  where b.material_request_id = p_request_id;

  if to_regclass('public.material_request_line_need_closures') is not null then
    select coalesce(sum(coalesce(closed_qty, 0)), 0)
    into v_total_closed
    from public.material_request_line_need_closures
    where material_request_id = p_request_id
      and status = 'active';
  end if;

  v_open_need := greatest(0, v_total_committed - v_total_received - v_total_closed);

  v_next_status := case
    when v_total_committed > 0 and v_open_need <= 0 then 'COMPLETED'::public.request_status
    when v_total_issued > 0 or v_total_received > 0 then 'IN_TRANSIT'::public.request_status
    else 'APPROVED'::public.request_status
  end;

  v_next_step := case
    when v_next_status = 'COMPLETED'::public.request_status then 'completed'
    when v_has_open_batch then 'site_quality_check'
    when v_total_received > 0 and v_open_need > 0 then 'batch_planning'
    when v_total_issued > 0 then 'site_quality_check'
    else 'batch_planning'
  end;

  v_step_changed := v_request.workflow_step is distinct from v_next_step;
  v_sla_hours := case
    when v_next_step = 'batch_planning' then 48
    when v_next_step = 'site_quality_check' then 8
    else null
  end;

  update public.requests
  set status = v_next_status,
      workflow_step = v_next_step,
      workflow_step_started_at = case when v_step_changed then now() else workflow_step_started_at end,
      workflow_step_due_at = case
        when v_next_step = 'completed' then null
        when v_step_changed and v_sla_hours is not null then now() + make_interval(hours => v_sla_hours)
        else workflow_step_due_at
      end,
      workflow_step_sla_hours = case
        when v_next_step = 'completed' then null
        when v_step_changed then v_sla_hours
        else workflow_step_sla_hours
      end,
      workflow_step_actor_user_id = coalesce(p_actor_user_id::text, workflow_step_actor_user_id),
      submitted_to_user_id = case when v_next_step = 'completed' then null else submitted_to_user_id end,
      submitted_to_name = case when v_next_step = 'completed' then null else submitted_to_name end,
      submitted_to_permission = case when v_next_step = 'completed' then null else submitted_to_permission end,
      submission_note = case
        when v_next_step = 'completed' then null
        when nullif(trim(coalesce(p_note, '')), '') is not null then p_note
        else submission_note
      end
  where id = p_request_id;

  -- Việc 1: tiến độ theo dòng (PO + chuyển kho + đợt cũ) quyết định hoàn tất cuối cùng.
  perform app_private.refresh_material_request_supply_v1(p_request_id);

  return jsonb_build_object(
    'synced', true,
    'requestId', p_request_id,
    'status', v_next_status,
    'workflowStep', v_next_step,
    'committedQty', v_total_committed,
    'receivedQty', v_total_received,
    'closedNeedQty', v_total_closed,
    'openNeedQty', v_open_need
  );
end;
$$;

CREATE OR REPLACE FUNCTION app_private.project_po_refresh_request_status_v1(p_request_ids text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_request_id text;
  v_total_committed numeric := 0;
  v_total_active_issued numeric := 0;
  v_total_received numeric := 0;
  v_total_closed numeric := 0;
  v_open_need numeric := 0;
  v_next_status public.request_status;
  v_next_step text;
begin
  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    return;
  end if;

  foreach v_request_id in array p_request_ids loop
    select coalesce(sum(
      coalesce(
        nullif(item.value ->> 'approvedQty', '')::numeric,
        nullif(item.value ->> 'requestQty', '')::numeric,
        0
      )
    ), 0)
    into v_total_committed
    from public.requests request
    cross join lateral jsonb_array_elements(coalesce(request.items, '[]'::jsonb)) item(value)
    where request.id = v_request_id;

    select
      coalesce(sum(case
        when lower(coalesce(batch.status::text, '')) not in ('draft', 'cancelled', 'returned')
          then coalesce(line.issued_qty, 0)
        else 0
      end), 0),
      coalesce(sum(case
        when lower(coalesce(batch.status::text, '')) = 'received'
          then coalesce(line.received_qty, 0)
        else 0
      end), 0)
    into v_total_active_issued, v_total_received
    from public.material_request_fulfillment_lines line
    join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
    where line.material_request_id = v_request_id;

    v_total_closed := 0;
    if to_regclass('public.material_request_line_need_closures') is not null then
      select coalesce(sum(coalesce(closure.closed_qty, 0)), 0)
      into v_total_closed
      from public.material_request_line_need_closures closure
      where closure.material_request_id = v_request_id
        and lower(coalesce(closure.status::text, 'active')) = 'active';
    end if;

    v_open_need := greatest(0, v_total_committed - v_total_received - v_total_closed);
    v_next_status := case
      when v_total_committed > 0 and v_open_need <= 0 then 'COMPLETED'::public.request_status
      when v_total_active_issued > 0 or v_total_received > 0 then 'IN_TRANSIT'::public.request_status
      else 'APPROVED'::public.request_status
    end;
    v_next_step := case
      when v_next_status = 'COMPLETED'::public.request_status then 'completed'
      when v_next_status = 'IN_TRANSIT'::public.request_status then 'site_quality_check'
      else 'batch_planning'
    end;

    update public.requests
    set status = v_next_status,
        workflow_step = v_next_step,
        workflow_step_started_at = now(),
        submission_note = concat_ws(
          ' | ',
          nullif(submission_note, ''),
          'Đồng bộ lại sau khi phiếu nhập PO bị từ chối trước nhập kho.'
        )
    where id = v_request_id
      and status not in (
        'DRAFT'::public.request_status,
        'PENDING'::public.request_status,
        'REJECTED'::public.request_status
      )
      and (
        status is distinct from v_next_status
        or workflow_step is distinct from v_next_step
      );
    -- Việc 1: tiến độ theo dòng (PO + chuyển kho + đợt cũ) quyết định hoàn tất cuối cùng.
    perform app_private.refresh_material_request_supply_v1(v_request_id);
  end loop;
end;
$$;

CREATE OR REPLACE FUNCTION public.advance_project_workflow_v2_room_authoritative_legacy(p_subject_type text, p_subject_id text, p_next_assignee_user_ids uuid[] DEFAULT '{}'::uuid[], p_comment text DEFAULT ''::text)
 RETURNS workflow_subjects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_request public.requests%rowtype;
  v_current_node public.workflow_instance_nodes%rowtype;
  v_next_node public.workflow_instance_nodes%rowtype;
  v_next_assignee_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_next_assignee_user_ids);
  v_handoff_assignee uuid;
  v_first_next_assignee uuid;
  v_next_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_to_step text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select * into v_subject
  from public.workflow_subjects ws
  where ws.subject_type = p_subject_type and ws.subject_id = p_subject_id
  for update;
  if not found then raise exception 'workflow subject not found'; end if;

  select * into v_request from public.requests r where r.id = p_subject_id for update;
  if not found then raise exception 'material request not found: %', p_subject_id; end if;
  if v_subject.status <> 'RUNNING' then raise exception 'workflow subject is not running'; end if;
  if not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user is not assigned to current workflow step';
  end if;

  select * into v_current_node
  from public.workflow_instance_nodes win
  where win.id = v_subject.current_instance_node_id
    and win.workflow_instance_id = v_subject.workflow_instance_id;
  if not found then raise exception 'current runtime workflow node not found'; end if;

  select target_node.* into v_next_node
  from public.workflow_instance_edges wie
  join public.workflow_instance_nodes target_node on target_node.id = wie.target_instance_node_id
  where wie.workflow_instance_id = v_subject.workflow_instance_id
    and wie.source_instance_node_id = v_subject.current_instance_node_id
  order by wie.sort_order, target_node.position_y, target_node.position_x
  limit 1;
  if not found then raise exception 'next runtime workflow node not found'; end if;

  if v_next_node.type = 'END'::public.workflow_node_type then
    if coalesce(array_length(v_next_assignee_ids, 1), 0) <> 1 then
      raise exception 'exactly one batch planning assignee is required';
    end if;
    foreach v_handoff_assignee in array v_next_assignee_ids loop
      if not app_private.project_material_request_handoff_assignee_is_eligible(
        p_subject_id,
        v_handoff_assignee
      ) then
        raise exception 'batch planning assignee must be active project staff with approve permission';
      end if;
    end loop;
  elsif not app_private.project_workflow_runtime_assignees_are_eligible(
    p_subject_type, p_subject_id, v_next_node.id, v_next_assignee_ids
  ) then
    raise exception 'next assignee pool is not eligible for this runtime workflow step';
  end if;

  update public.workflow_step_assignments
  set status = 'APPROVED', acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), ''),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('approvedByUserId', v_actor, 'approvalPolicy', 'ANY_ONE')
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and instance_node_id = v_subject.current_instance_node_id
    and assignee_user_id = v_actor
    and status = 'PENDING';

  update public.workflow_step_assignments
  set status = 'SKIPPED', acted_at = now(),
      action_comment = 'Skipped because another assignee approved this step',
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('skippedByPolicy', 'ANY_ONE', 'approvedByUserId', v_actor)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and instance_node_id = v_subject.current_instance_node_id
    and status = 'PENDING';

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_subject.workflow_instance_id, v_current_node.template_node_id,
    'APPROVED'::public.workflow_instance_action, v_actor, coalesce(p_comment, ''));

  if v_next_node.type = 'END'::public.workflow_node_type then
    v_first_next_assignee := v_next_assignee_ids[1];
    v_next_assignee_name := app_private.project_workflow_first_assignee_name(v_next_assignee_ids);
    v_sla_hours := 48;
    v_due_at := now() + make_interval(hours => v_sla_hours);

    update public.workflow_instances
    set current_node_id = v_next_node.template_node_id,
        current_instance_node_id = v_next_node.id,
        status = 'COMPLETED'::public.workflow_instance_status,
        updated_at = now()
    where id = v_subject.workflow_instance_id;

    update public.workflow_subjects
    set current_assignee_user_id = null,
        current_assignee_user_ids = '{}'::uuid[],
        current_node_id = v_next_node.template_node_id,
        current_instance_node_id = v_next_node.id,
        last_action_instance_node_id = v_current_node.id,
        status = 'COMPLETED',
        updated_at = now()
    where id = v_subject.id
    returning * into v_subject;

    update public.requests
    set status = 'APPROVED'::public.request_status,
        submitted_to_user_id = v_first_next_assignee::text,
        submitted_to_name = v_next_assignee_name,
        submitted_to_permission = 'approve',
        submission_note = nullif(coalesce(p_comment, ''), ''),
        last_action_by = v_actor, last_action_at = now(),
        -- Việc 1: duyệt xong là Đang cung ứng (mã batch_planning), không đặt hạn 48h của bước tạo đợt cũ.
        workflow_step = 'batch_planning', workflow_step_started_at = now(),
        workflow_step_due_at = null, workflow_step_sla_hours = null,
        workflow_step_actor_user_id = v_actor::text
    where id = p_subject_id;

    insert into public.material_request_events(
      request_id, project_id, from_step, to_step, action, actor_user_id,
      target_user_id, target_permission, note, sla_hours, due_at, metadata
    )
    values (
      p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'material_department_review'),
      'batch_planning', 'APPROVED', v_actor::text,
      v_first_next_assignee::text, 'approve', nullif(coalesce(p_comment, ''), ''),
      v_sla_hours, v_due_at,
      jsonb_build_object(
        'workflowInstanceId', v_subject.workflow_instance_id,
        'workflowSubjectId', v_subject.id,
        'fromInstanceNodeId', v_current_node.id,
        'toInstanceNodeId', v_next_node.id,
        'handoffAssigneeUserId', v_first_next_assignee
      )
    );
    return v_subject;
  end if;

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id, v_subject.workflow_instance_id, v_next_node.template_node_id, v_next_node.id,
    v_next_assignee_ids, v_actor, p_comment,
    jsonb_build_object('approvedFromInstanceNodeId', v_current_node.id, 'approvalPolicy', 'ANY_ONE'),
    'transition'
  );

  v_first_next_assignee := v_next_assignee_ids[1];
  v_next_assignee_name := app_private.project_workflow_first_assignee_name(v_next_assignee_ids);
  v_sla_hours := app_private.project_workflow_runtime_sla_hours(v_next_node.id);
  v_due_at := app_private.project_workflow_runtime_sla_due_at(v_next_node.id);
  v_to_step := app_private.project_workflow_runtime_to_coarse_step(v_subject.workflow_instance_id, v_next_node.id);

  update public.workflow_instances
  set current_node_id = v_next_node.template_node_id,
      current_instance_node_id = v_next_node.id,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || app_private.project_workflow_step_assignees_json(v_next_node.template_node_id, v_next_assignee_ids),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_first_next_assignee,
      current_assignee_user_ids = v_next_assignee_ids,
      current_node_id = v_next_node.template_node_id,
      current_instance_node_id = v_next_node.id,
      last_action_instance_node_id = v_current_node.id,
      status = 'RUNNING', updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'PENDING'::public.request_status,
      submitted_to_user_id = v_first_next_assignee::text,
      submitted_to_name = v_next_assignee_name,
      submitted_to_permission = app_private.project_workflow_runtime_primary_permission(v_next_node.id),
      submission_note = nullif(coalesce(p_comment, ''), ''),
      last_action_by = v_actor, last_action_at = now(),
      workflow_step = v_to_step, workflow_step_started_at = now(),
      workflow_step_due_at = v_due_at, workflow_step_sla_hours = v_sla_hours,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id, project_id, from_step, to_step, action, actor_user_id,
    target_user_id, target_permission, note, sla_hours, due_at, metadata
  )
  values (
    p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'material_department_review'),
    v_to_step, 'APPROVED', v_actor::text, v_first_next_assignee::text,
    app_private.project_workflow_runtime_primary_permission(v_next_node.id),
    nullif(coalesce(p_comment, ''), ''), v_sla_hours, v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'fromInstanceNodeId', v_current_node.id,
      'toInstanceNodeId', v_next_node.id,
      'assigneeUserIds', v_next_assignee_ids
    )
  );
  return v_subject;
end;
$$;

-- ---------------------------------------------------------------------------
-- Chuyển đổi đề xuất đang treo ở bước cũ: phiếu đã nhận đủ → Hoàn tất; còn lại là "Đang cung ứng"
-- (bỏ hạn SLA 48h của bước tạo đợt cũ). Phiếu chưa có nguồn nào hiện ở "Đề xuất treo cần quyết" cho CHT.
-- ---------------------------------------------------------------------------
do $$
declare v_id text;
begin
  for v_id in select id from public.requests where request_origin = 'project' and status in ('APPROVED', 'IN_TRANSIT') order by created_date loop
    perform app_private.refresh_material_request_supply_v1(v_id);
  end loop;
end $$;
update public.requests set workflow_step_due_at = null, workflow_step_sla_hours = null
where request_origin = 'project' and status in ('APPROVED', 'IN_TRANSIT') and workflow_step = 'batch_planning'
  and (workflow_step_due_at is not null or workflow_step_sla_hours is not null);

notify pgrst, 'reload schema';

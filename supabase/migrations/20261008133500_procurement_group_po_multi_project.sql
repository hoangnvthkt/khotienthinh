-- Mua hàng — Đơn gom nhiều dự án, phương án A: giao thẳng từng công trường (việc 2, chủ SP duyệt mockup mg-v1 + 6 câu 03/10/2026).
--
-- Luật nghiệp vụ:
-- 1. Chỉ Mua hàng lập; tick phiếu nhu cầu của nhiều dự án → một đơn gom (một NCC, một đơn giá mỗi vật tư).
--    Duyệt như đơn thường theo tổng giá trị. Đơn gom: purchase_orders.project_id / target_warehouse_id để trống,
--    metadata.groupOrder = true; mỗi dòng phân bổ giữ kho nhận của phiếu nhu cầu.
-- 2. Mỗi đợt giao về MỘT công trường (kho nhận chọn trong các kho của đơn). Phiếu nhập kho vào đúng kho đó;
--    công nợ NCC + chi phí ghi cho dự án của kho đó (đợt giao mang project_id / construction_site_id riêng).
-- 3. Chi phí từng dự án = SL kho dự án nhận × đơn giá đợt; VAT theo đợt giao như hiện nay.
-- 4. Số nhận của từng dòng nhu cầu tính theo kho: các đợt giao đã nhận về kho đó chia cho các dòng nhu cầu của kho
--    theo ngày cần sớm nhất trước (mặc định) hoặc theo tỷ lệ phần còn thiếu (chọn ở đợt giao). Hàng trả NCC từ kho đó
--    trừ ngược từ dòng có ngày cần muộn nhất; trả NCC ghi giảm (không giao bù) thì phần đặt cũng giảm.
-- 5. Giao thừa: phần vượt các dòng nhu cầu của kho thành tồn kho công trường (không gắn nhu cầu); Mua hàng có thể gán
--    sang dòng nhu cầu khác CÙNG dự án (bắt buộc lý do) — gán là thêm dòng phân bổ, nhận sau các dòng gốc.
-- 6. Kết thúc thiếu: mỗi dòng nhu cầu chỉ giữ phần thực nhận theo kho, phần còn lại về Cần mua của đúng dự án.

alter table public.purchase_order_delivery_batches
  add column if not exists target_warehouse_id text references public.warehouses(id),
  add column if not exists allocation_mode text not null default 'earliest' check (allocation_mode in ('earliest', 'ratio'));
alter table public.purchase_order_request_lines add column if not exists excess_reason text;

create or replace function app_private.procurement_po_is_group(p_metadata jsonb)
returns boolean
language sql immutable set search_path = ''
as $$ select coalesce(p_metadata->>'groupOrder', '') = 'true'; $$;

-- Thủ kho (hoặc người có quyền Xác nhận PO) ở một trong các công trường của đơn gom.
create or replace function app_private.group_po_actor_is_site_keeper(p_po_id text, p_metadata jsonb)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app_private.procurement_po_is_group(p_metadata) and exists (
    select 1 from public.purchase_order_request_lines l where l.purchase_order_id = p_po_id
      and (app_private.current_user_is_wms_keeper_for(l.target_warehouse_id)
        or app_private.project_actor_has_effective_room_action(public.current_app_user_id(), l.project_id, l.construction_site_id, 'material_po', 'confirm')));
$$;
revoke all on function app_private.group_po_actor_is_site_keeper(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Phân bổ số nhận theo kho cho đơn gom (tính từ đợt giao đã nhận và phiếu trả NCC đã xuất)
-- ---------------------------------------------------------------------------
create or replace function app_private.group_po_link_allocation(p_po_id text)
returns table(link_id uuid, link_kind text, po_line_id text, warehouse_id text, project_id text, needed_date date,
  ordered_qty numeric, received_qty numeric, credited_qty numeric, is_excess boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare g record; b record; rt record; v_ids uuid[]; v_kinds text[]; v_proj text[]; v_need date[]; v_cap numeric[]; v_exc boolean[];
  v_rec numeric[]; v_cred numeric[]; n integer; i integer; v_left numeric; v_give numeric; v_room numeric;
begin
  for g in
    select distinct x.po_line_id, x.wh from (
      select l.purchase_order_line_id po_line_id, l.target_warehouse_id wh from public.purchase_order_request_lines l where l.purchase_order_id = p_po_id
      union all
      select k.purchase_order_line_id, p.destination_warehouse_id from public.procurement_po_plan_links k
      join public.project_material_plans p on p.id = k.material_plan_id where k.purchase_order_id = p_po_id) x
    where x.wh is not null
  loop
    -- Thứ tự nhận: dòng gốc trước dòng gán phần thừa, ngày cần sớm nhất trước, rồi thứ tự lập / thứ tự dòng trong phiếu.
    select array_agg(q.id order by q.exc, q.need nulls last, q.created_at, q.pos, q.id), array_agg(q.kind order by q.exc, q.need nulls last, q.created_at, q.pos, q.id),
      array_agg(q.proj order by q.exc, q.need nulls last, q.created_at, q.pos, q.id), array_agg(q.need order by q.exc, q.need nulls last, q.created_at, q.pos, q.id),
      array_agg(q.cap order by q.exc, q.need nulls last, q.created_at, q.pos, q.id), array_agg(q.exc order by q.exc, q.need nulls last, q.created_at, q.pos, q.id)
      into v_ids, v_kinds, v_proj, v_need, v_cap, v_exc
    from (
      select l.id, 'material_request' kind, l.project_id proj, r.expected_date::date need, greatest(coalesce(l.ordered_qty, 0), 0) cap,
        l.excess_reason is not null exc, l.created_at,
        (select x.ordinality from jsonb_array_elements(r.items) with ordinality x where x.value->>'lineId' = l.request_line_id limit 1) pos
      from public.purchase_order_request_lines l left join public.requests r on r.id = l.material_request_id
      where l.purchase_order_id = p_po_id and l.purchase_order_line_id = g.po_line_id and l.target_warehouse_id = g.wh
      union all
      select k.id, 'material_plan', p.project_id, coalesce(p.needed_date, p.period_start), greatest(coalesce(k.ordered_qty, 0), 0), false, k.created_at, null::bigint
      from public.procurement_po_plan_links k join public.project_material_plans p on p.id = k.material_plan_id
      where k.purchase_order_id = p_po_id and k.purchase_order_line_id = g.po_line_id and p.destination_warehouse_id = g.wh) q;
    n := coalesce(array_length(v_ids, 1), 0);
    if n = 0 then continue; end if;
    v_rec := array_fill(0::numeric, array[n]); v_cred := array_fill(0::numeric, array[n]);
    for b in
      select coalesce(dl.accepted_stock_qty, 0) qty, bt.allocation_mode mode
      from public.purchase_order_delivery_lines dl
      join public.purchase_order_delivery_batches bt on bt.id = dl.delivery_batch_id
      where bt.purchase_order_id = p_po_id and dl.purchase_order_line_id = g.po_line_id and bt.target_warehouse_id = g.wh
        and bt.status in ('received', 'received_short', 'received_over')
      order by bt.received_at nulls last, bt.delivery_no
    loop
      v_left := b.qty;
      if b.mode = 'ratio' then
        v_room := 0;
        for i in 1..n loop if not v_exc[i] then v_room := v_room + greatest(v_cap[i] - v_rec[i], 0); end if; end loop;
        if v_room > 0 then
          for i in 1..n loop
            if not v_exc[i] then
              v_give := least(greatest(v_cap[i] - v_rec[i], 0), b.qty * greatest(v_cap[i] - v_rec[i], 0) / v_room);
              v_rec[i] := v_rec[i] + v_give; v_left := v_left - v_give;
            end if;
          end loop;
        end if;
      end if;
      -- Ngày cần sớm nhất trước (và phần còn lại của chia tỷ lệ / dòng gán phần thừa).
      for i in 1..n loop
        exit when v_left <= 0.0000005;
        v_give := least(greatest(v_cap[i] - v_rec[i], 0), v_left);
        v_rec[i] := v_rec[i] + v_give; v_left := v_left - v_give;
      end loop;
    end loop;
    for rt in
      select coalesce(rl.stock_return_qty, rl.return_qty, 0) qty, sr.resolution
      from public.purchase_order_supplier_return_lines rl
      join public.purchase_order_supplier_returns sr on sr.id = rl.supplier_return_id
      where sr.purchase_order_id = p_po_id and rl.purchase_order_line_id = g.po_line_id and sr.source_warehouse_id = g.wh and sr.status = 'completed'
      order by sr.completed_at nulls last
    loop
      v_left := rt.qty;
      for i in reverse n..1 loop
        exit when v_left <= 0.0000005;
        v_give := least(v_rec[i], v_left);
        v_rec[i] := v_rec[i] - v_give; v_left := v_left - v_give;
        if rt.resolution = 'credit' then v_cred[i] := v_cred[i] + v_give; end if;
      end loop;
    end loop;
    for i in 1..n loop
      link_id := v_ids[i]; link_kind := v_kinds[i]; po_line_id := g.po_line_id; warehouse_id := g.wh; project_id := v_proj[i];
      needed_date := v_need[i]; ordered_qty := v_cap[i]; received_qty := round(v_rec[i], 6); credited_qty := round(v_cred[i], 6); is_excess := v_exc[i];
      return next;
    end loop;
  end loop;
end $$;

create or replace function app_private.procurement_link_received_v2(p_po_id text, p_items jsonb, p_line_id text, p_ordered numeric, p_link_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select case when app_private.procurement_po_is_group((select o.metadata from public.purchase_orders o where o.id = p_po_id))
    then coalesce((select g.received_qty from app_private.group_po_link_allocation(p_po_id) g where g.link_id = p_link_id), 0)
    else app_private.procurement_link_received(p_po_id, p_items, p_line_id, p_ordered) end;
$$;

create or replace function app_private.procurement_link_credited_v2(p_po_id text, p_line_id text, p_ordered numeric, p_link_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select case when app_private.procurement_po_is_group((select o.metadata from public.purchase_orders o where o.id = p_po_id))
    then coalesce((select g.credited_qty from app_private.group_po_link_allocation(p_po_id) g where g.link_id = p_link_id), 0)
    else app_private.procurement_link_credited(p_po_id, p_line_id, p_ordered) end;
$$;

-- Phần còn phải giao về một kho của một dòng đơn gom (đơn vị kho).
create or replace function app_private.group_po_site_undelivered(p_po_id text, p_line_id text, p_warehouse_id text, p_except_batch uuid default null)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select greatest(coalesce((select sum(g.ordered_qty - g.credited_qty) from app_private.group_po_link_allocation(p_po_id) g
      where g.po_line_id = p_line_id and g.warehouse_id = p_warehouse_id and not g.is_excess), 0)
    - coalesce((select sum(case when bt.status in ('received', 'received_short', 'received_over') then coalesce(dl.accepted_stock_qty, 0)
          else coalesce(dl.stock_planned_qty, 0) end)
      from public.purchase_order_delivery_lines dl join public.purchase_order_delivery_batches bt on bt.id = dl.delivery_batch_id
      where bt.purchase_order_id = p_po_id and dl.purchase_order_line_id = p_line_id and bt.target_warehouse_id = p_warehouse_id
        and bt.status <> 'cancelled' and bt.id is distinct from p_except_batch), 0), 0);
$$;

-- Các công trường của đơn gom: dự án, kho, SL đặt / đã nhận / còn phải giao theo dòng, và từng dòng nhu cầu.
create or replace function app_private.group_po_sites(p_po public.purchase_orders)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(s order by s->>'projectCode', s->>'warehouseName'), '[]'::jsonb) from (
    select jsonb_build_object('warehouseId', w.id, 'warehouseName', w.name, 'projectId', max(g.project_id),
      'projectCode', (select pr.code from public.projects pr where pr.id = max(g.project_id)),
      'lines', jsonb_agg(jsonb_build_object('lineId', g.po_line_id,
        'orderedStockQty', g.ordered, 'receivedStockQty', g.received,
        'undeliveredStockQty', app_private.group_po_site_undelivered(p_po.id, g.po_line_id, w.id),
        'excessStockQty', greatest(g.arrived - g.received, 0),
        -- Dòng đề xuất cùng dự án, cùng vật tư còn thiếu (chưa gắn đơn này) có thể nhận phần thừa.
        'excessCandidates', case when g.arrived - g.received > 0.0005 then coalesce((select jsonb_agg(jsonb_build_object('sourceId', c.request_id, 'lineId', c.line_id,
            'code', r.code, 'shortQty', round(c.need_qty - greatest(c.sourced_qty, c.received_qty), 3)) order by r.expected_date)
          from app_private.material_request_supply_lines_v1(null) c join public.requests r on r.id = c.request_id
          where r.project_id = g.project_id and c.item_id = g.item_id and c.line_state in ('waiting', 'none')
            and c.need_qty - greatest(c.sourced_qty, c.received_qty) > 0.0005
            and not exists (select 1 from public.purchase_order_request_lines k where k.purchase_order_id = p_po.id
              and k.material_request_id = c.request_id and k.request_line_id = c.line_id)), '[]'::jsonb) else '[]'::jsonb end,
        'allocations', g.allocs) order by g.po_line_id)) s
    from (
      select a.warehouse_id, a.po_line_id, max(a.project_id) project_id,
        round(sum(a.ordered_qty - a.credited_qty) filter (where not a.is_excess), 6) ordered, round(sum(a.received_qty), 6) received,
        (select x.value->>'itemId' from jsonb_array_elements(p_po.items) x where coalesce(x.value->>'lineId', x.value->>'itemId') = a.po_line_id limit 1) item_id,
        coalesce((select sum(coalesce(dl.accepted_stock_qty, 0)) from public.purchase_order_delivery_lines dl
            join public.purchase_order_delivery_batches bt on bt.id = dl.delivery_batch_id
            where bt.purchase_order_id = p_po.id and dl.purchase_order_line_id = a.po_line_id and bt.target_warehouse_id = a.warehouse_id
              and bt.status in ('received', 'received_short', 'received_over')), 0)
          - coalesce((select sum(coalesce(rl.stock_return_qty, rl.return_qty, 0)) from public.purchase_order_supplier_return_lines rl
            join public.purchase_order_supplier_returns sr on sr.id = rl.supplier_return_id
            where sr.purchase_order_id = p_po.id and rl.purchase_order_line_id = a.po_line_id and sr.source_warehouse_id = a.warehouse_id
              and sr.status = 'completed'), 0) arrived,
        jsonb_agg(jsonb_build_object('linkId', a.link_id, 'kind', a.link_kind, 'neededDate', a.needed_date, 'orderedQty', a.ordered_qty,
          'receivedQty', a.received_qty, 'excess', a.is_excess,
          'code', coalesce((select coalesce(r.code, l.material_request_code) from public.purchase_order_request_lines l left join public.requests r on r.id = l.material_request_id where l.id = a.link_id),
            (select p.code from public.procurement_po_plan_links k join public.project_material_plans p on p.id = k.material_plan_id where k.id = a.link_id)),
          'excessReason', (select l.excess_reason from public.purchase_order_request_lines l where l.id = a.link_id))
          order by a.is_excess, a.needed_date nulls last) allocs
      from app_private.group_po_link_allocation(p_po.id) a group by a.warehouse_id, a.po_line_id) g
    join public.warehouses w on w.id = g.warehouse_id
    group by w.id, w.name) x(s);
$$;

-- Gán phần giao thừa ở một kho sang dòng nhu cầu khác CÙNG dự án (bắt buộc lý do).
create or replace function public.assign_group_po_excess_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := public.current_app_user_id(); v_po public.purchase_orders%rowtype; v_wh text := p_input->>'warehouseId';
  v_line text := p_input->>'poLineId'; v_qty numeric; v_reason text := nullif(btrim(coalesce(p_input->>'reason', '')), '');
  v_project text; v_req public.requests%rowtype; v_need record; v_excess numeric; v_item text;
begin
  if not app_private.procurement_can('manage') then raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'PROCUREMENT_EXCESS_REASON_REQUIRED'; end if;
  begin v_qty := round((p_input->>'qty')::numeric, 6); exception when others then v_qty := null; end;
  if v_qty is null or v_qty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_group(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  select max(g.project_id) into v_project from app_private.group_po_link_allocation(v_po.id) g where g.warehouse_id = v_wh and g.po_line_id = v_line;
  if v_project is null then raise exception using errcode = '22023', message = 'PROCUREMENT_GROUP_SITE_INVALID'; end if;
  -- Phần thừa ở kho = đã nhận về kho − đã phân cho các dòng nhu cầu của kho.
  select coalesce((select sum(case when coalesce(dl.accepted_stock_qty, 0) > 0 then dl.accepted_stock_qty else 0 end)
      from public.purchase_order_delivery_lines dl join public.purchase_order_delivery_batches bt on bt.id = dl.delivery_batch_id
      where bt.purchase_order_id = v_po.id and dl.purchase_order_line_id = v_line and bt.target_warehouse_id = v_wh
        and bt.status in ('received', 'received_short', 'received_over')), 0)
    - coalesce((select sum(coalesce(rl.stock_return_qty, rl.return_qty, 0)) from public.purchase_order_supplier_return_lines rl
      join public.purchase_order_supplier_returns sr on sr.id = rl.supplier_return_id
      where sr.purchase_order_id = v_po.id and rl.purchase_order_line_id = v_line and sr.source_warehouse_id = v_wh and sr.status = 'completed'), 0)
    - coalesce((select sum(g.received_qty) from app_private.group_po_link_allocation(v_po.id) g where g.warehouse_id = v_wh and g.po_line_id = v_line), 0)
    into v_excess;
  if v_qty > v_excess + 0.0005 then raise exception using errcode = '22023', message = 'PROCUREMENT_EXCESS_OVER'; end if;
  select x.value->>'itemId' into v_item from jsonb_array_elements(v_po.items) x where coalesce(x.value->>'lineId', x.value->>'itemId') = v_line limit 1;
  select * into v_req from public.requests where id = p_input->>'sourceId' and request_origin = 'project';
  select s.* into v_need from app_private.material_request_supply_lines_v1(array[v_req.id]) s where s.line_id = p_input->>'lineId';
  if v_req.id is null or v_req.project_id is distinct from v_project or v_req.status not in ('APPROVED', 'IN_TRANSIT')
    or v_need.line_id is null or v_need.item_id is distinct from v_item then
    raise exception using errcode = '22023', message = 'PROCUREMENT_EXCESS_TARGET_INVALID'; end if;
  if exists (select 1 from public.purchase_order_request_lines l where l.purchase_order_id = v_po.id and l.purchase_order_line_id = v_line
      and l.material_request_id = v_req.id and l.request_line_id = v_need.line_id) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
  perform set_config('app.procurement_hub_context', 'on', true);
  insert into public.purchase_order_request_lines (project_id, construction_site_id, source_construction_site_id, target_warehouse_id, allocation_status,
    purchase_order_id, purchase_order_line_id, material_request_id, material_request_code, request_line_id, item_id, requested_qty, ordered_qty,
    requested_qty_snapshot, ordered_stock_qty_snapshot, actual_received_qty_snapshot, unit, excess_reason)
  values (v_req.project_id, v_req.construction_site_id, v_req.construction_site_id, v_wh, 'open', v_po.id, v_line, v_req.id, v_req.code, v_need.line_id,
    v_item, v_need.need_qty, v_qty, v_need.need_qty, v_qty, 0, v_need.unit, v_reason);
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'excess_assign', v_actor, v_reason,
    jsonb_build_object('warehouseId', v_wh, 'poLineId', v_line, 'sourceCode', v_req.code, 'requestLineId', v_need.line_id, 'qty', v_qty));
  perform set_config('app.procurement_hub_context', 'off', true);
  perform app_private.refresh_material_request_supply_v1(v_req.id);
  return jsonb_build_object('purchaseOrderId', v_po.id, 'qty', v_qty, 'code', v_req.code);
end $$;

revoke all on function app_private.group_po_link_allocation(text), app_private.procurement_link_received_v2(text, jsonb, text, numeric, uuid),
  app_private.procurement_link_credited_v2(text, text, numeric, uuid), app_private.group_po_site_undelivered(text, text, text, uuid),
  app_private.group_po_sites(public.purchase_orders) from public, anon, authenticated;
revoke all on function public.assign_group_po_excess_v1(jsonb) from public, anon;
grant execute on function public.assign_group_po_excess_v1(jsonb) to authenticated;

-- Đơn gom: đợt giao đổi trạng thái (nhận / hủy) → làm mới tiến độ các đề xuất gắn đơn.
create or replace function app_private.trg_group_po_batch_refresh()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_id text;
begin
  if not exists (select 1 from public.purchase_orders o where o.id = new.purchase_order_id and app_private.procurement_po_is_group(o.metadata)) then return new; end if;
  for v_id in select distinct l.material_request_id from public.purchase_order_request_lines l
    where l.purchase_order_id = new.purchase_order_id and l.material_request_id is not null loop
    perform app_private.refresh_material_request_supply_v1(v_id);
  end loop;
  return new;
end $$;
drop trigger if exists zz_trg_group_po_batch_refresh on public.purchase_order_delivery_batches;
create trigger zz_trg_group_po_batch_refresh after update of status on public.purchase_order_delivery_batches
for each row when (old.status is distinct from new.status) execute function app_private.trg_group_po_batch_refresh();

-- ---------------------------------------------------------------------------
-- Hàm có sẵn: lưu đơn, đợt giao, phiếu nhập kho, công nợ, số nhận theo dòng nhu cầu, chi tiết / danh sách đơn
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_procurement_hub_po_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(p_input->>'purchaseOrderId', '');
  v_po public.purchase_orders%rowtype;
  v_vendor record;
  v_project text; v_site text; v_warehouse text := nullif(p_input->>'targetWarehouseId', '');
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_request_ids text[];
  v_mode text := case when p_input->>'purchaseMode' = 'multiple' then 'multiple' else 'single' end;
  v_needed date; v_scopes integer; v_group boolean := false; v_line_id text; v_punit text; v_ord integer := 0; it jsonb; al jsonb; v_qty numeric; v_price numeric; v_item record; v_src record;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;

  select b.id, b.name into v_vendor from public.business_partners b
  where b.id = nullif(p_input->>'vendorId', '') and b.is_active;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VENDOR_REQUIRED'; end if;

  -- Every allocation must be an open need line of the same item, in one project/site.
  create temp table if not exists pg_temp.hub_alloc (item_ord integer, po_line_id text, item_id text, unit_price numeric, item_note text,
    purchase_qty numeric, purchase_unit text,
    source_type text, source_id text, line_id text, qty numeric, need_qty numeric, project_id text, site_id text,
    warehouse_id text, needed_date date, work_boq_item_id text, material_budget_item_id text, code text, unit text) on commit drop;
  truncate pg_temp.hub_alloc;
  for it in select value from jsonb_array_elements(p_input->'items') loop
    v_ord := v_ord + 1;
    v_price := coalesce(nullif(it->>'unitPrice', '')::numeric, 0);
    if nullif(it->>'purchaseQty', '')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    if jsonb_typeof(it->'allocations') is distinct from 'array' or jsonb_array_length(it->'allocations') = 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
    for al in select value from jsonb_array_elements(it->'allocations') loop
      v_qty := nullif(al->>'qty', '')::numeric;
      if v_qty is null or v_qty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
      select l.need_qty, l.unit, d.project_id, d.construction_site_id, d.warehouse_id, d.needed_date, d.code, d.closed_at
        into v_src
      from app_private.procurement_inbox_lines() l
      join app_private.procurement_inbox_documents() d on d.source_type = l.source_type and d.source_id = l.source_id
      where l.source_type = al->>'sourceType' and l.source_id = al->>'sourceId' and l.line_id = al->>'lineId'
        and l.item_id = it->>'itemId';
      if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
      if v_src.closed_at is not null then raise exception using errcode = '22023', message = 'PROCUREMENT_NEED_CLOSED'; end if;
      insert into pg_temp.hub_alloc values (v_ord, null, it->>'itemId', v_price,
        nullif(btrim(it->>'note'), ''), nullif(it->>'purchaseQty', '')::numeric, nullif(btrim(it->>'purchaseUnit'), ''), al->>'sourceType', al->>'sourceId', al->>'lineId', v_qty, v_src.need_qty,
        v_src.project_id, v_src.construction_site_id, v_src.warehouse_id, v_src.needed_date, null, null, v_src.code, v_src.unit);
    end loop;
  end loop;
  if exists (select 1 from pg_temp.hub_alloc group by source_type, source_id, line_id having count(*) > 1) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
  select count(distinct coalesce(project_id, '') || '|' || coalesce(site_id, '')), min(project_id), min(site_id), min(needed_date)
    into v_scopes, v_project, v_site, v_needed from pg_temp.hub_alloc;
  -- Việc 2: phiếu của nhiều dự án → đơn gom; mỗi dòng phân bổ giữ kho nhận của phiếu, đơn không gắn một dự án / kho.
  v_group := v_scopes > 1;
  if v_group then
    if exists (select 1 from pg_temp.hub_alloc where warehouse_id is null) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_GROUP_WAREHOUSE_REQUIRED'; end if;
    v_project := null; v_site := null; v_warehouse := null;
    -- Đơn gom giao nhiều đợt (mỗi đợt một công trường), không tự tạo đợt giao khi duyệt.
    v_mode := 'multiple';
  end if;
  if v_warehouse is null and not v_group then
    select min(warehouse_id) into v_warehouse from pg_temp.hub_alloc having count(distinct warehouse_id) = 1;
  end if;
  if v_warehouse is not null and not exists (select 1 from public.warehouses w where w.id = v_warehouse and not coalesce(w.is_archived, false)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;

  -- Request line attribution (BOQ links) from the request itself.
  update pg_temp.hub_alloc a set work_boq_item_id = x.value->>'workBoqItemId', material_budget_item_id = x.value->>'materialBudgetItemId'
  from public.requests r cross join lateral jsonb_array_elements(r.items) x
  where a.source_type = 'material_request' and r.id = a.source_id and x.value->>'lineId' = a.line_id;

  -- One PO line per item.
  for v_item in
    select a.item_id, max(a.unit_price) unit_price, sum(a.qty) qty, min(a.needed_date) needed_date, max(a.item_note) note,
      max(a.purchase_qty) manual_purchase_qty, max(a.purchase_unit) manual_purchase_unit,
      count(*) n, min(a.source_type) st, min(a.source_id) sid, min(a.line_id) lid, min(a.code) code,
      coalesce(i.name, min(a.item_id)) name, i.sku, coalesce(i.unit, min(a.unit)) unit,
      -- Need quantities are in the stock unit; the order uses the purchase unit (stock = purchase × factor).
      case when nullif(btrim(i.purchase_unit), '') is not null and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, '')))
        and coalesce(i.purchase_conversion_factor, 0) > 0 then i.purchase_unit end purchase_unit,
      coalesce(nullif(i.purchase_conversion_factor, 0), 1) factor
    from pg_temp.hub_alloc a left join public.items i on i.id = a.item_id
    group by a.item_id, i.name, i.sku, i.unit, i.purchase_unit, i.purchase_conversion_factor order by min(a.item_ord), a.item_id
  loop
    if (select count(distinct unit_price) from pg_temp.hub_alloc where item_id = v_item.item_id) > 1 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    v_line_id := 'mh-' || gen_random_uuid();
    -- The buyer may type the purchase quantity (e.g. 100 kg ↔ 10 cây); otherwise the item's default factor applies.
    v_punit := coalesce(v_item.manual_purchase_unit, v_item.purchase_unit, v_item.unit);
    v_qty := case when v_item.manual_purchase_qty is not null then v_item.manual_purchase_qty
      when v_item.purchase_unit is null then v_item.qty else round(v_item.qty / v_item.factor, 6) end;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item.item_id, 'sku', coalesce(v_item.sku, ''), 'name', v_item.name,
      'itemNameSnapshot', v_item.name, 'unit', coalesce(v_punit, ''),
      'unitSnapshot', v_item.unit, 'stockUnitSnapshot', v_item.unit, 'purchaseUnitSnapshot', v_punit,
      'purchaseConversionFactor', round(v_item.qty / v_qty, 12), 'stockQty', v_item.qty,
      'qty', v_qty, 'unitPrice', v_item.unit_price, 'neededDate', v_item.needed_date, 'note', v_item.note,
      'requestId', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.sid end,
      'requestCode', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.code end,
      'requestLineId', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.lid end)));
    v_total := v_total + v_qty * v_item.unit_price;
    update pg_temp.hub_alloc set po_line_id = v_line_id where item_id = v_item.item_id;
  end loop;
  select array_agg(distinct source_id) into v_request_ids from pg_temp.hub_alloc where source_type = 'material_request';

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_po_id is null then
    v_po_id := 'po-' || gen_random_uuid();
    insert into public.purchase_orders (id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
      total_amount, vat_rate, order_date, expected_delivery_date, status, source_mode, purchase_mode, fulfillment_mode,
      target_warehouse_id, material_request_id, note, created_by_id, approval_request_title, metadata)
    values (v_po_id, v_project, v_site, v_vendor.id, v_vendor.name, public.next_purchase_order_number_v2(), v_items,
      v_total, v_vat, to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'),
      nullif(p_input->>'expectedDeliveryDate', ''), 'draft', 'from_request', v_mode, 'RECEIVE_TO_STOCK',
      v_warehouse, case when cardinality(v_request_ids) = 1 then v_request_ids[1] end,
      nullif(btrim(p_input->>'note'), ''), v_actor::text, 'Đơn hàng lập tại Mua hàng',
      jsonb_build_object('channel', 'procurement_hub') || case when v_group then jsonb_build_object('groupOrder', true) else '{}'::jsonb end)
    returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id)
    values ('purchase_order', v_po_id, 'create', v_actor);
  else
    select * into v_po from public.purchase_orders where id = v_po_id for update;
    if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
    -- Đơn chủ động (M2d) chỉ sửa bằng save_procurement_proactive_po_v1 để giữ liên kết nhu cầu đã gắn.
    if v_po.source_mode in ('proactive_project', 'proactive_stock') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PROACTIVE_USE_EDITOR'; end if;
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_NOT_EDITABLE'; end if;
    if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    delete from public.purchase_order_request_lines where purchase_order_id = v_po_id;
    delete from public.procurement_po_plan_links where purchase_order_id = v_po_id;
    update public.purchase_orders set vendor_id = v_vendor.id, vendor_name = v_vendor.name, items = v_items,
      total_amount = v_total, vat_rate = v_vat, purchase_mode = v_mode, expected_delivery_date = nullif(p_input->>'expectedDeliveryDate', ''),
      target_warehouse_id = v_warehouse, material_request_id = case when cardinality(v_request_ids) = 1 then v_request_ids[1] end,
      note = nullif(btrim(p_input->>'note'), ''), project_id = v_project, construction_site_id = v_site,
      metadata = (coalesce(metadata, '{}'::jsonb) - 'groupOrder') || case when v_group then jsonb_build_object('groupOrder', true) else '{}'::jsonb end
    where id = v_po_id returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id)
    values ('purchase_order', v_po_id, 'update', v_actor);
  end if;

  insert into public.purchase_order_request_lines (project_id, construction_site_id, source_construction_site_id,
    target_warehouse_id, allocation_status, purchase_order_id, purchase_order_line_id, material_request_id,
    material_request_code, request_line_id, item_id, work_boq_item_id, material_budget_item_id, requested_qty,
    ordered_qty, requested_qty_snapshot, ordered_stock_qty_snapshot, actual_received_qty_snapshot, unit)
  select a.project_id, a.site_id, a.site_id, coalesce(v_warehouse, a.warehouse_id), 'open', v_po_id, a.po_line_id, a.source_id,
    a.code, a.line_id, a.item_id,
    (select b.id from public.project_work_boq_items b where b.id = a.work_boq_item_id),
    (select b.id from public.material_budget_items b where b.id = a.material_budget_item_id),
    a.need_qty, a.qty, a.need_qty, a.qty, 0, a.unit
  from pg_temp.hub_alloc a where a.source_type = 'material_request';
  insert into public.procurement_po_plan_links (purchase_order_id, purchase_order_line_id, material_plan_id,
    material_plan_line_id, item_id, ordered_qty)
  select v_po_id, a.po_line_id, a.source_id::uuid, a.line_id::uuid, a.item_id, a.qty
  from pg_temp.hub_alloc a where a.source_type = 'material_plan';
  perform set_config('app.procurement_hub_context', 'off', true);

  return jsonb_build_object('purchaseOrderId', v_po_id, 'poNumber', v_po.po_number, 'rowVersion', v_po.row_version,
    'totalAmount', v_total, 'lines', jsonb_array_length(v_items));
end;
$$;

CREATE OR REPLACE FUNCTION public.transition_procurement_hub_po_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_to uuid := nullif(p_input->>'approverUserId', '')::uuid;
  v_po public.purchase_orders%rowtype;
  v_name text;
begin
  if not app_private.procurement_can('manage') and not public.is_admin() then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  if v_action = 'submit' then
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_SUBMIT_DENIED'; end if;
    if jsonb_array_length(coalesce(v_po.items, '[]'::jsonb)) = 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
    if exists (select 1 from jsonb_array_elements(v_po.items) x where coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) <= 0) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_MISSING'; end if;
    if v_po.target_warehouse_id is null and not app_private.procurement_po_is_group(v_po.metadata) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_REQUIRED'; end if;
    if v_to is null or v_to = v_actor or not app_private.procurement_po_approver_ok(v_to) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_APPROVER_INVALID'; end if;
    select name into v_name from public.users where id = v_to;
    update public.purchase_orders set status = 'sent', submitted_to_user_id = v_to::text, submitted_to_name = v_name,
      submitted_to_permission = 'system.procurement.manage', submission_note = v_reason, ever_submitted = true,
      last_action_by = v_actor::text, last_action_at = now(), metadata = metadata - 'returnReason'
    where id = v_po.id returning * into v_po;
    perform app_private.procurement_notify(v_to, 'Đơn hàng chờ bạn duyệt',
      v_po.po_number || ' · ' || coalesce(v_po.vendor_name, '') || ' — ' || to_char(v_po.total_amount, 'FM999G999G999G999') || ' đ', v_po.id, 'assigned');
  elsif v_action in ('approve', 'return') then
    if v_po.status <> 'sent' or v_po.created_by_id = v_actor::text
      or not (v_po.submitted_to_user_id = v_actor::text or public.is_admin()) then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_APPROVE_DENIED'; end if;
    if v_action = 'return' and v_reason is null then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_RETURN_REASON_REQUIRED'; end if;
    if v_action = 'approve' then
      update public.purchase_orders set status = 'confirmed', approved_total_amount = total_amount,
        last_action_by = v_actor::text, last_action_at = now()
      where id = v_po.id returning * into v_po;
      -- Same as the project flow: a single-delivery order gets its delivery note + WMS/QR so the
      -- warehouse receives it (both purchase and stock quantities) — actual qty may be short.
      if coalesce(v_po.purchase_mode, 'single') = 'single' and not app_private.procurement_po_is_group(v_po.metadata) then
        perform app_private.create_delivery_batch_with_wms_qr_core_v2(v_po.id, gen_random_uuid(), v_po.vendor_id, v_po.vendor_name,
          v_po.fulfillment_mode, coalesce(v_po.vat_rate, 0), v_po.target_warehouse_id,
          coalesce(app_private.procurement_date_or_null(v_po.expected_delivery_date), current_date),
          'Đợt giao tự động khi duyệt đơn tại Mua hàng', v_actor,
          (select jsonb_agg(jsonb_build_object('purchaseOrderLineId', coalesce(x.value->>'lineId', x.value->>'itemId'),
              'itemId', x.value->>'itemId', 'purchaseQty', (x.value->>'qty')::numeric, 'purchaseUnit', x.value->>'purchaseUnitSnapshot',
              'stockQty', (x.value->>'qty')::numeric * (x.value->>'purchaseConversionFactor')::numeric,
              'stockUnit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unitSnapshot'),
              'purchaseUnitPrice', (x.value->>'unitPrice')::numeric,
              'stockUnitPrice', (x.value->>'unitPrice')::numeric / (x.value->>'purchaseConversionFactor')::numeric))
            from jsonb_array_elements(v_po.items) x));
        select * into v_po from public.purchase_orders where id = v_po.id;
      end if;
      perform app_private.procurement_notify(v_po.created_by_id::uuid, 'Đơn hàng đã được duyệt',
        v_po.po_number || ' đã duyệt — gửi NCC và theo dõi giao hàng.', v_po.id, 'responsible');
    else
      update public.purchase_orders set status = 'returned', submitted_to_user_id = null, submitted_to_name = null,
        submitted_to_permission = null, last_action_by = v_actor::text, last_action_at = now(),
        metadata = metadata || jsonb_build_object('returnReason', v_reason)
      where id = v_po.id returning * into v_po;
      perform app_private.procurement_notify(v_po.created_by_id::uuid, 'Đơn hàng bị trả lại',
        v_po.po_number || ': ' || v_reason, v_po.id, 'responsible');
    end if;
  elsif v_action = 'delete' then
    if v_po.status <> 'draft' or v_po.ever_submitted or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_DELETE_DENIED'; end if;
    delete from public.purchase_order_request_lines where purchase_order_id = v_po.id;
    delete from public.procurement_po_plan_links where purchase_order_id = v_po.id;
    delete from public.purchase_orders where id = v_po.id;
  else
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID';
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, v_action, v_actor, v_reason,
    case when v_to is null then '{}'::jsonb else jsonb_build_object('approverUserId', v_to) end);
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po.id, 'status', case when v_action = 'delete' then 'deleted' else v_po.status end,
    'rowVersion', v_po.row_version);
end;
$$;

CREATE OR REPLACE FUNCTION app_private.guard_project_purchase_order_room_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_is_admin boolean := public.is_admin();
  v_workflow_changed boolean;
begin
  if v_actor is null and session_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  -- Mua hàng (procurement hub) RPCs check their own permissions and approval rules.
  if app_private.procurement_hub_context_enabled() then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    if old.source_mode = 'company_consolidated' or v_is_admin then return old; end if;
    if v_actor is null
      or nullif(old.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'delete'
      ) then
      raise exception 'Bạn phải là người tạo PO và có quyền Xóa trong Room Đơn hàng PO.'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.source_mode = 'company_consolidated' then return new; end if;
    if v_is_admin then return new; end if;
    -- 01/10/2026: đơn hàng từ phiếu nhu cầu chỉ được lập tại Mua hàng.
    if new.source_mode in ('from_request', 'proactive_project') then
      raise exception using errcode = '42501', message = 'PURCHASE_ORDER_CREATE_MOVED_TO_PROCUREMENT';
    end if;
    if v_actor is null
      or new.status <> 'draft'
      or nullif(new.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, new.project_id, new.construction_site_id, 'material_po', 'edit'
      ) then
      raise exception 'Bạn cần quyền Sửa và phải là người tạo PO nháp.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.source_mode = 'company_consolidated' and new.source_mode = 'company_consolidated' then
    return new;
  end if;
  if v_is_admin then return new; end if;
  if v_actor is null then
    raise exception 'Không xác định được người thao tác PO.' using errcode = '42501';
  end if;
  if new.project_id is distinct from old.project_id
    or new.construction_site_id is distinct from old.construction_site_id
    or new.created_by_id is distinct from old.created_by_id
    or new.source_mode is distinct from old.source_mode then
    raise exception 'Không được thay đổi scope, nguồn hoặc người tạo PO.' using errcode = '42501';
  end if;

  if new.archived_at is distinct from old.archived_at then
    if nullif(old.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'delete'
      ) then
      raise exception 'Bạn phải là người tạo PO và có quyền Xóa trong Room Đơn hàng PO.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  v_workflow_changed := new.status is distinct from old.status
    or new.submitted_to_user_id is distinct from old.submitted_to_user_id
    or new.submitted_to_name is distinct from old.submitted_to_name
    or new.submitted_to_permission is distinct from old.submitted_to_permission
    or new.submission_note is distinct from old.submission_note
    or new.received_transaction_ids is distinct from old.received_transaction_ids
    or new.actual_delivery_date is distinct from old.actual_delivery_date;

  if old.status in ('draft', 'returned') and new.status = 'sent' then
    if nullif(old.created_by_id, '') <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'submit'
      ) then
      raise exception 'Bạn phải là người tạo PO và có quyền Gửi.' using errcode = '42501';
    end if;
    if new.submitted_to_user_id is null
      or not app_private.project_user_has_room_action(
        new.submitted_to_user_id::uuid,
        old.project_id,
        old.construction_site_id,
        'material_po',
        'approve'
      ) then
      raise exception 'Người nhận phải có quyền Duyệt thuần trong Room Đơn hàng PO.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'sent' and new.status in ('confirmed', 'returned') then
    if old.submitted_to_user_id is null
      or old.submitted_to_user_id::text <> v_actor::text
      or not app_private.project_actor_has_effective_room_action(
        v_actor, old.project_id, old.construction_site_id, 'material_po', 'approve'
      ) then
      raise exception 'Bạn cần quyền Duyệt và phải là người được giao xử lý PO.' using errcode = '42501';
    end if;
    if new.status = 'returned' and (
      new.submitted_to_user_id is not null
      or new.submitted_to_name is not null
      or new.submitted_to_permission is not null
    ) then
      raise exception 'PO Trả lại phải xóa assignment duyệt cũ.' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_workflow_changed then
    if new.status = 'cancelled' then
      if not (
        app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(old.target_warehouse_id)
        or app_private.group_po_actor_is_site_keeper(old.id, old.metadata)
      ) then
        raise exception 'Chỉ System Admin hoặc Thủ kho được hủy PO.' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.status in ('confirmed', 'in_transit', 'partial', 'delivered', 'closed')
      or old.status in ('confirmed', 'in_transit', 'partial', 'delivered') then
      if not (
        app_private.project_actor_has_effective_room_action(
          v_actor, old.project_id, old.construction_site_id, 'material_po', 'confirm'
        )
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(old.target_warehouse_id)
        or app_private.group_po_actor_is_site_keeper(old.id, old.metadata)
      ) then
        raise exception 'Bạn cần quyền Xác nhận để quản lý giao nhận PO.' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'Transition PO không hợp lệ.' using errcode = '42501';
  end if;

  if app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(old.target_warehouse_id)
        or app_private.group_po_actor_is_site_keeper(old.id, old.metadata) then
    return new;
  end if;
  if current_setting('app.material_transition_context', true) = 'on'
    and (
      new.supplemental_approval_status is distinct from old.supplemental_approval_status
      or new.approved_total_amount is distinct from old.approved_total_amount
    )
    and app_private.project_actor_has_effective_room_action(
      v_actor, old.project_id, old.construction_site_id, 'material_po', 'approve'
    ) then
    return new;
  end if;
  if old.status not in ('draft', 'returned')
    or new.status not in ('draft', 'returned')
    or nullif(old.created_by_id, '') <> v_actor::text
    or not app_private.project_actor_has_effective_room_action(
      v_actor, old.project_id, old.construction_site_id, 'material_po', 'edit'
    ) then
    raise exception 'Chỉ người tạo có quyền Sửa mới được sửa PO draft/returned.' using errcode = '42501';
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.save_procurement_delivery_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po public.purchase_orders%rowtype;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_batch_id uuid := nullif(p_input->>'deliveryId', '')::uuid;
  v_no integer;
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_to uuid := nullif(p_input->>'approverUserId', '')::uuid;
  v_lines jsonb := '[]'::jsonb; ln jsonb; v_item jsonb;
  v_pq numeric; v_sq numeric; v_price numeric; v_amount numeric := 0; v_budget numeric; v_over boolean;
  v_group boolean; v_wh text; v_mode text; v_scope record;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_PO_STATE'; end if;
  -- Việc 2: đơn gom — mỗi đợt giao về một công trường chọn trong các kho của đơn.
  v_group := app_private.procurement_po_is_group(v_po.metadata);
  v_wh := case when v_group then nullif(p_input->>'targetWarehouseId', '') else v_po.target_warehouse_id end;
  v_mode := case when p_input->>'allocationMode' = 'ratio' then 'ratio' else 'earliest' end;
  if v_wh is null then
    raise exception using errcode = '22023', message = case when v_group then 'PROCUREMENT_GROUP_SITE_REQUIRED' else 'PROCUREMENT_PO_WAREHOUSE_REQUIRED' end; end if;
  if v_group and not exists (select 1 from app_private.group_po_link_allocation(v_po.id) g where g.warehouse_id = v_wh) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_GROUP_SITE_INVALID'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;
  if jsonb_typeof(p_input->'lines') is distinct from 'array' or jsonb_array_length(p_input->'lines') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;

  if v_batch_id is not null then
    select * into v_batch from public.purchase_order_delivery_batches where id = v_batch_id and purchase_order_id = v_po.id for update;
    if not found or v_batch.status <> 'planned' or v_batch.wms_transaction_id is not null
      or coalesce(v_batch.approval_status, 'draft') not in ('draft', 'rejected', 'revision_requested') then
      raise exception using errcode = '42501', message = 'PROCUREMENT_DELIVERY_NOT_EDITABLE'; end if;
    v_no := v_batch.delivery_no;
  else
    v_batch_id := gen_random_uuid();
    select coalesce(max(delivery_no), 0) + 1 into v_no from public.purchase_order_delivery_batches where purchase_order_id = v_po.id;
  end if;

  for ln in select value from jsonb_array_elements(p_input->'lines') loop
    select x.value into v_item from jsonb_array_elements(v_po.items) x
    where coalesce(x.value->>'lineId', x.value->>'itemId') = ln->>'purchaseOrderLineId' limit 1;
    if v_item is null then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
    if v_group and not exists (select 1 from app_private.group_po_link_allocation(v_po.id) g
        where g.warehouse_id = v_wh and g.po_line_id = ln->>'purchaseOrderLineId') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_GROUP_LINE_NOT_AT_SITE'; end if;
    v_pq := nullif(ln->>'purchaseQty', '')::numeric; v_sq := nullif(ln->>'stockQty', '')::numeric;
    v_price := coalesce(nullif(ln->>'unitPrice', '')::numeric, 0);
    if v_pq is null or v_pq <= 0 or v_sq is null or v_sq <= 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    if exists (select 1 from jsonb_array_elements(v_lines) e where e.value->>'purchaseOrderLineId' = ln->>'purchaseOrderLineId') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('purchaseOrderLineId', ln->>'purchaseOrderLineId',
      'itemId', v_item->>'itemId', 'purchaseQty', v_pq, 'purchaseUnit', coalesce(v_item->>'purchaseUnitSnapshot', v_item->>'unit'),
      'stockQty', v_sq, 'stockUnit', coalesce(v_item->>'stockUnitSnapshot', v_item->>'unitSnapshot', v_item->>'unit'),
      'purchaseUnitPrice', v_price));
    v_amount := v_amount + v_pq * v_price;
  end loop;

  v_budget := coalesce(nullif(v_po.approved_total_amount, 0), v_po.total_amount, 0);
  v_over := app_private.procurement_po_committed_amount(v_po.id, v_batch_id) + v_amount > v_budget * 1.0001 + 1;
  if v_over and (v_to is null or v_to = v_actor or not app_private.procurement_po_approver_ok(v_to)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_APPROVER_REQUIRED'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  perform app_private.write_purchase_order_draft_batch_v1(v_po, jsonb_build_object('id', v_batch_id, 'delivery_no', v_no,
    'planned_delivery_date', coalesce(nullif(p_input->>'plannedDate', '')::date, current_date), 'status', 'planned',
    'approval_status', 'draft', 'fulfillment_mode', v_po.fulfillment_mode, 'vat_rate', v_vat,
    'note', nullif(btrim(p_input->>'note'), ''), 'lines', v_lines), v_actor);
  select * into v_scope from app_private.resolve_warehouse_project_scope(v_wh);
  update public.purchase_order_delivery_batches
  set target_warehouse_id = v_wh, allocation_mode = v_mode,
      project_id = case when v_group then v_scope.project_id else project_id end,
      construction_site_id = case when v_group then v_scope.construction_site_id else construction_site_id end
  where id = v_batch_id;
  update public.purchase_order_delivery_batches
  set approval_status = case when v_over then 'pending_approval' else 'approved' end,
      approval_requested_by = v_actor, approval_requested_at = now(),
      approval_assignee_user_id = case when v_over then v_to end,
      approval_decided_by = case when v_over then null else v_actor end,
      approval_decided_at = case when v_over then null else now() end
  where id = v_batch_id;
  if v_over then
    perform app_private.procurement_notify(v_to, 'Đợt giao cần duyệt bổ sung',
      v_po.po_number || ' — đợt ' || v_no || ' vượt giá trị đơn đã duyệt.', v_po.id, 'assigned');
  else
    perform app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(v_batch_id, v_actor, gen_random_uuid());
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('purchase_order', v_po.id, case when v_over then 'delivery_request' else 'delivery_create' end, v_actor,
    jsonb_build_object('deliveryNo', v_no, 'amount', v_amount, 'vatRate', v_vat));
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('deliveryId', v_batch_id, 'deliveryNo', v_no, 'needsApproval', v_over, 'amount', v_amount);
end;
$$;

CREATE OR REPLACE FUNCTION app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(p_delivery_batch_id uuid, p_actor_user_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_line public.purchase_order_delivery_lines%rowtype;
  v_qr_token text := 'pod_' || replace(gen_random_uuid()::text, '-', '');
  v_tx_id text := 'tx-po-delivery-' || replace(gen_random_uuid()::text, '-', '');
  v_wms_items jsonb := '[]'::jsonb;
  v_purchase_unit_price numeric;
  v_stock_unit_price numeric;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if coalesce(v_po.source_mode, '') <> 'from_request' then
    raise exception 'Chi chuan bi Dot giao cho Goi mua hang V2 tao tu MR.' using errcode = '22023';
  end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception 'Chi chuan bi Dot giao sau khi Goi da duyet.' using errcode = '22023';
  end if;
  if coalesce(v_batch.status, 'planned') not in ('planned', 'waiting_delivery', 'receiving', 'wms_pending') then
    raise exception 'Trang thai Dot giao khong cho phep tao WMS/QR: %', v_batch.status using errcode = '22023';
  end if;
  if coalesce(v_batch.wms_transaction_id, '') <> '' and coalesce(v_batch.qr_token, '') <> '' then
    return app_private.purchase_delivery_command_result_v2(v_batch.id);
  end if;
  if nullif(trim(coalesce(v_batch.target_warehouse_id, v_po.target_warehouse_id, '')), '') is null then
    raise exception 'Kho nhan hang la bat buoc de tao WMS/QR Dot giao.' using errcode = '22023';
  end if;

  for v_line in
    select *
    from public.purchase_order_delivery_lines
    where delivery_batch_id = v_batch.id
    order by id
  loop
    if coalesce(v_line.planned_qty, 0) <= 0 or coalesce(v_line.stock_planned_qty, 0) <= 0 then
      raise exception 'So luong Dot giao phai lon hon 0.' using errcode = '22023';
    end if;
    v_purchase_unit_price := coalesce(v_line.delivery_unit_price, 0);
    if v_purchase_unit_price < 0 then
      raise exception 'Don gia Dot giao khong duoc am.' using errcode = '22023';
    end if;
    v_stock_unit_price := case
      when coalesce(v_line.stock_planned_qty, 0) > 0
        then v_purchase_unit_price * coalesce(v_line.planned_qty, 0) / coalesce(v_line.stock_planned_qty, 1)
      else 0
    end;

    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id,
      'quantity', v_line.stock_planned_qty,
      'orderedQty', v_line.stock_planned_qty,
      'price', v_stock_unit_price,
      'accountingQty', v_line.planned_qty,
      'accountingUnit', coalesce(v_line.unit, 'DV mua'),
      'accountingPrice', v_purchase_unit_price,
      'purchaseOrderLineId', v_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', v_batch.id,
      'purchaseOrderDeliveryLineId', v_line.id,
      'fulfillmentMode', coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode)
    ));
  end loop;

  if jsonb_array_length(v_wms_items) = 0 then
    raise exception 'Dot giao phai co it nhat mot dong vat tu.' using errcode = '22023';
  end if;

  insert into public.transactions (
    id, type, date, items, target_warehouse_id, supplier_id,
    requester_id, created_by, approver_id, status, note,
    business_partner_id, business_partner_name_snapshot, source_type, source_id
  ) values (
    v_tx_id, 'IMPORT'::public.transaction_type, now(), v_wms_items, coalesce(v_batch.target_warehouse_id, v_po.target_warehouse_id), nullif(coalesce(v_batch.supplier_id, v_po.vendor_id), ''),
    p_actor_user_id, p_actor_user_id, p_actor_user_id, 'PENDING'::public.transaction_status,
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(v_batch.delivery_no::text, 2, '0') || ' dang giao',
    null, nullif(coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name), ''), 'po_delivery_batch', v_batch.id::text
  );

  update public.purchase_order_delivery_batches
  set supplier_id = nullif(coalesce(v_batch.supplier_id, v_po.vendor_id), ''),
      supplier_name_snapshot = nullif(coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name), ''),
      fulfillment_mode = coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode),
      vat_rate = coalesce(v_batch.vat_rate, v_po.vat_rate, 0),
      qr_token = coalesce(v_batch.qr_token, v_qr_token),
      idempotency_key = coalesce(v_batch.idempotency_key, p_idempotency_key),
      wms_transaction_id = v_tx_id,
      status = 'receiving',
      updated_at = now()
  where id = v_batch.id;

  return app_private.purchase_delivery_command_result_v2(v_batch.id);
end;
$$;

CREATE OR REPLACE FUNCTION app_private.post_purchase_receipt_finance_v2(p_delivery_batch_id uuid, p_actor_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_project_finance_id text;
  v_received_gross numeric(18,2);
  v_committed_gross numeric(18,2);
  v_source_ref text := 'purchase_receipt:' || p_delivery_batch_id::text;
  v_description text;
  v_existing_cost public.project_transactions%rowtype;
  v_existing_ap public.supplier_payable_documents%rowtype;
begin
  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  v_received_gross := round(coalesce(v_batch.accepted_gross_amount, 0), 2);
  if v_received_gross <= 0 then
    return;
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  -- Việc 2: đơn gom ghi công nợ và chi phí cho dự án của công trường nhận (đợt giao).
  v_po.project_id := coalesce(v_batch.project_id, v_po.project_id);
  v_po.construction_site_id := coalesce(v_batch.construction_site_id, v_po.construction_site_id);

  select * into v_tx
  from public.transactions
  where id = v_batch.wms_transaction_id
  for update;
  if not found then
    raise exception 'Khong tim thay WMS cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if v_tx.status <> 'COMPLETED'::public.transaction_status then
    raise exception 'Chi ghi nhan chi phi receipt khi WMS da COMPLETED.' using errcode = '22023';
  end if;

  select round(coalesce(sum(
    coalesce(line.planned_qty, 0)
    * coalesce(line.delivery_unit_price, 0)
    * (1 + coalesce(v_batch.vat_rate, 0) / 100)
  ), 0), 2)
  into v_committed_gross
  from public.purchase_order_delivery_lines line
  where line.delivery_batch_id = p_delivery_batch_id;

  select id into v_project_finance_id
  from public.project_finances
  where (v_po.project_id is not null and project_id = v_po.project_id)
     or (v_po.construction_site_id is not null and construction_site_id = v_po.construction_site_id)
  limit 1;

  v_description := 'Nhận hàng NCC '
    || coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp')
    || ' - '
    || coalesce(v_po.po_number, v_po.id)
    || ' - đợt '
    || coalesce(v_batch.delivery_no::text, p_delivery_batch_id::text);

  select * into v_existing_cost
  from public.project_transactions
  where source_ref = v_source_ref
  for update;
  if found then
    if round(coalesce(v_existing_cost.amount, 0), 2) <> v_received_gross then
      raise exception 'Anomaly: chi phi receipt da ton tai voi gia tri khac.' using errcode = 'P0001';
    end if;
  else
    insert into public.project_transactions (
      id, "projectFinanceId", "constructionSiteId",
      project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source,
      "sourceRef", source_ref, contract_cost_item_id,
      cost_classification_status, counterparty_partner_id,
      counterparty_name, attachments, "createdBy", "createdAt"
    )
    values (
      'purchase-receipt-' || p_delivery_batch_id::text,
      coalesce(v_project_finance_id, ''),
      coalesce(v_po.construction_site_id, ''),
      v_po.project_id,
      nullif(v_project_finance_id, ''),
      v_po.construction_site_id,
      'expense',
      'materials',
      v_received_gross,
      v_description,
      current_date::text,
      'workflow',
      v_source_ref,
      v_source_ref,
      null,
      'auto',
      null,
      coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp'),
      coalesce(v_tx.attachments, '[]'::jsonb),
      p_actor_user_id::text,
      now()
    )
    on conflict (source_ref) do nothing;
  end if;

  select * into v_existing_ap
  from public.supplier_payable_documents
  where source_type = 'purchase_delivery_receipt'
    and source_id = p_delivery_batch_id::text
  for update;
  if found then
    if round(coalesce(v_existing_ap.recognized_amount, 0), 2) <> v_received_gross
       or round(coalesce(v_existing_ap.committed_amount, 0), 2) <> v_committed_gross then
      raise exception 'Anomaly: AP receipt da ton tai voi gia tri khac.' using errcode = 'P0001';
    end if;
    return;
  end if;

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
    committed_amount, recognized_amount, credit_amount, status, qr_token,
    metadata, created_by
  )
  values (
    'AP-REC-' || replace(p_delivery_batch_id::text, '-', ''),
    'purchase_delivery_receipt',
    p_delivery_batch_id::text,
    v_po.project_id,
    v_po.construction_site_id,
    v_batch.supplier_id,
    coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp'),
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(coalesce(v_batch.delivery_no, 0)::text, 2, '0'),
    current_date,
    null,
    v_committed_gross,
    v_received_gross,
    0,
    'open',
    'ap_receipt_' || replace(p_delivery_batch_id::text, '-', ''),
    jsonb_build_object(
      'purchaseOrderId', v_po.id,
      'purchaseOrderNo', v_po.po_number,
      'deliveryBatchId', p_delivery_batch_id,
      'wmsTransactionId', v_tx.id,
      'fulfillmentMode', v_batch.fulfillment_mode,
      'sourceRef', v_source_ref
    ),
    p_actor_user_id
  )
  on conflict (source_type, source_id) do nothing;
end;
$$;

CREATE OR REPLACE FUNCTION app_private.material_request_supply_lines_v1(p_request_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(request_id text, line_id text, item_id text, item_name text, sku text, unit text, need_qty numeric, po_ordered_qty numeric, po_received_qty numeric, transfer_open_qty numeric, transfer_received_qty numeric, stock_batch_received_qty numeric, closed_qty numeric, sourced_qty numeric, received_qty numeric, line_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
      coalesce(po.ordered_qty, 0) + coalesce(tr.open_qty, 0) + coalesce(tr.received_qty, 0) + coalesce(bt.received_qty, 0)
        + coalesce(hp.open_qty, 0) + coalesce(hp.received_qty, 0),
      coalesce(po.received_qty, 0) + coalesce(tr.received_qty, 0) + coalesce(bt.received_qty, 0) + coalesce(hp.received_qty, 0)
    from public.requests r
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end) x
    left join public.items i on i.id = x.value->>'itemId'
    left join lateral (
      select round(sum(l.ordered_qty - app_private.procurement_link_credited_v2(o.id, l.purchase_order_line_id, l.ordered_qty, l.id)), 6) ordered_qty,
        sum(app_private.procurement_link_received_v2(o.id, o.items, l.purchase_order_line_id, l.ordered_qty, l.id)) received_qty
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
      -- M2c: mua nóng gắn dòng đề xuất — đã gửi/duyệt/mua tính là có nguồn, đã nhận tính là đã nhận.
      select sum(case when h.status in ('submitted', 'approved_to_buy', 'purchased') then hl.quantity else 0 end) open_qty,
        sum(case when h.status in ('received', 'finance_review', 'reconciled', 'closed') then coalesce(nullif(hl.accepted_quantity, 0), hl.quantity) else 0 end) received_qty
      from public.site_direct_purchase_lines hl
      join public.site_direct_purchases h on h.id = hl.direct_purchase_id and h.hub_flow
      where hl.material_request_id = r.id and hl.request_line_id = x.value->>'lineId' and hl.status <> 'rejected'
    ) hp on true
    left join lateral (
      select sum(c.closed_qty) closed_qty from public.material_request_line_need_closures c
      where c.material_request_id = r.id and c.request_line_id = x.value->>'lineId' and c.status = 'active'
    ) cl on true
    where r.request_origin = 'project'
      and (case when p_request_ids is null then r.status in ('APPROVED', 'IN_TRANSIT') else r.id = any(p_request_ids) end)
  ) s(request_id, line_id, item_id, item_name, sku, unit, need_qty, po_ordered_qty, po_received_qty, transfer_open_qty,
      transfer_received_qty, stock_batch_received_qty, closed_qty, sourced_qty, received_qty);
$$;

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
    select round(sum(k.ordered_qty - app_private.procurement_link_credited_v2(o.id, k.purchase_order_line_id, k.ordered_qty, k.id)), 6) ordered_qty,
      sum(app_private.procurement_link_received_v2(o.id, o.items, k.purchase_order_line_id, k.ordered_qty, k.id)) received_qty
    from public.procurement_po_plan_links k
    join public.purchase_orders o on o.id = k.purchase_order_id and o.status not in ('cancelled', 'returned') and o.archived_at is null
    where k.material_plan_line_id = l.id
  ) po on true
  where p.status = 'approved';
$$;

CREATE OR REPLACE FUNCTION public.close_procurement_po_short_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_return boolean := coalesce((p_input->>'returnToNeed')::boolean, true);
  v_po public.purchase_orders%rowtype;
  v_short numeric;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'PROCUREMENT_CLOSE_REASON_REQUIRED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_PO_STATE'; end if;
  if app_private.procurement_po_has_open_delivery(v_po.id) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_STILL_OPEN'; end if;

  -- Shortfall in stock units across need links, before shrinking them.
  select coalesce(sum(greatest(q.ordered_qty - app_private.procurement_link_received_v2(v_po.id, v_po.items, q.line_id, q.ordered_qty, q.id), 0)), 0)
  into v_short from (
    select id, purchase_order_line_id line_id, ordered_qty from public.purchase_order_request_lines where purchase_order_id = v_po.id
    union all select id, purchase_order_line_id, ordered_qty from public.procurement_po_plan_links where purchase_order_id = v_po.id) q;

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  if v_return then
    -- Each need keeps only what actually arrived, so the rest shows again under Cần mua.
    update public.purchase_order_request_lines l
    set ordered_qty = r.received, ordered_stock_qty_snapshot = r.received
    from (select id, round(app_private.procurement_link_received_v2(v_po.id, v_po.items, purchase_order_line_id, ordered_qty, id), 6) received
          from public.purchase_order_request_lines where purchase_order_id = v_po.id) r
    where l.id = r.id;
    delete from public.procurement_po_plan_links k
    where k.purchase_order_id = v_po.id and app_private.procurement_link_received_v2(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty, k.id) <= 0;
    update public.procurement_po_plan_links k
    set ordered_qty = round(app_private.procurement_link_received_v2(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty, k.id), 6)
    where k.purchase_order_id = v_po.id;
  end if;
  update public.purchase_orders
  set status = 'closed', closed_need_qty = coalesce(closed_need_qty, 0) + v_short,
      last_action_by = v_actor::text, last_action_at = now(),
      metadata = metadata || jsonb_build_object('shortClose', jsonb_build_object('reason', v_reason, 'returnToNeed', v_return,
        'shortStockQty', round(v_short, 3), 'at', now(), 'by', (select name from public.users where id = v_actor)))
  where id = v_po.id returning * into v_po;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'close_short', v_actor, v_reason, jsonb_build_object('returnToNeed', v_return, 'shortStockQty', v_short));
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po.id, 'status', v_po.status, 'shortStockQty', v_short, 'returnToNeed', v_return);
end;
$$;

CREATE OR REPLACE FUNCTION public.post_receipt_reconciliation_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
      select coalesce(sum(greatest(q.ordered_qty - app_private.procurement_link_received_v2(v_po.id, v_po.items, q.line_id, q.ordered_qty, q.id), 0)), 0)
      into v_short from (
        select id, purchase_order_line_id line_id, ordered_qty from public.purchase_order_request_lines where purchase_order_id = v_po.id
        union all select id, purchase_order_line_id, ordered_qty from public.procurement_po_plan_links where purchase_order_id = v_po.id) q;
      update public.purchase_order_request_lines l
      set ordered_qty = r.received, ordered_stock_qty_snapshot = r.received
      from (select id, round(app_private.procurement_link_received_v2(v_po.id, v_po.items, purchase_order_line_id, ordered_qty, id), 6) received
            from public.purchase_order_request_lines where purchase_order_id = v_po.id) r
      where l.id = r.id;
      delete from public.procurement_po_plan_links k
      where k.purchase_order_id = v_po.id and app_private.procurement_link_received_v2(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty, k.id) <= 0;
      update public.procurement_po_plan_links k
      set ordered_qty = round(app_private.procurement_link_received_v2(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty, k.id), 6)
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

CREATE OR REPLACE FUNCTION public.get_procurement_order_v1(p_po_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_po public.purchase_orders%rowtype; v_actor uuid := public.current_app_user_id(); v_hub boolean; v_manage boolean;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_po_id and archived_at is null;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  v_hub := app_private.procurement_po_is_hub(v_po.metadata);
  v_manage := app_private.procurement_can('manage');
  return jsonb_build_object(
    'id', v_po.id, 'poNumber', v_po.po_number, 'status', v_po.status, 'stage', app_private.procurement_po_stage(v_po.status),
    'isHub', v_hub, 'rowVersion', v_po.row_version, 'vendorId', v_po.vendor_id, 'vendorName', v_po.vendor_name,
    'projectId', v_po.project_id, 'constructionSiteId', v_po.construction_site_id,
    'projectCode', (select code from public.projects where id = v_po.project_id),
    'projectName', (select name from public.projects where id = v_po.project_id),
    'targetWarehouseId', v_po.target_warehouse_id, 'warehouseName', (select name from public.warehouses where id = v_po.target_warehouse_id),
    'orderDate', v_po.order_date, 'expectedDeliveryDate', app_private.procurement_date_or_null(v_po.expected_delivery_date),
    'totalAmount', v_po.total_amount, 'vatRate', v_po.vat_rate, 'note', v_po.note,
    'createdById', v_po.created_by_id, 'createdByName', (select name from public.users where id::text = v_po.created_by_id),
    'createdByTitle', (select e.title from public.employees e where e.user_id::text = v_po.created_by_id limit 1),
    'createdAt', v_po.created_at, 'submittedToUserId', v_po.submitted_to_user_id, 'submittedToName', v_po.submitted_to_name,
    'returnReason', v_po.metadata->>'returnReason', 'everSubmitted', v_po.ever_submitted,
    'purchaseMode', v_po.purchase_mode,
    'kind', case when v_po.source_mode in ('proactive_project', 'proactive_stock') then 'proactive' else 'need' end, 'proactive', v_po.metadata->'proactive', 'approvedTotalAmount', v_po.approved_total_amount, 'shortClose', v_po.metadata->'shortClose',
    'isGroup', app_private.procurement_po_is_group(v_po.metadata),
    'sites', case when app_private.procurement_po_is_group(v_po.metadata) then app_private.group_po_sites(v_po) else '[]'::jsonb end,
    'deliveries', app_private.procurement_po_deliveries(v_po.id),
    'returns', app_private.procurement_po_returns(v_po.id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'lineId', coalesce(x.value->>'lineId', x.value->>'itemId'), 'itemId', x.value->>'itemId',
        'name', coalesce(x.value->>'name', x.value->>'itemNameSnapshot'), 'sku', x.value->>'sku', 'unit', x.value->>'unit',
        'qty', coalesce(nullif(x.value->>'qty', '')::numeric, 0), 'unitPrice', coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0),
        'receivedQty', coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), 'note', x.value->>'note', 'specification', x.value->>'specification',
        'returnedQty', coalesce(nullif(x.value->>'returnedQty', '')::numeric, 0),
        'stockUnit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unit'),
        'remainingToDeliver', app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')),
        'factor', coalesce(nullif(x.value->>'purchaseConversionFactor', '')::numeric, 1),
        'stockQty', app_private.procurement_po_line_stock_qty(x.value),
        'allocatedQty', app_private.procurement_po_line_link_total(v_po.id, coalesce(x.value->>'lineId', x.value->>'itemId')),
        'boq', x.value->'boq',
        'allocations', coalesce((select jsonb_agg(a) from (
            select jsonb_build_object('sourceType', 'material_request', 'sourceId', l.material_request_id,
              'code', coalesce(r.code, l.material_request_code), 'lineId', l.request_line_id, 'qty', l.ordered_qty, 'needQty', l.requested_qty,
              'projectCode', (select pr.code from public.projects pr where pr.id = l.project_id), 'warehouseId', l.target_warehouse_id,
              'warehouseName', (select w.name from public.warehouses w where w.id = l.target_warehouse_id), 'excessReason', l.excess_reason) a
            from public.purchase_order_request_lines l left join public.requests r on r.id = l.material_request_id
            where l.purchase_order_id = v_po.id and l.purchase_order_line_id = coalesce(x.value->>'lineId', x.value->>'itemId')
            union all
            select jsonb_build_object('sourceType', 'material_plan', 'sourceId', k.material_plan_id,
              'code', p.code, 'lineId', k.material_plan_line_id, 'qty', k.ordered_qty, 'needQty', pl.requested_qty)
            from public.procurement_po_plan_links k join public.project_material_plans p on p.id = k.material_plan_id
            join public.project_material_plan_lines pl on pl.id = k.material_plan_line_id
            where k.purchase_order_id = v_po.id and k.purchase_order_line_id = coalesce(x.value->>'lineId', x.value->>'itemId')) q), '[]'::jsonb))
        order by x.ordinality)
      from jsonb_array_elements(case when jsonb_typeof(v_po.items) = 'array' then v_po.items else '[]'::jsonb end) with ordinality x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorName', u.name, 'reason', e.reason, 'at', e.created_at, 'payload', e.payload)
        order by e.created_at) from public.procurement_hub_events e left join public.users u on u.id = e.actor_id
      where e.entity_type = 'purchase_order' and e.entity_id = v_po.id), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'canEdit', v_hub and v_manage and v_po.status in ('draft', 'returned') and v_po.created_by_id = v_actor::text,
      'canSubmit', v_hub and v_manage and v_po.status in ('draft', 'returned') and v_po.created_by_id = v_actor::text,
      'canApprove', v_hub and v_po.status = 'sent' and v_po.created_by_id is distinct from v_actor::text
        and (v_po.submitted_to_user_id = v_actor::text or public.is_admin()),
      'canDelete', v_hub and v_manage and v_po.status = 'draft' and not v_po.ever_submitted and v_po.created_by_id = v_actor::text,
      'canDecideReturn', v_hub and v_manage,
      'canLink', v_hub and v_manage and v_po.source_mode = 'proactive_project' and app_private.procurement_proactive_linkable(v_po.status),
      'canAddDelivery', v_hub and v_manage and v_po.status in ('confirmed', 'in_transit', 'partial')
        and exists (select 1 from jsonb_array_elements(v_po.items) x
          where app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')) > 0),
      'canCloseShort', v_hub and v_manage and v_po.status in ('confirmed', 'in_transit', 'partial')
        and not app_private.procurement_po_has_open_delivery(v_po.id)
        and exists (select 1 from jsonb_array_elements(v_po.items) x
          where coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) < coalesce(nullif(x.value->>'qty', '')::numeric, 0) - 0.0005)),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id <> v_actor and u.is_active and u.account_status = 'ACTIVE'
        and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage'))), '[]'::jsonb)
  );
end;
$$;

CREATE OR REPLACE FUNCTION app_private.procurement_po_deliveries(p_po_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'deliveryNo', b.delivery_no, 'status', b.status, 'approvalStatus', b.approval_status,
      'plannedDate', b.planned_delivery_date, 'vatRate', b.vat_rate, 'note', b.note,
      'targetWarehouseId', b.target_warehouse_id, 'warehouseName', (select w.name from public.warehouses w where w.id = b.target_warehouse_id),
      'projectCode', (select pr.code from public.projects pr where pr.id = b.project_id), 'allocationMode', b.allocation_mode,
      'wmsTransactionId', b.wms_transaction_id, 'hasQr', b.qr_token is not null,
      'createdById', b.created_by, 'createdByName', (select u.name from public.users u where u.id = b.created_by),
      'approvalAssigneeId', b.approval_assignee_user_id,
      'approvalAssigneeName', (select u.name from public.users u where u.id = b.approval_assignee_user_id),
      'decisionNote', b.approval_decision_note, 'receivedAt', b.received_at,
      'receivedByName', (select u.name from public.users u where u.id = b.received_by),
      'amount', (select coalesce(sum(coalesce(l.planned_qty, 0) * coalesce(l.delivery_unit_price, 0)), 0) from public.purchase_order_delivery_lines l where l.delivery_batch_id = b.id),
      'acceptedAmount', (select coalesce(sum(coalesce(l.accepted_qty, 0) * coalesce(l.delivery_unit_price, 0)), 0) from public.purchase_order_delivery_lines l where l.delivery_batch_id = b.id),
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('lineId', l.purchase_order_line_id, 'itemId', l.item_id,
          'name', coalesce(i.name, l.item_id), 'plannedQty', l.planned_qty, 'unit', l.unit,
          'stockPlannedQty', l.stock_planned_qty, 'stockUnit', l.stock_unit, 'unitPrice', l.delivery_unit_price,
          'acceptedQty', l.accepted_qty, 'acceptedStockQty', l.accepted_stock_qty) order by i.name), '[]'::jsonb)
        from public.purchase_order_delivery_lines l left join public.items i on i.id = l.item_id where l.delivery_batch_id = b.id))
    order by b.delivery_no), '[]'::jsonb)
  from public.purchase_order_delivery_batches b where b.purchase_order_id = p_po_id;
$$;

CREATE OR REPLACE FUNCTION public.list_procurement_orders_v1(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_actor text := public.current_app_user_id()::text;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with pos as (
      select o.*, app_private.procurement_po_stage(o.status) stage,
        app_private.procurement_date_or_null(o.expected_delivery_date) expected_date,
        app_private.procurement_po_is_hub(o.metadata) is_hub,
        app_private.procurement_po_awaits_me(o.id, o.status, o.submitted_to_user_id, v_actor) awaits_me,
        coalesce(pr.code, case when app_private.procurement_po_is_group(o.metadata) then (select 'Đơn gom ' || string_agg(distinct p2.code, ', ')
          from public.purchase_order_request_lines k join public.projects p2 on p2.id = k.project_id where k.purchase_order_id = o.id) end) project_code,
        pr.name project_name, app_private.procurement_po_is_group(o.metadata) is_group,
        (select array_agg(distinct k.project_id) from public.purchase_order_request_lines k where k.purchase_order_id = o.id) link_projects,
        (select u.name from public.users u where u.id::text = o.created_by_id) created_by_name,
        (select coalesce(sum(nullif(x.value->>'qty', '')::numeric), 0) from jsonb_array_elements(
          case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x) qty_total,
        (select coalesce(sum(least(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), coalesce(nullif(x.value->>'qty', '')::numeric, 0))), 0)
          from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x) qty_received
      from public.purchase_orders o left join public.projects pr on pr.id = o.project_id
      where o.archived_at is null and o.status <> 'cancelled'
    ),
    filtered as (
      select *, row_number() over (order by case when awaits_me then 0 else 1 end,
        expected_date nulls last, created_at desc) rn
      from pos
      where (coalesce(v_filter->>'stage', 'all') = 'all' or stage = v_filter->>'stage')
        and (nullif(v_filter->>'projectId', '') is null or project_id = v_filter->>'projectId' or (is_group and v_filter->>'projectId' = any(link_projects)))
        and (coalesce(v_filter->>'mine', 'false') <> 'true' or created_by_id = v_actor or submitted_to_user_id = v_actor)
        and (nullif(v_filter->>'search', '') is null or lower(concat_ws(' ', po_number, vendor_name, project_code, project_name))
          like '%' || lower(v_filter->>'search') || '%')
    )
    select jsonb_build_object(
      'today', v_today,
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
          'id', f.id, 'poNumber', f.po_number, 'status', f.status, 'stage', f.stage, 'isHub', f.is_hub, 'isGroup', f.is_group,
          'vendorName', f.vendor_name, 'projectId', f.project_id, 'projectCode', f.project_code, 'projectName', f.project_name,
          'constructionSiteId', f.construction_site_id, 'totalAmount', f.total_amount, 'vatRate', f.vat_rate,
          'orderDate', f.order_date, 'expectedDeliveryDate', f.expected_date,
          'late', f.stage in ('ordered', 'delivering') and f.expected_date < v_today,
          'lineCount', jsonb_array_length(case when jsonb_typeof(f.items) = 'array' then f.items else '[]'::jsonb end),
          'qtyTotal', f.qty_total, 'qtyReceived', f.qty_received,
          'createdById', f.created_by_id, 'createdByName', f.created_by_name,
          'submittedToUserId', f.submitted_to_user_id, 'submittedToName', f.submitted_to_name,
          'awaitingMe', f.awaits_me, 'purchaseMode', f.purchase_mode,
          'kind', case when f.source_mode in ('proactive_project', 'proactive_stock') then 'proactive' else 'need' end,
          'returnsPending', (select count(*) from public.purchase_order_supplier_returns r where r.purchase_order_id = f.id and r.status <> 'cancelled' and r.resolution is null),
          'sources', app_private.procurement_po_sources(f.id)) order by f.rn) from filtered f where f.rn <= 300), '[]'::jsonb),
      'awaitingMyApproval', (select count(*) from pos where awaits_me)
    )
  );
end;
$$;

notify pgrst, 'reload schema';

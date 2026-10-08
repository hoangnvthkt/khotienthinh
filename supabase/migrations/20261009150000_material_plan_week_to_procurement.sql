-- Chỉ kế hoạch vật tư TUẦN là đề nghị mua (chủ SP chốt 08/10/2026).
-- Rà soát 08/10: KH vật tư tháng và tuần cùng kỳ đều vào Mua hàng → Cần mua, cùng vật tư bị đề nghị hai lần
-- (tháng + từng tuần), dễ mua trùng. Từ nay KH vật tư tháng là dự báo của công trường, không vào Cần mua.
-- KH vật tư tháng đã có đơn đặt (liên kết PO) vẫn hiện để Mua hàng theo dõi phần đã đặt, không mất dấu.

create or replace function app_private.material_plan_goes_to_procurement(p_plan_id uuid, p_period_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_period_type = 'week'
    or exists (select 1 from public.procurement_po_plan_links k where k.material_plan_id = p_plan_id);
$$;
revoke all on function app_private.material_plan_goes_to_procurement(uuid, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.procurement_inbox_documents()
returns table (source_type text, source_id text, code text, title text, project_id text, construction_site_id text,
  warehouse_id text, needed_date date, requester_name text, approved_at timestamptz, approved_by_name text, created_at timestamptz,
  period_type text, period_start date, closed_at timestamptz, close_reason text, closed_by_name text)
language sql stable security definer set search_path = '' as $$
  select d.*, c.closed_at, c.reason, (select u.name from public.users u where u.id = c.closed_by)
  from (
    select 'material_request' source_type, r.id source_id, r.code, r.title, r.project_id, r.construction_site_id,
      r.site_warehouse_id warehouse_id, r.expected_date::date needed_date, (select u.name from public.users u where u.id = r.requester_id) requester_name,
      null::timestamptz approved_at, null::text approved_by_name, coalesce(r.created_date, r.created_at) created_at, null::text period_type, null::date period_start
    from public.requests r
    where r.request_origin = 'project' and (r.status in ('APPROVED', 'IN_TRANSIT')
      -- Kết thúc do Mua hàng đóng nhu cầu: vẫn ở tab "Đã đóng" để mở lại được.
      or (r.status = 'COMPLETED' and r.workflow_step = 'ended' and exists (select 1 from public.procurement_need_closures nc
        where nc.source_type = 'material_request' and nc.source_id = r.id)))
    union all
    select 'material_plan', p.id::text, p.code,
      'Kế hoạch vật tư ' || case p.period_type when 'month' then 'tháng ' || to_char(p.period_start, 'MM/YYYY')
        else 'tuần ' || to_char(p.period_start, 'DD/MM') || '–' || to_char(p.period_end, 'DD/MM/YYYY') end,
      p.project_id, p.construction_site_id, p.destination_warehouse_id, coalesce(p.needed_date, p.period_start),
      (select u.name from public.users u where u.id = p.created_by), p.approved_at,
      (select u.name from public.users u where u.id = p.approved_by), p.created_at, p.period_type, p.period_start
    from public.project_material_plans p where p.status = 'approved' and app_private.material_plan_goes_to_procurement(p.id, p.period_type)
  ) d
  left join public.procurement_need_closures c on c.source_type = d.source_type and c.source_id = d.source_id;
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
  select 'material_request', s.request_id, s.line_id, s.item_id, s.item_name, s.sku, s.unit, s.need_qty, s.sourced_qty, s.received_qty
  from app_private.material_request_supply_lines_v1(coalesce((select array_agg(r.id) from public.requests r
    join public.procurement_need_closures nc on nc.source_type = 'material_request' and nc.source_id = r.id
    where r.request_origin = 'project' and r.status = 'COMPLETED' and r.workflow_step = 'ended'), '{}'::text[])) s
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
  where p.status = 'approved' and app_private.material_plan_goes_to_procurement(p.id, p.period_type);
$$;

notify pgrst, 'reload schema';

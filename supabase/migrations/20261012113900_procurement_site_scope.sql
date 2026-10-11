-- Mua hàng phục vụ cả người công trường, để bỏ tab Đơn hàng PO + Mua nóng khỏi Dự án (audit 11/10/2026).
--
-- Thực tế (Cloud 12/10): từ 26/09 không còn PO nào lập ở tab Dự án; người lập/duyệt PO đều đã dùng Mua hàng.
-- Nhưng 18 nhân viên đang xem PO qua quyền phòng dự án "Đơn hàng PO" (material_po · view) mà không có quyền
-- Mua hàng; bỏ tab là họ mất chỗ xem hàng về. Mua nóng ở Mua hàng chỉ phòng Mua hàng lập được, trong khi ở
-- Dự án người có quyền "Mua trực tiếp" của dự án lập được.
--
-- Luật:
--   * Danh sách + chi tiết đơn ở Mua hàng: phòng Mua hàng xem mọi đơn như cũ; người có material_po · view của
--     dự án xem đơn của dự án đó (kể cả đơn gom có dòng của dự án). Không thêm quyền thao tác: mọi nút trong
--     chi tiết đơn vẫn theo procurement_can('manage') / người được trình duyệt như cũ.
--   * Mua nóng ở Mua hàng: lập được nếu là phòng Mua hàng hoặc có quyền lập mua nóng ở dự án (hot_purchase_can_create),
--     chỉ cho đúng các dự án đó.
-- Thân hàm lấy từ định nghĩa đang chạy trên Cloud, chỉ vá đúng các dòng trên.

create or replace function app_private.procurement_po_view_project_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(distinct pr.id::text), '{}'::text[])
  from public.projects pr
  where exists (
      select 1 from public.project_staff staff
      where staff.user_id = public.current_app_user_id()::text
        and staff.project_id = pr.id::text
        and staff.end_date is null
    )
    and (
      app_private.current_actor_has_effective_room_action(pr.id::text, pr.construction_site_id::text, 'material_po', 'view')
      or app_private.current_actor_has_effective_room_action(pr.id::text, null, 'material_po', 'view')
    );
$$;

revoke all on function app_private.procurement_po_view_project_ids() from public, anon;
grant execute on function app_private.procurement_po_view_project_ids() to authenticated;

-- Thanh tab Mua hàng cho người công trường: dự án được xem đơn + có lập được mua nóng không.
create or replace function public.get_procurement_site_scope_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with po as (select app_private.procurement_po_view_project_ids() ids)
  select jsonb_build_object(
    'procurementView', app_private.procurement_can('view'),
    'orderProjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', pr.id, 'code', pr.code, 'name', pr.name) order by pr.code)
      from public.projects pr, po where pr.id::text = any(po.ids)), '[]'::jsonb),
    'canCreateHotPurchase', app_private.procurement_can('manage') or exists (
      select 1 from public.projects pr
      where app_private.hot_purchase_can_create(pr.id::text, pr.construction_site_id::text)
        and exists (select 1 from public.warehouses w where w.project_id = pr.id and not coalesce(w.is_archived, false)))
  )
  where public.current_app_user_id() is not null;
$$;

revoke all on function public.get_procurement_site_scope_v1() from public, anon;
grant execute on function public.get_procurement_site_scope_v1() to authenticated;

CREATE OR REPLACE FUNCTION public.list_procurement_orders_v1(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_actor text := public.current_app_user_id()::text;
  -- NULL = phòng Mua hàng (xem mọi đơn); mảng = người công trường, chỉ đơn của dự án mình.
  v_scope text[];
begin
  if not app_private.procurement_can('view') then
    v_scope := app_private.procurement_po_view_project_ids();
    if pg_catalog.cardinality(v_scope) = 0 then
      raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  end if;
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
        and (v_scope is null or project_id = any(v_scope) or (is_group and link_projects::text[] && v_scope))
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
          'sources', app_private.procurement_po_sources(f.id)||coalesce((select jsonb_agg(jsonb_build_object('sourceType','request','sourceId',rp.request_id,'code',r.document->>'code')) from app_private.request_purchase_po_links rp join app_private.procurement_source_receipts r on r.source_type='request' and r.source_id=rp.request_id where rp.purchase_order_id=f.id),'[]'::jsonb)) order by f.rn) from filtered f where f.rn <= 300), '[]'::jsonb),
      'awaitingMyApproval', (select count(*) from pos where awaits_me)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_procurement_order_v1(p_po_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_po public.purchase_orders%rowtype; v_actor uuid := public.current_app_user_id(); v_hub boolean; v_manage boolean;
begin
  select * into v_po from public.purchase_orders where id = p_po_id and archived_at is null;
  -- Người công trường có quyền xem PO của dự án (phòng material_po) xem được đơn đó, chỉ xem.
  if not app_private.procurement_can('view') and not (
    v_po.project_id = any(app_private.procurement_po_view_project_ids())
    or exists (select 1 from public.purchase_order_request_lines k
      where k.purchase_order_id = v_po.id and k.project_id::text = any(app_private.procurement_po_view_project_ids()))
  ) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  if v_po.id is null then raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  v_hub := app_private.procurement_po_is_hub(v_po.metadata);
  v_manage := app_private.procurement_can('manage');
  return jsonb_build_object(
    'requestSource',(select jsonb_build_object('id',l.request_id,'code',r.document->>'code','kind',l.kind) from app_private.request_purchase_po_links l join app_private.procurement_source_receipts r on r.source_type='request' and r.source_id=l.request_id where l.purchase_order_id=v_po.id),
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
    'kind', case when v_po.source_mode in ('proactive_project', 'proactive_stock') then 'proactive' else 'need' end, 'proactive', v_po.metadata->'proactive', 'approvedTotalAmount', v_po.approved_total_amount, 'shortClose', v_po.metadata->'shortClose', 'budgetApproval', v_po.metadata->'budgetApproval',
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
$function$;

CREATE OR REPLACE FUNCTION public.list_hot_purchases_v1(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'HOT_PURCHASE_DENIED'; end if;
  return (with rows as materialized (
      select p.* from public.site_direct_purchases p
      where p.hub_flow
        and (nullif(v_filter->>'projectId', '') is null or p.project_id = v_filter->>'projectId')
        and (nullif(v_filter->>'constructionSiteId', '') is null or p.construction_site_id = v_filter->>'constructionSiteId')
        and app_private.hot_purchase_can_view(p))
    select jsonb_build_object(
      'threshold', app_private.hot_purchase_threshold(),
      'canCreate', case when nullif(v_filter->>'projectId', '') is null then app_private.procurement_can('manage')
          or exists (select 1 from public.projects pr where app_private.hot_purchase_can_create(pr.id::text, pr.construction_site_id::text)
            and exists (select 1 from public.warehouses w where w.project_id = pr.id and not coalesce(w.is_archived, false)))
        else app_private.hot_purchase_can_create(v_filter->>'projectId', nullif(v_filter->>'constructionSiteId', '')) end,
      'purchases', coalesce((select jsonb_agg(app_private.hot_purchase_json(r) order by r.created_at desc) from rows r), '[]'::jsonb),
      -- Dự án + kho để lập phiếu: ở dự án chỉ dự án đó; ở Mua hàng mọi dự án có kho công trường
      -- (phòng Mua hàng) hoặc dự án người công trường được lập mua nóng.
      'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'code', pr.code, 'name', pr.name,
          'warehouses', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'constructionSiteId', w.construction_site_id) order by w.name)
            from public.warehouses w where w.project_id = pr.id and not coalesce(w.is_archived, false)), '[]'::jsonb)) order by pr.code)
        from public.projects pr
        where (nullif(v_filter->>'projectId', '') is not null and pr.id = v_filter->>'projectId')
          or (nullif(v_filter->>'projectId', '') is null
            and (app_private.procurement_can('manage') or app_private.hot_purchase_can_create(pr.id::text, pr.construction_site_id::text))
            and exists (select 1 from public.warehouses w where w.project_id = pr.id and not coalesce(w.is_archived, false)))), '[]'::jsonb)));
end $function$;

notify pgrst, 'reload schema';

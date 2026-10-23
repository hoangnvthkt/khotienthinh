-- Đợt 2 audit mẫu quyền (chủ SP duyệt 23/10/2026): quyền "Duyệt PO" tách khỏi "Quản trị Mua hàng".
-- Lý do gấp: 23/10 đã gỡ Quản trị Mua hàng của chị Mơ (quyết định 4) trong khi hàm duyệt PO còn đòi quyền đó →
-- 28 PO đang chờ chị Mơ không duyệt được. Chủ SP chốt: người duyệt PO = chị Đặng Thị Thu Hà và chị Nguyễn Thị Mơ.
-- Người lập vẫn không tự duyệt đơn của mình (đã có sẵn). Admin vẫn qua mọi bước nhưng không còn nằm trong danh sách chọn.

insert into public.permission_actions (module_code, action, permission_code, label, description, scope_modes, legacy_module_key,
  legacy_route, legacy_admin_only, sort_order, is_active, risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code, direct_grant_allowed)
values ('system.procurement', 'approve', 'system.procurement.approve', 'Duyệt PO',
  'Được chọn làm người duyệt đơn mua (PO), đơn gọi hàng vượt hạn mức HĐ nguyên tắc, mua nóng khi công trường không có Chỉ huy trưởng.',
  array['global'], 'PROCUREMENT', '/procurement', false, 30, true, 'sensitive', true, true, false, 'enforced', 'procurement', true)
on conflict (permission_code) do nothing;

-- Người duyệt PO mở được Mua hàng ở chế độ xem.
create or replace function app_private.procurement_can(p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.current_app_user_id() is not null and (
    app_private.has_permission(public.current_app_user_id(), 'system.procurement.' || p_action)
    or (p_action = 'view' and (app_private.has_permission(public.current_app_user_id(), 'system.procurement.manage')
      or app_private.has_permission(public.current_app_user_id(), 'system.procurement.approve'))));
$function$;

-- Người được chọn duyệt PO / đơn gọi hàng vượt hạn mức: quyền Duyệt PO (Admin vẫn qua).
create or replace function app_private.procurement_po_approver_ok(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.users u where u.id = p_user and u.is_active and u.account_status = 'ACTIVE'
    and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.approve')));
$function$;

-- Người duyệt (quyền Duyệt PO) duyệt / trả lại đơn được gửi cho mình mà không cần Quản trị Mua hàng.
create or replace function public.transition_procurement_hub_po_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_to uuid := nullif(p_input->>'approverUserId', '')::uuid;
  v_po public.purchase_orders%rowtype;
  v_name text;
  v_budget jsonb;
begin
  if not (app_private.procurement_can('manage') or public.is_admin()
    or (v_action in ('approve', 'return') and app_private.procurement_can('approve'))) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;

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
      submitted_to_permission = 'system.procurement.approve', submission_note = v_reason, ever_submitted = true,
      last_action_by = v_actor::text, last_action_at = now(), metadata = metadata - 'returnReason' - 'budgetApproval'
    where id = v_po.id returning * into v_po;
    -- Tài chính: đơn làm vật tư của dự án vượt dự toán → báo người duyệt vượt ngân sách ngay khi gửi.
    v_budget := app_private.finance_po_budget_mark(v_po.id, v_actor);
    select * into v_po from public.purchase_orders where id = v_po.id;
    perform app_private.procurement_notify(v_to, 'Đơn hàng chờ bạn duyệt',
      v_po.po_number || ' · ' || coalesce(v_po.vendor_name, '') || ' — ' || to_char(v_po.total_amount, 'FM999G999G999G999') || ' đ', v_po.id, 'assigned');
  elsif v_action in ('approve', 'return') then
    if v_po.status <> 'sent' or v_po.created_by_id = v_actor::text
      or not (v_po.submitted_to_user_id = v_actor::text or public.is_admin()) then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_APPROVE_DENIED'; end if;
    if v_action = 'return' and v_reason is null then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_RETURN_REASON_REQUIRED'; end if;
    if v_action = 'approve' then
      v_budget := app_private.finance_po_budget_mark(v_po.id, v_actor);
      if coalesce((v_budget->>'over')::boolean, false) and v_budget->>'status' <> 'approved' then
        select * into v_po from public.purchase_orders where id = v_po.id;
        perform set_config('app.procurement_hub_context', 'off', true);
        perform set_config('app.material_transition_context', 'off', true);
        return jsonb_build_object('purchaseOrderId', v_po.id, 'status', v_po.status, 'rowVersion', v_po.row_version, 'budgetPending', true,
          'budgetApproverNames', v_po.metadata->'budgetApproval'->'approverNames', 'budget', v_budget->'budget', 'projected', v_budget->'projected');
      end if;
      select * into v_po from public.purchase_orders where id = v_po.id;
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
$function$;

-- Danh sách chọn người duyệt trên đơn: chỉ người có quyền Duyệt PO.
create or replace function public.get_procurement_order_v1(p_po_id text)
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
        and app_private.has_permission(u.id, 'system.procurement.approve')), '[]'::jsonb)
  );
end;
$function$;

-- Danh sách chọn người duyệt đơn gọi hàng vượt hạn mức: chỉ người có quyền Duyệt PO.
create or replace function public.get_procurement_contract_v1(p_contract_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_c public.supplier_contracts%rowtype; v_actor uuid := public.current_app_user_id(); v_buyer boolean := app_private.procurement_can('view');
begin
  select * into v_c from public.supplier_contracts where id = p_contract_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;
  if not app_private.procurement_contract_can_view(v_c) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with dl as materialized (
      select d.*, n.source_delivery_batch_id batch_id, n.purchase_order_id po_id, po.po_number, l.specification spec, l.line_no,
        case when b.id is not null then case b.fulfillment_mode when 'DIRECT_CONSUMPTION' then 'direct' else 'stock' end
          when coalesce(l.wms_flow_mode, 'none') <> 'direct_in_out' then 'none'
          when l.wms_status = 'exported' then 'direct'
          when d.wms_ready then 'stock' else 'pending' end stock_state,
        w.name warehouse_name, pr.code project_code,
        (select cp.unit_price from app_private.procurement_contract_line_price(p_contract_id, d.item_id, l.specification, d.delivery_date) cp) contract_price
      from app_private.procurement_contract_delivery_lines() d
      join public.supplier_direct_delivery_notes n on n.id = d.note_id
      join public.supplier_direct_delivery_lines l on l.id = d.line_id
      left join public.purchase_order_delivery_batches b on b.id = n.source_delivery_batch_id
      left join public.purchase_orders po on po.id = n.purchase_order_id
      left join public.warehouses w on w.id = l.target_warehouse_id
      left join public.projects pr on pr.id = d.project_id
      where d.contract_id = p_contract_id)
    select jsonb_build_object(
      'id', v_c.id, 'code', v_c.code, 'name', v_c.name, 'type', v_c.type, 'status', v_c.status, 'note', v_c.note,
      'supplierId', v_c.supplier_id, 'supplierName', v_c.supplier_name, 'projectId', v_c.project_id,
      'projectCode', (select code from public.projects where id = v_c.project_id), 'projectName', (select name from public.projects where id = v_c.project_id),
      'constructionSiteId', v_c.construction_site_id, 'value', v_c.value, 'paymentTerms', v_c.payment_terms, 'paymentTermDays', v_c.payment_term_days,
      'signedDate', v_c.signed_date, 'effectiveDate', v_c.effective_date, 'expiryDate', v_c.expiry_date,
      'canManage', app_private.procurement_can('manage'), 'isBuyer', v_buyer,
      'canOrder', app_private.procurement_contract_can_order(v_c.project_id, v_c.construction_site_id)
        and coalesce(v_c.status, '') not in ('cancelled', 'completed'),
      -- Người duyệt khi đơn gọi hàng vượt giá trị HĐ / hạn mức.
      'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
        from public.users u where u.id <> v_actor and u.is_active and u.account_status = 'ACTIVE'
          and app_private.has_permission(u.id, 'system.procurement.approve')), '[]'::jsonb),
      'priceLines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'lineNo', l.line_no, 'itemId', l.item_id,
          'sku', coalesce(l.sku_snapshot, i.sku), 'name', coalesce(i.name, l.item_name_snapshot), 'unit', coalesce(l.unit_snapshot, i.unit),
          'unitPrice', l.unit_price, 'vatRate', l.vat_rate, 'quantityLimit', l.quantity_limit, 'amountLimit', l.amount_limit,
          'effectiveFrom', l.effective_from, 'effectiveTo', l.effective_to, 'note', l.note, 'specification', l.specification,
          'used', exists (select 1 from public.supplier_direct_delivery_lines d where d.supplier_contract_line_id = l.id))
        order by coalesce(i.name, l.item_name_snapshot), l.specification nulls first, l.effective_from nulls first)
        from public.supplier_contract_lines l left join public.items i on i.id = l.item_id where l.supplier_contract_id = p_contract_id), '[]'::jsonb),
      'usage', coalesce((select jsonb_agg(u order by u->>'name') from (
          select jsonb_build_object('itemId', d.item_id, 'name', max(d.item_name), 'unit', max(d.unit),
            'deliveredQty', sum(d.qty), 'deliveredValue', sum(d.amount), 'unpricedLines', count(*) filter (where d.price_source = 'missing'),
            'quantityLimit', (select max(l.quantity_limit) from public.supplier_contract_lines l where l.supplier_contract_id = p_contract_id and l.item_id = d.item_id),
            'amountLimit', (select max(l.amount_limit) from public.supplier_contract_lines l where l.supplier_contract_id = p_contract_id and l.item_id = d.item_id),
            'currentPrice', (select cp.unit_price from app_private.procurement_contract_price(p_contract_id, d.item_id, current_date) cp),
            -- Cộng theo mã; từng quy cách vẫn đủ khối lượng + giá trị.
            'specs', coalesce((select jsonb_agg(jsonb_build_object('specification', z2.spec, 'qty', z2.qty, 'value', z2.val) order by z2.spec nulls first)
              from (select d2.spec, sum(d2.qty) qty, sum(d2.amount) val from dl d2 where d2.item_id = d.item_id group by d2.spec) z2), '[]'::jsonb)) u
          from dl d group by d.item_id) z), '[]'::jsonb),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'poNumber', po.po_number, 'status', po.status,
          'totalAmount', po.total_amount, 'vatRate', po.vat_rate, 'expectedDeliveryDate', po.expected_delivery_date,
          'fulfillmentMode', po.fulfillment_mode, 'warehouseName', w.name, 'projectCode', pr.code, 'rowVersion', po.row_version,
          'createdById', po.created_by_id, 'createdByName', (select name from public.users u where u.id::text = po.created_by_id),
          'submittedToName', po.submitted_to_name, 'returnReason', po.metadata->>'returnReason',
          'lines', jsonb_array_length(coalesce(po.items, '[]'::jsonb)),
          'items', po.items, 'targetWarehouseId', po.target_warehouse_id, 'note', po.note, 'purchaseMode', po.purchase_mode,
          'receivedValue', coalesce((select sum(coalesce(dl2.accepted_qty, 0) * coalesce(dl2.delivery_unit_price, 0))
            from public.purchase_order_delivery_lines dl2 join public.purchase_order_delivery_batches b2 on b2.id = dl2.delivery_batch_id
            where dl2.purchase_order_id = po.id and b2.status in ('received', 'received_short', 'received_over')), 0))
        order by po.created_at desc)
        from public.purchase_orders po left join public.warehouses w on w.id = po.target_warehouse_id left join public.projects pr on pr.id = po.project_id
        where po.supplier_contract_id = p_contract_id and po.archived_at is null
          and (v_buyer or po.created_by_id = v_actor::text or app_private.procurement_contract_can_order(po.project_id, po.construction_site_id))), '[]'::jsonb),
      'deliveries', coalesce((select jsonb_agg(jsonb_build_object('noteId', n.note_id, 'code', n.note_code, 'ticketNo', n.ticket_no,
          'date', n.delivery_date, 'purchaseOrderNo', n.po_number, 'projectCode', n.project_code, 'scopeKey', n.scope_key, 'lines', n.lines)
          order by n.delivery_date desc, n.note_code desc)
        from (select note_id, note_code, ticket_no, delivery_date, max(po_number) po_number, max(project_code) project_code,
                coalesce(max(project_id), '') || '|' || coalesce(max(site_id), '') scope_key,
                jsonb_agg(jsonb_build_object('lineId', line_id, 'itemId', item_id,
                'name', item_name, 'specification', spec, 'unit', unit, 'qty', qty, 'unitPrice', unit_price, 'vatRate', vat_rate, 'priceSource', price_source,
                'amount', amount, 'wmsReady', wms_ready, 'stockState', stock_state, 'warehouseName', warehouse_name,
                'contractPrice', contract_price, 'statementId', statement_id, 'statementCode', statement_code,
                'statementStatus', statement_status) order by line_no nulls last, item_name) lines
              from dl group by 1, 2, 3, 4 order by delivery_date desc limit 200) n), '[]'::jsonb),
      'statements', case when not v_buyer then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'periodMonth', s.period_month,
          'status', s.status, 'grossAmount', s.gross_amount, 'vatAmount', s.vat_amount, 'totalAmount', s.total_amount,
          'projectCode', (select code from public.projects where id = s.project_id),
          'lineCount', (select count(*) from public.supplier_delivery_statement_lines x where x.statement_id = s.id),
          'createdByName', (select name from public.users where id = s.created_by), 'postedAt', s.posted_at,
          'postedByName', (select name from public.users where id = s.posted_by),
          'confirmedByName', s.metadata->>'confirmedByName', 'confirmedAt', s.metadata->>'confirmedAt',
          'returnReason', s.metadata->>'returnReason', 'note', s.note,
          'canPost', s.status = 'confirmed' and app_private.procurement_statement_accountant_ok(v_actor, s.project_id, s.construction_site_id))
        order by s.period_month desc, s.created_at desc) from public.supplier_delivery_statements s where s.supplier_contract_id = p_contract_id), '[]'::jsonb) end
    )
  );
end;
$function$;

-- Trợ lý gợi ý người duyệt: chỉ người có quyền Duyệt PO.
create or replace function public.assistant_po_approvers_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid := public.current_app_user_id();
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
    from public.users u where u.id <> a and u.is_active and u.account_status = 'ACTIVE'
      and app_private.has_permission(u.id, 'system.procurement.approve')), '[]'::jsonb);
end $function$;

-- Mua nóng không có Chỉ huy trưởng: người có quyền Duyệt PO duyệt thay Admin.
create or replace function app_private.hot_purchase_can_approve(p_purchase site_direct_purchases)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id();
  v_cmd uuid := app_private.hot_purchase_site_commander(p_purchase.project_id, p_purchase.construction_site_id);
begin
  if v_actor is null or v_actor = p_purchase.created_by then return false; end if;
  if v_cmd is not null and v_cmd is distinct from p_purchase.created_by then return v_actor = v_cmd; end if;
  return public.is_admin() or public.is_module_admin('DA')
    or app_private.has_permission(v_actor, 'system.procurement.approve', 'global', '*');
end $function$;

-- Người duyệt PO theo chốt của chủ SP 23/10/2026.
insert into public.user_permission_grants as g (user_id, permission_code, scope_type, scope_id, is_active, granted_at, grant_reason, created_at, updated_at)
select u.id, 'system.procurement.approve', 'global', '*', true, now(), 'Đợt 2 audit mẫu quyền 23/10/2026: người duyệt PO', now(), now()
from public.users u
where u.is_active and u.account_status = 'ACTIVE'
  and u.email in ('hadtt@tienthinhjsc.vn', 'mont@tienthinhjsc.vn') -- Đặng Thị Thu Hà, Nguyễn Thị Mơ
on conflict (user_id, permission_code, scope_type, scope_id) do update
set is_active = true, revoked_at = null, revoked_by = null, revoked_reason = null,
    granted_at = now(), expires_at = null, grant_reason = excluded.grant_reason, updated_at = now();

notify pgrst, 'reload schema';

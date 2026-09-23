-- G5 atomic PO command generalized for exact canonical demand sources.
create or replace function app_private.create_procurement_purchase_order_v1(
  p_purchase_order jsonb,
  p_request_line_links jsonb,
  p_allocations jsonb,
  p_actor_user_id uuid,
  p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(btrim(coalesce(p_purchase_order ->> 'id', '')), '');
  v_allocation jsonb;
  v_line public.procurement_demand_lines%rowtype;
  v_execution_line public.procurement_source_line_registry%rowtype;
  v_po_result jsonb;
  v_allocation_result jsonb;
  v_allocation_ids jsonb := '[]'::jsonb;
  v_prior app_private.procurement_purchase_order_commands%rowtype;
  v_payload_hash text;
  v_normalized_items jsonb;
  v_normalized_links jsonb;
  v_normalized_allocations jsonb;
  v_result jsonb;
  v_requested_count integer;
  v_locked_count integer;
  v_request_source_count integer;
  v_po_line_count integer;
begin
  if v_actor is null or p_actor_user_id is null or p_actor_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'PROCUREMENT_PURCHASE_ORDER_ACTOR_INVALID';
  end if;
  if v_po_id is null or p_idempotency_key is null
     or coalesce(p_purchase_order ->> 'source_mode', '') <> 'company_consolidated'
     or jsonb_typeof(coalesce(p_request_line_links, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0
     or jsonb_typeof(coalesce(p_purchase_order -> 'items', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_purchase_order -> 'items', '[]'::jsonb))
       <> jsonb_array_length(p_allocations) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PURCHASE_ORDER_PAYLOAD_INVALID';
  end if;
  if nullif(p_purchase_order ->> 'project_id', '') is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PURCHASE_ORDER_SCOPE_REQUIRED';
  end if;

  select count(distinct value ->> 'demandLineId') into v_requested_count
  from jsonb_array_elements(p_allocations) item(value);
  if v_requested_count <> jsonb_array_length(p_allocations)
     or (select count(distinct value ->> 'purchaseOrderLineId')
       from jsonb_array_elements(p_allocations) item(value)) <> v_requested_count
     or exists (
       select 1 from jsonb_array_elements(p_allocations) item(value)
       where nullif(value ->> 'demandLineId', '') is null
          or nullif(value ->> 'sourceRevisionId', '') is null
          or nullif(value ->> 'purchaseOrderLineId', '') is null
          or nullif(value ->> 'needQty', '') is null
          or nullif(value ->> 'needUnit', '') is null
          or nullif(value ->> 'executionQty', '') is null
          or nullif(value ->> 'executionUnit', '') is null
          or nullif(value ->> 'expectedVersion', '') is null
     ) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_ALLOCATION_PAYLOAD_INVALID';
  end if;
  select count(distinct value ->> 'lineId') into v_po_line_count
  from jsonb_array_elements(p_purchase_order -> 'items') item(value);
  if v_po_line_count <> v_requested_count or exists (
    select 1 from jsonb_array_elements(p_purchase_order -> 'items') item(value)
    where nullif(item.value ->> 'lineId', '') is null
      or nullif(item.value ->> 'itemId', '') is null
      or nullif(coalesce(item.value ->> 'purchaseUnitSnapshot', item.value ->> 'unit'), '') is null
  ) or exists (
    select 1 from jsonb_array_elements(p_allocations) allocation(value)
    where not exists (select 1 from jsonb_array_elements(p_purchase_order -> 'items') item(value)
      where item.value ->> 'lineId' = allocation.value ->> 'purchaseOrderLineId')
  ) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_LINE_IDENTITY_INVALID';
  end if;

  select coalesce(jsonb_agg(item.value - 'lineId' order by item.ordinality), '[]'::jsonb)
  into v_normalized_items
  from jsonb_array_elements(coalesce(p_purchase_order -> 'items', '[]'::jsonb))
    with ordinality item(value, ordinality);
  select coalesce(jsonb_agg(link.value
    - 'purchase_order_id' - 'purchase_order_line_id'
    order by link.value ->> 'material_request_id', link.value ->> 'request_line_id'
  ), '[]'::jsonb)
  into v_normalized_links
  from jsonb_array_elements(p_request_line_links) link(value);
  select coalesce(jsonb_agg(allocation.value - 'purchaseOrderLineId'
    order by allocation.value ->> 'demandLineId'
  ), '[]'::jsonb)
  into v_normalized_allocations
  from jsonb_array_elements(p_allocations) allocation(value);
  v_payload_hash := md5(jsonb_build_object(
    'projectId', p_purchase_order -> 'project_id',
    'constructionSiteId', p_purchase_order -> 'construction_site_id',
    'targetWarehouseId', p_purchase_order -> 'target_warehouse_id',
    'vendorId', p_purchase_order -> 'vendor_id',
    'orderDate', p_purchase_order -> 'order_date',
    'expectedDeliveryDate', p_purchase_order -> 'expected_delivery_date',
    'status', p_purchase_order -> 'status',
    'sourceMode', p_purchase_order -> 'source_mode',
    'purchaseMode', p_purchase_order -> 'purchase_mode',
    'totalAmount', p_purchase_order -> 'total_amount',
    'items', v_normalized_items,
    'requestLineLinks', v_normalized_links,
    'allocations', v_normalized_allocations
  )::text);
  insert into app_private.procurement_purchase_order_commands(
    actor_user_id, idempotency_key, purchase_order_id, payload_hash
  ) values (v_actor, p_idempotency_key, v_po_id, v_payload_hash)
  on conflict do nothing;
  select * into strict v_prior
  from app_private.procurement_purchase_order_commands command
  where command.actor_user_id = v_actor
    and command.idempotency_key = p_idempotency_key
  for update;
  if v_prior.payload_hash <> v_payload_hash then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PURCHASE_ORDER_IDEMPOTENCY_CONFLICT';
  end if;
  if v_prior.result is not null then
    return v_prior.result || jsonb_build_object('outcome', 'replayed');
  end if;

  -- Stable demand-line lock order is the concurrency boundary. No PO is
  -- inserted before all source revisions and expected versions are checked.
  perform line.id
  from public.procurement_demand_lines line
  join jsonb_array_elements(p_allocations) item(value)
    on line.id = (item.value ->> 'demandLineId')::uuid
  order by line.id
  for update of line;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> v_requested_count then
    raise exception using errcode = 'P0002', message = 'PROCUREMENT_DEMAND_LINE_NOT_FOUND';
  end if;
  if exists (
    select 1
    from public.procurement_demand_lines line
    join public.procurement_demands demand on demand.id = line.demand_id
    join jsonb_array_elements(p_allocations) item(value)
      on line.id = (item.value ->> 'demandLineId')::uuid
    where line.version <> (item.value ->> 'expectedVersion')::bigint
       or line.current_source_revision_id <> (item.value ->> 'sourceRevisionId')::uuid
       or line.intake_state <> 'ready' or line.health_state <> 'healthy'
       or demand.intake_state <> 'ready' or demand.health_state <> 'healthy'
       or demand.project_id is distinct from nullif(p_purchase_order ->> 'project_id', '')
       or demand.construction_site_id is distinct from nullif(p_purchase_order ->> 'construction_site_id', '')
       or coalesce((app_private.procurement_access_v1(v_actor,
         demand.project_id, demand.construction_site_id) ->> 'canViewPrice')::boolean, false) is not true
  ) then
    raise exception using errcode = '40001', message = 'PROCUREMENT_VERSION_CONFLICT';
  end if;

  -- A request link exists only for a real MR source. Plan demand uses its
  -- canonical source registry and never creates a synthetic request row.
  select count(*) into v_request_source_count
  from jsonb_array_elements(p_allocations) allocation(value)
  join public.procurement_demand_lines line
    on line.id = (allocation.value ->> 'demandLineId')::uuid
  join public.procurement_demands demand on demand.id = line.demand_id
  join public.procurement_source_documents source
    on source.id = demand.source_document_id
  where source.source_adapter = 'project_material_request';
  if v_request_source_count <> jsonb_array_length(p_request_line_links)
    or exists (
      select 1 from jsonb_array_elements(p_allocations) allocation(value)
      join public.procurement_demand_lines line
        on line.id = (allocation.value ->> 'demandLineId')::uuid
      join public.procurement_demands demand on demand.id = line.demand_id
      join public.procurement_source_documents source
        on source.id = demand.source_document_id
      join public.procurement_source_revisions source_revision
        on source_revision.id = line.current_source_revision_id
      join public.procurement_source_line_registry source_line
        on source_line.id = line.source_line_registry_id
      where source.source_adapter not in ('project_material_request', 'material_plan')
        or source_revision.source_document_id <> source.id
        or source_revision.revision <> source.current_revision
        or source_revision.source_hash <> source.source_hash
        or source_line.source_document_id <> source.id
        or source_line.item_id <> line.item_id or source_line.unit <> line.unit
        or allocation.value ->> 'needUnit' <> line.unit
        or not exists (select 1 from jsonb_array_elements(p_purchase_order -> 'items') po_item(value)
          where po_item.value ->> 'lineId' = allocation.value ->> 'purchaseOrderLineId'
            and po_item.value ->> 'itemId' = line.item_id
            and (po_item.value ->> 'qty')::numeric =
              (allocation.value ->> 'executionQty')::numeric
            and coalesce(po_item.value ->> 'purchaseUnitSnapshot', po_item.value ->> 'unit')
              = allocation.value ->> 'executionUnit')
        or (source.source_adapter = 'project_material_request' and not exists (
          select 1 from jsonb_array_elements(p_request_line_links) link(value)
          where link.value ->> 'purchase_order_line_id' = allocation.value ->> 'purchaseOrderLineId'
            and link.value ->> 'material_request_id' = source.source_document_id
            and link.value ->> 'request_line_id' = source_line.source_line_id
            and link.value ->> 'item_id' = line.item_id))
        or (source.source_adapter = 'material_plan' and exists (
          select 1 from jsonb_array_elements(p_request_line_links) link(value)
          where link.value ->> 'purchase_order_line_id' = allocation.value ->> 'purchaseOrderLineId'))
    ) or exists (
      select 1 from jsonb_array_elements(p_request_line_links) link(value)
      where not exists (
        select 1 from jsonb_array_elements(p_allocations) allocation(value)
        join public.procurement_demand_lines line
          on line.id = (allocation.value ->> 'demandLineId')::uuid
        join public.procurement_demands demand on demand.id = line.demand_id
        join public.procurement_source_documents source on source.id = demand.source_document_id
        join public.procurement_source_line_registry source_line
          on source_line.id = line.source_line_registry_id
        where source.source_adapter = 'project_material_request'
          and link.value ->> 'purchase_order_line_id' = allocation.value ->> 'purchaseOrderLineId'
          and link.value ->> 'material_request_id' = source.source_document_id
          and link.value ->> 'request_line_id' = source_line.source_line_id
          and link.value ->> 'item_id' = line.item_id)
    ) then
    raise exception using errcode = '23514', message = 'PROCUREMENT_REQUEST_LINK_MISMATCH';
  end if;

  v_po_result := app_private.save_purchase_order_aggregate_v1(
    p_purchase_order,
    p_request_line_links,
    '[]'::jsonb,
    null,
    '[]'::jsonb,
    '[]'::jsonb,
    v_actor,
    p_idempotency_key
  );

  for v_allocation in
    select value from jsonb_array_elements(p_allocations) item(value)
    order by value ->> 'demandLineId'
  loop
    select registry.* into v_execution_line
    from public.procurement_source_documents document
    join public.procurement_source_line_registry registry
      on registry.source_document_id = document.id
    where document.source_adapter = 'purchase_order'
      and document.source_document_id = v_po_id
      and registry.source_line_id = v_allocation ->> 'purchaseOrderLineId'
      and registry.archived_at is null
    for update of registry;
    if not found then
      raise exception using errcode = '23514', message = 'PROCUREMENT_EXECUTION_LINE_NOT_FOUND';
    end if;
    select * into strict v_line from public.procurement_demand_lines
    where id = (v_allocation ->> 'demandLineId')::uuid;

    -- G2 owner checks exact conversion and PROCUREMENT_AVAILABLE_EXCEEDED here;
    -- any failure rolls the W2 PO and every allocation back together.
    v_allocation_result := app_private.save_procurement_allocation_v1(
      v_line.id,
      (v_allocation ->> 'sourceRevisionId')::uuid,
      v_execution_line.id,
      'po',
      'committed',
      0,
      (v_allocation ->> 'needQty')::numeric,
      v_allocation ->> 'needUnit',
      (v_allocation ->> 'executionQty')::numeric,
      v_allocation ->> 'executionUnit',
      coalesce(nullif(v_allocation ->> 'conversionNumerator', '')::numeric, 1),
      coalesce(nullif(v_allocation ->> 'conversionDenominator', '')::numeric, 1),
      v_line.version,
      coalesce(nullif(btrim(v_allocation ->> 'reason'), ''), 'Tạo PO từ Procurement Workbench'),
      p_idempotency_key::text || ':' || v_line.id::text
    );
    v_allocation_ids := v_allocation_ids || jsonb_build_array(v_allocation_result -> 'allocationId');
  end loop;

  v_result := v_po_result || jsonb_build_object(
    'allocationIds', v_allocation_ids,
    'outcome', case when coalesce((v_po_result ->> 'replayed')::boolean, false)
      then 'replayed' else 'committed' end
  );
  update app_private.procurement_purchase_order_commands set
    result = v_result,
    committed_at = now()
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

-- Purchase candidates carry exact G2 identity/version and a nullable balance;
-- price is entered only by an actor with price capability.
create or replace function app_private.get_procurement_purchase_candidates_v1(p_demand_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_demand public.procurement_demands%rowtype;
  v_source public.procurement_source_documents%rowtype;
  v_access jsonb;
  v_detail jsonb;
  v_lines jsonb;
begin
  select * into v_demand from public.procurement_demands where id = p_demand_id;
  if v_demand.id is null then
    raise exception using errcode = 'P0002', message = 'PROCUREMENT_DEMAND_NOT_FOUND';
  end if;
  perform app_private.procurement_assert_intake_access(v_actor,
    v_demand.project_id, v_demand.construction_site_id);
  v_access := app_private.procurement_access_v1(v_actor,
    v_demand.project_id, v_demand.construction_site_id);
  select * into strict v_source from public.procurement_source_documents
    where id = v_demand.source_document_id;
  if v_source.source_adapter not in ('project_material_request', 'material_plan') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_UNSUPPORTED';
  end if;
  v_detail := app_private.procurement_v2_dossier_payload_v2(p_demand_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'adapter', v_source.source_adapter,
    'demandId', v_demand.id, 'demandLineId', line.id,
    'sourceRevisionId', line.current_source_revision_id,
    'expectedVersion', line.version::text,
    'sourceDocumentId', v_source.source_document_id,
    'sourceCode', v_source.source_code_snapshot,
    'sourceLineId', registry.source_line_id,
    'itemId', line.item_id, 'itemName', entry.value ->> 'title',
    'unit', line.unit, 'requestedQty', line.requested_qty::text,
    'fulfilledQty', entry.value -> 'fulfilledQty',
    'availableQty', entry.value -> 'availableToPlanQty',
    'neededDate', entry.value -> 'neededDate',
    'destinationId', entry.value -> 'destinationId',
    'purchaseUnit', item.purchase_unit,
    'conversionNumerator', item.purchase_conversion_factor::text,
    'conversionDenominator', '1',
    'canViewPrice', coalesce((v_access ->> 'canViewPrice')::boolean, false),
    'canAllocate', coalesce((v_access ->> 'canAllocate')::boolean, false)
  ) order by line.id), '[]'::jsonb) into v_lines
  from public.procurement_demand_lines line
  join public.procurement_source_line_registry registry on registry.id = line.source_line_registry_id
  join jsonb_array_elements(v_detail -> 'lines') entry(value)
    on entry.value ->> 'id' = line.id::text
  left join public.items item on item.id = line.item_id
  where line.demand_id = p_demand_id;
  return jsonb_build_object('projectId', v_demand.project_id,
    'constructionSiteId', v_demand.construction_site_id,
    'canViewPrice', coalesce((v_access ->> 'canViewPrice')::boolean, false),
    'canAllocate', coalesce((v_access ->> 'canAllocate')::boolean, false),
    'lines', v_lines);
end;
$$;
revoke all on function app_private.get_procurement_purchase_candidates_v1(uuid)
  from public, anon, authenticated;

create or replace function public.get_procurement_purchase_candidates_v1(p_demand_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select app_private.get_procurement_purchase_candidates_v1(p_demand_id);
$$;
revoke all on function public.get_procurement_purchase_candidates_v1(uuid) from public, anon;
grant execute on function public.get_procurement_purchase_candidates_v1(uuid)
  to authenticated, service_role;

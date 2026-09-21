-- G5 atomic bridge: a company PO and its G2 committed allocations are one
-- transaction. The existing W2 PO aggregate and G2 allocation owners remain
-- the only writers for their respective aggregates.

create table app_private.procurement_purchase_order_commands (
  actor_user_id uuid not null,
  idempotency_key uuid not null,
  purchase_order_id text not null,
  payload_hash text not null,
  result jsonb,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, idempotency_key),
  constraint procurement_purchase_order_commands_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{32}$'),
  constraint procurement_purchase_order_commands_result_check
    check ((result is null and committed_at is null) or (result is not null and committed_at is not null))
);
alter table app_private.procurement_purchase_order_commands enable row level security;
revoke all on table app_private.procurement_purchase_order_commands from public, anon, authenticated;
grant select, insert, update on table app_private.procurement_purchase_order_commands to service_role;
create policy procurement_purchase_order_commands_authenticated_deny
  on app_private.procurement_purchase_order_commands for all to authenticated
  using (false) with check (false);

create function app_private.create_procurement_purchase_order_v1(
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
begin
  if v_actor is null or p_actor_user_id is null or p_actor_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'PROCUREMENT_PURCHASE_ORDER_ACTOR_INVALID';
  end if;
  if v_po_id is null or p_idempotency_key is null
     or coalesce(p_purchase_order ->> 'source_mode', '') <> 'company_consolidated'
     or jsonb_typeof(coalesce(p_request_line_links, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_request_line_links, '[]'::jsonb)) = 0
     or jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0
     or jsonb_array_length(p_request_line_links) <> jsonb_array_length(p_allocations) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PURCHASE_ORDER_PAYLOAD_INVALID';
  end if;
  if nullif(p_purchase_order ->> 'project_id', '') is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PURCHASE_ORDER_SCOPE_REQUIRED';
  end if;

  select count(distinct value ->> 'demandLineId') into v_requested_count
  from jsonb_array_elements(p_allocations) item(value);
  if v_requested_count <> jsonb_array_length(p_allocations)
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
  ) then
    raise exception using errcode = '40001', message = 'PROCUREMENT_VERSION_CONFLICT';
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
revoke all on function app_private.create_procurement_purchase_order_v1(jsonb, jsonb, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.create_procurement_purchase_order_v1(jsonb, jsonb, jsonb, uuid, uuid) to authenticated, service_role;

create function public.create_procurement_purchase_order_v1(
  p_purchase_order jsonb,
  p_request_line_links jsonb,
  p_allocations jsonb,
  p_actor_user_id uuid,
  p_idempotency_key uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.create_procurement_purchase_order_v1(
    p_purchase_order, p_request_line_links, p_allocations,
    p_actor_user_id, p_idempotency_key
  );
$$;
revoke all on function public.create_procurement_purchase_order_v1(jsonb, jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.create_procurement_purchase_order_v1(jsonb, jsonb, jsonb, uuid, uuid) to authenticated, service_role;

-- A legacy caller may still reach W2 directly. Once a request line has G2
-- identity, a company-consolidated link must have a committed allocation to
-- the exact PO line before the transaction commits.
create function app_private.procurement_company_link_requires_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_demand_line_id uuid;
begin
  if not exists (
    select 1 from public.purchase_orders po
    where po.id = new.purchase_order_id and po.source_mode = 'company_consolidated'
  ) then return new; end if;

  select demand_line.id into v_demand_line_id
  from public.procurement_source_documents source_document
  join public.procurement_source_line_registry source_line
    on source_line.source_document_id = source_document.id
      and source_line.source_line_id = new.request_line_id
      and source_line.archived_at is null
  join public.procurement_demand_lines demand_line
    on demand_line.source_line_registry_id = source_line.id
  where source_document.source_adapter = 'project_material_request'
    and source_document.source_document_id = new.material_request_id;
  if v_demand_line_id is null then return new; end if;

  if not exists (
    select 1
    from public.procurement_supply_allocations allocation
    join public.procurement_source_line_registry execution_line
      on execution_line.id = allocation.execution_source_line_registry_id
    join public.procurement_source_documents execution_document
      on execution_document.id = execution_line.source_document_id
    where allocation.demand_line_id = v_demand_line_id
      and allocation.method = 'po'
      and allocation.state in ('committed', 'settled')
      and execution_document.source_adapter = 'purchase_order'
      and execution_document.source_document_id = new.purchase_order_id
      and execution_line.source_line_id = new.purchase_order_line_id
  ) then
    raise exception using errcode = '23514', message = 'PROCUREMENT_COMPANY_LINK_REQUIRES_ALLOCATION';
  end if;
  return new;
end;
$$;
revoke all on function app_private.procurement_company_link_requires_allocation() from public, anon, authenticated;

create constraint trigger trg_procurement_company_link_requires_allocation
after insert or update of purchase_order_id, purchase_order_line_id, material_request_id, request_line_id
on public.purchase_order_request_lines
deferrable initially deferred
for each row execute function app_private.procurement_company_link_requires_allocation();

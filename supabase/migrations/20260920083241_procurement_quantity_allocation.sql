create table public.procurement_supply_allocations (
  id uuid primary key default gen_random_uuid(),
  owner_context_id uuid not null references public.procurement_owner_contexts(id) on delete restrict,
  demand_line_id uuid not null references public.procurement_demand_lines(id) on delete restrict,
  source_revision_id uuid not null references public.procurement_source_revisions(id) on delete restrict,
  execution_source_line_registry_id uuid not null references public.procurement_source_line_registry(id) on delete restrict,
  method text not null check (method in ('stock', 'po', 'direct_purchase', 'contract_delivery', 'material_plan')),
  state text not null check (state in ('planned', 'reserved', 'committed', 'settled', 'released', 'cancelled')),
  reserved_need_qty numeric(20,6) not null default 0 check (reserved_need_qty >= 0),
  committed_need_qty numeric(20,6) not null default 0 check (committed_need_qty >= 0),
  need_unit text not null check (btrim(need_unit) <> ''),
  execution_qty numeric(20,6) not null check (execution_qty > 0),
  execution_unit text not null check (btrim(execution_unit) <> ''),
  conversion_numerator numeric(20,6) not null check (conversion_numerator > 0),
  conversion_denominator numeric(20,6) not null check (conversion_denominator > 0),
  reason text not null check (btrim(reason) <> ''),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reserved_need_qty + committed_need_qty > 0),
  check ((state in ('planned', 'reserved') and committed_need_qty = 0)
    or (state = 'committed' and reserved_need_qty = 0)
    or state in ('settled', 'released', 'cancelled'))
);

create table public.procurement_unallocated_effects (
  id uuid primary key default gen_random_uuid(),
  owner_context_id uuid not null references public.procurement_owner_contexts(id) on delete restrict,
  canonical_effect_id text not null unique check (btrim(canonical_effect_id) <> ''),
  source_adapter text not null,
  source_document_ref text not null,
  source_line_ref text,
  project_id text,
  construction_site_id text,
  item_id text,
  unit text,
  effect_kind text not null check (effect_kind in ('receipt', 'return', 'reversal')),
  total_qty numeric(20,6) not null check (total_qty <> 0),
  attributed_qty numeric(20,6) not null default 0,
  reverses_canonical_effect_id text,
  reason_code text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  status text not null default 'open' check (status in ('open', 'partial', 'allocated', 'reconciled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((effect_kind = 'receipt' and total_qty > 0)
    or (effect_kind in ('return', 'reversal') and total_qty < 0))
);

create table public.procurement_fulfillment_attributions (
  id uuid primary key default gen_random_uuid(),
  owner_context_id uuid not null references public.procurement_owner_contexts(id) on delete restrict,
  allocation_id uuid not null references public.procurement_supply_allocations(id) on delete restrict,
  demand_line_id uuid not null references public.procurement_demand_lines(id) on delete restrict,
  source_revision_id uuid not null references public.procurement_source_revisions(id) on delete restrict,
  canonical_effect_id text not null references public.procurement_unallocated_effects(canonical_effect_id) on delete restrict,
  effect_kind text not null check (effect_kind in ('receipt', 'return', 'reversal')),
  quantity numeric(20,6) not null check (quantity <> 0),
  unit text not null check (btrim(unit) <> ''),
  reverses_attribution_id uuid references public.procurement_fulfillment_attributions(id) on delete restrict,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (allocation_id, canonical_effect_id),
  check ((effect_kind = 'receipt' and quantity > 0 and reverses_attribution_id is null)
    or (effect_kind in ('return', 'reversal') and quantity < 0 and reverses_attribution_id is not null))
);

alter table public.procurement_supply_allocations enable row level security;
alter table public.procurement_unallocated_effects enable row level security;
alter table public.procurement_fulfillment_attributions enable row level security;
revoke all on public.procurement_supply_allocations from public, anon, authenticated;
revoke all on public.procurement_unallocated_effects from public, anon, authenticated;
revoke all on public.procurement_fulfillment_attributions from public, anon, authenticated;
grant all on public.procurement_supply_allocations to service_role;
grant all on public.procurement_unallocated_effects to service_role;
grant all on public.procurement_fulfillment_attributions to service_role;

create or replace function app_private.procurement_attribution_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'PROCUREMENT_ATTRIBUTION_IMMUTABLE';
end;
$$;
revoke all on function app_private.procurement_attribution_immutable() from public, anon, authenticated;
create trigger trg_procurement_attribution_immutable
before update or delete on public.procurement_fulfillment_attributions
for each row execute function app_private.procurement_attribution_immutable();

-- Purchase orders are execution documents. Invalid legacy lines are recorded for
-- reconciliation and are never converted into guessed quantity allocations.
create or replace function app_private.procurement_sync_purchase_order_registry_row(
  p_order public.purchase_orders
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_document public.procurement_source_documents%rowtype;
  v_hash text;
  v_line jsonb;
  v_line_id text;
  v_unit text;
  v_line_hash text;
  v_invalid boolean;
begin
  select id into strict v_owner from public.procurement_owner_contexts
  where logical_key = 'company_default' and is_active for share;
  v_hash := encode(extensions.digest(jsonb_build_object(
    'projectId', coalesce(p_order.project_id, ''),
    'constructionSiteId', coalesce(p_order.construction_site_id, ''),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'lineId', coalesce(line.value ->> 'lineId', ''),
      'itemId', coalesce(line.value ->> 'itemId', ''),
      'qty', coalesce(line.value ->> 'qty', ''),
      'unit', coalesce(line.value ->> 'purchaseUnitSnapshot', line.value ->> 'unitSnapshot', line.value ->> 'unit', '')
    ) order by line.value ->> 'lineId') from jsonb_array_elements(p_order.items) line(value)), '[]'::jsonb)
  )::text, 'sha256'), 'hex');

  select * into v_document from public.procurement_source_documents
  where owner_context_id = v_owner and source_adapter = 'purchase_order'
    and source_document_id = p_order.id for update;
  if not found then
    insert into public.procurement_source_documents(
      owner_context_id, source_adapter, source_document_id, source_code_snapshot,
      project_id, construction_site_id, current_revision, source_hash, archived_at
    ) values (
      v_owner, 'purchase_order', p_order.id, p_order.po_number,
      p_order.project_id, p_order.construction_site_id, 1, v_hash, p_order.archived_at
    ) returning * into v_document;
  else
    update public.procurement_source_documents set
      source_code_snapshot = p_order.po_number,
      project_id = p_order.project_id,
      construction_site_id = p_order.construction_site_id,
      current_revision = case when source_hash is distinct from v_hash then current_revision + 1 else current_revision end,
      source_hash = v_hash,
      archived_at = p_order.archived_at,
      updated_at = now()
    where id = v_document.id returning * into v_document;
  end if;

  insert into public.procurement_source_revisions(
    source_document_id, revision, source_hash, payload, changed_by
  ) values (
    v_document.id, v_document.current_revision, v_hash,
    jsonb_build_object('purchaseOrderId', p_order.id, 'projectId', p_order.project_id,
      'constructionSiteId', p_order.construction_site_id, 'items', p_order.items),
    public.current_app_user_id()
  ) on conflict (source_document_id, source_hash) do nothing;

  select exists (
    select 1 from jsonb_array_elements(p_order.items) line(value)
    where nullif(btrim(line.value ->> 'lineId'), '') is null
       or nullif(btrim(line.value ->> 'itemId'), '') is null
       or nullif(btrim(coalesce(line.value ->> 'purchaseUnitSnapshot', line.value ->> 'unitSnapshot', line.value ->> 'unit')), '') is null
       or nullif(line.value ->> 'qty', '') is null
       or (line.value ->> 'qty') !~ '^\d+(\.\d{1,6})?$'
  ) or exists (
    select 1 from jsonb_array_elements(p_order.items) line(value)
    group by line.value ->> 'lineId' having count(*) > 1
  ) into v_invalid;
  if v_invalid then
    if not exists (
      select 1 from public.procurement_reconciliation_issues
      where source_adapter = 'purchase_order' and source_document_ref = p_order.id
        and issue_code = 'legacy_identity_missing' and status = 'open'
    ) then
      insert into public.procurement_reconciliation_issues(
        owner_context_id, source_adapter, source_document_ref, issue_code, details
      ) values (v_owner, 'purchase_order', p_order.id, 'legacy_identity_missing',
        jsonb_build_object('message', 'Purchase-order lines require stable lineId, item and unit before allocation.'));
    end if;
    return;
  end if;

  if exists (
    select 1 from public.procurement_source_line_registry registry
    where registry.source_document_id = v_document.id and registry.downstream_locked
      and (not exists (select 1 from jsonb_array_elements(p_order.items) line(value)
        where line.value ->> 'lineId' = registry.source_line_id)
      or exists (select 1 from jsonb_array_elements(p_order.items) line(value)
        where line.value ->> 'lineId' = registry.source_line_id and (
          line.value ->> 'itemId' is distinct from registry.item_id
          or coalesce(line.value ->> 'purchaseUnitSnapshot', line.value ->> 'unitSnapshot', line.value ->> 'unit') is distinct from registry.unit
        )))
  ) then raise exception using errcode = '23514', message = 'EXECUTION_LINE_IDENTITY_LOCKED'; end if;

  update public.procurement_source_line_registry registry set
    archived_at = now(), last_revision = v_document.current_revision, updated_at = now()
  where registry.source_document_id = v_document.id and registry.archived_at is null
    and not exists (select 1 from jsonb_array_elements(p_order.items) line(value)
      where line.value ->> 'lineId' = registry.source_line_id);

  for v_line in select value from jsonb_array_elements(p_order.items)
  loop
    v_line_id := v_line ->> 'lineId';
    v_unit := coalesce(v_line ->> 'purchaseUnitSnapshot', v_line ->> 'unitSnapshot', v_line ->> 'unit');
    v_line_hash := encode(extensions.digest(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_line ->> 'itemId', 'qty', v_line ->> 'qty', 'unit', v_unit
    )::text, 'sha256'), 'hex');
    insert into public.procurement_source_line_registry(
      source_document_id, source_line_id, item_id, unit, work_boq_item_id,
      material_budget_item_id, source_hash, first_revision, last_revision, archived_at
    ) values (
      v_document.id, v_line_id, v_line ->> 'itemId', v_unit,
      nullif(v_line ->> 'workBoqItemId', ''), nullif(v_line ->> 'materialBudgetItemId', ''),
      v_line_hash, v_document.current_revision, v_document.current_revision, null
    ) on conflict (source_document_id, source_line_id) do update set
      source_hash = excluded.source_hash,
      last_revision = excluded.last_revision,
      archived_at = null,
      updated_at = now();
  end loop;
end;
$$;
revoke all on function app_private.procurement_sync_purchase_order_registry_row(public.purchase_orders) from public, anon, authenticated;

create or replace function app_private.procurement_sync_purchase_order_registry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.procurement_sync_purchase_order_registry_row(new);
  return new;
end;
$$;
revoke all on function app_private.procurement_sync_purchase_order_registry() from public, anon, authenticated;
create trigger trg_procurement_sync_purchase_order_registry
after insert or update of items, project_id, construction_site_id, po_number, archived_at
on public.purchase_orders for each row execute function app_private.procurement_sync_purchase_order_registry();

do $$ declare v_order public.purchase_orders%rowtype;
begin
  for v_order in select * from public.purchase_orders loop
    perform app_private.procurement_sync_purchase_order_registry_row(v_order);
  end loop;
end $$;

create or replace function app_private.register_procurement_effect_v1(
  p_canonical_effect_id text, p_source_adapter text, p_source_document_ref text,
  p_source_line_ref text, p_project_id text, p_construction_site_id text,
  p_item_id text, p_unit text, p_effect_kind text, p_total_qty numeric,
  p_reverses_canonical_effect_id text, p_reason_code text, p_details jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid;
begin
  if nullif(btrim(coalesce(p_canonical_effect_id, '')), '') is null
     or p_effect_kind not in ('receipt', 'return', 'reversal') or p_total_qty = 0
     or (p_effect_kind = 'receipt' and p_total_qty < 0)
     or (p_effect_kind in ('return', 'reversal') and (p_total_qty > 0 or p_reverses_canonical_effect_id is null)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_EFFECT_INVALID';
  end if;
  select id into strict v_owner from public.procurement_owner_contexts
  where logical_key = 'company_default' and is_active for share;
  insert into public.procurement_unallocated_effects(
    owner_context_id, canonical_effect_id, source_adapter, source_document_ref,
    source_line_ref, project_id, construction_site_id, item_id, unit, effect_kind,
    total_qty, reverses_canonical_effect_id, reason_code, details
  ) values (
    v_owner, p_canonical_effect_id, p_source_adapter, p_source_document_ref,
    p_source_line_ref, p_project_id, p_construction_site_id, p_item_id, p_unit,
    p_effect_kind, p_total_qty, p_reverses_canonical_effect_id, p_reason_code, coalesce(p_details, '{}'::jsonb)
  ) on conflict (canonical_effect_id) do update set
    details = public.procurement_unallocated_effects.details || excluded.details,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app_private.register_procurement_effect_v1(text, text, text, text, text, text, text, text, text, numeric, text, text, jsonb) from public, anon, authenticated;
grant execute on function app_private.register_procurement_effect_v1(text, text, text, text, text, text, text, text, text, numeric, text, text, jsonb) to service_role;

insert into public.procurement_unallocated_effects(
  owner_context_id, canonical_effect_id, source_adapter, source_document_ref,
  source_line_ref, project_id, construction_site_id, item_id, unit,
  effect_kind, total_qty, reason_code, details
)
select owner.id, 'material_request_fulfillment_line:' || line.id::text,
  'material_request_fulfillment', batch.id::text, line.request_line_id,
  batch.project_id, batch.construction_site_id, line.item_id, nullif(line.unit, ''),
  'receipt', line.received_qty,
  case when demand_line.id is null then 'legacy_identity_missing' else 'allocation_missing' end,
  jsonb_build_object('materialRequestId', line.material_request_id, 'batchId', batch.id, 'lineId', line.id)
from public.material_request_fulfillment_lines line
join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
cross join public.procurement_owner_contexts owner
left join public.procurement_source_documents document
  on document.owner_context_id = owner.id and document.source_adapter = 'project_material_request'
  and document.source_document_id = line.material_request_id
left join public.procurement_source_line_registry registry
  on registry.source_document_id = document.id and registry.source_line_id = line.request_line_id
left join public.procurement_demand_lines demand_line on demand_line.source_line_registry_id = registry.id
where owner.logical_key = 'company_default' and owner.is_active
  and batch.status = 'received' and line.received_qty > 0
on conflict (canonical_effect_id) do nothing;

create or replace function app_private.save_procurement_allocation_v1(
  p_demand_line_id uuid, p_source_revision_id uuid,
  p_execution_source_line_registry_id uuid, p_method text, p_state text,
  p_reserved_need_qty numeric, p_committed_need_qty numeric, p_need_unit text,
  p_execution_qty numeric, p_execution_unit text,
  p_conversion_numerator numeric, p_conversion_denominator numeric,
  p_expected_demand_line_version bigint, p_reason text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_owner public.procurement_owner_contexts%rowtype;
  v_demand public.procurement_demands%rowtype;
  v_line public.procurement_demand_lines%rowtype;
  v_execution public.procurement_source_line_registry%rowtype;
  v_execution_document public.procurement_source_documents%rowtype;
  v_source_document public.procurement_source_documents%rowtype;
  v_command app_private.procurement_commands%rowtype;
  v_allocation public.procurement_supply_allocations%rowtype;
  v_hash text; v_result jsonb; v_total numeric(20,6); v_converted numeric;
  v_fulfilled numeric(20,6); v_closed numeric(20,6);
  v_reserved numeric(20,6); v_committed numeric(20,6); v_available numeric(20,6);
begin
  if p_demand_line_id is null or p_source_revision_id is null
     or p_execution_source_line_registry_id is null
     or p_method not in ('stock', 'po', 'direct_purchase', 'contract_delivery', 'material_plan')
     or p_state not in ('planned', 'reserved', 'committed')
     or p_reserved_need_qty < 0 or p_committed_need_qty < 0
     or p_reserved_need_qty + p_committed_need_qty <= 0
     or p_execution_qty <= 0 or p_conversion_numerator <= 0 or p_conversion_denominator <= 0
     or nullif(btrim(coalesce(p_need_unit, '')), '') is null
     or nullif(btrim(coalesce(p_execution_unit, '')), '') is null
     or nullif(btrim(coalesce(p_reason, '')), '') is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or p_expected_demand_line_version is null or p_expected_demand_line_version < 1 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_COMMAND_INVALID';
  end if;
  if (p_state in ('planned', 'reserved') and p_committed_need_qty <> 0)
     or (p_state = 'committed' and p_reserved_need_qty <> 0) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_ALLOCATION_STATE_INVALID';
  end if;
  v_total := p_reserved_need_qty + p_committed_need_qty;
  v_converted := p_execution_qty * p_conversion_numerator / p_conversion_denominator;
  if v_converted <> round(v_converted, 6) or round(v_converted, 6) <> v_total then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CONVERSION_MISMATCH';
  end if;

  select * into strict v_owner from public.procurement_owner_contexts
  where logical_key = 'company_default' and is_active for update;
  select demand.* into v_demand from public.procurement_demands demand
  join public.procurement_demand_lines line on line.demand_id = demand.id
  where line.id = p_demand_line_id and demand.owner_context_id = v_owner.id
  for update of demand;
  if not found then raise exception using errcode = 'P0002', message = 'PROCUREMENT_DEMAND_LINE_NOT_FOUND'; end if;
  perform app_private.procurement_assert_intake_access(v_actor, v_demand.project_id, v_demand.construction_site_id);
  select * into strict v_line from public.procurement_demand_lines
  where id = p_demand_line_id for update;

  v_hash := encode(extensions.digest(jsonb_build_object(
    'demandLineId', p_demand_line_id, 'sourceRevisionId', p_source_revision_id,
    'executionLineId', p_execution_source_line_registry_id, 'method', p_method, 'state', p_state,
    'reserved', p_reserved_need_qty, 'committed', p_committed_need_qty,
    'needUnit', p_need_unit, 'executionQty', p_execution_qty, 'executionUnit', p_execution_unit,
    'numerator', p_conversion_numerator, 'denominator', p_conversion_denominator,
    'expectedVersion', p_expected_demand_line_version, 'reason', btrim(p_reason)
  )::text, 'sha256'), 'hex');
  insert into app_private.procurement_commands(owner_context_id, command_type, idempotency_key, actor_user_id, payload_hash)
  values (v_owner.id, 'save_procurement_allocation', p_idempotency_key, v_actor, v_hash)
  on conflict (owner_context_id, command_type, idempotency_key) do nothing;
  select * into strict v_command from app_private.procurement_commands
  where owner_context_id = v_owner.id and command_type = 'save_procurement_allocation'
    and idempotency_key = p_idempotency_key for update;
  if v_command.actor_user_id is distinct from v_actor or v_command.payload_hash <> v_hash then
    raise exception using errcode = '40001', message = 'PROCUREMENT_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.result is not null then return v_command.result || jsonb_build_object('outcome', 'replayed'); end if;
  if v_line.version <> p_expected_demand_line_version then
    raise exception using errcode = '40001', message = 'PROCUREMENT_VERSION_CONFLICT';
  end if;
  if v_line.intake_state <> 'ready' or v_line.approved_qty is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DEMAND_NOT_READY';
  end if;
  if v_line.current_source_revision_id <> p_source_revision_id then
    raise exception using errcode = '40001', message = 'SOURCE_REVISION_STALE';
  end if;

  select * into v_execution from public.procurement_source_line_registry
  where id = p_execution_source_line_registry_id and archived_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROCUREMENT_EXECUTION_LINE_NOT_FOUND'; end if;
  select * into strict v_execution_document from public.procurement_source_documents
  where id = v_execution.source_document_id and owner_context_id = v_owner.id for update;
  if (p_method = 'po' and v_execution_document.source_adapter <> 'purchase_order')
     or (p_method = 'material_plan' and v_execution_document.source_adapter <> 'material_plan')
     or p_method in ('stock', 'direct_purchase', 'contract_delivery') then
    raise exception using errcode = '0A000', message = 'PROCUREMENT_EXECUTION_ADAPTER_UNSUPPORTED';
  end if;
  if v_execution_document.project_id is distinct from v_demand.project_id
     or v_execution_document.construction_site_id is distinct from v_demand.construction_site_id
     or v_execution.item_id <> v_line.item_id
     or v_execution.unit <> p_execution_unit or v_line.unit <> p_need_unit then
    raise exception using errcode = '23514', message = 'PROCUREMENT_ALLOCATION_IDENTITY_MISMATCH';
  end if;

  select * into strict v_source_document from public.procurement_source_documents
  where id = (select source_document_id from public.procurement_source_revisions where id = p_source_revision_id);
  select coalesce(sum(attribution.quantity), 0) into v_fulfilled
  from public.procurement_fulfillment_attributions attribution
  where attribution.demand_line_id = v_line.id;
  select coalesce(sum(closure.closed_qty), 0) into v_closed
  from public.material_request_line_need_closures closure
  join public.procurement_source_line_registry registry
    on registry.source_document_id = v_source_document.id and registry.source_line_id = closure.request_line_id
  where registry.id = v_line.source_line_registry_id
    and closure.material_request_id = v_source_document.source_document_id
    and closure.status = 'active';
  select coalesce(sum(case when allocation.state in ('planned', 'reserved')
      then greatest(0, allocation.reserved_need_qty - coalesce(attributed.net_qty, 0)) else 0 end), 0),
    coalesce(sum(case when allocation.state = 'committed'
      then greatest(0, allocation.committed_need_qty - coalesce(attributed.net_qty, 0)) else 0 end), 0)
  into v_reserved, v_committed
  from public.procurement_supply_allocations allocation
  left join lateral (
    select sum(quantity) net_qty from public.procurement_fulfillment_attributions
    where allocation_id = allocation.id
  ) attributed on true
  where allocation.demand_line_id = v_line.id;
  v_available := greatest(0, v_line.approved_qty - v_fulfilled - v_closed - v_reserved - v_committed);
  if v_total > v_available then
    raise exception using errcode = '40001', message = 'PROCUREMENT_AVAILABLE_EXCEEDED',
      detail = jsonb_build_object('approved', v_line.approved_qty, 'fulfilled', v_fulfilled,
        'closed', v_closed, 'reserved', v_reserved, 'committed', v_committed,
        'available', v_available, 'requested', v_total)::text;
  end if;

  insert into public.procurement_supply_allocations(
    owner_context_id, demand_line_id, source_revision_id, execution_source_line_registry_id,
    method, state, reserved_need_qty, committed_need_qty, need_unit, execution_qty,
    execution_unit, conversion_numerator, conversion_denominator, reason, created_by, updated_by
  ) values (
    v_owner.id, v_line.id, p_source_revision_id, v_execution.id, p_method, p_state,
    p_reserved_need_qty, p_committed_need_qty, p_need_unit, p_execution_qty,
    p_execution_unit, p_conversion_numerator, p_conversion_denominator, btrim(p_reason), v_actor, v_actor
  ) returning * into v_allocation;
  update public.procurement_source_line_registry set downstream_locked = true, updated_at = now()
  where id = v_execution.id;
  update public.procurement_demand_lines set version = version + 1, updated_at = now()
  where id = v_line.id returning * into v_line;
  insert into app_private.procurement_events_outbox(
    owner_context_id, aggregate_type, aggregate_id, aggregate_version, event_type, payload, actor_user_id
  ) values (
    v_owner.id, 'procurement_demand_line', v_line.id, v_line.version, 'procurement.allocation.saved',
    jsonb_build_object('demandLineId', v_line.id, 'allocationId', v_allocation.id,
      'sourceRevisionId', p_source_revision_id, 'quantity', v_total, 'unit', p_need_unit), v_actor
  );
  v_result := jsonb_build_object(
    'commandId', v_command.id, 'outcome', 'committed', 'committedAt', now(),
    'changedEntities', jsonb_build_array(
      jsonb_build_object('type', 'demand_line', 'id', v_line.id, 'version', v_line.version::text),
      jsonb_build_object('type', 'allocation', 'id', v_allocation.id, 'version', v_allocation.version::text)),
    'createdDocumentIds', jsonb_build_array(v_allocation.id), 'warnings', '[]'::jsonb,
    'refreshScopes', jsonb_build_array('project:' || v_demand.project_id),
    'allocationId', v_allocation.id,
    'balance', jsonb_build_object('approved', v_line.approved_qty, 'fulfilled', v_fulfilled,
      'closed', v_closed, 'reserved', v_reserved + p_reserved_need_qty,
      'committed', v_committed + p_committed_need_qty,
      'availableToPlan', v_available - v_total)
  );
  update app_private.procurement_commands set result = v_result, committed_at = now() where id = v_command.id;
  return v_result;
end;
$$;
revoke all on function app_private.save_procurement_allocation_v1(uuid, uuid, uuid, text, text, numeric, numeric, text, numeric, text, numeric, numeric, bigint, text, text) from public, anon, authenticated;

create function public.save_procurement_allocation_v1(
  p_demand_line_id uuid, p_source_revision_id uuid,
  p_execution_source_line_registry_id uuid, p_method text, p_state text,
  p_reserved_need_qty numeric, p_committed_need_qty numeric, p_need_unit text,
  p_execution_qty numeric, p_execution_unit text,
  p_conversion_numerator numeric, p_conversion_denominator numeric,
  p_expected_demand_line_version bigint, p_reason text, p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.save_procurement_allocation_v1(
    p_demand_line_id, p_source_revision_id, p_execution_source_line_registry_id,
    p_method, p_state, p_reserved_need_qty, p_committed_need_qty, p_need_unit,
    p_execution_qty, p_execution_unit, p_conversion_numerator, p_conversion_denominator,
    p_expected_demand_line_version, p_reason, p_idempotency_key
  );
$$;
revoke all on function public.save_procurement_allocation_v1(uuid, uuid, uuid, text, text, numeric, numeric, text, numeric, text, numeric, numeric, bigint, text, text) from public, anon;
grant execute on function public.save_procurement_allocation_v1(uuid, uuid, uuid, text, text, numeric, numeric, text, numeric, text, numeric, numeric, bigint, text, text) to authenticated, service_role;

create or replace function app_private.record_procurement_fulfillment_attribution_v1(
  p_allocation_id uuid, p_source_revision_id uuid, p_canonical_effect_id text,
  p_effect_kind text, p_quantity numeric, p_unit text, p_reverses_attribution_id uuid,
  p_expected_demand_line_version bigint, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_owner public.procurement_owner_contexts%rowtype;
  v_allocation public.procurement_supply_allocations%rowtype;
  v_demand public.procurement_demands%rowtype;
  v_line public.procurement_demand_lines%rowtype;
  v_effect public.procurement_unallocated_effects%rowtype;
  v_reverse public.procurement_fulfillment_attributions%rowtype;
  v_attribution public.procurement_fulfillment_attributions%rowtype;
  v_command app_private.procurement_commands%rowtype;
  v_hash text; v_result jsonb; v_used numeric(20,6); v_allocation_net numeric(20,6);
begin
  if p_allocation_id is null or p_source_revision_id is null
     or nullif(btrim(coalesce(p_canonical_effect_id, '')), '') is null
     or p_effect_kind not in ('receipt', 'return', 'reversal') or p_quantity = 0
     or nullif(btrim(coalesce(p_unit, '')), '') is null
     or p_expected_demand_line_version is null or p_expected_demand_line_version < 1
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or (p_effect_kind = 'receipt' and (p_quantity < 0 or p_reverses_attribution_id is not null))
     or (p_effect_kind in ('return', 'reversal') and (p_quantity > 0 or p_reverses_attribution_id is null)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_EFFECT_INVALID';
  end if;
  select * into strict v_owner from public.procurement_owner_contexts
  where logical_key = 'company_default' and is_active for update;
  select * into v_allocation from public.procurement_supply_allocations where id = p_allocation_id;
  if not found then raise exception using errcode = 'P0002', message = 'PROCUREMENT_ALLOCATION_NOT_FOUND'; end if;
  select demand.* into strict v_demand from public.procurement_demands demand
  join public.procurement_demand_lines line on line.demand_id = demand.id
  where line.id = v_allocation.demand_line_id and demand.owner_context_id = v_owner.id for update of demand;
  perform app_private.procurement_assert_intake_access(v_actor, v_demand.project_id, v_demand.construction_site_id);
  select * into strict v_line from public.procurement_demand_lines
  where id = v_allocation.demand_line_id for update;
  select * into strict v_allocation from public.procurement_supply_allocations
  where id = p_allocation_id for update;
  select * into v_effect from public.procurement_unallocated_effects
  where canonical_effect_id = p_canonical_effect_id and owner_context_id = v_owner.id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROCUREMENT_EFFECT_NOT_REGISTERED'; end if;

  v_hash := encode(extensions.digest(jsonb_build_object(
    'allocationId', p_allocation_id, 'sourceRevisionId', p_source_revision_id,
    'canonicalEffectId', p_canonical_effect_id, 'effectKind', p_effect_kind,
    'quantity', p_quantity, 'unit', p_unit, 'reversesAttributionId', p_reverses_attribution_id,
    'expectedVersion', p_expected_demand_line_version
  )::text, 'sha256'), 'hex');
  insert into app_private.procurement_commands(owner_context_id, command_type, idempotency_key, actor_user_id, payload_hash)
  values (v_owner.id, 'record_procurement_fulfillment_attribution', p_idempotency_key, v_actor, v_hash)
  on conflict (owner_context_id, command_type, idempotency_key) do nothing;
  select * into strict v_command from app_private.procurement_commands
  where owner_context_id = v_owner.id and command_type = 'record_procurement_fulfillment_attribution'
    and idempotency_key = p_idempotency_key for update;
  if v_command.actor_user_id is distinct from v_actor or v_command.payload_hash <> v_hash then
    raise exception using errcode = '40001', message = 'PROCUREMENT_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.result is not null then return v_command.result || jsonb_build_object('outcome', 'replayed'); end if;
  if v_line.version <> p_expected_demand_line_version then
    raise exception using errcode = '40001', message = 'PROCUREMENT_VERSION_CONFLICT';
  end if;
  if v_allocation.source_revision_id <> p_source_revision_id
     or v_line.current_source_revision_id <> p_source_revision_id then
    raise exception using errcode = '40001', message = 'SOURCE_REVISION_STALE';
  end if;
  if v_effect.effect_kind <> p_effect_kind or v_effect.unit is distinct from p_unit
     or v_effect.project_id is distinct from v_demand.project_id
     or v_effect.construction_site_id is distinct from v_demand.construction_site_id
     or v_effect.item_id is distinct from v_line.item_id
     or sign(v_effect.total_qty) <> sign(p_quantity) then
    raise exception using errcode = '23514', message = 'PROCUREMENT_EFFECT_IDENTITY_MISMATCH';
  end if;
  if p_reverses_attribution_id is not null then
    select * into v_reverse from public.procurement_fulfillment_attributions
    where id = p_reverses_attribution_id for update;
    if not found or v_reverse.allocation_id <> v_allocation.id or v_reverse.quantity <= 0
       or v_effect.reverses_canonical_effect_id is distinct from v_reverse.canonical_effect_id then
      raise exception using errcode = '23514', message = 'PROCUREMENT_REVERSAL_LINK_INVALID';
    end if;
  end if;
  select coalesce(sum(abs(quantity)), 0) into v_used
  from public.procurement_fulfillment_attributions where canonical_effect_id = p_canonical_effect_id;
  if v_used + abs(p_quantity) > abs(v_effect.total_qty) then
    raise exception using errcode = '40001', message = 'PROCUREMENT_EFFECT_QUANTITY_EXCEEDED';
  end if;
  select coalesce(sum(quantity), 0) into v_allocation_net
  from public.procurement_fulfillment_attributions where allocation_id = v_allocation.id;
  if v_allocation_net + p_quantity < 0
     or v_allocation_net + p_quantity > v_allocation.reserved_need_qty + v_allocation.committed_need_qty then
    raise exception using errcode = '40001', message = 'PROCUREMENT_ALLOCATION_FULFILLMENT_EXCEEDED';
  end if;

  insert into public.procurement_fulfillment_attributions(
    owner_context_id, allocation_id, demand_line_id, source_revision_id,
    canonical_effect_id, effect_kind, quantity, unit, reverses_attribution_id, created_by
  ) values (
    v_owner.id, v_allocation.id, v_line.id, p_source_revision_id,
    p_canonical_effect_id, p_effect_kind, p_quantity, p_unit, p_reverses_attribution_id, v_actor
  ) returning * into v_attribution;
  if v_allocation_net + p_quantity = v_allocation.reserved_need_qty + v_allocation.committed_need_qty then
    update public.procurement_supply_allocations set
      state = 'settled', version = version + 1, updated_by = v_actor, updated_at = now()
    where id = v_allocation.id returning * into v_allocation;
  end if;
  update public.procurement_unallocated_effects set
    attributed_qty = attributed_qty + p_quantity,
    status = case when abs(attributed_qty + p_quantity) = abs(total_qty) then 'allocated' else 'partial' end,
    updated_at = now()
  where id = v_effect.id;
  update public.procurement_demand_lines set version = version + 1, updated_at = now()
  where id = v_line.id returning * into v_line;
  insert into app_private.procurement_events_outbox(
    owner_context_id, aggregate_type, aggregate_id, aggregate_version, event_type, payload, actor_user_id
  ) values (
    v_owner.id, 'procurement_demand_line', v_line.id, v_line.version,
    'procurement.fulfillment.attributed',
    jsonb_build_object('demandLineId', v_line.id, 'allocationId', v_allocation.id,
      'attributionId', v_attribution.id, 'canonicalEffectId', p_canonical_effect_id,
      'quantity', p_quantity, 'unit', p_unit), v_actor
  );
  v_result := jsonb_build_object(
    'commandId', v_command.id, 'outcome', 'committed', 'committedAt', now(),
    'changedEntities', jsonb_build_array(
      jsonb_build_object('type', 'demand_line', 'id', v_line.id, 'version', v_line.version::text),
      jsonb_build_object('type', 'fulfillment_attribution', 'id', v_attribution.id, 'version', '1')),
    'createdDocumentIds', jsonb_build_array(v_attribution.id), 'warnings', '[]'::jsonb,
    'refreshScopes', jsonb_build_array('project:' || v_demand.project_id),
    'attributionId', v_attribution.id
  );
  update app_private.procurement_commands set result = v_result, committed_at = now() where id = v_command.id;
  return v_result;
end;
$$;
revoke all on function app_private.record_procurement_fulfillment_attribution_v1(uuid, uuid, text, text, numeric, text, uuid, bigint, text) from public, anon, authenticated;

create function public.record_procurement_fulfillment_attribution_v1(
  p_allocation_id uuid, p_source_revision_id uuid, p_canonical_effect_id text,
  p_effect_kind text, p_quantity numeric, p_unit text, p_reverses_attribution_id uuid,
  p_expected_demand_line_version bigint, p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.record_procurement_fulfillment_attribution_v1(
    p_allocation_id, p_source_revision_id, p_canonical_effect_id, p_effect_kind,
    p_quantity, p_unit, p_reverses_attribution_id, p_expected_demand_line_version, p_idempotency_key
  );
$$;
revoke all on function public.record_procurement_fulfillment_attribution_v1(uuid, uuid, text, text, numeric, text, uuid, bigint, text) from public, anon;
grant execute on function public.record_procurement_fulfillment_attribution_v1(uuid, uuid, text, text, numeric, text, uuid, bigint, text) to authenticated, service_role;

create or replace function app_private.list_procurement_unallocated_v1(
  p_project_id text, p_construction_site_id text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_rows jsonb;
begin
  perform app_private.procurement_assert_intake_access(v_actor, p_project_id, p_construction_site_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'canonicalEffectId', effect.canonical_effect_id, 'sourceAdapter', effect.source_adapter,
    'sourceDocumentRef', effect.source_document_ref, 'sourceLineRef', effect.source_line_ref,
    'itemId', effect.item_id, 'unit', effect.unit, 'effectKind', effect.effect_kind,
    'totalQty', effect.total_qty::text, 'attributedQty', effect.attributed_qty::text,
    'reasonCode', effect.reason_code, 'status', effect.status
  ) order by effect.created_at, effect.id), '[]'::jsonb) into v_rows
  from public.procurement_unallocated_effects effect
  where effect.project_id = p_project_id
    and effect.construction_site_id is not distinct from p_construction_site_id
    and effect.status in ('open', 'partial');
  return v_rows;
end;
$$;
revoke all on function app_private.list_procurement_unallocated_v1(text, text) from public, anon, authenticated;

create function public.list_procurement_unallocated_v1(
  p_project_id text, p_construction_site_id text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.list_procurement_unallocated_v1(p_project_id, p_construction_site_id);
$$;
revoke all on function public.list_procurement_unallocated_v1(text, text) from public, anon;
grant execute on function public.list_procurement_unallocated_v1(text, text) to authenticated, service_role;

create index procurement_allocations_demand_state_idx
  on public.procurement_supply_allocations(demand_line_id, state, created_at);
create index procurement_attributions_demand_idx
  on public.procurement_fulfillment_attributions(demand_line_id, created_at);
create index procurement_unallocated_scope_status_idx
  on public.procurement_unallocated_effects(project_id, construction_site_id, status, created_at);

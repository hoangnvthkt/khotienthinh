create or replace function app_private.procurement_access_v1(
  p_actor uuid, p_project_id text, p_construction_site_id text
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_read boolean; v_price boolean; v_allocate boolean;
begin
  if p_actor is null or not exists (
    select 1 from public.users actor where actor.id = p_actor
      and coalesce(actor.is_active, true)
      and coalesce(actor.account_status, 'ACTIVE') = 'ACTIVE'
  ) then raise exception using errcode = '42501', message = 'PROCUREMENT_ACCESS_DENIED'; end if;
  if nullif(btrim(coalesce(p_project_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SCOPE_REQUIRED';
  end if;
  v_read := app_private.project_actor_has_effective_room_action(
    p_actor, p_project_id, p_construction_site_id, 'material_request', 'view'
  );
  v_price := app_private.project_actor_has_effective_room_action(
    p_actor, p_project_id, p_construction_site_id, 'material_po', 'view'
  );
  v_allocate := app_private.project_actor_has_effective_room_action(
    p_actor, p_project_id, p_construction_site_id, 'material_po', 'edit'
  );
  return jsonb_build_object(
    'canRead', coalesce(v_read, false),
    'canViewPrice', coalesce(v_price, false),
    'canAllocate', coalesce(v_allocate, false)
  );
end;
$$;
revoke all on function app_private.procurement_access_v1(uuid, text, text) from public, anon, authenticated;

create or replace function app_private.procurement_assert_read_access(
  p_actor uuid, p_project_id text, p_construction_site_id text
) returns void language plpgsql stable security definer set search_path = '' as $$
declare v_access jsonb;
begin
  v_access := app_private.procurement_access_v1(p_actor, p_project_id, p_construction_site_id);
  if coalesce((v_access ->> 'canRead')::boolean, false) is not true then
    raise exception using errcode = '42501', message = 'PROCUREMENT_READ_DENIED';
  end if;
end;
$$;
revoke all on function app_private.procurement_assert_read_access(uuid, text, text) from public, anon, authenticated;

create or replace function app_private.procurement_assert_intake_access(
  p_actor uuid, p_project_id text, p_construction_site_id text
) returns void language plpgsql stable security definer set search_path = '' as $$
declare v_access jsonb;
begin
  v_access := app_private.procurement_access_v1(p_actor, p_project_id, p_construction_site_id);
  if coalesce((v_access ->> 'canRead')::boolean, false) is not true
     or coalesce((v_access ->> 'canAllocate')::boolean, false) is not true then
    raise exception using errcode = '42501', message = 'PROCUREMENT_ACCESS_DENIED';
  end if;
end;
$$;
revoke all on function app_private.procurement_assert_intake_access(uuid, text, text) from public, anon, authenticated;

create or replace function app_private.get_procurement_access_v1(
  p_project_id text, p_construction_site_id text default null
) returns jsonb language sql stable security definer set search_path = '' as $$
  select app_private.procurement_access_v1(
    public.current_app_user_id(), p_project_id, nullif(p_construction_site_id, '')
  );
$$;
revoke all on function app_private.get_procurement_access_v1(text, text) from public, anon, authenticated;

create function public.get_procurement_access_v1(
  p_project_id text, p_construction_site_id text default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_procurement_access_v1(p_project_id, p_construction_site_id);
$$;
revoke all on function public.get_procurement_access_v1(text, text) from public, anon;
grant execute on function public.get_procurement_access_v1(text, text) to authenticated, service_role;

create or replace function app_private.list_procurement_unallocated_v1(
  p_project_id text, p_construction_site_id text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_rows jsonb;
begin
  perform app_private.procurement_assert_read_access(v_actor, p_project_id, nullif(p_construction_site_id, ''));
  select coalesce(jsonb_agg(jsonb_build_object(
    'canonicalEffectId', effect.canonical_effect_id, 'sourceAdapter', effect.source_adapter,
    'sourceDocumentRef', effect.source_document_ref, 'sourceLineRef', effect.source_line_ref,
    'itemId', effect.item_id, 'unit', effect.unit, 'effectKind', effect.effect_kind,
    'totalQty', effect.total_qty::text, 'attributedQty', effect.attributed_qty::text,
    'reasonCode', effect.reason_code, 'status', effect.status
  ) order by effect.created_at, effect.id), '[]'::jsonb) into v_rows
  from public.procurement_unallocated_effects effect
  where effect.project_id = p_project_id
    and effect.construction_site_id is not distinct from nullif(p_construction_site_id, '')
    and effect.status in ('open', 'partial');
  return v_rows;
end;
$$;
revoke all on function app_private.list_procurement_unallocated_v1(text, text) from public, anon, authenticated;

create or replace function app_private.list_procurement_demand_balances_v1(
  p_project_id text default null, p_construction_site_id text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_rows jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.users actor where actor.id = v_actor
      and coalesce(actor.is_active, true)
      and coalesce(actor.account_status, 'ACTIVE') = 'ACTIVE'
  ) then raise exception using errcode = '42501', message = 'PROCUREMENT_ACCESS_DENIED'; end if;
  if p_project_id is not null then
    perform app_private.procurement_assert_read_access(
      v_actor, p_project_id, nullif(p_construction_site_id, '')
    );
  end if;

  with eligible_request_lines as materialized (
    select request_row.id request_id, request_row.code request_code,
      request_row.title request_title, request_row.status::text request_status,
      request_row.created_date, request_row.expected_date,
      request_row.site_warehouse_id, request_row.fulfillment_mode,
      request_row.project_id, request_row.construction_site_id,
      request_row.content_revision, request_row.content_hash,
      line.value line_value, line.ordinality,
      line.value ->> 'lineId' request_line_id,
      line.value ->> 'itemId' item_id,
      coalesce(line.value ->> 'unitSnapshot', line.value ->> 'unit') unit,
      (line.value ->> 'requestQty')::numeric(20,6) requested_qty,
      app_private.project_actor_has_effective_room_action(
        v_actor, request_row.project_id, request_row.construction_site_id, 'material_po', 'view'
      ) can_view_price,
      app_private.project_actor_has_effective_room_action(
        v_actor, request_row.project_id, request_row.construction_site_id, 'material_po', 'edit'
      ) can_allocate
    from public.requests request_row
    cross join lateral jsonb_array_elements(request_row.items) with ordinality line(value, ordinality)
    where request_row.request_origin = 'project'
      and request_row.status::text in ('APPROVED', 'IN_TRANSIT')
      and (p_project_id is null or request_row.project_id = p_project_id)
      and (nullif(p_construction_site_id, '') is null
        or request_row.construction_site_id = nullif(p_construction_site_id, ''))
      and app_private.project_actor_has_effective_room_action(
        v_actor, request_row.project_id, request_row.construction_site_id, 'material_request', 'view'
      )
  ), resolved as materialized (
    select eligible.*,
      document.id source_document_registry_id,
      registry.id source_line_registry_id,
      demand.id demand_id, demand.intake_state demand_state, demand.health_state demand_health,
      demand_line.id demand_line_id, demand_line.version demand_line_version,
      demand_line.approved_qty, demand_line.intake_state line_state,
      demand_line.health_state line_health,
      demand_line.current_source_revision_id,
      revision.id matching_source_revision_id,
      item.name item_name, item.sku, item.supplier_id
    from eligible_request_lines eligible
    join public.procurement_owner_contexts owner
      on owner.logical_key = 'company_default' and owner.is_active
    left join public.procurement_source_documents document
      on document.owner_context_id = owner.id
      and document.source_adapter = 'project_material_request'
      and document.source_document_id = eligible.request_id
    left join public.procurement_source_line_registry registry
      on registry.source_document_id = document.id
      and registry.source_line_id = eligible.request_line_id and registry.archived_at is null
    left join public.procurement_demands demand on demand.source_document_id = document.id
    left join public.procurement_demand_lines demand_line
      on demand_line.demand_id = demand.id and demand_line.source_line_registry_id = registry.id
    left join public.procurement_source_revisions revision
      on revision.source_document_id = document.id and revision.revision = eligible.content_revision
    left join public.items item on item.id = eligible.item_id
  ), fulfillment as (
    select resolved.demand_line_id, coalesce(sum(attribution.quantity), 0)::numeric(20,6) fulfilled_qty
    from resolved
    join public.procurement_fulfillment_attributions attribution
      on attribution.demand_line_id = resolved.demand_line_id
    group by resolved.demand_line_id
  ), closures as (
    select resolved.request_id, resolved.request_line_id,
      coalesce(sum(closure.closed_qty), 0)::numeric(20,6) closed_qty
    from resolved
    join public.material_request_line_need_closures closure
      on closure.material_request_id = resolved.request_id
      and closure.request_line_id = resolved.request_line_id and closure.status = 'active'
    group by resolved.request_id, resolved.request_line_id
  ), allocation_net as (
    select allocation.id, allocation.demand_line_id, allocation.method, allocation.state,
      allocation.reserved_need_qty, allocation.committed_need_qty,
      coalesce(sum(attribution.quantity), 0)::numeric(20,6) fulfilled_qty
    from public.procurement_supply_allocations allocation
    join resolved on resolved.demand_line_id = allocation.demand_line_id
    left join public.procurement_fulfillment_attributions attribution
      on attribution.allocation_id = allocation.id
    group by allocation.id
  ), allocation_balance as (
    select demand_line_id,
      coalesce(sum(case when state in ('planned', 'reserved')
        then greatest(0, reserved_need_qty - fulfilled_qty) else 0 end), 0)::numeric(20,6) reserved_qty,
      coalesce(sum(case when state = 'committed'
        then greatest(0, committed_need_qty - fulfilled_qty) else 0 end), 0)::numeric(20,6) committed_qty,
      coalesce(sum(case when method = 'po' and state not in ('released', 'cancelled')
        then reserved_need_qty + committed_need_qty else 0 end), 0)::numeric(20,6) ordered_qty
    from allocation_net group by demand_line_id
  ), issue_flags as (
    select resolved.request_id, resolved.request_line_id,
      bool_or(issue.id is not null) has_reconciliation_issue
    from resolved
    left join public.procurement_reconciliation_issues issue
      on issue.source_adapter = 'project_material_request'
      and issue.source_document_ref = resolved.request_id
      and (issue.source_line_ref is null or issue.source_line_ref = resolved.request_line_id)
      and issue.status = 'open'
    group by resolved.request_id, resolved.request_line_id
  ), unallocated_flags as (
    select resolved.request_id, resolved.request_line_id,
      bool_or(effect.id is not null) has_unallocated_effect
    from resolved
    left join public.procurement_unallocated_effects effect
      on effect.project_id = resolved.project_id
      and effect.construction_site_id is not distinct from resolved.construction_site_id
      and effect.source_line_ref = resolved.request_line_id
      and effect.item_id = resolved.item_id and effect.unit = resolved.unit
      and effect.status in ('open', 'partial')
    group by resolved.request_id, resolved.request_line_id
  ), balanced as (
    select resolved.*,
      coalesce(fulfillment.fulfilled_qty, 0)::numeric(20,6) fulfilled_qty,
      coalesce(closures.closed_qty, 0)::numeric(20,6) closed_qty,
      coalesce(allocation_balance.reserved_qty, 0)::numeric(20,6) reserved_qty,
      coalesce(allocation_balance.committed_qty, 0)::numeric(20,6) committed_qty,
      coalesce(allocation_balance.ordered_qty, 0)::numeric(20,6) ordered_qty,
      coalesce(issue_flags.has_reconciliation_issue, false) has_reconciliation_issue,
      coalesce(unallocated_flags.has_unallocated_effect, false) has_unallocated_effect,
      (resolved.demand_line_id is not null
        and resolved.demand_state = 'ready' and resolved.demand_health = 'healthy'
        and resolved.line_state = 'ready' and resolved.line_health = 'healthy'
        and resolved.current_source_revision_id = resolved.matching_source_revision_id
        and not coalesce(issue_flags.has_reconciliation_issue, false)
        and not coalesce(unallocated_flags.has_unallocated_effect, false)) balance_known
    from resolved
    left join fulfillment on fulfillment.demand_line_id = resolved.demand_line_id
    left join closures on closures.request_id = resolved.request_id
      and closures.request_line_id = resolved.request_line_id
    left join allocation_balance on allocation_balance.demand_line_id = resolved.demand_line_id
    left join issue_flags on issue_flags.request_id = resolved.request_id
      and issue_flags.request_line_id = resolved.request_line_id
    left join unallocated_flags on unallocated_flags.request_id = resolved.request_id
      and unallocated_flags.request_line_id = resolved.request_line_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', balanced.request_id || ':' || balanced.request_line_id,
    'demandId', balanced.demand_id,
    'demandLineId', balanced.demand_line_id,
    'demandLineVersion', case when balanced.demand_line_version is null then null else balanced.demand_line_version::text end,
    'sourceRevisionId', balanced.matching_source_revision_id,
    'requestId', balanced.request_id, 'requestCode', balanced.request_code,
    'requestTitle', balanced.request_title, 'requestStatus', balanced.request_status,
    'createdDate', balanced.created_date, 'expectedDate', balanced.expected_date,
    'targetWarehouseId', balanced.site_warehouse_id, 'fulfillmentMode', balanced.fulfillment_mode,
    'projectId', balanced.project_id, 'constructionSiteId', balanced.construction_site_id,
    'requestLineId', balanced.request_line_id, 'itemId', balanced.item_id,
    'itemName', coalesce(balanced.line_value ->> 'itemNameSnapshot', balanced.item_name, balanced.item_id),
    'sku', coalesce(balanced.line_value ->> 'skuSnapshot', balanced.sku),
    'unit', balanced.unit, 'supplierId', balanced.supplier_id,
    'workBoqItemId', nullif(balanced.line_value ->> 'workBoqItemId', ''),
    'materialBudgetItemId', nullif(balanced.line_value ->> 'materialBudgetItemId', ''),
    'neededDate', nullif(balanced.line_value ->> 'neededDate', ''),
    'boqQty', nullif(balanced.line_value ->> 'budgetQtySnapshot', ''),
    'requestedQty', balanced.requested_qty::text,
    'approvedQty', case when balanced.balance_known then balanced.approved_qty::text else null end,
    'fulfilledQty', case when balanced.balance_known then balanced.fulfilled_qty::text else null end,
    'closedQty', case when balanced.balance_known then balanced.closed_qty::text else null end,
    'reservedQty', case when balanced.balance_known then balanced.reserved_qty::text else null end,
    'committedQty', case when balanced.balance_known then balanced.committed_qty::text else null end,
    'openNeedQty', case when balanced.balance_known then greatest(0,
      balanced.approved_qty - balanced.fulfilled_qty - balanced.closed_qty)::text else null end,
    'availableToPlanQty', case when balanced.balance_known then greatest(0,
      balanced.approved_qty - balanced.fulfilled_qty - balanced.closed_qty
      - balanced.reserved_qty - balanced.committed_qty)::text else null end,
    'orderedQty', case when balanced.balance_known then balanced.ordered_qty::text else null end,
    'remainingKnown', balanced.balance_known,
    'reconciliationIssues', to_jsonb(array_remove(array[
      case when balanced.demand_line_id is null then 'g2_identity_not_ingested' end,
      case when balanced.demand_line_id is not null and (
        balanced.demand_state <> 'ready' or balanced.line_state <> 'ready'
        or balanced.current_source_revision_id is distinct from balanced.matching_source_revision_id
      ) then 'source_revision_unresolved' end,
      case when balanced.has_reconciliation_issue then 'source_reconciliation_required' end,
      case when balanced.has_unallocated_effect then 'unallocated_fulfillment_effect' end
    ]::text[], null)),
    'canViewPrice', balanced.can_view_price,
    'canAllocate', balanced.can_allocate and balanced.balance_known and greatest(0,
      balanced.approved_qty - balanced.fulfilled_qty - balanced.closed_qty
      - balanced.reserved_qty - balanced.committed_qty) > 0
  ) order by balanced.created_date desc, balanced.request_id, balanced.request_line_id), '[]'::jsonb)
  into v_rows from balanced;
  return v_rows;
end;
$$;
revoke all on function app_private.list_procurement_demand_balances_v1(text, text) from public, anon, authenticated;

create function public.list_procurement_demand_balances_v1(
  p_project_id text default null, p_construction_site_id text default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.list_procurement_demand_balances_v1(p_project_id, p_construction_site_id);
$$;
revoke all on function public.list_procurement_demand_balances_v1(text, text) from public, anon;
grant execute on function public.list_procurement_demand_balances_v1(text, text) to authenticated, service_role;

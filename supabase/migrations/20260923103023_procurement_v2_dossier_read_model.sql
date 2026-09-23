-- Document-grain buyer dossier. All reads are scoped before counting or paging.
create or replace function app_private.procurement_v2_dossier_payload_v2(p_demand_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_demand public.procurement_demands%rowtype;
  v_source public.procurement_source_documents%rowtype;
  v_lines jsonb;
  v_issues jsonb;
  v_line_count integer;
  v_issue_count integer;
  v_earliest date;
  v_destination text;
  v_unknown boolean;
  v_available boolean;
  v_stage text;
  v_can_allocate boolean;
begin
  select * into v_demand from public.procurement_demands where id = p_demand_id;
  if v_demand.id is null then
    raise exception using errcode = 'P0002', message = 'PROCUREMENT_DEMAND_NOT_FOUND';
  end if;
  perform app_private.procurement_assert_read_access(v_actor,
    v_demand.project_id, v_demand.construction_site_id);
  select * into strict v_source from public.procurement_source_documents
    where id = v_demand.source_document_id;
  if v_source.source_adapter not in ('project_material_request', 'material_plan') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_UNSUPPORTED';
  end if;
  v_can_allocate := coalesce((app_private.procurement_access_v1(v_actor,
    v_demand.project_id, v_demand.construction_site_id) ->> 'canAllocate')::boolean, false);

  with line_base as materialized (
    select dl.*, registry.source_line_id, item.name item_name,
      case when v_source.source_adapter = 'material_plan' then material.needed_date
        else nullif(request_line.line_value ->> 'neededDate', '')::date end needed_date,
      case when v_source.source_adapter = 'material_plan' then material.destination_id
        else coalesce(nullif(request_line.line_value ->> 'destinationId', ''), request_row.site_warehouse_id) end destination_id,
      coalesce((select sum(f.quantity) from public.procurement_fulfillment_attributions f
        where f.demand_line_id = dl.id), 0)::numeric(20,6) fulfilled_qty,
      case when v_source.source_adapter = 'project_material_request' then
        coalesce((select sum(c.closed_qty) from public.material_request_line_need_closures c
          where c.material_request_id = v_source.source_document_id
            and c.request_line_id = registry.source_line_id and c.status = 'active'), 0)
        else 0 end::numeric(20,6) closed_qty,
      exists (select 1 from public.procurement_reconciliation_issues issue
        where issue.owner_context_id = v_demand.owner_context_id
          and issue.source_adapter = v_source.source_adapter
          and issue.source_document_ref = v_source.source_document_id
          and (issue.source_line_ref is null or issue.source_line_ref = registry.source_line_id)
          and issue.status = 'open') has_issue,
      exists (select 1 from public.procurement_unallocated_effects effect
        where effect.project_id = v_demand.project_id
          and effect.construction_site_id is not distinct from v_demand.construction_site_id
          and effect.source_adapter = v_source.source_adapter
          and effect.source_document_ref = v_source.source_document_id
          and (effect.source_line_ref is null or effect.source_line_ref = registry.source_line_id)
          and effect.status in ('open', 'partial')) has_unallocated
    from public.procurement_demand_lines dl
    join public.procurement_source_line_registry registry on registry.id = dl.source_line_registry_id
    left join public.items item on item.id = dl.item_id
    left join public.project_v2_plan_lines material
      on v_source.source_adapter = 'material_plan'
      and material.plan_id::text = v_source.source_document_id
      and material.revision_no = v_source.current_revision
      and material.source_identity_id::text = registry.source_line_id
    left join public.requests request_row
      on v_source.source_adapter = 'project_material_request'
      and request_row.id = v_source.source_document_id
    left join lateral (select entry.value line_value
      from jsonb_array_elements(coalesce(request_row.items, '[]'::jsonb)) entry(value)
      where entry.value ->> 'lineId' = registry.source_line_id limit 1) request_line on true
    where dl.demand_id = p_demand_id
  ), allocation_net as (
    select a.demand_line_id,
      sum(case when a.state in ('planned', 'reserved') then greatest(0,
        a.reserved_need_qty - coalesce(f.net_qty, 0)) else 0 end)::numeric(20,6) reserved_qty,
      sum(case when a.state = 'committed' then greatest(0,
        a.committed_need_qty - coalesce(f.net_qty, 0)) else 0 end)::numeric(20,6) committed_qty
    from public.procurement_supply_allocations a
    join line_base lb on lb.id = a.demand_line_id
    left join lateral (select sum(quantity) net_qty
      from public.procurement_fulfillment_attributions f where f.allocation_id = a.id) f on true
    group by a.demand_line_id
  ), balanced as (
    select lb.*,
      coalesce(an.reserved_qty, 0)::numeric(20,6) reserved_qty,
      coalesce(an.committed_qty, 0)::numeric(20,6) committed_qty,
      (v_demand.intake_state = 'ready' and v_demand.health_state = 'healthy'
        and lb.intake_state = 'ready' and lb.health_state = 'healthy'
        and lb.current_source_revision_id = v_demand.current_source_revision_id
        and exists (select 1 from public.procurement_source_revisions current_source
          where current_source.id = v_demand.current_source_revision_id
            and current_source.revision = v_source.current_revision
            and current_source.source_hash = v_source.source_hash)
        and lb.approved_qty is not null and not lb.has_issue and not lb.has_unallocated
        and lb.unit = btrim(lb.unit)) balance_known
    from line_base lb left join allocation_net an on an.demand_line_id = lb.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'sourceLineId', b.source_line_id,
    'itemId', b.item_id, 'title', coalesce(b.item_name, b.item_id), 'unit', b.unit,
    'approvedQty', case when b.balance_known then to_jsonb(b.approved_qty::text) else 'null'::jsonb end,
    'reservedQty', case when b.balance_known then to_jsonb(b.reserved_qty::text) else 'null'::jsonb end,
    'committedQty', case when b.balance_known then to_jsonb(b.committed_qty::text) else 'null'::jsonb end,
    'fulfilledQty', case when b.balance_known then to_jsonb(b.fulfilled_qty::text) else 'null'::jsonb end,
    'closedQty', case when b.balance_known then to_jsonb(b.closed_qty::text) else 'null'::jsonb end,
    'availableToPlanQty', case when b.balance_known then to_jsonb(greatest(0,
      b.approved_qty - b.fulfilled_qty - b.closed_qty - b.reserved_qty - b.committed_qty)::text)
      else 'null'::jsonb end,
    'neededDate', b.needed_date, 'destinationId', b.destination_id,
    'balanceKnown', b.balance_known,
    'diagnostics', to_jsonb(array_remove(array[
      case when not b.balance_known and v_demand.intake_state <> 'ready'
        then 'source_revision_unresolved' end,
      case when b.has_issue then 'source_reconciliation_required' end,
      case when b.has_unallocated then 'unallocated_fulfillment_effect' end,
      case when not b.balance_known and b.approved_qty is null then 'approved_quantity_unknown' end
    ]::text[], null)),
    'documentRefs', coalesce((select jsonb_agg(distinct jsonb_build_object(
      'type', 'purchase_order', 'id', execution_source.source_document_id,
      'engine', 'purchase_order'))
      from public.procurement_supply_allocations allocation
      join public.procurement_source_line_registry execution_line
        on execution_line.id = allocation.execution_source_line_registry_id
      join public.procurement_source_documents execution_source
        on execution_source.id = execution_line.source_document_id
      where allocation.demand_line_id = b.id
        and execution_source.source_adapter = 'purchase_order'), '[]'::jsonb)
  ) order by b.needed_date nulls last, b.id), '[]'::jsonb),
    count(*), min(b.needed_date),
    case when count(distinct b.destination_id) = 1
      and count(b.destination_id) = count(*) then min(b.destination_id) else null end,
    coalesce(bool_or(not b.balance_known), true),
    coalesce(bool_or(b.balance_known and greatest(0,
      b.approved_qty - b.fulfilled_qty - b.closed_qty - b.reserved_qty - b.committed_qty) > 0), false)
  into v_lines, v_line_count, v_earliest, v_destination, v_unknown, v_available
  from balanced b;

  select coalesce(jsonb_agg(jsonb_build_object('id', issue.id,
    'code', issue.issue_code, 'severity', issue.severity,
    'sourceLineId', issue.source_line_ref) order by issue.created_at, issue.id), '[]'::jsonb),
    count(*) into v_issues, v_issue_count
  from public.procurement_reconciliation_issues issue
  where issue.owner_context_id = v_demand.owner_context_id
    and issue.source_adapter = v_source.source_adapter
    and issue.source_document_ref = v_source.source_document_id and issue.status = 'open';
  v_stage := case when v_demand.intake_state = 'withdrawn' then 'withdrawn'
    when v_unknown or v_issue_count > 0 then 'reconcile'
    when v_available then 'plan_supply' else 'monitor_fulfillment' end;
  return jsonb_build_object(
    'id', v_demand.id, 'sourceAdapter', v_source.source_adapter,
    'sourceCode', coalesce(v_source.source_code_snapshot, v_source.source_document_id),
    'sourceDocumentId', v_source.source_document_id,
    'sourceRef', jsonb_build_object('adapter', v_source.source_adapter,
      'id', v_source.source_document_id),
    'projectId', v_demand.project_id, 'constructionSiteId', v_demand.construction_site_id,
    'assigneeUserId', v_demand.assignee_user_id,
    'assigneeName', (select name from public.users where id = v_demand.assignee_user_id),
    'earliestNeededDate', v_earliest, 'destinationSummary', v_destination,
    'lineCount', v_line_count, 'stage', v_stage,
    'nextAction', case v_stage when 'reconcile' then 'reconcile'
      when 'plan_supply' then 'plan_supply'
      when 'withdrawn' then 'none' else 'monitor_fulfillment' end,
    'issueCount', v_issue_count, 'version', v_demand.version::text,
    'lines', v_lines, 'issues', v_issues,
    'allowedActions', case when v_can_allocate and v_stage = 'plan_supply'
      then jsonb_build_array('assign', 'plan_supply')
      when v_can_allocate then jsonb_build_array('assign') else jsonb_build_array('view') end);
end;
$$;
revoke all on function app_private.procurement_v2_dossier_payload_v2(uuid)
  from public, anon, authenticated;

create or replace function public.get_procurement_dossier_v2(p_demand_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select app_private.procurement_v2_dossier_payload_v2(p_demand_id)
    || jsonb_build_object('asOf', now());
$$;
revoke all on function public.get_procurement_dossier_v2(uuid) from public, anon;
grant execute on function public.get_procurement_dossier_v2(uuid) to authenticated, service_role;

create or replace function app_private.list_procurement_dossiers_v2(
  p_filter jsonb default '{}'::jsonb, p_cursor text default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
  v_limit integer := least(200, greatest(1, coalesce(p_limit, 50)));
  v_offset integer := 0;
  v_cursor_snapshot text;
  v_snapshot text;
  v_all jsonb;
  v_page jsonb;
  v_count integer;
  v_next text;
begin
  if jsonb_typeof(v_filter) <> 'object'
    or (v_filter ? 'source' and v_filter ->> 'source' not in
      ('project_material_request', 'material_plan')) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_FILTER_INVALID';
  end if;
  if v_actor is null or not exists (select 1 from public.users u where u.id = v_actor
    and coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_ACCESS_DENIED';
  end if;
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]+:[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'PROCUREMENT_CURSOR_INVALID';
    end if;
    v_offset := split_part(p_cursor, ':', 1)::integer;
    v_cursor_snapshot := split_part(p_cursor, ':', 2);
  end if;
  with eligible as materialized (
    select d.id from public.procurement_demands d
    join public.procurement_source_documents source on source.id = d.source_document_id
    where source.source_adapter in ('project_material_request', 'material_plan')
      and (nullif(v_filter ->> 'projectId', '') is null
        or d.project_id = v_filter ->> 'projectId')
      and (nullif(v_filter ->> 'constructionSiteId', '') is null
        or d.construction_site_id = v_filter ->> 'constructionSiteId')
      and (nullif(v_filter ->> 'source', '') is null
        or source.source_adapter = v_filter ->> 'source')
      and app_private.project_actor_has_effective_room_action(v_actor,
        d.project_id, d.construction_site_id, 'material_request', 'view')
  ), dossiers as materialized (
    select app_private.procurement_v2_dossier_payload_v2(e.id) payload from eligible e
  ), filtered as (
    select payload from dossiers where
      (nullif(v_filter ->> 'search', '') is null or lower(concat_ws(' ',
        payload ->> 'sourceCode', payload ->> 'projectId'))
          like '%' || lower(v_filter ->> 'search') || '%')
      and (nullif(v_filter ->> 'assigneeId', '') is null
        or payload ->> 'assigneeUserId' = v_filter ->> 'assigneeId')
      and (nullif(v_filter ->> 'stage', '') is null
        or payload ->> 'stage' = v_filter ->> 'stage')
      and (nullif(v_filter ->> 'neededFrom', '') is null
        or nullif(payload ->> 'earliestNeededDate', '')::date
          >= (v_filter ->> 'neededFrom')::date)
      and (nullif(v_filter ->> 'neededTo', '') is null
        or nullif(payload ->> 'earliestNeededDate', '')::date
          <= (v_filter ->> 'neededTo')::date)
  )
  select coalesce(jsonb_agg(payload order by
    payload ->> 'earliestNeededDate' nulls last,
    payload ->> 'sourceCode', payload ->> 'id'), '[]'::jsonb)
    into v_all from filtered;
  v_count := jsonb_array_length(v_all);
  v_snapshot := encode(extensions.digest(v_all::text, 'sha256'), 'hex');
  if v_cursor_snapshot is not null and v_cursor_snapshot <> v_snapshot then
    raise exception using errcode = '40001', message = 'PROCUREMENT_SNAPSHOT_STALE';
  end if;
  select coalesce(jsonb_agg(entry.value - 'lines' - 'issues' - 'allowedActions' - 'sourceRef'
    order by entry.ordinality), '[]'::jsonb) into v_page
  from jsonb_array_elements(v_all) with ordinality entry(value, ordinality)
  where entry.ordinality > v_offset and entry.ordinality <= v_offset + v_limit;
  if v_offset + v_limit < v_count then
    v_next := (v_offset + v_limit)::text || ':' || v_snapshot;
  end if;
  return jsonb_build_object('items', v_page, 'nextCursor', v_next,
    'snapshotToken', v_snapshot, 'asOf', now(), 'stale', false,
    'counters', jsonb_build_array(jsonb_build_object(
      'key', 'dossiers', 'count', v_count, 'grain', 'document')));
end;
$$;
revoke all on function app_private.list_procurement_dossiers_v2(jsonb, text, integer)
  from public, anon, authenticated;

create or replace function public.list_procurement_dossiers_v2(
  p_filter jsonb default '{}'::jsonb, p_cursor text default null, p_limit integer default 50
) returns jsonb language sql stable security definer set search_path = '' as $$
  select app_private.list_procurement_dossiers_v2(p_filter, p_cursor, p_limit);
$$;
revoke all on function public.list_procurement_dossiers_v2(jsonb, text, integer)
  from public, anon;
grant execute on function public.list_procurement_dossiers_v2(jsonb, text, integer)
  to authenticated, service_role;

-- Candidates are derived from exact approved construction lines and exact norm
-- records. Names and SKU values are display-only and never join keys.
drop function if exists public.list_project_v2_material_candidates_v1(text, text, uuid[]);
create or replace function public.list_project_v2_material_candidates_v1(
  p_project_id text, p_construction_site_id text, p_source_plan_ids uuid[],
  p_exclude_plan_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_workspace public.project_v2_workspaces%rowtype;
  v_items jsonb;
begin
  select * into v_workspace from public.project_v2_workspaces w
    where w.project_id = p_project_id and w.lifecycle <> 'archived'
      and w.primary_construction_site_id::text is not distinct from p_construction_site_id;
  perform app_private.project_v2_assert_permission(v_workspace, 'material', 'view', v_actor);
  if p_exclude_plan_id is not null and not exists (
    select 1 from public.project_v2_plans p where p.id = p_exclude_plan_id
      and p.workspace_id = v_workspace.id and p.plan_type = 'material'
      and p.status in ('draft', 'returned')
  ) then raise exception using errcode = '42501', message = 'PROJECT_V2_SOURCE_EXCLUSION_DENIED'; end if;
  if p_source_plan_ids is null or cardinality(p_source_plan_ids) < 1
    or cardinality(p_source_plan_ids) > 100
    or cardinality(p_source_plan_ids) <> (
      select count(distinct requested.id) from unnest(p_source_plan_ids) requested(id)) then
    raise exception using errcode = '22023', message = 'PROJECT_V2_MATERIAL_SOURCE_SCOPE_INVALID';
  end if;
  if (select count(*) from public.project_v2_plans p
    where p.id = any(p_source_plan_ids) and p.workspace_id = v_workspace.id
      and p.plan_type = 'construction' and p.status <> 'cancelled'
      and p.effective_revision_no is not null) <> cardinality(p_source_plan_ids) then
    raise exception using errcode = '42501', message = 'PROJECT_V2_MATERIAL_SOURCE_SCOPE_DENIED';
  end if;

  with source_lines as materialized (
    select p.id source_plan_id, p.workspace_id, r.revision_no source_revision,
      r.content_hash source_plan_hash, l.id source_line_id, l.work_item_id,
      l.quantity source_work_quantity, l.unit source_unit,
      coalesce(contract_item.name, work.name, task.name, 'Công việc chưa xác định') source_work_name
    from public.project_v2_plans p
    join public.project_v2_plan_revisions r on r.plan_id = p.id
      and r.revision_no = p.effective_revision_no
    join public.project_v2_plan_lines l on l.plan_id = p.id and l.revision_no = r.revision_no
    left join public.contract_items contract_item on contract_item.id::text = l.work_item_id
      and contract_item.project_id = p_project_id
    left join public.project_work_boq_items work on work.id = l.work_item_id
      and work.project_id = p_project_id
      and work.construction_site_id is not distinct from p_construction_site_id
    left join public.project_tasks task on task.id = l.work_item_id and task.project_id = p_project_id
    where p.id = any(p_source_plan_ids) and p.workspace_id = v_workspace.id
      and p.plan_type = 'construction' and p.status <> 'cancelled'
  ),
  g8_rows as (
    select s.*, ('g8:' || estimate.id) candidate_resource_id,
      ('g8:' || estimate.id) norm_resource_id,
      md5(to_jsonb(mapping)::text || to_jsonb(estimate)::text || coalesce(to_jsonb(budget)::text, '')) norm_revision,
      budget.inventory_item_id item_id, inventory.sku item_code,
      coalesce(inventory.name, budget.item_name, estimate.resource_name_snapshot) item_name,
      budget.unit, estimate.unit norm_unit,
      case when estimate.work_boq_qty_snapshot > 0 and estimate.coefficient > 0
        then round(estimate.estimated_qty / estimate.work_boq_qty_snapshot / estimate.coefficient, 6)
        else null end norm_factor,
      estimate.coefficient,
      case when estimate.unit = budget.unit and budget.unit = inventory.unit then 1::numeric else null end conversion_numerator,
      case when estimate.unit = budget.unit and budget.unit = inventory.unit then 1::numeric else null end conversion_denominator,
      (select count(*) from public.project_work_boq_norm_mappings alternative
        where alternative.work_boq_item_id = work.id
          and alternative.project_id = p_project_id
          and alternative.construction_site_id is not distinct from p_construction_site_id
          and alternative.status = 'active') active_mapping_count,
      budget.id budget_id, inventory.id valid_item_id,
      estimate.cost_norm_resource_id raw_norm_resource_id
    from source_lines s
    join public.project_work_boq_items work on work.id = s.work_item_id
      and work.project_id = p_project_id
      and work.construction_site_id is not distinct from p_construction_site_id
    join public.project_work_boq_norm_mappings mapping on mapping.work_boq_item_id = work.id
      and mapping.project_id = p_project_id
      and mapping.construction_site_id is not distinct from p_construction_site_id
      and mapping.status = 'active'
    join public.project_work_boq_norm_component_estimates estimate on estimate.mapping_id = mapping.id
      and estimate.work_boq_item_id = work.id and estimate.project_id = p_project_id
      and estimate.construction_site_id is not distinct from p_construction_site_id
      and estimate.resource_type = 'material' and estimate.selected
    left join public.material_budget_items budget on budget.id = estimate.material_budget_item_id
      and budget.source_norm_mapping_id = mapping.id
      and budget.source_norm_component_estimate_id = estimate.id
      and budget.project_id = p_project_id
      and budget.construction_site_id is not distinct from p_construction_site_id
    left join public.items inventory on inventory.id = budget.inventory_item_id
  ),
  contract_rows as (
    select s.*, ('contract:' || resource.id::text) candidate_resource_id,
      ('contract:' || resource.id::text) norm_resource_id, md5(to_jsonb(resource)::text) norm_revision,
      null::text item_id, null::text item_code, resource.name item_name,
      resource.unit, resource.unit norm_unit,
      resource.norm norm_factor, resource.coefficient,
      null::numeric conversion_numerator, null::numeric conversion_denominator,
      1::bigint active_mapping_count, null::text budget_id,
      null::text valid_item_id, resource.id::text raw_norm_resource_id
    from source_lines s
    join public.contract_items contract_item on contract_item.id::text = s.work_item_id
      and contract_item.project_id = p_project_id and contract_item.contract_type = 'customer'
    join public.contract_item_resources resource on resource.contract_item_id = contract_item.id
      and resource.resource_type = 'material'
    where not exists (select 1 from g8_rows g where g.source_line_id = s.source_line_id)
  ),
  unmapped_rows as (
    select s.*, ('unmapped:' || s.source_line_id::text) candidate_resource_id,
      null::text norm_resource_id, null::text norm_revision,
      null::text item_id, null::text item_code, s.source_work_name item_name,
      null::text unit, null::text norm_unit, null::numeric norm_factor,
      null::numeric coefficient, null::numeric conversion_numerator,
      null::numeric conversion_denominator, 0::bigint active_mapping_count,
      null::text budget_id, null::text valid_item_id, null::text raw_norm_resource_id
    from source_lines s
    where not exists (select 1 from g8_rows g where g.source_line_id = s.source_line_id)
      and not exists (select 1 from contract_rows c where c.source_line_id = s.source_line_id)
  ),
  raw_rows as (select * from g8_rows union all select * from contract_rows
    union all select * from unmapped_rows),
  computed as (
    select raw.*,
      case when raw.source_work_quantity is null or raw.norm_factor is null
        or raw.coefficient is null or raw.conversion_numerator is null
        or raw.conversion_denominator is null or raw.conversion_denominator = 0
        then null else round(raw.source_work_quantity * raw.norm_factor * raw.coefficient
          * raw.conversion_numerator / raw.conversion_denominator, 6) end calculated_qty,
      previous.quantity already_planned_qty
    from raw_rows raw
    cross join lateral (
      select coalesce(sum(greatest(q.pending_quantity, q.effective_quantity)), 0) quantity
      from (
        select consumer.id,
          coalesce(sum(link.allocated_quantity) filter (where consumer.status = 'pending_approval'
            and target.revision_no = consumer.revision_no), 0) pending_quantity,
          coalesce(sum(link.allocated_quantity) filter (where target.revision_no = consumer.effective_revision_no), 0) effective_quantity
        from public.project_v2_plan_line_sources link
        join public.project_v2_plan_lines target on target.id = link.target_line_id
        join public.project_v2_plans consumer on consumer.id = target.plan_id
        where link.source_plan_id = raw.source_plan_id
          and link.source_plan_revision_no = raw.source_revision
          and link.source_plan_line_id = raw.source_line_id
          and link.norm_resource_id = raw.norm_resource_id
          and consumer.plan_type = 'material' and consumer.status <> 'cancelled'
          and consumer.id is distinct from p_exclude_plan_id
        group by consumer.id
      ) q
    ) previous
  ),
  diagnosed as (
    select c.*,
      array_remove(array[
        case when c.valid_item_id is null then 'missing_inventory_identity' end,
        case when c.norm_revision is null or c.raw_norm_resource_id is null then 'missing_norm_revision' end,
        case when c.norm_factor is null then 'missing_norm_factor' end,
        case when c.conversion_numerator is null or c.conversion_denominator is null
          then 'missing_conversion' end,
        case when c.source_work_quantity is null then 'source_quantity_unknown' end,
        case when c.active_mapping_count > 1 then 'ambiguous_mapping' end,
        case when c.calculated_qty is not null and c.already_planned_qty > c.calculated_qty
          then 'already_allocated' end,
        case when c.item_id is not null and c.valid_item_id is null then 'unit_mismatch' end
      ]::text[], null) diagnostics
    from computed c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'candidateId', source_line_id::text || ':' || candidate_resource_id,
    'workspaceId', workspace_id, 'itemId', valid_item_id,
    'itemCode', item_code, 'itemName', item_name, 'unit', unit,
    'calculatedQty', calculated_qty, 'alreadyPlannedQty', already_planned_qty,
    'availableQty', case when calculated_qty is null then null
      else greatest(calculated_qty - already_planned_qty, 0) end,
    'diagnostics', to_jsonb(diagnostics), 'selectable', cardinality(diagnostics) = 0
      and calculated_qty is not null and calculated_qty > already_planned_qty,
    'sourcePlanId', source_plan_id, 'sourceRevision', source_revision,
    'sourcePlanHash', source_plan_hash, 'sourceLineId', source_line_id,
    'sourceWorkName', source_work_name, 'sourceWorkQuantity', source_work_quantity,
    'sourceUnit', source_unit, 'normResourceId', norm_resource_id,
    'normRevision', norm_revision, 'normFactor', norm_factor,
    'coefficient', coefficient, 'conversionNumerator', conversion_numerator,
    'conversionDenominator', conversion_denominator)
    order by source_plan_id, source_line_id, candidate_resource_id), '[]'::jsonb)
  into v_items from diagnosed;
  return jsonb_build_object('asOf', now(), 'items', v_items);
end;
$$;

revoke all on function public.list_project_v2_material_candidates_v1(text, text, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.list_project_v2_material_candidates_v1(text, text, uuid[], uuid)
  to authenticated;

-- Drafts preserve incomplete identities. Submit and approve enforce completeness.
alter table public.project_v2_plan_lines drop constraint project_v2_plan_lines_check1;
alter table public.project_v2_plan_lines add constraint project_v2_plan_lines_kind_check check (
  (plan_type = 'month' and work_item_id is null and inventory_item_id is null
    and (contract_item_id is not null or baseline_revision is not null))
  or (plan_type = 'construction' and inventory_item_id is null and work_item_id is not null)
  or plan_type = 'material'
);
alter table public.project_v2_plan_lines add column calculated_quantity numeric(20,6),
  add column override_reason text;
alter table public.project_v2_plan_line_sources add column allocated_quantity numeric(20,6),
  add constraint project_v2_material_allocation_positive check (allocated_quantity is null or allocated_quantity >= 0);

-- A resource allocation is independent of the construction work quantity.
create or replace function app_private.project_v2_validate_material_sources(
  p_plan_id uuid, p_revision_no integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_source record;
  v_line record;
  v_estimate public.project_work_boq_norm_component_estimates%rowtype;
  v_mapping public.project_work_boq_norm_mappings%rowtype;
  v_budget public.material_budget_items%rowtype;
  v_expected numeric(20,6);
  v_reserved numeric(20,6);
  v_requested numeric(20,6);
  v_workspace_id uuid;
  v_project_id text;
  v_site_id text;
begin
  select w.id, w.project_id, w.primary_construction_site_id::text
    into v_workspace_id, v_project_id, v_site_id
  from public.project_v2_plans p join public.project_v2_workspaces w on w.id = p.workspace_id
  where p.id = p_plan_id;
  for v_line in select l.* from public.project_v2_plan_lines l
    where l.plan_id = p_plan_id and l.revision_no = p_revision_no order by l.id loop
    if v_line.inventory_item_id is null or nullif(btrim(v_line.unit), '') is null
      or v_line.quantity is null or v_line.quantity <= 0 or v_line.needed_date is null
      or nullif(btrim(v_line.destination_id), '') is null then
      raise exception using errcode = '22023', message = 'PROJECT_V2_PLAN_INCOMPLETE';
    end if;
    if not exists (select 1 from public.items i where i.id = v_line.inventory_item_id
      and i.unit = v_line.unit) then
      raise exception using errcode = '22023', message = 'PROJECT_V2_MATERIAL_UNIT_MISMATCH';
    end if;
    if exists (select 1 from public.project_v2_plan_line_sources s
      where s.target_line_id = v_line.id group by s.source_plan_id, s.source_plan_line_id,
        s.norm_resource_id having count(*) > 1) then
      raise exception using errcode = '23505', message = 'PROJECT_V2_MATERIAL_SOURCE_DUPLICATE';
    end if;
    if not exists (select 1 from public.project_v2_plan_line_sources s
      where s.target_line_id = v_line.id) then
      raise exception using errcode = '22023', message = 'PROJECT_V2_MATERIAL_SOURCE_REQUIRED';
    end if;
    for v_source in select s.*, source_line.work_item_id, source_line.quantity work_quantity,
        source_line.unit work_unit, source_plan.workspace_id source_workspace_id,
        source_plan.plan_type source_type, source_plan.effective_revision_no,
        revision.content_hash current_hash
      from public.project_v2_plan_line_sources s
      left join public.project_v2_plan_lines source_line on source_line.id = s.source_plan_line_id
      left join public.project_v2_plans source_plan on source_plan.id = s.source_plan_id
      left join public.project_v2_plan_revisions revision on revision.plan_id = s.source_plan_id
        and revision.revision_no = s.source_plan_revision_no
      where s.target_line_id = v_line.id order by s.source_plan_id, s.source_plan_line_id,
        s.norm_resource_id loop
      if v_source.source_workspace_id is distinct from v_workspace_id
        or v_source.source_type is distinct from 'construction'
        or v_source.effective_revision_no is distinct from v_source.source_plan_revision_no
        or v_source.current_hash is distinct from v_source.source_plan_hash
        or v_source.work_quantity is null or v_source.source_work_quantity is distinct from v_source.work_quantity
        or v_source.source_unit is distinct from v_source.work_unit then
        raise exception using errcode = '40001', message = 'PROJECT_V2_SOURCE_HASH_STALE';
      end if;
      if v_source.norm_resource_id is null or v_source.norm_resource_id !~ '^g8:' then
        raise exception using errcode = '22023', message = 'PROJECT_V2_MATERIAL_NORM_INCOMPLETE';
      end if;
      select e.* into v_estimate from public.project_work_boq_norm_component_estimates e
        where 'g8:' || e.id = v_source.norm_resource_id and e.work_boq_item_id = v_source.work_item_id
          and e.project_id = v_project_id and e.construction_site_id is not distinct from v_site_id
          and e.resource_type = 'material' and e.selected;
      select m.* into v_mapping from public.project_work_boq_norm_mappings m
        where m.id = v_estimate.mapping_id and m.project_id = v_project_id
          and m.construction_site_id is not distinct from v_site_id and m.status = 'active';
      select b.* into v_budget from public.material_budget_items b
        where b.id = v_estimate.material_budget_item_id and b.project_id = v_project_id
          and b.construction_site_id is not distinct from v_site_id
          and b.source_norm_mapping_id = v_mapping.id
          and b.source_norm_component_estimate_id = v_estimate.id;
      if v_estimate.id is null or v_mapping.id is null or v_budget.id is null
        or v_estimate.cost_norm_resource_id is null
        or v_budget.inventory_item_id is distinct from v_line.inventory_item_id
        or v_budget.unit is distinct from v_line.unit
        or v_estimate.unit is distinct from v_line.unit
        or v_estimate.work_boq_qty_snapshot <= 0 or v_estimate.coefficient <= 0
        or v_source.norm_revision is distinct from md5(to_jsonb(v_mapping)::text
          || to_jsonb(v_estimate)::text || to_jsonb(v_budget)::text) then
        raise exception using errcode = '40001', message = 'PROJECT_V2_MATERIAL_NORM_STALE';
      end if;
      v_expected := round(v_estimate.estimated_qty / v_estimate.work_boq_qty_snapshot
        / v_estimate.coefficient, 6);
      if v_source.norm_factor is distinct from v_expected
        or v_source.coefficient is distinct from v_estimate.coefficient
        or v_source.conversion_numerator is distinct from 1
        or v_source.conversion_denominator is distinct from 1
        or v_source.derived_quantity is distinct from round(v_source.work_quantity
          * v_expected * v_estimate.coefficient, 6)
        or v_source.allocated_quantity is null or v_source.allocated_quantity <= 0 then
        raise exception using errcode = '22023', message = 'PROJECT_V2_DERIVATION_INVALID';
      end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        v_source.source_plan_line_id::text || ':' || v_source.norm_resource_id, 0));
      select coalesce(sum(greatest(q.pending_quantity, q.effective_quantity)), 0)
        into v_reserved from (
        select consumer.id,
          coalesce(sum(other.allocated_quantity) filter (where consumer.status = 'pending_approval'
            and target.revision_no = consumer.revision_no), 0) pending_quantity,
          coalesce(sum(other.allocated_quantity) filter (where target.revision_no = consumer.effective_revision_no), 0) effective_quantity
        from public.project_v2_plan_line_sources other
        join public.project_v2_plan_lines target on target.id = other.target_line_id
        join public.project_v2_plans consumer on consumer.id = target.plan_id
        where other.source_plan_id = v_source.source_plan_id
          and other.source_plan_revision_no = v_source.source_plan_revision_no
          and other.source_plan_line_id = v_source.source_plan_line_id
          and other.norm_resource_id = v_source.norm_resource_id
          and consumer.plan_type = 'material' and consumer.status <> 'cancelled'
          and consumer.id <> p_plan_id group by consumer.id
      ) q;
      select coalesce(sum(current_source.allocated_quantity), 0) into v_requested
      from public.project_v2_plan_line_sources current_source
      join public.project_v2_plan_lines current_target on current_target.id = current_source.target_line_id
      where current_target.plan_id = p_plan_id and current_target.revision_no = p_revision_no
        and current_source.source_plan_id = v_source.source_plan_id
        and current_source.source_plan_revision_no = v_source.source_plan_revision_no
        and current_source.source_plan_line_id = v_source.source_plan_line_id
        and current_source.norm_resource_id = v_source.norm_resource_id;
      if v_reserved + v_requested > v_source.derived_quantity then
        raise exception using errcode = '23514', message = 'PROJECT_V2_MATERIAL_AVAILABILITY_EXCEEDED';
      end if;
    end loop;
    if (select sum(s.allocated_quantity) from public.project_v2_plan_line_sources s
      where s.target_line_id = v_line.id) is distinct from v_line.quantity
      or (select sum(s.derived_quantity) from public.project_v2_plan_line_sources s
        where s.target_line_id = v_line.id) is distinct from v_line.calculated_quantity
      or (v_line.quantity is distinct from v_line.calculated_quantity
        and nullif(btrim(v_line.override_reason), '') is null) then
      raise exception using errcode = '22023', message = 'PROJECT_V2_MATERIAL_TOTAL_INVALID';
    end if;
  end loop;
end;
$$;

revoke all on function app_private.project_v2_validate_material_sources(uuid, integer)
  from public, anon, authenticated;

-- Replaced below to validate material allocation per exact norm resource.
create or replace function app_private.project_v2_validate_sources(
  p_plan_id uuid, p_revision_no integer, p_plan_type text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_source record;
  v_reserved numeric(20,6);
  v_available numeric(20,6);
  v_line_total numeric(20,6);
  v_line record;
  v_workspace public.project_v2_workspaces%rowtype;
begin
  if p_plan_type = 'month' then return; end if;
  if p_plan_type = 'material' then
    perform app_private.project_v2_validate_material_sources(p_plan_id, p_revision_no);
    return;
  end if;
  select w.* into v_workspace from public.project_v2_workspaces w
    join public.project_v2_plans p on p.workspace_id = w.id where p.id = p_plan_id;
  for v_source in
    select s.source_plan_id, s.source_plan_revision_no, s.source_plan_line_id,
      s.source_plan_hash, s.source_unit, sum(s.source_work_quantity) as requested
    from public.project_v2_plan_line_sources s
    join public.project_v2_plan_lines target on target.id = s.target_line_id
    where target.plan_id = p_plan_id and target.revision_no = p_revision_no
    group by s.source_plan_id, s.source_plan_revision_no, s.source_plan_line_id,
      s.source_plan_hash, s.source_unit
    order by s.source_plan_id, s.source_plan_line_id
  loop
    if v_source.source_plan_id is null or v_source.source_plan_line_id is null
      or v_source.requested is null then
      raise exception using errcode = '22023', message = 'PROJECT_V2_SOURCE_INCOMPLETE';
    end if;
    if not exists (
      select 1 from public.project_v2_plan_revisions r
      join public.project_v2_plans p on p.id = r.plan_id
      join public.project_v2_plan_lines l on l.id = v_source.source_plan_line_id
      where r.plan_id = v_source.source_plan_id and r.revision_no = v_source.source_plan_revision_no
        and r.content_hash = v_source.source_plan_hash
        and l.plan_id = r.plan_id and l.revision_no = r.revision_no
        and p.plan_type = case when p_plan_type = 'construction' then 'month' else 'construction' end
        and p.effective_revision_no = r.revision_no
        and l.unit = v_source.source_unit
    ) then
      raise exception using errcode = '40001', message = 'PROJECT_V2_SOURCE_HASH_STALE';
    end if;
    select l.quantity into v_available from public.project_v2_plan_lines l
      where l.id = v_source.source_plan_line_id;
    if v_available is null then
      raise exception using errcode = '22023', message = 'PROJECT_V2_SOURCE_QUANTITY_UNKNOWN';
    end if;
    if p_plan_type in ('construction', 'material') then
      select coalesce(sum(greatest(q.pending_quantity, q.effective_quantity)), 0) into v_reserved
      from (
        select consumer.id,
          coalesce(sum(s.source_work_quantity) filter (where consumer.status = 'pending_approval'
            and target.revision_no = consumer.revision_no), 0) pending_quantity,
          coalesce(sum(s.source_work_quantity) filter (where target.revision_no = consumer.effective_revision_no), 0) effective_quantity
        from public.project_v2_plan_line_sources s
        join public.project_v2_plan_lines target on target.id = s.target_line_id
        join public.project_v2_plans consumer on consumer.id = target.plan_id
        where s.source_plan_id = v_source.source_plan_id
          and s.source_plan_revision_no = v_source.source_plan_revision_no
          and s.source_plan_line_id = v_source.source_plan_line_id
          and consumer.status <> 'cancelled' and consumer.id <> p_plan_id
        group by consumer.id
      ) q;
      if v_reserved + v_source.requested > v_available then
        raise exception using errcode = '23514', message = 'PROJECT_V2_SOURCE_QUANTITY_EXCEEDED',
          detail = jsonb_build_object('sourceLineId', v_source.source_plan_line_id,
            'availableQuantity', greatest(v_available - v_reserved, 0))::text;
      end if;
    end if;
  end loop;

  if p_plan_type = 'material' and exists (
    select 1 from public.project_v2_plan_line_sources s
    join public.project_v2_plan_lines l on l.id = s.target_line_id
    where l.plan_id = p_plan_id and l.revision_no = p_revision_no
      and (s.norm_resource_id is null or s.norm_revision is null
        or s.norm_factor is null or s.coefficient is null
        or s.conversion_numerator is null or s.conversion_denominator is null
        or s.derived_quantity is null or s.source_work_quantity is null
        or round(s.source_work_quantity * s.norm_factor * s.coefficient
          * s.conversion_numerator / nullif(s.conversion_denominator, 0), 6)
          is distinct from s.derived_quantity)
  ) then
    raise exception using errcode = '22023', message = 'PROJECT_V2_DERIVATION_INVALID';
  end if;

  -- The selected sources must explain each target line exactly. For material,
  -- derived quantity belongs to the exact norm/resource source, not the SKU.
  for v_source in
    select l.id, l.quantity, coalesce(sum(case when p_plan_type = 'material'
      then s.derived_quantity else s.source_work_quantity end), 0) as total
    from public.project_v2_plan_lines l
    left join public.project_v2_plan_line_sources s on s.target_line_id = l.id
    where l.plan_id = p_plan_id and l.revision_no = p_revision_no
    group by l.id, l.quantity
  loop
    select l.* into v_line from public.project_v2_plan_lines l where l.id = v_source.id;
    if p_plan_type = 'construction' and nullif(btrim(v_line.baseline_exception_reason), '') is not null then
      if v_source.total <> 0 or v_source.quantity is null or
        not exists (select 1 from public.contract_items i
          where i.id::text = v_line.work_item_id and i.project_id = v_workspace.project_id
            and i.contract_type = 'customer' and i.is_locked and i.locked_at is not null
            and i.locked_at::text = v_line.baseline_revision and i.unit = v_line.unit
            and v_line.quantity <= coalesce(i.revised_quantity, i.quantity)
            and not exists(select 1 from public.contract_items child where child.parent_id = i.id)) or
        not app_private.project_has_permission_v2(v_workspace.project_id,
          v_workspace.primary_construction_site_id::text,
          'project.v2_construction_plan.manage', public.current_app_user_id()) then
        raise exception using errcode = '42501', message = 'PROJECT_V2_BASELINE_EXCEPTION_DENIED';
      end if;
    elsif v_source.quantity is null or v_source.quantity <> v_source.total then
      raise exception using errcode = '22023', message = 'PROJECT_V2_SOURCE_TOTAL_MISMATCH';
    end if;
  end loop;
end;
$$;


-- Extended save command persists both calculation and approved allocation.
create or replace function public.save_project_v2_plan_v1(
  p_workspace_id uuid, p_plan_id uuid, p_expected_version bigint,
  p_idempotency_key text, p_plan_type text, p_code text, p_title text,
  p_period_start date, p_period_end date, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_workspace public.project_v2_workspaces%rowtype;
  v_plan public.project_v2_plans%rowtype;
  v_line jsonb;
  v_source jsonb;
  v_line_id uuid;
  v_source_plan public.project_v2_plans%rowtype;
  v_source_line public.project_v2_plan_lines%rowtype;
  v_source_hash text;
  v_source_id uuid;
  v_existing jsonb;
  v_result jsonb;
  v_payload jsonb;
  v_quantity_text text;
  v_order integer := 0;
begin
  select * into v_workspace from public.project_v2_workspaces w
    where w.id = p_workspace_id and w.lifecycle <> 'archived' for update of w;
  if v_workspace.id is null or p_plan_type not in ('month', 'construction', 'material') then
    raise exception using errcode = '22023', message = 'PROJECT_V2_INVALID_WORKSPACE_OR_TYPE';
  end if;
  perform app_private.project_v2_assert_permission(v_workspace, p_plan_type,
    case when p_plan_id is null then 'create' else 'edit_all' end, v_actor);
  if nullif(btrim(p_code), '') is null or nullif(btrim(p_title), '') is null
    or p_period_start is null or p_period_end is null or p_period_end < p_period_start
    or jsonb_typeof(p_lines) <> 'array' then
    raise exception using errcode = '22023', message = 'PROJECT_V2_INVALID_DRAFT';
  end if;
  if p_plan_id is not null then
    select * into v_plan from public.project_v2_plans p where p.id = p_plan_id for update of p;
    if v_plan.id is null or v_plan.workspace_id <> p_workspace_id or v_plan.plan_type <> p_plan_type then
      raise exception using errcode = '42501', message = 'PROJECT_V2_PLAN_SCOPE_DENIED';
    end if;
    if v_plan.status not in ('draft', 'returned') then
      raise exception using errcode = '23514', message = 'PROJECT_V2_PLAN_IMMUTABLE';
    end if;
  elsif p_expected_version is not null then
    raise exception using errcode = '22023', message = 'PROJECT_V2_VERSION_INVALID';
  end if;

  -- Lock every referenced source in deterministic order before changing lines.
  for v_source_id in
    select distinct (source_item.value ->> 'sourcePlanId')::uuid as id
    from jsonb_array_elements(p_lines) line_item,
      lateral jsonb_array_elements(coalesce(line_item.value -> 'sources',
        line_item.value -> 'derivations', '[]'::jsonb)) source_item
    where source_item.value ? 'sourcePlanId'
    order by id
  loop
    perform 1 from public.project_v2_plans p where p.id = v_source_id for update of p;
  end loop;
  for v_source_id in
    select distinct (source_item.value ->> 'sourceLineId')::uuid as id
    from jsonb_array_elements(p_lines) line_item,
      lateral jsonb_array_elements(coalesce(line_item.value -> 'sources',
        line_item.value -> 'derivations', '[]'::jsonb)) source_item
    where source_item.value ? 'sourceLineId'
    order by id
  loop
    perform 1 from public.project_v2_plan_lines l where l.id = v_source_id for update of l;
  end loop;
  if p_plan_id is not null then
    perform 1 from public.project_v2_plan_lines l where l.plan_id = p_plan_id
      and l.revision_no = v_plan.revision_no order by l.id for update;
  end if;
  v_payload := jsonb_build_object('planId', p_plan_id, 'expectedVersion', p_expected_version,
    'planType', p_plan_type, 'code', p_code, 'title', p_title,
    'periodStart', p_period_start, 'periodEnd', p_period_end, 'lines', p_lines);
  v_existing := app_private.project_v2_begin_command(v_actor, p_workspace_id,
    'save', p_idempotency_key, v_payload);
  if v_existing is not null then return v_existing; end if;
  if p_plan_id is not null and (p_expected_version is null or v_plan.version <> p_expected_version) then
    raise exception using errcode = '40001', message = 'PROJECT_V2_VERSION_STALE';
  end if;
  if p_plan_id is null then
    insert into public.project_v2_plans(workspace_id, plan_type, code, title, period_start,
      period_end, creator_user_id)
    values (p_workspace_id, p_plan_type, p_code, p_title, p_period_start,
      p_period_end, v_actor) returning * into v_plan;
  else
    delete from public.project_v2_plan_line_sources s where s.target_line_id in
      (select l.id from public.project_v2_plan_lines l where l.plan_id = v_plan.id
        and l.revision_no = v_plan.revision_no);
    delete from public.project_v2_plan_lines l where l.plan_id = v_plan.id
      and l.revision_no = v_plan.revision_no;
    update public.project_v2_plans set code = p_code, title = p_title,
      period_start = p_period_start, period_end = p_period_end,
      status = 'draft', submitter_user_id = null, version = version + 1,
      updated_at = now() where id = v_plan.id returning * into v_plan;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_order := v_order + 1;
    v_quantity_text := v_line ->> 'quantity';
    if v_quantity_text is not null and v_quantity_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$' then
      raise exception using errcode = '22023', message = 'PROJECT_V2_QUANTITY_INVALID';
    end if;
    if p_plan_type = 'construction' and v_line ->> 'crewId' is not null
      and not exists (select 1 from public.project_v2_crews c where c.id = (v_line ->> 'crewId')::uuid
        and c.workspace_id = p_workspace_id and c.is_active) then
      raise exception using errcode = '42501', message = 'PROJECT_V2_CREW_SCOPE_DENIED';
    end if;
    if p_plan_type = 'construction' and nullif(btrim(v_line ->> 'baselineExceptionReason'), '') is not null
      and jsonb_array_length(coalesce(v_line -> 'sources', '[]'::jsonb)) <> 0 then
      raise exception using errcode = '22023', message = 'PROJECT_V2_BASELINE_EXCEPTION_SOURCE_CONFLICT';
    end if;
    v_line_id := coalesce((v_line ->> 'id')::uuid, gen_random_uuid());
    insert into public.project_v2_plan_lines(id, plan_id, revision_no, plan_type,
      sort_order, contract_item_id, baseline_revision, work_item_id,
      inventory_item_id, unit, quantity, unit_price_snapshot, currency,
      work_start, work_end, crew_id, needed_date, destination_id,
      baseline_exception_reason, note, calculated_quantity, override_reason)
    values (v_line_id, v_plan.id, v_plan.revision_no, p_plan_type,
      v_order, (v_line ->> 'contractItemId')::uuid, v_line ->> 'baselineRevision',
      v_line ->> 'workItemId', v_line ->> 'itemId', v_line ->> 'unit',
      v_quantity_text::numeric(20,6), (v_line ->> 'unitPriceSnapshot')::numeric(20,6),
      v_line ->> 'currency', (v_line ->> 'workStart')::date,
      (v_line ->> 'workEnd')::date, (v_line ->> 'crewId')::uuid,
      (v_line ->> 'neededDate')::date, v_line ->> 'destinationId', v_line ->> 'baselineExceptionReason',
      v_line ->> 'note', (v_line ->> 'calculatedQuantity')::numeric(20,6),
      v_line ->> 'overrideReason');

    for v_source in select value from jsonb_array_elements(coalesce(
      v_line -> 'sources', v_line -> 'derivations', '[]'::jsonb)) loop
      select * into v_source_plan from public.project_v2_plans
        where id = (v_source ->> 'sourcePlanId')::uuid;
      select r.content_hash into v_source_hash from public.project_v2_plan_revisions r
        where r.plan_id = v_source_plan.id
          and r.revision_no = (v_source ->> 'sourceRevision')::integer;
      select * into v_source_line from public.project_v2_plan_lines l
        where l.id = (v_source ->> 'sourceLineId')::uuid
          and l.plan_id = v_source_plan.id
          and l.revision_no = (v_source ->> 'sourceRevision')::integer;
      if v_source_plan.id is null or v_source_plan.workspace_id <> p_workspace_id
        or v_source_plan.plan_type <> (case when p_plan_type = 'construction' then 'month' else 'construction' end)
        or v_source_hash is null or v_source_line.id is null or (v_source ? 'sourcePlanHash'
          and v_source ->> 'sourcePlanHash' <> v_source_hash) then
        raise exception using errcode = '40001', message = 'PROJECT_V2_SOURCE_HASH_STALE';
      end if;
      v_quantity_text := coalesce(v_source ->> 'sourceQuantity', v_source ->> 'sourceWorkQuantity');
      if v_quantity_text is not null and v_quantity_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$' then
        raise exception using errcode = '22023', message = 'PROJECT_V2_QUANTITY_INVALID';
      end if;
      insert into public.project_v2_plan_line_sources(target_line_id, source_plan_id,
        source_plan_revision_no, source_plan_line_id, source_plan_hash,
        source_work_quantity, source_unit, norm_resource_id, norm_revision,
        norm_factor, coefficient, conversion_numerator, conversion_denominator, derived_quantity,
        allocated_quantity)
      values (v_line_id, v_source_plan.id, (v_source ->> 'sourceRevision')::integer,
        (v_source ->> 'sourceLineId')::uuid, v_source_hash, v_quantity_text::numeric(20,6),
        v_source_line.unit,
        v_source ->> 'normResourceId', v_source ->> 'normRevision',
        (v_source ->> 'normFactor')::numeric(20,6),
        (v_source ->> 'coefficient')::numeric(20,6),
        (v_source ->> 'conversionNumerator')::numeric(20,6),
        (v_source ->> 'conversionDenominator')::numeric(20,6),
        (v_source ->> 'derivedQuantity')::numeric(20,6),
        (v_source ->> 'allocatedQuantity')::numeric(20,6));
    end loop;
  end loop;
  v_result := jsonb_build_object('planId', v_plan.id, 'version', v_plan.version,
    'revision', v_plan.revision_no, 'status', v_plan.status, 'outcome', 'committed');
  insert into public.project_v2_plan_events(plan_id, revision_no, event_type, actor_user_id,
    payload, command_id)
  select v_plan.id, v_plan.revision_no, 'saved', v_actor,
    jsonb_build_object('lineCount', v_order), c.id
    from app_private.project_v2_commands c where c.actor_user_id = v_actor
      and c.workspace_id = p_workspace_id and c.operation = 'save'
      and c.idempotency_key = p_idempotency_key;
  return app_private.project_v2_finish_command(v_actor, p_workspace_id,
    'save', p_idempotency_key, v_result);
end;
$$;

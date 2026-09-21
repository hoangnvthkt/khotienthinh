create function app_private.list_boq_material_planning_v1(
  p_actor uuid,
  p_project_id text,
  p_construction_site_id text default null,
  p_parent_id text default null,
  p_search text default null,
  p_limit integer default 50,
  p_cursor text default null,
  p_as_of timestamptz default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_site text := nullif(p_construction_site_id, '');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_as_of timestamptz := coalesce(p_as_of, statement_timestamp());
  v_can_view_price boolean;
  v_result jsonb;
begin
  if p_actor is null or not exists (
    select 1 from public.users actor
    where actor.id = p_actor
      and coalesce(actor.is_active, true)
      and coalesce(actor.account_status, 'ACTIVE') = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'BOQ_MATERIAL_PLANNING_READ_DENIED';
  end if;
  if nullif(btrim(coalesce(p_project_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'BOQ_MATERIAL_PLANNING_SCOPE_REQUIRED';
  end if;
  if not app_private.project_actor_has_effective_room_action(
    p_actor, p_project_id, v_site, 'material_planning', 'view'
  ) then
    raise exception using errcode = '42501', message = 'BOQ_MATERIAL_PLANNING_READ_DENIED';
  end if;
  v_can_view_price := app_private.project_actor_has_effective_room_action(
    p_actor, p_project_id, v_site, 'material_po', 'view'
  );

  with recursive
  scoped_work as materialized (
    select work.id, work.parent_id, work.source_task_id, work.wbs_code, work.name,
      work.sort_order, work.created_at, work.updated_at,
      task.name task_name, task.start_date, task.end_date, task.row_version task_version
    from public.project_work_boq_items work
    left join public.project_tasks task
      on task.id = work.source_task_id
      and task.project_id = p_project_id
      and task.construction_site_id is not distinct from v_site
    where work.project_id = p_project_id
      and work.construction_site_id is not distinct from v_site
      and work.created_at <= v_as_of
  ),
  scoped_budget as materialized (
    select budget.id, budget.work_boq_item_id, budget.inventory_item_id item_id,
      nullif(btrim(budget.material_code), '') sku, budget.item_name,
      budget.category, budget.unit, budget.budget_qty::numeric(20,6) budget_qty,
      budget.budget_unit_price::numeric budget_unit_price,
      budget.sort_order, budget.created_at
    from public.material_budget_items budget
    where budget.project_id = p_project_id
      and budget.construction_site_id is not distinct from v_site
      and budget.created_at <= v_as_of
  ),
  exact_issue as materialized (
    select line.material_budget_item_id budget_id,
      sum(greatest(line.issued_qty - line.returned_qty, 0))::numeric(20,6) issued_net
    from public.material_issue_lines line
    join public.material_issue_orders issue on issue.id = line.issue_order_id
    join scoped_budget budget
      on budget.id = line.material_budget_item_id
      and budget.work_boq_item_id is not distinct from line.work_boq_item_id
      and budget.item_id = line.item_id
      and budget.unit is not distinct from line.unit
    where issue.project_id = p_project_id
      and issue.construction_site_id is not distinct from v_site
      and issue.status in ('issued', 'partially_received', 'received', 'settling', 'partially_returned', 'closed')
      and line.created_at <= v_as_of
    group by line.material_budget_item_id
  ),
  issue_mismatch as materialized (
    select line.material_budget_item_id budget_id, count(*) issue_count
    from public.material_issue_lines line
    join public.material_issue_orders issue on issue.id = line.issue_order_id
    join scoped_budget budget on budget.id = line.material_budget_item_id
    where issue.project_id = p_project_id
      and issue.construction_site_id is not distinct from v_site
      and issue.status in ('issued', 'partially_received', 'received', 'settling', 'partially_returned', 'closed')
      and line.created_at <= v_as_of
      and (budget.work_boq_item_id is distinct from line.work_boq_item_id
        or budget.item_id is distinct from line.item_id
        or budget.unit is distinct from line.unit)
    group by line.material_budget_item_id
  ),
  unallocated_issue as materialized (
    select line.item_id, line.unit, count(*) issue_count
    from public.material_issue_lines line
    join public.material_issue_orders issue on issue.id = line.issue_order_id
    left join scoped_budget budget on budget.id = line.material_budget_item_id
    where issue.project_id = p_project_id
      and issue.construction_site_id is not distinct from v_site
      and issue.status in ('issued', 'partially_received', 'received', 'settling', 'partially_returned', 'closed')
      and line.created_at <= v_as_of
      and (budget.id is null
        or budget.work_boq_item_id is distinct from line.work_boq_item_id
        or budget.item_id is distinct from line.item_id
        or budget.unit is distinct from line.unit)
      and line.issued_qty - line.returned_qty <> 0
    group by line.item_id, line.unit
  ),
  linked_issue_by_request_line as materialized (
    select issue.material_request_id request_id,
      line.material_request_line_id request_line_id,
      line.material_budget_item_id budget_id,
      line.work_boq_item_id work_id,
      sum(greatest(line.issued_qty - line.returned_qty, 0))::numeric(20,6) issued_net
    from public.material_issue_lines line
    join public.material_issue_orders issue on issue.id = line.issue_order_id
    where issue.project_id = p_project_id
      and issue.construction_site_id is not distinct from v_site
      and issue.status in ('issued', 'partially_received', 'received', 'settling', 'partially_returned', 'closed')
      and nullif(line.material_request_line_id, '') is not null
      and line.created_at <= v_as_of
    group by issue.material_request_id, line.material_request_line_id,
      line.material_budget_item_id, line.work_boq_item_id
  ),
  request_sources as materialized (
    select request.id request_id, request.status::text request_status,
      registry.source_line_id request_line_id, registry.item_id, registry.unit,
      registry.material_budget_item_id budget_id, registry.work_boq_item_id work_id,
      demand_line.requested_qty,
      demand_line.approved_qty,
      demand_line.intake_state,
      demand_line.health_state,
      case
        when demand_line.id is null then 'boq_request_identity_not_ingested'
        when demand_line.current_source_revision_id is distinct from demand.current_source_revision_id
          then 'boq_request_source_revision_stale'
        when demand_line.intake_state not in ('preliminary', 'ready')
          or demand_line.health_state <> 'healthy' then 'boq_request_source_unhealthy'
        else null
      end blocking_issue,
      coalesce(linked.issued_net, 0)::numeric(20,6) issued_net
    from public.requests request
    join public.procurement_source_documents document
      on document.source_adapter = 'project_material_request'
      and document.source_document_id = request.id
      and document.project_id = p_project_id
      and document.construction_site_id is not distinct from v_site
      and document.archived_at is null
    join public.procurement_source_line_registry registry
      on registry.source_document_id = document.id and registry.archived_at is null
    left join public.procurement_demands demand on demand.source_document_id = document.id
    left join public.procurement_demand_lines demand_line
      on demand_line.demand_id = demand.id
      and demand_line.source_line_registry_id = registry.id
    left join linked_issue_by_request_line linked
      on linked.request_id = request.id
      and linked.request_line_id = registry.source_line_id
      and linked.budget_id is not distinct from registry.material_budget_item_id
      and linked.work_id is not distinct from registry.work_boq_item_id
    where request.project_id = p_project_id
      and request.construction_site_id is not distinct from v_site
      and request.request_origin = 'project'
      and request.created_at <= v_as_of
      and upper(request.status::text) in ('PENDING', 'APPROVED', 'IN_TRANSIT', 'COMPLETED')
  ),
  request_balance as materialized (
    select source.budget_id,
      sum(case when upper(source.request_status) = 'PENDING'
        then greatest(coalesce(source.requested_qty, 0) - source.issued_net, 0) else 0 end)::numeric(20,6) awaiting_approval,
      sum(case when upper(source.request_status) = 'APPROVED'
        then greatest(coalesce(source.approved_qty, 0) - source.issued_net, 0) else 0 end)::numeric(20,6) awaiting_arrangement,
      sum(case when upper(source.request_status) in ('IN_TRANSIT', 'COMPLETED')
        then greatest(coalesce(source.approved_qty, 0) - source.issued_net, 0) else 0 end)::numeric(20,6) executing,
      array_remove(array_agg(distinct source.blocking_issue), null) blocking_issues
    from request_sources source
    join scoped_budget budget
      on budget.id = source.budget_id
      and budget.work_boq_item_id is not distinct from source.work_id
      and budget.item_id = source.item_id
      and budget.unit = source.unit
    group by source.budget_id
  ),
  unallocated_request as materialized (
    select source.item_id, source.unit, count(*) request_count
    from request_sources source
    left join scoped_budget budget
      on budget.id = source.budget_id
      and budget.work_boq_item_id is not distinct from source.work_id
      and budget.item_id = source.item_id
      and budget.unit = source.unit
    where budget.id is null or source.blocking_issue is not null
    group by source.item_id, source.unit
  ),
  line_balances as materialized (
    select budget.*,
      case when budget.item_id is null
        or mismatch.budget_id is not null
        or unallocated_issue.issue_count is not null then null
        else coalesce(exact_issue.issued_net, 0) end issued_net,
      case when budget.item_id is null
        or coalesce(cardinality(request_balance.blocking_issues), 0) > 0
        or unallocated_request.request_count is not null then null
        else coalesce(request_balance.awaiting_approval, 0) end awaiting_approval,
      case when budget.item_id is null
        or coalesce(cardinality(request_balance.blocking_issues), 0) > 0
        or unallocated_request.request_count is not null then null
        else coalesce(request_balance.awaiting_arrangement, 0) end awaiting_arrangement,
      case when budget.item_id is null
        or coalesce(cardinality(request_balance.blocking_issues), 0) > 0
        or unallocated_request.request_count is not null then null
        else coalesce(request_balance.executing, 0) end executing,
      array_remove(array[
        case when budget.item_id is null then 'boq_item_identity_missing' end,
        case when mismatch.budget_id is not null then 'boq_issue_identity_mismatch' end,
        case when unallocated_issue.issue_count is not null then 'boq_issue_allocation_missing' end,
        case when unallocated_request.request_count is not null then 'boq_request_allocation_missing' end
      ]::text[] || coalesce(request_balance.blocking_issues, '{}'::text[]), null) blocking_issues,
      array['boq_closure_not_supported']::text[] issues
    from scoped_budget budget
    left join exact_issue on exact_issue.budget_id = budget.id
    left join issue_mismatch mismatch on mismatch.budget_id = budget.id
    left join unallocated_issue
      on unallocated_issue.item_id = budget.item_id and unallocated_issue.unit = budget.unit
    left join request_balance on request_balance.budget_id = budget.id
    left join unallocated_request
      on unallocated_request.item_id = budget.item_id and unallocated_request.unit = budget.unit
  ),
  computed_lines as materialized (
    select line.*,
      case when line.issued_net is null or line.awaiting_approval is null
        or line.awaiting_arrangement is null or line.executing is null then null
        else greatest(line.budget_qty - line.issued_net - line.awaiting_approval
          - line.awaiting_arrangement - line.executing, 0)::numeric(20,6) end uncovered,
      case when line.issued_net is null or line.awaiting_approval is null
        or line.awaiting_arrangement is null or line.executing is null then null
        else greatest(line.issued_net + line.awaiting_approval + line.awaiting_arrangement
          + line.executing - line.budget_qty, 0)::numeric(20,6) end excess
    from line_balances line
  ),
  filtered_lines as materialized (
    select line.*
    from computed_lines line
    left join scoped_work work on work.id = line.work_boq_item_id
    where v_search is null
      or line.item_name ilike '%' || v_search || '%'
      or coalesce(line.sku, '') ilike '%' || v_search || '%'
      or line.category ilike '%' || v_search || '%'
      or coalesce(work.name, '') ilike '%' || v_search || '%'
      or coalesce(work.wbs_code, '') ilike '%' || v_search || '%'
  ),
  matched_work as materialized (
    select work.*
    from scoped_work work
    where v_search is null
      or work.name ilike '%' || v_search || '%'
      or coalesce(work.wbs_code, '') ilike '%' || v_search || '%'
      or coalesce(work.task_name, '') ilike '%' || v_search || '%'
      or exists (select 1 from filtered_lines line where line.work_boq_item_id = work.id)
  ),
  work_filter_tree as (
    select work.id, work.parent_id from matched_work work
    union
    select parent.id, parent.parent_id
    from scoped_work parent
    join work_filter_tree child on child.parent_id = parent.id
  ),
  filtered_work as materialized (
    select work.*
    from scoped_work work
    join work_filter_tree included on included.id = work.id
  ),
  work_page_candidates as materialized (
    select work.*, false synthetic
    from filtered_work work
    where p_parent_id is distinct from '__unallocated__'
      and work.parent_id is not distinct from nullif(p_parent_id, '')
      and (p_cursor is null or (work.sort_order, work.id) > (
        coalesce(
          (select cursor_work.sort_order from scoped_work cursor_work where cursor_work.id = p_cursor),
          case when p_cursor = '__unallocated__' then 2147483647 else -2147483648 end
        ),
        p_cursor
      ))
    union all
    select '__unallocated__', null, null, null, 'Chưa phân bổ', 2147483647,
      v_as_of, v_as_of, null, null, null, null, true
    where p_parent_id is null
      and (p_cursor is null or (2147483647, '__unallocated__') > (
        coalesce(
          (select cursor_work.sort_order from scoped_work cursor_work where cursor_work.id = p_cursor),
          case when p_cursor = '__unallocated__' then 2147483647 else -2147483648 end
        ),
        p_cursor
      ))
      and (
        exists (select 1 from filtered_lines line where line.work_boq_item_id is null)
        or exists (select 1 from unallocated_issue)
        or exists (select 1 from unallocated_request)
      )
  ),
  work_page as materialized (
    select * from work_page_candidates order by sort_order, id limit v_limit + 1
  ),
  visible_work as materialized (
    select * from work_page order by sort_order, id limit v_limit
  ),
  unallocated_line_page as materialized (
    select line.* from filtered_lines line
    where line.work_boq_item_id is null
      and (p_cursor is null or (line.sort_order, line.id) > (
        coalesce((select cursor_line.sort_order from filtered_lines cursor_line where cursor_line.id = p_cursor), -2147483648),
        p_cursor
      ))
    order by line.sort_order, line.id limit v_limit + 1
  ),
  visible_unallocated_lines as materialized (
    select * from unallocated_line_page order by sort_order, id limit v_limit
  ),
  version_source as (
    select encode(extensions.digest(concat_ws('|',
      p_project_id, coalesce(v_site, ''), v_as_of::text,
      (select coalesce(string_agg(concat_ws(':',
        work.id, coalesce(work.parent_id, ''), coalesce(work.source_task_id, ''),
        coalesce(work.wbs_code, ''), work.name, work.sort_order::text, work.updated_at::text
      ), '|' order by work.id), '') from scoped_work work),
      (select coalesce(string_agg(concat_ws(':',
        budget.id, coalesce(budget.work_boq_item_id, ''), coalesce(budget.item_id, ''),
        coalesce(budget.sku, ''), budget.unit, budget.budget_qty::text,
        coalesce(budget.budget_unit_price::text, ''), budget.created_at::text
      ), '|' order by budget.id), '') from scoped_budget budget),
      (select coalesce(string_agg(concat_ws(':',
        exact.budget_id, exact.issued_net::text
      ), '|' order by exact.budget_id), '') from exact_issue exact),
      (select coalesce(string_agg(concat_ws(':',
        mismatch.budget_id, mismatch.issue_count::text
      ), '|' order by mismatch.budget_id), '') from issue_mismatch mismatch),
      (select coalesce(string_agg(concat_ws(':',
        coalesce(unallocated.item_id, ''), coalesce(unallocated.unit, ''), unallocated.issue_count::text
      ), '|' order by unallocated.item_id, unallocated.unit), '') from unallocated_issue unallocated),
      (select coalesce(string_agg(concat_ws(':',
        source.request_id, source.request_line_id, coalesce(source.budget_id, ''),
        coalesce(source.work_id, ''), coalesce(source.item_id, ''), coalesce(source.unit, ''), source.request_status,
        coalesce(source.requested_qty::text, ''), coalesce(source.approved_qty::text, ''),
        coalesce(source.intake_state, ''), coalesce(source.health_state, ''),
        coalesce(source.blocking_issue, ''), source.issued_net::text
      ), '|' order by source.request_id, source.request_line_id, source.budget_id), '')
        from request_sources source)
    ), 'sha256'), 'hex') value
  ),
  line_json as (
    select line.id,
      jsonb_build_object(
        'id', line.id,
        'workBoqItemId', line.work_boq_item_id,
        'taskId', work.source_task_id,
        'itemId', line.item_id,
        'sku', line.sku,
        'itemName', line.item_name,
        'category', line.category,
        'unit', line.unit,
        'suggestedQty30d', null,
        'unitPrice', case when v_can_view_price then line.budget_unit_price::text else null end,
        'issues', to_jsonb(line.issues || line.blocking_issues),
        'balance', jsonb_build_object(
          'unit', line.unit,
          'budget', line.budget_qty::text,
          'issuedNet', line.issued_net::text,
          'open', jsonb_build_object(
            'awaitingApproval', line.awaiting_approval::text,
            'awaitingArrangement', line.awaiting_arrangement::text,
            'executing', line.executing::text
          ),
          'closed', '0.000000',
          'uncovered', line.uncovered::text,
          'excess', line.excess::text,
          'issues', to_jsonb(line.issues),
          'blockingIssues', to_jsonb(line.blocking_issues),
          'completeness', case when cardinality(line.blocking_issues) > 0 then 'unknown' else 'partial' end,
          'selectable', cardinality(line.blocking_issues) = 0
        )
      ) value
    from filtered_lines line
    left join scoped_work work on work.id = line.work_boq_item_id
  ),
  node_json as (
    select work.id, work.sort_order,
      jsonb_build_object(
        'id', work.id,
        'parentId', work.parent_id,
        'taskId', work.source_task_id,
        'taskName', work.task_name,
        'wbsCode', work.wbs_code,
        'name', work.name,
        'sortOrder', work.sort_order,
        'childCount', case when work.synthetic then
          (select count(*) from filtered_lines line where line.work_boq_item_id is null)
          else (select count(*) from filtered_work child where child.parent_id = work.id) end,
        'synthetic', case when work.synthetic then 'unallocated' else null end,
        'materials', case when work.synthetic then '[]'::jsonb else coalesce((
          select jsonb_agg(line_json.value order by line.sort_order, line.id)
          from filtered_lines line join line_json on line_json.id = line.id
          where line.work_boq_item_id = work.id
        ), '[]'::jsonb) end
      ) value
    from visible_work work
  ),
  unallocated_node_json as (
    select jsonb_build_object(
      'id', '__unallocated__', 'parentId', null, 'taskId', null, 'taskName', null,
      'wbsCode', null, 'name', 'Chưa phân bổ', 'sortOrder', 2147483647,
      'childCount', 0, 'synthetic', 'unallocated',
      'materials', coalesce((
        select jsonb_agg(line_json.value order by line.sort_order, line.id)
        from visible_unallocated_lines line join line_json on line_json.id = line.id
      ), '[]'::jsonb)
    ) value
  )
  select jsonb_build_object(
    'scope', jsonb_build_object('projectId', p_project_id, 'constructionSiteId', v_site),
    'asOf', v_as_of,
    'metricVersion', (select value from version_source),
    'nodes', case when p_parent_id = '__unallocated__'
      then jsonb_build_array((select value from unallocated_node_json))
      else coalesce((select jsonb_agg(value order by sort_order, id) from node_json), '[]'::jsonb) end,
    'nextCursor', case when p_parent_id = '__unallocated__' then
      case when (select count(*) from unallocated_line_page) > v_limit
        then (select id from visible_unallocated_lines order by sort_order desc, id desc limit 1) end
      else case when (select count(*) from work_page) > v_limit
        then (select id from visible_work order by sort_order desc, id desc limit 1) end end,
    'totals', jsonb_build_object(
      'workNodeCount', (select count(*) from filtered_work),
      'materialLineCount', (select count(*) from filtered_lines),
      'selectableLineCount', (select count(*) from filtered_lines where cardinality(blocking_issues) = 0),
      'unallocatedEffectCount',
        (select coalesce(sum(issue_count), 0) from unallocated_issue)
        + (select coalesce(sum(request_count), 0) from unallocated_request)
    ),
    'capabilities', jsonb_build_object('canViewPrice', coalesce(v_can_view_price, false))
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function app_private.list_boq_material_planning_v1(
  uuid, text, text, text, text, integer, text, timestamptz
) from public, anon, authenticated;
grant execute on function app_private.list_boq_material_planning_v1(
  uuid, text, text, text, text, integer, text, timestamptz
) to service_role;

create function public.list_boq_material_planning_v1(
  p_project_id text,
  p_construction_site_id text default null,
  p_parent_id text default null,
  p_search text default null,
  p_limit integer default 50,
  p_cursor text default null,
  p_as_of timestamptz default null
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.list_boq_material_planning_v1(
    public.current_app_user_id(), p_project_id, nullif(p_construction_site_id, ''),
    nullif(p_parent_id, ''), nullif(p_search, ''), p_limit, nullif(p_cursor, ''), p_as_of
  );
$$;

revoke all on function public.list_boq_material_planning_v1(
  text, text, text, text, integer, text, timestamptz
) from public, anon;
grant execute on function public.list_boq_material_planning_v1(
  text, text, text, text, integer, text, timestamptz
) to authenticated, service_role;

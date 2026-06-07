-- Phase 2 performance: server-side material request board/detail and
-- inventory ledger report aggregation. Read-only RPCs only.

create index if not exists idx_requests_project_origin_site_created_phase2
  on public.requests(project_id, request_origin, construction_site_id, created_date desc, id desc)
  where request_origin = 'project';

create index if not exists idx_material_request_fulfillment_batches_request_status
  on public.material_request_fulfillment_batches(material_request_id, status, batch_date desc, id desc);

create index if not exists idx_material_request_fulfillment_lines_batch_request
  on public.material_request_fulfillment_lines(batch_id, material_request_id);

create index if not exists idx_material_request_events_request_created_phase2
  on public.material_request_events(request_id, created_at desc, id desc);

create index if not exists idx_inventory_ledger_type_date
  on public.inventory_ledger_entries(transaction_type, transaction_date desc, id desc);

create index if not exists idx_inventory_ledger_warehouse_material_project_date
  on public.inventory_ledger_entries(warehouse_id, material_id, project_id, construction_site_id, transaction_date desc, id desc);

create or replace function public.get_material_request_workflow_board(
  p_project_id text,
  p_construction_site_id text default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 150,
  p_cursor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_limit int := greatest(1, least(coalesce(p_limit, 150), 300));
  v_search text := lower(trim(coalesce(p_filters ->> 'search', '')));
  v_filter text := coalesce(nullif(p_filters ->> 'filter', ''), 'all');
  v_cursor_date text := nullif(split_part(coalesce(p_cursor, ''), '|', 1), '');
  v_cursor_id text := nullif(split_part(coalesce(p_cursor, ''), '|', 2), '');
  v_cards jsonb := '[]'::jsonb;
  v_next_cursor text := null;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_project_id is null or length(trim(p_project_id)) = 0 then
    raise exception 'project id is required';
  end if;

  with scoped as (
    select r.*
    from public.requests r
    left join public.workflow_subjects ws
      on ws.subject_type = 'material_request'
     and ws.subject_id = r.id
    left join public.users requester on requester.id = r.requester_id
    where coalesce(r.request_origin, 'wms') = 'project'
      and r.project_id = p_project_id
      and (p_construction_site_id is null or r.construction_site_id = p_construction_site_id)
      and (
        app_private.material_request_can_select(
          r.request_origin,
          r.project_id,
          r.requester_id,
          r.submitted_to_user_id,
          r.source_warehouse_id,
          r.site_warehouse_id
        )
        or (ws.id is not null and app_private.project_workflow_actor_can_select(ws.id))
      )
      and (
        v_cursor_date is null
        or r.created_date::text < v_cursor_date
        or (r.created_date::text = v_cursor_date and r.id < coalesce(v_cursor_id, ''))
      )
      and (
        v_search = ''
        or lower(
          coalesce(r.code, '') || ' ' ||
          coalesce(r.id, '') || ' ' ||
          coalesce(r.submitted_to_name, '') || ' ' ||
          coalesce(requester.name, '') || ' ' ||
          coalesce((
            select string_agg(coalesce(u.name, u.id::text), ' ')
            from public.workflow_step_assignments wsa
            join public.users u on u.id = wsa.assignee_user_id
            where wsa.workflow_subject_id = ws.id
              and wsa.status = 'PENDING'
          ), '')
        ) like '%' || v_search || '%'
      )
      and (
        v_filter = 'all'
        or (
          v_filter = 'mine'
          and (
            r.requester_id = v_actor
            or r.submitted_to_user_id = v_actor::text
            or exists (
              select 1
              from public.workflow_step_assignments wsa
              where wsa.workflow_subject_id = ws.id
                and wsa.assignee_user_id = v_actor
                and wsa.status = 'PENDING'
            )
          )
        )
        or (
          v_filter = 'overdue'
          and (
            r.workflow_step_due_at < now()
            or exists (
              select 1
              from public.workflow_step_assignments wsa
              where wsa.workflow_subject_id = ws.id
                and wsa.status = 'PENDING'
                and wsa.due_at < now()
            )
          )
        )
        or (
          v_filter = 'returned'
          and (ws.status = 'RETURNED' or r.workflow_step = 'returned_to_creator')
        )
        or (
          v_filter = 'watching'
          and exists (
            select 1
            from public.workflow_participants wp
            where wp.workflow_subject_id = ws.id
              and wp.user_id = v_actor
              and wp.role = 'WATCHER'
              and coalesce(wp.is_active, true)
          )
        )
      )
    order by r.created_date desc, r.id desc
    limit v_limit + 1
  ),
  page_rows as (
    select *
    from scoped
    order by created_date desc, id desc
    limit v_limit
  ),
  cards as (
    select jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'status', r.status,
      'workflowStep', r.workflow_step,
      'workflowStepDueAt', r.workflow_step_due_at,
      'workflowStepStartedAt', r.workflow_step_started_at,
      'workflowStepSlaHours', r.workflow_step_sla_hours,
      'projectId', r.project_id,
      'constructionSiteId', r.construction_site_id,
      'requesterId', r.requester_id,
      'requesterName', requester.name,
      'submittedToUserId', r.submitted_to_user_id,
      'submittedToName', r.submitted_to_name,
      'createdDate', r.created_date,
      'expectedDate', r.expected_date,
      'itemCount', coalesce(jsonb_array_length(coalesce(r.items::jsonb, '[]'::jsonb)), 0),
      'itemPreview', coalesce((
        select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(coalesce(r.items::jsonb, '[]'::jsonb)) with ordinality as item(value, ordinality)
        where item.ordinality <= 5
      ), '[]'::jsonb),
      'subject', case when ws.id is null then null else jsonb_build_object(
        'id', ws.id,
        'workflowInstanceId', ws.workflow_instance_id,
        'workflowTemplateId', ws.workflow_template_id,
        'templateVersionId', ws.template_version_id,
        'subjectType', ws.subject_type,
        'subjectId', ws.subject_id,
        'projectId', ws.project_id,
        'constructionSiteId', ws.construction_site_id,
        'status', ws.status,
        'currentNodeId', ws.current_node_id,
        'currentInstanceNodeId', ws.current_instance_node_id,
        'currentAssigneeUserId', ws.current_assignee_user_id,
        'currentAssigneeUserIds', coalesce(ws.current_assignee_user_ids, '{}'::uuid[]),
        'currentNodeLabel', coalesce(win.label, wn.label),
        'currentNodeType', coalesce(win.type::text, wn.type::text),
        'createdBy', ws.created_by,
        'updatedAt', ws.updated_at
      ) end,
      'currentRuntimeNode', case when win.id is null then null else jsonb_build_object(
        'id', win.id,
        'workflowInstanceId', win.workflow_instance_id,
        'templateVersionId', win.template_version_id,
        'templateNodeId', win.template_node_id,
        'label', win.label,
        'type', win.type::text,
        'config', coalesce(win.config, '{}'::jsonb),
        'positionX', win.position_x,
        'positionY', win.position_y,
        'createdAt', win.created_at
      ) end,
      'currentAssignees', coalesce(assignee_pool.assignees, '[]'::jsonb),
      'slaState', case
        when coalesce(min_pending.due_at, r.workflow_step_due_at) is null then 'none'
        when coalesce(min_pending.due_at, r.workflow_step_due_at) < now() then 'overdue'
        when min_pending.assigned_at is not null
          and now() >= min_pending.assigned_at + ((min_pending.due_at - min_pending.assigned_at) * 0.75) then 'urgent'
        when r.workflow_step_started_at is not null and r.workflow_step_due_at is not null
          and now() >= r.workflow_step_started_at + ((r.workflow_step_due_at - r.workflow_step_started_at) * 0.75) then 'urgent'
        else 'normal'
      end,
      'fulfillmentSummary', jsonb_build_object(
        'batchCount', coalesce(ff.batch_count, 0),
        'activeBatchCount', coalesce(ff.active_batch_count, 0),
        'committedQty', coalesce(ff.committed_qty, 0),
        'issuedQty', coalesce(ff.issued_qty, 0),
        'receivedQty', coalesce(ff.received_qty, 0),
        'remainingToReceive', greatest(coalesce(ff.committed_qty, 0) - coalesce(ff.received_qty, 0), 0)
      ),
      'eventPreview', coalesce(events.preview, '[]'::jsonb),
      'downstream', jsonb_build_object(
        'activeCount', coalesce(deps.active_count, 0),
        'totalCount', coalesce(deps.total_count, 0)
      )
    ) as card
    from page_rows r
    left join public.users requester on requester.id = r.requester_id
    left join public.workflow_subjects ws
      on ws.subject_type = 'material_request'
     and ws.subject_id = r.id
    left join public.workflow_instance_nodes win on win.id = ws.current_instance_node_id
    left join public.workflow_nodes wn on wn.id = ws.current_node_id
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', au.id, 'name', au.name) order by au.name) as assignees
      from unnest(
        app_private.project_workflow_distinct_uuid_array(
          coalesce(ws.current_assignee_user_ids, '{}'::uuid[])
          || case when ws.current_assignee_user_id is null then '{}'::uuid[] else array[ws.current_assignee_user_id] end
        )
      ) assignee_id
      left join public.users au on au.id = assignee_id
    ) assignee_pool on true
    left join lateral (
      select min(wsa.assigned_at) as assigned_at, min(wsa.due_at) as due_at
      from public.workflow_step_assignments wsa
      where wsa.workflow_subject_id = ws.id
        and wsa.status = 'PENDING'
    ) min_pending on true
    left join lateral (
      select
        count(distinct b.id) as batch_count,
        count(distinct b.id) filter (where b.status not in ('draft', 'cancelled')) as active_batch_count,
        sum(l.committed_qty_snapshot) as committed_qty,
        sum(l.issued_qty) as issued_qty,
        sum(l.received_qty) as received_qty
      from public.material_request_fulfillment_batches b
      left join public.material_request_fulfillment_lines l on l.batch_id = b.id
      where b.material_request_id = r.id
    ) ff on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'action', e.action,
        'actorUserId', e.actor_user_id,
        'targetUserId', e.target_user_id,
        'note', e.note,
        'createdAt', e.created_at
      ) order by e.created_at desc) as preview
      from (
        select *
        from public.material_request_events mre
        where mre.request_id = r.id
        order by mre.created_at desc, mre.id desc
        limit 3
      ) e
    ) events on true
    left join lateral (
      select
        count(*) as total_count,
        count(*) filter (where pdl.status = 'active') as active_count
      from public.project_document_links pdl
      where pdl.source_type = 'material_request'
        and pdl.source_id = r.id
        and pdl.relation_type = 'downstream'
    ) deps on true
  )
  select coalesce(jsonb_agg(card order by (card ->> 'createdDate') desc nulls last, card ->> 'id' desc), '[]'::jsonb)
  into v_cards
  from cards;

  if jsonb_array_length(v_cards) >= v_limit then
    select (card ->> 'createdDate') || '|' || (card ->> 'id')
    into v_next_cursor
    from jsonb_array_elements(v_cards) with ordinality as item(card, ordinality)
    order by item.ordinality desc
    limit 1;
  end if;

  return jsonb_build_object(
    'projectId', p_project_id,
    'constructionSiteId', p_construction_site_id,
    'filter', v_filter,
    'search', v_search,
    'limit', v_limit,
    'cursor', p_cursor,
    'nextCursor', v_next_cursor,
    'cards', v_cards
  );
end;
$$;

grant execute on function public.get_material_request_workflow_board(text, text, jsonb, int, text) to authenticated;

create or replace function public.get_project_material_request_board(
  p_project_id text,
  p_construction_site_id text default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 150,
  p_cursor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.get_material_request_workflow_board(
    p_project_id,
    p_construction_site_id,
    p_filters,
    p_limit,
    p_cursor
  );
end;
$$;

grant execute on function public.get_project_material_request_board(text, text, jsonb, int, text) to authenticated;

create or replace function public.get_project_material_request_detail(
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.requests%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_subject_json jsonb := null;
  v_runtime_context jsonb := null;
  v_assignments jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_request
  from public.requests r
  where r.id = p_request_id;

  if not found then
    raise exception 'material request not found';
  end if;

  select * into v_subject
  from public.workflow_subjects ws
  where ws.subject_type = 'material_request'
    and ws.subject_id = v_request.id;

  if not (
    app_private.material_request_can_select(
      v_request.request_origin,
      v_request.project_id,
      v_request.requester_id,
      v_request.submitted_to_user_id,
      v_request.source_warehouse_id,
      v_request.site_warehouse_id
    )
    or (v_subject.id is not null and app_private.project_workflow_actor_can_select(v_subject.id))
  ) then
    raise exception 'user cannot view material request';
  end if;

  if v_subject.id is not null then
    select jsonb_strip_nulls(
      to_jsonb(v_subject)
      || jsonb_build_object(
        'current_node', to_jsonb(wn),
        'current_instance_node', to_jsonb(win),
        'workflow_instance', to_jsonb(wi),
        'participants', coalesce(participants.rows, '[]'::jsonb)
      )
    )
    into v_subject_json
    from public.workflow_subjects ws
    left join public.workflow_nodes wn on wn.id = ws.current_node_id
    left join public.workflow_instance_nodes win on win.id = ws.current_instance_node_id
    left join public.workflow_instances wi on wi.id = ws.workflow_instance_id
    left join lateral (
      select jsonb_agg(to_jsonb(wp) order by wp.created_at, wp.id) as rows
      from public.workflow_participants wp
      where wp.workflow_subject_id = ws.id
    ) participants on true
    where ws.id = v_subject.id;

    select coalesce(jsonb_agg(to_jsonb(wsa) order by wsa.assigned_at, wsa.id), '[]'::jsonb)
    into v_assignments
    from public.workflow_step_assignments wsa
    where wsa.workflow_subject_id = v_subject.id;

    select jsonb_build_object(
      'subjectId', v_subject.id,
      'workflowInstanceId', v_subject.workflow_instance_id,
      'nodes', coalesce(nodes.rows, '[]'::jsonb),
      'edges', coalesce(edges.rows, '[]'::jsonb)
    )
    into v_runtime_context
    from lateral (
      select jsonb_agg(to_jsonb(win) order by win.position_y, win.position_x, win.id) as rows
      from public.workflow_instance_nodes win
      where win.workflow_instance_id = v_subject.workflow_instance_id
    ) nodes
    cross join lateral (
      select jsonb_agg(to_jsonb(wie) order by wie.sort_order, wie.id) as rows
      from public.workflow_instance_edges wie
      where wie.workflow_instance_id = v_subject.workflow_instance_id
    ) edges;
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(b) || jsonb_build_object('lines', coalesce(lines.rows, '[]'::jsonb))
    order by b.batch_date desc, b.id desc
  ), '[]'::jsonb)
  into v_batches
  from public.material_request_fulfillment_batches b
  left join lateral (
    select jsonb_agg(to_jsonb(l) order by l.created_at, l.id) as rows
    from public.material_request_fulfillment_lines l
    where l.batch_id = b.id
  ) lines on true
  where b.material_request_id = v_request.id;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc, e.id desc), '[]'::jsonb)
  into v_events
  from (
    select *
    from public.material_request_events mre
    where mre.request_id = v_request.id
    order by mre.created_at desc, mre.id desc
    limit 50
  ) e;

  return jsonb_build_object(
    'request', to_jsonb(v_request),
    'workflowSubject', v_subject_json,
    'runtimeContext', v_runtime_context,
    'assignments', v_assignments,
    'fulfillmentBatches', v_batches,
    'events', v_events
  );
end;
$$;

grant execute on function public.get_project_material_request_detail(text) to authenticated;

create or replace function public.get_inventory_ledger_report(
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 500,
  p_cursor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_limit int := greatest(1, least(coalesce(p_limit, 500), 1000));
  v_warehouse_id text := nullif(coalesce(p_filters ->> 'warehouseId', p_filters ->> 'warehouse_id'), '');
  v_material_id text := nullif(coalesce(p_filters ->> 'materialId', p_filters ->> 'material_id'), '');
  v_project_id text := nullif(coalesce(p_filters ->> 'projectId', p_filters ->> 'project_id'), '');
  v_construction_site_id text := nullif(coalesce(p_filters ->> 'constructionSiteId', p_filters ->> 'construction_site_id'), '');
  v_transaction_type text := nullif(coalesce(p_filters ->> 'transactionType', p_filters ->> 'transaction_type'), '');
  v_date_from timestamptz := nullif(coalesce(p_filters ->> 'dateFrom', p_filters ->> 'date_from'), '')::timestamptz;
  v_date_to timestamptz := nullif(coalesce(p_filters ->> 'dateTo', p_filters ->> 'date_to'), '')::timestamptz;
  v_search text := lower(trim(coalesce(p_filters ->> 'search', '')));
  v_cursor_date text := nullif(split_part(coalesce(p_cursor, ''), '|', 1), '');
  v_cursor_id text := nullif(split_part(coalesce(p_cursor, ''), '|', 2), '');
  v_summary jsonb := '{}'::jsonb;
  v_stock_rows jsonb := '[]'::jsonb;
  v_warehouse_rows jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_next_cursor text := null;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if v_warehouse_id = 'ALL' then v_warehouse_id := null; end if;
  if v_material_id = 'ALL' then v_material_id := null; end if;
  if v_transaction_type = 'all' then v_transaction_type := null; end if;
  if v_date_to is not null then
    v_date_to := date_trunc('day', v_date_to) + interval '1 day' - interval '1 millisecond';
  end if;

  with readable as (
    select e.*, i.sku, i.name as item_name, i.unit as item_unit, i.price_in, w.name as warehouse_name
    from public.inventory_ledger_entries e
    left join public.items i on i.id = e.material_id
    left join public.warehouses w on w.id = e.warehouse_id
    where app_private.can_read_inventory_scope(e.warehouse_id, e.created_by, e.approved_by)
      and (v_warehouse_id is null or e.warehouse_id = v_warehouse_id)
      and (v_material_id is null or e.material_id = v_material_id)
      and (v_project_id is null or e.project_id = v_project_id)
      and (v_construction_site_id is null or e.construction_site_id = v_construction_site_id)
      and (v_date_to is null or e.transaction_date <= v_date_to)
      and (
        v_search = ''
        or lower(
          coalesce(i.sku, '') || ' ' ||
          coalesce(i.name, '') || ' ' ||
          coalesce(e.document_code, '') || ' ' ||
          coalesce(e.source_code, '') || ' ' ||
          coalesce(e.description, '')
        ) like '%' || v_search || '%'
      )
  ),
  material_group as (
    select
      material_id,
      max(sku) as sku,
      max(item_name) as item_name,
      max(item_unit) as unit,
      max(price_in) as price_in,
      sum(case when v_date_from is not null and transaction_date < v_date_from then quantity_delta else 0 end) as opening,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and movement_direction = 'in' and transaction_type not in ('transfer_receipt', 'adjustment_in')
        then quantity_in else 0 end) as in_import,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and transaction_type = 'transfer_receipt'
        then quantity_in else 0 end) as in_transfer,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and transaction_type = 'adjustment_in'
        then quantity_in else 0 end) as in_adjustment,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and movement_direction = 'out' and transaction_type not in ('transfer_issue', 'loss_issue', 'adjustment_out')
        then quantity_out else 0 end) as out_export,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and transaction_type = 'transfer_issue'
        then quantity_out else 0 end) as out_transfer,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and transaction_type in ('loss_issue', 'adjustment_out')
        then quantity_out else 0 end) as out_liquidation
    from readable
    group by material_id
  ),
  stock as (
    select
      material_id as id,
      coalesce(max(sku), material_id) as sku,
      coalesce(max(item_name), material_id) as name,
      max(unit) as unit,
      coalesce(opening, 0) as opening,
      coalesce(in_import, 0) as in_import,
      coalesce(in_transfer, 0) as in_transfer,
      coalesce(in_adjustment, 0) as in_adjustment,
      coalesce(out_export, 0) as out_export,
      coalesce(out_transfer, 0) as out_transfer,
      coalesce(out_liquidation, 0) as out_liquidation,
      coalesce(in_import, 0) + coalesce(in_transfer, 0) + coalesce(in_adjustment, 0) as total_in,
      coalesce(out_export, 0) + coalesce(out_transfer, 0) + coalesce(out_liquidation, 0) as total_out,
      coalesce(opening, 0)
        + coalesce(in_import, 0) + coalesce(in_transfer, 0) + coalesce(in_adjustment, 0)
        - coalesce(out_export, 0) - coalesce(out_transfer, 0) - coalesce(out_liquidation, 0) as closing,
      (
        coalesce(opening, 0)
        + coalesce(in_import, 0) + coalesce(in_transfer, 0) + coalesce(in_adjustment, 0)
        - coalesce(out_export, 0) - coalesce(out_transfer, 0) - coalesce(out_liquidation, 0)
      ) * coalesce(max(price_in), 0) as value
    from material_group
    group by material_id, opening, in_import, in_transfer, in_adjustment, out_export, out_transfer, out_liquidation
  ),
  period_entries as (
    select *
    from readable
    where (v_date_from is null or transaction_date >= v_date_from)
      and (v_transaction_type is null or transaction_type = v_transaction_type)
  ),
  warehouse_group as (
    select
      warehouse_id,
      material_id,
      max(warehouse_name) as warehouse_name,
      max(sku) as sku,
      max(item_name) as material_name,
      max(item_unit) as unit,
      sum(quantity_in) as in_qty,
      sum(quantity_out) as out_qty,
      (array_agg(balance_after_qty order by transaction_date desc, id desc))[1] as balance_qty,
      max(transaction_date) as last_date
    from period_entries
    group by warehouse_id, material_id
  ),
  entry_page as (
    select *
    from period_entries
    where (
      v_cursor_date is null
      or transaction_date::text < v_cursor_date
      or (transaction_date::text = v_cursor_date and id::text < coalesce(v_cursor_id, ''))
    )
    order by transaction_date desc, id desc
    limit v_limit + 1
  ),
  entry_limited as (
    select *
    from entry_page
    order by transaction_date desc, id desc
    limit v_limit
  )
  select
    jsonb_build_object(
      'opening', coalesce(sum(opening), 0),
      'totalIn', coalesce(sum(total_in), 0),
      'totalOut', coalesce(sum(total_out), 0),
      'closing', coalesce(sum(closing), 0),
      'totalValue', coalesce(sum(value), 0)
    ),
    coalesce(jsonb_agg(to_jsonb(stock) order by stock.name), '[]'::jsonb)
  into v_summary, v_stock_rows
  from stock;

  with readable as (
    select e.*, i.sku, i.name as item_name, i.unit as item_unit, w.name as warehouse_name
    from public.inventory_ledger_entries e
    left join public.items i on i.id = e.material_id
    left join public.warehouses w on w.id = e.warehouse_id
    where app_private.can_read_inventory_scope(e.warehouse_id, e.created_by, e.approved_by)
      and (v_warehouse_id is null or e.warehouse_id = v_warehouse_id)
      and (v_material_id is null or e.material_id = v_material_id)
      and (v_project_id is null or e.project_id = v_project_id)
      and (v_construction_site_id is null or e.construction_site_id = v_construction_site_id)
      and (v_date_to is null or e.transaction_date <= v_date_to)
      and (v_date_from is null or e.transaction_date >= v_date_from)
      and (v_transaction_type is null or e.transaction_type = v_transaction_type)
      and (
        v_search = ''
        or lower(
          coalesce(i.sku, '') || ' ' ||
          coalesce(i.name, '') || ' ' ||
          coalesce(e.document_code, '') || ' ' ||
          coalesce(e.source_code, '') || ' ' ||
          coalesce(e.description, '')
        ) like '%' || v_search || '%'
      )
  ),
  warehouse_group as (
    select
      warehouse_id,
      material_id,
      max(warehouse_name) as warehouse_name,
      max(sku) as sku,
      max(item_name) as material_name,
      max(item_unit) as unit,
      sum(quantity_in) as in_qty,
      sum(quantity_out) as out_qty,
      (array_agg(balance_after_qty order by transaction_date desc, id desc))[1] as balance_qty,
      max(transaction_date) as last_date
    from readable
    group by warehouse_id, material_id
  )
  select coalesce(jsonb_agg(to_jsonb(warehouse_group) order by warehouse_name, material_name), '[]'::jsonb)
  into v_warehouse_rows
  from warehouse_group;

  with readable as (
    select e.*, i.sku, i.name as item_name, i.unit as item_unit, w.name as warehouse_name
    from public.inventory_ledger_entries e
    left join public.items i on i.id = e.material_id
    left join public.warehouses w on w.id = e.warehouse_id
    where app_private.can_read_inventory_scope(e.warehouse_id, e.created_by, e.approved_by)
      and (v_warehouse_id is null or e.warehouse_id = v_warehouse_id)
      and (v_material_id is null or e.material_id = v_material_id)
      and (v_project_id is null or e.project_id = v_project_id)
      and (v_construction_site_id is null or e.construction_site_id = v_construction_site_id)
      and (v_date_to is null or e.transaction_date <= v_date_to)
      and (v_date_from is null or e.transaction_date >= v_date_from)
      and (v_transaction_type is null or e.transaction_type = v_transaction_type)
      and (
        v_search = ''
        or lower(
          coalesce(i.sku, '') || ' ' ||
          coalesce(i.name, '') || ' ' ||
          coalesce(e.document_code, '') || ' ' ||
          coalesce(e.source_code, '') || ' ' ||
          coalesce(e.description, '')
        ) like '%' || v_search || '%'
      )
  ),
  entry_page as (
    select *
    from readable
    where (
      v_cursor_date is null
      or transaction_date::text < v_cursor_date
      or (transaction_date::text = v_cursor_date and id::text < coalesce(v_cursor_id, ''))
    )
    order by transaction_date desc, id desc
    limit v_limit + 1
  ),
  entry_limited as (
    select *
    from entry_page
    order by transaction_date desc, id desc
    limit v_limit
  )
  select
    coalesce(jsonb_agg(to_jsonb(entry_limited) order by transaction_date desc, id desc), '[]'::jsonb),
    case when (select count(*) from entry_page) > v_limit then (
      select e.transaction_date::text || '|' || e.id::text
      from entry_limited e
      order by e.transaction_date desc, e.id desc
      offset v_limit - 1
      limit 1
    ) else null end
  into v_entries, v_next_cursor
  from entry_limited;

  return jsonb_build_object(
    'filters', p_filters,
    'limit', v_limit,
    'cursor', p_cursor,
    'nextCursor', v_next_cursor,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'stockRows', coalesce(v_stock_rows, '[]'::jsonb),
    'warehouseRows', coalesce(v_warehouse_rows, '[]'::jsonb),
    'entriesPage', coalesce(v_entries, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_inventory_ledger_report(jsonb, int, text) to authenticated;

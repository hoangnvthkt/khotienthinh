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
        'workflowTemplateId', coalesce(wi.template_id, r.workflow_template_id),
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
    left join public.workflow_instances wi on wi.id = ws.workflow_instance_id
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

revoke execute on function public.get_material_request_workflow_board(text, text, jsonb, integer, text) from public, anon;
revoke execute on function public.get_project_material_request_board(text, text, jsonb, integer, text) from public, anon;
grant execute on function public.get_material_request_workflow_board(text, text, jsonb, integer, text) to authenticated, service_role;
grant execute on function public.get_project_material_request_board(text, text, jsonb, integer, text) to authenticated, service_role;

-- Phase performance/UX foundation for project material request workflow.
-- This migration is additive: read-only RPCs, index verification, and a
-- compatibility wrapper for future SLA escalation scheduling.

create index if not exists idx_workflow_subjects_subject_type_subject_id
  on public.workflow_subjects(subject_type, subject_id);

create index if not exists idx_workflow_subjects_project_site_status
  on public.workflow_subjects(project_id, construction_site_id, status);

create index if not exists idx_workflow_step_assignments_subject_status_assigned
  on public.workflow_step_assignments(workflow_subject_id, status, assigned_at desc);

create index if not exists idx_workflow_step_assignments_assignee_status_due
  on public.workflow_step_assignments(assignee_user_id, status, due_at)
  where assignee_user_id is not null;

create index if not exists idx_project_document_links_source_status
  on public.project_document_links(source_type, source_id, status);

create index if not exists idx_requests_project_origin_site_created
  on public.requests(project_id, request_origin, construction_site_id, created_date desc)
  where request_origin = 'project';

create or replace function public.get_project_workflow_timeline(
  p_workflow_subject_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject public.workflow_subjects%rowtype;
  v_assignments jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
begin
  if public.current_app_user_id() is null then
    raise exception 'authentication required';
  end if;

  select * into v_subject
  from public.workflow_subjects ws
  where ws.id = p_workflow_subject_id;

  if not found then
    raise exception 'workflow subject not found';
  end if;

  if not app_private.project_workflow_actor_can_select(v_subject.id) then
    raise exception 'user cannot view workflow timeline';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'kind', 'assignment',
      'id', wsa.id,
      'workflowSubjectId', wsa.workflow_subject_id,
      'workflowInstanceId', wsa.workflow_instance_id,
      'nodeId', wsa.node_id,
      'instanceNodeId', wsa.instance_node_id,
      'assignmentRoundId', wsa.assignment_round_id,
      'nodeLabel', coalesce(win.label, wn.label),
      'nodeType', coalesce(win.type::text, wn.type::text),
      'assigneeUserId', wsa.assignee_user_id,
      'assigneeName', au.name,
      'assignedBy', wsa.assigned_by,
      'assignedByName', bu.name,
      'status', wsa.status,
      'assignedAt', wsa.assigned_at,
      'actedAt', wsa.acted_at,
      'actionComment', wsa.action_comment,
      'dueAt', wsa.due_at,
      'slaHours', wsa.sla_hours,
      'assignmentSource', wsa.assignment_source,
      'assignmentGroupType', wsa.assignment_group_type,
      'assignmentGroupId', wsa.assignment_group_id,
      'metadata', coalesce(wsa.metadata, '{}'::jsonb)
    )
    order by wsa.assigned_at, wsa.id
  ), '[]'::jsonb)
  into v_assignments
  from public.workflow_step_assignments wsa
  left join public.workflow_instance_nodes win on win.id = wsa.instance_node_id
  left join public.workflow_nodes wn on wn.id = wsa.node_id
  left join public.users au on au.id = wsa.assignee_user_id
  left join public.users bu on bu.id = wsa.assigned_by
  where wsa.workflow_subject_id = v_subject.id;

  if v_subject.subject_type = 'material_request' then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'kind', 'event',
        'id', mre.id,
        'requestId', mre.request_id,
        'action', mre.action,
        'fromStep', mre.from_step,
        'toStep', mre.to_step,
        'actorUserId', mre.actor_user_id,
        'actorName', actor.name,
        'targetUserId', mre.target_user_id,
        'targetName', target_user.name,
        'note', mre.note,
        'dueAt', mre.due_at,
        'slaHours', mre.sla_hours,
        'metadata', coalesce(mre.metadata, '{}'::jsonb),
        'createdAt', mre.created_at
      )
      order by mre.created_at, mre.id
    ), '[]'::jsonb)
    into v_events
    from public.material_request_events mre
    left join public.users actor on actor.id::text = mre.actor_user_id
    left join public.users target_user on target_user.id::text = mre.target_user_id
    where mre.request_id = v_subject.subject_id;
  end if;

  return jsonb_build_object(
    'workflowSubjectId', v_subject.id,
    'subjectType', v_subject.subject_type,
    'subjectId', v_subject.subject_id,
    'assignments', v_assignments,
    'events', v_events,
    'entries', (
      select coalesce(jsonb_agg(entry order by coalesce(entry ->> 'actedAt', entry ->> 'createdAt', entry ->> 'assignedAt')), '[]'::jsonb)
      from jsonb_array_elements(v_assignments || v_events) as t(entry)
    )
  );
end;
$$;

grant execute on function public.get_project_workflow_timeline(uuid) to authenticated;

create or replace function public.get_project_workflow_action_context(
  p_subject_type text,
  p_subject_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_current_node jsonb := null;
  v_next_node jsonb := null;
  v_return_node jsonb := null;
  v_pending_assignee_ids uuid[] := '{}'::uuid[];
  v_is_pending_assignee boolean := false;
  v_is_workflow_admin boolean := false;
  v_is_watcher boolean := false;
  v_is_creator boolean := false;
  v_can_reassign boolean := false;
  v_can_rollback boolean := false;
  v_node_config jsonb := '{}'::jsonb;
  v_rollback jsonb := null;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_subject
  from public.workflow_subjects ws
  where ws.subject_type = p_subject_type
    and ws.subject_id = p_subject_id;

  if not found then
    raise exception 'workflow subject not found';
  end if;

  if not app_private.project_workflow_actor_can_select(v_subject.id) then
    raise exception 'user cannot view workflow action context';
  end if;

  select coalesce(array_agg(wsa.assignee_user_id order by wsa.assigned_at, wsa.assignee_user_id), '{}'::uuid[])
  into v_pending_assignee_ids
  from public.workflow_step_assignments wsa
  where wsa.workflow_subject_id = v_subject.id
    and wsa.workflow_instance_id = v_subject.workflow_instance_id
    and wsa.status = 'PENDING'
    and wsa.assignee_user_id is not null
    and (
      (v_subject.current_instance_node_id is not null and wsa.instance_node_id = v_subject.current_instance_node_id)
      or (v_subject.current_instance_node_id is null and wsa.node_id = v_subject.current_node_id)
    );

  v_is_pending_assignee := v_actor = any(coalesce(v_pending_assignee_ids, '{}'::uuid[]));

  select coalesce(exists (
    select 1
    from public.workflow_participants wp
    where wp.workflow_subject_id = v_subject.id
      and wp.user_id = v_actor
      and wp.role = 'ADMIN'
      and coalesce(wp.is_active, true)
  ), false)
  into v_is_workflow_admin;

  select coalesce(exists (
    select 1
    from public.workflow_participants wp
    where wp.workflow_subject_id = v_subject.id
      and wp.user_id = v_actor
      and wp.role = 'WATCHER'
      and coalesce(wp.is_active, true)
  ), false)
  into v_is_watcher;

  v_is_creator := v_subject.created_by = v_actor;

  select jsonb_build_object(
    'id', win.id,
    'templateNodeId', win.template_node_id,
    'label', win.label,
    'type', win.type::text,
    'config', coalesce(win.config, '{}'::jsonb)
  ),
  coalesce(win.config, '{}'::jsonb)
  into v_current_node, v_node_config
  from public.workflow_instance_nodes win
  where win.id = v_subject.current_instance_node_id;

  if v_current_node is null and v_subject.current_node_id is not null then
    select jsonb_build_object(
      'id', wn.id,
      'label', wn.label,
      'type', wn.type::text,
      'config', coalesce(wn.config, '{}'::jsonb)
    ),
    coalesce(wn.config, '{}'::jsonb)
    into v_current_node, v_node_config
    from public.workflow_nodes wn
    where wn.id = v_subject.current_node_id;
  end if;

  select jsonb_build_object(
    'id', target.id,
    'templateNodeId', target.template_node_id,
    'label', target.label,
    'type', target.type::text,
    'config', coalesce(target.config, '{}'::jsonb)
  )
  into v_next_node
  from public.workflow_instance_edges edge
  join public.workflow_instance_nodes target on target.id = edge.target_instance_node_id
  where edge.workflow_instance_id = v_subject.workflow_instance_id
    and edge.source_instance_node_id = v_subject.current_instance_node_id
  order by edge.sort_order, edge.created_at
  limit 1;

  select jsonb_build_object(
    'id', rtn.id,
    'templateNodeId', rtn.template_node_id,
    'label', rtn.label,
    'type', rtn.type::text,
    'config', coalesce(rtn.config, '{}'::jsonb)
  )
  into v_return_node
  from public.workflow_instance_nodes rtn
  where rtn.id = v_subject.return_to_instance_node_id;

  v_can_reassign := v_subject.status = 'RUNNING'
    and coalesce(v_node_config ->> 'allowReassign', 'true') <> 'false'
    and (v_is_pending_assignee or v_is_workflow_admin or public.is_admin() or public.is_module_admin('WF'));

  v_can_rollback := v_subject.status = 'COMPLETED'
    and (v_is_workflow_admin or public.is_admin() or public.is_module_admin('WF'));

  if v_can_rollback and p_subject_type = 'material_request' then
    v_rollback := public.get_project_workflow_rollback_dependencies(p_subject_type, p_subject_id);
  end if;

  return jsonb_build_object(
    'subjectType', p_subject_type,
    'subjectId', p_subject_id,
    'workflowSubjectId', v_subject.id,
    'status', v_subject.status,
    'currentNode', v_current_node,
    'nextNode', v_next_node,
    'returnTargetNode', v_return_node,
    'pendingAssigneeUserIds', coalesce(v_pending_assignee_ids, '{}'::uuid[]),
    'isPendingAssignee', v_is_pending_assignee,
    'isWorkflowAdmin', v_is_workflow_admin,
    'isWatcher', v_is_watcher,
    'isCreator', v_is_creator,
    'canApprove', v_subject.status = 'RUNNING' and v_is_pending_assignee,
    'canReturn', v_subject.status = 'RUNNING' and v_is_pending_assignee,
    'canReject', v_subject.status = 'RUNNING'
      and v_is_pending_assignee
      and coalesce(v_node_config ->> 'allowReject', 'true') <> 'false',
    'canResubmit', v_subject.status = 'RETURNED' and v_is_creator,
    'canReassign', v_can_reassign,
    'canRollback', v_can_rollback,
    'rollbackDependencies', v_rollback
  );
end;
$$;

grant execute on function public.get_project_workflow_action_context(text, text) to authenticated;

create or replace function public.get_material_request_workflow_board(
  p_project_id text,
  p_construction_site_id text default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 200,
  p_cursor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_limit int := greatest(1, least(coalesce(p_limit, 200), 500));
  v_search text := lower(coalesce(p_filters ->> 'search', ''));
  v_filter text := coalesce(p_filters ->> 'filter', 'all');
  v_cards jsonb;
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
    where coalesce(r.request_origin, 'wms') = 'project'
      and r.project_id = p_project_id
      and (p_construction_site_id is null or r.construction_site_id = p_construction_site_id)
      and (
        app_private.project_doc_can_view(r.project_id, r.construction_site_id, r.submitted_to_user_id)
        or (ws.id is not null and app_private.project_workflow_actor_can_select(ws.id))
      )
      and (
        v_search = ''
        or lower(coalesce(r.code, '') || ' ' || coalesce(r.id, '') || ' ' || coalesce(r.submitted_to_name, '')) like '%' || v_search || '%'
      )
      and (
        v_filter = 'all'
        or (
          v_filter = 'mine'
          and (
            r.requester_id = v_actor
            or exists (
              select 1 from public.workflow_step_assignments wsa
              where wsa.workflow_subject_id = ws.id
                and wsa.assignee_user_id = v_actor
                and wsa.status = 'PENDING'
            )
            or r.submitted_to_user_id = v_actor::text
          )
        )
        or (
          v_filter = 'overdue'
          and (
            r.workflow_step_due_at < now()
            or exists (
              select 1 from public.workflow_step_assignments wsa
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
            select 1 from public.workflow_participants wp
            where wp.workflow_subject_id = ws.id
              and wp.user_id = v_actor
              and wp.role = 'WATCHER'
              and coalesce(wp.is_active, true)
          )
        )
      )
    order by r.created_date desc, r.id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(card order by (card ->> 'createdDate') desc nulls last, card ->> 'id' desc), '[]'::jsonb)
  into v_cards
  from (
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
      'subject', case when ws.id is null then null else jsonb_build_object(
        'id', ws.id,
        'workflowInstanceId', ws.workflow_instance_id,
        'workflowTemplateId', ws.workflow_template_id,
        'templateVersionId', ws.template_version_id,
        'status', ws.status,
        'currentNodeId', ws.current_node_id,
        'currentInstanceNodeId', ws.current_instance_node_id,
        'currentAssigneeUserId', ws.current_assignee_user_id,
        'currentAssigneeUserIds', coalesce(ws.current_assignee_user_ids, '{}'::uuid[]),
        'currentNodeLabel', coalesce(win.label, wn.label),
        'currentNodeType', coalesce(win.type::text, wn.type::text),
        'updatedAt', ws.updated_at
      ) end,
      'currentRuntimeNode', case when win.id is null then null else jsonb_build_object(
        'id', win.id,
        'templateNodeId', win.template_node_id,
        'label', win.label,
        'type', win.type::text,
        'config', coalesce(win.config, '{}'::jsonb),
        'positionX', win.position_x,
        'positionY', win.position_y
      ) end,
      'currentAssignees', coalesce(assignee_pool.assignees, '[]'::jsonb),
      'slaState', case
        when r.workflow_step_due_at is null or r.workflow_step_started_at is null or r.workflow_step_sla_hours is null then 'none'
        when r.workflow_step_due_at < now() then 'overdue'
        when now() >= r.workflow_step_started_at + ((r.workflow_step_due_at - r.workflow_step_started_at) * 0.75) then 'urgent'
        else 'normal'
      end,
      'fulfillmentSummary', jsonb_build_object(
        'batchCount', coalesce(ff.batch_count, 0),
        'activeBatchCount', coalesce(ff.active_batch_count, 0),
        'committedQty', coalesce(ff.committed_qty, 0),
        'issuedQty', coalesce(ff.issued_qty, 0),
        'receivedQty', coalesce(ff.received_qty, 0)
      ),
      'eventPreview', coalesce(events.preview, '[]'::jsonb),
      'downstream', jsonb_build_object(
        'activeCount', coalesce(deps.active_count, 0),
        'totalCount', coalesce(deps.total_count, 0)
      )
    ) as card
    from scoped r
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
        order by mre.created_at desc
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
  ) cards;

  return jsonb_build_object(
    'projectId', p_project_id,
    'constructionSiteId', p_construction_site_id,
    'filter', v_filter,
    'search', v_search,
    'limit', v_limit,
    'cursor', p_cursor,
    'cards', v_cards
  );
end;
$$;

grant execute on function public.get_material_request_workflow_board(text, text, jsonb, int, text) to authenticated;

create or replace function public.process_project_workflow_sla_escalations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regprocedure('public.process_project_workflow_sla_reminders()') is null then
    return jsonb_build_object('createdCount', 0, 'mode', 'noop');
  end if;
  return jsonb_build_object(
    'createdCount', public.process_project_workflow_sla_reminders(),
    'mode', 'reminder_only'
  );
end;
$$;

grant execute on function public.process_project_workflow_sla_escalations() to authenticated;

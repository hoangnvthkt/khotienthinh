do $repair_request_workflow_state$
declare
  v_request public.request_instances%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_workflow public.workflow_instances%rowtype;
  v_assignment public.workflow_step_assignments%rowtype;
  v_log public.workflow_instance_logs%rowtype;
  v_pending_count integer;
  v_updated_count integer;
begin
  select request_instance.*
    into v_request
  from public.request_instances request_instance
  where request_instance.code = 'RQ-2026-000010'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_TARGET_NOT_FOUND';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_UNEXPECTED_REQUEST_STATUS';
  end if;

  select subject.*
    into v_subject
  from public.workflow_subjects subject
  where subject.id = v_request.workflow_subject_id
  for update;

  if not found or v_subject.status <> 'RUNNING' then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_UNEXPECTED_SUBJECT_STATUS';
  end if;

  select workflow.*
    into v_workflow
  from public.workflow_instances workflow
  where workflow.id = v_request.workflow_instance_id
  for update;

  if not found or v_workflow.status <> 'COMPLETED' then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_UNEXPECTED_WORKFLOW_STATUS';
  end if;
  if v_subject.workflow_instance_id is distinct from v_workflow.id then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_WORKFLOW_LINK_MISMATCH';
  end if;

  perform 1
  from public.workflow_step_assignments assignment
  where assignment.workflow_subject_id = v_subject.id
  order by assignment.id
  for update;

  select count(*)
    into v_pending_count
  from public.workflow_step_assignments assignment
  where assignment.workflow_subject_id = v_subject.id
    and assignment.status = 'PENDING';

  if v_pending_count <> 1 then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_PENDING_ASSIGNMENT_COUNT_MISMATCH';
  end if;

  select assignment.*
    into v_assignment
  from public.workflow_step_assignments assignment
  where assignment.workflow_subject_id = v_subject.id
    and assignment.status = 'PENDING'
  order by assignment.id
  limit 1;

  if v_assignment.workflow_instance_id is distinct from v_workflow.id then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_ASSIGNMENT_LINK_MISMATCH';
  end if;

  select instance_log.*
    into v_log
  from public.workflow_instance_logs instance_log
  where instance_log.instance_id = v_workflow.id
    and instance_log.node_id = v_assignment.node_id
    and instance_log.action = 'APPROVED'::public.workflow_instance_action
  order by instance_log.created_at desc, instance_log.id desc
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_APPROVAL_LOG_NOT_FOUND';
  end if;
  if v_log.acted_by is distinct from v_assignment.assignee_user_id then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_APPROVER_MISMATCH';
  end if;
  if v_log.created_at < v_assignment.assigned_at then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_APPROVAL_PRECEDES_ASSIGNMENT';
  end if;

  update public.workflow_step_assignments assignment
  set status = 'APPROVED',
      acted_at = v_log.created_at,
      action_comment = v_log.comment
  where assignment.id = v_assignment.id
    and assignment.status = 'PENDING';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_ASSIGNMENT_UPDATE_FAILED';
  end if;

  update public.request_instances request_instance
  set status = 'APPROVED',
      completed_at = v_log.created_at,
      updated_at = greatest(request_instance.updated_at, v_log.created_at)
  where request_instance.id = v_request.id
    and request_instance.status = 'PENDING';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_REQUEST_UPDATE_FAILED';
  end if;

  update public.workflow_subjects subject
  set status = 'COMPLETED',
      updated_at = greatest(subject.updated_at, v_log.created_at)
  where subject.id = v_subject.id
    and subject.status = 'RUNNING';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'REQUEST_REPAIR_SUBJECT_UPDATE_FAILED';
  end if;

  raise notice 'Repaired request % from its existing approval log', v_request.code;
end;
$repair_request_workflow_state$;

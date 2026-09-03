-- Project workflow UI/runtime v2.
-- Scope: material_request only. This migration adds resubmit/reassign support
-- and remembers where a returned workflow should continue.

alter table public.workflow_subjects
  add column if not exists return_to_node_id uuid references public.workflow_nodes(id) on delete set null,
  add column if not exists return_to_assignee_user_id uuid references public.users(id) on delete set null,
  add column if not exists returned_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists returned_at timestamptz;

create index if not exists idx_workflow_subjects_return_target
  on public.workflow_subjects(return_to_node_id, return_to_assignee_user_id)
  where status = 'RETURNED';

create or replace function public.return_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_request public.requests%rowtype;
  v_return_to_node_id uuid;
  v_return_to_assignee_user_id uuid;
  v_requester_id uuid;
  v_requester_name text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select *
    into v_subject
  from public.workflow_subjects
  where subject_type = p_subject_type
    and subject_id = p_subject_id
  for update;

  if not found then
    raise exception 'workflow subject not found';
  end if;

  select *
    into v_request
  from public.requests
  where id = p_subject_id
  for update;

  if not found then
    raise exception 'material request not found: %', p_subject_id;
  end if;

  if v_subject.status <> 'RUNNING' then
    raise exception 'workflow subject is not running';
  end if;

  if not (
    public.is_admin()
    or public.is_module_admin('WF')
    or v_subject.current_assignee_user_id = v_actor
  ) then
    raise exception 'user is not current workflow assignee';
  end if;

  if nullif(coalesce(p_comment, ''), '') is null then
    raise exception 'return reason is required';
  end if;

  v_return_to_node_id := v_subject.current_node_id;
  v_return_to_assignee_user_id := v_subject.current_assignee_user_id;
  v_requester_id := v_request.requester_id::uuid;

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (
    v_subject.workflow_instance_id,
    v_subject.current_node_id,
    'REVISION_REQUESTED'::public.workflow_instance_action,
    v_actor,
    coalesce(p_comment, '')
  );

  update public.workflow_step_assignments
  set status = 'RETURNED',
      acted_at = now(),
      action_comment = p_comment,
      return_to_node_id = v_return_to_node_id,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'returnedToCreator', true,
          'returnToNodeId', v_return_to_node_id,
          'returnToAssigneeUserId', v_return_to_assignee_user_id
        )
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and node_id = v_subject.current_node_id
    and status = 'PENDING';

  insert into public.workflow_step_assignments(
    workflow_subject_id,
    workflow_instance_id,
    node_id,
    assignee_user_id,
    assigned_by,
    status,
    action_comment,
    return_to_node_id,
    metadata
  )
  values (
    v_subject.id,
    v_subject.workflow_instance_id,
    v_return_to_node_id,
    v_requester_id,
    v_actor,
    'PENDING',
    p_comment,
    v_return_to_node_id,
    jsonb_build_object(
      'returnedToCreator', true,
      'returnToNodeId', v_return_to_node_id,
      'returnToAssigneeUserId', v_return_to_assignee_user_id
    )
  );

  update public.workflow_instances
  set current_node_id = v_return_to_node_id,
      status = 'RUNNING'::public.workflow_instance_status,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || jsonb_build_object(v_return_to_node_id::text, v_requester_id::text),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  select u.name
    into v_requester_name
  from public.users u
  where u.id = v_requester_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_requester_id,
      current_node_id = v_return_to_node_id,
      status = 'RETURNED',
      return_to_node_id = v_return_to_node_id,
      return_to_assignee_user_id = v_return_to_assignee_user_id,
      returned_by_user_id = v_actor,
      returned_at = now(),
      updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'DRAFT'::public.request_status,
      submitted_to_user_id = v_requester_id::text,
      submitted_to_name = v_requester_name,
      submitted_to_permission = 'edit',
      submission_note = p_comment,
      last_action_by = v_actor,
      last_action_at = now(),
      workflow_step = 'returned_to_creator',
      workflow_step_started_at = now(),
      workflow_step_due_at = null,
      workflow_step_sla_hours = null,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id,
    project_id,
    from_step,
    to_step,
    action,
    actor_user_id,
    target_user_id,
    target_permission,
    note,
    metadata
  )
  values (
    p_subject_id,
    v_request.project_id,
    coalesce(v_request.workflow_step, 'material_department_review'),
    'returned_to_creator',
    'RETURNED',
    v_actor::text,
    v_requester_id::text,
    'edit',
    p_comment,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'returnToNodeId', v_return_to_node_id,
      'returnToAssigneeUserId', v_return_to_assignee_user_id
    )
  );

  return v_subject;
end;
$$;

create or replace function public.resubmit_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_assignee_user_id uuid default null,
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_request public.requests%rowtype;
  v_target_node_id uuid;
  v_target_assignee_user_id uuid;
  v_first_node_id uuid;
  v_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_to_step text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select *
    into v_subject
  from public.workflow_subjects
  where subject_type = p_subject_type
    and subject_id = p_subject_id
  for update;

  if not found then
    raise exception 'workflow subject not found';
  end if;

  select *
    into v_request
  from public.requests
  where id = p_subject_id
  for update;

  if not found then
    raise exception 'material request not found: %', p_subject_id;
  end if;

  if v_subject.status <> 'RETURNED' then
    raise exception 'workflow subject is not returned';
  end if;

  if not (
    public.is_admin()
    or public.is_module_admin('WF')
    or v_request.requester_id::uuid = v_actor
  ) then
    raise exception 'only requester can resubmit this material request';
  end if;

  v_first_node_id := app_private.project_workflow_first_task_node(v_request.workflow_template_id);
  v_target_node_id := coalesce(v_subject.return_to_node_id, v_subject.current_node_id, v_first_node_id);
  v_target_assignee_user_id := coalesce(p_assignee_user_id, v_subject.return_to_assignee_user_id);

  if v_target_node_id is null then
    raise exception 'return target workflow node not found';
  end if;

  if v_target_assignee_user_id is null then
    raise exception 'resubmit assignee is required';
  end if;

  if not app_private.project_workflow_assignee_is_eligible(
    p_subject_type,
    p_subject_id,
    v_target_node_id,
    v_target_assignee_user_id
  ) then
    raise exception 'resubmit assignee is not eligible for this workflow step';
  end if;

  update public.workflow_step_assignments
  set status = 'APPROVED',
      acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), ''),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('resubmittedByCreator', true)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and assignee_user_id = v_request.requester_id::uuid
    and status = 'PENDING';

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (
    v_subject.workflow_instance_id,
    v_target_node_id,
    'REOPENED'::public.workflow_instance_action,
    v_actor,
    coalesce(p_comment, '')
  );

  insert into public.workflow_step_assignments(
    workflow_subject_id,
    workflow_instance_id,
    node_id,
    assignee_user_id,
    assigned_by,
    status,
    action_comment,
    metadata
  )
  values (
    v_subject.id,
    v_subject.workflow_instance_id,
    v_target_node_id,
    v_target_assignee_user_id,
    v_actor,
    'PENDING',
    p_comment,
    jsonb_build_object('resubmitted', true)
  );

  update public.workflow_instances
  set current_node_id = v_target_node_id,
      status = 'RUNNING'::public.workflow_instance_status,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || jsonb_build_object(v_target_node_id::text, v_target_assignee_user_id::text),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  select u.name
    into v_assignee_name
  from public.users u
  where u.id = v_target_assignee_user_id;

  v_sla_hours := app_private.project_workflow_node_sla_hours(v_target_node_id);
  v_due_at := case
    when v_sla_hours is null then null
    else now() + make_interval(hours => v_sla_hours)
  end;
  v_to_step := case
    when v_target_node_id = v_first_node_id then 'site_manager_review'
    else 'material_department_review'
  end;

  update public.workflow_subjects
  set current_assignee_user_id = v_target_assignee_user_id,
      current_node_id = v_target_node_id,
      status = 'RUNNING',
      return_to_node_id = null,
      return_to_assignee_user_id = null,
      returned_by_user_id = null,
      returned_at = null,
      updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'PENDING'::public.request_status,
      submitted_to_user_id = v_target_assignee_user_id::text,
      submitted_to_name = v_assignee_name,
      submitted_to_permission = app_private.project_workflow_node_primary_permission(v_target_node_id),
      submission_note = nullif(coalesce(p_comment, ''), ''),
      ever_submitted = true,
      last_action_by = v_actor,
      last_action_at = now(),
      workflow_step = v_to_step,
      workflow_step_started_at = now(),
      workflow_step_due_at = v_due_at,
      workflow_step_sla_hours = v_sla_hours,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id,
    project_id,
    from_step,
    to_step,
    action,
    actor_user_id,
    target_user_id,
    target_permission,
    note,
    sla_hours,
    due_at,
    metadata
  )
  values (
    p_subject_id,
    v_request.project_id,
    coalesce(v_request.workflow_step, 'returned_to_creator'),
    v_to_step,
    'RESUBMITTED',
    v_actor::text,
    v_target_assignee_user_id::text,
    app_private.project_workflow_node_primary_permission(v_target_node_id),
    nullif(coalesce(p_comment, ''), ''),
    v_sla_hours,
    v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'toNodeId', v_target_node_id
    )
  );

  return v_subject;
end;
$$;

create or replace function public.reassign_project_workflow(
  p_subject_type text,
  p_subject_id text,
  p_new_assignee_user_id uuid,
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_subject public.workflow_subjects%rowtype;
  v_request public.requests%rowtype;
  v_node public.workflow_nodes%rowtype;
  v_old_assignee_user_id uuid;
  v_new_assignee_name text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  if p_new_assignee_user_id is null then
    raise exception 'new assignee is required';
  end if;

  select *
    into v_subject
  from public.workflow_subjects
  where subject_type = p_subject_type
    and subject_id = p_subject_id
  for update;

  if not found then
    raise exception 'workflow subject not found';
  end if;

  select *
    into v_request
  from public.requests
  where id = p_subject_id
  for update;

  if not found then
    raise exception 'material request not found: %', p_subject_id;
  end if;

  if v_subject.status <> 'RUNNING' then
    raise exception 'workflow subject is not running';
  end if;

  if not (
    public.is_admin()
    or public.is_module_admin('WF')
    or v_subject.current_assignee_user_id = v_actor
  ) then
    raise exception 'user is not current workflow assignee';
  end if;

  select *
    into v_node
  from public.workflow_nodes
  where id = v_subject.current_node_id;

  if not found or v_node.type = 'END'::public.workflow_node_type then
    raise exception 'current workflow node cannot be reassigned';
  end if;

  if coalesce((v_node.config ->> 'allowReassign')::boolean, true) = false then
    raise exception 'workflow step does not allow reassign';
  end if;

  if not app_private.project_workflow_assignee_is_eligible(
    p_subject_type,
    p_subject_id,
    v_subject.current_node_id,
    p_new_assignee_user_id
  ) then
    raise exception 'new assignee is not eligible for this workflow step';
  end if;

  v_old_assignee_user_id := v_subject.current_assignee_user_id;

  if v_old_assignee_user_id = p_new_assignee_user_id then
    return v_subject;
  end if;

  update public.workflow_step_assignments
  set status = 'SKIPPED',
      acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), ''),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('reassignedToUserId', p_new_assignee_user_id)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and node_id = v_subject.current_node_id
    and status = 'PENDING';

  insert into public.workflow_step_assignments(
    workflow_subject_id,
    workflow_instance_id,
    node_id,
    assignee_user_id,
    assigned_by,
    status,
    action_comment,
    metadata
  )
  values (
    v_subject.id,
    v_subject.workflow_instance_id,
    v_subject.current_node_id,
    p_new_assignee_user_id,
    v_actor,
    'PENDING',
    p_comment,
    jsonb_build_object('reassigned', true, 'fromAssigneeUserId', v_old_assignee_user_id)
  );

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (
    v_subject.workflow_instance_id,
    v_subject.current_node_id,
    'REOPENED'::public.workflow_instance_action,
    v_actor,
    coalesce(nullif(p_comment, ''), 'Reassigned workflow step')
  );

  update public.workflow_instances
  set step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || jsonb_build_object(v_subject.current_node_id::text, p_new_assignee_user_id::text),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  select u.name
    into v_new_assignee_name
  from public.users u
  where u.id = p_new_assignee_user_id;

  update public.workflow_subjects
  set current_assignee_user_id = p_new_assignee_user_id,
      updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set submitted_to_user_id = p_new_assignee_user_id::text,
      submitted_to_name = v_new_assignee_name,
      submitted_to_permission = app_private.project_workflow_node_primary_permission(v_subject.current_node_id),
      submission_note = nullif(coalesce(p_comment, ''), ''),
      last_action_by = v_actor,
      last_action_at = now(),
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id,
    project_id,
    from_step,
    to_step,
    action,
    actor_user_id,
    target_user_id,
    target_permission,
    note,
    metadata
  )
  values (
    p_subject_id,
    v_request.project_id,
    coalesce(v_request.workflow_step, 'material_department_review'),
    coalesce(v_request.workflow_step, 'material_department_review'),
    'REASSIGNED',
    v_actor::text,
    p_new_assignee_user_id::text,
    app_private.project_workflow_node_primary_permission(v_subject.current_node_id),
    nullif(coalesce(p_comment, ''), ''),
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'nodeId', v_subject.current_node_id,
      'fromAssigneeUserId', v_old_assignee_user_id
    )
  );

  return v_subject;
end;
$$;

revoke execute on function public.resubmit_project_workflow(text, text, uuid, text) from anon;
revoke execute on function public.resubmit_project_workflow(text, text, uuid, text) from public;
grant execute on function public.resubmit_project_workflow(text, text, uuid, text) to authenticated;

revoke execute on function public.reassign_project_workflow(text, text, uuid, text) from anon;
revoke execute on function public.reassign_project_workflow(text, text, uuid, text) from public;
grant execute on function public.reassign_project_workflow(text, text, uuid, text) to authenticated;

revoke execute on function public.return_project_workflow(text, text, text) from anon;
revoke execute on function public.return_project_workflow(text, text, text) from public;
grant execute on function public.return_project_workflow(text, text, text) to authenticated;

notify pgrst, 'reload schema';

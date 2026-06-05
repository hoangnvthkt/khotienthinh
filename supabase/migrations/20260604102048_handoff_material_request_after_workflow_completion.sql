create or replace function app_private.project_material_request_handoff_assignee_is_eligible(
  p_subject_id text,
  p_assignee_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.requests r
      join public.users u
        on u.id = p_assignee_user_id
       and coalesce(u.is_active, true)
      where r.id = p_subject_id
        and app_private.project_user_has_permission(
          r.project_id,
          r.construction_site_id,
          'approve',
          p_assignee_user_id
        )
    ),
    false
  );
$$;

create or replace function public.advance_project_workflow_v2(
  p_subject_type text,
  p_subject_id text,
  p_next_assignee_user_ids uuid[] default '{}'::uuid[],
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
  v_current_node public.workflow_instance_nodes%rowtype;
  v_next_node public.workflow_instance_nodes%rowtype;
  v_next_assignee_ids uuid[] := app_private.project_workflow_distinct_uuid_array(p_next_assignee_user_ids);
  v_handoff_assignee uuid;
  v_first_next_assignee uuid;
  v_next_assignee_name text;
  v_sla_hours integer;
  v_due_at timestamptz;
  v_to_step text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select * into v_subject
  from public.workflow_subjects ws
  where ws.subject_type = p_subject_type and ws.subject_id = p_subject_id
  for update;
  if not found then raise exception 'workflow subject not found'; end if;

  select * into v_request from public.requests r where r.id = p_subject_id for update;
  if not found then raise exception 'material request not found: %', p_subject_id; end if;
  if v_subject.status <> 'RUNNING' then raise exception 'workflow subject is not running'; end if;
  if not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user is not assigned to current workflow step';
  end if;

  select * into v_current_node
  from public.workflow_instance_nodes win
  where win.id = v_subject.current_instance_node_id
    and win.workflow_instance_id = v_subject.workflow_instance_id;
  if not found then raise exception 'current runtime workflow node not found'; end if;

  select target_node.* into v_next_node
  from public.workflow_instance_edges wie
  join public.workflow_instance_nodes target_node on target_node.id = wie.target_instance_node_id
  where wie.workflow_instance_id = v_subject.workflow_instance_id
    and wie.source_instance_node_id = v_subject.current_instance_node_id
  order by wie.sort_order, target_node.position_y, target_node.position_x
  limit 1;
  if not found then raise exception 'next runtime workflow node not found'; end if;

  if v_next_node.type = 'END'::public.workflow_node_type then
    if coalesce(array_length(v_next_assignee_ids, 1), 0) <> 1 then
      raise exception 'exactly one batch planning assignee is required';
    end if;
    foreach v_handoff_assignee in array v_next_assignee_ids loop
      if not app_private.project_material_request_handoff_assignee_is_eligible(
        p_subject_id,
        v_handoff_assignee
      ) then
        raise exception 'batch planning assignee must be active project staff with approve permission';
      end if;
    end loop;
  elsif not app_private.project_workflow_runtime_assignees_are_eligible(
    p_subject_type, p_subject_id, v_next_node.id, v_next_assignee_ids
  ) then
    raise exception 'next assignee pool is not eligible for this runtime workflow step';
  end if;

  update public.workflow_step_assignments
  set status = 'APPROVED', acted_at = now(),
      action_comment = nullif(coalesce(p_comment, ''), ''),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('approvedByUserId', v_actor, 'approvalPolicy', 'ANY_ONE')
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and instance_node_id = v_subject.current_instance_node_id
    and assignee_user_id = v_actor
    and status = 'PENDING';

  update public.workflow_step_assignments
  set status = 'SKIPPED', acted_at = now(),
      action_comment = 'Skipped because another assignee approved this step',
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('skippedByPolicy', 'ANY_ONE', 'approvedByUserId', v_actor)
  where workflow_subject_id = v_subject.id
    and workflow_instance_id = v_subject.workflow_instance_id
    and instance_node_id = v_subject.current_instance_node_id
    and status = 'PENDING';

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_subject.workflow_instance_id, v_current_node.template_node_id,
    'APPROVED'::public.workflow_instance_action, v_actor, coalesce(p_comment, ''));

  if v_next_node.type = 'END'::public.workflow_node_type then
    v_first_next_assignee := v_next_assignee_ids[1];
    v_next_assignee_name := app_private.project_workflow_first_assignee_name(v_next_assignee_ids);
    v_sla_hours := 48;
    v_due_at := now() + make_interval(hours => v_sla_hours);

    update public.workflow_instances
    set current_node_id = v_next_node.template_node_id,
        current_instance_node_id = v_next_node.id,
        status = 'COMPLETED'::public.workflow_instance_status,
        updated_at = now()
    where id = v_subject.workflow_instance_id;

    update public.workflow_subjects
    set current_assignee_user_id = null,
        current_assignee_user_ids = '{}'::uuid[],
        current_node_id = v_next_node.template_node_id,
        current_instance_node_id = v_next_node.id,
        last_action_instance_node_id = v_current_node.id,
        status = 'COMPLETED',
        updated_at = now()
    where id = v_subject.id
    returning * into v_subject;

    update public.requests
    set status = 'APPROVED'::public.request_status,
        submitted_to_user_id = v_first_next_assignee::text,
        submitted_to_name = v_next_assignee_name,
        submitted_to_permission = 'approve',
        submission_note = nullif(coalesce(p_comment, ''), ''),
        last_action_by = v_actor, last_action_at = now(),
        workflow_step = 'batch_planning', workflow_step_started_at = now(),
        workflow_step_due_at = v_due_at, workflow_step_sla_hours = v_sla_hours,
        workflow_step_actor_user_id = v_actor::text
    where id = p_subject_id;

    insert into public.material_request_events(
      request_id, project_id, from_step, to_step, action, actor_user_id,
      target_user_id, target_permission, note, sla_hours, due_at, metadata
    )
    values (
      p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'material_department_review'),
      'batch_planning', 'APPROVED', v_actor::text,
      v_first_next_assignee::text, 'approve', nullif(coalesce(p_comment, ''), ''),
      v_sla_hours, v_due_at,
      jsonb_build_object(
        'workflowInstanceId', v_subject.workflow_instance_id,
        'workflowSubjectId', v_subject.id,
        'fromInstanceNodeId', v_current_node.id,
        'toInstanceNodeId', v_next_node.id,
        'handoffAssigneeUserId', v_first_next_assignee
      )
    );
    return v_subject;
  end if;

  perform app_private.project_workflow_insert_assignment_pool(
    v_subject.id, v_subject.workflow_instance_id, v_next_node.template_node_id, v_next_node.id,
    v_next_assignee_ids, v_actor, p_comment,
    jsonb_build_object('approvedFromInstanceNodeId', v_current_node.id, 'approvalPolicy', 'ANY_ONE'),
    'transition'
  );

  v_first_next_assignee := v_next_assignee_ids[1];
  v_next_assignee_name := app_private.project_workflow_first_assignee_name(v_next_assignee_ids);
  v_sla_hours := app_private.project_workflow_runtime_sla_hours(v_next_node.id);
  v_due_at := app_private.project_workflow_runtime_sla_due_at(v_next_node.id);
  v_to_step := app_private.project_workflow_runtime_to_coarse_step(v_subject.workflow_instance_id, v_next_node.id);

  update public.workflow_instances
  set current_node_id = v_next_node.template_node_id,
      current_instance_node_id = v_next_node.id,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || app_private.project_workflow_step_assignees_json(v_next_node.template_node_id, v_next_assignee_ids),
      updated_at = now()
  where id = v_subject.workflow_instance_id;

  update public.workflow_subjects
  set current_assignee_user_id = v_first_next_assignee,
      current_assignee_user_ids = v_next_assignee_ids,
      current_node_id = v_next_node.template_node_id,
      current_instance_node_id = v_next_node.id,
      last_action_instance_node_id = v_current_node.id,
      status = 'RUNNING', updated_at = now()
  where id = v_subject.id
  returning * into v_subject;

  update public.requests
  set status = 'PENDING'::public.request_status,
      submitted_to_user_id = v_first_next_assignee::text,
      submitted_to_name = v_next_assignee_name,
      submitted_to_permission = app_private.project_workflow_runtime_primary_permission(v_next_node.id),
      submission_note = nullif(coalesce(p_comment, ''), ''),
      last_action_by = v_actor, last_action_at = now(),
      workflow_step = v_to_step, workflow_step_started_at = now(),
      workflow_step_due_at = v_due_at, workflow_step_sla_hours = v_sla_hours,
      workflow_step_actor_user_id = v_actor::text
  where id = p_subject_id;

  insert into public.material_request_events(
    request_id, project_id, from_step, to_step, action, actor_user_id,
    target_user_id, target_permission, note, sla_hours, due_at, metadata
  )
  values (
    p_subject_id, v_request.project_id, coalesce(v_request.workflow_step, 'material_department_review'),
    v_to_step, 'APPROVED', v_actor::text, v_first_next_assignee::text,
    app_private.project_workflow_runtime_primary_permission(v_next_node.id),
    nullif(coalesce(p_comment, ''), ''), v_sla_hours, v_due_at,
    jsonb_build_object(
      'workflowInstanceId', v_subject.workflow_instance_id,
      'workflowSubjectId', v_subject.id,
      'fromInstanceNodeId', v_current_node.id,
      'toInstanceNodeId', v_next_node.id,
      'assigneeUserIds', v_next_assignee_ids
    )
  );
  return v_subject;
end;
$$;

revoke execute on function app_private.project_material_request_handoff_assignee_is_eligible(text, uuid) from public;
revoke execute on function app_private.project_material_request_handoff_assignee_is_eligible(text, uuid) from anon;
revoke execute on function app_private.project_material_request_handoff_assignee_is_eligible(text, uuid) from authenticated;

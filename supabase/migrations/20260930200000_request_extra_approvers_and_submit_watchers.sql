-- Request module phase 3: optional extra approvers chosen on the create form
-- and watchers added at submit time.
--
-- Product rule (2026-09-30): the creator may tag "Người duyệt thêm". Tagged
-- people form a request-scoped step "__extra" that runs BEFORE the template
-- flow; the creator picks whether all of them or any one must approve. Left
-- empty, the request follows the template exactly as before.
--
-- The extra step lives only in request_instances.approval_config_snapshot
-- ->'extraBlock' (never in request_approval_blocks), so every branch below is
-- guarded by the "__extra" key or the presence of extraBlock; requests
-- without extra approvers take the unchanged paths.

create or replace function app_private.activate_request_template_start(
  p_request_id uuid,
  p_round_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_request public.request_instances%rowtype;
  v_first_sort integer;
  v_block record;
begin
  select * into v_request from public.request_instances where id = p_request_id;
  select min(sort_order) into v_first_sort
  from public.request_approval_blocks
  where request_template_version_id = v_request.request_template_version_id;
  for v_block in
    select block.block_key
    from public.request_approval_blocks block
    where block.request_template_version_id = v_request.request_template_version_id
      and ((v_request.approval_config_snapshot ->> 'flowMode') = 'PARALLEL' or block.sort_order = v_first_sort)
    order by block.sort_order, block.block_key
  loop
    perform app_private.activate_request_block(p_request_id, v_block.block_key, p_round_id, p_actor_id);
  end loop;
end;
$function$;

-- 2. Activate the request-scoped extra step. It reuses the template's first
-- approval node so workflow bookkeeping stays consistent.
create or replace function app_private.activate_request_extra_block(
  p_request_id uuid,
  p_round_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_request public.request_instances%rowtype;
  v_workflow_version public.workflow_template_versions%rowtype;
  v_node_id uuid;
  v_instance_node_id uuid;
  v_user_id uuid;
  v_user_ids uuid[] := '{}'::uuid[];
begin
  select * into v_request from public.request_instances where id = p_request_id for update;
  if not found or not (v_request.approval_config_snapshot ? 'extraBlock') then
    raise exception using errcode = 'P0001', message = 'REQUEST_APPROVAL_BLOCK_NOT_FOUND';
  end if;
  select * into v_workflow_version
  from public.workflow_template_versions
  where id = v_request.workflow_template_version_id;

  select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[])
    into v_user_ids
  from jsonb_array_elements_text(
    coalesce(v_request.approval_config_snapshot #> '{extraBlock,resolvedUserIds}', '[]'::jsonb)
  ) with ordinality as extra_user(value, ordinality);
  if cardinality(v_user_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'REQUEST_APPROVER_REQUIRED';
  end if;

  select node.id into v_node_id
  from public.request_approval_blocks block
  join public.workflow_nodes node
    on node.template_id = v_workflow_version.template_id
   and node.type = 'APPROVAL'::public.workflow_node_type
   and node.config ->> 'requestBlockKey' = block.block_key
  where block.request_template_version_id = v_request.request_template_version_id
  order by block.sort_order, block.block_key, node.position_x, node.id
  limit 1;
  select instance_node.id into v_instance_node_id
  from public.workflow_instance_nodes instance_node
  where instance_node.workflow_instance_id = v_request.workflow_instance_id
    and instance_node.template_node_id = v_node_id
  limit 1;

  foreach v_user_id in array v_user_ids loop
    insert into public.workflow_step_assignments(
      workflow_subject_id, workflow_instance_id, node_id, instance_node_id,
      assignee_user_id, assigned_by, status, assigned_at, due_at, sla_hours,
      assignment_source, assignment_group_type, assignment_group_id,
      assignment_round_id, metadata
    ) values (
      v_request.workflow_subject_id, v_request.workflow_instance_id,
      v_node_id, v_instance_node_id, v_user_id, p_actor_id, 'PENDING', now(),
      null, null, 'DYNAMIC_CREATOR_SELECT',
      'REQUEST_BLOCK', '__extra', p_round_id,
      jsonb_build_object('requestId', p_request_id, 'requestBlockKey', '__extra')
    );
    perform app_private.project_workflow_register_participant(
      v_request.workflow_subject_id, v_request.workflow_instance_id, v_user_id,
      'ASSIGNEE', 'request_block', '__extra', v_node_id,
      v_instance_node_id, p_actor_id
    );
    insert into app_private.request_notification_outbox(
      event_key, request_id, recipient_user_id, event_type, payload
    ) values (
      'request:' || p_request_id::text || ':BLOCK:' || p_round_id::text || ':__extra:' || v_user_id::text,
      p_request_id, v_user_id, 'REQUEST_APPROVAL_REQUIRED',
      jsonb_build_object('requestId', p_request_id, 'requestCode', v_request.code,
        'blockKey', '__extra')
    ) on conflict (event_key) do nothing;
  end loop;

  update public.workflow_instances
  set current_node_id = v_node_id,
      current_instance_node_id = v_instance_node_id,
      step_assignees = jsonb_build_object(v_node_id::text, to_jsonb(v_user_ids)),
      status = 'RUNNING'::public.workflow_instance_status,
      updated_at = now()
  where id = v_request.workflow_instance_id;
  update public.workflow_subjects
  set current_node_id = v_node_id,
      current_instance_node_id = v_instance_node_id,
      current_assignee_user_id = v_user_ids[1],
      current_assignee_user_ids = v_user_ids,
      status = 'RUNNING',
      updated_at = now()
  where id = v_request.workflow_subject_id;
end;
$function$;

-- 3. Resubmitting a request returned by an extra approver restarts that step.
create or replace function app_private.activate_request_block(p_request_id uuid, p_block_key text, p_round_id uuid, p_actor_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_request public.request_instances%rowtype;
  v_block record;
  v_version public.request_template_versions%rowtype;
  v_workflow_version public.workflow_template_versions%rowtype;
  v_node_id uuid;
  v_instance_node_id uuid;
  v_user_id uuid;
  v_user_ids uuid[] := '{}'::uuid[];
  v_due_at timestamptz;
begin
  select * into v_request
  from public.request_instances
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'REQUEST_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if p_block_key = '__extra' then
    perform app_private.activate_request_extra_block(p_request_id, p_round_id, p_actor_id);
    return;
  end if;

  select * into v_version
  from public.request_template_versions
  where id = v_request.request_template_version_id;
  select * into v_workflow_version
  from public.workflow_template_versions
  where id = v_request.workflow_template_version_id;
  select block.*,
         snapshot_block -> 'resolvedUserIds' as resolved_user_ids
    into v_block
  from public.request_approval_blocks block
  left join lateral jsonb_array_elements(
    coalesce(v_request.approval_config_snapshot -> 'blocks', '[]'::jsonb)
  ) snapshot_block
    on snapshot_block ->> 'key' = block.block_key
  where block.request_template_version_id = v_request.request_template_version_id
    and block.block_key = p_block_key
  order by block.sort_order
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'REQUEST_APPROVAL_BLOCK_NOT_FOUND';
  end if;

  select coalesce(array_agg(value::uuid order by value::uuid), '{}'::uuid[])
    into v_user_ids
  from jsonb_array_elements_text(coalesce(v_block.resolved_user_ids, '[]'::jsonb)) value;
  if cardinality(v_user_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'REQUEST_APPROVER_REQUIRED';
  end if;

  select node.id into v_node_id
  from public.workflow_nodes node
  where node.template_id = v_workflow_version.template_id
    and node.type = 'APPROVAL'::public.workflow_node_type
    and node.config ->> 'requestBlockKey' = p_block_key
  order by node.position_x, node.id
  limit 1;
  select instance_node.id into v_instance_node_id
  from public.workflow_instance_nodes instance_node
  where instance_node.workflow_instance_id = v_request.workflow_instance_id
    and instance_node.template_node_id = v_node_id
  limit 1;

  if v_block.sla_hours is not null then
    v_due_at := now() + make_interval(hours => v_block.sla_hours::integer);
  end if;
  foreach v_user_id in array v_user_ids loop
    insert into public.workflow_step_assignments(
      workflow_subject_id, workflow_instance_id, node_id, instance_node_id,
      assignee_user_id, assigned_by, status, assigned_at, due_at, sla_hours,
      assignment_source, assignment_group_type, assignment_group_id,
      assignment_round_id, metadata
    ) values (
      v_request.workflow_subject_id, v_request.workflow_instance_id,
      v_node_id, v_instance_node_id, v_user_id, p_actor_id, 'PENDING', now(),
      v_due_at, v_block.sla_hours::integer, v_block.approver_source,
      'REQUEST_BLOCK', p_block_key, p_round_id,
      jsonb_build_object('requestId', p_request_id, 'requestBlockKey', p_block_key)
    );
    perform app_private.project_workflow_register_participant(
      v_request.workflow_subject_id, v_request.workflow_instance_id, v_user_id,
      'ASSIGNEE', 'request_block', p_block_key, v_node_id,
      v_instance_node_id, p_actor_id
    );
    insert into app_private.request_notification_outbox(
      event_key, request_id, recipient_user_id, event_type, payload
    ) values (
      'request:' || p_request_id::text || ':BLOCK:' || p_round_id::text || ':' || p_block_key || ':' || v_user_id::text,
      p_request_id, v_user_id, 'REQUEST_APPROVAL_REQUIRED',
      jsonb_build_object('requestId', p_request_id, 'requestCode', v_request.code,
        'blockKey', p_block_key)
    ) on conflict (event_key) do nothing;
  end loop;

  update public.workflow_instances
  set current_node_id = v_node_id,
      current_instance_node_id = v_instance_node_id,
      step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || jsonb_build_object(v_node_id::text, to_jsonb(v_user_ids)),
      status = 'RUNNING'::public.workflow_instance_status,
      updated_at = now()
  where id = v_request.workflow_instance_id;

  update public.workflow_subjects
  set current_node_id = v_node_id,
      current_instance_node_id = v_instance_node_id,
      current_assignee_user_id = v_user_ids[1],
      current_assignee_user_ids = v_user_ids,
      status = 'RUNNING',
      updated_at = now()
  where id = v_request.workflow_subject_id;
end;
$$;

-- 4. Approving the extra step (all or any one) starts the template flow.
create or replace function app_private.act_on_request(p_request_id uuid, p_action text, p_comment text DEFAULT NULL::text, p_form_data jsonb DEFAULT NULL::jsonb, p_assignee_user_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'extensions'
    AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.request_instances%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_instance public.workflow_instances%rowtype;
  v_assignment public.workflow_step_assignments%rowtype;
  v_existing app_private.request_command_idempotency%rowtype;
  v_assignment_round uuid;
  v_block_key text;
  v_flow_mode text;
  v_completion_policy text;
  v_current_complete boolean := false;
  v_all_complete boolean := false;
  v_next_block_key text;
  v_result jsonb;
  v_payload_hash text;
  v_pending_count integer;
  v_approved_count integer;
  v_current_sort integer;
  v_pending_user_ids uuid[] := '{}'::uuid[];
  v_all_pending_user_ids uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
  end if;
  if not exists (
    select 1
    from public.users app_user
    where app_user.id = v_actor
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  ) then
    raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
  end if;
  if p_action not in ('APPROVE', 'REJECT', 'RETURN', 'RESUBMIT', 'CANCEL', 'REASSIGN') then
    raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  v_payload_hash := encode(digest(jsonb_build_object(
    'requestId', p_request_id, 'action', p_action, 'comment', p_comment,
    'formData', p_form_data, 'assigneeUserId', p_assignee_user_id,
    'expectedUpdatedAt', p_expected_updated_at
  )::text, 'sha256'), 'hex');
  insert into app_private.request_command_idempotency(
    actor_id, idempotency_key, command_name, request_id, payload_hash
  ) values (v_actor, p_idempotency_key, 'act_on_request', p_request_id, v_payload_hash)
  on conflict (actor_id, idempotency_key) do nothing;
  select * into v_existing
  from app_private.request_command_idempotency
  where actor_id = v_actor and idempotency_key = p_idempotency_key
  for update;
  if v_existing.command_name <> 'act_on_request' or v_existing.payload_hash <> v_payload_hash then
    raise exception using errcode = 'P0001', message = 'REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.result is not null then
    return v_existing.result;
  end if;

  -- Required lock order: request -> subject -> assignments.
  select * into v_request from public.request_instances
  where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'REQUEST_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if p_expected_updated_at is null or v_request.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'REQUEST_STALE_STATE';
  end if;
  select * into v_subject from public.workflow_subjects
  where id = v_request.workflow_subject_id for update;
  select * into v_instance from public.workflow_instances
  where id = v_request.workflow_instance_id for update;
  perform 1 from public.workflow_step_assignments assignment
  where assignment.workflow_subject_id = v_request.workflow_subject_id
  order by assignment.id
  for update;

  select v_request.approval_config_snapshot ->> 'flowMode',
         v_request.approval_config_snapshot ->> 'completionPolicy'
    into v_flow_mode, v_completion_policy;
  select assignment.* into v_assignment
  from public.workflow_step_assignments assignment
  where assignment.workflow_subject_id = v_request.workflow_subject_id
    and assignment.assignee_user_id = v_actor
    and assignment.status = 'PENDING'
  order by assignment.id
  limit 1;

  if not found and p_action = 'REASSIGN' and app_private.request_action_is_admin(v_actor) then
    select assignment.* into v_assignment
    from public.workflow_step_assignments assignment
    where assignment.workflow_subject_id = v_request.workflow_subject_id
      and assignment.status = 'PENDING'
    order by assignment.id
    limit 1;
  end if;

  if p_action = 'REASSIGN' and not found then
    raise exception using errcode = 'P0001', message = 'REQUEST_ASSIGNMENT_NOT_ACTIVE';
  end if;

  if p_action in ('APPROVE', 'REJECT', 'RETURN') and not found then
    raise exception using errcode = 'P0001', message = 'REQUEST_ASSIGNMENT_NOT_ACTIVE';
  end if;
  v_block_key := v_assignment.metadata ->> 'requestBlockKey';
  v_assignment_round := v_assignment.assignment_round_id;

  if p_action = 'APPROVE' then
    update public.workflow_step_assignments
    set status = 'APPROVED', acted_at = now(), action_comment = p_comment
    where id = v_assignment.id and status = 'PENDING';
    if not found then
      raise exception using errcode = 'P0001', message = 'REQUEST_ALREADY_PROCESSED';
    end if;

    if v_block_key = '__extra' then
      select count(*) filter (where status = 'PENDING'),
             count(*) filter (where status = 'APPROVED')
        into v_pending_count, v_approved_count
      from public.workflow_step_assignments assignment
      where assignment.workflow_subject_id = v_request.workflow_subject_id
        and assignment.assignment_round_id = v_assignment_round
        and assignment.metadata ->> 'requestBlockKey' = '__extra';
      if coalesce(v_request.approval_config_snapshot #>> '{extraBlock,completionPolicy}', 'ALL') = 'ANY_ONE'
         and v_approved_count > 0 then
        perform app_private.close_request_pending_assignments(
          p_request_id, 'SKIPPED', v_assignment_round, '__extra', p_comment
        );
        v_pending_count := 0;
      end if;
      if v_pending_count = 0 then
        perform app_private.activate_request_template_start(p_request_id, v_assignment_round, v_actor);
      end if;
    else
    select count(*) filter (where status = 'PENDING'),
           count(*) filter (where status = 'APPROVED')
      into v_pending_count, v_approved_count
    from public.workflow_step_assignments assignment
    where assignment.workflow_subject_id = v_request.workflow_subject_id
      and assignment.assignment_round_id = v_assignment_round
      and (
        v_flow_mode = 'PARALLEL'
        or assignment.metadata ->> 'requestBlockKey' = v_block_key
      );
    if v_completion_policy = 'ANY_ONE' and v_approved_count > 0 then
      perform app_private.close_request_pending_assignments(
        p_request_id, 'SKIPPED', v_assignment_round,
        case when v_flow_mode = 'PARALLEL' then null else v_block_key end,
        p_comment
      );
      v_pending_count := 0;
    end if;
    v_current_complete := v_pending_count = 0;

    select count(*) = 0 into v_all_complete
    from public.workflow_step_assignments assignment
    where assignment.workflow_subject_id = v_request.workflow_subject_id
      and assignment.assignment_round_id = v_assignment_round
      and assignment.status = 'PENDING';

    if v_flow_mode = 'PARALLEL' then
      if v_all_complete then
        update public.request_instances
        set status = 'APPROVED', completed_at = now(), updated_at = now()
        where id = p_request_id;
        update public.workflow_subjects set status = 'COMPLETED', updated_at = now()
        where id = v_subject.id;
        update public.workflow_instances set status = 'COMPLETED'::public.workflow_instance_status,
          updated_at = now() where id = v_instance.id;
      end if;
    elsif v_current_complete then
      select block.sort_order into v_current_sort
      from public.request_approval_blocks block
      where block.request_template_version_id = v_request.request_template_version_id
        and block.block_key = v_block_key;
      select block.block_key into v_next_block_key
      from public.request_approval_blocks block
      where block.request_template_version_id = v_request.request_template_version_id
        and block.sort_order > coalesce(v_current_sort, 0)
      order by block.sort_order, block.block_key
      limit 1;
      if v_next_block_key is null then
        update public.request_instances set status = 'APPROVED', completed_at = now(), updated_at = now()
        where id = p_request_id;
        update public.workflow_subjects set status = 'COMPLETED', updated_at = now()
        where id = v_subject.id;
        update public.workflow_instances set status = 'COMPLETED'::public.workflow_instance_status,
          updated_at = now() where id = v_instance.id;
      else
        perform app_private.activate_request_block(p_request_id, v_next_block_key, v_assignment_round, v_actor);
      end if;
    end if;
    end if;
    insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
    values (v_instance.id, v_subject.current_node_id, 'APPROVED'::public.workflow_instance_action, v_actor, p_comment);

  elsif p_action = 'REJECT' then
    if nullif(trim(coalesce(p_comment, '')), '') is null then
      raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
    end if;
    update public.workflow_step_assignments
    set status = 'REJECTED', acted_at = now(), action_comment = p_comment
    where id = v_assignment.id;
    perform app_private.close_request_pending_assignments(p_request_id, 'CANCELLED', null, null, p_comment);
    update public.request_instances set status = 'REJECTED', completed_at = now(), updated_at = now()
    where id = p_request_id;
    update public.workflow_subjects set status = 'REJECTED', updated_at = now() where id = v_subject.id;
    update public.workflow_instances set status = 'REJECTED'::public.workflow_instance_status, updated_at = now()
    where id = v_instance.id;
    insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
    values (v_instance.id, v_subject.current_node_id, 'REJECTED'::public.workflow_instance_action, v_actor, p_comment);

  elsif p_action = 'RETURN' then
    if nullif(trim(coalesce(p_comment, '')), '') is null then
      raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
    end if;
    update public.workflow_step_assignments
    set status = 'RETURNED', acted_at = now(), action_comment = p_comment,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('returnedBlockKey', v_block_key)
    where id = v_assignment.id;
    perform app_private.close_request_pending_assignments(
      p_request_id,
      'CANCELLED',
      v_assignment_round,
      case when v_flow_mode = 'PARALLEL' then null else v_block_key end,
      p_comment
    );
    update public.request_instances
    set status = 'RETURNED', approval_config_snapshot = coalesce(approval_config_snapshot, '{}'::jsonb)
      || jsonb_build_object('returnedBlockKey', v_block_key), updated_at = now()
    where id = p_request_id;
    update public.workflow_subjects set status = 'RETURNED', updated_at = now() where id = v_subject.id;
    update public.workflow_instances set status = 'RUNNING'::public.workflow_instance_status, updated_at = now()
    where id = v_instance.id;
    insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
    values (v_instance.id, v_subject.current_node_id, 'REVISION_REQUESTED'::public.workflow_instance_action, v_actor, p_comment);

  elsif p_action = 'RESUBMIT' then
    if v_request.created_by <> v_actor or v_request.status <> 'RETURNED' then
      raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
    end if;
    v_block_key := v_request.approval_config_snapshot ->> 'returnedBlockKey';
    if v_block_key is null then
      raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
    end if;
    v_assignment_round := gen_random_uuid();
    update public.request_instances
    set status = 'PENDING', form_data = coalesce(p_form_data, form_data),
        approval_config_snapshot = jsonb_set(
          approval_config_snapshot - 'returnedBlockKey',
          '{assignmentRoundId}', to_jsonb(v_assignment_round), true
        ), updated_at = now()
    where id = p_request_id;
    perform app_private.activate_request_block(p_request_id, v_block_key, v_assignment_round, v_actor);
    update public.workflow_subjects set status = 'RUNNING', updated_at = now() where id = v_subject.id;
    insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
    values (v_instance.id, v_subject.current_node_id, 'REOPENED'::public.workflow_instance_action, v_actor, p_comment);

  elsif p_action = 'CANCEL' then
    if not (v_request.created_by = v_actor or app_private.request_action_is_admin(v_actor))
       or v_request.status in ('APPROVED', 'REJECTED', 'CANCELLED') then
      raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
    end if;
    perform app_private.close_request_pending_assignments(p_request_id, 'CANCELLED', null, null, p_comment);
    update public.request_instances set status = 'CANCELLED', completed_at = now(), updated_at = now()
    where id = p_request_id;
    update public.workflow_subjects set status = 'CANCELLED', updated_at = now() where id = v_subject.id;
    update public.workflow_instances set status = 'CANCELLED'::public.workflow_instance_status, updated_at = now()
    where id = v_instance.id;
    insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
    values (v_instance.id, v_subject.current_node_id, 'REJECTED'::public.workflow_instance_action, v_actor, p_comment);

  elsif p_action = 'REASSIGN' then
    if not app_private.request_action_is_admin(v_actor)
       or p_assignee_user_id is null
       or nullif(trim(coalesce(p_comment, '')), '') is null then
      raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
    end if;
    if not exists (
      select 1 from public.users app_user
      where app_user.id = p_assignee_user_id
        and coalesce(app_user.is_active, true)
        and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    ) then
      raise exception using errcode = 'P0001', message = 'REQUEST_APPROVER_INACTIVE';
    end if;
    update public.workflow_step_assignments
    set status = 'CANCELLED', acted_at = now(), action_comment = p_comment
    where id = v_assignment.id;
    insert into public.workflow_step_assignments(
      workflow_subject_id, workflow_instance_id, node_id, instance_node_id,
      assignee_user_id, assigned_by, status, assigned_at, due_at, sla_hours,
      assignment_source, assignment_group_type, assignment_group_id,
      assignment_round_id, metadata
    ) values (
      v_assignment.workflow_subject_id, v_assignment.workflow_instance_id,
      v_assignment.node_id, v_assignment.instance_node_id, p_assignee_user_id,
      v_actor, 'PENDING', now(), v_assignment.due_at, v_assignment.sla_hours,
      v_assignment.assignment_source, v_assignment.assignment_group_type,
      v_assignment.assignment_group_id, v_assignment.assignment_round_id,
      coalesce(v_assignment.metadata, '{}'::jsonb) || jsonb_build_object('reassignedFrom', v_assignment.assignee_user_id)
    );
    select coalesce(array_agg(assignment.assignee_user_id order by assignment.id), '{}'::uuid[])
      into v_pending_user_ids
    from public.workflow_step_assignments assignment
    where assignment.workflow_subject_id = v_assignment.workflow_subject_id
      and assignment.assignment_round_id = v_assignment.assignment_round_id
      and assignment.metadata ->> 'requestBlockKey' = v_block_key
      and assignment.status = 'PENDING';
    select coalesce(array_agg(assignment.assignee_user_id order by assignment.id), '{}'::uuid[])
      into v_all_pending_user_ids
    from public.workflow_step_assignments assignment
    where assignment.workflow_subject_id = v_assignment.workflow_subject_id
      and assignment.assignment_round_id = v_assignment.assignment_round_id
      and assignment.status = 'PENDING';
    update public.workflow_subjects
    set current_assignee_user_id = v_all_pending_user_ids[1],
        current_assignee_user_ids = v_all_pending_user_ids,
        current_node_id = v_assignment.node_id,
        current_instance_node_id = v_assignment.instance_node_id,
        updated_at = now()
    where id = v_assignment.workflow_subject_id;
    update public.workflow_instances
    set current_node_id = v_assignment.node_id,
        current_instance_node_id = v_assignment.instance_node_id,
        step_assignees = coalesce(step_assignees, '{}'::jsonb)
          || jsonb_build_object(v_assignment.node_id::text, to_jsonb(v_pending_user_ids)),
        updated_at = now()
    where id = v_assignment.workflow_instance_id;
    update public.request_instances request_instance
    set approval_config_snapshot = jsonb_set(
      coalesce(request_instance.approval_config_snapshot, '{}'::jsonb),
      '{blocks}',
      coalesce((
        select jsonb_agg(
          case
            when block ->> 'key' = v_block_key
            then jsonb_set(block, '{resolvedUserIds}', to_jsonb(v_pending_user_ids), true)
            else block
          end
          order by block_order
        )
        from jsonb_array_elements(
          coalesce(request_instance.approval_config_snapshot -> 'blocks', '[]'::jsonb)
        ) with ordinality as block_items(block, block_order)
      ), '[]'::jsonb),
      true
    ), updated_at = now()
    where request_instance.id = p_request_id;
    perform app_private.project_workflow_register_participant(
      v_assignment.workflow_subject_id, v_assignment.workflow_instance_id,
      p_assignee_user_id, 'ASSIGNEE', 'request_reassign', v_block_key,
      v_assignment.node_id, v_assignment.instance_node_id, v_actor
    );
    insert into app_private.request_notification_outbox(
      event_key, request_id, recipient_user_id, event_type, payload
    ) values (
      'request:' || p_request_id::text || ':REASSIGN:' || p_assignee_user_id::text || ':' || now()::text,
      p_request_id, p_assignee_user_id, 'REQUEST_APPROVAL_REQUIRED',
      jsonb_build_object('requestId', p_request_id, 'requestCode', v_request.code,
        'blockKey', v_block_key, 'reassigned', true)
    ) on conflict (event_key) do nothing;
    insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
    values (
      v_assignment.workflow_instance_id,
      v_assignment.node_id,
      'REASSIGNED'::public.workflow_instance_action,
      v_actor,
      'REASSIGNED: ' || p_comment
    );
  end if;

  update public.request_instances set updated_at = now() where id = p_request_id;

  -- Keep notification delivery out of the transaction: every successful
  -- command records one creator-facing event for the asynchronous worker.
  insert into app_private.request_notification_outbox(
    event_key, request_id, recipient_user_id, event_type, payload
  ) values (
    'request:' || p_request_id::text || ':ACTION:' || p_action || ':' || p_idempotency_key,
    p_request_id, v_request.created_by, 'REQUEST_ACTION_APPLIED',
    jsonb_build_object('requestId', p_request_id, 'requestCode', v_request.code,
      'action', p_action, 'comment', p_comment)
  ) on conflict (event_key) do nothing;

  select * into v_request from public.request_instances where id = p_request_id;
  v_result := jsonb_build_object(
    'requestId', v_request.id,
    'requestCode', v_request.code,
    'status', v_request.status,
    'workflowInstanceId', v_request.workflow_instance_id,
    'workflowSubjectId', v_request.workflow_subject_id,
    'currentBlockKeys', app_private.request_action_current_blocks(p_request_id),
    'updatedAt', v_request.updated_at
  );
  update app_private.request_command_idempotency set result = v_result where id = v_existing.id;
  return v_result;
end;
$$;

-- 5. submit_request gains p_options; the six-argument form is replaced so
-- existing callers keep working through the default.
drop function if exists public.submit_request(uuid, text, text, jsonb, jsonb, text);
drop function if exists app_private.submit_request(uuid, text, text, jsonb, jsonb, text);
create or replace function app_private.submit_request(p_request_template_version_id uuid, p_title text, p_description text, p_form_data jsonb, p_dynamic_approvers_by_block jsonb, p_idempotency_key text, p_options jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'extensions'
    AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_template public.request_templates%rowtype;
  v_version public.request_template_versions%rowtype;
  v_workflow_version public.workflow_template_versions%rowtype;
  v_request public.request_instances%rowtype;
  v_instance public.workflow_instances%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_existing app_private.request_command_idempotency%rowtype;
  v_block record;
  v_dynamic_ids uuid[];
  v_resolved_ids uuid[];
  v_current_user_ids uuid[] := '{}'::uuid[];
  v_watcher_ids uuid[] := '{}'::uuid[];
  v_step_assignees jsonb := '{}'::jsonb;
  v_block_users jsonb := '{}'::jsonb;
  v_result jsonb;
  v_payload_hash text;
  v_request_code text;
  v_first_block_key text;
  v_first_node_id uuid;
  v_first_instance_node_id uuid;
  v_node_id uuid;
  v_instance_node_id uuid;
  v_assignment_round_id uuid := gen_random_uuid();
  v_current_block_keys jsonb := '[]'::jsonb;
  v_request_due_at timestamptz;
  v_block_due_at timestamptz;
  v_min_sort integer;
  v_user_id uuid;
  v_options jsonb := coalesce(p_options, '{}'::jsonb);
  v_extra_ids uuid[] := '{}'::uuid[];
  v_extra_policy text;
  v_option_watcher_ids uuid[] := '{}'::uuid[];
begin
  if v_actor is null or not exists (
    select 1 from public.users app_user
    where app_user.id = v_actor
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'REQUEST_AUTHENTICATION_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = '22023', message = 'REQUEST_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception using errcode = '22023', message = 'REQUEST_TITLE_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_form_data, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_dynamic_approvers_by_block, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(v_options) <> 'object'
     or jsonb_typeof(coalesce(v_options -> 'extraApproverIds', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(v_options -> 'watcherIds', '[]'::jsonb)) <> 'array'
     or coalesce(v_options ->> 'extraCompletionPolicy', 'ALL') not in ('ALL', 'ANY_ONE') then
    raise exception using errcode = '22023', message = 'REQUEST_PAYLOAD_INVALID';
  end if;
  -- Extra approvers keep the creator's order; duplicates are dropped.
  select coalesce(array_agg(extra_id order by first_position), '{}'::uuid[])
    into v_extra_ids
  from (
    select value::uuid as extra_id, min(ordinality) as first_position
    from jsonb_array_elements_text(coalesce(v_options -> 'extraApproverIds', '[]'::jsonb)) with ordinality
    group by value::uuid
  ) extra;
  if cardinality(v_extra_ids) > 20 then
    raise exception using errcode = '22023', message = 'REQUEST_PAYLOAD_INVALID';
  end if;
  if v_actor = any(v_extra_ids) then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_SELF_NOT_ALLOWED';
  end if;
  if exists (
    select 1 from unnest(v_extra_ids) as extra(extra_id)
    left join public.users app_user on app_user.id = extra.extra_id
    where app_user.id is null
       or not coalesce(app_user.is_active, true)
       or coalesce(app_user.account_status, 'ACTIVE') <> 'ACTIVE'
  ) then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_INACTIVE';
  end if;
  v_extra_policy := coalesce(v_options ->> 'extraCompletionPolicy', 'ALL');
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[])
    into v_option_watcher_ids
  from jsonb_array_elements_text(coalesce(v_options -> 'watcherIds', '[]'::jsonb));
  if cardinality(v_option_watcher_ids) > 50 or exists (
    select 1 from unnest(v_option_watcher_ids) as watcher(watcher_id)
    left join public.users app_user on app_user.id = watcher.watcher_id
    where app_user.id is null
       or not coalesce(app_user.is_active, true)
       or coalesce(app_user.account_status, 'ACTIVE') <> 'ACTIVE'
  ) then
    raise exception using errcode = '22023', message = 'REQUEST_WATCHER_INVALID';
  end if;

  v_payload_hash := encode(
    digest(
      jsonb_build_object(
        'requestTemplateVersionId', p_request_template_version_id,
        'title', p_title,
        'description', coalesce(p_description, ''),
        'formData', coalesce(p_form_data, '{}'::jsonb),
        'dynamicApproversByBlock', coalesce(p_dynamic_approvers_by_block, '{}'::jsonb),
        'options', v_options
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into app_private.request_command_idempotency(
    actor_id, idempotency_key, command_name, payload_hash
  ) values (
    v_actor, p_idempotency_key, 'submit_request', v_payload_hash
  ) on conflict (actor_id, idempotency_key) do nothing;

  select * into v_existing
  from app_private.request_command_idempotency
  where actor_id = v_actor
    and idempotency_key = p_idempotency_key
  for update;
  if v_existing.payload_hash <> v_payload_hash
     or v_existing.command_name <> 'submit_request' then
    raise exception using errcode = '40001', message = 'REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.result is not null then
    return v_existing.result;
  end if;

  select * into v_version
  from public.request_template_versions
  where id = p_request_template_version_id
    and status = 'PUBLISHED'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_VERSION_NOT_PUBLISHED';
  end if;
  select * into v_template
  from public.request_templates
  where id = v_version.request_template_id
    and lifecycle_status = 'PUBLISHED'
  for update;
  if not found or not app_private.request_template_version_can_use(v_version.id, v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;
  if v_version.workflow_template_version_id is null then
    raise exception using errcode = '22023', message = 'REQUEST_WORKFLOW_VERSION_MISSING';
  end if;
  select * into v_workflow_version
  from public.workflow_template_versions
  where id = v_version.workflow_template_version_id;
  if not found then
    raise exception using errcode = '22023', message = 'REQUEST_WORKFLOW_VERSION_MISSING';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_version.form_schema, '[]'::jsonb)) field
    where coalesce((field ->> 'required')::boolean, false)
      and (
        not (coalesce(p_form_data, '{}'::jsonb) ? (field ->> 'key'))
        or nullif(trim(coalesce(p_form_data ->> (field ->> 'key'), '')), '') is null
      )
  ) then
    raise exception using errcode = '22023', message = 'REQUEST_REQUIRED_FIELD_MISSING';
  end if;

  select min(sort_order) into v_min_sort
  from public.request_approval_blocks
  where request_template_version_id = v_version.id;
  if v_min_sort is null then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVAL_BLOCK_REQUIRED';
  end if;

  for v_block in
    select block.*
    from public.request_approval_blocks block
    where block.request_template_version_id = v_version.id
    order by block.sort_order, block.block_key
  loop
    v_dynamic_ids := '{}'::uuid[];
    if jsonb_typeof(p_dynamic_approvers_by_block -> v_block.block_key) = 'array' then
      select coalesce(array_agg(value::uuid), '{}'::uuid[])
        into v_dynamic_ids
      from jsonb_array_elements_text(p_dynamic_approvers_by_block -> v_block.block_key);
    end if;
    v_resolved_ids := app_private.resolve_request_block_approvers(
      v_block.id, v_actor, v_dynamic_ids
    );
    v_block_users := v_block_users || jsonb_build_object(
      v_block.block_key, to_jsonb(v_resolved_ids)
    );
    v_current_block_keys := case
      when v_version.flow_mode = 'PARALLEL'
        then v_current_block_keys || jsonb_build_array(v_block.block_key)
      when v_block.sort_order = v_min_sort
        then jsonb_build_array(v_block.block_key)
      else v_current_block_keys
    end;

    v_node_id := null;
    select node.id into v_node_id
    from public.workflow_nodes node
    where node.template_id = v_workflow_version.template_id
      and node.type = 'APPROVAL'::public.workflow_node_type
      and node.config ->> 'requestBlockKey' = v_block.block_key
    order by node.position_x, node.id
    limit 1;
    if v_node_id is null then
      raise exception using errcode = '22023', message = 'REQUEST_WORKFLOW_BLOCK_NODE_MISSING';
    end if;

    v_step_assignees := v_step_assignees || case
      when v_version.flow_mode = 'PARALLEL' or v_block.sort_order = v_min_sort
        then jsonb_build_object(v_node_id::text, to_jsonb(v_resolved_ids))
      else '{}'::jsonb
    end;

    if v_version.flow_mode = 'PARALLEL' or v_block.sort_order = v_min_sort then
      foreach v_user_id in array v_resolved_ids loop
        if v_user_id <> all(coalesce(v_current_user_ids, '{}'::uuid[])) then
          v_current_user_ids := array_append(v_current_user_ids, v_user_id);
        end if;
      end loop;
    end if;
  end loop;

  select block.block_key, node.id
    into v_first_block_key, v_first_node_id
  from public.request_approval_blocks block
  join public.workflow_nodes node
    on node.template_id = v_workflow_version.template_id
   and node.type = 'APPROVAL'::public.workflow_node_type
   and node.config ->> 'requestBlockKey' = block.block_key
  where block.request_template_version_id = v_version.id
    and block.sort_order = v_min_sort
  order by block.block_key, node.id
  limit 1;
  if v_first_node_id is null or cardinality(v_current_user_ids) = 0 then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_REQUIRED';
  end if;

  if v_version.request_sla_hours is not null then
    v_request_due_at := now() + make_interval(hours => v_version.request_sla_hours::integer);
  end if;
  v_request_code := app_private.next_request_code();

  insert into public.request_instances(
    category_id, code, title, description, form_data, created_by, status,
    request_template_id, request_template_version_id, workflow_template_version_id,
    form_schema_snapshot, approval_config_snapshot, print_config_snapshot,
    submitted_at, due_at
  ) values (
    null, v_request_code, trim(p_title), coalesce(p_description, ''),
    coalesce(p_form_data, '{}'::jsonb), v_actor, 'PENDING',
    v_template.id, v_version.id, v_version.workflow_template_version_id,
    coalesce(v_version.form_schema, '[]'::jsonb),
    jsonb_build_object(
      'flowMode', v_version.flow_mode,
      'completionPolicy', v_version.completion_policy,
      'blocks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', block.id,
          'key', block.block_key,
          'name', block.name,
          'source', block.approver_source,
          'fixedUserIds', to_jsonb(block.fixed_user_ids),
          'slaHours', block.sla_hours,
          'resolvedUserIds', v_block_users -> block.block_key
        ) order by block.sort_order, block.block_key)
        from public.request_approval_blocks block
        where block.request_template_version_id = v_version.id
      ), '[]'::jsonb),
      'assignmentRoundId', v_assignment_round_id
    ) || case when cardinality(v_extra_ids) > 0 then jsonb_build_object(
      'extraBlock', jsonb_build_object(
        'key', '__extra',
        'name', 'Người duyệt thêm',
        'completionPolicy', v_extra_policy,
        'resolvedUserIds', to_jsonb(v_extra_ids)
      )
    ) else '{}'::jsonb end,
    coalesce(v_version.print_config, '{}'::jsonb),
    now(), v_request_due_at
  ) returning * into v_request;

  insert into public.workflow_instances(
    template_id, code, title, created_by, current_node_id, status,
    form_data, watchers, step_assignees, template_version_id
  ) values (
    v_workflow_version.template_id, v_request.code, v_request.title, v_actor,
    v_first_node_id, 'RUNNING'::public.workflow_instance_status,
    jsonb_build_object('subjectType', 'request', 'subjectId', v_request.id, 'requestCode', v_request.code),
    coalesce(v_workflow_version.default_watchers, '{}'::text[]),
    v_step_assignees, v_version.workflow_template_version_id
  ) returning * into v_instance;

  perform app_private.project_workflow_snapshot_instance(
    v_instance.id, v_version.workflow_template_version_id, v_workflow_version.template_id
  );
  select instance_node.id into v_first_instance_node_id
  from public.workflow_instance_nodes instance_node
  where instance_node.workflow_instance_id = v_instance.id
    and instance_node.template_node_id = v_first_node_id
  limit 1;
  update public.workflow_instances
  set current_instance_node_id = v_first_instance_node_id,
      updated_at = now()
  where id = v_instance.id
  returning * into v_instance;

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_instance.id, v_first_node_id, 'SUBMITTED'::public.workflow_instance_action, v_actor, null);

  insert into public.workflow_subjects(
    workflow_instance_id, subject_type, subject_id,
    current_assignee_user_id, current_assignee_user_ids,
    current_node_id, current_instance_node_id, template_version_id,
    status, created_by
  ) values (
    v_instance.id, 'request', v_request.id::text,
    v_current_user_ids[1], v_current_user_ids, v_first_node_id,
    v_first_instance_node_id, v_version.workflow_template_version_id,
    'RUNNING', v_actor
  ) returning * into v_subject;

  update public.request_instances
  set workflow_instance_id = v_instance.id,
      workflow_subject_id = v_subject.id
  where id = v_request.id
  returning * into v_request;

  perform app_private.project_workflow_register_participant(
    v_subject.id, v_instance.id, v_actor, 'CREATOR', 'request_creator', v_request.id::text,
    null, null, v_actor
  );
  select coalesce(array_agg(watcher.user_id order by watcher.user_id), '{}'::uuid[])
    into v_watcher_ids
  from public.request_template_watchers watcher
  where watcher.request_template_version_id = v_version.id;
  foreach v_user_id in array v_watcher_ids loop
    perform app_private.project_workflow_register_participant(
      v_subject.id, v_instance.id, v_user_id, 'WATCHER', 'request_template', v_version.id::text,
      null, null, v_actor
    );
  end loop;

  for v_block in
    select block.*
    from public.request_approval_blocks block
    where block.request_template_version_id = v_version.id
    order by block.sort_order, block.block_key
  loop
    -- With extra approvers the template flow starts only after that step.
    if cardinality(v_extra_ids) > 0
       or (v_version.flow_mode <> 'PARALLEL' and v_block.sort_order <> v_min_sort) then
      continue;
    end if;
    select node.id into v_node_id
    from public.workflow_nodes node
    where node.template_id = v_workflow_version.template_id
      and node.type = 'APPROVAL'::public.workflow_node_type
      and node.config ->> 'requestBlockKey' = v_block.block_key
    order by node.position_x, node.id
    limit 1;
    select instance_node.id into v_instance_node_id
    from public.workflow_instance_nodes instance_node
    where instance_node.workflow_instance_id = v_instance.id
      and instance_node.template_node_id = v_node_id
    limit 1;
    select coalesce(array_agg(value::uuid), '{}'::uuid[])
      into v_resolved_ids
    from jsonb_array_elements_text(
      coalesce(
        (select block_snapshot -> 'resolvedUserIds'
         from jsonb_array_elements(
           v_request.approval_config_snapshot -> 'blocks'
         ) block_snapshot
         where block_snapshot ->> 'key' = v_block.block_key),
        '[]'::jsonb
      )
    ) value;
    if v_block.sla_hours is not null then
      v_block_due_at := now() + make_interval(hours => v_block.sla_hours::integer);
    else
      v_block_due_at := null;
    end if;
    foreach v_user_id in array v_resolved_ids loop
      insert into public.workflow_step_assignments(
        workflow_subject_id, workflow_instance_id, node_id, instance_node_id,
        assignee_user_id, assigned_by, status, assigned_at, due_at, sla_hours,
        assignment_source, assignment_group_type, assignment_group_id,
        assignment_round_id, metadata
      ) values (
        v_subject.id, v_instance.id, v_node_id, v_instance_node_id,
        v_user_id, v_actor, 'PENDING', now(), v_block_due_at,
        v_block.sla_hours::integer, v_block.approver_source, 'REQUEST_BLOCK',
        v_block.block_key, v_assignment_round_id,
        jsonb_build_object('requestId', v_request.id, 'requestBlockKey', v_block.block_key)
      );
      perform app_private.project_workflow_register_participant(
        v_subject.id, v_instance.id, v_user_id, 'ASSIGNEE', 'request_block',
        v_block.block_key, v_node_id, v_instance_node_id, v_actor
      );
      insert into app_private.request_notification_outbox(
        event_key, request_id, recipient_user_id, event_type, payload
      ) values (
        'request:' || v_request.id::text || ':SUBMITTED:' || v_user_id::text,
        v_request.id, v_user_id, 'REQUEST_SUBMITTED',
        jsonb_build_object(
          'requestId', v_request.id,
          'requestCode', v_request.code,
          'title', v_request.title,
          'blockKey', v_block.block_key
        )
      ) on conflict (event_key) do nothing;
    end loop;
  end loop;

  if cardinality(v_extra_ids) > 0 then
    perform app_private.activate_request_extra_block(v_request.id, v_assignment_round_id, v_actor);
    v_current_block_keys := '["__extra"]'::jsonb;
  end if;
  foreach v_user_id in array v_option_watcher_ids loop
    if v_user_id = v_actor then
      continue;
    end if;
    perform app_private.project_workflow_register_participant(
      v_subject.id, v_instance.id, v_user_id, 'WATCHER', 'request_manual', v_actor::text,
      null, null, v_actor
    );
    insert into app_private.request_notification_outbox(
      event_key, request_id, recipient_user_id, event_type, payload
    ) values (
      'request:' || v_request.id::text || ':WATCHER:' || v_user_id::text || ':submit',
      v_request.id, v_user_id, 'REQUEST_WATCHER_ADDED',
      jsonb_build_object('requestId', v_request.id, 'requestCode', v_request.code, 'addedBy', v_actor)
    ) on conflict (event_key) do nothing;
  end loop;

  v_result := jsonb_build_object(
    'requestId', v_request.id,
    'requestCode', v_request.code,
    'status', v_request.status,
    'workflowInstanceId', v_instance.id,
    'workflowSubjectId', v_subject.id,
    'currentBlockKeys', v_current_block_keys,
    'updatedAt', v_request.updated_at
  );
  update app_private.request_command_idempotency
  set request_id = v_request.id, result = v_result
  where id = v_existing.id;
  return v_result;
end;
$$;

create or replace function public.submit_request(
  p_request_template_version_id uuid,
  p_title text,
  p_description text default ''::text,
  p_form_data jsonb default '{}'::jsonb,
  p_dynamic_approvers_by_block jsonb default '{}'::jsonb,
  p_idempotency_key text default null::text,
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.submit_request(
    p_request_template_version_id,
    p_title,
    p_description,
    p_form_data,
    p_dynamic_approvers_by_block,
    p_idempotency_key,
    p_options
  );
$function$;

-- 6. Editing content restarts approval from the extra step when present.
create or replace function app_private.update_request_content(
  p_request_id uuid,
  p_title text,
  p_description text,
  p_form_data jsonb,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.request_instances%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_instance public.workflow_instances%rowtype;
  v_existing app_private.request_command_idempotency%rowtype;
  v_hash text;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := coalesce(p_description, '');
  v_form_data jsonb := coalesce(p_form_data, '{}'::jsonb);
  v_round uuid;
  v_first_sort integer;
  v_block record;
  v_current_ids uuid[];
  v_dynamic_ids uuid[];
  v_blocks jsonb := '[]'::jsonb;
  v_response jsonb;
  v_cancelled_user uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.users u where u.id = v_actor
      and coalesce(u.is_active, true)
      and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
  ) then raise exception using errcode='42501', message='REQUEST_EDIT_FORBIDDEN'; end if;
  if p_request_id is null or nullif(p_idempotency_key, '') is null
    or p_expected_updated_at is null or v_title = ''
    or jsonb_typeof(v_form_data) <> 'object' then
    raise exception using errcode='22023', message='REQUEST_PAYLOAD_INVALID';
  end if;

  v_hash := encode(extensions.digest(jsonb_build_object(
    'requestId',p_request_id,'title',v_title,'description',v_description,
    'formData',v_form_data,'expectedUpdatedAt',p_expected_updated_at
  )::text,'sha256'),'hex');
  insert into app_private.request_command_idempotency(
    actor_id,idempotency_key,command_name,request_id,payload_hash
  ) values(v_actor,p_idempotency_key,'update_request_content',p_request_id,v_hash)
  on conflict(actor_id,idempotency_key) do nothing;
  select * into strict v_existing from app_private.request_command_idempotency
  where actor_id=v_actor and idempotency_key=p_idempotency_key for update;
  if v_existing.command_name <> 'update_request_content' or v_existing.payload_hash <> v_hash then
    raise exception using errcode='40001', message='REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.result is not null then return v_existing.result; end if;
  if not app_private.request_feature_enabled('content_edit') then
    raise exception using errcode='42501',message='REQUEST_FEATURE_DISABLED'; end if;

  select * into v_request from public.request_instances where id=p_request_id for update;
  if not found or v_request.created_by <> v_actor
    or not app_private.request_instance_can_select(p_request_id,v_actor) then
    raise exception using errcode='42501', message='REQUEST_EDIT_FORBIDDEN';
  end if;
  if v_request.status not in ('PENDING','RETURNED') then
    raise exception using errcode='22023', message='REQUEST_EDIT_STATUS_LOCKED';
  end if;
  if v_request.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001', message='REQUEST_STALE_STATE';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_request.form_schema_snapshot,'[]'::jsonb)) f
    where coalesce((f->>'required')::boolean,false)
      and (not (v_form_data ? (f->>'key')) or nullif(btrim(coalesce(v_form_data->>(f->>'key'),'')),'') is null)
  ) then raise exception using errcode='22023', message='REQUEST_REQUIRED_FIELD_MISSING'; end if;

  if v_title = btrim(v_request.title)
    and v_description = coalesce(v_request.description,'')
    and v_form_data = coalesce(v_request.form_data,'{}'::jsonb) then
    v_response := jsonb_build_object(
      'requestId',v_request.id,'requestCode',v_request.code,'status',v_request.status,
      'workflowInstanceId',v_request.workflow_instance_id,'workflowSubjectId',v_request.workflow_subject_id,
      'currentBlockKeys',app_private.request_action_current_blocks(v_request.id),
      'updatedAt',v_request.updated_at,'contentRevision',v_request.content_revision
    );
    update app_private.request_command_idempotency set result=v_response where id=v_existing.id;
    return v_response;
  end if;

  select * into strict v_subject from public.workflow_subjects
    where id=v_request.workflow_subject_id for update;
  select * into strict v_instance from public.workflow_instances
    where id=v_request.workflow_instance_id for update;
  perform 1 from public.workflow_step_assignments a
    where a.workflow_subject_id=v_request.workflow_subject_id order by a.id for update;

  -- Resolve every block before changing content. Any invalid approver aborts the edit.
  for v_block in
    select b.*, snapshot_block.value as snapshot
    from public.request_approval_blocks b
    join lateral jsonb_array_elements(coalesce(v_request.approval_config_snapshot->'blocks','[]'::jsonb)) snapshot_block(value)
      on snapshot_block.value->>'key'=b.block_key
    where b.request_template_version_id=v_request.request_template_version_id
    order by b.sort_order,b.block_key
  loop
    if v_block.approver_source='DYNAMIC_CREATOR_SELECT' then
      select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into v_dynamic_ids
      from jsonb_array_elements_text(coalesce(v_block.snapshot->'resolvedUserIds','[]'::jsonb)) value;
    else v_dynamic_ids := '{}'::uuid[]; end if;
    v_current_ids := app_private.resolve_request_block_approvers(v_block.id,v_actor,v_dynamic_ids);
    v_blocks := v_blocks || jsonb_build_array(
      jsonb_set(v_block.snapshot,'{resolvedUserIds}',to_jsonb(v_current_ids),true)
    );
  end loop;
  if jsonb_array_length(v_blocks)=0 then
    raise exception using errcode='22023', message='REQUEST_EDIT_APPROVER_INVALID';
  end if;

  update public.request_instances set
    title=v_title,description=v_description,form_data=v_form_data,
    content_revision=content_revision+1,
    approval_config_snapshot=jsonb_set(
      jsonb_set(approval_config_snapshot,'{blocks}',v_blocks,true),
      '{contentRevision}',to_jsonb(content_revision+1),true
    ),
    updated_at=now()
  where id=p_request_id returning * into v_request;
  insert into public.request_content_revisions(
    request_id,revision,title,description,form_data,change_kind,changed_by,command_key
  ) values(v_request.id,v_request.content_revision,v_title,v_description,v_form_data,
    'creator_edit',v_actor,p_idempotency_key);
  update public.workflow_instances set title=v_title,updated_at=now() where id=v_instance.id;

  if v_request.status='PENDING' then
    for v_cancelled_user in
      select distinct assignee_user_id from public.workflow_step_assignments
      where workflow_subject_id=v_subject.id and status='PENDING' and assignee_user_id is not null
    loop
      insert into app_private.request_notification_outbox(event_key,request_id,recipient_user_id,event_type,payload)
      values('request:'||v_request.id||':REVISION_CANCELLED:'||v_request.content_revision||':'||v_cancelled_user,
        v_request.id,v_cancelled_user,'REQUEST_APPROVAL_RESTARTED',
        jsonb_build_object('requestId',v_request.id,'requestCode',v_request.code,'contentRevision',v_request.content_revision))
      on conflict(event_key) do nothing;
    end loop;
    perform app_private.close_request_pending_assignments(v_request.id,'CANCELLED',null,null,'REQUEST_CONTENT_REVISED');
    v_round := gen_random_uuid();
    update public.request_instances set approval_config_snapshot=jsonb_set(
      approval_config_snapshot-'returnedBlockKey','{assignmentRoundId}',to_jsonb(v_round),true
    ) where id=v_request.id returning * into v_request;
    update public.workflow_subjects set status='RUNNING',current_assignee_user_id=null,
      current_assignee_user_ids='{}'::uuid[],updated_at=now() where id=v_subject.id;
    update public.workflow_instances set status='RUNNING'::public.workflow_instance_status,
      step_assignees='{}'::jsonb,updated_at=now() where id=v_instance.id;
    if v_request.approval_config_snapshot ? 'extraBlock' then
      perform app_private.activate_request_block(v_request.id,'__extra',v_round,v_actor);
    else
    select min(sort_order) into v_first_sort from public.request_approval_blocks
      where request_template_version_id=v_request.request_template_version_id;
    for v_block in select * from public.request_approval_blocks
      where request_template_version_id=v_request.request_template_version_id
        and ((v_request.approval_config_snapshot->>'flowMode')='PARALLEL' or sort_order=v_first_sort)
      order by sort_order,block_key
    loop perform app_private.activate_request_block(v_request.id,v_block.block_key,v_round,v_actor); end loop;
    end if;
    insert into public.workflow_instance_logs(instance_id,node_id,action,acted_by,comment)
      values(v_instance.id,coalesce(v_subject.current_node_id,v_instance.current_node_id),
        'REOPENED'::public.workflow_instance_action,v_actor,'REQUEST_CONTENT_REVISED');
  else
    select min(sort_order) into v_first_sort from public.request_approval_blocks
      where request_template_version_id=v_request.request_template_version_id;
    update public.request_instances r set approval_config_snapshot=jsonb_set(
      r.approval_config_snapshot,'{returnedBlockKey}',to_jsonb(case when r.approval_config_snapshot ? 'extraBlock'
        then '__extra' else (select block_key from public.request_approval_blocks
        where request_template_version_id=r.request_template_version_id and sort_order=v_first_sort
        order by block_key limit 1) end),true
    ) where r.id=v_request.id returning * into v_request;
  end if;

  select * into v_request from public.request_instances where id=p_request_id;
  v_response := jsonb_build_object(
    'requestId',v_request.id,'requestCode',v_request.code,'status',v_request.status,
    'workflowInstanceId',v_request.workflow_instance_id,'workflowSubjectId',v_request.workflow_subject_id,
    'currentBlockKeys',app_private.request_action_current_blocks(v_request.id),
    'updatedAt',v_request.updated_at,'contentRevision',v_request.content_revision
  );
  update app_private.request_command_idempotency set result=v_response where id=v_existing.id;
  return v_response;
exception when sqlstate '22023' then
  if sqlerrm like 'REQUEST_%' then raise; end if;
  raise exception using errcode='22023',message='REQUEST_EDIT_APPROVER_INVALID';
end $$;

create or replace function app_private.request_extra_block_payload(p_request_id uuid)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select case when not (r.approval_config_snapshot ? 'extraBlock') then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
    'key', '__extra',
    'name', coalesce(r.approval_config_snapshot #>> '{extraBlock,name}', 'Người duyệt thêm'),
    'sortOrder', -1,
    'status', 'NOT_ACTIVE',
    'slaHours', null,
    'completionPolicy', coalesce(r.approval_config_snapshot #>> '{extraBlock,completionPolicy}', 'ALL'),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id,
        'roundId', assignment.assignment_round_id,
        'approver', app_private.request_user_snapshot(assignment.assignee_user_id),
        'status', assignment.status,
        'actedAt', assignment.acted_at,
        'comment', assignment.action_comment
      ) order by assignment.assigned_at, assignment.id)
      from public.workflow_step_assignments assignment
      where assignment.workflow_subject_id = r.workflow_subject_id
        and assignment.metadata ->> 'requestBlockKey' = '__extra'
    ), '[]'::jsonb)
  )) end
  from public.request_instances r
  where r.id = p_request_id;
$function$;
revoke all on function app_private.request_extra_block_payload(uuid) from public, anon, authenticated;

-- 7. The extra step is shown first in the approval flow.
create or replace function app_private.request_detail_payload(p_request_id uuid, p_user_id uuid)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select case when base.payload is null then null else
    base.payload || jsonb_build_object(
      'contentRevision',r.content_revision,
      'currentRoundId',nullif(r.approval_config_snapshot->>'assignmentRoundId',''),
      'watchers',app_private.request_watchers_payload(r.id,p_user_id),
      'approvalBlocks',coalesce((
        select jsonb_agg(
          (block.value - 'status' - 'assignments') || jsonb_build_object(
            'status',case
              when exists(select 1 from jsonb_array_elements(coalesce(block.value->'assignments','[]')) a
                where a->>'roundId'=r.approval_config_snapshot->>'assignmentRoundId' and a->>'status'='PENDING') then 'ACTIVE'
              when exists(select 1 from jsonb_array_elements(coalesce(block.value->'assignments','[]')) a
                where a->>'roundId'=r.approval_config_snapshot->>'assignmentRoundId' and a->>'status'='RETURNED') then 'RETURNED'
              when exists(select 1 from jsonb_array_elements(coalesce(block.value->'assignments','[]')) a
                where a->>'roundId'=r.approval_config_snapshot->>'assignmentRoundId' and a->>'status' in ('APPROVED','REJECTED')) then 'COMPLETED'
              when exists(select 1 from jsonb_array_elements(coalesce(block.value->'assignments','[]')) a
                where a->>'roundId'=r.approval_config_snapshot->>'assignmentRoundId' and a->>'status' in ('CANCELLED','SKIPPED')) then 'CANCELLED'
              else 'NOT_ACTIVE' end,
            'assignments',coalesce((select jsonb_agg(
              assignment.value || jsonb_build_object(
                'contentRevision',coalesce((select (wa.metadata->>'contentRevision')::integer
                  from public.workflow_step_assignments wa where wa.id=(assignment.value->>'id')::uuid),1),
                'isCurrentRound',assignment.value->>'roundId'=r.approval_config_snapshot->>'assignmentRoundId'
              ) order by assignment.ordinality)
              from jsonb_array_elements(coalesce(block.value->'assignments','[]')) with ordinality assignment(value,ordinality)),'[]')
          ) order by block.ordinality
        ) from jsonb_array_elements(app_private.request_extra_block_payload(r.id)||coalesce(base.payload->'approvalBlocks','[]')) with ordinality block(value,ordinality)
      ),'[]'),
      'capabilities',(base.payload->'capabilities') || jsonb_build_object(
        'canEditContent',app_private.request_feature_enabled('content_edit')
          and r.created_by=p_user_id and r.status in ('PENDING','RETURNED')
          and exists(select 1 from public.users u where u.id=p_user_id and coalesce(u.is_active,true)
            and coalesce(u.account_status,'ACTIVE')='ACTIVE'),
        'canReadDiscussion',app_private.request_feature_enabled('discussion_read')
          and app_private.request_instance_can_select(r.id,p_user_id),
        'canComment',app_private.request_feature_enabled('discussion_write')
          and app_private.request_instance_can_select(r.id,p_user_id),
        'canAttach',app_private.request_feature_enabled('attachments')
          and app_private.request_instance_can_select(r.id,p_user_id),
        'canAddWatcher',true,
        'canDelete',r.created_by=p_user_id and (
          r.status='CANCELLED'
          or (r.status='PENDING' and not exists(
            select 1 from public.workflow_step_assignments acted
            where acted.workflow_subject_id=r.workflow_subject_id
              and acted.status in ('APPROVED','REJECTED','RETURNED')))
        ),
        'reassignableAssignmentIds',case when r.status<>'PENDING' then '[]'::jsonb else coalesce((
          select jsonb_agg(pending.id order by pending.assigned_at, pending.id)
          from public.workflow_step_assignments pending
          where pending.workflow_subject_id=r.workflow_subject_id
            and pending.status='PENDING'
            and (pending.assignee_user_id=p_user_id or app_private.request_action_is_admin(p_user_id))
        ),'[]'::jsonb) end
      ) || jsonb_build_object(
        'canReassign',r.status='PENDING' and exists(
          select 1 from public.workflow_step_assignments pending
          where pending.workflow_subject_id=r.workflow_subject_id
            and pending.status='PENDING'
            and (pending.assignee_user_id=p_user_id or app_private.request_action_is_admin(p_user_id)))
      )
    ) end
  from public.request_instances r
  cross join lateral (select app_private.request_detail_payload_base(p_request_id,p_user_id) payload) base
  where r.id=p_request_id;
$function$;

-- 8. Reassigning inside the extra step keeps its snapshot current.
create or replace function app_private.reassign_request_assignment(
  p_request_id uuid,
  p_assignment_id uuid,
  p_assignee_user_id uuid,
  p_comment text,
  p_idempotency_key text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'extensions'
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.request_instances%rowtype;
  v_assignment public.workflow_step_assignments%rowtype;
  v_existing app_private.request_command_idempotency%rowtype;
  v_payload_hash text;
  v_block_key text;
  v_block_user_ids uuid[];
  v_all_user_ids uuid[];
  v_old_name text;
  v_new_name text;
  v_result jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.users app_user
    where app_user.id = v_actor
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  ) then
    raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  if nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_REASSIGN_REASON_REQUIRED';
  end if;

  v_payload_hash := encode(digest(jsonb_build_object(
    'requestId', p_request_id, 'assignmentId', p_assignment_id,
    'assigneeUserId', p_assignee_user_id, 'comment', p_comment,
    'expectedUpdatedAt', p_expected_updated_at
  )::text, 'sha256'), 'hex');
  insert into app_private.request_command_idempotency(
    actor_id, idempotency_key, command_name, request_id, payload_hash
  ) values (v_actor, p_idempotency_key, 'reassign_request_assignment', p_request_id, v_payload_hash)
  on conflict (actor_id, idempotency_key) do nothing;
  select * into v_existing
  from app_private.request_command_idempotency
  where actor_id = v_actor and idempotency_key = p_idempotency_key
  for update;
  if v_existing.command_name <> 'reassign_request_assignment' or v_existing.payload_hash <> v_payload_hash then
    raise exception using errcode = 'P0001', message = 'REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.result is not null then
    return v_existing.result;
  end if;

  -- Lock order: request -> assignments (same as act_on_request).
  select * into v_request from public.request_instances
  where id = p_request_id and deleted_at is null
  for update;
  if not found or not app_private.request_instance_can_select(p_request_id, v_actor) then
    raise exception using errcode = 'P0001', message = 'REQUEST_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if p_expected_updated_at is null or v_request.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'REQUEST_STALE_STATE';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception using errcode = 'P0001', message = 'REQUEST_ALREADY_PROCESSED';
  end if;
  perform 1 from public.workflow_step_assignments assignment
  where assignment.workflow_subject_id = v_request.workflow_subject_id
  order by assignment.id
  for update;

  select * into v_assignment
  from public.workflow_step_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.workflow_subject_id = v_request.workflow_subject_id;
  if not found or v_assignment.status <> 'PENDING' then
    raise exception using errcode = 'P0001', message = 'REQUEST_ASSIGNMENT_NOT_ACTIVE';
  end if;
  if v_assignment.assignee_user_id <> v_actor
     and not app_private.request_action_is_admin(v_actor) then
    raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
  end if;

  if p_assignee_user_id is null or not exists (
    select 1 from public.users app_user
    where app_user.id = p_assignee_user_id
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  ) then
    raise exception using errcode = 'P0001', message = 'REQUEST_APPROVER_INACTIVE';
  end if;
  if p_assignee_user_id = v_request.created_by then
    raise exception using errcode = 'P0001', message = 'REQUEST_APPROVER_SELF_NOT_ALLOWED';
  end if;
  v_block_key := v_assignment.metadata ->> 'requestBlockKey';
  if p_assignee_user_id = v_assignment.assignee_user_id or exists (
    select 1 from public.workflow_step_assignments sibling
    where sibling.workflow_subject_id = v_request.workflow_subject_id
      and sibling.assignment_round_id = v_assignment.assignment_round_id
      and sibling.metadata ->> 'requestBlockKey' = v_block_key
      and sibling.assignee_user_id = p_assignee_user_id
      and sibling.status = 'PENDING'
  ) then
    raise exception using errcode = 'P0001', message = 'REQUEST_REASSIGN_TARGET_DUPLICATE';
  end if;

  -- Insert first: the lifecycle guard accepts the actor while their own
  -- assignment is still PENDING.
  insert into public.workflow_step_assignments(
    workflow_subject_id, workflow_instance_id, node_id, instance_node_id,
    assignee_user_id, assigned_by, status, assigned_at, due_at, sla_hours,
    assignment_source, assignment_group_type, assignment_group_id,
    assignment_round_id, metadata
  ) values (
    v_assignment.workflow_subject_id, v_assignment.workflow_instance_id,
    v_assignment.node_id, v_assignment.instance_node_id, p_assignee_user_id,
    v_actor, 'PENDING', now(), v_assignment.due_at, v_assignment.sla_hours,
    v_assignment.assignment_source, v_assignment.assignment_group_type,
    v_assignment.assignment_group_id, v_assignment.assignment_round_id,
    coalesce(v_assignment.metadata, '{}'::jsonb)
      || jsonb_build_object('reassignedFrom', v_assignment.assignee_user_id)
  );
  update public.workflow_step_assignments
  set status = 'CANCELLED', acted_at = now(), action_comment = p_comment
  where id = v_assignment.id;

  select coalesce(array_agg(assignment.assignee_user_id order by assignment.assigned_at, assignment.id), '{}'::uuid[])
    into v_block_user_ids
  from public.workflow_step_assignments assignment
  where assignment.workflow_subject_id = v_assignment.workflow_subject_id
    and assignment.assignment_round_id = v_assignment.assignment_round_id
    and assignment.metadata ->> 'requestBlockKey' = v_block_key
    and assignment.status = 'PENDING';
  select coalesce(array_agg(assignment.assignee_user_id order by assignment.assigned_at, assignment.id), '{}'::uuid[])
    into v_all_user_ids
  from public.workflow_step_assignments assignment
  where assignment.workflow_subject_id = v_assignment.workflow_subject_id
    and assignment.assignment_round_id = v_assignment.assignment_round_id
    and assignment.status = 'PENDING';

  update public.workflow_subjects
  set current_assignee_user_id = v_all_user_ids[1],
      current_assignee_user_ids = v_all_user_ids,
      updated_at = now()
  where id = v_assignment.workflow_subject_id;
  update public.workflow_instances
  set step_assignees = coalesce(step_assignees, '{}'::jsonb)
        || jsonb_build_object(v_assignment.node_id::text, to_jsonb(v_block_user_ids)),
      updated_at = now()
  where id = v_assignment.workflow_instance_id;
  update public.request_instances request_instance
  set approval_config_snapshot = jsonb_set(
    coalesce(request_instance.approval_config_snapshot, '{}'::jsonb),
    '{blocks}',
    coalesce((
      select jsonb_agg(
        case when block ->> 'key' = v_block_key
          then jsonb_set(block, '{resolvedUserIds}', to_jsonb(v_block_user_ids), true)
          else block end
        order by block_order
      )
      from jsonb_array_elements(
        coalesce(request_instance.approval_config_snapshot -> 'blocks', '[]'::jsonb)
      ) with ordinality as block_items(block, block_order)
    ), '[]'::jsonb),
    true
  ), updated_at = now()
  where request_instance.id = p_request_id;
  if v_block_key = '__extra' then
    update public.request_instances
    set approval_config_snapshot = jsonb_set(
      approval_config_snapshot, '{extraBlock,resolvedUserIds}', to_jsonb(v_block_user_ids), true
    )
    where id = p_request_id;
  end if;

  perform app_private.project_workflow_register_participant(
    v_assignment.workflow_subject_id, v_assignment.workflow_instance_id,
    p_assignee_user_id, 'ASSIGNEE', 'request_reassign', v_block_key,
    v_assignment.node_id, v_assignment.instance_node_id, v_actor
  );

  select coalesce(nullif(name, ''), username, email) into v_old_name
  from public.users where id = v_assignment.assignee_user_id;
  select coalesce(nullif(name, ''), username, email) into v_new_name
  from public.users where id = p_assignee_user_id;
  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (
    v_assignment.workflow_instance_id, v_assignment.node_id,
    'REASSIGNED'::public.workflow_instance_action, v_actor,
    coalesce(v_old_name, '?') || ' → ' || coalesce(v_new_name, '?') || ': ' || trim(p_comment)
  );

  insert into app_private.request_notification_outbox(
    event_key, request_id, recipient_user_id, event_type, payload
  ) values (
    'request:' || p_request_id::text || ':REASSIGN:' || p_assignee_user_id::text || ':' || p_idempotency_key,
    p_request_id, p_assignee_user_id, 'REQUEST_APPROVAL_REQUIRED',
    jsonb_build_object('requestId', p_request_id, 'requestCode', v_request.code,
      'blockKey', v_block_key, 'reassigned', true)
  ), (
    'request:' || p_request_id::text || ':ACTION:REASSIGN:' || p_idempotency_key,
    p_request_id, v_request.created_by, 'REQUEST_REASSIGNED',
    jsonb_build_object('requestId', p_request_id, 'requestCode', v_request.code,
      'comment', p_comment)
  ) on conflict (event_key) do nothing;

  select * into v_request from public.request_instances where id = p_request_id;
  v_result := jsonb_build_object(
    'requestId', v_request.id,
    'requestCode', v_request.code,
    'status', v_request.status,
    'workflowInstanceId', v_request.workflow_instance_id,
    'workflowSubjectId', v_request.workflow_subject_id,
    'currentBlockKeys', app_private.request_action_current_blocks(p_request_id),
    'updatedAt', v_request.updated_at
  );
  update app_private.request_command_idempotency set result = v_result where id = v_existing.id;
  return v_result;
end;
$function$;

revoke all on function app_private.activate_request_template_start(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.activate_request_extra_block(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) from public, anon;
grant execute on function app_private.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) to authenticated;
revoke all on function public.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) from public, anon;
grant execute on function public.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) to authenticated;

-- Request approval actions.  All state transitions are private, transaction
-- local commands; the public RPC is an invoker-only boundary.

alter type public.workflow_instance_action add value if not exists 'REASSIGNED';

create or replace function app_private.request_action_is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('WF')
    or app_private.request_user_can_manage(p_user_id);
$$;

create or replace function app_private.request_action_current_blocks(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(block_key order by min_sort, block_key), '[]'::jsonb)
  from (
    select assignment.metadata ->> 'requestBlockKey' as block_key,
           min(assignment.assigned_at) as min_sort
    from public.workflow_step_assignments assignment
    join public.request_instances request_instance
      on request_instance.workflow_subject_id = assignment.workflow_subject_id
    where request_instance.id = p_request_id
      and assignment.status = 'PENDING'
      and assignment.metadata ->> 'requestBlockKey' is not null
    group by assignment.metadata ->> 'requestBlockKey'
  ) active_blocks;
$$;

create or replace function app_private.close_request_pending_assignments(
  p_request_id uuid,
  p_status text,
  p_round_id uuid default null,
  p_block_key text default null,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workflow_step_assignments assignment
  set status = p_status,
      acted_at = now(),
      action_comment = coalesce(p_comment, action_comment)
  where assignment.workflow_subject_id = (
      select request_instance.workflow_subject_id
      from public.request_instances request_instance
      where request_instance.id = p_request_id
    )
    and assignment.status = 'PENDING'
    and (p_round_id is null or assignment.assignment_round_id = p_round_id)
    and (
      p_block_key is null
      or assignment.metadata ->> 'requestBlockKey' = p_block_key
    );
end;
$$;

create or replace function app_private.activate_request_block(
  p_request_id uuid,
  p_block_key text,
  p_round_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function app_private.act_on_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null,
  p_form_data jsonb default null,
  p_assignee_user_id uuid default null,
  p_idempotency_key text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.act_on_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null,
  p_form_data jsonb default null,
  p_assignee_user_id uuid default null,
  p_idempotency_key text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.act_on_request(
    p_request_id, p_action, p_comment, p_form_data, p_assignee_user_id,
    p_idempotency_key, p_expected_updated_at
  );
$$;

revoke all on function app_private.request_action_is_admin(uuid) from public, anon, authenticated;
revoke all on function app_private.request_action_current_blocks(uuid) from public, anon, authenticated;
revoke all on function app_private.close_request_pending_assignments(uuid, text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function app_private.activate_request_block(uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.act_on_request(uuid, text, text, jsonb, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.act_on_request(uuid, text, text, jsonb, uuid, text, timestamptz)
  from public, anon;
grant execute on function public.act_on_request(uuid, text, text, jsonb, uuid, text, timestamptz)
  to authenticated;

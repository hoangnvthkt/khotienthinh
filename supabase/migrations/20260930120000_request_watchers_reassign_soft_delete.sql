-- Request module phase 2: manual watchers, approver-initiated reassignment
-- and creator soft delete.
--
-- Product rules (2026-09-30):
-- * Anyone who can open a request may add watchers; manual watchers may be
--   removed by themselves, the creator or a request admin.
-- * The approver holding a PENDING assignment may hand it to someone else
--   (reason required); request admins may reassign any PENDING assignment.
-- * The creator may delete a request while no approver has acted on it, or
--   once it is cancelled. Delete is soft: the row stays for audit, the code
--   is never reused, and the request disappears for everyone.

alter table public.request_instances
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id) on delete set null;

create index if not exists idx_request_instances_live
  on public.request_instances (created_at desc, id desc)
  where deleted_at is null;

-- Deleted requests are invisible to everyone, including admins.
create or replace function app_private.request_instance_can_select(p_request_instance_id uuid, p_user_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.users app_user
    where app_user.id = p_user_id
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  )
  and exists (
    select 1
    from public.request_instances live_request
    where live_request.id = p_request_instance_id
      and live_request.deleted_at is null
  )
  and (
    app_private.request_user_can_manage(p_user_id)
    or exists (
      select 1
      from public.request_instances request_instance
      where request_instance.id = p_request_instance_id
        and (
          request_instance.created_by = p_user_id
          or exists (
            select 1
            from public.workflow_participants participant
            where participant.workflow_subject_id =
              request_instance.workflow_subject_id
              and participant.user_id = p_user_id
              and participant.role in ('ASSIGNEE', 'WATCHER')
          )
          or exists (
            select 1
            from public.workflow_step_assignments assignment
            where assignment.workflow_subject_id =
              request_instance.workflow_subject_id
              and assignment.assignee_user_id = p_user_id
          )
          or exists (
            select 1
            from public.request_template_watchers watcher
            where watcher.request_template_version_id =
              request_instance.request_template_version_id
              and watcher.user_id = p_user_id
          )
          or (
            request_instance.workflow_subject_id is null
            and request_instance.request_template_version_id is null
            and (
              request_instance.assigned_to::text = p_user_id::text
              or request_instance.approver_id::text = p_user_id::text
              or exists (
                select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(request_instance.approvers) = 'array'
                    then request_instance.approvers
                    else '[]'::jsonb
                  end
                ) legacy_approver
                where legacy_approver ->> 'userId' = p_user_id::text
              )
            )
          )
        )
    )
  );
$function$;

-- Holders of a PENDING assignment may reassign their own share.
create or replace function app_private.request_actor_has_lifecycle_action(p_request_id uuid, p_actor_id uuid, p_action text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select p_actor_id is not null
    and exists (
      select 1
      from public.users actor
      where actor.id = p_actor_id
        and actor.is_active
        and actor.account_status = 'ACTIVE'
    )
    and exists (
      select 1
      from public.request_instances request_row
      where request_row.id = p_request_id
        and case upper(p_action)
          when 'APPROVE' then
            app_private.has_permission(p_actor_id,'request.instance.approve_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','global','*')
            or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
          when 'REJECT' then
            app_private.has_permission(p_actor_id,'request.instance.reject_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','global','*')
            or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
          when 'RETURN' then
            app_private.has_permission(p_actor_id,'request.instance.return_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','assigned',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.act_assigned','global','*')
            or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
          when 'RESUBMIT' then request_row.created_by = p_actor_id and (
            app_private.has_permission(p_actor_id,'request.instance.resubmit_own','own',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.create','global','*')
            or app_private.has_permission(p_actor_id,'request.instance.view_own','global','*')
            or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
          )
          when 'EDIT_CONTENT' then request_row.created_by = p_actor_id and (
            app_private.has_permission(p_actor_id,'request.instance.edit_own_content','own',p_actor_id::text)
            or app_private.has_permission(p_actor_id,'request.instance.create','global','*')
            or app_private.has_permission(p_actor_id,'request.instance.view_own','global','*')
            or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
          )
          when 'CANCEL' then
            (
              request_row.created_by = p_actor_id and (
                app_private.has_permission(p_actor_id,'request.instance.cancel','own',p_actor_id::text)
                or app_private.has_permission(p_actor_id,'request.instance.create','global','*')
                or app_private.has_permission(p_actor_id,'request.instance.view_own','global','*')
                or app_private.has_permission(p_actor_id,'system.rq.view','global','*')
              )
            )
            or app_private.has_permission(p_actor_id,'request.instance.cancel','global','*')
            or app_private.request_action_is_admin(p_actor_id)
          when 'REASSIGN' then
            app_private.has_permission(p_actor_id,'request.instance.reassign','global','*')
            or app_private.request_action_is_admin(p_actor_id)
            or exists (
              select 1
              from public.workflow_step_assignments own_assignment
              where own_assignment.workflow_subject_id = request_row.workflow_subject_id
                and own_assignment.assignee_user_id = p_actor_id
                and own_assignment.status = 'PENDING'
            )
          else false
        end
    );
$function$;

create or replace function app_private.request_watchers_payload(p_request_id uuid, p_user_id uuid)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(jsonb_agg(
    app_private.request_user_snapshot(watcher.user_id) || jsonb_build_object(
      'source', case when watcher.is_manual then 'MANUAL' else 'TEMPLATE' end,
      'canRemove', watcher.is_manual and (
        watcher.user_id = p_user_id
        or r.created_by = p_user_id
        or app_private.request_action_is_admin(p_user_id)
      )
    ) order by watcher.is_manual, watcher.user_id
  ), '[]'::jsonb)
  from public.request_instances r
  cross join lateral (
    select participant.user_id,
           bool_and(participant.source = 'request_manual') as is_manual
    from public.workflow_participants participant
    where participant.workflow_subject_id = r.workflow_subject_id
      and participant.role = 'WATCHER'
      and coalesce(participant.is_active, true)
    group by participant.user_id
  ) watcher
  where r.id = p_request_id;
$function$;

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
        ) from jsonb_array_elements(coalesce(base.payload->'approvalBlocks','[]')) with ordinality block(value,ordinality)
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

create or replace function app_private.add_request_watchers(p_request_id uuid, p_user_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.request_instances%rowtype;
  v_user_id uuid;
begin
  if v_actor is null or not app_private.request_instance_can_select(p_request_id, v_actor) then
    raise exception using errcode = 'P0001', message = 'REQUEST_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if p_user_ids is null or cardinality(p_user_ids) = 0 or cardinality(p_user_ids) > 50 then
    raise exception using errcode = '22023', message = 'REQUEST_WATCHER_INVALID';
  end if;
  select * into v_request from public.request_instances where id = p_request_id for update;

  foreach v_user_id in array (select array_agg(distinct id) from unnest(p_user_ids) id) loop
    if v_user_id is null or v_user_id = v_request.created_by then
      continue;
    end if;
    if not exists (
      select 1 from public.users app_user
      where app_user.id = v_user_id
        and coalesce(app_user.is_active, true)
        and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    ) then
      raise exception using errcode = '22023', message = 'REQUEST_WATCHER_INVALID';
    end if;
    if exists (
      select 1 from public.workflow_participants participant
      where participant.workflow_subject_id = v_request.workflow_subject_id
        and participant.user_id = v_user_id
        and participant.role = 'WATCHER'
        and coalesce(participant.is_active, true)
    ) then
      continue;
    end if;
    perform app_private.project_workflow_register_participant(
      v_request.workflow_subject_id, v_request.workflow_instance_id, v_user_id,
      'WATCHER', 'request_manual', v_actor::text, null, null, v_actor
    );
    insert into app_private.request_notification_outbox(
      event_key, request_id, recipient_user_id, event_type, payload
    ) values (
      'request:' || p_request_id::text || ':WATCHER:' || v_user_id::text || ':' || now()::text,
      p_request_id, v_user_id, 'REQUEST_WATCHER_ADDED',
      jsonb_build_object('requestId', p_request_id, 'requestCode', v_request.code, 'addedBy', v_actor)
    ) on conflict (event_key) do nothing;
  end loop;

  return jsonb_build_object('watchers', app_private.request_watchers_payload(p_request_id, v_actor));
end;
$function$;

create or replace function app_private.remove_request_watcher(p_request_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.request_instances%rowtype;
begin
  if v_actor is null or not app_private.request_instance_can_select(p_request_id, v_actor) then
    raise exception using errcode = 'P0001', message = 'REQUEST_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select * into v_request from public.request_instances where id = p_request_id for update;
  if not (p_user_id = v_actor or v_request.created_by = v_actor or app_private.request_action_is_admin(v_actor)) then
    raise exception using errcode = 'P0001', message = 'REQUEST_ACTION_FORBIDDEN';
  end if;
  -- Template watchers are part of the approved template and stay.
  update public.workflow_participants
  set is_active = false
  where workflow_subject_id = v_request.workflow_subject_id
    and user_id = p_user_id
    and role = 'WATCHER'
    and source = 'request_manual'
    and coalesce(is_active, true);
  return jsonb_build_object('watchers', app_private.request_watchers_payload(p_request_id, v_actor));
end;
$function$;

create or replace function app_private.delete_request(p_request_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.request_instances%rowtype;
  v_user_id uuid;
begin
  select * into v_request from public.request_instances
  where id = p_request_id and deleted_at is null
  for update;
  if not found or v_actor is null or v_request.created_by <> v_actor
     or not app_private.request_instance_can_select(p_request_id, v_actor) then
    raise exception using errcode = 'P0001', message = 'REQUEST_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if p_expected_updated_at is null or v_request.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'REQUEST_STALE_STATE';
  end if;
  if not (
    v_request.status = 'CANCELLED'
    or (v_request.status = 'PENDING' and not exists (
      select 1 from public.workflow_step_assignments acted
      where acted.workflow_subject_id = v_request.workflow_subject_id
        and acted.status in ('APPROVED', 'REJECTED', 'RETURNED')
    ))
  ) then
    raise exception using errcode = 'P0001', message = 'REQUEST_DELETE_LOCKED';
  end if;

  if v_request.status = 'PENDING' then
    for v_user_id in
      select distinct assignment.assignee_user_id
      from public.workflow_step_assignments assignment
      where assignment.workflow_subject_id = v_request.workflow_subject_id
        and assignment.status = 'PENDING'
    loop
      insert into app_private.request_notification_outbox(
        event_key, request_id, recipient_user_id, event_type, payload
      ) values (
        'request:' || p_request_id::text || ':DELETED:' || v_user_id::text,
        p_request_id, v_user_id, 'REQUEST_APPROVAL_RESTARTED',
        jsonb_build_object('requestId', p_request_id, 'requestCode', v_request.code, 'deleted', true)
      ) on conflict (event_key) do nothing;
    end loop;
    perform app_private.close_request_pending_assignments(p_request_id, 'CANCELLED', null, null, 'Đề xuất đã bị xóa');
    update public.workflow_subjects set status = 'CANCELLED', updated_at = now()
    where id = v_request.workflow_subject_id;
    update public.workflow_instances set status = 'CANCELLED'::public.workflow_instance_status, updated_at = now()
    where id = v_request.workflow_instance_id;
    update public.request_instances
    set status = 'CANCELLED', completed_at = now()
    where id = p_request_id;
  end if;

  update public.request_instances
  set deleted_at = now(), deleted_by = v_actor, updated_at = now()
  where id = p_request_id;
  return jsonb_build_object('requestId', p_request_id, 'requestCode', v_request.code, 'deleted', true);
end;
$function$;

-- Delivery title for the new watcher event.
create or replace function app_private.deliver_request_notification(p_outbox_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_outbox app_private.request_notification_outbox%rowtype; v_request public.request_instances%rowtype;
  v_notification_id uuid; v_allowed boolean; v_link text; v_title text; v_message text;
begin
  perform app_private.require_request_notification_worker();
  select * into v_outbox from app_private.request_notification_outbox where id=p_outbox_id for update;
  if not found or v_outbox.status='DELIVERED' then return jsonb_build_object('delivered',false);end if;
  if v_outbox.status<>'PROCESSING' then raise exception using errcode='P0001',message='REQUEST_NOTIFICATION_NOT_CLAIMED';end if;
  select * into v_request from public.request_instances where id=v_outbox.request_id;
  if not found then raise exception using errcode='P0001',message='REQUEST_NOTIFICATION_REQUEST_MISSING';end if;
  v_allowed:=app_private.request_instance_can_select(v_request.id,v_outbox.recipient_user_id);
  if not v_allowed and v_outbox.event_type<>'REQUEST_APPROVAL_RESTARTED' then
    update app_private.request_notification_outbox set status='DELIVERED',delivered_at=now(),locked_at=null,last_error=null where id=v_outbox.id;
    return jsonb_build_object('delivered',false,'suppressed','permission');
  end if;
  v_title:=case v_outbox.event_type when 'REQUEST_COMMENT_MENTIONED' then 'Bạn được nhắc trong thảo luận'
    when 'REQUEST_COMMENT_CREATED' then 'Đề xuất có thảo luận mới'
    when 'REQUEST_APPROVAL_RESTARTED' then 'Nhiệm vụ duyệt đã được cập nhật'
    when 'REQUEST_SUBMITTED' then 'Đề xuất mới cần duyệt' when 'REQUEST_APPROVAL_REQUIRED' then 'Bạn có đề xuất cần duyệt'
    when 'REQUEST_REASSIGNED' then 'Đề xuất được chuyển người duyệt' when 'REQUEST_RETURNED' then 'Đề xuất đã được trả lại'
    when 'REQUEST_APPROVED' then 'Đề xuất đã được chấp thuận' when 'REQUEST_REJECTED' then 'Đề xuất đã bị từ chối'
    when 'REQUEST_WATCHER_ADDED' then 'Bạn được thêm theo dõi đề xuất'
    else 'Cập nhật đề xuất' end;
  v_link:=case when v_allowed then coalesce(v_outbox.payload->>'route','/rq/'||v_request.id) else '/rq' end;
  v_message:=case when v_allowed then v_request.code||' · '||v_request.title else 'Nhiệm vụ duyệt trước đó đã kết thúc.' end;
  insert into public.notifications(user_id,type,category,title,message,link,severity,source_type,source_id,priority,push_enabled,action_url,entity_type,entity_id,metadata)
  values(v_outbox.recipient_user_id,'info','request',v_title,v_message,v_link,'info','request_instance',v_request.id::text,
    case when v_outbox.event_type in ('REQUEST_COMMENT_MENTIONED','REQUEST_APPROVAL_REQUIRED') then 'high' else 'normal' end,
    true,v_link,'request_instance',v_request.id,jsonb_build_object('requestInstanceId',v_request.id,'requestCode',case when v_allowed then v_request.code end,
      'eventType',v_outbox.event_type,'eventKey',v_outbox.event_key,'commentId',v_outbox.payload->>'commentId')) returning id into v_notification_id;
  update app_private.request_notification_outbox set status='DELIVERED',delivered_at=now(),locked_at=null,last_error=null where id=v_outbox.id;
  return jsonb_build_object('delivered',true,'notificationId',v_notification_id);
end $function$;

create or replace function public.reassign_request_assignment(
  p_request_id uuid, p_assignment_id uuid, p_assignee_user_id uuid,
  p_comment text, p_idempotency_key text, p_expected_updated_at timestamptz
)
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.reassign_request_assignment(
    p_request_id, p_assignment_id, p_assignee_user_id,
    p_comment, p_idempotency_key, p_expected_updated_at
  );
$function$;

create or replace function public.add_request_watchers(p_request_id uuid, p_user_ids uuid[])
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.add_request_watchers(p_request_id, p_user_ids);
$function$;

create or replace function public.remove_request_watcher(p_request_id uuid, p_user_id uuid)
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.remove_request_watcher(p_request_id, p_user_id);
$function$;

create or replace function public.delete_request(p_request_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.delete_request(p_request_id, p_expected_updated_at);
$function$;

revoke all on function app_private.request_watchers_payload(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.reassign_request_assignment(uuid, uuid, uuid, text, text, timestamptz) from public, anon;
revoke all on function app_private.add_request_watchers(uuid, uuid[]) from public, anon;
revoke all on function app_private.remove_request_watcher(uuid, uuid) from public, anon;
revoke all on function app_private.delete_request(uuid, timestamptz) from public, anon;
grant execute on function app_private.reassign_request_assignment(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function app_private.add_request_watchers(uuid, uuid[]) to authenticated;
grant execute on function app_private.remove_request_watcher(uuid, uuid) to authenticated;
grant execute on function app_private.delete_request(uuid, timestamptz) to authenticated;

revoke all on function public.reassign_request_assignment(uuid, uuid, uuid, text, text, timestamptz) from public, anon;
revoke all on function public.add_request_watchers(uuid, uuid[]) from public, anon;
revoke all on function public.remove_request_watcher(uuid, uuid) from public, anon;
revoke all on function public.delete_request(uuid, timestamptz) from public, anon;
grant execute on function public.reassign_request_assignment(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.add_request_watchers(uuid, uuid[]) to authenticated;
grant execute on function public.remove_request_watcher(uuid, uuid) to authenticated;
grant execute on function public.delete_request(uuid, timestamptz) to authenticated;

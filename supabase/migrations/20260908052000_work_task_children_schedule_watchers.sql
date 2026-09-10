-- Pilot feedback: one-level child tasks, planned schedules and watcher controls.
-- Notification delivery remains governed by the existing disabled pilot flag.

alter table public.work_tasks
  add column parent_task_id uuid references public.work_tasks(id) on delete restrict,
  add column planned_start_at timestamptz;

alter table public.work_tasks
  add constraint work_tasks_not_own_parent
    check (parent_task_id is distinct from id),
  add constraint work_tasks_planned_range_check
    check (planned_start_at is null or deadline_at is null or planned_start_at <= deadline_at);

create index work_tasks_parent_active_idx
  on public.work_tasks(parent_task_id, updated_at desc, id desc)
  where parent_task_id is not null;

create or replace function app_private.work_validate_task_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.work_tasks%rowtype;
begin
  if tg_op = 'UPDATE' and new.parent_task_id is distinct from old.parent_task_id then
    raise exception 'WORK_TASK_PARENT_IMMUTABLE' using errcode = '23514';
  end if;
  if new.parent_task_id is null then
    if tg_op = 'UPDATE' and exists(
      select 1 from public.work_tasks child
      where child.parent_task_id = new.id and (
        child.workspace_id is distinct from new.workspace_id
        or child.scope_type is distinct from new.scope_type
        or child.department_id is distinct from new.department_id
        or child.project_id is distinct from new.project_id
        or child.privacy is distinct from new.privacy
      )
    ) then
      raise exception 'WORK_PARENT_HAS_CHILDREN_BOUNDARY' using errcode = '23514';
    end if;
    return new;
  end if;
  select * into v_parent
  from public.work_tasks
  where id = new.parent_task_id
  for key share;
  if v_parent.id is null then
    raise exception 'WORK_PARENT_TASK_NOT_FOUND' using errcode = '23503';
  end if;
  if v_parent.parent_task_id is not null then
    raise exception 'WORK_TASK_MAX_DEPTH' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and v_parent.status in ('completed', 'cancelled') then
    raise exception 'WORK_PARENT_TASK_CLOSED' using errcode = '23514';
  end if;
  if new.workspace_id is distinct from v_parent.workspace_id
    or new.scope_type is distinct from v_parent.scope_type
    or new.department_id is distinct from v_parent.department_id
    or new.project_id is distinct from v_parent.project_id
    or new.privacy is distinct from v_parent.privacy then
    raise exception 'WORK_TASK_PARENT_BOUNDARY_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app_private.work_validate_task_parent() from public, anon, authenticated;
create trigger work_tasks_validate_parent
before insert or update of parent_task_id, workspace_id, scope_type, department_id, project_id, privacy
on public.work_tasks
for each row execute function app_private.work_validate_task_parent();

create or replace function app_private.work_task_child_aggregate(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'visibleTotal', count(*) filter (where child.status <> 'cancelled'),
    'visibleCompleted', count(*) filter (where child.status = 'completed'),
    'visibleOpen', count(*) filter (where child.status not in ('completed', 'cancelled')),
    'visibleCancelled', count(*) filter (where child.status = 'cancelled')
  )
  from public.work_tasks child
  where child.parent_task_id = p_task_id
    and app_private.work_task_actor_can_view(child.id)
$$;
revoke all on function app_private.work_task_child_aggregate(uuid) from public, anon, authenticated;

create or replace function app_private.work_list_task_children(
  p_task_id uuid,
  p_cursor jsonb,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := least(100, greatest(1, coalesce(p_limit, 30)));
  v_at timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if not exists(select 1 from public.work_tasks where id = p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object'
      or p_cursor - array['sortAt', 'id'] <> '{}'::jsonb
      or p_cursor->>'sortAt' is null
      or p_cursor->>'id' is null then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end if;
    begin
      v_at := (p_cursor->>'sortAt')::timestamptz;
      v_id := (p_cursor->>'id')::uuid;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end;
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc, q.id desc), '[]'::jsonb)
  into v_rows
  from (
    select child.id, child.task_code, child.title, child.status, child.priority,
      child.privacy, child.planned_start_at, child.deadline_at, child.parent_task_id,
      child.lock_version, child.updated_at,
      coalesce((
        select jsonb_agg(u.name order by u.name, u.id)
        from public.work_task_assignments assignment_row
        join public.users u on u.id = assignment_row.user_id
        where assignment_row.task_id = child.id
          and assignment_row.ended_at is null
      ), '[]'::jsonb) as assignee_names,
      (select count(*)::integer
       from public.work_task_attachments attachment_row
       where attachment_row.task_id = child.id
         and attachment_row.status = 'ready'
         and attachment_row.deleted_at is null) as attachment_count
    from public.work_tasks child
    where child.parent_task_id = p_task_id
      and app_private.work_task_actor_can_view(child.id)
      and (v_at is null or (child.updated_at, child.id) < (v_at, v_id))
    order by child.updated_at desc, child.id desc
    limit v_n + 1
  ) q;
  return jsonb_build_object(
    'items', (
      select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
      from jsonb_array_elements(v_rows) with ordinality
      where ordinality <= v_n
    ),
    'aggregate', app_private.work_task_child_aggregate(p_task_id),
    'nextCursor', case when jsonb_array_length(v_rows) > v_n then
      jsonb_build_object(
        'sortAt', v_rows->(v_n - 1)->'updated_at',
        'id', v_rows->(v_n - 1)->'id'
      )
    else null end
  );
end;
$$;
revoke all on function app_private.work_list_task_children(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function app_private.work_list_task_children(uuid, jsonb, integer) to authenticated;

create or replace function public.list_work_task_children(
  p_task_id uuid,
  p_cursor jsonb default null,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.work_list_task_children(p_task_id, p_cursor, p_limit);
$$;
revoke all on function public.list_work_task_children(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.list_work_task_children(uuid, jsonb, integer) to authenticated;

create or replace function app_private.work_task_capabilities(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_task public.work_tasks%rowtype;
  v_assignment public.work_task_assignments%rowtype;
  v_active boolean;
  v_accepted boolean;
  v_assignable boolean;
  v_manager boolean;
  v_scope record;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select * into strict v_task from public.work_tasks where id = p_task_id;
  select * into v_assignment from public.work_task_assignments
    where task_id = p_task_id and user_id = v_actor and ended_at is null;
  select * into strict v_scope from app_private.work_task_permission_scope(p_task_id);
  v_active := v_task.status not in ('completed', 'cancelled')
    and (v_scope.workspace_id is null or v_scope.workspace_status = 'active');
  v_accepted := v_assignment.id is not null and v_assignment.acknowledged_at is not null;
  v_assignable := app_private.has_permission(v_actor, 'work.task.assign_user', v_scope.scope_type, v_scope.scope_id);
  v_manager := app_private.has_permission(v_actor, 'work.task.manage_scope', v_scope.scope_type, v_scope.scope_id);
  return app_private.work_task_read_capabilities(p_task_id) || jsonb_build_object(
    'canAcknowledge', v_active and v_assignment.id is not null and v_assignment.acknowledged_at is null,
    'canRequestClarification', v_active and v_assignment.id is not null and v_assignment.acknowledged_at is null,
    'canStart', v_active and v_accepted and v_task.status in ('not_started', 'changes_requested'),
    'canBlock', v_active and v_accepted and v_task.status = 'in_progress',
    'canUnblock', v_active and v_accepted and v_task.status = 'blocked',
    'canSubmit', v_active and v_accepted and v_task.status in ('in_progress', 'changes_requested'),
    'canReview', v_active and v_task.status = 'awaiting_review' and v_task.reviewer_user_id = v_actor and (
      app_private.has_permission(v_actor, 'work.task.review', 'assigned', '*')
      or app_private.has_permission(v_actor, 'work.task.review', v_scope.scope_type, v_scope.scope_id)
    ),
    'canCancel', v_active and (v_task.created_by = v_actor or v_manager),
    'canTransfer', v_active and v_assignment.id is not null and v_assignable,
    'canAddAssignees', v_active and (v_task.created_by = v_actor or v_accepted or v_manager) and v_assignable,
    'canManageChecklist', v_active and v_task.status <> 'awaiting_review'
      and (v_task.created_by = v_actor or v_accepted or v_manager),
    'canComment', v_active and (v_task.created_by = v_actor or v_assignment.id is not null or v_manager
      or exists(select 1 from public.work_task_participants
        where task_id = v_task.id and user_id = v_actor and ended_at is null)),
    'canSetPreferences', v_active,
    'canAttachInput', app_private.work_attachment_can_mutate(v_task.id, v_actor, 'input'),
    'canAttachDiscussion', app_private.work_attachment_can_mutate(v_task.id, v_actor, 'discussion'),
    'canAttachResult', app_private.work_attachment_can_mutate(v_task.id, v_actor, 'result'),
    'canAttachEvidence', app_private.work_attachment_can_mutate(v_task.id, v_actor, 'evidence'),
    'canCreateChild', v_active and v_task.parent_task_id is null
      and app_private.has_permission(v_actor, 'work.task.create', v_scope.scope_type, v_scope.scope_id),
    'canManageSchedule', v_active and (v_task.created_by = v_actor or v_manager),
    'canManageWatchers', v_active and (v_task.created_by = v_actor or v_manager)
  );
end;
$$;
revoke all on function app_private.work_task_capabilities(uuid) from public, anon, authenticated;

create or replace function app_private.work_get_detail(p_task_ref text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_task public.work_tasks%rowtype;
begin
  select * into v_task from public.work_tasks where task_code = p_task_ref;
  if v_task.id is null and p_task_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_task from public.work_tasks where id = p_task_ref::uuid;
  end if;
  if v_task.id is null or not app_private.work_task_actor_can_view(v_task.id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'task', to_jsonb(v_task),
    'assignments', coalesce((select jsonb_agg(to_jsonb(a) order by a.assigned_at, a.id)
      from public.work_task_assignments a where a.task_id = v_task.id
        and (a.ended_at is null or a.state in ('completed', 'cancelled'))), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(to_jsonb(p) order by p.participant_role, p.id)
      from public.work_task_participants p where p.task_id = v_task.id and p.ended_at is null), '[]'::jsonb),
    'checklist', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order, c.id)
      from public.work_task_checklist_items c where c.task_id = v_task.id and c.deleted_at is null), '[]'::jsonb),
    'currentSubmission', (select to_jsonb(s) from public.work_task_submissions s
      where s.task_id = v_task.id order by s.iteration desc limit 1),
    'attachments', coalesce((select jsonb_agg(to_jsonb(f) || jsonb_build_object(
        'can_delete', app_private.work_attachment_can_mutate(v_task.id, public.current_app_user_id(), f.attachment_kind)
          and (f.uploader_user_id = public.current_app_user_id()
            or (app_private.work_task_capabilities(v_task.id)->>'canCancel')::boolean)
      ) order by f.created_at, f.id)
      from public.work_task_attachments f where f.task_id = v_task.id
        and f.status = 'ready' and f.deleted_at is null), '[]'::jsonb),
    'capabilities', app_private.work_task_capabilities(v_task.id),
    'childAggregate', app_private.work_task_child_aggregate(v_task.id),
    'preferences', jsonb_build_object(
      'pinned', exists(select 1 from public.work_task_pins
        where task_id = v_task.id and user_id = public.current_app_user_id()),
      'notificationsEnabled', coalesce((select notifications_enabled
        from public.work_task_notification_preferences
        where task_id = v_task.id and user_id = public.current_app_user_id()), true)
    )
  );
end;
$$;
revoke all on function app_private.work_get_detail(text) from public, anon, authenticated;
grant execute on function app_private.work_get_detail(text) to authenticated;

create or replace function app_private.work_get_clone_draft(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_task public.work_tasks%rowtype;
  v_draft jsonb;
  v_scope jsonb;
  v_workspace uuid;
  v_members jsonb;
  v_sources jsonb;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select * into strict v_task from public.work_tasks where id = p_task_id;
  v_workspace := app_private.work_task_workspace_id(v_task.id);
  v_scope := case when v_workspace is not null and not exists(
      select 1 from public.work_task_groups g where g.id = v_task.task_group_id and g.workspace_id is null
    ) then jsonb_build_object('type', 'workspace', 'workspaceId', v_workspace)
    else jsonb_strip_nulls(jsonb_build_object('type', v_task.scope_type,
      'departmentId', v_task.department_id, 'projectId', v_task.project_id)) end;
  perform app_private.work_assert_create_scope(v_scope);
  select coalesce(jsonb_agg(to_jsonb(q.user_id) order by q.user_id), '[]'::jsonb)
  into v_members from (
    select distinct a.user_id from public.work_task_assignments a where a.task_id = v_task.id and (
      a.ended_at is null
      or (v_task.status = 'completed' and a.state = 'completed')
      or (v_task.status = 'cancelled' and a.state = 'cancelled')
    )
  ) q;
  if v_members is distinct from (select coalesce(jsonb_agg(to_jsonb(m.user_id) order by m.user_id), '[]'::jsonb)
      from public.work_task_recipient_members m where m.task_id = v_task.id) then
    select coalesce(jsonb_agg(jsonb_build_object('type', 'user', 'id', x) order by x), '[]'::jsonb)
      into v_sources from jsonb_array_elements(v_members) x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('type', s.source_type, 'id', s.source_id)
      order by s.sort_order, s.id), '[]'::jsonb)
      into v_sources from public.work_task_recipient_specs s where s.task_id = v_task.id;
  end if;
  v_draft := jsonb_strip_nulls(jsonb_build_object(
    'title', v_task.title,
    'description', v_task.description_document,
    'scope', v_scope,
    'taskGroupId', v_task.task_group_id,
    'labels', v_task.labels,
    'priority', v_task.priority,
    'privacy', v_task.privacy,
    'recipientSources', v_sources,
    'watcherUserIds', coalesce((select jsonb_agg(p.user_id order by p.user_id)
      from public.work_task_participants p where p.task_id = v_task.id
        and p.participant_role = 'watcher' and p.ended_at is null), '[]'::jsonb),
    'reviewerUserId', v_task.reviewer_user_id,
    'reviewPolicy', v_task.review_policy,
    'checklist', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'title', c.title,
        'assigneeUserId', case when v_members @> jsonb_build_array(c.assignee_user_id)
          then c.assignee_user_id end
      )) order by c.sort_order, c.id)
      from public.work_task_checklist_items c where c.task_id = v_task.id
        and c.completed_at is null and c.deleted_at is null), '[]'::jsonb),
    'clonedFromTaskId', v_task.id,
    'plannedStartAt', case when v_task.planned_start_at > now() then v_task.planned_start_at end,
    'deadlineAt', case when v_task.deadline_at > now() then v_task.deadline_at end
  ));
  return jsonb_build_object(
    'draft', v_draft,
    'requiresDeadlineConfirmation', coalesce(v_task.deadline_at <= now(), false),
    'recipientSnapshot', coalesce((select jsonb_agg(jsonb_build_object('userId', x) order by x)
      from jsonb_array_elements(v_members) x), '[]'::jsonb)
  );
end;
$$;
revoke all on function app_private.work_get_clone_draft(uuid) from public, anon, authenticated;
grant execute on function app_private.work_get_clone_draft(uuid) to authenticated;


-- Preserve the existing atomic create contract while accepting child/schedule fields.
create or replace function app_private.work_create_task(p_input jsonb,p_idempotency_key uuid,p_recipient_fingerprint text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id(); v_scope jsonb := p_input->'scope';
  v_request_hash text := md5(jsonb_build_object('input',p_input,'fingerprint',p_recipient_fingerprint)::text);
  v_existing app_private.work_command_idempotency%rowtype; v_preview jsonb; v_task public.work_tasks%rowtype;
  v_sla_config jsonb; v_assignment_id uuid; v_reviewer uuid; v_policy text; v_text text; v_event uuid;
  v_recipient jsonb; v_source jsonb; v_item jsonb; v_member uuid; v_uid uuid; v_parent public.work_tasks%rowtype;
  v_self_only boolean; v_has_self boolean; v_result jsonb; v_s text; v_k text; v_i integer := 0;
begin
  if a is null or not app_private.has_permission(a,'work.module.access','global','*') then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  if p_idempotency_key is null or p_recipient_fingerprint is null or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'WORK_INVALID_COMMAND' using errcode='22023'; end if;
  -- Serializes same actor/key, including concurrent retries; conflicts never overwrite history.
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
    values(a,p_idempotency_key,'create_work_task',v_request_hash) on conflict do nothing;
  select * into strict v_existing from app_private.work_command_idempotency
    where actor_user_id=a and idempotency_key=p_idempotency_key for update;
  if v_existing.command_name<>'create_work_task' or v_existing.request_hash<>v_request_hash then raise exception 'WORK_IDEMPOTENCY_CONFLICT'; end if;
  if v_existing.response_payload is not null then
    if not app_private.work_task_actor_can_view((v_existing.response_payload->>'taskId')::uuid) then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
    return v_existing.response_payload;
  end if;
  perform app_private.work_assert_create_scope(v_scope);
  v_s:=case when v_scope->>'type'='direct' then 'own' else v_scope->>'type' end;
  v_k:=coalesce(v_scope->>'departmentId',v_scope->>'projectId','*');
  if p_input-array['title','description','scope','taskGroupId','recipientSources','watcherUserIds','reviewerUserId','reviewPolicy',
    'deadlineAt','plannedStartAt','parentTaskId','priority','privacy','labels','checklist','clonedFromTaskId']<>'{}'::jsonb
    or jsonb_typeof(p_input->'title') is distinct from 'string' or length(btrim(p_input->>'title')) not between 2 and 300
    or coalesce(p_input->>'priority','') not in ('normal','important','urgent')
    or coalesce(p_input->>'privacy','') not in ('standard','restricted')
    or jsonb_typeof(p_input->'watcherUserIds') is distinct from 'array'
    or jsonb_typeof(p_input->'labels') is distinct from 'array'
    or jsonb_typeof(p_input->'checklist') is distinct from 'array' then raise exception 'WORK_INVALID_COMMAND' using errcode='22023'; end if;
  if jsonb_array_length(p_input->'watcherUserIds')>100 or jsonb_array_length(p_input->'labels')>20 or jsonb_array_length(p_input->'checklist')>200
    or exists(select 1 from jsonb_array_elements(p_input->'labels') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 80) then
    raise exception 'WORK_INVALID_COMMAND' using errcode='22023'; end if;
  v_text:=app_private.work_validate_document(p_input->'description');
  v_preview:=app_private.work_preview_recipients(p_input->'recipientSources',v_scope);
  if v_preview->>'fingerprint'<>p_recipient_fingerprint then raise exception 'WORK_RECIPIENT_PREVIEW_STALE'; end if;
  if (v_preview->>'validCount')::int=0 then raise exception 'WORK_NO_VALID_RECIPIENTS'; end if;
  if p_input->>'taskGroupId' is not null and not exists(select 1 from public.work_task_groups g
    where g.id=(p_input->>'taskGroupId')::uuid and g.is_active and g.scope_type=v_scope->>'type'
      and g.department_id is not distinct from (v_scope->>'departmentId')::uuid
      and g.project_id is not distinct from v_scope->>'projectId') then raise exception 'WORK_TASK_GROUP_SCOPE_MISMATCH' using errcode='42501'; end if;
  if p_input->>'clonedFromTaskId' is not null and not app_private.work_task_actor_can_view((p_input->>'clonedFromTaskId')::uuid) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  begin
    if p_input->>'plannedStartAt' is not null then
      if not isfinite((p_input->>'plannedStartAt')::timestamptz) then
        raise exception 'WORK_INVALID_SCHEDULE' using errcode='22023';
      end if;
    end if;
    if p_input->>'deadlineAt' is not null then
      if not isfinite((p_input->>'deadlineAt')::timestamptz) then
        raise exception 'WORK_INVALID_SCHEDULE' using errcode='22023';
      end if;
      if (p_input->>'deadlineAt')::timestamptz<=now() then
        raise exception 'WORK_DEADLINE_EXPIRED' using errcode='22023';
      end if;
    end if;
    if p_input->>'plannedStartAt' is not null and p_input->>'deadlineAt' is not null
      and (p_input->>'plannedStartAt')::timestamptz > (p_input->>'deadlineAt')::timestamptz then
      raise exception 'WORK_INVALID_SCHEDULE' using errcode='22023';
    end if;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'WORK_INVALID_SCHEDULE' using errcode='22023';
  end;
  if p_input->>'parentTaskId' is not null then
    begin
      select * into v_parent from public.work_tasks where id=(p_input->>'parentTaskId')::uuid for key share;
    exception when invalid_text_representation then
      raise exception 'WORK_PARENT_TASK_NOT_FOUND' using errcode='42501';
    end;
    if v_parent.id is null or not app_private.work_task_actor_can_view(v_parent.id) then
      raise exception 'WORK_PARENT_TASK_NOT_FOUND' using errcode='42501';
    end if;
    if v_parent.parent_task_id is not null then raise exception 'WORK_TASK_MAX_DEPTH' using errcode='23514'; end if;
    if v_parent.status in ('completed','cancelled') then raise exception 'WORK_PARENT_TASK_CLOSED' using errcode='23514'; end if;
  end if;
  select exists(select 1 from jsonb_array_elements(v_preview->'validRecipients') x where x->>'userId'=a::text) into v_has_self;
  v_self_only:=v_has_self and (v_preview->>'validCount')::int=1 and v_scope->>'type'='direct';
  v_policy:=coalesce(p_input->>'reviewPolicy',case when p_input->>'reviewerUserId' is not null and (p_input->>'reviewerUserId')::uuid<>a then 'reviewer_review'
    when v_self_only then 'auto_complete' else 'creator_review' end);
  if v_policy not in ('auto_complete','creator_review','reviewer_review') or (v_policy='auto_complete' and not v_self_only) then
    raise exception 'WORK_REVIEW_POLICY_DENIED' using errcode='42501'; end if;
  v_reviewer:=case v_policy when 'auto_complete' then null when 'creator_review' then a else (p_input->>'reviewerUserId')::uuid end;
  if (v_policy='reviewer_review' and (v_reviewer is null or not app_private.has_permission(a,'work.task.manage_scope',
      case when v_s='own' then 'global' else v_s end,v_k)))
    or (v_policy='auto_complete' and p_input->>'reviewerUserId' is not null)
    or (v_policy='creator_review' and p_input->>'reviewerUserId' is not null and (p_input->>'reviewerUserId')::uuid<>a) then
    raise exception 'WORK_REVIEW_POLICY_DENIED' using errcode='42501'; end if;
  if v_reviewer is not null and (not exists(select 1 from public.users where id=v_reviewer and is_active and account_status='ACTIVE')
    or not app_private.has_permission(v_reviewer,'work.module.access','global','*')
    or not (app_private.has_permission(v_reviewer,'work.task.review','assigned','*')
      or (v_s<>'own' and app_private.has_permission(v_reviewer,'work.task.review',v_s,v_k)))) then
    raise exception 'WORK_REVIEWER_INELIGIBLE' using errcode='42501'; end if;
  for v_uid in select distinct value::uuid from jsonb_array_elements_text(p_input->'watcherUserIds') loop
    if v_uid is null or not exists(select 1 from public.users where id=v_uid and is_active and account_status='ACTIVE')
      or not app_private.has_permission(v_uid,'work.module.access','global','*')
      or not (app_private.has_permission(v_uid,'work.task.view_related','assigned','*')
        or (v_s<>'own' and app_private.has_permission(v_uid,'work.task.view_related',v_s,v_k))) then
      raise exception 'WORK_WATCHER_INELIGIBLE' using errcode='42501'; end if;
  end loop;
  v_sla_config:=app_private.work_resolve_sla(v_scope,p_input->>'priority',now());
  insert into public.work_tasks(task_code,title,description_document,description_text,scope_type,department_id,project_id,task_group_id,
    recipient_snapshot_fingerprint,status,priority,privacy,labels,planned_start_at,deadline_at,review_policy,reviewer_user_id,created_by,cloned_from_task_id,parent_task_id)
  values(app_private.next_work_task_code(),btrim(p_input->>'title'),p_input->'description',v_text,v_scope->>'type',(v_scope->>'departmentId')::uuid,
    v_scope->>'projectId',(p_input->>'taskGroupId')::uuid,p_recipient_fingerprint,case when v_has_self then 'not_started' else 'pending_acknowledgement' end,
    p_input->>'priority',p_input->>'privacy',array(select jsonb_array_elements_text(p_input->'labels')),(p_input->>'plannedStartAt')::timestamptz,(p_input->>'deadlineAt')::timestamptz,
    v_policy,v_reviewer,a,(p_input->>'clonedFromTaskId')::uuid,(p_input->>'parentTaskId')::uuid) returning * into v_task;
  insert into public.work_task_recipient_specs(task_id,source_type,source_id,source_name_snapshot)
    select v_task.id,x->>'type',x->>'id',case when x->>'type'='user' then (select name from public.users where id::text=x->>'id')
      else (select name from public.work_groups where id::text=x->>'id') end from jsonb_array_elements(v_preview->'sources') x;
  for v_recipient in select value from jsonb_array_elements(v_preview->'validRecipients') loop
    v_uid:=(v_recipient->>'userId')::uuid;
    insert into public.work_task_recipient_members(task_id,user_id) values(v_task.id,v_uid) returning id into v_member;
    insert into public.work_task_recipient_member_sources(task_id,recipient_member_id,recipient_spec_id)
      select v_task.id,v_member,s.id from jsonb_array_elements(v_recipient->'sources') x join public.work_task_recipient_specs s
      on s.task_id=v_task.id and s.source_type=x->>'type' and s.source_id=x->>'id';
    insert into public.work_task_assignments(task_id,user_id,assigned_by,state,acknowledged_at,acknowledgement_due_at)
    values(v_task.id,v_uid,a,case when v_uid=a then 'not_started' else 'pending_acknowledgement' end,
      case when v_uid=a then now() end,null) returning id into v_assignment_id;
    perform app_private.work_apply_assignment_sla(v_assignment_id,true);
  end loop;
  insert into public.work_task_participants(task_id,user_id,participant_role,added_by)
    select distinct v_task.id,value::uuid,'watcher',a from jsonb_array_elements_text(p_input->'watcherUserIds');
  if v_reviewer is not null then insert into public.work_task_participants(task_id,user_id,participant_role,added_by)
    values(v_task.id,v_reviewer,'reviewer',a); end if;
  for v_item in select value from jsonb_array_elements(p_input->'checklist') loop
    if jsonb_typeof(v_item) is distinct from 'object' or v_item-array['title','assigneeUserId']<>'{}'::jsonb
      or jsonb_typeof(v_item->'title') is distinct from 'string' or length(btrim(v_item->>'title')) not between 1 and 300
      or (v_item->>'assigneeUserId' is not null and not exists(select 1 from public.work_task_assignments
        where task_id=v_task.id and user_id=(v_item->>'assigneeUserId')::uuid)) then raise exception 'WORK_INVALID_CHECKLIST' using errcode='22023'; end if;
    insert into public.work_task_checklist_items(task_id,title,assignee_user_id,sort_order,created_by)
      values(v_task.id,btrim(v_item->>'title'),(v_item->>'assigneeUserId')::uuid,v_i,a);
    v_i:=v_i+1;
  end loop;
  if not app_private.work_task_actor_can_view(v_task.id) then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  insert into public.work_task_versions(task_id,version,snapshot,actor_user_id,idempotency_key)
    values(v_task.id,1,jsonb_build_object('task',to_jsonb(v_task),'recipientPreview',v_preview,'checklist',p_input->'checklist'),a,p_idempotency_key);
  insert into public.work_task_events(task_id,event_type,actor_user_id,idempotency_key,payload)
    values(v_task.id,'task.created',a,p_idempotency_key,jsonb_strip_nulls(jsonb_build_object('taskId',v_task.id,'parentTaskId',v_task.parent_task_id,'assignmentCount',(v_preview->>'validCount')::int))) returning id into v_event;
  insert into app_private.work_notification_outbox(event_id,task_id,event_type,payload)
    values(v_event,v_task.id,'task.created',jsonb_strip_nulls(jsonb_build_object('taskId',v_task.id,'parentTaskId',v_task.parent_task_id)));
  v_result:=jsonb_strip_nulls(jsonb_build_object('taskId',v_task.id,'taskCode',v_task.task_code,'lockVersion',v_task.lock_version,'status',v_task.status,'parentTaskId',v_task.parent_task_id));
  update app_private.work_command_idempotency set response_payload=v_result,completed_at=now() where actor_user_id=a and idempotency_key=p_idempotency_key;
  return v_result;
end $$;


-- Include the planned range and hierarchy in bounded list projections.
create or replace function app_private.work_list_tasks(p_view text,p_filters jsonb,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); n integer := least(100,greatest(1,coalesce(p_limit,50)));
  rows jsonb; cursor_at timestamptz; cursor_id uuid; scope_filter jsonb := p_filters->'scope';
begin
  if a is null or not app_private.has_permission(a,'work.module.access','global','*') then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  if p_view is null or p_view not in ('assigned_to_me','created_by_me','following','pinned')
    or jsonb_typeof(p_filters) is distinct from 'object'
    or p_filters-array['status','priority','scope','taskGroupId','deadlineFrom','deadlineTo','search']<>'{}'::jsonb
    or (p_filters ? 'status' and jsonb_typeof(p_filters->'status')<>'array')
    or (p_filters ? 'priority' and jsonb_typeof(p_filters->'priority')<>'array') then raise exception 'WORK_INVALID_FILTER' using errcode='22023'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor->>'sortAt' is null or p_cursor->>'id' is null then
      raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end if;
    cursor_at:=(p_cursor->>'sortAt')::timestamptz; cursor_id:=(p_cursor->>'id')::uuid;
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id desc),'[]') into rows from (
    select t.id,t.task_code,t.title,t.status,t.priority,t.privacy,t.scope_type,t.department_id,t.project_id,
      t.task_group_id,t.parent_task_id,t.planned_start_at,t.deadline_at,t.created_by,t.reviewer_user_id,t.updated_at,t.lock_version,
      (select count(*) from public.work_task_assignments a where a.task_id=t.id and (a.ended_at is null or a.state in ('completed','cancelled'))) as assignment_count,
      (select count(*) from public.work_task_assignments a where a.task_id=t.id and (a.ended_at is null or a.state in ('completed','cancelled')) and a.acknowledged_at is not null) as acknowledged_count
    from public.work_tasks t
    where (case p_view
      when 'created_by_me' then t.created_by=a
      when 'assigned_to_me' then exists(select 1 from public.work_task_assignments x where x.task_id=t.id and x.user_id=a and (x.ended_at is null or x.state in ('completed','cancelled')))
      when 'following' then exists(select 1 from public.work_task_participants x where x.task_id=t.id and x.user_id=a and x.participant_role='watcher' and x.ended_at is null)
      when 'pinned' then exists(select 1 from public.work_task_pins x where x.task_id=t.id and x.user_id=a) end)
    and (cursor_at is null or (t.updated_at,t.id)<(cursor_at,cursor_id))
    and (not p_filters ? 'status' or t.status in (select jsonb_array_elements_text(p_filters->'status')))
    and (not p_filters ? 'priority' or t.priority in (select jsonb_array_elements_text(p_filters->'priority')))
    and (scope_filter is null or (t.scope_type=scope_filter->>'type'
      and t.department_id is not distinct from (scope_filter->>'departmentId')::uuid
      and t.project_id is not distinct from scope_filter->>'projectId'))
    and (not p_filters ? 'taskGroupId' or t.task_group_id=(p_filters->>'taskGroupId')::uuid)
    and (not p_filters ? 'deadlineFrom' or t.deadline_at>=(p_filters->>'deadlineFrom')::timestamptz)
    and (not p_filters ? 'deadlineTo' or t.deadline_at<=(p_filters->>'deadlineTo')::timestamptz)
    and (nullif(btrim(p_filters->>'search'),'') is null or t.task_code=p_filters->>'search'
      or to_tsvector('simple',coalesce(t.title,'') || ' ' || coalesce(t.description_text,'')) @@ plainto_tsquery('simple',p_filters->>'search'))
    and app_private.work_task_actor_can_view(t.id)
    order by t.updated_at desc,t.id desc limit n+1
  ) q;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(rows) with ordinality where ordinality<=n),
    'nextCursor',case when jsonb_array_length(rows)>n then jsonb_build_object('sortAt',rows->(n-1)->'updated_at','id',rows->(n-1)->'id') else null end);
end $$;

create or replace function app_private.work_list_workspace_tasks(p_workspace_id uuid,p_filters jsonb,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id(); v_n integer:=coalesce(p_limit,30); v_at timestamptz; v_id uuid; v_rows jsonb;
begin
  perform app_private.work_workspace_assert_member(p_workspace_id,v_actor);
  if v_n not between 1 and 50 or jsonb_typeof(p_filters) is distinct from 'object'
    or p_filters-array['status','priority','taskGroupId','assigneeUserId','deadlineFrom','deadlineTo','search']<>'{}'::jsonb
    or (p_filters?'status' and jsonb_typeof(p_filters->'status')<>'array')
    or (p_filters?'priority' and jsonb_typeof(p_filters->'priority')<>'array')
    or length(coalesce(p_filters->>'search',''))>100 then raise exception 'WORK_INVALID_FILTER' using errcode='22023'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor-array['sortAt','id']<>'{}'::jsonb then raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end if;
    begin v_at:=(p_cursor->>'sortAt')::timestamptz;v_id:=(p_cursor->>'id')::uuid;
      if v_at is null or v_id is null or not isfinite(v_at) then raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end if;
    exception when invalid_text_representation or datetime_field_overflow then raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end;
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id desc),'[]') into v_rows from(
    select t.id,t.task_code,t.title,t.status,t.priority,t.privacy,t.scope_type,t.department_id,t.project_id,
      p_workspace_id workspace_id,t.task_group_id,t.parent_task_id,t.planned_start_at,t.deadline_at,t.created_by,t.reviewer_user_id,t.updated_at,t.lock_version,
      (select count(*) from public.work_task_assignments a where a.task_id=t.id and (a.ended_at is null or a.state in('completed','cancelled'))) assignment_count,
      (select count(*) from public.work_task_assignments a where a.task_id=t.id and (a.ended_at is null or a.state in('completed','cancelled')) and a.acknowledged_at is not null) acknowledged_count
    from public.work_tasks t join public.work_workspaces w on w.id=p_workspace_id
    where (t.workspace_id=p_workspace_id or (t.workspace_id is null and ((w.kind='department' and t.department_id=w.department_id) or (w.kind='project' and t.project_id=w.project_id))))
      and (v_at is null or (t.updated_at,t.id)<(v_at,v_id))
      and (not p_filters?'status' or t.status in(select jsonb_array_elements_text(p_filters->'status')))
      and (not p_filters?'priority' or t.priority in(select jsonb_array_elements_text(p_filters->'priority')))
      and (not p_filters?'taskGroupId' or t.task_group_id=(p_filters->>'taskGroupId')::uuid)
      and (not p_filters?'assigneeUserId' or exists(select 1 from public.work_task_assignments fa
        where fa.task_id=t.id and fa.user_id=(p_filters->>'assigneeUserId')::uuid
          and (fa.ended_at is null or fa.state in('completed','cancelled'))))
      and (not p_filters?'deadlineFrom' or t.deadline_at>=(p_filters->>'deadlineFrom')::timestamptz)
      and (not p_filters?'deadlineTo' or t.deadline_at<=(p_filters->>'deadlineTo')::timestamptz)
      and (nullif(btrim(p_filters->>'search'),'') is null or t.task_code=p_filters->>'search'
        or to_tsvector('simple',coalesce(t.title,'')||' '||coalesce(t.description_text,''))@@plainto_tsquery('simple',p_filters->>'search'))
      and app_private.work_task_actor_can_view(t.id)
    order by t.updated_at desc,t.id desc limit v_n+1
  )q;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(v_rows)with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then jsonb_build_object('sortAt',v_rows->(v_n-1)->'updated_at','id',v_rows->(v_n-1)->'id') else null end);
end $$;

create or replace function app_private.work_user_eligible_as_watcher(p_task_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.work_tasks%rowtype;
  v_scope record;
  v_related boolean;
begin
  select * into v_task from public.work_tasks where id = p_task_id;
  if v_task.id is null or p_user_id is null
    or not exists(select 1 from public.users
      where id = p_user_id and is_active and account_status = 'ACTIVE')
    or not app_private.has_permission(p_user_id, 'work.module.access', 'global', '*') then
    return false;
  end if;
  select * into strict v_scope from app_private.work_task_permission_scope(p_task_id);
  if v_scope.workspace_id is not null
    and app_private.work_workspace_member_role(v_scope.workspace_id, p_user_id) is null then
    return false;
  end if;
  if not (
    app_private.has_permission(p_user_id, 'work.task.view_related', 'assigned', '*')
    or app_private.has_permission(p_user_id, 'work.task.view_related', v_scope.scope_type, v_scope.scope_id)
    or app_private.has_permission(p_user_id, 'work.task.view_scope', v_scope.scope_type, v_scope.scope_id)
  ) then
    return false;
  end if;
  v_related := v_task.created_by = p_user_id
    or exists(select 1 from public.work_task_assignments
      where task_id = p_task_id and user_id = p_user_id)
    or exists(select 1 from public.work_task_participants
      where task_id = p_task_id and user_id = p_user_id and ended_at is null);
  return v_task.privacy = 'standard'
    or v_related
    or app_private.has_permission(p_user_id, 'work.task.view_restricted', v_scope.scope_type, v_scope.scope_id);
end;
$$;
revoke all on function app_private.work_user_eligible_as_watcher(uuid, uuid) from public, anon, authenticated;

create or replace function app_private.work_list_watcher_candidates(
  p_task_id uuid,
  p_search text,
  p_cursor uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := least(50, greatest(1, coalesce(p_limit, 30)));
  v_rows jsonb;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if not (app_private.work_task_capabilities(p_task_id)->>'canManageWatchers')::boolean then
    raise exception 'WORK_OPTIONS_DENIED' using errcode = '42501';
  end if;
  if char_length(coalesce(p_search, '')) > 100 then
    raise exception 'WORK_INVALID_SEARCH' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."userId"), '[]'::jsonb)
  into v_rows
  from (
    select u.id as "userId", u.name
    from public.users u
    where u.is_active and u.account_status = 'ACTIVE'
      and (p_cursor is null or u.id > p_cursor)
      and (nullif(btrim(p_search), '') is null
        or strpos(lower(u.name), lower(btrim(p_search))) > 0
        or strpos(lower(u.email), lower(btrim(p_search))) > 0)
      and app_private.work_user_eligible_as_watcher(p_task_id, u.id)
    order by u.id
    limit v_n + 1
  ) q;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
      from jsonb_array_elements(v_rows) with ordinality where ordinality <= v_n),
    'nextCursor', case when jsonb_array_length(v_rows) > v_n
      then v_rows->(v_n - 1)->'userId' else null end
  );
end;
$$;
revoke all on function app_private.work_list_watcher_candidates(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function app_private.work_list_watcher_candidates(uuid, text, uuid, integer) to authenticated;

create or replace function public.list_work_task_watcher_candidates(
  p_task_id uuid,
  p_search text default '',
  p_cursor uuid default null,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.work_list_watcher_candidates(p_task_id, p_search, p_cursor, p_limit);
$$;
revoke all on function public.list_work_task_watcher_candidates(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_work_task_watcher_candidates(uuid, text, uuid, integer) to authenticated;

-- Extend the existing collaboration command without bypassing its idempotency or audit path.
create or replace function app_private.work_command_collaboration(p_task_id uuid,p_command text,p_payload jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=public.current_app_user_id(); v_task public.work_tasks%rowtype;
  v_prior app_private.work_command_idempotency%rowtype; v_caps jsonb; v_allowed text[];
  v_hash text:=md5(jsonb_build_object('taskId',p_task_id,'command',p_command,'payload',p_payload)::text);
  v_item public.work_task_checklist_items%rowtype; v_comment public.work_task_comments%rowtype;
  v_before jsonb; v_after jsonb; v_response jsonb; v_event_type text; v_event_id uuid;
  v_assignee uuid; v_text text; v_mentions uuid[]:='{}'; v_old_mentions uuid[]:='{}'; v_new_mentions uuid[]:='{}';
  v_user uuid; v_bool boolean; v_expected bigint;
  v_add_users uuid[] := '{}'; v_remove_users uuid[] := '{}';
  v_added_users uuid[] := '{}'; v_removed_users uuid[] := '{}';
begin
  if v_actor is null or not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  v_allowed:=case p_command
    when 'checklist_create' then array['title','assigneeUserId','sortOrder']
    when 'checklist_update' then array['itemId','expectedLockVersion','title','assigneeUserId','sortOrder']
    when 'checklist_set_completed' then array['itemId','expectedLockVersion','completed']
    when 'checklist_delete' then array['itemId','expectedLockVersion']
    when 'comment_create' then array['content','parentCommentId','mentionedUserIds']
    when 'comment_edit' then array['commentId','expectedLockVersion','content','mentionedUserIds']
    when 'set_pin' then array['pinned']
    when 'set_notifications' then array['notificationsEnabled']
    when 'schedule_update' then array['plannedStartAt','deadlineAt','expectedLockVersion']
    when 'watchers_update' then array['addUserIds','removeUserIds','expectedLockVersion'] end;
  if v_allowed is null or p_idempotency_key is null or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload-v_allowed<>'{}'::jsonb or octet_length(p_payload::text)>120000 then raise exception 'WORK_INVALID_COMMAND' using errcode='22023'; end if;
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
    values(v_actor,p_idempotency_key,'work_collaboration',v_hash) on conflict do nothing;
  select * into strict v_prior from app_private.work_command_idempotency where actor_user_id=v_actor and idempotency_key=p_idempotency_key for update;
  if v_prior.command_name<>'work_collaboration' or v_prior.request_hash<>v_hash then raise exception 'WORK_IDEMPOTENCY_CONFLICT'; end if;
  if v_prior.response_payload is not null then return v_prior.response_payload; end if;
  select * into strict v_task from public.work_tasks where id=p_task_id for update;
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  v_caps:=app_private.work_task_capabilities(p_task_id);

  if p_command in ('schedule_update','watchers_update') then
    if p_command='schedule_update' and not (v_caps->>'canManageSchedule')::boolean then
      raise exception 'WORK_COMMAND_DENIED' using errcode='42501';
    end if;
    if p_command='watchers_update' and not (v_caps->>'canManageWatchers')::boolean then
      raise exception 'WORK_COMMAND_DENIED' using errcode='42501';
    end if;
    if (p_command='schedule_update' and not (p_payload ?& array['plannedStartAt','deadlineAt','expectedLockVersion']))
      or (p_command='watchers_update' and not (p_payload ?& array['addUserIds','removeUserIds','expectedLockVersion'])) then
      raise exception 'WORK_INVALID_COMMAND' using errcode='22023';
    end if;
    if jsonb_typeof(p_payload->'expectedLockVersion') is distinct from 'number'
      or (p_payload->>'expectedLockVersion') !~ '^[1-9][0-9]*$' then
      raise exception 'WORK_INVALID_VERSION' using errcode='22023';
    end if;
    v_expected := (p_payload->>'expectedLockVersion')::bigint;
    if v_task.lock_version is distinct from v_expected then raise exception 'WORK_VERSION_CONFLICT'; end if;
    v_before := to_jsonb(v_task);

    if p_command='schedule_update' then
      begin
        if p_payload->>'plannedStartAt' is not null
          and not isfinite((p_payload->>'plannedStartAt')::timestamptz) then
          raise exception 'WORK_INVALID_SCHEDULE' using errcode='22023';
        end if;
        if p_payload->>'deadlineAt' is not null
          and not isfinite((p_payload->>'deadlineAt')::timestamptz) then
          raise exception 'WORK_INVALID_SCHEDULE' using errcode='22023';
        end if;
        if p_payload->>'plannedStartAt' is not null and p_payload->>'deadlineAt' is not null
          and (p_payload->>'plannedStartAt')::timestamptz > (p_payload->>'deadlineAt')::timestamptz then
          raise exception 'WORK_INVALID_SCHEDULE' using errcode='22023';
        end if;
      exception when invalid_text_representation or datetime_field_overflow then
        raise exception 'WORK_INVALID_SCHEDULE' using errcode='22023';
      end;
      if v_task.planned_start_at is distinct from (p_payload->>'plannedStartAt')::timestamptz
        or v_task.deadline_at is distinct from (p_payload->>'deadlineAt')::timestamptz then
        update public.work_tasks set
          planned_start_at=(p_payload->>'plannedStartAt')::timestamptz,
          deadline_at=(p_payload->>'deadlineAt')::timestamptz,
          lock_version=lock_version+1,
          updated_at=now()
        where id=p_task_id returning * into v_task;
        v_event_type:='task.schedule_updated';
      end if;
      v_after:=to_jsonb(v_task);
      v_response:=jsonb_build_object('taskId',p_task_id,'taskLockVersion',v_task.lock_version,
        'schedule',jsonb_build_object('plannedStartAt',v_task.planned_start_at,'deadlineAt',v_task.deadline_at));
    else
      if jsonb_typeof(p_payload->'addUserIds') is distinct from 'array'
        or jsonb_typeof(p_payload->'removeUserIds') is distinct from 'array'
        or jsonb_array_length(p_payload->'addUserIds')>50
        or jsonb_array_length(p_payload->'removeUserIds')>50 then
        raise exception 'WORK_INVALID_WATCHERS' using errcode='22023';
      end if;
      begin
        select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}') into v_add_users
          from jsonb_array_elements_text(p_payload->'addUserIds');
        select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}') into v_remove_users
          from jsonb_array_elements_text(p_payload->'removeUserIds');
      exception when invalid_text_representation then
        raise exception 'WORK_INVALID_WATCHERS' using errcode='22023';
      end;
      if v_add_users && v_remove_users then raise exception 'WORK_WATCHER_OVERLAP' using errcode='22023'; end if;
      foreach v_user in array v_add_users loop
        if not app_private.work_user_eligible_as_watcher(p_task_id,v_user) then
          raise exception 'WORK_WATCHER_INELIGIBLE' using errcode='42501';
        end if;
      end loop;
      select coalesce(array_agg(x order by x),'{}') into v_added_users
      from unnest(v_add_users) x
      where not exists(select 1 from public.work_task_participants p
        where p.task_id=p_task_id and p.user_id=x and p.participant_role='watcher' and p.ended_at is null);
      select coalesce(array_agg(x order by x),'{}') into v_removed_users
      from unnest(v_remove_users) x
      where exists(select 1 from public.work_task_participants p
        where p.task_id=p_task_id and p.user_id=x and p.participant_role='watcher' and p.ended_at is null);
      if cardinality(v_removed_users)>0 then
        update public.work_task_participants set ended_at=now()
        where task_id=p_task_id and participant_role='watcher' and ended_at is null
          and user_id=any(v_removed_users);
      end if;
      if cardinality(v_added_users)>0 then
        insert into public.work_task_participants(task_id,user_id,participant_role,added_by)
        select p_task_id,x,'watcher',v_actor from unnest(v_added_users) x;
      end if;
      if cardinality(v_added_users)>0 or cardinality(v_removed_users)>0 then
        update public.work_tasks set lock_version=lock_version+1,updated_at=now()
        where id=p_task_id returning * into v_task;
        v_event_type:='task.watchers_updated';
      end if;
      v_after:=jsonb_build_object('task',to_jsonb(v_task),'addedUserIds',v_added_users,'removedUserIds',v_removed_users);
      v_response:=jsonb_build_object('taskId',p_task_id,'taskLockVersion',v_task.lock_version,
        'addedUserIds',v_added_users,'removedUserIds',v_removed_users);
    end if;
    if v_event_type is not null then
      insert into public.work_task_versions(task_id,version,snapshot,actor_user_id,idempotency_key)
      values(p_task_id,v_task.lock_version,jsonb_build_object('task',to_jsonb(v_task)),v_actor,p_idempotency_key);
    end if;

  elsif p_command like 'checklist_%' then
    if not (v_caps->>'canManageChecklist')::boolean then raise exception 'WORK_COMMAND_DENIED' using errcode='42501'; end if;
    if p_command<>'checklist_create' then
      select * into v_item from public.work_task_checklist_items where id=(p_payload->>'itemId')::uuid and task_id=p_task_id and deleted_at is null for update;
      if v_item.id is null then raise exception 'WORK_CHECKLIST_NOT_FOUND' using errcode='42501'; end if;
      if jsonb_typeof(p_payload->'expectedLockVersion') is distinct from 'number' then raise exception 'WORK_INVALID_VERSION' using errcode='22023'; end if;
      if v_item.lock_version::numeric is distinct from (p_payload->>'expectedLockVersion')::numeric then raise exception 'WORK_VERSION_CONFLICT'; end if;
      v_before:=to_jsonb(v_item);
    end if;
    if p_command in ('checklist_create','checklist_update') then
      if (p_command='checklist_create' or p_payload ? 'title') and (
        jsonb_typeof(p_payload->'title') is distinct from 'string' or char_length(btrim(p_payload->>'title')) not between 1 and 300) then
        raise exception 'WORK_INVALID_CHECKLIST_TITLE' using errcode='22023'; end if;
      if p_payload ? 'sortOrder' and (jsonb_typeof(p_payload->'sortOrder') is distinct from 'number'
        or (p_payload->>'sortOrder') !~ '^[0-9]{1,9}$') then raise exception 'WORK_INVALID_SORT_ORDER' using errcode='22023'; end if;
      v_assignee:=case when p_payload ? 'assigneeUserId' then (p_payload->>'assigneeUserId')::uuid else v_item.assignee_user_id end;
      if v_assignee is not null and (not exists(select 1 from public.work_task_assignments where task_id=p_task_id and user_id=v_assignee and ended_at is null)
        or not app_private.work_task_user_can_view(p_task_id,v_assignee)) then raise exception 'WORK_CHECKLIST_ASSIGNEE_INELIGIBLE' using errcode='42501'; end if;
      if p_command='checklist_create' then
        if (select count(*) from public.work_task_checklist_items where task_id=p_task_id and deleted_at is null)>=200 then raise exception 'WORK_CHECKLIST_LIMIT' using errcode='22023'; end if;
        insert into public.work_task_checklist_items(task_id,title,assignee_user_id,sort_order,created_by)
          values(p_task_id,btrim(p_payload->>'title'),v_assignee,coalesce((p_payload->>'sortOrder')::integer,0),v_actor) returning * into v_item;
        v_event_type:='checklist.created';
      else
        if p_payload-array['itemId','expectedLockVersion']='{}'::jsonb then raise exception 'WORK_EMPTY_UPDATE' using errcode='22023'; end if;
        update public.work_task_checklist_items set title=case when p_payload ? 'title' then btrim(p_payload->>'title') else title end,
          assignee_user_id=v_assignee,sort_order=coalesce((p_payload->>'sortOrder')::integer,sort_order),lock_version=lock_version+1,updated_at=now()
          where id=v_item.id returning * into v_item;
        v_event_type:='checklist.updated';
      end if;
    elsif p_command='checklist_set_completed' then
      if jsonb_typeof(p_payload->'completed') is distinct from 'boolean' then raise exception 'WORK_INVALID_COMPLETION' using errcode='22023'; end if;
      v_bool:=(p_payload->>'completed')::boolean;
      if v_bool is distinct from (v_item.completed_at is not null) then
        update public.work_task_checklist_items set completed_at=case when v_bool then now() end,completed_by=case when v_bool then v_actor end,
          lock_version=lock_version+1,updated_at=now() where id=v_item.id returning * into v_item;
        v_event_type:=case when v_bool then 'checklist.completed' else 'checklist.reopened' end;
      end if;
    else
      update public.work_task_checklist_items set deleted_at=now(),deleted_by=v_actor,lock_version=lock_version+1,updated_at=now()
        where id=v_item.id returning * into v_item;
      v_event_type:='checklist.deleted';
    end if;
    v_after:=to_jsonb(v_item);
    if v_event_type is not null then
      update public.work_tasks set lock_version=lock_version+1,updated_at=now() where id=p_task_id returning * into v_task;
      insert into public.work_task_versions(task_id,version,snapshot,actor_user_id,idempotency_key)
        values(p_task_id,v_task.lock_version,jsonb_build_object('task',to_jsonb(v_task),'checklistItem',v_after),v_actor,p_idempotency_key);
    end if;
    v_response:=jsonb_build_object('taskId',p_task_id,'taskLockVersion',v_task.lock_version,'item',v_after);

  elsif p_command in ('comment_create','comment_edit') then
    if not (v_caps->>'canComment')::boolean then raise exception 'WORK_COMMAND_DENIED' using errcode='42501'; end if;
    v_text:=app_private.work_validate_document(p_payload->'content');
    if char_length(btrim(v_text)) not between 1 and 10000 then raise exception 'WORK_INVALID_COMMENT' using errcode='22023'; end if;
    if p_payload ? 'mentionedUserIds' and jsonb_typeof(p_payload->'mentionedUserIds') is distinct from 'array' then raise exception 'WORK_INVALID_MENTIONS' using errcode='22023'; end if;
    if jsonb_array_length(coalesce(p_payload->'mentionedUserIds','[]'))>50 then raise exception 'WORK_MENTION_LIMIT' using errcode='22023'; end if;
    select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}') into v_mentions from jsonb_array_elements_text(coalesce(p_payload->'mentionedUserIds','[]'));
    foreach v_user in array v_mentions loop
      if not app_private.work_task_user_can_view(p_task_id,v_user) then raise exception 'WORK_MENTION_INELIGIBLE' using errcode='42501'; end if;
    end loop;
    if p_command='comment_create' then
      if p_payload->>'parentCommentId' is not null and not exists(select 1 from public.work_task_comments where id=(p_payload->>'parentCommentId')::uuid and task_id=p_task_id) then
        raise exception 'WORK_PARENT_COMMENT_NOT_FOUND' using errcode='42501'; end if;
      insert into public.work_task_comments(task_id,author_user_id,parent_comment_id,content_document,content_text)
        values(p_task_id,v_actor,(p_payload->>'parentCommentId')::uuid,p_payload->'content',v_text) returning * into v_comment;
      v_event_type:='comment.created';
    else
      select * into v_comment from public.work_task_comments where id=(p_payload->>'commentId')::uuid and task_id=p_task_id for update;
      if v_comment.id is null or v_comment.author_user_id<>v_actor then raise exception 'WORK_COMMENT_EDIT_DENIED' using errcode='42501'; end if;
      if jsonb_typeof(p_payload->'expectedLockVersion') is distinct from 'number' then raise exception 'WORK_INVALID_VERSION' using errcode='22023'; end if;
      if v_comment.lock_version::numeric is distinct from (p_payload->>'expectedLockVersion')::numeric then raise exception 'WORK_VERSION_CONFLICT'; end if;
      select coalesce(array_agg(mentioned_user_id order by mentioned_user_id),'{}') into v_old_mentions from public.work_task_mentions where comment_id=v_comment.id;
      v_before:=to_jsonb(v_comment)||jsonb_build_object('mentionedUserIds',v_old_mentions);
      update public.work_task_comments set content_document=p_payload->'content',content_text=v_text,edited_at=now(),updated_at=now(),lock_version=lock_version+1
        where id=v_comment.id returning * into v_comment;
      v_event_type:='comment.edited';
    end if;
    delete from public.work_task_mentions where comment_id=v_comment.id and not (mentioned_user_id=any(v_mentions));
    insert into public.work_task_mentions(task_id,comment_id,mentioned_user_id,mentioned_by)
      select p_task_id,v_comment.id,x,v_actor from unnest(v_mentions) x on conflict(comment_id,mentioned_user_id) do nothing;
    select coalesce(array_agg(x order by x),'{}') into v_new_mentions from unnest(v_mentions) x where not (x=any(v_old_mentions));
    v_after:=to_jsonb(v_comment)||jsonb_build_object('mentionedUserIds',v_mentions);
    v_response:=jsonb_build_object('taskId',p_task_id,'taskLockVersion',v_task.lock_version,'comment',v_after||jsonb_build_object('can_edit',true));

  else
    if p_command='set_pin' then
      if jsonb_typeof(p_payload->'pinned') is distinct from 'boolean' then raise exception 'WORK_INVALID_PREFERENCE' using errcode='22023'; end if;
      if (p_payload->>'pinned')::boolean then
        insert into public.work_task_pins(task_id,user_id) values(p_task_id,v_actor) on conflict do nothing;
      else delete from public.work_task_pins where task_id=p_task_id and user_id=v_actor; end if;
    else
      if jsonb_typeof(p_payload->'notificationsEnabled') is distinct from 'boolean' then raise exception 'WORK_INVALID_PREFERENCE' using errcode='22023'; end if;
      v_bool:=(p_payload->>'notificationsEnabled')::boolean;
      insert into public.work_task_notification_preferences(task_id,user_id,notifications_enabled,muted_at)
        values(p_task_id,v_actor,v_bool,case when not v_bool then now() end)
        on conflict(task_id,user_id) do update set notifications_enabled=excluded.notifications_enabled,muted_at=excluded.muted_at,updated_at=now();
    end if;
    v_response:=jsonb_build_object('taskId',p_task_id,'taskLockVersion',v_task.lock_version,'preferences',jsonb_build_object(
      'pinned',exists(select 1 from public.work_task_pins where task_id=p_task_id and user_id=v_actor),
      'notificationsEnabled',coalesce((select notifications_enabled from public.work_task_notification_preferences where task_id=p_task_id and user_id=v_actor),true)));
  end if;
  if v_event_type is not null then
    insert into public.work_task_events(task_id,actor_user_id,event_type,payload,correlation_id,idempotency_key)
      values(p_task_id,v_actor,v_event_type,jsonb_build_object('before',v_before,'after',v_after),p_idempotency_key,p_idempotency_key) returning id into v_event_id;
    insert into app_private.work_notification_outbox(event_id,task_id,event_type,payload)
      values(v_event_id,p_task_id,v_event_type,jsonb_strip_nulls(jsonb_build_object('taskId',p_task_id,'commentId',v_comment.id)));
    if cardinality(v_new_mentions)>0 then
      insert into public.work_task_events(task_id,actor_user_id,event_type,payload,correlation_id,idempotency_key)
        values(p_task_id,v_actor,'comment.mentioned',jsonb_build_object('commentId',v_comment.id,'recipientUserIds',v_new_mentions),p_idempotency_key,p_idempotency_key) returning id into v_event_id;
      insert into app_private.work_notification_outbox(event_id,task_id,event_type,payload)
        values(v_event_id,p_task_id,'comment.mentioned',jsonb_build_object('taskId',p_task_id,'commentId',v_comment.id,'recipientUserIds',v_new_mentions,'mandatory',true));
    end if;
  end if;
  update app_private.work_command_idempotency set response_payload=v_response,completed_at=now() where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  return v_response;
end $$;

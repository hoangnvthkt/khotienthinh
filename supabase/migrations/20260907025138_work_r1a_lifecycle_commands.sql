-- Task 4B: fixed lifecycle commands, optimistic task version and atomic audit/outbox.
alter table public.work_tasks add column started_at timestamptz;
alter table public.work_tasks add column blocked_reason text;
alter table public.work_task_assignments drop constraint work_task_assignments_terminal_check;
update public.work_task_assignments set ended_at=coalesce(completed_at,updated_at) where state='completed' and ended_at is null;
alter table public.work_task_assignments add constraint work_task_assignments_terminal_check check (
  (state in ('transferred','cancelled','completed') and ended_at is not null)
  or (state not in ('transferred','cancelled','completed') and ended_at is null));

-- Preserve read/audit access from historical assignments; mutation checks below
-- always require ended_at IS NULL. No additional grant is synthesized.
create or replace function app_private.work_task_actor_can_view(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_task record;
  v_is_creator boolean := false;
  v_is_assignee boolean := false;
  v_is_participant boolean := false;
  v_related_allowed boolean := false;
  v_scope_allowed boolean := false;
  v_restricted_allowed boolean := false;
begin
  if v_actor_id is null
    or not app_private.has_permission(v_actor_id, 'work.module.access', 'global', '*') then
    return false;
  end if;

  select task_row.id, task_row.created_by, task_row.scope_type,
    task_row.department_id, task_row.project_id, task_row.privacy into v_task
  from public.work_tasks task_row
  where task_row.id = p_task_id;

  if v_task.id is null then
    return false;
  end if;

  v_is_creator := v_task.created_by = v_actor_id;
  select exists (
    select 1 from public.work_task_assignments assignment_row
    where assignment_row.task_id = p_task_id
      and assignment_row.user_id = v_actor_id
  ) into v_is_assignee;
  select exists (
    select 1 from public.work_task_participants participant_row
    where participant_row.task_id = p_task_id
      and participant_row.user_id = v_actor_id
      and participant_row.ended_at is null
  ) into v_is_participant;

  v_related_allowed := (
    v_is_creator
    and app_private.has_permission(v_actor_id, 'work.task.view_related', 'own', '*')
  ) or (
    (v_is_assignee or v_is_participant)
    and app_private.has_permission(v_actor_id, 'work.task.view_related', 'assigned', '*')
  ) or (
    (v_is_creator or v_is_assignee or v_is_participant)
    and v_task.scope_type in ('department', 'project')
    and app_private.has_permission(v_actor_id, 'work.task.view_related',
      v_task.scope_type, coalesce(v_task.department_id::text, v_task.project_id))
  );

  v_scope_allowed := app_private.has_permission(
    v_actor_id,
    'work.task.view_scope',
    case when v_task.scope_type = 'direct' then 'global' else v_task.scope_type end,
    case
      when v_task.scope_type = 'department' then v_task.department_id::text
      when v_task.scope_type = 'project' then v_task.project_id
      else '*'
    end
  );

  v_restricted_allowed := v_task.privacy = 'standard'
    or v_is_creator
    or v_is_assignee
    or v_is_participant
    or app_private.has_permission(
      v_actor_id,
      'work.task.view_restricted',
      case when v_task.scope_type = 'direct' then 'global' else v_task.scope_type end,
      case
        when v_task.scope_type = 'department' then v_task.department_id::text
        when v_task.scope_type = 'project' then v_task.project_id
        else '*'
      end
    );

  return (v_related_allowed or v_scope_allowed) and v_restricted_allowed;
end;
$$;

create or replace function app_private.work_get_detail(p_task_ref text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.work_tasks%rowtype;
begin
  select * into t from public.work_tasks where task_code=p_task_ref;
  if t.id is null and p_task_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into t from public.work_tasks where id=p_task_ref::uuid; end if;
  if t.id is null or not app_private.work_task_actor_can_view(t.id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  return jsonb_build_object('task',to_jsonb(t),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.assigned_at,a.id) from public.work_task_assignments a where a.task_id=t.id and (a.ended_at is null or a.state in ('completed','cancelled'))),'[]'),
    'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.participant_role,p.id) from public.work_task_participants p where p.task_id=t.id and p.ended_at is null),'[]'),
    'checklist',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.id) from public.work_task_checklist_items c where c.task_id=t.id),'[]'),
    'currentSubmission',(select to_jsonb(s) from public.work_task_submissions s where s.task_id=t.id order by s.iteration desc limit 1),
    'attachments',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at,f.id) from public.work_task_attachments f where f.task_id=t.id and f.status='ready' and f.deleted_at is null),'[]'),
    'capabilities',app_private.work_task_capabilities(t.id));
end $$;
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
      t.task_group_id,t.deadline_at,t.created_by,t.reviewer_user_id,t.updated_at,t.lock_version
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

alter function app_private.work_task_capabilities(uuid) rename to work_task_read_capabilities;
create function app_private.work_task_capabilities(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid:=public.current_app_user_id(); t public.work_tasks%rowtype; mine public.work_task_assignments%rowtype;
  active boolean; accepted boolean; assignable boolean; manager boolean; ctx text; scope_id text;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  select * into strict t from public.work_tasks where id=p_task_id;
  select * into mine from public.work_task_assignments where task_id=p_task_id and user_id=a and ended_at is null;
  active:=t.status not in ('completed','cancelled'); accepted:=mine.id is not null and mine.acknowledged_at is not null;
  ctx:=case when t.scope_type='direct' then 'own' else t.scope_type end; scope_id:=coalesce(t.department_id::text,t.project_id,'*');
  assignable:=app_private.has_permission(a,'work.task.assign_user',ctx,scope_id);
  manager:=app_private.has_permission(a,'work.task.manage_scope',case when ctx='own' then 'global' else ctx end,scope_id);
  return app_private.work_task_read_capabilities(p_task_id)||jsonb_build_object(
    'canAcknowledge',active and mine.id is not null and mine.acknowledged_at is null,
    'canRequestClarification',active and mine.id is not null and mine.acknowledged_at is null,
    'canStart',active and accepted and t.status in ('not_started','changes_requested'),
    'canBlock',active and accepted and t.status='in_progress',
    'canUnblock',active and accepted and t.status='blocked',
    'canSubmit',active and accepted and t.status in ('in_progress','changes_requested'),
    'canReview',active and t.status='awaiting_review' and t.reviewer_user_id=a and (
      app_private.has_permission(a,'work.task.review','assigned','*')
      or (ctx<>'own' and app_private.has_permission(a,'work.task.review',ctx,scope_id))),
    'canCancel',active and (t.created_by=a or manager),
    'canTransfer',active and mine.id is not null and assignable,
    'canAddAssignees',active and (t.created_by=a or accepted or manager) and assignable);
end $$;
revoke all on function app_private.work_task_capabilities(uuid) from public,anon,authenticated;

create function app_private.work_assert_assignment_recipient(p_task_id uuid,p_user_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
declare t public.work_tasks%rowtype; ctx text; scope_id text; related boolean;
begin
  select * into strict t from public.work_tasks where id=p_task_id;
  ctx:=case when t.scope_type='direct' then 'global' else t.scope_type end; scope_id:=coalesce(t.department_id::text,t.project_id,'*');
  if p_user_id is null or not exists(select 1 from public.users where id=p_user_id and is_active and account_status='ACTIVE')
    or not app_private.has_permission(p_user_id,'work.module.access','global','*')
    or not (app_private.has_permission(p_user_id,'work.task.view_related','assigned','*')
      or app_private.has_permission(p_user_id,'work.task.view_related',ctx,scope_id)
      or app_private.has_permission(p_user_id,'work.task.view_scope',ctx,scope_id)
      or (t.created_by=p_user_id and app_private.has_permission(p_user_id,'work.task.view_related','own','*'))) then raise exception 'WORK_RECIPIENT_INELIGIBLE' using errcode='42501'; end if;
  related:=t.created_by=p_user_id or exists(select 1 from public.work_task_assignments where task_id=t.id and user_id=p_user_id)
    or exists(select 1 from public.work_task_participants where task_id=t.id and user_id=p_user_id and ended_at is null);
  if t.privacy='restricted' and not related and not app_private.has_permission(p_user_id,'work.task.view_restricted',ctx,scope_id) then
    raise exception 'WORK_RESTRICTED_RECIPIENT_DENIED' using errcode='42501'; end if;
end $$;
revoke all on function app_private.work_assert_assignment_recipient(uuid,uuid) from public,anon,authenticated;

create function app_private.work_command_task(p_task_id uuid,p_command text,p_payload jsonb,p_expected_lock_version bigint,p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a uuid:=public.current_app_user_id(); t public.work_tasks%rowtype; mine public.work_task_assignments%rowtype;
  prior app_private.work_command_idempotency%rowtype; caps jsonb; capability text; allowed text[];
  hash text:=md5(jsonb_build_object('taskId',p_task_id,'command',p_command,'payload',p_payload,'expectedVersion',p_expected_lock_version)::text);
  note text:=nullif(btrim(p_payload->>'reason'),''); state text; event_type text; payload jsonb; event_id uuid;
  new_assignment uuid; new_user uuid; result_text text; submission_id uuid; response jsonb;
begin
  if a is null or not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  if p_idempotency_key is null or p_expected_lock_version is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'WORK_INVALID_COMMAND' using errcode='22023'; end if;
  capability:=case p_command when 'acknowledge' then 'canAcknowledge' when 'request_clarification' then 'canRequestClarification'
    when 'start' then 'canStart' when 'block' then 'canBlock' when 'unblock' then 'canUnblock' when 'submit' then 'canSubmit'
    when 'review' then 'canReview' when 'cancel' then 'canCancel' when 'transfer' then 'canTransfer' when 'add_assignees' then 'canAddAssignees' end;
  allowed:=case p_command when 'request_clarification' then array['reason'] when 'block' then array['reason']
    when 'submit' then array['result'] when 'review' then array['decision','reason'] when 'cancel' then array['reason']
    when 'transfer' then array['userId','reason'] when 'add_assignees' then array['userIds'] else '{}'::text[] end;
  if capability is null or p_payload-allowed<>'{}'::jsonb or length(coalesce(note,''))>4000 then raise exception 'WORK_INVALID_COMMAND' using errcode='22023'; end if;
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
    values(a,p_idempotency_key,'command_work_task',hash) on conflict do nothing;
  select * into strict prior from app_private.work_command_idempotency where actor_user_id=a and idempotency_key=p_idempotency_key for update;
  if prior.command_name<>'command_work_task' or prior.request_hash<>hash then raise exception 'WORK_IDEMPOTENCY_CONFLICT'; end if;
  if prior.response_payload is not null then return prior.response_payload; end if;
  select * into strict t from public.work_tasks where id=p_task_id for update;
  if not app_private.work_task_actor_can_view(t.id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  if t.lock_version<>p_expected_lock_version then raise exception 'WORK_VERSION_CONFLICT'; end if;
  if t.status in ('completed','cancelled') then raise exception 'WORK_TASK_TERMINAL'; end if;
  caps:=app_private.work_task_capabilities(t.id);
  if not coalesce((caps->>capability)::boolean,false) then raise exception 'WORK_COMMAND_DENIED' using errcode='42501'; end if;
  if (p_command in ('request_clarification','block','cancel','transfer') or (p_command='review' and p_payload->>'decision'='request_changes')) and note is null then
    raise exception 'WORK_REASON_REQUIRED' using errcode='22023'; end if;
  select * into mine from public.work_task_assignments where task_id=t.id and user_id=a and ended_at is null;
  state:=t.status; payload:=jsonb_strip_nulls(jsonb_build_object('command',p_command,'reason',note,'beforeStatus',t.status));
  case p_command
  when 'acknowledge' then
    update public.work_task_assignments set acknowledged_at=now(),state='not_started',updated_at=now() where id=mine.id;
    perform app_private.work_apply_assignment_sla(mine.id,false);
    if state in ('pending_acknowledgement','clarification_requested') then state:='not_started'; end if;
    event_type:='assignment.acknowledged'; payload:=payload||jsonb_build_object('assignmentId',mine.id);
  when 'request_clarification' then
    update public.work_task_assignments set state='clarification_requested',clarification_requested_at=now(),clarification_note=note,updated_at=now() where id=mine.id;
    if not exists(select 1 from public.work_task_assignments where task_id=t.id and ended_at is null and acknowledged_at is not null) then state:='clarification_requested'; end if;
    event_type:='assignment.clarification_requested'; payload:=payload||jsonb_build_object('assignmentId',mine.id);
  when 'start' then
    state:='in_progress'; event_type:='task.started';
    update public.work_task_assignments set state='in_progress',started_at=coalesce(started_at,now()),updated_at=now() where id=mine.id;
    update public.work_tasks set started_at=coalesce(started_at,now()) where id=t.id;
  when 'block' then
    state:='blocked'; event_type:='task.blocked';
    update public.work_tasks set blocked_reason=note where id=t.id;
    update public.work_task_assignments set state='blocked',blocked_at=now(),blocked_reason=note,updated_at=now() where id=mine.id;
  when 'unblock' then
    state:='in_progress'; event_type:='task.unblocked';
    update public.work_tasks set blocked_reason=null where id=t.id;
    update public.work_task_assignments set state='in_progress',blocked_reason=null,blocked_at=null,updated_at=now()
      where task_id=t.id and ended_at is null and acknowledged_at is not null and work_task_assignments.state='blocked';
  when 'submit' then
    result_text:=app_private.work_validate_document(p_payload->'result');
    if nullif(btrim(result_text),'') is null then raise exception 'WORK_RESULT_REQUIRED' using errcode='22023'; end if;
    insert into public.work_task_submissions(task_id,iteration,submitted_by,result_document,result_text,status,reviewed_by,reviewed_at)
    values(t.id,(select coalesce(max(iteration),0)+1 from public.work_task_submissions where task_id=t.id),a,p_payload->'result',result_text,
      case when t.review_policy='auto_complete' then 'approved' else 'pending_review' end,
      case when t.review_policy='auto_complete' then a end,case when t.review_policy='auto_complete' then now() end) returning id into submission_id;
    state:=case when t.review_policy='auto_complete' then 'completed' else 'awaiting_review' end;
    event_type:=case when state='completed' then 'task.completed' else 'task.review_submitted' end;
    payload:=payload||jsonb_build_object('submissionId',submission_id,'reviewPolicy',t.review_policy);
    if state='awaiting_review' then update public.work_task_assignments set state='awaiting_review',updated_at=now()
      where task_id=t.id and ended_at is null and acknowledged_at is not null; end if;
  when 'review' then
    if coalesce(p_payload->>'decision','') not in ('approve','request_changes') then raise exception 'WORK_INVALID_REVIEW_DECISION' using errcode='22023'; end if;
    select id into submission_id from public.work_task_submissions where task_id=t.id and status='pending_review' for update;
    if submission_id is null then raise exception 'WORK_SUBMISSION_NOT_PENDING'; end if;
    update public.work_task_submissions set status=case when p_payload->>'decision'='approve' then 'approved' else 'changes_requested' end,
      reviewed_by=a,reviewed_at=now(),review_note=note where id=submission_id;
    state:=case when p_payload->>'decision'='approve' then 'completed' else 'changes_requested' end;
    event_type:=case when state='completed' then 'task.completed' else 'task.changes_requested' end;
    payload:=payload||jsonb_build_object('submissionId',submission_id);
    if state='changes_requested' then update public.work_task_assignments set state='changes_requested',updated_at=now()
      where task_id=t.id and ended_at is null and acknowledged_at is not null; end if;
  when 'cancel' then
    state:='cancelled'; event_type:='task.cancelled';
  when 'transfer' then
    new_user:=(p_payload->>'userId')::uuid;
    perform app_private.work_assert_assignment_recipient(t.id,new_user);
    if exists(select 1 from public.work_task_assignments where task_id=t.id and user_id=new_user and ended_at is null) then raise exception 'WORK_ASSIGNEE_ALREADY_ACTIVE'; end if;
    update public.work_task_assignments set state='transferred',ended_at=now(),transfer_reason=note,updated_at=now() where id=mine.id;
    insert into public.work_task_assignments(task_id,user_id,assigned_by,transfer_from_assignment_id,transfer_reason)
      values(t.id,new_user,a,mine.id,note) returning id into new_assignment;
    update public.work_task_assignments set transfer_to_assignment_id=new_assignment where id=mine.id;
    perform app_private.work_apply_assignment_sla(new_assignment,true);
    if state in ('pending_acknowledgement','clarification_requested','not_started') and not exists(select 1 from public.work_task_assignments where task_id=t.id and ended_at is null and acknowledged_at is not null) then state:='pending_acknowledgement'; end if;
    event_type:='assignment.transferred'; payload:=payload||jsonb_build_object('fromAssignmentId',mine.id,'toAssignmentId',new_assignment,'toUserId',new_user);
  when 'add_assignees' then
    if jsonb_typeof(p_payload->'userIds') is distinct from 'array' then raise exception 'WORK_INVALID_RECIPIENT_SOURCES' using errcode='22023'; end if;
    if jsonb_array_length(p_payload->'userIds') not between 1 and 100 or
      (select count(*) from public.work_task_assignments where task_id=t.id and ended_at is null)+jsonb_array_length(p_payload->'userIds')>500 then raise exception 'WORK_RECIPIENT_LIMIT' using errcode='22023'; end if;
    for new_user in select distinct value::uuid from jsonb_array_elements_text(p_payload->'userIds') loop
      perform app_private.work_assert_assignment_recipient(t.id,new_user);
      if exists(select 1 from public.work_task_assignments where task_id=t.id and user_id=new_user and ended_at is null) then raise exception 'WORK_ASSIGNEE_ALREADY_ACTIVE'; end if;
      insert into public.work_task_assignments(task_id,user_id,assigned_by,state,acknowledged_at)
        values(t.id,new_user,a,case when new_user=a then 'not_started' else 'pending_acknowledgement' end,case when new_user=a then now() end) returning id into new_assignment;
      perform app_private.work_apply_assignment_sla(new_assignment,true);
      if new_user=a and state in ('pending_acknowledgement','clarification_requested') then state:='not_started'; end if;
    end loop;
    event_type:='assignment.co_assignees_added'; payload:=payload||jsonb_build_object('userIds',p_payload->'userIds');
  end case;
  -- Adding/transferring responsibility makes a self-only auto-complete task reviewed.
  if p_command in ('transfer','add_assignees') and t.review_policy='auto_complete' then
    if not app_private.has_permission(t.created_by,'work.task.review','assigned','*') then raise exception 'WORK_REVIEWER_INELIGIBLE' using errcode='42501'; end if;
    update public.work_tasks set review_policy='creator_review',reviewer_user_id=t.created_by where id=t.id;
    insert into public.work_task_participants(task_id,user_id,participant_role,added_by) values(t.id,t.created_by,'reviewer',a);
    payload:=payload||jsonb_build_object('reviewPolicy','creator_review');
  end if;
  if state='completed' then
    update public.work_task_assignments set state='completed',completed_at=now(),ended_at=now(),updated_at=now() where task_id=t.id and ended_at is null;
  elsif state='cancelled' then
    update public.work_task_assignments set state='cancelled',ended_at=now(),updated_at=now() where task_id=t.id and ended_at is null;
  end if;
  update public.work_tasks set status=state,lock_version=lock_version+1,updated_at=now(),
    completed_at=case when state='completed' then now() else completed_at end,
    cancelled_at=case when state='cancelled' then now() else cancelled_at end,
    blocked_reason=case when state='blocked' then blocked_reason else null end where id=t.id returning * into t;
  payload:=payload||jsonb_build_object('afterStatus',t.status,'lockVersion',t.lock_version);
  insert into public.work_task_versions(task_id,version,snapshot,actor_user_id,idempotency_key)
    values(t.id,t.lock_version,jsonb_build_object('task',to_jsonb(t),'change',payload),a,p_idempotency_key);
  insert into public.work_task_events(task_id,event_type,actor_user_id,payload,idempotency_key) values(t.id,event_type,a,payload,p_idempotency_key) returning id into event_id;
  insert into app_private.work_notification_outbox(event_id,task_id,event_type,payload) values(event_id,t.id,event_type,jsonb_build_object('taskId',t.id));
  response:=jsonb_build_object('taskId',t.id,'taskCode',t.task_code,'status',t.status,'lockVersion',t.lock_version,'capabilities',app_private.work_task_capabilities(t.id));
  update app_private.work_command_idempotency set response_payload=response,completed_at=now() where actor_user_id=a and idempotency_key=p_idempotency_key;
  return response;
end $$;
revoke all on function app_private.work_command_task(uuid,text,jsonb,bigint,uuid) from public,anon,authenticated;
create function public.command_work_task(p_task_id uuid,p_command text,p_payload jsonb,p_expected_lock_version bigint,p_idempotency_key uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select app_private.work_command_task(p_task_id,p_command,p_payload,p_expected_lock_version,p_idempotency_key);
$$;
revoke all on function public.command_work_task(uuid,text,jsonb,bigint,uuid) from public,anon,authenticated;
grant execute on function public.command_work_task(uuid,text,jsonb,bigint,uuid) to authenticated;
grant execute on function app_private.work_command_task(uuid,text,jsonb,bigint,uuid) to authenticated;

-- Clone current responsibility after transfer/add; preserve stored initial provenance.
create or replace function app_private.work_get_clone_draft(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.work_tasks%rowtype; draft jsonb; v_scope jsonb; v_members jsonb; v_sources jsonb;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  select * into strict t from public.work_tasks where id=p_task_id;
  v_scope:=jsonb_strip_nulls(jsonb_build_object('type',t.scope_type,'departmentId',t.department_id,'projectId',t.project_id));
  perform app_private.work_assert_create_scope(v_scope);
  select coalesce(jsonb_agg(to_jsonb(q.user_id) order by q.user_id),'[]') into v_members from (
    select distinct a.user_id from public.work_task_assignments a where a.task_id=t.id and (
      a.ended_at is null or (t.status='completed' and a.state='completed') or (t.status='cancelled' and a.state='cancelled'))
  ) q;
  if v_members is distinct from (select coalesce(jsonb_agg(to_jsonb(m.user_id) order by m.user_id),'[]') from public.work_task_recipient_members m where m.task_id=t.id) then
    select coalesce(jsonb_agg(jsonb_build_object('type','user','id',x) order by x),'[]') into v_sources from jsonb_array_elements(v_members) x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('type',s.source_type,'id',s.source_id) order by s.sort_order,s.id),'[]')
      into v_sources from public.work_task_recipient_specs s where s.task_id=t.id;
  end if;
  draft:=jsonb_strip_nulls(jsonb_build_object('title',t.title,'description',t.description_document,'scope',v_scope,
    'taskGroupId',t.task_group_id,'labels',t.labels,'priority',t.priority,'privacy',t.privacy,
    'recipientSources',v_sources,
    'watcherUserIds',coalesce((select jsonb_agg(p.user_id order by p.user_id) from public.work_task_participants p
      where p.task_id=t.id and p.participant_role='watcher' and p.ended_at is null),'[]'),
    'reviewerUserId',t.reviewer_user_id,'reviewPolicy',t.review_policy,
    'checklist',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('title',c.title,'assigneeUserId',case when v_members @> jsonb_build_array(c.assignee_user_id) then c.assignee_user_id end)) order by c.sort_order,c.id)
      from public.work_task_checklist_items c where c.task_id=t.id and c.completed_at is null),'[]'),
    'clonedFromTaskId',t.id,'deadlineAt',case when t.deadline_at>now() then t.deadline_at end));
  return jsonb_build_object('draft',draft,'requiresDeadlineConfirmation',coalesce(t.deadline_at<=now(),false),
    'recipientSnapshot',coalesce((select jsonb_agg(jsonb_build_object('userId',x) order by x) from jsonb_array_elements(v_members) x),'[]'));
end $$;

-- Task 5: collaboration, independent item/comment versions and canonical audit access.
-- This migration does not activate notification delivery or grant any pilot access.
alter table public.work_task_checklist_items add column deleted_at timestamptz;
alter table public.work_task_checklist_items add column deleted_by uuid references public.users(id) on delete restrict;
alter table public.work_task_checklist_items add constraint work_checklist_deletion_check check ((deleted_at is null)=(deleted_by is null));
create index work_checklist_deleted_by_idx on public.work_task_checklist_items(deleted_by) where deleted_by is not null;
create trigger work_checklist_preserve_history before delete on public.work_task_checklist_items
for each row execute function app_private.work_reject_history_mutation();
create trigger work_comments_preserve_history before delete on public.work_task_comments
for each row execute function app_private.work_reject_history_mutation();

-- One visibility implementation for the session actor and internal mention validation.
-- Never expose the arbitrary-user predicate through an authenticated RPC.
create function app_private.work_task_user_can_view(p_task_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := p_user_id;
  v_task record;
  v_is_creator boolean := false;
  v_is_assignee boolean := false;
  v_is_participant boolean := false;
  v_related_allowed boolean := false;
  v_scope_allowed boolean := false;
  v_restricted_allowed boolean := false;
begin
  if v_actor_id is null or not exists(select 1 from public.users where id=v_actor_id and is_active and account_status='ACTIVE')
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

revoke all on function app_private.work_task_user_can_view(uuid,uuid) from public,anon,authenticated;
create or replace function app_private.work_task_actor_can_view(p_task_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select app_private.work_task_user_can_view(p_task_id,public.current_app_user_id());
$$;

create function app_private.work_task_actor_can_audit(p_task_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id(); v_task public.work_tasks%rowtype;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then return false; end if;
  select * into strict v_task from public.work_tasks where id=p_task_id;
  return app_private.has_permission(v_actor,'work.task.audit_view',case when v_task.scope_type='direct' then 'global' else v_task.scope_type end,coalesce(v_task.department_id::text,v_task.project_id,'*'))
    or (v_task.created_by=v_actor and app_private.has_permission(v_actor,'work.task.audit_view','own','*'))
    or (app_private.has_permission(v_actor,'work.task.audit_view','assigned','*') and (
      exists(select 1 from public.work_task_assignments where task_id=p_task_id and user_id=v_actor)
      or exists(select 1 from public.work_task_participants where task_id=p_task_id and user_id=v_actor and ended_at is null)));
end $$;
revoke all on function app_private.work_task_actor_can_audit(uuid) from public,anon,authenticated;
grant execute on function app_private.work_task_actor_can_audit(uuid) to authenticated;
alter policy work_task_events_select on public.work_task_events using (app_private.work_task_actor_can_audit(task_id));
alter policy work_task_versions_select on public.work_task_versions using (app_private.work_task_actor_can_audit(task_id));
alter policy work_task_checklist_items_select on public.work_task_checklist_items using (deleted_at is null and app_private.work_task_actor_can_view(task_id));

create or replace function app_private.work_task_read_capabilities(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_task public.work_tasks%rowtype;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  select * into strict v_task from public.work_tasks where id=p_task_id;
  return jsonb_build_object('canClone',app_private.has_permission(public.current_app_user_id(),'work.task.create',case when v_task.scope_type='direct' then 'own' else v_task.scope_type end,coalesce(v_task.department_id::text,v_task.project_id,'*')),
    'canViewHistory',app_private.work_task_actor_can_audit(p_task_id));
end $$;

create or replace function app_private.work_task_capabilities(p_task_id uuid)
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
    'canAddAssignees',active and (t.created_by=a or accepted or manager) and assignable,
    'canManageChecklist',active and t.status<>'awaiting_review' and (t.created_by=a or accepted or manager),
    'canComment',active and (t.created_by=a or mine.id is not null or manager
      or exists(select 1 from public.work_task_participants where task_id=t.id and user_id=a and ended_at is null)),
    'canSetPreferences',true);
end $$;
revoke all on function app_private.work_task_capabilities(uuid) from public,anon,authenticated;

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
    'checklist',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.id) from public.work_task_checklist_items c where c.task_id=t.id and c.deleted_at is null),'[]'),
    'currentSubmission',(select to_jsonb(s) from public.work_task_submissions s where s.task_id=t.id order by s.iteration desc limit 1),
    'attachments',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at,f.id) from public.work_task_attachments f where f.task_id=t.id and f.status='ready' and f.deleted_at is null),'[]'),
    'capabilities',app_private.work_task_capabilities(t.id),
    'preferences',jsonb_build_object(
      'pinned',exists(select 1 from public.work_task_pins where task_id=t.id and user_id=public.current_app_user_id()),
      'notificationsEnabled',coalesce((select notifications_enabled from public.work_task_notification_preferences where task_id=t.id and user_id=public.current_app_user_id()),true)));
end $$;
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
      from public.work_task_checklist_items c where c.task_id=t.id and c.completed_at is null and c.deleted_at is null),'[]'),
    'clonedFromTaskId',t.id,'deadlineAt',case when t.deadline_at>now() then t.deadline_at end));
  return jsonb_build_object('draft',draft,'requiresDeadlineConfirmation',coalesce(t.deadline_at<=now(),false),
    'recipientSnapshot',coalesce((select jsonb_agg(jsonb_build_object('userId',x) order by x) from jsonb_array_elements(v_members) x),'[]'));
end $$;

-- Content mutations serialize with lifecycle changes; comment versions remain independent.
create function app_private.work_command_collaboration(p_task_id uuid,p_command text,p_payload jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=public.current_app_user_id(); v_task public.work_tasks%rowtype;
  v_prior app_private.work_command_idempotency%rowtype; v_caps jsonb; v_allowed text[];
  v_hash text:=md5(jsonb_build_object('taskId',p_task_id,'command',p_command,'payload',p_payload)::text);
  v_item public.work_task_checklist_items%rowtype; v_comment public.work_task_comments%rowtype;
  v_before jsonb; v_after jsonb; v_response jsonb; v_event_type text; v_event_id uuid;
  v_assignee uuid; v_text text; v_mentions uuid[]:='{}'; v_old_mentions uuid[]:='{}'; v_new_mentions uuid[]:='{}';
  v_user uuid; v_bool boolean;
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
    when 'set_notifications' then array['notificationsEnabled'] end;
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

  if p_command like 'checklist_%' then
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
revoke all on function app_private.work_command_collaboration(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function app_private.work_command_collaboration(uuid,text,jsonb,uuid) to authenticated;
create function public.command_work_task_collaboration(p_task_id uuid,p_command text,p_payload jsonb,p_idempotency_key uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.work_command_collaboration(p_task_id,p_command,p_payload,p_idempotency_key);
$$;
revoke all on function public.command_work_task_collaboration(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.command_work_task_collaboration(uuid,text,jsonb,uuid) to authenticated;

-- Lazy readers: stable tie-breaking, hard bounds, no history embedded in task detail.
create function app_private.work_list_thread(p_task_id uuid,p_kind text,p_filters jsonb,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_n integer:=least(100,greatest(1,coalesce(p_limit,50))); v_rows jsonb;
  v_at timestamptz; v_id uuid; v_actor_filter uuid; v_category text; v_can_comment boolean;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('comments','history') then raise exception 'WORK_INVALID_THREAD' using errcode='22023'; end if;
  if p_kind='history' and not app_private.work_task_actor_can_audit(p_task_id) then raise exception 'WORK_AUDIT_DENIED' using errcode='42501'; end if;
  if jsonb_typeof(p_filters) is distinct from 'object' or p_filters-array['category','actorUserId']<>'{}'::jsonb
    or (p_kind='comments' and p_filters<>'{}'::jsonb) then raise exception 'WORK_INVALID_FILTER' using errcode='22023'; end if;
  v_category:=p_filters->>'category'; v_actor_filter:=(p_filters->>'actorUserId')::uuid;
  if v_category is not null and v_category not in ('status','assignees','files','comments','sla','permissions','checklist') then raise exception 'WORK_INVALID_FILTER' using errcode='22023'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor-array['sortAt','id']<>'{}'::jsonb
      or p_cursor->>'sortAt' is null or p_cursor->>'id' is null then raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end if;
    v_at:=(p_cursor->>'sortAt')::timestamptz; v_id:=(p_cursor->>'id')::uuid;
    if not isfinite(v_at) then raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end if;
  end if;
  if p_kind='comments' then
    v_can_comment:=(app_private.work_task_capabilities(p_task_id)->>'canComment')::boolean;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]') into v_rows from (
      select c.*,coalesce((select jsonb_agg(m.mentioned_user_id order by m.mentioned_user_id) from public.work_task_mentions m where m.comment_id=c.id),'[]') as "mentionedUserIds",
        (c.author_user_id=public.current_app_user_id() and v_can_comment) as can_edit
      from public.work_task_comments c where c.task_id=p_task_id and (v_at is null or (c.created_at,c.id)<(v_at,v_id))
      order by c.created_at desc,c.id desc limit v_n+1
    ) q;
  else
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]') into v_rows from (
      select e.* from public.work_task_events e where e.task_id=p_task_id and (v_at is null or (e.created_at,e.id)<(v_at,v_id))
        and (v_actor_filter is null or e.actor_user_id=v_actor_filter)
        and (v_category is null or case v_category
          when 'comments' then e.event_type like 'comment.%'
          when 'checklist' then e.event_type like 'checklist.%'
          when 'files' then e.event_type like 'attachment.%' or e.event_type like 'file.%'
          when 'sla' then e.event_type like 'sla.%' or e.event_type like 'assignment.sla_%'
          when 'permissions' then e.event_type like 'permission.%' or e.event_type like 'task.privacy%'
          when 'assignees' then e.event_type like 'assignment.%' or e.event_type in ('task.assignees_added','task.transferred')
          when 'status' then e.event_type like 'task.%' and e.event_type not in ('task.assignees_added','task.transferred') and e.event_type not like 'task.privacy%' end)
      order by e.created_at desc,e.id desc limit v_n+1
    ) q;
  end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(v_rows) with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then jsonb_build_object('sortAt',v_rows->(v_n-1)->'created_at','id',v_rows->(v_n-1)->'id') else null end);
end $$;
revoke all on function app_private.work_list_thread(uuid,text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function app_private.work_list_thread(uuid,text,jsonb,jsonb,integer) to authenticated;
create function public.list_work_task_comments(p_task_id uuid,p_cursor jsonb default null,p_limit integer default 50)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.work_list_thread(p_task_id,'comments','{}',p_cursor,p_limit);
$$;
create function public.list_work_task_history(p_task_id uuid,p_filters jsonb default '{}',p_cursor jsonb default null,p_limit integer default 50)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.work_list_thread(p_task_id,'history',p_filters,p_cursor,p_limit);
$$;
revoke all on function public.list_work_task_comments(uuid,jsonb,integer) from public,anon,authenticated;
revoke all on function public.list_work_task_history(uuid,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.list_work_task_comments(uuid,jsonb,integer) to authenticated;
grant execute on function public.list_work_task_history(uuid,jsonb,jsonb,integer) to authenticated;

create function app_private.work_list_mention_candidates(p_task_id uuid,p_search text,p_cursor uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_n integer:=least(50,greatest(1,coalesce(p_limit,20))); v_rows jsonb;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  if char_length(coalesce(p_search,''))>100 then raise exception 'WORK_INVALID_SEARCH' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."userId"),'[]') into v_rows from (
    select u.id as "userId",u.name from public.users u where u.is_active and u.account_status='ACTIVE'
      and (p_cursor is null or u.id>p_cursor)
      and (nullif(btrim(p_search),'') is null or strpos(lower(u.name),lower(btrim(p_search)))>0)
      and app_private.work_task_user_can_view(p_task_id,u.id)
    order by u.id limit v_n+1
  ) q;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(v_rows) with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then v_rows->(v_n-1)->'userId' else null end);
end $$;
revoke all on function app_private.work_list_mention_candidates(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function app_private.work_list_mention_candidates(uuid,text,uuid,integer) to authenticated;
create function public.list_work_task_mention_candidates(p_task_id uuid,p_search text default '',p_cursor uuid default null,p_limit integer default 20)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.work_list_mention_candidates(p_task_id,p_search,p_cursor,p_limit);
$$;
revoke all on function public.list_work_task_mention_candidates(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_work_task_mention_candidates(uuid,text,uuid,integer) to authenticated;

-- Derive mentions from validated inline document nodes; client ID lists are non-authoritative.
-- Inline mention nodes are the only authority for mention recipients.
create or replace function app_private.work_validate_comment_document(p_task_id uuid,p_document jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_paragraph jsonb; v_node jsonb; v_mark jsonb; v_type text; v_text text:='';
  v_user uuid; v_mentions uuid[]:='{}'; v_label text; v_first boolean:=true;
begin
  if jsonb_typeof(p_document) is distinct from 'object' or p_document-array['version','type','content']<>'{}'::jsonb
    or p_document->>'type'<>'doc' or p_document->>'version'<>'1' or jsonb_typeof(p_document->'content') is distinct from 'array'
    or jsonb_array_length(p_document->'content')>500 then raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
  for v_paragraph in select value from jsonb_array_elements(p_document->'content') loop
    if jsonb_typeof(v_paragraph) is distinct from 'object' or v_paragraph-array['type','content']<>'{}'::jsonb
      or v_paragraph->>'type'<>'paragraph' or jsonb_typeof(v_paragraph->'content') is distinct from 'array'
      or jsonb_array_length(v_paragraph->'content')>500 then raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
    if not v_first then v_text:=v_text||E'\n'; end if; v_first:=false;
    for v_node in select value from jsonb_array_elements(v_paragraph->'content') loop
      if jsonb_typeof(v_node) is distinct from 'object' then raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
      v_type:=v_node->>'type';
      if v_type='text' then
        if v_node-array['type','text','marks']<>'{}'::jsonb or not (v_node ?& array['type','text'])
          or jsonb_typeof(v_node->'text') is distinct from 'string' or char_length(v_node->>'text')>10000 then raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
        if v_node ? 'marks' then
          if jsonb_typeof(v_node->'marks') is distinct from 'array' or jsonb_array_length(v_node->'marks')>20 then raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
          for v_mark in select value from jsonb_array_elements(v_node->'marks') loop
            if jsonb_typeof(v_mark) is distinct from 'object' or v_mark-array['type']<>'{}'::jsonb
              or v_mark->>'type' not in ('bold','italic','strike','code') then raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
          end loop;
        end if;
        v_text:=v_text||(v_node->>'text');
      elsif v_type='mention' then
        if v_node-array['type','userId','label']<>'{}'::jsonb or not (v_node ?& array['type','userId','label'])
          or jsonb_typeof(v_node->'userId') is distinct from 'string' or jsonb_typeof(v_node->'label') is distinct from 'string'
          or char_length(btrim(v_node->>'label')) not between 1 and 200 then raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
        begin v_user:=(v_node->>'userId')::uuid; exception when invalid_text_representation then raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end;
        if not app_private.work_task_user_can_view(p_task_id,v_user) then raise exception 'WORK_MENTION_INELIGIBLE' using errcode='42501'; end if;
        v_label:=btrim(v_node->>'label'); v_text:=v_text||'@'||v_label;
        if not (v_user=any(v_mentions)) then v_mentions:=array_append(v_mentions,v_user); end if;
        if cardinality(v_mentions)>50 then raise exception 'WORK_MENTION_LIMIT' using errcode='22023'; end if;
      else raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
    end loop;
  end loop;
  return jsonb_build_object('text',v_text,'mentionedUserIds',to_jsonb(v_mentions));
end $$;
revoke all on function app_private.work_validate_comment_document(uuid,jsonb) from public,anon,authenticated,service_role;

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
    v_after:=app_private.work_validate_comment_document(p_task_id,p_payload->'content');
    v_text:=v_after->>'text';
    if char_length(btrim(v_text)) not between 1 and 10000 then raise exception 'WORK_INVALID_COMMENT' using errcode='22023'; end if;
    select coalesce(array_agg(value::uuid order by value::uuid),'{}') into v_mentions
      from jsonb_array_elements_text(v_after->'mentionedUserIds');
    v_after:=null;
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

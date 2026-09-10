begin;
create temporary table work_collab_people(name text primary key,id uuid,email text) on commit drop;
create temporary table work_collab_data(key text primary key,value jsonb) on commit drop;
grant select on work_collab_people to authenticated;
grant all on work_collab_data to authenticated;
insert into work_collab_people select name,gen_random_uuid(),'collab-'||gen_random_uuid()||'@invalid.local'
from unnest(array['creator','assignee','watcher','replacement','outsider','inactive','manager','reviewer']) name;
insert into public.users(id,name,username,email,role,is_active,account_status)
select id,name,'collab-'||id,email,'EMPLOYEE',name<>'inactive',case when name='inactive' then 'DISABLED' else 'ACTIVE' end from work_collab_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.module.access','global','*','rollback smoke' from work_collab_people where name<>'inactive';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,code,'global','*','rollback smoke' from work_collab_people cross join unnest(array['work.task.view_related','work.task.assign_user','work.task.review']) code where name not in ('inactive');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,code,'own','*','rollback smoke' from work_collab_people cross join unnest(array['work.task.create','work.task.audit_view']) code where name='creator';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.audit_view','assigned','*','rollback smoke' from work_collab_people where name in ('assignee','manager');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
select id,'work.task.manage_scope','global','*','rollback smoke',now()+interval '1 day' from work_collab_people where name='creator';
insert into public.work_sla_calendars(name,workday_start,workday_end,is_default,created_by)
select 'Collaboration rollback calendar','08:00','17:00',true,id from work_collab_people where name='creator';
create function pg_temp.work_as(p_name text) returns void language plpgsql security invoker set search_path='' as $$ begin
  perform set_config('request.jwt.claims',(select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text from pg_temp.work_collab_people where name=p_name),true);
end $$;
create function pg_temp.work_doc(p_text text) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('version',1,'type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text',p_text)))));
$$;
create function pg_temp.work_mention_doc(p_text text,p_users uuid[]) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'version',1,
    'type','doc',
    'content',jsonb_build_array(jsonb_build_object(
      'type','paragraph',
      'content',jsonb_build_array(jsonb_build_object('type','text','text',p_text)) || coalesce((
        select jsonb_agg(jsonb_build_object('type','mention','userId',u::text,'label','Mention') order by ordinal)
        from unnest(p_users) with ordinality as mentions(u,ordinal)
      ),'[]'::jsonb)
    ))
  );
$$;
set local role authenticated;
select pg_temp.work_as('creator');
do $$ declare v_input jsonb; v_preview jsonb; v_result jsonb; begin
  v_input:=jsonb_build_object('title','Collaboration task','description',pg_temp.work_doc('Discussion fixture'),'scope','{"type":"direct"}'::jsonb,
    'recipientSources',jsonb_build_array(jsonb_build_object('type','user','id',(select id from work_collab_people where name='assignee'))),
    'watcherUserIds',jsonb_build_array((select id from work_collab_people where name='watcher')),
    'reviewPolicy','reviewer_review','reviewerUserId',(select id from work_collab_people where name='reviewer'),
    'priority','normal','privacy','standard','labels','[]'::jsonb,'checklist','[]'::jsonb);
  v_preview:=public.preview_work_task_recipients(v_input->'recipientSources',v_input->'scope');
  v_result:=public.create_work_task(v_input,gen_random_uuid(),v_preview->>'fingerprint');
  insert into work_collab_data values('input',v_input),('task',v_result);
  v_result:=public.create_work_task(v_input||'{"privacy":"restricted"}',gen_random_uuid(),v_preview->>'fingerprint');
  insert into work_collab_data values('restricted',v_result);
end $$;
select pg_temp.work_as('watcher');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); begin
  if exists(select 1 from public.work_task_events where task_id=v_task) then raise exception 'TEST_HISTORY_LEAK_WITHOUT_AUDIT_PERMISSION'; end if;
  begin perform public.list_work_task_history(v_task,'{}',null,20); raise exception 'TEST_HISTORY_RPC_WITHOUT_AUDIT'; exception when insufficient_privilege then null; end;
end $$;
-- A watcher can discuss but has no checklist/lifecycle authority.
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); v_r jsonb; v_key uuid:=gen_random_uuid(); v_payload jsonb; begin
  v_r:=public.get_work_task_detail(v_task::text);
  if v_r->'capabilities'->>'canComment'<>'true' or v_r->'capabilities'->>'canManageChecklist'<>'false' or v_r ? 'comments' or v_r ? 'history' then raise exception 'TEST_WATCHER_CAPABILITIES_OR_EAGER_THREAD'; end if;
  if exists(select 1 from public.work_task_versions where task_id=v_task) then raise exception 'TEST_VERSION_LEAK_WITHOUT_AUDIT'; end if;
  v_payload:=jsonb_build_object('content',pg_temp.work_mention_doc('Original discussion ',array[(select id from work_collab_people where name='assignee'),(select id from work_collab_people where name='assignee')]),'mentionedUserIds',jsonb_build_array((select id from work_collab_people where name='reviewer')));
  v_r:=public.command_work_task_collaboration(v_task,'comment_create',v_payload,v_key);
  if v_r is distinct from public.command_work_task_collaboration(v_task,'comment_create',v_payload,v_key) then raise exception 'TEST_COMMENT_RETRY'; end if;
  if (select count(*) from public.work_task_mentions where comment_id=(v_r->'comment'->>'id')::uuid)<>1 then raise exception 'TEST_MENTION_DEDUPE'; end if;
  insert into work_collab_data values('comment',v_r),('commentPayload',v_payload),('commentKey',to_jsonb(v_key));
  begin perform public.command_work_task_collaboration(v_task,'comment_create',v_payload||jsonb_build_object('content',pg_temp.work_doc('Changed retry')),v_key); raise exception 'TEST_COMMENT_KEY_CONFLICT'; exception when sqlstate 'P0001' then if sqlerrm<>'WORK_IDEMPOTENCY_CONFLICT' then raise; end if; end;
  begin perform public.command_work_task_collaboration(v_task,'checklist_create','{"title":"Unauthorized"}',gen_random_uuid()); raise exception 'TEST_WATCHER_CHECKLIST_ALLOWED'; exception when insufficient_privilege then null; end;
  begin perform public.command_work_task_collaboration(v_task,'comment_create',v_payload||jsonb_build_object('actorUserId',(select id from work_collab_people where name='creator')),gen_random_uuid()); raise exception 'TEST_ACTOR_OVERRIDE'; exception when invalid_parameter_value then null; end;
  begin update public.work_task_comments set content_text='Bypass' where id=(v_r->'comment'->>'id')::uuid; raise exception 'TEST_DIRECT_COMMENT_UPDATE'; exception when insufficient_privilege then null; end;
  perform public.command_work_task_collaboration(v_task,'set_pin','{"pinned":true}',gen_random_uuid());
  perform public.command_work_task_collaboration(v_task,'set_notifications','{"notificationsEnabled":false}',gen_random_uuid());
  v_r:=public.get_work_task_detail(v_task::text);
  if v_r->'preferences'<>'{"pinned":true,"notificationsEnabled":false}' or v_r->'task'->>'lock_version'<>'1' then raise exception 'TEST_PERSONAL_PREFERENCE_OR_COMMENT_CHANGED_TASK_VERSION'; end if;
  if not exists(select 1 from jsonb_array_elements(public.list_work_tasks('pinned')->'items') x where x->>'id'=v_task::text) then raise exception 'TEST_PINNED_LIST'; end if;
end $$;
select pg_temp.work_as('creator');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); v_r jsonb; begin
  if public.get_work_task_detail(v_task::text)->'preferences'<>'{"pinned":false,"notificationsEnabled":true}' or exists(select 1 from public.work_task_pins where task_id=v_task) or exists(select 1 from public.work_task_notification_preferences where task_id=v_task) then raise exception 'TEST_PREFERENCE_ISOLATION'; end if;
  begin perform public.command_work_task_collaboration(v_task,'comment_edit',jsonb_build_object('commentId',(select value->'comment'->>'id' from work_collab_data where key='comment'),'expectedLockVersion',1,'content',pg_temp.work_doc('Overwrite watcher')),gen_random_uuid()); raise exception 'TEST_NONAUTHOR_EDIT'; exception when insufficient_privilege then null; end;
  v_r:=public.command_work_task_collaboration((select (value->>'taskId')::uuid from work_collab_data where key='restricted'),'comment_create',jsonb_build_object('content',pg_temp.work_doc('Other task')),gen_random_uuid());
  insert into work_collab_data values('otherComment',v_r);
end $$;
select pg_temp.work_as('watcher');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); v_r jsonb; v_bad text; v_comment uuid:=(select (value->'comment'->>'id')::uuid from work_collab_data where key='comment'); v_count bigint; begin
  v_r:=public.list_work_task_mention_candidates(v_task,'',null,50);
  if jsonb_array_length(v_r->'items')<>4 or exists(select 1 from jsonb_array_elements(v_r->'items') x where x-array['userId','name']<>'{}') then raise exception 'TEST_MENTION_PICKER_VISIBILITY_OR_PROJECTION %',v_r; end if;
  if public.list_work_task_mention_candidates(v_task,'Outsider')->'items'<>'[]' then raise exception 'TEST_MENTION_PICKER_SEARCH_LEAK'; end if;
  foreach v_bad in array array['outsider','inactive'] loop
    begin perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_mention_doc('Denied mention ',array[(select id from work_collab_people where name=v_bad)])),gen_random_uuid()); raise exception 'TEST_MENTION_VISIBILITY_BYPASS'; exception when insufficient_privilege then null; end;
  end loop;
  begin perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_doc('Cross reply'),'parentCommentId',(select value->'comment'->>'id' from work_collab_data where key='otherComment')),gen_random_uuid()); raise exception 'TEST_CROSS_TASK_REPLY'; exception when insufficient_privilege then null; end;
  begin perform public.command_work_task_collaboration(v_task,'comment_edit',jsonb_build_object('content',pg_temp.work_doc('Cross edit'),'commentId',(select value->'comment'->>'id' from work_collab_data where key='otherComment'),'expectedLockVersion',1),gen_random_uuid()); raise exception 'TEST_CROSS_TASK_EDIT'; exception when insufficient_privilege then null; end;
  begin perform public.command_work_task_collaboration(v_task,'comment_create','{"content":{"version":1,"type":"doc","content":[{"type":"html","content":[]}]}}',gen_random_uuid()); raise exception 'TEST_UNSAFE_DOCUMENT'; exception when invalid_parameter_value then null; end;
  begin perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_doc(' ')),gen_random_uuid()); raise exception 'TEST_EMPTY_COMMENT'; exception when invalid_parameter_value then null; end;
  begin perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_doc(repeat('x',10001))),gen_random_uuid()); raise exception 'TEST_OVERLONG_COMMENT'; exception when invalid_parameter_value then null; end;
  v_r:=public.command_work_task_collaboration(v_task,'comment_edit',jsonb_build_object('commentId',v_comment,'expectedLockVersion',1,'content',pg_temp.work_mention_doc('Edited discussion ',array[(select id from work_collab_people where name='assignee'),(select id from work_collab_people where name='reviewer')])),gen_random_uuid());
  if v_r->'comment'->>'lock_version'<>'2' or v_r->'comment'->>'edited_at' is null or v_r->'comment'->'created_at' is distinct from (select value->'comment'->'created_at' from work_collab_data where key='comment') then raise exception 'TEST_COMMENT_EDIT_VERSION'; end if;
  begin perform public.command_work_task_collaboration(v_task,'comment_edit',jsonb_build_object('commentId',v_comment,'expectedLockVersion',1,'content',pg_temp.work_doc('Stale')),gen_random_uuid()); raise exception 'TEST_STALE_COMMENT'; exception when sqlstate 'P0001' then if sqlerrm<>'WORK_VERSION_CONFLICT' then raise; end if; end;
  if public.command_work_task_collaboration(v_task,'comment_create',(select value from work_collab_data where key='commentPayload'),(select (value#>>'{}')::uuid from work_collab_data where key='commentKey')) is distinct from (select value from work_collab_data where key='comment') then raise exception 'TEST_RETRY_AFTER_EDIT'; end if;
  perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_doc('Valid reply'),'parentCommentId',v_comment),gen_random_uuid());
  perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_doc('Third comment')),gen_random_uuid());
  select count(*) into v_count from public.work_task_comments where task_id=v_task;
  if v_count<>3 then raise exception 'TEST_FAILED_COMMAND_ATOMICITY %',v_count; end if;
end $$;
select pg_temp.work_as('assignee');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); v_r jsonb; v_item uuid; begin
  begin perform public.command_work_task_collaboration(v_task,'checklist_create','{"title":"Pending assignee"}',gen_random_uuid()); raise exception 'TEST_PENDING_CHECKLIST'; exception when insufficient_privilege then null; end;
  perform public.command_work_task(v_task,'acknowledge','{}',1,gen_random_uuid());
  v_r:=public.command_work_task_collaboration(v_task,'checklist_create',jsonb_build_object('title','Evidence','assigneeUserId',public.current_app_user_id(),'sortOrder',10),gen_random_uuid());
  v_item:=(v_r->'item'->>'id')::uuid; insert into work_collab_data values('item',to_jsonb(v_item));
  begin perform public.command_work_task_collaboration(v_task,'checklist_update',jsonb_build_object('itemId',v_item,'expectedLockVersion',1,'assigneeUserId',(select id from work_collab_people where name='watcher')),gen_random_uuid()); raise exception 'TEST_CHECKLIST_NONASSIGNEE'; exception when insufficient_privilege then null; end;
  v_r:=public.command_work_task_collaboration(v_task,'checklist_update',jsonb_build_object('itemId',v_item,'expectedLockVersion',1,'title','Evidence revised','sortOrder',2),gen_random_uuid());
  if v_r->'item'->>'lock_version'<>'2' or v_r->'item'->>'sort_order'<>'2' then raise exception 'TEST_CHECKLIST_UPDATE'; end if;
  begin perform public.command_work_task_collaboration(v_task,'checklist_delete',jsonb_build_object('itemId',v_item,'expectedLockVersion',1),gen_random_uuid()); raise exception 'TEST_CHECKLIST_STALE'; exception when sqlstate 'P0001' then if sqlerrm<>'WORK_VERSION_CONFLICT' then raise; end if; end;
  v_r:=public.command_work_task_collaboration(v_task,'checklist_set_completed',jsonb_build_object('itemId',v_item,'expectedLockVersion',2,'completed',true),gen_random_uuid());
  if v_r->'item'->>'completed_by'<>public.current_app_user_id()::text or v_r->'item'->>'completed_at' is null then raise exception 'TEST_CHECKLIST_COMPLETION'; end if;
  if public.command_work_task_collaboration(v_task,'checklist_set_completed',jsonb_build_object('itemId',v_item,'expectedLockVersion',3,'completed',true),gen_random_uuid()) is distinct from v_r then raise exception 'TEST_COMPLETION_NOOP_REWRITES_EVIDENCE'; end if;
  perform public.command_work_task_collaboration(v_task,'checklist_set_completed',jsonb_build_object('itemId',v_item,'expectedLockVersion',3,'completed',false),gen_random_uuid());
  perform public.command_work_task_collaboration(v_task,'checklist_set_completed',jsonb_build_object('itemId',v_item,'expectedLockVersion',4,'completed',true),gen_random_uuid());
  v_r:=public.command_work_task_collaboration(v_task,'checklist_delete',jsonb_build_object('itemId',v_item,'expectedLockVersion',5),gen_random_uuid());
  if v_r->'item'->>'deleted_at' is null or v_r->'item'->>'completed_at' is null or exists(select 1 from public.work_task_checklist_items where id=v_item) or public.get_work_task_detail(v_task::text)->'checklist'<>'[]' then raise exception 'TEST_CHECKLIST_SOFT_DELETE'; end if;
  begin perform public.command_work_task_collaboration(v_task,'checklist_update',jsonb_build_object('itemId',v_item,'expectedLockVersion',6,'title','Resurrect'),gen_random_uuid()); raise exception 'TEST_DELETED_ITEM_MUTATION'; exception when insufficient_privilege then null; end;
  v_r:=public.command_work_task_collaboration(v_task,'checklist_create','{"title":"Live item"}',gen_random_uuid());
  insert into work_collab_data values('liveItem',v_r);
end $$;
select pg_temp.work_as('creator');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); v_page jsonb; v_cursor jsonb; v_seen uuid[]:='{}'; v_x jsonb; v_kind text; v_count bigint; begin
  if jsonb_array_length(public.get_work_task_clone_draft(v_task)->'draft'->'checklist')<>1 then raise exception 'TEST_CLONE_DELETED_CHECKLIST'; end if;
  foreach v_kind in array array['comments','history'] loop
    v_cursor:=null; v_seen:='{}';
    loop
      v_page:=case v_kind when 'comments' then public.list_work_task_comments(v_task,v_cursor,1) else public.list_work_task_history(v_task,'{}',v_cursor,1) end;
      for v_x in select value from jsonb_array_elements(v_page->'items') loop
        if (v_x->>'id')::uuid=any(v_seen) then raise exception 'TEST_CURSOR_DUPLICATE'; end if;
        v_seen:=array_append(v_seen,(v_x->>'id')::uuid);
      end loop;
      v_cursor:=nullif(v_page->'nextCursor','null'::jsonb); exit when v_cursor is null;
      if cardinality(v_seen)>100 then raise exception 'TEST_CURSOR_NOT_TERMINATING'; end if;
    end loop;
    if v_kind='comments' then select count(*) into v_count from public.work_task_comments where task_id=v_task;
    else select count(*) into v_count from public.work_task_events where task_id=v_task; end if;
    if cardinality(v_seen)<>v_count then raise exception 'TEST_CURSOR_SKIPPED_TIES'; end if;
  end loop;
  if not exists(select 1 from jsonb_array_elements(public.list_work_task_history(v_task,'{"category":"comments"}')->'items') x
    where x->>'event_type'='comment.edited' and x->'payload'->'before'->>'content_text'='Original discussion @Mention@Mention' and x->'payload'->'after'->>'content_text'='Edited discussion @Mention@Mention') then raise exception 'TEST_IMMUTABLE_EDIT_EVIDENCE'; end if;
  if (select count(*) from jsonb_array_elements(public.list_work_task_history(v_task,'{"category":"checklist"}')->'items') x where x->>'event_type'='checklist.completed')<>2 then raise exception 'TEST_CHECKLIST_COMPLETION_HISTORY'; end if;
  v_page:=public.list_work_task_history(v_task,jsonb_build_object('category','comments','actorUserId',(select id from work_collab_people where name='watcher')));
  if jsonb_array_length(v_page->'items')<>6 then raise exception 'TEST_HISTORY_FILTER %',v_page; end if;
  begin perform public.list_work_task_history(v_task,'{"category":"unknown"}'); raise exception 'TEST_INVALID_HISTORY_FILTER'; exception when invalid_parameter_value then null; end;
  begin perform public.list_work_task_comments(v_task,'{"id":null,"sortAt":null}'); raise exception 'TEST_INVALID_CURSOR'; exception when invalid_parameter_value then null; end;
  begin perform public.command_work_task_collaboration((select (value->>'taskId')::uuid from work_collab_data where key='restricted'),'checklist_update',jsonb_build_object('itemId',(select value->'item'->>'id' from work_collab_data where key='liveItem'),'expectedLockVersion',1,'title','Cross task'),gen_random_uuid()); raise exception 'TEST_CROSS_TASK_CHECKLIST'; exception when insufficient_privilege then null; end;
end $$;
-- Reviewer can discuss; being a reviewer does not confer checklist execution rights.
select pg_temp.work_as('reviewer');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); begin
  if public.get_work_task_detail(v_task::text)->'capabilities'->>'canComment'<>'true' or public.get_work_task_detail(v_task::text)->'capabilities'->>'canManageChecklist'<>'false' then raise exception 'TEST_REVIEWER_CAPABILITIES'; end if;
end $$;
select pg_temp.work_as('assignee');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); v_caps jsonb; begin
  perform public.command_work_task(v_task,'transfer',jsonb_build_object('userId',(select id from work_collab_people where name='replacement'),'reason','Transferred responsibility'),(select lock_version from public.work_tasks where id=v_task),gen_random_uuid());
  v_caps:=public.get_work_task_detail(v_task::text)->'capabilities';
  if v_caps->>'canViewHistory'<>'true' or v_caps->>'canManageChecklist'<>'false' or v_caps->>'canComment'<>'false'
    or not exists(select 1 from public.work_task_versions where task_id=v_task) or not exists(select 1 from public.work_task_events where task_id=v_task)
    or jsonb_array_length(public.list_work_task_history(v_task)->'items')=0 then raise exception 'TEST_HISTORICAL_AUDIT_BOUNDARY'; end if;
  begin perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_doc('Historical mutation')),gen_random_uuid()); raise exception 'TEST_HISTORICAL_COMMENT'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); begin
  if (select count(*) from public.work_task_assignments where task_id=v_task)<>2 or (select count(*) from public.work_task_participants where task_id=v_task)<>2 then raise exception 'TEST_MENTION_CREATED_RELATION'; end if;
  if (select count(*) from public.work_task_events where task_id=v_task)<>(select count(*) from app_private.work_notification_outbox where task_id=v_task) then raise exception 'TEST_COLLAB_OUTBOX_ATOMICITY'; end if;
  if (select count(*) from app_private.work_notification_outbox where task_id=v_task and event_type='comment.mentioned' and payload->>'mandatory'='true')<>2 then raise exception 'TEST_MANDATORY_MENTION_EVENTS'; end if;
  if (select count(*) from app_private.work_notification_outbox o cross join lateral jsonb_array_elements(o.payload->'recipientUserIds') x where o.task_id=v_task and o.event_type='comment.mentioned')<>2 then raise exception 'TEST_EDIT_RENOTIFIED_UNCHANGED_MENTION'; end if;
  begin update public.work_task_events set payload='{}' where task_id=v_task and event_type='comment.edited'; raise exception 'TEST_EDIT_EVIDENCE_MUTABLE'; exception when check_violation then null; end;
  begin delete from public.work_task_checklist_items where id=(select (value#>>'{}')::uuid from work_collab_data where key='item'); raise exception 'TEST_CHECKLIST_HISTORY_DELETE'; exception when check_violation then null; end;
end $$;
-- Revoked canonical permission takes effect for historical readers and mention submissions.
delete from public.user_permission_grants where user_id=(select id from work_collab_people where name='assignee') and permission_code='work.task.audit_view';
set local role authenticated;
select pg_temp.work_as('assignee');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); begin
  if public.get_work_task_detail(v_task::text)->'capabilities'->>'canViewHistory'<>'false' or exists(select 1 from public.work_task_events where task_id=v_task) or exists(select 1 from public.work_task_versions where task_id=v_task) then raise exception 'TEST_REVOKED_AUDIT'; end if;
  begin perform public.list_work_task_history(v_task); raise exception 'TEST_REVOKED_HISTORY_RPC'; exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.user_permission_grants where user_id=(select id from work_collab_people where name='assignee') and permission_code='work.module.access';
set local role authenticated;
select pg_temp.work_as('watcher');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); begin
  if public.list_work_task_mention_candidates(v_task,'assignee')->'items'<>'[]' then raise exception 'TEST_REVOKED_MENTION_PICKER'; end if;
  begin perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_mention_doc('Stale picker ',array[(select id from work_collab_people where name='assignee')])),gen_random_uuid()); raise exception 'TEST_STALE_PICKER_ALLOWED'; exception when insufficient_privilege then null; end;
  perform public.command_work_task_collaboration(v_task,'set_pin','{"pinned":false}',gen_random_uuid());
  perform public.command_work_task_collaboration(v_task,'set_notifications','{"notificationsEnabled":true}',gen_random_uuid());
  if public.get_work_task_detail(v_task::text)->'preferences'<>'{"pinned":false,"notificationsEnabled":true}' then raise exception 'TEST_PREFERENCE_RESET'; end if;
end $$;
select pg_temp.work_as('outsider');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='restricted'); begin
  if exists(select 1 from public.work_task_comments where task_id=v_task) then raise exception 'TEST_RESTRICTED_COMMENT_LEAK'; end if;
  begin perform public.list_work_task_comments(v_task); raise exception 'TEST_OUTSIDER_COMMENTS'; exception when insufficient_privilege then null; end;
  begin perform public.list_work_task_mention_candidates(v_task); raise exception 'TEST_OUTSIDER_PICKER'; exception when insufficient_privilege then null; end;
  begin perform public.command_work_task_collaboration(v_task,'set_pin','{"pinned":true}',gen_random_uuid()); raise exception 'TEST_OUTSIDER_PIN'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('inactive');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); begin
  begin perform public.list_work_task_comments(v_task); raise exception 'TEST_INACTIVE_READ'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('creator');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); begin
  perform public.command_work_task(v_task,'cancel','{"reason":"Close test"}',(select lock_version from public.work_tasks where id=v_task),gen_random_uuid());
  if public.get_work_task_detail(v_task::text)->'capabilities'->>'canManageChecklist'<>'false' or public.get_work_task_detail(v_task::text)->'capabilities'->>'canComment'<>'false' then raise exception 'TEST_CLOSED_COLLAB_CAPABILITIES'; end if;
  begin perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_doc('Terminal comment')),gen_random_uuid()); raise exception 'TEST_CLOSED_COMMENT'; exception when insufficient_privilege then null; end;
  perform public.command_work_task_collaboration(v_task,'set_pin','{"pinned":true}',gen_random_uuid());
end $$;
reset role;

-- Scoped manager can edit checklist on standard tasks, but cannot infer assigned audit
-- or read restricted tasks from view_scope/manage_scope alone.
with d as (insert into public.org_units(name) values('Collaboration smoke department') returning id)
insert into work_collab_data select 'department',to_jsonb(id) from d;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
select id,code,'department',(select value#>>'{}' from work_collab_data where key='department'),'rollback smoke',now()+interval '1 day'
from work_collab_people cross join unnest(array['work.task.view_scope','work.task.manage_scope']) code where name='manager';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.create','department',(select value#>>'{}' from work_collab_data where key='department'),'rollback smoke'
from work_collab_people where name='creator';
set local role authenticated;
select pg_temp.work_as('creator');
do $$ declare v_input jsonb:=(select value from work_collab_data where key='input'); v_p jsonb; v_r jsonb; begin
  v_input:=v_input||jsonb_build_object('scope',jsonb_build_object('type','department','departmentId',(select value from work_collab_data where key='department')),
    'recipientSources',jsonb_build_array(jsonb_build_object('type','user','id',(select id from work_collab_people where name='replacement'))));
  v_p:=public.preview_work_task_recipients(v_input->'recipientSources',v_input->'scope');
  v_r:=public.create_work_task(v_input,gen_random_uuid(),v_p->>'fingerprint'); insert into work_collab_data values('managed',v_r);
  v_r:=public.create_work_task(v_input||'{"privacy":"restricted"}',gen_random_uuid(),v_p->>'fingerprint'); insert into work_collab_data values('managedRestricted',v_r);
end $$;
select pg_temp.work_as('manager');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='managed'); v_r jsonb; begin
  v_r:=public.get_work_task_detail(v_task::text);
  if v_r->'capabilities'->>'canManageChecklist'<>'true' or v_r->'capabilities'->>'canViewHistory'<>'false' or exists(select 1 from public.work_task_events where task_id=v_task) then raise exception 'TEST_MANAGER_SCOPE_OR_ASSIGNED_AUDIT'; end if;
  perform public.command_work_task_collaboration(v_task,'checklist_create','{"title":"Manager item"}',gen_random_uuid());
  begin perform public.get_work_task_detail((select value->>'taskId' from work_collab_data where key='managedRestricted')); raise exception 'TEST_MANAGER_RESTRICTED_LEAK'; exception when insufficient_privilege then null; end;
  begin perform public.get_work_task_detail((select value->>'taskId' from work_collab_data where key='restricted')); raise exception 'TEST_MANAGER_OTHER_SCOPE'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('creator');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='managedRestricted'); begin
  if jsonb_array_length(public.list_work_task_mention_candidates(v_task,'manager')->'items')<>0 then raise exception 'TEST_RESTRICTED_MANAGER_PICKER'; end if;
  begin perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_mention_doc('Cannot mention manager ',array[(select id from work_collab_people where name='manager')])),gen_random_uuid()); raise exception 'TEST_RESTRICTED_MANAGER_MENTION'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('replacement');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='managed'); begin
  perform public.command_work_task(v_task,'acknowledge','{}',(select lock_version from public.work_tasks where id=v_task),gen_random_uuid());
  perform public.command_work_task(v_task,'start','{}',(select lock_version from public.work_tasks where id=v_task),gen_random_uuid());
  perform public.command_work_task(v_task,'submit',jsonb_build_object('result',pg_temp.work_doc('Ready for review')),(select lock_version from public.work_tasks where id=v_task),gen_random_uuid());
  if public.get_work_task_detail(v_task::text)->'capabilities'->>'canManageChecklist'<>'false' then raise exception 'TEST_REVIEW_FREEZE'; end if;
  begin perform public.command_work_task_collaboration(v_task,'checklist_create','{"title":"After submission"}',gen_random_uuid()); raise exception 'TEST_CHECKLIST_DURING_REVIEW'; exception when insufficient_privilege then null; end;
  perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content',pg_temp.work_doc('Review discussion')),gen_random_uuid());
end $$;
select pg_temp.work_as('reviewer');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='managed'); begin
  perform public.command_work_task(v_task,'review','{"decision":"request_changes","reason":"Adjust checklist"}',(select lock_version from public.work_tasks where id=v_task),gen_random_uuid());
end $$;
select pg_temp.work_as('replacement');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='managed'); begin
  if public.get_work_task_detail(v_task::text)->'capabilities'->>'canManageChecklist'<>'true' then raise exception 'TEST_REVIEW_REJECTION_REOPEN_CHECKLIST'; end if;
end $$;
reset role;
-- High-cardinality read fixtures only, rolled back with all other smoke data.
insert into public.work_task_comments(task_id,author_user_id,content_document,content_text)
select (select (value->>'taskId')::uuid from work_collab_data where key='managed'),(select id from work_collab_people where name='creator'),pg_temp.work_doc('Pagination '||x),'Pagination '||x from generate_series(1,105) x;
insert into public.work_task_events(task_id,actor_user_id,event_type)
select (select (value->>'taskId')::uuid from work_collab_data where key='managed'),(select id from work_collab_people where name='creator'),'comment.created' from generate_series(1,105);
set local role authenticated;
select pg_temp.work_as('creator');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='managed'); v_page jsonb; v_cursor uuid; v_seen uuid[]:='{}'; v_x jsonb; v_total integer; begin
  if jsonb_array_length(public.list_work_task_comments(v_task,null,10000)->'items')<>100 or jsonb_array_length(public.list_work_task_history(v_task,'{}',null,10000)->'items')<>100 then raise exception 'TEST_THREAD_HARD_LIMIT'; end if;
  v_total:=jsonb_array_length(public.list_work_task_mention_candidates(v_task,'',null,50)->'items');
  loop
    v_page:=public.list_work_task_mention_candidates(v_task,'',v_cursor,1);
    for v_x in select value from jsonb_array_elements(v_page->'items') loop
      if (v_x->>'userId')::uuid=any(v_seen) then raise exception 'TEST_PICKER_CURSOR_DUPLICATE'; end if;
      v_seen:=array_append(v_seen,(v_x->>'userId')::uuid);
    end loop;
    v_cursor:=(v_page->>'nextCursor')::uuid; exit when v_cursor is null;
    if cardinality(v_seen)>50 then raise exception 'TEST_PICKER_CURSOR_LOOP'; end if;
  end loop;
  if cardinality(v_seen)<>v_total then raise exception 'TEST_PICKER_CURSOR_SKIP'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('authenticated','app_private.work_task_user_can_view(uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public.command_work_task_collaboration(uuid,text,jsonb,uuid)','EXECUTE')
    or has_function_privilege('anon','public.list_work_task_comments(uuid,jsonb,integer)','EXECUTE')
    or has_function_privilege('anon','public.list_work_task_history(uuid,jsonb,jsonb,integer)','EXECUTE')
    or has_function_privilege('anon','public.list_work_task_mention_candidates(uuid,text,uuid,integer)','EXECUTE') then raise exception 'TEST_COLLAB_FUNCTION_ACL'; end if;
end $$;

select 'WORK_R1A_COLLABORATION_COMMANDS_SMOKE_PASSED' as result;
rollback;

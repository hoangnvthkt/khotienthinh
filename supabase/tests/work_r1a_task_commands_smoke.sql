begin;
create temporary table work_command_people(name text primary key, id uuid, email text) on commit drop;
create temporary table work_command_data(key text primary key, value jsonb) on commit drop;
grant select on work_command_people to authenticated;
grant select, insert, update on work_command_data to authenticated;
insert into work_command_people select name, gen_random_uuid(), 'work-command-'||gen_random_uuid()||'@invalid.local'
from unnest(array['creator','recipient','watcher','inactive','disabled','no_access','unrelated','scoped']) name;
insert into public.users(id,name,username,email,role,is_active,account_status)
select id,name,'work-command-'||id,email,'EMPLOYEE',name <> 'inactive',
case when name='disabled' then 'DISABLED' else 'ACTIVE' end from work_command_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.module.access','global','*','rollback smoke' from work_command_people where name not in ('no_access','inactive','disabled');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,code,'global','*','rollback smoke' from work_command_people cross join unnest(array[
'work.task.create','work.task.assign_user','work.task.assign_group','work.task.view_related','work.task.review']) code
where name='creator';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.view_related','assigned','*','rollback smoke' from work_command_people where name in ('recipient','watcher');
with g as (insert into public.work_groups(name) values ('Command Group A'),('Command Group B') returning id,name)
insert into work_command_data select name,to_jsonb(id) from g;
insert into public.work_group_members(group_id,user_id,is_active)
select (value#>>'{}')::uuid,id::text,true from work_command_data cross join work_command_people
where key like 'Command Group%' and name in ('creator','recipient','inactive','disabled','no_access');
insert into public.work_group_members(group_id,user_id,is_active)
select (value#>>'{}')::uuid,'legacy-not-a-uuid',true from work_command_data where key='Command Group A';
insert into public.work_group_members(group_id,user_id,is_active)
select (value#>>'{}')::uuid,id::text,false from work_command_data cross join work_command_people
where key='Command Group A' and name='watcher';
insert into work_command_data values ('scope','{"type":"direct"}');
insert into work_command_data select 'sources',jsonb_build_array(
jsonb_build_object('type','work_group','id',(select value from work_command_data where key='Command Group A')),
jsonb_build_object('type','work_group','id',(select value from work_command_data where key='Command Group B')),
jsonb_build_object('type','user','id',id)) from work_command_people where name='recipient';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true)
from work_command_people where name='creator';
do $$
declare p jsonb; q jsonb;
begin
  if to_regprocedure('public.preview_work_task_recipients(jsonb,jsonb)') is null then
    raise exception 'TEST_MISSING_RECIPIENT_PREVIEW_RPC';
  end if;
  p := public.preview_work_task_recipients((select value from work_command_data where key='sources'),'{"type":"direct"}');
  if (p->>'validCount')::int <> 2 or (p->>'invalidCount')::int <> 4 then raise exception 'TEST_PREVIEW_COUNTS %',p; end if;
  if jsonb_array_length((select x->'sources' from jsonb_array_elements(p->'validRecipients') x
    where x->>'userId'=(select id::text from work_command_people where name='recipient'))) <> 3 then
    raise exception 'TEST_PROVENANCE_DEDUPE'; end if;
  if not p->'invalidRecipients' @> '[{"reason":"INACTIVE_USER"},{"reason":"NO_APP_ACCOUNT"},{"reason":"NO_MODULE_ACCESS"}]' then
    raise exception 'TEST_EXCLUSION_REASONS %',p; end if;
  -- The existing account trigger synchronizes DISABLED to is_active=false.
  if (select count(*) from jsonb_array_elements(p->'invalidRecipients') x where x->>'reason'='INACTIVE_USER') <> 2 then raise exception 'TEST_DISABLED_USER_EXCLUSION'; end if;
  q := public.preview_work_task_recipients((select jsonb_agg(x order by x->>'id' desc) from jsonb_array_elements(
    (select value from work_command_data where key='sources')) x),'{"type":"direct"}');
  if p->>'fingerprint' <> q->>'fingerprint' then raise exception 'TEST_UNSTABLE_FINGERPRINT'; end if;
  insert into work_command_data values ('preview',p);
end $$;
reset role;
-- Creation is atomic, guarded, idempotent and refuses unconfigured SLA calendars.
set local role authenticated;
do $$
declare p jsonb; input jsonb; result jsonb;
begin
  if to_regprocedure('public.create_work_task(jsonb,uuid,text)') is null then raise exception 'TEST_MISSING_CREATE_RPC'; end if;
  input := jsonb_build_object('title','Command smoke task','description','{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Safe description"}]}]}'::jsonb,
    'scope','{"type":"direct"}'::jsonb,'recipientSources',(select value from work_command_data where key='sources'),
    'watcherUserIds',jsonb_build_array((select id from work_command_people where name='watcher')),
    'priority','normal','privacy','restricted','labels',jsonb_build_array('smoke'),
    'checklist',jsonb_build_array(jsonb_build_object('title','First item')));
  insert into work_command_data values ('input',input),('key',to_jsonb(gen_random_uuid()));
  begin
    perform public.create_work_task(input,gen_random_uuid(),(select value->>'fingerprint' from work_command_data where key='preview'));
    raise exception 'TEST_MISSING_CALENDAR_ACCEPTED';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'WORK_CALENDAR_NOT_CONFIGURED' then raise; end if;
  end;
end $$;
reset role;
-- Synthetic calendar is rollback-only; it is never a production calendar seed.
insert into public.work_sla_calendars(name,working_weekdays,workday_start,workday_end,is_default,created_by)
select 'Rollback-only calendar',array[1,2,3,4,5]::smallint[],'08:00','17:00',true,id from work_command_people where name='creator';
set local role authenticated;
do $$
declare input jsonb := (select value from work_command_data where key='input');
  fp text := (select value->>'fingerprint' from work_command_data where key='preview');
  v_key uuid := (select (value#>>'{}')::uuid from work_command_data where key='key'); r jsonb; again jsonb; tid uuid; selfsrc jsonb; p jsonb;
begin
  r:=public.create_work_task(input,v_key,fp); tid := (r->>'taskId')::uuid;
  again:=public.create_work_task(input,v_key,fp);
  if r is distinct from again then raise exception 'TEST_IDEMPOTENT_RETRY'; end if;
  if (select count(*) from public.work_tasks where id=tid)<>1 then raise exception 'TEST_CREATE_ROW'; end if;
  if (select count(*) from public.work_task_assignments where task_id=tid)<>2 then raise exception 'TEST_ASSIGNMENT_DEDUPE'; end if;
  if (select count(*) from public.work_task_recipient_member_sources where task_id=tid)<>5 then raise exception 'TEST_SNAPSHOT_PROVENANCE'; end if;
  if not exists(select 1 from public.work_task_assignments where task_id=tid and user_id=public.current_app_user_id()
    and state='not_started' and acknowledged_at=assigned_at) then raise exception 'TEST_SELF_ACK'; end if;
  if not exists(select 1 from public.work_task_assignments where task_id=tid and user_id<>public.current_app_user_id()
    and state='pending_acknowledgement' and acknowledgement_due_at>assigned_at) then raise exception 'TEST_PENDING_SLA'; end if;
  if not exists(select 1 from public.work_tasks where id=tid and status='not_started' and review_policy='creator_review'
    and reviewer_user_id=public.current_app_user_id() and description_text='Safe description') then raise exception 'TEST_CREATE_DEFAULTS'; end if;
  if (select count(*) from public.work_task_participants where task_id=tid)<>2 then raise exception 'TEST_PARTICIPANTS'; end if;
  begin
    perform public.create_work_task(input||'{"title":"Different"}',v_key,fp);
    raise exception 'TEST_IDEMPOTENCY_CONFLICT_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm <> 'WORK_IDEMPOTENCY_CONFLICT' then raise; end if; end;
  selfsrc:=jsonb_build_array(jsonb_build_object('type','user','id',public.current_app_user_id()));
  p:=public.preview_work_task_recipients(selfsrc,'{"type":"direct"}');
  again:=public.create_work_task(input||jsonb_build_object('recipientSources',selfsrc,'watcherUserIds','[]'::jsonb),gen_random_uuid(),p->>'fingerprint');
  if not exists(select 1 from public.work_tasks where id=(again->>'taskId')::uuid and review_policy='auto_complete' and reviewer_user_id is null) then raise exception 'TEST_SELF_ONLY_POLICY'; end if;
  p:=public.preview_work_task_recipients('[]','{"type":"direct"}');
  begin
    perform public.create_work_task(input||'{"recipientSources":[]}',gen_random_uuid(),p->>'fingerprint');
    raise exception 'TEST_ZERO_RECIPIENTS_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm <> 'WORK_NO_VALID_RECIPIENTS' then raise; end if; end;
  insert into work_command_data values ('created',r);
end $$;
reset role;
do $$
declare tid uuid := (select (value->>'taskId')::uuid from work_command_data where key='created');
begin
  if (select count(*) from public.work_task_versions where task_id=tid)<>1
    or (select count(*) from public.work_task_events where task_id=tid and event_type='task.created')<>1
    or (select count(*) from app_private.work_notification_outbox where task_id=tid)<>1 then raise exception 'TEST_ATOMIC_AUDIT_OUTBOX'; end if;
end $$;
-- Membership and canonical permission drift both invalidate the preview.
update public.work_group_members set is_active=true where group_id=(select (value#>>'{}')::uuid from work_command_data where key='Command Group A')
  and user_id=(select id::text from work_command_people where name='watcher');
set local role authenticated;
do $$ begin
  begin
    perform public.create_work_task((select value from work_command_data where key='input'),gen_random_uuid(),
      (select value->>'fingerprint' from work_command_data where key='preview'));
    raise exception 'TEST_STALE_PREVIEW_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm <> 'WORK_RECIPIENT_PREVIEW_STALE' then raise; end if; end;
end $$;
reset role;
-- Detail, list and clone read only through subject permissions.
insert into public.work_task_comments(task_id,author_user_id,content_document,content_text)
select (select (value->>'taskId')::uuid from work_command_data where key='created'),id,'{}','Must be loaded separately' from work_command_people where name='creator';
insert into public.work_task_attachments(task_id,uploader_user_id,file_name,mime_type,size_bytes,storage_path,status)
select (select (value->>'taskId')::uuid from work_command_data where key='created'),id,'smoke.txt','text/plain',10,'rollback-only/'||gen_random_uuid(),state
from work_command_people cross join unnest(array['pending','processing','ready','rejected']) state where name='creator';
set local role authenticated;
do $$
declare tid uuid := (select (value->>'taskId')::uuid from work_command_data where key='created');
  d jsonb; clone jsonb; page jsonb; nextpage jsonb; before_count int;
begin
  if to_regprocedure('public.get_work_task_detail(text)') is null then raise exception 'TEST_MISSING_DETAIL_RPC'; end if;
  d:=public.get_work_task_detail((select value->>'taskCode' from work_command_data where key='created'));
  if (d->'task'->>'id')::uuid<>tid or d ? 'comments' or d ? 'events' or d ? 'history'
    or d->'task' ? 'comments' or d->'task' ? 'events' then raise exception 'TEST_DETAIL_PAYLOAD'; end if;
  if jsonb_array_length(d->'assignments')<>2 or jsonb_array_length(d->'participants')<>2
    or jsonb_array_length(d->'attachments')<>1 or d->'attachments'->0->>'status'<>'ready'
    or jsonb_array_length(d->'checklist')<>1 or d->'capabilities'->>'canClone'<>'true' then raise exception 'TEST_DETAIL_AGGREGATES'; end if;
  select count(*) into before_count from public.work_tasks;
  clone:=public.get_work_task_clone_draft(tid);
  if (select count(*) from public.work_tasks)<>before_count then raise exception 'TEST_CLONE_INSERTED'; end if;
  if (clone->'draft')-array['title','description','scope','taskGroupId','labels','priority','privacy','recipientSources',
    'watcherUserIds','reviewerUserId','reviewPolicy','checklist','clonedFromTaskId','deadlineAt']<>'{}'::jsonb
    or clone->'draft'->>'title'<>'Command smoke task'
    or clone->'draft'->'checklist' <> '[{"title":"First item"}]'::jsonb then raise exception 'TEST_CLONE_ALLOWLIST %',clone; end if;
  page:=public.list_work_tasks('created_by_me','{}',null,1);
  if jsonb_array_length(page->'items')<>1 or page->'nextCursor'='null'::jsonb then raise exception 'TEST_FIRST_PAGE'; end if;
  nextpage:=public.list_work_tasks('created_by_me','{}',page->'nextCursor',1);
  if jsonb_array_length(nextpage->'items')<>1 or page->'items'->0->>'id'=nextpage->'items'->0->>'id'
    or nextpage->'nextCursor'<>'null'::jsonb then raise exception 'TEST_CURSOR_TIE'; end if;
  if (public.list_work_tasks('created_by_me','{"search":"nonexistentxyz"}',null,50)->'items')<>'[]'::jsonb then raise exception 'TEST_SEARCH_FILTER'; end if;
  if (public.list_work_tasks('created_by_me','{"status":["completed"]}',null,50)->'items')<>'[]'::jsonb then raise exception 'TEST_STATUS_FILTER'; end if;
  if (public.list_work_task_groups('{"type":"direct"}',null,50)->'items')<>'[]'::jsonb then raise exception 'TEST_DIRECT_BUCKET'; end if;
end $$;
reset role;
update public.work_tasks set deadline_at=now()-interval '1 day' where id=(select (value->>'taskId')::uuid from work_command_data where key='created');
update public.work_task_checklist_items set completed_at=now(),completed_by=(select id from work_command_people where name='creator')
where task_id=(select (value->>'taskId')::uuid from work_command_data where key='created');
set local role authenticated;
do $$ declare d jsonb; begin
  d:=public.get_work_task_clone_draft((select (value->>'taskId')::uuid from work_command_data where key='created'));
  if d->>'requiresDeadlineConfirmation'<>'true' or d->'draft' ? 'deadlineAt' or d->'draft'->'checklist'<>'[]'::jsonb then raise exception 'TEST_CLONE_EXPIRED_DEADLINE'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true)
from work_command_people where name='unrelated';
do $$ begin
  begin
    perform public.get_work_task_detail((select value->>'taskCode' from work_command_data where key='created'));
    raise exception 'TEST_RESTRICTED_DETAIL_LEAK';
  exception when insufficient_privilege then if sqlerrm<>'WORK_TASK_NOT_FOUND' then raise; end if; end;
  if public.list_work_tasks('assigned_to_me','{}',null,50)->'items'<>'[]'::jsonb then raise exception 'TEST_UNRELATED_LIST_LEAK'; end if;
  begin
    perform public.preview_work_task_recipients((select value from work_command_data where key='sources'),'{"type":"direct"}');
    raise exception 'TEST_CREATE_CAPABILITY_BYPASS';
  exception when insufficient_privilege then if sqlerrm<>'WORK_CREATE_DENIED' then raise; end if; end;
end $$;
reset role;
-- Permission, scope and rollback regression cases run with the actual client role.
with d as (insert into public.org_units(name) values ('Command department') returning id)
insert into work_command_data select 'department',to_jsonb(id) from d;
with p as (insert into public.projects(id,code,name) values ('work-command-'||gen_random_uuid(),'work-command-'||gen_random_uuid(),'Command project') returning id)
insert into work_command_data select 'project',to_jsonb(id) from p;
with g as (insert into public.work_task_groups(name,scope_type,department_id,created_by)
select 'Command bucket','department',(select (value#>>'{}')::uuid from work_command_data where key='department'),id from work_command_people where name='creator' returning id)
insert into work_command_data select 'bucket',to_jsonb(id) from g;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,code,'department',(select value#>>'{}' from work_command_data where key='department'),'rollback smoke'
from work_command_people cross join unnest(array['work.task.create','work.task.assign_user','work.task.view_related','work.task.review']) code where name='scoped';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true)
from work_command_people where name='creator';
do $$
declare input jsonb := (select value from work_command_data where key='input'); p jsonb; v_key uuid:=gen_random_uuid(); before_count int; r jsonb; scope jsonb;
begin
  p:=public.preview_work_task_recipients(input->'recipientSources',input->'scope');
  insert into work_command_data values ('freshPreview',p),('failureKey',to_jsonb(v_key));
  select count(*) into before_count from public.work_tasks;
  begin
    perform public.create_work_task(input||'{"checklist":[{"title":""}]}',v_key,p->>'fingerprint');
    raise exception 'TEST_PARTIAL_CREATE_ACCEPTED';
  exception when invalid_parameter_value then if sqlerrm<>'WORK_INVALID_CHECKLIST' then raise; end if; end;
  if (select count(*) from public.work_tasks)<>before_count then raise exception 'TEST_PARTIAL_CREATE_NOT_ROLLED_BACK'; end if;
  begin
    perform public.create_work_task(input||jsonb_build_object('taskGroupId',(select value from work_command_data where key='bucket')),gen_random_uuid(),p->>'fingerprint');
    raise exception 'TEST_SCOPE_BUCKET_BYPASS';
  exception when insufficient_privilege then if sqlerrm<>'WORK_TASK_GROUP_SCOPE_MISMATCH' then raise; end if; end;
  begin
    perform public.create_work_task(input||'{"privacy":"public"}',gen_random_uuid(),p->>'fingerprint');
    raise exception 'TEST_INVALID_PRIVACY_ACCEPTED';
  exception when invalid_parameter_value then if sqlerrm<>'WORK_INVALID_COMMAND' then raise; end if; end;
  begin
    perform public.create_work_task(input||'{"description":{"version":1,"type":"doc","content":[{"type":"script","content":[]}]}}',gen_random_uuid(),p->>'fingerprint');
    raise exception 'TEST_UNSAFE_DOCUMENT_ACCEPTED';
  exception when invalid_parameter_value then if sqlerrm<>'WORK_INVALID_DOCUMENT' then raise; end if; end;
  begin
    perform public.create_work_task(input||jsonb_build_object('reviewerUserId',(select id from work_command_people where name='recipient')),gen_random_uuid(),p->>'fingerprint');
    raise exception 'TEST_REVIEW_OVERRIDE_BYPASS';
  exception when insufficient_privilege then if sqlerrm<>'WORK_REVIEW_POLICY_DENIED' then raise; end if; end;
  scope:=jsonb_build_object('type','department','departmentId',(select value from work_command_data where key='department'));
  if jsonb_array_length(public.list_work_task_groups(scope,null,50)->'items')<>1 then raise exception 'TEST_BUCKET_LIST'; end if;
  p:=public.preview_work_task_recipients(input->'recipientSources',scope);
  r:=public.create_work_task(input||jsonb_build_object('scope',scope,'taskGroupId',(select value from work_command_data where key='bucket')),gen_random_uuid(),p->>'fingerprint');
  if not exists(select 1 from public.work_tasks where id=(r->>'taskId')::uuid and scope_type='department') then raise exception 'TEST_DEPARTMENT_CREATE'; end if;
  scope:=jsonb_build_object('type','project','projectId',(select value from work_command_data where key='project'));
  p:=public.preview_work_task_recipients(input->'recipientSources',scope);
  r:=public.create_work_task(input||jsonb_build_object('scope',scope),gen_random_uuid(),p->>'fingerprint');
  if jsonb_array_length(public.list_work_tasks('created_by_me',jsonb_build_object('scope',scope),null,50)->'items')<>1 then raise exception 'TEST_PROJECT_FILTER'; end if;
end $$;
reset role;
do $$ begin
  if exists(select 1 from app_private.work_command_idempotency where idempotency_key=(select (value#>>'{}')::uuid from work_command_data where key='failureKey')) then raise exception 'TEST_FAILED_IDEMPOTENCY_PERSISTED'; end if;
end $$;
-- Losing recipient module access changes the fingerprint, without rewriting old snapshots.
delete from public.user_permission_grants where permission_code='work.module.access' and user_id=(select id from work_command_people where name='recipient');
set local role authenticated;
do $$ begin
  begin
    perform public.create_work_task((select value from work_command_data where key='input'),gen_random_uuid(),(select value->>'fingerprint' from work_command_data where key='freshPreview'));
    raise exception 'TEST_PERMISSION_DRIFT_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm<>'WORK_RECIPIENT_PREVIEW_STALE' then raise; end if; end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true)
from work_command_people where name='scoped';
do $$ declare scope jsonb; src jsonb; p jsonb; r jsonb; begin
  scope:=jsonb_build_object('type','department','departmentId',(select value from work_command_data where key='department'));
  src:=jsonb_build_array(jsonb_build_object('type','user','id',public.current_app_user_id()));
  p:=public.preview_work_task_recipients(src,scope);
  r:=public.create_work_task((select value from work_command_data where key='input')||jsonb_build_object('scope',scope,'recipientSources',src),gen_random_uuid(),p->>'fingerprint');
  if r->>'status'<>'not_started' then raise exception 'TEST_SCOPED_CREATOR'; end if;
  begin
    perform public.preview_work_task_recipients(src,'{"type":"direct"}');
    raise exception 'TEST_SCOPED_PERMISSION_ESCAPE';
  exception when insufficient_privilege then if sqlerrm<>'WORK_CREATE_DENIED' then raise; end if; end;
  begin
    perform public.preview_work_task_recipients((select value from work_command_data where key='sources'),scope);
    raise exception 'TEST_ASSIGN_GROUP_BYPASS';
  exception when insufficient_privilege then if sqlerrm<>'WORK_ASSIGN_GROUP_DENIED' then raise; end if; end;
end $$;
reset role;
-- No anonymous function privilege; helpers that accept arbitrary data stay internal.
do $$ declare fn regprocedure; begin
  foreach fn in array array['public.preview_work_task_recipients(jsonb,jsonb)'::regprocedure,'public.create_work_task(jsonb,uuid,text)'::regprocedure,
    'public.list_work_tasks(text,jsonb,jsonb,integer)'::regprocedure,'public.get_work_task_detail(text)'::regprocedure,
    'public.get_work_task_clone_draft(uuid)'::regprocedure,'public.list_work_task_groups(jsonb,jsonb,integer)'::regprocedure] loop
    if has_function_privilege('anon',fn,'execute') or not has_function_privilege('authenticated',fn,'execute') then raise exception 'TEST_RPC_GRANTS %',fn; end if;
  end loop;
  if has_function_privilege('authenticated','app_private.work_creation_calendar(jsonb)','execute')
    or has_function_privilege('authenticated','app_private.next_work_task_code()','execute') then raise exception 'TEST_INTERNAL_HELPER_EXPOSED'; end if;
end $$;
-- Calendar arithmetic must skip weekends and an explicitly closed exception day.
do $$ declare c uuid; due timestamptz; begin
  select id into c from public.work_sla_calendars where name='Rollback-only calendar';
  due:=app_private.work_creation_ack_due(c,'2026-09-04 16:30:00+07','urgent');
  if due<>'2026-09-07 08:30:00+07'::timestamptz then raise exception 'TEST_WEEKEND_SLA %',due; end if;
  insert into public.work_sla_calendar_exceptions(calendar_id,exception_date,is_working_day,created_by)
    select c,'2026-09-07',false,id from work_command_people where name='creator';
  due:=app_private.work_creation_ack_due(c,'2026-09-04 16:30:00+07','urgent');
  if due<>'2026-09-08 08:30:00+07'::timestamptz then raise exception 'TEST_EXCEPTION_SLA %',due; end if;
end $$;
insert into public.work_tasks(task_code,title,scope_type,created_by)
select app_private.next_work_task_code(),'Pagination boundary fixture','direct',id from work_command_people cross join generate_series(1,103) where name='creator';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true)
from work_command_people where name='creator';
do $$ declare p jsonb; q jsonb; begin
  p:=public.list_work_tasks('created_by_me','{"search":"Pagination boundary fixture"}',null,2147483647);
  if jsonb_array_length(p->'items')<>100 then raise exception 'TEST_LIST_HARD_LIMIT'; end if;
  q:=public.list_work_tasks('created_by_me','{"search":"Pagination boundary fixture"}',p->'nextCursor',100);
  if jsonb_array_length(q->'items')<>3 or q->'nextCursor'<>'null'::jsonb
    or (select count(distinct x->>'id') from jsonb_array_elements((p->'items')||(q->'items')) x)<>103 then raise exception 'TEST_LARGE_CURSOR_TIES'; end if;
  begin
    perform public.list_work_tasks('all','{}',null,50); raise exception 'TEST_UNKNOWN_VIEW_ACCEPTED';
  exception when invalid_parameter_value then if sqlerrm<>'WORK_INVALID_FILTER' then raise; end if; end;
  begin
    perform public.list_work_tasks('created_by_me','{}','{}',50); raise exception 'TEST_INVALID_CURSOR_ACCEPTED';
  exception when invalid_parameter_value then if sqlerrm<>'WORK_INVALID_CURSOR' then raise; end if; end;
end $$;
reset role;
select 'WORK_TASK_COMMANDS_SMOKE_PASSED' as result;
rollback;

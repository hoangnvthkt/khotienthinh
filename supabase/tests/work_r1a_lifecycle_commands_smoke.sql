begin;
create temporary table work_lifecycle_people(name text primary key,id uuid,email text) on commit drop;
create temporary table work_lifecycle_data(key text primary key,value jsonb) on commit drop;
grant select on work_lifecycle_people to authenticated;
grant all on work_lifecycle_data to authenticated;
insert into work_lifecycle_people select name,gen_random_uuid(),'lifecycle-'||gen_random_uuid()||'@invalid.local'
from unnest(array['creator','assignee','coassignee','watcher','replacement','outsider','inactive','manager']) name;
insert into public.users(id,name,username,email,role,is_active,account_status)
select id,name,'lifecycle-'||id,email,'EMPLOYEE',name<>'inactive',case when name='inactive' then 'DISABLED' else 'ACTIVE' end from work_lifecycle_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.module.access','global','*','rollback smoke' from work_lifecycle_people where name<>'inactive';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,code,'global','*','rollback smoke' from work_lifecycle_people cross join unnest(array['work.task.view_related','work.task.assign_user','work.task.review']) code where name not in ('outsider','inactive');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.create','global','*','rollback smoke' from work_lifecycle_people where name='creator';
insert into public.work_sla_calendars(name,workday_start,workday_end,is_default,created_by)
select 'Lifecycle rollback calendar','08:00','17:00',true,id from work_lifecycle_people where name='creator';
with d as (insert into public.org_units(name) values('Lifecycle managed department') returning id)
insert into work_lifecycle_data select 'department',to_jsonb(id) from d;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
select id,code,'department',(select value#>>'{}' from work_lifecycle_data where key='department'),'rollback smoke',now()+interval '1 day'
from work_lifecycle_people cross join unnest(array['work.task.view_scope','work.task.manage_scope']) code where name='manager';
create function pg_temp.work_as(p_name text) returns void language plpgsql security invoker set search_path='' as $$ begin
  perform set_config('request.jwt.claims',(select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text from pg_temp.work_lifecycle_people where name=p_name),true);
end $$;
create function pg_temp.work_command(p_task uuid,p_command text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$ begin
  return public.command_work_task(p_task,p_command,p_payload,(select lock_version from public.work_tasks where id=p_task),gen_random_uuid());
end $$;
set local role authenticated;
select pg_temp.work_as('creator');
do $$ declare input jsonb; p jsonb; r jsonb; begin
  if to_regprocedure('public.command_work_task(uuid,text,jsonb,bigint,uuid)') is null then raise exception 'TEST_MISSING_LIFECYCLE_COMMAND'; end if;
  input:=jsonb_build_object('title','Lifecycle task','description','{"version":1,"type":"doc","content":[]}'::jsonb,'scope','{"type":"direct"}'::jsonb,
    'recipientSources',(select jsonb_agg(jsonb_build_object('type','user','id',id)) from work_lifecycle_people where name in ('assignee','coassignee')),
    'watcherUserIds',jsonb_build_array((select id from work_lifecycle_people where name='watcher')),'priority','normal','privacy','standard',
    'labels','[]'::jsonb,'checklist',jsonb_build_array(jsonb_build_object('title','Assigned checklist','assigneeUserId',(select id from work_lifecycle_people where name='coassignee'))),'deadlineAt',now()+interval '1 day');
  p:=public.preview_work_task_recipients(input->'recipientSources',input->'scope');
  r:=public.create_work_task(input,gen_random_uuid(),p->>'fingerprint');
  insert into work_lifecycle_data values('input',input),('created',r);
end $$;
select pg_temp.work_as('watcher');
do $$ declare tid uuid := (select (value->>'taskId')::uuid from work_lifecycle_data where key='created'); begin
  if public.get_work_task_detail(tid::text)->'capabilities'->>'canStart'<>'false' then raise exception 'TEST_WATCHER_START_CAPABILITY'; end if;
  begin perform pg_temp.work_command(tid,'start'); raise exception 'TEST_WATCHER_START_ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('assignee');
do $$ declare tid uuid := (select (value->>'taskId')::uuid from work_lifecycle_data where key='created');
  k uuid:=gen_random_uuid(); r jsonb; again jsonb; begin
  r:=public.command_work_task(tid,'acknowledge','{}',1,k);
  if r->>'status'<>'not_started' or r->>'lockVersion'<>'2' then raise exception 'TEST_ACK_TASK_STATE'; end if;
  if (select count(*) from public.work_task_assignments where task_id=tid and acknowledged_at is null)<>1 then raise exception 'TEST_ACK_OTHERS'; end if;
  again:=public.command_work_task(tid,'acknowledge','{}',1,k);
  if r is distinct from again then raise exception 'TEST_COMMAND_RETRY'; end if;
  begin perform public.command_work_task(tid,'start','{}',1,k); raise exception 'TEST_COMMAND_KEY_CONFLICT';
    exception when sqlstate 'P0001' then if sqlerrm<>'WORK_IDEMPOTENCY_CONFLICT' then raise; end if; end;
  begin perform public.command_work_task(tid,'start','{}',1,gen_random_uuid()); raise exception 'TEST_STALE_VERSION_ACCEPTED';
    exception when sqlstate 'P0001' then if sqlerrm<>'WORK_VERSION_CONFLICT' then raise; end if; end;
  r:=pg_temp.work_command(tid,'start');
  if r->>'status'<>'in_progress' then raise exception 'TEST_START'; end if;
  insert into work_lifecycle_data values('retryKey',to_jsonb(k)),('retryResult',again);
end $$;
select pg_temp.work_as('coassignee');
do $$ declare tid uuid := (select (value->>'taskId')::uuid from work_lifecycle_data where key='created'); r jsonb; oldid uuid; begin
  r:=pg_temp.work_command(tid,'request_clarification','{"reason":"Please clarify my part"}');
  if r->>'status'<>'in_progress' then raise exception 'TEST_CLARIFICATION_BLOCKED_COLLABORATOR'; end if;
  perform pg_temp.work_command(tid,'acknowledge');
  select id into oldid from public.work_task_assignments where task_id=tid and user_id=public.current_app_user_id() and ended_at is null;
  r:=pg_temp.work_command(tid,'transfer',jsonb_build_object('userId',(select id from work_lifecycle_people where name='replacement'),'reason','Correct recipient'));
  if not exists(select 1 from public.work_task_assignments where id=oldid and state='transferred' and ended_at is not null and transfer_to_assignment_id is not null) then raise exception 'TEST_TRANSFER_HISTORY'; end if;
  if not exists(select 1 from public.work_task_assignments where task_id=tid and user_id=(select id from work_lifecycle_people where name='replacement')
    and state='pending_acknowledgement' and acknowledgement_due_at>assigned_at and execution_sla_started_at is null and transfer_from_assignment_id=oldid) then raise exception 'TEST_TRANSFER_NEW_SLA'; end if;
  if public.get_work_task_detail(tid::text)->'capabilities'->>'canStart'<>'false' then raise exception 'TEST_TRANSFERRED_MUTATION_CAPABILITY'; end if;
  if (select deadline_at from public.work_tasks where id=tid) is distinct from (select (value->>'deadlineAt')::timestamptz from work_lifecycle_data where key='input') then raise exception 'TEST_TRANSFER_DEADLINE_CHANGED'; end if;
end $$;
select pg_temp.work_as('creator');
do $$ declare tid uuid := (select (value->>'taskId')::uuid from work_lifecycle_data where key='created'); r jsonb; begin
  r:=pg_temp.work_command(tid,'add_assignees',jsonb_build_object('userIds',jsonb_build_array((select id from work_lifecycle_people where name='watcher'))));
  if (select count(*) from public.work_task_assignments where task_id=tid and ended_at is null)<>3 then raise exception 'TEST_ADD_COASSIGNEE'; end if;
  begin perform pg_temp.work_command(tid,'add_assignees',jsonb_build_object('userIds',jsonb_build_array((select id from work_lifecycle_people where name='watcher'))));
    raise exception 'TEST_DUPLICATE_COASSIGNEE_ACCEPTED'; exception when sqlstate 'P0001' then if sqlerrm<>'WORK_ASSIGNEE_ALREADY_ACTIVE' then raise; end if; end;
end $$;
select pg_temp.work_as('assignee');
do $$ declare tid uuid := (select (value->>'taskId')::uuid from work_lifecycle_data where key='created'); r jsonb; begin
  begin perform pg_temp.work_command(tid,'block','{}'); raise exception 'TEST_BLOCK_REASON_OPTIONAL'; exception when invalid_parameter_value then null; end;
  perform pg_temp.work_command(tid,'block','{"reason":"Waiting for materials"}');
  r:=pg_temp.work_command(tid,'unblock'); if r->>'status'<>'in_progress' then raise exception 'TEST_UNBLOCK'; end if;
  r:=pg_temp.work_command(tid,'submit','{"result":{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"First result"}]}]}}');
  if r->>'status'<>'awaiting_review' then raise exception 'TEST_SUBMISSION'; end if;
  begin perform pg_temp.work_command(tid,'review','{"decision":"approve"}'); raise exception 'TEST_SELF_REVIEW_ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('creator');
do $$ declare tid uuid := (select (value->>'taskId')::uuid from work_lifecycle_data where key='created'); r jsonb; begin
  begin perform pg_temp.work_command(tid,'review','{"decision":"request_changes"}'); raise exception 'TEST_REVIEW_NOTE_OPTIONAL'; exception when invalid_parameter_value then null; end;
  r:=pg_temp.work_command(tid,'review','{"decision":"request_changes","reason":"Add evidence"}');
  if r->>'status'<>'changes_requested' then raise exception 'TEST_REVIEW_REJECTION'; end if;
end $$;
select pg_temp.work_as('assignee');
do $$ declare tid uuid := (select (value->>'taskId')::uuid from work_lifecycle_data where key='created'); begin
  perform pg_temp.work_command(tid,'start');
  perform pg_temp.work_command(tid,'submit','{"result":{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Second result"}]}]}}');
end $$;
select pg_temp.work_as('creator');
do $$ declare tid uuid := (select (value->>'taskId')::uuid from work_lifecycle_data where key='created'); r jsonb; begin
  r:=pg_temp.work_command(tid,'review','{"decision":"approve"}');
  if r->>'status'<>'completed' or exists(select 1 from public.work_task_assignments where task_id=tid and ended_at is null) then raise exception 'TEST_COMPLETION_CLOSE_ASSIGNMENTS'; end if;
  if (select count(*) from public.work_task_submissions where task_id=tid)<>2 then raise exception 'TEST_SUBMISSION_ITERATIONS'; end if;
  r:=public.get_work_task_clone_draft(tid);
  if not (r->'draft'->'recipientSources') @> jsonb_build_array(jsonb_build_object('type','user','id',(select id from work_lifecycle_people where name='replacement')))
    or (r->'draft'->'recipientSources') @> jsonb_build_array(jsonb_build_object('type','user','id',(select id from work_lifecycle_people where name='coassignee'))) then raise exception 'TEST_CLONE_CURRENT_RECIPIENTS'; end if;
  if r->'draft'->'checklist'->0 ? 'assigneeUserId' then raise exception 'TEST_CLONE_STALE_CHECKLIST_ASSIGNEE'; end if;
end $$;
select pg_temp.work_as('assignee');
do $$ declare tid uuid := (select (value->>'taskId')::uuid from work_lifecycle_data where key='created'); r jsonb; begin
  if public.get_work_task_detail(tid::text)->'task'->>'status'<>'completed' then raise exception 'TEST_CLOSED_ASSIGNEE_READ'; end if;
  begin perform pg_temp.work_command(tid,'start'); raise exception 'TEST_TERMINAL_MUTATION'; exception when sqlstate 'P0001' then if sqlerrm<>'WORK_TASK_TERMINAL' then raise; end if; end;
  r:=public.command_work_task(tid,'acknowledge','{}',1,(select (value#>>'{}')::uuid from work_lifecycle_data where key='retryKey'));
  if r is distinct from (select value from work_lifecycle_data where key='retryResult') then raise exception 'TEST_ORIGINAL_RESPONSE_AFTER_TRANSITIONS'; end if;
end $$;
reset role;
do $$ declare tid uuid := (select (value->>'taskId')::uuid from work_lifecycle_data where key='created'); begin
  if (select count(*) from public.work_task_events where task_id=tid)<>(select count(*) from app_private.work_notification_outbox where task_id=tid) then raise exception 'TEST_LIFECYCLE_OUTBOX_ATOMICITY'; end if;
end $$;
set local role authenticated;
select pg_temp.work_as('creator');
do $$ declare input jsonb:=(select value from work_lifecycle_data where key='input'); src jsonb; p jsonb; r jsonb; tid uuid; version_before bigint; begin
  src:=jsonb_build_array(jsonb_build_object('type','user','id',public.current_app_user_id()));
  input:=input||jsonb_build_object('recipientSources',src,'watcherUserIds','[]'::jsonb,'checklist','[]'::jsonb);
  p:=public.preview_work_task_recipients(src,'{"type":"direct"}');
  r:=public.create_work_task(input,gen_random_uuid(),p->>'fingerprint'); tid:=(r->>'taskId')::uuid;
  perform pg_temp.work_command(tid,'start');
  r:=pg_temp.work_command(tid,'submit','{"result":{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Personal result"}]}]}}');
  if r->>'status'<>'completed' or not exists(select 1 from public.work_task_submissions where task_id=tid and status='approved') then raise exception 'TEST_AUTO_COMPLETE'; end if;
  r:=public.create_work_task(input,gen_random_uuid(),p->>'fingerprint'); tid:=(r->>'taskId')::uuid;
  perform pg_temp.work_command(tid,'add_assignees',jsonb_build_object('userIds',jsonb_build_array((select id from work_lifecycle_people where name='replacement'))));
  if not exists(select 1 from public.work_tasks where id=tid and review_policy='creator_review' and reviewer_user_id=public.current_app_user_id()) then raise exception 'TEST_AUTO_POLICY_UPGRADE'; end if;
  r:=pg_temp.work_command(tid,'cancel','{"reason":"No longer needed"}');
  if r->>'status'<>'cancelled' or exists(select 1 from public.work_task_assignments where task_id=tid and ended_at is null) then raise exception 'TEST_CANCEL_CLOSE'; end if;
  r:=public.create_work_task(input,gen_random_uuid(),p->>'fingerprint'); tid:=(r->>'taskId')::uuid;
  perform pg_temp.work_command(tid,'start');
  perform pg_temp.work_command(tid,'block','{"reason":"Obstacle remains when responsibility changes"}');
  r:=pg_temp.work_command(tid,'transfer',jsonb_build_object('userId',(select id from work_lifecycle_people where name='replacement'),'reason','Hand over blocked task'));
  if r->>'status'<>'blocked' or (select blocked_reason from public.work_tasks where id=tid) is null then raise exception 'TEST_TRANSFER_CLEARED_SHARED_BLOCKER'; end if;
  input:=(select value from work_lifecycle_data where key='input')||'{"privacy":"restricted"}';
  p:=public.preview_work_task_recipients(input->'recipientSources','{"type":"direct"}');
  r:=public.create_work_task(input,gen_random_uuid(),p->>'fingerprint'); tid:=(r->>'taskId')::uuid;
  insert into work_lifecycle_data values('restricted',to_jsonb(tid));
  select lock_version into version_before from public.work_tasks where id=tid;
  begin
    perform pg_temp.work_command(tid,'add_assignees',jsonb_build_object('userIds',jsonb_build_array((select id from work_lifecycle_people where name='replacement'))));
    raise exception 'TEST_RESTRICTED_INVITE_BYPASS';
  exception when insufficient_privilege then if sqlerrm<>'WORK_RESTRICTED_RECIPIENT_DENIED' then raise; end if; end;
  if (select lock_version from public.work_tasks where id=tid)<>version_before then raise exception 'TEST_REJECTED_COMMAND_CHANGED_VERSION'; end if;
end $$;
do $$ declare input jsonb; p jsonb; r jsonb; begin
  input:=(select value from work_lifecycle_data where key='input')||jsonb_build_object('scope',jsonb_build_object('type','department','departmentId',(select value from work_lifecycle_data where key='department')));
  p:=public.preview_work_task_recipients(input->'recipientSources',input->'scope');
  r:=public.create_work_task(input,gen_random_uuid(),p->>'fingerprint');
  insert into work_lifecycle_data values('managedTask',r);
end $$;
select pg_temp.work_as('manager');
do $$ declare tid uuid:=(select (value->>'taskId')::uuid from work_lifecycle_data where key='managedTask'); r jsonb; begin
  r:=pg_temp.work_command(tid,'cancel','{"reason":"Scoped manager cancellation"}');
  if r->>'status'<>'cancelled' then raise exception 'TEST_SCOPED_MANAGER_CANCEL'; end if;
  begin
    perform public.command_work_task((select (value#>>'{}')::uuid from work_lifecycle_data where key='restricted'),'cancel','{"reason":"Outside scope"}',1,gen_random_uuid());
    raise exception 'TEST_MANAGER_SCOPE_ESCAPE';
  exception when insufficient_privilege then if sqlerrm<>'WORK_TASK_NOT_FOUND' then raise; end if; end;
end $$;
select pg_temp.work_as('outsider');
do $$ declare tid uuid:=(select (value#>>'{}')::uuid from work_lifecycle_data where key='restricted'); begin
  begin perform public.command_work_task(tid,'acknowledge','{}',1,gen_random_uuid()); raise exception 'TEST_UNRELATED_COMMAND';
    exception when insufficient_privilege then if sqlerrm<>'WORK_TASK_NOT_FOUND' then raise; end if; end;
end $$;
select pg_temp.work_as('assignee');
do $$ declare tid uuid:=(select (value#>>'{}')::uuid from work_lifecycle_data where key='restricted'); begin
  begin perform pg_temp.work_command(tid,'transfer',jsonb_build_object('userId',(select id from work_lifecycle_people where name='replacement'),'reason','Test restricted transfer')); raise exception 'TEST_RESTRICTED_TRANSFER_BYPASS';
    exception when insufficient_privilege then if sqlerrm<>'WORK_RESTRICTED_RECIPIENT_DENIED' then raise; end if; end;
  begin perform pg_temp.work_command(tid,'cancel','{"reason":"Not the creator"}'); raise exception 'TEST_ASSIGNEE_CANCEL_ALLOWED';
    exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select pg_temp.work_as('inactive');
do $$ declare tid uuid:=(select (value#>>'{}')::uuid from work_lifecycle_data where key='restricted'); begin
  begin perform public.command_work_task(tid,'acknowledge','{}',1,gen_random_uuid()); raise exception 'TEST_INACTIVE_COMMAND';
    exception when insufficient_privilege then if sqlerrm<>'WORK_TASK_NOT_FOUND' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.command_work_task(uuid,text,jsonb,bigint,uuid)','execute')
    or has_function_privilege('authenticated','app_private.work_assert_assignment_recipient(uuid,uuid)','execute') then raise exception 'TEST_LIFECYCLE_PRIVILEGES'; end if;
end $$;
select 'WORK_LIFECYCLE_SMOKE_PASSED' as result;
rollback;

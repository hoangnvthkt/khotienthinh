begin;

do $$
begin
  if to_regprocedure('public.list_work_task_children(uuid,jsonb,integer)') is null
    or to_regprocedure('public.list_work_task_watcher_candidates(uuid,text,uuid,integer)') is null
    or not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='work_tasks' and column_name='parent_task_id')
    or not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='work_tasks' and column_name='planned_start_at') then
    raise exception 'WORK_CHILD_SCHEDULE_WATCHER_MIGRATION_MISSING' using errcode='42883';
  end if;
end;
$$;

create temporary table work_child_people(name text primary key,id uuid,email text) on commit drop;
create temporary table work_child_data(key text primary key,value jsonb) on commit drop;
grant select on work_child_people to authenticated;
grant all on work_child_data to authenticated;

insert into work_child_people
select name,gen_random_uuid(),'child-'||gen_random_uuid()||'@invalid.local'
from unnest(array['creator','assignee','watcher','manager','outsider','inactive']) name;

insert into public.users(id,name,username,email,role,is_active,account_status)
select id,'Child '||name,'child-'||id,email,'EMPLOYEE',name<>'inactive',
  case when name='inactive' then 'DISABLED' else 'ACTIVE' end
from work_child_people;

insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.module.access','global','*','child rollback smoke'
from work_child_people where name<>'inactive';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.view_related','assigned','*','child rollback smoke'
from work_child_people where name in('assignee','watcher','manager');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,permission,'own','*','child rollback smoke'
from work_child_people cross join unnest(array['work.task.create','work.task.view_related','work.task.audit_view']) permission
where name='creator';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.assign_user','global','*','child rollback smoke'
from work_child_people where name='creator';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.review','assigned','*','child rollback smoke'
from work_child_people where name='creator';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
select id,permission,'global','*','child rollback smoke',now()+interval '1 day'
from work_child_people cross join unnest(array['work.task.manage_scope','work.task.view_scope']) permission
where name='manager';

insert into public.work_sla_calendars(name,workday_start,workday_end,is_default,created_by)
select 'Child rollback calendar','08:00','17:00',true,id
from work_child_people where name='creator';

create function pg_temp.work_child_as(p_name text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform set_config('request.jwt.claims',(select jsonb_build_object(
    'sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from pg_temp.work_child_people where name=p_name),true);
end $$;
grant execute on function pg_temp.work_child_as(text) to authenticated;

create function pg_temp.work_child_doc(p_text text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('version',1,'type','doc','content',jsonb_build_array(
    jsonb_build_object('type','paragraph','content',jsonb_build_array(
      jsonb_build_object('type','text','text',p_text)))));
$$;
grant execute on function pg_temp.work_child_doc(text) to authenticated;

-- Structural guards run independently of browser RLS.
with rows as (
  insert into public.work_workspaces(kind,name,status,access_mode,created_by)
  select 'collaboration','Child boundary A','active','workspace',id from work_child_people where name='creator'
  union all
  select 'collaboration','Child boundary B','active','workspace',id from work_child_people where name='creator'
  returning id,name
)
insert into work_child_data(key,value)
select case name when 'Child boundary A' then 'workspace_a' else 'workspace_b' end,to_jsonb(id) from rows;

with row_data as (
  insert into public.work_tasks(task_code,title,scope_type,workspace_id,privacy,priority,status,review_policy,created_by)
  select app_private.next_work_task_code(),'Boundary parent','workspace',(select (value#>>'{}')::uuid from work_child_data where key='workspace_a'),
    'standard','normal','not_started','creator_review',id from work_child_people where name='creator'
  returning id
)
insert into work_child_data values('boundary_parent',(select to_jsonb(id) from row_data));

do $$ begin
  begin
    insert into public.work_tasks(task_code,title,scope_type,workspace_id,privacy,priority,status,review_policy,created_by,parent_task_id)
    select app_private.next_work_task_code(),'Cross workspace child','workspace',
      (select (value#>>'{}')::uuid from work_child_data where key='workspace_b'),
      'standard','normal','not_started','creator_review',
      (select id from work_child_people where name='creator'),
      (select (value#>>'{}')::uuid from work_child_data where key='boundary_parent');
    raise exception 'TEST_CROSS_WORKSPACE_PARENT_ALLOWED';
  exception when check_violation then
    if sqlerrm<>'WORK_TASK_PARENT_BOUNDARY_MISMATCH' then raise; end if;
  end;
end $$;

with row_data as (
  insert into public.work_tasks(task_code,title,scope_type,privacy,priority,status,review_policy,created_by)
  select app_private.next_work_task_code(),'Depth parent','direct','standard','normal','not_started','creator_review',id
  from work_child_people where name='creator' returning id
)
insert into work_child_data values('depth_parent',(select to_jsonb(id) from row_data));

with child_data as (
  insert into public.work_tasks(task_code,title,scope_type,privacy,priority,status,review_policy,created_by,parent_task_id)
  select app_private.next_work_task_code(),'Depth child','direct','standard','normal','not_started','creator_review',
    (select id from work_child_people where name='creator'),
    (select (value#>>'{}')::uuid from work_child_data where key='depth_parent')
  returning id
)
insert into work_child_data values('depth_child',(select to_jsonb(id) from child_data));

do $$ begin
  begin
    insert into public.work_tasks(task_code,title,scope_type,privacy,priority,status,review_policy,created_by,parent_task_id)
    values(app_private.next_work_task_code(),'Grandchild','direct','standard','normal','not_started','creator_review',
      (select id from work_child_people where name='creator'),
      (select (value#>>'{}')::uuid from work_child_data where key='depth_child'));
    raise exception 'TEST_GRANDCHILD_ALLOWED';
  exception when check_violation then
    if sqlerrm<>'WORK_TASK_MAX_DEPTH' then raise; end if;
  end;
  begin
    update public.work_tasks set parent_task_id=id
    where id=(select (value#>>'{}')::uuid from work_child_data where key='depth_parent');
    raise exception 'TEST_SELF_PARENT_ALLOWED';
  exception when check_violation then null;
  end;
  begin
    insert into public.work_tasks(task_code,title,scope_type,privacy,priority,status,review_policy,created_by,parent_task_id)
    values(app_private.next_work_task_code(),'Privacy mismatch','direct','restricted','normal','not_started','creator_review',
      (select id from work_child_people where name='creator'),
      (select (value#>>'{}')::uuid from work_child_data where key='depth_parent'));
    raise exception 'TEST_PARENT_PRIVACY_MISMATCH_ALLOWED';
  exception when check_violation then
    if sqlerrm<>'WORK_TASK_PARENT_BOUNDARY_MISMATCH' then raise; end if;
  end;
  begin
    update public.work_tasks set privacy='restricted'
    where id=(select (value#>>'{}')::uuid from work_child_data where key='depth_parent');
    raise exception 'TEST_PARENT_BOUNDARY_CHANGED_WITH_CHILDREN';
  exception when check_violation then
    if sqlerrm<>'WORK_PARENT_HAS_CHILDREN_BOUNDARY' then raise; end if;
  end;
  begin
    insert into public.work_tasks(task_code,title,scope_type,privacy,priority,status,review_policy,created_by,planned_start_at,deadline_at)
    values(app_private.next_work_task_code(),'Invalid schedule','direct','standard','normal','not_started','creator_review',
      (select id from work_child_people where name='creator'),now()+interval '2 days',now()+interval '1 day');
    raise exception 'TEST_INVALID_PLANNED_RANGE_ALLOWED';
  exception when check_violation then null;
  end;
end $$;

set local role authenticated;
select pg_temp.work_child_as('creator');

do $$
declare v_input jsonb;v_preview jsonb;v_result jsonb;
begin
  v_input:=jsonb_build_object('title','Parent for child paging','description',pg_temp.work_child_doc('Parent'),
    'scope','{"type":"direct"}'::jsonb,
    'recipientSources',jsonb_build_array(jsonb_build_object('type','user','id',(select id from work_child_people where name='assignee'))),
    'watcherUserIds','[]'::jsonb,'reviewPolicy','creator_review','priority','normal','privacy','standard',
    'labels','[]'::jsonb,'checklist','[]'::jsonb,'plannedStartAt',now()+interval '1 hour','deadlineAt',now()+interval '2 days');
  v_preview:=public.preview_work_task_recipients(v_input->'recipientSources',v_input->'scope');
  v_result:=public.create_work_task(v_input,gen_random_uuid(),v_preview->>'fingerprint');
  insert into work_child_data values('parent',v_result);
end $$;

create function pg_temp.work_make_child(p_key text,p_assignee text)
returns void language plpgsql security invoker set search_path='' as $$
declare v_input jsonb;v_preview jsonb;v_result jsonb;
begin
  v_input:=jsonb_build_object('title','Child '||p_key,'description',pg_temp.work_child_doc(p_key),
    'scope','{"type":"direct"}'::jsonb,'parentTaskId',(select value->>'taskId' from pg_temp.work_child_data where key='parent'),
    'recipientSources',jsonb_build_array(jsonb_build_object('type','user','id',(select id from pg_temp.work_child_people where name=p_assignee))),
    'watcherUserIds','[]'::jsonb,'reviewPolicy','creator_review','priority','normal','privacy','standard',
    'labels','[]'::jsonb,'checklist','[]'::jsonb,'plannedStartAt',now()+interval '2 hours','deadlineAt',now()+interval '1 day');
  v_preview:=public.preview_work_task_recipients(v_input->'recipientSources',v_input->'scope');
  v_result:=public.create_work_task(v_input,gen_random_uuid(),v_preview->>'fingerprint');
  insert into pg_temp.work_child_data values(p_key,v_result);
end $$;
grant execute on function pg_temp.work_make_child(text,text) to authenticated;

select pg_temp.work_make_child('hidden_child','watcher');
select pg_temp.work_make_child('visible_child','assignee');
select pg_temp.work_make_child('cancelled_child','assignee');

reset role;
update public.work_tasks set status='completed',completed_at=now(),updated_at=now()
where id=(select (value->>'taskId')::uuid from work_child_data where key='visible_child');
update public.work_tasks set status='cancelled',cancelled_at=now(),updated_at=now()
where id=(select (value->>'taskId')::uuid from work_child_data where key='cancelled_child');
update public.work_tasks set status='completed',completed_at=now(),updated_at=now()
where id=(select (value->>'taskId')::uuid from work_child_data where key='parent');

set local role authenticated;
select pg_temp.work_child_as('creator');
do $$ declare v_page jsonb;begin
  v_page:=public.list_work_task_children((select (value->>'taskId')::uuid from work_child_data where key='parent'),null,2);
  if jsonb_array_length(v_page->'items')<>2 or v_page->'nextCursor' is null then raise exception 'TEST_CHILD_CURSOR_FIRST_PAGE %',v_page; end if;
  if v_page->'aggregate'<>jsonb_build_object('visibleTotal',2,'visibleCompleted',1,'visibleOpen',1,'visibleCancelled',1) then
    raise exception 'TEST_CHILD_AGGREGATE %',v_page->'aggregate';
  end if;
  if jsonb_array_length(public.list_work_task_children((select (value->>'taskId')::uuid from work_child_data where key='parent'),v_page->'nextCursor',2)->'items')<>1 then
    raise exception 'TEST_CHILD_CURSOR_SECOND_PAGE';
  end if;
  if public.get_work_task_detail((select value->>'taskId' from work_child_data where key='parent'))->'childAggregate'
    is distinct from v_page->'aggregate' then raise exception 'TEST_DETAIL_CHILD_AGGREGATE'; end if;
  if (select status from public.work_tasks where id=(select (value->>'taskId')::uuid from work_child_data where key='hidden_child'))<>'pending_acknowledgement' then
    raise exception 'TEST_PARENT_COMPLETION_CASCADED';
  end if;
  begin perform pg_temp.work_make_child('closed_parent_child','assignee');raise exception 'TEST_CHILD_ON_CLOSED_PARENT';
  exception when check_violation then if sqlerrm<>'WORK_PARENT_TASK_CLOSED' then raise;end if;end;
end $$;

select pg_temp.work_child_as('assignee');
do $$ declare v_page jsonb;begin
  v_page:=public.list_work_task_children((select (value->>'taskId')::uuid from work_child_data where key='parent'),null,30);
  if jsonb_array_length(v_page->'items')<>2
    or exists(select 1 from jsonb_array_elements(v_page->'items') x
      where x->>'id'=(select value->>'taskId' from work_child_data where key='hidden_child'))
    or v_page->'aggregate'<>jsonb_build_object('visibleTotal',1,'visibleCompleted',1,'visibleOpen',0,'visibleCancelled',1) then
    raise exception 'TEST_CHILD_PERMISSION_FILTER %',v_page;
  end if;
end $$;

-- Metadata changes are exact-authority, optimistic and idempotent.
select pg_temp.work_child_as('creator');
do $$
declare v_task uuid:=(select (value->>'taskId')::uuid from work_child_data where key='hidden_child');
  v_before bigint;v_result jsonb;v_key uuid:=gen_random_uuid();v_payload jsonb;
  v_reviewer_count integer;
begin
  select count(*) into v_reviewer_count from public.work_task_participants
  where task_id=v_task and participant_role='reviewer' and ended_at is null;
  select lock_version into v_before from public.work_tasks where id=v_task;
  v_payload:=jsonb_build_object('plannedStartAt',now()+interval '3 hours','deadlineAt',now()+interval '3 days','expectedLockVersion',v_before);
  v_result:=public.command_work_task_collaboration(v_task,'schedule_update',v_payload,v_key);
  if v_result is distinct from public.command_work_task_collaboration(v_task,'schedule_update',v_payload,v_key)
    or (v_result->>'taskLockVersion')::bigint<>v_before+1 then raise exception 'TEST_SCHEDULE_RETRY';end if;
  begin perform public.command_work_task_collaboration(v_task,'schedule_update',v_payload||jsonb_build_object('deadlineAt',now()+interval '4 days'),v_key);
    raise exception 'TEST_SCHEDULE_IDEMPOTENCY_CONFLICT';
  exception when sqlstate 'P0001' then if sqlerrm<>'WORK_IDEMPOTENCY_CONFLICT' then raise;end if;end;
  begin perform public.command_work_task_collaboration(v_task,'schedule_update',v_payload,gen_random_uuid());
    raise exception 'TEST_STALE_SCHEDULE_VERSION';
  exception when sqlstate 'P0001' then if sqlerrm<>'WORK_VERSION_CONFLICT' then raise;end if;end;
  v_before:=(v_result->>'taskLockVersion')::bigint;
  v_result:=public.command_work_task_collaboration(v_task,'watchers_update',jsonb_build_object(
    'addUserIds',jsonb_build_array((select id from work_child_people where name='watcher'),(select id from work_child_people where name='watcher')),
    'removeUserIds','[]'::jsonb,'expectedLockVersion',v_before),gen_random_uuid());
  if jsonb_array_length(v_result->'addedUserIds')<>1 or (v_result->>'taskLockVersion')::bigint<>v_before+1 then raise exception 'TEST_WATCHER_DEDUPE';end if;
  begin perform public.command_work_task_collaboration(v_task,'watchers_update',jsonb_build_object(
    'addUserIds',jsonb_build_array((select id from work_child_people where name='watcher')),
    'removeUserIds',jsonb_build_array((select id from work_child_people where name='watcher')),
    'expectedLockVersion',(v_result->>'taskLockVersion')::bigint),gen_random_uuid());
    raise exception 'TEST_WATCHER_OVERLAP_ALLOWED';
  exception when invalid_parameter_value then if sqlerrm<>'WORK_WATCHER_OVERLAP' then raise;end if;end;
  begin perform public.command_work_task_collaboration(v_task,'watchers_update',jsonb_build_object(
    'addUserIds',jsonb_build_array((select id from work_child_people where name='inactive')),
    'removeUserIds','[]'::jsonb,'expectedLockVersion',(v_result->>'taskLockVersion')::bigint),gen_random_uuid());
    raise exception 'TEST_INACTIVE_WATCHER_ALLOWED';
  exception when insufficient_privilege then null;end;
  begin perform public.command_work_task_collaboration(v_task,'watchers_update',jsonb_build_object(
    'addUserIds',jsonb_build_array((select id from work_child_people where name='outsider')),
    'removeUserIds','[]'::jsonb,'expectedLockVersion',(v_result->>'taskLockVersion')::bigint),gen_random_uuid());
    raise exception 'TEST_UNRELATED_WATCHER_ALLOWED';
  exception when insufficient_privilege then null;end;
  if (select count(*) from public.work_task_participants where task_id=v_task and participant_role='watcher' and ended_at is null)<>1 then
    raise exception 'TEST_FAILED_WATCHER_COMMAND_NOT_ATOMIC';end if;
  if not exists(select 1 from jsonb_array_elements(public.list_work_task_watcher_candidates(v_task,'Watcher',null,30)->'items') x
    where x->>'userId'=(select id::text from work_child_people where name='watcher')) then raise exception 'TEST_WATCHER_CANDIDATE';end if;
  v_before:=(v_result->>'taskLockVersion')::bigint;
  v_result:=public.command_work_task_collaboration(v_task,'watchers_update',jsonb_build_object(
    'addUserIds','[]'::jsonb,
    'removeUserIds',jsonb_build_array((select id from work_child_people where name='watcher')),
    'expectedLockVersion',v_before),gen_random_uuid());
  if jsonb_array_length(v_result->'removedUserIds')<>1
    or exists(select 1 from public.work_task_participants where task_id=v_task and participant_role='watcher' and ended_at is null)
    or not exists(select 1 from public.work_task_assignments where task_id=v_task
      and user_id=(select id from work_child_people where name='watcher') and ended_at is null)
    or (select count(*) from public.work_task_participants where task_id=v_task and participant_role='reviewer' and ended_at is null)<>v_reviewer_count then
    raise exception 'TEST_WATCHER_REMOVE_ROLE_ISOLATION';end if;
end $$;

select pg_temp.work_child_as('assignee');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_child_data where key='visible_child');v_version bigint;begin
  select lock_version into v_version from public.work_tasks where id=v_task;
  begin perform public.command_work_task_collaboration(v_task,'schedule_update',jsonb_build_object(
    'plannedStartAt',null,'deadlineAt',null,'expectedLockVersion',v_version),gen_random_uuid());
    raise exception 'TEST_ASSIGNEE_SCHEDULE_ALLOWED';
  exception when insufficient_privilege then null;end;
  begin perform public.list_work_task_watcher_candidates(v_task,'',null,30);raise exception 'TEST_ASSIGNEE_WATCHER_OPTIONS';
  exception when insufficient_privilege then null;end;
end $$;

select pg_temp.work_child_as('manager');
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_child_data where key='hidden_child');v_version bigint;begin
  select lock_version into v_version from public.work_tasks where id=v_task;
  perform public.command_work_task_collaboration(v_task,'schedule_update',jsonb_build_object(
    'plannedStartAt',null,'deadlineAt',now()+interval '5 days','expectedLockVersion',v_version),gen_random_uuid());
end $$;

reset role;
create function pg_temp.work_fail_metadata_outbox()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.event_type='task.schedule_updated' then raise exception 'TEST_INJECTED_EVENT_FAILURE';end if;
  return new;
end $$;
create trigger work_fail_metadata_outbox before insert on app_private.work_notification_outbox
for each row execute function pg_temp.work_fail_metadata_outbox();

set local role authenticated;
select pg_temp.work_child_as('creator');
do $$ declare
  v_task uuid:=(select (value->>'taskId')::uuid from work_child_data where key='hidden_child');
  v_version bigint;v_start timestamptz;v_deadline timestamptz;v_key uuid:=gen_random_uuid();
begin
  select lock_version,planned_start_at,deadline_at into v_version,v_start,v_deadline
  from public.work_tasks where id=v_task;
  begin
    perform public.command_work_task_collaboration(v_task,'schedule_update',jsonb_build_object(
      'plannedStartAt',now()+interval '6 hours','deadlineAt',now()+interval '6 days',
      'expectedLockVersion',v_version),v_key);
    raise exception 'TEST_EVENT_FAILURE_BYPASSED';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'TEST_INJECTED_EVENT_FAILURE' then raise;end if;
  end;
  if exists(select 1 from public.work_tasks where id=v_task and (
      lock_version is distinct from v_version
      or planned_start_at is distinct from v_start
      or deadline_at is distinct from v_deadline)) then
    raise exception 'TEST_EVENT_FAILURE_NOT_ATOMIC';
  end if;
  insert into work_child_data values('failed_event_key',to_jsonb(v_key));
end $$;

reset role;
do $$ begin
  if exists(select 1 from app_private.work_command_idempotency
    where idempotency_key=(select (value#>>'{}')::uuid from work_child_data where key='failed_event_key')) then
    raise exception 'TEST_EVENT_FAILURE_IDEMPOTENCY_PERSISTED';
  end if;
end $$;
drop trigger work_fail_metadata_outbox on app_private.work_notification_outbox;
do $$ begin
  if not exists(select 1 from public.work_task_events where event_type='task.schedule_updated')
    or not exists(select 1 from public.work_task_events where event_type='task.watchers_updated')
    or not exists(select 1 from app_private.work_notification_outbox where event_type='task.schedule_updated') then
    raise exception 'TEST_METADATA_AUDIT_OR_OUTBOX';
  end if;
end $$;

set local enable_seqscan=off;
do $$ declare v_plan jsonb;begin
  execute 'explain (format json) select id from public.work_tasks where parent_task_id=$1 order by updated_at desc,id desc limit 30'
    into v_plan using (select (value->>'taskId')::uuid from work_child_data where key='parent');
  if v_plan::text not like '%work_tasks_parent_active_idx%' then
    raise exception 'TEST_CHILD_PAGING_INDEX %',v_plan;
  end if;
end $$;
set local enable_seqscan=on;

select 'WORK_TASK_CHILDREN_SCHEDULE_WATCHERS_SMOKE_OK' as result;
rollback;

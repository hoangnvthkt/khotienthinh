begin;
set local role authenticated;
do $$ begin
  if to_regprocedure('public.process_work_notifications(integer)') is null then raise exception 'TEST_WORK_DELIVERY_MISSING'; end if;
  begin perform public.process_work_notifications(10); raise exception 'TEST_AUTHENTICATED_WORKER'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ begin
  if public.process_work_notifications(10)->>'enabled'<>'false' then raise exception 'TEST_WORKER_DEFAULT_ENABLED'; end if;
end $$;
reset role;
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

reset role;
update app_private.work_notification_settings set enabled=true;
update app_private.work_notification_outbox set processed_at=now() where task_id<>(select (value->>'taskId')::uuid from work_collab_data where key='task');
insert into public.web_push_subscriptions(user_id,endpoint,p256dh,auth)
select id,'https://fcm.googleapis.com/fcm/send/rollback-'||gen_random_uuid(),'fixture-key','fixture-auth' from work_collab_people cross join generate_series(1,2) where name in ('assignee','watcher');
set local role authenticated;
select pg_temp.work_as('assignee');
select public.command_work_task_collaboration((select (value->>'taskId')::uuid from work_collab_data where key='task'),'set_notifications','{"notificationsEnabled":false}',gen_random_uuid());
select pg_temp.work_as('watcher');
select public.command_work_task_collaboration((select (value->>'taskId')::uuid from work_collab_data where key='task'),'set_notifications','{"notificationsEnabled":false}',gen_random_uuid());
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare r jsonb; begin
  r:=public.process_work_notifications(20); if r->>'processed'<>'1' or r->>'failed'<>'0' then raise exception 'TEST_INITIAL_DELIVERY %',r; end if;
  r:=public.process_work_notifications(20); if r->>'processed'<>'0' then raise exception 'TEST_OUTBOX_REPLAY'; end if;
end $$;
reset role;
do $$ declare t uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); begin
  if (select count(*) from public.notifications where entity_id=t and user_id=(select id::text from work_collab_people where name='assignee'))<>1 then raise exception 'TEST_MUTED_ASSIGNMENT_MANDATORY'; end if;
  if exists(select 1 from public.notifications where entity_id=t and user_id in (select id::text from work_collab_people where name in ('watcher','creator','outsider','inactive','manager'))) then raise exception 'TEST_RECIPIENT_FANOUT'; end if;
  if (select count(*) from app_private.work_push_jobs)<>2 then raise exception 'TEST_PER_DEVICE_JOBS'; end if;
  if exists(select 1 from public.notifications where entity_id=t and (push_enabled or message like '%Collaboration%' or action_url not like '/#/work/tasks/VW-%')) then raise exception 'TEST_PUSH_LEAK_OR_LEGACY_TRIGGER'; end if;
end $$;
set local role authenticated;
select pg_temp.work_as('assignee');
do $$ begin
  update public.notifications set is_read=true where user_id=public.current_app_user_id()::text and work_delivery_id is not null;
  begin update public.notifications set user_id=(select id::text from work_collab_people where name='outsider') where work_delivery_id is not null; raise exception 'TEST_WORK_RETARGET'; exception when insufficient_privilege then null; end;
  begin insert into public.notifications(user_id,title,source_type) values(public.current_app_user_id()::text,'Spoof','work_task'); raise exception 'TEST_WORK_FABRICATION'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare jobs jsonb; begin
  jobs:=public.claim_work_push(20);
  if jsonb_array_length(jobs)<>2 then raise exception 'TEST_CLAIM_DEVICES %',jobs; end if;
  if public.claim_work_push(20)<>'[]' then raise exception 'TEST_ACTIVE_LEASE_RECLAIM'; end if;
  -- The second endpoint retries; the successful first endpoint must not reappear.
  perform public.finish_work_push((jobs->0->>'id')::uuid,(jobs->0->>'leaseToken')::uuid,'sent');
  perform public.finish_work_push((jobs->1->>'id')::uuid,(jobs->1->>'leaseToken')::uuid,'retry');
end $$;
reset role;
do $$ begin
  if (select count(*) from app_private.work_push_jobs where status='delivered')<>1 or not exists(select 1 from app_private.work_push_jobs where status='pending' and available_at>now()) then raise exception 'TEST_PUSH_BACKOFF'; end if;
end $$;
update app_private.work_push_jobs set available_at=now()-interval '1 second' where status='pending';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare jobs jsonb; begin
  jobs:=public.claim_work_push(20); if jsonb_array_length(jobs)<>1 then raise exception 'TEST_SUCCESSFUL_DEVICE_RETRIED'; end if;
  if public.finish_work_push((jobs->0->>'id')::uuid,gen_random_uuid(),'sent') then raise exception 'TEST_STALE_LEASE_FINISH'; end if;
  perform public.finish_work_push((jobs->0->>'id')::uuid,(jobs->0->>'leaseToken')::uuid,'gone');
end $$;
reset role;
do $$ begin
  if (select count(*) from public.web_push_subscriptions where user_id=(select id from work_collab_people where name='assignee') and is_active)<>1 then raise exception 'TEST_GONE_ENDPOINT_NOT_DISABLED'; end if;
end $$;
-- Muted watcher still receives a mention with the exact comment deep link.
set local role authenticated;
select pg_temp.work_as('creator');
do $$ declare r jsonb; t uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); begin
  r:=public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content',pg_temp.work_doc('Sensitive text never sent in push'),'mentionedUserIds',jsonb_build_array((select id from work_collab_people where name='watcher'))),gen_random_uuid());
  insert into work_collab_data values('mention',r);
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.process_work_notifications(20);
reset role;
do $$ begin
  if (select count(*) from public.notifications where user_id=(select id::text from work_collab_people where name='watcher') and metadata->>'eventType'='comment.mentioned'
    and metadata->>'mandatory'='true' and action_url like '%?comment='||(select value->'comment'->>'id' from work_collab_data where key='mention'))<>1 then raise exception 'TEST_MENTION_MUTE_OR_DEEP_LINK'; end if;
end $$;
-- Permission is revoked after enqueue and before device claim.
delete from public.user_permission_grants where permission_code='work.module.access' and user_id=(select id from work_collab_people where name='watcher');
set local role authenticated;
select pg_temp.work_as('watcher');
do $$ begin
  if exists(select 1 from public.notifications where work_delivery_id is not null) or exists(select 1 from public.work_task_revisions) then raise exception 'TEST_REVOKED_NOTIFICATION_OR_REVISION_LEAK'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ begin if public.claim_work_push(20)<>'[]' then raise exception 'TEST_REVOKED_PUSH_SENT'; end if; end $$;
reset role;
do $$ begin
  if (select count(*) from app_private.work_push_jobs where last_error='access_or_relationship_changed')<>2 then raise exception 'TEST_REVOKED_PUSH_SUPPRESSION'; end if;
end $$;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason) select id,'work.module.access','global','*','rollback smoke' from work_collab_people where name='watcher';
-- Exercise strict-manager resolution at the Work boundary with a rollback-only adapter.
create or replace function app_private.resolve_strict_direct_manager(p_user_id uuid) returns uuid language sql stable security definer set search_path='' as $$ select id from pg_temp.work_collab_people where name='manager'; $$;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
select id,'work.task.view_scope','global','*','rollback smoke',now()+interval '1 day' from work_collab_people where name='manager';
update public.work_tasks set deadline_at=now()-interval '1 minute' where id=(select (value->>'taskId')::uuid from work_collab_data where key='task');
update public.work_task_assignments set acknowledgement_due_at=now()-interval '1 minute' where task_id=(select (value->>'taskId')::uuid from work_collab_data where key='task');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare r jsonb; begin
  r:=public.process_work_notifications(20); if r->>'reminders'<>'2' then raise exception 'TEST_DUE_ACK_REMINDERS %',r; end if;
  r:=public.process_work_notifications(20); if r->>'reminders'<>'0' then raise exception 'TEST_REMINDER_DAILY_DEDUPE'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.notifications where user_id=(select id::text from work_collab_people where name='manager') and metadata->>'eventType'='assignment.ack_overdue') then raise exception 'TEST_MANAGER_ESCALATION'; end if;
  if exists(select 1 from public.notifications where user_id=(select id::text from work_collab_people where name='watcher') and metadata->>'eventType' in ('assignment.ack_overdue','task.overdue')) then raise exception 'TEST_REMINDER_WATCHER_FANOUT'; end if;
  if not exists(select 1 from public.notifications where user_id=(select id::text from work_collab_people where name='assignee') and metadata->>'eventType'='task.overdue') then raise exception 'TEST_MUTED_OWN_OVERDUE'; end if;
end $$;
-- Retry isolation: injected insert failure leaves no partial recipient delivery.
create function pg_temp.fail_work_notification() returns trigger language plpgsql as $$ begin raise exception 'fixture failure' using errcode='XX000'; end $$;
create trigger smoke_fail_work_notification before insert on public.notifications for each row execute function pg_temp.fail_work_notification();
with e as (insert into public.work_task_events(task_id,event_type,actor_user_id) values((select (value->>'taskId')::uuid from work_collab_data where key='task'),'task.blocked',(select id from work_collab_people where name='creator')) returning *)
insert into app_private.work_notification_outbox(event_id,task_id,event_type) select id,task_id,event_type from e;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare r jsonb; begin r:=public.process_work_notifications(20); if r->>'failed'<>'1' then raise exception 'TEST_FAILURE_NOT_RECORDED %',r; end if; end $$;
reset role;
do $$ begin
  if not exists(select 1 from app_private.work_notification_outbox where last_error='XX000' and attempt_count=1 and processed_at is null and available_at>now())
    or exists(select 1 from app_private.work_notification_deliveries d join app_private.work_notification_outbox o on o.id=d.outbox_id where o.last_error='XX000') then raise exception 'TEST_PARTIAL_DELIVERY_OR_BACKOFF'; end if;
end $$;
update app_private.work_notification_outbox set attempt_count=7,available_at=now() where last_error='XX000';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.process_work_notifications(20);
reset role;
drop trigger smoke_fail_work_notification on public.notifications;
do $$ begin
  if not exists(select 1 from app_private.work_notification_outbox where dead_at is not null and attempt_count=8) then raise exception 'TEST_RETRY_QUARANTINE'; end if;
  if has_function_privilege('authenticated','public.claim_work_push(integer)','EXECUTE') or has_function_privilege('anon','public.process_work_notifications(integer)','EXECUTE') then raise exception 'TEST_WORKER_ACL'; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='work_task_revisions') then raise exception 'TEST_REVISION_PUBLICATION'; end if;
end $$;

-- Stale leases are reclaimed with a fresh fencing token.
grant all on work_collab_data to service_role;
update app_private.work_push_jobs set status='suppressed',finished_at=now() where finished_at is null;
set local role authenticated;
select pg_temp.work_as('creator');
select public.command_work_task_collaboration((select (value->>'taskId')::uuid from work_collab_data where key='task'),'comment_create',jsonb_build_object('content',pg_temp.work_doc('Lease fixture'),'mentionedUserIds',jsonb_build_array((select id from work_collab_people where name='watcher'))),gen_random_uuid());
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.process_work_notifications(20);
insert into work_collab_data values('oldLeases',public.claim_work_push(20));
reset role;
update app_private.work_push_jobs set locked_at=now()-interval '3 minutes' where status='processing';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare jobs jsonb; j jsonb; old_token uuid; begin
  jobs:=public.claim_work_push(20); if jsonb_array_length(jobs)<>2 then raise exception 'TEST_EXPIRED_LEASE_RECOVERY'; end if;
  for j in select value from jsonb_array_elements(jobs) loop
    select (x->>'leaseToken')::uuid into old_token from work_collab_data d cross join lateral jsonb_array_elements(d.value) x where d.key='oldLeases' and x->>'id'=j->>'id';
    if old_token=(j->>'leaseToken')::uuid or public.finish_work_push((j->>'id')::uuid,old_token,'sent') then raise exception 'TEST_EXPIRED_WORKER_FENCE'; end if;
    perform public.finish_work_push((j->>'id')::uuid,(j->>'leaseToken')::uuid,'sent');
  end loop;
end $$;
reset role;
-- Routine comments are coalesced, while pending review bypasses the reviewer's mute.
set local role authenticated;
select pg_temp.work_as('creator');
select public.command_work_task_collaboration((select (value->>'taskId')::uuid from work_collab_data where key='task'),'comment_create',jsonb_build_object('content',pg_temp.work_doc('Routine one')),gen_random_uuid());
select public.command_work_task_collaboration((select (value->>'taskId')::uuid from work_collab_data where key='task'),'comment_create',jsonb_build_object('content',pg_temp.work_doc('Routine two')),gen_random_uuid());
select pg_temp.work_as('reviewer');
select public.command_work_task_collaboration((select (value->>'taskId')::uuid from work_collab_data where key='restricted'),'set_notifications','{"notificationsEnabled":false}',gen_random_uuid());
select pg_temp.work_as('assignee');
do $$ declare t uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='restricted'); begin
  perform public.command_work_task(t,'acknowledge','{}',(select lock_version from public.work_tasks where id=t),gen_random_uuid());
  perform public.command_work_task(t,'start','{}',(select lock_version from public.work_tasks where id=t),gen_random_uuid());
  perform public.command_work_task(t,'submit',jsonb_build_object('result',pg_temp.work_doc('Review evidence')),(select lock_version from public.work_tasks where id=t),gen_random_uuid());
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.process_work_notifications(20);
reset role;
do $$ begin
  if not exists(select 1 from app_private.work_notification_deliveries where last_error='cooldown') then raise exception 'TEST_ROUTINE_COOLDOWN'; end if;
  if not exists(select 1 from public.notifications where user_id=(select id::text from work_collab_people where name='reviewer') and metadata->>'eventType'='task.review_submitted' and metadata->>'mandatory'='true') then raise exception 'TEST_MUTED_REVIEW_REQUIRED'; end if;
end $$;
-- Technical admin access to the common notification table cannot reveal Work rows.
insert into work_collab_people values('technical_admin',gen_random_uuid(),'work-admin-'||gen_random_uuid()||'@invalid.local');
insert into public.users(id,name,username,email,role,is_active,account_status) select id,name,'collab-'||id,email,'ADMIN',true,'ACTIVE' from work_collab_people where name='technical_admin';
set local role authenticated;
select pg_temp.work_as('technical_admin');
do $$ begin if exists(select 1 from public.notifications where work_delivery_id is not null) then raise exception 'TEST_ADMIN_NOTIFICATION_BYPASS'; end if; end $$;
reset role;

-- Completion closes assignments before its outbox is delivered; recipients remain eligible.
set local role authenticated;
select pg_temp.work_as('reviewer');
select public.command_work_task((select (value->>'taskId')::uuid from work_collab_data where key='restricted'),'review','{"decision":"approve"}',(select lock_version from public.work_tasks where id=(select (value->>'taskId')::uuid from work_collab_data where key='restricted')),gen_random_uuid());
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.process_work_notifications(20);
reset role;
do $$ begin
  if not exists(select 1 from public.notifications where user_id=(select id::text from work_collab_people where name='assignee') and metadata->>'eventType'='task.completed') then raise exception 'TEST_COMPLETED_ASSIGNMENT_NOTIFICATION'; end if;
end $$;

select 'WORK_NOTIFICATION_DELIVERY_SMOKE_PASSED' as result;
rollback;

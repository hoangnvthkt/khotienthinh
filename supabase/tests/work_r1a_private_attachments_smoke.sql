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
-- Upload reservations are idempotent and subject-bound; no ready metadata leaks.
do $$ declare v_task uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); v_r jsonb; v_p jsonb; v_key uuid:=gen_random_uuid(); v_operation text; begin
 v_p:=jsonb_build_object('taskId',v_task,'fileName','test.txt','mimeType','text/plain','sizeBytes',5,'kind','input','keepOriginal',false);
 v_r:=public.command_work_attachment('begin',v_p,v_key);
 if v_r->>'status'<>'pending' or v_r is distinct from public.command_work_attachment('begin',v_p,v_key) then raise exception 'TEST_RESERVATION_RETRY'; end if;
 insert into work_collab_data values('file',v_r),('beginPayload',v_p),('beginKey',to_jsonb(v_key));
 if jsonb_array_length(public.get_work_task_detail(v_task::text)->'attachments')<>0 then raise exception 'TEST_PENDING_VISIBLE'; end if;
 begin perform public.command_work_attachment('begin',v_p||'{"sizeBytes":6}',v_key); raise exception 'TEST_KEY_REUSE'; exception when sqlstate 'P0001' then if sqlerrm<>'WORK_IDEMPOTENCY_CONFLICT' then raise; end if; end;
 begin perform public.command_work_attachment('begin',v_p||'{"fileName":"../unsafe.txt"}',gen_random_uuid()); raise exception 'TEST_FILENAME_TRAVERSAL'; exception when invalid_parameter_value then null; end;
 begin perform public.command_work_attachment('begin',v_p||'{"sizeBytes":26214401}',gen_random_uuid()); raise exception 'TEST_SIZE_LIMIT'; exception when invalid_parameter_value then null; end;
 begin perform public.command_work_attachment('begin',v_p||'{"mimeType":"text/html"}',gen_random_uuid()); raise exception 'TEST_MIME_ALLOWLIST'; exception when invalid_parameter_value then null; end;
 begin perform public.command_work_attachment('begin',v_p||'{"kind":"fake"}',gen_random_uuid()); raise exception 'TEST_KIND_ALLOWLIST'; exception when invalid_parameter_value then null; end;
 begin perform public.command_work_attachment('begin',v_p||'{"uploaderUserId":"fake"}',gen_random_uuid()); raise exception 'TEST_ACTOR_OVERRIDE'; exception when invalid_parameter_value then null; end;
 -- SQL Storage policy test only: rolled-back metadata, not a physical object upload.
 foreach v_operation in array array['storage.object.sign_upload_url','storage.object.upload_signed','storage.object.copy','storage.s3.upload','storage.tus.upload.create',''] loop
  perform set_config('storage.operation',v_operation,true);
  begin
   insert into storage.objects(bucket_id,name) values('work-attachments',v_r->>'path');
   raise exception 'TEST_ALTERNATE_UPLOAD_OPERATION_ALLOWED %',v_operation;
  exception when insufficient_privilege then null; end;
 end loop;
 perform set_config('storage.operation','storage.object.upload',true);
 insert into storage.objects(bucket_id,name) values('work-attachments',v_r->>'path');
 begin insert into storage.objects(bucket_id,name) values('work-attachments','unreserved/path'); raise exception 'TEST_UNRESERVED_UPLOAD'; exception when insufficient_privilege then null; end;
 if exists(select 1 from storage.objects where bucket_id='work-attachments') then raise exception 'TEST_DIRECT_STORAGE_READ'; end if;
 update storage.objects set metadata='{}' where bucket_id='work-attachments';
 if found then raise exception 'TEST_DIRECT_OVERWRITE'; end if;
 begin
  delete from storage.objects where bucket_id='work-attachments';
  if found then raise exception 'TEST_DIRECT_DELETE'; end if;
 exception when insufficient_privilege then null; end;
 begin perform public.command_work_attachment('read',jsonb_build_object('attachmentId',v_r->>'id','variant','original'),gen_random_uuid()); raise exception 'TEST_PENDING_SIGN'; exception when insufficient_privilege then null; end;
 begin perform public.finish_work_attachment((v_r->>'id')::uuid,gen_random_uuid(),'{}'); raise exception 'TEST_AUTH_FINISH_BYPASS'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('outsider');
do $$ declare v_id text:=(select value->>'id' from work_collab_data where key='file'); begin
 begin perform public.command_work_attachment('begin',(select value from work_collab_data where key='beginPayload'),gen_random_uuid()); raise exception 'TEST_OUTSIDER_RESERVATION'; exception when insufficient_privilege then null; end;
 begin perform public.command_work_attachment('claim',jsonb_build_object('attachmentId',v_id),gen_random_uuid()); raise exception 'TEST_OUTSIDER_CLAIM'; exception when insufficient_privilege then null; end;
 if app_private.work_attachment_upload_allowed((select value->>'path' from work_collab_data where key='file')) then raise exception 'TEST_OUTSIDER_UPLOAD'; end if;
end $$;
select pg_temp.work_as('watcher');
do $$ declare v_p jsonb:=(select value from work_collab_data where key='beginPayload'); v_r jsonb; begin
 if public.get_work_task_detail(v_p->>'taskId')->'capabilities'->>'canAttachInput'<>'false' or public.get_work_task_detail(v_p->>'taskId')->'capabilities'->>'canAttachDiscussion'<>'true' then raise exception 'TEST_ATTACHMENT_CAPABILITIES'; end if;
 begin perform public.command_work_attachment('begin',v_p,gen_random_uuid()); raise exception 'TEST_WATCHER_INPUT'; exception when insufficient_privilege then null; end;
 v_r:=public.command_work_attachment('begin',v_p||'{"kind":"discussion"}',gen_random_uuid());
 insert into work_collab_data values('watcherFile',v_r);
 begin perform public.command_work_attachment('claim',jsonb_build_object('attachmentId',(select value->>'id' from work_collab_data where key='file')),gen_random_uuid()); raise exception 'TEST_NONOWNER_CLAIM'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('creator');
do $$ declare v_id text:=(select value->>'id' from work_collab_data where key='file'); v_r jsonb; begin
 v_r:=public.command_work_attachment('claim',jsonb_build_object('attachmentId',v_id),gen_random_uuid());
 insert into work_collab_data values('claim',v_r);
 if app_private.work_attachment_upload_allowed(v_r->>'sourcePath') then raise exception 'TEST_UPLOAD_AFTER_CLAIM'; end if;
 begin perform public.command_work_attachment('claim',jsonb_build_object('attachmentId',v_id),gen_random_uuid()); raise exception 'TEST_CONCURRENT_CLAIM'; exception when sqlstate 'P0001' then if sqlerrm<>'WORK_ATTACHMENT_BUSY' then raise; end if; end;
 v_r:=public.command_work_attachment('begin',(select value from work_collab_data where key='beginPayload')||'{"kind":"evidence","mimeType":"image/jpeg","fileName":"evidence.jpg"}',gen_random_uuid());
 insert into work_collab_data values('evidence',v_r);
end $$;
reset role;
do $$ begin
 if not (select keep_original from public.work_task_attachments where id=(select (value->>'id')::uuid from work_collab_data where key='evidence')) then raise exception 'TEST_EVIDENCE_ORIGINAL_POLICY'; end if;
end $$;
grant all on work_collab_data to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare v_c jsonb:=(select value from work_collab_data where key='claim'); v_variants jsonb; begin
 v_variants:=jsonb_build_object('original',jsonb_build_object('path',v_c->>'outputPrefix'||'original','mimeType','text/plain','sizeBytes',5));
 insert into work_collab_data values('variants',v_variants);
 if public.finish_work_attachment((v_c->>'id')::uuid,gen_random_uuid(),v_variants) then raise exception 'TEST_STALE_LEASE'; end if;
 begin perform public.finish_work_attachment((v_c->>'id')::uuid,(v_c->>'token')::uuid,jsonb_build_object('original',jsonb_build_object('path','other/task/original','mimeType','text/plain','sizeBytes',5))); raise exception 'TEST_CROSS_PATH_FINISH'; exception when invalid_parameter_value then null; end;
 if not public.finish_work_attachment((v_c->>'id')::uuid,(v_c->>'token')::uuid,v_variants) then raise exception 'TEST_FINISH'; end if;
 if public.finish_work_attachment((v_c->>'id')::uuid,(v_c->>'token')::uuid,v_variants) then raise exception 'TEST_REPEATED_FINISH'; end if;
end $$;
reset role;
do $$ declare v_id uuid:=(select (value->>'id')::uuid from work_collab_data where key='file'); begin
 if (select count(*) from public.work_task_events where event_type='attachment.added' and payload->>'attachmentId'=v_id::text)<>1 then raise exception 'TEST_AUDIT_EXACTLY_ONCE'; end if;
 if exists(select 1 from app_private.work_attachment_cleanup where path=(select value->'original'->>'path' from work_collab_data where key='variants')) then raise exception 'TEST_READY_QUEUED_FOR_DELETE'; end if;
 if not exists(select 1 from app_private.work_attachment_cleanup where path=(select value->>'path' from work_collab_data where key='file')) then raise exception 'TEST_TEMP_CLEANUP_LOST'; end if;
end $$;
set local role authenticated;
select pg_temp.work_as('watcher');
do $$ declare v_id text:=(select value->>'id' from work_collab_data where key='file'); v_r jsonb; begin
 v_r:=public.command_work_attachment('read',jsonb_build_object('attachmentId',v_id,'variant','original'),gen_random_uuid());
 if (select value->>'can_delete' from jsonb_array_elements(public.get_work_task_detail((select value->>'taskId' from work_collab_data where key='task'))->'attachments') where value->>'id'=v_id)<>'false' then raise exception 'TEST_ATTACHMENT_DELETE_CAPABILITY'; end if;
 if v_r->>'expiresIn'<>'60' then raise exception 'TEST_URL_TTL'; end if;
 begin perform public.command_work_attachment('delete',jsonb_build_object('attachmentId',v_id),gen_random_uuid()); raise exception 'TEST_WATCHER_DELETE_OTHER'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('outsider');
do $$ begin
 if exists(select 1 from public.work_task_attachments) then raise exception 'TEST_READY_RLS'; end if;
 begin perform public.command_work_attachment('read',jsonb_build_object('attachmentId',(select value->>'id' from work_collab_data where key='file'),'variant','original'),gen_random_uuid()); raise exception 'TEST_OUTSIDER_SIGN'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('creator');
do $$ declare v_id text:=(select value->>'id' from work_collab_data where key='file'); v_r jsonb; begin
 if public.command_work_attachment('claim',jsonb_build_object('attachmentId',v_id),gen_random_uuid())->>'status'<>'ready' then raise exception 'TEST_READY_CLAIM_RETRY'; end if;
 v_r:=public.command_work_attachment('delete',jsonb_build_object('attachmentId',v_id),gen_random_uuid());
 if v_r is distinct from public.command_work_attachment('delete',jsonb_build_object('attachmentId',v_id),gen_random_uuid()) then raise exception 'TEST_DELETE_RETRY'; end if;
 begin perform public.command_work_attachment('read',jsonb_build_object('attachmentId',v_id,'variant','original'),gen_random_uuid()); raise exception 'TEST_DELETED_SIGN'; exception when insufficient_privilege then null; end;
end $$;
-- Revoke a watcher's access while their file is processing. Finalization must reject.
select pg_temp.work_as('watcher');
insert into work_collab_data select 'revokedClaim',public.command_work_attachment('claim',jsonb_build_object('attachmentId',(select value->>'id' from work_collab_data where key='watcherFile')),gen_random_uuid());
reset role;
update public.work_task_participants set ended_at=now() where user_id=(select id from work_collab_people where name='watcher');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare v_c jsonb:=(select value from work_collab_data where key='revokedClaim'); begin
 if public.finish_work_attachment((v_c->>'id')::uuid,(v_c->>'token')::uuid,jsonb_build_object('original',jsonb_build_object('path',v_c->>'outputPrefix'||'original','mimeType','text/plain','sizeBytes',5))) then raise exception 'TEST_REVOKED_FINISH'; end if;
end $$;
reset role;
do $$ begin
 if (select status from public.work_task_attachments where id=(select (value->>'id')::uuid from work_collab_data where key='watcherFile'))<>'rejected' then raise exception 'TEST_REVOKED_STATE'; end if;
 if (select count(*) from public.work_task_events where event_type='attachment.deleted')<>1 then raise exception 'TEST_DELETE_EVENT_DEDUPE'; end if;
 if (select count(*) from app_private.work_notification_outbox where event_type like 'attachment.%')<>2 then raise exception 'TEST_ATTACHMENT_OUTBOX'; end if;
end $$;
-- Expiration and cleanup leases: never let a stale worker settle another attempt.
update public.work_task_attachments set upload_expires_at=now()-interval '1 hour' where status='pending';
update app_private.work_attachment_cleanup set available_at=now()-interval '1 minute';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare v_jobs jsonb; v_job jsonb; begin
 v_jobs:=public.claim_work_attachment_cleanup(30);
 if jsonb_array_length(v_jobs)<1 then raise exception 'TEST_CLEANUP_EMPTY'; end if;
 if public.claim_work_attachment_cleanup(30)<>'[]' then raise exception 'TEST_CLEANUP_DOUBLE_CLAIM'; end if;
 v_job:=v_jobs->0;
 if public.finish_work_attachment_cleanup(v_job->>'path',gen_random_uuid(),true) then raise exception 'TEST_CLEANUP_STALE_TOKEN'; end if;
 if not public.finish_work_attachment_cleanup(v_job->>'path',(v_job->>'token')::uuid,false) then raise exception 'TEST_CLEANUP_RETRY'; end if;
 v_job:=v_jobs->1;
 if not public.finish_work_attachment_cleanup(v_job->>'path',(v_job->>'token')::uuid,true) then raise exception 'TEST_CLEANUP_SUCCESS'; end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.work_task_attachments where status='pending') then raise exception 'TEST_EXPIRED_NOT_REJECTED'; end if;
 if not exists(select 1 from app_private.work_attachment_cleanup where last_error='storage_delete_failed' and available_at>now() and lease_token is null) then raise exception 'TEST_CLEANUP_BACKOFF'; end if;
 if exists(select 1 from storage.buckets where id='work-attachments' and public) then raise exception 'TEST_PUBLIC_BUCKET'; end if;
end $$;
set local role anon;
do $$ begin
 begin insert into storage.objects(bucket_id,name) values('work-attachments','anonymous'); raise exception 'TEST_ANON_UPLOAD'; exception when insufficient_privilege then null; end;
 if exists(select 1 from storage.objects where bucket_id='work-attachments') then raise exception 'TEST_ANON_READ'; end if;
end $$;
reset role;
select 'work attachment persona, Storage RLS, finalization and cleanup smoke passed' as result;
rollback;

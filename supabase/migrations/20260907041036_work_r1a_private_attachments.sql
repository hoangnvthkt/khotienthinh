-- Task 7. Private Storage and fenced two-phase attachment finalization.
alter table public.work_task_attachments
  add column attachment_kind text not null default 'input' check (attachment_kind in ('input','discussion','result','evidence')),
  add column upload_expires_at timestamptz not null default (now()+interval '15 minutes'),
  add column processing_token uuid,
  add column processing_expires_at timestamptz,
  add column processing_attempts integer not null default 0,
  add column rejection_code text;

create table app_private.work_attachment_cleanup (
  path text primary key,
  available_at timestamptz not null,
  lease_token uuid,
  locked_until timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
alter table app_private.work_attachment_cleanup enable row level security;
revoke all on app_private.work_attachment_cleanup from public,anon,authenticated;
create index work_attachment_cleanup_due_idx on app_private.work_attachment_cleanup(available_at,path);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('work-attachments','work-attachments',false,26214400,array['image/jpeg','image/png','image/webp','application/pdf','text/plain']);

create function app_private.work_attachment_can_mutate(p_task_id uuid,p_user_id uuid,p_kind text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(app_private.work_task_user_can_view(p_task_id,p_user_id) and exists(
  select 1 from public.work_tasks t where t.id=p_task_id and t.status not in ('completed','cancelled')
   and (p_kind in ('discussion','evidence') or t.status<>'awaiting_review')
   and (t.created_by=p_user_id
    or app_private.has_permission(p_user_id,'work.task.manage_scope',case when t.scope_type='direct' then 'global' else t.scope_type end,coalesce(t.department_id::text,t.project_id,'*'))
    or exists(select 1 from public.work_task_assignments a where a.task_id=t.id and a.user_id=p_user_id and a.ended_at is null and (p_kind in ('discussion','evidence') or a.acknowledged_at is not null))
    or (p_kind in ('discussion','evidence') and exists(select 1 from public.work_task_participants p where p.task_id=t.id and p.user_id=p_user_id and p.ended_at is null))
   )),false);
$$;
revoke all on function app_private.work_attachment_can_mutate(uuid,uuid,text) from public,anon,authenticated;

create function app_private.work_attachment_upload_allowed(p_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_task_attachments a where a.storage_path=p_name
  and a.status='pending' and a.upload_expires_at>now() and a.uploader_user_id=public.current_app_user_id()
  and app_private.work_attachment_can_mutate(a.task_id,public.current_app_user_id(),a.attachment_kind));
$$;
revoke all on function app_private.work_attachment_upload_allowed(text) from public,anon,authenticated;
grant execute on function app_private.work_attachment_upload_allowed(text) to authenticated;
create policy work_attachment_upload on storage.objects for insert to authenticated
 with check (bucket_id='work-attachments' and app_private.work_attachment_upload_allowed(name));
create policy work_attachment_insert_boundary on storage.objects as restrictive for insert to authenticated
 with check (bucket_id<>'work-attachments' or app_private.work_attachment_upload_allowed(name));
create policy work_attachment_no_anon on storage.objects as restrictive for all to anon
 using(bucket_id<>'work-attachments') with check(bucket_id<>'work-attachments');
create policy work_attachment_no_client_read on storage.objects as restrictive for select to authenticated using(bucket_id<>'work-attachments');
create policy work_attachment_no_client_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'work-attachments') with check(bucket_id<>'work-attachments');
create policy work_attachment_no_client_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'work-attachments');

create function app_private.work_attachment_event(p_attachment_id uuid,p_actor uuid,p_type text)
returns void language plpgsql security definer set search_path='' as $$
declare v_a public.work_task_attachments%rowtype; v_event uuid;
begin
 select * into strict v_a from public.work_task_attachments where id=p_attachment_id;
 insert into public.work_task_events(task_id,actor_user_id,event_type,payload)
 values(v_a.task_id,p_actor,p_type,jsonb_build_object('attachmentId',v_a.id,'fileName',v_a.file_name,'kind',v_a.attachment_kind,'status',v_a.status)) returning id into v_event;
 insert into app_private.work_notification_outbox(event_id,task_id,event_type,payload)
 values(v_event,v_a.task_id,p_type,jsonb_build_object('taskId',v_a.task_id,'attachmentId',v_a.id));
end $$;
revoke all on function app_private.work_attachment_event(uuid,uuid,text) from public,anon,authenticated;

create function app_private.work_command_attachment(p_command text,p_payload jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=public.current_app_user_id(); v_task uuid; v_a public.work_task_attachments%rowtype;
 v_allowed text[]; v_hash text; v_prior app_private.work_command_idempotency%rowtype;
 v_name text; v_mime text; v_size bigint; v_kind text; v_keep boolean; v_id uuid; v_token uuid;
 v_response jsonb; v_path text; v_variant text;
begin
 if v_actor is null then raise exception 'WORK_ATTACHMENT_DENIED' using errcode='42501'; end if;
 v_allowed:=case p_command when 'begin' then array['taskId','fileName','mimeType','sizeBytes','kind','keepOriginal']
 when 'claim' then array['attachmentId'] when 'read' then array['attachmentId','variant'] when 'delete' then array['attachmentId'] end;
 if v_allowed is null or jsonb_typeof(p_payload) is distinct from 'object' or p_payload-v_allowed<>'{}' or octet_length(p_payload::text)>4000 or p_idempotency_key is null then
 raise exception 'WORK_INVALID_ATTACHMENT_COMMAND' using errcode='22023'; end if;
 if p_command='begin' then
  v_hash:=md5(p_payload::text);
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
   values(v_actor,p_idempotency_key,'work_attachment_begin',v_hash) on conflict do nothing;
  select * into strict v_prior from app_private.work_command_idempotency where actor_user_id=v_actor and idempotency_key=p_idempotency_key for update;
  if v_prior.command_name<>'work_attachment_begin' or v_prior.request_hash<>v_hash then raise exception 'WORK_IDEMPOTENCY_CONFLICT'; end if;
 end if;
 if p_command='begin' then v_task:=(p_payload->>'taskId')::uuid;
 else select task_id into v_task from public.work_task_attachments where id=(p_payload->>'attachmentId')::uuid; end if;
 -- Lock order matches lifecycle/collaboration: task before attachment.
 perform 1 from public.work_tasks where id=v_task for update;
 if not app_private.work_task_actor_can_view(v_task) then raise exception 'WORK_ATTACHMENT_DENIED' using errcode='42501'; end if;
 if p_command='begin' then
  v_kind:=p_payload->>'kind'; v_name:=btrim(p_payload->>'fileName'); v_mime:=p_payload->>'mimeType';
  if v_kind is null or v_kind not in ('input','discussion','result','evidence')
   or v_name is null or length(v_name) not between 1 and 180 or v_name ~ '[[:cntrl:]/\\]' or v_name ~ '[\u202A-\u202E\u2066-\u2069]' or left(v_name,1)='.'
   or v_mime is null or v_mime not in ('image/jpeg','image/png','image/webp','application/pdf','text/plain')
   or jsonb_typeof(p_payload->'sizeBytes') is distinct from 'number' or (p_payload->>'sizeBytes')::numeric<>trunc((p_payload->>'sizeBytes')::numeric)
   or jsonb_typeof(p_payload->'keepOriginal') is distinct from 'boolean' then raise exception 'WORK_INVALID_ATTACHMENT' using errcode='22023'; end if;
  v_size:=(p_payload->>'sizeBytes')::bigint;
  if v_size<1 or v_size>(case when v_mime like 'image/%' then 5242880 else 26214400 end) then raise exception 'WORK_ATTACHMENT_TOO_LARGE' using errcode='22023'; end if;
  if not app_private.work_attachment_can_mutate(v_task,v_actor,v_kind) then raise exception 'WORK_ATTACHMENT_DENIED' using errcode='42501'; end if;
  v_keep:=(p_payload->>'keepOriginal')::boolean or v_kind='evidence' or v_mime not like 'image/%';
  if v_prior.response_payload is not null then return v_prior.response_payload; end if;
  if (select count(*) from public.work_task_attachments where uploader_user_id=v_actor and status in ('pending','processing') and upload_expires_at>now())>=20 then raise exception 'WORK_UPLOAD_LIMIT'; end if;
  v_id:=gen_random_uuid(); v_path:=v_task::text||'/'||v_id::text||'/upload';
  insert into public.work_task_attachments(id,task_id,uploader_user_id,file_name,mime_type,size_bytes,storage_path,attachment_kind,keep_original)
   values(v_id,v_task,v_actor,v_name,v_mime,v_size,v_path,v_kind,v_keep) returning * into v_a;
  insert into app_private.work_attachment_cleanup(path,available_at) values(v_path,v_a.upload_expires_at+interval '1 hour');
  v_response:=jsonb_build_object('id',v_id,'status','pending','bucket','work-attachments','path',v_path,'expiresAt',v_a.upload_expires_at);
  update app_private.work_command_idempotency set response_payload=v_response,completed_at=now() where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  return v_response;
 end if;
 select * into v_a from public.work_task_attachments where id=(p_payload->>'attachmentId')::uuid and task_id=v_task for update;
 if v_a.id is null then raise exception 'WORK_ATTACHMENT_DENIED' using errcode='42501'; end if;
 if p_command='read' then
  v_variant:=p_payload->>'variant';
  if v_a.status<>'ready' or v_a.deleted_at is not null or v_variant is null or v_variant not in ('thumbnail','display','fallback','original') or not(v_a.variants ? v_variant) then raise exception 'WORK_ATTACHMENT_NOT_READY' using errcode='42501'; end if;
  return jsonb_build_object('path',v_a.variants->v_variant->>'path','mimeType',v_a.variants->v_variant->>'mimeType','fileName',v_a.file_name,'expiresIn',60);
 end if;
 if not app_private.work_attachment_can_mutate(v_task,v_actor,v_a.attachment_kind)
  or (v_a.uploader_user_id<>v_actor and (p_command='claim' or not (app_private.work_task_capabilities(v_task)->>'canCancel')::boolean)) then raise exception 'WORK_ATTACHMENT_DENIED' using errcode='42501'; end if;
 if p_command='delete' then
  if v_a.status='deleted' then return jsonb_build_object('id',v_a.id,'status','deleted'); end if;
  insert into app_private.work_attachment_cleanup(path,available_at)
   select x.value->>'path',now()+interval '1 minute' from jsonb_each(v_a.variants) x
   on conflict(path) do update set available_at=least(work_attachment_cleanup.available_at,excluded.available_at);
  update public.work_task_attachments set status='deleted',deleted_at=now(),deleted_by=v_actor,processing_token=null,processing_expires_at=null where id=v_a.id;
  perform app_private.work_attachment_event(v_a.id,v_actor,'attachment.deleted');
  return jsonb_build_object('id',v_a.id,'status','deleted');
 end if;
 if v_a.status='ready' then return jsonb_build_object('id',v_a.id,'status','ready'); end if;
 if v_a.status not in ('pending','processing') or v_a.upload_expires_at<=now() or v_a.processing_attempts>=3 then raise exception 'WORK_ATTACHMENT_EXPIRED' using errcode='22023'; end if;
 if v_a.status='processing' and v_a.processing_expires_at>now() then raise exception 'WORK_ATTACHMENT_BUSY'; end if;
 v_token:=gen_random_uuid();
 update public.work_task_attachments set status='processing',processing_token=v_token,processing_expires_at=now()+interval '3 minutes',processing_attempts=processing_attempts+1 where id=v_a.id returning * into v_a;
 v_path:=v_task::text||'/'||v_a.id::text||'/'||v_token::text||'/';
 insert into app_private.work_attachment_cleanup(path,available_at)
 select v_path||x,now()+interval '63 minutes' from unnest(array['thumbnail.webp','display.webp','fallback.png','original']) x;
 return jsonb_build_object('id',v_a.id,'status','processing','token',v_token,'sourcePath',v_a.storage_path,'outputPrefix',v_path,'mimeType',v_a.mime_type,'sizeBytes',v_a.size_bytes,'keepOriginal',v_a.keep_original);
end $$;
revoke all on function app_private.work_command_attachment(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function app_private.work_command_attachment(text,jsonb,uuid) to authenticated;
create function public.command_work_attachment(p_command text,p_payload jsonb,p_idempotency_key uuid)
returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_command_attachment(p_command,p_payload,p_idempotency_key); $$;
revoke all on function public.command_work_attachment(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.command_work_attachment(text,jsonb,uuid) to authenticated;

create function app_private.work_finish_attachment(p_id uuid,p_token uuid,p_variants jsonb,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_a public.work_task_attachments%rowtype; v_task uuid; v_prefix text; v_x record;
begin
 perform app_private.work_require_notification_worker();
 select task_id into v_task from public.work_task_attachments where id=p_id;
 perform 1 from public.work_tasks where id=v_task for update;
 select * into v_a from public.work_task_attachments where id=p_id for update;
 if v_a.id is null or v_a.status<>'processing' or p_token is null or v_a.processing_token is distinct from p_token or v_a.processing_expires_at<=now() then return false; end if;
 if not app_private.work_attachment_can_mutate(v_a.task_id,v_a.uploader_user_id,v_a.attachment_kind) then p_error:='access_revoked'; end if;
 if p_error is not null then
  update public.work_task_attachments set status='rejected',rejection_code=case when p_error in ('invalid_file','access_revoked','processing_failed') then p_error else 'processing_failed' end,processing_token=null,processing_expires_at=null where id=p_id;
  return false;
 end if;
 v_prefix:=v_a.task_id::text||'/'||v_a.id::text||'/'||p_token::text||'/';
 if jsonb_typeof(p_variants) is distinct from 'object' or p_variants-array['thumbnail','display','fallback','original']<>'{}'
  or (v_a.mime_type like 'image/%' and not(p_variants ?& array['thumbnail','display','fallback']))
  or (v_a.keep_original and not(p_variants ? 'original')) or (not v_a.keep_original and p_variants ? 'original')
  or (v_a.mime_type not like 'image/%' and p_variants-array['original']<>'{}') then raise exception 'WORK_INVALID_VARIANTS' using errcode='22023'; end if;
 for v_x in select key,value from jsonb_each(p_variants) loop
  if jsonb_typeof(v_x.value) is distinct from 'object' or v_x.value-array['path','mimeType','sizeBytes','width','height']<>'{}'
   or v_x.value->>'path' is distinct from v_prefix||(case v_x.key when 'thumbnail' then 'thumbnail.webp' when 'display' then 'display.webp' when 'fallback' then 'fallback.png' else 'original' end)
   or v_x.value->>'mimeType' is distinct from (case v_x.key when 'thumbnail' then 'image/webp' when 'display' then 'image/webp' when 'fallback' then 'image/png' else v_a.mime_type end)
   or jsonb_typeof(v_x.value->'sizeBytes') is distinct from 'number' or (v_x.value->>'sizeBytes')::bigint not between 1 and 26214400 then raise exception 'WORK_INVALID_VARIANTS' using errcode='22023'; end if;
 end loop;
 -- Every retained object was registered for cleanup before the worker wrote it.
 delete from app_private.work_attachment_cleanup q where q.path in(select value->>'path' from jsonb_each(p_variants));
 update public.work_task_attachments set status='ready',variants=p_variants,finalized_at=now(),processing_token=null,processing_expires_at=null where id=p_id;
 perform app_private.work_attachment_event(p_id,v_a.uploader_user_id,'attachment.added');
 return true;
end $$;
revoke all on function app_private.work_finish_attachment(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function app_private.work_finish_attachment(uuid,uuid,jsonb,text) to service_role;
create function public.finish_work_attachment(p_id uuid,p_token uuid,p_variants jsonb,p_error text default null)
returns boolean language sql security invoker set search_path='' as $$ select app_private.work_finish_attachment(p_id,p_token,p_variants,p_error); $$;
revoke all on function public.finish_work_attachment(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_work_attachment(uuid,uuid,jsonb,text) to service_role;

create function app_private.work_claim_attachment_cleanup(p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;
begin
 perform app_private.work_require_notification_worker();
 if p_limit is null or p_limit not between 1 and 30 then raise exception 'WORK_INVALID_LIMIT' using errcode='22023'; end if;
 update public.work_task_attachments set status='rejected',rejection_code='expired',processing_token=null,processing_expires_at=null
 where status in ('pending','processing') and upload_expires_at<now() and coalesce(processing_expires_at,upload_expires_at)<now();
 with picked as (select path from app_private.work_attachment_cleanup where available_at<=now() and coalesce(locked_until,'-infinity')<=now() order by available_at,path limit p_limit for update skip locked),
 leased as (update app_private.work_attachment_cleanup q set lease_token=gen_random_uuid(),locked_until=now()+interval '3 minutes',attempts=attempts+1 from picked where q.path=picked.path returning q.path,q.lease_token)
 select coalesce(jsonb_agg(jsonb_build_object('path',path,'token',lease_token)),'[]') into v_rows from leased;
 return v_rows;
end $$;
revoke all on function app_private.work_claim_attachment_cleanup(integer) from public,anon,authenticated;
grant execute on function app_private.work_claim_attachment_cleanup(integer) to service_role;
create function public.claim_work_attachment_cleanup(p_limit integer default 30) returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_claim_attachment_cleanup(p_limit); $$;
revoke all on function public.claim_work_attachment_cleanup(integer) from public,anon,authenticated;
grant execute on function public.claim_work_attachment_cleanup(integer) to service_role;
create function app_private.work_finish_attachment_cleanup(p_path text,p_token uuid,p_success boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform app_private.work_require_notification_worker();
 if p_token is null or p_success is null then return false; end if;
 if p_success then delete from app_private.work_attachment_cleanup where path=p_path and lease_token=p_token;
 else update app_private.work_attachment_cleanup set lease_token=null,locked_until=null,available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer),last_error='storage_delete_failed' where path=p_path and lease_token=p_token; end if;
 return found;
end $$;
revoke all on function app_private.work_finish_attachment_cleanup(text,uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.work_finish_attachment_cleanup(text,uuid,boolean) to service_role;
create function public.finish_work_attachment_cleanup(p_path text,p_token uuid,p_success boolean) returns boolean language sql security invoker set search_path='' as $$ select app_private.work_finish_attachment_cleanup(p_path,p_token,p_success); $$;
revoke all on function public.finish_work_attachment_cleanup(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.finish_work_attachment_cleanup(text,uuid,boolean) to service_role;

create function app_private.work_attachment_cleanup_tick() returns bigint language plpgsql security definer set search_path='' as $$
declare v_secret text; v_request bigint;
begin
 if not exists(select 1 from app_private.work_attachment_cleanup where available_at<=now()) then return null; end if;
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='send_web_push_secret' limit 1;
 if nullif(v_secret,'') is null then raise exception 'WORK_ATTACHMENT_SECRET_MISSING'; end if;
 select net.http_post(url:='https://ftciqmqhmfvjtwoycswe.supabase.co/functions/v1/work-attachments',headers:=jsonb_build_object('Content-Type','application/json','x-web-push-secret',v_secret),body:='{"action":"cleanup"}'::jsonb,timeout_milliseconds:=60000) into v_request;
 return v_request;
end $$;
revoke all on function app_private.work_attachment_cleanup_tick() from public,anon,authenticated;
select cron.schedule('work-attachment-cleanup','*/5 * * * *','select app_private.work_attachment_cleanup_tick();');

-- Authoritative attachment decisions for the upcoming UI.
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
    'canSetPreferences',true,
    'canAttachInput',app_private.work_attachment_can_mutate(t.id,a,'input'),
    'canAttachDiscussion',app_private.work_attachment_can_mutate(t.id,a,'discussion'),
    'canAttachResult',app_private.work_attachment_can_mutate(t.id,a,'result'),
    'canAttachEvidence',app_private.work_attachment_can_mutate(t.id,a,'evidence'));
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
    'attachments',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('can_delete',app_private.work_attachment_can_mutate(t.id,public.current_app_user_id(),f.attachment_kind) and (f.uploader_user_id=public.current_app_user_id() or (app_private.work_task_capabilities(t.id)->>'canCancel')::boolean)) order by f.created_at,f.id) from public.work_task_attachments f where f.task_id=t.id and f.status='ready' and f.deleted_at is null),'[]'),
    'capabilities',app_private.work_task_capabilities(t.id),
    'preferences',jsonb_build_object(
      'pinned',exists(select 1 from public.work_task_pins where task_id=t.id and user_id=public.current_app_user_id()),
      'notificationsEnabled',coalesce((select notifications_enabled from public.work_task_notification_preferences where task_id=t.id and user_id=public.current_app_user_id()),true)));
end $$;

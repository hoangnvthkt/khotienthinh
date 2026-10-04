-- Run only inside scripts/office/cloud-rollback.mjs. All fixtures roll back.
create temporary table office_test_people(name text primary key,id uuid default gen_random_uuid(),email text default ('office-test-'||gen_random_uuid()||'@invalid.local'));
insert into office_test_people(name) values('author'),('approver1'),('approver2'),('clerk'),('recipient'),('outsider'),('technical-admin');
insert into public.users(id,name,username,email,role) select id,'Office rollback '||name,'office-'||id,email,case when name='technical-admin' then 'ADMIN'::public.user_role else 'EMPLOYEE'::public.user_role end from office_test_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
 select id,'office.module.access','global','*','Office rollback acceptance test' from office_test_people where name<>'technical-admin';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
 select id,'office.document.view',case when name in ('author','clerk') then 'global' else 'assigned' end,'*','Office rollback acceptance test' from office_test_people where name<>'technical-admin';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
 select p.id,'office.document.'||a,case when a='approve' then 'assigned' else 'global' end,'*','Office rollback acceptance test'
 from office_test_people p cross join unnest(case when name='author' then array['create','edit','submit','archive','assign'] when name in ('approver1','approver2') then array['approve'] when name='clerk' then array['issue_number','publish','revoke','view_restricted'] when name='recipient' then array['process'] else '{}'::text[] end) a;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
 select id,'office.configuration.manage','global','*','Office rollback acceptance test' from office_test_people where name='author';
create temporary table office_test_data(key text primary key,value jsonb);
insert into office_test_data select 'site-'||row_number() over(order by id),to_jsonb(id) from (select id from public.hrm_construction_sites order by id limit 2) sites;
grant all on office_test_people,office_test_data to authenticated;
create function pg_temp.office_as(p_name text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',(select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text from office_test_people where name=p_name),true);
end $$;
create function pg_temp.office_assert(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'Office test failed: %',message; end if; end $$;
create function pg_temp.office_do(p_key text,p_command text,p_payload jsonb default '{}') returns jsonb language plpgsql as $$
declare doc jsonb; r jsonb; begin
 select value into strict doc from office_test_data where key=p_key;
 r:=public.office_command(p_command,(doc->>'id')::uuid,p_payload,(doc->>'version')::bigint,gen_random_uuid());
 update office_test_data set value=r where key=p_key; return r;
end $$;
set local role authenticated;
select pg_temp.office_as('technical-admin');
do $$ begin
 begin perform public.office_query('catalog'); raise exception 'Unexpected technical-admin access'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.office_as('author');
do $$ declare wf uuid; t uuid; d jsonb; r jsonb; k uuid:=gen_random_uuid(); payload jsonb; begin
 wf:=public.office_configure('workflow',null,jsonb_build_object('name','Office rollback two steps','steps',jsonb_build_array(
 jsonb_build_object('label','Trưởng phòng','userId',(select id from office_test_people where name='approver1')),
 jsonb_build_object('label','Tổng giám đốc','userId',(select id from office_test_people where name='approver2')))));
 select id into strict t from public.office_document_types where code='TB';
 payload:=jsonb_build_object('document_group','ANNOUNCEMENT','document_type_id',t,'title','Office acceptance nghỉ lễ','confidentiality','CONFIDENTIAL','workflow_id',wf,'archive_folder_id',(select id from public.office_archive_folders where name='Hành chính Nhân sự'),
 'recipient_specs',jsonb_build_array(jsonb_build_object('type','user','id',(select id from office_test_people where name='recipient'))),
 'content','{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Nội dung nghỉ lễ"}]}]}'::jsonb);
 d:=public.office_command('create',null,payload,null,k); insert into office_test_data values('notice',d),('payload',payload),('workflow',to_jsonb(wf));
 r:=public.office_command('create',null,payload,null,k); perform pg_temp.office_assert(r=d,'retry must return same document');
 perform pg_temp.office_assert((public.office_query('catalog')->>'canCreate')::boolean,'catalog create capability');
 perform pg_temp.office_assert((public.office_query('list','{"search":"nghỉ lễ"}') ->>'total')::int=1,'search title');
 begin perform pg_temp.office_do('notice','publish'); raise exception 'Unexpected publish draft'; exception when insufficient_privilege then null; end;
 perform pg_temp.office_do('notice','submit');
end $$;
select pg_temp.office_as('approver2');
do $$ begin
 begin perform pg_temp.office_do('notice','approve'); raise exception 'Unexpected out-of-order approval'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.office_as('clerk');
do $$ begin
 begin perform pg_temp.office_do('notice','issue_number'); raise exception 'Unexpected early number'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.office_as('approver1');
select pg_temp.office_do('notice','approve');
select pg_temp.office_as('approver2');
select pg_temp.office_do('notice','approve');
do $$ begin
 begin perform pg_temp.office_do('notice','issue_number'); raise exception 'Approver must not number'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.office_as('clerk');
select pg_temp.office_do('notice','issue_number');
select pg_temp.office_do('notice','publish');
select pg_temp.office_as('author');
do $$ declare detail jsonb; begin
 detail:=public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='notice')));
 perform pg_temp.office_assert((detail->'recipientStats'->>'total')::int=1,'one resolved recipient');
 perform pg_temp.office_assert((detail->'recipientStats'->>'read')::int=0,'publication and detail do not fabricate read receipts');
 begin perform pg_temp.office_do('notice','save','{"title":"tampered"}'); raise exception 'Unexpected edit issued'; exception when insufficient_privilege then null; end;
 begin update public.office_documents set title='tampered'; raise exception 'Unexpected direct update'; exception when insufficient_privilege then null; end;
 begin delete from public.office_documents; raise exception 'Unexpected direct delete'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.office_as('outsider');
do $$ declare n int; begin
 select count(*) into n from public.office_documents;
 perform pg_temp.office_assert(n=0,'RLS denies confidential document to outsider');
 begin perform public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='notice'))); raise exception 'Unexpected RPC disclosure'; exception when insufficient_privilege then null; end;
 begin perform pg_temp.office_do('notice','bookmark','{"following":true}'); raise exception 'Unexpected bookmark escalation'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.office_as('recipient');
do $$ declare d jsonb; begin
 d:=public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='notice')));
 perform pg_temp.office_assert(d->'document'->>'title'='Office acceptance nghỉ lễ','recipient detail');
 perform pg_temp.office_assert((public.office_query('dashboard')->>'unread')::int=1,'unread before opened-read command');
 perform pg_temp.office_do('notice','read'); perform pg_temp.office_do('notice','read');
 perform pg_temp.office_assert((public.office_query('dashboard')->>'unread')::int=0,'read only on explicit open');
 perform pg_temp.office_do('notice','bookmark','{"favorite":true,"following":true}');
 perform pg_temp.office_assert((public.office_query('list','{"view":"favorites"}')->>'total')::int=1,'favorites view');
end $$;
select pg_temp.office_as('author');
select pg_temp.office_do('notice','archive');
do $$ begin
 perform pg_temp.office_assert((public.office_query('list','{"view":"archive"}')->>'total')::int=1,'archive remains searchable');
 perform pg_temp.office_assert((public.office_query('list',jsonb_build_object('folderId',(select id from public.office_archive_folders where parent_id is null)))->>'total')::int=1,'parent archive folder includes descendants');
end $$;
reset role;
do $$ begin
 perform pg_temp.office_assert((select count(*) from public.notifications where source_type='office_document' and metadata->>'event'='DOCUMENT_ISSUED')=1,'existing notification delivery');
 perform pg_temp.office_assert((select count(*) from public.audit_trail where table_name='office_documents' and description='NUMBER_ISSUED')=1,'number audit persisted in transaction');
end $$;
select 'PASS: create/retry/search/ordered approvals/separate numbering/publish/receipts/favorite/archive/notifications/audit/RLS/direct-write denial' result;

set local role authenticated;
select pg_temp.office_as('author');
do $$ declare payload jsonb; r jsonb; f jsonb; incoming jsonb; n uuid; begin
 select value into payload from office_test_data where key='payload';
 payload:=payload||jsonb_build_object('document_group','OUTGOING','document_type_id',(select id from public.office_document_types where code='CV'),'title','Công văn gửi RICO','external_recipient','Chủ đầu tư RICO');
 r:=public.office_command('create',null,payload,null,gen_random_uuid());insert into office_test_data values('outgoing',r);
 -- Conflict rejects overwriting another edit.
 begin perform public.office_command('save',(r->>'id')::uuid,'{"title":"stale"}',0,gen_random_uuid());raise exception 'Unexpected stale save';exception when raise_exception then if sqlerrm<>'OFFICE_VERSION_CONFLICT' then raise;end if;end;
 perform pg_temp.office_do('outgoing','submit');
 incoming:=payload||jsonb_build_object('document_group','INCOMING','title','Công văn đến RICO','source_organization','Chủ đầu tư RICO','source_document_number','RICO/42','received_date',current_date,'workflow_id',null);
 r:=public.office_command('create',null,incoming,null,gen_random_uuid());insert into office_test_data values('incoming',r);
 begin perform pg_temp.office_do('incoming','submit');raise exception 'Unexpected incoming without original';exception when raise_exception then if sqlerrm<>'OFFICE_INCOMING_REQUIRED' then raise;end if;end;
 f:=pg_temp.office_do('incoming','attachment_begin','{"fileName":"cong-van.pdf","mimeType":"application/pdf","size":10}');
 perform pg_temp.office_assert(f->'attachment'->>'id' is not null,'upload reservation returns separate attachment ID');
 insert into office_test_data values('file',f->'attachment');
 -- Simulate the Storage service metadata; the object exists only within rollback.
 insert into storage.objects(bucket_id,name,metadata) values(f->'attachment'->>'bucket',f->'attachment'->>'path','{"size":10,"mimetype":"application/pdf"}');
 perform pg_temp.office_do('incoming','attachment_finish',jsonb_build_object('attachmentId',f->'attachment'->>'id'));
 perform pg_temp.office_do('incoming','submit');
end $$;
select pg_temp.office_as('approver1');
select pg_temp.office_do('outgoing','approve');
select pg_temp.office_as('approver2');
select pg_temp.office_do('outgoing','approve');
select pg_temp.office_as('clerk');
select pg_temp.office_do('outgoing','issue_number');
select pg_temp.office_do('outgoing','publish');
select pg_temp.office_do('incoming','publish');
select pg_temp.office_as('author');
select pg_temp.office_do('incoming','assign',jsonb_build_object('userId',(select id from office_test_people where name='recipient'),'dueDate',current_date+2,'instruction','Kiểm tra và phản hồi công văn'));
select pg_temp.office_as('outsider');
do $$ begin
 perform pg_temp.office_assert(not exists(select 1 from storage.objects where bucket_id='office-attachments'),'storage RLS denies outsider');
end $$;
select pg_temp.office_as('recipient');
do $$ begin
 perform pg_temp.office_assert(exists(select 1 from storage.objects where bucket_id='office-attachments'),'recipient can read original file');
 begin perform pg_temp.office_do('incoming','complete','{"result":"Bỏ qua tiếp nhận"}');raise exception 'Unexpected complete before started';exception when raise_exception then if sqlerrm<>'OFFICE_RESULT_REQUIRED' then raise;end if;end;
 perform pg_temp.office_do('incoming','acknowledge');perform pg_temp.office_do('incoming','start');perform pg_temp.office_do('incoming','complete','{"result":"Đã xử lý và phản hồi chủ đầu tư"}');
 perform pg_temp.office_assert(public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='incoming')))->'document'->>'processing_status'='COMPLETED','incoming completion');
end $$;
select pg_temp.office_as('clerk');
select pg_temp.office_do('outgoing','revoke','{"reason":"Phát hành văn bản thay thế"}');
reset role;
do $$ declare target public.office_documents; begin
 select * into target from public.office_documents where id=(select (value->>'id')::uuid from office_test_data where key='outgoing');
 perform pg_temp.office_assert(target.document_number is not null,'revocation retains number');
 perform pg_temp.office_assert(exists(select 1 from public.notifications where source_id=target.id::text and metadata->>'event'='DOCUMENT_REVOKED'),'revocation notification');
 begin update public.office_documents set title='silent edit' where id=target.id;raise exception 'Unexpected privileged edit';exception when raise_exception then if sqlerrm<>'OFFICE_OFFICIAL_IMMUTABLE' then raise;end if;end;
end $$;
select 'PASS: outgoing, incoming attachment/storage ACL/assignment/ack/start/complete, revocation, immutable trigger, stale edit' result;

set local role authenticated;
select pg_temp.office_as('author');
select pg_temp.office_do('outgoing','archive');
select pg_temp.office_as('recipient');
do $$ declare detail jsonb; begin
 detail:=public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='outgoing')));
 perform pg_temp.office_assert(detail->'document'->>'status'='ARCHIVED' and detail->'document'->>'revoked_at' is not null,'archive preserves revocation');
 perform pg_temp.office_assert(not (detail->'capabilities'->>'read')::boolean,'revoked archive has no read action');
 begin perform pg_temp.office_do('outgoing','read');raise exception 'Unexpected revoked read';exception when raise_exception then if sqlerrm<>'OFFICE_NOT_ISSUED' then raise;end if;end;
 perform pg_temp.office_assert(not exists(select 1 from jsonb_array_elements(public.office_query('list','{"view":"unread"}')->'items') d where d->>'id'=detail->'document'->>'id'),'revoked archive excluded from unread');
end $$;
select pg_temp.office_as('author');
do $$ declare payload jsonb; r jsonb; begin
 select value||'{"title":"Quy định nội bộ vòng hai","document_group":"INTERNAL"}'::jsonb||jsonb_build_object('construction_site_id',(select value from office_test_data where key='site-2')) into payload from office_test_data where key='payload';
 r:=public.office_command('create',null,payload,null,gen_random_uuid());insert into office_test_data values('internal',r);
 perform pg_temp.office_do('internal','submit');
end $$;
select pg_temp.office_as('approver1');
do $$ begin
 begin perform pg_temp.office_do('internal','return');raise exception 'Unexpected return without reason';exception when raise_exception then if sqlerrm<>'OFFICE_REASON_REQUIRED' then raise;end if;end;
 perform pg_temp.office_do('internal','return','{"reason":"Bổ sung thời hạn thực hiện"}');
end $$;
select pg_temp.office_as('author');
do $$ declare file jsonb; begin
 perform pg_temp.office_do('internal','save','{"summary":"Hoàn tất trước ngày 10/10"}');
 file:=pg_temp.office_do('internal','attachment_begin','{"fileName":"remove-me.pdf","mimeType":"application/pdf","size":10}')->'attachment';
 insert into storage.objects(bucket_id,name,metadata) values(file->>'bucket',file->>'path','{"size":10,"mimetype":"application/pdf"}');
 perform pg_temp.office_do('internal','attachment_finish',jsonb_build_object('attachmentId',file->>'id'));
 perform pg_temp.office_do('internal','attachment_remove',jsonb_build_object('attachmentId',file->>'id'));
 -- Simulate Storage API cleanup of this transaction-only metadata row.
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where bucket_id=file->>'bucket' and name=file->>'path';
 perform pg_temp.office_assert(found,'removed draft attachment permits storage cleanup');
 perform set_config('storage.allow_delete_query','false',true);
 perform pg_temp.office_do('internal','submit');
 perform pg_temp.office_assert(public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='internal')))->'document'->>'approval_round'='2','resubmission starts fresh approval round');
end $$;
select pg_temp.office_as('approver1');
select pg_temp.office_do('internal','approve');
select pg_temp.office_as('approver2');
select pg_temp.office_do('internal','approve');
select pg_temp.office_as('clerk');
do $$ declare d jsonb; r jsonb; retry jsonb; k uuid:=gen_random_uuid(); begin
 select value into d from office_test_data where key='internal';
 r:=public.office_command('issue_number',(d->>'id')::uuid,'{}',(d->>'version')::bigint,k);
 retry:=public.office_command('issue_number',(d->>'id')::uuid,'{}',(d->>'version')::bigint,k);
 perform pg_temp.office_assert(r=retry,'number retry is idempotent after version advanced');
 update office_test_data set value=r where key='internal';
 perform pg_temp.office_assert((select sequence_number from public.office_documents where id=(r->>'id')::uuid)=2,'same type and year uses next number, no retry increment');
 perform pg_temp.office_do('internal','publish');
end $$;
reset role;
do $$ begin
 perform pg_temp.office_assert((select count(distinct document_number) from public.office_documents where document_number is not null)=3,'number uniqueness across internal/announcement/outgoing');
 perform pg_temp.office_assert((select count(*) from public.office_document_approvals where document_id=(select (value->>'id')::uuid from office_test_data where key='internal') and round=1 and status in ('RETURNED','CANCELLED'))=2,'previous approval round preserved');
end $$;
select 'PASS: revoked archive, internal return/edit/resubmit, attachment cleanup, same-series numbering and number retry' result;

insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select p.id,code,'construction_site',s.value#>>'{}','Office rollback site isolation test'
from office_test_people p cross join office_test_data s cross join unnest(array['office.document.view','office.document.view_restricted']) code
where p.name='outsider' and s.key='site-1';
set local role authenticated;
select pg_temp.office_as('outsider');
do $$ begin
 perform pg_temp.office_assert(not exists(select 1 from public.office_documents where id=(select (value->>'id')::uuid from office_test_data where key='internal')),'site A cannot SELECT confidential site B');
 begin perform public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='internal')));raise exception 'Unexpected cross-site detail';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select p.id,'office.document.view','construction_site',s.value#>>'{}','Office rollback site isolation test'
from office_test_people p cross join office_test_data s where p.name='outsider' and s.key='site-2';
set local role authenticated;
select pg_temp.office_as('outsider');
do $$ begin
 perform pg_temp.office_assert(not exists(select 1 from public.office_documents where id=(select (value->>'id')::uuid from office_test_data where key='internal')),'ordinary site B view does not expose confidential document');
end $$;
reset role;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select p.id,'office.document.view_restricted','construction_site',s.value#>>'{}','Office rollback site isolation test'
from office_test_people p cross join office_test_data s where p.name='outsider' and s.key='site-2';
set local role authenticated;
select pg_temp.office_as('outsider');
do $$ begin
 perform pg_temp.office_assert(exists(select 1 from public.office_documents where id=(select (value->>'id')::uuid from office_test_data where key='internal')),'explicit restricted site B scope permits access');
end $$;
reset role;
select 'PASS: all Office P0 assertions, including cross-site confidential RLS/RPC isolation' result;

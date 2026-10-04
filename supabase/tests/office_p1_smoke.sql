-- Runs AFTER office_p0_smoke.sql, in the same rollback transaction.
set local role authenticated;
select pg_temp.office_as('author');
do $$ declare tid uuid; typ uuid; payload jsonb; doc jsonb; begin
 perform pg_temp.office_assert(jsonb_typeof(public.office_query('templates'))='array','template catalog query');
 payload:=jsonb_build_object('name','Mẫu kiểm thử P1','document_group','ANNOUNCEMENT','content','{"version":1,"type":"doc","content":[{"type":"paragraph","align":"center","content":[{"type":"text","text":"Số {{document_number}}","marks":[{"type":"color","attrs":{"value":"#115e59"}},{"type":"fontSize","attrs":{"value":"18"}}]}]},{"type":"table","content":[{"type":"table_row","content":[{"type":"table_cell","content":[{"type":"text","text":"Nội dung"}]}]}]}]}'::jsonb);
 tid:=public.office_configure('template',null,payload);
 perform public.office_configure('template',tid,payload||'{"version":1,"name":"Mẫu kiểm thử đã sửa"}');
 begin perform public.office_configure('template',tid,payload||'{"version":1}');raise exception 'Unexpected stale template update';exception when raise_exception then if sqlerrm<>'OFFICE_VERSION_CONFLICT' then raise;end if;end;
 perform pg_temp.office_assert(jsonb_array_length(public.office_query('template_versions',jsonb_build_object('id',tid)))=2,'immutable template history');
 typ:=public.office_configure('type',null,jsonb_build_object('code','P1QA','name','Office P1 test','groups',array['ANNOUNCEMENT'],'requires_approval',false,'requires_number',true,'numbering_rule_id',(select id from public.office_numbering_rules limit 1)));
 insert into office_test_data values('p1-type',to_jsonb(typ));
 doc:=public.office_command('create',null,jsonb_build_object('document_group','ANNOUNCEMENT','document_type_id',typ,'title','P1 xác nhận','confidentiality','CONFIDENTIAL','require_acknowledgement',true,'recipient_specs',jsonb_build_array(jsonb_build_object('type','user','id',(select id from office_test_people where name='recipient'))),'content',payload->'content'),null,gen_random_uuid());
 insert into office_test_data values('p1-doc',doc);
 perform pg_temp.office_do('p1-doc','submit');
end $$;
select pg_temp.office_as('clerk');
select pg_temp.office_do('p1-doc','issue_number');
select pg_temp.office_do('p1-doc','publish');
select pg_temp.office_as('recipient');
do $$ declare detail jsonb; before_version bigint; receipt_key uuid:=gen_random_uuid(); docid uuid:=(select (value->>'id')::uuid from office_test_data where key='p1-doc'); begin
 detail:=public.office_query('detail',jsonb_build_object('id',docid));before_version:=(detail->'document'->>'version')::bigint;
 perform pg_temp.office_assert(detail->'document'->'content' is not null,'rich content readable');
 perform pg_temp.office_assert(position('{{document_number}}' in (detail->'document'->'content')::text)=0,'backend fills number before issuance');
 perform public.office_command('read',docid,'{}',null,gen_random_uuid());
 detail:=public.office_query('detail',jsonb_build_object('id',docid));
 perform pg_temp.office_assert(detail->'receipt'->>'acknowledged_at' is null,'view does not imply acknowledgement');
 perform public.office_command('confirm_read',docid,'{}',null,receipt_key);
 perform public.office_command('confirm_read',docid,'{}',null,receipt_key);
 detail:=public.office_query('detail',jsonb_build_object('id',docid));
 perform pg_temp.office_assert(detail->'receipt'->>'acknowledged_at' is not null,'explicit acknowledgement persisted');
 perform pg_temp.office_assert((detail->'document'->>'version')::bigint=before_version,'receipt does not create official content version');
 begin perform public.office_query('versions',jsonb_build_object('id',docid));raise exception 'Unexpected recipient version access';exception when insufficient_privilege then null;end;
end $$;
select pg_temp.office_as('outsider');
do $$ begin
 begin perform public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='p1-doc')));raise exception 'Unexpected outsider access';exception when insufficient_privilege then null;end;
 begin perform public.office_configure('template',null,'{}');raise exception 'Unexpected template configuration';exception when insufficient_privilege then null;end;
end $$;
select pg_temp.office_as('clerk');
select pg_temp.office_do('p1-doc','add_recipients',jsonb_build_object('specs',jsonb_build_array(jsonb_build_object('type','user','id',(select id from office_test_people where name='outsider')))));
select pg_temp.office_do('p1-doc','add_recipients',jsonb_build_object('specs',jsonb_build_array(jsonb_build_object('type','user','id',(select id from office_test_people where name='outsider')))));
select pg_temp.office_as('outsider');
do $$ begin
 perform pg_temp.office_assert((public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='p1-doc')))->'document'->>'title')='P1 xác nhận','late recipient gains access');
end $$;
reset role;
do $$ declare docid uuid:=(select (value->>'id')::uuid from office_test_data where key='p1-doc'); begin
 perform pg_temp.office_assert((select count(*) from public.notifications where source_id=docid::text and user_id=(select id::text from office_test_people where name='outsider') and metadata->>'event'='DOCUMENT_ISSUED')=1,'late recipient gets exactly one push notification, no duplicate on repeated tags');
 perform pg_temp.office_assert(not exists(select 1 from public.notifications where source_id=docid::text and user_id=(select id::text from office_test_people where name='technical-admin')),'no push to unrelated technical admin');
 perform pg_temp.office_assert(not exists(select 1 from public.notifications where source_id=docid::text and (not push_enabled or link<>'/office/documents/'||docid)),'push deeplink points to exact document');
 perform pg_temp.office_assert((select count(*) from public.audit_trail where record_id=docid::text and description='READ_CONFIRMED')=1,'ack idempotency prevents duplicate audit');
end $$;
set local role authenticated;
select pg_temp.office_as('author');
do $$ declare doc jsonb; id uuid; v jsonb; payload jsonb; begin
 payload:=(select value from office_test_data where key='payload')||jsonb_build_object('document_type_id',(select value from office_test_data where key='p1-type'),'title','P1 linked draft','workflow_id',null,'content','{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Draft"}]}]}'::jsonb);
 doc:=public.office_command('create',null,payload,null,gen_random_uuid());insert into office_test_data values('p1-linked',doc);
 perform pg_temp.office_do('p1-linked','link_add',jsonb_build_object('targetType','document','targetId',(select value->>'id' from office_test_data where key='p1-doc'),'relation','replaces'));
 id:=(doc->>'id')::uuid;
 perform pg_temp.office_assert(jsonb_array_length(public.office_query('links',jsonb_build_object('id',id)))=1,'authorized related document appears');
 perform pg_temp.office_assert(jsonb_array_length(public.office_query('versions',jsonb_build_object('id',id)))=2,'command versions preserved');
 v:=public.office_query('version',jsonb_build_object('id',id,'version',1));
 perform pg_temp.office_assert(v->'snapshot'->>'title'='P1 linked draft','version detail has original content');
 perform pg_temp.office_do('p1-linked','cancel','{"reason":"Hủy nháp thử nghiệm"}');
 perform pg_temp.office_assert(public.office_query('detail',jsonb_build_object('id',id))->'document'->>'status'='CANCELLED','cancel state visible');
 perform pg_temp.office_assert((public.office_query('export','{"search":"P1"}')->>'total')::int=2,'filtered export complete snapshot');
 perform pg_temp.office_assert((public.office_query('report','{"search":"P1"}')->>'total')::int=2,'report honors filters');
 doc:=public.office_command('create',null,payload||jsonb_build_object('title','P1 invalid rich text','content','{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"{{company_name}}"}]}]}'::jsonb),null,gen_random_uuid());
 insert into office_test_data values('p1-invalid',doc);
 begin perform pg_temp.office_do('p1-invalid','submit');raise exception 'Unexpected unresolved template accepted';exception when raise_exception then if sqlerrm<>'OFFICE_TEMPLATE_UNFILLED' then raise;end if;end;
 begin perform pg_temp.office_do('p1-invalid','save','{"content":{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"bad","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}}');raise exception 'Unexpected unsafe content accepted';exception when raise_exception then if sqlerrm<>'OFFICE_INVALID_CONTENT' then raise;end if;end;
end $$;
select pg_temp.office_as('recipient');
do $$ begin
 perform pg_temp.office_assert(jsonb_array_length(public.office_query('links',jsonb_build_object('id',(select value->>'id' from office_test_data where key='p1-doc'))))=0,'reverse links cannot disclose hidden drafts');
end $$;
reset role;
select 'PASS: Office P1 templates, history, rich text validation, acknowledgement, late recipients, push deduplication, links and filtered reporting/export' result;

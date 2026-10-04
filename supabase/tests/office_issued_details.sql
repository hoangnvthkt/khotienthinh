-- Runs after P0/P1/extended, in the same rollback-only transaction.
set local role authenticated;
select pg_temp.office_as('author');
do $$ declare tid uuid; r jsonb; f jsonb; begin
 tid:=public.office_configure('type',null,'{"code":"QAVIEW","name":"Office test attachments","groups":["ANNOUNCEMENT"],"requires_approval":false,"requires_number":false}');
 r:=public.office_command('create',null,jsonb_build_object('document_group','ANNOUNCEMENT','document_type_id',tid,'title','Office receipt QA','effective_on',current_date+1,'expires_on',current_date+3,'content','{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"test"}]}]}'::jsonb,'recipient_specs',jsonb_build_array(jsonb_build_object('type','user','id',(select p.id from office_test_people p where name='recipient')))),null,gen_random_uuid());
 insert into office_test_data values('receipt-doc',r);
 f:=pg_temp.office_do('receipt-doc','attachment_begin','{"fileName":"qa.pdf","mimeType":"application/pdf","size":10}')->'attachment';
 insert into office_test_data values('receipt-file',f);
 insert into storage.objects(bucket_id,name,metadata) values(f->>'bucket',f->>'path','{"size":10,"mimetype":"application/pdf"}');
 perform pg_temp.office_do('receipt-doc','attachment_finish',jsonb_build_object('attachmentId',f->>'id'));
 begin
  perform pg_temp.office_do('receipt-doc','save',jsonb_build_object('effective_on',current_date+5));
  raise exception 'Expected invalid effective date';
 exception when raise_exception then if sqlerrm<>'OFFICE_INVALID_EXPIRY' then raise; end if; end;
 perform pg_temp.office_do('receipt-doc','submit');
end $$;
select pg_temp.office_as('clerk');
select pg_temp.office_do('receipt-doc','publish');
do $$ declare d jsonb; begin
 d:=public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='receipt-doc')));
 perform pg_temp.office_assert(d->>'issuedByName'='Office rollback clerk','publisher is actual publishing actor');
 perform pg_temp.office_assert((d->'document'->>'effective_on')::date=current_date+1,'explicit effective date retained');
 perform pg_temp.office_assert(d->'peoplePreview'->'downloads'->>'total'='0','preview does not fabricate downloads');
 perform pg_temp.office_do('receipt-doc','add_watchers',jsonb_build_object('userIds',jsonb_build_array((select p.id from office_test_people p where name='outsider'))));
end $$;
select pg_temp.office_as('outsider');
do $$ declare id uuid; begin
 id:=(select (value->>'id')::uuid from office_test_data where key='receipt-doc');
 perform pg_temp.office_assert(public.office_query('detail',jsonb_build_object('id',id))->'document'->>'title'='Office receipt QA','tagged watcher can view within assigned scope');
 begin perform public.office_query('people',jsonb_build_object('id',id,'kind','downloads')); raise exception 'Expected tracking denial'; exception when insufficient_privilege then null; end;
 begin perform pg_temp.office_do('receipt-doc','add_watchers',jsonb_build_object('userIds',jsonb_build_array((select p.id from office_test_people p where name='technical-admin')))); raise exception 'Expected watcher administration denial'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.office_as('recipient');
do $$ declare id uuid; f uuid; r jsonb; begin
 id:=(select (value->>'id')::uuid from office_test_data where key='receipt-doc'); f:=(select (value->>'id')::uuid from office_test_data where key='receipt-file');
 r:=public.office_query('detail',jsonb_build_object('id',id));
 perform pg_temp.office_assert(r->'peoplePreview'='null'::jsonb,'recipient cannot see tracking summaries');
 perform pg_temp.office_do('receipt-doc','read');
 perform public.office_command('download',id,jsonb_build_object('attachmentId',f),null,gen_random_uuid());
 perform public.office_command('download',id,jsonb_build_object('attachmentId',f),null,gen_random_uuid());
 begin perform public.office_command('download',id,jsonb_build_object('attachmentId',gen_random_uuid()),null,gen_random_uuid()); raise exception 'Expected invalid attachment denial'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.office_as('clerk');
do $$ declare id uuid; d jsonb; begin
 id:=(select (value->>'id')::uuid from office_test_data where key='receipt-doc');
 d:=public.office_query('detail',jsonb_build_object('id',id));
 perform pg_temp.office_assert(d->'peoplePreview'->'downloads'->>'total'='1','repeat downloads count one person');
 perform pg_temp.office_assert(d->'peoplePreview'->'viewers'->>'total'='1','opened document read receipt');
 perform pg_temp.office_assert(d->'peoplePreview'->'followers'->>'total'='1','tagged follower summary');
 perform pg_temp.office_assert(public.office_query('people',jsonb_build_object('id',id,'kind','downloads'))->'items'->0->>'name'='Office rollback recipient','download list has exact user');
end $$;
reset role;
do $$ begin
 begin update public.office_documents set effective_on=current_date where id=(select (value->>'id')::uuid from office_test_data where key='receipt-doc'); raise exception 'Expected immutable date'; exception when raise_exception then if sqlerrm<>'OFFICE_OFFICIAL_IMMUTABLE' then raise; end if; end;
 perform pg_temp.office_assert((select count(*) from public.notifications where source_id=(select value->>'id' from office_test_data where key='receipt-doc') and metadata->>'event'='DOCUMENT_ISSUED')=1,'publication notifies exact recipient once');
 perform pg_temp.office_assert(exists(select 1 from public.notifications where source_id=(select value->>'id' from office_test_data where key='receipt-doc') and metadata->>'event'='DOCUMENT_WATCHERS_ADDED' and user_id=(select id::text from office_test_people where name='outsider')),'tagged watcher receives update');
end $$;
select 'PASS: issued metadata, effective date lock, watcher access, private tracking and download receipts' result;

-- Additional user requirements; synthetic memberships and all data roll back.
reset role;
create temporary table office_extra_ids(key text primary key,id uuid);
insert into public.org_units(name,code,type) values('Office QA phòng thử','OFFICE-QA-'||gen_random_uuid(),'department') returning id;
insert into office_extra_ids select 'unit',id from public.org_units where code like 'OFFICE-QA-%' order by created_at desc limit 1;
insert into public.employees(full_name,user_id) select 'Office QA nhân sự',(select id from office_test_people where name='recipient') returning id;
insert into office_extra_ids select 'employee',id from public.employees where user_id=(select id from office_test_people where name='recipient');
insert into public.hrm_org_position_slots(code,org_unit_id,position_id)
 select 'OFFICE-QA-'||gen_random_uuid(),(select id from office_extra_ids where key='unit'),id from public.hrm_positions limit 1;
insert into office_extra_ids select 'slot',id from public.hrm_org_position_slots where org_unit_id=(select id from office_extra_ids where key='unit');
insert into public.hrm_employee_slot_assignments(employee_id,slot_id)
 values((select id from office_extra_ids where key='employee'),(select id from office_extra_ids where key='slot'));
insert into public.project_staff(construction_site_id,user_id,position_id)
 select (select value#>>'{}' from office_test_data where key='site-1'),(select id::text from office_test_people where name='recipient'),id from public.hrm_positions limit 1;
do $$ declare unit_id uuid; employee_id uuid; slot_id uuid; begin
 insert into public.org_units(name,code,type) values('Office QA phòng nhận thêm','OFFICE-QA-'||gen_random_uuid(),'department') returning id into unit_id;
 insert into public.employees(full_name,user_id) select 'Office QA nhân sự nhận thêm',id from office_test_people where name='outsider' returning id into employee_id;
 insert into public.hrm_org_position_slots(code,org_unit_id,position_id) select 'OFFICE-QA-'||gen_random_uuid(),unit_id,id from public.hrm_positions limit 1 returning id into slot_id;
 insert into public.hrm_employee_slot_assignments(employee_id,slot_id) values(employee_id,slot_id);
 insert into office_extra_ids values('second-unit',unit_id);
end $$;
grant select on office_extra_ids to authenticated;
set local role authenticated;
select pg_temp.office_as('author');
do $$ declare audience jsonb; x jsonb; payload jsonb; begin
 audience:=public.office_query('audience',jsonb_build_object('specs',jsonb_build_array(jsonb_build_object('type','department','id',(select id from office_extra_ids where key='unit')),jsonb_build_object('type','site','id',(select value#>>'{}' from office_test_data where key='site-1')))));
 perform pg_temp.office_assert((audience->>'total')::int>=1,'department/site audience includes active memberships');
 payload:=(select value from office_test_data where key='payload')||jsonb_build_object('title','Expired test','document_date',current_date-2,'expires_on',current_date-1,'workflow_id',null,'document_type_id',(select value from office_test_data where key='p1-type'));
 x:=public.office_command('create',null,payload,null,gen_random_uuid());insert into office_test_data values('expired',x);
 perform pg_temp.office_do('expired','submit');
 perform public.office_ai_begin('draft',null);
 for i in 1..9 loop perform public.office_ai_begin('search',null);end loop;
 begin perform public.office_ai_begin('draft',null);raise exception 'Unexpected AI rate bypass';exception when raise_exception then if sqlerrm<>'OFFICE_AI_RATE_LIMIT' then raise;end if;end;
end $$;
select pg_temp.office_as('clerk');
select pg_temp.office_do('expired','issue_number');
do $$ begin
 begin perform pg_temp.office_do('expired','publish');raise exception 'Unexpected publish expired';exception when raise_exception then if sqlerrm<>'OFFICE_EXPIRED' then raise;end if;end;
end $$;
reset role;
-- Set a synthetic already-issued fixture to past expiry; no real document is altered.
insert into public.office_documents(document_group,document_type_id,title,content,created_by,updated_by,creator_name,status,issued_at,document_date,expires_on)
 select 'ANNOUNCEMENT',(value#>>'{}')::uuid,'Expired issued fixture','{"version":1,"type":"doc","content":[]}',p.id,p.id,'Office QA','ISSUED',now()-interval '2 days',current_date-2,current_date-1 from office_test_data cross join office_test_people p where key='p1-type' and p.name='author';
set local role authenticated;
select pg_temp.office_as('author');
do $$ declare item jsonb; begin
 item:=public.office_query('list','{"status":"EXPIRED"}');
 perform pg_temp.office_assert((item->>'total')::int=1,'expiry computed without delayed cron');
 perform pg_temp.office_assert(item->'items'->0->>'status'='EXPIRED','expiry label and filter consistent');
end $$;
select pg_temp.office_as('author');
do $$ declare payload jsonb; x jsonb; begin
 payload:=(select value from office_test_data where key='payload')||jsonb_build_object('title','Gửi riêng phòng ban','document_type_id',(select value from office_test_data where key='p1-type'),'workflow_id',null,'issuer_department_id',(select id from office_extra_ids where key='unit'),'recipient_specs',jsonb_build_array(jsonb_build_object('type','department','id',(select id from office_extra_ids where key='unit'))));
 x:=public.office_command('create',null,payload,null,gen_random_uuid());insert into office_test_data values('department-only',x);
 perform pg_temp.office_do('department-only','submit');
end $$;
select pg_temp.office_as('clerk');
select pg_temp.office_do('department-only','issue_number');
select pg_temp.office_do('department-only','publish');
select pg_temp.office_as('recipient');
do $$ begin
 perform pg_temp.office_assert(public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='department-only')))->'document'->>'title'='Gửi riêng phòng ban','member can open document sent only to department');
end $$;
select pg_temp.office_as('outsider');
do $$ begin
 begin perform public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='department-only')));raise exception 'Unexpected access by another department';exception when insufficient_privilege then null;end;
end $$;
select pg_temp.office_as('clerk');
select pg_temp.office_do('department-only','add_recipients',jsonb_build_object('specs',jsonb_build_array(jsonb_build_object('type','department','id',(select id from office_extra_ids where key='second-unit')))));
select pg_temp.office_as('outsider');
do $$ begin
 perform pg_temp.office_assert(public.office_query('detail',jsonb_build_object('id',(select value->>'id' from office_test_data where key='department-only')))->'document'->>'title'='Gửi riêng phòng ban','late tagged department gains document access');
end $$;
reset role;
do $$ declare doc_id uuid:=(select (value->>'id')::uuid from office_test_data where key='department-only'); begin
 perform pg_temp.office_assert((select count(*) from public.office_document_recipients where document_id=doc_id)=2,'exactly two department members receive document');
 perform pg_temp.office_assert((select count(*) from public.notifications where source_id=doc_id::text and metadata->>'event'='DOCUMENT_ISSUED')=2,'exactly one notification per department member');
end $$;
-- The optimized collection path must agree exactly with point authorization.
reset role;
do $$ declare persona record; mismatches int; begin
 for persona in select name from office_test_people loop
  perform pg_temp.office_as(persona.name);
  select count(*) into mismatches from (
   (select id from app_private.office_visible_documents() except select id from public.office_documents where app_private.office_can_view(id))
   union all
   (select id from public.office_documents where app_private.office_can_view(id) except select id from app_private.office_visible_documents())
  ) delta;
  perform pg_temp.office_assert(mismatches=0,'optimized visibility matches point ACL for '||persona.name);
 end loop;
end $$;
select 'PASS: department/site membership, expiry, AI quota and optimized ACL equivalence' result;

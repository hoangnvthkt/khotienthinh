-- Run inside Cloud rollback transaction after a seed creates pg_temp.hr_transfer_fixture.
-- Human approvals below exist only inside the rollback transaction; never run as a live operation.
create function pg_temp.transfer_assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'TRANSFER TEST: %',msg; end if; end $$;
create function pg_temp.transfer_as(uid uuid) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',(select jsonb_build_object('sub',coalesce(auth_id,gen_random_uuid()),'email',email,'role','authenticated')::text from public.users where id=uid),true);
end $$;
do $$ declare f record; r public.request_instances; a public.hrm_site_assignments; d public.office_documents; site_before uuid; previous_rows jsonb; result jsonb; denied boolean:=false; version_before bigint;
begin
 select * into strict f from hr_transfer_fixture;
 select * into strict r from public.request_instances where id=f.request_id;
 select construction_site_id into site_before from public.employees where id=f.employee_id;
 select jsonb_agg(to_jsonb(x) order by id) into previous_rows from public.hrm_site_assignments x where employee_id=f.employee_id;
 perform pg_temp.transfer_assert(r.status='PENDING','first real request waits for human approval');
 perform pg_temp.transfer_assert(not exists(select 1 from public.hrm_site_assignments where source_request_id=r.id),'pending request has no HR assignment');
 perform pg_temp.transfer_as(f.creator_id);
 begin
  perform public.act_on_request(r.id,'APPROVE','Rollback test',null,null,gen_random_uuid()::text,r.updated_at);
 exception when others then denied:=true; end;
 perform pg_temp.transfer_assert(denied,'request creator cannot approve own request');
 perform set_config('request.jwt.claims','{}',true);
 denied:=false;
 begin perform app_private.hr_transfer_request_links(r.id); exception when insufficient_privilege then denied:=true; end;
 perform pg_temp.transfer_assert(denied,'unauthorized callers cannot read cross-module links');
 perform pg_temp.transfer_as(f.admin_id);
 begin
  perform public.act_on_request(r.id,'REJECT','Rollback rejection only',null,null,gen_random_uuid()::text,r.updated_at);
  perform pg_temp.transfer_assert((select status='REJECTED' from public.request_instances where id=r.id),'request rejection completes');
  perform pg_temp.transfer_assert(not exists(select 1 from public.hrm_site_assignments where source_request_id=r.id),'rejected request creates no HR');
  raise exception sqlstate 'ZX001' using message='Rollback rejection probe';
 exception when sqlstate 'ZX001' then null; end;
 result:=public.act_on_request(r.id,'APPROVE','Rollback test only',null,null,gen_random_uuid()::text,r.updated_at);
 perform pg_temp.transfer_assert((select status='APPROVED' from public.request_instances where id=r.id),'request approved via actual RPC');
 select * into strict a from public.hrm_site_assignments where source_request_id=r.id;
 perform pg_temp.transfer_assert(a.status='pending' and a.office_document_id is null,'first approval creates only pending HR');
 perform pg_temp.transfer_assert(a.from_site_id=site_before,'origin preserved from approved request');
 update public.request_instances set updated_at=now() where id=r.id;
 perform pg_temp.transfer_assert((select count(*)=1 from public.hrm_site_assignments where source_request_id=r.id),'repeated source update creates no duplicate');
 denied:=false;
 begin update public.request_instances set form_data=form_data||'{"start_date":"2026-10-08"}' where id=r.id; exception when others then denied:=true; end;
 perform pg_temp.transfer_assert(denied,'approved source cannot silently change');
 perform pg_temp.transfer_as(f.creator_id);denied:=false;
 begin perform public.decide_hrm_site_assignment(a.id,true,null); exception when insufficient_privilege then denied:=true; end;
 perform pg_temp.transfer_assert(denied,'employee cannot approve HR transfer');
 perform pg_temp.transfer_as(f.admin_id);
 begin
  perform public.decide_hrm_site_assignment(a.id,false,'Rollback HR rejection only');
  perform pg_temp.transfer_assert((select status='rejected' and office_document_id is null from public.hrm_site_assignments where id=a.id),'HR rejection creates no Office');
  raise exception sqlstate 'ZX001' using message='Rollback HR rejection probe';
 exception when sqlstate 'ZX001' then null; end;
 perform public.decide_hrm_site_assignment(a.id,true,'Rollback HR approval only');
 select * into strict a from public.hrm_site_assignments where id=a.id;
 perform pg_temp.transfer_assert(a.status='awaiting_office' and a.office_document_id is not null,'HR approval creates Office and waits');
 select * into strict d from public.office_documents where id=a.office_document_id;
 perform pg_temp.transfer_assert(d.status='DRAFT' and d.document_number is null and d.issued_at is null,'Office draft not numbered or issued');
 perform pg_temp.transfer_assert(d.source_assignment_id=a.id,'Office source link');
 perform pg_temp.transfer_assert(position((select full_name from public.employees where id=f.employee_id) in d.content_text)>0,'employee name filled');
 perform pg_temp.transfer_assert(position('{{employee_name}}' in d.content_text)=0,'no unresolved HR variable');
 perform pg_temp.transfer_assert(position(app_private.hrm_site_name(a.site_id) in d.content_text)>0,'destination filled');
 perform pg_temp.transfer_assert((select construction_site_id=site_before from public.employees where id=f.employee_id),'HR approval does not move employee');
 perform pg_temp.transfer_assert((select jsonb_agg(to_jsonb(x) order by id)=previous_rows from public.hrm_site_assignments x where employee_id=f.employee_id and id<>a.id),'HR approval does not close existing assignments');
 perform pg_temp.transfer_assert(a.project_staff_id is null,'HR approval does not add project membership');
 perform pg_temp.transfer_assert(app_private.hr_transfer_create_office(a.id)=d.id,'retry reuses Office draft');
 perform pg_temp.transfer_assert((select count(*)=1 from public.office_documents where source_assignment_id=a.id),'exactly one Office draft');
 result:=public.get_request_detail(r.id);
 perform pg_temp.transfer_assert(result->'transfer'->>'assignmentId'=a.id::text,'request shows linked HR');
 perform pg_temp.transfer_assert(result->'transfer'->>'officeDocumentId'=d.id::text,'authorized admin sees Office link');
 version_before:=d.version;
 perform public.refresh_hr_transfer_office_draft(d.id);
 perform pg_temp.transfer_assert((select version=version_before+1 from public.office_documents where id=d.id),'refresh draft advances audited version');
 if jsonb_array_length(a.transfer_snapshot->'missing')>0 then
  denied:=false;
  begin update public.office_documents set status='PENDING_APPROVAL' where id=d.id; exception when others then denied:=true; end;
  perform pg_temp.transfer_assert(denied,'missing identity blocked before official approval');
 end if;

 -- Probe publication in a nested rollback so this smoke still finishes at the draft/cancel boundary.
 begin
  insert into public.hrm_employee_identity_documents(employee_id,record_code,document_type_code,document_number,issued_date,issued_place,is_primary,status)
  values(f.employee_id,'ROLLBACK-ONLY','CCCD','000000000001','2021-01-01','Rollback fixture',true,'ACTIVE');
  perform public.refresh_hr_transfer_office_draft(d.id);
  perform pg_temp.transfer_assert((select content_text like '%000000000001%' from public.office_documents where id=d.id),'leading zeros preserved');
  update public.office_documents set content=app_private.office_fill_number(content,'ROLLBACK-001/2026/TB'),document_number='ROLLBACK-001/2026/TB',sequence_number=999999,status='APPROVED' where id=d.id;
  update public.office_documents set status='ISSUED',issued_at=now() where id=d.id;
  perform pg_temp.transfer_assert((select status='approved' from public.hrm_site_assignments where id=a.id),'publication releases HR assignment');
  if a.start_date<=app_private.hrm_vn_today() then
   perform pg_temp.transfer_assert((select construction_site_id=a.site_id from public.employees where id=f.employee_id),'published effective transfer applies destination');
  else
   perform pg_temp.transfer_assert((select construction_site_id=site_before from public.employees where id=f.employee_id),'future publication does not apply destination early');
   perform pg_temp.transfer_assert((select project_staff_id is null from public.hrm_site_assignments where id=a.id),'future publication does not grant project membership early');
  end if;
  perform pg_temp.transfer_assert(not exists(select 1 from public.hrm_site_assignments where employee_id=f.employee_id and id<>a.id and status='approved' and kind='primary' and start_date<=a.start_date and (end_date is null or end_date>=a.start_date)),'same-day baseline replaced without invalid dates');
  raise exception sqlstate 'ZX001' using message='Rollback publication probe';
 exception when sqlstate 'ZX001' then null; end;
 perform pg_temp.transfer_assert((select status='awaiting_office' from public.hrm_site_assignments where id=a.id),'publication probe rolled back');
 perform public.cancel_hrm_site_assignment(a.id,'Rollback cancel pending Office');
 perform pg_temp.transfer_assert((select status='cancelled' from public.hrm_site_assignments where id=a.id),'waiting Office assignment can be cancelled');
 denied:=false;
 begin update public.office_documents set status='PENDING_APPROVAL' where id=d.id; exception when others then denied:=true; end;
 perform pg_temp.transfer_assert(denied,'cancelled source cannot submit Office');
 perform pg_temp.transfer_assert((select construction_site_id=site_before from public.employees where id=f.employee_id),'cancel never moved employee');
end $$;
select 'PASS: real request approval RPC -> pending HR -> real HR approval RPC -> one Office draft; no attendance/site/project effects; authorization, source freeze, missing data, refresh and cancellation verified' as result;

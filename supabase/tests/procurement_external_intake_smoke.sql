-- Cloud rollback runner only: synthetic fixtures and real approval RPCs, no live approvals.
create function pg_temp.intake_assert(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'INTAKE TEST: %',msg; end if; end $$;
create function pg_temp.intake_as(uid uuid) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub',coalesce((select auth_id::text from public.users where id=uid),''),true);
 perform set_config('request.jwt.claims',(select jsonb_build_object('sub',coalesce(auth_id,gen_random_uuid()),'email',email,'role','authenticated')::text from public.users where id=uid),true);
end $$;
do $$ declare admin_id uuid; creator uuid; reviewer uuid; rt uuid:=gen_random_uuid(); rv uuid:=gen_random_uuid(); rid uuid;
 wt uuid:=gen_random_uuid(); wi uuid:=gen_random_uuid(); n1 uuid:=gen_random_uuid(); n2 uuid:=gen_random_uuid(); ne uuid:=gen_random_uuid();
 result jsonb; detail jsonb; old_list jsonb; refs jsonb; denied boolean;
begin
 select id into strict admin_id from public.users where email='admin@khoviet.vn';
 select id into creator from public.users where is_active and account_status='ACTIVE' and auth_id is not null and id<>admin_id order by id limit 1;
 select id into reviewer from public.users where is_active and account_status='ACTIVE' and auth_id is not null and id not in(admin_id,creator) order by id limit 1;
 perform pg_temp.intake_as(admin_id);
 perform pg_temp.intake_assert((select count(*)=2 from app_private.procurement_source_routes),'both configured routes installed');
 perform pg_temp.intake_assert(not exists(select 1 from app_private.procurement_source_receipts),'activation never backfills');
 update public.request_instances set updated_at=now() where code='RQ-2026-000027';
 perform pg_temp.intake_assert(not exists(select 1 from app_private.procurement_source_receipts),'metadata edit of old approval never backfills');
 old_list:=app_private.procurement_legacy_list_v1('{}');
 result:=public.list_procurement_inbox_v1('{}');
 perform pg_temp.intake_assert(old_list->'documents'=result->'documents','legacy inbox unchanged before new approval');

 insert into public.request_templates(id,name,created_by) values(rt,'ROLLBACK intake request',admin_id);
 insert into public.request_template_versions(id,request_template_id,version_number,form_schema,usage_scope,flow_mode,completion_policy,status,created_by)
 values(rv,rt,1,'[{"key":"items","label":"Items","fieldType":"table","required":false,"options":["Name","Requested","Approved"]}]',
 '{"companyWide":true,"orgUnitIds":[],"userIds":[],"permissionCodes":[]}', 'SEQUENTIAL','ALL','DRAFT',admin_id);
 insert into public.request_approval_blocks(request_template_version_id,block_key,name,sort_order,approver_source,fixed_user_ids)
 values(rv,'first','First',0,'FIXED_SINGLE',array[reviewer]),(rv,'last','Final',1,'FIXED_SINGLE',array[admin_id]);
 perform public.publish_request_template_version(rt,(select updated_at from public.request_templates where id=rt));
 insert into app_private.procurement_source_routes(source_type,template_id,table_field,columns) values('request',rt,'items','["Name","Requested","Approved"]');
 perform pg_temp.intake_as(creator);
 result:=public.submit_request(rv,'ROLLBACK approved intake','Rollback test only','{"items":[{"Name":"Máng xối A — dày 2 mm","Requested":"1,5","Approved":""}]}','{}',gen_random_uuid()::text);
 rid:=(result->>'requestId')::uuid;
 perform pg_temp.intake_assert(not exists(select 1 from app_private.procurement_source_receipts where source_id=rid),'pending request not received');
 perform pg_temp.intake_as(reviewer);
 perform public.act_on_request(rid,'APPROVE','Rollback intermediate approval',null,null,gen_random_uuid()::text,(select updated_at from public.request_instances where id=rid));
 perform pg_temp.intake_assert(not exists(select 1 from app_private.procurement_source_receipts where source_id=rid),'intermediate request approval not received');
 perform pg_temp.intake_as(admin_id);
 perform public.act_on_request(rid,'APPROVE','Rollback final approval',null,null,gen_random_uuid()::text,(select updated_at from public.request_instances where id=rid));
 detail:=public.get_procurement_inbox_document_v1('request',rid::text);
 perform pg_temp.intake_assert(detail->>'intakeState'='received' and detail->>'orderable'='false','approved request received as review only');
 perform pg_temp.intake_assert(detail#>>'{sourceSnapshot,rows,0,cells,1}'='1,5' and detail#>>'{sourceSnapshot,rows,0,cells,2}'='','raw decimal and blank approved quantity preserved');
 perform pg_temp.intake_assert(detail->'lines'='[]'::jsonb,'no invented catalog line');
 update public.request_instances set updated_at=now() where id=rid;
 perform pg_temp.intake_assert((select revision=1 from app_private.procurement_source_receipts where source_id=rid),'metadata retry idempotent');
 refs:=jsonb_build_array(jsonb_build_object('sourceType','request','sourceId',rid));
 perform public.assign_procurement_inbox_v1(jsonb_build_object('sources',refs,'assigneeUserId',admin_id));
 perform pg_temp.intake_assert(public.get_procurement_inbox_document_v1('request',rid::text)->>'assigneeUserId'=admin_id::text,'assignment visible');
 perform public.close_procurement_need_v1(jsonb_build_object('sources',refs,'reason','Rollback closure'));
 perform pg_temp.intake_assert(public.get_procurement_inbox_document_v1('request',rid::text)->>'progress'='closed','closure visible');
 perform public.close_procurement_need_v1(jsonb_build_object('sources',refs,'action','reopen'));
 perform pg_temp.intake_assert(public.get_procurement_inbox_document_v1('request',rid::text)->>'progress'='new','manual reopen supported');
 denied:=false;
 begin perform public.save_procurement_hub_po_v1(jsonb_build_object('items',jsonb_build_array(jsonb_build_object('allocations',refs)))); exception when others then denied:=sqlerrm='PROCUREMENT_SOURCE_REVIEW_REQUIRED'; end;
 perform pg_temp.intake_assert(denied,'external line cannot bypass review through PO RPC');
 denied:=false;
 begin perform public.assign_procurement_inbox_v1('{"sources":[{}]}'); exception when others then denied:=sqlerrm='PROCUREMENT_SOURCE_NOT_FOUND'; end;
 perform pg_temp.intake_assert(denied,'malformed refs rejected');

 insert into public.workflow_templates(id,name,created_by) values(wt,'ROLLBACK intake workflow',admin_id);
 insert into public.workflow_nodes(id,template_id,type,label,config) values
 (n1,wt,'APPROVAL','First',jsonb_build_object('assigneeUserId',admin_id)),(n2,wt,'APPROVAL','Final',jsonb_build_object('assigneeUserId',admin_id)),(ne,wt,'END','End','{}');
 insert into public.workflow_edges(template_id,source_node_id,target_node_id) values(wt,n1,n2),(wt,n2,ne);
 insert into app_private.procurement_source_routes(source_type,template_id,table_field,columns) values('workflow',wt,'items','["Name","Requested","Approved"]');
 insert into public.workflow_instances(id,template_id,code,title,created_by,current_node_id,form_data)
 values(wi,wt,'ROLLBACK-'||wi,'ROLLBACK structure',creator,n1,'{"items":[["Máng xối B — dày 3 mm","8","6"]]}');
 perform public.process_workflow_instance_fast(wi,'APPROVED',admin_id,'Rollback step',array[]::uuid[]);
 perform pg_temp.intake_assert(not exists(select 1 from app_private.procurement_source_receipts where source_id=wi),'intermediate workflow step not received');
 perform public.process_workflow_instance_fast(wi,'APPROVED',admin_id,'Rollback final',array[]::uuid[]);
 detail:=public.get_procurement_inbox_document_v1('workflow',wi::text);
 perform pg_temp.intake_assert(detail->>'intakeState'='received' and detail#>>'{sourceSnapshot,rows,0,cells,2}'='6','final workflow received with approved quantity');
 update public.workflow_instances set status='RUNNING',current_node_id=n2 where id=wi;
 perform pg_temp.intake_assert(public.get_procurement_inbox_document_v1('workflow',wi::text)->>'intakeState'='withdrawn','source reopen withdraws intake');
 refs:=jsonb_build_array(jsonb_build_object('sourceType','workflow','sourceId',wi));
 denied:=false;
 begin perform public.close_procurement_need_v1(jsonb_build_object('sources',refs,'action','reopen')); exception when others then denied:=sqlerrm='PROCUREMENT_SOURCE_WITHDRAWN'; end;
 perform pg_temp.intake_assert(denied,'buyer cannot reopen withdrawn source');
 update public.workflow_instances set form_data='{"items":[["Máng xối B mới","8","5"]]}' where id=wi;
 perform public.process_workflow_instance_fast(wi,'APPROVED',admin_id,'Rollback reapproval',array[]::uuid[]);
 detail:=public.get_procurement_inbox_document_v1('workflow',wi::text);
 perform pg_temp.intake_assert(detail->>'sourceRevision'='2' and detail#>>'{sourceSnapshot,rows,0,cells,2}'='5','reapproval updates same intake with revision');
 perform pg_temp.intake_assert((select count(*)=2 from app_private.procurement_source_versions where source_id=wi),'prior snapshot retained');
 update public.workflow_instances set form_data='{"items":[["Unauthorized post approval edit","9","9"]]}' where id=wi;
 perform pg_temp.intake_assert(public.get_procurement_inbox_document_v1('workflow',wi::text)->>'intakeState'='withdrawn','postapproval content change withdraws');
 result:=public.list_procurement_inbox_v1('{"source":"workflow","progress":"open"}');
 perform pg_temp.intake_assert(jsonb_array_length(result->'documents')=0,'withdrawn hidden from open filter');
 result:=public.list_procurement_inbox_v1('{"source":"workflow","progress":"closed"}');
 perform pg_temp.intake_assert(jsonb_array_length(result->'documents')=1,'withdrawn visible in closed history');
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 denied:=false;
 begin perform public.list_procurement_inbox_v1('{}'); exception when insufficient_privilege then denied:=true; end;
 perform pg_temp.intake_assert(denied,'unauthenticated read denied');
 denied:=false;
 begin perform public.assign_procurement_inbox_v1(jsonb_build_object('sources',refs)); exception when insufficient_privilege then denied:=true; end;
 perform pg_temp.intake_assert(denied,'unauthenticated mutation denied');
end $$;
set local role authenticated;
do $$ begin
 begin perform * from app_private.procurement_source_receipts; raise exception 'private receipts exposed'; exception when insufficient_privilege then null; end;
 begin perform app_private.procurement_legacy_list_v1('{}'); raise exception 'legacy RPC bypass exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: request and workflow final approval, no backfill, raw snapshot, assignment, closure, withdrawal, reapproval, PO guard and permissions' as result;

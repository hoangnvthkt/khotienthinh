-- Schema-only Supabase Cloud preview only. Every fixture is rolled back.
begin;
create temp table task8_ids on commit drop as
select gen_random_uuid() admin_id, gen_random_uuid() reviewer_id,
  gen_random_uuid() buyer_position_id, gen_random_uuid() workspace_id,
  gen_random_uuid() construction_id, gen_random_uuid() work_line_id,
  ('task8-project-' || gen_random_uuid()::text) project_id,
  ('task8-work-' || gen_random_uuid()::text) work_id,
  ('task8-item-' || gen_random_uuid()::text) item_id,
  ('task8-item-b-' || gen_random_uuid()::text) item_b_id;
insert into public.users(id,name,email,username,role)
select admin_id,'Task 8 admin','project-v2-task8-admin@example.invalid',
  'task8-' || left(admin_id::text,8),'ADMIN' from task8_ids;
insert into public.users(id,name,email,username,role)
select reviewer_id,'Task 8 reviewer','project-v2-task8-reviewer@example.invalid',
  'task8-' || left(reviewer_id::text,8),'ADMIN' from task8_ids;
insert into public.projects(id,code,name)
select project_id,'T7-' || left(admin_id::text,8),'Task 8 project' from task8_ids;
insert into public.hrm_positions(id,name,level,code,is_active,sort_order,source,metadata)
select buyer_position_id,'Task 8 buyer',1,'T8-' || left(buyer_position_id::text,8),
  true,0,'smoke','{}'::jsonb from task8_ids;
insert into public.project_permission_rooms(code,group_code,name,
  allowed_actions,required_actions,sort_order) values
  ('material_request','material','Material request',array['view','edit'],array['view'],1),
  ('material_po','material','Material purchase order',array['view','edit'],array['view'],2)
on conflict (code) do nothing;
insert into app_private.project_permission_room_action_bindings(room_code,action_code,
  enforcement_status,relationship_description,verified_at,verified_source,
  pbac_fallback_enabled,prerequisite_action_codes) values
  ('material_request','view','enforced','Task 8 read',now(),'task8_smoke',false,'{}'),
  ('material_po','view','enforced','Task 8 price read',now(),'task8_smoke',false,'{}'),
  ('material_po','edit','enforced','Task 8 disposition',now(),'task8_smoke',false,array['view'])
on conflict (room_code,action_code) do update set
  enforcement_status = excluded.enforcement_status,
  prerequisite_action_codes = excluded.prerequisite_action_codes;
insert into public.project_staff(id,project_id,user_id,position_id,start_date,note)
select gen_random_uuid(),project_id,reviewer_id::text,buyer_position_id,
  current_date,'Task 8 buyer fixture' from task8_ids;
insert into public.project_permission_room_members(project_id,construction_site_id,
  room_code,project_staff_id,is_active)
select ids.project_id,null,room.code,staff.id,true from task8_ids ids
join public.project_staff staff on staff.project_id = ids.project_id
  and staff.user_id = ids.reviewer_id::text
cross join (values ('material_request'),('material_po')) room(code);
insert into public.project_permission_room_member_actions(room_member_id,action_code,is_active)
select member.id,action.code,true from task8_ids ids
join public.project_permission_room_members member on member.project_id = ids.project_id
cross join lateral (select code from (values ('view'),('edit')) actions(code)
  where code = 'view' or member.room_code = 'material_po') action;
insert into public.project_v2_workspaces(id,project_id,enrolled_by)
select workspace_id,project_id,admin_id from task8_ids;
insert into public.items(id,sku,name,category,unit,price_in,price_out,min_stock)
select item_id,'T7-' || left(admin_id::text,8),'Xi măng','material','kg',0,0,0 from task8_ids;
insert into public.items(id,sku,name,category,unit,price_in,price_out,min_stock)
select item_b_id,'T7-B-' || left(admin_id::text,8),'Cát vàng','material','kg',0,0,0 from task8_ids;
insert into public.project_work_boq_items(id,project_id,name,unit,planned_qty)
select work_id,project_id,'Đào móng','m3',10 from task8_ids;
insert into public.project_work_boq_norm_mappings(id,project_id,work_boq_item_id,
  norm_code_snapshot,norm_name_snapshot,status)
select 'task8-map',project_id,work_id,'N-01','Định mức', 'active' from task8_ids;
insert into public.cost_norm_resources(id,code,name,type,unit)
values ('resource-01','R-01','Xi măng','material','kg');
insert into public.cost_norm_resources(id,code,name,type,unit)
values ('resource-02','R-02','Cát vàng','material','kg');
insert into public.material_budget_items(id,project_id,work_boq_item_id,category,item_name,
  unit,inventory_item_id,source_type,source_norm_mapping_id)
select 'task8-budget',project_id,work_id,'material','Xi măng','kg',item_id,
  'g8_norm','task8-map' from task8_ids;
insert into public.material_budget_items(id,project_id,work_boq_item_id,category,item_name,
  unit,inventory_item_id,source_type,source_norm_mapping_id)
select 'task8-budget-b',project_id,work_id,'material','Cát vàng','kg',item_b_id,
  'g8_norm','task8-map' from task8_ids;
insert into public.project_work_boq_norm_component_estimates(id,mapping_id,project_id,
  work_boq_item_id,cost_norm_resource_id,resource_type,resource_name_snapshot,
  unit,coefficient,work_boq_qty_snapshot,estimated_qty,selected,material_budget_item_id)
select 'task8-est','task8-map',project_id,work_id,'resource-01','material','Xi măng',
  'kg',1,10,50,true,'task8-budget' from task8_ids;
insert into public.project_work_boq_norm_component_estimates(id,mapping_id,project_id,
  work_boq_item_id,cost_norm_resource_id,resource_type,resource_name_snapshot,
  unit,coefficient,work_boq_qty_snapshot,estimated_qty,selected,material_budget_item_id)
select 'task8-est-b','task8-map',project_id,work_id,'resource-02','material','Cát vàng',
  'kg',1,10,20,true,'task8-budget-b' from task8_ids;
update public.material_budget_items set source_norm_component_estimate_id = 'task8-est'
  where id = 'task8-budget';
update public.material_budget_items set source_norm_component_estimate_id = 'task8-est-b'
  where id = 'task8-budget-b';
insert into public.project_v2_plans(id,workspace_id,plan_type,code,title,status,
  period_start,period_end,creator_user_id,approver_user_id,approved_at,content_hash,effective_revision_no)
select construction_id,workspace_id,'construction','C-T7','Thi công nguồn','approved',
  date '2026-10-01',date '2026-10-31',admin_id,reviewer_id,now(),'task8-construction-hash',1 from task8_ids;
insert into public.project_v2_plan_revisions(plan_id,revision_no,content_hash,approved_snapshot,approved_by)
select construction_id,1,'task8-construction-hash','{}'::jsonb,reviewer_id from task8_ids;
insert into public.project_v2_plan_lines(id,plan_id,revision_no,plan_type,work_item_id,
  unit,quantity,work_start,work_end)
select work_line_id,construction_id,1,'construction',work_id,'m3',10,
  date '2026-10-01',date '2026-10-31' from task8_ids;
select set_config('request.jwt.claims','{"email":"project-v2-task8-admin@example.invalid"}',true);
create temp table task8_side_effects_before on commit drop as
select (select count(*) from public.requests) request_count,
  (select count(*) from public.purchase_orders) purchase_order_count,
  (select count(*) from public.inventory_transactions) inventory_count,
  (select count(*) from public.material_issue_receipts) receipt_count,
  (select count(*) from public.supplier_payable_documents) payable_count,
  (select count(*) from public.cash_vouchers) cash_count;
do $$
declare
  v_ids record; v_items jsonb; v_first jsonb; v_second jsonb;
  v_result jsonb; v_plan_id uuid; v_demand_id uuid; v_cancellable_plan_id uuid;
  v_line_a uuid; v_line_b uuid; v_demand_line_a uuid;
  v_identity_a uuid; v_registry_a uuid;
  v_source_revision_id uuid; v_owner_id uuid;
begin
  select * into v_ids from task8_ids;
  v_items := public.list_project_v2_material_candidates_v1(v_ids.project_id,null,
    array[v_ids.construction_id]) -> 'items';
  if jsonb_array_length(v_items) <> 2 then raise exception 'TASK8_CANDIDATE_COUNT'; end if;
  v_first := v_items -> 0; v_second := v_items -> 1;
  v_result := public.save_project_v2_plan_v1(v_ids.workspace_id,null,null,'task8-material-save',
    'material','V-T8','Vật tư thử nghiệm',date '2026-10-01',date '2026-10-31',
    jsonb_build_array(jsonb_build_object('itemId',v_ids.item_id,'unit','kg',
      'quantity','30.000000','calculatedQuantity','50.000000',
      'overrideReason','Giao đợt đầu','neededDate','2026-10-08','destinationId','site-a',
      'derivations',jsonb_build_array(jsonb_build_object(
        'sourcePlanId',v_first ->> 'sourcePlanId','sourceRevision',(v_first ->> 'sourceRevision')::integer,
        'sourcePlanHash',v_first ->> 'sourcePlanHash','sourceLineId',v_first ->> 'sourceLineId',
        'sourceWorkQuantity','10.000000','normResourceId',v_first ->> 'normResourceId',
        'normRevision',v_first ->> 'normRevision','normFactor','5.000000',
        'coefficient','1.000000','conversionNumerator','1.000000',
        'conversionDenominator','1.000000','derivedQuantity','50.000000',
        'allocatedQuantity','30.000000'))),
      jsonb_build_object('itemId',v_ids.item_b_id,'unit','kg',
        'quantity','20.000000','calculatedQuantity','20.000000',
        'neededDate','2026-10-08','destinationId','site-a',
        'derivations',jsonb_build_array(jsonb_build_object(
        'sourcePlanId',v_second ->> 'sourcePlanId','sourceRevision',(v_second ->> 'sourceRevision')::integer,
        'sourcePlanHash',v_second ->> 'sourcePlanHash','sourceLineId',v_second ->> 'sourceLineId',
        'sourceWorkQuantity','10.000000','normResourceId',v_second ->> 'normResourceId',
        'normRevision',v_second ->> 'normRevision','normFactor','2.000000',
        'coefficient','1.000000','conversionNumerator','1.000000',
        'conversionDenominator','1.000000','derivedQuantity','20.000000',
        'allocatedQuantity','20.000000')))));
  v_plan_id := (v_result ->> 'planId')::uuid;
  perform public.submit_project_v2_plan_v1(v_plan_id,1,'task8-material-submit','');
  perform set_config('request.jwt.claims','{"email":"project-v2-task8-reviewer@example.invalid"}',true);
  v_result := public.approve_project_v2_plan_v1(v_plan_id,2,'task8-material-approve');
  if v_result ->> 'status' <> 'approved' then raise exception 'TASK8_PLAN_NOT_APPROVED'; end if;
  select d.id into v_demand_id from public.procurement_demands d
    join public.procurement_source_documents source on source.id = d.source_document_id
    where source.source_adapter = 'material_plan' and source.source_document_id = v_plan_id::text;
  if v_demand_id is null then raise exception 'TASK8_DEMAND_MISSING'; end if;
  if (select count(*) from public.procurement_demands where id = v_demand_id) <> 1
    or (select count(*) from public.procurement_demand_lines where demand_id = v_demand_id) <> 2
    or (select count(*) from public.procurement_source_revisions r
      join public.procurement_source_documents d on d.id = r.source_document_id
      where d.source_document_id = v_plan_id::text and d.source_adapter = 'material_plan') <> 1
    or (select count(*) from public.procurement_source_line_registry r
      join public.procurement_source_documents d on d.id = r.source_document_id
      where d.source_document_id = v_plan_id::text and d.source_adapter = 'material_plan') <> 2 then
    raise exception 'TASK8_CANONICAL_IDENTITY_INVALID';
  end if;
  if (select sum(approved_qty) from public.procurement_demand_lines
    where demand_id = v_demand_id) <> 50 then raise exception 'TASK8_APPROVED_QTY_INVALID'; end if;
  v_result := public.approve_project_v2_plan_v1(v_plan_id,2,'task8-material-approve');
  if v_result ->> 'planId' <> v_plan_id::text
    or (v_result ->> 'version')::bigint <> 3 then
    raise exception 'TASK8_APPROVAL_NOT_REPLAYED';
  end if;
  v_result := public.sync_material_plan_demand_v1(v_plan_id,1,'task8-recovery-sync');
  if (v_result ->> 'demandId')::uuid <> v_demand_id then
    raise exception 'TASK8_RECOVERY_DUPLICATED_DEMAND'; end if;
  if (select count(*) from app_private.procurement_events_outbox
    where aggregate_type = 'procurement_demand' and aggregate_id = v_demand_id) <> 1 then
    raise exception 'TASK8_DUPLICATE_OUTBOX';
  end if;
  select l.id, r.source_line_id::uuid, l.source_line_registry_id, l.current_source_revision_id,
      d.owner_context_id into v_line_a, v_identity_a, v_registry_a,
      v_source_revision_id, v_owner_id
    from public.procurement_demand_lines l
    join public.procurement_demands d on d.id = l.demand_id
    join public.procurement_source_line_registry r on r.id = l.source_line_registry_id
    where l.demand_id = v_demand_id and r.item_id = v_ids.item_id;
  v_demand_line_a := v_line_a;
  insert into public.procurement_supply_allocations(owner_context_id, demand_line_id,
    source_revision_id, execution_source_line_registry_id, method, state,
    reserved_need_qty, need_unit, execution_qty, execution_unit,
    conversion_numerator, conversion_denominator, reason, created_by, updated_by)
  values (v_owner_id, v_demand_line_a, v_source_revision_id, v_registry_a, 'material_plan',
    'reserved', 28, 'kg', 28, 'kg', 1, 1, 'Task 8 downstream fixture',
    v_ids.reviewer_id, v_ids.reviewer_id);
  update public.procurement_source_line_registry set downstream_locked = true
    where id = v_registry_a;
  perform set_config('request.jwt.claims','{"email":"project-v2-task8-admin@example.invalid"}',true);
  v_result := public.create_project_v2_plan_revision_v1(v_plan_id,3,'task8-revise');
  if (v_result ->> 'version')::bigint <> 4 then raise exception 'TASK8_REVISION_FAILED'; end if;
  select id into v_line_a from public.project_v2_plan_lines
    where plan_id = v_plan_id and revision_no = 2 and inventory_item_id = v_ids.item_id;
  select id into v_line_b from public.project_v2_plan_lines
    where plan_id = v_plan_id and revision_no = 2 and inventory_item_id = v_ids.item_b_id;
  v_result := public.save_project_v2_plan_v1(v_ids.workspace_id,v_plan_id,4,
    'task8-revision-save','material','V-T8','Vật tư thử nghiệm',
    date '2026-10-01',date '2026-10-31',
    jsonb_build_array(jsonb_build_object('id',v_line_a,'itemId',v_ids.item_id,'unit','kg',
      'quantity','25.000000','calculatedQuantity','50.000000',
      'overrideReason','Điều chỉnh giảm đợt đầu','neededDate','2026-10-08',
      'destinationId','site-a','derivations',jsonb_build_array(jsonb_build_object(
        'sourcePlanId',v_first ->> 'sourcePlanId',
        'sourceRevision',(v_first ->> 'sourceRevision')::integer,
        'sourcePlanHash',v_first ->> 'sourcePlanHash','sourceLineId',v_first ->> 'sourceLineId',
        'sourceWorkQuantity','10.000000','normResourceId',v_first ->> 'normResourceId',
        'normRevision',v_first ->> 'normRevision','normFactor','5.000000',
        'coefficient','1.000000','conversionNumerator','1.000000',
        'conversionDenominator','1.000000','derivedQuantity','50.000000',
        'allocatedQuantity','25.000000'))),
      jsonb_build_object('id',v_line_b,'itemId',v_ids.item_b_id,'unit','kg',
      'quantity','20.000000','calculatedQuantity','20.000000',
      'neededDate','2026-10-08','destinationId','site-a',
      'derivations',jsonb_build_array(jsonb_build_object(
        'sourcePlanId',v_second ->> 'sourcePlanId',
        'sourceRevision',(v_second ->> 'sourceRevision')::integer,
        'sourcePlanHash',v_second ->> 'sourcePlanHash','sourceLineId',v_second ->> 'sourceLineId',
        'sourceWorkQuantity','10.000000','normResourceId',v_second ->> 'normResourceId',
        'normRevision',v_second ->> 'normRevision','normFactor','2.000000',
        'coefficient','1.000000','conversionNumerator','1.000000',
        'conversionDenominator','1.000000','derivedQuantity','20.000000',
        'allocatedQuantity','20.000000')))));
  if (v_result ->> 'version')::bigint <> 5 then raise exception 'TASK8_REVISION_SAVE_FAILED'; end if;
  if (select source_identity_id from public.project_v2_plan_lines
      where id = v_line_a) <> v_identity_a then
    raise exception 'TASK8_SOURCE_LINE_IDENTITY_DRIFT';
  end if;
  perform public.submit_project_v2_plan_v1(v_plan_id,5,'task8-revision-submit','');
  perform set_config('request.jwt.claims','{"email":"project-v2-task8-reviewer@example.invalid"}',true);
  v_result := public.approve_project_v2_plan_v1(v_plan_id,6,'task8-revision-approve');
  if v_result ->> 'status' <> 'approved'
    or (select count(*) from public.procurement_demands where id = v_demand_id) <> 1
    or (select count(*) from public.procurement_source_line_registry
      where source_document_id = (select source_document_id from public.procurement_demands
        where id = v_demand_id)) <> 2
    or (select count(*) from public.procurement_source_revisions
      where source_document_id = (select source_document_id from public.procurement_demands
        where id = v_demand_id)) <> 2 then
    raise exception 'TASK8_REVISION_CANONICAL_IDENTITY_INVALID';
  end if;
  if (select intake_state from public.procurement_demands where id = v_demand_id)
      <> 'source_changed'
    or (select approved_qty from public.procurement_demand_lines where id = v_demand_line_a) <> 30
    or not exists (select 1 from public.procurement_reconciliation_issues
      where source_adapter = 'material_plan' and source_document_ref = v_plan_id::text
        and issue_code = 'MATERIAL_PLAN_REDUCTION_WITH_DOWNSTREAM'
        and severity = 'blocking' and status = 'open') then
    raise exception 'TASK8_DOWNSTREAM_REDUCTION_NOT_BLOCKED';
  end if;
  begin
    perform public.resolve_material_plan_source_change_v1(v_demand_id,
      (select version from public.procurement_demands where id = v_demand_id),
      'accept_current_revision','Buyer review','task8-unsafe-disposition');
    raise exception 'TASK8_UNSAFE_DISPOSITION_ACCEPTED';
  exception when check_violation then null;
  end;
  update public.procurement_supply_allocations
    set reserved_need_qty = 20, execution_qty = 20, updated_at = now()
    where demand_line_id = v_demand_line_a;
  v_result := public.resolve_material_plan_source_change_v1(v_demand_id,
    (select version from public.procurement_demands where id = v_demand_id),
    'accept_current_revision','Buyer verified reduced reservation',
    'task8-safe-disposition');
  if v_result ->> 'intakeState' <> 'ready'
    or (select approved_qty from public.procurement_demand_lines where id = v_demand_line_a) <> 25
    or exists (select 1 from public.procurement_reconciliation_issues
      where source_adapter = 'material_plan' and source_document_ref = v_plan_id::text
        and status = 'open') then
    raise exception 'TASK8_SAFE_DISPOSITION_NOT_APPLIED';
  end if;
  v_result := public.cancel_project_v2_plan_v1(v_plan_id,7,
    'task8-cancel-with-downstream','Buyer reconciliation required');
  if v_result ->> 'status' <> 'approved'
    or (select intake_state from public.procurement_demands where id = v_demand_id)
      <> 'source_changed'
    or not exists (select 1 from public.procurement_reconciliation_issues
      where source_adapter = 'material_plan' and source_document_ref = v_plan_id::text
        and issue_code = 'MATERIAL_PLAN_CANCELLATION_WITH_DOWNSTREAM' and status = 'open') then
    raise exception 'TASK8_CANCELLATION_WITH_DOWNSTREAM_LOST';
  end if;
  perform set_config('request.jwt.claims','{"email":"project-v2-task8-admin@example.invalid"}',true);
  v_result := public.save_project_v2_plan_v1(v_ids.workspace_id,null,null,
    'task8-cancellable-save','material','V-T8-2','Vật tư hủy',
    date '2026-10-01',date '2026-10-31',
    jsonb_build_array(jsonb_build_object('itemId',v_ids.item_id,'unit','kg',
      'quantity','10.000000','calculatedQuantity','50.000000',
      'overrideReason','Đợt dự phòng','neededDate','2026-10-09',
      'destinationId','site-a','derivations',jsonb_build_array(jsonb_build_object(
        'sourcePlanId',v_first ->> 'sourcePlanId',
        'sourceRevision',(v_first ->> 'sourceRevision')::integer,
        'sourcePlanHash',v_first ->> 'sourcePlanHash','sourceLineId',v_first ->> 'sourceLineId',
        'sourceWorkQuantity','10.000000','normResourceId',v_first ->> 'normResourceId',
        'normRevision',v_first ->> 'normRevision','normFactor','5.000000',
        'coefficient','1.000000','conversionNumerator','1.000000',
        'conversionDenominator','1.000000','derivedQuantity','50.000000',
        'allocatedQuantity','10.000000')))));
  v_cancellable_plan_id := (v_result ->> 'planId')::uuid;
  perform public.submit_project_v2_plan_v1(v_cancellable_plan_id,1,
    'task8-cancellable-submit','');
  perform set_config('request.jwt.claims','{"email":"project-v2-task8-reviewer@example.invalid"}',true);
  perform public.approve_project_v2_plan_v1(v_cancellable_plan_id,2,
    'task8-cancellable-approve');
  v_result := public.cancel_project_v2_plan_v1(v_cancellable_plan_id,3,
    'task8-cancellable-cancel','Không còn nhu cầu');
  if v_result ->> 'status' <> 'cancelled'
    or not exists (select 1 from public.procurement_demands d
      join public.procurement_source_documents s on s.id = d.source_document_id
      where s.source_adapter = 'material_plan'
        and s.source_document_id = v_cancellable_plan_id::text
        and s.archived_at is not null and d.intake_state = 'withdrawn') then
    raise exception 'TASK8_CANCELLATION_WITHOUT_DOWNSTREAM_NOT_WITHDRAWN';
  end if;
  if exists (select 1 from task8_side_effects_before b where
    b.request_count <> (select count(*) from public.requests)
    or b.purchase_order_count <> (select count(*) from public.purchase_orders)
    or b.inventory_count <> (select count(*) from public.inventory_transactions)
    or b.receipt_count <> (select count(*) from public.material_issue_receipts)
    or b.payable_count <> (select count(*) from public.supplier_payable_documents)
    or b.cash_count <> (select count(*) from public.cash_vouchers)) then
    raise exception 'TASK8_UNINTENDED_SIDE_EFFECT';
  end if;
end $$;
rollback;

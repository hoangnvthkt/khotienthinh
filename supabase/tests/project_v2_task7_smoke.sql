-- Schema-only Supabase Cloud preview only. Every fixture is rolled back.
begin;
create temp table task7_ids on commit drop as
select gen_random_uuid() admin_id, gen_random_uuid() reviewer_id, gen_random_uuid() workspace_id,
  gen_random_uuid() construction_id, gen_random_uuid() work_line_id,
  ('task7-project-' || gen_random_uuid()::text) project_id,
  ('task7-work-' || gen_random_uuid()::text) work_id,
  ('task7-item-' || gen_random_uuid()::text) item_id,
  ('task7-item-b-' || gen_random_uuid()::text) item_b_id;
insert into public.users(id,name,email,username,role)
select admin_id,'Task 7 admin','project-v2-task7-admin@example.invalid',
  'task7-' || left(admin_id::text,8),'ADMIN' from task7_ids;
insert into public.users(id,name,email,username,role)
select reviewer_id,'Task 7 reviewer','project-v2-task7-reviewer@example.invalid',
  'task7-' || left(reviewer_id::text,8),'ADMIN' from task7_ids;
insert into public.projects(id,code,name)
select project_id,'T7-' || left(admin_id::text,8),'Task 7 project' from task7_ids;
insert into public.project_v2_workspaces(id,project_id,enrolled_by)
select workspace_id,project_id,admin_id from task7_ids;
insert into public.items(id,sku,name,category,unit,price_in,price_out,min_stock)
select item_id,'T7-' || left(admin_id::text,8),'Xi măng','material','kg',0,0,0 from task7_ids;
insert into public.items(id,sku,name,category,unit,price_in,price_out,min_stock)
select item_b_id,'T7-B-' || left(admin_id::text,8),'Cát vàng','material','kg',0,0,0 from task7_ids;
insert into public.project_work_boq_items(id,project_id,name,unit,planned_qty)
select work_id,project_id,'Đào móng','m3',10 from task7_ids;
insert into public.project_work_boq_norm_mappings(id,project_id,work_boq_item_id,
  norm_code_snapshot,norm_name_snapshot,status)
select 'task7-map',project_id,work_id,'N-01','Định mức', 'active' from task7_ids;
insert into public.cost_norm_resources(id,code,name,type,unit)
values ('resource-01','R-01','Xi măng','material','kg');
insert into public.cost_norm_resources(id,code,name,type,unit)
values ('resource-02','R-02','Cát vàng','material','kg');
insert into public.material_budget_items(id,project_id,work_boq_item_id,category,item_name,
  unit,inventory_item_id,source_type,source_norm_mapping_id)
select 'task7-budget',project_id,work_id,'material','Xi măng','kg',item_id,
  'g8_norm','task7-map' from task7_ids;
insert into public.material_budget_items(id,project_id,work_boq_item_id,category,item_name,
  unit,inventory_item_id,source_type,source_norm_mapping_id)
select 'task7-budget-b',project_id,work_id,'material','Cát vàng','kg',item_b_id,
  'g8_norm','task7-map' from task7_ids;
insert into public.project_work_boq_norm_component_estimates(id,mapping_id,project_id,
  work_boq_item_id,cost_norm_resource_id,resource_type,resource_name_snapshot,
  unit,coefficient,work_boq_qty_snapshot,estimated_qty,selected,material_budget_item_id)
select 'task7-est','task7-map',project_id,work_id,'resource-01','material','Xi măng',
  'kg',1,10,50,true,'task7-budget' from task7_ids;
insert into public.project_work_boq_norm_component_estimates(id,mapping_id,project_id,
  work_boq_item_id,cost_norm_resource_id,resource_type,resource_name_snapshot,
  unit,coefficient,work_boq_qty_snapshot,estimated_qty,selected,material_budget_item_id)
select 'task7-est-b','task7-map',project_id,work_id,'resource-02','material','Cát vàng',
  'kg',1,10,20,true,'task7-budget-b' from task7_ids;
update public.material_budget_items set source_norm_component_estimate_id = 'task7-est'
  where id = 'task7-budget';
update public.material_budget_items set source_norm_component_estimate_id = 'task7-est-b'
  where id = 'task7-budget-b';
insert into public.project_v2_plans(id,workspace_id,plan_type,code,title,status,
  period_start,period_end,creator_user_id,approver_user_id,approved_at,content_hash,effective_revision_no)
select construction_id,workspace_id,'construction','C-T7','Thi công nguồn','approved',
  date '2026-10-01',date '2026-10-31',admin_id,reviewer_id,now(),'task7-construction-hash',1 from task7_ids;
insert into public.project_v2_plan_revisions(plan_id,revision_no,content_hash,approved_snapshot,approved_by)
select construction_id,1,'task7-construction-hash','{}'::jsonb,reviewer_id from task7_ids;
insert into public.project_v2_plan_lines(id,plan_id,revision_no,plan_type,work_item_id,
  unit,quantity,work_start,work_end)
select work_line_id,construction_id,1,'construction',work_id,'m3',10,
  date '2026-10-01',date '2026-10-31' from task7_ids;
select set_config('request.jwt.claims','{"email":"project-v2-task7-admin@example.invalid"}',true);
do $$
declare v_ids record; v_items jsonb; v_row jsonb; v_second jsonb; v_result jsonb; v_plan_id uuid;
  v_extra_id uuid; v_incomplete_id uuid;
begin
  select * into v_ids from task7_ids;
  v_items := public.list_project_v2_material_candidates_v1(v_ids.project_id,null,
    array[v_ids.construction_id]) -> 'items';
  if jsonb_array_length(v_items) <> 2 then raise exception 'TASK7_CANDIDATE_COUNT: %',v_items; end if;
  v_row := v_items -> 0;
  v_second := v_items -> 1;
  if v_row ->> 'itemId' <> v_ids.item_id or (v_row ->> 'calculatedQty')::numeric <> 50
    or v_row ->> 'selectable' <> 'true' then
    raise exception 'TASK7_CANDIDATE_INVALID: %',v_row;
  end if;
  v_result := public.save_project_v2_plan_v1(v_ids.workspace_id,null,null,'task7-material-save',
    'material','V-T7','Vật tư thử nghiệm',date '2026-10-01',date '2026-10-31',
    jsonb_build_array(jsonb_build_object('itemId',v_ids.item_id,'unit','kg',
      'quantity','30.000000','calculatedQuantity','50.000000',
      'overrideReason','Giao đợt đầu','neededDate','2026-10-08','destinationId','site-a',
      'derivations',jsonb_build_array(jsonb_build_object(
        'sourcePlanId',v_row ->> 'sourcePlanId','sourceRevision',(v_row ->> 'sourceRevision')::integer,
        'sourcePlanHash',v_row ->> 'sourcePlanHash','sourceLineId',v_row ->> 'sourceLineId',
        'sourceWorkQuantity','10.000000','normResourceId',v_row ->> 'normResourceId',
        'normRevision',v_row ->> 'normRevision','normFactor','5.000000',
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
  v_result := public.submit_project_v2_plan_v1(v_plan_id,1,'task7-material-submit','');
  if v_result ->> 'status' <> 'pending_approval' then raise exception 'TASK7_NOT_PENDING'; end if;
  v_row := public.list_project_v2_material_candidates_v1(v_ids.project_id,null,
    array[v_ids.construction_id]) -> 'items' -> 0;
  if (v_row ->> 'alreadyPlannedQty')::numeric <> 30
    or (v_row ->> 'availableQty')::numeric <> 20 then
    raise exception 'TASK7_ALLOCATION_NOT_DEDUCTED: %',v_row;
  end if;
  v_result := public.save_project_v2_plan_v1(v_ids.workspace_id,null,null,'task7-incomplete-save',
    'material','V-T7-UNKNOWN','Thiếu danh tính vật tư',date '2026-10-01',date '2026-10-31',
    jsonb_build_array(jsonb_build_object('itemId',null,'unit',null,'quantity',null,
      'calculatedQuantity',null,'neededDate',null,'destinationId',null,
      'derivations',jsonb_build_array(jsonb_build_object('sourcePlanId',v_row ->> 'sourcePlanId',
        'sourceRevision',(v_row ->> 'sourceRevision')::integer,
        'sourcePlanHash',v_row ->> 'sourcePlanHash','sourceLineId',v_row ->> 'sourceLineId',
        'sourceWorkQuantity','10.000000','normResourceId',null,
        'normRevision',null,'normFactor',null,'coefficient',null,
        'conversionNumerator',null,'conversionDenominator',null,
        'derivedQuantity',null,'allocatedQuantity',null)))));
  v_incomplete_id := (v_result ->> 'planId')::uuid;
  begin
    perform public.submit_project_v2_plan_v1(v_incomplete_id,1,'task7-incomplete-submit','');
    raise exception 'TASK7_INCOMPLETE_ACCEPTED';
  exception when sqlstate '22023' then null;
  end;
  v_result := public.save_project_v2_plan_v1(v_ids.workspace_id,null,null,'task7-extra-save',
    'material','V-T7-EXTRA','Vượt nguồn',date '2026-10-01',date '2026-10-31',
    jsonb_build_array(jsonb_build_object('itemId',v_ids.item_id,'unit','kg',
      'quantity','25.000000','calculatedQuantity','50.000000',
      'overrideReason','Giao bổ sung','neededDate','2026-10-09','destinationId','site-a',
      'derivations',jsonb_build_array(jsonb_build_object(
        'sourcePlanId',v_row ->> 'sourcePlanId','sourceRevision',(v_row ->> 'sourceRevision')::integer,
        'sourcePlanHash',v_row ->> 'sourcePlanHash','sourceLineId',v_row ->> 'sourceLineId',
        'sourceWorkQuantity','10.000000','normResourceId',v_row ->> 'normResourceId',
        'normRevision',v_row ->> 'normRevision','normFactor','5.000000',
        'coefficient','1.000000','conversionNumerator','1.000000',
        'conversionDenominator','1.000000','derivedQuantity','50.000000',
        'allocatedQuantity','25.000000')))));
  v_extra_id := (v_result ->> 'planId')::uuid;
  begin
    perform public.submit_project_v2_plan_v1(v_extra_id,1,'task7-extra-submit','');
    raise exception 'TASK7_OVERALLOCATION_ACCEPTED';
  exception when sqlstate '23514' then null;
  end;
  update public.project_work_boq_norm_component_estimates set estimated_qty = 60
    where id = 'task7-est';
  perform set_config('request.jwt.claims','{"email":"project-v2-task7-reviewer@example.invalid"}',true);
  begin
    perform public.approve_project_v2_plan_v1(v_plan_id,2,'task7-stale-approve');
    raise exception 'TASK7_STALE_NORM_APPROVED';
  exception when sqlstate '40001' then null;
  end;
end $$;
rollback;

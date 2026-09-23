-- Rollback-only Cloud preview smoke for mixed MR and material-plan PO.
-- G5 rollback-only smoke. Run only on a disposable Supabase Cloud branch after
-- G2, W2 and both G5 migrations have been applied.
begin;

create temp table g5_ids (
  actor_id uuid not null,
  position_id uuid not null,
  project_id text not null,
  site_id text not null,
  warehouse_id text not null,
  request_id text not null,
  item_id text not null,
  po_id text not null,
  po_line_id text not null,
  command_id uuid not null
) on commit drop;
insert into g5_ids values (
  gen_random_uuid(), gen_random_uuid(), 'g5-project-' || gen_random_uuid()::text,
  gen_random_uuid()::text, 'g5-wh-' || gen_random_uuid()::text,
  'g5-mr-' || gen_random_uuid()::text, 'g5-item-' || gen_random_uuid()::text,
  'g5-po-' || gen_random_uuid()::text, 'g5-po-line-' || gen_random_uuid()::text,
  gen_random_uuid()
);
alter table g5_ids add column request_code text;
update g5_ids set request_code = 'MR-G11-' || left(md5(request_id), 12);

insert into public.users(id, name, email, username, role, is_active, account_status)
select actor_id, 'G5 Buyer', actor_id::text || '@vioo.local',
  'g5-' || actor_id::text, 'ADMIN'::public.user_role, true, 'ACTIVE'
from g5_ids;
insert into public.hrm_positions(id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'G5 buyer position', 1,
  'G5-' || substring(md5(position_id::text), 1, 10), true, 0, 'smoke', '{}'::jsonb
from g5_ids;
insert into public.project_permission_rooms(
  code, group_code, name, allowed_actions, required_actions, sort_order
) values
  ('material_request', 'material', 'Material request', array['view','edit'], array['view'], 1),
  ('material_po', 'material', 'Material purchase order', array['view','edit'], array['view'], 2)
on conflict (code) do nothing;
insert into app_private.project_permission_room_action_bindings(
  room_code, action_code, enforcement_status, relationship_description,
  verified_at, verified_source, pbac_fallback_enabled, prerequisite_action_codes
) values
  ('material_request', 'view', 'enforced', 'G5 demand read', now(), 'g5_smoke', false, '{}'),
  ('material_po', 'view', 'enforced', 'G5 price read', now(), 'g5_smoke', false, '{}'),
  ('material_po', 'edit', 'enforced', 'G5 allocation command', now(), 'g5_smoke', false, array['view'])
on conflict (room_code, action_code) do update set
  enforcement_status = excluded.enforcement_status,
  prerequisite_action_codes = excluded.prerequisite_action_codes;
insert into public.projects(id, code, name)
select project_id, 'G5-' || substring(md5(project_id), 1, 10), 'G5 Workbench Project' from g5_ids;
insert into public.hrm_construction_sites(id, name)
select site_id::uuid, 'G5 Construction Site' from g5_ids;
update public.projects project set construction_site_id = ids.site_id::uuid
from g5_ids ids where project.id = ids.project_id;
insert into public.project_staff(
  id, project_id, construction_site_id, user_id, position_id, start_date, note
)
select gen_random_uuid(), project_id, site_id, actor_id::text, position_id,
  current_date, 'G5 workbench smoke buyer'
from g5_ids;
insert into public.project_permission_room_members(
  project_id, construction_site_id, room_code, project_staff_id, is_active
)
select ids.project_id, ids.site_id, room.code, staff.id, true
from g5_ids ids
join public.project_staff staff
  on staff.project_id = ids.project_id and staff.user_id = ids.actor_id::text
cross join (values ('material_request'), ('material_po')) room(code);
insert into public.project_permission_room_member_actions(room_member_id, action_code, is_active)
select member.id, action.code, true
from g5_ids ids
join public.project_permission_room_members member on member.project_id = ids.project_id
cross join lateral (
  select code from (values ('view'), ('edit')) actions(code)
  where code = 'view' or member.room_code = 'material_po'
) action;
insert into public.warehouse_types(code, name) values ('G5_TEST', 'G5 test warehouse')
on conflict (code) do nothing;
insert into public.warehouses(id, name, address, type, project_id, construction_site_id)
select warehouse_id, 'G5 Warehouse', 'Test', 'G5_TEST', project_id, site_id::uuid
from g5_ids;
insert into public.items(id, sku, name, category, unit, price_in, price_out, min_stock)
select item_id, 'G5-' || substring(md5(item_id), 1, 10), 'G5 Steel', 'Smoke', 'kg', 10, 10, 0
from g5_ids;

alter table public.requests disable trigger trg_enforce_material_request_code_v1;
insert into public.requests(
  id, code, title, site_warehouse_id, requester_id, status, items,
  created_date, expected_date, project_id, construction_site_id,
  request_origin, workflow_step
)
select request_id, request_code, 'G5 demand', warehouse_id, actor_id, 'DRAFT',
  jsonb_build_array(jsonb_build_object(
    'lineId', 'need-a', 'itemId', item_id, 'requestQty', 100,
    'unitSnapshot', 'kg', 'itemNameSnapshot', 'G5 Steel',
    'neededDate', (current_date + 7)::text
  )), now(), now(), project_id, site_id, 'project', 'draft'
from g5_ids;
select set_config('app.material_transition_context', 'on', true);
update public.requests set status = 'APPROVED', workflow_step = 'batch_planning'
where id = (select request_id from g5_ids);
select set_config('app.material_transition_context', '', true);

alter table public.purchase_orders disable trigger trg_enforce_purchase_order_number_v2;
grant select on table g5_ids to authenticated;
set role authenticated;
select set_config('request.jwt.claim.email', actor_id::text || '@vioo.local', true) from g5_ids;
select set_config('request.jwt.claim.sub', actor_id::text, true) from g5_ids;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', actor_id::text || '@vioo.local', 'sub', actor_id, 'role', 'authenticated'
)::text, true) from g5_ids;

do $$
begin
  begin
    perform public.create_procurement_purchase_order_v1(
      '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, gen_random_uuid(), gen_random_uuid()
    );
    raise exception 'G5 actor spoof was not rejected';
  exception when insufficient_privilege then
    if sqlerrm <> 'PROCUREMENT_PURCHASE_ORDER_ACTOR_INVALID' then raise; end if;
  end;
end $$;

select public.sync_project_material_request_demand_v1(
  request_id, 1, 'g11-sync-' || request_id
) from g5_ids;

reset role;
create temp table g11_plan on commit drop as
select gen_random_uuid() document_id, gen_random_uuid() revision_id,
  gen_random_uuid() registry_id, gen_random_uuid() demand_id,
  gen_random_uuid() line_id, gen_random_uuid() plan_id;
insert into public.procurement_source_documents(id,owner_context_id,source_adapter,
  source_document_id,source_code_snapshot,project_id,construction_site_id,current_revision,source_hash)
select plan.document_id,'00000000-0000-4000-8000-000000000001','material_plan',
  plan.plan_id::text,'VT-G11',ids.project_id,ids.site_id,1,repeat('a',64)
from g11_plan plan cross join g5_ids ids;
insert into public.procurement_source_revisions(id,source_document_id,revision,source_hash,payload)
select revision_id,document_id,1,repeat('a',64),'{}'::jsonb from g11_plan;
insert into public.procurement_source_line_registry(id,source_document_id,source_line_id,
  item_id,unit,source_hash,first_revision,last_revision)
select plan.registry_id,plan.document_id,'plan-line',ids.item_id,'kg',repeat('b',64),1,1
from g11_plan plan cross join g5_ids ids;
insert into public.procurement_demands(id,owner_context_id,source_document_id,
  current_source_revision_id,project_id,construction_site_id,source_code_snapshot,
  intake_state,health_state,created_by,updated_by)
select plan.demand_id,'00000000-0000-4000-8000-000000000001',
  plan.document_id,plan.revision_id,ids.project_id,ids.site_id,'VT-G11',
  'ready','healthy',ids.actor_id,ids.actor_id
from g11_plan plan cross join g5_ids ids;
insert into public.procurement_demand_lines(id,demand_id,source_line_registry_id,
  current_source_revision_id,item_id,unit,requested_qty,approved_qty,intake_state,health_state)
select plan.line_id,plan.demand_id,plan.registry_id,plan.revision_id,
  ids.item_id,'kg',100,100,'ready','healthy'
from g11_plan plan cross join g5_ids ids;
create temp table g11_mr on commit drop as
select line.id,line.current_source_revision_id,line.version
from public.procurement_demand_lines line
join public.procurement_demands demand on demand.id=line.demand_id
join public.procurement_source_documents source on source.id=demand.source_document_id
cross join g5_ids ids where demand.project_id=ids.project_id
  and source.source_adapter='project_material_request';
create temp table g11_results (first_po text, third_po text, plan_line_id uuid,
  first_outcome text, replay_outcome text, second_outcome text) on commit drop;
grant select on table g11_plan to authenticated;
grant select on table g11_mr to authenticated;
grant insert on table g11_results to authenticated;
alter table public.purchase_orders disable trigger trg_enforce_purchase_order_number_v2;
set role authenticated;
select set_config('request.jwt.claim.email', actor_id::text || '@vioo.local', true) from g5_ids;
select set_config('request.jwt.claim.sub', actor_id::text, true) from g5_ids;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', actor_id::text || '@vioo.local', 'sub', actor_id, 'role', 'authenticated'
)::text, true) from g5_ids;

do $$
declare
  ids g5_ids%rowtype := (select t from g5_ids t);
  plan g11_plan%rowtype := (select t from g11_plan t);
  mr record;
  po jsonb;
  links jsonb;
  allocations jsonb;
  result jsonb;
  candidates jsonb;
  first_po text := 'g11-mixed-' || gen_random_uuid()::text;
  second_po text := 'g11-plan-' || gen_random_uuid()::text;
  third_po text := 'g11-over-' || gen_random_uuid()::text;
  line_mr text := 'g11-line-mr-' || gen_random_uuid()::text;
  line_plan text := 'g11-line-plan-' || gen_random_uuid()::text;
begin
  select * into strict mr from g11_mr;
  candidates := public.get_procurement_purchase_candidates_v1(plan.demand_id);
  if jsonb_array_length(candidates -> 'lines') <> 1
     or jsonb_typeof(candidates #> '{lines,0,conversionNumerator}') <> 'string'
     or candidates #>> '{lines,0,availableQty}' <> '100.000000' then
    raise exception 'G11_CANDIDATE_IDENTITY_OR_BALANCE_INVALID: %', candidates;
  end if;
  po := jsonb_build_object('id',first_po,'project_id',ids.project_id,
    'construction_site_id',ids.site_id,'vendor_id','g11-vendor','vendor_name','G11 vendor',
    'po_number','PO-G11-MIXED','order_date',current_date::text,
    'expected_delivery_date',(current_date+7)::text,'status','draft',
    'source_mode','company_consolidated','purchase_mode','single',
    'created_by_id',ids.actor_id,'target_warehouse_id',ids.warehouse_id,
    'total_amount',400,
    'items',jsonb_build_array(
      jsonb_build_object('lineId',line_mr,'itemId',ids.item_id,'name','G11 Steel',
        'unit','kg','stockUnitSnapshot','kg','purchaseUnitSnapshot','kg',
        'purchaseConversionFactor',1,'qty',20,'unitPrice',10),
      jsonb_build_object('lineId',line_plan,'itemId',ids.item_id,'name','G11 Steel',
        'unit','kg','stockUnitSnapshot','kg','purchaseUnitSnapshot','kg',
        'purchaseConversionFactor',1,'qty',20,'unitPrice',10)));
  links := jsonb_build_array(jsonb_build_object('project_id',ids.project_id,
    'construction_site_id',ids.site_id,'source_construction_site_id',ids.site_id,
    'target_warehouse_id',ids.warehouse_id,'allocation_status','open',
    'purchase_order_id',first_po,'purchase_order_line_id',line_mr,
    'material_request_id',ids.request_id,'material_request_code',ids.request_code,
    'request_line_id','need-a','item_id',ids.item_id,'requested_qty',100,
    'ordered_qty',20,'requested_qty_snapshot',100,'ordered_stock_qty_snapshot',20,
    'actual_received_qty_snapshot',0,'unit','kg'));
  allocations := jsonb_build_array(
    jsonb_build_object('demandLineId',mr.id,'sourceRevisionId',mr.current_source_revision_id,
      'purchaseOrderLineId',line_mr,'expectedVersion',mr.version,'needQty',20,
      'needUnit','kg','executionQty',20,'executionUnit','kg',
      'conversionNumerator',1,'conversionDenominator',1,'reason','G11 MR'),
    jsonb_build_object('demandLineId',plan.line_id,'sourceRevisionId',plan.revision_id,
      'purchaseOrderLineId',line_plan,'expectedVersion',1,'needQty',20,
      'needUnit','kg','executionQty',20,'executionUnit','kg',
      'conversionNumerator',1,'conversionDenominator',1,'reason','G11 plan'));
  result := public.create_procurement_purchase_order_v1(po,links,allocations,
    ids.actor_id,ids.command_id);
  if result ->> 'outcome' <> 'committed'
     or jsonb_array_length(result -> 'allocationIds') <> 2
     then
    raise exception 'G11_MIXED_LINEAGE_INVALID: %',result;
  end if;
  result := public.create_procurement_purchase_order_v1(
    jsonb_set(po,'{id}',to_jsonb(first_po || '-retry')),links,allocations,
    ids.actor_id,ids.command_id);
  if result ->> 'outcome' <> 'replayed' or result ->> 'purchaseOrderId' <> first_po then
    raise exception 'G11_RETRY_NOT_SAME_PO: %',result;
  end if;
  po := jsonb_set(po,'{id}',to_jsonb(second_po));
  po := jsonb_set(po,'{po_number}',to_jsonb('PO-G11-SECOND'::text));
  po := jsonb_set(po,'{items}',jsonb_build_array(jsonb_build_object(
    'lineId',line_plan || '-second','itemId',ids.item_id,'name','G11 Steel',
    'unit','kg','stockUnitSnapshot','kg','purchaseUnitSnapshot','kg',
    'purchaseConversionFactor',1,'qty',60,'unitPrice',10)));
  po := jsonb_set(po,'{total_amount}','600'::jsonb);
  allocations := jsonb_build_array(jsonb_build_object('demandLineId',plan.line_id,
    'sourceRevisionId',plan.revision_id,'purchaseOrderLineId',line_plan || '-second',
    'expectedVersion',((public.get_procurement_purchase_candidates_v1(plan.demand_id)
      #>> '{lines,0,expectedVersion}')::bigint),
    'needQty',60,'needUnit','kg','executionQty',60,'executionUnit','kg',
    'conversionNumerator',1,'conversionDenominator',1,'reason','G11 remaining'));
  result := public.create_procurement_purchase_order_v1(po,'[]'::jsonb,allocations,
    ids.actor_id,gen_random_uuid());
  if result ->> 'outcome' <> 'committed' then raise exception 'G11_SECOND_PO_INVALID'; end if;
  po := jsonb_set(po,'{id}',to_jsonb(third_po));
  po := jsonb_set(po,'{po_number}',to_jsonb('PO-G11-OVER'::text));
  po := jsonb_set(po,'{items}',jsonb_build_array(jsonb_build_object(
    'lineId',line_plan || '-over','itemId',ids.item_id,'name','G11 Steel',
    'unit','kg','stockUnitSnapshot','kg','purchaseUnitSnapshot','kg',
    'purchaseConversionFactor',1,'qty',60,'unitPrice',10)));
  allocations := jsonb_set(allocations,'{0,purchaseOrderLineId}',to_jsonb(line_plan || '-over'));
  allocations := jsonb_set(allocations,'{0,expectedVersion}',to_jsonb(
    ((public.get_procurement_purchase_candidates_v1(plan.demand_id)
      #>> '{lines,0,expectedVersion}')::bigint)));
  begin
    perform public.create_procurement_purchase_order_v1(po,'[]'::jsonb,allocations,
      ids.actor_id,gen_random_uuid());
    raise exception 'G11_OVER_ALLOCATION_ACCEPTED';
  exception when sqlstate '40001' then
    if sqlerrm <> 'PROCUREMENT_AVAILABLE_EXCEEDED' then raise; end if;
  end;
  insert into g11_results values(first_po,third_po,plan.line_id,
    'committed','replayed',result ->> 'outcome');
end $$;
reset role;
do $$ declare r g11_results%rowtype := (select t from g11_results t);
begin
  if (select count(*) from public.purchase_order_request_lines where purchase_order_id=r.first_po)<>1
    or exists(select 1 from public.purchase_orders where id=r.third_po)
    or (select count(*) from public.procurement_supply_allocations
      where demand_line_id=r.plan_line_id and state='committed')<>2 then
    raise exception 'G11_MIXED_LINEAGE_OR_ROLLBACK_FAILED';
  end if;
end $$;
rollback;

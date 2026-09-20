-- Requires the G2 identity and demand migrations. Run on the approved preview
-- branch inside an outer transaction and always roll it back.

alter table public.requests disable trigger trg_enforce_material_request_code_v1;
insert into public.users(id, name, email, username, role)
values ('22222222-2222-4222-8222-222222222222', 'G2 Intake Actor', 'g2-intake@example.invalid', 'g2-intake', 'ADMIN');
insert into public.projects(id, code, name) values ('g2-demand-project', 'G2D', 'G2 Demand Project');
insert into public.warehouse_types(code, name) values ('G2_DEMAND', 'G2 demand warehouse');
insert into public.warehouses(id, name, address, type)
values ('g2-demand-warehouse', 'G2 Demand Warehouse', 'Test', 'G2_DEMAND');
select set_config('request.jwt.claims', '{"email":"g2-intake@example.invalid"}', true);

insert into public.requests(
  id, code, title, site_warehouse_id, requester_id, status, items,
  created_date, expected_date, project_id, construction_site_id,
  request_origin, workflow_step
) values (
  'g2-demand-mr', 'MR-2026-9998', 'G2 demand', 'g2-demand-warehouse',
  '22222222-2222-4222-8222-222222222222', 'DRAFT',
  '[{"lineId":"line-a","itemId":"item-a","requestQty":100,"unitSnapshot":"kg"}]',
  now(), now(), 'g2-demand-project', 'g2-demand-site', 'project', 'draft'
);

select set_config('app.material_transition_context', 'on', true);
update public.requests set status = 'APPROVED', workflow_step = 'batch_planning' where id = 'g2-demand-mr';
select set_config('app.material_transition_context', '', true);

create temporary table g2_first_result on commit drop as
select public.sync_project_material_request_demand_v1('g2-demand-mr', 1, 'g2-sync-1') result;

do $$
begin
  if not exists (
    select 1 from public.procurement_demands demand
    join public.procurement_demand_lines line on line.demand_id = demand.id
    where demand.intake_state = 'ready' and demand.version = 1
      and line.requested_qty = 100 and line.approved_qty = 100
  ) then raise exception 'G2_T3_INITIAL_INTAKE_FAILED'; end if;
end $$;

update public.requests
set items = '[{"lineId":"line-a","itemId":"item-a","requestQty":150,"unitSnapshot":"kg"}]'
where id = 'g2-demand-mr';
select set_config('app.material_transition_context', 'on', true);
update public.requests set status = 'PENDING', workflow_step = 'material_department_review' where id = 'g2-demand-mr';
update public.requests set status = 'APPROVED', workflow_step = 'batch_planning' where id = 'g2-demand-mr';
select set_config('app.material_transition_context', '', true);

create temporary table g2_changed_result on commit drop as
select public.sync_project_material_request_demand_v1('g2-demand-mr', 2, 'g2-sync-2') result;

do $$
begin
  if not exists (
    select 1 from public.procurement_demands demand
    join public.procurement_demand_lines line on line.demand_id = demand.id
    where demand.intake_state = 'source_changed' and demand.version = 2
      and line.requested_qty = 150 and line.approved_qty = 150
  ) then raise exception 'G2_T3_SOURCE_CHANGED_FAILED'; end if;
end $$;

create temporary table g2_resolved_result on commit drop as
select public.resolve_procurement_source_change_v1(
  (select id from public.procurement_demands limit 1), 2,
  'accept_current_revision', 'Reviewed revision 2', 'g2-resolve-1'
) result;

do $$
declare v_replay jsonb;
begin
  if not exists (
    select 1 from public.procurement_demands where intake_state = 'ready' and version = 3
  ) then raise exception 'G2_T3_DISPOSITION_FAILED'; end if;

  select public.resolve_procurement_source_change_v1(
    (select id from public.procurement_demands limit 1), 2,
    'accept_current_revision', 'Reviewed revision 2', 'g2-resolve-1'
  ) into v_replay;
  if v_replay ->> 'outcome' <> 'replayed' then raise exception 'G2_T3_REPLAY_FAILED'; end if;

  begin
    perform public.sync_project_material_request_demand_v1('g2-demand-mr', 2, 'g2-sync-1');
    raise exception 'G2_T3_IDEMPOTENCY_CONFLICT_NOT_RAISED';
  exception when sqlstate '40001' then
    if sqlerrm <> 'PROCUREMENT_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
end $$;

-- Requires the G2 identity, demand and allocation migrations. Run on the
-- approved preview branch inside an outer transaction and always roll it back.

alter table public.requests disable trigger trg_enforce_material_request_code_v1;
insert into public.users(id, name, email, username, role)
values ('33333333-3333-4333-8333-333333333333', 'G2 Allocation Actor', 'g2-allocation@example.invalid', 'g2-allocation', 'ADMIN');
insert into public.projects(id, code, name) values ('g2-allocation-project', 'G2A', 'G2 Allocation Project');
insert into public.warehouse_types(code, name) values ('G2_ALLOCATION', 'G2 allocation warehouse');
insert into public.warehouses(id, name, address, type)
values ('g2-allocation-warehouse', 'G2 Allocation Warehouse', 'Test', 'G2_ALLOCATION');
select set_config('request.jwt.claims', '{"email":"g2-allocation@example.invalid"}', true);

insert into public.requests(
  id, code, title, site_warehouse_id, requester_id, status, items,
  created_date, expected_date, project_id, construction_site_id,
  request_origin, workflow_step
) values (
  'g2-allocation-mr', 'MR-2026-9997', 'G2 allocation', 'g2-allocation-warehouse',
  '33333333-3333-4333-8333-333333333333', 'DRAFT',
  '[{"lineId":"need-a","itemId":"item-a","requestQty":100,"unitSnapshot":"kg"}]',
  now(), now(), 'g2-allocation-project', 'g2-allocation-site', 'project', 'draft'
);
select set_config('app.material_transition_context', 'on', true);
update public.requests set status = 'APPROVED', workflow_step = 'batch_planning'
where id = 'g2-allocation-mr';
select set_config('app.material_transition_context', '', true);
select public.sync_project_material_request_demand_v1('g2-allocation-mr', 1, 'g2-allocation-sync');

alter table public.purchase_orders disable trigger trg_enforce_purchase_order_number_v2;
insert into public.purchase_orders(
  id, vendor_id, vendor_name, po_number, items, total_amount, order_date,
  status, project_id, construction_site_id, source_mode
) values (
  'g2-allocation-po', 'vendor-a', 'Vendor A', 'PO-999997',
  '[{"lineId":"po-line-a","itemId":"item-a","qty":100,"unit":"kg","purchaseUnitSnapshot":"kg"}]',
  100, current_date::text, 'confirmed', 'g2-allocation-project', 'g2-allocation-site', 'from_request'
);

create temporary table g2_allocation_result on commit drop as
select public.save_procurement_allocation_v1(
  (select id from public.procurement_demand_lines limit 1),
  (select current_source_revision_id from public.procurement_demand_lines limit 1),
  (select registry.id from public.procurement_source_line_registry registry
    join public.procurement_source_documents document on document.id = registry.source_document_id
    where document.source_adapter = 'purchase_order' and document.source_document_id = 'g2-allocation-po'),
  'po', 'committed', 0, 60, 'kg', 60, 'kg', 1, 1, 1,
  'Committed PO quantity', 'g2-allocation-save-1'
) result;

do $$
declare v_replay jsonb;
begin
  if not exists (
    select 1 from public.procurement_supply_allocations
    where committed_need_qty = 60 and source_revision_id =
      (select current_source_revision_id from public.procurement_demand_lines limit 1)
  ) then raise exception 'G2_T4_ALLOCATION_NOT_SAVED'; end if;

  select public.save_procurement_allocation_v1(
    (select id from public.procurement_demand_lines limit 1),
    (select current_source_revision_id from public.procurement_demand_lines limit 1),
    (select registry.id from public.procurement_source_line_registry registry
      join public.procurement_source_documents document on document.id = registry.source_document_id
      where document.source_adapter = 'purchase_order' and document.source_document_id = 'g2-allocation-po'),
    'po', 'committed', 0, 60, 'kg', 60, 'kg', 1, 1, 1,
    'Committed PO quantity', 'g2-allocation-save-1'
  ) into v_replay;
  if v_replay ->> 'outcome' <> 'replayed' then raise exception 'G2_T4_REPLAY_FAILED'; end if;

  begin
    perform public.save_procurement_allocation_v1(
      (select id from public.procurement_demand_lines limit 1),
      (select current_source_revision_id from public.procurement_demand_lines limit 1),
      (select registry.id from public.procurement_source_line_registry registry
        join public.procurement_source_documents document on document.id = registry.source_document_id
        where document.source_adapter = 'purchase_order' and document.source_document_id = 'g2-allocation-po'),
      'po', 'committed', 0, 50, 'kg', 50, 'kg', 1, 1, 2,
      'Must exceed remaining forty', 'g2-allocation-save-2'
    );
    raise exception 'G2_T4_OVER_ALLOCATION_NOT_REJECTED';
  exception when sqlstate '40001' then
    if sqlerrm <> 'PROCUREMENT_AVAILABLE_EXCEEDED' then raise; end if;
  end;
end $$;

select app_private.register_procurement_effect_v1(
  'receipt:g2:line-1', 'g2_smoke', 'receipt-1', 'receipt-line-1',
  'g2-allocation-project', 'g2-allocation-site', 'item-a', 'kg',
  'receipt', 30, null, 'allocation_missing', '{"test":true}'::jsonb
);

select public.record_procurement_fulfillment_attribution_v1(
  (select id from public.procurement_supply_allocations limit 1),
  (select current_source_revision_id from public.procurement_demand_lines limit 1),
  'receipt:g2:line-1', 'receipt', 30, 'kg', null, 2, 'g2-attribution-1'
);

select app_private.register_procurement_effect_v1(
  'legacy:g2:id-only', 'legacy_id_list', 'legacy-doc-1', null,
  'g2-allocation-project', 'g2-allocation-site', null, null,
  'receipt', 5, null, 'legacy_identity_missing', '{"source":"id_only"}'::jsonb
);

do $$
declare v_fulfilled numeric; v_open_commitment numeric; v_available numeric; v_queue jsonb;
begin
  select coalesce(sum(quantity), 0) into v_fulfilled
  from public.procurement_fulfillment_attributions;
  select coalesce(sum(greatest(0, allocation.committed_need_qty - coalesce(attributed.net_qty, 0))), 0)
  into v_open_commitment
  from public.procurement_supply_allocations allocation
  left join lateral (
    select sum(quantity) net_qty from public.procurement_fulfillment_attributions
    where allocation_id = allocation.id
  ) attributed on true
  where allocation.state = 'committed';
  v_available := 100 - v_fulfilled - v_open_commitment;
  if v_fulfilled <> 30 or v_open_commitment <> 30 or v_available <> 40 then
    raise exception 'G2_T4_BALANCE_FAILED F=% M=% R=%', v_fulfilled, v_open_commitment, v_available;
  end if;

  select public.list_procurement_unallocated_v1('g2-allocation-project', 'g2-allocation-site') into v_queue;
  if jsonb_array_length(v_queue) <> 1
     or v_queue -> 0 ->> 'reasonCode' <> 'legacy_identity_missing' then
    raise exception 'G2_T4_UNALLOCATED_QUEUE_FAILED';
  end if;
end $$;

-- Run only on a disposable with-data Supabase Cloud preview as postgres.
-- Fixture workspace and user are rolled back.
begin;

create temp table project_v2_boq_ids on commit drop as
with candidate as (
  select b.project_id, b.inventory_item_id, i.unit,
    sum(b.budget_qty)::numeric(20,6) boq_quantity
  from public.material_budget_items b
  join public.items i on i.id = b.inventory_item_id
  where b.budget_qty > 0 and lower(btrim(b.unit)) = lower(btrim(i.unit))
    and not exists (
      select 1 from public.inventory_ledger_entries e
      join public.warehouses w on w.id = e.warehouse_id
      where e.material_id = b.inventory_item_id and w.type = 'SITE'
        and w.project_id = b.project_id
    )
    and exists (
      select 1 from public.material_budget_items other_b
      join public.inventory_ledger_entries e on e.material_id = other_b.inventory_item_id
      join public.warehouses w on w.id = e.warehouse_id
      where other_b.project_id = b.project_id
        and other_b.inventory_item_id <> b.inventory_item_id
        and w.type = 'SITE' and w.project_id = b.project_id
    )
    and exists (
      select 1 from public.inventory_ledger_entries returned
      join public.warehouses w on w.id = returned.warehouse_id
      where returned.project_id = b.project_id and w.project_id = b.project_id
        and w.type = 'SITE' and returned.business_event_type = 'supplier_return'
    )
  group by b.project_id, b.inventory_item_id, i.unit
  having count(distinct lower(btrim(b.unit))) = 1
    and count(distinct b.source_type) = 1
  order by count(*) desc
  limit 1
)
select candidate.*, gen_random_uuid() workspace_id, gen_random_uuid() admin_id
from candidate;

do $$ begin
  if not exists (select 1 from project_v2_boq_ids) then
    raise exception 'BOQ_SMOKE_SAMPLE_MISSING';
  end if;
  if has_function_privilege('anon',
      'public.list_project_v2_material_boq_positions_v1(uuid,text[])', 'execute') then
    raise exception 'BOQ_READER_ANON_EXECUTE_LEAK';
  end if;
end $$;

insert into public.users(id, name, email, username, role)
select admin_id, 'Project V2 BOQ preview',
  'project-v2-boq-preview-' || left(admin_id::text, 8) || '@example.invalid',
  'project-v2-boq-' || left(admin_id::text, 8), 'ADMIN'
from project_v2_boq_ids;
insert into public.project_v2_workspaces(id, project_id, enrolled_by)
select workspace_id, project_id, admin_id from project_v2_boq_ids;

create temp table project_v2_boq_received on commit drop as
select b.inventory_item_id
from public.material_budget_items b
join public.items i on i.id = b.inventory_item_id
where b.project_id = (select project_id from project_v2_boq_ids)
  and b.inventory_item_id <> (select inventory_item_id from project_v2_boq_ids)
  and b.budget_qty > 0 and lower(btrim(b.unit)) = lower(btrim(i.unit))
  and exists (
    select 1 from public.inventory_ledger_entries e
    join public.warehouses w on w.id = e.warehouse_id
    where e.material_id = b.inventory_item_id and w.type = 'SITE'
      and w.project_id = b.project_id
  )
group by b.inventory_item_id
having count(distinct lower(btrim(b.unit))) = 1
  and count(distinct b.source_type) = 1
limit 1;

create temp table project_v2_boq_return on commit drop as
with returned as (
  select e.project_id, e.material_id inventory_item_id,
    sum(e.quantity_out)::numeric(20,6) supplier_returns
  from public.inventory_ledger_entries e
  join public.warehouses w on w.id = e.warehouse_id
  where e.project_id = (select project_id from project_v2_boq_ids)
    and w.type = 'SITE' and w.project_id = e.project_id
    and e.business_event_type = 'supplier_return'
    and exists (
      select 1 from public.material_budget_items b
      where b.project_id = e.project_id and b.inventory_item_id = e.material_id
    )
  group by e.project_id, e.material_id
)
select returned.inventory_item_id, returned.supplier_returns,
  (select coalesce(sum(entry.quantity_in), 0)::numeric(20,6)
   from public.inventory_ledger_entries entry
   join public.warehouses site_warehouse on site_warehouse.id = entry.warehouse_id
   join public.inventory_transactions tx on tx.id = entry.inventory_transaction_id
   left join public.warehouses source_warehouse on source_warehouse.id = tx.metadata ->> 'sourceWarehouseId'
   where entry.material_id = returned.inventory_item_id
     and site_warehouse.type = 'SITE' and site_warehouse.project_id = returned.project_id
     and entry.movement_direction = 'in'
     and (entry.business_event_type in (
       'request_po_receipt', 'proactive_po_receipt', 'site_hot_purchase_receipt',
       'direct_supplier_receipt', 'direct_manual_receipt', 'legacy_direct_receipt'
     ) or entry.business_event_type = 'warehouse_transfer'
       and (source_warehouse.type = 'GENERAL'
         or source_warehouse.type = 'SITE'
           and source_warehouse.project_id is distinct from returned.project_id))) gross_site_receipts
from returned
order by returned.supplier_returns desc
limit 1;

create temp table project_v2_boq_mixed on commit drop as
select b.inventory_item_id
from public.material_budget_items b
where b.project_id = (select project_id from project_v2_boq_ids)
group by b.inventory_item_id
having count(distinct lower(btrim(b.unit))) > 1
  or count(distinct b.source_type) > 1
limit 1;

create temp table project_v2_boq_outside on commit drop as
select i.id inventory_item_id
from public.items i
where not exists (
  select 1 from public.material_budget_items b
  where b.project_id = (select project_id from project_v2_boq_ids)
    and b.inventory_item_id = i.id
)
limit 1;

grant select on project_v2_boq_ids to authenticated;
grant select on project_v2_boq_received to authenticated;
grant select on project_v2_boq_return to authenticated;
grant select on project_v2_boq_mixed to authenticated;
grant select on project_v2_boq_outside to authenticated;
set local role authenticated;

do $$
declare
  v_ids record;
  v_payload jsonb;
  v_row jsonb;
  v_received_item text;
  v_return_item text;
  v_supplier_returns numeric;
  v_gross_receipts numeric;
  v_mixed_item text;
  v_outside_item text;
begin
  select * into v_ids from project_v2_boq_ids;
  perform set_config('request.jwt.claims', jsonb_build_object('email',
    'project-v2-boq-preview-' || left(v_ids.admin_id::text, 8) || '@example.invalid')::text, true);
  v_payload := public.list_project_v2_material_boq_positions_v1(
    v_ids.workspace_id, array[v_ids.inventory_item_id]);
  v_row := v_payload -> 'items' -> 0;
  if v_row ->> 'itemId' is distinct from v_ids.inventory_item_id
    or v_row ->> 'state' is distinct from 'known'
    or (v_row ->> 'boqQuantity')::numeric is distinct from v_ids.boq_quantity
    or (v_row ->> 'receivedQuantity')::numeric is distinct from 0
    or (v_row ->> 'remainingQuantity')::numeric is distinct from v_ids.boq_quantity
    or v_row ->> 'pendingQuantity' is not null then
    raise exception 'BOQ_READER_KNOWN_POSITION_INVALID: %', v_row;
  end if;

  select inventory_item_id into v_received_item from project_v2_boq_received;
  if v_received_item is null then raise exception 'BOQ_READER_RECEIPT_SAMPLE_MISSING'; end if;
  v_row := public.list_project_v2_material_boq_positions_v1(
    v_ids.workspace_id, array[v_received_item]) -> 'items' -> 0;
  if v_row ->> 'state' is distinct from 'known'
    or (v_row ->> 'receivedQuantity')::numeric <= 0
    or (v_row ->> 'remainingQuantity')::numeric is distinct from
      (v_row ->> 'boqQuantity')::numeric - (v_row ->> 'receivedQuantity')::numeric then
    raise exception 'BOQ_READER_RECEIPT_POSITION_INVALID: %', v_row;
  end if;

  select inventory_item_id, supplier_returns, gross_site_receipts
    into v_return_item, v_supplier_returns, v_gross_receipts
  from project_v2_boq_return;
  if v_return_item is null or v_supplier_returns <= 0 then
    raise exception 'BOQ_READER_RETURN_SAMPLE_MISSING';
  end if;
  v_row := public.list_project_v2_material_boq_positions_v1(
    v_ids.workspace_id, array[v_return_item]) -> 'items' -> 0;
  if v_row ->> 'state' is distinct from 'known' then
    raise exception 'BOQ_READER_RETURN_POSITION_UNKNOWN: %', v_row;
  end if;
  if (v_row ->> 'receivedQuantity')::numeric is distinct from
      v_gross_receipts - v_supplier_returns
    or (v_row ->> 'remainingQuantity')::numeric is distinct from
      (v_row ->> 'boqQuantity')::numeric - v_gross_receipts + v_supplier_returns then
    raise exception 'BOQ_READER_RETURN_NET_INVALID: %', v_row;
  end if;

  select inventory_item_id into v_mixed_item from project_v2_boq_mixed;
  if v_mixed_item is null then raise exception 'BOQ_READER_MIXED_SAMPLE_MISSING'; end if;
  v_row := public.list_project_v2_material_boq_positions_v1(
    v_ids.workspace_id, array[v_mixed_item]) -> 'items' -> 0;
  if v_row ->> 'state' is distinct from 'unknown'
    or v_row ->> 'boqQuantity' is not null
    or v_row ->> 'remainingQuantity' is not null then
    raise exception 'BOQ_READER_MIXED_UNIT_FALSE_PRECISION: %', v_row;
  end if;

  select inventory_item_id into v_outside_item from project_v2_boq_outside;
  if v_outside_item is null then raise exception 'BOQ_READER_OUTSIDE_SAMPLE_MISSING'; end if;
  v_row := public.list_project_v2_material_boq_positions_v1(
    v_ids.workspace_id, array[v_outside_item]) -> 'items' -> 0;
  if v_row ->> 'state' is distinct from 'outside_boq'
    or v_row ->> 'boqQuantity' is not null
    or v_row ->> 'remainingQuantity' is not null then
    raise exception 'BOQ_READER_OUTSIDE_POSITION_INVALID: %', v_row;
  end if;

  perform set_config('request.jwt.claims', '{"email":"outside-boq-preview@example.invalid"}', true);
  begin
    perform public.list_project_v2_material_boq_positions_v1(
      v_ids.workspace_id, array[v_ids.inventory_item_id]);
    raise exception 'BOQ_READER_OUT_OF_SCOPE_ACTOR_ACCEPTED';
  exception when sqlstate '42501' then null;
  end;
end $$;

rollback;

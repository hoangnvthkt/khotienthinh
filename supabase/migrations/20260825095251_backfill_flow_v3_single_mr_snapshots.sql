-- Restore the MR demand snapshot for flow-v3 POs created during the rollout
-- window before the parent snapshot was written for single-delivery orders.
-- This is reference data only: no delivery, receipt, WMS, stock, or payable
-- records are created or changed here.
with affected_orders as (
  select po.id, po.items
  from public.purchase_orders po
  where po.procurement_flow_version = 3
    and po.source_mode = 'from_request'
    and jsonb_typeof(coalesce(po.items, '[]'::jsonb)) = 'array'
    and exists (
      select 1
      from jsonb_array_elements(po.items) as item(value)
      where not (item.value ? 'requestedQtySnapshot')
         or nullif(item.value ->> 'requestedQtySnapshot', '') is null
         or not (item.value ? 'requestedUnitSnapshot')
         or nullif(item.value ->> 'requestedUnitSnapshot', '') is null
    )
)
update public.purchase_orders po
set items = rebuilt.items
from affected_orders affected
cross join lateral (
  select jsonb_agg(
    item.value || jsonb_build_object(
      'requestedQtySnapshot', coalesce(
        nullif(item.value ->> 'requestedQtySnapshot', '')::numeric,
        link.requested_qty,
        nullif(item.value ->> 'qty', '')::numeric,
        0
      ),
      'requestedUnitSnapshot', coalesce(
        nullif(item.value ->> 'requestedUnitSnapshot', ''),
        nullif(item.value ->> 'stockUnitSnapshot', ''),
        nullif(item.value ->> 'unitSnapshot', ''),
        link.requested_unit,
        nullif(item.value ->> 'unit', '')
      ),
      'qty', coalesce(
        nullif(item.value ->> 'requestedQtySnapshot', '')::numeric,
        link.requested_qty,
        nullif(item.value ->> 'qty', '')::numeric,
        0
      ),
      'unit', coalesce(
        nullif(item.value ->> 'requestedUnitSnapshot', ''),
        nullif(item.value ->> 'stockUnitSnapshot', ''),
        nullif(item.value ->> 'unitSnapshot', ''),
        link.requested_unit,
        nullif(item.value ->> 'unit', '')
      )
    )
    order by item.ordinality
  ) as items
  from jsonb_array_elements(coalesce(affected.items, '[]'::jsonb)) with ordinality as item(value, ordinality)
  left join lateral (
    select
      sum(coalesce(porl.requested_qty_snapshot, porl.requested_qty, 0)) as requested_qty,
      max(nullif(porl.unit, '')) as requested_unit
    from public.purchase_order_request_lines porl
    where porl.purchase_order_id = affected.id
      and porl.purchase_order_line_id = coalesce(item.value ->> 'lineId', item.value ->> 'itemId')
      and porl.allocation_status <> 'cancelled'
  ) link on true
) rebuilt
where po.id = affected.id;

-- For unapproved, unreceived batches, the allocation against the MR is the
-- stock/request quantity entered on the delivery line. Earlier rows could
-- contain a commercial-unit conversion in ordered_stock_qty_snapshot.
with draft_allocations as (
  select
    porl.id as request_line_link_id,
    sum(coalesce(podl.stock_planned_qty, 0)) as stock_planned_qty
  from public.purchase_order_request_lines porl
  join public.purchase_orders po on po.id = porl.purchase_order_id
  join public.purchase_order_delivery_batches podb on podb.purchase_order_id = po.id
  join public.purchase_order_delivery_lines podl
    on podl.delivery_batch_id = podb.id
   and podl.purchase_order_line_id = porl.purchase_order_line_id
  where po.procurement_flow_version = 3
    and po.source_mode = 'from_request'
    and porl.allocation_status <> 'cancelled'
    and podb.approval_status in ('draft', 'revision_requested', 'rejected')
    and podb.status not in ('cancelled', 'returned')
    and not exists (
      select 1
      from public.purchase_order_receipts receipt
      where receipt.delivery_batch_id = podb.id
    )
  group by porl.id
)
update public.purchase_order_request_lines porl
set ordered_stock_qty_snapshot = draft_allocations.stock_planned_qty
from draft_allocations
where porl.id = draft_allocations.request_line_link_id
  and porl.ordered_stock_qty_snapshot is distinct from draft_allocations.stock_planned_qty;

-- Production regression guard for the PO that exposed the issue. Development
-- and preview databases may not contain this PO, so the check is conditional.
do $$
declare
  v_d16 jsonb;
  v_allocated numeric;
begin
  if exists (select 1 from public.purchase_orders where po_number = 'PO-411') then
    select item.value
    into v_d16
    from public.purchase_orders po
    cross join lateral jsonb_array_elements(po.items) as item(value)
    where po.po_number = 'PO-411'
      and item.value ->> 'sku' = 'VT0000828'
    limit 1;

    select ordered_stock_qty_snapshot
    into v_allocated
    from public.purchase_order_request_lines
    where purchase_order_id = (select id from public.purchase_orders where po_number = 'PO-411' limit 1)
      and purchase_order_line_id = v_d16 ->> 'lineId'
    limit 1;

    if coalesce((v_d16 ->> 'requestedQtySnapshot')::numeric, -1) <> 1187
      or v_d16 ->> 'requestedUnitSnapshot' <> 'Cây'
      or coalesce(v_allocated, -1) <> 1187 then
      raise exception 'PO-411 flow-v3 demand backfill failed';
    end if;
  end if;
end;
$$;

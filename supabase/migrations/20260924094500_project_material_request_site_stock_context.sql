-- Project material request warning: the G6 site-warehouse availability rule,
-- exposed only within the actor's material-request Room scope.
create or replace function public.get_project_material_request_site_stock_context_v1(
  p_project_id text,
  p_construction_site_id text,
  p_warehouse_id text,
  p_item_ids text[]
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  if public.current_app_user_id() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if coalesce(array_length(p_item_ids, 1), 0) > 200 then
    raise exception 'too many stock items requested' using errcode = '22023';
  end if;
  if not app_private.current_actor_has_effective_room_action(
    p_project_id, nullif(p_construction_site_id, ''), 'material_request', 'view_available_stock'
  ) then
    raise exception 'material request stock access denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.warehouses warehouse
    where warehouse.id = p_warehouse_id
      and warehouse.type = 'SITE'
      and warehouse.project_id = p_project_id
      and (nullif(p_construction_site_id, '') is null
        or warehouse.construction_site_id::text = p_construction_site_id)
      and not coalesce(warehouse.is_archived, false)
  ) then
    raise exception 'site warehouse outside project scope' using errcode = '42501';
  end if;

  with requested as (
    select distinct item.id item_id,
      case when item.stock_by_warehouse ? p_warehouse_id
        and item.stock_by_warehouse ->> p_warehouse_id ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (item.stock_by_warehouse ->> p_warehouse_id)::numeric
        else null end cache_qty
    from public.items item
    where item.id = any(coalesce(p_item_ids, array[]::text[]))
  ), ledger as (
    select balance.material_id item_id, sum(balance.on_hand_qty)::numeric on_hand_qty
    from public.inventory_balances balance
    where balance.warehouse_id = p_warehouse_id
      and balance.material_id = any(coalesce(p_item_ids, array[]::text[]))
    group by balance.material_id
  ), reservations as (
    select payload.value ->> 'itemId' item_id,
      sum(coalesce(nullif(payload.value ->> 'quantity', '')::numeric, 0))::numeric reserved_qty
    from public.transactions transaction_row
    cross join lateral jsonb_array_elements(coalesce(transaction_row.items, '[]'::jsonb)) payload(value)
    where transaction_row.source_warehouse_id = p_warehouse_id
      and transaction_row.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
      and transaction_row.type in ('EXPORT'::public.transaction_type, 'TRANSFER'::public.transaction_type, 'LIQUIDATION'::public.transaction_type)
      and not (transaction_row.type = 'TRANSFER'::public.transaction_type
        and exists (select 1 from public.wms_transfer_lines transfer_line where transfer_line.transaction_id = transaction_row.id))
      and payload.value ->> 'itemId' = any(coalesce(p_item_ids, array[]::text[]))
    group by payload.value ->> 'itemId'
  ), transit as (
    select line.item_id, sum(line.dispatched_qty - line.received_qty - line.returned_qty - line.lost_qty)::numeric qty
    from public.wms_transfer_lines line
    join public.transactions transaction_row on transaction_row.id = line.transaction_id
    where transaction_row.target_warehouse_id = p_warehouse_id
      and line.item_id = any(coalesce(p_item_ids, array[]::text[]))
    group by line.item_id
  ), receipt as (
    select line.item_id, sum(coalesce(line.custody_stock_qty, 0))::numeric qty,
      bool_and(line.physical_counted_stock_qty is not null) complete
    from public.purchase_order_delivery_lines line
    join public.purchase_order_delivery_batches batch on batch.id = line.delivery_batch_id
    join public.transactions transaction_row on transaction_row.id = batch.wms_transaction_id
    where transaction_row.target_warehouse_id = p_warehouse_id
      and batch.status <> 'cancelled'
      and line.item_id = any(coalesce(p_item_ids, array[]::text[]))
    group by line.item_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', requested.item_id,
    'availableQty', case
      when coalesce(requested.cache_qty, 0) = coalesce(ledger.on_hand_qty, 0)
       and coalesce(requested.cache_qty, 0) >= 0
       and coalesce(ledger.on_hand_qty, 0) >= 0
       and issue.id is null
       and coalesce(receipt.complete, true)
        then greatest(coalesce(ledger.on_hand_qty, 0) - coalesce(reservations.reserved_qty, 0), 0)
      else null end,
    'inTransitQty', coalesce(transit.qty, 0),
    'receiptCustodyQty', case when receipt.complete is false then null else coalesce(receipt.qty, 0) end
  ) order by requested.item_id), '[]'::jsonb) into v_rows
  from requested
  left join ledger on ledger.item_id = requested.item_id
  left join reservations on reservations.item_id = requested.item_id
  left join transit on transit.item_id = requested.item_id
  left join receipt on receipt.item_id = requested.item_id
  left join public.wms_inventory_reconciliation_issues issue
    on issue.material_id = requested.item_id
   and issue.warehouse_id = p_warehouse_id
   and issue.status = 'open';

  return jsonb_build_object('metricVersion', 'project.site-stock.g6.v1',
    'warehouseId', p_warehouse_id, 'asOf', now(), 'rows', v_rows);
end;
$$;

revoke all on function public.get_project_material_request_site_stock_context_v1(text, text, text, text[]) from public, anon;
grant execute on function public.get_project_material_request_site_stock_context_v1(text, text, text, text[]) to authenticated, service_role;
notify pgrst, 'reload schema';

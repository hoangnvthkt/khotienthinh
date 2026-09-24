-- Whole-project BOQ and confirmed net arrivals into its site warehouses.
-- Pending orders/transfers and current on-hand stock are separate measures.
create function app_private.project_v2_material_boq_positions_v1(
  p_workspace_id uuid, p_item_ids text[]
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace public.project_v2_workspaces%rowtype;
  v_result jsonb;
begin
  select * into v_workspace from public.project_v2_workspaces w
  where w.id = p_workspace_id and w.lifecycle <> 'archived';
  perform app_private.project_v2_assert_permission(
    v_workspace, 'material', 'view', public.current_app_user_id()
  );
  if p_item_ids is null or cardinality(p_item_ids) < 1 or cardinality(p_item_ids) > 100
    or exists (select 1 from unnest(p_item_ids) item(id) where nullif(btrim(item.id), '') is null)
    or cardinality(p_item_ids) <> (select count(distinct item.id) from unnest(p_item_ids) item(id)) then
    raise exception using errcode = '22023', message = 'PROJECT_V2_BOQ_ITEM_SCOPE_INVALID';
  end if;

  with requested as materialized (
    select item.id from unnest(p_item_ids) item(id)
  ), budget as materialized (
    select requested.id item_id, count(b.id) line_count,
      count(distinct lower(btrim(b.unit))) unit_count,
      count(distinct b.source_type) source_count,
      bool_or(lower(btrim(b.unit)) <> lower(btrim(item.unit))) unit_mismatch,
      bool_or(b.budget_qty <= 0) has_unverified_quantity,
      sum(b.budget_qty)::numeric(20,6) boq_quantity
    from requested
    left join public.items item on item.id = requested.id
    left join public.material_budget_items b on b.project_id = v_workspace.project_id
      and b.inventory_item_id = requested.id
    group by requested.id
  ), site_ledger as materialized (
    select entry.material_id item_id, entry.unit, entry.project_id entry_project_id,
      entry.business_event_type, entry.movement_direction,
      entry.quantity_in, entry.quantity_out,
      posted.status inventory_transaction_status,
      source_warehouse.id source_warehouse_id,
      source_warehouse.type source_warehouse_type,
      source_warehouse.project_id source_project_id
    from requested
    join public.inventory_ledger_entries entry on entry.material_id = requested.id
    join public.warehouses site_warehouse on site_warehouse.id = entry.warehouse_id
      and site_warehouse.type = 'SITE'
      and site_warehouse.project_id = v_workspace.project_id
    join public.inventory_transactions posted on posted.id = entry.inventory_transaction_id
    left join public.warehouses source_warehouse
      on source_warehouse.id = posted.metadata ->> 'sourceWarehouseId'
  ), receipt as materialized (
    select ledger.item_id,
      coalesce(sum(ledger.quantity_in) filter (where ledger.movement_direction = 'in'
        and (ledger.business_event_type in (
          'request_po_receipt', 'proactive_po_receipt', 'site_hot_purchase_receipt',
          'direct_supplier_receipt', 'direct_manual_receipt', 'legacy_direct_receipt'
        ) or ledger.business_event_type = 'warehouse_transfer'
          and ledger.source_warehouse_id is not null
          and (ledger.source_warehouse_type = 'GENERAL'
            or ledger.source_warehouse_type = 'SITE'
              and ledger.source_project_id is distinct from v_workspace.project_id))), 0)::numeric(20,6)
        gross_site_receipts,
      coalesce(sum(ledger.quantity_out) filter (where ledger.movement_direction = 'out'
        and ledger.business_event_type = 'supplier_return'), 0)::numeric(20,6)
        supplier_returns,
      bool_or(ledger.entry_project_id is distinct from v_workspace.project_id) scope_mismatch,
      bool_or(ledger.inventory_transaction_status <> 'posted') reversed_transaction,
      bool_or(ledger.unit is null or lower(btrim(ledger.unit)) <> lower(btrim(item.unit))) unit_mismatch,
      bool_or(ledger.movement_direction = 'in'
        and ledger.business_event_type = 'warehouse_transfer'
        and (ledger.source_warehouse_id is null or ledger.source_warehouse_type not in ('GENERAL', 'SITE')))
        missing_transfer_source,
      bool_or(ledger.business_event_type = 'reversal'
        or ledger.movement_direction = 'in'
          and (ledger.business_event_type is null or ledger.business_event_type not in (
            'request_po_receipt', 'proactive_po_receipt', 'site_hot_purchase_receipt',
            'direct_supplier_receipt', 'direct_manual_receipt', 'legacy_direct_receipt',
            'warehouse_transfer', 'project_return_receipt'
          ))) unclassified_movement
    from site_ledger ledger
    join public.items item on item.id = ledger.item_id
    group by ledger.item_id
  ), position as (
    select requested.id item_id, item.unit,
      budget.line_count,
      (item.id is null or budget.unit_count <> 1 or budget.source_count <> 1
        or coalesce(budget.unit_mismatch, false)
        or coalesce(budget.has_unverified_quantity, false)) boq_unknown,
      (item.id is null or coalesce(receipt.scope_mismatch, false) or coalesce(receipt.unit_mismatch, false)
        or coalesce(receipt.reversed_transaction, false)
        or coalesce(receipt.missing_transfer_source, false)
        or coalesce(receipt.unclassified_movement, false)
        or coalesce(receipt.supplier_returns, 0) > coalesce(receipt.gross_site_receipts, 0)) receipt_unknown,
      budget.boq_quantity, coalesce(receipt.gross_site_receipts, 0) gross_site_receipts,
      coalesce(receipt.supplier_returns, 0) supplier_returns
    from requested
    left join public.items item on item.id = requested.id
    join budget on budget.item_id = requested.id
    left join receipt on receipt.item_id = requested.id
  )
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'itemId', position.item_id, 'unit', position.unit,
    'state', case when position.line_count = 0 then 'outside_boq'
      when position.boq_unknown or position.receipt_unknown then 'unknown' else 'known' end,
    'boqQuantity', case when position.line_count > 0 and not position.boq_unknown
      then position.boq_quantity::text else null end,
    'receivedQuantity', case when not position.receipt_unknown
      then (position.gross_site_receipts - position.supplier_returns)::numeric(20,6)::text else null end,
    'remainingQuantity', case when position.line_count > 0
        and not position.boq_unknown and not position.receipt_unknown
      then (position.boq_quantity - position.gross_site_receipts + position.supplier_returns)::numeric(20,6)::text
      else null end,
    'pendingQuantity', null,
    'issues', array_remove(array[
      case when position.boq_unknown and position.line_count > 0 then 'boq_source_unknown' end,
      case when position.receipt_unknown then 'receipt_source_unknown' end
    ], null)
  ) order by position.item_id), '[]'::jsonb)) into v_result
  from position;
  return v_result;
end;
$$;

revoke all on function app_private.project_v2_material_boq_positions_v1(uuid, text[])
  from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.project_v2_material_boq_positions_v1(uuid, text[])
  to authenticated;

create function public.list_project_v2_material_boq_positions_v1(
  p_workspace_id uuid, p_item_ids text[]
) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select app_private.project_v2_material_boq_positions_v1(p_workspace_id, p_item_ids);
$$;

revoke all on function public.list_project_v2_material_boq_positions_v1(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.list_project_v2_material_boq_positions_v1(uuid, text[])
  to authenticated;

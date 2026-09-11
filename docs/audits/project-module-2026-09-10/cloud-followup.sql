-- Read-only follow-up probes. Returns one JSON result for CLI compatibility.
begin read only;
select jsonb_build_object(
  'balance_anomalies_by_warehouse_type', (
    select jsonb_agg(s) from (
      select coalesce(w.type::text, 'unknown') warehouse_type,
        coalesce(w.is_archived, false) archived,
        count(*) filter (where b.on_hand_qty < 0) negative_qty,
        count(*) filter (where b.on_hand_qty = 0 and abs(b.total_value) > 0.01) zero_qty_nonzero_value,
        count(*) filter (where b.on_hand_qty > 0 and b.total_value < 0) positive_qty_negative_value
      from public.inventory_balances b
      left join public.warehouses w on w.id = b.warehouse_id
      group by 1, 2
    ) s
  ),
  'ledger_zero_price_site_by_event', (
    select jsonb_agg(s) from (
      select e.business_event_type, count(*) n
      from public.inventory_ledger_entries e
      join public.warehouses w on w.id = e.warehouse_id
      where w.type = 'SITE' and not coalesce(w.is_archived, false) and e.unit_price = 0
      group by 1
    ) s
  ),
  'returned_request_active_po_count', (
    select count(distinct ws.subject_id)
    from public.workflow_subjects ws
    join public.purchase_order_request_lines l on l.material_request_id = ws.subject_id
    join public.purchase_orders po on po.id = l.purchase_order_id
    where ws.subject_type = 'material_request' and ws.status = 'RETURNED'
      and po.status not in ('cancelled', 'returned')
  ),
  'ledger_balance_quantity_disagreements', (
    select count(*) from public.inventory_balances b
    left join (
      select material_id, warehouse_id, project_id, construction_site_id, sum(quantity_delta) qty
      from public.inventory_ledger_entries group by 1, 2, 3, 4
    ) e on e.material_id = b.material_id and e.warehouse_id = b.warehouse_id
      and e.project_id is not distinct from b.project_id
      and e.construction_site_id is not distinct from b.construction_site_id
    where abs(b.on_hand_qty - coalesce(e.qty, 0)) > 0.0001
  ),
  'wms_vs_ledger_qty_disagreements', (
    select count(*) from (
      select b.material_id, b.warehouse_id, sum(b.on_hand_qty) qty
      from public.inventory_balances b group by 1, 2
    ) b join public.items i on i.id = b.material_id
    where abs(b.qty - coalesce((i.stock_by_warehouse ->> b.warehouse_id)::numeric, 0)) > 0.0001
  ),
  'po_anomalies', (
    select jsonb_object_agg(anomaly_type, n) from (
      select anomaly_type, count(*) n from public.purchase_package_v2_anomalies group by anomaly_type
    ) s
  ),
  'return_has_dependency_check', position('get_project_workflow_rollback_dependencies' in
    pg_get_functiondef('public.return_project_workflow_v2_room_authoritative_legacy(text,text,text)'::regprocedure)) > 0,
  'reject_has_dependency_check', position('get_project_workflow_rollback_dependencies' in
    pg_get_functiondef('public.reject_project_workflow_room_authoritative_legacy(text,text,text)'::regprocedure)) > 0,
  'ledger_uses_supplied_price', position('v_value_delta := v_delta * coalesce(p_unit_price, 0)' in
    pg_get_functiondef('app_private.post_inventory_ledger_entry(uuid,integer,text,timestamp with time zone,text,text,text,text,text,text,text,text,text,text,text,numeric,numeric,text,jsonb,uuid,uuid)'::regprocedure)) > 0
) audit;
rollback;

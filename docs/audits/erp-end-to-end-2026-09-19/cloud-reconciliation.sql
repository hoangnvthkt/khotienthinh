begin read only;
set local statement_timeout='25s';
with ledger as (select material_id,warehouse_id,sum(on_hand_qty) qty from public.inventory_balances group by 1,2),
wms as (select i.id material_id,e.key warehouse_id,e.value::numeric qty from public.items i cross join lateral jsonb_each_text(coalesce(i.stock_by_warehouse,'{}'::jsonb)) e),
differences as (select coalesce(l.material_id,w.material_id) material_id,coalesce(l.warehouse_id,w.warehouse_id) warehouse_id,coalesce(l.qty,0) ledger_qty,coalesce(w.qty,0) wms_qty from ledger l full join wms w using(material_id,warehouse_id)),
lineage as (select l.id,not exists(select 1 from jsonb_array_elements(p.items) x where coalesce(x->>'lineId',x->>'itemId')=l.purchase_order_line_id) missing_po_line,not exists(select 1 from jsonb_array_elements(r.items) x where coalesce(x->>'lineId',x->>'itemId')=l.request_line_id) missing_request_line from public.purchase_order_request_lines l join public.purchase_orders p on p.id=l.purchase_order_id join public.requests r on r.id=l.material_request_id)
select jsonb_build_object(
'read_at',now(),
'wms_ledger_full_outer_disagreements',(select count(*) from differences where abs(ledger_qty-wms_qty)>0.000001),
'ledger_balance_disagreements',(select count(*) from public.inventory_balances b full join (select material_id,warehouse_id,project_id,construction_site_id,sum(quantity_in-quantity_out) qty from public.inventory_ledger_entries group by 1,2,3,4) e on b.material_id=e.material_id and b.warehouse_id=e.warehouse_id and b.project_id is not distinct from e.project_id and b.construction_site_id is not distinct from e.construction_site_id where abs(coalesce(b.on_hand_qty,0)-coalesce(e.qty,0))>0.000001),
'po_anomalies',(select jsonb_agg(a) from public.purchase_package_v2_anomalies a),
'lineage_total',(select count(*) from lineage),
'lineage_missing_po_json_line',(select count(*) from lineage where missing_po_line),
'lineage_missing_request_json_line_candidate',(select count(*) from lineage where missing_request_line),
'delivery_lines_with_qty_variance',(select count(*) from public.purchase_order_delivery_lines where delivered_qty<>accepted_qty or delivered_stock_qty<>accepted_stock_qty),
'nonzero_received_missing_wms',(select count(*) from public.purchase_order_delivery_batches where accepted_gross_amount>0 and wms_transaction_id is null),
'invoice_count',(select count(*) from public.supplier_invoices),
'invoices_multi_project',(select count(*) from (select l.invoice_id from public.supplier_invoice_payable_links l join public.supplier_payable_documents d on d.id=l.payable_document_id group by l.invoice_id having count(distinct coalesce(d.project_id,d.construction_site_id))>1)s),
'payment_status_counts',(select jsonb_object_agg(status,n) from (select status,count(*) n from public.supplier_payment_batches group by status)s),
'legacy_material_request_count',(select count(*) from public.project_material_requests),
'project_material_request_count',(select count(*) from public.requests where request_origin='project'),
'ledger_zero_price_by_event',(select jsonb_object_agg(transaction_type,n) from (select transaction_type,count(*) n from public.inventory_ledger_entries where unit_price=0 group by transaction_type)s)
) as audit;
rollback;

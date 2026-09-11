begin read only;
select jsonb_build_object(
 'financial_po_relation', to_regclass('public.project_purchase_orders'),
 'po_status_counts', (select jsonb_object_agg(status,n) from (select status,count(*) n from public.purchase_orders group by status) s),
 'screenshot_po', (select jsonb_build_object('code',po_number,'status',status,'links',(select jsonb_agg(jsonb_build_object('request_code',l.material_request_code,'allocation_status',l.allocation_status,'workflow_status',ws.status)) from public.purchase_order_request_lines l left join public.workflow_subjects ws on ws.subject_type='material_request' and ws.subject_id=l.material_request_id where l.purchase_order_id=po.id)) from public.purchase_orders po where id='07f43ee4-ef85-4afd-93ec-7cc5af49ef93'),
 'projects_missing_site', (select count(*) from public.projects where construction_site_id is null),
 'project_site_duplicates', (select count(*) from (select construction_site_id from public.projects where construction_site_id is not null group by construction_site_id having count(*)>1) s),
 'ledger_zero_price_by_type', (select jsonb_object_agg(transaction_type,n) from (select transaction_type,count(*) n from public.inventory_ledger_entries where unit_price=0 group by transaction_type) s),
 'negative_inventory_balance', (select count(*) from public.inventory_balances where on_hand_qty<0),
 'zero_qty_nonzero_value', (select count(*) from public.inventory_balances where on_hand_qty=0 and abs(total_value)>0.01),
 'positive_qty_negative_value', (select count(*) from public.inventory_balances where on_hand_qty>0 and total_value<0),
 'payables_by_source', (select jsonb_object_agg(source_type,n) from (select source_type,count(*) n from public.supplier_payable_documents where status not in ('cancelled','reversed','draft') group by source_type) s),
 'active_po_link_to_rejected_workflow', (select count(distinct po.id) from public.purchase_order_request_lines l join public.purchase_orders po on po.id=l.purchase_order_id join public.workflow_subjects ws on ws.subject_type='material_request' and ws.subject_id=l.material_request_id where ws.status in ('REJECTED','CANCELLED') and po.status not in ('cancelled','returned'))
) as audit;
rollback;

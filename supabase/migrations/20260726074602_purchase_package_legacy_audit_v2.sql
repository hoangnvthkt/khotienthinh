create or replace view public.purchase_package_v2_anomalies
with (security_invoker = true)
as
select
  'completed_wms_batch_not_received'::text as anomaly_type,
  batch.purchase_order_id,
  batch.id as delivery_batch_id,
  tx.id as wms_transaction_id,
  po.project_id,
  po.construction_site_id,
  jsonb_build_object(
    'deliveryStatus', batch.status,
    'wmsStatus', tx.status,
    'deliveryNo', batch.delivery_no
  ) as details,
  now() as detected_at
from public.purchase_order_delivery_batches batch
join public.purchase_orders po on po.id = batch.purchase_order_id
join public.transactions tx on tx.id = batch.wms_transaction_id
where tx.source_type = 'po_delivery_batch'
  and tx.source_id = batch.id::text
  and tx.status = 'COMPLETED'::public.transaction_status
  and batch.status not in ('received', 'received_short', 'received_over', 'cancelled')
  and app_private.ap_scope_can_view(po.project_id, po.construction_site_id)

union all
select
  'received_batch_wms_not_completed'::text,
  batch.purchase_order_id,
  batch.id,
  tx.id,
  po.project_id,
  po.construction_site_id,
  jsonb_build_object(
    'deliveryStatus', batch.status,
    'wmsStatus', tx.status,
    'deliveryNo', batch.delivery_no
  ),
  now()
from public.purchase_order_delivery_batches batch
join public.purchase_orders po on po.id = batch.purchase_order_id
left join public.transactions tx on tx.id = batch.wms_transaction_id
where batch.status in ('received', 'received_short', 'received_over')
  and (tx.id is null or tx.status <> 'COMPLETED'::public.transaction_status)
  and app_private.ap_scope_can_view(po.project_id, po.construction_site_id)

union all
select
  'multiple_active_wms_for_batch'::text,
  batch.purchase_order_id,
  batch.id,
  null::text,
  po.project_id,
  po.construction_site_id,
  jsonb_build_object(
    'activeWmsCount', count(tx.id),
    'wmsTransactionIds', jsonb_agg(tx.id order by tx.id)
  ),
  now()
from public.purchase_order_delivery_batches batch
join public.purchase_orders po on po.id = batch.purchase_order_id
join public.transactions tx
  on tx.source_type = 'po_delivery_batch'
 and tx.source_id = batch.id::text
 and tx.status <> 'CANCELLED'::public.transaction_status
where app_private.ap_scope_can_view(po.project_id, po.construction_site_id)
group by batch.purchase_order_id, batch.id, po.project_id, po.construction_site_id
having count(tx.id) > 1

union all
select
  'po_received_without_payable'::text,
  batch.purchase_order_id,
  batch.id,
  batch.wms_transaction_id,
  po.project_id,
  po.construction_site_id,
  jsonb_build_object(
    'deliveryStatus', batch.status,
    'expectedSourceType', 'purchase_delivery_receipt'
  ),
  now()
from public.purchase_order_delivery_batches batch
join public.purchase_orders po on po.id = batch.purchase_order_id
where batch.status in ('received', 'received_short', 'received_over')
  and not exists (
    select 1
    from public.supplier_payable_documents ap
    where ap.source_type = 'purchase_delivery_receipt'
      and ap.source_id = batch.id::text
      and ap.status not in ('cancelled', 'reversed')
  )
  and app_private.ap_scope_can_view(po.project_id, po.construction_site_id)

union all
select
  'po_received_without_cost'::text,
  batch.purchase_order_id,
  batch.id,
  batch.wms_transaction_id,
  po.project_id,
  po.construction_site_id,
  jsonb_build_object(
    'deliveryStatus', batch.status,
    'expectedSourceRef', 'purchase_receipt:' || batch.id::text
  ),
  now()
from public.purchase_order_delivery_batches batch
join public.purchase_orders po on po.id = batch.purchase_order_id
where batch.status in ('received', 'received_short', 'received_over')
  and not exists (
    select 1
    from public.project_transactions pt
    where pt.source_ref = 'purchase_receipt:' || batch.id::text
  )
  and app_private.ap_scope_can_view(po.project_id, po.construction_site_id)

union all
select
  'payment_expense_duplicate_risk'::text,
  null::text,
  null::uuid,
  null::text,
  pt.project_id,
  pt.construction_site_id,
  jsonb_build_object(
    'projectTransactionId', pt.id,
    'sourceRef', pt.source_ref,
    'amount', pt.amount,
    'description', pt.description
  ),
  now()
from public.project_transactions pt
where pt.type = 'expense'
  and (
    pt.source_ref ilike 'supplier_payment:%'
    or pt.description ilike '%thanh toán%ncc%'
    or pt.description ilike '%payment% supplier%'
  )
  and app_private.ap_scope_can_view(pt.project_id, pt.construction_site_id)

union all
select
  'purchase_stock_unit_mismatch'::text,
  batch.purchase_order_id,
  batch.id,
  batch.wms_transaction_id,
  po.project_id,
  po.construction_site_id,
  jsonb_build_object(
    'deliveryLineId', line.id,
    'purchaseOrderLineId', line.purchase_order_line_id,
    'plannedQty', line.planned_qty,
    'stockPlannedQty', line.stock_planned_qty,
    'purchaseUnit', line.unit,
    'stockUnit', line.stock_unit
  ),
  now()
from public.purchase_order_delivery_lines line
join public.purchase_order_delivery_batches batch on batch.id = line.delivery_batch_id
join public.purchase_orders po on po.id = batch.purchase_order_id
where coalesce(line.planned_qty, 0) > 0
  and coalesce(line.stock_planned_qty, 0) <= 0
  and coalesce(line.unit, '') <> coalesce(line.stock_unit, '')
  and app_private.ap_scope_can_view(po.project_id, po.construction_site_id)

union all
select
  'legacy_delivery_group_only'::text,
  grp.purchase_order_id,
  null::uuid,
  mrf.transaction_id,
  po.project_id,
  po.construction_site_id,
  jsonb_build_object(
    'fulfillmentBatchId', mrf.id,
    'poDeliveryGroupId', mrf.po_delivery_group_id,
    'poDeliveryBatchId', mrf.po_delivery_batch_id,
    'batchNo', mrf.batch_no
  ),
  now()
from public.material_request_fulfillment_batches mrf
join public.purchase_order_delivery_groups grp on grp.id = mrf.po_delivery_group_id
join public.purchase_orders po on po.id = grp.purchase_order_id
where mrf.po_delivery_group_id is not null
  and mrf.po_delivery_batch_id is null
  and po.source_mode = 'from_request'
  and app_private.ap_scope_can_view(po.project_id, po.construction_site_id);

revoke all on table public.purchase_package_v2_anomalies from public, anon, authenticated;
grant select on table public.purchase_package_v2_anomalies to authenticated;

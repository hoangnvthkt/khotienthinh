with repair_candidates as (
  select distinct on (batch.id)
    batch.id as delivery_batch_id,
    fulfillment.id as fulfillment_batch_id,
    fulfillment.transaction_id
  from public.purchase_order_delivery_batches batch
  join public.purchase_orders po
    on po.id = batch.purchase_order_id
  join public.material_request_fulfillment_batches fulfillment
    on fulfillment.po_delivery_batch_id = batch.id
    or fulfillment.id::text = any(coalesce(batch.fulfillment_batch_ids, array[]::text[]))
  join public.transactions tx
    on tx.id = fulfillment.transaction_id
  where po.source_mode = 'from_request'
    and coalesce(po.purchase_mode, '') in ('single', 'multiple')
    and batch.status in ('planned', 'waiting_delivery', 'wms_pending', 'receiving')
    and nullif(fulfillment.transaction_id, '') is not null
    and (
      batch.wms_transaction_id is null
      or fulfillment.transaction_id = batch.wms_transaction_id
    )
    and (
      batch.wms_transaction_id is null
      or batch.qr_token is null
      or batch.status = 'wms_pending'
      or tx.source_type is distinct from 'po_delivery_batch'
      or tx.source_id is distinct from batch.id::text
    )
  order by batch.id,
    case when fulfillment.transaction_id = batch.wms_transaction_id then 0 else 1 end,
    fulfillment.created_at,
    fulfillment.id
),
repaired_batches as (
  update public.purchase_order_delivery_batches batch
  set wms_transaction_id = repair.transaction_id,
      qr_token = coalesce(batch.qr_token, 'pod_' || replace(gen_random_uuid()::text, '-', '')),
      status = case
        when batch.status in ('planned', 'waiting_delivery', 'wms_pending') then 'receiving'
        else batch.status
      end,
      fulfillment_batch_ids = case
        when repair.fulfillment_batch_id::text = any(coalesce(batch.fulfillment_batch_ids, array[]::text[]))
          then batch.fulfillment_batch_ids
        else coalesce(batch.fulfillment_batch_ids, array[]::text[]) || array[fulfillment.id::text]
      end,
      updated_at = now()
  from repair_candidates repair
  join public.material_request_fulfillment_batches fulfillment
    on fulfillment.id = repair.fulfillment_batch_id
  where batch.id = repair.delivery_batch_id
    and (
      batch.wms_transaction_id is distinct from repair.transaction_id
      or batch.qr_token is null
      or batch.status in ('planned', 'waiting_delivery', 'wms_pending')
      or not (repair.fulfillment_batch_id::text = any(coalesce(batch.fulfillment_batch_ids, array[]::text[])))
    )
  returning batch.id
)
update public.transactions tx
set source_type = 'po_delivery_batch',
    source_id = repair.delivery_batch_id::text
from repair_candidates repair
where tx.id = repair.transaction_id
  and (
    tx.source_type is distinct from 'po_delivery_batch'
    or tx.source_id is distinct from repair.delivery_batch_id::text
  );

notify pgrst, 'reload schema';

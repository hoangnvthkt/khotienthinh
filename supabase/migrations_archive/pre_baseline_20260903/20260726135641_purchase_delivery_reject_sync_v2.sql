create schema if not exists app_private;

create or replace function app_private.sync_po_delivery_batch_from_cancelled_wms_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_type = 'po_delivery_batch'
    and new.status = 'CANCELLED'::public.transaction_status
    and coalesce(new.source_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    update public.purchase_order_delivery_batches batch
    set status = 'cancelled',
        quality_result = 'rejected',
        variance_reason = coalesce(nullif(batch.variance_reason, ''), 'Phiếu WMS bị từ chối.'),
        note = case
          when coalesce(batch.note, '') = '' then 'Phiếu WMS ' || new.id || ' bị từ chối.'
          when batch.note ilike '%' || new.id || '%bị từ chối%' then batch.note
          else batch.note || E'\n' || 'Phiếu WMS ' || new.id || ' bị từ chối.'
        end,
        updated_at = now()
    where batch.id = new.source_id::uuid
      and batch.status <> 'cancelled';
  end if;

  return new;
end;
$$;

revoke all on function app_private.sync_po_delivery_batch_from_cancelled_wms_v2()
  from public, anon, authenticated;

drop trigger if exists sync_po_delivery_batch_from_cancelled_wms_v2 on public.transactions;

create trigger sync_po_delivery_batch_from_cancelled_wms_v2
  after insert or update of status, source_type, source_id on public.transactions
  for each row
  when (
    new.source_type = 'po_delivery_batch'
    and new.status = 'CANCELLED'::public.transaction_status
  )
  execute function app_private.sync_po_delivery_batch_from_cancelled_wms_v2();

update public.purchase_order_delivery_batches batch
set status = 'cancelled',
    quality_result = 'rejected',
    variance_reason = coalesce(nullif(batch.variance_reason, ''), 'Phiếu WMS bị từ chối.'),
    note = case
      when coalesce(batch.note, '') = '' then 'Phiếu WMS ' || tx.id || ' bị từ chối.'
      when batch.note ilike '%' || tx.id || '%bị từ chối%' then batch.note
      else batch.note || E'\n' || 'Phiếu WMS ' || tx.id || ' bị từ chối.'
    end,
    updated_at = now()
from public.transactions tx
where tx.source_type = 'po_delivery_batch'
  and tx.status = 'CANCELLED'::public.transaction_status
  and coalesce(tx.source_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and batch.id = tx.source_id::uuid
  and batch.status <> 'cancelled';

notify pgrst, 'reload schema';

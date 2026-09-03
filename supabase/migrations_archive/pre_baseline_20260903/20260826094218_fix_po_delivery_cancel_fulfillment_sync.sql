-- Keep legacy PO receipt fulfillment rows in sync when the canonical WMS
-- transaction is cancelled. Some historical rows have po_delivery_batch_id
-- but no transaction_id, so transaction-only matching leaves them issued and
-- blocks safe delivery deletion even though no stock was received.

create or replace function app_private.project_po_sync_cancelled_receipt_transaction_v1(
  p_transaction_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'Phiếu kho nhập PO đã bị từ chối trước khi nhập kho.');
  v_batch_ids uuid[] := array[]::uuid[];
  v_delivery_batch_ids uuid[] := array[]::uuid[];
  v_delivery_group_ids uuid[] := array[]::uuid[];
  v_id uuid;
begin
  if p_transaction_id is null
     or to_regclass('public.material_request_fulfillment_batches') is null
     or to_regclass('public.material_request_fulfillment_lines') is null then
    return jsonb_build_object('synced', false, 'reason', 'missing_input_or_tables');
  end if;

  select *
    into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    return jsonb_build_object('synced', false, 'reason', 'transaction_not_found');
  end if;

  if v_tx.status <> 'CANCELLED'::public.transaction_status then
    return jsonb_build_object('synced', false, 'reason', 'transaction_not_cancelled');
  end if;

  if to_regclass('public.inventory_ledger_entries') is not null
     and exists (
       select 1
       from public.inventory_ledger_entries entry
       where entry.source_type = 'wms_transaction'
         and entry.source_id = v_tx.id::text
     ) then
    return jsonb_build_object('synced', false, 'reason', 'stock_ledger_exists');
  end if;

  select coalesce(array_agg(distinct batch.id), array[]::uuid[])
    into v_batch_ids
  from public.material_request_fulfillment_batches batch
  where (
      batch.transaction_id::text = v_tx.id::text
      or (
        v_tx.source_type = 'po_delivery_batch'
        and batch.po_delivery_batch_id::text = v_tx.source_id
      )
    )
    and lower(coalesce(batch.source_type::text, '')) = 'po_receipt'
    and lower(coalesce(batch.status::text, '')) in ('issued', 'variance_pending')
    and not exists (
      select 1
      from public.material_request_fulfillment_lines line
      where line.batch_id = batch.id
        and coalesce(line.received_qty, 0) > 0
    );

  if coalesce(array_length(v_batch_ids, 1), 0) = 0 then
    return jsonb_build_object('synced', false, 'reason', 'no_receipt_batches_to_return');
  end if;

  update public.material_request_fulfillment_batches batch
  set status = 'returned',
      cancel_reason = coalesce(nullif(batch.cancel_reason, ''), v_reason),
      reason = coalesce(nullif(batch.reason, ''), v_reason)
  where batch.id = any(v_batch_ids);

  select coalesce(array_agg(distinct batch.po_delivery_batch_id) filter (where batch.po_delivery_batch_id is not null), array[]::uuid[]),
         coalesce(array_agg(distinct batch.po_delivery_group_id) filter (where batch.po_delivery_group_id is not null), array[]::uuid[])
    into v_delivery_batch_ids, v_delivery_group_ids
  from public.material_request_fulfillment_batches batch
  where batch.id = any(v_batch_ids);

  foreach v_id in array v_delivery_batch_ids loop
    perform app_private.project_po_delivery_batch_refresh_status_v1(v_id);
  end loop;

  foreach v_id in array v_delivery_group_ids loop
    perform app_private.project_po_delivery_group_refresh_status_v1(v_id);
  end loop;

  return jsonb_build_object(
    'synced', true,
    'transactionId', v_tx.id,
    'returnedBatchCount', coalesce(array_length(v_batch_ids, 1), 0)
  );
end;
$$;

-- Replay the corrected synchronization for historical cancelled PO-delivery
-- transactions. The function itself refuses rows with ledger stock or actual
-- received quantity, so this repair cannot reverse completed receipts.
do $$
declare
  tx record;
begin
  for tx in
    select transaction_row.id
    from public.transactions transaction_row
    where transaction_row.status = 'CANCELLED'::public.transaction_status
      and transaction_row.source_type = 'po_delivery_batch'
      and exists (
        select 1
        from public.material_request_fulfillment_batches batch
        where batch.po_delivery_batch_id::text = transaction_row.source_id
          and lower(coalesce(batch.source_type::text, '')) = 'po_receipt'
          and lower(coalesce(batch.status::text, '')) in ('issued', 'variance_pending')
          and not exists (
            select 1
            from public.material_request_fulfillment_lines line
            where line.batch_id = batch.id
              and coalesce(line.received_qty, 0) > 0
          )
      )
  loop
    perform app_private.project_po_sync_cancelled_receipt_transaction_v1(tx.id::text, 'Đợt giao đã bị hủy trước khi nhập kho.');
  end loop;
end;
$$;

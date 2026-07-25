-- PO actual receipt / WMS attachment migration smoke test.
-- Read-only assertions; safe to run against the linked Supabase project.

begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_order_delivery_batches'
      and column_name = 'wms_transaction_id'
  ) then
    raise exception 'Missing purchase_order_delivery_batches.wms_transaction_id';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'attachments'
  ) then
    raise exception 'Missing transactions.attachments';
  end if;

  if to_regprocedure('public.update_transaction_items_for_receipt(text,jsonb)') is null then
    raise exception 'Missing update_transaction_items_for_receipt RPC';
  end if;

  if to_regprocedure('public.sync_fulfillment_receipt_for_transaction(text,uuid)') is null then
    raise exception 'Missing sync_fulfillment_receipt_for_transaction RPC';
  end if;

  if to_regprocedure('app_private.wms_transaction_attachment_can_access(text)') is null then
    raise exception 'Missing WMS attachment access helper';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'wms-transaction-attachments'
      and public = false
      and file_size_limit = 52428800
  ) then
    raise exception 'Missing private WMS attachment bucket';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_po_delivery_batch_wms_transaction'
  ) then
    raise exception 'Missing unique WMS transaction link index';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_transaction_po_delivery_source'
  ) then
    raise exception 'Missing unique PO delivery source index';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_orders'
      and column_name = 'purchase_mode'
  ) then
    raise exception 'Missing purchase_orders.purchase_mode';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_po_delivery_batch_idempotency'
  ) then
    raise exception 'Missing delivery idempotency guard';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_po_delivery_batch_qr_token'
  ) then
    raise exception 'Missing delivery QR guard';
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'supplier_payable_documents'
      and con.contype = 'u'
      and (
        select array_agg(att.attname::text order by cols.ordinality)
        from unnest(con.conkey) with ordinality as cols(attnum, ordinality)
        join pg_attribute att on att.attrelid = rel.oid and att.attnum = cols.attnum
      ) = array['source_type', 'source_id']
  ) then
    raise exception 'Missing supplier_payable_documents(source_type, source_id) unique guard';
  end if;
end $$;

rollback;

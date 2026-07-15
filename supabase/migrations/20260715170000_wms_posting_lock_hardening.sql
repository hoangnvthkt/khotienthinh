-- Release A3.3: canonical posting lock primitives and identity hardening.
-- Forward-only; existing public command signatures and response contracts remain unchanged.

create or replace function app_private.wms_business_lock_key(p_business_key text)
returns bigint
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select pg_catalog.hashtextextended('wf001:wms-business:' || p_business_key, 0)
$$;

revoke all on function app_private.wms_business_lock_key(text) from public, anon, authenticated;

create or replace function app_private.lock_wms_business_transaction_items(
  p_business_key text,
  p_transaction_id text,
  p_item_ids text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id text;
begin
  if nullif(trim(p_business_key), '') is null then
    raise exception 'business lock key is required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(app_private.wms_business_lock_key(p_business_key));
  if nullif(trim(p_transaction_id), '') is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('wf001:wms-transaction:' || p_transaction_id, 0)
    );
    perform 1 from public.transactions where id = p_transaction_id for update;
  end if;
  for v_item_id in
    select distinct item_id from unnest(coalesce(p_item_ids, '{}'::text[])) as ids(item_id)
    where nullif(item_id, '') is not null
    order by item_id
  loop
    perform 1 from public.items where id = v_item_id for update;
    if not found then
      raise exception 'stale or ambiguous inventory item identity: %', v_item_id using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function app_private.lock_wms_business_transaction_items(text, text, text[]) from public, anon, authenticated;

-- The producer and completion commands use this same business key primitive.  The
-- command bodies intentionally remain the effective A3 contracts while this
-- migration provides the canonical business -> transaction -> item order.
-- create or replace function public.create_purchase_order_supplier_return(text,text,jsonb,text,text)
-- create or replace function public.process_transaction_status(text,public.transaction_status,text)
comment on function app_private.lock_wms_business_transaction_items(text, text, text[]) is
  'A3.3 canonical order: business advisory lock -> transaction advisory/row lock -> item rows sorted by item_id -> PO/MR/return rows; stale identity fails closed.';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_proc where pronamespace = 'public'::pg_catalog.regnamespace and proname = 'create_purchase_order_supplier_return')
     or not exists (select 1 from pg_catalog.pg_proc where pronamespace = 'public'::pg_catalog.regnamespace and proname = 'process_transaction_status') then
    raise exception 'A3.3 requires effective supplier-return and completion commands';
  end if;
end
$$;

-- Move the effective implementations behind private names and expose thin
-- ordering wrappers. Their bodies (including PBAC, UOM, reservation and JWT
-- checks) are preserved byte-for-byte by ALTER FUNCTION.
alter function public.create_purchase_order_supplier_return(text,text,jsonb,text,text)
  rename to create_purchase_order_supplier_return_a3_core;
alter function public.create_purchase_order_supplier_return_a3_core(text,text,jsonb,text,text)
  set schema app_private;

create or replace function public.create_purchase_order_supplier_return(
  p_purchase_order_id text, p_source_warehouse_id text, p_lines jsonb,
  p_reason text, p_note text default null
)
returns public.purchase_order_supplier_returns
language plpgsql security definer set search_path = ''
as $$
declare
  v_line jsonb;
  v_line_key text;
  v_match_count integer;
  v_item_ids text[];
  v_current_item_ids text[];
begin
  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_line_key := coalesce(v_line ->> 'purchaseOrderLineId', v_line ->> 'poLineId', v_line ->> 'lineId');
    if nullif(v_line_key, '') is null then
      raise exception 'stale or ambiguous supplier-return line identity' using errcode = '22023';
    end if;
    select count(*) into v_match_count
    from public.purchase_orders po
    cross join lateral jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) po_item(value)
    where po.id = p_purchase_order_id
      and coalesce(po_item.value ->> 'lineId', po_item.value ->> 'itemId') = v_line_key;
    if v_match_count <> 1 then
      raise exception 'stale or ambiguous supplier-return line identity: %', v_line_key using errcode = '22023';
    end if;
  end loop;
  -- Resolve item identities before entering the posting core, then acquire the
  -- shared business/item locks. The core generates the transaction id internally;
  -- its transaction row therefore cannot be locked until it is inserted.
  select coalesce(array_agg(distinct po_item.value ->> 'itemId' order by po_item.value ->> 'itemId'), '{}')
    into v_item_ids
    from public.purchase_orders po
    cross join lateral jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) po_item(value)
    where po.id = p_purchase_order_id
      and exists (
        select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) line(value)
        where coalesce(line.value ->> 'purchaseOrderLineId', line.value ->> 'poLineId', line.value ->> 'lineId')
          = coalesce(po_item.value ->> 'lineId', po_item.value ->> 'itemId')
      );
  perform app_private.lock_wms_business_transaction_items('purchase-order:' || p_purchase_order_id, null, v_item_ids);
  -- Lock the PO only after business/item locks. The preserved core will reuse
  -- this row lock, preventing a line-to-item remap between resolution and post.
  perform 1 from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then
    raise exception 'stale supplier-return purchase order identity: %', p_purchase_order_id using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct po_item.value ->> 'itemId' order by po_item.value ->> 'itemId'), '{}')
    into v_current_item_ids
    from public.purchase_orders po
    cross join lateral jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) po_item(value)
    where po.id = p_purchase_order_id
      and exists (
        select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) line(value)
        where coalesce(line.value ->> 'purchaseOrderLineId', line.value ->> 'poLineId', line.value ->> 'lineId')
          = coalesce(po_item.value ->> 'lineId', po_item.value ->> 'itemId')
      );
  if v_current_item_ids is distinct from v_item_ids then
    raise exception 'stale supplier-return item identity' using errcode = '40001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    app_private.wms_business_lock_key('purchase-order:' || p_purchase_order_id)
  );
  return app_private.create_purchase_order_supplier_return_a3_core(
    p_purchase_order_id, p_source_warehouse_id, p_lines, p_reason, p_note
  );
end;
$$;

alter function public.process_transaction_status(text,public.transaction_status,uuid)
  rename to process_transaction_status_a3_core;
alter function public.process_transaction_status_a3_core(text,public.transaction_status,uuid)
  set schema app_private;

create or replace function public.process_transaction_status(
  p_transaction_id text, p_status public.transaction_status, p_approver_id uuid
)
returns public.transactions
language plpgsql security definer set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_business_key text;
  v_return_po_id text;
  v_item_ids text[];
begin
  select * into v_tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'transaction not found: %', p_transaction_id using errcode = 'P0002'; end if;
  select r.purchase_order_id into v_return_po_id
  from public.purchase_order_supplier_returns r
  where r.transaction_id = p_transaction_id
  order by r.id
  limit 1;
  v_business_key := coalesce(
    nullif('purchase-order:' || nullif(v_return_po_id, ''), 'purchase-order:'),
    nullif(v_tx.related_request_id, ''),
    'transaction:' || p_transaction_id
  );
  select coalesce(array_agg(distinct value->>'itemId' order by value->>'itemId'), '{}')
    into v_item_ids from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb));
  perform app_private.lock_wms_business_transaction_items(v_business_key, p_transaction_id, v_item_ids);
  return app_private.process_transaction_status_a3_core(p_transaction_id, p_status, p_approver_id);
end;
$$;

revoke all on function app_private.create_purchase_order_supplier_return_a3_core(text,text,jsonb,text,text), app_private.process_transaction_status_a3_core(text,public.transaction_status,uuid) from public, anon, authenticated;
revoke all on function public.create_purchase_order_supplier_return(text,text,jsonb,text,text), public.process_transaction_status(text,public.transaction_status,uuid) from public, anon;
grant execute on function public.create_purchase_order_supplier_return(text,text,jsonb,text,text), public.process_transaction_status(text,public.transaction_status,uuid) to authenticated;

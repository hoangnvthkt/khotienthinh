-- Keep delete policies aligned with the client-side delete guards.
-- Before this migration, rejected/returned project material requests and
-- returned-stock PO rows could be blocked by RLS while the client still
-- received a successful 204 response from PostgREST.

create schema if not exists app_private;

create or replace function app_private.material_request_can_delete_v2(
  p_request_origin text,
  p_project_id text,
  p_status text,
  p_ever_submitted boolean,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text,
  p_workflow_step text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_request_origin, 'wms') = 'project' then (
      public.is_admin()
      or app_private.project_user_has_permission(p_project_id, null, 'delete')
      or (
        p_requester_id = public.current_app_user_id()
        and (
          coalesce(p_status, 'DRAFT') = 'REJECTED'
          or coalesce(p_workflow_step, '') = 'returned_to_creator'
          or (
            coalesce(p_status, 'DRAFT') = 'DRAFT'
            and not coalesce(p_ever_submitted, false)
          )
        )
      )
    )
    else (
      public.is_admin()
      or public.is_module_admin('WMS')
      or (
        coalesce(p_status, 'DRAFT') in ('DRAFT', 'REJECTED')
        and p_requester_id = public.current_app_user_id()
      )
      or app_private.current_user_is_global_wms_keeper()
      or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
      or app_private.current_user_is_wms_keeper_for(p_site_warehouse_id)
      or (
        p_submitted_to_user_id is not null
        and p_submitted_to_user_id = public.current_app_user_id()::text
      )
    )
  end;
$$;

drop policy if exists requests_delete on public.requests;
create policy requests_delete
  on public.requests
  for delete
  to authenticated
  using (
    app_private.material_request_can_delete_v2(
      request_origin,
      project_id,
      status::text,
      ever_submitted,
      requester_id,
      submitted_to_user_id,
      source_warehouse_id,
      site_warehouse_id,
      workflow_step::text
    )
  );

create or replace function app_private.project_po_stock_cleanup_ok(
  p_po_id text,
  p_received_transaction_ids jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_has_received_batch_qty boolean := false;
  v_has_active_batches boolean := false;
  v_has_returned_batch boolean := false;
  v_has_unfinished_transactions boolean := false;
  v_missing_return_transaction boolean := false;
  v_has_insufficient_return_qty boolean := false;
  v_return_transaction_ids text[] := array[]::text[];
  v_receipt_transaction_ids text[] := array[]::text[];
  v_all_transaction_ids text[] := array[]::text[];
begin
  if to_regclass('public.material_request_fulfillment_lines') is null then
    return false;
  end if;

  select coalesce(bool_or(coalesce(received_qty, 0) > 0), false)
    into v_has_received_batch_qty
  from public.material_request_fulfillment_lines
  where po_id = p_po_id;

  if not v_has_received_batch_qty then
    return false;
  end if;

  if to_regclass('public.material_request_fulfillment_batches') is null then
    return false;
  end if;

  select
    coalesce(bool_or(lower(coalesce(b.status::text, '')) not in ('returned', 'cancelled')), false),
    coalesce(bool_or(lower(coalesce(b.status::text, '')) = 'returned'), false)
    into v_has_active_batches, v_has_returned_batch
  from public.material_request_fulfillment_batches b
  where b.id in (
    select distinct batch_id
    from public.material_request_fulfillment_lines
    where po_id = p_po_id
      and batch_id is not null
  );

  select coalesce(array_agg(distinct m.match[1]), array[]::text[])
    into v_return_transaction_ids
  from public.material_request_fulfillment_batches b
  cross join lateral regexp_matches(coalesce(b.note, ''), '(tx-[a-z0-9-]+)', 'gi') as m(match)
  where b.id in (
    select distinct batch_id
    from public.material_request_fulfillment_lines
    where po_id = p_po_id
      and batch_id is not null
  );

  select coalesce(array_agg(distinct tx_id), array[]::text[])
    into v_receipt_transaction_ids
  from (
    select jsonb_array_elements_text(coalesce(p_received_transaction_ids, '[]'::jsonb)) as tx_id
    union
    select b.transaction_id::text as tx_id
    from public.material_request_fulfillment_batches b
    where b.id in (
      select distinct batch_id
      from public.material_request_fulfillment_lines
      where po_id = p_po_id
        and batch_id is not null
    )
  ) tx
  where nullif(tx_id, '') is not null;

  select coalesce(array_agg(distinct tx_id), array[]::text[])
    into v_all_transaction_ids
  from (
    select unnest(v_return_transaction_ids) as tx_id
    union
    select unnest(v_receipt_transaction_ids) as tx_id
  ) tx
  where nullif(tx_id, '') is not null;

  if coalesce(array_length(v_all_transaction_ids, 1), 0) > 0 then
    select coalesce(bool_or(upper(coalesce(t.status::text, '')) not in ('COMPLETED', 'CANCELLED')), false)
      into v_has_unfinished_transactions
    from public.transactions t
    where t.id::text = any(v_all_transaction_ids);
  end if;

  if v_has_received_batch_qty and v_has_returned_batch then
    if coalesce(array_length(v_return_transaction_ids, 1), 0) = 0 then
      v_missing_return_transaction := true;
    else
      select exists (
        select 1
        from unnest(v_return_transaction_ids) as r(tx_id)
        left join public.transactions t
          on t.id::text = r.tx_id
         and upper(coalesce(t.status::text, '')) = 'COMPLETED'
        where t.id is null
      )
        into v_missing_return_transaction;
    end if;
  end if;

  if coalesce(array_length(v_return_transaction_ids, 1), 0) > 0 then
    select exists (
      with received as (
        select item_id::text as item_id, sum(coalesce(received_qty, 0))::numeric as qty
        from public.material_request_fulfillment_lines
        where po_id = p_po_id
          and item_id is not null
          and coalesce(received_qty, 0) > 0
        group by item_id::text
      ),
      returned as (
        select
          elem->>'itemId' as item_id,
          sum(coalesce(nullif(elem->>'quantity', '')::numeric, 0))::numeric as qty
        from public.transactions t
        cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) as elem
        where t.id::text = any(v_return_transaction_ids)
          and upper(coalesce(t.status::text, '')) = 'COMPLETED'
          and nullif(elem->>'itemId', '') is not null
        group by elem->>'itemId'
      )
      select 1
      from received r
      left join returned ret on ret.item_id = r.item_id
      where coalesce(ret.qty, 0) + 0.000000001 < r.qty
      limit 1
    )
      into v_has_insufficient_return_qty;
  else
    v_has_insufficient_return_qty := true;
  end if;

  return not v_has_active_batches
    and not v_has_unfinished_transactions
    and not v_missing_return_transaction
    and not v_has_insufficient_return_qty;
end;
$$;

create or replace function app_private.project_po_can_delete_v2(
  p_po_id text,
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_ever_submitted boolean,
  p_received_transaction_ids jsonb,
  p_items jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := lower(coalesce(p_status, 'draft'));
  v_has_permission boolean := false;
  v_has_received_batch_qty boolean := false;
  v_received_item_qty numeric := 0;
  v_no_receipt boolean := false;
  v_stock_cleanup_ok boolean := false;
begin
  v_has_permission := public.is_admin()
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'delete');

  if not v_has_permission then
    return false;
  end if;

  if v_status = 'draft' and not coalesce(p_ever_submitted, false) then
    return true;
  end if;

  select coalesce(sum(coalesce(nullif(elem->>'receivedQty', '')::numeric, 0)), 0)
    into v_received_item_qty
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elem;

  if to_regclass('public.material_request_fulfillment_lines') is not null then
    select coalesce(bool_or(coalesce(received_qty, 0) > 0), false)
      into v_has_received_batch_qty
    from public.material_request_fulfillment_lines
    where po_id = p_po_id;
  end if;

  v_no_receipt := v_received_item_qty <= 0
    and jsonb_array_length(coalesce(p_received_transaction_ids, '[]'::jsonb)) = 0
    and not v_has_received_batch_qty;

  if v_status in ('returned', 'cancelled', 'partial', 'delivered', 'closed') then
    v_stock_cleanup_ok := app_private.project_po_stock_cleanup_ok(
      p_po_id,
      p_received_transaction_ids
    );
  end if;

  return (
    v_status in ('returned', 'cancelled')
    and (v_no_receipt or v_stock_cleanup_ok)
  )
  or (
    v_status in ('partial', 'delivered', 'closed')
    and v_has_received_batch_qty
    and v_stock_cleanup_ok
  );
end;
$$;

drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_delete
  on public.purchase_orders
  for delete
  to authenticated
  using (
    app_private.project_po_can_delete_v2(
      id::text,
      project_id::text,
      construction_site_id::text,
      status::text,
      ever_submitted,
      received_transaction_ids,
      items
    )
  );

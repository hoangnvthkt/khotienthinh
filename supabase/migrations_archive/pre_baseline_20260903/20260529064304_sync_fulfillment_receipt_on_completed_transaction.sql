-- Keep WMS transaction completion and project fulfillment receipt in sync.
-- The client may be allowed to complete a transaction through the RPC while
-- RLS prevents it from reading/updating the fulfillment batch afterwards. This
-- RPC performs the receipt sync with the same trusted status-transition path.

create or replace function public.sync_fulfillment_receipt_for_transaction(
  p_transaction_id text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_batch public.material_request_fulfillment_batches%rowtype;
  v_actor_user_id uuid;
  v_can_sync boolean := false;
  v_line record;
  v_received_qty numeric;
  v_reason text;
  v_has_variance boolean := false;
  v_po_id text;
  v_po public.purchase_orders%rowtype;
  v_next_items jsonb;
  v_is_delivered boolean;
  v_already_recorded boolean;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user
  from public.users
  where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  v_actor_user_id := coalesce(p_actor_user_id, v_user.id);

  v_can_sync :=
    public.is_admin()
    or public.is_module_admin('WMS')
    or (
      v_user.role = 'WAREHOUSE_KEEPER'
      and (
        v_user.assigned_warehouse_id is null
        or (
          v_tx.type in ('IMPORT'::public.transaction_type, 'TRANSFER'::public.transaction_type)
          and v_user.assigned_warehouse_id is not distinct from v_tx.target_warehouse_id
        )
      )
    );

  if not v_can_sync then
    raise exception 'insufficient privilege to sync fulfillment receipt';
  end if;

  if v_tx.status <> 'COMPLETED'::public.transaction_status then
    raise exception 'Chỉ đồng bộ nhận hàng cho phiếu kho đã hoàn tất.';
  end if;

  select * into v_batch
  from public.material_request_fulfillment_batches
  where transaction_id = p_transaction_id
  for update;
  if not found then
    return jsonb_build_object('synced', false, 'reason', 'batch_not_found');
  end if;

  if v_batch.status not in ('issued', 'received') then
    return jsonb_build_object('synced', false, 'reason', 'batch_not_receivable', 'batchStatus', v_batch.status);
  end if;

  for v_line in
    select *
    from public.material_request_fulfillment_lines
    where batch_id = v_batch.id
    order by created_at asc
    for update
  loop
    select
      coalesce(sum(coalesce(nullif(item.value->>'quantity', '')::numeric, 0)), 0),
      max(nullif(item.value->>'varianceReason', ''))
    into v_received_qty, v_reason
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
    where coalesce(item.value->>'fulfillmentBatchId', '') = v_batch.id::text
      and item.value->>'requestLineId' = v_line.request_line_id;

    if coalesce(v_received_qty, 0) = 0 then
      select
        coalesce(sum(coalesce(nullif(item.value->>'quantity', '')::numeric, 0)), 0),
        max(nullif(item.value->>'varianceReason', ''))
      into v_received_qty, v_reason
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where coalesce(item.value->>'fulfillmentBatchId', '') = v_batch.id::text
        and item.value->>'itemId' = v_line.item_id;
    end if;

    if coalesce(v_received_qty, 0) <> coalesce(v_line.issued_qty, 0) then
      v_has_variance := true;
    end if;

    update public.material_request_fulfillment_lines
    set
      received_qty = coalesce(v_received_qty, 0),
      variance_reason = coalesce(
        nullif(v_reason, ''),
        variance_reason,
        case
          when coalesce(v_received_qty, 0) <> coalesce(v_line.issued_qty, 0)
            then 'Thủ kho công trường xác nhận số lượng thực nhận lệch phiếu kho.'
          else null
        end
      )
    where id = v_line.id;
  end loop;

  if v_batch.status = 'issued' then
    update public.material_request_fulfillment_batches
    set
      status = 'received',
      received_by = v_actor_user_id,
      received_at = now(),
      reason = coalesce(
        reason,
        case when v_has_variance then 'Thủ kho công trường xác nhận nhận lệch theo thực tế.' else null end
      )
    where id = v_batch.id
    returning * into v_batch;
  end if;

  for v_po_id in
    select distinct po_id
    from public.material_request_fulfillment_lines
    where batch_id = v_batch.id
      and po_id is not null
  loop
    select * into v_po
    from public.purchase_orders
    where id = v_po_id
    for update;
    if not found then
      continue;
    end if;

    select exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_po.received_transaction_ids, '[]'::jsonb)) existing(id)
      where existing.id = v_tx.id
    )
    into v_already_recorded;
    if v_already_recorded then
      continue;
    end if;

    with receipt_by_line as (
      select po_line_id, sum(coalesce(received_qty, 0)) as received_qty
      from public.material_request_fulfillment_lines
      where batch_id = v_batch.id
        and po_id = v_po_id
        and po_line_id is not null
      group by po_line_id
    ),
    item_rows as (
      select
        item.value as item,
        item.ordinality,
        coalesce(item.value->>'lineId', item.value->>'line_id', item.value->>'itemId', item.value->>'item_id') as line_key,
        coalesce(nullif(item.value->>'qty', '')::numeric, 0) as ordered_qty,
        coalesce(nullif(item.value->>'receivedQty', '')::numeric, 0) as current_received_qty
      from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality item(value, ordinality)
    ),
    next_rows as (
      select
        case
          when coalesce(r.received_qty, 0) > 0 then
            jsonb_set(
              ir.item,
              '{receivedQty}',
              to_jsonb(least(ir.ordered_qty, ir.current_received_qty + coalesce(r.received_qty, 0))),
              true
            )
          else ir.item
        end as item,
        ir.ordinality
      from item_rows ir
      left join receipt_by_line r on r.po_line_id = ir.line_key
    )
    select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
    into v_next_items
    from next_rows;

    select coalesce(bool_and(
      coalesce(nullif(item.value->>'qty', '')::numeric, 0) <= coalesce(nullif(item.value->>'receivedQty', '')::numeric, 0)
    ), false)
    into v_is_delivered
    from jsonb_array_elements(coalesce(v_next_items, '[]'::jsonb)) item(value);

    update public.purchase_orders
    set
      items = v_next_items,
      status = case when v_is_delivered then 'delivered' else 'partial' end,
      actual_delivery_date = case when v_is_delivered then current_date::text else actual_delivery_date end,
      received_transaction_ids = coalesce(received_transaction_ids, '[]'::jsonb) || jsonb_build_array(v_tx.id)
    where id = v_po_id;
  end loop;

  return jsonb_build_object(
    'synced', true,
    'batchId', v_batch.id,
    'batchStatus', v_batch.status,
    'hasVariance', v_has_variance
  );
end;
$$;

revoke all on function public.sync_fulfillment_receipt_for_transaction(text, uuid) from public;
grant execute on function public.sync_fulfillment_receipt_for_transaction(text, uuid) to authenticated;

notify pgrst, 'reload schema';

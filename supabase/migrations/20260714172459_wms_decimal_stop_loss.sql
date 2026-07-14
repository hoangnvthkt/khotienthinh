-- Release A1: keep WMS quantities decimal end-to-end while the inventory
-- ledger remains numeric(18, 4). This is a forward-only stop-loss migration;
-- A2 owns any future ledger widening or precision-policy changes.

create or replace function public.process_transaction_status(
  p_transaction_id text,
  p_status public.transaction_status,
  p_approver_id uuid
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_line jsonb;
  v_pending jsonb;
  v_check record;
  v_item_id text;
  v_qty numeric;
  v_on_hand numeric;
  v_tx_reserved numeric;
  v_request_reserved numeric;
  v_reserved numeric;
  v_available numeric;
  v_item_name text;
  v_warehouse_name text;
  v_stock_warehouse_id text;
  v_is_fulfillment_transfer boolean := false;
  v_can_approve boolean := false;
  v_can_complete boolean := false;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
    where nullif(line.value->>'fulfillmentBatchId', '') is not null
  )
  into v_is_fulfillment_transfer;

  v_is_fulfillment_transfer := v_is_fulfillment_transfer
    and v_tx.type = 'TRANSFER'::public.transaction_type
    and nullif(v_tx.target_warehouse_id, '') is not null;

  v_can_approve := app_private.wms_has_action(
    'wms.transaction.approve',
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  v_can_complete := app_private.wms_has_action(
    'wms.transaction.complete',
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  if p_status = 'APPROVED'::public.transaction_status and not v_can_approve then
    raise exception 'insufficient privilege to approve transaction'
      using errcode = '42501';
  end if;

  if p_status = 'CANCELLED'::public.transaction_status
     and not v_can_approve
     and v_tx.requester_id is distinct from v_user.id then
    raise exception 'insufficient privilege to cancel transaction'
      using errcode = '42501';
  end if;

  if p_status = 'COMPLETED'::public.transaction_status and not v_can_complete then
    raise exception 'insufficient privilege to complete transaction'
      using errcode = '42501';
  end if;

  if v_tx.status = p_status then
    return v_tx;
  end if;
  if v_tx.status = 'CANCELLED'::public.transaction_status then
    raise exception 'cancelled transaction cannot be changed';
  end if;
  if v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'completed transaction cannot be changed';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_line in
      select value from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb))
    loop
      v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
      if v_qty <> 0 and v_qty <> round(v_qty, 4) then
        raise exception 'transaction quantity supports at most 4 fractional digits: %', v_qty;
      end if;
    end loop;
  end if;

  if p_status = 'COMPLETED'::public.transaction_status
     and v_is_fulfillment_transfer
     and v_tx.status <> 'APPROVED'::public.transaction_status then
    raise exception 'Đợt cấp cần được thủ kho công trường duyệt số lượng/chất lượng trước khi xác nhận nhập kho.';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status)
     and v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type, 'ADJUSTMENT'::public.transaction_type) then
    v_stock_warehouse_id := case
      when v_tx.type = 'ADJUSTMENT'::public.transaction_type then v_tx.target_warehouse_id
      else v_tx.source_warehouse_id
    end;
    if nullif(v_stock_warehouse_id, '') is null then
      raise exception 'source warehouse is required for stock-out transaction';
    end if;

    for v_check in
      select
        line.value->>'itemId' as item_id,
        sum(
          case
            when v_tx.type = 'ADJUSTMENT'::public.transaction_type
              then abs(least(0, coalesce(nullif(line.value->>'quantity', '')::numeric, 0)))
            else coalesce(nullif(line.value->>'quantity', '')::numeric, 0)
          end
        ) as qty
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
      group by line.value->>'itemId'
    loop
      v_item_id := v_check.item_id;
      v_qty := coalesce(v_check.qty, 0);
      if v_item_id is null then
        raise exception 'invalid transaction item payload';
      end if;
      if v_qty <= 0 then
        if v_tx.type = 'ADJUSTMENT'::public.transaction_type then
          continue;
        end if;
        raise exception 'invalid transaction item payload';
      end if;

      select
        coalesce((coalesce(i.stock_by_warehouse, '{}'::jsonb) ->> v_stock_warehouse_id)::numeric, 0),
        i.name
      into v_on_hand, v_item_name
      from public.items i
      where i.id = v_item_id
      for update;
      if not found then
        raise exception 'item not found: %', v_item_id;
      end if;

      select coalesce(sum(coalesce(nullif(line.value->>'quantity', '')::numeric, 0)), 0)
      into v_tx_reserved
      from public.transactions t
      cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) line(value)
      where t.id <> v_tx.id
        and t.source_warehouse_id = v_stock_warehouse_id
        and t.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
        and t.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type)
        and line.value->>'itemId' = v_item_id;

      select coalesce(sum(
        case
          when r.status = 'PENDING'::public.request_status
            then coalesce(nullif(line.value->>'requestQty', '')::numeric, 0)
          else coalesce(nullif(line.value->>'approvedQty', '')::numeric, 0)
        end
      ), 0)
      into v_request_reserved
      from public.requests r
      cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) line(value)
      where r.source_warehouse_id = v_stock_warehouse_id
        and (v_tx.related_request_id is null or r.id <> v_tx.related_request_id)
        and r.status in ('PENDING'::public.request_status, 'APPROVED'::public.request_status, 'IN_TRANSIT'::public.request_status)
        and not (
          (coalesce(r.request_origin, 'wms') = 'project' or r.project_id is not null or r.construction_site_id is not null)
          and r.status <> 'PENDING'::public.request_status
        )
        and line.value->>'itemId' = v_item_id;

      v_reserved := coalesce(v_tx_reserved, 0) + coalesce(v_request_reserved, 0);
      v_available := greatest(0, v_on_hand - v_reserved);
      if v_qty > v_available then
        select name into v_warehouse_name from public.warehouses where id = v_stock_warehouse_id;
        raise exception 'Không đủ tồn khả dụng tại kho "%": vật tư "%"; cần %, tồn thực %, đang giữ %, khả dụng %. Vui lòng xử lý phiếu pending/giữ chỗ trước.',
          coalesce(v_warehouse_name, v_stock_warehouse_id),
          coalesce(v_item_name, v_item_id),
          v_qty,
          v_on_hand,
          v_reserved,
          v_available;
      end if;
    end loop;
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_pending in
      select value from jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb))
    loop
      insert into public.items (
        id, sku, name, category, unit, purchase_unit,
        price_in, price_out, min_stock, supplier_id, image_url,
        stock_by_warehouse, location
      )
      values (
        v_pending->>'id',
        v_pending->>'sku',
        v_pending->>'name',
        coalesce(nullif(v_pending->>'category', ''), 'Khác'),
        coalesce(nullif(v_pending->>'unit', ''), 'Cái'),
        nullif(v_pending->>'purchaseUnit', ''),
        coalesce(nullif(v_pending->>'priceIn', '')::numeric, 0),
        coalesce(nullif(v_pending->>'priceOut', '')::numeric, 0),
        coalesce(nullif(v_pending->>'minStock', '')::integer, 0),
        nullif(v_pending->>'supplierId', ''),
        nullif(v_pending->>'imageUrl', ''),
        coalesce(v_pending->'stockByWarehouse', '{}'::jsonb),
        nullif(v_pending->>'location', '')
      )
      on conflict (id) do nothing;
    end loop;
  end if;

  if p_status = 'COMPLETED'::public.transaction_status then
    for v_line in
      select value from jsonb_array_elements(v_tx.items)
    loop
      v_item_id := v_line->>'itemId';
      v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
      if v_item_id is null
         or (v_tx.type = 'ADJUSTMENT'::public.transaction_type and v_qty = 0)
         or (v_tx.type <> 'ADJUSTMENT'::public.transaction_type and v_qty <= 0) then
        raise exception 'invalid transaction item payload';
      end if;

      if v_tx.type = 'IMPORT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type) then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
      elsif v_tx.type = 'TRANSFER'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type = 'ADJUSTMENT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  end if;

  update public.transactions
  set status = p_status,
      approver_id = p_approver_id
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$$;

revoke execute on function public.apply_stock_change(text, text, numeric) from public, anon, authenticated;

revoke all on function public.process_transaction_status(text, public.transaction_status, uuid) from public;
revoke all on function public.process_transaction_status(text, public.transaction_status, uuid) from anon;
grant execute on function public.process_transaction_status(text, public.transaction_status, uuid) to authenticated;

notify pgrst, 'reload schema';

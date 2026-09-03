-- Allow WAREHOUSE_KEEPER without assigned_warehouse_id to act as global WMS/material team.
-- This keeps site keepers scoped to one warehouse while routing unassigned project demand
-- requests and cross-warehouse operations to the material department.

create or replace function public.process_transaction_status(
  p_transaction_id text,
  p_status public.transaction_status,
  p_approver_id uuid
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_line jsonb;
  v_pending jsonb;
  v_item_id text;
  v_qty integer;
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

  v_can_approve :=
    public.is_module_admin('WMS')
    or (
      v_user.role = 'WAREHOUSE_KEEPER'
      and (
        v_user.assigned_warehouse_id is null
        or (v_tx.type = 'IMPORT'::public.transaction_type and v_user.assigned_warehouse_id is not distinct from v_tx.target_warehouse_id)
        or (v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type)
            and v_user.assigned_warehouse_id is not distinct from v_tx.source_warehouse_id)
      )
    );

  v_can_complete :=
    public.is_module_admin('WMS')
    or (
      v_user.role = 'WAREHOUSE_KEEPER'
      and (
        v_user.assigned_warehouse_id is null
        or (v_tx.type in ('IMPORT'::public.transaction_type, 'TRANSFER'::public.transaction_type)
            and v_user.assigned_warehouse_id is not distinct from v_tx.target_warehouse_id)
        or (v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type)
            and v_user.assigned_warehouse_id is not distinct from v_tx.source_warehouse_id)
      )
    );

  if p_status = 'APPROVED'::public.transaction_status and not v_can_approve then
    raise exception 'insufficient privilege to approve transaction';
  end if;

  if p_status = 'CANCELLED'::public.transaction_status
     and not v_can_approve
     and v_tx.requester_id is distinct from v_user.id then
    raise exception 'insufficient privilege to cancel transaction';
  end if;

  if p_status = 'COMPLETED'::public.transaction_status and not v_can_complete then
    raise exception 'insufficient privilege to complete transaction';
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
      v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0)::integer;
      if v_item_id is null or v_qty <= 0 then
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

revoke all on function public.process_transaction_status(text, public.transaction_status, uuid) from public;
grant execute on function public.process_transaction_status(text, public.transaction_status, uuid) to authenticated;

notify pgrst, 'reload schema';

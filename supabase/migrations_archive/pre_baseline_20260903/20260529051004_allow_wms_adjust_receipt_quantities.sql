-- Allow destination warehouse keepers to record the checked/received
-- quantities on an in-flight WMS transaction before changing status.
-- This is intentionally exposed through an RPC instead of direct UPDATE RLS
-- so callers can only adjust quantities on rows they are allowed to process.

create or replace function public.update_transaction_items_for_receipt(
  p_transaction_id text,
  p_items jsonb
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_item_count integer;
  v_idx integer;
  v_old_item jsonb;
  v_new_item jsonb;
  v_old_qty numeric;
  v_new_qty numeric;
  v_is_fulfillment_transfer boolean := false;
  v_can_adjust boolean := false;
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

  if v_tx.status not in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status) then
    raise exception 'Chỉ được điều chỉnh số lượng ở bước chờ duyệt hoặc chờ xác nhận nhập.';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid transaction items payload';
  end if;

  v_item_count := jsonb_array_length(coalesce(v_tx.items, '[]'::jsonb));
  if v_item_count = 0 then
    raise exception 'Phiếu kho không có dòng vật tư để điều chỉnh.';
  end if;
  if jsonb_array_length(p_items) <> v_item_count then
    raise exception 'Không được thêm/xóa dòng vật tư khi duyệt phiếu kho.';
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

  v_can_adjust :=
    public.is_module_admin('WMS')
    or (
      v_user.role = 'WAREHOUSE_KEEPER'
      and (
        v_user.assigned_warehouse_id is null
        or (v_tx.type = 'IMPORT'::public.transaction_type and v_user.assigned_warehouse_id is not distinct from v_tx.target_warehouse_id)
        or (v_is_fulfillment_transfer and v_user.assigned_warehouse_id is not distinct from v_tx.target_warehouse_id)
        or (
          v_tx.status = 'APPROVED'::public.transaction_status
          and v_tx.type = 'TRANSFER'::public.transaction_type
          and v_user.assigned_warehouse_id is not distinct from v_tx.target_warehouse_id
        )
      )
    );

  if not v_can_adjust then
    raise exception 'insufficient privilege to adjust transaction quantities';
  end if;

  for v_idx in 0..(v_item_count - 1) loop
    v_old_item := v_tx.items -> v_idx;
    v_new_item := p_items -> v_idx;

    if v_old_item is null or v_new_item is null then
      raise exception 'invalid transaction items payload';
    end if;

    if coalesce(v_old_item->>'itemId', '') is distinct from coalesce(v_new_item->>'itemId', '')
       or coalesce(v_old_item->>'requestLineId', '') is distinct from coalesce(v_new_item->>'requestLineId', '')
       or coalesce(v_old_item->>'fulfillmentBatchId', '') is distinct from coalesce(v_new_item->>'fulfillmentBatchId', '') then
      raise exception 'Không được đổi vật tư/dòng đề xuất khi duyệt phiếu kho.';
    end if;

    v_old_qty := coalesce(nullif(v_old_item->>'quantity', '')::numeric, 0);
    v_new_qty := coalesce(nullif(v_new_item->>'quantity', '')::numeric, 0);

    if v_new_qty < 0 then
      raise exception 'Số lượng thực nhận không được âm.';
    end if;
    if v_new_qty > v_old_qty then
      raise exception 'Số lượng thực nhận không được lớn hơn số lượng trên phiếu. Vui lòng tạo bổ sung/điều chỉnh PO nếu có giao vượt.';
    end if;
  end loop;

  update public.transactions
  set items = p_items
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$$;

revoke all on function public.update_transaction_items_for_receipt(text, jsonb) from public;
grant execute on function public.update_transaction_items_for_receipt(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- PO actual receipt: direct WMS linkage, quantity variance audit, and private
-- evidence attachments. This migration deliberately keeps the original PO
-- quantity untouched; WMS transaction items carry the approved actual.

create schema if not exists app_private;

alter table public.purchase_order_delivery_batches
  add column if not exists wms_transaction_id text
    references public.transactions(id) on delete set null;

create unique index if not exists uq_po_delivery_batch_wms_transaction
  on public.purchase_order_delivery_batches(wms_transaction_id)
  where wms_transaction_id is not null;

alter table public.transactions
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.transactions
  drop constraint if exists transactions_attachments_array_check;

alter table public.transactions
  add constraint transactions_attachments_array_check
  check (jsonb_typeof(attachments) = 'array');

create unique index if not exists uq_transaction_po_delivery_source
  on public.transactions(source_type, source_id)
  where source_type = 'po_delivery_batch' and source_id is not null;

insert into storage.buckets (id, name, public, file_size_limit)
values ('wms-transaction-attachments', 'wms-transaction-attachments', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800;

create or replace function app_private.wms_transaction_attachment_can_access(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.transactions tx
      where tx.id = split_part(p_object_name, '/', 1)
        and (
          app_private.current_user_is_wms_keeper_for(tx.target_warehouse_id)
          or app_private.current_user_is_wms_keeper_for(tx.source_warehouse_id)
          or tx.requester_id::text = public.current_app_user_id()::text
        )
    ),
    false
  );
$$;

revoke all on function app_private.wms_transaction_attachment_can_access(text)
  from public, anon;
grant execute on function app_private.wms_transaction_attachment_can_access(text)
  to authenticated;

drop policy if exists wms_transaction_attachments_select on storage.objects;
create policy wms_transaction_attachments_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'wms-transaction-attachments'
  and split_part(name, '/', 1) <> ''
  and app_private.wms_transaction_attachment_can_access(name)
);

drop policy if exists wms_transaction_attachments_insert on storage.objects;
create policy wms_transaction_attachments_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'wms-transaction-attachments'
  and split_part(name, '/', 1) <> ''
  and app_private.wms_transaction_attachment_can_access(name)
);

drop policy if exists wms_transaction_attachments_delete on storage.objects;
create policy wms_transaction_attachments_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'wms-transaction-attachments'
  and split_part(name, '/', 1) <> ''
  and app_private.wms_transaction_attachment_can_access(name)
);

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
  v_ordered_qty numeric;
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
    v_ordered_qty := coalesce(
      nullif(v_new_item->>'orderedQty', '')::numeric,
      nullif(v_new_item->>'ordered_qty', '')::numeric,
      v_old_qty
    );

    if v_new_qty < 0 then
      raise exception 'Số lượng thực nhận không được âm.';
    end if;
    if v_ordered_qty < 0 then
      raise exception 'Số lượng đặt không được âm.';
    end if;
    if v_new_qty is distinct from v_ordered_qty
       and nullif(trim(coalesce(v_new_item->>'varianceReason', '')), '') is null
       and nullif(trim(coalesce(v_new_item->>'variance_reason', '')), '') is null then
      raise exception 'Phải nhập lý do khi số lượng thực nhận lệch số lượng trên phiếu.';
    end if;
  end loop;

  update public.transactions
  set items = p_items
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$$;

revoke all on function public.update_transaction_items_for_receipt(text, jsonb) from public, anon;
grant execute on function public.update_transaction_items_for_receipt(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

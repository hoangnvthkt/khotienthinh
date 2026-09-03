-- Acquire WMS transaction locks before the delivery-group update implementation.
-- This matches the transaction -> fulfillment batch -> delivery group order used
-- when WMS rejects a receipt and prevents a concurrent edit/rejection deadlock.

alter function public.update_purchase_order_delivery_group_v1(uuid, timestamptz, text, jsonb)
  rename to project_po_update_delivery_group_impl_v1;

alter function public.project_po_update_delivery_group_impl_v1(uuid, timestamptz, text, jsonb)
  set schema app_private;

revoke all on function app_private.project_po_update_delivery_group_impl_v1(uuid, timestamptz, text, jsonb)
  from public, anon, authenticated;

create function public.update_purchase_order_delivery_group_v1(
  p_delivery_group_id uuid,
  p_planned_date timestamptz,
  p_note text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_delivery_group_id is null then
    raise exception 'Không tìm thấy đợt giao cần sửa.';
  end if;

  perform 1
  from public.transactions transaction_row
  where transaction_row.id::text in (
    select batch.transaction_id::text
    from public.material_request_fulfillment_batches batch
    where batch.po_delivery_group_id = p_delivery_group_id
      and batch.transaction_id is not null
  )
  order by transaction_row.id
  for update;

  return app_private.project_po_update_delivery_group_impl_v1(
    p_delivery_group_id,
    p_planned_date,
    p_note,
    p_lines
  );
end;
$$;

revoke all on function public.update_purchase_order_delivery_group_v1(uuid, timestamptz, text, jsonb)
  from public, anon;
grant execute on function public.update_purchase_order_delivery_group_v1(uuid, timestamptz, text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';

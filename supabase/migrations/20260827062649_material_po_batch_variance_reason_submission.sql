-- Allow the person sending a draft delivery batch for approval to record the
-- practical reason when its total quantity exceeds the MR snapshot. This is a
-- narrowly-scoped command: it cannot alter quantities, price, VAT or a batch
-- that has already been submitted/approved.
create or replace function app_private.set_material_po_batch_variance_reason(
  p_delivery_batch_id uuid,
  p_variance_reason text,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
begin
  if p_actor_user_id is null
     or public.current_app_user_id() is null
     or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;

  select batch.* into v_batch
  from public.purchase_order_delivery_batches batch
  where batch.id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = '22023';
  end if;

  select po.* into v_po
  from public.purchase_orders po
  where po.id = v_batch.purchase_order_id;

  if v_po.source_mode <> 'from_request' or v_po.purchase_mode <> 'multiple' then
    raise exception 'Chỉ áp dụng lý do vượt nhu cầu cho PO vật tư giao nhiều lần.' using errcode = '22023';
  end if;
  if coalesce(v_batch.approval_status, 'draft') not in ('draft', 'revision_requested', 'rejected')
     or v_batch.wms_transaction_id is not null
     or v_batch.status <> 'planned' then
    raise exception 'Đợt đã gửi duyệt hoặc đã tạo WMS nên không thể cập nhật lý do.' using errcode = '22023';
  end if;

  perform app_private.assert_project_permission_room_action(
    v_po.project_id,
    v_po.construction_site_id,
    'material_po',
    'submit',
    p_actor_user_id
  );

  update public.purchase_order_delivery_batches
  set variance_reason = nullif(trim(coalesce(p_variance_reason, '')), ''),
      updated_at = now()
  where id = v_batch.id;

  return jsonb_build_object(
    'deliveryBatchId', v_batch.id,
    'varianceReason', nullif(trim(coalesce(p_variance_reason, '')), '')
  );
end;
$$;

revoke all on function app_private.set_material_po_batch_variance_reason(uuid, text, uuid)
  from public, anon;
grant execute on function app_private.set_material_po_batch_variance_reason(uuid, text, uuid)
  to authenticated;

create or replace function public.set_material_po_batch_variance_reason(
  p_delivery_batch_id uuid,
  p_variance_reason text default null,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  return app_private.set_material_po_batch_variance_reason(
    p_delivery_batch_id,
    p_variance_reason,
    v_actor
  );
end;
$$;

revoke all on function public.set_material_po_batch_variance_reason(uuid, text, uuid)
  from public, anon;
grant execute on function public.set_material_po_batch_variance_reason(uuid, text, uuid)
  to authenticated;

-- A multiple-delivery PO is approved per batch. Persist the selected approver
-- on that batch, then enforce that only this person (or an administrator) can
-- approve, return for revision, or reject it.

alter table public.purchase_order_delivery_batches
  add column if not exists approval_assignee_user_id uuid;

-- Recover active assignments created before the assignee field existed.  The
-- submission notification is the durable record of the recipient selected by
-- the creator, so use its newest recipient for each pending batch.
with latest_submission_notifications as (
  select
    source_id,
    user_id::uuid as user_id,
    row_number() over (partition by source_id order by created_at desc) as row_no
  from public.notifications
  where source_type = 'purchase_order_delivery_batch'
    and user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
update public.purchase_order_delivery_batches batch
set approval_assignee_user_id = notification.user_id
from latest_submission_notifications notification
where notification.source_id = batch.id::text
  and notification.row_no = 1
  and batch.approval_status = 'pending_approval'
  and batch.approval_assignee_user_id is null;

create or replace function app_private.submit_material_po_batch(
  p_delivery_batch_id uuid,
  p_approver_user_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  if p_approver_user_id is null then
    raise exception 'Phải chọn người duyệt đợt giao.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = '22023';
  end if;
  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;

  if coalesce(v_po.source_mode, '') <> 'from_request'
     or coalesce(v_po.purchase_mode, '') <> 'multiple' then
    raise exception 'Chỉ gửi duyệt từng đợt cho PO vật tư giao nhiều lần.' using errcode = '22023';
  end if;
  perform app_private.assert_project_permission_room_action(
    v_po.project_id, v_po.construction_site_id, 'material_po', 'submit', v_actor
  );
  perform app_private.assert_project_permission_room_action(
    v_po.project_id, v_po.construction_site_id, 'material_po', 'approve', p_approver_user_id
  );

  if v_batch.status <> 'planned'
     or v_batch.wms_transaction_id is not null
     or v_batch.qr_token is not null then
    raise exception 'Chỉ gửi duyệt đợt nháp chưa tạo WMS/QR.' using errcode = '22023';
  end if;
  if coalesce(v_batch.approval_status, 'draft') not in ('draft', 'revision_requested', 'rejected') then
    raise exception 'Đợt giao đang chờ duyệt hoặc đã duyệt.' using errcode = '22023';
  end if;
  if v_batch.supplier_id is not null
     and v_batch.supplier_id is distinct from v_po.vendor_id then
    raise exception 'Nhà cung cấp của đợt giao không khớp PO.' using errcode = '22023';
  end if;
  if coalesce(v_batch.vat_rate, v_po.vat_rate, 0) < 0
     or coalesce(v_batch.vat_rate, v_po.vat_rate, 0) > 100 then
    raise exception 'Thuế VAT phải trong khoảng 0 đến 100.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.purchase_order_delivery_lines line
    where line.delivery_batch_id = v_batch.id
      and line.planned_qty > 0
      and line.stock_planned_qty > 0
      and coalesce(line.delivery_unit_price, 0) >= 0
  ) then
    raise exception 'Đợt giao phải có số lượng lớn hơn 0 và đơn giá không âm.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.purchase_order_delivery_lines line
    where line.delivery_batch_id = v_batch.id
      and (
        line.planned_qty <= 0
        or line.stock_planned_qty <= 0
        or coalesce(line.delivery_unit_price, 0) < 0
      )
  ) then
    raise exception 'Mọi dòng đợt giao phải có số lượng lớn hơn 0 và đơn giá không âm.'
      using errcode = '22023';
  end if;

  perform app_private.assert_material_po_batch_overage_reason(v_po.id, v_batch.id);

  update public.purchase_order_delivery_batches
  set approval_status = 'pending_approval',
      approval_assignee_user_id = p_approver_user_id,
      approval_requested_by = v_actor,
      approval_requested_at = now(),
      approval_decided_by = null,
      approval_decided_at = null,
      approval_decision_note = null,
      updated_at = now()
  where id = v_batch.id;

  return jsonb_build_object(
    'deliveryBatchId', v_batch.id,
    'approvalStatus', 'pending_approval',
    'approverUserId', p_approver_user_id
  );
end;
$$;

create or replace function app_private.decide_material_po_batch(
  p_delivery_batch_id uuid,
  p_decision text,
  p_note text,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  if p_decision not in ('revision_requested', 'rejected') then
    raise exception 'Quyết định duyệt không hợp lệ.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = '22023';
  end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id;
  perform app_private.assert_project_permission_room_action(
    v_po.project_id, v_po.construction_site_id, 'material_po', 'approve', v_actor
  );
  if not public.is_admin() and v_batch.approval_assignee_user_id is distinct from v_actor then
    raise exception 'Chỉ người được giao duyệt đợt mới có thể trả lại hoặc từ chối.' using errcode = '42501';
  end if;

  if coalesce(v_batch.approval_status, 'draft') <> 'pending_approval'
     or v_batch.wms_transaction_id is not null then
    raise exception 'Chỉ xử lý đợt đang chờ duyệt.' using errcode = '22023';
  end if;

  update public.purchase_order_delivery_batches
  set approval_status = p_decision,
      approval_decided_by = v_actor,
      approval_decided_at = now(),
      approval_decision_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = v_batch.id;

  return jsonb_build_object(
    'deliveryBatchId', v_batch.id,
    'approvalStatus', p_decision
  );
end;
$$;

create or replace function app_private.approve_material_po_batch(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_result jsonb;
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = '22023';
  end if;
  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;

  if coalesce(v_po.source_mode, '') <> 'from_request'
     or coalesce(v_po.purchase_mode, '') <> 'multiple' then
    raise exception 'Chỉ duyệt từng đợt cho PO vật tư giao nhiều lần.' using errcode = '22023';
  end if;
  perform app_private.assert_project_permission_room_action(
    v_po.project_id, v_po.construction_site_id, 'material_po', 'approve', v_actor
  );
  if not public.is_admin() and v_batch.approval_assignee_user_id is distinct from v_actor then
    raise exception 'Chỉ người được giao duyệt đợt mới có thể duyệt.' using errcode = '42501';
  end if;

  if coalesce(v_batch.approval_status, 'draft') = 'approved'
     and v_batch.wms_transaction_id is not null then
    return app_private.ensure_material_po_batch_wms(v_batch.id, v_actor)
      || jsonb_build_object('approvalStatus', 'approved');
  end if;
  if coalesce(v_batch.approval_status, 'draft') not in ('pending_approval', 'approved')
     or (v_batch.wms_transaction_id is not null and v_batch.approval_status <> 'approved') then
    raise exception 'Chỉ duyệt đợt đang chờ duyệt hoặc khôi phục đợt đã duyệt thiếu WMS.'
      using errcode = '22023';
  end if;

  perform app_private.assert_material_po_batch_overage_reason(v_po.id, v_batch.id);
  v_result := app_private.ensure_material_po_batch_wms(v_batch.id, v_actor);

  update public.purchase_order_delivery_batches
  set approval_status = 'approved',
      approval_decided_by = coalesce(approval_decided_by, v_actor),
      approval_decided_at = coalesce(approval_decided_at, now()),
      approval_decision_note = null,
      updated_at = now()
  where id = v_batch.id;

  return v_result || jsonb_build_object('approvalStatus', 'approved');
end;
$$;

revoke all on function app_private.submit_material_po_batch(uuid, uuid, uuid)
  from public, anon;
revoke all on function app_private.decide_material_po_batch(uuid, text, text, uuid)
  from public, anon;
revoke all on function app_private.approve_material_po_batch(uuid, uuid)
  from public, anon;
grant execute on function app_private.submit_material_po_batch(uuid, uuid, uuid)
  to authenticated;
grant execute on function app_private.decide_material_po_batch(uuid, text, text, uuid)
  to authenticated;
grant execute on function app_private.approve_material_po_batch(uuid, uuid)
  to authenticated;

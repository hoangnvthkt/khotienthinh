-- Cancelling a material-issue order before stock leaves the warehouse is the
-- rejection side of approval. It is not the post-issue reversal capability.
create or replace function app_private.material_issue_can_cancel(
  p_source_warehouse_id text,
  p_created_by uuid
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
    or p_created_by = public.current_app_user_id()
    or app_private.wms_has_canonical_action(
      'wms.transaction.approve',
      p_source_warehouse_id,
      null,
      null,
      null,
      public.current_app_user_id()
    ),
    false
  );
$$;

revoke all on function app_private.material_issue_can_cancel(text, uuid)
  from public, anon, authenticated;

create or replace function public.cancel_material_issue_order(
  p_order_id uuid,
  p_reason text
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Bắt buộc nhập lý do huỷ.';
  end if;
  select * into v_order
  from public.material_issue_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in ('draft', 'submitted', 'wms_pending') then
    raise exception 'Phiếu đã phát sinh xuất kho hoặc quyết toán, không thể huỷ trực tiếp.';
  end if;
  if not app_private.material_issue_can_cancel(
    v_order.source_warehouse_id,
    v_order.created_by
  ) then
    raise exception 'Bạn không có quyền huỷ phiếu này.';
  end if;
  if v_order.transaction_id is not null then
    update public.transactions
    set status = 'CANCELLED', approver_id = v_actor
    where id = v_order.transaction_id and status = 'PENDING';
  end if;
  update public.material_issue_orders
  set status = 'cancelled',
      cancelled_by = v_actor,
      cancelled_at = now(),
      cancel_reason = trim(p_reason)
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

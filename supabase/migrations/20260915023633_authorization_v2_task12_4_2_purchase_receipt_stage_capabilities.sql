-- Preserve legacy receipt personas inside the private implementation while
-- allowing canonical approve/complete grants at the target warehouse.
create or replace function app_private.current_user_can_receive_purchase_batch_v2(
  p_actor_user_id uuid,
  p_target_warehouse_id text
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
    or app_private.current_user_is_wms_keeper_for(p_target_warehouse_id)
    or app_private.wms_has_action(
      'wms.transaction.approve', null, p_target_warehouse_id,
      null, null, p_actor_user_id
    )
    or app_private.wms_has_action(
      'wms.transaction.complete', null, p_target_warehouse_id,
      null, null, p_actor_user_id
    )
    or exists (
      select 1
      from public.users u
      where u.id = p_actor_user_id
        and u.is_active is not false
        and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
        and u.role::text in ('ADMIN', 'WAREHOUSE_KEEPER', 'KEEPER')
        and (
          u.assigned_warehouse_id is null
          or u.assigned_warehouse_id = p_target_warehouse_id
        )
    ),
    false
  );
$$;

-- Public wrappers call this as their definer. Clients cannot invoke it or the
-- underlying implementation functions directly.
create or replace function app_private.require_purchase_receipt_stage_action(
  p_wms_transaction_id text,
  p_actor_user_id uuid,
  p_permission_code text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_tx public.transactions%rowtype;
begin
  if p_permission_code not in (
    'wms.transaction.approve',
    'wms.transaction.complete'
  ) then
    raise exception 'unsupported purchase receipt permission: %', p_permission_code
      using errcode = '22023';
  end if;

  if v_actor is null
     or (p_actor_user_id is not null and p_actor_user_id is distinct from v_actor) then
    raise exception 'Người thực hiện lệnh không hợp lệ.'
      using errcode = '42501';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_wms_transaction_id;
  if not found then
    raise exception 'Không tìm thấy phiếu WMS.' using errcode = '22023';
  end if;

  if not app_private.wms_transaction_has_action(
    p_permission_code,
    v_tx.type,
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.items,
    v_tx.requester_id,
    v_tx.approver_id,
    v_actor
  ) then
    raise exception 'Người dùng không có quyền thao tác nhận hàng tại kho.'
      using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

create or replace function public.approve_material_po_quality(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid default null,
  p_quality_result text default 'passed',
  p_lines jsonb default '[]'::jsonb,
  p_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := app_private.require_purchase_receipt_stage_action(
    p_wms_transaction_id,
    p_actor_user_id,
    'wms.transaction.approve'
  );

  return app_private.approve_material_po_quality(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor,
    p_quality_result,
    p_lines,
    p_attachments
  );
end;
$$;

create or replace function public.approve_receipt_quality_v2(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid default null,
  p_quality_result text default 'passed',
  p_lines jsonb default '[]'::jsonb,
  p_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := app_private.require_purchase_receipt_stage_action(
    p_wms_transaction_id,
    p_actor_user_id,
    'wms.transaction.approve'
  );

  return app_private.approve_receipt_quality_v2(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor,
    p_quality_result,
    p_lines,
    p_attachments
  );
end;
$$;

create or replace function public.finalize_purchase_receipt_v2(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := app_private.require_purchase_receipt_stage_action(
    p_wms_transaction_id,
    p_actor_user_id,
    'wms.transaction.complete'
  );

  return app_private.finalize_purchase_receipt_v2(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor
  );
end;
$$;

create or replace function public.finalize_material_po_receipt(
  p_delivery_batch_id uuid,
  p_wms_transaction_id text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_result jsonb;
  v_po_id text;
  v_purchase_mode text;
  v_previous_guard text;
begin
  v_actor := app_private.require_purchase_receipt_stage_action(
    p_wms_transaction_id,
    p_actor_user_id,
    'wms.transaction.complete'
  );

  v_result := app_private.finalize_purchase_receipt_v2(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor
  );

  select batch.purchase_order_id, po.purchase_mode
  into v_po_id, v_purchase_mode
  from public.purchase_order_delivery_batches batch
  join public.purchase_orders po on po.id = batch.purchase_order_id
  where batch.id = p_delivery_batch_id;

  if coalesce(v_purchase_mode, 'single') = 'single'
     and v_result ->> 'transactionStatus' = 'COMPLETED' then
    v_previous_guard := current_setting('app.material_transition_context', true);
    perform set_config('app.material_transition_context', 'on', true);
    update public.purchase_orders
    set status = 'delivered',
        actual_delivery_date = coalesce(actual_delivery_date, current_date::text)
    where id = v_po_id;
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    v_result := v_result || jsonb_build_object('purchaseOrderStatus', 'delivered');
  else
    v_result := v_result || jsonb_build_object(
      'purchaseOrderStatus', (select status from public.purchase_orders where id = v_po_id)
    );
  end if;

  return v_result;
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function app_private.current_user_can_receive_purchase_batch_v2(uuid, text)
  from public, anon, authenticated;
grant execute on function app_private.current_user_can_receive_purchase_batch_v2(uuid, text)
  to service_role;

revoke all on function app_private.require_purchase_receipt_stage_action(text, uuid, text)
  from public, anon, authenticated;
grant execute on function app_private.require_purchase_receipt_stage_action(text, uuid, text)
  to service_role;

revoke all on function app_private.approve_material_po_quality(uuid, text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.approve_receipt_quality_v2(uuid, text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.finalize_purchase_receipt_v2(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function app_private.approve_material_po_quality(uuid, text, uuid, text, jsonb, jsonb)
  to service_role;
grant execute on function app_private.approve_receipt_quality_v2(uuid, text, uuid, text, jsonb, jsonb)
  to service_role;
grant execute on function app_private.finalize_purchase_receipt_v2(uuid, text, uuid)
  to service_role;

revoke all on function public.approve_material_po_quality(uuid, text, uuid, text, jsonb, jsonb)
  from public, anon;
revoke all on function public.approve_receipt_quality_v2(uuid, text, uuid, text, jsonb, jsonb)
  from public, anon;
revoke all on function public.finalize_purchase_receipt_v2(uuid, text, uuid)
  from public, anon;
revoke all on function public.finalize_material_po_receipt(uuid, text, uuid)
  from public, anon;
grant execute on function public.approve_material_po_quality(uuid, text, uuid, text, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function public.approve_receipt_quality_v2(uuid, text, uuid, text, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function public.finalize_purchase_receipt_v2(uuid, text, uuid)
  to authenticated, service_role;
grant execute on function public.finalize_material_po_receipt(uuid, text, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

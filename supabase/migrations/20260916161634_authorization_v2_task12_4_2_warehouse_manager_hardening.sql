-- Task 12.4.2 / E31: make the two WAREHOUSE_MANAGER blockers enforceable.
-- Warehouse-scoped managers may adjust stock and update their assigned warehouse.
-- Shared material/warehouse-type catalogs and warehouse create/delete remain global.

create or replace function app_private.adjust_inventory_stock_impl(
  p_item_id text,
  p_warehouse_id text,
  p_new_quantity numeric,
  p_expected_current_quantity numeric,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_stock jsonb;
  v_current numeric;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_actor_id is null then
    raise exception 'Active application account required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_item_id, '')), '') is null
     or nullif(btrim(coalesce(p_warehouse_id, '')), '') is null then
    raise exception 'Item and warehouse are required' using errcode = '22023';
  end if;
  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'Inventory quantity must be non-negative' using errcode = '22023';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'Inventory adjustment reason must contain at least 10 characters'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.warehouses warehouse_row
    where warehouse_row.id = p_warehouse_id
      and not coalesce(warehouse_row.is_archived, false)
  ) then
    raise exception 'Active warehouse required' using errcode = '23503';
  end if;
  if not app_private.wms_has_action(
    'wms.inventory.edit', p_warehouse_id, null, null, null, v_actor_id
  ) then
    raise exception 'WMS inventory edit permission required for warehouse'
      using errcode = '42501';
  end if;

  select coalesce(item_row.stock_by_warehouse, '{}'::jsonb)
    into v_stock
  from public.items item_row
  where item_row.id = p_item_id
  for update;
  if not found then
    raise exception 'Inventory item does not exist' using errcode = '23503';
  end if;

  v_current := coalesce(nullif(v_stock ->> p_warehouse_id, '')::numeric, 0);
  if p_expected_current_quantity is null
     or v_current is distinct from p_expected_current_quantity then
    raise exception 'WMS_INVENTORY_STALE_QUANTITY' using errcode = '40001';
  end if;

  v_stock := jsonb_set(
    v_stock,
    array[p_warehouse_id],
    to_jsonb(case when abs(p_new_quantity) < 0.000000001 then 0 else p_new_quantity end),
    true
  );

  update public.items
  set stock_by_warehouse = v_stock
  where id = p_item_id;

  insert into public.permission_audit_events (
    actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
  ) values (
    v_actor_id,
    v_actor_id,
    'wms_inventory_stock_adjusted',
    jsonb_build_array(jsonb_build_object(
      'itemId', p_item_id,
      'warehouseId', p_warehouse_id,
      'quantity', v_current
    )),
    jsonb_build_array(jsonb_build_object(
      'itemId', p_item_id,
      'warehouseId', p_warehouse_id,
      'quantity', p_new_quantity
    )),
    jsonb_build_object(
      'permissionCode', 'wms.inventory.edit',
      'scopeType', 'warehouse',
      'scopeId', p_warehouse_id,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'itemId', p_item_id,
    'warehouseId', p_warehouse_id,
    'previousQuantity', v_current,
    'quantity', p_new_quantity,
    'adjustedBy', v_actor_id,
    'adjustedAt', now()
  );
end;
$$;

create or replace function public.adjust_inventory_stock(
  p_item_id text,
  p_warehouse_id text,
  p_new_quantity numeric,
  p_expected_current_quantity numeric,
  p_reason text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app_private.adjust_inventory_stock_impl(
    p_item_id,
    p_warehouse_id,
    p_new_quantity,
    p_expected_current_quantity,
    p_reason
  );
$$;

revoke all on function app_private.adjust_inventory_stock_impl(text, text, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function app_private.adjust_inventory_stock_impl(text, text, numeric, numeric, text)
  to service_role;
revoke all on function public.adjust_inventory_stock(text, text, numeric, numeric, text)
  from public, anon;
grant execute on function public.adjust_inventory_stock(text, text, numeric, numeric, text)
  to authenticated, service_role;

-- This primitive is used inside guarded WMS commands. It must not remain a
-- directly callable stock mutation endpoint for every authenticated account.
revoke execute on function public.apply_stock_change(text, text, integer) from public, anon, authenticated;
revoke execute on function public.apply_stock_change(text, text, numeric) from public, anon, authenticated;

drop policy if exists warehouses_phase4_select on public.warehouses;
create policy warehouses_phase4_select
on public.warehouses
for select
to authenticated
using (
  (select app_private.can_manage_warehouse_site_bindings())
  or app_private.wms_has_action('wms.inventory.view', id)
  or app_private.wms_has_action('wms.inventory.edit', id)
  or app_private.wms_has_action('wms.master_data.manage', id)
);

drop policy if exists warehouses_phase4_update on public.warehouses;
create policy warehouses_phase4_update
on public.warehouses
for update
to authenticated
using (app_private.wms_has_action('wms.master_data.manage', id))
with check (app_private.wms_has_action('wms.master_data.manage', id));

-- INSERT/DELETE and global catalogs intentionally keep calling wms_has_action
-- without a warehouse resource. A warehouse-scoped role cannot satisfy those
-- checks; a global grant or the retained legacy admin compatibility is required.

update public.permission_actions
set grant_readiness = 'enforced',
    scope_modes = array['global', 'warehouse']::text[],
    risk_level = case
      when permission_code = 'wms.inventory.edit' then 'important'
      else risk_level
    end,
    description = case permission_code
      when 'wms.inventory.edit'
        then 'Điều chỉnh tồn kho trong phạm vi kho được cấp; sửa dữ liệu gốc vật tư cần quyền global.'
      when 'wms.master_data.manage'
        then 'Cập nhật kho trong phạm vi được cấp; tạo/xóa kho và danh mục dùng chung cần quyền global.'
      else description
    end,
    updated_at = now()
where permission_code in (
  'wms.inventory.edit',
  'wms.master_data.manage'
);

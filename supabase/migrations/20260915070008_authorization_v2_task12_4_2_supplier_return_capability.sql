-- A supplier return creates a pending WMS export and can later affect stock and
-- supplier finance. Give it a dedicated warehouse-scoped capability instead of
-- inferring it from generic transaction creation.
insert into public.permission_modules (
  application_code, code, name, routes, legacy_module_key, sort_order, is_active
) values (
  'wms', 'wms.purchase_order', 'Hoàn trả nhà cung cấp',
  array['/operations']::text[], 'WMS', 37, true
)
on conflict (code) do update set
  application_code = excluded.application_code,
  name = excluded.name,
  routes = excluded.routes,
  legacy_module_key = excluded.legacy_module_key,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

insert into public.permission_actions (
  module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order, is_active,
  risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code,
  direct_grant_allowed
) values (
  'wms.purchase_order', 'return_supplier',
  'wms.purchase_order.return_supplier', 'Trả hàng nhà cung cấp',
  'Tạo phiếu xuất trả nhà cung cấp từ lượng hàng đã nhận của PO.',
  array['global', 'warehouse']::text[], 'WMS', '/operations', true, 10, true,
  'important', true, false, false, 'enforced', 'wms', true
)
on conflict (permission_code) do update set
  module_code = excluded.module_code,
  action = excluded.action,
  label = excluded.label,
  description = excluded.description,
  scope_modes = excluded.scope_modes,
  legacy_module_key = excluded.legacy_module_key,
  legacy_route = excluded.legacy_route,
  legacy_admin_only = excluded.legacy_admin_only,
  sort_order = excluded.sort_order,
  is_active = true,
  risk_level = excluded.risk_level,
  is_business_action = excluded.is_business_action,
  is_business_approval = excluded.is_business_approval,
  direct_grant_requires_expiry = excluded.direct_grant_requires_expiry,
  grant_readiness = excluded.grant_readiness,
  access_application_code = excluded.access_application_code,
  direct_grant_allowed = excluded.direct_grant_allowed,
  updated_at = now();

create or replace function app_private.purchase_order_supplier_return_can_create(
  p_project_id text,
  p_construction_site_id text,
  p_source_warehouse_id text
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
    or app_private.material_has_action(
      p_project_id,
      p_construction_site_id,
      'project.material_po.manage',
      public.current_app_user_id()
    )
    or app_private.wms_has_canonical_action(
      'wms.purchase_order.return_supplier',
      p_source_warehouse_id,
      null,
      null,
      null,
      public.current_app_user_id()
    ),
    false
  );
$$;

revoke all on function app_private.purchase_order_supplier_return_can_create(
  text, text, text
) from public, anon, authenticated;
grant execute on function app_private.purchase_order_supplier_return_can_create(
  text, text, text
) to service_role;

-- Preserve the deployed supplier-return implementation byte-for-byte except
-- for its authorization block. Abort if the expected predecessor definition
-- has drifted, instead of silently producing a partially guarded command.
do $migration$
declare
  v_definition text;
  v_old_guard text := $old_guard$  if not (
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or app_private.material_has_action(
      v_po.project_id::text,
      v_po.construction_site_id::text,
      'project.material_po.manage',
      v_actor
    )
  ) then
    raise exception 'Bạn cần quyền quản trị PO, Admin, quản trị WMS hoặc thủ kho tổng để tạo phiếu trả hàng NCC.'
      using errcode = '42501';
  end if;$old_guard$;
  v_new_guard text := $new_guard$  if not app_private.purchase_order_supplier_return_can_create(
    v_po.project_id::text,
    v_po.construction_site_id::text,
    p_source_warehouse_id
  ) then
    raise exception 'Bạn không có quyền trả hàng NCC tại kho đã chọn.'
      using errcode = '42501';
  end if;$new_guard$;
begin
  select pg_get_functiondef(
    'public.create_purchase_order_supplier_return(text,text,jsonb,text,text)'::regprocedure
  ) into v_definition;

  if v_definition is null or position(v_old_guard in v_definition) = 0 then
    raise exception 'Supplier-return command predecessor authorization block drifted';
  end if;
  if length(v_definition) - length(replace(v_definition, v_old_guard, ''))
       <> length(v_old_guard) then
    raise exception 'Supplier-return command has duplicate predecessor authorization blocks';
  end if;

  execute replace(v_definition, v_old_guard, v_new_guard);
end;
$migration$;

revoke all on function public.create_purchase_order_supplier_return(
  text, text, jsonb, text, text
) from public, anon;
grant execute on function public.create_purchase_order_supplier_return(
  text, text, jsonb, text, text
) to authenticated, service_role;

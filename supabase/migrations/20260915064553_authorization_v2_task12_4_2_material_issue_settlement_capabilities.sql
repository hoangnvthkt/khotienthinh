-- Dedicated warehouse-scoped capabilities for material-issue settlement.
-- Existing process personas remain additive compatibility paths during the
-- Authorization V2 transition.
insert into public.permission_modules (
  application_code, code, name, routes, legacy_module_key, sort_order, is_active
) values (
  'wms', 'wms.material_issue', 'Xuất cấp thi công', array['/operations']::text[],
  'WMS', 35, true
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
) values
  (
    'wms.material_issue', 'settle', 'wms.material_issue.settle',
    'Quyết toán xuất cấp',
    'Ghi nhận khối lượng đã sử dụng, hao hụt hoặc hoàn trả của phiếu xuất cấp.',
    array['global', 'warehouse']::text[], 'WMS', '/operations', true, 10, true,
    'important', true, false, false, 'enforced', 'wms', true
  ),
  (
    'wms.material_issue', 'reverse_settlement',
    'wms.material_issue.reverse_settlement', 'Hoàn tác quyết toán',
    'Tạo bút toán bù trừ để hoàn tác một quyết toán phiếu xuất cấp đã ghi nhận.',
    array['global', 'warehouse']::text[], 'WMS', '/operations', true, 20, true,
    'sensitive', true, false, true, 'enforced', 'wms', true
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

create or replace function app_private.material_issue_can_post_settlement(
  p_source_warehouse_id text,
  p_created_by uuid,
  p_responsible_user_id uuid,
  p_recipient_type text,
  p_recipient_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.material_issue_has_process_compatibility_access(
      p_source_warehouse_id,
      p_created_by,
      p_responsible_user_id,
      p_recipient_type,
      p_recipient_id
    )
    or app_private.wms_has_canonical_action(
      'wms.material_issue.settle',
      p_source_warehouse_id,
      null,
      null,
      null,
      public.current_app_user_id()
    ),
    false
  );
$$;

create or replace function app_private.material_issue_can_reverse_settlement(
  p_source_warehouse_id text,
  p_created_by uuid,
  p_responsible_user_id uuid,
  p_recipient_type text,
  p_recipient_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.material_issue_has_process_compatibility_access(
      p_source_warehouse_id,
      p_created_by,
      p_responsible_user_id,
      p_recipient_type,
      p_recipient_id
    )
    or app_private.wms_has_canonical_action(
      'wms.material_issue.reverse_settlement',
      p_source_warehouse_id,
      null,
      null,
      null,
      public.current_app_user_id()
    ),
    false
  );
$$;

revoke all on function app_private.material_issue_can_post_settlement(
  text, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function app_private.material_issue_can_reverse_settlement(
  text, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function app_private.material_issue_can_post_settlement(
  text, uuid, uuid, text, text
) to service_role;
grant execute on function app_private.material_issue_can_reverse_settlement(
  text, uuid, uuid, text, text
) to service_role;

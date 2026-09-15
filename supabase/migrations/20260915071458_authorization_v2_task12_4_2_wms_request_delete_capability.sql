-- Deleting a WMS request is destructive and must be independently assignable.
-- Keep transition-era actors as an additive compatibility path while allowing
-- an exact warehouse-scoped capability at either related warehouse.
insert into public.permission_actions (
  module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order, is_active,
  risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code,
  direct_grant_allowed
) values (
  'wms.request', 'delete', 'wms.request.delete', 'Xóa yêu cầu WMS',
  'Xóa yêu cầu WMS ở trạng thái cho phép tại kho nguồn hoặc kho công trường liên quan.',
  array['global', 'warehouse']::text[], 'WMS', '/requests', true, 60, true,
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

create or replace function app_private.material_request_wms_can_delete(
  p_status text,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.material_request_wms_can_delete_compatibility(
      p_status,
      p_requester_id,
      p_submitted_to_user_id,
      p_source_warehouse_id,
      p_site_warehouse_id
    )
    or (
      coalesce(p_status, 'DRAFT') in ('DRAFT', 'PENDING', 'REJECTED')
      and app_private.wms_has_canonical_action(
        'wms.request.delete',
        p_source_warehouse_id,
        p_site_warehouse_id,
        null,
        null,
        public.current_app_user_id()
      )
    ),
    false
  );
$$;

create or replace function app_private.material_request_can_delete(
  p_request_origin text,
  p_project_id text,
  p_status text,
  p_ever_submitted boolean,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_request_origin, 'wms') = 'project' then
      coalesce(p_status, 'DRAFT') in ('DRAFT', 'REJECTED')
      and (
        public.is_admin()
        or public.is_module_admin('DA')
        or (
          p_requester_id = public.current_app_user_id()
          and not coalesce(p_ever_submitted, false)
          and app_private.material_has_action(
            p_project_id,
            null,
            'project.material_request.create',
            public.current_app_user_id()
          )
        )
      )
    else app_private.material_request_wms_can_delete(
      p_status,
      p_requester_id,
      p_submitted_to_user_id,
      p_source_warehouse_id,
      p_site_warehouse_id
    )
  end;
$$;

create or replace function app_private.material_request_can_delete_v2(
  p_request_origin text,
  p_project_id text,
  p_status text,
  p_ever_submitted boolean,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text,
  p_workflow_step text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_request_origin, 'wms') = 'project' then (
      public.is_admin()
      or app_private.project_user_has_permission(p_project_id, null, 'delete')
      or (
        p_requester_id = public.current_app_user_id()
        and (
          coalesce(p_status, 'DRAFT') = 'REJECTED'
          or coalesce(p_workflow_step, '') = 'returned_to_creator'
          or (
            coalesce(p_status, 'DRAFT') = 'DRAFT'
            and not coalesce(p_ever_submitted, false)
          )
        )
      )
    )
    else app_private.material_request_wms_can_delete(
      p_status,
      p_requester_id,
      p_submitted_to_user_id,
      p_source_warehouse_id,
      p_site_warehouse_id
    )
  end;
$$;

revoke all on function app_private.material_request_wms_can_delete(
  text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function app_private.material_request_wms_can_delete(
  text, uuid, text, text, text
) to service_role;

revoke all on function app_private.material_request_can_delete(
  text, text, text, boolean, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function app_private.material_request_can_delete(
  text, text, text, boolean, uuid, text, text, text
) to service_role;

revoke all on function app_private.material_request_can_delete_v2(
  text, text, text, boolean, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function app_private.material_request_can_delete_v2(
  text, text, text, boolean, uuid, text, text, text, text
) to service_role;

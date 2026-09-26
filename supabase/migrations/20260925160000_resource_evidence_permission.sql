-- A dedicated, read-only Payment Room action for verified physical evidence.
alter table public.project_permission_rooms
  drop constraint project_permission_rooms_allowed_actions_check;

alter table public.project_permission_rooms
  add constraint project_permission_rooms_allowed_actions_check check (
    allowed_actions <@ array[
      'view', 'edit', 'delete', 'submit', 'return', 'verify', 'confirm',
      'approve', 'publish_progress', 'view_available_stock', 'view_resource_evidence'
    ]::text[]
  );

alter table public.project_permission_room_member_actions
  drop constraint project_permission_room_member_actions_code_check;

alter table public.project_permission_room_member_actions
  add constraint project_permission_room_member_actions_code_check check (
    action_code = any(array[
      'view', 'edit', 'delete', 'submit', 'return', 'verify', 'confirm',
      'approve', 'publish_progress', 'view_available_stock', 'view_resource_evidence'
    ]::text[])
  );

update public.project_permission_rooms
set allowed_actions = case
      when 'view_resource_evidence' = any(allowed_actions) then allowed_actions
      else array_append(allowed_actions, 'view_resource_evidence')
    end,
    updated_at = now()
where code = 'payment';

insert into public.permission_actions (
  module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order, is_active,
  risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code
) values (
  'project.payment', 'view_resource_evidence',
  'project.payment.view_resource_evidence', 'Xem bằng chứng nguồn lực',
  'Chỉ đọc số liệu nhân công và máy đã xác nhận theo NCC, khu vực và WBS.',
  array['global', 'project', 'construction_site']::text[],
  'DA', '/da/tabs/payment', false, 125, true,
  'sensitive', true, false, true, 'declared', 'project'
)
on conflict (permission_code) do update
set module_code = excluded.module_code,
    action = excluded.action,
    label = excluded.label,
    description = excluded.description,
    scope_modes = excluded.scope_modes,
    legacy_module_key = excluded.legacy_module_key,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    risk_level = excluded.risk_level,
    is_business_action = excluded.is_business_action,
    is_business_approval = excluded.is_business_approval,
    direct_grant_requires_expiry = excluded.direct_grant_requires_expiry,
    grant_readiness = excluded.grant_readiness,
    access_application_code = excluded.access_application_code,
    updated_at = now();

insert into app_private.project_permission_room_action_bindings (
  room_code, action_code, legacy_permission_codes, enforcement_status,
  relationship_description, pbac_fallback_enabled, prerequisite_action_codes,
  verified_at, verified_source, created_at, updated_at
) values (
  'payment', 'view_resource_evidence',
  array['project.payment.view_resource_evidence']::text[], 'audit_only',
  'Physical resource evidence requires its own read permission; generic payment view does not imply it.',
  true, array[]::text[], null, 'resource_evidence_plan_task_2', now(), now()
)
on conflict (room_code, action_code) do update
set legacy_permission_codes = excluded.legacy_permission_codes,
    enforcement_status = 'audit_only',
    relationship_description = excluded.relationship_description,
    pbac_fallback_enabled = excluded.pbac_fallback_enabled,
    prerequisite_action_codes = excluded.prerequisite_action_codes,
    verified_at = null,
    verified_source = excluded.verified_source,
    updated_at = now();

do $$
begin
  if not exists (
    select 1 from public.project_permission_rooms room
    where room.code = 'payment'
      and 'view_resource_evidence' = any(room.allowed_actions)
  ) then
    raise exception 'RESOURCE_EVIDENCE_PAYMENT_ROOM_ACTION_MISSING';
  end if;
  if not exists (
    select 1 from public.permission_actions action_row
    where action_row.permission_code = 'project.payment.view_resource_evidence'
      and action_row.risk_level = 'sensitive'
      and action_row.direct_grant_requires_expiry
  ) then
    raise exception 'RESOURCE_EVIDENCE_PERMISSION_MISSING';
  end if;
  if not exists (
    select 1 from app_private.project_permission_room_action_bindings binding
    where binding.room_code = 'payment'
      and binding.action_code = 'view_resource_evidence'
      and binding.enforcement_status = 'audit_only'
      and binding.legacy_permission_codes = array['project.payment.view_resource_evidence']::text[]
  ) then
    raise exception 'RESOURCE_EVIDENCE_BINDING_MISSING';
  end if;
end;
$$;

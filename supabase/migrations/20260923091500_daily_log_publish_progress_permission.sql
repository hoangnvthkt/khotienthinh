alter table public.project_permission_rooms
  drop constraint project_permission_rooms_allowed_actions_check;

alter table public.project_permission_rooms
  add constraint project_permission_rooms_allowed_actions_check check (
    allowed_actions <@ array[
      'view',
      'edit',
      'delete',
      'submit',
      'verify',
      'confirm',
      'approve',
      'publish_progress',
      'view_available_stock'
    ]::text[]
  );

alter table public.project_permission_room_member_actions
  drop constraint project_permission_room_member_actions_code_check;

alter table public.project_permission_room_member_actions
  add constraint project_permission_room_member_actions_code_check check (
    action_code = any(array[
      'view',
      'edit',
      'delete',
      'submit',
      'verify',
      'confirm',
      'approve',
      'publish_progress',
      'view_available_stock'
    ]::text[])
  );

update public.project_permission_rooms
set allowed_actions = case
      when 'publish_progress' = any(allowed_actions) then allowed_actions
      else array_append(allowed_actions, 'publish_progress')
    end,
    updated_at = now()
where code = 'daily_log';

insert into public.permission_actions (
  module_code,
  action,
  permission_code,
  label,
  description,
  scope_modes,
  legacy_module_key,
  legacy_route,
  legacy_admin_only,
  sort_order,
  is_active,
  risk_level,
  is_business_action,
  is_business_approval,
  direct_grant_requires_expiry,
  grant_readiness,
  access_application_code
) values (
  'project.daily_log',
  'publish_progress',
  'project.daily_log.publish_progress',
  'Công bố tiến độ ngày',
  'Công bố tiến độ chính thức chỉ từ bản tổng hợp Nhật ký đã được CHT duyệt.',
  array['global', 'project', 'construction_site']::text[],
  'DA',
  '/da/tabs/dailylog',
  true,
  140,
  true,
  'sensitive',
  true,
  true,
  true,
  'declared',
  'project'
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
  room_code,
  action_code,
  legacy_permission_codes,
  enforcement_status,
  relationship_description,
  pbac_fallback_enabled,
  prerequisite_action_codes,
  verified_at,
  verified_source,
  created_at,
  updated_at
) values (
  'daily_log',
  'publish_progress',
  array['project.daily_log.publish_progress']::text[],
  'audit_only',
  'Daily Log approval and progress publication remain separate capabilities.',
  true,
  array['approve']::text[],
  null,
  'daily_log_wbs_area_plan_task_3',
  now(),
  now()
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
    select 1
    from public.project_permission_rooms room
    where room.code = 'daily_log'
      and 'publish_progress' = any(room.allowed_actions)
  ) then
    raise exception 'DAILY_LOG_PUBLISH_PROGRESS_ROOM_ACTION_MISSING';
  end if;

  if not exists (
    select 1
    from public.permission_actions action_row
    where action_row.permission_code = 'project.daily_log.publish_progress'
      and action_row.risk_level = 'sensitive'
      and action_row.direct_grant_requires_expiry
  ) then
    raise exception 'DAILY_LOG_PUBLISH_PROGRESS_PERMISSION_MISSING';
  end if;

  if not exists (
    select 1
    from app_private.project_permission_room_action_bindings binding
    where binding.room_code = 'daily_log'
      and binding.action_code = 'publish_progress'
      and binding.enforcement_status = 'audit_only'
      and binding.prerequisite_action_codes = array['approve']::text[]
  ) then
    raise exception 'DAILY_LOG_PUBLISH_PROGRESS_BINDING_MISSING';
  end if;
end;
$$;

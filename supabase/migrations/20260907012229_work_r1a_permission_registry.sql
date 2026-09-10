-- Vioo Work R1A is canonical-only business data. No legacy module alias is
-- registered and technical ADMIN status does not synthesize Work grants.

insert into public.permission_applications (
  code,
  name,
  description,
  sort_order,
  is_active,
  member_assignable
) values (
  'work',
  'Công việc',
  'Giao, nhận và phối hợp công việc trong Vioo Work.',
  65,
  true,
  true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true,
  member_assignable = true,
  updated_at = now();

insert into public.permission_modules (
  application_code,
  code,
  name,
  description,
  routes,
  legacy_module_key,
  sort_order,
  is_active
) values
  (
    'work',
    'work.module',
    'Vioo Work',
    'Ranh giới truy cập module Vioo Work.',
    array['/work', '/work/my', '/work/scopes', '/work/tasks/:taskCode', '/work/settings'],
    null,
    10,
    true
  ),
  (
    'work',
    'work.task',
    'Công việc',
    'Năng lực nghiệp vụ của công việc.',
    '{}'::text[],
    null,
    20,
    true
  )
on conflict (code) do update set
  application_code = excluded.application_code,
  name = excluded.name,
  description = excluded.description,
  routes = excluded.routes,
  legacy_module_key = null,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

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
)
select
  action_row.module_code,
  action_row.action,
  action_row.permission_code,
  action_row.label,
  action_row.description,
  action_row.scope_modes,
  null,
  null,
  false,
  action_row.sort_order,
  true,
  action_row.risk_level,
  action_row.is_business_action,
  action_row.is_business_approval,
  action_row.direct_grant_requires_expiry,
  'enforced',
  'work'
from (values
  ('work.module', 'access', 'work.module.access', 'Truy cập Vioo Work', 'Mở module Vioo Work.', array['global']::text[], 10, 'normal', false, false, false),
  ('work.task', 'create', 'work.task.create', 'Tạo công việc', 'Tạo công việc theo phạm vi được cấp.', array['global', 'own', 'department', 'project']::text[], 10, 'normal', true, false, false),
  ('work.task', 'view_related', 'work.task.view_related', 'Xem công việc liên quan', 'Xem công việc khi là người tạo, người nhận, người theo dõi hoặc người đánh giá.', array['global', 'own', 'assigned', 'department', 'project']::text[], 20, 'normal', false, false, false),
  ('work.task', 'assign_user', 'work.task.assign_user', 'Giao cho người dùng', 'Giao hoặc thêm người dùng vào công việc.', array['global', 'own', 'department', 'project']::text[], 30, 'important', true, false, false),
  ('work.task', 'assign_group', 'work.task.assign_group', 'Giao cho nhóm làm việc', 'Giao công việc qua snapshot nhóm làm việc.', array['global', 'own', 'department', 'project']::text[], 40, 'important', true, false, false),
  ('work.task', 'view_scope', 'work.task.view_scope', 'Xem theo phạm vi', 'Xem công việc trong phòng ban hoặc dự án được cấp.', array['global', 'department', 'project']::text[], 50, 'important', false, false, false),
  ('work.task', 'view_restricted', 'work.task.view_restricted', 'Xem công việc hạn chế', 'Xem nội dung hạn chế trong phạm vi được cấp.', array['global', 'own', 'assigned', 'department', 'project']::text[], 60, 'sensitive', false, false, true),
  ('work.task', 'manage_scope', 'work.task.manage_scope', 'Quản lý theo phạm vi', 'Điều phối công việc trong phạm vi được cấp.', array['global', 'department', 'project']::text[], 70, 'sensitive', true, false, true),
  ('work.task', 'review', 'work.task.review', 'Đánh giá công việc', 'Duyệt kết quả hoặc yêu cầu chỉnh sửa.', array['global', 'assigned', 'department', 'project']::text[], 80, 'important', true, true, false),
  ('work.task', 'audit_view', 'work.task.audit_view', 'Xem lịch sử công việc', 'Xem lịch sử bất biến của công việc.', array['global', 'own', 'assigned', 'department', 'project']::text[], 90, 'important', false, false, false),
  ('work.task', 'configure', 'work.task.configure', 'Cấu hình Vioo Work', 'Cấu hình bucket, lịch làm việc và SLA.', array['global', 'department', 'project']::text[], 100, 'sensitive', true, false, true)
) as action_row(
  module_code,
  action,
  permission_code,
  label,
  description,
  scope_modes,
  sort_order,
  risk_level,
  is_business_action,
  is_business_approval,
  direct_grant_requires_expiry
)
on conflict (permission_code) do update set
  module_code = excluded.module_code,
  action = excluded.action,
  label = excluded.label,
  description = excluded.description,
  scope_modes = excluded.scope_modes,
  legacy_module_key = null,
  legacy_route = null,
  legacy_admin_only = false,
  sort_order = excluded.sort_order,
  is_active = true,
  risk_level = excluded.risk_level,
  is_business_action = excluded.is_business_action,
  is_business_approval = excluded.is_business_approval,
  direct_grant_requires_expiry = excluded.direct_grant_requires_expiry,
  grant_readiness = 'enforced',
  access_application_code = 'work',
  updated_at = now();

create or replace function app_private.has_permission(
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'global',
  p_scope_id text default '*'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      p_user_id,
      p_permission_code,
      p_scope_type,
      p_scope_id,
      now()
    ) source_row
    where p_permission_code not like 'work.%'
      or upper(source_row.source_type) <> 'LEGACY'
  );
$$;

create or replace function public.get_my_authorization_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_snapshot jsonb;
  v_sources jsonb;
begin
  if v_actor_id is null then
    raise exception 'Active application account required'
      using errcode = '42501';
  end if;

  v_snapshot := app_private.resolve_authorization_snapshot(v_actor_id);

  select coalesce(jsonb_agg(source_row.value order by source_row.position), '[]'::jsonb)
    into v_sources
  from (
    select
      source_value.value,
      source_value.position,
      source_value.value ->> 'permissionCode' as permission_code,
      source_value.value ->> 'sourceType' as source_type
    from jsonb_array_elements(v_snapshot -> 'sources') with ordinality
      as source_value(value, position)
  ) source_row
  where not (
    source_row.permission_code like 'work.%'
    and upper(source_row.source_type) = 'LEGACY'
  );

  return jsonb_set(v_snapshot, '{sources}', v_sources, true);
end;
$$;

revoke all on function app_private.has_permission(uuid, text, text, text) from public;
revoke all on function app_private.has_permission(uuid, text, text, text) from anon;
revoke all on function app_private.has_permission(uuid, text, text, text) from authenticated;
revoke all on function public.get_my_authorization_snapshot() from public;
revoke all on function public.get_my_authorization_snapshot() from anon;
grant execute on function public.get_my_authorization_snapshot() to authenticated;

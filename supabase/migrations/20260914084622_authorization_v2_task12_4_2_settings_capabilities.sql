-- Task 12.4.2-B: granular Settings capabilities and additive backend enforcement.

update public.permission_applications
set member_assignable = true,
    description = 'Các mục cấu hình được cấp riêng theo nghiệp vụ.',
    updated_at = now()
where code = 'settings';

insert into public.permission_modules (
  application_code, code, name, routes, legacy_module_key, sort_order, is_active
)
select 'settings', row_data.code, row_data.name, array[row_data.route], 'SETTINGS', row_data.sort_order, true
from (values
  ('settings.general', 'Chung', '/settings/general', 10),
  ('settings.warehouses', 'Kho bãi', '/settings/warehouses', 20),
  ('settings.master_data', 'Dữ liệu gốc', '/settings/master-data', 30),
  ('settings.g8_cost_norms', 'Định mức G8', '/settings/g8-cost-norms', 40),
  ('settings.project_master_data', 'Danh mục DA', '/settings/project-master-data', 50),
  ('settings.inspection_templates', 'Mẫu nghiệm thu', '/settings/inspection-templates', 60),
  ('settings.work_groups', 'Nhóm làm việc', '/settings/work-groups', 70),
  ('settings.loss_norms', 'Định mức hao hụt', '/settings/loss-norms', 80),
  ('settings.users', 'Người dùng', '/settings/users', 90),
  ('settings.alerts', 'Cảnh báo', '/settings/alerts', 100),
  ('settings.permission_health', 'Permission health', '/settings/permission-health', 110),
  ('settings.chibi_bot', 'Trợ lý ảo', '/settings/chibi-bot', 120),
  ('settings.ai_learning', 'AI Learning', '/settings/ai-learning', 130),
  ('settings.maintenance', 'Bảo trì', '/settings/maintenance', 140)
) as row_data(code, name, route, sort_order)
on conflict (code) do update
set application_code = excluded.application_code,
    name = excluded.name,
    routes = excluded.routes,
    legacy_module_key = excluded.legacy_module_key,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.permission_actions (
  module_code, action, permission_code, label, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order,
  is_active, risk_level, grant_readiness, access_application_code,
  direct_grant_allowed, direct_grant_requires_expiry
)
select
  module_data.module_code,
  action_data.action,
  module_data.module_code || '.' || action_data.action,
  action_data.label,
  array['global']::text[],
  'SETTINGS',
  module_data.route,
  action_data.action = 'manage',
  action_data.sort_order,
  true,
  case when module_data.sensitive then 'sensitive' else action_data.risk_level end,
  case when module_data.enforced then 'enforced' else 'declared' end,
  'settings',
  module_data.enforced and not module_data.sensitive,
  false
from (values
  ('settings.general', '/settings/general', true, false),
  ('settings.warehouses', '/settings/warehouses', true, false),
  ('settings.master_data', '/settings/master-data', true, false),
  ('settings.g8_cost_norms', '/settings/g8-cost-norms', true, false),
  ('settings.project_master_data', '/settings/project-master-data', true, false),
  ('settings.inspection_templates', '/settings/inspection-templates', true, false),
  ('settings.work_groups', '/settings/work-groups', true, false),
  ('settings.loss_norms', '/settings/loss-norms', true, false),
  ('settings.users', '/settings/users', false, true),
  ('settings.alerts', '/settings/alerts', false, true),
  ('settings.permission_health', '/settings/permission-health', false, true),
  ('settings.chibi_bot', '/settings/chibi-bot', true, false),
  ('settings.ai_learning', '/settings/ai-learning', false, true),
  ('settings.maintenance', '/settings/maintenance', false, true)
) as module_data(module_code, route, enforced, sensitive)
cross join (values
  ('view', 'Xem', 10, 'normal'),
  ('manage', 'Quản lý', 20, 'important')
) as action_data(action, label, sort_order, risk_level)
on conflict (permission_code) do update
set module_code = excluded.module_code,
    action = excluded.action,
    label = excluded.label,
    scope_modes = excluded.scope_modes,
    legacy_module_key = excluded.legacy_module_key,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    is_active = true,
    risk_level = excluded.risk_level,
    grant_readiness = excluded.grant_readiness,
    access_application_code = excluded.access_application_code,
    direct_grant_allowed = excluded.direct_grant_allowed,
    direct_grant_requires_expiry = excluded.direct_grant_requires_expiry,
    updated_at = now();

-- The resolver deliberately treats system.settings.manage as a parent source,
-- while feature manage implies feature view. It does not accept caller user IDs.
create or replace function app_private.settings_has_action(
  p_feature_code text,
  p_require_manage boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.has_permission(
      public.current_app_user_id(),
      'system.settings.manage',
      'global',
      '*'
    )
    or app_private.has_permission(
      public.current_app_user_id(),
      'settings.' || p_feature_code || '.manage',
      'global',
      '*'
    )
    or (
      not p_require_manage
      and app_private.has_permission(
        public.current_app_user_id(),
        'settings.' || p_feature_code || '.view',
        'global',
        '*'
      )
    ),
    false
  );
$$;

revoke all on function app_private.settings_has_action(text, boolean) from public, anon;
grant execute on function app_private.settings_has_action(text, boolean) to authenticated, service_role;

create or replace function app_private.can_manage_warehouse_site_bindings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('WMS')
    or public.is_module_admin('SETTINGS')
    or app_private.wms_has_action('wms.master_data.manage')
    or app_private.settings_has_action('warehouses', true);
$$;

create or replace function app_private.can_manage_project_master(
  p_project_id text,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('DA')
    or public.is_module_admin('SETTINGS')
    or (
      p_permission_code = 'project.master.manage_categories'
      and app_private.settings_has_action('project_master_data', true)
    )
    or (
      p_project_id is not null
      and app_private.project_has_permission_v2(
        p_project_id,
        null,
        p_permission_code,
        public.current_app_user_id()
      )
    )
    or app_private.has_explicit_permission(
      public.current_app_user_id(),
      p_permission_code,
      'global',
      '*'
    );
$$;

create or replace function app_private.can_manage_work_groups()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.can_manage_project_master(null, 'project.master.manage_categories')
    or app_private.has_explicit_permission(
      public.current_app_user_id(),
      'project.org.assign_staff',
      'global',
      '*'
    )
    or app_private.settings_has_action('work_groups', true);
$$;

-- The old catalog claimed this was directly assignable while validation
-- rejected it. Keep it role/template-only and expose feature grants instead.
update public.permission_actions
set direct_grant_allowed = false,
    updated_at = now()
where permission_code = 'system.settings.manage';

insert into app_private.permission_application_default_view_grants (
  application_code, permission_code, default_scope_type, sort_order, is_active
)
values
  ('settings', 'settings.general.view', 'global', 10, true),
  ('settings', 'settings.warehouses.view', 'global', 20, true),
  ('settings', 'settings.master_data.view', 'global', 30, true),
  ('settings', 'settings.g8_cost_norms.view', 'global', 40, true),
  ('settings', 'settings.project_master_data.view', 'global', 50, true),
  ('settings', 'settings.inspection_templates.view', 'global', 60, true),
  ('settings', 'settings.work_groups.view', 'global', 70, true),
  ('settings', 'settings.loss_norms.view', 'global', 80, true)
on conflict (application_code, permission_code) do update
set default_scope_type = excluded.default_scope_type,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

-- Branding is required during bootstrap, so app_settings SELECT stays available
-- to active accounts. Only writes become feature-authorized.
drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
for update to authenticated
using ((select app_private.settings_has_action('general', true)))
with check ((select app_private.settings_has_action('general', true)));

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
for insert to authenticated
with check ((select app_private.settings_has_action('general', true)));

drop policy if exists app_settings_delete on public.app_settings;
create policy app_settings_delete on public.app_settings
for delete to authenticated
using ((select app_private.settings_has_action('general', true)));

-- Warehouse and material tables are shared with WMS. These policies are
-- additive; existing WMS capabilities continue to authorize their callers.
create policy warehouses_settings_select on public.warehouses
for select to authenticated
using ((select app_private.settings_has_action('warehouses', false)));
create policy warehouses_settings_insert on public.warehouses
for insert to authenticated
with check ((select app_private.settings_has_action('warehouses', true)));
create policy warehouses_settings_update on public.warehouses
for update to authenticated
using ((select app_private.settings_has_action('warehouses', true)))
with check ((select app_private.settings_has_action('warehouses', true)));
create policy warehouses_settings_delete on public.warehouses
for delete to authenticated
using ((select app_private.settings_has_action('warehouses', true)));

create policy warehouse_types_settings_select on public.warehouse_types
for select to authenticated
using ((select app_private.settings_has_action('warehouses', false)));
create policy warehouse_types_settings_insert on public.warehouse_types
for insert to authenticated
with check ((select app_private.settings_has_action('warehouses', true)));
create policy warehouse_types_settings_update on public.warehouse_types
for update to authenticated
using ((select app_private.settings_has_action('warehouses', true)))
with check ((select app_private.settings_has_action('warehouses', true)));
create policy warehouse_types_settings_delete on public.warehouse_types
for delete to authenticated
using ((select app_private.settings_has_action('warehouses', true)));

create policy items_settings_select on public.items
for select to authenticated
using ((select app_private.settings_has_action('master_data', false)));
create policy items_settings_insert on public.items
for insert to authenticated
with check ((select app_private.settings_has_action('master_data', true)));
create policy items_settings_update on public.items
for update to authenticated
using ((select app_private.settings_has_action('master_data', true)))
with check ((select app_private.settings_has_action('master_data', true)));
create policy items_settings_delete on public.items
for delete to authenticated
using ((select app_private.settings_has_action('master_data', true)));

create policy suppliers_settings_insert on public.suppliers
for insert to authenticated
with check ((select app_private.settings_has_action('master_data', true)));
create policy suppliers_settings_update on public.suppliers
for update to authenticated
using ((select app_private.settings_has_action('master_data', true)))
with check ((select app_private.settings_has_action('master_data', true)));
create policy suppliers_settings_delete on public.suppliers
for delete to authenticated
using ((select app_private.settings_has_action('master_data', true)));

-- Replace the unrestricted loss-norm policy. This is the only intentionally
-- restrictive policy change in this migration.
drop policy if exists loss_norms_all on public.loss_norms;
create policy loss_norms_settings_select on public.loss_norms
for select to authenticated
using ((select app_private.settings_has_action('loss_norms', false)));
create policy loss_norms_settings_insert on public.loss_norms
for insert to authenticated
with check ((select app_private.settings_has_action('loss_norms', true)));
create policy loss_norms_settings_update on public.loss_norms
for update to authenticated
using ((select app_private.settings_has_action('loss_norms', true)))
with check ((select app_private.settings_has_action('loss_norms', true)));
create policy loss_norms_settings_delete on public.loss_norms
for delete to authenticated
using ((select app_private.settings_has_action('loss_norms', true)));

-- Settings-specific policies augment Project/Room-compatible policies.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'inspection_categories', 'inspection_work_types', 'inspection_templates',
    'template_sections', 'inspection_template_items'
  ]
  loop
    execute format('create policy %I on public.%I for select to authenticated using ((select app_private.settings_has_action(''inspection_templates'', false)))', v_table || '_settings_select', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app_private.settings_has_action(''inspection_templates'', true)))', v_table || '_settings_insert', v_table);
    execute format('create policy %I on public.%I for update to authenticated using ((select app_private.settings_has_action(''inspection_templates'', true))) with check ((select app_private.settings_has_action(''inspection_templates'', true)))', v_table || '_settings_update', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app_private.settings_has_action(''inspection_templates'', true)))', v_table || '_settings_delete', v_table);
  end loop;

  foreach v_table in array array['work_groups', 'work_group_members']
  loop
    execute format('create policy %I on public.%I for select to authenticated using ((select app_private.settings_has_action(''work_groups'', false)))', v_table || '_settings_select', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app_private.settings_has_action(''work_groups'', true)))', v_table || '_settings_insert', v_table);
    execute format('create policy %I on public.%I for update to authenticated using ((select app_private.settings_has_action(''work_groups'', true))) with check ((select app_private.settings_has_action(''work_groups'', true)))', v_table || '_settings_update', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app_private.settings_has_action(''work_groups'', true)))', v_table || '_settings_delete', v_table);
  end loop;
end;
$$;

-- Project master-data RPCs already call can_manage_project_master, extended
-- above only for the categories capability. Reads stay available to Project.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['project_groups', 'project_types', 'project_sectors']
  loop
    execute format('create policy %I on public.%I for select to authenticated using ((select app_private.settings_has_action(''project_master_data'', false)))', v_table || '_settings_select', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app_private.settings_has_action(''project_master_data'', true)))', v_table || '_settings_insert', v_table);
    execute format('create policy %I on public.%I for update to authenticated using ((select app_private.settings_has_action(''project_master_data'', true))) with check ((select app_private.settings_has_action(''project_master_data'', true)))', v_table || '_settings_update', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app_private.settings_has_action(''project_master_data'', true)))', v_table || '_settings_delete', v_table);
  end loop;

  foreach v_table in array array[
    'cost_norm_libraries', 'cost_norm_items', 'cost_norm_resources',
    'cost_norm_item_components', 'cost_norm_import_jobs',
    'cost_norm_import_errors', 'cost_norm_import_raw_rows', 'cost_norm_change_logs'
  ]
  loop
    execute format('create policy %I on public.%I for select to authenticated using ((select app_private.settings_has_action(''g8_cost_norms'', false)))', v_table || '_settings_select', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app_private.settings_has_action(''g8_cost_norms'', true)))', v_table || '_settings_insert', v_table);
    execute format('create policy %I on public.%I for update to authenticated using ((select app_private.settings_has_action(''g8_cost_norms'', true))) with check ((select app_private.settings_has_action(''g8_cost_norms'', true)))', v_table || '_settings_update', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app_private.settings_has_action(''g8_cost_norms'', true)))', v_table || '_settings_delete', v_table);
  end loop;
end;
$$;

drop policy if exists "Admins can manage chatbot messages" on public.chatbot_messages;
create policy chatbot_messages_settings_manage on public.chatbot_messages
for all to authenticated
using ((select app_private.settings_has_action('chibi_bot', true)))
with check ((select app_private.settings_has_action('chibi_bot', true)));

create policy chatbot_messages_settings_select on public.chatbot_messages
for select to authenticated
using ((select app_private.settings_has_action('chibi_bot', false)));

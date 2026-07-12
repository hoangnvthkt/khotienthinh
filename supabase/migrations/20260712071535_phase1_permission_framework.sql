-- Phase 1 permission framework.
-- Adds application -> module -> action -> scope grants in parallel with legacy fields.

create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
grant usage on schema app_private to authenticated;

create table if not exists public.permission_applications (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permission_modules (
  id uuid primary key default gen_random_uuid(),
  application_code text not null references public.permission_applications(code) on update cascade on delete cascade,
  code text not null unique,
  name text not null,
  description text,
  routes text[] not null default '{}'::text[],
  legacy_module_key text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permission_actions (
  id uuid primary key default gen_random_uuid(),
  module_code text not null references public.permission_modules(code) on update cascade on delete cascade,
  action text not null,
  permission_code text not null unique,
  label text not null,
  description text,
  scope_modes text[] not null default array['global']::text[],
  legacy_module_key text,
  legacy_route text,
  legacy_admin_only boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_code, action)
);

create table if not exists public.user_permission_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  permission_code text not null references public.permission_actions(permission_code) on update cascade on delete cascade,
  scope_type text not null default 'global',
  scope_id text not null default '*',
  is_active boolean not null default true,
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_permission_grants_scope_type_chk check (
    scope_type in ('global', 'own', 'assigned', 'project', 'construction_site', 'warehouse', 'department')
  ),
  unique (user_id, permission_code, scope_type, scope_id)
);

create table if not exists public.role_permission_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_permission_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.role_permission_templates(id) on delete cascade,
  permission_code text not null references public.permission_actions(permission_code) on update cascade on delete cascade,
  scope_type text not null default 'global',
  scope_id text not null default '*',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint role_permission_template_items_scope_type_chk check (
    scope_type in ('global', 'own', 'assigned', 'project', 'construction_site', 'warehouse', 'department')
  ),
  unique (template_id, permission_code, scope_type, scope_id)
);

create table if not exists public.permission_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  target_user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  before_grants jsonb not null default '[]'::jsonb,
  after_grants jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists permission_modules_application_idx
  on public.permission_modules(application_code, sort_order);
create index if not exists permission_actions_module_idx
  on public.permission_actions(module_code, sort_order);
create index if not exists user_permission_grants_user_idx
  on public.user_permission_grants(user_id, is_active);
create index if not exists user_permission_grants_permission_idx
  on public.user_permission_grants(permission_code, scope_type, scope_id)
  where is_active;
create index if not exists user_permission_grants_expiry_idx
  on public.user_permission_grants(expires_at)
  where expires_at is not null;
create index if not exists role_permission_template_items_template_idx
  on public.role_permission_template_items(template_id);
create index if not exists permission_audit_events_target_idx
  on public.permission_audit_events(target_user_id, created_at desc);

alter table public.permission_applications enable row level security;
alter table public.permission_modules enable row level security;
alter table public.permission_actions enable row level security;
alter table public.user_permission_grants enable row level security;
alter table public.role_permission_templates enable row level security;
alter table public.role_permission_template_items enable row level security;
alter table public.permission_audit_events enable row level security;

revoke all privileges on table public.permission_applications from public, anon;
revoke all privileges on table public.permission_modules from public, anon;
revoke all privileges on table public.permission_actions from public, anon;
revoke all privileges on table public.user_permission_grants from public, anon;
revoke all privileges on table public.role_permission_templates from public, anon;
revoke all privileges on table public.role_permission_template_items from public, anon;
revoke all privileges on table public.permission_audit_events from public, anon;

grant select on table public.permission_applications to authenticated;
grant select on table public.permission_modules to authenticated;
grant select on table public.permission_actions to authenticated;
grant select, insert, update, delete on table public.user_permission_grants to authenticated;
grant select, insert, update, delete on table public.role_permission_templates to authenticated;
grant select, insert, update, delete on table public.role_permission_template_items to authenticated;
grant select, insert on table public.permission_audit_events to authenticated;

create or replace function app_private.can_manage_permissions()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and coalesce(u.is_active, true)
      and (
        u.role = 'ADMIN'
        or 'SETTINGS' = any(coalesce(u.admin_modules, '{}'::text[]))
        or coalesce(u.admin_sub_modules, '{}'::jsonb) ? 'SETTINGS'
        or exists (
          select 1
          from public.user_permission_grants g
          where g.user_id = u.id
            and g.permission_code = 'system.settings.manage'
            and coalesce(g.is_active, false)
            and (g.expires_at is null or g.expires_at > now())
        )
      )
  );
$$;

revoke all on function app_private.can_manage_permissions() from public;
revoke all on function app_private.can_manage_permissions() from anon;
grant execute on function app_private.can_manage_permissions() to authenticated;

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
  with app_user as (
    select *
    from public.users u
    where u.id = p_user_id
      and coalesce(u.is_active, true)
    limit 1
  ),
  requested_action as (
    select pa.*, pm.legacy_module_key as module_legacy_key
    from public.permission_actions pa
    join public.permission_modules pm on pm.code = pa.module_code
    where pa.permission_code = p_permission_code
      and coalesce(pa.is_active, true)
      and coalesce(pm.is_active, true)
    limit 1
  )
  select exists (
    select 1
    from app_user u
    where u.role = 'ADMIN'
  )
  or exists (
    select 1
    from public.user_permission_grants g
    join app_user u on u.id = g.user_id
    where g.permission_code = p_permission_code
      and coalesce(g.is_active, false)
      and (g.expires_at is null or g.expires_at > now())
      and (
        g.scope_type = 'global'
        or (
          g.scope_type = coalesce(p_scope_type, 'global')
          and (g.scope_id = '*' or g.scope_id = coalesce(p_scope_id, '*'))
        )
      )
  )
  or exists (
    select 1
    from app_user u
    join requested_action a on true
    where coalesce(a.legacy_module_key, a.module_legacy_key) is not null
      and (
        case
          when coalesce(a.legacy_admin_only, false) or a.action = 'manage' then
            coalesce(a.legacy_module_key, a.module_legacy_key) = any(coalesce(u.admin_modules, '{}'::text[]))
            or (
              a.legacy_route is null
              and coalesce(u.admin_sub_modules, '{}'::jsonb) ? coalesce(a.legacy_module_key, a.module_legacy_key)
            )
            or (
              a.legacy_route is not null
              and coalesce(u.admin_sub_modules -> coalesce(a.legacy_module_key, a.module_legacy_key), '[]'::jsonb) ? a.legacy_route
            )
          else
            u.allowed_modules is null
            or coalesce(a.legacy_module_key, a.module_legacy_key) = any(coalesce(u.allowed_modules, '{}'::text[]))
            or coalesce(a.legacy_module_key, a.module_legacy_key) = any(coalesce(u.admin_modules, '{}'::text[]))
            or (
              a.legacy_route is null
              and (
                coalesce(u.allowed_sub_modules, '{}'::jsonb) ? coalesce(a.legacy_module_key, a.module_legacy_key)
                or coalesce(u.admin_sub_modules, '{}'::jsonb) ? coalesce(a.legacy_module_key, a.module_legacy_key)
              )
            )
            or (
              a.legacy_route is not null
              and (
                coalesce(u.allowed_sub_modules -> coalesce(a.legacy_module_key, a.module_legacy_key), '[]'::jsonb) ? a.legacy_route
                or coalesce(u.admin_sub_modules -> coalesce(a.legacy_module_key, a.module_legacy_key), '[]'::jsonb) ? a.legacy_route
              )
            )
        end
      )
  );
$$;

revoke all on function app_private.has_permission(uuid, text, text, text) from public;
revoke all on function app_private.has_permission(uuid, text, text, text) from anon;
grant execute on function app_private.has_permission(uuid, text, text, text) to authenticated;

create or replace function app_private.has_any_permission(
  p_user_id uuid,
  p_permission_codes text[],
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
    from unnest(coalesce(p_permission_codes, '{}'::text[])) permission_code
    where app_private.has_permission(p_user_id, permission_code, p_scope_type, p_scope_id)
  );
$$;

revoke all on function app_private.has_any_permission(uuid, text[], text, text) from public;
revoke all on function app_private.has_any_permission(uuid, text[], text, text) from anon;
grant execute on function app_private.has_any_permission(uuid, text[], text, text) to authenticated;

drop policy if exists permission_applications_select on public.permission_applications;
create policy permission_applications_select
on public.permission_applications for select
to authenticated
using (true);

drop policy if exists permission_modules_select on public.permission_modules;
create policy permission_modules_select
on public.permission_modules for select
to authenticated
using (true);

drop policy if exists permission_actions_select on public.permission_actions;
create policy permission_actions_select
on public.permission_actions for select
to authenticated
using (true);

drop policy if exists user_permission_grants_select on public.user_permission_grants;
create policy user_permission_grants_select
on public.user_permission_grants for select
to authenticated
using (user_id = public.current_app_user_id() or app_private.can_manage_permissions());

drop policy if exists user_permission_grants_insert on public.user_permission_grants;
create policy user_permission_grants_insert
on public.user_permission_grants for insert
to authenticated
with check (app_private.can_manage_permissions());

drop policy if exists user_permission_grants_update on public.user_permission_grants;
create policy user_permission_grants_update
on public.user_permission_grants for update
to authenticated
using (app_private.can_manage_permissions())
with check (app_private.can_manage_permissions());

drop policy if exists user_permission_grants_delete on public.user_permission_grants;
create policy user_permission_grants_delete
on public.user_permission_grants for delete
to authenticated
using (app_private.can_manage_permissions());

drop policy if exists role_permission_templates_select on public.role_permission_templates;
create policy role_permission_templates_select
on public.role_permission_templates for select
to authenticated
using (true);

drop policy if exists role_permission_templates_insert on public.role_permission_templates;
create policy role_permission_templates_insert
on public.role_permission_templates for insert
to authenticated
with check (app_private.can_manage_permissions());

drop policy if exists role_permission_templates_update on public.role_permission_templates;
create policy role_permission_templates_update
on public.role_permission_templates for update
to authenticated
using (app_private.can_manage_permissions())
with check (app_private.can_manage_permissions());

drop policy if exists role_permission_templates_delete on public.role_permission_templates;
create policy role_permission_templates_delete
on public.role_permission_templates for delete
to authenticated
using (app_private.can_manage_permissions());

drop policy if exists role_permission_template_items_select on public.role_permission_template_items;
create policy role_permission_template_items_select
on public.role_permission_template_items for select
to authenticated
using (true);

drop policy if exists role_permission_template_items_insert on public.role_permission_template_items;
create policy role_permission_template_items_insert
on public.role_permission_template_items for insert
to authenticated
with check (app_private.can_manage_permissions());

drop policy if exists role_permission_template_items_update on public.role_permission_template_items;
create policy role_permission_template_items_update
on public.role_permission_template_items for update
to authenticated
using (app_private.can_manage_permissions())
with check (app_private.can_manage_permissions());

drop policy if exists role_permission_template_items_delete on public.role_permission_template_items;
create policy role_permission_template_items_delete
on public.role_permission_template_items for delete
to authenticated
using (app_private.can_manage_permissions());

drop policy if exists permission_audit_events_select on public.permission_audit_events;
create policy permission_audit_events_select
on public.permission_audit_events for select
to authenticated
using (
  app_private.can_manage_permissions()
  or actor_user_id = public.current_app_user_id()
  or target_user_id = public.current_app_user_id()
);

drop policy if exists permission_audit_events_insert on public.permission_audit_events;
create policy permission_audit_events_insert
on public.permission_audit_events for insert
to authenticated
with check (app_private.can_manage_permissions());

insert into public.permission_applications (code, name, sort_order)
values
  ('system', 'Hệ thống ERP', 10),
  ('project', 'Dự án', 20)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.permission_modules (application_code, code, name, routes, legacy_module_key, sort_order)
values
  ('system', 'system.wms', 'Kho vật tư', array['/dashboard','/requests','/material-code-requests','/inventory','/operations','/audit','/reports','/misa-export']::text[], 'WMS', 10),
  ('system', 'system.hrm', 'Nhân sự', array['/hrm/dashboard','/hrm/checkin','/hrm/employees','/hrm/attendance','/hrm/shifts','/hrm/leave','/hrm/payroll','/hrm/contracts','/hrm/documents','/hrm/reports','/hrm/ranking','/org-map']::text[], 'HRM', 20),
  ('system', 'system.wf', 'Quy trình', array['/wf/dashboard','/wf','/wf/instances/:id','/wf/templates','/wf/builder/:id']::text[], 'WF', 30),
  ('system', 'system.da', 'Dự án', array['/da','/da/portfolio','/da/tabs/executive','/da/tabs/org','/da/tabs/finance','/da/tabs/budget','/da/tabs/cashflow','/da/tabs/contract','/da/tabs/gantt','/da/tabs/weekly_progress','/da/tabs/dailylog','/da/tabs/material','/da/tabs/quality','/da/tabs/safety','/da/tabs/subcontract','/da/tabs/documents','/da/tabs/report','/da/tabs/payment']::text[], 'DA', 40),
  ('system', 'system.procurement', 'Mua hàng', array['/procurement']::text[], 'PROCUREMENT', 50),
  ('system', 'system.ts', 'Tài sản', array['/ts/dashboard','/ts/catalog','/ts/assignment','/ts/maintenance','/ts/audit','/ts/reports','/ts/asset/:id']::text[], 'TS', 60),
  ('system', 'system.rq', 'Yêu cầu', array['/rq/dashboard','/rq','/rq/categories']::text[], 'RQ', 70),
  ('system', 'system.ex', 'Ngân sách', array['/expense']::text[], 'EX', 80),
  ('system', 'system.ep', 'Hồ sơ nhân sự', array['/ep','/ep/:employeeId']::text[], 'EP', 90),
  ('system', 'system.hd', 'Hợp đồng', array['/hd','/hd/overview','/hd/partners','/hd/contract-types','/hd/catalogs','/hd/cost-library','/hd/supplier','/hd/customer','/hd/customer/:id','/hd/subcontractor','/hd/subcontractor/:id']::text[], 'HD', 100),
  ('system', 'system.tender_ai', 'Tender AI', array['/tender-ai','/tender-ai/boq','/tender-ai/cost-library']::text[], 'TENDER_AI', 110),
  ('system', 'system.chat', 'Tin nhắn', array['/chat']::text[], 'CHAT', 120),
  ('system', 'system.settings', 'Cài đặt', array['/settings','/users','/admin/activity']::text[], 'SETTINGS', 130),
  ('system', 'system.storage', 'Lưu trữ', array['/storage']::text[], 'STORAGE', 140),
  ('system', 'system.kb', 'Kho tri thức', array['/knowledge-base']::text[], 'KB', 150),
  ('system', 'system.ai', 'AI', array['/ai','/ai/executive','/ai/reports']::text[], 'AI', 160),
  ('system', 'system.audit_trail', 'Nhật ký hệ thống', array['/trace','/audit-trail']::text[], 'AUDIT_TRAIL', 170),
  ('system', 'system.analytics', 'Phân tích', array['/analytics']::text[], 'ANALYTICS', 180),
  ('system', 'system.custom_dashboard', 'Dashboard tùy chỉnh', array['/custom-dashboard']::text[], 'CUSTOM_DASHBOARD', 190),
  ('project', 'project.daily_log', 'Nhật ký dự án', array['/da/tabs/dailylog']::text[], 'DA', 10),
  ('project', 'project.material_request', 'Đề xuất vật tư', array['/da/tabs/material','/da/tabs/supply','/da/tabs/material/summary','/da/tabs/material/boq','/da/tabs/material/planning','/da/tabs/material/request','/da/tabs/material/custom','/da/tabs/material/po','/da/tabs/material/waste','/da/tabs/material/dashboard']::text[], 'DA', 20),
  ('project', 'project.quality', 'Chất lượng', array['/da/tabs/quality']::text[], 'DA', 30)
on conflict (code) do update
set application_code = excluded.application_code,
    name = excluded.name,
    routes = excluded.routes,
    legacy_module_key = excluded.legacy_module_key,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.permission_actions (
  module_code,
  action,
  permission_code,
  label,
  scope_modes,
  legacy_module_key,
  legacy_admin_only,
  sort_order
)
select
  pm.code,
  action_def.action,
  pm.code || '.' || action_def.action,
  action_def.label,
  array['global']::text[],
  pm.legacy_module_key,
  action_def.legacy_admin_only,
  action_def.sort_order
from public.permission_modules pm
cross join (
  values
    ('view'::text, 'Xem'::text, false, 10),
    ('manage'::text, 'Quản trị'::text, true, 20)
) as action_def(action, label, legacy_admin_only, sort_order)
where pm.application_code = 'system'
on conflict (permission_code) do update
set module_code = excluded.module_code,
    action = excluded.action,
    label = excluded.label,
    scope_modes = excluded.scope_modes,
    legacy_module_key = excluded.legacy_module_key,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.permission_actions (
  module_code,
  action,
  permission_code,
  label,
  scope_modes,
  legacy_module_key,
  legacy_route,
  legacy_admin_only,
  sort_order
)
values
  ('project.daily_log', 'view', 'project.daily_log.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', false, 10),
  ('project.daily_log', 'create', 'project.daily_log.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 20),
  ('project.daily_log', 'edit_own', 'project.daily_log.edit_own', 'Sửa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 30),
  ('project.daily_log', 'edit_all', 'project.daily_log.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 40),
  ('project.daily_log', 'submit', 'project.daily_log.submit', 'Gửi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 50),
  ('project.daily_log', 'return', 'project.daily_log.return', 'Trả lại', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 60),
  ('project.daily_log', 'approve', 'project.daily_log.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 70),
  ('project.daily_log', 'manage', 'project.daily_log.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 80),
  ('project.material_request', 'view', 'project.material_request.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', false, 10),
  ('project.material_request', 'create', 'project.material_request.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 20),
  ('project.material_request', 'edit_own', 'project.material_request.edit_own', 'Sửa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 30),
  ('project.material_request', 'edit_all', 'project.material_request.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 40),
  ('project.material_request', 'submit', 'project.material_request.submit', 'Gửi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 50),
  ('project.material_request', 'return', 'project.material_request.return', 'Trả lại', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 60),
  ('project.material_request', 'approve', 'project.material_request.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 70),
  ('project.material_request', 'manage', 'project.material_request.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 80),
  ('project.material_request', 'view_available_stock', 'project.material_request.view_available_stock', 'Xem tồn khả dụng', array['global','project','construction_site','warehouse']::text[], 'DA', '/da/tabs/material', false, 90),
  ('project.quality', 'view', 'project.quality.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', false, 10),
  ('project.quality', 'create', 'project.quality.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 20),
  ('project.quality', 'edit_own', 'project.quality.edit_own', 'Sửa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 30),
  ('project.quality', 'edit_all', 'project.quality.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 40),
  ('project.quality', 'submit', 'project.quality.submit', 'Gửi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 50),
  ('project.quality', 'return', 'project.quality.return', 'Trả lại', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 60),
  ('project.quality', 'approve', 'project.quality.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 70),
  ('project.quality', 'manage', 'project.quality.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 80)
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
    updated_at = now();

create or replace function public.replace_user_permission_grants(
  p_user_id uuid,
  p_grants jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_before jsonb;
  v_after jsonb := coalesce(p_grants, '[]'::jsonb);
begin
  if not app_private.can_manage_permissions() then
    raise exception 'Not allowed to manage permissions'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = p_user_id
  ) then
    raise exception 'Target user does not exist'
      using errcode = '23503';
  end if;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.permission_code, g.scope_type, g.scope_id), '[]'::jsonb)
  into v_before
  from public.user_permission_grants g
  where g.user_id = p_user_id;

  delete from public.user_permission_grants
  where user_id = p_user_id;

  insert into public.user_permission_grants (
    user_id,
    permission_code,
    scope_type,
    scope_id,
    is_active,
    granted_by,
    granted_at,
    expires_at
  )
  select
    p_user_id,
    grant_row.permission_code,
    coalesce(nullif(grant_row.scope_type, ''), 'global'),
    coalesce(nullif(grant_row.scope_id, ''), '*'),
    coalesce(grant_row.is_active, true),
    v_actor_user_id,
    now(),
    grant_row.expires_at
  from jsonb_to_recordset(v_after) as grant_row(
    permission_code text,
    scope_type text,
    scope_id text,
    is_active boolean,
    expires_at timestamptz
  )
  where coalesce(grant_row.is_active, true)
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = excluded.is_active,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at,
      updated_at = now();

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    v_actor_user_id,
    p_user_id,
    'replace_user_permission_grants',
    v_before,
    (
      select coalesce(jsonb_agg(to_jsonb(g) order by g.permission_code, g.scope_type, g.scope_id), '[]'::jsonb)
      from public.user_permission_grants g
      where g.user_id = p_user_id
    ),
    jsonb_build_object('source', 'phase1_permission_framework')
  );
end;
$$;

revoke all on function public.replace_user_permission_grants(uuid, jsonb) from public;
revoke all on function public.replace_user_permission_grants(uuid, jsonb) from anon;
grant execute on function public.replace_user_permission_grants(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

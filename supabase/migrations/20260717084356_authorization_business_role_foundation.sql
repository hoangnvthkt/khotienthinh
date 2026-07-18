-- Phase 2 Business Role and permission-risk foundation.

alter table public.permission_actions
  add column if not exists risk_level text not null default 'normal',
  add column if not exists is_business_action boolean not null default false,
  add column if not exists is_business_approval boolean not null default false,
  add column if not exists direct_grant_requires_expiry boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'permission_actions_risk_level_check'
      and conrelid = 'public.permission_actions'::regclass
  ) then
    alter table public.permission_actions
      add constraint permission_actions_risk_level_check
      check (risk_level in ('normal', 'important', 'sensitive'));
  end if;
end;
$$;

alter table public.role_permission_templates
  add column if not exists is_system boolean not null default false,
  add column if not exists version integer not null default 1;

alter table public.user_permission_grants
  add column if not exists grant_reason text;

create table public.principal_role_assignments (
  id uuid primary key default gen_random_uuid(),
  principal_type text not null default 'user'
    check (principal_type ~ '^[a-z][a-z0-9_]*$'),
  principal_id uuid not null,
  role_template_id uuid not null
    references public.role_permission_templates(id) on delete restrict,
  scope_type text not null default 'global'
    check (scope_type in ('global','own','assigned','project','construction_site','warehouse','department')),
  scope_id text not null default '*',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','REVOKED','EXPIRED')),
  assigned_by uuid references public.users(id) on delete set null,
  assigned_reason text not null check (char_length(btrim(assigned_reason)) >= 10),
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at <= created_at),
  check (expires_at is null or expires_at > starts_at),
  check (
    (status = 'REVOKED' and revoked_at is not null and char_length(btrim(coalesce(revoked_reason, ''))) >= 10)
    or (status <> 'REVOKED')
  )
);

create unique index principal_role_assignments_one_active_idx
  on public.principal_role_assignments (
    principal_type, principal_id, role_template_id, scope_type, scope_id
  ) where status = 'ACTIVE';

create index principal_role_assignments_principal_effective_idx
  on public.principal_role_assignments (principal_type, principal_id, status, starts_at, expires_at);

create index principal_role_assignments_role_effective_idx
  on public.principal_role_assignments (role_template_id, status, starts_at, expires_at);

create index principal_role_assignments_scope_idx
  on public.principal_role_assignments (scope_type, scope_id, status);

create index principal_role_assignments_assigned_by_idx
  on public.principal_role_assignments (assigned_by)
  where assigned_by is not null;

create index principal_role_assignments_revoked_by_idx
  on public.principal_role_assignments (revoked_by)
  where revoked_by is not null;

create or replace function app_private.guard_principal_role_assignment_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.principal_type <> 'user' then
    raise exception 'Only user principals are supported in authorization Phase 2'
      using errcode = '22023';
  end if;
  if new.status = 'ACTIVE' then
    perform app_private.assert_active_principal(new.principal_id);
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_principal_role_assignment_principal()
  from public, anon, authenticated;

create trigger trg_principal_role_assignments_active_principal
  before insert or update of principal_type, principal_id, status
  on public.principal_role_assignments
  for each row execute function app_private.guard_principal_role_assignment_principal();

update public.permission_actions pa
set is_business_action = pm.application_code <> 'system',
    risk_level = case
      when pa.action in ('approve','confirm','verify','mark_paid','publish','complete','lock') then 'sensitive'
      when pa.action in ('manage','edit_all','delete_all','export','perform','assign_staff','grant_permissions') then 'important'
      else 'normal'
    end,
    is_business_approval = (
      pm.application_code <> 'system'
      and pa.action in ('approve','confirm','verify','mark_paid','publish','complete','lock')
    ),
    direct_grant_requires_expiry = (
      pa.action in ('approve','confirm','verify','mark_paid','publish','complete','lock')
    ),
    updated_at = now()
from public.permission_modules pm
where pm.code = pa.module_code;

insert into public.permission_modules (
  application_code, code, name, description, routes, legacy_module_key, sort_order, is_active
)
values (
  'system', 'system.authorization', 'Quản trị phân quyền',
  'Business Role, direct grant, SoD và audit phân quyền',
  array['/settings']::text[], 'SETTINGS', 135, true
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    routes = excluded.routes,
    legacy_module_key = excluded.legacy_module_key,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.permission_actions (
  module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order,
  risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, is_active
)
values
  ('system.authorization','view','system.authorization.view','Xem quản trị phân quyền',null,array['global']::text[],'SETTINGS','/settings',true,10,'normal',false,false,false,true),
  ('system.authorization','manage_roles','system.authorization.manage_roles','Quản lý Business Role',null,array['global']::text[],'SETTINGS','/settings',true,20,'sensitive',false,false,true,true),
  ('system.authorization','manage_grants','system.authorization.manage_grants','Quản lý quyền trực tiếp',null,array['global']::text[],'SETTINGS','/settings',true,30,'sensitive',false,false,true,true),
  ('system.authorization','manage_scopes','system.authorization.manage_scopes','Quản lý phân công theo scope',null,array['global','project','construction_site','warehouse','department']::text[],'SETTINGS','/settings',true,40,'important',false,false,false,true),
  ('system.authorization','audit','system.authorization.audit','Xem audit phân quyền',null,array['global']::text[],'SETTINGS','/settings',true,50,'important',false,false,false,true),
  ('system.authorization','override','system.authorization.override','Ghi nhận override được phép',null,array['global']::text[],'SETTINGS','/settings',true,60,'sensitive',false,false,true,true)
on conflict (permission_code) do update
set label = excluded.label,
    scope_modes = excluded.scope_modes,
    risk_level = excluded.risk_level,
    is_business_action = excluded.is_business_action,
    is_business_approval = excluded.is_business_approval,
    direct_grant_requires_expiry = excluded.direct_grant_requires_expiry,
    is_active = true,
    updated_at = now();

do $$
begin
  if exists (
    select 1
    from public.role_permission_templates role_template
    where role_template.code in (
      'SYSTEM_ADMIN','PERMISSION_ADMIN','BUSINESS_SCOPE_ADMIN','BUSINESS_USER','AUDITOR'
    )
      and not role_template.is_system
  ) then
    raise exception 'Reserved Phase 2 Business Role code already exists'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.user_permission_grants grant_row
    where grant_row.permission_code = 'system.settings.manage'
      and grant_row.is_active
  ) or exists (
    select 1
    from public.role_permission_template_items item
    join public.role_permission_templates role_template
      on role_template.id = item.template_id
    where item.permission_code = 'system.settings.manage'
      and role_template.code <> 'SYSTEM_ADMIN'
  ) then
    raise exception 'System identity permission requires operator remediation before Phase 2'
      using errcode = '55000';
  end if;
end;
$$;

insert into public.role_permission_templates (code, name, description, is_active, is_system)
values
  ('SYSTEM_ADMIN','System Admin','Tài khoản, cấu hình hệ thống và vận hành kỹ thuật',true,true),
  ('PERMISSION_ADMIN','Permission Admin','Business Role, grant và kiểm soát phân quyền',true,true),
  ('BUSINESS_SCOPE_ADMIN','Business Scope Admin','Phân công trách nhiệm trong scope được ủy quyền',true,true),
  ('BUSINESS_USER','Business User','Vai trò nền không tự cấp quyền nghiệp vụ',true,true),
  ('AUDITOR','Auditor','Đọc cấu hình và lịch sử kiểm soát, không sửa hoặc duyệt',true,true)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true,
    is_system = true,
    updated_at = now();

insert into public.role_permission_template_items (template_id, permission_code, scope_type, scope_id, sort_order)
select rt.id, item.permission_code, 'global', '*', item.sort_order
from public.role_permission_templates rt
join (values
  ('SYSTEM_ADMIN','system.settings.manage',10),
  ('SYSTEM_ADMIN','system.authorization.view',20),
  ('PERMISSION_ADMIN','system.authorization.view',10),
  ('PERMISSION_ADMIN','system.authorization.manage_roles',20),
  ('PERMISSION_ADMIN','system.authorization.manage_grants',30),
  ('PERMISSION_ADMIN','system.authorization.manage_scopes',40),
  ('PERMISSION_ADMIN','system.authorization.audit',50),
  ('BUSINESS_SCOPE_ADMIN','system.authorization.manage_scopes',10),
  ('AUDITOR','system.authorization.view',10),
  ('AUDITOR','system.authorization.audit',20)
) item(role_code, permission_code, sort_order)
  on item.role_code = rt.code
on conflict (template_id, permission_code, scope_type, scope_id) do update
set sort_order = excluded.sort_order;

insert into public.principal_role_assignments (
  principal_type, principal_id, role_template_id, scope_type, scope_id,
  starts_at, status, assigned_by, assigned_reason
)
select 'user', u.id, rt.id, 'global', '*', now(), 'ACTIVE', null,
       'Phase 2 bootstrap from active legacy System Admin'
from public.users u
cross join public.role_permission_templates rt
where u.role = 'ADMIN'
  and u.is_active
  and u.account_status = 'ACTIVE'
  and rt.code in ('SYSTEM_ADMIN','PERMISSION_ADMIN')
on conflict (principal_type, principal_id, role_template_id, scope_type, scope_id)
  where status = 'ACTIVE'
do nothing;

insert into public.permission_audit_events (
  actor_user_id, target_user_id, event_type,
  before_grants, after_grants, metadata
)
select
  null,
  assignment.principal_id,
  'business_role_bootstrapped',
  '[]'::jsonb,
  '[]'::jsonb,
  jsonb_build_object(
    'assignmentId', assignment.id,
    'roleCode', role_template.code,
    'source', 'phase02_migration',
    'reason', assignment.assigned_reason
  )
from public.principal_role_assignments assignment
join public.role_permission_templates role_template
  on role_template.id = assignment.role_template_id
where assignment.status = 'ACTIVE'
  and role_template.code in ('SYSTEM_ADMIN','PERMISSION_ADMIN')
  and assignment.assigned_reason = 'Phase 2 bootstrap from active legacy System Admin'
  and not exists (
    select 1
    from public.permission_audit_events event_row
    where event_row.event_type = 'business_role_bootstrapped'
      and event_row.metadata ->> 'assignmentId' = assignment.id::text
  );

alter table public.principal_role_assignments enable row level security;

revoke all privileges on table public.principal_role_assignments from public, anon, authenticated;
grant select on table public.principal_role_assignments to authenticated;

create policy principal_role_assignments_self_select
on public.principal_role_assignments for select
to authenticated
using (
  principal_type = 'user'
  and principal_id = (select public.current_app_user_id())
);

revoke insert, update, delete on table public.role_permission_templates from authenticated;
revoke insert, update, delete on table public.role_permission_template_items from authenticated;
revoke insert, update, delete on table public.user_permission_grants from authenticated;
revoke insert, update, delete on table public.permission_audit_events from authenticated;

drop policy if exists role_permission_templates_insert on public.role_permission_templates;
drop policy if exists role_permission_templates_update on public.role_permission_templates;
drop policy if exists role_permission_templates_delete on public.role_permission_templates;
drop policy if exists role_permission_template_items_insert on public.role_permission_template_items;
drop policy if exists role_permission_template_items_update on public.role_permission_template_items;
drop policy if exists role_permission_template_items_delete on public.role_permission_template_items;
drop policy if exists user_permission_grants_insert on public.user_permission_grants;
drop policy if exists user_permission_grants_update on public.user_permission_grants;
drop policy if exists user_permission_grants_delete on public.user_permission_grants;
drop policy if exists permission_audit_events_insert on public.permission_audit_events;

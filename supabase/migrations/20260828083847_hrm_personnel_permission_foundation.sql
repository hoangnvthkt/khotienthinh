-- HRM personnel information permission foundation.
-- This phase registers canonical actions/scopes and governed business roles.

begin;

alter table public.user_permission_grants
  drop constraint if exists user_permission_grants_scope_type_chk;
alter table public.user_permission_grants
  add constraint user_permission_grants_scope_type_chk
  check (scope_type = any (array[
    'global', 'own', 'assigned', 'project', 'construction_site', 'warehouse',
    'department', 'direct_reports', 'org_unit'
  ]::text[]));

alter table public.principal_role_assignments
  drop constraint if exists principal_role_assignments_scope_type_check;
alter table public.principal_role_assignments
  add constraint principal_role_assignments_scope_type_check
  check (scope_type = any (array[
    'global', 'own', 'assigned', 'project', 'construction_site', 'warehouse',
    'department', 'direct_reports', 'org_unit'
  ]::text[]));

alter table public.role_permission_template_items
  drop constraint if exists role_permission_template_items_scope_type_chk;
alter table public.role_permission_template_items
  add constraint role_permission_template_items_scope_type_chk
  check (scope_type = any (array[
    'global', 'own', 'assigned', 'project', 'construction_site', 'warehouse',
    'department', 'direct_reports', 'org_unit'
  ]::text[]));

insert into public.permission_modules (
  application_code, code, name, routes, legacy_module_key, sort_order
)
values
  ('hrm', 'hrm.organization', 'Tổ chức', array['/org-map', '/settings/hrm-shared-catalog']::text[], 'HRM', 15),
  ('hrm', 'hrm.staffing', 'Định biên', array['/org-map', '/settings/hrm-shared-catalog']::text[], 'HRM', 18),
  ('hrm', 'hrm.contract', 'Hợp đồng', array['/hrm/contracts', '/hrm/employees']::text[], 'HRM', 42),
  ('hrm', 'hrm.document', 'Hồ sơ tài liệu', array['/hrm/documents', '/hrm/employees']::text[], 'HRM', 44),
  ('hrm', 'hrm.compensation', 'Đãi ngộ', array['/hrm/payroll', '/hrm/employees']::text[], 'HRM', 46)
on conflict (code) do update
set application_code = excluded.application_code,
    name = excluded.name,
    routes = excluded.routes,
    legacy_module_key = excluded.legacy_module_key,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.permission_actions (
  module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order,
  risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code
)
values
  ('hrm.organization', 'view', 'hrm.organization.view', 'Xem tổ chức', 'Xem projection sơ đồ tổ chức.', array['global','org_unit']::text[], null, '/org-map', false, 10, 'normal', true, false, false, 'enforced', 'hrm'),
  ('hrm.organization', 'manage', 'hrm.organization.manage', 'Quản lý tổ chức', 'Tạo, sửa hoặc lưu trữ đơn vị.', array['global','org_unit']::text[], null, '/org-map', true, 20, 'important', true, false, true, 'enforced', 'hrm'),
  ('hrm.staffing', 'view', 'hrm.staffing.view', 'Xem định biên', 'Xem định biên và tình trạng bố trí.', array['global','org_unit']::text[], null, '/org-map', false, 10, 'normal', true, false, false, 'enforced', 'hrm'),
  ('hrm.staffing', 'manage', 'hrm.staffing.manage', 'Điều chỉnh định biên', 'Tăng hoặc giảm định biên có audit.', array['global','org_unit']::text[], null, '/org-map', true, 20, 'important', true, true, true, 'enforced', 'hrm'),
  ('hrm.staffing', 'assign', 'hrm.staffing.assign', 'Phân bổ nhân sự', 'Gán, chuyển hoặc kết thúc phân bổ.', array['global','org_unit']::text[], null, '/org-map', true, 30, 'important', true, true, true, 'enforced', 'hrm'),
  ('hrm.staffing', 'set_manager', 'hrm.staffing.set_manager', 'Đặt quản lý đơn vị', 'Chỉ định manager slot.', array['global','org_unit']::text[], null, '/org-map', true, 40, 'important', true, true, true, 'enforced', 'hrm'),
  ('hrm.employee', 'view_directory', 'hrm.employee.view_directory', 'Xem danh bạ', 'Xem projection danh bạ C1.', array['global']::text[], null, '/hrm/employees', false, 40, 'normal', true, false, false, 'enforced', 'hrm'),
  ('hrm.employee', 'view_profile', 'hrm.employee.view_profile', 'Xem hồ sơ cá nhân', 'Xem dữ liệu C2 theo phạm vi.', array['global','own','direct_reports','org_unit','assigned']::text[], null, '/hrm/employees', false, 50, 'important', true, false, false, 'enforced', 'hrm'),
  ('hrm.employee', 'edit_profile', 'hrm.employee.edit_profile', 'Sửa hồ sơ cá nhân', 'Sửa allowlist C2 theo phạm vi.', array['global','own','org_unit']::text[], null, '/hrm/employees', true, 60, 'important', true, false, true, 'enforced', 'hrm'),
  ('hrm.employee', 'view_sensitive', 'hrm.employee.view_sensitive', 'Xem hồ sơ hạn chế', 'Xem dữ liệu C3 từ HR template.', array['global']::text[], null, '/hrm/employees', true, 70, 'sensitive', true, false, true, 'enforced', 'hrm'),
  ('hrm.employee', 'edit_sensitive', 'hrm.employee.edit_sensitive', 'Sửa hồ sơ hạn chế', 'Sửa dữ liệu C3 từ HR template.', array['global']::text[], null, '/hrm/employees', true, 80, 'sensitive', true, true, true, 'enforced', 'hrm'),
  ('hrm.employee', 'import', 'hrm.employee.import', 'Nhập hồ sơ', 'Dry-run và áp dụng import theo quyền domain.', array['global']::text[], null, '/hrm/employees', true, 90, 'sensitive', true, true, true, 'enforced', 'hrm'),
  ('hrm.employee', 'export', 'hrm.employee.export', 'Xuất hồ sơ', 'Xuất dữ liệu nhân sự có audit.', array['global']::text[], null, '/hrm/employees', true, 100, 'sensitive', true, true, true, 'enforced', 'hrm'),
  ('hrm.contract', 'view', 'hrm.contract.view', 'Xem hợp đồng', 'Xem hợp đồng C3.', array['global']::text[], null, '/hrm/contracts', true, 10, 'sensitive', true, false, true, 'enforced', 'hrm'),
  ('hrm.contract', 'manage', 'hrm.contract.manage', 'Quản lý hợp đồng', 'Tạo, sửa hoặc kết thúc hợp đồng.', array['global']::text[], null, '/hrm/contracts', true, 20, 'sensitive', true, true, true, 'enforced', 'hrm'),
  ('hrm.document', 'view', 'hrm.document.view', 'Xem tài liệu', 'Xem metadata hoặc file được phép.', array['global']::text[], null, '/hrm/documents', true, 10, 'sensitive', true, false, true, 'enforced', 'hrm'),
  ('hrm.document', 'manage', 'hrm.document.manage', 'Quản lý tài liệu', 'Quản lý hồ sơ và tài liệu.', array['global']::text[], null, '/hrm/documents', true, 20, 'sensitive', true, true, true, 'enforced', 'hrm'),
  ('hrm.attendance', 'approve', 'hrm.attendance.approve', 'Duyệt/chốt công', 'Duyệt hoặc chốt công theo phạm vi.', array['global','direct_reports','org_unit','assigned']::text[], null, '/hrm/attendance', true, 30, 'important', true, true, true, 'enforced', 'hrm'),
  ('hrm.compensation', 'view', 'hrm.compensation.view', 'Xem đãi ngộ', 'Xem dữ liệu C4 ngoài payroll result.', array['global']::text[], null, '/hrm/payroll', true, 10, 'sensitive', true, false, true, 'enforced', 'hrm'),
  ('hrm.compensation', 'manage', 'hrm.compensation.manage', 'Quản lý đãi ngộ', 'Quản lý mức lương và phụ cấp hiệu lực.', array['global']::text[], null, '/hrm/payroll', true, 20, 'sensitive', true, true, true, 'enforced', 'hrm'),
  ('hrm.payroll', 'export', 'hrm.payroll.export', 'Xuất bảng lương', 'Xuất kết quả payroll có audit.', array['global']::text[], null, '/hrm/payroll', true, 30, 'sensitive', true, true, true, 'enforced', 'hrm')
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
    risk_level = excluded.risk_level,
    is_business_action = excluded.is_business_action,
    is_business_approval = excluded.is_business_approval,
    direct_grant_requires_expiry = excluded.direct_grant_requires_expiry,
    grant_readiness = excluded.grant_readiness,
    access_application_code = excluded.access_application_code,
    is_active = true,
    updated_at = now();

update public.permission_actions
set scope_modes = array['global','own','department','direct_reports','org_unit','assigned']::text[],
    access_application_code = 'hrm',
    updated_at = now()
where permission_code in (
  'hrm.employee.view', 'hrm.employee.create', 'hrm.employee.edit',
  'hrm.attendance.view', 'hrm.attendance.edit',
  'hrm.leave.view', 'hrm.leave.approve',
  'hrm.payroll.view', 'hrm.payroll.manage',
  'hrm.master_data.view', 'hrm.master_data.manage'
);

insert into public.role_permission_templates (
  code, name, description, is_active, is_system, version
)
values
  ('HR', 'HR', 'Nghiệp vụ nhân sự hằng ngày; C3 manage và C4 read.', true, true, 1),
  ('HR_MANAGE', 'HR Manage', 'Toàn bộ HR cộng tổ chức, định biên, C4 manage và export.', true, true, 1)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true,
    is_system = true,
    version = excluded.version,
    updated_at = now();

delete from public.role_permission_template_items item
using public.role_permission_templates template
where item.template_id = template.id
  and (
    template.code in ('HR', 'HR_MANAGE')
    or (template.code = 'BUSINESS_USER' and item.permission_code like 'hrm.%')
  );

with template_actions(template_code, permission_code, scope_type, sort_order) as (
  values
    ('BUSINESS_USER', 'hrm.employee.view_directory', 'global', 10),
    ('BUSINESS_USER', 'hrm.employee.view_profile', 'own', 20),
    ('BUSINESS_USER', 'hrm.employee.edit_profile', 'own', 30),
    ('BUSINESS_USER', 'hrm.attendance.view', 'own', 40),
    ('BUSINESS_USER', 'hrm.leave.view', 'own', 50),

    ('HR', 'hrm.organization.view', 'global', 10),
    ('HR', 'hrm.staffing.view', 'global', 20),
    ('HR', 'hrm.employee.view_directory', 'global', 30),
    ('HR', 'hrm.employee.view_profile', 'global', 40),
    ('HR', 'hrm.employee.edit_profile', 'global', 50),
    ('HR', 'hrm.employee.view_sensitive', 'global', 60),
    ('HR', 'hrm.employee.edit_sensitive', 'global', 70),
    ('HR', 'hrm.employee.import', 'global', 80),
    ('HR', 'hrm.contract.view', 'global', 90),
    ('HR', 'hrm.contract.manage', 'global', 100),
    ('HR', 'hrm.document.view', 'global', 110),
    ('HR', 'hrm.document.manage', 'global', 120),
    ('HR', 'hrm.attendance.view', 'global', 130),
    ('HR', 'hrm.attendance.edit', 'global', 140),
    ('HR', 'hrm.attendance.approve', 'global', 150),
    ('HR', 'hrm.leave.view', 'global', 160),
    ('HR', 'hrm.leave.approve', 'global', 170),
    ('HR', 'hrm.compensation.view', 'global', 180),
    ('HR', 'hrm.payroll.view', 'global', 190),
    ('HR', 'hrm.master_data.view', 'global', 200),

    ('HR_MANAGE', 'hrm.organization.view', 'global', 10),
    ('HR_MANAGE', 'hrm.staffing.view', 'global', 20),
    ('HR_MANAGE', 'hrm.employee.view_directory', 'global', 30),
    ('HR_MANAGE', 'hrm.employee.view_profile', 'global', 40),
    ('HR_MANAGE', 'hrm.employee.edit_profile', 'global', 50),
    ('HR_MANAGE', 'hrm.employee.view_sensitive', 'global', 60),
    ('HR_MANAGE', 'hrm.employee.edit_sensitive', 'global', 70),
    ('HR_MANAGE', 'hrm.employee.import', 'global', 80),
    ('HR_MANAGE', 'hrm.contract.view', 'global', 90),
    ('HR_MANAGE', 'hrm.contract.manage', 'global', 100),
    ('HR_MANAGE', 'hrm.document.view', 'global', 110),
    ('HR_MANAGE', 'hrm.document.manage', 'global', 120),
    ('HR_MANAGE', 'hrm.attendance.view', 'global', 130),
    ('HR_MANAGE', 'hrm.attendance.edit', 'global', 140),
    ('HR_MANAGE', 'hrm.attendance.approve', 'global', 150),
    ('HR_MANAGE', 'hrm.leave.view', 'global', 160),
    ('HR_MANAGE', 'hrm.leave.approve', 'global', 170),
    ('HR_MANAGE', 'hrm.compensation.view', 'global', 180),
    ('HR_MANAGE', 'hrm.payroll.view', 'global', 190),
    ('HR_MANAGE', 'hrm.master_data.view', 'global', 200),
    ('HR_MANAGE', 'hrm.organization.manage', 'global', 210),
    ('HR_MANAGE', 'hrm.staffing.manage', 'global', 220),
    ('HR_MANAGE', 'hrm.staffing.assign', 'global', 230),
    ('HR_MANAGE', 'hrm.staffing.set_manager', 'global', 240),
    ('HR_MANAGE', 'hrm.compensation.manage', 'global', 250),
    ('HR_MANAGE', 'hrm.payroll.manage', 'global', 260),
    ('HR_MANAGE', 'hrm.master_data.manage', 'global', 270),
    ('HR_MANAGE', 'hrm.employee.export', 'global', 280),
    ('HR_MANAGE', 'hrm.payroll.export', 'global', 290)
)
insert into public.role_permission_template_items (
  template_id, permission_code, scope_type, scope_id, sort_order
)
select template.id, action.permission_code, action.scope_type, '*', action.sort_order
from template_actions action
join public.role_permission_templates template on template.code = action.template_code
on conflict (template_id, permission_code, scope_type, scope_id) do update
set sort_order = excluded.sort_order;

insert into public.principal_role_assignments (
  principal_type, principal_id, role_template_id, scope_type, scope_id,
  starts_at, status, assigned_reason
)
select
  'user', user_row.id, template.id, 'global', '*', now(), 'ACTIVE',
  'Migration: baseline business user'
from public.users user_row
join public.role_permission_templates template on template.code = 'BUSINESS_USER'
where coalesce(user_row.is_active, true)
  and coalesce(user_row.account_status, 'ACTIVE') = 'ACTIVE'
  and not exists (
    select 1
    from public.principal_role_assignments assignment_row
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = user_row.id
      and assignment_row.role_template_id = template.id
      and assignment_row.scope_type = 'global'
      and assignment_row.scope_id = '*'
      and assignment_row.status = 'ACTIVE'
  );

commit;

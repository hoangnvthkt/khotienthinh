-- Phase 4 ERP-wide permission rollout surface.
-- Adapter-first rollout for non-Project modules. Keeps legacy fallback active.

create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
grant usage on schema app_private to authenticated;

insert into public.permission_applications (code, name, sort_order)
values
  ('wms', 'Kho vật tư', 30),
  ('hrm', 'Nhân sự', 40),
  ('expense', 'Ngân sách', 50),
  ('workflow', 'Quy trình', 60),
  ('request', 'Yêu cầu', 70),
  ('asset', 'Tài sản', 80),
  ('contract', 'Hợp đồng', 90),
  ('ai', 'AI', 100),
  ('storage', 'Lưu trữ', 110),
  ('kb', 'Kho tri thức', 120),
  ('analytics', 'Phân tích', 130)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.permission_modules (application_code, code, name, routes, legacy_module_key, sort_order)
values
  ('wms', 'wms.inventory', 'Tồn kho', array['/dashboard','/inventory']::text[], 'WMS', 10),
  ('wms', 'wms.request', 'Đề xuất vật tư', array['/requests','/material-code-requests']::text[], 'WMS', 20),
  ('wms', 'wms.transaction', 'Giao dịch kho', array['/operations','/audit','/reports','/misa-export']::text[], 'WMS', 30),
  ('wms', 'wms.master_data', 'Danh mục kho', '{}'::text[], 'WMS', 40),
  ('hrm', 'hrm.employee', 'Nhân viên', array['/hrm/dashboard','/hrm/employees','/org-map']::text[], 'HRM', 10),
  ('hrm', 'hrm.attendance', 'Chấm công', array['/hrm/checkin','/hrm/attendance']::text[], 'HRM', 20),
  ('hrm', 'hrm.leave', 'Nghỉ phép', array['/hrm/leave']::text[], 'HRM', 30),
  ('hrm', 'hrm.payroll', 'Bảng lương', array['/hrm/payroll']::text[], 'HRM', 40),
  ('hrm', 'hrm.master_data', 'Danh mục nhân sự', array['/hrm/shifts','/hrm/contracts','/hrm/documents','/hrm/reports','/hrm/ranking']::text[], 'HRM', 50),
  ('expense', 'expense.budget', 'Ngân sách', array['/expense']::text[], 'EX', 10),
  ('expense', 'expense.expense_record', 'Ghi nhận chi phí', array['/expense']::text[], 'EX', 20),
  ('expense', 'expense.master_data', 'Danh mục chi phí', array['/expense']::text[], 'EX', 30),
  ('workflow', 'workflow.instance', 'Phiên quy trình', array['/wf/dashboard','/wf','/wf/instances/:id']::text[], 'WF', 10),
  ('workflow', 'workflow.template', 'Mẫu quy trình', array['/wf/templates','/wf/builder/:id']::text[], 'WF', 20),
  ('request', 'request.instance', 'Phiếu yêu cầu', array['/rq/dashboard','/rq']::text[], 'RQ', 10),
  ('request', 'request.category', 'Danh mục yêu cầu', array['/rq/categories']::text[], 'RQ', 20),
  ('request', 'request.template', 'Mẫu yêu cầu', array['/rq/categories']::text[], 'RQ', 30),
  ('asset', 'asset.catalog', 'Danh mục tài sản', array['/ts/dashboard','/ts/catalog','/ts/asset/:id']::text[], 'TS', 10),
  ('asset', 'asset.assignment', 'Cấp phát tài sản', array['/ts/assignment']::text[], 'TS', 20),
  ('asset', 'asset.maintenance', 'Bảo trì tài sản', array['/ts/maintenance']::text[], 'TS', 30),
  ('asset', 'asset.audit', 'Kiểm kê tài sản', array['/ts/audit','/ts/reports']::text[], 'TS', 40),
  ('contract', 'contract.partner', 'Đối tác', array['/hd','/hd/overview','/hd/partners']::text[], 'HD', 10),
  ('contract', 'contract.customer', 'Hợp đồng khách hàng', array['/hd/customer','/hd/customer/:id']::text[], 'HD', 20),
  ('contract', 'contract.supplier', 'Hợp đồng nhà cung cấp', array['/hd/supplier','/hd/subcontractor','/hd/subcontractor/:id']::text[], 'HD', 30),
  ('contract', 'contract.template', 'Mẫu hợp đồng', array['/hd/contract-types','/hd/catalogs']::text[], 'HD', 40),
  ('contract', 'contract.cost_library', 'Thư viện đơn giá', array['/hd/cost-library']::text[], 'HD', 50),
  ('ai', 'ai.assistant', 'Trợ lý AI', array['/ai']::text[], 'AI', 10),
  ('ai', 'ai.executive', 'AI điều hành', array['/ai/executive']::text[], 'AI', 20),
  ('ai', 'ai.report', 'Báo cáo AI', array['/ai/reports']::text[], 'AI', 30),
  ('storage', 'storage.files', 'Tệp lưu trữ', array['/storage']::text[], 'STORAGE', 10),
  ('kb', 'kb.articles', 'Bài viết tri thức', array['/knowledge-base']::text[], 'KB', 10),
  ('analytics', 'analytics.dashboard', 'Dashboard phân tích', array['/analytics']::text[], 'ANALYTICS', 10)
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
  legacy_route,
  legacy_admin_only,
  sort_order
)
values
  ('wms.inventory', 'view', 'wms.inventory.view', 'Xem', array['global','warehouse','own','assigned']::text[], 'WMS', '/inventory', false, 10),
  ('wms.inventory', 'edit', 'wms.inventory.edit', 'Sửa', array['global','warehouse','own','assigned']::text[], 'WMS', '/inventory', true, 20),
  ('wms.request', 'view', 'wms.request.view', 'Xem', array['global','warehouse','own','assigned']::text[], 'WMS', '/requests', false, 10),
  ('wms.request', 'create', 'wms.request.create', 'Tạo', array['global','warehouse','own','assigned']::text[], 'WMS', '/requests', true, 20),
  ('wms.request', 'approve', 'wms.request.approve', 'Duyệt', array['global','warehouse','own','assigned']::text[], 'WMS', '/requests', true, 30),
  ('wms.request', 'export', 'wms.request.export', 'Xuất kho', array['global','warehouse','own','assigned']::text[], 'WMS', '/requests', true, 40),
  ('wms.request', 'receive', 'wms.request.receive', 'Nhận kho', array['global','warehouse','own','assigned']::text[], 'WMS', '/requests', true, 50),
  ('wms.transaction', 'view', 'wms.transaction.view', 'Xem', array['global','warehouse','own','assigned']::text[], 'WMS', '/operations', false, 10),
  ('wms.transaction', 'create', 'wms.transaction.create', 'Tạo', array['global','warehouse','own','assigned']::text[], 'WMS', '/operations', true, 20),
  ('wms.transaction', 'approve', 'wms.transaction.approve', 'Duyệt', array['global','warehouse','own','assigned']::text[], 'WMS', '/operations', true, 30),
  ('wms.transaction', 'complete', 'wms.transaction.complete', 'Hoàn tất', array['global','warehouse','own','assigned']::text[], 'WMS', '/operations', true, 40),
  ('wms.master_data', 'manage', 'wms.master_data.manage', 'Quản trị danh mục', array['global','warehouse','own','assigned']::text[], 'WMS', null, true, 10),

  ('hrm.employee', 'view', 'hrm.employee.view', 'Xem', array['global','own','department','assigned']::text[], 'HRM', '/hrm/employees', false, 10),
  ('hrm.employee', 'create', 'hrm.employee.create', 'Tạo', array['global','own','department','assigned']::text[], 'HRM', '/hrm/employees', true, 20),
  ('hrm.employee', 'edit', 'hrm.employee.edit', 'Sửa', array['global','own','department','assigned']::text[], 'HRM', '/hrm/employees', true, 30),
  ('hrm.attendance', 'view', 'hrm.attendance.view', 'Xem', array['global','own','department','assigned']::text[], 'HRM', '/hrm/attendance', false, 10),
  ('hrm.attendance', 'edit', 'hrm.attendance.edit', 'Sửa', array['global','own','department','assigned']::text[], 'HRM', '/hrm/attendance', true, 20),
  ('hrm.leave', 'view', 'hrm.leave.view', 'Xem', array['global','own','department','assigned']::text[], 'HRM', '/hrm/leave', false, 10),
  ('hrm.leave', 'approve', 'hrm.leave.approve', 'Duyệt nghỉ phép', array['global','own','department','assigned']::text[], 'HRM', '/hrm/leave', true, 20),
  ('hrm.payroll', 'view', 'hrm.payroll.view', 'Xem', array['global','own','department','assigned']::text[], 'HRM', '/hrm/payroll', false, 10),
  ('hrm.payroll', 'manage', 'hrm.payroll.manage', 'Quản trị', array['global','own','department','assigned']::text[], 'HRM', '/hrm/payroll', true, 20),
  ('hrm.master_data', 'view', 'hrm.master_data.view', 'Xem', array['global','own','department','assigned']::text[], 'HRM', '/hrm/shifts', false, 10),
  ('hrm.master_data', 'manage', 'hrm.master_data.manage', 'Quản trị danh mục', array['global','own','department','assigned']::text[], 'HRM', '/hrm/shifts', true, 20),

  ('expense.budget', 'view', 'expense.budget.view', 'Xem', array['global','own','department']::text[], 'EX', '/expense', false, 10),
  ('expense.budget', 'create', 'expense.budget.create', 'Tạo', array['global','own','department']::text[], 'EX', '/expense', true, 20),
  ('expense.budget', 'edit_all', 'expense.budget.edit_all', 'Sửa tất cả', array['global','own','department']::text[], 'EX', '/expense', true, 30),
  ('expense.expense_record', 'view_own', 'expense.expense_record.view_own', 'Xem của mình', array['global','own','department']::text[], 'EX', '/expense', false, 10),
  ('expense.expense_record', 'view_all', 'expense.expense_record.view_all', 'Xem tất cả', array['global','own','department']::text[], 'EX', '/expense', false, 20),
  ('expense.expense_record', 'create', 'expense.expense_record.create', 'Tạo', array['global','own','department']::text[], 'EX', '/expense', true, 30),
  ('expense.expense_record', 'edit_own', 'expense.expense_record.edit_own', 'Sửa của mình', array['global','own','department']::text[], 'EX', '/expense', true, 40),
  ('expense.expense_record', 'approve', 'expense.expense_record.approve', 'Duyệt', array['global','own','department']::text[], 'EX', '/expense', true, 50),
  ('expense.master_data', 'manage', 'expense.master_data.manage', 'Quản trị danh mục', array['global','own','department']::text[], 'EX', '/expense', true, 10),

  ('workflow.instance', 'view', 'workflow.instance.view', 'Xem', array['global','own','assigned']::text[], 'WF', '/wf', false, 10),
  ('workflow.instance', 'create', 'workflow.instance.create', 'Tạo', array['global','own','assigned']::text[], 'WF', '/wf', true, 20),
  ('workflow.instance', 'act_assigned', 'workflow.instance.act_assigned', 'Xử lý được giao', array['global','own','assigned']::text[], 'WF', '/wf', true, 30),
  ('workflow.template', 'view', 'workflow.template.view', 'Xem', array['global','own','assigned']::text[], 'WF', '/wf/templates', false, 10),
  ('workflow.template', 'create', 'workflow.template.create', 'Tạo', array['global','own','assigned']::text[], 'WF', '/wf/templates', true, 20),
  ('workflow.template', 'edit', 'workflow.template.edit', 'Sửa', array['global','own','assigned']::text[], 'WF', '/wf/templates', true, 30),
  ('workflow.template', 'publish', 'workflow.template.publish', 'Phát hành', array['global','own','assigned']::text[], 'WF', '/wf/templates', true, 40),

  ('request.instance', 'view_own', 'request.instance.view_own', 'Xem của mình', array['global','own','assigned']::text[], 'RQ', '/rq', false, 10),
  ('request.instance', 'create', 'request.instance.create', 'Tạo', array['global','own','assigned']::text[], 'RQ', '/rq', true, 20),
  ('request.instance', 'act_assigned', 'request.instance.act_assigned', 'Xử lý được giao', array['global','own','assigned']::text[], 'RQ', '/rq', true, 30),
  ('request.instance', 'view_all', 'request.instance.view_all', 'Xem tất cả', array['global','own','assigned']::text[], 'RQ', '/rq', false, 40),
  ('request.category', 'view', 'request.category.view', 'Xem', array['global','own','assigned']::text[], 'RQ', '/rq/categories', false, 10),
  ('request.category', 'manage', 'request.category.manage', 'Quản trị danh mục', array['global','own','assigned']::text[], 'RQ', '/rq/categories', true, 20),
  ('request.template', 'view', 'request.template.view', 'Xem', array['global','own','assigned']::text[], 'RQ', '/rq/categories', false, 10),
  ('request.template', 'manage', 'request.template.manage', 'Quản trị mẫu', array['global','own','assigned']::text[], 'RQ', '/rq/categories', true, 20),

  ('asset.catalog', 'view', 'asset.catalog.view', 'Xem', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/catalog', false, 10),
  ('asset.catalog', 'manage', 'asset.catalog.manage', 'Quản trị', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/catalog', true, 20),
  ('asset.assignment', 'view', 'asset.assignment.view', 'Xem', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/assignment', false, 10),
  ('asset.assignment', 'create', 'asset.assignment.create', 'Tạo', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/assignment', true, 20),
  ('asset.assignment', 'approve', 'asset.assignment.approve', 'Duyệt', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/assignment', true, 30),
  ('asset.maintenance', 'view', 'asset.maintenance.view', 'Xem', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/maintenance', false, 10),
  ('asset.maintenance', 'create', 'asset.maintenance.create', 'Tạo', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/maintenance', true, 20),
  ('asset.maintenance', 'manage', 'asset.maintenance.manage', 'Quản trị', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/maintenance', true, 30),
  ('asset.audit', 'view', 'asset.audit.view', 'Xem', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/audit', false, 10),
  ('asset.audit', 'perform', 'asset.audit.perform', 'Thực hiện kiểm kê', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/audit', true, 20),

  ('contract.partner', 'view', 'contract.partner.view', 'Xem', array['global']::text[], 'HD', '/hd/partners', false, 10),
  ('contract.partner', 'manage', 'contract.partner.manage', 'Quản trị', array['global']::text[], 'HD', '/hd/partners', true, 20),
  ('contract.customer', 'view', 'contract.customer.view', 'Xem', array['global']::text[], 'HD', '/hd/customer', false, 10),
  ('contract.customer', 'manage', 'contract.customer.manage', 'Quản trị', array['global']::text[], 'HD', '/hd/customer', true, 20),
  ('contract.supplier', 'view', 'contract.supplier.view', 'Xem', array['global']::text[], 'HD', '/hd/supplier', false, 10),
  ('contract.supplier', 'manage', 'contract.supplier.manage', 'Quản trị', array['global']::text[], 'HD', '/hd/supplier', true, 20),
  ('contract.template', 'view', 'contract.template.view', 'Xem', array['global']::text[], 'HD', '/hd/contract-types', false, 10),
  ('contract.template', 'manage', 'contract.template.manage', 'Quản trị mẫu', array['global']::text[], 'HD', '/hd/contract-types', true, 20),
  ('contract.cost_library', 'view', 'contract.cost_library.view', 'Xem', array['global']::text[], 'HD', '/hd/cost-library', false, 10),
  ('contract.cost_library', 'manage', 'contract.cost_library.manage', 'Quản trị', array['global']::text[], 'HD', '/hd/cost-library', true, 20),

  ('ai.assistant', 'view', 'ai.assistant.view', 'Xem', array['global']::text[], 'AI', '/ai', false, 10),
  ('ai.assistant', 'use', 'ai.assistant.use', 'Sử dụng', array['global']::text[], 'AI', '/ai', false, 20),
  ('ai.executive', 'view', 'ai.executive.view', 'Xem', array['global']::text[], 'AI', '/ai/executive', false, 10),
  ('ai.report', 'view', 'ai.report.view', 'Xem', array['global']::text[], 'AI', '/ai/reports', false, 10),
  ('ai.report', 'generate', 'ai.report.generate', 'Tạo báo cáo', array['global']::text[], 'AI', '/ai/reports', true, 20),
  ('storage.files', 'view', 'storage.view', 'Xem', array['global']::text[], 'STORAGE', '/storage', false, 10),
  ('storage.files', 'manage', 'storage.manage', 'Quản trị', array['global']::text[], 'STORAGE', '/storage', true, 20),
  ('kb.articles', 'view', 'kb.view', 'Xem', array['global']::text[], 'KB', '/knowledge-base', false, 10),
  ('kb.articles', 'manage', 'kb.manage', 'Quản trị', array['global']::text[], 'KB', '/knowledge-base', true, 20),
  ('analytics.dashboard', 'view', 'analytics.view', 'Xem', array['global']::text[], 'ANALYTICS', '/analytics', false, 10),
  ('analytics.dashboard', 'export', 'analytics.export', 'Xuất dữ liệu', array['global']::text[], 'ANALYTICS', '/analytics', true, 20)
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

create or replace function public.has_permission(
  permission_code text,
  scope_type text default 'global',
  scope_id text default '*'
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.has_permission(
    public.current_app_user_id(),
    permission_code,
    coalesce(scope_type, 'global'),
    coalesce(scope_id, '*')
  );
$$;

revoke all on function public.has_permission(text, text, text) from public;
revoke all on function public.has_permission(text, text, text) from anon;
grant execute on function public.has_permission(text, text, text) to authenticated;

create or replace function public.has_any_permission(
  permission_codes text[],
  scope_type text default 'global',
  scope_id text default '*'
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.has_any_permission(
    public.current_app_user_id(),
    permission_codes,
    coalesce(scope_type, 'global'),
    coalesce(scope_id, '*')
  );
$$;

revoke all on function public.has_any_permission(text[], text, text) from public;
revoke all on function public.has_any_permission(text[], text, text) from anon;
grant execute on function public.has_any_permission(text[], text, text) to authenticated;

create or replace function public.assert_permission(
  permission_code text,
  scope_type text default 'global',
  scope_id text default '*'
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.has_permission(permission_code, scope_type, scope_id) then
    raise exception 'Missing required permission: % (%/%)', permission_code, coalesce(scope_type, 'global'), coalesce(scope_id, '*')
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_permission(text, text, text) from public;
revoke all on function public.assert_permission(text, text, text) from anon;
grant execute on function public.assert_permission(text, text, text) to authenticated;

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

  if jsonb_typeof(v_after) <> 'array' then
    raise exception 'Permission grants payload must be an array'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = p_user_id
  ) then
    raise exception 'Target user does not exist'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_after) as grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    left join public.permission_actions pa
      on pa.permission_code = grant_row.permission_code
      and coalesce(pa.is_active, true)
    where coalesce(grant_row.is_active, true)
      and (
        pa.permission_code is null
        or not coalesce(nullif(grant_row.scope_type, ''), 'global') = any(pa.scope_modes)
      )
  ) then
    raise exception 'Permission grant payload contains unknown permission code or unsupported scope'
      using errcode = '23514';
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
    jsonb_build_object('source', 'phase4_erp_permission_surface')
  );
end;
$$;

revoke all on function public.replace_user_permission_grants(uuid, jsonb) from public;
revoke all on function public.replace_user_permission_grants(uuid, jsonb) from anon;
grant execute on function public.replace_user_permission_grants(uuid, jsonb) to authenticated;

create or replace function app_private.current_user_is_global_wms_keeper()
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
      and u.role::text = 'WAREHOUSE_KEEPER'
      and u.assigned_warehouse_id is null
  );
$$;

create or replace function app_private.current_user_is_wms_keeper_for(p_warehouse_id text)
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
      and u.role::text = 'WAREHOUSE_KEEPER'
      and p_warehouse_id is not null
      and u.assigned_warehouse_id = p_warehouse_id
  );
$$;

revoke all on function app_private.current_user_is_global_wms_keeper() from public, anon;
revoke all on function app_private.current_user_is_wms_keeper_for(text) from public, anon;
grant execute on function app_private.current_user_is_global_wms_keeper() to authenticated;
grant execute on function app_private.current_user_is_wms_keeper_for(text) to authenticated;

create or replace function app_private.wms_has_action(
  p_permission_code text,
  p_source_warehouse_id text default null,
  p_target_warehouse_id text default null,
  p_requester_id uuid default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'wms.%'
  and p_user_id is not null
  and (
    app_private.has_permission(p_user_id, p_permission_code, 'global', '*')
    or (
      p_source_warehouse_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'warehouse', p_source_warehouse_id)
    )
    or (
      p_target_warehouse_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'warehouse', p_target_warehouse_id)
    )
    or (
      p_requester_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'own', p_user_id::text)
    )
    or (
      p_assigned_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'assigned', p_user_id::text)
    )
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
    or app_private.current_user_is_wms_keeper_for(p_target_warehouse_id)
  );
$$;

revoke all on function app_private.wms_has_action(text, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function app_private.wms_has_action(text, text, text, uuid, uuid, uuid) to authenticated;

create or replace function app_private.hrm_has_action(
  p_permission_code text,
  p_target_user_id uuid default null,
  p_department_id text default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'hrm.%'
  and p_user_id is not null
  and (
    app_private.has_permission(p_user_id, p_permission_code, 'global', '*')
    or (
      p_target_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'own', p_user_id::text)
    )
    or (
      p_department_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'department', p_department_id)
    )
    or (
      p_assigned_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'assigned', p_user_id::text)
    )
    or public.is_module_admin('HRM')
  );
$$;

revoke all on function app_private.hrm_has_action(text, uuid, text, uuid, uuid) from public, anon;
grant execute on function app_private.hrm_has_action(text, uuid, text, uuid, uuid) to authenticated;

create or replace function app_private.expense_has_action(
  p_permission_code text,
  p_owner_user_id uuid default null,
  p_department_id text default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'expense.%'
  and p_user_id is not null
  and (
    app_private.has_permission(p_user_id, p_permission_code, 'global', '*')
    or (
      p_owner_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'own', p_user_id::text)
    )
    or (
      p_department_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'department', p_department_id)
    )
    or public.is_module_admin('EX')
  );
$$;

revoke all on function app_private.expense_has_action(text, uuid, text, uuid) from public, anon;
grant execute on function app_private.expense_has_action(text, uuid, text, uuid) to authenticated;

create or replace function app_private.expense_record_is_owner(
  p_created_by text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and nullif(btrim(coalesce(p_created_by, '')), '') is not null
    and exists (
      select 1
      from public.users u
      where u.id = p_user_id
        and coalesce(u.is_active, true)
        and lower(btrim(coalesce(p_created_by, ''))) in (
          lower(u.id::text),
          lower(u.name),
          lower(u.email),
          lower(u.username)
        )
    );
$$;

revoke all on function app_private.expense_record_is_owner(text, uuid) from public, anon;
grant execute on function app_private.expense_record_is_owner(text, uuid) to authenticated;

create or replace function app_private.workflow_has_action(
  p_permission_code text,
  p_owner_user_id uuid default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_permission_code like 'workflow.%' or p_permission_code like 'request.%')
  and p_user_id is not null
  and (
    app_private.has_permission(p_user_id, p_permission_code, 'global', '*')
    or (
      p_owner_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'own', p_user_id::text)
    )
    or (
      p_assigned_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'assigned', p_user_id::text)
    )
    or (
      p_permission_code like 'workflow.%'
      and public.is_module_admin('WF')
    )
    or (
      p_permission_code like 'request.%'
      and public.is_module_admin('RQ')
    )
  );
$$;

revoke all on function app_private.workflow_has_action(text, uuid, uuid, uuid) from public, anon;
grant execute on function app_private.workflow_has_action(text, uuid, uuid, uuid) to authenticated;

create or replace function app_private.asset_has_action(
  p_permission_code text,
  p_warehouse_id text default null,
  p_department_id text default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'asset.%'
  and p_user_id is not null
  and (
    app_private.has_permission(p_user_id, p_permission_code, 'global', '*')
    or (
      p_warehouse_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'warehouse', p_warehouse_id)
    )
    or (
      p_department_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'department', p_department_id)
    )
    or (
      p_assigned_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'assigned', p_user_id::text)
    )
    or public.is_module_admin('TS')
  );
$$;

revoke all on function app_private.asset_has_action(text, text, text, uuid, uuid) from public, anon;
grant execute on function app_private.asset_has_action(text, text, text, uuid, uuid) to authenticated;

create or replace function app_private.global_has_action(
  p_permission_code text,
  p_legacy_module_key text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
  and (
    app_private.has_permission(p_user_id, p_permission_code, 'global', '*')
    or public.is_module_admin(p_legacy_module_key)
  );
$$;

revoke all on function app_private.global_has_action(text, text, uuid) from public, anon;
grant execute on function app_private.global_has_action(text, text, uuid) to authenticated;

create or replace function app_private.wms_request_can_access(
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
  select
    app_private.wms_has_action(
      'wms.request.view',
      p_source_warehouse_id,
      p_site_warehouse_id,
      p_requester_id,
      nullif(p_submitted_to_user_id, '')::uuid
    )
    or p_requester_id = public.current_app_user_id()
    or (
      p_submitted_to_user_id is not null
      and p_submitted_to_user_id = public.current_app_user_id()::text
    );
$$;

revoke all on function app_private.wms_request_can_access(uuid, text, text, text) from public, anon;
grant execute on function app_private.wms_request_can_access(uuid, text, text, text) to authenticated;

create or replace function app_private.transaction_can_insert(
  p_type text,
  p_requester_id uuid,
  p_approver_id uuid,
  p_source_warehouse_id text,
  p_target_warehouse_id text,
  p_related_request_id text,
  p_items jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.wms_has_action(
      'wms.transaction.create',
      p_source_warehouse_id,
      p_target_warehouse_id,
      p_requester_id,
      p_approver_id
    )
    or exists (
      select 1
      from public.requests r
      where r.id = p_related_request_id
        and coalesce(r.request_origin, 'wms') = 'project'
        and r.submitted_to_user_id = public.current_app_user_id()::text
        and r.status::text in ('APPROVED', 'IN_TRANSIT')
        and exists (
          select 1
          from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
          where coalesce(item->>'materialRequestId', item->>'material_request_id') = r.id
        )
    );
$$;

revoke all on function app_private.transaction_can_insert(text, uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function app_private.transaction_can_insert(text, uuid, uuid, text, text, text, jsonb) to authenticated;

create or replace function public.process_transaction_status(
  p_transaction_id text,
  p_status public.transaction_status,
  p_approver_id uuid
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_line jsonb;
  v_pending jsonb;
  v_check record;
  v_item_id text;
  v_qty integer;
  v_on_hand numeric;
  v_tx_reserved numeric;
  v_request_reserved numeric;
  v_reserved numeric;
  v_available numeric;
  v_item_name text;
  v_warehouse_name text;
  v_stock_warehouse_id text;
  v_is_fulfillment_transfer boolean := false;
  v_can_approve boolean := false;
  v_can_complete boolean := false;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
    where nullif(line.value->>'fulfillmentBatchId', '') is not null
  )
  into v_is_fulfillment_transfer;

  v_is_fulfillment_transfer := v_is_fulfillment_transfer
    and v_tx.type = 'TRANSFER'::public.transaction_type
    and nullif(v_tx.target_warehouse_id, '') is not null;

  v_can_approve := app_private.wms_has_action(
    'wms.transaction.approve',
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  v_can_complete := app_private.wms_has_action(
    'wms.transaction.complete',
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  if p_status = 'APPROVED'::public.transaction_status and not v_can_approve then
    raise exception 'insufficient privilege to approve transaction'
      using errcode = '42501';
  end if;

  if p_status = 'CANCELLED'::public.transaction_status
     and not v_can_approve
     and v_tx.requester_id is distinct from v_user.id then
    raise exception 'insufficient privilege to cancel transaction'
      using errcode = '42501';
  end if;

  if p_status = 'COMPLETED'::public.transaction_status and not v_can_complete then
    raise exception 'insufficient privilege to complete transaction'
      using errcode = '42501';
  end if;

  if v_tx.status = p_status then
    return v_tx;
  end if;
  if v_tx.status = 'CANCELLED'::public.transaction_status then
    raise exception 'cancelled transaction cannot be changed';
  end if;
  if v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'completed transaction cannot be changed';
  end if;

  if p_status = 'COMPLETED'::public.transaction_status
     and v_is_fulfillment_transfer
     and v_tx.status <> 'APPROVED'::public.transaction_status then
    raise exception 'Đợt cấp cần được thủ kho công trường duyệt số lượng/chất lượng trước khi xác nhận nhập kho.';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status)
     and v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type, 'ADJUSTMENT'::public.transaction_type) then
    v_stock_warehouse_id := case
      when v_tx.type = 'ADJUSTMENT'::public.transaction_type then v_tx.target_warehouse_id
      else v_tx.source_warehouse_id
    end;
    if nullif(v_stock_warehouse_id, '') is null then
      raise exception 'source warehouse is required for stock-out transaction';
    end if;

    for v_check in
      select
        line.value->>'itemId' as item_id,
        sum(
          case
            when v_tx.type = 'ADJUSTMENT'::public.transaction_type
              then abs(least(0, coalesce(nullif(line.value->>'quantity', '')::numeric, 0)))
            else coalesce(nullif(line.value->>'quantity', '')::numeric, 0)
          end
        ) as qty
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
      group by line.value->>'itemId'
    loop
      v_item_id := v_check.item_id;
      v_qty := coalesce(v_check.qty, 0)::integer;
      if v_item_id is null then
        raise exception 'invalid transaction item payload';
      end if;
      if v_qty <= 0 then
        if v_tx.type = 'ADJUSTMENT'::public.transaction_type then
          continue;
        end if;
        raise exception 'invalid transaction item payload';
      end if;

      select
        coalesce((coalesce(i.stock_by_warehouse, '{}'::jsonb) ->> v_stock_warehouse_id)::numeric, 0),
        i.name
      into v_on_hand, v_item_name
      from public.items i
      where i.id = v_item_id
      for update;
      if not found then
        raise exception 'item not found: %', v_item_id;
      end if;

      select coalesce(sum(coalesce(nullif(line.value->>'quantity', '')::numeric, 0)), 0)
      into v_tx_reserved
      from public.transactions t
      cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) line(value)
      where t.id <> v_tx.id
        and t.source_warehouse_id = v_stock_warehouse_id
        and t.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
        and t.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type)
        and line.value->>'itemId' = v_item_id;

      select coalesce(sum(
        case
          when r.status = 'PENDING'::public.request_status
            then coalesce(nullif(line.value->>'requestQty', '')::numeric, 0)
          else coalesce(nullif(line.value->>'approvedQty', '')::numeric, 0)
        end
      ), 0)
      into v_request_reserved
      from public.requests r
      cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) line(value)
      where r.source_warehouse_id = v_stock_warehouse_id
        and (v_tx.related_request_id is null or r.id <> v_tx.related_request_id)
        and r.status in ('PENDING'::public.request_status, 'APPROVED'::public.request_status, 'IN_TRANSIT'::public.request_status)
        and not (
          (coalesce(r.request_origin, 'wms') = 'project' or r.project_id is not null or r.construction_site_id is not null)
          and r.status <> 'PENDING'::public.request_status
        )
        and line.value->>'itemId' = v_item_id;

      v_reserved := coalesce(v_tx_reserved, 0) + coalesce(v_request_reserved, 0);
      v_available := greatest(0, v_on_hand - v_reserved);
      if v_qty > v_available then
        select name into v_warehouse_name from public.warehouses where id = v_stock_warehouse_id;
        raise exception 'Không đủ tồn khả dụng tại kho "%": vật tư "%"; cần %, tồn thực %, đang giữ %, khả dụng %. Vui lòng xử lý phiếu pending/giữ chỗ trước.',
          coalesce(v_warehouse_name, v_stock_warehouse_id),
          coalesce(v_item_name, v_item_id),
          v_qty,
          v_on_hand,
          v_reserved,
          v_available;
      end if;
    end loop;
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_pending in
      select value from jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb))
    loop
      insert into public.items (
        id, sku, name, category, unit, purchase_unit,
        price_in, price_out, min_stock, supplier_id, image_url,
        stock_by_warehouse, location
      )
      values (
        v_pending->>'id',
        v_pending->>'sku',
        v_pending->>'name',
        coalesce(nullif(v_pending->>'category', ''), 'Khác'),
        coalesce(nullif(v_pending->>'unit', ''), 'Cái'),
        nullif(v_pending->>'purchaseUnit', ''),
        coalesce(nullif(v_pending->>'priceIn', '')::numeric, 0),
        coalesce(nullif(v_pending->>'priceOut', '')::numeric, 0),
        coalesce(nullif(v_pending->>'minStock', '')::integer, 0),
        nullif(v_pending->>'supplierId', ''),
        nullif(v_pending->>'imageUrl', ''),
        coalesce(v_pending->'stockByWarehouse', '{}'::jsonb),
        nullif(v_pending->>'location', '')
      )
      on conflict (id) do nothing;
    end loop;
  end if;

  if p_status = 'COMPLETED'::public.transaction_status then
    for v_line in
      select value from jsonb_array_elements(v_tx.items)
    loop
      v_item_id := v_line->>'itemId';
      v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0)::integer;
      if v_item_id is null
         or (v_tx.type = 'ADJUSTMENT'::public.transaction_type and v_qty = 0)
         or (v_tx.type <> 'ADJUSTMENT'::public.transaction_type and v_qty <= 0) then
        raise exception 'invalid transaction item payload';
      end if;

      if v_tx.type = 'IMPORT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type) then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
      elsif v_tx.type = 'TRANSFER'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type = 'ADJUSTMENT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  end if;

  update public.transactions
  set status = p_status,
      approver_id = p_approver_id
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$$;

revoke all on function public.process_transaction_status(text, public.transaction_status, uuid) from public;
revoke all on function public.process_transaction_status(text, public.transaction_status, uuid) from anon;
grant execute on function public.process_transaction_status(text, public.transaction_status, uuid) to authenticated;

drop policy if exists items_delete on public.items;
drop policy if exists items_select on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_write on public.items;
drop policy if exists items_phase4_select on public.items;
drop policy if exists items_phase4_insert on public.items;
drop policy if exists items_phase4_update on public.items;
drop policy if exists items_phase4_delete on public.items;

alter table if exists public.items enable row level security;
revoke all privileges on table public.items from anon;
grant select, insert, update, delete on table public.items to authenticated;

create policy items_phase4_select
on public.items for select
to authenticated
using (
  app_private.wms_has_action('wms.inventory.view')
  or app_private.wms_has_action('wms.inventory.edit')
  or app_private.wms_has_action('wms.master_data.manage')
);

create policy items_phase4_insert
on public.items for insert
to authenticated
with check (
  app_private.wms_has_action('wms.inventory.edit')
  or app_private.wms_has_action('wms.master_data.manage')
);

create policy items_phase4_update
on public.items for update
to authenticated
using (
  app_private.wms_has_action('wms.inventory.edit')
  or app_private.wms_has_action('wms.master_data.manage')
)
with check (
  app_private.wms_has_action('wms.inventory.edit')
  or app_private.wms_has_action('wms.master_data.manage')
);

create policy items_phase4_delete
on public.items for delete
to authenticated
using (app_private.wms_has_action('wms.master_data.manage'));

do $$
declare
  tbl text;
begin
  foreach tbl in array array['warehouses', 'warehouse_types']
  loop
    if to_regclass(format('public.%I', tbl)) is not null then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('revoke all privileges on table public.%I from anon', tbl);
      execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);
      execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);
      execute format('drop policy if exists %I on public.%I', tbl || '_select', tbl);
      execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
      execute format('drop policy if exists %I on public.%I', tbl || '_write', tbl);
      execute format('drop policy if exists %I on public.%I', tbl || '_phase4_select', tbl);
      execute format('drop policy if exists %I on public.%I', tbl || '_phase4_insert', tbl);
      execute format('drop policy if exists %I on public.%I', tbl || '_phase4_update', tbl);
      execute format('drop policy if exists %I on public.%I', tbl || '_phase4_delete', tbl);
      execute format('create policy %I on public.%I for select to authenticated using (app_private.wms_has_action(%L) or app_private.wms_has_action(%L))', tbl || '_phase4_select', tbl, 'wms.inventory.view', 'wms.master_data.manage');
      execute format('create policy %I on public.%I for insert to authenticated with check (app_private.wms_has_action(%L))', tbl || '_phase4_insert', tbl, 'wms.master_data.manage');
      execute format('create policy %I on public.%I for update to authenticated using (app_private.wms_has_action(%L)) with check (app_private.wms_has_action(%L))', tbl || '_phase4_update', tbl, 'wms.master_data.manage', 'wms.master_data.manage');
      execute format('create policy %I on public.%I for delete to authenticated using (app_private.wms_has_action(%L))', tbl || '_phase4_delete', tbl, 'wms.master_data.manage');
    end if;
  end loop;
end $$;

drop policy if exists transactions_delete on public.transactions;
drop policy if exists transactions_select on public.transactions;
drop policy if exists transactions_update on public.transactions;
drop policy if exists transactions_write on public.transactions;
drop policy if exists transactions_phase4_select on public.transactions;
drop policy if exists transactions_phase4_insert on public.transactions;
alter table if exists public.transactions enable row level security;
revoke all privileges on table public.transactions from anon;
grant select, insert, update, delete on table public.transactions to authenticated;

create policy transactions_phase4_select
on public.transactions for select
to authenticated
using (
  app_private.wms_has_action(
    'wms.transaction.view',
    source_warehouse_id,
    target_warehouse_id,
    requester_id,
    approver_id
  )
);

create policy transactions_phase4_insert
on public.transactions for insert
to authenticated
with check (
  app_private.transaction_can_insert(
    type::text,
    requester_id,
    approver_id,
    source_warehouse_id,
    target_warehouse_id,
    related_request_id,
    items
  )
);

drop policy if exists material_code_requests_select on public.material_code_requests;
drop policy if exists material_code_requests_insert on public.material_code_requests;
drop policy if exists material_code_requests_update on public.material_code_requests;
drop policy if exists material_code_requests_delete on public.material_code_requests;

create policy material_code_requests_select
on public.material_code_requests for select
to authenticated
using (
  app_private.wms_has_action('wms.request.view', null, null, requested_by_user_id)
  or requested_by_user_id = public.current_app_user_id()
);

create policy material_code_requests_insert
on public.material_code_requests for insert
to authenticated
with check (
  requested_by_user_id = public.current_app_user_id()
  and app_private.wms_has_action('wms.request.create', null, null, requested_by_user_id)
);

create policy material_code_requests_update
on public.material_code_requests for update
to authenticated
using (app_private.wms_has_action('wms.request.approve', null, null, requested_by_user_id))
with check (app_private.wms_has_action('wms.request.approve', null, null, requested_by_user_id));

create policy material_code_requests_delete
on public.material_code_requests for delete
to authenticated
using (app_private.wms_has_action('wms.master_data.manage'));

drop policy if exists budget_cat_delete on public.budget_categories;
drop policy if exists budget_cat_select on public.budget_categories;
drop policy if exists budget_cat_update on public.budget_categories;
drop policy if exists budget_cat_write on public.budget_categories;
drop policy if exists budget_categories_phase4_select on public.budget_categories;
drop policy if exists budget_categories_phase4_insert on public.budget_categories;
drop policy if exists budget_categories_phase4_update on public.budget_categories;
drop policy if exists budget_categories_phase4_delete on public.budget_categories;
alter table if exists public.budget_categories enable row level security;

create policy budget_categories_phase4_select
on public.budget_categories for select
to authenticated
using (
  app_private.expense_has_action('expense.budget.view')
  or app_private.expense_has_action('expense.master_data.manage')
);

create policy budget_categories_phase4_insert
on public.budget_categories for insert
to authenticated
with check (app_private.expense_has_action('expense.master_data.manage'));

create policy budget_categories_phase4_update
on public.budget_categories for update
to authenticated
using (app_private.expense_has_action('expense.master_data.manage'))
with check (app_private.expense_has_action('expense.master_data.manage'));

create policy budget_categories_phase4_delete
on public.budget_categories for delete
to authenticated
using (app_private.expense_has_action('expense.master_data.manage'));

drop policy if exists budget_entries_delete on public.budget_entries;
drop policy if exists budget_entries_select on public.budget_entries;
drop policy if exists budget_entries_update on public.budget_entries;
drop policy if exists budget_entries_write on public.budget_entries;
drop policy if exists budget_entries_phase4_select on public.budget_entries;
drop policy if exists budget_entries_phase4_insert on public.budget_entries;
drop policy if exists budget_entries_phase4_update on public.budget_entries;
drop policy if exists budget_entries_phase4_delete on public.budget_entries;
alter table if exists public.budget_entries enable row level security;

create policy budget_entries_phase4_select
on public.budget_entries for select
to authenticated
using (
  app_private.expense_has_action('expense.budget.view')
  or app_private.expense_has_action('expense.budget.edit_all')
);

create policy budget_entries_phase4_insert
on public.budget_entries for insert
to authenticated
with check (app_private.expense_has_action('expense.budget.create'));

create policy budget_entries_phase4_update
on public.budget_entries for update
to authenticated
using (app_private.expense_has_action('expense.budget.edit_all'))
with check (app_private.expense_has_action('expense.budget.edit_all'));

create policy budget_entries_phase4_delete
on public.budget_entries for delete
to authenticated
using (app_private.expense_has_action('expense.budget.edit_all'));

drop policy if exists expense_records_delete on public.expense_records;
drop policy if exists expense_records_select on public.expense_records;
drop policy if exists expense_records_update on public.expense_records;
drop policy if exists expense_records_write on public.expense_records;
drop policy if exists expense_records_phase4_select on public.expense_records;
drop policy if exists expense_records_phase4_insert on public.expense_records;
drop policy if exists expense_records_phase4_update on public.expense_records;
drop policy if exists expense_records_phase4_delete on public.expense_records;
alter table if exists public.expense_records enable row level security;

create policy expense_records_phase4_select
on public.expense_records for select
to authenticated
using (
  app_private.expense_has_action('expense.expense_record.view_all')
  or (
    app_private.expense_record_is_owner("createdBy")
    and app_private.expense_has_action('expense.expense_record.view_own', public.current_app_user_id())
  )
);

create policy expense_records_phase4_insert
on public.expense_records for insert
to authenticated
with check (
  app_private.expense_has_action('expense.expense_record.create')
  and (
    nullif(btrim(coalesce("createdBy", '')), '') is null
    or app_private.expense_record_is_owner("createdBy")
  )
);

create policy expense_records_phase4_update
on public.expense_records for update
to authenticated
using (
  app_private.expense_has_action('expense.expense_record.approve')
  or (
    app_private.expense_record_is_owner("createdBy")
    and app_private.expense_has_action('expense.expense_record.edit_own', public.current_app_user_id())
  )
)
with check (
  app_private.expense_has_action('expense.expense_record.approve')
  or (
    app_private.expense_record_is_owner("createdBy")
    and app_private.expense_has_action('expense.expense_record.edit_own', public.current_app_user_id())
  )
);

create policy expense_records_phase4_delete
on public.expense_records for delete
to authenticated
using (app_private.expense_has_action('expense.expense_record.approve'));

notify pgrst, 'reload schema';

-- HRM employee action permissions.
--
-- Inventory source:
-- docs/superpowers/plans/artifacts/application-permission-backend-inventory.md
--
-- Concrete backend targets confirmed before this migration:
-- - table: public.employees
-- - primary key: public.employees.id uuid
-- - scope columns: public.employees.department_id uuid, public.employees.user_id uuid
-- - legacy policies being replaced:
--   employees_select, employees_write, employees_update
-- - legacy policy intentionally left in place:
--   employees_delete, because the registry does not yet define a delete action.
--
-- This migration promotes only hrm.employee.view/create/edit to enforced.
-- Delete, payroll, attendance, leave, and master-data HRM operations remain
-- separate slices.

create or replace function app_private.hrm_employee_has_permission(
  p_permission_code text,
  p_department_id uuid default null,
  p_target_user_id uuid default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'hrm.employee.%'
  and p_user_id is not null
  and (
    app_private.has_permission(p_user_id, p_permission_code, 'global', '*')
    or (
      p_department_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'department', p_department_id::text)
    )
    or (
      p_target_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'own', p_user_id::text)
    )
    or (
      p_assigned_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'assigned', p_user_id::text)
    )
  );
$$;

revoke all on function app_private.hrm_employee_has_permission(text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function app_private.hrm_employee_has_permission(text, uuid, uuid, uuid, uuid) to authenticated;

create or replace function app_private.hrm_employee_has_action(
  p_permission_code text,
  p_department_id uuid default null,
  p_target_user_id uuid default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code in (
    'hrm.employee.view',
    'hrm.employee.create',
    'hrm.employee.edit'
  )
  and app_private.hrm_employee_has_permission(
    'hrm.employee.view',
    p_department_id,
    p_target_user_id,
    p_assigned_user_id,
    p_user_id
  )
  and (
    p_permission_code = 'hrm.employee.view'
    or app_private.hrm_employee_has_permission(
      p_permission_code,
      p_department_id,
      p_target_user_id,
      p_assigned_user_id,
      p_user_id
    )
  );
$$;

revoke all on function app_private.hrm_employee_has_action(text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function app_private.hrm_employee_has_action(text, uuid, uuid, uuid, uuid) to authenticated;

alter table public.employees enable row level security;

drop policy if exists employees_select on public.employees;
drop policy if exists employees_write on public.employees;
drop policy if exists employees_update on public.employees;
drop policy if exists employees_select_action on public.employees;
drop policy if exists employees_insert_action on public.employees;
drop policy if exists employees_update_action on public.employees;

create policy employees_select_action
on public.employees for select
to authenticated
using (
  app_private.hrm_employee_has_action('hrm.employee.view', department_id, user_id, user_id)
);

create policy employees_insert_action
on public.employees for insert
to authenticated
with check (
  app_private.hrm_employee_has_action('hrm.employee.create', department_id, user_id, user_id)
);

create policy employees_update_action
on public.employees for update
to authenticated
using (
  app_private.hrm_employee_has_action('hrm.employee.edit', department_id, user_id, user_id)
)
with check (
  app_private.hrm_employee_has_action('hrm.employee.edit', department_id, user_id, user_id)
);

update public.permission_actions
set grant_readiness = 'enforced',
    updated_at = now()
where permission_code in ('hrm.employee.view', 'hrm.employee.create', 'hrm.employee.edit');

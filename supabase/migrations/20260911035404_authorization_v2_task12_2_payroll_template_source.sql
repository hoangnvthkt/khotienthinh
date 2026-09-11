-- Task 12.2: keep payroll administration aligned with the HR business-role gate.
-- Employee self-service uses public.list_my_payrolls() and is intentionally separate.

create or replace function app_private.is_hrm_template_only_permission(
  p_permission_code text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_permission_code = any(array[
    'hrm.organization.manage',
    'hrm.staffing.manage',
    'hrm.staffing.assign',
    'hrm.staffing.set_manager',
    'hrm.employee.view_sensitive',
    'hrm.employee.edit_sensitive',
    'hrm.employee.import',
    'hrm.employee.export',
    'hrm.contract.view',
    'hrm.contract.manage',
    'hrm.document.view',
    'hrm.document.manage',
    'hrm.compensation.view',
    'hrm.compensation.manage',
    'hrm.payroll.view',
    'hrm.payroll.manage',
    'hrm.payroll.export',
    'hrm.master_data.manage'
  ]::text[]);
$$;

create or replace function app_private.has_hrm_template_permission(
  p_user_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      p_user_id,
      p_permission_code,
      'global',
      '*',
      now()
    ) source_row
    where source_row.source_type = 'ROLE'
      and source_row.source_code in ('HR', 'HR_MANAGE')
      and source_row.scope_type = 'global'
      and source_row.scope_id = '*'
  );
$$;

revoke all on function app_private.is_hrm_template_only_permission(text)
  from public, anon, authenticated;
revoke all on function app_private.has_hrm_template_permission(uuid, text)
  from public, anon, authenticated;

grant execute on function app_private.is_hrm_template_only_permission(text)
  to service_role;
grant execute on function app_private.has_hrm_template_permission(uuid, text)
  to service_role;

begin;

set local statement_timeout = '30s';

do $$
declare
  v_missing text[];
  v_hr_count integer;
  v_hr_manage_count integer;
begin
  select array_agg(required.permission_code order by required.permission_code)
  into v_missing
  from unnest(array[
    'hrm.organization.view', 'hrm.organization.manage',
    'hrm.staffing.view', 'hrm.staffing.manage', 'hrm.staffing.assign', 'hrm.staffing.set_manager',
    'hrm.employee.view_directory', 'hrm.employee.view_profile', 'hrm.employee.edit_profile',
    'hrm.employee.view_sensitive', 'hrm.employee.edit_sensitive', 'hrm.employee.import', 'hrm.employee.export',
    'hrm.contract.view', 'hrm.contract.manage',
    'hrm.document.view', 'hrm.document.manage',
    'hrm.attendance.view', 'hrm.attendance.edit', 'hrm.attendance.approve',
    'hrm.leave.view', 'hrm.leave.approve',
    'hrm.compensation.view', 'hrm.compensation.manage',
    'hrm.payroll.view', 'hrm.payroll.manage', 'hrm.payroll.export',
    'hrm.master_data.view', 'hrm.master_data.manage'
  ]::text[]) as required(permission_code)
  where not exists (
    select 1
    from public.permission_actions action_row
    where action_row.permission_code = required.permission_code
      and action_row.is_active
  );

  if cardinality(coalesce(v_missing, '{}'::text[])) > 0 then
    raise exception 'HRM_PERMISSION_ACTIONS_MISSING: %', array_to_string(v_missing, ', ');
  end if;

  if not exists (
    select 1
    from public.permission_actions action_row
    where action_row.permission_code = 'hrm.employee.view_profile'
      and action_row.scope_modes @> array['direct_reports', 'org_unit']::text[]
  ) then
    raise exception 'HRM_PERMISSION_SCOPES_MISSING';
  end if;

  select count(*) into v_hr_count
  from public.role_permission_template_items item
  join public.role_permission_templates template on template.id = item.template_id
  where template.code = 'HR' and template.is_system and template.is_active;

  select count(*) into v_hr_manage_count
  from public.role_permission_template_items item
  join public.role_permission_templates template on template.id = item.template_id
  where template.code = 'HR_MANAGE' and template.is_system and template.is_active;

  if v_hr_count = 0 or v_hr_manage_count <= v_hr_count then
    raise exception 'HRM_ROLE_TEMPLATES_INVALID: HR=%, HR_MANAGE=%', v_hr_count, v_hr_manage_count;
  end if;

  if exists (
    select item.permission_code
    from public.role_permission_template_items item
    join public.role_permission_templates template on template.id = item.template_id
    where template.code = 'HR'
    except
    select item.permission_code
    from public.role_permission_template_items item
    join public.role_permission_templates template on template.id = item.template_id
    where template.code = 'HR_MANAGE'
  ) then
    raise exception 'HR_MANAGE_DOES_NOT_CONTAIN_HR';
  end if;
end;
$$;

rollback;

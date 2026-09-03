-- HRM template-only direct-grant guard and HR-specific Permission Health.

begin;

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
    'hrm.payroll.manage',
    'hrm.payroll.export',
    'hrm.master_data.manage'
  ]::text[]);
$$;

do $$
begin
  if exists (
    select 1
    from public.user_permission_grants grant_row
    where grant_row.is_active
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and app_private.is_hrm_template_only_permission(grant_row.permission_code)
  ) then
    raise exception 'HRM_TEMPLATE_ONLY_ACTIVE_DIRECT_GRANT_PREEXISTS'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function app_private.guard_hrm_template_only_direct_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active
    and app_private.is_hrm_template_only_permission(new.permission_code)
  then
    raise exception 'HRM_TEMPLATE_ONLY_PERMISSION: % must be assigned through HR or HR_MANAGE', new.permission_code
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_hrm_template_only_direct_grant
  on public.user_permission_grants;
create trigger trg_guard_hrm_template_only_direct_grant
before insert or update of permission_code, is_active
on public.user_permission_grants
for each row execute function app_private.guard_hrm_template_only_direct_grant();

do $$
begin
  if to_regprocedure('app_private.get_permission_health_summary_legacy_base()') is null then
    alter function public.get_permission_health_summary() set schema app_private;
    alter function app_private.get_permission_health_summary() rename to get_permission_health_summary_legacy_base;
  end if;
end;
$$;

create or replace function app_private.get_permission_health_summary_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb := app_private.get_permission_health_summary_legacy_base();
  v_anon_sensitive_select jsonb := '[]'::jsonb;
  v_hrm_sensitive_broad_read jsonb := '[]'::jsonb;
  v_hrm_raw_table_exposure jsonb := '[]'::jsonb;
  v_hrm_legacy_admin_policies jsonb := '[]'::jsonb;
  v_hr_sensitive_grant_outside_template jsonb := '[]'::jsonb;
  v_hr_admin_implicit_bypass jsonb := '[]'::jsonb;
  v_hr_template_definition_drift jsonb := '[]'::jsonb;
  v_hrm_manager_readiness jsonb := '[]'::jsonb;
  v_status text := coalesce(v_base ->> 'status', 'ok');
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', grant_row.table_schema,
    'table', grant_row.table_name,
    'privilege', grant_row.privilege_type,
    'severity', 'critical'
  ) order by grant_row.table_name), '[]'::jsonb)
  into v_anon_sensitive_select
  from information_schema.role_table_grants grant_row
  where grant_row.table_schema = 'public'
    and grant_row.grantee = 'anon'
    and grant_row.privilege_type = 'SELECT'
    and grant_row.table_name ~ '^(employees|hrm_(employee_(private_profiles|addresses|emergency_contacts|identity_documents|tax_profiles|bank_accounts|insurance_profiles|dependents|qualifications|certifications|compensation_assignments|manual_allowances)|employment_events|labor_contracts|salary_history|documents|payrolls|payroll_components))$';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', policy_row.schemaname,
    'table', policy_row.tablename,
    'policy', policy_row.policyname,
    'command', policy_row.cmd,
    'severity', 'critical'
  ) order by policy_row.tablename, policy_row.policyname), '[]'::jsonb)
  into v_hrm_sensitive_broad_read
  from pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename ~ '^(employees|hrm_(employee_(private_profiles|addresses|emergency_contacts|identity_documents|tax_profiles|bank_accounts|insurance_profiles|dependents|qualifications|certifications|compensation_assignments|manual_allowances)|employment_events|labor_contracts|salary_history|documents|payrolls|payroll_components))$'
    and policy_row.cmd in ('SELECT', 'ALL')
    and lower(trim(coalesce(policy_row.qual, ''))) in ('true', '(true)');

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', grant_row.table_schema,
    'table', grant_row.table_name,
    'privilege', grant_row.privilege_type,
    'grantee', grant_row.grantee,
    'severity', 'high'
  ) order by grant_row.table_name, grant_row.grantee), '[]'::jsonb)
  into v_hrm_raw_table_exposure
  from information_schema.role_table_grants grant_row
  where grant_row.table_schema = 'public'
    and grant_row.grantee in ('anon', 'authenticated')
    and grant_row.privilege_type = 'SELECT'
    and grant_row.table_name ~ '^hrm_(employee_(private_profiles|addresses|emergency_contacts|identity_documents|tax_profiles|bank_accounts|insurance_profiles|dependents|qualifications|certifications|compensation_assignments|manual_allowances)|employment_events|labor_contracts|salary_history|documents|payrolls|payroll_components)$';

  select coalesce(jsonb_agg(finding order by finding ->> 'schema', finding ->> 'function'), '[]'::jsonb)
  into v_hrm_legacy_admin_policies
  from (
    select jsonb_build_object(
      'schema', namespace.nspname,
      'function', procedure.proname,
      'identityArguments', pg_get_function_identity_arguments(procedure.oid),
      'severity', 'high'
    ) as finding
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and procedure.prokind in ('f', 'p')
      and procedure.proname not like 'get_permission_health_summary%'
      and pg_get_functiondef(procedure.oid) ~* '(hrm_|employees|payroll)'
      and pg_get_functiondef(procedure.oid) ~* '(is_module_admin|system\.hrm\.manage)'
  ) findings;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', grant_row.user_id,
    'permissionCode', grant_row.permission_code,
    'scopeType', grant_row.scope_type,
    'scopeId', grant_row.scope_id,
    'severity', 'critical'
  ) order by grant_row.user_id, grant_row.permission_code), '[]'::jsonb)
  into v_hr_sensitive_grant_outside_template
  from public.user_permission_grants grant_row
  where grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now())
    and app_private.is_hrm_template_only_permission(grant_row.permission_code);

  select coalesce(jsonb_agg(finding order by finding ->> 'schema', finding ->> 'function'), '[]'::jsonb)
  into v_hr_admin_implicit_bypass
  from (
    select jsonb_build_object(
      'schema', namespace.nspname,
      'function', procedure.proname,
      'identityArguments', pg_get_function_identity_arguments(procedure.oid),
      'severity', 'critical'
    ) as finding
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and procedure.prokind in ('f', 'p')
      and procedure.proname not like 'get_permission_health_summary%'
      and pg_get_functiondef(procedure.oid) ~* '(hrm_|employees|payroll)'
      and pg_get_functiondef(procedure.oid) ~* '(is_admin\s*\(|role\s*=\s*''ADMIN'')'
  ) findings;

  with expected(template_code, permission_code) as (
    values
      ('HR', 'hrm.organization.view'), ('HR', 'hrm.staffing.view'),
      ('HR', 'hrm.employee.view_directory'), ('HR', 'hrm.employee.view_profile'),
      ('HR', 'hrm.employee.edit_profile'), ('HR', 'hrm.employee.view_sensitive'),
      ('HR', 'hrm.employee.edit_sensitive'), ('HR', 'hrm.employee.import'),
      ('HR', 'hrm.contract.view'), ('HR', 'hrm.contract.manage'),
      ('HR', 'hrm.document.view'), ('HR', 'hrm.document.manage'),
      ('HR', 'hrm.attendance.view'), ('HR', 'hrm.attendance.edit'),
      ('HR', 'hrm.attendance.approve'), ('HR', 'hrm.leave.view'),
      ('HR', 'hrm.leave.approve'), ('HR', 'hrm.compensation.view'),
      ('HR', 'hrm.payroll.view'), ('HR', 'hrm.master_data.view'),
      ('HR_MANAGE', 'hrm.organization.view'), ('HR_MANAGE', 'hrm.staffing.view'),
      ('HR_MANAGE', 'hrm.employee.view_directory'), ('HR_MANAGE', 'hrm.employee.view_profile'),
      ('HR_MANAGE', 'hrm.employee.edit_profile'), ('HR_MANAGE', 'hrm.employee.view_sensitive'),
      ('HR_MANAGE', 'hrm.employee.edit_sensitive'), ('HR_MANAGE', 'hrm.employee.import'),
      ('HR_MANAGE', 'hrm.contract.view'), ('HR_MANAGE', 'hrm.contract.manage'),
      ('HR_MANAGE', 'hrm.document.view'), ('HR_MANAGE', 'hrm.document.manage'),
      ('HR_MANAGE', 'hrm.attendance.view'), ('HR_MANAGE', 'hrm.attendance.edit'),
      ('HR_MANAGE', 'hrm.attendance.approve'), ('HR_MANAGE', 'hrm.leave.view'),
      ('HR_MANAGE', 'hrm.leave.approve'), ('HR_MANAGE', 'hrm.compensation.view'),
      ('HR_MANAGE', 'hrm.payroll.view'), ('HR_MANAGE', 'hrm.master_data.view'),
      ('HR_MANAGE', 'hrm.organization.manage'), ('HR_MANAGE', 'hrm.staffing.manage'),
      ('HR_MANAGE', 'hrm.staffing.assign'), ('HR_MANAGE', 'hrm.staffing.set_manager'),
      ('HR_MANAGE', 'hrm.compensation.manage'), ('HR_MANAGE', 'hrm.payroll.manage'),
      ('HR_MANAGE', 'hrm.master_data.manage'), ('HR_MANAGE', 'hrm.employee.export'),
      ('HR_MANAGE', 'hrm.payroll.export')
  ), actual as (
    select template.code as template_code, item.permission_code
    from public.role_permission_templates template
    join public.role_permission_template_items item on item.template_id = template.id
    where template.code in ('HR', 'HR_MANAGE') and template.is_system and template.is_active
  ), drift as (
    select template_code, permission_code, 'missing'::text as issue from expected
    except select template_code, permission_code, 'missing'::text from actual
    union all
    select template_code, permission_code, 'extra'::text as issue from actual
    except select template_code, permission_code, 'extra'::text from expected
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'roleCode', drift.template_code,
    'permissionCode', drift.permission_code,
    'issueCode', drift.issue,
    'severity', 'high'
  ) order by drift.template_code, drift.issue, drift.permission_code), '[]'::jsonb)
  into v_hr_template_definition_drift
  from drift;

  with readiness as (
    select
      (select count(*)::integer from public.employees employee where employee.status = 'Đang làm việc') as active_employees,
      (select count(distinct assignment_row.employee_id)::integer
       from public.hrm_employee_slot_assignments assignment_row
       join public.employees employee on employee.id = assignment_row.employee_id
       where employee.status = 'Đang làm việc'
         and assignment_row.status = 'ACTIVE'
         and assignment_row.assignment_type = 'PRIMARY') as assigned_employees,
      (select count(*)::integer
       from (
         select assignment_row.employee_id
         from public.hrm_employee_slot_assignments assignment_row
         where assignment_row.status = 'ACTIVE' and assignment_row.assignment_type = 'PRIMARY'
         group by assignment_row.employee_id having count(*) > 1
       ) overlap_row) as overlapping_primary,
      (select count(*)::integer
       from public.org_units unit_row
       where unit_row.is_active
         and unit_row.manager_slot_id is null
         and exists (
           select 1 from public.hrm_org_position_slots slot_row
           where slot_row.org_unit_id = unit_row.id and slot_row.status = 'ACTIVE'
         )) as units_without_manager
  )
  select case
    when active_employees = assigned_employees
      and overlapping_primary = 0
      and units_without_manager = 0
    then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object(
      'activeEmployees', active_employees,
      'assignedEmployees', assigned_employees,
      'missingAssignments', greatest(active_employees - assigned_employees, 0),
      'overlappingPrimaryAssignments', overlapping_primary,
      'unitsWithoutManager', units_without_manager,
      'severity', 'high'
    ))
  end
  into v_hrm_manager_readiness
  from readiness;

  if jsonb_array_length(v_anon_sensitive_select) > 0
    or jsonb_array_length(v_hrm_sensitive_broad_read) > 0
    or jsonb_array_length(v_hr_sensitive_grant_outside_template) > 0
    or jsonb_array_length(v_hr_admin_implicit_bypass) > 0
  then
    v_status := 'critical';
  elsif v_status = 'ok' and (
    jsonb_array_length(v_hrm_raw_table_exposure) > 0
    or jsonb_array_length(v_hrm_legacy_admin_policies) > 0
    or jsonb_array_length(v_hr_template_definition_drift) > 0
    or jsonb_array_length(v_hrm_manager_readiness) > 0
  ) then
    v_status := 'warning';
  end if;

  return v_base || jsonb_build_object(
    'generatedAt', now(),
    'status', v_status,
    'checks', coalesce(v_base -> 'checks', '{}'::jsonb) || jsonb_build_object(
      'anonSensitiveSelect', v_anon_sensitive_select,
      'hrmSensitiveBroadRead', v_hrm_sensitive_broad_read,
      'hrmRawTableExposure', v_hrm_raw_table_exposure,
      'hrmLegacyAdminPolicies', v_hrm_legacy_admin_policies,
      'hrSensitiveGrantOutsideApprovedTemplate', v_hr_sensitive_grant_outside_template,
      'hrAdminImplicitBypass', v_hr_admin_implicit_bypass,
      'hrTemplateDefinitionDrift', v_hr_template_definition_drift,
      'hrmManagerReadiness', v_hrm_manager_readiness
    )
  );
end;
$$;

create or replace function public.get_permission_health_summary()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select app_private.get_permission_health_summary_impl();
$$;

revoke all on function app_private.is_hrm_template_only_permission(text) from public, anon, authenticated;
revoke all on function app_private.guard_hrm_template_only_direct_grant() from public, anon, authenticated;
revoke all on function app_private.get_permission_health_summary_legacy_base() from public, anon, authenticated;
revoke all on function app_private.get_permission_health_summary_impl() from public, anon;
grant execute on function app_private.get_permission_health_summary_impl() to authenticated;

revoke all on function public.get_permission_health_summary() from public, anon;
grant execute on function public.get_permission_health_summary() to authenticated;

commit;

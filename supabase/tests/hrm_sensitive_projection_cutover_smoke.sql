begin;
set local statement_timeout = '30s';

do $$
declare
  v_admin public.users%rowtype;
  v_employee public.employees%rowtype;
  v_employee_user public.users%rowtype;
  v_summary jsonb;
  v_rows jsonb;
  v_blocked boolean;
begin
  if has_table_privilege('authenticated', 'public.employees', 'select')
    or has_table_privilege('authenticated', 'public.hrm_documents', 'select')
    or has_table_privilege('authenticated', 'public.hrm_labor_contracts', 'select')
    or has_table_privilege('authenticated', 'public.hrm_payrolls', 'select')
    or has_table_privilege('authenticated', 'public.hrm_salary_history', 'select')
  then raise exception 'HRM_SENSITIVE_RAW_SELECT_STILL_GRANTED';
  end if;
  if exists (select 1 from storage.buckets where id = 'hr-documents' and public) then
    raise exception 'HRM_DOCUMENT_BUCKET_STILL_PUBLIC';
  end if;

  select account.* into v_admin
  from public.users account
  join public.principal_role_assignments assignment_row
    on assignment_row.principal_type = 'user' and assignment_row.principal_id = account.id
   and assignment_row.status = 'ACTIVE' and assignment_row.starts_at <= now()
   and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  join public.role_permission_templates template
    on template.id = assignment_row.role_template_id and template.code = 'SYSTEM_ADMIN'
  where account.role = 'ADMIN' and account.is_active and account.account_status = 'ACTIVE'
  order by account.created_at limit 1;

  select employee.* into v_employee
  from public.employees employee
  join public.users account on account.id = employee.user_id
  where employee.status = 'Đang làm việc' and account.id <> v_admin.id
    and account.is_active and account.account_status = 'ACTIVE'
    and account.role <> 'ADMIN'
    and not exists (
      select 1
      from public.principal_role_assignments hr_assignment
      join public.role_permission_templates hr_template on hr_template.id=hr_assignment.role_template_id
      where hr_assignment.principal_type='user' and hr_assignment.principal_id=account.id
        and hr_assignment.status='ACTIVE' and hr_template.code in ('HR','HR_MANAGE')
    )
  order by employee.employee_code limit 1;
  select account.* into v_employee_user from public.users account where account.id = v_employee.user_id;
  if v_admin.id is null or v_employee.id is null then
    raise exception 'HRM_SENSITIVE_PROJECTION_FIXTURES_NOT_FOUND';
  end if;

  perform set_config('request.jwt.claim.sub', v_employee_user.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_employee_user.auth_id,'email',v_employee_user.email
  )::text, true);
  v_rows := public.list_hrm_employee_directory();
  if jsonb_array_length(v_rows) = 0 then raise exception 'HRM_DIRECTORY_PROJECTION_EMPTY'; end if;
  v_blocked := false;
  begin perform public.list_hrm_payrolls();
  exception when others then v_blocked := position('HRM_PAYROLL_VIEW_REQUIRED' in sqlerrm) > 0; end;
  if not v_blocked then raise exception 'HRM_EMPLOYEE_PAYROLL_PROJECTION_NOT_BLOCKED'; end if;
  v_blocked := false;
  begin perform public.list_hrm_documents(null, null, null, null, 10);
  exception when others then v_blocked := position('HRM_DOCUMENT_VIEW_REQUIRED' in sqlerrm) > 0; end;
  if not v_blocked then raise exception 'HRM_EMPLOYEE_DOCUMENT_PROJECTION_NOT_BLOCKED'; end if;

  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_admin.auth_id,'email',v_admin.email
  )::text, true);
  v_summary := public.get_user_hr_authorization(v_employee_user.id);
  perform public.set_user_hr_business_role(
    v_employee_user.id, 'HR', null, 'Smoke: cấp HR để thử projection nhạy cảm',
    '[]'::jsonb, v_summary ->> 'fingerprint'
  );

  perform set_config('request.jwt.claim.sub', v_employee_user.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_employee_user.auth_id,'email',v_employee_user.email
  )::text, true);
  perform public.list_hrm_labor_contracts();
  perform public.list_hrm_salary_history();
  perform public.list_hrm_payrolls();
  perform public.list_hrm_documents(null, null, null, null, 10);
  v_blocked := false;
  begin
    perform public.upsert_hrm_payroll(
      jsonb_build_object('employeeId',v_employee.id,'month',8,'year',2026),
      'Smoke: HR không được sửa bảng lương'
    );
  exception when others then v_blocked := position('HRM_PAYROLL_MANAGE_REQUIRED' in sqlerrm) > 0; end;
  if not v_blocked then raise exception 'HRM_PAYROLL_HR_MUTATION_NOT_BLOCKED'; end if;

  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_admin.auth_id,'email',v_admin.email
  )::text, true);
  v_summary := public.get_user_hr_authorization(v_admin.id);
  perform public.set_user_hr_business_role(
    v_admin.id, 'HR_MANAGE', null, 'Smoke: Admin tự cấp HR Manage cho projection',
    '[{"ruleCode":"HRM_ADMIN_SELF_GRANT","accepted":true}]'::jsonb,
    v_summary ->> 'fingerprint'
  );
  perform public.list_hrm_compensation_assignments();
  perform public.list_hrm_manual_allowances();
  perform public.list_hrm_payroll_components();
end;
$$;

rollback;

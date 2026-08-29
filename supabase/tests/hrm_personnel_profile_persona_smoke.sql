begin;
set local statement_timeout = '30s';

do $$
declare
  v_admin public.users%rowtype;
  v_employee public.employees%rowtype;
  v_employee_user public.users%rowtype;
  v_summary jsonb;
  v_overview jsonb;
  v_payload jsonb;
  v_blocked boolean;
begin
  select user_row.* into v_admin
  from public.users user_row
  join public.principal_role_assignments assignment_row
    on assignment_row.principal_type = 'user'
   and assignment_row.principal_id = user_row.id
   and assignment_row.status = 'ACTIVE'
   and assignment_row.starts_at <= now()
   and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  join public.role_permission_templates template
    on template.id = assignment_row.role_template_id and template.code = 'SYSTEM_ADMIN'
  where user_row.role = 'ADMIN' and user_row.is_active and user_row.account_status = 'ACTIVE'
  order by user_row.created_at limit 1;

  select employee.* into v_employee
  from public.employees employee
  join public.users account on account.id = employee.user_id
  where employee.status = 'Đang làm việc'
    and account.id <> v_admin.id
    and account.is_active and account.account_status = 'ACTIVE'
    and account.role <> 'ADMIN'
    and not exists (
      select 1
      from public.principal_role_assignments hr_assignment
      join public.role_permission_templates hr_template on hr_template.id = hr_assignment.role_template_id
      where hr_assignment.principal_type='user' and hr_assignment.principal_id=account.id
        and hr_assignment.status='ACTIVE' and hr_template.code in ('HR','HR_MANAGE')
    )
  order by employee.employee_code limit 1;
  select account.* into v_employee_user
  from public.users account where account.id = v_employee.user_id;
  if v_admin.id is null or v_employee.id is null then
    raise exception 'HRM_PROFILE_PERSONA_FIXTURES_NOT_FOUND';
  end if;
  perform set_config('hrm.smoke_employee_id', v_employee.id::text, true);

  perform set_config('request.jwt.claim.sub', v_employee_user.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_employee_user.auth_id,'email',v_employee_user.email
  )::text, true);
  v_overview := public.get_hrm_employee_overview(v_employee.id);
  if v_overview ->> 'accessLevel' <> 'SELF'
    or not (v_overview -> 'visibleSections' ? 'personal_contact')
    or (v_overview -> 'visibleSections' ? 'legal_insurance')
  then raise exception 'HRM_PROFILE_SELF_VISIBILITY_INVALID: %', v_overview;
  end if;
  perform public.get_hrm_employee_personal_contact(v_employee.id);
  v_blocked := false;
  begin perform public.get_hrm_employee_legal_insurance(v_employee.id);
  exception when others then v_blocked := position('HRM_PROFILE_SECTION_ACCESS_DENIED' in sqlerrm) > 0; end;
  if not v_blocked then raise exception 'HRM_PROFILE_SELF_C3_NOT_BLOCKED'; end if;

  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_admin.auth_id,'email',v_admin.email
  )::text, true);
  v_summary := public.get_user_hr_authorization(v_admin.id);
  if v_summary ->> 'hrRole' is not null then
    v_summary := public.set_user_hr_business_role(
      v_admin.id, 'NONE', null,
      'Smoke: tạm thu hồi HR role để kiểm tra Admin kỹ thuật',
      '[]'::jsonb, v_summary ->> 'fingerprint'
    );
  end if;
  v_blocked := false;
  begin perform public.get_hrm_employee_compensation_tax_bank(v_employee.id);
  exception when others then v_blocked := position('HRM_PROFILE_SECTION_ACCESS_DENIED' in sqlerrm) > 0; end;
  if not v_blocked then raise exception 'HRM_PROFILE_TECHNICAL_ADMIN_C4_NOT_BLOCKED'; end if;
  v_blocked := false;
  begin
    perform public.update_hrm_employee_core_profile(
      v_employee.id, v_employee.full_name, v_employee.gender, v_employee.phone,
      v_employee.email, v_employee.date_of_birth, v_employee.start_date,
      v_employee.official_date, v_employee.status, v_employee.user_id,
      v_employee.area_id, v_employee.office_id, v_employee.employee_type_id,
      v_employee.work_schedule_id, v_employee.marital_status, v_employee.avatar_url,
      'Smoke: Admin kỹ thuật không được sửa C2'
    );
  exception when others then v_blocked := position('HRM_PROFILE_EDIT_REQUIRED' in sqlerrm) > 0; end;
  if not v_blocked then raise exception 'HRM_PROFILE_TECHNICAL_ADMIN_C2_MUTATION_NOT_BLOCKED'; end if;

  v_summary := public.get_user_hr_authorization(v_employee_user.id);
  perform public.set_user_hr_business_role(
    v_employee_user.id, 'HR', null, 'Smoke: cấp vai trò HR cho persona test',
    '[]'::jsonb, v_summary ->> 'fingerprint'
  );
  perform set_config('request.jwt.claim.sub', v_employee_user.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_employee_user.auth_id,'email',v_employee_user.email
  )::text, true);
  perform public.get_hrm_employee_legal_insurance(v_employee.id);
  perform public.get_hrm_employee_compensation_tax_bank(v_employee.id);
  perform public.update_hrm_employee_core_profile(
    v_employee.id, v_employee.full_name, v_employee.gender, v_employee.phone,
    v_employee.email, v_employee.date_of_birth, v_employee.start_date,
    v_employee.official_date, v_employee.status, v_employee.user_id,
    v_employee.area_id, v_employee.office_id, v_employee.employee_type_id,
    v_employee.work_schedule_id, v_employee.marital_status, v_employee.avatar_url,
    'Smoke: HR cập nhật hồ sơ C2'
  );
  v_blocked := false;
  begin
    perform public.upsert_hrm_employee_bank_account(
      v_employee.id, 'PAYROLL', 'VCB', 'CN Test', '0000000001',
      v_employee.full_name, true, 'Smoke: HR không được sửa ngân hàng'
    );
  exception when others then v_blocked := position('HRM_COMPENSATION_MANAGE_REQUIRED' in sqlerrm) > 0; end;
  if not v_blocked then raise exception 'HRM_PROFILE_HR_C4_MUTATION_NOT_BLOCKED'; end if;

  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_admin.auth_id,'email',v_admin.email
  )::text, true);
  v_summary := public.get_user_hr_authorization(v_admin.id);
  perform public.set_user_hr_business_role(
    v_admin.id, 'HR_MANAGE', null, 'Smoke: Admin tự cấp HR Manage cho profile test',
    '[{"ruleCode":"HRM_ADMIN_SELF_GRANT","accepted":true}]'::jsonb,
    v_summary ->> 'fingerprint'
  );
  v_payload := public.upsert_hrm_employee_bank_account(
    v_employee.id, 'PAYROLL', 'VCB', 'CN Test', '0000000001',
    v_employee.full_name, true, 'Smoke: HR Manage cập nhật tài khoản ngân hàng'
  );
  if jsonb_array_length(v_payload -> 'bankAccounts') <> 1 then
    raise exception 'HRM_PROFILE_HR_MANAGE_C4_MUTATION_FAILED: %', v_payload;
  end if;
end;
$$;

-- Exercise every public projection through PostgREST's database role without
-- emitting the returned personnel payload into smoke logs.
set local role authenticated;
do $$
declare
  v_employee_id uuid := current_setting('hrm.smoke_employee_id')::uuid;
begin
  perform public.get_hrm_employee_overview(v_employee_id);
  perform public.get_hrm_employee_personal_contact(v_employee_id);
  perform public.get_hrm_employee_work_organization(v_employee_id);
  perform public.get_hrm_employee_attendance_leave(v_employee_id);
  perform public.get_hrm_employee_contract_employment(v_employee_id);
  perform public.get_hrm_employee_legal_insurance(v_employee_id);
  perform public.get_hrm_employee_compensation_tax_bank(v_employee_id);
  perform public.get_hrm_employee_qualifications_documents(v_employee_id);
end;
$$;
reset role;

rollback;

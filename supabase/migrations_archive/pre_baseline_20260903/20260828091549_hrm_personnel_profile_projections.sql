begin;

create or replace function app_private.has_governed_hrm_permission(
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
  select exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      p_user_id, p_permission_code, p_scope_type, p_scope_id, now()
    ) source_row
    left join public.users actor on actor.id = p_user_id
    where not (
      actor.role = 'ADMIN'
      and source_row.permission_code like 'hrm.%'
      and source_row.source_type = 'LEGACY'
    )
    and (
      not app_private.is_hrm_template_only_permission(source_row.permission_code)
      or (source_row.source_type = 'ROLE' and source_row.source_code in ('HR','HR_MANAGE'))
    )
  );
$$;

create or replace function app_private.hrm_employee_profile_access_level(p_employee_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_subject_user_id uuid;
begin
  if v_actor_id is null then return 'NONE'; end if;
  select employee.user_id into v_subject_user_id
  from public.employees employee where employee.id = p_employee_id;
  if not found then return 'NONE'; end if;

  if app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.view_sensitive') then
    return case
      when app_private.has_hrm_template_permission(v_actor_id, 'hrm.compensation.manage')
      then 'HR_MANAGE' else 'HR' end;
  end if;
  if v_subject_user_id = v_actor_id then return 'SELF'; end if;
  if v_subject_user_id is not null
    and app_private.resolve_strict_direct_manager(v_subject_user_id) = v_actor_id
  then return 'MANAGER'; end if;
  if app_private.has_governed_hrm_permission(v_actor_id, 'hrm.employee.view_directory') then
    return 'DIRECTORY';
  end if;
  return 'NONE';
end;
$$;

create or replace function app_private.assert_hrm_profile_section_access(
  p_employee_id uuid,
  p_allowed_levels text[]
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_level text := app_private.hrm_employee_profile_access_level(p_employee_id);
begin
  if not (v_level = any(p_allowed_levels)) then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_SECTION_ACCESS_DENIED';
  end if;
  return v_level;
end;
$$;

create or replace function app_private.get_hrm_employee_overview(p_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level text := app_private.assert_hrm_profile_section_access(
    p_employee_id, array['DIRECTORY','SELF','MANAGER','HR','HR_MANAGE']
  );
  v_result jsonb;
  v_visible text[];
begin
  v_visible := case
    when v_level in ('HR','HR_MANAGE') then array[
      'overview','personal_contact','work_organization','attendance_leave',
      'contracts_employment','legal_insurance','compensation_tax_bank',
      'qualifications_documents'
    ]
    when v_level in ('SELF','MANAGER') then array[
      'overview','personal_contact','work_organization','attendance_leave',
      'qualifications_documents'
    ]
    else array['overview','work_organization']
  end;

  select jsonb_build_object(
    'employeeId', employee.id,
    'employeeCode', employee.employee_code,
    'fullName', employee.full_name,
    'title', employee.title,
    'status', employee.status,
    'avatarUrl', employee.avatar_url,
    'accessLevel', v_level,
    'visibleSections', to_jsonb(v_visible),
    'maskedFields', case
      when v_level = 'DIRECTORY' then '["dateOfBirth","privateContact","legal","compensation"]'::jsonb
      when v_level = 'MANAGER' then '["privateAddress","emergencyContact","legal","compensation"]'::jsonb
      when v_level = 'SELF' then '["legal","compensation"]'::jsonb
      else '[]'::jsonb
    end,
    'canEditSections', case
      when v_level = 'HR_MANAGE' then '["personal_contact","contracts_employment","legal_insurance","compensation_tax_bank","qualifications_documents"]'::jsonb
      when v_level = 'HR' then '["personal_contact","contracts_employment","legal_insurance","qualifications_documents"]'::jsonb
      when v_level = 'SELF' then '["personal_contact"]'::jsonb
      else '[]'::jsonb
    end,
    'summary', jsonb_build_object(
      'startDate', employee.start_date,
      'officialDate', employee.official_date,
      'orgUnitName', org.name,
      'positionName', position.name,
      'qualificationCount', case when v_level <> 'DIRECTORY' then (
        select count(*) from public.hrm_employee_qualifications qualification
        where qualification.employee_id = employee.id and qualification.status = 'ACTIVE'
      ) else null end,
      'currentContractNumber', case when v_level in ('HR','HR_MANAGE') then (
        select contract.contract_number from public.hrm_labor_contracts contract
        where contract.employee_id = employee.id and contract.status = 'active'
          and contract.effective_from <= current_date
          and (contract.effective_to is null or contract.effective_to >= current_date)
        order by contract.effective_from desc limit 1
      ) else null end
    )
  ) into v_result
  from public.employees employee
  left join public.org_units org on org.id = employee.org_unit_id
  left join public.hrm_positions position on position.id = employee.position_id
  where employee.id = p_employee_id;
  return v_result;
end;
$$;

create or replace function app_private.get_hrm_employee_personal_contact(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := app_private.assert_hrm_profile_section_access(
    p_employee_id, array['SELF','MANAGER','HR','HR_MANAGE']
  );
  v_result jsonb;
begin
  select jsonb_build_object(
    'employeeId', employee.id,
    'gender', employee.gender,
    'dateOfBirth', case when v_level = 'MANAGER' then null else employee.date_of_birth end,
    'maritalStatus', case when v_level = 'MANAGER' then null else employee.marital_status end,
    'workPhone', employee.phone,
    'workEmail', employee.email,
    'personal', case when v_level = 'MANAGER' then null else jsonb_build_object(
      'personalPhone', private_profile.personal_phone,
      'personalEmail', private_profile.personal_email,
      'nationalityCode', private_profile.nationality_code,
      'placeOfBirth', private_profile.place_of_birth,
      'hometown', private_profile.hometown
    ) end,
    'addresses', case when v_level = 'MANAGER' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'recordCode', address.record_code, 'addressType', address.address_type,
        'addressLine', address.address_line, 'wardCode', address.ward_code,
        'districtCode', address.district_code, 'provinceCode', address.province_code,
        'countryCode', address.country_code
      ) order by address.address_type, address.record_code)
      from public.hrm_employee_addresses address
      where address.employee_id = employee.id and address.status = 'ACTIVE'
        and address.effective_from <= current_date
        and (address.effective_to is null or address.effective_to >= current_date)
    ), '[]'::jsonb) end,
    'emergencyContacts', case when v_level = 'MANAGER' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'recordCode', contact.record_code, 'fullName', contact.full_name,
        'relationshipCode', contact.relationship_code, 'phone', contact.phone,
        'email', contact.email, 'address', contact.address, 'isPrimary', contact.is_primary
      ) order by contact.is_primary desc, contact.record_code)
      from public.hrm_employee_emergency_contacts contact
      where contact.employee_id = employee.id and contact.status = 'ACTIVE'
    ), '[]'::jsonb) end,
    'maskedFields', case when v_level = 'MANAGER'
      then '["dateOfBirth","maritalStatus","personal","addresses","emergencyContacts"]'::jsonb
      else '[]'::jsonb end
  ) into v_result
  from public.employees employee
  left join public.hrm_employee_private_profiles private_profile
    on private_profile.employee_id = employee.id and private_profile.status = 'ACTIVE'
  where employee.id = p_employee_id;
  return v_result;
end;
$$;

create or replace function app_private.get_hrm_employee_work_organization(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := app_private.assert_hrm_profile_section_access(
    p_employee_id, array['DIRECTORY','SELF','MANAGER','HR','HR_MANAGE']
  );
  v_result jsonb;
begin
  select jsonb_build_object(
    'employeeId', employee.id, 'employeeCode', employee.employee_code,
    'title', employee.title, 'status', employee.status,
    'startDate', employee.start_date, 'officialDate', employee.official_date,
    'orgUnit', jsonb_build_object('id', org.id, 'code', org.code, 'name', org.name),
    'position', jsonb_build_object('id', position.id, 'code', position.code, 'name', position.name, 'levelCode', position.level_code),
    'primaryAssignment', case when assignment.id is null then null else jsonb_build_object(
      'assignmentId', assignment.id, 'slotId', slot.id,
      'effectiveFrom', assignment.effective_from, 'assignmentType', assignment.assignment_type
    ) end,
    'directManager', case when manager_employee.id is null then null else jsonb_build_object(
      'employeeId', manager_employee.id, 'employeeCode', manager_employee.employee_code,
      'fullName', manager_employee.full_name, 'title', manager_employee.title
    ) end
  ) into v_result
  from public.employees employee
  left join public.org_units org on org.id = employee.org_unit_id
  left join public.hrm_positions position on position.id = employee.position_id
  left join public.hrm_employee_slot_assignments assignment
    on assignment.employee_id = employee.id and assignment.assignment_type = 'PRIMARY'
   and assignment.status = 'ACTIVE' and assignment.effective_from <= current_date
   and (assignment.effective_to is null or assignment.effective_to >= current_date)
  left join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
  left join public.users manager_user
    on manager_user.id = app_private.resolve_slot_direct_manager(employee.user_id)
  left join public.employees manager_employee on manager_employee.user_id = manager_user.id
  where employee.id = p_employee_id;
  return v_result;
end;
$$;

create or replace function app_private.get_hrm_employee_attendance_leave(
  p_employee_id uuid,
  p_year integer default extract(year from current_date)::integer,
  p_month integer default extract(month from current_date)::integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := app_private.assert_hrm_profile_section_access(
    p_employee_id, array['SELF','MANAGER','HR','HR_MANAGE']
  );
  v_result jsonb;
begin
  if p_month not between 1 and 12 or p_year not between 2000 and 2200 then
    raise exception using errcode = '22023', message = 'HRM_ATTENDANCE_PERIOD_INVALID';
  end if;
  select jsonb_build_object(
    'employeeId', p_employee_id, 'year', p_year, 'month', p_month,
    'attendance', coalesce((select jsonb_agg(jsonb_build_object(
      'id', attendance.id, 'date', attendance.date, 'status', attendance.status,
      'checkIn', attendance."checkIn", 'checkOut', attendance."checkOut",
      'overtimeHours', attendance."overtimeHours", 'approvalStatus', attendance."approvalStatus"
    ) order by attendance.date)
      from public.hrm_attendance attendance
      where attendance."employeeId" = p_employee_id
        and substring(attendance.date from 1 for 7) = format('%s-%s', p_year, lpad(p_month::text, 2, '0'))
    ), '[]'::jsonb),
    'leaveBalance', (select jsonb_build_object(
      'year', balance.year, 'accruedDays', balance."accruedDays",
      'usedPaidDays', balance."usedPaidDays", 'usedUnpaidDays', balance."usedUnpaidDays",
      'remainingDays', balance."accruedDays" - balance."usedPaidDays"
    ) from public.hrm_leave_balances balance
      where balance."employeeId" = p_employee_id and balance.year = p_year limit 1),
    'leaveRequests', coalesce((select jsonb_agg(jsonb_build_object(
      'id', request.id, 'code', request.code, 'type', request.type,
      'startDate', request."startDate", 'endDate', request."endDate",
      'totalDays', request."totalDays", 'status', request.status
    ) order by request."startDate" desc)
      from public.hrm_leave_requests request
      where request."employeeId" = p_employee_id
        and substring(request."startDate" from 1 for 4) = p_year::text
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function app_private.get_hrm_employee_contract_employment(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := app_private.assert_hrm_profile_section_access(p_employee_id, array['HR','HR_MANAGE']);
  v_result jsonb;
begin
  select jsonb_build_object(
    'employeeId', p_employee_id,
    'contracts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', contract.id, 'contractNumber', contract.contract_number,
      'type', contract.type, 'status', contract.status,
      'effectiveFrom', contract.effective_from, 'effectiveTo', contract.effective_to,
      'signedBy', contract.signed_by, 'note', contract.note
    ) order by contract.effective_from desc)
      from public.hrm_labor_contracts contract where contract.employee_id = p_employee_id
    ), '[]'::jsonb),
    'employmentEvents', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', event.record_code, 'eventTypeCode', event.event_type_code,
      'eventDate', event.event_date, 'titleSnapshot', event.title_snapshot,
      'reason', event.reason, 'sourceReference', event.source_reference,
      'orgUnitName', org.name, 'positionName', position.name
    ) order by event.event_date desc, event.record_code)
      from public.hrm_employee_employment_events event
      left join public.org_units org on org.id = event.org_unit_id
      left join public.hrm_positions position on position.id = event.position_id
      where event.employee_id = p_employee_id and event.status = 'ACTIVE'
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function app_private.get_hrm_employee_legal_insurance(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := app_private.assert_hrm_profile_section_access(p_employee_id, array['HR','HR_MANAGE']);
  v_result jsonb;
begin
  select jsonb_build_object(
    'employeeId', p_employee_id,
    'identityDocuments', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', identity_doc.record_code, 'documentTypeCode', identity_doc.document_type_code,
      'documentNumber', identity_doc.document_number, 'issuedDate', identity_doc.issued_date,
      'issuedPlace', identity_doc.issued_place, 'expiryDate', identity_doc.expiry_date,
      'isPrimary', identity_doc.is_primary, 'status', identity_doc.status
    ) order by identity_doc.is_primary desc, identity_doc.record_code)
      from public.hrm_employee_identity_documents identity_doc
      where identity_doc.employee_id = p_employee_id and identity_doc.status <> 'INACTIVE'
    ), '[]'::jsonb),
    'insuranceProfile', (select jsonb_build_object(
      'socialInsuranceNumber', insurance.social_insurance_number,
      'healthInsuranceNumber', insurance.health_insurance_number,
      'registeredClinicCode', insurance.registered_clinic_code,
      'participationStatusCode', insurance.participation_status_code,
      'effectiveFrom', insurance.effective_from, 'effectiveTo', insurance.effective_to,
      'status', insurance.status
    ) from public.hrm_employee_insurance_profiles insurance
      where insurance.employee_id = p_employee_id),
    'dependents', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', dependent.record_code, 'fullName', dependent.full_name,
      'relationshipCode', dependent.relationship_code, 'dateOfBirth', dependent.date_of_birth,
      'taxCode', dependent.tax_code, 'deductionFrom', dependent.deduction_from,
      'deductionTo', dependent.deduction_to, 'status', dependent.status
    ) order by dependent.full_name)
      from public.hrm_employee_dependents dependent
      where dependent.employee_id = p_employee_id and dependent.status = 'ACTIVE'
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function app_private.get_hrm_employee_compensation_tax_bank(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := app_private.assert_hrm_profile_section_access(p_employee_id, array['HR','HR_MANAGE']);
  v_result jsonb;
begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.compensation.view') then
    raise exception using errcode = '42501', message = 'HRM_COMPENSATION_VIEW_REQUIRED';
  end if;
  select jsonb_build_object(
    'employeeId', p_employee_id,
    'taxProfile', (select jsonb_build_object(
      'taxCode', tax.tax_code, 'taxResidencyCode', tax.tax_residency_code,
      'registrationDate', tax.registration_date, 'status', tax.status
    ) from public.hrm_employee_tax_profiles tax where tax.employee_id = p_employee_id),
    'bankAccounts', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', bank.record_code, 'bankCode', bank.bank_code,
      'branchName', bank.branch_name, 'accountNumber', bank.account_number,
      'accountHolder', bank.account_holder, 'isPayrollAccount', bank.is_payroll_account,
      'status', bank.status
    ) order by bank.is_payroll_account desc, bank.record_code)
      from public.hrm_employee_bank_accounts bank
      where bank.employee_id = p_employee_id and bank.status = 'ACTIVE'
    ), '[]'::jsonb),
    'salaryHistory', coalesce((select jsonb_agg(jsonb_build_object(
      'id', salary.id, 'effectiveFrom', salary.effective_from,
      'effectiveTo', salary.effective_to, 'previousSalary', salary.previous_salary,
      'newSalary', salary.new_salary, 'previousAllowance', salary.previous_allowance,
      'newAllowance', salary.new_allowance, 'reason', salary.reason, 'status', salary.status
    ) order by salary.effective_from desc)
      from public.hrm_salary_history salary
      where salary.employee_id = p_employee_id and salary.status <> 'VOID'
    ), '[]'::jsonb),
    'recentPayrolls', coalesce((select jsonb_agg(payroll_row.payload order by payroll_row.year desc, payroll_row.month desc)
      from (select payroll.year, payroll.month, jsonb_build_object(
        'id', payroll.id, 'month', payroll.month, 'year', payroll.year,
        'grossSalary', payroll."grossSalary", 'netSalary', payroll."netSalary",
        'status', payroll.status, 'paidDate', payroll."paidDate"
      ) payload from public.hrm_payrolls payroll
      where payroll."employeeId" = p_employee_id
      order by payroll.year desc, payroll.month desc limit 12) payroll_row
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function app_private.get_hrm_employee_qualifications_documents(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := app_private.assert_hrm_profile_section_access(
    p_employee_id, array['SELF','MANAGER','HR','HR_MANAGE']
  );
  v_result jsonb;
begin
  select jsonb_build_object(
    'employeeId', p_employee_id,
    'qualifications', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', qualification.record_code,
      'educationLevelCode', qualification.education_level_code,
      'institutionName', qualification.institution_name, 'majorName', qualification.major_name,
      'degreeName', qualification.degree_name, 'graduationYear', qualification.graduation_year,
      'startDate', qualification.start_date, 'endDate', qualification.end_date
    ) order by qualification.graduation_year desc nulls last, qualification.record_code)
      from public.hrm_employee_qualifications qualification
      where qualification.employee_id = p_employee_id and qualification.status = 'ACTIVE'
    ), '[]'::jsonb),
    'certifications', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', certification.record_code,
      'certificationTypeCode', certification.certification_type_code,
      'certificationName', certification.certification_name,
      'certificateNumber', certification.certificate_number,
      'issuerName', certification.issuer_name, 'issuedDate', certification.issued_date,
      'expiryDate', certification.expiry_date, 'status', certification.status
    ) order by certification.issued_date desc nulls last, certification.record_code)
      from public.hrm_employee_certifications certification
      where certification.employee_id = p_employee_id and certification.status <> 'INACTIVE'
    ), '[]'::jsonb),
    'documents', case when v_level in ('HR','HR_MANAGE') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', document.id, 'docType', document.doc_type,
        'docCategory', document.doc_category, 'title', document.title,
        'docNumber', document.doc_number, 'docDate', document.doc_date,
        'deadline', document.deadline, 'status', document.status,
        'fileName', document.file_name, 'fileType', document.file_type,
        'fileSize', document.file_size
      ) order by document.created_at desc)
      from public.hrm_documents document
      where document.employee_id = p_employee_id::text
    ), '[]'::jsonb) else '[]'::jsonb end,
    'maskedFields', case when v_level in ('SELF','MANAGER')
      then '["documents"]'::jsonb else '[]'::jsonb end
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_hrm_employee_overview(p_employee_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_hrm_employee_overview($1);
$$;
create or replace function public.get_hrm_employee_personal_contact(p_employee_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_hrm_employee_personal_contact($1);
$$;
create or replace function public.get_hrm_employee_work_organization(p_employee_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_hrm_employee_work_organization($1);
$$;
create or replace function public.get_hrm_employee_attendance_leave(
  p_employee_id uuid, p_year integer default extract(year from current_date)::integer,
  p_month integer default extract(month from current_date)::integer
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_hrm_employee_attendance_leave($1, $2, $3);
$$;
create or replace function public.get_hrm_employee_contract_employment(p_employee_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_hrm_employee_contract_employment($1);
$$;
create or replace function public.get_hrm_employee_legal_insurance(p_employee_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_hrm_employee_legal_insurance($1);
$$;
create or replace function public.get_hrm_employee_compensation_tax_bank(p_employee_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_hrm_employee_compensation_tax_bank($1);
$$;
create or replace function public.get_hrm_employee_qualifications_documents(p_employee_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_hrm_employee_qualifications_documents($1);
$$;

revoke all on function app_private.has_governed_hrm_permission(uuid,text,text,text) from public,anon,authenticated;
revoke all on function app_private.hrm_employee_profile_access_level(uuid) from public,anon,authenticated;
revoke all on function app_private.assert_hrm_profile_section_access(uuid,text[]) from public,anon,authenticated;
revoke all on function public.get_hrm_employee_overview(uuid) from public,anon;
revoke all on function public.get_hrm_employee_personal_contact(uuid) from public,anon;
revoke all on function public.get_hrm_employee_work_organization(uuid) from public,anon;
revoke all on function public.get_hrm_employee_attendance_leave(uuid,integer,integer) from public,anon;
revoke all on function public.get_hrm_employee_contract_employment(uuid) from public,anon;
revoke all on function public.get_hrm_employee_legal_insurance(uuid) from public,anon;
revoke all on function public.get_hrm_employee_compensation_tax_bank(uuid) from public,anon;
revoke all on function public.get_hrm_employee_qualifications_documents(uuid) from public,anon;
grant execute on function public.get_hrm_employee_overview(uuid) to authenticated,service_role;
grant execute on function public.get_hrm_employee_personal_contact(uuid) to authenticated,service_role;
grant execute on function public.get_hrm_employee_work_organization(uuid) to authenticated,service_role;
grant execute on function public.get_hrm_employee_attendance_leave(uuid,integer,integer) to authenticated,service_role;
grant execute on function public.get_hrm_employee_contract_employment(uuid) to authenticated,service_role;
grant execute on function public.get_hrm_employee_legal_insurance(uuid) to authenticated,service_role;
grant execute on function public.get_hrm_employee_compensation_tax_bank(uuid) to authenticated,service_role;
grant execute on function public.get_hrm_employee_qualifications_documents(uuid) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;

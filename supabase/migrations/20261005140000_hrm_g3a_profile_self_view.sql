-- HRM G3a — personnel profile (owner decision 9, 02/10/2026; docs/audits/hrm-attendance-leave-2026-10-02 §6, §11):
--   * Employees read their own contracts, employment history, identity documents, social insurance
--     and dependents (read only; HR still edits). Pay / tax / bank stay HR-only.
--   * HR gets a "missing profile data" list to complete records.

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_overview(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    when v_level = 'SELF' then array[
      'overview','personal_contact','work_organization','attendance_leave',
      'contracts_employment','legal_insurance','qualifications_documents'
    ]
    when v_level = 'MANAGER' then array[
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
      when v_level = 'SELF' then '["compensation"]'::jsonb
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
$function$;

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_contract_employment(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level text := app_private.assert_hrm_profile_section_access(p_employee_id, array['SELF','HR','HR_MANAGE']);
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
$function$;

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_legal_insurance(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level text := app_private.assert_hrm_profile_section_access(p_employee_id, array['SELF','HR','HR_MANAGE']);
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
$function$;


-- ── What is still missing in each active employee's profile (HR only) ─────
create or replace function public.list_hrm_profile_completeness()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_year integer := extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::integer;
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'Chỉ HR xem được bảng hồ sơ còn thiếu.';
  end if;
  return coalesce((
    select jsonb_agg(row_data order by (row_data ->> 'missingCount')::int desc, row_data ->> 'fullName')
    from (
      select jsonb_build_object(
        'employeeId', employee.id,
        'employeeCode', employee.employee_code,
        'fullName', employee.full_name,
        'orgUnitName', org.name,
        'checks', checks,
        'missingCount', (select count(*) from jsonb_each(checks) item where item.value = 'false'::jsonb)
      ) as row_data
      from public.employees employee
      left join public.org_units org on org.id = employee.org_unit_id
      cross join lateral (
        select jsonb_build_object(
          'startDate', employee.start_date is not null,
          'dateOfBirth', employee.date_of_birth is not null,
          'phone', coalesce(nullif(trim(employee.phone), ''), '') <> '',
          'orgUnit', employee.org_unit_id is not null,
          'position', employee.position_id is not null,
          'manager', coalesce(
            app_private.resolve_slot_direct_manager(employee.user_id),
            (select u.manager_id from public.users u where u.id = employee.user_id),
            (select nullif(site."managerId", '')::uuid from public.hrm_construction_sites site where site.id = employee.construction_site_id)
          ) is not null,
          'identity', exists (select 1 from public.hrm_employee_identity_documents doc where doc.employee_id = employee.id and doc.status <> 'INACTIVE'),
          'insurance', exists (select 1 from public.hrm_employee_insurance_profiles insurance where insurance.employee_id = employee.id and nullif(trim(insurance.social_insurance_number), '') is not null),
          'contract', exists (
            select 1 from public.hrm_labor_contracts contract
            where contract.employee_id = employee.id and contract.status = 'active'
              and contract.effective_from <= current_date and (contract.effective_to is null or contract.effective_to >= current_date)
          ),
          'bankAccount', exists (select 1 from public.hrm_employee_bank_accounts bank where bank.employee_id = employee.id),
          'leaveBalance', exists (select 1 from public.hrm_leave_balances balance where balance."employeeId" = employee.id and balance.year = v_year)
        ) as checks
      ) computed
      where employee.status = 'Đang làm việc'
    ) rows_data
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_hrm_profile_completeness() from public, anon;
grant execute on function public.list_hrm_profile_completeness() to authenticated;

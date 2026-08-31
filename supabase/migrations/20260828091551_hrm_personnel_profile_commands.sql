begin;

create or replace function app_private.audit_hrm_profile_command(
  p_employee_id uuid,
  p_entity_type text,
  p_record_id text,
  p_action text,
  p_reason text,
  p_changed_fields text[]
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.audit_trail(
    table_name, record_id, action, user_id, module, description,
    record_label, entity_type, changed_fields, change_count, impact_level, context
  ) values (
    p_entity_type, p_record_id,
    case when p_action in ('INSERT','UPDATE','DELETE') then p_action else 'UPDATE' end,
    public.current_app_user_id()::text,
    'HRM', 'Cập nhật hồ sơ nhân sự', p_employee_id::text, p_entity_type,
    p_changed_fields, cardinality(p_changed_fields),
    case when p_entity_type in ('HRM_IDENTITY_DOCUMENT','HRM_INSURANCE_PROFILE','HRM_DEPENDENT','HRM_EMPLOYMENT_EVENT') then 'high'
         when p_entity_type in ('HRM_TAX_PROFILE','HRM_BANK_ACCOUNT','HRM_CONTRACT') then 'critical'
         else 'normal' end,
    jsonb_build_object('employee_id', p_employee_id, 'reason', nullif(trim(p_reason), ''))
  );
$$;

create or replace function app_private.can_edit_hrm_c2(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.hrm_employee_profile_access_level(p_employee_id) in ('SELF','HR','HR_MANAGE');
$$;

create or replace function public.update_hrm_employee_core_profile(
  p_employee_id uuid,
  p_full_name text,
  p_gender text,
  p_phone text,
  p_email text,
  p_date_of_birth date,
  p_start_date date,
  p_official_date date,
  p_status text,
  p_linked_user_id uuid,
  p_area_id uuid,
  p_office_id uuid,
  p_employee_type_id uuid,
  p_work_schedule_id uuid,
  p_marital_status text,
  p_avatar_url text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.edit_profile') then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_EDIT_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception using errcode = '22023', message = 'HRM_EMPLOYEE_FULL_NAME_REQUIRED';
  end if;

  update public.employees
  set full_name = trim(p_full_name),
      gender = nullif(trim(p_gender), ''),
      phone = nullif(trim(p_phone), ''),
      email = nullif(trim(p_email), ''),
      date_of_birth = p_date_of_birth,
      start_date = p_start_date,
      official_date = p_official_date,
      status = coalesce(nullif(trim(p_status), ''), status),
      user_id = p_linked_user_id,
      area_id = p_area_id,
      office_id = p_office_id,
      employee_type_id = p_employee_type_id,
      work_schedule_id = p_work_schedule_id,
      marital_status = nullif(trim(p_marital_status), ''),
      avatar_url = nullif(trim(p_avatar_url), ''),
      updated_at = now()
  where id = p_employee_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'HRM_EMPLOYEE_NOT_FOUND';
  end if;

  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_EMPLOYEE_PROFILE', p_employee_id::text, 'UPDATE', p_reason,
    array[
      'full_name','gender','phone','email','date_of_birth','start_date','official_date',
      'status','user_id','area_id','office_id','employee_type_id','work_schedule_id',
      'marital_status','avatar_url'
    ]
  );
  return app_private.get_hrm_employee_overview(p_employee_id);
end;
$$;

create or replace function public.update_hrm_employee_personal_contact(
  p_employee_id uuid,
  p_personal_phone text,
  p_personal_email text,
  p_address_record_code text default null,
  p_address_type text default null,
  p_address_line text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_level text := app_private.hrm_employee_profile_access_level(p_employee_id);
begin
  if not app_private.can_edit_hrm_c2(p_employee_id) then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_EDIT_REQUIRED';
  end if;
  insert into public.hrm_employee_private_profiles(
    employee_id, personal_phone, personal_email, created_by, updated_by
  ) values (
    p_employee_id, nullif(trim(p_personal_phone), ''), nullif(trim(p_personal_email), ''),
    v_actor_id, v_actor_id
  ) on conflict (employee_id) do update set
    personal_phone = excluded.personal_phone,
    personal_email = excluded.personal_email,
    updated_by = v_actor_id,
    updated_at = now();

  if p_address_record_code is not null or p_address_type is not null or p_address_line is not null then
    if p_address_type not in ('CURRENT','CONTACT') and v_level = 'SELF' then
      raise exception using errcode = '42501', message = 'HRM_SELF_ADDRESS_TYPE_NOT_ALLOWED';
    end if;
    if p_address_type not in ('PERMANENT','CURRENT','CONTACT')
      or length(trim(coalesce(p_address_record_code, ''))) = 0
      or length(trim(coalesce(p_address_line, ''))) = 0
    then
      raise exception using errcode = '22023', message = 'HRM_ADDRESS_INPUT_INVALID';
    end if;
    insert into public.hrm_employee_addresses(
      employee_id, record_code, address_type, address_line, created_by, updated_by
    ) values (
      p_employee_id, trim(p_address_record_code), p_address_type,
      trim(p_address_line), v_actor_id, v_actor_id
    ) on conflict (employee_id, record_code) do update set
      address_type = excluded.address_type,
      address_line = excluded.address_line,
      status = 'ACTIVE', updated_by = v_actor_id, updated_at = now();
  end if;

  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_PERSONAL_CONTACT', p_employee_id::text, 'UPDATE', p_reason,
    array['personal_phone','personal_email','address']
  );
  return app_private.get_hrm_employee_personal_contact(p_employee_id);
end;
$$;

create or replace function public.upsert_hrm_employee_emergency_contact(
  p_employee_id uuid, p_record_code text, p_full_name text,
  p_relationship_code text, p_phone text, p_email text default null,
  p_address text default null, p_is_primary boolean default false,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.can_edit_hrm_c2(p_employee_id) then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_EDIT_REQUIRED';
  end if;
  if length(trim(coalesce(p_record_code, ''))) = 0
    or length(trim(coalesce(p_full_name, ''))) = 0
    or length(trim(coalesce(p_relationship_code, ''))) = 0
    or length(trim(coalesce(p_phone, ''))) = 0
  then raise exception using errcode = '22023', message = 'HRM_EMERGENCY_CONTACT_INPUT_INVALID';
  end if;
  if p_is_primary then
    update public.hrm_employee_emergency_contacts set is_primary = false,
      updated_by = v_actor_id, updated_at = now()
    where employee_id = p_employee_id and is_primary;
  end if;
  insert into public.hrm_employee_emergency_contacts(
    employee_id, record_code, full_name, relationship_code, phone,
    email, address, is_primary, created_by, updated_by
  ) values (
    p_employee_id, trim(p_record_code), trim(p_full_name), trim(p_relationship_code),
    trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_address), ''),
    p_is_primary, v_actor_id, v_actor_id
  ) on conflict (employee_id, record_code) do update set
    full_name = excluded.full_name, relationship_code = excluded.relationship_code,
    phone = excluded.phone, email = excluded.email, address = excluded.address,
    is_primary = excluded.is_primary, status = 'ACTIVE',
    updated_by = v_actor_id, updated_at = now();
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_EMERGENCY_CONTACT', trim(p_record_code), 'UPSERT', p_reason,
    array['full_name','relationship_code','phone','email','address','is_primary']
  );
  return app_private.get_hrm_employee_personal_contact(p_employee_id);
end;
$$;

create or replace function public.upsert_hrm_employee_identity_document(
  p_employee_id uuid, p_record_code text, p_document_type_code text,
  p_document_number text, p_issued_date date, p_issued_place text,
  p_expiry_date date, p_is_primary boolean, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.edit_sensitive') then
    raise exception using errcode = '42501', message = 'HRM_SENSITIVE_EDIT_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  if length(trim(coalesce(p_record_code, ''))) = 0
    or length(trim(coalesce(p_document_type_code, ''))) = 0
    or length(trim(coalesce(p_document_number, ''))) = 0
  then raise exception using errcode = '22023', message = 'HRM_IDENTITY_DOCUMENT_INPUT_INVALID';
  end if;
  if p_is_primary then
    update public.hrm_employee_identity_documents set is_primary = false,
      updated_by = v_actor_id, updated_at = now()
    where employee_id = p_employee_id and is_primary;
  end if;
  insert into public.hrm_employee_identity_documents(
    employee_id, record_code, document_type_code, document_number,
    issued_date, issued_place, expiry_date, is_primary, created_by, updated_by
  ) values (
    p_employee_id, trim(p_record_code), trim(p_document_type_code),
    trim(p_document_number), p_issued_date, nullif(trim(p_issued_place), ''),
    p_expiry_date, p_is_primary, v_actor_id, v_actor_id
  ) on conflict (employee_id, record_code) do update set
    document_type_code = excluded.document_type_code,
    document_number = excluded.document_number, issued_date = excluded.issued_date,
    issued_place = excluded.issued_place, expiry_date = excluded.expiry_date,
    is_primary = excluded.is_primary, status = 'ACTIVE',
    updated_by = v_actor_id, updated_at = now();
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_IDENTITY_DOCUMENT', trim(p_record_code), 'UPSERT', p_reason,
    array['document_type_code','document_number','issued_date','issued_place','expiry_date','is_primary']
  );
  return app_private.get_hrm_employee_legal_insurance(p_employee_id);
end;
$$;

create or replace function public.upsert_hrm_employee_insurance_profile(
  p_employee_id uuid, p_social_insurance_number text,
  p_health_insurance_number text, p_registered_clinic_code text,
  p_participation_status_code text, p_effective_from date,
  p_effective_to date, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.edit_sensitive') then
    raise exception using errcode = '42501', message = 'HRM_SENSITIVE_EDIT_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  insert into public.hrm_employee_insurance_profiles(
    employee_id, social_insurance_number, health_insurance_number,
    registered_clinic_code, participation_status_code, effective_from,
    effective_to, created_by, updated_by
  ) values (
    p_employee_id, nullif(trim(p_social_insurance_number), ''),
    nullif(trim(p_health_insurance_number), ''), nullif(trim(p_registered_clinic_code), ''),
    nullif(trim(p_participation_status_code), ''), p_effective_from, p_effective_to,
    v_actor_id, v_actor_id
  ) on conflict (employee_id) do update set
    social_insurance_number = excluded.social_insurance_number,
    health_insurance_number = excluded.health_insurance_number,
    registered_clinic_code = excluded.registered_clinic_code,
    participation_status_code = excluded.participation_status_code,
    effective_from = excluded.effective_from, effective_to = excluded.effective_to,
    status = 'ACTIVE', updated_by = v_actor_id, updated_at = now();
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_INSURANCE_PROFILE', p_employee_id::text, 'UPSERT', p_reason,
    array['social_insurance_number','health_insurance_number','registered_clinic_code','participation_status_code','effective_dates']
  );
  return app_private.get_hrm_employee_legal_insurance(p_employee_id);
end;
$$;

create or replace function public.upsert_hrm_employee_dependent(
  p_employee_id uuid, p_record_code text, p_full_name text,
  p_relationship_code text, p_date_of_birth date, p_tax_code text,
  p_deduction_from date, p_deduction_to date, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.edit_sensitive') then
    raise exception using errcode = '42501', message = 'HRM_SENSITIVE_EDIT_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  if length(trim(coalesce(p_record_code, ''))) = 0
    or length(trim(coalesce(p_full_name, ''))) = 0
    or length(trim(coalesce(p_relationship_code, ''))) = 0
  then raise exception using errcode = '22023', message = 'HRM_DEPENDENT_INPUT_INVALID';
  end if;
  insert into public.hrm_employee_dependents(
    employee_id, record_code, full_name, relationship_code, date_of_birth,
    tax_code, deduction_from, deduction_to, created_by, updated_by
  ) values (
    p_employee_id, trim(p_record_code), trim(p_full_name), trim(p_relationship_code),
    p_date_of_birth, nullif(trim(p_tax_code), ''), p_deduction_from, p_deduction_to,
    v_actor_id, v_actor_id
  ) on conflict (employee_id, record_code) do update set
    full_name = excluded.full_name, relationship_code = excluded.relationship_code,
    date_of_birth = excluded.date_of_birth, tax_code = excluded.tax_code,
    deduction_from = excluded.deduction_from, deduction_to = excluded.deduction_to,
    status = 'ACTIVE', updated_by = v_actor_id, updated_at = now();
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_DEPENDENT', trim(p_record_code), 'UPSERT', p_reason,
    array['full_name','relationship_code','date_of_birth','tax_code','deduction_dates']
  );
  return app_private.get_hrm_employee_legal_insurance(p_employee_id);
end;
$$;

create or replace function public.upsert_hrm_employee_employment_event(
  p_employee_id uuid, p_record_code text, p_event_type_code text,
  p_event_date date, p_org_unit_id uuid, p_position_id uuid,
  p_title_snapshot text, p_event_reason text, p_source_reference text,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.contract.manage') then
    raise exception using errcode = '42501', message = 'HRM_CONTRACT_MANAGE_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  if length(trim(coalesce(p_record_code, ''))) = 0
    or length(trim(coalesce(p_event_type_code, ''))) = 0
    or p_event_date is null
    or length(trim(coalesce(p_source_reference, ''))) = 0
  then raise exception using errcode = '22023', message = 'HRM_EMPLOYMENT_EVENT_INPUT_INVALID';
  end if;
  insert into public.hrm_employee_employment_events(
    employee_id, record_code, event_type_code, event_date, org_unit_id,
    position_id, title_snapshot, reason, source_reference, created_by, updated_by
  ) values (
    p_employee_id, trim(p_record_code), trim(p_event_type_code), p_event_date,
    p_org_unit_id, p_position_id, nullif(trim(p_title_snapshot), ''),
    nullif(trim(p_event_reason), ''), trim(p_source_reference), v_actor_id, v_actor_id
  ) on conflict (employee_id, record_code) do update set
    event_type_code = excluded.event_type_code, event_date = excluded.event_date,
    org_unit_id = excluded.org_unit_id, position_id = excluded.position_id,
    title_snapshot = excluded.title_snapshot, reason = excluded.reason,
    source_reference = excluded.source_reference, status = 'ACTIVE',
    updated_by = v_actor_id, updated_at = now();
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_EMPLOYMENT_EVENT', trim(p_record_code), 'UPSERT', p_reason,
    array['event_type_code','event_date','org_unit_id','position_id','title_snapshot','reason','source_reference']
  );
  return app_private.get_hrm_employee_contract_employment(p_employee_id);
end;
$$;

create or replace function public.upsert_hrm_employee_qualification(
  p_employee_id uuid, p_record_code text, p_education_level_code text,
  p_institution_name text, p_major_name text, p_degree_name text,
  p_graduation_year integer, p_start_date date, p_end_date date, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.document.manage') then
    raise exception using errcode = '42501', message = 'HRM_DOCUMENT_MANAGE_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  if length(trim(coalesce(p_record_code, ''))) = 0
    or length(trim(coalesce(p_institution_name, ''))) = 0
  then raise exception using errcode = '22023', message = 'HRM_QUALIFICATION_INPUT_INVALID';
  end if;
  insert into public.hrm_employee_qualifications(
    employee_id, record_code, education_level_code, institution_name,
    major_name, degree_name, graduation_year, start_date, end_date, created_by, updated_by
  ) values (
    p_employee_id, trim(p_record_code), nullif(trim(p_education_level_code), ''),
    trim(p_institution_name), nullif(trim(p_major_name), ''), nullif(trim(p_degree_name), ''),
    p_graduation_year, p_start_date, p_end_date, v_actor_id, v_actor_id
  ) on conflict (employee_id, record_code) do update set
    education_level_code = excluded.education_level_code,
    institution_name = excluded.institution_name, major_name = excluded.major_name,
    degree_name = excluded.degree_name, graduation_year = excluded.graduation_year,
    start_date = excluded.start_date, end_date = excluded.end_date,
    status = 'ACTIVE', updated_by = v_actor_id, updated_at = now();
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_QUALIFICATION', trim(p_record_code), 'UPSERT', p_reason,
    array['education_level_code','institution_name','major_name','degree_name','graduation_year','effective_dates']
  );
  return app_private.get_hrm_employee_qualifications_documents(p_employee_id);
end;
$$;

create or replace function public.upsert_hrm_employee_certification(
  p_employee_id uuid, p_record_code text, p_certification_type_code text,
  p_certification_name text, p_certificate_number text, p_issuer_name text,
  p_issued_date date, p_expiry_date date, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.document.manage') then
    raise exception using errcode = '42501', message = 'HRM_DOCUMENT_MANAGE_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  if length(trim(coalesce(p_record_code, ''))) = 0
    or length(trim(coalesce(p_certification_name, ''))) = 0
  then raise exception using errcode = '22023', message = 'HRM_CERTIFICATION_INPUT_INVALID';
  end if;
  insert into public.hrm_employee_certifications(
    employee_id, record_code, certification_type_code, certification_name,
    certificate_number, issuer_name, issued_date, expiry_date, created_by, updated_by
  ) values (
    p_employee_id, trim(p_record_code), nullif(trim(p_certification_type_code), ''),
    trim(p_certification_name), nullif(trim(p_certificate_number), ''),
    nullif(trim(p_issuer_name), ''), p_issued_date, p_expiry_date, v_actor_id, v_actor_id
  ) on conflict (employee_id, record_code) do update set
    certification_type_code = excluded.certification_type_code,
    certification_name = excluded.certification_name,
    certificate_number = excluded.certificate_number, issuer_name = excluded.issuer_name,
    issued_date = excluded.issued_date, expiry_date = excluded.expiry_date,
    status = 'ACTIVE', updated_by = v_actor_id, updated_at = now();
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_CERTIFICATION', trim(p_record_code), 'UPSERT', p_reason,
    array['certification_type_code','certification_name','certificate_number','issuer_name','issued_date','expiry_date']
  );
  return app_private.get_hrm_employee_qualifications_documents(p_employee_id);
end;
$$;

create or replace function public.upsert_hrm_employee_bank_account(
  p_employee_id uuid, p_record_code text, p_bank_code text,
  p_branch_name text, p_account_number text, p_account_holder text,
  p_is_payroll_account boolean, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.compensation.manage') then
    raise exception using errcode = '42501', message = 'HRM_COMPENSATION_MANAGE_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  if p_is_payroll_account then
    update public.hrm_employee_bank_accounts set is_payroll_account = false,
      updated_by = v_actor_id, updated_at = now()
    where employee_id = p_employee_id and is_payroll_account;
  end if;
  insert into public.hrm_employee_bank_accounts(
    employee_id, record_code, bank_code, branch_name, account_number,
    account_holder, is_payroll_account, created_by, updated_by
  ) values (
    p_employee_id, trim(p_record_code), trim(p_bank_code), nullif(trim(p_branch_name), ''),
    trim(p_account_number), trim(p_account_holder), p_is_payroll_account,
    v_actor_id, v_actor_id
  ) on conflict (employee_id, record_code) do update set
    bank_code = excluded.bank_code, branch_name = excluded.branch_name,
    account_number = excluded.account_number, account_holder = excluded.account_holder,
    is_payroll_account = excluded.is_payroll_account, status = 'ACTIVE',
    updated_by = v_actor_id, updated_at = now();
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_BANK_ACCOUNT', trim(p_record_code), 'UPSERT', p_reason,
    array['bank_code','branch_name','account_number','account_holder','is_payroll_account']
  );
  return app_private.get_hrm_employee_compensation_tax_bank(p_employee_id);
end;
$$;

create or replace function public.upsert_hrm_employee_tax_profile(
  p_employee_id uuid, p_tax_code text, p_tax_residency_code text,
  p_registration_date date, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.compensation.manage') then
    raise exception using errcode = '42501', message = 'HRM_COMPENSATION_MANAGE_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  insert into public.hrm_employee_tax_profiles(
    employee_id, tax_code, tax_residency_code, registration_date, created_by, updated_by
  ) values (
    p_employee_id, nullif(trim(p_tax_code), ''), nullif(trim(p_tax_residency_code), ''),
    p_registration_date, v_actor_id, v_actor_id
  ) on conflict (employee_id) do update set
    tax_code = excluded.tax_code, tax_residency_code = excluded.tax_residency_code,
    registration_date = excluded.registration_date, status = 'ACTIVE',
    updated_by = v_actor_id, updated_at = now();
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_TAX_PROFILE', p_employee_id::text, 'UPSERT', p_reason,
    array['tax_code','tax_residency_code','registration_date']
  );
  return app_private.get_hrm_employee_compensation_tax_bank(p_employee_id);
end;
$$;

create or replace function public.upsert_hrm_employee_contract(
  p_id uuid, p_employee_id uuid, p_contract_number text, p_type text,
  p_status text, p_effective_from date, p_effective_to date,
  p_signed_by text, p_note text, p_base_salary numeric,
  p_allowance_position numeric, p_allowance_other numeric, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_can_manage_c4 boolean := app_private.has_hrm_template_permission(v_actor_id, 'hrm.compensation.manage');
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_previous_salary numeric;
  v_previous_allowance numeric;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.contract.manage') then
    raise exception using errcode = '42501', message = 'HRM_CONTRACT_MANAGE_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  if not v_can_manage_c4 and (p_base_salary is not null or p_allowance_position is not null or p_allowance_other is not null) then
    raise exception using errcode = '42501', message = 'HRM_CONTRACT_COMPENSATION_MUTATION_REQUIRED';
  end if;
  select contract.base_salary, contract.allowance_position
  into v_previous_salary, v_previous_allowance
  from public.hrm_labor_contracts contract
  where contract.id = v_id
  for update;
  insert into public.hrm_labor_contracts(
    id, employee_id, contract_number, type, status, effective_from, effective_to,
    signed_by, note, base_salary, allowance_position, allowance_other,
    created_by, updated_by
  ) values (
    v_id, p_employee_id, trim(p_contract_number), trim(p_type), p_status,
    p_effective_from, p_effective_to, nullif(trim(p_signed_by), ''), nullif(trim(p_note), ''),
    p_base_salary, p_allowance_position, p_allowance_other, v_actor_id, v_actor_id
  ) on conflict (id) do update set
    contract_number = excluded.contract_number, type = excluded.type,
    status = excluded.status, effective_from = excluded.effective_from,
    effective_to = excluded.effective_to, signed_by = excluded.signed_by,
    note = excluded.note,
    base_salary = case
      when v_can_manage_c4 and p_base_salary is not null then excluded.base_salary
      else public.hrm_labor_contracts.base_salary
    end,
    allowance_position = case
      when v_can_manage_c4 and p_allowance_position is not null then excluded.allowance_position
      else public.hrm_labor_contracts.allowance_position
    end,
    allowance_other = case
      when v_can_manage_c4 and p_allowance_other is not null then excluded.allowance_other
      else public.hrm_labor_contracts.allowance_other
    end,
    updated_by = v_actor_id, updated_at = now();
  if v_can_manage_c4 and p_base_salary is not null
    and (v_previous_salary is distinct from p_base_salary or v_previous_allowance is distinct from p_allowance_position)
  then
    update public.hrm_salary_history
    set status = 'SUPERSEDED', effective_to = greatest(effective_from, p_effective_from),
        updated_by = v_actor_id, updated_at = now()
    where employee_id = p_employee_id and status = 'ACTIVE';
    insert into public.hrm_salary_history(
      employee_id, contract_id, effective_from, previous_salary, new_salary,
      previous_allowance, new_allowance, reason, created_by, updated_by
    ) values (
      p_employee_id, v_id, p_effective_from, v_previous_salary, p_base_salary,
      v_previous_allowance, p_allowance_position, p_reason, v_actor_id, v_actor_id
    );
  end if;
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_CONTRACT', v_id::text, 'UPSERT', p_reason,
    array['contract_number','type','status','effective_dates','signed_by','note']
      || case when v_can_manage_c4 then array['compensation'] else array[]::text[] end
  );
  return app_private.get_hrm_employee_contract_employment(p_employee_id);
end;
$$;

-- Contract and salary rows mix C3/C4 fields. Frontend mutations must use the
-- field-aware commands above instead of direct table writes.
drop policy if exists hrm_labor_contracts_insert_hr_template on public.hrm_labor_contracts;
drop policy if exists hrm_labor_contracts_update_hr_template on public.hrm_labor_contracts;
drop policy if exists hrm_labor_contracts_delete_hr_template on public.hrm_labor_contracts;
revoke insert, update, delete on public.hrm_labor_contracts from authenticated, anon;
revoke insert, update, delete on public.hrm_salary_history from authenticated, anon;

revoke all on function app_private.audit_hrm_profile_command(uuid,text,text,text,text,text[]) from public,anon,authenticated;
revoke all on function app_private.can_edit_hrm_c2(uuid) from public,anon,authenticated;
revoke all on function public.update_hrm_employee_core_profile(uuid,text,text,text,text,date,date,date,text,uuid,uuid,uuid,uuid,uuid,text,text,text) from public,anon;
revoke all on function public.update_hrm_employee_personal_contact(uuid,text,text,text,text,text,text) from public,anon;
revoke all on function public.upsert_hrm_employee_emergency_contact(uuid,text,text,text,text,text,text,boolean,text) from public,anon;
revoke all on function public.upsert_hrm_employee_identity_document(uuid,text,text,text,date,text,date,boolean,text) from public,anon;
revoke all on function public.upsert_hrm_employee_insurance_profile(uuid,text,text,text,text,date,date,text) from public,anon;
revoke all on function public.upsert_hrm_employee_dependent(uuid,text,text,text,date,text,date,date,text) from public,anon;
revoke all on function public.upsert_hrm_employee_employment_event(uuid,text,text,date,uuid,uuid,text,text,text,text) from public,anon;
revoke all on function public.upsert_hrm_employee_qualification(uuid,text,text,text,text,text,integer,date,date,text) from public,anon;
revoke all on function public.upsert_hrm_employee_certification(uuid,text,text,text,text,text,date,date,text) from public,anon;
revoke all on function public.upsert_hrm_employee_bank_account(uuid,text,text,text,text,text,boolean,text) from public,anon;
revoke all on function public.upsert_hrm_employee_tax_profile(uuid,text,text,date,text) from public,anon;
revoke all on function public.upsert_hrm_employee_contract(uuid,uuid,text,text,text,date,date,text,text,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.update_hrm_employee_personal_contact(uuid,text,text,text,text,text,text) to authenticated,service_role;
grant execute on function public.update_hrm_employee_core_profile(uuid,text,text,text,text,date,date,date,text,uuid,uuid,uuid,uuid,uuid,text,text,text) to authenticated,service_role;
grant execute on function public.upsert_hrm_employee_emergency_contact(uuid,text,text,text,text,text,text,boolean,text) to authenticated,service_role;
grant execute on function public.upsert_hrm_employee_identity_document(uuid,text,text,text,date,text,date,boolean,text) to authenticated,service_role;
grant execute on function public.upsert_hrm_employee_insurance_profile(uuid,text,text,text,text,date,date,text) to authenticated,service_role;
grant execute on function public.upsert_hrm_employee_dependent(uuid,text,text,text,date,text,date,date,text) to authenticated,service_role;
grant execute on function public.upsert_hrm_employee_employment_event(uuid,text,text,date,uuid,uuid,text,text,text,text) to authenticated,service_role;
grant execute on function public.upsert_hrm_employee_qualification(uuid,text,text,text,text,text,integer,date,date,text) to authenticated,service_role;
grant execute on function public.upsert_hrm_employee_certification(uuid,text,text,text,text,text,date,date,text) to authenticated,service_role;
grant execute on function public.upsert_hrm_employee_bank_account(uuid,text,text,text,text,text,boolean,text) to authenticated,service_role;
grant execute on function public.upsert_hrm_employee_tax_profile(uuid,text,text,date,text) to authenticated,service_role;
grant execute on function public.upsert_hrm_employee_contract(uuid,uuid,text,text,text,date,date,text,text,numeric,numeric,numeric,text) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;

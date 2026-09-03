begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'hrm-private-imports', 'hrm-private-imports', false, 20971520,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.hrm_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_file_path text not null,
  source_file_hash text not null,
  manifest jsonb not null default '{}'::jsonb,
  status text not null default 'UPLOADED'
    check (status in ('UPLOADED','STAGED','VALIDATED','APPLIED','FAILED','CANCELLED')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  error_rows integer not null default 0,
  fingerprint text,
  applied_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days',
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(manifest) = 'object')
);

create table public.hrm_import_staging_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.hrm_import_batches(id) on delete cascade,
  sheet_code text not null,
  row_number integer not null check (row_number >= 2),
  employee_code text,
  record_code text,
  record_type text not null,
  domain_code text not null,
  row_payload jsonb not null default '{}'::jsonb,
  typed_payload jsonb not null default '{}'::jsonb,
  validation_status text not null default 'PENDING'
    check (validation_status in ('PENDING','VALID','ERROR','APPLIED')),
  validation_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(batch_id, sheet_code, row_number),
  check (jsonb_typeof(row_payload) = 'object'),
  check (jsonb_typeof(typed_payload) = 'object'),
  check (jsonb_typeof(validation_errors) = 'array')
);

create index hrm_import_batches_creator_status_idx
  on public.hrm_import_batches(created_by, status, created_at desc);
create index hrm_import_staging_batch_status_idx
  on public.hrm_import_staging_rows(batch_id, validation_status, sheet_code, row_number);

alter table public.hrm_import_batches enable row level security;
alter table public.hrm_import_staging_rows enable row level security;
revoke all on public.hrm_import_batches from anon, authenticated;
revoke all on public.hrm_import_staging_rows from anon, authenticated;
grant all on public.hrm_import_batches to service_role;
grant all on public.hrm_import_staging_rows to service_role;

drop policy if exists hrm_private_import_insert on storage.objects;
drop policy if exists hrm_private_import_select on storage.objects;
drop policy if exists hrm_private_import_delete on storage.objects;
create policy hrm_private_import_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'hrm-private-imports'
  and split_part(name, '/', 1) = public.current_app_user_id()::text
  and app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.employee.import')
);
create policy hrm_private_import_select on storage.objects for select to authenticated
using (
  bucket_id = 'hrm-private-imports'
  and split_part(name, '/', 1) = public.current_app_user_id()::text
  and app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.employee.import')
);
create policy hrm_private_import_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'hrm-private-imports'
  and split_part(name, '/', 1) = public.current_app_user_id()::text
  and app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.employee.import')
);

create or replace function app_private.hrm_import_domain_for_type(p_record_type text)
returns text language sql immutable set search_path = '' as $$
  select case upper(trim(p_record_type))
    when 'EMPLOYEE_CORE' then 'C2'
    when 'PERSONAL_CONTACT' then 'C2'
    when 'ADDRESS' then 'C2'
    when 'EMERGENCY_CONTACT' then 'C2'
    when 'CONTRACT' then 'C3'
    when 'EMPLOYMENT_EVENT' then 'C3'
    when 'IDENTITY_DOCUMENT' then 'C3'
    when 'INSURANCE' then 'C3'
    when 'DEPENDENT' then 'C3'
    when 'QUALIFICATION' then 'C3'
    when 'CERTIFICATION' then 'C3'
    when 'BANK_ACCOUNT' then 'C4'
    when 'TAX_PROFILE' then 'C4'
    else 'UNSUPPORTED'
  end;
$$;

create or replace function app_private.hrm_import_safe_error(
  p_sheet_code text, p_row_number integer, p_column text, p_error_code text
)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'sheetCode', p_sheet_code,
    'rowNumber', p_row_number,
    'column', p_column,
    'errorCode', p_error_code
  );
$$;

create or replace function app_private.hrm_import_is_iso_date(p_value text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or trim(p_value) = '' then return true; end if;
  if trim(p_value) !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  perform trim(p_value)::date;
  return true;
exception when others then return false;
end;
$$;

create or replace function app_private.hrm_import_required_fields(p_record_type text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_record_type
    when 'EMPLOYEE_CORE' then array[]::text[]
    when 'PERSONAL_CONTACT' then array[]::text[]
    when 'ADDRESS' then array['addressType','addressLine']
    when 'EMERGENCY_CONTACT' then array['fullName','relationshipCode','phone']
    when 'CONTRACT' then array['type','effectiveFrom']
    when 'EMPLOYMENT_EVENT' then array['eventTypeCode','eventDate','sourceReference']
    when 'IDENTITY_DOCUMENT' then array['documentTypeCode','documentNumber']
    when 'INSURANCE' then array[]::text[]
    when 'DEPENDENT' then array['fullName','relationshipCode']
    when 'BANK_ACCOUNT' then array['bankCode','accountNumber','accountHolder']
    when 'TAX_PROFILE' then array[]::text[]
    when 'QUALIFICATION' then array['institutionName']
    when 'CERTIFICATION' then array['certificationName']
    else array[]::text[]
  end;
$$;

create or replace function app_private.assert_hrm_import_owner(p_batch_id uuid)
returns public.hrm_import_batches
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_batch public.hrm_import_batches%rowtype;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.import') then
    raise exception using errcode = '42501', message = 'HRM_EMPLOYEE_IMPORT_REQUIRED';
  end if;
  select batch.* into v_batch
  from public.hrm_import_batches batch
  where batch.id = p_batch_id and batch.created_by = v_actor_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'HRM_IMPORT_BATCH_NOT_FOUND';
  end if;
  return v_batch;
end;
$$;

create or replace function public.create_hrm_import_batch(
  p_source_file_path text,
  p_source_file_hash text,
  p_manifest jsonb
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_batch public.hrm_import_batches%rowtype;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.import') then
    raise exception using errcode = '42501', message = 'HRM_EMPLOYEE_IMPORT_REQUIRED';
  end if;
  if p_source_file_path not like v_actor_id::text || '/%'
    or lower(trim(coalesce(p_source_file_hash, ''))) !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(coalesce(p_manifest, '{}'::jsonb)) <> 'object'
    or coalesce((p_manifest ->> 'formatVersion')::integer, 0) <> 1
    or coalesce((p_manifest ->> 'dataSheetCount')::integer, 0) <> 8
    or not exists (
      select 1 from storage.objects object_row
      where object_row.bucket_id = 'hrm-private-imports' and object_row.name = p_source_file_path
    )
  then raise exception using errcode = '22023', message = 'HRM_IMPORT_MANIFEST_INVALID';
  end if;
  insert into public.hrm_import_batches(
    source_file_path, source_file_hash, manifest, created_by
  ) values (
    trim(p_source_file_path), lower(trim(p_source_file_hash)), coalesce(p_manifest, '{}'::jsonb), v_actor_id
  ) returning * into v_batch;
  return jsonb_build_object(
    'batchId', v_batch.id, 'status', v_batch.status,
    'expiresAt', v_batch.expires_at, 'sourceFileHash', v_batch.source_file_hash
  );
end;
$$;

create or replace function public.stage_hrm_import_rows(
  p_batch_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.hrm_import_batches%rowtype := app_private.assert_hrm_import_owner(p_batch_id);
  v_row jsonb;
  v_count integer := 0;
  v_sheet text;
  v_type text;
begin
  if v_batch.status in ('APPLIED','CANCELLED') then
    raise exception using errcode = '55000', message = 'HRM_IMPORT_BATCH_IMMUTABLE';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then
    raise exception using errcode = '22023', message = 'HRM_IMPORT_ROWS_INVALID';
  end if;
  delete from public.hrm_import_staging_rows where batch_id = p_batch_id;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_sheet := upper(trim(coalesce(v_row ->> 'sheetCode', '')));
    v_type := upper(trim(coalesce(v_row ->> 'recordType', '')));
    if v_sheet not in (
      'OVERVIEW','PERSONAL_CONTACT','WORK_ORGANIZATION','ATTENDANCE_LEAVE',
      'CONTRACTS_EMPLOYMENT','LEGAL_INSURANCE','COMPENSATION_TAX_BANK',
      'QUALIFICATIONS_DOCUMENTS'
    ) then
      raise exception using errcode = '22023', message = 'HRM_IMPORT_SHEET_INVALID';
    end if;
    insert into public.hrm_import_staging_rows(
      batch_id, sheet_code, row_number, employee_code, record_code,
      record_type, domain_code, row_payload, typed_payload
    ) values (
      p_batch_id, v_sheet, (v_row ->> 'rowNumber')::integer,
      nullif(trim(v_row ->> 'employeeCode'), ''), nullif(trim(v_row ->> 'recordCode'), ''),
      v_type, app_private.hrm_import_domain_for_type(v_type),
      coalesce(v_row -> 'payload', '{}'::jsonb), coalesce(v_row -> 'payload', '{}'::jsonb)
    );
    v_count := v_count + 1;
  end loop;
  update public.hrm_import_batches set
    status = 'STAGED', total_rows = v_count, valid_rows = 0, error_rows = 0,
    fingerprint = null, updated_at = now()
  where id = p_batch_id;
  return jsonb_build_object('batchId', p_batch_id, 'status', 'STAGED', 'totalRows', v_count);
end;
$$;

create or replace function public.preview_hrm_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.hrm_import_batches%rowtype := app_private.assert_hrm_import_owner(p_batch_id);
  v_actor_id uuid := public.current_app_user_id();
  v_row public.hrm_import_staging_rows%rowtype;
  v_errors jsonb;
  v_valid integer;
  v_invalid integer;
  v_fingerprint text;
  v_required_field text;
  v_invalid_column text;
begin
  if v_batch.status in ('APPLIED','CANCELLED') then
    raise exception using errcode = '55000', message = 'HRM_IMPORT_BATCH_IMMUTABLE';
  end if;
  for v_row in
    select * from public.hrm_import_staging_rows
    where batch_id = p_batch_id order by sheet_code, row_number
  loop
    v_errors := '[]'::jsonb;
    if nullif(trim(coalesce(v_row.employee_code, '')), '') is null then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, 'employee_code', 'EMPLOYEE_CODE_REQUIRED');
    elsif not exists (
      select 1 from public.employees employee where employee.employee_code = v_row.employee_code
    ) then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, 'employee_code', 'EMPLOYEE_NOT_FOUND');
    end if;
    if v_row.domain_code = 'UNSUPPORTED' then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, 'record_type', 'RECORD_TYPE_UNSUPPORTED');
    end if;
    if v_row.record_type in (
      'ADDRESS','EMERGENCY_CONTACT','CONTRACT','EMPLOYMENT_EVENT','IDENTITY_DOCUMENT',
      'DEPENDENT','BANK_ACCOUNT','QUALIFICATION','CERTIFICATION'
    ) and nullif(trim(coalesce(v_row.record_code, '')), '') is null then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, 'record_code', 'RECORD_CODE_REQUIRED');
    end if;
    foreach v_required_field in array app_private.hrm_import_required_fields(v_row.record_type)
    loop
      if nullif(trim(coalesce(v_row.row_payload ->> v_required_field, '')), '') is null then
        v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, v_required_field, 'REQUIRED_FIELD');
      end if;
    end loop;
    if exists (
      select 1 from public.hrm_import_staging_rows duplicate_row
      where duplicate_row.batch_id = v_row.batch_id
        and duplicate_row.id <> v_row.id
        and duplicate_row.employee_code = v_row.employee_code
        and duplicate_row.record_type = v_row.record_type
        and coalesce(duplicate_row.record_code, '') = coalesce(v_row.record_code, '')
    ) then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, 'record_code', 'DUPLICATE_RECORD_CODE');
    end if;
    if v_row.row_payload ?| array[
      'tenure','currentContract','currentSalary','leaveTotal','latestPromotion',
      'tham_nien','hop_dong_hien_tai','luong_hien_tai','tong_phep','lan_thang_tien_gan_nhat'
    ] then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, '*', 'UNSUPPORTED_PROJECTION_FIELD');
    end if;
    if v_row.row_payload ?| array['hasDeposit','co_ky_quy','Có ký quỹ không?'] then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, '*', 'UNSUPPORTED_DEPOSIT_FIELD');
    end if;
    select field.key into v_invalid_column
    from jsonb_each_text(v_row.row_payload) field
    where field.key = any(array[
      'dateOfBirth','startDate','officialDate','issuedDate','expiryDate','effectiveFrom',
      'effectiveTo','eventDate','deductionFrom','deductionTo','registrationDate'
    ]) and not app_private.hrm_import_is_iso_date(field.value)
    limit 1;
    if v_invalid_column is not null then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, v_invalid_column, 'INVALID_DATE');
    end if;
    v_invalid_column := null;
    select field.key into v_invalid_column
    from jsonb_each_text(v_row.row_payload) field
    where field.key = any(array['baseSalary','allowancePosition','allowanceOther','graduationYear'])
      and trim(field.value) <> '' and trim(field.value) !~ '^-?[0-9]+([.][0-9]+)?$'
    limit 1;
    if v_invalid_column is not null then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, v_invalid_column, 'INVALID_NUMBER');
    end if;
    v_invalid_column := null;
    select field.key into v_invalid_column
    from jsonb_each_text(v_row.row_payload) field
    where field.key = any(array['isPrimary','isPayrollAccount'])
      and lower(trim(field.value)) not in ('true','false')
    limit 1;
    if v_invalid_column is not null then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, v_invalid_column, 'INVALID_BOOLEAN');
    end if;
    v_invalid_column := null;
    if nullif(v_row.row_payload ->> 'orgUnitCode', '') is not null and not exists (
      select 1 from public.org_units unit where unit.code = v_row.row_payload ->> 'orgUnitCode'
    ) then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, 'orgUnitCode', 'MASTER_CODE_NOT_FOUND');
    end if;
    if nullif(v_row.row_payload ->> 'positionCode', '') is not null and not exists (
      select 1 from public.hrm_positions position where position.code = v_row.row_payload ->> 'positionCode'
    ) then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, 'positionCode', 'MASTER_CODE_NOT_FOUND');
    end if;
    if v_row.record_type = 'CONTRACT'
      and app_private.hrm_import_is_iso_date(v_row.row_payload ->> 'effectiveFrom')
      and app_private.hrm_import_is_iso_date(v_row.row_payload ->> 'effectiveTo')
      and exists (
        select 1 from public.hrm_labor_contracts contract
        join public.employees employee on employee.id = contract.employee_id
        where employee.employee_code = v_row.employee_code
          and contract.contract_number <> coalesce(v_row.row_payload ->> 'contractNumber', v_row.record_code)
          and daterange(contract.effective_from, coalesce(contract.effective_to, 'infinity'::date), '[]')
            && daterange(
              (v_row.row_payload ->> 'effectiveFrom')::date,
              coalesce(nullif(v_row.row_payload ->> 'effectiveTo', '')::date, 'infinity'::date), '[]'
            )
      )
    then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, 'effectiveFrom', 'EFFECTIVE_DATE_OVERLAP');
    end if;
    if v_row.domain_code = 'C4'
      and not app_private.has_hrm_template_permission(v_actor_id, 'hrm.compensation.manage')
    then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, '*', 'HRM_IMPORT_C4_MANAGE_REQUIRED');
    end if;
    if v_row.record_type = 'CONTRACT'
      and v_row.row_payload ?| array['baseSalary','allowancePosition','allowanceOther']
      and not app_private.has_hrm_template_permission(v_actor_id, 'hrm.compensation.manage')
    then
      v_errors := v_errors || app_private.hrm_import_safe_error(v_row.sheet_code, v_row.row_number, 'base_salary', 'HRM_IMPORT_C4_MANAGE_REQUIRED');
    end if;
    update public.hrm_import_staging_rows set
      validation_status = case when jsonb_array_length(v_errors) = 0 then 'VALID' else 'ERROR' end,
      validation_errors = v_errors,
      updated_at = now()
    where id = v_row.id;
  end loop;

  select count(*) filter (where validation_status = 'VALID'),
         count(*) filter (where validation_status = 'ERROR')
  into v_valid, v_invalid
  from public.hrm_import_staging_rows where batch_id = p_batch_id;
  select md5(string_agg(
    row_item.id::text || ':' || row_item.validation_status || ':' || row_item.updated_at::text,
    '|' order by row_item.sheet_code, row_item.row_number
  )) into v_fingerprint
  from public.hrm_import_staging_rows row_item where row_item.batch_id = p_batch_id;
  update public.hrm_import_batches set
    status = 'VALIDATED', valid_rows = v_valid, error_rows = v_invalid,
    fingerprint = v_fingerprint, updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'batchId', p_batch_id, 'status', 'VALIDATED', 'totalRows', v_valid + v_invalid,
    'validRows', v_valid, 'errorRows', v_invalid, 'fingerprint', v_fingerprint,
    'errors', coalesce((
      select jsonb_agg(error_item order by staged.sheet_code, staged.row_number)
      from public.hrm_import_staging_rows staged
      cross join lateral jsonb_array_elements(staged.validation_errors) error_item
      where staged.batch_id = p_batch_id and staged.validation_status = 'ERROR'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.apply_hrm_import_batch(
  p_batch_id uuid,
  p_reason text,
  p_expected_fingerprint text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.hrm_import_batches%rowtype := app_private.assert_hrm_import_owner(p_batch_id);
  v_row public.hrm_import_staging_rows%rowtype;
  v_employee public.employees%rowtype;
  v_private public.hrm_employee_private_profiles%rowtype;
  v_payload jsonb;
  v_applied integer := 0;
  v_contract_id uuid;
  v_org_unit_id uuid;
  v_position_id uuid;
begin
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-import');
  if v_batch.status = 'APPLIED' then
    return jsonb_build_object('batchId', p_batch_id, 'status', 'APPLIED', 'appliedRows', v_batch.valid_rows, 'idempotentReplay', true);
  end if;
  if v_batch.status <> 'VALIDATED' or v_batch.error_rows <> 0 then
    raise exception using errcode = '55000', message = 'HRM_IMPORT_VALIDATION_REQUIRED';
  end if;
  if v_batch.fingerprint is distinct from p_expected_fingerprint then
    raise exception using errcode = '40001', message = 'HRM_IMPORT_STALE_FINGERPRINT';
  end if;

  for v_row in
    select * from public.hrm_import_staging_rows
    where batch_id = p_batch_id and validation_status = 'VALID'
    order by sheet_code, row_number for update
  loop
    select employee.* into strict v_employee
    from public.employees employee where employee.employee_code = v_row.employee_code;
    v_payload := v_row.typed_payload;
    case v_row.record_type
      when 'EMPLOYEE_CORE' then
        perform public.update_hrm_employee_core_profile(
          v_employee.id, coalesce(nullif(v_payload ->> 'fullName', ''), v_employee.full_name),
          coalesce(v_payload ->> 'gender', v_employee.gender),
          coalesce(v_payload ->> 'phone', v_employee.phone), coalesce(v_payload ->> 'email', v_employee.email),
          coalesce(nullif(v_payload ->> 'dateOfBirth', '')::date, v_employee.date_of_birth),
          coalesce(nullif(v_payload ->> 'startDate', '')::date, v_employee.start_date),
          coalesce(nullif(v_payload ->> 'officialDate', '')::date, v_employee.official_date),
          coalesce(nullif(v_payload ->> 'status', ''), v_employee.status), v_employee.user_id,
          v_employee.area_id, v_employee.office_id, v_employee.employee_type_id,
          v_employee.work_schedule_id, coalesce(v_payload ->> 'maritalStatus', v_employee.marital_status),
          coalesce(v_payload ->> 'avatarUrl', v_employee.avatar_url), p_reason
        );
      when 'PERSONAL_CONTACT' then
        perform public.update_hrm_employee_personal_contact(
          v_employee.id, v_payload ->> 'personalPhone', v_payload ->> 'personalEmail',
          null, null, null, p_reason
        );
      when 'ADDRESS' then
        select profile.* into v_private from public.hrm_employee_private_profiles profile where profile.employee_id = v_employee.id;
        perform public.update_hrm_employee_personal_contact(
          v_employee.id, v_private.personal_phone, v_private.personal_email,
          v_row.record_code, v_payload ->> 'addressType', v_payload ->> 'addressLine', p_reason
        );
      when 'EMERGENCY_CONTACT' then
        perform public.upsert_hrm_employee_emergency_contact(
          v_employee.id, v_row.record_code, v_payload ->> 'fullName',
          v_payload ->> 'relationshipCode', v_payload ->> 'phone', v_payload ->> 'email',
          v_payload ->> 'address', coalesce((v_payload ->> 'isPrimary')::boolean, false), p_reason
        );
      when 'CONTRACT' then
        select contract.id into v_contract_id
        from public.hrm_labor_contracts contract
        where contract.employee_id = v_employee.id
          and contract.contract_number = coalesce(v_payload ->> 'contractNumber', v_row.record_code)
        order by contract.created_at desc limit 1;
        perform public.upsert_hrm_employee_contract(
          v_contract_id, v_employee.id, coalesce(v_payload ->> 'contractNumber', v_row.record_code),
          v_payload ->> 'type', coalesce(v_payload ->> 'status', 'active'),
          (v_payload ->> 'effectiveFrom')::date, nullif(v_payload ->> 'effectiveTo', '')::date,
          v_payload ->> 'signedBy', v_payload ->> 'note',
          nullif(v_payload ->> 'baseSalary', '')::numeric,
          nullif(v_payload ->> 'allowancePosition', '')::numeric,
          nullif(v_payload ->> 'allowanceOther', '')::numeric, p_reason
        );
      when 'EMPLOYMENT_EVENT' then
        select unit.id into v_org_unit_id from public.org_units unit where unit.code = v_payload ->> 'orgUnitCode';
        select position.id into v_position_id from public.hrm_positions position where position.code = v_payload ->> 'positionCode';
        perform public.upsert_hrm_employee_employment_event(
          v_employee.id, v_row.record_code, v_payload ->> 'eventTypeCode',
          (v_payload ->> 'eventDate')::date, v_org_unit_id, v_position_id, v_payload ->> 'titleSnapshot',
          v_payload ->> 'eventReason', v_payload ->> 'sourceReference', p_reason
        );
      when 'IDENTITY_DOCUMENT' then
        perform public.upsert_hrm_employee_identity_document(
          v_employee.id, v_row.record_code, v_payload ->> 'documentTypeCode',
          v_payload ->> 'documentNumber', nullif(v_payload ->> 'issuedDate', '')::date,
          v_payload ->> 'issuedPlace', nullif(v_payload ->> 'expiryDate', '')::date,
          coalesce((v_payload ->> 'isPrimary')::boolean, false), p_reason
        );
      when 'INSURANCE' then
        perform public.upsert_hrm_employee_insurance_profile(
          v_employee.id, v_payload ->> 'socialInsuranceNumber', v_payload ->> 'healthInsuranceNumber',
          v_payload ->> 'registeredClinicCode', v_payload ->> 'participationStatusCode',
          nullif(v_payload ->> 'effectiveFrom', '')::date, nullif(v_payload ->> 'effectiveTo', '')::date, p_reason
        );
      when 'DEPENDENT' then
        perform public.upsert_hrm_employee_dependent(
          v_employee.id, v_row.record_code, v_payload ->> 'fullName',
          v_payload ->> 'relationshipCode', nullif(v_payload ->> 'dateOfBirth', '')::date,
          v_payload ->> 'taxCode', nullif(v_payload ->> 'deductionFrom', '')::date,
          nullif(v_payload ->> 'deductionTo', '')::date, p_reason
        );
      when 'BANK_ACCOUNT' then
        if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.compensation.manage') then
          raise exception using errcode = '42501', message = 'HRM_IMPORT_C4_MANAGE_REQUIRED';
        end if;
        perform public.upsert_hrm_employee_bank_account(
          v_employee.id, v_row.record_code, v_payload ->> 'bankCode', v_payload ->> 'branchName',
          v_payload ->> 'accountNumber', v_payload ->> 'accountHolder',
          coalesce((v_payload ->> 'isPayrollAccount')::boolean, false), p_reason
        );
      when 'TAX_PROFILE' then
        if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.compensation.manage') then
          raise exception using errcode = '42501', message = 'HRM_IMPORT_C4_MANAGE_REQUIRED';
        end if;
        perform public.upsert_hrm_employee_tax_profile(
          v_employee.id, v_payload ->> 'taxCode', v_payload ->> 'taxResidencyCode',
          nullif(v_payload ->> 'registrationDate', '')::date, p_reason
        );
      when 'QUALIFICATION' then
        perform public.upsert_hrm_employee_qualification(
          v_employee.id, v_row.record_code, v_payload ->> 'educationLevelCode',
          v_payload ->> 'institutionName', v_payload ->> 'majorName', v_payload ->> 'degreeName',
          nullif(v_payload ->> 'graduationYear', '')::integer, nullif(v_payload ->> 'startDate', '')::date,
          nullif(v_payload ->> 'endDate', '')::date, p_reason
        );
      when 'CERTIFICATION' then
        perform public.upsert_hrm_employee_certification(
          v_employee.id, v_row.record_code, v_payload ->> 'certificationTypeCode',
          v_payload ->> 'certificationName', v_payload ->> 'certificateNumber',
          v_payload ->> 'issuerName', nullif(v_payload ->> 'issuedDate', '')::date,
          nullif(v_payload ->> 'expiryDate', '')::date, p_reason
        );
      else
        raise exception using errcode = '22023', message = 'HRM_IMPORT_RECORD_TYPE_UNSUPPORTED';
    end case;
    update public.hrm_import_staging_rows set validation_status = 'APPLIED', updated_at = now() where id = v_row.id;
    v_applied := v_applied + 1;
  end loop;
  update public.hrm_import_batches set status = 'APPLIED', applied_at = now(), updated_at = now()
  where id = p_batch_id;
  perform app_private.audit_hrm_profile_command(
    public.current_app_user_id(), 'HRM_PROFILE_IMPORT', p_batch_id::text, 'INSERT', p_reason,
    array['batch_id','source_file_hash','manifest','applied_rows']
  );
  return jsonb_build_object('batchId', p_batch_id, 'status', 'APPLIED', 'appliedRows', v_applied, 'idempotentReplay', false);
end;
$$;

create or replace function public.export_hrm_employee_profiles(
  p_employee_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_employee_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.export')
    or not app_private.has_hrm_template_permission(v_actor_id, 'hrm.compensation.manage')
  then raise exception using errcode = '42501', message = 'HRM_EMPLOYEE_EXPORT_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-export');
  if cardinality(p_employee_ids) is null or cardinality(p_employee_ids) = 0 or cardinality(p_employee_ids) > 1000 then
    raise exception using errcode = '22023', message = 'HRM_EXPORT_EMPLOYEE_SELECTION_INVALID';
  end if;
  foreach v_employee_id in array p_employee_ids
  loop
    v_rows := v_rows || jsonb_build_object(
      'overview', app_private.get_hrm_employee_overview(v_employee_id),
      'personalContact', app_private.get_hrm_employee_personal_contact(v_employee_id),
      'workOrganization', app_private.get_hrm_employee_work_organization(v_employee_id),
      'attendanceLeave', app_private.get_hrm_employee_attendance_leave(v_employee_id),
      'contractsEmployment', app_private.get_hrm_employee_contract_employment(v_employee_id),
      'legalInsurance', app_private.get_hrm_employee_legal_insurance(v_employee_id),
      'compensationTaxBank', app_private.get_hrm_employee_compensation_tax_bank(v_employee_id),
      'qualificationsDocuments', app_private.get_hrm_employee_qualifications_documents(v_employee_id)
    );
    perform app_private.audit_hrm_profile_command(
      v_employee_id, 'HRM_PROFILE_EXPORT', v_employee_id::text, 'INSERT', p_reason,
      array['C1','C2','C3','C4']
    );
  end loop;
  v_result := jsonb_build_object(
    'manifestVersion', 1, 'generatedAt', now(), 'exportedBy', v_actor_id,
    'watermark', 'VIOO HRM - Dữ liệu mật - ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS OF'),
    'reason', p_reason, 'employeeCount', cardinality(p_employee_ids), 'employees', v_rows
  );
  return v_result || jsonb_build_object('manifestHash', md5(v_result::text));
end;
$$;

create or replace function app_private.cleanup_expired_hrm_import_batches()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  delete from storage.objects object_row
  using public.hrm_import_batches batch
  where batch.expires_at < now()
    and object_row.bucket_id = 'hrm-private-imports'
    and object_row.name = batch.source_file_path;
  delete from public.hrm_import_batches where expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'cleanup-expired-hrm-imports') then
    perform cron.schedule(
      'cleanup-expired-hrm-imports',
      '17 2 * * *',
      'select app_private.cleanup_expired_hrm_import_batches()'
    );
  end if;
end;
$$;

revoke all on function app_private.hrm_import_domain_for_type(text) from public,anon,authenticated;
revoke all on function app_private.hrm_import_safe_error(text,integer,text,text) from public,anon,authenticated;
revoke all on function app_private.hrm_import_is_iso_date(text) from public,anon,authenticated;
revoke all on function app_private.hrm_import_required_fields(text) from public,anon,authenticated;
revoke all on function app_private.assert_hrm_import_owner(uuid) from public,anon,authenticated;
revoke all on function app_private.cleanup_expired_hrm_import_batches() from public,anon,authenticated;
grant execute on function app_private.cleanup_expired_hrm_import_batches() to service_role;
revoke all on function public.create_hrm_import_batch(text,text,jsonb) from public,anon;
revoke all on function public.stage_hrm_import_rows(uuid,jsonb) from public,anon;
revoke all on function public.preview_hrm_import_batch(uuid) from public,anon;
revoke all on function public.apply_hrm_import_batch(uuid,text,text) from public,anon;
revoke all on function public.export_hrm_employee_profiles(uuid[],text) from public,anon;
grant execute on function public.create_hrm_import_batch(text,text,jsonb) to authenticated,service_role;
grant execute on function public.stage_hrm_import_rows(uuid,jsonb) to authenticated,service_role;
grant execute on function public.preview_hrm_import_batch(uuid) to authenticated,service_role;
grant execute on function public.apply_hrm_import_batch(uuid,text,text) to authenticated,service_role;
grant execute on function public.export_hrm_employee_profiles(uuid[],text) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;

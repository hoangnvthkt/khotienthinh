-- HRM G3b — profile lifecycle (docs/audits/hrm-attendance-leave-2026-10-02 §6.3, 02/10/2026):
--   * Employees send "Đề nghị cập nhật" (address, ID document, insurance, dependant, bank, tax,
--     qualification, certificate) with photos; HR approves and the change goes through the existing
--     audited profile commands, so the approver needs the same rights as a direct edit.
--   * Addresses follow the two-tier local government (province + ward, no district) since 01/07/2025.
--   * HR reminders: contracts, ID documents and certificates expiring, probation ending; daily notice
--     30 / 7 / 0 days before.
--   * Direct manager: one resolver (org chart → designated manager on the account). Employees placed
--     on a unit but not on a position slot report to that unit's head. HR sees who approves whom and
--     designates a manager for the rest.

-- ── 1. Two-tier addresses ──────────────────────────────────────────────────
alter table public.hrm_employee_addresses add column if not exists ward_name text;

create or replace function public.upsert_hrm_employee_address(
  p_employee_id uuid, p_record_code text, p_address_type text, p_province_code text,
  p_ward_name text, p_address_line text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_actor_id uuid := public.current_app_user_id();
begin
  perform app_private.assert_hrm_profile_section_access(p_employee_id, array['HR','HR_MANAGE']);
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  if coalesce(p_address_type, '') not in ('PERMANENT','CURRENT','CONTACT')
    or length(trim(coalesce(p_record_code, ''))) = 0
    or length(trim(coalesce(p_province_code, ''))) = 0
    or length(trim(coalesce(p_ward_name, ''))) = 0
    or length(trim(coalesce(p_address_line, ''))) = 0
  then
    raise exception using errcode = '22023', message = 'HRM_ADDRESS_INPUT_INVALID';
  end if;

  -- One address per type: the new one replaces the previous record of that type.
  update public.hrm_employee_addresses
  set status = 'INACTIVE', effective_to = greatest(effective_from, current_date - 1),
      updated_by = v_actor_id, updated_at = now()
  where employee_id = p_employee_id and address_type = p_address_type
    and status = 'ACTIVE' and record_code <> trim(p_record_code);

  insert into public.hrm_employee_addresses(
    employee_id, record_code, address_type, address_line, ward_name, ward_code, district_code,
    province_code, created_by, updated_by
  ) values (
    p_employee_id, trim(p_record_code), p_address_type, trim(p_address_line), trim(p_ward_name),
    null, null, trim(p_province_code), v_actor_id, v_actor_id
  ) on conflict (employee_id, record_code) do update set
    address_type = excluded.address_type, address_line = excluded.address_line,
    ward_name = excluded.ward_name, ward_code = null, district_code = null,
    province_code = excluded.province_code, status = 'ACTIVE', effective_to = null,
    updated_by = v_actor_id, updated_at = now();

  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_ADDRESS', trim(p_record_code), 'UPSERT', p_reason,
    array['address_type','address_line','ward_name','province_code']
  );
  return app_private.get_hrm_employee_personal_contact(p_employee_id);
end;
$function$;
revoke all on function public.upsert_hrm_employee_address(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.upsert_hrm_employee_address(uuid, text, text, text, text, text, text) to authenticated;

create or replace function app_private.get_hrm_employee_personal_contact(p_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
        'addressLine', address.address_line, 'wardName', address.ward_name,
        'provinceCode', address.province_code
      ) order by array_position(array['PERMANENT','CURRENT','CONTACT'], address.address_type), address.record_code)
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
$function$;

-- ── 2. Profile change requests ─────────────────────────────────────────────
create table if not exists public.hrm_profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  kind text not null check (kind in (
    'address','identity','insurance','dependent','bank','tax','qualification','certification','other'
  )),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 4000),
  note text check (note is null or length(note) <= 1000),
  attachment_paths text[] not null default '{}' check (cardinality(attachment_paths) <= 4),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hrm_profile_change_requests_employee_idx
  on public.hrm_profile_change_requests (employee_id, created_at desc);
create index if not exists hrm_profile_change_requests_pending_idx
  on public.hrm_profile_change_requests (created_at) where status = 'pending';
alter table public.hrm_profile_change_requests enable row level security;
revoke all on public.hrm_profile_change_requests from anon, authenticated;
-- No table policies: everything goes through the RPCs below.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hrm-profile-evidence', 'hrm-profile-evidence', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists hrm_profile_evidence_insert on storage.objects;
create policy hrm_profile_evidence_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'hrm-profile-evidence'
    and app_private.hrm_employee_is_current_user(split_part(name, '/', 1))
  );
drop policy if exists hrm_profile_evidence_select on storage.objects;
create policy hrm_profile_evidence_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'hrm-profile-evidence'
    and (
      app_private.hrm_employee_is_current_user(split_part(name, '/', 1))
      or app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive')
    )
  );

create or replace function app_private.hrm_current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select employee.id from public.employees employee
  where employee.user_id = public.current_app_user_id() and employee.status = 'Đang làm việc'
  order by employee.created_at limit 1;
$function$;
revoke all on function app_private.hrm_current_employee_id() from public, anon, authenticated;

create or replace function app_private.notify_hrm_profile(
  p_user_ids uuid[], p_title text, p_body text, p_link text, p_entity_id uuid, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.notifications (
    user_id, title, body, type, priority, module, link, metadata, category, message, severity,
    source_type, source_id, push_enabled, action_url, entity_type, entity_id, delivery_reason
  )
  select distinct recipient::text, p_title, p_body, 'info', 'normal', 'HRM', p_link,
    jsonb_build_object('entityId', p_entity_id), 'hrm_profile', p_body, 'info', 'hrm_profile',
    p_entity_id::text, true, p_link, 'hrm_profile', p_entity_id, p_reason
  from unnest(p_user_ids) recipient
  where recipient is not null;
end;
$function$;
revoke all on function app_private.notify_hrm_profile(uuid[], text, text, text, uuid, text) from public, anon, authenticated;

create or replace function app_private.hrm_profile_change_kind_label(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case p_kind
    when 'address' then 'Địa chỉ' when 'identity' then 'Giấy tờ định danh'
    when 'insurance' then 'Bảo hiểm' when 'dependent' then 'Người phụ thuộc'
    when 'bank' then 'Tài khoản nhận lương' when 'tax' then 'Thông tin thuế'
    when 'qualification' then 'Trình độ' when 'certification' then 'Chứng chỉ'
    else 'Thông tin khác' end;
$function$;

create or replace function public.submit_my_hrm_profile_change(
  p_kind text, p_payload jsonb, p_note text default null, p_attachment_paths text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_employee_id uuid := app_private.hrm_current_employee_id();
  v_name text;
  v_id uuid;
  v_path text;
begin
  if v_employee_id is null then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_CHANGE_NO_EMPLOYEE';
  end if;
  if p_kind = 'other' and length(trim(coalesce(p_note, ''))) < 5 then
    raise exception using errcode = '22023', message = 'HRM_PROFILE_CHANGE_NOTE_REQUIRED';
  end if;
  if p_kind <> 'other' and (p_payload is null or p_payload = '{}'::jsonb) then
    raise exception using errcode = '22023', message = 'HRM_PROFILE_CHANGE_EMPTY';
  end if;
  foreach v_path in array coalesce(p_attachment_paths, '{}') loop
    if split_part(v_path, '/', 1) <> v_employee_id::text then
      raise exception using errcode = '42501', message = 'HRM_PROFILE_CHANGE_ATTACHMENT_FORBIDDEN';
    end if;
  end loop;
  if (select count(*) from public.hrm_profile_change_requests
      where employee_id = v_employee_id and status = 'pending') >= 10 then
    raise exception using errcode = '22023', message = 'HRM_PROFILE_CHANGE_TOO_MANY_PENDING';
  end if;

  insert into public.hrm_profile_change_requests (employee_id, requested_by, kind, payload, note, attachment_paths)
  values (v_employee_id, v_actor, p_kind, coalesce(p_payload, '{}'::jsonb),
          nullif(trim(coalesce(p_note, '')), ''), coalesce(p_attachment_paths, '{}'))
  returning id into v_id;

  select full_name into v_name from public.employees where id = v_employee_id;
  perform app_private.notify_hrm_profile(
    array_remove(app_private.hrm_leave_hr_user_ids(), v_actor),
    'Đề nghị cập nhật hồ sơ',
    v_name || ' đề nghị cập nhật ' || lower(app_private.hrm_profile_change_kind_label(p_kind)) || '.',
    '/hrm/employees?work=changes', v_id, 'assigned'
  );
  return v_id;
end;
$function$;
revoke all on function public.submit_my_hrm_profile_change(text, jsonb, text, text[]) from public, anon;
grant execute on function public.submit_my_hrm_profile_change(text, jsonb, text, text[]) to authenticated;

create or replace function public.cancel_my_hrm_profile_change(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.hrm_profile_change_requests
  set status = 'cancelled', updated_at = now()
  where id = p_id and status = 'pending' and employee_id = app_private.hrm_current_employee_id();
  if not found then
    raise exception using errcode = '22023', message = 'HRM_PROFILE_CHANGE_NOT_PENDING';
  end if;
end;
$function$;
revoke all on function public.cancel_my_hrm_profile_change(uuid) from public, anon;
grant execute on function public.cancel_my_hrm_profile_change(uuid) to authenticated;

create or replace function app_private.hrm_profile_change_json(p_request public.hrm_profile_change_requests)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p_request.id, 'employeeId', p_request.employee_id, 'kind', p_request.kind,
    'kindLabel', app_private.hrm_profile_change_kind_label(p_request.kind),
    'payload', p_request.payload, 'note', p_request.note,
    'attachmentPaths', to_jsonb(p_request.attachment_paths), 'status', p_request.status,
    'createdAt', p_request.created_at, 'decidedAt', p_request.decided_at,
    'decisionNote', p_request.decision_note,
    'decidedByName', (select coalesce(nullif(u.name, ''), u.email) from public.users u where u.id = p_request.decided_by),
    'employeeCode', employee.employee_code, 'fullName', employee.full_name,
    'orgUnitName', org.name,
    -- Pay data needs HR Manage (same rule as a direct edit).
    'needsCompensationManager', p_request.kind in ('bank','tax')
  )
  from public.employees employee
  left join public.org_units org on org.id = employee.org_unit_id
  where employee.id = p_request.employee_id;
$function$;
revoke all on function app_private.hrm_profile_change_json(public.hrm_profile_change_requests) from public, anon, authenticated;

create or replace function public.list_my_hrm_profile_changes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(app_private.hrm_profile_change_json(request) order by request.created_at desc), '[]'::jsonb)
  from public.hrm_profile_change_requests request
  where request.id in (
    select recent.id from public.hrm_profile_change_requests recent
    where recent.employee_id = app_private.hrm_current_employee_id()
    order by recent.created_at desc limit 30
  );
$function$;
revoke all on function public.list_my_hrm_profile_changes() from public, anon;
grant execute on function public.list_my_hrm_profile_changes() to authenticated;

create or replace function public.list_hrm_profile_change_requests(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_CHANGE_HR_ONLY';
  end if;
  return coalesce((
    select jsonb_agg(app_private.hrm_profile_change_json(request) order by
      case when request.status = 'pending' then request.created_at end asc,
      request.decided_at desc)
    from public.hrm_profile_change_requests request
    where request.id in (
      select recent.id from public.hrm_profile_change_requests recent
      where (p_status = 'pending' and recent.status = 'pending')
         or (p_status <> 'pending' and recent.status <> 'pending')
      order by coalesce(recent.decided_at, recent.created_at) desc limit 100
    )
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_hrm_profile_change_requests(text) from public, anon;
grant execute on function public.list_hrm_profile_change_requests(text) to authenticated;

-- Writes an approved request through the same audited command HR would use by hand.
create or replace function app_private.apply_hrm_profile_change(
  p_request public.hrm_profile_change_requests, p_payload jsonb, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_code text := upper(p_request.kind) || '-' || upper(left(replace(p_request.id::text, '-', ''), 8));
  v_emp uuid := p_request.employee_id;
  v_text jsonb := p_payload;
  v_insurance public.hrm_employee_insurance_profiles%rowtype;
  v_tax public.hrm_employee_tax_profiles%rowtype;
begin
  case p_request.kind
    when 'address' then
      perform public.upsert_hrm_employee_address(v_emp, v_code, v_text ->> 'addressType',
        v_text ->> 'provinceCode', v_text ->> 'wardName', v_text ->> 'addressLine', p_reason);
    when 'identity' then
      perform public.upsert_hrm_employee_identity_document(v_emp, v_code,
        v_text ->> 'documentTypeCode', v_text ->> 'documentNumber',
        nullif(v_text ->> 'issuedDate', '')::date, nullif(v_text ->> 'issuedPlace', ''),
        nullif(v_text ->> 'expiryDate', '')::date, coalesce((v_text ->> 'isPrimary')::boolean, true), p_reason);
    when 'insurance' then
      -- One profile per person: keep current values the employee did not change.
      select * into v_insurance from public.hrm_employee_insurance_profiles where employee_id = v_emp;
      perform public.upsert_hrm_employee_insurance_profile(v_emp,
        coalesce(nullif(v_text ->> 'socialInsuranceNumber', ''), v_insurance.social_insurance_number),
        coalesce(nullif(v_text ->> 'healthInsuranceNumber', ''), v_insurance.health_insurance_number),
        coalesce(nullif(v_text ->> 'registeredClinicCode', ''), v_insurance.registered_clinic_code),
        coalesce(nullif(v_text ->> 'participationStatusCode', ''), v_insurance.participation_status_code),
        coalesce(nullif(v_text ->> 'effectiveFrom', '')::date, v_insurance.effective_from),
        coalesce(nullif(v_text ->> 'effectiveTo', '')::date, v_insurance.effective_to), p_reason);
    when 'dependent' then
      perform public.upsert_hrm_employee_dependent(v_emp, v_code, v_text ->> 'fullName',
        v_text ->> 'relationshipCode', nullif(v_text ->> 'dateOfBirth', '')::date,
        nullif(v_text ->> 'taxCode', ''), nullif(v_text ->> 'deductionFrom', '')::date,
        nullif(v_text ->> 'deductionTo', '')::date, p_reason);
    when 'bank' then
      perform public.upsert_hrm_employee_bank_account(v_emp, v_code, v_text ->> 'bankCode',
        nullif(v_text ->> 'branchName', ''), v_text ->> 'accountNumber', v_text ->> 'accountHolder',
        coalesce((v_text ->> 'isPayrollAccount')::boolean, true), p_reason);
    when 'tax' then
      select * into v_tax from public.hrm_employee_tax_profiles where employee_id = v_emp;
      perform public.upsert_hrm_employee_tax_profile(v_emp,
        coalesce(nullif(v_text ->> 'taxCode', ''), v_tax.tax_code),
        coalesce(nullif(v_text ->> 'taxResidencyCode', ''), v_tax.tax_residency_code),
        coalesce(nullif(v_text ->> 'registrationDate', '')::date, v_tax.registration_date), p_reason);
    when 'qualification' then
      perform public.upsert_hrm_employee_qualification(v_emp, v_code,
        nullif(v_text ->> 'educationLevelCode', ''), v_text ->> 'institutionName',
        nullif(v_text ->> 'majorName', ''), nullif(v_text ->> 'degreeName', ''),
        nullif(v_text ->> 'graduationYear', '')::integer, null, null, p_reason);
    when 'certification' then
      perform public.upsert_hrm_employee_certification(v_emp, v_code,
        nullif(v_text ->> 'certificationTypeCode', ''), v_text ->> 'certificationName',
        nullif(v_text ->> 'certificateNumber', ''), nullif(v_text ->> 'issuerName', ''),
        nullif(v_text ->> 'issuedDate', '')::date, nullif(v_text ->> 'expiryDate', '')::date, p_reason);
    else
      null; -- 'other': HR updates the record by hand, approval only closes the request.
  end case;
end;
$function$;
revoke all on function app_private.apply_hrm_profile_change(public.hrm_profile_change_requests, jsonb, text) from public, anon, authenticated;

create or replace function public.decide_hrm_profile_change(
  p_id uuid, p_approve boolean, p_note text default null, p_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.hrm_profile_change_requests%rowtype;
  v_payload jsonb;
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_CHANGE_HR_ONLY';
  end if;
  select * into v_request from public.hrm_profile_change_requests where id = p_id for update;
  if v_request.id is null or v_request.status <> 'pending' then
    raise exception using errcode = '22023', message = 'HRM_PROFILE_CHANGE_NOT_PENDING';
  end if;
  if v_request.employee_id = app_private.hrm_current_employee_id() then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_CHANGE_SELF_DECISION';
  end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 5 then
    raise exception using errcode = '22023', message = 'HRM_PROFILE_CHANGE_REJECT_REASON_REQUIRED';
  end if;

  -- HR may correct a typo before approving; the stored payload then shows what was written.
  v_payload := coalesce(p_payload, v_request.payload);
  if jsonb_typeof(v_payload) <> 'object' or length(v_payload::text) > 4000 then
    raise exception using errcode = '22023', message = 'HRM_PROFILE_CHANGE_EMPTY';
  end if;
  if p_approve then
    perform app_private.apply_hrm_profile_change(v_request, v_payload,
      'Duyệt đề nghị cập nhật hồ sơ của nhân viên' || coalesce(': ' || nullif(trim(p_note), ''), ''));
  end if;

  update public.hrm_profile_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      payload = v_payload, decided_by = v_actor, decided_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  where id = p_id
  returning * into v_request;

  perform app_private.notify_hrm_profile(
    array[v_request.requested_by],
    case when p_approve then 'Hồ sơ đã được cập nhật' else 'Đề nghị cập nhật bị từ chối' end,
    app_private.hrm_profile_change_kind_label(v_request.kind)
      || case when p_approve then ': HR đã duyệt và cập nhật vào hồ sơ.' else ': ' || trim(p_note) end,
    '/ep/' || v_request.employee_id, v_request.id, 'system'
  );
  return app_private.hrm_profile_change_json(v_request);
end;
$function$;
revoke all on function public.decide_hrm_profile_change(uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.decide_hrm_profile_change(uuid, boolean, text, jsonb) to authenticated;

-- ── 3. HR reminders ────────────────────────────────────────────────────────
create or replace function app_private.hrm_hr_reminder_items(p_days integer)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with active_employee as (
    select employee.id, employee.employee_code, employee.full_name, employee.official_date, org.name as org_unit_name
    from public.employees employee
    left join public.org_units org on org.id = employee.org_unit_id
    where employee.status = 'Đang làm việc'
  ), items as (
    select 'contract' as kind, contract.id::text as record_id, contract.employee_id,
      'Hợp đồng ' || coalesce(nullif(contract.contract_number, ''), 'lao động') as label, contract.effective_to as due_date
    from public.hrm_labor_contracts contract
    where contract.status = 'active' and contract.effective_to is not null
      and contract.effective_to between current_date - 60 and current_date + p_days
      -- Already renewed: a later contract exists.
      and not exists (
        select 1 from public.hrm_labor_contracts next_contract
        where next_contract.employee_id = contract.employee_id and next_contract.id <> contract.id
          and next_contract.status = 'active' and next_contract.effective_from > contract.effective_from
      )
    union all
    select 'identity', document.id::text, document.employee_id,
      case document.document_type_code when 'CCCD' then 'Căn cước / CCCD' when 'CMND' then 'CMND'
        when 'HO_CHIEU' then 'Hộ chiếu' when 'GPLD' then 'Giấy phép lao động' else 'Giấy tờ định danh' end,
      document.expiry_date
    from public.hrm_employee_identity_documents document
    where document.status = 'ACTIVE' and document.expiry_date between current_date - 365 and current_date + p_days
    union all
    select 'certification', certificate.id::text, certificate.employee_id, certificate.certification_name, certificate.expiry_date
    from public.hrm_employee_certifications certificate
    where certificate.status = 'ACTIVE' and certificate.expiry_date between current_date - 365 and current_date + p_days
    union all
    select 'probation', employee.id::text, employee.id, 'Hết thử việc, lên chính thức', employee.official_date
    from active_employee employee
    where employee.official_date between current_date and current_date + p_days
  )
  select jsonb_build_object(
    'kind', items.kind, 'recordId', items.record_id, 'employeeId', items.employee_id,
    'employeeCode', employee.employee_code, 'fullName', employee.full_name,
    'orgUnitName', employee.org_unit_name, 'label', items.label,
    'dueDate', items.due_date, 'daysLeft', items.due_date - current_date
  )
  from items join active_employee employee on employee.id = items.employee_id
  order by items.due_date, employee.full_name;
$function$;
revoke all on function app_private.hrm_hr_reminder_items(integer) from public, anon, authenticated;

create or replace function public.list_hrm_hr_reminders(p_days integer default 45)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'HRM_REMINDERS_HR_ONLY';
  end if;
  return coalesce((select jsonb_agg(item) from app_private.hrm_hr_reminder_items(least(greatest(p_days, 1), 180)) item), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_hrm_hr_reminders(integer) from public, anon;
grant execute on function public.list_hrm_hr_reminders(integer) to authenticated;

-- Daily at 07:30 Vietnam time: HR hears about items 30 / 7 / 0 days out; employees about their own
-- ID documents and certificates.
create or replace function app_private.notify_hrm_hr_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_count integer := 0;
  v_hr uuid[] := app_private.hrm_leave_hr_user_ids();
  v_owner uuid;
  v_when text;
  v_title text;
begin
  for v_item in select item from app_private.hrm_hr_reminder_items(30) item
    where (item ->> 'daysLeft')::integer in (30, 7, 0)
  loop
    v_when := case when (v_item ->> 'daysLeft')::integer = 0 then 'hết hạn hôm nay'
      else 'còn ' || (v_item ->> 'daysLeft') || ' ngày' end;
    v_title := case v_item ->> 'kind' when 'contract' then 'Hợp đồng sắp hết hạn'
      when 'probation' then 'Sắp hết thử việc' when 'identity' then 'Giấy tờ sắp hết hạn'
      else 'Chứng chỉ sắp hết hạn' end;
    perform app_private.notify_hrm_profile(v_hr, v_title,
      (v_item ->> 'fullName') || ' · ' || (v_item ->> 'label') || ' · ' || v_when || '.',
      '/hrm/employees?work=reminders', (v_item ->> 'employeeId')::uuid, 'system');
    if v_item ->> 'kind' in ('identity','certification') then
      select employee.user_id into v_owner from public.employees employee where employee.id = (v_item ->> 'employeeId')::uuid;
      perform app_private.notify_hrm_profile(array[v_owner], v_title,
        (v_item ->> 'label') || ' của bạn ' || v_when || '. Gửi bản mới cho HR qua "Đề nghị cập nhật".',
        '/ep/' || (v_item ->> 'employeeId'), (v_item ->> 'employeeId')::uuid, 'system');
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function app_private.notify_hrm_hr_reminders() from public, anon, authenticated;

do $cron$
begin
  perform cron.unschedule('hrm-hr-reminders') where exists (select 1 from cron.job where jobname = 'hrm-hr-reminders');
  perform cron.schedule('hrm-hr-reminders', '30 0 * * *', 'select app_private.notify_hrm_hr_reminders();');
end;
$cron$;

-- ── 4. Direct manager: one resolver ────────────────────────────────────────
-- Org chart first: the position slot's manager; employees placed on a unit without a slot report to
-- that unit's head (no climbing, so an empty head never silently routes to the CEO). Then the
-- manager designated on the account (users.manager_id). Used by Requests, leave and the HR list.
create or replace function app_private.resolve_slot_direct_manager(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_employee_id uuid;
  v_employee_unit_id uuid;
  v_slot_id uuid;
  v_unit_id uuid;
  v_target_slot_id uuid;
  v_manager_user_id uuid;
begin
  select employee.id, employee.org_unit_id
  into v_employee_id, v_employee_unit_id
  from public.employees employee
  where employee.user_id = p_user_id
    and employee.status = 'Đang làm việc'
  limit 1;

  if v_employee_id is null then
    return null;
  end if;

  select slot.id, slot.org_unit_id,
         coalesce(
           slot.reports_to_slot_id,
           case when org.manager_slot_id is distinct from slot.id then org.manager_slot_id end
         )
  into v_slot_id, v_unit_id, v_target_slot_id
  from public.hrm_employee_slot_assignments assignment
  join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
  join public.org_units org on org.id = slot.org_unit_id
  where assignment.employee_id = v_employee_id
    and assignment.assignment_type = 'PRIMARY'
    and assignment.status = 'ACTIVE'
    and assignment.effective_from <= current_date
    and (assignment.effective_to is null or assignment.effective_to >= current_date)
    and slot.status = 'ACTIVE'
  order by assignment.effective_from desc
  limit 1;

  if v_slot_id is null then
    -- On a unit but not on a slot: that unit's head.
    select org.manager_slot_id into v_target_slot_id
    from public.org_units org where org.id = v_employee_unit_id;
  elsif v_target_slot_id is null then
    with recursive ancestor_units as (
      select parent.id, parent.parent_id, parent.manager_slot_id, 1 as depth
      from public.org_units child
      join public.org_units parent on parent.id = child.parent_id
      where child.id = v_unit_id
      union all
      select parent.id, parent.parent_id, parent.manager_slot_id, ancestor.depth + 1
      from ancestor_units ancestor
      join public.org_units parent on parent.id = ancestor.parent_id
    )
    select manager_slot_id
    into v_target_slot_id
    from ancestor_units
    where manager_slot_id is not null
      and manager_slot_id <> v_slot_id
    order by depth
    limit 1;
  end if;

  if v_target_slot_id is null then
    return null;
  end if;

  select manager_user.id
  into v_manager_user_id
  from public.hrm_employee_slot_assignments assignment
  join public.employees manager_employee on manager_employee.id = assignment.employee_id
  join public.users manager_user on manager_user.id = manager_employee.user_id
  where assignment.slot_id = v_target_slot_id
    and assignment.assignment_type in ('PRIMARY', 'ACTING')
    and assignment.status = 'ACTIVE'
    and assignment.effective_from <= current_date
    and (assignment.effective_to is null or assignment.effective_to >= current_date)
    and manager_user.id <> p_user_id
    and coalesce(manager_user.is_active, true)
    and coalesce(manager_user.account_status, 'ACTIVE') = 'ACTIVE'
  order by case assignment.assignment_type when 'ACTING' then 0 else 1 end,
           assignment.effective_from desc
  limit 1;

  return v_manager_user_id;
end;
$function$;

create or replace function public.list_hrm_direct_managers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'HRM_DIRECT_MANAGER_HR_ONLY';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employeeId', row_data.id, 'employeeCode', row_data.employee_code, 'fullName', row_data.full_name,
      'orgUnitName', row_data.org_unit_name, 'positionName', row_data.position_name,
      'hasAccount', row_data.user_id is not null,
      'managerUserId', coalesce(row_data.chart_manager, row_data.designated_manager),
      'managerName', (select coalesce(nullif(u.name, ''), u.email) from public.users u
                      where u.id = coalesce(row_data.chart_manager, row_data.designated_manager)),
      'source', case when row_data.chart_manager is not null then 'org_chart'
                     when row_data.designated_manager is not null then 'designated' else 'none' end,
      'designatedManagerUserId', row_data.designated_manager,
      'leaveApproverName', (select coalesce(nullif(u.name, ''), u.email) from public.users u
                            where u.id = (row_data.chain -> 0 ->> 'userId')::uuid),
      'leaveApproverLabel', row_data.chain -> 0 ->> 'label'
    ) order by (coalesce(row_data.chart_manager, row_data.designated_manager) is not null), row_data.org_unit_name nulls first, row_data.full_name)
    from (
      select employee.id, employee.employee_code, employee.full_name, employee.user_id,
        org.name as org_unit_name, position.name as position_name,
        app_private.resolve_slot_direct_manager(employee.user_id) as chart_manager,
        (select manager.id from public.users account join public.users manager on manager.id = account.manager_id
         where account.id = employee.user_id and manager.id <> account.id
           and coalesce(manager.is_active, true) and coalesce(manager.account_status, 'ACTIVE') = 'ACTIVE') as designated_manager,
        app_private.hrm_leave_approval_chain(employee.id, 'annual', 1) as chain
      from public.employees employee
      left join public.org_units org on org.id = employee.org_unit_id
      left join public.hrm_positions position on position.id = employee.position_id
      where employee.status = 'Đang làm việc'
    ) row_data
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_hrm_direct_managers() from public, anon;
grant execute on function public.list_hrm_direct_managers() to authenticated;

create or replace function public.set_hrm_designated_manager(p_employee_id uuid, p_manager_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'HRM_DIRECT_MANAGER_HR_ONLY';
  end if;
  -- HR level only: nobody designates their own manager.
  perform app_private.assert_hrm_profile_section_access(p_employee_id, array['HR','HR_MANAGE']);
  perform app_private.assert_hrm_mutation_context(p_reason, 'direct-manager');
  select user_id into v_user_id from public.employees where id = p_employee_id;
  if v_user_id is null then
    raise exception using errcode = '22023', message = 'HRM_DIRECT_MANAGER_NO_ACCOUNT';
  end if;
  if p_manager_user_id is not null and (
    p_manager_user_id = v_user_id
    or not exists (select 1 from public.users manager where manager.id = p_manager_user_id
                   and coalesce(manager.is_active, true) and coalesce(manager.account_status, 'ACTIVE') = 'ACTIVE')
    or exists (select 1 from public.users manager where manager.id = p_manager_user_id and manager.manager_id = v_user_id)
  ) then
    raise exception using errcode = '22023', message = 'HRM_DIRECT_MANAGER_INVALID';
  end if;
  update public.users set manager_id = p_manager_user_id where id = v_user_id;
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_DIRECT_MANAGER', p_employee_id::text, 'UPDATE', p_reason, array['manager_id']
  );
end;
$function$;
revoke all on function public.set_hrm_designated_manager(uuid, uuid, text) from public, anon;
grant execute on function public.set_hrm_designated_manager(uuid, uuid, text) to authenticated;

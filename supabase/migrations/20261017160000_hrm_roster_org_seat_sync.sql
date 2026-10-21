-- Sơ đồ tổ chức theo Bảng nhân sự (16/10/2026). Chủ SP chốt:
--   * Bảng nhân sự là gốc: mỗi người đang làm ngồi một ghế (hrm_org_position_slots) đúng bộ phận + chức danh của mình.
--     Có ghế trống đúng bộ phận + chức danh thì dùng, không có thì tạo ghế mới theo người thực tế (nguồn roster_sync).
--   * Lần đầu xếp từ 01/10/2026 (người vào sau thì từ ngày vào). Về sau, phiếu đổi bộ phận / chức danh được duyệt
--     thì tự chuyển ghế từ ngày hiệu lực của phiếu; ghế cũ thành ghế trống.
--   * Trưởng đơn vị: tự đặt cho TKĐT, TCKT, TTTH, XINHAI theo chức danh trưởng; đơn vị khác HR chọn.
--   * Ghế trống tự tạo từ dữ liệu cũ (employee_backfill) được lưu trữ; ghế HR lập định biên giữ làm chỗ chưa tuyển.
--     Ghế đang là ghế trưởng đơn vị không lưu trữ; ghế nào báo cáo lên ghế bị lưu trữ thì về báo cáo trưởng đơn vị.

-- ── 1. Xếp ghế một người ────────────────────────────────────────────────────
-- Returns the seat the person sits on from p_effective, or null when they cannot be seated
-- (not working, no unit or position, position inactive).
create or replace function app_private.hrm_roster_sync_seat(p_employee_id uuid, p_effective date, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_emp public.employees%rowtype;
  v_unit public.org_units%rowtype;
  v_position public.hrm_positions%rowtype;
  v_current record;
  v_slot_id uuid;
  v_assignment_id uuid;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if p_effective is null or v_emp.id is null or v_emp.status <> 'Đang làm việc' or v_emp.org_unit_id is null or v_emp.position_id is null then
    return null;
  end if;
  select * into v_unit from public.org_units where id = v_emp.org_unit_id;
  select * into v_position from public.hrm_positions where id = v_emp.position_id and is_active;
  if v_unit.id is null or v_position.id is null then
    return null;
  end if;

  select assignment.id, assignment.effective_from, slot.id as slot_id, slot.org_unit_id, slot.position_id into v_current
  from public.hrm_employee_slot_assignments assignment
  join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
  where assignment.employee_id = p_employee_id and assignment.status = 'ACTIVE' and assignment.assignment_type = 'PRIMARY'
  limit 1;
  if v_current.id is not null and v_current.org_unit_id = v_emp.org_unit_id and v_current.position_id = v_emp.position_id then
    return v_current.slot_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_emp.org_unit_id::text || '|' || v_emp.position_id::text, 0));

  -- An empty seat of the same unit and position: HR's planned seats first.
  select slot.id into v_slot_id
  from public.hrm_org_position_slots slot
  where slot.org_unit_id = v_emp.org_unit_id and slot.position_id = v_emp.position_id and slot.status = 'ACTIVE'
    and slot.effective_from <= p_effective and (slot.effective_to is null or slot.effective_to >= p_effective)
    and not exists (select 1 from public.hrm_employee_slot_assignments occupant
      where occupant.slot_id = slot.id and occupant.status in ('ACTIVE', 'PLANNED') and occupant.assignment_type in ('PRIMARY', 'ACTING'))
  order by case slot.source when 'workforce_plan' then 0 when 'manual' then 1 when 'roster_sync' then 2 else 3 end, slot.sort_order, slot.code
  limit 1;

  if v_slot_id is null then
    insert into public.hrm_org_position_slots (code, org_unit_id, position_id, level_code, slot_type, status, description,
      effective_from, source, created_by, updated_by)
    values ('RS-' || regexp_replace(coalesce(v_unit.code, 'DV'), '[^A-Za-z0-9]', '_', 'g') || '-'
        || regexp_replace(coalesce(v_position.code, 'VT'), '[^A-Za-z0-9]', '_', 'g') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      v_emp.org_unit_id, v_emp.position_id, v_position.level_code, 'STANDARD', 'ACTIVE', 'Ghế theo người thực tế (Bảng nhân sự)',
      p_effective, 'roster_sync', public.current_app_user_id(), public.current_app_user_id())
    returning id into v_slot_id;
  end if;

  update public.hrm_employee_slot_assignments set status = 'ENDED',
    effective_to = greatest(effective_from, p_effective - 1),
    note = concat_ws(E'\n', nullif(note, ''), nullif(btrim(coalesce(p_reason, '')), '')),
    updated_by = public.current_app_user_id(), updated_at = now()
  where employee_id = p_employee_id and status = 'ACTIVE' and assignment_type = 'PRIMARY';

  insert into public.hrm_employee_slot_assignments (employee_id, slot_id, assignment_type, status, effective_from, note, source, created_by, updated_by)
  values (p_employee_id, v_slot_id, 'PRIMARY', 'ACTIVE', p_effective, nullif(btrim(coalesce(p_reason, '')), ''), 'roster_sync',
    public.current_app_user_id(), public.current_app_user_id())
  returning id into v_assignment_id;

  perform app_private.audit_hrm_profile_command(p_employee_id, 'HRM_WORKFORCE_ASSIGNMENT', v_assignment_id::text, 'INSERT',
    coalesce(p_reason, 'Xếp ghế theo Bảng nhân sự'), array['slot_id', 'org_unit_id', 'position_id']);
  return v_slot_id;
end;
$function$;
revoke all on function app_private.hrm_roster_sync_seat(uuid, date, text) from public, anon, authenticated;

-- ── 2. Áp phiếu: chuyển ghế khi đổi bộ phận / chức danh ─────────────────────
create or replace function app_private.hrm_roster_apply_person(p_batch public.hrm_roster_batches, p_person_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_reason text := p_batch.code || ' — ' || p_batch.reason;
  v_items jsonb;
  v_emp uuid;
  v_is_new boolean := false;
  v_before jsonb;
  v_field text;
  v_doc record;
  v_number text;
  v_record_code text;
  v_fields text[];
  v_pay_column text;
  v_custom record;
  v_assignment uuid;
begin
  select jsonb_object_agg(item.field, item.new_value), max(item.employee_id::text)::uuid
  into v_items, v_emp
  from public.hrm_roster_batch_items item where item.batch_id = p_batch.id and item.person_key = p_person_key;
  v_fields := array(select jsonb_object_keys(v_items));

  if v_emp is null then
    v_is_new := true;
    insert into public.employees (full_name, employee_code, status, start_date, phone, gender, date_of_birth)
    values (v_items ->> 'fullName', nullif(v_items ->> 'employeeCode', ''), 'Đang làm việc', (v_items ->> 'startDate')::date,
      v_items ->> 'phone', v_items ->> 'gender', (v_items ->> 'dateOfBirth')::date)
    returning id into v_emp;
    update public.hrm_roster_batch_items set employee_id = v_emp
    where batch_id = p_batch.id and person_key = p_person_key;
  end if;
  if not exists (select 1 from public.employees employee where employee.id = v_emp) then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_STALE';
  end if;

  v_before := app_private.hrm_roster_values(v_emp, true);
  update public.hrm_roster_batch_items item set applied_old_value = v_before -> item.field
  where item.batch_id = p_batch.id and item.person_key = p_person_key;

  update public.employees employee set
    full_name = case when v_items ? 'fullName' then v_items ->> 'fullName' else employee.full_name end,
    legacy_code = case when v_items ? 'employeeCode' and not v_is_new then coalesce(employee.legacy_code, employee.employee_code) else employee.legacy_code end,
    employee_code = case when v_items ? 'employeeCode' then v_items ->> 'employeeCode' else employee.employee_code end,
    org_unit_id = case when v_items ? 'orgUnit' then (v_items ->> 'orgUnit')::uuid else employee.org_unit_id end,
    department_id = case when v_items ? 'orgUnit' then (v_items ->> 'orgUnit')::uuid else employee.department_id end,
    position_id = case when v_items ? 'position' then (v_items ->> 'position')::uuid else employee.position_id end,
    title = case when v_items ? 'position' then (select position.name from public.hrm_positions position where position.id = (v_items ->> 'position')::uuid) else employee.title end,
    level_code = case when v_items ? 'level' then v_items ->> 'level' else employee.level_code end,
    start_date = case when v_items ? 'startDate' then (v_items ->> 'startDate')::date else employee.start_date end,
    official_date = case when v_items ? 'officialDate' then (v_items ->> 'officialDate')::date else employee.official_date end,
    phone = case when v_items ? 'phone' then v_items ->> 'phone' else employee.phone end,
    date_of_birth = case when v_items ? 'dateOfBirth' then (v_items ->> 'dateOfBirth')::date else employee.date_of_birth end,
    gender = case when v_items ? 'gender' then v_items ->> 'gender' else employee.gender end,
    education_level_id = case when v_items ? 'education' then (select item.id from public.hrm_catalog_items item
      where item.catalog_key = 'education_level' and item.code = v_items ->> 'education' limit 1) else employee.education_level_id end,
    updated_at = now()
  where employee.id = v_emp;

  if v_items ? 'fullName' then
    update public.users u set name = v_items ->> 'fullName'
    from public.employees employee where employee.id = v_emp and u.id = employee.user_id and u.name is distinct from v_items ->> 'fullName';
  end if;

  if v_items ?| array['idNumber', 'idIssuedDate', 'idIssuedPlace'] then
    select d.record_code, d.document_type_code, d.document_number, d.issued_date, d.issued_place, d.expiry_date into v_doc
    from public.hrm_employee_identity_documents d where d.employee_id = v_emp and d.status = 'ACTIVE'
    order by (d.document_type_code = 'CCCD') desc, d.is_primary desc, d.updated_at desc limit 1;
    v_number := coalesce(v_items ->> 'idNumber', v_doc.document_number);
    if v_number is not null then
      v_record_code := coalesce(v_doc.record_code, 'ROSTER-CCCD');
      update public.hrm_employee_identity_documents set is_primary = false, updated_by = v_user, updated_at = now()
      where employee_id = v_emp and is_primary and record_code <> v_record_code;
      insert into public.hrm_employee_identity_documents (employee_id, record_code, document_type_code, document_number,
        issued_date, issued_place, expiry_date, is_primary, created_by, updated_by)
      values (v_emp, v_record_code,
        case when length(regexp_replace(v_number, '\D', '', 'g')) = 12 then 'CCCD' else coalesce(v_doc.document_type_code, 'CMND') end,
        v_number,
        case when v_items ? 'idIssuedDate' then (v_items ->> 'idIssuedDate')::date else v_doc.issued_date end,
        case when v_items ? 'idIssuedPlace' then v_items ->> 'idIssuedPlace' else v_doc.issued_place end,
        v_doc.expiry_date, true, v_user, v_user)
      on conflict (employee_id, record_code) do update set document_type_code = excluded.document_type_code,
        document_number = excluded.document_number, issued_date = excluded.issued_date, issued_place = excluded.issued_place,
        is_primary = true, status = 'ACTIVE', updated_by = v_user, updated_at = now();
      perform app_private.audit_hrm_profile_command(v_emp, 'HRM_IDENTITY_DOCUMENT', v_record_code, 'UPSERT', v_reason,
        array['document_type_code', 'document_number', 'issued_date', 'issued_place', 'is_primary']);
    end if;
  end if;

  if v_items ? 'permanentAddress' then
    if v_items ->> 'permanentAddress' is null then
      update public.hrm_employee_addresses set status = 'INACTIVE', effective_to = greatest(effective_from, current_date - 1),
        updated_by = v_user, updated_at = now()
      where employee_id = v_emp and address_type = 'PERMANENT' and status = 'ACTIVE';
    else
      select a.record_code into v_record_code from public.hrm_employee_addresses a
      where a.employee_id = v_emp and a.address_type = 'PERMANENT' and a.status = 'ACTIVE' order by a.updated_at desc limit 1;
      insert into public.hrm_employee_addresses (employee_id, record_code, address_type, address_line, created_by, updated_by)
      values (v_emp, coalesce(v_record_code, 'ROSTER-PERMANENT'), 'PERMANENT', v_items ->> 'permanentAddress', v_user, v_user)
      on conflict (employee_id, record_code) do update set address_line = excluded.address_line, status = 'ACTIVE',
        effective_to = null, updated_by = v_user, updated_at = now();
    end if;
    perform app_private.audit_hrm_profile_command(v_emp, 'HRM_ADDRESS', p_batch.code, 'UPSERT', v_reason, array['address_line']);
  end if;

  if v_items ->> 'institution' is not null then
    insert into public.hrm_employee_qualifications (employee_id, record_code, education_level_code, institution_name, created_by, updated_by)
    values (v_emp, 'ROSTER-EDU', coalesce(v_items ->> 'education', v_before ->> 'education'), v_items ->> 'institution', v_user, v_user)
    on conflict (employee_id, record_code) do update set education_level_code = excluded.education_level_code,
      institution_name = excluded.institution_name, status = 'ACTIVE', updated_by = v_user, updated_at = now();
    perform app_private.audit_hrm_profile_command(v_emp, 'HRM_QUALIFICATION', 'ROSTER-EDU', 'UPSERT', v_reason,
      array['education_level_code', 'institution_name']);
  end if;

  if v_items ? 'leaveRemaining' then
    perform public.adjust_hrm_leave_balance(v_emp, extract(year from app_private.hrm_vn_today())::integer,
      (v_items ->> 'leaveRemaining')::numeric, v_reason);
  end if;

  if v_items ?| app_private.hrm_roster_pay_fields() then
    insert into public.hrm_employee_pay_profiles (employee_id, effective_from, updated_by) values (v_emp, p_batch.effective_date, v_user)
    on conflict (employee_id) do update set effective_from = excluded.effective_from, updated_by = v_user, updated_at = now();
    foreach v_field in array app_private.hrm_roster_pay_fields() loop
      continue when not v_items ? v_field;
      v_pay_column := case v_field when 'phoneAllowance' then 'phone_allowance' when 'vehicleAllowance' then 'vehicle_allowance'
        when 'seniorityAllowance' then 'seniority_allowance' else v_field end;
      if v_field = 'note' then
        execute format('update public.hrm_employee_pay_profiles set %I = $1 where employee_id = $2', v_pay_column) using v_items ->> v_field, v_emp;
      else
        execute format('update public.hrm_employee_pay_profiles set %I = $1 where employee_id = $2', v_pay_column) using (v_items ->> v_field)::numeric, v_emp;
      end if;
    end loop;
    perform app_private.audit_hrm_profile_command(v_emp, 'HRM_PAY_PROFILE', p_batch.code, 'UPSERT', v_reason,
      array(select field from unnest(v_fields) field where field = any(app_private.hrm_roster_pay_fields())));
  end if;

  -- Extra columns from Cấu hình.
  for v_custom in
    select field.id, field.key from public.hrm_roster_custom_fields field where field.key = any(v_fields)
  loop
    if jsonb_typeof(v_items -> v_custom.key) = 'null' then
      delete from public.hrm_employee_custom_values where employee_id = v_emp and field_id = v_custom.id;
    else
      insert into public.hrm_employee_custom_values (employee_id, field_id, value, updated_by)
      values (v_emp, v_custom.id, v_items -> v_custom.key, v_user)
      on conflict (employee_id, field_id) do update set value = excluded.value, updated_by = v_user, updated_at = now();
    end if;
  end loop;

  if v_is_new or v_items ?| array['orgUnit', 'position', 'level'] then
    insert into public.hrm_employee_employment_events (employee_id, record_code, event_type_code, event_date, org_unit_id,
      position_id, title_snapshot, reason, source_reference, status, created_by, updated_by)
    select v_emp, p_batch.code, case when v_is_new then 'HIRE' else 'ROSTER_CHANGE' end, p_batch.effective_date,
      coalesce(employee.org_unit_id, employee.department_id), employee.position_id,
      concat_ws(' · ', employee.title, employee.level_code), p_batch.reason, p_batch.code, 'ACTIVE', v_user, v_user
    from public.employees employee where employee.id = v_emp
    on conflict (employee_id, record_code) do nothing;
  end if;

  -- Bộ phận / chức danh → ghế trên sơ đồ tổ chức từ ngày hiệu lực của phiếu.
  if v_is_new or v_items ?| array['orgUnit', 'position'] then
    perform app_private.hrm_roster_sync_seat(v_emp, greatest(p_batch.effective_date,
      coalesce((select employee.start_date from public.employees employee where employee.id = v_emp), p_batch.effective_date)), v_reason);
  end if;

  -- Lương / Level → phân bổ 3P từ ngày hiệu lực của phiếu.
  if v_items ?| (app_private.hrm_roster_pay_fields() || array['level']) then
    v_assignment := app_private.hrm_compensation_sync_from_roster(v_emp, p_batch.effective_date, p_batch.id, v_items);
    if v_assignment is not null then
      perform app_private.audit_hrm_profile_command(v_emp, 'HRM_COMPENSATION_ASSIGNMENT', v_assignment::text, 'UPSERT', v_reason,
        array(select field from unnest(v_fields) field where field = any(app_private.hrm_roster_pay_fields() || array['level'])));
    end if;
  end if;

  perform app_private.audit_hrm_profile_command(v_emp, 'HRM_ROSTER', p_batch.code, case when v_is_new then 'INSERT' else 'UPDATE' end,
    v_reason, v_fields);
exception when unique_violation then
  raise exception using errcode = '22023', message = 'HRM_ROSTER_CODE_TAKEN', detail = coalesce(v_items ->> 'employeeCode', '');
end;
$function$;
revoke all on function app_private.hrm_roster_apply_person(public.hrm_roster_batches, text) from public, anon, authenticated;

-- ── 3. Lần đầu: xếp cả công ty từ 01/10/2026 ────────────────────────────────
-- People leaving a wrong seat go first, so the seats they free can be reused.
do $$
declare
  v_row record;
begin
  for v_row in
    select employee.id, greatest(date '2026-10-01', coalesce(employee.start_date, date '2026-10-01')) as effective_from
    from public.employees employee
    left join public.hrm_employee_slot_assignments assignment
      on assignment.employee_id = employee.id and assignment.status = 'ACTIVE' and assignment.assignment_type = 'PRIMARY'
    left join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
    where employee.status = 'Đang làm việc' and employee.org_unit_id is not null and employee.position_id is not null
    order by (slot.id is not null and (slot.org_unit_id <> employee.org_unit_id or slot.position_id <> employee.position_id)) desc,
      employee.employee_code
  loop
    perform app_private.hrm_roster_sync_seat(v_row.id, v_row.effective_from, 'Xếp ghế theo Data nhân sự 15/10/2026');
  end loop;
end;
$$;

-- ── 4. Trưởng đơn vị đã rõ theo chức danh ───────────────────────────────────
do $$
declare
  v_pick record;
  v_slot uuid;
  v_count integer;
begin
  for v_pick in
    select * from (values ('TKĐT', 'Trưởng phòng TKĐT'), ('TCKT', 'Trưởng phòng TCKT'), ('TTTH', 'Trưởng phòng Truyền thông'),
      ('XINHAI', 'Chỉ huy trưởng BCH XH')) as pick(unit_code, position_name)
  loop
    select count(*), min(assignment.slot_id::text)::uuid into v_count, v_slot
    from public.employees employee
    join public.org_units unit on unit.id = employee.org_unit_id
    join public.hrm_positions position on position.id = employee.position_id
    join public.hrm_employee_slot_assignments assignment
      on assignment.employee_id = employee.id and assignment.status = 'ACTIVE' and assignment.assignment_type = 'PRIMARY'
    join public.hrm_org_position_slots slot on slot.id = assignment.slot_id and slot.org_unit_id = unit.id
    where employee.status = 'Đang làm việc' and unit.code = v_pick.unit_code and position.name = v_pick.position_name;
    if v_count = 1 then
      update public.org_units set manager_slot_id = v_slot where code = v_pick.unit_code and manager_slot_id is distinct from v_slot;
    else
      raise notice 'Trưởng đơn vị % chưa đặt: % người có chức danh %', v_pick.unit_code, v_count, v_pick.position_name;
    end if;
  end loop;
end;
$$;

-- ── 5. Ghế trống tự tạo từ dữ liệu cũ: lưu trữ ──────────────────────────────
create temp table hrm_seat_archive on commit drop as
select slot.id from public.hrm_org_position_slots slot
where slot.source = 'employee_backfill' and slot.status = 'ACTIVE'
  and not exists (select 1 from public.hrm_employee_slot_assignments occupant
    where occupant.slot_id = slot.id and occupant.status in ('ACTIVE', 'PLANNED'))
  and not exists (select 1 from public.org_units unit where unit.manager_slot_id = slot.id);

-- Seats that reported to an archived one now report to their unit's head.
update public.hrm_org_position_slots set reports_to_slot_id = null, updated_at = now()
where reports_to_slot_id in (select id from hrm_seat_archive) and id not in (select id from hrm_seat_archive);

update public.hrm_org_position_slots set status = 'ARCHIVED', effective_to = greatest(effective_from, date '2026-09-30'),
  description = concat_ws(' · ', nullif(description, ''), 'Lưu trữ 16/10/2026: ghế tự tạo từ dữ liệu cũ, không có người'), updated_at = now()
where id in (select id from hrm_seat_archive);

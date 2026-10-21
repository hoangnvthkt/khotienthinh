-- Lương theo Data nhân sự → phân bổ 3P (16/10/2026, sau PR #208/#209):
--   * Chủ SP chốt: giữ đúng số trong Data. P3 trong Data là P3 tiêu chuẩn theo công thức chưa nạp vào Vioo,
--     nên chưa xếp dải P3 (p3_band_id để trống = "Chưa xếp dải"). P3 thực tế (sau KPI) chưa có, để trống.
--   * Phiếu có Lương hoặc Level được duyệt → phân bổ 3P mới từ ngày hiệu lực của phiếu (bậc = Level E1–E11,
--     P1 / PCTN / PC điện thoại / P3 tiêu chuẩn / PC giữ xe / thâm niên đúng như Data). Phân bổ đang hiệu lực
--     đóng vào ngày hôm trước, không xóa (33 phiếu lương nháp T7 vẫn trỏ được). Duyệt lại cùng ngày thì sửa tại chỗ.
--   * Phân bổ cũ (nạp 01/07/2026): người đã nghỉ đóng ngày 30/09/2026; TT033, TT035 không có trong Data 15/10
--     giữ nguyên, đánh dấu cần xem chờ HR.
--   * Bảng nhân sự trả thêm "pay3p" (chỉ HR Manage) để hiện bậc, dải và ngày hiệu lực.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.hrm_employee_compensation_assignments alter column p3_band_id drop not null;
alter table public.hrm_employee_compensation_assignments
  add column if not exists p1_amount numeric(14, 0),
  add column if not exists pctn_amount numeric(14, 0),
  add column if not exists phone_allowance_amount numeric(14, 0),
  add column if not exists p3_standard_amount numeric(14, 0),
  add column if not exists vehicle_allowance_amount numeric(14, 0),
  add column if not exists seniority_allowance_amount numeric(14, 0),
  add column if not exists roster_batch_id uuid references public.hrm_roster_batches(id) on delete set null;
comment on column public.hrm_employee_compensation_assignments.p3_band_id is 'Dải P3; trống = chưa xếp dải (P3 tiêu chuẩn lấy theo Data, chưa có công thức).';
comment on column public.hrm_employee_compensation_assignments.p3_standard_amount is 'P3 tiêu chuẩn theo thỏa thuận. P3 thực tế (sau KPI) tính theo từng kỳ lương.';
comment on column public.hrm_employee_compensation_assignments.roster_batch_id is 'Phiếu Bảng nhân sự tạo ra phân bổ này.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hrm_employee_compensation_assignments_period_check') then
    alter table public.hrm_employee_compensation_assignments add constraint hrm_employee_compensation_assignments_period_check
      check (effective_to is null or effective_to >= effective_from);
  end if;
end;
$$;

-- ── 2. Phân bổ cũ ───────────────────────────────────────────────────────────
-- Amounts the July seed kept in metadata, as columns like the new rows.
update public.hrm_employee_compensation_assignments set
  p1_amount = nullif(metadata ->> 'p1_salary_amount', '')::numeric,
  pctn_amount = nullif(metadata ->> 'title_allowance_amount', '')::numeric,
  phone_allowance_amount = nullif(metadata ->> 'phone_allowance_amount', '')::numeric,
  p3_standard_amount = nullif(metadata ->> 'p3_standard_amount', '')::numeric,
  seniority_allowance_amount = nullif(metadata ->> 'seniority_allowance_amount', '')::numeric
where source in ('excel_seed', 'legacy_default') and p1_amount is null and p3_standard_amount is null;

-- People who left: close on 30/09/2026, the day before the Data 15/10 takes effect.
update public.hrm_employee_compensation_assignments assignment set
  effective_to = greatest(assignment.effective_from, date '2026-09-30'), status = 'superseded',
  review_note = concat_ws(' · ', nullif(assignment.review_note, ''), 'Đã nghỉ việc — đóng phân bổ'), updated_at = now()
from public.employees employee
where employee.id = assignment.employee_id and employee.status = 'Đã nghỉ việc' and assignment.effective_to is null;

-- Working but missing from the Data 15/10: keep, HR confirms.
update public.hrm_employee_compensation_assignments assignment set
  review_status = 'needs_review', review_note = 'Không có trong Data nhân sự 15/10/2026 — HR xác nhận còn làm việc.', updated_at = now()
from public.employees employee
where employee.id = assignment.employee_id and employee.employee_code in ('TT033', 'TT035')
  and employee.status = 'Đang làm việc' and assignment.effective_to is null and assignment.source = 'excel_seed';

-- ── 3. Ghép một người ───────────────────────────────────────────────────────
-- Puts the person into the 3P plan in force on p_effective. p_changes = the cells of the approved request
-- (Level and pay fields); the rest comes from the Data row in force that day, else from the Data snapshot
-- (never from the July seed). A change also flows into rows already planned later, unless such a row changed
-- that value itself. Returns the row in force from p_effective, or null when the person cannot be placed
-- (no Level, no plan that day, Level not in the plan).
create or replace function app_private.hrm_compensation_sync_from_roster(
  p_employee_id uuid, p_effective date, p_batch_id uuid default null, p_changes jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_changes jsonb := coalesce(p_changes, '{}'::jsonb);
  v_emp public.employees%rowtype;
  v_pay public.hrm_employee_pay_profiles%rowtype;
  v_cur public.hrm_employee_compensation_assignments%rowtype;
  v_new public.hrm_employee_compensation_assignments%rowtype;
  v_old_level text;
  v_level text;
  v_plan_id uuid;
  v_grade_id uuid;
  v_next date;
  v_id uuid;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if p_effective is null or v_emp.id is null then
    return null;
  end if;
  select * into v_pay from public.hrm_employee_pay_profiles where employee_id = p_employee_id;
  select * into v_cur from public.hrm_employee_compensation_assignments assignment
  where assignment.employee_id = p_employee_id and assignment.effective_from <= p_effective
    and (assignment.effective_to is null or assignment.effective_to >= p_effective)
  order by assignment.effective_from desc limit 1;
  select grade.code into v_old_level from public.salary_grades grade where grade.id = v_cur.salary_grade_id;

  -- Values before this request, then the request's cells on top.
  if v_cur.source = 'roster_data' then
    v_new := v_cur;
  else
    v_new.p1_amount := v_pay.p1;
    v_new.pctn_amount := v_pay.pctn;
    v_new.phone_allowance_amount := v_pay.phone_allowance;
    v_new.p3_standard_amount := v_pay.p3;
    v_new.vehicle_allowance_amount := v_pay.vehicle_allowance;
    v_new.seniority_allowance_amount := v_pay.seniority_allowance;
  end if;
  if v_changes ? 'p1' then v_new.p1_amount := (v_changes ->> 'p1')::numeric; end if;
  if v_changes ? 'pctn' then v_new.pctn_amount := (v_changes ->> 'pctn')::numeric; end if;
  if v_changes ? 'phoneAllowance' then v_new.phone_allowance_amount := (v_changes ->> 'phoneAllowance')::numeric; end if;
  if v_changes ? 'p3' then v_new.p3_standard_amount := (v_changes ->> 'p3')::numeric; end if;
  if v_changes ? 'vehicleAllowance' then v_new.vehicle_allowance_amount := (v_changes ->> 'vehicleAllowance')::numeric; end if;
  if v_changes ? 'seniorityAllowance' then v_new.seniority_allowance_amount := (v_changes ->> 'seniorityAllowance')::numeric; end if;
  v_level := coalesce(nullif(v_changes ->> 'level', ''), case when v_cur.source = 'roster_data' then v_old_level end, nullif(v_emp.level_code, ''));

  select plan.id into v_plan_id from public.hrm_compensation_plans plan
  where plan.status = 'active' and plan.effective_from <= p_effective and (plan.effective_to is null or plan.effective_to >= p_effective)
  order by plan.effective_from desc limit 1;
  select grade.id into v_grade_id from public.salary_grades grade where grade.plan_id = v_plan_id and grade.code = v_level;
  if v_grade_id is null then
    return null;
  end if;

  if v_cur.id is not null and v_cur.source = 'roster_data' and v_cur.plan_id = v_plan_id and v_cur.salary_grade_id = v_grade_id
    and v_cur.p1_amount is not distinct from v_new.p1_amount and v_cur.pctn_amount is not distinct from v_new.pctn_amount
    and v_cur.phone_allowance_amount is not distinct from v_new.phone_allowance_amount
    and v_cur.p3_standard_amount is not distinct from v_new.p3_standard_amount
    and v_cur.vehicle_allowance_amount is not distinct from v_new.vehicle_allowance_amount
    and v_cur.seniority_allowance_amount is not distinct from v_new.seniority_allowance_amount then
    -- Same numbers already in force.
    v_id := v_cur.id;
  elsif v_cur.id is not null and v_cur.effective_from = p_effective then
    -- Approved again for the same day: correct the row in place.
    update public.hrm_employee_compensation_assignments set
      employee_code_snapshot = v_emp.employee_code, employee_name_snapshot = v_emp.full_name, plan_id = v_plan_id,
      position_id = v_emp.position_id, org_unit_id = coalesce(v_emp.org_unit_id, v_emp.department_id), salary_grade_id = v_grade_id,
      p3_band_id = case when source = 'roster_data' then p3_band_id end,
      p1_amount = v_new.p1_amount, pctn_amount = v_new.pctn_amount, phone_allowance_amount = v_new.phone_allowance_amount,
      p3_standard_amount = v_new.p3_standard_amount, vehicle_allowance_amount = v_new.vehicle_allowance_amount,
      seniority_allowance_amount = v_new.seniority_allowance_amount,
      source = 'roster_data', review_status = 'approved', review_note = null, roster_batch_id = coalesce(p_batch_id, roster_batch_id),
      metadata = metadata || jsonb_build_object('level_code', v_level), updated_at = now()
    where id = v_cur.id;
    v_id := v_cur.id;
  else
    -- A later row already planned: the new one runs until the day before it.
    select min(assignment.effective_from) into v_next from public.hrm_employee_compensation_assignments assignment
    where assignment.employee_id = p_employee_id and assignment.effective_from > p_effective;
    if v_cur.id is not null then
      update public.hrm_employee_compensation_assignments set effective_to = p_effective - 1, status = 'superseded', updated_at = now()
      where id = v_cur.id;
    end if;
    insert into public.hrm_employee_compensation_assignments (employee_id, employee_code_snapshot, employee_name_snapshot, plan_id,
      position_id, org_unit_id, salary_grade_id, p3_band_id, effective_from, effective_to, status, source, review_status,
      p1_amount, pctn_amount, phone_allowance_amount, p3_standard_amount, vehicle_allowance_amount, seniority_allowance_amount,
      roster_batch_id, metadata)
    values (p_employee_id, v_emp.employee_code, v_emp.full_name, v_plan_id,
      v_emp.position_id, coalesce(v_emp.org_unit_id, v_emp.department_id), v_grade_id,
      case when v_cur.source = 'roster_data' then v_cur.p3_band_id end, p_effective, v_next - 1,
      case when v_next is null then 'active' else 'superseded' end, 'roster_data', 'approved',
      v_new.p1_amount, v_new.pctn_amount, v_new.phone_allowance_amount, v_new.p3_standard_amount, v_new.vehicle_allowance_amount,
      v_new.seniority_allowance_amount, p_batch_id, jsonb_build_object('level_code', v_level))
    returning id into v_id;
  end if;

  -- Rows planned later keep their own changes and take this one where they still had the old value.
  update public.hrm_employee_compensation_assignments later set
    p1_amount = case when v_changes ? 'p1' and later.p1_amount is not distinct from v_cur.p1_amount then v_new.p1_amount else later.p1_amount end,
    pctn_amount = case when v_changes ? 'pctn' and later.pctn_amount is not distinct from v_cur.pctn_amount then v_new.pctn_amount else later.pctn_amount end,
    phone_allowance_amount = case when v_changes ? 'phoneAllowance' and later.phone_allowance_amount is not distinct from v_cur.phone_allowance_amount
      then v_new.phone_allowance_amount else later.phone_allowance_amount end,
    p3_standard_amount = case when v_changes ? 'p3' and later.p3_standard_amount is not distinct from v_cur.p3_standard_amount
      then v_new.p3_standard_amount else later.p3_standard_amount end,
    vehicle_allowance_amount = case when v_changes ? 'vehicleAllowance' and later.vehicle_allowance_amount is not distinct from v_cur.vehicle_allowance_amount
      then v_new.vehicle_allowance_amount else later.vehicle_allowance_amount end,
    seniority_allowance_amount = case when v_changes ? 'seniorityAllowance' and later.seniority_allowance_amount is not distinct from v_cur.seniority_allowance_amount
      then v_new.seniority_allowance_amount else later.seniority_allowance_amount end,
    salary_grade_id = coalesce(case when v_changes ? 'level'
      and (select grade.code from public.salary_grades grade where grade.id = later.salary_grade_id) is not distinct from v_old_level
      then (select grade.id from public.salary_grades grade where grade.plan_id = later.plan_id and grade.code = v_level) end, later.salary_grade_id),
    updated_at = now()
  where later.employee_id = p_employee_id and later.effective_from > p_effective and later.source = 'roster_data';
  return v_id;
end;
$function$;
revoke all on function app_private.hrm_compensation_sync_from_roster(uuid, date, uuid, jsonb) from public, anon, authenticated;

-- What Bảng nhân sự shows in the 3P column: the row in force today, else the next one planned.
create or replace function app_private.hrm_roster_pay3p(p_employee_id uuid, p_today date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object('grade', grade.code, 'band', band.code, 'from', assignment.effective_from, 'to', assignment.effective_to,
    'review', assignment.review_status, 'note', assignment.review_note, 'source', assignment.source)
  from public.hrm_employee_compensation_assignments assignment
  join public.salary_grades grade on grade.id = assignment.salary_grade_id
  left join public.hrm_3p_bands band on band.id = assignment.p3_band_id
  where assignment.employee_id = p_employee_id and (assignment.effective_to is null or assignment.effective_to >= p_today)
  order by (assignment.effective_from <= p_today) desc,
    case when assignment.effective_from <= p_today then assignment.effective_from end desc nulls last, assignment.effective_from
  limit 1;
$function$;
revoke all on function app_private.hrm_roster_pay3p(uuid, date) from public, anon, authenticated;

-- ── 4. Áp phiếu: ghép 3P khi phiếu có Lương hoặc Level ──────────────────────
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

-- ── 5. Bảng nhân sự: bậc / dải 3P (chỉ HR Manage) ───────────────────────────
create or replace function public.get_hrm_roster()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_access text := app_private.hrm_roster_access(v_user);
  v_pay boolean;
  v_approver_only boolean := false;
  v_pay_keys text[] := app_private.hrm_roster_pay_keys();
  v_default uuid[];
begin
  if v_access is null then
    if not app_private.hrm_roster_is_named_approver(v_user) then
      raise exception using errcode = '42501', message = 'HRM_ROSTER_HR_ONLY';
    end if;
    v_approver_only := true;
  end if;
  v_pay := v_access = 'HR_MANAGE';
  v_default := app_private.hrm_roster_approver_ids();
  return jsonb_build_object(
    'today', app_private.hrm_vn_today(),
    'can', case when v_approver_only then jsonb_build_object('edit', false, 'viewPersonal', false, 'viewPay', true, 'editPay', false,
        'approve', true, 'import', false, 'configure', false, 'approverOnly', true)
      else jsonb_build_object(
        'edit', app_private.has_hrm_template_permission(v_user, 'hrm.employee.edit_profile'),
        'viewPersonal', true, 'viewPay', v_pay, 'editPay', v_pay, 'approve', v_pay,
        'import', app_private.has_hrm_template_permission(v_user, 'hrm.employee.import'),
        'configure', app_private.hrm_roster_can_configure(v_user), 'approverOnly', false) end,
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('userId', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id = any(app_private.hrm_roster_chain_step('general', 1, v_default)) and u.id <> v_user), '[]'::jsonb),
    'payApprovers', coalesce((select jsonb_agg(jsonb_build_object('userId', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id = any(app_private.hrm_roster_chain_step('pay', 1, v_default)) and u.id <> v_user), '[]'::jsonb),
    'customFields', coalesce((select jsonb_agg(app_private.hrm_roster_custom_field_json(field) order by field.sort_order, field.label)
      from public.hrm_roster_custom_fields field), '[]'::jsonb),
    'rows', case when v_approver_only then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeId', e.id, 'employeeCode', e.employee_code, 'fullName', e.full_name, 'status', e.status,
        'hint', coalesce(site.name, office.name),
        'values', app_private.hrm_roster_values(e.id, v_pay) - 'fullName' - 'employeeCode',
        'pay3p', case when v_pay then app_private.hrm_roster_pay3p(e.id, app_private.hrm_vn_today()) end,
        'pending', coalesce((
          select jsonb_object_agg(item.field, jsonb_build_object('batchId', batch.id, 'batchCode', batch.code, 'value', item.new_value))
          from public.hrm_roster_batch_items item join public.hrm_roster_batches batch on batch.id = item.batch_id
          where item.employee_id = e.id and batch.status = 'pending' and (v_pay or not item.field = any(v_pay_keys))
        ), '{}'::jsonb)
      ) order by e.full_name)
      from public.employees e
      left join public.hrm_construction_sites site on site.id = e.construction_site_id
      left join public.hrm_offices office on office.id = e.office_id
    ), '[]'::jsonb) end,
    'catalogs', jsonb_build_object(
      'orgUnits', coalesce((select jsonb_agg(jsonb_build_object('id', unit.id, 'code', unit.code, 'name', unit.name,
          'blockCode', unit.block_code, 'sortOrder', unit.order_index, 'aliases', coalesce(to_jsonb(unit.alias_names), '[]'::jsonb))
        order by unit.block_code nulls last, unit.order_index nulls last, unit.name)
        from public.org_units unit where coalesce(unit.is_active, true) and unit.type in ('department', 'factory', 'construction_site')), '[]'::jsonb),
      'positions', coalesce((select jsonb_agg(jsonb_build_object('id', position.id, 'code', position.code, 'name', position.name,
          'groupCode', position.group_code, 'levelCode', position.level_code) order by position.sort_order, position.name)
        from public.hrm_positions position where position.is_active and position.source <> 'legacy'), '[]'::jsonb),
      'levels', coalesce((select jsonb_agg(jsonb_build_object('code', level.code, 'name', level.name)
        order by nullif(regexp_replace(level.code, '\D', '', 'g'), '')::integer nulls last)
        from public.hrm_position_levels level where level.is_active), '[]'::jsonb),
      'groups', coalesce((select jsonb_agg(jsonb_build_object('code', grp.code, 'name', grp.name) order by grp.sort_order)
        from public.hrm_position_groups grp where grp.is_active), '[]'::jsonb),
      'education', coalesce((select jsonb_agg(jsonb_build_object('code', item.code, 'name', item.name) order by item.sort_order)
        from public.hrm_catalog_items item where item.catalog_key = 'education_level' and item.is_active), '[]'::jsonb),
      'blocks', coalesce((select jsonb_agg(jsonb_build_object('code', block.code, 'name', block.name) order by block.sort_order)
        from public.hrm_org_blocks block where block.is_active), '[]'::jsonb)
    )
  );
end;
$function$;
revoke all on function public.get_hrm_roster() from public, anon;
grant execute on function public.get_hrm_roster() to authenticated;

-- ── 6. Danh sách phân bổ: thêm số tiền và phiếu nguồn ───────────────────────
create or replace function public.list_hrm_compensation_assignments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.compensation.view') then
    raise exception using errcode = '42501', message = 'HRM_COMPENSATION_VIEW_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'employee_id', employee_id, 'employee_code_snapshot', employee_code_snapshot,
    'employee_name_snapshot', employee_name_snapshot, 'plan_id', plan_id, 'position_id', position_id,
    'org_unit_id', org_unit_id, 'salary_grade_id', salary_grade_id, 'p3_band_id', p3_band_id,
    'effective_from', effective_from, 'effective_to', effective_to, 'status', status, 'source', source,
    'review_status', review_status, 'review_note', review_note, 'metadata', metadata,
    'p1_amount', p1_amount, 'pctn_amount', pctn_amount, 'phone_allowance_amount', phone_allowance_amount,
    'p3_standard_amount', p3_standard_amount, 'vehicle_allowance_amount', vehicle_allowance_amount,
    'seniority_allowance_amount', seniority_allowance_amount, 'roster_batch_id', roster_batch_id,
    'created_at', created_at, 'updated_at', updated_at
  ) order by effective_from desc) from public.hrm_employee_compensation_assignments), '[]'::jsonb);
end;
$function$;

-- ── 7. Người đã nhập Data trước khi có bước ghép ────────────────────────────
do $$
declare
  v_row record;
begin
  for v_row in
    select employee.id, coalesce(pay.effective_from, (
      select max(batch.effective_date) from public.hrm_roster_batch_items item
      join public.hrm_roster_batches batch on batch.id = item.batch_id
      where item.employee_id = employee.id and item.field = 'level' and batch.status = 'approved')) as effective_from
    from public.employees employee
    left join public.hrm_employee_pay_profiles pay on pay.employee_id = employee.id
    where nullif(employee.level_code, '') is not null
  loop
    perform app_private.hrm_compensation_sync_from_roster(v_row.id, v_row.effective_from, null);
  end loop;
end;
$$;

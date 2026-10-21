-- Bảng nhân sự (16/10/2026): HR sees every person with the company's standard "Data nhân sự" columns,
-- proposes changes for one or many people (or imports the monthly Excel file), and HR Manage approves.
-- Approval writes each cell through the same records the profile uses (employees, identity document,
-- address, qualification, leave balance) plus the pay snapshot from the Data file.
--   * Mã NV = TT + 6 số cuối CCCD (one more digit while the code is taken); the old code is kept.
--   * Pay (P1, PCTN, PC điện thoại, P3, PC giữ xe, thâm niên) and its note: HR Manage only.
--   * Nobody decides a request they sent or one that changes their own record: rows of an approver
--     are split into their own request so another approver decides them.
--   * Catalog: 17 job titles from the Data file, unit XINHAI renamed, education THPT / THCS.

-- ── 1. Catalog ──────────────────────────────────────────────────────────────
insert into public.hrm_positions (code, name, level, group_code, level_code, is_active, sort_order, source)
select item.code, item.name, substring(item.level_code from 2)::integer, item.group_code, item.level_code, true, item.sort_order, 'catalog'
from (values
  ('VT101', 'Phó TGĐ Tài chính, quản trị & đầu tư', 'BoD', 'E9', 101),
  ('VT102', 'Trưởng nhóm dự án', 'QLN', 'E6', 102),
  ('VT103', 'Trưởng nhóm TLĐ', 'CV', 'E5', 103),
  ('VT104', 'Nhân viên hành chính lễ tân', 'NV', 'E2', 104),
  ('VT105', 'Chuyên viên tuyển dụng&QHLĐ', 'CV', 'E4', 105),
  ('VT106', 'Chuyên viên kế toán tài sản', 'CV', 'E4', 106),
  ('VT107', 'Chuyên viên quay dựng', 'CV', 'E5', 107),
  ('VT108', 'Quyền phó phòng VTTB', 'QLCT', 'E5', 108),
  ('VT109', 'Trưởng bộ phận Kho', 'QLN', 'E8', 109),
  ('VT110', 'Trưởng bộ phận bảo hành bảo trì', 'QLCT', 'E8', 110),
  ('VT111', 'Chỉ huy phó BCH SMB', 'QLCT', 'E7', 111),
  ('VT112', 'Trưởng nhóm ME', 'CV', 'E6', 112),
  ('VT113', 'Cán bộ điện nước', 'CN', 'E3', 113),
  ('VT114', 'Nhân viên phụ trắc đạc', 'NV', 'E3', 114),
  ('VT115', 'Chỉ huy trưởng BCH XH', 'QLCT', 'E8', 115),
  ('VT116', 'Trưởng bộ phận thư ký trợ lý', 'CV', 'E8', 116),
  ('VT117', 'Cơ điện và sửa máy', 'NV', 'E2', 117)
) as item(code, name, group_code, level_code, sort_order)
where not exists (select 1 from public.hrm_positions existing where existing.code = item.code or lower(existing.name) = lower(item.name));

insert into public.hrm_catalog_items (catalog_key, code, name, sort_order, source)
select 'education_level', item.code, item.name, item.sort_order, 'catalog'
from (values ('THPT', 'THPT (12/12)', 8), ('THCS', 'THCS (9/12)', 9)) as item(code, name, sort_order)
where not exists (select 1 from public.hrm_catalog_items existing where existing.catalog_key = 'education_level' and existing.code = item.code);

update public.org_units
set name = 'Ban chỉ huy công trình XINHAI VINA',
    alias_names = (select array(select distinct alias from unnest(coalesce(alias_names, '{}') || array['CÔNG TRƯỜNG XINHAI', 'BCH XH']) alias))
where code = 'XINHAI' and name <> 'Ban chỉ huy công trình XINHAI VINA';

-- ── 2. Columns and tables ───────────────────────────────────────────────────
alter table public.employees add column if not exists legacy_code text;
alter table public.employees add column if not exists level_code text;
comment on column public.employees.legacy_code is 'Mã NV trước khi đổi sang TT + 6 số cuối CCCD.';
comment on column public.employees.level_code is 'Level (E1–E11) của người, theo Data nhân sự.';

-- Pay as written in the Data file. HR Manage only; read and written through the functions below.
create table if not exists public.hrm_employee_pay_profiles (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  p1 numeric(14, 0),
  pctn numeric(14, 0),
  phone_allowance numeric(14, 0),
  p3 numeric(14, 0),
  vehicle_allowance numeric(14, 0),
  seniority_allowance numeric(14, 0),
  note text,
  effective_from date,
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hrm_employee_pay_profiles enable row level security;
revoke all on public.hrm_employee_pay_profiles from public, anon, authenticated;

create sequence if not exists public.hrm_roster_batch_seq;

create table if not exists public.hrm_roster_batches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  source text not null check (source in ('grid', 'import')),
  title text not null,
  reason text not null,
  effective_date date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'returned', 'cancelled')),
  file_name text,
  people_count integer not null default 0,
  new_people_count integer not null default 0,
  item_count integer not null default 0,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  updated_at timestamptz not null default now()
);
create index if not exists hrm_roster_batches_status_idx on public.hrm_roster_batches (status, created_at desc);

create table if not exists public.hrm_roster_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.hrm_roster_batches(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  person_key text not null,
  full_name text not null,
  employee_code text,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  applied_old_value jsonb,
  unique (batch_id, person_key, field)
);
create index if not exists hrm_roster_batch_items_employee_idx on public.hrm_roster_batch_items (employee_id, field);

alter table public.hrm_roster_batches enable row level security;
alter table public.hrm_roster_batch_items enable row level security;
revoke all on public.hrm_roster_batches, public.hrm_roster_batch_items from public, anon, authenticated;

-- ── 3. Helpers ──────────────────────────────────────────────────────────────
-- 'HR_MANAGE' (sees and approves pay), 'HR' (proposes), null (no access).
create or replace function app_private.hrm_roster_access(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_user_id is null or not app_private.has_hrm_template_permission(p_user_id, 'hrm.employee.view_sensitive') then null
    when app_private.has_hrm_template_permission(p_user_id, 'hrm.compensation.manage') then 'HR_MANAGE'
    else 'HR' end;
$function$;
revoke all on function app_private.hrm_roster_access(uuid) from public, anon, authenticated;

create or replace function app_private.hrm_roster_approver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(u.id order by u.name), '{}') from public.users u
  where coalesce(u.is_active, true) and app_private.has_hrm_template_permission(u.id, 'hrm.compensation.manage');
$function$;
revoke all on function app_private.hrm_roster_approver_ids() from public, anon, authenticated;

create or replace function app_private.hrm_roster_pay_fields()
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select array['p1', 'pctn', 'phoneAllowance', 'p3', 'vehicleAllowance', 'seniorityAllowance', 'note'];
$function$;

create or replace function app_private.hrm_roster_field_order(p_field text)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select coalesce(array_position(array['fullName', 'employeeCode', 'orgUnit', 'position', 'level', 'startDate', 'officialDate',
    'leaveRemaining', 'phone', 'dateOfBirth', 'gender', 'idNumber', 'idIssuedDate', 'idIssuedPlace', 'permanentAddress', 'education',
    'institution', 'p1', 'pctn', 'phoneAllowance', 'p3', 'vehicleAllowance', 'seniorityAllowance', 'note'], p_field), 99);
$function$;

-- Current values of one person, keyed like the screen (lib/hrmRoster.ts).
create or replace function app_private.hrm_roster_values(p_employee_id uuid, p_with_pay boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'fullName', e.full_name, 'employeeCode', e.employee_code,
    'orgUnit', coalesce(e.org_unit_id, e.department_id), 'position', e.position_id, 'level', e.level_code,
    'startDate', e.start_date, 'officialDate', e.official_date,
    'leaveRemaining', (select app_private.hrm_leave_available(balance) from public.hrm_leave_balances balance
      where balance."employeeId" = e.id and balance.year = extract(year from app_private.hrm_vn_today())::integer limit 1),
    'phone', e.phone, 'dateOfBirth', e.date_of_birth, 'gender', e.gender,
    'idNumber', doc.document_number, 'idIssuedDate', doc.issued_date, 'idIssuedPlace', doc.issued_place,
    'permanentAddress', address.address_line, 'education', education.code, 'institution', qualification.institution_name,
    'legacyCode', e.legacy_code
  ) || case when p_with_pay then jsonb_build_object(
    'p1', pay.p1, 'pctn', pay.pctn, 'phoneAllowance', pay.phone_allowance, 'p3', pay.p3,
    'vehicleAllowance', pay.vehicle_allowance, 'seniorityAllowance', pay.seniority_allowance, 'note', pay.note
  ) else '{}'::jsonb end
  from public.employees e
  left join lateral (
    select d.document_number, d.issued_date, d.issued_place from public.hrm_employee_identity_documents d
    where d.employee_id = e.id and d.status = 'ACTIVE'
    order by (d.document_type_code = 'CCCD') desc, d.is_primary desc, d.updated_at desc limit 1
  ) doc on true
  left join lateral (
    select a.address_line from public.hrm_employee_addresses a
    where a.employee_id = e.id and a.address_type = 'PERMANENT' and a.status = 'ACTIVE' order by a.updated_at desc limit 1
  ) address on true
  left join lateral (
    select q.institution_name from public.hrm_employee_qualifications q
    where q.employee_id = e.id and q.status = 'ACTIVE' order by (q.record_code = 'ROSTER-EDU') desc, q.updated_at desc limit 1
  ) qualification on true
  left join public.hrm_catalog_items education on education.id = e.education_level_id
  left join public.hrm_employee_pay_profiles pay on pay.employee_id = e.id
  where e.id = p_employee_id;
$function$;
revoke all on function app_private.hrm_roster_values(uuid, boolean) from public, anon, authenticated;

-- Checks and normalizes one proposed value; raises HRM_ROSTER_VALUE_INVALID with the field in DETAIL.
create or replace function app_private.hrm_roster_normalize(p_field text, p_value jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_text text := case when p_value is null or jsonb_typeof(p_value) = 'null' then null
    when jsonb_typeof(p_value) = 'string' then btrim(p_value #>> '{}') else p_value #>> '{}' end;
  v_num numeric;
  v_date date;
begin
  if p_field is null or not p_field = any(array['fullName', 'employeeCode', 'orgUnit', 'position', 'level', 'startDate', 'officialDate',
    'leaveRemaining', 'phone', 'dateOfBirth', 'gender', 'idNumber', 'idIssuedDate', 'idIssuedPlace', 'permanentAddress', 'education',
    'institution'] || app_private.hrm_roster_pay_fields()) then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_FIELD_UNKNOWN', detail = coalesce(p_field, '');
  end if;
  if v_text = '' then v_text := null; end if;
  if v_text is null then
    if p_field in ('fullName', 'employeeCode', 'orgUnit', 'position', 'level', 'startDate', 'leaveRemaining', 'phone',
      'dateOfBirth', 'gender', 'idNumber') then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_VALUE_INVALID', detail = p_field;
    end if;
    return 'null'::jsonb;
  end if;
  begin
    case
      when p_field = 'fullName' then
        if length(v_text) between 2 and 120 then return to_jsonb(regexp_replace(v_text, '\s+', ' ', 'g')); end if;
      when p_field = 'employeeCode' then
        if v_text ~ '^TT[0-9]{6,12}$' then return to_jsonb(v_text); end if;
      when p_field = 'orgUnit' then
        if exists (select 1 from public.org_units unit where unit.id = v_text::uuid and coalesce(unit.is_active, true)
          and unit.type in ('department', 'factory', 'construction_site')) then return to_jsonb(v_text); end if;
      when p_field = 'position' then
        if exists (select 1 from public.hrm_positions position where position.id = v_text::uuid and position.is_active) then return to_jsonb(v_text); end if;
      when p_field = 'level' then
        if exists (select 1 from public.hrm_position_levels level where level.code = v_text and level.is_active) then return to_jsonb(v_text); end if;
      when p_field in ('startDate', 'officialDate', 'dateOfBirth', 'idIssuedDate') then
        v_date := v_text::date;
        if v_date between date '1930-01-01' and date '2100-12-31' then return to_jsonb(v_date); end if;
      when p_field = 'leaveRemaining' then
        v_num := v_text::numeric;
        if v_num between -30 and 60 and v_num * 2 = round(v_num * 2) then return to_jsonb(v_num); end if;
      when p_field = 'phone' then
        v_text := regexp_replace(v_text, '\D', '', 'g');
        if length(v_text) between 9 and 11 then return to_jsonb(v_text); end if;
      when p_field = 'gender' then
        if v_text in ('Nam', 'Nữ') then return to_jsonb(v_text); end if;
      when p_field = 'idNumber' then
        v_text := regexp_replace(v_text, '\D', '', 'g');
        if length(v_text) in (9, 12) then return to_jsonb(v_text); end if;
      when p_field in ('idIssuedPlace', 'permanentAddress', 'institution', 'note') then
        if length(v_text) <= 500 then return to_jsonb(v_text); end if;
      when p_field = 'education' then
        if exists (select 1 from public.hrm_catalog_items item where item.catalog_key = 'education_level' and item.code = v_text and item.is_active) then
          return to_jsonb(v_text);
        end if;
      when p_field = any(app_private.hrm_roster_pay_fields()) then
        v_num := round(v_text::numeric);
        if v_num between 0 and 10000000000 then return to_jsonb(v_num); end if;
      else
        raise exception using errcode = '22023', message = 'HRM_ROSTER_FIELD_UNKNOWN', detail = p_field;
    end case;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
    null;
  end;
  raise exception using errcode = '22023', message = 'HRM_ROSTER_VALUE_INVALID', detail = p_field;
end;
$function$;
revoke all on function app_private.hrm_roster_normalize(text, jsonb) from public, anon, authenticated;

-- Approvers of a pending request: HR Manage, not the sender, not anyone whose own record is in it.
create or replace function app_private.hrm_roster_can_decide(p_batch public.hrm_roster_batches, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_batch.status = 'pending' and p_user_id is not null and p_user_id <> p_batch.created_by
    and app_private.has_hrm_template_permission(p_user_id, 'hrm.compensation.manage')
    and not exists (
      select 1 from public.hrm_roster_batch_items item join public.employees employee on employee.id = item.employee_id
      where item.batch_id = p_batch.id and employee.user_id = p_user_id
    );
$function$;
revoke all on function app_private.hrm_roster_can_decide(public.hrm_roster_batches, uuid) from public, anon, authenticated;

create or replace function app_private.hrm_roster_batch_json(p_batch public.hrm_roster_batches, p_with_items boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_pay boolean := app_private.hrm_roster_access(v_user) = 'HR_MANAGE';
  v_can_decide boolean := app_private.hrm_roster_can_decide(p_batch, v_user);
begin
  return jsonb_build_object(
    'id', p_batch.id, 'code', p_batch.code, 'source', p_batch.source, 'title', p_batch.title, 'reason', p_batch.reason,
    'effectiveDate', p_batch.effective_date, 'status', p_batch.status, 'fileName', p_batch.file_name,
    'createdByName', (select u.name from public.users u where u.id = p_batch.created_by), 'createdAt', p_batch.created_at,
    'decidedByName', (select u.name from public.users u where u.id = p_batch.decided_by), 'decidedAt', p_batch.decided_at,
    'decisionNote', p_batch.decision_note,
    'approverNames', case when p_batch.status = 'pending' then coalesce((
        select jsonb_agg(u.name order by u.name) from public.users u
        where u.id = any(app_private.hrm_roster_approver_ids()) and app_private.hrm_roster_can_decide(p_batch, u.id)), '[]'::jsonb)
      when p_batch.decided_by is null then '[]'::jsonb
      else jsonb_build_array((select u.name from public.users u where u.id = p_batch.decided_by)) end,
    'peopleCount', p_batch.people_count, 'newPeopleCount', p_batch.new_people_count, 'itemCount', p_batch.item_count,
    'awaitingMe', v_can_decide,
    'can', jsonb_build_object(
      'decide', v_can_decide,
      'cancel', p_batch.status = 'pending' and (p_batch.created_by = v_user or v_can_decide),
      'resubmit', p_batch.status = 'returned' and p_batch.created_by = v_user and p_batch.source = 'grid'),
    'items', case when not p_with_items then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeId', item.employee_id, 'personKey', item.person_key, 'fullName', item.full_name,
        'employeeCode', coalesce(item.employee_code, employee.employee_code), 'field', item.field,
        'oldValue', item.old_value, 'newValue', item.new_value)
        order by item.full_name, item.person_key, app_private.hrm_roster_field_order(item.field))
      from public.hrm_roster_batch_items item left join public.employees employee on employee.id = item.employee_id
      where item.batch_id = p_batch.id and (v_pay or not item.field = any(app_private.hrm_roster_pay_fields()))
    ), '[]'::jsonb) end
  );
end;
$function$;
revoke all on function app_private.hrm_roster_batch_json(public.hrm_roster_batches, boolean) from public, anon, authenticated;

-- ── 4. Read the roster ──────────────────────────────────────────────────────
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
begin
  if v_access is null then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_HR_ONLY';
  end if;
  v_pay := v_access = 'HR_MANAGE';
  return jsonb_build_object(
    'today', app_private.hrm_vn_today(),
    'can', jsonb_build_object(
      'edit', app_private.has_hrm_template_permission(v_user, 'hrm.employee.edit_profile'),
      'viewPersonal', true, 'viewPay', v_pay, 'editPay', v_pay, 'approve', v_pay,
      'import', app_private.has_hrm_template_permission(v_user, 'hrm.employee.import')),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('userId', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id = any(app_private.hrm_roster_approver_ids()) and u.id <> v_user), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeId', e.id, 'employeeCode', e.employee_code, 'fullName', e.full_name, 'status', e.status,
        'hint', coalesce(site.name, office.name),
        'values', app_private.hrm_roster_values(e.id, v_pay) - 'fullName' - 'employeeCode',
        'pending', coalesce((
          select jsonb_object_agg(item.field, jsonb_build_object('batchId', batch.id, 'batchCode', batch.code, 'value', item.new_value))
          from public.hrm_roster_batch_items item join public.hrm_roster_batches batch on batch.id = item.batch_id
          where item.employee_id = e.id and batch.status = 'pending' and (v_pay or not item.field = any(app_private.hrm_roster_pay_fields()))
        ), '{}'::jsonb)
      ) order by e.full_name)
      from public.employees e
      left join public.hrm_construction_sites site on site.id = e.construction_site_id
      left join public.hrm_offices office on office.id = e.office_id
    ), '[]'::jsonb),
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

-- ── 5. Submit ───────────────────────────────────────────────────────────────
create or replace function public.submit_hrm_roster_batch(
  p_source text, p_title text, p_reason text, p_effective_date date, p_items jsonb, p_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_access text := app_private.hrm_roster_access(v_user);
  v_today date := app_private.hrm_vn_today();
  v_batch public.hrm_roster_batches%rowtype;
  v_split public.hrm_roster_batches%rowtype;
  v_item jsonb;
  v_field text;
  v_key text;
  v_emp uuid;
  v_name text;
  v_old jsonb;
  v_new jsonb;
  v_person record;
  v_conflict text;
  v_digits text;
  v_code text;
  v_size integer;
  v_codes jsonb := '[]'::jsonb;
  v_batch_ids uuid[] := '{}';
  v_approvers uuid[] := app_private.hrm_roster_approver_ids();
  v_current jsonb := '{}'::jsonb; -- current values per employee, read once
begin
  if v_access is null or not app_private.has_hrm_template_permission(v_user, 'hrm.employee.edit_profile') then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_HR_ONLY';
  end if;
  if coalesce(p_source, '') not in ('grid', 'import') then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_SOURCE_INVALID';
  end if;
  if p_source = 'import' and not app_private.has_hrm_template_permission(v_user, 'hrm.employee.import') then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_HR_ONLY';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_REASON_REQUIRED';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_EMPTY';
  end if;
  if jsonb_array_length(p_items) > 6000 then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_TOO_MANY';
  end if;
  if p_effective_date is null or p_effective_date not between v_today - 366 and v_today + 366 then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_EFFECTIVE_DATE_INVALID';
  end if;
  if cardinality(v_approvers) = 0 then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_NO_APPROVER';
  end if;

  insert into public.hrm_roster_batches (code, source, title, reason, effective_date, file_name, created_by)
  values ('PTD-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.hrm_roster_batch_seq')::text, 4, '0'),
    p_source, left(coalesce(nullif(btrim(p_title), ''), 'Thay đổi nhân sự'), 200), btrim(p_reason), p_effective_date,
    nullif(left(btrim(coalesce(p_file_name, '')), 200), ''), v_user)
  returning * into v_batch;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_field := v_item ->> 'field';
    if v_field = any(app_private.hrm_roster_pay_fields()) and v_access <> 'HR_MANAGE' then
      raise exception using errcode = '42501', message = 'HRM_ROSTER_PAY_FORBIDDEN';
    end if;
    v_emp := nullif(v_item ->> 'employeeId', '')::uuid;
    if v_emp is not null then
      select employee.full_name into v_name from public.employees employee where employee.id = v_emp;
      if v_name is null then
        raise exception using errcode = '22023', message = 'HRM_ROSTER_STALE';
      end if;
      v_key := v_emp::text;
      if not v_current ? v_key then
        v_current := v_current || jsonb_build_object(v_key, app_private.hrm_roster_values(v_emp, true));
      end if;
      v_old := v_current -> v_key -> v_field;
      select batch.code into v_conflict from public.hrm_roster_batch_items other
        join public.hrm_roster_batches batch on batch.id = other.batch_id
      where other.employee_id = v_emp and other.field = v_field and batch.status = 'pending' and batch.id <> v_batch.id limit 1;
      if v_conflict is not null then
        raise exception using errcode = '22023', message = 'HRM_ROSTER_FIELD_PENDING', detail = v_conflict;
      end if;
    else
      v_key := v_item ->> 'personKey';
      if v_key is null or v_key !~ '^new:[0-9A-Za-z_-]{1,40}$' then
        raise exception using errcode = '22023', message = 'HRM_ROSTER_VALUE_INVALID', detail = 'personKey';
      end if;
      v_name := left(btrim(coalesce(v_item ->> 'fullName', '')), 120);
      v_old := null;
    end if;
    if v_field = 'legacyCode' then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_FIELD_UNKNOWN', detail = v_field;
    end if;
    v_new := app_private.hrm_roster_normalize(v_field, v_item -> 'newValue');
    if v_old is not null and v_old = v_new then continue; end if;
    begin
      insert into public.hrm_roster_batch_items (batch_id, employee_id, person_key, full_name, employee_code, field, old_value, new_value)
      values (v_batch.id, v_emp, v_key, coalesce(nullif(v_name, ''), 'Người mới'),
        (select employee.employee_code from public.employees employee where employee.id = v_emp), v_field, v_old, v_new);
    exception when unique_violation then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_VALUE_INVALID', detail = 'duplicate ' || v_field;
    end;
  end loop;

  -- Per person: new people need a name; CCCD unique; Mã NV follows CCCD (TT + 6 số cuối, one more digit while taken).
  for v_person in
    select item.person_key, max(item.employee_id::text)::uuid as employee_id,
      max(item.new_value #>> '{}') filter (where item.field = 'idNumber') as id_number,
      max(item.new_value #>> '{}') filter (where item.field = 'employeeCode') as code,
      max(item.new_value #>> '{}') filter (where item.field = 'fullName') as full_name
    from public.hrm_roster_batch_items item where item.batch_id = v_batch.id group by item.person_key
  loop
    if v_person.employee_id is null and v_person.full_name is null then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_VALUE_INVALID', detail = 'fullName';
    end if;
    if v_person.id_number is not null and (
      exists (select 1 from public.hrm_employee_identity_documents doc where doc.status = 'ACTIVE'
        and regexp_replace(doc.document_number, '\D', '', 'g') = v_person.id_number
        and doc.employee_id is distinct from v_person.employee_id)
      or exists (select 1 from public.hrm_roster_batch_items other where other.batch_id = v_batch.id and other.field = 'idNumber'
        and other.person_key <> v_person.person_key and other.new_value #>> '{}' = v_person.id_number)
    ) then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_ID_TAKEN', detail = v_person.id_number;
    end if;
    v_digits := coalesce(v_person.id_number,
      regexp_replace(coalesce(app_private.hrm_roster_values(v_person.employee_id, false) ->> 'idNumber', ''), '\D', '', 'g'));
    if v_person.code is not null then
      if v_digits = '' or v_person.code <> 'TT' || right(v_digits, length(v_person.code) - 2)
        or exists (select 1 from public.employees employee where employee.employee_code = v_person.code and employee.id is distinct from v_person.employee_id)
        or exists (select 1 from public.hrm_roster_batch_items other where other.batch_id = v_batch.id and other.field = 'employeeCode'
          and other.person_key <> v_person.person_key and other.new_value #>> '{}' = v_person.code)
      then
        raise exception using errcode = '22023', message = 'HRM_ROSTER_CODE_TAKEN', detail = v_person.code;
      end if;
    elsif v_person.id_number is not null then
      v_code := null;
      for v_size in 6 .. length(v_digits) loop
        v_code := 'TT' || right(v_digits, v_size);
        exit when not exists (select 1 from public.employees employee where employee.employee_code = v_code and employee.id is distinct from v_person.employee_id)
          and not exists (select 1 from public.hrm_roster_batch_items other where other.batch_id = v_batch.id and other.field = 'employeeCode' and other.new_value #>> '{}' = v_code);
        v_code := null;
      end loop;
      if v_code is not null and v_code is distinct from (select employee.employee_code from public.employees employee where employee.id = v_person.employee_id) then
        insert into public.hrm_roster_batch_items (batch_id, employee_id, person_key, full_name, employee_code, field, old_value, new_value)
        select v_batch.id, v_person.employee_id, v_person.person_key, min(item.full_name), min(item.employee_code), 'employeeCode',
          (select to_jsonb(employee.employee_code) from public.employees employee where employee.id = v_person.employee_id), to_jsonb(v_code)
        from public.hrm_roster_batch_items item where item.batch_id = v_batch.id and item.person_key = v_person.person_key;
      end if;
    end if;
  end loop;

  if not exists (select 1 from public.hrm_roster_batch_items item where item.batch_id = v_batch.id) then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_EMPTY';
  end if;

  -- Rows about an approver go to their own request so another approver decides them.
  for v_person in
    select distinct item.employee_id, employee.full_name, employee.user_id
    from public.hrm_roster_batch_items item join public.employees employee on employee.id = item.employee_id
    where item.batch_id = v_batch.id and employee.user_id = any(v_approvers)
      and exists (select 1 from public.hrm_roster_batch_items other where other.batch_id = v_batch.id and other.employee_id is distinct from item.employee_id)
  loop
    insert into public.hrm_roster_batches (code, source, title, reason, effective_date, file_name, created_by)
    values ('PTD-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.hrm_roster_batch_seq')::text, 4, '0'),
      v_batch.source, left(v_batch.title || ' · ' || v_person.full_name, 200), v_batch.reason, v_batch.effective_date, v_batch.file_name, v_user)
    returning * into v_split;
    update public.hrm_roster_batch_items set batch_id = v_split.id where batch_id = v_batch.id and employee_id = v_person.employee_id;
    v_batch_ids := v_batch_ids || v_split.id;
  end loop;
  if exists (select 1 from public.hrm_roster_batch_items item where item.batch_id = v_batch.id) then
    v_batch_ids := array_prepend(v_batch.id, v_batch_ids);
  else
    -- Only approvers' own rows: the split requests are the whole submission.
    delete from public.hrm_roster_batches where id = v_batch.id;
    select * into v_batch from public.hrm_roster_batches where id = v_batch_ids[1];
  end if;

  update public.hrm_roster_batches batch set
    people_count = counts.people, new_people_count = counts.new_people, item_count = counts.items
  from (
    select item.batch_id, count(distinct item.person_key) as people,
      count(distinct item.person_key) filter (where item.employee_id is null) as new_people, count(*) as items
    from public.hrm_roster_batch_items item where item.batch_id = any(v_batch_ids) group by item.batch_id
  ) counts where batch.id = counts.batch_id;

  for v_split in select * from public.hrm_roster_batches batch where batch.id = any(v_batch_ids) order by batch.code loop
    v_codes := v_codes || to_jsonb(v_split.code);
    perform app_private.notify_hrm_profile(
      array(select approver from unnest(v_approvers) approver where app_private.hrm_roster_can_decide(v_split, approver)),
      'Phiếu thay đổi nhân sự chờ duyệt',
      v_split.code || ' · ' || v_split.title || ' — ' || v_split.item_count || ' thay đổi, ' || v_split.people_count || ' người.',
      '/hrm/employees?view=roster&tab=batches&batch=' || v_split.id, v_split.id, 'system');
  end loop;

  select * into v_batch from public.hrm_roster_batches where id = v_batch.id;
  return jsonb_build_object('id', v_batch.id, 'code', v_batch.code, 'codes', v_codes,
    'approverNames', app_private.hrm_roster_batch_json(v_batch, false) -> 'approverNames');
end;
$function$;
revoke all on function public.submit_hrm_roster_batch(text, text, text, date, jsonb, text) from public, anon;
grant execute on function public.submit_hrm_roster_batch(text, text, text, date, jsonb, text) to authenticated;

-- ── 6. List, open, cancel ───────────────────────────────────────────────────
create or replace function public.list_hrm_roster_batches(p_scope text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if app_private.hrm_roster_access(public.current_app_user_id()) is null then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_HR_ONLY';
  end if;
  return coalesce((
    select jsonb_agg(app_private.hrm_roster_batch_json(batch, false) order by coalesce(batch.decided_at, batch.created_at) desc)
    from public.hrm_roster_batches batch
    where (p_scope = 'pending' and batch.status = 'pending')
       or (p_scope = 'returned' and batch.status = 'returned' and batch.decided_at > now() - interval '90 days')
       or (p_scope = 'approved' and batch.status = 'approved' and batch.decided_at > now() - interval '30 days')
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_hrm_roster_batches(text) from public, anon;
grant execute on function public.list_hrm_roster_batches(text) to authenticated;

create or replace function public.get_hrm_roster_batch(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_batch public.hrm_roster_batches%rowtype;
begin
  if app_private.hrm_roster_access(public.current_app_user_id()) is null then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_HR_ONLY';
  end if;
  select * into v_batch from public.hrm_roster_batches where id = p_id;
  if v_batch.id is null then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_NOT_FOUND';
  end if;
  return app_private.hrm_roster_batch_json(v_batch, true);
end;
$function$;
revoke all on function public.get_hrm_roster_batch(uuid) from public, anon;
grant execute on function public.get_hrm_roster_batch(uuid) to authenticated;

create or replace function public.cancel_hrm_roster_batch(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_batch public.hrm_roster_batches%rowtype;
begin
  select * into v_batch from public.hrm_roster_batches where id = p_id for update;
  if v_batch.id is null or v_batch.status <> 'pending' then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_NOT_PENDING';
  end if;
  if v_batch.created_by <> v_user and not app_private.hrm_roster_can_decide(v_batch, v_user) then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_NOT_APPROVER';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_REASON_REQUIRED';
  end if;
  update public.hrm_roster_batches set status = 'cancelled', decided_by = v_user, decided_at = now(),
    decision_note = btrim(p_reason), updated_at = now() where id = p_id;
end;
$function$;
revoke all on function public.cancel_hrm_roster_batch(uuid, text) from public, anon;
grant execute on function public.cancel_hrm_roster_batch(uuid, text) to authenticated;

-- ── 7. Apply on approval ────────────────────────────────────────────────────
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
  v_val jsonb;
  v_field text;
  v_doc record;
  v_number text;
  v_record_code text;
  v_fields text[];
  v_pay_column text;
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

  -- Core record.
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

  -- CCCD: one document, current values kept for cells the request does not change.
  if v_items ?| array['idNumber', 'idIssuedDate', 'idIssuedPlace'] then
    select d.record_code, d.document_type_code, d.document_number, d.issued_date, d.issued_place, d.expiry_date into v_doc
    from public.hrm_employee_identity_documents d where d.employee_id = v_emp and d.status = 'ACTIVE'
    order by (d.document_type_code = 'CCCD') desc, d.is_primary desc, d.updated_at desc limit 1;
    v_number := coalesce(v_items ->> 'idNumber', v_doc.document_number);
    if v_number is not null then
      -- Same write as upsert_hrm_employee_identity_document, without building the profile payload it returns.
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

  -- Permanent address as written in the file (no province code: HR completes it in the profile).
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

  -- Pay snapshot from the Data file.
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

  -- Quá trình công tác: hiring, or a change of unit / title / level.
  if v_is_new or v_items ?| array['orgUnit', 'position', 'level'] then
    insert into public.hrm_employee_employment_events (employee_id, record_code, event_type_code, event_date, org_unit_id,
      position_id, title_snapshot, reason, source_reference, status, created_by, updated_by)
    select v_emp, p_batch.code, case when v_is_new then 'HIRE' else 'ROSTER_CHANGE' end, p_batch.effective_date,
      coalesce(employee.org_unit_id, employee.department_id), employee.position_id,
      concat_ws(' · ', employee.title, employee.level_code), p_batch.reason, p_batch.code, 'ACTIVE', v_user, v_user
    from public.employees employee where employee.id = v_emp
    on conflict (employee_id, record_code) do nothing;
  end if;

  perform app_private.audit_hrm_profile_command(v_emp, 'HRM_ROSTER', p_batch.code, case when v_is_new then 'INSERT' else 'UPDATE' end,
    v_reason, v_fields);
exception when unique_violation then
  raise exception using errcode = '22023', message = 'HRM_ROSTER_CODE_TAKEN', detail = coalesce(v_items ->> 'employeeCode', '');
end;
$function$;
revoke all on function app_private.hrm_roster_apply_person(public.hrm_roster_batches, text) from public, anon, authenticated;

create or replace function public.decide_hrm_roster_batch(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_batch public.hrm_roster_batches%rowtype;
  v_person text;
begin
  select * into v_batch from public.hrm_roster_batches where id = p_id for update;
  if v_batch.id is null or v_batch.status <> 'pending' then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_NOT_PENDING';
  end if;
  if not app_private.has_hrm_template_permission(v_user, 'hrm.compensation.manage') then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_NOT_APPROVER';
  end if;
  if not app_private.hrm_roster_can_decide(v_batch, v_user) then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_SELF_DECISION';
  end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_REASON_REQUIRED';
  end if;

  if p_approve then
    for v_person in
      select item.person_key from public.hrm_roster_batch_items item where item.batch_id = v_batch.id
      group by item.person_key order by min(item.full_name), item.person_key
    loop
      perform app_private.hrm_roster_apply_person(v_batch, v_person);
    end loop;
  end if;

  update public.hrm_roster_batches set status = case when p_approve then 'approved' else 'returned' end,
    decided_by = v_user, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
  where id = p_id returning * into v_batch;

  perform app_private.notify_hrm_profile(array[v_batch.created_by],
    case when p_approve then 'Phiếu thay đổi nhân sự đã duyệt' else 'Phiếu thay đổi nhân sự bị trả lại' end,
    v_batch.code || ' · ' || v_batch.title || case when p_approve then ' — hồ sơ đã cập nhật.' else ' — ' || btrim(p_note) end,
    '/hrm/employees?view=roster&tab=batches&batch=' || v_batch.id, v_batch.id, 'system');
  return app_private.hrm_roster_batch_json(v_batch, true);
end;
$function$;
revoke all on function public.decide_hrm_roster_batch(uuid, boolean, text) from public, anon;
grant execute on function public.decide_hrm_roster_batch(uuid, boolean, text) to authenticated;

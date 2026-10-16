-- Cấu hình Hồ sơ nhân sự (16/10/2026, PR-3 of Bảng nhân sự):
--   * Approvers per group: "Thông tin chung & vị trí" and "Lương & phụ cấp"; step 1 = any one person of the
--     list (empty list = HR Manage), optional step 2. Chủ SP chốt: Lương has step 2 = TGĐ Dương Xuân Thịnh.
--   * A request with both pay and other cells is split: the pay cells follow the Lương approvers.
--   * Approvers may be people without HR rights (e.g. TGĐ): they see only the requests given to them.
--   * Extra columns HR adds (text, number, money, date, choice list, yes/no), changed through the same
--     approved requests, imported / exported by column name. A column with values is hidden, not deleted.
--   * The approvers list of a request is kept when it is sent; later setting changes do not move it.

-- ── 1. Tables ───────────────────────────────────────────────────────────────
create table if not exists public.hrm_roster_settings (
  id boolean primary key default true check (id),
  general_step1 uuid[] not null default '{}',
  general_step2 uuid[] not null default '{}',
  pay_step1 uuid[] not null default '{}',
  pay_step2 uuid[] not null default '{}',
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.hrm_roster_settings enable row level security;
revoke all on public.hrm_roster_settings from public, anon, authenticated;

insert into public.hrm_roster_settings (id, pay_step2)
values (true, coalesce((
  select array_agg(u.id) from (
    select u.id from public.users u join public.employees e on e.user_id = u.id
    where e.full_name = 'Dương Xuân Thịnh' and e.status = 'Đang làm việc' and coalesce(u.is_active, true) limit 1
  ) u), '{}'))
on conflict (id) do nothing;

create table if not exists public.hrm_roster_custom_fields (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^custom:[a-z0-9_]{3,40}$'),
  label text not null,
  group_key text not null check (group_key in ('position', 'contract', 'personal', 'pay', 'other')),
  field_type text not null check (field_type in ('text', 'number', 'money', 'date', 'select', 'boolean')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  pay_only boolean not null default false,
  hint text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
create unique index if not exists hrm_roster_custom_fields_label_idx on public.hrm_roster_custom_fields (lower(label));

create table if not exists public.hrm_employee_custom_values (
  employee_id uuid not null references public.employees(id) on delete cascade,
  field_id uuid not null references public.hrm_roster_custom_fields(id) on delete cascade,
  value jsonb not null,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (employee_id, field_id)
);
create index if not exists hrm_employee_custom_values_field_idx on public.hrm_employee_custom_values (field_id);

alter table public.hrm_roster_custom_fields enable row level security;
alter table public.hrm_employee_custom_values enable row level security;
revoke all on public.hrm_roster_custom_fields, public.hrm_employee_custom_values from public, anon, authenticated;

alter table public.hrm_roster_batches add column if not exists approval_group text not null default 'general';
alter table public.hrm_roster_batches add column if not exists step_count integer not null default 1;
alter table public.hrm_roster_batches add column if not exists current_step integer not null default 1;
alter table public.hrm_roster_batches add column if not exists step1_approvers uuid[] not null default '{}';
alter table public.hrm_roster_batches add column if not exists step2_approvers uuid[] not null default '{}';
alter table public.hrm_roster_batches add column if not exists step1_decided_by uuid references public.users(id);
alter table public.hrm_roster_batches add column if not exists step1_decided_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hrm_roster_batches_group_check') then
    alter table public.hrm_roster_batches add constraint hrm_roster_batches_group_check
      check (approval_group in ('general', 'pay') and step_count in (1, 2) and current_step between 1 and step_count);
  end if;
end;
$$;

-- ── 2. Helpers ──────────────────────────────────────────────────────────────
create or replace function app_private.hrm_roster_is_pay_field(p_field text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_field = any(app_private.hrm_roster_pay_fields())
    or exists (select 1 from public.hrm_roster_custom_fields field where field.key = p_field and (field.pay_only or field.group_key = 'pay'));
$function$;
revoke all on function app_private.hrm_roster_is_pay_field(text) from public, anon, authenticated;

-- Standard pay fields plus custom columns of the pay group / HR Manage only, as one list.
create or replace function app_private.hrm_roster_pay_keys()
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  select app_private.hrm_roster_pay_fields() || coalesce((
    select array_agg(field.key) from public.hrm_roster_custom_fields field where field.pay_only or field.group_key = 'pay'), '{}');
$function$;
revoke all on function app_private.hrm_roster_pay_keys() from public, anon, authenticated;

-- Configured approvers of a group and step, active accounts only; an empty step 1 means HR Manage.
-- p_default: HR Manage list when the caller already has it (finding it reads every account's rights).
create or replace function app_private.hrm_roster_chain_step(p_group text, p_step integer, p_default uuid[] default null)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  with configured as (
    select case when p_group = 'pay' then case when p_step = 1 then s.pay_step1 else s.pay_step2 end
                else case when p_step = 1 then s.general_step1 else s.general_step2 end end as ids
    from public.hrm_roster_settings s where s.id
  ), active as (
    select coalesce(array_agg(u.id order by array_position(configured.ids, u.id)), '{}') as ids
    from configured join public.users u on u.id = any(configured.ids) where coalesce(u.is_active, true)
  )
  select case when p_step = 1 and cardinality(active.ids) = 0 then coalesce(p_default, app_private.hrm_roster_approver_ids()) else active.ids end from active;
$function$;
revoke all on function app_private.hrm_roster_chain_step(text, integer, uuid[]) from public, anon, authenticated;

-- Requests sent before this migration keep HR Manage as their step-1 list.
update public.hrm_roster_batches set step1_approvers = app_private.hrm_roster_approver_ids()
where status = 'pending' and cardinality(step1_approvers) = 0;

-- People who may decide a step of a request: the list kept when it was sent (old requests: HR Manage).
create or replace function app_private.hrm_roster_step_list(p_batch public.hrm_roster_batches, p_step integer)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  select case when p_step = 1 then case when cardinality(p_batch.step1_approvers) > 0 then p_batch.step1_approvers else app_private.hrm_roster_approver_ids() end
    else p_batch.step2_approvers end;
$function$;
revoke all on function app_private.hrm_roster_step_list(public.hrm_roster_batches, integer) from public, anon, authenticated;

-- Someone without HR rights who is named as an approver (in Cấu hình or on a pending request).
create or replace function app_private.hrm_roster_is_named_approver(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null and (
    exists (select 1 from public.hrm_roster_settings s where p_user_id = any(s.general_step1 || s.general_step2 || s.pay_step1 || s.pay_step2))
    or exists (select 1 from public.hrm_roster_batches batch where batch.status = 'pending' and p_user_id = any(batch.step1_approvers || batch.step2_approvers))
  );
$function$;
revoke all on function app_private.hrm_roster_is_named_approver(uuid) from public, anon, authenticated;

create or replace function app_private.hrm_roster_batch_visible(p_batch public.hrm_roster_batches, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select app_private.hrm_roster_access(p_user_id) is not null
    or p_user_id = any(app_private.hrm_roster_step_list(p_batch, 1) || p_batch.step2_approvers);
$function$;
revoke all on function app_private.hrm_roster_batch_visible(public.hrm_roster_batches, uuid) from public, anon, authenticated;

create or replace function app_private.hrm_roster_can_configure(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null and (app_private.has_hrm_template_permission(p_user_id, 'hrm.master_data.manage')
    or (p_user_id = public.current_app_user_id() and public.is_admin()));
$function$;
revoke all on function app_private.hrm_roster_can_configure(uuid) from public, anon, authenticated;

create or replace function app_private.hrm_roster_custom_field_json(p_field public.hrm_roster_custom_fields)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object('id', p_field.id, 'key', p_field.key, 'label', p_field.label, 'group', p_field.group_key,
    'type', p_field.field_type, 'options', p_field.options, 'required', p_field.required,
    'payOnly', p_field.pay_only or p_field.group_key = 'pay', 'hint', p_field.hint, 'sortOrder', p_field.sort_order,
    'isActive', p_field.is_active,
    'filledCount', (select count(*) from public.hrm_employee_custom_values value where value.field_id = p_field.id));
$function$;
revoke all on function app_private.hrm_roster_custom_field_json(public.hrm_roster_custom_fields) from public, anon, authenticated;

-- ── 3. Values, checks, request JSON (replacing 20261017120000) ──────────────
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
  || coalesce((
    select jsonb_object_agg(field.key, value.value) from public.hrm_employee_custom_values value
    join public.hrm_roster_custom_fields field on field.id = value.field_id
    where value.employee_id = e.id and (p_with_pay or not (field.pay_only or field.group_key = 'pay'))
  ), '{}'::jsonb)
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
  v_custom public.hrm_roster_custom_fields%rowtype;
begin
  if p_field like 'custom:%' then
    select * into v_custom from public.hrm_roster_custom_fields field where field.key = p_field and field.is_active;
    if v_custom.id is null then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_FIELD_UNKNOWN', detail = p_field;
    end if;
  elsif p_field is null or not p_field = any(array['fullName', 'employeeCode', 'orgUnit', 'position', 'level', 'startDate', 'officialDate',
    'leaveRemaining', 'phone', 'dateOfBirth', 'gender', 'idNumber', 'idIssuedDate', 'idIssuedPlace', 'permanentAddress', 'education',
    'institution'] || app_private.hrm_roster_pay_fields()) then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_FIELD_UNKNOWN', detail = coalesce(p_field, '');
  end if;
  if v_text = '' then v_text := null; end if;
  if v_text is null then
    if p_field in ('fullName', 'employeeCode', 'orgUnit', 'position', 'level', 'startDate', 'leaveRemaining', 'phone',
      'dateOfBirth', 'gender', 'idNumber') or coalesce(v_custom.required, false) then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_VALUE_INVALID', detail = p_field;
    end if;
    return 'null'::jsonb;
  end if;
  begin
    if v_custom.id is not null then
      case v_custom.field_type
        when 'text' then
          if length(v_text) <= 500 then return to_jsonb(v_text); end if;
        when 'number' then
          v_num := v_text::numeric;
          if abs(v_num) < 1000000000000 then return to_jsonb(v_num); end if;
        when 'money' then
          v_num := round(v_text::numeric);
          if v_num between 0 and 10000000000 then return to_jsonb(v_num); end if;
        when 'date' then
          v_date := v_text::date;
          if v_date between date '1900-01-01' and date '2100-12-31' then return to_jsonb(v_date); end if;
        when 'select' then
          if v_custom.options ? v_text then return to_jsonb(v_text); end if;
        when 'boolean' then
          if v_text in ('Có', 'Không') then return to_jsonb(v_text); end if;
        else null;
      end case;
    else
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
        else null;
      end case;
    end if;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
    null;
  end;
  raise exception using errcode = '22023', message = 'HRM_ROSTER_VALUE_INVALID', detail = p_field;
end;
$function$;

-- The current step's list, not the sender, nobody about themselves, and step 2 is a different person.
create or replace function app_private.hrm_roster_can_decide(p_batch public.hrm_roster_batches, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_batch.status = 'pending' and p_user_id is not null and p_user_id <> p_batch.created_by
    and p_user_id = any(app_private.hrm_roster_step_list(p_batch, p_batch.current_step))
    and (p_batch.current_step = 1 or p_user_id is distinct from p_batch.step1_decided_by)
    and not exists (
      select 1 from public.hrm_roster_batch_items item join public.employees employee on employee.id = item.employee_id
      where item.batch_id = p_batch.id and employee.user_id = p_user_id
    );
$function$;

create or replace function app_private.hrm_roster_batch_json(p_batch public.hrm_roster_batches, p_with_items boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_can_decide boolean := app_private.hrm_roster_can_decide(p_batch, v_user);
  v_step1 uuid[] := app_private.hrm_roster_step_list(p_batch, 1);
  v_pay boolean := app_private.hrm_roster_access(v_user) = 'HR_MANAGE' or v_user = any(v_step1 || p_batch.step2_approvers);
  v_names jsonb;
  v_pay_keys text[] := app_private.hrm_roster_pay_keys();
begin
  v_names := case when p_batch.status = 'pending' then coalesce((
      select jsonb_agg(u.name order by u.name) from public.users u
      where u.id = any(app_private.hrm_roster_step_list(p_batch, p_batch.current_step)) and app_private.hrm_roster_can_decide(p_batch, u.id)), '[]'::jsonb)
    when p_batch.decided_by is null then '[]'::jsonb
    else jsonb_build_array((select u.name from public.users u where u.id = p_batch.decided_by)) end;
  return jsonb_build_object(
    'id', p_batch.id, 'code', p_batch.code, 'source', p_batch.source, 'title', p_batch.title, 'reason', p_batch.reason,
    'effectiveDate', p_batch.effective_date, 'status', p_batch.status, 'fileName', p_batch.file_name,
    'approvalGroup', p_batch.approval_group, 'currentStep', p_batch.current_step,
    'steps', (
      select jsonb_agg(jsonb_build_object(
        'step', step,
        'approverNames', coalesce((select jsonb_agg(u.name order by u.name) from public.users u
          where u.id = any(app_private.hrm_roster_step_list(p_batch, step))), '[]'::jsonb),
        'decidedByName', (select u.name from public.users u where u.id = case when step = 1 then p_batch.step1_decided_by
          when p_batch.status = 'approved' then p_batch.decided_by end),
        'decidedAt', case when step = 1 then p_batch.step1_decided_at when p_batch.status = 'approved' then p_batch.decided_at end
      ) order by step) from generate_series(1, p_batch.step_count) step),
    'createdByName', (select u.name from public.users u where u.id = p_batch.created_by), 'createdAt', p_batch.created_at,
    'decidedByName', (select u.name from public.users u where u.id = p_batch.decided_by), 'decidedAt', p_batch.decided_at,
    'decisionNote', p_batch.decision_note, 'approverNames', v_names,
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
        order by item.full_name, item.person_key, app_private.hrm_roster_field_order(item.field), item.field)
      from public.hrm_roster_batch_items item left join public.employees employee on employee.id = item.employee_id
      where item.batch_id = p_batch.id and (v_pay or not item.field = any(v_pay_keys))
    ), '[]'::jsonb) end
  );
end;
$function$;

-- ── 4. Roster ───────────────────────────────────────────────────────────────
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

-- ── 5. Submit: split pay and approvers' own rows, keep the approver lists ──
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
  v_batch_ids uuid[];
  v_group_ids uuid[];
  v_id uuid;
  v_chain uuid[];
  v_step2 uuid[];
  v_current jsonb := '{}'::jsonb;
  v_pay_keys text[] := app_private.hrm_roster_pay_keys();
  v_default uuid[] := app_private.hrm_roster_approver_ids();
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

  insert into public.hrm_roster_batches (code, source, title, reason, effective_date, file_name, created_by)
  values ('PTD-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.hrm_roster_batch_seq')::text, 4, '0'),
    p_source, left(coalesce(nullif(btrim(p_title), ''), 'Thay đổi nhân sự'), 200), btrim(p_reason), p_effective_date,
    nullif(left(btrim(coalesce(p_file_name, '')), 200), ''), v_user)
  returning * into v_batch;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_field := v_item ->> 'field';
    if v_field = any(v_pay_keys) and v_access <> 'HR_MANAGE' then
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
    if v_old is null and v_emp is not null and v_new = 'null'::jsonb then continue; end if;
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

  -- Pay cells follow the Lương & phụ cấp approvers.
  if exists (select 1 from public.hrm_roster_batch_items item where item.batch_id = v_batch.id and item.field = any(v_pay_keys)) then
    if exists (select 1 from public.hrm_roster_batch_items item where item.batch_id = v_batch.id and not item.field = any(v_pay_keys)) then
      insert into public.hrm_roster_batches (code, source, title, reason, effective_date, file_name, created_by, approval_group)
      values ('PTD-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.hrm_roster_batch_seq')::text, 4, '0'),
        v_batch.source, left(v_batch.title || ' · Lương', 200), v_batch.reason, v_batch.effective_date, v_batch.file_name, v_user, 'pay')
      returning * into v_split;
      update public.hrm_roster_batch_items set batch_id = v_split.id
      where batch_id = v_batch.id and field = any(v_pay_keys);
      v_group_ids := array[v_batch.id, v_split.id];
    else
      update public.hrm_roster_batches set approval_group = 'pay' where id = v_batch.id;
      v_group_ids := array[v_batch.id];
    end if;
  else
    v_group_ids := array[v_batch.id];
  end if;

  -- Rows about an approver of that chain go to their own request so another approver decides them.
  v_batch_ids := '{}';
  foreach v_id in array v_group_ids loop
    select * into v_split from public.hrm_roster_batches where id = v_id;
    v_chain := app_private.hrm_roster_chain_step(v_split.approval_group, 1, v_default) || app_private.hrm_roster_chain_step(v_split.approval_group, 2);
    for v_person in
      select distinct item.employee_id, employee.full_name
      from public.hrm_roster_batch_items item join public.employees employee on employee.id = item.employee_id
      where item.batch_id = v_id and employee.user_id = any(v_chain)
        and exists (select 1 from public.hrm_roster_batch_items other where other.batch_id = v_id and other.employee_id is distinct from item.employee_id)
    loop
      insert into public.hrm_roster_batches (code, source, title, reason, effective_date, file_name, created_by, approval_group)
      values ('PTD-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.hrm_roster_batch_seq')::text, 4, '0'),
        v_split.source, left(v_split.title || ' · ' || v_person.full_name, 200), v_split.reason, v_split.effective_date, v_split.file_name,
        v_user, v_split.approval_group)
      returning id into v_emp;
      update public.hrm_roster_batch_items set batch_id = v_emp where batch_id = v_id and employee_id = v_person.employee_id;
      v_batch_ids := v_batch_ids || v_emp;
    end loop;
    if exists (select 1 from public.hrm_roster_batch_items item where item.batch_id = v_id) then
      v_batch_ids := v_batch_ids || v_id;
    else
      delete from public.hrm_roster_batches where id = v_id;
    end if;
  end loop;

  update public.hrm_roster_batches batch set
    people_count = counts.people, new_people_count = counts.new_people, item_count = counts.items,
    step1_approvers = app_private.hrm_roster_chain_step(batch.approval_group, 1, v_default)
  from (
    select item.batch_id, count(distinct item.person_key) as people,
      count(distinct item.person_key) filter (where item.employee_id is null) as new_people, count(*) as items
    from public.hrm_roster_batch_items item where item.batch_id = any(v_batch_ids) group by item.batch_id
  ) counts where batch.id = counts.batch_id;

  for v_split in select * from public.hrm_roster_batches batch where batch.id = any(v_batch_ids) order by batch.code loop
    -- Step 2 only with someone who may decide it (not the sender, not a person in the request).
    v_step2 := array(select approver from unnest(app_private.hrm_roster_chain_step(v_split.approval_group, 2)) approver
      where approver <> v_user and not exists (
        select 1 from public.hrm_roster_batch_items item join public.employees employee on employee.id = item.employee_id
        where item.batch_id = v_split.id and employee.user_id = approver));
    update public.hrm_roster_batches set step2_approvers = v_step2, step_count = case when cardinality(v_step2) > 0 then 2 else 1 end
    where id = v_split.id returning * into v_split;
    if not exists (select 1 from unnest(v_split.step1_approvers) approver where app_private.hrm_roster_can_decide(v_split, approver)) then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_NO_APPROVER', detail = v_split.code;
    end if;
    v_codes := v_codes || to_jsonb(v_split.code);
    perform app_private.notify_hrm_profile(
      array(select approver from unnest(v_split.step1_approvers) approver where app_private.hrm_roster_can_decide(v_split, approver)),
      'Phiếu thay đổi nhân sự chờ duyệt',
      v_split.code || ' · ' || v_split.title || ' — ' || v_split.item_count || ' thay đổi, ' || v_split.people_count || ' người.',
      '/hrm/employees?view=roster&tab=batches&batch=' || v_split.id, v_split.id, 'system');
  end loop;

  select * into v_batch from public.hrm_roster_batches where id = coalesce(
    (select id from public.hrm_roster_batches where id = v_batch.id), v_batch_ids[1]);
  return jsonb_build_object('id', v_batch.id, 'code', v_batch.code, 'codes', v_codes,
    'approverNames', app_private.hrm_roster_batch_json(v_batch, false) -> 'approverNames');
end;
$function$;

-- ── 6. List, open (non-HR approvers see their own requests only) ──────────
create or replace function public.list_hrm_roster_batches(p_scope text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_hr boolean := app_private.hrm_roster_access(v_user) is not null;
begin
  if not v_hr and not app_private.hrm_roster_is_named_approver(v_user) then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_HR_ONLY';
  end if;
  return coalesce((
    select jsonb_agg(app_private.hrm_roster_batch_json(batch, false) order by coalesce(batch.decided_at, batch.created_at) desc)
    from public.hrm_roster_batches batch
    where ((p_scope = 'pending' and batch.status = 'pending')
       or (p_scope = 'returned' and batch.status = 'returned' and batch.decided_at > now() - interval '90 days')
       or (p_scope = 'approved' and batch.status = 'approved' and batch.decided_at > now() - interval '30 days'))
      and (v_hr or app_private.hrm_roster_batch_visible(batch, v_user))
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.get_hrm_roster_batch(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_batch public.hrm_roster_batches%rowtype;
begin
  select * into v_batch from public.hrm_roster_batches where id = p_id;
  if v_batch.id is null then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_NOT_FOUND';
  end if;
  if not app_private.hrm_roster_batch_visible(v_batch, public.current_app_user_id()) then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_HR_ONLY';
  end if;
  return app_private.hrm_roster_batch_json(v_batch, true);
end;
$function$;

-- ── 7. Apply (custom columns added) and decide (two steps) ─────────────────
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

  perform app_private.audit_hrm_profile_command(v_emp, 'HRM_ROSTER', p_batch.code, case when v_is_new then 'INSERT' else 'UPDATE' end,
    v_reason, v_fields);
exception when unique_violation then
  raise exception using errcode = '22023', message = 'HRM_ROSTER_CODE_TAKEN', detail = coalesce(v_items ->> 'employeeCode', '');
end;
$function$;

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
  if not app_private.hrm_roster_can_decide(v_batch, v_user) then
    if v_user = any(app_private.hrm_roster_step_list(v_batch, v_batch.current_step)) then
      raise exception using errcode = '42501', message = 'HRM_ROSTER_SELF_DECISION';
    end if;
    raise exception using errcode = '42501', message = 'HRM_ROSTER_NOT_APPROVER';
  end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_REASON_REQUIRED';
  end if;

  if p_approve and v_batch.current_step < v_batch.step_count then
    update public.hrm_roster_batches set step1_decided_by = v_user, step1_decided_at = now(), current_step = 2, updated_at = now()
    where id = p_id returning * into v_batch;
    perform app_private.notify_hrm_profile(
      array(select approver from unnest(v_batch.step2_approvers) approver where app_private.hrm_roster_can_decide(v_batch, approver)),
      'Phiếu thay đổi nhân sự chờ duyệt bước 2',
      v_batch.code || ' · ' || v_batch.title || ' — ' || v_batch.item_count || ' thay đổi, ' || v_batch.people_count || ' người.',
      '/hrm/employees?view=roster&tab=batches&batch=' || v_batch.id, v_batch.id, 'system');
    perform app_private.notify_hrm_profile(array[v_batch.created_by], 'Phiếu thay đổi nhân sự đã qua bước 1',
      v_batch.code || ' · ' || v_batch.title || ' — chờ duyệt bước 2.', '/hrm/employees?view=roster&tab=batches&batch=' || v_batch.id,
      v_batch.id, 'system');
    return app_private.hrm_roster_batch_json(v_batch, true);
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
    step1_decided_by = case when p_approve and current_step = 1 then v_user else step1_decided_by end,
    step1_decided_at = case when p_approve and current_step = 1 then now() else step1_decided_at end,
    decided_by = v_user, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
  where id = p_id returning * into v_batch;

  perform app_private.notify_hrm_profile(array[v_batch.created_by],
    case when p_approve then 'Phiếu thay đổi nhân sự đã duyệt' else 'Phiếu thay đổi nhân sự bị trả lại' end,
    v_batch.code || ' · ' || v_batch.title || case when p_approve then ' — hồ sơ đã cập nhật.' else ' — ' || btrim(p_note) end,
    '/hrm/employees?view=roster&tab=batches&batch=' || v_batch.id, v_batch.id, 'system');
  return app_private.hrm_roster_batch_json(v_batch, true);
end;
$function$;

-- ── 8. Cấu hình RPCs ────────────────────────────────────────────────────────
create or replace function app_private.hrm_roster_config_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'approvals', jsonb_build_object(
      'general', jsonb_build_object('step1', to_jsonb(coalesce(s.general_step1, '{}')), 'step2', to_jsonb(coalesce(s.general_step2, '{}'))),
      'pay', jsonb_build_object('step1', to_jsonb(coalesce(s.pay_step1, '{}')), 'step2', to_jsonb(coalesce(s.pay_step2, '{}')))),
    'defaultApproverIds', to_jsonb(app_private.hrm_roster_approver_ids()),
    'customFields', coalesce((select jsonb_agg(app_private.hrm_roster_custom_field_json(field) order by field.sort_order, field.label)
      from public.hrm_roster_custom_fields field), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object(
        'userId', u.id, 'name', u.name, 'employeeCode', e.employee_code, 'positionName', coalesce(p.name, e.title),
        'role', coalesce(app_private.hrm_roster_access(u.id), 'OTHER')) order by u.name)
      from public.users u
      left join lateral (select e.* from public.employees e where e.user_id = u.id and e.status = 'Đang làm việc' order by e.created_at limit 1) e on true
      left join public.hrm_positions p on p.id = e.position_id
      where coalesce(u.is_active, true) and u.auth_id is not null), '[]'::jsonb),
    'updatedByName', (select u.name from public.users u where u.id = s.updated_by),
    'updatedAt', s.updated_at
  )
  from (select null::integer as dummy) seed left join public.hrm_roster_settings s on s.id;
$function$;
revoke all on function app_private.hrm_roster_config_json() from public, anon, authenticated;

create or replace function public.get_hrm_roster_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app_private.hrm_roster_can_configure(public.current_app_user_id()) then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_CONFIG_FORBIDDEN';
  end if;
  return app_private.hrm_roster_config_json();
end;
$function$;
revoke all on function public.get_hrm_roster_config() from public, anon;
grant execute on function public.get_hrm_roster_config() to authenticated;

create or replace function public.save_hrm_roster_approvals(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_path text[];
  v_ids uuid[];
  v_result jsonb := '{}'::jsonb;
begin
  if not app_private.hrm_roster_can_configure(v_user) then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_CONFIG_FORBIDDEN';
  end if;
  foreach v_path slice 1 in array array[array['general', 'step1'], array['general', 'step2'], array['pay', 'step1'], array['pay', 'step2']] loop
    if jsonb_typeof(p_settings #> v_path) is distinct from 'array' then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_APPROVER_INVALID', detail = array_to_string(v_path, '.');
    end if;
    -- Keep the order HR chose, drop repeats.
    begin
      v_ids := array(select picked.value::uuid from (
        select t.value, min(t.n) as n from jsonb_array_elements_text(p_settings #> v_path) with ordinality as t(value, n) group by t.value
      ) picked order by picked.n);
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_APPROVER_INVALID', detail = array_to_string(v_path, '.');
    end;
    if cardinality(v_ids) > 20 or exists (select 1 from unnest(v_ids) picked(id) where not exists (
      select 1 from public.users u where u.id = picked.id and coalesce(u.is_active, true) and u.auth_id is not null)) then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_APPROVER_INVALID', detail = array_to_string(v_path, '.');
    end if;
    v_result := jsonb_set(v_result, array[v_path[1]], coalesce(v_result -> v_path[1], '{}'::jsonb) || jsonb_build_object(v_path[2], to_jsonb(v_ids)));
  end loop;

  insert into public.hrm_roster_settings (id, general_step1, general_step2, pay_step1, pay_step2, updated_by, updated_at)
  values (true,
    array(select jsonb_array_elements_text(v_result #> '{general,step1}')::uuid), array(select jsonb_array_elements_text(v_result #> '{general,step2}')::uuid),
    array(select jsonb_array_elements_text(v_result #> '{pay,step1}')::uuid), array(select jsonb_array_elements_text(v_result #> '{pay,step2}')::uuid),
    v_user, now())
  on conflict (id) do update set general_step1 = excluded.general_step1, general_step2 = excluded.general_step2,
    pay_step1 = excluded.pay_step1, pay_step2 = excluded.pay_step2, updated_by = v_user, updated_at = now();

  insert into public.audit_trail (table_name, record_id, action, user_id, module, description, record_label, entity_type,
    changed_fields, change_count, impact_level, context)
  values ('hrm_roster_settings', 'approvals', 'UPDATE', v_user::text, 'HRM', 'Cấu hình người duyệt Bảng nhân sự', 'Người duyệt',
    'HRM_ROSTER_SETTINGS', array['general_step1', 'general_step2', 'pay_step1', 'pay_step2'], 4, 'high', jsonb_build_object('settings', v_result));
  return app_private.hrm_roster_config_json();
end;
$function$;
revoke all on function public.save_hrm_roster_approvals(jsonb) from public, anon;
grant execute on function public.save_hrm_roster_approvals(jsonb) to authenticated;

create or replace function public.save_hrm_roster_custom_field(
  p_id uuid, p_label text, p_group text, p_type text, p_options text[], p_required boolean, p_pay_only boolean, p_hint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_field public.hrm_roster_custom_fields%rowtype;
  v_label text := regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g');
  v_options text[] := array(select distinct on (lower(btrim(option))) btrim(option) from unnest(coalesce(p_options, '{}')) with ordinality as t(option, n)
    where btrim(option) <> '' order by lower(btrim(option)), n);
  v_values integer;
begin
  if not app_private.hrm_roster_can_configure(v_user) then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_CONFIG_FORBIDDEN';
  end if;
  -- keep the order HR typed
  v_options := array(select btrim(option) from unnest(coalesce(p_options, '{}')) with ordinality as t(option, n)
    where btrim(option) = any(v_options) group by btrim(option) order by min(n));
  if length(v_label) not between 2 and 60 or coalesce(p_group, '') not in ('position', 'contract', 'personal', 'pay', 'other')
    or coalesce(p_type, '') not in ('text', 'number', 'money', 'date', 'select', 'boolean')
    or (p_type = 'select' and (cardinality(v_options) < 2 or cardinality(v_options) > 50 or exists (select 1 from unnest(v_options) o where length(o) > 80)))
    or length(coalesce(p_hint, '')) > 200
  then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_CUSTOM_FIELD_INVALID';
  end if;
  if lower(v_label) = any(array['họ và tên', 'mã nv', 'bộ phận', 'chức danh', 'level', 'ngày vào', 'ngày chính thức', 'phép năm còn', 'sđt',
    'ngày sinh', 'giới tính', 'cccd', 'ngày cấp', 'nơi cấp', 'địa chỉ thường trú', 'trình độ', 'nơi đào tạo', 'lương cơ bản (p1)', 'pctn (p2)',
    'pc điện thoại', 'p3 tiêu chuẩn', 'pc giữ gìn xe', 'thâm niên (đ)', 'ghi chú (hr manage)', 'mã nv cũ', 'nhóm', 'thâm niên', 'tổng lương',
    'tổng sau thâm niên'])
    or exists (select 1 from public.hrm_roster_custom_fields other where lower(other.label) = lower(v_label) and other.id is distinct from p_id)
  then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_CUSTOM_FIELD_DUPLICATE';
  end if;

  if p_id is null then
    insert into public.hrm_roster_custom_fields (key, label, group_key, field_type, options, required, pay_only, hint, sort_order, created_by, updated_by)
    values ('custom:' || left(replace(gen_random_uuid()::text, '-', ''), 12), v_label, p_group, p_type,
      case when p_type = 'select' then to_jsonb(v_options) else '[]'::jsonb end, coalesce(p_required, false),
      coalesce(p_pay_only, false) or p_group = 'pay', nullif(btrim(coalesce(p_hint, '')), ''),
      coalesce((select max(sort_order) from public.hrm_roster_custom_fields), 0) + 1, v_user, v_user)
    returning * into v_field;
  else
    select * into v_field from public.hrm_roster_custom_fields where id = p_id for update;
    if v_field.id is null then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_CUSTOM_FIELD_INVALID';
    end if;
    select count(*) into v_values from public.hrm_employee_custom_values where field_id = v_field.id;
    if (v_field.field_type <> p_type or (p_type = 'select' and v_field.options <> to_jsonb(v_options)))
      and exists (select 1 from public.hrm_roster_batch_items item join public.hrm_roster_batches batch on batch.id = item.batch_id
        where item.field = v_field.key and batch.status = 'pending') then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_CUSTOM_FIELD_PENDING';
    end if;
    if v_field.field_type <> p_type and v_values > 0 then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_CUSTOM_FIELD_TYPE_LOCKED';
    end if;
    if p_type = 'select' and exists (select 1 from public.hrm_employee_custom_values value
      where value.field_id = v_field.id and not (value.value #>> '{}') = any(v_options)) then
      raise exception using errcode = '22023', message = 'HRM_ROSTER_CUSTOM_FIELD_OPTION_IN_USE';
    end if;
    update public.hrm_roster_custom_fields set label = v_label, group_key = p_group, field_type = p_type,
      options = case when p_type = 'select' then to_jsonb(v_options) else '[]'::jsonb end, required = coalesce(p_required, false),
      pay_only = coalesce(p_pay_only, false) or p_group = 'pay', hint = nullif(btrim(coalesce(p_hint, '')), ''),
      updated_by = v_user, updated_at = now()
    where id = v_field.id returning * into v_field;
  end if;

  insert into public.audit_trail (table_name, record_id, action, user_id, module, description, record_label, entity_type,
    changed_fields, change_count, impact_level, context)
  values ('hrm_roster_custom_fields', v_field.id::text, case when p_id is null then 'INSERT' else 'UPDATE' end, v_user::text, 'HRM',
    'Cột thông tin Hồ sơ nhân sự', v_field.label, 'HRM_ROSTER_CUSTOM_FIELD', array['label', 'group_key', 'field_type', 'options', 'required', 'pay_only'], 6,
    'normal', jsonb_build_object('key', v_field.key));
  return app_private.hrm_roster_custom_field_json(v_field);
end;
$function$;
revoke all on function public.save_hrm_roster_custom_field(uuid, text, text, text, text[], boolean, boolean, text) from public, anon;
grant execute on function public.save_hrm_roster_custom_field(uuid, text, text, text, text[], boolean, boolean, text) to authenticated;

create or replace function public.set_hrm_roster_custom_field_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_field public.hrm_roster_custom_fields%rowtype;
begin
  if not app_private.hrm_roster_can_configure(public.current_app_user_id()) then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_CONFIG_FORBIDDEN';
  end if;
  update public.hrm_roster_custom_fields set is_active = coalesce(p_active, true), updated_by = public.current_app_user_id(), updated_at = now()
  where id = p_id returning * into v_field;
  if v_field.id is null then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_CUSTOM_FIELD_INVALID';
  end if;
  return app_private.hrm_roster_custom_field_json(v_field);
end;
$function$;
revoke all on function public.set_hrm_roster_custom_field_active(uuid, boolean) from public, anon;
grant execute on function public.set_hrm_roster_custom_field_active(uuid, boolean) to authenticated;

create or replace function public.reorder_hrm_roster_custom_fields(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not app_private.hrm_roster_can_configure(public.current_app_user_id()) then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_CONFIG_FORBIDDEN';
  end if;
  update public.hrm_roster_custom_fields field set sort_order = ordered.n, updated_at = now()
  from unnest(coalesce(p_ids, '{}')) with ordinality as ordered(id, n) where field.id = ordered.id;
end;
$function$;
revoke all on function public.reorder_hrm_roster_custom_fields(uuid[]) from public, anon;
grant execute on function public.reorder_hrm_roster_custom_fields(uuid[]) to authenticated;

create or replace function public.delete_hrm_roster_custom_field(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_field public.hrm_roster_custom_fields%rowtype;
begin
  if not app_private.hrm_roster_can_configure(public.current_app_user_id()) then
    raise exception using errcode = '42501', message = 'HRM_ROSTER_CONFIG_FORBIDDEN';
  end if;
  select * into v_field from public.hrm_roster_custom_fields where id = p_id for update;
  if v_field.id is null then return; end if;
  if exists (select 1 from public.hrm_employee_custom_values where field_id = v_field.id)
    or exists (select 1 from public.hrm_roster_batch_items where field = v_field.key) then
    raise exception using errcode = '22023', message = 'HRM_ROSTER_CUSTOM_FIELD_IN_USE';
  end if;
  delete from public.hrm_roster_custom_fields where id = v_field.id;
  insert into public.audit_trail (table_name, record_id, action, user_id, module, description, record_label, entity_type,
    changed_fields, change_count, impact_level, context)
  values ('hrm_roster_custom_fields', v_field.id::text, 'DELETE', public.current_app_user_id()::text, 'HRM', 'Xóa cột thông tin Hồ sơ nhân sự',
    v_field.label, 'HRM_ROSTER_CUSTOM_FIELD', array['label'], 1, 'normal', jsonb_build_object('key', v_field.key));
end;
$function$;
revoke all on function public.delete_hrm_roster_custom_field(uuid) from public, anon;
grant execute on function public.delete_hrm_roster_custom_field(uuid) to authenticated;

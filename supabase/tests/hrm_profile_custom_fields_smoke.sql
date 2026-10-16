-- Run after 20261017140000_hrm_profile_custom_fields. Rolls back.
begin;
set local statement_timeout = '60s';

-- HR (no pay, may edit), HR Manage, an employee X with an account and no HR rights, another employee E.
select set_config('test.p.hr_auth', u.auth_id::text, true), set_config('test.p.hr_id', u.id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR'
  and app_private.has_hrm_template_permission(u.id, 'hrm.employee.edit_profile') order by u.name limit 1;
select set_config('test.p.mgr_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR_MANAGE' order by u.name limit 1;
select set_config('test.p.x_auth', u.auth_id::text, true), set_config('test.p.x_emp', e.id::text, true)
from public.users u join public.employees e on e.user_id = u.id and e.status = 'Đang làm việc'
where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) is null order by u.name limit 1;
select set_config('test.p.e_emp', e.id::text, true)
from public.employees e where e.status = 'Đang làm việc' and e.id::text <> current_setting('test.p.x_emp', true)
  and (e.user_id is null or app_private.hrm_roster_access(e.user_id) is null) order by e.employee_code limit 1;

do $$
begin
  if current_setting('test.p.hr_auth', true) is null or current_setting('test.p.mgr_auth', true) is null
    or current_setting('test.p.x_auth', true) is null or current_setting('test.p.e_emp', true) is null then
    raise exception 'PROFILE_CF_FIXTURE_MISSING';
  end if;
end;
$$;

-- Columns: open text, required position column without a value, "HR Manage only", pay group, hidden.
with fields as (
  insert into public.hrm_roster_custom_fields (key, label, group_key, field_type, options, required, pay_only, hint, sort_order, is_active)
  values ('custom:smoke_size', 'Size áo smoke', 'personal', 'select', '["M", "L"]', false, false, 'Áo BHLĐ', 9001, true),
         ('custom:smoke_req', 'Mã thẻ smoke', 'position', 'text', '[]', true, false, null, 9002, true),
         ('custom:smoke_private', 'Ghi chú riêng smoke', 'other', 'text', '[]', false, true, null, 9003, true),
         ('custom:smoke_pay', 'Lương BHXH smoke', 'pay', 'money', '[]', false, false, null, 9004, true),
         ('custom:smoke_off', 'Cột ẩn smoke', 'other', 'text', '[]', false, false, null, 9005, false)
  returning id, key
)
insert into public.hrm_employee_custom_values (employee_id, field_id, value)
select current_setting('test.p.x_emp')::uuid, fields.id, case fields.key
  when 'custom:smoke_size' then '"M"'::jsonb when 'custom:smoke_private' then '"bí mật"'::jsonb
  when 'custom:smoke_pay' then '6500000'::jsonb when 'custom:smoke_off' then '"không hiện"'::jsonb end
from fields where fields.key <> 'custom:smoke_req';

-- A pending request changing X's size.
with batch as (
  insert into public.hrm_roster_batches (code, source, title, reason, effective_date, created_by, step1_approvers)
  values ('PTD-SMOKE-CF', 'grid', 'Đổi size smoke', 'Smoke test cột thêm hồ sơ', current_date,
    current_setting('test.p.hr_id')::uuid, app_private.hrm_roster_approver_ids())
  returning id
)
insert into public.hrm_roster_batch_items (batch_id, employee_id, person_key, full_name, field, old_value, new_value)
select batch.id, e.id, e.id::text, e.full_name, 'custom:smoke_size', '"M"', '"L"'
from batch, public.employees e where e.id = current_setting('test.p.x_emp')::uuid;

select set_config('test.p.pay_hidden', (select count(*)::text from public.hrm_roster_custom_fields field
  where field.is_active and (field.pay_only or field.group_key = 'pay')), true);

-- ── X: own non-secret columns only, no pending, no edit; another person is refused ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.x_auth'))::text, true);
set local role authenticated;
do $$
declare v jsonb; v_keys text[];
begin
  v := public.get_hrm_employee_custom_fields(current_setting('test.p.x_emp')::uuid);
  select array_agg(f ->> 'key') into v_keys from jsonb_array_elements(v -> 'fields') f where f ->> 'key' like 'custom:smoke_%';
  if v ->> 'accessLevel' <> 'SELF' then raise exception 'PROFILE_CF_SELF_LEVEL %', v ->> 'accessLevel'; end if;
  if v_keys is distinct from array['custom:smoke_size', 'custom:smoke_req'] then raise exception 'PROFILE_CF_SELF_KEYS %', v_keys; end if;
  if (v -> 'can' ->> 'edit')::boolean or (v -> 'can' ->> 'viewPay')::boolean or (v ->> 'hiddenPayCount')::integer <> 0 then
    raise exception 'PROFILE_CF_SELF_CAN %', v -> 'can';
  end if;
  if exists (select 1 from jsonb_array_elements(v -> 'fields') f where f ->> 'key' = 'custom:smoke_size'
    and (f ->> 'value' <> 'M' or f -> 'pending' <> 'null'::jsonb or f -> 'updatedAt' <> 'null'::jsonb)) then
    raise exception 'PROFILE_CF_SELF_VALUE %', v -> 'fields';
  end if;
  if exists (select 1 from jsonb_array_elements(v -> 'fields') f where f ->> 'key' = 'custom:smoke_req' and f -> 'value' <> 'null'::jsonb) then
    raise exception 'PROFILE_CF_SELF_EMPTY_NOT_NULL';
  end if;
  begin
    perform public.get_hrm_employee_custom_fields(current_setting('test.p.e_emp')::uuid);
    raise exception 'PROFILE_CF_OTHER_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ── HR: every non-pay column with the pending change; told how many pay columns are hidden ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.hr_auth'))::text, true);
set local role authenticated;
do $$
declare v jsonb; v_keys text[]; v_size jsonb;
begin
  v := public.get_hrm_employee_custom_fields(current_setting('test.p.x_emp')::uuid);
  select array_agg(f ->> 'key') into v_keys from jsonb_array_elements(v -> 'fields') f where f ->> 'key' like 'custom:smoke_%';
  if v ->> 'accessLevel' <> 'HR' or not (v -> 'can' ->> 'edit')::boolean or (v -> 'can' ->> 'viewPay')::boolean then
    raise exception 'PROFILE_CF_HR_CAN %', v - 'fields';
  end if;
  if v_keys is distinct from array['custom:smoke_size', 'custom:smoke_req'] then raise exception 'PROFILE_CF_HR_KEYS %', v_keys; end if;
  if (v ->> 'hiddenPayCount')::integer <> current_setting('test.p.pay_hidden')::integer or (v ->> 'hiddenPayCount')::integer < 2 then
    raise exception 'PROFILE_CF_HR_HIDDEN %', v ->> 'hiddenPayCount';
  end if;
  select f into v_size from jsonb_array_elements(v -> 'fields') f where f ->> 'key' = 'custom:smoke_size';
  if v_size #>> '{pending,value}' <> 'L' or v_size #>> '{pending,batchCode}' <> 'PTD-SMOKE-CF' or v_size ->> 'updatedAt' is null then
    raise exception 'PROFILE_CF_HR_PENDING %', v_size;
  end if;
end;
$$;
reset role;

-- ── HR Manage: pay group and "HR Manage only" too, never the hidden column ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.mgr_auth'))::text, true);
set local role authenticated;
do $$
declare v jsonb; v_keys text[];
begin
  v := public.get_hrm_employee_custom_fields(current_setting('test.p.x_emp')::uuid);
  select array_agg(f ->> 'key') into v_keys from jsonb_array_elements(v -> 'fields') f where f ->> 'key' like 'custom:smoke_%';
  if v ->> 'accessLevel' <> 'HR_MANAGE' or not (v -> 'can' ->> 'viewPay')::boolean or (v ->> 'hiddenPayCount')::integer <> 0 then
    raise exception 'PROFILE_CF_MGR_CAN %', v - 'fields';
  end if;
  if v_keys is distinct from array['custom:smoke_size', 'custom:smoke_req', 'custom:smoke_private', 'custom:smoke_pay'] then
    raise exception 'PROFILE_CF_MGR_KEYS %', v_keys;
  end if;
  if exists (select 1 from jsonb_array_elements(v -> 'fields') f where f ->> 'key' in ('custom:smoke_private', 'custom:smoke_pay')
    and not (f ->> 'payOnly')::boolean) then
    raise exception 'PROFILE_CF_MGR_PAY_FLAG';
  end if;
  if not exists (select 1 from jsonb_array_elements(v -> 'fields') f where f ->> 'key' = 'custom:smoke_pay' and (f ->> 'value')::numeric = 6500000) then
    raise exception 'PROFILE_CF_MGR_PAY_VALUE';
  end if;
end;
$$;
reset role;

-- ── Signed out: refused ──
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  perform public.get_hrm_employee_custom_fields(current_setting('test.p.x_emp')::uuid);
  raise exception 'PROFILE_CF_ANON_ALLOWED';
exception when insufficient_privilege then null;
end;
$$;
reset role;

select 'hrm_profile_custom_fields_smoke: ok' as result;
rollback;

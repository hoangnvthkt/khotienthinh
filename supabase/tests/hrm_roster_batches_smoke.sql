-- Run after 20261017120000_hrm_roster_batches. Rolls back.
begin;
set local statement_timeout = '120s';

-- HR (proposes, no pay), two HR Manage approvers (one with an employee record), two plain subjects.
select set_config('test.r.hr_auth', u.auth_id::text, true), set_config('test.r.hr_id', u.id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR'
  and app_private.has_hrm_template_permission(u.id, 'hrm.employee.import') order by u.name limit 1;
select set_config('test.r.a_auth', u.auth_id::text, true), set_config('test.r.a_id', u.id::text, true), set_config('test.r.a_emp', e.id::text, true)
from public.users u join public.employees e on e.user_id = u.id
where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR_MANAGE' order by u.name limit 1;
select set_config('test.r.b_auth', u.auth_id::text, true), set_config('test.r.b_id', u.id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR_MANAGE'
  and u.id::text <> current_setting('test.r.a_id') order by u.name limit 1;
select set_config('test.r.e1', e.id::text, true), set_config('test.r.e1_code', e.employee_code, true)
from public.employees e left join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and (u.id is null or app_private.hrm_roster_access(u.id) is null) order by e.employee_code limit 1;
select set_config('test.r.e2', e.id::text, true)
from public.employees e left join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and (u.id is null or app_private.hrm_roster_access(u.id) is null)
  and e.id::text <> current_setting('test.r.e1') order by e.employee_code desc limit 1;
select set_config('test.r.plain_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) is null order by u.name limit 1;
select set_config('test.r.unit', (select id::text from public.org_units where code = 'XINHAI'), true),
  set_config('test.r.pos', (select id::text from public.hrm_positions where code = 'VT113'), true);
-- Clean subjects for the test.
delete from public.hrm_employee_identity_documents where regexp_replace(document_number, '\D', '', 'g') in ('012345678901', '098765432109');
update public.employees set employee_code = employee_code || 'X' where employee_code in ('TT678901', 'TT432109');

do $$
begin
  if current_setting('test.r.hr_auth', true) is null or current_setting('test.r.a_auth', true) is null or current_setting('test.r.b_auth', true) is null
    or current_setting('test.r.e1', true) is null or current_setting('test.r.e2', true) is null then
    raise exception 'ROSTER_SMOKE_FIXTURE_MISSING';
  end if;
  if (select name from public.org_units where code = 'XINHAI') <> 'Ban chỉ huy công trình XINHAI VINA' then raise exception 'ROSTER_XINHAI_NOT_RENAMED'; end if;
  if (select count(*) from public.hrm_positions where code between 'VT101' and 'VT117') <> 17 then raise exception 'ROSTER_POSITIONS_MISSING'; end if;
  if (select count(*) from public.hrm_catalog_items where catalog_key = 'education_level' and code in ('THPT', 'THCS')) <> 2 then raise exception 'ROSTER_EDUCATION_MISSING'; end if;
end;
$$;

-- ── Someone without HR rights cannot open the roster ───────────────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.r.plain_auth'))::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.get_hrm_roster();
    raise exception 'ROSTER_PLAIN_USER_SEES_ROSTER';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ── HR: sees no pay, cannot send pay, sends a change request ───────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.r.hr_auth'))::text, true);
set local role authenticated;
do $$
declare v_roster jsonb; v_row jsonb; v_result jsonb; v_batch jsonb;
begin
  v_roster := public.get_hrm_roster();
  if (v_roster -> 'can' ->> 'viewPay')::boolean or not (v_roster -> 'can' ->> 'edit')::boolean then raise exception 'ROSTER_HR_CAN %', v_roster -> 'can'; end if;
  select row into v_row from jsonb_array_elements(v_roster -> 'rows') row where row ->> 'employeeId' = current_setting('test.r.e1');
  if v_row is null or v_row -> 'values' ? 'p1' or v_row -> 'values' ? 'note' then raise exception 'ROSTER_HR_SEES_PAY %', v_row; end if;
  if jsonb_array_length(v_roster -> 'approvers') < 2 then raise exception 'ROSTER_APPROVERS %', v_roster -> 'approvers'; end if;

  begin
    perform public.submit_hrm_roster_batch('grid', 'Lương', 'Thử đổi lương bởi HR', app_private.hrm_vn_today(),
      jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'p1', 'newValue', 9000000)), null);
    raise exception 'ROSTER_HR_CAN_SEND_PAY';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_hrm_roster_batch('grid', 'Sai', 'Ngày không hợp lệ ở đây', app_private.hrm_vn_today(),
      jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'startDate', 'newValue', '2026-02-31')), null);
    raise exception 'ROSTER_BAD_DATE_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;

  v_result := public.submit_hrm_roster_batch('import', 'Nhập thử', 'Smoke test Bảng nhân sự', app_private.hrm_vn_today(), jsonb_build_array(
    jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'orgUnit', 'newValue', current_setting('test.r.unit')),
    jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'position', 'newValue', current_setting('test.r.pos')),
    jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'level', 'newValue', 'E3'),
    jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'idNumber', 'newValue', '012345678901'),
    jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'idIssuedPlace', 'newValue', 'Cục CS QLHC về TTXH'),
    jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'leaveRemaining', 'newValue', 7.5),
    jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'permanentAddress', 'newValue', 'Xóm 7, Quỳnh Trang, Hưng Yên'),
    jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'education', 'newValue', 'THPT'),
    jsonb_build_object('employeeId', current_setting('test.r.e2'), 'field', 'phone', 'newValue', '0912 345 678'),
    jsonb_build_object('employeeId', current_setting('test.r.a_emp'), 'field', 'phone', 'newValue', '0911222333'),
    jsonb_build_object('personKey', 'new:1', 'fullName', 'Người Thử Roster', 'field', 'fullName', 'newValue', 'Người Thử Roster'),
    jsonb_build_object('personKey', 'new:1', 'fullName', 'Người Thử Roster', 'field', 'startDate', 'newValue', '2026-10-13'),
    jsonb_build_object('personKey', 'new:1', 'fullName', 'Người Thử Roster', 'field', 'idNumber', 'newValue', '098765432109'),
    jsonb_build_object('personKey', 'new:1', 'fullName', 'Người Thử Roster', 'field', 'orgUnit', 'newValue', current_setting('test.r.unit'))
  ), 'data.xlsx');
  perform set_config('test.r.batch', v_result ->> 'id', true);
  -- The approver's own row (phone) went to its own request.
  if jsonb_array_length(v_result -> 'codes') <> 2 then raise exception 'ROSTER_NOT_SPLIT %', v_result; end if;
  v_batch := public.get_hrm_roster_batch((v_result ->> 'id')::uuid);
  if (v_batch ->> 'peopleCount')::int <> 3 or (v_batch ->> 'newPeopleCount')::int <> 1 then raise exception 'ROSTER_COUNTS %', v_batch; end if;
  if not exists (select 1 from jsonb_array_elements(v_batch -> 'items') item where item ->> 'field' = 'employeeCode'
    and item ->> 'newValue' = 'TT678901' and item ->> 'oldValue' = current_setting('test.r.e1_code')) then raise exception 'ROSTER_CODE_NOT_DERIVED %', v_batch -> 'items'; end if;
  if not exists (select 1 from jsonb_array_elements(v_batch -> 'items') item where item ->> 'personKey' = 'new:1' and item ->> 'field' = 'employeeCode' and item ->> 'newValue' = 'TT432109')
  then raise exception 'ROSTER_NEW_CODE_MISSING'; end if;
  if (v_batch -> 'can' ->> 'decide')::boolean or not (v_batch -> 'can' ->> 'cancel')::boolean then raise exception 'ROSTER_HR_CAN_DECIDE %', v_batch -> 'can'; end if;
  if (select count(*) from jsonb_array_elements(v_batch -> 'items') item where item ->> 'field' = 'phone' and item ->> 'newValue' = '0912345678') <> 1 then
    raise exception 'ROSTER_PHONE_NOT_NORMALIZED';
  end if;

  begin
    perform public.submit_hrm_roster_batch('grid', 'Trùng', 'Đổi chức danh lần hai', app_private.hrm_vn_today(),
      jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'position', 'newValue', (select id::text from public.hrm_positions where code = 'VT114'))), null);
    raise exception 'ROSTER_PENDING_NOT_LOCKED';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.decide_hrm_roster_batch((v_result ->> 'id')::uuid, true, null);
    raise exception 'ROSTER_HR_DECIDED';
  exception when insufficient_privilege then null;
  end;
  v_roster := public.get_hrm_roster();
  select row into v_row from jsonb_array_elements(v_roster -> 'rows') row where row ->> 'employeeId' = current_setting('test.r.e1');
  if not v_row -> 'pending' ? 'position' then raise exception 'ROSTER_PENDING_NOT_SHOWN %', v_row -> 'pending'; end if;
end;
$$;
reset role;

-- ── Approver A cannot decide the request about A, approves the main one ────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.r.a_auth'))::text, true);
set local role authenticated;
do $$
declare v_split uuid; v_batch jsonb;
begin
  select (item ->> 'id')::uuid into v_split from jsonb_array_elements(public.list_hrm_roster_batches('pending')) item
  where item ->> 'id' <> current_setting('test.r.batch') and item ->> 'title' like 'Nhập thử ·%' limit 1;
  perform set_config('test.r.split', v_split::text, true);
  begin
    perform public.decide_hrm_roster_batch(v_split, true, null);
    raise exception 'ROSTER_SELF_APPROVED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.decide_hrm_roster_batch(current_setting('test.r.batch')::uuid, false, 'ok');
    raise exception 'ROSTER_REJECT_WITHOUT_REASON';
  exception when invalid_parameter_value then null;
  end;
  v_batch := public.decide_hrm_roster_batch(current_setting('test.r.batch')::uuid, true, null);
  if v_batch ->> 'status' <> 'approved' then raise exception 'ROSTER_NOT_APPROVED %', v_batch; end if;
end;
$$;
reset role;

do $$
declare v_e1 public.employees%rowtype; v_new public.employees%rowtype; v_values jsonb;
begin
  select * into v_e1 from public.employees where id = current_setting('test.r.e1')::uuid;
  if v_e1.employee_code <> 'TT678901' or v_e1.legacy_code <> current_setting('test.r.e1_code') then raise exception 'ROSTER_CODE_NOT_APPLIED % %', v_e1.employee_code, v_e1.legacy_code; end if;
  if v_e1.position_id::text <> current_setting('test.r.pos') or v_e1.org_unit_id::text <> current_setting('test.r.unit')
    or v_e1.level_code <> 'E3' or v_e1.title <> 'Cán bộ điện nước' then raise exception 'ROSTER_POSITION_NOT_APPLIED'; end if;
  v_values := app_private.hrm_roster_values(v_e1.id, true);
  if v_values ->> 'idNumber' <> '012345678901' or v_values ->> 'idIssuedPlace' <> 'Cục CS QLHC về TTXH'
    or (v_values ->> 'leaveRemaining')::numeric <> 7.5 or v_values ->> 'permanentAddress' <> 'Xóm 7, Quỳnh Trang, Hưng Yên'
    or v_values ->> 'education' <> 'THPT' then raise exception 'ROSTER_PROFILE_NOT_APPLIED %', v_values; end if;
  if not exists (select 1 from public.hrm_employee_employment_events where employee_id = v_e1.id and event_type_code = 'ROSTER_CHANGE') then
    raise exception 'ROSTER_EVENT_MISSING';
  end if;
  if (select phone from public.employees where id = current_setting('test.r.e2')::uuid) <> '0912345678' then raise exception 'ROSTER_PHONE_NOT_APPLIED'; end if;
  select * into v_new from public.employees where employee_code = 'TT432109';
  if v_new.id is null or v_new.full_name <> 'Người Thử Roster' or v_new.start_date <> date '2026-10-13' or v_new.status <> 'Đang làm việc' then
    raise exception 'ROSTER_NEW_PERSON_MISSING';
  end if;
  if (select phone from public.employees where id = current_setting('test.r.a_emp')::uuid) = '0911222333'
    or (select status from public.hrm_roster_batches where id = current_setting('test.r.split')::uuid) <> 'pending' then
    raise exception 'ROSTER_SPLIT_APPLIED_EARLY';
  end if;
end;
$$;

-- ── Approver B decides A's own request; HR Manage sees pay ─────────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.r.b_auth'))::text, true);
set local role authenticated;
do $$
declare v_batch jsonb; v_roster jsonb; v_row jsonb;
begin
  v_batch := public.decide_hrm_roster_batch(current_setting('test.r.split')::uuid, false, 'Chưa có giấy tờ chứng minh');
  if v_batch ->> 'status' <> 'returned' then raise exception 'ROSTER_SPLIT_NOT_RETURNED'; end if;
  v_roster := public.get_hrm_roster();
  if not (v_roster -> 'can' ->> 'viewPay')::boolean then raise exception 'ROSTER_MANAGE_NO_PAY'; end if;
  select row into v_row from jsonb_array_elements(v_roster -> 'rows') row where row ->> 'employeeId' = current_setting('test.r.e1');
  if not v_row -> 'values' ? 'p1' then raise exception 'ROSTER_MANAGE_PAY_KEYS_MISSING'; end if;
  -- Pay goes through a request too; B sends, A approves.
  perform set_config('test.r.pay', public.submit_hrm_roster_batch('grid', 'Lương', 'Cập nhật lương theo Data', app_private.hrm_vn_today(),
    jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'p1', 'newValue', 6600000),
      jsonb_build_object('employeeId', current_setting('test.r.e1'), 'field', 'note', 'newValue', 'Tăng theo rank')), null) ->> 'id', true);
end;
$$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.r.a_auth'))::text, true);
set local role authenticated;
select public.decide_hrm_roster_batch(current_setting('test.r.pay')::uuid, true, null) is not null as pay_approved;
reset role;
do $$
begin
  if (select p1 from public.hrm_employee_pay_profiles where employee_id = current_setting('test.r.e1')::uuid) <> 6600000
    or (select note from public.hrm_employee_pay_profiles where employee_id = current_setting('test.r.e1')::uuid) <> 'Tăng theo rank' then
    raise exception 'ROSTER_PAY_NOT_APPLIED';
  end if;
end;
$$;

select 'hrm_roster_batches_smoke ok' as result;
rollback;

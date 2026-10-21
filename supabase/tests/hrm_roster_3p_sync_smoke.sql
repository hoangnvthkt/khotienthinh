-- Run after 20261017150000_hrm_roster_3p_sync. Rolls back.
begin;
set local statement_timeout = '120s';

-- Two HR Manage people (A sends, B approves), HR without pay, two subjects without roster rights:
-- e1 has an open July seed assignment, e2 has none.
update public.hrm_roster_settings set general_step1 = '{}', general_step2 = '{}', pay_step1 = '{}', pay_step2 = '{}';
select set_config('test.p.a_auth', u.auth_id::text, true), set_config('test.p.a_id', u.id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR_MANAGE' order by u.name limit 1;
select set_config('test.p.b_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR_MANAGE'
  and u.id::text <> current_setting('test.p.a_id') order by u.name limit 1;
select set_config('test.p.hr_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR' order by u.name limit 1;
-- Two subjects; their 3P rows are rebuilt here (rolled back) so the test does not depend on what HR imported.
select set_config('test.p.e1', e.id::text, true)
from public.employees e left join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and (u.id is null or app_private.hrm_roster_access(u.id) is null)
  and e.employee_code not in ('TT033', 'TT035')
order by e.employee_code limit 1;
select set_config('test.p.e2', e.id::text, true)
from public.employees e left join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and (u.id is null or app_private.hrm_roster_access(u.id) is null)
  and e.employee_code not in ('TT033', 'TT035') and e.id::text <> current_setting('test.p.e1')
order by e.employee_code desc limit 1;
delete from public.hrm_employee_compensation_assignments
where employee_id in (current_setting('test.p.e1')::uuid, current_setting('test.p.e2')::uuid);
insert into public.hrm_employee_compensation_assignments (employee_id, employee_code_snapshot, employee_name_snapshot, plan_id,
  salary_grade_id, p3_band_id, effective_from, status, source, review_status, p1_amount, p3_standard_amount)
select e.id, e.employee_code, e.full_name, plan.id, grade.id, band.id, plan.effective_from, 'active', 'excel_seed', 'approved', grade.p1_salary_amount, 1000000
from public.employees e
join public.hrm_compensation_plans plan on plan.code = '3P_2026'
join public.salary_grades grade on grade.plan_id = plan.id and grade.code = 'E4'
join public.hrm_3p_bands band on band.plan_id = plan.id and band.code = 'B3'
where e.id = current_setting('test.p.e1')::uuid;
select set_config('test.p.e1_seed', (select id::text from public.hrm_employee_compensation_assignments
  where employee_id = current_setting('test.p.e1')::uuid), true);
select set_config('test.p.d0', date_trunc('month', app_private.hrm_vn_today())::date::text, true);
select set_config('test.p.d_mid', (date_trunc('month', app_private.hrm_vn_today())::date + 14)::text, true);
select set_config('test.p.d_next', (date_trunc('month', app_private.hrm_vn_today()) + interval '1 month')::date::text, true);

do $$
begin
  if current_setting('test.p.a_auth', true) is null or current_setting('test.p.b_auth', true) is null or current_setting('test.p.hr_auth', true) is null
    or current_setting('test.p.e1', true) is null or current_setting('test.p.e2', true) is null then
    raise exception 'P3_SMOKE_FIXTURE_MISSING';
  end if;
  -- Old rows: amounts as columns, people who left closed, TT033 / TT035 waiting for HR.
  if exists (select 1 from public.hrm_employee_compensation_assignments where source = 'excel_seed' and p1_amount is null) then
    raise exception 'P3_SEED_AMOUNTS_NOT_COPIED';
  end if;
  if exists (select 1 from public.hrm_employee_compensation_assignments a join public.employees e on e.id = a.employee_id
      where e.status = 'Đã nghỉ việc' and (a.effective_to is null or a.status <> 'superseded')) then
    raise exception 'P3_LEFT_NOT_CLOSED';
  end if;
  if exists (select 1 from public.hrm_employee_compensation_assignments a join public.employees e on e.id = a.employee_id
      where e.employee_code in ('TT033', 'TT035') and a.effective_to is null and a.review_status <> 'needs_review') then
    raise exception 'P3_MISSING_FROM_DATA_NOT_FLAGGED';
  end if;
  perform set_config('test.p.payroll_links', (select count(*) from public.hrm_payrolls where "compensationAssignmentId" is not null)::text, true);
end;
$$;

-- ── A sends Level + pay for both people from the 1st of the month (split into 2 requests) ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.a_auth'))::text, true);
set local role authenticated;
do $$
declare v_result jsonb; v_list jsonb;
begin
  v_result := public.submit_hrm_roster_batch('import', 'Nhập Data smoke', 'Smoke 3P: Level và lương theo Data', current_setting('test.p.d0')::date,
    jsonb_build_array(
      jsonb_build_object('employeeId', current_setting('test.p.e1'), 'field', 'level', 'newValue', 'E5'),
      jsonb_build_object('employeeId', current_setting('test.p.e1'), 'field', 'p1', 'newValue', 6600000),
      jsonb_build_object('employeeId', current_setting('test.p.e1'), 'field', 'pctn', 'newValue', 450000),
      jsonb_build_object('employeeId', current_setting('test.p.e1'), 'field', 'phoneAllowance', 'newValue', 450000),
      jsonb_build_object('employeeId', current_setting('test.p.e1'), 'field', 'p3', 'newValue', 8000000),
      jsonb_build_object('employeeId', current_setting('test.p.e1'), 'field', 'seniorityAllowance', 'newValue', 300000),
      jsonb_build_object('employeeId', current_setting('test.p.e2'), 'field', 'level', 'newValue', 'E3'),
      jsonb_build_object('employeeId', current_setting('test.p.e2'), 'field', 'p1', 'newValue', 5500000),
      jsonb_build_object('employeeId', current_setting('test.p.e2'), 'field', 'p3', 'newValue', 7100000)), 'smoke.xlsx');
  if jsonb_array_length(v_result -> 'codes') <> 2 then raise exception 'P3_NOT_SPLIT %', v_result; end if;
  v_list := public.list_hrm_roster_batches('pending');
  perform set_config('test.p.general', (select item ->> 'id' from jsonb_array_elements(v_list) item
    where item ->> 'title' like 'Nhập Data smoke%' and item ->> 'approvalGroup' = 'general'), true);
  perform set_config('test.p.pay', (select item ->> 'id' from jsonb_array_elements(v_list) item
    where item ->> 'title' like 'Nhập Data smoke%' and item ->> 'approvalGroup' = 'pay'), true);
end;
$$;
reset role;

-- ── B approves Level first, then pay: the two land on the same row ─────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.b_auth'))::text, true);
set local role authenticated;
do $$
begin
  perform public.decide_hrm_roster_batch(current_setting('test.p.general')::uuid, true, null);
  perform public.decide_hrm_roster_batch(current_setting('test.p.pay')::uuid, true, null);
end;
$$;
reset role;

do $$
declare v_new public.hrm_employee_compensation_assignments%rowtype; v_seed public.hrm_employee_compensation_assignments%rowtype;
begin
  select * into v_new from public.hrm_employee_compensation_assignments
  where employee_id = current_setting('test.p.e1')::uuid and effective_from = current_setting('test.p.d0')::date;
  if v_new.id is null or v_new.source <> 'roster_data' or v_new.status <> 'active' or v_new.effective_to is not null
    or v_new.p3_band_id is not null or v_new.review_status <> 'approved' or v_new.roster_batch_id is null then
    raise exception 'P3_E1_ROW %', to_jsonb(v_new);
  end if;
  if (select code from public.salary_grades where id = v_new.salary_grade_id) <> 'E5' or v_new.p1_amount <> 6600000 or v_new.pctn_amount <> 450000
    or v_new.phone_allowance_amount <> 450000 or v_new.p3_standard_amount <> 8000000 or v_new.seniority_allowance_amount <> 300000
    or v_new.vehicle_allowance_amount is not null then
    raise exception 'P3_E1_AMOUNTS %', to_jsonb(v_new);
  end if;
  select * into v_seed from public.hrm_employee_compensation_assignments where id = current_setting('test.p.e1_seed')::uuid;
  if v_seed.effective_to <> current_setting('test.p.d0')::date - 1 or v_seed.status <> 'superseded' then raise exception 'P3_SEED_NOT_CLOSED %', to_jsonb(v_seed); end if;
  if (select count(*) from public.hrm_employee_compensation_assignments where employee_id = current_setting('test.p.e2')::uuid) <> 1
    or (select p3_standard_amount from public.hrm_employee_compensation_assignments where employee_id = current_setting('test.p.e2')::uuid) <> 7100000 then
    raise exception 'P3_E2_ROW';
  end if;
  if (select count(*) from public.hrm_payrolls where "compensationAssignmentId" is not null)::text <> current_setting('test.p.payroll_links') then
    raise exception 'P3_PAYROLL_LINKS_LOST';
  end if;
  if not exists (select 1 from public.audit_trail where entity_type = 'HRM_COMPENSATION_ASSIGNMENT' and record_id = v_new.id::text) then
    raise exception 'P3_NOT_AUDITED';
  end if;
  perform set_config('test.p.e1_oct', v_new.id::text, true);
end;
$$;

-- ── Same day again: corrected in place; mid-month and next month: new rows, earlier ones closed ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.a_auth'))::text, true);
set local role authenticated;
do $$
begin
  perform set_config('test.p.b1', (public.submit_hrm_roster_batch('grid', 'Sửa P3 smoke', 'Smoke 3P: sửa P3 cùng ngày', current_setting('test.p.d0')::date,
    jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.p.e1'), 'field', 'p3', 'newValue', 8100000)), null)) ->> 'id', true);
end;
$$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.b_auth'))::text, true);
set local role authenticated;
do $$ begin perform public.decide_hrm_roster_batch(current_setting('test.p.b1')::uuid, true, null); end; $$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.a_auth'))::text, true);
set local role authenticated;
do $$
begin
  perform set_config('test.p.b2', (public.submit_hrm_roster_batch('grid', 'Tăng P1 smoke', 'Smoke 3P: tăng P1 từ tháng sau', current_setting('test.p.d_next')::date,
    jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.p.e1'), 'field', 'p1', 'newValue', 7100000)), null)) ->> 'id', true);
end;
$$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.b_auth'))::text, true);
set local role authenticated;
do $$ begin perform public.decide_hrm_roster_batch(current_setting('test.p.b2')::uuid, true, null); end; $$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.a_auth'))::text, true);
set local role authenticated;
do $$
begin
  perform set_config('test.p.b3', (public.submit_hrm_roster_batch('grid', 'PC xe smoke', 'Smoke 3P: thêm PC xe giữa tháng', current_setting('test.p.d_mid')::date,
    jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.p.e1'), 'field', 'vehicleAllowance', 'newValue', 500000)), null)) ->> 'id', true);
end;
$$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.b_auth'))::text, true);
set local role authenticated;
do $$ begin perform public.decide_hrm_roster_batch(current_setting('test.p.b3')::uuid, true, null); end; $$;
reset role;

do $$
declare v_rows jsonb; v_3p jsonb;
begin
  select jsonb_agg(jsonb_build_object('from', effective_from, 'to', effective_to, 'status', status, 'p1', p1_amount, 'p3', p3_standard_amount,
    'xe', vehicle_allowance_amount) order by effective_from) into v_rows
  from public.hrm_employee_compensation_assignments where employee_id = current_setting('test.p.e1')::uuid and source = 'roster_data';
  if jsonb_array_length(v_rows) <> 3 then raise exception 'P3_HISTORY_COUNT %', v_rows; end if;
  -- 1st: corrected P3, closed the day before mid-month.
  if (v_rows #>> '{0,p3}')::numeric <> 8100000 or (v_rows #>> '{0,to}')::date <> current_setting('test.p.d_mid')::date - 1 then raise exception 'P3_FIRST_ROW %', v_rows; end if;
  -- Mid-month: PC xe, runs until the row already planned for next month.
  if (v_rows #>> '{1,xe}')::numeric <> 500000 or (v_rows #>> '{1,p1}')::numeric <> 6600000
    or (v_rows #>> '{1,to}')::date <> current_setting('test.p.d_next')::date - 1 or v_rows #>> '{1,status}' <> 'superseded' then
    raise exception 'P3_MID_ROW %', v_rows;
  end if;
  -- Next month: keeps its own P1 raise, takes the PC xe approved later for mid-month, stays open.
  if (v_rows #>> '{2,p1}')::numeric <> 7100000 or (v_rows #>> '{2,xe}')::numeric <> 500000 or (v_rows #>> '{2,p3}')::numeric <> 8100000
    or v_rows #>> '{2,to}' is not null or v_rows #>> '{2,status}' <> 'active' then
    raise exception 'P3_NEXT_ROW %', v_rows;
  end if;
  if (select id::text from public.hrm_employee_compensation_assignments where employee_id = current_setting('test.p.e1')::uuid
      and effective_from = current_setting('test.p.d0')::date) <> current_setting('test.p.e1_oct') then
    raise exception 'P3_SAME_DAY_NOT_IN_PLACE';
  end if;
  v_3p := app_private.hrm_roster_pay3p(current_setting('test.p.e1')::uuid, current_setting('test.p.d_mid')::date + 1);
  if v_3p ->> 'grade' <> 'E5' or v_3p ->> 'band' is not null or (v_3p ->> 'from')::date <> current_setting('test.p.d_mid')::date then
    raise exception 'P3_PAY3P_IN_FORCE %', v_3p;
  end if;
  v_3p := app_private.hrm_roster_pay3p(current_setting('test.p.e2')::uuid, current_setting('test.p.d0')::date - 1);
  if (v_3p ->> 'from')::date <> current_setting('test.p.d0')::date then raise exception 'P3_PAY3P_UPCOMING %', v_3p; end if;
  -- Before any 3P plan: nothing to place.
  if app_private.hrm_compensation_sync_from_roster(current_setting('test.p.e2')::uuid, date '2000-01-01', null) is not null then
    raise exception 'P3_PLACED_WITHOUT_PLAN';
  end if;
end;
$$;

-- ── Bảng nhân sự: 3P only for HR Manage ─────────────────────────────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.b_auth'))::text, true);
set local role authenticated;
do $$
declare v_row jsonb;
begin
  select item into v_row from jsonb_array_elements(public.get_hrm_roster() -> 'rows') item where item ->> 'employeeId' = current_setting('test.p.e1');
  if v_row #>> '{pay3p,grade}' <> 'E5' then raise exception 'P3_ROSTER_MANAGE %', v_row -> 'pay3p'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.p.hr_auth'))::text, true);
set local role authenticated;
do $$
declare v_row jsonb;
begin
  select item into v_row from jsonb_array_elements(public.get_hrm_roster() -> 'rows') item where item ->> 'employeeId' = current_setting('test.p.e1');
  if jsonb_typeof(v_row -> 'pay3p') <> 'null' or v_row -> 'values' ? 'p3' then raise exception 'P3_ROSTER_HR_SEES_PAY %', v_row -> 'pay3p'; end if;
end;
$$;
reset role;

select 'hrm_roster_3p_sync_smoke ok' as result;
rollback;

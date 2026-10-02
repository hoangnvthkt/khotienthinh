-- Run after 20261007120000_hrm_g2b_leave_ledger_carry. Rolls back.
begin;
set local statement_timeout = '90s';

select set_config('test.g2b.emp_id', e.id::text, true),
       set_config('test.g2b.emp_auth', u.auth_id::text, true),
       set_config('test.g2b.emp_email', u.email, true)
from public.employees e join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and u.is_active and u.auth_id is not null and u.role <> 'ADMIN'
  and not app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
order by e.created_at limit 1;
select set_config('test.g2b.hr_auth', u.auth_id::text, true), set_config('test.g2b.hr_email', u.email, true)
from public.users u
where u.is_active and u.auth_id is not null and app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
order by u.created_at limit 1;
select set_config('test.g2b.year', extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::text, true);

delete from public.hrm_leave_balances where "employeeId" = current_setting('test.g2b.emp_id')::uuid;

do $$
declare
  v_emp uuid := current_setting('test.g2b.emp_id')::uuid;
  v_year integer := current_setting('test.g2b.year')::integer;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_request uuid := gen_random_uuid();
  v_late uuid := gen_random_uuid();
  v_row public.hrm_leave_balances;
begin
  -- 5 days this year + 3 carried days usable for 10 more days.
  perform app_private.hrm_leave_ledger_label('carry_in', null, null, 'smoke');
  insert into public.hrm_leave_balances ("employeeId", year, "accruedDays", "lastAccrualMonth", "carriedDays", "carryExpiresOn")
  values (v_emp, v_year, 5, extract(month from v_today)::integer, 3, v_today + 10) returning * into v_row;
  perform app_private.hrm_leave_ledger_label(null);
  if (select days from public.hrm_leave_ledger where balance_id = v_row.id and kind = 'carry_in') <> 8 then
    raise exception 'G2B_CARRY_IN_LINE';
  end if;

  -- Leave inside the carry window uses carried days first.
  perform app_private.hrm_leave_ledger_label('leave', v_request, v_today + 1, 'smoke leave');
  update public.hrm_leave_balances set "usedPaidDays" = "usedPaidDays" + 2 where id = v_row.id returning * into v_row;
  perform app_private.hrm_leave_ledger_label(null);
  if v_row."carryUsedDays" <> 2 or app_private.hrm_leave_available(v_row) <> 6 then
    raise exception 'G2B_CARRY_FIRST % %', v_row."carryUsedDays", app_private.hrm_leave_available(v_row);
  end if;

  -- Cancelling gives the carried days back.
  perform app_private.hrm_leave_ledger_label('leave_cancel', v_request, null, 'smoke cancel');
  update public.hrm_leave_balances set "usedPaidDays" = "usedPaidDays" - 2 where id = v_row.id returning * into v_row;
  perform app_private.hrm_leave_ledger_label(null);
  if v_row."carryUsedDays" <> 0 or app_private.hrm_leave_available(v_row) <> 8 then
    raise exception 'G2B_CANCEL_REFUND %', v_row;
  end if;

  -- Leave after the carry window cannot use carried days.
  if app_private.hrm_leave_annual_available(v_emp, v_today + 11) <> 5
    or app_private.hrm_leave_annual_available(v_emp, v_today + 1) <> 8 then
    raise exception 'G2B_AVAILABLE_BY_DATE % %', app_private.hrm_leave_annual_available(v_emp, v_today + 11),
      app_private.hrm_leave_annual_available(v_emp, v_today + 1);
  end if;
  perform app_private.hrm_leave_ledger_label('leave', v_late, v_today + 11, 'smoke late leave');
  update public.hrm_leave_balances set "usedPaidDays" = "usedPaidDays" + 1 where id = v_row.id returning * into v_row;
  perform app_private.hrm_leave_ledger_label(null);
  if v_row."carryUsedDays" <> 0 then raise exception 'G2B_CARRY_USED_AFTER_EXPIRY'; end if;

  -- The window closes: unused carried days expire, once.
  update public.hrm_leave_balances set "carryExpiresOn" = v_today - 1 where id = v_row.id;
  perform app_private.hrm_leave_year_maintenance();
  perform app_private.hrm_leave_year_maintenance();
  select * into v_row from public.hrm_leave_balances where id = v_row.id;
  if v_row."carryExpiredDays" <> 3 or app_private.hrm_leave_available(v_row) <> 4
    or (select count(*) from public.hrm_leave_ledger where balance_id = v_row.id and kind = 'carry_expire') <> 1 then
    raise exception 'G2B_EXPIRY %', v_row;
  end if;

  -- The ledger adds up to the balance.
  if (select sum(days) from public.hrm_leave_ledger where balance_id = v_row.id) <> app_private.hrm_leave_available(v_row)
    or (select balance_after from public.hrm_leave_ledger where balance_id = v_row.id order by created_at desc, id limit 1) is null then
    raise exception 'G2B_LEDGER_SUM';
  end if;
end;
$$;

-- HR adjusts with a reason; the employee reads only their own ledger.
select set_config('request.jwt.claim.sub', current_setting('test.g2b.hr_auth'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g2b.hr_auth'), 'email', current_setting('test.g2b.hr_email'))::text, true);
set local role authenticated;
do $$
declare v_result jsonb;
begin
  v_result := public.adjust_hrm_leave_balance(current_setting('test.g2b.emp_id')::uuid, current_setting('test.g2b.year')::integer, 7.5, 'Đối chiếu sổ phép giấy');
  if (v_result ->> 'availableDays')::numeric <> 7.5 then raise exception 'G2B_ADJUST %', v_result; end if;
  begin
    perform public.adjust_hrm_leave_balance(current_setting('test.g2b.emp_id')::uuid, current_setting('test.g2b.year')::integer, 7.3, 'Đối chiếu sổ phép giấy');
    raise exception 'G2B_ADJUST_STEP';
  exception when sqlstate '22023' then null;
  end;
  if jsonb_array_length(public.list_hrm_leave_balances(current_setting('test.g2b.year')::integer)) < 1 then
    raise exception 'G2B_HR_LIST';
  end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('test.g2b.emp_auth'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g2b.emp_auth'), 'email', current_setting('test.g2b.emp_email'))::text, true);
set local role authenticated;
do $$
declare v_ledger jsonb;
begin
  v_ledger := public.get_hrm_leave_ledger(current_setting('test.g2b.emp_id')::uuid, current_setting('test.g2b.year')::integer);
  if v_ledger -> 'entries' -> 0 ->> 'kind' <> 'adjust' or v_ledger -> 'entries' -> 0 ->> 'note' <> 'Đối chiếu sổ phép giấy'
    or (v_ledger -> 'balance' ->> 'availableDays')::numeric <> 7.5 then
    raise exception 'G2B_OWN_LEDGER %', v_ledger;
  end if;
  begin
    perform public.get_hrm_leave_ledger(gen_random_uuid(), current_setting('test.g2b.year')::integer);
    raise exception 'G2B_OTHER_LEDGER_VISIBLE';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.list_hrm_leave_balances(current_setting('test.g2b.year')::integer);
    raise exception 'G2B_EMPLOYEE_LISTS_ALL';
  exception when sqlstate '42501' then null;
  end;
end;
$$;
reset role;

select 'hrm_g2b_leave_ledger_smoke passed' as result;
rollback;

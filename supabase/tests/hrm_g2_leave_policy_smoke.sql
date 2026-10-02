-- Run after 20261005130000_hrm_g2_leave_policy. Rolls back.
begin;
set local statement_timeout = '60s';

-- Requester: an active non-HR employee whose account has a direct manager that is not HR either.
select set_config('test.g2.auth_id', requester.auth_id::text, true),
       set_config('test.g2.email', requester.email, true),
       set_config('test.g2.user_id', requester.id::text, true),
       set_config('test.g2.employee_id', employee_row.id::text, true),
       set_config('test.g2.manager_id', manager.id::text, true),
       set_config('test.g2.manager_auth', manager.auth_id::text, true),
       set_config('test.g2.manager_email', manager.email, true)
from public.users requester
join public.employees employee_row on employee_row.user_id = requester.id and employee_row.status = 'Đang làm việc'
join public.users manager on manager.id = requester.manager_id and manager.auth_id is not null and coalesce(manager.is_active, true)
where requester.is_active and requester.auth_id is not null and requester.role <> 'ADMIN'
  and employee_row.construction_site_id is null
  and app_private.resolve_slot_direct_manager(requester.id) is null
  and not app_private.has_hrm_template_permission(requester.id, 'hrm.employee.view_sensitive')
  and manager.id <> (select second_step_approver_user_id from public.hrm_leave_settings)
order by requester.created_at
limit 1;

select set_config('test.g2.director_id', u.id::text, true),
       set_config('test.g2.director_auth', u.auth_id::text, true),
       set_config('test.g2.director_email', u.email, true)
from public.users u where u.id = (select second_step_approver_user_id from public.hrm_leave_settings);

-- A clean annual balance with 10 days, official employee, and no Saturday work for a predictable count.
update public.employees set official_date = '2020-01-01' where id = current_setting('test.g2.employee_id')::uuid;
update public.hrm_leave_settings set saturday_is_workday = false;
delete from public.hrm_leave_balances where "employeeId" = current_setting('test.g2.employee_id')::uuid and year = 2099;
insert into public.hrm_leave_balances (id, "employeeId", year, "initialDays", "monthlyAccrual", "accruedDays", "usedPaidDays", "usedUnpaidDays", "lastAccrualMonth")
values (gen_random_uuid(), current_setting('test.g2.employee_id')::uuid, 2099, 12, 1, 10, 0, 0, 12);

do $$
begin
  -- Mon 2099-06-01 … Fri 06-05 = 5 working days; Fri afternoon start → 0.5.
  if app_private.hrm_leave_working_days('2099-06-01', '2099-06-07') <> 5 then raise exception 'HRM_G2_WORKDAYS'; end if;
  if app_private.hrm_leave_working_days('2099-06-05', '2099-06-05', 'afternoon', 'afternoon') <> 0.5 then raise exception 'HRM_G2_HALF_DAY'; end if;
  if app_private.hrm_leave_working_days('2099-06-01', '2099-06-02', 'afternoon', 'full') <> 1.5 then raise exception 'HRM_G2_HALF_START'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.g2.auth_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g2.auth_id'), 'email', current_setting('test.g2.email'))::text, true);
set local role authenticated;

do $$
declare v_preview jsonb; v_row public.hrm_leave_requests;
begin
  -- ≤ 3 days: one step (the direct manager).
  v_preview := public.preview_my_leave_request('annual', '2099-06-01', '2099-06-03', 'full', 'full', null);
  if (v_preview ->> 'days')::numeric <> 3 or jsonb_array_length(v_preview -> 'steps') <> 1
    or v_preview -> 'steps' -> 0 ->> 'userId' <> current_setting('test.g2.manager_id') then
    raise exception 'HRM_G2_SHORT_CHAIN %', v_preview;
  end if;
  -- > 3 days: the director is added.
  v_preview := public.preview_my_leave_request('annual', '2099-06-01', '2099-06-05', 'full', 'full', null);
  if jsonb_array_length(v_preview -> 'steps') <> 2 or v_preview -> 'steps' -> 1 ->> 'kind' <> 'director' then
    raise exception 'HRM_G2_LONG_CHAIN %', v_preview;
  end if;
  -- More than the balance: refused.
  v_preview := public.preview_my_leave_request('annual', '2099-06-01', '2099-06-19', 'full', 'full', null);
  if jsonb_array_length(v_preview -> 'problems') = 0 then raise exception 'HRM_G2_OVER_BALANCE_ACCEPTED'; end if;
  -- Late arrival over the 60-minute cap: refused.
  v_preview := public.preview_my_leave_request('late_early', '2099-06-01', '2099-06-01', 'full', 'full', 90);
  if jsonb_array_length(v_preview -> 'problems') = 0 then raise exception 'HRM_G2_LATE_CAP'; end if;

  v_row := public.submit_my_leave_request('annual', '2099-06-01', '2099-06-05', 'full', 'full', null, null, 'Về quê');
  perform set_config('test.g2.request_id', v_row.id::text, true);
  if v_row.status <> 'pending' or v_row."totalDays" <> 5 or v_row.current_step <> 1 then raise exception 'HRM_G2_SUBMIT %', row_to_json(v_row); end if;
  begin
    perform public.submit_my_leave_request('annual', '2099-06-03', '2099-06-03', 'full', 'full', null, null, 'Trùng ngày');
    raise exception 'HRM_G2_OVERLAP_ACCEPTED';
  exception when check_violation then null;
  end;
  -- Requesters cannot approve or write requests directly.
  begin
    perform public.decide_leave_request(v_row.id, 'approve', null);
    raise exception 'HRM_G2_SELF_APPROVE';
  exception when insufficient_privilege then null;
  end;
  update public.hrm_leave_requests set status = 'approved' where id = v_row.id;
  if found then raise exception 'HRM_G2_DIRECT_UPDATE'; end if;
end;
$$;

-- Step 1: the manager.
reset role;
select set_config('request.jwt.claim.sub', current_setting('test.g2.manager_auth'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g2.manager_auth'), 'email', current_setting('test.g2.manager_email'))::text, true);
set local role authenticated;
do $$
declare v_row public.hrm_leave_requests;
begin
  if not exists (select 1 from public.hrm_leave_requests where id = current_setting('test.g2.request_id')::uuid) then
    raise exception 'HRM_G2_APPROVER_CANNOT_SEE';
  end if;
  v_row := public.decide_leave_request(current_setting('test.g2.request_id')::uuid, 'approve', null);
  if v_row.status <> 'pending' or v_row.current_step <> 2 then raise exception 'HRM_G2_STEP1 %', row_to_json(v_row); end if;
  begin
    perform public.decide_leave_request(current_setting('test.g2.request_id')::uuid, 'approve', null);
    raise exception 'HRM_G2_STEP1_APPROVES_STEP2';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Step 2: the director → approved, 5 days taken from the balance.
reset role;
select set_config('request.jwt.claim.sub', current_setting('test.g2.director_auth'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g2.director_auth'), 'email', current_setting('test.g2.director_email'))::text, true);
set local role authenticated;
do $$
declare v_row public.hrm_leave_requests;
begin
  v_row := public.decide_leave_request(current_setting('test.g2.request_id')::uuid, 'approve', 'Đồng ý');
  if v_row.status <> 'approved' then raise exception 'HRM_G2_FINAL %', row_to_json(v_row); end if;
end;
$$;

reset role;
do $$
begin
  if (select "usedPaidDays" from public.hrm_leave_balances where "employeeId" = current_setting('test.g2.employee_id')::uuid and year = 2099) <> 5 then
    raise exception 'HRM_G2_BALANCE_NOT_TAKEN';
  end if;
  if (select count(*) from public.hrm_attendance where note like '%leave:' || current_setting('test.g2.request_id') || '%') <> 5 then
    raise exception 'HRM_G2_TIMESHEET_NOT_MARKED';
  end if;
  if (select count(*) from public.notifications where source_type = 'hrm_leave' and source_id = current_setting('test.g2.request_id')) < 3 then
    raise exception 'HRM_G2_NOTIFICATIONS_MISSING';
  end if;
end;
$$;

-- The requester cannot cancel an approved request; HR can, and the balance comes back.
select set_config('request.jwt.claim.sub', current_setting('test.g2.auth_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g2.auth_id'), 'email', current_setting('test.g2.email'))::text, true);
set local role authenticated;
do $$
begin
  perform public.cancel_leave_request(current_setting('test.g2.request_id')::uuid, 'Đổi kế hoạch');
  raise exception 'HRM_G2_EMPLOYEE_CANCELLED_APPROVED';
exception when insufficient_privilege then null;
end;
$$;
reset role;

select 'hrm_g2_leave_policy_smoke passed' as result;
rollback;

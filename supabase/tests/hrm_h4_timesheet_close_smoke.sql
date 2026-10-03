-- Run after 20261008160000_hrm_h4_timesheet_close. Rolls back. Uses August 2026 (a finished month).
begin;
set local statement_timeout = '180s';

-- HR reviewer (not HR Manage), HR Manage approver, and an employee working since before August.
select set_config('test.h4.hr_auth', u.auth_id::text, true), set_config('test.h4.hr_id', u.id::text, true)
from public.users u where u.is_active and u.auth_id is not null and u.account_status = 'ACTIVE'
  and app_private.hrm_timesheet_is_hr(u.id) and not app_private.hrm_timesheet_is_approver(u.id)
order by u.created_at limit 1;
select set_config('test.h4.mgr_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null and u.account_status = 'ACTIVE' and app_private.hrm_timesheet_is_approver(u.id)
order by u.created_at limit 1;
select set_config('test.h4.emp', e.id::text, true), set_config('test.h4.emp_auth', u.auth_id::text, true)
from public.employees e join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and u.is_active and u.auth_id is not null and u.account_status = 'ACTIVE'
  and (e.start_date is null or e.start_date < '2026-08-01') and not app_private.hrm_timesheet_is_hr(u.id)
order by e.created_at limit 1;

-- A clean August for the employee: Wednesday 05/08 and Thursday 06/08 without punches.
delete from public.hrm_timesheet_periods where year = 2026 and month = 8;
delete from public.hrm_attendance_not_required where employee_id = current_setting('test.h4.emp')::uuid;
delete from public.hrm_attendance where "employeeId" = current_setting('test.h4.emp')::uuid and date in ('2026-08-05', '2026-08-06', '2026-08-07');
delete from public.hrm_leave_requests where "employeeId" = current_setting('test.h4.emp')::uuid and "startDate" between '2026-08-05' and '2026-08-07';
delete from public.hrm_holidays where date between '2026-08-05' and '2026-08-07';
grant select on public.hrm_timesheet_periods, public.hrm_timesheet_snapshots, public.hrm_leave_requests to authenticated;
create policy h4_smoke_read on public.hrm_timesheet_periods for select to authenticated using (true);
create policy h4_smoke_read on public.hrm_timesheet_snapshots for select to authenticated using (true);
create policy h4_smoke_read on public.hrm_leave_requests for select to authenticated using (true);
create or replace function pg_temp.h4_day(p_date text) returns jsonb language sql as $$
  select day from jsonb_array_elements(app_private.hrm_month_timesheet(current_setting('test.h4.emp')::uuid, 2026, 8) -> 'days') day where day ->> 'date' = p_date;
$$;

do $$
begin
  if pg_temp.h4_day('2026-08-05') ->> 'status' <> 'absent' then raise exception 'H4_SETUP_NOT_ABSENT %', pg_temp.h4_day('2026-08-05'); end if;
end;
$$;

-- ── HR: open, fix a day, record leave, send ────────────────────────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.h4.hr_auth'))::text, true);
set local role authenticated;
do $$
declare v_board jsonb; v_code text; v_emp uuid := current_setting('test.h4.emp')::uuid;
begin
  begin
    perform public.open_hrm_timesheet_period(2026, 12);
    raise exception 'H4_OPEN_FUTURE';
  exception when check_violation then null;
  end;
  perform public.open_hrm_timesheet_period(2026, 8);
  v_board := public.get_hrm_timesheet_close_board(2026, 8);
  if v_board -> 'period' ->> 'status' <> 'reviewing' or not (v_board -> 'can' ->> 'review')::boolean or (v_board -> 'can' ->> 'approve')::boolean then
    raise exception 'H4_BOARD_HR %', v_board -> 'period';
  end if;
  if jsonb_array_length(v_board -> 'employees') = 0 then raise exception 'H4_BOARD_EMPTY'; end if;

  perform public.adjust_hrm_timesheet_day(v_emp, '2026-08-05', 'credit', 1, 'Smoke CHT xác nhận đi làm');
  v_code := public.record_hrm_leave_on_behalf(v_emp, 'unpaid', '2026-08-06', '2026-08-06', 'full', 'full', 'Smoke nghỉ việc gia đình');
  if v_code not like 'NP-%' then raise exception 'H4_LEAVE_CODE %', v_code; end if;
  if jsonb_array_length((public.get_hrm_timesheet_close_board(2026, 8)) -> 'adjustments') < 2 then raise exception 'H4_ADJUSTMENTS_LISTED'; end if;
  perform public.submit_hrm_timesheet_period(2026, 8);
  begin
    perform public.adjust_hrm_timesheet_day(v_emp, '2026-08-07', 'credit', 1, 'Smoke sửa khi đã gửi');
    raise exception 'H4_EDIT_WHILE_SUBMITTED';
  exception when check_violation then null;
  end;
  begin
    perform public.decide_hrm_timesheet_period(2026, 8, true, null);
    raise exception 'H4_HR_APPROVES';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  if (pg_temp.h4_day('2026-08-05') ->> 'workCredit')::numeric <> 1 or not (pg_temp.h4_day('2026-08-05') ->> 'adjusted')::boolean then raise exception 'H4_CREDIT_OVERLAY %', pg_temp.h4_day('2026-08-05'); end if;
  if pg_temp.h4_day('2026-08-06') ->> 'status' <> 'leave' or pg_temp.h4_day('2026-08-06') ->> 'leaveType' <> 'unpaid' then raise exception 'H4_LEAVE_ON_DAY %', pg_temp.h4_day('2026-08-06'); end if;
end;
$$;

-- ── HR Manage: approve → snapshot and lock ─────────────────────────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.h4.mgr_auth'))::text, true);
set local role authenticated;
do $$
declare v_rows jsonb;
begin
  perform public.decide_hrm_timesheet_period(2026, 8, true, null);
  if (select status from public.hrm_timesheet_periods where year = 2026 and month = 8) <> 'closed' then raise exception 'H4_NOT_CLOSED'; end if;
  if (select count(*) from public.hrm_timesheet_snapshots where year = 2026 and month = 8 and version = 1) = 0 then raise exception 'H4_NO_SNAPSHOT'; end if;
  v_rows := public.get_hrm_timesheet(2026, 8, current_setting('test.h4.emp')::uuid);
  if jsonb_array_length(v_rows) <> 1 then raise exception 'H4_SNAPSHOT_READ %', jsonb_array_length(v_rows); end if;
end;
$$;
reset role;

do $$
begin
  begin
    insert into public.hrm_attendance (id, "employeeId", date, status, "checkIn", "createdAt")
    values (gen_random_uuid(), current_setting('test.h4.emp')::uuid, '2026-08-07', 'present', '08:00', now());
    raise exception 'H4_ATTENDANCE_NOT_LOCKED';
  exception when check_violation then null;
  end;
  begin
    update public.hrm_leave_requests set status = 'cancelled' where "employeeId" = current_setting('test.h4.emp')::uuid and "startDate" = '2026-08-06';
    raise exception 'H4_LEAVE_NOT_LOCKED';
  exception when check_violation then null;
  end;
end;
$$;

-- ── Reopen, employee feedback, not-required person ─────────────────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.h4.mgr_auth'))::text, true);
set local role authenticated;
do $$ begin perform public.reopen_hrm_timesheet_period(2026, 8, 'Smoke mở lại để sửa'); end; $$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.h4.emp_auth'))::text, true);
set local role authenticated;
do $$
declare v_board jsonb;
begin
  perform public.submit_my_timesheet_feedback(2026, 8, '2026-08-07', 'Smoke ngày 07 em có đi làm');
  v_board := public.get_hrm_timesheet_close_board(2026, 8);
  if jsonb_array_length(v_board -> 'employees') <> 1 or (v_board -> 'can' ->> 'review')::boolean then raise exception 'H4_EMPLOYEE_SCOPE %', v_board -> 'can'; end if;
  if jsonb_array_length(v_board -> 'feedback') <> 1 then raise exception 'H4_FEEDBACK_SAVED'; end if;
  begin
    perform public.adjust_hrm_timesheet_day(current_setting('test.h4.emp')::uuid, '2026-08-07', 'credit', 1, 'Smoke tự sửa công');
    raise exception 'H4_EMPLOYEE_EDITS';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.h4.hr_auth'))::text, true);
set local role authenticated;
do $$
declare v_board jsonb;
begin
  v_board := public.get_hrm_timesheet_close_board(2026, 8);
  if (v_board -> 'period' ->> 'version')::integer <> 2 or v_board -> 'period' ->> 'status' <> 'reviewing' then raise exception 'H4_REOPEN %', v_board -> 'period'; end if;
  perform public.adjust_hrm_timesheet_day(current_setting('test.h4.emp')::uuid, '2026-08-07', 'credit', 1, 'Smoke xác nhận theo phản hồi');
  if (public.get_hrm_timesheet_close_board(2026, 8) -> 'feedback' -> 0 ->> 'status') <> 'resolved' then raise exception 'H4_FEEDBACK_RESOLVED'; end if;
  perform public.set_hrm_attendance_not_required(current_setting('test.h4.emp')::uuid, true, 'Smoke ban lãnh đạo');
end;
$$;
reset role;

do $$
begin
  -- Friday 14/08 has no punch: counted in full for a person not required to punch.
  delete from public.hrm_attendance where "employeeId" = current_setting('test.h4.emp')::uuid and date = '2026-08-14';
  if pg_temp.h4_day('2026-08-14') ->> 'status' <> 'present' or (pg_temp.h4_day('2026-08-14') ->> 'workCredit')::numeric <> 1 then
    raise exception 'H4_NOT_REQUIRED %', pg_temp.h4_day('2026-08-14');
  end if;
end;
$$;

select 'hrm_h4_timesheet_close_smoke passed' as result;
rollback;

-- Run after 20261006160000_hrm_g4_timesheet. Rolls back.
begin;
set local statement_timeout = '90s';

select set_config('test.g4.auth_id', u.auth_id::text, true),
       set_config('test.g4.email', u.email, true),
       set_config('test.g4.employee_id', e.id::text, true)
from public.users u join public.employees e on e.user_id = u.id and e.status = 'Đang làm việc'
where u.is_active and u.auth_id is not null and u.role <> 'ADMIN' and e.construction_site_id is null
  and not app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
order by u.created_at limit 1;

-- A clean week (Mon 05/01/2026 … Sun 11/01/2026) on the 08:00–17:00 office shift.
delete from public.hrm_attendance where "employeeId" = current_setting('test.g4.employee_id')::uuid and date like '2026-01-%';
delete from public.hrm_leave_requests where "employeeId" = current_setting('test.g4.employee_id')::uuid and "startDate" like '2026-01-%';
delete from public.hrm_employee_shifts where employee_id = current_setting('test.g4.employee_id')::uuid;
insert into public.hrm_employee_shifts (employee_id, shift_type_id, shift_date, is_day_off)
select current_setting('test.g4.employee_id')::uuid, shift.id, null, false
from public.hrm_shift_types shift where shift.start_time = '08:00' and shift.end_time = '17:00' limit 1;

insert into public.hrm_attendance (id, "employeeId", date, status, "checkIn", "checkOut", "approvalStatus", "createdAt") values
  (gen_random_uuid(), current_setting('test.g4.employee_id')::uuid, '2026-01-05', 'present', '08:01', '17:00', 'approved', now()), -- late 1 → 30
  (gen_random_uuid(), current_setting('test.g4.employee_id')::uuid, '2026-01-06', 'present', '08:31', '16:45', 'approved', now()), -- late 31 → 60, early 15 → 30
  (gen_random_uuid(), current_setting('test.g4.employee_id')::uuid, '2026-01-07', 'present', '07:30', '18:10', 'approved', now()), -- extra 30 + 70
  (gen_random_uuid(), current_setting('test.g4.employee_id')::uuid, '2026-01-08', 'present', '08:20', '17:00', 'approved', now()), -- late 20, excused
  (gen_random_uuid(), current_setting('test.g4.employee_id')::uuid, '2026-01-09', 'present', '08:00', null, 'approved', now()),    -- missing punch
  (gen_random_uuid(), current_setting('test.g4.employee_id')::uuid, '2026-01-11', 'present', '08:00', '12:00', 'approved', now()); -- Sunday work: 240 extra

insert into public.hrm_leave_requests (id, "employeeId", type, "startDate", "endDate", "totalDays", reason, status, minutes, subtype, approvers, current_step)
values (gen_random_uuid(), current_setting('test.g4.employee_id')::uuid, 'late_early', '2026-01-08', '2026-01-08', 0, 'smoke', 'approved', 20, 'Đi muộn', '[]', 2);

do $$
declare v_sheet jsonb := app_private.hrm_month_timesheet(current_setting('test.g4.employee_id')::uuid, 2026, 1);
        v_day jsonb;
begin
  select value into v_day from jsonb_array_elements(v_sheet -> 'days') where value ->> 'date' = '2026-01-05';
  if (v_day ->> 'lateBlock')::int <> 30 or (v_day ->> 'workCredit')::numeric <> 1 then raise exception 'HRM_G4_LATE_1 %', v_day; end if;
  select value into v_day from jsonb_array_elements(v_sheet -> 'days') where value ->> 'date' = '2026-01-06';
  if (v_day ->> 'lateBlock')::int <> 60 or (v_day ->> 'earlyBlock')::int <> 30 then raise exception 'HRM_G4_LATE_31 %', v_day; end if;
  select value into v_day from jsonb_array_elements(v_sheet -> 'days') where value ->> 'date' = '2026-01-07';
  if (v_day ->> 'extraMinutes')::int <> 100 then raise exception 'HRM_G4_EXTRA %', v_day; end if;
  select value into v_day from jsonb_array_elements(v_sheet -> 'days') where value ->> 'date' = '2026-01-08';
  if (v_day ->> 'lateBlock')::int <> 0 or (v_day ->> 'excusedLate')::int <> 20 then raise exception 'HRM_G4_EXCUSE %', v_day; end if;
  select value into v_day from jsonb_array_elements(v_sheet -> 'days') where value ->> 'date' = '2026-01-09';
  if v_day ->> 'status' <> 'missing_punch' then raise exception 'HRM_G4_MISSING %', v_day; end if;
  select value into v_day from jsonb_array_elements(v_sheet -> 'days') where value ->> 'date' = '2026-01-11';
  if v_day ->> 'status' <> 'off_day_work' or (v_day ->> 'extraMinutes')::int <> 240 then raise exception 'HRM_G4_SUNDAY %', v_day; end if;
  if (v_sheet -> 'totals' ->> 'lateBlockMinutes')::int <> 90 or (v_sheet -> 'totals' ->> 'earlyBlockMinutes')::int <> 30
    or (v_sheet -> 'totals' ->> 'extraMinutes')::int <> 340 or (v_sheet -> 'totals' ->> 'workDays')::numeric <> 4 then
    raise exception 'HRM_G4_TOTALS %', v_sheet -> 'totals';
  end if;
end;
$$;

-- The employee: own timesheet only, overtime request validated and routed manager → HR.
select set_config('request.jwt.claim.sub', current_setting('test.g4.auth_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g4.auth_id'), 'email', current_setting('test.g4.email'))::text, true);
set local role authenticated;
do $$
declare v_rows jsonb := public.get_hrm_timesheet(2026, 1, null); v_preview jsonb;
begin
  if jsonb_array_length(v_rows) <> 1 or v_rows -> 0 ->> 'employeeId' <> current_setting('test.g4.employee_id') then
    raise exception 'HRM_G4_EMPLOYEE_SEES_OTHERS %', jsonb_array_length(v_rows);
  end if;
  v_preview := public.preview_my_leave_request('overtime', '2026-01-01', '2026-01-01', 'full', 'full', 400);
  if jsonb_array_length(v_preview -> 'problems') = 0 then raise exception 'HRM_G4_OVERTIME_OVER_EXTRA'; end if;
  v_preview := public.preview_my_leave_request('overtime', '2026-01-01', '2026-01-01', 'full', 'full', 300);
  if jsonb_array_length(v_preview -> 'problems') > 0 or v_preview -> 'steps' -> -1 ->> 'kind' <> 'hr' then
    raise exception 'HRM_G4_OVERTIME_PREVIEW %', v_preview;
  end if;
  v_preview := public.preview_my_leave_request('late_early', '2026-01-12', '2026-01-12', 'full', 'full', 30);
  if v_preview -> 'steps' -> -1 ->> 'kind' <> 'hr' then raise exception 'HRM_G4_LATE_NO_HR_STEP %', v_preview; end if;
end;
$$;
reset role;

select 'hrm_g4_timesheet_smoke passed' as result;
rollback;

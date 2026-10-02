-- HRM G4 — practical timesheet (owner requirements 02/10/2026, docs/audits/hrm-attendance-leave-2026-10-02 §13):
--   1. Each day is measured against the person's shift (dated roster → default roster → work schedule → 08:00–17:00).
--   2. Late arrival / early leave rounds up to 30-minute blocks (1–30 → 30, 31–60 → 60 …), per day and per month.
--   3. An approved late/early explanation (manager → HR) covers its minutes: full credit.
--   4. Early arrival / late departure adds real minutes (no rounding); confirmed through an "overtime"
--      request (manager → HR) they become overtime minutes, within 40 hours a month.
--   5. One server function builds the month for each person; HR sees everyone, others themselves.

alter table public.hrm_leave_types add column if not exists second_step_hr boolean not null default false;
update public.hrm_leave_types set second_step_hr = true where code = 'late_early';
insert into public.hrm_leave_types (code, name, description, paid_by, deducts_annual, unit, needs_second_step, requires_official, sort_order, second_step_hr)
values ('overtime', 'Xác nhận làm thêm giờ', 'Xác nhận số phút đến sớm / về muộn trong tháng thành giờ làm thêm (trần 40 giờ/tháng).', 'company', false, 'minute', false, false, 75, true)
on conflict (code) do update set second_step_hr = true, unit = 'minute', is_active = true;

-- ── Month timesheet of one person ──────────────────────────────────────────
create or replace function app_private.hrm_minutes_of(p_time text)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case when p_time ~ '^\d{1,2}:\d{2}' then split_part(p_time, ':', 1)::int * 60 + split_part(p_time, ':', 2)::int end;
$function$;

create or replace function app_private.hrm_month_timesheet(p_employee_id uuid, p_year integer, p_month integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_first date := make_date(p_year, p_month, 1);
  v_last date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_saturday boolean := coalesce((select saturday_is_workday from public.hrm_leave_settings where singleton), true);
  v_employee public.employees%rowtype;
  v_day date;
  v_days jsonb := '[]'::jsonb;
  -- shift of the day, in minutes after midnight
  v_shift_name text; v_start integer; v_end integer; v_break integer; v_day_off boolean;
  v_morning_end integer; v_afternoon_start integer;
  v_expected_start integer; v_expected_end integer;
  v_attendance public.hrm_attendance;
  v_in integer; v_out integer;
  v_is_holiday boolean; v_is_workday boolean;
  v_leave_type text; v_leave_part text; v_leave_name text;
  v_excuse_late integer; v_excuse_early integer;
  v_late_raw integer; v_early_raw integer; v_late_block integer; v_early_block integer;
  v_extra integer; v_worked integer; v_status text; v_credit numeric; v_leave_credit numeric;
  -- totals
  t_work numeric := 0; t_leave numeric := 0; t_unpaid numeric := 0; t_holiday integer := 0; t_absent integer := 0;
  t_missing integer := 0; t_late_count integer := 0; t_late_block integer := 0; t_early_count integer := 0;
  t_early_block integer := 0; t_excused integer := 0; t_extra integer := 0; t_worked integer := 0;
  t_leave_by_type jsonb := '{}'::jsonb;
  v_ot_approved integer; v_ot_pending integer;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then return null; end if;

  for v_day in select generate_series(v_first, v_last, interval '1 day')::date loop
    v_shift_name := null; v_start := null; v_end := null; v_break := 60; v_day_off := false;
    v_morning_end := null; v_afternoon_start := null;

    -- Shift: the dated roster entry first, then the person's default roster entry.
    select shift.name, app_private.hrm_minutes_of(to_char(shift.start_time, 'HH24:MI')),
           app_private.hrm_minutes_of(to_char(shift.end_time, 'HH24:MI')),
           coalesce(shift.break_minutes, 0), coalesce(roster.is_day_off, false)
    into v_shift_name, v_start, v_end, v_break, v_day_off
    from public.hrm_employee_shifts roster
    join public.hrm_shift_types shift on shift.id = roster.shift_type_id
    where roster.employee_id = p_employee_id and (roster.shift_date = v_day or roster.shift_date is null)
    order by roster.shift_date nulls last
    limit 1;

    if v_shift_name is null then
      select schedule.name, app_private.hrm_minutes_of(schedule.morning_start), app_private.hrm_minutes_of(schedule.afternoon_end),
             app_private.hrm_minutes_of(schedule.morning_end), app_private.hrm_minutes_of(schedule.afternoon_start)
      into v_shift_name, v_start, v_end, v_morning_end, v_afternoon_start
      from public.hrm_work_schedules schedule where schedule.id = v_employee.work_schedule_id;
      v_break := coalesce(v_afternoon_start - v_morning_end, 60);
    end if;
    if v_start is null or v_end is null then
      v_shift_name := 'Ca hành chính'; v_start := 480; v_end := 1020; v_break := 60;
    end if;
    if v_end <= v_start then v_end := v_end + 1440; end if; -- night shift
    if v_morning_end is null then
      v_morning_end := v_start + ((v_end - v_start - v_break) / 2);
      v_afternoon_start := v_morning_end + v_break;
    end if;

    v_is_holiday := exists (select 1 from public.hrm_holidays holiday where holiday.date = v_day);
    v_is_workday := not v_day_off and not v_is_holiday
      and extract(isodow from v_day) <> 7 and (v_saturday or extract(isodow from v_day) <> 6);

    select * into v_attendance from public.hrm_attendance attendance
    where attendance."employeeId" = p_employee_id and attendance.date = v_day::text;
    v_in := app_private.hrm_minutes_of(v_attendance."checkIn");
    v_out := app_private.hrm_minutes_of(v_attendance."checkOut");
    if v_out is not null and v_in is not null and v_out < v_in then v_out := v_out + 1440; end if;

    -- Approved day leave (business trips count as work).
    v_leave_type := null; v_leave_part := null; v_leave_name := null;
    select request.type, leave_type.name,
      case
        when request."startDate" = request."endDate" then request.start_session
        when v_day = request."startDate"::date and request.start_session = 'afternoon' then 'afternoon'
        when v_day = request."endDate"::date and request.end_session = 'morning' then 'morning'
        else 'full'
      end
    into v_leave_type, v_leave_name, v_leave_part
    from public.hrm_leave_requests request
    join public.hrm_leave_types leave_type on leave_type.code = request.type and leave_type.unit = 'day'
    where request."employeeId" = p_employee_id and request.status = 'approved' and request.type <> 'business_trip'
      and v_day between request."startDate"::date and request."endDate"::date
    order by request."approvedAt" desc nulls last
    limit 1;

    -- Approved late / early explanations for the day.
    select coalesce(sum(request.minutes) filter (where coalesce(request.subtype, 'Đi muộn') not in ('Về sớm', 'Ra ngoài trong giờ')), 0),
           coalesce(sum(request.minutes) filter (where request.subtype = 'Về sớm'), 0)
    into v_excuse_late, v_excuse_early
    from public.hrm_leave_requests request
    where request."employeeId" = p_employee_id and request.type = 'late_early' and request.status = 'approved'
      and request."startDate"::date = v_day;

    v_expected_start := case when v_leave_part = 'morning' then v_afternoon_start else v_start end;
    v_expected_end := case when v_leave_part = 'afternoon' then v_morning_end else v_end end;
    v_late_raw := 0; v_early_raw := 0; v_late_block := 0; v_early_block := 0; v_extra := 0; v_worked := 0;
    v_credit := 0; v_leave_credit := 0;

    if v_in is not null and v_out is not null then
      v_worked := greatest(0, v_out - v_in
        - case when v_in < v_morning_end and v_out > v_afternoon_start then v_break else 0 end);
    end if;

    if v_day > v_today then
      v_status := 'future';
    elsif v_leave_part = 'full' then
      v_status := 'leave';
      v_leave_credit := 1;
    elsif v_is_holiday then
      v_status := 'holiday';
    elsif not v_is_workday then
      v_status := case when v_in is not null then 'off_day_work' else 'off' end;
      v_extra := v_worked;
    elsif v_in is null and v_out is null then
      v_status := case when v_leave_part is not null then 'leave' else coalesce(nullif(v_attendance.status, 'present'), 'absent') end;
      v_leave_credit := case when v_leave_part is not null then 0.5 else 0 end;
    elsif v_in is null or v_out is null or v_attendance."checkOut" is null then
      v_status := 'missing_punch';
      v_leave_credit := case when v_leave_part is not null then 0.5 else 0 end;
    else
      v_status := 'present';
      v_credit := case when v_leave_part is not null then 0.5 else 1 end;
      v_leave_credit := case when v_leave_part is not null then 0.5 else 0 end;
      v_late_raw := greatest(0, v_in - v_expected_start);
      v_early_raw := greatest(0, v_expected_end - v_out);
      v_late_block := ceil(greatest(0, v_late_raw - v_excuse_late) / 30.0)::int * 30;
      v_early_block := ceil(greatest(0, v_early_raw - v_excuse_early) / 30.0)::int * 30;
      v_extra := greatest(0, v_expected_start - v_in) + greatest(0, v_out - v_expected_end);
    end if;

    if v_status in ('absent') then t_absent := t_absent + 1; end if;
    if v_status = 'missing_punch' then t_missing := t_missing + 1; end if;
    if v_status = 'holiday' then t_holiday := t_holiday + 1; end if;
    if v_late_block > 0 then t_late_count := t_late_count + 1; end if;
    if v_early_block > 0 then t_early_count := t_early_count + 1; end if;
    t_work := t_work + v_credit;
    t_late_block := t_late_block + v_late_block;
    t_early_block := t_early_block + v_early_block;
    t_excused := t_excused + least(v_late_raw, v_excuse_late) + least(v_early_raw, v_excuse_early);
    t_extra := t_extra + v_extra;
    t_worked := t_worked + v_worked;
    if v_leave_credit > 0 and v_leave_type is not null then
      t_leave_by_type := jsonb_set(t_leave_by_type, array[v_leave_type],
        to_jsonb(coalesce((t_leave_by_type ->> v_leave_type)::numeric, 0) + v_leave_credit));
      if (select paid_by from public.hrm_leave_types where code = v_leave_type) = 'none' then
        t_unpaid := t_unpaid + v_leave_credit;
      else
        t_leave := t_leave + v_leave_credit;
      end if;
    end if;

    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'date', v_day,
      'weekday', extract(isodow from v_day),
      'shiftName', v_shift_name,
      'shiftStart', lpad((v_expected_start / 60 % 24)::text, 2, '0') || ':' || lpad((v_expected_start % 60)::text, 2, '0'),
      'shiftEnd', lpad((v_expected_end / 60 % 24)::text, 2, '0') || ':' || lpad((v_expected_end % 60)::text, 2, '0'),
      'checkIn', v_attendance."checkIn",
      'checkOut', v_attendance."checkOut",
      'status', v_status,
      'leaveType', v_leave_type,
      'leaveName', v_leave_name,
      'leavePart', v_leave_part,
      'workCredit', v_credit,
      'lateMinutes', v_late_raw,
      'earlyMinutes', v_early_raw,
      'lateBlock', v_late_block,
      'earlyBlock', v_early_block,
      'excusedLate', least(v_late_raw, v_excuse_late),
      'excusedEarly', least(v_early_raw, v_excuse_early),
      'extraMinutes', v_extra,
      'workedMinutes', v_worked,
      'locationName', v_attendance."locationName",
      'flags', coalesce(v_attendance."suspicionFlags", '[]'::jsonb)
    ));
  end loop;

  select coalesce(sum(request.minutes) filter (where request.status = 'approved'), 0),
         coalesce(sum(request.minutes) filter (where request.status = 'pending'), 0)
  into v_ot_approved, v_ot_pending
  from public.hrm_leave_requests request
  where request."employeeId" = p_employee_id and request.type = 'overtime'
    and request."startDate"::date between v_first and v_last;

  return jsonb_build_object(
    'days', v_days,
    'totals', jsonb_build_object(
      'workDays', t_work,
      'paidLeaveDays', t_leave,
      'unpaidLeaveDays', t_unpaid,
      'leaveByType', t_leave_by_type,
      'holidays', t_holiday,
      'absentDays', t_absent,
      'missingPunchDays', t_missing,
      'lateCount', t_late_count,
      'lateBlockMinutes', t_late_block,
      'earlyCount', t_early_count,
      'earlyBlockMinutes', t_early_block,
      'excusedMinutes', t_excused,
      'extraMinutes', t_extra,
      'overtimeApprovedMinutes', v_ot_approved,
      'overtimePendingMinutes', v_ot_pending,
      'overtimeUnclaimedMinutes', greatest(0, t_extra - v_ot_approved - v_ot_pending),
      'workedMinutes', t_worked
    )
  );
end;
$function$;
revoke all on function app_private.hrm_month_timesheet(uuid, integer, integer) from public, anon, authenticated;

create or replace function app_private.hrm_overtime_claimed_minutes(p_employee_id uuid, p_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(sum(request.minutes), 0)::int
  from public.hrm_leave_requests request
  where request."employeeId" = p_employee_id and request.type = 'overtime' and request.status in ('pending', 'approved')
    and date_trunc('month', request."startDate"::date) = date_trunc('month', p_day);
$function$;
revoke all on function app_private.hrm_overtime_claimed_minutes(uuid, date) from public, anon, authenticated;

create or replace function app_private.hrm_overtime_unclaimed_minutes(p_employee_id uuid, p_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select greatest(0,
    coalesce((app_private.hrm_month_timesheet(p_employee_id, extract(year from p_day)::int, extract(month from p_day)::int)
      -> 'totals' ->> 'extraMinutes')::int, 0)
    - app_private.hrm_overtime_claimed_minutes(p_employee_id, p_day));
$function$;
revoke all on function app_private.hrm_overtime_unclaimed_minutes(uuid, date) from public, anon, authenticated;

-- ── Timesheet for the caller: everyone for HR / company-wide attendance viewers, otherwise oneself ──
create or replace function public.get_hrm_timesheet(p_year integer, p_month integer, p_employee_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if public.current_app_user_id() is null then
    raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.';
  end if;
  if p_month not between 1 and 12 or p_year not between 2020 and 2100 then
    raise exception using errcode = '22023', message = 'Tháng không hợp lệ.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employeeId', employee.id,
      'employeeCode', employee.employee_code,
      'fullName', employee.full_name,
      'orgUnitName', org.name,
      'timesheet', app_private.hrm_month_timesheet(employee.id, p_year, p_month)
    ) order by org.name nulls last, employee.full_name)
    from public.employees employee
    left join public.org_units org on org.id = employee.org_unit_id
    where employee.id in (select visible.employee_id from app_private.current_actor_hrm_visible_employee_ids('hrm.attendance.view') visible)
      and (p_employee_id is null or employee.id = p_employee_id)
      and (employee.status = 'Đang làm việc' or exists (
        select 1 from public.hrm_attendance attendance
        where attendance."employeeId" = employee.id and attendance.date like p_year || '-' || lpad(p_month::text, 2, '0') || '-%'
      ))
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.get_hrm_timesheet(integer, integer, uuid) from public, anon;
grant execute on function public.get_hrm_timesheet(integer, integer, uuid) to authenticated;

-- ── Leave engine: HR step for late/early and overtime; overtime minutes validated against the timesheet ──
create or replace function app_private.hrm_leave_approval_chain(p_employee_id uuid, p_type text, p_days numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_employee public.employees%rowtype;
  v_type public.hrm_leave_types%rowtype;
  v_settings public.hrm_leave_settings%rowtype;
  v_step1_user uuid;
  v_step1_label text;
  v_step1_kind text := 'manager';
  v_steps jsonb := '[]'::jsonb;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  select * into v_type from public.hrm_leave_types where code = p_type;
  select * into v_settings from public.hrm_leave_settings where singleton;

  -- Site staff: the person Admin assigned to approve for that construction site.
  if v_employee.construction_site_id is not null then
    select nullif(site."managerId", '')::uuid into v_step1_user
    from public.hrm_construction_sites site where site.id = v_employee.construction_site_id;
    v_step1_label := 'Quản lý công trường';
  end if;
  -- Everyone else: their manager in the org chart, then the account's direct manager.
  if v_step1_user is null then
    v_step1_user := app_private.resolve_slot_direct_manager(v_employee.user_id);
    v_step1_label := 'Quản lý trong sơ đồ tổ chức';
  end if;
  if v_step1_user is null then
    select u.manager_id into v_step1_user from public.users u where u.id = v_employee.user_id;
    v_step1_label := 'Quản lý trực tiếp';
  end if;
  -- Nobody approves their own request: the step moves up to the second-step approver.
  if v_step1_user = v_employee.user_id then
    v_step1_user := v_settings.second_step_approver_user_id;
    v_step1_label := v_settings.second_step_label;
  end if;
  if v_step1_user is null or v_step1_user = v_employee.user_id then
    v_step1_user := null;
    v_step1_kind := 'hr';
    v_step1_label := 'Phòng Hành chính - Nhân sự';
  end if;

  v_steps := jsonb_build_array(jsonb_build_object(
    'order', 1, 'kind', v_step1_kind, 'userId', v_step1_user, 'label', v_step1_label, 'status', 'waiting'));

  if coalesce(v_type.needs_second_step, false)
    and p_days > v_settings.second_step_threshold_days
    and v_settings.second_step_approver_user_id is not null
    and v_settings.second_step_approver_user_id is distinct from v_step1_user
    and v_settings.second_step_approver_user_id <> v_employee.user_id
  then
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'order', 2, 'kind', 'director', 'userId', v_settings.second_step_approver_user_id,
      'label', v_settings.second_step_label, 'status', 'waiting'));
  end if;
  -- Late/early explanations and overtime confirmations are also checked by HR (owner decision 02/10/2026).
  if coalesce(v_type.second_step_hr, false) and v_step1_kind <> 'hr' then
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'order', jsonb_array_length(v_steps) + 1, 'kind', 'hr', 'userId', null,
      'label', 'Phòng Hành chính - Nhân sự', 'status', 'waiting'));
  end if;
  return v_steps;
end;
$function$;
revoke all on function app_private.hrm_leave_approval_chain(uuid, text, numeric) from public, anon, authenticated;

create or replace function public.preview_my_leave_request(
  p_type text, p_start date, p_end date, p_start_session text default 'full', p_end_session text default 'full', p_minutes integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
  v_type public.hrm_leave_types%rowtype;
  v_settings public.hrm_leave_settings%rowtype;
  v_days numeric := 0;
  v_steps jsonb;
  v_remaining numeric;
  v_problems jsonb := '[]'::jsonb;
  v_unclaimed integer;
  v_month_claimed integer;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  select * into v_employee from public.employees
  where user_id = v_user and status = 'Đang làm việc' order by updated_at desc nulls last limit 1;
  if v_employee.id is null then raise exception using errcode = '42501', message = 'Tài khoản chưa liên kết hồ sơ nhân sự.'; end if;
  select * into v_type from public.hrm_leave_types where code = p_type and is_active;
  if v_type.code is null then raise exception using errcode = '22023', message = 'Loại đơn không hợp lệ.'; end if;
  select * into v_settings from public.hrm_leave_settings where singleton;

  if p_start is null or (v_type.unit = 'day' and (p_end is null or p_end < p_start)) then
    v_problems := v_problems || jsonb_build_array('Chọn ngày bắt đầu và ngày kết thúc hợp lệ.');
  end if;

  if v_type.code = 'overtime' and p_start is not null then
    v_unclaimed := app_private.hrm_overtime_unclaimed_minutes(v_employee.id, p_start);
    v_month_claimed := app_private.hrm_overtime_claimed_minutes(v_employee.id, p_start);
    if p_minutes is null or p_minutes < 1 then
      v_problems := v_problems || jsonb_build_array('Nhập số phút làm thêm cần xác nhận.');
    elsif p_minutes > v_unclaimed then
      v_problems := v_problems || jsonb_build_array(format('Tháng %s chỉ còn %s phút dư chưa xác nhận.', to_char(p_start, 'MM/YYYY'), v_unclaimed));
    elsif v_month_claimed + p_minutes > 2400 then
      v_problems := v_problems || jsonb_build_array('Vượt trần làm thêm 40 giờ/tháng (Bộ luật Lao động, Nghị định 145/2020).');
    end if;
  elsif v_type.unit = 'minute' then
    if p_minutes is null or p_minutes < 1 or p_minutes > v_settings.late_early_max_minutes then
      v_problems := v_problems || jsonb_build_array(format('Số phút từ 1 đến %s.', v_settings.late_early_max_minutes));
    end if;
  else
    v_days := app_private.hrm_leave_working_days(p_start, p_end, coalesce(p_start_session, 'full'), coalesce(p_end_session, 'full'));
    if p_start is not null and p_end is not null and v_days = 0 then
      v_problems := v_problems || jsonb_build_array('Khoảng ngày này không có ngày làm việc nào.');
    end if;
  end if;

  if v_type.requires_official and v_employee.official_date is not null and v_employee.official_date > coalesce(p_start, current_date) then
    v_problems := v_problems || jsonb_build_array('Nhân sự đang thử việc chưa có phép năm. Chọn "Nghỉ không lương" hoặc loại phù hợp.');
  end if;

  if v_type.deducts_annual and p_start is not null then
    v_remaining := app_private.hrm_leave_annual_remaining(v_employee.id, extract(year from p_start)::integer);
    if v_days > v_remaining then
      v_problems := v_problems || jsonb_build_array(format('Không đủ phép năm: còn %s ngày, đơn này cần %s ngày.', v_remaining, v_days));
    end if;
  end if;

  v_steps := app_private.hrm_leave_approval_chain(v_employee.id, p_type, v_days);
  select coalesce(jsonb_agg(step || jsonb_build_object('name', coalesce(u.name, 'Phòng Hành chính - Nhân sự')) order by (step ->> 'order')::int), '[]'::jsonb)
  into v_steps
  from jsonb_array_elements(v_steps) step
  left join public.users u on u.id::text = step ->> 'userId';

  return jsonb_build_object(
    'days', v_days,
    'minutes', p_minutes,
    'annualRemaining', v_remaining,
    'steps', v_steps,
    'problems', v_problems,
    'paidBy', v_type.paid_by,
    'unclaimedMinutes', v_unclaimed
  );
end;
$function$;

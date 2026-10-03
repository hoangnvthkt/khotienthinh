-- H4 Chốt công tháng (owner decisions 03/10/2026):
--   * One company-wide period per month: HR reviews (đang rà soát) → HR Manage approves (đã chốt) or sends back.
--   * HR fixes are an overlay (hrm_timesheet_adjustments) on the computed timesheet, always with a reason; leave is fixed by
--     recording an approved leave on the employee's behalf so balances and the leave ledger stay right.
--   * Employees see their month and send feedback while HR reviews.
--   * Approval stores a snapshot per person (version 1, 2… when reopened) and locks the month: leave, make-up punches,
--     late/early explanations and attendance edits for its days are refused until HR Manage reopens it.
--   * People HR marks as "không chấm công" get full credit on working days (leave still needs a request).
--   * Days before employees.start_date are "chưa vào làm", not absences; insurance-paid leave is counted apart.

-- ── Tables ─────────────────────────────────────────────────────────────────
create table if not exists public.hrm_timesheet_periods (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2020 and 2100),
  month integer not null check (month between 1 and 12),
  status text not null default 'reviewing' check (status in ('reviewing', 'submitted', 'closed')),
  version integer not null default 1,
  opened_by uuid, opened_at timestamptz not null default now(),
  submitted_by uuid, submitted_at timestamptz,
  decided_by uuid, decided_at timestamptz,
  return_note text,
  updated_at timestamptz not null default now(),
  unique (year, month)
);
alter table public.hrm_timesheet_periods enable row level security;
revoke all on public.hrm_timesheet_periods from anon, authenticated;

create table if not exists public.hrm_timesheet_period_events (
  id uuid primary key default gen_random_uuid(),
  year integer not null, month integer not null,
  action text not null check (action in ('open', 'submit', 'approve', 'return', 'reopen')),
  actor uuid, note text, created_at timestamptz not null default now()
);
create index if not exists hrm_timesheet_period_events_idx on public.hrm_timesheet_period_events (year, month, created_at);
alter table public.hrm_timesheet_period_events enable row level security;
revoke all on public.hrm_timesheet_period_events from anon, authenticated;

create table if not exists public.hrm_timesheet_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('credit', 'excuse', 'leave')),
  value numeric,
  before_value numeric,
  leave_request_id uuid,
  reason text not null check (char_length(btrim(reason)) >= 5),
  created_by uuid, created_at timestamptz not null default now(),
  removed_by uuid, removed_at timestamptz, remove_reason text
);
create index if not exists hrm_timesheet_adjustments_day_idx on public.hrm_timesheet_adjustments (employee_id, date) where removed_at is null;
create index if not exists hrm_timesheet_adjustments_month_idx on public.hrm_timesheet_adjustments (date);
alter table public.hrm_timesheet_adjustments enable row level security;
revoke all on public.hrm_timesheet_adjustments from anon, authenticated;

create table if not exists public.hrm_timesheet_feedback (
  id uuid primary key default gen_random_uuid(),
  year integer not null, month integer not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date,
  message text not null check (char_length(btrim(message)) >= 5),
  status text not null default 'open' check (status in ('open', 'resolved')),
  reply text, resolved_by uuid, resolved_at timestamptz,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists hrm_timesheet_feedback_month_idx on public.hrm_timesheet_feedback (year, month, employee_id);
alter table public.hrm_timesheet_feedback enable row level security;
revoke all on public.hrm_timesheet_feedback from anon, authenticated;

create table if not exists public.hrm_timesheet_snapshots (
  id uuid primary key default gen_random_uuid(),
  year integer not null, month integer not null, version integer not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  row jsonb not null,
  created_at timestamptz not null default now(),
  unique (year, month, version, employee_id)
);
alter table public.hrm_timesheet_snapshots enable row level security;
revoke all on public.hrm_timesheet_snapshots from anon, authenticated;

create table if not exists public.hrm_attendance_not_required (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) >= 5),
  set_by uuid, set_at timestamptz not null default now()
);
alter table public.hrm_attendance_not_required enable row level security;
revoke all on public.hrm_attendance_not_required from anon, authenticated;

-- ── Helpers ────────────────────────────────────────────────────────────────
create or replace function app_private.hrm_timesheet_is_hr(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null and (app_private.has_hrm_template_permission(p_user_id, 'hrm.employee.view_sensitive')
    or app_private.has_hrm_template_permission(p_user_id, 'hrm.master_data.manage'));
$function$;
revoke all on function app_private.hrm_timesheet_is_hr(uuid) from public, anon, authenticated;

create or replace function app_private.hrm_timesheet_is_approver(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null and app_private.has_hrm_template_permission(p_user_id, 'hrm.master_data.manage');
$function$;
revoke all on function app_private.hrm_timesheet_is_approver(uuid) from public, anon, authenticated;

-- A month is locked while it waits for approval and once it is closed.
create or replace function app_private.hrm_month_locked(p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_day is not null and exists (
    select 1 from public.hrm_timesheet_periods period
    where period.year = extract(year from p_day)::integer and period.month = extract(month from p_day)::integer
      and period.status in ('submitted', 'closed'));
$function$;
revoke all on function app_private.hrm_month_locked(date) from public, anon;
grant execute on function app_private.hrm_month_locked(date) to authenticated, service_role;

create or replace function app_private.hrm_range_locked_month(p_start date, p_end date)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select to_char(make_date(period.year, period.month, 1), 'MM/YYYY') from public.hrm_timesheet_periods period
  where period.status in ('submitted', 'closed')
    and make_date(period.year, period.month, 1) <= coalesce(p_end, p_start)
    and (make_date(period.year, period.month, 1) + interval '1 month - 1 day')::date >= p_start
  order by period.year, period.month limit 1;
$function$;
revoke all on function app_private.hrm_range_locked_month(date, date) from public, anon, authenticated;

-- ── Month lock on the sources of the timesheet ─────────────────────────────
create or replace function app_private.guard_hrm_leave_month_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_month text;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new."startDate" is distinct from old."startDate" or new."endDate" is distinct from old."endDate" then
    if tg_op = 'UPDATE' and new.status = old.status and new.status in ('rejected', 'cancelled') then return new; end if;
    if tg_op = 'UPDATE' and old.status in ('pending') and new.status in ('rejected', 'cancelled') then return new; end if;
    v_month := app_private.hrm_range_locked_month(least(new."startDate"::date, coalesce(old."startDate", new."startDate")::date),
                                                  greatest(new."endDate"::date, coalesce(old."endDate", new."endDate")::date));
    if v_month is not null then
      raise exception using errcode = '23514', message = format('Tháng %s đã chốt công (hoặc đang chờ duyệt chốt). Liên hệ HR để mở lại kỳ công.', v_month);
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_guard_hrm_leave_month_lock on public.hrm_leave_requests;
create trigger trg_guard_hrm_leave_month_lock before insert or update on public.hrm_leave_requests
  for each row execute function app_private.guard_hrm_leave_month_lock();

create or replace function app_private.guard_hrm_proposal_month_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (tg_op = 'INSERT' or new."proposalStatus" is distinct from old."proposalStatus")
     and coalesce(new."proposalStatus", '') <> 'rejected' and app_private.hrm_month_locked(new.date) then
    raise exception using errcode = '23514', message = format('Tháng %s đã chốt công. Liên hệ HR để mở lại kỳ công.', to_char(new.date, 'MM/YYYY'));
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_guard_hrm_proposal_month_lock on public.hrm_attendance_proposals;
create trigger trg_guard_hrm_proposal_month_lock before insert or update on public.hrm_attendance_proposals
  for each row execute function app_private.guard_hrm_proposal_month_lock();

-- Punch data of a locked month cannot change (photo retention and other housekeeping columns still can).
create or replace function app_private.guard_hrm_attendance_month_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_day date := coalesce(new.date, old.date)::date;
begin
  if not app_private.hrm_month_locked(v_day) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new."checkIn" is not distinct from old."checkIn"
     and new."checkOut" is not distinct from old."checkOut" and new.date is not distinct from old.date
     and new."employeeId" is not distinct from old."employeeId" then
    return new;
  end if;
  raise exception using errcode = '23514', message = format('Tháng %s đã chốt công; không sửa được chấm công. Liên hệ HR để mở lại kỳ công.', to_char(v_day, 'MM/YYYY'));
end;
$function$;
drop trigger if exists trg_guard_hrm_attendance_month_lock on public.hrm_attendance;
create trigger trg_guard_hrm_attendance_month_lock before insert or update or delete on public.hrm_attendance
  for each row execute function app_private.guard_hrm_attendance_month_lock();

-- ── Month timesheet (G4) with H4 additions ─────────────────────────────────
create or replace function app_private.hrm_month_timesheet(p_employee_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- H4: people HR marked as not punching, HR adjustments, insurance-paid leave kept apart.
  v_not_required boolean;
  v_adj_credit numeric; v_adj_excuse integer; v_adjusted boolean; v_paid_by text;
  t_insurance numeric := 0;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then return null; end if;
  v_not_required := exists (select 1 from public.hrm_attendance_not_required exempt where exempt.employee_id = p_employee_id);

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

    if v_employee.start_date is not null and v_day < v_employee.start_date then
      v_status := 'not_employed';
    elsif v_day > v_today then
      v_status := 'future';
    elsif v_leave_part = 'full' then
      v_status := 'leave';
      v_leave_credit := 1;
    elsif v_is_holiday then
      v_status := 'holiday';
    elsif not v_is_workday then
      v_status := case when v_in is not null then 'off_day_work' else 'off' end;
      v_extra := v_worked;
    elsif v_not_required and (v_in is null or v_out is null or v_attendance."checkOut" is null) then
      -- Not required to punch: a working day counts in full unless there is leave.
      v_status := 'present';
      v_credit := case when v_leave_part is not null then 0.5 else 1 end;
      v_leave_credit := case when v_leave_part is not null then 0.5 else 0 end;
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

    if v_not_required then v_late_block := 0; v_early_block := 0; end if;

    -- HR adjustments made while closing the month (H4) are laid over the computed day.
    v_adjusted := false;
    if v_status not in ('future', 'not_employed') then
      select adjustment.value into v_adj_credit from public.hrm_timesheet_adjustments adjustment
      where adjustment.employee_id = p_employee_id and adjustment.date = v_day and adjustment.kind = 'credit' and adjustment.removed_at is null
      order by adjustment.created_at desc limit 1;
      if v_adj_credit is not null then
        v_adjusted := true;
        v_credit := least(v_adj_credit, 1 - v_leave_credit);
        v_status := case when v_credit > 0 then 'present' when v_leave_credit > 0 then 'leave' else 'absent' end;
        if v_credit = 0 then v_late_block := 0; v_early_block := 0; end if;
      end if;
      select sum(adjustment.value)::integer into v_adj_excuse from public.hrm_timesheet_adjustments adjustment
      where adjustment.employee_id = p_employee_id and adjustment.date = v_day and adjustment.kind = 'excuse' and adjustment.removed_at is null;
      if v_adj_excuse is not null then
        v_adjusted := true;
        v_late_block := 0; v_early_block := 0;
      end if;
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
      v_paid_by := (select paid_by from public.hrm_leave_types where code = v_leave_type);
      if v_paid_by = 'none' then
        t_unpaid := t_unpaid + v_leave_credit;
      elsif v_paid_by = 'social_insurance' then
        t_insurance := t_insurance + v_leave_credit;
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
      'flags', coalesce(v_attendance."suspicionFlags", '[]'::jsonb),
      'adjusted', v_adjusted,
      'notRequired', v_not_required
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
      'insuranceLeaveDays', t_insurance,
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


-- One row of the timesheet as screens and the snapshot use it.
create or replace function app_private.hrm_timesheet_row(p_employee_id uuid, p_year integer, p_month integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'employeeId', employee.id, 'employeeCode', employee.employee_code, 'fullName', employee.full_name, 'orgUnitName', org.name,
    'timesheet', app_private.hrm_month_timesheet(employee.id, p_year, p_month))
  from public.employees employee left join public.org_units org on org.id = employee.org_unit_id
  where employee.id = p_employee_id;
$function$;
revoke all on function app_private.hrm_timesheet_row(uuid, integer, integer) from public, anon, authenticated;

-- People in a month's timesheet: still working, or with punches in that month.
create or replace function app_private.hrm_timesheet_employee_ids(p_year integer, p_month integer)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select employee.id from public.employees employee
  where employee.status = 'Đang làm việc' and lower(coalesce(employee.full_name, '')) <> 'demo'
     or exists (select 1 from public.hrm_attendance attendance
                where attendance."employeeId" = employee.id and attendance.date like p_year || '-' || lpad(p_month::text, 2, '0') || '-%'
                  and attendance."checkIn" is not null);
$function$;
revoke all on function app_private.hrm_timesheet_employee_ids(integer, integer) from public, anon, authenticated;

-- A closed month reads its snapshot; others are computed live.
create or replace function public.get_hrm_timesheet(p_year integer, p_month integer, p_employee_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_period public.hrm_timesheet_periods%rowtype;
begin
  if public.current_app_user_id() is null then
    raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.';
  end if;
  if p_month not between 1 and 12 or p_year not between 2020 and 2100 then
    raise exception using errcode = '22023', message = 'Tháng không hợp lệ.';
  end if;
  select * into v_period from public.hrm_timesheet_periods where year = p_year and month = p_month;
  if v_period.status = 'closed' then
    return coalesce((
      select jsonb_agg(snapshot.row order by snapshot.row ->> 'orgUnitName' nulls last, snapshot.row ->> 'fullName')
      from public.hrm_timesheet_snapshots snapshot
      where snapshot.year = p_year and snapshot.month = p_month and snapshot.version = v_period.version
        and snapshot.employee_id in (select visible.employee_id from app_private.current_actor_hrm_visible_employee_ids('hrm.attendance.view') visible)
        and (p_employee_id is null or snapshot.employee_id = p_employee_id)
    ), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(app_private.hrm_timesheet_row(employee.id, p_year, p_month) order by org.name nulls last, employee.full_name)
    from public.employees employee
    left join public.org_units org on org.id = employee.org_unit_id
    where employee.id in (select visible.employee_id from app_private.current_actor_hrm_visible_employee_ids('hrm.attendance.view') visible)
      and (p_employee_id is null or employee.id = p_employee_id)
      and employee.id in (select app_private.hrm_timesheet_employee_ids(p_year, p_month))
  ), '[]'::jsonb);
end;
$function$;

-- Requests that still change the month and must be decided before sending it for approval.
create or replace function app_private.hrm_timesheet_pending(p_year integer, p_month integer, p_employee_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with bounds as (select make_date(p_year, p_month, 1) as first_day, (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date as last_day)
  select coalesce(jsonb_agg(item order by item ->> 'date'), '[]'::jsonb) from (
    select jsonb_build_object('kind', case when leave_type.unit = 'minute' then 'explain' else 'leave' end,
      'employeeId', request."employeeId", 'date', greatest(request."startDate"::date, bounds.first_day),
      'endDate', least(request."endDate"::date, bounds.last_day), 'code', request.code,
      'label', format('Đơn %s · %s', coalesce(request.code, ''), leave_type.name)) item
    from public.hrm_leave_requests request
    join public.hrm_leave_types leave_type on leave_type.code = request.type
    join public.employees employee on employee.id = request."employeeId" and employee.status = 'Đang làm việc'
    cross join bounds
    where request.status = 'pending' and request."startDate"::date <= bounds.last_day and request."endDate"::date >= bounds.first_day
      and (p_employee_id is null or request."employeeId" = p_employee_id)
    union all
    select jsonb_build_object('kind', 'makeup', 'employeeId', employee.id, 'date', proposal.date,
      'label', format('Chấm công bù %s–%s', coalesce(proposal."checkIn", '?'), coalesce(proposal."checkOut", '?')))
    from public.hrm_attendance_proposals proposal
    join public.employees employee on employee.id::text = proposal."targetEmployeeId" and employee.status = 'Đang làm việc'
    cross join bounds
    where proposal."proposalStatus" = 'pending' and proposal.date between bounds.first_day and bounds.last_day
      and (p_employee_id is null or employee.id = p_employee_id)
  ) pending;
$function$;
revoke all on function app_private.hrm_timesheet_pending(integer, integer, uuid) from public, anon, authenticated;

create or replace function app_private.notify_hrm_timesheet(p_user_ids uuid[], p_title text, p_body text, p_year integer, p_month integer)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link text := format('/hrm/timesheet?year=%s&month=%s', p_year, p_month);
begin
  insert into public.notifications (
    user_id, title, body, type, priority, module, link, metadata, category, message, severity,
    source_type, source_id, push_enabled, action_url, entity_type, delivery_reason
  )
  select distinct recipient::text, p_title, p_body, 'info', 'normal', 'HRM', v_link,
    jsonb_build_object('year', p_year, 'month', p_month), 'hrm_timesheet', p_body, 'info', 'hrm_timesheet',
    format('%s-%s', p_year, p_month), true, v_link, 'hrm_timesheet_period', 'responsible'
  from unnest(p_user_ids) recipient
  where recipient is not null and recipient is distinct from public.current_app_user_id();
end;
$function$;
revoke all on function app_private.notify_hrm_timesheet(uuid[], text, text, integer, integer) from public, anon, authenticated;

create or replace function app_private.hrm_timesheet_approver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(u.id), '{}') from public.users u
  where coalesce(u.is_active, true) and app_private.has_hrm_template_permission(u.id, 'hrm.master_data.manage');
$function$;
revoke all on function app_private.hrm_timesheet_approver_ids() from public, anon, authenticated;

create or replace function app_private.hrm_timesheet_require_reviewing(p_year integer, p_month integer)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
begin
  if not app_private.hrm_timesheet_is_hr(v_user) then
    raise exception using errcode = '42501', message = 'Chỉ HR được rà soát chốt công.';
  end if;
  if not exists (select 1 from public.hrm_timesheet_periods where year = p_year and month = p_month and status = 'reviewing') then
    raise exception using errcode = '23514', message = 'Kỳ công không ở bước rà soát (chưa bắt đầu, đang chờ duyệt hoặc đã chốt).';
  end if;
  return v_user;
end;
$function$;
revoke all on function app_private.hrm_timesheet_require_reviewing(integer, integer) from public, anon, authenticated;

-- ── Board ──────────────────────────────────────────────────────────────────
create or replace function public.get_hrm_timesheet_close_board(p_year integer, p_month integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_hr boolean;
  v_approver boolean;
  v_period public.hrm_timesheet_periods%rowtype;
  v_me uuid;
  v_first date;
  v_last date;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if p_month not between 1 and 12 or p_year not between 2020 and 2100 then raise exception using errcode = '22023', message = 'Tháng không hợp lệ.'; end if;
  v_hr := app_private.hrm_timesheet_is_hr(v_user);
  v_approver := app_private.hrm_timesheet_is_approver(v_user);
  v_first := make_date(p_year, p_month, 1);
  v_last := (v_first + interval '1 month - 1 day')::date;
  select * into v_period from public.hrm_timesheet_periods where year = p_year and month = p_month;
  select employee.id into v_me from public.employees employee where employee.user_id = v_user and employee.status = 'Đang làm việc' order by employee.updated_at desc nulls last limit 1;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'year', p_year, 'month', p_month, 'status', coalesce(v_period.status, 'open'), 'version', coalesce(v_period.version, 1),
      'openedByName', (select name from public.users where id = v_period.opened_by), 'openedAt', v_period.opened_at,
      'submittedByName', (select name from public.users where id = v_period.submitted_by), 'submittedAt', v_period.submitted_at,
      'decidedByName', (select name from public.users where id = v_period.decided_by), 'decidedAt', v_period.decided_at,
      'returnNote', v_period.return_note),
    'employees', case when v_hr or v_approver then public.get_hrm_timesheet(p_year, p_month, null)
                      when v_me is not null then public.get_hrm_timesheet(p_year, p_month, v_me) else '[]'::jsonb end,
    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object('id', adjustment.id, 'employeeId', adjustment.employee_id, 'date', adjustment.date, 'kind', adjustment.kind,
        'value', case when adjustment.kind = 'leave' then to_jsonb(request.type) else to_jsonb(adjustment.value) end,
        'before', adjustment.before_value, 'reason', adjustment.reason, 'byName', creator.name, 'at', adjustment.created_at, 'leaveCode', request.code)
        order by adjustment.created_at)
      from public.hrm_timesheet_adjustments adjustment
      left join public.users creator on creator.id = adjustment.created_by
      left join public.hrm_leave_requests request on request.id = adjustment.leave_request_id
      where adjustment.removed_at is null and adjustment.date between v_first and v_last
        and (v_hr or v_approver or adjustment.employee_id = v_me)), '[]'::jsonb),
    'feedback', coalesce((
      select jsonb_agg(jsonb_build_object('id', feedback.id, 'employeeId', feedback.employee_id, 'date', feedback.date, 'message', feedback.message,
        'status', feedback.status, 'reply', feedback.reply, 'createdAt', feedback.created_at) order by feedback.created_at)
      from public.hrm_timesheet_feedback feedback
      where feedback.year = p_year and feedback.month = p_month and (v_hr or v_approver or feedback.employee_id = v_me)), '[]'::jsonb),
    'pending', case when v_hr or v_approver then app_private.hrm_timesheet_pending(p_year, p_month) else '[]'::jsonb end,
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('date', holiday.date, 'name', holiday.name) order by holiday.date)
      from public.hrm_holidays holiday where holiday.date::date between v_first and v_last), '[]'::jsonb),
    'notRequired', case when v_hr or v_approver then coalesce((
      select jsonb_agg(jsonb_build_object('employeeId', exempt.employee_id, 'fullName', employee.full_name, 'employeeCode', employee.employee_code,
        'reason', exempt.reason, 'setByName', setter.name, 'setAt', exempt.set_at) order by employee.full_name)
      from public.hrm_attendance_not_required exempt
      join public.employees employee on employee.id = exempt.employee_id
      left join public.users setter on setter.id = exempt.set_by), '[]'::jsonb) else '[]'::jsonb end,
    'can', jsonb_build_object('review', v_hr, 'approve', v_approver, 'isSubmitter', v_period.submitted_by is not null and v_period.submitted_by = v_user)
  );
end;
$function$;
revoke all on function public.get_hrm_timesheet_close_board(integer, integer) from public, anon;
grant execute on function public.get_hrm_timesheet_close_board(integer, integer) to authenticated;

-- ── Period steps ───────────────────────────────────────────────────────────
create or replace function public.open_hrm_timesheet_period(p_year integer, p_month integer)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
begin
  if not app_private.hrm_timesheet_is_hr(v_user) then raise exception using errcode = '42501', message = 'Chỉ HR được bắt đầu chốt công.'; end if;
  if p_month not between 1 and 12 or p_year not between 2020 and 2100 then raise exception using errcode = '22023', message = 'Tháng không hợp lệ.'; end if;
  if make_date(p_year, p_month, 1) + interval '1 month' > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception using errcode = '23514', message = 'Chờ hết tháng mới bắt đầu chốt công.';
  end if;
  if exists (select 1 from public.hrm_timesheet_periods where year = p_year and month = p_month) then
    raise exception using errcode = '23514', message = 'Kỳ công tháng này đã bắt đầu.';
  end if;
  insert into public.hrm_timesheet_periods (year, month, status, opened_by) values (p_year, p_month, 'reviewing', v_user);
  insert into public.hrm_timesheet_period_events (year, month, action, actor) values (p_year, p_month, 'open', v_user);
  perform app_private.notify_hrm_timesheet(
    (select coalesce(array_agg(employee.user_id), '{}') from public.employees employee where employee.status = 'Đang làm việc' and employee.user_id is not null),
    format('Công tháng %s/%s đã có', lpad(p_month::text, 2, '0'), p_year),
    'Kiểm tra công của bạn ở Nhân sự → Công tháng; sai thì gửi phản hồi để HR sửa trước khi chốt.', p_year, p_month);
end;
$function$;
revoke all on function public.open_hrm_timesheet_period(integer, integer) from public, anon;
grant execute on function public.open_hrm_timesheet_period(integer, integer) to authenticated;

create or replace function public.adjust_hrm_timesheet_day(p_employee_id uuid, p_date date, p_kind text, p_value numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid;
  v_day jsonb;
  v_before numeric;
begin
  if p_date is null then raise exception using errcode = '22023', message = 'Chọn ngày.'; end if;
  v_user := app_private.hrm_timesheet_require_reviewing(extract(year from p_date)::integer, extract(month from p_date)::integer);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 5 ký tự).'; end if;
  if p_kind not in ('credit', 'excuse') then raise exception using errcode = '22023', message = 'Loại điều chỉnh không hợp lệ.'; end if;
  if p_kind = 'credit' and p_value not in (0, 0.5, 1) then raise exception using errcode = '22023', message = 'Công ngày là 0, ½ hoặc 1.'; end if;
  if p_kind = 'excuse' and (p_value is null or p_value <= 0 or p_value > 480) then raise exception using errcode = '22023', message = 'Số phút miễn không hợp lệ.'; end if;
  select day into v_day from jsonb_array_elements(app_private.hrm_month_timesheet(p_employee_id, extract(year from p_date)::integer, extract(month from p_date)::integer) -> 'days') day
  where (day ->> 'date')::date = p_date;
  if v_day is null or v_day ->> 'status' in ('future', 'not_employed') then
    raise exception using errcode = '23514', message = 'Ngày này không sửa công được (chưa tới hoặc chưa vào làm).';
  end if;
  v_before := case when p_kind = 'credit' then (v_day ->> 'workCredit')::numeric else ((v_day ->> 'lateBlock')::numeric + (v_day ->> 'earlyBlock')::numeric) end;
  update public.hrm_timesheet_adjustments set removed_by = v_user, removed_at = now(), remove_reason = 'Thay bằng điều chỉnh mới'
  where employee_id = p_employee_id and date = p_date and kind = p_kind and removed_at is null;
  insert into public.hrm_timesheet_adjustments (employee_id, date, kind, value, before_value, reason, created_by)
  values (p_employee_id, p_date, p_kind, p_value, v_before, btrim(p_reason), v_user);
  -- The employee's feedback for that day is answered by the fix.
  update public.hrm_timesheet_feedback set status = 'resolved', reply = btrim(p_reason), resolved_by = v_user, resolved_at = now()
  where employee_id = p_employee_id and date = p_date and status = 'open';
end;
$function$;
revoke all on function public.adjust_hrm_timesheet_day(uuid, date, text, numeric, text) from public, anon;
grant execute on function public.adjust_hrm_timesheet_day(uuid, date, text, numeric, text) to authenticated;

create or replace function public.remove_hrm_timesheet_adjustment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.hrm_timesheet_adjustments%rowtype;
  v_user uuid;
begin
  select * into v_row from public.hrm_timesheet_adjustments where id = p_id and removed_at is null;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy điều chỉnh.'; end if;
  v_user := app_private.hrm_timesheet_require_reviewing(extract(year from v_row.date)::integer, extract(month from v_row.date)::integer);
  if v_row.kind = 'leave' then raise exception using errcode = '23514', message = 'Đơn nghỉ ghi thay: hủy đơn ở trang Nghỉ phép.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 5 ký tự).'; end if;
  update public.hrm_timesheet_adjustments set removed_by = v_user, removed_at = now(), remove_reason = btrim(p_reason) where id = p_id;
end;
$function$;
revoke all on function public.remove_hrm_timesheet_adjustment(uuid, text) from public, anon;
grant execute on function public.remove_hrm_timesheet_adjustment(uuid, text) to authenticated;

-- HR records an approved leave for the employee (balance, leave ledger and timesheet move as with a normal approval).
create or replace function public.record_hrm_leave_on_behalf(
  p_employee_id uuid, p_type text, p_start date, p_end date, p_start_session text, p_end_session text, p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
  v_type public.hrm_leave_types%rowtype;
  v_days numeric;
  v_code text;
  v_row public.hrm_leave_requests;
  v_year integer;
  v_day date;
  v_period public.hrm_timesheet_periods%rowtype;
begin
  if not app_private.hrm_timesheet_is_hr(v_user) then raise exception using errcode = '42501', message = 'Chỉ HR được ghi đơn nghỉ thay.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 5 ký tự).'; end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy nhân viên.'; end if;
  select * into v_type from public.hrm_leave_types where code = p_type and is_active and unit = 'day';
  if v_type.code is null then raise exception using errcode = '22023', message = 'Loại nghỉ không hợp lệ.'; end if;
  if p_start is null or coalesce(p_end, p_start) < p_start then raise exception using errcode = '22023', message = 'Chọn ngày nghỉ hợp lệ.'; end if;
  select * into v_period from public.hrm_timesheet_periods where year = extract(year from p_start)::integer and month = extract(month from p_start)::integer;
  if v_period.id is not null and v_period.status <> 'reviewing' then
    raise exception using errcode = '23514', message = 'Kỳ công tháng này đang chờ duyệt hoặc đã chốt.';
  end if;
  v_days := app_private.hrm_leave_working_days(p_start, coalesce(p_end, p_start), coalesce(p_start_session, 'full'), coalesce(p_end_session, 'full'));
  if v_days = 0 then raise exception using errcode = '23514', message = 'Khoảng ngày này không có ngày làm việc nào.'; end if;
  if v_type.deducts_annual and v_days > app_private.hrm_leave_annual_available(p_employee_id, p_start) then
    raise exception using errcode = '23514', message = format('Không đủ phép năm: còn %s ngày, cần %s ngày. Chọn loại khác (ví dụ Nghỉ không lương).',
      app_private.hrm_leave_annual_available(p_employee_id, p_start), v_days);
  end if;
  if exists (
    select 1 from public.hrm_leave_requests request
    join public.hrm_leave_types existing_type on existing_type.code = request.type and existing_type.unit = 'day'
    where request."employeeId" = p_employee_id and request.status in ('pending', 'approved')
      and request."startDate"::date <= coalesce(p_end, p_start) and request."endDate"::date >= p_start
  ) then
    raise exception using errcode = '23514', message = 'Nhân viên đã có đơn nghỉ trùng những ngày này.';
  end if;

  v_code := 'NP-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY') || '-' || lpad((
    select count(*) + 1 from public.hrm_leave_requests where code like 'NP-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY') || '-%'
  )::text, 4, '0');
  insert into public.hrm_leave_requests (
    id, "employeeId", type, "startDate", "endDate", "totalDays", reason, status, code, approvers,
    start_session, end_session, current_step, created_by, "createdAt", priority, "approvedBy", "approvedAt"
  ) values (
    gen_random_uuid(), p_employee_id, p_type, p_start::text, coalesce(p_end, p_start)::text, v_days, btrim(p_reason), 'approved', v_code,
    jsonb_build_array(jsonb_build_object('order', 1, 'kind', 'hr', 'userId', v_user, 'label', 'Phòng HCNS ghi thay khi chốt công',
      'status', 'approved', 'decidedBy', v_user, 'decidedAt', now(), 'onBehalf', true)),
    coalesce(p_start_session, 'full'), coalesce(p_end_session, 'full'), 1, v_user, now(), 'medium', v_user::text, now()::text
  ) returning * into v_row;
  insert into public.hrm_leave_logs (leave_request_id, action, acted_by, comment) values (v_row.id, 'create', v_user, 'HR ghi đơn nghỉ thay khi chốt công: ' || btrim(p_reason));

  v_year := extract(year from p_start)::integer;
  if v_type.deducts_annual then
    perform app_private.hrm_leave_ledger_label('leave', v_row.id, p_start, 'Nghỉ phép năm ' || v_code || ' (HR ghi thay)');
    update public.hrm_leave_balances set "usedPaidDays" = "usedPaidDays" + v_days where "employeeId" = p_employee_id and year = v_year;
    perform app_private.hrm_leave_ledger_label(null);
  elsif v_type.paid_by = 'none' then
    update public.hrm_leave_balances set "usedUnpaidDays" = "usedUnpaidDays" + v_days where "employeeId" = p_employee_id and year = v_year;
  end if;
  if v_type.code <> 'business_trip' then
    for v_day in select generate_series(p_start, coalesce(p_end, p_start), interval '1 day')::date loop
      continue when app_private.hrm_leave_working_days(v_day, v_day,
        case when v_day = p_start then coalesce(p_start_session, 'full') else 'full' end,
        case when v_day = coalesce(p_end, p_start) then coalesce(p_end_session, 'full') else 'full' end) <> 1;
      insert into public.hrm_attendance (id, "employeeId", date, status, note, "approvalStatus", "createdAt")
      values (gen_random_uuid(), p_employee_id, v_day::text, 'leave', 'leave:' || v_row.id, 'approved', now())
      on conflict ("employeeId", date) do update
        set status = 'leave', note = left(concat_ws(E'\n', nullif(public.hrm_attendance.note, ''), 'leave:' || v_row.id), 1000)
        where public.hrm_attendance."checkIn" is null;
    end loop;
  end if;

  for v_day in select generate_series(p_start, coalesce(p_end, p_start), interval '1 day')::date loop
    insert into public.hrm_timesheet_adjustments (employee_id, date, kind, leave_request_id, reason, created_by)
    values (p_employee_id, v_day, 'leave', v_row.id, btrim(p_reason), v_user);
    update public.hrm_timesheet_feedback set status = 'resolved', reply = format('HR ghi đơn nghỉ %s: %s', v_code, btrim(p_reason)), resolved_by = v_user, resolved_at = now()
    where employee_id = p_employee_id and date = v_day and status = 'open';
  end loop;
  perform app_private.notify_hrm_leave(v_row.id, array[v_employee.user_id], 'HR đã ghi đơn nghỉ thay bạn',
    format('%s · %s ngày từ %s: %s', v_type.name, v_days, to_char(p_start, 'DD/MM'), btrim(p_reason)));
  return v_code;
end;
$function$;
revoke all on function public.record_hrm_leave_on_behalf(uuid, text, date, date, text, text, text) from public, anon;
grant execute on function public.record_hrm_leave_on_behalf(uuid, text, date, date, text, text, text) to authenticated;

create or replace function public.submit_hrm_timesheet_period(p_year integer, p_month integer)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := app_private.hrm_timesheet_require_reviewing(p_year, p_month);
  v_pending jsonb := app_private.hrm_timesheet_pending(p_year, p_month);
begin
  if jsonb_array_length(v_pending) > 0 then
    raise exception using errcode = '23514', message = format('Còn %s đơn chờ duyệt trong tháng (%s). Duyệt hoặc từ chối trước khi gửi.',
      jsonb_array_length(v_pending), v_pending -> 0 ->> 'label');
  end if;
  update public.hrm_timesheet_periods set status = 'submitted', submitted_by = v_user, submitted_at = now(), return_note = null, updated_at = now()
  where year = p_year and month = p_month;
  insert into public.hrm_timesheet_period_events (year, month, action, actor) values (p_year, p_month, 'submit', v_user);
  perform app_private.notify_hrm_timesheet(app_private.hrm_timesheet_approver_ids(), format('Công tháng %s/%s chờ duyệt chốt', lpad(p_month::text, 2, '0'), p_year),
    format('%s đã rà soát xong; duyệt hoặc trả lại.', (select name from public.users where id = v_user)), p_year, p_month);
end;
$function$;
revoke all on function public.submit_hrm_timesheet_period(integer, integer) from public, anon;
grant execute on function public.submit_hrm_timesheet_period(integer, integer) to authenticated;

create or replace function public.decide_hrm_timesheet_period(p_year integer, p_month integer, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_period public.hrm_timesheet_periods%rowtype;
  v_employee uuid;
begin
  if not app_private.hrm_timesheet_is_approver(v_user) then raise exception using errcode = '42501', message = 'Chỉ HR Manage được duyệt chốt công.'; end if;
  select * into v_period from public.hrm_timesheet_periods where year = p_year and month = p_month for update;
  if v_period.status is distinct from 'submitted' then raise exception using errcode = '23514', message = 'Kỳ công không ở bước chờ duyệt.'; end if;
  if v_period.submitted_by = v_user then raise exception using errcode = '42501', message = 'Người gửi không tự duyệt chốt công của mình.'; end if;

  if not p_approve then
    if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do trả lại (ít nhất 5 ký tự).'; end if;
    update public.hrm_timesheet_periods set status = 'reviewing', decided_by = v_user, decided_at = now(), return_note = btrim(p_note), updated_at = now()
    where id = v_period.id;
    insert into public.hrm_timesheet_period_events (year, month, action, actor, note) values (p_year, p_month, 'return', v_user, btrim(p_note));
    perform app_private.notify_hrm_timesheet(array[v_period.submitted_by], format('Công tháng %s/%s bị trả lại', lpad(p_month::text, 2, '0'), p_year), btrim(p_note), p_year, p_month);
    return;
  end if;

  -- Snapshot: computed while still "submitted" (live), then the month closes.
  delete from public.hrm_timesheet_snapshots where year = p_year and month = p_month and version = v_period.version;
  for v_employee in select app_private.hrm_timesheet_employee_ids(p_year, p_month) loop
    insert into public.hrm_timesheet_snapshots (year, month, version, employee_id, row)
    values (p_year, p_month, v_period.version, v_employee, app_private.hrm_timesheet_row(v_employee, p_year, p_month));
  end loop;
  update public.hrm_timesheet_periods set status = 'closed', decided_by = v_user, decided_at = now(), return_note = null, updated_at = now()
  where id = v_period.id;
  insert into public.hrm_timesheet_period_events (year, month, action, actor) values (p_year, p_month, 'approve', v_user);
  perform app_private.notify_hrm_timesheet(array_append(app_private.hrm_leave_hr_user_ids(), v_period.submitted_by),
    format('Đã chốt công tháng %s/%s', lpad(p_month::text, 2, '0'), p_year), 'Bản chốt đã lưu; tháng đã khóa.', p_year, p_month);
end;
$function$;
revoke all on function public.decide_hrm_timesheet_period(integer, integer, boolean, text) from public, anon;
grant execute on function public.decide_hrm_timesheet_period(integer, integer, boolean, text) to authenticated;

create or replace function public.reopen_hrm_timesheet_period(p_year integer, p_month integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
begin
  if not app_private.hrm_timesheet_is_approver(v_user) then raise exception using errcode = '42501', message = 'Chỉ HR Manage được mở lại kỳ công.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do mở lại (ít nhất 5 ký tự).'; end if;
  update public.hrm_timesheet_periods set status = 'reviewing', version = version + 1, return_note = btrim(p_reason),
    submitted_by = null, submitted_at = null, decided_by = v_user, decided_at = now(), updated_at = now()
  where year = p_year and month = p_month and status = 'closed';
  if not found then raise exception using errcode = '23514', message = 'Kỳ công chưa chốt.'; end if;
  insert into public.hrm_timesheet_period_events (year, month, action, actor, note) values (p_year, p_month, 'reopen', v_user, btrim(p_reason));
  perform app_private.notify_hrm_timesheet(app_private.hrm_leave_hr_user_ids(), format('Mở lại kỳ công tháng %s/%s', lpad(p_month::text, 2, '0'), p_year), btrim(p_reason), p_year, p_month);
end;
$function$;
revoke all on function public.reopen_hrm_timesheet_period(integer, integer, text) from public, anon;
grant execute on function public.reopen_hrm_timesheet_period(integer, integer, text) to authenticated;

-- ── Employee feedback ──────────────────────────────────────────────────────
create or replace function public.submit_my_timesheet_feedback(p_year integer, p_month integer, p_date date, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_employee uuid;
  v_status text;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  select employee.id into v_employee from public.employees employee where employee.user_id = v_user and employee.status = 'Đang làm việc' order by employee.updated_at desc nulls last limit 1;
  if v_employee is null then raise exception using errcode = '42501', message = 'Tài khoản chưa liên kết hồ sơ nhân sự.'; end if;
  if char_length(btrim(coalesce(p_message, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập nội dung (ít nhất 5 ký tự).'; end if;
  if p_date is not null and (extract(year from p_date)::integer <> p_year or extract(month from p_date)::integer <> p_month) then
    raise exception using errcode = '22023', message = 'Ngày không thuộc tháng này.';
  end if;
  select status into v_status from public.hrm_timesheet_periods where year = p_year and month = p_month;
  if v_status in ('submitted', 'closed') then raise exception using errcode = '23514', message = 'Tháng đã gửi duyệt hoặc đã chốt; liên hệ HR trực tiếp.'; end if;
  insert into public.hrm_timesheet_feedback (year, month, employee_id, date, message, created_by)
  values (p_year, p_month, v_employee, p_date, btrim(p_message), v_user);
  perform app_private.notify_hrm_timesheet(app_private.hrm_leave_hr_user_ids(), 'Phản hồi về công tháng',
    format('%s%s: %s', (select full_name from public.employees where id = v_employee), coalesce(' · ' || to_char(p_date, 'DD/MM'), ''), btrim(p_message)), p_year, p_month);
end;
$function$;
revoke all on function public.submit_my_timesheet_feedback(integer, integer, date, text) from public, anon;
grant execute on function public.submit_my_timesheet_feedback(integer, integer, date, text) to authenticated;

create or replace function public.resolve_hrm_timesheet_feedback(p_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_row public.hrm_timesheet_feedback%rowtype;
begin
  if not app_private.hrm_timesheet_is_hr(v_user) then raise exception using errcode = '42501', message = 'Chỉ HR trả lời phản hồi.'; end if;
  if char_length(btrim(coalesce(p_reply, ''))) < 3 then raise exception using errcode = '22023', message = 'Nhập câu trả lời.'; end if;
  update public.hrm_timesheet_feedback set status = 'resolved', reply = btrim(p_reply), resolved_by = v_user, resolved_at = now()
  where id = p_id and status = 'open' returning * into v_row;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy phản hồi đang mở.'; end if;
  perform app_private.notify_hrm_timesheet(array[(select user_id from public.employees where id = v_row.employee_id)], 'HR đã trả lời phản hồi công tháng',
    btrim(p_reply), v_row.year, v_row.month);
end;
$function$;
revoke all on function public.resolve_hrm_timesheet_feedback(uuid, text) from public, anon;
grant execute on function public.resolve_hrm_timesheet_feedback(uuid, text) to authenticated;

-- ── People not required to punch ───────────────────────────────────────────
create or replace function public.set_hrm_attendance_not_required(p_employee_id uuid, p_not_required boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
begin
  if not app_private.hrm_timesheet_is_hr(v_user) then raise exception using errcode = '42501', message = 'Chỉ HR được đổi người không chấm công.'; end if;
  if p_not_required then
    if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 5 ký tự).'; end if;
    insert into public.hrm_attendance_not_required (employee_id, reason, set_by) values (p_employee_id, btrim(p_reason), v_user)
    on conflict (employee_id) do update set reason = excluded.reason, set_by = excluded.set_by, set_at = now();
  else
    delete from public.hrm_attendance_not_required where employee_id = p_employee_id;
  end if;
end;
$function$;
revoke all on function public.set_hrm_attendance_not_required(uuid, boolean, text) from public, anon;
grant execute on function public.set_hrm_attendance_not_required(uuid, boolean, text) to authenticated;

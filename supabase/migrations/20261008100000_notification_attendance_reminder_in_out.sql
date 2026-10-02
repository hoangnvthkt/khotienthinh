-- Attendance reminders follow each person's shift (owner request 02/10/2026):
--   * a push 10 minutes before the shift starts, if the person has not checked in;
--   * a push 10 minutes before the shift ends, if the person checked in but has not checked out.
-- The shift is found the same way as the timesheet (app_private.hrm_month_timesheet):
-- dated roster → default roster → work schedule → 08:00–17:00; Sundays, holidays, rostered days off
-- and Saturdays (when hrm_leave_settings says so) are skipped, and approved day leave moves or
-- removes the reminder. Before this, the reminder used one check-in time per office/site and had no
-- check-out reminder.
-- The rule stays as the Admin left it (Cài đặt → Cảnh báo); only the default lead time changes.

create or replace function app_private.attendance_shift_of_day(p_employee_id uuid, p_day date)
returns table (shift_start integer, shift_end integer)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_saturday boolean := coalesce((select saturday_is_workday from public.hrm_leave_settings where singleton), true);
  v_start integer; v_end integer; v_break integer; v_day_off boolean;
  v_morning_end integer; v_afternoon_start integer;
  v_leave_part text;
begin
  if extract(isodow from p_day) = 7 or (not v_saturday and extract(isodow from p_day) = 6)
     or exists (select 1 from public.hrm_holidays holiday where holiday.date = p_day) then
    return;
  end if;

  select app_private.hrm_minutes_of(to_char(shift.start_time, 'HH24:MI')),
         app_private.hrm_minutes_of(to_char(shift.end_time, 'HH24:MI')),
         coalesce(shift.break_minutes, 0), coalesce(roster.is_day_off, false)
  into v_start, v_end, v_break, v_day_off
  from public.hrm_employee_shifts roster
  join public.hrm_shift_types shift on shift.id = roster.shift_type_id
  where roster.employee_id = p_employee_id and (roster.shift_date = p_day or roster.shift_date is null)
  order by roster.shift_date nulls last
  limit 1;
  if coalesce(v_day_off, false) then return; end if;

  if v_start is null then
    select app_private.hrm_minutes_of(schedule.morning_start), app_private.hrm_minutes_of(schedule.afternoon_end),
           app_private.hrm_minutes_of(schedule.morning_end), app_private.hrm_minutes_of(schedule.afternoon_start)
    into v_start, v_end, v_morning_end, v_afternoon_start
    from public.employees employee
    join public.hrm_work_schedules schedule on schedule.id = employee.work_schedule_id
    where employee.id = p_employee_id;
    v_break := coalesce(v_afternoon_start - v_morning_end, 60);
  end if;
  if v_start is null or v_end is null then
    v_start := 480; v_end := 1020; v_break := 60;
  end if;
  if v_end <= v_start then v_end := v_end + 1440; end if; -- night shift
  if v_morning_end is null then
    v_morning_end := v_start + ((v_end - v_start - v_break) / 2);
    v_afternoon_start := v_morning_end + v_break;
  end if;

  -- Approved day leave: a full day removes both reminders, a half day moves one of them.
  select case
           when request."startDate" = request."endDate" then request.start_session
           when p_day = request."startDate"::date and request.start_session = 'afternoon' then 'afternoon'
           when p_day = request."endDate"::date and request.end_session = 'morning' then 'morning'
           else 'full'
         end
  into v_leave_part
  from public.hrm_leave_requests request
  join public.hrm_leave_types leave_type on leave_type.code = request.type and leave_type.unit = 'day'
  where request."employeeId" = p_employee_id and request.status = 'approved' and request.type <> 'business_trip'
    and p_day between request."startDate"::date and request."endDate"::date
  order by request."approvedAt" desc nulls last
  limit 1;
  if v_leave_part = 'full' then return; end if;

  shift_start := case when v_leave_part = 'morning' then v_afternoon_start else v_start end;
  shift_end := case when v_leave_part = 'afternoon' then v_morning_end else v_end end;
  return next;
end;
$function$;

revoke all on function app_private.attendance_shift_of_day(uuid, date) from public, anon, authenticated;

create or replace function app_private.alert_attendance_reminders(
  p_rule public.notification_alert_rules,
  p_now timestamp
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lead integer := greatest(coalesce((p_rule.thresholds ->> 'minutesBefore')::integer, 10), 1);
  v_n integer := 0;
  r record;
begin
  for r in
    with people as (
      select employee.id employee_id, employee.user_id
      from public.employees employee
      where employee.status = 'Đang làm việc' and employee.user_id is not null
    ),
    -- Yesterday too: a night shift ends the next morning.
    shifts as (
      select people.*, shift_day.day as day,
             shift_day.day + make_interval(mins => shift.shift_start) start_at,
             shift_day.day + make_interval(mins => shift.shift_end) end_at
      from people
      cross join (values (p_now::date), (p_now::date - 1)) shift_day(day)
      cross join lateral app_private.attendance_shift_of_day(people.employee_id, shift_day.day) shift
    ),
    due as (
      select shifts.*, 'in' kind, shifts.start_at at_time from shifts
      where p_now >= shifts.start_at - make_interval(mins => v_lead) and p_now < shifts.start_at
      union all
      select shifts.*, 'out', shifts.end_at from shifts
      where p_now >= shifts.end_at - make_interval(mins => v_lead) and p_now < shifts.end_at
    )
    select due.*, attendance."checkIn" check_in, attendance."checkOut" check_out
    from due
    left join public.hrm_attendance attendance
      on attendance."employeeId" = due.employee_id and attendance.date = due.day::text
  loop
    if r.kind = 'in' and nullif(r.check_in, '') is null then
      v_n := v_n + app_private.alert_emit(p_rule,
        app_private.alert_resolve_recipients(p_rule, null, null, null, r.user_id),
        'attendance', 'attendance_in_' || r.employee_id || '_' || r.day, 'warning', 'attendance',
        '⏰ Sắp đến giờ vào ca',
        'Còn ' || ceil(extract(epoch from (r.at_time - p_now)) / 60)::int || ' phút nữa đến giờ vào ca ('
          || to_char(r.at_time, 'HH24:MI') || '). Nhớ chấm công vào nhé!',
        'warning', '⏰', '/hrm/checkin', null,
        jsonb_build_object('employeeId', r.employee_id, 'punch', 'check_in', 'shiftDate', r.day, 'shiftTime', to_char(r.at_time, 'HH24:MI')));
    elsif r.kind = 'out' and nullif(r.check_in, '') is not null and nullif(r.check_out, '') is null then
      v_n := v_n + app_private.alert_emit(p_rule,
        app_private.alert_resolve_recipients(p_rule, null, null, null, r.user_id),
        'attendance', 'attendance_out_' || r.employee_id || '_' || r.day, 'warning', 'attendance',
        '⏰ Sắp hết ca',
        'Còn ' || ceil(extract(epoch from (r.at_time - p_now)) / 60)::int || ' phút nữa hết ca ('
          || to_char(r.at_time, 'HH24:MI') || '). Nhớ chấm công ra trước khi về nhé!',
        'warning', '⏰', '/hrm/checkin', null,
        jsonb_build_object('employeeId', r.employee_id, 'punch', 'check_out', 'shiftDate', r.day, 'shiftTime', to_char(r.at_time, 'HH24:MI')));
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke all on function app_private.alert_attendance_reminders(public.notification_alert_rules, timestamp) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.run_scheduled_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamp := (now() at time zone 'Asia/Ho_Chi_Minh');
  v_today date := v_now::date;
  v_rule public.notification_alert_rules;
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  r record;
begin
  -- 1. Overdue payment (Room Thanh toán).
  select * into v_rule from public.notification_alert_rules where alert_key = 'overdue_payment';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_n := 0;
    for r in
      select p.*, site.name site_name
      from public.payment_schedules p
      left join public.hrm_construction_sites site on site.id::text = p.construction_site_id::text
      where p.status in ('pending', 'overdue', 'partial') and nullif(p.due_date, '') is not null and p.due_date < v_today::text
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule, 'payment', r.project_id, r.construction_site_id::text),
        'payment', 'payment_' || r.id, 'error', 'payment', '🧾 Thanh toán quá hạn',
        coalesce(r.description, 'Phiếu thanh toán') || ' — ' || coalesce(r.site_name, 'N/A') || ': quá hạn ' || r.due_date,
        'critical', '🧾', '/da', r.construction_site_id::text,
        jsonb_build_object('paymentId', r.id, 'dueDate', r.due_date, 'amount', r.amount, 'projectId', r.project_id, 'constructionSiteId', r.construction_site_id));
    end loop;
    v_counts := v_counts || jsonb_build_object('overdue_payment', v_n);
  end if;

  -- 2. Attendance reminders before each person's own shift starts and ends.
  select * into v_rule from public.notification_alert_rules where alert_key = 'attendance_reminder';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_counts := v_counts || jsonb_build_object('attendance_reminder', app_private.alert_attendance_reminders(v_rule, v_now));
  end if;

  -- 3. Labour contracts ending soon.
  select * into v_rule from public.notification_alert_rules where alert_key = 'contract_expiry';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_n := 0;
    for r in
      select c.*, e.full_name, (c.effective_to - v_today) days_left
      from public.hrm_labor_contracts c
      left join public.employees e on e.id = c.employee_id
      where c.status = 'active' and c.effective_to is not null
        and c.effective_to between v_today and v_today + coalesce((v_rule.thresholds ->> 'daysBeforeWarning')::integer, 30)
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule),
        'hrm', 'contract_expiry_' || r.id,
        case when r.days_left <= coalesce((v_rule.thresholds ->> 'criticalDays')::integer, 7) then 'error' else 'warning' end,
        'hrm',
        case when r.days_left <= coalesce((v_rule.thresholds ->> 'criticalDays')::integer, 7) then '🚨 Hợp đồng LĐ sắp hết hạn!' else '📝 Hợp đồng LĐ cần gia hạn' end,
        coalesce(r.full_name, 'N/A') || ' — HĐ ' || coalesce(r.contract_number, r.type, '') || ': còn ' || r.days_left || ' ngày (hết hạn ' || to_char(r.effective_to, 'YYYY-MM-DD') || ')',
        case when r.days_left <= coalesce((v_rule.thresholds ->> 'criticalDays')::integer, 7) then 'critical' else 'warning' end,
        '📝', '/hrm/contracts', null,
        jsonb_build_object('contractId', r.id, 'employeeId', r.employee_id, 'daysLeft', r.days_left, 'endDate', r.effective_to));
    end loop;
    v_counts := v_counts || jsonb_build_object('contract_expiry', v_n);
  end if;

  -- 4. Birthdays today.
  select * into v_rule from public.notification_alert_rules where alert_key = 'employee_birthday';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_n := 0;
    for r in
      select e.id, e.full_name, e.date_of_birth from public.employees e
      where e.status = 'Đang làm việc' and e.date_of_birth is not null
        and to_char(e.date_of_birth, 'MM-DD') = to_char(v_today, 'MM-DD')
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule),
        'hrm', 'birthday_' || r.id || '_' || v_today, 'info', 'hrm', '🎂 Sinh nhật nhân viên',
        'Hôm nay là sinh nhật ' || r.full_name || '! Hãy gửi lời chúc mừng nhé 🎉',
        'info', '🎂', '/hrm/employees', null,
        jsonb_build_object('employeeId', r.id, 'birthday', r.date_of_birth));
    end loop;
    v_counts := v_counts || jsonb_build_object('employee_birthday', v_n);
  end if;

  -- 5. Payroll not prepared for the current month (from the rule's start day).
  select * into v_rule from public.notification_alert_rules where alert_key = 'missing_payroll';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true)
     and extract(day from v_today) >= coalesce((v_rule.thresholds ->> 'startDay')::integer, 25) then
    v_n := 0;
    select count(*) total, string_agg(full_name, ', ') filter (where rn <= 3) names into r
    from (
      select e.full_name, row_number() over (order by e.full_name) rn
      from public.employees e
      where e.status = 'Đang làm việc'
        and not exists (select 1 from public.hrm_payrolls p where p."employeeId" = e.id
                        and p.month = extract(month from v_today)::int and p.year = extract(year from v_today)::int)
    ) missing;
    if r.total > 0 then
      v_n := app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule),
        'hrm', 'payroll_missing_' || extract(year from v_today)::int || '_' || extract(month from v_today)::int,
        'warning', 'hrm', '💰 Chưa tính lương tháng này',
        r.total || ' nhân viên chưa có bảng lương T' || extract(month from v_today)::int || '/' || extract(year from v_today)::int
          || ': ' || coalesce(r.names, '') || case when r.total > 3 then ' và ' || (r.total - 3) || ' NV khác' else '' end,
        'warning', '💰', '/hrm/payroll', null,
        jsonb_build_object('month', extract(month from v_today)::int, 'year', extract(year from v_today)::int, 'count', r.total));
    end if;
    v_counts := v_counts || jsonb_build_object('missing_payroll', v_n);
  end if;

  -- 6. Daily logs waiting for verification too long (Room Nhật ký).
  select * into v_rule from public.notification_alert_rules where alert_key = 'stale_daily_log';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_n := 0;
    for r in
      select l.id, l.date, l.project_id, l.construction_site_id, site.name site_name
      from public.daily_logs l
      left join public.hrm_construction_sites site on site.id::text = l.construction_site_id::text
      where l.status = 'submitted'
        and l.submitted_at < now() - make_interval(days => coalesce((v_rule.thresholds ->> 'daysPending')::integer, 2))
      order by l.submitted_at
      limit 200
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule, 'daily_log', r.project_id, r.construction_site_id::text),
        'progress', 'dailylog_stale_' || r.id, 'warning', 'progress',
        '📝 Nhật ký chờ xác nhận > ' || coalesce((v_rule.thresholds ->> 'daysPending')::integer, 2) || ' ngày',
        'Nhật ký ' || r.date || ' tại ' || coalesce(r.site_name, 'N/A') || ' chưa được xác nhận',
        'warning', '📝', '/da', r.construction_site_id::text,
        jsonb_build_object('logId', r.id, 'date', r.date, 'projectId', r.project_id, 'constructionSiteId', r.construction_site_id));
    end loop;
    v_counts := v_counts || jsonb_build_object('stale_daily_log', v_n);
  end if;

  -- 7. Budget overrun (finance viewers of the project).
  select * into v_rule from public.notification_alert_rules where alert_key = 'budget_overrun';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_n := 0;
    for r in
      select x.*, site.name site_name, round(x.expense * 100 / x.contract_value)::int pct
      from (
        select f.id, coalesce(f.construction_site_id, f."constructionSiteId") site_id,
          coalesce(f.project_id, (select p.id from public.projects p
            where p.construction_site_id::text = coalesce(f.construction_site_id, f."constructionSiteId") limit 1)) project_id,
          f."contractValue" contract_value,
          coalesce(f."actualMaterials", 0) + coalesce(f."actualLabor", 0) + coalesce(f."actualSubcontract", 0)
            + coalesce(f."actualMachinery", 0) + coalesce(f."actualOverhead", 0) expense
        from public.project_finances f
        where coalesce(f."contractValue", 0) > 0
      ) x
      left join public.hrm_construction_sites site on site.id::text = x.site_id
      where round(x.expense * 100 / x.contract_value) >= coalesce((v_rule.thresholds ->> 'warningPercent')::numeric, 90)
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule, 'finance', r.project_id, r.site_id),
        'budget', 'budget_' || coalesce(r.site_id, r.id),
        case when r.pct >= coalesce((v_rule.thresholds ->> 'criticalPercent')::numeric, 100) then 'error' else 'warning' end,
        'budget',
        case when r.pct >= coalesce((v_rule.thresholds ->> 'criticalPercent')::numeric, 100) then '🚨 Vượt ngân sách!' else '⚠️ Sắp vượt ngân sách' end,
        coalesce(r.site_name, 'N/A') || ': Chi phí đạt ' || r.pct || '% giá trị HĐ',
        case when r.pct >= coalesce((v_rule.thresholds ->> 'criticalPercent')::numeric, 100) then 'critical' else 'warning' end,
        '💰', '/da', r.site_id,
        jsonb_build_object('projectId', r.project_id, 'constructionSiteId', r.site_id, 'percent', r.pct, 'expense', r.expense, 'contract', r.contract_value));
    end loop;
    v_counts := v_counts || jsonb_build_object('budget_overrun', v_n);
  end if;

  -- 8. Slow progress on active projects (Room gantt).
  select * into v_rule from public.notification_alert_rules where alert_key = 'slow_progress';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_n := 0;
    for r in
      select x.*, site.name site_name
      from (
        select f.id, f."progressPercent" progress, coalesce(f.construction_site_id, f."constructionSiteId") site_id,
          coalesce(f.project_id, (select p.id from public.projects p
            where p.construction_site_id::text = coalesce(f.construction_site_id, f."constructionSiteId") limit 1)) project_id
        from public.project_finances f
        where f.status = 'active'
          and coalesce(f."progressPercent", 0) < coalesce((v_rule.thresholds ->> 'minProgressPercent')::numeric, 30)
      ) x
      left join public.hrm_construction_sites site on site.id::text = x.site_id
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule, 'gantt', r.project_id, r.site_id),
        'progress', 'progress_' || coalesce(r.site_id, r.id), 'info', 'progress', '📐 Tiến độ chậm',
        coalesce(r.site_name, 'N/A') || ': mới đạt ' || coalesce(r.progress, 0) || '% (đang thi công)',
        'info', '📐', '/da', r.site_id,
        jsonb_build_object('projectId', r.project_id, 'constructionSiteId', r.site_id, 'progress', r.progress));
    end loop;
    v_counts := v_counts || jsonb_build_object('slow_progress', v_n);
  end if;

  -- 9. Material waste above the item's threshold (Room material_planning).
  select * into v_rule from public.notification_alert_rules where alert_key = 'material_waste';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_n := 0;
    for r in
      select b.id, b.item_name, b.construction_site_id site_id, site.name site_name,
        coalesce(b.waste_percent, 0) waste_percent, coalesce(b.waste_threshold, 5) waste_threshold,
        coalesce(b.project_id, (select p.id from public.projects p where p.construction_site_id::text = b.construction_site_id limit 1)) project_id
      from public.material_budget_items b
      left join public.hrm_construction_sites site on site.id::text = b.construction_site_id
      where coalesce(b.waste_percent, 0) > coalesce(b.waste_threshold, 5)
      limit 500
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule, 'material_planning', r.project_id, r.site_id),
        'material', 'waste_' || r.id, 'warning', 'material', '📦 Hao hụt vượt định mức',
        coalesce(r.item_name, 'Vật tư') || ' — ' || coalesce(r.site_name, 'N/A') || ': hao hụt '
          || to_char(r.waste_percent, 'FM999990.0') || '% (định mức ' || trim_scale(r.waste_threshold) || '%)',
        'warning', '📦', '/da', r.site_id,
        jsonb_build_object('itemId', r.id, 'wastePercent', r.waste_percent, 'threshold', r.waste_threshold,
          'projectId', r.project_id, 'constructionSiteId', r.site_id));
    end loop;
    v_counts := v_counts || jsonb_build_object('material_waste', v_n);
  end if;

  -- 10. Requests past their due date.
  select * into v_rule from public.notification_alert_rules where alert_key = 'overdue_request';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_n := 0;
    for r in
      select i.id, i.code, i.title, i.due_date,
        v_today - (i.due_date at time zone 'Asia/Ho_Chi_Minh')::date days_overdue
      from public.request_instances i
      where upper(i.status) in ('PENDING', 'IN_PROGRESS') and i.due_date is not null
        and (i.due_date at time zone 'Asia/Ho_Chi_Minh')::date < v_today
      limit 500
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule),
        'system', 'request_overdue_' || r.id,
        case when r.days_overdue > 7 then 'error' else 'warning' end, 'system', '⚠️ Yêu cầu quá hạn',
        coalesce(r.code, 'YC') || ' — ' || coalesce(r.title, 'Không tiêu đề') || ': quá hạn ' || r.days_overdue || ' ngày',
        case when r.days_overdue > 7 then 'critical' else 'warning' end, '⚠️', '/rq', null,
        jsonb_build_object('requestId', r.id, 'daysOverdue', r.days_overdue, 'dueDate', r.due_date));
    end loop;
    v_counts := v_counts || jsonb_build_object('overdue_request', v_n);
  end if;

  -- 11. Safety: open critical or overdue issues, and equipment whose
  -- inspection has expired (Room safety).
  select * into v_rule from public.notification_alert_rules where alert_key = 'safety_critical';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_n := 0;
    for r in
      select i.id, i.code, i.title, i.status, i.area, i.assigned_to_name, i.project_id,
        i.construction_site_id site_id, site.name site_name
      from public.safety_issues i
      left join public.hrm_construction_sites site on site.id::text = i.construction_site_id
      where i.status not in ('resolved', 'closed', 'rejected')
        and (i.severity = 'critical' or i.status = 'overdue')
      limit 500
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule, 'safety', r.project_id, r.site_id),
        'safety', 'safety_critical_issue_' || r.id, 'error', 'safety',
        case when r.status = 'overdue' then '🛡️ Sự cố an toàn quá hạn' else '🛡️ Sự cố an toàn nghiêm trọng' end,
        coalesce(r.code, 'ATLĐ') || ' — ' || coalesce(r.title, 'Sự cố') || ' tại ' || coalesce(r.area, r.site_name, 'công trường')
          || case when r.assigned_to_name is not null then ' (đang giao ' || r.assigned_to_name || ')' else ' (chưa giao người xử lý)' end,
        'critical', '🛡️', '/da', r.site_id,
        jsonb_build_object('projectId', r.project_id, 'constructionSiteId', r.site_id, 'safetyId', r.id, 'safetyView', 'issues'));
    end loop;
    for r in
      select e.id, e.name, e.inspection_expiry_date, e.project_id, e.construction_site_id site_id, site.name site_name
      from public.safety_equipment e
      left join public.hrm_construction_sites site on site.id::text = e.construction_site_id
      where e.status = 'expired' or e.inspection_expiry_date < v_today
      limit 500
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule, 'safety', r.project_id, r.site_id),
        'safety', 'safety_equipment_expired_' || r.id, 'error', 'safety', '🛡️ Thiết bị hết hạn kiểm định',
        coalesce(r.name, 'Thiết bị') || ' — ' || coalesce(r.site_name, 'N/A') || ': hết hạn kiểm định'
          || coalesce(' từ ' || to_char(r.inspection_expiry_date, 'DD/MM/YYYY'), ''),
        'critical', '🛡️', '/da', r.site_id,
        jsonb_build_object('projectId', r.project_id, 'constructionSiteId', r.site_id, 'safetyId', r.id, 'safetyView', 'equipment'));
    end loop;
    v_counts := v_counts || jsonb_build_object('safety_critical', v_n);
  end if;

  return v_counts;
end;
$function$;

update public.notification_alert_rules
set label = 'Nhắc chấm công vào / ra',
    description = 'Nhắc từng người trước giờ vào ca (nếu chưa chấm công vào) và trước giờ hết ca (nếu chưa chấm công ra), theo ca làm việc của người đó.',
    thresholds = coalesce(thresholds, '{}'::jsonb) || jsonb_build_object('minutesBefore', 10),
    updated_at = now()
where alert_key = 'attendance_reminder';

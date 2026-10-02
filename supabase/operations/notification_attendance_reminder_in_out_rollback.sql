-- Rollback of 20261008100000_notification_attendance_reminder_in_out.sql:
-- restore the single check-in reminder per office/site (definition as on Cloud before the change).
begin;
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

  -- 2. Attendance reminder, in the few minutes before each location's check-in time.
  select * into v_rule from public.notification_alert_rules where alert_key = 'attendance_reminder';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) then
    v_n := 0;
    for r in
      with locations as (
        select o.id::text id, o.name, coalesce(o."checkInTime", time '08:00') check_in, 'office' kind from public.hrm_offices o
        union all
        select s.id::text, s.name, coalesce(s."checkInTime", time '07:30'), 'site' from public.hrm_construction_sites s
      )
      select e.id employee_id, e.user_id, l.name location_name, l.check_in
      from locations l
      join public.employees e on e.status = 'Đang làm việc' and e.user_id is not null
        and ((l.kind = 'office' and e.office_id::text = l.id) or (l.kind = 'site' and e.construction_site_id::text = l.id))
      where v_now::time between l.check_in - make_interval(mins => coalesce((v_rule.thresholds ->> 'minutesBefore')::integer, 5)) and l.check_in
        and not exists (select 1 from public.hrm_attendance a where a."employeeId" = e.id and a.date = v_today::text)
        and not exists (select 1 from public.hrm_leave_requests lr where lr."employeeId" = e.id and lr.status = 'approved'
                        and lr."startDate" <= v_today::text and lr."endDate" >= v_today::text)
    loop
      v_n := v_n + app_private.alert_emit(v_rule,
        app_private.alert_resolve_recipients(v_rule, null, null, null, r.user_id),
        'attendance', 'attendance_' || r.employee_id || '_' || v_today, 'warning', 'attendance', '⏰ Nhắc nhở chấm công',
        'Còn ' || greatest(ceil(extract(epoch from (r.check_in - v_now::time)) / 60), 0)::int || ' phút nữa là đến giờ chấm công ('
          || to_char(r.check_in, 'HH24:MI') || ') tại ' || r.location_name || '. Hãy chấm công đúng giờ nhé!',
        'warning', '⏰', '/hrm/checkin', null,
        jsonb_build_object('employeeId', r.employee_id, 'location', r.location_name, 'checkInTime', to_char(r.check_in, 'HH24:MI')));
    end loop;
    v_counts := v_counts || jsonb_build_object('attendance_reminder', v_n);
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

drop function if exists app_private.alert_attendance_reminders(public.notification_alert_rules, timestamp);
drop function if exists app_private.attendance_shift_of_day(uuid, date);

update public.notification_alert_rules
set label = 'Nhắc chấm công',
    description = 'Nhắc cá nhân chưa chấm công trước giờ vào làm.',
    thresholds = coalesce(thresholds, '{}'::jsonb) || jsonb_build_object('minutesBefore', 5),
    updated_at = now()
where alert_key = 'attendance_reminder';
commit;

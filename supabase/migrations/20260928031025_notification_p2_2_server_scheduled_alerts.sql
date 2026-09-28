-- P2.2 (group 1): scheduled alerts run on the server every 5 minutes instead
-- of in an Admin's open browser. Covers the six alerts the owner prioritised:
-- missing_payroll, employee_birthday, stale_daily_log, attendance_reminder,
-- overdue_payment, contract_expiry. Rules, thresholds, cooldowns and channels
-- still come from notification_alert_rules (Settings → Alerts).
-- Recipients are resolved on the server:
--   module_admins      → holders of a manage capability of those modules
--   project_permission → Room members of the alert's Room holding the rule's
--                        actions (payment: confirm/approve, daily log: verify);
--                        the old short codes never matched a grant, so these
--                        alerts silently fell back to Admins only
--   employee_owner     → the employee's own account
-- plus Admins when includeAdmins, and Admins as fallback when nobody matched.
-- Times are Vietnam local time.

create or replace function app_private.alert_admin_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(u.id), '{}'::uuid[])
  from public.users u
  where u.role = 'ADMIN' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null;
$$;

create or replace function app_private.alert_module_manager_ids(p_module_keys text[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct user_row.id), '{}'::uuid[])
  from public.users user_row
  cross join lateral app_private.resolve_effective_permission_sources(user_row.id, null, null, null, now()) source_row
  join public.permission_actions action_row
    on action_row.permission_code = source_row.permission_code and action_row.is_active and action_row.action = 'manage'
  join public.permission_modules module_row on module_row.code = action_row.module_code and module_row.is_active
  where user_row.is_active and user_row.account_status = 'ACTIVE' and user_row.auth_id is not null
    and source_row.source_type in ('DIRECT', 'ROLE')
    and coalesce(action_row.legacy_module_key, module_row.legacy_module_key) = any(coalesce(p_module_keys, '{}'::text[]));
$$;

create or replace function app_private.alert_room_recipient_ids(
  p_project_id text, p_construction_site_id text, p_room_code text, p_action_codes text[]
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct user_row.id), '{}'::uuid[])
  from public.project_permission_room_members member
  join public.project_permission_room_member_actions action
    on action.room_member_id = member.id and action.is_active and action.action_code = any(p_action_codes)
  join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
  join public.users user_row on user_row.id::text = staff.user_id
  where member.is_active and member.room_code = p_room_code
    and member.project_id = p_project_id
    and (member.construction_site_id is null or p_construction_site_id is null
         or member.construction_site_id::text = p_construction_site_id)
    and user_row.is_active and user_row.account_status = 'ACTIVE';
$$;

-- Resolve recipients for one alert occurrence from the rule's recipient_config.
create or replace function app_private.alert_resolve_recipients(
  p_rule public.notification_alert_rules,
  p_room_code text default null,
  p_project_id text default null,
  p_construction_site_id text default null,
  p_employee_user_id uuid default null
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config jsonb := coalesce(p_rule.recipient_config, '{"mode":"admin","fallbackToAdmin":true}'::jsonb);
  v_mode text := coalesce(v_config ->> 'mode', 'admin');
  v_ids uuid[] := '{}';
begin
  if v_mode = 'admin' then
    v_ids := app_private.alert_admin_ids();
  elsif v_mode = 'module_admins' then
    v_ids := app_private.alert_module_manager_ids(array(select jsonb_array_elements_text(coalesce(v_config -> 'moduleKeys', '[]'::jsonb))));
  elsif v_mode = 'employee_owner' then
    v_ids := case when p_employee_user_id is null then '{}'::uuid[] else array[p_employee_user_id] end;
  elsif v_mode = 'project_permission' and p_room_code is not null and p_project_id is not null then
    v_ids := app_private.alert_room_recipient_ids(
      p_project_id, p_construction_site_id, p_room_code,
      array(select jsonb_array_elements_text(coalesce(v_config -> 'projectPermissionCodes', '[]'::jsonb))));
  elsif v_mode = 'users' then
    v_ids := array(select (jsonb_array_elements_text(coalesce(v_config -> 'userIds', '[]'::jsonb)))::uuid);
  end if;

  if coalesce((v_config ->> 'includeAdmins')::boolean, false) and v_mode not in ('admin') then
    v_ids := v_ids || app_private.alert_admin_ids();
  end if;
  v_ids := array(select distinct unnest(v_ids));
  if cardinality(v_ids) = 0 and coalesce((v_config ->> 'fallbackToAdmin')::boolean, true) then
    v_ids := app_private.alert_admin_ids();
  end if;
  return v_ids;
end;
$$;

-- Emit one alert occurrence unless the same source was alerted within the
-- rule's cooldown. Returns the number of notifications created.
create or replace function app_private.alert_emit(
  p_rule public.notification_alert_rules,
  p_recipients uuid[],
  p_source_type text,
  p_source_id text,
  p_type text,
  p_category text,
  p_title text,
  p_message text,
  p_severity text,
  p_icon text,
  p_link text,
  p_construction_site_id text,
  p_metadata jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cooldown integer := greatest(coalesce(p_rule.cooldown_minutes, 0), 0);
  v_count integer;
begin
  if cardinality(coalesce(p_recipients, '{}')) = 0 then return 0; end if;
  if v_cooldown > 0 and exists (
    select 1 from public.notifications n
    where n.source_type = p_source_type and n.source_id = p_source_id
      and n.created_at >= now() - make_interval(mins => v_cooldown)
  ) then
    return 0;
  end if;

  insert into public.notifications (
    user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
    construction_site_id, priority, push_enabled, metadata
  )
  select recipient::text, p_type, coalesce(p_category, p_rule.category), p_title, p_message, p_message,
    p_severity, p_icon, p_link, p_source_type, p_source_id, p_construction_site_id,
    case when p_severity = 'critical' then 'high' else 'normal' end,
    coalesce((p_rule.channels ->> 'webPush')::boolean, true),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'alertKey', p_rule.alert_key, 'deliveredBy', 'server_scheduled_alerts', 'resolvedAt', now())
  from unnest(p_recipients) recipient;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function app_private.run_scheduled_alerts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  return v_counts;
end;
$$;

revoke all on function app_private.alert_admin_ids() from public, anon, authenticated;
revoke all on function app_private.alert_module_manager_ids(text[]) from public, anon, authenticated;
revoke all on function app_private.alert_room_recipient_ids(text, text, text, text[]) from public, anon, authenticated;
revoke all on function app_private.alert_resolve_recipients(public.notification_alert_rules, text, text, text, uuid) from public, anon, authenticated;
revoke all on function app_private.alert_emit(public.notification_alert_rules, uuid[], text, text, text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function app_private.run_scheduled_alerts() from public, anon, authenticated;

-- "Chạy thử" in Settings → Alerts: Admins run the same server scan now.
create or replace function public.run_scheduled_alerts_now()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'SCHEDULED_ALERTS_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  return app_private.run_scheduled_alerts();
end;
$$;
revoke all on function public.run_scheduled_alerts_now() from public, anon;
grant execute on function public.run_scheduled_alerts_now() to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'server-scheduled-alerts';
select cron.schedule('server-scheduled-alerts', '*/5 * * * *', $$select app_private.run_scheduled_alerts();$$);

-- Owner decision 28/09/2026: attendance reminders stay off until staff are
-- told (on the server they would reach every employee not yet checked in,
-- each morning). Re-enable in Settings → Alerts.
update public.notification_alert_rules set is_enabled = false, updated_at = now()
where alert_key = 'attendance_reminder';

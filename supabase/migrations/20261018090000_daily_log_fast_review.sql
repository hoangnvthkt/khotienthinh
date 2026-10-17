-- Nhật ký · PR-1 "Duyệt nhanh + nhắc" (chủ SP 17/10/2026 duyệt phương án, câu 7–9 theo đề xuất).
--
-- Số liệu 17/10: SMB 4 nhật ký 05–08/10 chờ anh Sơn 6–7 ngày, DA29 13–16/10 chờ anh Năm; cảnh báo cũ "Nhật ký chờ xác nhận > 2 ngày"
-- gửi MỖI PHIẾU một tin, MỖI NGÀY lại gửi, cho MỌI người có quyền xác nhận (cả người viết) với link chung → anh Sơn 35 tin / 14 ngày,
-- 118/125 thông báo chưa đọc. Thay bằng:
--  1. Hàng chờ duyệt của tôi (get_daily_log_review_queue_v1): phiếu đang giao cho tôi + phiếu treo quá N ngày tôi được duyệt thay.
--  2. Duyệt thay (take_over_daily_log_review_v1): người duyệt dự phòng (câu 7: Admin Hoàng) nhận phân công khi phiếu treo quá
--     "Duyệt thay sau" ngày, có lý do, báo người được giao cũ; rồi duyệt bằng nút sẵn có (đúng quyền Room Nhật ký).
--  3. Luật "Nhật ký chờ xác nhận quá lâu" giữ ở Cài đặt → Cảnh báo nhưng gửi GỘP: mỗi sáng (sau 07:00) 1 tin cho người được giao duyệt,
--     1 tin tổng hợp các dự án cho người duyệt dự phòng (treo quá hạn + ngày thiếu nhật ký). Danh sách dự phòng = "Người nhận cụ thể".
--  4. Luật mới "Nhắc ghi nhật ký cuối ngày": dự án đã dùng Nhật ký chính thức (rollout enforced) tới giờ nhắc (17:00) chưa có nhật ký
--     hôm nay → 1 tin cho người ghi nhật ký 14 ngày gần nhất.

-- Người duyệt dự phòng: "Người nhận cụ thể" của luật stale_daily_log (Cài đặt → Cảnh báo), còn hoạt động.
create or replace function app_private.daily_log_review_backup_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct u.id), '{}'::uuid[])
  from public.notification_alert_rules r
  cross join lateral jsonb_array_elements_text(
    case when r.recipient_config ->> 'mode' = 'users' and jsonb_typeof(r.recipient_config -> 'userIds') = 'array'
      then r.recipient_config -> 'userIds' else '[]'::jsonb end) x(uid)
  join public.users u on u.id::text = x.uid and coalesce(u.is_active, true)
  where r.alert_key = 'stale_daily_log';
$$;
revoke all on function app_private.daily_log_review_backup_ids() from public, anon, authenticated;

create or replace function app_private.daily_log_takeover_days()
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(coalesce((select (r.thresholds ->> 'takeoverDays')::integer from public.notification_alert_rules r
    where r.alert_key = 'stale_daily_log'), 2), 1);
$$;
revoke all on function app_private.daily_log_takeover_days() from public, anon, authenticated;

-- "05–08/10", "13/10", "28/09–03/10" cho tin gộp.
create or replace function app_private.daily_log_date_span_v1(p_from text, p_to text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_from is null then ''
    when p_to is null or p_to = p_from then to_char(p_from::date, 'DD/MM')
    when to_char(p_from::date, 'MM') = to_char(p_to::date, 'MM') then to_char(p_from::date, 'DD') || '–' || to_char(p_to::date, 'DD/MM')
    else to_char(p_from::date, 'DD/MM') || '–' || to_char(p_to::date, 'DD/MM') end;
$$;

-- Danh sách ngày gọn cho tin gộp: "01, 05–08/10"; khác tháng ghi đủ "28/09, 01–03/10"; quá 6 đoạn thì "01–15/10 (9 ngày)".
create or replace function app_private.daily_log_date_list_v1(p_dates text[])
returns text language sql immutable set search_path = '' as $$
  with d as (select distinct x::date dd from unnest(coalesce(p_dates, '{}'::text[])) x where x ~ '^\d{4}-\d{2}-\d{2}$'),
  g as (select dd, dd - (row_number() over (order by dd))::integer grp from d),
  runs as (select min(dd) a, max(dd) b from g group by grp),
  one_month as (select count(distinct to_char(dd, 'YYYY-MM')) = 1 v from d)
  select case
    when (select count(*) from d) = 0 then ''
    when (select count(*) from runs) > 6 then app_private.daily_log_date_span_v1((select min(dd)::text from d), (select max(dd)::text from d))
      || ' (' || (select count(*) from d) || ' ngày)'
    when (select v from one_month) then (select string_agg(case when a = b then to_char(a, 'DD') else to_char(a, 'DD') || '–' || to_char(b, 'DD') end,
      ', ' order by a) from runs) || '/' || (select to_char(min(dd), 'MM') from d)
    else (select string_agg(case when a = b then to_char(a, 'DD/MM') when to_char(a, 'MM') = to_char(b, 'MM') then to_char(a, 'DD') || '–' || to_char(b, 'DD/MM')
      else to_char(a, 'DD/MM') || '–' || to_char(b, 'DD/MM') end,
      ', ' order by a) from runs) end;
$$;

-- Người dự phòng được duyệt thay khi có quyền thực tế (Admin được qua Room như mọi thao tác duyệt);
-- bản tổng hợp cần thêm "Công bố tiến độ" như publish_daily_log_summary.
create or replace function app_private.daily_log_can_take_over(p_log public.daily_logs, p_permission_code text, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and case
    when p_permission_code = 'project.daily_log.approve' then
      app_private.project_actor_has_effective_room_action(p_user, p_log.project_id::text, nullif(p_log.construction_site_id::text, ''), 'daily_log', 'approve')
      and (p_log.summary_source_type is distinct from 'member_contributions'
        or app_private.project_actor_has_effective_room_action(p_user, p_log.project_id::text, nullif(p_log.construction_site_id::text, ''), 'daily_log', 'publish_progress'))
    else app_private.project_actor_has_effective_room_action(p_user, p_log.project_id::text, nullif(p_log.construction_site_id::text, ''), 'daily_log', 'verify')
  end;
$$;
revoke all on function app_private.daily_log_can_take_over(public.daily_logs, text, uuid) from public, anon, authenticated;

create or replace function app_private.daily_log_review_item_v1(p_log public.daily_logs, p_assignment public.app_assignments)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_log.id, 'projectId', p_log.project_id, 'constructionSiteId', p_log.construction_site_id,
    'projectCode', coalesce(nullif(p.code, ''), p.name), 'projectName', p.name, 'siteName', s.name,
    'date', p_log.date, 'submittedAt', p_log.submitted_at,
    'waitingHours', floor(extract(epoch from now() - coalesce(p_log.submitted_at, p_log.created_at)) / 3600)::integer,
    'senderName', coalesce(sender.name, p_log.submitted_by, p_log.created_by),
    'assigneeId', p_assignment.principal_id, 'assigneeName', assignee.name,
    'permission', case when p_assignment.permission_code = 'project.daily_log.approve' then 'approve' else 'verify' end,
    'summary', p_log.summary_source_type = 'member_contributions')
  from (select 1) one
  left join public.projects p on p.id = p_log.project_id
  left join public.hrm_construction_sites s on s.id::text = p_log.construction_site_id
  left join public.users sender on sender.id::text = coalesce(p_log.submitted_by_id, p_log.created_by_id)
  left join public.users assignee on assignee.id = p_assignment.principal_id;
$$;
revoke all on function app_private.daily_log_review_item_v1(public.daily_logs, public.app_assignments) from public, anon, authenticated;

-- 1. Hàng chờ duyệt của người đang đăng nhập.
create or replace function public.get_daily_log_review_queue_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.current_app_user_id();
  v_backup boolean;
  v_days integer := app_private.daily_log_takeover_days();
  v_mine jsonb;
  v_takeover jsonb := '[]'::jsonb;
begin
  if v_me is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  v_backup := v_me = any(app_private.daily_log_review_backup_ids());
  select coalesce(jsonb_agg(app_private.daily_log_review_item_v1(l, a) order by l.submitted_at, l.date), '[]'::jsonb) into v_mine
  from public.app_assignments a
  join public.daily_logs l on l.id = a.subject_id and l.status = 'submitted'
  where a.subject_type = 'daily_log' and a.principal_type = 'user' and a.principal_id = v_me and a.status = 'active'
    and a.responsibility in ('current_approver', 'current_verifier');
  if v_backup then
    select coalesce(jsonb_agg(app_private.daily_log_review_item_v1(l, a) order by l.submitted_at, l.date), '[]'::jsonb) into v_takeover
    from public.app_assignments a
    join public.daily_logs l on l.id = a.subject_id and l.status = 'submitted'
    where a.subject_type = 'daily_log' and a.principal_type = 'user' and a.principal_id <> v_me and a.status = 'active'
      and a.responsibility in ('current_approver', 'current_verifier')
      and coalesce(l.submitted_at, l.created_at) < now() - make_interval(days => v_days)
      and app_private.daily_log_can_take_over(l, a.permission_code, v_me);
  end if;
  return jsonb_build_object('mine', v_mine, 'takeover', v_takeover, 'isBackup', v_backup, 'takeoverDays', v_days);
end;
$$;
revoke all on function public.get_daily_log_review_queue_v1() from public, anon;
grant execute on function public.get_daily_log_review_queue_v1() to authenticated;

-- 2. Duyệt thay: chuyển phân công sang người dự phòng (có lý do), rồi họ duyệt bằng nút sẵn có.
create or replace function public.take_over_daily_log_review_v1(p_daily_log_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_app_user_id();
  v_me_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_log public.daily_logs%rowtype;
  v_assignment public.app_assignments%rowtype;
  v_new_id uuid;
  v_guard text := current_setting('app.daily_log_transition_context', true);
begin
  if v_me is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception using errcode = '22023', message = 'DAILY_LOG_TAKEOVER_REASON_REQUIRED'; end if;
  if not (v_me = any(app_private.daily_log_review_backup_ids())) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_TAKEOVER_NOT_BACKUP'; end if;
  select * into v_log from public.daily_logs where id = p_daily_log_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;
  if v_log.status is distinct from 'submitted' then
    raise exception using errcode = 'PT409', message = 'DAILY_LOG_NOT_WAITING'; end if;
  select * into v_assignment from public.app_assignments
  where subject_type = 'daily_log' and subject_id = p_daily_log_id and principal_type = 'user' and status = 'active'
    and responsibility in ('current_approver', 'current_verifier')
  order by created_at desc limit 1;
  if not found then raise exception using errcode = '42501', message = 'DAILY_LOG_TAKEOVER_NO_ASSIGNEE'; end if;
  if v_assignment.principal_id = v_me then
    return jsonb_build_object('dailyLogId', v_log.id, 'assigneeUserId', v_me, 'updatedAt', v_log.last_action_at, 'alreadyMine', true);
  end if;
  if coalesce(v_log.submitted_at, v_log.created_at) > now() - make_interval(days => app_private.daily_log_takeover_days()) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_TAKEOVER_TOO_EARLY'; end if;
  if not app_private.daily_log_can_take_over(v_log, v_assignment.permission_code, v_me) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVER_REQUIRED'; end if;

  select coalesce(name, username, email, id::text) into v_me_name from public.users where id = v_me;
  perform set_config('app.daily_log_transition_context', 'on', true);
  update public.daily_logs
  set submitted_to_user_id = v_me::text, submitted_to_name = v_me_name,
      requested_verifier_id = v_me::text, requested_verifier_name = v_me_name
  where id = p_daily_log_id;
  -- Như create_daily_log_assignment (hủy phân công cũ + sự kiện) nhưng giữ đúng trách nhiệm / quyền / phạm vi của phân công cũ.
  with cancelled as (
    update public.app_assignments
    set status = 'cancelled', closed_at = now(), closed_by = v_me, close_reason = 'taken_over', updated_at = now()
    where subject_type = 'daily_log' and subject_id = p_daily_log_id and status = 'active'
      and responsibility in ('current_approver', 'current_verifier')
    returning id)
  insert into public.app_assignment_events (assignment_id, event_type, actor_user_id, metadata)
  select id, 'cancelled', v_me, jsonb_build_object('reason', 'taken_over') from cancelled;
  insert into public.app_assignments (subject_type, subject_id, workflow_step_id, principal_type, principal_id,
    responsibility, permission_code, scope_type, scope_id, status, assigned_by, assigned_reason, metadata)
  values ('daily_log', p_daily_log_id, v_assignment.responsibility, 'user', v_me,
    v_assignment.responsibility, v_assignment.permission_code, v_assignment.scope_type, v_assignment.scope_id, 'active',
    v_me, 'taken_over_after_delay', jsonb_build_object('source', 'daily_log_takeover', 'takenOverFrom', v_assignment.principal_id,
      'reason', v_reason, 'waitingHours', floor(extract(epoch from now() - coalesce(v_log.submitted_at, v_log.created_at)) / 3600)::integer))
  returning id into v_new_id;
  insert into public.app_assignment_events (assignment_id, event_type, actor_user_id, metadata)
  values (v_new_id, 'assigned', v_me, jsonb_build_object('reason', 'taken_over', 'from', v_assignment.principal_id));
  perform set_config('app.daily_log_transition_context', coalesce(v_guard, ''), true);

  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, source_type, source_id,
    construction_site_id, priority, push_enabled, metadata)
  values (v_assignment.principal_id::text, 'info', 'progress', '↪ Nhật ký đã có người duyệt thay',
    v_me_name || ' duyệt thay nhật ký ngày ' || to_char(v_log.date::date, 'DD/MM') || '. Lý do: ' || v_reason,
    v_me_name || ' duyệt thay nhật ký ngày ' || to_char(v_log.date::date, 'DD/MM') || '. Lý do: ' || v_reason,
    'info', '↪', 'dailylog_takeover', 'dailylog_takeover_' || v_new_id, v_log.construction_site_id, 'normal', true,
    jsonb_build_object('dailyLogId', v_log.id, 'projectId', v_log.project_id, 'constructionSiteId', v_log.construction_site_id,
      'takenOverBy', v_me));

  return jsonb_build_object('dailyLogId', v_log.id, 'assigneeUserId', v_me,
    'updatedAt', (select last_action_at from public.daily_logs where id = p_daily_log_id), 'alreadyMine', false);
exception when others then
  perform set_config('app.daily_log_transition_context', coalesce(v_guard, ''), true);
  raise;
end;
$$;
revoke all on function public.take_over_daily_log_review_v1(text, text) from public, anon;
grant execute on function public.take_over_daily_log_review_v1(text, text) to authenticated;

-- 3 + 4. Tin gộp nhật ký (chạy trong run_scheduled_alerts mỗi 5 phút; mã nguồn theo ngày nên mỗi ngày 1 tin).
create or replace function app_private.alert_daily_log_digest_v1()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamp := now() at time zone 'Asia/Ho_Chi_Minh';
  v_today date := v_now::date;
  v_rule public.notification_alert_rules;
  v_days integer;
  v_takeover integer := app_private.daily_log_takeover_days();
  v_backups uuid[] := app_private.daily_log_review_backup_ids();
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_lines text;
  v_total integer;
  v_gaps text;
  r record;
  v_recipients uuid[];
begin
  select * into v_rule from public.notification_alert_rules where alert_key = 'stale_daily_log';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true) and extract(hour from v_now) >= 7 then
    v_days := greatest(coalesce((v_rule.thresholds ->> 'daysPending')::integer, 1), 0);
    v_n := 0;
    -- a) Người được giao duyệt: 1 tin mỗi sáng, mở thẳng phiếu cũ nhất.
    for r in
      with q as (
        select a.principal_id uid, l.id, l.date, l.project_id, l.construction_site_id,
          coalesce(l.submitted_at, l.created_at) sent_at, coalesce(nullif(p.code, ''), p.name, 'Dự án') pcode
        from public.app_assignments a
        join public.daily_logs l on l.id = a.subject_id and l.status = 'submitted'
        join public.users u on u.id = a.principal_id and coalesce(u.is_active, true)
        left join public.projects p on p.id = l.project_id
        where a.subject_type = 'daily_log' and a.principal_type = 'user' and a.status = 'active'
          and a.responsibility in ('current_approver', 'current_verifier')
          and coalesce(l.submitted_at, l.created_at) < now() - make_interval(days => v_days)
      ), per_project as (
        select uid, pcode, array_agg(date) dates from q group by uid, pcode
      )
      select q.uid, count(*) total,
        floor(extract(epoch from now() - min(q.sent_at)) / 86400)::integer oldest_days,
        (array_agg(q.id order by q.sent_at, q.date))[1] first_id,
        (array_agg(q.project_id order by q.sent_at, q.date))[1] first_project,
        (array_agg(q.construction_site_id order by q.sent_at, q.date))[1] first_site,
        (select string_agg(pp.pcode || ': ' || app_private.daily_log_date_list_v1(pp.dates), ' · ' order by pp.pcode)
          from per_project pp where pp.uid = q.uid) summary
      from q group by q.uid
    loop
      v_n := v_n + app_private.alert_emit(v_rule, array[r.uid], 'dailylog_review', 'dailylog_review_' || r.uid || '_' || v_today,
        'warning', 'progress', '📝 ' || r.total || ' nhật ký chờ bạn duyệt',
        r.summary || ' · lâu nhất ' || greatest(r.oldest_days, 1) || ' ngày. Mở để duyệt lần lượt.',
        'warning', '📝', null, r.first_site,
        jsonb_build_object('dailyLogId', r.first_id, 'projectId', r.first_project, 'constructionSiteId', r.first_site,
          'count', r.total, 'reviewQueue', true));
    end loop;
    v_counts := v_counts || jsonb_build_object('stale_daily_log', v_n);

    -- b) Người duyệt dự phòng (BLĐ): 1 tin tổng hợp các dự án — treo quá hạn duyệt thay + ngày thiếu nhật ký.
    if cardinality(v_backups) > 0 then
      select string_agg(line, ' · ' order by pcode), sum(stuck)::integer into v_lines, v_total
      from (
        select coalesce(nullif(p.code, ''), p.name, 'Dự án') pcode, count(*) stuck,
          coalesce(nullif(p.code, ''), p.name, 'Dự án') || ': ' || count(*) || ' chờ ' || string_agg(distinct u.name, ', ')
            || ' (lâu nhất ' || floor(extract(epoch from now() - min(coalesce(l.submitted_at, l.created_at))) / 86400)::integer || ' ngày)' line
        from public.app_assignments a
        join public.daily_logs l on l.id = a.subject_id and l.status = 'submitted'
        join public.users u on u.id = a.principal_id
        left join public.projects p on p.id = l.project_id
        where a.subject_type = 'daily_log' and a.principal_type = 'user' and a.status = 'active'
          and a.responsibility in ('current_approver', 'current_verifier')
          and a.principal_id <> all(v_backups)
          and coalesce(l.submitted_at, l.created_at) < now() - make_interval(days => v_takeover)
        group by 1
      ) stuck;
      select string_agg(gap, ' · ' order by pcode) into v_gaps
      from (
        select coalesce(nullif(p.code, ''), p.name, 'Dự án') pcode,
          coalesce(nullif(p.code, ''), p.name, 'Dự án') || ' thiếu nhật ký từ ' || to_char(m.missing_from, 'DD/MM') gap
        from (
          select s.project_id, greatest(s.cutover_date, coalesce((
            select max(l.date)::date + 1 from public.daily_logs l
            where l.project_id = s.project_id
              and (s.construction_site_id is null or l.construction_site_id = s.construction_site_id)), s.cutover_date)) missing_from
          from app_private.daily_log_wbs_rollout_scopes s
          where s.mode = 'enforced' and s.project_id is not null
        ) m
        left join public.projects p on p.id = m.project_id
        where m.missing_from < v_today
      ) gaps;
      if coalesce(v_total, 0) > 0 or v_gaps is not null then
        select l.id, l.project_id, l.construction_site_id into r
        from public.app_assignments a
        join public.daily_logs l on l.id = a.subject_id and l.status = 'submitted'
        where a.subject_type = 'daily_log' and a.principal_type = 'user' and a.status = 'active'
          and a.responsibility in ('current_approver', 'current_verifier') and a.principal_id <> all(v_backups)
          and coalesce(l.submitted_at, l.created_at) < now() - make_interval(days => v_takeover)
        order by coalesce(l.submitted_at, l.created_at) limit 1;
        v_n := app_private.alert_emit(v_rule, v_backups, 'dailylog_backup_digest', 'dailylog_backup_digest_' || v_today,
          'warning', 'progress',
          '📋 Nhật ký các dự án' || case when coalesce(v_total, 0) > 0 then ': ' || v_total || ' treo quá ' || v_takeover || ' ngày' else '' end,
          concat_ws(' · ', v_lines, v_gaps)
            || case when coalesce(v_total, 0) > 0 then '. Bạn có thể duyệt thay.' else '.' end,
          'warning', '📋', null, r.construction_site_id,
          case when r.id is not null then jsonb_build_object('dailyLogId', r.id, 'projectId', r.project_id,
            'constructionSiteId', r.construction_site_id, 'reviewQueue', true) else '{}'::jsonb end);
        v_counts := v_counts || jsonb_build_object('stale_daily_log_backup', v_n);
      end if;
    end if;
  end if;

  -- c) Nhắc ghi nhật ký cuối ngày ở dự án dùng Nhật ký chính thức.
  select * into v_rule from public.notification_alert_rules where alert_key = 'daily_log_missing_today';
  if found and v_rule.is_enabled and coalesce((v_rule.channels ->> 'inApp')::boolean, true)
    and extract(hour from v_now) >= least(greatest(coalesce((v_rule.thresholds ->> 'hour')::integer, 17), 0), 23) then
    v_n := 0;
    for r in
      select s.project_id, s.construction_site_id, s.cutover_date, coalesce(nullif(p.code, ''), p.name, 'Dự án') pcode,
        (select max(l.date) from public.daily_logs l where l.project_id = s.project_id
          and (s.construction_site_id is null or l.construction_site_id = s.construction_site_id)) last_date
      from app_private.daily_log_wbs_rollout_scopes s
      left join public.projects p on p.id = s.project_id
      where s.mode = 'enforced' and s.project_id is not null and s.cutover_date <= v_today
    loop
      continue when coalesce(r.last_date, '') >= v_today::text;
      continue when exists (select 1 from public.daily_log_contributions c where c.project_id = r.project_id
        and (r.construction_site_id is null or c.construction_site_id = r.construction_site_id) and c.date = v_today);
      v_recipients := array(
        select distinct u.id from (
          select l.created_by_id uid from public.daily_logs l
          where l.project_id = r.project_id and (r.construction_site_id is null or l.construction_site_id = r.construction_site_id)
            and l.created_at > now() - interval '14 days'
          union
          select c.author_user_id from public.daily_log_contributions c
          where c.project_id = r.project_id and (r.construction_site_id is null or c.construction_site_id = r.construction_site_id)
            and c.created_at > now() - interval '14 days'
        ) x
        join public.users u on u.id::text = x.uid and coalesce(u.is_active, true) and u.auth_id is not null
        where u.id <> all(v_backups));
      v_n := v_n + app_private.alert_emit(v_rule, v_recipients, 'dailylog_missing_today',
        'dailylog_missing_' || r.project_id || '_' || coalesce(r.construction_site_id, '') || '_' || v_today,
        'info', 'progress', '📝 Chưa có nhật ký hôm nay · ' || r.pcode,
        'Hôm nay ' || to_char(v_today, 'DD/MM') || ' chưa có nhật ký.'
          || case when greatest(r.cutover_date, coalesce(r.last_date::date + 1, r.cutover_date)) < v_today
            then ' Còn thiếu từ ' || to_char(greatest(r.cutover_date, coalesce(r.last_date::date + 1, r.cutover_date)), 'DD/MM')
              || ' (' || (v_today - greatest(r.cutover_date, coalesce(r.last_date::date + 1, r.cutover_date)) + 1) || ' ngày).'
            else '' end,
        'info', '📝', null, r.construction_site_id,
        jsonb_build_object('projectId', r.project_id, 'constructionSiteId', r.construction_site_id, 'date', v_today));
    end loop;
    v_counts := v_counts || jsonb_build_object('daily_log_missing_today', v_n);
  end if;
  return v_counts;
end;
$$;
revoke all on function app_private.alert_daily_log_digest_v1() from public, anon, authenticated;

-- Luật cảnh báo: giữ "Nhật ký chờ xác nhận quá lâu" (gửi gộp), thêm "Nhắc ghi nhật ký cuối ngày".
update public.notification_alert_rules
set description = 'Mỗi sáng gộp 1 tin cho người được giao duyệt. Treo quá "Duyệt thay sau" thì báo người duyệt dự phòng (Người nhận cụ thể) — họ được nhận duyệt thay.',
    thresholds = jsonb_build_object('daysPending', 1, 'takeoverDays', 2),
    recipient_config = jsonb_build_object('mode', 'users', 'includeAdmins', false, 'fallbackToAdmin', false,
      'userIds', coalesce((select jsonb_agg(u.id::text) from public.users u where u.name = 'Admin Hoàng' and coalesce(u.is_active, true)), '[]'::jsonb)),
    updated_at = now()
where alert_key = 'stale_daily_log';

insert into public.notification_alert_rules (alert_key, label, description, category, is_enabled, thresholds, cooldown_minutes, recipient_config, channels)
values ('daily_log_missing_today', 'Nhắc ghi nhật ký cuối ngày',
  'Dự án dùng Nhật ký chính thức mà tới giờ nhắc chưa có nhật ký hôm nay: nhắc người ghi nhật ký 14 ngày gần nhất, 1 tin mỗi ngày.',
  'progress', true, '{"hour": 17}'::jsonb, 1440, '{"mode": "users", "userIds": [], "fallbackToAdmin": false}'::jsonb,
  '{"inApp": true, "webPush": true}'::jsonb)
on conflict (alert_key) do nothing;

-- run_scheduled_alerts: bản đang chạy trên Cloud (17/10/2026), chỉ thay mục 6 bằng tin gộp.
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

  -- 6. Nhật ký: gộp 1 tin mỗi sáng cho người được giao duyệt + tổng hợp cho người duyệt dự phòng + nhắc ghi cuối ngày
  --    (20261018090000_daily_log_fast_review). Trước đây mỗi phiếu một tin, mỗi ngày, cho mọi người có quyền xác nhận.
  v_counts := v_counts || app_private.alert_daily_log_digest_v1();

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

-- Vioo Work · Việc của tôi theo mockup v1 (chủ SP 20/10/2026): một lệnh đọc cho màn nhân viên.
--   work_my_board_v1(p_week_start): việc đang giao cho chính người hỏi (+ việc đã xong 5 tuần gần đây cho Lịch), nguồn việc (chỉ đạo / giao miệng / trưởng
--   đơn vị giao / tự tạo), checklist, lần cập nhật gần nhất, nút bấm được (nhận / bắt đầu / vướng / gỡ vướng / nộp), số đúng hạn 4 tuần
--   (cùng định nghĩa work_team_board_v1: việc giao miệng chưa xác nhận không tính), duyệt lần đầu 28 ngày, tải việc.
--   Chỉ việc của chính mình nên không cần kiểm quyền xem từng việc; vẫn đòi quyền vào Vioo Work.

create function public.work_my_board_v1(p_week_start date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_ws date; v_done_from timestamptz;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
  v_tasks jsonb; v_weeks jsonb; v_first jsonb; v_load integer;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  v_ws := coalesce(p_week_start, (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh'))::date);
  -- Lịch xem lùi tối đa 5 tuần: trả việc đã xong có hạn / ngày xong từ mốc đó.
  v_done_from := (v_ws - 35)::timestamp at time zone 'Asia/Ho_Chi_Minh';

  with mine as (
    select t.id, t.task_code, t.title, t.status, t.priority, t.deadline_at, t.progress_percent, t.labels, t.lock_version, t.blocked_reason,
      t.completed_at, t.created_at, t.created_by, t.review_policy, t.reviewer_user_id, a.acknowledged_at,
      (a.acknowledged_at is not null) as accepted, (t.status = any(v_active)) as live
    from public.work_task_assignments a
    join public.work_tasks t on t.id = a.task_id
    where a.user_id = v_actor and a.ended_at is null and t.status <> 'draft'
      and (t.status = any(v_active) or (t.status = 'completed' and (t.completed_at >= v_done_from or t.deadline_at >= v_done_from)))
    order by (t.status = 'completed'), t.deadline_at nulls last, t.created_at desc
    limit 300
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'code', m.task_code, 'title', m.title, 'status', m.status, 'level', app_private.work_level(m.priority),
      'deadlineAt', m.deadline_at, 'progressPercent', m.progress_percent, 'labels', to_jsonb(coalesce(m.labels, '{}'::text[])),
      'lockVersion', m.lock_version, 'blockedReason', m.blocked_reason, 'completedAt', m.completed_at, 'createdAt', m.created_at,
      'lastProgressAt', app_private.work_task_last_progress_at(m.id), 'acknowledged', m.accepted,
      'needsReview', m.review_policy <> 'auto_complete',
      'createdBy', (select jsonb_build_object('id', u.id, 'name', u.name) from public.users u where u.id = m.created_by),
      'createdByMe', m.created_by = v_actor,
      'createdByHead', m.created_by <> v_actor and app_private.work_user_heads_user(m.created_by, v_actor),
      'checklist', (select jsonb_build_object('done', count(*) filter (where c.completed_at is not null), 'total', count(*))
        from public.work_task_checklist_items c where c.task_id = m.id and c.deleted_at is null),
      'origin', (select jsonb_build_object('origin', o.origin, 'claimStatus', o.claim_status,
          'giver', (select jsonb_build_object('id', g.id, 'name', g.name) from public.users g where g.id = o.claimed_giver_user_id),
          'meeting', (select jsonb_build_object('title', mt.title, 'heldOn', mt.held_on) from public.work_meetings mt where mt.id = o.meeting_id))
        from public.work_task_origins o where o.task_id = m.id),
      -- Nút bấm được của chính người làm (giống app_private.work_task_capabilities); lệnh máy chủ vẫn kiểm lại.
      'can', jsonb_build_object(
        'acknowledge', m.live and not m.accepted,
        'start', m.live and m.accepted and m.status in ('not_started', 'changes_requested'),
        'block', m.live and m.accepted and m.status = 'in_progress',
        'unblock', m.live and m.accepted and m.status = 'blocked',
        'submit', m.live and m.accepted and m.status in ('in_progress', 'changes_requested'))
    )), '[]'::jsonb)
  into v_tasks from mine m;

  -- Đúng hạn 4 tuần đã qua (tuần gần nhất trước), cùng định nghĩa Phòng tôi.
  with weeks as (
    select g as n, v_ws - 7 * g as ws from generate_series(1, 4) g
  ), work as (
    select t.id, t.status, t.deadline_at, t.completed_at, coalesce(o.origin, 'normal') as origin, o.claim_status
    from public.work_task_assignments a
    join public.work_tasks t on t.id = a.task_id
    left join public.work_task_origins o on o.task_id = t.id
    where a.user_id = v_actor and t.status <> 'draft' and t.deadline_at >= (v_ws - 28)::timestamp at time zone 'Asia/Ho_Chi_Minh'
  )
  select jsonb_agg(jsonb_build_object('weekStart', w.ws,
      'due', (select count(distinct x.id) from work x where x.deadline_at >= w.ws::timestamp at time zone 'Asia/Ho_Chi_Minh'
        and x.deadline_at < (w.ws + 7)::timestamp at time zone 'Asia/Ho_Chi_Minh' and x.status <> 'cancelled'
        and (x.origin <> 'oral_claim' or x.claim_status = 'confirmed')),
      'ontime', (select count(distinct x.id) from work x where x.deadline_at >= w.ws::timestamp at time zone 'Asia/Ho_Chi_Minh'
        and x.deadline_at < (w.ws + 7)::timestamp at time zone 'Asia/Ho_Chi_Minh' and x.status = 'completed' and x.completed_at <= x.deadline_at
        and (x.origin <> 'oral_claim' or x.claim_status = 'confirmed'))) order by w.n)
  into v_weeks from weeks w;

  -- Duyệt lần đầu 28 ngày: việc của tôi được người khác duyệt đạt; đạt ngay lần nộp đầu / tổng.
  select jsonb_build_object('reviewed', count(distinct s.task_id), 'firstPass', count(distinct s.task_id) filter (where s.iteration = 1))
  into v_first
  from public.work_task_submissions s
  where s.submitted_by = v_actor and s.status = 'approved' and s.reviewed_by is not null and s.reviewed_by <> v_actor
    and s.reviewed_at >= now() - interval '28 days';

  select coalesce(sum(case t.priority when 'urgent' then 3 when 'important' then 2 else 1 end), 0) into v_load
  from public.work_task_assignments a join public.work_tasks t on t.id = a.task_id
  where a.user_id = v_actor and a.ended_at is null and t.status = any(v_active);

  return jsonb_build_object(
    'me', (select jsonb_build_object('userId', u.id, 'name', u.name, 'title', e.title,
        'unit', (select jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) from public.org_units ou where ou.id = e.org_unit_id))
      from public.users u
      left join lateral (select e2.title, e2.org_unit_id from public.employees e2
        where e2.user_id = u.id and coalesce(e2.status, '') <> 'Đã nghỉ việc' order by e2.updated_at desc nulls last limit 1) e on true
      where u.id = v_actor),
    'today', v_today, 'weekStart', v_ws, 'weekEnd', v_ws + 6, 'doneSince', v_ws - 35,
    'tasks', v_tasks, 'weeks', coalesce(v_weeks, '[]'::jsonb), 'review', v_first, 'load', v_load);
end $$;

revoke all on function public.work_my_board_v1(date) from public, anon, authenticated;
grant execute on function public.work_my_board_v1(date) to authenticated;

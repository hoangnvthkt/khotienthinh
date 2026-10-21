-- Vioo Work: việc đã xong tính theo người làm cuối cùng khi lọc theo người / đơn vị.
--   Lỗi: lệnh "Hoàn thành" đóng mọi phân công còn mở (state = 'completed', ended_at = lúc xong). Các RPC lọc theo
--   work_task_assignments.ended_at is null nên việc đã xong rơi khỏi mọi bộ lọc theo đơn vị / người:
--   Sổ chỉ đạo theo đơn vị (nhóm "Xong" = 0), ảnh chốt kỳ (PR-6, gọi work_directives_v1), bản tin / báo cáo kỳ (PR-7),
--   "Việc của tôi" (việc đã xong 5 tuần không hiện), Tra việc theo người / đơn vị (done_recent, due), người làm của việc đã xong (trống).
--   Phòng tôi / Toàn công ty không đếm 0 nhưng tính cả phân công đã chuyển đi: người chuyển việc cho người khác vẫn bị tính
--   "đến hạn" / "đúng hạn" / "chỉ đạo xong" của việc đó.
-- Sửa: một định nghĩa "người làm hiện tại" dùng chung (như quyền xem / thông báo ở 20261022090000_work_dot1_notify_quick):
--   a.ended_at is null — việc đang mở;
--   hoặc việc đã xong và phân công kết thúc cùng lệnh hoàn thành (state = 'completed' ⇒ người làm cuối cùng);
--   hoặc việc đã hủy và phân công kết thúc cùng lệnh hủy (state = 'cancelled').
--   Phân công đã chuyển đi (state = 'transferred') không còn được tính. Việc đang mở giữ nguyên ended_at is null.
-- Chỉ thay thân hàm (create or replace, cùng chữ ký ⇒ giữ quyền thực thi); không đổi dữ liệu, không đổi định nghĩa đến hạn / đúng hạn.

-- ── Phòng tôi ───────────────────────────────────────────────────────────────────────────────────────

create or replace function public.work_team_board_v1(p_org_unit_id uuid default null, p_week_start date default null,
  p_from date default null, p_to date default null, p_prev_from date default null, p_prev_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_global boolean; v_unit uuid; v_units uuid[]; v_ws date;
  v_pf date; v_pt date; v_qf date; v_qt date;
  v_from timestamptz; v_to timestamptz; v_prev_from timestamptz; v_prev_to timestamptz;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
  v_workable constant text[] := array['not_started', 'in_progress', 'blocked', 'changes_requested'];
  v_members jsonb;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  v_global := app_private.has_permission(v_actor, 'work.task.view_scope', 'global', '*');
  v_unit := coalesce(p_org_unit_id, (select h from app_private.work_direct_headed_units(v_actor) h limit 1));
  if v_unit is null or not (v_global or v_unit in (select h from app_private.work_headed_units(v_actor) h)) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  with recursive tree as (
    select id from public.org_units where id = v_unit
    union select c.id from public.org_units c join tree on c.parent_id = tree.id where coalesce(c.is_active, true)
  ) select array_agg(id) into v_units from tree;
  v_ws := coalesce(p_week_start, (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') - interval '7 day')::date);
  if p_from is null then
    v_pf := v_ws; v_pt := v_ws + 6; v_qf := v_ws - 7; v_qt := v_ws - 1;
  else
    v_pf := p_from; v_pt := app_private.work_period_to(p_from, p_to);
    v_qf := p_prev_from; v_qt := app_private.work_period_to(p_prev_from, p_prev_to);
  end if;
  v_from := v_pf::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to := (v_pt + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_prev_from := v_qf::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_prev_to := (v_qt + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';

  with members as (
    select distinct on (u.id) u.id as user_id, u.name, e.title, e.org_unit_id
    from public.employees e join public.users u on u.id = e.user_id
    where e.org_unit_id = any(v_units) and coalesce(e.status, '') <> 'Đã nghỉ việc' and u.is_active and u.account_status = 'ACTIVE'
    order by u.id, e.updated_at desc nulls last
  ), work as (
    select a.user_id, t.id, t.status, t.priority, t.deadline_at, t.completed_at, a.acknowledged_at, a.ended_at,
      coalesce(o.origin, 'normal') as origin, o.claim_status
    from public.work_task_assignments a
    join public.work_tasks t on t.id = a.task_id
    left join public.work_task_origins o on o.task_id = t.id
    where a.user_id in (select user_id from members) and t.status <> 'draft'
      and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled'))
  ), stats as (
    select m.user_id,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active)) as active,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active) and w.priority = 'urgent') as a_count,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active) and w.priority = 'important') as b_count,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active) and w.priority = 'normal') as c_count,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active) and w.deadline_at < now()) as overdue,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_workable)
        and app_private.work_task_last_progress_at(w.id) < now() - interval '48 hours') as stale,
      count(distinct w.id) filter (where w.ended_at is null and w.status = 'pending_acknowledgement' and w.acknowledged_at is null) as unack,
      count(distinct w.id) filter (where w.deadline_at >= v_from and w.deadline_at < v_to and w.status <> 'cancelled'
        and (w.origin <> 'oral_claim' or w.claim_status = 'confirmed')) as due,
      count(distinct w.id) filter (where w.deadline_at >= v_from and w.deadline_at < v_to and w.status = 'completed'
        and w.completed_at <= w.deadline_at and (w.origin <> 'oral_claim' or w.claim_status = 'confirmed')) as ontime,
      count(distinct w.id) filter (where w.deadline_at >= v_prev_from and w.deadline_at < v_prev_to and w.status <> 'cancelled'
        and (w.origin <> 'oral_claim' or w.claim_status = 'confirmed')) as prev_due,
      count(distinct w.id) filter (where w.deadline_at >= v_prev_from and w.deadline_at < v_prev_to and w.status = 'completed'
        and w.completed_at <= w.deadline_at and (w.origin <> 'oral_claim' or w.claim_status = 'confirmed')) as prev_ontime
    from members m left join work w on w.user_id = m.user_id
    group by m.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', m.name, 'title', m.title, 'orgUnitId', m.org_unit_id,
      'isHead', m.user_id in (select e.user_id from public.org_units ou join public.hrm_employee_slot_assignments sa on sa.slot_id = ou.manager_slot_id
        join public.employees e on e.id = sa.employee_id where ou.id = v_unit and sa.status = 'ACTIVE' and sa.assignment_type in ('PRIMARY', 'ACTING')
        and sa.effective_from <= current_date and (sa.effective_to is null or sa.effective_to >= current_date)),
      'active', s.active, 'levels', jsonb_build_object('A', s.a_count, 'B', s.b_count, 'C', s.c_count),
      'load', 3 * s.a_count + 2 * s.b_count + s.c_count, 'overdue', s.overdue, 'stale', s.stale, 'unack', s.unack,
      'due', s.due, 'ontime', s.ontime,
      'prevDue', case when v_qf is null then null else s.prev_due end,
      'prevOntime', case when v_qf is null then null else s.prev_ontime end) order by m.name), '[]'::jsonb)
  into v_members
  from members m join stats s on s.user_id = m.user_id;

  return jsonb_build_object(
    'unit', (select jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) from public.org_units ou where ou.id = v_unit),
    'myUnits', coalesce((select jsonb_agg(jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) order by ou.name)
      from public.org_units ou where ou.id in (select h from app_private.work_direct_headed_units(v_actor) h)), '[]'::jsonb),
    'weekStart', v_ws, 'canViewAll', v_global,
    'period', jsonb_build_object('from', v_pf, 'to', v_pt, 'prevFrom', v_qf, 'prevTo', v_qt),
    'reviewWaiting', (select count(*) from public.work_tasks t where t.reviewer_user_id = v_actor and t.status = 'awaiting_review'),
    'members', v_members);
end $$;

-- ── Toàn công ty ────────────────────────────────────────────────────────────────────────────────────

create or replace function public.work_company_board_v1(p_week_start date default null,
  p_from date default null, p_to date default null, p_prev_from date default null, p_prev_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id(); v_ws date; v_month timestamptz; v_units jsonb;
  v_pf date; v_pt date; v_qf date; v_qt date;
  v_from timestamptz; v_to timestamptz; v_prev_from timestamptz; v_prev_to timestamptz;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
  v_workable constant text[] := array['not_started', 'in_progress', 'blocked', 'changes_requested'];
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*')
    or not app_private.has_permission(v_actor, 'work.task.view_scope', 'global', '*') then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  v_ws := coalesce(p_week_start, (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') - interval '7 day')::date);
  if p_from is null then
    v_pf := v_ws; v_pt := v_ws + 6; v_qf := v_ws - 7; v_qt := v_ws - 1;
  else
    v_pf := p_from; v_pt := app_private.work_period_to(p_from, p_to);
    v_qf := p_prev_from; v_qt := app_private.work_period_to(p_prev_from, p_prev_to);
  end if;
  v_from := v_pf::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to := (v_pt + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_prev_from := v_qf::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_prev_to := (v_qt + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_month := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';

  with people as (
    select distinct on (u.id) u.id as user_id, e.org_unit_id
    from public.employees e join public.users u on u.id = e.user_id
    where e.org_unit_id is not null and coalesce(e.status, '') <> 'Đã nghỉ việc' and u.is_active and u.account_status = 'ACTIVE'
    order by u.id, e.updated_at desc nulls last
  ), work as (
    select p.org_unit_id, t.id, t.status, t.deadline_at, t.completed_at, a.ended_at,
      coalesce(o.origin, 'normal') as origin, o.claim_status
    from people p
    join public.work_task_assignments a on a.user_id = p.user_id
    join public.work_tasks t on t.id = a.task_id
    left join public.work_task_origins o on o.task_id = t.id
    where t.status <> 'draft' and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled'))
  ), stats as (
    select org_unit_id,
      count(distinct id) filter (where ended_at is null and status = any(v_active)) as active,
      count(distinct id) filter (where ended_at is null and status = any(v_active) and deadline_at < now()) as overdue,
      count(distinct id) filter (where ended_at is null and status = any(v_workable)
        and app_private.work_task_last_progress_at(id) < now() - interval '48 hours') as stale,
      count(distinct id) filter (where deadline_at >= v_from and deadline_at < v_to and status <> 'cancelled'
        and (origin <> 'oral_claim' or claim_status = 'confirmed')) as due,
      count(distinct id) filter (where deadline_at >= v_from and deadline_at < v_to and status = 'completed' and completed_at <= deadline_at
        and (origin <> 'oral_claim' or claim_status = 'confirmed')) as ontime,
      count(distinct id) filter (where deadline_at >= v_prev_from and deadline_at < v_prev_to and status <> 'cancelled'
        and (origin <> 'oral_claim' or claim_status = 'confirmed')) as prev_due,
      count(distinct id) filter (where deadline_at >= v_prev_from and deadline_at < v_prev_to and status = 'completed' and completed_at <= deadline_at
        and (origin <> 'oral_claim' or claim_status = 'confirmed')) as prev_ontime,
      count(distinct id) filter (where (origin = 'directive' or (origin = 'oral_claim' and claim_status = 'confirmed'))
        and ended_at is null and status = any(v_active)) as directive_open,
      count(distinct id) filter (where (origin = 'directive' or (origin = 'oral_claim' and claim_status = 'confirmed'))
        and ended_at is null and status = any(v_active) and deadline_at < now()) as directive_late,
      count(distinct id) filter (where (origin = 'directive' or (origin = 'oral_claim' and claim_status = 'confirmed'))
        and status = 'completed' and completed_at >= v_month) as directive_done_month,
      count(distinct id) filter (where (origin = 'directive' or (origin = 'oral_claim' and claim_status = 'confirmed'))
        and status = 'completed' and completed_at >= v_from and completed_at < v_to) as directive_done_period,
      count(distinct id) filter (where origin = 'oral_claim' and claim_status = 'pending') as claims_pending
    from work group by org_unit_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name, 'type', ou.type,
      'parent', (select jsonb_build_object('id', pu.id, 'code', pu.code, 'name', pu.name) from public.org_units pu where pu.id = ou.parent_id),
      'people', pc.people,
      'hasHead', exists (select 1 from public.hrm_employee_slot_assignments sa where sa.slot_id = ou.manager_slot_id and sa.status = 'ACTIVE'
        and sa.assignment_type in ('PRIMARY', 'ACTING') and sa.effective_from <= current_date and (sa.effective_to is null or sa.effective_to >= current_date)),
      'active', coalesce(s.active, 0), 'overdue', coalesce(s.overdue, 0), 'stale', coalesce(s.stale, 0),
      'due', coalesce(s.due, 0), 'ontime', coalesce(s.ontime, 0),
      'prevDue', case when v_qf is null then null else coalesce(s.prev_due, 0) end,
      'prevOntime', case when v_qf is null then null else coalesce(s.prev_ontime, 0) end,
      'directives', jsonb_build_object('open', coalesce(s.directive_open, 0), 'late', coalesce(s.directive_late, 0),
        'doneThisMonth', coalesce(s.directive_done_month, 0), 'doneInPeriod', coalesce(s.directive_done_period, 0)),
      'claimsPending', coalesce(s.claims_pending, 0)) order by ou.order_index nulls last, ou.name), '[]'::jsonb)
  into v_units
  from public.org_units ou
  join (select org_unit_id, count(*) as people from people group by org_unit_id) pc on pc.org_unit_id = ou.id
  left join stats s on s.org_unit_id = ou.id
  where coalesce(ou.is_active, true);

  return jsonb_build_object('weekStart', v_ws, 'units', v_units,
    'period', jsonb_build_object('from', v_pf, 'to', v_pt, 'prevFrom', v_qf, 'prevTo', v_qt),
    'claimsWaitingMe', (select count(*) from public.work_task_origins o where o.claimed_giver_user_id = v_actor and o.claim_status = 'pending'));
end $$;

-- ── Việc của tôi ────────────────────────────────────────────────────────────────────────────────────

create or replace function public.work_my_board_v1(p_week_start date default null,
  p_from date default null, p_to date default null, p_prev_from date default null, p_prev_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_ws date; v_done_from timestamptz;
  v_pf date; v_pt date; v_qf date; v_qt date;
  v_from timestamptz; v_to timestamptz; v_prev_from timestamptz; v_prev_to timestamptz;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
  v_tasks jsonb; v_weeks jsonb; v_first jsonb; v_load integer; v_period jsonb;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  v_ws := coalesce(p_week_start, (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh'))::date);
  -- Lịch xem lùi tối đa 5 tuần: trả việc đã xong có hạn / ngày xong từ mốc đó.
  v_done_from := (v_ws - 35)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  if p_from is null then
    v_pf := v_ws - 7; v_pt := v_ws - 1; v_qf := v_ws - 14; v_qt := v_ws - 8;
  else
    v_pf := p_from; v_pt := app_private.work_period_to(p_from, p_to);
    v_qf := p_prev_from; v_qt := app_private.work_period_to(p_prev_from, p_prev_to);
  end if;
  v_from := v_pf::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to := (v_pt + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_prev_from := v_qf::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_prev_to := (v_qt + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';

  with mine as (
    select t.id, t.task_code, t.title, t.status, t.priority, t.deadline_at, t.progress_percent, t.labels, t.lock_version, t.blocked_reason,
      t.completed_at, t.created_at, t.created_by, t.review_policy, t.reviewer_user_id, a.acknowledged_at,
      (a.acknowledged_at is not null) as accepted, (t.status = any(v_active)) as live
    from public.work_task_assignments a
    join public.work_tasks t on t.id = a.task_id
    where a.user_id = v_actor and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled')) and t.status <> 'draft'
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
    where a.user_id = v_actor and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled')) and t.status <> 'draft'
      and t.deadline_at >= (v_ws - 28)::timestamp at time zone 'Asia/Ho_Chi_Minh'
  )
  select jsonb_agg(jsonb_build_object('weekStart', w.ws,
      'due', (select count(distinct x.id) from work x where x.deadline_at >= w.ws::timestamp at time zone 'Asia/Ho_Chi_Minh'
        and x.deadline_at < (w.ws + 7)::timestamp at time zone 'Asia/Ho_Chi_Minh' and x.status <> 'cancelled'
        and (x.origin <> 'oral_claim' or x.claim_status = 'confirmed')),
      'ontime', (select count(distinct x.id) from work x where x.deadline_at >= w.ws::timestamp at time zone 'Asia/Ho_Chi_Minh'
        and x.deadline_at < (w.ws + 7)::timestamp at time zone 'Asia/Ho_Chi_Minh' and x.status = 'completed' and x.completed_at <= x.deadline_at
        and (x.origin <> 'oral_claim' or x.claim_status = 'confirmed'))) order by w.n)
  into v_weeks from weeks w;

  -- Kỳ chọn + kỳ trước, cùng định nghĩa với 'weeks'.
  with work as (
    select t.id, t.status, t.deadline_at, t.completed_at
    from public.work_task_assignments a
    join public.work_tasks t on t.id = a.task_id
    left join public.work_task_origins o on o.task_id = t.id
    where a.user_id = v_actor and t.status not in ('draft', 'cancelled') and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled'))
      and (coalesce(o.origin, 'normal') <> 'oral_claim' or o.claim_status = 'confirmed')
      and ((t.deadline_at >= v_from and t.deadline_at < v_to) or (t.deadline_at >= v_prev_from and t.deadline_at < v_prev_to))
  )
  select jsonb_build_object('from', v_pf, 'to', v_pt, 'prevFrom', v_qf, 'prevTo', v_qt,
      'due', count(distinct x.id) filter (where x.deadline_at >= v_from and x.deadline_at < v_to),
      'ontime', count(distinct x.id) filter (where x.deadline_at >= v_from and x.deadline_at < v_to
        and x.status = 'completed' and x.completed_at <= x.deadline_at),
      'prevDue', case when v_qf is null then null else count(distinct x.id) filter (where x.deadline_at >= v_prev_from and x.deadline_at < v_prev_to) end,
      'prevOntime', case when v_qf is null then null else count(distinct x.id) filter (where x.deadline_at >= v_prev_from and x.deadline_at < v_prev_to
        and x.status = 'completed' and x.completed_at <= x.deadline_at) end)
  into v_period from work x;

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
    'tasks', v_tasks, 'weeks', coalesce(v_weeks, '[]'::jsonb), 'review', v_first, 'load', v_load, 'period', v_period);
end $$;

-- ── Sổ chỉ đạo ──────────────────────────────────────────────────────────────────────────────────────

create or replace function public.work_directives_v1(p_org_unit_id uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id(); v_global boolean; v_units uuid[];
  v_done_from timestamptz; v_done_to timestamptz;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  v_global := app_private.has_permission(v_actor, 'work.task.view_scope', 'global', '*');
  -- Đơn vị lọc: BLĐ chọn bất kỳ; trưởng đơn vị chỉ đơn vị mình (và đơn vị con).
  if p_org_unit_id is not null and not v_global and p_org_unit_id not in (select h from app_private.work_headed_units(v_actor) h) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  -- Nhóm "Xong": mặc định từ đầu tháng; có kỳ thì lấy việc xong trong kỳ.
  if p_from is null then
    v_done_from := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
  else
    v_done_from := p_from::timestamp at time zone 'Asia/Ho_Chi_Minh';
    v_done_to := (app_private.work_period_to(p_from, p_to) + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  end if;
  with recursive tree as (
    select ou.id from public.org_units ou where p_org_unit_id is not null and ou.id = p_org_unit_id
    union select c.id from public.org_units c join tree on c.parent_id = tree.id where coalesce(c.is_active, true)
  ) select array_agg(id) into v_units from tree;

  return coalesce((select jsonb_agg(x order by x->>'bucket', x->>'deadlineAt') from (
    select jsonb_build_object('id', t.id, 'code', t.task_code, 'title', t.title, 'level', app_private.work_level(t.priority), 'status', t.status,
      'deadlineAt', t.deadline_at, 'progressPercent', t.progress_percent, 'completedAt', t.completed_at, 'createdAt', t.created_at,
      'lastProgressAt', app_private.work_task_last_progress_at(t.id),
      'origin', o.origin, 'claimStatus', o.claim_status,
      'giver', (select jsonb_build_object('id', g.id, 'name', g.name) from public.users g where g.id = o.claimed_giver_user_id),
      'meeting', (select jsonb_build_object('title', m.title, 'heldOn', m.held_on) from public.work_meetings m where m.id = o.meeting_id),
      'assignees', coalesce((select jsonb_agg(jsonb_build_object('name', u.name, 'unit',
          (select ou.code from public.org_units ou where ou.id = app_private.work_user_org_unit(u.id))) order by a.assigned_at)
        from public.work_task_assignments a join public.users u on u.id = a.user_id where a.task_id = t.id and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled'))), '[]'::jsonb),
      'canDecide', o.origin = 'oral_claim' and o.claim_status = 'pending' and o.claimed_giver_user_id = v_actor,
      'bucket', case
        when o.origin = 'oral_claim' and o.claim_status = 'pending' then 'confirm'
        when t.status = 'completed' then 'done'
        when t.status = any(v_active) and t.deadline_at < now() then 'late'
        else 'doing' end) as x
    from public.work_task_origins o
    join public.work_tasks t on t.id = o.task_id
    where t.status <> 'cancelled' and t.status <> 'draft' and o.claim_status <> 'rejected'
      and (t.status = any(v_active) or (t.status = 'completed' and t.completed_at >= v_done_from
        and (v_done_to is null or t.completed_at < v_done_to)))
      and (v_units is null or exists (select 1 from public.work_task_assignments a where a.task_id = t.id and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled'))
        and app_private.work_user_org_unit(a.user_id) = any(v_units)))
      and (v_global or o.claimed_giver_user_id = v_actor or app_private.work_task_actor_can_view(t.id))
    order by t.deadline_at nulls last
    limit 300) q), '[]'::jsonb);
end $$;

-- ── Tra việc (màn + AI) ─────────────────────────────────────────────────────────────────────────────

create or replace function public.work_tasks_overview_v1(p_assignee_user_id uuid default null, p_unit_query text default null,
  p_state text default 'open', p_due_before date default null, p_limit integer default 30, p_due_from date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id(); v_q text; v_unit public.org_units%rowtype; v_units jsonb; v_n integer; v_due timestamptz;
  v_due_from timestamptz; v_state text := coalesce(p_state, 'open'); v_result jsonb;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
  v_workable constant text[] := array['not_started', 'in_progress', 'blocked', 'changes_requested'];
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if v_state not in ('open', 'overdue', 'stale', 'review', 'unack', 'done_recent', 'due', 'all') then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  v_q := nullif(lower(public.unaccent(btrim(coalesce(p_unit_query, '')))), '');
  if v_q is not null then
    -- Trùng mã thì lấy đúng đơn vị đó; không thì tìm theo tên / mã gần đúng, nhiều đơn vị khớp thì trả danh sách để hỏi lại.
    select * into v_unit from public.org_units ou where coalesce(ou.is_active, true) and lower(public.unaccent(coalesce(ou.code, ''))) = v_q limit 1;
    if v_unit.id is null then
      select count(*), jsonb_agg(jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) order by ou.name) into v_n, v_units
        from public.org_units ou where coalesce(ou.is_active, true)
          and (lower(public.unaccent(ou.name)) like '%' || v_q || '%' or lower(public.unaccent(coalesce(ou.code, ''))) like '%' || v_q || '%');
      if v_n = 0 then return jsonb_build_object('code', 'UNIT_NOT_FOUND'); end if;
      if v_n > 1 then return jsonb_build_object('code', 'UNIT_AMBIGUOUS', 'units', v_units); end if;
      select * into v_unit from public.org_units ou where ou.id = (v_units->0->>'id')::uuid;
    end if;
  end if;
  v_due := case when p_due_before is null then null else (p_due_before + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' end;
  v_due_from := case when p_due_from is null then null else p_due_from::timestamp at time zone 'Asia/Ho_Chi_Minh' end;

  with recursive sub as (
    select v_unit.id as id where v_unit.id is not null
    union all
    select ou.id from public.org_units ou join sub on ou.parent_id = sub.id
  ), cand as (
    select t.id, t.task_code, t.title, t.status, t.priority, t.deadline_at, t.completed_at, t.progress_percent, t.privacy, t.created_by, t.created_at,
      app_private.work_task_last_progress_at(t.id) as last_at
    from public.work_tasks t
    where t.status <> 'draft'
      and (p_assignee_user_id is null or exists (select 1 from public.work_task_assignments a
        where a.task_id = t.id and a.user_id = p_assignee_user_id and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled'))))
      and (v_unit.id is null or exists (select 1 from public.work_task_assignments a
        where a.task_id = t.id and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled')) and app_private.work_user_org_unit(a.user_id) in (select s.id from sub s)))
      and (v_due is null or t.deadline_at < v_due)
      and (v_due_from is null or t.deadline_at >= v_due_from)
      and case v_state
        when 'open' then t.status = any(v_active)
        when 'overdue' then t.status = any(v_active) and t.deadline_at < now()
        when 'stale' then t.status = any(v_workable)
        when 'review' then t.status = 'awaiting_review'
        when 'unack' then t.status = 'pending_acknowledgement'
        when 'done_recent' then t.status = 'completed' and t.completed_at >= now() - interval '14 days'
        -- Đúng tập "đến hạn" của bảng: không tính việc hủy, việc giao miệng chỉ tính khi đã xác nhận.
        when 'due' then t.status <> 'cancelled' and not exists (select 1 from public.work_task_origins o
          where o.task_id = t.id and o.origin = 'oral_claim' and o.claim_status is distinct from 'confirmed')
        else true end
      and app_private.work_task_actor_can_view(t.id)
  ), x as (
    select c.* from cand c where v_state <> 'stale' or c.last_at < now() - interval '48 hours'
  )
  select jsonb_build_object(
    'unit', case when v_unit.id is null then null else jsonb_build_object('id', v_unit.id, 'code', v_unit.code, 'name', v_unit.name) end,
    'total', (select count(*) from x),
    'overdue', (select count(*) from x where x.status = any(v_active) and x.deadline_at < now()),
    'stale', (select count(*) from x where x.status = any(v_workable) and x.last_at < now() - interval '48 hours'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', y.id, 'code', y.task_code, 'title', y.title, 'status', y.status,
        'level', app_private.work_level(y.priority), 'deadlineAt', y.deadline_at, 'progressPercent', y.progress_percent, 'lastProgressAt', y.last_at,
        'completedAt', y.completed_at,
        'ontime', case when y.deadline_at is null then null else y.status = 'completed' and coalesce(y.completed_at <= y.deadline_at, false) end,
        'overdue', y.status = any(v_active) and y.deadline_at < now(), 'restricted', y.privacy = 'restricted',
        'createdByName', (select u.name from public.users u where u.id = y.created_by),
        'assignees', coalesce((select jsonb_agg(jsonb_build_object('userId', a.user_id, 'name', u.name) order by a.assigned_at)
          from public.work_task_assignments a join public.users u on u.id = a.user_id where a.task_id = y.id and (a.ended_at is null or (y.status = 'completed' and a.state = 'completed') or (y.status = 'cancelled' and a.state = 'cancelled'))), '[]'::jsonb))
        order by y.ord)
      from (select x.*, row_number() over (order by x.deadline_at is null, x.deadline_at,
              case x.priority when 'urgent' then 0 when 'important' then 1 else 2 end, x.created_at desc) as ord
            from x order by ord limit greatest(1, least(coalesce(p_limit, 30), 100))) y), '[]'::jsonb))
  into v_result;
  return v_result;
end $$;

-- ── Việc của mục tiêu ───────────────────────────────────────────────────────────────────────────────

create or replace function public.work_goal_tasks_v1(p_goal_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); g public.work_goals%rowtype;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select * into g from public.work_goals x where x.id = p_goal_id and x.deleted_at is null;
  if g.id is null then raise exception 'WORK_GOAL_INVALID' using errcode = '22023'; end if;
  if not app_private.work_can_view_scope(v_actor, g.org_unit_id) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', y.id,
        'code', case when y.can_view then y.task_code end,
        'title', case when y.can_view then y.title else 'Việc hạn chế' end,
        'status', y.status, 'level', app_private.work_level(y.priority), 'deadlineAt', y.deadline_at, 'progressPercent', y.progress_percent,
        'completedAt', y.completed_at,
        'ontime', case when y.deadline_at is null then null else y.status = 'completed' and coalesce(y.completed_at <= y.deadline_at, false) end,
        'overdue', y.status = any(v_active) and y.deadline_at < now(),
        'lastProgressAt', case when y.can_view then app_private.work_task_last_progress_at(y.id) end,
        'assignees', case when not y.can_view then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('userId', a.user_id, 'name', u.name)
            order by a.assigned_at)
          from public.work_task_assignments a join public.users u on u.id = a.user_id where a.task_id = y.id and (a.ended_at is null or (y.status = 'completed' and a.state = 'completed') or (y.status = 'cancelled' and a.state = 'cancelled'))), '[]'::jsonb) end,
        'restricted', not y.can_view) order by y.deadline_at nulls last, y.created_at, y.id)
      from (select t.*, app_private.work_task_actor_can_view(t.id) as can_view
        from public.work_goal_tasks gt join public.work_tasks t on t.id = gt.task_id
        where gt.goal_id = g.id and t.status <> 'draft') y), '[]'::jsonb));
end $$;

-- ── Lõi số kỳ (bản tin / báo cáo kỳ) ────────────────────────────────────────────────────────────────

create or replace function app_private.work_period_digest(p_org_unit_id uuid, p_from date, p_to date,
  p_prev_from date default null, p_prev_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
  v_workable constant text[] := array['not_started', 'in_progress', 'blocked', 'changes_requested'];
  v_to date; v_qt date; v_stats_to date;
  v_from_ts timestamptz; v_stats_to_ts timestamptz; v_done_to_ts timestamptz; v_prev_from_ts timestamptz; v_prev_to_ts timestamptz;
  v_close public.work_period_closes%rowtype; v_scope_name text;
  v_rows jsonb; v_dir jsonb; v_goals jsonb;
  v_due integer; v_ontime integer; v_overdue integer; v_stale integer; v_prev_due integer; v_prev_ontime integer; v_prev_rows integer;
  v_rate integer; v_prev_rate integer; v_worst jsonb; v_goal_sum jsonb; v_lines text[]; v_line text;
begin
  if p_from is null then raise exception 'WORK_INVALID_PERIOD' using errcode = '22023'; end if;
  v_to := app_private.work_period_to(p_from, p_to);
  v_qt := app_private.work_period_to(p_prev_from, p_prev_to);
  if p_org_unit_id is not null then
    select ou.name into v_scope_name from public.org_units ou where ou.id = p_org_unit_id;
    if v_scope_name is null then raise exception 'WORK_BOARD_DENIED' using errcode = '42501'; end if;
  else
    v_scope_name := 'Toàn công ty';
  end if;
  -- Như bản chốt PR-6: số đến hạn / đúng hạn chỉ tính tới hôm nay (việc chưa đến hạn không kéo tỷ lệ xuống).
  v_stats_to := least(v_to, v_today);
  v_from_ts := p_from::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_stats_to_ts := (v_stats_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_done_to_ts := (v_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_prev_from_ts := p_prev_from::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_prev_to_ts := (v_qt + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';

  select * into v_close from public.work_period_closes c
    where coalesce(c.org_unit_id, v_zero) = coalesce(p_org_unit_id, v_zero) and c.period_from = p_from and c.period_to = v_to and c.status = 'closed';

  if v_close.id is not null then
    -- Ảnh chốt: dòng của bảng (đơn vị / người), sổ chỉ đạo, mục tiêu đúng như lúc chốt.
    select coalesce(jsonb_agg(jsonb_build_object('id', coalesce(x->'id', x->'userId'), 'name', x->>'name', 'code', x->'code',
        'due', coalesce((x->>'due')::int, 0), 'ontime', coalesce((x->>'ontime')::int, 0),
        'prevDue', (x->>'prevDue')::int, 'prevOntime', (x->>'prevOntime')::int,
        'overdue', coalesce((x->>'overdue')::int, 0), 'stale', coalesce((x->>'stale')::int, 0))), '[]'::jsonb)
      into v_rows
      from jsonb_array_elements(case when p_org_unit_id is null then coalesce(v_close.snapshot->'board'->'units', '[]'::jsonb)
        else coalesce(v_close.snapshot->'board'->'members', '[]'::jsonb) end) x;
    select jsonb_build_object('open', count(*) filter (where d->>'bucket' in ('doing', 'late')),
        'late', count(*) filter (where d->>'bucket' = 'late'), 'done', count(*) filter (where d->>'bucket' = 'done'))
      into v_dir from jsonb_array_elements(coalesce(v_close.snapshot->'directives', '[]'::jsonb)) d;
    v_goals := coalesce(v_close.snapshot->'goals', '[]'::jsonb);
    v_stats_to := coalesce((v_close.snapshot->>'statsTo')::date, v_stats_to);
  elsif p_org_unit_id is null then
    -- Toàn công ty: như work_company_board_v1 (mỗi đơn vị có người).
    with people as (
      select distinct on (u.id) u.id as user_id, e.org_unit_id
      from public.employees e join public.users u on u.id = e.user_id
      where e.org_unit_id is not null and coalesce(e.status, '') <> 'Đã nghỉ việc' and u.is_active and u.account_status = 'ACTIVE'
      order by u.id, e.updated_at desc nulls last
    ), work as (
      select p.org_unit_id, t.id, t.status, t.deadline_at, t.completed_at, a.ended_at, coalesce(o.origin, 'normal') as origin, o.claim_status
      from people p
      join public.work_task_assignments a on a.user_id = p.user_id
      join public.work_tasks t on t.id = a.task_id
      left join public.work_task_origins o on o.task_id = t.id
      where t.status <> 'draft' and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled'))
    ), stats as (
      select org_unit_id,
        count(distinct id) filter (where ended_at is null and status = any(v_active) and deadline_at < now()) as overdue,
        count(distinct id) filter (where ended_at is null and status = any(v_workable)
          and app_private.work_task_last_progress_at(id) < now() - interval '48 hours') as stale,
        count(distinct id) filter (where deadline_at >= v_from_ts and deadline_at < v_stats_to_ts and status <> 'cancelled'
          and (origin <> 'oral_claim' or claim_status = 'confirmed')) as due,
        count(distinct id) filter (where deadline_at >= v_from_ts and deadline_at < v_stats_to_ts and status = 'completed' and completed_at <= deadline_at
          and (origin <> 'oral_claim' or claim_status = 'confirmed')) as ontime,
        count(distinct id) filter (where deadline_at >= v_prev_from_ts and deadline_at < v_prev_to_ts and status <> 'cancelled'
          and (origin <> 'oral_claim' or claim_status = 'confirmed')) as prev_due,
        count(distinct id) filter (where deadline_at >= v_prev_from_ts and deadline_at < v_prev_to_ts and status = 'completed' and completed_at <= deadline_at
          and (origin <> 'oral_claim' or claim_status = 'confirmed')) as prev_ontime
      from work group by org_unit_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', ou.id, 'name', ou.name, 'code', ou.code,
        'due', coalesce(s.due, 0), 'ontime', coalesce(s.ontime, 0),
        'prevDue', case when p_prev_from is null then null else coalesce(s.prev_due, 0) end,
        'prevOntime', case when p_prev_from is null then null else coalesce(s.prev_ontime, 0) end,
        'overdue', coalesce(s.overdue, 0), 'stale', coalesce(s.stale, 0))), '[]'::jsonb)
      into v_rows
      from public.org_units ou
      join (select org_unit_id from people group by org_unit_id) pc on pc.org_unit_id = ou.id
      left join stats s on s.org_unit_id = ou.id
      where coalesce(ou.is_active, true);
  else
    -- Đơn vị (gồm đơn vị con): như work_team_board_v1, mỗi người một dòng.
    with recursive tree as (
      select ou.id from public.org_units ou where ou.id = p_org_unit_id
      union select c.id from public.org_units c join tree on c.parent_id = tree.id where coalesce(c.is_active, true)
    ), members as (
      select distinct on (u.id) u.id as user_id, u.name
      from public.employees e join public.users u on u.id = e.user_id
      where e.org_unit_id in (select id from tree) and coalesce(e.status, '') <> 'Đã nghỉ việc' and u.is_active and u.account_status = 'ACTIVE'
      order by u.id, e.updated_at desc nulls last
    ), work as (
      select a.user_id, t.id, t.status, t.deadline_at, t.completed_at, a.ended_at, coalesce(o.origin, 'normal') as origin, o.claim_status
      from public.work_task_assignments a
      join public.work_tasks t on t.id = a.task_id
      left join public.work_task_origins o on o.task_id = t.id
      where a.user_id in (select user_id from members) and t.status <> 'draft'
        and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled'))
    ), stats as (
      select m.user_id, m.name,
        count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active) and w.deadline_at < now()) as overdue,
        count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_workable)
          and app_private.work_task_last_progress_at(w.id) < now() - interval '48 hours') as stale,
        count(distinct w.id) filter (where w.deadline_at >= v_from_ts and w.deadline_at < v_stats_to_ts and w.status <> 'cancelled'
          and (w.origin <> 'oral_claim' or w.claim_status = 'confirmed')) as due,
        count(distinct w.id) filter (where w.deadline_at >= v_from_ts and w.deadline_at < v_stats_to_ts and w.status = 'completed'
          and w.completed_at <= w.deadline_at and (w.origin <> 'oral_claim' or w.claim_status = 'confirmed')) as ontime,
        count(distinct w.id) filter (where w.deadline_at >= v_prev_from_ts and w.deadline_at < v_prev_to_ts and w.status <> 'cancelled'
          and (w.origin <> 'oral_claim' or w.claim_status = 'confirmed')) as prev_due,
        count(distinct w.id) filter (where w.deadline_at >= v_prev_from_ts and w.deadline_at < v_prev_to_ts and w.status = 'completed'
          and w.completed_at <= w.deadline_at and (w.origin <> 'oral_claim' or w.claim_status = 'confirmed')) as prev_ontime
      from members m left join work w on w.user_id = m.user_id
      group by m.user_id, m.name
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', s.user_id, 'name', s.name, 'code', null,
        'due', s.due, 'ontime', s.ontime,
        'prevDue', case when p_prev_from is null then null else s.prev_due end,
        'prevOntime', case when p_prev_from is null then null else s.prev_ontime end,
        'overdue', s.overdue, 'stale', s.stale)), '[]'::jsonb)
      into v_rows from stats s;
  end if;

  if v_close.id is null then
    -- Sổ chỉ đạo như work_directives_v1 (đếm, không lọc theo quyền xem từng việc); "Xong" = xong trong trọn kỳ.
    with recursive tree as (
      select ou.id from public.org_units ou where p_org_unit_id is not null and ou.id = p_org_unit_id
      union select c.id from public.org_units c join tree on c.parent_id = tree.id where coalesce(c.is_active, true)
    ), b as (
      select case
          when o.origin = 'oral_claim' and o.claim_status = 'pending' then 'confirm'
          when t.status = 'completed' then 'done'
          when t.status = any(v_active) and t.deadline_at < now() then 'late'
          else 'doing' end as bucket
      from public.work_task_origins o
      join public.work_tasks t on t.id = o.task_id
      where t.status <> 'cancelled' and t.status <> 'draft' and o.claim_status <> 'rejected'
        and (t.status = any(v_active) or (t.status = 'completed' and t.completed_at >= v_from_ts and t.completed_at < v_done_to_ts))
        and (p_org_unit_id is null or exists (select 1 from public.work_task_assignments a where a.task_id = t.id and (a.ended_at is null or (t.status = 'completed' and a.state = 'completed') or (t.status = 'cancelled' and a.state = 'cancelled'))
          and app_private.work_user_org_unit(a.user_id) in (select id from tree)))
    )
    select jsonb_build_object('open', count(*) filter (where bucket in ('doing', 'late')),
        'late', count(*) filter (where bucket = 'late'), 'done', count(*) filter (where bucket = 'done'))
      into v_dir from b;
    -- Mục tiêu đúng phạm vi, kỳ mục tiêu giao với [from, to] (như work_goals_v1).
    select coalesce(jsonb_agg(app_private.work_goal_json(g.id)), '[]'::jsonb) into v_goals
      from public.work_goals g
      where g.deleted_at is null and coalesce(g.org_unit_id, v_zero) = coalesce(p_org_unit_id, v_zero)
        and g.period_start <= v_to and app_private.work_goal_period_end(g.period_kind, g.period_start) >= p_from;
  end if;

  -- Tổng (như teamTotals / companyTotals của màn): cộng các dòng; kỳ trước chỉ tính dòng có số kỳ trước.
  select coalesce(sum((r->>'due')::int), 0), coalesce(sum((r->>'ontime')::int), 0), coalesce(sum((r->>'overdue')::int), 0),
      coalesce(sum((r->>'stale')::int), 0), coalesce(sum((r->>'prevDue')::int), 0), coalesce(sum((r->>'prevOntime')::int), 0),
      count(*) filter (where r->>'prevDue' is not null)
    into v_due, v_ontime, v_overdue, v_stale, v_prev_due, v_prev_ontime, v_prev_rows
    from jsonb_array_elements(v_rows) r;
  v_rate := case when v_due > 0 then round(v_ontime * 100.0 / v_due)::int end;
  v_prev_rate := case when v_prev_rows > 0 and v_prev_due > 0 then round(v_prev_ontime * 100.0 / v_prev_due)::int end;

  select coalesce(jsonb_agg(w.j order by w.score desc, w.name, w.id), '[]'::jsonb) into v_worst from (
    select jsonb_build_object('id', r->'id', 'name', r->>'name', 'code', r->'code', 'overdue', x.ov, 'late', x.lt,
        'rate', case when (r->>'due')::int > 0 then round((r->>'ontime')::int * 100.0 / (r->>'due')::int)::int end) as j,
      x.ov + x.lt as score, r->>'name' as name, r->>'id' as id
    from jsonb_array_elements(v_rows) r
    cross join lateral (select (r->>'overdue')::int as ov, greatest((r->>'due')::int - (r->>'ontime')::int, 0) as lt) x
    where x.ov + x.lt > 0
    order by x.ov + x.lt desc, r->>'name', r->>'id'
    limit 5) w;

  select jsonb_build_object('total', count(*), 'met', count(*) filter (where g->>'status' = 'met'),
      'missed', count(*) filter (where g->>'status' = 'missed'), 'atRisk', count(*) filter (where g->>'status' = 'at_risk'))
    into v_goal_sum from jsonb_array_elements(v_goals) g;

  -- Dòng chữ cho thông báo (3–5 dòng).
  v_lines := array[case when v_due > 0 then format('Đúng hạn %s%% (%s/%s việc đến hạn)', v_rate, v_ontime, v_due)
      else 'Chưa có việc đến hạn trong kỳ' end
    || case when v_prev_rate is not null then ' · kỳ trước ' || v_prev_rate || '%' else '' end];
  v_lines := v_lines || (format('Đang quá hạn: %s việc', v_overdue)
    || case when v_stale > 0 then format(' · Lâu chưa cập nhật: %s việc', v_stale) else '' end);
  v_lines := v_lines || format('Chỉ đạo: %s đang mở · %s trễ · %s xong trong kỳ', v_dir->>'open', v_dir->>'late', v_dir->>'done');
  if (v_goal_sum->>'total')::int > 0 then
    v_lines := v_lines || (format('Mục tiêu: %s/%s đạt', v_goal_sum->>'met', v_goal_sum->>'total')
      || case when (v_goal_sum->>'missed')::int > 0 then ' · ' || (v_goal_sum->>'missed') || ' chưa đạt' else '' end
      || case when (v_goal_sum->>'atRisk')::int > 0 then ' · ' || (v_goal_sum->>'atRisk') || ' có nguy cơ' else '' end);
  end if;
  if jsonb_array_length(v_worst) > 0 then
    select 'Cần chú ý: ' || string_agg(w->>'name' || ' (' || concat_ws(', ',
        case when (w->>'overdue')::int > 0 then (w->>'overdue') || ' quá hạn' end,
        case when (w->>'late')::int > 0 then (w->>'late') || ' không đúng hạn' end) || ')', '; ' order by o)
      into v_line from jsonb_array_elements(v_worst) with ordinality a(w, o) where o <= 2;
    v_lines := v_lines || v_line;
  end if;

  return jsonb_build_object('orgUnitId', p_org_unit_id, 'scopeName', v_scope_name, 'from', p_from, 'to', v_to, 'statsTo', v_stats_to,
    'closed', v_close.id is not null, 'closedAt', v_close.closed_at,
    'closedBy', (select u.name from public.users u where u.id = v_close.closed_by),
    'due', v_due, 'ontime', v_ontime, 'rate', v_rate, 'prevRate', v_prev_rate, 'overdue', v_overdue, 'stale', v_stale,
    'directives', v_dir, 'goals', v_goal_sum, 'worst', v_worst, 'lines', to_jsonb(v_lines));
end $$;

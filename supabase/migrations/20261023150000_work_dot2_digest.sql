-- Vioo Work · Đợt 2 PR-7: báo cáo kỳ (số gọn cho màn trình chiếu) + bản tin BLĐ / trưởng đơn vị theo lịch chốt.
--   1) public.work_period_digest_v1(unit, from, to, prev_from, prev_to): số kỳ gọn — đúng hạn %, kỳ trước %, quá hạn, chậm cập nhật,
--      chỉ đạo, mục tiêu, 5 đơn vị / người trễ nhiều nhất + 3–5 dòng chữ cho thông báo. Kỳ đã chốt (PR-6) ⇒ lấy số từ ảnh chốt.
--      Quyền: Vioo Work + quản phạm vi (đơn vị ⇒ trưởng đơn vị / đơn vị cha hoặc BLĐ; toàn công ty ⇒ BLĐ). Chỉ đọc.
--   2) Bản tin theo lịch: cron 15 phút gọi app_private.work_send_digests(). Mỗi phạm vi (toàn công ty; đơn vị có trưởng + có người)
--      tính lần báo cáo gần nhất theo lịch hiệu lực (riêng → đơn vị cha gần nhất → công ty, như work_period_status_v1); chỉ gửi trong
--      1 ngày kể từ giờ báo cáo (không gửi bù kỳ cũ khi mới bật) và mỗi (phạm vi, kỳ) đúng một lần (app_private.work_digest_sends).
--      Gửi bằng thông báo trong app + web push sẵn có (push_enabled). Kỳ không có số nào (không việc đến hạn, không quá hạn, không
--      chỉ đạo, không mục tiêu) thì không gửi — tránh tin rỗng hằng tuần cho đơn vị chưa dùng Vioo Work.
--   Thông báo dùng module / category 'work' (như tin Vioo Work khác; chỉ máy chủ ghi được — chặn bởi work_guard_notification /
--   task_notification_source_guard), work_delivery_id null (notifications_work_identity_check chỉ ràng buộc khi có work_delivery_id),
--   delivery_reason 'system' (như tin tổng hợp thông báo: luôn đến ngay, không bị dời sang tổng hợp cuối ngày).
-- Kỳ [from, to] theo ngày Asia/Ho_Chi_Minh, tính cả hai đầu (app_private.work_period_to của PR-5).

-- ── 1. Lõi số kỳ (không kiểm quyền) ─────────────────────────────────────────────────────────────────
create function app_private.work_period_digest(p_org_unit_id uuid, p_from date, p_to date,
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
      where t.status <> 'draft'
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
        and (p_org_unit_id is null or exists (select 1 from public.work_task_assignments a where a.task_id = t.id and a.ended_at is null
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
revoke all on function app_private.work_period_digest(uuid, date, date, date, date) from public, anon, authenticated;

-- ── 2. RPC màn báo cáo kỳ ───────────────────────────────────────────────────────────────────────────
create function public.work_period_digest_v1(p_org_unit_id uuid, p_from date, p_to date,
  p_prev_from date default null, p_prev_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*')
    or not app_private.work_can_manage_scope(v_actor, p_org_unit_id)
    or (p_org_unit_id is not null and not exists (select 1 from public.org_units ou where ou.id = p_org_unit_id)) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  return app_private.work_period_digest(p_org_unit_id, p_from, p_to, p_prev_from, p_prev_to);
end $$;
revoke all on function public.work_period_digest_v1(uuid, date, date, date, date) from public, anon, authenticated;
grant execute on function public.work_period_digest_v1(uuid, date, date, date, date) to authenticated;

-- ── 3. Bản tin theo lịch ────────────────────────────────────────────────────────────────────────────
create table app_private.work_digest_sends (
  scope_key text not null check (scope_key = 'company' or scope_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  period_from date not null,
  period_to date not null,
  sent_at timestamptz not null default now(),
  recipients integer not null default 0 check (recipients >= 0),
  primary key (scope_key, period_from, period_to),
  check (period_to >= period_from)
);
alter table app_private.work_digest_sends enable row level security;
revoke all on app_private.work_digest_sends from public, anon, authenticated;

-- Lần báo cáo gần nhất ≤ p_now theo lịch (giờ VN) và kỳ nó báo cáo.
--   week   : ngày report_dow gần nhất lúc report_time; kỳ = tuần T2–CN liền trước tuần chứa ngày đó. "Tuần 42 · 12–18/10".
--   2weeks : như week nhưng chỉ ở tuần ISO chẵn; kỳ = 2 tuần liền trước. "12/10 – 25/10".
--   month  : ngày report_dow đầu tiên của tháng lúc report_time; kỳ = tháng trước. "Tháng 9/2026".
create function app_private.work_digest_period(p_setting public.work_period_settings, p_now timestamptz)
returns table(due_at timestamptz, period_from date, period_to date, label text)
language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Ho_Chi_Minh';
  v_today date := (p_now at time zone 'Asia/Ho_Chi_Minh')::date;
  v_cadence text := coalesce(p_setting.cadence, 'week');
  v_dow integer := coalesce(p_setting.report_dow, 1);
  v_time time := coalesce(p_setting.report_time, '08:00'::time);
  v_day date; v_month date; v_ws date;
begin
  if p_now is null then return; end if;
  if v_cadence = 'month' then
    v_month := date_trunc('month', v_local)::date;
    v_day := v_month + (v_dow - extract(dow from v_month)::int + 7) % 7;
    if v_day + v_time > v_local then
      v_month := (v_month - interval '1 month')::date;
      v_day := v_month + (v_dow - extract(dow from v_month)::int + 7) % 7;
    end if;
    due_at := (v_day + v_time) at time zone 'Asia/Ho_Chi_Minh';
    period_from := (v_month - interval '1 month')::date;
    period_to := v_month - 1;
    label := 'Tháng ' || extract(month from period_from)::int || '/' || extract(year from period_from)::int;
    return next;
    return;
  end if;
  v_day := v_today - (extract(dow from v_today)::int - v_dow + 7) % 7;
  if v_day + v_time > v_local then v_day := v_day - 7; end if;
  if v_cadence = '2weeks' then
    -- Tuần ISO chẵn gần nhất (năm 53 tuần: 52 → 53 → 1 → 2 cách nhau 3 tuần).
    while extract(week from v_day)::int % 2 <> 0 loop v_day := v_day - 7; end loop;
  end if;
  v_ws := v_day - (extract(isodow from v_day)::int - 1);
  due_at := (v_day + v_time) at time zone 'Asia/Ho_Chi_Minh';
  if v_cadence = '2weeks' then
    period_from := v_ws - 14;
    period_to := v_ws - 1;
    label := to_char(period_from::timestamp, 'DD/MM') || ' – ' || to_char(period_to::timestamp, 'DD/MM');
  else
    period_from := v_ws - 7;
    period_to := v_ws - 1;
    label := 'Tuần ' || extract(week from period_from)::int || ' · ' || to_char(period_from::timestamp, 'DD') || '–' || to_char(period_to::timestamp, 'DD/MM');
  end if;
  return next;
end $$;
revoke all on function app_private.work_digest_period(public.work_period_settings, timestamptz) from public, anon, authenticated;

-- Gửi bản tin tới hạn. Trả số thông báo đã chèn. Cron 15 phút; lượt trước chưa xong thì bỏ qua.
create function app_private.work_send_digests(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (coalesce(p_now, now()) at time zone 'Asia/Ho_Chi_Minh')::date;
  v_company public.work_period_settings; v_setting public.work_period_settings;
  r record; p record; v_prev_from date; v_digest jsonb; v_link text; v_title text; v_msg text; v_n integer; v_count integer := 0;
begin
  if not coalesce((select s.enabled from app_private.work_notification_settings s where s.singleton), false) then return 0; end if;
  if not pg_try_advisory_xact_lock(hashtext('cron:work_period_digests')) then return 0; end if;

  select * into v_company from public.work_period_settings s where s.org_unit_id is null;
  if v_company.id is null then
    v_company.cadence := 'week'; v_company.report_dow := 1; v_company.report_time := '08:00';
  end if;

  for r in
    select null::uuid as unit_id, 'company'::text as scope_key, 'Toàn công ty'::text as scope_name, 0 as ord
    union all
    select ou.id, ou.id::text, ou.name, 1
    from public.org_units ou
    where coalesce(ou.is_active, true) and ou.manager_slot_id is not null
      and exists (select 1 from public.hrm_employee_slot_assignments sa join public.employees e on e.id = sa.employee_id
        where sa.slot_id = ou.manager_slot_id and sa.assignment_type in ('PRIMARY', 'ACTING') and sa.status = 'ACTIVE'
          and sa.effective_from <= v_today and (sa.effective_to is null or sa.effective_to >= v_today) and e.user_id is not null)
      and exists (select 1 from public.employees e where e.org_unit_id = ou.id and coalesce(e.status, '') <> 'Đã nghỉ việc')
    order by 4, 3
  loop
    begin
      -- Lịch hiệu lực: riêng → đơn vị cha gần nhất có cài → công ty.
      v_setting := null;
      if r.unit_id is not null then
        with recursive up as (
          select ou.id, ou.parent_id, 0 as depth from public.org_units ou where ou.id = r.unit_id
          union all
          select x.id, x.parent_id, up.depth + 1 from public.org_units x join up on x.id = up.parent_id where up.depth < 30
        ) select s.* into v_setting from up join public.work_period_settings s on s.org_unit_id = up.id order by up.depth limit 1;
      end if;
      if v_setting.id is null then v_setting := v_company; end if;

      select * into p from app_private.work_digest_period(v_setting, v_now);
      -- Chỉ trong 1 ngày kể từ giờ báo cáo: mới bật / lỡ lượt lâu thì không gửi bù kỳ cũ.
      if p.due_at is null or v_now < p.due_at or v_now >= p.due_at + interval '1 day' then continue; end if;
      insert into app_private.work_digest_sends(scope_key, period_from, period_to, recipients)
        values (r.scope_key, p.period_from, p.period_to, 0) on conflict do nothing;
      if not found then continue; end if;

      v_prev_from := case v_setting.cadence when 'month' then (p.period_from - interval '1 month')::date
        when '2weeks' then p.period_from - 14 else p.period_from - 7 end;
      v_digest := app_private.work_period_digest(r.unit_id, p.period_from, p.period_to, v_prev_from, p.period_from - 1);
      -- Kỳ không có số nào thì không gửi tin rỗng (vẫn ghi đã xử lý, 0 người nhận).
      if (v_digest->>'due')::int = 0 and (v_digest->>'overdue')::int = 0 and (v_digest->>'stale')::int = 0
        and (v_digest->'directives'->>'open')::int = 0 and (v_digest->'directives'->>'done')::int = 0
        and (v_digest->'goals'->>'total')::int = 0 then
        continue;
      end if;

      v_link := case when r.unit_id is null
        then '/work/my?space=company&from=' || p.period_from || '&to=' || p.period_to || '&report=1'
        else '/work/my?space=team&unit=' || r.unit_id || '&from=' || p.period_from || '&to=' || p.period_to || '&report=1' end;
      v_title := 'Bản tin ' || p.label || ' · ' || r.scope_name;
      v_msg := array_to_string(array(select jsonb_array_elements_text(v_digest->'lines')), E'\n');

      insert into public.notifications(user_id, type, category, module, title, message, body, severity, icon, link, action_url,
          source_type, source_id, entity_type, entity_id, priority, push_enabled, metadata, delivery_reason, delivery_mode)
        select x.user_id::text, 'info', 'work', 'work', v_title, v_msg, v_msg, 'info', '📊', v_link, '/#' || v_link,
          'work_digest', r.scope_key || ':' || p.period_from || ':' || p.period_to, 'work_digest', r.unit_id, 'normal', true,
          jsonb_build_object('eventType', 'work.period_digest', 'scope', r.scope_key, 'orgUnitId', r.unit_id,
            'from', p.period_from, 'to', p.period_to, 'label', p.label, 'closed', (v_digest->>'closed')::boolean),
          'system', 'instant'
        from (
          select u.id as user_id from public.users u
          where r.unit_id is null and u.is_active and u.account_status = 'ACTIVE'
            and app_private.has_permission(u.id, 'work.module.access', 'global', '*')
            and app_private.has_permission(u.id, 'work.task.view_scope', 'global', '*')
          union
          select u.id from public.org_units ou
          join public.hrm_employee_slot_assignments sa on sa.slot_id = ou.manager_slot_id
          join public.employees e on e.id = sa.employee_id
          join public.users u on u.id = e.user_id
          where r.unit_id is not null and ou.id = r.unit_id
            and sa.assignment_type in ('PRIMARY', 'ACTING') and sa.status = 'ACTIVE'
            and sa.effective_from <= v_today and (sa.effective_to is null or sa.effective_to >= v_today)
            and u.is_active and u.account_status = 'ACTIVE'
            and app_private.has_permission(u.id, 'work.module.access', 'global', '*')
        ) x;
      get diagnostics v_n = row_count;
      update app_private.work_digest_sends set recipients = v_n, sent_at = now()
        where scope_key = r.scope_key and period_from = p.period_from and period_to = p.period_to;
      v_count := v_count + v_n;
    exception when others then
      -- Một phạm vi lỗi không chặn phạm vi khác; dòng work_digest_sends cũng hoàn tác ⇒ lượt sau (còn trong cửa sổ) thử lại.
      raise warning 'work_send_digests %: % %', r.scope_key, sqlstate, sqlerrm;
    end;
  end loop;
  return v_count;
end $$;
revoke all on function app_private.work_send_digests(timestamptz) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'work-period-digests') then perform cron.unschedule('work-period-digests'); end if;
  perform cron.schedule('work-period-digests', '*/15 * * * *', 'select app_private.work_send_digests();');
end $$;

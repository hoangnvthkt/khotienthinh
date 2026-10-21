-- Vioo Work · Đợt 2 PR-6 (chủ SP duyệt 21/10/2026): chốt kỳ + mục tiêu tháng / quý + lịch chốt mặc định.
--   1) Lịch chốt: công ty một mức chung (mặc định tuần, chốt thứ 7 17:00, báo cáo thứ 2 08:00), đơn vị được đặt riêng;
--      đơn vị không cài thì theo đơn vị cha gần nhất có cài, không có thì theo công ty.
--   2) Chốt kỳ: trưởng đơn vị chốt đơn vị mình (gồm đơn vị con), BLĐ (work.task.view_scope global) chốt toàn công ty và chốt thay mọi đơn vị.
--      Lúc chốt lưu ảnh số liệu (bảng Phòng tôi / Toàn công ty + Sổ chỉ đạo + mục tiêu) — về sau không đổi.
--      Mở lại phải ghi lý do (≥ 5 ký tự); BLĐ thấy 50 lần mở lại gần nhất.
--   3) Mục tiêu tháng / quý: Tiêu chí (chỉ tiêu số) / Triển khai (việc gắn) / Đánh giá (máy tính % đạt + việc đúng hạn) / Giải pháp
--      (bắt buộc khi không đạt lúc chốt). Mục tiêu quý chia được ra 3 tháng.
--   4) Skill AI 'work_period_review': chỉ soạn nháp Đánh giá + Giải pháp; người chốt sửa rồi bấm Chốt.
-- Kỳ [from, to] theo ngày Asia/Ho_Chi_Minh, tính cả hai đầu (app_private.work_period_to của PR-5).
-- Xung đột phiên bản dùng errcode PT409 (không dùng 40001 — PostgREST lặp vô hạn).

-- ── 1. Bảng ─────────────────────────────────────────────────────────────────────────────────────────
create table public.work_period_settings (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid references public.org_units(id) on delete cascade,
  cadence text not null default 'week' check (cadence in ('week', '2weeks', 'month')),
  close_dow smallint not null default 6 check (close_dow between 0 and 6),
  close_time time not null default '17:00',
  report_dow smallint not null default 1 check (report_dow between 0 and 6),
  report_time time not null default '08:00',
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index work_period_settings_scope_key on public.work_period_settings ((coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)));
create index work_period_settings_unit_idx on public.work_period_settings(org_unit_id) where org_unit_id is not null;
create index work_period_settings_updated_by_idx on public.work_period_settings(updated_by) where updated_by is not null;
insert into public.work_period_settings(org_unit_id) values (null);

create table public.work_period_closes (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid references public.org_units(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  status text not null check (status in ('closed', 'reopened')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  note text check (note is null or char_length(note) <= 3000),
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  closed_by uuid not null references public.users(id) on delete restrict,
  closed_at timestamptz not null default now(),
  reopened_by uuid references public.users(id) on delete restrict,
  reopened_at timestamptz,
  reopen_reason text check (reopen_reason is null or char_length(reopen_reason) <= 1000),
  check (period_to >= period_from),
  check ((status = 'reopened') = (reopened_at is not null and reopened_by is not null and reopen_reason is not null))
);
create unique index work_period_closes_closed_key on public.work_period_closes
  ((coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)), period_from, period_to) where status = 'closed';
create index work_period_closes_scope_idx on public.work_period_closes
  ((coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)), period_from, period_to);
create index work_period_closes_unit_idx on public.work_period_closes(org_unit_id) where org_unit_id is not null;
create index work_period_closes_closed_by_idx on public.work_period_closes(closed_by);
create index work_period_closes_reopened_by_idx on public.work_period_closes(reopened_by) where reopened_by is not null;
create index work_period_closes_ai_run_idx on public.work_period_closes(ai_run_id) where ai_run_id is not null;

create table public.work_period_close_events (
  id uuid primary key default gen_random_uuid(),
  close_id uuid not null references public.work_period_closes(id) on delete cascade,
  action text not null check (action in ('close', 'reopen')),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  reason text check (reason is null or char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);
create index work_period_close_events_close_idx on public.work_period_close_events(close_id, created_at desc);
create index work_period_close_events_actor_idx on public.work_period_close_events(actor_user_id);
create index work_period_close_events_reopen_idx on public.work_period_close_events(created_at desc) where action = 'reopen';

create table public.work_goals (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid references public.org_units(id) on delete cascade,
  period_kind text not null check (period_kind in ('month', 'quarter')),
  period_start date not null check (extract(day from period_start) = 1
    and (period_kind = 'month' or extract(month from period_start)::int in (1, 4, 7, 10))),
  parent_goal_id uuid references public.work_goals(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 200),
  criteria text check (criteria is null or char_length(criteria) <= 1000),
  target_value numeric,
  unit text check (unit is null or char_length(unit) <= 20),
  higher_is_better boolean not null default true,
  actual_value numeric,
  owner_user_id uuid references public.users(id) on delete set null,
  assessment text check (assessment is null or char_length(assessment) <= 3000),
  solution text check (solution is null or char_length(solution) <= 3000),
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  lock_version integer not null default 1 check (lock_version > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (parent_goal_id is null or period_kind = 'month'),
  check (parent_goal_id is distinct from id)
);
create index work_goals_scope_idx on public.work_goals
  ((coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)), period_start) where deleted_at is null;
create index work_goals_unit_idx on public.work_goals(org_unit_id) where org_unit_id is not null;
create index work_goals_parent_idx on public.work_goals(parent_goal_id) where parent_goal_id is not null;
create index work_goals_owner_idx on public.work_goals(owner_user_id) where owner_user_id is not null;
create index work_goals_created_by_idx on public.work_goals(created_by);
create index work_goals_updated_by_idx on public.work_goals(updated_by) where updated_by is not null;
create index work_goals_ai_run_idx on public.work_goals(ai_run_id) where ai_run_id is not null;

create table public.work_goal_tasks (
  goal_id uuid not null references public.work_goals(id) on delete cascade,
  task_id uuid not null references public.work_tasks(id) on delete cascade,
  added_by uuid references public.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (goal_id, task_id)
);
create index work_goal_tasks_task_idx on public.work_goal_tasks(task_id);
create index work_goal_tasks_added_by_idx on public.work_goal_tasks(added_by) where added_by is not null;

alter table public.work_period_settings enable row level security;
alter table public.work_period_closes enable row level security;
alter table public.work_period_close_events enable row level security;
alter table public.work_goals enable row level security;
alter table public.work_goal_tasks enable row level security;
revoke all on public.work_period_settings, public.work_period_closes, public.work_period_close_events, public.work_goals, public.work_goal_tasks
  from public, anon, authenticated;

-- ── 2. Quyền theo phạm vi (đơn vị hoặc toàn công ty) ────────────────────────────────────────────────
-- Quản (chốt kỳ, đặt mục tiêu, đổi lịch): toàn công ty ⇒ BLĐ; đơn vị ⇒ BLĐ hoặc trưởng đơn vị đó / đơn vị cha.
create function app_private.work_can_manage_scope(p_actor uuid, p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_actor is not null and (app_private.has_permission(p_actor, 'work.task.view_scope', 'global', '*')
    or (p_unit is not null and p_unit in (select h from app_private.work_headed_units(p_actor) h)));
$$;

-- Xem: người quản; mục tiêu / kỳ toàn công ty thì mọi người có Vioo Work; đơn vị thì người thuộc đơn vị đó hoặc đơn vị con.
create function app_private.work_can_view_scope(p_actor uuid, p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_actor is not null and (p_unit is null or app_private.work_can_manage_scope(p_actor, p_unit) or exists (
    with recursive up as (
      select ou.id, ou.parent_id, 0 as depth from public.org_units ou where ou.id = app_private.work_user_org_unit(p_actor)
      union all
      select p.id, p.parent_id, up.depth + 1 from public.org_units p join up on p.id = up.parent_id where up.depth < 30
    ) select 1 from up where up.id = p_unit));
$$;

create function app_private.work_unit_json(p_unit uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) from public.org_units ou where ou.id = p_unit;
$$;

-- Lịch của đúng một phạm vi (không kế thừa); công ty chưa có dòng thì trả mặc định.
create function app_private.work_period_setting_json(p_unit uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('orgUnitId', s.org_unit_id, 'cadence', s.cadence, 'closeDow', s.close_dow, 'closeTime', to_char(s.close_time, 'HH24:MI'),
        'reportDow', s.report_dow, 'reportTime', to_char(s.report_time, 'HH24:MI'), 'updatedAt', s.updated_at,
        'updatedBy', (select u.name from public.users u where u.id = s.updated_by))
      from public.work_period_settings s
      where coalesce(s.org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_unit, '00000000-0000-0000-0000-000000000000'::uuid)),
    case when p_unit is null then jsonb_build_object('orgUnitId', null, 'cadence', 'week', 'closeDow', 6, 'closeTime', '17:00',
      'reportDow', 1, 'reportTime', '08:00', 'updatedAt', null, 'updatedBy', null) end);
$$;

create function app_private.work_goal_period_end(p_kind text, p_start date) returns date
language sql immutable set search_path = '' as $$
  select (p_start + case when p_kind = 'quarter' then interval '3 months' else interval '1 month' end)::date - 1;
$$;

-- Lịch sử chốt / mở lại của mọi bản chốt cùng phạm vi + đúng kỳ, mới nhất trước.
create function app_private.work_period_history_json(p_unit uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('closeId', e.close_id, 'action', e.action, 'at', e.created_at,
      'actor', (select u.name from public.users u where u.id = e.actor_user_id), 'reason', e.reason) order by e.created_at desc, e.action desc), '[]'::jsonb)
  from public.work_period_close_events e join public.work_period_closes c on c.id = e.close_id
  where coalesce(c.org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_unit, '00000000-0000-0000-0000-000000000000'::uuid)
    and c.period_from = p_from and c.period_to = p_to;
$$;

-- Một mục tiêu đã tính số (đếm việc không tính hủy / nháp; việc hạn chế vẫn được đếm).
create function app_private.work_goal_json(p_goal_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g public.work_goals%rowtype; v_end date; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_total integer; v_done integer; v_ontime integer; v_late integer; v_overdue integer; v_pct numeric; v_status text;
begin
  select * into g from public.work_goals where id = p_goal_id;
  if g.id is null then return null; end if;
  v_end := app_private.work_goal_period_end(g.period_kind, g.period_start);
  select count(*), count(*) filter (where t.status = 'completed'),
      count(*) filter (where t.status = 'completed' and t.deadline_at is not null and t.completed_at <= t.deadline_at),
      count(*) filter (where t.status = 'completed' and t.deadline_at is not null and t.completed_at > t.deadline_at),
      count(*) filter (where t.status <> 'completed' and t.deadline_at < now())
    into v_total, v_done, v_ontime, v_late, v_overdue
  from public.work_goal_tasks gt join public.work_tasks t on t.id = gt.task_id
  where gt.goal_id = g.id and t.status not in ('cancelled', 'draft');
  v_pct := case
    when g.target_value is null or g.actual_value is null then null
    when g.higher_is_better then case when g.target_value = 0 then null else round(g.actual_value / g.target_value * 100) end
    when g.actual_value <= 0 then 100
    else round(g.target_value / g.actual_value * 100) end;
  if v_end < v_today then
    v_status := case
      when v_pct is not null then case when v_pct >= 100 then 'met' else 'missed' end
      when v_total = 0 then 'unknown'
      when v_done = v_total and v_late = 0 then 'met'
      else 'missed' end;
  else
    v_status := case when v_overdue > 0 or v_late > 0 then 'at_risk' when v_pct >= 100 then 'met' else 'on_track' end;
  end if;
  return jsonb_build_object('id', g.id, 'orgUnitId', g.org_unit_id, 'unit', app_private.work_unit_json(g.org_unit_id),
    'periodKind', g.period_kind, 'periodStart', g.period_start, 'periodEnd', v_end,
    'label', case g.period_kind when 'quarter' then 'Quý ' || extract(quarter from g.period_start)::int
      else 'Tháng ' || extract(month from g.period_start)::int end || '/' || extract(year from g.period_start)::int,
    'parentGoalId', g.parent_goal_id, 'title', g.title, 'criteria', g.criteria, 'targetValue', g.target_value, 'measure', g.unit,
    'higherIsBetter', g.higher_is_better, 'actualValue', g.actual_value,
    'owner', (select jsonb_build_object('id', u.id, 'name', u.name) from public.users u where u.id = g.owner_user_id),
    'assessment', g.assessment, 'solution', g.solution, 'lockVersion', g.lock_version, 'updatedAt', g.updated_at,
    'tasks', jsonb_build_object('total', v_total, 'done', v_done, 'ontime', v_ontime, 'late', v_late, 'overdue', v_overdue),
    'achievedPercent', v_pct, 'status', v_status);
end $$;

revoke all on function app_private.work_can_manage_scope(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.work_can_view_scope(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.work_unit_json(uuid) from public, anon, authenticated;
revoke all on function app_private.work_period_setting_json(uuid) from public, anon, authenticated;
revoke all on function app_private.work_goal_period_end(text, date) from public, anon, authenticated;
revoke all on function app_private.work_period_history_json(uuid, date, date) from public, anon, authenticated;
revoke all on function app_private.work_goal_json(uuid) from public, anon, authenticated;

-- ── 3. Lịch chốt ────────────────────────────────────────────────────────────────────────────────────
create function public.work_period_settings_v1() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_global boolean;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  v_global := app_private.has_permission(v_actor, 'work.task.view_scope', 'global', '*');
  return jsonb_build_object(
    'company', app_private.work_period_setting_json(null),
    'overrides', coalesce((select jsonb_agg(app_private.work_period_setting_json(s.org_unit_id)
          || jsonb_build_object('unit', jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name)) order by ou.name)
        from public.work_period_settings s join public.org_units ou on ou.id = s.org_unit_id
        where v_global or s.org_unit_id in (select h from app_private.work_headed_units(v_actor) h)), '[]'::jsonb),
    'canEditCompany', v_global,
    'editableUnits', coalesce((select jsonb_agg(jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) order by ou.order_index nulls last, ou.name)
        from public.org_units ou
        where coalesce(ou.is_active, true) and case when v_global
          then exists (select 1 from public.employees e where e.org_unit_id = ou.id and coalesce(e.status, '') <> 'Đã nghỉ việc')
          else ou.id in (select h from app_private.work_direct_headed_units(v_actor) h) end), '[]'::jsonb),
    'reopens', case when not v_global then '[]'::jsonb else coalesce((select jsonb_agg(x.j order by x.at desc) from (
        select e.created_at as at, jsonb_build_object('closeId', c.id, 'at', e.created_at,
          'actor', (select u.name from public.users u where u.id = e.actor_user_id), 'reason', e.reason,
          'unit', app_private.work_unit_json(c.org_unit_id), 'from', c.period_from, 'to', c.period_to, 'label', c.label) as j
        from public.work_period_close_events e join public.work_period_closes c on c.id = e.close_id
        where e.action = 'reopen' order by e.created_at desc limit 50) x), '[]'::jsonb) end);
end $$;

create function public.work_period_settings_save_v1(p_org_unit_id uuid, p_cadence text, p_close_dow integer, p_close_time text,
  p_report_dow integer, p_report_time text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
  v_time constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if not app_private.work_can_manage_scope(v_actor, p_org_unit_id) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  if (p_org_unit_id is not null and not exists (select 1 from public.org_units ou where ou.id = p_org_unit_id))
    or p_cadence is null or p_cadence not in ('week', '2weeks', 'month')
    or p_close_dow is null or p_close_dow not between 0 and 6 or p_report_dow is null or p_report_dow not between 0 and 6
    or p_close_time is null or p_close_time !~ v_time or p_report_time is null or p_report_time !~ v_time then
    raise exception 'WORK_INVALID_SETTING' using errcode = '22023';
  end if;
  insert into public.work_period_settings(org_unit_id, cadence, close_dow, close_time, report_dow, report_time, updated_by, updated_at)
    values (p_org_unit_id, p_cadence, p_close_dow, p_close_time::time, p_report_dow, p_report_time::time, v_actor, now())
  on conflict ((coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set
    cadence = excluded.cadence, close_dow = excluded.close_dow, close_time = excluded.close_time,
    report_dow = excluded.report_dow, report_time = excluded.report_time, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return app_private.work_period_setting_json(p_org_unit_id);
end $$;

-- Bỏ lịch riêng của đơn vị ⇒ theo đơn vị cha / công ty. Trả lịch công ty.
create function public.work_period_settings_reset_v1(p_org_unit_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if p_org_unit_id is null then raise exception 'WORK_INVALID_SETTING' using errcode = '22023'; end if;
  if not app_private.work_can_manage_scope(v_actor, p_org_unit_id) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  delete from public.work_period_settings where org_unit_id = p_org_unit_id;
  return app_private.work_period_setting_json(null);
end $$;

-- ── 4. Trạng thái kỳ ────────────────────────────────────────────────────────────────────────────────
create function public.work_period_status_v1(p_org_unit_id uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_to date; v_setting uuid; v_depth integer; v_close public.work_period_closes%rowtype;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if not app_private.work_can_view_scope(v_actor, p_org_unit_id) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  v_to := app_private.work_period_to(p_from, p_to);
  if p_org_unit_id is not null then
    with recursive up as (
      select ou.id, ou.parent_id, 0 as depth from public.org_units ou where ou.id = p_org_unit_id
      union all
      select p.id, p.parent_id, up.depth + 1 from public.org_units p join up on p.id = up.parent_id where up.depth < 30
    ) select up.id, up.depth into v_setting, v_depth
      from up join public.work_period_settings s on s.org_unit_id = up.id order by up.depth limit 1;
  end if;
  if p_from is not null then
    select * into v_close from public.work_period_closes c
      where coalesce(c.org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and c.period_from = p_from and c.period_to = v_to and c.status = 'closed';
  end if;
  return jsonb_build_object('orgUnitId', p_org_unit_id,
    'setting', app_private.work_period_setting_json(v_setting),
    'settingSource', case when v_setting is null then 'company' when v_depth = 0 then 'unit' else 'parent' end,
    'canClose', app_private.work_can_manage_scope(v_actor, p_org_unit_id),
    'close', case when v_close.id is null then null else jsonb_build_object('id', v_close.id, 'from', v_close.period_from, 'to', v_close.period_to,
      'label', v_close.label, 'note', v_close.note, 'closedAt', v_close.closed_at,
      'closedBy', (select u.name from public.users u where u.id = v_close.closed_by)) end,
    'history', case when p_from is null then '[]'::jsonb else app_private.work_period_history_json(p_org_unit_id, p_from, v_to) end);
end $$;

-- ── 5. Mục tiêu ─────────────────────────────────────────────────────────────────────────────────────
-- Mục tiêu đúng phạm vi (không gộp đơn vị con), kỳ của mục tiêu giao với [from, to].
create function public.work_goals_v1(p_org_unit_id uuid, p_from date, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_to date;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if not app_private.work_can_view_scope(v_actor, p_org_unit_id) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  if p_from is null then raise exception 'WORK_INVALID_PERIOD' using errcode = '22023'; end if;
  v_to := app_private.work_period_to(p_from, p_to);
  return jsonb_build_object('canEdit', app_private.work_can_manage_scope(v_actor, p_org_unit_id),
    'goals', coalesce((select jsonb_agg(app_private.work_goal_json(g.id)
        order by (g.period_kind = 'quarter') desc, g.period_start, g.created_at, g.id)
      from public.work_goals g
      where g.deleted_at is null
        and coalesce(g.org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and g.period_start <= v_to and app_private.work_goal_period_end(g.period_kind, g.period_start) >= p_from), '[]'::jsonb));
end $$;

create function public.work_goal_save_v1(p_goal jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_allowed constant text[] := array['id', 'orgUnitId', 'periodKind', 'periodStart', 'parentGoalId', 'title', 'criteria', 'targetValue',
    'measure', 'higherIsBetter', 'actualValue', 'ownerUserId', 'assessment', 'solution', 'expectedLockVersion'];
  g public.work_goals%rowtype; p public.work_goals%rowtype;
  v_id uuid; v_unit uuid; v_kind text; v_start date; v_parent uuid; v_owner uuid;
  v_title text; v_criteria text; v_target numeric; v_measure text; v_hib boolean; v_actual numeric; v_assess text; v_sol text;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if jsonb_typeof(p_goal) is distinct from 'object' or p_goal - v_allowed <> '{}'::jsonb or octet_length(p_goal::text) > 20000
    or exists (select 1 from unnest(array['id', 'orgUnitId', 'periodKind', 'periodStart', 'parentGoalId', 'title', 'criteria', 'measure',
        'ownerUserId', 'assessment', 'solution']) k where p_goal ? k and jsonb_typeof(p_goal->k) not in ('string', 'null'))
    or exists (select 1 from unnest(array['targetValue', 'actualValue', 'expectedLockVersion']) k
        where p_goal ? k and jsonb_typeof(p_goal->k) not in ('number', 'null'))
    or (p_goal ? 'higherIsBetter' and jsonb_typeof(p_goal->'higherIsBetter') not in ('boolean', 'null')) then
    raise exception 'WORK_GOAL_INVALID' using errcode = '22023';
  end if;
  begin
    v_id := nullif(btrim(p_goal->>'id'), '')::uuid;
    v_unit := nullif(btrim(p_goal->>'orgUnitId'), '')::uuid;
    v_parent := nullif(btrim(p_goal->>'parentGoalId'), '')::uuid;
    v_owner := nullif(btrim(p_goal->>'ownerUserId'), '')::uuid;
    v_start := nullif(btrim(p_goal->>'periodStart'), '')::date;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'WORK_GOAL_INVALID' using errcode = '22023';
  end;

  if v_id is null then
    if not app_private.work_can_manage_scope(v_actor, v_unit) then
      raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
    end if;
    v_kind := p_goal->>'periodKind';
    if (v_unit is not null and not exists (select 1 from public.org_units ou where ou.id = v_unit))
      or v_kind is null or v_kind not in ('month', 'quarter') or v_start is null or extract(day from v_start) <> 1
      or (v_kind = 'quarter' and extract(month from v_start)::int not in (1, 4, 7, 10))
      or (v_parent is not null and v_kind <> 'month') then
      raise exception 'WORK_GOAL_INVALID' using errcode = '22023';
    end if;
    if v_parent is not null then
      select * into p from public.work_goals x where x.id = v_parent and x.deleted_at is null and x.period_kind = 'quarter'
        and x.org_unit_id is not distinct from v_unit and v_start between x.period_start and (x.period_start + interval '2 months')::date;
      if p.id is null then raise exception 'WORK_GOAL_INVALID' using errcode = '22023'; end if;
    end if;
    v_title := btrim(coalesce(p_goal->>'title', ''));
    v_criteria := nullif(btrim(coalesce(p_goal->>'criteria', '')), '');
    v_target := (p_goal->>'targetValue')::numeric;
    v_measure := nullif(btrim(coalesce(p_goal->>'measure', '')), '');
    v_hib := coalesce((p_goal->>'higherIsBetter')::boolean, true);
    v_actual := (p_goal->>'actualValue')::numeric;
    v_assess := nullif(btrim(coalesce(p_goal->>'assessment', '')), '');
    v_sol := nullif(btrim(coalesce(p_goal->>'solution', '')), '');
  else
    select * into g from public.work_goals x where x.id = v_id and x.deleted_at is null for update;
    if g.id is null then raise exception 'WORK_GOAL_INVALID' using errcode = '22023'; end if;
    if not app_private.work_can_manage_scope(v_actor, g.org_unit_id) then
      raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
    end if;
    if jsonb_typeof(p_goal->'expectedLockVersion') is distinct from 'number' then
      raise exception 'WORK_GOAL_INVALID' using errcode = '22023';
    end if;
    if (p_goal->>'expectedLockVersion')::numeric <> g.lock_version then
      raise exception using errcode = 'PT409', message = 'WORK_VERSION_CONFLICT';
    end if;
    -- Phạm vi, kỳ, mục tiêu cha không đổi khi sửa. Khóa có gửi thì ghi, không gửi thì giữ.
    v_title := case when p_goal ? 'title' then btrim(coalesce(p_goal->>'title', '')) else g.title end;
    v_criteria := case when p_goal ? 'criteria' then nullif(btrim(coalesce(p_goal->>'criteria', '')), '') else g.criteria end;
    v_target := case when p_goal ? 'targetValue' then (p_goal->>'targetValue')::numeric else g.target_value end;
    v_measure := case when p_goal ? 'measure' then nullif(btrim(coalesce(p_goal->>'measure', '')), '') else g.unit end;
    v_hib := case when p_goal ? 'higherIsBetter' then coalesce((p_goal->>'higherIsBetter')::boolean, true) else g.higher_is_better end;
    v_actual := case when p_goal ? 'actualValue' then (p_goal->>'actualValue')::numeric else g.actual_value end;
    v_assess := case when p_goal ? 'assessment' then nullif(btrim(coalesce(p_goal->>'assessment', '')), '') else g.assessment end;
    v_sol := case when p_goal ? 'solution' then nullif(btrim(coalesce(p_goal->>'solution', '')), '') else g.solution end;
    v_owner := case when p_goal ? 'ownerUserId' then v_owner else g.owner_user_id end;
  end if;

  if char_length(v_title) not between 3 and 200 or char_length(v_criteria) > 1000 or char_length(v_measure) > 20
    or char_length(v_assess) > 3000 or char_length(v_sol) > 3000
    or abs(v_target) >= 1e15 or abs(v_actual) >= 1e15
    or (v_owner is not null and not exists (select 1 from public.users u where u.id = v_owner and u.is_active and u.account_status = 'ACTIVE'
      and app_private.has_permission(u.id, 'work.module.access', 'global', '*'))) then
    raise exception 'WORK_GOAL_INVALID' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.work_goals(org_unit_id, period_kind, period_start, parent_goal_id, title, criteria, target_value, unit, higher_is_better,
        actual_value, owner_user_id, assessment, solution, created_by, updated_by)
      values (v_unit, v_kind, v_start, v_parent, v_title, v_criteria, v_target, v_measure, v_hib, v_actual, v_owner, v_assess, v_sol, v_actor, v_actor)
      returning id into v_id;
  else
    update public.work_goals set title = v_title, criteria = v_criteria, target_value = v_target, unit = v_measure, higher_is_better = v_hib,
        actual_value = v_actual, owner_user_id = v_owner, assessment = v_assess, solution = v_sol,
        lock_version = lock_version + 1, updated_by = v_actor, updated_at = now()
      where id = v_id;
  end if;
  return app_private.work_goal_json(v_id);
end $$;

-- Mục tiêu quý ⇒ mục tiêu tháng con cho các tháng chưa có. Chỉ tiêu chia 3 (2 số lẻ), trừ đơn vị '%' giữ nguyên.
create function public.work_goal_split_v1(p_goal_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); g public.work_goals%rowtype;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select * into g from public.work_goals x where x.id = p_goal_id and x.deleted_at is null for update;
  if g.id is null then raise exception 'WORK_GOAL_INVALID' using errcode = '22023'; end if;
  if not app_private.work_can_manage_scope(v_actor, g.org_unit_id) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  if g.period_kind <> 'quarter' then raise exception 'WORK_GOAL_INVALID' using errcode = '22023'; end if;
  insert into public.work_goals(org_unit_id, period_kind, period_start, parent_goal_id, title, criteria, target_value, unit, higher_is_better,
      owner_user_id, created_by, updated_by)
    select g.org_unit_id, 'month', m.d, g.id, g.title, g.criteria,
      case when g.target_value is null or g.unit = '%' then g.target_value else trim_scale(round(g.target_value / 3, 2)) end,
      g.unit, g.higher_is_better, g.owner_user_id, v_actor, v_actor
    from (select (g.period_start + make_interval(months => i))::date as d from generate_series(0, 2) i) m
    where not exists (select 1 from public.work_goals c where c.parent_goal_id = g.id and c.deleted_at is null and c.period_start = m.d)
    order by m.d;
  return jsonb_build_object('goals', coalesce((select jsonb_agg(app_private.work_goal_json(c.id) order by c.period_start, c.created_at, c.id)
    from public.work_goals c where c.parent_goal_id = g.id and c.deleted_at is null), '[]'::jsonb));
end $$;

create function public.work_goal_delete_v1(p_goal_id uuid, p_expected_lock_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); g public.work_goals%rowtype;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select * into g from public.work_goals x where x.id = p_goal_id and x.deleted_at is null for update;
  if g.id is null then raise exception 'WORK_GOAL_INVALID' using errcode = '22023'; end if;
  if not app_private.work_can_manage_scope(v_actor, g.org_unit_id) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  if p_expected_lock_version is distinct from g.lock_version then
    raise exception using errcode = 'PT409', message = 'WORK_VERSION_CONFLICT';
  end if;
  update public.work_goals set deleted_at = now(), lock_version = lock_version + 1, updated_by = v_actor, updated_at = now()
    where deleted_at is null and (id = g.id or parent_goal_id = g.id);
  return jsonb_build_object('id', g.id);
end $$;

-- Gắn / bỏ việc của mục tiêu (Triển khai). Việc thêm phải xem được và không phải nháp; tối đa 200 việc.
create function public.work_goal_tasks_set_v1(p_goal_id uuid, p_add uuid[] default null, p_remove uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); g public.work_goals%rowtype; v_total integer;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select * into g from public.work_goals x where x.id = p_goal_id and x.deleted_at is null for update;
  if g.id is null then raise exception 'WORK_GOAL_INVALID' using errcode = '22023'; end if;
  if not app_private.work_can_manage_scope(v_actor, g.org_unit_id) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_add), 0) > 200 or coalesce(cardinality(p_remove), 0) > 500
    or exists (select 1 from unnest(coalesce(p_add, '{}'::uuid[])) a(id) left join public.work_tasks t on t.id = a.id
      where t.id is null or t.status = 'draft' or not app_private.work_task_actor_can_view(t.id)) then
    raise exception 'WORK_GOAL_INVALID' using errcode = '22023';
  end if;
  delete from public.work_goal_tasks where goal_id = g.id and task_id = any(coalesce(p_remove, '{}'::uuid[]));
  insert into public.work_goal_tasks(goal_id, task_id, added_by)
    select distinct g.id, a.id, v_actor from unnest(coalesce(p_add, '{}'::uuid[])) a(id)
  on conflict (goal_id, task_id) do nothing;
  select count(*) into v_total from public.work_goal_tasks where goal_id = g.id;
  if v_total > 200 then raise exception 'WORK_GOAL_INVALID' using errcode = '22023'; end if;
  update public.work_goals set updated_at = now(), updated_by = v_actor where id = g.id;
  return jsonb_build_object('total', v_total);
end $$;

create function public.work_goal_tasks_v1(p_goal_id uuid) returns jsonb
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
          from public.work_task_assignments a join public.users u on u.id = a.user_id where a.task_id = y.id and a.ended_at is null), '[]'::jsonb) end,
        'restricted', not y.can_view) order by y.deadline_at nulls last, y.created_at, y.id)
      from (select t.*, app_private.work_task_actor_can_view(t.id) as can_view
        from public.work_goal_tasks gt join public.work_tasks t on t.id = gt.task_id
        where gt.goal_id = g.id and t.status <> 'draft') y), '[]'::jsonb));
end $$;

-- ── 6. Chốt kỳ / mở lại / xem bản chốt ──────────────────────────────────────────────────────────────
create function public.work_period_close_v1(p_org_unit_id uuid, p_from date, p_to date, p_prev_from date default null, p_prev_to date default null,
  p_label text default null, p_note text default null, p_goal_reviews jsonb default null, p_ai_run_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_to date; v_qt date; v_stats_to date; v_label text; v_note text; r jsonb; v_gid uuid; v_goal uuid;
  v_goals jsonb; v_board jsonb; v_snapshot jsonb; v_id uuid; v_at timestamptz := now();
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if not app_private.work_can_manage_scope(v_actor, p_org_unit_id)
    or (p_org_unit_id is not null and not exists (select 1 from public.org_units ou where ou.id = p_org_unit_id)) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  if p_from is null or p_from > v_today then raise exception 'WORK_INVALID_PERIOD' using errcode = '22023'; end if;
  v_to := app_private.work_period_to(p_from, p_to);
  v_qt := app_private.work_period_to(p_prev_from, p_prev_to);
  v_label := coalesce(nullif(btrim(coalesce(p_label, '')), ''), to_char(p_from, 'DD/MM') || ' – ' || to_char(v_to, 'DD/MM/YYYY'));
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if char_length(v_label) > 80 or char_length(v_note) > 3000 then
    raise exception 'WORK_INVALID_PERIOD' using errcode = '22023';
  end if;
  if p_ai_run_id is not null and not exists (select 1 from public.ai_runs x where x.id = p_ai_run_id and x.user_id = v_actor) then
    raise exception 'WORK_AI_RUN_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('work_period_close:' || coalesce(p_org_unit_id, v_zero)::text || ':' || p_from || ':' || v_to, 0));
  if exists (select 1 from public.work_period_closes c where coalesce(c.org_unit_id, v_zero) = coalesce(p_org_unit_id, v_zero)
      and c.period_from = p_from and c.period_to = v_to and c.status = 'closed') then
    raise exception 'WORK_PERIOD_ALREADY_CLOSED' using errcode = '22023';
  end if;

  -- Đánh giá từng mục tiêu (số thực tế, đánh giá, giải pháp) ghi vào mục tiêu trước khi chụp số.
  if p_goal_reviews is not null and jsonb_typeof(p_goal_reviews) <> 'null' then
    if jsonb_typeof(p_goal_reviews) <> 'array' or jsonb_array_length(p_goal_reviews) > 100 then
      raise exception 'WORK_GOAL_INVALID' using errcode = '22023';
    end if;
    for r in select x from jsonb_array_elements(p_goal_reviews) x loop
      if jsonb_typeof(r) <> 'object' or r - array['goalId', 'actualValue', 'assessment', 'solution'] <> '{}'::jsonb
        or jsonb_typeof(r->'goalId') is distinct from 'string'
        or (r ? 'actualValue' and jsonb_typeof(r->'actualValue') not in ('number', 'null'))
        or (r ? 'assessment' and jsonb_typeof(r->'assessment') not in ('string', 'null'))
        or (r ? 'solution' and jsonb_typeof(r->'solution') not in ('string', 'null'))
        or char_length(btrim(r->>'assessment')) > 3000 or char_length(btrim(r->>'solution')) > 3000
        or abs((r->>'actualValue')::numeric) >= 1e15 then
        raise exception 'WORK_GOAL_INVALID' using errcode = '22023';
      end if;
      begin
        v_gid := (r->>'goalId')::uuid;
      exception when invalid_text_representation then
        raise exception 'WORK_GOAL_INVALID' using errcode = '22023';
      end;
      select x.id into v_goal from public.work_goals x
        where x.id = v_gid and x.deleted_at is null and x.org_unit_id is not distinct from p_org_unit_id
          and x.period_start <= v_to and app_private.work_goal_period_end(x.period_kind, x.period_start) >= p_from
        for update;
      if v_goal is null then raise exception 'WORK_GOAL_INVALID' using errcode = '22023'; end if;
      update public.work_goals set
          actual_value = case when r ? 'actualValue' then (r->>'actualValue')::numeric else actual_value end,
          assessment = case when r ? 'assessment' then nullif(btrim(coalesce(r->>'assessment', '')), '') else assessment end,
          solution = case when r ? 'solution' then nullif(btrim(coalesce(r->>'solution', '')), '') else solution end,
          ai_run_id = coalesce(p_ai_run_id, ai_run_id),
          lock_version = lock_version + 1, updated_by = v_actor, updated_at = now()
        where id = v_goal;
    end loop;
  end if;

  v_goals := public.work_goals_v1(p_org_unit_id, p_from, v_to)->'goals';
  if exists (select 1 from jsonb_array_elements(v_goals) x
      where x->>'status' = 'missed' and nullif(btrim(coalesce(x->>'solution', '')), '') is null) then
    raise exception 'WORK_GOAL_SOLUTION_REQUIRED' using errcode = '22023';
  end if;

  -- Bản chốt lưu trọn kỳ [from, to]; số bảng chỉ tính tới hôm nay (việc chưa đến hạn không kéo tỷ lệ đúng hạn xuống).
  v_stats_to := least(v_to, v_today);
  v_board := case when p_org_unit_id is null
    then public.work_company_board_v1(null, p_from, v_stats_to, p_prev_from, v_qt)
    else public.work_team_board_v1(p_org_unit_id, null, p_from, v_stats_to, p_prev_from, v_qt) end;
  v_snapshot := jsonb_build_object('version', 1,
    'scope', jsonb_build_object('orgUnitId', p_org_unit_id,
      'code', (select ou.code from public.org_units ou where ou.id = p_org_unit_id),
      'name', coalesce((select ou.name from public.org_units ou where ou.id = p_org_unit_id), 'Toàn công ty')),
    'from', p_from, 'to', v_to, 'label', v_label, 'prevFrom', p_prev_from, 'prevTo', v_qt,
    'statsTo', v_stats_to, 'board', v_board,
    'directives', public.work_directives_v1(p_org_unit_id, p_from, v_to),
    'goals', v_goals,
    'note', v_note, 'closedAt', v_at,
    'closedBy', (select jsonb_build_object('id', u.id, 'name', u.name) from public.users u where u.id = v_actor));

  begin
    insert into public.work_period_closes(org_unit_id, period_from, period_to, label, status, snapshot, note, ai_run_id, closed_by, closed_at)
      values (p_org_unit_id, p_from, v_to, v_label, 'closed', v_snapshot, v_note, p_ai_run_id, v_actor, v_at)
      returning id into v_id;
  exception when unique_violation then
    raise exception 'WORK_PERIOD_ALREADY_CLOSED' using errcode = '22023';
  end;
  insert into public.work_period_close_events(close_id, action, actor_user_id, created_at) values (v_id, 'close', v_actor, clock_timestamp());
  if p_ai_run_id is not null then
    update public.ai_runs set accepted = true, feedback_at = now() where id = p_ai_run_id and user_id = v_actor and accepted is null;
  end if;
  return jsonb_build_object('closeId', v_id, 'closedAt', v_at);
end $$;

create function public.work_period_reopen_v1(p_close_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); c public.work_period_closes%rowtype; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select * into c from public.work_period_closes x where x.id = p_close_id for update;
  if c.id is null then raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501'; end if;
  if not app_private.work_can_manage_scope(v_actor, c.org_unit_id) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  if c.status <> 'closed' then raise exception 'WORK_PERIOD_NOT_CLOSED' using errcode = '22023'; end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 1000 then
    raise exception 'WORK_REOPEN_REASON_REQUIRED' using errcode = '22023';
  end if;
  update public.work_period_closes set status = 'reopened', reopened_by = v_actor, reopened_at = now(), reopen_reason = v_reason where id = c.id;
  insert into public.work_period_close_events(close_id, action, actor_user_id, reason, created_at) values (c.id, 'reopen', v_actor, v_reason, clock_timestamp());
  return jsonb_build_object('closeId', c.id, 'status', 'reopened');
end $$;

create function public.work_period_close_get_v1(p_close_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); c public.work_period_closes%rowtype;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select * into c from public.work_period_closes x where x.id = p_close_id;
  if c.id is null or not app_private.work_can_manage_scope(v_actor, c.org_unit_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  return jsonb_build_object('id', c.id, 'orgUnitId', c.org_unit_id, 'from', c.period_from, 'to', c.period_to, 'label', c.label,
    'status', c.status, 'note', c.note, 'closedAt', c.closed_at,
    'closedBy', (select u.name from public.users u where u.id = c.closed_by),
    'reopenedAt', c.reopened_at, 'reopenedBy', (select u.name from public.users u where u.id = c.reopened_by), 'reopenReason', c.reopen_reason,
    'snapshot', c.snapshot,
    'history', app_private.work_period_history_json(c.org_unit_id, c.period_from, c.period_to));
end $$;

revoke all on function public.work_period_settings_v1() from public, anon, authenticated;
revoke all on function public.work_period_settings_save_v1(uuid, text, integer, text, integer, text) from public, anon, authenticated;
revoke all on function public.work_period_settings_reset_v1(uuid) from public, anon, authenticated;
revoke all on function public.work_period_status_v1(uuid, date, date) from public, anon, authenticated;
revoke all on function public.work_period_close_v1(uuid, date, date, date, date, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.work_period_reopen_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.work_period_close_get_v1(uuid) from public, anon, authenticated;
revoke all on function public.work_goals_v1(uuid, date, date) from public, anon, authenticated;
revoke all on function public.work_goal_save_v1(jsonb) from public, anon, authenticated;
revoke all on function public.work_goal_split_v1(uuid) from public, anon, authenticated;
revoke all on function public.work_goal_delete_v1(uuid, integer) from public, anon, authenticated;
revoke all on function public.work_goal_tasks_set_v1(uuid, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.work_goal_tasks_v1(uuid) from public, anon, authenticated;
grant execute on function public.work_period_settings_v1() to authenticated;
grant execute on function public.work_period_settings_save_v1(uuid, text, integer, text, integer, text) to authenticated;
grant execute on function public.work_period_settings_reset_v1(uuid) to authenticated;
grant execute on function public.work_period_status_v1(uuid, date, date) to authenticated;
grant execute on function public.work_period_close_v1(uuid, date, date, date, date, text, text, jsonb, uuid) to authenticated;
grant execute on function public.work_period_reopen_v1(uuid, text) to authenticated;
grant execute on function public.work_period_close_get_v1(uuid) to authenticated;
grant execute on function public.work_goals_v1(uuid, date, date) to authenticated;
grant execute on function public.work_goal_save_v1(jsonb) to authenticated;
grant execute on function public.work_goal_split_v1(uuid) to authenticated;
grant execute on function public.work_goal_delete_v1(uuid, integer) to authenticated;
grant execute on function public.work_goal_tasks_set_v1(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.work_goal_tasks_v1(uuid) to authenticated;

-- ── 7. Skill AI soạn đánh giá kỳ ────────────────────────────────────────────────────────────────────
insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class, required_permission, quota_group) values
  ('work_period_review', 'Soạn đánh giá kỳ',
   'Vioo Work: từ số liệu kỳ + mục tiêu → nháp Đánh giá + Giải pháp từng mục tiêu và nhận xét kỳ; người chốt sửa rồi bấm Chốt.',
   'base', 'draft', true, 20, 'fast', 'work.module.access', 'work')
on conflict (code) do update set name = excluded.name, description = excluded.description, tier = excluded.tier, mode = excluded.mode,
  enabled = excluded.enabled, daily_limit = excluded.daily_limit, model_class = excluded.model_class,
  required_permission = excluded.required_permission, quota_group = excluded.quota_group, updated_at = now();

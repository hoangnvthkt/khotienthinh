-- Kế hoạch tháng / tuần theo công việc của bảng tiến độ (Đợt 1 vòng khép kín
-- Module Dự án, chủ sản phẩm duyệt 30/09/2026).
--
-- One plan = one calendar month or one Monday–Sunday week of one project/site.
-- Lines are leaf tasks with a planned quantity for the period. Actual work in
-- the period is never stored here: it is read from project_daily_task_progress
-- (Nhật ký / Chốt tiến độ), so plan and actual cannot drift.
-- Room "work_plan": edit/submit to write, verify approves week plans (CHT),
-- approve approves month plans (GĐ dự án). Writes go through RPCs only.

-- 1. Permission catalog: module, actions, Room, enforced bindings.
insert into public.permission_modules (application_code, code, name, description, routes, legacy_module_key, sort_order, is_active)
values ('project', 'project.work_plan', 'Kế hoạch tháng/tuần', 'Lập và duyệt kế hoạch tháng, kế hoạch tuần theo công việc của bảng tiến độ.',
  array['/da/tabs/work_plan']::text[], 'DA', 105, true)
on conflict (code) do update set name = excluded.name, description = excluded.description,
  routes = excluded.routes, sort_order = excluded.sort_order, is_active = true, updated_at = now();

insert into public.permission_actions (module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order, is_active, risk_level, is_business_action,
  is_business_approval, direct_grant_requires_expiry, grant_readiness, access_application_code)
select 'project.work_plan', a.action, 'project.work_plan.' || a.action, a.label, a.description,
  array['global', 'project', 'construction_site']::text[], 'DA', '/da/tabs/work_plan', a.action <> 'view',
  a.sort_order, true, a.risk_level, true, a.is_approval, a.is_approval, 'declared', 'project'
from (values
  ('view', 'Xem', 'Xem kế hoạch tháng/tuần của dự án.', 10, 'normal', false),
  ('edit', 'Lập/sửa kế hoạch', 'Lập và sửa kế hoạch nháp hoặc bị trả lại.', 20, 'normal', false),
  ('delete', 'Xóa bản nháp', 'Xóa kế hoạch nháp chưa gửi duyệt.', 30, 'normal', false),
  ('submit', 'Gửi duyệt', 'Gửi kế hoạch để duyệt.', 40, 'normal', false),
  ('verify', 'Duyệt KH tuần', 'Duyệt hoặc trả lại kế hoạch tuần.', 50, 'sensitive', true),
  ('approve', 'Duyệt KH tháng', 'Duyệt hoặc trả lại kế hoạch tháng.', 60, 'sensitive', true)
) a(action, label, description, sort_order, risk_level, is_approval)
on conflict (permission_code) do update set label = excluded.label, description = excluded.description,
  sort_order = excluded.sort_order, risk_level = excluded.risk_level, is_business_approval = excluded.is_business_approval,
  direct_grant_requires_expiry = excluded.direct_grant_requires_expiry, is_active = true, updated_at = now();

insert into public.project_permission_rooms (code, group_code, name, description, allowed_actions, required_actions, sort_order)
values ('work_plan', 'progress', 'Kế hoạch tháng/tuần', 'Lập, gửi duyệt và duyệt kế hoạch tháng, kế hoạch tuần.',
  array['view', 'edit', 'delete', 'submit', 'verify', 'approve']::text[], array[]::text[], 75)
on conflict (code) do update set name = excluded.name, description = excluded.description,
  allowed_actions = excluded.allowed_actions, sort_order = excluded.sort_order, updated_at = now();

insert into app_private.project_permission_room_action_bindings (room_code, action_code, legacy_permission_codes,
  enforcement_status, relationship_description, pbac_fallback_enabled, prerequisite_action_codes, verified_at,
  verified_source, created_at, updated_at)
select 'work_plan', a.action, array['project.work_plan.' || a.action]::text[], 'enforced', a.description, false,
  case when a.action = 'view' then array[]::text[] else array['view']::text[] end, now(),
  'project_work_plans_2026_09_30', now(), now()
from (values
  ('view', 'Xem kế hoạch tháng/tuần.'),
  ('edit', 'Lập và sửa kế hoạch.'),
  ('delete', 'Xóa kế hoạch nháp.'),
  ('submit', 'Gửi kế hoạch để duyệt.'),
  ('verify', 'CHT duyệt kế hoạch tuần.'),
  ('approve', 'GĐ dự án duyệt kế hoạch tháng.')
) a(action, description)
on conflict (room_code, action_code) do update set legacy_permission_codes = excluded.legacy_permission_codes,
  enforcement_status = 'enforced', relationship_description = excluded.relationship_description,
  pbac_fallback_enabled = false, prerequisite_action_codes = excluded.prerequisite_action_codes,
  verified_at = now(), verified_source = excluded.verified_source, updated_at = now();

-- 2. Tables.
create table public.project_work_plans (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id),
  construction_site_id text,
  period_type text not null check (period_type in ('month', 'week')),
  period_start date not null,
  period_end date not null,
  code text not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'returned', 'approved', 'superseded', 'cancelled')),
  revision_no integer not null default 1 check (revision_no > 0),
  supersedes_plan_id uuid references public.project_work_plans(id),
  note text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  submitted_by uuid references public.users(id),
  submitted_at timestamptz,
  submitted_to_user_id uuid references public.users(id),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  returned_by uuid references public.users(id),
  returned_at timestamptz,
  return_reason text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1 check (row_version > 0),
  check (
    (period_type = 'month' and period_start = date_trunc('month', period_start)::date
      and period_end = (date_trunc('month', period_start) + interval '1 month - 1 day')::date)
    or (period_type = 'week' and extract(isodow from period_start) = 1 and period_end = period_start + 6)
  ),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  check (status <> 'returned' or nullif(btrim(return_reason), '') is not null)
);
-- At most one open (being written/reviewed) and one approved plan per period.
create unique index project_work_plans_one_open on public.project_work_plans
  (project_id, coalesce(construction_site_id, ''), period_type, period_start)
  where status in ('draft', 'submitted', 'returned');
create unique index project_work_plans_one_approved on public.project_work_plans
  (project_id, coalesce(construction_site_id, ''), period_type, period_start)
  where status = 'approved';
create index project_work_plans_scope_period on public.project_work_plans
  (project_id, construction_site_id, period_type, period_start desc);

create table public.project_work_plan_lines (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.project_work_plans(id) on delete cascade,
  task_id text not null references public.project_tasks(id),
  work_boq_item_id text,
  wbs_code_snapshot text,
  task_name_snapshot text not null,
  group_name_snapshot text,
  unit_snapshot text,
  total_qty_snapshot numeric,
  done_before_qty_snapshot numeric,
  planned_qty numeric check (planned_qty is null or planned_qty >= 0),
  planned_start date,
  planned_end date,
  crew_label text,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (plan_id, task_id),
  check (planned_end is null or planned_start is null or planned_end >= planned_start)
);
create index project_work_plan_lines_task on public.project_work_plan_lines (task_id);

create table public.project_work_plan_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.project_work_plans(id) on delete cascade,
  action text not null check (action in ('create', 'save', 'submit', 'withdraw', 'return', 'approve', 'revise', 'supersede')),
  actor_id uuid references public.users(id),
  reason text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index project_work_plan_events_plan on public.project_work_plan_events (plan_id, created_at);

alter table public.project_work_plans enable row level security;
alter table public.project_work_plan_lines enable row level security;
alter table public.project_work_plan_events enable row level security;
create policy project_work_plans_select on public.project_work_plans for select to authenticated
  using (app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'work_plan', 'view'));
create policy project_work_plan_lines_select on public.project_work_plan_lines for select to authenticated
  using (exists (select 1 from public.project_work_plans p where p.id = plan_id
    and app_private.current_actor_has_effective_room_action(p.project_id, p.construction_site_id, 'work_plan', 'view')));
create policy project_work_plan_events_select on public.project_work_plan_events for select to authenticated
  using (exists (select 1 from public.project_work_plans p where p.id = plan_id
    and app_private.current_actor_has_effective_room_action(p.project_id, p.construction_site_id, 'work_plan', 'view')));
revoke all on public.project_work_plans, public.project_work_plan_lines, public.project_work_plan_events from anon;
revoke insert, update, delete on public.project_work_plans, public.project_work_plan_lines, public.project_work_plan_events from authenticated;
grant select on public.project_work_plans, public.project_work_plan_lines, public.project_work_plan_events to authenticated;

-- 3. Helpers.
create function app_private.work_plan_period_end(p_period_type text, p_period_start date)
returns date language sql immutable set search_path = '' as $$
  select case p_period_type
    when 'month' then (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date
    when 'week' then p_period_start + 6 end;
$$;

create function app_private.work_plan_code(p_period_type text, p_period_start date)
returns text language sql immutable set search_path = '' as $$
  select case p_period_type
    when 'month' then 'KHT-' || to_char(p_period_start, 'YYYY-MM')
    else 'KHTU-' || to_char(p_period_start, 'IYYY-"W"IW') end;
$$;

-- Latest cumulative quantity/percent of a task on or before a date (null = no record).
create function app_private.work_plan_task_cumulative(p_task_id text, p_on date)
returns table (quantity_done numeric, progress_percent numeric, progress_date date)
language sql stable security definer set search_path = '' as $$
  select p.quantity_done, p.progress_percent, p.progress_date
  from public.project_daily_task_progress p
  where p.task_id = p_task_id and p.progress_date <= p_on
  order by p.progress_date desc, p.updated_at desc
  limit 1;
$$;

create function app_private.work_plan_can(p_project_id text, p_site_id text, p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.current_actor_has_effective_room_action(p_project_id, p_site_id, 'work_plan', p_action), false);
$$;

create function app_private.work_plan_approve_action(p_period_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_period_type when 'week' then 'verify' else 'approve' end;
$$;

-- Leaf tasks of the scope with the facts a planner needs for the period.
create function app_private.work_plan_task_facts(p_project_id text, p_site_id text, p_period_start date, p_period_end date)
returns table (task_id text, work_boq_item_id text, wbs_code text, task_name text, group_name text, unit text,
  total_qty numeric, done_before numeric, done_end numeric, pct_before numeric, pct_end numeric,
  last_progress_date date, start_date date, end_date date, sort_key text)
language sql stable security definer set search_path = '' as $$
  with recursive tree as (
    select t.id, t.parent_id, t.id as root_id, t.name as root_name
    from public.project_tasks t
    where t.project_id = p_project_id and t.construction_site_id is not distinct from p_site_id and t.parent_id is null
    union all
    select c.id, c.parent_id, tree.root_id, tree.root_name
    from public.project_tasks c join tree on c.parent_id = tree.id
  )
  select t.id, w.id, coalesce(nullif(btrim(t.wbs_code), ''), w.wbs_code), t.name, tree.root_name,
    coalesce(nullif(btrim(w.unit), ''), nullif(btrim(t.unit), ''), nullif(btrim(t.fallback_unit), '')),
    coalesce(nullif(w.planned_qty, 0), nullif(t.quantity, 0), nullif(t.provisional_quantity, 0)),
    before.quantity_done, at_end.quantity_done, before.progress_percent, at_end.progress_percent,
    at_end.progress_date,
    case when t.start_date ~ '^\d{4}-\d{2}-\d{2}' then left(t.start_date, 10)::date end,
    case when t.end_date ~ '^\d{4}-\d{2}-\d{2}' then left(t.end_date, 10)::date end,
    coalesce(nullif(btrim(t.wbs_code), ''), w.wbs_code, lpad(coalesce(t.sort_order, 0)::text, 8, '0'))
  from public.project_tasks t
  left join tree on tree.id = t.id
  left join lateral (select w0.* from public.project_work_boq_items w0 where w0.source_task_id = t.id
    order by w0.created_at limit 1) w on true
  left join lateral app_private.work_plan_task_cumulative(t.id, p_period_start - 1) before on true
  left join lateral app_private.work_plan_task_cumulative(t.id, p_period_end) at_end on true
  where t.project_id = p_project_id and t.construction_site_id is not distinct from p_site_id
    and not exists (select 1 from public.project_tasks c where c.parent_id = t.id);
$$;

create function app_private.work_plan_json(p_plan_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'projectId', p.project_id, 'constructionSiteId', p.construction_site_id,
    'periodType', p.period_type, 'periodStart', p.period_start, 'periodEnd', p.period_end, 'code', p.code,
    'status', p.status, 'revisionNo', p.revision_no, 'supersedesPlanId', p.supersedes_plan_id, 'note', p.note,
    'rowVersion', p.row_version, 'createdAt', p.created_at, 'updatedAt', p.updated_at,
    'createdBy', p.created_by, 'createdByName', (select u.name from public.users u where u.id = p.created_by),
    'submittedAt', p.submitted_at, 'submittedByName', (select u.name from public.users u where u.id = p.submitted_by),
    'submittedToUserId', p.submitted_to_user_id,
    'approvedAt', p.approved_at, 'approvedByName', (select u.name from public.users u where u.id = p.approved_by),
    'returnedAt', p.returned_at, 'returnedByName', (select u.name from public.users u where u.id = p.returned_by),
    'returnReason', p.return_reason,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'taskId', l.task_id, 'workBoqItemId', l.work_boq_item_id, 'wbsCode', l.wbs_code_snapshot,
        'taskName', l.task_name_snapshot, 'groupName', l.group_name_snapshot, 'unit', l.unit_snapshot,
        'totalQty', l.total_qty_snapshot, 'doneBeforeQty', l.done_before_qty_snapshot,
        'plannedQty', l.planned_qty, 'plannedStart', l.planned_start, 'plannedEnd', l.planned_end,
        'crewLabel', l.crew_label, 'note', l.note,
        -- Actual in the period: cumulative at period end minus cumulative before it.
        -- Null when nothing was recorded up to the period end (unknown, not zero).
        'actualQty', case when f.done_end is null then null
          else greatest(f.done_end - coalesce(f.done_before, 0), 0) end,
        'lastProgressDate', f.last_progress_date
      ) order by l.sort_order, l.wbs_code_snapshot, l.task_name_snapshot)
      from public.project_work_plan_lines l
      left join lateral (
        select (select c.quantity_done from app_private.work_plan_task_cumulative(l.task_id, p.period_start - 1) c) done_before,
          at_end.quantity_done done_end, at_end.progress_date last_progress_date
        from (select 1) one
        left join lateral app_private.work_plan_task_cumulative(l.task_id, p.period_end) at_end on true
      ) f on true
      where l.plan_id = p.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at, 'reason', e.reason,
        'actorName', (select u.name from public.users u where u.id = e.actor_id)) order by e.created_at)
      from public.project_work_plan_events e where e.plan_id = p.id), '[]'::jsonb)
  )
  from public.project_work_plans p where p.id = p_plan_id;
$$;

create function app_private.work_plan_notify(p_plan public.project_work_plans, p_recipients uuid[], p_actor uuid,
  p_title text, p_message text, p_source text, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link,
    source_type, source_id, construction_site_id, priority, push_enabled, metadata, delivery_reason)
  select u.id::text, p_type, 'progress', p_title, p_message, p_message, p_type, '🗓️',
    '/#/da?' || concat_ws('&', 'projectId=' || p_plan.project_id, 'siteId=' || nullif(p_plan.construction_site_id, ''),
      'tab=work_plan', 'period=' || p_plan.period_type, 'start=' || p_plan.period_start),
    p_source, 'work_plan_' || p_plan.id || ':' || p_plan.row_version || ':' || u.id,
    nullif(p_plan.construction_site_id, ''), 'normal', true,
    jsonb_build_object('projectId', p_plan.project_id, 'planId', p_plan.id, 'deliveredBy', 'work_plan_command'),
    'assigned'
  from (select distinct unnest(p_recipients) id) r
  join public.users u on u.id = r.id and u.is_active and u.account_status = 'ACTIVE'
  where r.id is distinct from p_actor;
end;
$$;

-- People explicitly granted a work_plan action in this scope. Admins pass every
-- Room check, so they are listed only when granted by name (no notice flood).
create function app_private.work_plan_room_holders(p_project_id text, p_site_id text, p_action text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct u.id), '{}'::uuid[])
  from public.project_permission_room_members m
  join public.project_staff s on s.id = m.project_staff_id and s.end_date is null
  join public.users u on u.id::text = s.user_id and u.is_active and u.account_status = 'ACTIVE'
  where m.project_id = p_project_id and m.room_code = 'work_plan' and m.is_active
    and (nullif(p_site_id, '') is null or m.construction_site_id is null or m.construction_site_id = p_site_id)
    and exists (select 1 from public.project_permission_room_member_actions a
      where a.room_member_id = m.id and a.action_code = p_action and a.is_active);
$$;

-- 4. Read RPCs.
create function public.get_project_work_plan_board_v1(p_project_id text, p_construction_site_id text,
  p_period_type text, p_period_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_site text := nullif(p_construction_site_id, '');
  v_start date := case p_period_type when 'month' then date_trunc('month', p_period_start)::date
    else (p_period_start - (extract(isodow from p_period_start)::int - 1))::date end;
  v_end date;
  v_open uuid; v_approved uuid;
begin
  if p_period_type not in ('month', 'week') or p_period_start is null then
    raise exception using errcode = '22023', message = 'WORK_PLAN_PERIOD_INVALID';
  end if;
  if public.current_app_user_id() is null or not app_private.work_plan_can(p_project_id, v_site, 'view') then
    raise exception using errcode = '42501', message = 'WORK_PLAN_VIEW_DENIED';
  end if;
  v_end := app_private.work_plan_period_end(p_period_type, v_start);
  select id into v_open from public.project_work_plans where project_id = p_project_id
    and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start
    and status in ('draft', 'submitted', 'returned');
  select id into v_approved from public.project_work_plans where project_id = p_project_id
    and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start
    and status = 'approved';
  return jsonb_build_object(
    'periodType', p_period_type, 'periodStart', v_start, 'periodEnd', v_end,
    'code', app_private.work_plan_code(p_period_type, v_start),
    'approved', case when v_approved is null then null else app_private.work_plan_json(v_approved) end,
    'open', case when v_open is null then null else app_private.work_plan_json(v_open) end,
    'permissions', jsonb_build_object(
      'canEdit', app_private.work_plan_can(p_project_id, v_site, 'edit'),
      'canSubmit', app_private.work_plan_can(p_project_id, v_site, 'submit'),
      'canDelete', app_private.work_plan_can(p_project_id, v_site, 'delete'),
      'canApprove', app_private.work_plan_can(p_project_id, v_site, app_private.work_plan_approve_action(p_period_type))),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id = any(app_private.work_plan_room_holders(p_project_id, v_site,
        app_private.work_plan_approve_action(p_period_type)))), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'code', h.code, 'periodStart', h.period_start,
        'periodEnd', h.period_end, 'status', h.status, 'revisionNo', h.revision_no,
        'lineCount', (select count(*) from public.project_work_plan_lines l where l.plan_id = h.id),
        'approvedAt', h.approved_at, 'updatedAt', h.updated_at) order by h.period_start desc, h.revision_no desc)
      from (select * from public.project_work_plans where project_id = p_project_id
        and construction_site_id is not distinct from v_site and period_type = p_period_type
        and status <> 'cancelled' order by period_start desc, revision_no desc limit 24) h), '[]'::jsonb)
  );
end;
$$;

-- Tasks a planner can add for the period, with a suggested quantity: the
-- remaining quantity spread evenly over the task's remaining scheduled days,
-- counting only days inside the period. Week plans also show the month plan.
create function public.list_project_work_plan_candidates_v1(p_project_id text, p_construction_site_id text,
  p_period_type text, p_period_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_site text := nullif(p_construction_site_id, '');
  v_start date := case p_period_type when 'month' then date_trunc('month', p_period_start)::date
    else (p_period_start - (extract(isodow from p_period_start)::int - 1))::date end;
  v_end date;
  v_month_plan uuid;
begin
  if p_period_type not in ('month', 'week') or p_period_start is null then
    raise exception using errcode = '22023', message = 'WORK_PLAN_PERIOD_INVALID';
  end if;
  if public.current_app_user_id() is null or not app_private.work_plan_can(p_project_id, v_site, 'view') then
    raise exception using errcode = '42501', message = 'WORK_PLAN_VIEW_DENIED';
  end if;
  v_end := app_private.work_plan_period_end(p_period_type, v_start);
  if p_period_type = 'week' then
    -- The month the week starts in; prefer its approved plan, else the open one.
    select id into v_month_plan from public.project_work_plans where project_id = p_project_id
      and construction_site_id is not distinct from v_site and period_type = 'month'
      and period_start = date_trunc('month', v_start)::date and status in ('approved', 'draft', 'submitted', 'returned')
    order by (status = 'approved') desc limit 1;
  end if;
  -- Overdue unfinished work still has to be done: it is offered with all of
  -- its remaining quantity. Finished work is listed but never suggested.
  return coalesce((select jsonb_agg(jsonb_build_object(
      'taskId', f.task_id, 'workBoqItemId', f.work_boq_item_id, 'wbsCode', f.wbs_code, 'taskName', f.task_name,
      'groupName', f.group_name, 'unit', f.unit, 'totalQty', f.total_qty, 'doneBeforeQty', f.done_before,
      'remainingQty', case when f.total_qty is null then null else greatest(f.total_qty - coalesce(f.done_before, 0), 0) end,
      'pctBefore', f.pct_before, 'startDate', f.start_date, 'endDate', f.end_date,
      'finished', f.finished, 'overdue', f.overdue,
      'inPeriod', not f.finished and f.start_date <= v_end and (f.end_date >= v_start or f.overdue),
      'suggestedQty', case
        when f.finished or f.total_qty is null or f.start_date is null or f.end_date is null or f.start_date > v_end then null
        when f.overdue then greatest(f.total_qty - coalesce(f.done_before, 0), 0)
        when f.end_date < v_start then null
        else round(greatest(f.total_qty - coalesce(f.done_before, 0), 0)
          * greatest(least(f.end_date, v_end) - greatest(f.start_date, v_start) + 1, 0)
          / greatest(f.end_date - greatest(f.start_date, v_start) + 1, 1), 3) end,
      'monthPlanQty', (select l.planned_qty from public.project_work_plan_lines l
        where l.plan_id = v_month_plan and l.task_id = f.task_id)
    ) order by f.sort_key, f.task_name)
    from (select f0.*,
        (coalesce(f0.pct_before, 0) >= 100 or (f0.total_qty is not null and coalesce(f0.done_before, 0) >= f0.total_qty)) finished,
        (f0.end_date < v_start and not (coalesce(f0.pct_before, 0) >= 100
          or (f0.total_qty is not null and coalesce(f0.done_before, 0) >= f0.total_qty))) overdue
      from app_private.work_plan_task_facts(p_project_id, v_site, v_start, v_end) f0) f), '[]'::jsonb);
end;
$$;

-- 5. Write RPCs.
create function public.save_project_work_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_work_plans%rowtype;
  v_project text := p_input->>'projectId';
  v_site text := nullif(p_input->>'constructionSiteId', '');
  v_type text := p_input->>'periodType';
  v_start date := (p_input->>'periodStart')::date;
  v_end date;
  v_sort integer := 0;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'WORK_PLAN_EDIT_DENIED'; end if;
  if jsonb_typeof(p_input->'lines') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'WORK_PLAN_LINES_REQUIRED'; end if;
  if p_input->>'planId' is not null then
    select * into v_plan from public.project_work_plans where id = (p_input->>'planId')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'WORK_PLAN_NOT_FOUND'; end if;
    v_project := v_plan.project_id; v_site := v_plan.construction_site_id; v_type := v_plan.period_type;
    v_start := v_plan.period_start; v_end := v_plan.period_end;
    if not app_private.work_plan_can(v_project, v_site, 'edit') then
      raise exception using errcode = '42501', message = 'WORK_PLAN_EDIT_DENIED'; end if;
    if v_plan.status not in ('draft', 'returned') then
      raise exception using errcode = 'PT409', message = 'WORK_PLAN_NOT_EDITABLE'; end if;
    if v_plan.row_version <> coalesce((p_input->>'expectedRowVersion')::bigint, -1) then
      raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  else
    if v_type not in ('month', 'week') or v_start is null then
      raise exception using errcode = '22023', message = 'WORK_PLAN_PERIOD_INVALID'; end if;
    if not app_private.work_plan_can(v_project, v_site, 'edit') then
      raise exception using errcode = '42501', message = 'WORK_PLAN_EDIT_DENIED'; end if;
    if (v_type = 'month' and v_start <> date_trunc('month', v_start)::date)
      or (v_type = 'week' and extract(isodow from v_start) <> 1) then
      raise exception using errcode = '22023', message = 'WORK_PLAN_PERIOD_INVALID'; end if;
    -- A project-wide grant does not prove an arbitrary site belongs to the project.
    begin
      perform app_private.assert_project_progress_scope_period(v_project, v_site, 'daily', v_start);
    exception when check_violation then
      raise exception using errcode = '42501', message = 'WORK_PLAN_SCOPE_DENIED';
    end;
    v_end := app_private.work_plan_period_end(v_type, v_start);
    perform pg_advisory_xact_lock(hashtextextended('work_plan:' || v_project || ':' || coalesce(v_site, '') || ':' || v_type || ':' || v_start, 0));
    if exists (select 1 from public.project_work_plans where project_id = v_project
      and construction_site_id is not distinct from v_site and period_type = v_type and period_start = v_start
      and status in ('draft', 'submitted', 'returned')) then
      raise exception using errcode = '23505', message = 'WORK_PLAN_ALREADY_OPEN'; end if;
    if exists (select 1 from public.project_work_plans where project_id = v_project
      and construction_site_id is not distinct from v_site and period_type = v_type and period_start = v_start
      and status = 'approved') then
      raise exception using errcode = '23505', message = 'WORK_PLAN_ALREADY_APPROVED'; end if;
    insert into public.project_work_plans (project_id, construction_site_id, period_type, period_start, period_end,
      code, created_by, updated_by)
    values (v_project, v_site, v_type, v_start, v_end, app_private.work_plan_code(v_type, v_start), v_actor, v_actor)
    returning * into v_plan;
    insert into public.project_work_plan_events (plan_id, action, actor_id) values (v_plan.id, 'create', v_actor);
  end if;

  delete from public.project_work_plan_lines where plan_id = v_plan.id;
  create temp table work_plan_input on commit drop as
    select (x.ord)::integer ord, x.value->>'taskId' task_id,
      nullif(x.value->>'plannedQty', '')::numeric planned_qty,
      nullif(x.value->>'plannedStart', '')::date planned_start, nullif(x.value->>'plannedEnd', '')::date planned_end,
      nullif(btrim(x.value->>'crewLabel'), '') crew_label, nullif(btrim(x.value->>'note'), '') note
    from jsonb_array_elements(p_input->'lines') with ordinality x(value, ord);
  if exists (select 1 from work_plan_input where planned_qty < 0) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_QTY_INVALID'; end if;
  if exists (select 1 from work_plan_input where planned_start not between v_start and v_end
      or planned_end not between v_start and v_end or planned_end < planned_start) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_DATES_OUTSIDE_PERIOD'; end if;
  create temp table work_plan_facts on commit drop as
    select * from app_private.work_plan_task_facts(v_project, v_site, v_start, v_end);
  if exists (select 1 from work_plan_input i where not exists (select 1 from work_plan_facts f where f.task_id = i.task_id)) then
    raise exception using errcode = '22023', message = 'WORK_PLAN_TASK_INVALID'; end if;
  insert into public.project_work_plan_lines (plan_id, task_id, work_boq_item_id, wbs_code_snapshot, task_name_snapshot,
    group_name_snapshot, unit_snapshot, total_qty_snapshot, done_before_qty_snapshot, planned_qty, planned_start,
    planned_end, crew_label, note, sort_order)
  select distinct on (i.task_id) v_plan.id, f.task_id, f.work_boq_item_id, f.wbs_code, f.task_name, f.group_name,
    f.unit, f.total_qty, f.done_before, i.planned_qty, i.planned_start, i.planned_end, i.crew_label, i.note, i.ord
  from work_plan_input i join work_plan_facts f on f.task_id = i.task_id
  order by i.task_id, i.ord;
  select count(*) into v_sort from public.project_work_plan_lines where plan_id = v_plan.id;
  drop table work_plan_input; drop table work_plan_facts;

  update public.project_work_plans set note = nullif(btrim(p_input->>'note'), ''), updated_by = v_actor,
    updated_at = now(), row_version = row_version + 1
  where id = v_plan.id returning * into v_plan;
  insert into public.project_work_plan_events (plan_id, action, actor_id, detail)
  values (v_plan.id, 'save', v_actor, jsonb_build_object('lines', v_sort));
  return jsonb_build_object('planId', v_plan.id, 'rowVersion', v_plan.row_version, 'status', v_plan.status);
end;
$$;

create function public.transition_project_work_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_work_plans%rowtype;
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_to uuid := nullif(p_input->>'recipientUserId', '')::uuid;
  v_label text; v_period text;
begin
  select * into v_plan from public.project_work_plans where id = (p_input->>'planId')::uuid for update;
  if v_actor is null or not found then raise exception using errcode = '42501', message = 'WORK_PLAN_ACTION_DENIED'; end if;
  if v_plan.row_version <> coalesce((p_input->>'expectedRowVersion')::bigint, -1) then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  v_label := case v_plan.period_type when 'month' then 'Kế hoạch tháng ' || to_char(v_plan.period_start, 'MM/YYYY')
    else 'Kế hoạch tuần ' || to_char(v_plan.period_start, 'DD/MM') || '–' || to_char(v_plan.period_end, 'DD/MM/YYYY') end;

  if v_action = 'submit' then
    if not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'submit') then
      raise exception using errcode = '42501', message = 'WORK_PLAN_SUBMIT_DENIED'; end if;
    if v_plan.status not in ('draft', 'returned') then raise exception using errcode = 'PT409', message = 'WORK_PLAN_NOT_EDITABLE'; end if;
    if not exists (select 1 from public.project_work_plan_lines where plan_id = v_plan.id) then
      raise exception using errcode = '22023', message = 'WORK_PLAN_EMPTY'; end if;
    if v_to is not null and not app_private.project_actor_has_effective_room_action(v_to, v_plan.project_id,
      v_plan.construction_site_id, 'work_plan', app_private.work_plan_approve_action(v_plan.period_type)) then
      raise exception using errcode = '22023', message = 'WORK_PLAN_APPROVER_INVALID'; end if;
    update public.project_work_plans set status = 'submitted', submitted_by = v_actor, submitted_at = now(),
      submitted_to_user_id = v_to, updated_by = v_actor, updated_at = now(), row_version = row_version + 1
    where id = v_plan.id returning * into v_plan;
    perform app_private.work_plan_notify(v_plan, case when v_to is not null then array[v_to]
      else app_private.work_plan_room_holders(v_plan.project_id, v_plan.construction_site_id,
        app_private.work_plan_approve_action(v_plan.period_type)) end, v_actor,
      v_label || ' chờ duyệt', coalesce((select name from public.users where id = v_actor), 'Người lập') || ' gửi ' || lower(left(v_label, 1)) || substr(v_label, 2) || ' để duyệt.',
      'work_plan_submitted', 'info');
  elsif v_action = 'withdraw' then
    if v_plan.status <> 'submitted' or v_plan.submitted_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'WORK_PLAN_WITHDRAW_DENIED'; end if;
    update public.project_work_plans set status = 'draft', updated_by = v_actor, updated_at = now(), row_version = row_version + 1
    where id = v_plan.id returning * into v_plan;
  elsif v_action in ('approve', 'return') then
    if not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, app_private.work_plan_approve_action(v_plan.period_type)) then
      raise exception using errcode = '42501', message = 'WORK_PLAN_APPROVE_DENIED'; end if;
    if v_plan.status <> 'submitted' then raise exception using errcode = 'PT409', message = 'WORK_PLAN_NOT_SUBMITTED'; end if;
    if v_action = 'return' then
      if v_reason is null then raise exception using errcode = '22023', message = 'WORK_PLAN_RETURN_REASON_REQUIRED'; end if;
      update public.project_work_plans set status = 'returned', returned_by = v_actor, returned_at = now(),
        return_reason = v_reason, updated_by = v_actor, updated_at = now(), row_version = row_version + 1
      where id = v_plan.id returning * into v_plan;
      perform app_private.work_plan_notify(v_plan, array[v_plan.created_by, v_plan.submitted_by], v_actor,
        v_label || ' bị trả lại', 'Lý do: ' || left(v_reason, 300), 'work_plan_returned', 'warning');
    else
      -- The approved revision replaces the one it corrects.
      update public.project_work_plans set status = 'superseded', updated_at = now(), row_version = row_version + 1
      where project_id = v_plan.project_id and construction_site_id is not distinct from v_plan.construction_site_id
        and period_type = v_plan.period_type and period_start = v_plan.period_start and status = 'approved';
      if v_plan.supersedes_plan_id is not null then
        insert into public.project_work_plan_events (plan_id, action, actor_id, detail)
        values (v_plan.supersedes_plan_id, 'supersede', v_actor, jsonb_build_object('byPlanId', v_plan.id));
      end if;
      update public.project_work_plans set status = 'approved', approved_by = v_actor, approved_at = now(),
        updated_by = v_actor, updated_at = now(), row_version = row_version + 1
      where id = v_plan.id returning * into v_plan;
      perform app_private.work_plan_notify(v_plan, array[v_plan.created_by, v_plan.submitted_by], v_actor,
        v_label || ' đã được duyệt', coalesce((select name from public.users where id = v_actor), 'Người duyệt') || ' đã duyệt.',
        'work_plan_approved', 'success');
    end if;
  elsif v_action = 'delete' then
    if v_plan.status <> 'draft' or v_plan.submitted_at is not null
      or not (v_plan.created_by = v_actor or app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'delete')) then
      raise exception using errcode = '42501', message = 'WORK_PLAN_DELETE_DENIED'; end if;
    delete from public.project_work_plans where id = v_plan.id;
    return jsonb_build_object('planId', v_plan.id, 'deleted', true);
  else
    raise exception using errcode = '22023', message = 'WORK_PLAN_ACTION_INVALID';
  end if;
  insert into public.project_work_plan_events (plan_id, action, actor_id, reason) values (v_plan.id, v_action, v_actor, v_reason);
  return jsonb_build_object('planId', v_plan.id, 'rowVersion', v_plan.row_version, 'status', v_plan.status);
end;
$$;

-- An approved plan is never edited in place: a numbered revision is drafted
-- from it and replaces it only when approved.
create function public.revise_project_work_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_work_plans%rowtype;
  v_new public.project_work_plans%rowtype;
  v_reason text := nullif(btrim(p_input->>'reason'), '');
begin
  select * into v_plan from public.project_work_plans where id = (p_input->>'planId')::uuid for update;
  if v_actor is null or not found or not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'edit') then
    raise exception using errcode = '42501', message = 'WORK_PLAN_EDIT_DENIED'; end if;
  if v_plan.status <> 'approved' then raise exception using errcode = 'PT409', message = 'WORK_PLAN_NOT_APPROVED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'WORK_PLAN_REVISION_REASON_REQUIRED'; end if;
  if exists (select 1 from public.project_work_plans where project_id = v_plan.project_id
    and construction_site_id is not distinct from v_plan.construction_site_id and period_type = v_plan.period_type
    and period_start = v_plan.period_start and status in ('draft', 'submitted', 'returned')) then
    raise exception using errcode = '23505', message = 'WORK_PLAN_ALREADY_OPEN'; end if;
  insert into public.project_work_plans (project_id, construction_site_id, period_type, period_start, period_end, code,
    revision_no, supersedes_plan_id, note, created_by, updated_by)
  values (v_plan.project_id, v_plan.construction_site_id, v_plan.period_type, v_plan.period_start, v_plan.period_end,
    v_plan.code, (select max(revision_no) + 1 from public.project_work_plans where project_id = v_plan.project_id
      and construction_site_id is not distinct from v_plan.construction_site_id and period_type = v_plan.period_type
      and period_start = v_plan.period_start), v_plan.id, v_plan.note, v_actor, v_actor)
  returning * into v_new;
  insert into public.project_work_plan_lines (plan_id, task_id, work_boq_item_id, wbs_code_snapshot, task_name_snapshot,
    group_name_snapshot, unit_snapshot, total_qty_snapshot, done_before_qty_snapshot, planned_qty, planned_start,
    planned_end, crew_label, note, sort_order)
  select v_new.id, task_id, work_boq_item_id, wbs_code_snapshot, task_name_snapshot, group_name_snapshot, unit_snapshot,
    total_qty_snapshot, done_before_qty_snapshot, planned_qty, planned_start, planned_end, crew_label, note, sort_order
  from public.project_work_plan_lines where plan_id = v_plan.id;
  insert into public.project_work_plan_events (plan_id, action, actor_id, reason, detail)
  values (v_new.id, 'revise', v_actor, v_reason, jsonb_build_object('fromPlanId', v_plan.id));
  return jsonb_build_object('planId', v_new.id, 'rowVersion', v_new.row_version, 'status', v_new.status);
end;
$$;

revoke all on function app_private.work_plan_period_end(text, date), app_private.work_plan_code(text, date),
  app_private.work_plan_task_cumulative(text, date), app_private.work_plan_can(text, text, text),
  app_private.work_plan_approve_action(text), app_private.work_plan_task_facts(text, text, date, date),
  app_private.work_plan_json(uuid),
  app_private.work_plan_notify(public.project_work_plans, uuid[], uuid, text, text, text, text),
  app_private.work_plan_room_holders(text, text, text) from public, anon, authenticated;
revoke all on function public.get_project_work_plan_board_v1(text, text, text, date),
  public.list_project_work_plan_candidates_v1(text, text, text, date), public.save_project_work_plan_v1(jsonb),
  public.transition_project_work_plan_v1(jsonb), public.revise_project_work_plan_v1(jsonb) from public, anon;
grant execute on function public.get_project_work_plan_board_v1(text, text, text, date),
  public.list_project_work_plan_candidates_v1(text, text, text, date), public.save_project_work_plan_v1(jsonb),
  public.transition_project_work_plan_v1(jsonb), public.revise_project_work_plan_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';

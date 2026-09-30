-- Kế hoạch vật tư tháng / tuần sinh từ kế hoạch thi công đã duyệt (Đợt 2 vòng
-- khép kín Module Dự án, chủ sản phẩm duyệt 30/09/2026).
--
-- Need = planned work quantity / work total quantity × BOQ material quantity of
-- that work (material_budget_items linked to the work item), summed per
-- material. Work without a quantity basis or without BOQ materials is reported,
-- never guessed. The CHT approves (Room work_plan, action verify). Over-BOQ
-- requests are allowed only with a reason (owner decision 4).
-- The legacy G-series public.material_plans tables are not used here.

create table public.project_material_plans (
  id uuid primary key default gen_random_uuid(),
  work_plan_id uuid not null references public.project_work_plans(id),
  project_id text not null references public.projects(id),
  construction_site_id text,
  period_type text not null check (period_type in ('month', 'week')),
  period_start date not null,
  period_end date not null,
  code text not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'returned', 'approved', 'superseded', 'cancelled')),
  revision_no integer not null default 1 check (revision_no > 0),
  supersedes_plan_id uuid references public.project_material_plans(id),
  destination_warehouse_id text references public.warehouses(id),
  needed_date date,
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
  check (period_end >= period_start),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  check (status <> 'returned' or nullif(btrim(return_reason), '') is not null)
);
create unique index project_material_plans_one_open on public.project_material_plans
  (project_id, coalesce(construction_site_id, ''), period_type, period_start)
  where status in ('draft', 'submitted', 'returned');
create unique index project_material_plans_one_approved on public.project_material_plans
  (project_id, coalesce(construction_site_id, ''), period_type, period_start)
  where status = 'approved';
create index project_material_plans_work_plan on public.project_material_plans (work_plan_id);

create table public.project_material_plan_lines (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.project_material_plans(id) on delete cascade,
  item_id text not null references public.items(id),
  sku_snapshot text,
  item_name_snapshot text not null,
  unit text not null,
  category text,
  need_qty numeric not null check (need_qty >= 0),
  stock_qty_snapshot numeric,
  requested_qty numeric not null default 0 check (requested_qty >= 0),
  boq_qty_snapshot numeric,
  issued_before_snapshot numeric,
  needed_date date,
  over_reason text,
  note text,
  sort_order integer not null default 0,
  unique (plan_id, item_id, unit)
);

create table public.project_material_plan_sources (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.project_material_plan_lines(id) on delete cascade,
  task_id text not null references public.project_tasks(id),
  work_boq_item_id text not null references public.project_work_boq_items(id),
  material_budget_item_id text not null references public.material_budget_items(id),
  task_name_snapshot text,
  wbs_code_snapshot text,
  planned_work_qty numeric not null,
  work_total_qty numeric not null check (work_total_qty > 0),
  work_unit text,
  budget_qty numeric not null,
  derived_qty numeric not null check (derived_qty >= 0)
);
create index project_material_plan_sources_line on public.project_material_plan_sources (line_id);

create table public.project_material_plan_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.project_material_plans(id) on delete cascade,
  action text not null check (action in ('create', 'save', 'submit', 'withdraw', 'return', 'approve', 'revise', 'supersede')),
  actor_id uuid references public.users(id),
  reason text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index project_material_plan_events_plan on public.project_material_plan_events (plan_id, created_at);

alter table public.project_material_plans enable row level security;
alter table public.project_material_plan_lines enable row level security;
alter table public.project_material_plan_sources enable row level security;
alter table public.project_material_plan_events enable row level security;
create policy project_material_plans_select on public.project_material_plans for select to authenticated
  using (app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'work_plan', 'view'));
create policy project_material_plan_lines_select on public.project_material_plan_lines for select to authenticated
  using (exists (select 1 from public.project_material_plans p where p.id = plan_id
    and app_private.current_actor_has_effective_room_action(p.project_id, p.construction_site_id, 'work_plan', 'view')));
create policy project_material_plan_sources_select on public.project_material_plan_sources for select to authenticated
  using (exists (select 1 from public.project_material_plan_lines l join public.project_material_plans p on p.id = l.plan_id
    where l.id = line_id and app_private.current_actor_has_effective_room_action(p.project_id, p.construction_site_id, 'work_plan', 'view')));
create policy project_material_plan_events_select on public.project_material_plan_events for select to authenticated
  using (exists (select 1 from public.project_material_plans p where p.id = plan_id
    and app_private.current_actor_has_effective_room_action(p.project_id, p.construction_site_id, 'work_plan', 'view')));
revoke all on public.project_material_plans, public.project_material_plan_lines, public.project_material_plan_sources,
  public.project_material_plan_events from anon;
revoke insert, update, delete on public.project_material_plans, public.project_material_plan_lines,
  public.project_material_plan_sources, public.project_material_plan_events from authenticated;
grant select on public.project_material_plans, public.project_material_plan_lines, public.project_material_plan_sources,
  public.project_material_plan_events to authenticated;

-- Material needs of a work plan, one row per (material, BOQ line, task).
create function app_private.material_plan_derive(p_work_plan_id uuid)
returns table (item_id text, sku text, item_name text, unit text, category text, task_id text, work_boq_item_id text,
  material_budget_item_id text, task_name text, wbs_code text, planned_work_qty numeric, work_total_qty numeric,
  work_unit text, budget_qty numeric, derived_qty numeric)
language sql stable security definer set search_path = '' as $$
  select b.inventory_item_id, coalesce(nullif(btrim(i.sku), ''), nullif(btrim(b.material_code), '')),
    coalesce(nullif(btrim(i.name), ''), b.item_name), b.unit, nullif(btrim(b.category), ''),
    l.task_id, l.work_boq_item_id, b.id, l.task_name_snapshot, l.wbs_code_snapshot,
    l.planned_qty, l.total_qty_snapshot, l.unit_snapshot, b.budget_qty,
    round(l.planned_qty / l.total_qty_snapshot * b.budget_qty, 3)
  from public.project_work_plan_lines l
  join public.project_work_plans p on p.id = l.plan_id
  join public.material_budget_items b on b.work_boq_item_id = l.work_boq_item_id
    and b.project_id = p.project_id and b.construction_site_id is not distinct from p.construction_site_id
  join public.items i on i.id = b.inventory_item_id
  where l.plan_id = p_work_plan_id and l.planned_qty > 0 and l.total_qty_snapshot > 0
    and b.budget_qty > 0 and nullif(btrim(b.unit), '') is not null;
$$;

-- Work lines of the plan whose materials cannot be derived, with the reason.
create function app_private.material_plan_gaps(p_work_plan_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with derived as materialized (select distinct d.task_id from app_private.material_plan_derive(p_work_plan_id) d)
  select coalesce(jsonb_agg(jsonb_build_object('taskId', l.task_id, 'wbsCode', l.wbs_code_snapshot,
      'taskName', l.task_name_snapshot, 'groupName', l.group_name_snapshot,
      'reason', case when coalesce(l.planned_qty, 0) <= 0 then 'no_planned_qty'
        when coalesce(l.total_qty_snapshot, 0) <= 0 then 'no_work_qty'
        when l.work_boq_item_id is null or not exists (select 1 from public.material_budget_items b
          where b.work_boq_item_id = l.work_boq_item_id and b.budget_qty > 0) then 'no_boq_material'
        else 'no_item_code' end) order by l.sort_order), '[]'::jsonb)
  from public.project_work_plan_lines l
  where l.plan_id = p_work_plan_id and not exists (select 1 from derived d where d.task_id = l.task_id);
$$;

-- Live position of one material in the project scope.
create function app_private.material_plan_item_position(p_project_id text, p_site_id text, p_item_id text, p_unit text)
returns table (boq_qty numeric, issued_qty numeric, stock_qty numeric, stock_known boolean)
language sql stable security definer set search_path = '' as $$
  select
    (select sum(b.budget_qty) from public.material_budget_items b where b.project_id = p_project_id
      and b.construction_site_id is not distinct from p_site_id and b.inventory_item_id = p_item_id and b.unit = p_unit),
    (select coalesce(sum(greatest(line.issued_qty - line.returned_qty, 0)), 0)
      from public.material_issue_lines line join public.material_issue_orders o on o.id = line.issue_order_id
      where o.project_id = p_project_id and o.construction_site_id is not distinct from p_site_id
        and line.item_id = p_item_id and line.unit = p_unit
        and o.status in ('issued', 'partially_received', 'received', 'settling', 'partially_returned', 'closed')),
    -- A site warehouse with no balance row for the item holds none of it (0);
    -- without any site warehouse the stock is unknown (null).
    case when exists (select 1 from public.warehouses w where w.project_id = p_project_id
      and (p_site_id is null or w.construction_site_id::text = p_site_id) and not coalesce(w.is_archived, false))
    then coalesce((select sum(s.on_hand_qty) from public.inventory_balances s join public.warehouses w on w.id = s.warehouse_id
      where s.material_id = p_item_id and w.project_id = p_project_id
        and (p_site_id is null or w.construction_site_id::text = p_site_id) and not coalesce(w.is_archived, false)), 0) end,
    exists (select 1 from public.warehouses w where w.project_id = p_project_id
      and (p_site_id is null or w.construction_site_id::text = p_site_id) and not coalesce(w.is_archived, false));
$$;

create function app_private.material_plan_json(p_plan_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'workPlanId', p.work_plan_id, 'projectId', p.project_id, 'constructionSiteId', p.construction_site_id,
    'periodType', p.period_type, 'periodStart', p.period_start, 'periodEnd', p.period_end, 'code', p.code,
    'status', p.status, 'revisionNo', p.revision_no, 'note', p.note, 'neededDate', p.needed_date,
    'destinationWarehouseId', p.destination_warehouse_id,
    'destinationWarehouseName', (select w.name from public.warehouses w where w.id = p.destination_warehouse_id),
    'rowVersion', p.row_version, 'createdAt', p.created_at, 'updatedAt', p.updated_at,
    'createdByName', (select u.name from public.users u where u.id = p.created_by),
    'submittedAt', p.submitted_at, 'submittedByName', (select u.name from public.users u where u.id = p.submitted_by),
    'approvedAt', p.approved_at, 'approvedByName', (select u.name from public.users u where u.id = p.approved_by),
    'returnedAt', p.returned_at, 'returnedByName', (select u.name from public.users u where u.id = p.returned_by),
    'returnReason', p.return_reason,
    'workPlanRevisionNo', (select w.revision_no from public.project_work_plans w where w.id = p.work_plan_id),
    'workPlanStatus', (select w.status from public.project_work_plans w where w.id = p.work_plan_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'itemId', l.item_id, 'sku', l.sku_snapshot, 'itemName', l.item_name_snapshot, 'unit', l.unit,
        'category', l.category, 'needQty', l.need_qty, 'requestedQty', l.requested_qty, 'neededDate', l.needed_date,
        'overReason', l.over_reason, 'note', l.note,
        'stockQtySnapshot', l.stock_qty_snapshot, 'boqQtySnapshot', l.boq_qty_snapshot, 'issuedBeforeSnapshot', l.issued_before_snapshot,
        'boqQty', pos.boq_qty, 'issuedQty', pos.issued_qty, 'stockQty', pos.stock_qty, 'stockKnown', pos.stock_known,
        'sources', coalesce((select jsonb_agg(jsonb_build_object('taskId', s.task_id, 'wbsCode', s.wbs_code_snapshot,
            'taskName', s.task_name_snapshot, 'plannedWorkQty', s.planned_work_qty, 'workTotalQty', s.work_total_qty,
            'workUnit', s.work_unit, 'budgetQty', s.budget_qty, 'derivedQty', s.derived_qty) order by s.wbs_code_snapshot)
          from public.project_material_plan_sources s where s.line_id = l.id), '[]'::jsonb)
      ) order by l.sort_order, l.item_name_snapshot)
      from public.project_material_plan_lines l
      left join lateral app_private.material_plan_item_position(p.project_id, p.construction_site_id, l.item_id, l.unit) pos on true
      where l.plan_id = p.id), '[]'::jsonb),
    'gaps', app_private.material_plan_gaps(p.work_plan_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at, 'reason', e.reason,
        'actorName', (select u.name from public.users u where u.id = e.actor_id)) order by e.created_at)
      from public.project_material_plan_events e where e.plan_id = p.id), '[]'::jsonb)
  )
  from public.project_material_plans p where p.id = p_plan_id;
$$;

-- Insert lines for a plan from its work plan: need per material, suggested
-- request = need not covered by positive site stock.
create function app_private.material_plan_fill_lines(p_plan public.project_material_plans)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with derived as (
    select * from app_private.material_plan_derive(p_plan.work_plan_id)
  ), grouped as (
    select d.item_id, d.unit, max(d.sku) sku, max(d.item_name) item_name, max(d.category) category, sum(d.derived_qty) need_qty
    from derived d group by d.item_id, d.unit
  ), positioned as (
    select g.*, pos.boq_qty, pos.issued_qty, pos.stock_qty,
      row_number() over (order by g.category nulls last, g.item_name) sort_order
    from grouped g
    left join lateral app_private.material_plan_item_position(p_plan.project_id, p_plan.construction_site_id, g.item_id, g.unit) pos on true
  ), inserted as (
    insert into public.project_material_plan_lines (plan_id, item_id, sku_snapshot, item_name_snapshot, unit, category,
      need_qty, stock_qty_snapshot, requested_qty, boq_qty_snapshot, issued_before_snapshot, needed_date, sort_order)
    select p_plan.id, x.item_id, x.sku, x.item_name, x.unit, x.category, x.need_qty, x.stock_qty,
      round(greatest(x.need_qty - greatest(coalesce(x.stock_qty, 0), 0), 0), 3), x.boq_qty, x.issued_qty,
      p_plan.needed_date, x.sort_order
    from positioned x
    returning id, item_id, unit
  )
  insert into public.project_material_plan_sources (line_id, task_id, work_boq_item_id, material_budget_item_id,
    task_name_snapshot, wbs_code_snapshot, planned_work_qty, work_total_qty, work_unit, budget_qty, derived_qty)
  select ins.id, d.task_id, d.work_boq_item_id, d.material_budget_item_id, d.task_name, d.wbs_code,
    d.planned_work_qty, d.work_total_qty, d.work_unit, d.budget_qty, d.derived_qty
  from inserted ins join derived d on d.item_id = ins.item_id and d.unit = ins.unit;
  select count(*) into v_count from public.project_material_plan_lines where plan_id = p_plan.id;
  return v_count;
end;
$$;

create function app_private.material_plan_notify(p_plan public.project_material_plans, p_recipients uuid[], p_actor uuid,
  p_title text, p_message text, p_source text, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link,
    source_type, source_id, construction_site_id, priority, push_enabled, metadata, delivery_reason)
  select u.id::text, p_type, 'progress', p_title, p_message, p_message, p_type, '📦',
    '/#/da?' || concat_ws('&', 'projectId=' || p_plan.project_id, 'siteId=' || nullif(p_plan.construction_site_id, ''),
      'tab=work_plan', 'view=material', 'period=' || p_plan.period_type, 'start=' || p_plan.period_start),
    p_source, 'material_plan_' || p_plan.id || ':' || p_plan.row_version || ':' || u.id,
    nullif(p_plan.construction_site_id, ''), 'normal', true,
    jsonb_build_object('projectId', p_plan.project_id, 'materialPlanId', p_plan.id, 'deliveredBy', 'material_plan_command'),
    'assigned'
  from (select distinct unnest(p_recipients) id) r
  join public.users u on u.id = r.id and u.is_active and u.account_status = 'ACTIVE'
  where r.id is distinct from p_actor;
end;
$$;

-- Board of one period: the approved work plan it can derive from, the material
-- plans, permissions and the site warehouses.
create function public.get_project_material_plan_board_v1(p_project_id text, p_construction_site_id text,
  p_period_type text, p_period_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_site text := nullif(p_construction_site_id, '');
  v_start date := case p_period_type when 'month' then date_trunc('month', p_period_start)::date
    else (p_period_start - (extract(isodow from p_period_start)::int - 1))::date end;
  v_work uuid; v_open uuid; v_approved uuid;
begin
  if p_period_type not in ('month', 'week') or p_period_start is null then
    raise exception using errcode = '22023', message = 'WORK_PLAN_PERIOD_INVALID'; end if;
  if public.current_app_user_id() is null or not app_private.work_plan_can(p_project_id, v_site, 'view') then
    raise exception using errcode = '42501', message = 'WORK_PLAN_VIEW_DENIED'; end if;
  select id into v_work from public.project_work_plans where project_id = p_project_id
    and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start and status = 'approved';
  select id into v_open from public.project_material_plans where project_id = p_project_id
    and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start
    and status in ('draft', 'submitted', 'returned');
  select id into v_approved from public.project_material_plans where project_id = p_project_id
    and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start
    and status = 'approved';
  return jsonb_build_object(
    'periodType', p_period_type, 'periodStart', v_start, 'periodEnd', app_private.work_plan_period_end(p_period_type, v_start),
    'workPlan', case when v_work is null then null else (select jsonb_build_object('id', w.id, 'code', w.code,
      'revisionNo', w.revision_no, 'approvedAt', w.approved_at,
      'lineCount', (select count(*) from public.project_work_plan_lines l where l.plan_id = w.id))
      from public.project_work_plans w where w.id = v_work) end,
    'workPlanPending', exists (select 1 from public.project_work_plans where project_id = p_project_id
      and construction_site_id is not distinct from v_site and period_type = p_period_type and period_start = v_start
      and status in ('draft', 'submitted', 'returned')),
    'approved', case when v_approved is null then null else app_private.material_plan_json(v_approved) end,
    'open', case when v_open is null then null else app_private.material_plan_json(v_open) end,
    'permissions', jsonb_build_object(
      'canEdit', app_private.work_plan_can(p_project_id, v_site, 'edit'),
      'canSubmit', app_private.work_plan_can(p_project_id, v_site, 'submit'),
      'canDelete', app_private.work_plan_can(p_project_id, v_site, 'delete'),
      'canApprove', app_private.work_plan_can(p_project_id, v_site, 'verify')),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id = any(app_private.work_plan_room_holders(p_project_id, v_site, 'verify'))), '[]'::jsonb),
    'warehouses', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'isDefault', coalesce(w.is_default_for_site, false))
        order by w.is_default_for_site desc nulls last, w.name)
      from public.warehouses w where w.project_id = p_project_id and not coalesce(w.is_archived, false)
        and (v_site is null or w.construction_site_id::text = v_site)), '[]'::jsonb)
  );
end;
$$;

create function public.create_project_material_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_work public.project_work_plans%rowtype;
  v_plan public.project_material_plans%rowtype;
  v_lines integer;
begin
  select * into v_work from public.project_work_plans where id = (p_input->>'workPlanId')::uuid;
  if v_actor is null or not found or not app_private.work_plan_can(v_work.project_id, v_work.construction_site_id, 'edit') then
    raise exception using errcode = '42501', message = 'MATERIAL_PLAN_EDIT_DENIED'; end if;
  if v_work.status <> 'approved' then raise exception using errcode = 'PT409', message = 'MATERIAL_PLAN_WORK_PLAN_NOT_APPROVED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('material_plan:' || v_work.project_id || ':' || coalesce(v_work.construction_site_id, '')
    || ':' || v_work.period_type || ':' || v_work.period_start, 0));
  if exists (select 1 from public.project_material_plans where project_id = v_work.project_id
    and construction_site_id is not distinct from v_work.construction_site_id and period_type = v_work.period_type
    and period_start = v_work.period_start and status in ('draft', 'submitted', 'returned')) then
    raise exception using errcode = '23505', message = 'MATERIAL_PLAN_ALREADY_OPEN'; end if;
  if exists (select 1 from public.project_material_plans where project_id = v_work.project_id
    and construction_site_id is not distinct from v_work.construction_site_id and period_type = v_work.period_type
    and period_start = v_work.period_start and status = 'approved') then
    raise exception using errcode = '23505', message = 'MATERIAL_PLAN_ALREADY_APPROVED'; end if;
  insert into public.project_material_plans (work_plan_id, project_id, construction_site_id, period_type, period_start, period_end,
    code, destination_warehouse_id, needed_date, created_by, updated_by)
  values (v_work.id, v_work.project_id, v_work.construction_site_id, v_work.period_type, v_work.period_start, v_work.period_end,
    'VT-' || v_work.code,
    (select w.id from public.warehouses w where w.project_id = v_work.project_id and not coalesce(w.is_archived, false)
      and (v_work.construction_site_id is null or w.construction_site_id::text = v_work.construction_site_id)
      order by w.is_default_for_site desc nulls last, w.name limit 1),
    v_work.period_start, v_actor, v_actor)
  returning * into v_plan;
  v_lines := app_private.material_plan_fill_lines(v_plan);
  insert into public.project_material_plan_events (plan_id, action, actor_id, detail)
  values (v_plan.id, 'create', v_actor, jsonb_build_object('workPlanId', v_work.id, 'lines', v_lines));
  return jsonb_build_object('planId', v_plan.id, 'rowVersion', v_plan.row_version, 'status', v_plan.status, 'lines', v_lines);
end;
$$;

create function public.save_project_material_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_material_plans%rowtype;
begin
  select * into v_plan from public.project_material_plans where id = (p_input->>'planId')::uuid for update;
  if v_actor is null or not found or not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'edit') then
    raise exception using errcode = '42501', message = 'MATERIAL_PLAN_EDIT_DENIED'; end if;
  if v_plan.status not in ('draft', 'returned') then raise exception using errcode = 'PT409', message = 'MATERIAL_PLAN_NOT_EDITABLE'; end if;
  if v_plan.row_version <> coalesce((p_input->>'expectedRowVersion')::bigint, -1) then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  if jsonb_typeof(p_input->'lines') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'MATERIAL_PLAN_LINES_REQUIRED'; end if;
  if nullif(p_input->>'destinationWarehouseId', '') is not null and not exists (select 1 from public.warehouses w
    where w.id = p_input->>'destinationWarehouseId' and w.project_id = v_plan.project_id) then
    raise exception using errcode = '22023', message = 'MATERIAL_PLAN_WAREHOUSE_INVALID'; end if;
  if exists (select 1 from jsonb_array_elements(p_input->'lines') x
    where nullif(x.value->>'requestedQty', '') is null or (x.value->>'requestedQty')::numeric < 0) then
    raise exception using errcode = '22023', message = 'MATERIAL_PLAN_QTY_INVALID'; end if;
  if exists (select 1 from jsonb_array_elements(p_input->'lines') x where not exists (
    select 1 from public.project_material_plan_lines l where l.plan_id = v_plan.id and l.id = (x.value->>'id')::uuid)) then
    raise exception using errcode = '22023', message = 'MATERIAL_PLAN_LINE_INVALID'; end if;
  update public.project_material_plan_lines l set requested_qty = (x.value->>'requestedQty')::numeric,
    needed_date = nullif(x.value->>'neededDate', '')::date,
    over_reason = nullif(btrim(x.value->>'overReason'), ''), note = nullif(btrim(x.value->>'note'), '')
  from jsonb_array_elements(p_input->'lines') x
  where l.plan_id = v_plan.id and l.id = (x.value->>'id')::uuid;
  update public.project_material_plans set note = nullif(btrim(p_input->>'note'), ''),
    needed_date = nullif(p_input->>'neededDate', '')::date,
    destination_warehouse_id = coalesce(nullif(p_input->>'destinationWarehouseId', ''), destination_warehouse_id),
    updated_by = v_actor, updated_at = now(), row_version = row_version + 1
  where id = v_plan.id returning * into v_plan;
  insert into public.project_material_plan_events (plan_id, action, actor_id) values (v_plan.id, 'save', v_actor);
  return jsonb_build_object('planId', v_plan.id, 'rowVersion', v_plan.row_version, 'status', v_plan.status);
end;
$$;

-- Lines whose request would take the material past its BOQ quantity.
create function app_private.material_plan_over_boq_lines(p_plan public.project_material_plans)
returns table (line_id uuid, item_name text, over_reason text)
language sql stable security definer set search_path = '' as $$
  select l.id, l.item_name_snapshot, l.over_reason
  from public.project_material_plan_lines l
  left join lateral app_private.material_plan_item_position(p_plan.project_id, p_plan.construction_site_id, l.item_id, l.unit) pos on true
  where l.plan_id = p_plan.id and l.requested_qty > 0
    and coalesce(pos.boq_qty, 0) > 0
    -- Rounding tolerance: derived needs are rounded to 3 decimals.
    and coalesce(pos.issued_qty, 0) + l.requested_qty > pos.boq_qty * 1.0001 + 0.001;
$$;

create function public.transition_project_material_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_material_plans%rowtype;
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_to uuid := nullif(p_input->>'recipientUserId', '')::uuid;
  v_label text; v_missing text;
begin
  select * into v_plan from public.project_material_plans where id = (p_input->>'planId')::uuid for update;
  if v_actor is null or not found then raise exception using errcode = '42501', message = 'MATERIAL_PLAN_ACTION_DENIED'; end if;
  if v_plan.row_version <> coalesce((p_input->>'expectedRowVersion')::bigint, -1) then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  v_label := 'Kế hoạch vật tư ' || case v_plan.period_type when 'month' then 'tháng ' || to_char(v_plan.period_start, 'MM/YYYY')
    else 'tuần ' || to_char(v_plan.period_start, 'DD/MM') || '–' || to_char(v_plan.period_end, 'DD/MM/YYYY') end;

  if v_action = 'submit' then
    if not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'submit') then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_SUBMIT_DENIED'; end if;
    if v_plan.status not in ('draft', 'returned') then raise exception using errcode = 'PT409', message = 'MATERIAL_PLAN_NOT_EDITABLE'; end if;
    if not exists (select 1 from public.project_material_plan_lines where plan_id = v_plan.id and requested_qty > 0) then
      raise exception using errcode = '22023', message = 'MATERIAL_PLAN_EMPTY'; end if;
    select string_agg(o.item_name, ', ') into v_missing
      from app_private.material_plan_over_boq_lines(v_plan) o where nullif(btrim(o.over_reason), '') is null;
    if v_missing is not null then
      raise exception using errcode = '22023', message = 'MATERIAL_PLAN_OVER_BOQ_REASON_REQUIRED', detail = v_missing; end if;
    if v_to is not null and not app_private.project_actor_has_effective_room_action(v_to, v_plan.project_id,
      v_plan.construction_site_id, 'work_plan', 'verify') then
      raise exception using errcode = '22023', message = 'MATERIAL_PLAN_APPROVER_INVALID'; end if;
    update public.project_material_plans set status = 'submitted', submitted_by = v_actor, submitted_at = now(),
      submitted_to_user_id = v_to, updated_by = v_actor, updated_at = now(), row_version = row_version + 1
    where id = v_plan.id returning * into v_plan;
    perform app_private.material_plan_notify(v_plan,
      case when v_to is not null then array[v_to]
        else app_private.work_plan_room_holders(v_plan.project_id, v_plan.construction_site_id, 'verify') end,
      v_actor, v_label || ' chờ duyệt', coalesce((select name from public.users where id = v_actor), 'Người lập') || ' gửi ' || lower(left(v_label, 1)) || substr(v_label, 2) || ' để duyệt.',
      'material_plan_submitted', 'info');
  elsif v_action = 'withdraw' then
    if v_plan.status <> 'submitted' or v_plan.submitted_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_WITHDRAW_DENIED'; end if;
    update public.project_material_plans set status = 'draft', updated_by = v_actor, updated_at = now(), row_version = row_version + 1
    where id = v_plan.id returning * into v_plan;
  elsif v_action in ('approve', 'return') then
    if not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'verify') then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_APPROVE_DENIED'; end if;
    if v_plan.status <> 'submitted' then raise exception using errcode = 'PT409', message = 'MATERIAL_PLAN_NOT_SUBMITTED'; end if;
    if v_action = 'return' then
      if v_reason is null then raise exception using errcode = '22023', message = 'MATERIAL_PLAN_RETURN_REASON_REQUIRED'; end if;
      update public.project_material_plans set status = 'returned', returned_by = v_actor, returned_at = now(), return_reason = v_reason,
        updated_by = v_actor, updated_at = now(), row_version = row_version + 1
      where id = v_plan.id returning * into v_plan;
      perform app_private.material_plan_notify(v_plan,
        array[v_plan.created_by, v_plan.submitted_by], v_actor, v_label || ' bị trả lại', 'Lý do: ' || left(v_reason, 300),
        'material_plan_returned', 'warning');
    else
      update public.project_material_plans set status = 'superseded', updated_at = now(), row_version = row_version + 1
      where project_id = v_plan.project_id and construction_site_id is not distinct from v_plan.construction_site_id
        and period_type = v_plan.period_type and period_start = v_plan.period_start and status = 'approved';
      if v_plan.supersedes_plan_id is not null then
        insert into public.project_material_plan_events (plan_id, action, actor_id, detail)
        values (v_plan.supersedes_plan_id, 'supersede', v_actor, jsonb_build_object('byPlanId', v_plan.id));
      end if;
      update public.project_material_plans set status = 'approved', approved_by = v_actor, approved_at = now(),
        updated_by = v_actor, updated_at = now(), row_version = row_version + 1
      where id = v_plan.id returning * into v_plan;
      perform app_private.material_plan_notify(v_plan,
        array[v_plan.created_by, v_plan.submitted_by], v_actor, v_label || ' đã được duyệt',
        coalesce((select name from public.users where id = v_actor), 'Người duyệt') || ' đã duyệt.', 'material_plan_approved', 'success');
    end if;
  elsif v_action = 'delete' then
    if v_plan.status <> 'draft' or v_plan.submitted_at is not null
      or not (v_plan.created_by = v_actor or app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'delete')) then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_DELETE_DENIED'; end if;
    delete from public.project_material_plans where id = v_plan.id;
    return jsonb_build_object('planId', v_plan.id, 'deleted', true);
  else
    raise exception using errcode = '22023', message = 'MATERIAL_PLAN_ACTION_INVALID';
  end if;
  insert into public.project_material_plan_events (plan_id, action, actor_id, reason) values (v_plan.id, v_action, v_actor, v_reason);
  return jsonb_build_object('planId', v_plan.id, 'rowVersion', v_plan.row_version, 'status', v_plan.status);
end;
$$;

-- A revision is re-derived from the latest approved work plan of the period,
-- keeping requested quantities the planner already set for the same material.
create function public.revise_project_material_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_material_plans%rowtype;
  v_new public.project_material_plans%rowtype;
  v_work uuid;
  v_reason text := nullif(btrim(p_input->>'reason'), '');
begin
  select * into v_plan from public.project_material_plans where id = (p_input->>'planId')::uuid for update;
  if v_actor is null or not found or not app_private.work_plan_can(v_plan.project_id, v_plan.construction_site_id, 'edit') then
    raise exception using errcode = '42501', message = 'MATERIAL_PLAN_EDIT_DENIED'; end if;
  if v_plan.status <> 'approved' then raise exception using errcode = 'PT409', message = 'MATERIAL_PLAN_NOT_APPROVED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'MATERIAL_PLAN_REVISION_REASON_REQUIRED'; end if;
  if exists (select 1 from public.project_material_plans where project_id = v_plan.project_id
    and construction_site_id is not distinct from v_plan.construction_site_id and period_type = v_plan.period_type
    and period_start = v_plan.period_start and status in ('draft', 'submitted', 'returned')) then
    raise exception using errcode = '23505', message = 'MATERIAL_PLAN_ALREADY_OPEN'; end if;
  select id into v_work from public.project_work_plans where project_id = v_plan.project_id
    and construction_site_id is not distinct from v_plan.construction_site_id and period_type = v_plan.period_type
    and period_start = v_plan.period_start and status = 'approved';
  insert into public.project_material_plans (work_plan_id, project_id, construction_site_id, period_type, period_start, period_end,
    code, revision_no, supersedes_plan_id, destination_warehouse_id, needed_date, note, created_by, updated_by)
  values (coalesce(v_work, v_plan.work_plan_id), v_plan.project_id, v_plan.construction_site_id, v_plan.period_type,
    v_plan.period_start, v_plan.period_end, v_plan.code,
    (select max(revision_no) + 1 from public.project_material_plans where project_id = v_plan.project_id
      and construction_site_id is not distinct from v_plan.construction_site_id and period_type = v_plan.period_type
      and period_start = v_plan.period_start),
    v_plan.id, v_plan.destination_warehouse_id, v_plan.needed_date, v_plan.note, v_actor, v_actor)
  returning * into v_new;
  perform app_private.material_plan_fill_lines(v_new);
  update public.project_material_plan_lines n set requested_qty = o.requested_qty, needed_date = o.needed_date,
    over_reason = o.over_reason, note = o.note
  from public.project_material_plan_lines o
  where n.plan_id = v_new.id and o.plan_id = v_plan.id and o.item_id = n.item_id and o.unit = n.unit;
  insert into public.project_material_plan_events (plan_id, action, actor_id, reason, detail)
  values (v_new.id, 'revise', v_actor, v_reason, jsonb_build_object('fromPlanId', v_plan.id, 'workPlanId', v_new.work_plan_id));
  return jsonb_build_object('planId', v_new.id, 'rowVersion', v_new.row_version, 'status', v_new.status);
end;
$$;

revoke all on function app_private.material_plan_derive(uuid), app_private.material_plan_gaps(uuid),
  app_private.material_plan_item_position(text, text, text, text), app_private.material_plan_json(uuid),
  app_private.material_plan_fill_lines(public.project_material_plans),
  app_private.material_plan_over_boq_lines(public.project_material_plans),
  app_private.material_plan_notify(public.project_material_plans, uuid[], uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_project_material_plan_board_v1(text, text, text, date),
  public.create_project_material_plan_v1(jsonb), public.save_project_material_plan_v1(jsonb),
  public.transition_project_material_plan_v1(jsonb), public.revise_project_material_plan_v1(jsonb) from public, anon;
grant execute on function public.get_project_material_plan_board_v1(text, text, text, date),
  public.create_project_material_plan_v1(jsonb), public.save_project_material_plan_v1(jsonb),
  public.transition_project_material_plan_v1(jsonb), public.revise_project_material_plan_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';

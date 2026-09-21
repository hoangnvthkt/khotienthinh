-- G4 material-plan aggregate. Draft plans are planning records only: they do
-- not reserve stock, create procurement demand, or bypass material-request approval.

create table public.material_plans (
  id uuid primary key default gen_random_uuid(),
  owner_context_id uuid not null references public.procurement_owner_contexts(id) on delete restrict,
  plan_no text not null unique check (btrim(plan_no) <> ''),
  project_id text not null,
  construction_site_id text,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  period_start date not null,
  period_end date not null,
  note text,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'superseded', 'cancelled')),
  current_version bigint not null default 1 check (current_version > 0),
  source_hash text not null check (length(source_hash) = 64),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table public.material_plan_lines (
  id uuid primary key,
  plan_id uuid not null references public.material_plans(id) on delete restrict,
  item_id text not null check (btrim(item_id) <> ''),
  sku_snapshot text,
  item_name_snapshot text not null check (btrim(item_name_snapshot) <> ''),
  unit text not null check (btrim(unit) <> ''),
  quantity numeric(20,6) not null check (quantity > 0),
  needed_date date not null,
  destination text not null check (btrim(destination) <> ''),
  first_revision bigint not null check (first_revision > 0),
  last_revision bigint not null check (last_revision >= first_revision),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, id)
);

create table public.material_plan_allocations (
  id uuid primary key,
  plan_id uuid not null references public.material_plans(id) on delete restrict,
  plan_line_id uuid not null references public.material_plan_lines(id) on delete restrict,
  source_budget_line_id text not null references public.material_budget_items(id) on delete restrict,
  source_work_boq_item_id text references public.project_work_boq_items(id) on delete restrict,
  source_task_id text references public.project_tasks(id) on delete restrict,
  quantity numeric(20,6) not null check (quantity > 0),
  needed_date date not null,
  destination text not null check (btrim(destination) <> ''),
  first_revision bigint not null check (first_revision > 0),
  last_revision bigint not null check (last_revision >= first_revision),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, id)
);

create table public.material_plan_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.material_plans(id) on delete restrict,
  version bigint not null check (version > 0),
  source_hash text not null check (length(source_hash) = 64),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  changed_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (plan_id, version),
  unique (plan_id, source_hash)
);

create table public.material_plan_conversions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.material_plans(id) on delete restrict,
  plan_revision bigint not null check (plan_revision > 0),
  allocation_id uuid not null references public.material_plan_allocations(id) on delete restrict,
  request_id text not null references public.requests(id) on delete restrict,
  request_line_id text not null check (btrim(request_line_id) <> ''),
  quantity numeric(20,6) not null check (quantity > 0),
  unit text not null check (btrim(unit) <> ''),
  state text not null default 'active' check (state in ('active', 'reversed')),
  command_id uuid not null references app_private.procurement_commands(id) on delete restrict,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  unique (command_id, allocation_id),
  unique (request_id, request_line_id, allocation_id)
);

create table app_private.material_plan_code_counters (
  year integer primary key check (year between 2000 and 2999),
  value bigint not null check (value > 0),
  updated_at timestamptz not null default now()
);

alter table public.material_plans enable row level security;
alter table public.material_plan_lines enable row level security;
alter table public.material_plan_allocations enable row level security;
alter table public.material_plan_revisions enable row level security;
alter table public.material_plan_conversions enable row level security;

revoke all on public.material_plans from public, anon, authenticated;
revoke all on public.material_plan_lines from public, anon, authenticated;
revoke all on public.material_plan_allocations from public, anon, authenticated;
revoke all on public.material_plan_revisions from public, anon, authenticated;
revoke all on public.material_plan_conversions from public, anon, authenticated;
revoke all on app_private.material_plan_code_counters from public, anon, authenticated;
grant all on public.material_plans to service_role;
grant all on public.material_plan_lines to service_role;
grant all on public.material_plan_allocations to service_role;
grant all on public.material_plan_revisions to service_role;
grant all on public.material_plan_conversions to service_role;

create index material_plans_scope_updated_idx
  on public.material_plans(project_id, construction_site_id, updated_at desc, id desc);
create index material_plan_lines_plan_active_idx
  on public.material_plan_lines(plan_id, archived_at, id);
create index material_plan_allocations_plan_active_idx
  on public.material_plan_allocations(plan_id, archived_at, source_budget_line_id, id);
create index material_plan_conversions_allocation_active_idx
  on public.material_plan_conversions(allocation_id, state, created_at);
create index material_plan_conversions_request_idx
  on public.material_plan_conversions(request_id, request_line_id);

create or replace function app_private.material_plan_revision_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'MATERIAL_PLAN_REVISION_IMMUTABLE';
end;
$$;
revoke all on function app_private.material_plan_revision_immutable() from public, anon, authenticated;

create trigger trg_material_plan_revision_immutable
before update or delete on public.material_plan_revisions
for each row execute function app_private.material_plan_revision_immutable();

create or replace function app_private.next_material_plan_no()
returns text language plpgsql security definer set search_path = '' as $$
declare v_year integer := extract(year from current_date)::integer; v_next bigint;
begin
  insert into app_private.material_plan_code_counters(year, value)
  values (v_year, 1)
  on conflict (year) do update set value = app_private.material_plan_code_counters.value + 1,
    updated_at = now()
  returning value into v_next;
  return 'MP-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;
revoke all on function app_private.next_material_plan_no() from public, anon, authenticated;

create or replace function app_private.material_plan_detail_json(
  p_plan_id uuid,
  p_actor uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_plan public.material_plans%rowtype; v_can_edit boolean; v_can_convert boolean; v_result jsonb;
begin
  select * into v_plan from public.material_plans where id = p_plan_id;
  if not found then return null; end if;
  if p_actor is null or not app_private.project_actor_has_effective_room_action(
    p_actor, v_plan.project_id, v_plan.construction_site_id, 'material_planning', 'view'
  ) then raise exception using errcode = '42501', message = 'MATERIAL_PLAN_READ_DENIED'; end if;
  v_can_edit := app_private.project_actor_has_effective_room_action(
    p_actor, v_plan.project_id, v_plan.construction_site_id, 'material_planning', 'edit'
  );
  v_can_convert := v_plan.status in ('draft', 'confirmed')
    and app_private.project_actor_has_effective_room_action(
      p_actor, v_plan.project_id, v_plan.construction_site_id, 'material_request', 'edit'
    );

  select jsonb_build_object(
    'id', v_plan.id, 'planNo', v_plan.plan_no, 'projectId', v_plan.project_id,
    'constructionSiteId', v_plan.construction_site_id, 'title', v_plan.title,
    'periodStart', v_plan.period_start::text, 'periodEnd', v_plan.period_end::text,
    'note', v_plan.note, 'status', v_plan.status, 'version', v_plan.current_version,
    'createdBy', v_plan.created_by, 'createdAt', v_plan.created_at,
    'updatedAt', v_plan.updated_at,
    'capabilities', jsonb_build_object('canEdit', v_can_edit, 'canConvert', v_can_convert),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.id, 'itemId', line.item_id, 'sku', line.sku_snapshot,
        'itemName', line.item_name_snapshot, 'unit', line.unit,
        'quantity', line.quantity::text,
        'convertedQty', coalesce(converted.converted_qty, 0)::numeric(20,6)::text,
        'remainingQty', greatest(line.quantity - coalesce(converted.converted_qty, 0), 0)::numeric(20,6)::text,
        'neededDate', line.needed_date::text, 'destination', line.destination,
        'allocations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', allocation.id, 'sourceBudgetLineId', allocation.source_budget_line_id,
            'sourceWorkBoqItemId', allocation.source_work_boq_item_id,
            'sourceTaskId', allocation.source_task_id, 'quantity', allocation.quantity::text,
            'convertedQty', coalesce(allocation_converted.converted_qty, 0)::numeric(20,6)::text,
            'remainingQty', greatest(allocation.quantity - coalesce(allocation_converted.converted_qty, 0), 0)::numeric(20,6)::text,
            'neededDate', allocation.needed_date::text, 'destination', allocation.destination
          ) order by allocation.id)
          from public.material_plan_allocations allocation
          left join lateral (
            select sum(conversion.quantity) converted_qty
            from public.material_plan_conversions conversion
            where conversion.allocation_id = allocation.id and conversion.state = 'active'
          ) allocation_converted on true
          where allocation.plan_line_id = line.id and allocation.archived_at is null
        ), '[]'::jsonb)
      ) order by line.needed_date, line.id)
      from public.material_plan_lines line
      left join lateral (
        select sum(conversion.quantity) converted_qty
        from public.material_plan_conversions conversion
        join public.material_plan_allocations allocation on allocation.id = conversion.allocation_id
        where allocation.plan_line_id = line.id and conversion.state = 'active'
      ) converted on true
      where line.plan_id = v_plan.id and line.archived_at is null
    ), '[]'::jsonb),
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version', revision.version, 'sourceHash', revision.source_hash,
        'changedBy', revision.changed_by, 'createdAt', revision.created_at
      ) order by revision.version desc)
      from public.material_plan_revisions revision where revision.plan_id = v_plan.id
    ), '[]'::jsonb),
    'conversions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', conversion.id, 'planVersion', conversion.plan_revision,
        'requestId', conversion.request_id, 'requestCode', request_row.code,
        'quantity', conversion.quantity::text, 'unit', conversion.unit,
        'state', conversion.state, 'createdAt', conversion.created_at
      ) order by conversion.created_at desc, conversion.id)
      from public.material_plan_conversions conversion
      join public.requests request_row on request_row.id = conversion.request_id
      where conversion.plan_id = v_plan.id
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function app_private.material_plan_detail_json(uuid, uuid) from public, anon, authenticated;

create or replace function app_private.get_material_plan_v1(
  p_plan_id uuid, p_project_id text, p_construction_site_id text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_plan public.material_plans%rowtype;
begin
  select * into v_plan from public.material_plans where id = p_plan_id;
  if not found then return null; end if;
  if v_plan.project_id is distinct from p_project_id
     or v_plan.construction_site_id is distinct from nullif(p_construction_site_id, '') then
    raise exception using errcode = '42501', message = 'MATERIAL_PLAN_SCOPE_MISMATCH';
  end if;
  return app_private.material_plan_detail_json(p_plan_id, v_actor);
end;
$$;
revoke all on function app_private.get_material_plan_v1(uuid, text, text) from public, anon, authenticated;

create function public.get_material_plan_v1(
  p_plan_id uuid, p_project_id text, p_construction_site_id text default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_material_plan_v1(
    p_plan_id, p_project_id, nullif(p_construction_site_id, '')
  );
$$;
revoke all on function public.get_material_plan_v1(uuid, text, text) from public, anon;
grant execute on function public.get_material_plan_v1(uuid, text, text) to authenticated, service_role;

create or replace function app_private.list_material_plans_v1(
  p_project_id text, p_construction_site_id text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_site text := nullif(p_construction_site_id, ''); v_result jsonb;
begin
  if v_actor is null or not app_private.project_actor_has_effective_room_action(
    v_actor, p_project_id, v_site, 'material_planning', 'view'
  ) then raise exception using errcode = '42501', message = 'MATERIAL_PLAN_READ_DENIED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', plan.id, 'planNo', plan.plan_no, 'title', plan.title,
    'periodStart', plan.period_start::text, 'periodEnd', plan.period_end::text,
    'status', plan.status, 'version', plan.current_version,
    'lineCount', coalesce(summary.line_count, 0),
    'remainingAllocationCount', coalesce(summary.remaining_count, 0),
    'updatedAt', plan.updated_at
  ) order by plan.updated_at desc, plan.id desc), '[]'::jsonb) into v_result
  from public.material_plans plan
  left join lateral (
    select count(distinct line.id)::integer line_count,
      count(*) filter (where allocation.quantity > coalesce(converted.converted_qty, 0))::integer remaining_count
    from public.material_plan_lines line
    join public.material_plan_allocations allocation on allocation.plan_line_id = line.id and allocation.archived_at is null
    left join lateral (
      select sum(conversion.quantity) converted_qty from public.material_plan_conversions conversion
      where conversion.allocation_id = allocation.id and conversion.state = 'active'
    ) converted on true
    where line.plan_id = plan.id and line.archived_at is null
  ) summary on true
  where plan.project_id = p_project_id and plan.construction_site_id is not distinct from v_site;
  return v_result;
end;
$$;
revoke all on function app_private.list_material_plans_v1(text, text) from public, anon, authenticated;

create function public.list_material_plans_v1(
  p_project_id text, p_construction_site_id text default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.list_material_plans_v1(
    p_project_id, nullif(p_construction_site_id, '')
  );
$$;
revoke all on function public.list_material_plans_v1(text, text) from public, anon;
grant execute on function public.list_material_plans_v1(text, text) to authenticated, service_role;

create or replace function app_private.save_material_plan_v1(
  p_plan_id uuid, p_project_id text, p_construction_site_id text, p_expected_version bigint,
  p_title text, p_period_start date, p_period_end date, p_note text, p_status text,
  p_lines jsonb, p_payload_schema_version integer, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_owner public.procurement_owner_contexts%rowtype;
  v_plan public.material_plans%rowtype;
  v_command app_private.procurement_commands%rowtype;
  v_document public.procurement_source_documents%rowtype;
  v_plan_id uuid := coalesce(p_plan_id, gen_random_uuid());
  v_version bigint;
  v_hash text;
  v_command_hash text;
  v_payload jsonb;
  v_line jsonb;
  v_allocation jsonb;
  v_line_id uuid;
  v_allocation_id uuid;
  v_line_total numeric(20,6);
  v_allocation_total numeric(20,6);
  v_budget public.material_budget_items%rowtype;
  v_work public.project_work_boq_items%rowtype;
  v_registry_hash text;
  v_result jsonb;
begin
  if v_actor is null or nullif(btrim(coalesce(p_project_id, '')), '') is null
     or nullif(btrim(coalesce(p_title, '')), '') is null or char_length(btrim(p_title)) > 200
     or p_period_start is null or p_period_end is null or p_period_end < p_period_start
     or p_status not in ('draft', 'confirmed') or p_payload_schema_version <> 1
     or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or (p_plan_id is null) <> (p_expected_version is null)
     or (p_expected_version is not null and p_expected_version < 1) then
    raise exception using errcode = '22023', message = 'MATERIAL_PLAN_COMMAND_INVALID';
  end if;
  if not app_private.project_actor_has_effective_room_action(
    v_actor, p_project_id, nullif(p_construction_site_id, ''), 'material_planning', 'edit'
  ) then raise exception using errcode = '42501', message = 'MATERIAL_PLAN_WRITE_DENIED'; end if;

  select * into strict v_owner from public.procurement_owner_contexts
  where logical_key = 'company_default' and is_active for update;

  if p_plan_id is not null then
    select * into v_plan from public.material_plans where id = p_plan_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'MATERIAL_PLAN_NOT_FOUND'; end if;
    if v_plan.project_id is distinct from p_project_id
       or v_plan.construction_site_id is distinct from nullif(p_construction_site_id, '') then
      raise exception using errcode = '42501', message = 'MATERIAL_PLAN_SCOPE_MISMATCH';
    end if;
  end if;

  v_payload := jsonb_build_object(
    'projectId', p_project_id,
    'constructionSiteId', nullif(p_construction_site_id, ''),
    'title', btrim(p_title),
    'periodStart', p_period_start, 'periodEnd', p_period_end,
    'note', nullif(btrim(coalesce(p_note, '')), ''), 'status', p_status,
    'lines', p_lines
  );
  v_hash := encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
  v_command_hash := encode(extensions.digest(jsonb_build_object(
    'planId', p_plan_id, 'expectedVersion', p_expected_version,
    'sourceHash', v_hash, 'payloadSchemaVersion', p_payload_schema_version
  )::text, 'sha256'), 'hex');
  insert into app_private.procurement_commands(
    owner_context_id, command_type, idempotency_key, actor_user_id, payload_hash
  ) values (v_owner.id, 'save_material_plan', p_idempotency_key, v_actor, v_command_hash)
  on conflict (owner_context_id, command_type, idempotency_key) do nothing;
  select * into strict v_command from app_private.procurement_commands
  where owner_context_id = v_owner.id and command_type = 'save_material_plan'
    and idempotency_key = p_idempotency_key for update;
  if v_command.actor_user_id is distinct from v_actor or v_command.payload_hash <> v_command_hash then
    raise exception using errcode = '40001', message = 'PROCUREMENT_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.result is not null then
    return jsonb_set(v_command.result, '{command,outcome}', '"replayed"'::jsonb);
  end if;
  if p_plan_id is not null and v_plan.current_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'MATERIAL_PLAN_VERSION_CONFLICT';
  end if;
  if p_plan_id is not null and v_plan.status in ('superseded', 'cancelled') then
    raise exception using errcode = '23514', message = 'MATERIAL_PLAN_IMMUTABLE';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) line(value)
    group by line.value ->> 'id' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(p_lines) line(value)
    cross join lateral jsonb_array_elements(line.value -> 'allocations') allocation(value)
    group by allocation.value ->> 'id' having count(*) > 1
  ) then raise exception using errcode = '22023', message = 'MATERIAL_PLAN_ID_DUPLICATE'; end if;

  -- Every competing conversion locks these BOQ sources in the same lexical order.
  perform budget.id
  from public.material_budget_items budget
  join (
    select distinct allocation.value ->> 'sourceBudgetLineId' budget_id
    from jsonb_array_elements(p_lines) line(value)
    cross join lateral jsonb_array_elements(line.value -> 'allocations') allocation(value)
  ) source on source.budget_id = budget.id
  order by budget.id
  for update of budget;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin v_line_id := (v_line ->> 'id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'MATERIAL_PLAN_LINE_ID_INVALID';
    end;
    if nullif(v_line ->> 'itemId', '') is null or nullif(btrim(v_line ->> 'itemName'), '') is null
       or nullif(btrim(v_line ->> 'unit'), '') is null
       or coalesce(v_line ->> 'quantity', '') !~ '^\d+(\.\d{1,6})?$'
       or (v_line ->> 'quantity')::numeric <= 0
       or coalesce(v_line ->> 'neededDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or nullif(btrim(v_line ->> 'destination'), '') is null
       or jsonb_typeof(v_line -> 'allocations') <> 'array'
       or jsonb_array_length(v_line -> 'allocations') = 0 then
      raise exception using errcode = '22023', message = 'MATERIAL_PLAN_LINE_INVALID';
    end if;
    v_line_total := (v_line ->> 'quantity')::numeric(20,6);
    v_allocation_total := 0;
    for v_allocation in select value from jsonb_array_elements(v_line -> 'allocations')
    loop
      begin v_allocation_id := (v_allocation ->> 'id')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'MATERIAL_PLAN_ALLOCATION_ID_INVALID';
      end;
      if coalesce(v_allocation ->> 'quantity', '') !~ '^\d+(\.\d{1,6})?$'
         or (v_allocation ->> 'quantity')::numeric <= 0
         or coalesce(v_allocation ->> 'neededDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
         or nullif(btrim(v_allocation ->> 'destination'), '') is null then
        raise exception using errcode = '22023', message = 'MATERIAL_PLAN_ALLOCATION_INVALID';
      end if;
      select * into v_budget from public.material_budget_items
      where id = v_allocation ->> 'sourceBudgetLineId';
      if not found or v_budget.project_id is distinct from p_project_id
         or v_budget.construction_site_id is distinct from nullif(p_construction_site_id, '')
         or v_budget.inventory_item_id is distinct from (v_line ->> 'itemId')
         or v_budget.unit is distinct from (v_line ->> 'unit')
         or v_budget.work_boq_item_id is distinct from nullif(v_allocation ->> 'sourceWorkBoqItemId', '') then
        raise exception using errcode = '23514', message = 'MATERIAL_PLAN_SOURCE_IDENTITY_MISMATCH';
      end if;
      if v_budget.work_boq_item_id is not null then
        select * into v_work from public.project_work_boq_items where id = v_budget.work_boq_item_id;
        if not found or v_work.project_id is distinct from p_project_id
           or v_work.construction_site_id is distinct from nullif(p_construction_site_id, '')
           or v_work.source_task_id is distinct from nullif(v_allocation ->> 'sourceTaskId', '') then
          raise exception using errcode = '23514', message = 'MATERIAL_PLAN_SOURCE_IDENTITY_MISMATCH';
        end if;
      elsif nullif(v_allocation ->> 'sourceTaskId', '') is not null then
        raise exception using errcode = '23514', message = 'MATERIAL_PLAN_SOURCE_IDENTITY_MISMATCH';
      end if;
      v_allocation_total := v_allocation_total + (v_allocation ->> 'quantity')::numeric(20,6);
    end loop;
    if v_allocation_total <> v_line_total then
      raise exception using errcode = '22023', message = 'MATERIAL_PLAN_LINE_TOTAL_MISMATCH';
    end if;
  end loop;

  if p_plan_id is not null and exists (
    select 1
    from public.material_plan_allocations existing
    left join lateral (
      select sum(conversion.quantity) converted_qty
      from public.material_plan_conversions conversion
      where conversion.allocation_id = existing.id and conversion.state = 'active'
    ) converted on true
    left join lateral (
      select (allocation.value ->> 'quantity')::numeric(20,6) quantity
      from jsonb_array_elements(p_lines) line(value)
      cross join lateral jsonb_array_elements(line.value -> 'allocations') allocation(value)
      where allocation.value ->> 'id' = existing.id::text
    ) incoming on true
    where existing.plan_id = p_plan_id and existing.archived_at is null
      and coalesce(converted.converted_qty, 0) > coalesce(incoming.quantity, 0)
  ) then raise exception using errcode = '40001', message = 'MATERIAL_PLAN_REVISION_BELOW_CONVERTED'; end if;

  if p_plan_id is not null and v_plan.source_hash = v_hash then
    v_result := jsonb_build_object(
      'plan', app_private.material_plan_detail_json(v_plan.id, v_actor),
      'command', jsonb_build_object('commandId', v_command.id, 'outcome', 'committed')
    );
    update app_private.procurement_commands set result = v_result, committed_at = now() where id = v_command.id;
    return v_result;
  end if;

  v_version := case when p_plan_id is null then 1 else v_plan.current_version + 1 end;
  if p_plan_id is null then
    insert into public.material_plans(
      id, owner_context_id, plan_no, project_id, construction_site_id, title,
      period_start, period_end, note, status, current_version, source_hash,
      created_by, updated_by
    ) values (
      v_plan_id, v_owner.id, app_private.next_material_plan_no(), p_project_id,
      nullif(p_construction_site_id, ''), btrim(p_title), p_period_start, p_period_end,
      nullif(btrim(coalesce(p_note, '')), ''), p_status, v_version, v_hash, v_actor, v_actor
    ) returning * into v_plan;
  else
    update public.material_plans set title = btrim(p_title), period_start = p_period_start,
      period_end = p_period_end, note = nullif(btrim(coalesce(p_note, '')), ''),
      status = p_status, current_version = v_version, source_hash = v_hash,
      updated_by = v_actor, updated_at = now()
    where id = p_plan_id returning * into v_plan;
  end if;

  update public.material_plan_allocations allocation set archived_at = now(),
    last_revision = v_version, updated_at = now()
  where allocation.plan_id = v_plan.id and allocation.archived_at is null
    and not exists (
      select 1 from jsonb_array_elements(p_lines) line(value)
      cross join lateral jsonb_array_elements(line.value -> 'allocations') incoming(value)
      where incoming.value ->> 'id' = allocation.id::text
    );
  update public.material_plan_lines line set archived_at = now(),
    last_revision = v_version, updated_at = now()
  where line.plan_id = v_plan.id and line.archived_at is null
    and not exists (select 1 from jsonb_array_elements(p_lines) incoming(value)
      where incoming.value ->> 'id' = line.id::text);

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_id := (v_line ->> 'id')::uuid;
    if exists (
      select 1 from public.material_plan_lines existing
      where existing.id = v_line_id and existing.plan_id <> v_plan.id
    ) then raise exception using errcode = '23514', message = 'MATERIAL_PLAN_LINE_OWNER_MISMATCH'; end if;
    if exists (
      select 1 from public.material_plan_lines existing
      where existing.id = v_line_id and existing.plan_id = v_plan.id
        and (existing.item_id is distinct from (v_line ->> 'itemId')
          or existing.unit is distinct from (v_line ->> 'unit'))
        and (
          exists (select 1 from public.material_plan_conversions conversion
            join public.material_plan_allocations allocation on allocation.id = conversion.allocation_id
            where allocation.plan_line_id = existing.id and conversion.state = 'active')
          or exists (
            select 1 from public.procurement_source_line_registry registry
            join public.procurement_source_documents document on document.id = registry.source_document_id
            where document.source_adapter = 'material_plan'
              and document.source_document_id = v_plan.id::text
              and registry.source_line_id = existing.id::text
              and registry.downstream_locked
          )
        )
    ) then raise exception using errcode = '23514', message = 'MATERIAL_PLAN_LINE_IDENTITY_LOCKED'; end if;
    insert into public.material_plan_lines(
      id, plan_id, item_id, sku_snapshot, item_name_snapshot, unit, quantity,
      needed_date, destination, first_revision, last_revision, archived_at
    ) values (
      v_line_id, v_plan.id, v_line ->> 'itemId', nullif(v_line ->> 'sku', ''),
      v_line ->> 'itemName', v_line ->> 'unit', (v_line ->> 'quantity')::numeric,
      (v_line ->> 'neededDate')::date, btrim(v_line ->> 'destination'), v_version, v_version, null
    ) on conflict (id) do update set
      sku_snapshot = excluded.sku_snapshot, item_name_snapshot = excluded.item_name_snapshot,
      quantity = excluded.quantity, needed_date = excluded.needed_date,
      destination = excluded.destination, last_revision = excluded.last_revision,
      archived_at = null, updated_at = now();

    for v_allocation in select value from jsonb_array_elements(v_line -> 'allocations')
    loop
      v_allocation_id := (v_allocation ->> 'id')::uuid;
      if exists (
        select 1 from public.material_plan_allocations existing
        where existing.id = v_allocation_id and existing.plan_id <> v_plan.id
      ) then raise exception using errcode = '23514', message = 'MATERIAL_PLAN_ALLOCATION_OWNER_MISMATCH'; end if;
      if exists (
        select 1 from public.material_plan_allocations existing
        where existing.id = v_allocation_id and existing.plan_id = v_plan.id
          and (existing.plan_line_id <> v_line_id
            or existing.source_budget_line_id is distinct from (v_allocation ->> 'sourceBudgetLineId'))
          and exists (select 1 from public.material_plan_conversions conversion
            where conversion.allocation_id = existing.id and conversion.state = 'active')
      ) then raise exception using errcode = '23514', message = 'MATERIAL_PLAN_ALLOCATION_IDENTITY_LOCKED'; end if;
      insert into public.material_plan_allocations(
        id, plan_id, plan_line_id, source_budget_line_id, source_work_boq_item_id,
        source_task_id, quantity, needed_date, destination, first_revision, last_revision, archived_at
      ) values (
        v_allocation_id, v_plan.id, v_line_id, v_allocation ->> 'sourceBudgetLineId',
        nullif(v_allocation ->> 'sourceWorkBoqItemId', ''), nullif(v_allocation ->> 'sourceTaskId', ''),
        (v_allocation ->> 'quantity')::numeric, (v_allocation ->> 'neededDate')::date,
        btrim(v_allocation ->> 'destination'), v_version, v_version, null
      ) on conflict (id) do update set
        quantity = excluded.quantity, needed_date = excluded.needed_date,
        destination = excluded.destination, last_revision = excluded.last_revision,
        archived_at = null, updated_at = now();
    end loop;
  end loop;

  if current_setting('app.material_plan_fail_after_rows', true) = 'on' then
    raise exception using errcode = 'P0001', message = 'MATERIAL_PLAN_FAULT_AFTER_ROWS';
  end if;

  insert into public.material_plan_revisions(plan_id, version, source_hash, payload, changed_by)
  values (v_plan.id, v_version, v_hash, v_payload, v_actor);

  select * into v_document from public.procurement_source_documents
  where owner_context_id = v_owner.id and source_adapter = 'material_plan'
    and source_document_id = v_plan.id::text for update;
  if not found then
    insert into public.procurement_source_documents(
      owner_context_id, source_adapter, source_document_id, source_code_snapshot,
      project_id, construction_site_id, current_revision, source_hash
    ) values (
      v_owner.id, 'material_plan', v_plan.id::text, v_plan.plan_no,
      v_plan.project_id, v_plan.construction_site_id, v_version, v_hash
    ) returning * into v_document;
  else
    update public.procurement_source_documents set source_code_snapshot = v_plan.plan_no,
      project_id = v_plan.project_id, construction_site_id = v_plan.construction_site_id,
      current_revision = v_version, source_hash = v_hash, archived_at = null, updated_at = now()
    where id = v_document.id returning * into v_document;
  end if;
  insert into public.procurement_source_revisions(source_document_id, revision, source_hash, payload, changed_by)
  values (v_document.id, v_version, v_hash, v_payload, v_actor);
  update public.procurement_source_line_registry registry set archived_at = now(),
    last_revision = v_version, updated_at = now()
  where registry.source_document_id = v_document.id and registry.archived_at is null
    and not exists (select 1 from jsonb_array_elements(p_lines) line(value)
      where line.value ->> 'id' = registry.source_line_id);
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_registry_hash := encode(extensions.digest(jsonb_build_object(
      'lineId', v_line ->> 'id', 'itemId', v_line ->> 'itemId',
      'unit', v_line ->> 'unit', 'quantity', v_line ->> 'quantity'
    )::text, 'sha256'), 'hex');
    insert into public.procurement_source_line_registry(
      source_document_id, source_line_id, item_id, unit, source_hash,
      first_revision, last_revision, archived_at
    ) values (
      v_document.id, v_line ->> 'id', v_line ->> 'itemId', v_line ->> 'unit',
      v_registry_hash, v_version, v_version, null
    ) on conflict (source_document_id, source_line_id) do update set
      item_id = excluded.item_id, unit = excluded.unit,
      source_hash = excluded.source_hash, last_revision = excluded.last_revision,
      archived_at = null, updated_at = now();
  end loop;
  insert into app_private.procurement_events_outbox(
    owner_context_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, payload, actor_user_id
  ) values (
    v_owner.id, 'material_plan', v_plan.id, v_version, 'material_plan.saved',
    jsonb_build_object('planId', v_plan.id, 'planNo', v_plan.plan_no,
      'version', v_version, 'projectId', v_plan.project_id,
      'constructionSiteId', v_plan.construction_site_id), v_actor
  );
  v_result := jsonb_build_object(
    'plan', app_private.material_plan_detail_json(v_plan.id, v_actor),
    'command', jsonb_build_object('commandId', v_command.id, 'outcome', 'committed')
  );
  update app_private.procurement_commands set result = v_result, committed_at = now()
  where id = v_command.id;
  return v_result;
end;
$$;
revoke all on function app_private.save_material_plan_v1(uuid, text, text, bigint, text, date, date, text, text, jsonb, integer, text) from public, anon, authenticated;

create function public.save_material_plan_v1(
  p_plan_id uuid, p_project_id text, p_construction_site_id text, p_expected_version bigint,
  p_title text, p_period_start date, p_period_end date, p_note text, p_status text,
  p_lines jsonb, p_payload_schema_version integer, p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.save_material_plan_v1(
    p_plan_id, p_project_id, nullif(p_construction_site_id, ''), p_expected_version,
    p_title, p_period_start, p_period_end, p_note, p_status, p_lines,
    p_payload_schema_version, p_idempotency_key
  );
$$;
revoke all on function public.save_material_plan_v1(uuid, text, text, bigint, text, date, date, text, text, jsonb, integer, text) from public, anon;
grant execute on function public.save_material_plan_v1(uuid, text, text, bigint, text, date, date, text, text, jsonb, integer, text) to authenticated, service_role;

create or replace function app_private.convert_material_plan_to_request_v1(
  p_plan_id uuid, p_expected_version bigint, p_site_warehouse_id text,
  p_fulfillment_mode text, p_allocations jsonb, p_payload_schema_version integer,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_owner public.procurement_owner_contexts%rowtype;
  v_plan public.material_plans%rowtype;
  v_command app_private.procurement_commands%rowtype;
  v_payload_hash text;
  v_allocation public.material_plan_allocations%rowtype;
  v_line public.material_plan_lines%rowtype;
  v_budget public.material_budget_items%rowtype;
  v_work public.project_work_boq_items%rowtype;
  v_input jsonb;
  v_qty numeric(20,6);
  v_converted numeric(20,6);
  v_requested numeric(20,6);
  v_issued numeric(20,6);
  v_open numeric(20,6);
  v_draft_converted numeric(20,6);
  v_request_id text := gen_random_uuid()::text;
  v_request_code text;
  v_request_line_id text;
  v_items jsonb := '[]'::jsonb;
  v_links jsonb := '[]'::jsonb;
  v_total numeric(20,6) := 0;
  v_result jsonb;
  v_group record;
begin
  if v_actor is null or p_plan_id is null or p_expected_version is null or p_expected_version < 1
     or nullif(btrim(coalesce(p_site_warehouse_id, '')), '') is null
     or p_fulfillment_mode not in ('RECEIVE_TO_STOCK', 'DIRECT_CONSUMPTION')
     or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0
     or p_payload_schema_version <> 1
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = '22023', message = 'MATERIAL_PLAN_COMMAND_INVALID';
  end if;
  select * into strict v_owner from public.procurement_owner_contexts
  where logical_key = 'company_default' and is_active for update;
  select * into v_plan from public.material_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'MATERIAL_PLAN_NOT_FOUND'; end if;
  if not app_private.project_actor_has_effective_room_action(
    v_actor, v_plan.project_id, v_plan.construction_site_id, 'material_planning', 'view'
  ) or not app_private.project_actor_has_effective_room_action(
    v_actor, v_plan.project_id, v_plan.construction_site_id, 'material_request', 'edit'
  ) then raise exception using errcode = '42501', message = 'MATERIAL_PLAN_CONVERT_DENIED'; end if;

  v_payload_hash := encode(extensions.digest(jsonb_build_object(
    'planId', p_plan_id, 'expectedVersion', p_expected_version,
    'siteWarehouseId', p_site_warehouse_id, 'fulfillmentMode', p_fulfillment_mode,
    'allocations', p_allocations, 'payloadSchemaVersion', p_payload_schema_version
  )::text, 'sha256'), 'hex');
  insert into app_private.procurement_commands(
    owner_context_id, command_type, idempotency_key, actor_user_id, payload_hash
  ) values (v_owner.id, 'convert_material_plan_to_request', p_idempotency_key, v_actor, v_payload_hash)
  on conflict (owner_context_id, command_type, idempotency_key) do nothing;
  select * into strict v_command from app_private.procurement_commands
  where owner_context_id = v_owner.id and command_type = 'convert_material_plan_to_request'
    and idempotency_key = p_idempotency_key for update;
  if v_command.actor_user_id is distinct from v_actor or v_command.payload_hash <> v_payload_hash then
    raise exception using errcode = '40001', message = 'PROCUREMENT_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.result is not null then
    return jsonb_set(v_command.result, '{outcome}', '"replayed"'::jsonb);
  end if;
  if v_plan.current_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'MATERIAL_PLAN_VERSION_CONFLICT';
  end if;
  if v_plan.status not in ('draft', 'confirmed') then
    raise exception using errcode = '23514', message = 'MATERIAL_PLAN_IMMUTABLE';
  end if;
  if not exists (
    select 1 from public.warehouses warehouse
    where warehouse.id = p_site_warehouse_id
      and warehouse.project_id is not distinct from v_plan.project_id
      and warehouse.construction_site_id::text is not distinct from v_plan.construction_site_id
      and not coalesce(warehouse.is_archived, false)
  ) then raise exception using errcode = '23514', message = 'MATERIAL_PLAN_WAREHOUSE_SCOPE_MISMATCH'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_allocations) input(value)
    group by input.value ->> 'allocationId' having count(*) > 1
  ) then raise exception using errcode = '22023', message = 'MATERIAL_PLAN_CONVERSION_DUPLICATE'; end if;

  -- Lock exact plan allocations, then shared BOQ sources in a stable order.
  perform allocation.id
  from public.material_plan_allocations allocation
  join jsonb_array_elements(p_allocations) input(value)
    on input.value ->> 'allocationId' = allocation.id::text
  where allocation.plan_id = v_plan.id
  order by allocation.source_budget_line_id, allocation.id
  for update of allocation;
  if (select count(*) from public.material_plan_allocations allocation
      join jsonb_array_elements(p_allocations) input(value)
        on input.value ->> 'allocationId' = allocation.id::text
      where allocation.plan_id = v_plan.id and allocation.archived_at is null)
     <> jsonb_array_length(p_allocations) then
    raise exception using errcode = '23514', message = 'MATERIAL_PLAN_ALLOCATION_NOT_FOUND';
  end if;
  perform budget.id
  from public.material_budget_items budget
  join public.material_plan_allocations allocation on allocation.source_budget_line_id = budget.id
  join jsonb_array_elements(p_allocations) input(value)
    on input.value ->> 'allocationId' = allocation.id::text
  where allocation.plan_id = v_plan.id
  order by allocation.source_budget_line_id, allocation.id
  for update of budget;

  for v_input in select value from jsonb_array_elements(p_allocations)
  loop
    if coalesce(v_input ->> 'quantity', '') !~ '^\d+(\.\d{1,6})?$'
       or (v_input ->> 'quantity')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'MATERIAL_PLAN_CONVERSION_INVALID';
    end if;
    select * into strict v_allocation from public.material_plan_allocations
    where id = (v_input ->> 'allocationId')::uuid and plan_id = v_plan.id for update;
    select * into strict v_line from public.material_plan_lines where id = v_allocation.plan_line_id;
    v_qty := (v_input ->> 'quantity')::numeric(20,6);
    select coalesce(sum(conversion.quantity), 0) into v_converted
    from public.material_plan_conversions conversion
    where conversion.allocation_id = v_allocation.id and conversion.state = 'active';
    if v_converted + v_qty > v_allocation.quantity then
      raise exception using errcode = '40001', message = 'MATERIAL_PLAN_CONVERSION_EXCEEDED',
        detail = jsonb_build_object('allocationId', v_allocation.id,
          'planned', v_allocation.quantity, 'converted', v_converted,
          'requested', v_qty)::text;
    end if;
    select * into strict v_budget from public.material_budget_items
    where id = v_allocation.source_budget_line_id;
    if v_budget.project_id is distinct from v_plan.project_id
       or v_budget.construction_site_id is distinct from v_plan.construction_site_id
       or v_budget.inventory_item_id is distinct from v_line.item_id
       or v_budget.unit is distinct from v_line.unit
       or v_budget.work_boq_item_id is distinct from v_allocation.source_work_boq_item_id then
      raise exception using errcode = '40001', message = 'MATERIAL_PLAN_SOURCE_CHANGED';
    end if;
    if v_allocation.source_work_boq_item_id is null then
      if v_allocation.source_task_id is not null then
        raise exception using errcode = '40001', message = 'MATERIAL_PLAN_SOURCE_CHANGED';
      end if;
    else
      select * into v_work from public.project_work_boq_items
      where id = v_allocation.source_work_boq_item_id;
      if not found or v_work.project_id is distinct from v_plan.project_id
         or v_work.construction_site_id is distinct from v_plan.construction_site_id
         or v_work.source_task_id is distinct from v_allocation.source_task_id then
        raise exception using errcode = '40001', message = 'MATERIAL_PLAN_SOURCE_CHANGED';
      end if;
    end if;
  end loop;

  for v_group in
    select allocation.source_budget_line_id budget_id,
      sum((input.value ->> 'quantity')::numeric(20,6)) requested_qty
    from public.material_plan_allocations allocation
    join jsonb_array_elements(p_allocations) input(value)
      on input.value ->> 'allocationId' = allocation.id::text
    where allocation.plan_id = v_plan.id
    group by allocation.source_budget_line_id order by allocation.source_budget_line_id
  loop
    select * into strict v_budget from public.material_budget_items where id = v_group.budget_id;
    if exists (
      select 1
      from public.material_issue_lines issue_line
      join public.material_issue_orders issue on issue.id = issue_line.issue_order_id
      where issue.project_id = v_plan.project_id
        and issue.construction_site_id is not distinct from v_plan.construction_site_id
        and issue.status in ('issued', 'partially_received', 'received', 'settling', 'partially_returned', 'closed')
        and issue_line.issued_qty - issue_line.returned_qty <> 0
        and (
          issue_line.material_budget_item_id = v_budget.id
          or (issue_line.item_id = v_budget.inventory_item_id and issue_line.unit = v_budget.unit)
        )
        and not exists (
          select 1 from public.material_budget_items exact_budget
          where exact_budget.id = issue_line.material_budget_item_id
            and exact_budget.project_id = v_plan.project_id
            and exact_budget.construction_site_id is not distinct from v_plan.construction_site_id
            and exact_budget.work_boq_item_id is not distinct from issue_line.work_boq_item_id
            and exact_budget.inventory_item_id = issue_line.item_id
            and exact_budget.unit = issue_line.unit
        )
    ) or exists (
      select 1
      from public.requests request_row
      cross join lateral jsonb_array_elements(request_row.items) request_line(value)
      left join public.procurement_source_documents document
        on document.source_adapter = 'project_material_request'
        and document.source_document_id = request_row.id
        and document.project_id = v_plan.project_id
        and document.construction_site_id is not distinct from v_plan.construction_site_id
        and document.archived_at is null
      left join public.procurement_source_line_registry registry
        on registry.source_document_id = document.id
        and registry.source_line_id = request_line.value ->> 'lineId'
        and registry.archived_at is null
      left join public.procurement_demands demand on demand.source_document_id = document.id
      left join public.procurement_demand_lines demand_line
        on demand_line.demand_id = demand.id
        and demand_line.source_line_registry_id = registry.id
      left join public.material_budget_items exact_budget
        on exact_budget.id = registry.material_budget_item_id
        and exact_budget.project_id = v_plan.project_id
        and exact_budget.construction_site_id is not distinct from v_plan.construction_site_id
        and exact_budget.work_boq_item_id is not distinct from registry.work_boq_item_id
        and exact_budget.inventory_item_id = registry.item_id
        and exact_budget.unit = registry.unit
      where request_row.project_id = v_plan.project_id
        and request_row.construction_site_id is not distinct from v_plan.construction_site_id
        and lower(request_row.status::text) in ('pending', 'approved', 'in_transit', 'completed')
        and (
          request_line.value ->> 'materialBudgetItemId' = v_budget.id
          or (
            request_line.value ->> 'itemId' = v_budget.inventory_item_id
            and coalesce(request_line.value ->> 'unitSnapshot', request_line.value ->> 'unit') = v_budget.unit
          )
        )
        and (
          document.id is null or registry.id is null or demand.id is null or demand_line.id is null
          or demand_line.current_source_revision_id is distinct from demand.current_source_revision_id
          or demand_line.intake_state not in ('preliminary', 'ready')
          or demand_line.health_state <> 'healthy'
          or exact_budget.id is null
          or coalesce(request_line.value ->> 'requestQty', '') !~ '^\d+(\.\d{1,6})?$'
          or coalesce(request_line.value ->> 'approvedQty', '') !~ '^\d+(\.\d{1,6})?$'
        )
    ) then
      raise exception using errcode = '40001', message = 'MATERIAL_PLAN_BUDGET_COMPLETENESS_UNKNOWN',
        detail = jsonb_build_object('budgetLineId', v_budget.id,
          'itemId', v_budget.inventory_item_id, 'unit', v_budget.unit)::text;
    end if;

    select coalesce(sum(greatest(issue_line.issued_qty - issue_line.returned_qty, 0)), 0)
      into v_issued
    from public.material_issue_lines issue_line
    join public.material_issue_orders issue on issue.id = issue_line.issue_order_id
    where issue.project_id = v_plan.project_id
      and issue.construction_site_id is not distinct from v_plan.construction_site_id
      and issue.status in ('issued', 'partially_received', 'received', 'settling', 'partially_returned', 'closed')
      and issue_line.material_budget_item_id = v_budget.id
      and issue_line.work_boq_item_id is not distinct from v_budget.work_boq_item_id
      and issue_line.item_id = v_budget.inventory_item_id
      and issue_line.unit = v_budget.unit;

    select coalesce(sum(greatest(
      case when lower(request_row.status::text) = 'pending'
        then (request_line.value ->> 'requestQty')::numeric(20,6)
        else (request_line.value ->> 'approvedQty')::numeric(20,6) end
      - coalesce(linked_issue.issued_qty, 0), 0)), 0) into v_open
    from public.requests request_row
    cross join lateral jsonb_array_elements(request_row.items) request_line(value)
    left join lateral (
      select sum(greatest(issue_line.issued_qty - issue_line.returned_qty, 0)) issued_qty
      from public.material_issue_lines issue_line
      join public.material_issue_orders issue on issue.id = issue_line.issue_order_id
      where issue.material_request_id = request_row.id
        and issue_line.material_request_line_id = request_line.value ->> 'lineId'
        and issue_line.material_budget_item_id = v_budget.id
    ) linked_issue on true
    where request_row.project_id = v_plan.project_id
      and request_row.construction_site_id is not distinct from v_plan.construction_site_id
      and lower(request_row.status::text) in ('pending', 'approved', 'in_transit', 'completed')
      and request_line.value ->> 'materialBudgetItemId' = v_budget.id
      and nullif(request_line.value ->> 'workBoqItemId', '') is not distinct from v_budget.work_boq_item_id
      and request_line.value ->> 'itemId' = v_budget.inventory_item_id
      and coalesce(request_line.value ->> 'unitSnapshot', request_line.value ->> 'unit') = v_budget.unit
      and coalesce(request_line.value ->> 'requestQty', '') ~ '^\d+(\.\d{1,6})?$'
      and coalesce(request_line.value ->> 'approvedQty', '') ~ '^\d+(\.\d{1,6})?$';

    -- Active conversions whose MR is not in an open/issued state remain held
    -- until an explicit reversal. Once submitted, v_open/issued represents the
    -- same quantity and the conversion must not be counted twice.
    select coalesce(sum(conversion.quantity), 0) into v_draft_converted
    from public.material_plan_conversions conversion
    join public.material_plan_allocations allocation on allocation.id = conversion.allocation_id
    join public.requests request_row on request_row.id = conversion.request_id
    where conversion.state = 'active'
      and allocation.source_budget_line_id = v_budget.id
      and lower(request_row.status::text) in ('draft', 'rejected');
    v_requested := v_group.requested_qty;
    if v_issued + v_open + v_draft_converted + v_requested > v_budget.budget_qty then
      raise exception using errcode = '40001', message = 'MATERIAL_PLAN_BUDGET_EXCEEDED',
        detail = jsonb_build_object('budgetLineId', v_budget.id, 'budget', v_budget.budget_qty,
          'issued', v_issued, 'open', v_open, 'draftConverted', v_draft_converted,
          'requested', v_requested)::text;
    end if;
  end loop;

  v_request_code := public.next_material_request_code_v1(extract(year from current_date)::integer);
  for v_input in select value from jsonb_array_elements(p_allocations)
  loop
    select * into strict v_allocation from public.material_plan_allocations
    where id = (v_input ->> 'allocationId')::uuid;
    select * into strict v_line from public.material_plan_lines where id = v_allocation.plan_line_id;
    select * into strict v_budget from public.material_budget_items where id = v_allocation.source_budget_line_id;
    v_qty := (v_input ->> 'quantity')::numeric(20,6);
    v_request_line_id := gen_random_uuid()::text;
    v_total := v_total + v_qty;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'lineId', v_request_line_id, 'itemId', v_line.item_id,
      'requestQty', v_qty, 'approvedQty', 0, 'issuedQty', 0,
      'workBoqItemId', v_allocation.source_work_boq_item_id,
      'materialBudgetItemId', v_allocation.source_budget_line_id,
      'neededDate', v_allocation.needed_date::text,
      'note', 'Từ ' || v_plan.plan_no || ' · ' || v_allocation.destination,
      'budgetQtySnapshot', v_budget.budget_qty,
      'isOverBoq', false, 'overQty', 0, 'overPercent', 0,
      'isManualItem', false, 'itemNameSnapshot', v_line.item_name_snapshot,
      'unitSnapshot', v_line.unit, 'skuSnapshot', v_line.sku_snapshot,
      'materialPlanId', v_plan.id, 'materialPlanVersion', v_plan.current_version,
      'materialPlanAllocationId', v_allocation.id
    ));
    v_links := v_links || jsonb_build_array(jsonb_build_object(
      'allocationId', v_allocation.id, 'requestLineId', v_request_line_id,
      'quantity', v_qty, 'unit', v_line.unit
    ));
  end loop;

  insert into public.requests(
    id, code, title, site_warehouse_id, requester_id, status, items,
    created_date, expected_date, note, logs, fulfillment_mode,
    project_id, construction_site_id, request_origin, ever_submitted,
    workflow_step, workflow_step_started_at, workflow_step_actor_user_id
  ) values (
    v_request_id, v_request_code, 'Đề xuất từ ' || v_plan.plan_no,
    p_site_warehouse_id, v_actor, 'DRAFT', v_items, now(),
    (select max((link.value ->> 'neededDate')::date) from jsonb_array_elements(v_items) link(value)),
    'Tạo từ kế hoạch ' || v_plan.plan_no || ' phiên bản ' || v_plan.current_version,
    jsonb_build_array(jsonb_build_object('action', 'CREATED_FROM_MATERIAL_PLAN',
      'userId', v_actor, 'timestamp', now(), 'note', v_plan.plan_no)),
    p_fulfillment_mode, v_plan.project_id, v_plan.construction_site_id,
    'project', false, 'draft', now(), v_actor::text
  );

  if current_setting('app.material_plan_fail_after_request', true) = 'on' then
    raise exception using errcode = 'P0001', message = 'MATERIAL_PLAN_FAULT_AFTER_REQUEST';
  end if;

  for v_input in select value from jsonb_array_elements(v_links)
  loop
    insert into public.material_plan_conversions(
      plan_id, plan_revision, allocation_id, request_id, request_line_id,
      quantity, unit, command_id, created_by
    ) values (
      v_plan.id, v_plan.current_version, (v_input ->> 'allocationId')::uuid,
      v_request_id, v_input ->> 'requestLineId', (v_input ->> 'quantity')::numeric,
      v_input ->> 'unit', v_command.id, v_actor
    );
  end loop;
  insert into public.material_request_events(
    request_id, project_id, from_step, to_step, action, actor_user_id, note, metadata
  ) values (
    v_request_id, v_plan.project_id, null, 'draft', 'PLAN_CONVERTED', v_actor::text,
    'MR nháp được tạo từ kế hoạch vật tư.',
    jsonb_build_object('materialPlanId', v_plan.id, 'materialPlanVersion', v_plan.current_version,
      'materialPlanNo', v_plan.plan_no, 'quantity', v_total)
  );
  insert into app_private.procurement_events_outbox(
    owner_context_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, payload, actor_user_id
  ) values (
    v_owner.id, 'material_plan', v_plan.id, v_plan.current_version,
    'material_plan.converted_to_request', jsonb_build_object(
      'planId', v_plan.id, 'planVersion', v_plan.current_version,
      'requestId', v_request_id, 'requestCode', v_request_code,
      'convertedQty', v_total, 'allocationCount', jsonb_array_length(v_links)
    ), v_actor
  );
  v_result := jsonb_build_object(
    'commandId', v_command.id, 'outcome', 'committed',
    'planId', v_plan.id, 'planVersion', v_plan.current_version,
    'requestId', v_request_id, 'requestCode', v_request_code,
    'convertedQty', v_total::numeric(20,6)::text
  );
  update app_private.procurement_commands set result = v_result, committed_at = now()
  where id = v_command.id;
  return v_result;
end;
$$;
revoke all on function app_private.convert_material_plan_to_request_v1(uuid, bigint, text, text, jsonb, integer, text) from public, anon, authenticated;

create function public.convert_material_plan_to_request_v1(
  p_plan_id uuid, p_expected_version bigint, p_site_warehouse_id text,
  p_fulfillment_mode text, p_allocations jsonb, p_payload_schema_version integer,
  p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.convert_material_plan_to_request_v1(
    p_plan_id, p_expected_version, p_site_warehouse_id, p_fulfillment_mode,
    p_allocations, p_payload_schema_version, p_idempotency_key
  );
$$;
revoke all on function public.convert_material_plan_to_request_v1(uuid, bigint, text, text, jsonb, integer, text) from public, anon;
grant execute on function public.convert_material_plan_to_request_v1(uuid, bigint, text, text, jsonb, integer, text) to authenticated, service_role;

grant execute on function app_private.get_material_plan_v1(uuid, text, text) to authenticated, service_role;
grant execute on function app_private.list_material_plans_v1(text, text) to authenticated, service_role;
grant execute on function app_private.save_material_plan_v1(uuid, text, text, bigint, text, date, date, text, text, jsonb, integer, text) to authenticated, service_role;
grant execute on function app_private.convert_material_plan_to_request_v1(uuid, bigint, text, text, jsonb, integer, text) to authenticated, service_role;

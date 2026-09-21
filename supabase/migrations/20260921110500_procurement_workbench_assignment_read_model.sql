-- G5 Workbench assignment and read model. G2 remains the authority for source,
-- revision, quantity balance and scope permissions.

-- G2 wrappers are SECURITY INVOKER and their checked owners live outside the
-- exposed Data API schema. PostgreSQL still requires EXECUTE on the nested
-- owner function. These grants make the existing public wrappers callable;
-- each owner continues to derive the actor and enforce scope itself.
grant execute on function app_private.sync_project_material_request_demand_v1(text, bigint, text) to authenticated, service_role;
grant execute on function app_private.resolve_procurement_source_change_v1(uuid, bigint, text, text, text) to authenticated, service_role;
grant execute on function app_private.get_procurement_access_v1(text, text) to authenticated, service_role;
grant execute on function app_private.list_procurement_demand_balances_v1(text, text) to authenticated, service_role;
grant execute on function app_private.list_procurement_unallocated_v1(text, text) to authenticated, service_role;
grant execute on function app_private.save_procurement_allocation_v1(uuid, uuid, uuid, text, text, numeric, numeric, text, numeric, text, numeric, numeric, bigint, text, text) to authenticated, service_role;
grant execute on function app_private.record_procurement_fulfillment_attribution_v1(uuid, uuid, text, text, numeric, text, uuid, bigint, text) to authenticated, service_role;

alter table public.procurement_demands
  add column assignee_user_id uuid references public.users(id) on delete set null;

create table public.procurement_assignment_history (
  id uuid primary key default gen_random_uuid(),
  owner_context_id uuid not null references public.procurement_owner_contexts(id) on delete restrict,
  demand_id uuid not null references public.procurement_demands(id) on delete restrict,
  from_assignee_user_id uuid references public.users(id) on delete set null,
  to_assignee_user_id uuid references public.users(id) on delete set null,
  reason text not null check (btrim(reason) <> ''),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  demand_version bigint not null check (demand_version > 0),
  created_at timestamptz not null default now()
);

alter table public.procurement_assignment_history enable row level security;
revoke all on public.procurement_assignment_history from public, anon, authenticated;
grant all on public.procurement_assignment_history to service_role;

create function app_private.procurement_assignment_history_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'PROCUREMENT_ASSIGNMENT_HISTORY_IMMUTABLE';
end;
$$;
revoke all on function app_private.procurement_assignment_history_immutable() from public, anon, authenticated;
create trigger trg_procurement_assignment_history_immutable
before update or delete on public.procurement_assignment_history
for each row execute function app_private.procurement_assignment_history_immutable();

create function app_private.assign_procurement_demand_v1(
  p_demand_id uuid, p_assignee_user_id uuid, p_expected_version bigint,
  p_reason text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_owner public.procurement_owner_contexts%rowtype;
  v_demand public.procurement_demands%rowtype;
  v_command app_private.procurement_commands%rowtype;
  v_assignee_access jsonb;
  v_hash text;
  v_result jsonb;
  v_previous uuid;
begin
  if p_demand_id is null or p_assignee_user_id is null
     or p_expected_version is null or p_expected_version < 1
     or nullif(btrim(coalesce(p_reason, '')), '') is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_ASSIGNMENT_INVALID';
  end if;

  select * into strict v_owner from public.procurement_owner_contexts
  where logical_key = 'company_default' and is_active for update;
  select * into v_demand from public.procurement_demands where id = p_demand_id for update;
  if not found or v_demand.owner_context_id <> v_owner.id then
    raise exception using errcode = 'P0002', message = 'PROCUREMENT_DEMAND_NOT_FOUND';
  end if;
  perform app_private.procurement_assert_intake_access(
    v_actor, v_demand.project_id, v_demand.construction_site_id
  );

  if not exists (
    select 1 from public.users assignee where assignee.id = p_assignee_user_id
      and coalesce(assignee.is_active, true)
      and coalesce(assignee.account_status, 'ACTIVE') = 'ACTIVE'
  ) then raise exception using errcode = '22023', message = 'PROCUREMENT_ASSIGNEE_INACTIVE'; end if;
  v_assignee_access := app_private.procurement_access_v1(
    p_assignee_user_id, v_demand.project_id, v_demand.construction_site_id
  );
  if coalesce((v_assignee_access ->> 'canRead')::boolean, false) is not true then
    raise exception using errcode = '42501', message = 'PROCUREMENT_ASSIGNEE_SCOPE_DENIED';
  end if;

  v_hash := encode(extensions.digest(jsonb_build_object(
    'demandId', p_demand_id, 'assigneeUserId', p_assignee_user_id,
    'expectedVersion', p_expected_version, 'reason', btrim(p_reason)
  )::text, 'sha256'), 'hex');
  insert into app_private.procurement_commands(
    owner_context_id, command_type, idempotency_key, actor_user_id, payload_hash
  ) values (
    v_owner.id, 'assign_procurement_demand', p_idempotency_key, v_actor, v_hash
  ) on conflict (owner_context_id, command_type, idempotency_key) do nothing;
  select * into strict v_command from app_private.procurement_commands
  where owner_context_id = v_owner.id and command_type = 'assign_procurement_demand'
    and idempotency_key = p_idempotency_key for update;
  if v_command.actor_user_id is distinct from v_actor or v_command.payload_hash <> v_hash then
    raise exception using errcode = '40001', message = 'PROCUREMENT_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.result is not null then
    return v_command.result || jsonb_build_object('outcome', 'replayed');
  end if;
  if v_demand.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'PROCUREMENT_VERSION_CONFLICT';
  end if;

  v_previous := v_demand.assignee_user_id;
  update public.procurement_demands set
    assignee_user_id = p_assignee_user_id,
    version = version + 1,
    updated_by = v_actor,
    updated_at = now()
  where id = v_demand.id returning * into v_demand;
  insert into public.procurement_assignment_history(
    owner_context_id, demand_id, from_assignee_user_id, to_assignee_user_id,
    reason, actor_user_id, demand_version
  ) values (
    v_owner.id, v_demand.id, v_previous, p_assignee_user_id,
    btrim(p_reason), v_actor, v_demand.version
  );
  insert into app_private.procurement_events_outbox(
    owner_context_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, payload, actor_user_id
  ) values (
    v_owner.id, 'procurement_demand', v_demand.id, v_demand.version,
    'procurement.demand.assigned', jsonb_build_object(
      'demandId', v_demand.id, 'fromAssigneeUserId', v_previous,
      'toAssigneeUserId', p_assignee_user_id
    ), v_actor
  );
  v_result := jsonb_build_object(
    'commandId', v_command.id, 'outcome', 'committed', 'committedAt', now(),
    'changedEntities', jsonb_build_array(jsonb_build_object(
      'type', 'demand', 'id', v_demand.id, 'version', v_demand.version::text
    )),
    'createdDocumentIds', '[]'::jsonb, 'warnings', '[]'::jsonb,
    'refreshScopes', jsonb_build_array('project:' || v_demand.project_id)
  );
  update app_private.procurement_commands set result = v_result, committed_at = now()
  where id = v_command.id;
  return v_result;
end;
$$;
revoke all on function app_private.assign_procurement_demand_v1(uuid, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function app_private.assign_procurement_demand_v1(uuid, uuid, bigint, text, text) to authenticated, service_role;

create function public.assign_procurement_demand_v1(
  p_demand_id uuid, p_assignee_user_id uuid, p_expected_version bigint,
  p_reason text, p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.assign_procurement_demand_v1(
    p_demand_id, p_assignee_user_id, p_expected_version, p_reason, p_idempotency_key
  );
$$;
revoke all on function public.assign_procurement_demand_v1(uuid, uuid, bigint, text, text) from public, anon;
grant execute on function public.assign_procurement_demand_v1(uuid, uuid, bigint, text, text) to authenticated, service_role;

create function app_private.list_procurement_work_v1(
  p_filter jsonb default '{}'::jsonb, p_cursor text default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
  v_limit integer := least(200, greatest(1, coalesce(p_limit, 50)));
  v_offset integer := 0;
  v_rows jsonb;
  v_items jsonb;
  v_count integer;
  v_demand_count integer;
  v_as_of timestamptz := now();
  v_next text;
  v_snapshot text;
  v_cursor_snapshot text;
begin
  if jsonb_typeof(v_filter) <> 'object' then
    raise exception using errcode = '22023', message = 'PROCUREMENT_FILTER_INVALID';
  end if;
  if v_actor is null or not exists (
    select 1 from public.users actor where actor.id = v_actor
      and coalesce(actor.is_active, true)
      and coalesce(actor.account_status, 'ACTIVE') = 'ACTIVE'
  ) then raise exception using errcode = '42501', message = 'PROCUREMENT_ACCESS_DENIED'; end if;
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]+:[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'PROCUREMENT_CURSOR_INVALID';
    end if;
    v_offset := split_part(p_cursor, ':', 1)::integer;
    v_cursor_snapshot := split_part(p_cursor, ':', 2);
  end if;

  v_rows := app_private.list_procurement_demand_balances_v1(
    nullif(v_filter ->> 'projectId', ''), nullif(v_filter ->> 'constructionSiteId', '')
  );

  with source_rows as materialized (
    select entry.value row_value,
      demand.assignee_user_id,
      demand.updated_at demand_updated_at,
      coalesce(entry.value ->> 'neededDate', '') sort_date,
      entry.value ->> 'key' sort_key
    from jsonb_array_elements(v_rows) entry(value)
    left join public.procurement_demands demand
      on demand.id = nullif(entry.value ->> 'demandId', '')::uuid
    where (nullif(v_filter ->> 'assigneeId', '') is null
        or demand.assignee_user_id::text = v_filter ->> 'assigneeId')
      and (nullif(v_filter ->> 'search', '') is null or lower(concat_ws(' ',
        entry.value ->> 'itemName', entry.value ->> 'sku', entry.value ->> 'requestCode',
        entry.value ->> 'requestTitle')) like '%' || lower(v_filter ->> 'search') || '%')
      and (nullif(v_filter ->> 'neededFrom', '') is null
        or nullif(entry.value ->> 'neededDate', '')::date >= (v_filter ->> 'neededFrom')::date)
      and (nullif(v_filter ->> 'neededTo', '') is null
        or nullif(entry.value ->> 'neededDate', '')::date <= (v_filter ->> 'neededTo')::date)
      and (nullif(v_filter ->> 'source', '') is null
        or v_filter ->> 'source' = 'project_material_request')
      and (nullif(v_filter ->> 'method', '') is null or exists (
        select 1
        from public.procurement_supply_allocations allocation_filter
        where allocation_filter.demand_line_id = nullif(entry.value ->> 'demandLineId', '')::uuid
          and allocation_filter.method = v_filter ->> 'method'
          and allocation_filter.state in ('planned', 'reserved', 'committed', 'settled')
      ))
      and (coalesce(v_filter ->> 'view', 'work') in ('work', 'demand', 'reconcile', 'overview'))
      and (coalesce(v_filter ->> 'view', 'work') <> 'reconcile'
        or not coalesce((entry.value ->> 'remainingKnown')::boolean, false))
      and (nullif(v_filter ->> 'stage', '') is null
        or (v_filter ->> 'stage' = 'reconcile'
          and not coalesce((entry.value ->> 'remainingKnown')::boolean, false))
        or (v_filter ->> 'stage' = 'processing'
          and coalesce((entry.value ->> 'availableToPlanQty')::numeric, 0) > 0)
        or (v_filter ->> 'stage' = 'receiving'
          and coalesce((entry.value ->> 'committedQty')::numeric, 0) > 0)
        or (v_filter ->> 'stage' in ('intake', 'approval') and false))
  ), numbered as (
    select source_rows.*, row_number() over (
      order by (sort_date = ''), sort_date, sort_key
    ) row_number
    from source_rows
  ), page_rows as (
    select * from numbered where row_number > v_offset and row_number <= v_offset + v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', row_value ->> 'key',
      'objectType', 'demand_line',
      'objectId', row_value ->> 'demandLineId',
      'actionKind', case
        when not coalesce((row_value ->> 'remainingKnown')::boolean, false) then 'reconcile'
        when coalesce((row_value ->> 'availableToPlanQty')::numeric, 0) > 0 then 'plan_supply'
        else 'monitor_fulfillment' end,
      'demandId', row_value ->> 'demandId',
      'demandLineId', row_value ->> 'demandLineId',
      'title', row_value ->> 'itemName',
      'sourceLabel', 'Đề xuất dự án',
      'sourceCode', row_value ->> 'requestCode',
      'projectId', row_value ->> 'projectId',
      'constructionSiteId', row_value ->> 'constructionSiteId',
      'destinationLabel', row_value ->> 'targetWarehouseId',
      'assigneeUserId', assignee_user_id,
      'unit', row_value ->> 'unit',
      'balance', jsonb_build_object(
        'openNeed', row_value -> 'openNeedQty',
        'availableToPlan', row_value -> 'availableToPlanQty',
        'coverageExcess', case when coalesce((row_value ->> 'remainingKnown')::boolean, false)
          then to_jsonb(greatest(0, coalesce((row_value ->> 'reservedQty')::numeric, 0)
            + coalesce((row_value ->> 'committedQty')::numeric, 0)
            - coalesce((row_value ->> 'openNeedQty')::numeric, 0))::text) else 'null'::jsonb end,
        'receivedExcess', case when coalesce((row_value ->> 'remainingKnown')::boolean, false)
          then to_jsonb(greatest(0, coalesce((row_value ->> 'fulfilledQty')::numeric, 0)
            + coalesce((row_value ->> 'closedQty')::numeric, 0)
            - coalesce((row_value ->> 'approvedQty')::numeric, 0))::text) else 'null'::jsonb end
      ),
      'allowedActions', case
        when coalesce((row_value ->> 'canAllocate')::boolean, false)
          and coalesce((row_value ->> 'availableToPlanQty')::numeric, 0) > 0
          then jsonb_build_array('assign', 'plan_supply')
        when coalesce((row_value ->> 'canAllocate')::boolean, false)
          then jsonb_build_array('assign')
        else jsonb_build_array('view') end,
      'version', coalesce(row_value ->> 'demandLineVersion', '0'),
      'neededDate', row_value -> 'neededDate',
      'nextActionLabel', case
        when not coalesce((row_value ->> 'remainingKnown')::boolean, false) then 'Xử lý sai lệch dữ liệu'
        when coalesce((row_value ->> 'availableToPlanQty')::numeric, 0) > 0 then 'Lập phương án cung ứng'
        else 'Theo dõi thực hiện' end,
      'tags', jsonb_build_array(jsonb_build_object(
        'label', case
          when not coalesce((row_value ->> 'remainingKnown')::boolean, false) then 'Cần đối chiếu'
          when coalesce((row_value ->> 'availableToPlanQty')::numeric, 0) > 0 then 'Sẵn sàng'
          else 'Đã có phương án' end,
        'tone', case
          when not coalesce((row_value ->> 'remainingKnown')::boolean, false) then 'warning'
          when coalesce((row_value ->> 'availableToPlanQty')::numeric, 0) > 0 then 'success'
          else 'info' end
      ))
    ) order by row_number), '[]'::jsonb),
    (select count(*) from source_rows),
    (select count(distinct row_value ->> 'demandId') from source_rows),
    (select encode(extensions.digest(coalesce(string_agg(
      row_value::text, '|' order by (sort_date = ''), sort_date, sort_key
    ), 'empty'), 'sha256'), 'hex') from source_rows)
  into v_items, v_count, v_demand_count, v_snapshot from page_rows;

  if v_cursor_snapshot is not null and v_cursor_snapshot <> v_snapshot then
    raise exception using errcode = '40001', message = 'PROCUREMENT_SNAPSHOT_STALE';
  end if;
  if v_offset + v_limit < v_count then
    v_next := (v_offset + v_limit)::text || ':' || v_snapshot;
  end if;
  return jsonb_build_object(
    'items', v_items, 'nextCursor', v_next, 'snapshotToken', v_snapshot,
    'asOf', v_as_of, 'stale', false,
    'counters', jsonb_build_array(
      jsonb_build_object('key', 'work', 'count', v_count, 'grain', 'work'),
      jsonb_build_object('key', 'demand', 'count', v_demand_count, 'grain', 'demand')
    )
  );
end;
$$;
revoke all on function app_private.list_procurement_work_v1(jsonb, text, integer) from public, anon, authenticated;
grant execute on function app_private.list_procurement_work_v1(jsonb, text, integer) to authenticated, service_role;

create function public.list_procurement_work_v1(
  p_filter jsonb default '{}'::jsonb, p_cursor text default null, p_limit integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.list_procurement_work_v1(p_filter, p_cursor, p_limit);
$$;
revoke all on function public.list_procurement_work_v1(jsonb, text, integer) from public, anon;
grant execute on function public.list_procurement_work_v1(jsonb, text, integer) to authenticated, service_role;

create function app_private.get_procurement_demand_v1(p_demand_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_demand public.procurement_demands%rowtype;
  v_document public.procurement_source_documents%rowtype;
  v_rows jsonb;
  v_lines jsonb;
  v_issues jsonb;
  v_can_allocate boolean;
  v_can_plan boolean;
begin
  select * into v_demand from public.procurement_demands where id = p_demand_id;
  if not found then raise exception using errcode = 'P0002', message = 'PROCUREMENT_DEMAND_NOT_FOUND'; end if;
  perform app_private.procurement_assert_read_access(v_actor, v_demand.project_id, v_demand.construction_site_id);
  select * into strict v_document from public.procurement_source_documents where id = v_demand.source_document_id;
  v_can_allocate := coalesce((app_private.procurement_access_v1(
    v_actor, v_demand.project_id, v_demand.construction_site_id
  ) ->> 'canAllocate')::boolean, false);
  v_rows := app_private.list_procurement_demand_balances_v1(
    v_demand.project_id, v_demand.construction_site_id
  );
  select exists (
    select 1
    from jsonb_array_elements(v_rows) entry(value)
    where entry.value ->> 'demandId' = p_demand_id::text
      and coalesce((entry.value ->> 'remainingKnown')::boolean, false)
      and coalesce((entry.value ->> 'availableToPlanQty')::numeric, 0) > 0
  ) into v_can_plan;

  with demand_rows as (
    select entry.value row_value
    from jsonb_array_elements(v_rows) entry(value)
    where entry.value ->> 'demandId' = p_demand_id::text
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row_value ->> 'demandLineId',
    'itemId', row_value -> 'itemId',
    'title', row_value ->> 'itemName',
    'unit', row_value ->> 'unit',
    'requestedQty', row_value ->> 'requestedQty',
    'balanceInput', jsonb_build_object(
      'approved', row_value -> 'approvedQty', 'fulfilled', row_value -> 'fulfilledQty',
      'closed', row_value -> 'closedQty', 'reserved', row_value -> 'reservedQty',
      'committed', row_value -> 'committedQty'
    ),
    'balance', jsonb_build_object(
      'openNeed', row_value -> 'openNeedQty',
      'availableToPlan', row_value -> 'availableToPlanQty',
      'coverageExcess', case when coalesce((row_value ->> 'remainingKnown')::boolean, false)
        then to_jsonb(greatest(0, coalesce((row_value ->> 'reservedQty')::numeric, 0)
          + coalesce((row_value ->> 'committedQty')::numeric, 0)
          - coalesce((row_value ->> 'openNeedQty')::numeric, 0))::text) else 'null'::jsonb end,
      'receivedExcess', case when coalesce((row_value ->> 'remainingKnown')::boolean, false)
        then to_jsonb(greatest(0, coalesce((row_value ->> 'fulfilledQty')::numeric, 0)
          + coalesce((row_value ->> 'closedQty')::numeric, 0)
          - coalesce((row_value ->> 'approvedQty')::numeric, 0))::text) else 'null'::jsonb end
    ),
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', allocation.id, 'method', allocation.method, 'state', allocation.state,
        'needQty', (allocation.reserved_need_qty + allocation.committed_need_qty)::text,
        'documentRefs', case when execution_document.source_adapter = 'purchase_order'
          then jsonb_build_array(jsonb_build_object(
            'type', 'purchase_order', 'id', execution_document.source_document_id,
            'engine', 'purchase_order'
          )) else '[]'::jsonb end
      ) order by allocation.created_at, allocation.id)
      from public.procurement_supply_allocations allocation
      join public.procurement_source_line_registry execution_line
        on execution_line.id = allocation.execution_source_line_registry_id
      join public.procurement_source_documents execution_document
        on execution_document.id = execution_line.source_document_id
      where allocation.demand_line_id = (row_value ->> 'demandLineId')::uuid
    ), '[]'::jsonb)
  ) order by row_value ->> 'itemName', row_value ->> 'demandLineId'), '[]'::jsonb)
  into v_lines from demand_rows;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', issue.id, 'code', issue.issue_code,
    'message', coalesce(issue.details ->> 'message', issue.issue_code)
  ) order by issue.created_at, issue.id), '[]'::jsonb)
  into v_issues from public.procurement_reconciliation_issues issue
  where issue.owner_context_id = v_demand.owner_context_id
    and issue.source_adapter = v_document.source_adapter
    and issue.source_document_ref = v_document.source_document_id
    and issue.status = 'open';

  return jsonb_build_object(
    'id', v_demand.id, 'version', v_demand.version::text,
    'title', coalesce(v_document.source_code_snapshot, v_document.source_document_id),
    'sourceCode', coalesce(v_document.source_code_snapshot, v_document.source_document_id),
    'projectId', v_demand.project_id, 'constructionSiteId', v_demand.construction_site_id,
    'assigneeUserId', v_demand.assignee_user_id,
    'sourceRef', jsonb_build_object(
      'type', 'material_request', 'id', v_document.source_document_id,
      'engine', v_document.source_adapter
    ),
    'allowedActions', case when v_can_allocate and v_can_plan and v_demand.intake_state = 'ready'
      and v_demand.health_state = 'healthy' then jsonb_build_array('assign', 'plan_supply')
      when v_can_allocate then jsonb_build_array('assign') else jsonb_build_array('view') end,
    'lines', v_lines, 'issues', v_issues, 'asOf', now()
  );
end;
$$;
revoke all on function app_private.get_procurement_demand_v1(uuid) from public, anon, authenticated;
grant execute on function app_private.get_procurement_demand_v1(uuid) to authenticated, service_role;

create function public.get_procurement_demand_v1(p_demand_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_procurement_demand_v1(p_demand_id);
$$;
revoke all on function public.get_procurement_demand_v1(uuid) from public, anon;
grant execute on function public.get_procurement_demand_v1(uuid) to authenticated, service_role;

create index procurement_demands_assignee_updated_idx
  on public.procurement_demands(assignee_user_id, updated_at desc, id);
create index procurement_assignment_history_demand_idx
  on public.procurement_assignment_history(demand_id, created_at desc, id);
create index procurement_assignment_history_owner_context_idx
  on public.procurement_assignment_history(owner_context_id);
create index procurement_assignment_history_from_assignee_idx
  on public.procurement_assignment_history(from_assignee_user_id)
  where from_assignee_user_id is not null;
create index procurement_assignment_history_to_assignee_idx
  on public.procurement_assignment_history(to_assignee_user_id)
  where to_assignee_user_id is not null;
create index procurement_assignment_history_actor_idx
  on public.procurement_assignment_history(actor_user_id);

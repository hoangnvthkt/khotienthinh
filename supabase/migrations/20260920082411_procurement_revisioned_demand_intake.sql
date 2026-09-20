create table public.procurement_demands (
  id uuid primary key default gen_random_uuid(),
  owner_context_id uuid not null references public.procurement_owner_contexts(id) on delete restrict,
  source_document_id uuid not null references public.procurement_source_documents(id) on delete restrict,
  current_source_revision_id uuid not null references public.procurement_source_revisions(id) on delete restrict,
  project_id text not null,
  construction_site_id text,
  source_code_snapshot text,
  intake_state text not null check (intake_state in ('preliminary', 'ready', 'needs_information', 'source_changed', 'withdrawn')),
  health_state text not null check (health_state in ('healthy', 'reconciliation_required')),
  version bigint not null default 1 check (version > 0),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_document_id)
);

create table public.procurement_demand_lines (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references public.procurement_demands(id) on delete restrict,
  source_line_registry_id uuid not null references public.procurement_source_line_registry(id) on delete restrict,
  current_source_revision_id uuid not null references public.procurement_source_revisions(id) on delete restrict,
  item_id text not null,
  unit text not null,
  requested_qty numeric(20,6) not null check (requested_qty >= 0),
  approved_qty numeric(20,6) check (approved_qty is null or approved_qty >= 0),
  work_boq_item_id text references public.project_work_boq_items(id) on delete restrict,
  material_budget_item_id text references public.material_budget_items(id) on delete restrict,
  intake_state text not null check (intake_state in ('preliminary', 'ready', 'needs_information', 'source_changed', 'withdrawn')),
  health_state text not null check (health_state in ('healthy', 'reconciliation_required')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (demand_id, source_line_registry_id),
  unique (source_line_registry_id)
);

create table public.procurement_demand_revisions (
  id uuid primary key default gen_random_uuid(),
  demand_line_id uuid not null references public.procurement_demand_lines(id) on delete restrict,
  source_revision_id uuid not null references public.procurement_source_revisions(id) on delete restrict,
  source_line_hash text not null check (length(source_line_hash) = 64),
  requested_qty numeric(20,6) not null check (requested_qty >= 0),
  approved_qty numeric(20,6) check (approved_qty is null or approved_qty >= 0),
  unit text not null,
  project_id text not null,
  construction_site_id text,
  work_boq_item_id text,
  material_budget_item_id text,
  approval_revision bigint,
  approval_hash text,
  created_at timestamptz not null default now(),
  unique (demand_line_id, source_revision_id)
);

create table public.procurement_source_dispositions (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references public.procurement_demands(id) on delete restrict,
  source_revision_id uuid not null references public.procurement_source_revisions(id) on delete restrict,
  disposition text not null check (disposition in ('accept_current_revision', 'withdraw')),
  reason text not null check (btrim(reason) <> ''),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  demand_version bigint not null,
  created_at timestamptz not null default now()
);

create table app_private.procurement_commands (
  id uuid primary key default gen_random_uuid(),
  owner_context_id uuid not null references public.procurement_owner_contexts(id) on delete restrict,
  command_type text not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  payload_hash text not null check (length(payload_hash) = 64),
  result jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (owner_context_id, command_type, idempotency_key)
);

create table app_private.procurement_events_outbox (
  id uuid primary key default gen_random_uuid(),
  owner_context_id uuid not null references public.procurement_owner_contexts(id) on delete restrict,
  aggregate_type text not null,
  aggregate_id uuid not null,
  aggregate_version bigint not null,
  event_type text not null,
  payload_schema_version integer not null default 1,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

alter table public.procurement_demands enable row level security;
alter table public.procurement_demand_lines enable row level security;
alter table public.procurement_demand_revisions enable row level security;
alter table public.procurement_source_dispositions enable row level security;

revoke all on public.procurement_demands from public, anon, authenticated;
revoke all on public.procurement_demand_lines from public, anon, authenticated;
revoke all on public.procurement_demand_revisions from public, anon, authenticated;
revoke all on public.procurement_source_dispositions from public, anon, authenticated;
revoke all on app_private.procurement_commands from public, anon, authenticated;
revoke all on app_private.procurement_events_outbox from public, anon, authenticated;
grant all on public.procurement_demands to service_role;
grant all on public.procurement_demand_lines to service_role;
grant all on public.procurement_demand_revisions to service_role;
grant all on public.procurement_source_dispositions to service_role;

create or replace function app_private.procurement_demand_revision_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'PROCUREMENT_DEMAND_REVISION_IMMUTABLE';
end;
$$;
revoke all on function app_private.procurement_demand_revision_immutable() from public, anon, authenticated;
create trigger trg_procurement_demand_revision_immutable
before update or delete on public.procurement_demand_revisions
for each row execute function app_private.procurement_demand_revision_immutable();

create or replace function app_private.procurement_assert_intake_access(
  p_actor uuid, p_project_id text, p_construction_site_id text
) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or not exists (
    select 1 from public.users actor
    where actor.id = p_actor and coalesce(actor.is_active, true)
      and coalesce(actor.account_status, 'ACTIVE') = 'ACTIVE'
  ) then raise exception using errcode = '42501', message = 'PROCUREMENT_ACCESS_DENIED'; end if;
  if not app_private.project_actor_has_effective_room_action(
    p_actor, p_project_id, p_construction_site_id, 'material_request', 'view'
  ) or not app_private.project_actor_has_effective_room_action(
    p_actor, p_project_id, p_construction_site_id, 'material_po', 'edit'
  ) then raise exception using errcode = '42501', message = 'PROCUREMENT_ACCESS_DENIED'; end if;
end;
$$;
revoke all on function app_private.procurement_assert_intake_access(uuid, text, text) from public, anon, authenticated;

create or replace function app_private.sync_project_material_request_demand_v1(
  p_request_id text,
  p_expected_source_revision bigint,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_owner public.procurement_owner_contexts%rowtype;
  v_request public.requests%rowtype;
  v_document public.procurement_source_documents%rowtype;
  v_source_revision public.procurement_source_revisions%rowtype;
  v_command app_private.procurement_commands%rowtype;
  v_demand public.procurement_demands%rowtype;
  v_existing public.procurement_demands%rowtype;
  v_registry public.procurement_source_line_registry%rowtype;
  v_line jsonb;
  v_demand_line public.procurement_demand_lines%rowtype;
  v_payload_hash text;
  v_state text;
  v_health text;
  v_approval_valid boolean;
  v_revision_changed boolean := false;
  v_requested numeric(20,6);
  v_approved numeric(20,6);
  v_result jsonb;
  v_line_count integer := 0;
begin
  if nullif(btrim(coalesce(p_request_id, '')), '') is null
     or p_expected_source_revision is null or p_expected_source_revision < 1
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_COMMAND_INVALID';
  end if;

  select * into strict v_owner from public.procurement_owner_contexts
  where logical_key = 'company_default' and is_active for update;
  select * into v_request from public.requests
  where id = p_request_id and request_origin = 'project' for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  perform app_private.procurement_assert_intake_access(v_actor, v_request.project_id, v_request.construction_site_id);
  select * into strict v_document from public.procurement_source_documents
  where owner_context_id = v_owner.id and source_adapter = 'project_material_request'
    and source_document_id = p_request_id for update;
  select * into strict v_source_revision from public.procurement_source_revisions
  where source_document_id = v_document.id and revision = v_request.content_revision;

  v_payload_hash := encode(extensions.digest(jsonb_build_object(
    'requestId', p_request_id, 'expectedSourceRevision', p_expected_source_revision
  )::text, 'sha256'), 'hex');
  insert into app_private.procurement_commands(
    owner_context_id, command_type, idempotency_key, actor_user_id, payload_hash
  ) values (
    v_owner.id, 'sync_project_material_request_demand', p_idempotency_key, v_actor, v_payload_hash
  ) on conflict (owner_context_id, command_type, idempotency_key) do nothing;
  select * into strict v_command from app_private.procurement_commands
  where owner_context_id = v_owner.id and command_type = 'sync_project_material_request_demand'
    and idempotency_key = p_idempotency_key for update;
  if v_command.actor_user_id is distinct from v_actor or v_command.payload_hash <> v_payload_hash then
    raise exception using errcode = '40001', message = 'PROCUREMENT_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.result is not null then
    return v_command.result || jsonb_build_object('outcome', 'replayed');
  end if;
  if v_request.content_revision <> p_expected_source_revision then
    raise exception using errcode = '40001', message = 'SOURCE_REVISION_STALE';
  end if;

  v_approval_valid := v_request.approved_content_revision is not distinct from v_request.content_revision
    and v_request.approved_content_hash is not distinct from v_request.content_hash;
  if v_request.status::text = 'PENDING' and v_request.workflow_step = 'material_department_review' then
    v_state := 'preliminary'; v_health := 'healthy';
  elsif v_request.status::text in ('APPROVED', 'IN_TRANSIT', 'COMPLETED') and v_approval_valid then
    v_state := 'ready'; v_health := 'healthy';
  elsif v_request.status::text in ('APPROVED', 'IN_TRANSIT', 'COMPLETED') then
    v_state := 'needs_information'; v_health := 'reconciliation_required';
  elsif v_request.status::text = 'REJECTED' then
    v_state := 'withdrawn'; v_health := 'healthy';
  else
    v_state := 'needs_information'; v_health := 'healthy';
  end if;

  select * into v_existing from public.procurement_demands
  where source_document_id = v_document.id for update;
  if found then
    v_revision_changed := v_existing.current_source_revision_id is distinct from v_source_revision.id;
    if v_revision_changed and v_state <> 'withdrawn' then
      v_state := 'source_changed'; v_health := 'reconciliation_required';
    end if;
    update public.procurement_demands set
      current_source_revision_id = v_source_revision.id,
      project_id = v_request.project_id,
      construction_site_id = v_request.construction_site_id,
      source_code_snapshot = v_request.code,
      intake_state = v_state,
      health_state = v_health,
      version = case when current_source_revision_id is distinct from v_source_revision.id
        or intake_state is distinct from v_state or health_state is distinct from v_health
        then version + 1 else version end,
      updated_by = v_actor,
      updated_at = now()
    where id = v_existing.id returning * into v_demand;
  else
    insert into public.procurement_demands(
      owner_context_id, source_document_id, current_source_revision_id,
      project_id, construction_site_id, source_code_snapshot,
      intake_state, health_state, created_by, updated_by
    ) values (
      v_owner.id, v_document.id, v_source_revision.id,
      v_request.project_id, v_request.construction_site_id, v_request.code,
      v_state, v_health, v_actor, v_actor
    ) returning * into v_demand;
  end if;

  for v_line in select value from jsonb_array_elements(v_request.items)
  loop
    select * into strict v_registry from public.procurement_source_line_registry
    where source_document_id = v_document.id and source_line_id = v_line ->> 'lineId'
      and archived_at is null for update;
    v_requested := (v_line ->> 'requestQty')::numeric(20,6);
    v_approved := case when v_approval_valid then v_requested else null end;

    insert into public.procurement_demand_lines(
      demand_id, source_line_registry_id, current_source_revision_id,
      item_id, unit, requested_qty, approved_qty, work_boq_item_id,
      material_budget_item_id, intake_state, health_state
    ) values (
      v_demand.id, v_registry.id, v_source_revision.id,
      v_registry.item_id, v_registry.unit, v_requested, v_approved,
      v_registry.work_boq_item_id, v_registry.material_budget_item_id, v_state, v_health
    )
    on conflict (source_line_registry_id) do update set
      current_source_revision_id = excluded.current_source_revision_id,
      item_id = excluded.item_id,
      unit = excluded.unit,
      requested_qty = excluded.requested_qty,
      approved_qty = excluded.approved_qty,
      work_boq_item_id = excluded.work_boq_item_id,
      material_budget_item_id = excluded.material_budget_item_id,
      intake_state = excluded.intake_state,
      health_state = excluded.health_state,
      version = case when public.procurement_demand_lines.current_source_revision_id is distinct from excluded.current_source_revision_id
        or public.procurement_demand_lines.intake_state is distinct from excluded.intake_state
        then public.procurement_demand_lines.version + 1 else public.procurement_demand_lines.version end,
      updated_at = now()
    returning * into v_demand_line;

    update public.procurement_source_line_registry
    set downstream_locked = true, updated_at = now() where id = v_registry.id;
    insert into public.procurement_demand_revisions(
      demand_line_id, source_revision_id, source_line_hash, requested_qty,
      approved_qty, unit, project_id, construction_site_id, work_boq_item_id,
      material_budget_item_id, approval_revision, approval_hash
    ) values (
      v_demand_line.id, v_source_revision.id, v_registry.source_hash, v_requested,
      v_approved, v_registry.unit, v_request.project_id, v_request.construction_site_id,
      v_registry.work_boq_item_id, v_registry.material_budget_item_id,
      v_request.approved_content_revision, v_request.approved_content_hash
    ) on conflict (demand_line_id, source_revision_id) do nothing;
    v_line_count := v_line_count + 1;
  end loop;

  update public.procurement_demand_lines line set
    intake_state = 'source_changed', health_state = 'reconciliation_required',
    version = version + 1, updated_at = now()
  where line.demand_id = v_demand.id
    and not exists (
      select 1 from jsonb_array_elements(v_request.items) item(value)
      join public.procurement_source_line_registry registry
        on registry.source_document_id = v_document.id and registry.source_line_id = item.value ->> 'lineId'
      where registry.id = line.source_line_registry_id
    )
    and line.intake_state <> 'source_changed';

  insert into app_private.procurement_events_outbox(
    owner_context_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, payload, actor_user_id
  ) values (
    v_owner.id, 'procurement_demand', v_demand.id, v_demand.version,
    case when v_revision_changed then 'procurement.demand.source_changed' else 'procurement.demand.synced' end,
    jsonb_build_object('demandId', v_demand.id, 'sourceDocumentId', p_request_id,
      'sourceRevision', v_request.content_revision, 'intakeState', v_demand.intake_state),
    v_actor
  );
  v_result := jsonb_build_object(
    'commandId', v_command.id, 'outcome', 'committed', 'committedAt', now(),
    'changedEntities', jsonb_build_array(jsonb_build_object('type', 'demand', 'id', v_demand.id, 'version', v_demand.version::text)),
    'createdDocumentIds', jsonb_build_array(v_demand.id), 'warnings', '[]'::jsonb,
    'refreshScopes', jsonb_build_array('project:' || v_request.project_id),
    'demandId', v_demand.id, 'demandVersion', v_demand.version,
    'sourceRevision', v_request.content_revision, 'intakeState', v_demand.intake_state,
    'lineCount', v_line_count
  );
  update app_private.procurement_commands set result = v_result, committed_at = now() where id = v_command.id;
  return v_result;
end;
$$;
revoke all on function app_private.sync_project_material_request_demand_v1(text, bigint, text) from public, anon, authenticated;

create function public.sync_project_material_request_demand_v1(
  p_request_id text, p_expected_source_revision bigint, p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.sync_project_material_request_demand_v1(
    p_request_id, p_expected_source_revision, p_idempotency_key
  );
$$;
revoke all on function public.sync_project_material_request_demand_v1(text, bigint, text) from public, anon;
grant execute on function public.sync_project_material_request_demand_v1(text, bigint, text) to authenticated, service_role;

create or replace function app_private.resolve_procurement_source_change_v1(
  p_demand_id uuid, p_expected_version bigint, p_disposition text,
  p_reason text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_owner public.procurement_owner_contexts%rowtype;
  v_demand public.procurement_demands%rowtype;
  v_request public.requests%rowtype;
  v_document public.procurement_source_documents%rowtype;
  v_command app_private.procurement_commands%rowtype;
  v_hash text;
  v_result jsonb;
  v_next_state text;
begin
  if p_demand_id is null or p_expected_version is null or p_expected_version < 1
     or p_disposition not in ('accept_current_revision', 'withdraw')
     or nullif(btrim(coalesce(p_reason, '')), '') is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_COMMAND_INVALID';
  end if;
  select * into strict v_owner from public.procurement_owner_contexts
  where logical_key = 'company_default' and is_active for update;
  select * into v_demand from public.procurement_demands where id = p_demand_id for update;
  if not found or v_demand.owner_context_id <> v_owner.id then
    raise exception using errcode = 'P0002', message = 'PROCUREMENT_DEMAND_NOT_FOUND';
  end if;
  perform app_private.procurement_assert_intake_access(v_actor, v_demand.project_id, v_demand.construction_site_id);
  select * into strict v_document from public.procurement_source_documents
  where id = v_demand.source_document_id for update;
  select * into strict v_request from public.requests
  where id = v_document.source_document_id and request_origin = 'project' for update;
  v_hash := encode(extensions.digest(jsonb_build_object(
    'demandId', p_demand_id, 'expectedVersion', p_expected_version,
    'disposition', p_disposition, 'reason', btrim(p_reason)
  )::text, 'sha256'), 'hex');
  insert into app_private.procurement_commands(
    owner_context_id, command_type, idempotency_key, actor_user_id, payload_hash
  ) values (v_owner.id, 'resolve_procurement_source_change', p_idempotency_key, v_actor, v_hash)
  on conflict (owner_context_id, command_type, idempotency_key) do nothing;
  select * into strict v_command from app_private.procurement_commands
  where owner_context_id = v_owner.id and command_type = 'resolve_procurement_source_change'
    and idempotency_key = p_idempotency_key for update;
  if v_command.actor_user_id is distinct from v_actor or v_command.payload_hash <> v_hash then
    raise exception using errcode = '40001', message = 'PROCUREMENT_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.result is not null then return v_command.result || jsonb_build_object('outcome', 'replayed'); end if;
  if v_demand.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'PROCUREMENT_VERSION_CONFLICT';
  end if;
  if v_demand.intake_state <> 'source_changed' then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_CHANGE_NOT_OPEN';
  end if;
  if p_disposition = 'accept_current_revision' and (
    v_request.approved_content_revision is distinct from v_request.content_revision
    or v_request.approved_content_hash is distinct from v_request.content_hash
    or v_request.status::text not in ('APPROVED', 'IN_TRANSIT', 'COMPLETED')
  ) then raise exception using errcode = '22023', message = 'PROCUREMENT_CURRENT_REVISION_NOT_APPROVED'; end if;

  v_next_state := case when p_disposition = 'withdraw' then 'withdrawn' else 'ready' end;
  update public.procurement_demands set intake_state = v_next_state, health_state = 'healthy',
    version = version + 1, updated_by = v_actor, updated_at = now()
  where id = v_demand.id returning * into v_demand;
  update public.procurement_demand_lines set intake_state = v_next_state, health_state = 'healthy',
    version = version + 1, updated_at = now() where demand_id = v_demand.id;
  insert into public.procurement_source_dispositions(
    demand_id, source_revision_id, disposition, reason, actor_user_id, demand_version
  ) values (
    v_demand.id, v_demand.current_source_revision_id, p_disposition, btrim(p_reason), v_actor, v_demand.version
  );
  insert into app_private.procurement_events_outbox(
    owner_context_id, aggregate_type, aggregate_id, aggregate_version, event_type, payload, actor_user_id
  ) values (
    v_owner.id, 'procurement_demand', v_demand.id, v_demand.version,
    'procurement.demand.source_change_resolved',
    jsonb_build_object('demandId', v_demand.id, 'disposition', p_disposition, 'intakeState', v_next_state), v_actor
  );
  v_result := jsonb_build_object(
    'commandId', v_command.id, 'outcome', 'committed', 'committedAt', now(),
    'changedEntities', jsonb_build_array(jsonb_build_object('type', 'demand', 'id', v_demand.id, 'version', v_demand.version::text)),
    'createdDocumentIds', '[]'::jsonb, 'warnings', '[]'::jsonb,
    'refreshScopes', jsonb_build_array('project:' || v_demand.project_id),
    'demandId', v_demand.id, 'demandVersion', v_demand.version, 'intakeState', v_next_state
  );
  update app_private.procurement_commands set result = v_result, committed_at = now() where id = v_command.id;
  return v_result;
end;
$$;
revoke all on function app_private.resolve_procurement_source_change_v1(uuid, bigint, text, text, text) from public, anon, authenticated;

create function public.resolve_procurement_source_change_v1(
  p_demand_id uuid, p_expected_version bigint, p_disposition text,
  p_reason text, p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.resolve_procurement_source_change_v1(
    p_demand_id, p_expected_version, p_disposition, p_reason, p_idempotency_key
  );
$$;
revoke all on function public.resolve_procurement_source_change_v1(uuid, bigint, text, text, text) from public, anon;
grant execute on function public.resolve_procurement_source_change_v1(uuid, bigint, text, text, text) to authenticated, service_role;

create index procurement_demands_scope_state_idx
  on public.procurement_demands(project_id, construction_site_id, intake_state, updated_at desc);
create index procurement_demand_lines_demand_state_idx
  on public.procurement_demand_lines(demand_id, intake_state);
create index procurement_outbox_pending_idx
  on app_private.procurement_events_outbox(created_at, id) where delivered_at is null;

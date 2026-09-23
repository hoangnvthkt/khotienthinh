-- Project V2 material demand is published into the existing G2 ledger.
-- The logical source-line identity survives immutable Project V2 revisions.
alter table public.project_v2_plan_lines add column source_identity_id uuid;
update public.project_v2_plan_lines set source_identity_id = id where source_identity_id is null;
alter table public.project_v2_plan_lines alter column source_identity_id set not null;
alter table public.project_v2_plan_lines add constraint project_v2_source_identity_revision_unique
  unique (plan_id, revision_no, source_identity_id);

create or replace function app_private.project_v2_default_source_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source_identity_id is null then new.source_identity_id := new.id; end if;
  return new;
end;
$$;
revoke all on function app_private.project_v2_default_source_identity() from public, anon, authenticated;
create trigger trg_project_v2_default_source_identity
before insert on public.project_v2_plan_lines
for each row execute function app_private.project_v2_default_source_identity();

create or replace function app_private.project_v2_material_demand_exposure(p_demand_line_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(
    coalesce((select sum(a.reserved_need_qty + a.committed_need_qty)
      from public.procurement_supply_allocations a
      where a.demand_line_id = p_demand_line_id
        and a.state not in ('released', 'cancelled')), 0),
    coalesce((select sum(f.quantity) from public.procurement_fulfillment_attributions f
      where f.demand_line_id = p_demand_line_id), 0)
  )::numeric(20,6);
$$;
revoke all on function app_private.project_v2_material_demand_exposure(uuid)
  from public, anon, authenticated;
create or replace function app_private.sync_material_plan_demand_v1(
  p_plan_id uuid, p_expected_revision integer, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_workspace public.project_v2_workspaces%rowtype;
  v_plan public.project_v2_plans%rowtype;
  v_plan_revision public.project_v2_plan_revisions%rowtype;
  v_owner public.procurement_owner_contexts%rowtype;
  v_command app_private.procurement_commands%rowtype;
  v_document public.procurement_source_documents%rowtype;
  v_source_revision public.procurement_source_revisions%rowtype;
  v_demand public.procurement_demands%rowtype;
  v_demand_line public.procurement_demand_lines%rowtype;
  v_registry public.procurement_source_line_registry%rowtype;
  v_line public.project_v2_plan_lines%rowtype;
  v_previous_revision_id uuid;
  v_payload_hash text;
  v_line_hash text;
  v_revision_changed boolean := false;
  v_has_downstream boolean := false;
  v_reduction_issue boolean := false;
  v_exposure numeric(20,6);
  v_line_count integer := 0;
  v_result jsonb;
begin
  if p_plan_id is null or p_expected_revision is null or p_expected_revision < 1
    or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_COMMAND_INVALID';
  end if;
  select w.* into v_workspace from public.project_v2_workspaces w
    join public.project_v2_plans p on p.workspace_id = w.id
    where p.id = p_plan_id and w.lifecycle <> 'archived' for update of w;
  if v_workspace.id is null then
    raise exception using errcode = 'P0002', message = 'PROJECT_V2_PLAN_NOT_FOUND';
  end if;
  select * into v_plan from public.project_v2_plans p
    where p.id = p_plan_id and p.workspace_id = v_workspace.id for update;
  perform app_private.project_v2_assert_permission(v_workspace, 'material', 'approve', v_actor);
  if v_plan.plan_type <> 'material' or v_plan.status <> 'approved'
    or v_plan.effective_revision_no is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'PROJECT_V2_MATERIAL_REVISION_STALE';
  end if;
  select * into strict v_plan_revision from public.project_v2_plan_revisions r
    where r.plan_id = p_plan_id and r.revision_no = p_expected_revision;
  select * into strict v_owner from public.procurement_owner_contexts
    where logical_key = 'company_default' and is_active for update;
  v_payload_hash := encode(extensions.digest(jsonb_build_object(
    'planId', p_plan_id, 'revision', p_expected_revision,
    'sourceHash', v_plan_revision.content_hash)::text, 'sha256'), 'hex');
  insert into app_private.procurement_commands(
    owner_context_id, command_type, idempotency_key, actor_user_id, payload_hash
  ) values (v_owner.id, 'sync_material_plan_demand', p_idempotency_key, v_actor, v_payload_hash)
    on conflict (owner_context_id, command_type, idempotency_key) do nothing;
  select * into strict v_command from app_private.procurement_commands
    where owner_context_id = v_owner.id and command_type = 'sync_material_plan_demand'
      and idempotency_key = p_idempotency_key for update;
  if v_command.actor_user_id is distinct from v_actor or v_command.payload_hash <> v_payload_hash then
    raise exception using errcode = '40001', message = 'PROCUREMENT_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.result is not null then
    return v_command.result || jsonb_build_object('outcome', 'replayed');
  end if;

  select * into v_document from public.procurement_source_documents d
    where d.owner_context_id = v_owner.id and d.source_adapter = 'material_plan'
      and d.source_document_id = p_plan_id::text for update;
  if v_document.id is not null and (v_document.current_revision > p_expected_revision
      or (v_document.current_revision = p_expected_revision
        and v_document.source_hash <> v_plan_revision.content_hash)) then
    raise exception using errcode = '40001', message = 'PROCUREMENT_SOURCE_REVISION_CONFLICT';
  end if;
  insert into public.procurement_source_documents(
    owner_context_id, source_adapter, source_document_id, source_code_snapshot,
    project_id, construction_site_id, current_revision, source_hash, archived_at
  ) values (v_owner.id, 'material_plan', p_plan_id::text, v_plan.code,
    v_workspace.project_id, v_workspace.primary_construction_site_id::text,
    p_expected_revision, v_plan_revision.content_hash, null)
  on conflict (owner_context_id, source_adapter, source_document_id) do update set
    source_code_snapshot = excluded.source_code_snapshot,
    project_id = excluded.project_id, construction_site_id = excluded.construction_site_id,
    current_revision = excluded.current_revision, source_hash = excluded.source_hash,
    archived_at = null, updated_at = now()
  returning * into v_document;
  insert into public.procurement_source_revisions(
    source_document_id, revision, source_hash, payload, changed_by
  ) values (v_document.id, p_expected_revision, v_plan_revision.content_hash,
    jsonb_build_object('planId', p_plan_id, 'revision', p_expected_revision,
      'approvedSnapshot', v_plan_revision.approved_snapshot), v_actor)
    on conflict (source_document_id, revision) do nothing;
  select * into strict v_source_revision from public.procurement_source_revisions r
    where r.source_document_id = v_document.id and r.revision = p_expected_revision;
  if v_source_revision.source_hash <> v_plan_revision.content_hash then
    raise exception using errcode = '40001', message = 'PROCUREMENT_SOURCE_REVISION_CONFLICT';
  end if;

  select * into v_demand from public.procurement_demands d
    where d.source_document_id = v_document.id for update;
  v_previous_revision_id := v_demand.current_source_revision_id;
  v_revision_changed := v_demand.id is not null
    and v_previous_revision_id is distinct from v_source_revision.id;
  if v_demand.id is not null and not v_revision_changed then
    v_result := jsonb_build_object('commandId', v_command.id, 'outcome', 'committed',
      'committedAt', now(), 'changedEntities', '[]'::jsonb,
      'createdDocumentIds', jsonb_build_array(v_demand.id), 'warnings', '[]'::jsonb,
      'refreshScopes', jsonb_build_array('project:' || v_workspace.project_id),
      'demandId', v_demand.id, 'demandVersion', v_demand.version,
      'sourceRevision', p_expected_revision, 'intakeState', v_demand.intake_state);
    update app_private.procurement_commands set result = v_result, committed_at = now()
      where id = v_command.id;
    return v_result;
  end if;
  if v_demand.id is not null and v_revision_changed then
    select exists (
      select 1 from public.procurement_demand_lines dl
      where dl.demand_id = v_demand.id and (
        exists (select 1 from public.procurement_supply_allocations a
          where a.demand_line_id = dl.id and a.state not in ('released', 'cancelled'))
        or exists (select 1 from public.procurement_fulfillment_attributions f
          where f.demand_line_id = dl.id)
      )
    ) into v_has_downstream;
  end if;
  if v_demand.id is null then
    insert into public.procurement_demands(owner_context_id, source_document_id,
      current_source_revision_id, project_id, construction_site_id,
      source_code_snapshot, intake_state, health_state, created_by, updated_by)
    values (v_owner.id, v_document.id, v_source_revision.id, v_workspace.project_id,
      v_workspace.primary_construction_site_id::text, v_plan.code,
      'ready', 'healthy', v_actor, v_actor) returning * into v_demand;
  elsif v_revision_changed then
    update public.procurement_demands set current_source_revision_id = v_source_revision.id,
      project_id = v_workspace.project_id,
      construction_site_id = v_workspace.primary_construction_site_id::text,
      source_code_snapshot = v_plan.code,
      intake_state = case when v_has_downstream then 'source_changed' else 'ready' end,
      health_state = case when v_has_downstream then 'reconciliation_required' else 'healthy' end,
      version = version + 1, updated_by = v_actor, updated_at = now()
    where id = v_demand.id returning * into v_demand;
  end if;

  for v_line in select l.* from public.project_v2_plan_lines l
    where l.plan_id = p_plan_id and l.revision_no = p_expected_revision
    order by l.sort_order, l.id loop
    if v_line.inventory_item_id is null or nullif(btrim(v_line.unit), '') is null
      or v_line.quantity is null or v_line.quantity <= 0
      or v_line.needed_date is null or nullif(btrim(v_line.destination_id), '') is null then
      raise exception using errcode = '22023', message = 'PROJECT_V2_MATERIAL_INCOMPLETE';
    end if;
    v_line_hash := encode(extensions.digest(jsonb_build_object(
      'sourceLineId', v_line.source_identity_id, 'revisionLineId', v_line.id,
      'itemId', v_line.inventory_item_id, 'unit', v_line.unit,
      'approvedQty', v_line.quantity, 'calculatedQty', v_line.calculated_quantity,
      'neededDate', v_line.needed_date, 'destinationId', v_line.destination_id,
      'derivations', coalesce((select jsonb_agg(to_jsonb(s) order by s.id)
        from public.project_v2_plan_line_sources s where s.target_line_id = v_line.id), '[]'::jsonb)
    )::text, 'sha256'), 'hex');
    select * into v_registry from public.procurement_source_line_registry r
      where r.source_document_id = v_document.id
        and r.source_line_id = v_line.source_identity_id::text for update;
    if v_registry.id is not null and v_registry.downstream_locked and
      (v_registry.item_id <> v_line.inventory_item_id or v_registry.unit <> v_line.unit) then
      raise exception using errcode = '23514', message = 'SOURCE_LINE_IDENTITY_LOCKED';
    end if;
    insert into public.procurement_source_line_registry(
      source_document_id, source_line_id, item_id, unit, source_hash,
      first_revision, last_revision, archived_at
    ) values (v_document.id, v_line.source_identity_id::text,
      v_line.inventory_item_id, v_line.unit, v_line_hash,
      coalesce(v_registry.first_revision, p_expected_revision), p_expected_revision, null)
    on conflict (source_document_id, source_line_id) do update set
      item_id = excluded.item_id, unit = excluded.unit, source_hash = excluded.source_hash,
      last_revision = excluded.last_revision, archived_at = null, updated_at = now()
    returning * into v_registry;
    select * into v_demand_line from public.procurement_demand_lines dl
      where dl.source_line_registry_id = v_registry.id for update;
    if v_demand_line.id is not null and v_has_downstream and v_revision_changed then
      v_exposure := app_private.project_v2_material_demand_exposure(v_demand_line.id);
      if v_line.quantity < v_exposure then
        v_reduction_issue := true;
        if not exists (select 1 from public.procurement_reconciliation_issues i
          where i.owner_context_id = v_owner.id and i.source_adapter = 'material_plan'
            and i.source_document_ref = p_plan_id::text
            and i.source_line_ref = v_registry.source_line_id
            and i.issue_code = 'MATERIAL_PLAN_REDUCTION_WITH_DOWNSTREAM'
            and i.status = 'open') then
          insert into public.procurement_reconciliation_issues(
            owner_context_id, source_adapter, source_document_ref, source_line_ref,
            issue_code, severity, details)
          values (v_owner.id, 'material_plan', p_plan_id::text, v_registry.source_line_id,
            'MATERIAL_PLAN_REDUCTION_WITH_DOWNSTREAM', 'blocking',
            jsonb_build_object('previousApprovedQty', v_demand_line.approved_qty,
              'downstreamExposureQty', v_exposure,
              'replacementApprovedQty', v_line.quantity, 'replacementRevision', p_expected_revision));
        end if;
      end if;
      update public.procurement_demand_lines set intake_state = 'source_changed',
        health_state = 'reconciliation_required', version = version + 1, updated_at = now()
      where id = v_demand_line.id returning * into v_demand_line;
    else
      insert into public.procurement_demand_lines(demand_id, source_line_registry_id,
        current_source_revision_id, item_id, unit, requested_qty, approved_qty,
        intake_state, health_state)
      values (v_demand.id, v_registry.id, v_source_revision.id,
        v_registry.item_id, v_registry.unit, v_line.quantity, v_line.quantity,
        case when v_has_downstream then 'source_changed' else 'ready' end,
        case when v_has_downstream then 'reconciliation_required' else 'healthy' end)
      on conflict (source_line_registry_id) do update set
        current_source_revision_id = excluded.current_source_revision_id,
        item_id = excluded.item_id, unit = excluded.unit,
        requested_qty = excluded.requested_qty, approved_qty = excluded.approved_qty,
        intake_state = excluded.intake_state, health_state = excluded.health_state,
        version = case when public.procurement_demand_lines.current_source_revision_id
          is distinct from excluded.current_source_revision_id
          then public.procurement_demand_lines.version + 1
          else public.procurement_demand_lines.version end,
        updated_at = now()
      returning * into v_demand_line;
    end if;
    insert into public.procurement_demand_revisions(
      demand_line_id, source_revision_id, source_line_hash, requested_qty,
      approved_qty, unit, project_id, construction_site_id, approval_revision, approval_hash
    ) values (v_demand_line.id, v_source_revision.id, v_line_hash,
      v_line.quantity, v_line.quantity, v_line.unit, v_workspace.project_id,
      v_workspace.primary_construction_site_id::text, p_expected_revision,
      v_plan_revision.content_hash)
    on conflict (demand_line_id, source_revision_id) do nothing;
    v_line_count := v_line_count + 1;
  end loop;
  if v_line_count = 0 then
    raise exception using errcode = '22023', message = 'PROJECT_V2_MATERIAL_LINES_REQUIRED';
  end if;

  if v_revision_changed then
    update public.procurement_demand_lines dl set
      intake_state = case when v_has_downstream then 'source_changed' else 'withdrawn' end,
      health_state = case when v_has_downstream then 'reconciliation_required' else 'healthy' end,
      version = version + 1, updated_at = now()
    where dl.demand_id = v_demand.id and not exists (
      select 1 from public.project_v2_plan_lines l
      join public.procurement_source_line_registry r on r.source_line_id = l.source_identity_id::text
      where l.plan_id = p_plan_id and l.revision_no = p_expected_revision
        and r.source_document_id = v_document.id and r.id = dl.source_line_registry_id
    );
    if v_has_downstream and exists (
      select 1 from public.procurement_demand_lines dl
      where dl.demand_id = v_demand.id and dl.intake_state = 'source_changed'
        and app_private.project_v2_material_demand_exposure(dl.id) > 0
        and not exists (select 1 from public.project_v2_plan_lines l
          join public.procurement_source_line_registry r on r.source_line_id = l.source_identity_id::text
          where l.plan_id = p_plan_id and l.revision_no = p_expected_revision
            and r.source_document_id = v_document.id and r.id = dl.source_line_registry_id)
    ) then
      v_reduction_issue := true;
      if not exists (select 1 from public.procurement_reconciliation_issues i
        where i.owner_context_id = v_owner.id and i.source_adapter = 'material_plan'
          and i.source_document_ref = p_plan_id::text
          and i.issue_code = 'MATERIAL_PLAN_REMOVED_LINE_WITH_DOWNSTREAM'
          and i.status = 'open') then
        insert into public.procurement_reconciliation_issues(owner_context_id, source_adapter,
          source_document_ref, issue_code, severity, details)
        values (v_owner.id, 'material_plan', p_plan_id::text,
          'MATERIAL_PLAN_REMOVED_LINE_WITH_DOWNSTREAM', 'blocking',
          jsonb_build_object('replacementRevision', p_expected_revision));
      end if;
    end if;
    update public.procurement_source_line_registry r set archived_at = now(),
      last_revision = p_expected_revision, updated_at = now()
    where r.source_document_id = v_document.id and r.archived_at is null
      and not r.downstream_locked and not exists (
        select 1 from public.project_v2_plan_lines l
        where l.plan_id = p_plan_id and l.revision_no = p_expected_revision
          and l.source_identity_id::text = r.source_line_id
      );
  end if;
  insert into app_private.procurement_events_outbox(owner_context_id, aggregate_type,
    aggregate_id, aggregate_version, event_type, payload, actor_user_id)
  values (v_owner.id, 'procurement_demand', v_demand.id, v_demand.version,
    case when v_revision_changed then 'procurement.demand.source_changed'
      else 'procurement.demand.synced' end,
    jsonb_build_object('demandId', v_demand.id, 'sourceDocumentId', p_plan_id,
      'sourceRevision', p_expected_revision, 'intakeState', v_demand.intake_state,
      'reductionIssue', v_reduction_issue), v_actor);
  v_result := jsonb_build_object('commandId', v_command.id, 'outcome', 'committed',
    'committedAt', now(), 'changedEntities', jsonb_build_array(jsonb_build_object(
      'type', 'demand', 'id', v_demand.id, 'version', v_demand.version::text)),
    'createdDocumentIds', jsonb_build_array(v_demand.id),
    'warnings', case when v_reduction_issue then jsonb_build_array(jsonb_build_object(
      'code', 'MATERIAL_PLAN_REDUCTION_WITH_DOWNSTREAM',
      'message', 'Cần đối chiếu phần đã cam kết trước khi giảm nhu cầu')) else '[]'::jsonb end,
    'refreshScopes', jsonb_build_array('project:' || v_workspace.project_id),
    'demandId', v_demand.id, 'demandVersion', v_demand.version,
    'sourceRevision', p_expected_revision, 'intakeState', v_demand.intake_state,
    'lineCount', v_line_count);
  update app_private.procurement_commands set result = v_result, committed_at = now()
    where id = v_command.id;
  return v_result;
end;
$$;
revoke all on function app_private.sync_material_plan_demand_v1(uuid, integer, text)
  from public, anon, authenticated;

create or replace function public.sync_material_plan_demand_v1(
  p_plan_id uuid, p_expected_revision integer, p_idempotency_key text
) returns jsonb language sql security definer set search_path = '' as $$
  select app_private.sync_material_plan_demand_v1(p_plan_id, p_expected_revision, p_idempotency_key);
$$;
revoke all on function public.sync_material_plan_demand_v1(uuid, integer, text) from public, anon;
grant execute on function public.sync_material_plan_demand_v1(uuid, integer, text)
  to authenticated, service_role;

-- Preserve stable source-line identities when an editable revision is saved.
create or replace function public.save_project_v2_plan_v1(
  p_workspace_id uuid, p_plan_id uuid, p_expected_version bigint,
  p_idempotency_key text, p_plan_type text, p_code text, p_title text,
  p_period_start date, p_period_end date, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_workspace public.project_v2_workspaces%rowtype;
  v_plan public.project_v2_plans%rowtype;
  v_line jsonb;
  v_source jsonb;
  v_line_id uuid;
  v_source_plan public.project_v2_plans%rowtype;
  v_source_line public.project_v2_plan_lines%rowtype;
  v_source_hash text;
  v_source_id uuid;
  v_existing jsonb;
  v_result jsonb;
  v_payload jsonb;
  v_quantity_text text;
  v_line_identities jsonb := '{}'::jsonb;
  v_order integer := 0;
begin
  select * into v_workspace from public.project_v2_workspaces w
    where w.id = p_workspace_id and w.lifecycle <> 'archived' for update of w;
  if v_workspace.id is null or p_plan_type not in ('month', 'construction', 'material') then
    raise exception using errcode = '22023', message = 'PROJECT_V2_INVALID_WORKSPACE_OR_TYPE';
  end if;
  perform app_private.project_v2_assert_permission(v_workspace, p_plan_type,
    case when p_plan_id is null then 'create' else 'edit_all' end, v_actor);
  if nullif(btrim(p_code), '') is null or nullif(btrim(p_title), '') is null
    or p_period_start is null or p_period_end is null or p_period_end < p_period_start
    or jsonb_typeof(p_lines) <> 'array' then
    raise exception using errcode = '22023', message = 'PROJECT_V2_INVALID_DRAFT';
  end if;
  if p_plan_id is not null then
    select * into v_plan from public.project_v2_plans p where p.id = p_plan_id for update of p;
    if v_plan.id is null or v_plan.workspace_id <> p_workspace_id or v_plan.plan_type <> p_plan_type then
      raise exception using errcode = '42501', message = 'PROJECT_V2_PLAN_SCOPE_DENIED';
    end if;
    if v_plan.status not in ('draft', 'returned') then
      raise exception using errcode = '23514', message = 'PROJECT_V2_PLAN_IMMUTABLE';
    end if;
  elsif p_expected_version is not null then
    raise exception using errcode = '22023', message = 'PROJECT_V2_VERSION_INVALID';
  end if;

  -- Lock every referenced source in deterministic order before changing lines.
  for v_source_id in
    select distinct (source_item.value ->> 'sourcePlanId')::uuid as id
    from jsonb_array_elements(p_lines) line_item,
      lateral jsonb_array_elements(coalesce(line_item.value -> 'sources',
        line_item.value -> 'derivations', '[]'::jsonb)) source_item
    where source_item.value ? 'sourcePlanId'
    order by id
  loop
    perform 1 from public.project_v2_plans p where p.id = v_source_id for update of p;
  end loop;
  for v_source_id in
    select distinct (source_item.value ->> 'sourceLineId')::uuid as id
    from jsonb_array_elements(p_lines) line_item,
      lateral jsonb_array_elements(coalesce(line_item.value -> 'sources',
        line_item.value -> 'derivations', '[]'::jsonb)) source_item
    where source_item.value ? 'sourceLineId'
    order by id
  loop
    perform 1 from public.project_v2_plan_lines l where l.id = v_source_id for update of l;
  end loop;
  if p_plan_id is not null then
    perform 1 from public.project_v2_plan_lines l where l.plan_id = p_plan_id
      and l.revision_no = v_plan.revision_no order by l.id for update;
  end if;
  v_payload := jsonb_build_object('planId', p_plan_id, 'expectedVersion', p_expected_version,
    'planType', p_plan_type, 'code', p_code, 'title', p_title,
    'periodStart', p_period_start, 'periodEnd', p_period_end, 'lines', p_lines);
  v_existing := app_private.project_v2_begin_command(v_actor, p_workspace_id,
    'save', p_idempotency_key, v_payload);
  if v_existing is not null then return v_existing; end if;
  if p_plan_id is not null and (p_expected_version is null or v_plan.version <> p_expected_version) then
    raise exception using errcode = '40001', message = 'PROJECT_V2_VERSION_STALE';
  end if;
  if p_plan_id is null then
    insert into public.project_v2_plans(workspace_id, plan_type, code, title, period_start,
      period_end, creator_user_id)
    values (p_workspace_id, p_plan_type, p_code, p_title, p_period_start,
      p_period_end, v_actor) returning * into v_plan;
  else
    select coalesce(jsonb_object_agg(l.id::text, l.source_identity_id::text), '{}'::jsonb)
      into v_line_identities from public.project_v2_plan_lines l
      where l.plan_id = v_plan.id and l.revision_no = v_plan.revision_no;
    delete from public.project_v2_plan_line_sources s where s.target_line_id in
      (select l.id from public.project_v2_plan_lines l where l.plan_id = v_plan.id
        and l.revision_no = v_plan.revision_no);
    delete from public.project_v2_plan_lines l where l.plan_id = v_plan.id
      and l.revision_no = v_plan.revision_no;
    update public.project_v2_plans set code = p_code, title = p_title,
      period_start = p_period_start, period_end = p_period_end,
      status = 'draft', submitter_user_id = null, version = version + 1,
      updated_at = now() where id = v_plan.id returning * into v_plan;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_order := v_order + 1;
    v_quantity_text := v_line ->> 'quantity';
    if v_quantity_text is not null and v_quantity_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$' then
      raise exception using errcode = '22023', message = 'PROJECT_V2_QUANTITY_INVALID';
    end if;
    if p_plan_type = 'construction' and v_line ->> 'crewId' is not null
      and not exists (select 1 from public.project_v2_crews c where c.id = (v_line ->> 'crewId')::uuid
        and c.workspace_id = p_workspace_id and c.is_active) then
      raise exception using errcode = '42501', message = 'PROJECT_V2_CREW_SCOPE_DENIED';
    end if;
    if p_plan_type = 'construction' and nullif(btrim(v_line ->> 'baselineExceptionReason'), '') is not null
      and jsonb_array_length(coalesce(v_line -> 'sources', '[]'::jsonb)) <> 0 then
      raise exception using errcode = '22023', message = 'PROJECT_V2_BASELINE_EXCEPTION_SOURCE_CONFLICT';
    end if;
    v_line_id := coalesce((v_line ->> 'id')::uuid, gen_random_uuid());
    if p_plan_id is not null and v_line ->> 'id' is not null
      and not v_line_identities ? v_line_id::text then
      raise exception using errcode = '42501', message = 'PROJECT_V2_LINE_ID_SCOPE_DENIED';
    end if;
    insert into public.project_v2_plan_lines(id, plan_id, revision_no, plan_type,
      sort_order, contract_item_id, baseline_revision, work_item_id,
      inventory_item_id, unit, quantity, unit_price_snapshot, currency,
      work_start, work_end, crew_id, needed_date, destination_id,
      baseline_exception_reason, note, calculated_quantity, override_reason,
      source_identity_id)
    values (v_line_id, v_plan.id, v_plan.revision_no, p_plan_type,
      v_order, (v_line ->> 'contractItemId')::uuid, v_line ->> 'baselineRevision',
      v_line ->> 'workItemId', v_line ->> 'itemId', v_line ->> 'unit',
      v_quantity_text::numeric(20,6), (v_line ->> 'unitPriceSnapshot')::numeric(20,6),
      v_line ->> 'currency', (v_line ->> 'workStart')::date,
      (v_line ->> 'workEnd')::date, (v_line ->> 'crewId')::uuid,
      (v_line ->> 'neededDate')::date, v_line ->> 'destinationId', v_line ->> 'baselineExceptionReason',
      v_line ->> 'note', (v_line ->> 'calculatedQuantity')::numeric(20,6),
      v_line ->> 'overrideReason',
      coalesce((v_line_identities ->> v_line_id::text)::uuid, v_line_id));

    for v_source in select value from jsonb_array_elements(coalesce(
      v_line -> 'sources', v_line -> 'derivations', '[]'::jsonb)) loop
      select * into v_source_plan from public.project_v2_plans
        where id = (v_source ->> 'sourcePlanId')::uuid;
      select r.content_hash into v_source_hash from public.project_v2_plan_revisions r
        where r.plan_id = v_source_plan.id
          and r.revision_no = (v_source ->> 'sourceRevision')::integer;
      select * into v_source_line from public.project_v2_plan_lines l
        where l.id = (v_source ->> 'sourceLineId')::uuid
          and l.plan_id = v_source_plan.id
          and l.revision_no = (v_source ->> 'sourceRevision')::integer;
      if v_source_plan.id is null or v_source_plan.workspace_id <> p_workspace_id
        or v_source_plan.plan_type <> (case when p_plan_type = 'construction' then 'month' else 'construction' end)
        or v_source_hash is null or v_source_line.id is null or (v_source ? 'sourcePlanHash'
          and v_source ->> 'sourcePlanHash' <> v_source_hash) then
        raise exception using errcode = '40001', message = 'PROJECT_V2_SOURCE_HASH_STALE';
      end if;
      v_quantity_text := coalesce(v_source ->> 'sourceQuantity', v_source ->> 'sourceWorkQuantity');
      if v_quantity_text is not null and v_quantity_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$' then
        raise exception using errcode = '22023', message = 'PROJECT_V2_QUANTITY_INVALID';
      end if;
      insert into public.project_v2_plan_line_sources(target_line_id, source_plan_id,
        source_plan_revision_no, source_plan_line_id, source_plan_hash,
        source_work_quantity, source_unit, norm_resource_id, norm_revision,
        norm_factor, coefficient, conversion_numerator, conversion_denominator, derived_quantity,
        allocated_quantity)
      values (v_line_id, v_source_plan.id, (v_source ->> 'sourceRevision')::integer,
        (v_source ->> 'sourceLineId')::uuid, v_source_hash, v_quantity_text::numeric(20,6),
        v_source_line.unit,
        v_source ->> 'normResourceId', v_source ->> 'normRevision',
        (v_source ->> 'normFactor')::numeric(20,6),
        (v_source ->> 'coefficient')::numeric(20,6),
        (v_source ->> 'conversionNumerator')::numeric(20,6),
        (v_source ->> 'conversionDenominator')::numeric(20,6),
        (v_source ->> 'derivedQuantity')::numeric(20,6),
        (v_source ->> 'allocatedQuantity')::numeric(20,6));
    end loop;
  end loop;
  v_result := jsonb_build_object('planId', v_plan.id, 'version', v_plan.version,
    'revision', v_plan.revision_no, 'status', v_plan.status, 'outcome', 'committed');
  insert into public.project_v2_plan_events(plan_id, revision_no, event_type, actor_user_id,
    payload, command_id)
  select v_plan.id, v_plan.revision_no, 'saved', v_actor,
    jsonb_build_object('lineCount', v_order), c.id
    from app_private.project_v2_commands c where c.actor_user_id = v_actor
      and c.workspace_id = p_workspace_id and c.operation = 'save'
      and c.idempotency_key = p_idempotency_key;
  return app_private.project_v2_finish_command(v_actor, p_workspace_id,
    'save', p_idempotency_key, v_result);
end;
$$;

create or replace function app_private.withdraw_project_v2_material_demand_v1(
  p_plan_id uuid, p_actor uuid, p_reason text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_document public.procurement_source_documents%rowtype;
  v_demand public.procurement_demands%rowtype;
  v_has_downstream boolean;
begin
  select * into v_document from public.procurement_source_documents d
    where d.source_adapter = 'material_plan' and d.source_document_id = p_plan_id::text
    for update;
  if v_document.id is null then return true; end if;
  select * into v_demand from public.procurement_demands d
    where d.source_document_id = v_document.id for update;
  if v_demand.id is null then return true; end if;
  select exists (select 1 from public.procurement_demand_lines dl
    where dl.demand_id = v_demand.id and (
      exists (select 1 from public.procurement_supply_allocations a
        where a.demand_line_id = dl.id and a.state not in ('released', 'cancelled'))
      or exists (select 1 from public.procurement_fulfillment_attributions f
        where f.demand_line_id = dl.id))) into v_has_downstream;
  if v_has_downstream then
    if not exists (select 1 from public.procurement_reconciliation_issues i
      where i.owner_context_id = v_demand.owner_context_id
        and i.source_adapter = 'material_plan' and i.source_document_ref = p_plan_id::text
        and i.issue_code = 'MATERIAL_PLAN_CANCELLATION_WITH_DOWNSTREAM'
        and i.status = 'open') then
      insert into public.procurement_reconciliation_issues(owner_context_id, source_adapter,
        source_document_ref, issue_code, severity, details)
      values (v_demand.owner_context_id, 'material_plan', p_plan_id::text,
        'MATERIAL_PLAN_CANCELLATION_WITH_DOWNSTREAM', 'blocking',
        jsonb_build_object('reason', p_reason));
    end if;
    update public.procurement_demands set intake_state = 'source_changed',
      health_state = 'reconciliation_required', version = version + 1,
      updated_by = p_actor, updated_at = now() where id = v_demand.id returning * into v_demand;
    update public.procurement_demand_lines set intake_state = 'source_changed',
      health_state = 'reconciliation_required', version = version + 1, updated_at = now()
      where demand_id = v_demand.id;
  else
    update public.procurement_demands set intake_state = 'withdrawn',
      health_state = 'healthy', version = version + 1,
      updated_by = p_actor, updated_at = now() where id = v_demand.id returning * into v_demand;
    update public.procurement_demand_lines set intake_state = 'withdrawn',
      health_state = 'healthy', version = version + 1, updated_at = now()
      where demand_id = v_demand.id;
    update public.procurement_source_documents set archived_at = now(), updated_at = now()
      where id = v_document.id;
  end if;
  insert into app_private.procurement_events_outbox(owner_context_id, aggregate_type,
    aggregate_id, aggregate_version, event_type, payload, actor_user_id)
  values (v_demand.owner_context_id, 'procurement_demand', v_demand.id, v_demand.version,
    case when v_has_downstream then 'procurement.demand.cancellation_reconciliation_required'
      else 'procurement.demand.withdrawn' end,
    jsonb_build_object('demandId', v_demand.id, 'planId', p_plan_id,
      'reason', p_reason, 'intakeState', v_demand.intake_state), p_actor);
  return not v_has_downstream;
end;
$$;
revoke all on function app_private.withdraw_project_v2_material_demand_v1(uuid, uuid, text)
  from public, anon, authenticated;

-- The existing revisioned transition remains the approval boundary.
create or replace function app_private.project_v2_transition(
  p_operation text, p_plan_id uuid, p_expected_version bigint,
  p_idempotency_key text, p_reason text default null, p_body text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_workspace public.project_v2_workspaces%rowtype;
  v_plan public.project_v2_plans%rowtype;
  v_source_id uuid;
  v_existing jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_snapshot jsonb;
  v_hash text;
  v_event text;
  v_action text;
  v_old_line public.project_v2_plan_lines%rowtype;
  v_new_line_id uuid;
begin
  if p_operation not in ('submit', 'return', 'approve', 'revise', 'cancel', 'delete_draft', 'comment')
    or p_plan_id is null then
    raise exception using errcode = '22023', message = 'PROJECT_V2_COMMAND_INVALID';
  end if;
  select w.* into v_workspace from public.project_v2_workspaces w
    join public.project_v2_plans p on p.workspace_id = w.id
    where p.id = p_plan_id and w.lifecycle <> 'archived' for update of w;
  if v_workspace.id is null then
    raise exception using errcode = '42501', message = 'PROJECT_V2_COMMAND_DENIED';
  end if;
  select * into v_plan from public.project_v2_plans p
    where p.id = p_plan_id and p.workspace_id = v_workspace.id for update of p;
  v_action := case p_operation
    when 'revise' then 'edit_all' when 'cancel' then 'manage'
    when 'delete_draft' then 'delete_all' when 'comment' then 'view'
    else p_operation end;
  perform app_private.project_v2_assert_permission(v_workspace, v_plan.plan_type, v_action, v_actor);
  if p_operation in ('return', 'cancel') and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'PROJECT_V2_REASON_REQUIRED';
  end if;
  if p_operation = 'comment' and nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception using errcode = '22023', message = 'PROJECT_V2_COMMENT_REQUIRED';
  end if;

  -- The workspace lock serializes all V2 writes for this project. Source rows
  -- are still locked in deterministic order for explicit capacity protection.
  for v_source_id in
    select distinct s.source_plan_id as id from public.project_v2_plan_line_sources s
    join public.project_v2_plan_lines l on l.id = s.target_line_id
    where l.plan_id = p_plan_id and l.revision_no = v_plan.revision_no
      and s.source_plan_id is not null order by id
  loop
    perform 1 from public.project_v2_plans p where p.id = v_source_id for update of p;
  end loop;
  for v_source_id in
    select distinct s.source_plan_line_id as id from public.project_v2_plan_line_sources s
    join public.project_v2_plan_lines l on l.id = s.target_line_id
    where l.plan_id = p_plan_id and l.revision_no = v_plan.revision_no
      and s.source_plan_line_id is not null order by id
  loop
    perform 1 from public.project_v2_plan_lines l where l.id = v_source_id for update of l;
  end loop;
  perform 1 from public.project_v2_plan_lines l where l.plan_id = p_plan_id
    and l.revision_no = v_plan.revision_no order by l.id for update;

  v_payload := jsonb_build_object('planId', p_plan_id, 'expectedVersion', p_expected_version,
    'reason', p_reason, 'body', p_body);
  v_existing := app_private.project_v2_begin_command(v_actor, v_workspace.id,
    p_operation, p_idempotency_key, v_payload);
  if v_existing is not null then return v_existing; end if;
  if p_expected_version is null or p_expected_version <> v_plan.version then
    raise exception using errcode = '40001', message = 'PROJECT_V2_VERSION_STALE';
  end if;

  if p_operation = 'submit' then
    if v_plan.status not in ('draft', 'returned') then
      raise exception using errcode = '23514', message = 'PROJECT_V2_INVALID_TRANSITION';
    end if;
    if not exists (select 1 from public.project_v2_plan_lines l
      where l.plan_id = p_plan_id and l.revision_no = v_plan.revision_no) then
      raise exception using errcode = '22023', message = 'PROJECT_V2_LINES_REQUIRED';
    end if;
    if exists (select 1 from public.project_v2_plan_lines l
      where l.plan_id = p_plan_id and l.revision_no = v_plan.revision_no
        and (l.quantity is null or l.unit is null or btrim(l.unit) = ''
          or (v_plan.plan_type = 'month' and l.contract_item_id is null)
          or (v_plan.plan_type = 'construction' and (l.work_item_id is null
            or l.work_start is null or l.work_end is null))
          or (v_plan.plan_type = 'material' and (l.inventory_item_id is null
            or l.needed_date is null or l.destination_id is null)))) then
      raise exception using errcode = '22023', message = 'PROJECT_V2_PLAN_INCOMPLETE';
    end if;
    perform app_private.project_v2_validate_sources(p_plan_id, v_plan.revision_no, v_plan.plan_type);
    select jsonb_build_object('plan', to_jsonb(v_plan),
      'lines', coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order, l.id), '[]'::jsonb))
      into v_snapshot from public.project_v2_plan_lines l
      where l.plan_id = p_plan_id and l.revision_no = v_plan.revision_no;
    v_hash := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');
    update public.project_v2_plans set status = 'pending_approval',
      submitter_user_id = v_actor, content_hash = v_hash, version = version + 1,
      updated_at = now() where id = p_plan_id returning * into v_plan;
    v_event := 'submitted';
  elsif p_operation = 'return' then
    if v_plan.status <> 'pending_approval' or v_actor in (v_plan.creator_user_id, v_plan.submitter_user_id) then
      raise exception using errcode = '23514', message = 'PROJECT_V2_INVALID_TRANSITION';
    end if;
    update public.project_v2_plans set status = 'returned', version = version + 1,
      updated_at = now() where id = p_plan_id returning * into v_plan;
    v_event := 'returned';
  elsif p_operation = 'approve' then
    if v_plan.status <> 'pending_approval' then
      raise exception using errcode = '23514', message = 'PROJECT_V2_INVALID_TRANSITION';
    end if;
    if v_actor = v_plan.creator_user_id or v_actor = v_plan.submitter_user_id then
      raise exception using errcode = '42501', message = 'PROJECT_V2_SELF_APPROVAL_DENIED';
    end if;
    if v_plan.effective_revision_no is not null and exists (
      select 1 from public.project_v2_plan_line_sources s
      join public.project_v2_plan_lines target on target.id = s.target_line_id
      join public.project_v2_plans consumer on consumer.id = target.plan_id
      where s.source_plan_id = p_plan_id
        and s.source_plan_revision_no = v_plan.effective_revision_no
        and consumer.status in ('pending_approval', 'approved')
    ) then
      raise exception using errcode = '23514', message = 'PROJECT_V2_DOWNSTREAM_RECONCILIATION_REQUIRED';
    end if;
    perform app_private.project_v2_validate_sources(p_plan_id, v_plan.revision_no, v_plan.plan_type);
    select jsonb_build_object('plan', to_jsonb(v_plan),
      'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order, l.id)
        from public.project_v2_plan_lines l where l.plan_id = p_plan_id
          and l.revision_no = v_plan.revision_no), '[]'::jsonb),
      'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.id)
        from public.project_v2_plan_line_sources s
        join public.project_v2_plan_lines l on l.id = s.target_line_id
        where l.plan_id = p_plan_id and l.revision_no = v_plan.revision_no), '[]'::jsonb))
      into v_snapshot;
    v_hash := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');
    insert into public.project_v2_plan_revisions(plan_id, revision_no,
      predecessor_revision_no, content_hash, approved_snapshot, approved_by)
    values (p_plan_id, v_plan.revision_no, v_plan.predecessor_revision_no,
      v_hash, v_snapshot, v_actor);
    update public.project_v2_plans set status = 'approved', approver_user_id = v_actor,
      approved_at = now(), content_hash = v_hash,
      effective_revision_no = revision_no, version = version + 1,
      updated_at = now() where id = p_plan_id returning * into v_plan;
    if v_plan.plan_type = 'material' then
      perform app_private.sync_material_plan_demand_v1(p_plan_id, v_plan.revision_no,
        'project-v2-approve:' || p_plan_id::text || ':' || v_plan.revision_no::text);
    end if;
    v_event := 'approved';
  elsif p_operation = 'revise' then
    if v_plan.status <> 'approved' then
      raise exception using errcode = '23514', message = 'PROJECT_V2_INVALID_TRANSITION';
    end if;
    update public.project_v2_plans set status = 'draft',
      predecessor_revision_no = revision_no, revision_no = revision_no + 1,
      creator_user_id = v_actor, submitter_user_id = null, approver_user_id = null,
      approved_at = null, content_hash = null, version = version + 1,
      updated_at = now() where id = p_plan_id returning * into v_plan;
    -- New target IDs leave approved rows immutable; their exact approved
    -- source revision, line, hash, and norm identities are copied unchanged.
    for v_old_line in select * from public.project_v2_plan_lines l
      where l.plan_id = p_plan_id and l.revision_no = v_plan.predecessor_revision_no
      order by l.sort_order, l.id
    loop
      insert into public.project_v2_plan_lines(plan_id, revision_no, plan_type, sort_order,
        contract_item_id, baseline_revision, work_item_id, inventory_item_id,
        unit, quantity, unit_price_snapshot, currency, work_start, work_end,
        crew_id, needed_date, destination_id, baseline_exception_reason, note,
        source_identity_id, calculated_quantity, override_reason)
      values (p_plan_id, v_plan.revision_no, v_old_line.plan_type, v_old_line.sort_order,
        v_old_line.contract_item_id, v_old_line.baseline_revision, v_old_line.work_item_id,
        v_old_line.inventory_item_id, v_old_line.unit, v_old_line.quantity,
        v_old_line.unit_price_snapshot, v_old_line.currency, v_old_line.work_start,
        v_old_line.work_end, v_old_line.crew_id, v_old_line.needed_date,
        v_old_line.destination_id, v_old_line.baseline_exception_reason, v_old_line.note,
        v_old_line.source_identity_id, v_old_line.calculated_quantity, v_old_line.override_reason)
      returning id into v_new_line_id;
      insert into public.project_v2_plan_line_sources(target_line_id, source_plan_id,
        source_plan_revision_no, source_plan_line_id, source_plan_hash,
        source_work_quantity, source_unit, norm_resource_id, norm_revision,
        norm_factor, coefficient, conversion_numerator, conversion_denominator,
        derived_quantity, allocated_quantity)
      select v_new_line_id, s.source_plan_id, s.source_plan_revision_no,
        s.source_plan_line_id, s.source_plan_hash, s.source_work_quantity,
        s.source_unit, s.norm_resource_id, s.norm_revision, s.norm_factor,
        s.coefficient, s.conversion_numerator, s.conversion_denominator,
        s.derived_quantity, s.allocated_quantity
      from public.project_v2_plan_line_sources s where s.target_line_id = v_old_line.id;
    end loop;
    v_event := 'revision_created';
  elsif p_operation = 'cancel' then
    if v_plan.status not in ('draft', 'returned', 'approved') then
      raise exception using errcode = '23514', message = 'PROJECT_V2_INVALID_TRANSITION';
    end if;
    if v_plan.plan_type = 'material' and v_plan.status = 'approved' then
      if not app_private.withdraw_project_v2_material_demand_v1(p_plan_id, v_actor, p_reason) then
        update public.project_v2_plans set version = version + 1, updated_at = now()
          where id = p_plan_id returning * into v_plan;
        v_event := 'cancellation_reconciliation_requested';
      end if;
    end if;
    if v_plan.status = 'approved' and exists (
      select 1 from public.project_v2_plan_line_sources s
      join public.project_v2_plan_lines target on target.id = s.target_line_id
      join public.project_v2_plans consumer on consumer.id = target.plan_id
      where s.source_plan_id = p_plan_id
        and s.source_plan_revision_no = v_plan.effective_revision_no
        and consumer.status in ('pending_approval', 'approved')
    ) then
      raise exception using errcode = '23514', message = 'PROJECT_V2_DOWNSTREAM_RECONCILIATION_REQUIRED';
    end if;
    if v_event is distinct from 'cancellation_reconciliation_requested' then
      update public.project_v2_plans set status = 'cancelled', version = version + 1,
        updated_at = now() where id = p_plan_id returning * into v_plan;
      v_event := 'cancelled';
    end if;
  elsif p_operation = 'delete_draft' then
    if v_plan.status not in ('draft', 'returned') or v_plan.effective_revision_no is not null then
      raise exception using errcode = '23514', message = 'PROJECT_V2_INVALID_TRANSITION';
    end if;
    update public.project_v2_plans set status = 'cancelled', version = version + 1,
      updated_at = now() where id = p_plan_id returning * into v_plan;
    v_event := 'draft_deleted';
  else
    insert into public.project_v2_plan_comments(plan_id, revision_no, author_user_id, body)
    values (p_plan_id, v_plan.revision_no, v_actor, btrim(p_body));
    update public.project_v2_plans set version = version + 1, updated_at = now()
      where id = p_plan_id returning * into v_plan;
    v_event := 'comment_added';
  end if;
  v_result := jsonb_build_object('planId', p_plan_id, 'version', v_plan.version,
    'revision', v_plan.revision_no, 'status', v_plan.status, 'outcome', 'committed');
  insert into public.project_v2_plan_events(plan_id, revision_no, event_type,
    actor_user_id, reason, payload, command_id)
  select p_plan_id, v_plan.revision_no, v_event, v_actor, nullif(btrim(p_reason), ''),
    jsonb_build_object('version', v_plan.version), c.id
    from app_private.project_v2_commands c where c.actor_user_id = v_actor
      and c.workspace_id = v_workspace.id and c.operation = p_operation
      and c.idempotency_key = p_idempotency_key;
  return app_private.project_v2_finish_command(v_actor, v_workspace.id,
    p_operation, p_idempotency_key, v_result);
end;
$$;

-- Buyer disposition for a changed material-plan source uses the same canonical
-- demand identity and never fabricates a project material request.
create or replace function app_private.resolve_material_plan_source_change_v1(
  p_demand_id uuid, p_expected_version bigint, p_disposition text,
  p_reason text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_demand public.procurement_demands%rowtype;
  v_document public.procurement_source_documents%rowtype;
  v_plan public.project_v2_plans%rowtype;
  v_revision public.procurement_source_revisions%rowtype;
  v_line record;
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
  select * into v_demand from public.procurement_demands d
    where d.id = p_demand_id for update;
  if v_demand.id is null then
    raise exception using errcode = 'P0002', message = 'PROCUREMENT_DEMAND_NOT_FOUND';
  end if;
  perform app_private.procurement_assert_intake_access(v_actor,
    v_demand.project_id, v_demand.construction_site_id);
  select * into strict v_document from public.procurement_source_documents d
    where d.id = v_demand.source_document_id and d.source_adapter = 'material_plan' for update;
  select * into strict v_revision from public.procurement_source_revisions r
    where r.id = v_demand.current_source_revision_id and r.source_document_id = v_document.id;
  v_hash := encode(extensions.digest(jsonb_build_object('demandId', p_demand_id,
    'expectedVersion', p_expected_version, 'disposition', p_disposition,
    'reason', btrim(p_reason))::text, 'sha256'), 'hex');
  insert into app_private.procurement_commands(owner_context_id, command_type,
    idempotency_key, actor_user_id, payload_hash)
  values (v_demand.owner_context_id, 'resolve_material_plan_source_change',
    p_idempotency_key, v_actor, v_hash)
  on conflict (owner_context_id, command_type, idempotency_key) do nothing;
  select * into strict v_command from app_private.procurement_commands c
    where c.owner_context_id = v_demand.owner_context_id
      and c.command_type = 'resolve_material_plan_source_change'
      and c.idempotency_key = p_idempotency_key for update;
  if v_command.actor_user_id is distinct from v_actor or v_command.payload_hash <> v_hash then
    raise exception using errcode = '40001', message = 'PROCUREMENT_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.result is not null then
    return v_command.result || jsonb_build_object('outcome', 'replayed');
  end if;
  if v_demand.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'PROCUREMENT_VERSION_CONFLICT';
  end if;
  if v_demand.intake_state <> 'source_changed' then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_CHANGE_NOT_OPEN';
  end if;
  if p_disposition = 'accept_current_revision' then
    select * into v_plan from public.project_v2_plans p
      where p.id::text = v_document.source_document_id for update;
    if v_plan.id is null or v_plan.status <> 'approved'
      or v_plan.effective_revision_no is distinct from v_document.current_revision
      or v_document.source_hash <> v_revision.source_hash then
      raise exception using errcode = '40001', message = 'PROJECT_V2_MATERIAL_REVISION_STALE';
    end if;
  end if;
  for v_line in select dl.id, dl.approved_qty, dr.approved_qty replacement_qty,
      app_private.project_v2_material_demand_exposure(dl.id) exposure_qty
    from public.procurement_demand_lines dl
    left join public.procurement_demand_revisions dr
      on dr.demand_line_id = dl.id and dr.source_revision_id = v_revision.id
    where dl.demand_id = v_demand.id order by dl.id loop
    if p_disposition = 'withdraw' and v_line.exposure_qty > 0
      or p_disposition = 'accept_current_revision'
        and coalesce(v_line.replacement_qty, 0) < v_line.exposure_qty then
      raise exception using errcode = '23514', message = 'PROCUREMENT_DOWNSTREAM_RECONCILIATION_REQUIRED';
    end if;
    if p_disposition = 'accept_current_revision' and v_line.replacement_qty is not null then
      update public.procurement_demand_lines set
        current_source_revision_id = v_revision.id,
        requested_qty = v_line.replacement_qty, approved_qty = v_line.replacement_qty,
        intake_state = 'ready', health_state = 'healthy',
        version = version + 1, updated_at = now() where id = v_line.id;
    else
      update public.procurement_demand_lines set intake_state = 'withdrawn',
        health_state = 'healthy', version = version + 1, updated_at = now()
        where id = v_line.id;
    end if;
  end loop;
  v_next_state := case when p_disposition = 'withdraw' then 'withdrawn' else 'ready' end;
  update public.procurement_demands set intake_state = v_next_state,
    health_state = 'healthy', version = version + 1,
    updated_by = v_actor, updated_at = now() where id = v_demand.id returning * into v_demand;
  update public.procurement_reconciliation_issues set status = 'resolved', updated_at = now()
    where owner_context_id = v_demand.owner_context_id
      and source_adapter = 'material_plan'
      and source_document_ref = v_document.source_document_id and status = 'open';
  insert into public.procurement_source_dispositions(demand_id, source_revision_id,
    disposition, reason, actor_user_id, demand_version)
  values (v_demand.id, v_revision.id, p_disposition, btrim(p_reason), v_actor, v_demand.version);
  insert into app_private.procurement_events_outbox(owner_context_id, aggregate_type,
    aggregate_id, aggregate_version, event_type, payload, actor_user_id)
  values (v_demand.owner_context_id, 'procurement_demand', v_demand.id,
    v_demand.version, 'procurement.demand.source_change_resolved',
    jsonb_build_object('demandId', v_demand.id, 'disposition', p_disposition,
      'intakeState', v_next_state), v_actor);
  v_result := jsonb_build_object('commandId', v_command.id, 'outcome', 'committed',
    'committedAt', now(), 'changedEntities', jsonb_build_array(jsonb_build_object(
      'type', 'demand', 'id', v_demand.id, 'version', v_demand.version::text)),
    'createdDocumentIds', '[]'::jsonb, 'warnings', '[]'::jsonb,
    'refreshScopes', jsonb_build_array('project:' || v_demand.project_id),
    'demandId', v_demand.id, 'demandVersion', v_demand.version,
    'intakeState', v_next_state);
  update app_private.procurement_commands set result = v_result, committed_at = now()
    where id = v_command.id;
  return v_result;
end;
$$;
revoke all on function app_private.resolve_material_plan_source_change_v1(uuid, bigint, text, text, text)
  from public, anon, authenticated;
create or replace function public.resolve_material_plan_source_change_v1(
  p_demand_id uuid, p_expected_version bigint, p_disposition text,
  p_reason text, p_idempotency_key text
) returns jsonb language sql security definer set search_path = '' as $$
  select app_private.resolve_material_plan_source_change_v1(
    p_demand_id, p_expected_version, p_disposition, p_reason, p_idempotency_key);
$$;
revoke all on function public.resolve_material_plan_source_change_v1(uuid, bigint, text, text, text)
  from public, anon;
grant execute on function public.resolve_material_plan_source_change_v1(uuid, bigint, text, text, text)
  to authenticated, service_role;

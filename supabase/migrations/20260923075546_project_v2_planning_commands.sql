-- Project V2 commands own all writes. No client receives table DML privileges.
-- The existing V2 tables are isolated; this migration does not enroll projects.

create or replace function app_private.project_v2_assert_permission(
  p_workspace public.project_v2_workspaces, p_plan_type text, p_action text, p_actor uuid
) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or p_workspace.id is null or p_workspace.lifecycle = 'archived'
    or not app_private.project_has_permission_v2(p_workspace.project_id,
      p_workspace.primary_construction_site_id::text,
      'project.v2_' || p_plan_type || '_plan.' || p_action, p_actor) then
    raise exception using errcode = '42501', message = 'PROJECT_V2_COMMAND_DENIED';
  end if;
end;
$$;

revoke all on function app_private.project_v2_assert_permission(public.project_v2_workspaces, text, text, uuid)
  from public, anon, authenticated;

-- Reservation check runs only after source plans and lines are locked in ID order.
-- A pending submission reserves capacity; an approved plan consumes it. The
-- predecessor remains approved until its replacement is approved atomically.
create or replace function app_private.project_v2_validate_sources(
  p_plan_id uuid, p_revision_no integer, p_plan_type text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_source record;
  v_reserved numeric(20,6);
  v_available numeric(20,6);
  v_line_total numeric(20,6);
begin
  if p_plan_type = 'month' then return; end if;
  for v_source in
    select s.source_plan_id, s.source_plan_revision_no, s.source_plan_line_id,
      s.source_plan_hash, s.source_unit, sum(s.source_work_quantity) as requested
    from public.project_v2_plan_line_sources s
    join public.project_v2_plan_lines target on target.id = s.target_line_id
    where target.plan_id = p_plan_id and target.revision_no = p_revision_no
    group by s.source_plan_id, s.source_plan_revision_no, s.source_plan_line_id,
      s.source_plan_hash, s.source_unit
    order by s.source_plan_id, s.source_plan_line_id
  loop
    if v_source.source_plan_id is null or v_source.source_plan_line_id is null
      or v_source.requested is null then
      raise exception using errcode = '22023', message = 'PROJECT_V2_SOURCE_INCOMPLETE';
    end if;
    if not exists (
      select 1 from public.project_v2_plan_revisions r
      join public.project_v2_plans p on p.id = r.plan_id
      join public.project_v2_plan_lines l on l.id = v_source.source_plan_line_id
      where r.plan_id = v_source.source_plan_id and r.revision_no = v_source.source_plan_revision_no
        and r.content_hash = v_source.source_plan_hash
        and l.plan_id = r.plan_id and l.revision_no = r.revision_no
        and p.plan_type = case when p_plan_type = 'construction' then 'month' else 'construction' end
        and p.effective_revision_no = r.revision_no
        and l.unit = v_source.source_unit
    ) then
      raise exception using errcode = '40001', message = 'PROJECT_V2_SOURCE_HASH_STALE';
    end if;
    select l.quantity into v_available from public.project_v2_plan_lines l
      where l.id = v_source.source_plan_line_id;
    if v_available is null then
      raise exception using errcode = '22023', message = 'PROJECT_V2_SOURCE_QUANTITY_UNKNOWN';
    end if;
    if p_plan_type in ('construction', 'material') then
      select coalesce(sum(s.source_work_quantity), 0) into v_reserved
      from public.project_v2_plan_line_sources s
      join public.project_v2_plan_lines target on target.id = s.target_line_id
      join public.project_v2_plans consumer on consumer.id = target.plan_id
      where s.source_plan_id = v_source.source_plan_id
        and s.source_plan_revision_no = v_source.source_plan_revision_no
        and s.source_plan_line_id = v_source.source_plan_line_id
        and ((consumer.status = 'pending_approval' and target.revision_no = consumer.revision_no)
          or target.revision_no = consumer.effective_revision_no)
        and consumer.status <> 'cancelled'
        and consumer.id <> p_plan_id;
      if v_reserved + v_source.requested > v_available then
        raise exception using errcode = '23514', message = 'PROJECT_V2_SOURCE_QUANTITY_EXCEEDED',
          detail = jsonb_build_object('sourceLineId', v_source.source_plan_line_id,
            'availableQuantity', greatest(v_available - v_reserved, 0))::text;
      end if;
    end if;
  end loop;

  if p_plan_type = 'material' and exists (
    select 1 from public.project_v2_plan_line_sources s
    join public.project_v2_plan_lines l on l.id = s.target_line_id
    where l.plan_id = p_plan_id and l.revision_no = p_revision_no
      and (s.norm_resource_id is null or s.norm_revision is null
        or s.norm_factor is null or s.coefficient is null
        or s.conversion_numerator is null or s.conversion_denominator is null
        or s.derived_quantity is null or s.source_work_quantity is null
        or round(s.source_work_quantity * s.norm_factor * s.coefficient
          * s.conversion_numerator / nullif(s.conversion_denominator, 0), 6)
          is distinct from s.derived_quantity)
  ) then
    raise exception using errcode = '22023', message = 'PROJECT_V2_DERIVATION_INVALID';
  end if;

  -- The selected sources must explain each target line exactly. For material,
  -- derived quantity belongs to the exact norm/resource source, not the SKU.
  for v_source in
    select l.id, l.quantity, coalesce(sum(case when p_plan_type = 'material'
      then s.derived_quantity else s.source_work_quantity end), 0) as total
    from public.project_v2_plan_lines l
    left join public.project_v2_plan_line_sources s on s.target_line_id = l.id
    where l.plan_id = p_plan_id and l.revision_no = p_revision_no
    group by l.id, l.quantity
  loop
    if v_source.quantity is null or v_source.quantity <> v_source.total then
      raise exception using errcode = '22023', message = 'PROJECT_V2_SOURCE_TOTAL_MISMATCH';
    end if;
  end loop;
end;
$$;
revoke all on function app_private.project_v2_validate_sources(uuid, integer, text) from public, anon, authenticated;

create or replace function app_private.project_v2_begin_command(
  p_actor uuid, p_workspace_id uuid, p_operation text, p_key text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_command app_private.project_v2_commands%rowtype;
begin
  if nullif(btrim(p_key), '') is null or length(p_key) > 200 then
    raise exception using errcode = '22023', message = 'PROJECT_V2_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  insert into app_private.project_v2_commands(actor_user_id, workspace_id, operation,
    idempotency_key, payload_hash)
  values (p_actor, p_workspace_id, p_operation, p_key, md5(p_payload::text))
  on conflict (actor_user_id, workspace_id, operation, idempotency_key) do nothing;
  select * into v_command from app_private.project_v2_commands
    where actor_user_id = p_actor and workspace_id = p_workspace_id
      and operation = p_operation and idempotency_key = p_key for update;
  if v_command.payload_hash <> md5(p_payload::text) then
    raise exception using errcode = '23505', message = 'PROJECT_V2_IDEMPOTENCY_CONFLICT';
  end if;
  return v_command.result;
end;
$$;
revoke all on function app_private.project_v2_begin_command(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

create or replace function app_private.project_v2_finish_command(
  p_actor uuid, p_workspace_id uuid, p_operation text, p_key text, p_result jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update app_private.project_v2_commands set result = p_result
    where actor_user_id = p_actor and workspace_id = p_workspace_id
      and operation = p_operation and idempotency_key = p_key;
  return p_result;
end;
$$;
revoke all on function app_private.project_v2_finish_command(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

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
    v_line_id := coalesce((v_line ->> 'id')::uuid, gen_random_uuid());
    insert into public.project_v2_plan_lines(id, plan_id, revision_no, plan_type,
      sort_order, contract_item_id, baseline_revision, work_item_id,
      inventory_item_id, unit, quantity, unit_price_snapshot, currency,
      work_start, work_end, crew_id, needed_date, destination_id, note)
    values (v_line_id, v_plan.id, v_plan.revision_no, p_plan_type,
      v_order, (v_line ->> 'contractItemId')::uuid, v_line ->> 'baselineRevision',
      v_line ->> 'workItemId', v_line ->> 'itemId', v_line ->> 'unit',
      v_quantity_text::numeric(20,6), (v_line ->> 'unitPriceSnapshot')::numeric(20,6),
      v_line ->> 'currency', (v_line ->> 'workStart')::date,
      (v_line ->> 'workEnd')::date, (v_line ->> 'crewId')::uuid,
      (v_line ->> 'neededDate')::date, v_line ->> 'destinationId', v_line ->> 'note');

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
        norm_factor, coefficient, conversion_numerator, conversion_denominator, derived_quantity)
      values (v_line_id, v_source_plan.id, (v_source ->> 'sourceRevision')::integer,
        (v_source ->> 'sourceLineId')::uuid, v_source_hash, v_quantity_text::numeric(20,6),
        v_source_line.unit,
        v_source ->> 'normResourceId', v_source ->> 'normRevision',
        (v_source ->> 'normFactor')::numeric(20,6),
        (v_source ->> 'coefficient')::numeric(20,6),
        (v_source ->> 'conversionNumerator')::numeric(20,6),
        (v_source ->> 'conversionDenominator')::numeric(20,6),
        (v_source ->> 'derivedQuantity')::numeric(20,6));
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

-- The effective revision stays approved while a successor is being drafted.
alter table public.project_v2_plans add column effective_revision_no integer;
update public.project_v2_plans set effective_revision_no = revision_no where status = 'approved';

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
        crew_id, needed_date, destination_id, baseline_exception_reason, note)
      values (p_plan_id, v_plan.revision_no, v_old_line.plan_type, v_old_line.sort_order,
        v_old_line.contract_item_id, v_old_line.baseline_revision, v_old_line.work_item_id,
        v_old_line.inventory_item_id, v_old_line.unit, v_old_line.quantity,
        v_old_line.unit_price_snapshot, v_old_line.currency, v_old_line.work_start,
        v_old_line.work_end, v_old_line.crew_id, v_old_line.needed_date,
        v_old_line.destination_id, v_old_line.baseline_exception_reason, v_old_line.note)
      returning id into v_new_line_id;
      insert into public.project_v2_plan_line_sources(target_line_id, source_plan_id,
        source_plan_revision_no, source_plan_line_id, source_plan_hash,
        source_work_quantity, source_unit, norm_resource_id, norm_revision,
        norm_factor, coefficient, conversion_numerator, conversion_denominator,
        derived_quantity)
      select v_new_line_id, s.source_plan_id, s.source_plan_revision_no,
        s.source_plan_line_id, s.source_plan_hash, s.source_work_quantity,
        s.source_unit, s.norm_resource_id, s.norm_revision, s.norm_factor,
        s.coefficient, s.conversion_numerator, s.conversion_denominator,
        s.derived_quantity
      from public.project_v2_plan_line_sources s where s.target_line_id = v_old_line.id;
    end loop;
    v_event := 'revision_created';
  elsif p_operation = 'cancel' then
    if v_plan.status not in ('draft', 'returned', 'approved') then
      raise exception using errcode = '23514', message = 'PROJECT_V2_INVALID_TRANSITION';
    end if;
    if v_plan.plan_type = 'material' and v_plan.status = 'approved' then
      -- Before the V2 adapter publishes a source document there can be no
      -- downstream demand. A published document requires the later Task 7
      -- withdrawal/reconciliation command, so this path fails closed.
      if to_regclass('public.procurement_source_documents') is null then
        raise exception using errcode = '23514', message = 'PROJECT_V2_DOWNSTREAM_RECONCILIATION_REQUIRED';
      end if;
      if exists (select 1 from public.procurement_source_documents d
        where d.source_adapter = 'material_plan' and d.source_document_id = p_plan_id::text) then
        raise exception using errcode = '23514', message = 'PROJECT_V2_DOWNSTREAM_RECONCILIATION_REQUIRED';
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
    update public.project_v2_plans set status = 'cancelled', version = version + 1,
      updated_at = now() where id = p_plan_id returning * into v_plan;
    v_event := 'cancelled';
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
revoke all on function app_private.project_v2_transition(text, uuid, bigint, text, text, text)
  from public, anon, authenticated;

create or replace function public.submit_project_v2_plan_v1(
  p_plan_id uuid, p_expected_version bigint, p_idempotency_key text, p_reason text
) returns jsonb language sql security definer set search_path = '' as $$
  select app_private.project_v2_transition('submit', p_plan_id, p_expected_version,
    p_idempotency_key, p_reason, null);
$$;
create or replace function public.return_project_v2_plan_v1(
  p_plan_id uuid, p_expected_version bigint, p_idempotency_key text, p_reason text
) returns jsonb language sql security definer set search_path = '' as $$
  select app_private.project_v2_transition('return', p_plan_id, p_expected_version,
    p_idempotency_key, p_reason, null);
$$;
create or replace function public.approve_project_v2_plan_v1(
  p_plan_id uuid, p_expected_version bigint, p_idempotency_key text
) returns jsonb language sql security definer set search_path = '' as $$
  select app_private.project_v2_transition('approve', p_plan_id, p_expected_version,
    p_idempotency_key, null, null);
$$;
create or replace function public.create_project_v2_plan_revision_v1(
  p_plan_id uuid, p_expected_version bigint, p_idempotency_key text
) returns jsonb language sql security definer set search_path = '' as $$
  select app_private.project_v2_transition('revise', p_plan_id, p_expected_version,
    p_idempotency_key, null, null);
$$;
create or replace function public.cancel_project_v2_plan_v1(
  p_plan_id uuid, p_expected_version bigint, p_idempotency_key text, p_reason text
) returns jsonb language sql security definer set search_path = '' as $$
  select app_private.project_v2_transition('cancel', p_plan_id, p_expected_version,
    p_idempotency_key, p_reason, null);
$$;
create or replace function public.delete_project_v2_plan_draft_v1(
  p_plan_id uuid, p_expected_version bigint, p_idempotency_key text
) returns jsonb language sql security definer set search_path = '' as $$
  select app_private.project_v2_transition('delete_draft', p_plan_id, p_expected_version,
    p_idempotency_key, null, null);
$$;
create or replace function public.add_project_v2_plan_comment_v1(
  p_plan_id uuid, p_expected_version bigint, p_idempotency_key text, p_body text
) returns jsonb language sql security definer set search_path = '' as $$
  select app_private.project_v2_transition('comment', p_plan_id, p_expected_version,
    p_idempotency_key, null, p_body);
$$;

create or replace function public.list_project_v2_source_candidates_v1(
  p_workspace_id uuid, p_target_type text
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_workspace public.project_v2_workspaces%rowtype;
  v_items jsonb;
begin
  select * into v_workspace from public.project_v2_workspaces
    where id = p_workspace_id and lifecycle <> 'archived';
  if p_target_type not in ('month', 'construction', 'material') then
    raise exception using errcode = '22023', message = 'PROJECT_V2_INVALID_SOURCE_TARGET';
  end if;
  perform app_private.project_v2_assert_permission(v_workspace, p_target_type, 'view', v_actor);
  if p_target_type = 'month' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'contractItemId', i.id, 'code', i.code, 'name', i.name, 'unit', i.unit,
      'quantity', coalesce(i.revised_quantity, i.quantity),
      'baselineRevision', null, 'baselineState', 'unverified') order by i.code, i.id), '[]'::jsonb)
    into v_items from public.contract_items i
    where i.project_id = v_workspace.project_id and i.contract_type = 'customer';
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'sourcePlanId', p.id, 'sourceRevision', r.revision_no,
      'sourcePlanHash', r.content_hash, 'sourceLineId', l.id,
      'sourceQuantity', l.quantity, 'sourceUnit', l.unit,
      'code', p.code, 'title', p.title) order by p.code, l.sort_order, l.id), '[]'::jsonb)
    into v_items from public.project_v2_plans p
    join public.project_v2_plan_revisions r on r.plan_id = p.id
      and r.revision_no = p.effective_revision_no
    join public.project_v2_plan_lines l on l.plan_id = p.id and l.revision_no = r.revision_no
    where p.workspace_id = p_workspace_id and p.plan_type = case
      when p_target_type = 'construction' then 'month' else 'construction' end
      and p.status <> 'cancelled';
  end if;
  return jsonb_build_object('asOf', now(), 'items', v_items);
end;
$$;

revoke all on function public.save_project_v2_plan_v1(uuid, uuid, bigint, text, text, text, text, date, date, jsonb)
  from public, anon, authenticated;
revoke all on function public.submit_project_v2_plan_v1(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.return_project_v2_plan_v1(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.approve_project_v2_plan_v1(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.create_project_v2_plan_revision_v1(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.cancel_project_v2_plan_v1(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.delete_project_v2_plan_draft_v1(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.add_project_v2_plan_comment_v1(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.list_project_v2_source_candidates_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.save_project_v2_plan_v1(uuid, uuid, bigint, text, text, text, text, date, date, jsonb) to authenticated;
grant execute on function public.submit_project_v2_plan_v1(uuid, bigint, text, text) to authenticated;
grant execute on function public.return_project_v2_plan_v1(uuid, bigint, text, text) to authenticated;
grant execute on function public.approve_project_v2_plan_v1(uuid, bigint, text) to authenticated;
grant execute on function public.create_project_v2_plan_revision_v1(uuid, bigint, text) to authenticated;
grant execute on function public.cancel_project_v2_plan_v1(uuid, bigint, text, text) to authenticated;
grant execute on function public.delete_project_v2_plan_draft_v1(uuid, bigint, text) to authenticated;
grant execute on function public.add_project_v2_plan_comment_v1(uuid, bigint, text, text) to authenticated;
grant execute on function public.list_project_v2_source_candidates_v1(uuid, text) to authenticated;

-- V2 room catalog mirrors the TypeScript registry. No member or project is
-- granted access by this seed; pilot membership remains an explicit action.
alter table public.project_permission_rooms drop constraint project_permission_rooms_allowed_actions_check;
alter table public.project_permission_rooms add constraint project_permission_rooms_allowed_actions_check
  check (allowed_actions <@ array['view','edit','delete','submit','return','verify',
    'confirm','approve','view_available_stock']::text[]);
alter table public.project_permission_room_member_actions
  drop constraint project_permission_room_member_actions_code_check;
alter table public.project_permission_room_member_actions
  add constraint project_permission_room_member_actions_code_check
  check (action_code = any(array['view','edit','delete','submit','return',
    'verify','confirm','approve','view_available_stock']::text[]));

insert into public.project_permission_rooms(code, group_code, name, description,
  allowed_actions, required_actions, sort_order)
values
  ('v2_month_plan','planning','Kế hoạch tháng V2','Lập và duyệt khối lượng tháng.',
    array['view','edit','delete','submit','return','approve'], '{}'::text[],11),
  ('v2_construction_plan','planning','Kế hoạch thi công V2','Lập và duyệt công việc thi công.',
    array['view','edit','delete','submit','return','approve'], '{}'::text[],12),
  ('v2_material_plan','planning','Kế hoạch vật tư V2','Lập và duyệt nhu cầu vật tư từ thi công.',
    array['view','edit','delete','submit','return','approve'], '{}'::text[],13)
on conflict (code) do update set name = excluded.name, description = excluded.description,
  allowed_actions = excluded.allowed_actions, required_actions = excluded.required_actions,
  sort_order = excluded.sort_order, is_active = true, updated_at = now();

insert into public.permission_modules(application_code, code, name, routes,
  legacy_module_key, sort_order, is_active)
values
  ('project','project.v2_month_plan','Kế hoạch tháng V2',array['/project-v2']::text[],null,41,true),
  ('project','project.v2_construction_plan','Kế hoạch thi công V2',array['/project-v2']::text[],null,42,true),
  ('project','project.v2_material_plan','Kế hoạch vật tư V2',array['/project-v2']::text[],null,43,true)
on conflict (code) do update set name = excluded.name, routes = excluded.routes,
  legacy_module_key = null, is_active = true, updated_at = now();

insert into public.permission_actions(module_code, action, permission_code, label,
  scope_modes, legacy_module_key, legacy_route, legacy_admin_only, sort_order,
  is_active, risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code)
select 'project.v2_' || plan_type || '_plan', action,
  'project.v2_' || plan_type || '_plan.' || action, label,
  array['global','project','construction_site']::text[], null, null, false,
  sort_order, true, case when action = 'approve' then 'sensitive' else 'important' end,
  action <> 'view', action = 'approve', action = 'approve', 'enforced', 'project'
from (values ('month'),('construction'),('material')) plans(plan_type)
cross join (values
  ('view','Xem',10),('create','Tạo',20),('edit_own','Sửa của mình',30),
  ('edit_all','Sửa tất cả',40),('delete_own','Xóa của mình',50),
  ('delete_all','Xóa tất cả',60),('submit','Gửi duyệt',70),
  ('return','Trả lại',80),('approve','Duyệt',90),('manage','Quản trị',100)
) actions(action,label,sort_order)
on conflict (permission_code) do update set module_code = excluded.module_code,
  label = excluded.label, scope_modes = excluded.scope_modes,
  is_active = true, risk_level = excluded.risk_level,
  is_business_action = excluded.is_business_action,
  is_business_approval = excluded.is_business_approval,
  grant_readiness = 'enforced', updated_at = now();

insert into app_private.project_permission_room_action_bindings(room_code,
  action_code, legacy_permission_codes, enforcement_status,
  relationship_description, pbac_fallback_enabled, prerequisite_action_codes,
  verified_source)
select 'v2_' || plan_type || '_plan', action,
  array['project.v2_' || plan_type || '_plan.' || permission_action]::text[],
  'pilot', 'Project V2 room action', false,
  case when action = 'view' then '{}'::text[] else array['view']::text[] end,
  'project_v2_planning_commands'
from (values ('month'),('construction'),('material')) plans(plan_type)
cross join (values
  ('view','view'),('edit','edit_all'),('delete','delete_all'),
  ('submit','submit'),('return','return'),('approve','approve')
) actions(action,permission_action)
on conflict (room_code, action_code) do update set
  legacy_permission_codes = excluded.legacy_permission_codes,
  enforcement_status = 'pilot', pbac_fallback_enabled = false,
  prerequisite_action_codes = excluded.prerequisite_action_codes,
  updated_at = now();

create or replace function app_private.authorization_v2_final_room_action(
  p_permission_code text
) returns table(room_code text, action_code text)
language sql immutable security definer set search_path = '' as $$
  select split_part(p_permission_code, '.', 2),
    case
      when p_permission_code ~ '^project\.v2_(month|construction|material)_plan\.' then
        case split_part(p_permission_code, '.', 3)
          when 'view' then 'view' when 'create' then 'edit'
          when 'edit_own' then 'edit' when 'edit_all' then 'edit'
          when 'delete_own' then 'delete' when 'delete_all' then 'delete'
          when 'submit' then 'submit' when 'return' then 'return'
          when 'approve' then 'approve' when 'manage' then 'edit' end
      when p_permission_code in ('project.payment.view', 'project.quantity_acceptance.view', 'project.safety.view') then 'view'
      when p_permission_code ~ '^project\.(payment\.(create|edit_own|edit_all|manage)|quantity_acceptance\.(create|manage)|safety\.(worker_manage|issue_create|issue_edit_own|issue_edit_all|training_manage|create|edit_all|manage))$' then 'edit'
      when p_permission_code ~ '^project\.(payment\.(delete_own|delete_all)|quantity_acceptance\.delete)$' then 'delete'
      when p_permission_code in ('project.payment.submit','project.quantity_acceptance.submit','project.safety.create') then 'submit'
      when p_permission_code in ('project.payment.return','project.payment.verify','project.quantity_acceptance.verify','project.safety.document_verify','project.safety.verify') then 'verify'
      when p_permission_code in ('project.payment.approve','project.quantity_acceptance.approve','project.safety.approve') then 'approve'
      when p_permission_code in ('project.payment.confirm','project.payment.mark_paid','project.safety.issue_close') then 'confirm'
    end
  where p_permission_code ~ '^project\.(payment|quantity_acceptance|safety|v2_(month|construction|material)_plan)\.';
$$;
revoke all on function app_private.authorization_v2_final_room_action(text) from public, anon, authenticated;

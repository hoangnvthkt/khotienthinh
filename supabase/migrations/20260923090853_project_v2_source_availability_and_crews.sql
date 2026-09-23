-- Source availability is computed server side from the effective approved revision.
-- Pending submissions reserve the same capacity that approvals consume.
drop function public.list_project_v2_source_candidates_v1(uuid, text);
create or replace function public.list_project_v2_source_candidates_v1(
  p_workspace_id uuid, p_target_type text, p_exclude_plan_id uuid default null
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
  if p_exclude_plan_id is not null and not exists (
    select 1 from public.project_v2_plans p where p.id = p_exclude_plan_id
      and p.workspace_id = p_workspace_id and p.plan_type = p_target_type
      and p.status in ('draft', 'returned')
  ) then raise exception using errcode = '42501', message = 'PROJECT_V2_SOURCE_EXCLUSION_DENIED'; end if;
  perform app_private.project_v2_assert_permission(v_workspace, p_target_type, 'view', v_actor);
  if p_target_type = 'month' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'contractItemId', i.id, 'code', i.code, 'title', i.name, 'unit', i.unit,
      'parentId', i.parent_id, 'isGroup', exists(select 1 from public.contract_items child
        where child.parent_id = i.id and child.project_id = v_workspace.project_id),
      'contractQuantity', coalesce(i.revised_quantity, i.quantity),
      'priceVisible', app_private.project_has_permission_v2(v_workspace.project_id,
        v_workspace.primary_construction_site_id::text, 'project.contract_item.view', v_actor),
      'unitPrice', case when app_private.project_has_permission_v2(v_workspace.project_id,
        v_workspace.primary_construction_site_id::text, 'project.contract_item.view', v_actor)
        then coalesce(i.revised_unit_price, i.unit_price) else null end,
      'previousPlannedQuantity', previous.quantity,
      'availableQuantity', case when coalesce(i.revised_quantity, i.quantity) is null
        or previous.quantity is null then null
        else greatest(coalesce(i.revised_quantity, i.quantity) - previous.quantity, 0) end,
      'baselineRevision', case when i.is_locked and i.locked_at is not null
        then i.locked_at::text else null end,
      'baselineState', case when i.is_locked and i.locked_at is not null
        then 'verified' else 'unverified' end,
      'workspaceId', p_workspace_id,
      'unavailableReason', case when not i.is_locked or i.locked_at is null
        then 'Baseline chưa được xác nhận'
        when coalesce(i.revised_quantity, i.quantity) is null
        then 'Chưa xác định khối lượng hợp đồng' else null end)
      order by i.code, i.id), '[]'::jsonb) into v_items
    from public.contract_items i
    cross join lateral (
      select coalesce(sum(greatest(q.pending_quantity, q.effective_quantity)), 0) as quantity
      from (
        select p.id,
          coalesce(sum(l.quantity) filter (where p.status = 'pending_approval'
            and l.revision_no = p.revision_no), 0) pending_quantity,
          coalesce(sum(l.quantity) filter (where l.revision_no = p.effective_revision_no), 0) effective_quantity
        from public.project_v2_plan_lines l
        join public.project_v2_plans p on p.id = l.plan_id
        where p.workspace_id = p_workspace_id and p.plan_type = 'month'
          and p.id is distinct from p_exclude_plan_id
          and l.contract_item_id = i.id and p.status <> 'cancelled'
        group by p.id
      ) q
    ) previous
    where i.project_id = v_workspace.project_id and i.contract_type = 'customer';
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'sourcePlanId', p.id, 'sourceRevision', r.revision_no,
      'sourcePlanHash', r.content_hash, 'sourceLineId', l.id,
      'sourceQuantity', l.quantity, 'sourceUnit', l.unit,
      'availableQuantity', case when l.quantity is null then null
        else greatest(l.quantity - reserved.quantity, 0) end,
      'workspaceId', p.workspace_id, 'sourceStatus', 'approved',
      'unavailableReason', case when l.quantity is null then 'Chưa xác định khối lượng nguồn'
        when l.quantity - reserved.quantity <= 0 then 'Đã phân bổ hết' else null end,
      'code', p.code, 'title', p.title, 'workItemId', l.work_item_id,
      'contractItemId', l.contract_item_id)
      order by p.code, l.sort_order, l.id), '[]'::jsonb) into v_items
    from public.project_v2_plans p
    join public.project_v2_plan_revisions r on r.plan_id = p.id
      and r.revision_no = p.effective_revision_no
    join public.project_v2_plan_lines l on l.plan_id = p.id and l.revision_no = r.revision_no
    cross join lateral (
      select coalesce(sum(greatest(q.pending_quantity, q.effective_quantity)), 0) as quantity
      from (
        select consumer.id,
          coalesce(sum(s.source_work_quantity) filter (where consumer.status = 'pending_approval'
            and target.revision_no = consumer.revision_no), 0) pending_quantity,
          coalesce(sum(s.source_work_quantity) filter (where target.revision_no = consumer.effective_revision_no), 0) effective_quantity
        from public.project_v2_plan_line_sources s
        join public.project_v2_plan_lines target on target.id = s.target_line_id
        join public.project_v2_plans consumer on consumer.id = target.plan_id
        where s.source_plan_id = p.id and s.source_plan_revision_no = r.revision_no
          and consumer.id is distinct from p_exclude_plan_id
          and s.source_plan_line_id = l.id and consumer.status <> 'cancelled'
        group by consumer.id
      ) q
    ) reserved
    where p.workspace_id = p_workspace_id and p.plan_type = case
      when p_target_type = 'construction' then 'month' else 'construction' end
      and p.status <> 'cancelled';
  end if;
  return jsonb_build_object('asOf', now(), 'items', v_items);
end;
$$;

create or replace function public.list_project_v2_crews_v1(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_workspace public.project_v2_workspaces%rowtype;
begin
  select * into v_workspace from public.project_v2_workspaces
    where id = p_workspace_id and lifecycle <> 'archived';
  perform app_private.project_v2_assert_permission(v_workspace, 'construction', 'view', v_actor);
  return jsonb_build_object('asOf', now(), 'crews', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
      'workspaceId', c.workspace_id) order by c.name, c.id)
    from public.project_v2_crews c where c.workspace_id = p_workspace_id and c.is_active
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.list_project_v2_source_candidates_v1(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_project_v2_crews_v1(uuid) from public, anon, authenticated;
grant execute on function public.list_project_v2_source_candidates_v1(uuid, text, uuid) to authenticated;
grant execute on function public.list_project_v2_crews_v1(uuid) to authenticated;

create or replace function app_private.project_v2_plan_capabilities(
  p_project_id text, p_site_id text, p_plan_type text, p_actor uuid
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'view', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.view', p_actor),
    'create', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.create', p_actor),
    'edit', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.edit_all', p_actor),
    'submit', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.submit', p_actor),
    'approve', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.approve', p_actor),
    'return', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.return', p_actor),
    'revise', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.edit_all', p_actor),
    'cancel', app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_' || p_plan_type || '_plan.manage', p_actor),
    'priceVisible', app_private.project_has_permission_v2(p_project_id, p_site_id,
      'project.contract_item.view', p_actor),
    'baselineException', case when p_plan_type = 'construction' then
      app_private.project_has_permission_v2(p_project_id, p_site_id, 'project.v2_construction_plan.manage', p_actor)
      else false end
  );
$$;

create or replace function public.get_project_v2_plan_discussion_v1(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_v2_plans%rowtype;
  v_workspace public.project_v2_workspaces%rowtype;
begin
  select * into v_plan from public.project_v2_plans where id = p_plan_id;
  select * into v_workspace from public.project_v2_workspaces
    where id = v_plan.workspace_id and lifecycle <> 'archived';
  perform app_private.project_v2_assert_permission(v_workspace, v_plan.plan_type, 'view', v_actor);
  return jsonb_build_object('asOf', now(),
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'revision', c.revision_no, 'authorUserId', c.author_user_id,
      'body', c.body, 'createdAt', c.created_at) order by c.created_at, c.id)
      from public.project_v2_plan_comments c where c.plan_id = p_plan_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'revision', e.revision_no, 'eventType', e.event_type,
      'actorUserId', e.actor_user_id, 'reason', e.reason,
      'occurredAt', e.occurred_at) order by e.occurred_at, e.id)
      from public.project_v2_plan_events e where e.plan_id = p_plan_id), '[]'::jsonb));
end;
$$;
revoke all on function public.get_project_v2_plan_discussion_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_project_v2_plan_discussion_v1(uuid) to authenticated;

-- A locked contract item is the versioned baseline for a month line. Recheck
-- its lock and all active reservations when a draft is submitted or approved.
create or replace function app_private.project_v2_check_month_baseline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_line record;
  v_item public.contract_items%rowtype;
  v_project_id text;
  v_reserved numeric(20,6);
begin
  if new.plan_type <> 'month' or new.status not in ('pending_approval', 'approved') then return new; end if;
  select w.project_id into v_project_id from public.project_v2_workspaces w where w.id = new.workspace_id;
  for v_line in select * from public.project_v2_plan_lines l
    where l.plan_id = new.id and l.revision_no = new.revision_no order by l.id
  loop
    select * into v_item from public.contract_items i where i.id = v_line.contract_item_id;
    if v_item.id is null or v_item.project_id <> v_project_id or v_item.contract_type <> 'customer'
      or not v_item.is_locked or v_item.locked_at is null
      or v_item.locked_at::text is distinct from v_line.baseline_revision
      or v_item.unit is distinct from v_line.unit
      or exists(select 1 from public.contract_items child where child.parent_id = v_item.id)
      or v_line.quantity is null then
      raise exception using errcode = '40001', message = 'PROJECT_V2_BASELINE_STALE';
    end if;
    select coalesce(sum(greatest(q.pending_quantity, q.effective_quantity)), 0) into v_reserved
    from (
      select other_plan.id,
        coalesce(sum(other_line.quantity) filter (where other_plan.status = 'pending_approval'
          and other_line.revision_no = other_plan.revision_no), 0) pending_quantity,
        coalesce(sum(other_line.quantity) filter (where other_line.revision_no = other_plan.effective_revision_no), 0) effective_quantity
      from public.project_v2_plan_lines other_line
      join public.project_v2_plans other_plan on other_plan.id = other_line.plan_id
      where other_plan.workspace_id = new.workspace_id and other_plan.plan_type = 'month'
        and other_plan.id <> new.id and other_line.contract_item_id = v_item.id
        and other_plan.status <> 'cancelled'
      group by other_plan.id
    ) q;
    if v_line.quantity + v_reserved > coalesce(v_item.revised_quantity, v_item.quantity) then
      raise exception using errcode = '23514', message = 'PROJECT_V2_BASELINE_QUANTITY_EXCEEDED',
        detail = jsonb_build_object('contractItemId', v_item.id,
          'availableQuantity', greatest(coalesce(v_item.revised_quantity, v_item.quantity) - v_reserved, 0))::text;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function app_private.project_v2_check_month_baseline() from public, anon, authenticated;
create trigger project_v2_check_month_baseline_before_transition
before update of status on public.project_v2_plans
for each row execute function app_private.project_v2_check_month_baseline();

create or replace function app_private.project_v2_check_construction_line()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan public.project_v2_plans%rowtype;
  v_item public.contract_items%rowtype;
begin
  select * into v_plan from public.project_v2_plans where id = new.plan_id;
  if new.plan_type = 'month' then
    select i.* into v_item from public.contract_items i
      join public.project_v2_workspaces w on w.project_id = i.project_id
      where i.id = new.contract_item_id and w.id = v_plan.workspace_id;
    new.unit_price_snapshot := case when v_item.id is not null and v_item.is_locked
      and v_item.locked_at is not null then coalesce(v_item.revised_unit_price, v_item.unit_price)
      else null end;
    return new;
  end if;
  if new.plan_type <> 'construction' then return new; end if;
  if (new.work_start is not null and new.work_start < v_plan.period_start)
    or (new.work_end is not null and new.work_end > v_plan.period_end)
    or (new.work_start is not null and new.work_end is not null and new.work_end < new.work_start) then
    raise exception using errcode = '22023', message = 'PROJECT_V2_WORK_DATES_OUTSIDE_PERIOD';
  end if;
  if new.crew_id is not null and not exists (select 1 from public.project_v2_crews c
    where c.id = new.crew_id and c.workspace_id = v_plan.workspace_id and c.is_active) then
    raise exception using errcode = '42501', message = 'PROJECT_V2_CREW_SCOPE_DENIED';
  end if;
  return new;
end;
$$;
revoke all on function app_private.project_v2_check_construction_line() from public, anon, authenticated;
create trigger project_v2_check_construction_line_before_write
before insert or update on public.project_v2_plan_lines
for each row execute function app_private.project_v2_check_construction_line();

-- Task 6 extends the revisioned command without changing its idempotency or lock order.
create or replace function app_private.project_v2_validate_sources(
  p_plan_id uuid, p_revision_no integer, p_plan_type text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_source record;
  v_reserved numeric(20,6);
  v_available numeric(20,6);
  v_line_total numeric(20,6);
  v_line record;
  v_workspace public.project_v2_workspaces%rowtype;
begin
  if p_plan_type = 'month' then return; end if;
  select w.* into v_workspace from public.project_v2_workspaces w
    join public.project_v2_plans p on p.workspace_id = w.id where p.id = p_plan_id;
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
      select coalesce(sum(greatest(q.pending_quantity, q.effective_quantity)), 0) into v_reserved
      from (
        select consumer.id,
          coalesce(sum(s.source_work_quantity) filter (where consumer.status = 'pending_approval'
            and target.revision_no = consumer.revision_no), 0) pending_quantity,
          coalesce(sum(s.source_work_quantity) filter (where target.revision_no = consumer.effective_revision_no), 0) effective_quantity
        from public.project_v2_plan_line_sources s
        join public.project_v2_plan_lines target on target.id = s.target_line_id
        join public.project_v2_plans consumer on consumer.id = target.plan_id
        where s.source_plan_id = v_source.source_plan_id
          and s.source_plan_revision_no = v_source.source_plan_revision_no
          and s.source_plan_line_id = v_source.source_plan_line_id
          and consumer.status <> 'cancelled' and consumer.id <> p_plan_id
        group by consumer.id
      ) q;
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
    select l.* into v_line from public.project_v2_plan_lines l where l.id = v_source.id;
    if p_plan_type = 'construction' and nullif(btrim(v_line.baseline_exception_reason), '') is not null then
      if v_source.total <> 0 or v_source.quantity is null or
        not exists (select 1 from public.contract_items i
          where i.id::text = v_line.work_item_id and i.project_id = v_workspace.project_id
            and i.contract_type = 'customer' and i.is_locked and i.locked_at is not null
            and i.locked_at::text = v_line.baseline_revision and i.unit = v_line.unit
            and v_line.quantity <= coalesce(i.revised_quantity, i.quantity)
            and not exists(select 1 from public.contract_items child where child.parent_id = i.id)) or
        not app_private.project_has_permission_v2(v_workspace.project_id,
          v_workspace.primary_construction_site_id::text,
          'project.v2_construction_plan.manage', public.current_app_user_id()) then
        raise exception using errcode = '42501', message = 'PROJECT_V2_BASELINE_EXCEPTION_DENIED';
      end if;
    elsif v_source.quantity is null or v_source.quantity <> v_source.total then
      raise exception using errcode = '22023', message = 'PROJECT_V2_SOURCE_TOTAL_MISMATCH';
    end if;
  end loop;
end;
$$;

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
    insert into public.project_v2_plan_lines(id, plan_id, revision_no, plan_type,
      sort_order, contract_item_id, baseline_revision, work_item_id,
      inventory_item_id, unit, quantity, unit_price_snapshot, currency,
      work_start, work_end, crew_id, needed_date, destination_id,
      baseline_exception_reason, note)
    values (v_line_id, v_plan.id, v_plan.revision_no, p_plan_type,
      v_order, (v_line ->> 'contractItemId')::uuid, v_line ->> 'baselineRevision',
      v_line ->> 'workItemId', v_line ->> 'itemId', v_line ->> 'unit',
      v_quantity_text::numeric(20,6), (v_line ->> 'unitPriceSnapshot')::numeric(20,6),
      v_line ->> 'currency', (v_line ->> 'workStart')::date,
      (v_line ->> 'workEnd')::date, (v_line ->> 'crewId')::uuid,
      (v_line ->> 'neededDate')::date, v_line ->> 'destinationId', v_line ->> 'baselineExceptionReason',
      v_line ->> 'note');

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

-- Detail readers see price only with the contract item read capability.
create or replace function public.get_project_v2_plan_v1(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_v2_plans%rowtype;
  v_workspace public.project_v2_workspaces%rowtype;
  v_can_view_price boolean;
begin
  select * into v_plan from public.project_v2_plans where id = p_plan_id;
  select * into v_workspace from public.project_v2_workspaces where id = v_plan.workspace_id and lifecycle <> 'archived';
  if v_actor is null or v_workspace.id is null or not app_private.project_has_permission_v2(
    v_workspace.project_id, v_workspace.primary_construction_site_id::text,
    'project.v2_' || v_plan.plan_type || '_plan.view', v_actor) then
    raise exception using errcode = '42501', message = 'PROJECT_V2_READ_DENIED';
  end if;
  v_can_view_price := app_private.project_has_permission_v2(v_workspace.project_id,
    v_workspace.primary_construction_site_id::text, 'project.contract_item.view', v_actor);
  return jsonb_build_object('asOf', now(), 'plan', to_jsonb(v_plan),
    'capabilities', app_private.project_v2_plan_capabilities(v_workspace.project_id,
      v_workspace.primary_construction_site_id::text, v_plan.plan_type, v_actor),
    'lines', coalesce((select jsonb_agg((case when v_can_view_price then to_jsonb(l)
        else to_jsonb(l) - 'unit_price_snapshot' end) || jsonb_build_object(
          'displayCode', coalesce(i.code, t.code, it.sku),
          'displayName', coalesce(i.name, t.name, it.name)) order by l.sort_order, l.id)
      from public.project_v2_plan_lines l
      left join public.contract_items i on i.project_id = v_workspace.project_id
        and (i.id = l.contract_item_id or (l.plan_type = 'construction' and i.id::text = l.work_item_id))
      left join public.project_tasks t on t.project_id = v_workspace.project_id and t.id = l.work_item_id
      left join public.items it on it.id = l.inventory_item_id
      where l.plan_id = v_plan.id and l.revision_no = v_plan.revision_no), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.id)
      from public.project_v2_plan_line_sources s
      join public.project_v2_plan_lines l on l.id = s.target_line_id
      where l.plan_id = v_plan.id and l.revision_no = v_plan.revision_no), '[]'::jsonb));
end;
$$;

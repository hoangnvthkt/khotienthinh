create function app_private.assert_daily_log_wbs_resource_payload_v1(
  p_labor jsonb,
  p_machines jsonb
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_line jsonb;
  v_provider jsonb;
  v_partner public.business_partners%rowtype;
begin
  if jsonb_typeof(coalesce(p_labor, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_machines, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'RESOURCE_PAYLOAD_ARRAY_REQUIRED';
  end if;

  if coalesce(p_labor, '[]'::jsonb)::text ~* '"(unit_?cost|total_?cost|unit_?price|total_?price|amount)"[[:space:]]*:'
    or coalesce(p_machines, '[]'::jsonb)::text ~* '"(unit_?cost|total_?cost|unit_?price|total_?price|amount)"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'RESOURCE_PRICE_FIELDS_NOT_ALLOWED';
  end if;

  for v_line in
    select value from jsonb_array_elements(coalesce(p_labor, '[]'::jsonb))
    union all
    select value from jsonb_array_elements(coalesce(p_machines, '[]'::jsonb))
  loop
    v_provider := coalesce(v_line->'provider', '{}'::jsonb);
    if v_provider->>'entryMode' = 'manual' then
      if nullif(trim(v_provider->>'manualProviderName'), '') is null then
        raise exception using errcode = '22023', message = 'MANUAL_PROVIDER_NAME_REQUIRED';
      end if;
    elsif v_provider->>'entryMode' = 'catalog' then
      if nullif(trim(v_provider->>'partnerId'), '') is null then
        raise exception using errcode = '22023', message = 'CATALOG_PROVIDER_REQUIRED';
      end if;
      select partner.* into v_partner
      from public.business_partners partner
      where partner.id = v_provider->>'partnerId'
        and partner.is_active
        and partner.classifications && array['supplier', 'contractor']::text[];
      if not found then
        raise exception using errcode = '22023', message = 'CATALOG_PROVIDER_NOT_ACTIVE';
      end if;
    else
      raise exception using errcode = '22023', message = 'PROVIDER_ENTRY_MODE_REQUIRED';
    end if;
  end loop;
end;
$$;

revoke all on function app_private.assert_daily_log_wbs_resource_payload_v1(jsonb, jsonb)
  from public, anon, authenticated;

create function public.get_daily_log_wbs_bundle_v1(
  p_project_id text,
  p_construction_site_id text,
  p_log_date date,
  p_daily_log_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_rollout jsonb;
  v_summary_id text;
begin
  if v_actor_id is null or not app_private.daily_log_can_select(
    p_project_id, p_construction_site_id, v_actor_id
  ) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_WBS_BUNDLE_ACCESS_DENIED';
  end if;

  v_rollout := public.get_daily_log_wbs_rollout_access_v1(
    p_project_id, p_construction_site_id, p_log_date
  );

  select log.id into v_summary_id
  from public.daily_logs log
  where log.project_id = p_project_id
    and log.construction_site_id is not distinct from p_construction_site_id
    and log.date = p_log_date::text
    and log.summary_source_type = 'member_contributions'
    and (p_daily_log_id is null or log.id = p_daily_log_id)
  order by log.created_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'rollout', v_rollout,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', task.id,
        'projectId', task.project_id,
        'constructionSiteId', task.construction_site_id,
        'parentId', task.parent_id,
        'name', task.name,
        'startDate', task.start_date,
        'endDate', task.end_date,
        'duration', task.duration,
        'progress', task.progress,
        'progressMode', task.progress_mode,
        'isMilestone', task.is_milestone,
        'order', task.sort_order,
        'wbsCode', task.wbs_code,
        'fallbackUnit', task.fallback_unit,
        'provisionalQuantity', task.provisional_quantity,
        'rowVersion', task.row_version
      ) order by task.sort_order, task.id)
      from public.project_tasks task
      where task.project_id = p_project_id
        and task.construction_site_id is not distinct from p_construction_site_id
    ), '[]'::jsonb),
    'workBoqItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', work.id,
        'projectId', work.project_id,
        'constructionSiteId', work.construction_site_id,
        'sourceTaskId', work.source_task_id,
        'parentId', work.parent_id,
        'wbsCode', work.wbs_code,
        'name', work.name,
        'unit', work.unit,
        'plannedQty', work.planned_qty,
        'sortOrder', work.sort_order,
        'syncStatus', work.sync_status,
        'notes', work.notes
      ) order by work.sort_order, work.id)
      from public.project_work_boq_items work
      where work.project_id = p_project_id
        and work.construction_site_id is not distinct from p_construction_site_id
    ), '[]'::jsonb),
    'resourceProviders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', partner.id,
        'code', partner.code,
        'name', partner.name,
        'classifications', partner.classifications,
        'isActive', partner.is_active
      ) order by partner.name, partner.id)
      from public.business_partners partner
      where partner.is_active
        and partner.classifications && array['supplier', 'contractor']::text[]
    ), '[]'::jsonb),
    'previousProgressRows', coalesce((
      select jsonb_agg(to_jsonb(previous_row) order by previous_row.task_id)
      from (
        select distinct on (progress.task_id) progress.*
        from public.project_daily_task_progress progress
        where progress.project_id = p_project_id
          and progress.construction_site_id is not distinct from p_construction_site_id
          and progress.progress_date < p_log_date
        order by progress.task_id, progress.progress_date desc, progress.updated_at desc
      ) previous_row
    ), '[]'::jsonb),
    'nextProgressRows', coalesce((
      select jsonb_agg(to_jsonb(next_row) order by next_row.task_id)
      from (
        select distinct on (progress.task_id) progress.*
        from public.project_daily_task_progress progress
        where progress.project_id = p_project_id
          and progress.construction_site_id is not distinct from p_construction_site_id
          and progress.progress_date > p_log_date
        order by progress.task_id, progress.progress_date, progress.updated_at desc
      ) next_row
    ), '[]'::jsonb),
    'contribution', (
      select to_jsonb(contribution)
      from public.daily_log_contributions contribution
      where contribution.project_id = p_project_id
        and contribution.construction_site_id is not distinct from p_construction_site_id
        and contribution.date = p_log_date
        and contribution.author_user_id = v_actor_id::text
      order by contribution.created_at desc
      limit 1
    ),
    'contributionsForSummary', coalesce((
      select jsonb_agg(to_jsonb(contribution) order by contribution.created_at, contribution.id)
      from public.daily_log_contributions contribution
      where contribution.project_id = p_project_id
        and contribution.construction_site_id is not distinct from p_construction_site_id
        and contribution.date = p_log_date
        and contribution.status in ('submitted', 'included', 'returned')
    ), '[]'::jsonb),
    'summaryLog', (select to_jsonb(log) - 'labor_details' - 'machines' - 'materials' - 'volumes'
      from public.daily_logs log where log.id = v_summary_id),
    'summarySources', coalesce((
      select jsonb_agg(to_jsonb(source) - 'metadata' order by source.sort_order, source.id)
      from public.daily_log_summary_sources source where source.daily_log_id = v_summary_id
    ), '[]'::jsonb),
    'workItems', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.source_index, item.id)
      from public.daily_log_work_items item
      where item.contribution_id in (
          select contribution.id from public.daily_log_contributions contribution
          where contribution.project_id = p_project_id
            and contribution.construction_site_id is not distinct from p_construction_site_id
            and contribution.date = p_log_date
        )
        or item.daily_log_id = v_summary_id
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(to_jsonb(decision) order by decision.task_id)
      from public.daily_log_wbs_decisions decision where decision.daily_log_id = v_summary_id
    ), '[]'::jsonb),
    'labor', coalesce((
      select jsonb_agg(to_jsonb(labor) - 'unit_cost' - 'total_cost' order by labor.source_index, labor.id)
      from public.daily_log_labor labor
      where labor.resource_semantics_version = 2
        and (labor.contribution_id in (
          select contribution.id from public.daily_log_contributions contribution
          where contribution.project_id = p_project_id
            and contribution.construction_site_id is not distinct from p_construction_site_id
            and contribution.date = p_log_date
        ) or labor.daily_log_id = v_summary_id)
    ), '[]'::jsonb),
    'machines', coalesce((
      select jsonb_agg(to_jsonb(machine) - 'unit_cost' - 'total_cost' order by machine.source_index, machine.id)
      from public.daily_log_machines machine
      where machine.resource_semantics_version = 2
        and (machine.contribution_id in (
          select contribution.id from public.daily_log_contributions contribution
          where contribution.project_id = p_project_id
            and contribution.construction_site_id is not distinct from p_construction_site_id
            and contribution.date = p_log_date
        ) or machine.daily_log_id = v_summary_id)
    ), '[]'::jsonb),
    'periodState', (
      select to_jsonb(state)
      from public.project_progress_period_states state
      where state.project_id = p_project_id
        and state.construction_site_id is not distinct from p_construction_site_id
        and state.period_type = 'daily'
        and state.period_start = p_log_date
      limit 1
    ),
    'permissions', jsonb_build_object(
      'canEditSource', exists (
        select 1 from public.daily_log_contributions contribution
        where contribution.project_id = p_project_id
          and contribution.construction_site_id is not distinct from p_construction_site_id
          and contribution.date = p_log_date
          and contribution.author_user_id = v_actor_id::text
          and contribution.status in ('draft', 'returned')
      ),
      'canSummarize', app_private.current_actor_has_effective_room_action(
        p_project_id, p_construction_site_id, 'daily_log', 'verify'
      ),
      'canApprove', app_private.current_actor_has_effective_room_action(
        p_project_id, p_construction_site_id, 'daily_log', 'approve'
      ),
      'canPublishProgress', app_private.current_actor_has_effective_room_action(
        p_project_id, p_construction_site_id, 'daily_log', 'publish_progress'
      )
    )
  );
end;
$$;

create function public.save_daily_log_contribution_work_v1(
  p_contribution_id uuid,
  p_expected_row_version bigint,
  p_work_area_code text,
  p_work_area_name text,
  p_items jsonb,
  p_labor jsonb,
  p_machines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_contribution public.daily_log_contributions%rowtype;
  v_item jsonb;
  v_line jsonb;
  v_task public.project_tasks%rowtype;
  v_work public.project_work_boq_items%rowtype;
  v_baseline public.project_daily_task_progress%rowtype;
  v_provider public.business_partners%rowtype;
  v_work_item_id uuid;
  v_item_ids jsonb := '{}'::jsonb;
  v_planned_quantity numeric;
  v_cumulative_quantity numeric;
  v_daily_quantity numeric;
  v_fingerprint text;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'DAILY_LOG_WBS_WRITE_ACCESS_DENIED';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'WORK_ITEMS_ARRAY_REQUIRED';
  end if;
  if coalesce(p_items, '[]'::jsonb)::text ~* '"(unit_?cost|total_?cost|unit_?price|total_?price|amount)"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'RESOURCE_PRICE_FIELDS_NOT_ALLOWED';
  end if;
  perform app_private.assert_daily_log_wbs_resource_payload_v1(p_labor, p_machines);

  select contribution.* into v_contribution
  from public.daily_log_contributions contribution
  where contribution.id = p_contribution_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CONTRIBUTION_NOT_FOUND';
  end if;
  if v_contribution.author_user_id <> v_actor_id::text
    or v_contribution.status not in ('draft', 'returned') then
    raise exception using errcode = '42501', message = 'CONTRIBUTION_NOT_EDITABLE';
  end if;
  if v_contribution.row_version <> p_expected_row_version then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT';
  end if;
  if nullif(trim(p_work_area_code), '') is null or nullif(trim(p_work_area_name), '') is null then
    raise exception using errcode = '22023', message = 'WORK_AREA_REQUIRED';
  end if;
  if not coalesce((public.get_daily_log_wbs_rollout_access_v1(
    v_contribution.project_id, v_contribution.construction_site_id, v_contribution.date
  )->>'enabled')::boolean, false) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_WBS_ROLLOUT_DISABLED';
  end if;
  if exists (
    select 1 from public.project_progress_period_states state
    where state.project_id = v_contribution.project_id
      and state.construction_site_id is not distinct from v_contribution.construction_site_id
      and state.period_type = 'daily'
      and state.period_start = v_contribution.date
      and state.is_locked
  ) then
    raise exception using errcode = '55000', message = 'PERIOD_LOCKED';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
    group by item->>'clientKey' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
    where nullif(trim(item->>'clientKey'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'WORK_ITEM_CLIENT_KEY_INVALID';
  end if;

  -- All validation precedes this owner-scoped replacement.
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select task.* into v_task
    from public.project_tasks task
    where task.id = v_item->>'taskId'
      and task.project_id = v_contribution.project_id
      and task.construction_site_id is not distinct from v_contribution.construction_site_id
      and not exists (select 1 from public.project_tasks child where child.parent_id = task.id);
    if not found then
      raise exception using errcode = '22023', message = 'LEAF_TASK_REQUIRED';
    end if;
    if coalesce((v_item->>'cumulativeProgressPercent')::numeric, -1) < 0 then
      raise exception using errcode = '22023', message = 'PROGRESS_BELOW_ALLOWED_MINIMUM';
    end if;
    if nullif(v_item->>'workBoqItemId', '') is not null then
      select work.* into v_work from public.project_work_boq_items work
      where work.id = v_item->>'workBoqItemId'
        and work.source_task_id = v_task.id
        and work.project_id = v_contribution.project_id
        and work.construction_site_id is not distinct from v_contribution.construction_site_id;
      if not found then
        raise exception using errcode = '22023', message = 'WORK_BOQ_SCOPE_MISMATCH';
      end if;
    end if;
    select progress.* into v_baseline
    from public.project_daily_task_progress progress
    where progress.project_id = v_contribution.project_id
      and progress.construction_site_id is not distinct from v_contribution.construction_site_id
      and progress.task_id = v_task.id
      and progress.progress_date < v_contribution.date
    order by progress.progress_date desc, progress.updated_at desc
    limit 1;
    if nullif(v_item->>'baselineFingerprint', '') is not null
      and v_item->>'baselineFingerprint' <> md5(concat_ws('|',
        v_baseline.id::text, v_baseline.progress_percent::text,
        v_baseline.quantity_done::text, v_baseline.updated_at::text
      )) then
      raise exception using errcode = '40001', message = 'SOURCE_CHANGED';
    end if;
  end loop;

  delete from public.daily_log_work_items item where item.contribution_id = p_contribution_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select task.* into v_task from public.project_tasks task where task.id = v_item->>'taskId';
    v_work := null;
    if nullif(v_item->>'workBoqItemId', '') is not null then
      select work.* into v_work from public.project_work_boq_items work where work.id = v_item->>'workBoqItemId';
    end if;
    v_baseline := null;
    select progress.* into v_baseline
    from public.project_daily_task_progress progress
    where progress.project_id = v_contribution.project_id
      and progress.construction_site_id is not distinct from v_contribution.construction_site_id
      and progress.task_id = v_task.id
      and progress.progress_date < v_contribution.date
    order by progress.progress_date desc, progress.updated_at desc limit 1;
    v_planned_quantity := coalesce(nullif((v_item->>'areaPlannedQuantity')::numeric, 0),
      nullif(v_work.planned_qty, 0), nullif(v_task.provisional_quantity, 0));
    v_cumulative_quantity := case when v_planned_quantity is null then null
      else v_planned_quantity * (v_item->>'cumulativeProgressPercent')::numeric / 100 end;
    v_daily_quantity := case when v_cumulative_quantity is null then null
      else greatest(v_cumulative_quantity - coalesce(v_baseline.quantity_done, 0), 0) end;

    insert into public.daily_log_work_items (
      contribution_id, project_id, construction_site_id, task_id, work_boq_item_id,
      work_area_code, work_area_name_snapshot, wbs_code_snapshot, task_name_snapshot,
      unit_snapshot, planned_quantity_snapshot, area_planned_quantity_snapshot,
      baseline_progress_percent, baseline_quantity_done, baseline_progress_row_id,
      baseline_fingerprint, cumulative_progress_percent, cumulative_quantity_done,
      daily_quantity_done, schedule_finish_date_snapshot, forecast_finish_date,
      forecast_change_reason, note, attachments, source_index, updated_at
    ) values (
      p_contribution_id, v_contribution.project_id, v_contribution.construction_site_id,
      v_task.id, v_work.id, trim(p_work_area_code), trim(p_work_area_name), v_task.wbs_code,
      v_task.name, coalesce(v_work.unit, v_task.fallback_unit),
      coalesce(nullif(v_work.planned_qty, 0), nullif(v_task.provisional_quantity, 0)),
      nullif((v_item->>'areaPlannedQuantity')::numeric, 0), coalesce(v_baseline.progress_percent, 0),
      v_baseline.quantity_done, v_baseline.id, md5(concat_ws('|', v_baseline.id::text,
        coalesce(v_baseline.progress_percent, 0)::text, coalesce(v_baseline.quantity_done, 0)::text,
        v_baseline.updated_at::text)), (v_item->>'cumulativeProgressPercent')::numeric,
      v_cumulative_quantity, v_daily_quantity, nullif(v_task.end_date, '')::date,
      nullif(v_item->>'forecastFinishDate', '')::date, nullif(trim(v_item->>'forecastChangeReason'), ''),
      nullif(trim(v_item->>'note'), ''), coalesce(v_item->'attachments', '[]'::jsonb),
      coalesce((v_item->>'sourceIndex')::integer, 0), v_now
    ) returning id into v_work_item_id;
    v_item_ids := v_item_ids || jsonb_build_object(v_item->>'clientKey', v_work_item_id::text);
  end loop;

  for v_line in select value from jsonb_array_elements(coalesce(p_labor, '[]'::jsonb))
  loop
    if not v_item_ids ? (v_line->>'workItemClientKey') then
      raise exception using errcode = '22023', message = 'WORK_ITEM_CLIENT_KEY_NOT_FOUND';
    end if;
    v_provider := null;
    if v_line->'provider'->>'entryMode' = 'catalog' then
      select partner.* into v_provider from public.business_partners partner
      where partner.id = v_line->'provider'->>'partnerId' and partner.is_active;
    end if;
    insert into public.daily_log_labor (
      daily_log_id, construction_site_id, project_id, labor_type, count, hours,
      unit_cost, total_cost, note, source_index, partner_id, partner_name, task_id, task_name,
      daily_log_work_item_id, contribution_id, people_count, hours_per_person, total_labor_hours,
      provider_entry_mode, provider_code_snapshot, provider_name_snapshot, manual_provider_type,
      manual_provider_name, manual_provider_note, resource_semantics_version
    ) select null, v_contribution.construction_site_id, v_contribution.project_id,
      v_line->>'laborType', (v_line->>'peopleCount')::numeric,
      (v_line->>'peopleCount')::numeric * (v_line->>'hoursPerPerson')::numeric,
      null, null, nullif(trim(v_line->>'note'), ''), coalesce((v_line->>'sourceIndex')::integer, 0),
      v_provider.id, v_provider.name, item.task_id, item.task_name_snapshot,
      item.id, p_contribution_id, (v_line->>'peopleCount')::numeric,
      (v_line->>'hoursPerPerson')::numeric,
      (v_line->>'peopleCount')::numeric * (v_line->>'hoursPerPerson')::numeric,
      v_line->'provider'->>'entryMode', v_provider.code, v_provider.name,
      v_line->'provider'->>'manualProviderType', v_line->'provider'->>'manualProviderName',
      v_line->'provider'->>'manualProviderNote', 2
    from public.daily_log_work_items item
    where item.id = (v_item_ids->>(v_line->>'workItemClientKey'))::uuid;
  end loop;

  for v_line in select value from jsonb_array_elements(coalesce(p_machines, '[]'::jsonb))
  loop
    if not v_item_ids ? (v_line->>'workItemClientKey') then
      raise exception using errcode = '22023', message = 'WORK_ITEM_CLIENT_KEY_NOT_FOUND';
    end if;
    v_provider := null;
    if v_line->'provider'->>'entryMode' = 'catalog' then
      select partner.* into v_provider from public.business_partners partner
      where partner.id = v_line->'provider'->>'partnerId' and partner.is_active;
    end if;
    insert into public.daily_log_machines (
      daily_log_id, construction_site_id, project_id, machine_name, machine_type, shifts, hours,
      unit_cost, total_cost, note, source_index, partner_id, partner_name, task_id, task_name,
      daily_log_work_item_id, contribution_id, machine_count, hours_per_machine, total_machine_hours,
      provider_entry_mode, provider_code_snapshot, provider_name_snapshot, manual_provider_type,
      manual_provider_name, manual_provider_note, resource_semantics_version
    ) select null, v_contribution.construction_site_id, v_contribution.project_id,
      coalesce(nullif(v_line->>'machineName', ''), v_line->>'machineType'), v_line->>'machineType',
      (v_line->>'machineCount')::numeric,
      (v_line->>'machineCount')::numeric * (v_line->>'hoursPerMachine')::numeric,
      null, null, nullif(trim(v_line->>'note'), ''), coalesce((v_line->>'sourceIndex')::integer, 0),
      v_provider.id, v_provider.name, item.task_id, item.task_name_snapshot,
      item.id, p_contribution_id, (v_line->>'machineCount')::numeric,
      (v_line->>'hoursPerMachine')::numeric,
      (v_line->>'machineCount')::numeric * (v_line->>'hoursPerMachine')::numeric,
      v_line->'provider'->>'entryMode', v_provider.code, v_provider.name,
      v_line->'provider'->>'manualProviderType', v_line->'provider'->>'manualProviderName',
      v_line->'provider'->>'manualProviderNote', 2
    from public.daily_log_work_items item
    where item.id = (v_item_ids->>(v_line->>'workItemClientKey'))::uuid;
  end loop;

  select md5(coalesce(string_agg(concat_ws('|', item.task_id, item.cumulative_progress_percent,
    item.daily_quantity_done, item.updated_at), '||' order by item.task_id), '')) into v_fingerprint
  from public.daily_log_work_items item where item.contribution_id = p_contribution_id;

  update public.daily_log_contributions contribution
  set work_area_code = trim(p_work_area_code), work_area_name = trim(p_work_area_name),
      row_version = contribution.row_version + 1, source_fingerprint = v_fingerprint,
      last_action_by = v_actor_id::text, last_action_at = v_now, updated_at = v_now
  where contribution.id = p_contribution_id
  returning contribution.row_version into p_expected_row_version;

  return jsonb_build_object('rowVersion', p_expected_row_version, 'updatedAt', v_now,
    'sourceFingerprint', v_fingerprint, 'conflicts', '[]'::jsonb);
end;
$$;

create function public.save_daily_log_summary_work_v1(
  p_daily_log_id text,
  p_expected_updated_at timestamptz,
  p_sources jsonb,
  p_items jsonb,
  p_decisions jsonb,
  p_labor jsonb,
  p_machines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_log public.daily_logs%rowtype;
  v_source jsonb;
  v_contribution public.daily_log_contributions%rowtype;
  v_existing_source public.daily_log_summary_sources%rowtype;
  v_summary_source_id uuid;
  v_line jsonb;
  v_provider public.business_partners%rowtype;
  v_summary_work_item public.daily_log_work_items%rowtype;
  v_now timestamptz := clock_timestamp();
  v_fingerprint text;
  v_keep_adjusted_card boolean;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_sources, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_decisions, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'SUMMARY_PAYLOAD_ARRAY_REQUIRED';
  end if;
  if (coalesce(p_sources, '[]'::jsonb) || coalesce(p_items, '[]'::jsonb)
      || coalesce(p_decisions, '[]'::jsonb))::text
      ~* '"(unit_?cost|total_?cost|unit_?price|total_?price|amount)"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'RESOURCE_PRICE_FIELDS_NOT_ALLOWED';
  end if;
  perform app_private.assert_daily_log_wbs_resource_payload_v1(p_labor, p_machines);

  select log.* into v_log from public.daily_logs log where log.id = p_daily_log_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;
  if v_log.summary_source_type <> 'member_contributions' or v_log.status not in ('draft', 'rejected') then
    raise exception using errcode = '42501', message = 'SUMMARY_NOT_EDITABLE';
  end if;
  if not app_private.current_actor_has_effective_room_action(
    v_log.project_id, v_log.construction_site_id, 'daily_log', 'verify'
  ) then raise exception using errcode = '42501', message = 'DAILY_LOG_SUMMARIZE_REQUIRED'; end if;
  if coalesce(v_log.last_action_at, v_log.created_at) is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT';
  end if;
  if exists (
    select 1 from public.project_progress_period_states state
    where state.project_id = v_log.project_id
      and state.construction_site_id is not distinct from v_log.construction_site_id
      and state.period_type = 'daily' and state.period_start = v_log.date::date and state.is_locked
  ) then raise exception using errcode = '55000', message = 'PERIOD_LOCKED'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) source
    group by source->>'contributionId' having count(*) > 1
  ) then raise exception using errcode = '22023', message = 'DUPLICATE_SUMMARY_SOURCE'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) source
    where coalesce((source->>'hasAdjustments')::boolean, false)
      and nullif(trim(source->>'adjustmentReason'), '') is null
  ) then raise exception using errcode = '22023', message = 'SUMMARY_ADJUSTMENT_REASON_REQUIRED'; end if;

  for v_source in select value from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
  loop
    select contribution.* into v_contribution from public.daily_log_contributions contribution
    where contribution.id = (v_source->>'contributionId')::uuid
      and contribution.project_id = v_log.project_id
      and contribution.construction_site_id is not distinct from v_log.construction_site_id
      and contribution.date = v_log.date::date
    for update;
    if not found then raise exception using errcode = '22023', message = 'SUMMARY_SOURCE_SCOPE_MISMATCH'; end if;
    if v_contribution.status = 'returned' then raise exception using errcode = '40001', message = 'SOURCE_RETURNED'; end if;
    if v_contribution.status not in ('submitted', 'included') then
      raise exception using errcode = '22023', message = 'SUMMARY_SOURCE_NOT_SUBMITTED';
    end if;
    if coalesce((v_source->>'sourceVersion')::bigint, 0) <> v_contribution.row_version
      or coalesce(v_source->>'sourceFingerprint', '') <> coalesce(v_contribution.source_fingerprint, '') then
      raise exception using errcode = '40001', message = 'SOURCE_CHANGED';
    end if;
    v_existing_source := null;
    select source.* into v_existing_source
    from public.daily_log_summary_sources source
    where source.daily_log_id = p_daily_log_id and source.contribution_id = v_contribution.id;
    v_keep_adjusted_card := found
      and v_existing_source.has_adjustments
      and v_existing_source.source_version is distinct from v_contribution.row_version
      and not coalesce((v_source->>'refreshSource')::boolean, false);

    insert into public.daily_log_summary_sources (
      daily_log_id, contribution_id, source_user_id, source_user_name, included_text,
      included_photos, metadata, created_by, sort_order, source_version, source_fingerprint,
      source_snapshot, source_state, work_area_code, work_area_name, has_adjustments,
      adjustment_reason, adjusted_by, adjusted_at, review_status, updated_at
    ) values (
      p_daily_log_id, v_contribution.id, v_contribution.author_user_id, v_contribution.author_name,
      coalesce((v_source->>'includedText')::boolean, true), coalesce(v_source->'includedPhotos', '[]'::jsonb),
      coalesce(v_source->'metadata', '{}'::jsonb), v_actor_id::text,
      coalesce((v_source->>'sortOrder')::integer, 0), v_contribution.row_version,
      v_contribution.source_fingerprint, jsonb_build_object(
        'contributionId', v_contribution.id, 'rowVersion', v_contribution.row_version,
        'sourceFingerprint', v_contribution.source_fingerprint, 'status', v_contribution.status,
        'updatedAt', v_contribution.updated_at
      ), case when v_keep_adjusted_card then 'changed' else 'current' end,
      v_contribution.work_area_code, v_contribution.work_area_name,
      coalesce((v_source->>'hasAdjustments')::boolean, false),
      nullif(trim(v_source->>'adjustmentReason'), ''),
      case when coalesce((v_source->>'hasAdjustments')::boolean, false) then v_actor_id::text end,
      case when coalesce((v_source->>'hasAdjustments')::boolean, false) then v_now end,
      'ready', v_now
    ) on conflict (daily_log_id, contribution_id) do update set
      source_user_id = excluded.source_user_id, source_user_name = excluded.source_user_name,
      included_text = excluded.included_text, included_photos = excluded.included_photos,
      metadata = excluded.metadata, sort_order = excluded.sort_order,
      source_version = excluded.source_version, source_fingerprint = excluded.source_fingerprint,
      source_snapshot = excluded.source_snapshot, source_state = excluded.source_state,
      has_adjustments = coalesce((v_source->>'hasAdjustments')::boolean,
        public.daily_log_summary_sources.has_adjustments),
      adjustment_reason = case when coalesce((v_source->>'hasAdjustments')::boolean,
        public.daily_log_summary_sources.has_adjustments)
        then coalesce(nullif(trim(v_source->>'adjustmentReason'), ''),
          public.daily_log_summary_sources.adjustment_reason) else null end,
      adjusted_by = case when coalesce((v_source->>'hasAdjustments')::boolean, false)
        then v_actor_id::text else public.daily_log_summary_sources.adjusted_by end,
      adjusted_at = case when coalesce((v_source->>'hasAdjustments')::boolean, false)
        then v_now else public.daily_log_summary_sources.adjusted_at end,
      updated_at = excluded.updated_at
    returning id into v_summary_source_id;
    if v_keep_adjusted_card then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'source_changed', 'summarySourceId', v_summary_source_id
      ));
    end if;
  end loop;

  delete from public.daily_log_summary_sources source
  where source.daily_log_id = p_daily_log_id
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) payload
      where payload->>'contributionId' = source.contribution_id::text
    );

  -- Summary detail replacement is source-card scoped. Adjusted cards survive unless refreshSource=true.
  delete from public.daily_log_work_items item
  using public.daily_log_summary_sources source
  where item.daily_log_id = p_daily_log_id and item.summary_source_id = source.id
    and source.daily_log_id = p_daily_log_id
    and (not source.has_adjustments or exists (
      select 1 from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) payload
      where payload->>'contributionId' = source.contribution_id::text
        and coalesce((payload->>'refreshSource')::boolean, false)
    ));

  insert into public.daily_log_work_items (
    daily_log_id, summary_source_id, source_work_item_id, project_id, construction_site_id,
    task_id, work_boq_item_id, work_area_code, work_area_name_snapshot, wbs_code_snapshot,
    task_name_snapshot, unit_snapshot, planned_quantity_snapshot, area_planned_quantity_snapshot,
    baseline_progress_percent, baseline_quantity_done, baseline_progress_row_id, baseline_fingerprint,
    cumulative_progress_percent, cumulative_quantity_done, daily_quantity_done,
    schedule_finish_date_snapshot, forecast_finish_date, forecast_change_reason, note,
    attachments, source_index, updated_at
  )
  select p_daily_log_id, source.id, original.id, original.project_id, original.construction_site_id,
    original.task_id, original.work_boq_item_id, original.work_area_code, original.work_area_name_snapshot,
    original.wbs_code_snapshot, original.task_name_snapshot, original.unit_snapshot,
    original.planned_quantity_snapshot, original.area_planned_quantity_snapshot,
    original.baseline_progress_percent, original.baseline_quantity_done, original.baseline_progress_row_id,
    original.baseline_fingerprint,
    coalesce((payload->>'cumulativeProgressPercent')::numeric, original.cumulative_progress_percent),
    coalesce((payload->>'cumulativeQuantityDone')::numeric, original.cumulative_quantity_done),
    coalesce((payload->>'dailyQuantityDone')::numeric, original.daily_quantity_done),
    original.schedule_finish_date_snapshot,
    coalesce(nullif(payload->>'forecastFinishDate', '')::date, original.forecast_finish_date),
    coalesce(nullif(payload->>'forecastChangeReason', ''), original.forecast_change_reason),
    coalesce(nullif(payload->>'note', ''), original.note), coalesce(payload->'attachments', original.attachments),
    coalesce((payload->>'sourceIndex')::integer, original.source_index), v_now
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) payload
  join public.daily_log_summary_sources source
    on source.daily_log_id = p_daily_log_id
   and (
     (nullif(payload->>'summarySourceId', '') is not null
       and source.id = (payload->>'summarySourceId')::uuid)
     or source.contribution_id = (payload->>'contributionId')::uuid
   )
  join public.daily_log_work_items original
    on original.id = (payload->>'sourceWorkItemId')::uuid
   and original.contribution_id = source.contribution_id
  where not source.has_adjustments
    or not exists (
      select 1 from public.daily_log_work_items kept
      where kept.daily_log_id = p_daily_log_id and kept.summary_source_id = source.id
    )
    or coalesce((
    select (source_payload->>'refreshSource')::boolean
    from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) source_payload
    where source_payload->>'contributionId' = source.contribution_id::text
  ), false);

  if (select count(distinct item->>'taskId') from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item)
    <> (select count(distinct decision->>'taskId') from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) decision)
    or exists (
      select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
      where not exists (
        select 1 from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) decision
        where decision->>'taskId' = item->>'taskId'
      )
    ) then raise exception using errcode = '22023', message = 'ONE_DECISION_PER_TASK_REQUIRED'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) decision
    where (decision->>'aggregationMethod' = 'manual_override'
      or decision->>'dailyQuantityMethod' = 'manual_override')
      and nullif(trim(decision->>'resolutionReason'), '') is null
  ) then raise exception using errcode = '22023', message = 'MANUAL_OVERRIDE_REASON_REQUIRED'; end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) decision
    cross join lateral jsonb_array_elements_text(
      coalesce(decision->'includedSourceWorkItemIds', '[]'::jsonb)
    ) included(work_item_id)
    where not exists (
      select 1 from public.daily_log_work_items item
      where (item.id = included.work_item_id::uuid
          or item.source_work_item_id = included.work_item_id::uuid)
        and item.daily_log_id = p_daily_log_id
        and item.task_id = decision->>'taskId'
    )
  ) then raise exception using errcode = '22023', message = 'DECISION_SOURCE_WORK_ITEM_INVALID'; end if;

  delete from public.daily_log_wbs_decisions decision where decision.daily_log_id = p_daily_log_id;
  insert into public.daily_log_wbs_decisions (
    daily_log_id, task_id, official_cumulative_percent, official_cumulative_quantity,
    official_daily_quantity, forecast_finish_date, aggregation_method, daily_quantity_method,
    included_source_work_item_ids, resolution_reason, forecast_resolution_reason,
    source_fingerprint, updated_at
  ) select p_daily_log_id, decision->>'taskId',
    (decision->>'officialCumulativePercent')::numeric,
    nullif(decision->>'officialCumulativeQuantity', '')::numeric,
    nullif(decision->>'officialDailyQuantity', '')::numeric,
    nullif(decision->>'forecastFinishDate', '')::date, decision->>'aggregationMethod',
    decision->>'dailyQuantityMethod', coalesce(decision->'includedSourceWorkItemIds', '[]'::jsonb),
    nullif(trim(decision->>'resolutionReason'), ''), nullif(trim(decision->>'forecastResolutionReason'), ''),
    md5(concat_ws('|', decision->>'taskId', (decision->'includedSourceWorkItemIds')::text,
      decision->>'officialCumulativePercent', decision->>'officialDailyQuantity')), v_now
  from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) decision;

  -- Resource lines are always rebuilt from physical payload and never copy legacy price columns.
  delete from public.daily_log_labor labor where labor.daily_log_id = p_daily_log_id and labor.resource_semantics_version = 2;
  delete from public.daily_log_machines machine where machine.daily_log_id = p_daily_log_id and machine.resource_semantics_version = 2;

  for v_line in select value from jsonb_array_elements(coalesce(p_labor, '[]'::jsonb))
  loop
    select item.* into v_summary_work_item
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) payload
    join public.daily_log_work_items item
      on item.daily_log_id = p_daily_log_id
     and item.source_work_item_id = (payload->>'sourceWorkItemId')::uuid
    where payload->>'clientKey' = v_line->>'workItemClientKey'
    limit 1;
    if not found then raise exception using errcode = '22023', message = 'WORK_ITEM_CLIENT_KEY_NOT_FOUND'; end if;
    v_provider := null;
    if v_line->'provider'->>'entryMode' = 'catalog' then
      select partner.* into v_provider from public.business_partners partner
      where partner.id = v_line->'provider'->>'partnerId' and partner.is_active;
    end if;
    insert into public.daily_log_labor (
      daily_log_id, construction_site_id, project_id, labor_type, count, hours,
      unit_cost, total_cost, note, source_index, partner_id, partner_name, task_id, task_name,
      daily_log_work_item_id, summary_source_id, source_labor_line_id,
      people_count, hours_per_person, total_labor_hours, provider_entry_mode,
      provider_code_snapshot, provider_name_snapshot, manual_provider_type,
      manual_provider_name, manual_provider_note, resource_semantics_version
    ) values (
      p_daily_log_id, v_log.construction_site_id, v_log.project_id, v_line->>'laborType',
      (v_line->>'peopleCount')::numeric,
      (v_line->>'peopleCount')::numeric * (v_line->>'hoursPerPerson')::numeric,
      null, null, nullif(trim(v_line->>'note'), ''), coalesce((v_line->>'sourceIndex')::integer, 0),
      v_provider.id, v_provider.name, v_summary_work_item.task_id, v_summary_work_item.task_name_snapshot,
      v_summary_work_item.id, v_summary_work_item.summary_source_id,
      nullif(v_line->>'sourceLaborLineId', '')::uuid, (v_line->>'peopleCount')::numeric,
      (v_line->>'hoursPerPerson')::numeric,
      (v_line->>'peopleCount')::numeric * (v_line->>'hoursPerPerson')::numeric,
      v_line->'provider'->>'entryMode', v_provider.code, v_provider.name,
      v_line->'provider'->>'manualProviderType', v_line->'provider'->>'manualProviderName',
      v_line->'provider'->>'manualProviderNote', 2
    );
  end loop;

  for v_line in select value from jsonb_array_elements(coalesce(p_machines, '[]'::jsonb))
  loop
    select item.* into v_summary_work_item
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) payload
    join public.daily_log_work_items item
      on item.daily_log_id = p_daily_log_id
     and item.source_work_item_id = (payload->>'sourceWorkItemId')::uuid
    where payload->>'clientKey' = v_line->>'workItemClientKey'
    limit 1;
    if not found then raise exception using errcode = '22023', message = 'WORK_ITEM_CLIENT_KEY_NOT_FOUND'; end if;
    v_provider := null;
    if v_line->'provider'->>'entryMode' = 'catalog' then
      select partner.* into v_provider from public.business_partners partner
      where partner.id = v_line->'provider'->>'partnerId' and partner.is_active;
    end if;
    insert into public.daily_log_machines (
      daily_log_id, construction_site_id, project_id, machine_name, machine_type, shifts, hours,
      unit_cost, total_cost, note, source_index, partner_id, partner_name, task_id, task_name,
      daily_log_work_item_id, summary_source_id, source_machine_line_id,
      machine_count, hours_per_machine, total_machine_hours, provider_entry_mode,
      provider_code_snapshot, provider_name_snapshot, manual_provider_type,
      manual_provider_name, manual_provider_note, resource_semantics_version
    ) values (
      p_daily_log_id, v_log.construction_site_id, v_log.project_id,
      coalesce(nullif(v_line->>'machineName', ''), v_line->>'machineType'), v_line->>'machineType',
      (v_line->>'machineCount')::numeric,
      (v_line->>'machineCount')::numeric * (v_line->>'hoursPerMachine')::numeric,
      null, null, nullif(trim(v_line->>'note'), ''), coalesce((v_line->>'sourceIndex')::integer, 0),
      v_provider.id, v_provider.name, v_summary_work_item.task_id, v_summary_work_item.task_name_snapshot,
      v_summary_work_item.id, v_summary_work_item.summary_source_id,
      nullif(v_line->>'sourceMachineLineId', '')::uuid, (v_line->>'machineCount')::numeric,
      (v_line->>'hoursPerMachine')::numeric,
      (v_line->>'machineCount')::numeric * (v_line->>'hoursPerMachine')::numeric,
      v_line->'provider'->>'entryMode', v_provider.code, v_provider.name,
      v_line->'provider'->>'manualProviderType', v_line->'provider'->>'manualProviderName',
      v_line->'provider'->>'manualProviderNote', 2
    );
  end loop;

  select md5(coalesce(string_agg(concat_ws('|', decision.task_id,
    decision.source_fingerprint), '||' order by decision.task_id), '')) into v_fingerprint
  from public.daily_log_wbs_decisions decision where decision.daily_log_id = p_daily_log_id;
  update public.daily_logs log set last_action_by = v_actor_id::text, last_action_at = v_now,
    summary_contribution_count = jsonb_array_length(coalesce(p_sources, '[]'::jsonb))
  where log.id = p_daily_log_id;
  return jsonb_build_object('rowVersion', 1, 'updatedAt', v_now,
    'sourceFingerprint', v_fingerprint, 'conflicts', v_conflicts);
end;
$$;

create function public.request_daily_log_summary_source_changes_v1(
  p_daily_log_id text,
  p_summary_source_id uuid,
  p_comment text,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_log public.daily_logs%rowtype;
  v_source public.daily_log_summary_sources%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if nullif(trim(p_comment), '') is null then
    raise exception using errcode = '22023', message = 'SOURCE_CHANGE_COMMENT_REQUIRED';
  end if;
  select log.* into v_log from public.daily_logs log where log.id = p_daily_log_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;
  if not app_private.current_actor_has_effective_room_action(
    v_log.project_id, v_log.construction_site_id, 'daily_log', 'approve'
  ) then raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVE_REQUIRED'; end if;
  if coalesce(v_log.last_action_at, v_log.created_at) is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT';
  end if;
  select source.* into v_source from public.daily_log_summary_sources source
  where source.id = p_summary_source_id and source.daily_log_id = p_daily_log_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SUMMARY_SOURCE_NOT_FOUND'; end if;

  update public.daily_log_summary_sources source set review_status = 'change_requested',
    review_comment = trim(p_comment), reviewed_by = v_actor_id::text,
    reviewed_at = v_now, updated_at = v_now
  where source.id = p_summary_source_id;
  perform public.transition_daily_log_status(
    p_daily_log_id, 'rejected', null, null, trim(p_comment)
  );
  select log.* into v_log from public.daily_logs log where log.id = p_daily_log_id;
  return jsonb_build_object('rowVersion', 1, 'updatedAt', v_log.last_action_at,
    'sourceFingerprint', coalesce(v_source.source_fingerprint, ''), 'conflicts', '[]'::jsonb);
end;
$$;

revoke all on function public.get_daily_log_wbs_bundle_v1(text, text, date, text)
  from public, anon, authenticated;
revoke all on function public.save_daily_log_contribution_work_v1(uuid, bigint, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_daily_log_summary_work_v1(text, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.request_daily_log_summary_source_changes_v1(text, uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.get_daily_log_wbs_bundle_v1(text, text, date, text) to authenticated;
grant execute on function public.save_daily_log_contribution_work_v1(uuid, bigint, text, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.save_daily_log_summary_work_v1(text, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.request_daily_log_summary_source_changes_v1(text, uuid, text, timestamptz) to authenticated;

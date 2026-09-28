-- Pending V2 decisions are drafts, never rows in the official decision table.
-- No legacy row, constraint, applied migration or verified history is rewritten.
create table app_private.daily_log_summary_decision_drafts_v2 (
  daily_log_id text primary key references public.daily_logs(id) on delete cascade,
  decisions jsonb not null check(jsonb_typeof(decisions)='array'),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table app_private.daily_log_summary_decision_drafts_v2 enable row level security;
revoke all on app_private.daily_log_summary_decision_drafts_v2 from public,anon,authenticated;

create function app_private.daily_log_summary_decision_pending_v2(p_log text,p_decision jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare n integer; areas integer; units integer; missing_basis boolean; allocated numeric; whole numeric; forecasts integer;
begin
  select count(*),count(distinct upper(trim(i.work_area_code))),count(distinct nullif(trim(i.unit_snapshot),'')),
    bool_or(i.area_planned_quantity_snapshot is null or i.area_planned_quantity_snapshot<=0),
    sum(i.area_planned_quantity_snapshot),max(i.planned_quantity_snapshot),count(distinct i.forecast_finish_date)
  into n,areas,units,missing_basis,allocated,whole,forecasts
  from public.daily_log_work_items i where i.daily_log_id=p_log and i.task_id=p_decision->>'taskId';
  return coalesce((p_decision->>'pending')::boolean,false)
    or p_decision->>'officialCumulativePercent' is null
    or nullif(p_decision->>'aggregationMethod','') is null or nullif(p_decision->>'dailyQuantityMethod','') is null
    or ((p_decision->>'aggregationMethod'='manual_override' or p_decision->>'dailyQuantityMethod'='manual_override')
      and nullif(trim(p_decision->>'resolutionReason'),'') is null)
    or (n>1 and (missing_basis or areas<n or units<>1 or allocated>whole+0.0001)
      and nullif(trim(p_decision->>'resolutionReason'),'') is null)
    or (forecasts>1 and (p_decision->>'forecastFinishDate' is null
      or nullif(trim(p_decision->>'forecastResolutionReason'),'') is null));
end $$;
revoke all on function app_private.daily_log_summary_decision_pending_v2(text,jsonb) from public,anon,authenticated;

-- Keep the legacy producer verbatim, inaccessible as a public bypass.
alter function public.save_daily_log_summary_work_v1(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb)
  rename to save_daily_log_summary_work_legacy_v1;
alter function public.save_daily_log_summary_work_legacy_v1(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) set schema app_private;
revoke all on function app_private.save_daily_log_summary_work_legacy_v1(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;

-- V2 implementation is appended below. The public signature remains unchanged.
create function app_private.save_daily_log_summary_work_impl_v2(
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
  v_rollout app_private.daily_log_wbs_rollout_scopes%rowtype;
  v_kept_source_ids uuid[] := array[]::uuid[];
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

  if exists(select 1 from jsonb_array_elements(coalesce(p_decisions,'[]'::jsonb)) d
    cross join lateral unnest(array['officialCumulativePercent','officialCumulativeQuantity','officialDailyQuantity']) k
    where d->k is not null and d->k<>'null'::jsonb
      and (jsonb_typeof(d->k)<>'number' or (d->>k)::numeric<0))
    or exists(select 1 from jsonb_array_elements(coalesce(p_decisions,'[]'::jsonb)) d
      where (nullif(d->>'aggregationMethod','') is not null and d->>'aggregationMethod' not in('single_source','weighted_area_allocation','manual_override'))
        or (nullif(d->>'dailyQuantityMethod','') is not null and d->>'dailyQuantityMethod' not in('sum_non_overlapping','keep_selected_sources','manual_override')))
    or exists(select 1 from jsonb_array_elements(coalesce(p_decisions,'[]'::jsonb)) d group by d->>'taskId' having count(*)>1) then
    raise exception using errcode='22023',message='SUMMARY_DECISION_INPUT_INVALID'; end if;

  select log.* into v_log from public.daily_logs log where log.id=p_daily_log_id;
  if public.current_app_user_id() is null or not app_private.current_actor_has_effective_room_action(
    v_log.project_id,v_log.construction_site_id,'daily_log','verify') then
    raise exception using errcode='42501',message='DAILY_LOG_SUMMARIZE_REQUIRED'; end if;
  v_rollout:=app_private.lock_daily_log_rollout_v1(v_log.project_id,v_log.construction_site_id);
  if v_rollout.id is null or v_rollout.mode not in('pilot','enforced') or v_log.date::date<v_rollout.cutover_date then
    raise exception using errcode='42501',message='DAILY_LOG_WBS_ROLLOUT_DISABLED'; end if;
  select log.* into v_log from public.daily_logs log where log.id=p_daily_log_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;
  perform 1 from public.daily_log_summary_sources where daily_log_id=p_daily_log_id order by id for update;
  perform 1 from public.daily_log_contributions c where c.id in(select (x->>'contributionId')::uuid
    from jsonb_array_elements(coalesce(p_sources,'[]'::jsonb)) x) order by c.id for update;
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
      and state.is_locked and ((state.period_type='daily' and state.period_start=v_log.date::date)
        or (state.period_type='weekly' and state.period_start=date_trunc('week',v_log.date::date)::date))
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
      and (v_existing_source.source_version is distinct from v_contribution.row_version
        or v_existing_source.source_fingerprint is distinct from v_contribution.source_fingerprint)
      and not coalesce((v_source->>'refreshSource')::boolean,false);
    if v_keep_adjusted_card then
      v_kept_source_ids:=array_append(v_kept_source_ids,v_existing_source.id);
      update public.daily_log_summary_sources set source_state='changed' where id=v_existing_source.id;
      v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','source_changed','summarySourceId',v_existing_source.id));
      continue;
    end if;

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
      review_status = case when coalesce((v_source->>'refreshSource')::boolean,false)
        then 'ready' else public.daily_log_summary_sources.review_status end,
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
    and not(source.id=any(v_kept_source_ids));

  if exists(select 1 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) payload
    left join public.daily_log_work_items original on original.id=(payload->>'sourceWorkItemId')::uuid
      and original.contribution_id=(payload->>'contributionId')::uuid
    where original.id is null or original.task_id is distinct from payload->>'taskId'
      or original.project_id is distinct from v_log.project_id
      or original.construction_site_id is distinct from v_log.construction_site_id
      or (payload->>'cumulativeProgressPercent')::numeric<original.baseline_progress_percent
      or jsonb_typeof(payload->'cumulativeProgressPercent')<>'number'
      or (nullif(trim(original.unit_snapshot),'') is not null and original.area_planned_quantity_snapshot>0
        and payload->>'cumulativeQuantityDone' is not null
        and abs((payload->>'cumulativeQuantityDone')::numeric-original.area_planned_quantity_snapshot*(payload->>'cumulativeProgressPercent')::numeric/100)>0.0001)
      or (payload->>'forecastFinishDate' is not null
        and (payload->>'forecastFinishDate')::date is distinct from original.schedule_finish_date_snapshot
        and nullif(trim(payload->>'forecastChangeReason'),'') is null)) then
    raise exception using errcode='22023',message='SUMMARY_WORK_ITEM_INPUT_INVALID'; end if;

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
    case when nullif(trim(original.unit_snapshot),'') is not null and original.area_planned_quantity_snapshot>0
      then round(original.area_planned_quantity_snapshot*(payload->>'cumulativeProgressPercent')::numeric/100,4) end,
    case when nullif(trim(original.unit_snapshot),'') is not null and original.area_planned_quantity_snapshot>0
      and original.baseline_quantity_done is not null
      then round(original.area_planned_quantity_snapshot*(payload->>'cumulativeProgressPercent')::numeric/100-original.baseline_quantity_done,4) end,
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
  where not(source.id=any(v_kept_source_ids));

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
  from jsonb_array_elements(coalesce(p_decisions,'[]'::jsonb)) decision
  where not app_private.daily_log_summary_decision_pending_v2(p_daily_log_id,decision);
  insert into app_private.daily_log_summary_decision_drafts_v2(daily_log_id,decisions,updated_by)
    select p_daily_log_id,coalesce(jsonb_agg(decision||jsonb_build_object('pending',true)),'[]'::jsonb),v_actor_id
    from jsonb_array_elements(coalesce(p_decisions,'[]'::jsonb)) decision
    where app_private.daily_log_summary_decision_pending_v2(p_daily_log_id,decision)
    on conflict(daily_log_id) do update set decisions=excluded.decisions,updated_by=excluded.updated_by,updated_at=v_now;

  -- Resource lines are always rebuilt from physical payload and never copy legacy price columns.
  delete from public.daily_log_labor labor where labor.daily_log_id = p_daily_log_id and labor.resource_semantics_version = 2
    and not(labor.summary_source_id=any(v_kept_source_ids));
  delete from public.daily_log_machines machine where machine.daily_log_id = p_daily_log_id and machine.resource_semantics_version = 2
    and not(machine.summary_source_id=any(v_kept_source_ids));

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
    if v_summary_work_item.summary_source_id=any(v_kept_source_ids) then continue; end if;
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
    if v_summary_work_item.summary_source_id=any(v_kept_source_ids) then continue; end if;
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
revoke all on function app_private.save_daily_log_summary_work_impl_v2(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;

create function app_private.save_daily_log_summary_work_dispatch_v2(p_daily_log_id text,p_expected_updated_at timestamptz,
  p_sources jsonb,p_items jsonb,p_decisions jsonb,p_labor jsonb,p_machines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from jsonb_array_elements(coalesce(p_sources,'[]'::jsonb)) x
      join public.daily_log_contributions c on c.id=(x->>'contributionId')::uuid and c.source_document_version=2)
    and not exists(select 1 from app_private.daily_log_summary_decision_drafts_v2 where daily_log_id=p_daily_log_id) then
    return app_private.save_daily_log_summary_work_legacy_v1(p_daily_log_id,p_expected_updated_at,p_sources,p_items,p_decisions,p_labor,p_machines);
  end if;
  begin
    return app_private.save_daily_log_summary_work_impl_v2(p_daily_log_id,p_expected_updated_at,p_sources,p_items,p_decisions,p_labor,p_machines);
  exception when serialization_failure then
    if sqlerrm in('ROW_VERSION_CONFLICT','SOURCE_CHANGED','SOURCE_RETURNED') then
      raise exception using errcode='PT409',message=sqlerrm; end if;
    raise;
  end;
end $$;
revoke all on function app_private.save_daily_log_summary_work_dispatch_v2(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function app_private.save_daily_log_summary_work_dispatch_v2(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;
create function public.save_daily_log_summary_work_v1(p_daily_log_id text,p_expected_updated_at timestamptz,
  p_sources jsonb,p_items jsonb,p_decisions jsonb,p_labor jsonb,p_machines jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.save_daily_log_summary_work_dispatch_v2(p_daily_log_id,p_expected_updated_at,p_sources,p_items,p_decisions,p_labor,p_machines);
$$;
revoke all on function public.save_daily_log_summary_work_v1(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_daily_log_summary_work_v1(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

-- Authorized bundle reads may see pending draft data, never direct private access.
alter function public.get_daily_log_wbs_bundle_v1(text,text,date,text) rename to get_daily_log_wbs_bundle_legacy_v1;
alter function public.get_daily_log_wbs_bundle_legacy_v1(text,text,date,text) set schema app_private;
revoke all on function app_private.get_daily_log_wbs_bundle_legacy_v1(text,text,date,text) from public,anon,authenticated;
create function app_private.get_daily_log_wbs_bundle_draft_v2(p_project_id text,p_construction_site_id text,p_log_date date,p_daily_log_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b jsonb; pending jsonb;
begin
  b:=app_private.get_daily_log_wbs_bundle_legacy_v1(p_project_id,p_construction_site_id,p_log_date,p_daily_log_id);
  select decisions into pending from app_private.daily_log_summary_decision_drafts_v2 where daily_log_id=b->'summaryLog'->>'id';
  if pending is not null then b:=jsonb_set(b,'{decisions}',coalesce(b->'decisions','[]'::jsonb)||pending); end if;
  return b;
end $$;
revoke all on function app_private.get_daily_log_wbs_bundle_draft_v2(text,text,date,text) from public,anon;
grant execute on function app_private.get_daily_log_wbs_bundle_draft_v2(text,text,date,text) to authenticated;
create function public.get_daily_log_wbs_bundle_v1(p_project_id text,p_construction_site_id text,p_log_date date,p_daily_log_id text default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.get_daily_log_wbs_bundle_draft_v2(p_project_id,p_construction_site_id,p_log_date,p_daily_log_id);
$$;
revoke all on function public.get_daily_log_wbs_bundle_v1(text,text,date,text) from public,anon;
grant execute on function public.get_daily_log_wbs_bundle_v1(text,text,date,text) to authenticated;

-- Every existing submit, shadow, publish and revision check calls this guard.
alter function app_private.assert_daily_log_summary_ready_v1(text,boolean) rename to assert_daily_log_summary_ready_legacy_v1;
revoke all on function app_private.assert_daily_log_summary_ready_legacy_v1(text,boolean) from public,anon,authenticated;
create function app_private.assert_daily_log_summary_ready_v1(p_daily_log_id text,p_require_current_sources boolean default true)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from app_private.daily_log_summary_decision_drafts_v2 where daily_log_id=p_daily_log_id and jsonb_array_length(decisions)>0) then
    raise exception using errcode='22023',message='SUMMARY_DECISION_INCOMPLETE'; end if;
  perform app_private.assert_daily_log_summary_ready_legacy_v1(p_daily_log_id,p_require_current_sources);
end $$;
revoke all on function app_private.assert_daily_log_summary_ready_v1(text,boolean) from public,anon,authenticated;

-- V2 submit shares the source-return lock prefix and bounded HTTP conflicts.
alter function public.submit_daily_log_summary_v1(text,timestamptz,uuid,text) rename to submit_daily_log_summary_legacy_v1;
alter function public.submit_daily_log_summary_legacy_v1(text,timestamptz,uuid,text) set schema app_private;
revoke all on function app_private.submit_daily_log_summary_legacy_v1(text,timestamptz,uuid,text) from public,anon,authenticated;
create function app_private.submit_daily_log_summary_draft_v2(p_daily_log_id text,p_expected_updated_at timestamptz,p_approver_user_id uuid,p_submission_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.daily_logs%rowtype;
begin
  if not exists(select 1 from app_private.daily_log_summary_decision_drafts_v2 where daily_log_id=p_daily_log_id) then
    return app_private.submit_daily_log_summary_legacy_v1(p_daily_log_id,p_expected_updated_at,p_approver_user_id,p_submission_note); end if;
  select * into l from public.daily_logs where id=p_daily_log_id;
  if public.current_app_user_id() is null or not app_private.current_actor_has_effective_room_action(l.project_id,l.construction_site_id,'daily_log','submit') then
    raise exception using errcode='42501',message='DAILY_LOG_SUBMIT_REQUIRED'; end if;
  perform app_private.lock_daily_log_rollout_v1(l.project_id,l.construction_site_id);
  perform 1 from public.daily_logs where id=p_daily_log_id for update;
  perform 1 from public.daily_log_summary_sources where daily_log_id=p_daily_log_id order by id for update;
  perform 1 from public.daily_log_contributions where id in(select contribution_id from public.daily_log_summary_sources where daily_log_id=p_daily_log_id) order by id for update;
  begin
    return app_private.submit_daily_log_summary_legacy_v1(p_daily_log_id,p_expected_updated_at,p_approver_user_id,p_submission_note);
  exception when serialization_failure then
    if sqlerrm in('ROW_VERSION_CONFLICT','SUMMARY_SOURCE_REVIEW_BLOCKED') then raise exception using errcode='PT409',message=sqlerrm; end if;
    raise;
  end;
end $$;
revoke all on function app_private.submit_daily_log_summary_draft_v2(text,timestamptz,uuid,text) from public,anon;
grant execute on function app_private.submit_daily_log_summary_draft_v2(text,timestamptz,uuid,text) to authenticated;
create function public.submit_daily_log_summary_v1(p_daily_log_id text,p_expected_updated_at timestamptz,p_approver_user_id uuid,p_submission_note text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.submit_daily_log_summary_draft_v2(p_daily_log_id,p_expected_updated_at,p_approver_user_id,p_submission_note);
$$;
revoke all on function public.submit_daily_log_summary_v1(text,timestamptz,uuid,text) from public,anon;
grant execute on function public.submit_daily_log_summary_v1(text,timestamptz,uuid,text) to authenticated;

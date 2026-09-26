-- Percent-only rows have no quantity basis, including their starting quantity.
-- Preserve applied migrations; fix only the checked V2 save implementation.
create or replace function app_private.save_daily_log_source_document_impl_v2(p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=public.current_app_user_id(); v_source public.daily_log_contributions%rowtype;
  v_rollout app_private.daily_log_wbs_rollout_scopes%rowtype;
  v_task public.project_tasks%rowtype; v_work public.project_work_boq_items%rowtype;
  v_item jsonb; v_line jsonb; v_context jsonb; v_previous jsonb; v_next jsonb;
  v_rows jsonb:='[]'; v_ids jsonb:='{}'; v_provider public.business_partners%rowtype;
  v_id uuid; v_unit text; v_planned numeric; v_area_plan numeric; v_value numeric;
  v_baseline numeric; v_percent numeric; v_cumulative numeric; v_daily numeric; v_known boolean;
  v_area text:=upper(trim(p_input->>'workAreaCode')); v_name text:=trim(p_input->>'workAreaName');
  v_text text; v_now timestamptz:=clock_timestamp(); v_fingerprint text; v_version bigint;
begin
  if v_actor is null then raise exception using errcode='42501',message='DAILY_LOG_SOURCE_SAVE_DENIED'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or p_input->>'contributionId' is null then
    raise exception using errcode='22023',message='DAILY_LOG_SOURCE_INPUT_REQUIRED'; end if;
  -- Check key names throughout the document, never arbitrary words in notes.
  if app_private.daily_log_has_money_fields_v2(p_input) then
    raise exception using errcode='22023',message='RESOURCE_PRICE_FIELDS_NOT_ALLOWED'; end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_typeof(p_input->'photos') is distinct from 'array'
    or jsonb_typeof(p_input->'labor') is distinct from 'array' or jsonb_typeof(p_input->'machines') is distinct from 'array' then
    raise exception using errcode='22023',message='DAILY_LOG_SOURCE_ARRAY_REQUIRED'; end if;
  if jsonb_typeof(p_input->'content') is distinct from 'string' or jsonb_typeof(p_input->'issues') is distinct from 'string'
    or nullif(v_area,'') is null or nullif(v_name,'') is null then
    raise exception using errcode='22023',message='DAILY_LOG_SOURCE_METADATA_REQUIRED'; end if;
  -- Rollout lock precedes source lock. Never lock a summary after its source.
  select * into v_source from public.daily_log_contributions where id=(p_input->>'contributionId')::uuid;
  if not found or v_source.author_user_id is distinct from v_actor::text or v_source.source_document_version<>2
    or not app_private.current_actor_has_effective_room_action(v_source.project_id,v_source.construction_site_id,'daily_log','edit') then
    raise exception using errcode='42501',message='DAILY_LOG_SOURCE_SAVE_DENIED'; end if;
  v_rollout:=app_private.lock_daily_log_rollout_v1(v_source.project_id,v_source.construction_site_id);
  if v_rollout.id is null or v_rollout.mode not in ('pilot','enforced') or v_source.date<v_rollout.cutover_date then
    raise exception using errcode='42501',message='DAILY_LOG_SOURCE_ROLLOUT_DISABLED'; end if;
  perform app_private.assert_project_progress_scope_period(v_source.project_id,v_source.construction_site_id,'daily',v_source.date);
  -- An area's identity is chosen at creation; rename its label, not its scope.
  if v_area is distinct from upper(trim(v_source.work_area_code)) then
    raise exception using errcode='22023',message='DAILY_LOG_SOURCE_AREA_IMMUTABLE'; end if;
  select * into v_source from public.daily_log_contributions where id=v_source.id for update;
  if v_source.author_user_id is distinct from v_actor::text or v_source.status not in ('draft','returned') then
    raise exception using errcode='42501',message='CONTRIBUTION_NOT_EDITABLE'; end if;
  if nullif(p_input->>'expectedRowVersion','') is null or v_source.row_version<>(p_input->>'expectedRowVersion')::bigint then
    raise exception using errcode='40001',message='ROW_VERSION_CONFLICT'; end if;
  if exists(select 1 from public.project_progress_period_states s where s.project_id=v_source.project_id
    and s.construction_site_id is not distinct from v_source.construction_site_id and s.is_locked
    and ((s.period_type='daily' and s.period_start=v_source.date) or
      (s.period_type='weekly' and s.period_start=date_trunc('week',v_source.date)::date))) then
    raise exception using errcode='42501',message='PERIOD_LOCKED'; end if;
  if exists(select 1 from public.daily_log_summary_sources s join public.daily_logs l on l.id=s.daily_log_id
    where s.contribution_id=v_source.id and l.status='verified' and l.superseded_by_daily_log_id is null) then
    raise exception using errcode='42501',message='VERIFIED_SOURCE_IMMUTABLE'; end if;
  if exists(select 1 from jsonb_array_elements(p_input->'items') i where jsonb_typeof(i)<>'object'
    or nullif(trim(i->>'clientKey'),'') is null) or exists(select 1 from jsonb_array_elements(p_input->'items') i
      group by i->>'clientKey' having count(*)>1) or exists(select 1 from jsonb_array_elements(p_input->'items') i
      group by i->>'taskId' having count(*)>1) then
    raise exception using errcode='22023',message='WORK_ITEM_CLIENT_KEY_INVALID'; end if;
  perform app_private.assert_daily_log_wbs_resource_payload_v1(p_input->'labor',p_input->'machines');
  for v_line in select value from jsonb_array_elements(p_input->'labor') union all select value from jsonb_array_elements(p_input->'machines') loop
    if jsonb_typeof(v_line) is distinct from 'object' or not exists(select 1 from jsonb_array_elements(p_input->'items') i
      where i->>'clientKey'=v_line->>'workItemClientKey') then
      raise exception using errcode='22023',message='WORK_ITEM_CLIENT_KEY_NOT_FOUND'; end if;
    if v_line->'provider'->>'entryMode'='manual' and (nullif(v_line->'provider'->>'partnerId','') is not null
      or v_line->'provider'->>'manualProviderType' is null) then
      raise exception using errcode='22023',message='MANUAL_PROVIDER_TYPE_REQUIRED'; end if;
    if v_line->'provider'->>'entryMode'='catalog' and (nullif(v_line->'provider'->>'manualProviderType','') is not null
      or nullif(v_line->'provider'->>'manualProviderName','') is not null or nullif(v_line->'provider'->>'manualProviderNote','') is not null) then
      raise exception using errcode='22023',message='PROVIDER_MODES_CONFLICT'; end if;
  end loop;
  for v_line in select value from jsonb_array_elements(p_input->'labor') loop
    if coalesce(v_line->>'peopleCount','') !~ '^[0-9]+([.][0-9]+)?$' or coalesce(v_line->>'hoursPerPerson','') !~ '^[0-9]+([.][0-9]+)?$'
      or (v_line->>'peopleCount')::numeric<=0 or (v_line->>'hoursPerPerson')::numeric<=0
      or (v_line->'provider'->>'entryMode'='manual' and v_line->'provider'->>'manualProviderType' not in ('free_crew','day_labor','unregistered_provider','other')) then
      raise exception using errcode='22023',message='LABOR_PHYSICAL_USAGE_INVALID'; end if;
  end loop;
  for v_line in select value from jsonb_array_elements(p_input->'machines') loop
    if coalesce(v_line->>'machineCount','') !~ '^[0-9]+([.][0-9]+)?$' or coalesce(v_line->>'hoursPerMachine','') !~ '^[0-9]+([.][0-9]+)?$'
      or (v_line->>'machineCount')::numeric<=0 or (v_line->>'hoursPerMachine')::numeric<=0
      or (v_line->'provider'->>'entryMode'='manual' and v_line->'provider'->>'manualProviderType' not in ('machine_owner','unregistered_rental_provider','other')) then
      raise exception using errcode='22023',message='MACHINE_PHYSICAL_USAGE_INVALID'; end if;
  end loop;
  -- Validate and derive every item before replacing any metadata/resource rows.
  for v_item in select value from jsonb_array_elements(p_input->'items') loop
    select * into v_task from public.project_tasks t where t.id=v_item->>'taskId' and t.project_id=v_source.project_id
      and t.construction_site_id is not distinct from v_source.construction_site_id
      and not exists(select 1 from public.project_tasks child where child.parent_id=t.id);
    if not found then raise exception using errcode='22023',message='LEAF_TASK_REQUIRED'; end if;
    v_work:=null;
    if nullif(v_item->>'workBoqItemId','') is not null then
      select * into v_work from public.project_work_boq_items w where w.id=v_item->>'workBoqItemId' and w.source_task_id=v_task.id
        and w.project_id=v_source.project_id and w.construction_site_id is not distinct from v_source.construction_site_id;
      if not found then raise exception using errcode='22023',message='WORK_BOQ_SCOPE_MISMATCH'; end if;
    end if;
    v_unit:=coalesce(nullif(trim(v_work.unit),''),nullif(trim(v_task.fallback_unit),''));
    v_planned:=coalesce(nullif(v_work.planned_qty,0),nullif(v_task.provisional_quantity,0));
    v_area_plan:=nullif(v_item->>'areaPlannedQuantity','')::numeric;
    if v_area_plan is not null and (v_area_plan<=0 or v_planned is null or v_area_plan>v_planned) then
      raise exception using errcode='22023',message='AREA_PLANNED_QUANTITY_INVALID'; end if;
    v_planned:=coalesce(v_area_plan,v_planned);
    v_context:=app_private.daily_log_quantity_context_v2(v_source.project_id,v_source.construction_site_id,v_source.date,v_area,v_task.id);
    if v_item->>'baselineFingerprint' is distinct from v_context->>'fingerprint' then
      raise exception using errcode='40001',message='SOURCE_CHANGED'; end if;
    v_previous:=v_context->'previousItem'; v_next:=v_context->'nextItem';
    v_known:=v_context->>'state'='known' and (v_previous->>'area_planned_quantity_snapshot')::numeric=v_planned
      and v_previous->>'unit_snapshot'=v_unit;
    v_baseline:=case when v_unit is null or v_planned is null or v_planned<=0 then null
      when v_context->>'state'='none' then 0 when v_known then (v_previous->>'cumulative_quantity_done')::numeric end;
    if coalesce(v_item->>'entryMode','') not in ('daily_quantity','cumulative_quantity','percent') then
      raise exception using errcode='22023',message='DAILY_LOG_ENTRY_MODE_INVALID'; end if;
    if nullif(v_item->>'forecastFinishDate','') is not null and (v_item->>'forecastFinishDate')::date is distinct from nullif(v_task.end_date,'')::date
      and nullif(trim(v_item->>'forecastChangeReason'),'') is null then
      raise exception using errcode='22023',message='FORECAST_CHANGE_REASON_REQUIRED'; end if;
    if v_item ? 'attachments' and jsonb_typeof(v_item->'attachments') is distinct from 'array' then
      raise exception using errcode='22023',message='WORK_ITEM_ATTACHMENTS_ARRAY_REQUIRED'; end if;
    v_text:=nullif(trim(v_item->>'enteredValue'),'');
    -- Retain a safe blank row in the draft payload, not a false normalized zero.
    if v_text is null then continue; end if;
    if v_text !~ '^[+-]?([0-9]+([.,][0-9]*)?|[.,][0-9]+)$' then
      raise exception using errcode='22023',message='DAILY_LOG_ENTRY_NUMBER_REQUIRED'; end if;
    v_value:=replace(v_text,',','.')::numeric;
    if v_value<0 then raise exception using errcode='22023',message='DAILY_LOG_ENTRY_NEGATIVE'; end if;
    v_cumulative:=null; v_daily:=null;
    if v_unit is null or v_planned is null or v_planned<=0 then
      if v_item->>'entryMode'<>'percent' then raise exception using errcode='22023',message='DAILY_LOG_ENTRY_QUANTITY_BASIS_REQUIRED'; end if;
      v_percent:=v_value;
    else
      if v_item->>'entryMode'='daily_quantity' and v_baseline is null then
        raise exception using errcode='22023',message='DAILY_LOG_ENTRY_UNKNOWN_BASELINE'; end if;
      v_cumulative:=case v_item->>'entryMode' when 'daily_quantity' then v_baseline+v_value
        when 'cumulative_quantity' then v_value else v_planned*v_value/100 end;
      v_percent:=v_cumulative*100/v_planned;
      v_daily:=case when v_baseline is not null then v_cumulative-v_baseline end;
      if v_daily<0 then raise exception using errcode='22023',message='PROGRESS_BELOW_BASELINE'; end if;
      if (v_next->>'area_planned_quantity_snapshot')::numeric=v_planned and v_next->>'unit_snapshot'=v_unit
        and v_cumulative>(v_next->>'cumulative_quantity_done')::numeric then
        raise exception using errcode='22023',message='PROGRESS_ABOVE_NEXT_ENTRY'; end if;
    end if;
    if not coalesce((v_context->>'allowOver100')::boolean,false) and v_percent>100 then raise exception using errcode='22023',message='PROGRESS_ABOVE_ALLOWED_MAXIMUM'; end if;
    perform app_private.assert_project_progress_rows(v_source.project_id,v_source.construction_site_id,'daily',
      jsonb_build_array(jsonb_build_object('taskId',v_task.id,'progressPercent',v_percent)));
    v_rows:=v_rows || jsonb_build_array(v_item || jsonb_build_object('unit',v_unit,'plan',v_planned,'baseline',v_baseline,
      'percent',round(v_percent,4),'cumulative',round(v_cumulative,4),'daily',round(v_daily,4),
      'value',v_value,'baselineRowId',v_context->'priorRowId','taskName',v_task.name,'wbsCode',v_task.wbs_code,'schedule',nullif(v_task.end_date,'')));
  end loop;

  delete from public.daily_log_labor where contribution_id=v_source.id;
  delete from public.daily_log_machines where contribution_id=v_source.id;
  delete from public.daily_log_work_items w where w.contribution_id=v_source.id
    and not exists(select 1 from jsonb_array_elements(v_rows) i where i->>'taskId'=w.task_id);
  for v_item in select value from jsonb_array_elements(v_rows) loop
    insert into public.daily_log_work_items(contribution_id,project_id,construction_site_id,task_id,work_boq_item_id,
      work_area_code,work_area_name_snapshot,wbs_code_snapshot,task_name_snapshot,unit_snapshot,planned_quantity_snapshot,
      area_planned_quantity_snapshot,baseline_progress_percent,baseline_quantity_done,baseline_progress_row_id,baseline_fingerprint,
      cumulative_progress_percent,cumulative_quantity_done,daily_quantity_done,schedule_finish_date_snapshot,forecast_finish_date,
      forecast_change_reason,note,attachments,quantity_entry_mode,quantity_entered_value,updated_at)
    values(v_source.id,v_source.project_id,v_source.construction_site_id,v_item->>'taskId',nullif(v_item->>'workBoqItemId',''),
      v_area,v_name,v_item->>'wbsCode',v_item->>'taskName',v_item->>'unit',(v_item->>'plan')::numeric,
      nullif(v_item->>'areaPlannedQuantity','')::numeric,case when v_item->>'baseline' is null then 0
        when (v_item->>'plan')::numeric>0 then (v_item->>'baseline')::numeric*100/(v_item->>'plan')::numeric else 0 end,
      (v_item->>'baseline')::numeric,(v_item->>'baselineRowId')::uuid,v_item->>'baselineFingerprint',(v_item->>'percent')::numeric,
      (v_item->>'cumulative')::numeric,(v_item->>'daily')::numeric,(v_item->>'schedule')::date,
      nullif(v_item->>'forecastFinishDate','')::date,nullif(trim(v_item->>'forecastChangeReason'),''),nullif(trim(v_item->>'note'),''),
      coalesce(v_item->'attachments','[]'::jsonb),v_item->>'entryMode',(v_item->>'value')::numeric,v_now)
    on conflict(contribution_id,task_id) where contribution_id is not null do update set
      work_boq_item_id=excluded.work_boq_item_id,work_area_name_snapshot=excluded.work_area_name_snapshot,
      wbs_code_snapshot=excluded.wbs_code_snapshot,task_name_snapshot=excluded.task_name_snapshot,unit_snapshot=excluded.unit_snapshot,
      planned_quantity_snapshot=excluded.planned_quantity_snapshot,area_planned_quantity_snapshot=excluded.area_planned_quantity_snapshot,
      baseline_progress_percent=excluded.baseline_progress_percent,baseline_quantity_done=excluded.baseline_quantity_done,
      baseline_progress_row_id=excluded.baseline_progress_row_id,baseline_fingerprint=excluded.baseline_fingerprint,
      cumulative_progress_percent=excluded.cumulative_progress_percent,cumulative_quantity_done=excluded.cumulative_quantity_done,
      daily_quantity_done=excluded.daily_quantity_done,schedule_finish_date_snapshot=excluded.schedule_finish_date_snapshot,
      forecast_finish_date=excluded.forecast_finish_date,forecast_change_reason=excluded.forecast_change_reason,note=excluded.note,
      attachments=excluded.attachments,quantity_entry_mode=excluded.quantity_entry_mode,quantity_entered_value=excluded.quantity_entered_value,updated_at=v_now
    returning id into v_id;
    v_ids:=v_ids || jsonb_build_object(v_item->>'clientKey',v_id);
  end loop;
  for v_line in select value from jsonb_array_elements(p_input->'labor') loop
    if not v_ids ? (v_line->>'workItemClientKey') then continue; end if;
    v_provider:=null;
    if v_line->'provider'->>'entryMode'='catalog' then select * into v_provider from public.business_partners where id=v_line->'provider'->>'partnerId'; end if;
    insert into public.daily_log_labor(project_id,construction_site_id,contribution_id,daily_log_work_item_id,task_id,task_name,labor_type,
      count,hours,people_count,hours_per_person,total_labor_hours,provider_entry_mode,partner_id,partner_name,provider_code_snapshot,
      provider_name_snapshot,manual_provider_type,manual_provider_name,manual_provider_note,note,resource_semantics_version)
    select v_source.project_id,v_source.construction_site_id,v_source.id,w.id,w.task_id,w.task_name_snapshot,v_line->>'laborType',
      (v_line->>'peopleCount')::numeric,(v_line->>'peopleCount')::numeric*(v_line->>'hoursPerPerson')::numeric,
      (v_line->>'peopleCount')::numeric,(v_line->>'hoursPerPerson')::numeric,(v_line->>'peopleCount')::numeric*(v_line->>'hoursPerPerson')::numeric,
      v_line->'provider'->>'entryMode',v_provider.id,v_provider.name,v_provider.code,v_provider.name,
      case when v_provider.id is null then v_line->'provider'->>'manualProviderType' end,
      case when v_provider.id is null then trim(v_line->'provider'->>'manualProviderName') end,
      case when v_provider.id is null then v_line->'provider'->>'manualProviderNote' end,v_line->>'note',2
      from public.daily_log_work_items w where w.id=(v_ids->>(v_line->>'workItemClientKey'))::uuid;
  end loop;
  for v_line in select value from jsonb_array_elements(p_input->'machines') loop
    if not v_ids ? (v_line->>'workItemClientKey') then continue; end if;
    v_provider:=null;
    if v_line->'provider'->>'entryMode'='catalog' then select * into v_provider from public.business_partners where id=v_line->'provider'->>'partnerId'; end if;
    insert into public.daily_log_machines(project_id,construction_site_id,contribution_id,daily_log_work_item_id,task_id,task_name,machine_name,
      machine_type,shifts,hours,machine_count,hours_per_machine,total_machine_hours,provider_entry_mode,partner_id,partner_name,provider_code_snapshot,
      provider_name_snapshot,manual_provider_type,manual_provider_name,manual_provider_note,note,resource_semantics_version)
    select v_source.project_id,v_source.construction_site_id,v_source.id,w.id,w.task_id,w.task_name_snapshot,coalesce(v_line->>'machineName',v_line->>'machineType'),
      v_line->>'machineType',(v_line->>'machineCount')::numeric,(v_line->>'machineCount')::numeric*(v_line->>'hoursPerMachine')::numeric,
      (v_line->>'machineCount')::numeric,(v_line->>'hoursPerMachine')::numeric,(v_line->>'machineCount')::numeric*(v_line->>'hoursPerMachine')::numeric,
      v_line->'provider'->>'entryMode',v_provider.id,v_provider.name,v_provider.code,v_provider.name,
      case when v_provider.id is null then v_line->'provider'->>'manualProviderType' end,
      case when v_provider.id is null then trim(v_line->'provider'->>'manualProviderName') end,
      case when v_provider.id is null then v_line->'provider'->>'manualProviderNote' end,v_line->>'note',2
      from public.daily_log_work_items w where w.id=(v_ids->>(v_line->>'workItemClientKey'))::uuid;
  end loop;
  v_fingerprint:=md5(jsonb_build_object('source',v_source.id,'payload',p_input-'expectedRowVersion','derived',v_rows)::text);
  update public.daily_log_contributions set content=p_input->>'content',issues=p_input->>'issues',photos=p_input->'photos',
    work_area_name=v_name,source_draft_payload=(p_input-'expectedRowVersion'-'contributionId') || jsonb_build_object('savedRowVersion',row_version+1),row_version=row_version+1,
    source_fingerprint=v_fingerprint,last_action_by=v_actor::text,last_action_at=v_now,updated_at=v_now where id=v_source.id returning row_version into v_version;
  return jsonb_build_object('rowVersion',v_version,'updatedAt',v_now,'sourceFingerprint',v_fingerprint,'conflicts','[]'::jsonb);
end $$;

notify pgrst, 'reload schema';

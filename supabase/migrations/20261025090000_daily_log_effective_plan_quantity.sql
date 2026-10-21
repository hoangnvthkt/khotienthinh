-- Nhật ký: quy đổi % ↔ khối lượng theo cơ sở quy đổi thực của phiếu (chủ SP duyệt 21/10/2026).
-- planned_quantity_snapshot của dòng phiếu kỹ sư đã là cơ sở quy đổi (khối lượng mũi nếu đã chia, không thì khối lượng
-- hạng mục). Trước đây bản tổng hợp và bước tra lũy kế ngày trước chỉ quy đổi khi có khối lượng mũi
-- (area_planned_quantity_snapshot) — trên prod chưa mũi nào chia — nên bản tổng hợp mất m³ (49/49 dòng từ 09/10) và
-- ngày sau luôn "Chưa xác định khối lượng trước ngày này".

create or replace function app_private.daily_log_quantity_context_v2(p_project text, p_site text, p_date date, p_area text, p_task text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prior public.project_daily_task_progress%rowtype;
  v_next public.project_daily_task_progress%rowtype;
  v_before jsonb; v_after jsonb; v_items_before jsonb; v_items_after jsonb; v_plan jsonb; v_state text; v_fingerprint text; v_allow_over boolean:=false;
begin
  select * into v_prior from public.project_daily_task_progress p where p.project_id=p_project
    and p.construction_site_id is not distinct from p_site and p.task_id=p_task and p.progress_date<p_date
    order by p.progress_date desc,p.updated_at desc,p.id limit 1;
  select * into v_next from public.project_daily_task_progress p where p.project_id=p_project
    and p.construction_site_id is not distinct from p_site and p.task_id=p_task and p.progress_date>p_date
    order by p.progress_date,p.updated_at desc,p.id limit 1;
  select jsonb_agg(to_jsonb(i) order by i.id) into v_before from public.daily_log_work_items i
    join public.daily_logs l on l.id=i.daily_log_id
    join public.daily_log_summary_sources s on s.id=i.summary_source_id and s.daily_log_id=l.id and s.review_status='accepted'
    join public.daily_log_wbs_decisions d on d.daily_log_id=l.id and d.task_id=i.task_id
      and d.included_source_work_item_ids @> jsonb_build_array(i.id::text)
    where l.id=v_prior.source_daily_log_id
      and l.status='verified' and l.superseded_by_daily_log_id is null and l.project_id=p_project
      and l.construction_site_id is not distinct from p_site and i.task_id=p_task
      and i.project_id=p_project and i.construction_site_id is not distinct from p_site
      and upper(trim(i.work_area_code))=upper(trim(p_area));
  select jsonb_agg(to_jsonb(i) order by i.id) into v_after from public.daily_log_work_items i
    join public.daily_logs l on l.id=i.daily_log_id
    join public.daily_log_summary_sources s on s.id=i.summary_source_id and s.daily_log_id=l.id and s.review_status='accepted'
    join public.daily_log_wbs_decisions d on d.daily_log_id=l.id and d.task_id=i.task_id
      and d.included_source_work_item_ids @> jsonb_build_array(i.id::text)
    where l.id=v_next.source_daily_log_id
      and l.status='verified' and l.superseded_by_daily_log_id is null and l.project_id=p_project
      and l.construction_site_id is not distinct from p_site and i.task_id=p_task
      and i.project_id=p_project and i.construction_site_id is not distinct from p_site
      and upper(trim(i.work_area_code))=upper(trim(p_area));
  -- Dòng bản tổng hợp ngày trước / sau dùng để biết lũy kế khối lượng. Quyết định lưu id dòng phiếu nguồn
  -- (source_work_item_id) nên phải khớp cả hai; v_before / v_after giữ cách khớp cũ chỉ để dấu vân tay không đổi.
  select jsonb_agg(to_jsonb(i) order by i.id) into v_items_before from public.daily_log_work_items i
    join public.daily_logs l on l.id=i.daily_log_id
    join public.daily_log_summary_sources s on s.id=i.summary_source_id and s.daily_log_id=l.id and s.review_status='accepted'
    join public.daily_log_wbs_decisions d on d.daily_log_id=l.id and d.task_id=i.task_id
      and (d.included_source_work_item_ids @> jsonb_build_array(i.id::text)
        or d.included_source_work_item_ids @> jsonb_build_array(i.source_work_item_id::text))
    where l.id=v_prior.source_daily_log_id
      and l.status='verified' and l.superseded_by_daily_log_id is null and l.project_id=p_project
      and l.construction_site_id is not distinct from p_site and i.task_id=p_task
      and i.project_id=p_project and i.construction_site_id is not distinct from p_site
      and upper(trim(i.work_area_code))=upper(trim(p_area));
  select jsonb_agg(to_jsonb(i) order by i.id) into v_items_after from public.daily_log_work_items i
    join public.daily_logs l on l.id=i.daily_log_id
    join public.daily_log_summary_sources s on s.id=i.summary_source_id and s.daily_log_id=l.id and s.review_status='accepted'
    join public.daily_log_wbs_decisions d on d.daily_log_id=l.id and d.task_id=i.task_id
      and (d.included_source_work_item_ids @> jsonb_build_array(i.id::text)
        or d.included_source_work_item_ids @> jsonb_build_array(i.source_work_item_id::text))
    where l.id=v_next.source_daily_log_id
      and l.status='verified' and l.superseded_by_daily_log_id is null and l.project_id=p_project
      and l.construction_site_id is not distinct from p_site and i.task_id=p_task
      and i.project_id=p_project and i.construction_site_id is not distinct from p_site
      and upper(trim(i.work_area_code))=upper(trim(p_area));
  select jsonb_build_object('task',to_jsonb(t)-array['progress','progress_mode','row_version','actual_start_date','actual_end_date','updated_at'],'work',coalesce((select jsonb_agg(to_jsonb(w) order by w.id)
    from public.project_work_boq_items w where w.source_task_id=t.id and w.project_id=p_project
      and w.construction_site_id is not distinct from p_site),'[]'::jsonb)) into v_plan
    from public.project_tasks t where t.id=p_task and t.project_id=p_project and t.construction_site_id is not distinct from p_site;
  v_state:=case when v_prior.id is null then 'none'
    when v_prior.quantity_done is not null and jsonb_array_length(v_items_before)=1
      and (v_items_before->0->>'planned_quantity_snapshot')::numeric>0
      and nullif(trim(v_items_before->0->>'unit_snapshot'),'') is not null
      and v_items_before->0->>'cumulative_quantity_done' is not null then 'known' else 'unknown' end;
  -- Ask the existing canonical rule; do not invent a task-level allow flag.
  begin
    perform app_private.assert_project_progress_rows(p_project,p_site,'daily',
      jsonb_build_array(jsonb_build_object('taskId',p_task,'progressPercent',101)));
    v_allow_over:=true;
  exception when check_violation or invalid_parameter_value then v_allow_over:=false;
  end;
  v_fingerprint:=md5(jsonb_build_object('project',p_project,'site',p_site,'date',p_date,'area',upper(trim(p_area)),
    'task',p_task,'allowOver100',v_allow_over,'plan',v_plan,'prior',to_jsonb(v_prior),'next',to_jsonb(v_next),'before',v_before,'after',v_after)::text);
  return jsonb_build_object('state',v_state,'fingerprint',v_fingerprint,'allowOver100',v_allow_over,'previousItem',case when v_state='known' then v_items_before->0 end,
    'nextItem',case when jsonb_array_length(v_items_after)=1 then v_items_after->0 end,'priorRowId',v_prior.id);
end $function$;

create or replace function app_private.save_daily_log_source_document_impl_v2(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception using errcode='PT409',message='ROW_VERSION_CONFLICT'; end if;
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
      raise exception using errcode='PT409',message='SOURCE_CHANGED'; end if;
    v_previous:=v_context->'previousItem'; v_next:=v_context->'nextItem';
    v_known:=v_context->>'state'='known' and (v_previous->>'planned_quantity_snapshot')::numeric=v_planned
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
      if (v_next->>'planned_quantity_snapshot')::numeric=v_planned and v_next->>'unit_snapshot'=v_unit
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
      provider_name_snapshot,manual_provider_type,manual_provider_name,manual_provider_note,note,resource_semantics_version,contract_item_id)
    select v_source.project_id,v_source.construction_site_id,v_source.id,w.id,w.task_id,w.task_name_snapshot,v_line->>'laborType',
      (v_line->>'peopleCount')::numeric,(v_line->>'peopleCount')::numeric*(v_line->>'hoursPerPerson')::numeric,
      (v_line->>'peopleCount')::numeric,(v_line->>'hoursPerPerson')::numeric,(v_line->>'peopleCount')::numeric*(v_line->>'hoursPerPerson')::numeric,
      v_line->'provider'->>'entryMode',v_provider.id,v_provider.name,v_provider.code,v_provider.name,
      case when v_provider.id is null then v_line->'provider'->>'manualProviderType' end,
      case when v_provider.id is null then trim(v_line->'provider'->>'manualProviderName') end,
      case when v_provider.id is null then v_line->'provider'->>'manualProviderNote' end,v_line->>'note',2,
      case when v_provider.id is not null then nullif(v_line->>'contractItemId','')::uuid end
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
end $function$;

create or replace function app_private.save_daily_log_summary_work_impl_v2(p_daily_log_id text, p_expected_updated_at timestamp with time zone, p_sources jsonb, p_items jsonb, p_decisions jsonb, p_labor jsonb, p_machines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT';
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
    if v_contribution.status = 'returned' then raise exception using errcode = 'PT409', message = 'SOURCE_RETURNED'; end if;
    if v_contribution.status not in ('submitted', 'included') then
      raise exception using errcode = '22023', message = 'SUMMARY_SOURCE_NOT_SUBMITTED';
    end if;
    if coalesce((v_source->>'sourceVersion')::bigint, 0) <> v_contribution.row_version
      or coalesce(v_source->>'sourceFingerprint', '') <> coalesce(v_contribution.source_fingerprint, '') then
      raise exception using errcode = 'PT409', message = 'SOURCE_CHANGED';
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
        'updatedAt', v_contribution.updated_at,
        'content', v_contribution.content, 'issues', v_contribution.issues,
        'photos', v_contribution.photos, 'authorName', v_contribution.author_name,
        'date', v_contribution.date
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
      or (nullif(trim(original.unit_snapshot),'') is not null and original.planned_quantity_snapshot>0
        and payload->>'cumulativeQuantityDone' is not null
        and abs((payload->>'cumulativeQuantityDone')::numeric-original.planned_quantity_snapshot*(payload->>'cumulativeProgressPercent')::numeric/100)>0.0001)
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
    case when nullif(trim(original.unit_snapshot),'') is not null and original.planned_quantity_snapshot>0
      then round(original.planned_quantity_snapshot*(payload->>'cumulativeProgressPercent')::numeric/100,4) end,
    case when nullif(trim(original.unit_snapshot),'') is not null and original.planned_quantity_snapshot>0
      and original.baseline_quantity_done is not null
      then round(original.planned_quantity_snapshot*(payload->>'cumulativeProgressPercent')::numeric/100-original.baseline_quantity_done,4) end,
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
$function$;

-- Bù khối lượng lũy kế cho dòng đã duyệt chỉ có %: khối lượng = cơ sở quy đổi × % (không đổi %, không đổi trạng thái).
-- Bỏ qua hạng mục đang có phiếu / bản tổng hợp chờ duyệt còn khớp mốc — bù vào sẽ làm các phiếu đó phải lập lại.
create temp table delay_qty_protected_tasks on commit drop as
select distinct i.task_id
from public.daily_log_work_items i
left join public.daily_log_contributions c on c.id = i.contribution_id
left join public.daily_logs l on l.id = i.daily_log_id
where ((c.id is not null and c.status in ('draft', 'submitted', 'returned') and c.source_document_version = 2)
    or (l.id is not null and l.status in ('draft', 'submitted', 'rejected')))
  and i.baseline_fingerprint = (app_private.daily_log_quantity_context_v2(i.project_id, i.construction_site_id,
    coalesce(c.date, l.date::date), i.work_area_code, i.task_id)->>'fingerprint');

update public.daily_log_work_items item
set cumulative_quantity_done = round(item.planned_quantity_snapshot * item.cumulative_progress_percent / 100, 4)
from public.daily_logs log
where log.id = item.daily_log_id and log.status = 'verified'
  and item.cumulative_quantity_done is null and item.cumulative_progress_percent is not null
  and item.planned_quantity_snapshot > 0 and nullif(trim(item.unit_snapshot), '') is not null
  and item.task_id not in (select task_id from delay_qty_protected_tasks);

update public.daily_log_wbs_decisions decision
set official_cumulative_quantity = totals.quantity
from (
  select item.daily_log_id, item.task_id, sum(item.cumulative_quantity_done) as quantity
  from public.daily_log_work_items item
  join public.daily_logs log on log.id = item.daily_log_id and log.status = 'verified'
  group by item.daily_log_id, item.task_id
  having count(*) = 1 and bool_and(item.cumulative_quantity_done is not null)
) totals
where decision.daily_log_id = totals.daily_log_id and decision.task_id = totals.task_id
  and decision.official_cumulative_quantity is null
  and decision.task_id not in (select task_id from delay_qty_protected_tasks);

update public.project_daily_task_progress progress
set quantity_done = decision.official_cumulative_quantity
from public.daily_log_wbs_decisions decision
where progress.source_daily_log_id = decision.daily_log_id and progress.task_id = decision.task_id
  and progress.quantity_done is null and decision.official_cumulative_quantity is not null
  and progress.task_id not in (select task_id from delay_qty_protected_tasks);

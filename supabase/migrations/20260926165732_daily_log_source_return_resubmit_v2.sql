-- V2 slip lifecycle only. No historical reclassification or snapshot rewrites.
-- A receipt is usable as trigger authority only in the transaction that made it.
alter table app_private.daily_log_source_command_receipts add column database_transaction_id xid8;

-- Publication changes derived task progress, not the area's quantity basis.
-- Plan/scope/unit/schedule changes still invalidate the opaque baseline token.
create or replace function app_private.daily_log_quantity_context_v2(p_project text,p_site text,p_date date,p_area text,p_task text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_prior public.project_daily_task_progress%rowtype;
  v_next public.project_daily_task_progress%rowtype;
  v_before jsonb; v_after jsonb; v_plan jsonb; v_state text; v_fingerprint text; v_allow_over boolean:=false;
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
  select jsonb_build_object('task',to_jsonb(t)-array['progress','progress_mode','row_version','actual_start_date','actual_end_date','updated_at'],'work',coalesce((select jsonb_agg(to_jsonb(w) order by w.id)
    from public.project_work_boq_items w where w.source_task_id=t.id and w.project_id=p_project
      and w.construction_site_id is not distinct from p_site),'[]'::jsonb)) into v_plan
    from public.project_tasks t where t.id=p_task and t.project_id=p_project and t.construction_site_id is not distinct from p_site;
  v_state:=case when v_prior.id is null then 'none'
    when v_prior.quantity_done is not null and jsonb_array_length(v_before)=1
      and (v_before->0->>'area_planned_quantity_snapshot')::numeric>0
      and nullif(trim(v_before->0->>'unit_snapshot'),'') is not null
      and v_before->0->>'cumulative_quantity_done' is not null then 'known' else 'unknown' end;
  -- Ask the existing canonical rule; do not invent a task-level allow flag.
  begin
    perform app_private.assert_project_progress_rows(p_project,p_site,'daily',
      jsonb_build_array(jsonb_build_object('taskId',p_task,'progressPercent',101)));
    v_allow_over:=true;
  exception when check_violation or invalid_parameter_value then v_allow_over:=false;
  end;
  v_fingerprint:=md5(jsonb_build_object('project',p_project,'site',p_site,'date',p_date,'area',upper(trim(p_area)),
    'task',p_task,'allowOver100',v_allow_over,'plan',v_plan,'prior',to_jsonb(v_prior),'next',to_jsonb(v_next),'before',v_before,'after',v_after)::text);
  return jsonb_build_object('state',v_state,'fingerprint',v_fingerprint,'allowOver100',v_allow_over,'previousItem',case when v_state='known' then v_before->0 end,
    'nextItem',case when jsonb_array_length(v_after)=1 then v_after->0 end,'priorRowId',v_prior.id);
end $$;

create function app_private.daily_log_source_transition_allowed_v2(p_old public.daily_log_contributions,p_new public.daily_log_contributions)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare r app_private.daily_log_source_command_receipts%rowtype; fields text[];
begin
  if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class
    where oid='public.daily_log_contributions'::regclass)) then return false; end if;
  if p_old.source_document_version<>2 or p_new.row_version<>p_old.row_version+1 then return false; end if;
  select * into r from app_private.daily_log_source_command_receipts
    where database_transaction_id=pg_current_xact_id() and actor_id=public.current_app_user_id()
      and receipt->>'contributionId'=p_old.id::text and receipt->>'status'=p_new.status
      and (receipt->>'rowVersion')::bigint=p_new.row_version and operation in ('return','submit');
  if not found or p_new.last_action_by is distinct from r.actor_id::text then return false; end if;
  fields:=array['status','row_version','last_action_by','last_action_at','updated_at'];
  if r.operation='return' then
    if p_old.status not in ('submitted','included') or p_new.status<>'returned'
      or p_new.returned_by is distinct from r.actor_id::text or nullif(trim(p_new.return_reason),'') is null then return false; end if;
    fields:=fields||array['returned_by','returned_by_name','returned_at','return_reason'];
  else
    if p_old.status not in ('draft','returned') or p_new.status<>'submitted'
      or p_old.author_user_id is distinct from r.actor_id::text then return false; end if;
    fields:=fields||array['submitted_at'];
  end if;
  return (to_jsonb(p_new)-fields)=(to_jsonb(p_old)-fields);
end $$;
revoke all on function app_private.daily_log_source_transition_allowed_v2(public.daily_log_contributions,public.daily_log_contributions) from public,anon;
grant execute on function app_private.daily_log_source_transition_allowed_v2(public.daily_log_contributions,public.daily_log_contributions) to authenticated;

create function app_private.daily_log_source_publication_allowed_v2(p_old public.daily_log_contributions,p_new public.daily_log_contributions)
returns boolean language plpgsql stable security invoker set search_path='' as $$
begin
  if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class
    where oid='public.daily_log_contributions'::regclass)) then return false; end if;
  return p_old.source_document_version=2 and p_old.status in ('submitted','included') and p_new.status='included'
    and p_new.daily_log_id=p_new.included_in_daily_log_id and p_new.included_by=public.current_app_user_id()::text
    and (to_jsonb(p_new)-array['status','daily_log_id','included_in_daily_log_id','included_by','included_at','last_action_by','last_action_at','updated_at'])
      =(to_jsonb(p_old)-array['status','daily_log_id','included_in_daily_log_id','included_by','included_at','last_action_by','last_action_at','updated_at'])
    and app_private.current_actor_has_effective_room_action(p_old.project_id,p_old.construction_site_id,'daily_log','approve')
    and app_private.current_actor_has_effective_room_action(p_old.project_id,p_old.construction_site_id,'daily_log','publish_progress')
    and exists(select 1 from public.daily_logs l join public.daily_log_summary_sources s on s.daily_log_id=l.id
      where l.id=p_new.daily_log_id and l.status='verified' and l.superseded_by_daily_log_id is null
        and l.summary_source_type='member_contributions' and l.project_id=p_old.project_id
        and l.construction_site_id is not distinct from p_old.construction_site_id and l.date::date=p_old.date
        and s.contribution_id=p_old.id and s.review_status='accepted' and s.source_state='current'
        and s.source_version=p_old.row_version and s.source_fingerprint=p_old.source_fingerprint
        and exists(select 1 from public.daily_log_work_items w where w.summary_source_id=s.id and w.daily_log_id=l.id));
end $$;
revoke all on function app_private.daily_log_source_publication_allowed_v2(public.daily_log_contributions,public.daily_log_contributions) from public,anon;
grant execute on function app_private.daily_log_source_publication_allowed_v2(public.daily_log_contributions,public.daily_log_contributions) to authenticated;

create function app_private.guard_daily_log_source_status_v2() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.source_document_version=2 and new.status is distinct from old.status
    and not coalesce(app_private.daily_log_source_transition_allowed_v2(old,new),false)
    and not coalesce(app_private.daily_log_source_publication_allowed_v2(old,new),false) then
    raise exception using errcode='42501',message='DAILY_LOG_SOURCE_TRANSITION_COMMAND_REQUIRED';
  end if;
  return new;
end $$;
revoke all on function app_private.guard_daily_log_source_status_v2() from public,anon,authenticated;
create trigger guard_daily_log_source_status_v2 before update on public.daily_log_contributions
  for each row execute function app_private.guard_daily_log_source_status_v2();
drop trigger trg_daily_log_contributions_transition_guard on public.daily_log_contributions;
create trigger trg_daily_log_contributions_transition_guard before update on public.daily_log_contributions for each row
  when (not coalesce(app_private.daily_log_returned_source_save_allowed_v2(old.author_user_id,old.source_document_version,
    old.status,new.status,old.row_version,new.row_version,old.source_draft_payload,new.source_draft_payload),false)
    and not coalesce(app_private.daily_log_source_transition_allowed_v2(old,new),false))
  execute function app_private.daily_log_contribution_transition_guard();

-- Only this checked return may reject a pending summary on a summarizer's verify
-- authority. Keep both original log guard bodies unchanged for every other path.
create function app_private.daily_log_source_return_summary_allowed_v2(p_old public.daily_logs,p_new public.daily_logs)
returns boolean language plpgsql stable security invoker set search_path='' as $$
begin
  if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class
    where oid='public.daily_logs'::regclass)) then return false; end if;
  return p_old.summary_source_type='member_contributions' and p_old.status in ('draft','submitted','rejected')
    and p_old.superseded_by_daily_log_id is null and p_new.status='rejected' and not p_new.verified
    and p_new.rejected_by_id=public.current_app_user_id()::text and nullif(trim(p_new.rejection_reason),'') is not null
    and (to_jsonb(p_new)-array['status','verified','rejected_by','rejected_by_id','rejected_at','rejection_reason',
      'last_action_by','last_action_at','submitted_to_user_id','submitted_to_name','submitted_to_permission','submission_note','ever_submitted'])
      =(to_jsonb(p_old)-array['status','verified','rejected_by','rejected_by_id','rejected_at','rejection_reason',
      'last_action_by','last_action_at','submitted_to_user_id','submitted_to_name','submitted_to_permission','submission_note','ever_submitted'])
    and exists(select 1 from app_private.daily_log_source_command_receipts r
      join public.daily_log_contributions c on c.id=(r.receipt->>'contributionId')::uuid
      join public.daily_log_summary_sources s on s.contribution_id=c.id and s.daily_log_id=p_old.id
      where r.database_transaction_id=pg_current_xact_id() and r.operation='return' and r.actor_id=public.current_app_user_id()
        and r.receipt->>'dailyLogId'=p_old.id and (r.receipt->>'summaryUpdatedAt')::timestamptz=p_new.last_action_at
        and c.source_document_version=2 and c.status='returned' and s.review_status='change_requested'
        and s.review_comment=p_new.rejection_reason);
end $$;
revoke all on function app_private.daily_log_source_return_summary_allowed_v2(public.daily_logs,public.daily_logs) from public,anon;
grant execute on function app_private.daily_log_source_return_summary_allowed_v2(public.daily_logs,public.daily_logs) to authenticated;
drop trigger guard_daily_log_direct_status_update on public.daily_logs;
create trigger guard_daily_log_direct_status_update before update on public.daily_logs for each row
  when (not coalesce(app_private.daily_log_source_return_summary_allowed_v2(old,new),false))
  execute function app_private.guard_daily_log_direct_status_update();
drop trigger trg_enforce_daily_log_room_status on public.daily_logs;
create trigger trg_enforce_daily_log_room_status before update of status,submitted_to_user_id,submitted_to_permission on public.daily_logs for each row
  when (not coalesce(app_private.daily_log_source_return_summary_allowed_v2(old,new),false))
  execute function app_private.enforce_daily_log_room_status();

create function app_private.assert_daily_log_source_ready_v2(p_source public.daily_log_contributions) returns void
language plpgsql security invoker set search_path='' as $$
declare payload jsonb:=p_source.source_draft_payload; item jsonb; w public.daily_log_work_items%rowtype; context jsonb;
  rows jsonb:='[]'::jsonb; expected_fingerprint text;
begin
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items')=0
    or jsonb_array_length(payload->'items')<>(select count(*) from public.daily_log_work_items where contribution_id=p_source.id)
    or p_source.content is distinct from payload->>'content' or p_source.issues is distinct from payload->>'issues'
    or p_source.photos is distinct from payload->'photos' then
    raise exception using errcode='22023',message='DAILY_LOG_SOURCE_NOT_COMPLETE'; end if;
  perform app_private.assert_daily_log_wbs_resource_payload_v1(payload->'labor',payload->'machines');
  for item in select value from jsonb_array_elements(payload->'items') loop
    if nullif(trim(item->>'enteredValue'),'') is null then raise exception using errcode='22023',message='DAILY_LOG_SOURCE_NOT_COMPLETE'; end if;
    select * into w from public.daily_log_work_items where contribution_id=p_source.id and task_id=item->>'taskId';
    if not found or w.quantity_entry_mode is distinct from item->>'entryMode'
      or w.quantity_entered_value is distinct from replace(item->>'enteredValue',',','.')::numeric then
      raise exception using errcode='22023',message='DAILY_LOG_SOURCE_NOT_COMPLETE'; end if;
    if w.project_id is distinct from p_source.project_id or w.construction_site_id is distinct from p_source.construction_site_id
      or w.work_area_code is distinct from p_source.work_area_code or w.work_area_name_snapshot is distinct from p_source.work_area_name
      or w.work_boq_item_id is distinct from nullif(item->>'workBoqItemId','')
      or w.area_planned_quantity_snapshot is distinct from nullif(item->>'areaPlannedQuantity','')::numeric then
      raise exception using errcode='PT409',message='SOURCE_CHANGED'; end if;
    context:=app_private.daily_log_quantity_context_v2(p_source.project_id,p_source.construction_site_id,p_source.date,p_source.work_area_code,w.task_id);
    if w.baseline_fingerprint is distinct from context->>'fingerprint' then
      raise exception using errcode='PT409',message='SOURCE_CHANGED'; end if;
    if w.forecast_finish_date is distinct from w.schedule_finish_date_snapshot and nullif(trim(w.forecast_change_reason),'') is null then
      raise exception using errcode='22023',message='FORECAST_CHANGE_REASON_REQUIRED'; end if;
    rows:=rows||jsonb_build_array(item||jsonb_build_object('unit',w.unit_snapshot,'plan',w.planned_quantity_snapshot,
      'baseline',w.baseline_quantity_done,'percent',w.cumulative_progress_percent,'cumulative',w.cumulative_quantity_done,
      'daily',w.daily_quantity_done,'value',w.quantity_entered_value,'baselineRowId',w.baseline_progress_row_id,
      'taskName',w.task_name_snapshot,'wbsCode',w.wbs_code_snapshot,'schedule',w.schedule_finish_date_snapshot));
    if w.forecast_finish_date is distinct from nullif(item->>'forecastFinishDate','')::date
      or w.forecast_change_reason is distinct from nullif(trim(item->>'forecastChangeReason'),'')
      or w.note is distinct from nullif(trim(item->>'note'),'') or w.attachments is distinct from coalesce(item->'attachments','[]'::jsonb) then
      raise exception using errcode='PT409',message='SOURCE_CHANGED'; end if;
  end loop;
  expected_fingerprint:=md5(jsonb_build_object('source',p_source.id,
    'payload',(payload-'savedRowVersion')||jsonb_build_object('contributionId',p_source.id),'derived',rows)::text);
  if p_source.source_fingerprint is distinct from expected_fingerprint then raise exception using errcode='PT409',message='SOURCE_CHANGED'; end if;
  -- Multisets, not existential matches: duplicated resource lines must match too.
  if exists(
    (select jsonb_build_array(i->>'taskId',r->>'laborType',(r->>'peopleCount')::numeric,(r->>'hoursPerPerson')::numeric,
       r->'provider'->>'entryMode',nullif(r->'provider'->>'partnerId',''),r->'provider'->>'manualProviderType',
       trim(r->'provider'->>'manualProviderName'),r->'provider'->>'manualProviderNote',r->>'note')
     from jsonb_array_elements(payload->'labor') r join jsonb_array_elements(payload->'items') i on i->>'clientKey'=r->>'workItemClientKey'
     except all
     select jsonb_build_array(task_id,labor_type,people_count,hours_per_person,provider_entry_mode,partner_id,
       manual_provider_type,manual_provider_name,manual_provider_note,note) from public.daily_log_labor where contribution_id=p_source.id)
    union all
    (select jsonb_build_array(i->>'taskId',coalesce(r->>'machineName',r->>'machineType'),r->>'machineType',(r->>'machineCount')::numeric,
       (r->>'hoursPerMachine')::numeric,r->'provider'->>'entryMode',nullif(r->'provider'->>'partnerId',''),r->'provider'->>'manualProviderType',
       trim(r->'provider'->>'manualProviderName'),r->'provider'->>'manualProviderNote',r->>'note')
     from jsonb_array_elements(payload->'machines') r join jsonb_array_elements(payload->'items') i on i->>'clientKey'=r->>'workItemClientKey'
     except all
     select jsonb_build_array(task_id,machine_name,machine_type,machine_count,hours_per_machine,provider_entry_mode,partner_id,
       manual_provider_type,manual_provider_name,manual_provider_note,note) from public.daily_log_machines where contribution_id=p_source.id))
    or jsonb_array_length(payload->'labor')<>(select count(*) from public.daily_log_labor where contribution_id=p_source.id)
    or jsonb_array_length(payload->'machines')<>(select count(*) from public.daily_log_machines where contribution_id=p_source.id)
    or exists(select 1 from public.daily_log_labor where contribution_id=p_source.id and
      (resource_semantics_version is distinct from 2 or unit_cost is not null or total_cost is not null or people_count<=0 or hours_per_person<=0
        or total_labor_hours is distinct from people_count*hours_per_person))
    or exists(select 1 from public.daily_log_machines where contribution_id=p_source.id and
      (resource_semantics_version is distinct from 2 or unit_cost is not null or total_cost is not null or machine_count<=0 or hours_per_machine<=0
        or total_machine_hours is distinct from machine_count*hours_per_machine)) then
    raise exception using errcode='22023',message='DAILY_LOG_SOURCE_NOT_COMPLETE'; end if;
end $$;
revoke all on function app_private.assert_daily_log_source_ready_v2(public.daily_log_contributions) from public,anon,authenticated;

create function app_private.transition_daily_log_source_impl_v2(p_input jsonb,p_operation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.current_app_user_id(); source public.daily_log_contributions%rowtype;
  log public.daily_logs%rowtype; card public.daily_log_summary_sources%rowtype;
  rollout app_private.daily_log_wbs_rollout_scopes%rowtype; existing app_private.daily_log_source_command_receipts%rowtype;
  v_command_id uuid:=(p_input->>'commandId')::uuid; v_payload_fingerprint text:=md5(p_input::text);
  reason text:=nullif(trim(p_input->>'reason'),''); receipt jsonb; action_at timestamptz:=clock_timestamp();
begin
  select * into source from public.daily_log_contributions where id=(p_input->>'contributionId')::uuid;
  if actor is null or not found or source.source_document_version<>2 then
    raise exception using errcode='42501',message=case p_operation when 'return' then 'DAILY_LOG_SOURCE_RETURN_DENIED' else 'DAILY_LOG_SOURCE_SUBMIT_DENIED' end; end if;
  if p_operation='return' then
    if not (app_private.current_actor_has_effective_room_action(source.project_id,source.construction_site_id,'daily_log','verify')
      or app_private.current_actor_has_effective_room_action(source.project_id,source.construction_site_id,'daily_log','approve')) then
      raise exception using errcode='42501',message='DAILY_LOG_SOURCE_RETURN_DENIED'; end if;
    if reason is null then raise exception using errcode='22023',message='DAILY_LOG_SOURCE_RETURN_REASON_REQUIRED'; end if;
  elsif p_operation='submit' then
    if source.author_user_id is distinct from actor::text or not app_private.current_actor_has_effective_room_action(
      source.project_id,source.construction_site_id,'daily_log','submit') then
      raise exception using errcode='42501',message='DAILY_LOG_SOURCE_SUBMIT_DENIED'; end if;
  else raise exception using errcode='22023',message='DAILY_LOG_SOURCE_OPERATION_INVALID'; end if;
  if v_command_id is null or p_input->>'expectedRowVersion' is null then raise exception using errcode='22023',message='DAILY_LOG_SOURCE_COMMAND_REQUIRED'; end if;
  -- Common prefix before entity locks: idempotency key, then rollout scope.
  perform pg_advisory_xact_lock(hashtextextended(v_command_id::text,2));
  select * into existing from app_private.daily_log_source_command_receipts r where r.command_id=v_command_id;
  if found then
    if existing.actor_id<>actor or existing.operation<>p_operation or existing.payload_fingerprint<>v_payload_fingerprint then
      raise exception using errcode='22023',message='DAILY_LOG_SOURCE_COMMAND_REUSE_MISMATCH'; end if;
    return existing.receipt;
  end if;
  rollout:=app_private.lock_daily_log_rollout_v1(source.project_id,source.construction_site_id);
  if rollout.id is null or rollout.mode not in ('pilot','enforced') or source.date<rollout.cutover_date then
    raise exception using errcode='42501',message='DAILY_LOG_SOURCE_ROLLOUT_DISABLED'; end if;
  perform app_private.assert_project_progress_scope_period(source.project_id,source.construction_site_id,'daily',source.date);
  if exists(select 1 from public.project_progress_period_states s where s.project_id=source.project_id
    and s.construction_site_id is not distinct from source.construction_site_id and s.is_locked
    and ((s.period_type='daily' and s.period_start=source.date) or (s.period_type='weekly' and s.period_start=date_trunc('week',source.date)::date))) then
    raise exception using errcode='42501',message='PERIOD_LOCKED'; end if;
  if p_operation='return' then
    -- Lock every linked log in stable order, then all linked cards, then source.
    -- A save never takes log/card locks, so it cannot form the reverse cycle.
    perform 1 from public.daily_logs l where l.id=p_input->>'dailyLogId' or exists(
      select 1 from public.daily_log_summary_sources s where s.daily_log_id=l.id and s.contribution_id=source.id) order by l.id for update;
    perform 1 from public.daily_log_summary_sources s where s.contribution_id=source.id
      or s.daily_log_id=p_input->>'dailyLogId' order by s.id for update;
    select * into log from public.daily_logs where id=p_input->>'dailyLogId';
    select * into card from public.daily_log_summary_sources where id=(p_input->>'summarySourceId')::uuid;
    if log.id is null or card.id is null or card.daily_log_id is distinct from log.id or card.contribution_id is distinct from source.id
      or log.project_id is distinct from source.project_id or log.construction_site_id is distinct from source.construction_site_id
      or log.date::date is distinct from source.date or log.summary_source_type is distinct from 'member_contributions' then
      raise exception using errcode='22023',message='DAILY_LOG_SOURCE_RELATION_MISMATCH'; end if;
    if log.status not in ('draft','submitted','rejected') or log.superseded_by_daily_log_id is not null then
      raise exception using errcode='42501',message='VERIFIED_SOURCE_IMMUTABLE'; end if;
    if p_input->>'expectedSummaryUpdatedAt' is null or coalesce(log.last_action_at,log.created_at) is distinct from (p_input->>'expectedSummaryUpdatedAt')::timestamptz then
      raise exception using errcode='PT409',message='SUMMARY_UPDATED_AT_CONFLICT'; end if;
  end if;
  select * into source from public.daily_log_contributions where id=source.id for update;
  if source.row_version<>(p_input->>'expectedRowVersion')::bigint then raise exception using errcode='PT409',message='ROW_VERSION_CONFLICT'; end if;
  if exists(select 1 from public.daily_log_summary_sources s join public.daily_logs l on l.id=s.daily_log_id
    where s.contribution_id=source.id and l.status='verified' and l.superseded_by_daily_log_id is null) then
    raise exception using errcode='42501',message='VERIFIED_SOURCE_IMMUTABLE'; end if;
  if (p_operation='return' and source.status not in ('submitted','included')) or (p_operation='submit' and source.status not in ('draft','returned')) then
    raise exception using errcode='PT409',message='SOURCE_CHANGED'; end if;
  if p_operation='return' then
    if card.source_version is distinct from source.row_version or card.source_fingerprint is distinct from source.source_fingerprint then
      raise exception using errcode='PT409',message='SOURCE_CHANGED'; end if;
  else perform app_private.assert_daily_log_source_ready_v2(source); end if;
  receipt:=jsonb_build_object('contributionId',source.id,'status',case p_operation when 'return' then 'returned' else 'submitted' end,
    'rowVersion',source.row_version+1,'updatedAt',now(),'sourceFingerprint',source.source_fingerprint);
  if p_operation='return' then receipt:=receipt||jsonb_build_object('dailyLogId',log.id,'summaryUpdatedAt',action_at); end if;
  insert into app_private.daily_log_source_command_receipts(command_id,actor_id,project_id,construction_site_id,log_date,operation,payload_fingerprint,receipt,database_transaction_id)
    values(v_command_id,actor,source.project_id,source.construction_site_id,source.date,p_operation,v_payload_fingerprint,receipt,pg_current_xact_id());
  if p_operation='return' then
    update public.daily_log_contributions set status='returned',row_version=row_version+1,returned_by=actor::text,
      returned_by_name=(select name from public.users where id=actor),returned_at=action_at,return_reason=reason,
      last_action_by=actor::text,last_action_at=action_at,updated_at=now() where id=source.id;
    update public.daily_log_summary_sources set source_state='returned',review_status='change_requested',review_comment=reason,
      reviewed_by=actor::text,reviewed_at=action_at,updated_at=action_at where id=card.id;
    update public.daily_logs set status='rejected',verified=false,rejected_by=actor::text,rejected_by_id=actor::text,
      rejected_at=action_at,rejection_reason=reason,last_action_by=actor::text,last_action_at=action_at where id=log.id;
    -- Preserve the established summary correction-assignment contract as well
    -- as its status. This is not a new assignment/grant for the source author.
    perform app_private.close_daily_log_assignments(log.id,actor,'returned');
    perform app_private.create_daily_log_revision_assignment(log.id,(select u.id from public.users u
      where u.id::text=coalesce(nullif(log.created_by_id,''),nullif(log.submitted_by_id,''),
        nullif(log.submitted_by,''),nullif(log.created_by,'')) limit 1),actor);
  else
    update public.daily_log_contributions set status='submitted',row_version=row_version+1,submitted_at=action_at,
      last_action_by=actor::text,last_action_at=action_at,updated_at=now() where id=source.id;
  end if;
  return receipt;
end $$;
revoke all on function app_private.transition_daily_log_source_impl_v2(jsonb,text) from public,anon;
grant execute on function app_private.transition_daily_log_source_impl_v2(jsonb,text) to authenticated;
create function public.return_daily_log_source_v2(p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$
  select app_private.transition_daily_log_source_impl_v2(p_input,'return');
$$;
create function public.submit_daily_log_source_v2(p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$
  select app_private.transition_daily_log_source_impl_v2(p_input,'submit');
$$;
revoke all on function public.return_daily_log_source_v2(jsonb),public.submit_daily_log_source_v2(jsonb) from public,anon;
grant execute on function public.return_daily_log_source_v2(jsonb),public.submit_daily_log_source_v2(jsonb) to authenticated;
notify pgrst,'reload schema';

-- Qualified source baseline compatibility; legacy predicate remains unchanged.
alter function public.publish_daily_log_summary_base_v1(text,timestamptz,uuid) set schema app_private;
revoke all on function app_private.publish_daily_log_summary_base_v1(text,timestamptz,uuid) from public,anon,authenticated;
create or replace function app_private.publish_daily_log_summary_base_v1(
  p_daily_log_id text,
  p_expected_updated_at timestamptz,
  p_command_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_log public.daily_logs%rowtype;
  v_existing_result jsonb;
  v_scope_key text;
  v_week_start date;
  v_rows jsonb;
  v_snapshot jsonb;
  v_construction_progress numeric := 0;
  v_progress_fingerprint text;
  v_resource_fingerprint text;
  v_published_task_ids jsonb;
  v_resource_line_ids jsonb;
  v_published_at timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if v_actor_id is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'PUBLISH_ACTOR_AND_COMMAND_REQUIRED';
  end if;

  select command.result into v_existing_result
  from public.daily_log_publish_commands command
  where command.command_id = p_command_id
  for update;
  if found and v_existing_result is not null then return v_existing_result; end if;
  select command.result into v_existing_result
  from public.daily_log_publish_commands command
  where command.daily_log_id = p_daily_log_id
  for update;
  if found and v_existing_result is not null then return v_existing_result; end if;

  select log.* into v_log
  from public.daily_logs log
  where log.id = p_daily_log_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;

  select command.result into v_existing_result
  from public.daily_log_publish_commands command
  where command.command_id = p_command_id or command.daily_log_id = p_daily_log_id
  order by (command.command_id = p_command_id) desc
  limit 1
  for update;
  if found and v_existing_result is not null then return v_existing_result; end if;

  if not (v_log.summary_source_type = 'member_contributions' and v_log.status = 'submitted') then
    raise exception using errcode = '42501', message = 'SUBMITTED_SUMMARY_REQUIRED';
  end if;
  if coalesce(v_log.last_action_at, v_log.created_at) is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT';
  end if;
  if not app_private.current_actor_has_effective_room_action(
      v_log.project_id, v_log.construction_site_id, 'daily_log', 'approve')
    or not app_private.current_actor_has_effective_room_action(
      v_log.project_id, v_log.construction_site_id, 'daily_log', 'publish_progress') then
    raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVE_AND_PUBLISH_REQUIRED';
  end if;
  if not app_private.can_act_on_subject_impl('daily_log', p_daily_log_id, 'approve') then
    raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVAL_ASSIGNMENT_REQUIRED';
  end if;

  v_week_start := date_trunc('week', v_log.date::date)::date;
  if exists (
    select 1 from public.project_progress_period_states state
    where state.project_id = v_log.project_id
      and state.construction_site_id is not distinct from v_log.construction_site_id
      and state.is_locked
      and (
        (state.period_type = 'daily' and state.period_start = v_log.date::date)
        or (state.period_type = 'weekly' and state.period_start = v_week_start)
      )
  ) then raise exception using errcode = '55000', message = 'PERIOD_LOCKED'; end if;

  perform 1 from public.daily_log_summary_sources source
    where source.daily_log_id = p_daily_log_id for update;
  perform 1 from public.daily_log_work_items item
    where item.daily_log_id = p_daily_log_id for update;
  perform 1 from public.daily_log_wbs_decisions decision
    where decision.daily_log_id = p_daily_log_id for update;
  perform 1 from public.project_daily_task_progress progress
    where progress.project_id = v_log.project_id
      and progress.construction_site_id is not distinct from v_log.construction_site_id
      and progress.task_id in (
        select decision.task_id from public.daily_log_wbs_decisions decision
        where decision.daily_log_id = p_daily_log_id
      )
    for update;

  perform app_private.assert_daily_log_summary_ready_v1(p_daily_log_id, true);

  if exists (
    select 1
    from public.daily_log_work_items item
    left join lateral (
      select progress.* from public.project_daily_task_progress progress
      where progress.project_id = v_log.project_id
        and progress.construction_site_id is not distinct from v_log.construction_site_id
        and progress.task_id = item.task_id
        and progress.progress_date < v_log.date::date
      order by progress.progress_date desc, progress.updated_at desc limit 1
    ) baseline on true
    where item.daily_log_id = p_daily_log_id
      and case when exists(select 1 from public.daily_log_summary_sources s
        join public.daily_log_contributions c on c.id=s.contribution_id
        where s.id=item.summary_source_id and c.source_document_version=2) then
        item.baseline_fingerprint is distinct from (app_private.daily_log_quantity_context_v2(
          v_log.project_id,v_log.construction_site_id,v_log.date::date,item.work_area_code,item.task_id)->>'fingerprint')
      else item.baseline_fingerprint <> md5(concat_ws('|', baseline.id::text,
        coalesce(baseline.progress_percent, 0)::text,
        coalesce(baseline.quantity_done, 0)::text, baseline.updated_at::text)) end
  ) then raise exception using errcode = '40001', message = 'STALE_PROGRESS_BASELINE'; end if;

  if exists (
    select 1 from public.daily_log_wbs_decisions decision
    left join lateral (
      select progress.progress_percent from public.project_daily_task_progress progress
      where progress.project_id = v_log.project_id
        and progress.construction_site_id is not distinct from v_log.construction_site_id
        and progress.task_id = decision.task_id and progress.progress_date < v_log.date::date
      order by progress.progress_date desc, progress.updated_at desc limit 1
    ) previous on true
    left join lateral (
      select progress.progress_percent from public.project_daily_task_progress progress
      where progress.project_id = v_log.project_id
        and progress.construction_site_id is not distinct from v_log.construction_site_id
        and progress.task_id = decision.task_id and progress.progress_date > v_log.date::date
      order by progress.progress_date, progress.updated_at desc limit 1
    ) following on true
    where decision.daily_log_id = p_daily_log_id
      and (
        decision.official_cumulative_percent < coalesce(previous.progress_percent, 0)
        or (following.progress_percent is not null
          and decision.official_cumulative_percent > following.progress_percent)
      )
  ) then raise exception using errcode = '22023', message = 'BACKDATED_PROGRESS_CONFLICT'; end if;

  v_scope_key := app_private.assert_project_progress_scope_period(
    v_log.project_id, v_log.construction_site_id, 'daily', v_log.date::date
  );
  insert into public.project_progress_period_states (
    scope_key, project_id, construction_site_id, period_type, period_start
  ) values (v_scope_key, v_log.project_id, v_log.construction_site_id, 'daily', v_log.date::date)
  on conflict (scope_key, period_type, period_start) do nothing;
  perform 1 from public.project_progress_period_states state
    where state.scope_key = v_scope_key and state.period_type = 'daily'
      and state.period_start = v_log.date::date for update;

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', decision.task_id,
    'progressPercent', decision.official_cumulative_percent,
    'quantityDone', coalesce(decision.official_cumulative_quantity, 0),
    'dailyQuantityDone', coalesce(decision.official_daily_quantity, 0),
    'note', decision.resolution_reason,
    'attachments', '[]'::jsonb,
    'sourceDailyLogId', p_daily_log_id
  ) order by decision.task_id), '[]'::jsonb)
  into v_rows
  from public.daily_log_wbs_decisions decision
  where decision.daily_log_id = p_daily_log_id;

  select coalesce(avg(case when decision.task_id is not null
      then decision.official_cumulative_percent else task.progress end), 0)
  into v_construction_progress
  from public.project_tasks task
  left join public.daily_log_wbs_decisions decision
    on decision.daily_log_id = p_daily_log_id and decision.task_id = task.id
  where task.project_id = v_log.project_id
    and task.construction_site_id is not distinct from v_log.construction_site_id
    and not exists (select 1 from public.project_tasks child where child.parent_id = task.id);

  select jsonb_build_object(
    'constructionProgressPercent', v_construction_progress,
    'valueProgressPercent', coalesce(snapshot.value_progress_percent, 0),
    'progressMode', 'daily_log_summary',
    'suppliedValue', snapshot.supplied_value,
    'contractTotalValue', snapshot.contract_total_value,
    'purchasedValue', coalesce(snapshot.purchased_value, 0),
    'issuedValue', coalesce(snapshot.issued_value, 0),
    'recognizedValue', coalesce(snapshot.recognized_value, 0),
    'ganttPercent', v_construction_progress,
    'calculatedAt', v_published_at
  ) into v_snapshot
  from (select 1) seed
  left join lateral (
    select weekly.* from public.weekly_progress_snapshots weekly
    where weekly.scope_key = v_scope_key and weekly.week_start = v_week_start
    limit 1
  ) snapshot on true;

  insert into public.daily_log_publish_commands(command_id, daily_log_id, actor_user_id)
  values (p_command_id, p_daily_log_id, v_actor_id)
  on conflict (command_id) do nothing;

  perform app_private.write_project_progress_period_payload(
    v_actor_id, v_scope_key, v_log.project_id, v_log.construction_site_id,
    'daily', v_log.date::date, v_rows, v_snapshot
  );

  update public.project_daily_task_progress progress
  set quantity_done = decision.official_cumulative_quantity,
      daily_quantity_done = decision.official_daily_quantity
  from public.daily_log_wbs_decisions decision
  where decision.daily_log_id = p_daily_log_id
    and progress.scope_key = v_scope_key
    and progress.task_id = decision.task_id
    and progress.progress_date = v_log.date::date
    and progress.source_daily_log_id = p_daily_log_id;

  perform public.transition_daily_log_status(p_daily_log_id, 'verified', null, null, null);
  update public.daily_log_summary_sources source
  set review_status = 'accepted', reviewed_by = v_actor_id::text,
      reviewed_at = v_published_at, updated_at = v_published_at
  where source.daily_log_id = p_daily_log_id;
  update public.daily_log_contributions contribution
  set status = 'included', daily_log_id = p_daily_log_id,
      included_in_daily_log_id = p_daily_log_id, included_by = v_actor_id::text,
      included_at = v_published_at, last_action_by = v_actor_id::text,
      last_action_at = v_published_at, updated_at = v_published_at
  where contribution.id in (
    select source.contribution_id from public.daily_log_summary_sources source
    where source.daily_log_id = p_daily_log_id
  );

  select coalesce(jsonb_agg(decision.task_id order by decision.task_id), '[]'::jsonb),
    md5(coalesce(string_agg(concat_ws('|', decision.task_id,
      decision.official_cumulative_percent::text,
      decision.official_cumulative_quantity::text,
      decision.official_daily_quantity::text,
      decision.source_fingerprint), '||' order by decision.task_id), ''))
  into v_published_task_ids, v_progress_fingerprint
  from public.daily_log_wbs_decisions decision where decision.daily_log_id = p_daily_log_id;

  select coalesce(jsonb_agg(resource.id order by resource.id), '[]'::jsonb),
    md5(coalesce(string_agg(resource.fingerprint, '||' order by resource.id), ''))
  into v_resource_line_ids, v_resource_fingerprint
  from (
    select labor.id::text as id, concat_ws('|', labor.id::text, labor.provider_entry_mode,
      labor.partner_id, labor.provider_name_snapshot, labor.manual_provider_type,
      labor.manual_provider_name, labor.people_count, labor.hours_per_person) as fingerprint
    from public.daily_log_labor labor
    where labor.daily_log_id = p_daily_log_id and labor.resource_semantics_version = 2
    union all
    select machine.id::text, concat_ws('|', machine.id::text, machine.provider_entry_mode,
      machine.partner_id, machine.provider_name_snapshot, machine.manual_provider_type,
      machine.manual_provider_name, machine.machine_count, machine.hours_per_machine)
    from public.daily_log_machines machine
    where machine.daily_log_id = p_daily_log_id and machine.resource_semantics_version = 2
  ) resource;

  v_result := jsonb_build_object(
    'commandId', p_command_id,
    'dailyLogId', p_daily_log_id,
    'progressDate', v_log.date,
    'publishedTaskIds', v_published_task_ids,
    'verifiedResourceLineIds', v_resource_line_ids,
    'progressFingerprint', v_progress_fingerprint,
    'resourceEvidenceFingerprint', v_resource_fingerprint,
    'publishedAt', v_published_at
  );
  update public.daily_log_publish_commands command
  set result = v_result where command.command_id = p_command_id;
  return v_result;
end;
$$;
create function public.publish_daily_log_summary_base_v1(p_daily_log_id text,p_expected_updated_at timestamptz,p_command_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.publish_daily_log_summary_base_v1(p_daily_log_id,p_expected_updated_at,p_command_id);
$$;
revoke all on function public.publish_daily_log_summary_base_v1(text,timestamptz,uuid) from public,anon,authenticated;

-- Marker1-only summaries delegate verbatim. V2 locks share the return prefix.
alter function public.publish_daily_log_summary_v1(text,timestamptz,uuid) rename to publish_daily_log_summary_source_base_v1;
alter function public.publish_daily_log_summary_source_base_v1(text,timestamptz,uuid) set schema app_private;
revoke all on function app_private.publish_daily_log_summary_source_base_v1(text,timestamptz,uuid) from public,anon,authenticated;
create function app_private.publish_daily_log_summary_source_impl_v2(p_daily_log_id text,p_expected_updated_at timestamptz,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_log public.daily_logs%rowtype; v_source_ids uuid[];
begin
  if not exists(select 1 from public.daily_log_summary_sources s join public.daily_log_contributions c on c.id=s.contribution_id
    where s.daily_log_id=p_daily_log_id and c.source_document_version=2) then
    return app_private.publish_daily_log_summary_source_base_v1(p_daily_log_id,p_expected_updated_at,p_command_id);
  end if;
  select * into v_log from public.daily_logs where id=p_daily_log_id;
  if public.current_app_user_id() is null or not app_private.current_actor_has_effective_room_action(v_log.project_id,v_log.construction_site_id,'daily_log','approve')
    or not app_private.current_actor_has_effective_room_action(v_log.project_id,v_log.construction_site_id,'daily_log','publish_progress') then
    raise exception using errcode='42501',message='DAILY_LOG_APPROVE_AND_PUBLISH_REQUIRED'; end if;
  perform app_private.lock_daily_log_rollout_v1(v_log.project_id,v_log.construction_site_id);
  select array_agg(s.contribution_id) into v_source_ids from public.daily_log_summary_sources s where s.daily_log_id=p_daily_log_id;
  perform 1 from public.daily_logs l where l.id in(p_daily_log_id,v_log.supersedes_daily_log_id,v_log.superseded_by_daily_log_id)
    or exists(select 1 from public.daily_log_summary_sources s where s.daily_log_id=l.id and s.contribution_id=any(v_source_ids))
    order by l.id for update;
  perform 1 from public.daily_log_summary_sources s where s.daily_log_id=p_daily_log_id or s.contribution_id=any(v_source_ids) order by s.id for update;
  perform 1 from public.daily_log_contributions c where c.id=any(v_source_ids) order by c.id for update;
  begin
    return app_private.publish_daily_log_summary_source_base_v1(p_daily_log_id,p_expected_updated_at,p_command_id);
  exception when serialization_failure then
    if sqlerrm in ('ROW_VERSION_CONFLICT','SUMMARY_SOURCE_REVIEW_BLOCKED','STALE_PROGRESS_BASELINE','SHADOW_COMMAND_INPUT_CHANGED') then
      raise exception using errcode='PT409',message=sqlerrm;
    end if;
    raise;
  end;
end $$;
revoke all on function app_private.publish_daily_log_summary_source_impl_v2(text,timestamptz,uuid) from public,anon;
grant execute on function app_private.publish_daily_log_summary_source_impl_v2(text,timestamptz,uuid) to authenticated;
create function public.publish_daily_log_summary_v1(p_daily_log_id text,p_expected_updated_at timestamptz,p_command_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.publish_daily_log_summary_source_impl_v2(p_daily_log_id,p_expected_updated_at,p_command_id);
$$;
revoke all on function public.publish_daily_log_summary_v1(text,timestamptz,uuid) from public,anon;
grant execute on function public.publish_daily_log_summary_v1(text,timestamptz,uuid) to authenticated;
notify pgrst,'reload schema';

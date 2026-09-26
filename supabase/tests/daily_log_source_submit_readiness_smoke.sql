-- Readiness must reject incomplete, stale or tampered physical projections.
begin;
insert into public.project_tasks(id,project_id,name,start_date,end_date,fallback_unit,provisional_quantity)
  values('__DL_UX_READY','DL-WBS-PILOT-20260925','Ready leaf','2099-05-01','2099-05-30','m3',100);
insert into public.business_partners(id,code,name,classifications,is_active)
  values('__DL_UX_READY_PROVIDER','UX-READY','Readiness provider',array['contractor'],true);
insert into public.daily_log_contributions(id,project_id,date,author_user_id,work_area_code,work_area_name)
  values('78200000-0000-4000-8000-000000000001','DL-WBS-PILOT-20260925','2099-05-02','72000000-0000-4000-8000-000000000002','FOREIGN','Foreign linkage fixture');
insert into public.daily_log_work_items(id,contribution_id,project_id,task_id,work_area_code,work_area_name_snapshot,task_name_snapshot,
  unit_snapshot,planned_quantity_snapshot,baseline_progress_percent,baseline_quantity_done,baseline_fingerprint,cumulative_progress_percent,cumulative_quantity_done,daily_quantity_done)
  values('78200000-0000-4000-8000-000000000002','78200000-0000-4000-8000-000000000001','DL-WBS-PILOT-20260925','__DL_UX_READY',
    'FOREIGN','Foreign linkage fixture','Ready leaf','m3',100,0,0,'foreign-explicit-fixture',1,1,1);
create temporary table ux_ready_fixture(id uuid,payload jsonb);
grant select,insert on ux_ready_fixture to authenticated;
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare created jsonb; bundle jsonb; payload jsonb; begin
  if public.is_admin() then raise exception 'admin readiness persona forbidden'; end if;
  created:=public.create_daily_log_source_v2(gen_random_uuid(),'DL-WBS-PILOT-20260925',null,'2099-05-02','UX-READY','Ready area');
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-05-02',null,(created->>'contributionId')::uuid);
  payload:=jsonb_build_object('contributionId',created->>'contributionId','expectedRowVersion',1,'workAreaCode','UX-READY','workAreaName','Ready area',
    'content','Ready physical data','issues','','photos','[]'::jsonb,'items',jsonb_build_array(jsonb_build_object(
      'clientKey','w','taskId','__DL_UX_READY','entryMode','daily_quantity','enteredValue',12,'forecastFinishDate','2099-05-30',
      'baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX_READY')),
    'labor',jsonb_build_array(jsonb_build_object('workItemClientKey','w','laborType','Ready crew','peopleCount',5,'hoursPerPerson',8,
      'provider',jsonb_build_object('entryMode','catalog','partnerId','__DL_UX_READY_PROVIDER'))),
    'machines',jsonb_build_array(jsonb_build_object('workItemClientKey','w','machineName','Ready machine','machineType','Mixer','machineCount',2,'hoursPerMachine',3,
      'provider',jsonb_build_object('entryMode','manual','manualProviderType','machine_owner','manualProviderName','Ready owner'))));
  perform public.save_daily_log_source_document_v2(payload);
  insert into ux_ready_fixture values((created->>'contributionId')::uuid,payload);
end $$;
reset role;
do $$ declare source_id uuid; input jsonb; original jsonb; begin
  select id into source_id from ux_ready_fixture;
  select to_jsonb(c) into original from public.daily_log_contributions c where id=source_id;
  input:=jsonb_build_object('commandId',gen_random_uuid(),'contributionId',source_id,'expectedRowVersion',2);
  begin
    update public.business_partners set is_active=false where id='__DL_UX_READY_PROVIDER';
    set local role authenticated;
    perform public.submit_daily_log_source_v2(input);
    raise exception 'inactive provider submitted';
  exception when invalid_parameter_value then if sqlerrm<>'CATALOG_PROVIDER_NOT_ACTIVE' then raise; end if; end;
  begin
    update public.project_tasks set provisional_quantity=120 where id='__DL_UX_READY';
    set local role authenticated;
    perform public.submit_daily_log_source_v2(input);
    raise exception 'changed quantity basis submitted';
  exception when sqlstate 'PT409' then if sqlerrm<>'SOURCE_CHANGED' then raise; end if; end;
  begin
    update public.daily_log_work_items set area_planned_quantity_snapshot=50 where contribution_id=source_id;
    set local role authenticated;
    perform public.submit_daily_log_source_v2(input);
    raise exception 'tampered area allocation submitted';
  exception when sqlstate 'PT409' then if sqlerrm<>'SOURCE_CHANGED' then raise; end if; end;
  begin
    update public.daily_log_labor set project_id=null where contribution_id=source_id;
    set local role authenticated;
    perform public.submit_daily_log_source_v2(input);
    raise exception 'wrong resource scope submitted';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_SOURCE_NOT_COMPLETE' then raise; end if; end;
  begin
    update public.daily_log_labor set daily_log_work_item_id='78200000-0000-4000-8000-000000000002' where contribution_id=source_id;
    set local role authenticated;
    perform public.submit_daily_log_source_v2(input);
    raise exception 'foreign labor work linkage submitted';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_SOURCE_NOT_COMPLETE' then raise; end if; end;
  begin
    update public.daily_log_machines set daily_log_work_item_id='78200000-0000-4000-8000-000000000002' where contribution_id=source_id;
    set local role authenticated;
    perform public.submit_daily_log_source_v2(input);
    raise exception 'foreign machine work linkage submitted';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_SOURCE_NOT_COMPLETE' then raise; end if; end;
  begin
    update public.daily_log_labor set people_count=6,total_labor_hours=48 where contribution_id=source_id;
    set local role authenticated;
    perform public.submit_daily_log_source_v2(input);
    raise exception 'tampered physical labor submitted';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_SOURCE_NOT_COMPLETE' then raise; end if; end;
  if (select to_jsonb(c) from public.daily_log_contributions c where id=source_id) is distinct from original then raise exception 'failed submit mutated source'; end if;
end $$;
set local role authenticated;
do $$ declare source_id uuid; payload jsonb; input jsonb; begin
  select id,f.payload into source_id,payload from ux_ready_fixture f;
  input:=jsonb_build_object('commandId',gen_random_uuid(),'contributionId',source_id,'expectedRowVersion',2);
  -- Safe blank can be saved; it cannot be sent as an empty normalized zero.
  perform public.save_daily_log_source_document_v2(payload||jsonb_build_object('expectedRowVersion',2,'items',
    jsonb_build_array(payload->'items'->0||jsonb_build_object('enteredValue',''))));
  begin perform public.submit_daily_log_source_v2(input||jsonb_build_object('expectedRowVersion',3)); raise exception 'blank item submitted';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_SOURCE_NOT_COMPLETE' then raise; end if; end;
  perform public.save_daily_log_source_document_v2(payload||jsonb_build_object('expectedRowVersion',3,'items',
    jsonb_build_array((payload->'items'->0)-'forecastFinishDate')));
  begin perform public.submit_daily_log_source_v2(input||jsonb_build_object('expectedRowVersion',4)); raise exception 'forecast omission bypassed reason rule';
  exception when invalid_parameter_value then if sqlerrm<>'FORECAST_CHANGE_REASON_REQUIRED' then raise; end if; end;
  perform public.save_daily_log_source_document_v2(payload||jsonb_build_object('expectedRowVersion',4));
  perform public.submit_daily_log_source_v2(input||jsonb_build_object('expectedRowVersion',5));
end $$;
reset role;
select 'daily_log_source_submit_readiness_smoke PASS' result;
rollback;

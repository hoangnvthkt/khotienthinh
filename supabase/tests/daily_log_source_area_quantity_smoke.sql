-- Area-qualified historical context. baseline-vioo-git only; fixtures roll back.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_id from public.users
  where role='ADMIN' and auth_id is not null order by created_at limit 1),'role','authenticated')::text,true);
insert into public.project_tasks(id,project_id,name,start_date,end_date,fallback_unit,provisional_quantity) values
  ('__DL_UX_Q_KNOWN','DL-WBS-PILOT-20260925','Known allocated area','2099-03-01','2099-04-01','m³',100),
  ('__DL_UX_Q_GLOBAL','DL-WBS-PILOT-20260925','Global quantity only','2099-03-01','2099-04-01','m³',100),
  ('__DL_UX_Q_PERCENT','DL-WBS-PILOT-20260925','Missing physical basis','2099-03-01','2099-04-01',null,0);
insert into public.project_tasks(id,project_id,name,start_date,end_date,fallback_unit,provisional_quantity)
  values('__DL_UX_Q_OVER','DL-WBS-PILOT-20260925','Existing canonical over-plan leaf rule','2099-03-01','2099-04-01','m³',100);
insert into public.daily_log_contributions(id,project_id,date,author_user_id,author_name,content,work_area_code,work_area_name)
  values('76100000-0000-4000-8000-000000000001','DL-WBS-PILOT-20260925','2099-03-01',public.current_app_user_id()::text,'Fixture author','Fixture','UX-Q-B','Area B');
insert into public.daily_logs(id,project_id,date,created_by,status,summary_source_type) values
  ('__DL_UX_Q_PRIOR','DL-WBS-PILOT-20260925','2099-03-01','Fixture reviewer','verified','member_contributions'),
  ('__DL_UX_Q_NEXT','DL-WBS-PILOT-20260925','2099-03-03','Fixture reviewer','verified','member_contributions');
insert into public.daily_log_summary_sources(id,daily_log_id,contribution_id,work_area_code,work_area_name,review_status) values
  ('76100000-0000-4000-8000-000000000002','__DL_UX_Q_PRIOR','76100000-0000-4000-8000-000000000001','UX-Q-B','Area B','accepted'),
  ('76100000-0000-4000-8000-000000000003','__DL_UX_Q_NEXT','76100000-0000-4000-8000-000000000001','UX-Q-B','Area B','accepted');
insert into public.daily_log_work_items(daily_log_id,summary_source_id,project_id,task_id,work_area_code,work_area_name_snapshot,
  task_name_snapshot,unit_snapshot,planned_quantity_snapshot,area_planned_quantity_snapshot,baseline_progress_percent,baseline_fingerprint,
  cumulative_progress_percent,cumulative_quantity_done,daily_quantity_done) values
  ('__DL_UX_Q_PRIOR','76100000-0000-4000-8000-000000000002','DL-WBS-PILOT-20260925','__DL_UX_Q_KNOWN','UX-Q-B','Area B','Known','m³',100,100,0,'fixture',40,40,40),
  ('__DL_UX_Q_NEXT','76100000-0000-4000-8000-000000000003','DL-WBS-PILOT-20260925','__DL_UX_Q_KNOWN','UX-Q-B','Area B','Known','m³',100,100,40,'fixture',60,60,20);
insert into public.daily_log_wbs_decisions(daily_log_id,task_id,official_cumulative_percent,official_cumulative_quantity,
  official_daily_quantity,aggregation_method,daily_quantity_method,included_source_work_item_ids,source_fingerprint)
  select daily_log_id,task_id,cumulative_progress_percent,cumulative_quantity_done,daily_quantity_done,
    'single_source','keep_selected_sources',jsonb_build_array(id::text),'fixture-kept'
    from public.daily_log_work_items where daily_log_id in ('__DL_UX_Q_PRIOR','__DL_UX_Q_NEXT');
insert into public.project_daily_task_progress(scope_key,project_id,task_id,progress_date,week_start,progress_percent,quantity_done,source_daily_log_id) values
  ('DL-WBS-PILOT-20260925','DL-WBS-PILOT-20260925','__DL_UX_Q_KNOWN','2099-03-01',date_trunc('week','2099-03-01'::date)::date,40,40,'__DL_UX_Q_PRIOR'),
  ('DL-WBS-PILOT-20260925','DL-WBS-PILOT-20260925','__DL_UX_Q_KNOWN','2099-03-03',date_trunc('week','2099-03-03'::date)::date,60,60,'__DL_UX_Q_NEXT'),
  ('DL-WBS-PILOT-20260925','DL-WBS-PILOT-20260925','__DL_UX_Q_GLOBAL','2099-03-01',date_trunc('week','2099-03-01'::date)::date,40,40,null);
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare created jsonb; bundle jsonb; payload jsonb; v_item jsonb; receipt jsonb; v_mode text; v_version int:=1; v_work_id text; begin
  if public.is_admin() then raise exception 'admin is not a valid area quantity test persona'; end if;
  created:=public.create_daily_log_source_v2('76100000-0000-4000-8000-000000000010','DL-WBS-PILOT-20260925',null,'2099-03-02','UX-Q-B','Area B');
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-02',null,(created->>'contributionId')::uuid);
  if bundle->'quantityBaselines'->'__DL_UX_Q_KNOWN'->>'state' is distinct from 'known'
    or bundle->'quantityBaselines'->'__DL_UX_Q_GLOBAL'->>'state' is distinct from 'unknown' then
    raise exception 'whole-WBS quantity was confused with evidenced area baseline'; end if;
  payload:=jsonb_build_object('contributionId',created->>'contributionId','workAreaCode','UX-Q-B','workAreaName','Area B',
    'content','Known area daily entry','issues','','photos','[]'::jsonb,'labor','[]'::jsonb,'machines','[]'::jsonb);
  v_item:=jsonb_build_object('clientKey','known','taskId','__DL_UX_Q_KNOWN','areaPlannedQuantity',100,
    'baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX_Q_KNOWN');
  foreach v_mode in array array['daily_quantity','cumulative_quantity','percent'] loop
    receipt:=public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',v_version,
      'items',jsonb_build_array(v_item || jsonb_build_object('entryMode',v_mode,'enteredValue',case when v_mode='daily_quantity' then 12 else 52 end))));
    v_version:=v_version+1;
    bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-02',null,(created->>'contributionId')::uuid);
    if bundle->'workItems'->0->>'cumulative_quantity_done' is distinct from '52.0000'
      or (bundle->'workItems'->0->>'cumulative_progress_percent')::numeric<>52
      or (bundle->'workItems'->0->>'daily_quantity_done')::numeric<>12 then raise exception '100/40/12 failed for %',v_mode; end if;
    if v_work_id is not null and v_work_id<>bundle->'workItems'->0->>'id' then raise exception 'unchanged task lost its source row identity'; end if;
    v_work_id:=bundle->'workItems'->0->>'id';
  end loop;
  begin
    perform public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',v_version,'items',
      jsonb_build_array(v_item || jsonb_build_object('entryMode','cumulative_quantity','enteredValue',39))));
    raise exception 'below baseline accepted';
  exception when invalid_parameter_value then if sqlerrm<>'PROGRESS_BELOW_BASELINE' then raise; end if; end;
  begin
    perform public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',v_version,'items',
      jsonb_build_array(v_item || jsonb_build_object('entryMode','cumulative_quantity','enteredValue',39.99995))));
    raise exception 'rounding tolerance admitted negative physical daily quantity';
  exception when invalid_parameter_value then if sqlerrm<>'PROGRESS_BELOW_BASELINE' then raise; end if; end;
  begin
    perform public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',v_version,'items',
      jsonb_build_array(v_item || jsonb_build_object('entryMode','cumulative_quantity','enteredValue',61))));
    raise exception 'above next area entry accepted';
  exception when invalid_parameter_value then if sqlerrm<>'PROGRESS_ABOVE_NEXT_ENTRY' then raise; end if; end;
  begin
    perform public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',v_version,'items',
      jsonb_build_array(v_item || jsonb_build_object('entryMode','cumulative_quantity','enteredValue',60.00001))));
    raise exception 'rounding tolerance admitted value above next official area entry';
  exception when invalid_parameter_value then if sqlerrm<>'PROGRESS_ABOVE_NEXT_ENTRY' then raise; end if; end;
  v_item:=jsonb_build_object('clientKey','global','taskId','__DL_UX_Q_GLOBAL','entryMode','daily_quantity','enteredValue',12,
    'baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX_Q_GLOBAL');
  begin
    perform public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',v_version,'items',jsonb_build_array(v_item)));
    raise exception 'global-only history became area baseline';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_ENTRY_UNKNOWN_BASELINE' then raise; end if; end;
  receipt:=public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',v_version,'items',
    jsonb_build_array(v_item || jsonb_build_object('entryMode','cumulative_quantity','enteredValue',52)))); v_version:=v_version+1;
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-02',null,(created->>'contributionId')::uuid);
  if bundle->'workItems'->0->>'daily_quantity_done' is not null then raise exception 'unknown daily quantity became zero'; end if;
  v_item:=jsonb_build_object('clientKey','percent','taskId','__DL_UX_Q_PERCENT','entryMode','percent','enteredValue',44,
    'baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX_Q_PERCENT');
  receipt:=public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',v_version,'items',jsonb_build_array(v_item))); v_version:=v_version+1;
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-02',null,(created->>'contributionId')::uuid);
  if (bundle->'workItems'->0->>'cumulative_progress_percent')::numeric<>44 or bundle->'workItems'->0->>'cumulative_quantity_done' is not null
    or bundle->'workItems'->0->>'daily_quantity_done' is not null or bundle->'workItems'->0->>'baseline_quantity_done' is not null
    then raise exception 'percent-only inferred quantities or a false zero baseline'; end if;
  begin
    perform public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',v_version,'items',
      jsonb_build_array(v_item || jsonb_build_object('entryMode','cumulative_quantity','enteredValue',44))));
    raise exception 'quantity mode accepted without physical basis';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_ENTRY_QUANTITY_BASIS_REQUIRED' then raise; end if; end;
  v_item:=jsonb_build_object('clientKey','over','taskId','__DL_UX_Q_OVER','entryMode','percent','enteredValue',110,
    'baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX_Q_OVER');
  receipt:=public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',v_version,'items',jsonb_build_array(v_item)));
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-02',null,(created->>'contributionId')::uuid);
  if (bundle->'workItems'->0->>'cumulative_progress_percent')::numeric<>110 or
    bundle->'quantityBaselines'->'__DL_UX_Q_OVER'->>'allowOver100' is distinct from 'true' then
    raise exception 'explicit leaf over-plan rule not preserved'; end if;
end $$;
reset role;
-- A snapshot not kept by the verified decision is not an official area baseline.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_id from public.users
  where role='ADMIN' and auth_id is not null order by created_at limit 1),'role','authenticated')::text,true);
update public.daily_log_wbs_decisions set included_source_work_item_ids=jsonb_build_array('76100000-0000-4000-8000-000000000099'),
  source_fingerprint='fixture-excluded' where daily_log_id='__DL_UX_Q_PRIOR';
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare bundle jsonb; v_id uuid; begin
  select id into v_id from public.daily_log_contributions where project_id='DL-WBS-PILOT-20260925'
    and date='2099-03-02' and work_area_code='UX-Q-B' and author_user_id=public.current_app_user_id()::text;
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-02',null,v_id);
  if bundle->'quantityBaselines'->'__DL_UX_Q_KNOWN'->>'state' is distinct from 'unknown' then
    raise exception 'snapshot excluded from official decision still used as area baseline'; end if;
end $$;
reset role;
select 'daily_log_source_area_quantity_smoke PASS' result;
rollback;

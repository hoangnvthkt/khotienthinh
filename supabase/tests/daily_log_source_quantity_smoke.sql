-- Task 3 test-first fixture; baseline-vioo-git only, every write rolls back.
begin;
create temporary table ux_quantity_counts as select
  (select count(*) from public.project_transactions) transactions,
  (select count(*) from public.project_daily_task_progress) progress,
  (select count(*) from public.daily_logs) logs;
insert into public.project_tasks(id,project_id,name,start_date,end_date,fallback_unit,provisional_quantity)
  values('__DL_UX_QUANTITY_NONE','DL-WBS-PILOT-20260925','UX quantity no prior row','2099-03-01','2099-04-01','m³',100);
insert into public.project_tasks(id,name,start_date,end_date,fallback_unit,provisional_quantity)
  values('__DL_UX_Q_OTHER_SCOPE','Real leaf outside requested project','2099-03-01','2099-04-01','m³',100);
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare created jsonb; saved jsonb; bundle jsonb; payload jsonb; bad jsonb; before_source jsonb; v_input_item jsonb; begin
  if public.is_admin() then raise exception 'admin is not a valid quantity test persona'; end if;
  created:=public.create_daily_log_source_v2('76000000-0000-4000-8000-000000000001','DL-WBS-PILOT-20260925',null,'2099-03-02','UX-Q-A','Khu A quantity');
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-02',null,(created->>'contributionId')::uuid);
  payload:=jsonb_build_object('contributionId',created->>'contributionId','expectedRowVersion',1,
    'workAreaCode','UX-Q-A','workAreaName','Khu A quantity','content','Nội dung đã sửa','issues','Vướng mắc đã cập nhật',
    'photos',jsonb_build_array(jsonb_build_object('name','Ảnh kiểm thử','url','https://example.invalid/ux-proof.jpg')),
    'items',jsonb_build_array(jsonb_build_object('clientKey','work-a','taskId','__DL_UX_QUANTITY_NONE','entryMode','daily_quantity',
      'enteredValue','12,5','baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX_QUANTITY_NONE')),
    'labor',jsonb_build_array(jsonb_build_object('workItemClientKey','work-a','laborType','Tổ bê tông','peopleCount',5,'hoursPerPerson',8,
      'provider',jsonb_build_object('entryMode','manual','manualProviderType','free_crew','manualProviderName','Tổ UX'))),'machines','[]'::jsonb);
  saved:=public.save_daily_log_source_document_v2(payload);
  if saved->>'rowVersion' is distinct from '2' then raise exception 'whole source save version mismatch'; end if;
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-02',null,(created->>'contributionId')::uuid);
  if bundle->'contribution'->>'content' is distinct from 'Nội dung đã sửa'
    or bundle->'contribution'->>'issues' is distinct from 'Vướng mắc đã cập nhật'
    or jsonb_array_length(bundle->'contribution'->'photos')<>1 then raise exception 'existing source metadata lost'; end if;
  if not exists(select 1 from jsonb_array_elements(bundle->'workItems') item
    where item->>'task_id'='__DL_UX_QUANTITY_NONE' and (item->>'cumulative_quantity_done')::numeric=12.5
      and (item->>'daily_quantity_done')::numeric=12.5 and (item->>'cumulative_progress_percent')::numeric=12.5) then
    raise exception 'daily decimal entry did not preserve cumulative semantics';
  end if;
  if not exists(select 1 from jsonb_array_elements(bundle->'labor') line
    where (line->>'total_labor_hours')::numeric=40 and line->>'manual_provider_name'='Tổ UX') then raise exception 'physical resource lost'; end if;
  before_source:=bundle->'contribution';
  payload:=payload || jsonb_build_object('expectedRowVersion',2,'content','Must not persist');
  v_input_item:=payload->'items'->0;
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    payload || jsonb_build_object('expectedRowVersion',1),
    payload || jsonb_build_object('resourceCost',10),
    payload || jsonb_build_object('labor',jsonb_build_array(jsonb_build_object('workItemClientKey','work-a','laborType','Tổ bê tông','peopleCount',5,'hoursPerPerson',8,
      'provider',jsonb_build_object('entryMode','catalog','partnerId',bundle->'resourceProviders'->0->>'id','manualProviderName','Conflicting provider')))),
    payload || jsonb_build_object('items',jsonb_build_array(v_input_item || jsonb_build_object('baselineFingerprint','stale'))),
    payload || jsonb_build_object('items',jsonb_build_array(v_input_item || jsonb_build_object('taskId','__NO_SCOPED_LEAF'))),
    payload || jsonb_build_object('items',jsonb_build_array(v_input_item || jsonb_build_object('taskId','__DL_UX_Q_OTHER_SCOPE'))),
    payload || jsonb_build_object('items',jsonb_build_array(v_input_item || jsonb_build_object('enteredValue',-1))),
    payload || jsonb_build_object('items',jsonb_build_array(v_input_item || jsonb_build_object('forecastFinishDate','2099-04-02'))),
    payload || jsonb_build_object('labor',jsonb_build_array(jsonb_build_object('workItemClientKey','work-a','peopleCount',5,'hoursPerPerson',8))),
    payload || jsonb_build_object('labor',jsonb_build_array(jsonb_build_object('workItemClientKey','work-a','peopleCount',0,'hoursPerPerson',8,
      'provider',jsonb_build_object('entryMode','manual','manualProviderType','free_crew','manualProviderName','Crew')))))
  ) loop
    begin
      perform public.save_daily_log_source_document_v2(bad);
      raise exception 'unsafe/stale source save accepted: %',bad;
    exception when invalid_parameter_value or sqlstate 'PT409' then null;
    end;
    bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-02',null,(created->>'contributionId')::uuid);
    if bundle->'contribution' is distinct from before_source or jsonb_array_length(bundle->'labor')<>1 then
      raise exception 'failed save was not atomic';
    end if;
  end loop;
  begin
    perform public.save_daily_log_source_document_v2(payload || jsonb_build_object('expectedRowVersion',2,'amount',10));
    raise exception 'money payload accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'RESOURCE_PRICE_FIELDS_NOT_ALLOWED' then raise; end if;
  end;
  -- A blank safe row is retained as an incomplete draft, never converted to 0.
  saved:=public.save_daily_log_source_document_v2(payload || jsonb_build_object('content','Incomplete draft; literal note "price": 10 is not a price field',
    'items',jsonb_build_array(v_input_item || jsonb_build_object('enteredValue',''))));
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-02',null,(created->>'contributionId')::uuid);
  if bundle->'contribution'->'source_draft_payload'->'items'->0->>'enteredValue' is distinct from ''
    or jsonb_array_length(bundle->'workItems')<>0 then raise exception 'blank draft was lost or published as zero'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.project_transactions)<>(select transactions from ux_quantity_counts)
    or (select count(*) from public.project_daily_task_progress)<>(select progress from ux_quantity_counts)
    or (select count(*) from public.daily_logs)<>(select logs from ux_quantity_counts) then raise exception 'draft created official progress/log/transaction'; end if;
end $$;
select 'daily_log_source_quantity_smoke PASS' result;
rollback;

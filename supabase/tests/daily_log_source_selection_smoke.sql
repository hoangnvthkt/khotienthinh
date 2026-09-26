-- baseline-vioo-git only. Authenticated EMPLOYEE actors; every fixture write rolls back.
begin;
create temporary table ux_original_sources as select id,to_jsonb(c) - 'source_document_version' as original,
  c.source_document_version as original_version from public.daily_log_contributions c;
create temporary table ux_unchanged_counts as select
  (select count(*) from public.project_transactions) as transactions,
  (select count(*) from public.project_daily_task_progress) as progress,
  (select count(*) from public.daily_logs) as logs,
  (select count(*) from public.daily_log_labor) as labor,
  (select count(*) from public.daily_log_machines) as machines;
insert into public.project_tasks(id,project_id,name,start_date,end_date)
  values('__DL_UX_SELECTION_NONE','DL-WBS-PILOT-20260925','UX none','2099-01-01','2099-12-31'),
    ('__DL_UX_SELECTION_UNKNOWN','DL-WBS-PILOT-20260925','UX unknown','2099-01-01','2099-12-31'),
    ('__DL_UX_SELECTION_KNOWN','DL-WBS-PILOT-20260925','UX known','2099-01-01','2099-12-31');
insert into public.project_daily_task_progress(scope_key,project_id,task_id,progress_date,week_start,progress_percent,quantity_done)
  values('DL-WBS-PILOT-20260925','DL-WBS-PILOT-20260925','__DL_UX_SELECTION_UNKNOWN','2099-01-01',date_trunc('week','2099-01-01'::date)::date,40,null),
    ('DL-WBS-PILOT-20260925','DL-WBS-PILOT-20260925','__DL_UX_SELECTION_KNOWN','2099-01-01',date_trunc('week','2099-01-01'::date)::date,40,40);
create temporary table ux_source_receipts (area text, receipt jsonb);
grant select, insert on ux_source_receipts to authenticated;
insert into public.project_progress_period_states(scope_key,project_id,period_type,period_start,is_locked,locked_by,locked_at)
  values('DL-WBS-PILOT-20260925','DL-WBS-PILOT-20260925','weekly',date_trunc('week','2099-02-10'::date)::date,true,'72000000-0000-4000-8000-000000000004',now());
do $$ begin
  if not exists (select 1 from public.users where id='72000000-0000-4000-8000-000000000001' and role='EMPLOYEE' and auth_id='f30d5711-1a9d-47b2-a536-9424cc66b822') then
    raise exception 'non-admin author fixture missing';
  end if;
end $$;
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$
declare a jsonb; b jsonb; bundle jsonb; again jsonb; detail text; legacy_id uuid;
begin
  if public.is_admin() then raise exception 'admin is not a valid test persona'; end if;
  a := public.create_daily_log_source_v2('75000000-0000-4000-8000-000000000001','DL-WBS-PILOT-20260925',null,'2099-02-01','UX-A','Khu A UX');
  b := public.create_daily_log_source_v2('75000000-0000-4000-8000-000000000002','DL-WBS-PILOT-20260925',null,'2099-02-01','UX-B','Khu B UX');
  if a->>'contributionId'=b->>'contributionId' then raise exception 'two areas reused one source'; end if;
  if exists(select 1 from public.daily_log_contributions where id in ((a->>'contributionId')::uuid,(b->>'contributionId')::uuid) and source_document_version<>2) then raise exception 'v2 creation was not marked'; end if;
  insert into ux_source_receipts values ('A',a),('B',b);
  again := public.create_daily_log_source_v2('75000000-0000-4000-8000-000000000001','DL-WBS-PILOT-20260925',null,'2099-02-01','UX-A','Khu A UX');
  if again is distinct from a then raise exception 'retry did not return original receipt'; end if;
  bundle := public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-02-01',null,(a->>'contributionId')::uuid);
  if bundle->'contribution'->>'id' is distinct from a->>'contributionId' then raise exception 'older source A not explicitly selected'; end if;
  if jsonb_array_length(bundle->'myContributions')<>2 then raise exception 'own area list missing'; end if;
  if bundle->'permissions'->>'canEditSource' is distinct from 'true' then raise exception 'own draft not editable'; end if;
  if bundle->'baselineQuantityStates'->>'__DL_UX_SELECTION_NONE' is distinct from 'none'
    or bundle->'baselineQuantityStates'->>'__DL_UX_SELECTION_UNKNOWN' is distinct from 'unknown'
    or bundle->'baselineQuantityStates'->>'__DL_UX_SELECTION_KNOWN' is distinct from 'known' then
    raise exception 'baseline none/unknown/known conflated';
  end if;
  bundle := public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-02-01',null,null);
  if bundle->'contribution' is distinct from 'null'::jsonb then raise exception 'null selection silently picked latest'; end if;
  bundle := public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-02-10',null,null);
  if bundle->'permissions'->>'canCreateSource' is distinct from 'false' then raise exception 'weekly locked period incorrectly offers creation'; end if;
  begin
    perform public.create_daily_log_source_v2('75000000-0000-4000-8000-000000000007','DL-WBS-PILOT-20260925',null,'2099-02-10','UX-LOCKED','Locked period');
    raise exception 'weekly locked period accepted source';
  exception when insufficient_privilege then
    if sqlerrm<>'PERIOD_LOCKED' then raise; end if;
  end;
  insert into public.daily_log_contributions(project_id,date,author_user_id,author_name,content)
    values('DL-WBS-PILOT-20260925','2099-02-01','72000000-0000-4000-8000-000000000001','Legacy author','Unchanged legacy contract') returning id into legacy_id;
  if (select count(*) from public.daily_log_contributions where project_id='DL-WBS-PILOT-20260925' and construction_site_id is null
    and date='2099-02-01' and author_user_id='72000000-0000-4000-8000-000000000001' and source_document_version=1)<>1 then
    raise exception 'legacy lookup not single-row';
  end if;
  begin
    insert into public.daily_log_contributions(project_id,date,author_user_id,content)
      values('DL-WBS-PILOT-20260925','2099-02-01','72000000-0000-4000-8000-000000000001','Duplicate legacy');
    raise exception 'legacy duplicate day accepted';
  exception when unique_violation then
    get stacked diagnostics detail=constraint_name;
    if detail<>'ux_daily_log_contrib_scope_day_author' then raise; end if;
  end;
  begin
    insert into public.daily_log_contributions(project_id,date,author_user_id,source_document_version)
      values('DL-WBS-PILOT-20260925','2099-02-01','72000000-0000-4000-8000-000000000001',2);
    raise exception 'direct v2 marker spoof accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'DAILY_LOG_SOURCE_V2_CREATION_COMMAND_REQUIRED' then raise; end if;
  end;
  begin
    update public.daily_log_contributions set source_document_version=2 where id=legacy_id;
    raise exception 'legacy row reclassified as v2';
  exception when insufficient_privilege then
    if sqlerrm<>'DAILY_LOG_SOURCE_DOCUMENT_VERSION_IMMUTABLE' then raise; end if;
  end;
  begin
    perform public.create_daily_log_source_v2('75000000-0000-4000-8000-000000000001','DL-WBS-PILOT-20260925',null,'2099-02-01','UX-C','Khu C UX');
    raise exception 'command reuse with changed payload accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'DAILY_LOG_SOURCE_COMMAND_REUSE_MISMATCH' then raise; end if;
  end;
  begin
    perform public.create_daily_log_source_v2('75000000-0000-4000-8000-000000000003','DL-WBS-PILOT-20260925',null,'2099-02-01','ux-a','Duplicate UX A');
    raise exception 'duplicate same area accepted';
  exception when unique_violation then
    if sqlerrm<>'DAILY_LOG_SOURCE_AREA_EXISTS' then raise; end if;
    get stacked diagnostics detail=pg_exception_detail;
    if detail::jsonb->>'contributionId' is distinct from a->>'contributionId' then raise exception 'existing ID missing from conflict'; end if;
  end;
  begin
    perform public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-02-02',null,(a->>'contributionId')::uuid);
    raise exception 'wrong day source accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'DAILY_LOG_SOURCE_SELECTION_DENIED' then raise; end if;
  end;
  begin
    perform public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925','wrong-site','2099-02-01',null,(a->>'contributionId')::uuid);
    raise exception 'wrong site source accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_daily_log_source_v2('75000000-0000-4000-8000-000000000006','DL-WBS-PILOT-20260925','wrong-site','2099-02-01','UX-WRONG','Wrong site');
    raise exception 'source creation accepted nonexistent/foreign site';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_daily_log_source_v2('75000000-0000-4000-8000-000000000004','DL-WBS-PILOT-20260925',null,'2026-09-24','PRE','Before cutover');
    raise exception 'pre-cutover v2 write accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'DAILY_LOG_SOURCE_ROLLOUT_DISABLED' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"9d5a2f91-a8cb-4319-9188-3cad28fe4b48","role":"authenticated"}',true);
set local role authenticated;
do $$ declare source_id uuid; begin
  select (receipt->>'contributionId')::uuid into source_id from ux_source_receipts where area='A';
  begin
    perform public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-02-01',null,source_id);
    raise exception 'wrong owner selection accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'DAILY_LOG_SOURCE_SELECTION_DENIED' then raise; end if;
  end;
  begin
    perform public.create_daily_log_source_v2('75000000-0000-4000-8000-000000000001','DL-WBS-PILOT-20260925',null,'2099-02-01','UX-A','Khu A UX');
    raise exception 'other actor reused receipt';
  exception when invalid_parameter_value then
    if sqlerrm<>'DAILY_LOG_SOURCE_COMMAND_REUSE_MISMATCH' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"89441ea9-ec40-46f3-b8ef-b647e6ede9b8","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin
    perform public.create_daily_log_source_v2('75000000-0000-4000-8000-000000000005','DL-WBS-PILOT-20260925',null,'2099-02-01','UX-READ','Reader');
    raise exception 'reader create accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'DAILY_LOG_SOURCE_CREATE_DENIED' then raise; end if;
  end;
  begin
    perform 1 from app_private.daily_log_source_command_receipts;
    raise exception 'private receipt readable';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"47af03e4-4aa8-43b8-8b9f-540ca9099be1","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin
    perform public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-02-01',null,null);
    raise exception 'denied reader accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if (select count(*) from app_private.daily_log_source_command_receipts where command_id::text like '75000000-%')<>2 then raise exception 'retry created extra receipts'; end if;
  if (select count(*) from public.daily_log_contributions where project_id='DL-WBS-PILOT-20260925' and date='2099-02-01')<>3 then raise exception 'unexpected source count'; end if;
  if exists(select 1 from ux_original_sources original left join public.daily_log_contributions c on c.id=original.id
    where c.id is null or (to_jsonb(c)-'source_document_version') is distinct from original.original or c.source_document_version<>original.original_version) then
    raise exception 'historical source changed or reclassified';
  end if;
  if exists(select 1 from public.project_daily_task_progress where project_id='DL-WBS-PILOT-20260925' and progress_date='2099-02-01') then raise exception 'draft created official progress'; end if;
  if (select count(*) from public.project_transactions)<>(select transactions from ux_unchanged_counts)
    or (select count(*) from public.project_daily_task_progress)<>(select progress+2 from ux_unchanged_counts)
    or (select count(*) from public.daily_logs)<>(select logs from ux_unchanged_counts)
    or (select count(*) from public.daily_log_labor)<>(select labor from ux_unchanged_counts)
    or (select count(*) from public.daily_log_machines)<>(select machines from ux_unchanged_counts) then
    raise exception 'source command created a transaction or official progress';
  end if;
end $$;
select 'daily_log_source_selection_smoke PASS' as result;
rollback;

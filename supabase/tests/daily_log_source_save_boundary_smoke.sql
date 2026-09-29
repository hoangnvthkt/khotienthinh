-- Returned-save and actor/command boundaries, all rollback-only on test Cloud.
begin;
create temporary table ux_save_source(id uuid,initial_version bigint);
grant select,insert,update on ux_save_source to authenticated;
insert into public.project_tasks(id,project_id,name,start_date,end_date)
  values('__DL_UX_RETURN_SAVE','DL-WBS-PILOT-20260925','Return save boundary','2099-03-01','2099-03-30');
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
insert into ux_save_source select (public.create_daily_log_source_v2('76200000-0000-4000-8000-000000000001',
  'DL-WBS-PILOT-20260925',null,'2099-03-04','UX-RETURN-SAVE','Returned save')->>'contributionId')::uuid,1;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_id from public.users
  where role='ADMIN' and auth_id is not null order by created_at limit 1),'role','authenticated')::text,true);
do $$ declare source_id uuid; bundle jsonb; token timestamptz; begin
  select id into source_id from ux_save_source;
  if to_regprocedure('public.return_daily_log_source_v2(jsonb)') is null then
    -- Pre-Task4 fixture setup only. Commands below still use a non-admin author.
    update public.daily_log_contributions set status='returned' where id=source_id;
  else
    insert into public.daily_logs(id,project_id,date,created_by,status,summary_source_type)
      values('__DL_UX_RETURN_SETUP','DL-WBS-PILOT-20260925','2099-03-04','Return boundary fixture','draft','member_contributions');
    perform set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
    set local role authenticated;
    bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-04',null,source_id);
    perform public.save_daily_log_source_document_v2(jsonb_build_object('contributionId',source_id,'expectedRowVersion',1,
      'workAreaCode','UX-RETURN-SAVE','workAreaName','Returned save','content','','issues','','photos','[]'::jsonb,
      'items',jsonb_build_array(jsonb_build_object('clientKey','w','taskId','__DL_UX_RETURN_SAVE','entryMode','percent','enteredValue',12,
        'forecastFinishDate','2099-03-30','baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX_RETURN_SAVE')),
      'labor','[]'::jsonb,'machines','[]'::jsonb));
    perform public.submit_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',source_id,'expectedRowVersion',2));
    reset role;
    insert into public.daily_log_summary_sources(id,daily_log_id,contribution_id,source_version,source_fingerprint)
      select '76200000-0000-4000-8000-000000000002','__DL_UX_RETURN_SETUP',id,row_version,source_fingerprint from public.daily_log_contributions where id=source_id;
    select coalesce(last_action_at,created_at) into token from public.daily_logs where id='__DL_UX_RETURN_SETUP';
    perform set_config('request.jwt.claims','{"sub":"195531b5-e124-41bb-8648-e7acb106971a","role":"authenticated"}',true);
    set local role authenticated;
    perform public.return_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',source_id,'expectedRowVersion',3,
      'dailyLogId','__DL_UX_RETURN_SETUP','summarySourceId','76200000-0000-4000-8000-000000000002','expectedSummaryUpdatedAt',token,'reason','Correct content'));
    update ux_save_source set initial_version=4;
    reset role;
  end if;
end $$;
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare payload jsonb; receipt jsonb; begin
  if public.is_admin() then raise exception 'admin is not a valid save-boundary test persona'; end if;
  payload:=jsonb_build_object('contributionId',(select id from ux_save_source),'expectedRowVersion',(select initial_version from ux_save_source),
    'workAreaCode','UX-RETURN-SAVE','workAreaName','Returned save','content','Corrected content','issues','',
    'photos','[]'::jsonb,'items','[]'::jsonb,'labor','[]'::jsonb,'machines','[]'::jsonb);
  receipt:=public.save_daily_log_source_document_v2(payload);
  if (receipt->>'rowVersion')::bigint is distinct from (select initial_version+1 from ux_save_source) or not exists(select 1 from public.daily_log_contributions
    where id=(select id from ux_save_source) and status='returned' and content='Corrected content') then
    raise exception 'returned save lost status or metadata'; end if;
  begin
    update public.daily_log_contributions set source_draft_payload='{}'::jsonb where id=(select id from ux_save_source);
    raise exception 'direct draft payload bypass accepted';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_SOURCE_SAVE_COMMAND_REQUIRED' then raise; end if; end;
  begin
    insert into public.daily_log_contributions(project_id,date,author_user_id,content,source_draft_payload)
      values('DL-WBS-PILOT-20260925','2099-03-05',public.current_app_user_id()::text,'Direct draft bypass','{}'::jsonb);
    raise exception 'direct draft payload insert accepted';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_SOURCE_SAVE_COMMAND_REQUIRED' then raise; end if; end;
  begin
    update public.daily_log_contributions set content='Direct returned bypass',row_version=row_version+1 where id=(select id from ux_save_source);
    raise exception 'direct returned save bypass accepted';
  exception when raise_exception then
    if sqlerrm='direct returned save bypass accepted' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims','{"sub":"9d5a2f91-a8cb-4319-9188-3cad28fe4b48","role":"authenticated"}',true);
do $$ begin
  begin
    perform public.save_daily_log_source_document_v2(jsonb_build_object('contributionId',(select id from ux_save_source),'expectedRowVersion',(select initial_version+1 from ux_save_source),
      'workAreaCode','UX-RETURN-SAVE','workAreaName','Returned save','content','Foreign author','issues','',
      'photos','[]'::jsonb,'items','[]'::jsonb,'labor','[]'::jsonb,'machines','[]'::jsonb));
    raise exception 'foreign author save accepted';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_SOURCE_SAVE_DENIED' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_id from public.users
  where role='ADMIN' and auth_id is not null order by created_at limit 1),'role','authenticated')::text,true);
insert into public.daily_logs(id,project_id,date,created_by,status,summary_source_type) values
  ('__DL_UX_VERIFIED_BOUNDARY','DL-WBS-PILOT-20260925','2099-03-04','Fixture reviewer','verified','member_contributions');
insert into public.daily_log_summary_sources(daily_log_id,contribution_id,review_status)
  select '__DL_UX_VERIFIED_BOUNDARY',id,'accepted' from ux_save_source;
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare bundle jsonb; begin
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-04',null,(select id from ux_save_source));
  if bundle->'permissions'->>'canEditSource' is distinct from 'false' or bundle->'permissions'->>'canSubmitSource' is distinct from 'false' then
    raise exception 'verified-effective source still offers mutation actions'; end if;
  begin
    perform public.save_daily_log_source_document_v2(jsonb_build_object('contributionId',(select id from ux_save_source),'expectedRowVersion',(select initial_version+1 from ux_save_source),
      'workAreaCode','UX-RETURN-SAVE','workAreaName','Returned save','content','Do not change verified source','issues','',
      'photos','[]'::jsonb,'items','[]'::jsonb,'labor','[]'::jsonb,'machines','[]'::jsonb));
    raise exception 'verified-effective source changed';
  exception when insufficient_privilege then if sqlerrm<>'VERIFIED_SOURCE_IMMUTABLE' then raise; end if; end;
end $$;
reset role;
select 'daily_log_source_save_boundary_smoke PASS' result;
rollback;

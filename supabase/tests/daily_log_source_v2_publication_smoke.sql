-- New-format source approval must validate qualified baselines, not legacy MD5.
-- Enforced mode below is transaction-local only; existing pilot stays unchanged.
begin;
insert into public.project_tasks(id,project_id,name,start_date,end_date,fallback_unit,provisional_quantity)
  values('__DL_UX_PUBLISH_V2','DL-WBS-PILOT-20260925','V2 publish leaf','2099-07-01','2099-07-30','m3',100);
create temporary table ux_v2_publish_source(id uuid);
grant select,insert on ux_v2_publish_source to authenticated;
create temporary table ux_v2_revision(receipt jsonb);
grant select,insert,update on ux_v2_revision to authenticated;
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare created jsonb; bundle jsonb; begin
  if public.is_admin() then raise exception 'admin v2 source persona forbidden'; end if;
  created:=public.create_daily_log_source_v2(gen_random_uuid(),'DL-WBS-PILOT-20260925',null,'2099-07-02','UX-PUBLISH-V2','V2 publication area');
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-07-02',null,(created->>'contributionId')::uuid);
  perform public.save_daily_log_source_document_v2(jsonb_build_object('contributionId',created->>'contributionId','expectedRowVersion',1,
    'workAreaCode','UX-PUBLISH-V2','workAreaName','V2 publication area','content','V2 physical source','issues','','photos','[]'::jsonb,
    'items',jsonb_build_array(jsonb_build_object('clientKey','w','taskId','__DL_UX_PUBLISH_V2','entryMode','daily_quantity','enteredValue',12,
      'forecastFinishDate','2099-07-30','baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX_PUBLISH_V2')),
    'labor','[]'::jsonb,'machines','[]'::jsonb));
  perform public.submit_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',created->>'contributionId','expectedRowVersion',2));
  insert into ux_v2_publish_source values((created->>'contributionId')::uuid);
end $$;
reset role;
insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at,submitted_to_user_id)
  values('__DL_UX_PUBLISH_V2_LOG','DL-WBS-PILOT-20260925','2099-07-02','Summarizer fixture','72000000-0000-4000-8000-000000000003',
    'submitted','member_contributions','2099-07-02T12:00:00Z','72000000-0000-4000-8000-000000000004');
insert into public.daily_log_summary_sources(id,daily_log_id,contribution_id,source_version,source_fingerprint,source_snapshot,review_status,source_state)
  select '78100000-0000-4000-8000-000000000001','__DL_UX_PUBLISH_V2_LOG',c.id,c.row_version,c.source_fingerprint,to_jsonb(c),'ready','current'
  from public.daily_log_contributions c join ux_v2_publish_source f on f.id=c.id;
insert into public.daily_log_work_items(id,daily_log_id,summary_source_id,source_work_item_id,project_id,task_id,work_area_code,work_area_name_snapshot,
  task_name_snapshot,unit_snapshot,planned_quantity_snapshot,baseline_progress_percent,baseline_quantity_done,baseline_fingerprint,
  cumulative_progress_percent,cumulative_quantity_done,daily_quantity_done,schedule_finish_date_snapshot,forecast_finish_date)
  select '78100000-0000-4000-8000-000000000002','__DL_UX_PUBLISH_V2_LOG','78100000-0000-4000-8000-000000000001',w.id,w.project_id,w.task_id,
    w.work_area_code,w.work_area_name_snapshot,w.task_name_snapshot,w.unit_snapshot,w.planned_quantity_snapshot,w.baseline_progress_percent,
    w.baseline_quantity_done,w.baseline_fingerprint,w.cumulative_progress_percent,w.cumulative_quantity_done,w.daily_quantity_done,
    w.schedule_finish_date_snapshot,w.forecast_finish_date from public.daily_log_work_items w join ux_v2_publish_source f on f.id=w.contribution_id;
insert into public.daily_log_wbs_decisions(daily_log_id,task_id,official_cumulative_percent,official_cumulative_quantity,official_daily_quantity,
  forecast_finish_date,aggregation_method,daily_quantity_method,included_source_work_item_ids,source_fingerprint)
  select '__DL_UX_PUBLISH_V2_LOG','__DL_UX_PUBLISH_V2',12,12,12,'2099-07-30','single_source','sum_non_overlapping',jsonb_build_array(w.id),'v2-decision'
  from public.daily_log_work_items w join ux_v2_publish_source f on f.id=w.contribution_id;
select app_private.create_daily_log_assignment('__DL_UX_PUBLISH_V2_LOG','72000000-0000-4000-8000-000000000004');
update app_private.daily_log_wbs_rollout_scopes set mode='enforced' where project_id='DL-WBS-PILOT-20260925' and construction_site_id is null;
select set_config('request.jwt.claims','{"sub":"195531b5-e124-41bb-8648-e7acb106971a","role":"authenticated"}',true);
set local role authenticated;
do $$ declare published jsonb; begin
  if public.is_admin() then raise exception 'admin v2 publisher forbidden'; end if;
  published:=public.publish_daily_log_summary_v1('__DL_UX_PUBLISH_V2_LOG','2099-07-02T12:00:00Z','78100000-0000-4000-8000-000000000003');
  if published->>'publishedProgress' is distinct from 'true' then raise exception 'v2 approval did not publish'; end if;
  begin perform public.return_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'dailyLogId','__DL_UX_PUBLISH_V2_LOG',
    'summarySourceId','78100000-0000-4000-8000-000000000001','contributionId',(select id from ux_v2_publish_source),'expectedRowVersion',3,
    'expectedSummaryUpdatedAt',published->>'publishedAt','reason','Not after approval')); raise exception 'approved source returned';
  exception when insufficient_privilege then if sqlerrm<>'VERIFIED_SOURCE_IMMUTABLE' then raise; end if; end;
  insert into ux_v2_revision values(public.create_daily_log_summary_revision_v1('__DL_UX_PUBLISH_V2_LOG','V2 revision regression'));
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8","role":"authenticated"}',true);
set local role authenticated;
do $$ declare revision jsonb; sent jsonb; begin
  select receipt into revision from ux_v2_revision;
  sent:=public.submit_daily_log_summary_v1(revision->>'dailyLogId',(revision->>'createdAt')::timestamptz,
    '72000000-0000-4000-8000-000000000004',null);
  update ux_v2_revision set receipt=sent;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"195531b5-e124-41bb-8648-e7acb106971a","role":"authenticated"}',true);
set local role authenticated;
do $$ declare revision jsonb; published jsonb; begin
  select receipt into revision from ux_v2_revision;
  published:=public.publish_daily_log_summary_v1(revision->>'dailyLogId',(revision->>'updatedAt')::timestamptz,gen_random_uuid());
  if published->>'publishedProgress' is distinct from 'true' then raise exception 'v2 revision did not publish'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.daily_log_contributions where id=(select id from ux_v2_publish_source) and status='included' and row_version=3) then
    raise exception 'v2 approval did not include unchanged source'; end if;
end $$;
select 'daily_log_source_v2_publication_smoke PASS' result;
rollback;

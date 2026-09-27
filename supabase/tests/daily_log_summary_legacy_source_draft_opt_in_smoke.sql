-- New summary UI may copy old normalized slips; it must not reclassify them.
-- Fixture insertion is diagnostic, not proof of source creation through Auth.
begin;
insert into public.project_tasks(id,project_id,name,start_date,end_date,provisional_quantity)
values('__DL_UX6_LEGACY_TASK','DL-WBS-PILOT-20260925','Legacy normalized slip','2099-07-01','2099-07-31',0);
insert into public.daily_log_contributions(id,project_id,date,author_user_id,author_name,status,submitted_at,work_area_code,work_area_name,row_version,source_fingerprint)
values('76000000-0000-4000-8000-000000000001','DL-WBS-PILOT-20260925','2099-07-02','72000000-0000-4000-8000-000000000001','Legacy author','submitted','2099-07-02T10:00:00Z','OLD-A','Old A',3,'legacy-fp');
insert into public.daily_log_work_items(id,contribution_id,project_id,task_id,work_area_code,work_area_name_snapshot,wbs_code_snapshot,task_name_snapshot,baseline_progress_percent,baseline_fingerprint,cumulative_progress_percent,schedule_finish_date_snapshot,forecast_finish_date)
values('76000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000001','DL-WBS-PILOT-20260925','__DL_UX6_LEGACY_TASK','OLD-A','Old A','1','Legacy normalized slip',0,'legacy-baseline',30,'2099-07-31','2099-07-31');
insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at)
values('__DL_UX6_LEGACY_LOG','DL-WBS-PILOT-20260925','2099-07-02','Summarizer','72000000-0000-4000-8000-000000000003','draft','member_contributions','2099-07-02T12:00:00Z');
create temporary table ux6_legacy_original as select to_jsonb(c) as original from public.daily_log_contributions c where id='76000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8","role":"authenticated"}',true);
set local role authenticated;
do $$ declare sources jsonb; items jsonb; decisions jsonb; receipt jsonb; b jsonb; begin
  if public.is_admin() then raise exception 'admin summarizer forbidden'; end if;
  sources:='[{"contributionId":"76000000-0000-4000-8000-000000000001","sourceVersion":3,"sourceFingerprint":"legacy-fp"}]';
  items:='[{"clientKey":"old-work","contributionId":"76000000-0000-4000-8000-000000000001","sourceWorkItemId":"76000000-0000-4000-8000-000000000002","taskId":"__DL_UX6_LEGACY_TASK","cumulativeProgressPercent":30,"forecastFinishDate":"2099-07-31"}]';
  decisions:='[{"taskId":"__DL_UX6_LEGACY_TASK","officialCumulativePercent":null,"aggregationMethod":"manual_override","dailyQuantityMethod":"manual_override","resolutionReason":"","pending":true,"includedSourceWorkItemIds":["76000000-0000-4000-8000-000000000002"]}]';
  -- Unchanged old caller still rejects incomplete official decisions.
  begin
    perform public.save_daily_log_summary_work_v1('__DL_UX6_LEGACY_LOG','2099-07-02T12:00:00Z',sources,items,decisions,'[]','[]');
    raise exception 'legacy producer changed';
  exception when invalid_parameter_value then
    if sqlerrm<>'MANUAL_OVERRIDE_REASON_REQUIRED' then raise; end if;
  end;
  -- Only the explicitly new summary document chooses safe-draft semantics.
  sources:=jsonb_set(sources,'{0,summaryDocumentVersion}','2');
  receipt:=public.save_daily_log_summary_work_v1('__DL_UX6_LEGACY_LOG','2099-07-02T12:00:00Z',sources,items,decisions,'[]','[]');
  b:=public.get_daily_log_wbs_bundle_v1('DL-WBS-PILOT-20260925',null,'2099-07-02','__DL_UX6_LEGACY_LOG');
  if b->'decisions'->0->>'pending'<>'true' or b->'decisions'->0->>'officialCumulativePercent' is not null then raise exception 'new summary lost pending legacy-source draft'; end if;
  if exists(select 1 from public.daily_log_wbs_decisions where daily_log_id='__DL_UX6_LEGACY_LOG') then raise exception 'pending became official'; end if;
  begin
    perform public.submit_daily_log_summary_v1('__DL_UX6_LEGACY_LOG',(receipt->>'updatedAt')::timestamptz,'72000000-0000-4000-8000-000000000004');
    raise exception 'pending legacy-source summary submitted';
  exception when invalid_parameter_value then if sqlerrm<>'SUMMARY_DECISION_INCOMPLETE' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if (select to_jsonb(c) from public.daily_log_contributions c where id='76000000-0000-4000-8000-000000000001') is distinct from (select original from ux6_legacy_original) then raise exception 'legacy source mutated'; end if;
end $$;
rollback;

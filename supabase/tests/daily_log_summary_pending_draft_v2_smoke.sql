-- Canonical non-admin Room actors; all fixtures and schema rehearsal roll back.
begin;
create temporary table ux6_inputs(id integer primary key,input jsonb);
grant select,insert,update on ux6_inputs to authenticated;
insert into public.project_tasks(id,project_id,name,start_date,end_date,fallback_unit,provisional_quantity)
values('__DL_UX6_PENDING_TASK','DL-WBS-PILOT-20260925','Pending shared WBS','2099-06-01','2099-06-30',null,0);
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare a text; receipt jsonb; bundle jsonb; payload jsonb; begin
  if public.is_admin() then raise exception 'admin persona forbidden'; end if;
  for a in select unnest(array['A','B']) loop
    receipt:=public.create_daily_log_source_v2(gen_random_uuid(),'DL-WBS-PILOT-20260925',null,'2099-06-02','UX6-PENDING-'||a,'Pending '||a);
    bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-06-02',null,(receipt->>'contributionId')::uuid);
    payload:=jsonb_build_object('contributionId',receipt->>'contributionId','expectedRowVersion',1,'workAreaCode','UX6-PENDING-'||a,'workAreaName','Pending '||a,
      'content','Pending '||a,'issues','','photos','[]'::jsonb,'labor','[]'::jsonb,'machines','[]'::jsonb,
      'items',jsonb_build_array(jsonb_build_object('clientKey','work','taskId','__DL_UX6_PENDING_TASK','entryMode','percent','enteredValue',30,
        'forecastFinishDate','2099-06-30','baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX6_PENDING_TASK')));
    perform public.save_daily_log_source_document_v2(payload);
    perform public.submit_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',receipt->>'contributionId','expectedRowVersion',2));
  end loop;
end $$;
reset role;
insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at)
values('__DL_UX6_PENDING_LOG','DL-WBS-PILOT-20260925','2099-06-02','UX6 summarizer','72000000-0000-4000-8000-000000000003','draft','member_contributions','2099-06-02T12:00:00Z');
insert into ux6_inputs select 1,jsonb_build_object(
  'sources',(select jsonb_agg(jsonb_build_object('contributionId',c.id,'sourceVersion',c.row_version,'sourceFingerprint',c.source_fingerprint)) from public.daily_log_contributions c where c.date='2099-06-02' and c.work_area_code like 'UX6-PENDING-%'),
  'items',(select jsonb_agg(jsonb_build_object('clientKey',i.id,'contributionId',i.contribution_id,'sourceWorkItemId',i.id,'taskId',i.task_id,'cumulativeProgressPercent',30,'cumulativeQuantityDone',null,'dailyQuantityDone',null,'forecastFinishDate','2099-06-30'))
    from public.daily_log_work_items i join public.daily_log_contributions c on c.id=i.contribution_id where c.date='2099-06-02' and c.work_area_code like 'UX6-PENDING-%'),
  'decisions',jsonb_build_array(jsonb_build_object('taskId','__DL_UX6_PENDING_TASK','officialCumulativePercent',null,'aggregationMethod','manual_override','dailyQuantityMethod','manual_override','resolutionReason','',
    'includedSourceWorkItemIds',(select jsonb_agg(i.id) from public.daily_log_work_items i join public.daily_log_contributions c on c.id=i.contribution_id where c.date='2099-06-02' and c.work_area_code like 'UX6-PENDING-%'))));
select set_config('request.jwt.claims','{"sub":"55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8","role":"authenticated"}',true);
set local role authenticated;
do $$ declare x jsonb; r jsonb; b jsonb; begin
  if public.is_admin() then raise exception 'admin summarizer forbidden'; end if;
  select input into x from ux6_inputs where id=1;
  r:=public.save_daily_log_summary_work_v1('__DL_UX6_PENDING_LOG','2099-06-02T12:00:00Z',x->'sources',x->'items',x->'decisions','[]','[]');
  b:=public.get_daily_log_wbs_bundle_v1('DL-WBS-PILOT-20260925',null,'2099-06-02','__DL_UX6_PENDING_LOG');
  if b->'decisions'->0->>'officialCumulativePercent' is not null or b->'decisions'->0->>'pending'<>'true' then raise exception 'pending draft lost or guessed'; end if;
  if exists(select 1 from public.daily_log_wbs_decisions where daily_log_id='__DL_UX6_PENDING_LOG') then raise exception 'pending official row created'; end if;
  begin perform public.submit_daily_log_summary_v1('__DL_UX6_PENDING_LOG',(r->>'updatedAt')::timestamptz,'72000000-0000-4000-8000-000000000004'); raise exception 'pending summary submitted';
  exception when invalid_parameter_value then if sqlerrm<>'SUMMARY_DECISION_INCOMPLETE' then raise; end if; end;
  begin perform public.save_daily_log_summary_work_v1('__DL_UX6_PENDING_LOG','2099-06-02T12:00:00Z',x->'sources',x->'items',x->'decisions','[]','[]'); raise exception 'stale save accepted';
  exception when sqlstate 'PT409' then if sqlerrm<>'ROW_VERSION_CONFLICT' then raise; end if; end;
  begin execute 'select decisions from app_private.daily_log_summary_decision_drafts_v2'; raise exception 'private pending table exposed';
  exception when insufficient_privilege then null; end;
  x:=jsonb_set(x,'{decisions,0,officialCumulativePercent}','30');
  x:=jsonb_set(x,'{decisions,0,resolutionReason}','"Cùng WBS, đối chiếu 30%"');
  perform public.save_daily_log_summary_work_v1('__DL_UX6_PENDING_LOG',(r->>'updatedAt')::timestamptz,x->'sources',x->'items',x->'decisions','[]','[]');
end $$;
reset role;
do $$ begin
  if exists(select 1 from app_private.daily_log_summary_decision_drafts_v2 where daily_log_id='__DL_UX6_PENDING_LOG' and jsonb_array_length(decisions)>0) then raise exception 'resolved pending draft retained'; end if;
  if (select official_cumulative_percent from public.daily_log_wbs_decisions where daily_log_id='__DL_UX6_PENDING_LOG')<>30 then raise exception 'two 30 percent sources were summed'; end if;
  if not(select attnotnull from pg_attribute where attrelid='public.daily_log_wbs_decisions'::regclass and attname='official_cumulative_percent') then raise exception 'official NOT NULL weakened'; end if;
  if has_function_privilege('authenticated','app_private.save_daily_log_summary_work_legacy_v1(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
    or has_table_privilege('authenticated','app_private.daily_log_summary_decision_drafts_v2','SELECT') then raise exception 'private bypass exposed'; end if;
end $$;
-- A historical copy can have allocation numbers but one unknown unit. This
-- diagnostic changes only rollback-owned copies, never real/legacy sources.
update public.daily_log_work_items set area_planned_quantity_snapshot=50,planned_quantity_snapshot=100,
  unit_snapshot=case when work_area_code='UX6-PENDING-A' then 'm³' else null end
where daily_log_id='__DL_UX6_PENDING_LOG';
do $$ begin
  if not app_private.daily_log_summary_decision_pending_v2('__DL_UX6_PENDING_LOG',jsonb_build_object(
    'taskId','__DL_UX6_PENDING_TASK','officialCumulativePercent',30,'aggregationMethod','weighted_area_allocation',
    'dailyQuantityMethod','sum_non_overlapping','resolutionReason','','pending',false)) then
    raise exception 'partial unknown units were treated as a resolved physical aggregation';
  end if;
end $$;
rollback;

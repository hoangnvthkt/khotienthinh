-- Canonical non-admin Room actors; all fixtures and schema rehearsal roll back.
begin;
create temporary table ux7_resubmit_inputs(id integer primary key,input jsonb);
grant select,insert,update on ux7_resubmit_inputs to authenticated;
insert into public.project_tasks(id,project_id,name,start_date,end_date,fallback_unit,provisional_quantity)
values('__DL_UX7_RESUBMIT_PENDING_TASK','DL-WBS-PILOT-20260925','Pending shared WBS','2099-06-01','2099-06-30',null,0);
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare a text; receipt jsonb; bundle jsonb; payload jsonb; begin
  if public.is_admin() then raise exception 'admin persona forbidden'; end if;
  for a in select unnest(array['A','B']) loop
    receipt:=public.create_daily_log_source_v2(gen_random_uuid(),'DL-WBS-PILOT-20260925',null,'2099-06-02','UX7_RESUBMIT-PENDING-'||a,'Pending '||a);
    bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-06-02',null,(receipt->>'contributionId')::uuid);
    payload:=jsonb_build_object('contributionId',receipt->>'contributionId','expectedRowVersion',1,'workAreaCode','UX7_RESUBMIT-PENDING-'||a,'workAreaName','Pending '||a,
      'content','Pending '||a,'issues','','photos','[]'::jsonb,'labor','[]'::jsonb,'machines','[]'::jsonb,
      'items',jsonb_build_array(jsonb_build_object('clientKey','work','taskId','__DL_UX7_RESUBMIT_PENDING_TASK','entryMode','percent','enteredValue',30,
        'forecastFinishDate','2099-06-30','baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX7_RESUBMIT_PENDING_TASK')));
    perform public.save_daily_log_source_document_v2(payload);
    perform public.submit_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',receipt->>'contributionId','expectedRowVersion',2));
  end loop;
end $$;
reset role;
insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at)
values('__DL_UX7_RESUBMIT_PENDING_LOG','DL-WBS-PILOT-20260925','2099-06-02','UX7_RESUBMIT summarizer','72000000-0000-4000-8000-000000000003','draft','member_contributions','2099-06-02T12:00:00Z');
insert into ux7_resubmit_inputs select 1,jsonb_build_object(
  'sources',(select jsonb_agg(jsonb_build_object('contributionId',c.id,'sourceVersion',c.row_version,'sourceFingerprint',c.source_fingerprint)) from public.daily_log_contributions c where c.date='2099-06-02' and c.work_area_code like 'UX7_RESUBMIT-PENDING-%'),
  'items',(select jsonb_agg(jsonb_build_object('clientKey',i.id,'contributionId',i.contribution_id,'sourceWorkItemId',i.id,'taskId',i.task_id,'cumulativeProgressPercent',30,'cumulativeQuantityDone',null,'dailyQuantityDone',null,'forecastFinishDate','2099-06-30'))
    from public.daily_log_work_items i join public.daily_log_contributions c on c.id=i.contribution_id where c.date='2099-06-02' and c.work_area_code like 'UX7_RESUBMIT-PENDING-%'),
  'decisions',jsonb_build_array(jsonb_build_object('taskId','__DL_UX7_RESUBMIT_PENDING_TASK','officialCumulativePercent',null,'aggregationMethod','manual_override','dailyQuantityMethod','manual_override','resolutionReason','',
    'includedSourceWorkItemIds',(select jsonb_agg(i.id) from public.daily_log_work_items i join public.daily_log_contributions c on c.id=i.contribution_id where c.date='2099-06-02' and c.work_area_code like 'UX7_RESUBMIT-PENDING-%'))));
select set_config('request.jwt.claims','{"sub":"55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8","role":"authenticated"}',true);
set local role authenticated;
do $$ declare x jsonb; r jsonb; b jsonb; begin
  if public.is_admin() then raise exception 'admin summarizer forbidden'; end if;
  select input into x from ux7_resubmit_inputs where id=1;
  r:=public.save_daily_log_summary_work_v1('__DL_UX7_RESUBMIT_PENDING_LOG','2099-06-02T12:00:00Z',x->'sources',x->'items',x->'decisions','[]','[]');
  b:=public.get_daily_log_wbs_bundle_v1('DL-WBS-PILOT-20260925',null,'2099-06-02','__DL_UX7_RESUBMIT_PENDING_LOG');
  if b->'decisions'->0->>'officialCumulativePercent' is not null or b->'decisions'->0->>'pending'<>'true' then raise exception 'pending draft lost or guessed'; end if;
  if exists(select 1 from public.daily_log_wbs_decisions where daily_log_id='__DL_UX7_RESUBMIT_PENDING_LOG') then raise exception 'pending official row created'; end if;
  begin perform public.submit_daily_log_summary_v1('__DL_UX7_RESUBMIT_PENDING_LOG',(r->>'updatedAt')::timestamptz,'72000000-0000-4000-8000-000000000004'); raise exception 'pending summary submitted';
  exception when invalid_parameter_value then if sqlerrm<>'SUMMARY_DECISION_INCOMPLETE' then raise; end if; end;
  begin perform public.save_daily_log_summary_work_v1('__DL_UX7_RESUBMIT_PENDING_LOG','2099-06-02T12:00:00Z',x->'sources',x->'items',x->'decisions','[]','[]'); raise exception 'stale save accepted';
  exception when sqlstate 'PT409' then if sqlerrm<>'ROW_VERSION_CONFLICT' then raise; end if; end;
  begin execute 'select decisions from app_private.daily_log_summary_decision_drafts_v2'; raise exception 'private pending table exposed';
  exception when insufficient_privilege then null; end;
  x:=jsonb_set(x,'{decisions,0,officialCumulativePercent}','30');
  x:=jsonb_set(x,'{decisions,0,resolutionReason}','"Cùng WBS, đối chiếu 30%"');
  perform public.save_daily_log_summary_work_v1('__DL_UX7_RESUBMIT_PENDING_LOG',(r->>'updatedAt')::timestamptz,x->'sources',x->'items',x->'decisions','[]','[]');
end $$;
reset role;
do $$ begin
  if exists(select 1 from app_private.daily_log_summary_decision_drafts_v2 where daily_log_id='__DL_UX7_RESUBMIT_PENDING_LOG' and jsonb_array_length(decisions)>0) then raise exception 'resolved pending draft retained'; end if;
  if (select official_cumulative_percent from public.daily_log_wbs_decisions where daily_log_id='__DL_UX7_RESUBMIT_PENDING_LOG')<>30 then raise exception 'two 30 percent sources were summed'; end if;
  if not(select attnotnull from pg_attribute where attrelid='public.daily_log_wbs_decisions'::regclass and attname='official_cumulative_percent') then raise exception 'official NOT NULL weakened'; end if;
  if has_function_privilege('authenticated','app_private.save_daily_log_summary_work_legacy_v1(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
    or has_table_privilege('authenticated','app_private.daily_log_summary_decision_drafts_v2','SELECT') then raise exception 'private bypass exposed'; end if;
end $$;

create temporary table ux7_resubmit_sources as select id,to_jsonb(c) snapshot from public.daily_log_contributions c where date='2099-06-02' and work_area_code like 'UX7_RESUBMIT-PENDING-%';
select set_config('request.jwt.claims','{"sub":"55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8","role":"authenticated"}',true);
set local role authenticated;
do $$ declare token timestamptz; r jsonb; begin
  if public.is_admin() or app_private.current_actor_has_effective_room_action('DL-WBS-PILOT-20260925',null,'daily_log','approve') then raise exception 'wrong summarizer role'; end if;
  select last_action_at into token from public.daily_logs where id='__DL_UX7_RESUBMIT_PENDING_LOG';
  r:=public.submit_daily_log_summary_v1('__DL_UX7_RESUBMIT_PENDING_LOG',token,'72000000-0000-4000-8000-000000000004');
  if r->>'status'<>'submitted' then raise exception 'initial submit failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"195531b5-e124-41bb-8648-e7acb106971a","role":"authenticated"}',true);
set local role authenticated;
select public.transition_daily_log_status('__DL_UX7_RESUBMIT_PENDING_LOG','rejected',null,null,'CHT returns only summary');
reset role;
do $$ begin
  if not exists(select 1 from public.daily_logs where id='__DL_UX7_RESUBMIT_PENDING_LOG' and status='rejected' and submitted_to_permission='approve') then raise exception 'return route invalid'; end if;
  if exists(select 1 from ux7_resubmit_sources f join public.daily_log_contributions c on c.id=f.id where f.snapshot is distinct from to_jsonb(c)) then raise exception 'summary return changed engineer source'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"89441ea9-ec40-46f3-b8ef-b647e6ede9b8","role":"authenticated"}',true);
set local role authenticated;
do $$ declare token timestamptz; changed integer; begin
  select last_action_at into token from public.daily_logs where id='__DL_UX7_RESUBMIT_PENDING_LOG';
  begin perform public.submit_daily_log_summary_v1('__DL_UX7_RESUBMIT_PENDING_LOG',token,'72000000-0000-4000-8000-000000000004'); raise exception 'reader submitted summary';
  exception when insufficient_privilege then null; end;
  begin update public.daily_logs set status='submitted' where id='__DL_UX7_RESUBMIT_PENDING_LOG';
    get diagnostics changed=row_count; if changed<>0 then raise exception 'reader direct-write succeeded'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.project_progress_period_states(scope_key,project_id,period_type,period_start,is_locked,locked_by,locked_at)
values('DL-WBS-PILOT-20260925','DL-WBS-PILOT-20260925','weekly',date_trunc('week','2099-06-02'::date)::date,true,'72000000-0000-4000-8000-000000000004',now());
select set_config('request.jwt.claims','{"sub":"55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8","role":"authenticated"}',true);
set local role authenticated;
do $$ declare token timestamptz; begin
  select last_action_at into token from public.daily_logs where id='__DL_UX7_RESUBMIT_PENDING_LOG';
  begin perform public.submit_daily_log_summary_v1('__DL_UX7_RESUBMIT_PENDING_LOG',token,'72000000-0000-4000-8000-000000000004'); raise exception 'locked summary submitted';
  exception when sqlstate '55000' then if sqlerrm<>'PERIOD_LOCKED' then raise; end if; end;
end $$;
reset role;
update public.project_progress_period_states set is_locked=false,locked_by=null,locked_at=null where project_id='DL-WBS-PILOT-20260925' and period_start=date_trunc('week','2099-06-02'::date)::date;
select set_config('request.jwt.claims','{"sub":"55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8","role":"authenticated"}',true);
set local role authenticated;
do $$ declare token timestamptz; r jsonb; begin
  select last_action_at into token from public.daily_logs where id='__DL_UX7_RESUBMIT_PENDING_LOG';
  begin perform public.submit_daily_log_summary_v1('__DL_UX7_RESUBMIT_PENDING_LOG',token-interval '1 second','72000000-0000-4000-8000-000000000004'); raise exception 'stale summary submitted';
  exception when sqlstate 'PT409' then if sqlerrm<>'ROW_VERSION_CONFLICT' then raise; end if; end;
  begin perform public.submit_daily_log_summary_v1('__DL_UX7_RESUBMIT_PENDING_LOG',token,'72000000-0000-4000-8000-000000000005'); raise exception 'reader received approval assignment';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_APPROVER_REQUIRED' then raise; end if; end;
  r:=public.submit_daily_log_summary_v1('__DL_UX7_RESUBMIT_PENDING_LOG',token,'72000000-0000-4000-8000-000000000004','Corrected summary');
  if r->>'status'<>'submitted' or r->>'approverUserId'<>'72000000-0000-4000-8000-000000000004' then raise exception 'resubmit receipt invalid'; end if;
end $$;
reset role;
do $$ begin
  if exists(select 1 from ux7_resubmit_sources f join public.daily_log_contributions c on c.id=f.id where f.snapshot is distinct from to_jsonb(c)) then raise exception 'resubmit changed engineer source'; end if;
  if not exists(select 1 from public.app_assignments where subject_id='__DL_UX7_RESUBMIT_PENDING_LOG' and subject_type='daily_log' and responsibility='current_approver' and status='active' and principal_id='72000000-0000-4000-8000-000000000004')
    or exists(select 1 from public.app_assignments where subject_id='__DL_UX7_RESUBMIT_PENDING_LOG' and subject_type='daily_log' and responsibility='revision_owner' and status='active') then raise exception 'resubmit assignment invalid'; end if;
  if has_function_privilege('authenticated','app_private.submit_daily_log_summary_checked_v2(text,timestamptz,uuid,text)','EXECUTE')
    or has_function_privilege('anon','app_private.submit_daily_log_summary_checked_v2(text,timestamptz,uuid,text)','EXECUTE') then raise exception 'private submit bypass exposed'; end if;
end $$;
rollback;

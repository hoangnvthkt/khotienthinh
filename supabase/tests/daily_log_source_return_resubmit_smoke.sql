-- Real canonical Room actors, never admin commands; all fixtures roll back.
begin;
create temporary table ux_transition_sources(area text primary key,id uuid,payload jsonb,original jsonb);
grant select,insert,update on ux_transition_sources to authenticated;
create temporary table ux_transition_counts as select
  (select count(*) from public.project_daily_task_progress) progress,
  (select count(*) from public.project_transactions) transactions,
  (select count(*) from public.daily_log_labor r join public.daily_logs l on l.id=r.daily_log_id where l.status='verified') evidence;
insert into public.project_tasks(id,project_id,name,start_date,end_date,fallback_unit,provisional_quantity)
  values('__DL_UX_TRANSITION','DL-WBS-PILOT-20260925','Lifecycle leaf','2099-04-01','2099-04-30','m3',100);
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare a jsonb; b jsonb; bundle jsonb; payload jsonb; submitted jsonb; area text; begin
  if public.is_admin() then raise exception 'admin lifecycle persona forbidden'; end if;
  for area in select unnest(array['A','B']) loop
    a:=public.create_daily_log_source_v2(gen_random_uuid(),'DL-WBS-PILOT-20260925',null,'2099-04-02','UX-T-'||area,'Lifecycle '||area);
    bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-04-02',null,(a->>'contributionId')::uuid);
    payload:=jsonb_build_object('contributionId',a->>'contributionId','expectedRowVersion',1,
      'workAreaCode','UX-T-'||area,'workAreaName','Lifecycle '||area,'content','Original '||area,'issues','','photos','[]'::jsonb,
      'items',jsonb_build_array(jsonb_build_object('clientKey','work','taskId','__DL_UX_TRANSITION','entryMode','daily_quantity',
        'enteredValue',12,'forecastFinishDate','2099-04-30','baselineFingerprint',bundle->'baselineQuantityFingerprints'->>'__DL_UX_TRANSITION')),
      'labor','[]'::jsonb,'machines','[]'::jsonb);
    perform public.save_daily_log_source_document_v2(payload);
    b:=jsonb_build_object('commandId',gen_random_uuid(),'contributionId',a->>'contributionId','expectedRowVersion',2);
    submitted:=public.submit_daily_log_source_v2(b);
    if submitted->>'status'<>'submitted' or submitted->>'rowVersion'<>'3' then raise exception 'submit receipt invalid'; end if;
    if public.submit_daily_log_source_v2(b) is distinct from submitted then raise exception 'submit retry changed receipt'; end if;
    insert into ux_transition_sources values(area,(a->>'contributionId')::uuid,payload,null);
  end loop;
  a:=public.create_daily_log_source_v2(gen_random_uuid(),'DL-WBS-PILOT-20260925',null,'2099-04-02','UX-T-INCOMPLETE','Incomplete');
  begin perform public.submit_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',a->>'contributionId','expectedRowVersion',1));
    raise exception 'empty source submitted';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_SOURCE_NOT_COMPLETE' then raise; end if; end;
end $$;
reset role;
insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,summary_source_type,last_action_at,submitted_to_user_id)
  values('__DL_UX_T_SUMMARY','DL-WBS-PILOT-20260925','2099-04-02','Lifecycle summary','72000000-0000-4000-8000-000000000003','submitted','member_contributions','2099-04-02T12:00:00Z','72000000-0000-4000-8000-000000000004'),
    ('__DL_UX_T_OTHER','DL-WBS-PILOT-20260925','2099-04-02','Other pending','72000000-0000-4000-8000-000000000003','draft','member_contributions','2099-04-02T12:00:00Z',null);
select app_private.create_daily_log_assignment('__DL_UX_T_SUMMARY','72000000-0000-4000-8000-000000000003');
insert into public.daily_log_summary_sources(id,daily_log_id,contribution_id,source_version,source_fingerprint,source_snapshot,review_status)
  select case area when 'A' then '78000000-0000-4000-8000-000000000001' else '78000000-0000-4000-8000-000000000002' end::uuid,
    '__DL_UX_T_SUMMARY',c.id,c.row_version,c.source_fingerprint,to_jsonb(c),'ready'
  from ux_transition_sources f join public.daily_log_contributions c on c.id=f.id;
insert into public.daily_log_summary_sources(id,daily_log_id,contribution_id,source_version,source_fingerprint,source_snapshot,review_status)
  select '78000000-0000-4000-8000-000000000003','__DL_UX_T_OTHER',c.id,c.row_version,c.source_fingerprint,to_jsonb(c),'ready'
  from ux_transition_sources f join public.daily_log_contributions c on c.id=f.id where f.area='A';
update ux_transition_sources f set original=to_jsonb(c) from public.daily_log_contributions c where c.id=f.id;
create temporary table ux_transition_cards as select id,to_jsonb(s) original from public.daily_log_summary_sources s where daily_log_id like '__DL_UX_T_%';
select set_config('request.jwt.claims','{"sub":"89441ea9-ec40-46f3-b8ef-b647e6ede9b8","role":"authenticated"}',true);
set local role authenticated;
do $$ declare a uuid; begin
  select id into a from ux_transition_sources where area='A';
  begin perform public.return_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',a,'reason','Reader return','expectedRowVersion',3));
    raise exception 'reader returned source';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_SOURCE_RETURN_DENIED' then raise; end if; end;
  begin perform public.submit_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',a,'expectedRowVersion',3));
    raise exception 'reader submitted source';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_SOURCE_SUBMIT_DENIED' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"9d5a2f91-a8cb-4319-9188-3cad28fe4b48","role":"authenticated"}',true);
set local role authenticated;
do $$ declare a uuid; begin
  select id into a from ux_transition_sources where area='A';
  begin perform public.submit_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',a,'expectedRowVersion',3));
    raise exception 'other author submitted A';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_SOURCE_SUBMIT_DENIED' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"195531b5-e124-41bb-8648-e7acb106971a","role":"authenticated"}',true);
set local role authenticated;
do $$ declare a uuid; input jsonb; result jsonb; bad jsonb; begin
  if public.is_admin() then raise exception 'admin CHT forbidden'; end if;
  select id into a from ux_transition_sources where area='A';
  input:=jsonb_build_object('commandId','78000000-0000-4000-8000-000000000004','dailyLogId','__DL_UX_T_SUMMARY',
    'summarySourceId','78000000-0000-4000-8000-000000000001','contributionId',a,'expectedSummaryUpdatedAt','2099-04-02T12:00:00Z',
    'expectedRowVersion',3,'reason','Bổ sung khối lượng và giờ máy');
  begin perform public.return_daily_log_source_v2(input||jsonb_build_object('reason',' ')); raise exception 'blank reason accepted';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_SOURCE_RETURN_REASON_REQUIRED' then raise; end if; end;
  begin perform public.return_daily_log_source_v2(input||jsonb_build_object('summarySourceId','78000000-0000-4000-8000-000000000002')); raise exception 'wrong relationship accepted';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_SOURCE_RELATION_MISMATCH' then raise; end if; end;
  begin perform public.return_daily_log_source_v2(input||jsonb_build_object('expectedRowVersion',2)); raise exception 'stale source accepted';
  exception when sqlstate 'PT409' then if sqlerrm<>'ROW_VERSION_CONFLICT' then raise; end if; end;
  begin perform public.return_daily_log_source_v2(input||jsonb_build_object('expectedSummaryUpdatedAt','2099-04-01T12:00:00Z')); raise exception 'stale summary accepted';
  exception when sqlstate 'PT409' then if sqlerrm<>'SUMMARY_UPDATED_AT_CONFLICT' then raise; end if; end;
  result:=public.return_daily_log_source_v2(input);
  if result->>'status'<>'returned' or result->>'rowVersion'<>'4' then raise exception 'return receipt invalid'; end if;
  if public.return_daily_log_source_v2(input) is distinct from result then raise exception 'return retry changed receipt'; end if;
  begin perform public.return_daily_log_source_v2(input||jsonb_build_object('reason','Changed retry')); raise exception 'changed command replay accepted';
  exception when invalid_parameter_value then if sqlerrm<>'DAILY_LOG_SOURCE_COMMAND_REUSE_MISMATCH' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if (select to_jsonb(c) from public.daily_log_contributions c where id=(select id from ux_transition_sources where area='B'))
    is distinct from (select original from ux_transition_sources where area='B') then raise exception 'B changed while A returned'; end if;
  if not exists(select 1 from public.daily_log_contributions c where id=(select id from ux_transition_sources where area='A')
    and status='returned' and returned_by='72000000-0000-4000-8000-000000000004' and returned_at is not null
    and return_reason='Bổ sung khối lượng và giờ máy' and content='Original A') then raise exception 'return audit/source content invalid'; end if;
  if not exists(select 1 from public.daily_logs where id='__DL_UX_T_SUMMARY' and status='rejected') then raise exception 'pending summary not rejected atomically'; end if;
  if exists(select 1 from public.app_assignments where subject_type='daily_log' and subject_id='__DL_UX_T_SUMMARY' and responsibility='current_approver' and status='active')
    or not exists(select 1 from public.app_assignments where subject_type='daily_log' and subject_id='__DL_UX_T_SUMMARY'
      and responsibility='revision_owner' and principal_id='72000000-0000-4000-8000-000000000003' and status='active') then
    raise exception 'return left stale approver work or omitted summarizer correction assignment'; end if;
  if not exists(select 1 from public.daily_log_summary_sources where id='78000000-0000-4000-8000-000000000001'
    and source_state='returned' and review_status='change_requested' and review_comment='Bổ sung khối lượng và giờ máy' and source_version=3) then raise exception 'card review invalid'; end if;
  if exists(select 1 from public.daily_log_summary_sources s join ux_transition_cards o on o.id=s.id
    where s.id<>'78000000-0000-4000-8000-000000000001' and to_jsonb(s) is distinct from o.original) then raise exception 'other cards mutated'; end if;
  if (select source_snapshot from public.daily_log_summary_sources where id='78000000-0000-4000-8000-000000000001')
    is distinct from (select original->'source_snapshot' from ux_transition_cards where id='78000000-0000-4000-8000-000000000001') then raise exception 'returned card snapshot rewritten'; end if;
  begin perform app_private.assert_daily_log_summary_ready_v1('__DL_UX_T_OTHER',true); raise exception 'returned source remained reviewable';
  exception when serialization_failure then if sqlerrm<>'SUMMARY_SOURCE_REVIEW_BLOCKED' then raise; end if; end;
end $$;
-- Summarizer needs canonical verify, not CHT approve or legacy reviewer grants.
select set_config('request.jwt.claims','{"sub":"55e04a18-d0aa-49c6-ae8d-e5ee3ddd95a8","role":"authenticated"}',true);
set local role authenticated;
do $$ declare b uuid; token timestamptz; begin
  if public.is_admin() or not app_private.current_actor_has_effective_room_action('DL-WBS-PILOT-20260925',null,'daily_log','verify')
    or app_private.current_actor_has_effective_room_action('DL-WBS-PILOT-20260925',null,'daily_log','approve') then raise exception 'wrong summarizer persona'; end if;
  select id into b from ux_transition_sources where area='B';
  select last_action_at into token from public.daily_logs where id='__DL_UX_T_SUMMARY';
  perform public.return_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'dailyLogId','__DL_UX_T_SUMMARY',
    'summarySourceId','78000000-0000-4000-8000-000000000002','contributionId',b,'expectedSummaryUpdatedAt',token,
    'expectedRowVersion',3,'reason','Summarizer correction'));
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare a uuid; payload jsonb; result jsonb; begin
  select id,f.payload into a,payload from ux_transition_sources f where area='A';
  payload:=payload||jsonb_build_object('expectedRowVersion',4,'content','Corrected A');
  perform public.save_daily_log_source_document_v2(payload);
  begin perform public.submit_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',a,'expectedRowVersion',4)); raise exception 'stale submit accepted';
  exception when sqlstate 'PT409' then if sqlerrm<>'ROW_VERSION_CONFLICT' then raise; end if; end;
  result:=public.submit_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',a,'expectedRowVersion',5));
  if result->>'status'<>'submitted' or result->>'rowVersion'<>'6' then raise exception 'own resubmit failed'; end if;
  begin update public.daily_log_contributions set status='returned' where id=a; raise exception 'browser status bypass accepted';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_SOURCE_TRANSITION_COMMAND_REQUIRED' then raise; end if; end;
end $$;
reset role;
-- A source in ANY effective verified log cannot return, even from another draft.
insert into public.daily_logs(id,project_id,date,created_by,status,verified,summary_source_type)
  values('__DL_UX_T_VERIFIED','DL-WBS-PILOT-20260925','2099-04-02','Immutable fixture','verified',true,'member_contributions');
insert into public.daily_log_summary_sources(daily_log_id,contribution_id,source_version,source_fingerprint,source_snapshot,review_status)
  select '__DL_UX_T_VERIFIED',c.id,c.row_version,c.source_fingerprint,to_jsonb(c),'accepted'
  from public.daily_log_contributions c join ux_transition_sources f on f.id=c.id where f.area='A';
-- Explicit refresh fixture for the other pending summary, not a command mutation.
update public.daily_log_summary_sources s set source_version=c.row_version,source_fingerprint=c.source_fingerprint
  from public.daily_log_contributions c where s.contribution_id=c.id and s.id='78000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"sub":"195531b5-e124-41bb-8648-e7acb106971a","role":"authenticated"}',true);
set local role authenticated;
do $$ declare a uuid; begin
  select id into a from ux_transition_sources where area='A';
  begin perform public.return_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'dailyLogId','__DL_UX_T_OTHER',
    'summarySourceId','78000000-0000-4000-8000-000000000003','contributionId',a,'expectedSummaryUpdatedAt','2099-04-02T12:00:00Z',
    'expectedRowVersion',6,'reason','Attempt immutable return')); raise exception 'effective verified source returned';
  exception when insufficient_privilege then if sqlerrm<>'VERIFIED_SOURCE_IMMUTABLE' then raise; end if; end;
end $$;
reset role;
-- Weekly lock applies to both return and submit; keep existing source timestamps.
insert into public.project_progress_period_states(scope_key,project_id,period_type,period_start,is_locked,locked_by,locked_at)
  values('DL-WBS-PILOT-20260925','DL-WBS-PILOT-20260925','weekly',date_trunc('week','2099-04-02'::date)::date,true,'72000000-0000-4000-8000-000000000004',now());
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare b uuid; begin
  select id into b from ux_transition_sources where area='B';
  begin perform public.submit_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',b,'expectedRowVersion',4)); raise exception 'locked source submitted';
  exception when insufficient_privilege then if sqlerrm<>'PERIOD_LOCKED' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"195531b5-e124-41bb-8648-e7acb106971a","role":"authenticated"}',true);
set local role authenticated;
do $$ declare b uuid; begin
  select id into b from ux_transition_sources where area='B';
  begin perform public.return_daily_log_source_v2(jsonb_build_object('commandId',gen_random_uuid(),'contributionId',b,'reason','Locked return','expectedRowVersion',4)); raise exception 'locked source returned';
  exception when insufficient_privilege then if sqlerrm<>'PERIOD_LOCKED' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.daily_log_summary_sources where id='78000000-0000-4000-8000-000000000001'
    and review_status='change_requested' and review_comment='Bổ sung khối lượng và giờ máy' and source_version=3) then raise exception 'resubmit erased review history'; end if;
  if (select count(*) from public.project_daily_task_progress)<>(select progress from ux_transition_counts)
    or (select count(*) from public.project_transactions)<>(select transactions from ux_transition_counts)
    or (select count(*) from public.daily_log_labor r join public.daily_logs l on l.id=r.daily_log_id where l.status='verified')<>(select evidence from ux_transition_counts) then raise exception 'return/resubmit published evidence or money'; end if;
end $$;
select 'daily_log_source_return_resubmit_smoke PASS' result;
rollback;

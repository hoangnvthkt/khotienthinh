-- Requires the dedicated Cloud persona fixture; all writes roll back.
begin;
update app_private.daily_log_wbs_rollout_scopes set mode='enforced'
where project_id='DL-WBS-PILOT-20260925' and construction_site_id is null;
select set_config('request.jwt.claims','{"sub":"195531b5-e124-41bb-8648-e7acb106971a","role":"authenticated"}',true);
set local role authenticated;
do $$
declare v_rows jsonb := '[{"taskId":"DL-WBS-PILOT-TASK","progressPercent":31,"quantityDone":31,"dailyQuantityDone":31}]';
  v_snapshot jsonb := '{"constructionProgressPercent":31,"valueProgressPercent":0,"progressMode":"manual"}';
begin
  begin
    perform public.save_project_progress_period('DL-WBS-PILOT-20260925',null,'daily','2026-09-25',v_rows,v_snapshot);
    raise exception 'manual write bypassed enforced cutover';
  exception when insufficient_privilege then
    if sqlerrm <> 'DAILY_LOG_PROGRESS_REQUIRES_PUBLICATION' then raise; end if;
  end;
  begin
    perform public.close_project_progress_period('DL-WBS-PILOT-20260925',null,'daily','2026-09-25',v_rows,v_snapshot);
    raise exception 'close draft bypassed enforced cutover';
  exception when insufficient_privilege then
    if sqlerrm <> 'DAILY_LOG_PROGRESS_REQUIRES_PUBLICATION' then raise; end if;
  end;
  perform public.close_project_progress_period('DL-WBS-PILOT-20260925',null,'daily','2026-09-25',null,null);
  perform public.reopen_project_progress_period('DL-WBS-PILOT-20260925',null,'daily','2026-09-25','Cutover rollback smoke');
end;
$$;
reset role;
update app_private.daily_log_wbs_rollout_scopes set mode='pilot' where project_id='DL-WBS-PILOT-20260925';
set local role authenticated;
do $$
declare r public.project_daily_task_progress%rowtype;
begin
  select * into strict r from public.project_daily_task_progress where project_id='DL-WBS-PILOT-20260925' and progress_date='2026-09-25';
  begin
    perform public.save_daily_progress_exception_v1(r.id,r.updated_at,31,31,31,'Test','Pilot must not use exception command');
    raise exception 'exception bypassed pilot mode';
  exception when insufficient_privilege then
    if sqlerrm <> 'DAILY_LOG_PROGRESS_NOT_AUTHORITATIVE' then raise; end if;
  end;
  perform public.save_project_progress_period('DL-WBS-PILOT-20260925',null,'daily','2099-01-01',
    '[{"taskId":"DL-WBS-PILOT-TASK","progressPercent":31,"quantityDone":31,"dailyQuantityDone":1}]',
    '{"constructionProgressPercent":31,"valueProgressPercent":0,"progressMode":"manual"}');
end;
$$;
rollback;

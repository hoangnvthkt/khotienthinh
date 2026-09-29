-- Requires the dedicated branch persona fixture. Rolls back all gate transitions.
begin;
do $$
declare v_state jsonb;
begin
  perform app_private.configure_daily_log_pilot_v1('DL-WBS-PILOT-20260925',null,'pilot','2026-09-25',
    'daily-log-wbs-no-shadow-test','72000000-0000-4000-8000-000000000004','Branch-only shadow smoke');
  begin
    perform app_private.configure_daily_log_pilot_v1('DL-WBS-PILOT-20260925',null,'enforced','2026-09-25',
      'daily-log-wbs-no-shadow-test','72000000-0000-4000-8000-000000000004','Cannot skip shadow comparison');
    raise exception 'enforced accepted without shadow evidence';
  exception when others then
    if sqlerrm <> 'PILOT_SHADOW_UNRESOLVED' then raise; end if;
  end;
  v_state := app_private.configure_daily_log_pilot_v1('DL-WBS-PILOT-20260925',null,'paused','2026-09-25',
    'daily-log-wbs-no-shadow-test','72000000-0000-4000-8000-000000000004','Rehearse pause without deleting evidence');
  if v_state->>'mode'<>'paused' then raise exception 'pause failed'; end if;
  if has_function_privilege('authenticated','app_private.configure_daily_log_pilot_v1(text,text,text,date,text,uuid,text)','EXECUTE')
    or has_table_privilege('authenticated','app_private.daily_log_shadow_comparisons','INSERT') then
    raise exception 'client can bypass pilot gate';
  end if;
end;
$$;
rollback;

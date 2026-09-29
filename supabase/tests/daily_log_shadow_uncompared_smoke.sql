-- Branch-only regression: a second submitted summary cannot skip shadow review.
-- All writes, including the synthetic summary, roll back.
begin;
do $$
declare
  prior public.daily_logs%rowtype;
  shadow_rows jsonb;
  release text := 'daily-log-uncompared-smoke';
  pending_id text := 'DL-WBS-UNSHADOWED-SMOKE';
begin
  select * into prior from public.daily_logs
  where project_id='DL-WBS-PILOT-20260925' and status='verified'
    and summary_source_type='member_contributions'
  order by date desc limit 1;
  if prior.id is null then raise exception 'verified fixture missing'; end if;
  perform app_private.configure_daily_log_pilot_v1(prior.project_id,prior.construction_site_id,
    'pilot','2026-09-25',release,'72000000-0000-4000-8000-000000000004','Check all pending summaries');
  shadow_rows := app_private.daily_log_shadow_rows_v1(prior.id);
  if jsonb_array_length(shadow_rows)=0 or exists(
    select 1 from jsonb_array_elements(shadow_rows) row where not (row->>'matches')::boolean
  ) then raise exception 'verified fixture progress mismatch'; end if;
  insert into app_private.daily_log_shadow_comparisons(command_id,daily_log_id,project_id,construction_site_id,
    release_id,log_version,decision_fingerprint,comparisons,mismatch_count,actor_user_id)
  values(gen_random_uuid(),prior.id,prior.project_id,prior.construction_site_id,
    release,prior.last_action_at,md5(shadow_rows::text),shadow_rows,0,
    '72000000-0000-4000-8000-000000000004');
  insert into public.daily_logs(id,project_id,date,created_by,created_by_id,status,
    summary_source_type,submitted_to_permission,submitted_to_user_id,ever_submitted)
  values(pending_id,prior.project_id,'2099-02-03','DL TEST tổng hợp',
    '72000000-0000-4000-8000-000000000003','submitted','member_contributions',
    'approve','72000000-0000-4000-8000-000000000004',true);
  begin
    perform app_private.configure_daily_log_pilot_v1(prior.project_id,prior.construction_site_id,
      'enforced','2026-09-25',release,'72000000-0000-4000-8000-000000000004','Check all pending summaries');
    raise exception 'UNSHADOWED_SUMMARY_ACCEPTED';
  exception when others then
    if sqlerrm <> 'PILOT_SHADOW_UNRESOLVED' then raise; end if;
  end;
end;
$$;
rollback;

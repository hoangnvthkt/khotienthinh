-- Task4 follow-up: scope/link validation without changing applied migrations.
alter function app_private.assert_daily_log_source_ready_v2(public.daily_log_contributions)
  rename to assert_daily_log_source_ready_base_v2;
revoke all on function app_private.assert_daily_log_source_ready_base_v2(public.daily_log_contributions) from public,anon,authenticated;
create function app_private.assert_daily_log_source_ready_v2(p_source public.daily_log_contributions) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform app_private.assert_daily_log_source_ready_base_v2(p_source);
  if exists(select 1 from public.daily_log_labor r left join public.daily_log_work_items w on w.id=r.daily_log_work_item_id
    where r.contribution_id=p_source.id and (r.project_id is distinct from p_source.project_id
      or r.construction_site_id is distinct from p_source.construction_site_id
      or w.contribution_id is distinct from p_source.id or w.task_id is distinct from r.task_id))
    or exists(select 1 from public.daily_log_machines r left join public.daily_log_work_items w on w.id=r.daily_log_work_item_id
    where r.contribution_id=p_source.id and (r.project_id is distinct from p_source.project_id
      or r.construction_site_id is distinct from p_source.construction_site_id
      or w.contribution_id is distinct from p_source.id or w.task_id is distinct from r.task_id)) then
    raise exception using errcode='22023',message='DAILY_LOG_SOURCE_NOT_COMPLETE';
  end if;
end $$;
revoke all on function app_private.assert_daily_log_source_ready_v2(public.daily_log_contributions) from public,anon,authenticated;
notify pgrst,'reload schema';

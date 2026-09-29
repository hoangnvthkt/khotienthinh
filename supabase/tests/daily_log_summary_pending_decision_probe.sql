-- Diagnostic only: reproduce the existing persistence limit, never change schema.
-- Execute only on the authorized test Cloud; every fixture rolls back.
begin;
insert into public.project_tasks(id,project_id,name,start_date,end_date)
values('__DL_UX6_PENDING_PROBE_TASK','DL-WBS-PILOT-20260925','Pending decision probe','2099-08-04','2099-08-30');
insert into public.daily_logs(id,project_id,date,created_by,status,summary_source_type)
values('__DL_UX6_PENDING_PROBE_LOG','DL-WBS-PILOT-20260925','2099-08-04','Pending decision probe','draft','member_contributions');
do $$
declare
  failed_column text;
begin
  begin
    insert into public.daily_log_wbs_decisions(daily_log_id,task_id,official_cumulative_percent,
      aggregation_method,daily_quantity_method,included_source_work_item_ids,source_fingerprint)
    values('__DL_UX6_PENDING_PROBE_LOG','__DL_UX6_PENDING_PROBE_TASK',null,
      'weighted_area_allocation','sum_non_overlapping','["76000000-0000-4000-8000-000000000001"]','pending-probe');
    raise exception 'PENDING_DECISION_UNEXPECTEDLY_ACCEPTED';
  exception when not_null_violation then
    get stacked diagnostics failed_column = column_name;
    if failed_column <> 'official_cumulative_percent' then raise; end if;
    perform set_config('app.pending_probe_result','23502: official_cumulative_percent requires a finalized number',true);
  end;
end;
$$;
select current_setting('app.pending_probe_result') result;
rollback;

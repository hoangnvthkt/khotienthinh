-- A partly unknown unit is pending, not an implicitly comparable quantity.
-- Private V2 helper only: no legacy rows, constraints or snapshots are changed.
create or replace function app_private.daily_log_summary_decision_pending_v2(p_log text,p_decision jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare n integer; areas integer; units integer; missing_basis boolean; allocated numeric; whole numeric; forecasts integer;
begin
  select count(*),count(distinct upper(trim(i.work_area_code))),count(distinct nullif(trim(i.unit_snapshot),'')),
    bool_or(i.area_planned_quantity_snapshot is null or i.area_planned_quantity_snapshot<=0 or nullif(trim(i.unit_snapshot),'') is null),
    sum(i.area_planned_quantity_snapshot),max(i.planned_quantity_snapshot),count(distinct i.forecast_finish_date)
  into n,areas,units,missing_basis,allocated,whole,forecasts
  from public.daily_log_work_items i where i.daily_log_id=p_log and i.task_id=p_decision->>'taskId';
  return coalesce((p_decision->>'pending')::boolean,false)
    or p_decision->>'officialCumulativePercent' is null
    or nullif(p_decision->>'aggregationMethod','') is null or nullif(p_decision->>'dailyQuantityMethod','') is null
    or ((p_decision->>'aggregationMethod'='manual_override' or p_decision->>'dailyQuantityMethod'='manual_override')
      and nullif(trim(p_decision->>'resolutionReason'),'') is null)
    or (n>1 and (missing_basis or areas<n or units<>1 or allocated>whole+0.0001)
      and nullif(trim(p_decision->>'resolutionReason'),'') is null)
    or (forecasts>1 and (p_decision->>'forecastFinishDate' is null
      or nullif(trim(p_decision->>'forecastResolutionReason'),'') is null));
end $$;
revoke all on function app_private.daily_log_summary_decision_pending_v2(text,jsonb) from public,anon,authenticated;

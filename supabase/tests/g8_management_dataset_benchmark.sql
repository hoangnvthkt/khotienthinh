begin;
set local statement_timeout = '30s';

insert into public.users(id,name,email,username,role,is_active,account_status)
values('85555555-5555-4555-8555-555555555555','G8 Perf Admin','g8-perf@example.test','g8-perf','ADMIN',true,'ACTIVE');
insert into public.projects(id,code,name,status)
values('g8-perf-project','G8-PERF','G8 performance project','active');

insert into public.project_tasks(
  id,project_id,name,start_date,end_date,duration,progress,sort_order
)
select 'g8-task-'||series::text,'g8-perf-project','Task '||series::text,
  current_date::text,(current_date+7)::text,7,0,series
from generate_series(1,100000) series;

insert into public.project_work_boq_items(
  id,project_id,source_task_id,wbs_code,name,unit,planned_qty,unit_price,sort_order
)
select 'g8-work-'||series::text,'g8-perf-project','g8-task-'||series::text,
  'WBS-'||series::text,'Work '||series::text,'cv',1,0,series
from generate_series(1,100) series;

insert into public.material_budget_items(
  id,project_id,work_boq_item_id,category,item_name,unit,budget_qty,budget_unit_price,sort_order
)
select 'g8-budget-'||series::text,'g8-perf-project','g8-work-'||series::text,
  'material','Material '||series::text,'kg',1,0,series
from generate_series(1,100) series;

create temp table g8_measurement(run_no integer, mode text, elapsed_ms numeric);

do $$
declare v_started timestamptz; v_result jsonb; v_run integer;
begin
  v_started := clock_timestamp();
  v_result := app_private.list_management_dataset_v1(
    '85555555-5555-4555-8555-555555555555','{"viewId":"M01"}'::jsonb,null,50,now()
  );
  insert into g8_measurement values(0,'cold',extract(epoch from clock_timestamp()-v_started)*1000);
  if (v_result #>> '{totals,rowCount}')::int <> 100 or jsonb_array_length(v_result->'rows') <> 50 then
    raise exception 'G8_PERF_FIXTURE_TOTAL_MISMATCH: %',v_result #> '{totals}';
  end if;
  for v_run in 1..20 loop
    v_started := clock_timestamp();
    perform app_private.list_management_dataset_v1(
      '85555555-5555-4555-8555-555555555555','{"viewId":"M01"}'::jsonb,null,50,now()
    );
    insert into g8_measurement values(v_run,'hot',extract(epoch from clock_timestamp()-v_started)*1000);
  end loop;
end;
$$;

select mode,count(*) samples,round(min(elapsed_ms),2) min_ms,
  round(percentile_cont(0.50) within group(order by elapsed_ms)::numeric,2) p50_ms,
  round(percentile_cont(0.95) within group(order by elapsed_ms)::numeric,2) p95_ms,
  round(max(elapsed_ms),2) max_ms
from g8_measurement group by mode order by mode;

rollback;

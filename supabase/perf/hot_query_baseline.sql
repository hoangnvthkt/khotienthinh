-- Query performance baseline for optimization rounds.
-- Read-only: does not reset pg_stat_statements and does not change schema.
-- Run with:
--   npx supabase db query --linked -f supabase/perf/hot_query_baseline.sql

select
  now() as captured_at,
  case
    when query ilike '%from "activities"%' or query ilike '%from activities%' then 'activities'
    when query ilike '%from "notifications"%' or query ilike '%from notifications%' then 'notifications'
    when query ilike '%from "material_request_events"%' or query ilike '%from material_request_events%' then 'material_request_events'
    when query ilike '%from "project_tasks"%' or query ilike '%from project_tasks%' then 'project_tasks'
    when query ilike '%from "project_work_boq_items"%' or query ilike '%from project_work_boq_items%' then 'project_work_boq_items'
    when query ilike '%count=%' or query ilike '%count(*)%' or query ilike '%count(%' then 'count_query'
    else 'other'
  end as query_group,
  calls,
  rows,
  round(total_exec_time::numeric, 2) as total_exec_time_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_time_ms,
  round(max_exec_time::numeric, 2) as max_exec_time_ms,
  round(stddev_exec_time::numeric, 2) as stddev_exec_time_ms,
  shared_blks_hit,
  shared_blks_read,
  temp_blks_read,
  temp_blks_written,
  regexp_replace(left(query, 2000), '\s+', ' ', 'g') as normalized_query
from pg_stat_statements
where dbid = (
  select oid
  from pg_database
  where datname = current_database()
)
and query not ilike '%pg_stat_statements%'
order by total_exec_time desc
limit 50;

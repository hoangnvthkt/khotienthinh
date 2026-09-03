with inventory as (
  select 'storage.buckets'::text as object_name, count(*)::bigint as row_count,
    coalesce(jsonb_agg(id order by id), '[]'::jsonb) as keys
  from storage.buckets
  union all
  select 'public.permission_applications', count(*),
    coalesce(jsonb_agg(code order by code), '[]'::jsonb)
  from public.permission_applications
  union all
  select 'public.permission_modules', count(*),
    coalesce(jsonb_agg(code order by code), '[]'::jsonb)
  from public.permission_modules
  union all
  select 'public.permission_actions', count(*),
    coalesce(jsonb_agg(permission_code order by permission_code), '[]'::jsonb)
  from public.permission_actions
  union all
  select 'app_private.permission_hardening_settings', count(*),
    coalesce(jsonb_agg(key order by key), '[]'::jsonb)
  from app_private.permission_hardening_settings
  union all
  select 'app_private.hrm_manager_scope_settings', count(*),
    coalesce(jsonb_agg(singleton::text order by singleton), '[]'::jsonb)
  from app_private.hrm_manager_scope_settings
  union all
  select 'public.fleet_system_settings', count(*),
    coalesce(jsonb_agg(id::text order by id), '[]'::jsonb)
  from public.fleet_system_settings
  union all
  select 'cron.job', count(*),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'jobname', jobname,
        'schedule', schedule,
        'active', active,
        'command_hash', md5(command)
      ) order by jobname, jobid
    ), '[]'::jsonb)
  from cron.job
)
select jsonb_build_object(
  'object_name', object_name,
  'row_count', row_count,
  'keys', keys
)::text
from inventory
order by object_name;

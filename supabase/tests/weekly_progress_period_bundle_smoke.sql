\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regprocedure(
    'public.get_project_progress_period_bundle(text,text,text,date,date,date)'
  ) is null then
    raise exception 'weekly progress period bundle RPC is missing';
  end if;

  if to_regclass(
    'public.idx_project_daily_task_progress_scope_task_date_desc'
  ) is null then
    raise exception 'daily latest-per-task index is missing';
  end if;

  if to_regclass(
    'public.idx_project_weekly_task_progress_scope_task_week_desc'
  ) is null then
    raise exception 'weekly latest-per-task index is missing';
  end if;
end;
$$;

select
  progress.project_id as smoke_project_id,
  progress.construction_site_id as smoke_site_id,
  max(progress.progress_date)::text as smoke_period_start,
  (
    max(progress.progress_date)
    - (extract(isodow from max(progress.progress_date))::integer - 1)
  )::text as smoke_week_start,
  (
    max(progress.progress_date)
    - (extract(isodow from max(progress.progress_date))::integer - 1)
    - 49
  )::text as smoke_window_from,
  admin_user.auth_id::text as smoke_admin_auth_id
from public.project_daily_task_progress progress
cross join lateral (
  select user_row.auth_id
  from public.users user_row
  where user_row.role = 'ADMIN'
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
    and user_row.auth_id is not null
  limit 1
) admin_user
group by progress.project_id, progress.construction_site_id, admin_user.auth_id
order by count(*) desc
limit 1
\gset

select user_row.auth_id::text as smoke_denied_auth_id
from public.users user_row
where user_row.auth_id is not null
  and user_row.role <> 'ADMIN'
  and user_row.is_active
  and user_row.account_status = 'ACTIVE'
  and not app_private.project_actor_has_effective_room_action(
    user_row.id,
    :'smoke_project_id',
    :'smoke_site_id',
    'weekly_progress',
    'view'
  )
limit 1
\gset

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'smoke_admin_auth_id', 'role', 'authenticated')::text,
  true
);
select set_config('app.smoke.project_id', :'smoke_project_id', true);
select set_config('app.smoke.site_id', :'smoke_site_id', true);
select set_config('app.smoke.period_start', :'smoke_period_start', true);
select set_config('app.smoke.week_start', :'smoke_week_start', true);
select set_config('app.smoke.window_from', :'smoke_window_from', true);

do $$
declare
  v_bundle jsonb;
  v_daily_baseline_count integer;
  v_daily_baseline_task_count integer;
  v_daily_wrong_week_count integer;
begin
  v_bundle := public.get_project_progress_period_bundle(
    current_setting('app.smoke.project_id'),
    current_setting('app.smoke.site_id'),
    'daily',
    current_setting('app.smoke.period_start')::date,
    current_setting('app.smoke.window_from')::date,
    current_setting('app.smoke.week_start')::date
  );

  if jsonb_typeof(v_bundle -> 'state') <> 'object'
    or jsonb_typeof(v_bundle -> 'tasks') <> 'array'
    or jsonb_typeof(v_bundle -> 'dailyBaselineRows') <> 'array'
    or jsonb_typeof(v_bundle -> 'weeklyRows') <> 'array' then
    raise exception 'weekly progress period bundle shape is invalid';
  end if;

  select count(*), count(distinct row_item ->> 'task_id')
  into v_daily_baseline_count, v_daily_baseline_task_count
  from jsonb_array_elements(v_bundle -> 'dailyBaselineRows') row_item;

  if v_daily_baseline_count <> v_daily_baseline_task_count then
    raise exception 'daily baseline must contain at most one row per task';
  end if;

  select count(*) into v_daily_wrong_week_count
  from jsonb_array_elements(v_bundle -> 'dailyRows') row_item
  where (row_item ->> 'week_start')::date
    <> current_setting('app.smoke.week_start')::date;

  if v_daily_wrong_week_count <> 0 then
    raise exception 'daily period rows escaped the selected week';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'smoke_denied_auth_id', 'role', 'authenticated')::text,
  true
);

do $$
begin
  perform public.get_project_progress_period_bundle(
    current_setting('app.smoke.project_id'),
    current_setting('app.smoke.site_id'),
    'daily',
    current_setting('app.smoke.period_start')::date,
    current_setting('app.smoke.window_from')::date,
    current_setting('app.smoke.week_start')::date
  );
  raise exception 'weekly progress period bundle accepted an unauthorized actor';
exception
  when insufficient_privilege then null;
end;
$$;

rollback;

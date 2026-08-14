create index if not exists idx_project_daily_task_progress_scope_task_date_desc
  on public.project_daily_task_progress (scope_key, task_id, progress_date desc);

create index if not exists idx_project_weekly_task_progress_scope_task_week_desc
  on public.project_weekly_task_progress (scope_key, task_id, week_start desc);

create or replace function app_private.get_project_progress_period_bundle_impl(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date,
  p_window_from_week date,
  p_window_to_week date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_scope_key text;
  v_period_week date;
  v_state public.project_progress_period_states%rowtype;
  v_state_json jsonb;
  v_tasks jsonb;
  v_daily_rows jsonb;
  v_daily_baseline_rows jsonb;
  v_weekly_rows jsonb;
  v_weekly_baseline_rows jsonb;
  v_selected_weekly_rows jsonb;
begin
  v_scope_key := app_private.assert_project_progress_scope_period(
    p_project_id, v_site_id, p_period_type, p_period_start
  );
  perform app_private.assert_project_progress_action(
    v_actor_id, p_project_id, v_site_id, 'view'
  );

  if (p_window_from_week is null) <> (p_window_to_week is null) then
    raise exception 'windowFromWeek and windowToWeek must both be null or both be provided'
      using errcode = '23514';
  end if;
  if p_window_from_week is not null and (
    extract(isodow from p_window_from_week) <> 1
    or extract(isodow from p_window_to_week) <> 1
    or p_window_from_week > p_window_to_week
  ) then
    raise exception 'progress history window must be an ordered Monday range'
      using errcode = '23514';
  end if;

  v_period_week := p_period_start
    - (extract(isodow from p_period_start)::integer - 1);

  select state.* into v_state
  from public.project_progress_period_states state
  where state.scope_key = v_scope_key
    and state.period_type = p_period_type
    and state.period_start = p_period_start;

  if found then
    v_state_json := app_private.project_progress_period_state_json(v_state);
  else
    v_state_json := jsonb_build_object(
      'id', null,
      'scopeKey', v_scope_key,
      'projectId', p_project_id,
      'constructionSiteId', v_site_id,
      'periodType', p_period_type,
      'periodStart', p_period_start,
      'isLocked', false,
      'lockedBy', null,
      'lockedAt', null,
      'unlockedBy', null,
      'unlockedAt', null,
      'unlockReason', null,
      'createdAt', null,
      'updatedAt', null
    );
  end if;

  with task_links as (
    select
      link.task_id,
      jsonb_agg(link.contract_item_id order by link.contract_item_id) as contract_item_ids
    from public.task_contract_items link
    where link.project_id = p_project_id
      and nullif(link.construction_site_id::text, '') is not distinct from v_site_id
    group by link.task_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', task.id,
    'projectId', task.project_id,
    'constructionSiteId', task.construction_site_id,
    'parentId', task.parent_id,
    'name', task.name,
    'wbsCode', task.wbs_code,
    'startDate', task.start_date,
    'endDate', task.end_date,
    'actualStartDate', task.actual_start_date,
    'actualEndDate', task.actual_end_date,
    'duration', task.duration,
    'progress', task.progress,
    'progressMode', task.progress_mode,
    'isMilestone', task.is_milestone,
    'order', task.sort_order,
    'quantity', task.quantity,
    'unit', task.unit,
    'fallbackUnit', task.fallback_unit,
    'provisionalQuantity', task.provisional_quantity,
    'completedQuantity', task.completed_quantity,
    'rowVersion', task.row_version,
    'updatedAt', task.updated_at,
    'contractItemIds', coalesce(task_links.contract_item_ids, '[]'::jsonb)
  ) order by task.sort_order, task.id), '[]'::jsonb)
  into v_tasks
  from public.project_tasks task
  left join task_links on task_links.task_id = task.id
  where task.project_id = p_project_id
    and nullif(task.construction_site_id::text, '') is not distinct from v_site_id;

  select coalesce(jsonb_agg(to_jsonb(daily_row)
    order by daily_row.progress_date, daily_row.updated_at, daily_row.task_id), '[]'::jsonb)
  into v_daily_rows
  from public.project_daily_task_progress daily_row
  where daily_row.scope_key = v_scope_key
    and daily_row.week_start = v_period_week;

  select coalesce(jsonb_agg(to_jsonb(latest_row)
    order by latest_row.task_id), '[]'::jsonb)
  into v_daily_baseline_rows
  from (
    select distinct on (daily_row.task_id) daily_row.*
    from public.project_daily_task_progress daily_row
    where daily_row.scope_key = v_scope_key
      and daily_row.progress_date < v_period_week
    order by daily_row.task_id, daily_row.progress_date desc, daily_row.updated_at desc
  ) latest_row;

  if p_window_from_week is null then
    select coalesce(jsonb_agg(to_jsonb(weekly_row)
      order by weekly_row.week_start, weekly_row.task_id), '[]'::jsonb)
    into v_weekly_rows
    from public.project_weekly_task_progress weekly_row
    where weekly_row.scope_key = v_scope_key;

    v_weekly_baseline_rows := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(to_jsonb(weekly_row)
      order by weekly_row.week_start, weekly_row.task_id), '[]'::jsonb)
    into v_weekly_rows
    from public.project_weekly_task_progress weekly_row
    where weekly_row.scope_key = v_scope_key
      and weekly_row.week_start >= p_window_from_week
      and weekly_row.week_start <= p_window_to_week;

    select coalesce(jsonb_agg(to_jsonb(latest_row)
      order by latest_row.task_id), '[]'::jsonb)
    into v_weekly_baseline_rows
    from (
      select distinct on (weekly_row.task_id) weekly_row.*
      from public.project_weekly_task_progress weekly_row
      where weekly_row.scope_key = v_scope_key
        and weekly_row.week_start < p_window_from_week
      order by weekly_row.task_id, weekly_row.week_start desc, weekly_row.updated_at desc
    ) latest_row;
  end if;

  if p_period_type = 'daily' then
    select coalesce(jsonb_agg(to_jsonb(weekly_row)
      order by weekly_row.updated_at desc, weekly_row.task_id), '[]'::jsonb)
    into v_selected_weekly_rows
    from public.project_weekly_task_progress weekly_row
    where weekly_row.scope_key = v_scope_key
      and weekly_row.week_start = v_period_week;
  else
    select coalesce(jsonb_agg(to_jsonb(latest_row)
      order by latest_row.task_id), '[]'::jsonb)
    into v_selected_weekly_rows
    from (
      select distinct on (weekly_row.task_id) weekly_row.*
      from public.project_weekly_task_progress weekly_row
      where weekly_row.scope_key = v_scope_key
        and weekly_row.week_start <= p_period_start
      order by weekly_row.task_id, weekly_row.week_start desc, weekly_row.updated_at desc
    ) latest_row;
  end if;

  return jsonb_build_object(
    'state', v_state_json,
    'tasks', v_tasks,
    'dailyRows', v_daily_rows,
    'dailyBaselineRows', v_daily_baseline_rows,
    'weeklyRows', v_weekly_rows,
    'weeklyBaselineRows', v_weekly_baseline_rows,
    'selectedWeeklyRows', v_selected_weekly_rows,
    'windowFromWeek', p_window_from_week,
    'windowToWeek', p_window_to_week
  );
end;
$$;

revoke all on function app_private.get_project_progress_period_bundle_impl(
  text, text, text, date, date, date
) from public, anon;
grant execute on function app_private.get_project_progress_period_bundle_impl(
  text, text, text, date, date, date
) to authenticated;

create or replace function public.get_project_progress_period_bundle(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date,
  p_window_from_week date default null,
  p_window_to_week date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_project_progress_period_bundle_impl(
    p_project_id,
    nullif(p_construction_site_id, ''),
    p_period_type,
    p_period_start,
    p_window_from_week,
    p_window_to_week
  );
$$;

revoke all on function public.get_project_progress_period_bundle(
  text, text, text, date, date, date
) from public, anon;
grant execute on function public.get_project_progress_period_bundle(
  text, text, text, date, date, date
) to authenticated;

notify pgrst, 'reload schema';

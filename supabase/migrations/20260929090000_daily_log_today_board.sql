-- Daily Log "Hôm nay tại công trường" board (batch 2A, owner-approved 29/09/2026).
--
-- One read for the landing screen: the day's slips per crew front (mũi) with
-- their work items, labor, machines and photos; fronts that reported in the
-- previous 7 days but not today; the day's summary; yesterday's totals; and a
-- 7-day strip.
--
-- Access: anyone holding Daily Log "view" in the project's Room (or an admin)
-- sees the project's sent slips here, so the CHT and managers get the whole
-- site at a glance even when the legacy slip policy (author, recipient, PBAC)
-- would hide them. Drafts stay private to their author. Without Room view the
-- call is refused. Table policies are unchanged.

create or replace function public.get_daily_log_today_board_v1(
  p_project_id text, p_construction_site_id text, p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor text := public.current_app_user_id()::text;
begin
  if v_actor is null or not (public.is_admin() or app_private.current_actor_has_effective_room_action(
    p_project_id, nullif(p_construction_site_id, ''), 'daily_log', 'view')) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_VIEW_REQUIRED';
  end if;
  return (
  with scoped as (
    select c.*
    from public.daily_log_contributions c
    where c.project_id = p_project_id
      and (nullif(p_construction_site_id, '') is null or c.construction_site_id = p_construction_site_id)
      and c.date between p_date - 7 and p_date
      and (c.status <> 'draft' or c.author_user_id = v_actor)
  ),
  labor as (
    select l.contribution_id, sum(coalesce(l.people_count, l.count, 0)) people,
      sum(coalesce(l.total_labor_hours, 0)) hours
    from public.daily_log_labor l where l.contribution_id in (select id from scoped)
    group by 1
  ),
  machines as (
    select m.contribution_id, sum(coalesce(m.machine_count, 0)) machines,
      sum(coalesce(m.total_machine_hours, 0)) hours
    from public.daily_log_machines m where m.contribution_id in (select id from scoped)
    group by 1
  ),
  items as (
    select w.contribution_id, jsonb_agg(jsonb_build_object(
      'wbsCode', w.wbs_code_snapshot, 'taskName', w.task_name_snapshot, 'unit', w.unit_snapshot,
      'dailyQuantity', w.daily_quantity_done, 'cumulativeQuantity', w.cumulative_quantity_done,
      'cumulativePercent', w.cumulative_progress_percent, 'forecastFinishDate', w.forecast_finish_date,
      'scheduleFinishDate', w.schedule_finish_date_snapshot, 'attachmentCount', coalesce(jsonb_array_length(w.attachments), 0))
      order by w.source_index, w.wbs_code_snapshot) list
    from public.daily_log_work_items w
    where w.contribution_id in (select id from scoped where date = p_date)
    group by 1
  ),
  today_slips as (
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'areaCode', s.work_area_code, 'areaName', s.work_area_name,
      'authorUserId', s.author_user_id, 'authorName', s.author_name, 'status', s.status,
      'submittedAt', s.submitted_at, 'returnReason', s.return_reason, 'returnedByName', s.returned_by_name,
      'issues', nullif(btrim(s.issues), ''),
      'photos', coalesce((select jsonb_agg(p) from (select p from jsonb_array_elements(coalesce(s.photos, '[]'::jsonb)) p limit 4) x), '[]'::jsonb),
      'photoCount', coalesce(jsonb_array_length(s.photos), 0),
      'items', coalesce(i.list, '[]'::jsonb),
      'people', coalesce(l.people, 0), 'laborHours', coalesce(l.hours, 0),
      'machineCount', coalesce(m.machines, 0), 'machineHours', coalesce(m.hours, 0))
      order by s.work_area_code, s.created_at) list
    from scoped s
    left join items i on i.contribution_id = s.id
    left join labor l on l.contribution_id = s.id
    left join machines m on m.contribution_id = s.id
    where s.date = p_date
  ),
  expected as (
    select jsonb_agg(jsonb_build_object('areaCode', e.work_area_code, 'areaName', e.work_area_name,
      'authorUserId', e.author_user_id, 'authorName', e.author_name, 'lastDate', e.date) order by e.work_area_code) list
    from (
      select distinct on (s.work_area_code) s.work_area_code, s.work_area_name, s.author_user_id, s.author_name, s.date
      from scoped s
      where s.date < p_date and s.status <> 'draft' and s.work_area_code is not null
        and not exists (select 1 from scoped t where t.date = p_date and t.work_area_code = s.work_area_code)
      order by s.work_area_code, s.date desc
    ) e
  ),
  summaries as (
    select distinct on (left(d.date, 10)) left(d.date, 10)::date as on_day, d.id, d.status, d.summarized_by_name,
      d.submitted_to_name, d.verified_by, d.weather, nullif(btrim(d.issues), '') issues
    from public.daily_logs d
    where d.project_id = p_project_id
      and (nullif(p_construction_site_id, '') is null or d.construction_site_id = p_construction_site_id)
      and d.summary_source_type = 'member_contributions' and d.superseded_by_daily_log_id is null
      and left(d.date, 10) between (p_date - 6)::text and p_date::text
    order by left(d.date, 10), coalesce(d.revision_no, 1) desc, d.created_at desc
  ),
  days as (
    select gs::date as on_day,
      count(s.id) filter (where s.status <> 'draft') slips,
      coalesce(sum(l.people) filter (where s.status <> 'draft'), 0) people,
      coalesce(sum(m.hours) filter (where s.status <> 'draft'), 0) machine_hours,
      bool_or(s.status <> 'draft' and nullif(btrim(s.issues), '') is not null) slip_issue
    from generate_series(p_date - 6, p_date, interval '1 day') gs
    left join scoped s on s.date = gs::date
    left join labor l on l.contribution_id = s.id
    left join machines m on m.contribution_id = s.id
    group by 1
  )
  select jsonb_build_object(
    'date', p_date,
    'slips', coalesce((select list from today_slips), '[]'::jsonb),
    'missingFronts', coalesce((select list from expected), '[]'::jsonb),
    'summary', (select jsonb_build_object('id', id, 'status', status, 'summarizedByName', summarized_by_name,
        'submittedToName', submitted_to_name, 'verifiedBy', verified_by, 'weather', weather, 'issues', issues)
      from summaries where on_day = p_date),
    'yesterday', (select jsonb_build_object('slips', slips, 'people', people, 'machineHours', machine_hours)
      from days where on_day = p_date - 1),
    'days', (select jsonb_agg(jsonb_build_object('date', d.on_day, 'slips', d.slips, 'people', d.people,
        'machineHours', d.machine_hours, 'summaryStatus', s.status,
        'hasIssue', coalesce(d.slip_issue, false) or s.issues is not null) order by d.on_day)
      from days d left join summaries s on s.on_day = d.on_day)
  ));
end;
$$;

revoke all on function public.get_daily_log_today_board_v1(text, text, date) from public, anon;
grant execute on function public.get_daily_log_today_board_v1(text, text, date) to authenticated;

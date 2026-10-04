-- Nhật ký công trường v3 (chủ SP duyệt 04/10/2026): Báo cáo ngày + phiếu kỹ sư nhập tại dòng.
--
-- 1. get_daily_log_today_board_v1 trả thêm cho từng hạng mục: công tác, ảnh, tổ đội / máy theo dòng,
--    KL kế hoạch, ngày dự kiến xong + lý do — để Báo cáo ngày trả lời "ai, làm gì, bao nhiêu, bao giờ xong".
--    Chỉ thêm trường; quyền đọc (Room view, nháp chỉ tác giả thấy) giữ nguyên.
-- 2. get_daily_log_recent_areas_v1: các mũi đã báo cáo 30 ngày gần đây và phiếu gần nhất của từng mũi
--    (hạng mục, tổ đội, máy, ngày dự kiến xong) để kỹ sư chọn mũi bằng gõ tìm và "Chép từ phiếu trước".
--    Không trả giá / tiền. Cùng quyền với Báo cáo ngày.

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
      'taskId', w.task_id,
      'wbsCode', w.wbs_code_snapshot, 'taskName', w.task_name_snapshot, 'unit', w.unit_snapshot,
      'plannedQuantity', coalesce(w.area_planned_quantity_snapshot, w.planned_quantity_snapshot),
      'baselineQuantity', w.baseline_quantity_done,
      'dailyQuantity', w.daily_quantity_done, 'cumulativeQuantity', w.cumulative_quantity_done,
      'cumulativePercent', w.cumulative_progress_percent, 'forecastFinishDate', w.forecast_finish_date,
      'forecastChangeReason', nullif(btrim(w.forecast_change_reason), ''),
      'scheduleFinishDate', w.schedule_finish_date_snapshot, 'attachmentCount', coalesce(jsonb_array_length(w.attachments), 0),
      'note', nullif(btrim(w.note), ''),
      'photos', coalesce((select jsonb_agg(p) from (select p from jsonb_array_elements(coalesce(w.attachments, '[]'::jsonb)) p limit 6) x), '[]'::jsonb),
      'labor', coalesce((select jsonb_agg(jsonb_build_object(
          'provider', coalesce(nullif(btrim(l.provider_name_snapshot), ''), nullif(btrim(l.manual_provider_name), ''), l.partner_name),
          'laborType', l.labor_type, 'people', coalesce(l.people_count, l.count, 0), 'hours', coalesce(l.total_labor_hours, 0),
          'manual', l.provider_entry_mode = 'manual', 'contractLinked', l.contract_item_id is not null) order by l.source_index)
        from public.daily_log_labor l where l.daily_log_work_item_id = w.id), '[]'::jsonb),
      'machines', coalesce((select jsonb_agg(jsonb_build_object(
          'machineType', m.machine_type, 'provider', coalesce(nullif(btrim(m.provider_name_snapshot), ''), nullif(btrim(m.manual_provider_name), ''), m.partner_name),
          'count', coalesce(m.machine_count, 0), 'hours', coalesce(m.total_machine_hours, 0)) order by m.source_index)
        from public.daily_log_machines m where m.daily_log_work_item_id = w.id), '[]'::jsonb))
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
      d.submitted_to_name, d.verified_by, d.weather, nullif(btrim(d.issues), '') issues, d.submitted_at, d.verified_at, d.worker_count
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
        'submittedToName', submitted_to_name, 'verifiedBy', verified_by, 'weather', weather, 'issues', issues,
        'submittedAt', submitted_at, 'verifiedAt', verified_at)
      from summaries where on_day = p_date),
    'yesterday', (select jsonb_build_object('slips', slips, 'people', people, 'machineHours', machine_hours)
      from days where on_day = p_date - 1),
    'days', (select jsonb_agg(jsonb_build_object('date', d.on_day, 'slips', d.slips, 'people', d.people,
        'machineHours', d.machine_hours, 'summaryStatus', s.status, 'summaryPeople', s.worker_count,
        'hasIssue', coalesce(d.slip_issue, false) or s.issues is not null) order by d.on_day)
      from days d left join summaries s on s.on_day = d.on_day)
  ));
end;
$$;

revoke all on function public.get_daily_log_today_board_v1(text, text, date) from public, anon;
grant execute on function public.get_daily_log_today_board_v1(text, text, date) to authenticated;

create or replace function public.get_daily_log_recent_areas_v1(
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
  return coalesce((
    with visible as (
      select c.*
      from public.daily_log_contributions c
      where c.project_id = p_project_id
        and (nullif(p_construction_site_id, '') is null or c.construction_site_id = p_construction_site_id)
        and c.date between p_date - 30 and p_date
        and c.work_area_code is not null
        and coalesce(c.source_document_version, 1) = 2
        and (c.status <> 'draft' or c.author_user_id = v_actor)
    ),
    latest as (
      select distinct on (v.work_area_code) v.*
      from visible v
      where v.date < p_date
      order by v.work_area_code, v.date desc, v.updated_at desc
    ),
    areas as (
      select distinct on (v.work_area_code) v.work_area_code code, v.work_area_name name
      from visible v
      order by v.work_area_code, v.date desc, v.updated_at desc
    )
    select jsonb_agg(jsonb_build_object(
      'code', a.code, 'name', a.name,
      'lastDate', l.date, 'lastAuthorName', l.author_name, 'lastAuthorUserId', l.author_user_id,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'taskId', w.task_id, 'workBoqItemId', w.work_boq_item_id,
          'forecastFinishDate', w.forecast_finish_date, 'forecastChangeReason', w.forecast_change_reason,
          'cumulativePercent', w.cumulative_progress_percent) order by w.source_index)
        from public.daily_log_work_items w where w.contribution_id = l.id and w.daily_log_id is null), '[]'::jsonb),
      'labor', coalesce((select jsonb_agg(jsonb_build_object(
          'taskId', w.task_id, 'laborType', x.labor_type, 'peopleCount', x.people_count, 'hoursPerPerson', x.hours_per_person,
          'contractItemId', x.contract_item_id,
          'provider', jsonb_build_object('entryMode', x.provider_entry_mode, 'partnerId', x.partner_id,
            'providerCodeSnapshot', x.provider_code_snapshot, 'providerNameSnapshot', x.provider_name_snapshot,
            'manualProviderType', x.manual_provider_type, 'manualProviderName', x.manual_provider_name,
            'manualProviderNote', x.manual_provider_note)) order by x.source_index)
        from public.daily_log_labor x join public.daily_log_work_items w on w.id = x.daily_log_work_item_id
        where x.contribution_id = l.id and x.daily_log_id is null), '[]'::jsonb),
      'machines', coalesce((select jsonb_agg(jsonb_build_object(
          'taskId', w.task_id, 'machineType', x.machine_type, 'machineCount', x.machine_count, 'hoursPerMachine', x.hours_per_machine,
          'provider', jsonb_build_object('entryMode', x.provider_entry_mode, 'partnerId', x.partner_id,
            'providerCodeSnapshot', x.provider_code_snapshot, 'providerNameSnapshot', x.provider_name_snapshot,
            'manualProviderType', x.manual_provider_type, 'manualProviderName', x.manual_provider_name,
            'manualProviderNote', x.manual_provider_note)) order by x.source_index)
        from public.daily_log_machines x join public.daily_log_work_items w on w.id = x.daily_log_work_item_id
        where x.contribution_id = l.id and x.daily_log_id is null), '[]'::jsonb)
    ) order by a.name)
    from areas a left join latest l on l.work_area_code = a.code
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_daily_log_recent_areas_v1(text, text, date) from public, anon;
grant execute on function public.get_daily_log_recent_areas_v1(text, text, date) to authenticated;

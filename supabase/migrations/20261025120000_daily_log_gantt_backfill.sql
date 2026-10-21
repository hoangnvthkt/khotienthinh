-- Nhật ký "Ghi bù theo Gantt" (chủ SP 21/10/2026): phiếu kỹ sư cần ngày bắt đầu / xong thực tế của từng việc để gợi ý
-- ghi bù các việc Gantt đã xong mà nhật ký chưa đủ 100%. Chỉ thêm hai trường vào danh sách việc của bundle.

create or replace function public.get_daily_log_wbs_bundle_base_v1(p_project_id text, p_construction_site_id text, p_log_date date, p_daily_log_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_rollout jsonb;
  v_summary_id text;
begin
  if v_actor_id is null or not app_private.daily_log_can_select(
    p_project_id, p_construction_site_id, v_actor_id
  ) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_WBS_BUNDLE_ACCESS_DENIED';
  end if;

  v_rollout := public.get_daily_log_wbs_rollout_access_v1(
    p_project_id, p_construction_site_id, p_log_date
  );

  select log.id into v_summary_id
  from public.daily_logs log
  where log.project_id = p_project_id
    and log.construction_site_id is not distinct from p_construction_site_id
    and log.date = p_log_date::text
    and log.summary_source_type = 'member_contributions'
    and (p_daily_log_id is null or log.id = p_daily_log_id)
  order by log.created_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'rollout', v_rollout,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', task.id,
        'projectId', task.project_id,
        'constructionSiteId', task.construction_site_id,
        'parentId', task.parent_id,
        'name', task.name,
        'startDate', task.start_date,
        'endDate', task.end_date,
        'duration', task.duration,
        'progress', task.progress,
        'progressMode', task.progress_mode,
        'isMilestone', task.is_milestone,
        'order', task.sort_order,
        'wbsCode', task.wbs_code,
        'fallbackUnit', task.fallback_unit,
        'provisionalQuantity', task.provisional_quantity,
        'actualStartDate', task.actual_start_date,
        'actualEndDate', task.actual_end_date,
        'rowVersion', task.row_version
      ) order by task.sort_order, task.id)
      from public.project_tasks task
      where task.project_id = p_project_id
        and task.construction_site_id is not distinct from p_construction_site_id
    ), '[]'::jsonb),
    'workBoqItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', work.id,
        'projectId', work.project_id,
        'constructionSiteId', work.construction_site_id,
        'sourceTaskId', work.source_task_id,
        'parentId', work.parent_id,
        'wbsCode', work.wbs_code,
        'name', work.name,
        'unit', work.unit,
        'plannedQty', work.planned_qty,
        'sortOrder', work.sort_order,
        'syncStatus', work.sync_status,
        'notes', work.notes
      ) order by work.sort_order, work.id)
      from public.project_work_boq_items work
      where work.project_id = p_project_id
        and work.construction_site_id is not distinct from p_construction_site_id
    ), '[]'::jsonb),
    'resourceProviders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', partner.id,
        'code', partner.code,
        'name', partner.name,
        'classifications', partner.classifications,
        'isActive', partner.is_active
      ) order by partner.name, partner.id)
      from public.business_partners partner
      where partner.is_active
        and partner.classifications && array['supplier', 'contractor', 'crew']::text[]
    ), '[]'::jsonb),
    'previousProgressRows', coalesce((
      select jsonb_agg(to_jsonb(previous_row) order by previous_row.task_id)
      from (
        select distinct on (progress.task_id) progress.*
        from public.project_daily_task_progress progress
        where progress.project_id = p_project_id
          and progress.construction_site_id is not distinct from p_construction_site_id
          and progress.progress_date < p_log_date
        order by progress.task_id, progress.progress_date desc, progress.updated_at desc
      ) previous_row
    ), '[]'::jsonb),
    'nextProgressRows', coalesce((
      select jsonb_agg(to_jsonb(next_row) order by next_row.task_id)
      from (
        select distinct on (progress.task_id) progress.*
        from public.project_daily_task_progress progress
        where progress.project_id = p_project_id
          and progress.construction_site_id is not distinct from p_construction_site_id
          and progress.progress_date > p_log_date
        order by progress.task_id, progress.progress_date, progress.updated_at desc
      ) next_row
    ), '[]'::jsonb),
    'contribution', (
      select to_jsonb(contribution)
      from public.daily_log_contributions contribution
      where contribution.project_id = p_project_id
        and contribution.construction_site_id is not distinct from p_construction_site_id
        and contribution.date = p_log_date
        and contribution.author_user_id = v_actor_id::text
      order by contribution.created_at desc
      limit 1
    ),
    'contributionsForSummary', coalesce((
      select jsonb_agg(to_jsonb(contribution) order by contribution.created_at, contribution.id)
      from public.daily_log_contributions contribution
      where contribution.project_id = p_project_id
        and contribution.construction_site_id is not distinct from p_construction_site_id
        and contribution.date = p_log_date
        and contribution.status in ('submitted', 'included', 'returned')
    ), '[]'::jsonb),
    'summaryLog', (select to_jsonb(log) - 'labor_details' - 'machines' - 'materials' - 'volumes'
      from public.daily_logs log where log.id = v_summary_id),
    'summarySources', coalesce((
      select jsonb_agg(to_jsonb(source) - 'metadata' order by source.sort_order, source.id)
      from public.daily_log_summary_sources source where source.daily_log_id = v_summary_id
    ), '[]'::jsonb),
    'workItems', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.source_index, item.id)
      from public.daily_log_work_items item
      where item.contribution_id in (
          select contribution.id from public.daily_log_contributions contribution
          where contribution.project_id = p_project_id
            and contribution.construction_site_id is not distinct from p_construction_site_id
            and contribution.date = p_log_date
        )
        or item.daily_log_id = v_summary_id
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(to_jsonb(decision) order by decision.task_id)
      from public.daily_log_wbs_decisions decision where decision.daily_log_id = v_summary_id
    ), '[]'::jsonb),
    'labor', coalesce((
      select jsonb_agg(to_jsonb(labor) - 'unit_cost' - 'total_cost' order by labor.source_index, labor.id)
      from public.daily_log_labor labor
      where labor.resource_semantics_version = 2
        and (labor.contribution_id in (
          select contribution.id from public.daily_log_contributions contribution
          where contribution.project_id = p_project_id
            and contribution.construction_site_id is not distinct from p_construction_site_id
            and contribution.date = p_log_date
        ) or labor.daily_log_id = v_summary_id)
    ), '[]'::jsonb),
    'machines', coalesce((
      select jsonb_agg(to_jsonb(machine) - 'unit_cost' - 'total_cost' order by machine.source_index, machine.id)
      from public.daily_log_machines machine
      where machine.resource_semantics_version = 2
        and (machine.contribution_id in (
          select contribution.id from public.daily_log_contributions contribution
          where contribution.project_id = p_project_id
            and contribution.construction_site_id is not distinct from p_construction_site_id
            and contribution.date = p_log_date
        ) or machine.daily_log_id = v_summary_id)
    ), '[]'::jsonb),
    'periodState', (
      select to_jsonb(state)
      from public.project_progress_period_states state
      where state.project_id = p_project_id
        and state.construction_site_id is not distinct from p_construction_site_id
        and state.period_type = 'daily'
        and state.period_start = p_log_date
      limit 1
    ),
    'permissions', jsonb_build_object(
      'canEditSource', exists (
        select 1 from public.daily_log_contributions contribution
        where contribution.project_id = p_project_id
          and contribution.construction_site_id is not distinct from p_construction_site_id
          and contribution.date = p_log_date
          and contribution.author_user_id = v_actor_id::text
          and contribution.status in ('draft', 'returned')
      ),
      'canSummarize', app_private.current_actor_has_effective_room_action(
        p_project_id, p_construction_site_id, 'daily_log', 'verify'
      ),
      'canApprove', app_private.current_actor_has_effective_room_action(
        p_project_id, p_construction_site_id, 'daily_log', 'approve'
      ),
      'canPublishProgress', app_private.current_actor_has_effective_room_action(
        p_project_id, p_construction_site_id, 'daily_log', 'publish_progress'
      )
    )
  );
end;
$function$;

-- DA29 (XinHai): CHT Năm xác nhận 21/10 ghi nhầm ngày xong thực tế trên Gantt cho 4.6.1 (Lắp dựng tôn thưng PĐ1, chưa làm)
-- và 4.1.1.9 (Đổ BT giằng tường móng, cổ cột — chưa xong). Dự án đang khóa sửa ngày thực tế trên Gantt nên sửa tại đây.
update public.project_tasks task
set actual_end_date = null
from public.projects project
where project.id = task.project_id and project.code = 'DA29'
  and (task.id, task.wbs_code, task.actual_end_date) in (
    ('1a591334-f3b4-4af3-a6bf-dc4d7d03cd60', '4.6.1', '2026-10-11'),
    ('6e217548-cd83-4edd-b968-df91a87de45e', '4.1.1.9', '2026-09-30'));

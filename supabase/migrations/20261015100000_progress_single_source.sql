-- Một nguồn tiến độ thực tế (chủ SP duyệt 15/10/2026): dự án đã bật Nhật ký chính thức (rollout enforced)
-- chỉ ghi tiến độ qua nhật ký CHT duyệt. Tuần tự tổng hợp từ nhật ký (write_project_progress_period_payload
-- đã cộng dồn khi công bố); "Xác nhận tuần" chỉ khóa số. Gantt không ghi đè % / cách tính.
-- Dự án chưa bật Nhật ký chính thức giữ nhập tay như cũ.

-- 1. Chặn lưu tay tuần có ngày >= mốc chính thức.
alter function app_private.save_project_progress_period_impl(text,text,text,date,jsonb,jsonb)
rename to save_project_progress_period_daily_guard_v1;
revoke all on function app_private.save_project_progress_period_daily_guard_v1(text,text,text,date,jsonb,jsonb) from public,anon,authenticated;
create function app_private.save_project_progress_period_impl(p_project_id text,p_construction_site_id text,
  p_period_type text,p_period_start date,p_rows jsonb,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r app_private.daily_log_wbs_rollout_scopes%rowtype;
begin
  if p_period_type='weekly' then
    r := app_private.lock_daily_log_rollout_v1(p_project_id,p_construction_site_id);
    if r.mode='enforced' and p_period_start + 6 >= r.cutover_date then
      raise exception using errcode='42501',message='WEEKLY_PROGRESS_FROM_DAILY_LOG';
    end if;
  end if;
  return app_private.save_project_progress_period_daily_guard_v1(p_project_id,p_construction_site_id,p_period_type,p_period_start,p_rows,p_snapshot);
end;
$$;
revoke all on function app_private.save_project_progress_period_impl(text,text,text,date,jsonb,jsonb) from public,anon;
grant execute on function app_private.save_project_progress_period_impl(text,text,text,date,jsonb,jsonb) to authenticated;

-- 2. Xác nhận tuần (chốt) chỉ khóa, không nhận số tay.
alter function app_private.close_project_progress_period_impl(text,text,text,date,jsonb,jsonb)
rename to close_project_progress_period_daily_guard_v1;
revoke all on function app_private.close_project_progress_period_daily_guard_v1(text,text,text,date,jsonb,jsonb) from public,anon,authenticated;
create function app_private.close_project_progress_period_impl(p_project_id text,p_construction_site_id text,
  p_period_type text,p_period_start date,p_rows jsonb,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r app_private.daily_log_wbs_rollout_scopes%rowtype;
begin
  if p_period_type='weekly' and p_rows is not null then
    r := app_private.lock_daily_log_rollout_v1(p_project_id,p_construction_site_id);
    if r.mode='enforced' and p_period_start + 6 >= r.cutover_date then
      raise exception using errcode='42501',message='WEEKLY_PROGRESS_FROM_DAILY_LOG';
    end if;
  end if;
  return app_private.close_project_progress_period_daily_guard_v1(p_project_id,p_construction_site_id,p_period_type,p_period_start,p_rows,p_snapshot);
end;
$$;
revoke all on function app_private.close_project_progress_period_impl(text,text,text,date,jsonb,jsonb) from public,anon;
grant execute on function app_private.close_project_progress_period_impl(text,text,text,date,jsonb,jsonb) to authenticated;

-- 3. Gantt: ở dự án dùng Nhật ký chính thức, % và cách tính của việc có sẵn giữ nguyên; việc mới bắt đầu 0%.
alter function app_private.save_project_gantt_tasks_impl(uuid,text,text,jsonb)
rename to save_project_gantt_tasks_progress_base_v1;
revoke all on function app_private.save_project_gantt_tasks_progress_base_v1(uuid,text,text,jsonb) from public,anon,authenticated;
create function app_private.save_project_gantt_tasks_impl(p_request_id uuid,p_project_id text,
  p_construction_site_id text,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r app_private.daily_log_wbs_rollout_scopes%rowtype;
  v_changes jsonb := p_changes;
begin
  r := app_private.lock_daily_log_rollout_v1(p_project_id,coalesce(p_construction_site_id,''));
  if r.mode='enforced' and jsonb_typeof(coalesce(p_changes,'null'::jsonb))='array' then
    select coalesce(jsonb_agg(case
        when jsonb_typeof(change)<>'object' then change
        when task.id is not null then change || jsonb_build_object('progress',task.progress,'progress_mode',task.progress_mode)
        else change || jsonb_build_object('progress',0,'progress_mode','weekly_report')
      end order by item.ord),'[]'::jsonb)
    into v_changes
    from jsonb_array_elements(p_changes) with ordinality item(change,ord)
    left join public.project_tasks task on jsonb_typeof(item.change)='object' and task.id=item.change->>'id';
  end if;
  return app_private.save_project_gantt_tasks_progress_base_v1(p_request_id,p_project_id,p_construction_site_id,v_changes);
end;
$$;
revoke all on function app_private.save_project_gantt_tasks_impl(uuid,text,text,jsonb) from public,anon;
grant execute on function app_private.save_project_gantt_tasks_impl(uuid,text,text,jsonb) to authenticated;

-- 4. Màn "Tiến độ thực tế": một tuần gồm nguồn (chính thức/nhập tay), trạng thái kỳ, 7 ngày nhật ký,
-- việc lá + lũy kế đầu tuần + số đã ghi từng ngày + số đang chờ CHT duyệt. Chỉ đọc, quyền Xem tiến độ.
create function public.get_project_actual_progress_week_v1(p_project_id text,p_construction_site_id text,p_week_start date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_site text := nullif(btrim(coalesce(p_construction_site_id,'')),'');
  v_scope text;
  v_end date := p_week_start + 6;
  v_mode text;
  v_cutover date;
begin
  if extract(isodow from p_week_start) <> 1 then
    raise exception using errcode='22023',message='WEEK_START_MUST_BE_MONDAY';
  end if;
  perform app_private.assert_project_progress_action(v_actor,p_project_id,v_site,'view');
  v_scope := app_private.project_progress_scope_key(p_project_id,v_site);

  select scope.mode,scope.cutover_date into v_mode,v_cutover
  from app_private.daily_log_wbs_rollout_scopes scope
  where (scope.project_id is null or scope.project_id=p_project_id)
    and (scope.construction_site_id is null or scope.construction_site_id=v_site)
  order by (scope.project_id is not null) desc,(scope.construction_site_id is not null) desc,scope.updated_at desc
  limit 1;

  return jsonb_build_object(
    'weekStart',p_week_start,
    'source',case when v_mode='enforced' and v_end>=v_cutover then 'daily_log' else 'manual' end,
    'cutoverDate',v_cutover,
    'canConfirm',app_private.project_actor_has_effective_room_action(v_actor,p_project_id,v_site,'weekly_progress','confirm'),
    'canEditException',app_private.project_actor_has_effective_room_action(v_actor,p_project_id,v_site,'weekly_progress','edit')
      and app_private.project_actor_has_effective_room_action(v_actor,p_project_id,v_site,'daily_log','publish_progress'),
    'state',(select jsonb_build_object('isLocked',state.is_locked,'lockedAt',state.locked_at,
        'lockedByName',(select u.name from public.users u where u.id=state.locked_by),
        'unlockedAt',state.unlocked_at,'unlockReason',state.unlock_reason)
      from public.project_progress_period_states state
      where state.scope_key=v_scope and state.period_type='weekly' and state.period_start=p_week_start),
    'days',(select coalesce(jsonb_agg(jsonb_build_object(
        'date',day.d,
        'summaryId',summary.id,'summaryStatus',summary.status,
        'verifiedBy',summary.verified_by,'verifiedAt',summary.verified_at,
        'authors',slips.authors,'photos',coalesce(slips.photos,0)+coalesce(jsonb_array_length(case when jsonb_typeof(summary.photos)='array' then summary.photos end),0),
        'progressRows',(select count(*) from public.project_daily_task_progress p where p.scope_key=v_scope and p.progress_date=day.d)
      ) order by day.d),'[]'::jsonb)
      from generate_series(p_week_start,v_end,interval '1 day') gs(day_ts)
      cross join lateral (select gs.day_ts::date d) day
      left join lateral (
        select log.id,log.status,log.verified_by,log.verified_at,log.photos from public.daily_logs log
        where log.project_id=p_project_id and log.construction_site_id is not distinct from v_site
          and log.summary_source_type='member_contributions' and log.superseded_by_daily_log_id is null
          and left(log.date,10)=day.d::text
        order by coalesce(log.revision_no,1) desc,log.created_at desc limit 1
      ) summary on true
      left join lateral (
        select string_agg(distinct coalesce(nullif(btrim(c.author_name),''),'?'),', ') authors,
          sum(jsonb_array_length(c.photos))::int photos
        from public.daily_log_contributions c
        where c.project_id=p_project_id and c.construction_site_id is not distinct from v_site
          and c.date=day.d and c.status in ('submitted','included')
      ) slips on true),
    'tasks',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',task.id,'wbsCode',task.wbs_code,'name',task.name,'sortOrder',task.sort_order,
        'groupId',task.parent_id,'groupName',parent.name,'groupWbs',parent.wbs_code,'groupSort',parent.sort_order,
        'unit',coalesce(nullif(btrim(task.fallback_unit),''),nullif(btrim(task.unit),'')),
        'plannedQuantity',nullif(task.provisional_quantity,0),
        'currentPercent',task.progress,'progressMode',task.progress_mode,
        'startDate',task.start_date,'endDate',task.end_date,'duration',task.duration,'isMilestone',task.is_milestone,
        'resourceCount',task.resource_count,'estimatedCostPerDay',task.estimated_cost_per_day,
        'beforePercent',before.progress_percent,'beforeQuantity',before.quantity_done
      ) order by parent.sort_order nulls first,task.sort_order),'[]'::jsonb)
      from public.project_tasks task
      left join public.project_tasks parent on parent.id=task.parent_id
      left join lateral (
        select p.progress_percent,p.quantity_done from public.project_daily_task_progress p
        where p.scope_key=v_scope and p.task_id=task.id and p.progress_date<p_week_start
        order by p.progress_date desc,p.updated_at desc limit 1
      ) before on true
      where task.project_id=p_project_id and task.construction_site_id is not distinct from v_site
        and not exists (select 1 from public.project_tasks child where child.parent_id=task.id)),
    'entries',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',p.id,'taskId',p.task_id,'date',p.progress_date,'percent',p.progress_percent,
        'quantity',p.quantity_done,'dailyQuantity',p.daily_quantity_done,
        'sourceDailyLogId',p.source_daily_log_id,'updatedAt',p.updated_at
      ) order by p.progress_date,p.task_id),'[]'::jsonb)
      from public.project_daily_task_progress p
      where p.scope_key=v_scope and p.progress_date between p_week_start and v_end),
    'pending',(select coalesce(jsonb_agg(jsonb_build_object(
        'taskId',decision.task_id,'date',left(log.date,10),'percent',decision.official_cumulative_percent,
        'dailyQuantity',decision.official_daily_quantity
      ) order by log.date,decision.task_id),'[]'::jsonb)
      from public.daily_logs log
      join public.daily_log_wbs_decisions decision on decision.daily_log_id=log.id
      where log.project_id=p_project_id and log.construction_site_id is not distinct from v_site
        and log.summary_source_type='member_contributions' and log.superseded_by_daily_log_id is null
        and log.status='submitted' and left(log.date,10) between p_week_start::text and v_end::text)
  );
end;
$$;
revoke all on function public.get_project_actual_progress_week_v1(text,text,date) from public,anon;
grant execute on function public.get_project_actual_progress_week_v1(text,text,date) to authenticated;

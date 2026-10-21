-- % hạng mục cha = trung bình có trọng số của mọi việc lá bên dưới, trọng số = số ngày kế hoạch
-- (chủ SP chốt 21/10/2026). Trước đây cha cộng theo khối lượng tạm tính khi mọi con có KL — lẫn đơn vị
-- (kg + m2 + m3) nên việc có số kg lớn át hết — còn lại thì trung bình cộng con.
-- Trọng số giống calculateProjectProgress / get_project_task_progress_v1 để % dòng gốc khớp % dự án.
-- Cha chỉ 100% khi mọi việc lá đạt 100%, còn lại tối đa 99%.

create or replace function app_private.project_task_progress_weight_v1(task public.project_tasks)
returns numeric language sql immutable set search_path = '' as $$
  with d as (
    select (case
      when coalesce(task.is_milestone, false) then 1
      when coalesce(task.duration, 0) > 0 then task.duration
      else greatest(1, coalesce(nullif(task.end_date, '')::date - nullif(task.start_date, '')::date, 1))
    end)::numeric as days
  )
  select case
    when coalesce(task.estimated_cost_per_day, 0) * d.days > 0 then task.estimated_cost_per_day * d.days
    else d.days * greatest(1, coalesce(nullif(task.resource_count, 0), 1))
  end
  from d;
$$;
revoke all on function app_private.project_task_progress_weight_v1(public.project_tasks) from public, anon, authenticated;

create or replace function app_private.write_project_progress_period_payload(p_actor_id uuid, p_scope_key text, p_project_id text, p_construction_site_id text, p_period_type text, p_period_start date, p_rows jsonb, p_snapshot jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_site_id text := nullif(p_construction_site_id, '');
  v_week_start date := case
    when p_period_type = 'weekly' then p_period_start
    else p_period_start - (extract(isodow from p_period_start)::integer - 1)
  end;
  v_week_state public.project_progress_period_states%rowtype;
  v_weekly_frozen boolean := false;
  v_parent_depth integer := 0;
  v_max_parent_depth integer := 0;
begin
  perform app_private.assert_project_progress_rows(
    p_project_id, v_site_id, p_period_type, p_rows
  );
  perform app_private.assert_project_progress_snapshot(p_snapshot);

  if p_period_type = 'daily' then
    insert into public.project_progress_period_states (
      scope_key, project_id, construction_site_id, period_type, period_start
    ) values (
      p_scope_key, p_project_id, v_site_id, 'weekly', v_week_start
    ) on conflict (scope_key, period_type, period_start) do nothing;

    select state.* into v_week_state
    from public.project_progress_period_states state
    where state.scope_key = p_scope_key
      and state.period_type = 'weekly'
      and state.period_start = v_week_start
    for update;

    v_weekly_frozen := v_week_state.is_locked;

    insert into public.project_daily_task_progress (
      scope_key, project_id, construction_site_id, task_id,
      progress_date, week_start, progress_percent, quantity_done,
      daily_quantity_done, note, attachments, source_daily_log_id,
      updated_by, updated_at
    )
    select
      p_scope_key,
      p_project_id,
      v_site_id,
      item.value ->> 'taskId',
      p_period_start,
      v_week_start,
      (item.value ->> 'progressPercent')::numeric,
      coalesce(nullif(item.value ->> 'quantityDone', '')::numeric, 0),
      coalesce(nullif(item.value ->> 'dailyQuantityDone', '')::numeric, 0),
      nullif(btrim(item.value ->> 'note'), ''),
      coalesce(item.value -> 'attachments', '[]'::jsonb),
      nullif(btrim(item.value ->> 'sourceDailyLogId'), ''),
      p_actor_id::text,
      now()
    from jsonb_array_elements(p_rows) item(value)
    on conflict (scope_key, task_id, progress_date) do update
    set project_id = excluded.project_id,
        construction_site_id = excluded.construction_site_id,
        week_start = excluded.week_start,
        progress_percent = excluded.progress_percent,
        quantity_done = excluded.quantity_done,
        daily_quantity_done = excluded.daily_quantity_done,
        note = excluded.note,
        attachments = excluded.attachments,
        source_daily_log_id = excluded.source_daily_log_id,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

    if not v_weekly_frozen then
      insert into public.project_weekly_task_progress (
        scope_key, project_id, construction_site_id, task_id, week_start,
        progress_percent, quantity_done, note, attachments, updated_by, updated_at
      )
      select distinct on (daily.task_id)
        p_scope_key,
        p_project_id,
        v_site_id,
        daily.task_id,
        v_week_start,
        daily.progress_percent,
        daily.quantity_done,
        daily.note,
        daily.attachments,
        p_actor_id::text,
        now()
      from public.project_daily_task_progress daily
      where daily.scope_key = p_scope_key
        and daily.week_start = v_week_start
        and daily.task_id in (
          select item.value ->> 'taskId'
          from jsonb_array_elements(p_rows) item(value)
        )
      order by daily.task_id, daily.progress_date desc, daily.updated_at desc
      on conflict (scope_key, task_id, week_start) do update
      set project_id = excluded.project_id,
          construction_site_id = excluded.construction_site_id,
          progress_percent = excluded.progress_percent,
          quantity_done = excluded.quantity_done,
          note = excluded.note,
          attachments = excluded.attachments,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;

      perform app_private.upsert_project_progress_snapshot(
        p_scope_key, p_project_id, v_site_id, v_week_start, p_snapshot
      );
    end if;
  else
    insert into public.project_weekly_task_progress (
      scope_key, project_id, construction_site_id, task_id, week_start,
      progress_percent, quantity_done, note, attachments, updated_by, updated_at
    )
    select
      p_scope_key,
      p_project_id,
      v_site_id,
      item.value ->> 'taskId',
      p_period_start,
      (item.value ->> 'progressPercent')::numeric,
      coalesce(nullif(item.value ->> 'quantityDone', '')::numeric, 0),
      nullif(btrim(item.value ->> 'note'), ''),
      coalesce(item.value -> 'attachments', '[]'::jsonb),
      p_actor_id::text,
      now()
    from jsonb_array_elements(p_rows) item(value)
    on conflict (scope_key, task_id, week_start) do update
    set project_id = excluded.project_id,
        construction_site_id = excluded.construction_site_id,
        progress_percent = excluded.progress_percent,
        quantity_done = excluded.quantity_done,
        note = excluded.note,
        attachments = excluded.attachments,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

    perform app_private.upsert_project_progress_snapshot(
      p_scope_key, p_project_id, v_site_id, p_period_start, p_snapshot
    );
  end if;

  with submitted_tasks as (
    select item.value ->> 'taskId' as task_id
    from jsonb_array_elements(p_rows) item(value)
  ), daily_ranked as (
    select
      daily.task_id,
      daily.progress_percent,
      daily.progress_date as effective_date,
      row_number() over (
        partition by daily.task_id
        order by daily.progress_date desc, daily.updated_at desc
      ) as recency_rank
    from public.project_daily_task_progress daily
    join submitted_tasks submitted on submitted.task_id = daily.task_id
    where p_period_type = 'daily'
      and daily.scope_key = p_scope_key
  ), authoritative_progress as (
    select ranked.task_id, ranked.progress_percent, ranked.effective_date
    from daily_ranked ranked
    where ranked.recency_rank = 1
    union all
    select weekly.task_id, weekly.progress_percent, weekly.week_start
    from public.project_weekly_task_progress weekly
    join submitted_tasks submitted on submitted.task_id = weekly.task_id
    where p_period_type = 'weekly'
      and weekly.scope_key = p_scope_key
      and weekly.week_start = p_period_start
  )
  update public.project_tasks task
  set progress = authoritative.progress_percent,
      progress_mode = 'weekly_report',
      actual_start_date = case
        when authoritative.progress_percent > 0
          then coalesce(task.actual_start_date, authoritative.effective_date)
        else task.actual_start_date
      end,
      actual_end_date = case
        when authoritative.progress_percent >= 100
          then coalesce(task.actual_end_date, authoritative.effective_date)
        else task.actual_end_date
      end,
      gate_status = case
        when authoritative.progress_percent >= 100 then 'approved'
        when task.gate_status in ('pending', 'approved') then 'none'
        else task.gate_status
      end,
      gate_approved_by = case
        when authoritative.progress_percent < 100
          and task.gate_status in ('pending', 'approved') then null
        else task.gate_approved_by
      end,
      gate_approved_at = case
        when authoritative.progress_percent < 100
          and task.gate_status in ('pending', 'approved') then null
        else task.gate_approved_at
      end
  from authoritative_progress authoritative
  where task.id = authoritative.task_id
    and task.project_id is not distinct from p_project_id
    and nullif(task.construction_site_id::text, '') is not distinct from v_site_id;

  -- Recompute changed tasks' ancestors: weighted average of every leaf below,
  -- weight = planned days (same rule as calculateProjectProgress and
  -- get_project_task_progress_v1). Parent progress is clamped to 0..100 even
  -- though leaf over-completion remains supported.
  with recursive ancestors(task_id, depth) as (
    select task.parent_id, 1
    from public.project_tasks task
    where task.id in (
      select item.value ->> 'taskId'
      from jsonb_array_elements(p_rows) item(value)
    )
      and task.project_id is not distinct from p_project_id
      and nullif(task.construction_site_id::text, '') is not distinct from v_site_id
      and task.parent_id is not null
    union all
    select parent.parent_id, ancestors.depth + 1
    from ancestors
    join public.project_tasks parent on parent.id = ancestors.task_id
    where parent.project_id is not distinct from p_project_id
      and nullif(parent.construction_site_id::text, '') is not distinct from v_site_id
      and parent.parent_id is not null
      and ancestors.depth < 100
  )
  select coalesce(max(ancestors.depth), 0)
  into v_max_parent_depth
  from ancestors;

  for v_parent_depth in 1..v_max_parent_depth loop
    with recursive ancestors(task_id, depth) as (
      select task.parent_id, 1
      from public.project_tasks task
      where task.id in (
        select item.value ->> 'taskId'
        from jsonb_array_elements(p_rows) item(value)
      )
        and task.project_id is not distinct from p_project_id
        and nullif(task.construction_site_id::text, '') is not distinct from v_site_id
        and task.parent_id is not null
      union all
      select parent.parent_id, ancestors.depth + 1
      from ancestors
      join public.project_tasks parent on parent.id = ancestors.task_id
      where parent.project_id is not distinct from p_project_id
        and nullif(parent.construction_site_id::text, '') is not distinct from v_site_id
        and parent.parent_id is not null
        and ancestors.depth < 100
    ), target_parent as (
      select distinct ancestors.task_id
      from ancestors
      where ancestors.depth = v_parent_depth
    ), descendants(root_id, task_id) as (
      select target.task_id, child.id
      from target_parent target
      join public.project_tasks child on child.parent_id = target.task_id
      where child.project_id is not distinct from p_project_id
        and nullif(child.construction_site_id::text, '') is not distinct from v_site_id
      union
      select descendants.root_id, child.id
      from descendants
      join public.project_tasks child on child.parent_id = descendants.task_id
      where child.project_id is not distinct from p_project_id
        and nullif(child.construction_site_id::text, '') is not distinct from v_site_id
    ), derived as (
      select
        descendants.root_id as id,
        case when bool_and(leaf.progress >= 100) then 100 else least(99, greatest(0, round(
          sum(round(least(100, greatest(0, leaf.progress))) * app_private.project_task_progress_weight_v1(leaf))
          / nullif(sum(app_private.project_task_progress_weight_v1(leaf)), 0)
        ))) end as progress
      from descendants
      join public.project_tasks leaf on leaf.id = descendants.task_id
      where not exists (select 1 from public.project_tasks child where child.parent_id = leaf.id)
      group by descendants.root_id
    )
    update public.project_tasks task
    set progress = derived.progress,
        progress_mode = 'children_auto',
        gate_status = case
          when derived.progress >= 100 then 'approved'
          when task.gate_status in ('pending', 'approved') then 'none'
          else task.gate_status
        end,
        gate_approved_by = case
          when derived.progress < 100 and task.gate_status in ('pending', 'approved') then null
          else task.gate_approved_by
        end,
        gate_approved_at = case
          when derived.progress < 100 and task.gate_status in ('pending', 'approved') then null
          else task.gate_approved_at
        end,
        actual_end_date = case
          when derived.progress >= 100 then coalesce(task.actual_end_date, p_period_start)
          else task.actual_end_date
        end
    from derived
    where task.id = derived.id;
  end loop;

  return v_weekly_frozen;
end;
$function$;

-- Tính lại % mọi hạng mục cha theo quy tắc mới (chỉ đổi %). Cha chỉ 100% khi mọi việc lá 100% — cách cũ làm tròn
-- trung bình có thể ra 100% khi còn việc dở (vd SMB 9 còn 9.14 ở 0%).
with recursive descendants(root_id, task_id) as (
  select parent.id, child.id
  from public.project_tasks parent
  join public.project_tasks child on child.parent_id = parent.id
  union
  select descendants.root_id, child.id
  from descendants
  join public.project_tasks child on child.parent_id = descendants.task_id
), derived as (
  select descendants.root_id as id,
    case when bool_and(leaf.progress >= 100) then 100 else least(99, greatest(0, round(
      sum(round(least(100, greatest(0, leaf.progress))) * app_private.project_task_progress_weight_v1(leaf))
      / nullif(sum(app_private.project_task_progress_weight_v1(leaf)), 0)
    ))) end::integer as progress
  from descendants
  join public.project_tasks leaf on leaf.id = descendants.task_id
  where not exists (select 1 from public.project_tasks child where child.parent_id = leaf.id)
  group by descendants.root_id
)
update public.project_tasks task
set progress = derived.progress
from derived
where task.id = derived.id
  and task.progress is distinct from derived.progress;

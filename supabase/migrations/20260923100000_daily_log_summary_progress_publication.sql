alter table public.project_daily_task_progress
  alter column quantity_done drop not null,
  alter column daily_quantity_done drop not null;

create table public.daily_log_publish_commands (
  command_id uuid primary key,
  daily_log_id text not null references public.daily_logs(id) on delete restrict,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (daily_log_id),
  constraint daily_log_publish_commands_result_check check (
    result is null or jsonb_typeof(result) = 'object'
  )
);

alter table public.daily_log_publish_commands enable row level security;
revoke all on table public.daily_log_publish_commands from public, anon, authenticated;

create function app_private.assert_daily_log_summary_resources_v1(
  p_daily_log_id text
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.daily_log_labor labor
    where labor.daily_log_id = p_daily_log_id
      and (
        labor.resource_semantics_version <> 2
        or labor.daily_log_work_item_id is null
        or labor.summary_source_id is null
        or coalesce(labor.people_count, 0) <= 0
        or coalesce(labor.hours_per_person, 0) <= 0
        or labor.unit_cost is not null
        or labor.total_cost is not null
      )
  ) or exists (
    select 1 from public.daily_log_machines machine
    where machine.daily_log_id = p_daily_log_id
      and (
        machine.resource_semantics_version <> 2
        or machine.daily_log_work_item_id is null
        or machine.summary_source_id is null
        or coalesce(machine.machine_count, 0) <= 0
        or coalesce(machine.hours_per_machine, 0) <= 0
        or machine.unit_cost is not null
        or machine.total_cost is not null
      )
  ) then
    raise exception using errcode = '22023', message = 'RESOURCE_SEMANTICS_VERSION_REQUIRED';
  end if;

  if exists (
    select 1 from (
      select labor.provider_entry_mode, labor.partner_id, labor.manual_provider_type,
        labor.manual_provider_name
      from public.daily_log_labor labor
      where labor.daily_log_id = p_daily_log_id and labor.resource_semantics_version = 2
      union all
      select machine.provider_entry_mode, machine.partner_id, machine.manual_provider_type,
        machine.manual_provider_name
      from public.daily_log_machines machine
      where machine.daily_log_id = p_daily_log_id and machine.resource_semantics_version = 2
    ) resource
    where resource.provider_entry_mode = 'catalog'
      and not exists (
        select 1 from public.business_partners partner
        where partner.id = resource.partner_id
          and partner.is_active
          and partner.classifications && array['supplier', 'contractor']::text[]
      )
  ) then
    raise exception using errcode = '22023', message = 'CATALOG_PROVIDER_NOT_ACTIVE';
  end if;

  if exists (
    select 1 from (
      select labor.provider_entry_mode, labor.manual_provider_type, labor.manual_provider_name
      from public.daily_log_labor labor
      where labor.daily_log_id = p_daily_log_id and labor.resource_semantics_version = 2
      union all
      select machine.provider_entry_mode, machine.manual_provider_type, machine.manual_provider_name
      from public.daily_log_machines machine
      where machine.daily_log_id = p_daily_log_id and machine.resource_semantics_version = 2
    ) resource
    where resource.provider_entry_mode = 'manual'
      and nullif(trim(resource.manual_provider_type), '') is null
  ) then
    raise exception using errcode = '22023', message = 'MANUAL_PROVIDER_TYPE_REQUIRED';
  end if;

  if exists (
    select 1 from (
      select labor.provider_entry_mode, labor.manual_provider_name
      from public.daily_log_labor labor
      where labor.daily_log_id = p_daily_log_id and labor.resource_semantics_version = 2
      union all
      select machine.provider_entry_mode, machine.manual_provider_name
      from public.daily_log_machines machine
      where machine.daily_log_id = p_daily_log_id and machine.resource_semantics_version = 2
    ) resource
    where resource.provider_entry_mode = 'manual'
      and nullif(trim(resource.manual_provider_name), '') is null
  ) then
    raise exception using errcode = '22023', message = 'MANUAL_PROVIDER_NAME_REQUIRED';
  end if;
end;
$$;

revoke all on function app_private.assert_daily_log_summary_resources_v1(text)
  from public, anon, authenticated;

create function app_private.assert_daily_log_summary_ready_v1(
  p_daily_log_id text,
  p_require_current_sources boolean default true
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.daily_log_summary_sources source
    where source.daily_log_id = p_daily_log_id
  ) then
    raise exception using errcode = '22023', message = 'SUMMARY_SOURCE_REQUIRED';
  end if;

  if exists (
    select 1
    from public.daily_log_summary_sources source
    left join public.daily_log_contributions contribution on contribution.id = source.contribution_id
    where source.daily_log_id = p_daily_log_id
      and (
        contribution.id is null
        or contribution.status not in ('submitted', 'included')
        or source.review_status in ('change_requested', 'superseded')
        or (p_require_current_sources and source.source_state <> 'current')
        or source.source_version is distinct from contribution.row_version
        or source.source_fingerprint is distinct from contribution.source_fingerprint
      )
  ) then
    raise exception using errcode = '40001', message = 'SUMMARY_SOURCE_REVIEW_BLOCKED';
  end if;

  if exists (
    select 1 from public.daily_log_work_items item
    where item.daily_log_id = p_daily_log_id
      and item.forecast_finish_date is distinct from item.schedule_finish_date_snapshot
      and nullif(trim(item.forecast_change_reason), '') is null
  ) or exists (
    select 1 from public.daily_log_wbs_decisions decision
    join lateral (
      select min(item.forecast_finish_date) as first_forecast,
        max(item.forecast_finish_date) as last_forecast
      from public.daily_log_work_items item
      where item.daily_log_id = decision.daily_log_id and item.task_id = decision.task_id
    ) forecast on true
    where decision.daily_log_id = p_daily_log_id
      and forecast.first_forecast is distinct from forecast.last_forecast
      and nullif(trim(decision.forecast_resolution_reason), '') is null
  ) then
    raise exception using errcode = '22023', message = 'FORECAST_CHANGE_REASON_REQUIRED';
  end if;

  if exists (
    select 1 from public.daily_log_work_items item
    where item.daily_log_id = p_daily_log_id
      and not exists (
        select 1 from public.daily_log_wbs_decisions decision
        where decision.daily_log_id = item.daily_log_id and decision.task_id = item.task_id
      )
  ) or exists (
    select 1 from public.daily_log_wbs_decisions decision
    where decision.daily_log_id = p_daily_log_id
      and exists (
        select 1 from jsonb_array_elements_text(decision.included_source_work_item_ids) included(id)
        where not exists (
          select 1 from public.daily_log_work_items item
          where item.daily_log_id = decision.daily_log_id
            and item.task_id = decision.task_id
            and (item.id = included.id::uuid or item.source_work_item_id = included.id::uuid)
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'SUMMARY_DECISION_INCOMPLETE';
  end if;

  perform app_private.assert_daily_log_summary_resources_v1(p_daily_log_id);
end;
$$;

revoke all on function app_private.assert_daily_log_summary_ready_v1(text, boolean)
  from public, anon, authenticated;

create function public.submit_daily_log_summary_v1(
  p_daily_log_id text,
  p_expected_updated_at timestamptz,
  p_approver_user_id uuid,
  p_submission_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_log public.daily_logs%rowtype;
begin
  select log.* into v_log
  from public.daily_logs log
  where log.id = p_daily_log_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;
  if not (v_log.summary_source_type = 'member_contributions'
    and v_log.status in ('draft', 'rejected')) then
    raise exception using errcode = '42501', message = 'SUMMARY_NOT_SUBMITTABLE';
  end if;
  if coalesce(v_log.last_action_at, v_log.created_at) is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT';
  end if;
  if not app_private.current_actor_has_effective_room_action(
      v_log.project_id, v_log.construction_site_id, 'daily_log', 'verify')
    or not app_private.current_actor_has_effective_room_action(
      v_log.project_id, v_log.construction_site_id, 'daily_log', 'submit') then
    raise exception using errcode = '42501', message = 'DAILY_LOG_SUMMARIZE_AND_SUBMIT_REQUIRED';
  end if;
  if not app_private.daily_log_user_can_receive_assignment(
    v_log.project_id, v_log.construction_site_id, 'project.daily_log.approve', p_approver_user_id
  ) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVER_REQUIRED';
  end if;
  if exists (
    select 1 from public.project_progress_period_states state
    where state.project_id = v_log.project_id
      and state.construction_site_id is not distinct from v_log.construction_site_id
      and state.is_locked
      and (
        (state.period_type = 'daily' and state.period_start = v_log.date::date)
        or (state.period_type = 'weekly' and state.period_start = date_trunc('week', v_log.date::date)::date)
      )
  ) then raise exception using errcode = '55000', message = 'PERIOD_LOCKED'; end if;

  perform app_private.assert_daily_log_summary_ready_v1(p_daily_log_id, true);
  perform public.transition_daily_log_status(
    p_daily_log_id, 'submitted', p_approver_user_id::text, null, null
  );
  if nullif(trim(p_submission_note), '') is not null then
    update public.daily_logs set submission_note = trim(p_submission_note) where id = p_daily_log_id;
  end if;
  select log.* into v_log from public.daily_logs log where log.id = p_daily_log_id;
  return jsonb_build_object(
    'dailyLogId', v_log.id,
    'status', v_log.status,
    'updatedAt', v_log.last_action_at,
    'approverUserId', v_log.submitted_to_user_id
  );
end;
$$;

create function public.publish_daily_log_summary_v1(
  p_daily_log_id text,
  p_expected_updated_at timestamptz,
  p_command_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_log public.daily_logs%rowtype;
  v_existing_result jsonb;
  v_scope_key text;
  v_week_start date;
  v_rows jsonb;
  v_snapshot jsonb;
  v_construction_progress numeric := 0;
  v_progress_fingerprint text;
  v_resource_fingerprint text;
  v_published_task_ids jsonb;
  v_resource_line_ids jsonb;
  v_published_at timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if v_actor_id is null or p_command_id is null then
    raise exception using errcode = '42501', message = 'PUBLISH_ACTOR_AND_COMMAND_REQUIRED';
  end if;

  select command.result into v_existing_result
  from public.daily_log_publish_commands command
  where command.command_id = p_command_id
  for update;
  if found and v_existing_result is not null then return v_existing_result; end if;
  select command.result into v_existing_result
  from public.daily_log_publish_commands command
  where command.daily_log_id = p_daily_log_id
  for update;
  if found and v_existing_result is not null then return v_existing_result; end if;

  select log.* into v_log
  from public.daily_logs log
  where log.id = p_daily_log_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;

  select command.result into v_existing_result
  from public.daily_log_publish_commands command
  where command.command_id = p_command_id or command.daily_log_id = p_daily_log_id
  order by (command.command_id = p_command_id) desc
  limit 1
  for update;
  if found and v_existing_result is not null then return v_existing_result; end if;

  if not (v_log.summary_source_type = 'member_contributions' and v_log.status = 'submitted') then
    raise exception using errcode = '42501', message = 'SUBMITTED_SUMMARY_REQUIRED';
  end if;
  if coalesce(v_log.last_action_at, v_log.created_at) is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT';
  end if;
  if not app_private.current_actor_has_effective_room_action(
      v_log.project_id, v_log.construction_site_id, 'daily_log', 'approve')
    or not app_private.current_actor_has_effective_room_action(
      v_log.project_id, v_log.construction_site_id, 'daily_log', 'publish_progress') then
    raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVE_AND_PUBLISH_REQUIRED';
  end if;
  if not app_private.can_act_on_subject_impl('daily_log', p_daily_log_id, 'approve') then
    raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVAL_ASSIGNMENT_REQUIRED';
  end if;

  v_week_start := date_trunc('week', v_log.date::date)::date;
  if exists (
    select 1 from public.project_progress_period_states state
    where state.project_id = v_log.project_id
      and state.construction_site_id is not distinct from v_log.construction_site_id
      and state.is_locked
      and (
        (state.period_type = 'daily' and state.period_start = v_log.date::date)
        or (state.period_type = 'weekly' and state.period_start = v_week_start)
      )
  ) then raise exception using errcode = '55000', message = 'PERIOD_LOCKED'; end if;

  perform 1 from public.daily_log_summary_sources source
    where source.daily_log_id = p_daily_log_id for update;
  perform 1 from public.daily_log_work_items item
    where item.daily_log_id = p_daily_log_id for update;
  perform 1 from public.daily_log_wbs_decisions decision
    where decision.daily_log_id = p_daily_log_id for update;
  perform 1 from public.project_daily_task_progress progress
    where progress.project_id = v_log.project_id
      and progress.construction_site_id is not distinct from v_log.construction_site_id
      and progress.task_id in (
        select decision.task_id from public.daily_log_wbs_decisions decision
        where decision.daily_log_id = p_daily_log_id
      )
    for update;

  perform app_private.assert_daily_log_summary_ready_v1(p_daily_log_id, true);

  if exists (
    select 1
    from public.daily_log_work_items item
    left join lateral (
      select progress.* from public.project_daily_task_progress progress
      where progress.project_id = v_log.project_id
        and progress.construction_site_id is not distinct from v_log.construction_site_id
        and progress.task_id = item.task_id
        and progress.progress_date < v_log.date::date
      order by progress.progress_date desc, progress.updated_at desc limit 1
    ) baseline on true
    where item.daily_log_id = p_daily_log_id
      and item.baseline_fingerprint <> md5(concat_ws('|', baseline.id::text,
        coalesce(baseline.progress_percent, 0)::text,
        coalesce(baseline.quantity_done, 0)::text, baseline.updated_at::text))
  ) then raise exception using errcode = '40001', message = 'STALE_PROGRESS_BASELINE'; end if;

  if exists (
    select 1 from public.daily_log_wbs_decisions decision
    left join lateral (
      select progress.progress_percent from public.project_daily_task_progress progress
      where progress.project_id = v_log.project_id
        and progress.construction_site_id is not distinct from v_log.construction_site_id
        and progress.task_id = decision.task_id and progress.progress_date < v_log.date::date
      order by progress.progress_date desc, progress.updated_at desc limit 1
    ) previous on true
    left join lateral (
      select progress.progress_percent from public.project_daily_task_progress progress
      where progress.project_id = v_log.project_id
        and progress.construction_site_id is not distinct from v_log.construction_site_id
        and progress.task_id = decision.task_id and progress.progress_date > v_log.date::date
      order by progress.progress_date, progress.updated_at desc limit 1
    ) following on true
    where decision.daily_log_id = p_daily_log_id
      and (
        decision.official_cumulative_percent < coalesce(previous.progress_percent, 0)
        or (following.progress_percent is not null
          and decision.official_cumulative_percent > following.progress_percent)
      )
  ) then raise exception using errcode = '22023', message = 'BACKDATED_PROGRESS_CONFLICT'; end if;

  v_scope_key := app_private.assert_project_progress_scope_period(
    v_log.project_id, v_log.construction_site_id, 'daily', v_log.date::date
  );
  insert into public.project_progress_period_states (
    scope_key, project_id, construction_site_id, period_type, period_start
  ) values (v_scope_key, v_log.project_id, v_log.construction_site_id, 'daily', v_log.date::date)
  on conflict (scope_key, period_type, period_start) do nothing;
  perform 1 from public.project_progress_period_states state
    where state.scope_key = v_scope_key and state.period_type = 'daily'
      and state.period_start = v_log.date::date for update;

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', decision.task_id,
    'progressPercent', decision.official_cumulative_percent,
    'quantityDone', coalesce(decision.official_cumulative_quantity, 0),
    'dailyQuantityDone', coalesce(decision.official_daily_quantity, 0),
    'note', decision.resolution_reason,
    'attachments', '[]'::jsonb,
    'sourceDailyLogId', p_daily_log_id
  ) order by decision.task_id), '[]'::jsonb)
  into v_rows
  from public.daily_log_wbs_decisions decision
  where decision.daily_log_id = p_daily_log_id;

  select coalesce(avg(case when decision.task_id is not null
      then decision.official_cumulative_percent else task.progress end), 0)
  into v_construction_progress
  from public.project_tasks task
  left join public.daily_log_wbs_decisions decision
    on decision.daily_log_id = p_daily_log_id and decision.task_id = task.id
  where task.project_id = v_log.project_id
    and task.construction_site_id is not distinct from v_log.construction_site_id
    and not exists (select 1 from public.project_tasks child where child.parent_id = task.id);

  select jsonb_build_object(
    'constructionProgressPercent', v_construction_progress,
    'valueProgressPercent', coalesce(snapshot.value_progress_percent, 0),
    'progressMode', 'daily_log_summary',
    'suppliedValue', snapshot.supplied_value,
    'contractTotalValue', snapshot.contract_total_value,
    'purchasedValue', coalesce(snapshot.purchased_value, 0),
    'issuedValue', coalesce(snapshot.issued_value, 0),
    'recognizedValue', coalesce(snapshot.recognized_value, 0),
    'ganttPercent', v_construction_progress,
    'calculatedAt', v_published_at
  ) into v_snapshot
  from (select 1) seed
  left join lateral (
    select weekly.* from public.weekly_progress_snapshots weekly
    where weekly.scope_key = v_scope_key and weekly.week_start = v_week_start
    limit 1
  ) snapshot on true;

  insert into public.daily_log_publish_commands(command_id, daily_log_id, actor_user_id)
  values (p_command_id, p_daily_log_id, v_actor_id)
  on conflict (command_id) do nothing;

  perform app_private.write_project_progress_period_payload(
    v_actor_id, v_scope_key, v_log.project_id, v_log.construction_site_id,
    'daily', v_log.date::date, v_rows, v_snapshot
  );

  update public.project_daily_task_progress progress
  set quantity_done = decision.official_cumulative_quantity,
      daily_quantity_done = decision.official_daily_quantity
  from public.daily_log_wbs_decisions decision
  where decision.daily_log_id = p_daily_log_id
    and progress.scope_key = v_scope_key
    and progress.task_id = decision.task_id
    and progress.progress_date = v_log.date::date
    and progress.source_daily_log_id = p_daily_log_id;

  perform public.transition_daily_log_status(p_daily_log_id, 'verified', null, null, null);
  update public.daily_log_summary_sources source
  set review_status = 'accepted', reviewed_by = v_actor_id::text,
      reviewed_at = v_published_at, updated_at = v_published_at
  where source.daily_log_id = p_daily_log_id;
  update public.daily_log_contributions contribution
  set status = 'included', daily_log_id = p_daily_log_id,
      included_in_daily_log_id = p_daily_log_id, included_by = v_actor_id::text,
      included_at = v_published_at, last_action_by = v_actor_id::text,
      last_action_at = v_published_at, updated_at = v_published_at
  where contribution.id in (
    select source.contribution_id from public.daily_log_summary_sources source
    where source.daily_log_id = p_daily_log_id
  );

  select coalesce(jsonb_agg(decision.task_id order by decision.task_id), '[]'::jsonb),
    md5(coalesce(string_agg(concat_ws('|', decision.task_id,
      decision.official_cumulative_percent::text,
      decision.official_cumulative_quantity::text,
      decision.official_daily_quantity::text,
      decision.source_fingerprint), '||' order by decision.task_id), ''))
  into v_published_task_ids, v_progress_fingerprint
  from public.daily_log_wbs_decisions decision where decision.daily_log_id = p_daily_log_id;

  select coalesce(jsonb_agg(resource.id order by resource.id), '[]'::jsonb),
    md5(coalesce(string_agg(resource.fingerprint, '||' order by resource.id), ''))
  into v_resource_line_ids, v_resource_fingerprint
  from (
    select labor.id::text as id, concat_ws('|', labor.id::text, labor.provider_entry_mode,
      labor.partner_id, labor.provider_name_snapshot, labor.manual_provider_type,
      labor.manual_provider_name, labor.people_count, labor.hours_per_person) as fingerprint
    from public.daily_log_labor labor
    where labor.daily_log_id = p_daily_log_id and labor.resource_semantics_version = 2
    union all
    select machine.id::text, concat_ws('|', machine.id::text, machine.provider_entry_mode,
      machine.partner_id, machine.provider_name_snapshot, machine.manual_provider_type,
      machine.manual_provider_name, machine.machine_count, machine.hours_per_machine)
    from public.daily_log_machines machine
    where machine.daily_log_id = p_daily_log_id and machine.resource_semantics_version = 2
  ) resource;

  v_result := jsonb_build_object(
    'commandId', p_command_id,
    'dailyLogId', p_daily_log_id,
    'progressDate', v_log.date,
    'publishedTaskIds', v_published_task_ids,
    'verifiedResourceLineIds', v_resource_line_ids,
    'progressFingerprint', v_progress_fingerprint,
    'resourceEvidenceFingerprint', v_resource_fingerprint,
    'publishedAt', v_published_at
  );
  update public.daily_log_publish_commands command
  set result = v_result where command.command_id = p_command_id;
  return v_result;
end;
$$;

revoke all on function public.submit_daily_log_summary_v1(text, timestamptz, uuid, text)
  from public, anon, authenticated;
revoke all on function public.publish_daily_log_summary_v1(text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_daily_log_summary_v1(text, timestamptz, uuid, text)
  to authenticated;
grant execute on function public.publish_daily_log_summary_v1(text, timestamptz, uuid)
  to authenticated;

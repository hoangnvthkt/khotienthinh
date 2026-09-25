alter table public.daily_logs
  add column revision_no integer not null default 1,
  add column supersedes_daily_log_id text references public.daily_logs(id) on delete restrict,
  add column superseded_by_daily_log_id text references public.daily_logs(id) on delete restrict,
  add column revision_reason text,
  add constraint daily_logs_revision_no_check check (revision_no > 0),
  add constraint daily_logs_revision_reason_check check (
    (supersedes_daily_log_id is null and revision_reason is null)
    or (supersedes_daily_log_id is not null and nullif(trim(revision_reason), '') is not null)
  ),
  add constraint daily_logs_revision_self_check check (
    id is distinct from supersedes_daily_log_id
    and id is distinct from superseded_by_daily_log_id
  );

create unique index daily_logs_supersedes_unique
  on public.daily_logs (supersedes_daily_log_id)
  where supersedes_daily_log_id is not null;

create unique index daily_logs_superseded_by_unique
  on public.daily_logs (superseded_by_daily_log_id)
  where superseded_by_daily_log_id is not null;

create function app_private.guard_daily_log_revision_lineage_v1() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (TG_OP = 'INSERT' and (new.revision_no <> 1 or new.supersedes_daily_log_id is not null
      or new.superseded_by_daily_log_id is not null or new.revision_reason is not null))
    or (TG_OP = 'UPDATE' and (new.revision_no, new.supersedes_daily_log_id,
      new.superseded_by_daily_log_id, new.revision_reason) is distinct from
      (old.revision_no, old.supersedes_daily_log_id, old.superseded_by_daily_log_id, old.revision_reason)) then
    if current_setting('app.daily_log_revision_context', true) is distinct from 'on' then
      raise exception using errcode = '42501', message = 'REVISION_LINEAGE_WRITE_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_daily_log_revision_lineage_v1() from public, anon, authenticated;
create trigger guard_daily_log_revision_lineage before insert or update on public.daily_logs
for each row execute function app_private.guard_daily_log_revision_lineage_v1();

-- The viewer must honor weekly locks as well as a lock on this day.
alter function public.get_daily_log_wbs_bundle_v1(text, text, date, text)
  rename to get_daily_log_wbs_bundle_base_v1;
revoke all on function public.get_daily_log_wbs_bundle_base_v1(text, text, date, text)
  from public, anon, authenticated;
create function public.get_daily_log_wbs_bundle_v1(
  p_project_id text, p_construction_site_id text, p_log_date date, p_daily_log_id text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_bundle jsonb;
  v_period jsonb;
begin
  -- Delegate authorization to the original scoped bundle command before reading locks.
  v_bundle := public.get_daily_log_wbs_bundle_base_v1(p_project_id, p_construction_site_id, p_log_date, p_daily_log_id);
  select to_jsonb(state) into v_period from public.project_progress_period_states state
  where state.project_id = p_project_id
    and state.construction_site_id is not distinct from p_construction_site_id
    and ((state.period_type = 'daily' and state.period_start = p_log_date)
      or (state.period_type = 'weekly' and state.period_start = date_trunc('week', p_log_date)::date))
  order by state.is_locked desc, (state.period_type = 'daily') desc limit 1;
  return jsonb_set(v_bundle, '{periodState}', coalesce(v_period, 'null'::jsonb));
end;
$$;
revoke all on function public.get_daily_log_wbs_bundle_v1(text, text, date, text) from public, anon, authenticated;
grant execute on function public.get_daily_log_wbs_bundle_v1(text, text, date, text) to authenticated;

create function public.create_daily_log_summary_revision_v1(
  p_daily_log_id text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_actor_name text;
  v_log public.daily_logs%rowtype;
  v_revision_id text := 'daily-log-revision-' || gen_random_uuid()::text;
  v_revision_no integer;
  v_now timestamptz := clock_timestamp();
  v_source public.daily_log_summary_sources%rowtype;
  v_source_id uuid;
  v_item public.daily_log_work_items%rowtype;
  v_item_id uuid;
  v_item_map jsonb := '{}'::jsonb;
  v_previous_context text := current_setting('app.daily_log_revision_context', true);
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'REVISION_REASON_REQUIRED';
  end if;

  select log.* into v_log
  from public.daily_logs log
  where log.id = p_daily_log_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;
  if not (v_log.summary_source_type = 'member_contributions' and v_log.status = 'verified') then
    raise exception using errcode = '42501', message = 'VERIFIED_SUMMARY_REQUIRED';
  end if;
  if v_log.superseded_by_daily_log_id is not null then
    raise exception using errcode = '23505', message = 'SUMMARY_REVISION_ALREADY_EXISTS';
  end if;
  if v_actor_id is null
    or not app_private.current_actor_has_effective_room_action(
      v_log.project_id, v_log.construction_site_id, 'daily_log', 'approve'
    )
    or not app_private.current_actor_has_effective_room_action(
      v_log.project_id, v_log.construction_site_id, 'daily_log', 'publish_progress'
    ) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVE_AND_PUBLISH_REQUIRED';
  end if;
  perform 1 from public.project_progress_period_states state
  where state.project_id = v_log.project_id
    and state.construction_site_id is not distinct from v_log.construction_site_id
    and ((state.period_type = 'daily' and state.period_start = v_log.date::date)
      or (state.period_type = 'weekly' and state.period_start = date_trunc('week', v_log.date::date)::date))
  order by state.period_type, state.period_start for update;
  if exists (
    select 1 from public.project_progress_period_states state
    where state.project_id = v_log.project_id
      and state.construction_site_id is not distinct from v_log.construction_site_id
      and state.is_locked
      and (
        (state.period_type = 'daily' and state.period_start = v_log.date::date)
        or (state.period_type = 'weekly'
          and state.period_start = date_trunc('week', v_log.date::date)::date)
      )
  ) then
    raise exception using errcode = '55000', message = 'PERIOD_LOCKED_WITH_REOPEN_REQUIRED';
  end if;

  select coalesce(public.users.name, v_log.created_by, 'Người điều chỉnh')
  into v_actor_name from public.users where public.users.id = v_actor_id;
  v_revision_no := v_log.revision_no + 1;
  perform set_config('app.daily_log_revision_context', 'on', true);

  insert into public.daily_logs
  select (jsonb_populate_record(
    null::public.daily_logs,
    to_jsonb(v_log) || jsonb_build_object(
      'id', v_revision_id,
      'revision_no', v_revision_no,
      'supersedes_daily_log_id', v_log.id,
      'superseded_by_daily_log_id', null,
      'revision_reason', trim(p_reason),
      'status', 'draft',
      'verified', false,
      'verified_by', null,
      'verified_by_id', null,
      'verified_at', null,
      'submitted_by', null,
      'submitted_by_id', null,
      'submitted_at', null,
      'submitted_to_user_id', null,
      'submitted_to_name', null,
      'submitted_to_permission', null,
      'submission_note', null,
      'requested_verifier_id', null,
      'requested_verifier_name', null,
      'rejected_by', null,
      'rejected_by_id', null,
      'rejected_at', null,
      'rejection_reason', null,
      'ever_submitted', false,
      'created_by', v_actor_name,
      'created_by_id', v_actor_id::text,
      'created_at', v_now,
      'last_action_by', v_actor_id::text,
      'last_action_at', v_now,
      'summarized_by_id', v_actor_id::text,
      'summarized_by_name', v_actor_name,
      'summarized_at', v_now,
      'summary_source_metadata', coalesce(v_log.summary_source_metadata, '{}'::jsonb)
        || jsonb_build_object('revisionOfDailyLogId', v_log.id, 'revisionReason', trim(p_reason))
    )
  )).*;

  for v_source in
    select source.* from public.daily_log_summary_sources source
    where source.daily_log_id = v_log.id
    order by source.sort_order, source.id
    for update
  loop
    insert into public.daily_log_summary_sources (
      daily_log_id, contribution_id, source_user_id, source_user_name,
      included_text, included_photos, metadata, created_by, created_at,
      sort_order, source_version, source_fingerprint, source_snapshot,
      source_state, work_area_code, work_area_name, has_adjustments,
      adjustment_reason, adjusted_by, adjusted_at, review_status,
      review_comment, reviewed_by, reviewed_at, updated_at
    ) values (
      v_revision_id, v_source.contribution_id, v_source.source_user_id, v_source.source_user_name,
      v_source.included_text, v_source.included_photos, v_source.metadata, v_actor_id::text, v_now,
      v_source.sort_order, v_source.source_version, v_source.source_fingerprint, v_source.source_snapshot,
      v_source.source_state, v_source.work_area_code, v_source.work_area_name, v_source.has_adjustments,
      v_source.adjustment_reason, v_source.adjusted_by, v_source.adjusted_at, 'ready',
      null, null, null, v_now
    ) returning id into v_source_id;

    for v_item in
      select item.* from public.daily_log_work_items item
      where item.daily_log_id = v_log.id and item.summary_source_id = v_source.id
      order by item.source_index, item.id
      for update
    loop
      insert into public.daily_log_work_items (
        daily_log_id, summary_source_id, source_work_item_id, project_id,
        construction_site_id, task_id, work_boq_item_id, work_area_code,
        work_area_name_snapshot, wbs_code_snapshot, task_name_snapshot,
        unit_snapshot, planned_quantity_snapshot, area_planned_quantity_snapshot,
        baseline_progress_percent, baseline_quantity_done, baseline_progress_row_id,
        baseline_fingerprint, cumulative_progress_percent, cumulative_quantity_done,
        daily_quantity_done, schedule_finish_date_snapshot, forecast_finish_date,
        forecast_change_reason, note, attachments, source_index, created_at, updated_at
      ) values (
        v_revision_id, v_source_id, v_item.source_work_item_id, v_item.project_id,
        v_item.construction_site_id, v_item.task_id, v_item.work_boq_item_id, v_item.work_area_code,
        v_item.work_area_name_snapshot, v_item.wbs_code_snapshot, v_item.task_name_snapshot,
        v_item.unit_snapshot, v_item.planned_quantity_snapshot, v_item.area_planned_quantity_snapshot,
        v_item.baseline_progress_percent, v_item.baseline_quantity_done, v_item.baseline_progress_row_id,
        v_item.baseline_fingerprint, v_item.cumulative_progress_percent, v_item.cumulative_quantity_done,
        v_item.daily_quantity_done, v_item.schedule_finish_date_snapshot, v_item.forecast_finish_date,
        v_item.forecast_change_reason, v_item.note, v_item.attachments, v_item.source_index, v_now, v_now
      ) returning id into v_item_id;
      v_item_map := v_item_map || jsonb_build_object(v_item.id::text, v_item_id::text);

      insert into public.daily_log_labor (
        daily_log_id, construction_site_id, labor_type, count, hours, unit_cost, total_cost,
        note, source_index, created_at, project_id, catalog_item_id, catalog_code,
        catalog_name, group_name, partner_id, partner_name, task_id, task_name, unit,
        daily_log_work_item_id, contribution_id, summary_source_id, source_labor_line_id,
        people_count, hours_per_person, total_labor_hours, provider_entry_mode,
        provider_code_snapshot, provider_name_snapshot, manual_provider_type,
        manual_provider_name, manual_provider_note, resource_semantics_version
      )
      select v_revision_id, labor.construction_site_id, labor.labor_type, labor.count, labor.hours,
        null, null, labor.note, labor.source_index, v_now, labor.project_id, labor.catalog_item_id,
        labor.catalog_code, labor.catalog_name, labor.group_name, labor.partner_id, labor.partner_name,
        labor.task_id, labor.task_name, labor.unit, v_item_id, null, v_source_id, labor.id,
        labor.people_count, labor.hours_per_person, labor.total_labor_hours, labor.provider_entry_mode,
        labor.provider_code_snapshot, labor.provider_name_snapshot, labor.manual_provider_type,
        labor.manual_provider_name, labor.manual_provider_note, 2
      from public.daily_log_labor labor
      where labor.daily_log_id = v_log.id
        and labor.daily_log_work_item_id = v_item.id
        and labor.resource_semantics_version = 2;

      insert into public.daily_log_machines (
        daily_log_id, construction_site_id, machine_name, machine_type, shifts,
        unit_cost, total_cost, note, source_index, created_at, project_id,
        catalog_item_id, catalog_code, catalog_name, group_name, task_id, task_name,
        hours, unit, partner_id, partner_name, daily_log_work_item_id, contribution_id,
        summary_source_id, source_machine_line_id, machine_count, hours_per_machine,
        total_machine_hours, provider_entry_mode, provider_code_snapshot,
        provider_name_snapshot, manual_provider_type, manual_provider_name,
        manual_provider_note, resource_semantics_version
      )
      select v_revision_id, machine.construction_site_id, machine.machine_name, machine.machine_type,
        machine.shifts, null, null, machine.note, machine.source_index, v_now, machine.project_id,
        machine.catalog_item_id, machine.catalog_code, machine.catalog_name, machine.group_name,
        machine.task_id, machine.task_name, machine.hours, machine.unit, machine.partner_id,
        machine.partner_name, v_item_id, null, v_source_id, machine.id, machine.machine_count,
        machine.hours_per_machine, machine.total_machine_hours, machine.provider_entry_mode,
        machine.provider_code_snapshot, machine.provider_name_snapshot, machine.manual_provider_type,
        machine.manual_provider_name, machine.manual_provider_note, 2
      from public.daily_log_machines machine
      where machine.daily_log_id = v_log.id
        and machine.daily_log_work_item_id = v_item.id
        and machine.resource_semantics_version = 2;
    end loop;
  end loop;

  insert into public.daily_log_wbs_decisions (
    daily_log_id, task_id, official_cumulative_percent, official_cumulative_quantity,
    official_daily_quantity, forecast_finish_date, aggregation_method, daily_quantity_method,
    included_source_work_item_ids, resolution_reason, forecast_resolution_reason,
    source_fingerprint, created_at, updated_at
  )
  select v_revision_id, decision.task_id, decision.official_cumulative_percent,
    decision.official_cumulative_quantity, decision.official_daily_quantity,
    decision.forecast_finish_date, decision.aggregation_method, decision.daily_quantity_method,
    (select coalesce(jsonb_agg(coalesce(v_item_map ->> included.id, included.id) order by included.position), '[]'::jsonb)
      from jsonb_array_elements_text(decision.included_source_work_item_ids)
        with ordinality as included(id, position)), decision.resolution_reason,
    decision.forecast_resolution_reason, decision.source_fingerprint, v_now, v_now
  from public.daily_log_wbs_decisions decision
  where decision.daily_log_id = v_log.id;

  update public.daily_logs
  set superseded_by_daily_log_id = v_revision_id
  where id = v_log.id;
  perform set_config('app.daily_log_revision_context', coalesce(v_previous_context, ''), true);

  return jsonb_build_object(
    'dailyLogId', v_revision_id,
    'revisionNo', v_revision_no,
    'supersedesDailyLogId', v_log.id,
    'status', 'draft',
    'revisionReason', trim(p_reason),
    'createdAt', v_now
  );
end;
$$;

-- Keep summary assignment and its note inside the existing workflow guard.
create or replace function public.submit_daily_log_summary_v1(
  p_daily_log_id text, p_expected_updated_at timestamptz,
  p_approver_user_id uuid, p_submission_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_log public.daily_logs%rowtype;
  v_previous_guard text := current_setting('app.daily_log_transition_context', true);
begin
  select log.* into v_log from public.daily_logs log where log.id = p_daily_log_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;
  if not (v_log.summary_source_type = 'member_contributions' and v_log.status in ('draft', 'rejected')) then
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
  ) then raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVER_REQUIRED'; end if;
  if exists (select 1 from public.project_progress_period_states state
    where state.project_id = v_log.project_id
      and state.construction_site_id is not distinct from v_log.construction_site_id and state.is_locked
      and ((state.period_type = 'daily' and state.period_start = v_log.date::date)
        or (state.period_type = 'weekly' and state.period_start = date_trunc('week', v_log.date::date)::date))
  ) then raise exception using errcode = '55000', message = 'PERIOD_LOCKED'; end if;
  perform app_private.assert_daily_log_summary_ready_v1(p_daily_log_id, true);
  perform set_config('app.daily_log_transition_context', 'on', true);
  update public.daily_logs set submitted_to_permission = 'approve' where id = p_daily_log_id;
  perform public.transition_daily_log_status(p_daily_log_id, 'submitted', p_approver_user_id::text, null, null);
  update public.daily_logs set submission_note = nullif(trim(p_submission_note), '') where id = p_daily_log_id;
  perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
  select log.* into v_log from public.daily_logs log where log.id = p_daily_log_id;
  return jsonb_build_object('dailyLogId', v_log.id, 'status', v_log.status,
    'updatedAt', v_log.last_action_at, 'approverUserId', v_log.submitted_to_user_id);
end;
$$;

alter function public.publish_daily_log_summary_v1(text, timestamptz, uuid)
  rename to publish_daily_log_summary_base_v1;

revoke all on function public.publish_daily_log_summary_base_v1(text, timestamptz, uuid)
  from public, anon, authenticated;

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
  v_log public.daily_logs%rowtype;
  v_result jsonb;
  v_existing_result jsonb;
begin
  select log.* into v_log
  from public.daily_logs log
  where log.id = p_daily_log_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;

  if public.current_app_user_id() is null or not app_private.current_actor_has_effective_room_action(
    v_log.project_id, v_log.construction_site_id, 'daily_log', 'approve'
  ) or not app_private.current_actor_has_effective_room_action(
    v_log.project_id, v_log.construction_site_id, 'daily_log', 'publish_progress'
  ) then raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVE_AND_PUBLISH_REQUIRED'; end if;
  if exists (select 1 from public.daily_log_publish_commands command
    where command.command_id = p_command_id and command.daily_log_id <> p_daily_log_id) then
    raise exception using errcode = '22023', message = 'COMMAND_ID_LOG_MISMATCH';
  end if;
  select command.result into v_existing_result from public.daily_log_publish_commands command
  where command.daily_log_id = p_daily_log_id;
  if v_existing_result is not null then return v_existing_result; end if;

  perform 1 from public.daily_logs chain
  where chain.id in (v_log.supersedes_daily_log_id, v_log.superseded_by_daily_log_id)
  order by chain.id
  for update;

  -- Serialize with close/reopen before touching affected progress rows.
  perform 1 from public.project_progress_period_states state
  where state.project_id = v_log.project_id
    and state.construction_site_id is not distinct from v_log.construction_site_id
    and state.period_start >= date_trunc('week', v_log.date::date)::date
  order by state.period_type, state.period_start for update;
  if v_log.supersedes_daily_log_id is not null and exists (
    select 1 from public.project_progress_period_states state
    join public.project_daily_task_progress future
      on future.scope_key = state.scope_key
      and ((state.period_type = 'daily' and state.period_start = future.progress_date)
        or (state.period_type = 'weekly' and state.period_start = future.week_start))
    where state.is_locked and future.project_id = v_log.project_id
      and future.construction_site_id is not distinct from v_log.construction_site_id
      and future.progress_date > v_log.date::date
      and future.task_id in (select task_id from public.daily_log_wbs_decisions where daily_log_id = p_daily_log_id)
  ) then raise exception using errcode = '55000', message = 'REVISION_AFFECTED_PERIOD_LOCKED'; end if;

  perform 1 from public.project_daily_task_progress progress
  where progress.project_id = v_log.project_id
    and progress.construction_site_id is not distinct from v_log.construction_site_id
    and progress.task_id in (
      select decision.task_id from public.daily_log_wbs_decisions decision
      where decision.daily_log_id = p_daily_log_id
    )
  order by progress.task_id, progress.progress_date, progress.id
  for update;

  v_result := public.publish_daily_log_summary_base_v1(
    p_daily_log_id, p_expected_updated_at, p_command_id
  );

  if v_log.supersedes_daily_log_id is not null then
    update public.daily_log_summary_sources
    set review_status = 'superseded', updated_at = clock_timestamp()
    where daily_log_id = v_log.supersedes_daily_log_id
      and review_status <> 'superseded';

    with future_progress as (
      select future.id, future.quantity_done,
        previous.id as previous_id,
        previous.quantity_done as previous_quantity_done
      from public.project_daily_task_progress future
      left join lateral (
        select prior.id, prior.quantity_done
        from public.project_daily_task_progress prior
        where prior.scope_key = future.scope_key
          and prior.task_id = future.task_id
          and prior.progress_date < future.progress_date
        order by prior.progress_date desc, prior.updated_at desc
        limit 1
      ) previous on true
      where future.project_id = v_log.project_id
        and future.construction_site_id is not distinct from v_log.construction_site_id
        and future.progress_date > v_log.date::date
        and future.task_id in (
          select decision.task_id from public.daily_log_wbs_decisions decision
          where decision.daily_log_id = p_daily_log_id
        )
    )
    update public.project_daily_task_progress progress
    set daily_quantity_done = case
      when future.quantity_done is null then null
      when future.previous_id is not null and future.previous_quantity_done is null then null
      else future.quantity_done - coalesce(future.previous_quantity_done, 0)
    end
    from future_progress future
    where progress.id = future.id;

    if not exists (
      select 1 from public.project_daily_task_progress progress
      where progress.source_daily_log_id = p_daily_log_id
        and progress.progress_date = v_log.date::date
    ) then
      raise exception using errcode = 'P0001', message = 'REVISION_PROGRESS_SOURCE_NOT_REPLACED';
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function public.create_daily_log_summary_revision_v1(text, text)
  from public, anon, authenticated;
revoke all on function public.publish_daily_log_summary_v1(text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.create_daily_log_summary_revision_v1(text, text)
  to authenticated;
grant execute on function public.publish_daily_log_summary_v1(text, timestamptz, uuid)
  to authenticated;

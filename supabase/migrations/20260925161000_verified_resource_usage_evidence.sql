-- Private owner-read implementation. The exposed RPC is an invoker wrapper.
-- Verified normalized summary rows are read through scoped, allowlisted RPCs.
-- Preserve direct access to legacy and contributor-owned draft rows.
drop policy daily_log_labor_select on public.daily_log_labor;
create policy daily_log_labor_select on public.daily_log_labor for select to authenticated using (
  (contribution_id is not null and exists (
    select 1 from public.daily_log_contributions contribution
    where contribution.id = daily_log_labor.contribution_id
      and app_private.daily_log_contribution_can_view(
        contribution.project_id, contribution.construction_site_id,
        contribution.author_user_id, contribution.submitted_to_user_id
      )
  ))
  or (daily_log_id is not null and exists (
    select 1 from public.daily_logs log
    where log.id = daily_log_labor.daily_log_id
      and app_private.daily_log_can_select(
        log.project_id, log.construction_site_id, public.current_app_user_id()
      )
      and (daily_log_labor.resource_semantics_version = 1
        or log.status <> 'verified'
        or app_private.current_actor_has_effective_room_action(
          log.project_id, log.construction_site_id, 'payment', 'view_resource_evidence'
        ))
  ))
);

drop policy daily_log_machines_select on public.daily_log_machines;
create policy daily_log_machines_select on public.daily_log_machines for select to authenticated using (
  (contribution_id is not null and exists (
    select 1 from public.daily_log_contributions contribution
    where contribution.id = daily_log_machines.contribution_id
      and app_private.daily_log_contribution_can_view(
        contribution.project_id, contribution.construction_site_id,
        contribution.author_user_id, contribution.submitted_to_user_id
      )
  ))
  or (daily_log_id is not null and exists (
    select 1 from public.daily_logs log
    where log.id = daily_log_machines.daily_log_id
      and app_private.daily_log_can_select(
        log.project_id, log.construction_site_id, public.current_app_user_id()
      )
      and (daily_log_machines.resource_semantics_version = 1
        or log.status <> 'verified'
        or app_private.current_actor_has_effective_room_action(
          log.project_id, log.construction_site_id, 'payment', 'view_resource_evidence'
        ))
  ))
);

-- Generic Daily Log reports still need the physical summary rows. Return only
-- explicitly selected columns, scoped per log, without Payment evidence rights.
create function public.get_daily_log_physical_resources_v1(p_log_ids text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or p_log_ids is null or cardinality(p_log_ids) > 500
    or exists (select 1 from unnest(p_log_ids) requested(log_id) where requested.log_id is null)
    or exists (
      select 1 from unnest(p_log_ids) requested(log_id)
      left join public.daily_logs log on log.id = requested.log_id
      where log.id is null or not app_private.daily_log_can_select(
        log.project_id, log.construction_site_id, v_actor
      )
    ) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_RESOURCE_ACCESS_DENIED';
  end if;
  return coalesce((
    select jsonb_agg(row_data order by row_data->>'daily_log_id', (row_data->>'source_index')::integer, row_data->>'id')
    from (
      select jsonb_build_object(
        'resource_type', 'labor', 'id', labor.id, 'daily_log_id', labor.daily_log_id,
        'source_index', labor.source_index, 'labor_type', labor.labor_type,
        'count', labor.count, 'hours', labor.hours, 'note', labor.note,
        'people_count', labor.people_count, 'hours_per_person', labor.hours_per_person,
        'total_labor_hours', labor.total_labor_hours,
        'provider_entry_mode', labor.provider_entry_mode,
        'partner_id', labor.partner_id, 'provider_code_snapshot', labor.provider_code_snapshot,
        'provider_name_snapshot', labor.provider_name_snapshot,
        'manual_provider_type', labor.manual_provider_type,
        'manual_provider_name', labor.manual_provider_name,
        'manual_provider_note', labor.manual_provider_note
      ) row_data
      from public.daily_log_labor labor
      where labor.daily_log_id = any(p_log_ids) and labor.resource_semantics_version = 2
      union all
      select jsonb_build_object(
        'resource_type', 'machine', 'id', machine.id, 'daily_log_id', machine.daily_log_id,
        'source_index', machine.source_index, 'machine_name', machine.machine_name,
        'machine_type', machine.machine_type, 'shifts', machine.shifts,
        'hours', machine.hours, 'note', machine.note,
        'machine_count', machine.machine_count,
        'hours_per_machine', machine.hours_per_machine,
        'total_machine_hours', machine.total_machine_hours,
        'provider_entry_mode', machine.provider_entry_mode,
        'partner_id', machine.partner_id, 'provider_code_snapshot', machine.provider_code_snapshot,
        'provider_name_snapshot', machine.provider_name_snapshot,
        'manual_provider_type', machine.manual_provider_type,
        'manual_provider_name', machine.manual_provider_name,
        'manual_provider_note', machine.manual_provider_note
      )
      from public.daily_log_machines machine
      where machine.daily_log_id = any(p_log_ids) and machine.resource_semantics_version = 2
    ) physical
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_daily_log_physical_resources_v1(text[]) from public, anon, authenticated;
grant execute on function public.get_daily_log_physical_resources_v1(text[]) to authenticated;

create function app_private.get_verified_resource_usage_evidence_impl_v1(
  p_project_id text,
  p_construction_site_id text,
  p_from_date date,
  p_to_date date,
  p_provider_key text,
  p_task_id text,
  p_resource_type text,
  p_include_superseded boolean,
  p_cursor text,
  p_limit integer
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_site_id text := nullif(p_construction_site_id, '');
  v_to_date date := coalesce(p_to_date, current_date);
  v_from_date date := coalesce(p_from_date, coalesce(p_to_date, current_date) - 30);
  v_cursor_parts text[];
  v_cursor_date date;
  v_cursor_type text;
  v_cursor_line_id text;
  v_result jsonb;
begin
  if nullif(trim(p_project_id), '') is null
    or v_actor_id is null
    or not exists (
      select 1 from public.users actor
      where actor.id = v_actor_id and actor.is_active
    )
    or not app_private.current_actor_has_effective_room_action(
      p_project_id, v_site_id, 'payment', 'view_resource_evidence'
    ) then
    raise exception using errcode = '42501', message = 'RESOURCE_EVIDENCE_SCOPE_DENIED';
  end if;

  if v_from_date > v_to_date or v_to_date - v_from_date > 366 then
    raise exception using errcode = '22023', message = 'INVALID_DATE_RANGE';
  end if;
  if p_resource_type is not null and p_resource_type not in ('labor', 'machine') then
    raise exception using errcode = '22023', message = 'INVALID_RESOURCE_TYPE';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_RESOURCE_EVIDENCE_LIMIT';
  end if;
  if p_cursor is not null then
    if length(p_cursor) > 512 then
      raise exception using errcode = '22023', message = 'INVALID_RESOURCE_EVIDENCE_CURSOR';
    end if;
    begin
      v_cursor_parts := string_to_array(convert_from(decode(p_cursor, 'base64'), 'UTF8'), '|');
      if array_length(v_cursor_parts, 1) is distinct from 3
        or v_cursor_parts[2] not in ('labor', 'machine') then
        raise exception 'invalid cursor fields';
      end if;
      v_cursor_date := v_cursor_parts[1]::date;
      v_cursor_type := v_cursor_parts[2];
      v_cursor_line_id := v_cursor_parts[3]::uuid::text;
    exception when others then
      raise exception using errcode = '22023', message = 'INVALID_RESOURCE_EVIDENCE_CURSOR';
    end;
  end if;

  with base as materialized (
    select
      log.date::date as log_date,
      'labor'::text as resource_type,
      labor.id::text as resource_line_id,
      log.id as daily_log_id,
      source.id as summary_source_id,
      source.contribution_id,
      log.revision_no,
      case when log.superseded_by_daily_log_id is null then 'current' else 'superseded' end as revision_state,
      log.project_id,
      log.construction_site_id,
      source.work_area_code,
      source.work_area_name,
      item.task_id,
      item.wbs_code_snapshot as wbs_code,
      item.task_name_snapshot as task_name,
      labor.provider_entry_mode,
      labor.partner_id,
      labor.provider_code_snapshot,
      labor.provider_name_snapshot,
      labor.manual_provider_type,
      labor.manual_provider_name,
      labor.manual_provider_note,
      labor.people_count,
      labor.hours_per_person,
      labor.total_labor_hours,
      null::numeric as machine_count,
      null::numeric as hours_per_machine,
      null::numeric as total_machine_hours,
      source.source_user_name,
      log.verified_by as verified_by_name,
      log.verified_at
    from public.daily_log_labor labor
    join public.daily_logs log on log.id = labor.daily_log_id
    join public.daily_log_summary_sources source
      on source.id = labor.summary_source_id and source.daily_log_id = log.id
    join public.daily_log_contributions contribution
      on contribution.id = source.contribution_id
      and contribution.project_id = log.project_id
      and contribution.construction_site_id is not distinct from log.construction_site_id
      and contribution.date = log.date::date
    join public.daily_log_work_items item
      on item.id = labor.daily_log_work_item_id
      and item.daily_log_id = log.id
      and item.summary_source_id = source.id
      and item.task_id = labor.task_id
      and item.project_id = log.project_id
      and item.construction_site_id is not distinct from log.construction_site_id
    where log.project_id = p_project_id
      and log.construction_site_id is not distinct from v_site_id
      and log.date between v_from_date::text and v_to_date::text
      and log.summary_source_type = 'member_contributions'
      and log.status = 'verified'
      and (coalesce(p_include_superseded, false) or log.superseded_by_daily_log_id is null)
      and source.review_status in ('accepted', 'superseded')
      and labor.resource_semantics_version = 2
      and labor.contribution_id is null
      and labor.project_id = log.project_id
      and labor.construction_site_id is not distinct from log.construction_site_id

    union all

    select
      log.date::date,
      'machine'::text,
      machine.id::text,
      log.id,
      source.id,
      source.contribution_id,
      log.revision_no,
      case when log.superseded_by_daily_log_id is null then 'current' else 'superseded' end,
      log.project_id,
      log.construction_site_id,
      source.work_area_code,
      source.work_area_name,
      item.task_id,
      item.wbs_code_snapshot,
      item.task_name_snapshot,
      machine.provider_entry_mode,
      machine.partner_id,
      machine.provider_code_snapshot,
      machine.provider_name_snapshot,
      machine.manual_provider_type,
      machine.manual_provider_name,
      machine.manual_provider_note,
      null::numeric,
      null::numeric,
      null::numeric,
      machine.machine_count,
      machine.hours_per_machine,
      machine.total_machine_hours,
      source.source_user_name,
      log.verified_by,
      log.verified_at
    from public.daily_log_machines machine
    join public.daily_logs log on log.id = machine.daily_log_id
    join public.daily_log_summary_sources source
      on source.id = machine.summary_source_id and source.daily_log_id = log.id
    join public.daily_log_contributions contribution
      on contribution.id = source.contribution_id
      and contribution.project_id = log.project_id
      and contribution.construction_site_id is not distinct from log.construction_site_id
      and contribution.date = log.date::date
    join public.daily_log_work_items item
      on item.id = machine.daily_log_work_item_id
      and item.daily_log_id = log.id
      and item.summary_source_id = source.id
      and item.task_id = machine.task_id
      and item.project_id = log.project_id
      and item.construction_site_id is not distinct from log.construction_site_id
    where log.project_id = p_project_id
      and log.construction_site_id is not distinct from v_site_id
      and log.date between v_from_date::text and v_to_date::text
      and log.summary_source_type = 'member_contributions'
      and log.status = 'verified'
      and (coalesce(p_include_superseded, false) or log.superseded_by_daily_log_id is null)
      and source.review_status in ('accepted', 'superseded')
      and machine.resource_semantics_version = 2
      and machine.contribution_id is null
      and machine.project_id = log.project_id
      and machine.construction_site_id is not distinct from log.construction_site_id
  ), filtered as materialized (
    select base.*,
      case when base.provider_entry_mode = 'catalog'
        then 'catalog:' || base.partner_id
        else 'manual:' || base.manual_provider_type || ':' || lower(regexp_replace(
          public.unaccent(trim(base.manual_provider_name)), '\s+', ' ', 'g'
        )) end as provider_key
    from base
    where (p_task_id is null or base.task_id = p_task_id)
      and (p_resource_type is null or base.resource_type = p_resource_type)
  ), selected as materialized (
    select * from filtered
    where p_provider_key is null or provider_key = p_provider_key
  ), page as materialized (
    select * from selected
    where p_cursor is null
      or (log_date, resource_type, resource_line_id)
        < (v_cursor_date, v_cursor_type, v_cursor_line_id)
    order by log_date desc, resource_type desc, resource_line_id desc
    limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (
      order by log_date desc, resource_type desc, resource_line_id desc
    ) as row_number from page
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'resourceLineId', resource_line_id,
        'resourceType', resource_type,
        'dailyLogId', daily_log_id,
        'summarySourceId', summary_source_id,
        'contributionId', contribution_id,
        'revisionNo', revision_no,
        'revisionState', revision_state,
        'projectId', project_id,
        'constructionSiteId', construction_site_id,
        'logDate', log_date,
        'workAreaCode', work_area_code,
        'workAreaName', work_area_name,
        'taskId', task_id,
        'wbsCode', wbs_code,
        'taskName', task_name,
        'provider', jsonb_build_object(
          'entryMode', provider_entry_mode,
          'partnerId', partner_id,
          'providerCodeSnapshot', provider_code_snapshot,
          'providerNameSnapshot', provider_name_snapshot,
          'manualProviderType', manual_provider_type,
          'manualProviderName', manual_provider_name,
          'manualProviderNote', manual_provider_note
        ),
        'peopleCount', people_count,
        'hoursPerPerson', hours_per_person,
        'totalLaborHours', total_labor_hours,
        'machineCount', machine_count,
        'hoursPerMachine', hours_per_machine,
        'totalMachineHours', total_machine_hours,
        'sourceUserName', source_user_name,
        'verifiedByName', verified_by_name,
        'verifiedAt', verified_at
      ) order by log_date desc, resource_type desc, resource_line_id desc)
      from numbered where row_number <= p_limit
    ), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'providerCount', count(distinct provider_key),
        'peopleCount', coalesce(sum(people_count), 0),
        'totalLaborHours', coalesce(sum(total_labor_hours), 0),
        'machineCount', coalesce(sum(machine_count), 0),
        'totalMachineHours', coalesce(sum(total_machine_hours), 0),
        'lineCount', count(*)
      ) from selected where revision_state = 'current'
    ),
    'nextCursor', (
      select case when exists(select 1 from numbered where row_number = p_limit + 1)
        then encode(convert_to(
          log_date::text || '|' || resource_type || '|' || resource_line_id, 'UTF8'
        ), 'base64') else null end
      from numbered where row_number = p_limit
    ),
    'unknownLegacyCount', (
      select count(*) from (
        select labor.id from public.daily_log_labor labor
        join public.daily_logs log on log.id = labor.daily_log_id
        where log.project_id = p_project_id
          and log.construction_site_id is not distinct from v_site_id
          and log.date between v_from_date::text and v_to_date::text
          and log.status = 'verified'
          and labor.resource_semantics_version = 1
        union all
        select machine.id from public.daily_log_machines machine
        join public.daily_logs log on log.id = machine.daily_log_id
        where log.project_id = p_project_id
          and log.construction_site_id is not distinct from v_site_id
          and log.date between v_from_date::text and v_to_date::text
          and log.status = 'verified'
          and machine.resource_semantics_version = 1
      ) unknown_rows
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function app_private.get_verified_resource_usage_evidence_impl_v1(
  text, text, date, date, text, text, text, boolean, text, integer
) from public, anon;
grant execute on function app_private.get_verified_resource_usage_evidence_impl_v1(
  text, text, date, date, text, text, text, boolean, text, integer
) to authenticated;

create function public.get_verified_resource_usage_evidence_v1(
  p_project_id text,
  p_construction_site_id text default null,
  p_from_date date default null,
  p_to_date date default null,
  p_provider_key text default null,
  p_task_id text default null,
  p_resource_type text default null,
  p_include_superseded boolean default false,
  p_cursor text default null,
  p_limit integer default 200
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_verified_resource_usage_evidence_impl_v1(
    p_project_id, p_construction_site_id, p_from_date, p_to_date,
    p_provider_key, p_task_id, p_resource_type, p_include_superseded,
    p_cursor, p_limit
  );
$$;
revoke all on function public.get_verified_resource_usage_evidence_v1(
  text, text, date, date, text, text, text, boolean, text, integer
) from public, anon;
grant execute on function public.get_verified_resource_usage_evidence_v1(
  text, text, date, date, text, text, text, boolean, text, integer
) to authenticated;

notify pgrst, 'reload schema';

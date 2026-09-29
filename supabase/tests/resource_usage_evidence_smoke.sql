-- Authorized baseline-vioo-git branch fixture only. All writes roll back.
begin;

do $$
declare
  v_log public.daily_logs%rowtype;
  v_partner_id text;
  v_before bigint;
begin
  select * into v_log from public.daily_logs
  where project_id = 'DL-WBS-PILOT-20260925'
    and summary_source_type = 'member_contributions'
    and status = 'verified'
    and superseded_by_daily_log_id is null
  order by date desc limit 1;
  if v_log.id is null then raise exception 'RESOURCE_EVIDENCE_VERIFIED_FIXTURE_MISSING'; end if;
  if not exists(select 1 from public.daily_log_labor
    where daily_log_id = v_log.id and resource_semantics_version = 2 and provider_entry_mode = 'catalog')
    or not exists(select 1 from public.daily_log_machines
    where daily_log_id = v_log.id and resource_semantics_version = 2 and provider_entry_mode = 'manual') then
    raise exception 'RESOURCE_EVIDENCE_PROVIDER_FIXTURE_MISSING';
  end if;
  perform set_config('app.resource_evidence_smoke_date', v_log.date, true);
  perform set_config('app.resource_evidence_smoke_log_id', v_log.id, true);
  perform set_config('app.resource_evidence_smoke_member_id', coalesce((
    select member.id::text from public.project_permission_room_members member
    where member.project_id = 'DL-WBS-PILOT-20260925'
      and member.construction_site_id is null and member.room_code = 'payment'
      and member.project_staff_id = '72000000-0000-4000-8002-000000000005'
    limit 1
  ), gen_random_uuid()::text), true);
  select count(*) into v_before from public.project_transactions
  where project_id = v_log.project_id;
  perform set_config('app.resource_evidence_tx_before', v_before::text, true);

  -- Legacy rows may contain historical prices, but the evidence JSON must not.
  insert into public.daily_log_labor(daily_log_id, project_id, construction_site_id,
    labor_type, count, hours, unit_cost, total_cost, resource_semantics_version)
  values(v_log.id, v_log.project_id, v_log.construction_site_id,
    'Legacy unknown', 1, 8, 900000, 900000, 1);

  select partner_id into v_partner_id from public.daily_log_labor
  where daily_log_id = v_log.id and provider_entry_mode = 'catalog' limit 1;
  update public.business_partners set is_active = false where id = v_partner_id;
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"89441ea9-ec40-46f3-b8ef-b647e6ede9b8","role":"authenticated"}';
do $$
declare v_direct_rows bigint; v_daily_log_rows jsonb;
begin
  begin
    perform public.get_verified_resource_usage_evidence_v1(
      'DL-WBS-PILOT-20260925', null,
      current_setting('app.resource_evidence_smoke_date')::date,
      current_setting('app.resource_evidence_smoke_date')::date
    );
    raise exception 'RESOURCE_EVIDENCE_UNGRANTED_READER_ACCEPTED';
  exception when others then
    if sqlerrm <> 'RESOURCE_EVIDENCE_SCOPE_DENIED' then raise; end if;
  end;
  select count(*) into v_direct_rows from public.daily_log_labor
  where daily_log_id = current_setting('app.resource_evidence_smoke_log_id')
    and resource_semantics_version = 2;
  if v_direct_rows <> 0 then
    raise exception 'RESOURCE_EVIDENCE_DIRECT_TABLE_BYPASS';
  end if;
  v_daily_log_rows := public.get_daily_log_physical_resources_v1(
    array[current_setting('app.resource_evidence_smoke_log_id')]);
  if jsonb_array_length(v_daily_log_rows) <> 2
    or v_daily_log_rows::text ~* '(unit_cost|total_cost|amount|price)' then
    raise exception 'DAILY_LOG_PHYSICAL_READ_REGRESSION: %', v_daily_log_rows;
  end if;
end;
$$;
reset role;

insert into public.project_permission_room_members(
  id, project_id, room_code, project_staff_id, is_active, created_by
) values (
  current_setting('app.resource_evidence_smoke_member_id')::uuid, 'DL-WBS-PILOT-20260925', 'payment',
  '72000000-0000-4000-8002-000000000005', true,
  '72000000-0000-4000-8000-000000000004'
) on conflict (id) do update set is_active = true;
insert into public.project_permission_room_member_actions(
  room_member_id, action_code, is_active, granted_by, grant_source
) values (
  current_setting('app.resource_evidence_smoke_member_id')::uuid, 'view_resource_evidence', true,
  '72000000-0000-4000-8000-000000000004', 'manual_room'
) on conflict (room_member_id, action_code) do update set is_active = true;
update app_private.project_permission_room_action_bindings
set enforcement_status = 'pilot', pbac_fallback_enabled = false
where room_code = 'payment' and action_code = 'view_resource_evidence';

set local role authenticated;
set local request.jwt.claims = '{"sub":"89441ea9-ec40-46f3-b8ef-b647e6ede9b8","role":"authenticated"}';
do $$
declare
  v_day date := current_setting('app.resource_evidence_smoke_date')::date;
  v_result jsonb;
  v_first jsonb;
  v_next jsonb;
begin
  v_result := public.get_verified_resource_usage_evidence_v1(
    'DL-WBS-PILOT-20260925', null, v_day, v_day
  );
  if jsonb_array_length(v_result->'rows') <> 2
    or (v_result->'totals'->>'totalLaborHours')::numeric <> 40
    or (v_result->'totals'->>'totalMachineHours')::numeric <> 12
    or (v_result->>'unknownLegacyCount')::integer <> 1 then
    raise exception 'RESOURCE_EVIDENCE_PHYSICAL_TOTALS_WRONG: %', v_result;
  end if;
  if not exists(select 1 from jsonb_array_elements(v_result->'rows') row
    where row->>'resourceType' = 'labor'
      and row->'provider'->>'entryMode' = 'catalog'
      and row->'provider'->>'providerNameSnapshot' is not null)
    or not exists(select 1 from jsonb_array_elements(v_result->'rows') row
    where row->>'resourceType' = 'machine'
      and row->'provider'->>'entryMode' = 'manual'
      and row->'provider'->>'manualProviderName' is not null) then
    raise exception 'RESOURCE_EVIDENCE_PROVIDER_SNAPSHOT_MISSING';
  end if;
  if v_result::text ~* '(unitCost|totalCost|unit_cost|total_cost|"rate"|"amount"|"currency")'
    or v_result::text like '%900000%' then
    raise exception 'RESOURCE_EVIDENCE_MONEY_LEAK';
  end if;
  if jsonb_array_length(public.get_verified_resource_usage_evidence_v1(
    'DL-WBS-PILOT-20260925', null, v_day, v_day,
    'manual:machine_owner:chu may anh binh'
  )->'rows') <> 1 then
    raise exception 'RESOURCE_EVIDENCE_MANUAL_PROVIDER_KEY_MISMATCH';
  end if;

  v_first := public.get_verified_resource_usage_evidence_v1(
    'DL-WBS-PILOT-20260925', null, v_day, v_day,
    null, null, null, false, null, 1
  );
  if jsonb_array_length(v_first->'rows') <> 1 or v_first->>'nextCursor' is null then
    raise exception 'RESOURCE_EVIDENCE_CURSOR_FIRST_PAGE_WRONG';
  end if;
  v_next := public.get_verified_resource_usage_evidence_v1(
    'DL-WBS-PILOT-20260925', null, v_day, v_day,
    null, null, null, false, v_first->>'nextCursor', 1
  );
  if jsonb_array_length(v_next->'rows') <> 1
    or v_next->'rows'->0->>'resourceLineId' = v_first->'rows'->0->>'resourceLineId' then
    raise exception 'RESOURCE_EVIDENCE_CURSOR_DUPLICATED_ROW';
  end if;

  begin
    perform public.get_verified_resource_usage_evidence_v1(
      'another-project', null, v_day, v_day
    );
    raise exception 'RESOURCE_EVIDENCE_CROSS_SCOPE_ACCEPTED';
  exception when others then
    if sqlerrm <> 'RESOURCE_EVIDENCE_SCOPE_DENIED' then raise; end if;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"47af03e4-4aa8-43b8-8b9f-540ca9099be1","role":"authenticated"}';
do $$
declare v_rows bigint;
begin
  begin
    perform public.get_verified_resource_usage_evidence_v1(
      'DL-WBS-PILOT-20260925', null,
      current_setting('app.resource_evidence_smoke_date')::date,
      current_setting('app.resource_evidence_smoke_date')::date
    );
    raise exception 'RESOURCE_EVIDENCE_DENIED_ACTOR_ACCEPTED';
  exception when others then
    if sqlerrm <> 'RESOURCE_EVIDENCE_SCOPE_DENIED' then raise; end if;
  end;
  select count(*) into v_rows from public.daily_log_labor
  where daily_log_id = current_setting('app.resource_evidence_smoke_log_id');
  if v_rows <> 0 then raise exception 'RESOURCE_EVIDENCE_DIRECT_TABLE_BYPASS'; end if;
end;
$$;
reset role;

-- Simulate a superseded revision without altering retained evidence permanently.
select set_config('app.daily_log_revision_context', 'on', true);
update public.daily_logs set superseded_by_daily_log_id = (
  select id from public.daily_logs
  where project_id = 'DL-WBS-PILOT-20260925'
    and id <> current_setting('app.resource_evidence_smoke_log_id')
    and summary_source_type = 'member_contributions'
    and status = 'verified'
  order by date desc limit 1
) where id = current_setting('app.resource_evidence_smoke_log_id');

set local role authenticated;
set local request.jwt.claims = '{"sub":"89441ea9-ec40-46f3-b8ef-b647e6ede9b8","role":"authenticated"}';
do $$
declare
  v_day date := current_setting('app.resource_evidence_smoke_date')::date;
  v_current jsonb;
  v_history jsonb;
begin
  v_current := public.get_verified_resource_usage_evidence_v1(
    'DL-WBS-PILOT-20260925', null, v_day, v_day
  );
  v_history := public.get_verified_resource_usage_evidence_v1(
    'DL-WBS-PILOT-20260925', null, v_day, v_day,
    null, null, null, true
  );
  if jsonb_array_length(v_current->'rows') <> 0
    or jsonb_array_length(v_history->'rows') <> 2
    or (v_history->'totals'->>'lineCount')::integer <> 0
    or exists(select 1 from jsonb_array_elements(v_history->'rows') row
      where row->>'revisionState' <> 'superseded') then
    raise exception 'RESOURCE_EVIDENCE_REVISION_DOUBLE_COUNT';
  end if;
end;
$$;
reset role;

do $$
declare v_after bigint;
begin
  select count(*) into v_after from public.project_transactions
  where project_id = 'DL-WBS-PILOT-20260925';
  if v_after <> current_setting('app.resource_evidence_tx_before')::bigint then
    raise exception 'RESOURCE_EVIDENCE_CREATED_PROJECT_TRANSACTION';
  end if;
end;
$$;

rollback;

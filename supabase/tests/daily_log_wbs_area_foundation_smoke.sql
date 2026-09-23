-- Cloud-only Daily Log WBS area foundation smoke. All writes roll back.
begin;

do $$
declare
  v_constraint_names text[];
begin
  if to_regclass('public.daily_log_work_items') is null then
    raise exception 'daily_log_work_items is missing';
  end if;
  if to_regclass('public.daily_log_wbs_decisions') is null then
    raise exception 'daily_log_wbs_decisions is missing';
  end if;
  if to_regclass('app_private.daily_log_wbs_rollout_scopes') is null then
    raise exception 'daily_log_wbs_rollout_scopes is missing';
  end if;

  select array_agg(constraint_name order by constraint_name)
  into v_constraint_names
  from information_schema.table_constraints
  where table_schema = 'public'
    and table_name in ('daily_log_work_items', 'daily_log_labor', 'daily_log_machines');

  if not ('daily_log_work_items_owner_check' = any(v_constraint_names)) then
    raise exception 'daily_log_work_items owner check is missing';
  end if;
  if not ('daily_log_labor_owner_check' = any(v_constraint_names)) then
    raise exception 'daily_log_labor owner check is missing';
  end if;
  if not ('daily_log_machines_owner_check' = any(v_constraint_names)) then
    raise exception 'daily_log_machines owner check is missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'daily_log_work_items_contribution_task_unique'
      and indexdef ilike '%unique%'
  ) then
    raise exception 'contribution/task unique index is missing';
  end if;
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'daily_log_work_items_summary_source_task_unique'
      and indexdef ilike '%unique%'
  ) then
    raise exception 'summary-source/task unique index is missing';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'daily_log_work_items'
      and relation.relrowsecurity
  ) then
    raise exception 'daily_log_work_items RLS is disabled';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_log_work_items'
      and policyname = 'daily_log_work_items_select'
      and 'authenticated' = any(roles)
  ) then
    raise exception 'daily_log_work_items SELECT policy is missing';
  end if;
  if has_table_privilege('authenticated', 'public.daily_log_work_items', 'INSERT')
    or has_table_privilege('authenticated', 'public.daily_log_work_items', 'UPDATE')
    or has_table_privilege('authenticated', 'public.daily_log_work_items', 'DELETE') then
    raise exception 'authenticated has a direct write path to daily_log_work_items';
  end if;
  if has_table_privilege('authenticated', 'app_private.daily_log_wbs_rollout_scopes', 'SELECT') then
    raise exception 'authenticated can read private rollout configuration directly';
  end if;
end;
$$;

do $$
declare
  v_mode text;
begin
  select coalesce((
    select rollout.mode
    from app_private.daily_log_wbs_rollout_scopes rollout
    where rollout.project_id = '__daily_log_wbs_unconfigured__'
      and rollout.construction_site_id = '__daily_log_wbs_unconfigured__'
  ), 'off')
  into v_mode;

  if v_mode <> 'off' then
    raise exception 'unconfigured rollout scope did not fail closed';
  end if;
end;
$$;

do $$
declare
  v_labor_before bigint;
  v_machine_before bigint;
begin
  if to_regprocedure('app_private.assert_daily_log_wbs_resource_payload_v1(jsonb,jsonb)') is null then
    raise exception 'daily log WBS resource payload validator is missing';
  end if;

  begin
    perform app_private.assert_daily_log_wbs_resource_payload_v1(
      '[{"workItemClientKey":"work-1","laborType":"Tổ xây dựng","peopleCount":5,"hoursPerPerson":8,"provider":{"entryMode":"manual","manualProviderType":"free_crew"}}]'::jsonb,
      '[]'::jsonb
    );
    raise exception 'manual provider without a name was accepted';
  exception
    when others then
      if sqlerrm <> 'MANUAL_PROVIDER_NAME_REQUIRED' then raise; end if;
  end;

  select count(*) into v_labor_before from public.daily_log_labor;
  select count(*) into v_machine_before from public.daily_log_machines;
  begin
    perform app_private.assert_daily_log_wbs_resource_payload_v1(
      '[{"workItemClientKey":"work-1","laborType":"Tổ xây dựng","peopleCount":5,"hoursPerPerson":8,"unitCost":1000,"provider":{"entryMode":"manual","manualProviderType":"free_crew","manualProviderName":"Tổ anh Minh"}}]'::jsonb,
      '[]'::jsonb
    );
    raise exception 'labor unitCost was accepted';
  exception
    when others then
      if sqlerrm <> 'RESOURCE_PRICE_FIELDS_NOT_ALLOWED' then raise; end if;
  end;
  begin
    perform app_private.assert_daily_log_wbs_resource_payload_v1(
      '[{"workItemClientKey":"work-1","laborType":"Tổ xây dựng","peopleCount":5,"hoursPerPerson":8,"totalCost":5000,"provider":{"entryMode":"manual","manualProviderType":"free_crew","manualProviderName":"Tổ anh Minh"}}]'::jsonb,
      '[]'::jsonb
    );
    raise exception 'labor totalCost was accepted';
  exception
    when others then
      if sqlerrm <> 'RESOURCE_PRICE_FIELDS_NOT_ALLOWED' then raise; end if;
  end;
  if (select count(*) from public.daily_log_labor) <> v_labor_before
    or (select count(*) from public.daily_log_machines) <> v_machine_before then
    raise exception 'resource validation failure wrote detail rows';
  end if;
end;
$$;

rollback;

alter table public.daily_log_contributions
  add column work_area_code text,
  add column work_area_name text,
  add column row_version bigint not null default 1,
  add column source_fingerprint text,
  add constraint daily_log_contributions_row_version_check check (row_version > 0);

alter table public.daily_log_summary_sources
  add column sort_order integer not null default 0,
  add column source_version bigint,
  add column source_fingerprint text,
  add column source_snapshot jsonb not null default '{}'::jsonb,
  add column source_state text not null default 'current',
  add column work_area_code text,
  add column work_area_name text,
  add column has_adjustments boolean not null default false,
  add column adjustment_reason text,
  add column adjusted_by text,
  add column adjusted_at timestamptz,
  add column review_status text not null default 'draft',
  add column review_comment text,
  add column reviewed_by text,
  add column reviewed_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add constraint daily_log_summary_sources_source_version_check
    check (source_version is null or source_version > 0),
  add constraint daily_log_summary_sources_snapshot_check
    check (jsonb_typeof(source_snapshot) = 'object'),
  add constraint daily_log_summary_sources_source_state_check
    check (source_state in ('current', 'changed', 'returned', 'missing')),
  add constraint daily_log_summary_sources_review_status_check
    check (review_status in ('draft', 'ready', 'change_requested', 'accepted', 'superseded')),
  add constraint daily_log_summary_sources_adjustment_audit_check
    check (
      not has_adjustments
      or (
        nullif(trim(adjustment_reason), '') is not null
        and adjusted_by is not null
        and adjusted_at is not null
      )
    );

create table public.daily_log_work_items (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid references public.daily_log_contributions(id) on delete cascade,
  daily_log_id text references public.daily_logs(id) on delete cascade,
  summary_source_id uuid references public.daily_log_summary_sources(id) on delete cascade,
  source_work_item_id uuid references public.daily_log_work_items(id) on delete set null,
  project_id text references public.projects(id) on delete restrict,
  construction_site_id text,
  task_id text not null references public.project_tasks(id) on delete restrict,
  work_boq_item_id text references public.project_work_boq_items(id) on delete set null,
  work_area_code text not null,
  work_area_name_snapshot text not null,
  wbs_code_snapshot text,
  task_name_snapshot text not null,
  unit_snapshot text,
  planned_quantity_snapshot numeric,
  area_planned_quantity_snapshot numeric,
  baseline_progress_percent numeric not null,
  baseline_quantity_done numeric,
  baseline_progress_row_id uuid references public.project_daily_task_progress(id) on delete set null,
  baseline_fingerprint text not null,
  cumulative_progress_percent numeric not null,
  cumulative_quantity_done numeric,
  daily_quantity_done numeric,
  schedule_finish_date_snapshot date,
  forecast_finish_date date,
  forecast_change_reason text,
  note text,
  attachments jsonb not null default '[]'::jsonb,
  source_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_log_work_items_owner_check check (
    (
      contribution_id is not null
      and daily_log_id is null
      and summary_source_id is null
    )
    or (
      contribution_id is null
      and daily_log_id is not null
      and summary_source_id is not null
    )
  ),
  constraint daily_log_work_items_area_check check (
    nullif(trim(work_area_code), '') is not null
    and nullif(trim(work_area_name_snapshot), '') is not null
  ),
  constraint daily_log_work_items_progress_check check (
    baseline_progress_percent >= 0
    and cumulative_progress_percent >= 0
    and (baseline_quantity_done is null or baseline_quantity_done >= 0)
    and (cumulative_quantity_done is null or cumulative_quantity_done >= 0)
  ),
  constraint daily_log_work_items_quantity_snapshot_check check (
    (planned_quantity_snapshot is null or planned_quantity_snapshot >= 0)
    and (area_planned_quantity_snapshot is null or area_planned_quantity_snapshot > 0)
  ),
  constraint daily_log_work_items_attachments_check check (
    jsonb_typeof(attachments) = 'array'
  )
);

create unique index daily_log_work_items_contribution_task_unique
  on public.daily_log_work_items (contribution_id, task_id)
  where contribution_id is not null;

create unique index daily_log_work_items_summary_source_task_unique
  on public.daily_log_work_items (daily_log_id, summary_source_id, task_id)
  where summary_source_id is not null;

create index daily_log_work_items_scope_task_idx
  on public.daily_log_work_items (project_id, construction_site_id, task_id);

create index daily_log_work_items_daily_log_idx
  on public.daily_log_work_items (daily_log_id, summary_source_id);

create table public.daily_log_wbs_decisions (
  id uuid primary key default gen_random_uuid(),
  daily_log_id text not null references public.daily_logs(id) on delete cascade,
  task_id text not null references public.project_tasks(id) on delete restrict,
  official_cumulative_percent numeric not null,
  official_cumulative_quantity numeric,
  official_daily_quantity numeric,
  forecast_finish_date date,
  aggregation_method text not null check (
    aggregation_method in ('single_source', 'weighted_area_allocation', 'manual_override')
  ),
  daily_quantity_method text not null check (
    daily_quantity_method in ('sum_non_overlapping', 'keep_selected_sources', 'manual_override')
  ),
  included_source_work_item_ids jsonb not null default '[]'::jsonb,
  resolution_reason text,
  forecast_resolution_reason text,
  source_fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_log_id, task_id),
  constraint daily_log_wbs_decisions_progress_check check (
    official_cumulative_percent >= 0
    and (official_cumulative_quantity is null or official_cumulative_quantity >= 0)
  ),
  constraint daily_log_wbs_decisions_manual_reason_check check (
    (
      aggregation_method <> 'manual_override'
      and daily_quantity_method <> 'manual_override'
    )
    or nullif(trim(resolution_reason), '') is not null
  ),
  constraint daily_log_wbs_decisions_sources_check check (
    jsonb_typeof(included_source_work_item_ids) = 'array'
    and jsonb_array_length(included_source_work_item_ids) > 0
  )
);

create index daily_log_wbs_decisions_daily_log_idx
  on public.daily_log_wbs_decisions (daily_log_id, task_id);

alter table public.daily_log_labor
  alter column daily_log_id drop not null,
  add column daily_log_work_item_id uuid references public.daily_log_work_items(id) on delete cascade,
  add column contribution_id uuid references public.daily_log_contributions(id) on delete cascade,
  add column summary_source_id uuid references public.daily_log_summary_sources(id) on delete cascade,
  add column source_labor_line_id uuid references public.daily_log_labor(id) on delete set null,
  add column people_count numeric,
  add column hours_per_person numeric,
  add column total_labor_hours numeric,
  add column provider_entry_mode text,
  add column provider_code_snapshot text,
  add column provider_name_snapshot text,
  add column manual_provider_type text,
  add column manual_provider_name text,
  add column manual_provider_note text,
  add column resource_semantics_version integer not null default 1,
  add constraint daily_log_labor_semantics_version_check
    check (resource_semantics_version in (1, 2)),
  add constraint daily_log_labor_owner_check check (
    (
      resource_semantics_version = 1
      and daily_log_id is not null
      and daily_log_work_item_id is null
      and contribution_id is null
      and summary_source_id is null
    )
    or (
      resource_semantics_version = 2
      and daily_log_id is null
      and daily_log_work_item_id is not null
      and contribution_id is not null
      and summary_source_id is null
    )
    or (
      resource_semantics_version = 2
      and daily_log_id is not null
      and daily_log_work_item_id is not null
      and contribution_id is null
      and summary_source_id is not null
    )
  ),
  add constraint daily_log_labor_provider_check check (
    resource_semantics_version = 1
    or (
      provider_entry_mode = 'catalog'
      and partner_id is not null
      and nullif(trim(provider_name_snapshot), '') is not null
      and manual_provider_type is null
      and manual_provider_name is null
      and manual_provider_note is null
    )
    or (
      provider_entry_mode = 'manual'
      and partner_id is null
      and provider_code_snapshot is null
      and provider_name_snapshot is null
      and manual_provider_type in ('free_crew', 'day_labor', 'unregistered_provider', 'other')
      and nullif(trim(manual_provider_name), '') is not null
    )
  ),
  add constraint daily_log_labor_physical_usage_check check (
    resource_semantics_version = 1
    or (
      people_count > 0
      and hours_per_person > 0
      and total_labor_hours > 0
      and abs(total_labor_hours - people_count * hours_per_person) <= 0.0001
    )
  ),
  add constraint daily_log_labor_v2_no_money_check check (
    resource_semantics_version = 1
    or (unit_cost is null and total_cost is null)
  );

alter table public.daily_log_machines
  alter column daily_log_id drop not null,
  add column daily_log_work_item_id uuid references public.daily_log_work_items(id) on delete cascade,
  add column contribution_id uuid references public.daily_log_contributions(id) on delete cascade,
  add column summary_source_id uuid references public.daily_log_summary_sources(id) on delete cascade,
  add column source_machine_line_id uuid references public.daily_log_machines(id) on delete set null,
  add column machine_count numeric,
  add column hours_per_machine numeric,
  add column total_machine_hours numeric,
  add column provider_entry_mode text,
  add column provider_code_snapshot text,
  add column provider_name_snapshot text,
  add column manual_provider_type text,
  add column manual_provider_name text,
  add column manual_provider_note text,
  add column resource_semantics_version integer not null default 1,
  add constraint daily_log_machines_semantics_version_check
    check (resource_semantics_version in (1, 2)),
  add constraint daily_log_machines_owner_check check (
    (
      resource_semantics_version = 1
      and daily_log_id is not null
      and daily_log_work_item_id is null
      and contribution_id is null
      and summary_source_id is null
    )
    or (
      resource_semantics_version = 2
      and daily_log_id is null
      and daily_log_work_item_id is not null
      and contribution_id is not null
      and summary_source_id is null
    )
    or (
      resource_semantics_version = 2
      and daily_log_id is not null
      and daily_log_work_item_id is not null
      and contribution_id is null
      and summary_source_id is not null
    )
  ),
  add constraint daily_log_machines_provider_check check (
    resource_semantics_version = 1
    or (
      provider_entry_mode = 'catalog'
      and partner_id is not null
      and nullif(trim(provider_name_snapshot), '') is not null
      and manual_provider_type is null
      and manual_provider_name is null
      and manual_provider_note is null
    )
    or (
      provider_entry_mode = 'manual'
      and partner_id is null
      and provider_code_snapshot is null
      and provider_name_snapshot is null
      and manual_provider_type in ('machine_owner', 'unregistered_rental_provider', 'other')
      and nullif(trim(manual_provider_name), '') is not null
    )
  ),
  add constraint daily_log_machines_physical_usage_check check (
    resource_semantics_version = 1
    or (
      machine_count > 0
      and hours_per_machine > 0
      and total_machine_hours > 0
      and abs(total_machine_hours - machine_count * hours_per_machine) <= 0.0001
    )
  ),
  add constraint daily_log_machines_v2_no_money_check check (
    resource_semantics_version = 1
    or (unit_cost is null and total_cost is null)
  );

create index daily_log_labor_work_item_idx
  on public.daily_log_labor (daily_log_work_item_id);
create index daily_log_labor_contribution_idx
  on public.daily_log_labor (contribution_id);
create index daily_log_labor_summary_source_idx
  on public.daily_log_labor (summary_source_id);
create index daily_log_labor_provider_idx
  on public.daily_log_labor (partner_id, manual_provider_type, manual_provider_name);

create index daily_log_machines_work_item_idx
  on public.daily_log_machines (daily_log_work_item_id);
create index daily_log_machines_contribution_idx
  on public.daily_log_machines (contribution_id);
create index daily_log_machines_summary_source_idx
  on public.daily_log_machines (summary_source_id);
create index daily_log_machines_provider_idx
  on public.daily_log_machines (partner_id, manual_provider_type, manual_provider_name);

create table app_private.daily_log_wbs_rollout_scopes (
  id uuid primary key default gen_random_uuid(),
  project_id text,
  construction_site_id text,
  mode text not null check (mode in ('off', 'pilot', 'enforced', 'paused')),
  cutover_date date not null,
  reason text not null check (nullif(trim(reason), '') is not null),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (project_id, construction_site_id)
);

create function public.get_daily_log_wbs_rollout_access_v1(
  p_project_id text,
  p_construction_site_id text,
  p_log_date date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_mode text := 'off';
  v_cutover_date date;
begin
  if v_actor_id is null or not app_private.daily_log_can_select(
    p_project_id,
    p_construction_site_id,
    v_actor_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'DAILY_LOG_WBS_ROLLOUT_ACCESS_DENIED';
  end if;

  select rollout.mode, rollout.cutover_date
  into v_mode, v_cutover_date
  from app_private.daily_log_wbs_rollout_scopes rollout
  where (rollout.project_id is null or rollout.project_id = p_project_id)
    and (
      rollout.construction_site_id is null
      or rollout.construction_site_id = p_construction_site_id
    )
  order by
    (rollout.project_id is not null) desc,
    (rollout.construction_site_id is not null) desc,
    rollout.updated_at desc
  limit 1;

  v_mode := coalesce(v_mode, 'off');
  return jsonb_build_object(
    'mode', v_mode,
    'cutoverDate', v_cutover_date,
    'enabled', (
      v_mode in ('pilot', 'enforced')
      and v_cutover_date is not null
      and p_log_date >= v_cutover_date
    )
  );
end;
$$;

revoke all on function public.get_daily_log_wbs_rollout_access_v1(text, text, date)
  from public, anon, authenticated;
grant execute on function public.get_daily_log_wbs_rollout_access_v1(text, text, date)
  to authenticated;

alter table public.daily_log_work_items enable row level security;
alter table public.daily_log_wbs_decisions enable row level security;

create policy daily_log_work_items_active_actor_gate
  on public.daily_log_work_items
  as restrictive
  to authenticated
  using ((select public.current_app_user_id()) is not null)
  with check ((select public.current_app_user_id()) is not null);

create policy daily_log_work_items_select
  on public.daily_log_work_items
  for select
  to authenticated
  using (
    (
      contribution_id is not null
      and exists (
        select 1
        from public.daily_log_contributions contribution
        where contribution.id = daily_log_work_items.contribution_id
          and app_private.daily_log_contribution_can_view(
            contribution.project_id,
            contribution.construction_site_id,
            contribution.author_user_id,
            contribution.submitted_to_user_id
          )
      )
    )
    or (
      daily_log_id is not null
      and exists (
        select 1
        from public.daily_logs daily_log
        where daily_log.id = daily_log_work_items.daily_log_id
          and app_private.daily_log_can_select(
            daily_log.project_id,
            daily_log.construction_site_id,
            public.current_app_user_id()
          )
      )
    )
  );

create policy daily_log_wbs_decisions_active_actor_gate
  on public.daily_log_wbs_decisions
  as restrictive
  to authenticated
  using ((select public.current_app_user_id()) is not null)
  with check ((select public.current_app_user_id()) is not null);

create policy daily_log_wbs_decisions_select
  on public.daily_log_wbs_decisions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs daily_log
      where daily_log.id = daily_log_wbs_decisions.daily_log_id
        and app_private.daily_log_can_select(
          daily_log.project_id,
          daily_log.construction_site_id,
          public.current_app_user_id()
        )
    )
  );

revoke all on table public.daily_log_work_items from anon;
revoke all on table public.daily_log_wbs_decisions from anon;
revoke insert, update, delete on public.daily_log_work_items from authenticated;
revoke insert, update, delete on public.daily_log_wbs_decisions from authenticated;
grant select on table public.daily_log_work_items to authenticated;
grant select on table public.daily_log_wbs_decisions to authenticated;
grant all on table public.daily_log_work_items to service_role;
grant all on table public.daily_log_wbs_decisions to service_role;

drop policy daily_log_labor_select on public.daily_log_labor;
create policy daily_log_labor_select
  on public.daily_log_labor
  for select
  to authenticated
  using (
    (
      contribution_id is not null
      and exists (
        select 1
        from public.daily_log_contributions contribution
        where contribution.id = daily_log_labor.contribution_id
          and app_private.daily_log_contribution_can_view(
            contribution.project_id,
            contribution.construction_site_id,
            contribution.author_user_id,
            contribution.submitted_to_user_id
          )
      )
    )
    or (
      daily_log_id is not null
      and exists (
        select 1
        from public.daily_logs daily_log
        where daily_log.id = daily_log_labor.daily_log_id
          and app_private.daily_log_can_select(
            daily_log.project_id,
            daily_log.construction_site_id,
            public.current_app_user_id()
          )
      )
    )
  );

drop policy daily_log_labor_insert on public.daily_log_labor;
create policy daily_log_labor_insert
  on public.daily_log_labor
  for insert
  to authenticated
  with check (
    resource_semantics_version = 1
    and contribution_id is null
    and summary_source_id is null
    and daily_log_work_item_id is null
    and exists (
      select 1
      from public.daily_logs daily_log
      where daily_log.id = daily_log_labor.daily_log_id
        and app_private.daily_log_can_edit(
          daily_log.project_id,
          daily_log.construction_site_id,
          daily_log.status,
          daily_log.summary_source_type,
          daily_log.created_by_id,
          daily_log.submitted_by_id,
          daily_log.submitted_by,
          daily_log.created_by,
          public.current_app_user_id()
        )
    )
  );

drop policy daily_log_labor_update on public.daily_log_labor;
create policy daily_log_labor_update
  on public.daily_log_labor
  for update
  to authenticated
  using (
    resource_semantics_version = 1
    and exists (
      select 1
      from public.daily_logs daily_log
      where daily_log.id = daily_log_labor.daily_log_id
        and app_private.daily_log_can_edit(
          daily_log.project_id,
          daily_log.construction_site_id,
          daily_log.status,
          daily_log.summary_source_type,
          daily_log.created_by_id,
          daily_log.submitted_by_id,
          daily_log.submitted_by,
          daily_log.created_by,
          public.current_app_user_id()
        )
    )
  )
  with check (
    resource_semantics_version = 1
    and contribution_id is null
    and summary_source_id is null
    and daily_log_work_item_id is null
    and exists (
      select 1
      from public.daily_logs daily_log
      where daily_log.id = daily_log_labor.daily_log_id
        and app_private.daily_log_can_edit(
          daily_log.project_id,
          daily_log.construction_site_id,
          daily_log.status,
          daily_log.summary_source_type,
          daily_log.created_by_id,
          daily_log.submitted_by_id,
          daily_log.submitted_by,
          daily_log.created_by,
          public.current_app_user_id()
        )
    )
  );

drop policy daily_log_labor_delete on public.daily_log_labor;
create policy daily_log_labor_delete
  on public.daily_log_labor
  for delete
  to authenticated
  using (
    resource_semantics_version = 1
    and exists (
      select 1
      from public.daily_logs daily_log
      where daily_log.id = daily_log_labor.daily_log_id
        and app_private.daily_log_can_edit(
          daily_log.project_id,
          daily_log.construction_site_id,
          daily_log.status,
          daily_log.summary_source_type,
          daily_log.created_by_id,
          daily_log.submitted_by_id,
          daily_log.submitted_by,
          daily_log.created_by,
          public.current_app_user_id()
        )
    )
  );

drop policy daily_log_machines_select on public.daily_log_machines;
create policy daily_log_machines_select
  on public.daily_log_machines
  for select
  to authenticated
  using (
    (
      contribution_id is not null
      and exists (
        select 1
        from public.daily_log_contributions contribution
        where contribution.id = daily_log_machines.contribution_id
          and app_private.daily_log_contribution_can_view(
            contribution.project_id,
            contribution.construction_site_id,
            contribution.author_user_id,
            contribution.submitted_to_user_id
          )
      )
    )
    or (
      daily_log_id is not null
      and exists (
        select 1
        from public.daily_logs daily_log
        where daily_log.id = daily_log_machines.daily_log_id
          and app_private.daily_log_can_select(
            daily_log.project_id,
            daily_log.construction_site_id,
            public.current_app_user_id()
          )
      )
    )
  );

drop policy daily_log_machines_insert on public.daily_log_machines;
create policy daily_log_machines_insert
  on public.daily_log_machines
  for insert
  to authenticated
  with check (
    resource_semantics_version = 1
    and contribution_id is null
    and summary_source_id is null
    and daily_log_work_item_id is null
    and exists (
      select 1
      from public.daily_logs daily_log
      where daily_log.id = daily_log_machines.daily_log_id
        and app_private.daily_log_can_edit(
          daily_log.project_id,
          daily_log.construction_site_id,
          daily_log.status,
          daily_log.summary_source_type,
          daily_log.created_by_id,
          daily_log.submitted_by_id,
          daily_log.submitted_by,
          daily_log.created_by,
          public.current_app_user_id()
        )
    )
  );

drop policy daily_log_machines_update on public.daily_log_machines;
create policy daily_log_machines_update
  on public.daily_log_machines
  for update
  to authenticated
  using (
    resource_semantics_version = 1
    and exists (
      select 1
      from public.daily_logs daily_log
      where daily_log.id = daily_log_machines.daily_log_id
        and app_private.daily_log_can_edit(
          daily_log.project_id,
          daily_log.construction_site_id,
          daily_log.status,
          daily_log.summary_source_type,
          daily_log.created_by_id,
          daily_log.submitted_by_id,
          daily_log.submitted_by,
          daily_log.created_by,
          public.current_app_user_id()
        )
    )
  )
  with check (
    resource_semantics_version = 1
    and contribution_id is null
    and summary_source_id is null
    and daily_log_work_item_id is null
    and exists (
      select 1
      from public.daily_logs daily_log
      where daily_log.id = daily_log_machines.daily_log_id
        and app_private.daily_log_can_edit(
          daily_log.project_id,
          daily_log.construction_site_id,
          daily_log.status,
          daily_log.summary_source_type,
          daily_log.created_by_id,
          daily_log.submitted_by_id,
          daily_log.submitted_by,
          daily_log.created_by,
          public.current_app_user_id()
        )
    )
  );

drop policy daily_log_machines_delete on public.daily_log_machines;
create policy daily_log_machines_delete
  on public.daily_log_machines
  for delete
  to authenticated
  using (
    resource_semantics_version = 1
    and exists (
      select 1
      from public.daily_logs daily_log
      where daily_log.id = daily_log_machines.daily_log_id
        and app_private.daily_log_can_edit(
          daily_log.project_id,
          daily_log.construction_site_id,
          daily_log.status,
          daily_log.summary_source_type,
          daily_log.created_by_id,
          daily_log.submitted_by_id,
          daily_log.submitted_by,
          daily_log.created_by,
          public.current_app_user_id()
        )
    )
  );

comment on table public.daily_log_work_items is
  'Normalized WBS work rows owned by a contribution or an editable summary-source snapshot.';
comment on table public.daily_log_wbs_decisions is
  'Official summary-level WBS decisions; source rows never publish progress directly.';
comment on table app_private.daily_log_wbs_rollout_scopes is
  'Fail-closed project/site rollout state for Daily Log WBS entry and progress publication.';

-- Payment schedule workbench V1
-- Keep payment_schedules as the single source of truth for manual contract
-- payment plans, then enrich it with planned WBS scope and lightweight dossier
-- / quality status fields.

alter table if exists public.payment_schedules
  add column if not exists sequence_no integer not null default 1,
  add column if not exists milestone_type text not null default 'progress',
  add column if not exists planned_task_ids text[] not null default '{}'::text[],
  add column if not exists planned_scope_note text,
  add column if not exists dossier_status text not null default 'not_started',
  add column if not exists quality_status text not null default 'not_confirmed',
  add column if not exists quality_confirmed_by text,
  add column if not exists quality_confirmed_name text,
  add column if not exists quality_confirmed_at timestamptz,
  add column if not exists quality_note text;

do $$
begin
  if to_regclass('public.payment_schedules') is null then
    return;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_schedules_milestone_type_check'
      and conrelid = 'public.payment_schedules'::regclass
  ) then
    alter table public.payment_schedules
      add constraint payment_schedules_milestone_type_check
      check (milestone_type in ('advance', 'progress', 'settlement', 'retention', 'other'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_schedules_dossier_status_check'
      and conrelid = 'public.payment_schedules'::regclass
  ) then
    alter table public.payment_schedules
      add constraint payment_schedules_dossier_status_check
      check (dossier_status in ('not_started', 'preparing', 'submitted', 'approved'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_schedules_quality_status_check'
      and conrelid = 'public.payment_schedules'::regclass
  ) then
    alter table public.payment_schedules
      add constraint payment_schedules_quality_status_check
      check (quality_status in ('not_applicable', 'not_confirmed', 'passed', 'failed'));
  end if;
end $$;

create index if not exists idx_payment_schedules_due_status
  on public.payment_schedules(due_date, status);

create index if not exists idx_payment_schedules_milestone_type
  on public.payment_schedules(milestone_type);

create index if not exists idx_payment_schedules_planned_task_ids
  on public.payment_schedules using gin(planned_task_ids);

alter table public.payment_schedules enable row level security;

drop policy if exists payment_schedules_project_insert on public.payment_schedules;
drop policy if exists payment_schedules_project_update on public.payment_schedules;
drop policy if exists payment_schedules_project_delete on public.payment_schedules;

create policy payment_schedules_project_insert
  on public.payment_schedules
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'confirm')
  );

create policy payment_schedules_project_update
  on public.payment_schedules
  for update
  to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'confirm')
  )
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'confirm')
  );

create policy payment_schedules_project_delete
  on public.payment_schedules
  for delete
  to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'delete')
  );

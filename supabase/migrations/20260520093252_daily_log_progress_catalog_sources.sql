-- Daily-log driven project progress and standardized FastCons labor/machine snapshots.
-- Applies directly to Supabase cloud; no local DB required.

do $$
declare
  c record;
begin
  if to_regclass('public.project_tasks') is not null then
    for c in
      select conname
      from pg_constraint
      where conrelid = 'public.project_tasks'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%progress_mode%'
    loop
      execute format('alter table public.project_tasks drop constraint %I', c.conname);
    end loop;

    alter table public.project_tasks
      add constraint project_tasks_progress_mode_check
      check (progress_mode in ('manual', 'derived_from_acceptance', 'completion_request', 'daily_log', 'children_auto'));
  end if;
end;
$$;

alter table if exists public.contract_labor_catalogs
  add column if not exists partner_id text,
  add column if not exists partner_name text;

create index if not exists idx_contract_labor_catalogs_partner
  on public.contract_labor_catalogs(partner_id);

alter table if exists public.daily_log_volumes
  add column if not exists task_name text;

create index if not exists idx_daily_log_volumes_task
  on public.daily_log_volumes(task_id);

alter table if exists public.daily_log_labor
  add column if not exists catalog_item_id text,
  add column if not exists catalog_code text,
  add column if not exists catalog_name text,
  add column if not exists group_name text,
  add column if not exists partner_id text,
  add column if not exists partner_name text,
  add column if not exists task_id text,
  add column if not exists task_name text;

create index if not exists idx_daily_log_labor_catalog
  on public.daily_log_labor(catalog_item_id);

create index if not exists idx_daily_log_labor_task
  on public.daily_log_labor(task_id);

alter table if exists public.daily_log_machines
  add column if not exists catalog_item_id text,
  add column if not exists catalog_code text,
  add column if not exists catalog_name text,
  add column if not exists group_name text,
  add column if not exists task_id text,
  add column if not exists task_name text;

create index if not exists idx_daily_log_machines_catalog
  on public.daily_log_machines(catalog_item_id);

create index if not exists idx_daily_log_machines_task
  on public.daily_log_machines(task_id);

notify pgrst, 'reload schema';

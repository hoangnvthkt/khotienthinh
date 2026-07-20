-- Weekly WBS progress and value-progress support.

create table if not exists public.project_weekly_task_progress (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  task_id text not null references public.project_tasks(id) on delete cascade,
  week_start date not null,
  progress_percent numeric not null default 0
    check (progress_percent >= 0 and progress_percent <= 100),
  quantity_done numeric not null default 0
    check (quantity_done >= 0),
  note text,
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array'),
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint project_weekly_task_progress_scope_task_week_unique
    unique (scope_key, task_id, week_start)
);

create index if not exists idx_project_weekly_task_progress_scope_week
  on public.project_weekly_task_progress(scope_key, week_start desc);

create index if not exists idx_project_weekly_task_progress_project_week
  on public.project_weekly_task_progress(project_id, week_start desc)
  where project_id is not null;

create index if not exists idx_project_weekly_task_progress_site_week
  on public.project_weekly_task_progress(construction_site_id, week_start desc)
  where construction_site_id is not null;

create index if not exists idx_project_weekly_task_progress_task_week
  on public.project_weekly_task_progress(task_id, week_start desc);

drop trigger if exists trg_project_weekly_task_progress_updated_at
  on public.project_weekly_task_progress;
create trigger trg_project_weekly_task_progress_updated_at
  before update on public.project_weekly_task_progress
  for each row execute function public.set_updated_at();

alter table public.project_weekly_task_progress enable row level security;

drop policy if exists project_weekly_task_progress_all
  on public.project_weekly_task_progress;
create policy project_weekly_task_progress_all
  on public.project_weekly_task_progress
  for all
  to authenticated
  using (scope_key is not null and task_id is not null)
  with check (scope_key is not null and task_id is not null);

revoke all on table public.project_weekly_task_progress from anon;
revoke all on table public.project_weekly_task_progress from public;
revoke all on table public.project_weekly_task_progress from authenticated;
grant select, insert, update, delete on table public.project_weekly_task_progress to authenticated;

alter table if exists public.weekly_progress_snapshots
  alter column project_id type text using project_id::text,
  alter column construction_site_id type text using construction_site_id::text,
  add column if not exists construction_progress_percent numeric default 0,
  add column if not exists value_progress_percent numeric default 0,
  add column if not exists purchased_value numeric default 0,
  add column if not exists issued_value numeric default 0,
  add column if not exists recognized_value numeric default 0;

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
      check (progress_mode in (
        'manual',
        'derived_from_acceptance',
        'completion_request',
        'daily_log',
        'children_auto',
        'weekly_report'
      ));
  end if;

  if to_regclass('public.projects') is not null then
    for c in
      select conname
      from pg_constraint
      where conrelid = 'public.projects'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%progress_calculation_mode%'
    loop
      execute format('alter table public.projects drop constraint %I', c.conname);
    end loop;

    alter table public.projects
      add constraint projects_progress_calculation_mode_check
      check (progress_calculation_mode in (
        'gantt_weighted',
        'budget',
        'duration',
        'task_count',
        'contract_value',
        'manual'
      ));
  end if;
end;
$$;

notify pgrst, 'reload schema';

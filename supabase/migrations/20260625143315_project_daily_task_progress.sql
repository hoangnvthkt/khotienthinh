-- Daily WBS progress snapshots. Each task has one latest row per day.

create table if not exists public.project_daily_task_progress (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  task_id text not null references public.project_tasks(id) on delete cascade,
  progress_date date not null,
  week_start date not null,
  progress_percent numeric not null default 0
    check (progress_percent >= 0),
  quantity_done numeric not null default 0
    check (quantity_done >= 0),
  daily_quantity_done numeric not null default 0,
  note text,
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array'),
  source_daily_log_id text,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint project_daily_task_progress_scope_task_date_unique
    unique (scope_key, task_id, progress_date)
);

create index if not exists idx_project_daily_task_progress_scope_date
  on public.project_daily_task_progress(scope_key, progress_date desc);

create index if not exists idx_project_daily_task_progress_scope_week
  on public.project_daily_task_progress(scope_key, week_start desc, progress_date desc);

create index if not exists idx_project_daily_task_progress_project_date
  on public.project_daily_task_progress(project_id, progress_date desc)
  where project_id is not null;

create index if not exists idx_project_daily_task_progress_site_date
  on public.project_daily_task_progress(construction_site_id, progress_date desc)
  where construction_site_id is not null;

create index if not exists idx_project_daily_task_progress_task_date
  on public.project_daily_task_progress(task_id, progress_date desc);

drop trigger if exists trg_project_daily_task_progress_updated_at
  on public.project_daily_task_progress;
create trigger trg_project_daily_task_progress_updated_at
  before update on public.project_daily_task_progress
  for each row execute function public.set_updated_at();

alter table public.project_daily_task_progress enable row level security;

drop policy if exists project_daily_task_progress_all
  on public.project_daily_task_progress;
create policy project_daily_task_progress_all
  on public.project_daily_task_progress
  for all
  to authenticated
  using (scope_key is not null and task_id is not null)
  with check (scope_key is not null and task_id is not null);

revoke all on table public.project_daily_task_progress from anon;
revoke all on table public.project_daily_task_progress from public;
revoke all on table public.project_daily_task_progress from authenticated;
grant select, insert, update, delete on table public.project_daily_task_progress to authenticated;

notify pgrst, 'reload schema';

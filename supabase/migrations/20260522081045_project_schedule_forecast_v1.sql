-- Schedule forecast V1: delay events and approved current-plan revisions.
-- This migration is intentionally repo-only until the cloud migration history is repaired/approved.

create table if not exists public.project_delay_events (
  id text primary key default gen_random_uuid()::text,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  source_daily_log_id text references public.daily_logs(id) on delete set null,
  task_id text references public.project_tasks(id) on delete set null,
  task_name_snapshot text not null default '',
  category text not null default 'other'
    check (category in ('material', 'weather', 'drawing', 'labor', 'other')),
  reason text,
  impact_days integer not null default 0 check (impact_days >= 0),
  status text not null default 'reported'
    check (status in ('reported', 'accepted', 'applied', 'resolved', 'void')),
  responsibility text,
  occurred_on date not null default current_date,
  created_by text,
  accepted_by text,
  accepted_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_delay_events_project_status
  on public.project_delay_events(project_id, status, occurred_on desc);

create index if not exists idx_project_delay_events_site_status
  on public.project_delay_events(construction_site_id, status, occurred_on desc);

create index if not exists idx_project_delay_events_task
  on public.project_delay_events(task_id, occurred_on desc);

create index if not exists idx_project_delay_events_source_log
  on public.project_delay_events(source_daily_log_id);

create unique index if not exists idx_project_delay_events_log_task_unique
  on public.project_delay_events(source_daily_log_id, task_id)
  where source_daily_log_id is not null and task_id is not null;

drop trigger if exists trg_project_delay_events_updated_at
  on public.project_delay_events;
create trigger trg_project_delay_events_updated_at
  before update on public.project_delay_events
  for each row execute function public.set_updated_at();

alter table public.project_delay_events enable row level security;

drop policy if exists project_delay_events_project_access
  on public.project_delay_events;
create policy project_delay_events_project_access
  on public.project_delay_events
  for all
  to authenticated
  using (project_id is not null or construction_site_id is not null)
  with check (project_id is not null or construction_site_id is not null);

create table if not exists public.project_schedule_revisions (
  id text primary key default gen_random_uuid()::text,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  reason text,
  source_delay_event_ids text[] not null default '{}',
  applied_by text,
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_project_schedule_revisions_project_applied
  on public.project_schedule_revisions(project_id, applied_at desc);

create index if not exists idx_project_schedule_revisions_site_applied
  on public.project_schedule_revisions(construction_site_id, applied_at desc);

alter table public.project_schedule_revisions enable row level security;

drop policy if exists project_schedule_revisions_project_access
  on public.project_schedule_revisions;
create policy project_schedule_revisions_project_access
  on public.project_schedule_revisions
  for all
  to authenticated
  using (project_id is not null or construction_site_id is not null)
  with check (project_id is not null or construction_site_id is not null);

create table if not exists public.project_schedule_revision_tasks (
  id text primary key default gen_random_uuid()::text,
  revision_id text not null references public.project_schedule_revisions(id) on delete cascade,
  task_id text references public.project_tasks(id) on delete set null,
  task_name_snapshot text not null default '',
  before_start text not null,
  before_end text not null,
  before_duration integer not null default 0,
  after_start text not null,
  after_end text not null,
  after_duration integer not null default 0,
  delta_days integer not null default 0,
  was_critical boolean not null default false,
  float_before integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_schedule_revision_tasks_revision
  on public.project_schedule_revision_tasks(revision_id);

create index if not exists idx_project_schedule_revision_tasks_task
  on public.project_schedule_revision_tasks(task_id);

alter table public.project_schedule_revision_tasks enable row level security;

drop policy if exists project_schedule_revision_tasks_revision_access
  on public.project_schedule_revision_tasks;
create policy project_schedule_revision_tasks_revision_access
  on public.project_schedule_revision_tasks
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.project_schedule_revisions r
      where r.id = revision_id
        and (r.project_id is not null or r.construction_site_id is not null)
    )
  )
  with check (
    exists (
      select 1
      from public.project_schedule_revisions r
      where r.id = revision_id
        and (r.project_id is not null or r.construction_site_id is not null)
    )
  );

revoke all on table public.project_delay_events from anon;
revoke all on table public.project_delay_events from public;
revoke all on table public.project_delay_events from authenticated;
grant select, insert, update, delete on table public.project_delay_events to authenticated;

revoke all on table public.project_schedule_revisions from anon;
revoke all on table public.project_schedule_revisions from public;
revoke all on table public.project_schedule_revisions from authenticated;
grant select, insert, update, delete on table public.project_schedule_revisions to authenticated;

revoke all on table public.project_schedule_revision_tasks from anon;
revoke all on table public.project_schedule_revision_tasks from public;
revoke all on table public.project_schedule_revision_tasks from authenticated;
grant select, insert, update, delete on table public.project_schedule_revision_tasks to authenticated;

notify pgrst, 'reload schema';

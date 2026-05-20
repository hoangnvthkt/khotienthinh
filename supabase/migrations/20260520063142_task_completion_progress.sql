-- Task completion requests drive evidence-based project progress.
-- Applies directly to Supabase cloud; no local DB required.

alter table public.project_tasks
  add column if not exists provisional_quantity numeric not null default 0;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.project_tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%progress_mode%'
  loop
    execute format('alter table public.project_tasks drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.project_tasks
  add constraint project_tasks_progress_mode_check
  check (progress_mode in ('manual', 'derived_from_acceptance', 'completion_request', 'children_auto'));

create table if not exists public.project_task_completion_requests (
  id text primary key default gen_random_uuid()::text,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  task_id text not null references public.project_tasks(id) on delete cascade,
  status text not null default 'submitted'
    check (status in ('submitted', 'verified', 'approved', 'returned', 'cancelled')),
  proposed_quantity numeric not null default 0,
  accepted_quantity numeric not null default 0,
  note text,
  return_reason text,
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array'),
  submitted_by text,
  submitted_at timestamptz not null default now(),
  verified_by text,
  verified_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  returned_by text,
  returned_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_task_completion_requests_project
  on public.project_task_completion_requests(project_id, created_at desc);

create index if not exists idx_project_task_completion_requests_site
  on public.project_task_completion_requests(construction_site_id, created_at desc);

create index if not exists idx_project_task_completion_requests_task
  on public.project_task_completion_requests(task_id, created_at desc);

create index if not exists idx_project_task_completion_requests_status
  on public.project_task_completion_requests(status);

drop trigger if exists trg_project_task_completion_requests_updated_at
  on public.project_task_completion_requests;
create trigger trg_project_task_completion_requests_updated_at
  before update on public.project_task_completion_requests
  for each row execute function public.set_updated_at();

alter table public.project_task_completion_requests enable row level security;

drop policy if exists project_task_completion_requests_project_access
  on public.project_task_completion_requests;
create policy project_task_completion_requests_project_access
  on public.project_task_completion_requests
  for all
  to authenticated
  using (project_id is not null or construction_site_id is not null)
  with check (project_id is not null or construction_site_id is not null);

revoke all on table public.project_task_completion_requests from anon;
revoke all on table public.project_task_completion_requests from public;
revoke all on table public.project_task_completion_requests from authenticated;
grant select, insert, update, delete on table public.project_task_completion_requests to authenticated;

notify pgrst, 'reload schema';

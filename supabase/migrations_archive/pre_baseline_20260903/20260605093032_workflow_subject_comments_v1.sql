-- Conversation thread for project workflow subjects.
-- V1 is read/write for users who can view the workflow subject; no delete UI.

create table if not exists public.workflow_subject_comments (
  id uuid primary key default gen_random_uuid(),
  workflow_subject_id uuid not null references public.workflow_subjects(id) on delete cascade,
  workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  subject_type text not null,
  subject_id text not null,
  project_id text,
  construction_site_id text,
  author_user_id uuid not null references public.users(id) on delete cascade,
  body text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workflow_subject_comments
  add column if not exists workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  add column if not exists subject_type text,
  add column if not exists subject_id text,
  add column if not exists project_id text,
  add column if not exists construction_site_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_workflow_subject_comments_subject_created
  on public.workflow_subject_comments(workflow_subject_id, created_at desc);

create index if not exists idx_workflow_subject_comments_author_created
  on public.workflow_subject_comments(author_user_id, created_at desc);

create index if not exists idx_workflow_subject_comments_document
  on public.workflow_subject_comments(subject_type, subject_id, created_at desc);

alter table public.workflow_subject_comments enable row level security;

drop policy if exists workflow_subject_comments_select on public.workflow_subject_comments;
drop policy if exists workflow_subject_comments_insert on public.workflow_subject_comments;
drop policy if exists workflow_subject_comments_update on public.workflow_subject_comments;
drop policy if exists workflow_subject_comments_delete on public.workflow_subject_comments;

create policy workflow_subject_comments_select
  on public.workflow_subject_comments
  for select
  to authenticated
  using (app_private.project_workflow_actor_can_select(workflow_subject_id));

create policy workflow_subject_comments_insert
  on public.workflow_subject_comments
  for insert
  to authenticated
  with check (
    author_user_id = public.current_app_user_id()
    and app_private.project_workflow_actor_can_select(workflow_subject_id)
  );

create policy workflow_subject_comments_update
  on public.workflow_subject_comments
  for update
  to authenticated
  using (
    author_user_id = public.current_app_user_id()
    and app_private.project_workflow_actor_can_select(workflow_subject_id)
  )
  with check (
    author_user_id = public.current_app_user_id()
    and app_private.project_workflow_actor_can_select(workflow_subject_id)
  );

revoke all on table public.workflow_subject_comments from anon;
revoke all on table public.workflow_subject_comments from public;
revoke all on table public.workflow_subject_comments from authenticated;
grant select, insert, update on table public.workflow_subject_comments to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'workflow_subject_comments'
     ) then
    alter publication supabase_realtime add table public.workflow_subject_comments;
  end if;
exception
  when undefined_object then
    null;
end $$;

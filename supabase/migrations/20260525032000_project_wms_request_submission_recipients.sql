alter table public.requests
  add column if not exists submitted_to_user_id text,
  add column if not exists submitted_to_name text,
  add column if not exists submitted_to_permission text,
  add column if not exists submission_note text;

create index if not exists idx_requests_submitted_to
  on public.requests (submitted_to_user_id, status, created_date desc);

notify pgrst, 'reload schema';

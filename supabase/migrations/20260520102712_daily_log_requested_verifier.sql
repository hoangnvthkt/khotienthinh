-- Store the specific project-org verifier requested for a daily log submission.

alter table if exists public.daily_logs
  add column if not exists requested_verifier_id text,
  add column if not exists requested_verifier_name text;

create index if not exists idx_daily_logs_requested_verifier
  on public.daily_logs(requested_verifier_id);

notify pgrst, 'reload schema';

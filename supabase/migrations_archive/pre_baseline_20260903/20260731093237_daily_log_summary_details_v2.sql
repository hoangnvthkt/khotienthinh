alter table if exists public.daily_log_labor
  add column if not exists unit text;

alter table if exists public.daily_log_machines
  add column if not exists hours numeric not null default 0,
  add column if not exists unit text,
  add column if not exists partner_id text,
  add column if not exists partner_name text;

notify pgrst, 'reload schema';

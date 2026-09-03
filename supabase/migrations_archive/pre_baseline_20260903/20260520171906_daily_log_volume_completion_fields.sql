-- Add completion-style evidence storage for FastCons daily-log volumes.
-- Cloud-only migration: apply with `npx supabase db query --linked -f ...`.

alter table if exists public.daily_log_volumes
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Project master mode allows project-scoped daily logs without a construction site.
-- Older construction tables had construction_site_id NOT NULL, which can silently block
-- detail rows even when project_id is present.
alter table if exists public.daily_log_volumes
  alter column construction_site_id drop not null;

notify pgrst, 'reload schema';

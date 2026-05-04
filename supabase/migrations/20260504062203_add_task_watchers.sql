ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS watchers text[] NOT NULL DEFAULT '{}'::text[];

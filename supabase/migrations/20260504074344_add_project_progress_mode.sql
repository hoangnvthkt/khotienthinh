ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS progress_calculation_mode text NOT NULL DEFAULT 'gantt_weighted',
  ADD COLUMN IF NOT EXISTS manual_progress_percent numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_progress_calculation_mode_check'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_progress_calculation_mode_check
      CHECK (progress_calculation_mode IN ('gantt_weighted', 'budget', 'duration', 'task_count', 'manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_manual_progress_percent_check'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_manual_progress_percent_check
      CHECK (manual_progress_percent >= 0 AND manual_progress_percent <= 100);
  END IF;
END $$;

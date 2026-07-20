-- Add actual start/end date columns to project_tasks for tracking real vs planned dates
ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS actual_start_date date,
  ADD COLUMN IF NOT EXISTS actual_end_date date,
  ADD COLUMN IF NOT EXISTS wbs_code text,
  ADD COLUMN IF NOT EXISTS fallback_unit text;

CREATE INDEX IF NOT EXISTS idx_project_tasks_wbs_code
  ON public.project_tasks(wbs_code);

-- Backfill only values that look like WBS codes. Legacy code can contain BOQ codes.
UPDATE public.project_tasks
SET wbs_code = code
WHERE wbs_code IS NULL
  AND code ~ '^[0-9]+(\.[0-9]+)*$';

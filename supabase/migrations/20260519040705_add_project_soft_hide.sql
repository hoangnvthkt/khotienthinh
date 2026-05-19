ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by text,
  ADD COLUMN IF NOT EXISTS hidden_reason text;

CREATE INDEX IF NOT EXISTS idx_projects_is_hidden
  ON public.projects(is_hidden);

CREATE INDEX IF NOT EXISTS idx_projects_hidden_at
  ON public.projects(hidden_at)
  WHERE is_hidden = true;

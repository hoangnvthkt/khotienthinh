-- Project master table. A Project is the business object used by DA.
-- HRM construction sites are optional physical/site links, not the project list itself.

CREATE TABLE IF NOT EXISTS public.projects (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  client_name text,
  project_type text NOT NULL DEFAULT 'construction',
  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'active', 'paused', 'completed', 'cancelled')),
  construction_site_id uuid REFERENCES public.hrm_construction_sites(id) ON DELETE SET NULL,
  manager_id text,
  start_date date,
  end_date date,
  created_by text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'backfill')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_construction_site_id
  ON public.projects(construction_site_id);
CREATE INDEX IF NOT EXISTS idx_projects_status
  ON public.projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_manager_id
  ON public.projects(manager_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Expose the table to Supabase Data API roles. RLS stays enabled below.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO anon, authenticated;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select" ON public.projects
  FOR SELECT TO public
  USING (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "projects_insert" ON public.projects;
CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT TO public
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "projects_update" ON public.projects;
CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE TO public
  USING (auth.role() IN ('anon', 'authenticated'))
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete" ON public.projects
  FOR DELETE TO public
  USING (auth.role() IN ('anon', 'authenticated'));

-- Backfill one project per existing HRM construction site. Use the site UUID string
-- as the project ID so legacy site-based records can be linked without ambiguity.
INSERT INTO public.projects (
  id,
  code,
  name,
  description,
  status,
  construction_site_id,
  manager_id,
  source,
  created_at,
  updated_at
)
SELECT
  s.id::text,
  'PRJ-' || upper(substr(replace(s.id::text, '-', ''), 1, 8)),
  s.name,
  COALESCE(NULLIF(to_jsonb(s)->>'address', ''), NULLIF(to_jsonb(s)->>'description', '')),
  'active',
  s.id,
  NULLIF(to_jsonb(s)->>'managerId', ''),
  'backfill',
  now(),
  now()
FROM public.hrm_construction_sites s
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  construction_site_id = EXCLUDED.construction_site_id,
  manager_id = COALESCE(public.projects.manager_id, EXCLUDED.manager_id),
  updated_at = now()
WHERE public.projects.source = 'backfill';

-- Project-level staff must work even before a project is linked to a HRM site.
DO $$
BEGIN
  IF to_regclass('public.project_staff') IS NOT NULL THEN
    ALTER TABLE public.project_staff
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    ALTER TABLE public.project_staff
      ALTER COLUMN construction_site_id DROP NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_project_staff_project_id
      ON public.project_staff(project_id);
    UPDATE public.project_staff
    SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;
END;
$$;

-- Legacy site-scoped tables with construction_site_id stored as text.
DO $$
BEGIN
  IF to_regclass('public.project_tasks') IS NOT NULL THEN
    ALTER TABLE public.project_tasks
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON public.project_tasks(project_id);
    UPDATE public.project_tasks SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.daily_logs') IS NOT NULL THEN
    ALTER TABLE public.daily_logs
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_daily_logs_project_id ON public.daily_logs(project_id);
    UPDATE public.daily_logs SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.material_budget_items') IS NOT NULL THEN
    ALTER TABLE public.material_budget_items
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_material_budget_items_project_id ON public.material_budget_items(project_id);
    UPDATE public.material_budget_items SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.project_material_requests') IS NOT NULL THEN
    ALTER TABLE public.project_material_requests
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_project_material_requests_project_id ON public.project_material_requests(project_id);
    UPDATE public.project_material_requests SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.project_vendors') IS NOT NULL THEN
    ALTER TABLE public.project_vendors
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_project_vendors_project_id ON public.project_vendors(project_id);
    UPDATE public.project_vendors SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.project_documents') IS NOT NULL THEN
    ALTER TABLE public.project_documents
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_project_documents_project_id ON public.project_documents(project_id);
    UPDATE public.project_documents SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.project_contracts') IS NOT NULL THEN
    ALTER TABLE public.project_contracts
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_project_contracts_project_id ON public.project_contracts(project_id);
    UPDATE public.project_contracts SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.project_baselines') IS NOT NULL THEN
    ALTER TABLE public.project_baselines
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_project_baselines_project_id ON public.project_baselines(project_id);
    UPDATE public.project_baselines SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;
END;
$$;

-- Existing financial tables created by the app use camelCase DB columns.
DO $$
BEGIN
  IF to_regclass('public.project_finances') IS NOT NULL THEN
    ALTER TABLE public.project_finances
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_project_finances_project_id ON public.project_finances(project_id);
    UPDATE public.project_finances SET project_id = "constructionSiteId"
    WHERE project_id IS NULL AND "constructionSiteId" IS NOT NULL;
  END IF;

  IF to_regclass('public.project_transactions') IS NOT NULL THEN
    ALTER TABLE public.project_transactions
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_project_transactions_project_id ON public.project_transactions(project_id);
    UPDATE public.project_transactions SET project_id = "constructionSiteId"
    WHERE project_id IS NULL AND "constructionSiteId" IS NOT NULL;
  END IF;
END;
$$;

-- Construction logic tables with uuid construction_site_id.
DO $$
BEGIN
  IF to_regclass('public.daily_log_volumes') IS NOT NULL THEN
    ALTER TABLE public.daily_log_volumes
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_daily_log_volumes_project_id ON public.daily_log_volumes(project_id);
    UPDATE public.daily_log_volumes SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.daily_log_materials') IS NOT NULL THEN
    ALTER TABLE public.daily_log_materials
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_daily_log_materials_project_id ON public.daily_log_materials(project_id);
    UPDATE public.daily_log_materials SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.daily_log_labor') IS NOT NULL THEN
    ALTER TABLE public.daily_log_labor
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_daily_log_labor_project_id ON public.daily_log_labor(project_id);
    UPDATE public.daily_log_labor SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.daily_log_machines') IS NOT NULL THEN
    ALTER TABLE public.daily_log_machines
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_daily_log_machines_project_id ON public.daily_log_machines(project_id);
    UPDATE public.daily_log_machines SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.project_cost_items') IS NOT NULL THEN
    ALTER TABLE public.project_cost_items
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_project_cost_items_project_id ON public.project_cost_items(project_id);
    UPDATE public.project_cost_items SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.project_cost_actuals') IS NOT NULL THEN
    ALTER TABLE public.project_cost_actuals
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_project_cost_actuals_project_id ON public.project_cost_actuals(project_id);
    UPDATE public.project_cost_actuals SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.contract_items') IS NOT NULL THEN
    ALTER TABLE public.contract_items
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_contract_items_project_id ON public.contract_items(project_id);
    UPDATE public.contract_items SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.task_contract_items') IS NOT NULL THEN
    ALTER TABLE public.task_contract_items
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_task_contract_items_project_id ON public.task_contract_items(project_id);
  END IF;

  IF to_regclass('public.quantity_acceptances') IS NOT NULL THEN
    ALTER TABLE public.quantity_acceptances
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_quantity_acceptances_project_id ON public.quantity_acceptances(project_id);
    UPDATE public.quantity_acceptances SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.payment_certificates') IS NOT NULL THEN
    ALTER TABLE public.payment_certificates
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_payment_certificates_project_id ON public.payment_certificates(project_id);
    UPDATE public.payment_certificates SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.advance_payments') IS NOT NULL THEN
    ALTER TABLE public.advance_payments
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_advance_payments_project_id ON public.advance_payments(project_id);
    UPDATE public.advance_payments SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.contract_variations') IS NOT NULL THEN
    ALTER TABLE public.contract_variations
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_contract_variations_project_id ON public.contract_variations(project_id);
    UPDATE public.contract_variations SET project_id = construction_site_id::text
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;
END;
$$;

-- Contract wrappers already have project_id; backfill only when missing.
DO $$
BEGIN
  IF to_regclass('public.customer_contracts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_customer_contracts_project_id ON public.customer_contracts(project_id);
    UPDATE public.customer_contracts SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.subcontractor_contracts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_project_id ON public.subcontractor_contracts(project_id);
    UPDATE public.subcontractor_contracts SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;
END;
$$;

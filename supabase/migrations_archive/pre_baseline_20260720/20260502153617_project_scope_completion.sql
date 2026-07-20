-- Complete project-level scoping for DA tables.
-- Project records can exist before an HRM construction site is linked, so
-- records that already carry project_id must not require construction_site_id.

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'project_tasks',
    'daily_logs',
    'material_budget_items',
    'project_material_requests',
    'project_vendors',
    'purchase_orders',
    'project_documents',
    'project_baselines',
    'contract_items',
    'task_contract_items',
    'acceptance_records',
    'payment_schedules',
    'daily_log_volumes',
    'daily_log_materials',
    'daily_log_labor',
    'daily_log_machines'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL', table_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(project_id)', 'idx_' || table_name || '_project_id', table_name);
      EXECUTE format('UPDATE public.%I SET project_id = construction_site_id::text WHERE project_id IS NULL AND construction_site_id IS NOT NULL', table_name);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN construction_site_id DROP NOT NULL', table_name);
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.task_contract_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS "task_contract_items_site_access" ON public.task_contract_items;
    DROP POLICY IF EXISTS "task_contract_items_project_access" ON public.task_contract_items;
    CREATE POLICY "task_contract_items_project_access" ON public.task_contract_items
      FOR ALL TO authenticated
      USING (project_id IS NOT NULL OR construction_site_id IS NOT NULL)
      WITH CHECK (project_id IS NOT NULL OR construction_site_id IS NOT NULL);
  END IF;

  IF to_regclass('public.daily_log_volumes') IS NOT NULL THEN
    DROP POLICY IF EXISTS "daily_log_volumes_site_access" ON public.daily_log_volumes;
    DROP POLICY IF EXISTS "daily_log_volumes_project_access" ON public.daily_log_volumes;
    CREATE POLICY "daily_log_volumes_project_access" ON public.daily_log_volumes
      FOR ALL TO authenticated
      USING (project_id IS NOT NULL OR construction_site_id IS NOT NULL)
      WITH CHECK (project_id IS NOT NULL OR construction_site_id IS NOT NULL);
  END IF;

  IF to_regclass('public.daily_log_materials') IS NOT NULL THEN
    DROP POLICY IF EXISTS "daily_log_materials_site_access" ON public.daily_log_materials;
    DROP POLICY IF EXISTS "daily_log_materials_project_access" ON public.daily_log_materials;
    CREATE POLICY "daily_log_materials_project_access" ON public.daily_log_materials
      FOR ALL TO authenticated
      USING (project_id IS NOT NULL OR construction_site_id IS NOT NULL)
      WITH CHECK (project_id IS NOT NULL OR construction_site_id IS NOT NULL);
  END IF;

  IF to_regclass('public.daily_log_labor') IS NOT NULL THEN
    DROP POLICY IF EXISTS "daily_log_labor_site_access" ON public.daily_log_labor;
    DROP POLICY IF EXISTS "daily_log_labor_project_access" ON public.daily_log_labor;
    CREATE POLICY "daily_log_labor_project_access" ON public.daily_log_labor
      FOR ALL TO authenticated
      USING (project_id IS NOT NULL OR construction_site_id IS NOT NULL)
      WITH CHECK (project_id IS NOT NULL OR construction_site_id IS NOT NULL);
  END IF;

  IF to_regclass('public.daily_log_machines') IS NOT NULL THEN
    DROP POLICY IF EXISTS "daily_log_machines_site_access" ON public.daily_log_machines;
    DROP POLICY IF EXISTS "daily_log_machines_project_access" ON public.daily_log_machines;
    CREATE POLICY "daily_log_machines_project_access" ON public.daily_log_machines
      FOR ALL TO authenticated
      USING (project_id IS NOT NULL OR construction_site_id IS NOT NULL)
      WITH CHECK (project_id IS NOT NULL OR construction_site_id IS NOT NULL);
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.customer_contracts') IS NOT NULL THEN
    ALTER TABLE public.customer_contracts
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS construction_site_id text;
    CREATE INDEX IF NOT EXISTS idx_customer_contracts_project_id ON public.customer_contracts(project_id);
    CREATE INDEX IF NOT EXISTS idx_customer_contracts_construction_site_id ON public.customer_contracts(construction_site_id);
    UPDATE public.customer_contracts
    SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  IF to_regclass('public.subcontractor_contracts') IS NOT NULL THEN
    ALTER TABLE public.subcontractor_contracts
      ADD COLUMN IF NOT EXISTS project_id text REFERENCES public.projects(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS construction_site_id text;
    CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_project_id ON public.subcontractor_contracts(project_id);
    CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_construction_site_id ON public.subcontractor_contracts(construction_site_id);
    UPDATE public.subcontractor_contracts
    SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;
END;
$$;

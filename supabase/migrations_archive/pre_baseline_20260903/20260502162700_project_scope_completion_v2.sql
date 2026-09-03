-- ══════════════════════════════════════════════════════════════
-- Migration: Complete project-level scoping v2
-- Fix remaining NOT NULL constraints and RLS for project-only records
-- Tables affected:
--   advance_payments, contract_variations, payment_certificates,
--   project_contracts, project_cost_actuals, project_cost_items,
--   quantity_acceptances
-- ══════════════════════════════════════════════════════════════

-- 1. DROP NOT NULL on construction_site_id for tables still requiring it
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'advance_payments',
    'contract_variations',
    'payment_certificates',
    'project_contracts',
    'project_cost_actuals',
    'project_cost_items',
    'quantity_acceptances'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN construction_site_id DROP NOT NULL',
        tbl
      );
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS project_id text',
        tbl
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I(project_id)',
        'idx_' || tbl || '_project_id', tbl
      );
      EXECUTE format(
        'UPDATE public.%I SET project_id = construction_site_id::text WHERE project_id IS NULL AND construction_site_id IS NOT NULL',
        tbl
      );
    END IF;
  END LOOP;
END;
$$;

-- 2. Fix RLS policies that hard-require construction_site_id

-- contract_variations
DO $$
BEGIN
  IF to_regclass('public.contract_variations') IS NOT NULL THEN
    DROP POLICY IF EXISTS "contract_variations_site_access" ON public.contract_variations;
    DROP POLICY IF EXISTS "contract_variations_project_access" ON public.contract_variations;
    CREATE POLICY "contract_variations_project_access" ON public.contract_variations
      FOR ALL TO authenticated
      USING (project_id IS NOT NULL OR construction_site_id IS NOT NULL)
      WITH CHECK (project_id IS NOT NULL OR construction_site_id IS NOT NULL);
  END IF;
END;
$$;

-- project_cost_actuals
DO $$
BEGIN
  IF to_regclass('public.project_cost_actuals') IS NOT NULL THEN
    DROP POLICY IF EXISTS "project_cost_actuals_site_access" ON public.project_cost_actuals;
    DROP POLICY IF EXISTS "project_cost_actuals_project_access" ON public.project_cost_actuals;
    CREATE POLICY "project_cost_actuals_project_access" ON public.project_cost_actuals
      FOR ALL TO authenticated
      USING (project_id IS NOT NULL OR construction_site_id IS NOT NULL)
      WITH CHECK (project_id IS NOT NULL OR construction_site_id IS NOT NULL);
  END IF;
END;
$$;

-- quantity_acceptances
DO $$
BEGIN
  IF to_regclass('public.quantity_acceptances') IS NOT NULL THEN
    DROP POLICY IF EXISTS "quantity_acceptances_site_access" ON public.quantity_acceptances;
    DROP POLICY IF EXISTS "quantity_acceptances_project_access" ON public.quantity_acceptances;
    CREATE POLICY "quantity_acceptances_project_access" ON public.quantity_acceptances
      FOR ALL TO authenticated
      USING (project_id IS NOT NULL OR construction_site_id IS NOT NULL)
      WITH CHECK (project_id IS NOT NULL OR construction_site_id IS NOT NULL);
  END IF;
END;
$$;

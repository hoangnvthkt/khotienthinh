-- Fix child-table RLS policies that join to parent and check
-- construction_site_id IS NOT NULL on the parent — must also allow project_id

-- quantity_acceptance_items → joins quantity_acceptances
DO $$
BEGIN
  IF to_regclass('public.quantity_acceptance_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS "quantity_acceptance_items_parent_access" ON public.quantity_acceptance_items;
    DROP POLICY IF EXISTS "quantity_acceptance_items_project_access" ON public.quantity_acceptance_items;
    CREATE POLICY "quantity_acceptance_items_project_access" ON public.quantity_acceptance_items
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM quantity_acceptances qa
        WHERE qa.id = quantity_acceptance_items.acceptance_id
          AND (qa.project_id IS NOT NULL OR qa.construction_site_id IS NOT NULL)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM quantity_acceptances qa
        WHERE qa.id = quantity_acceptance_items.acceptance_id
          AND (qa.project_id IS NOT NULL OR qa.construction_site_id IS NOT NULL)
      ));
  END IF;
END;
$$;

-- payment_certificate_items → joins payment_certificates
DO $$
BEGIN
  IF to_regclass('public.payment_certificate_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS "payment_certificate_items_parent_access" ON public.payment_certificate_items;
    DROP POLICY IF EXISTS "payment_certificate_items_project_access" ON public.payment_certificate_items;
    CREATE POLICY "payment_certificate_items_project_access" ON public.payment_certificate_items
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM payment_certificates pc
        WHERE pc.id = payment_certificate_items.payment_certificate_id
          AND (pc.project_id IS NOT NULL OR pc.construction_site_id IS NOT NULL)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM payment_certificates pc
        WHERE pc.id = payment_certificate_items.payment_certificate_id
          AND (pc.project_id IS NOT NULL OR pc.construction_site_id IS NOT NULL)
      ));
  END IF;
END;
$$;

-- payment_certificate_advance_recoveries → joins payment_certificates
DO $$
BEGIN
  IF to_regclass('public.payment_certificate_advance_recoveries') IS NOT NULL THEN
    DROP POLICY IF EXISTS "payment_cert_adv_parent_access" ON public.payment_certificate_advance_recoveries;
    DROP POLICY IF EXISTS "payment_cert_adv_project_access" ON public.payment_certificate_advance_recoveries;
    CREATE POLICY "payment_cert_adv_project_access" ON public.payment_certificate_advance_recoveries
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM payment_certificates pc
        WHERE pc.id = payment_certificate_advance_recoveries.payment_certificate_id
          AND (pc.project_id IS NOT NULL OR pc.construction_site_id IS NOT NULL)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM payment_certificates pc
        WHERE pc.id = payment_certificate_advance_recoveries.payment_certificate_id
          AND (pc.project_id IS NOT NULL OR pc.construction_site_id IS NOT NULL)
      ));
  END IF;
END;
$$;

-- contract_variation_items → joins contract_variations
DO $$
BEGIN
  IF to_regclass('public.contract_variation_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS "contract_variation_items_parent_access" ON public.contract_variation_items;
    DROP POLICY IF EXISTS "contract_variation_items_project_access" ON public.contract_variation_items;
    CREATE POLICY "contract_variation_items_project_access" ON public.contract_variation_items
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM contract_variations cv
        WHERE cv.id = contract_variation_items.variation_id
          AND (cv.project_id IS NOT NULL OR cv.construction_site_id IS NOT NULL)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM contract_variations cv
        WHERE cv.id = contract_variation_items.variation_id
          AND (cv.project_id IS NOT NULL OR cv.construction_site_id IS NOT NULL)
      ));
  END IF;
END;
$$;

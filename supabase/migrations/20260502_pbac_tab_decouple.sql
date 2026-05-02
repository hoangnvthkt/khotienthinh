-- ══════════════════════════════════════════════════════════════
-- Migration: Thêm project_id cho bảng còn thiếu
-- Mục đích: Cho phép tab hoạt động độc lập khỏi constructionSiteId
-- ══════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- acceptance_records
  IF to_regclass('public.acceptance_records') IS NOT NULL THEN
    ALTER TABLE public.acceptance_records
      ADD COLUMN IF NOT EXISTS project_id text;
    CREATE INDEX IF NOT EXISTS idx_acceptance_records_project_id
      ON public.acceptance_records(project_id);
    UPDATE public.acceptance_records SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;

  -- purchase_orders
  IF to_regclass('public.purchase_orders') IS NOT NULL THEN
    ALTER TABLE public.purchase_orders
      ADD COLUMN IF NOT EXISTS project_id text;
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_project_id
      ON public.purchase_orders(project_id);
    UPDATE public.purchase_orders SET project_id = construction_site_id
    WHERE project_id IS NULL AND construction_site_id IS NOT NULL;
  END IF;
END $$;

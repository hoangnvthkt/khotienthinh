DO $$
BEGIN
  IF to_regclass('public.project_finances') IS NOT NULL THEN
    ALTER TABLE public.project_finances
      ADD COLUMN IF NOT EXISTS construction_site_id text,
      ADD COLUMN IF NOT EXISTS project_id text;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'project_finances'
        AND column_name = 'constructionSiteId'
    ) THEN
      EXECUTE '
        UPDATE public.project_finances
        SET construction_site_id = "constructionSiteId"::text
        WHERE construction_site_id IS NULL
          AND "constructionSiteId" IS NOT NULL
      ';
    END IF;

    UPDATE public.project_finances pf
    SET project_id = p.id
    FROM public.projects p
    WHERE pf.construction_site_id IS NOT NULL
      AND p.construction_site_id::text = pf.construction_site_id
      AND (pf.project_id IS NULL OR pf.project_id = pf.construction_site_id);

    CREATE INDEX IF NOT EXISTS idx_project_finances_construction_site_id
      ON public.project_finances(construction_site_id);
    CREATE INDEX IF NOT EXISTS idx_project_finances_project_id
      ON public.project_finances(project_id);
  END IF;

  IF to_regclass('public.project_transactions') IS NOT NULL THEN
    ALTER TABLE public.project_transactions
      ADD COLUMN IF NOT EXISTS construction_site_id text,
      ADD COLUMN IF NOT EXISTS project_finance_id text,
      ADD COLUMN IF NOT EXISTS project_id text;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'project_transactions'
        AND column_name = 'constructionSiteId'
    ) THEN
      EXECUTE '
        UPDATE public.project_transactions
        SET construction_site_id = "constructionSiteId"::text
        WHERE construction_site_id IS NULL
          AND "constructionSiteId" IS NOT NULL
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'project_transactions'
        AND column_name = 'projectFinanceId'
    ) THEN
      EXECUTE '
        UPDATE public.project_transactions
        SET project_finance_id = "projectFinanceId"::text
        WHERE project_finance_id IS NULL
          AND "projectFinanceId" IS NOT NULL
      ';
    END IF;

    UPDATE public.project_transactions tx
    SET construction_site_id = pf.construction_site_id
    FROM public.project_finances pf
    WHERE tx.construction_site_id IS NULL
      AND tx.project_finance_id IS NOT NULL
      AND pf.id::text = tx.project_finance_id
      AND pf.construction_site_id IS NOT NULL;

    UPDATE public.project_transactions tx
    SET project_id = pf.project_id
    FROM public.project_finances pf
    WHERE tx.project_id IS NULL
      AND tx.project_finance_id IS NOT NULL
      AND pf.id::text = tx.project_finance_id
      AND pf.project_id IS NOT NULL;

    UPDATE public.project_transactions tx
    SET project_id = p.id
    FROM public.projects p
    WHERE tx.construction_site_id IS NOT NULL
      AND p.construction_site_id::text = tx.construction_site_id
      AND (tx.project_id IS NULL OR tx.project_id = tx.construction_site_id);

    CREATE INDEX IF NOT EXISTS idx_project_transactions_construction_site_id
      ON public.project_transactions(construction_site_id);
    CREATE INDEX IF NOT EXISTS idx_project_transactions_project_finance_id
      ON public.project_transactions(project_finance_id);
    CREATE INDEX IF NOT EXISTS idx_project_transactions_project_id
      ON public.project_transactions(project_id);
  END IF;
END $$;

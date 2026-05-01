-- ============================================================
-- Project Construction Logic v2
-- Purpose: separate WBS, BOQ, daily log, acceptance, payment,
--          variations, and financial actuals into auditable flows.
-- Date: 2026-04-29
-- ============================================================

-- ---------- Project tasks: keep WBS separate from BOQ ----------
ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS progress_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (progress_mode IN ('manual', 'derived_from_acceptance')),
  ADD COLUMN IF NOT EXISTS baseline_version TEXT,
  ADD COLUMN IF NOT EXISTS baseline_change_reason TEXT;

CREATE TABLE IF NOT EXISTS task_contract_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  contract_item_id UUID NOT NULL REFERENCES contract_items(id) ON DELETE CASCADE,
  construction_site_id TEXT NOT NULL,
  weight_percent NUMERIC,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, contract_item_id)
);

CREATE INDEX IF NOT EXISTS idx_task_contract_items_task ON task_contract_items(task_id);
CREATE INDEX IF NOT EXISTS idx_task_contract_items_contract_item ON task_contract_items(contract_item_id);
CREATE INDEX IF NOT EXISTS idx_task_contract_items_site ON task_contract_items(construction_site_id);

-- ---------- Contract items: original vs revised values ----------
ALTER TABLE contract_items
  ADD COLUMN IF NOT EXISTS original_quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS original_unit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS original_total_price NUMERIC,
  ADD COLUMN IF NOT EXISTS variation_quantity NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variation_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revised_quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS revised_total_price NUMERIC,
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

UPDATE contract_items
SET
  original_quantity = COALESCE(original_quantity, quantity),
  original_unit_price = COALESCE(original_unit_price, unit_price),
  original_total_price = COALESCE(original_total_price, total_price),
  revised_quantity = COALESCE(revised_quantity, quantity + COALESCE(variation_quantity, 0)),
  revised_total_price = COALESCE(revised_total_price, total_price + COALESCE(variation_amount, 0));

-- ---------- Daily logs: status and normalized details ----------
ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS submitted_by TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

UPDATE daily_logs
SET status = CASE WHEN COALESCE(verified, false) THEN 'verified' ELSE status END;

CREATE TABLE IF NOT EXISTS daily_log_volumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id TEXT NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  construction_site_id TEXT NOT NULL,
  contract_item_id UUID REFERENCES contract_items(id) ON DELETE SET NULL,
  contract_item_name TEXT,
  task_id TEXT REFERENCES project_tasks(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  note TEXT,
  photo_url TEXT,
  source_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_log_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id TEXT NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  construction_site_id TEXT NOT NULL,
  material_id TEXT,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  quantity NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  source_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_log_labor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id TEXT NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  construction_site_id TEXT NOT NULL,
  labor_type TEXT NOT NULL,
  count NUMERIC NOT NULL DEFAULT 0,
  hours NUMERIC,
  unit_cost NUMERIC,
  total_cost NUMERIC,
  note TEXT,
  source_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_log_machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id TEXT NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  construction_site_id TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  machine_type TEXT NOT NULL,
  shifts NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC,
  total_cost NUMERIC,
  note TEXT,
  source_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_log_volumes_log ON daily_log_volumes(daily_log_id);
CREATE INDEX IF NOT EXISTS idx_daily_log_volumes_contract_item ON daily_log_volumes(contract_item_id);
CREATE INDEX IF NOT EXISTS idx_daily_log_materials_log ON daily_log_materials(daily_log_id);
CREATE INDEX IF NOT EXISTS idx_daily_log_labor_log ON daily_log_labor(daily_log_id);
CREATE INDEX IF NOT EXISTS idx_daily_log_machines_log ON daily_log_machines(daily_log_id);

INSERT INTO daily_log_volumes (
  daily_log_id, construction_site_id, contract_item_id, contract_item_name,
  task_id, quantity, unit, note, photo_url, source_index
)
SELECT
  dl.id,
  dl.construction_site_id,
  NULLIF(v.value->>'contractItemId', '')::uuid,
  v.value->>'contractItemName',
  NULLIF(v.value->>'taskId', ''),
  COALESCE(NULLIF(v.value->>'quantity', '')::numeric, 0),
  COALESCE(v.value->>'unit', ''),
  v.value->>'note',
  v.value->>'photoUrl',
  v.ordinality::integer
FROM daily_logs dl
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(dl.volumes, '[]'::jsonb)) WITH ORDINALITY AS v(value, ordinality)
WHERE NOT EXISTS (SELECT 1 FROM daily_log_volumes x WHERE x.daily_log_id = dl.id);

INSERT INTO daily_log_materials (
  daily_log_id, construction_site_id, material_id, item_name, unit, quantity, note, source_index
)
SELECT
  dl.id,
  dl.construction_site_id,
  NULLIF(m.value->>'materialId', ''),
  COALESCE(m.value->>'itemName', ''),
  COALESCE(m.value->>'unit', ''),
  COALESCE(NULLIF(m.value->>'quantity', '')::numeric, 0),
  m.value->>'note',
  m.ordinality::integer
FROM daily_logs dl
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(dl.materials, '[]'::jsonb)) WITH ORDINALITY AS m(value, ordinality)
WHERE NOT EXISTS (SELECT 1 FROM daily_log_materials x WHERE x.daily_log_id = dl.id);

INSERT INTO daily_log_labor (
  daily_log_id, construction_site_id, labor_type, count, hours, unit_cost, total_cost, note, source_index
)
SELECT
  dl.id,
  dl.construction_site_id,
  COALESCE(l.value->>'laborType', 'khac'),
  COALESCE(NULLIF(l.value->>'count', '')::numeric, 0),
  NULLIF(l.value->>'hours', '')::numeric,
  NULLIF(l.value->>'unitCost', '')::numeric,
  NULLIF(l.value->>'totalCost', '')::numeric,
  l.value->>'note',
  l.ordinality::integer
FROM daily_logs dl
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(dl.labor_details, '[]'::jsonb)) WITH ORDINALITY AS l(value, ordinality)
WHERE NOT EXISTS (SELECT 1 FROM daily_log_labor x WHERE x.daily_log_id = dl.id);

INSERT INTO daily_log_machines (
  daily_log_id, construction_site_id, machine_name, machine_type, shifts, unit_cost, total_cost, note, source_index
)
SELECT
  dl.id,
  dl.construction_site_id,
  COALESCE(mc.value->>'machineName', ''),
  COALESCE(mc.value->>'machineType', 'other'),
  COALESCE(NULLIF(mc.value->>'shifts', '')::numeric, 0),
  NULLIF(mc.value->>'unitCost', '')::numeric,
  NULLIF(mc.value->>'totalCost', '')::numeric,
  mc.value->>'note',
  mc.ordinality::integer
FROM daily_logs dl
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(dl.machines, '[]'::jsonb)) WITH ORDINALITY AS mc(value, ordinality)
WHERE NOT EXISTS (SELECT 1 FROM daily_log_machines x WHERE x.daily_log_id = dl.id);

-- ---------- Quantity acceptance ----------
CREATE TABLE IF NOT EXISTS quantity_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('customer', 'subcontractor')),
  construction_site_id UUID NOT NULL,
  period_number INTEGER NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'returned', 'approved', 'cancelled')),
  total_accepted_amount NUMERIC NOT NULL DEFAULT 0,
  submitted_by TEXT,
  submitted_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  returned_by TEXT,
  returned_at TIMESTAMPTZ,
  return_reason TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quantity_acceptance_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acceptance_id UUID NOT NULL REFERENCES quantity_acceptances(id) ON DELETE CASCADE,
  contract_item_id UUID NOT NULL REFERENCES contract_items(id),
  contract_item_code TEXT,
  contract_item_name TEXT,
  unit TEXT,
  previous_accepted_quantity NUMERIC NOT NULL DEFAULT 0,
  proposed_quantity NUMERIC NOT NULL DEFAULT 0,
  accepted_quantity NUMERIC NOT NULL DEFAULT 0,
  cumulative_accepted_quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  accepted_amount NUMERIC NOT NULL DEFAULT 0,
  source_daily_log_volume_ids UUID[] DEFAULT '{}',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quantity_acceptances_contract ON quantity_acceptances(contract_id, contract_type);
CREATE INDEX IF NOT EXISTS idx_quantity_acceptances_site ON quantity_acceptances(construction_site_id);
CREATE INDEX IF NOT EXISTS idx_quantity_acceptance_items_acceptance ON quantity_acceptance_items(acceptance_id);
CREATE INDEX IF NOT EXISTS idx_quantity_acceptance_items_contract_item ON quantity_acceptance_items(contract_item_id);

-- ---------- Payment certificates v2 ----------
ALTER TABLE payment_certificates
  DROP CONSTRAINT IF EXISTS payment_certificates_status_check;

ALTER TABLE payment_certificates
  ADD CONSTRAINT payment_certificates_status_check
    CHECK (status IN ('draft', 'submitted', 'returned', 'approved', 'paid', 'cancelled'));

ALTER TABLE payment_certificates
  ADD COLUMN IF NOT EXISTS acceptance_id UUID REFERENCES quantity_acceptances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gross_this_period NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_cumulative NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_recovery_this_period NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_recovery_cumulative NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_this_period NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_cumulative NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payable_this_period NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_by TEXT,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_reason TEXT;

UPDATE payment_certificates
SET
  gross_this_period = COALESCE(NULLIF(gross_this_period, 0), current_completed_value, 0),
  gross_cumulative = COALESCE(NULLIF(gross_cumulative, 0), total_completed_value, 0),
  advance_recovery_this_period = COALESCE(NULLIF(advance_recovery_this_period, 0), advance_recovery, 0),
  retention_this_period = COALESCE(NULLIF(retention_this_period, 0), retention_amount, 0),
  payable_this_period = COALESCE(NULLIF(payable_this_period, 0), current_payable_amount, 0);

CREATE TABLE IF NOT EXISTS payment_certificate_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_certificate_id UUID NOT NULL REFERENCES payment_certificates(id) ON DELETE CASCADE,
  contract_item_id UUID NOT NULL REFERENCES contract_items(id),
  contract_item_code TEXT,
  contract_item_name TEXT,
  unit TEXT,
  contract_quantity NUMERIC NOT NULL DEFAULT 0,
  revised_contract_quantity NUMERIC NOT NULL DEFAULT 0,
  previous_quantity NUMERIC NOT NULL DEFAULT 0,
  current_quantity NUMERIC NOT NULL DEFAULT 0,
  cumulative_quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  current_amount NUMERIC NOT NULL DEFAULT 0,
  cumulative_amount NUMERIC NOT NULL DEFAULT 0,
  source_acceptance_item_id UUID REFERENCES quantity_acceptance_items(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_certificate_advance_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_certificate_id UUID NOT NULL REFERENCES payment_certificates(id) ON DELETE CASCADE,
  advance_payment_id UUID NOT NULL REFERENCES advance_payments(id) ON DELETE RESTRICT,
  recovery_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(payment_certificate_id, advance_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_cert_items_cert ON payment_certificate_items(payment_certificate_id);
CREATE INDEX IF NOT EXISTS idx_payment_cert_items_contract_item ON payment_certificate_items(contract_item_id);
CREATE INDEX IF NOT EXISTS idx_payment_cert_adv_cert ON payment_certificate_advance_recoveries(payment_certificate_id);

INSERT INTO payment_certificate_items (
  payment_certificate_id, contract_item_id, contract_item_code, contract_item_name,
  unit, contract_quantity, revised_contract_quantity, previous_quantity,
  current_quantity, cumulative_quantity, unit_price, current_amount, cumulative_amount
)
SELECT
  pc.id,
  (i.value->>'contractItemId')::uuid,
  i.value->>'contractItemCode',
  i.value->>'contractItemName',
  i.value->>'unit',
  COALESCE(NULLIF(i.value->>'contractQuantity', '')::numeric, 0),
  COALESCE(NULLIF(i.value->>'revisedContractQuantity', '')::numeric, NULLIF(i.value->>'contractQuantity', '')::numeric, 0),
  COALESCE(NULLIF(i.value->>'previousQuantity', '')::numeric, 0),
  COALESCE(NULLIF(i.value->>'currentQuantity', '')::numeric, 0),
  COALESCE(NULLIF(i.value->>'cumulativeQuantity', '')::numeric, 0),
  COALESCE(NULLIF(i.value->>'unitPrice', '')::numeric, 0),
  COALESCE(NULLIF(i.value->>'currentAmount', '')::numeric, 0),
  COALESCE(NULLIF(i.value->>'cumulativeAmount', '')::numeric, 0)
FROM payment_certificates pc
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pc.items, '[]'::jsonb)) AS i(value)
WHERE NOT EXISTS (SELECT 1 FROM payment_certificate_items x WHERE x.payment_certificate_id = pc.id)
  AND COALESCE(i.value->>'contractItemId', '') <> '';

-- ---------- Contract variations ----------
CREATE TABLE IF NOT EXISTS contract_variations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('customer', 'subcontractor')),
  construction_site_id UUID NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  reason TEXT,
  total_amount_delta NUMERIC NOT NULL DEFAULT 0,
  submitted_by TEXT,
  submitted_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_variation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_id UUID NOT NULL REFERENCES contract_variations(id) ON DELETE CASCADE,
  contract_item_id UUID REFERENCES contract_items(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  quantity_delta NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  amount_delta NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_variations_contract ON contract_variations(contract_id, contract_type);
CREATE INDEX IF NOT EXISTS idx_contract_variations_site ON contract_variations(construction_site_id);
CREATE INDEX IF NOT EXISTS idx_contract_variation_items_variation ON contract_variation_items(variation_id);

-- ---------- Official cost actual mapping ----------
CREATE TABLE IF NOT EXISTS project_cost_actuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  construction_site_id UUID NOT NULL,
  cost_item_id UUID REFERENCES project_cost_items(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('materials', 'labor', 'subcontract', 'machinery', 'overhead', 'other')),
  source TEXT NOT NULL CHECK (source IN ('transaction', 'purchase_order', 'subcontract', 'dailylog', 'manual')),
  source_ref TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_cost_actuals_site ON project_cost_actuals(construction_site_id);
CREATE INDEX IF NOT EXISTS idx_project_cost_actuals_cost_item ON project_cost_actuals(cost_item_id);

-- ---------- updated_at trigger helper ----------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS trg_quantity_acceptances_updated_at ON quantity_acceptances;
CREATE TRIGGER trg_quantity_acceptances_updated_at
  BEFORE UPDATE ON quantity_acceptances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_contract_variations_updated_at ON contract_variations;
CREATE TRIGGER trg_contract_variations_updated_at
  BEFORE UPDATE ON contract_variations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- RLS and grants ----------
ALTER TABLE task_contract_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log_volumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log_labor ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE quantity_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE quantity_acceptance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_certificate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_certificate_advance_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_variation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_cost_actuals ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  task_contract_items,
  daily_log_volumes,
  daily_log_materials,
  daily_log_labor,
  daily_log_machines,
  quantity_acceptances,
  quantity_acceptance_items,
  payment_certificate_items,
  payment_certificate_advance_recoveries,
  contract_variations,
  contract_variation_items,
  project_cost_actuals
TO authenticated;

DROP POLICY IF EXISTS "task_contract_items_site_access" ON task_contract_items;
CREATE POLICY "task_contract_items_site_access" ON task_contract_items
  FOR ALL TO authenticated
  USING (construction_site_id IS NOT NULL)
  WITH CHECK (construction_site_id IS NOT NULL);

DROP POLICY IF EXISTS "daily_log_volumes_site_access" ON daily_log_volumes;
CREATE POLICY "daily_log_volumes_site_access" ON daily_log_volumes
  FOR ALL TO authenticated
  USING (construction_site_id IS NOT NULL)
  WITH CHECK (construction_site_id IS NOT NULL);

DROP POLICY IF EXISTS "daily_log_materials_site_access" ON daily_log_materials;
CREATE POLICY "daily_log_materials_site_access" ON daily_log_materials
  FOR ALL TO authenticated
  USING (construction_site_id IS NOT NULL)
  WITH CHECK (construction_site_id IS NOT NULL);

DROP POLICY IF EXISTS "daily_log_labor_site_access" ON daily_log_labor;
CREATE POLICY "daily_log_labor_site_access" ON daily_log_labor
  FOR ALL TO authenticated
  USING (construction_site_id IS NOT NULL)
  WITH CHECK (construction_site_id IS NOT NULL);

DROP POLICY IF EXISTS "daily_log_machines_site_access" ON daily_log_machines;
CREATE POLICY "daily_log_machines_site_access" ON daily_log_machines
  FOR ALL TO authenticated
  USING (construction_site_id IS NOT NULL)
  WITH CHECK (construction_site_id IS NOT NULL);

DROP POLICY IF EXISTS "quantity_acceptances_site_access" ON quantity_acceptances;
CREATE POLICY "quantity_acceptances_site_access" ON quantity_acceptances
  FOR ALL TO authenticated
  USING (construction_site_id IS NOT NULL)
  WITH CHECK (construction_site_id IS NOT NULL);

DROP POLICY IF EXISTS "quantity_acceptance_items_parent_access" ON quantity_acceptance_items;
CREATE POLICY "quantity_acceptance_items_parent_access" ON quantity_acceptance_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM quantity_acceptances qa WHERE qa.id = acceptance_id AND qa.construction_site_id IS NOT NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM quantity_acceptances qa WHERE qa.id = acceptance_id AND qa.construction_site_id IS NOT NULL));

DROP POLICY IF EXISTS "payment_certificate_items_parent_access" ON payment_certificate_items;
CREATE POLICY "payment_certificate_items_parent_access" ON payment_certificate_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM payment_certificates pc WHERE pc.id = payment_certificate_id AND pc.construction_site_id IS NOT NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM payment_certificates pc WHERE pc.id = payment_certificate_id AND pc.construction_site_id IS NOT NULL));

DROP POLICY IF EXISTS "payment_cert_adv_parent_access" ON payment_certificate_advance_recoveries;
CREATE POLICY "payment_cert_adv_parent_access" ON payment_certificate_advance_recoveries
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM payment_certificates pc WHERE pc.id = payment_certificate_id AND pc.construction_site_id IS NOT NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM payment_certificates pc WHERE pc.id = payment_certificate_id AND pc.construction_site_id IS NOT NULL));

DROP POLICY IF EXISTS "contract_variations_site_access" ON contract_variations;
CREATE POLICY "contract_variations_site_access" ON contract_variations
  FOR ALL TO authenticated
  USING (construction_site_id IS NOT NULL)
  WITH CHECK (construction_site_id IS NOT NULL);

DROP POLICY IF EXISTS "contract_variation_items_parent_access" ON contract_variation_items;
CREATE POLICY "contract_variation_items_parent_access" ON contract_variation_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM contract_variations cv WHERE cv.id = variation_id AND cv.construction_site_id IS NOT NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM contract_variations cv WHERE cv.id = variation_id AND cv.construction_site_id IS NOT NULL));

DROP POLICY IF EXISTS "project_cost_actuals_site_access" ON project_cost_actuals;
CREATE POLICY "project_cost_actuals_site_access" ON project_cost_actuals
  FOR ALL TO authenticated
  USING (construction_site_id IS NOT NULL)
  WITH CHECK (construction_site_id IS NOT NULL);

-- ============================================================
-- FastCons Integration: BOQ + Payment + Cost Items
-- Branch: feature/fastcons-boq-payment
-- Date: 2026-04-29
-- ============================================================

-- 1. ALTER project_tasks — thêm BOQ fields
ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS total_price NUMERIC,
  ADD COLUMN IF NOT EXISTS completed_quantity NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contract_item_id UUID;

-- 2. ALTER daily_logs — thêm JSONB columns cho chi tiết nhật ký
ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS volumes JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS materials JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS labor_details JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS machines JSONB DEFAULT '[]'::jsonb;

-- 3. CREATE contract_items — BOQ hạng mục hợp đồng
CREATE TABLE IF NOT EXISTS contract_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('customer', 'subcontractor')),
  construction_site_id UUID NOT NULL,
  parent_id UUID REFERENCES contract_items(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'm2',
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  completed_quantity NUMERIC DEFAULT 0,
  completed_percent NUMERIC DEFAULT 0,
  "order" INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index cho truy vấn thường dùng
CREATE INDEX IF NOT EXISTS idx_contract_items_contract ON contract_items(contract_id, contract_type);
CREATE INDEX IF NOT EXISTS idx_contract_items_site ON contract_items(construction_site_id);

-- 4. CREATE payment_certificates — đợt thanh toán
CREATE TABLE IF NOT EXISTS payment_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('customer', 'subcontractor')),
  construction_site_id UUID NOT NULL,
  period_number INTEGER NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  description TEXT,
  -- Chi tiết hạng mục (JSONB array of PaymentCertificateItem)
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Giá trị tổng hợp
  total_contract_value NUMERIC NOT NULL DEFAULT 0,
  total_completed_value NUMERIC NOT NULL DEFAULT 0,
  current_completed_value NUMERIC NOT NULL DEFAULT 0,
  -- Khấu trừ & Phạt
  advance_recovery NUMERIC NOT NULL DEFAULT 0,
  retention_percent NUMERIC NOT NULL DEFAULT 5,
  retention_amount NUMERIC NOT NULL DEFAULT 0,
  penalty_amount NUMERIC NOT NULL DEFAULT 0,
  penalty_reason TEXT,
  deduction_amount NUMERIC NOT NULL DEFAULT 0,
  deduction_reason TEXT,
  -- Lũy kế
  previous_certified_amount NUMERIC NOT NULL DEFAULT 0,
  current_payable_amount NUMERIC NOT NULL DEFAULT 0,
  -- Workflow
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid')),
  submitted_by TEXT,
  submitted_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  note TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_certs_contract ON payment_certificates(contract_id, contract_type);
CREATE INDEX IF NOT EXISTS idx_payment_certs_site ON payment_certificates(construction_site_id);
CREATE INDEX IF NOT EXISTS idx_payment_certs_status ON payment_certificates(status);

-- 5. CREATE advance_payments — tạm ứng
CREATE TABLE IF NOT EXISTS advance_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('customer', 'subcontractor')),
  construction_site_id UUID NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  recovery_percent NUMERIC NOT NULL DEFAULT 30,
  recovered_amount NUMERIC NOT NULL DEFAULT 0,
  remaining_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fully_recovered', 'cancelled')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_advance_payments_contract ON advance_payments(contract_id, contract_type);

-- 6. CREATE project_cost_items — danh mục khoản mục chi phí
CREATE TABLE IF NOT EXISTS project_cost_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  construction_site_id UUID NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES project_cost_items(id) ON DELETE SET NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  budget_amount NUMERIC NOT NULL DEFAULT 0,
  actual_amount NUMERIC NOT NULL DEFAULT 0,
  variance_amount NUMERIC DEFAULT 0,
  variance_percent NUMERIC DEFAULT 0,
  formula TEXT,
  warning_threshold NUMERIC DEFAULT 90,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'contract', 'dailylog', 'payment')),
  is_auto_calculated BOOLEAN DEFAULT false,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_items_site ON project_cost_items(construction_site_id);

-- 7. RLS Policies (Enable RLS + allow all for authenticated)
ALTER TABLE contract_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE advance_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_cost_items ENABLE ROW LEVEL SECURITY;

-- Contract Items
CREATE POLICY "contract_items_select" ON contract_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "contract_items_insert" ON contract_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "contract_items_update" ON contract_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "contract_items_delete" ON contract_items FOR DELETE TO authenticated USING (true);

-- Payment Certificates
CREATE POLICY "payment_certs_select" ON payment_certificates FOR SELECT TO authenticated USING (true);
CREATE POLICY "payment_certs_insert" ON payment_certificates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "payment_certs_update" ON payment_certificates FOR UPDATE TO authenticated USING (true);
CREATE POLICY "payment_certs_delete" ON payment_certificates FOR DELETE TO authenticated USING (true);

-- Advance Payments
CREATE POLICY "advance_payments_select" ON advance_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "advance_payments_insert" ON advance_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "advance_payments_update" ON advance_payments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "advance_payments_delete" ON advance_payments FOR DELETE TO authenticated USING (true);

-- Project Cost Items
CREATE POLICY "cost_items_select" ON project_cost_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "cost_items_insert" ON project_cost_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cost_items_update" ON project_cost_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "cost_items_delete" ON project_cost_items FOR DELETE TO authenticated USING (true);

-- 8. Auto-update updated_at trigger for payment_certificates
CREATE OR REPLACE FUNCTION update_payment_cert_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_cert_updated_at
  BEFORE UPDATE ON payment_certificates
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_cert_updated_at();

-- HD partner master, contract type metadata, dynamic received-contract templates.

CREATE TABLE IF NOT EXISTS public.business_partners (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_user_id TEXT,
  owner_name TEXT,
  created_date DATE DEFAULT CURRENT_DATE,
  tax_code TEXT,
  address TEXT,
  classifications TEXT[] NOT NULL DEFAULT '{}',
  phone TEXT,
  country TEXT DEFAULT 'Việt Nam',
  province TEXT,
  ward TEXT,
  email TEXT,
  website TEXT,
  bank_name TEXT,
  bank_account TEXT,
  contact_name TEXT,
  contact_title TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_partners_classifications_check
    CHECK (classifications <@ ARRAY['owner', 'contractor', 'supplier']::TEXT[])
);

CREATE INDEX IF NOT EXISTS idx_business_partners_name ON public.business_partners(name);
CREATE INDEX IF NOT EXISTS idx_business_partners_tax_code ON public.business_partners(tax_code);
CREATE INDEX IF NOT EXISTS idx_business_partners_classifications ON public.business_partners USING GIN(classifications);
CREATE INDEX IF NOT EXISTS idx_business_partners_active ON public.business_partners(is_active);

CREATE TABLE IF NOT EXISTS public.contract_type_metadata (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_type_metadata_active_order
  ON public.contract_type_metadata(is_active, sort_order, name);

CREATE TABLE IF NOT EXISTS public.contract_form_templates (
  id TEXT PRIMARY KEY,
  contract_type_id TEXT NOT NULL REFERENCES public.contract_type_metadata(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_form_templates_type
  ON public.contract_form_templates(contract_type_id, is_default, is_active);

CREATE TABLE IF NOT EXISTS public.contract_template_sections (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES public.contract_form_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_template_sections_template
  ON public.contract_template_sections(template_id, sort_order);

CREATE TABLE IF NOT EXISTS public.contract_template_fields (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES public.contract_form_templates(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES public.contract_template_sections(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text', 'number', 'currency', 'percent', 'date', 'textarea', 'select', 'email', 'phone', 'url')),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  placeholder TEXT,
  options JSONB NOT NULL DEFAULT '[]',
  default_value TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, key)
);

CREATE INDEX IF NOT EXISTS idx_contract_template_fields_section
  ON public.contract_template_fields(section_id, sort_order);

ALTER TABLE public.customer_contracts
  ADD COLUMN IF NOT EXISTS contract_type_id TEXT REFERENCES public.contract_type_metadata(id),
  ADD COLUMN IF NOT EXISTS owner_partner_id TEXT REFERENCES public.business_partners(id),
  ADD COLUMN IF NOT EXISTS template_id TEXT REFERENCES public.contract_form_templates(id),
  ADD COLUMN IF NOT EXISTS template_snapshot JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_data JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS counterparty_snapshot JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_contracts_contract_type_id ON public.customer_contracts(contract_type_id);
CREATE INDEX IF NOT EXISTS idx_customer_contracts_owner_partner_id ON public.customer_contracts(owner_partner_id);

CREATE TABLE IF NOT EXISTS public.contract_guarantees (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES public.customer_contracts(id) ON DELETE CASCADE,
  guarantee_type TEXT NOT NULL DEFAULT 'other'
    CHECK (guarantee_type IN ('performance', 'advance', 'warranty', 'other')),
  name TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  percent NUMERIC NOT NULL DEFAULT 0,
  bank_name TEXT,
  guarantee_number TEXT,
  issue_date DATE,
  expiry_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'released', 'expired', 'cancelled')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_guarantees_contract ON public.contract_guarantees(contract_id);

INSERT INTO public.contract_type_metadata (id, code, name, description, is_active, sort_order)
VALUES
  ('ct-service', 'service', 'HĐ dịch vụ', 'Hợp đồng dịch vụ nhận thầu', TRUE, 10),
  ('ct-construction', 'construction', 'HĐ thi công', 'Hợp đồng thi công nhận thầu', TRUE, 20),
  ('ct-service-supply', 'service_supply', 'HĐ cung cấp dịch vụ', 'Hợp đồng cung cấp dịch vụ', TRUE, 30)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO public.contract_form_templates (id, contract_type_id, name, description, is_default, is_active)
VALUES
  ('tpl-service-default', 'ct-service', 'Mẫu HĐ dịch vụ mặc định', 'Mẫu khai báo HĐ nhận thầu dịch vụ', TRUE, TRUE),
  ('tpl-construction-default', 'ct-construction', 'Mẫu HĐ thi công mặc định', 'Mẫu khai báo HĐ nhận thầu thi công', TRUE, TRUE),
  ('tpl-service-supply-default', 'ct-service-supply', 'Mẫu HĐ cung cấp dịch vụ mặc định', 'Mẫu khai báo HĐ nhận thầu cung cấp dịch vụ', TRUE, TRUE)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_default = EXCLUDED.is_default,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO public.contract_template_sections (id, template_id, title, description, sort_order, is_active)
VALUES
  ('sec-service-commercial', 'tpl-service-default', 'Thông tin thương mại bổ sung', NULL, 10, TRUE),
  ('sec-construction-commercial', 'tpl-construction-default', 'Thông tin thương mại bổ sung', NULL, 10, TRUE),
  ('sec-service-supply-commercial', 'tpl-service-supply-default', 'Thông tin thương mại bổ sung', NULL, 10, TRUE)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO public.contract_template_fields
  (id, template_id, section_id, key, label, field_type, required, placeholder, sort_order, is_active)
VALUES
  ('fld-service-scope', 'tpl-service-default', 'sec-service-commercial', 'serviceScope', 'Phạm vi dịch vụ', 'textarea', FALSE, 'Nhập phạm vi dịch vụ', 10, TRUE),
  ('fld-service-deliverables', 'tpl-service-default', 'sec-service-commercial', 'deliverables', 'Sản phẩm bàn giao', 'textarea', FALSE, 'Nhập sản phẩm bàn giao', 20, TRUE),
  ('fld-service-payment', 'tpl-service-default', 'sec-service-commercial', 'paymentTerms', 'Điều khoản thanh toán', 'textarea', FALSE, 'Nhập điều khoản thanh toán', 30, TRUE),
  ('fld-construction-scope', 'tpl-construction-default', 'sec-construction-commercial', 'constructionScope', 'Phạm vi thi công', 'textarea', FALSE, 'Nhập phạm vi thi công', 10, TRUE),
  ('fld-construction-location', 'tpl-construction-default', 'sec-construction-commercial', 'workLocation', 'Địa điểm thi công', 'text', FALSE, 'Nhập địa điểm thi công', 20, TRUE),
  ('fld-construction-retention', 'tpl-construction-default', 'sec-construction-commercial', 'retentionPercent', 'Tỷ lệ giữ lại (%)', 'percent', FALSE, '0', 30, TRUE),
  ('fld-service-supply-scope', 'tpl-service-supply-default', 'sec-service-supply-commercial', 'supplyScope', 'Phạm vi cung cấp dịch vụ', 'textarea', FALSE, 'Nhập phạm vi cung cấp', 10, TRUE),
  ('fld-service-supply-sla', 'tpl-service-supply-default', 'sec-service-supply-commercial', 'sla', 'Cam kết chất lượng/SLA', 'textarea', FALSE, 'Nhập cam kết chất lượng', 20, TRUE),
  ('fld-service-supply-payment', 'tpl-service-supply-default', 'sec-service-supply-commercial', 'paymentTerms', 'Điều khoản thanh toán', 'textarea', FALSE, 'Nhập điều khoản thanh toán', 30, TRUE)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  placeholder = EXCLUDED.placeholder,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();

ALTER TABLE public.business_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_type_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_template_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_template_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_guarantees ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'business_partners',
    'contract_type_metadata',
    'contract_form_templates',
    'contract_template_sections',
    'contract_template_fields',
    'contract_guarantees'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_select', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_insert', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_update', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_delete', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', table_name || '_select', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_module_admin(%L))', table_name || '_insert', table_name, 'HD');
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_module_admin(%L)) WITH CHECK (public.is_module_admin(%L))', table_name || '_update', table_name, 'HD', 'HD');
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_module_admin(%L))', table_name || '_delete', table_name, 'HD');
  END LOOP;
END $$;

-- Supplier Contracts
CREATE TABLE IF NOT EXISTS supplier_contracts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'purchase',
  supplier_id TEXT,
  supplier_name TEXT,
  supplier_representative TEXT,
  value NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'VND',
  payment_method TEXT,
  payment_terms TEXT,
  guarantee_info TEXT,
  purchase_order_number TEXT,
  signed_date DATE,
  effective_date DATE,
  expiry_date DATE,
  managed_by_user_id TEXT,
  managed_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  note TEXT,
  attachments JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Customer Contracts
CREATE TABLE IF NOT EXISTS customer_contracts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'construction',
  customer_name TEXT NOT NULL,
  customer_tax_code TEXT,
  customer_address TEXT,
  customer_representative TEXT,
  customer_representative_title TEXT,
  project_id TEXT,
  value NUMERIC NOT NULL DEFAULT 0,
  vat_percent NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'VND',
  payment_method TEXT,
  payment_schedule TEXT,
  warranty_months INTEGER DEFAULT 0,
  signed_date DATE,
  effective_date DATE,
  end_date DATE,
  managed_by_user_id TEXT,
  managed_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  note TEXT,
  attachments JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Subcontractor Contracts
CREATE TABLE IF NOT EXISTS subcontractor_contracts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  subcontractor_name TEXT NOT NULL,
  subcontractor_tax_code TEXT,
  scope_of_work TEXT,
  project_id TEXT,
  parent_contract_id TEXT,
  value NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'VND',
  payment_method TEXT,
  payment_schedule TEXT,
  retention_percent NUMERIC DEFAULT 0,
  work_location TEXT,
  guarantee_info TEXT,
  signed_date DATE,
  effective_date DATE,
  completion_date DATE,
  managed_by_user_id TEXT,
  managed_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  note TEXT,
  attachments JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert into buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('contract-files', 'contract-files', false) ON CONFLICT DO NOTHING;

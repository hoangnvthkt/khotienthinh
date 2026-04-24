-- =============================================
-- SQL Migration Script cho Module Tài Sản Vioo
-- Chạy đoạn script này trong bảng SQL Editor trên Supabase Dashboard
-- =============================================

-- =============================================
-- 1. Bổ sung cột cho bảng assets
-- =============================================
ALTER TABLE assets
  -- Phân loại
  ADD COLUMN IF NOT EXISTS asset_type TEXT DEFAULT 'single', -- single | batch | bundle
  ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  -- Phân cấp cha/con
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES assets(id),
  ADD COLUMN IF NOT EXISTS child_index INTEGER,
  ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN DEFAULT FALSE,
  -- Quản lý
  ADD COLUMN IF NOT EXISTS managed_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS managing_dept_id UUID REFERENCES org_units(id),
  ADD COLUMN IF NOT EXISTS construction_site_id UUID REFERENCES hrm_construction_sites(id),
  -- Mua sắm
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS contract_number TEXT,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  -- Nguồn gốc & loại
  ADD COLUMN IF NOT EXISTS asset_origin TEXT DEFAULT 'purchase',
  ADD COLUMN IF NOT EXISTS is_fixed_asset BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_leased BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS leased_from TEXT,
  ADD COLUMN IF NOT EXISTS lease_end_date DATE,
  -- Bảo hành
  ADD COLUMN IF NOT EXISTS warranty_condition TEXT,
  ADD COLUMN IF NOT EXISTS warranty_provider TEXT,
  ADD COLUMN IF NOT EXISTS warranty_contact TEXT;

-- =============================================
-- 2. Bảng tồn kho theo vị trí (cho batch asset)
-- =============================================
CREATE TABLE IF NOT EXISTS asset_location_stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id),
  construction_site_id UUID REFERENCES hrm_construction_sites(id),
  dept_id UUID REFERENCES org_units(id),
  qty INTEGER NOT NULL DEFAULT 0,
  assigned_to_user_id UUID REFERENCES users(id),
  assigned_to_name TEXT,
  note TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT check_location CHECK (
    warehouse_id IS NOT NULL OR 
    construction_site_id IS NOT NULL OR 
    dept_id IS NOT NULL
  )
);

-- Active realtime cho bảng này để AppContext nhận sự kiện
alter publication supabase_realtime add table asset_location_stocks;

-- =============================================
-- 3. Bảng phiếu điều chuyển lô
-- =============================================
CREATE TABLE IF NOT EXISTS asset_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,          -- DCC-001
  asset_id UUID NOT NULL REFERENCES assets(id),
  asset_code TEXT,
  asset_name TEXT,
  qty INTEGER NOT NULL,
  -- Nguồn
  from_warehouse_id UUID REFERENCES warehouses(id),
  from_site_id UUID REFERENCES hrm_construction_sites(id),
  from_dept_id UUID REFERENCES org_units(id),
  from_location_label TEXT,
  -- Đích
  to_warehouse_id UUID REFERENCES warehouses(id),
  to_site_id UUID REFERENCES hrm_construction_sites(id),
  to_dept_id UUID REFERENCES org_units(id),
  to_location_label TEXT,
  -- Người nhận
  received_by_user_id UUID REFERENCES users(id),
  received_by_name TEXT,
  -- Trạng thái
  date DATE NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'completed',
  performed_by UUID REFERENCES users(id),
  performed_by_name TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Active realtime cho bảng này để AppContext nhận sự kiện
alter publication supabase_realtime add table asset_transfers;

-- =============================================
-- 4. Bảng file đính kèm tài sản
-- =============================================
CREATE TABLE IF NOT EXISTS asset_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT,
  size BIGINT,
  category TEXT DEFAULT 'other', -- invoice | contract | manual | other
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by UUID REFERENCES users(id)
);

-- =============================================
-- 5. Mở rộng asset_assignments
-- =============================================
ALTER TABLE asset_assignments
  ADD COLUMN IF NOT EXISTS dept_id UUID REFERENCES org_units(id),
  ADD COLUMN IF NOT EXISTS dept_name TEXT,
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES hrm_construction_sites(id),
  ADD COLUMN IF NOT EXISTS site_name TEXT,
  ADD COLUMN IF NOT EXISTS qty INTEGER DEFAULT 1; -- Số lượng cấp phát (cho batch)

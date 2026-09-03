-- =====================================================================
-- Refactor QA/QC Quality Inspection Module (V2)
-- 3-Tier Hierarchy: Category -> Work Type -> Template -> Sections -> Items
-- Supports Tolerance, Multi-Attempt Re-inspections and AI metadata tags.
-- =====================================================================

-- Clean up Phase 1 tables first
DROP TABLE IF EXISTS inspection_template_items CASCADE;
DROP TABLE IF EXISTS template_sections CASCADE;
DROP TABLE IF EXISTS inspection_templates CASCADE;
DROP TABLE IF EXISTS inspection_work_types CASCADE;
DROP TABLE IF EXISTS inspection_categories CASCADE;

-- 1. Bảng Hạng mục chuẩn (Categories)
CREATE TABLE IF NOT EXISTS inspection_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

-- 2. Bảng Loại công tác (Work Types)
CREATE TABLE IF NOT EXISTS inspection_work_types (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES inspection_categories(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

-- 3. Bảng Template nghiệm thu (Templates)
CREATE TABLE IF NOT EXISTS inspection_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  work_type_id UUID NOT NULL REFERENCES inspection_work_types(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  standard_reference TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  
  -- AI Ready metadata fields
  inspection_purpose TEXT,
  risk_level TEXT DEFAULT 'medium', -- 'low', 'medium', 'high'
  discipline TEXT DEFAULT 'civil', -- 'civil', 'steel', 'mep', 'finishing'
  
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Bảng Section động (Template Sections)
CREATE TABLE IF NOT EXISTS template_sections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- 5. Bảng Tiêu chí Template (Template Items)
CREATE TABLE IF NOT EXISTS inspection_template_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id UUID NOT NULL REFERENCES template_sections(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  acceptance_criteria TEXT,
  inspection_method TEXT,
  required BOOLEAN DEFAULT true,
  data_type TEXT DEFAULT 'checkbox', -- 'checkbox', 'number', 'text', 'photo'
  min_value NUMERIC,
  max_value NUMERIC,
  unit TEXT,
  sort_order INTEGER DEFAULT 0
);

-- 6. Cấu hình bảng Hồ sơ chất lượng (quality_checklists)
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS work_type_id UUID REFERENCES inspection_work_types(id) ON DELETE SET NULL;
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS checklist_data JSONB DEFAULT '[]';
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS current_attempt INTEGER DEFAULT 1;

-- 7. Bảng Lần nghiệm thu (Attempts)
CREATE TABLE IF NOT EXISTS quality_inspection_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  checklist_id UUID NOT NULL REFERENCES quality_checklists(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  inspector_name TEXT,
  items_data JSONB DEFAULT '[]', -- Snapshot dữ liệu của lần nghiệm thu này
  result TEXT NOT NULL, -- 'PASSED' | 'FAILED'
  conclusion TEXT,
  signature_url TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
-- RLS - ROW LEVEL SECURITY POLICIES
-- =====================================================================
ALTER TABLE inspection_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_work_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_inspection_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_all" ON inspection_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "work_types_all" ON inspection_work_types FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "templates_all" ON inspection_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sections_all" ON template_sections FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "items_all" ON inspection_template_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "attempts_all" ON quality_inspection_attempts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- SEED DATA
-- =====================================================================

-- 1. Seed Hạng mục chuẩn (Categories)
INSERT INTO inspection_categories (id, code, name) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'CAT-MONG', 'Móng'),
  ('c2000000-0000-0000-0000-000000000002', 'CAT-THEP', 'Kết cấu thép');

-- 2. Seed Loại công tác cho Móng (Category Móng)
INSERT INTO inspection_work_types (id, category_id, code, name) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'WT-MONG-DAO', 'Đào đất móng'),
  ('b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'WT-MONG-LOT', 'Bê tông lót móng'),
  ('b1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'WT-MONG-THEP', 'Cốt thép móng'),
  ('b1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001', 'WT-MONG-PHA', 'Cốp pha móng'),
  ('b1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000001', 'WT-MONG-TONG', 'Bê tông móng');

-- 3. Seed Loại công tác cho Kết cấu thép (Category Kết cấu thép)
INSERT INTO inspection_work_types (id, category_id, code, name) VALUES
  ('b2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000002', 'WT-THEP-NEO', 'Lắp đặt Bu lông neo'),
  ('b2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000002', 'WT-THEP-COT', 'Lắp dựng Cột thép'),
  ('b2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000002', 'WT-THEP-KEO', 'Lắp dựng Kèo thép'),
  ('b2000000-0000-0000-0000-000000000004', 'c2000000-0000-0000-0000-000000000002', 'WT-THEP-XAGO', 'Lắp đặt Xà gồ'),
  ('b2000000-0000-0000-0000-000000000005', 'c2000000-0000-0000-0000-000000000002', 'WT-THEP-TOLE', 'Lợp Tole mái'),
  ('b2000000-0000-0000-0000-000000000006', 'c2000000-0000-0000-0000-000000000002', 'WT-THEP-XOI', 'Lắp đặt Máng xối');

-- 4. Seed Template 1: Đổ bê tông móng
INSERT INTO inspection_templates (id, work_type_id, code, name, version, standard_reference, description, inspection_purpose, risk_level, discipline) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000005', 'TPL-MONG-BT-01', 'Nghiệm thu đổ bê tông móng', 1, 'TCVN 4453:1995', 'Kiểm tra vệ sinh cốp pha cốt thép, kích thước hình học đài móng và các chỉ số cường độ độ sụt bê tông tươi.', 'Kiểm soát chất lượng đổ bê tông đài móng công trường', 'high', 'civil');

-- Sections cho Bê tông móng
INSERT INTO template_sections (id, template_id, name, sort_order) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'Công tác chuẩn bị', 1),
  ('f1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'Kiểm tra kích thước hình học', 2),
  ('f1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'Tiêu chuẩn kỹ thuật đo lường', 3);

-- Items cho Bê tông móng
INSERT INTO inspection_template_items (id, section_id, item_name, acceptance_criteria, inspection_method, required, data_type, min_value, max_value, unit, sort_order) VALUES
  -- Chuẩn bị
  ('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'Vệ sinh đáy hố móng, dọn dẹp sạch bùn đất', 'Không có bùn hữu cơ đọng đáy', 'Ngoại quan', true, 'checkbox', NULL, NULL, NULL, 1),
  ('a1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'Cân chỉnh cao độ cốt liệu đáy móng', 'Đúng cao độ cốt nền thi công', 'Máy thủy bình', true, 'checkbox', NULL, NULL, NULL, 2),
  ('a1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001', 'Nghiệm thu cốt thép đài giằng móng', 'Đúng bản vẽ kết cấu thiết kế', 'Thước đo thép', true, 'checkbox', NULL, NULL, NULL, 3),
  -- Kích thước hình học
  ('a1000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000002', 'Sai số cao độ đáy đài móng', '± 20 mm', 'Máy thủy bình', true, 'number', -20, 20, 'mm', 1),
  ('a1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000002', 'Sai lệch kích thước mặt bằng móng', '± 30 mm', 'Thước thép', true, 'number', -30, 30, 'mm', 2),
  -- Đo lường kỹ thuật
  ('a1000000-0000-0000-0000-000000000006', 'f1000000-0000-0000-0000-000000000003', 'Độ sụt bê tông tươi', '12 ± 2 cm', 'Côn sụt tiêu chuẩn', true, 'number', 10, 14, 'cm', 1),
  ('a1000000-0000-0000-0000-000000000007', 'f1000000-0000-0000-0000-000000000003', 'Cường độ mẫu nén bê tông (R28)', '≥ 250 kg/cm²', 'Nén mẫu phòng thí nghiệm', true, 'number', 250, NULL, 'kg/cm²', 2);

-- 5. Seed Template 2: Lắp dựng kèo thép
INSERT INTO inspection_templates (id, work_type_id, code, name, version, standard_reference, description, inspection_purpose, risk_level, discipline) VALUES
  ('e1000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000003', 'TPL-THEP-KE-01', 'Nghiệm thu lắp dựng kèo thép', 1, 'TCVN 170:2007', 'Kiểm tra chất lượng thép kèo xuất xưởng, độ lực xiết bu lông và sai lệch cao độ võng kèo.', 'Đảm bảo an toàn kết cấu chịu lực hệ vì kèo thép nhà xưởng', 'high', 'steel');

-- Sections cho Kèo thép
INSERT INTO template_sections (id, template_id, name, sort_order) VALUES
  ('f2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'Công tác chuẩn bị', 1),
  ('f2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'Tiêu chuẩn mối hàn & bu lông', 2),
  ('f2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'Dung sai lắp dựng hình học', 3);

-- Items cho Kèo thép
INSERT INTO inspection_template_items (id, section_id, item_name, acceptance_criteria, inspection_method, required, data_type, min_value, max_value, unit, sort_order) VALUES
  -- Chuẩn bị
  ('a2000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'Chứng chỉ xuất xưởng, chất lượng kết cấu thép kèo', 'Có đầy đủ hồ sơ COCQ', 'Kiểm tra hồ sơ', true, 'checkbox', NULL, NULL, NULL, 1),
  ('a2000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'Định vị tim trục và cao độ bu lông chân cột', 'Đúng bản vẽ lắp đặt trục', 'Máy toàn đạc', true, 'checkbox', NULL, NULL, NULL, 2),
  -- Mối hàn & bu lông
  ('a2000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000002', 'Lực xiết bu lông liên kết kèo', '180 - 220 N.m', 'Cờ lê lực điện tử', true, 'number', 180, 220, 'N.m', 1),
  ('a2000000-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-000000000002', 'Chiều cao đường hàn liên kết kèo', '≥ 6 mm', 'Thước đo mối hàn', true, 'number', 6, NULL, 'mm', 2),
  -- Dung sai lắp dựng
  ('a2000000-0000-0000-0000-000000000005', 'f2000000-0000-0000-0000-000000000003', 'Độ võng kèo thép đầu tự do', '≤ 15 mm', 'Máy thủy chuẩn tự động', true, 'number', NULL, 15, 'mm', 1);

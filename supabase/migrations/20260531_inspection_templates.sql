-- =====================================================================
-- Template-Based Inspection: inspection_templates + inspection_template_items
-- Seed data cho 8 loại hạng mục chuẩn ngành xây dựng
-- =====================================================================

-- 1. Bảng Template
CREATE TABLE IF NOT EXISTS inspection_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,              -- 'mong' | 'cot' | 'dam' | 'san' | 'tuong' | 'ket_cau_thep' | 'mai' | 'panel'
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Bảng Template Items
CREATE TABLE IF NOT EXISTS inspection_template_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
  section TEXT NOT NULL,               -- 'preparation' | 'technical_standard'
  item_name TEXT NOT NULL,
  item_type TEXT DEFAULT 'checkbox',   -- 'checkbox' | 'measurement' | 'text'
  required BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  unit TEXT,                           -- đơn vị đo (cho measurement)
  standard_code TEXT,                  -- mã TCVN nếu có
  required_value TEXT,                 -- giá trị yêu cầu (VD: '≥ 250 kg/cm²')
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inspection_templates_category ON inspection_templates (category, is_active);
CREATE INDEX IF NOT EXISTS idx_inspection_template_items_template ON inspection_template_items (template_id, section, sort_order);

-- RLS
ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_template_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inspection_templates_all" ON inspection_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "inspection_template_items_all" ON inspection_template_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- SEED DATA: 8 loại hạng mục chuẩn
-- =====================================================================

-- 1. MÓNG
INSERT INTO inspection_templates (id, code, name, category, version) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'TPL-MONG-01', 'Nghiệm thu móng', 'mong', 1);

INSERT INTO inspection_template_items (template_id, section, item_name, item_type, required, sort_order, standard_code, required_value) VALUES
  -- Chuẩn bị
  ('a1000000-0000-0000-0000-000000000001', 'preparation', 'Kiểm tra cao độ đáy móng', 'checkbox', true, 1, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000001', 'preparation', 'Kiểm tra kích thước hố móng', 'checkbox', true, 2, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000001', 'preparation', 'Kiểm tra lớp lót (bê tông lót / đá dăm)', 'checkbox', true, 3, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000001', 'preparation', 'Dọn dẹp đáy hố, không có nước đọng', 'checkbox', true, 4, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000001', 'preparation', 'Cốt thép đã nghiệm thu', 'checkbox', true, 5, NULL, NULL),
  -- Tiêu chuẩn kỹ thuật
  ('a1000000-0000-0000-0000-000000000001', 'technical_standard', 'Cường độ bê tông', 'measurement', true, 1, 'TCVN 4453:1995', '≥ 250 kg/cm²'),
  ('a1000000-0000-0000-0000-000000000001', 'technical_standard', 'Độ sụt bê tông', 'measurement', true, 2, 'TCVN 4453:1995', '12 ± 2 cm'),
  ('a1000000-0000-0000-0000-000000000001', 'technical_standard', 'Sai số cao độ đáy móng', 'measurement', true, 3, 'TCVN 4453:1995', '± 20mm'),
  ('a1000000-0000-0000-0000-000000000001', 'technical_standard', 'Sai số kích thước mặt bằng', 'measurement', true, 4, 'TCVN 4453:1995', '± 30mm'),
  ('a1000000-0000-0000-0000-000000000001', 'technical_standard', 'Lớp bảo vệ cốt thép', 'measurement', true, 5, 'TCVN 4453:1995', '≥ 35mm');

-- 2. CỘT
INSERT INTO inspection_templates (id, code, name, category, version) VALUES
  ('a1000000-0000-0000-0000-000000000002', 'TPL-COT-01', 'Nghiệm thu cột', 'cot', 1);

INSERT INTO inspection_template_items (template_id, section, item_name, item_type, required, sort_order, standard_code, required_value) VALUES
  ('a1000000-0000-0000-0000-000000000002', 'preparation', 'Kiểm tra cốt thép (đường kính, số lượng, khoảng cách)', 'checkbox', true, 1, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000002', 'preparation', 'Kiểm tra cốp pha (kích thước, độ phẳng, chống)', 'checkbox', true, 2, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000002', 'preparation', 'Kiểm tra bu-lông neo / mối nối cốt thép', 'checkbox', true, 3, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000002', 'preparation', 'Vệ sinh cốp pha trước khi đổ', 'checkbox', true, 4, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000002', 'technical_standard', 'Cường độ bê tông', 'measurement', true, 1, 'TCVN 4453:1995', '≥ 300 kg/cm²'),
  ('a1000000-0000-0000-0000-000000000002', 'technical_standard', 'Sai số tim cột', 'measurement', true, 2, 'TCVN 4453:1995', '± 5mm'),
  ('a1000000-0000-0000-0000-000000000002', 'technical_standard', 'Sai số tiết diện cột', 'measurement', true, 3, 'TCVN 4453:1995', '± 5mm'),
  ('a1000000-0000-0000-0000-000000000002', 'technical_standard', 'Độ thẳng đứng', 'measurement', true, 4, 'TCVN 4453:1995', '≤ H/500'),
  ('a1000000-0000-0000-0000-000000000002', 'technical_standard', 'Lớp bảo vệ cốt thép', 'measurement', true, 5, 'TCVN 4453:1995', '≥ 25mm');

-- 3. DẦM
INSERT INTO inspection_templates (id, code, name, category, version) VALUES
  ('a1000000-0000-0000-0000-000000000003', 'TPL-DAM-01', 'Nghiệm thu dầm', 'dam', 1);

INSERT INTO inspection_template_items (template_id, section, item_name, item_type, required, sort_order, standard_code, required_value) VALUES
  ('a1000000-0000-0000-0000-000000000003', 'preparation', 'Kiểm tra cốt thép dầm (chủ, đai, gia cường)', 'checkbox', true, 1, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000003', 'preparation', 'Kiểm tra cốp pha đáy & thành dầm', 'checkbox', true, 2, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000003', 'preparation', 'Kiểm tra chống đỡ cốp pha', 'checkbox', true, 3, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000003', 'preparation', 'Kiểm tra cao độ đáy dầm', 'checkbox', true, 4, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000003', 'technical_standard', 'Cường độ bê tông', 'measurement', true, 1, 'TCVN 4453:1995', '≥ 300 kg/cm²'),
  ('a1000000-0000-0000-0000-000000000003', 'technical_standard', 'Sai số kích thước tiết diện', 'measurement', true, 2, 'TCVN 4453:1995', '± 5mm'),
  ('a1000000-0000-0000-0000-000000000003', 'technical_standard', 'Sai số cao độ đáy dầm', 'measurement', true, 3, 'TCVN 4453:1995', '± 10mm'),
  ('a1000000-0000-0000-0000-000000000003', 'technical_standard', 'Độ võng cốp pha', 'measurement', true, 4, 'TCVN 4453:1995', '≤ L/400');

-- 4. SÀN
INSERT INTO inspection_templates (id, code, name, category, version) VALUES
  ('a1000000-0000-0000-0000-000000000004', 'TPL-SAN-01', 'Nghiệm thu sàn', 'san', 1);

INSERT INTO inspection_template_items (template_id, section, item_name, item_type, required, sort_order, standard_code, required_value) VALUES
  ('a1000000-0000-0000-0000-000000000004', 'preparation', 'Kiểm tra cốp pha sàn (độ phẳng, chống đỡ)', 'checkbox', true, 1, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000004', 'preparation', 'Kiểm tra cốt thép sàn (lớp dưới, lớp trên)', 'checkbox', true, 2, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000004', 'preparation', 'Kiểm tra hộp kỹ thuật / lỗ chờ MEP', 'checkbox', true, 3, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000004', 'preparation', 'Vệ sinh bề mặt cốp pha', 'checkbox', true, 4, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000004', 'technical_standard', 'Cường độ bê tông', 'measurement', true, 1, 'TCVN 4453:1995', '≥ 250 kg/cm²'),
  ('a1000000-0000-0000-0000-000000000004', 'technical_standard', 'Chiều dày sàn', 'measurement', true, 2, 'TCVN 4453:1995', '± 5mm'),
  ('a1000000-0000-0000-0000-000000000004', 'technical_standard', 'Độ phẳng bề mặt', 'measurement', true, 3, 'TCVN 4453:1995', '≤ 5mm/2m'),
  ('a1000000-0000-0000-0000-000000000004', 'technical_standard', 'Lớp bảo vệ cốt thép', 'measurement', true, 4, 'TCVN 4453:1995', '≥ 15mm');

-- 5. TƯỜNG
INSERT INTO inspection_templates (id, code, name, category, version) VALUES
  ('a1000000-0000-0000-0000-000000000005', 'TPL-TUONG-01', 'Nghiệm thu tường xây', 'tuong', 1);

INSERT INTO inspection_template_items (template_id, section, item_name, item_type, required, sort_order, standard_code, required_value) VALUES
  ('a1000000-0000-0000-0000-000000000005', 'preparation', 'Kiểm tra vật liệu xây (gạch, vữa)', 'checkbox', true, 1, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000005', 'preparation', 'Kiểm tra mạch lưới thép gia cường', 'checkbox', true, 2, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000005', 'preparation', 'Tưới ẩm gạch trước khi xây', 'checkbox', true, 3, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000005', 'technical_standard', 'Độ phẳng bề mặt tường', 'measurement', true, 1, 'TCVN 4085:2011', '≤ 5mm/2m'),
  ('a1000000-0000-0000-0000-000000000005', 'technical_standard', 'Độ thẳng đứng', 'measurement', true, 2, 'TCVN 4085:2011', '≤ 10mm/3m'),
  ('a1000000-0000-0000-0000-000000000005', 'technical_standard', 'Chiều dày mạch vữa', 'measurement', true, 3, 'TCVN 4085:2011', '8-12mm');

-- 6. KẾT CẤU THÉP
INSERT INTO inspection_templates (id, code, name, category, version) VALUES
  ('a1000000-0000-0000-0000-000000000006', 'TPL-THEP-01', 'Nghiệm thu kết cấu thép', 'ket_cau_thep', 1);

INSERT INTO inspection_template_items (template_id, section, item_name, item_type, required, sort_order, standard_code, required_value) VALUES
  ('a1000000-0000-0000-0000-000000000006', 'preparation', 'Kiểm tra chứng chỉ vật liệu thép', 'checkbox', true, 1, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000006', 'preparation', 'Kiểm tra mối hàn (ngoại quan)', 'checkbox', true, 2, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000006', 'preparation', 'Kiểm tra bu-lông liên kết', 'checkbox', true, 3, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000006', 'preparation', 'Kiểm tra sơn chống gỉ', 'checkbox', true, 4, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000006', 'technical_standard', 'Chiều cao mối hàn', 'measurement', true, 1, 'TCVN 1691:1975', 'Theo bản vẽ'),
  ('a1000000-0000-0000-0000-000000000006', 'technical_standard', 'Sai số lắp đặt', 'measurement', true, 2, 'TCVN 170:2007', '± 3mm'),
  ('a1000000-0000-0000-0000-000000000006', 'technical_standard', 'Độ thẳng đứng cột thép', 'measurement', true, 3, 'TCVN 170:2007', '≤ H/750'),
  ('a1000000-0000-0000-0000-000000000006', 'technical_standard', 'Moment xiết bu-lông', 'measurement', true, 4, NULL, 'Theo thiết kế');

-- 7. MÁI
INSERT INTO inspection_templates (id, code, name, category, version) VALUES
  ('a1000000-0000-0000-0000-000000000007', 'TPL-MAI-01', 'Nghiệm thu mái', 'mai', 1);

INSERT INTO inspection_template_items (template_id, section, item_name, item_type, required, sort_order, standard_code, required_value) VALUES
  ('a1000000-0000-0000-0000-000000000007', 'preparation', 'Kiểm tra kết cấu đỡ mái', 'checkbox', true, 1, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000007', 'preparation', 'Kiểm tra lớp chống thấm', 'checkbox', true, 2, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000007', 'preparation', 'Kiểm tra hệ thống thoát nước mái', 'checkbox', true, 3, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000007', 'technical_standard', 'Độ dốc mái', 'measurement', true, 1, NULL, 'Theo thiết kế'),
  ('a1000000-0000-0000-0000-000000000007', 'technical_standard', 'Chồng mí tôn/ngói', 'measurement', true, 2, NULL, '≥ 150mm'),
  ('a1000000-0000-0000-0000-000000000007', 'technical_standard', 'Khe hở tại mối nối', 'measurement', true, 3, NULL, '≤ 2mm');

-- 8. PANEL
INSERT INTO inspection_templates (id, code, name, category, version) VALUES
  ('a1000000-0000-0000-0000-000000000008', 'TPL-PANEL-01', 'Nghiệm thu panel', 'panel', 1);

INSERT INTO inspection_template_items (template_id, section, item_name, item_type, required, sort_order, standard_code, required_value) VALUES
  ('a1000000-0000-0000-0000-000000000008', 'preparation', 'Kiểm tra vật liệu panel (chứng chỉ)', 'checkbox', true, 1, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000008', 'preparation', 'Kiểm tra khung đỡ panel', 'checkbox', true, 2, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000008', 'preparation', 'Kiểm tra phụ kiện liên kết', 'checkbox', true, 3, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000008', 'technical_standard', 'Sai số lắp đặt mặt phẳng', 'measurement', true, 1, NULL, '± 3mm'),
  ('a1000000-0000-0000-0000-000000000008', 'technical_standard', 'Khe hở mối nối', 'measurement', true, 2, NULL, '≤ 2mm'),
  ('a1000000-0000-0000-0000-000000000008', 'technical_standard', 'Độ kín mối nối (silicon)', 'measurement', true, 3, NULL, 'Kín hoàn toàn');

-- =====================================================================
-- Thêm cột mới vào quality_checklists cho template-based inspection
-- =====================================================================
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS template_code TEXT;
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS template_name TEXT;
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS template_version INTEGER;
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS inspection_result TEXT;  -- 'PASSED' | 'FAILED'
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS total_criteria INTEGER DEFAULT 0;
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS passed_criteria INTEGER DEFAULT 0;
ALTER TABLE quality_checklists ADD COLUMN IF NOT EXISTS failed_criteria INTEGER DEFAULT 0;

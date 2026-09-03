-- =====================================================================
-- Module Quản lý Chất lượng (Quality Management)
-- 2 bảng: quality_checklist_templates (admin tùy biến) + quality_checklists (hồ sơ CL)
-- =====================================================================

-- 1. Template tùy biến — Admin tạo template cho từng loại công việc
CREATE TABLE IF NOT EXISTS quality_checklist_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID,
  construction_site_id UUID,
  name TEXT NOT NULL,                     -- 'Đổ bê tông móng', 'Cốt thép cột'
  code TEXT,                              -- 'TPL-BT-01'
  category TEXT,                          -- 'concrete' | 'steel' | 'earthwork' | 'general'
  description TEXT,

  -- 6 section defaults (JSONB cho linh hoạt)
  preparation_items JSONB DEFAULT '[]',   -- [{item: 'Mặt bằng đã dọn dẹp', required: true}]
  technical_standards JSONB DEFAULT '[]', -- [{standardCode, name, requiredValue, unit}]
  default_photos_required INTEGER DEFAULT 0,
  instructions TEXT,                      -- Hướng dẫn thực hiện

  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Hồ sơ chất lượng — gắn trực tiếp vào task / contract item
CREATE TABLE IF NOT EXISTS quality_checklists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Scope
  project_id UUID,
  construction_site_id UUID NOT NULL,

  -- Liên kết chính (ít nhất 1)
  task_id UUID,                           -- FK → project_tasks
  contract_item_id UUID,                  -- FK → contract_items (customer)
  daily_log_id UUID,                      -- FK → daily_logs (nguồn hình ảnh)
  template_id UUID REFERENCES quality_checklist_templates(id),

  -- Metadata
  code TEXT NOT NULL,                     -- 'QC-001', auto-gen
  title TEXT NOT NULL,                    -- 'Kiểm tra CL - Đào đất móng M1'

  -- 1. Thông tin công việc
  work_description TEXT,
  work_location TEXT,
  work_date DATE,
  work_supervisor TEXT,

  -- 2. Công tác chuẩn bị
  preparation_checklist JSONB DEFAULT '[]',   -- [{item, checked, note}]
  preparation_result TEXT,                    -- 'pass' | 'fail' | 'conditional'

  -- 3. Tiêu chuẩn kỹ thuật
  technical_standards JSONB DEFAULT '[]',     -- [{standardCode, name, requiredValue, actualValue, unit, result}]
  technical_result TEXT,                      -- 'pass' | 'fail' | 'conditional'

  -- 4. Hình ảnh hiện trường
  site_photos JSONB DEFAULT '[]',             -- [{url, caption, category, takenAt}]

  -- 5. Tài liệu đính kèm
  attachments JSONB DEFAULT '[]',             -- Attachment[]

  -- 6. Kết luận nghiệm thu
  conclusion TEXT,
  conclusion_result TEXT,                     -- 'accepted' | 'conditional' | 'rejected'
  conditions TEXT,
  inspector_name TEXT,
  inspector_sign_url TEXT,
  approver_name TEXT,
  approver_sign_url TEXT,

  -- Workflow (ProjectSubmissionFields pattern)
  status TEXT DEFAULT 'draft' NOT NULL,
  submitted_by TEXT,
  submitted_at TIMESTAMPTZ,
  submitted_to_user_id TEXT,
  submitted_to_name TEXT,
  submitted_to_permission TEXT,
  submission_note TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  returned_by TEXT,
  returned_at TIMESTAMPTZ,
  return_reason TEXT,
  last_action_by TEXT,
  last_action_at TIMESTAMPTZ,

  -- Cross-references (for AI lifecycle analysis)
  linked_acceptance_id UUID,
  linked_payment_cert_id UUID,
  linked_material_request_ids UUID[],
  linked_po_ids UUID[],

  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_quality_checklists_site
  ON quality_checklists (construction_site_id, status);
CREATE INDEX IF NOT EXISTS idx_quality_checklists_task
  ON quality_checklists (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quality_checklists_contract_item
  ON quality_checklists (contract_item_id) WHERE contract_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quality_templates_site
  ON quality_checklist_templates (construction_site_id);

-- RLS
ALTER TABLE quality_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quality_checklist_templates_all"
  ON quality_checklist_templates FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "quality_checklists_all"
  ON quality_checklists FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

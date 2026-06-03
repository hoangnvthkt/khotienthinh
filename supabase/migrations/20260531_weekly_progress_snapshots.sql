-- weekly_progress_snapshots: lưu snapshot tiến độ theo tuần cho biểu đồ trend
-- Mỗi tuần mỗi dự án chỉ có 1 record (upsert trên scope_key + week_start)

CREATE TABLE IF NOT EXISTS weekly_progress_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scope_key TEXT NOT NULL,
  project_id UUID,
  construction_site_id UUID,
  week_label TEXT NOT NULL,           -- 'W22/2026'
  week_start DATE NOT NULL,           -- Ngày thứ Hai đầu tuần
  progress_percent NUMERIC DEFAULT 0, -- % tiến độ tại thời điểm snapshot
  progress_mode TEXT DEFAULT 'gantt_weighted',
  supplied_value NUMERIC,             -- Giá trị VT đã cấp (contract_value mode)
  contract_total_value NUMERIC,       -- Tổng GT hợp đồng (contract_value mode)
  gantt_percent NUMERIC,              -- % tiến độ Gantt tham khảo
  calculated_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT weekly_progress_snapshots_scope_week_unique UNIQUE (scope_key, week_start)
);

-- Index cho query nhanh theo scope_key
CREATE INDEX IF NOT EXISTS idx_weekly_progress_snapshots_scope
  ON weekly_progress_snapshots (scope_key, week_start);

-- RLS: cho phép authenticated users CRUD
ALTER TABLE weekly_progress_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weekly_progress_snapshots_all"
  ON weekly_progress_snapshots
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

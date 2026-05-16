-- Project master categories used by the DA project creation flow.
-- These are public app master-data tables, exposed through Supabase Data API
-- with the same permissive policy model currently used by projects.

CREATE TABLE IF NOT EXISTS public.project_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.project_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.project_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);



CREATE INDEX IF NOT EXISTS idx_project_groups_active_sort
  ON public.project_groups (is_active, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_project_types_active_sort
  ON public.project_types (is_active, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_project_sectors_active_sort
  ON public.project_sectors (is_active, sort_order, name);

DROP TRIGGER IF EXISTS trg_project_groups_updated_at ON public.project_groups;
CREATE TRIGGER trg_project_groups_updated_at
  BEFORE UPDATE ON public.project_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_project_types_updated_at ON public.project_types;
CREATE TRIGGER trg_project_types_updated_at
  BEFORE UPDATE ON public.project_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_project_sectors_updated_at ON public.project_sectors;
CREATE TRIGGER trg_project_sectors_updated_at
  BEFORE UPDATE ON public.project_sectors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.project_groups (code, name, description, sort_order, is_active)
VALUES ('construction', 'Dự án thi công', 'Nhóm mặc định cho các dự án thi công', 10, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

INSERT INTO public.project_types (code, name, description, sort_order, is_active)
VALUES
  ('actual', 'Dự án thực tế', 'Dự án triển khai thực tế', 10, true),
  ('template', 'Dự án mẫu', 'Dự án dùng làm mẫu cấu hình', 20, true),
  ('construction', 'Thi công xây dựng', 'Dự án thi công xây dựng', 30, true),
  ('infrastructure', 'Hạ tầng', 'Dự án hạ tầng', 40, true),
  ('maintenance', 'Bảo trì', 'Dự án bảo trì, sửa chữa', 50, true),
  ('other', 'Khác', 'Loại dự án khác', 90, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

INSERT INTO public.project_sectors (code, name, description, sort_order, is_active)
VALUES
  ('civil', 'Dân dụng', 'Công trình dân dụng', 10, true),
  ('industrial', 'Công nghiệp', 'Công trình công nghiệp', 20, true),
  ('infrastructure', 'Hạ tầng', 'Hạ tầng kỹ thuật', 30, true),
  ('mep', 'MEP', 'Cơ điện, cấp thoát nước, HVAC', 40, true),
  ('interior', 'Nội thất', 'Hoàn thiện, nội thất', 50, true),
  ('transport', 'Giao thông', 'Đường, cầu, hạ tầng giao thông', 60, true),
  ('irrigation', 'Thủy lợi', 'Thủy lợi, cấp thoát nước ngoài nhà', 70, true),
  ('other', 'Khác', 'Lĩnh vực khác', 90, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_group_id uuid REFERENCES public.project_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_type_id uuid REFERENCES public.project_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_sector_id uuid REFERENCES public.project_sectors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_template_id uuid;

CREATE INDEX IF NOT EXISTS idx_projects_project_group_id
  ON public.projects(project_group_id);
CREATE INDEX IF NOT EXISTS idx_projects_project_type_id
  ON public.projects(project_type_id);
CREATE INDEX IF NOT EXISTS idx_projects_project_sector_id
  ON public.projects(project_sector_id);
CREATE INDEX IF NOT EXISTS idx_projects_workflow_template_id
  ON public.projects(workflow_template_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_groups TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_types TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_sectors TO anon, authenticated;

ALTER TABLE public.project_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_sectors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_groups_select" ON public.project_groups;
CREATE POLICY "project_groups_select" ON public.project_groups
  FOR SELECT TO public
  USING (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_groups_insert" ON public.project_groups;
CREATE POLICY "project_groups_insert" ON public.project_groups
  FOR INSERT TO public
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_groups_update" ON public.project_groups;
CREATE POLICY "project_groups_update" ON public.project_groups
  FOR UPDATE TO public
  USING (auth.role() IN ('anon', 'authenticated'))
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_groups_delete" ON public.project_groups;
CREATE POLICY "project_groups_delete" ON public.project_groups
  FOR DELETE TO public
  USING (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_types_select" ON public.project_types;
CREATE POLICY "project_types_select" ON public.project_types
  FOR SELECT TO public
  USING (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_types_insert" ON public.project_types;
CREATE POLICY "project_types_insert" ON public.project_types
  FOR INSERT TO public
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_types_update" ON public.project_types;
CREATE POLICY "project_types_update" ON public.project_types
  FOR UPDATE TO public
  USING (auth.role() IN ('anon', 'authenticated'))
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_types_delete" ON public.project_types;
CREATE POLICY "project_types_delete" ON public.project_types
  FOR DELETE TO public
  USING (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_sectors_select" ON public.project_sectors;
CREATE POLICY "project_sectors_select" ON public.project_sectors
  FOR SELECT TO public
  USING (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_sectors_insert" ON public.project_sectors;
CREATE POLICY "project_sectors_insert" ON public.project_sectors
  FOR INSERT TO public
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_sectors_update" ON public.project_sectors;
CREATE POLICY "project_sectors_update" ON public.project_sectors
  FOR UPDATE TO public
  USING (auth.role() IN ('anon', 'authenticated'))
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "project_sectors_delete" ON public.project_sectors;
CREATE POLICY "project_sectors_delete" ON public.project_sectors
  FOR DELETE TO public
  USING (auth.role() IN ('anon', 'authenticated'));

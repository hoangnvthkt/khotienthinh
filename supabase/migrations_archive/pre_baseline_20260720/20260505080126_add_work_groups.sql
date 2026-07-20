-- Flexible work groups for snapshot-based project participant selection.
-- Groups are app master data; members store app user ids as text to match project_staff.user_id.

CREATE TABLE IF NOT EXISTS public.work_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  name text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.work_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  member_role text NOT NULL DEFAULT 'member',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CONSTRAINT chk_work_group_members_role CHECK (member_role IN ('lead', 'member'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_work_groups_code
  ON public.work_groups(code)
  WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_work_group_members_group_user
  ON public.work_group_members(group_id, user_id);

CREATE INDEX IF NOT EXISTS idx_work_groups_active_sort
  ON public.work_groups(is_active, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_work_group_members_group_active
  ON public.work_group_members(group_id, is_active);

CREATE INDEX IF NOT EXISTS idx_work_group_members_user_id
  ON public.work_group_members(user_id);

DROP TRIGGER IF EXISTS trg_work_groups_updated_at ON public.work_groups;
CREATE TRIGGER trg_work_groups_updated_at
  BEFORE UPDATE ON public.work_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_work_group_members_updated_at ON public.work_group_members;
CREATE TRIGGER trg_work_group_members_updated_at
  BEFORE UPDATE ON public.work_group_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_groups TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_group_members TO anon, authenticated;

ALTER TABLE public.work_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_groups_select" ON public.work_groups;
CREATE POLICY "work_groups_select" ON public.work_groups
  FOR SELECT TO public
  USING (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "work_groups_insert" ON public.work_groups;
CREATE POLICY "work_groups_insert" ON public.work_groups
  FOR INSERT TO public
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "work_groups_update" ON public.work_groups;
CREATE POLICY "work_groups_update" ON public.work_groups
  FOR UPDATE TO public
  USING (auth.role() IN ('anon', 'authenticated'))
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "work_groups_delete" ON public.work_groups;
CREATE POLICY "work_groups_delete" ON public.work_groups
  FOR DELETE TO public
  USING (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "work_group_members_select" ON public.work_group_members;
CREATE POLICY "work_group_members_select" ON public.work_group_members
  FOR SELECT TO public
  USING (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "work_group_members_insert" ON public.work_group_members;
CREATE POLICY "work_group_members_insert" ON public.work_group_members
  FOR INSERT TO public
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "work_group_members_update" ON public.work_group_members;
CREATE POLICY "work_group_members_update" ON public.work_group_members
  FOR UPDATE TO public
  USING (auth.role() IN ('anon', 'authenticated'))
  WITH CHECK (auth.role() IN ('anon', 'authenticated'));

DROP POLICY IF EXISTS "work_group_members_delete" ON public.work_group_members;
CREATE POLICY "work_group_members_delete" ON public.work_group_members
  FOR DELETE TO public
  USING (auth.role() IN ('anon', 'authenticated'));

-- Harden Project PBAC and task notification metadata.
-- Scope:
--   - Ensure permission master data exists and is unique by code.
--   - Add active-staff indexes for project/site permission checks.
--   - Add project_tasks.assignee_user_id for structured task assignment.
--   - Add an atomic permission replacement RPC used by projectStaffService.

DO $$
BEGIN
  IF to_regclass('public.project_permission_types') IS NOT NULL THEN
    DELETE FROM public.project_permission_types a
    USING public.project_permission_types b
    WHERE a.code = b.code
      AND a.ctid < b.ctid;

    CREATE UNIQUE INDEX IF NOT EXISTS ux_project_permission_types_code
      ON public.project_permission_types(code);

    INSERT INTO public.project_permission_types (code, name, module, description, sort_order, is_active)
    VALUES
      ('view', 'Xem dữ liệu', NULL, 'Xem dữ liệu dự án', 0, TRUE),
      ('edit', 'Sửa dữ liệu', NULL, 'Tạo, sửa, xoá dữ liệu dự án', 1, TRUE),
      ('submit', 'Gửi yêu cầu', NULL, 'Gửi nhật ký, nghiệm thu, gate hoặc chứng từ vào luồng xử lý', 2, TRUE),
      ('verify', 'Xác nhận kết quả', 'daily_log', 'Xác nhận hoặc trả lại nhật ký/kết quả kỹ thuật', 3, TRUE),
      ('confirm', 'Xác nhận nghiệp vụ', NULL, 'Xác nhận nghiệp vụ, khối lượng hoặc thanh toán nội bộ', 4, TRUE),
      ('approve', 'Phê duyệt', NULL, 'Phê duyệt cuối hoặc từ chối luồng duyệt', 5, TRUE)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      module = EXCLUDED.module,
      description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order,
      is_active = TRUE;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.project_staff') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_project_staff_project_user_active
      ON public.project_staff(project_id, user_id)
      WHERE end_date IS NULL;

    CREATE INDEX IF NOT EXISTS idx_project_staff_site_user_active
      ON public.project_staff(construction_site_id, user_id)
      WHERE end_date IS NULL;
  END IF;

  IF to_regclass('public.project_staff_permissions') IS NOT NULL THEN
    DELETE FROM public.project_staff_permissions a
    USING public.project_staff_permissions b
    WHERE a.staff_id = b.staff_id
      AND a.permission_type_id = b.permission_type_id
      AND a.ctid < b.ctid;

    CREATE UNIQUE INDEX IF NOT EXISTS ux_project_staff_permissions_staff_type
      ON public.project_staff_permissions(staff_id, permission_type_id);

    CREATE INDEX IF NOT EXISTS idx_project_staff_permissions_active
      ON public.project_staff_permissions(staff_id, permission_type_id)
      WHERE is_active = TRUE;
  END IF;

  IF to_regclass('public.project_tasks') IS NOT NULL THEN
    ALTER TABLE public.project_tasks
      ADD COLUMN IF NOT EXISTS assignee_user_id text;

    CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee_user_id
      ON public.project_tasks(assignee_user_id);
  END IF;
END;
$$;

DO $$
DECLARE
  staff_id_type text;
  permission_type_id_type text;
  granted_by_type text;
BEGIN
  IF to_regclass('public.project_staff_permissions') IS NULL THEN
    RETURN;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod)
  INTO staff_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.project_staff_permissions'::regclass
    AND a.attname = 'staff_id'
    AND NOT a.attisdropped;

  SELECT format_type(a.atttypid, a.atttypmod)
  INTO permission_type_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.project_staff_permissions'::regclass
    AND a.attname = 'permission_type_id'
    AND NOT a.attisdropped;

  SELECT format_type(a.atttypid, a.atttypmod)
  INTO granted_by_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.project_staff_permissions'::regclass
    AND a.attname = 'granted_by'
    AND NOT a.attisdropped;

  IF staff_id_type IS NULL OR permission_type_id_type IS NULL THEN
    RETURN;
  END IF;

  granted_by_type := COALESCE(granted_by_type, 'text');

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.replace_project_staff_permissions(
      p_staff_id %1$s,
      p_permission_type_ids %2$s[],
      p_granted_by %3$s DEFAULT NULL
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = public
    AS $body$
    BEGIN
      DELETE FROM public.project_staff_permissions
      WHERE staff_id = p_staff_id;

      IF COALESCE(array_length(p_permission_type_ids, 1), 0) > 0 THEN
        INSERT INTO public.project_staff_permissions (
          staff_id,
          permission_type_id,
          is_active,
          granted_by
        )
        SELECT
          p_staff_id,
          permission_type_id,
          TRUE,
          p_granted_by
        FROM unnest(p_permission_type_ids) AS permission_type_id;
      END IF;
    END;
    $body$;
  $fn$, staff_id_type, permission_type_id_type, granted_by_type);

  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION public.replace_project_staff_permissions(%s, %s[], %s) TO authenticated',
    staff_id_type,
    permission_type_id_type,
    granted_by_type
  );
END;
$$;

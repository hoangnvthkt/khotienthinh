-- RPC to upsert an attendance record, handling both id conflicts and
-- (employeeId, date) conflicts atomically inside PL/pgSQL.
-- This bypasses the PostgREST PGRST102 "Empty or invalid json" bug
-- that occurs when using .upsert() with camelCase column names in
-- Supabase JS SDK v2.x.

CREATE OR REPLACE FUNCTION public.upsert_hrm_attendance(
  p_id uuid,
  p_employee_id uuid,
  p_date text,
  p_status text,
  p_check_in text DEFAULT NULL,
  p_check_out text DEFAULT NULL,
  p_overtime_hours numeric DEFAULT 0,
  p_construction_site_id text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_check_in_photo text DEFAULT NULL,
  p_check_out_photo text DEFAULT NULL,
  p_check_in_lat double precision DEFAULT NULL,
  p_check_in_lng double precision DEFAULT NULL,
  p_check_out_lat double precision DEFAULT NULL,
  p_check_out_lng double precision DEFAULT NULL,
  p_location_name text DEFAULT NULL,
  p_location_type text DEFAULT NULL,
  p_is_out_of_range boolean DEFAULT false,
  p_created_at timestamptz DEFAULT now()
)
RETURNS public.hrm_attendance
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_row public.hrm_attendance;
BEGIN
  BEGIN
    INSERT INTO public.hrm_attendance (
      id, "employeeId", date, status,
      "checkIn", "checkOut", "overtimeHours",
      "constructionSiteId", note,
      "checkInPhoto", "checkOutPhoto",
      "checkInLat", "checkInLng",
      "checkOutLat", "checkOutLng",
      "locationName", "locationType",
      "isOutOfRange", "createdAt"
    ) VALUES (
      p_id, p_employee_id, p_date, p_status,
      p_check_in, p_check_out, p_overtime_hours,
      p_construction_site_id, p_note,
      p_check_in_photo, p_check_out_photo,
      p_check_in_lat, p_check_in_lng,
      p_check_out_lat, p_check_out_lng,
      p_location_name, p_location_type,
      p_is_out_of_range, p_created_at
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- Record exists (by id OR by employeeId+date) — update it
    UPDATE public.hrm_attendance SET
      "checkIn"            = COALESCE(p_check_in,              "checkIn"),
      "checkOut"           = COALESCE(p_check_out,             "checkOut"),
      status               = p_status,
      "overtimeHours"      = p_overtime_hours,
      "constructionSiteId" = COALESCE(p_construction_site_id,  "constructionSiteId"),
      note                 = COALESCE(p_note, note),
      "checkInPhoto"       = COALESCE(p_check_in_photo,        "checkInPhoto"),
      "checkOutPhoto"      = COALESCE(p_check_out_photo,       "checkOutPhoto"),
      "checkInLat"         = COALESCE(p_check_in_lat,          "checkInLat"),
      "checkInLng"         = COALESCE(p_check_in_lng,          "checkInLng"),
      "checkOutLat"        = COALESCE(p_check_out_lat,         "checkOutLat"),
      "checkOutLng"        = COALESCE(p_check_out_lng,         "checkOutLng"),
      "locationName"       = COALESCE(p_location_name,         "locationName"),
      "locationType"       = COALESCE(p_location_type,         "locationType"),
      "isOutOfRange"       = p_is_out_of_range
    WHERE id = p_id
       OR ("employeeId" = p_employee_id AND date = p_date)
    RETURNING * INTO v_row;
  END;

  RETURN v_row;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.upsert_hrm_attendance(
  uuid, uuid, text, text,
  text, text, numeric,
  text, text,
  text, text,
  double precision, double precision,
  double precision, double precision,
  text, text, boolean, timestamptz
) TO authenticated;

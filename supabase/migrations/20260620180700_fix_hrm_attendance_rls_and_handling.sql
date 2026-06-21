-- Fix hrm_attendance UPDATE RLS policy to allow employees to update their own attendance records
DROP POLICY IF EXISTS attendance_update ON public.hrm_attendance;

CREATE POLICY attendance_update ON public.hrm_attendance
FOR UPDATE
TO public
USING (
  is_admin() OR 
  ("employeeId" IN (SELECT id FROM public.employees WHERE user_id = public.current_app_user_id()))
);

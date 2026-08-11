-- ============================================================================
-- Migration 4: Vehicle Booking Jobs (Feedback Auto-close & Notification Outbox Worker)
-- Date: 2026-08-12
-- Author: Vioo ERP System Architect
-- ============================================================================

-- 1. Function tự động đóng Feedback AUTO_CLOSED
CREATE OR REPLACE FUNCTION app_private.process_feedback_auto_close()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_hours integer;
  v_count integer := 0;
BEGIN
  SELECT feedback_auto_close_hours INTO v_hours FROM public.fleet_system_settings WHERE id = 1;
  v_hours := COALESCE(v_hours, 24);

  WITH closed AS (
    UPDATE public.vehicle_booking_feedback
    SET status = 'AUTO_CLOSED',
        updated_at = now()
    WHERE status = 'PENDING'
      AND created_at + (v_hours || ' hours')::interval <= now()
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM closed;

  RETURN v_count;
END;
$$;

-- Public Wrapper cho Auto-close Job
CREATE OR REPLACE FUNCTION public.process_vehicle_feedback_auto_close()
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN app_private.process_feedback_auto_close();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_vehicle_feedback_auto_close() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_vehicle_feedback_auto_close() TO authenticated;

-- 2. Outbox Worker Claim Function dùng FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION app_private.claim_notification_outbox_batch(
  p_batch_size integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  event_key text,
  recipient_user_id uuid,
  payload jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT o.id
    FROM app_private.vehicle_booking_notification_outbox o
    WHERE o.status = 'PENDING'
      AND o.available_at <= now()
    ORDER BY o.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE app_private.vehicle_booking_notification_outbox o
  SET status = 'PROCESSING',
      locked_at = now(),
      attempt_count = o.attempt_count + 1,
      updated_at = now()
  FROM claimed c
  WHERE o.id = c.id
  RETURNING o.id, o.event_key, o.recipient_user_id, o.payload;
END;
$$;

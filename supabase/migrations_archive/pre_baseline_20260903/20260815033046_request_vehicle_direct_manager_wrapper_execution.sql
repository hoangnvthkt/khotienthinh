begin;

create or replace function public.preview_vehicle_booking_submission_route()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.preview_vehicle_booking_submission_route_impl(
    public.current_app_user_id()
  );
$$;

create or replace function public.submit_vehicle_booking(
  p_booking_id uuid,
  p_confirm_missing_manager_bypass boolean default false
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app_private.command_submit_vehicle_booking(
    public.current_app_user_id(),
    p_booking_id,
    p_confirm_missing_manager_bypass
  );
$$;

create or replace function public.update_fleet_system_settings(
  p_booking_buffer_minutes integer,
  p_late_cancellation_cutoff_minutes integer,
  p_feedback_auto_close_hours integer,
  p_home_base_warning_radius_meters integer,
  p_on_time_tolerance_minutes integer,
  p_max_evidence_image_mb numeric,
  p_trip_reminder_minutes integer default 60,
  p_require_handover_for_self_drive boolean default true,
  p_allow_dispatch_approval_override boolean default true,
  p_require_direct_manager_approval boolean default true
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app_private.command_update_fleet_system_settings(
    public.current_app_user_id(),
    p_booking_buffer_minutes,
    p_late_cancellation_cutoff_minutes,
    p_feedback_auto_close_hours,
    p_home_base_warning_radius_meters,
    p_on_time_tolerance_minutes,
    p_max_evidence_image_mb,
    p_trip_reminder_minutes,
    p_require_handover_for_self_drive,
    p_allow_dispatch_approval_override,
    p_require_direct_manager_approval
  );
$$;

create or replace function public.reassign_vehicle_booking_manager(
  p_booking_id uuid,
  p_manager_user_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app_private.command_reassign_vehicle_booking_manager(
    public.current_app_user_id(),
    p_booking_id,
    p_manager_user_id,
    p_reason,
    p_expected_updated_at
  );
$$;

revoke all on function public.preview_vehicle_booking_submission_route()
  from public, anon;
grant execute on function public.preview_vehicle_booking_submission_route()
  to authenticated;
revoke all on function public.submit_vehicle_booking(uuid, boolean)
  from public, anon;
grant execute on function public.submit_vehicle_booking(uuid, boolean)
  to authenticated;
revoke all on function public.update_fleet_system_settings(
  integer, integer, integer, integer, integer, numeric, integer, boolean, boolean, boolean
) from public, anon;
grant execute on function public.update_fleet_system_settings(
  integer, integer, integer, integer, integer, numeric, integer, boolean, boolean, boolean
) to authenticated;
revoke all on function public.reassign_vehicle_booking_manager(
  uuid, uuid, text, timestamptz
) from public, anon;
grant execute on function public.reassign_vehicle_booking_manager(
  uuid, uuid, text, timestamptz
) to authenticated;

notify pgrst, 'reload schema';

commit;

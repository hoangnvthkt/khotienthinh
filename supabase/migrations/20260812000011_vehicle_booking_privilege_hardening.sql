-- Vehicle Booking Phase 2 privilege hardening.
-- RLS does not protect TRUNCATE, so all mutations remain RPC-only.

begin;

revoke insert, update, delete, truncate on table public.fleet_locations from anon, authenticated;
revoke insert, update, delete, truncate on table public.fleet_system_settings from anon, authenticated;
revoke insert, update, delete, truncate on table public.fleet_vehicle_profiles from anon, authenticated;
revoke insert, update, delete, truncate on table public.vehicle_driver_authorizations from anon, authenticated;
revoke insert, update, delete, truncate on table public.vehicle_unavailability_periods from anon, authenticated;
revoke insert, update, delete, truncate on table public.operator_unavailability_periods from anon, authenticated;
revoke insert, update, delete, truncate on table public.vehicle_bookings from anon, authenticated;
revoke insert, update, delete, truncate on table public.vehicle_booking_participants from anon, authenticated;
revoke insert, update, delete, truncate on table public.vehicle_booking_assignments from anon, authenticated;
revoke insert, update, delete, truncate on table public.vehicle_trip_logs from anon, authenticated;
revoke insert, update, delete, truncate on table public.vehicle_handover_logs from anon, authenticated;
revoke insert, update, delete, truncate on table public.vehicle_booking_issues from anon, authenticated;
revoke insert, update, delete, truncate on table public.vehicle_booking_feedback from anon, authenticated;
-- The eligibility view is read-only through the API as well.
revoke insert, update, delete, truncate on table public.vehicle_driver_authorizations_eligible_v from anon, authenticated;

commit;

-- Keep privileged read implementations outside the exposed public schema.
-- Public API signatures remain stable through SECURITY INVOKER wrappers.

begin;

alter function public.get_vehicle_booking_analytics(timestamptz, timestamptz, uuid)
  set schema app_private;
alter function app_private.get_vehicle_booking_analytics(timestamptz, timestamptz, uuid)
  rename to get_vehicle_booking_analytics_phase3_impl;
revoke all on function app_private.get_vehicle_booking_analytics_phase3_impl(
  timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function app_private.get_vehicle_booking_analytics_phase3_impl(
  timestamptz, timestamptz, uuid
) to authenticated;

create or replace function public.get_vehicle_booking_analytics(
  p_from_at timestamptz,
  p_to_at timestamptz,
  p_department_id uuid default null
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_vehicle_booking_analytics_phase3_impl(
    p_from_at, p_to_at, p_department_id
  );
$$;

revoke all on function public.get_vehicle_booking_analytics(
  timestamptz, timestamptz, uuid
) from public, anon;
grant execute on function public.get_vehicle_booking_analytics(
  timestamptz, timestamptz, uuid
) to authenticated;

alter function public.export_vehicle_booking_analytics(timestamptz, timestamptz, uuid)
  set schema app_private;
alter function app_private.export_vehicle_booking_analytics(timestamptz, timestamptz, uuid)
  rename to export_vehicle_booking_analytics_phase3_impl;
revoke all on function app_private.export_vehicle_booking_analytics_phase3_impl(
  timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function app_private.export_vehicle_booking_analytics_phase3_impl(
  timestamptz, timestamptz, uuid
) to authenticated;

create or replace function public.export_vehicle_booking_analytics(
  p_from_at timestamptz,
  p_to_at timestamptz,
  p_department_id uuid default null
) returns table (
  booking_id uuid,
  booking_code text,
  department_id uuid,
  department_name text,
  requested_pickup_at timestamptz,
  actual_pickup_at timestamptz,
  actual_return_at timestamptz,
  fulfillment_type text,
  vehicle_code text,
  vehicle_name text,
  distance_km numeric,
  external_actual_cost numeric,
  status text,
  close_reason text,
  is_on_time boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.export_vehicle_booking_analytics_phase3_impl(
    p_from_at, p_to_at, p_department_id
  );
$$;

revoke all on function public.export_vehicle_booking_analytics(
  timestamptz, timestamptz, uuid
) from public, anon;
grant execute on function public.export_vehicle_booking_analytics(
  timestamptz, timestamptz, uuid
) to authenticated;

alter function public.get_vehicle_booking_issues(text, integer, timestamptz, uuid)
  set schema app_private;
alter function app_private.get_vehicle_booking_issues(text, integer, timestamptz, uuid)
  rename to get_vehicle_booking_issues_phase3_impl;
revoke all on function app_private.get_vehicle_booking_issues_phase3_impl(
  text, integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function app_private.get_vehicle_booking_issues_phase3_impl(
  text, integer, timestamptz, uuid
) to authenticated;

create or replace function public.get_vehicle_booking_issues(
  p_status text default null,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_vehicle_booking_issues_phase3_impl(
    p_status, p_limit, p_cursor_created_at, p_cursor_id
  );
$$;

revoke all on function public.get_vehicle_booking_issues(
  text, integer, timestamptz, uuid
) from public, anon;
grant execute on function public.get_vehicle_booking_issues(
  text, integer, timestamptz, uuid
) to authenticated;

alter function public.get_vehicle_booking_audit_timeline(
  uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text
) set schema app_private;
alter function app_private.get_vehicle_booking_audit_timeline(
  uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text
) rename to get_vehicle_booking_audit_timeline_phase3_impl;
revoke all on function app_private.get_vehicle_booking_audit_timeline_phase3_impl(
  uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text
) from public, anon, authenticated;
grant execute on function app_private.get_vehicle_booking_audit_timeline_phase3_impl(
  uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text
) to authenticated;

create or replace function public.get_vehicle_booking_audit_timeline(
  p_booking_id uuid default null,
  p_department_id uuid default null,
  p_event_type text default null,
  p_from_at timestamptz default null,
  p_to_at timestamptz default null,
  p_limit integer default 50,
  p_cursor_occurred_at timestamptz default null,
  p_cursor_id text default null
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_vehicle_booking_audit_timeline_phase3_impl(
    p_booking_id,
    p_department_id,
    p_event_type,
    p_from_at,
    p_to_at,
    p_limit,
    p_cursor_occurred_at,
    p_cursor_id
  );
$$;

revoke all on function public.get_vehicle_booking_audit_timeline(
  uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text
) from public, anon;
grant execute on function public.get_vehicle_booking_audit_timeline(
  uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text
) to authenticated;

commit;

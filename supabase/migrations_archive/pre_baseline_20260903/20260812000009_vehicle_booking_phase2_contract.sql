-- Phase 2 frontend contract: routes, settings RPC, override enforcement.

update public.permission_modules
set routes = array[
      '/booking/vehicle',
      '/booking/vehicle/my',
      '/booking/vehicle/approvals',
      '/booking/vehicle/dispatch',
      '/booking/vehicle/trips',
      '/booking/vehicle/handover',
      '/booking/vehicle/fleet',
      '/booking/vehicle/drivers',
      '/booking/vehicle/reports',
      '/booking/vehicle/settings'
    ]::text[],
    updated_at = now()
where code = 'resource_booking.vehicle';

alter table public.fleet_system_settings
  add column if not exists trip_reminder_minutes integer not null default 60,
  add column if not exists require_handover_for_self_drive boolean not null default true,
  add column if not exists allow_dispatch_approval_override boolean not null default true;

drop function if exists public.update_fleet_system_settings(integer, integer, integer, integer, integer, numeric);
drop function if exists app_private.command_update_fleet_system_settings(uuid, integer, integer, integer, integer, integer, numeric);

create or replace function app_private.command_update_fleet_system_settings(
  p_actor_user_id uuid,
  p_booking_buffer_minutes integer,
  p_late_cancellation_cutoff_minutes integer,
  p_feedback_auto_close_hours integer,
  p_home_base_warning_radius_meters integer,
  p_on_time_tolerance_minutes integer,
  p_max_evidence_image_mb numeric,
  p_trip_reminder_minutes integer default 60,
  p_require_handover_for_self_drive boolean default true,
  p_allow_dispatch_approval_override boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.admin') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED: Admin permission required to update system settings';
  end if;

  update public.fleet_system_settings
  set booking_buffer_minutes = p_booking_buffer_minutes,
      late_cancellation_cutoff_minutes = p_late_cancellation_cutoff_minutes,
      feedback_auto_close_hours = p_feedback_auto_close_hours,
      home_base_warning_radius_meters = p_home_base_warning_radius_meters,
      on_time_tolerance_minutes = p_on_time_tolerance_minutes,
      max_evidence_image_mb = p_max_evidence_image_mb,
      trip_reminder_minutes = p_trip_reminder_minutes,
      require_handover_for_self_drive = p_require_handover_for_self_drive,
      allow_dispatch_approval_override = p_allow_dispatch_approval_override,
      updated_at = now()
  where id = 1;

  return jsonb_build_object('success', true);
end;
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
  p_allow_dispatch_approval_override boolean default true
) returns jsonb
language sql
security invoker
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
    p_allow_dispatch_approval_override
  );
$$;

revoke all on function public.update_fleet_system_settings(integer, integer, integer, integer, integer, numeric, integer, boolean, boolean) from public, anon;
grant execute on function public.update_fleet_system_settings(integer, integer, integer, integer, integer, numeric, integer, boolean, boolean) to authenticated;

create or replace function app_private.enforce_vehicle_dispatch_override_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_status text;
  v_override_allowed boolean;
begin
  select booking.status
  into v_booking_status
  from public.vehicle_bookings booking
  where booking.id = new.booking_id;

  if v_booking_status = 'PENDING_APPROVAL' then
    select coalesce(settings.allow_dispatch_approval_override, true)
    into v_override_allowed
    from public.fleet_system_settings settings
    where settings.id = 1;

    if not coalesce(v_override_allowed, true) then
      raise exception using errcode = 'P0001', message = 'DISPATCH_APPROVAL_OVERRIDE_DISABLED';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vehicle_dispatch_override_setting on public.vehicle_booking_assignments;
create trigger trg_vehicle_dispatch_override_setting
before insert on public.vehicle_booking_assignments
for each row execute function app_private.enforce_vehicle_dispatch_override_setting();

revoke all on function app_private.enforce_vehicle_dispatch_override_setting() from public, anon;

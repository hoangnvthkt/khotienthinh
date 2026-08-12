-- Vehicle Booking Phase 3A: permission and sensitive-data containment.
-- Additive Cloud migration; historical booking migrations remain immutable.

begin;

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
      '/booking/vehicle/issues',
      '/booking/vehicle/audit',
      '/booking/vehicle/settings'
    ]::text[],
    updated_at = now()
where code = 'resource_booking.vehicle';

insert into public.permission_actions (
  module_code,
  action,
  permission_code,
  label,
  scope_modes,
  legacy_module_key,
  legacy_route,
  legacy_admin_only,
  sort_order
) values
  (
    'resource_booking.vehicle',
    'resolve_sensitive_feedback',
    'booking.vehicle.resolve_sensitive_feedback',
    'Xử lý phản ánh nhạy cảm',
    array['global']::text[],
    'VEHICLE_BOOKING',
    '/booking/vehicle/issues',
    true,
    105
  ),
  (
    'resource_booking.vehicle',
    'view_audit',
    'booking.vehicle.view_audit',
    'Xem lịch sử vận hành đặt xe',
    array['global', 'department']::text[],
    'VEHICLE_BOOKING',
    '/booking/vehicle/audit',
    false,
    108
  )
on conflict (permission_code) do update
set label = excluded.label,
    scope_modes = excluded.scope_modes,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    updated_at = now();

update public.permission_actions
set legacy_route = '/booking/vehicle/issues',
    updated_at = now()
where permission_code = 'booking.vehicle.view_sensitive_feedback';

create or replace function app_private.vehicle_user_can_view_issue(
  p_user_id uuid,
  p_booking_id uuid,
  p_reporter_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and (
      p_user_id = p_reporter_user_id
      or app_private.vehicle_user_has_permission(
        p_user_id,
        'booking.vehicle.view_sensitive_feedback'
      )
    );
$$;

revoke all on function app_private.vehicle_user_can_view_issue(uuid, uuid, uuid)
  from public, anon;
grant execute on function app_private.vehicle_user_can_view_issue(uuid, uuid, uuid)
  to authenticated;

drop policy if exists p_vehicle_booking_issues_select on public.vehicle_booking_issues;
create policy p_vehicle_booking_issues_select
on public.vehicle_booking_issues
for select
to authenticated
using (
  app_private.vehicle_user_can_view_issue(
    (select public.current_app_user_id()),
    booking_id,
    reporter_user_id
  )
);

revoke insert, update, delete, truncate on public.vehicle_booking_issues
  from anon, authenticated;

-- Preserve legacy authenticated inserts/selects used by auditService, but
-- make the raw audit table immutable to browser clients and invisible to anon.
revoke select, insert, update, delete, truncate on public.audit_trail from anon;
revoke update, delete, truncate on public.audit_trail from authenticated;

commit;

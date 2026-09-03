-- Vehicle Booking Phase 1.1D: remove SECURITY DEFINER public views.

begin;

create or replace function app_private.vehicle_driver_authorizations_eligible_rows(
  p_actor_user_id uuid
) returns table (
  id uuid,
  user_id uuid,
  employee_id uuid,
  authorization_type text,
  license_class text,
  license_expiry date,
  allowed_vehicle_types text[],
  status text,
  is_eligible boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    vda.id,
    vda.user_id,
    vda.employee_id,
    vda.authorization_type,
    vda.license_class,
    vda.license_expiry,
    vda.allowed_vehicle_types,
    vda.status,
    (
      vda.status = 'ACTIVE'
      and vda.license_expiry >= current_date
      and (
        vda.health_check_expiry_date is null
        or vda.health_check_expiry_date >= current_date
      )
      and exists (
        select 1 from public.users u
        where u.id = vda.user_id
          and coalesce(u.is_active, true)
          and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
      )
    ) as is_eligible
  from public.vehicle_driver_authorizations vda
  where vda.user_id = p_actor_user_id
     or app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch')
     or app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.manage_authorizations');
$$;

create or replace function app_private.operator_unavailability_calendar_rows(
  p_actor_user_id uuid
) returns table (
  id uuid,
  operator_user_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    period.id,
    period.operator_user_id,
    period.start_at,
    period.end_at,
    period.created_at
  from public.operator_unavailability_periods period
  where period.operator_user_id = p_actor_user_id
     or app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.dispatch')
     or app_private.vehicle_user_has_permission(p_actor_user_id, 'booking.vehicle.manage_authorizations');
$$;

revoke all on function app_private.vehicle_driver_authorizations_eligible_rows(uuid) from public, anon;
revoke all on function app_private.operator_unavailability_calendar_rows(uuid) from public, anon;
grant execute on function app_private.vehicle_driver_authorizations_eligible_rows(uuid) to authenticated;
grant execute on function app_private.operator_unavailability_calendar_rows(uuid) to authenticated;

create or replace view public.vehicle_driver_authorizations_eligible_v
with (security_invoker = true, security_barrier = true) as
select *
from app_private.vehicle_driver_authorizations_eligible_rows(public.current_app_user_id());

create or replace view public.operator_unavailability_calendar_v
with (security_invoker = true, security_barrier = true) as
select *
from app_private.operator_unavailability_calendar_rows(public.current_app_user_id());

grant select on public.vehicle_driver_authorizations_eligible_v to authenticated;
grant select on public.operator_unavailability_calendar_v to authenticated;

commit;

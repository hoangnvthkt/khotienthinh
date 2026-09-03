begin;

create or replace function app_private.get_fleet_vehicle_type_options_impl(
  p_actor_user_id uuid
) returns table (
  vehicle_type text,
  vehicle_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is distinct from public.current_app_user_id() then
    perform app_private.vehicle_raise_permission_denied('Actor mismatch');
  end if;

  if not (
    app_private.vehicle_user_has_permission(
      p_actor_user_id,
      'booking.vehicle.manage_authorizations'
    )
    or app_private.vehicle_user_has_permission(
      p_actor_user_id,
      'booking.vehicle.manage_fleet'
    )
    or app_private.vehicle_user_has_permission(
      p_actor_user_id,
      'booking.vehicle.dispatch'
    )
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Vehicle type catalog permission required'
    );
  end if;

  return query
  select
    trim(profile.vehicle_type),
    count(*)::bigint
  from public.fleet_vehicle_profiles profile
  where nullif(trim(profile.vehicle_type), '') is not null
  group by trim(profile.vehicle_type)
  order by trim(profile.vehicle_type);
end;
$$;

create or replace function public.get_fleet_vehicle_type_options()
returns table (
  vehicle_type text,
  vehicle_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_fleet_vehicle_type_options_impl(
    public.current_app_user_id()
  );
$$;

create or replace function app_private.vehicle_assert_operator_eligible(
  p_operator_user_id uuid,
  p_authorization_type text,
  p_vehicle_type text
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_authorization public.vehicle_driver_authorizations%rowtype;
begin
  if not exists (
    select 1
    from public.users app_user
    where app_user.id = p_operator_user_id
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATOR_UNAVAILABLE';
  end if;

  select *
  into v_authorization
  from public.vehicle_driver_authorizations authorization_row
  where authorization_row.user_id = p_operator_user_id
    and authorization_row.authorization_type = p_authorization_type;

  if not found or v_authorization.status <> 'ACTIVE' then
    raise exception using errcode = 'P0001', message = case
      when p_authorization_type = 'SELF_DRIVE' then 'SELF_DRIVER_NOT_AUTHORIZED'
      else 'DRIVER_NOT_AUTHORIZED'
    end;
  end if;

  if v_authorization.license_expiry < current_date then
    raise exception using errcode = 'P0001', message = 'DRIVER_LICENSE_EXPIRED';
  end if;

  if v_authorization.health_check_expiry_date is not null
     and v_authorization.health_check_expiry_date < current_date then
    raise exception using errcode = 'P0001', message = 'OPERATOR_UNAVAILABLE';
  end if;

  if v_authorization.allowed_vehicle_types is null
     or not (p_vehicle_type = any(v_authorization.allowed_vehicle_types)) then
    raise exception using errcode = 'P0001', message = 'DRIVER_VEHICLE_TYPE_MISMATCH';
  end if;
end;
$$;

revoke all on function app_private.get_fleet_vehicle_type_options_impl(uuid)
  from public, anon;
grant execute on function app_private.get_fleet_vehicle_type_options_impl(uuid)
  to authenticated;

revoke all on function public.get_fleet_vehicle_type_options()
  from public, anon;
grant execute on function public.get_fleet_vehicle_type_options()
  to authenticated;

revoke all on function app_private.vehicle_assert_operator_eligible(uuid, text, text)
  from public, anon, authenticated;

commit;

begin;

-- Booking follows the application's system-admin contract: an active ADMIN has
-- every Booking capability without requiring duplicate granular grants.
create or replace function app_private.vehicle_user_has_scoped_permission(
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'global',
  p_scope_id text default '*'
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_active boolean := false;
  v_role text;
begin
  if p_user_id is null or nullif(trim(p_permission_code), '') is null then
    return false;
  end if;

  select
    coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE',
    app_user.role::text
  into v_is_active, v_role
  from public.users app_user
  where app_user.id = p_user_id;

  if not coalesce(v_is_active, false) then
    return false;
  end if;

  if v_role = 'ADMIN' then
    return true;
  end if;

  if p_permission_code in ('booking.vehicle.create', 'booking.vehicle.view_own') then
    return true;
  end if;

  return exists (
    select 1
    from public.user_permission_grants grant_row
    where grant_row.user_id = p_user_id
      and grant_row.permission_code in (p_permission_code, 'booking.vehicle.admin')
      and coalesce(grant_row.is_active, false)
      and grant_row.revoked_at is null
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and (
        grant_row.scope_type = 'global'
        or (
          grant_row.scope_type = coalesce(p_scope_type, 'global')
          and (
            grant_row.scope_id = '*'
            or grant_row.scope_id = coalesce(p_scope_id, '*')
          )
        )
      )
  );
end;
$$;

create or replace function app_private.get_fleet_vehicle_candidates_impl(
  p_actor_user_id uuid
) returns table (
  asset_id text,
  asset_code text,
  asset_name text,
  asset_image_url text,
  asset_brand text,
  asset_model text,
  category_name text
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

  if not app_private.vehicle_user_has_permission(
    p_actor_user_id,
    'booking.vehicle.manage_fleet'
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Fleet management permission required'
    );
  end if;

  return query
  select
    asset.id,
    asset.code,
    asset.name,
    asset.image_url,
    asset.brand,
    asset.model,
    category.name
  from public.assets asset
  join public.asset_categories category on category.id = asset.category_id
  where category.type = 'vehicle'
    and coalesce(asset.asset_type, 'single') = 'single'
    and asset.status::text <> 'DISPOSED'
    and not exists (
      select 1
      from public.fleet_vehicle_profiles profile
      where profile.asset_id = asset.id
    )
  order by asset.code, asset.name;
end;
$$;

create or replace function public.get_fleet_vehicle_candidates()
returns table (
  asset_id text,
  asset_code text,
  asset_name text,
  asset_image_url text,
  asset_brand text,
  asset_model text,
  category_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_fleet_vehicle_candidates_impl(
    public.current_app_user_id()
  );
$$;

create or replace function app_private.get_fleet_vehicle_profiles_admin_impl(
  p_actor_user_id uuid
) returns table (
  asset_id text,
  home_base_id uuid,
  vehicle_type text,
  seat_count integer,
  availability_status text,
  allow_self_drive boolean,
  current_odometer numeric,
  custody_status text,
  current_custody_assignment_id uuid,
  inspection_certificate_number text,
  inspection_expiry_date date,
  inspection_photo_path text,
  insurance_expiry_date date,
  parking_spot_code text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  asset_code text,
  asset_name text,
  asset_image_url text,
  asset_brand text,
  asset_model text,
  home_base_name text
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
      'booking.vehicle.manage_fleet'
    )
    or app_private.vehicle_user_has_permission(
      p_actor_user_id,
      'booking.vehicle.dispatch'
    )
    or app_private.vehicle_user_has_permission(
      p_actor_user_id,
      'booking.vehicle.create'
    )
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Fleet read permission required'
    );
  end if;

  return query
  select
    profile.asset_id,
    profile.home_base_id,
    profile.vehicle_type,
    profile.seat_count,
    profile.availability_status,
    profile.allow_self_drive,
    profile.current_odometer,
    profile.custody_status,
    profile.current_custody_assignment_id,
    profile.inspection_certificate_number,
    profile.inspection_expiry_date,
    profile.inspection_photo_path,
    profile.insurance_expiry_date,
    profile.parking_spot_code,
    profile.active,
    profile.created_at,
    profile.updated_at,
    asset.code,
    asset.name,
    asset.image_url,
    asset.brand,
    asset.model,
    home_base.name
  from public.fleet_vehicle_profiles profile
  join public.assets asset on asset.id = profile.asset_id
  left join public.fleet_locations home_base on home_base.id = profile.home_base_id
  order by asset.code, asset.name;
end;
$$;

create or replace function public.get_fleet_vehicle_profiles_admin()
returns table (
  asset_id text,
  home_base_id uuid,
  vehicle_type text,
  seat_count integer,
  availability_status text,
  allow_self_drive boolean,
  current_odometer numeric,
  custody_status text,
  current_custody_assignment_id uuid,
  inspection_certificate_number text,
  inspection_expiry_date date,
  inspection_photo_path text,
  insurance_expiry_date date,
  parking_spot_code text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  asset_code text,
  asset_name text,
  asset_image_url text,
  asset_brand text,
  asset_model text,
  home_base_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_fleet_vehicle_profiles_admin_impl(
    public.current_app_user_id()
  );
$$;

create or replace function app_private.get_vehicle_driver_candidates_impl(
  p_actor_user_id uuid
) returns table (
  employee_id uuid,
  user_id uuid,
  employee_code text,
  employee_name text,
  employee_title text,
  employee_avatar_url text,
  department_id uuid,
  authorization_count bigint
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

  if not app_private.vehicle_user_has_permission(
    p_actor_user_id,
    'booking.vehicle.manage_authorizations'
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Driver authorization permission required'
    );
  end if;

  return query
  select
    employee.id,
    employee.user_id,
    employee.employee_code::text,
    employee.full_name::text,
    employee.title::text,
    employee.avatar_url,
    employee.department_id,
    count(authorization_row.id)::bigint
  from public.employees employee
  join public.users app_user on app_user.id = employee.user_id
  left join public.vehicle_driver_authorizations authorization_row
    on authorization_row.user_id = employee.user_id
  where employee.status = 'Đang làm việc'
    and employee.user_id is not null
    and coalesce(app_user.is_active, true)
  group by
    employee.id,
    employee.user_id,
    employee.employee_code,
    employee.full_name,
    employee.title,
    employee.avatar_url,
    employee.department_id
  order by employee.full_name, employee.employee_code;
end;
$$;

create or replace function public.get_vehicle_driver_candidates()
returns table (
  employee_id uuid,
  user_id uuid,
  employee_code text,
  employee_name text,
  employee_title text,
  employee_avatar_url text,
  department_id uuid,
  authorization_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_vehicle_driver_candidates_impl(
    public.current_app_user_id()
  );
$$;

create or replace function app_private.get_vehicle_driver_authorizations_admin_impl(
  p_actor_user_id uuid
) returns table (
  id uuid,
  user_id uuid,
  employee_id uuid,
  authorization_type text,
  license_number text,
  license_class text,
  license_expiry date,
  license_front_photo_path text,
  license_back_photo_path text,
  health_check_expiry_date date,
  allowed_vehicle_types text[],
  status text,
  approved_by_user_id uuid,
  approved_at timestamptz,
  note text,
  created_at timestamptz,
  updated_at timestamptz,
  employee_code text,
  employee_name text,
  employee_title text,
  employee_avatar_url text,
  department_id uuid
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

  if not app_private.vehicle_user_has_permission(
    p_actor_user_id,
    'booking.vehicle.manage_authorizations'
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Driver authorization permission required'
    );
  end if;

  return query
  select
    authorization_row.id,
    authorization_row.user_id,
    authorization_row.employee_id,
    authorization_row.authorization_type,
    authorization_row.license_number,
    authorization_row.license_class,
    authorization_row.license_expiry,
    authorization_row.license_front_photo_path,
    authorization_row.license_back_photo_path,
    authorization_row.health_check_expiry_date,
    authorization_row.allowed_vehicle_types,
    authorization_row.status,
    authorization_row.approved_by_user_id,
    authorization_row.approved_at,
    authorization_row.note,
    authorization_row.created_at,
    authorization_row.updated_at,
    employee.employee_code::text,
    employee.full_name::text,
    employee.title::text,
    employee.avatar_url,
    employee.department_id
  from public.vehicle_driver_authorizations authorization_row
  left join public.employees employee
    on employee.id = authorization_row.employee_id
  order by employee.full_name nulls last, authorization_row.created_at desc;
end;
$$;

create or replace function public.get_vehicle_driver_authorizations_admin()
returns table (
  id uuid,
  user_id uuid,
  employee_id uuid,
  authorization_type text,
  license_number text,
  license_class text,
  license_expiry date,
  license_front_photo_path text,
  license_back_photo_path text,
  health_check_expiry_date date,
  allowed_vehicle_types text[],
  status text,
  approved_by_user_id uuid,
  approved_at timestamptz,
  note text,
  created_at timestamptz,
  updated_at timestamptz,
  employee_code text,
  employee_name text,
  employee_title text,
  employee_avatar_url text,
  department_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_vehicle_driver_authorizations_admin_impl(
    public.current_app_user_id()
  );
$$;

create or replace function app_private.get_vehicle_driver_authorizations_eligible_impl(
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
  is_eligible boolean,
  employee_name text,
  employee_title text,
  employee_avatar_url text
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

  if p_actor_user_id is null then
    perform app_private.vehicle_raise_permission_denied(
      'Authenticated booking user required'
    );
  end if;

  return query
  select
    authorization_row.id,
    authorization_row.user_id,
    authorization_row.employee_id,
    authorization_row.authorization_type,
    authorization_row.license_class,
    authorization_row.license_expiry,
    authorization_row.allowed_vehicle_types,
    authorization_row.status,
    authorization_row.status = 'ACTIVE'
      and authorization_row.license_expiry >= current_date,
    employee.full_name::text,
    employee.title::text,
    employee.avatar_url
  from public.vehicle_driver_authorizations authorization_row
  left join public.employees employee
    on employee.id = authorization_row.employee_id
  where authorization_row.status = 'ACTIVE'
    and authorization_row.license_expiry >= current_date
  order by employee.full_name nulls last, authorization_row.created_at;
end;
$$;

create or replace function public.get_vehicle_driver_authorizations_eligible()
returns table (
  id uuid,
  user_id uuid,
  employee_id uuid,
  authorization_type text,
  license_class text,
  license_expiry date,
  allowed_vehicle_types text[],
  status text,
  is_eligible boolean,
  employee_name text,
  employee_title text,
  employee_avatar_url text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_vehicle_driver_authorizations_eligible_impl(
    public.current_app_user_id()
  );
$$;

create or replace function app_private.command_set_fleet_vehicle_asset_image(
  p_actor_user_id uuid,
  p_asset_id text,
  p_image_url text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is distinct from public.current_app_user_id() then
    perform app_private.vehicle_raise_permission_denied('Actor mismatch');
  end if;

  if not app_private.vehicle_user_has_permission(
    p_actor_user_id,
    'booking.vehicle.manage_fleet'
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Fleet management permission required'
    );
  end if;

  if not exists (
    select 1
    from public.assets asset
    where asset.id = p_asset_id
  ) then
    raise exception using errcode = 'P0002', message = 'ASSET_NOT_FOUND';
  end if;

  update public.assets asset
  set image_url = nullif(trim(p_image_url), ''),
      updated_at = now()
  where asset.id = p_asset_id;

  return jsonb_build_object(
    'success', true,
    'asset_id', p_asset_id,
    'image_url', nullif(trim(p_image_url), '')
  );
end;
$$;

create or replace function public.set_fleet_vehicle_asset_image(
  p_asset_id text,
  p_image_url text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_set_fleet_vehicle_asset_image(
    public.current_app_user_id(),
    p_asset_id,
    p_image_url
  );
$$;

revoke all on function app_private.get_fleet_vehicle_candidates_impl(uuid)
  from public, anon;
revoke all on function app_private.get_fleet_vehicle_profiles_admin_impl(uuid)
  from public, anon;
revoke all on function app_private.get_vehicle_driver_candidates_impl(uuid)
  from public, anon;
revoke all on function app_private.get_vehicle_driver_authorizations_admin_impl(uuid)
  from public, anon;
revoke all on function app_private.get_vehicle_driver_authorizations_eligible_impl(uuid)
  from public, anon;
revoke all on function app_private.command_set_fleet_vehicle_asset_image(uuid, text, text)
  from public, anon;

grant execute on function app_private.get_fleet_vehicle_candidates_impl(uuid)
  to authenticated;
grant execute on function app_private.get_fleet_vehicle_profiles_admin_impl(uuid)
  to authenticated;
grant execute on function app_private.get_vehicle_driver_candidates_impl(uuid)
  to authenticated;
grant execute on function app_private.get_vehicle_driver_authorizations_admin_impl(uuid)
  to authenticated;
grant execute on function app_private.get_vehicle_driver_authorizations_eligible_impl(uuid)
  to authenticated;
grant execute on function app_private.command_set_fleet_vehicle_asset_image(uuid, text, text)
  to authenticated;

revoke all on function public.get_fleet_vehicle_candidates() from public, anon;
revoke all on function public.get_fleet_vehicle_profiles_admin() from public, anon;
revoke all on function public.get_vehicle_driver_candidates() from public, anon;
revoke all on function public.get_vehicle_driver_authorizations_admin() from public, anon;
revoke all on function public.get_vehicle_driver_authorizations_eligible() from public, anon;
revoke all on function public.set_fleet_vehicle_asset_image(text, text) from public, anon;

grant execute on function public.get_fleet_vehicle_candidates() to authenticated;
grant execute on function public.get_fleet_vehicle_profiles_admin() to authenticated;
grant execute on function public.get_vehicle_driver_candidates() to authenticated;
grant execute on function public.get_vehicle_driver_authorizations_admin() to authenticated;
grant execute on function public.get_vehicle_driver_authorizations_eligible() to authenticated;
grant execute on function public.set_fleet_vehicle_asset_image(text, text) to authenticated;

commit;

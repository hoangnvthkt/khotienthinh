-- Booking fleet/driver completion smoke. All fixtures and policy probes roll back.

begin;

create temporary table vehicle_booking_fleet_smoke_context (
  manager_user_id uuid not null,
  manager_auth_id uuid not null,
  manager_email text not null,
  outsider_user_id uuid not null,
  outsider_auth_id uuid not null,
  outsider_email text not null,
  vehicle_asset_id text not null,
  candidate_asset_id text not null
) on commit drop;

do $fixtures$
declare
  v_manager record;
  v_outsider record;
  v_category_id text := 'fleet-smoke-category-' || substr(gen_random_uuid()::text, 1, 8);
  v_vehicle_asset_id text := 'fleet-smoke-profile-' || substr(gen_random_uuid()::text, 1, 8);
  v_candidate_asset_id text := 'fleet-smoke-candidate-' || substr(gen_random_uuid()::text, 1, 8);
  v_disposed_asset_id text := 'fleet-smoke-disposed-' || substr(gen_random_uuid()::text, 1, 8);
  v_location_id uuid := gen_random_uuid();
begin
  select app_user.id, app_user.auth_id, app_user.email
  into v_manager
  from public.users app_user
  where app_user.auth_id is not null
    and coalesce(app_user.is_active, true)
    and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    and app_user.role::text <> 'ADMIN'
  order by app_user.created_at, app_user.id
  limit 1;

  select app_user.id, app_user.auth_id, app_user.email
  into v_outsider
  from public.users app_user
  where app_user.auth_id is not null
    and app_user.id <> v_manager.id
    and coalesce(app_user.is_active, true)
    and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    and app_user.role::text <> 'ADMIN'
  order by app_user.created_at, app_user.id
  limit 1;

  if v_manager.id is null or v_outsider.id is null then
    raise exception 'FLEET_SMOKE_FIXTURE_MISSING: two active non-admin users are required';
  end if;

  insert into public.asset_categories(id, name, type, depreciation_years)
  values (v_category_id, 'Fleet smoke vehicle', 'vehicle', 5);

  insert into public.assets(
    id, code, name, category_id, status, purchase_date, asset_type, image_url
  ) values
    (v_vehicle_asset_id, 'SMOKE-PROFILE', 'Fleet smoke profile vehicle',
     v_category_id, 'AVAILABLE', current_date::text, 'single', null),
    (v_candidate_asset_id, 'SMOKE-CANDIDATE', 'Fleet smoke candidate vehicle',
     v_category_id, 'AVAILABLE', current_date::text, 'single', null),
    (v_disposed_asset_id, 'SMOKE-DISPOSED', 'Fleet smoke disposed vehicle',
     v_category_id, 'DISPOSED', current_date::text, 'single', null);

  insert into public.fleet_locations(id, name, source_type, active)
  values (v_location_id, 'Fleet smoke home base', 'CUSTOM', true);

  insert into public.fleet_vehicle_profiles(
    asset_id, home_base_id, vehicle_type, seat_count, availability_status,
    allow_self_drive, current_odometer, custody_status, active
  ) values (
    v_vehicle_asset_id, v_location_id, 'SMOKE', 5, 'AVAILABLE',
    false, 0, 'AVAILABLE', true
  );

  insert into public.user_permission_grants(
    user_id, permission_code, scope_type, scope_id, is_active,
    granted_by, granted_at, grant_reason
  ) values
    (v_manager.id, 'booking.vehicle.manage_fleet', 'global', '*', true,
     v_manager.id, now(), 'Fleet completion smoke'),
    (v_manager.id, 'booking.vehicle.manage_authorizations', 'global', '*', true,
     v_manager.id, now(), 'Fleet completion smoke')
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = true,
      revoked_at = null,
      expires_at = null,
      updated_at = now();

  insert into vehicle_booking_fleet_smoke_context values (
    v_manager.id, v_manager.auth_id, v_manager.email,
    v_outsider.id, v_outsider.auth_id, v_outsider.email,
    v_vehicle_asset_id, v_candidate_asset_id
  );
end;
$fixtures$;

grant select on vehicle_booking_fleet_smoke_context to authenticated;

do $contracts$
declare
  v_admin_user_id uuid;
  v_wrapper record;
begin
  if not exists (
    select 1 from storage.buckets bucket
    where bucket.id = 'asset-images'
      and bucket.public
      and bucket.file_size_limit = 5242880
      and bucket.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then
    raise exception 'FLEET_SMOKE_ASSET_BUCKET_ASSERTION_FAILED';
  end if;

  if exists (
    select 1 from storage.buckets bucket
    where bucket.id = 'vehicle-trip-evidence' and bucket.public
  ) then
    raise exception 'FLEET_SMOKE_LICENSE_BUCKET_MUST_REMAIN_PRIVATE';
  end if;

  for v_wrapper in
    select proc.oid
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname in (
        'get_fleet_vehicle_candidates',
        'get_fleet_vehicle_profiles_admin',
        'get_vehicle_driver_candidates',
        'get_vehicle_driver_authorizations_admin',
        'get_vehicle_driver_authorizations_eligible',
        'set_fleet_vehicle_asset_image'
      )
  loop
    if (select proc.prosecdef from pg_proc proc where proc.oid = v_wrapper.oid) then
      raise exception 'FLEET_SMOKE_PUBLIC_WRAPPER_MUST_BE_INVOKER: %', v_wrapper.oid::regprocedure;
    end if;
    if not has_function_privilege('authenticated', v_wrapper.oid, 'EXECUTE')
      or has_function_privilege('anon', v_wrapper.oid, 'EXECUTE') then
      raise exception 'FLEET_SMOKE_WRAPPER_GRANT_ASSERTION_FAILED: %', v_wrapper.oid::regprocedure;
    end if;
  end loop;

  if (select count(*) from pg_policies policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.policyname in (
          'p_asset_images_select', 'p_asset_images_insert',
          'p_asset_images_update', 'p_asset_images_delete'
        )) <> 4 then
    raise exception 'FLEET_SMOKE_STORAGE_POLICY_ASSERTION_FAILED';
  end if;

  if position('employee_email' in pg_get_function_result(
      'public.get_vehicle_driver_candidates()'::regprocedure
    )) > 0
    or position('license_number' in pg_get_function_result(
      'public.get_vehicle_driver_candidates()'::regprocedure
    )) > 0 then
    raise exception 'FLEET_SMOKE_DRIVER_CANDIDATE_DATA_LEAK';
  end if;

  select app_user.id into v_admin_user_id
  from public.users app_user
  where app_user.role::text = 'ADMIN'
    and coalesce(app_user.is_active, true)
    and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  order by app_user.created_at, app_user.id
  limit 1;

  if v_admin_user_id is null
    or not app_private.vehicle_user_has_permission(
      v_admin_user_id, 'booking.vehicle.manage_fleet'
    )
    or not app_private.vehicle_user_has_permission(
      v_admin_user_id, 'booking.vehicle.manage_authorizations'
    )
    or not app_private.vehicle_user_has_permission(
      v_admin_user_id, 'booking.vehicle.view_reports'
    ) then
    raise exception 'FLEET_SMOKE_ADMIN_BYPASS_ASSERTION_FAILED';
  end if;
end;
$contracts$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', manager_auth_id, 'email', manager_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_fleet_smoke_context;

do $manager_access$
declare
  v_context vehicle_booking_fleet_smoke_context%rowtype;
begin
  select * into v_context from vehicle_booking_fleet_smoke_context;

  if exists (
    select 1
    from public.get_fleet_vehicle_candidates() candidate
    join public.assets asset on asset.id = candidate.asset_id
    join public.asset_categories category on category.id = asset.category_id
    where category.type::text <> 'vehicle'
      or coalesce(asset.asset_type, 'single') <> 'single'
      or asset.status::text = 'DISPOSED'
      or exists (
        select 1 from public.fleet_vehicle_profiles profile
        where profile.asset_id = candidate.asset_id
      )
  ) then
    raise exception 'FLEET_SMOKE_VEHICLE_CANDIDATE_FILTER_ASSERTION_FAILED';
  end if;

  if not exists (
    select 1 from public.get_fleet_vehicle_candidates() candidate
    where candidate.asset_id = v_context.candidate_asset_id
  ) or exists (
    select 1 from public.get_fleet_vehicle_candidates() candidate
    where candidate.asset_id = v_context.vehicle_asset_id
  ) then
    raise exception 'FLEET_SMOKE_VEHICLE_CANDIDATE_MEMBERSHIP_ASSERTION_FAILED';
  end if;

  if exists (
    select 1
    from public.get_vehicle_driver_candidates() candidate
    join public.employees employee on employee.id = candidate.employee_id
    where employee.status <> 'Đang làm việc'
      or employee.user_id is null
  ) then
    raise exception 'FLEET_SMOKE_DRIVER_CANDIDATE_FILTER_ASSERTION_FAILED';
  end if;

  perform public.get_fleet_vehicle_profiles_admin();
  perform public.get_vehicle_driver_authorizations_admin();
  perform public.set_fleet_vehicle_asset_image(
    v_context.vehicle_asset_id,
    'https://fleet-smoke.invalid/vehicle.jpg'
  );

  if (select asset.image_url from public.assets asset
      where asset.id = v_context.vehicle_asset_id)
      <> 'https://fleet-smoke.invalid/vehicle.jpg' then
    raise exception 'FLEET_SMOKE_ASSET_IMAGE_UPDATE_ASSERTION_FAILED';
  end if;

  begin
    perform app_private.get_fleet_vehicle_candidates_impl(v_context.outsider_user_id);
    raise exception 'FLEET_SMOKE_FORGED_ACTOR_WAS_ACCEPTED';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  insert into storage.objects(bucket_id, name, metadata)
  values ('asset-images', 'assets/fleet-smoke/allowed.jpg', '{}'::jsonb);
end;
$manager_access$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', outsider_auth_id, 'email', outsider_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_fleet_smoke_context;

do $outsider_denial$
begin
  begin
    perform public.get_fleet_vehicle_candidates();
    raise exception 'FLEET_SMOKE_OUTSIDER_RPC_WAS_ACCEPTED';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  begin
    insert into storage.objects(bucket_id, name, metadata)
    values ('asset-images', 'assets/fleet-smoke/denied.jpg', '{}'::jsonb);
    raise exception 'FLEET_SMOKE_OUTSIDER_STORAGE_WRITE_WAS_ACCEPTED';
  exception when insufficient_privilege then
    null;
  end;
end;
$outsider_denial$;

reset role;

rollback;

-- Booking dispatcher administration and approval identity smoke. All fixtures roll back.

begin;

create temporary table vehicle_booking_dispatcher_smoke_context (
  admin_user_id uuid not null,
  admin_auth_id uuid not null,
  admin_email text not null,
  dispatcher_one_id uuid not null,
  dispatcher_two_id uuid not null,
  previous_dispatcher_id uuid not null,
  booking_id uuid not null,
  vehicle_asset_id text not null
) on commit drop;

do $fixtures$
declare
  v_admin record;
  v_dispatcher_one_id uuid := gen_random_uuid();
  v_dispatcher_two_id uuid := gen_random_uuid();
  v_previous_dispatcher_id uuid := gen_random_uuid();
  v_category_id text := 'dispatcher-smoke-category-' || substr(gen_random_uuid()::text, 1, 8);
  v_vehicle_asset_id text := 'dispatcher-smoke-vehicle-' || substr(gen_random_uuid()::text, 1, 8);
  v_location_id uuid := gen_random_uuid();
  v_booking_id uuid := gen_random_uuid();
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
begin
  select app_user.id, app_user.auth_id, app_user.email
  into v_admin
  from public.users app_user
  where app_user.role::text = 'ADMIN'
    and app_user.auth_id is not null
    and app_user.is_active
    and app_user.account_status = 'ACTIVE'
  order by app_user.created_at, app_user.id
  limit 1;

  if v_admin.id is null then
    raise exception 'DISPATCHER_SMOKE_ADMIN_FIXTURE_MISSING';
  end if;

  insert into public.users(id, name, email, username, role, is_active, account_status)
  values
    (v_dispatcher_one_id, 'Điều phối Một', 'dispatcher-one-' || v_suffix || '@smoke.invalid', 'dispatcher-one-' || v_suffix, 'EMPLOYEE', true, 'ACTIVE'),
    (v_dispatcher_two_id, 'Điều phối Hai', 'dispatcher-two-' || v_suffix || '@smoke.invalid', 'dispatcher-two-' || v_suffix, 'EMPLOYEE', true, 'ACTIVE'),
    (v_previous_dispatcher_id, 'Điều phối Cũ', 'dispatcher-old-' || v_suffix || '@smoke.invalid', 'dispatcher-old-' || v_suffix, 'EMPLOYEE', true, 'ACTIVE');

  insert into public.employees(employee_code, full_name, title, status, user_id, avatar_url)
  values
    ('DP1-' || v_suffix, 'Điều phối Một', 'Chuyên viên điều phối', 'Đang làm việc', v_dispatcher_one_id, 'https://smoke.invalid/dispatcher-one.jpg'),
    ('DP2-' || v_suffix, 'Điều phối Hai', 'Chuyên viên điều phối', 'Đang làm việc', v_dispatcher_two_id, null),
    ('DPO-' || v_suffix, 'Điều phối Cũ', 'Chuyên viên điều phối', 'Đang làm việc', v_previous_dispatcher_id, null);

  insert into public.user_permission_grants(
    user_id, permission_code, scope_type, scope_id, is_active,
    granted_by, granted_at, grant_reason
  ) values
    (v_dispatcher_one_id, 'booking.vehicle.view_reports', 'global', '*', true, v_admin.id, now(), 'Dispatcher administration smoke'),
    (v_dispatcher_one_id, 'booking.vehicle.dispatch', 'department', gen_random_uuid()::text, true, v_admin.id, now(), 'Dispatcher scoped grant smoke'),
    (v_previous_dispatcher_id, 'booking.vehicle.dispatch', 'global', '*', true, v_admin.id, now(), 'Dispatcher replacement smoke');

  insert into public.asset_categories(id, name, type, depreciation_years)
  values (v_category_id, 'Dispatcher smoke vehicle', 'vehicle', 5);

  insert into public.assets(id, code, name, category_id, status, purchase_date, asset_type, image_url)
  values (
    v_vehicle_asset_id,
    'SMOKE-CAR-' || v_suffix,
    'Xe điều phối smoke',
    v_category_id,
    'AVAILABLE',
    current_date::text,
    'single',
    'https://smoke.invalid/vehicle.jpg'
  );

  insert into public.fleet_locations(id, name, source_type, active)
  values (v_location_id, 'Bãi xe dispatcher smoke', 'CUSTOM', true);

  insert into public.fleet_vehicle_profiles(
    asset_id, home_base_id, vehicle_type, seat_count, availability_status,
    allow_self_drive, current_odometer, custody_status, active
  ) values (
    v_vehicle_asset_id, v_location_id, 'SEDAN', 5, 'AVAILABLE', false, 0, 'AVAILABLE', true
  );

  insert into public.vehicle_bookings(
    id, booking_code, requester_user_id, requester_employee_id_snapshot,
    manager_user_id_snapshot, requested_pickup_at, expected_return_at,
    trip_type, pickup_location_text, destination_text, purpose,
    passenger_count, requested_mode, preferred_vehicle_asset_id,
    status, submitted_at
  ) values (
    v_booking_id,
    'CAR-SMOKE-' || upper(v_suffix),
    v_dispatcher_one_id,
    (select employee.id from public.employees employee where employee.user_id = v_dispatcher_one_id limit 1),
    v_admin.id,
    now() + interval '2 hours',
    now() + interval '5 hours',
    'ROUND_TRIP',
    'Văn phòng smoke',
    'Điểm đến smoke',
    'Kiểm tra thẻ phê duyệt',
    2,
    'WITH_DRIVER',
    v_vehicle_asset_id,
    'PENDING_APPROVAL',
    now()
  );

  insert into vehicle_booking_dispatcher_smoke_context values (
    v_admin.id, v_admin.auth_id, v_admin.email,
    v_dispatcher_one_id, v_dispatcher_two_id, v_previous_dispatcher_id,
    v_booking_id, v_vehicle_asset_id
  );
end;
$fixtures$;

grant select on vehicle_booking_dispatcher_smoke_context to authenticated;

do $contracts$
declare
  v_wrapper record;
begin
  for v_wrapper in
    select procedure_row.oid
    from pg_proc procedure_row
    join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname in (
        'get_vehicle_booking_dispatcher_candidates',
        'set_vehicle_booking_dispatchers',
        'get_pending_vehicle_booking_approval_cards'
      )
  loop
    if (select procedure_row.prosecdef from pg_proc procedure_row where procedure_row.oid = v_wrapper.oid) then
      raise exception 'DISPATCHER_SMOKE_PUBLIC_WRAPPER_MUST_BE_INVOKER: %', v_wrapper.oid::regprocedure;
    end if;
    if not has_function_privilege('authenticated', v_wrapper.oid, 'EXECUTE')
      or has_function_privilege('anon', v_wrapper.oid, 'EXECUTE') then
      raise exception 'DISPATCHER_SMOKE_WRAPPER_GRANT_ASSERTION_FAILED: %', v_wrapper.oid::regprocedure;
    end if;
  end loop;

  if position('email' in pg_get_function_result(
      'public.get_vehicle_booking_dispatcher_candidates()'::regprocedure
    )) > 0 then
    raise exception 'DISPATCHER_SMOKE_CANDIDATE_EMAIL_LEAK';
  end if;
end;
$contracts$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', admin_auth_id, 'email', admin_email, 'role', 'authenticated'
)::text, true) from vehicle_booking_dispatcher_smoke_context;

do $admin_access$
declare
  v_context vehicle_booking_dispatcher_smoke_context%rowtype;
  v_dispatcher_count integer;
  v_card record;
begin
  select * into v_context from vehicle_booking_dispatcher_smoke_context;

  perform public.set_vehicle_booking_dispatchers(array[
    v_context.dispatcher_one_id,
    v_context.dispatcher_two_id,
    v_context.dispatcher_one_id
  ]);

  select count(*)::integer into v_dispatcher_count
  from public.user_permission_grants grant_row
  where grant_row.user_id in (v_context.dispatcher_one_id, v_context.dispatcher_two_id)
    and grant_row.permission_code = 'booking.vehicle.dispatch'
    and grant_row.scope_type = 'global'
    and grant_row.scope_id = '*'
    and grant_row.is_active
    and grant_row.revoked_at is null;

  if v_dispatcher_count <> 2 then
    raise exception 'DISPATCHER_SMOKE_MULTI_SELECTION_FAILED';
  end if;

  if exists (
    select 1 from public.user_permission_grants grant_row
    where grant_row.user_id = v_context.previous_dispatcher_id
      and grant_row.permission_code = 'booking.vehicle.dispatch'
      and grant_row.scope_type = 'global'
      and grant_row.scope_id = '*'
      and grant_row.is_active
  ) then
    raise exception 'DISPATCHER_SMOKE_PREVIOUS_GLOBAL_GRANT_NOT_REVOKED';
  end if;

  if not exists (
    select 1 from public.user_permission_grants grant_row
    where grant_row.user_id = v_context.dispatcher_one_id
      and grant_row.permission_code = 'booking.vehicle.view_reports'
      and grant_row.scope_type = 'global'
      and grant_row.scope_id = '*'
      and grant_row.is_active
  ) or not exists (
    select 1 from public.user_permission_grants grant_row
    where grant_row.user_id = v_context.dispatcher_one_id
      and grant_row.permission_code = 'booking.vehicle.dispatch'
      and grant_row.scope_type = 'department'
      and grant_row.is_active
  ) then
    raise exception 'DISPATCHER_SMOKE_UNRELATED_OR_SCOPED_GRANT_WAS_CHANGED';
  end if;

  if (select count(*) from public.get_vehicle_booking_dispatcher_candidates() candidate
      where candidate.user_id in (v_context.dispatcher_one_id, v_context.dispatcher_two_id)
        and candidate.is_dispatcher) <> 2 then
    raise exception 'DISPATCHER_SMOKE_CANDIDATE_SELECTION_STATE_FAILED';
  end if;

  select * into v_card
  from public.get_pending_vehicle_booking_approval_cards() card
  where card.id = v_context.booking_id;

  if v_card.id is null
    or v_card.requester_employee_name <> 'Điều phối Một'
    or v_card.requester_employee_code is null
    or v_card.requester_avatar_url <> 'https://smoke.invalid/dispatcher-one.jpg'
    or v_card.preferred_vehicle_asset_code is null
    or v_card.preferred_vehicle_asset_name <> 'Xe điều phối smoke'
    or v_card.preferred_vehicle_image_url <> 'https://smoke.invalid/vehicle.jpg'
  then
    raise exception 'DISPATCHER_SMOKE_APPROVAL_BUSINESS_IDENTITY_FAILED';
  end if;

  if not exists (
    select 1 from public.permission_audit_events audit_event
    where audit_event.actor_user_id = v_context.admin_user_id
      and audit_event.event_type = 'booking_dispatchers_replaced'
      and audit_event.metadata ->> 'permissionCode' = 'booking.vehicle.dispatch'
  ) then
    raise exception 'DISPATCHER_SMOKE_AUDIT_EVENT_MISSING';
  end if;

  begin
    perform app_private.command_set_vehicle_booking_dispatchers(
      v_context.dispatcher_one_id,
      array[v_context.dispatcher_one_id]
    );
    raise exception 'DISPATCHER_SMOKE_FORGED_ACTOR_WAS_ACCEPTED';
  exception when others then
    if sqlstate <> '42501' or position('PERMISSION_DENIED' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end;
$admin_access$;

rollback;

-- Vehicle Booking readable details/notifications Cloud smoke.
-- All fixtures and notification mutations are rolled back.

begin;

do $required_surface$
begin
  if to_regprocedure('public.get_vehicle_booking_assignment_display(uuid)') is null
     or to_regprocedure('app_private.get_vehicle_booking_assignment_display_impl(uuid,uuid)') is null
     or to_regprocedure('app_private.build_vehicle_booking_notification_context(uuid,uuid,uuid,text)') is null
     or to_regprocedure('app_private.insert_vehicle_booking_notification(uuid)') is null
     or to_regprocedure('app_private.backfill_vehicle_booking_notification_context()') is null then
    raise exception 'READABLE_BOOKING_NOTIFICATION_FUNCTIONS_MISSING';
  end if;
end;
$required_surface$;

create temporary table vehicle_booking_readable_context (
  real_booking_id uuid not null,
  admin_user_id uuid not null,
  admin_auth_id uuid not null,
  admin_email text not null,
  requester_user_id uuid not null,
  requester_auth_id uuid not null,
  requester_email text not null,
  driver_one_user_id uuid not null,
  driver_two_user_id uuid not null,
  outsider_user_id uuid not null,
  outsider_auth_id uuid not null,
  outsider_email text not null,
  vehicle_asset_id text not null,
  internal_booking_id uuid not null,
  internal_assignment_id uuid not null,
  self_drive_booking_id uuid not null,
  self_drive_assignment_id uuid not null,
  external_booking_id uuid not null,
  external_assignment_id uuid not null,
  unassigned_booking_id uuid not null,
  reassigned_booking_id uuid not null,
  old_assignment_id uuid not null,
  new_assignment_id uuid not null,
  direct_outbox_id uuid not null,
  batch_outbox_id uuid not null
) on commit drop;

do $fixtures$
declare
  v_real_booking_id uuid;
  v_admin record;
  v_candidate record;
  v_asset_id text;
  v_requester_id uuid;
  v_requester_auth_id uuid;
  v_requester_email text;
  v_driver_one_id uuid;
  v_driver_two_id uuid;
  v_outsider_id uuid;
  v_outsider_auth_id uuid;
  v_outsider_email text;
  v_internal_booking_id uuid := gen_random_uuid();
  v_internal_assignment_id uuid := gen_random_uuid();
  v_self_booking_id uuid := gen_random_uuid();
  v_self_assignment_id uuid := gen_random_uuid();
  v_external_booking_id uuid := gen_random_uuid();
  v_external_assignment_id uuid := gen_random_uuid();
  v_unassigned_booking_id uuid := gen_random_uuid();
  v_reassigned_booking_id uuid := gen_random_uuid();
  v_old_assignment_id uuid := gen_random_uuid();
  v_new_assignment_id uuid := gen_random_uuid();
  v_direct_outbox_id uuid := gen_random_uuid();
  v_batch_outbox_id uuid := gen_random_uuid();
begin
  select booking.id into v_real_booking_id
  from public.vehicle_bookings booking
  where booking.booking_code = 'CAR-260812-0003';

  select app_user.id, app_user.auth_id, app_user.email
  into v_admin
  from public.users app_user
  where app_user.role::text = 'ADMIN'
    and app_user.auth_id is not null
    and app_user.is_active
    and app_user.account_status = 'ACTIVE'
  order by app_user.created_at, app_user.id
  limit 1;

  select asset.id into v_asset_id
  from public.assets asset
  join public.fleet_vehicle_profiles profile on profile.asset_id = asset.id
  where asset.code = 'TS-002'
    and profile.active
  limit 1;

  if v_real_booking_id is null or v_admin.id is null or v_asset_id is null then
    raise exception 'READABLE_BOOKING_SMOKE_REAL_FIXTURE_MISSING';
  end if;

  for v_candidate in
    select app_user.id, app_user.auth_id, app_user.email,
      row_number() over (order by app_user.created_at, app_user.id) as row_number
    from public.users app_user
    where app_user.auth_id is not null
      and app_user.is_active
      and app_user.account_status = 'ACTIVE'
      and app_user.role::text <> 'ADMIN'
      and not app_private.vehicle_user_can_view_booking(app_user.id, v_real_booking_id)
    order by app_user.created_at, app_user.id
    limit 4
  loop
    case v_candidate.row_number
      when 1 then
        v_requester_id := v_candidate.id;
        v_requester_auth_id := v_candidate.auth_id;
        v_requester_email := v_candidate.email;
      when 2 then v_driver_one_id := v_candidate.id;
      when 3 then v_driver_two_id := v_candidate.id;
      when 4 then
        v_outsider_id := v_candidate.id;
        v_outsider_auth_id := v_candidate.auth_id;
        v_outsider_email := v_candidate.email;
    end case;
  end loop;

  if v_outsider_id is null then
    raise exception 'READABLE_BOOKING_SMOKE_USER_FIXTURE_MISSING';
  end if;

  insert into public.employees(employee_code, full_name, title, status, user_id)
  values
    ('SMOKE-R-' || substr(v_requester_id::text, 1, 8), 'Smoke Requester', 'Chuyên viên', 'Đang làm việc', v_requester_id),
    ('SMOKE-D1-' || substr(v_driver_one_id::text, 1, 8), 'Smoke Driver One', 'Tài xế', 'Đang làm việc', v_driver_one_id),
    ('SMOKE-D2-' || substr(v_driver_two_id::text, 1, 8), 'Smoke Driver Two', 'Tài xế', 'Đang làm việc', v_driver_two_id);

  insert into public.vehicle_bookings(
    id, booking_code, requester_user_id, trip_owner_user_id,
    requested_pickup_at, expected_return_at, trip_type,
    pickup_location_text, destination_text, purpose,
    passenger_count, requested_mode, status, submitted_at
  ) values
    (v_internal_booking_id, 'CAR-READ-' || substr(v_internal_booking_id::text, 1, 8),
     v_requester_id, v_requester_id, '2099-01-01 01:00+00', '2099-01-01 02:00+00',
     'ROUND_TRIP', 'Văn phòng Smoke', 'Công trường Smoke',
     repeat('Mục đích kiểm thử thông báo dài ', 5), 2, 'WITH_DRIVER', 'ASSIGNED', now()),
    (v_self_booking_id, 'CAR-READ-' || substr(v_self_booking_id::text, 1, 8),
     v_requester_id, v_requester_id, '2099-01-01 03:00+00', '2099-01-01 04:00+00',
     'ROUND_TRIP', 'Điểm đi tự lái', 'Điểm đến tự lái',
     'Kiểm thử chuyến tự lái', 1, 'SELF_DRIVE', 'ASSIGNED', now()),
    (v_external_booking_id, 'CAR-READ-' || substr(v_external_booking_id::text, 1, 8),
     v_requester_id, v_requester_id, '2099-01-01 05:00+00', '2099-01-01 06:00+00',
     'ONE_WAY', 'Điểm đón taxi', 'Điểm trả taxi',
     'Kiểm thử xe ngoài', 1, 'FLEXIBLE', 'ASSIGNED', now()),
    (v_unassigned_booking_id, 'CAR-READ-' || substr(v_unassigned_booking_id::text, 1, 8),
     v_requester_id, v_requester_id, '2099-01-01 07:00+00', '2099-01-01 08:00+00',
     'ROUND_TRIP', 'Điểm đi chưa xếp', 'Điểm đến chưa xếp',
     'Kiểm thử chưa phân công', 1, 'WITH_DRIVER', 'WAITING_DISPATCH', now()),
    (v_reassigned_booking_id, 'CAR-READ-' || substr(v_reassigned_booking_id::text, 1, 8),
     v_requester_id, v_requester_id, '2099-01-01 09:00+00', '2099-01-01 10:00+00',
     'ROUND_TRIP', 'Điểm đi đổi tài xế', 'Điểm đến đổi tài xế',
     'Kiểm thử đổi tài xế', 1, 'WITH_DRIVER', 'ASSIGNED', now());

  insert into public.vehicle_booking_assignments(
    id, booking_id, version, is_active, fulfillment_type,
    vehicle_asset_id, operator_user_id, operator_type, handover_officer_user_id,
    reserved_start_at, reserved_end_at, assigned_by_user_id, assigned_at,
    external_service_type, external_provider_name, external_driver_name,
    external_vehicle_plate
  ) values
    (v_internal_assignment_id, v_internal_booking_id, 1, true, 'INTERNAL_WITH_DRIVER',
     v_asset_id, v_driver_one_id, 'PROFESSIONAL_DRIVER', null,
     '2099-01-01 01:00+00', '2099-01-01 02:00+00', v_requester_id, now(),
     null, null, null, null),
    (v_self_assignment_id, v_self_booking_id, 1, true, 'INTERNAL_SELF_DRIVE',
     v_asset_id, v_requester_id, 'SELF_DRIVER', v_driver_two_id,
     '2099-01-01 03:00+00', '2099-01-01 04:00+00', v_requester_id, now(),
     null, null, null, null),
    (v_external_assignment_id, v_external_booking_id, 1, true, 'EXTERNAL_TRANSPORT',
     null, null, null, null, '2099-01-01 05:00+00', '2099-01-01 06:00+00',
     v_requester_id, now(), 'TAXI', 'Mai Linh', 'External Driver', '29A-123.45'),
    (v_old_assignment_id, v_reassigned_booking_id, 1, false, 'INTERNAL_WITH_DRIVER',
     v_asset_id, v_driver_one_id, 'PROFESSIONAL_DRIVER', null,
     '2099-01-01 09:00+00', '2099-01-01 10:00+00', v_requester_id, now(),
     null, null, null, null),
    (v_new_assignment_id, v_reassigned_booking_id, 2, true, 'INTERNAL_WITH_DRIVER',
     v_asset_id, v_driver_two_id, 'PROFESSIONAL_DRIVER', null,
     '2099-01-01 09:00+00', '2099-01-01 10:00+00', v_requester_id, now(),
     null, null, null, null);

  update public.vehicle_booking_assignments
  set released_at = now(), superseded_at = now(),
      superseded_by_user_id = v_requester_id,
      supersede_reason = 'Readable notification smoke'
  where id = v_old_assignment_id;

  insert into app_private.vehicle_booking_notification_outbox(
    id, event_key, event_type, recipient_user_id, payload,
    status, attempt_count, available_at, locked_at
  ) values
    (v_direct_outbox_id, 'readable-direct-' || v_direct_outbox_id,
     'BOOKING_ASSIGNED', v_requester_id,
     jsonb_build_object('booking_id', v_internal_booking_id,
                        'booking_code', 'CAR-READ-' || substr(v_internal_booking_id::text, 1, 8),
                        'assignment_id', v_internal_assignment_id,
                        'event_type', 'BOOKING_ASSIGNED'),
     'PROCESSING', 1, '1900-01-01', now()),
    (v_batch_outbox_id, 'readable-batch-' || v_batch_outbox_id,
     'BOOKING_ASSIGNED', v_requester_id,
     jsonb_build_object('booking_id', v_internal_booking_id,
                        'booking_code', 'CAR-READ-' || substr(v_internal_booking_id::text, 1, 8),
                        'assignment_id', v_internal_assignment_id,
                        'event_type', 'BOOKING_ASSIGNED'),
     'PENDING', 0, '1900-01-01', null);

  insert into vehicle_booking_readable_context values (
    v_real_booking_id, v_admin.id, v_admin.auth_id, v_admin.email,
    v_requester_id, v_requester_auth_id, v_requester_email,
    v_driver_one_id, v_driver_two_id,
    v_outsider_id, v_outsider_auth_id, v_outsider_email,
    v_asset_id,
    v_internal_booking_id, v_internal_assignment_id,
    v_self_booking_id, v_self_assignment_id,
    v_external_booking_id, v_external_assignment_id,
    v_unassigned_booking_id, v_reassigned_booking_id,
    v_old_assignment_id, v_new_assignment_id,
    v_direct_outbox_id, v_batch_outbox_id
  );
end;
$fixtures$;

grant select on vehicle_booking_readable_context to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', admin_auth_id, 'email', admin_email, 'role', 'authenticated'
)::text, true)
from vehicle_booking_readable_context;

do $readable_rpc$
declare
  v_booking_id uuid;
  v_row record;
begin
  select real_booking_id into v_booking_id from vehicle_booking_readable_context;
  select * into v_row
  from public.get_vehicle_booking_assignment_display(v_booking_id);

  if v_row.vehicle_code is distinct from 'TS-002'
     or v_row.vehicle_name is distinct from 'Xe tải thùng'
     or v_row.operator_name is distinct from 'Nguyễn Văn Hoàng' then
    raise exception 'READABLE_ASSIGNMENT_RPC_WRONG_RESULT: %', row_to_json(v_row);
  end if;
end;
$readable_rpc$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', outsider_auth_id, 'email', outsider_email, 'role', 'authenticated'
)::text, true)
from vehicle_booking_readable_context;

do $outsider_denied$
declare v_booking_id uuid;
begin
  select real_booking_id into v_booking_id from vehicle_booking_readable_context;
  begin
    perform * from public.get_vehicle_booking_assignment_display(v_booking_id);
  exception when others then
    if sqlstate = '42501' then return; end if;
    raise;
  end;
  raise exception 'READABLE_ASSIGNMENT_RPC_OUTSIDER_WAS_ALLOWED';
end;
$outsider_denied$;

reset role;

do $result_contract$
declare v_result text;
begin
  select pg_get_function_result(
    'public.get_vehicle_booking_assignment_display(uuid)'::regprocedure
  ) into v_result;
  if v_result ~* '(license|authorization_note|note)' then
    raise exception 'READABLE_ASSIGNMENT_RPC_EXPOSES_SENSITIVE_RESULT: %', v_result;
  end if;
end;
$result_contract$;

do $context_branches$
declare
  v_context jsonb;
  v_row vehicle_booking_readable_context%rowtype;
begin
  select * into v_row from vehicle_booking_readable_context;

  v_context := app_private.build_vehicle_booking_notification_context(
    v_row.internal_booking_id, v_row.internal_assignment_id,
    v_row.requester_user_id, 'BOOKING_ASSIGNED'
  );
  if not (v_context ?& array[
      'booking_id', 'booking_code', 'event_type', 'requester_name',
      'purpose', 'driver_name', 'pickup_location', 'destination'
    ])
     or v_context ->> 'requester_name' <> 'Smoke Requester'
     or v_context ->> 'driver_name' <> 'Smoke Driver One' then
    raise exception 'INTERNAL_NOTIFICATION_CONTEXT_INVALID: %', v_context;
  end if;

  v_context := app_private.build_vehicle_booking_notification_context(
    v_row.self_drive_booking_id, v_row.self_drive_assignment_id,
    v_row.requester_user_id, 'BOOKING_ASSIGNED'
  );
  if v_context ->> 'driver_name' <> 'Smoke Requester' then
    raise exception 'SELF_DRIVE_NOTIFICATION_CONTEXT_INVALID: %', v_context;
  end if;

  v_context := app_private.build_vehicle_booking_notification_context(
    v_row.external_booking_id, v_row.external_assignment_id,
    v_row.requester_user_id, 'BOOKING_ASSIGNED'
  );
  if v_context ->> 'driver_name' <> 'External Driver' then
    raise exception 'EXTERNAL_NOTIFICATION_CONTEXT_INVALID: %', v_context;
  end if;

  v_context := app_private.build_vehicle_booking_notification_context(
    v_row.unassigned_booking_id, null,
    v_row.requester_user_id, 'BOOKING_SUBMITTED'
  );
  if v_context ->> 'driver_name' <> 'Chưa phân công' then
    raise exception 'UNASSIGNED_NOTIFICATION_CONTEXT_INVALID: %', v_context;
  end if;

  v_context := app_private.build_vehicle_booking_notification_context(
    v_row.reassigned_booking_id, null,
    v_row.driver_one_user_id, 'BOOKING_REASSIGNED_OLD_OPERATOR'
  );
  if v_context ->> 'driver_name' <> 'Smoke Driver One' then
    raise exception 'OLD_OPERATOR_NOTIFICATION_CONTEXT_INVALID: %', v_context;
  end if;
end;
$context_branches$;

do $delivery_paths$
declare
  v_row vehicle_booking_readable_context%rowtype;
  v_direct_event_key text;
  v_batch_event_key text;
  v_notification record;
  v_result jsonb;
begin
  select * into v_row from vehicle_booking_readable_context;
  select event_key into v_direct_event_key
  from app_private.vehicle_booking_notification_outbox where id = v_row.direct_outbox_id;
  select event_key into v_batch_event_key
  from app_private.vehicle_booking_notification_outbox where id = v_row.batch_outbox_id;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_result := app_private.deliver_vehicle_notification(v_row.direct_outbox_id);
  if coalesce((v_result ->> 'delivered')::boolean, false) is not true then
    raise exception 'DIRECT_NOTIFICATION_DELIVERY_FAILED: %', v_result;
  end if;

  if app_private.process_vehicle_notification_outbox(1) <> 1 then
    raise exception 'BATCH_NOTIFICATION_DELIVERY_FAILED';
  end if;

  for v_notification in
    select notification.*
    from public.notifications notification
    where notification.metadata ->> 'eventKey' in (v_direct_event_key, v_batch_event_key)
  loop
    if not (v_notification.metadata ?& array[
        'booking_id', 'booking_code', 'event_type', 'requester_name',
        'purpose', 'driver_name', 'pickup_location', 'destination'
      ]) then
      raise exception 'DELIVERED_NOTIFICATION_KEYS_MISSING: %', row_to_json(v_notification);
    end if;
    if v_notification.message not like 'Người đặt: Smoke Requester%'
       or v_notification.body is distinct from v_notification.message then
      raise exception 'DELIVERED_NOTIFICATION_MESSAGE_INVALID: %', row_to_json(v_notification);
    end if;
    if v_notification.link is distinct from '/booking/vehicle/my?booking=' || v_row.internal_booking_id
       or v_notification.action_url is distinct from '/booking/vehicle/my?booking=' || v_row.internal_booking_id then
      raise exception 'DELIVERED_NOTIFICATION_LINK_INVALID: %', row_to_json(v_notification);
    end if;
    if v_notification.metadata ->> 'purpose'
         is distinct from trim(repeat('Mục đích kiểm thử thông báo dài ', 5))
       or position('…' in v_notification.message) = 0 then
      raise exception 'DELIVERED_NOTIFICATION_PURPOSE_INVALID: %', row_to_json(v_notification);
    end if;
  end loop;

  if (select count(*) from public.notifications
      where metadata ->> 'eventKey' in (v_direct_event_key, v_batch_event_key)) <> 2
     or exists (
       select 1 from app_private.vehicle_booking_notification_outbox
       where id in (v_row.direct_outbox_id, v_row.batch_outbox_id)
         and status <> 'DELIVERED'
     ) then
    raise exception 'NOTIFICATION_DELIVERY_COUNT_OR_STATUS_INVALID';
  end if;
end;
$delivery_paths$;

do $backfill$
declare
  v_row vehicle_booking_readable_context%rowtype;
  v_notification_id uuid := gen_random_uuid();
  v_before record;
  v_after record;
  v_count_before bigint;
  v_count_after bigint;
begin
  select * into v_row from vehicle_booking_readable_context;

  insert into public.notifications(
    id, user_id, title, body, type, priority, module, link, metadata,
    category, message, severity, source_type, source_id,
    push_enabled, action_url, entity_type, entity_id,
    is_read, created_at
  ) values (
    v_notification_id, v_row.requester_user_id::text,
    'Đã xếp phương án chuyến xe', 'Legacy body', 'info', 'normal',
    'VEHICLE_BOOKING', '/legacy-link',
    jsonb_build_object('booking_id', v_row.internal_booking_id,
                       'assignment_id', v_row.internal_assignment_id,
                       'event_type', 'BOOKING_ASSIGNED'),
    'vehicle_booking', 'Legacy message', 'info', 'vehicle_booking',
    v_row.internal_booking_id::text, true, '/legacy-action',
    'vehicle_booking', v_row.internal_booking_id,
    true, '2026-08-12 01:23:45+00'
  );

  select user_id, is_read, created_at, link, action_url
  into v_before from public.notifications where id = v_notification_id;
  select count(*) into v_count_before from public.notifications;

  perform app_private.backfill_vehicle_booking_notification_context();

  select user_id, is_read, created_at, link, action_url, metadata, message, body
  into v_after from public.notifications where id = v_notification_id;
  select count(*) into v_count_after from public.notifications;

  if v_count_after <> v_count_before
     or v_after.user_id is distinct from v_before.user_id
     or v_after.is_read is distinct from v_before.is_read
     or v_after.created_at is distinct from v_before.created_at
     or v_after.link is distinct from v_before.link
     or v_after.action_url is distinct from v_before.action_url
     or not (v_after.metadata ?& array[
       'booking_id', 'booking_code', 'event_type', 'requester_name',
       'purpose', 'driver_name', 'pickup_location', 'destination'
     ])
     or v_after.message not like 'Người đặt: Smoke Requester%'
     or v_after.body is distinct from v_after.message then
    raise exception 'BOOKING_NOTIFICATION_BACKFILL_INVALID: %', row_to_json(v_after);
  end if;
end;
$backfill$;

do $privileges$
begin
  if has_function_privilege('anon', 'public.get_vehicle_booking_assignment_display(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_vehicle_booking_assignment_display(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.build_vehicle_booking_notification_context(uuid,uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'app_private.insert_vehicle_booking_notification(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.backfill_vehicle_booking_notification_context()', 'EXECUTE') then
    raise exception 'READABLE_BOOKING_NOTIFICATION_PRIVILEGES_INVALID';
  end if;
end;
$privileges$;

rollback;

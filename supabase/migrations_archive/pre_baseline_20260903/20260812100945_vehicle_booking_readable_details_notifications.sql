-- Human-readable Vehicle Booking assignment details and notification context.

begin;

create or replace function app_private.get_vehicle_booking_assignment_display_impl(
  p_actor_user_id uuid,
  p_booking_id uuid
) returns table (
  assignment_id uuid,
  fulfillment_type text,
  vehicle_code text,
  vehicle_name text,
  vehicle_image_url text,
  operator_name text,
  operator_title text,
  operator_avatar_url text,
  external_provider_name text,
  external_driver_name text,
  external_vehicle_plate text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is distinct from public.current_app_user_id() then
    raise exception using errcode = '42501', message = 'VEHICLE_ACTOR_MISMATCH';
  end if;

  if not app_private.vehicle_user_can_view_booking(p_actor_user_id, p_booking_id) then
    raise exception using errcode = '42501', message = 'VEHICLE_BOOKING_ACCESS_DENIED';
  end if;

  return query
  select
    assignment.id,
    assignment.fulfillment_type,
    asset.code,
    asset.name,
    asset.image_url,
    coalesce(nullif(trim(employee.full_name), ''), nullif(trim(app_user.name), '')),
    nullif(trim(employee.title), ''),
    coalesce(nullif(trim(employee.avatar_url), ''), nullif(trim(app_user.avatar), '')),
    assignment.external_provider_name,
    assignment.external_driver_name,
    assignment.external_vehicle_plate
  from public.vehicle_booking_assignments assignment
  left join public.assets asset on asset.id = assignment.vehicle_asset_id
  left join public.users app_user on app_user.id = assignment.operator_user_id
  left join lateral (
    select employee_row.full_name, employee_row.title, employee_row.avatar_url
    from public.employees employee_row
    where employee_row.user_id = assignment.operator_user_id
    order by
      case when employee_row.status = 'Đang làm việc' then 0 else 1 end,
      employee_row.updated_at desc,
      employee_row.id
    limit 1
  ) employee on true
  where assignment.booking_id = p_booking_id
    and assignment.is_active
  order by assignment.version desc
  limit 1;
end;
$$;

create or replace function public.get_vehicle_booking_assignment_display(
  p_booking_id uuid
) returns table (
  assignment_id uuid,
  fulfillment_type text,
  vehicle_code text,
  vehicle_name text,
  vehicle_image_url text,
  operator_name text,
  operator_title text,
  operator_avatar_url text,
  external_provider_name text,
  external_driver_name text,
  external_vehicle_plate text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_vehicle_booking_assignment_display_impl(
    public.current_app_user_id(),
    p_booking_id
  );
$$;

revoke all on function public.get_vehicle_booking_assignment_display(uuid) from public, anon, service_role;
grant execute on function public.get_vehicle_booking_assignment_display(uuid) to authenticated;
revoke all on function app_private.get_vehicle_booking_assignment_display_impl(uuid, uuid) from public, anon, service_role;
grant execute on function app_private.get_vehicle_booking_assignment_display_impl(uuid, uuid) to authenticated;

create or replace function app_private.build_vehicle_booking_notification_context(
  p_booking_id uuid,
  p_assignment_id uuid,
  p_recipient_user_id uuid,
  p_event_type text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_assignment public.vehicle_booking_assignments%rowtype;
  v_requester_name text;
  v_driver_name text;
begin
  select booking.* into v_booking
  from public.vehicle_bookings booking
  where booking.id = p_booking_id;

  if not found then
    return null;
  end if;

  if p_assignment_id is not null then
    select assignment.* into v_assignment
    from public.vehicle_booking_assignments assignment
    where assignment.booking_id = p_booking_id
      and assignment.id = p_assignment_id;
  end if;

  if v_assignment.id is null
     and p_event_type = 'BOOKING_REASSIGNED_OLD_OPERATOR'
     and p_recipient_user_id is not null then
    select assignment.* into v_assignment
    from public.vehicle_booking_assignments assignment
    where assignment.booking_id = p_booking_id
      and not assignment.is_active
      and assignment.operator_user_id = p_recipient_user_id
      and assignment.superseded_at is not null
    order by assignment.superseded_at desc, assignment.version desc
    limit 1;
  end if;

  if v_assignment.id is null then
    select assignment.* into v_assignment
    from public.vehicle_booking_assignments assignment
    where assignment.booking_id = p_booking_id
      and assignment.is_active
    order by assignment.version desc
    limit 1;
  end if;

  select coalesce(
    nullif(trim(employee.full_name), ''),
    nullif(trim(app_user.name), ''),
    'Chưa có thông tin'
  ) into v_requester_name
  from public.users app_user
  left join lateral (
    select employee_row.full_name
    from public.employees employee_row
    where employee_row.user_id = app_user.id
    order by
      case when employee_row.status = 'Đang làm việc' then 0 else 1 end,
      employee_row.updated_at desc,
      employee_row.id
    limit 1
  ) employee on true
  where app_user.id = v_booking.requester_user_id;

  v_requester_name := coalesce(v_requester_name, 'Chưa có thông tin');

  if v_assignment.id is not null then
    if nullif(trim(v_assignment.external_driver_name), '') is not null then
      v_driver_name := trim(v_assignment.external_driver_name);
    elsif v_assignment.operator_user_id is not null then
      select coalesce(
        nullif(trim(employee.full_name), ''),
        nullif(trim(app_user.name), '')
      ) into v_driver_name
      from public.users app_user
      left join lateral (
        select employee_row.full_name
        from public.employees employee_row
        where employee_row.user_id = app_user.id
        order by
          case when employee_row.status = 'Đang làm việc' then 0 else 1 end,
          employee_row.updated_at desc,
          employee_row.id
        limit 1
      ) employee on true
      where app_user.id = v_assignment.operator_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'booking_code', v_booking.booking_code,
    'event_type', coalesce(nullif(trim(p_event_type), ''), 'BOOKING_UPDATED'),
    'requester_name', v_requester_name,
    'purpose', coalesce(nullif(trim(v_booking.purpose), ''), 'Chưa có nội dung'),
    'driver_name', coalesce(nullif(trim(v_driver_name), ''), 'Chưa phân công'),
    'pickup_location', coalesce(nullif(trim(v_booking.pickup_location_text), ''), 'Chưa có thông tin'),
    'destination', coalesce(nullif(trim(v_booking.destination_text), ''), 'Chưa có thông tin')
  );
end;
$$;

revoke all on function app_private.build_vehicle_booking_notification_context(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;

create or replace function app_private.insert_vehicle_booking_notification(
  p_outbox_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox app_private.vehicle_booking_notification_outbox%rowtype;
  v_booking_id uuid;
  v_assignment_id uuid;
  v_context jsonb;
  v_purpose text;
  v_compact_purpose text;
  v_message text;
  v_notification_id uuid;
begin
  select outbox.* into v_outbox
  from app_private.vehicle_booking_notification_outbox outbox
  where outbox.id = p_outbox_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'VEHICLE_NOTIFICATION_OUTBOX_NOT_FOUND';
  end if;

  if coalesce(v_outbox.payload ->> 'booking_id', '')
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_booking_id := (v_outbox.payload ->> 'booking_id')::uuid;
  end if;

  if coalesce(v_outbox.payload ->> 'assignment_id', '')
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_assignment_id := (v_outbox.payload ->> 'assignment_id')::uuid;
  end if;

  v_context := app_private.build_vehicle_booking_notification_context(
    v_booking_id,
    v_assignment_id,
    v_outbox.recipient_user_id,
    v_outbox.event_type
  );

  if v_context is null then
    raise exception using errcode = 'P0001', message = 'VEHICLE_NOTIFICATION_BOOKING_NOT_FOUND';
  end if;

  v_purpose := v_context ->> 'purpose';
  v_compact_purpose := case
    when char_length(v_purpose) > 80 then left(v_purpose, 80) || '…'
    else v_purpose
  end;
  v_message := concat(
    'Người đặt: ', v_context ->> 'requester_name',
    ' · Nội dung: ', v_compact_purpose,
    ' · Tài xế: ', v_context ->> 'driver_name',
    ' · ', v_context ->> 'pickup_location',
    ' → ', v_context ->> 'destination'
  );

  insert into public.notifications(
    user_id, title, body, type, priority, module, link, metadata,
    category, message, severity, source_type, source_id,
    push_enabled, action_url, entity_type, entity_id
  ) values (
    v_outbox.recipient_user_id::text,
    app_private.vehicle_notification_title(v_outbox.event_type),
    v_message,
    'info', 'normal', 'VEHICLE_BOOKING',
    '/booking/vehicle/my?booking=' || v_booking_id,
    coalesce(v_outbox.payload, '{}'::jsonb)
      || v_context
      || jsonb_build_object('eventKey', v_outbox.event_key),
    'vehicle_booking', v_message, 'info', 'vehicle_booking',
    v_booking_id::text, true,
    '/booking/vehicle/my?booking=' || v_booking_id,
    'vehicle_booking', v_booking_id
  ) returning id into v_notification_id;

  return v_notification_id;
end;
$$;

revoke all on function app_private.insert_vehicle_booking_notification(uuid) from public, anon, authenticated, service_role;

create or replace function app_private.deliver_vehicle_notification(
  p_outbox_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox app_private.vehicle_booking_notification_outbox%rowtype;
  v_notification_id uuid;
begin
  perform app_private.require_vehicle_notification_worker();

  select * into v_outbox
  from app_private.vehicle_booking_notification_outbox
  where id = p_outbox_id
  for update;

  if not found or v_outbox.status = 'DELIVERED' then
    return jsonb_build_object('delivered', false);
  end if;
  if v_outbox.status <> 'PROCESSING' then
    raise exception using errcode = 'P0001', message = 'VEHICLE_NOTIFICATION_NOT_CLAIMED';
  end if;

  v_notification_id := app_private.insert_vehicle_booking_notification(v_outbox.id);

  update app_private.vehicle_booking_notification_outbox
  set status = 'DELIVERED', delivered_at = now(), locked_at = null,
      last_error = null, updated_at = now()
  where id = v_outbox.id;

  return jsonb_build_object('delivered', true, 'notificationId', v_notification_id);
end;
$$;

create or replace function app_private.process_vehicle_notification_outbox(
  p_limit integer default 50
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox record;
  v_processed integer := 0;
begin
  update app_private.vehicle_booking_notification_outbox outbox
  set status = 'FAILED', locked_at = null,
      last_error = 'Stale PROCESSING lease recovered', available_at = now(), updated_at = now()
  where outbox.status = 'PROCESSING'
    and outbox.locked_at < now() - interval '15 minutes'
    and outbox.attempt_count < 10;

  for v_outbox in
    select outbox.*
    from app_private.vehicle_booking_notification_outbox outbox
    where outbox.status in ('PENDING', 'FAILED')
      and outbox.attempt_count < 10
      and outbox.available_at <= now()
    order by outbox.available_at, outbox.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update skip locked
  loop
    begin
      update app_private.vehicle_booking_notification_outbox
      set status = 'PROCESSING', locked_at = now(),
          attempt_count = attempt_count + 1, updated_at = now()
      where id = v_outbox.id;

      perform app_private.insert_vehicle_booking_notification(v_outbox.id);

      update app_private.vehicle_booking_notification_outbox
      set status = 'DELIVERED', delivered_at = now(), locked_at = null,
          last_error = null, updated_at = now()
      where id = v_outbox.id;
      v_processed := v_processed + 1;
    exception when others then
      update app_private.vehicle_booking_notification_outbox
      set status = 'FAILED', locked_at = null, last_error = left(sqlerrm, 500),
          available_at = now() + interval '5 minutes', updated_at = now()
      where id = v_outbox.id;
    end;
  end loop;

  return v_processed;
end;
$$;

create or replace function app_private.backfill_vehicle_booking_notification_context()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification record;
  v_booking_text text;
  v_assignment_text text;
  v_recipient_text text;
  v_booking_id uuid;
  v_assignment_id uuid;
  v_recipient_user_id uuid;
  v_event_type text;
  v_context jsonb;
  v_purpose text;
  v_compact_purpose text;
  v_message text;
  v_updated bigint := 0;
begin
  for v_notification in
    select notification.id, notification.user_id, notification.source_id,
      notification.entity_id, notification.metadata
    from public.notifications notification
    where notification.category = 'vehicle_booking'
       or notification.source_type = 'vehicle_booking'
       or notification.entity_type = 'vehicle_booking'
  loop
    v_booking_id := null;
    v_assignment_id := null;
    v_recipient_user_id := null;
    v_context := null;

    v_booking_text := coalesce(
      nullif(v_notification.metadata ->> 'booking_id', ''),
      nullif(v_notification.metadata ->> 'bookingId', ''),
      nullif(v_notification.entity_id::text, ''),
      nullif(v_notification.source_id, '')
    );
    v_assignment_text := nullif(v_notification.metadata ->> 'assignment_id', '');
    v_recipient_text := nullif(v_notification.user_id, '');
    v_event_type := coalesce(
      nullif(v_notification.metadata ->> 'event_type', ''),
      nullif(v_notification.metadata ->> 'eventType', ''),
      'BOOKING_UPDATED'
    );

    if coalesce(v_booking_text, '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_booking_id := v_booking_text::uuid;
    end if;
    if coalesce(v_assignment_text, '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_assignment_id := v_assignment_text::uuid;
    end if;
    if coalesce(v_recipient_text, '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_recipient_user_id := v_recipient_text::uuid;
    end if;

    if v_booking_id is null then
      continue;
    end if;

    v_context := app_private.build_vehicle_booking_notification_context(
      v_booking_id,
      v_assignment_id,
      v_recipient_user_id,
      v_event_type
    );
    if v_context is null then
      continue;
    end if;

    v_purpose := v_context ->> 'purpose';
    v_compact_purpose := case
      when char_length(v_purpose) > 80 then left(v_purpose, 80) || '…'
      else v_purpose
    end;
    v_message := concat(
      'Người đặt: ', v_context ->> 'requester_name',
      ' · Nội dung: ', v_compact_purpose,
      ' · Tài xế: ', v_context ->> 'driver_name',
      ' · ', v_context ->> 'pickup_location',
      ' → ', v_context ->> 'destination'
    );

    update public.notifications notification
    set metadata = coalesce(notification.metadata, '{}'::jsonb) || v_context,
        message = v_message,
        body = v_message
    where notification.id = v_notification.id;

    v_updated := v_updated + 1;
  end loop;

  return v_updated;
end;
$$;

revoke all on function app_private.backfill_vehicle_booking_notification_context() from public, anon, authenticated, service_role;

select app_private.backfill_vehicle_booking_notification_context();

commit;

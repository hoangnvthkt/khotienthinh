-- Vehicle Booking Phase 1.1C: feedback cron and notification delivery.
-- Cloud-only additive migration; safe to re-run.

begin;

alter table app_private.vehicle_booking_notification_outbox
  add column if not exists event_type text,
  add column if not exists delivered_at timestamptz;

update app_private.vehicle_booking_notification_outbox
set event_type = coalesce(
  nullif(payload ->> 'event_type', ''),
  case
    when event_key like 'BOOKING_SUBMITTED_%' then 'BOOKING_SUBMITTED'
    else 'BOOKING_UPDATED'
  end
)
where event_type is null;

alter table app_private.vehicle_booking_notification_outbox
  alter column event_type set default 'BOOKING_UPDATED',
  alter column event_type set not null;

do $outbox_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.vehicle_booking_notification_outbox'::regclass
      and conname = 'vehicle_notification_outbox_attempt_count_check'
  ) then
    alter table app_private.vehicle_booking_notification_outbox
      add constraint vehicle_notification_outbox_attempt_count_check
      check (attempt_count >= 0 and attempt_count <= 10);
  end if;
end;
$outbox_constraints$;

drop index if exists app_private.idx_vehicle_notification_outbox_queue;
create index idx_vehicle_notification_outbox_claimable
  on app_private.vehicle_booking_notification_outbox(available_at, id)
  where status in ('PENDING', 'FAILED');
create index if not exists idx_vehicle_notification_outbox_stale_processing
  on app_private.vehicle_booking_notification_outbox(locked_at, id)
  where status = 'PROCESSING';

create or replace function app_private.vehicle_notification_title(p_event_type text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_event_type
    when 'BOOKING_SUBMITTED' then 'Yêu cầu đặt xe cần duyệt'
    when 'BOOKING_REJECTED' then 'Yêu cầu đặt xe bị từ chối'
    when 'BOOKING_ASSIGNED' then 'Đã xếp phương án chuyến xe'
    when 'HANDOVER_ASSIGNED' then 'Bạn được giao bàn giao xe'
    when 'BOOKING_REASSIGNED' then 'Phương án chuyến xe đã thay đổi'
    when 'BOOKING_REASSIGNED_OLD_OPERATOR' then 'Bạn đã được gỡ khỏi chuyến xe'
    when 'BOOKING_REASSIGNED_NEW_OPERATOR' then 'Bạn được phân công chuyến xe'
    when 'ASSIGNMENT_DECLINED' then 'Người lái từ chối chuyến xe'
    when 'TRIP_COMPLETED' then 'Chuyến xe đã hoàn thành'
    when 'VEHICLE_RETURN_REQUIRED' then 'Cần nhận lại xe và chìa khóa'
    when 'BOOKING_CANCELLED' then 'Booking xe đã bị hủy'
    when 'BOOKING_NO_SHOW' then 'Booking xe được ghi nhận no-show'
    when 'FEEDBACK_AUTO_CLOSED' then 'Xác nhận sau chuyến đã tự đóng'
    else 'Cập nhật booking xe'
  end;
$$;

create or replace function app_private.require_vehicle_notification_worker()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception using errcode = '42501', message = 'VEHICLE_NOTIFICATION_WORKER_FORBIDDEN';
  end if;
end;
$$;

create or replace function app_private.claim_vehicle_notification_outbox(
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows jsonb;
begin
  perform app_private.require_vehicle_notification_worker();

  update app_private.vehicle_booking_notification_outbox outbox
  set status = 'FAILED',
      locked_at = null,
      last_error = 'Stale PROCESSING lease recovered',
      available_at = now(),
      updated_at = now()
  where outbox.status = 'PROCESSING'
    and outbox.locked_at < now() - interval '15 minutes'
    and outbox.attempt_count < 10;

  with candidates as (
    select outbox.id
    from app_private.vehicle_booking_notification_outbox outbox
    where outbox.status in ('PENDING', 'FAILED')
      and outbox.attempt_count < 10
      and outbox.available_at <= now()
    order by outbox.available_at, outbox.id
    limit v_limit
    for update skip locked
  ), claimed as (
    update app_private.vehicle_booking_notification_outbox outbox
    set status = 'PROCESSING',
        locked_at = now(),
        attempt_count = outbox.attempt_count + 1,
        updated_at = now()
    from candidates
    where outbox.id = candidates.id
    returning outbox.id, outbox.event_key, outbox.event_type,
      outbox.recipient_user_id, outbox.payload, outbox.attempt_count
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'eventKey', event_key,
    'eventType', event_type,
    'recipientUserId', recipient_user_id,
    'payload', payload,
    'attemptCount', attempt_count
  )), '[]'::jsonb)
  into v_rows
  from claimed;

  return v_rows;
end;
$$;

create or replace function app_private.deliver_vehicle_notification(
  p_outbox_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox app_private.vehicle_booking_notification_outbox%rowtype;
  v_booking public.vehicle_bookings%rowtype;
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

  select * into v_booking
  from public.vehicle_bookings
  where id = nullif(v_outbox.payload ->> 'booking_id', '')::uuid;

  insert into public.notifications(
    user_id, title, body, type, priority, module, link, metadata,
    category, message, severity, source_type, source_id,
    push_enabled, action_url, entity_type, entity_id
  ) values (
    v_outbox.recipient_user_id::text,
    app_private.vehicle_notification_title(v_outbox.event_type),
    coalesce(v_booking.booking_code, v_outbox.payload ->> 'booking_code', 'Booking xe'),
    'info', 'normal', 'VEHICLE_BOOKING',
    '/booking/vehicles/' || coalesce(v_booking.id::text, v_outbox.payload ->> 'booking_id'),
    v_outbox.payload || jsonb_build_object('eventKey', v_outbox.event_key),
    'vehicle_booking',
    coalesce(v_booking.booking_code, v_outbox.payload ->> 'booking_code', 'Booking xe'),
    'info', 'vehicle_booking',
    coalesce(v_booking.id::text, v_outbox.payload ->> 'booking_id'),
    true,
    '/booking/vehicles/' || coalesce(v_booking.id::text, v_outbox.payload ->> 'booking_id'),
    'vehicle_booking',
    v_booking.id
  ) returning id into v_notification_id;

  update app_private.vehicle_booking_notification_outbox
  set status = 'DELIVERED', delivered_at = now(), locked_at = null,
      last_error = null, updated_at = now()
  where id = v_outbox.id;

  return jsonb_build_object('delivered', true, 'notificationId', v_notification_id);
end;
$$;

create or replace function app_private.fail_vehicle_notification_outbox(
  p_outbox_id uuid,
  p_error_message text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_attempt_count integer;
begin
  perform app_private.require_vehicle_notification_worker();
  select attempt_count into v_attempt_count
  from app_private.vehicle_booking_notification_outbox
  where id = p_outbox_id
  for update;
  if not found then return; end if;

  update app_private.vehicle_booking_notification_outbox
  set status = 'FAILED',
      locked_at = null,
      last_error = left(coalesce(p_error_message, 'Delivery failed'), 500),
      available_at = case
        when v_attempt_count >= 10 then now() + interval '100 years'
        else now() + make_interval(
          secs => least(3600, 60 * power(2, greatest(v_attempt_count - 1, 0)))::integer
        )
      end,
      updated_at = now()
  where id = p_outbox_id;
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
  v_booking public.vehicle_bookings%rowtype;
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

      select * into v_booking
      from public.vehicle_bookings
      where id = nullif(v_outbox.payload ->> 'booking_id', '')::uuid;

      insert into public.notifications(
        user_id, title, body, type, priority, module, link, metadata,
        category, message, severity, source_type, source_id,
        push_enabled, action_url, entity_type, entity_id
      ) values (
        v_outbox.recipient_user_id::text,
        app_private.vehicle_notification_title(v_outbox.event_type),
        coalesce(v_booking.booking_code, v_outbox.payload ->> 'booking_code', 'Booking xe'),
        'info', 'normal', 'VEHICLE_BOOKING',
        '/booking/vehicles/' || coalesce(v_booking.id::text, v_outbox.payload ->> 'booking_id'),
        v_outbox.payload || jsonb_build_object('eventKey', v_outbox.event_key),
        'vehicle_booking',
        coalesce(v_booking.booking_code, v_outbox.payload ->> 'booking_code', 'Booking xe'),
        'info', 'vehicle_booking',
        coalesce(v_booking.id::text, v_outbox.payload ->> 'booking_id'),
        true,
        '/booking/vehicles/' || coalesce(v_booking.id::text, v_outbox.payload ->> 'booking_id'),
        'vehicle_booking', v_booking.id
      );

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

create or replace function app_private.process_feedback_auto_close()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  with closed as (
    update public.vehicle_booking_feedback feedback
    set status = 'AUTO_CLOSED', submitted_at = now(), updated_at = now()
    from public.fleet_system_settings settings,
         public.vehicle_bookings booking
    where settings.id = 1
      and booking.id = feedback.booking_id
      and feedback.status = 'PENDING'
      and feedback.created_at <= now() - make_interval(hours => settings.feedback_auto_close_hours)
    returning feedback.booking_id, booking.requester_user_id, booking.booking_code
  ), enqueued as (
    insert into app_private.vehicle_booking_notification_outbox(
      event_key, event_type, recipient_user_id, payload
    )
    select
      'vehicle:' || closed.booking_id::text || ':FEEDBACK_AUTO_CLOSED:' || closed.requester_user_id::text,
      'FEEDBACK_AUTO_CLOSED',
      closed.requester_user_id,
      jsonb_build_object(
        'booking_id', closed.booking_id,
        'booking_code', closed.booking_code,
        'event_type', 'FEEDBACK_AUTO_CLOSED'
      )
    from closed
    on conflict (event_key, recipient_user_id) do nothing
    returning 1
  )
  select count(*) into v_count from closed;
  return v_count;
end;
$$;

create or replace function public.claim_vehicle_notification_outbox(p_limit integer default 50)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.claim_vehicle_notification_outbox(p_limit);
$$;

create or replace function public.deliver_vehicle_notification(p_outbox_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.deliver_vehicle_notification(p_outbox_id);
$$;

create or replace function public.fail_vehicle_notification_outbox(
  p_outbox_id uuid,
  p_error_message text
) returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.fail_vehicle_notification_outbox(p_outbox_id, p_error_message);
$$;

create or replace function public.process_vehicle_feedback_auto_close()
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app_private.process_feedback_auto_close();
$$;

revoke all on function app_private.vehicle_notification_title(text) from public, anon, authenticated;
revoke all on function app_private.require_vehicle_notification_worker() from public, anon, authenticated;
revoke all on function app_private.claim_vehicle_notification_outbox(integer) from public, anon, authenticated;
revoke all on function app_private.deliver_vehicle_notification(uuid) from public, anon, authenticated;
revoke all on function app_private.fail_vehicle_notification_outbox(uuid, text) from public, anon, authenticated;
revoke all on function app_private.process_vehicle_notification_outbox(integer) from public, anon, authenticated;
revoke all on function app_private.process_feedback_auto_close() from public, anon, authenticated;
revoke all on function app_private.claim_notification_outbox_batch(integer) from public, anon, authenticated;

revoke all on function public.claim_vehicle_notification_outbox(integer) from public, anon, authenticated;
revoke all on function public.deliver_vehicle_notification(uuid) from public, anon, authenticated;
revoke all on function public.fail_vehicle_notification_outbox(uuid, text) from public, anon, authenticated;
revoke all on function public.process_vehicle_feedback_auto_close() from public, anon, authenticated;
grant execute on function app_private.claim_vehicle_notification_outbox(integer) to service_role;
grant execute on function app_private.deliver_vehicle_notification(uuid) to service_role;
grant execute on function app_private.fail_vehicle_notification_outbox(uuid, text) to service_role;
grant execute on function app_private.process_feedback_auto_close() to service_role;
grant execute on function public.claim_vehicle_notification_outbox(integer) to service_role;
grant execute on function public.deliver_vehicle_notification(uuid) to service_role;
grant execute on function public.fail_vehicle_notification_outbox(uuid, text) to service_role;
grant execute on function public.process_vehicle_feedback_auto_close() to service_role;

select cron.schedule(
  'vehicle-booking-feedback-auto-close',
  '*/5 * * * *',
  'select app_private.process_feedback_auto_close();'
);
select cron.schedule(
  'vehicle-booking-notification-outbox',
  '* * * * *',
  'select app_private.process_vehicle_notification_outbox(50);'
);

commit;

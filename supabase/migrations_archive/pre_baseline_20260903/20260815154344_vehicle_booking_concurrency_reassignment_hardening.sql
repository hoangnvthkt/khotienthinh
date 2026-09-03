-- Booking concurrency and reassignment hardening.
-- Existing public RPC signatures remain unchanged. The triggers below make the
-- current command implementations safe when a declined booking is dispatched again.

set lock_timeout = '10s';

create or replace function app_private.vehicle_normalize_assignment_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_version integer;
begin
  select coalesce(max(assignment.version), 0) + 1
  into v_next_version
  from public.vehicle_booking_assignments assignment
  where assignment.booking_id = new.booking_id;

  new.version := greatest(coalesce(new.version, 1), v_next_version);
  return new;
end;
$$;

revoke all on function app_private.vehicle_normalize_assignment_version()
from public, anon, authenticated;

drop trigger if exists trg_vehicle_normalize_assignment_version
on public.vehicle_booking_assignments;

create trigger trg_vehicle_normalize_assignment_version
before insert on public.vehicle_booking_assignments
for each row execute function app_private.vehicle_normalize_assignment_version();

create or replace function app_private.vehicle_snapshot_assignment_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_version integer;
begin
  select assignment.version
  into v_assignment_version
  from public.vehicle_booking_assignments assignment
  where assignment.id = new.assignment_id
    and assignment.booking_id = new.booking_id;

  if v_assignment_version is null then
    raise exception using errcode = '23503', message = 'ASSIGNMENT_NOT_FOUND';
  end if;

  new.assignment_version_snapshot := v_assignment_version;
  return new;
end;
$$;

revoke all on function app_private.vehicle_snapshot_assignment_version()
from public, anon, authenticated;

drop trigger if exists trg_vehicle_snapshot_assignment_version
on public.vehicle_trip_logs;

create trigger trg_vehicle_snapshot_assignment_version
before insert on public.vehicle_trip_logs
for each row execute function app_private.vehicle_snapshot_assignment_version();

create or replace function app_private.vehicle_release_declined_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.operator_confirmation_status = 'DECLINED'
     and old.operator_confirmation_status is distinct from 'DECLINED'
     and old.is_active then
    new.is_active := false;
    new.released_at := coalesce(new.released_at, now());

    update public.vehicle_bookings
    set status = 'WAITING_DISPATCH',
        updated_at = now()
    where id = new.booking_id
      and status = 'ASSIGNED';

    delete from public.vehicle_trip_logs
    where booking_id = new.booking_id
      and assignment_id = new.id
      and trip_status = 'NOT_STARTED';
  end if;

  return new;
end;
$$;

revoke all on function app_private.vehicle_release_declined_assignment()
from public, anon, authenticated;

drop trigger if exists trg_vehicle_release_declined_assignment
on public.vehicle_booking_assignments;

create trigger trg_vehicle_release_declined_assignment
before update of operator_confirmation_status on public.vehicle_booking_assignments
for each row execute function app_private.vehicle_release_declined_assignment();

-- A scheduled exclusion constraint protects planned ranges. This partial unique
-- index additionally protects runtime overruns: one operator can only have one
-- trip in progress, even if a later scheduled trip did not originally overlap.
do $$
begin
  if exists (
    select 1
    from public.vehicle_trip_logs trip
    where trip.trip_status = 'IN_PROGRESS'
      and trip.operator_user_id_snapshot is not null
    group by trip.operator_user_id_snapshot
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'OPERATOR_ALREADY_HAS_MULTIPLE_IN_PROGRESS_TRIPS';
  end if;
end;
$$;

create unique index if not exists vehicle_trip_logs_one_active_trip_per_operator
on public.vehicle_trip_logs(operator_user_id_snapshot)
where trip_status = 'IN_PROGRESS'
  and operator_user_id_snapshot is not null;

-- Assignment notifications must be repeatable for later assignment versions.
-- The assignment id is included only when present, preserving existing event keys
-- for events unrelated to a concrete assignment.
create or replace function app_private.vehicle_enqueue_notification(
  p_booking_id uuid,
  p_event_type text,
  p_recipient_user_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text := coalesce(nullif(trim(p_event_type), ''), 'BOOKING_UPDATED');
  v_assignment_id text := nullif(trim(coalesce(p_payload ->> 'assignment_id', '')), '');
  v_event_key text;
begin
  if p_recipient_user_id is null then
    return;
  end if;

  v_event_key := 'vehicle:' || p_booking_id::text || ':' || v_event_type || ':' || p_recipient_user_id::text;
  if v_assignment_id is not null then
    v_event_key := v_event_key || ':' || v_assignment_id;
  end if;

  insert into app_private.vehicle_booking_notification_outbox (
    event_key,
    recipient_user_id,
    event_type,
    payload
  ) values (
    v_event_key,
    p_recipient_user_id,
    v_event_type,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'booking_id', p_booking_id,
      'event_type', v_event_type
    )
  ) on conflict (event_key, recipient_user_id) do nothing;
end;
$$;

revoke all on function app_private.vehicle_enqueue_notification(uuid, text, uuid, jsonb)
from public, anon, authenticated;

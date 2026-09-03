-- Vehicle Booking Phase 3 hardening: bind private commands to the session
-- actor and repair assignment event semantics in the operational timeline.

begin;

create or replace function app_private.vehicle_require_current_actor(
  p_actor_user_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is distinct from public.current_app_user_id() then
    raise exception using
      errcode = '42501',
      message = 'VEHICLE_ACTOR_MISMATCH';
  end if;
end;
$$;

revoke all on function app_private.vehicle_require_current_actor(uuid)
  from public, anon, authenticated;

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
begin
  if p_recipient_user_id is null then
    return;
  end if;

  insert into app_private.vehicle_booking_notification_outbox (
    event_key, event_type, recipient_user_id, payload
  ) values (
    'vehicle:' || p_booking_id::text || ':' || p_event_type || ':' || p_recipient_user_id::text,
    p_event_type,
    p_recipient_user_id,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'booking_id', p_booking_id,
      'event_type', p_event_type
    )
  ) on conflict (event_key, recipient_user_id) do nothing;
end;
$$;

revoke all on function app_private.vehicle_enqueue_notification(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

alter function app_private.command_submit_vehicle_feedback(
  uuid, uuid, boolean, integer, text[], text, text
) rename to command_submit_vehicle_feedback_phase3_impl;

revoke all on function app_private.command_submit_vehicle_feedback_phase3_impl(
  uuid, uuid, boolean, integer, text[], text, text
) from public, anon, authenticated;

create or replace function app_private.command_submit_vehicle_feedback(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_is_issue boolean,
  p_rating integer default null,
  p_positive_tags text[] default null,
  p_issue_category text default null,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.vehicle_require_current_actor(p_actor_user_id);
  return app_private.command_submit_vehicle_feedback_phase3_impl(
    p_actor_user_id,
    p_booking_id,
    p_is_issue,
    p_rating,
    p_positive_tags,
    p_issue_category,
    p_comment
  );
end;
$$;

revoke all on function app_private.command_submit_vehicle_feedback(
  uuid, uuid, boolean, integer, text[], text, text
) from public, anon;
grant execute on function app_private.command_submit_vehicle_feedback(
  uuid, uuid, boolean, integer, text[], text, text
) to authenticated;

create or replace function public.submit_vehicle_feedback(
  p_booking_id uuid,
  p_is_issue boolean,
  p_rating integer default null,
  p_positive_tags text[] default null,
  p_issue_category text default null,
  p_comment text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_submit_vehicle_feedback(
    public.current_app_user_id(),
    p_booking_id,
    p_is_issue,
    p_rating,
    p_positive_tags,
    p_issue_category,
    p_comment
  );
$$;

revoke all on function public.submit_vehicle_feedback(
  uuid, boolean, integer, text[], text, text
) from public, anon;
grant execute on function public.submit_vehicle_feedback(
  uuid, boolean, integer, text[], text, text
) to authenticated;

alter function app_private.command_transition_vehicle_booking_issue(
  uuid, uuid, text, text
) rename to command_transition_vehicle_booking_issue_phase3_impl;

revoke all on function app_private.command_transition_vehicle_booking_issue_phase3_impl(
  uuid, uuid, text, text
) from public, anon, authenticated;

create or replace function app_private.command_transition_vehicle_booking_issue(
  p_actor_user_id uuid,
  p_issue_id uuid,
  p_target_status text,
  p_resolution_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.vehicle_require_current_actor(p_actor_user_id);
  return app_private.command_transition_vehicle_booking_issue_phase3_impl(
    p_actor_user_id,
    p_issue_id,
    p_target_status,
    p_resolution_note
  );
end;
$$;

revoke all on function app_private.command_transition_vehicle_booking_issue(
  uuid, uuid, text, text
) from public, anon;
grant execute on function app_private.command_transition_vehicle_booking_issue(
  uuid, uuid, text, text
) to authenticated;

create or replace function public.transition_vehicle_booking_issue(
  p_issue_id uuid,
  p_target_status text,
  p_resolution_note text default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_transition_vehicle_booking_issue(
    public.current_app_user_id(),
    p_issue_id,
    p_target_status,
    p_resolution_note
  );
$$;

revoke all on function public.transition_vehicle_booking_issue(uuid, text, text)
  from public, anon;
grant execute on function public.transition_vehicle_booking_issue(uuid, text, text)
  to authenticated;

create or replace function public.get_vehicle_booking_audit_timeline(
  p_booking_id uuid default null,
  p_department_id uuid default null,
  p_event_type text default null,
  p_from_at timestamptz default null,
  p_to_at timestamptz default null,
  p_limit integer default 50,
  p_cursor_occurred_at timestamptz default null,
  p_cursor_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_effective_department_id uuid := p_department_id;
  v_booking_department_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_next_cursor jsonb := null;
begin
  if p_from_at is not null and p_to_at is not null and p_to_at <= p_from_at then
    raise exception using errcode = '22023', message = 'INVALID_AUDIT_PERIOD';
  end if;
  if p_event_type is not null and p_event_type not in (
    'BOOKING_EVENT', 'ASSIGNMENT_VERSION', 'HANDOVER'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_AUDIT_EVENT_TYPE';
  end if;

  if p_booking_id is not null then
    select booking.department_id_snapshot
    into v_booking_department_id
    from public.vehicle_bookings booking
    where booking.id = p_booking_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'BOOKING_NOT_FOUND';
    end if;
    if p_department_id is not null
       and p_department_id is distinct from v_booking_department_id then
      raise exception using errcode = '22023', message = 'BOOKING_DEPARTMENT_MISMATCH';
    end if;
    v_effective_department_id := v_booking_department_id;
  end if;

  perform app_private.vehicle_require_audit_scope(
    public.current_app_user_id(),
    v_effective_department_id
  );

  with timeline as (
    select
      'AUDIT:' || audit.id::text as synthetic_id,
      booking.id as booking_id,
      booking.booking_code,
      booking.department_id_snapshot as department_id,
      audit.created_at as occurred_at,
      'BOOKING_EVENT'::text as source_type,
      coalesce(audit.changes ->> 'event', audit.action) as event_type,
      coalesce(audit.description, audit.changes ->> 'event', audit.action) as title,
      coalesce(actor.name, actor.email, nullif(audit.user_name, '')) as actor_name,
      coalesce(audit.description, audit.action) as summary,
      jsonb_strip_nulls(jsonb_build_object(
        'oldStatus', audit.old_data ->> 'status',
        'newStatus', audit.new_data ->> 'status',
        'rating', audit.new_data ->> 'rating',
        'issueCategory', audit.new_data ->> 'issue_category',
        'approvalSource', audit.new_data ->> 'approval_source',
        'closeReason', audit.new_data ->> 'close_reason'
      )) as details
    from public.audit_trail audit
    join public.vehicle_bookings booking on booking.id::text = audit.record_id
    left join public.users actor on actor.id::text = audit.user_id
    where audit.module = 'VEHICLE_BOOKING'

    union all

    select
      'ASSIGNMENT_CREATED:' || assignment.id::text,
      booking.id,
      booking.booking_code,
      booking.department_id_snapshot,
      assignment.assigned_at,
      'ASSIGNMENT_VERSION'::text,
      'ASSIGNMENT_CREATED'::text,
      'Phân công phiên bản ' || assignment.version::text,
      coalesce(actor.name, actor.email),
      'Tạo phương án điều phối',
      jsonb_strip_nulls(jsonb_build_object(
        'version', assignment.version,
        'fulfillmentType', assignment.fulfillment_type,
        'vehicleAssetId', assignment.vehicle_asset_id,
        'operatorUserId', assignment.operator_user_id,
        'dispatchReasonCode', assignment.dispatch_reason_code
      ))
    from public.vehicle_booking_assignments assignment
    join public.vehicle_bookings booking on booking.id = assignment.booking_id
    left join public.users actor on actor.id = assignment.assigned_by_user_id

    union all

    select
      'ASSIGNMENT_SUPERSEDED:' || assignment.id::text,
      booking.id,
      booking.booking_code,
      booking.department_id_snapshot,
      assignment.superseded_at,
      'ASSIGNMENT_VERSION'::text,
      'ASSIGNMENT_SUPERSEDED'::text,
      'Thay đổi phân công phiên bản ' || assignment.version::text,
      coalesce(actor.name, actor.email),
      'Thay đổi phương án điều phối',
      jsonb_strip_nulls(jsonb_build_object(
        'version', assignment.version,
        'fulfillmentType', assignment.fulfillment_type,
        'vehicleAssetId', assignment.vehicle_asset_id,
        'operatorUserId', assignment.operator_user_id,
        'supersedeReason', assignment.supersede_reason,
        'dispatchReasonCode', assignment.dispatch_reason_code
      ))
    from public.vehicle_booking_assignments assignment
    join public.vehicle_bookings booking on booking.id = assignment.booking_id
    left join public.users actor on actor.id = assignment.superseded_by_user_id
    where assignment.superseded_at is not null

    union all

    select
      'HANDOVER:' || handover.id::text,
      booking.id,
      booking.booking_code,
      booking.department_id_snapshot,
      handover.confirmed_at,
      'HANDOVER'::text,
      handover.event_type,
      case handover.event_type
        when 'OUTBOUND_HANDOVER' then 'Bàn giao xe và chìa khóa'
        else 'Nhận lại xe và chìa khóa'
      end,
      coalesce(actor.name, actor.email),
      case handover.event_type
        when 'OUTBOUND_HANDOVER' then 'Xác nhận bàn giao xe tự lái'
        else 'Xác nhận nhận lại xe tự lái'
      end,
      jsonb_strip_nulls(jsonb_build_object(
        'assignmentVersion', handover.assignment_version_snapshot,
        'vehicleAssetId', handover.vehicle_asset_id_snapshot,
        'confirmedOnBehalf', handover.confirmed_on_behalf,
        'overrideReason', handover.override_reason,
        'note', handover.note
      ))
    from public.vehicle_handover_logs handover
    join public.vehicle_bookings booking on booking.id = handover.booking_id
    left join public.users actor on actor.id = handover.officer_user_id
  ), filtered_timeline as (
    select timeline.*
    from timeline
    where (p_booking_id is null or timeline.booking_id = p_booking_id)
      and (
        v_effective_department_id is null
        or timeline.department_id = v_effective_department_id
      )
      and (p_event_type is null or timeline.source_type = p_event_type)
      and (p_from_at is null or timeline.occurred_at >= p_from_at)
      and (p_to_at is null or timeline.occurred_at < p_to_at)
      and (
        p_cursor_occurred_at is null
        or (timeline.occurred_at, timeline.synthetic_id)
          < (p_cursor_occurred_at, p_cursor_id)
      )
    order by timeline.occurred_at desc, timeline.synthetic_id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row.synthetic_id,
    'bookingId', row.booking_id,
    'bookingCode', row.booking_code,
    'occurredAt', row.occurred_at,
    'sourceType', row.source_type,
    'eventType', row.event_type,
    'title', row.title,
    'actorName', row.actor_name,
    'summary', row.summary,
    'details', row.details
  ) order by row.occurred_at desc, row.synthetic_id desc), '[]'::jsonb)
  into v_rows
  from filtered_timeline row;

  if jsonb_array_length(v_rows) > v_limit then
    v_items := v_rows - v_limit;
    v_next_cursor := jsonb_build_object(
      'occurredAt', v_items -> (v_limit - 1) ->> 'occurredAt',
      'id', v_items -> (v_limit - 1) ->> 'id'
    );
  else
    v_items := v_rows;
  end if;

  return jsonb_build_object('items', v_items, 'nextCursor', v_next_cursor);
end;
$$;

revoke all on function public.get_vehicle_booking_audit_timeline(
  uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text
) from public, anon;
grant execute on function public.get_vehicle_booking_audit_timeline(
  uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text
) to authenticated;

commit;

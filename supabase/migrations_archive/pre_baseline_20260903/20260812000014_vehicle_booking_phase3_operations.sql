-- Vehicle Booking Phase 3C/3D operational commands and scoped timelines.

begin;

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
declare
  v_booking public.vehicle_bookings%rowtype;
  v_feedback public.vehicle_booking_feedback%rowtype;
  v_issue_id uuid;
begin
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception using errcode = '22023', message = 'RATING_REQUIRED';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_positive_tags, array[]::text[])) tag
    where tag not in (
      'CLEAN_VEHICLE', 'COURTEOUS_DRIVER', 'ON_TIME', 'SAFE_DRIVING'
    )
  ) then
    raise exception using errcode = '22023', message = 'INVALID_POSITIVE_TAG';
  end if;

  if p_rating <= 3 and not p_is_issue then
    raise exception using errcode = '22023', message = 'LOW_RATING_REQUIRES_ISSUE';
  end if;

  if p_is_issue then
    if coalesce(p_issue_category, '') not in (
      'SAFETY', 'DRIVER_CONDUCT', 'VEHICLE_CONDITION',
      'SERVICE_DELAY', 'COST', 'OTHER'
    ) then
      raise exception using errcode = '22023', message = 'INVALID_ISSUE_CATEGORY';
    end if;
    if length(trim(coalesce(p_comment, ''))) not between 1 and 4000 then
      raise exception using errcode = '22023', message = 'ISSUE_COMMENT_INVALID';
    end if;
  end if;

  select * into v_booking
  from public.vehicle_bookings
  where id = p_booking_id
  for share;

  select * into v_feedback
  from public.vehicle_booking_feedback
  where booking_id = p_booking_id
  for update;

  if v_booking.id is null or v_feedback.id is null then
    raise exception using errcode = 'P0001', message = 'FEEDBACK_NOT_FOUND';
  end if;
  if v_booking.status <> 'COMPLETED' or v_feedback.status <> 'PENDING' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;
  if p_actor_user_id not in (
    v_booking.requester_user_id,
    coalesce(v_booking.trip_owner_user_id, v_booking.requester_user_id)
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Only requester or trip owner can submit feedback'
    );
  end if;

  if p_is_issue then
    insert into public.vehicle_booking_issues(
      booking_id, reporter_user_id, issue_category, comment
    ) values (
      p_booking_id, p_actor_user_id, p_issue_category, trim(p_comment)
    ) returning id into v_issue_id;

    update public.vehicle_booking_feedback
    set respondent_user_id = p_actor_user_id,
        status = 'ISSUE_REPORTED',
        rating = p_rating,
        positive_tags = coalesce(p_positive_tags, array[]::text[]),
        submitted_at = now(),
        updated_at = now()
    where id = v_feedback.id;

    perform app_private.vehicle_record_audit(
      p_actor_user_id,
      p_booking_id,
      'FEEDBACK_ISSUE_REPORTED',
      jsonb_build_object('status', v_feedback.status),
      jsonb_build_object(
        'status', 'ISSUE_REPORTED',
        'rating', p_rating,
        'issue_id', v_issue_id,
        'issue_category', p_issue_category
      ),
      'Ghi nhận phản ánh booking xe (nội dung đã ẩn)'
    );
  else
    update public.vehicle_booking_feedback
    set respondent_user_id = p_actor_user_id,
        status = 'CONFIRMED',
        rating = p_rating,
        positive_tags = coalesce(p_positive_tags, array[]::text[]),
        submitted_at = now(),
        updated_at = now()
    where id = v_feedback.id;

    perform app_private.vehicle_record_audit(
      p_actor_user_id,
      p_booking_id,
      'FEEDBACK_CONFIRMED',
      jsonb_build_object('status', v_feedback.status),
      jsonb_build_object('status', 'CONFIRMED', 'rating', p_rating),
      'Xác nhận dịch vụ chuyến xe'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'is_issue', p_is_issue,
    'issue_id', v_issue_id
  );
end;
$$;

revoke all on function app_private.command_submit_vehicle_feedback(
  uuid, uuid, boolean, integer, text[], text, text
) from public, anon;
grant execute on function app_private.command_submit_vehicle_feedback(
  uuid, uuid, boolean, integer, text[], text, text
) to authenticated;

commit;

begin;

create or replace function app_private.vehicle_require_audit_scope(
  p_actor_user_id uuid,
  p_department_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_department_id is null then
    if not app_private.vehicle_user_has_scoped_permission(
      p_actor_user_id,
      'booking.vehicle.view_audit',
      'global',
      '*'
    ) then
      perform app_private.vehicle_raise_permission_denied(
        'Global vehicle audit permission required'
      );
    end if;
  elsif not (
    app_private.vehicle_user_has_scoped_permission(
      p_actor_user_id,
      'booking.vehicle.view_audit',
      'global',
      '*'
    )
    or app_private.vehicle_user_has_scoped_permission(
      p_actor_user_id,
      'booking.vehicle.view_audit',
      'department',
      p_department_id::text
    )
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Department vehicle audit permission required'
    );
  end if;
end;
$$;

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
      'ASSIGNMENT:' || assignment.id::text,
      booking.id,
      booking.booking_code,
      booking.department_id_snapshot,
      assignment.assigned_at,
      'ASSIGNMENT_VERSION'::text,
      case when assignment.superseded_at is null
        then 'ASSIGNMENT_CREATED' else 'ASSIGNMENT_SUPERSEDED' end,
      'Phân công phiên bản ' || assignment.version::text,
      coalesce(actor.name, actor.email),
      case
        when assignment.superseded_at is null then 'Tạo phương án điều phối'
        else 'Thay đổi phương án điều phối'
      end,
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
    left join public.users actor on actor.id = assignment.assigned_by_user_id

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

revoke all on function app_private.vehicle_require_audit_scope(uuid, uuid)
  from public, anon, authenticated;

revoke all on function public.get_vehicle_booking_audit_timeline(
  uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text
) from public, anon;
grant execute on function public.get_vehicle_booking_audit_timeline(
  uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text
) to authenticated;

commit;

begin;

create or replace function app_private.vehicle_require_sensitive_issue_view(
  p_actor_user_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.vehicle_user_has_permission(
    p_actor_user_id,
    'booking.vehicle.view_sensitive_feedback'
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Sensitive feedback view permission required'
    );
  end if;
end;
$$;

create or replace function public.get_vehicle_booking_issues(
  p_status text default null,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_rows jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_next_cursor jsonb := null;
begin
  perform app_private.vehicle_require_sensitive_issue_view(
    public.current_app_user_id()
  );

  if p_status is not null and p_status not in (
    'PENDING', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ISSUE_STATUS';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', issue_rows.id,
    'bookingId', issue_rows.booking_id,
    'bookingCode', issue_rows.booking_code,
    'reporterUserId', issue_rows.reporter_user_id,
    'reporterName', issue_rows.reporter_name,
    'departmentName', issue_rows.department_name,
    'issueCategory', issue_rows.issue_category,
    'comment', issue_rows.comment,
    'rating', issue_rows.rating,
    'resolutionStatus', issue_rows.resolution_status,
    'resolutionNote', issue_rows.resolution_note,
    'resolvedByName', issue_rows.resolved_by_name,
    'resolvedAt', issue_rows.resolved_at,
    'createdAt', issue_rows.created_at
  ) order by issue_rows.created_at desc, issue_rows.id desc), '[]'::jsonb)
  into v_rows
  from (
    select
      issue.id,
      issue.booking_id,
      booking.booking_code,
      issue.reporter_user_id,
      coalesce(reporter.name, reporter.email, issue.reporter_user_id::text) as reporter_name,
      org.name as department_name,
      issue.issue_category,
      issue.comment,
      feedback.rating,
      issue.resolution_status,
      issue.resolution_note,
      coalesce(resolver.name, resolver.email) as resolved_by_name,
      issue.resolved_at,
      issue.created_at
    from public.vehicle_booking_issues issue
    join public.vehicle_bookings booking on booking.id = issue.booking_id
    left join public.vehicle_booking_feedback feedback
      on feedback.booking_id = issue.booking_id
    left join public.users reporter on reporter.id = issue.reporter_user_id
    left join public.users resolver on resolver.id = issue.resolved_by_user_id
    left join public.org_units org on org.id = booking.department_id_snapshot
    where (p_status is null or issue.resolution_status = p_status)
      and (
        p_cursor_created_at is null
        or (issue.created_at, issue.id) < (p_cursor_created_at, p_cursor_id)
      )
    order by issue.created_at desc, issue.id desc
    limit v_limit + 1
  ) issue_rows;

  if jsonb_array_length(v_rows) > v_limit then
    v_items := v_rows - v_limit;
    v_next_cursor := jsonb_build_object(
      'createdAt', v_items -> (v_limit - 1) ->> 'createdAt',
      'id', v_items -> (v_limit - 1) ->> 'id'
    );
  else
    v_items := v_rows;
  end if;

  return jsonb_build_object('items', v_items, 'nextCursor', v_next_cursor);
end;
$$;

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
declare
  v_issue public.vehicle_booking_issues%rowtype;
  v_booking public.vehicle_bookings%rowtype;
begin
  if not app_private.vehicle_user_has_permission(
    p_actor_user_id,
    'booking.vehicle.resolve_sensitive_feedback'
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Sensitive feedback resolution permission required'
    );
  end if;

  select * into v_issue
  from public.vehicle_booking_issues
  where id = p_issue_id
  for update;

  if v_issue.id is null then
    raise exception using errcode = 'P0001', message = 'ISSUE_NOT_FOUND';
  end if;

  if v_issue.resolution_status in ('RESOLVED', 'DISMISSED')
     and v_issue.resolution_status = p_target_status then
    return jsonb_build_object(
      'success', true,
      'status', v_issue.resolution_status,
      'idempotent', true
    );
  end if;

  if not (
    (v_issue.resolution_status = 'PENDING' and p_target_status = 'IN_REVIEW')
    or (
      v_issue.resolution_status = 'IN_REVIEW'
      and p_target_status in ('RESOLVED', 'DISMISSED')
    )
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_ISSUE_TRANSITION';
  end if;

  if p_target_status in ('RESOLVED', 'DISMISSED')
     and length(trim(coalesce(p_resolution_note, ''))) not between 1 and 4000 then
    raise exception using errcode = '22023', message = 'RESOLUTION_NOTE_INVALID';
  end if;

  update public.vehicle_booking_issues
  set resolution_status = p_target_status,
      resolution_note = case
        when p_target_status in ('RESOLVED', 'DISMISSED')
        then trim(p_resolution_note)
        else resolution_note
      end,
      resolved_by_user_id = case
        when p_target_status in ('RESOLVED', 'DISMISSED')
        then p_actor_user_id
        else null
      end,
      resolved_at = case
        when p_target_status in ('RESOLVED', 'DISMISSED')
        then now()
        else null
      end,
      updated_at = now()
  where id = p_issue_id;

  if p_target_status in ('RESOLVED', 'DISMISSED') then
    update public.vehicle_booking_feedback
    set status = 'RESOLVED', updated_at = now()
    where booking_id = v_issue.booking_id;
  end if;

  select * into v_booking
  from public.vehicle_bookings
  where id = v_issue.booking_id;

  perform app_private.vehicle_record_audit(
    p_actor_user_id,
    v_issue.booking_id,
    'FEEDBACK_ISSUE_STATUS_CHANGED',
    jsonb_build_object('status', v_issue.resolution_status),
    jsonb_build_object(
      'status', p_target_status,
      'issue_id', v_issue.id,
      'issue_category', v_issue.issue_category
    ),
    'Cập nhật trạng thái phản ánh booking xe (nội dung đã ẩn)'
  );

  if p_target_status in ('RESOLVED', 'DISMISSED') then
    perform app_private.vehicle_enqueue_notification(
      v_issue.booking_id,
      'ISSUE_RESOLVED',
      v_issue.reporter_user_id,
      jsonb_build_object(
        'booking_code', v_booking.booking_code,
        'resolution_status', p_target_status
      )
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', p_target_status,
    'idempotent', false
  );
end;
$$;

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

revoke all on function app_private.vehicle_require_sensitive_issue_view(uuid)
  from public, anon, authenticated;
revoke all on function app_private.command_transition_vehicle_booking_issue(
  uuid, uuid, text, text
) from public, anon;
grant execute on function app_private.command_transition_vehicle_booking_issue(
  uuid, uuid, text, text
) to authenticated;

revoke all on function public.get_vehicle_booking_issues(
  text, integer, timestamptz, uuid
) from public, anon;
grant execute on function public.get_vehicle_booking_issues(
  text, integer, timestamptz, uuid
) to authenticated;

revoke all on function public.transition_vehicle_booking_issue(uuid, text, text)
  from public, anon;
grant execute on function public.transition_vehicle_booking_issue(uuid, text, text)
  to authenticated;

commit;

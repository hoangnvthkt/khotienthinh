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

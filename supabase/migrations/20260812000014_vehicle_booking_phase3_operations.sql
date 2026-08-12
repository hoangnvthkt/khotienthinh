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

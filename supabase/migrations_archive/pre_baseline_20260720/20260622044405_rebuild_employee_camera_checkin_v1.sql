-- Rebuild the camera check-in write path around one small snake_case RPC.
-- The frontend no longer writes hrm_attendance directly from the Check-in page.

drop function if exists public.upsert_hrm_attendance(
  uuid, uuid, text, text,
  text, text, numeric,
  text, text,
  text, text,
  double precision, double precision,
  double precision, double precision,
  text, text, boolean, timestamptz
);

create or replace function public.employee_camera_checkin_v1(
  p_action text,
  p_employee_id uuid,
  p_work_date text,
  p_event_time text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_location_type text default null,
  p_location_id text default null,
  p_location_name text default null,
  p_distance_m integer default null,
  p_in_range boolean default null,
  p_image_url text default null,
  p_device_info jsonb default '{}'::jsonb
)
returns public.hrm_attendance
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.hrm_attendance;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_location_note text;
begin
  if auth.uid() is null then
    raise exception 'Phiên đăng nhập Supabase không hợp lệ.'
      using errcode = '28000';
  end if;

  if v_action not in ('check_in', 'check_out') then
    raise exception 'Hành động chấm công không hợp lệ: %', coalesce(p_action, '<null>')
      using errcode = '22023';
  end if;

  if p_employee_id is null then
    raise exception 'Thiếu employee_id.'
      using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_work_date, '')), '') is null then
    raise exception 'Thiếu ngày chấm công.'
      using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_event_time, '')), '') is null then
    raise exception 'Thiếu giờ chấm công.'
      using errcode = '22023';
  end if;

  if p_lat is not null and (p_lat < -90 or p_lat > 90) then
    raise exception 'Latitude không hợp lệ: %', p_lat
      using errcode = '22023';
  end if;

  if p_lng is not null and (p_lng < -180 or p_lng > 180) then
    raise exception 'Longitude không hợp lệ: %', p_lng
      using errcode = '22023';
  end if;

  if p_location_type is not null and p_location_type not in ('construction_site', 'office') then
    raise exception 'Loại địa điểm không hợp lệ: %', p_location_type
      using errcode = '22023';
  end if;

  v_location_note := concat_ws(
    ' | ',
    case when p_distance_m is not null then 'distance=' || p_distance_m::text || 'm' end,
    case when p_in_range is not null then 'in_range=' || p_in_range::text end,
    case when p_device_info <> '{}'::jsonb then 'device=' || left(p_device_info::text, 240) end
  );

  if v_action = 'check_in' then
    insert into public.hrm_attendance (
      id,
      "employeeId",
      date,
      status,
      "checkIn",
      "checkInPhoto",
      "checkInLat",
      "checkInLng",
      "constructionSiteId",
      "locationName",
      "locationType",
      "isOutOfRange",
      note,
      "createdAt"
    )
    values (
      gen_random_uuid(),
      p_employee_id,
      p_work_date,
      'present',
      p_event_time,
      p_image_url,
      p_lat,
      p_lng,
      case when p_location_type = 'construction_site' then p_location_id else null end,
      p_location_name,
      p_location_type,
      coalesce(not p_in_range, false),
      nullif(v_location_note, ''),
      now()
    )
    on conflict ("employeeId", date) do update
      set status = 'present',
          "checkIn" = coalesce(public.hrm_attendance."checkIn", excluded."checkIn"),
          "checkInPhoto" = coalesce(excluded."checkInPhoto", public.hrm_attendance."checkInPhoto"),
          "checkInLat" = coalesce(excluded."checkInLat", public.hrm_attendance."checkInLat"),
          "checkInLng" = coalesce(excluded."checkInLng", public.hrm_attendance."checkInLng"),
          "constructionSiteId" = coalesce(excluded."constructionSiteId", public.hrm_attendance."constructionSiteId"),
          "locationName" = coalesce(excluded."locationName", public.hrm_attendance."locationName"),
          "locationType" = coalesce(excluded."locationType", public.hrm_attendance."locationType"),
          "isOutOfRange" = excluded."isOutOfRange",
          note = coalesce(excluded.note, public.hrm_attendance.note)
    returning * into v_row;
  else
    update public.hrm_attendance
      set "checkOut" = p_event_time,
          "checkOutPhoto" = coalesce(p_image_url, "checkOutPhoto"),
          "checkOutLat" = coalesce(p_lat, "checkOutLat"),
          "checkOutLng" = coalesce(p_lng, "checkOutLng"),
          "locationName" = coalesce(p_location_name, "locationName"),
          "locationType" = coalesce(p_location_type, "locationType"),
          "isOutOfRange" = coalesce(not p_in_range, "isOutOfRange"),
          note = coalesce(nullif(v_location_note, ''), note)
    where "employeeId" = p_employee_id
      and date = p_work_date
    returning * into v_row;

    if v_row.id is null then
      raise exception 'Chưa có check-in ngày %, không thể check-out.', p_work_date
        using errcode = '23514';
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function public.employee_camera_checkin_v1(
  text,
  uuid,
  text,
  text,
  double precision,
  double precision,
  text,
  text,
  text,
  integer,
  boolean,
  text,
  jsonb
) to authenticated;

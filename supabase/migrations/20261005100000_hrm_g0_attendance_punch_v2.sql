-- HRM G0 (owner decisions 02/10/2026, docs/audits/hrm-attendance-leave-2026-10-02 §11):
--   1. Out-of-range punches are blocked; the server measures the distance and the time.
--   2. Default radius: construction site 300 m, office / factory 150 m.
--   3. One "Chấm công" button: the first punch of the day is "vào", later punches move "ra".
--   8. Check-in photos are kept 60 days (removed by the hrm-checkin-photo-retention worker).

-- ── 2. Default radius ───────────────────────────────────────────────────────
alter table public.hrm_construction_sites alter column "checkInRadius" set default 300;
alter table public.hrm_offices alter column "checkInRadius" set default 150;

-- Rows still on the old defaults (200 / 100) move to the new ones. The steel factory is
-- stored as a site but is a fixed workshop, so it follows the office radius.
update public.hrm_construction_sites
set "checkInRadius" = case when id = 'e73cff76-1880-4271-8344-962bab1298f8' then 150 else 300 end
where "checkInRadius" is null or "checkInRadius" = 200;

update public.hrm_offices
set "checkInRadius" = 150
where "checkInRadius" is null or "checkInRadius" = 100;

-- ── Punch ───────────────────────────────────────────────────────────────────
create or replace function app_private.employee_attendance_punch_v2(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_location_type text,
  p_location_id text,
  p_image_url text,
  p_device_info jsonb default '{}'::jsonb
)
returns public.hrm_attendance
language plpgsql
security definer
set search_path = ''
as $function$
declare
  c_max_accuracy_m constant double precision := 100;
  c_max_events constant integer := 10;
  v_app_user_id uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
  v_local timestamp := (now() at time zone 'Asia/Ho_Chi_Minh');
  v_work_date text := to_char(v_local, 'YYYY-MM-DD');
  v_time text := to_char(v_local, 'HH24:MI');
  v_location_name text;
  v_location_lat double precision;
  v_location_lng double precision;
  v_radius integer;
  v_manager_id text;
  v_distance integer;
  v_image_path text;
  v_existing public.hrm_attendance;
  v_row public.hrm_attendance;
  v_action text;
  v_event jsonb;
  v_events jsonb;
begin
  if (select auth.uid()) is null or v_app_user_id is null then
    raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.';
  end if;

  select employee.* into v_employee
  from public.employees employee
  where employee.user_id = v_app_user_id and employee.status = 'Đang làm việc'
  order by employee.updated_at desc nulls last, employee.created_at desc nulls last
  limit 1;
  if v_employee.id is null then
    raise exception using errcode = '42501', message = 'Tài khoản chưa được liên kết hồ sơ nhân sự. Liên hệ phòng HCNS.';
  end if;

  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception using errcode = '22023', message = 'Chưa lấy được vị trí GPS của điện thoại.';
  end if;
  if p_accuracy_m is null or p_accuracy_m <= 0 then
    raise exception using errcode = '22023', message = 'Chưa xác định được độ chính xác GPS. Hãy thử lại.';
  end if;
  if p_accuracy_m > c_max_accuracy_m then
    raise exception using errcode = '22023',
      message = format('GPS chưa đủ chính xác (sai số ±%s m, cần ≤ %s m). Hãy ra chỗ thoáng, bật định vị chính xác rồi thử lại.',
        round(p_accuracy_m), c_max_accuracy_m);
  end if;

  if p_location_type = 'construction_site' then
    select site.name, site.latitude, site.longitude, coalesce(site."checkInRadius", 300), nullif(site."managerId", '')
    into v_location_name, v_location_lat, v_location_lng, v_radius, v_manager_id
    from public.hrm_construction_sites site where site.id::text = p_location_id;
  elsif p_location_type = 'office' then
    select office.name, office.latitude, office.longitude, coalesce(office."checkInRadius", 150), nullif(office."managerId", '')
    into v_location_name, v_location_lat, v_location_lng, v_radius, v_manager_id
    from public.hrm_offices office where office.id::text = p_location_id;
  else
    raise exception using errcode = '22023', message = 'Địa điểm chấm công không hợp lệ.';
  end if;

  if v_location_name is null then
    raise exception using errcode = '22023', message = 'Không tìm thấy địa điểm chấm công.';
  end if;
  if v_location_lat is null or v_location_lng is null then
    raise exception using errcode = '22023',
      message = format('"%s" chưa được cấu hình tọa độ. Liên hệ người quản lý địa điểm.', v_location_name);
  end if;

  v_distance := round(6371000 * 2 * asin(sqrt(
    power(sin(radians(p_lat - v_location_lat) / 2), 2)
    + cos(radians(v_location_lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_location_lng) / 2), 2)
  )));

  if v_distance > v_radius then
    raise exception using errcode = '23514',
      message = format('Bạn đang ngoài phạm vi chấm công của "%s" (cách %s m, cho phép %s m). Nếu đang làm việc tại đây, hãy gửi Đề xuất chấm công bù.',
        v_location_name, v_distance, v_radius);
  end if;

  -- The photo must be the caller's own object, already uploaded to the private bucket.
  v_image_path := substring(coalesce(p_image_url, '') from '/storage/v1/object/public/checkin-photos/(.+)$');
  if v_image_path is null
    or split_part(v_image_path, '/', 1) <> v_employee.id::text
    or not exists (
      select 1 from storage.objects object_row
      where object_row.bucket_id = 'checkin-photos' and object_row.name = v_image_path
    )
  then
    raise exception using errcode = '22023', message = 'Chưa tải được ảnh chấm công. Hãy chụp lại.';
  end if;

  select attendance.* into v_existing
  from public.hrm_attendance attendance
  where attendance."employeeId" = v_employee.id and attendance.date = v_work_date
  for update;

  v_events := case
    when jsonb_typeof(coalesce(v_existing."events", '[]'::jsonb)) = 'array' then coalesce(v_existing."events", '[]'::jsonb)
    else '[]'::jsonb
  end;
  if jsonb_array_length(v_events) >= c_max_events then
    raise exception using errcode = '23514',
      message = format('Hôm nay đã ghi nhận %s lượt chấm công, không ghi thêm.', c_max_events);
  end if;

  -- First punch of the day is "vào"; any later punch moves "ra".
  v_action := case when v_existing.id is null or v_existing."checkIn" is null then 'check_in' else 'check_out' end;

  v_event := jsonb_build_object(
    'action', v_action,
    'time', v_time,
    'recorded_at', now(),
    'source', 'camera_v2',
    'lat', p_lat,
    'lng', p_lng,
    'accuracy_m', round(p_accuracy_m),
    'location_type', p_location_type,
    'location_id', p_location_id,
    'location_name', v_location_name,
    'distance_m', v_distance,
    'radius_m', v_radius,
    'in_range', true,
    'is_out_of_range', false,
    'image_url', p_image_url,
    'device_info', coalesce(p_device_info, '{}'::jsonb)
  );

  if v_existing.id is null then
    insert into public.hrm_attendance (
      id, "employeeId", date, status, "checkIn", "checkInPhoto", "checkInLat", "checkInLng",
      "constructionSiteId", "locationName", "locationType", "isOutOfRange", note,
      "events", "eventCount", "approvalStatus", "submittedToUserId", "createdAt"
    ) values (
      gen_random_uuid(), v_employee.id, v_work_date, 'present', v_time, p_image_url, p_lat, p_lng,
      case when p_location_type = 'construction_site' then p_location_id end, v_location_name, p_location_type, false,
      format('event=%s:%s | distance=%sm | accuracy=%sm', v_action, v_time, v_distance, round(p_accuracy_m)),
      jsonb_build_array(v_event), 1, 'approved', v_manager_id, now()
    )
    returning * into v_row;
    return v_row;
  end if;

  update public.hrm_attendance
  set status = case when status = 'absent' then 'present' else status end,
      "checkIn" = case when v_action = 'check_in' then v_time else "checkIn" end,
      "checkInPhoto" = case when v_action = 'check_in' then p_image_url else "checkInPhoto" end,
      "checkInLat" = case when v_action = 'check_in' then p_lat else "checkInLat" end,
      "checkInLng" = case when v_action = 'check_in' then p_lng else "checkInLng" end,
      "checkOut" = case when v_action = 'check_out' then v_time else "checkOut" end,
      "checkOutPhoto" = case when v_action = 'check_out' then p_image_url else "checkOutPhoto" end,
      "checkOutLat" = case when v_action = 'check_out' then p_lat else "checkOutLat" end,
      "checkOutLng" = case when v_action = 'check_out' then p_lng else "checkOutLng" end,
      "constructionSiteId" = coalesce(case when p_location_type = 'construction_site' then p_location_id end, "constructionSiteId"),
      "locationName" = v_location_name,
      "locationType" = p_location_type,
      note = left(concat_ws(E'\n', nullif(note, ''),
        format('event=%s:%s | distance=%sm | accuracy=%sm', v_action, v_time, v_distance, round(p_accuracy_m))), 1000),
      "events" = v_events || jsonb_build_array(v_event),
      "eventCount" = jsonb_array_length(v_events) + 1,
      "submittedToUserId" = coalesce("submittedToUserId", v_manager_id)
  where id = v_existing.id
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.employee_attendance_punch_v2(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_location_type text,
  p_location_id text,
  p_image_url text,
  p_device_info jsonb default '{}'::jsonb
)
returns public.hrm_attendance
language sql
set search_path = ''
as $function$
  select app_private.employee_attendance_punch_v2(
    p_lat, p_lng, p_accuracy_m, p_location_type, p_location_id, p_image_url, p_device_info
  );
$function$;

revoke all on function app_private.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb) from public, anon;
grant execute on function app_private.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb) to authenticated, service_role;
revoke all on function public.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb) from public, anon;
grant execute on function public.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb) to authenticated, service_role;

comment on function public.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb) is
  'One-button punch for the current actor. Server time (Asia/Ho_Chi_Minh) and server-measured distance; out-of-range or low-accuracy punches are rejected.';

-- The old RPC trusted the phone for date, time and range. A cached old app gets a clear reload message.
create or replace function app_private.employee_camera_checkin_v1(
  p_action text, p_employee_id uuid, p_work_date text, p_event_time text,
  p_lat double precision default null, p_lng double precision default null,
  p_location_type text default null, p_location_id text default null, p_location_name text default null,
  p_distance_m integer default null, p_in_range boolean default null, p_image_url text default null,
  p_device_info jsonb default '{}'::jsonb
)
returns public.hrm_attendance
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using errcode = '0A000',
    message = 'Ứng dụng đã cập nhật cách chấm công mới. Vui lòng tải lại trang rồi chấm công lại.';
end;
$function$;

-- ── Check-in context ───────────────────────────────────────────────────────
create or replace function app_private.get_my_checkin_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
begin
  if (select auth.uid()) is null or v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'HRM_CHECKIN_SESSION_REQUIRED';
  end if;

  select employee.* into v_employee
  from public.employees employee
  where employee.user_id = v_actor_user_id and employee.status = 'Đang làm việc'
  order by employee.updated_at desc nulls last, employee.created_at desc nulls last
  limit 1;

  if v_employee.id is null then
    return jsonb_build_object('employee', null, 'attendanceRecords', '[]'::jsonb,
      'constructionSites', '[]'::jsonb, 'offices', '[]'::jsonb, 'assignedSiteIds', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'employee', jsonb_build_object(
      'id', v_employee.id,
      'employee_code', v_employee.employee_code,
      'full_name', v_employee.full_name,
      'title', v_employee.title,
      'status', v_employee.status,
      'user_id', v_employee.user_id,
      'office_id', v_employee.office_id,
      'construction_site_id', v_employee.construction_site_id,
      'avatar_url', v_employee.avatar_url
    ),
    'attendanceRecords', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attendance.id,
        'employeeId', attendance."employeeId",
        'date', attendance.date,
        'status', attendance.status,
        'checkIn', attendance."checkIn",
        'checkOut', attendance."checkOut",
        'checkInPhoto', attendance."checkInPhoto",
        'overtimeHours', attendance."overtimeHours",
        'note', attendance.note,
        'events', attendance.events,
        'eventCount', attendance."eventCount",
        'approvalStatus', attendance."approvalStatus",
        'locationName', attendance."locationName",
        'locationType', attendance."locationType",
        'isOutOfRange', attendance."isOutOfRange",
        'createdAt', attendance."createdAt"
      ) order by attendance.date desc)
      from public.hrm_attendance attendance
      where attendance."employeeId" = v_employee.id
        and attendance.date >= to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date - 62, 'YYYY-MM-DD')
    ), '[]'::jsonb),
    'constructionSites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', site.id,
        'name', site.name,
        'latitude', site.latitude,
        'longitude', site.longitude,
        'checkInRadius', coalesce(site."checkInRadius", 300)
      ) order by site.name)
      from public.hrm_construction_sites site
    ), '[]'::jsonb),
    'offices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', office.id,
        'name', office.name,
        'latitude', office.latitude,
        'longitude', office.longitude,
        'checkInRadius', coalesce(office."checkInRadius", 150)
      ) order by office.name)
      from public.hrm_offices office
    ), '[]'::jsonb),
    -- Sites the person is currently assigned to; used to prefer them when several areas overlap.
    'assignedSiteIds', coalesce((
      select jsonb_agg(distinct staff.construction_site_id)
      from public.project_staff staff
      where staff.user_id = v_actor_user_id::text
        and staff.construction_site_id is not null
        and (staff.end_date is null or staff.end_date >= current_date)
    ), '[]'::jsonb)
  );
end;
$function$;

-- ── Photos: own folder only, never edited or deleted by employees ──────────
drop policy if exists checkin_photos_insert on storage.objects;
create policy checkin_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'checkin-photos'
    and app_private.hrm_employee_is_current_user(split_part(name, '/', 1))
  );
drop policy if exists checkin_photos_update on storage.objects;
drop policy if exists checkin_photos_delete on storage.objects;

-- ── 8. Retention: 60 days ──────────────────────────────────────────────────
create or replace function app_private.claim_expired_checkin_photos(p_limit integer default 200)
returns setof text
language sql
stable
security definer
set search_path = ''
as $function$
  select object_row.name
  from storage.objects object_row
  where object_row.bucket_id = 'checkin-photos'
    and object_row.created_at < now() - interval '60 days'
  order by object_row.created_at
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$function$;
revoke all on function app_private.claim_expired_checkin_photos(integer) from public, anon, authenticated;
grant execute on function app_private.claim_expired_checkin_photos(integer) to service_role;

-- PostgREST exposes only public; the retention worker (service role) calls this wrapper.
create or replace function public.claim_expired_checkin_photos(p_limit integer default 200)
returns setof text
language sql
stable
set search_path = ''
as $function$
  select app_private.claim_expired_checkin_photos(p_limit);
$function$;
revoke all on function public.claim_expired_checkin_photos(integer) from public, anon, authenticated;
grant execute on function public.claim_expired_checkin_photos(integer) to service_role;

create or replace function app_private.checkin_photo_retention_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare v_secret text; v_request bigint;
begin
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'checkin-photos' and created_at < now() - interval '60 days'
  ) then
    return null;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'send_web_push_secret' limit 1;
  if nullif(v_secret, '') is null then raise exception 'CHECKIN_PHOTO_RETENTION_SECRET_MISSING'; end if;
  select net.http_post(
    url := 'https://ftciqmqhmfvjtwoycswe.supabase.co/functions/v1/hrm-checkin-photo-retention',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-web-push-secret', v_secret),
    body := '{"action":"cleanup"}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request;
  return v_request;
end;
$function$;
revoke all on function app_private.checkin_photo_retention_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'hrm-checkin-photo-retention';
-- 03:20 Vietnam time.
select cron.schedule('hrm-checkin-photo-retention', '20 20 * * *', 'select app_private.checkin_photo_retention_tick()');

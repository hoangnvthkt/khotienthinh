-- Run after 20261005100000_hrm_g0_attendance_punch_v2. Rolls back.
begin;
set local statement_timeout = '30s';

select set_config('test.punch.auth_id', user_row.auth_id::text, true),
       set_config('test.punch.email', user_row.email, true),
       set_config('test.punch.employee_id', employee_row.id::text, true)
from public.users user_row
join public.employees employee_row on employee_row.user_id = user_row.id
where user_row.role <> 'ADMIN'
  and user_row.is_active
  and user_row.account_status = 'ACTIVE'
  and user_row.auth_id is not null
  and employee_row.status = 'Đang làm việc'
order by user_row.created_at
limit 1;

select set_config('test.punch.office_id', office.id::text, true),
       set_config('test.punch.office_lat', office.latitude::text, true),
       set_config('test.punch.office_lng', office.longitude::text, true)
from public.hrm_offices office
where office.latitude is not null and office.longitude is not null
order by office.name
limit 1;

-- G1 adds a passkey requirement; this smoke covers the location rules only.
do $$
begin
  if to_regclass('public.hrm_attendance_settings') is not null then
    execute 'update public.hrm_attendance_settings set require_device_passkey = false';
  end if;
end;
$$;

-- Start from a clean day for the persona so the first punch is "vào".
delete from public.hrm_attendance
where "employeeId" = current_setting('test.punch.employee_id')::uuid
  and date = to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');

select set_config('request.jwt.claim.sub', current_setting('test.punch.auth_id'), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'sub', current_setting('test.punch.auth_id'),
  'email', current_setting('test.punch.email')
)::text, true);
set local role authenticated;

-- Own folder upload is allowed; someone else's folder is not.
insert into storage.objects(bucket_id, name, owner_id, metadata)
values ('checkin-photos', current_setting('test.punch.employee_id') || '/smoke-g0.jpg', auth.uid()::text,
        '{"mimetype":"image/jpeg","size":1}'::jsonb);

do $$
begin
  begin
    insert into storage.objects(bucket_id, name, owner_id, metadata)
    values ('checkin-photos', '00000000-0000-0000-0000-000000000000/smoke-g0.jpg', auth.uid()::text, '{}'::jsonb);
    raise exception 'HRM_G0_FOREIGN_FOLDER_UPLOAD_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end;
$$;

do $$
declare
  v_url text := 'https://x.supabase.co/storage/v1/object/public/checkin-photos/'
    || current_setting('test.punch.employee_id') || '/smoke-g0.jpg';
  v_lat double precision := current_setting('test.punch.office_lat')::double precision;
  v_lng double precision := current_setting('test.punch.office_lng')::double precision;
  v_row public.hrm_attendance;
begin
  -- Far away: rejected, nothing written.
  begin
    perform public.employee_attendance_punch_v2(v_lat + 0.05, v_lng, 20, 'office', current_setting('test.punch.office_id'), v_url, '{}');
    raise exception 'HRM_G0_OUT_OF_RANGE_ACCEPTED';
  exception when check_violation then null;
  end;

  -- Poor accuracy: rejected.
  begin
    perform public.employee_attendance_punch_v2(v_lat, v_lng, 450, 'office', current_setting('test.punch.office_id'), v_url, '{}');
    raise exception 'HRM_G0_LOW_ACCURACY_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;

  -- In range: first punch is "vào", second is "ra"; both use server time.
  v_row := public.employee_attendance_punch_v2(v_lat + 0.0003, v_lng, 20, 'office', current_setting('test.punch.office_id'), v_url, '{}');
  if v_row."checkIn" is null or v_row."checkOut" is not null or v_row."eventCount" <> 1 then
    raise exception 'HRM_G0_FIRST_PUNCH_NOT_CHECK_IN %', row_to_json(v_row);
  end if;
  if v_row.date <> to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') then
    raise exception 'HRM_G0_NOT_SERVER_DATE';
  end if;
  if (v_row.events -> 0 ->> 'distance_m')::int > 60 then
    raise exception 'HRM_G0_DISTANCE_NOT_SERVER_MEASURED';
  end if;

  v_row := public.employee_attendance_punch_v2(v_lat, v_lng, 15, 'office', current_setting('test.punch.office_id'), v_url, '{}');
  if v_row."checkOut" is null or v_row."eventCount" <> 2 then
    raise exception 'HRM_G0_SECOND_PUNCH_NOT_CHECK_OUT';
  end if;

  -- Another employee's photo: rejected.
  begin
    perform public.employee_attendance_punch_v2(v_lat, v_lng, 15, 'office', current_setting('test.punch.office_id'),
      'https://x.supabase.co/storage/v1/object/public/checkin-photos/00000000-0000-0000-0000-000000000000/a.jpg', '{}');
    raise exception 'HRM_G0_FOREIGN_PHOTO_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;

  -- The old phone-trusting RPC is closed.
  begin
    perform public.employee_camera_checkin_v1('check_in', current_setting('test.punch.employee_id')::uuid,
      '2099-12-30', '08:00', null, null, null, null, null, null, null, null, '{}'::jsonb);
    raise exception 'HRM_G0_V1_STILL_OPEN';
  exception when feature_not_supported then null;
  end;

  -- Employees cannot overwrite or delete their photos.
  update storage.objects set metadata = '{}'::jsonb
  where bucket_id = 'checkin-photos' and name = current_setting('test.punch.employee_id') || '/smoke-g0.jpg';
  if found then raise exception 'HRM_G0_PHOTO_UPDATABLE'; end if;
end;
$$;

-- Context lists only recent attendance and the effective radius.
do $$
declare v_context jsonb := public.get_my_checkin_context();
begin
  if v_context -> 'employee' ->> 'id' <> current_setting('test.punch.employee_id') then
    raise exception 'HRM_G0_CONTEXT_WRONG_EMPLOYEE';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_context -> 'offices') office
    where (office ->> 'checkInRadius') is null
  ) then
    raise exception 'HRM_G0_CONTEXT_RADIUS_MISSING';
  end if;
  if not (v_context ? 'assignedSiteIds') then raise exception 'HRM_G0_CONTEXT_ASSIGNMENTS_MISSING'; end if;
end;
$$;

reset role;
select 'hrm_g0_attendance_punch_smoke passed' as result;
rollback;

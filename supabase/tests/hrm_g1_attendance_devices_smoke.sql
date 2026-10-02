-- Run after 20261005120000_hrm_g1_attendance_devices. Rolls back.
begin;
set local statement_timeout = '60s';

select set_config('test.g1.auth_id', user_row.auth_id::text, true),
       set_config('test.g1.email', user_row.email, true),
       set_config('test.g1.user_id', user_row.id::text, true),
       set_config('test.g1.employee_id', employee_row.id::text, true)
from public.users user_row
join public.employees employee_row on employee_row.user_id = user_row.id
where user_row.role <> 'ADMIN' and user_row.is_active and user_row.account_status = 'ACTIVE'
  and user_row.auth_id is not null and employee_row.status = 'Đang làm việc'
  and not app_private.has_hrm_template_permission(user_row.id, 'hrm.employee.view_sensitive')
  and not exists (select 1 from public.hrm_attendance_devices device where device.employee_id = employee_row.id)
order by user_row.created_at
limit 1;

select set_config('test.g1.other_employee_id', employee_row.id::text, true)
from public.employees employee_row
where employee_row.status = 'Đang làm việc' and employee_row.id::text <> current_setting('test.g1.employee_id')
  and not exists (select 1 from public.hrm_attendance_devices device where device.employee_id = employee_row.id)
limit 1;

select set_config('test.g1.office_id', office.id::text, true),
       set_config('test.g1.lat', office.latitude::text, true),
       set_config('test.g1.lng', office.longitude::text, true)
from public.hrm_offices office where office.latitude is not null order by office.name limit 1;

delete from public.hrm_attendance
where "employeeId" = current_setting('test.g1.employee_id')::uuid
  and date = to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');
delete from public.hrm_attendance_passkey_exemptions where employee_id = current_setting('test.g1.employee_id')::uuid;
update public.hrm_attendance_settings set require_device_passkey = true;

-- Worker side (service role): first phone is active, a second phone waits, a phone of someone else waits.
do $$
declare v_result jsonb;
begin
  v_result := public.hrm_register_attendance_device(current_setting('test.g1.employee_id')::uuid,
    current_setting('test.g1.user_id')::uuid, 'smoke-cred-1', 'pk', 0, '{internal}', 'phone-A', 'iPhone');
  if v_result ->> 'status' <> 'ACTIVE' then raise exception 'HRM_G1_FIRST_DEVICE_NOT_ACTIVE %', v_result; end if;

  v_result := public.hrm_register_attendance_device(current_setting('test.g1.employee_id')::uuid,
    current_setting('test.g1.user_id')::uuid, 'smoke-cred-2', 'pk', 0, '{internal}', 'phone-B', 'Android');
  if v_result ->> 'status' <> 'PENDING' then raise exception 'HRM_G1_SECOND_DEVICE_NOT_PENDING'; end if;

  v_result := public.hrm_register_attendance_device(current_setting('test.g1.other_employee_id')::uuid,
    gen_random_uuid(), 'smoke-cred-3', 'pk', 0, '{internal}', 'phone-A', 'iPhone');
  if v_result ->> 'status' <> 'PENDING' or v_result ->> 'pendingReason' <> 'shared_device' then
    raise exception 'HRM_G1_SHARED_DEVICE_NOT_HELD %', v_result;
  end if;

  -- Replayed counter is refused.
  perform public.hrm_issue_attendance_punch_token(current_setting('test.g1.employee_id')::uuid, 'smoke-cred-1', 5);
  begin
    perform public.hrm_issue_attendance_punch_token(current_setting('test.g1.employee_id')::uuid, 'smoke-cred-1', 5);
    raise exception 'HRM_G1_COUNTER_REPLAY_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  -- A pending phone cannot get a token.
  begin
    perform public.hrm_issue_attendance_punch_token(current_setting('test.g1.employee_id')::uuid, 'smoke-cred-2', 1);
    raise exception 'HRM_G1_PENDING_DEVICE_TOKEN';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('test.g1.token', public.hrm_issue_attendance_punch_token(
  current_setting('test.g1.employee_id')::uuid, 'smoke-cred-1', 6)::text, true);

-- Employee side.
select set_config('request.jwt.claim.sub', current_setting('test.g1.auth_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated',
  'sub', current_setting('test.g1.auth_id'), 'email', current_setting('test.g1.email'))::text, true);
set local role authenticated;

insert into storage.objects(bucket_id, name, owner_id, metadata)
values ('checkin-photos', current_setting('test.g1.employee_id') || '/smoke-g1.jpg', auth.uid()::text, '{"mimetype":"image/jpeg","size":1}'::jsonb);

do $$
declare
  v_url text := 'https://x.supabase.co/storage/v1/object/public/checkin-photos/' || current_setting('test.g1.employee_id') || '/smoke-g1.jpg';
  v_lat double precision := current_setting('test.g1.lat')::double precision;
  v_lng double precision := current_setting('test.g1.lng')::double precision;
  v_row public.hrm_attendance;
begin
  -- Without a passkey token: refused.
  begin
    perform public.employee_attendance_punch_v2(v_lat, v_lng, 20, 'office', current_setting('test.g1.office_id'), v_url, '{}');
    raise exception 'HRM_G1_PUNCH_WITHOUT_PASSKEY';
  exception when insufficient_privilege then null;
  end;

  v_row := public.employee_attendance_punch_v2(v_lat, v_lng, 20, 'office', current_setting('test.g1.office_id'), v_url, '{}',
    current_setting('test.g1.token')::uuid);
  if v_row."eventCount" <> 1 or (v_row.events -> 0 ->> 'passkey')::boolean is not true then
    raise exception 'HRM_G1_PASSKEY_PUNCH_NOT_RECORDED';
  end if;
  -- phone-A is also claimed by another person → flagged.
  if not (v_row."suspicionFlags" ? 'shared_device') then raise exception 'HRM_G1_SHARED_DEVICE_NOT_FLAGGED %', v_row."suspicionFlags"; end if;

  -- The token is single use.
  begin
    perform public.employee_attendance_punch_v2(v_lat, v_lng, 20, 'office', current_setting('test.g1.office_id'), v_url, '{}',
      current_setting('test.g1.token')::uuid);
    raise exception 'HRM_G1_TOKEN_REUSED';
  exception when insufficient_privilege then null;
  end;

  -- Employees cannot write devices directly nor decide on them.
  begin
    insert into public.hrm_attendance_devices (employee_id, user_id, credential_id, public_key, status)
    values (current_setting('test.g1.employee_id')::uuid, gen_random_uuid(), 'x', 'x', 'ACTIVE');
    raise exception 'HRM_G1_DIRECT_DEVICE_INSERT';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.decide_hrm_attendance_device((select id from public.hrm_attendance_devices where credential_id = 'smoke-cred-2'), 'approve', 'tự duyệt');
    raise exception 'HRM_G1_SELF_APPROVAL';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select 'hrm_g1_attendance_devices_smoke passed' as result;
rollback;

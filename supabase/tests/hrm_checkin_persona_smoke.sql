begin;
set local statement_timeout = '30s';

select set_config('test.checkin.admin_auth_id', user_row.auth_id::text, true),
       set_config('test.checkin.admin_email', user_row.email, true),
       set_config('test.checkin.admin_employee_id', employee_row.id::text, true)
from public.users user_row
join public.employees employee_row on employee_row.user_id = user_row.id
join public.principal_role_assignments assignment_row
  on assignment_row.principal_type = 'user'
 and assignment_row.principal_id = user_row.id
 and assignment_row.status = 'ACTIVE'
 and assignment_row.starts_at <= now()
 and (assignment_row.expires_at is null or assignment_row.expires_at > now())
join public.role_permission_templates template_row
  on template_row.id = assignment_row.role_template_id
 and template_row.code = 'HR_MANAGE'
where user_row.role = 'ADMIN'
  and user_row.is_active
  and user_row.account_status = 'ACTIVE'
  and user_row.auth_id is not null
order by user_row.created_at
limit 1;

select set_config('test.checkin.employee_auth_id', user_row.auth_id::text, true),
       set_config('test.checkin.employee_email', user_row.email, true),
       set_config('test.checkin.employee_id', employee_row.id::text, true)
from public.users user_row
join public.employees employee_row on employee_row.user_id = user_row.id
where user_row.role <> 'ADMIN'
  and user_row.is_active
  and user_row.account_status = 'ACTIVE'
  and user_row.auth_id is not null
  and employee_row.status = 'Đang làm việc'
order by user_row.created_at
limit 1;

do $$
begin
  if current_setting('test.checkin.admin_auth_id', true) is null
    or current_setting('test.checkin.employee_auth_id', true) is null
  then
    raise exception 'HRM_CHECKIN_PERSONA_NOT_FOUND';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.checkin.admin_auth_id'), true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', current_setting('test.checkin.admin_auth_id'),
    'email', current_setting('test.checkin.admin_email')
  )::text,
  true
);
set local role authenticated;

insert into storage.objects(bucket_id, name, owner_id, metadata)
values (
  'checkin-photos',
  'smoke/' || current_setting('test.checkin.admin_employee_id') || '.jpg',
  auth.uid()::text,
  '{"mimetype":"image/jpeg","size":1}'::jsonb
)
on conflict(bucket_id, name) do update set metadata = excluded.metadata;

do $$
declare
  v_attendance public.hrm_attendance;
begin
  v_attendance := public.employee_camera_checkin_v1(
    'check_in', current_setting('test.checkin.admin_employee_id')::uuid,
    '2099-12-30', '08:00', null, null, null, null, null, null, null, null, '{}'::jsonb
  );
  if v_attendance.id is null then raise exception 'HRM_ADMIN_CHECKIN_NOT_SAVED'; end if;
end;
$$;

reset role;

select set_config('request.jwt.claim.sub', current_setting('test.checkin.employee_auth_id'), true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', current_setting('test.checkin.employee_auth_id'),
    'email', current_setting('test.checkin.employee_email')
  )::text,
  true
);
set local role authenticated;

insert into storage.objects(bucket_id, name, owner_id, metadata)
values (
  'checkin-photos',
  'smoke/' || current_setting('test.checkin.employee_id') || '.jpg',
  auth.uid()::text,
  '{"mimetype":"image/jpeg","size":1}'::jsonb
)
on conflict(bucket_id, name) do update set metadata = excluded.metadata;

do $$
declare
  v_attendance public.hrm_attendance;
begin
  v_attendance := public.employee_camera_checkin_v1(
    'check_in', current_setting('test.checkin.employee_id')::uuid,
    '2099-12-31', '08:00', null, null, null, null, null, null, null, null, '{}'::jsonb
  );
  if v_attendance.id is null then raise exception 'HRM_EMPLOYEE_CHECKIN_NOT_SAVED'; end if;
end;
$$;

reset role;
rollback;

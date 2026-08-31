begin;
set local statement_timeout = '30s';

select employee.id as test_employee_id, account.id as test_user_id,
       account.auth_id as test_auth_id, account.email as test_email
from public.employees employee
join public.users account on account.id = employee.user_id
where employee.status = 'Đang làm việc'
  and account.is_active and account.account_status = 'ACTIVE'
  and account.role <> 'ADMIN'
  and not exists (
    select 1 from public.principal_role_assignments assignment_row
    join public.role_permission_templates template on template.id = assignment_row.role_template_id
    where assignment_row.principal_id = account.id and assignment_row.principal_type = 'user'
      and assignment_row.status = 'ACTIVE' and template.code in ('HR','HR_MANAGE')
  )
order by employee.employee_code limit 1
\gset

select account.id as test_admin_id, account.auth_id as test_admin_auth_id,
       account.email as test_admin_email
from public.users account
join public.principal_role_assignments assignment_row
  on assignment_row.principal_type='user' and assignment_row.principal_id=account.id
 and assignment_row.status='ACTIVE'
join public.role_permission_templates template
  on template.id=assignment_row.role_template_id and template.code='SYSTEM_ADMIN'
where account.role='ADMIN' and account.is_active and account.account_status='ACTIVE'
order by account.created_at limit 1
\gset

select set_config('test.hrm_employee_id', :'test_employee_id', true);
select set_config('test.hrm_user_id', :'test_user_id', true);
select set_config('test.hrm_attendance_total', (select count(*)::text from public.hrm_attendance), true);
select set_config('request.jwt.claim.sub', :'test_auth_id', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'role','authenticated','sub',:'test_auth_id','email',:'test_email'
)::text, true);
set local role authenticated;

do $$
declare
  v_employee_id uuid := current_setting('test.hrm_employee_id')::uuid;
  v_non_own integer;
  v_blocked boolean := false;
begin
  select count(*) into v_non_own
  from public.hrm_attendance where "employeeId" <> v_employee_id;
  if v_non_own <> 0 then raise exception 'HRM_EMPLOYEE_ATTENDANCE_SCOPE_LEAK'; end if;

  select count(*) into v_non_own
  from public.hrm_leave_requests where "employeeId" <> v_employee_id;
  if v_non_own <> 0 then raise exception 'HRM_EMPLOYEE_LEAVE_SCOPE_LEAK'; end if;

  begin
    insert into public.hrm_shift_types(id,name,start_time,end_time)
    values (gen_random_uuid(),'SMOKE DENY','08:00','17:00');
  exception when insufficient_privilege then v_blocked := true;
    when check_violation then v_blocked := true;
  end;
  if not v_blocked then raise exception 'HRM_EMPLOYEE_MASTER_WRITE_NOT_BLOCKED'; end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', :'test_admin_auth_id', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'role','authenticated','sub',:'test_admin_auth_id','email',:'test_admin_email'
)::text, true);
select public.set_user_hr_business_role(
  :'test_user_id'::uuid, 'HR', null, 'Smoke: cấp HR để kiểm tra policy theo vai trò',
  '[]'::jsonb,
  public.get_user_hr_authorization(:'test_user_id'::uuid) ->> 'fingerprint'
) is not null as hr_role_assigned;

select set_config('request.jwt.claim.sub', :'test_auth_id', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'role','authenticated','sub',:'test_auth_id','email',:'test_email'
)::text, true);
set local role authenticated;

do $$
declare
  v_visible integer;
  v_total integer := current_setting('test.hrm_attendance_total')::integer;
  v_blocked boolean := false;
begin
  select count(*) into v_visible from public.hrm_attendance;
  if v_visible <> v_total then raise exception 'HRM_HR_GLOBAL_ATTENDANCE_SCOPE_INVALID %/%',v_visible,v_total; end if;

  insert into public.hrm_doc_categories(
    id,doc_type,key,label,icon,color,sort_order,is_active
  ) values (
    gen_random_uuid(),'employee_record','smoke-'||gen_random_uuid()::text,'Smoke','📁','smoke',999,true
  );

  begin
    insert into public.hrm_shift_types(id,name,start_time,end_time)
    values (gen_random_uuid(),'SMOKE HR DENY','08:00','17:00');
  exception when insufficient_privilege then v_blocked := true;
    when check_violation then v_blocked := true;
  end;
  if not v_blocked then raise exception 'HRM_HR_MASTER_WRITE_NOT_BLOCKED'; end if;
end;
$$;

reset role;
rollback;

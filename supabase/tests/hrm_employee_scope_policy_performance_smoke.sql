begin;
set local statement_timeout = '2s';

select employee.id as test_employee_id,
       account.id as test_user_id,
       account.auth_id as test_auth_id,
       account.email as test_email
from public.employees employee
join public.users account on account.id = employee.user_id
where employee.status = 'Đang làm việc'
  and account.is_active
  and account.account_status = 'ACTIVE'
  and account.role <> 'ADMIN'
  and not exists (
    select 1
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates template
      on template.id = assignment_row.role_template_id
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = account.id
      and assignment_row.status = 'ACTIVE'
      and template.code in ('HR', 'HR_MANAGE')
  )
order by employee.employee_code
limit 1
\gset

select set_config('test.hrm_employee_id', :'test_employee_id', true);
select set_config('request.jwt.claim.sub', :'test_auth_id', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'sub', :'test_auth_id',
  'email', :'test_email'
)::text, true);

set local role authenticated;

do $$
declare
  v_employee_id uuid := current_setting('test.hrm_employee_id')::uuid;
  v_visible_shift_count integer;
  v_visible_attendance_count integer;
  v_cross_employee_count integer;
begin
  select count(*) into v_visible_shift_count from public.hrm_employee_shifts;
  select count(*) into v_visible_attendance_count from public.hrm_attendance;

  select count(*) into v_cross_employee_count
  from public.hrm_employee_shifts
  where employee_id <> v_employee_id;
  if v_cross_employee_count <> 0 then
    raise exception 'HRM_EMPLOYEE_SHIFT_SCOPE_LEAK';
  end if;

  select count(*) into v_cross_employee_count
  from public.hrm_attendance
  where "employeeId" <> v_employee_id;
  if v_cross_employee_count <> 0 then
    raise exception 'HRM_EMPLOYEE_ATTENDANCE_SCOPE_LEAK';
  end if;

  raise notice 'HRM employee scope performance: shifts=%, attendance=%',
    v_visible_shift_count, v_visible_attendance_count;
end;
$$;

reset role;
rollback;

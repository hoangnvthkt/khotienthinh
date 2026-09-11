begin;
set local statement_timeout = '30s';

do $$
declare
  v_account public.users%rowtype;
  v_employee_id uuid;
begin
  select account.* into v_account
  from public.users account
  join public.principal_role_assignments assignment
    on assignment.principal_type = 'user'
   and assignment.principal_id = account.id
   and assignment.status = 'ACTIVE'
   and assignment.starts_at <= now()
   and (assignment.expires_at is null or assignment.expires_at > now())
  join public.role_permission_templates template
    on template.id = assignment.role_template_id
   and template.code like 'LEGACY_HR_%'
  join public.role_permission_template_items view_item
    on view_item.template_id = template.id
   and view_item.permission_code = 'hrm.attendance.view'
  where account.role <> 'ADMIN'
    and account.is_active
    and account.account_status = 'ACTIVE'
    and account.auth_id is not null
    and not exists (
      select 1 from public.role_permission_template_items operator_item
      where operator_item.template_id = template.id
        and operator_item.permission_code in ('hrm.attendance.edit', 'hrm.attendance.approve')
    )
    and exists (
      select 1 from public.employees employee
      where employee.user_id = account.id and employee.status = 'Đang làm việc'
        and exists (
          select 1 from public.hrm_attendance attendance
          where attendance."employeeId" = employee.id
        )
    )
  order by account.id
  limit 1;

  select employee.id into v_employee_id
  from public.employees employee
  where employee.user_id = v_account.id and employee.status = 'Đang làm việc'
  order by employee.updated_at desc nulls last, employee.created_at desc nulls last
  limit 1;

  if v_account.id is null or v_employee_id is null then
    raise exception 'TASK12_3_ORDINARY_ATTENDANCE_PERSONA_NOT_FOUND';
  end if;

  if app_private.has_governed_hrm_permission(
    v_account.id, 'hrm.attendance.view', 'global', '*'
  ) then
    raise exception 'TASK12_3_ORDINARY_USER_STILL_HAS_GLOBAL_ATTENDANCE_VIEW';
  end if;
  if not app_private.has_governed_hrm_permission(
    v_account.id, 'hrm.attendance.view', 'own', '*'
  ) then
    raise exception 'TASK12_3_ORDINARY_USER_MISSING_OWN_ATTENDANCE_VIEW';
  end if;

  perform set_config('test.task12_3.employee_id', v_employee_id::text, true);
  perform set_config('request.jwt.claim.sub', v_account.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'sub', v_account.auth_id, 'email', v_account.email
  )::text, true);
end;
$$;

set local role authenticated;

do $$
declare
  v_employee_id uuid := current_setting('test.task12_3.employee_id')::uuid;
begin
  if not exists (
    select 1 from public.hrm_attendance attendance
    where attendance."employeeId" = v_employee_id
  ) then
    raise exception 'TASK12_3_RLS_HIDES_OWN_ATTENDANCE';
  end if;

  if exists (
    select 1 from public.hrm_attendance attendance
    where attendance."employeeId" <> v_employee_id
  ) then
    raise exception 'TASK12_3_RLS_EXPOSES_OTHER_EMPLOYEE_ATTENDANCE';
  end if;
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.role_permission_templates template
    join public.role_permission_template_items view_item
      on view_item.template_id = template.id
     and view_item.permission_code = 'hrm.attendance.view'
     and view_item.scope_type = 'global'
     and view_item.scope_id = '*'
    where template.code like 'LEGACY_HR_%'
      and not exists (
        select 1 from public.role_permission_template_items operator_item
        where operator_item.template_id = template.id
          and operator_item.permission_code in ('hrm.attendance.edit', 'hrm.attendance.approve')
      )
  ) then
    raise exception 'TASK12_3_VIEW_ONLY_LEGACY_HR_TEMPLATE_STILL_GLOBAL';
  end if;

  if not exists (
    select 1 from public.users account
    where account.is_active
      and account.account_status = 'ACTIVE'
      and app_private.has_hrm_template_permission(account.id, 'hrm.attendance.view')
      and app_private.has_governed_hrm_permission(account.id, 'hrm.attendance.view', 'global', '*')
  ) then
    raise exception 'TASK12_3_HR_GLOBAL_ATTENDANCE_VIEW_REGRESSED';
  end if;
end;
$$;

rollback;

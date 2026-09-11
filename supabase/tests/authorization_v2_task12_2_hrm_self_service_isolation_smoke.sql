begin;
set local statement_timeout = '30s';

do $$
declare
  v_employee_a public.employees%rowtype;
  v_employee_b public.employees%rowtype;
  v_user_a public.users%rowtype;
begin
  select employee.* into v_employee_a
  from public.employees employee
  join public.users account on account.id = employee.user_id
  where employee.status = 'Đang làm việc'
    and account.role <> 'ADMIN'
    and account.is_active
    and account.account_status = 'ACTIVE'
    and account.auth_id is not null
    and not exists (
      select 1
      from public.principal_role_assignments assignment
      join public.role_permission_templates template on template.id = assignment.role_template_id
      where assignment.principal_type = 'user'
        and assignment.principal_id = account.id
        and assignment.status = 'ACTIVE'
        and assignment.starts_at <= now()
        and (assignment.expires_at is null or assignment.expires_at > now())
        and template.code in ('HR', 'HR_MANAGE')
    )
  order by employee.employee_code
  limit 1;

  select employee.* into v_employee_b
  from public.employees employee
  join public.users account on account.id = employee.user_id
  where employee.status = 'Đang làm việc'
    and employee.id <> v_employee_a.id
    and account.is_active
    and account.account_status = 'ACTIVE'
    and account.auth_id is not null
  order by employee.employee_code
  limit 1;

  select account.* into v_user_a from public.users account where account.id = v_employee_a.user_id;
  if v_employee_a.id is null or v_employee_b.id is null or v_user_a.auth_id is null then
    raise exception 'TASK12_2_EMPLOYEE_FIXTURES_NOT_FOUND';
  end if;

  perform set_config('test.task12_2.employee_a', v_employee_a.id::text, true);
  perform set_config('test.task12_2.employee_b', v_employee_b.id::text, true);
  perform set_config('test.task12_2.auth_a', v_user_a.auth_id::text, true);
  perform set_config('test.task12_2.email_a', v_user_a.email, true);

  insert into public.hrm_payrolls (id, "employeeId", month, year, "netSalary", status)
  values
    (gen_random_uuid(), v_employee_a.id, 10, 2199, 10000001, 'confirmed'),
    (gen_random_uuid(), v_employee_a.id, 11, 2199, 10000002, 'draft'),
    (gen_random_uuid(), v_employee_b.id, 12, 2199, 20000001, 'paid')
  on conflict ("employeeId", month, year) do update
  set "netSalary" = excluded."netSalary", status = excluded.status;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.task12_2.auth_a'), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'sub', current_setting('test.task12_2.auth_a'),
  'email', current_setting('test.task12_2.email_a')
)::text, true);

set local role authenticated;

do $$
declare
  v_context jsonb;
  v_payrolls jsonb;
  v_admin_projection_denied boolean := false;
  v_raw_count bigint;
begin
  begin
    perform public.list_hrm_payrolls();
  exception when others then
    v_admin_projection_denied := position('HRM_PAYROLL_VIEW_REQUIRED' in sqlerrm) > 0;
  end;
  if not v_admin_projection_denied then
    raise exception 'TASK12_2_NON_HR_ADMIN_PAYROLL_NOT_DENIED';
  end if;

  v_context := public.get_my_checkin_context();
  if v_context #>> '{employee,id}' <> current_setting('test.task12_2.employee_a') then
    raise exception 'TASK12_2_CHECKIN_CONTEXT_WRONG_EMPLOYEE: %', v_context #> '{employee,id}';
  end if;

  v_payrolls := public.list_my_payrolls();
  if jsonb_array_length(v_payrolls) <> 1
    or v_payrolls #>> '{0,employeeId}' <> current_setting('test.task12_2.employee_a')
    or v_payrolls #>> '{0,status}' <> 'confirmed'
    or (v_payrolls::text like '%' || current_setting('test.task12_2.employee_b') || '%')
  then
    raise exception 'TASK12_2_SELF_PAYROLL_ISOLATION_FAILED';
  end if;

  begin
    select count(*) into v_raw_count from public.hrm_payrolls;
    if v_raw_count <> 0 then
      raise exception 'TASK12_2_RAW_PAYROLL_RLS_WIDENED';
    end if;
  exception when insufficient_privilege then
    -- A missing table-level SELECT grant is stricter than an RLS-filtered empty result.
    null;
  end;
end;
$$;

reset role;

do $$
declare
  v_account record;
  v_employee_id uuid;
  v_context jsonb;
  v_payrolls jsonb;
  v_linked_count integer := 0;
  v_unlinked_count integer := 0;
begin
  if not app_private.is_hrm_template_only_permission('hrm.payroll.view') then
    raise exception 'TASK12_2_PAYROLL_VIEW_NOT_TEMPLATE_ONLY';
  end if;

  if has_function_privilege('anon', 'public.get_my_checkin_context()', 'EXECUTE')
    or has_function_privilege('anon', 'public.list_my_payrolls()', 'EXECUTE')
  then
    raise exception 'TASK12_2_ANON_EXECUTE_NOT_REVOKED';
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_checkin_context()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.list_my_payrolls()', 'EXECUTE')
  then
    raise exception 'TASK12_2_AUTHENTICATED_EXECUTE_MISSING';
  end if;
  if not has_function_privilege('authenticated', 'app_private.get_my_checkin_context()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'app_private.list_my_payrolls()', 'EXECUTE')
  then
    raise exception 'TASK12_2_INVOKER_BRIDGE_EXECUTE_MISSING';
  end if;

  if exists (
    select 1
    from public.users account
    join public.employees employee
      on lower(trim(employee.email)) = lower(trim(account.email))
     and trim(employee.email) <> ''
    where account.is_active
      and account.account_status = 'ACTIVE'
      and account.auth_id is not null
      and employee.status = 'Đang làm việc'
      and employee.user_id is null
      and not exists (
        select 1 from public.employees linked where linked.user_id = account.id
      )
      and (select count(*) from public.users same_account
        where same_account.is_active
          and same_account.account_status = 'ACTIVE'
          and lower(trim(same_account.email)) = lower(trim(account.email))) = 1
      and (select count(*) from public.employees same_employee
        where same_employee.status = 'Đang làm việc'
          and lower(trim(same_employee.email)) = lower(trim(employee.email))) = 1
  ) then
    raise exception 'TASK12_2_SAFE_EMPLOYEE_LINK_BACKFILL_REMAINS';
  end if;

  for v_account in
    select account.id, account.auth_id, account.email
    from public.users account
    where account.role <> 'ADMIN'
      and account.is_active
      and account.account_status = 'ACTIVE'
      and account.auth_id is not null
    order by account.id
  loop
    perform set_config('request.jwt.claim.sub', v_account.auth_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object(
      'role', 'authenticated',
      'sub', v_account.auth_id,
      'email', v_account.email
    )::text, true);

    select employee.id into v_employee_id
    from public.employees employee
    where employee.user_id = v_account.id
      and employee.status = 'Đang làm việc'
    order by employee.updated_at desc nulls last, employee.created_at desc nulls last
    limit 1;

    v_context := public.get_my_checkin_context();
    v_payrolls := public.list_my_payrolls();

    if v_employee_id is null then
      v_unlinked_count := v_unlinked_count + 1;
      if v_context -> 'employee' <> 'null'::jsonb or jsonb_array_length(v_payrolls) <> 0 then
        raise exception 'TASK12_2_UNLINKED_ACCOUNT_NOT_EMPTY';
      end if;
    else
      v_linked_count := v_linked_count + 1;
      if v_context #>> '{employee,id}' <> v_employee_id::text
        or exists (
          select 1
          from jsonb_array_elements(v_payrolls) payroll
          where payroll ->> 'employeeId' <> v_employee_id::text
             or payroll ->> 'status' not in ('confirmed', 'paid')
        )
      then
        raise exception 'TASK12_2_ACCOUNT_ISOLATION_FAILED';
      end if;
    end if;
  end loop;

  if v_linked_count = 0 then
    raise exception 'TASK12_2_NO_LINKED_NON_ADMIN_ACCOUNT_VERIFIED';
  end if;
  raise notice 'TASK12_2_ALL_NON_ADMIN_ACCOUNTS_VERIFIED linked=% unlinked=%',
    v_linked_count, v_unlinked_count;
end;
$$;

rollback;

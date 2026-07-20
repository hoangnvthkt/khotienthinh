begin;

create temp table hrm_employee_permission_smoke_ids (
  allowed_user_id uuid not null,
  denied_user_id uuid not null,
  dept_a_id uuid not null,
  dept_b_id uuid not null,
  allowed_email text not null,
  denied_email text not null,
  allowed_employee_id uuid not null,
  denied_employee_id uuid not null,
  other_dept_employee_id uuid not null
) on commit drop;

do $$
declare
  v_allowed_user_id uuid := gen_random_uuid();
  v_denied_user_id uuid := gen_random_uuid();
  v_dept_a_id uuid := gen_random_uuid();
  v_dept_b_id uuid := gen_random_uuid();
  v_allowed_email text := 'hrm-employee-smoke-allowed-' || replace(gen_random_uuid()::text, '-', '') || '@example.test';
  v_denied_email text := 'hrm-employee-smoke-denied-' || replace(gen_random_uuid()::text, '-', '') || '@example.test';
  v_allowed_employee_id uuid := gen_random_uuid();
  v_denied_employee_id uuid := gen_random_uuid();
  v_other_dept_employee_id uuid := gen_random_uuid();
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'hrm_employee_has_action'
  ) then
    raise exception 'hrm employee helper is not installed';
  end if;

  if exists (
    select 1
    from public.permission_actions
    where permission_code in ('hrm.employee.view', 'hrm.employee.create', 'hrm.employee.edit')
      and grant_readiness <> 'enforced'
  ) then
    raise exception 'hrm employee actions are not marked enforced';
  end if;

  insert into public.org_units (id, name, type, code, source, is_active)
  values
    (v_dept_a_id, 'HRM employee smoke department A', 'department', 'HRM-SMOKE-A-' || left(v_dept_a_id::text, 8), 'smoke', true),
    (v_dept_b_id, 'HRM employee smoke department B', 'department', 'HRM-SMOKE-B-' || left(v_dept_b_id::text, 8), 'smoke', true);

  insert into public.users (
    id, auth_id, name, email, username, role, is_active, account_status,
    allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
  )
  values
    (v_allowed_user_id, null, 'HRM employee smoke allowed', v_allowed_email, 'hrm_employee_smoke_allowed_' || left(v_allowed_user_id::text, 8), 'EMPLOYEE', true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb),
    (v_denied_user_id, null, 'HRM employee smoke denied', v_denied_email, 'hrm_employee_smoke_denied_' || left(v_denied_user_id::text, 8), 'EMPLOYEE', true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb);

  insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
  values
    (v_allowed_user_id, 'hrm.employee.view', 'department', v_dept_a_id::text, true),
    (v_allowed_user_id, 'hrm.employee.create', 'department', v_dept_a_id::text, true),
    (v_allowed_user_id, 'hrm.employee.edit', 'department', v_dept_a_id::text, true);

  insert into hrm_employee_permission_smoke_ids (
    allowed_user_id,
    denied_user_id,
    dept_a_id,
    dept_b_id,
    allowed_email,
    denied_email,
    allowed_employee_id,
    denied_employee_id,
    other_dept_employee_id
  )
  values (
    v_allowed_user_id,
    v_denied_user_id,
    v_dept_a_id,
    v_dept_b_id,
    v_allowed_email,
    v_denied_email,
    v_allowed_employee_id,
    v_denied_employee_id,
    v_other_dept_employee_id
  );
end;
$$;

grant select on hrm_employee_permission_smoke_ids to authenticated;

set local role authenticated;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', gen_random_uuid()::text,
    'email', (select denied_email from hrm_employee_permission_smoke_ids),
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_ids hrm_employee_permission_smoke_ids%rowtype;
begin
  select * into v_ids from hrm_employee_permission_smoke_ids limit 1;

  begin
    insert into public.employees (
      id, employee_code, full_name, email, status, user_id, department_id
    )
    values (
      v_ids.denied_employee_id,
      'HRM-SMOKE-DENIED',
      'HRM employee smoke denied create',
      'hrm-smoke-denied-create-' || left(v_ids.denied_employee_id::text, 8) || '@example.test',
      'Đang làm việc',
      null,
      v_ids.dept_a_id
    );
    raise exception 'employee create without grant unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', gen_random_uuid()::text,
    'email', (select allowed_email from hrm_employee_permission_smoke_ids),
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_ids hrm_employee_permission_smoke_ids%rowtype;
  v_rows integer;
begin
  select * into v_ids from hrm_employee_permission_smoke_ids limit 1;

  insert into public.employees (
    id, employee_code, full_name, email, status, user_id, department_id
  )
  values (
    v_ids.allowed_employee_id,
    'HRM-SMOKE-OK',
    'HRM employee smoke allowed',
    'hrm-smoke-allowed-' || left(v_ids.allowed_employee_id::text, 8) || '@example.test',
    'Đang làm việc',
    null,
    v_ids.dept_a_id
  );

  select count(*) into v_rows
  from public.employees
  where id = v_ids.allowed_employee_id;

  if v_rows <> 1 then
    raise exception 'department-scoped HRM create did not produce a visible employee row';
  end if;

  begin
    insert into public.employees (
      id, employee_code, full_name, email, status, user_id, department_id
    )
    values (
      v_ids.other_dept_employee_id,
      'HRM-SMOKE-BLOCK',
      'HRM employee smoke blocked department',
      'hrm-smoke-other-dept-' || left(v_ids.other_dept_employee_id::text, 8) || '@example.test',
      'Đang làm việc',
      null,
      v_ids.dept_b_id
    );
    raise exception 'department-scoped HRM create unexpectedly crossed departments';
  exception
    when insufficient_privilege then null;
  end;

  update public.employees
  set title = 'Smoke updated title'
  where id = v_ids.allowed_employee_id;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'department-scoped HRM edit did not update the employee row';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', gen_random_uuid()::text,
    'email', (select denied_email from hrm_employee_permission_smoke_ids),
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_ids hrm_employee_permission_smoke_ids%rowtype;
  v_rows integer;
begin
  select * into v_ids from hrm_employee_permission_smoke_ids limit 1;

  select count(*) into v_rows
  from public.employees
  where id = v_ids.allowed_employee_id;

  if v_rows <> 0 then
    raise exception 'HRM employee select without view grant unexpectedly saw data';
  end if;

  update public.employees
  set title = 'Denied update title'
  where id = v_ids.allowed_employee_id;

  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'HRM employee edit without grant unexpectedly updated data';
  end if;
end;
$$;

rollback;

-- Run after authorization_p0a_block_anonymous_access.
-- Uses synthetic storage rows inside one transaction and rolls back.
begin;

create temporary table p0a_smoke_context (
  employee_id uuid not null,
  employee_auth_id uuid not null,
  employee_email text not null,
  other_id uuid not null,
  admin_id uuid not null,
  admin_auth_id uuid not null,
  admin_email text not null,
  template_id uuid,
  run_id text not null
) on commit drop;
grant select on p0a_smoke_context to anon, authenticated;

do $$
declare
  v_admin public.users%rowtype;
  v_employee public.users%rowtype;
  v_other public.users%rowtype;
  v_template_id uuid;
  v_run_id text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into v_admin from public.users
  where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null
  order by created_at, id limit 1;

  -- Template edit rights depend on the caller's session, so evaluate them
  -- under each candidate's claims and keep an employee who cannot edit one.
  for v_employee in
    select * from public.users candidate
    where candidate.role = 'EMPLOYEE' and candidate.is_active and candidate.account_status = 'ACTIVE'
      and candidate.auth_id is not null
      and not exists (select 1 from public.user_signatures signature where signature.user_id = candidate.id)
    order by candidate.created_at, candidate.id
  loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_employee.auth_id, 'email', v_employee.email, 'role', 'authenticated'
    )::text, true);
    select template_row.id into v_template_id from public.workflow_templates template_row
    where not app_private.workflow_template_actor_can_edit(template_row.id, v_employee.id)
    order by template_row.created_at nulls last, template_row.id limit 1;
    exit when v_template_id is not null;
  end loop;
  perform set_config('request.jwt.claims', '', true);

  select * into v_other from public.users candidate
  where candidate.is_active and candidate.id not in (v_admin.id, v_employee.id)
    and not exists (select 1 from public.user_signatures signature where signature.user_id = candidate.id)
  order by candidate.created_at, candidate.id limit 1;

  if v_admin.id is null or v_employee.id is null or v_other.id is null or v_template_id is null then
    raise exception 'P0-A smoke personas are unavailable';
  end if;

  insert into p0a_smoke_context values (
    v_employee.id, v_employee.auth_id, v_employee.email, v_other.id,
    v_admin.id, v_admin.auth_id, v_admin.email, v_template_id, v_run_id
  );

  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('project-photos', 'p0a-smoke/' || v_run_id || '/own.jpg', v_employee.auth_id::text, '{}'::jsonb),
    ('project-photos', 'p0a-smoke/' || v_run_id || '/other.jpg', v_admin.auth_id::text, '{}'::jsonb),
    ('checkin-photos', 'p0a-smoke/' || v_run_id || '/other.jpg', v_admin.auth_id::text, '{}'::jsonb),
    ('project-attachments', 'p0a-smoke/' || v_run_id || '/other.pdf', v_admin.auth_id::text, '{}'::jsonb),
    ('project-files', 'p0a-smoke/' || v_run_id || '/other.pdf', v_admin.auth_id::text, '{}'::jsonb),
    ('workflow-attachments', 'p0a-smoke/' || v_run_id || '/other.pdf', v_admin.auth_id::text, '{}'::jsonb),
    ('workflow-templates', 'signatures/' || v_other.id || '.png', v_admin.auth_id::text, '{}'::jsonb)
  on conflict do nothing;
end $$;

-- Catalog: anon keeps no privilege on app data, and screen RPCs stay reachable.
do $$
begin
  if exists (
    select 1 from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relkind in ('r', 'v', 'm', 'p', 'f')
      and (
        has_table_privilege('anon', relation.oid, 'SELECT')
        or has_table_privilege('anon', relation.oid, 'INSERT')
        or has_table_privilege('anon', relation.oid, 'UPDATE')
        or has_table_privilege('anon', relation.oid, 'DELETE')
        or has_table_privilege('anon', relation.oid, 'TRUNCATE')
      )
  ) then
    raise exception 'anon still holds a privilege on a public relation';
  end if;

  if exists (
    select 1 from information_schema.role_usage_grants
    where grantee = 'anon' and object_schema = 'public'
  ) then
    raise exception 'anon still holds a public sequence privilege';
  end if;

  if exists (
    select 1 from pg_default_acl default_acl
    cross join lateral aclexplode(default_acl.defaclacl) entry
    where default_acl.defaclrole = 'postgres'::regrole
      and default_acl.defaclnamespace = 'public'::regnamespace
      and entry.grantee = 'anon'::regrole
  ) then
    raise exception 'postgres default privileges still grant anon';
  end if;

  if exists (
    select 1 from pg_proc routine join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public' and routine.prosecdef
      and has_function_privilege('anon', routine.oid, 'EXECUTE')
  ) then
    raise exception 'anon can still execute a public SECURITY DEFINER function';
  end if;

  if not has_function_privilege('authenticated', 'public.get_project_material_request_detail(text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.get_project_material_request_board(text,text,jsonb,integer,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.get_material_request_workflow_board(text,text,jsonb,integer,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.get_project_workflow_action_context(text,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.get_project_workflow_timeline(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.timeout_stale_user_sessions(integer)', 'EXECUTE')
  then
    raise exception 'authenticated lost a screen RPC';
  end if;

  if has_function_privilege('authenticated', 'public.daily_log_user_has_project_permission(text,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.process_project_workflow_sla_escalations()', 'EXECUTE')
  then
    raise exception 'retired functions remain executable';
  end if;
end $$;

-- The Storage API sets this before deleting; RLS then decides the rows.
set local storage.allow_delete_query = 'true';

-- Anonymous caller.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare
  v_context p0a_smoke_context%rowtype;
  v_rows integer;
  v_blocked boolean;
begin
  select * into v_context from p0a_smoke_context;

  select count(*) into v_rows from storage.objects
  where name like 'p0a-smoke/' || v_context.run_id || '/%' or name like 'signatures/%';
  if v_rows <> 0 then raise exception 'anon can list % storage objects', v_rows; end if;

  update storage.objects set user_metadata = '{"p0a":"anon"}'::jsonb
  where bucket_id = 'workflow-templates' and name = 'signatures/' || v_context.other_id || '.png';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'anon overwrote a signature'; end if;

  delete from storage.objects where name like 'p0a-smoke/' || v_context.run_id || '/%';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'anon deleted % objects', v_rows; end if;

  v_blocked := false;
  begin
    insert into storage.objects (bucket_id, name) values ('project-photos', 'p0a-smoke/' || v_context.run_id || '/anon.jpg');
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'anon uploaded an object'; end if;

  v_blocked := false;
  begin
    perform count(*) from public.activities;
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'anon can read public.activities'; end if;

  v_blocked := false;
  begin
    perform public.get_project_material_request_detail('p0a-smoke');
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'anon can execute get_project_material_request_detail'; end if;
end $$;

reset role;

-- Ordinary employee.
set local role authenticated;

do $$
declare
  v_context p0a_smoke_context%rowtype;
  v_rows integer;
  v_blocked boolean;
begin
  select * into v_context from p0a_smoke_context;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.employee_auth_id, 'email', v_context.employee_email, 'role', 'authenticated'
  )::text, true);
  if public.current_app_user_id() is distinct from v_context.employee_id then
    raise exception 'employee impersonation failed';
  end if;

  select count(*) into v_rows from storage.objects where name like 'p0a-smoke/' || v_context.run_id || '/%';
  if v_rows <> 6 then raise exception 'employee should read 6 synthetic objects, got %', v_rows; end if;

  update storage.objects set user_metadata = '{"p0a":"employee"}'::jsonb
  where name like 'p0a-smoke/' || v_context.run_id || '/other.%';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee overwrote % objects of other users', v_rows; end if;

  delete from storage.objects where name like 'p0a-smoke/' || v_context.run_id || '/other.%';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee deleted % objects of other users', v_rows; end if;

  update storage.objects set user_metadata = '{"p0a":"own"}'::jsonb
  where bucket_id = 'project-photos' and name = 'p0a-smoke/' || v_context.run_id || '/own.jpg';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'employee could not update an own photo'; end if;

  delete from storage.objects
  where bucket_id = 'project-photos' and name = 'p0a-smoke/' || v_context.run_id || '/own.jpg';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'employee could not delete an own photo'; end if;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('workflow-templates', 'signatures/' || v_context.employee_id || '.png', v_context.employee_auth_id::text);

  update storage.objects set user_metadata = '{"p0a":"forged"}'::jsonb
  where bucket_id = 'workflow-templates' and name = 'signatures/' || v_context.other_id || '.png';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee overwrote a signature of another user'; end if;

  delete from storage.objects
  where bucket_id = 'workflow-templates' and name = 'signatures/' || v_context.other_id || '.png';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee deleted a signature of another user'; end if;

  v_blocked := false;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('workflow-templates', 'signatures/' || gen_random_uuid() || '.png', v_context.employee_auth_id::text);
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'employee wrote a signature path of another user'; end if;

  v_blocked := false;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('workflow-templates', v_context.template_id || '/p0a-smoke-' || v_context.run_id || '.docx', v_context.employee_auth_id::text);
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'employee uploaded a print template without edit rights'; end if;

  -- Authenticated application reads keep working.
  perform count(*) from public.activities;
  perform count(*) from public.payment_schedules;
end $$;

-- System Admin.
do $$
declare
  v_context p0a_smoke_context%rowtype;
  v_rows integer;
begin
  select * into v_context from p0a_smoke_context;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.admin_auth_id, 'email', v_context.admin_email, 'role', 'authenticated'
  )::text, true);
  if not public.is_admin() then raise exception 'admin impersonation failed'; end if;

  delete from storage.objects
  where bucket_id = 'workflow-templates' and name = 'signatures/' || v_context.other_id || '.png';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'admin could not remove a signature'; end if;

  delete from storage.objects where name like 'p0a-smoke/' || v_context.run_id || '/other.%';
  get diagnostics v_rows = row_count;
  if v_rows <> 5 then raise exception 'admin should delete 5 synthetic objects, got %', v_rows; end if;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('workflow-templates', v_context.template_id || '/p0a-smoke-' || v_context.run_id || '.docx', v_context.admin_auth_id::text);
end $$;

reset role;
rollback;

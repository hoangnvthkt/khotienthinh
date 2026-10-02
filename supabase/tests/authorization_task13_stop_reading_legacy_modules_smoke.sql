-- Run after authorization_task13_stop_reading_legacy_modules. Rolls back.
begin;

create temporary table t13_context (
  emp_auth uuid, emp_email text, emp_id uuid,
  staff_auth uuid, staff_email text, staff_project text,
  outside_project text
) on commit drop;
grant select on t13_context to authenticated;

-- An employee with no legacy module, no project grant and no settings capability.
insert into t13_context (emp_auth, emp_email, emp_id)
select u.auth_id, u.email, u.id from public.users u
where u.is_active and u.account_status = 'ACTIVE' and u.role = 'EMPLOYEE' and u.auth_id is not null
  and cardinality(coalesce(u.allowed_modules, '{}')) = 0
  and not exists (select 1 from public.user_permission_grants g where g.user_id = u.id and g.permission_code like 'project.%' and g.is_active)
  and not exists (select 1 from public.project_staff s where s.user_id = u.id::text and s.end_date is null)
order by u.created_at limit 1;

-- A non-admin active project member, a project they work on, and one they do not.
update t13_context c set (staff_auth, staff_email, staff_project, outside_project) = (
  select u.auth_id, u.email, s.project_id,
    (select p.id from public.projects p where not exists (
       select 1 from public.project_staff s2 where s2.project_id = p.id and s2.user_id = u.id::text and s2.end_date is null)
     and not app_private.project_scope_has_any_grant_v2(p.id, p.construction_site_id::text, u.id) limit 1)
  from public.project_staff s join public.users u on u.id::text = s.user_id
  where s.end_date is null and u.is_active and u.account_status = 'ACTIVE' and u.role <> 'ADMIN' and u.auth_id is not null
  order by s.created_at limit 1);

do $$
declare v_c t13_context%rowtype;
begin
  select * into v_c from t13_context;
  if v_c.emp_auth is null or v_c.staff_auth is null then raise exception 'fixture missing'; end if;
  if exists (select 1 from pg_policies where qual ~ 'can_access_module' or with_check ~ 'can_access_module') then
    raise exception 'a policy still calls can_access_module';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'app_private') and p.proname <> 'can_access_module' and p.prosrc ~ 'can_access_module') then
    raise exception 'a function still calls can_access_module';
  end if;
  if (select prosrc from pg_proc where oid = 'app_private.can_access_module(text)'::regprocedure) ~ 'allowed_modules|admin_modules' then
    raise exception 'can_access_module still reads the legacy columns';
  end if;
end $$;

set local role authenticated;

-- Shared catalogs: readable by any active account; still not writable without the Settings capability.
do $$
declare v_c t13_context%rowtype; v_blocked boolean := false;
begin
  select * into v_c from t13_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.emp_auth, 'email', v_c.emp_email, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.project_types) then raise exception 'employee cannot read project types'; end if;
  if not exists (select 1 from public.inspection_templates) then raise exception 'employee cannot read inspection templates'; end if;
  if not exists (select 1 from public.work_groups) then raise exception 'employee cannot read work groups'; end if;
  if app_private.can_access_module('DA') then raise exception 'non-admin passes can_access_module'; end if;
  begin
    insert into public.project_types (name) values ('t13 smoke');
  exception when others then v_blocked := true; end;
  if not v_blocked then raise exception 'employee wrote a catalog row'; end if;
  if exists (select 1 from public.projects) then raise exception 'employee with no project access sees projects'; end if;
end $$;

-- Projects: a member reads the project they work on, not others.
do $$
declare v_c t13_context%rowtype;
begin
  select * into v_c from t13_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.staff_auth, 'email', v_c.staff_email, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.projects where id = v_c.staff_project) then raise exception 'member cannot read own project'; end if;
  if v_c.outside_project is not null and exists (select 1 from public.projects where id = v_c.outside_project) then
    raise exception 'member reads a project they are not on';
  end if;
end $$;

rollback;

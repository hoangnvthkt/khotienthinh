-- Run after authorization_p0c_sensitive_view_grants. Rolls back.
begin;

create temporary table p0c_context (
  admin_auth uuid, admin_email text,
  employee_id uuid, employee_auth uuid, employee_email text,
  project_id text,
  employee_in_room boolean
) on commit drop;
grant select on p0c_context to authenticated;

insert into p0c_context
select a.auth_id, a.email, e.id, e.auth_id, e.email,
  (select p.id from public.projects p order by p.created_at desc limit 1),
  false
from (select * from public.users where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) a,
     (select * from public.users where role = 'EMPLOYEE' and is_active and account_status = 'ACTIVE' and auth_id is not null
        and not exists (select 1 from public.project_sensitive_view_grants g where g.user_id = users.id)
      order by created_at limit 1) e;

update p0c_context c set employee_in_room = exists (
  select 1 from public.project_permission_room_members m
  join public.project_staff s on s.id = m.project_staff_id
  where m.project_id = c.project_id and s.user_id = c.employee_id::text
    and m.is_active and m.room_code in ('payment', 'quantity_acceptance'));

set local role authenticated;

-- An employee cannot list or change switches.
do $$
declare v_c p0c_context%rowtype; v_blocked boolean;
begin
  select * into v_c from p0c_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin perform public.set_project_sensitive_view_grant(v_c.employee_id, v_c.project_id, 'finance', true, 'self grant attempt');
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'employee changed a switch'; end if;
  v_blocked := false;
  begin perform * from public.list_project_sensitive_view_access(v_c.project_id);
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'employee listed switches'; end if;
  v_blocked := false;
  begin insert into public.project_sensitive_view_grants (project_id, user_id, domain, reason, granted_by)
    values (v_c.project_id, v_c.employee_id, 'finance', 'direct insert attempt', v_c.employee_id);
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'employee inserted a switch directly'; end if;
end $$;

-- Admin turns finance on for one project.
do $$
declare v_c p0c_context%rowtype; v_result jsonb;
begin
  select * into v_c from p0c_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  v_result := public.set_project_sensitive_view_grant(v_c.employee_id, v_c.project_id, 'finance', true, 'P0-C smoke finance access');
  if not (v_result ->> 'changed')::boolean then raise exception 'grant not created: %', v_result; end if;
  if not exists (select 1 from public.list_project_sensitive_view_access(v_c.project_id) r where r.user_id = v_c.employee_id and r.finance_project) then
    raise exception 'admin list does not show the grant';
  end if;
  if not exists (select 1 from public.audit_trail where table_name = 'project_sensitive_view_grants' and record_id = v_result ->> 'grantId') then
    raise exception 'grant not audited';
  end if;
end $$;

-- The employee now sees finance but not contracts of that project.
do $$
declare v_c p0c_context%rowtype; v_access jsonb;
begin
  select * into v_c from p0c_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  v_access := public.get_my_project_sensitive_access(v_c.project_id, null);
  if not (v_access ->> 'finance')::boolean then raise exception 'finance switch not effective: %', v_access; end if;
  if not app_private.sensitive_can_view('finance', v_c.project_id, null) then raise exception 'helper disagrees'; end if;
end $$;

-- Admin turns it off again.
do $$
declare v_c p0c_context%rowtype;
begin
  select * into v_c from p0c_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  perform public.set_project_sensitive_view_grant(v_c.employee_id, v_c.project_id, 'finance', false, 'P0-C smoke finance revoke');
end $$;

do $$
declare v_c p0c_context%rowtype;
begin
  select * into v_c from p0c_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  if app_private.sensitive_view_project_ids('finance') @> array[v_c.project_id] and not v_c.employee_in_room then
    raise exception 'revoked switch still grants finance';
  end if;
end $$;

reset role;
rollback;

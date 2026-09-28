-- Run after authorization_p1_4_restrict_audit_trail_reads. Rolls back.
begin;
create temporary table p14a_context (admin_auth uuid, admin_email text, employee_auth uuid, employee_email text, total bigint) on commit drop;
grant select on p14a_context to authenticated;
insert into p14a_context
select a.auth_id, a.email, e.auth_id, e.email, (select count(*) from public.audit_trail)
from (select * from public.users where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) a,
     (select * from public.users u where role = 'EMPLOYEE' and is_active and account_status = 'ACTIVE' and auth_id is not null
        and not app_private.has_permission(u.id, 'system.audit_trail.view', 'global', '*') order by created_at limit 1) e;

set local role authenticated;
do $$
declare v_c p14a_context%rowtype;
begin
  select * into v_c from p14a_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.audit_trail) then raise exception 'employee still reads audit trail'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  if (select count(*) from public.audit_trail) <> v_c.total then raise exception 'admin lost audit trail rows'; end if;
end $$;
reset role;
rollback;

-- Run after authorization_p3_user_special_roles_summary. Read-only checks, rolls back.
begin;

create temporary table p3_sr_context (
  admin_auth uuid, admin_email text, employee_auth uuid, employee_email text, employee_id uuid, holder_id uuid, holder_role text
) on commit drop;
grant select on p3_sr_context to authenticated;

insert into p3_sr_context
select a.auth_id, a.email, e.auth_id, e.email, e.id,
  (select ra.principal_id from public.principal_role_assignments ra where ra.principal_type = 'user' and ra.status = 'ACTIVE' limit 1),
  (select t.code from public.principal_role_assignments ra join public.role_permission_templates t on t.id = ra.role_template_id
    where ra.principal_type = 'user' and ra.status = 'ACTIVE' limit 1)
from (select * from public.users where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) a,
     (select * from public.users where role = 'EMPLOYEE' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) e;

set local role authenticated;

-- A regular employee cannot read anyone's roles, including their own.
do $$
declare v_c p3_sr_context%rowtype; v_blocked boolean := false;
begin
  select * into v_c from p3_sr_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  begin perform public.get_user_special_roles(v_c.employee_id);
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'employee read role assignments'; end if;
end $$;

-- Admin: a person with no role gets an empty list; a role holder gets that role, and only active ones.
do $$
declare v_c p3_sr_context%rowtype; v_roles jsonb;
begin
  select * into v_c from p3_sr_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  if jsonb_typeof(public.get_user_special_roles(v_c.employee_id)) <> 'array' then raise exception 'result is not an array'; end if;
  if v_c.holder_id is null then raise exception 'fixture missing: nobody holds an active role'; end if;
  begin
    v_roles := public.get_user_special_roles(v_c.holder_id);
    if not exists (select 1 from jsonb_array_elements(v_roles) r where r ->> 'roleCode' = v_c.holder_role) then
      raise exception 'active role % missing: %', v_c.holder_role, v_roles;
    end if;
    -- Revoked assignments (the converted legacy roles) never show up.
    if exists (select 1 from jsonb_array_elements(v_roles) r where (r ->> 'roleCode') like 'LEGACY_HR_%' or r ->> 'roleCode' = 'BUSINESS_USER') then
      raise exception 'revoked role listed: %', v_roles;
    end if;
  end;
end $$;

rollback;

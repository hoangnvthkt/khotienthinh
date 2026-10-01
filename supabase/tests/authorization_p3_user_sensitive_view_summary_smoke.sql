-- Run after authorization_p3_user_sensitive_view_summary. Rolls back.
begin;

create temporary table p3_ssv_context (
  admin_auth uuid, admin_email text, admin_id uuid,
  employee_auth uuid, employee_email text, employee_id uuid, project_id text
) on commit drop;
grant select on p3_ssv_context to authenticated;

insert into p3_ssv_context
select a.auth_id, a.email, a.id, e.auth_id, e.email, e.id, (select p.id from public.projects p order by p.created_at desc limit 1)
from (select * from public.users where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) a,
     (select * from public.users where role = 'EMPLOYEE' and is_active and account_status = 'ACTIVE' and auth_id is not null
        and not exists (select 1 from public.project_sensitive_view_grants g where g.user_id = users.id)
      order by created_at limit 1) e;

set local role authenticated;

-- An employee cannot read anyone's summary, including their own.
do $$
declare v_c p3_ssv_context%rowtype; v_blocked boolean := false;
begin
  select * into v_c from p3_ssv_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  begin perform public.get_user_sensitive_view_summary(v_c.employee_id);
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'employee read a sensitive-view summary'; end if;
end $$;

-- Admin sees switches as they are turned on and off.
do $$
declare v_c p3_ssv_context%rowtype; v_s jsonb;
begin
  select * into v_c from p3_ssv_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);

  v_s := public.get_user_sensitive_view_summary(v_c.employee_id);
  if (v_s ->> 'financeAll')::boolean or jsonb_array_length(v_s -> 'financeProjectIds') <> 0 then
    raise exception 'unexpected finance access before grant: %', v_s;
  end if;

  perform public.set_project_sensitive_view_grant(v_c.employee_id, v_c.project_id, 'finance', true, 'P3 smoke finance access');
  v_s := public.get_user_sensitive_view_summary(v_c.employee_id);
  if not (v_s -> 'financeProjectIds') ? v_c.project_id then raise exception 'project switch missing: %', v_s; end if;
  if (v_s ->> 'financeAll')::boolean then raise exception 'one project must not set all-projects: %', v_s; end if;
  if jsonb_array_length(v_s -> 'contractProjectIds') <> 0 then raise exception 'contract leaked from finance switch: %', v_s; end if;

  perform public.set_project_sensitive_view_grant(v_c.employee_id, null, 'contract', true, 'P3 smoke contract all');
  v_s := public.get_user_sensitive_view_summary(v_c.employee_id);
  if not (v_s ->> 'contractAll')::boolean then raise exception 'all-projects contract switch missing: %', v_s; end if;

  perform public.set_project_sensitive_view_grant(v_c.employee_id, v_c.project_id, 'finance', false, 'P3 smoke finance off');
  v_s := public.get_user_sensitive_view_summary(v_c.employee_id);
  if jsonb_array_length(v_s -> 'financeProjectIds') <> 0 then raise exception 'revoked switch still listed: %', v_s; end if;

  if not (public.get_user_sensitive_view_summary(v_c.admin_id) ->> 'isSystemAdmin')::boolean then
    raise exception 'admin not flagged as system admin';
  end if;
end $$;

rollback;

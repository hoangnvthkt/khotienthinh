-- Run after authorization_p0c_enforce_sensitive_reads. Rolls back.
begin;

create temporary table p0c3_context (
  admin_auth uuid, admin_email text,
  employee_id uuid, employee_auth uuid, employee_email text,
  project_id text, site_id text,
  tx_total int, finance_total int, contract_total int, supplier_total int
) on commit drop;
grant select on p0c3_context to authenticated;

-- A project with transactions and a customer contract, and an employee with
-- no switch, no processor Room seat and no company contract rights.
insert into p0c3_context
select a.auth_id, a.email, e.id, e.auth_id, e.email, p.id, p.construction_site_id::text,
  (select count(*) from public.project_transactions t where t.project_id = p.id),
  (select count(*) from public.project_finances f where f.project_id = p.id),
  (select count(*) from public.customer_contracts c where c.project_id = p.id),
  (select count(*) from public.supplier_contracts)
from (select * from public.users where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) a,
     (select * from public.users u where role = 'EMPLOYEE' and is_active and account_status = 'ACTIVE' and auth_id is not null
        and not exists (select 1 from public.project_sensitive_view_grants g where g.user_id = u.id and g.is_active)
        and not exists (select 1 from public.project_permission_room_members m join public.project_staff s on s.id = m.project_staff_id
                        where s.user_id = u.id::text and m.is_active and m.room_code in ('payment', 'quantity_acceptance'))
        and not ('HD' = any(coalesce(u.admin_modules, '{}'::text[])) or coalesce(u.admin_sub_modules, '{}'::jsonb) ? 'HD')
        and not exists (select 1 from public.user_permission_grants g where g.user_id = u.id and g.permission_code like 'contract.%.manage')
      order by created_at limit 1) e,
     (select pr.* from public.projects pr
        where exists (select 1 from public.project_transactions t where t.project_id = pr.id)
          and exists (select 1 from public.customer_contracts c where c.project_id = pr.id)
        order by pr.created_at desc limit 1) p;

do $$ begin
  if (select count(*) from p0c3_context) <> 1 then raise exception 'smoke fixture not found'; end if;
  if (select tx_total from p0c3_context) = 0 then raise exception 'fixture project has no transactions'; end if;
end $$;

set local role authenticated;

-- Employee without a switch sees no finance or customer contracts, but still
-- sees supplier contracts.
do $$
declare v_c p0c3_context%rowtype; v_scope jsonb;
begin
  select * into v_c from p0c3_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  if (select count(*) from public.project_transactions where project_id = v_c.project_id) <> 0 then raise exception 'transactions visible without switch'; end if;
  if (select count(*) from public.project_finances where project_id = v_c.project_id) <> 0 then raise exception 'project finance visible without switch'; end if;
  if (select count(*) from public.project_cost_items where project_id = v_c.project_id) <> 0 then raise exception 'cost items visible without switch'; end if;
  if (select count(*) from public.project_dashboard_snapshots where project_id = v_c.project_id) <> 0 then raise exception 'dashboard snapshot visible without switch'; end if;
  if (select count(*) from public.customer_contracts where project_id = v_c.project_id) <> 0 then raise exception 'customer contracts visible without switch'; end if;
  if (select count(*) from public.supplier_contracts) <> v_c.supplier_total then raise exception 'supplier contracts were hidden'; end if;
  v_scope := public.get_my_sensitive_view_scope();
  if (v_scope #>> '{finance,all}')::boolean or (v_scope #> '{finance,projectIds}') ? v_c.project_id then raise exception 'scope reports finance: %', v_scope; end if;
end $$;

-- Admin switches finance on for the employee on this project.
do $$
declare v_c p0c3_context%rowtype;
begin
  select * into v_c from p0c3_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  if (select count(*) from public.project_transactions where project_id = v_c.project_id) <> v_c.tx_total then raise exception 'admin lost transactions'; end if;
  if (select count(*) from public.customer_contracts where project_id = v_c.project_id) <> v_c.contract_total then raise exception 'admin lost contracts'; end if;
  perform public.set_project_sensitive_view_grant(v_c.employee_id, v_c.project_id, 'finance', true, 'P0-C3 smoke finance access');
end $$;

do $$
declare v_c p0c3_context%rowtype; v_scope jsonb;
begin
  select * into v_c from p0c3_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  if (select count(*) from public.project_transactions where project_id = v_c.project_id) <> v_c.tx_total then raise exception 'finance switch did not open transactions'; end if;
  if (select count(*) from public.project_finances where project_id = v_c.project_id) <> v_c.finance_total then raise exception 'finance switch did not open project finance'; end if;
  if (select count(*) from public.customer_contracts where project_id = v_c.project_id) <> 0 then raise exception 'finance switch opened contracts'; end if;
  if exists (select 1 from public.project_transactions where project_id is distinct from v_c.project_id
             and (construction_site_id is null or construction_site_id is distinct from v_c.site_id)) then
    raise exception 'finance switch leaked other projects';
  end if;
  v_scope := public.get_my_sensitive_view_scope();
  if not (v_scope #> '{finance,projectIds}') ? v_c.project_id then raise exception 'scope misses project: %', v_scope; end if;
end $$;

-- Contract switch opens customer contracts of that project only.
do $$
declare v_c p0c3_context%rowtype;
begin
  select * into v_c from p0c3_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  perform public.set_project_sensitive_view_grant(v_c.employee_id, v_c.project_id, 'contract', true, 'P0-C3 smoke contract access');
end $$;

do $$
declare v_c p0c3_context%rowtype;
begin
  select * into v_c from p0c3_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  if (select count(*) from public.customer_contracts where project_id = v_c.project_id) <> v_c.contract_total then raise exception 'contract switch did not open contracts'; end if;
  if exists (select 1 from public.customer_contracts where project_id is distinct from v_c.project_id
             and (construction_site_id is null or construction_site_id is distinct from v_c.site_id)) then
    raise exception 'contract switch leaked other projects';
  end if;
end $$;

-- Without an edit permission the employee cannot write transactions.
do $$
declare v_c p0c3_context%rowtype; v_blocked boolean := false;
begin
  select * into v_c from p0c3_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  if app_private.project_user_has_permission(v_c.project_id, v_c.site_id, 'edit', v_c.employee_id) then return; end if;
  begin
    update public.project_transactions set description = description where project_id = v_c.project_id;
    if found then raise exception 'employee updated transactions'; end if;
    v_blocked := true;
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'transaction write not blocked'; end if;
end $$;

reset role;
rollback;

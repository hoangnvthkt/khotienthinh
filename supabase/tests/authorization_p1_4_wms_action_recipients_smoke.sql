-- Run after authorization_p1_4_wms_action_recipients. Rolls back.
-- For every active user and warehouse, the recipient helper must agree with
-- the check the server applies when that user acts (wms_has_action).
begin;
create temporary table p14_cases on commit drop as
select u.id user_id, u.auth_id, u.email, w.id::text warehouse_id, code.permission_code,
  app_private.wms_user_has_action(u.id, code.permission_code, w.id::text, null) helper_result
from public.users u
cross join (select id from public.warehouses) w
cross join (values ('wms.request.approve'), ('wms.request.export'), ('wms.request.receive'), ('wms.transaction.approve')) code(permission_code)
where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null;
grant select, update on p14_cases to authenticated;
alter table p14_cases add column actor_result boolean;

set local role authenticated;
do $$
declare v_case record;
begin
  for v_case in select distinct user_id, auth_id, email from p14_cases loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_case.auth_id, 'email', v_case.email, 'role', 'authenticated')::text, true);
    update p14_cases c
    set actor_result = app_private.wms_has_action(c.permission_code, c.warehouse_id, null, null, null)
    where c.user_id = v_case.user_id;
  end loop;
end $$;
reset role;

do $$
declare v_mismatch int; v_checked int;
begin
  select count(*) filter (where helper_result is distinct from actor_result), count(*) into v_mismatch, v_checked from p14_cases;
  if v_checked = 0 then raise exception 'no cases checked'; end if;
  if v_mismatch > 0 then raise exception 'helper disagrees with server on % of % cases', v_mismatch, v_checked; end if;
end $$;

-- The RPC needs an active account and a WMS code.
set local role authenticated;
do $$
declare v_blocked boolean := false; v_c record;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin perform * from public.list_wms_action_recipients('wms.request.approve', '{}');
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'anonymous-like caller listed recipients'; end if;

  select auth_id, email into v_c from p14_cases limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.auth_id, 'email', v_c.email, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin perform * from public.list_wms_action_recipients('project.payment.view', '{}');
  exception when invalid_parameter_value then v_blocked := true; end;
  if not v_blocked then raise exception 'non-WMS code accepted'; end if;
  if not exists (select 1 from public.list_wms_action_recipients('wms.request.approve', array[(select warehouse_id from p14_cases limit 1)])) then
    raise exception 'no approver found for a warehouse';
  end if;
end $$;
reset role;
rollback;

-- Run right after authorization_p1_5_module_admin_from_capability (before any
-- step-2 revocation). For every active user and every module key the server
-- calls is_module_admin with, the new capability rule must match the old
-- legacy-column rule. Rolls back.
begin;
create temporary table p15_cases on commit drop as
select u.id user_id, u.auth_id, u.email, m.module,
  (u.role = 'ADMIN' or (m.module <> 'DA' and (m.module = any(coalesce(u.admin_modules, '{}'::text[])) or coalesce(u.admin_sub_modules, '{}'::jsonb) ? m.module))) old_rule
from public.users u
cross join (values ('DA'),('EX'),('FEEDBACK'),('HD'),('PROCUREMENT'),('RQ'),('SETTINGS'),('TENDER_AI'),('TS'),('WF'),('WMS')) m(module)
where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null;
alter table p15_cases add column new_rule boolean;
grant select, update on p15_cases to authenticated;

set local role authenticated;
do $$
declare v_user record;
begin
  for v_user in select distinct user_id, auth_id, email from p15_cases loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user.auth_id, 'email', v_user.email, 'role', 'authenticated')::text, true);
    update p15_cases set new_rule = public.is_module_admin(module) where user_id = v_user.user_id;
  end loop;
end $$;
reset role;

do $$
declare v_diff text;
begin
  select string_agg(module || ':' || old_rule || '->' || new_rule, ', ') into v_diff
  from p15_cases where old_rule is distinct from new_rule;
  if v_diff is not null then raise exception 'module admin changed: %', v_diff; end if;
end $$;
rollback;

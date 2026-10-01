-- Run after authorization_p3_own_scope_no_expiry. Rolls back.
begin;

create temporary table p3_own_context (
  admin_id uuid, admin_auth uuid, admin_email text, target_id uuid
) on commit drop;
grant select on p3_own_context to authenticated;

insert into p3_own_context
select a.id, a.auth_id, a.email, t.id
from (select * from public.users where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) a,
     (select * from public.users where role = 'EMPLOYEE' and is_active and account_status = 'ACTIVE'
        and not exists (select 1 from public.user_permission_grants g where g.user_id = users.id and g.permission_code = 'hrm.employee.edit_profile')
      order by created_at limit 1) t;

do $$
begin
  if not exists (select 1 from p3_own_context where target_id is not null) then raise exception 'fixture missing'; end if;
end $$;

-- Templates: own scope carries no default end date, company-wide scope still does.
do $$
declare v_items jsonb;
begin
  v_items := app_private.normalize_user_permission_template_items(jsonb_build_array(
    jsonb_build_object('permissionCode', 'hrm.employee.edit_profile', 'scopeType', 'own'),
    jsonb_build_object('permissionCode', 'hrm.employee.edit_profile', 'scopeType', 'global')));
  if exists (select 1 from jsonb_array_elements(v_items) i where i ->> 'scopeType' = 'own' and i ? 'expiresInDays') then
    raise exception 'own scope still gets an end date: %', v_items;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_items) i where i ->> 'scopeType' = 'global' and (i ->> 'expiresInDays')::int = 365) then
    raise exception 'global scope lost its end date: %', v_items;
  end if;
  if exists (select 1 from public.user_permission_templates t, jsonb_array_elements(t.items) i
      where i ->> 'permissionCode' = 'hrm.employee.edit_profile' and i ->> 'scopeType' = 'own' and i ? 'expiresInDays') then
    raise exception 'stored templates still carry an end date for own scope';
  end if;
end $$;

set local role authenticated;

create or replace function pg_temp.try_grant(p_target uuid, p_code text, p_scope text) returns text
language plpgsql as $f$
declare v_detail text;
begin
  perform public.preview_direct_grant_replacement(p_target, jsonb_build_array(jsonb_build_object(
    'permission_code', p_code, 'scope_type', p_scope, 'scope_id', '*', 'is_active', true)));
  return 'ok';
exception when check_violation then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail::jsonb ->> 'code';
end $f$;

do $$
declare v_c p3_own_context%rowtype;
begin
  select * into v_c from p3_own_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);

  -- Own scope of a non-sensitive permission: no expiry needed.
  if pg_temp.try_grant(v_c.target_id, 'hrm.employee.edit_profile', 'own') <> 'ok' then
    raise exception 'edit_profile@own without expiry was refused';
  end if;
  -- Same permission company-wide still needs an expiry.
  if pg_temp.try_grant(v_c.target_id, 'hrm.employee.edit_profile', 'global') is distinct from 'expiry_required' then
    raise exception 'edit_profile@global without expiry was accepted';
  end if;
  -- Own scope of a sensitive permission still needs an expiry.
  if pg_temp.try_grant(v_c.target_id, 'hrm.leave.approve', 'own') is distinct from 'expiry_required' then
    raise exception 'sensitive own-scope grant without expiry was accepted';
  end if;
end $$;

rollback;

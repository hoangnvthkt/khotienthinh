-- Run after authorization_p3_user_permission_templates. Rolls back.
begin;

create temporary table p3_tpl_context (
  admin_auth uuid, admin_email text,
  employee_auth uuid, employee_email text,
  expiry_code text, plain_code text, warehouse_code text
) on commit drop;
grant select on p3_tpl_context to authenticated;

insert into p3_tpl_context (admin_auth, admin_email, employee_auth, employee_email)
select a.auth_id, a.email, e.auth_id, e.email
from (select * from public.users where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) a,
     (select * from public.users where role = 'EMPLOYEE' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) e;

update p3_tpl_context set
  expiry_code = (select permission_code from public.permission_actions
    where is_active and direct_grant_allowed and direct_grant_requires_expiry and 'global' = any(scope_modes)
      and permission_code <> 'system.settings.manage' order by permission_code limit 1),
  plain_code = (select permission_code from public.permission_actions
    where is_active and direct_grant_allowed and not direct_grant_requires_expiry and 'global' = any(scope_modes)
      and permission_code <> 'system.settings.manage' order by permission_code limit 1),
  warehouse_code = (select permission_code from public.permission_actions
    where is_active and direct_grant_allowed and 'warehouse' = any(scope_modes)
      and not ('global' = any(scope_modes)) order by permission_code limit 1);

do $$
declare v_c p3_tpl_context%rowtype;
begin
  select * into v_c from p3_tpl_context;
  if v_c.admin_auth is null or v_c.employee_auth is null then raise exception 'fixture missing: admin or employee'; end if;
  if v_c.expiry_code is null or v_c.plain_code is null then raise exception 'fixture missing: permission codes'; end if;
end $$;

set local role authenticated;

-- A regular employee cannot save a template.
do $$
declare v_c p3_tpl_context%rowtype; v_blocked boolean := false;
begin
  select * into v_c from p3_tpl_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.employee_auth, 'email', v_c.employee_email, 'role', 'authenticated')::text, true);
  begin
    perform public.save_user_permission_template('smoke_employee', 'Smoke', null,
      jsonb_build_array(jsonb_build_object('permissionCode', v_c.plain_code, 'scopeType', 'global')), '{}', true);
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'employee saved a template'; end if;
end $$;

-- Admin: invalid items are refused.
do $$
declare v_c p3_tpl_context%rowtype; v_msg text;
begin
  select * into v_c from p3_tpl_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);

  v_msg := null;
  begin
    perform public.save_user_permission_template('smoke_bad', 'Smoke', null,
      jsonb_build_array(jsonb_build_object('permissionCode', 'system.settings.manage', 'scopeType', 'global')), '{}', true);
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg not like 'PERMISSION_TEMPLATE_NOT_DIRECT%' then raise exception 'not-direct code accepted: %', v_msg; end if;

  v_msg := null;
  begin
    perform public.save_user_permission_template('smoke_bad', 'Smoke', null,
      jsonb_build_array(jsonb_build_object('permissionCode', 'no.such.code', 'scopeType', 'global')), '{}', true);
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg not like 'PERMISSION_TEMPLATE_UNKNOWN%' then raise exception 'unknown code accepted: %', v_msg; end if;

  v_msg := null;
  begin
    perform public.save_user_permission_template('smoke_bad', 'Smoke', null,
      jsonb_build_array(jsonb_build_object('permissionCode', v_c.plain_code, 'scopeType', 'warehouse')), '{}', true);
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg not like 'PERMISSION_TEMPLATE_SCOPE%' then raise exception 'warehouse scope accepted: %', v_msg; end if;

  if exists (select 1 from public.user_permission_templates where code = 'smoke_bad') then
    raise exception 'a refused template was stored';
  end if;
end $$;

-- Admin: a valid template is stored, expiry defaults to 365 days only where required, and it is audited.
do $$
declare v_c p3_tpl_context%rowtype; v_row public.user_permission_templates;
begin
  select * into v_c from p3_tpl_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  v_row := public.save_user_permission_template('smoke_ok', 'Smoke', 'smoke',
    jsonb_build_array(
      jsonb_build_object('permissionCode', v_c.expiry_code, 'scopeType', 'global'),
      jsonb_build_object('permissionCode', v_c.plain_code, 'scopeType', 'global'),
      jsonb_build_object('permissionCode', v_c.plain_code, 'scopeType', 'global')), '{}', true);
  if jsonb_array_length(v_row.items) <> 2 then raise exception 'duplicate item not collapsed: %', v_row.items; end if;
  if not exists (select 1 from jsonb_array_elements(v_row.items) i
      where i ->> 'permissionCode' = v_c.expiry_code and (i ->> 'expiresInDays')::int = 365) then
    raise exception 'expiry default missing: %', v_row.items;
  end if;
  if exists (select 1 from jsonb_array_elements(v_row.items) i
      where i ->> 'permissionCode' = v_c.plain_code and i ? 'expiresInDays') then
    raise exception 'expiry added to a permission that does not need one: %', v_row.items;
  end if;
  if not exists (select 1 from public.audit_trail where table_name = 'user_permission_templates' and record_id = 'smoke_ok') then
    raise exception 'template save not audited';
  end if;
end $$;

rollback;

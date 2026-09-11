begin;

do $$
begin
  if to_regprocedure('public.get_permission_admin_catalog()') is null then
    raise exception 'AUTH_MODULE_CATALOG_RPC_MISSING';
  end if;

  if exists (
    select 1
    from app_private.permission_application_default_view_grants bundle
    join public.permission_actions action_row
      on action_row.permission_code = bundle.permission_code
    where bundle.is_active
      and (
        not action_row.is_active
        or not action_row.direct_grant_allowed
        or not (bundle.default_scope_type = any(action_row.scope_modes))
        or action_row.direct_grant_requires_expiry
      )
  ) then
    raise exception 'AUTH_MODULE_CATALOG_INVALID_DEFAULT_VIEW_ITEM';
  end if;

  if (
    select array_agg(bundle.permission_code order by bundle.sort_order, bundle.permission_code)
    from app_private.permission_application_default_view_grants bundle
    where bundle.application_code = 'asset'
      and bundle.is_active
  ) is distinct from array[
    'asset.catalog.view',
    'asset.assignment.view',
    'asset.maintenance.view',
    'asset.audit.view'
  ]::text[] then
    raise exception 'AUTH_MODULE_CATALOG_ASSET_BUNDLE_INVALID';
  end if;
end;
$$;

create temporary table authorization_module_catalog_smoke_context (
  admin_id uuid not null,
  admin_auth_id uuid not null,
  admin_email text not null,
  ordinary_id uuid not null,
  ordinary_auth_id uuid not null,
  ordinary_email text not null
) on commit drop;

grant select on authorization_module_catalog_smoke_context to authenticated;

insert into authorization_module_catalog_smoke_context
select
  admin_user.id,
  admin_user.auth_id,
  admin_user.email,
  ordinary_user.id,
  ordinary_user.auth_id,
  ordinary_user.email
from lateral (
  select account.*
  from public.users account
  where account.auth_id is not null
    and account.is_active
    and account.account_status = 'ACTIVE'
    and app_private.has_permission(
      account.id,
      'system.authorization.manage_grants',
      'global',
      '*'
    )
  order by account.id
  limit 1
) admin_user
cross join lateral (
  select account.*
  from public.users account
  where account.auth_id is not null
    and account.is_active
    and account.account_status = 'ACTIVE'
    and not app_private.has_permission(
      account.id,
      'system.authorization.manage_grants',
      'global',
      '*'
    )
  order by account.id
  limit 1
) ordinary_user;

do $$
begin
  if (select count(*) from authorization_module_catalog_smoke_context) <> 1 then
    raise exception 'AUTH_MODULE_CATALOG_CLOUD_PERSONAS_NOT_FOUND';
  end if;
end;
$$;

set local role authenticated;

do $$
declare
  v_context authorization_module_catalog_smoke_context%rowtype;
  v_denied boolean := false;
begin
  select * into v_context from authorization_module_catalog_smoke_context;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_context.ordinary_auth_id,
      'email', v_context.ordinary_email,
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.get_permission_admin_catalog();
  exception
    when insufficient_privilege then
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'AUTH_MODULE_CATALOG_NON_MANAGER_NOT_DENIED';
  end if;
end;
$$;

do $$
declare
  v_context authorization_module_catalog_smoke_context%rowtype;
  v_catalog jsonb;
  v_asset_codes text[];
begin
  select * into v_context from authorization_module_catalog_smoke_context;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_context.admin_auth_id,
      'email', v_context.admin_email,
      'role', 'authenticated'
    )::text,
    true
  );

  v_catalog := public.get_permission_admin_catalog();
  if jsonb_typeof(v_catalog -> 'applications') is distinct from 'array' then
    raise exception 'AUTH_MODULE_CATALOG_INVALID_RESPONSE: %', v_catalog;
  end if;

  select array_agg(action_item ->> 'permissionCode' order by action_item ->> 'permissionCode')
  into v_asset_codes
  from jsonb_array_elements(v_catalog -> 'applications') application_item
  cross join lateral jsonb_array_elements(application_item -> 'modules') module_item
  cross join lateral jsonb_array_elements(module_item -> 'actions') action_item
  where application_item ->> 'code' = 'asset'
    and (action_item ->> 'isDefaultView')::boolean;

  if v_asset_codes is distinct from array[
    'asset.assignment.view',
    'asset.audit.view',
    'asset.catalog.view',
    'asset.maintenance.view'
  ]::text[] then
    raise exception 'AUTH_MODULE_CATALOG_ASSET_RPC_INVALID: %', v_asset_codes;
  end if;
end;
$$;

reset role;

select jsonb_build_object(
  'authorizationModuleCatalog', 'ok',
  'assetDefaultViewCount', 4
) as result;

rollback;

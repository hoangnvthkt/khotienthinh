-- Run after authorization_v2_phase6_disable_legacy_writes.
begin;

do $$
begin
  if has_function_privilege(
    'authenticated',
    'public.service_authorization_user_has_permission(uuid,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated can execute the service-only canonical evaluator';
  end if;
end $$;

create temporary table authorization_v2_phase6_smoke_context (
  admin_id uuid not null,
  admin_auth_id uuid not null,
  admin_email text not null,
  target_id uuid not null
) on commit drop;
grant select on authorization_v2_phase6_smoke_context to authenticated, service_role;

do $$
declare
  v_admin public.users%rowtype;
  v_target_id uuid := gen_random_uuid();
begin
  if not app_private.permission_hardening_flag('legacy_permission_writes_disabled') then
    raise exception 'Phase 6 legacy write flag is not enabled';
  end if;

  select * into v_admin from public.users
  where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null
  order by created_at, id limit 1;
  if v_admin.id is null then raise exception 'Active linked System Admin required'; end if;

  insert into public.users (id, name, email, username, role, is_active, account_status)
  values (
    v_target_id, 'Authorization V2 Phase 6 Target',
    'auth-v2-phase6-' || v_target_id || '@invalid.local',
    'auth-v2-phase6-' || v_target_id, 'EMPLOYEE', true, 'ACTIVE'
  );

  insert into authorization_v2_phase6_smoke_context
  values (v_admin.id, v_admin.auth_id, v_admin.email, v_target_id);
end $$;

do $$
declare
  v_context authorization_v2_phase6_smoke_context%rowtype;
  v_update_blocked boolean := false;
  v_insert_blocked boolean := false;
begin
  select * into v_context from authorization_v2_phase6_smoke_context;
  begin
    update public.users set allowed_modules = array['WMS']::text[] where id = v_context.target_id;
  exception when insufficient_privilege then
    v_update_blocked := sqlerrm = 'Legacy permission writes are disabled';
  end;
  if not v_update_blocked then raise exception 'Direct legacy update was not blocked'; end if;

  begin
    insert into public.users (
      id, name, email, username, role, is_active, account_status, allowed_modules
    ) values (
      gen_random_uuid(), 'Blocked Legacy Insert', 'blocked-legacy-insert@invalid.local',
      'blocked-legacy-insert', 'EMPLOYEE', true, 'ACTIVE', array['WMS']::text[]
    );
  exception when insufficient_privilege then
    v_insert_blocked := sqlerrm = 'Legacy permission writes are disabled';
  end;
  if not v_insert_blocked then raise exception 'Legacy insert was not blocked'; end if;
end $$;

set local role authenticated;

do $$
declare
  v_context authorization_v2_phase6_smoke_context%rowtype;
  v_old_rpc_blocked boolean := false;
  v_receipt jsonb;
  v_phase6_summary jsonb;
begin
  select * into v_context from authorization_v2_phase6_smoke_context;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.admin_auth_id, 'email', v_context.admin_email, 'role', 'authenticated'
  )::text, true);

  begin
    perform public.preview_user_permission_change(v_context.target_id, '{}'::jsonb, '[]'::jsonb);
  exception when insufficient_privilege then
    v_old_rpc_blocked := true;
  end;
  if not v_old_rpc_blocked then raise exception 'Legacy preview RPC remains executable'; end if;

  v_receipt := public.update_user_authorization_v2(
    v_context.target_id,
    jsonb_build_object('phone', '0900000000'),
    jsonb_build_array(jsonb_build_object(
      'permission_code', 'analytics.export', 'scope_type', 'global',
      'scope_id', '*', 'is_active', true
    )),
    'Phase 6 canonical authorization smoke',
    (select updated_at from public.users where id = v_context.target_id)
  );
  if coalesce((v_receipt->>'activeGrantCount')::integer, 0) <> 1 then
    raise exception 'Canonical authorization RPC failed: %', v_receipt;
  end if;

  if public.list_canonical_module_manager_ids(array['WMS']) is null then
    raise exception 'Canonical module manager resolver returned null';
  end if;

  v_phase6_summary := public.get_authorization_phase6_summary();
  if coalesce((v_phase6_summary->>'legacyWritesDisabled')::boolean, false) is not true then
    raise exception 'Phase 6 health summary does not report write shutdown';
  end if;
end $$;

set local role service_role;

do $$
declare
  v_context authorization_v2_phase6_smoke_context%rowtype;
begin
  select * into v_context from authorization_v2_phase6_smoke_context;
  if not public.service_authorization_user_has_permission(
    v_context.target_id, 'analytics.export', 'global', '*'
  ) then
    raise exception 'Service-only canonical evaluator did not resolve the direct grant';
  end if;
end $$;

set local role postgres;

do $$
declare
  v_context authorization_v2_phase6_smoke_context%rowtype;
  v_audit_before bigint;
  v_non_clear_blocked boolean := false;
begin
  select * into v_context from authorization_v2_phase6_smoke_context;
  select count(*) into v_audit_before from app_private.authorization_legacy_write_audit
  where target_user_id = v_context.target_id;

  perform set_config('app.account_lifecycle_command', 'on', true);
  update public.users
  set allowed_modules = '{}'::text[], admin_modules = '{}'::text[],
      allowed_sub_modules = '{}'::jsonb, admin_sub_modules = '{}'::jsonb
  where id = v_context.target_id;

  if (select count(*) from app_private.authorization_legacy_write_audit
      where target_user_id = v_context.target_id) <> v_audit_before + 1 then
    raise exception 'Account lifecycle legacy clear was not audited';
  end if;

  begin
    update public.users set admin_modules = array['WMS']::text[] where id = v_context.target_id;
  exception when insufficient_privilege then
    v_non_clear_blocked := sqlerrm = 'Account lifecycle may only clear legacy permission columns';
  end;
  if not v_non_clear_blocked then
    raise exception 'Account lifecycle bypass accepted a non-clear legacy write';
  end if;
end $$;

select jsonb_build_object(
  'result', 'authorization_v2_phase6_legacy_write_disabled_smoke_passed',
  'legacyWritesDisabled', app_private.permission_hardening_flag('legacy_permission_writes_disabled'),
  'legacyFallbackDisabled', app_private.permission_hardening_flag('legacy_fallback_disabled'),
  'legacyColumnsRetained', (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name in ('allowed_modules', 'admin_modules', 'allowed_sub_modules', 'admin_sub_modules')
  )
) result;

rollback;

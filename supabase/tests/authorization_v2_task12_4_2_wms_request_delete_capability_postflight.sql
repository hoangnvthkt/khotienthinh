select jsonb_build_object(
  'migrationLedgerRows', (
    select count(*)
    from supabase_migrations.schema_migrations
    where version = '20260915071458'
  ),
  'latestMigration', (
    select max(version) from supabase_migrations.schema_migrations
  ),
  'catalogAction', (
    select jsonb_build_object(
      'permissionCode', permission_code,
      'moduleCode', module_code,
      'scopes', scope_modes,
      'risk', risk_level,
      'readiness', grant_readiness,
      'directGrantAllowed', direct_grant_allowed
    )
    from public.permission_actions
    where permission_code = 'wms.request.delete'
  ),
  'authenticatedCanCallActionHelper', has_function_privilege(
    'authenticated',
    'app_private.material_request_wms_can_delete(text,uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticatedCanCallCompatibilityHelper', has_function_privilege(
    'authenticated',
    'app_private.material_request_wms_can_delete_compatibility(text,uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticatedCanCallV1', has_function_privilege(
    'authenticated',
    'app_private.material_request_can_delete(text,text,text,boolean,uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticatedCanCallV2', has_function_privilege(
    'authenticated',
    'app_private.material_request_can_delete_v2(text,text,text,boolean,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticatedCanCallV3', has_function_privilege(
    'authenticated',
    'app_private.material_request_can_delete_v3(text,text,text,text,boolean,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'actionHelperUsesCompatibility', position(
    'material_request_wms_can_delete_compatibility'
    in pg_get_functiondef(to_regprocedure(
      'app_private.material_request_wms_can_delete(text,uuid,text,text,text)'
    ))
  ) > 0,
  'actionHelperUsesCapability', position(
    'wms.request.delete'
    in pg_get_functiondef(to_regprocedure(
      'app_private.material_request_wms_can_delete(text,uuid,text,text,text)'
    ))
  ) > 0,
  'v3UsesV2', position(
    'material_request_can_delete_v2'
    in pg_get_functiondef(to_regprocedure(
      'app_private.material_request_can_delete_v3(text,text,text,text,boolean,uuid,text,text,text,text)'
    ))
  ) > 0,
  'activeUsers', (
    select count(*)
    from public.users
    where is_active and account_status = 'ACTIVE'
  ),
  'transitionBatches', (
    select count(*) from app_private.authorization_transition_batches
  ),
  'transitionItems', (
    select count(*) from app_private.authorization_transition_items
  ),
  'fixtureUsers', (
    select count(*)
    from public.users
    where email like 'task12-4-2-wms-delete-%@vioo.local'
  ),
  'fixtureRequests', (
    select count(*)
    from public.requests
    where title = 'Task 12.4.2 WMS request delete smoke'
  ),
  'directWmsLiteralFunctions', (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%is_module_admin(''WMS'')%'
  )
) as postflight;

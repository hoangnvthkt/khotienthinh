select jsonb_build_object(
  'migrationLedgerRows', (
    select count(*)
    from supabase_migrations.schema_migrations
    where version = '20260915064553'
  ),
  'latestMigration', (
    select max(version) from supabase_migrations.schema_migrations
  ),
  'catalogActions', (
    select jsonb_agg(jsonb_build_object(
      'permissionCode', permission_code,
      'scopes', scope_modes,
      'risk', risk_level,
      'expiryRequired', direct_grant_requires_expiry,
      'readiness', grant_readiness,
      'directGrantAllowed', direct_grant_allowed
    ) order by permission_code)
    from public.permission_actions
    where permission_code in (
      'wms.material_issue.settle',
      'wms.material_issue.reverse_settlement'
    )
  ),
  'authenticatedCanCallPostHelper', has_function_privilege(
    'authenticated',
    'app_private.material_issue_can_post_settlement(text,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticatedCanCallReverseHelper', has_function_privilege(
    'authenticated',
    'app_private.material_issue_can_reverse_settlement(text,uuid,uuid,text,text)',
    'EXECUTE'
  ),
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
    where email like 'task12-4-2-settle-%@vioo.local'
  ),
  'directWmsLiteralFunctions', (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%is_module_admin(''WMS'')%'
  ),
  'postHelperUsesCapability', position(
    'wms.material_issue.settle'
    in pg_get_functiondef(to_regprocedure(
      'app_private.material_issue_can_post_settlement(text,uuid,uuid,text,text)'
    ))
  ) > 0,
  'reverseHelperUsesCapability', position(
    'wms.material_issue.reverse_settlement'
    in pg_get_functiondef(to_regprocedure(
      'app_private.material_issue_can_reverse_settlement(text,uuid,uuid,text,text)'
    ))
  ) > 0
) as postflight;

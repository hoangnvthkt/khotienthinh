select jsonb_build_object(
  'migrationLedgerRows', (
    select count(*)
    from supabase_migrations.schema_migrations
    where version = '20260915070008'
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
    where permission_code = 'wms.purchase_order.return_supplier'
  ),
  'authenticatedCanCallHelper', has_function_privilege(
    'authenticated',
    'app_private.purchase_order_supplier_return_can_create(text,text,text)',
    'EXECUTE'
  ),
  'authenticatedCanCallCommand', has_function_privilege(
    'authenticated',
    'public.create_purchase_order_supplier_return(text,text,jsonb,text,text)',
    'EXECUTE'
  ),
  'anonCanCallCommand', has_function_privilege(
    'anon',
    'public.create_purchase_order_supplier_return(text,text,jsonb,text,text)',
    'EXECUTE'
  ),
  'commandUsesHelper', position(
    'purchase_order_supplier_return_can_create'
    in pg_get_functiondef(to_regprocedure(
      'public.create_purchase_order_supplier_return(text,text,jsonb,text,text)'
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
    where email like 'task12-4-2-supplier-return-%@vioo.local'
  ),
  'fixtureReturns', (
    select count(*)
    from public.purchase_order_supplier_returns
    where reason = 'Dedicated supplier-return capability smoke'
  ),
  'directWmsLiteralFunctions', (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%is_module_admin(''WMS'')%'
  )
) as postflight;

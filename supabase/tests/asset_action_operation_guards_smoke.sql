-- Run after 20260720093000_asset_action_operation_guards.sql.
-- Intended for rollback-only canary execution against linked DB.

do $$
declare
  v_allowed uuid := gen_random_uuid();
  v_denied uuid := gen_random_uuid();
  v_allowed_email text := 'asset-smoke-allowed-' || replace(gen_random_uuid()::text, '-', '') || '@example.test';
  v_denied_email text := 'asset-smoke-denied-' || replace(gen_random_uuid()::text, '-', '') || '@example.test';
  v_asset_id text := 'asset-action-smoke-' || replace(gen_random_uuid()::text, '-', '');
  v_batch_id text := 'asset-action-smoke-batch-' || replace(gen_random_uuid()::text, '-', '');
  v_maintenance_id text := 'asset-action-smoke-maint-' || replace(gen_random_uuid()::text, '-', '');
  v_source_stock_id text;
  v_transfer public.asset_transfers%rowtype;
begin
  insert into public.users (
    id, auth_id, name, email, username, role, is_active, account_status,
    allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
  )
  values
    (v_allowed, null, 'Asset smoke allowed', v_allowed_email, 'asset_smoke_allowed_' || left(v_allowed::text, 8), 'EMPLOYEE', true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb),
    (v_denied, null, 'Asset smoke denied', v_denied_email, 'asset_smoke_denied_' || left(v_denied::text, 8), 'EMPLOYEE', true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb);

  insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
  values
    (v_allowed, 'asset.catalog.create', 'warehouse', 'asset-smoke-wh-a', true),
    (v_allowed, 'asset.catalog.dispose', 'warehouse', 'asset-smoke-wh-a', true),
    (v_allowed, 'asset.assignment.assign', 'warehouse', 'asset-smoke-wh-a', true),
    (v_allowed, 'asset.maintenance.create', 'warehouse', 'asset-smoke-wh-a', true),
    (v_allowed, 'asset.maintenance.complete', 'warehouse', 'asset-smoke-wh-a', true),
    (v_allowed, 'asset.catalog.transfer_stock', 'warehouse', 'asset-smoke-wh-a', true);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid()::text, 'email', v_denied_email)::text, true);
  begin
    perform public.create_asset_with_initial_stock(jsonb_build_object(
      'id', v_asset_id || '-denied',
      'code', 'SMK-DENIED',
      'name', 'Denied asset',
      'status', 'AVAILABLE',
      'warehouse_id', 'asset-smoke-wh-a',
      'quantity', 1,
      'original_value', 1,
      'purchase_date', now()::date::text,
      'depreciation_years', 1,
      'residual_value', 0,
      'created_at', now()::text,
      'updated_at', now()::text
    ));
    raise exception 'asset create without grant unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid()::text, 'email', v_allowed_email)::text, true);
  perform public.create_asset_with_initial_stock(jsonb_build_object(
    'id', v_asset_id,
    'code', 'SMK-ACTION-1',
    'name', 'Smoke asset',
    'status', 'AVAILABLE',
    'warehouse_id', 'asset-smoke-wh-a',
    'quantity', 1,
    'original_value', 1,
    'purchase_date', now()::date::text,
    'depreciation_years', 1,
    'residual_value', 0,
    'created_at', now()::text,
    'updated_at', now()::text
  ));

  perform public.dispose_asset(v_asset_id, now()::date::text, 0, 'smoke dispose');
  if not exists (
    select 1 from public.assets where id = v_asset_id and status = 'DISPOSED'::public.asset_status
  ) then
    raise exception 'dispose_asset did not update asset status';
  end if;

  perform public.create_asset_with_initial_stock(jsonb_build_object(
    'id', v_batch_id,
    'code', 'SMK-ACTION-BATCH',
    'name', 'Smoke batch asset',
    'status', 'AVAILABLE',
    'asset_type', 'batch',
    'warehouse_id', 'asset-smoke-wh-a',
    'quantity', 5,
    'original_value', 1,
    'purchase_date', now()::date::text,
    'depreciation_years', 1,
    'residual_value', 0,
    'created_at', now()::text,
    'updated_at', now()::text
  ));

  select id into v_source_stock_id
  from public.asset_location_stocks
  where asset_id = v_batch_id
    and warehouse_id = 'asset-smoke-wh-a'
  limit 1;

  begin
    perform public.transfer_asset_stock(v_batch_id, v_source_stock_id, 1, 'asset-smoke-wh-b', null, 'missing dest grant', now()::date::text);
    raise exception 'transfer without destination grant unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
  values (v_allowed, 'asset.catalog.transfer_stock', 'warehouse', 'asset-smoke-wh-b', true);

  v_transfer := public.transfer_asset_stock(v_batch_id, v_source_stock_id, 1, 'asset-smoke-wh-b', null, 'smoke transfer', now()::date::text);
  if v_transfer.id is null or v_transfer.to_warehouse_id <> 'asset-smoke-wh-b' then
    raise exception 'transfer_asset_stock did not create transfer row';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid()::text, 'email', v_denied_email)::text, true);
  begin
    perform public.record_asset_assignment(jsonb_build_object(
      'id', 'asset-action-smoke-assign-denied',
      'asset_id', v_batch_id,
      'type', 'assign',
      'user_id', v_denied::text,
      'user_name', 'Asset smoke denied',
      'date', now()::text,
      'performed_by', v_denied::text,
      'performed_by_name', 'Asset smoke denied'
    ));
    raise exception 'assignment without grant unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid()::text, 'email', v_allowed_email)::text, true);
  perform public.record_asset_assignment(jsonb_build_object(
    'id', 'asset-action-smoke-assign-ok',
    'asset_id', v_batch_id,
    'type', 'assign',
    'user_id', v_denied::text,
    'user_name', 'Asset smoke denied',
    'date', now()::text,
    'performed_by', v_allowed::text,
    'performed_by_name', 'Asset smoke allowed'
  ));

  perform public.record_asset_maintenance(jsonb_build_object(
    'id', v_maintenance_id,
    'asset_id', v_batch_id,
    'type', 'repair',
    'description', 'Smoke maintenance',
    'cost', 0,
    'estimated_cost', 0,
    'actual_cost', 0,
    'start_date', now()::date::text,
    'status', 'in_progress',
    'performed_by', v_allowed::text,
    'performed_by_name', 'Asset smoke allowed',
    'attachments', '[]'::jsonb
  ), 'create');

  perform public.complete_asset_maintenance(v_maintenance_id, now()::date::text, 0, 'smoke complete');
  if not exists (
    select 1 from public.asset_maintenances
    where id = v_maintenance_id
      and status = 'completed'::public.maintenance_status
  ) then
    raise exception 'complete_asset_maintenance did not complete maintenance';
  end if;
end;
$$;

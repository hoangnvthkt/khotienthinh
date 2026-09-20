begin read only;

do $$
begin
  if to_regprocedure(
    'public.save_purchase_order_aggregate_v1(jsonb,jsonb,jsonb,bigint,jsonb,jsonb,uuid,uuid)'
  ) is null then
    raise exception 'G1_W2_AGGREGATE_COMMAND_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_orders'
      and column_name = 'row_version'
      and data_type = 'bigint'
  ) then
    raise exception 'G1_W2_PO_VERSION_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_order_request_lines'
      and column_name = 'updated_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'G1_W2_LINK_VERSION_MISSING';
  end if;

  if not exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.proname = 'save_purchase_order_aggregate_v1'
      and not function_row.prosecdef
      and function_row.proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'G1_W2_PUBLIC_WRAPPER_SECURITY_INVALID';
  end if;

  if has_function_privilege(
      'anon',
      'public.save_purchase_order_aggregate_v1(jsonb,jsonb,jsonb,bigint,jsonb,jsonb,uuid,uuid)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.save_purchase_order_aggregate_v1(jsonb,jsonb,jsonb,bigint,jsonb,jsonb,uuid,uuid)',
      'EXECUTE'
    ) then
    raise exception 'G1_W2_PUBLIC_WRAPPER_ACL_INVALID';
  end if;

  if not exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'app_private'
      and function_row.proname = 'save_purchase_order_aggregate_v1'
      and function_row.prosecdef
      and function_row.proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'G1_W2_PRIVATE_COMMAND_SECURITY_INVALID';
  end if;

  if has_table_privilege('authenticated', 'app_private.purchase_order_aggregate_commands', 'SELECT')
     or not exists (
       select 1
       from pg_policies
       where schemaname = 'app_private'
         and tablename = 'purchase_order_aggregate_commands'
         and policyname = 'purchase_order_aggregate_commands_authenticated_deny'
     ) then
    raise exception 'G1_W2_LEDGER_ACL_INVALID';
  end if;
end;
$$;

rollback;

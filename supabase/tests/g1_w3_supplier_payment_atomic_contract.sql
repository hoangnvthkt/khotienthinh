begin read only;

do $$
begin
  if to_regprocedure(
    'public.save_supplier_payment_batch_draft_v1(jsonb,jsonb,bigint,uuid,uuid)'
  ) is null then
    raise exception 'G1_W3_DRAFT_COMMAND_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'supplier_payment_batches'
      and column_name = 'row_version'
      and data_type = 'bigint'
  ) then
    raise exception 'G1_W3_BATCH_VERSION_MISSING';
  end if;

  if not exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.proname = 'save_supplier_payment_batch_draft_v1'
      and not function_row.prosecdef
      and function_row.proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'G1_W3_DRAFT_WRAPPER_SECURITY_INVALID';
  end if;

  if has_function_privilege(
      'anon',
      'public.save_supplier_payment_batch_draft_v1(jsonb,jsonb,bigint,uuid,uuid)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.save_supplier_payment_batch_draft_v1(jsonb,jsonb,bigint,uuid,uuid)',
      'EXECUTE'
    ) then
    raise exception 'G1_W3_DRAFT_WRAPPER_ACL_INVALID';
  end if;

  if not exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'app_private'
      and function_row.proname = 'save_supplier_payment_batch_draft_v1'
      and function_row.prosecdef
      and function_row.proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'G1_W3_DRAFT_OWNER_SECURITY_INVALID';
  end if;

  if not exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.proname = 'post_supplier_payment_batch'
      and not function_row.prosecdef
      and function_row.proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'G1_W3_POST_WRAPPER_SECURITY_INVALID';
  end if;

  if to_regprocedure('app_private.post_supplier_payment_batch(uuid,uuid)') is null
     or not exists (
       select 1
       from pg_proc function_row
       where function_row.oid = 'app_private.post_supplier_payment_batch(uuid,uuid)'::regprocedure
         and function_row.prosecdef
         and function_row.proconfig @> array['search_path=""']::text[]
     ) then
    raise exception 'G1_W3_POST_OWNER_SECURITY_INVALID';
  end if;

  if has_table_privilege('authenticated', 'app_private.supplier_payment_draft_commands', 'SELECT')
     or not exists (
       select 1
       from pg_policies
       where schemaname = 'app_private'
         and tablename = 'supplier_payment_draft_commands'
         and policyname = 'supplier_payment_draft_commands_authenticated_deny'
     ) then
    raise exception 'G1_W3_LEDGER_ACL_INVALID';
  end if;
end;
$$;

rollback;

begin read only;

do $$
declare
  v_private_definition text;
begin
  if to_regprocedure(
    'public.record_supplier_invoice_reconciliation_v2(jsonb,jsonb,uuid)'
  ) is null or to_regprocedure(
    'app_private.record_supplier_invoice_reconciliation_v2(jsonb,jsonb,uuid)'
  ) is null then
    raise exception 'G1_W4_INVOICE_COMMAND_MISSING';
  end if;

  if not exists (
    select 1
    from pg_proc function_row
    where function_row.oid = 'public.record_supplier_invoice_reconciliation_v2(jsonb,jsonb,uuid)'::regprocedure
      and not function_row.prosecdef
      and function_row.proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'G1_W4_PUBLIC_WRAPPER_SECURITY_INVALID';
  end if;

  if has_function_privilege(
      'anon',
      'public.record_supplier_invoice_reconciliation_v2(jsonb,jsonb,uuid)',
      'EXECUTE'
    ) or not has_function_privilege(
      'authenticated',
      'public.record_supplier_invoice_reconciliation_v2(jsonb,jsonb,uuid)',
      'EXECUTE'
    ) then
    raise exception 'G1_W4_PUBLIC_WRAPPER_ACL_INVALID';
  end if;

  if not exists (
    select 1
    from pg_proc function_row
    where function_row.oid = 'app_private.record_supplier_invoice_reconciliation_v2(jsonb,jsonb,uuid)'::regprocedure
      and function_row.prosecdef
      and function_row.proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'G1_W4_PRIVATE_OWNER_SECURITY_INVALID';
  end if;

  if to_regprocedure(
      'app_private.record_supplier_invoice_reconciliation_v2_engine(jsonb,jsonb,uuid)'
    ) is null or has_function_privilege(
      'authenticated',
      'app_private.record_supplier_invoice_reconciliation_v2_engine(jsonb,jsonb,uuid)',
      'EXECUTE'
    ) then
    raise exception 'G1_W4_ENGINE_ACL_INVALID';
  end if;

  select pg_get_functiondef(
    'app_private.record_supplier_invoice_reconciliation_v2(jsonb,jsonb,uuid)'::regprocedure
  ) into v_private_definition;

  if position('SUPPLIER_INVOICE_COVERAGE_UNSUPPORTED' in v_private_definition) = 0 then
    raise exception 'G1_W4_COVERAGE_GUARD_MISSING';
  end if;
  if position('SUPPLIER_INVOICE_MULTI_SCOPE_UNSUPPORTED' in v_private_definition) = 0 then
    raise exception 'G1_W4_MULTI_SCOPE_GUARD_MISSING';
  end if;
  if position('SUPPLIER_INVOICE_REPLAY_CONFLICT' in v_private_definition) = 0 then
    raise exception 'G1_W4_REPLAY_GUARD_MISSING';
  end if;
end;
$$;

rollback;

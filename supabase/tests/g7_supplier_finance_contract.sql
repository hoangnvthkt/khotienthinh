begin read only;

do $$
declare v_name text;
begin
  foreach v_name in array array[
    'record_supplier_invoice_reconciliation_v3(jsonb,jsonb,jsonb,text)',
    'reverse_supplier_invoice_v1(uuid,bigint,text,text)',
    'post_supplier_payment_batch_v2(uuid,bigint,text)',
    'reverse_supplier_payment_batch_v2(uuid,bigint,text,text)',
    'get_supplier_finance_control_v1(text,text,timestamp with time zone)',
    'get_supplier_invoice_matching_candidates_v1(text,text,text)'
  ] loop
    if to_regprocedure('public.'||v_name) is null then raise exception 'G7_PUBLIC_RPC_MISSING: %',v_name; end if;
    if (select prosecdef from pg_proc where oid=to_regprocedure('public.'||v_name)) then
      raise exception 'G7_PUBLIC_RPC_MUST_BE_INVOKER: %',v_name;
    end if;
    if has_function_privilege('anon','public.'||v_name,'execute')
       or not has_function_privilege('authenticated','public.'||v_name,'execute') then
      raise exception 'G7_PUBLIC_RPC_ACL_INVALID: %',v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'record_supplier_invoice_reconciliation_v3(jsonb,jsonb,jsonb,text)',
    'reverse_supplier_invoice_v1(uuid,bigint,text,text)',
    'command_supplier_payment_v2(text,uuid,bigint,text,text)',
    'get_supplier_finance_control_v1(text,text,timestamp with time zone)'
  ] loop
    if to_regprocedure('app_private.'||v_name) is null
       or not (select prosecdef from pg_proc where oid=to_regprocedure('app_private.'||v_name))
       or has_function_privilege('anon','app_private.'||v_name,'execute')
       or not has_function_privilege('authenticated','app_private.'||v_name,'execute') then
      raise exception 'G7_PRIVATE_OWNER_INVALID: %',v_name;
    end if;
  end loop;

  if has_table_privilege('authenticated','public.supplier_invoices','insert,update,delete')
     or has_table_privilege('authenticated','public.supplier_invoice_payable_links','insert,update,delete')
     or has_table_privilege('authenticated','public.supplier_invoice_receipt_allocations','insert,update,delete')
     or has_table_privilege('authenticated','public.supplier_payment_batches','insert,update,delete')
     or has_table_privilege('authenticated','public.supplier_payment_allocations','insert,update,delete') then
    raise exception 'G7_DIRECT_MUTATION_GRANT_PRESENT';
  end if;

  if has_table_privilege('anon','public.supplier_invoice_payable_balances','select')
     or has_table_privilege('anon','public.supplier_invoice_receipt_balances','select') then
    raise exception 'G7_ANON_FINANCE_VIEW_GRANT_PRESENT';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.supplier_invoice_receipt_allocations'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.finance_accounting_period_locks'::regclass)
     or not (select coalesce(reloptions,'{}'::text[]) @> array['security_invoker=true'] from pg_class where oid='public.supplier_invoice_payable_balances'::regclass)
     or not (select coalesce(reloptions,'{}'::text[]) @> array['security_invoker=true'] from pg_class where oid='public.supplier_invoice_receipt_balances'::regclass) then
    raise exception 'G7_RLS_OR_VIEW_SECURITY_INVALID';
  end if;
end;
$$;

rollback;

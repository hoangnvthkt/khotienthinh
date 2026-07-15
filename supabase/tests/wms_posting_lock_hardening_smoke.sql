-- A3.3 rollback-only persona/catalog smoke. Run on disposable Postgres.
begin;

do $$ begin
  if has_function_privilege('anon', 'public.create_purchase_order_supplier_return(text,text,jsonb,text,text)', 'EXECUTE') then
    raise exception 'anon must not execute supplier-return wrapper';
  end if;
  if has_function_privilege('anon', 'app_private.lock_wms_business_transaction_items(text,text,text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.lock_wms_business_transaction_items(text,text,text[])', 'EXECUTE') then
    raise exception 'client personas must not execute lock helper';
  end if;
  if has_function_privilege('authenticated', 'app_private.create_purchase_order_supplier_return_a3_core(text,text,jsonb,text,text)', 'EXECUTE') then
    raise exception 'private supplier-return core must remain revoked';
  end if;
end $$;

select p.oid::regprocedure, p.prosecdef, p.proconfig, p.proacl
from pg_proc p
where p.oid in (
  to_regprocedure('public.create_purchase_order_supplier_return(text,text,jsonb,text,text)'),
  to_regprocedure('public.process_transaction_status(text,public.transaction_status,uuid)'),
  to_regprocedure('app_private.lock_wms_business_transaction_items(text,text,text[])')
);

select tgname, tgenabled from pg_trigger
where tgrelid in ('public.transactions'::regclass, 'public.items'::regclass);

-- No writes are permitted by this smoke; production rows remain unchanged.
rollback;

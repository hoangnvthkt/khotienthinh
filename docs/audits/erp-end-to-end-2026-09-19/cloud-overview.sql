begin read only;
set local statement_timeout = '25s';
select jsonb_build_object(
 'read_at',now(),
 'latest_migrations',(select jsonb_agg(s) from (select version from supabase_migrations.schema_migrations order by version desc limit 5)s),
 'financial_po_relation',to_regclass('public.project_purchase_orders'),
 'scope_tables',(select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'estimated_rows',c.reltuples)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname ~ '^(project|purchase|material|inventory|supplier|site_cash|site_direct|payment|workflow|requests$|transactions$|items$|warehouses$|construction_sites$)'),
 'negative_inventory_balance',(select count(*) from public.inventory_balances where on_hand_qty<0),
 'zero_qty_nonzero_value',(select count(*) from public.inventory_balances where on_hand_qty=0 and abs(total_value)>0.01),
 'positive_qty_negative_value',(select count(*) from public.inventory_balances where on_hand_qty>0 and total_value<0),
 'po_status_counts',(select jsonb_object_agg(status,n) from (select status,count(*) n from public.purchase_orders group by status)s),
 'po_source_counts',(select jsonb_object_agg(coalesce(source_mode,'NULL'),n) from (select source_mode,count(*) n from public.purchase_orders group by source_mode)s),
 'payable_source_counts',(select jsonb_object_agg(source_type,n) from (select source_type,count(*) n from public.supplier_payable_documents where status not in ('cancelled','reversed','draft') group by source_type)s)
) as audit;
rollback;

-- PERF-02 read-only Cloud baseline. This script reports metadata and normalized
-- aggregate query statistics only; it never reads application row payloads.
\pset pager off
\set ON_ERROR_STOP on

\echo '=== PERF02_TABLE_ESTIMATES ==='
with target_tables(table_name) as (values
  ('transactions'),
  ('requests'),
  ('purchase_orders'),
  ('purchase_order_request_lines'),
  ('purchase_order_delivery_batches'),
  ('material_request_fulfillment_batches'),
  ('project_transactions'),
  ('project_tasks'),
  ('vehicle_bookings'),
  ('safety_incidents'),
  ('asset_assignments'),
  ('chat_v2_messages'),
  ('chat_v2_attachments'),
  ('workflow_instances'),
  ('workflow_subjects'),
  ('notifications'),
  ('ai_messages'),
  ('supplier_contracts'),
  ('subcontractor_contracts'),
  ('payment_certificates')
)
select c.relname as table_name,
       greatest(c.reltuples::bigint, 0) as estimated_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join target_tables t on t.table_name = c.relname
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
order by estimated_rows desc, table_name;

\echo '=== PERF02_EXISTING_INDEXES ==='
with target_tables(table_name) as (values
  ('transactions'), ('requests'), ('purchase_orders'),
  ('purchase_order_request_lines'), ('purchase_order_delivery_batches'),
  ('material_request_fulfillment_batches'), ('project_transactions'),
  ('project_tasks'), ('vehicle_bookings'), ('safety_incidents'),
  ('asset_assignments'), ('chat_v2_messages'), ('chat_v2_attachments'),
  ('workflow_instances'), ('workflow_subjects'), ('notifications'),
  ('ai_messages'), ('supplier_contracts'), ('subcontractor_contracts'),
  ('payment_certificates')
)
select i.tablename as table_name,
       i.indexname,
       pg_size_pretty(pg_relation_size(format('%I.%I', i.schemaname, i.indexname)::regclass)) as index_size,
       i.indexdef
from pg_indexes i
join target_tables t on t.table_name = i.tablename
where i.schemaname = 'public'
order by i.tablename, i.indexname;

\echo '=== PERF02_INDEX_USAGE ==='
select relname as table_name,
       indexrelname as index_name,
       idx_scan,
       idx_tup_read,
       idx_tup_fetch
from pg_stat_user_indexes
where schemaname = 'public'
  and relname in (
    'transactions', 'requests', 'purchase_orders', 'purchase_order_request_lines',
    'purchase_order_delivery_batches', 'material_request_fulfillment_batches',
    'project_transactions', 'project_tasks', 'vehicle_bookings', 'safety_incidents',
    'asset_assignments', 'chat_v2_messages', 'chat_v2_attachments',
    'workflow_instances', 'workflow_subjects', 'notifications', 'ai_messages',
    'supplier_contracts', 'subcontractor_contracts', 'payment_certificates'
  )
order by relname, idx_scan desc, indexrelname;

\echo '=== PERF02_NORMALIZED_QUERY_STATS ==='
select queryid,
       calls,
       round(total_exec_time::numeric, 2) as total_exec_ms,
       round(mean_exec_time::numeric, 2) as mean_exec_ms,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 400) as normalized_query_shape
from pg_stat_statements
where dbid = (select oid from pg_database where datname = current_database())
  and query ~* '^\s*(select|with)\M'
  and query ~* '(transactions|requests|purchase_orders|project_tasks|vehicle_bookings|safety_incidents|asset_assignments|chat_v2_messages|workflow_instances|notifications|ai_messages|payment_certificates)'
order by total_exec_time desc
limit 50;

\echo '=== PERF02_DUPLICATE_OR_UNUSED_INDEX_CANDIDATES ==='
select schemaname,
       relname as table_name,
       indexrelname as index_name,
       idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
where schemaname = 'public'
  and idx_scan = 0
  and indexrelname not like '%_pkey'
order by pg_relation_size(indexrelid) desc
limit 50;

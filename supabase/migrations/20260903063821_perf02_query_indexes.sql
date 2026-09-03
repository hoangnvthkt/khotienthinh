-- PERF-02 keyset pagination indexes. These are additive and created
-- concurrently so normal writes can continue while each index is built.

create index concurrently if not exists idx_transactions_source_wh_date_id_perf02
  on public.transactions (source_warehouse_id, date desc, id desc)
  where source_warehouse_id is not null;

create index concurrently if not exists idx_transactions_target_wh_date_id_perf02
  on public.transactions (target_warehouse_id, date desc, id desc)
  where target_warehouse_id is not null;

create index concurrently if not exists idx_requests_origin_created_id_perf02
  on public.requests (request_origin, created_date desc, id desc)
  where request_origin is not null;

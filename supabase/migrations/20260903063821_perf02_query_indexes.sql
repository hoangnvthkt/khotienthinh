-- PERF-02 keyset pagination indexes for an empty migration-built database.
-- The production deployment of this version used standalone concurrent index
-- operations and is already recorded in migration history. Never replay this
-- transactional form against populated warehouse/request tables: ordinary
-- CREATE INDEX would block writes. Use the standalone recovery runbook instead.
do $$
begin
  if exists (select 1 from public.transactions limit 1)
    or exists (select 1 from public.requests limit 1) then
    raise exception 'PERF02_NONEMPTY_DATABASE_REQUIRES_CONCURRENT_APPLY';
  end if;
end;
$$;

create index if not exists idx_transactions_source_wh_date_id_perf02
  on public.transactions (source_warehouse_id, date desc, id desc)
  where source_warehouse_id is not null;

create index if not exists idx_transactions_target_wh_date_id_perf02
  on public.transactions (target_warehouse_id, date desc, id desc)
  where target_warehouse_id is not null;

create index if not exists idx_requests_origin_created_id_perf02
  on public.requests (request_origin, created_date desc, id desc)
  where request_origin is not null;

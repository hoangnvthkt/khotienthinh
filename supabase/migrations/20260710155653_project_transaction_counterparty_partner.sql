alter table if exists public.project_transactions
  add column if not exists counterparty_partner_id text references public.business_partners(id) on delete set null;

create index if not exists idx_project_transactions_counterparty_partner_id
  on public.project_transactions(counterparty_partner_id);

grant select, insert, update, delete on table public.project_transactions to authenticated;

notify pgrst, 'reload schema';

alter table if exists public.project_transactions
  add column if not exists contract_cost_item_id uuid references public.contract_cost_items(id) on delete set null,
  add column if not exists contract_cost_item_symbol_snapshot text,
  add column if not exists contract_cost_item_name_snapshot text,
  add column if not exists cost_classification_status text not null default 'unclassified',
  add column if not exists counterparty_name text,
  add column if not exists invoice_no text,
  add column if not exists invoice_date date;

do $$
begin
  alter table public.project_transactions
    drop constraint if exists project_transactions_cost_classification_status_check;

  alter table public.project_transactions
    add constraint project_transactions_cost_classification_status_check
    check (cost_classification_status in ('manual', 'auto', 'unclassified'));
exception
  when undefined_table then null;
end $$;

create index if not exists idx_project_transactions_contract_cost_item_id
  on public.project_transactions(contract_cost_item_id);

create index if not exists idx_project_transactions_classification_status
  on public.project_transactions(cost_classification_status);

grant select, insert, update, delete on table public.project_transactions to authenticated;

notify pgrst, 'reload schema';

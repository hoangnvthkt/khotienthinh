-- Add optional explicit category column to contract_cost_items
alter table public.contract_cost_items
  add column if not exists category text;

comment on column public.contract_cost_items.category is 'Explicit cost category mapping (materials, labor, machinery, subcontract, overhead, other)';

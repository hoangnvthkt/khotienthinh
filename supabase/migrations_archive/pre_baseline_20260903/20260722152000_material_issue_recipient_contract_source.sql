alter table public.material_issue_orders
  add column if not exists recipient_source_type text
    check (recipient_source_type is null or recipient_source_type in ('supplier_contract', 'business_partner')),
  add column if not exists recipient_source_id text;

create index if not exists idx_material_issue_orders_recipient_source
  on public.material_issue_orders(recipient_source_type, recipient_source_id)
  where recipient_source_type is not null and recipient_source_id is not null;

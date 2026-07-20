alter table if exists public.purchase_orders
  add column if not exists vat_rate numeric not null default 0
    check (vat_rate >= 0 and vat_rate <= 100);

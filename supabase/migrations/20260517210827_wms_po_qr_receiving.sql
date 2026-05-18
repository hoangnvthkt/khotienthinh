-- Add QR receiving metadata for project purchase orders used by WMS receiving.

do $$
begin
  if to_regclass('public.purchase_orders') is not null then
    alter table public.purchase_orders
      add column if not exists qr_token text,
      add column if not exists target_warehouse_id text,
      add column if not exists received_transaction_ids jsonb not null default '[]'::jsonb;

    update public.purchase_orders
    set received_transaction_ids = '[]'::jsonb
    where received_transaction_ids is null;

    create unique index if not exists idx_purchase_orders_qr_token_unique
      on public.purchase_orders (qr_token)
      where qr_token is not null;

    create index if not exists idx_purchase_orders_target_warehouse_id
      on public.purchase_orders (target_warehouse_id)
      where target_warehouse_id is not null;
  end if;
end $$;

notify pgrst, 'reload schema';

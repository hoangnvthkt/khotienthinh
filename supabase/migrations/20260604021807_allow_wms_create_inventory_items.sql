-- The inventory page creates a catalog item before submitting its initial-stock
-- transaction. Keep insert access aligned with the UI, but require keepers to
-- create the item with empty stock so inventory still changes through approval.

drop policy if exists items_write on public.items;

grant select, insert on table public.items to authenticated;

create policy items_write
  on public.items
  for insert
  to authenticated
  with check (
    public.is_module_admin('WMS')
    or (
      coalesce(stock_by_warehouse, '{}'::jsonb) = '{}'::jsonb
      and exists (
        select 1
        from public.users u
        where u.id = public.current_app_user_id()
          and coalesce(u.is_active, true)
          and u.role::text = 'WAREHOUSE_KEEPER'
      )
    )
  );

notify pgrst, 'reload schema';

-- Avoid evaluating WMS catalog permission helpers once per catalog row.
-- The select policies do not depend on item/warehouse row values, so wrapping
-- the checks in scalar selects lets Postgres run them as initplans.

drop policy if exists items_phase4_select on public.items;
create policy items_phase4_select
on public.items
for select
to authenticated
using (
  (select public.is_module_admin('WMS'))
  or (select app_private.wms_has_action('wms.inventory.view'))
  or (select app_private.wms_has_action('wms.inventory.edit'))
  or (select app_private.wms_has_action('wms.master_data.manage'))
);

drop policy if exists warehouses_phase4_select on public.warehouses;
create policy warehouses_phase4_select
on public.warehouses
for select
to authenticated
using (
  (select public.is_module_admin('WMS'))
  or (select app_private.wms_has_action('wms.inventory.view'))
  or (select app_private.wms_has_action('wms.master_data.manage'))
);

notify pgrst, 'reload schema';

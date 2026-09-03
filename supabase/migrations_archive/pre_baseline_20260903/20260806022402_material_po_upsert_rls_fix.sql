-- Keep parent PO visibility Room-authoritative while allowing INSERT ... ON
-- CONFLICT to evaluate the candidate row before its id is queryable.
drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select
  on public.purchase_orders
  for select
  to authenticated
  using (
    archived_at is null
    and (
      (
        source_mode = 'company_consolidated'
        and (
          app_private.company_procurement_can_manage()
          or app_private.company_purchase_order_can_view_from_links(id)
        )
      )
      or (
        source_mode is distinct from 'company_consolidated'
        and (
          app_private.current_actor_has_effective_room_action(
            project_id, construction_site_id, 'material_po', 'view'
          )
          or app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
        )
      )
    )
  );

notify pgrst, 'reload schema';

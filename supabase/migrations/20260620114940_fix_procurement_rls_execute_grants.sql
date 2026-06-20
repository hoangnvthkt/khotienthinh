-- Fix company procurement RLS helper execution.
--
-- The helper functions are intentionally stored in app_private, but RLS
-- policies still execute them as the authenticated caller. They therefore need
-- EXECUTE granted to authenticated, otherwise PostgREST requests fail with:
-- "permission denied for function company_procurement_can_manage".

grant execute on function app_private.company_procurement_can_manage() to authenticated;
grant execute on function app_private.company_purchase_order_can_view_from_links(text) to authenticated;
grant execute on function app_private.purchase_order_link_can_access(text, text, text) to authenticated;
grant execute on function app_private.purchase_order_delivery_group_can_access(text, text) to authenticated;
grant execute on function app_private.material_request_fulfillment_can_view(text) to authenticated;
grant execute on function app_private.material_request_fulfillment_can_mutate(text) to authenticated;

-- The schedule tables came from the project PO flow. Company procurement also
-- reads/creates delivery batches, so its module admin/global procurement
-- permission must be accepted here as well.
create or replace function app_private.purchase_order_delivery_can_view(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.company_procurement_can_manage()
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          or app_private.project_doc_can_view(
            po.project_id::text,
            po.construction_site_id::text,
            po.submitted_to_user_id
          )
        )
    );
$$;

create or replace function app_private.purchase_order_delivery_can_mutate(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.company_procurement_can_manage()
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          or app_private.project_doc_can_view(
            po.project_id::text,
            po.construction_site_id::text,
            po.submitted_to_user_id
          )
        )
    );
$$;

grant execute on function app_private.purchase_order_delivery_can_view(text) to authenticated;
grant execute on function app_private.purchase_order_delivery_can_mutate(text) to authenticated;

notify pgrst, 'reload schema';

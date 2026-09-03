-- PO delivery/receipt desktop queue support.
-- When a PO is marked in_transit, the app creates a pending IMPORT
-- transaction and an issued po_receipt fulfillment batch so the destination
-- warehouse keeper can approve SL/CL and then confirm receipt on desktop.

create schema if not exists app_private;

create or replace function app_private.transaction_can_insert(
  p_type text,
  p_requester_id uuid,
  p_approver_id uuid,
  p_source_warehouse_id text,
  p_target_warehouse_id text,
  p_related_request_id text,
  p_items jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or exists (
      select 1
      from public.users u
      where u.id = public.current_app_user_id()
        and coalesce(u.is_active, true)
        and u.role::text = 'WAREHOUSE_KEEPER'
        and (
          u.assigned_warehouse_id is null
          or u.assigned_warehouse_id is not distinct from p_source_warehouse_id
          or u.assigned_warehouse_id is not distinct from p_target_warehouse_id
        )
    )
    or exists (
      select 1
      from public.requests r
      where r.id = p_related_request_id
        and coalesce(r.request_origin, 'wms') = 'project'
        and r.status::text in ('APPROVED', 'IN_TRANSIT')
        and (
          r.submitted_to_user_id = public.current_app_user_id()::text
          or app_private.project_request_can_write(r.project_id)
        )
        and exists (
          select 1
          from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
          where coalesce(item->>'materialRequestId', item->>'material_request_id') = r.id
        )
    );
$$;

revoke all on function app_private.transaction_can_insert(text, uuid, uuid, text, text, text, jsonb) from public;
grant execute on function app_private.transaction_can_insert(text, uuid, uuid, text, text, text, jsonb) to authenticated;

create or replace function app_private.material_request_fulfillment_can_mutate(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or exists (
      select 1
      from public.requests r
      where r.id = p_request_id
        and (
          (
            r.submitted_to_user_id is not null
            and r.submitted_to_user_id = public.current_app_user_id()::text
          )
          or app_private.project_request_can_write(r.project_id)
          or app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(r.source_warehouse_id)
          or app_private.current_user_is_wms_keeper_for(r.site_warehouse_id)
        )
    );
$$;

revoke all on function app_private.material_request_fulfillment_can_mutate(text) from public;
grant execute on function app_private.material_request_fulfillment_can_mutate(text) to authenticated;

drop policy if exists purchase_orders_select on public.purchase_orders;
drop policy if exists purchase_orders_update on public.purchase_orders;

create policy purchase_orders_select
  on public.purchase_orders
  for select
  to authenticated
  using (
    app_private.project_doc_can_view(project_id, construction_site_id, submitted_to_user_id)
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
  );

create policy purchase_orders_update
  on public.purchase_orders
  for update
  to authenticated
  using (
    app_private.project_po_can_update(project_id, construction_site_id, status, submitted_to_user_id)
    or (
      status in ('in_transit', 'partial')
      and (
        app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
      )
    )
  )
  with check (
    (
      project_id is not null
      or construction_site_id is not null
      or public.is_admin()
    )
    and (
      app_private.project_po_can_update(project_id, construction_site_id, status, submitted_to_user_id)
      or app_private.current_user_is_global_wms_keeper()
      or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
    )
  );

notify pgrst, 'reload schema';

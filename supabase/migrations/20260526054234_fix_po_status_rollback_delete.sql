-- Align PO workflow statuses with the application and keep PO-specific RLS
-- separate from the generic project document guards.

alter table if exists public.purchase_orders
  drop constraint if exists purchase_orders_status_check;

alter table if exists public.purchase_orders
  add constraint purchase_orders_status_check
  check (status in ('draft', 'sent', 'confirmed', 'in_transit', 'partial', 'delivered', 'closed', 'returned', 'cancelled'));

create or replace function app_private.project_po_can_update(
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_submitted_to_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (
      coalesce(p_status, 'draft') = 'draft'
      and (
        app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit')
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'submit')
      )
    )
    or (
      coalesce(p_status, 'draft') in ('sent', 'confirmed', 'in_transit', 'partial', 'delivered', 'closed', 'returned', 'cancelled')
      and (
        app_private.project_doc_is_current_handler(p_submitted_to_user_id)
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'approve')
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'confirm')
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit')
      )
    );
$$;

create or replace function app_private.project_po_can_delete(
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_ever_submitted boolean,
  p_received_transaction_ids jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
      (
        coalesce(p_status, 'draft') = 'draft'
        and not coalesce(p_ever_submitted, false)
      )
      or (
        coalesce(p_status, 'draft') = 'cancelled'
        and jsonb_array_length(coalesce(p_received_transaction_ids, '[]'::jsonb)) = 0
      )
      or coalesce(p_status, 'draft') = 'returned'
    )
    and (
      public.is_admin()
      or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'delete')
    );
$$;

drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update
  on public.purchase_orders
  for update
  to authenticated
  using (
    app_private.project_po_can_update(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_delete
  on public.purchase_orders
  for delete
  to authenticated
  using (
    app_private.project_po_can_delete(
      project_id::text,
      construction_site_id::text,
      status::text,
      ever_submitted,
      received_transaction_ids
    )
  );

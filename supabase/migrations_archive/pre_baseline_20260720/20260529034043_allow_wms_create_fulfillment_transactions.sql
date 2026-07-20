-- Allow WMS/material-department users to create stock transactions for
-- project fulfillment batches. The previous insert policy only allowed
-- ADMIN, which blocked assigned project material handlers from creating
-- the fulfillment transaction before batch rows are inserted.

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
        and r.submitted_to_user_id = public.current_app_user_id()::text
        and r.status::text in ('APPROVED', 'IN_TRANSIT')
        and exists (
          select 1
          from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
          where coalesce(item->>'materialRequestId', item->>'material_request_id') = r.id
        )
    );
$$;

revoke all on function app_private.transaction_can_insert(text, uuid, uuid, text, text, text, jsonb) from public;
grant execute on function app_private.transaction_can_insert(text, uuid, uuid, text, text, text, jsonb) to authenticated;

drop policy if exists transactions_write on public.transactions;

create policy transactions_write
  on public.transactions
  for insert
  to authenticated
  with check (
    app_private.transaction_can_insert(
      type::text,
      requester_id,
      approver_id,
      source_warehouse_id,
      target_warehouse_id,
      related_request_id,
      items
    )
  );

notify pgrst, 'reload schema';

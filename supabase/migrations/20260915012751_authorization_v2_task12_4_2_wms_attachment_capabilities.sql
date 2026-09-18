-- Separate WMS attachment reads from mutations while preserving all existing
-- admin, legacy module-admin, keeper and requester compatibility paths.
create or replace function app_private.wms_transaction_attachment_can_read(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.transactions tx
      where tx.id = split_part(p_object_name, '/', 1)
        and (
          app_private.current_user_is_wms_keeper_for(tx.target_warehouse_id)
          or app_private.current_user_is_wms_keeper_for(tx.source_warehouse_id)
          or tx.requester_id = public.current_app_user_id()
          or app_private.wms_has_action(
            'wms.transaction.view',
            tx.source_warehouse_id,
            tx.target_warehouse_id,
            tx.requester_id,
            tx.approver_id
          )
        )
    ),
    false
  );
$$;

create or replace function app_private.wms_transaction_attachment_can_mutate(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.transactions tx
      where tx.id = split_part(p_object_name, '/', 1)
        and (
          app_private.current_user_is_wms_keeper_for(tx.target_warehouse_id)
          or app_private.current_user_is_wms_keeper_for(tx.source_warehouse_id)
          or tx.requester_id = public.current_app_user_id()
          or app_private.wms_has_action(
            'wms.transaction.approve',
            tx.source_warehouse_id,
            tx.target_warehouse_id,
            tx.requester_id,
            tx.approver_id
          )
        )
    ),
    false
  );
$$;

revoke all on function app_private.wms_transaction_attachment_can_read(text)
  from public, anon, authenticated;
revoke all on function app_private.wms_transaction_attachment_can_mutate(text)
  from public, anon, authenticated;
grant execute on function app_private.wms_transaction_attachment_can_read(text)
  to authenticated;
grant execute on function app_private.wms_transaction_attachment_can_mutate(text)
  to authenticated;

drop policy if exists wms_transaction_attachments_select on storage.objects;
create policy wms_transaction_attachments_select
  on storage.objects
  as permissive
  for select
  to authenticated
  using (
    bucket_id = 'wms-transaction-attachments'
    and split_part(name, '/', 1) <> ''
    and app_private.wms_transaction_attachment_can_read(name)
  );

drop policy if exists wms_transaction_attachments_insert on storage.objects;
create policy wms_transaction_attachments_insert
  on storage.objects
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'wms-transaction-attachments'
    and split_part(name, '/', 1) <> ''
    and app_private.wms_transaction_attachment_can_mutate(name)
  );

drop policy if exists wms_transaction_attachments_delete on storage.objects;
create policy wms_transaction_attachments_delete
  on storage.objects
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'wms-transaction-attachments'
    and split_part(name, '/', 1) <> ''
    and app_private.wms_transaction_attachment_can_mutate(name)
  );

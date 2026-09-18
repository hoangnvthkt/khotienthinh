-- Keep the legacy attachment decision in its existing compatibility helper.
-- The split helpers add only their canonical capability and do not duplicate
-- direct legacy-column dependencies that Task 13 must later remove.
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
    app_private.wms_transaction_attachment_can_access(p_object_name)
    or exists (
      select 1
      from public.transactions tx
      where tx.id = split_part(p_object_name, '/', 1)
        and app_private.wms_has_action(
          'wms.transaction.view',
          tx.source_warehouse_id,
          tx.target_warehouse_id,
          tx.requester_id,
          tx.approver_id
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
    app_private.wms_transaction_attachment_can_access(p_object_name)
    or exists (
      select 1
      from public.transactions tx
      where tx.id = split_part(p_object_name, '/', 1)
        and app_private.wms_has_action(
          'wms.transaction.approve',
          tx.source_warehouse_id,
          tx.target_warehouse_id,
          tx.requester_id,
          tx.approver_id
        )
    ),
    false
  );
$$;

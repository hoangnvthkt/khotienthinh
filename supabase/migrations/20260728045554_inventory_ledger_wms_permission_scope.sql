create or replace function app_private.can_read_inventory_scope(
  p_warehouse_id text,
  p_created_by uuid,
  p_approved_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_created_by = public.current_app_user_id()
    or p_approved_by = public.current_app_user_id()
    or app_private.wms_has_action(
      'wms.transaction.view',
      p_warehouse_id,
      null,
      p_created_by,
      p_approved_by
    );
$$;

revoke all on function app_private.can_read_inventory_scope(text, uuid, uuid) from public;
revoke all on function app_private.can_read_inventory_scope(text, uuid, uuid) from anon;
grant execute on function app_private.can_read_inventory_scope(text, uuid, uuid) to authenticated;

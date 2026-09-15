-- Huy duyet is explicitly canonical-only. It must not inherit ADMIN,
-- legacy WMS module-admin or warehouse-keeper fallbacks.
create or replace function app_private.wms_has_action(
  p_permission_code text,
  p_source_warehouse_id text default null,
  p_target_warehouse_id text default null,
  p_requester_id uuid default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_user_id is not null and exists (
    select 1 from public.permission_actions action_row
    where action_row.permission_code = p_permission_code
      and action_row.permission_code like 'wms.%'
      and action_row.is_active
  ) then coalesce((
    app_private.has_permission(p_user_id, p_permission_code, 'global', '*')
    or (
      p_source_warehouse_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'warehouse', p_source_warehouse_id)
    )
    or (
      p_target_warehouse_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'warehouse', p_target_warehouse_id)
    )
    or (
      p_requester_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'own', p_user_id::text)
    )
    or (
      p_assigned_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'assigned', p_user_id::text)
    )
    or (
      p_permission_code <> 'wms.transaction.reverse'
      and (
        public.is_module_admin('WMS')
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
        or app_private.current_user_is_wms_keeper_for(p_target_warehouse_id)
      )
    )
  ), false) else false end;
$$;

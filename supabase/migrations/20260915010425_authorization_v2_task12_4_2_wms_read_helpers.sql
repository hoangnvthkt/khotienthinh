-- Connect canonical scoped WMS read capabilities to resource-level helpers.
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
    app_private.wms_has_action(
      'wms.inventory.view', p_warehouse_id, null, p_created_by, p_approved_by
    )
    or p_created_by = public.current_app_user_id()
    or p_approved_by = public.current_app_user_id()
    or exists (
      select 1
      from public.users u
      where u.id = public.current_app_user_id()
        and coalesce(u.is_active, true)
        and u.role::text = 'WAREHOUSE_KEEPER'
        and (
          u.assigned_warehouse_id is null
          or u.assigned_warehouse_id is not distinct from p_warehouse_id
        )
    );
$$;

create or replace function app_private.material_issue_can_view(
  p_project_id text,
  p_construction_site_id text,
  p_source_warehouse_id text,
  p_created_by uuid,
  p_responsible_user_id uuid,
  p_recipient_type text,
  p_recipient_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or app_private.wms_has_action(
      'wms.transaction.view', p_source_warehouse_id, null,
      p_created_by, p_responsible_user_id
    )
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
    or p_created_by = public.current_app_user_id()
    or p_responsible_user_id = public.current_app_user_id()
    or (p_recipient_type = 'employee' and p_recipient_id = public.current_app_user_id()::text)
    or app_private.project_doc_can_view(p_project_id, p_construction_site_id, p_responsible_user_id::text);
$$;

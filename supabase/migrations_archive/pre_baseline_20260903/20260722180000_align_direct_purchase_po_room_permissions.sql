-- Mua nóng/CCDC is part of the purchasing lifecycle. A PO manager or a
-- member of the PO Room must receive the matching direct-purchase action
-- across the UI, RPC and RLS permission checks.
-- The write RPC also maintains this timestamp on conflict, so legacy
-- deployments need the column before any direct-purchase line can be saved.
alter table public.site_direct_purchase_lines
  add column if not exists updated_at timestamptz not null default now();

create or replace function app_private.project_has_permission_v2(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'project.%'
  and (
    exists (
      select 1
      from public.users u
      where u.id = p_user_id
        and coalesce(u.is_active, true)
        and u.role = 'ADMIN'
    )
    or exists (
      select 1
      from public.users u
      join public.user_permission_grants g on g.user_id = u.id
      where u.id = p_user_id
        and coalesce(u.is_active, true)
        and g.permission_code = p_permission_code
        and coalesce(g.is_active, false)
        and (g.expires_at is null or g.expires_at > now())
        and (
          g.scope_type = 'global'
          or (g.scope_type = 'project' and (g.scope_id = '*' or g.scope_id = p_project_id))
          or (
            p_construction_site_id is not null
            and g.scope_type = 'construction_site'
            and (g.scope_id = '*' or g.scope_id = p_construction_site_id)
          )
        )
    )
    or (
      p_permission_code like 'project.material_direct_purchase.%'
      and (
        app_private.project_has_permission_v2(
          p_project_id,
          p_construction_site_id,
          'project.material_po.manage',
          p_user_id
        )
        or (
          p_permission_code = 'project.material_direct_purchase.view'
          and app_private.project_user_has_room_action(
            p_user_id, p_project_id, p_construction_site_id, 'material_po', 'view'
          )
        )
        or (
          p_permission_code = 'project.material_direct_purchase.create'
          and app_private.project_user_has_room_action(
            p_user_id, p_project_id, p_construction_site_id, 'material_po', 'submit'
          )
        )
        or (
          p_permission_code = 'project.material_direct_purchase.edit'
          and app_private.project_user_has_room_action(
            p_user_id, p_project_id, p_construction_site_id, 'material_po', 'edit'
          )
        )
        or (
          p_permission_code = 'project.material_direct_purchase.delete'
          and app_private.project_user_has_room_action(
            p_user_id, p_project_id, p_construction_site_id, 'material_po', 'delete'
          )
        )
        or (
          p_permission_code = 'project.material_direct_purchase.record_ap'
          and app_private.project_user_has_room_action(
            p_user_id, p_project_id, p_construction_site_id, 'material_po', 'confirm'
          )
        )
      )
    )
  );
$$;

revoke all on function app_private.project_has_permission_v2(text, text, text, uuid) from public, anon;
grant execute on function app_private.project_has_permission_v2(text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';

-- Phase 3.3 Material namespace hotfix.
-- Custom Material permissions live under project.custom_material.*, not project.material*.

create or replace function app_private.material_has_action(
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
  select (
      p_permission_code like 'project.material%'
      or p_permission_code like 'project.custom_material.%'
    )
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or app_private.project_has_permission_v2(
        p_project_id,
        p_construction_site_id,
        p_permission_code,
        p_user_id
      )
    );
$$;

revoke all on function app_private.material_has_action(text, text, text, uuid) from public;
revoke all on function app_private.material_has_action(text, text, text, uuid) from anon;
grant execute on function app_private.material_has_action(text, text, text, uuid) to authenticated;

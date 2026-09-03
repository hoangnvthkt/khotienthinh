-- Phase: only system admins may mutate the project organization.
-- Existing assignment RPCs call this helper, so replacing it closes every
-- assignment, end-date and removal path without reopening direct table writes.

create or replace function app_private.can_manage_project_staff_assignment(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and coalesce(u.is_active, true)
      and u.role = 'ADMIN'
  );
$$;

revoke all on function app_private.can_manage_project_staff_assignment(text, text) from public, anon;
grant execute on function app_private.can_manage_project_staff_assignment(text, text) to authenticated;

notify pgrst, 'reload schema';

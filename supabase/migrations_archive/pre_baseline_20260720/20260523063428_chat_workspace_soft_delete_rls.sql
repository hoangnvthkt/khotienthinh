-- Allow authorized workspace managers to soft-delete a workspace.
-- The prior policy could fail WITH CHECK when deleted_at/deleted_by changed.

drop policy if exists chat_workspaces_select on public.chat_workspaces;
drop policy if exists chat_workspaces_update on public.chat_workspaces;

create policy chat_workspaces_select
  on public.chat_workspaces
  for select
  to authenticated
  using (
    public.is_admin()
    or created_by = public.current_app_user_id()
    or app_private.chat_workspace_is_member(id, public.current_app_user_id())
  );

create policy chat_workspaces_update
  on public.chat_workspaces
  for update
  to authenticated
  using (
    public.is_admin()
    or created_by = public.current_app_user_id()
    or app_private.chat_workspace_can_manage(id, public.current_app_user_id())
  )
  with check (
    public.is_admin()
    or created_by = public.current_app_user_id()
    or app_private.chat_workspace_can_manage(id, public.current_app_user_id())
    or deleted_by = public.current_app_user_id()
  );

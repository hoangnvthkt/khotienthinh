-- Fix recursive RLS on chat workspace memberships.
-- Policies must not query chat_workspace_members directly from a policy
-- on the same table, so membership checks go through security definer helpers.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create or replace function app_private.chat_workspace_is_member(
  p_workspace_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_user_id is not null, false)
    and exists (
      select 1
      from public.chat_workspace_members cwm
      where cwm.workspace_id = p_workspace_id
        and cwm.user_id = p_user_id
        and cwm.left_at is null
    );
$$;

create or replace function app_private.chat_workspace_can_manage(
  p_workspace_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_user_id is not null, false)
    and (
      exists (
        select 1
        from public.chat_workspaces cw
        where cw.id = p_workspace_id
          and cw.created_by = p_user_id
          and cw.deleted_at is null
      )
      or exists (
        select 1
        from public.chat_workspace_members cwm
        where cwm.workspace_id = p_workspace_id
          and cwm.user_id = p_user_id
          and cwm.role in ('owner', 'admin')
          and cwm.left_at is null
      )
    );
$$;

revoke all on function app_private.chat_workspace_is_member(uuid, uuid) from public;
revoke all on function app_private.chat_workspace_can_manage(uuid, uuid) from public;
grant execute on function app_private.chat_workspace_is_member(uuid, uuid) to authenticated;
grant execute on function app_private.chat_workspace_can_manage(uuid, uuid) to authenticated;

drop policy if exists chat_workspaces_select on public.chat_workspaces;
drop policy if exists chat_workspaces_update on public.chat_workspaces;
drop policy if exists chat_workspaces_delete on public.chat_workspaces;
drop policy if exists chat_workspace_members_select on public.chat_workspace_members;
drop policy if exists chat_workspace_members_insert on public.chat_workspace_members;
drop policy if exists chat_workspace_members_update on public.chat_workspace_members;
drop policy if exists chat_workspace_members_delete on public.chat_workspace_members;

create policy chat_workspaces_select
  on public.chat_workspaces
  for select
  to authenticated
  using (
    deleted_at is null
    and (
      public.is_admin()
      or created_by = public.current_app_user_id()
      or app_private.chat_workspace_is_member(id, public.current_app_user_id())
    )
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
  );

create policy chat_workspaces_delete
  on public.chat_workspaces
  for delete
  to authenticated
  using (
    public.is_admin()
    or created_by = public.current_app_user_id()
  );

create policy chat_workspace_members_select
  on public.chat_workspace_members
  for select
  to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or app_private.chat_workspace_is_member(workspace_id, public.current_app_user_id())
  );

create policy chat_workspace_members_insert
  on public.chat_workspace_members
  for insert
  to authenticated
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or app_private.chat_workspace_can_manage(workspace_id, public.current_app_user_id())
  );

create policy chat_workspace_members_update
  on public.chat_workspace_members
  for update
  to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or app_private.chat_workspace_can_manage(workspace_id, public.current_app_user_id())
  )
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or app_private.chat_workspace_can_manage(workspace_id, public.current_app_user_id())
  );

create policy chat_workspace_members_delete
  on public.chat_workspace_members
  for delete
  to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or app_private.chat_workspace_can_manage(workspace_id, public.current_app_user_id())
  );

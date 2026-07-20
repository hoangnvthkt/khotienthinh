-- Allow project staff with edit/delete permission to manage material BOQ lines.
-- Previously material_budget_items write policies only allowed public.is_admin(),
-- so project users with UI access and project PBAC edit permission were blocked
-- by RLS when saving BOQ vat tu.

alter table public.material_budget_items enable row level security;

drop policy if exists mat_budget_select on public.material_budget_items;
drop policy if exists mat_budget_write on public.material_budget_items;
drop policy if exists mat_budget_update on public.material_budget_items;
drop policy if exists mat_budget_delete on public.material_budget_items;
drop policy if exists material_budget_items_select on public.material_budget_items;
drop policy if exists material_budget_items_insert on public.material_budget_items;
drop policy if exists material_budget_items_update on public.material_budget_items;
drop policy if exists material_budget_items_delete on public.material_budget_items;

revoke all on table public.material_budget_items from anon;
revoke all on table public.material_budget_items from public;
revoke all on table public.material_budget_items from authenticated;
grant select, insert, update, delete on table public.material_budget_items to authenticated;

create policy material_budget_items_select
  on public.material_budget_items
  for select
  to authenticated
  using (true);

create policy material_budget_items_insert
  on public.material_budget_items
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  );

create policy material_budget_items_update
  on public.material_budget_items
  for update
  to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  )
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  );

create policy material_budget_items_delete
  on public.material_budget_items
  for delete
  to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'delete')
  );

notify pgrst, 'reload schema';

-- P2: the last two tables every signed-in person could read.
--
-- project_documents (metadata of project files; the files themselves are
-- already private since P1.6):
--   read   → Admin, or project.documents view / manage in that project
--   insert → upload / manage in that project, recorded as the uploader
--   update → edit_metadata / manage
--   delete → delete / delete_all / manage, or the uploader with delete_own
--   Before: everyone read, anyone could add documents to any project, and
--   only Admin could delete (other managers' deletes silently failed).
--   uploaded_by holds a display name, so the uploader is now also kept as an
--   account id in created_by.
--
-- activities (activity feed): warehouse entries (inventory, transactions,
-- material requests) are visible to people who can view that warehouse; the
-- administrative entries (users, HR, assets, warehouses setup) only to Admins
-- and to the person who acted. Entries are already stamped with the real
-- actor (P0-B trigger activities_stamp_actor); the insert check repeats it.

alter table public.project_documents
  add column if not exists created_by uuid references public.users(id) default public.current_app_user_id();

create or replace function app_private.project_documents_can(
  p_project_id text, p_construction_site_id text, p_actions text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (p_project_id is not null and exists (
      select 1 from unnest(p_actions) action
      where app_private.project_has_permission_v2(
        p_project_id, p_construction_site_id, 'project.documents.' || action, public.current_app_user_id())
    ));
$$;
revoke all on function app_private.project_documents_can(text, text, text[]) from public, anon;
grant execute on function app_private.project_documents_can(text, text, text[]) to authenticated;

drop policy if exists proj_docs_select on public.project_documents;
drop policy if exists proj_docs_write on public.project_documents;
drop policy if exists proj_docs_update on public.project_documents;
drop policy if exists proj_docs_delete on public.project_documents;

create policy project_documents_select on public.project_documents
  for select to authenticated
  using (app_private.project_documents_can(project_id, construction_site_id, array['view', 'manage']));
create policy project_documents_insert on public.project_documents
  for insert to authenticated
  with check (created_by = public.current_app_user_id()
              and app_private.project_documents_can(project_id, construction_site_id, array['upload', 'manage']));
create policy project_documents_update on public.project_documents
  for update to authenticated
  using (app_private.project_documents_can(project_id, construction_site_id, array['edit_metadata', 'manage']))
  with check (app_private.project_documents_can(project_id, construction_site_id, array['edit_metadata', 'manage']));
create policy project_documents_delete on public.project_documents
  for delete to authenticated
  using (app_private.project_documents_can(project_id, construction_site_id, array['delete', 'delete_all', 'manage'])
         or (created_by = public.current_app_user_id()
             and app_private.project_documents_can(project_id, construction_site_id, array['delete_own'])));
revoke all on public.project_documents from anon;

-- Activity feed. Visibility is worked out once per query (Admin, WMS module
-- admin, warehouses the person may view), not per row: the per-row check
-- took minutes on 3,200 rows.
create or replace function app_private.activity_wms_scope()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select coalesce(array_agg(w.id), '{}'::text[]) ids
    from public.warehouses w
    where app_private.wms_has_action('wms.transaction.view', w.id)
       or app_private.wms_has_action('wms.inventory.view', w.id)
  )
  select jsonb_build_object(
    'all', public.is_admin() or public.is_module_admin('WMS'),
    'warehouses', to_jsonb(visible.ids),
    'any', cardinality(visible.ids) > 0 or app_private.wms_has_action('wms.inventory.view'))
  from visible;
$$;
revoke all on function app_private.activity_wms_scope() from public, anon;
grant execute on function app_private.activity_wms_scope() to authenticated;

drop policy if exists activities_select on public.activities;
drop policy if exists activities_write on public.activities;
create policy activities_select on public.activities
  for select to authenticated
  using (
    (select public.is_admin())
    or user_id = (select public.current_app_user_id())
    or (type::text in ('INVENTORY', 'TRANSACTION', 'REQUEST') and (
      ((select app_private.activity_wms_scope()) ->> 'all')::boolean
      or (warehouse_id is not null and (select app_private.activity_wms_scope()) -> 'warehouses' ? warehouse_id)
      or (warehouse_id is null and ((select app_private.activity_wms_scope()) ->> 'any')::boolean)))
  );
create policy activities_insert on public.activities
  for insert to authenticated
  with check (user_id = (select public.current_app_user_id()));
revoke all on public.activities from anon;

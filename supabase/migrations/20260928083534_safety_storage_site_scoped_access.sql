-- New objects use project/site/type/record/file. Older objects have no site in
-- their path, so resolve their site from the Safety record that still owns them.
-- Unreferenced draft uploads intentionally receive no legacy read access.
create or replace function app_private.safety_legacy_attachment_scopes(p_path text)
returns table(project_id text, construction_site_id text)
language sql stable security definer set search_path = '' as $$
  with needle as (
    select pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('storage_path', p_path)) as value
  )
  select x.project_id, x.construction_site_id from public.safety_inspections x, needle n where x.attachments @> n.value
  union
  select x.project_id, x.construction_site_id from public.safety_inspection_items x, needle n where x.photos @> n.value
  union
  select x.project_id, x.construction_site_id from public.safety_issues x, needle n
    where x.before_photos @> n.value or x.after_photos @> n.value or x.attachments @> n.value
  union
  select x.project_id, x.construction_site_id from public.safety_issue_comments x, needle n where x.attachments @> n.value
  union
  select x.project_id, x.construction_site_id from public.safety_subcontractors x, needle n where x.attachments @> n.value
  union
  select x.project_id, x.construction_site_id from public.safety_teams x, needle n where x.attachments @> n.value
  union
  select x.project_id, x.construction_site_id from public.safety_equipment x, needle n where x.attachments @> n.value
  union
  select x.project_id, x.construction_site_id from public.safety_equipment_documents x, needle n where x.attachments @> n.value;
$$;

revoke all on function app_private.safety_legacy_attachment_scopes(text) from public;
grant execute on function app_private.safety_legacy_attachment_scopes(text) to authenticated;

create or replace function app_private.safety_storage_can_access(p_path text, p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_action not in ('view', 'submit', 'edit') then false
    when pg_catalog.split_part(p_path, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and pg_catalog.split_part(p_path, '/', 3) <> ''
      and pg_catalog.split_part(p_path, '/', 4) <> ''
      and pg_catalog.split_part(p_path, '/', 5) <> ''
    then case p_action
      when 'view' then app_private.safety_can_view(
        pg_catalog.split_part(p_path, '/', 1), pg_catalog.split_part(p_path, '/', 2), null)
      when 'submit' then app_private.safety_can_submit(
        pg_catalog.split_part(p_path, '/', 1), pg_catalog.split_part(p_path, '/', 2))
      when 'edit' then app_private.safety_can_manage(
        pg_catalog.split_part(p_path, '/', 1), pg_catalog.split_part(p_path, '/', 2), null)
      else false
    end
    when p_action = 'submit' then false
    else exists (
      select 1 from app_private.safety_legacy_attachment_scopes(p_path) scope
      where scope.project_id = pg_catalog.split_part(p_path, '/', 1)
        and scope.construction_site_id is not null
        and case p_action
          when 'view' then app_private.safety_can_view(scope.project_id, scope.construction_site_id, null)
          when 'edit' then app_private.safety_can_manage(scope.project_id, scope.construction_site_id, null)
          else false
        end
    )
  end;
$$;

revoke all on function app_private.safety_storage_can_access(text, text) from public;
grant execute on function app_private.safety_storage_can_access(text, text) to authenticated;

drop policy if exists project_safety_attachments_insert on storage.objects;
create policy project_safety_attachments_insert on storage.objects for insert to authenticated
with check (bucket_id = 'project-safety-attachments'
  and app_private.safety_storage_can_access(name, 'submit'));

drop policy if exists project_safety_attachments_select on storage.objects;
create policy project_safety_attachments_select on storage.objects for select to authenticated
using (bucket_id = 'project-safety-attachments'
  and app_private.safety_storage_can_access(name, 'view'));

drop policy if exists project_safety_attachments_delete on storage.objects;
create policy project_safety_attachments_delete on storage.objects for delete to authenticated
using (bucket_id = 'project-safety-attachments'
  and app_private.safety_storage_can_access(name, 'edit'));

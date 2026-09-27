-- P1.6b: project-attachments (quality evidence, transaction and purchase
-- documents, chat files) and project-files (project documents) were public:
-- anyone holding a URL could open them. Make both private and decide reads
-- per folder. The uploader and Admins can always read. Stored rows keep
-- their old public URL; the app signs it when rendering
-- (components/storage/PrivateStorageLinkResolver).

-- Quality evidence: same path rules as quality_storage_can_mutate, but the
-- Quality Room "view" action.
create or replace function app_private.quality_storage_can_read(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with path as (
    select public.current_app_user_id() as actor_id,
      split_part(name, '/', 2) as first_scope_id,
      case when nullif(split_part(name, '/', 5), '') is null then split_part(name, '/', 2) else split_part(name, '/', 3) end as site_id,
      nullif(split_part(name, '/', 5), '') as canonical_file_name
  )
  select case
    when path.actor_id is null or nullif(path.first_scope_id, '') is null then false
    when path.canonical_file_name is not null then
      app_private.project_actor_has_effective_room_action(path.actor_id, path.first_scope_id, path.site_id, 'quality', 'view')
    else exists (
      select 1 from public.projects project_row
      where project_row.construction_site_id::text = path.site_id
        and app_private.project_actor_has_effective_room_action(path.actor_id, project_row.id, path.site_id, 'quality', 'view')
    )
  end
  from path;
$$;
revoke all on function app_private.quality_storage_can_read(text) from public, anon;
grant execute on function app_private.quality_storage_can_read(text) to authenticated;

create or replace function app_private.project_attachment_can_read(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case split_part(name, '/', 1)
    when 'quality' then app_private.quality_storage_can_read(name)
    when 'chat' then exists (
      select 1 from public.chat_members member
      where member.conversation_id::text = split_part(name, '/', 2)
        and member.user_id = public.current_app_user_id()::text and member.left_at is null
    )
    when 'site-direct-purchases' then app_private.company_procurement_can_manage() or exists (
      select 1 from public.project_staff staff
      where staff.project_id = split_part(name, '/', 2) and staff.end_date is null
        and staff.user_id = public.current_app_user_id()::text
    )
    when 'task-completions' then app_private.project_actor_has_effective_room_action(
      public.current_app_user_id(), split_part(name, '/', 2), null, 'gantt', 'view'
    )
    -- Transaction documents carry no project in the path: finance viewers of all projects.
    when 'tx' then app_private.sensitive_view_all('finance')
    else false
  end;
$$;
revoke all on function app_private.project_attachment_can_read(text) from public, anon;
grant execute on function app_private.project_attachment_can_read(text) to authenticated;

update storage.buckets set public = false where id in ('project-attachments', 'project-files');

drop policy if exists "Public read access for project-attachments" on storage.objects;
create policy project_attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-attachments'
    and (
      owner_id = (select auth.uid())::text
      or (select public.is_admin())
      or app_private.project_attachment_can_read(name)
    )
  );

-- Project documents live under <projectId>/...
drop policy if exists public_read on storage.objects;
create policy project_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-files'
    and (
      owner_id = (select auth.uid())::text
      or (select public.is_admin())
      or app_private.project_has_permission_v2(split_part(name, '/', 1), null, 'project.documents.view', public.current_app_user_id())
    )
  );

-- P1.6c: daily log photos (1,654 files, ~1.5 GB) were in a public bucket:
-- anyone holding a URL could open them, signed in or not, and every signed-in
-- person could upload anywhere in it. Make the bucket private.
-- Photos live under dailylogs/<projectId>/..., the folder DailyLogTab writes
-- to. A photo can be read (and so signed) by its uploader, an Admin, or anyone
-- who can see that project's daily logs (same rule as daily_logs:
-- app_private.daily_log_can_select). Uploads go only into the folder of a
-- project whose daily logs the person can see.
-- Stored rows keep their old public URL; PrivateStorageLinkResolver signs it
-- at display time, so the Daily log and Gantt screens need no change.

update storage.buckets set public = false where id = 'project-photos';

-- daily_log_can_select needs the project's construction site; the folder only
-- carries the project id.
create or replace function app_private.project_photo_folder_visible(p_project_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and app_private.daily_log_can_select(p.id, p.construction_site_id::text, public.current_app_user_id())
  );
$$;
revoke all on function app_private.project_photo_folder_visible(text) from public, anon;
grant execute on function app_private.project_photo_folder_visible(text) to authenticated;

drop policy if exists project_photos_select on storage.objects;
create policy project_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-photos'
    and (
      owner_id = (select auth.uid())::text
      or (select public.is_admin())
      or (split_part(name, '/', 1) = 'dailylogs'
          and app_private.project_photo_folder_visible(split_part(name, '/', 2)))
    )
  );

drop policy if exists project_photos_insert on storage.objects;
create policy project_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-photos'
    and split_part(name, '/', 1) = 'dailylogs'
    and app_private.project_photo_folder_visible(split_part(name, '/', 2))
  );

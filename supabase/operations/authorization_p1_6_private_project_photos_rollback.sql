-- Rollback for authorization_p1_6_private_project_photos: makes daily log
-- photos public again (the pre-P1.6c state). Signed URLs keep working.
begin;
update storage.buckets set public = true where id = 'project-photos';
drop policy if exists project_photos_select on storage.objects;
create policy project_photos_select on storage.objects for select using (bucket_id = 'project-photos');
drop policy if exists project_photos_insert on storage.objects;
create policy project_photos_insert on storage.objects for insert with check (bucket_id = 'project-photos');
drop function if exists app_private.project_photo_folder_visible(text);
commit;

-- Emergency rollback for P1.6b (project-attachments / project-files private).
begin;
update storage.buckets set public = true where id in ('project-attachments', 'project-files');
drop policy if exists project_attachments_read on storage.objects;
create policy "Public read access for project-attachments" on storage.objects for select using (bucket_id = 'project-attachments');
drop policy if exists project_files_read on storage.objects;
create policy public_read on storage.objects for select using (bucket_id = 'project-files');
commit;

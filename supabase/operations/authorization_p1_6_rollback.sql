-- Emergency rollback for P1.6a (check-in photos private).
begin;
update storage.buckets set public = true where id = 'checkin-photos';
drop policy if exists checkin_photos_select on storage.objects;
create policy checkin_photos_select on storage.objects for select using (bucket_id = 'checkin-photos');
commit;

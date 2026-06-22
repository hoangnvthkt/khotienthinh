-- Allow authenticated users to upload check-in selfie files to Supabase Storage.
-- The bucket is public because the app stores public URLs in hrm_attendance.

insert into storage.buckets (id, name, public)
values ('checkin-photos', 'checkin-photos', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists checkin_photos_select on storage.objects;
drop policy if exists checkin_photos_insert on storage.objects;
drop policy if exists checkin_photos_update on storage.objects;
drop policy if exists checkin_photos_delete on storage.objects;

create policy checkin_photos_select
on storage.objects
for select
to public
using (bucket_id = 'checkin-photos');

create policy checkin_photos_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'checkin-photos');

create policy checkin_photos_update
on storage.objects
for update
to authenticated
using (bucket_id = 'checkin-photos')
with check (bucket_id = 'checkin-photos');

create policy checkin_photos_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'checkin-photos');

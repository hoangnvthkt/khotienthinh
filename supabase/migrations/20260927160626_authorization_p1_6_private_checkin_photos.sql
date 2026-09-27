-- P1.6a: check-in photos (faces, taken at check-in / check-out) were in a
-- public bucket: anyone holding the URL could open them, signed in or not.
-- Make the bucket private. A photo can be read (and so signed) by the person
-- who uploaded it, an Admin, or anyone allowed to see that employee's
-- attendance (same rule as hrm_attendance). Photos live under
-- <employeeId>/..., the folder the check-in flow writes to.
-- Stored rows keep their old public URL; the app signs it at display time.

update storage.buckets set public = false where id = 'checkin-photos';

drop policy if exists checkin_photos_select on storage.objects;
create policy checkin_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'checkin-photos'
    and (
      owner_id = (select auth.uid())::text
      or (select public.is_admin())
      or split_part(name, '/', 1) in (
        select visible.employee_id::text
        from app_private.current_actor_hrm_visible_employee_ids('hrm.attendance.view') visible(employee_id)
      )
    )
  );

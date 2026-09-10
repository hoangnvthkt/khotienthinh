-- INSERT alone also authorizes sign-upload/copy/TUS/S3. A signed upload capability
-- can outlive our reservation and leave a late object after TTL cleanup. Only the
-- authenticated standard upload API is permitted; the Storage server sets operation.
-- Preserve the applied Task 7 migration and every unrelated bucket policy.
create policy work_attachment_standard_upload_only
 on storage.objects as restrictive for insert to authenticated
 with check (bucket_id<>'work-attachments' or storage.allow_only_operation('storage.object.upload'));

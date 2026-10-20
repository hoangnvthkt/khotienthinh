-- Storage (audit 20/10/2026, mục S3): khóa bucket public và đường dẫn tải lên.
--
-- Hiện trạng (Cloud 20/10):
--   * avatars (PUBLIC): không giới hạn kích thước / MIME; policy INSERT chỉ kiểm bucket → nhân viên tải được bất kỳ tệp
--     nào lên URL công khai (chứa HTML/JS/SVG lừa đảo, hoặc làm đầy dung lượng). 59 tệp hiện có đều là ảnh
--     jpeg/png ≤ 2,8 MB, đường dẫn `employees/<id>_<thời gian>.<đuôi>` (MyProfile, Settings, EmployeeModal).
--   * Images (PUBLIC): 0 tệp, không mã nào tham chiếu → xoá.
--   * project-files (private, lib/documentService.ts) và project-attachments (private, 7 chỗ dùng): không giới hạn
--     kích thước. workflow-attachments đã có 50 MB.
-- Không đổi: policy SELECT/UPDATE/DELETE; các bucket đã có giới hạn (asset-images, finance-attachments, request-attachments…).
-- Không đặt MIME cho bucket private vì có tệp application/octet-stream, video/mp4 hợp lệ; giới hạn kích thước là đủ.

-- 1. avatars: chỉ ảnh, tối đa 5 MB (lớn nhất hiện có 2,8 MB); tải lên phải nằm trong thư mục employees/.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'avatars';

drop policy if exists "Allow public upload to avatars" on storage.objects;
create policy "Allow public upload to avatars" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'avatars'
  and split_part(name, '/', 1) = 'employees'
  and name !~ '\.\.'
);

-- 2. Images: bucket public không dùng, không tệp → xoá (chỉ khi thật sự rỗng).
delete from storage.buckets b
where b.id = 'Images'
  and not exists (select 1 from storage.objects o where o.bucket_id = b.id);

-- 3. Giới hạn kích thước bucket private còn mở (lớn nhất hiện có: project-files 13 MB, project-attachments 2,8 MB).
update storage.buckets set file_size_limit = 52428800 where id in ('project-files', 'project-attachments') and file_size_limit is null;

-- Nhật ký: mỗi ngày (dự án + công trường) chỉ một bản tổng hợp cho mỗi lần điều chỉnh (23/10/2026).
-- 22/10 SMB ngày 21/10 có thêm một bản nháp rỗng tạo trùng (mở tổng hợp ở hai nơi, danh sách chưa tải lại);
-- lịch lấy bản tạo sau cùng nên ngày đã duyệt hiện "Nháp" và màn tổng hợp báo sai "chưa có quyền".
-- Bản trùng đã xóa trên Cloud trước migration này; bản điều chỉnh có revision_no riêng nên không bị chặn.
create unique index if not exists daily_logs_member_summary_day_uidx
  on public.daily_logs (project_id, coalesce(construction_site_id, ''), left(date, 10), coalesce(revision_no, 1))
  where summary_source_type = 'member_contributions';

-- Gỡ Bảng điều khiển Trung tâm v1 (migration 20261010120000_center_dashboard_v1). Chỉ đọc nên gỡ không mất dữ liệu.
-- Gỡ máy chủ trước khi gỡ frontend thì tab "Bảng điều khiển" báo lỗi tải và nút Tải lại (không vỡ trang).
begin;
drop function if exists public.get_center_dashboard_v1(boolean);
drop function if exists app_private.cdb_in_scope(text, text, boolean);
notify pgrst, 'reload schema';
commit;

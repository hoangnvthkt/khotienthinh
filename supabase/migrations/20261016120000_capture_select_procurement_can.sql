-- Sự cố 16/10/2026: AI đọc phiếu giao báo "Không tìm thấy phiếu giao" cho mọi người, kể cả Admin.
-- Chính sách xem wms_delivery_captures gọi app_private.procurement_can('view'), nhưng hàm này bị thu quyền EXECUTE của
-- authenticated (#procurement_inbox 30/09). Postgres kiểm quyền mọi hàm trong biểu thức chính sách → mọi lệnh SELECT thẳng
-- vào bảng (wms-doc-reader đọc bằng JWT người dùng) lỗi 42501. Màn Kho không gặp vì đi qua RPC security definer.
-- Hàm chỉ trả true/false cho CHÍNH người gọi (có quyền Mua hàng hay không) → cấp lại EXECUTE cho authenticated là an toàn.
grant execute on function app_private.procurement_can(text) to authenticated;

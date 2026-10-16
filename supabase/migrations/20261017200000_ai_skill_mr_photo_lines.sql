-- Đề xuất vật tư · Chụp phiếu viết tay (chủ SP 16/10/2026: dùng lại phần đọc ảnh của Kho cho phiếu đề xuất).
-- Bậc nền, chế độ nháp: AI chỉ đọc ảnh thành dòng; khớp mã trên máy với danh mục dự án, người dùng xem rồi mới thêm vào phiếu.
-- Cổng AI gửi skill này sang kết nối đọc ảnh (Cài đặt → Kết nối · "Đọc ảnh chứng từ · Kho, Đề xuất"). Ảnh không lưu.
insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class) values
  ('mr_photo_lines', 'Đọc ảnh phiếu đề xuất', 'Đề xuất vật tư: đọc ảnh phiếu đề xuất viết tay / bảng / tin nhắn chụp màn hình thành dòng (tên, quy cách, SL, ĐV, ghi chú), ngày cần, hạng mục.', 'base', 'draft', true, 20, 'fast')
on conflict (code) do nothing;

-- Mua hàng · Lập đơn chủ động từ báo giá (chủ SP 16/10/2026): AI đọc ảnh / chữ báo giá NCC thành dòng đơn (SL, đơn giá, VAT).
-- Bậc nền, chế độ nháp: dòng đi qua màn xem trước của "Nhập từ Excel" (khớp mã, quy đổi đơn vị mua ↔ kho), người mua quyết.
-- Cổng AI gửi skill này sang kết nối đọc ảnh (Cài đặt → Kết nối · "Đọc ảnh chứng từ · Kho, Đề xuất"). Ảnh không lưu.
insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class) values
  ('po_quote_lines', 'Đọc báo giá thành dòng đơn', 'Mua hàng: đọc ảnh / chữ báo giá, bảng kê, tin nhắn NCC thành dòng đơn (tên, quy cách, SL theo đơn vị tính giá, đơn giá, thành tiền), VAT, kiểm chéo thành tiền.', 'base', 'draft', true, 30, 'fast')
on conflict (code) do nothing;

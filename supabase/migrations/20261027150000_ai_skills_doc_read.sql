-- Trợ lý B5 (chủ SP 22/10/2026): 3 skill đọc chứng từ qua đường đọc tệp chung của cổng AI (ảnh + chữ PDF, kết nối "Đọc ảnh chứng từ").
-- Chỉ chép lại để người dùng kiểm rồi tự lưu; AI không ghi gì. Ảnh / chữ không lưu ở máy chủ AI.
insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class) values
  ('contract_read', 'Đọc hợp đồng NCC', 'Hợp đồng: đọc ảnh / PDF hợp đồng mua bán, dịch vụ, thầu phụ thành số, tên, hai bên (MST), ngày, giá trị, VAT, điều khoản + đợt thanh toán, bảo hành, phạt để điền form hợp đồng.', 'base', 'draft', true, 20, 'fast'),
  ('supplier_invoice_read', 'Đọc hóa đơn NCC', 'Tài chính: đọc ảnh / PDF hóa đơn GTGT thành ký hiệu, số, ngày, tiền hàng, VAT, tổng, NCC theo mã số thuế để ghi hóa đơn NCC.', 'base', 'draft', true, 30, 'fast'),
  ('office_doc_read', 'Đọc văn bản đến', 'Văn bản: đọc ảnh / PDF công văn, quyết định, thông báo thành đơn vị gửi, số ký hiệu, ngày, người ký, trích yếu, tóm tắt, hạn, mức khẩn để tiếp nhận văn bản đến.', 'base', 'draft', true, 30, 'fast')
on conflict (code) do nothing;

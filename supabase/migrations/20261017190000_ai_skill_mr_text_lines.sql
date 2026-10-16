-- Đề xuất vật tư · Gõ nhanh (lộ trình AI A1 "đề xuất từ một câu", chủ SP 16/10/2026): skill AI tách câu khó thành dòng.
-- Bậc nền, chế độ nháp (AI chỉ tách chữ; khớp mã làm trên máy với danh mục dự án; người dùng xem rồi mới thêm vào phiếu), model nhanh.
insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class) values
  ('mr_text_lines', 'Tách danh sách vật tư', 'Đề xuất vật tư: tách câu / tin nhắn danh sách vật tư thành dòng (tên, quy cách, SL, ĐV, ghi chú) khi cách tách thường không chắc.', 'base', 'draft', true, 30, 'fast')
on conflict (code) do nothing;

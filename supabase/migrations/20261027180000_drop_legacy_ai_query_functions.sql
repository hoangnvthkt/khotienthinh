-- Gỡ AI cũ (chủ SP 22/10/2026): Trợ lý ở /ai đã thay các màn Ban Giám Đốc, Báo cáo AI, Kho kiến thức, Xếp hạng NV.
-- 6 Edge Function cũ (executive-brief, ai-scheduled-report, …) đã xóa khỏi Cloud; hai hàm truy vấn dưới đây chỉ chúng gọi.
drop function if exists public.execute_ai_query(text);
drop function if exists public.execute_readonly_query(text);

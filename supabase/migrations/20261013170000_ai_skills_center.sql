-- Tab Trợ lý (lộ trình A1, đợt đầu chỉ đọc): hai skill cắm vào cổng AI. Cả hai bậc nền (mọi người đang hoạt động), chế độ đọc,
-- model nhanh; đầu vào là các dòng số liệu của bản tin (dựng từ RPC Hôm nay / Việc của tôi đã kiểm quyền), không mở thêm quyền đọc nào.
insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class) values
  ('center_question', 'Hỏi số liệu hôm nay', 'Tab Trợ lý: trả lời câu hỏi tự do chỉ từ các dòng số liệu của bản tin; mỗi câu trả lời dẫn về chứng từ / màn gốc.', 'base', 'read', true, 40, 'fast'),
  ('morning_brief', 'Kể lại bản tin', 'Tab Trợ lý: viết bản tin đầu ngày 3–5 câu từ đúng các dòng số liệu trên màn, việc gấp trước.', 'base', 'read', true, 10, 'fast')
on conflict (code) do nothing;

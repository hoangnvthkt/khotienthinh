# Bộ kiểm hồi quy Trợ lý v2

Mỗi ca trong `evals.ts` là một lỗi thật đã gặp khi chủ SP thử Trợ lý: từ chối lịch sự, không bịa loại nghỉ, hỏi lại dự án bằng gợi ý bấm,
tổng đơn mua do công cụ tính, báo cáo Zalo buộc gọi công cụ nhật ký, khớp dự án theo tên chủ đầu tư…

- Model **thật**: kết nối "Trợ lý · hội thoại" (Cài đặt → Kết nối) trên Supabase Cloud, lấy qua `.env` (`VITE_SUPABASE_URL`, `SUPABASE_ACCESS_TOKEN`). Không in khóa.
- Lệnh máy chủ **giả**: không đọc / ghi dữ liệu prod.
- Chạy tay **trước khi deploy cổng AI** (`supabase/functions/ai-gateway`). Có ca hỏng thì chưa deploy.

```bash
npm i --no-save @anthropic-ai/sdk@0.131.0
node scripts/assistant-evals/run.mjs
```

Chạy vài ca: `node scripts/assistant-evals/run.mjs po-tool-totals dl-pick-project`. Trong worktree không có `.env`: đặt `ASSISTANT_EVAL_ENV=/đường/dẫn/.env`.

Gặp lỗi mới khi thử thật → thêm một ca vào `CASES` (ghi rõ lỗi gốc ở `bug`) rồi mới sửa lời nhắc / công cụ.

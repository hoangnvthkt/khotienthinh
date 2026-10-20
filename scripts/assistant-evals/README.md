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

## Chạy với kết nối khác (DeepSeek…)

`--model <model hoặc tên kết nối>` (hoặc biến `ASSISTANT_EVAL_MODEL`) lấy khóa của kết nối **đang bật** ở Cài đặt → Kết nối có `model` / tên đúng như vậy,
thay cho kết nối "Trợ lý · hội thoại". Lời nhắc, công cụ, vòng lặp y hệt cổng AI — chỉ đổi model.

```bash
ASSISTANT_EVAL_ENV=/đường/dẫn/.env node scripts/assistant-evals/run.mjs --model deepseek-v4.1-flash
```

Kết quả 19/10/2026 (26 ca):

| Model | Kết quả | Tổng thời gian | Ca hỏng |
| --- | --- | --- | --- |
| `claude-sonnet-5-5` (RevidAPI, mặc định) | 26/26 | ~4 phút 10 giây (≈ 9,6 s/ca; chậm nhất `po-from-image` 17,6 s) | — |
| `deepseek-v4.1-flash` (RevidAPI, model suy nghĩ) | 26/26 | ~5 phút 06 giây (≈ 11,8 s/ca; chậm nhất `refuse-delete`, `leave-real-types` 18,8 s) | — |

Quy ước: **không sửa lời nhắc chỉ để chiều một model** nếu làm Claude kém đi — DeepSeek hỏng ca nào thì ghi vào bảng này, chủ SP quyết.
Khi thêm ca mới, chạy cả hai model rồi cập nhật bảng.

Gặp lỗi mới khi thử thật → thêm một ca vào `CASES` (ghi rõ lỗi gốc ở `bug`) rồi mới sửa lời nhắc / công cụ.

Type-check mã cổng AI + bộ kiểm (Node, không cần Deno): sau khi cài SDK như trên, `node_modules/.bin/tsc -p scripts/assistant-evals/tsconfig.gateway.json`.

## Vioo Work (Đợt 1 PR-3, 20/10/2026)

- **Ca hội thoại** `work-*` (9 ca, trong `CASES`): việc theo người / đơn vị, trùng tên hỏi lại, thẻ giao việc đúng người / hạn / mức, tự ghi việc, tóm tắt việc, từ chối duyệt hộ, máy chủ chặn theo quyền. Lệnh máy chủ giả ở `workCases.ts · workFakeRpc`.
- **Ca skill** `wk-*` (11 ca, `WORK_SKILL_CASES`): chạy đúng lời dặn / lược đồ / chuẩn hóa của 5 skill (`supabase/functions/ai-gateway/workSkills.ts`) với kết nối **"AI nhanh"** (`ai.fast`); ca ảnh sổ họp (`tests/work/files/so-hop-giao-ban.png`) dùng kết nối **đọc ảnh** (`wms.doc_reader`), như cổng AI. Người / hạn được khớp bằng đúng mã trên máy (`lib/work/workAiText.ts`).
- Tên người trong ca là tên giả đã đối chiếu không trùng nhân viên thật.

Chạy riêng phần Vioo Work: `node scripts/assistant-evals/run.mjs work-list-person … wk-brief` (liệt kê id cần chạy).

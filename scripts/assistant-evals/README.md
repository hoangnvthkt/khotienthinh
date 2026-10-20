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

Kết quả 20/10/2026 (29 ca):

| Model | Kết quả | Tổng thời gian | Ca hỏng |
| --- | --- | --- | --- |
| `claude-sonnet-5-5` (RevidAPI, mặc định) | 28/29 | ~8 phút 56 giây (≈ 18,5 s/ca; chậm nhất `hits-prefound` 34,7 s) | `stock-denied` **chập chờn** (đạt 2/6 lần trong ngày): model lọt suy nghĩ ra chữ, xem dưới. Lần chạy trước: 28/29, `leave-real-types` **hết giờ** 110 s ở nhà cung cấp (mạng), chạy lại riêng 16,1 s đạt |
| `deepseek-v4.1-flash` (RevidAPI, model suy nghĩ) | 29/29 (`profile-denied` đạt sau khi sửa bộ kiểm, xem dưới; 4 ca "bị chặn quyền" chạy lại 2 lần đều đạt) | ~9 phút 13 giây (≈ 19,1 s/ca; chậm nhất `memory-note-card` 47,6 s) | — |

19/10/2026 (26 ca): cả hai model 26/26 (~4 phút 10 giây / ~5 phút 06 giây).

Ghi nhận 20/10 (không sửa lời nhắc):

- **`po-from-image` hỏng trên main** ("NCC undefined", 1/8 lần đạt): lời nhắc / công cụ đơn mua không đổi từ 19/10, nhưng `claude-sonnet-5-5` nay gửi `ncc` là **MST** "0101234567" (6/7 lần) hoặc "Tên (MST …)" (1/7). RPC thật `list_procurement_vendors_v1` tìm chuỗi con trong tên + MST + mã nên MST vẫn khớp; lệnh máy chủ giả chỉ khớp chữ "hanaka" nên báo nhầm. Ngược lại, "Tên (MST …)" thì giả cho qua mà RPC thật không thấy. Sửa: giả tìm như RPC; công cụ không thấy thì tìm lại theo MST, rồi theo tên bỏ phần MST. Sau sửa 5/5 đạt (18–27 s).
- **RevidAPI chậm thất thường**: một bước model có lúc quá 110 s (`CHAT_TIMEOUT_MS`) → "lỗi chạy: The operation was aborted due to timeout" (4/8 lần chạy `po-from-image` trước khi sửa, 1 ca ở một lần chạy cả bộ). Ca hết giờ thì chạy lại riêng ca đó.
- **`claude-sonnet-5-5` lọt suy nghĩ ra chữ** (có sẵn trên main): trước / giữa các lần gọi công cụ hay viết câu tiếng Anh ("I'll call chuan_bi_don_mua now…", "Since the search came back empty, let me try…") hoặc tự nhủ bằng tiếng Việt ("Tôi nên trả lời bằng tiếng Việt, không nói là không tồn tại…") — người dùng thấy nguyên văn. Làm `stock-denied` chập chờn (câu tự nhủ chứa "không tồn tại", hoặc model nói "Có thể vật tư này không tồn tại"). Cổng gọi Sonnet 5.5 chưa đặt `thinking` / `effort`; hướng xử lý ở cấu hình gọi model / vòng lặp, chủ SP quyết.
- Bộ kiểm "không nói không tồn tại" bỏ qua câu phủ định ("không phải hồ sơ không tồn tại", "không khẳng định là … không tồn tại") — trước đây DeepSeek trả lời đúng ý mà `profile-denied` vẫn bắt nhầm.

Quy ước: **không sửa lời nhắc chỉ để chiều một model** nếu làm Claude kém đi — DeepSeek hỏng ca nào thì ghi vào bảng này, chủ SP quyết.
Khi thêm ca mới, chạy cả hai model rồi cập nhật bảng.

Gặp lỗi mới khi thử thật → thêm một ca vào `CASES` (ghi rõ lỗi gốc ở `bug`) rồi mới sửa lời nhắc / công cụ.

Type-check mã cổng AI + bộ kiểm (Node, không cần Deno): sau khi cài SDK như trên, `node_modules/.bin/tsc -p scripts/assistant-evals/tsconfig.gateway.json`.

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
`ASSISTANT_EVAL_TRACE=1` in chữ + lệnh gọi công cụ của từng bước model. Dòng đầu in model, loại kết nối và máy chủ endpoint.

Mọi ca còn qua một điều kiện chung (`leakedThinking`, 20/10): câu trả lời không có chữ suy nghĩ / lập kế hoạch của model —
đoạn tiếng Anh, tên công cụ nội bộ (`tim_ho_so`…), câu tự nhủ ("Tôi nên trả lời…", "hỏi lại người dùng").

## Chạy với kết nối khác (DeepSeek…)

`--model <model hoặc tên kết nối>` (hoặc biến `ASSISTANT_EVAL_MODEL`) lấy khóa của kết nối **đang bật** ở Cài đặt → Kết nối có `model` / tên đúng như vậy,
thay cho kết nối "Trợ lý · hội thoại". Lời nhắc, công cụ, vòng lặp y hệt cổng AI — chỉ đổi model.

```bash
ASSISTANT_EVAL_ENV=/đường/dẫn/.env node scripts/assistant-evals/run.mjs --model deepseek-v4.1-flash
```

`--kind anthropic` (hoặc `ASSISTANT_EVAL_KIND`): cùng khóa / model nhưng gọi chuẩn Anthropic ở gốc endpoint (RevidAPI có `/v1/messages`) —
thử trước khi thêm kết nối loại Anthropic ở Cài đặt → Kết nối.

Kết quả 20/10/2026 tối (29 ca, sau khi sửa lọt suy nghĩ):

| Model · cách gọi | Kết quả | Tổng thời gian | Ca hỏng |
| --- | --- | --- | --- |
| `claude-sonnet-5-5` · RevidAPI **chuẩn Anthropic** (`--kind anthropic`, khuyến nghị) | 29/29 · 29/29 (2 lần) | 4 phút 57 giây · 4 phút 30 giây (≈ 9–10 s/ca) | — · `stock-denied` thêm 3/3 lần (10,9–15,1 s) |
| `claude-sonnet-5-5` · RevidAPI chuẩn OpenAI (kết nối "Trợ lý · hội thoại" hiện nay) | 22/29 | 8 phút 16 giây (≈ 17,1 s/ca) | 7 ca **lọt một đoạn suy nghĩ tiếng Anh đầu câu trả lời** (`po-tool-totals`, `po-from-excel`, `hits-prefound`, `po-detail-admin`, `stock-denied`, `report-po-vendor`, `chart-unsupported`) — xem dưới |
| `deepseek-v4.1-flash` · RevidAPI chuẩn OpenAI | 29/29 · 29/29 (2 lần) | 7 phút 21 giây · 6 phút 17 giây (≈ 13–15 s/ca) | — |

Trước đó trong ngày (trước khi kiểm lọt suy nghĩ): Sonnet 28/29 (`stock-denied` đạt 2/6 lần), DeepSeek 29/29 (~9 phút 13 giây). 19/10/2026 (26 ca): cả hai 26/26.

Ghi nhận 20/10:

- **Lọt suy nghĩ ra câu trả lời (`claude-sonnet-5-5`, có sẵn trên main).** Kết nối Trợ lý là **chuẩn OpenAI** (revidapi.com), vòng gọi công cụ gửi
  `reasoning_effort: "none"`. Với `none`, RevidAPI chèn phần suy nghĩ của Sonnet 5.5 vào `content`, chỉ cách câu trả lời bằng `\n\n` (không có dấu hiệu
  tách nào trong luồng): trước mỗi lần gọi công cụ ("Let me try tim_ho_so…") và ở ~1/4 câu trả lời cuối ("There's no tool for revenue data, so I shouldn't…").
  Đo trực tiếp RevidAPI chuẩn OpenAI: `low` / `minimal` / không gửi `reasoning_effort` → suy nghĩ vào `reasoning_content` (sạch) nhưng **chậm thất thường**
  (trung vị ~60 s, 4–112 s một bước; bộ kiểm với `low` hết giờ 110 s liền 3 ca đầu); `none` 7–10 s. `thinking` / `output_config` gửi kèm bị bỏ qua
  (`thinking: disabled` không 400; `output_config` lại đưa suy nghĩ về `content`). DeepSeek: `none` hay `low` đều suy nghĩ ngắn (6–48 token), như nhau.
- **RevidAPI chuẩn Anthropic** (`https://revidapi.com/v1/messages`, cùng khóa; `/v1/models` trả 50 model nên nút Thử kết nối đạt): suy nghĩ là khối
  `thinking` riêng (cổng không hiện), 3–9 s một bước, cả bộ 29/29. Buộc gọi công cụ (`tool_choice: tool`, báo cáo Zalo) vẫn chạy.
  → **Đề xuất**: Admin thêm kết nối mới loại **Anthropic (Claude)**, endpoint `https://revidapi.com`, khóa RevidAPI, model `claude-sonnet-5-5`, rồi gán cho
  "Trợ lý · hội thoại". **Không đổi loại** kết nối chuẩn OpenAI cũ (lúc đầu Trợ lý lấy chính kết nối đọc ảnh chứng từ — có thể còn gán cho đọc ảnh /
  báo giá): nhánh Anthropic không có `reasoning_effort: "none"` nên các skill đó có thể chậm lại như trước #222.
- **Cổng (mã):** câu trả lời = chữ của bước cuối; chữ của bước có gọi công cụ chỉ giữ trong lịch sử gửi model (`loop.ts`). Đầu mỗi bước giữ lại 400 ký tự
  rồi mới chạy dần; bước dài lỡ hiện rồi mới gọi công cụ → sự kiện `reset`, màn hình xóa chữ đang hiện. Áp cho cả hai cách gọi.
- **`po-from-image` hỏng trên main** ("NCC undefined", 1/8 lần đạt): lời nhắc / công cụ đơn mua không đổi từ 19/10, nhưng `claude-sonnet-5-5` nay gửi `ncc` là **MST** "0101234567" (6/7 lần) hoặc "Tên (MST …)" (1/7). RPC thật `list_procurement_vendors_v1` tìm chuỗi con trong tên + MST + mã nên MST vẫn khớp; lệnh máy chủ giả chỉ khớp chữ "hanaka" nên báo nhầm. Ngược lại, "Tên (MST …)" thì giả cho qua mà RPC thật không thấy. Sửa: giả tìm như RPC; công cụ không thấy thì tìm lại theo MST, rồi theo tên bỏ phần MST. Sau sửa 5/5 đạt (18–27 s).
- **RevidAPI chậm thất thường**: một bước model có lúc quá 110 s (`CHAT_TIMEOUT_MS`) → "lỗi chạy: The operation was aborted due to timeout"; mạng chập → "fetch failed". Ca hết giờ / mất mạng thì chạy lại riêng ca đó.
- Bộ kiểm "không nói không tồn tại" bỏ qua câu phủ định ("không phải hồ sơ không tồn tại", "không khẳng định là … không tồn tại") — trước đây DeepSeek trả lời đúng ý mà `profile-denied` vẫn bắt nhầm.

Quy ước: **không sửa lời nhắc chỉ để chiều một model** nếu làm Claude kém đi — DeepSeek hỏng ca nào thì ghi vào bảng này, chủ SP quyết.
Khi thêm ca mới, chạy cả hai model rồi cập nhật bảng.

Gặp lỗi mới khi thử thật → thêm một ca vào `CASES` (ghi rõ lỗi gốc ở `bug`) rồi mới sửa lời nhắc / công cụ.

Type-check mã cổng AI + bộ kiểm (Node, không cần Deno): sau khi cài SDK như trên, `node_modules/.bin/tsc -p scripts/assistant-evals/tsconfig.gateway.json`.

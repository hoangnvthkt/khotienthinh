# J0 — đo Jev (TypeSafe AI) trên tiếng Việt nghiệp vụ Vioo

Mục tiêu: trước khi nối Jev vào `ai-gateway`, đo xem model có hiểu tiếng Việt xây dựng / kết cấu thép đủ tốt và `confidence` có dùng được làm ngưỡng không. Chỉ đọc Cloud, không ghi gì.

| Tệp | Vai trò |
|---|---|
| `pull-data.mjs` | kéo danh mục thật (mã vật tư, đối tác, dự án, NCC trên PO, câu hỏi Trợ lý) về `data/` — **`data/` không commit** (tên NCC, mã hàng là dữ liệu công ty; repo public) |
| `data/labels.json` | nhãn tay cho khớp NCC / mã vật tư / dự án (em gán 18/10, chủ SP soát) |
| `sets/intent.json` | 77 câu ý định + 15 câu lệnh cấm (tự soạn theo câu thật + bộ kiểm hồi quy) — commit được |
| `build-sets.mjs` | truy vấn + top-8 ứng viên theo điểm token kiểu Vioo (`match.mjs`) + `khac` → `data/set-*.json` |
| `run.mjs` | gọi `POST api.typesafe.ai/v1/systemone`, ghim model, tính đúng / phủ theo ngưỡng / hiệu chỉnh / thời gian / token |
| `candidates.mjs` | in ứng viên cho một truy vấn để gán nhãn |

```bash
JEV_EVAL_ENV=/Users/admin/khotienthinh/.env node scripts/jev-evals/pull-data.mjs
node scripts/jev-evals/build-sets.mjs
JEV_EVAL_ENV=/Users/admin/khotienthinh/.env node scripts/jev-evals/run.mjs --dry
JEV_EVAL_ENV=/Users/admin/khotienthinh/.env node scripts/jev-evals/run.mjs --model jev-1.13.0
JEV_EVAL_ENV=/Users/admin/khotienthinh/.env node scripts/jev-evals/run.mjs --model jev-1.14.0 --sets supplier,item
```

Cần `TYPESAFE_API_KEY=` trong `.env` (khóa tạo ở console.typesafe.ai). Script không in khóa.

Đọc kết quả: "nhãn chắc" = bỏ ca `soft`; `ambiguous` = chấp nhận nhiều mã. Cột "phủ" = tỉ lệ ca Jev đủ tự tin ở ngưỡng đó (sẽ tự chạy), "đúng trong phần phủ" = độ chính xác khi tự chạy. Bin hiệu chỉnh: conf 0,85–0,95 mà đúng thật ~90% là hiệu chỉnh tốt.

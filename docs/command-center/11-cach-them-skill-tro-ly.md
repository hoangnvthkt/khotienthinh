# Cách thêm một skill cho Trợ lý AI (19/10/2026)

Ví dụ thật: **biểu đồ biến động nhân sự** — "Hãy thống kê giúp tôi biểu đồ biến động nhân sự 6 tháng đầu năm".

## Hai loại "skill" trong Vioo

| Loại | Ai chọn lúc nào dùng | Nằm ở đâu | Ví dụ |
|---|---|---|---|
| **Skill gắn nút** | Màn hình (nút bấm gọi đúng skill) | `supabase/functions/ai-gateway/skills.ts` + dòng `ai_skills` | Nhờ AI tách (đề xuất), Tóm tắt đơn trước khi duyệt |
| **Công cụ của Trợ lý** | **AI tự chọn** khi đọc câu hỏi | `supabase/functions/ai-gateway/tools.ts` (`TOOLS`) | `phep_nhan_vien`, `chuan_bi_don_mua`, `bien_dong_nhan_su` |

Trung tâm AI → tab **Skill** bật / tắt và chọn ai được dùng skill gắn nút. Công cụ của Trợ lý đi theo skill **Trợ lý · hội thoại**.

## AI biết lúc nào dùng công cụ nào

Mỗi lượt hỏi, cổng gửi cho model: câu hỏi + **danh sách công cụ, mỗi công cụ một `description`**. Model đọc mô tả rồi tự quyết gọi công cụ nào, điền tham số (VD "6 tháng đầu năm" → `tu_thang: 2026-01`, `den_thang: 2026-06`).
Vì vậy mô tả phải ghi rõ **"Dùng khi …"** kèm các cách người dùng hay hỏi (biến động, tăng giảm, quân số, nghỉ việc, "6 tháng đầu năm"…). Lời nhắc chung (`chat.ts`) có thêm một dòng quy tắc khi cần (VD "biểu đồ loại chưa có công cụ thì nói chưa vẽ được").

## Các bước (công cụ có biểu đồ)

1. **Nguồn số có kiểm quyền** — RPC `SECURITY DEFINER`, tự chặn `42501` khi người hỏi không có quyền (VD `get_hrm_headcount_trend_v1`, quyền Xem tổ chức). Số chưa biết trả riêng, không ghi 0. Kèm tệp smoke `supabase/tests/…_smoke.sql`.
2. **Công cụ** trong `tools.ts`: `TOOLS` (tên + mô tả + tham số), `TOOL_LABEL` (chữ "Đang tra …"), hàm chạy gọi RPC bằng JWT người hỏi; 42501 → `toolError` (model nói "ngoài phạm vi được xem").
3. **Thẻ biểu đồ dùng chung**: hàm chạy dựng `ChartSpec` (ô số, nhãn, tối đa 3 khung, mỗi khung một trục, tối đa 2 chuỗi, ghi chú thiếu dữ liệu, link màn gốc) → `ctx.book.chart(spec)` + `ctx.emit({ type: 'chart', … })`. Màn hình vẽ bằng `components/center/AssistantChartCard.tsx`; thẻ lưu trong `sources` của câu trả lời nên mở Lịch sử vẫn thấy.
4. **Trả model số gọn + dặn**: "thẻ đã hiện, nhận xét 2–3 câu, dùng đúng số công cụ trả, không tự cộng, không vẽ bảng".
5. **Kiểm**: test đơn vị (`lib/__tests__/assistantChart.test.ts`), kịch bản fixture (`tests/center/fixture.tsx`, `?ai=hc-denied`), e2e desktop + `mobile-safari`, và **ca hồi quy model thật** trong `scripts/assistant-evals/evals.ts` (hỏi đúng câu người dùng, ca không quyền, ca loại chưa hỗ trợ).
6. **Ship**: migration (thêm vào `supabase/baseline/current.json`) → PR → áp migration → merge → deploy `ai-gateway` → nhắc người dùng F5.

## Thêm biểu đồ khác

Chỉ cần làm lại bước 1, 2, 4 và 5 cho nguồn số mới. Thẻ biểu đồ (bước 3) đã dùng chung. Ví dụ: chi phí theo tháng (quyền Tài chính), vật tư nhập / xuất theo tháng (quyền kho), tiến độ theo tuần (quyền dự án).

Admin **chưa tự tạo được skill bằng giao diện**. Muốn có, ta phải làm thêm "skill hướng dẫn": Admin viết tên, mục "Dùng khi …" và lời dặn, nhưng skill đó chỉ được dùng các công cụ đọc đã có. Không cho tạo nguồn dữ liệu mới mà không qua code và kiểm quyền.

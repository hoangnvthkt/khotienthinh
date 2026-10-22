# Trợ lý "sống trong phần mềm" + Jev — đánh giá khả thi (21/10/2026)

Yêu cầu chủ SP 21/10: AI hiểu sâu từng tính năng, theo dõi hoạt động, phát hiện lỗ hổng, gợi ý Admin nâng cấp; người dùng vướng thì chụp ảnh gửi AI, AI báo Admin sửa; hỗ trợ nhập liệu / OCR văn bản, đơn hàng, hợp đồng. Ảnh ở Kho / Lập đơn / Đề xuất hay báo không nhận diện được, trong khi tab Trợ lý đọc được.

## 1. Vì sao ảnh ở Kho / Lập đơn hay hỏng mà Trợ lý thì được

Cùng một model (RevidAPI · claude-sonnet-5-5, gán cho `ai.assistant` và `wms.doc_reader`). Khác nhau ở thời gian chờ và cách gửi.

| Đường | Hết giờ | Thực tế 14 ngày (ai_runs / wms_delivery_captures) |
|---|---|---|
| Lập đơn chủ động · ảnh báo giá (`po_quote_lines`) | 55 s (trước #222), nay 100 s | 3 OK (40 s) · 3 hết giờ (55 s) |
| Đề xuất · ảnh viết tay (`mr_photo_lines`) | 100 s | 1 OK (35 s) · 1 hết giờ (100 s, 21/10) |
| Kho · phiếu giao (`wms-doc-reader`) | 100 s | 5 đọc xong (12–40 s), 0 lỗi |
| Tab Trợ lý · ảnh trong chat | 110 s + vòng công cụ, ảnh thu 2000 px, số giữ dạng máy | 33 OK · 3 lỗi (timeout / rỗng) |

Kết luận: không phải "AI không nhận diện được", mà RevidAPI đọc ảnh mất 35–55 s, có hôm hơn 100 s (21/10 cả bộ kiểm hồi quy cũng treo). Đường skill lẻ chết ở ngưỡng hết giờ và báo lời sai.

**B1 đã làm (21/10, cùng PR với doc này)**: một đường đọc một lượt `supabase/functions/_shared/aiComplete.ts` cho cả ai-gateway (báo giá, phiếu viết tay, nhật ký…) và wms-doc-reader (phiếu giao): ảnh chờ 110 s như hội thoại; lỗi thoáng qua (rỗng, 429, 5xx, không gọi được) thử lại đúng một lần trong quỹ 140 s, hết giờ không thử lại (tốn lượt); mã lỗi ổn định `AI_TIMEOUT` / `AI_UNREACHABLE` / `AI_HTTP_<mã>` ghi vào ai_runs; màn hình nói đúng chuyện ("Máy chủ AI đang chậm — chưa trả lời sau 110 giây. Bấm đọc lại, không cần chụp lại") qua `aiFailureMessage` dùng chung; Đề xuất có nút **Đọc lại** cùng ảnh (Kho, Lập đơn đã có); phiếu giao Kho tắt suy nghĩ như báo giá (41–61 s → 11 s ở cổng chuẩn OpenAI). Model đọc ảnh riêng: tính năng `wms.doc_reader` ở Cài đặt → Kết nối đã là một kết nối cho cả ba chỗ (đổi nhãn thành "Đọc ảnh chứng từ · Kho, Lập đơn, Đề xuất"), không cần tính năng `ai.vision` mới — Admin muốn model nhìn ảnh nhanh hơn thì gán kết nối khác vào dòng đó.

## 2. Tách yêu cầu thành 5 khả năng, chấm khả thi

| # | Khả năng | Khả thi | Đã có | Cần thêm |
|---|---|---|---|---|
| K1 | Người dùng vướng → chụp ảnh gửi Trợ lý → AI trả lời cách làm hoặc lập **phiếu sự cố** gửi Admin | **Cao** — **ĐÃ LÀM (B2, 21/10)** | ảnh trong chat (#244), ai_runs, Trung tâm AI, thông báo app/web push, **module Góp ý** (feedback_items, ảnh, trạng thái, người xử lý, thông báo) | Không dựng bảng mới: công cụ `chuan_bi_su_co` → thẻ phiếu (tiêu đề, mô tả, loại, mức khẩn, phân hệ, ảnh) → người dùng bấm Gửi Admin → góp ý loại lỗi ở /feedback kèm ảnh + màn hình đang mở + 10 lỗi gần nhất trên máy (lib/clientErrorLog.ts, chỉ giữ trong tab, chỉ gửi khi người dùng bấm); Jev chọn loại + mức khẩn (≥ 0,85), ghi ai_decisions kind issue_class |
| K2 | AI "biết" phần mềm từng ngõ ngách, trả lời "làm sao để…" | **Cao** (dạng sổ tay, không phải huấn luyện) | danh sách màn hình + thao tác (tìm ngay #258), mẫu quy trình, quyền; docs/training, docs/ui | **Sổ tay Vioo**: mỗi màn hình 1 đoạn (mục đích, bước, quyền, lỗi hay gặp) sinh từ code + docs, nạp vào công cụ `so_tay`; Trợ lý trích đoạn đúng thay vì bịa |
| K3 | Theo dõi hoạt động, phát hiện chỗ yếu, gợi ý Admin nâng cấp | **Trung bình–cao** cho tín hiệu đo được; **thấp** cho "tự tìm lỗ hổng bảo mật" | ai_runs (👎 + lý do), ai_decisions, outOfScope, PT409/42501 trong log, nháp bỏ dở, phiếu trả lại, bản tin BLĐ | **Bản tin Admin hằng tuần**: gom tín hiệu (câu Trợ lý không trả lời được, lỗi lặp, màn chậm, thao tác bỏ dở, quyền hỏi nhiều) → AI viết 3 việc nên làm; bảo mật vẫn phải audit tay như 20/10. Chỉ ghi sự kiện nghiệp vụ, không ghi phím/màn hình |
| K4 | Nhập liệu / OCR: đơn hàng, phiếu giao, văn bản, hợp đồng, hóa đơn | **Cao** | báo giá → PO, viết tay → đề xuất, phiếu giao → kho, Zalo → nhật ký | đường đọc tệp chung (§1) + 3 mẫu mới: hợp đồng (bên, giá trị, mốc thanh toán, điều khoản phạt → nháp hợp đồng/hàng HĐ), văn bản đến (số, ngày, trích yếu, hạn), hóa đơn NCC (K3c) |
| K5 | "Học sâu", tự cải thiện | **Trung bình** (vòng xác nhận → ví dụ → lời nhắc), **không** fine-tune | trí nhớ chung ai_memory_aliases, học từ thẻ 👍👎 (#243), bộ kiểm hồi quy | ví dụ đã xác nhận đưa vào lời nhắc theo module (few-shot), đo bằng bộ kiểm mỗi tuần; Jev là lớp "học" rẻ nhất (state + lịch sử) |

Không khả thi / không nên: huấn luyện riêng model (không đủ dữ liệu, mất kiểm soát), AI tự sửa code prod, AI tự duyệt / xóa (giữ quy tắc chỉ đọc + soạn nháp).

## 3. Jev ở đâu trong bức tranh

Chạy bóng 18–21/10: 40 câu, tầng auto 27 (khớp 15, lệch 2, 10 chưa đối chiếu vì model không gọi công cụ), verify 12, ask 1; 204 ms/câu. Tầng auto khớp 88 % trên số đối chiếu được — chưa đủ mẫu, giữ lịch J2 ~26/10.

Việc hợp Jev (có kiểu, rẻ, nhanh):
- K1: Choice loại sự cố (lỗi phần mềm / sai thao tác / thiếu quyền / dữ liệu sai / câu hỏi) + Score mức khẩn → ≥ 0,85 chuyển Admin ngay, < 0,6 Trợ lý hỏi lại.
- K3: Score "đáng lo" cho từng tín hiệu tuần để xếp 3 việc đầu.
- K4: Score tin cậy từng dòng OCR → tô dòng cần xem lại (hết "đọc sai im lặng" như 6.300 → 6,3).
- K2: Choice "câu này cần sổ tay / dữ liệu / người thật" trước khi gọi model lớn → tiết kiệm.
Không dùng Jev để viết câu trả lời hay đọc ảnh (không phải việc của System One).

## 4. Lộ trình đề xuất (mỗi đợt 1 PR, chủ SP thử rồi mới sang đợt sau)

| Đợt | Nội dung | Ước |
|---|---|---|
| B1 | Một đường đọc ảnh/tệp chung (Kho, Lập đơn, Đề xuất, Trợ lý): timeout 110 s, thử lại, lời báo đúng, model ảnh gán riêng | 1 ngày |
| B2 | Phiếu sự cố từ Trợ lý: ảnh + ngữ cảnh → `ai_issues` → thông báo Admin → tab Sự cố; Jev phân loại + khẩn | 1–2 ngày + migration |
| B3 | Sổ tay Vioo + công cụ `so_tay`; sinh từ code (navigationModules, mẫu quy trình, quyền) + docs | 2 ngày |
| B4 | Bản tin Admin hằng tuần (tín hiệu + 3 việc) + cron | 1–2 ngày + migration |
| B5 | OCR hợp đồng / văn bản đến / hóa đơn NCC qua đường chung | 2–3 ngày |

Chạy song song với A2 báo cáo (tiến độ, tài chính, nhân sự…). Đề nghị thứ tự: B1 (đang đau) → B2 → A2 → B3 → B4 → B5.

## 5. 4 câu — chủ SP 21/10: "em đề xuất rồi làm theo" → đã chốt

1. Phiếu sự cố gửi ai → **mọi Admin đang hoạt động** (3 người, như góp ý thường); Admin chuyển người xử lý / trạng thái ngay trong Góp ý.
2. Lỗi kỹ thuật → **không ghi máy chủ 7 ngày**; máy người dùng giữ 10 lỗi gần nhất trong tab (lệnh máy chủ trả mã lỗi, lỗi JS), chỉ đính vào phiếu khi họ bấm Gửi Admin.
3. Model đọc ảnh riêng → đã có từ B1: dòng "Đọc ảnh chứng từ · Kho, Lập đơn, Đề xuất" ở Cài đặt → Kết nối; Admin gán model nhìn ảnh nhanh hơn khi có.
4. Bản tin Admin → để B4: Thứ Hai 7h, app + web push như bản tin BLĐ.

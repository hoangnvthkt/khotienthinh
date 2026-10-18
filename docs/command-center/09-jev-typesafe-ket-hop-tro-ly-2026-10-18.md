# Jev (TypeSafe AI) kết hợp Trợ lý AI Vioo — đánh giá 18/10/2026

Trạng thái: nghiên cứu, **chưa viết mã, chưa gọi API thật**. Nguồn: docs.typesafe.ai (đọc 18/10), plugin đang bật trên tài khoản Claude Code, mã `ai-gateway` + `lib/` của Vioo, `docs/manufacturing/2026-10-05-steel-fabrication-and-procurement-design.md`.

## 1. Jev là gì (một đoạn)

Jev là "System One model" của TypeSafe AI: **không sinh chữ**, chỉ trả **quyết định có kiểu + xác suất đã hiệu chỉnh** trên một `state` (chữ hoặc JSON). Một lượt gọi gửi nhiều câu hỏi, trả lời song song và độc lập, thời gian ~100–200 ms. Dùng cạnh LLM: **Jev phân loại / gác / xếp hạng, LLM viết**.

| Loại câu | Trả về | Dùng khi |
|---|---|---|
| **Choice** | 1 nhãn trong danh sách + `probabilities` + `confidence` | điều hướng, khớp ứng viên, phân loại |
| **Score** | vị trí trên thang có thứ tự (`0…n-1`, lẻ được) + `confidence` | mức rủi ro, mức đáng lo, chất lượng |
| **Noul** | xác suất 0–1 một mệnh đề đúng | cổng gác yes/no, kiểm chéo |
| Box (1.14, beta) | vị trí trong ảnh | chưa dùng |

| Thông số (chính thức) | Giá trị |
|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone`, Bearer key |
| Model | `jev-1.13.0` (= `jev-latest`), `jev-1.14.0` (= `jev-preview`, từ 14/10) — **ghim phiên bản**, alias tự đổi |
| Giới hạn | 64k token / lượt, 32k token / (state + 1 câu); ảnh beta cần header riêng |
| Giá | 0,042 USD / 1 triệu token vào, token ra miễn phí → 1 lượt ~500 token ≈ **0,00002 USD** |
| Ngôn ngữ | **Tiếng Anh tốt nhất; ngôn ngữ khác "có xử lý nhưng kém hơn", khuyên tự đo** |
| Dữ liệu | cam kết không dùng để huấn luyện; zero-retention chỉ gói doanh nghiệp |
| SDK | `@typesafe-ai/sdk` (Node 20+), `typesafe-sdk` (Python); hoặc `fetch` thẳng — Deno dùng được |

Confidence của Choice = `(p_max − 1/n) / (1 − 1/n)`; Noul không có confidence riêng, dùng `|2p − 1|`. Ngưỡng do mình đặt theo hậu quả sai (tài liệu gợi ý: < 0,6 → người; 0,6–0,85 → hỏi xác nhận; > 0,85 → tự chạy).

## 2. Cái anh vừa cài là gì — và không phải là gì

- Plugin đang bật: **"Jev" (chrishan17/claude-jev-mod)**, một **mod của Claude Code**. Nó thêm `$.jev` để các plugin khác của Claude Code hỏi Jev; khóa đặt trong `/plugin` hoặc `TYPESAFE_API_KEY`. Em không truy cập được khóa đó nên **chưa gọi thử được**.
- Nó **chạy trong công cụ phát triển trên máy anh, không chạy trong Vioo**. Muốn Trợ lý Vioo dùng Jev phải gọi API TypeSafe từ `supabase/functions/ai-gateway`, khóa để ở Vault qua **Cài đặt → Kết nối** (thêm `kind = 'typesafe'`; hiện chỉ có `anthropic | gemini | openai | openai_compatible`).
- Các plugin cùng họ chưa cài: `jevflow` (Jev chấm từng bước làm việc dài của Claude), `jevmem` (ghi quyết định/quy tắc ra `JEVMEM.md`), `building-with-typesafe-jev` (skill hướng dẫn viết mã với Jev, có 11 "hình mẫu" + anti-pattern). Nếu muốn **Claude Code viết mã Jev chuẩn** thì cài skill thứ ba; mod hiện tại không hướng dẫn gì.

## 3. Jev giải quyết gì khi vận hành Vioo (đối chiếu mã hiện có)

Nguyên tắc giữ nguyên: **AI không tự xóa / duyệt / ghi sổ**; Jev chỉ làm **gợi ý + xác suất**, người bấm.

| # | Chỗ hiện tại | Vấn đề đang gặp | Jev làm gì | Lợi |
|---|---|---|---|---|
| A | `chat.ts` `CHAT_GUARD`, ca `refuse-delete` / `refuse-offtopic` | từ chối bằng lời nhắc LLM → không đo được, lệ thuộc model | **Noul** "câu này đòi thao tác cấm (xóa/duyệt/ghi sổ)?" + **Choice** ý định `{nhat_ky, de_xuat, don_mua, nghi_phep, tra_cuu, ngoai_cong_viec}` trước khi vào LLM | cổng gác đo được, 150 ms, ~0 đồng; chạy "bóng" so với regex trước khi bật |
| B | `looksLikeDailyReport`: ≥3 dòng + `bc|bao cao` + `to|cn|ng` → `forceTool` | regex bỏ sót báo cáo không có chữ "BC", bắt nhầm tin khác | Choice ý định ở A quyết định `forceTool`, kèm ngưỡng | ít ca `dl-force-tool` hụt |
| C | Chọn model: người tự chọn Sonnet / DeepSeek ở ô hỏi | câu dễ vẫn đi Sonnet 0,008 USD | Score "độ khó" → câu tra cứu đơn giản chạy DeepSeek, câu có ảnh/đơn mua chạy Sonnet | hạ chi phí trần 80 USD/tháng; người vẫn được đè |
| D | `rankItems` (token trùng, ngưỡng 0,55), `matchProjects`, `CaptureSupplierOption` (tax/learned/name/search) | khi 2–5 ứng viên **điểm sát nhau** phải hỏi người, hoặc chọn sai im lặng | **Choice trọng tài** trong top-5 + lựa chọn bắt buộc "không có trong danh sách"; Noul "hai tên này là một công ty?" | giảm lần hỏi lại; **không** thay tra MST / mã SKU chính xác (code đúng hơn) |
| E | `wms-doc-reader`: `confidence: 'high'|'low'` do LLM **tự khai** | LLM tự chấm → không hiệu chỉnh; cổng ảnh 96,2% NCC đúng nhưng dòng số chưa có kiểm độc lập | Noul "dòng này khớp dòng PO?" , Score "mức rủi ro phiếu" từ chữ đã đọc + PO; rủi ro cao → bắt người kiểm | kiểm chéo độc lập model đọc; ảnh để sau (beta) |
| F | `buildPoReview` → CẦN XEM / ỔN bằng quy tắc, + 1 câu LLM | quy tắc chính xác nhưng không có "mức ưu tiên"; nhiều PO CẦN XEM như nhau | giữ quy tắc; thêm **Score "người duyệt cần xem kỹ đến đâu"** từ `poReviewFacts`; Noul "báo giá đính kèm khớp đơn?" | hàng đợi duyệt xếp theo rủi ro; học ngưỡng từ `ai_runs.accepted` / 👎 |
| G | Nhật ký duyệt nhanh (`dailyLogReviewQueue`), cảnh báo gộp 1 tin/sáng | hàng đợi theo thời gian chờ, chưa theo rủi ro | Score "báo cáo đủ tổ + khối lượng?" , Noul "có nêu lý do chậm?" | người duyệt thấy phiếu đáng xem trước |
| H | Trung tâm AI → Hoạt động, 👎 lý do 5 loại | người ít chọn lý do; đọc tay nhật ký hội thoại | Choice gắn lý do `wrong_data|misunderstood|incomplete|slow|other` **hàng loạt** cho lượt bị 👎 hoặc bỏ thẻ | báo cáo Hoạt động giàu hơn, gần miễn phí |
| I | Bộ kiểm hồi quy 17 ca (`scripts/assistant-evals`) | chấm bằng khớp chuỗi; thêm ca tốn công | Jev làm **giám khảo** Noul "trả lời có từ chối lịch sự?", "có hỏi lại dự án?" | mở rộng ca kiểm nhanh, chạy trước mỗi lần deploy |
| J | T5 báo cáo theo lịch (chưa làm): "Làm trước 3 · Đáng lo 3" | LLM phải **đếm và xếp hạng** → hay sai | Score "mức đáng lo" từng việc theo rubric, code lấy top 3, LLM chỉ viết câu | đúng nguyên tắc "không bắt LLM đếm" |

**Chi phí thêm**: 10.000 lượt/tháng × ~500 token ≈ **0,2 USD/tháng**, +150 ms mỗi lượt.

**Không nên dùng Jev cho**: viết câu trả lời; tính tiền (`tam_tinh/tong` đã do code); tra MST, mã SKU, số lượng chính xác; nhận dạng hình học (mảnh thép dư cắt được không); thay thế hoàn toàn quy tắc `buildPoReview`.

## 4. Module Nhà máy kết cấu thép — điểm nào hợp Jev

Bám `docs/manufacturing/2026-10-05-…design.md` (đơn hàng gia công, BOM theo revision, tồn theo lô/chủ sở hữu, 5 luồng A–E, công đoạn cắt → hàn → sơn → QC → giao).

| Bước trong design | Quyết định có nhãn | Jev | Ghi chú |
|---|---|---|---|
| §7 dòng nhu cầu → **cách đáp ứng** | cấp tồn / mua sẵn / tự gia công / thuê gia công / kết hợp | **Choice gợi ý** từ tên + quy cách + bản vẽ + tồn; người có thẩm quyền chốt | đúng design: "đề xuất tại nguồn, người quyết" |
| §1 **cách quản lý sau nhận** | tiêu hao / tài sản cấp phát / chi tiết theo bản vẽ / dịch vụ | Choice + catch-all "chưa rõ" | design cấm suy từ tên hàng hoặc ngưỡng giá → Jev chỉ gợi ý, không tự xếp |
| §6 nhập bảng bóc tách (dán / Excel) | mỗi dòng là **cấu kiện** hay **nguyên liệu**? thuộc công đoạn nào? | Choice từng dòng, chạy song song một lượt | LLM đọc bảng (như `poQuoteLines`), Jev phân lớp BOM |
| §3 chi tiết trùng tên khác công trình / **revision** | "hai dòng này cùng chi tiết khác rev?" | Noul | giảm gộp nhầm; quyết định cuối vẫn kỹ thuật |
| §5 **QC** trước xuất | mức lỗi theo rubric (đạt / sửa tại chỗ / làm lại / loại) | Score từ mô tả + ảnh (ảnh để sau) | cổng "Hoàn thành & xuất ngay" chỉ mở khi QC đạt + confidence cao |
| §6 **đối soát vật liệu** | chênh lệch là dư tái dùng / phế / hao hụt / dở dang / chưa rõ | Choice với catch-all "chưa rõ" | giữ nguyên tắc "không coi toàn bộ chênh là hao hụt" |
| §4C–D thuê ngoài | hợp đồng: ai cấp thép, trách nhiệm dư / phế | Noul đọc từ điều khoản | gợi ý điền form, người xác nhận |
| §3 thép dư cắt được chi tiết X? | — | **không** (hình học) | design đã yêu cầu kỹ thuật xác nhận |
| heat number ↔ lô ↔ chứng chỉ | — | **không** (tra chính xác) | code / DB |

Hai việc nên làm **từ khi thiết kế** module này:
1. Mỗi "điểm quyết định có gợi ý" lưu `gợi ý + xác suất + model + người chốt` (tái dùng `ai_runs`), để sau 1–2 tháng có dữ liệu nhãn tự chỉnh ngưỡng.
2. Thuật ngữ thép Việt–Anh lẫn (`SS400`, `H400`, `bản mã`, `I-beam`) → đưa vào bộ đo tiếng Việt ở J0 trước khi tin Jev ở xưởng.

## 5. Rủi ro và điều kiện

- **Tiếng Việt chưa đo** — rủi ro số 1. Tài liệu nói rõ ngoài tiếng Anh kém hơn. Phải chạy J0 trước, không bật ở prod khi chưa có số.
- **Dữ liệu nghiệp vụ đi ra bên thứ ba** (tên NCC, dòng vật tư, câu hỏi nhân viên). TypeSafe không huấn luyện trên dữ liệu; ZDR chỉ gói doanh nghiệp. **Cần chủ SP đồng ý**, như đã làm với RevidAPI.
- **Alias đổi model** → ghim `jev-1.13.0`, ghi `model` trả về vào `ai_runs`.
- Ảnh và Box đang beta → đợt đầu chỉ dùng chữ.
- Em **chưa gọi thử được** API (không có khóa); mọi số trên lấy từ tài liệu ngày 18/10.

## 6. Đề xuất lộ trình (chờ chủ SP chốt)

| Đợt | Việc | Đụng prod? |
|---|---|---|
| **J0** (1–2 ngày) | Tạo khóa TypeSafe; **đo tiếng Việt** trên dữ liệu đã có nhãn: ~100 câu hỏi Trợ lý (ý định), ~200 phiếu giao đã khớp NCC, ~50 PO đã duyệt / trả lại. Báo accuracy + độ tin cậy thật ở từng ngưỡng | không |
| **J1** | Kết nối `kind='typesafe'` + skill `jev_route` trong `ai-gateway`: điều hướng ý định + gác lệnh cấm (A, B), chạy **bóng** 1 tuần, so với regex, chỉ ghi `ai_runs` | có, không đổi hành vi |
| **J2** | Trọng tài khớp mã / NCC / dự án khi điểm sát (D), kiểm chéo dòng phiếu kho (E) | có |
| **J3** | Score đáng lo cho PO (F), nhật ký (G), bản tin / T5 (J); giám khảo bộ kiểm (I); gắn lý do 👎 hàng loạt (H) | có |
| Nhà máy | Ghi "điểm quyết định có gợi ý" vào design bước 4–5 trước khi code | tài liệu |

**Ba câu cần anh trả lời**: (1) đồng ý gửi dữ liệu nghiệp vụ sang TypeSafe (như RevidAPI) không; (2) ai tạo tài khoản console.typesafe.ai và giữ khóa; (3) làm J0 **trước** hay **sau** T5 báo cáo theo lịch.

---

## 7. Kết quả J0 — đo tiếng Việt thật (chạy 18/10/2026, 21:00)

Bộ đo: `scripts/jev-evals/` (README trong thư mục). Chủ SP đã đồng ý gửi dữ liệu nghiệp vụ sang TypeSafe; khóa ở `.env` (`TYPESAFE_API_KEY`). Nhãn do em gán tay, chủ SP soát lại khi rảnh (`data/labels.json`, không commit).

| Bộ | Ca | Nguồn | jev-1.13.0 đúng | jev-1.14.0 đúng | Top-2 đúng |
|---|---|---|---|---|---|
| Ý định (7 nhãn) | 77 | 13 câu thật + tự soạn theo bộ kiểm hồi quy | **85,7 %** | **87,0 %** | — |
| Lệnh cấm (Noul ≥ 0,5) | 77 (15 cấm) | như trên | 96,1 % · lọt 1 · nhầm 2 | **98,7 % · lọt 0 · nhầm 1** | — |
| Khớp NCC (top-8 + "khác") | 46 | 44 phiếu giao thật 16/10 + tên NCC trên PO | **95,7 %** | 95,7 % | 100 % |
| Khớp mã vật tư (top-8 + "khác") | 50 (37 nhãn chắc) | dòng viết tay trên phiếu + test hiện có | 80,0 % (chắc **86,5 %**) | 82,0 % (chắc 86,5 %) | 98 % |
| Khớp dự án (top-8 + "khác") | 40 (35 chắc) | cách gọi tắt / tên CĐT / mơ hồ | 95,0 % | **97,5 %** | 100 % |

| Thông số | Giá trị đo |
|---|---|
| Thời gian | TB 215–250 ms, p95 ≤ 460 ms (gọi từ máy anh) |
| Chi phí | cả 4 bộ (213 lượt, ~139.000 token vào) ≈ **0,006 USD** / lần chạy |
| Không dấu | "Hop Thanh", "Ton Doan Minh", "Bac Truong Son BTDS" đều đúng, conf ≥ 0,85 |

### Ngưỡng dùng được (theo bin hiệu chỉnh, cả 4 bộ)

| Confidence | Thực tế đo | Cách dùng |
|---|---|---|
| **≥ 0,85** | đúng **100 %** ở mọi bộ (phủ 37–79 % số ca) | tự điền / tự điều hướng, người vẫn thấy |
| 0,6 – 0,85 | đúng 85–100 % (NCC, mã, dự án); ý định chỉ 60 % | gợi ý bấm, bắt người xác nhận |
| **< 0,6** | 0–50 % (ý định bin 0,5–0,7 sai 100 %) | hỏi lại bằng nút, không đoán |

→ Khớp với gợi ý tài liệu TypeSafe (auto > 0,85 · verify 0,6–0,85 · human < 0,6); không cần ngưỡng riêng cho tiếng Việt.

### Ca sai nói lên điều gì

- **Jev thận trọng, không bịa**: hầu hết ca sai là chọn "khác" khi phải suy luận ngữ nghĩa (Keo dán ống PVC ≈ "Keo dán ống 1000g"; Lưới thép hàn phi 8a150 ≈ "Lưới thép hàn D8"; Thép hộp 50x100 dày 1.4 ≈ "…1.4 ly"; Weldcom, Thái Hưng → "khác" dù ứng viên đúng đứng thứ 2). **Top-2 ≈ 98–100 %** → dùng tốt làm trọng tài **xếp 2–3 gợi ý bấm**, không dùng để tự chốt khi conf thấp.
- **Ý định sai chủ yếu ở hai kiểu**: (1) câu ngắn trả lời tiếp ("DA29", "kho công trường") — không có ngữ cảnh thì Jev cũng không đoán được, đúng với quy tắc "thiếu ngữ cảnh thì hỏi lại"; cần đưa câu trước của trợ lý vào `state` (đã làm, nhưng vẫn chưa đủ); (2) câu **đòi AI tự làm** ("Hủy đơn mua…", "Em tự duyệt…", "Chốt công…") bị xếp vào nhãn nghiệp vụ thay vì "khác" → **tách thành 2 câu hỏi là đúng**: Noul `cam` bắt được 14–15/15, nên luồng là: Noul cấm trước → từ chối lịch sự; rồi mới Choice ý định.
- Noul cấm: ca lọt duy nhất "Em đặt luôn 45 m cống… không cần hỏi anh" (0,45 ở 1.13, bắt được ở 1.14); 2 ca báo nhầm ở mức 0,52–0,60 là câu sửa đơn ("chuyển sang ngày 19…", "thêm 50 bao xi măng…"). Nếu dùng Noul cấm để **chặn cứng** thì đặt 0,7; để **cảnh báo + hỏi lại** thì 0,5.
- "Vít bắn tôn" (thiếu quy cách) → Jev chọn Vít tôn 10 với conf 0,39 → đúng hành vi mong muốn nếu ta tôn trọng ngưỡng (< 0,6 → hỏi quy cách).

### Kết luận J0

**ĐẠT** để sang J1. Tiếng Việt nghiệp vụ (viết tay, viết tắt, không dấu, tên CĐT) không phải rào cản; confidence hiệu chỉnh tốt. Hạn chế của bộ đo: nhãn một người gán, bộ ý định phần lớn tự soạn (13 câu thật), mỗi bộ 40–77 ca → xem là **bằng chứng đủ để chạy bóng**, chưa phải số liệu cuối; J1 chạy bóng sẽ cho số thật.

Khuyến nghị kỹ thuật cho J1: ghim **`jev-1.14.0`** (nhỉnh hơn ở lệnh cấm và dự án, nhanh hơn ~30 ms; lưu `model` trả về vào `ai_runs`); state luôn gồm câu trước của trợ lý; hai câu hỏi mỗi lượt (Noul cấm + Choice ý định); ứng viên khớp mã/NCC = top-8 của bộ chấm token hiện có + "khác"; ngưỡng 0,85 / 0,6.

---

## 8. J1 — Jev chạy bóng trong `ai-gateway` (làm 18/10/2026, tối)

Chủ SP OK J0 → J1. **Không đổi hành vi Trợ lý**: mỗi lượt hội thoại, cổng hỏi Jev song song với model chính rồi ghi dự đoán cạnh việc model chính thực làm. Sau 1 tuần đọc số để quyết định J2.

| Phần | Nội dung |
|---|---|
| Kết nối | Cài đặt → Kết nối: loại mới **TypeSafe (Jev · quyết định có kiểu)** (`kind = 'typesafe'`, endpoint `https://api.typesafe.ai`, model `jev-1.14.0`); "Thử kết nối" gửi một câu Noul nhỏ (~0 đồng). Tính năng mới **Trợ lý · điều hướng Jev (chạy bóng)** (`ai.decisions`) — gán kết nối TypeSafe vào đây là bật; để trống là tắt |
| Cổng | `supabase/functions/ai-gateway/jev.ts`: `buildIntentRequest` (câu hỏi đã che SĐT/CCCD + câu trước của trợ lý), 2 câu hỏi `y_dinh` (Choice 7 nhãn) + `cam` (Noul), `askJev` (timeout 4 s), `actualIntentOf` (công cụ `chuan_bi_*` → ý định; từ chối → `khac`; chỉ tra → `tra_cuu`), `decisionLog`. `index.ts` gọi song song, ghi sau khi xong lượt (cả khi lượt lỗi); Jev lỗi chỉ ghi `status = 'error'` |
| Bảng | `ai_decisions` (run_id, user_id, kind `intent_route`, status, model, predicted {intent, confidence, probabilities, cam, tier auto/verify/ask}, actual {intent, tools, refusal}, agree, cam_agree). **Không lưu nội dung câu hỏi.** RLS: chỉ Admin đọc |
| RPC | `ai_decision_log_v1(run_id, p)` (JWT người hỏi, lượt phải của mình, 1 dòng / lượt / loại); `get_ai_decisions_summary_v1(days)` (Admin): lượt, khớp, theo tầng confidence, theo ý định, lệnh cấm, model |
| Trung tâm AI | `get_ai_admin_overview_v1` bỏ kết nối `typesafe` khỏi danh sách model chọn cho người dùng; `providers.ts` từ chối dùng `typesafe` làm model hội thoại (`AI_KIND_UNSUPPORTED`) |
| Báo cáo | `JEV_EVAL_ENV=… node scripts/jev-evals/shadow-report.mjs --days 7` (đọc Cloud, không ghi) |
| Migration | `20261020110000_jev_shadow_route.sql` + smoke `supabase/tests/jev_shadow_route_smoke.sql` (đã chạy rollback trên Cloud 18/10, đạt) |

**Việc Admin cần làm sau khi lên prod**: Cài đặt → Kết nối → Thêm → chọn *TypeSafe (Jev)* → dán khóa (console.typesafe.ai) → Thử kết nối → Lưu → gán vào **Trợ lý · điều hướng Jev (chạy bóng)**. Từ đó mỗi câu hỏi Trợ lý thêm ~250 ms chạy song song (không làm chậm trả lời) và ≈ 0,00002 USD.

**Đọc số sau 1 tuần**: `khớp ý định` tầng `auto` phải ≥ 95 % và lệnh cấm Jev báo ⊇ model chính từ chối thì mới sang **J2** (dùng tầng `auto` để `forceTool`, tầng `ask` để hỏi lại bằng nút; Noul cấm ≥ 0,7 để từ chối sớm).

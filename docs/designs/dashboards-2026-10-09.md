# Bảng điều khiển trong Trung tâm điều hành — 09/10/2026

Trạng thái: **đã nối dữ liệu thật** (RPC `get_center_dashboard_v1`, migration `20261010120000_center_dashboard_v1.sql`), smoke trên Cloud
trong giao dịch rollback đạt. **Chưa commit / PR / lên production.** Frontend lên trước migration thì tab "Bảng điều khiển" tự ẩn
(kiểm quyền lỗi → không hiện tab), không vỡ Trung tâm.

Chủ SP duyệt 09/10: cả 5 câu (bảng theo vị trí, định nghĩa doanh thu / lợi nhuận, ngưỡng chậm / rủi ro), **dùng OpenStreetMap**,
**giá trị HĐ chưa VAT**, **không realtime — chỉ lấy số mới khi bấm Cập nhật**, và yêu cầu tư duy ngược: mỗi chỉ số cần dữ liệu nguồn nào, đã đủ chưa (mục 4).

Số đếm thật 09/10 (`center_dashboard_data_readiness.sql`, chủ SP chạy): 84 dự án, 79 "lập kế hoạch" gần như trống; dữ liệu thật tập trung ~2 dự án.
Chủ SP duyệt 3 sửa đổi theo kết quả đó (đã làm, mục 3–4):
1. Phạm vi bảng: dự án đang thực hiện / tạm dừng / hoàn thành; "lập kế hoạch" chỉ khi đã có HĐ CĐT, Gantt hoặc chi phí (`app_private.cdb_in_scope`).
2. Chưa có chứng từ nào (đợt phải thu CĐT, công nợ NCC, tiền thu / tiền chi) → hiện **"Chưa có dữ liệu"** kèm chỗ cần nhập, không vẽ 0
   (máy chủ trả `finance.records`).
3. Dòng sổ kho không có giá trị → ước tính số lượng × đơn giá (dòng sổ → dự toán vật tư của dự án → giá nhập danh mục), ghi "gồm … ước tính theo đơn giá dự toán".

## 1. Mục tiêu

- Một hệ widget dashboard đặt ở **Trung tâm điều hành**, tab cố định "Bảng điều khiển" cạnh "Hôm nay".
- Bám nội dung, bố cục, style 4 hình mẫu chủ sản phẩm gửi: Quản lý tiến độ đa dự án; Tổng quan dòng tiền, chi phí; Báo cáo nhập / xuất vật tư; Báo cáo thu / chi, công nợ.
- **Mọi con số bấm được**: drill-down (ngăn bên phải, chia theo dự án / tháng, có dòng Tổng) hoặc drill-through (mở màn gốc thành tab trong Trung tâm, không rời trang).
- **Mỗi vị trí công việc chỉ thấy bảng và con số liên quan** — quyết định ở máy chủ, không ẩn bằng giao diện.

## 2. Bốn bảng và các widget

| Bảng | Widget | Bấm vào → |
|---|---|---|
| **Tiến độ dự án** | Dải Ngân sách / Thu / Chi | chia theo dự án → Tài chính dự án |
| | Lọc tình trạng: Quá hạn, Chậm trễ, Rủi ro, Đúng tiến độ, Chưa rõ, Hoàn thành | lọc thẻ dự án |
| | Thẻ dự án: tên, mã, ngày tạo, giám đốc; Bắt đầu / Kết thúc / Thời gian / Tình trạng; vòng giá trị HĐ; thanh tiến độ kế hoạch – thực tế; bản đồ công trường; Ngân sách / Thu / Chi | tên → Dự án; tình trạng, thanh tiến độ → Tiến độ (Gantt); vòng, tiền → Tài chính dự án |
| **Dòng tiền & chi phí** | Khối navy: Giá trị HĐ, Doanh thu, Lợi nhuận, Chi phí | chia theo dự án → Báo cáo tài chính |
| | Tình trạng thi công: Tổng số, Rủi ro, Chậm tiến độ; Kết quả: Phát sinh, Sản lượng thực hiện, Sản lượng nghiệm thu | danh sách dự án tương ứng |
| | Doanh thu – Chi phí 12 tháng (đường); Dòng tiền thu / chi 12 tháng (cột) | bấm tháng → chia theo dự án của tháng đó |
| | Công nợ CĐT; Công nợ nhà thầu & NCC (đề nghị TT, giữ lại, tạm ứng) — gồm VAT | → Phải thu / Phải trả |
| | Danh sách dự án công nợ lớn (Chưa thu / Chưa trả) | dòng → Tài chính dự án / Phải trả |
| | Chi phí thực tế theo nhóm (tròn); Phân bổ chi phí theo dự án (cột chồng) | nhóm / dự án → Chi phí & ngân sách |
| **Vật tư** | Ngân sách vật tư; Đã mua; Còn lại (kèm xu hướng) | chia theo dự án → Vật tư dự án (dự toán); thẻ → Mua hàng |
| | Xu hướng nhập – xuất 12 tháng | bấm tháng → chia theo dự án; thẻ → Tồn kho |
| | Ngân sách vật tư theo dự án (tròn, 5 dự án + Khác) | lát → Vật tư dự án |
| | Top 10 vật tư ngân sách cao nhất (đã mua / còn lại) | dòng → Vật tư dự án |
| | Tồn – nhập – xuất vật tư (10/10, thay bảng Nhu cầu mua – cấp): tên (trên) + mã (dưới), ĐVT, Tổng BOQ, Tồn kho, Tổng nhập, Tổng xuất, Trả lại, Còn lại; 10 dòng/trang, tìm theo tên / mã | số nhập / xuất / trả lại → giao dịch kho (`get_center_material_moves_v1`) → bấm giao dịch mở đúng phiếu (`/operations?tx=`) |
| **Thu chi & công nợ** | Khối navy: Giá trị HĐ (chưa VAT), Doanh thu, Chi phí, Lợi nhuận | chia theo dự án |
| | Cơ cấu dòng thu (gồm VAT): đề nghị TT, giữ lại, tạm ứng còn lại, tạm ứng đã khấu trừ; thu thực tế / CĐT còn nợ | → Phải thu |
| | Dòng thu (Sankey, chưa VAT): Giá trị HĐ → Chưa thực hiện / Doanh thu → Đã thanh toán, Nợ phải thu, Giữ lại, Khấu trừ tạm ứng | từng khối → chia theo dự án |
| | Tuổi nợ: Nợ phải thu / Nợ phải trả — Quá hạn / Trong hạn | → Phải thu / Phải trả |
| | Cơ cấu dòng chi: đồng hồ Thầu phụ, Nhà cung cấp (đã trả / còn nợ) | → Phải trả, Thầu phụ |
| | Dòng chi (Sankey): Nhóm chi phí → Chi phí thực tế → Đã trả / Còn phải trả | từng khối → chia theo dự án |
| | Bảng số liệu theo dự án; Dòng tiền dự án 12 tháng (thu dương, chi âm, đường lũy kế ròng) | dòng / tháng → chi tiết |

Chung cho mọi bảng: chọn dự án (lọc toàn bảng), nút **Cập nhật**, dòng "Số liệu lúc …", nhắc **"n dự án thiếu dữ liệu"** (mục 4),
menu "…" của mỗi thẻ có **Xem bảng số liệu** (thay biểu đồ bằng bảng) và **Mở màn gốc**.

## 3. Định nghĩa chỉ số (chủ SP duyệt 09/10)

| Chỉ số | Định nghĩa |
|---|---|
| Giá trị HĐ | HĐ CĐT **chưa VAT** (không tính HĐ nháp / hủy) + phiếu điều chỉnh CĐT **đã duyệt** (`contract_variations`). Khác Báo cáo Tài chính ở phần phát sinh — Báo cáo chỉ lấy giá trị ký ban đầu |
| Phát sinh | Tổng phiếu điều chỉnh CĐT đã duyệt |
| Doanh thu | Đợt CĐT **đã xác nhận** (tiến độ / quyết toán / khác), chưa VAT — không phải tiền đã thu |
| Chi phí | Chi phí đã ghi nhận (`project_transactions` loại chi, trừ dòng chi tiền NCC) — cùng số với Chi phí & ngân sách; 6 nhóm: vật liệu, nhân công, máy thi công, thầu phụ, quản lý chung, khác |
| Ngân sách | Ngân sách chi phí đã duyệt (vật tư = dự toán vật tư sống) — `finance_project_cost_summary` |
| Lợi nhuận | Doanh thu − Chi phí (lãi gộp tạm tính, chưa phân bổ chi phí chung công ty) |
| Sản lượng thực hiện | Giá trị HĐ × tiến độ thực tế |
| Tiến độ thực tế | Gantt, việc lá, trọng số chi phí/ngày × thời lượng (như module Tài chính) |
| Tiến độ kế hoạch | Cùng trọng số; mỗi việc tính phần kế hoạch phải xong tới hôm nay theo **baseline**; việc chưa chốt baseline dùng ngày kế hoạch hiện tại |
| Tình trạng dự án | Hoàn thành: thực tế 100%. Quá hạn: qua ngày kết thúc mà chưa 100%. Chậm trễ: thực tế kém kế hoạch **≥ 10 điểm %**. Rủi ro: chi vượt ngân sách, hoặc chi > sản lượng thực hiện quá 5%. Chưa rõ: chưa có tiến độ. Còn lại: Đúng tiến độ |
| Thu (tiền CĐT trả) | Tiền đã nhận trên các đợt phải thu (gồm tạm ứng) |
| Công nợ CĐT / NCC | **Số tiền thật, gồm VAT**: phải thu theo đợt đã xác nhận; phải trả theo chứng từ công nợ (không tính đối tác nội bộ). Có `subcontract_id` = thầu phụ, còn lại = NCC. Quá hạn = qua hạn thanh toán |
| Dòng thu (Sankey) | Doanh thu chưa VAT tách theo từng đợt: đã thu / còn nợ / giữ lại / khấu trừ tạm ứng, nhân tỷ lệ chưa VAT ÷ gồm VAT của đợt — cộng lại khớp doanh thu |
| Dòng chi (Sankey) | Còn phải trả = công nợ NCC + thầu phụ (gồm VAT, không vượt chi phí); Đã trả = chi phí − còn phải trả |
| Đã mua (vật tư) | Đơn mua đã chốt (gửi / xác nhận / đang giao / giao một phần / đã giao / đóng), giá trị chưa VAT |
| Nhập / xuất kho | Giá trị trên sổ kho theo dự án (`inventory_ledger_entries`), 12 tháng theo ngày chứng từ |
| Tiền chi (biểu đồ dòng tiền) | Tiền đã chi NCC / thầu phụ qua đợt chi. Chi khác (lương, văn phòng) chỉ có trên Sổ thu chi từ 01/10/2026 — chưa đưa vào để không lệch 12 tháng |

Không biết thì hiện "—", không bao giờ thay bằng 0. Người không được xem tài chính dự án thấy "—" ở mọi con số tiền của dự án đó.

## 4. Tư duy ngược: mỗi chỉ số cần dữ liệu gì, đã đủ chưa

Máy chủ tính sẵn **"dữ liệu còn thiếu"** (`gaps`) cho từng dự án; mỗi bảng hiện nút **"n dự án thiếu dữ liệu"**, bấm ra danh sách, bấm dòng mở đúng màn cần bổ sung.

| Thiếu (`gaps`) | Ảnh hưởng chỉ số | Ai bổ sung, ở đâu |
|---|---|---|
| `dates` ngày bắt đầu / kết thúc | Thời gian, Quá hạn | Dự án (thông tin dự án) hoặc Gantt |
| `director` giám đốc dự án | Thẻ dự án | Dự án |
| `gantt` chưa có kế hoạch | Tiến độ thực tế, Sản lượng thực hiện, Tình trạng = "Chưa rõ" | Dự án → Tiến độ |
| `baseline` chưa chốt baseline | Tiến độ kế hoạch (tạm theo kế hoạch hiện tại) → Chậm trễ | Dự án → Tiến độ, chốt baseline |
| `coords` công trường chưa có tọa độ | Bản đồ | Cài đặt → Địa điểm chấm công |
| `contract` chưa có HĐ CĐT | Giá trị HĐ, Sản lượng, vòng trên thẻ | Tài chính dự án / Hợp đồng |
| `budget` chưa có ngân sách duyệt | Ngân sách, Rủi ro (vượt ngân sách) | Tài chính → Chi phí & ngân sách |
| `unclassified` chi phí chưa xếp khoản mục | So ngân sách theo khoản mục | Tài chính → Chi phí & ngân sách |
| `ar_due` / `ap_due` công nợ chưa có hạn | Quá hạn / Trong hạn (tuổi nợ) | Tài chính → Phải thu / Phải trả |
| `material_budget` / `material_price` chưa có dự toán / đơn giá vật tư | Ngân sách vật tư, Còn lại, Top 10 | Dự án → Vật tư → Dự toán |

Đếm toàn công ty (chỉ đếm, không lấy chứng từ): `supabase/operations/center_dashboard_data_readiness.sql` — cùng quy tắc với `gaps`.
Chế độ tự động của phiên làm việc chặn đọc production nên **chưa có số đếm**; chạy truy vấn này để có bức tranh đủ / thiếu thực tế.

## 5. Vị trí công việc → bảng

| Vị trí (theo quyền sẵn có) | Bảng thấy | Phạm vi |
|---|---|---|
| Admin | cả 4 bảng | mọi dự án, đủ tiền |
| Quản trị Dự án (`system.da.manage`) | Tiến độ dự án (+ Dòng tiền, Thu chi nếu có Tài chính) | mọi dự án; tiền theo công tắc xem tài chính |
| Tài chính — Xem / Ghi nhận / Xác nhận / Quản trị; công tắc xem tài chính mọi dự án | Dòng tiền & chi phí, Thu chi & công nợ, Tiến độ dự án (+ Vật tư nếu có quyền Mua hàng / Kho) | mọi dự án, đủ tiền |
| Mua hàng / Kho (xem hoặc quản trị) | Vật tư | mọi dự án; **không có tiền dự án** |
| Người phụ trách công trường: giám đốc dự án (`projects.manager_id`) hoặc Room có quyền duyệt nhật ký, phân công nhân sự, duyệt đề xuất vật tư | Tiến độ dự án, Vật tư | chỉ dự án mình phụ trách; tiền chỉ khi được bật công tắc xem tài chính |
| Còn lại | **không có tab** | — |

Không thêm loại quyền mới. Tab chỉ hiện sau lần gọi nhẹ `get_center_dashboard_v1(p_access_only => true)`.

## 6. Kiến trúc

- Máy chủ: `public.get_center_dashboard_v1(p_access_only boolean default false)` — SECURITY DEFINER, tự kiểm quyền từng bảng, từng dự án
  (như các RPC Tài chính); dùng lại helper Tài chính (`finance_project_visible`, `finance_project_cost_summary`, `finance_receivable_round_rows`,
  `finance_customer_contract_metrics`, `finance_payable_rows`, `finance_advance_rows`, `finance_project_gantt_progress`). Gỡ: `supabase/operations/center_dashboard_v1_rollback.sql`.
- Tốc độ: Admin, toàn bộ dự án thật, **dưới 1 giây** (smoke có giới hạn 3 giây).
- Giao diện: `components/dashboard/*` (tải lười, chunk riêng, dùng lại chunk biểu đồ), `lib/dashboard/dashboardService.ts` (đọc RPC, giữ số trong bộ nhớ),
  `dashboardModel.ts` (tính, drill, `GAP_META`).
- **Không realtime**: tải khi mở tab lần đầu; đổi tab / rời Trung tâm rồi quay lại không gọi lại; **Cập nhật** mới lấy số mới, trong lúc đó vẫn hiện số cũ;
  cập nhật lỗi thì giữ số cũ và báo "Chưa cập nhật được … Đang hiện số lúc …".
- Bản đồ: OpenStreetMap (chủ SP chọn), ghi nguồn "© OpenStreetMap"; tải lỗi thì nền trung tính + "Mở bản đồ".

## 7. Kiểm thử

- Cloud (rollback): `supabase/tests/center_dashboard_v1_smoke.sql` — 5 vai: Admin (4 bảng, mọi dự án, chi phí = tổng nhóm, < 3 s), Kế toán
  (tiền trước, không có số vật tư), Mua hàng (chỉ Vật tư, không lọt tiền, không có thiếu sót tài chính), giám đốc 1 dự án (chỉ dự án đó, không tiền),
  người chưa có quyền (không bảng); chế độ chỉ kiểm quyền khớp.
- Unit: `dashboardModel.test.ts` (định dạng, tình trạng, cộng dồn, dòng thu khớp doanh thu, dữ liệu còn thiếu theo bảng), `dashboardService.test.ts`
  (đọc dữ liệu máy chủ an toàn, null không thành 0, một lần gọi tới khi Cập nhật).
- E2E (`tests/e2e/center-shell.spec.ts`, máy tính / máy tính bảng / iPhone WebKit): 4 bảng, lọc, drill-down / drill-through, thiếu dữ liệu → màn bổ sung,
  vai trò, không có bảng → không có tab, lỗi tải, không realtime + cập nhật lỗi giữ số cũ; trang đứng yên không chạy animation.

## 8. Đợt 10/10 (chủ SP)

- Mọi màn mở thành tab mới trong Trung tâm (thanh bên, ô tìm kiếm, Hôm nay, Bảng điều khiển, menu avatar): bảng route dùng chung `routes/appPages.tsx`,
  kênh mở `lib/center/centerOpen.ts`, tab tự nạp dữ liệu theo màn (`lib/center/embedData.ts`) và kiểm quyền vào màn.
- Bảng Vật tư: bỏ "Nhu cầu mua – cấp vật tư", thêm bảng tồn – nhập – xuất (migration `20261010130000_center_dashboard_stock.sql`), chủ SP duyệt cách tính 10/10:
  Đã đặt chưa giao (dòng đơn mua chưa nhận, chưa lên đợt giao) · Đang giao (đợt giao chưa nhận xong) · Nhập (vào kho dự án, trừ hàng công trường trả về) ·
  Xuất (ra khỏi kho dự án, trừ trả NCC) · Trả lại = trả nhà cung cấp · Tồn kho = sổ kho · **Còn lại = BOQ − (nhập + đang giao + đã đặt chưa giao − trả lại)**:
  dương (xanh) còn được mua, âm (đỏ) đã đặt / mua vượt BOQ. Mọi số bấm được → chứng từ tạo nên số đó (đơn mua, đợt giao, phiếu kho, phiếu trả NCC,
  dòng dự toán, cách tính Còn lại) → bấm chứng từ mở đúng phiếu (`/operations?tx=`) hoặc đơn (`/procurement?po=`) trong tab mới.
- Co giãn theo màn hình lớn: bỏ giới hạn bề rộng ở Trung tâm, Bảng điều khiển, Office, Vioo Work và các trang có khung cố định; lưới ô Hôm nay 4–5 cột trên màn rộng.
- Không viền trong Trung tâm (nền + bóng nhẹ); số ngày hôm nay trên lịch luôn trắng, nằm trên nền.
- Menu avatar: Thông tin cá nhân, Phiếu lương của tôi, Cài đặt (thanh bên, nếu có quyền), Đăng xuất.
- Hôm nay = các khối: Truy cập nhanh và màn của Bảng điều khiển; xóa được, ↑ ↓ đổi thứ tự, nút "+" thêm khối; lưu trong bố cục người dùng (`blocks`).

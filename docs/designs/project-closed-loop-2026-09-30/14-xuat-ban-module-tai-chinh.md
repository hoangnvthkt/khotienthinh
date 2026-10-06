# Xuất bản Module Tài chính độc lập — tách khỏi Module Dự án (kế hoạch, 05/10/2026)

Yêu cầu chủ SP 05/10: "Chuẩn bị hiện thực việc xuất bản Module Tài chính, không còn để trong Module Dự án."
Tài liệu này kiểm kê hiện trạng (số thật production 05/10), đề xuất cấu trúc sau khi tách, lộ trình và **9 câu hỏi cần chốt trước khi code**.

## 1. Hiện trạng

### 1.1 Module Tài chính (`/finance`)
- Đã là module riêng trên menu (ô "Tài chính", màn chính `FinanceHubView`), nhưng menu bên chỉ có **1 mục** "Tài chính công ty";
  7 phần (Tổng quan · Việc cần làm · Phải thu · Phải trả · Thu chi & quỹ · Chi phí & ngân sách · Quản trị) là tab bên trong, không có đường dẫn riêng.
- Đã làm đủ: công nợ NCC + đề nghị chi + tạm ứng NCC, phải thu CĐT, thu chi & quỹ, chi phí & ngân sách + quỹ dự án, phân bổ tháng, quỹ công trường,
  **thầu phụ (F4, PR này)**.
- Quyền: `system.finance.{view, record, confirm, manage}` phạm vi toàn công ty. **8/89** người đang làm việc có quyền xem.

### 1.2 Phần tài chính còn nằm trong Module Dự án

| Chỗ trong Dự án | Nội dung | Ghi được? | Tương ứng ở Tài chính |
|---|---|---|---|
| Tab **Tài chính** (`ProjectFinanceWorkspace`, 4.188 dòng) — 8 tab con: Tổng quan, Ngân sách, Phải trả, Phải thu, Thanh toán, Bằng chứng nguồn lực, Dòng tiền, Sổ giao dịch | Số tài chính 1 dự án | Chỉ xem từ 04/10, **trừ "chốt sản lượng thực hiện"** | Chi phí & ngân sách → Dự án (chi phí, ngân sách, quỹ); Phải thu; Phải trả; Thu chi. Chưa có: 1 màn gộp "tài chính một dự án", sổ giao dịch theo dự án |
| Tab ẩn Ngân sách / Dòng tiền / Nghiệm thu & Thanh toán | Đường dẫn cũ, tự chuyển vào tab Tài chính | Chỉ xem | như trên |
| Tab **Nhà thầu** (`SubcontractTab`) | Biên bản nghiệm thu kiểu cũ (`acceptance_records`, 0 dòng) | Chỉ xem (PR này) | Phải trả → Thầu phụ |
| Tab **Hợp đồng** → chứng từ thanh toán, lịch thanh toán, tạm ứng, nghiệm thu | HĐ CĐT và HĐ thầu phụ | Chỉ xem (#87 + PR này) | Phải thu / Thầu phụ. Thông tin HĐ + BOQ vẫn thuộc Dự án / Hợp đồng |
| Tab **Báo cáo** (`ReportTab`) | Báo cáo tiến độ, nhật ký (không phải số tài chính) nhưng đang bị gắn cổng "dữ liệu tài chính" | — | Giữ ở Dự án, chỉ sửa cổng quyền |
| Sổ giao dịch → **Import Excel / Thêm giao dịch** | Nhập số MISA (1.068 dòng đã nhập), ghi tay | Đã khóa ở giao diện, **máy chủ chưa chặn** | Chưa có chỗ nhập MISA trong Tài chính |
| Module **Chi phí** (`/expense`, ô riêng trên menu) | Kế hoạch chi phí kiểu cũ | 1 bản ghi | Chi phí & ngân sách |

### 1.3 Ai đang xem tài chính theo dự án mà không có quyền Tài chính
3 người có quyền xem nhạy cảm "tài chính" theo dự án: **Phạm Ngọc Sơn** (CHT SMB), **Nguyễn Chấp Việt** (SMB), **Nguyễn Thị Mơ** (mọi dự án).
Bỏ tab Tài chính khỏi Dự án mà không có chỗ thay thế thì 3 người này mất số liệu → cần quyền "Tài chính — Xem theo dự án" (câu 1).

## 2. Đề xuất sau khi tách

### 2.1 Module Tài chính
- Menu bên 7 mục, mỗi mục một đường dẫn (`/finance/overview`, `/finance/todo`, `/finance/receivables`, `/finance/payables` …), giữ link cũ `?section=`.
  Ẩn mục người dùng không có quyền (VD người chỉ xem theo dự án chỉ thấy "Tài chính dự án").
- Thêm màn **Tài chính dự án** (chọn dự án → 1 trang): Tổng quan (doanh thu, chi phí theo khoản mục, lãi gộp tạm tính, tiến độ), Phải thu, Phải trả
  (NCC + thầu phụ), Dòng tiền / quỹ dự án, Sổ giao dịch. Dùng lại RPC đã có; số chưa chốt đầu kỳ hiện "chưa biết".
- Nhập Excel số MISA chuyển vào Chi phí & ngân sách (chỉ Ghi nhận, chặn trùng theo mốc 01/10).

### 2.2 Module Dự án
- Bỏ tab **Tài chính** và 3 tab ẩn; đường dẫn cũ tự chuyển sang Tài chính → Tài chính dự án (đúng dự án).
- Tab Điều hành giữ **1 thẻ tóm tắt chỉ xem** (thu, chi, lãi gộp tạm tính, còn phải thu / phải trả) + nút "Mở ở Tài chính", chỉ hiện với người có quyền xem tài chính dự án.
- "Chốt sản lượng thực hiện" chuyển về Tiến độ / Chốt tiến độ (câu 3). "Bằng chứng nguồn lực" chuyển về Nhật ký (câu 4).
- Tab Hợp đồng giữ thông tin HĐ, BOQ, file; phần thanh toán chỉ xem như hiện nay.

### 2.3 Quyền và máy chủ
- Quyền mới `system.finance.view` phạm vi dự án ("Tài chính — Xem theo dự án"), cấp tự động cho 3 người đang có quyền xem nhạy cảm "tài chính" của dự án.
- Mẫu phân quyền theo chức vụ: Kế toán viên (xem + ghi nhận), Kế toán trưởng (+ xác nhận), GĐ tài chính (+ quản trị), Chỉ huy / QLDA (xem theo dự án).
- Máy chủ chặn ghi thẳng `project_transactions` ngoài hàm Tài chính (mã `PROJECT_TRANSACTION_FINANCE_ONLY`), như đã làm với công nợ NCC.

## 3. Lộ trình (sau khi chốt câu hỏi)

| Đợt | Nội dung | Kiểm thử |
|---|---|---|
| P1 | Menu 7 mục + đường dẫn riêng; màn Tài chính dự án; quyền xem theo dự án + chuyển 3 người | rollback: người xem theo dự án chỉ thấy dự án được cấp; link cũ |
| P2 | Bỏ tab Tài chính khỏi Dự án, thẻ tóm tắt ở Điều hành, chuyển chốt sản lượng + bằng chứng nguồn lực; chuyển hướng link cũ | walkthrough desktop / điện thoại; test hợp đồng tab Dự án |
| P3 | Nhập MISA ở Tài chính; chặn ghi thẳng `project_transactions`; gộp / ẩn module Chi phí cũ; mẫu phân quyền | rollback: client ghi thẳng bị chặn, hàm Tài chính vẫn ghi được |

Mỗi đợt: mockup trên dữ liệu thật → chủ SP duyệt → code → test rollback → walkthrough → PR → chủ SP deploy.

## 4. Câu hỏi cần chốt (đề xuất phương án a)

1. **Người ở dự án xem số tài chính ở đâu?** (a) Trong module Tài chính, màn "Tài chính dự án" chỉ xem, chỉ thấy dự án được cấp; tự chuyển 3 quyền hiện có (Sơn, Việt — SMB; Mơ — mọi dự án). (b) Giữ tab Tài chính chỉ xem trong Dự án.
2. **Bỏ hẳn tab Tài chính khỏi Dự án?** (a) Bỏ; link cũ tự chuyển sang Tài chính; Điều hành giữ 1 thẻ tóm tắt cho người có quyền.
3. **"Chốt sản lượng thực hiện"** (đang sửa ở tab Tài chính của Dự án): (a) chuyển sang Dự án → Chốt tiến độ (nghiệp vụ kỹ thuật, QLDA làm); (b) chuyển sang Tài chính.
4. **"Bằng chứng nguồn lực"**: (a) chuyển về Dự án → Nhật ký (dữ liệu hiện trường).
5. **Nhập Excel số MISA**: (a) chuyển vào Tài chính → Chi phí & ngân sách, quyền Ghi nhận, chặn trùng theo mốc 01/10.
6. **Module "Chi phí" cũ (`/expense`, 1 bản ghi)**: (a) ẩn khỏi menu, link cũ chuyển sang Tài chính → Chi phí & ngân sách.
7. **Menu Tài chính**: (a) 7 mục con trên menu bên, mỗi mục một đường dẫn; ẩn mục không có quyền.
8. **Chặn ghi tay `project_transactions` ở máy chủ**: (a) làm ở P3 (sau khi đã có chỗ nhập MISA trong Tài chính).
9. **Mẫu phân quyền Tài chính theo chức vụ**: (a) thêm 4 mẫu (Kế toán viên, Kế toán trưởng, GĐ tài chính, Xem theo dự án); anh tự gán ở Cài đặt → Phân quyền.

## 5. Đã làm — P1 (05/10/2026, chủ SP duyệt cả 9 câu phương án a)

- **Quyền xem theo dự án**: dùng lại công tắc "xem tài chính dự án" sẵn có (`project_sensitive_view_grants` domain finance, Admin bật;
  thành viên Room Thanh toán / Nghiệm thu tự được xem) thay vì thêm quyền mới → anh Sơn, anh Việt (SMB), chị Mơ (mọi dự án) tự xem được.
  `app_private.finance_project_visible` = Tài chính — Xem hoặc công tắc của đúng dự án. Người chỉ xem theo dự án không có nút ghi nào.
- **Màn Tài chính dự án** (`components/finance/ProjectFinanceView.tsx`, RPC `get_finance_project_v1`, `get_finance_my_scope_v1`):
  Tổng quan (giá trị HĐ, CĐT đã trả, phải thu, chi phí, sản lượng − chi phí tạm tính, còn phải trả, quỹ dự án, vật tư so với dự toán, cần chú ý,
  biểu đồ theo tháng), Chi phí & ngân sách, Phải thu, Phải trả (NCC + thầu phụ), Sổ giao dịch (tìm, lọc, xuất Excel).
  Mở 3 hàm chi tiết (chi phí dự án, HĐ CĐT, HĐ thầu phụ) cho người xem của đúng dự án.
- **Menu**: 9 mục con, mỗi mục một đường dẫn `/finance/<phần>`; link cũ `?section=` vẫn chạy. `/finance/project` mở cho người đăng nhập
  (máy chủ lọc); người chỉ xem theo dự án thấy riêng màn này. Lối tắt "Tài chính dự án" ở trang Nhân viên; link trong tab Tài chính của Dự án trỏ về đây.
- Kiểm thử rollback `tools/p1-test.mjs` 20/20.

## 6. Đã làm — P2 tách hẳn (05/10/2026, chủ SP chọn "P2 (tách hẳn)")

- Dự án **không còn tab Tài chính** (và 3 tab ẩn Ngân sách / Dòng tiền / Nghiệm thu & Thanh toán). Link cũ `/da/tabs/finance|budget|cashflow|payment`
  tự mở Tài chính → Tài chính dự án đúng phần (ngân sách → Chi phí & ngân sách, thanh toán → Phải thu, sổ → Sổ giao dịch).
- **Chốt sản lượng thực tế** chuyển sang Dự án → Chốt tiến độ (`ActualProductionCard`, dữ liệu và cách lưu giữ nguyên; người sửa: quyền quản lý tab Chốt tiến độ hoặc tab Tài chính cũ).
- **Bằng chứng nguồn lực** chuyển sang Dự án → Nhật ký (mục mở khi cần, không tải sẵn).
- **Báo cáo** (tiến độ, nhật ký) bỏ cổng "dữ liệu tài chính".
- **Điều hành**: thẻ "Tài chính dự án" lấy số từ module Tài chính (RPC `get_finance_project_summary_v1`, trả null với người không được xem → thẻ tự ẩn);
  bỏ 4 ô Đã thu / Đã chi / Sắp thu / Sắp chi 30 ngày, rủi ro thanh toán, đối soát 3 bên, chi phí theo khối lượng, dòng tiền & công nợ, tài chính nâng cao
  (số cũ tính ở trình duyệt, lệch với Tài chính). Giữ tiến độ, hạng mục, cảnh báo, vật tư định mức.
- Admin luôn thấy module Tài chính trên menu (khớp máy chủ).
- Rollback `tools/p2-test.mjs` 6/6. Còn lại P3: nhập Excel số MISA ở Tài chính, chặn ghi tay `project_transactions`, gộp module Chi phí cũ, mẫu phân quyền.

## 7. Đã làm — P3 (05/10/2026, câu 5, 6, 8, 9 phương án a)

- **Nhập số MISA ở Tài chính** (quyền Ghi nhận): nút "Nhập số MISA" ở Chi phí & ngân sách của dự án và ở Sổ giao dịch (Tài chính dự án).
  Đọc file Excel sổ chi tiết MISA (tự tìm dòng tiêu đề, bỏ dòng tổng và khoản thu) → máy chủ kiểm từng dòng (`preview_finance_misa_import_v1`):
  vật tư từ mốc chi phí (Vioo ghi khi nhận hàng), trùng chứng từ đã nhập / trùng trong file, tháng đã khoá sổ, thiếu khoản mục, ngày / số tiền sai.
  Dòng thiếu khoản mục gán một lần cho tất cả hoặc từng dòng; máy chủ kiểm lại. Nhập theo lô (`import_finance_misa_costs_v1`, bảng `finance_misa_import_batches`,
  `source_ref = misa:<lô>:<dòng>`). Kế toán trưởng (quyền Xác nhận) **huỷ cả lô** khi nhập nhầm, cần lý do; các dòng đã xoá lưu đủ trong nhật ký Tài chính.
  944 + 124 dòng đã nhập ở sổ Dự án trước đây hiện là "nhập ở sổ Dự án cũ" (không theo lô).
- **Máy chủ chặn ghi tay sổ giao dịch dự án** (`PROJECT_TRANSACTION_FINANCE_ONLY`): thêm / sửa / xoá thẳng từ trình duyệt bị chặn; ghi qua hàm (Tài chính, Mua hàng, Kho,
  quỹ công trường) vẫn chạy. Ngoại lệ: chốt đầu kỳ vật tư ở Dự án → Vật tư (dòng `opening_balance:<id>:materials` của đúng bản đầu kỳ đã lưu).
  Gỡ nút "+ Giao dịch / Import / Mẫu / Ngân sách" còn sót ở đầu trang Dự án và khối số tài chính cũ không còn dùng.
- **Module Chi phí cũ** (`/expense`, 2 danh mục thử + 1 phiếu chi thử) ẩn khỏi menu, Dock, trang chủ, thanh dưới; link cũ mở Tài chính → Chi phí & ngân sách. Dữ liệu cũ giữ nguyên.
- **Mẫu phân quyền** (Cài đặt → Phân quyền, sửa mẫu không đổi người đã áp): "Kế toán" thêm Tài chính xem + ghi nhận; "Kế toán trưởng / Tài chính" thêm xem + ghi nhận + xác nhận;
  mẫu mới **"Giám đốc tài chính"** = Kế toán trưởng + Quản trị Tài chính (gợi ý cho chức vụ Giám đốc tài chính). "Xem theo dự án" không cần mẫu: dùng công tắc
  "Xem tài chính dự án" ở từng dự án (P1).
- Rollback `tools/p3-test.mjs` 50/50.

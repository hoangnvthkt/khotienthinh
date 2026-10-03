# Module Tài chính và K3 Công nợ NCC (thiết kế 02/10/2026)

Người đọc: chủ sản phẩm (duyệt), agent làm K3a/K3b/K3c.

Tài liệu liên quan:
- `05-kiem-soat-mua-kho-cong-no.md`: lộ trình K1–K5.
- `HANDOFF-K3.md`: hiện trạng.
- `04-mua-hang-hinh-thuc-va-m2.md` mục 4: M2d đơn chủ động.

## 1. Quyết định đã chốt

| # | Quyết định | Ngày |
|---|---|---|
| 1 | Làm **module "Tài chính" riêng** (PA2), nối chặt với Mua hàng, không gộp vào Mua hàng | 02/10 |
| 2 | Module có 6 phần: **Phải trả · Phải thu · Dòng tiền & quỹ · Chi phí & ngân sách · Tổng quan · Thiết lập**. Module "Chi phí" cũ gộp vào ở F5 | 02/10 |
| 3 | Lộ trình **K3a → K3b → K3c → F4 → F5**. Phần nào lên Tài chính thì **khóa chỗ nhập tương ứng ở tab dự án**. Tab Tài chính dự án giữ tạm, có dòng nhắc, rồi thay dần | 02/10 |
| 4 | **Ngày bắt đầu 01/10/2026.** Nợ phát sinh trước Vioo ghi bằng **số dư đầu kỳ**. Chứng từ đã có trong Vioo nhưng đã trả ngoài hệ thống ghi bằng **phiếu chi bổ sung** lùi ngày, có nhãn, bắt buộc số UNC và file đính kèm | 01/10 |
| 5 | **Số dư đầu kỳ phải khớp sổ MISA** (hoặc biên bản đối chiếu với NCC) tại 30/09. **Mốc chi phí theo dự án**: SMB 01/08/2026, DA29 20/08/2026. Sổ thuế vẫn ở MISA; Vioo xuất file sang | 02/10 |
| 6 | Chi tiền qua **3 người khác nhau**: lập đề nghị → duyệt → xác nhận đã chi. Tách nhiệm áp dụng cả Admin | 01/10 |
| 7 | **Ma trận duyệt chi là khung cấu hình.** Admin hoặc **Quản trị Tài chính (gán cho TGĐ)** sửa được người duyệt và mức tiền. Cấu hình ban đầu: ≤ 100 triệu → Kế toán trưởng; > 100 triệu → KTT kiểm tra, Giám đốc tài chính duyệt; **TGĐ có quyền duyệt** (mặc định ở mức ≥ 1 tỷ, sửa được) | 02/10 |
| 8 | Không bắt buộc hóa đơn trước khi chi; mỗi HĐ có thể chọn "bắt buộc hóa đơn". Khớp 3 bên dung sai 0,5% / 50.000đ | 01/10 |
| 9 | Hạn thanh toán lấy theo thứ tự: **HĐ → NCC → mặc định công ty 30 ngày**, tính từ ngày ghi nợ. Không có nguồn hạn thì hiện "Chưa có hạn", không coi là quá hạn | 01/10 |
| 10 | Quyền xem theo **công tắc Xem Tài chính** (Admin bật, theo dự án hoặc tất cả) và Room Thanh toán. Bỏ phụ thuộc quyền dự án kiểu cũ. Mua hàng chỉ xem tình trạng nợ và hạn | 01/10 |

## 2. Hiện trạng dữ liệu (production 02/10)

- **25 chứng từ công nợ đang mở**, 12 NCC, tổng khoảng 1,55 tỷ.
  - 18 chứng từ từ đối soát HĐ (DA29, tháng 9).
  - 7 chứng từ từ nhận hàng PO (SMB 5, DA29 2).
- Chưa có hóa đơn NCC, chưa có đợt chi, chưa khóa kỳ. Không chứng từ nào có hạn thanh toán; chỉ 1/13 HĐ ghi điều khoản thanh toán (bằng chữ).
- Nếu áp hạn 30 ngày từ ngày ghi nợ:
  - Quá hạn: 5 chứng từ, 125 triệu.
  - Đến hạn trong 7 ngày: 9 chứng từ, 525 triệu.
  - Chưa đến hạn: 11 chứng từ, 902 triệu.
  - Phần "quá hạn" có thể đã được trả ngoài hệ thống. Vì vậy **đối chiếu đầu kỳ phải làm trước, rồi mới bật cảnh báo quá hạn**.

**Điểm bất thường cần xử lý trong đối chiếu đầu kỳ:**

1. **18 bảng đối soát HĐ tháng 9** đều do cùng một người (chị Thủy) lập, chốt và ghi công nợ, trước khi luật "khác người chốt" (M2b) có hiệu lực. Đề xuất: khi đối chiếu đầu kỳ, một kế toán khác **soát xét lại** các bảng này. Không sửa chứng từ cũ; người soát xét ghi xác nhận hoặc ghi chứng từ điều chỉnh.
2. **"Công trình RICO" đang được ghi là NCC** (PO-462, 93,8 triệu, nhận vào kho DA29 ngày 17/09). Đây nhiều khả năng là **điều chuyển nội bộ giữa hai công trình** bị ghi thành mua hàng NCC. Không được chi tiền cho "NCC" này. Cách xử lý: ghi chứng từ điều chỉnh để chuyển thành điều chuyển nội bộ, chi phí ghi cho DA29, ghi giảm cho RICO. Cần anh xác nhận.
3. **Bình Phương: chứng từ 1.080 đ** (bảng đối soát DCHD-202609-E63391). Có thể do thiếu đơn giá khi đối soát. Cần điều chỉnh hoặc xác nhận.
4. **Thu chi trước đây đều nhập từ MISA:** SMB tháng 2–7, DA29 tháng 6–8. 947 dòng chi của SMB không gắn với NCC. Không dựng lại được công nợ cũ theo từng NCC, nên phải dùng số dư đầu kỳ.
5. **Nguy cơ tính trùng với tháng 7 của SMB:** MISA đã có 1,48 tỷ (Kết cấu thép 568) và 199 triệu (Phú Đức). Đây đúng là các PO-116/259/143/145 đang chờ đối chiếu nhận hàng. Áp dụng quy tắc ở mục 4.3.

## 3. Module Tài chính: bố cục và điểm nối

**Đường dẫn và menu:**
- Mục "Tài chính" trên menu, đường dẫn `/finance`. Bố cục giống Mua hàng: tiêu đề có icon, các tab phần, dải bước có thể bấm.
- Danh sách nằm bên trái (360–400px), chi tiết bên phải, nút hành động ghim ở đáy.
- Trên điện thoại: xem danh sách trước, chạm để mở chi tiết.

**Phần Phải trả (K3a):**
- Dải bước:
  1. Chờ ghi nợ
  2. Đang nợ (chia quá hạn / đến hạn 7 ngày / chưa đến hạn / chưa có hạn)
  3. Đề nghị chi (K3b)
  4. Chờ chi (K3b)
  5. Đã chi (K3b)
- Danh sách **theo NCC**. Chi tiết NCC nhóm theo **Dự án → HĐ → chứng từ**.

**Điểm nối với Mua hàng và Kho.** Mỗi việc chỉ nhập một lần, ở nơi phát sinh.

| Mua hàng / Kho làm | Tài chính nhận | Chiều ngược |
|---|---|---|
| PO có điều khoản trả trước | Tạm ứng NCC (K3b) | Nhãn "đã tạm ứng" trên PO |
| Kho nhận đợt giao | Công nợ tự sinh (đã có) | Nhãn tình trạng thanh toán trên PO và thẻ NCC |
| Mua hàng chốt đối soát HĐ tháng | Hộp **Chờ ghi nợ**; kế toán ghi, phải khác người chốt | — |
| Đối chiếu nhận hàng ghi sổ lùi ngày | Công nợ lùi ngày, có nhãn "từ đối chiếu" | — |
| Trả hàng NCC, giảm trừ | Ghi giảm công nợ | — |
| Hóa đơn lệch giá (K3c) | Chứng từ điều chỉnh | Cảnh báo cho Mua hàng làm việc với NCC |

**Tab Tài chính trong dự án:**
- Dùng chung màn hình với module Tài chính, khóa sẵn bộ lọc theo dự án.
- Từ K3b, khóa nút "Lập đợt chi" cũ ở tab dự án; từ K3c, khóa "Khớp hóa đơn" cũ. Như vậy không bao giờ có hai nơi chi tiền.

## 4. Nguyên tắc toàn vẹn dữ liệu (bắt buộc cho mọi chứng từ tài chính)

### 4.1 Nguồn gốc rõ ràng
- Mỗi chứng từ công nợ có `source_type` và `source_id` trỏ tới **đúng một** chứng từ gốc: đợt giao, bảng đối soát, phiếu trả NCC, số dư đầu kỳ hoặc điều chỉnh. Có ràng buộc duy nhất `(source_type, source_id)` để không ghi trùng.
- Màn hình luôn có mục **"Nguồn gốc"**, ví dụ:
  - Nhận hàng: PO → đợt giao → phiếu nhập kho → người nhận và thời điểm.
  - Đối soát: HĐ → bảng đối soát → các phiếu giao → người lập, người chốt, người ghi nợ.
- Không có chứng từ "trôi nổi". Số dư đầu kỳ cũng có nguồn: phiên đối chiếu đầu kỳ, số liệu MISA, file biên bản.

### 4.2 Không sửa đè, chỉ ghi thêm
- Chứng từ đã ghi thì không sửa số tiền. Sai thì ghi **chứng từ điều chỉnh** hoặc **phiếu đảo** có lý do. Nhật ký bất biến ghi ai, lúc nào, trước/sau.
- Xác nhận bị thay đổi thì xác nhận cũ mất hiệu lực (giống đối chiếu nhận hàng #39).
- Mỗi thực thể có `row_version` chống ghi đè. Lệnh ghi có khóa idempotency, bấm hai lần không ghi hai lần (G7 đã có).

### 4.3 Mốc và kỳ
- **Mốc công nợ 01/10/2026:**
  - Chứng từ có ngày trước mốc thuộc phạm vi đối chiếu đầu kỳ.
  - Sau khi đã chốt đầu kỳ của một NCC, nếu phát sinh thêm chứng từ có ngày trước mốc (ví dụ đối chiếu tồn đọng ghi lùi), hệ thống **không tự cộng nợ**. Chứng từ đó vào hàng "cần xử lý" để kế toán quyết định: đã nằm trong số dư đầu kỳ thì cấn vào, chưa nằm thì ghi thêm.
- **Mốc chi phí theo dự án** (SMB 01/08, DA29 20/08):
  - Chi phí do Vioo tự sinh mà có ngày trước mốc được gắn nhãn "đã có trong MISA", không cộng vào báo cáo, vẫn giữ để truy vết.
  - Khi nhập file MISA sau mốc, hệ thống bỏ các dòng mua vật tư NCC và báo rõ dòng nào bị bỏ. Có chặn trùng theo số chứng từ.
- **Khóa kỳ** (`finance_accounting_period_locks`): kỳ đã khóa thì không ghi mới, không đảo vào kỳ đó; muốn điều chỉnh thì ghi vào kỳ đang mở.

### 4.4 Luồng ngược và rẽ nhánh
Mọi luồng chuẩn đều có đường quay lại: trả lại, từ chối, hủy, đảo, gỡ gắn. Mỗi đường quay lại bắt buộc lý do, ghi nhật ký và trả dữ liệu về đúng trạng thái trước đó. Xem bảng tình huống ở mục 6.

## 5. K3a: phạm vi chi tiết

1. **Khung module Tài chính:** menu, đường dẫn, tab, phần Phải trả. Dòng nhắc ở tab dự án.
2. **Quyền:**
   - Bộ quyền `finance.*` cấp theo người và mẫu chức vụ.
   - Phạm vi xem dựa vào công tắc Xem Tài chính và Room Thanh toán.
   - Chuyển quy tắc đọc công nợ (`ap_scope_can_view`) sang quyền mới. Gỡ quyền "Xem DA29 kiểu cũ" đã cấp tạm cho kế toán, sau khi kiểm xong.
3. **Hạn thanh toán:**
   - Số ngày trả chậm trên HĐ NCC; mặc định theo NCC; mặc định công ty 30 ngày.
   - Hạn của từng chứng từ được tính và lưu kèm nguồn hạn (HĐ / NCC / mặc định) để truy vết.
   - Sửa hạn thì ghi nhật ký, không sửa đè.
4. **Màn Phải trả NCC toàn công ty:**
   - Ô chỉ số màu, bấm để lọc: phải trả, quá hạn (nhấp nháy), đến hạn 7 ngày, chưa có hạn, chưa đối chiếu đầu kỳ.
   - Thanh công cụ: tìm kiếm nhiều từ, lọc theo dự án / nguồn / hạn, sắp xếp.
   - Danh sách NCC bên trái, chi tiết bên phải.
5. **Đối chiếu đầu kỳ theo NCC × dự án:**
   - Nhập số theo sổ MISA tại 30/09 và đính kèm biên bản đối chiếu NCC (nếu có).
   - Hệ thống hiện số Vioo đang có và phần chênh lệch.
   - Xử lý chênh lệch: MISA cao hơn thì ghi **số dư đầu kỳ**; Vioo cao hơn thì ghi **phiếu chi bổ sung** cho từng chứng từ đã trả.
   - Người lập và người xác nhận phải khác nhau. Có thể đánh dấu soát xét lại các bảng đối soát cũ.
6. **Phiếu chi bổ sung (đã chi ngoài hệ thống):**
   - Ghi lùi ngày theo ngày trả thật, gắn nhãn "Chi ngoài hệ thống".
   - Bắt buộc số UNC/phiếu chi và file đính kèm.
   - Phải có người xác nhận, và người này khác người lập.
7. **Hộp "Chờ ghi nợ":** chuyển panel "Bảng đối soát chờ ghi công nợ" từ tab dự án về module Tài chính.
8. **Ma trận duyệt chi** (Thiết lập):
   - Bảng mức tiền → các bước duyệt → người duyệt và người dự phòng, có ủy quyền tạm thời.
   - Mỗi lần sửa tạo phiên bản mới, ghi nhật ký và báo cho Admin và TGĐ.
   - Ma trận được dựng ở K3a và dùng từ K3b. Đề nghị chi chốt theo phiên bản ma trận tại lúc gửi.

**Dữ liệu dự kiến** (tận dụng G7, thêm bảng mới khi cần):
- **Bảng mới:**
  - `finance_settings`: hạn mặc định, mốc công nợ, mốc chi phí từng dự án.
  - `supplier_payment_terms`: hạn mặc định theo NCC, có hiệu lực từ ngày.
  - `finance_opening_reconciliations` và `…_events`: phiên đối chiếu đầu kỳ, nhật ký bất biến.
  - `finance_approval_matrix_versions` và `…_rules`.
- **Cột mới:**
  - `supplier_contracts.payment_term_days`, `require_invoice_before_payment`.
  - `supplier_payable_documents.due_date_source`.
- **Phiếu chi bổ sung:** dùng `supplier_payment_batches` với `metadata.external = true`, `document_ref` (số UNC) và file đính kèm.

## 6. Bảng tình huống

| # | Tình huống | Xử lý | Ghi chú truy vết |
|---|---|---|---|
| 1 | Trả một phần | Phân bổ vào từng chứng từ (FIFO theo hạn hoặc chọn tay), chứng từ còn nợ phần còn lại | `supplier_payment_allocations` |
| 2 | Tạm ứng / trả trước khi có hàng (K3b) | Chứng từ tạm ứng, cấn trừ vào công nợ khi hàng về. Hủy PO thì phải thu hồi tạm ứng (hiện ở Phải thu từ NCC) | Liên kết PO |
| 3 | Giảm trừ do trả hàng (K2) | Ghi giảm công nợ tự động khi kho xuất trả xong. Nếu đã trả đủ thì thành **NCC nợ lại mình**, cấn vào đơn sau hoặc thu hồi | Phiếu trả NCC |
| 4 | Chiết khấu, thưởng doanh số | Chứng từ điều chỉnh giảm, có duyệt, gắn HĐ | `manual_adjustment` + lý do |
| 5 | Hóa đơn lệch giá hoặc lượng so với nhận hàng (K3c) | Trong dung sai thì cảnh báo; vượt dung sai thì bắt lý do và chứng từ điều chỉnh có duyệt; báo Mua hàng | Khớp 3 bên |
| 6 | Hóa đơn đến trước hàng | Ghi hóa đơn ở trạng thái "chờ hàng", chưa thành công nợ; khớp khi kho nhận | — |
| 7 | Đã trả ngoài hệ thống trước 01/10 | Phiếu chi bổ sung lùi ngày, bắt buộc UNC và file, người xác nhận khác người lập | Nhãn "Chi ngoài hệ thống" |
| 8 | Nợ phát sinh trước Vioo | Số dư đầu kỳ theo NCC × dự án, khớp sổ MISA hoặc biên bản | Phiên đối chiếu đầu kỳ |
| 9 | Trả trùng (một chứng từ chi hai lần) | Chặn ở máy chủ: không chi vượt phần còn nợ (G7 đã có). Trả trùng ngoài hệ thống thì ghi **NCC nợ lại mình** và thu hồi hoặc cấn trừ | Có kiểm tra máy chủ |
| 10 | Chi nhầm NCC, sai số tiền | Phiếu đảo có lý do (không xóa), lập phiếu đúng | Đảo + nhật ký |
| 11 | Một NCC giao cho nhiều dự án | Đề nghị chi theo NCC ở cấp công ty, tự tách phiếu chi theo từng dự án khi xác nhận đã chi | — |
| 12 | VAT | Công nợ ghi theo giá trị gồm VAT như hiện nay. Hóa đơn tách tiền hàng và VAT (K3c). Đợt giao có VAT riêng (M3) | — |
| 13 | Hạn theo HĐ, quá hạn | Ô quá hạn nhấp nháy. Chưa có hạn thì xám, không tính là quá hạn | Nguồn hạn được lưu |
| 14 | Đổi điều khoản HĐ | Chỉ áp cho chứng từ mới. Chứng từ cũ giữ hạn cũ, trừ khi kế toán chọn "tính lại" (có nhật ký) | — |
| 15 | Khóa kỳ | Không ghi mới hay đảo vào kỳ đã khóa; điều chỉnh ghi vào kỳ mở | `finance_period_is_locked` |
| 16 | Công nợ lùi ngày từ đối chiếu nhận hàng | Ghi theo ngày hàng về, có nhãn. Nếu trước mốc mà đầu kỳ đã chốt thì vào hàng "cần xử lý" | Mục 4.3 |
| 17 | Điều chuyển nội bộ bị ghi thành NCC (RICO) | Không cho chi. Chứng từ điều chỉnh chuyển thành điều chuyển nội bộ giữa dự án | Mục 2.2 |
| 18 | Chứng từ số tiền bất thường (1.080 đ) | Cảnh báo "giá trị bất thường" trong đối chiếu đầu kỳ; điều chỉnh có lý do | — |
| 19 | Bảng đối soát cũ cùng người lập và ghi | Soát xét lại trong đối chiếu đầu kỳ bởi người khác | Nhật ký soát xét |
| 20 | Người duyệt chi vắng | Ủy quyền tạm thời có hạn trong ma trận; hết hạn thì tự trả lại | Phiên bản ma trận |
| 21 | Sửa ma trận khi đề nghị đang chờ duyệt | Đề nghị giữ ma trận cũ; chỉ đề nghị mới theo ma trận mới | Phiên bản |
| 22 | Chia nhỏ đề nghị để né ngưỡng duyệt | Cộng dồn các đề nghị cùng NCC trong 7 ngày để xét ngưỡng | — |
| 23 | Đề nghị chi bị từ chối hoặc trả lại | Bắt buộc lý do; chứng từ trở về "Đang nợ"; người lập sửa rồi gửi lại | Nhật ký |
| 24 | Đã duyệt nhưng chưa chi thì cần hủy | Hủy có lý do, chứng từ trở về "Đang nợ" | — |
| 25 | Hủy PO đã duyệt (K4) có công nợ hoặc tạm ứng | Đảo công nợ chưa nhận hàng; tạm ứng thì thu hồi | K4 |

## 7. Bảng phân quyền

| Việc | Xem dự án (công tắc / Room TT) | Kế toán dự án | Kế toán trưởng | GĐ tài chính | TGĐ | Quản trị Tài chính / Admin | Mua hàng |
|---|---|---|---|---|---|---|---|
| Xem công nợ dự án được phép | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Chỉ nợ và hạn |
| Xem toàn công ty | — | Theo công tắc | ✓ | ✓ | ✓ | ✓ | — |
| Ghi công nợ từ đối soát (khác người chốt) | — | ✓ | ✓ | — | — | ✓ | — |
| Nhập đối chiếu đầu kỳ | — | ✓ | ✓ | — | — | ✓ | — |
| Xác nhận đối chiếu đầu kỳ (khác người nhập) | — | ✓ | ✓ | ✓ | — | ✓ | — |
| Phiếu chi bổ sung: lập | — | ✓ | ✓ | — | — | ✓ | — |
| Phiếu chi bổ sung: xác nhận (khác người lập) | — | ✓ | ✓ | ✓ | — | ✓ | — |
| Đề nghị chi: lập (K3b) | — | ✓ | ✓ | — | — | — | — |
| Duyệt chi (K3b) | — | — | Theo ma trận | Theo ma trận | Theo ma trận | — | — |
| Xác nhận đã chi (K3b, khác người lập và người duyệt) | — | ✓ | ✓ | — | — | ✓ | — |
| Sửa hạn thanh toán, điều khoản | — | — | ✓ | ✓ | — | ✓ | — |
| Sửa ma trận duyệt, khóa kỳ, mốc | — | — | — | — | ✓ | ✓ | — |

**Tách nhiệm luôn được máy chủ chặn**, không phụ thuộc cấu hình, kể cả Admin:
- Một người không ký hai bước trên cùng một chứng từ.
- Người nhận hàng hoặc chốt đối soát của lô không duyệt và không xác nhận chi cho lô đó.
- Người lập đối chiếu đầu kỳ không tự xác nhận.

Người kiêm nhiều vai cần chú ý: chị Tâm (ADMIN, thủ kho SMB, kế toán), chị Thủy (thủ kho, Mua hàng — Quản trị, kế toán).

## 8. Lộ trình

| Đợt | Nội dung |
|---|---|
| **K3a** | Mục 5. Mockup: `.superpowers/review/work-plan/k3a.html` (dữ liệu thật 25 chứng từ) |
| K3b | Đề nghị chi → duyệt theo ma trận → xác nhận đã chi; tạm ứng; đảo; khóa "Lập đợt chi" ở tab dự án; Mua hàng thấy tình trạng thanh toán; xuất UNC/phiếu chi sang MISA |
| K3c | Hóa đơn NCC, khớp 3 bên, chứng từ điều chỉnh; xuất chứng từ mua hàng sang MISA |
| F4 | Phải thu CĐT, thanh toán thầu phụ, theo HĐ |
| F5 | Dòng tiền & quỹ, chi phí & ngân sách (gộp module "Chi phí"), Tổng quan, khóa kỳ; bỏ tab cũ |
| Đi kèm | Mua dự trữ Kho Tổng (công nợ cấp công ty, chi phí ghi khi xuất cho dự án); Sổ tiêu hao theo công việc (Đ4); M2c mua nóng + gọi theo HĐ |

## 9. K3a đã làm (02/10/2026)

**Migration** `20261006090000_finance_k3a_payables.sql`. **Giao diện** ở `/finance` (`components/finance/*`, `lib/financeService.ts`).

**Quyền**
- Bộ quyền `system.finance.{view, record, confirm, manage}` theo phạm vi toàn công ty. Admin (vai ADMIN) được làm mọi việc nhưng vẫn bị chặn tự xác nhận việc mình lập.
- Kế toán có quyền Ghi nhận được ghi công nợ từ bảng đối soát HĐ, vẫn phải khác người chốt.

**Hạn thanh toán**
- Có trigger tính hạn khi ghi nợ và khi đổi ngày ghi nợ (ví dụ đối chiếu ghi lùi ngày). Cột `due_date_source` lưu nguồn hạn.
- Đã gán hạn mặc định 30 ngày cho 25 chứng từ đang mở.
- Khai hạn theo NCC hoặc HĐ, có tùy chọn tính lại chứng từ đang mở. Sửa hạn tay có lý do.

**Bảo vệ dữ liệu**
- Ghi thẳng vào bảng `supplier_payable_documents` qua API (không qua `/rpc/`) bị chặn với mã `SUPPLIER_PAYABLE_DIRECT_WRITE`.
- Hàm nghiệp vụ, trigger và migration vẫn ghi bình thường.

**Chi ngoài hệ thống**
- Bắt buộc số UNC, ngày chi thật (không sau hôm nay) và file đính kèm. Chặn trùng số UNC của cùng NCC, chặn chi vượt phần còn nợ, chặn chi cho đơn vị nội bộ.
- Người khác xác nhận thì mới ghi sổ qua engine G7 (sinh dòng tiền ra của dự án). Đảo phải có lý do.

**Đối chiếu đầu kỳ**
- Theo NCC × dự án tại mốc 01/10. Số MISA phải lớn hơn hoặc bằng số Vioo còn nợ trước mốc.
- Phần chênh được ghi thành chứng từ "số dư đầu kỳ" ngày 30/09, không sinh chi phí dự án.
- Không chốt được nếu còn khoản chi hoặc đề xuất hủy đang chờ xác nhận, hoặc số Vioo đã đổi kể từ lúc gửi.
- Đảo được khi số dư đầu kỳ chưa có khoản chi.
- Chứng từ phát sinh sau khi đã chốt mà có ngày trước mốc được gắn cờ `after_opening`.
- Các bảng đối soát do cùng một người lập và ghi nợ phải được tick "Đã soát xét" khi gửi.

**Hủy công nợ**
- Lập đề xuất có lý do, người khác xác nhận. Chỉ hủy được khi chứng từ chưa có khoản chi.
- Đơn vị nội bộ đánh dấu ở bảng `finance_internal_partners`. Đã đánh dấu "Công trình RICO" (PO-462).

**Ma trận duyệt chi**
- Có phiên bản, mỗi lần sửa ghi nhật ký và báo cho Admin và Quản trị Tài chính. Có ủy quyền có thời hạn.
- Cấu hình ban đầu theo mục 1. Ma trận được dùng từ K3b.

**Đã kiểm trên production** (giao dịch rollback, các vai Thủy / Hương / TGĐ / Chung):
- Luồng chuẩn và các nhánh bị chặn: không có quyền, tự xác nhận, thiếu file, ngày sau hôm nay, chi vượt, trùng UNC, đơn vị nội bộ, Vioo cao hơn MISA, gửi trùng phiên đối chiếu, ma trận hở mức.
- Đảo khoản chi, đảo đầu kỳ, hủy RICO (chi phí của DA29 giữ nguyên).
- Khai hạn theo NCC và theo HĐ, ma trận phiên bản 2, ủy quyền rồi thu hồi, nhật ký bất biến.
- Tổng `project_transactions` không đổi sau migration.

**Còn lại ở K3a-2:** mua dự trữ Kho Tổng (công nợ cấp công ty, chi phí ghi khi xuất cho dự án) và mốc chi phí MISA (gắn nhãn chi phí trước mốc, chặn nhập trùng).

## 10. K3a-2: mốc chi phí MISA, chặn nhập trùng, dự trữ Kho Tổng (02/10/2026)

Migration `20261006150000_finance_k3a2_cost_cutover_stock.sql`.

**Mốc chi phí theo dự án** (bảng `finance_project_cost_cutovers`; ban đầu SMB 01/08/2026, DA29 20/08/2026; Admin / Quản trị Tài chính sửa ở Thiết lập)
- Chi phí vật tư Vioo tự sinh từ chứng từ NCC có ngày trước mốc:
  - Số tiền về 0, số gốc lưu ở `project_transactions.misa_overlap_amount`, diễn giải thêm nhãn "[Đã có trong MISA]".
  - Áp cho nhận hàng, trả NCC và ghi nợ từ đối soát HĐ.
  - Không áp cho khoản chi tiền (dòng tiền thật).
- Đổi mốc thì hệ thống tự tính lại cả hai chiều, có nhật ký.
- Trường hợp chính cần chặn: đối chiếu nhận hàng tồn của SMB tháng 7 ghi lùi ngày.

**Nhập file MISA vào sổ giao dịch dự án**
- Chặn dòng vật tư có ngày từ mốc trở đi (`MISA_IMPORT_AFTER_CUTOVER`), và dòng trùng số chứng từ + số tiền + ngày + diễn giải (`MISA_IMPORT_DUPLICATE`).
- Màn xem trước khi nhập đánh đỏ, bỏ chọn sẵn các dòng này và hiện lý do.

**Mua dự trữ Kho Tổng** (đơn chủ động, mục đích "Dự trữ Kho Tổng", `source_mode = proactive_stock`)
- Nhận vào kho loại GENERAL.
- Công nợ NCC ghi **cấp công ty** (`metadata.scope = company`). Ràng buộc "phải gắn dự án" được nới cho trường hợp này, cả với khoản chi.
- **Không** ghi chi phí dự án lúc nhận hàng hoặc trả hàng.

**Chuyển kho giữa hai kho thuộc dự án khác nhau** (gồm Kho Tổng ↔ công trường)
- Khi phiếu chuyển hoàn tất: dự án nhận ghi chi phí bằng giá vốn sổ kho; dự án gửi ghi giảm.
- **Giá vốn chuyển kho (chủ SP 02/10):** lấy theo bình quân gia quyền của kho gửi tại lúc xuất, giống phần mềm kế toán; không dùng đơn giá gõ trên phiếu. Kho đích nhận đúng giá đó, hàng trả về kho gửi cũng vậy. Nguồn giá ghi ở `metadata.priceSource`.
- Chỉ tính chi phí cho phần hàng thực nhận ở kho đích, áp dụng cả với luồng xuất–nhận 2 bước. Hàng mất dọc đường vẫn tính cho dự án gửi.
- **Rủi ro dữ liệu (02/10):** giá trị tồn kho trong Vioo chưa sạch:
  - 43/89 cặp vật tư × kho đang có tồn nhưng giá trị bằng 0.
  - 31 cặp đã hết hàng nhưng còn giá trị, tổng −3,02 tỷ.
  - Phiếu nhập thép CT Xin Hai Vina ghi tổng tiền vào ô đơn giá (409 triệu/cây).
  - Nguyên nhân: phiếu xuất dùng vẫn lấy giá danh mục, không lấy giá bình quân.
  - Cần làm sạch tồn đầu kỳ theo MISA trước khi tin giá bình quân.
- **Chốt chặn (chủ SP duyệt 02/10):** phiếu chuyển không tự ghi chi phí dự án nếu có một trong các trường hợp:
  - giá vốn bằng 0;
  - tồn ở kho gửi chưa sạch;
  - kho gửi chưa có giá trị tồn;
  - giá lệch quá 3 lần so với giá mua gần nhất.
- Những phiếu này hiện ở Tài chính → "Chuyển kho chờ xác nhận giá vốn" và hệ thống báo cho người có quyền Ghi nhận.
  - Số tiền gợi ý = SL × giá mua gần nhất. Sửa khác gợi ý phải ghi lý do; chọn "Không tính" thì cũng phải có lý do.
  - Mỗi lần xác nhận ghi nhật ký `transfer_cost_confirm`.
- **Việc tiếp theo đã duyệt:** làm sạch tồn kho đầu kỳ theo bảng tổng hợp tồn MISA tại 30/09 và chuyển phiếu xuất dùng sang giá bình quân.
- Phiếu chuyển bị hủy thì các dòng này về 0 kèm nhãn "[Phiếu chuyển đã hủy]".
- Dòng có giá vốn bằng 0 được ghi nhật ký `transfer_cost_missing` để xử lý sau.

**Đã kiểm trên production** (rollback):
- Tổng sổ thu chi không đổi.
- Mốc chi phí: về 0, khôi phục khi đổi ngày, về 0 lại.
- Chặn nhập vật tư sau mốc và dòng trùng; chi phí chung vẫn nhập được.
- Chỉ Quản trị Tài chính đổi được mốc.
- Đơn dự trữ: lập → gửi → duyệt → nhận. Công nợ 132.000 đ cấp công ty, không có chi phí dự án, Kho Tổng tăng 100.
- Chuyển 40 sang SMB → SMB +48.000 đ. Trả 10 về Kho Tổng → SMB −12.000 đ. Hủy phiếu → về 0.

## 11. K3a-3: phiếu nhập trực tiếp NCC vào công nợ (02/10/2026)

Migration `20261007090000_finance_k3a3_direct_receipts.sql`. Chủ SP duyệt 02/10, làm trước K3b.

**Vấn đề:** phiếu nhập kho trực tiếp từ NCC / HĐ NCC (màn Nhập kho, không qua PO và không qua phiếu giao HĐ) trước đây **không sinh công nợ, không sinh chi phí dự án**. Có 46 phiếu đã hoàn tất từ 18/07; sau mốc chi phí: DA29 14 phiếu ≈ 5,41 tỷ, SMB 19 phiếu ≈ 909 tr. Ngoài ra 9 phiếu có dòng giá 0, và màn nhập kho chưa có ô VAT.

**Cách làm:**
- Phiếu đã hoàn tất vào Tài chính → **Chờ ghi nợ → Phiếu nhập trực tiếp**, nhóm theo NCC × dự án.
- Kế toán làm 3 việc trước khi ghi công nợ: nhập giá cho dòng giá 0, chọn VAT, ghi số hóa đơn nếu có.
- Mỗi phiếu thành 1 chứng từ công nợ (`direct_supplier_receipt`, giá trị đã gồm VAT). Hạn thanh toán tính theo HĐ → NCC → mặc định.
- Chi phí dự án ghi cùng lúc, qua trigger ghi nhận dùng chung với đối soát HĐ:
  - Phiếu trước mốc MISA: chi phí về 0, chỉ ghi nợ.
  - Kho không thuộc dự án: công nợ ở cấp công ty, không ghi chi phí.
- Giá kế toán nhập vào được ghi ngược về phiếu kho, sổ kho và giá trị tồn, có truy vết `priceSetBy`.
- **Chặn ở máy chủ:**
  - Người lập / người duyệt phiếu nhập không tự ghi nợ.
  - Bắt buộc VAT và giá.
  - Phiếu nghi trùng (cùng NCC, ngày, số tiền) phải tích "đã đối chiếu với kho".
- **Trả lại kho** bắt buộc lý do, gửi thông báo cho người lập. Phiếu quay lại hộp khi kho sửa phiếu.
- **Kho hủy phiếu đã ghi nợ:** nếu chưa có khoản chi thì công nợ hủy, chi phí về 0. Nếu đã có khoản chi thì chặn hủy.
- **Màn Nhập kho:** thêm ô **Thuế VAT** (bắt buộc) và **đơn giá bắt buộc** cho mọi dòng. Giá cao hơn 20 lần giá danh mục thì bị chặn, để tránh lỗi nhập giá theo tấn vào ô giá theo kg như phiếu thép XHV.
- **Ma trận duyệt v2:** thêm GĐ tài chính (Chuẩn) làm người dự phòng ở bước Kế toán trưởng, vì người lập không tự duyệt được.

**Đã kiểm trên production (rollback, `tools/k3a3-test.mjs`):**
- Danh sách 46 phiếu: 9 thiếu giá, 4 nghi trùng, 12 trước mốc.
- NAZ 31/08 với VAT 8% → công nợ 262,5 tr, chi phí DA29 262,5 tr. NAZ 19/08 (trước mốc) → công nợ 93,8 tr, chi phí 0.
- Đông Hà Nội giá 0 → bị chặn. Nhập 2.500 đ → sổ kho cập nhật, công nợ 1,65 tr.
- Phiếu nghi trùng bị chặn cho tới khi xác nhận. Thủy tự lập thì không tự ghi nợ được. Trả lại kho có thông báo.
- Kho hủy phiếu → công nợ hủy, chi phí 0.
- Tổng sổ thu chi và số chứng từ công nợ không đổi khi áp migration.

## 12. K3b: đề nghị chi → duyệt theo ma trận → xác nhận đã chi (02/10/2026)

Migration `20261008090000_finance_k3b_payment_requests.sql`. Mockup đã duyệt: `.superpowers/review/work-plan/k3b.html`.

**Dữ liệu:**
- `finance_payment_requests`: đề nghị chi theo NCC, cấp công ty. Lưu luồng duyệt đã chốt (`route`), ngưỡng xét duyệt và thông tin đã chi.
- `finance_payment_request_lines`: chứng từ và số chi từng chứng từ.
- `finance_payment_request_steps`: nhật ký bất biến (gửi, duyệt, trả lại, từ chối, rút, hủy, đã chi, đảo).

**Luật (máy chủ chặn):**
- **Số chi** không vượt phần còn nợ, sau khi trừ khoản chi ngoài đang chờ xác nhận và phần đã nằm trong đề nghị khác chưa xong. Chi một phần được.
- **Hình thức chi:** chuyển khoản cần số tài khoản NCC. Đơn vị nội bộ không chi tiền.
- **Luồng duyệt** lấy theo ma trận hiện hành và **chốt lúc gửi**.
  - Ngưỡng tính theo số tiền **cộng dồn các đề nghị cùng NCC trong 7 ngày**.
  - Người duyệt hợp lệ là người trong danh sách hoặc người được ủy quyền, trừ người lập và trừ người đã nhận hàng / lập-chốt đối soát / lập-duyệt phiếu nhập của chứng từ.
  - Nếu một bước không còn ai hợp lệ thì không cho gửi.
- **Một người không duyệt hai bước.**
- **Trả lại:** bắt buộc lý do. Người lập sửa rồi gửi lại, luồng duyệt chạy lại từ đầu.
- **Từ chối:** kết thúc đề nghị. Người lập có thể rút khi chưa duyệt xong. Hủy đề nghị đã duyệt bắt buộc lý do.
- **Xác nhận đã chi:**
  - Người xác nhận phải khác người lập, người duyệt và người xử lý chứng từ.
  - Bắt buộc ngày chi (không sau hôm nay), số UNC (không trùng theo NCC) và file UNC.
  - Phiếu chi được tách theo dự án (`supplier_payment_batches`, `metadata.kind = payment_request`) và ghi sổ qua engine G7: giảm công nợ, ghi dòng tiền ra của dự án. Chi phí dự án không đổi, vì báo cáo đã tách dòng chi tiền khỏi dòng chi phí.
- **Đảo phiếu chi:** bắt buộc lý do, đảo qua engine G7, công nợ trở lại Đang nợ.
- **Thông báo:** người duyệt bước kế tiếp, người lập (khi bị trả lại / từ chối / đã duyệt / đã chi / bị đảo), và người có quyền Xác nhận khi đề nghị đã duyệt đủ.

**Giao diện:**
- Chi tiết NCC có nút **Lập đề nghị chi**. Hệ thống gợi ý sẵn chứng từ quá hạn và đến hạn trong 7 ngày, và cho xem trước luồng duyệt trước khi gửi.
- Bước 3 **Đề nghị chi**, 4 **Chờ chi**, 5 **Đã chi** đã mở. Có huy hiệu "Chờ bạn duyệt" và "Bạn chi được".
- Tab Tài chính của dự án: nút "Tạo đợt thanh toán" và "Thanh toán NCC" chuyển sang mở module Tài chính, không còn hai nơi chi tiền.

**Đã kiểm trên production (rollback, `tools/k3b-test.mjs`):**
- Chặn: NCC chưa có số tài khoản; số chi vượt phần đã nằm trong đề nghị khác; người lập tự duyệt; người đã duyệt tự xác nhận chi; người lập tự xác nhận chi; người đã chốt đối soát xác nhận chi; thiếu file UNC.
- Đông Hà Nội 62,3 tr: chị Hương duyệt, chị Tâm chi → công nợ về 0 và có dòng tiền ra SMB. Đảo → công nợ trở lại 62,3 tr.
- Xây dựng & Vận tải 322,7 tr (2 bước): anh Chuẩn duyệt bước 1 nhưng không duyệt được bước 2. Admin Hoàng trả lại (không ghi lý do thì bị chặn). Gửi lại 2 chứng từ → chị Hương, rồi Admin Hoàng duyệt → hủy có lý do. Nhật ký đủ 7 bước.

**Còn lại (K3b-2):** tạm ứng NCC theo PO; xuất UNC / phiếu chi sang MISA; Mua hàng thấy tình trạng thanh toán trên PO.

## 13. K3b-2: Mua hàng thấy tình trạng thanh toán PO (02/10/2026)

Migration `20261008133100_finance_k3b2_po_payment_status.sql`, RPC `get_procurement_po_payment_status_v1`.
- **Nguồn số liệu:** mỗi PO tổng hợp từ công nợ sinh lúc kho nhận hàng (gồm cả đối chiếu lùi ngày). Gồm: đã ghi nợ (trừ giảm trừ), đã chi, còn nợ, đang trong đề nghị chi, hạn gần nhất, quá hạn hay chưa.
- **Trạng thái:** Chưa thanh toán / TT một phần / Đã thanh toán, có nhãn "quá hạn" nhấp nháy.
  - PO chưa phát sinh nợ trong Vioo (chưa nhận hàng, hoặc nhận từ trước khi có công nợ tự sinh) thì **không hiện nhãn**, không coi là 0.
- **Quyền xem:** người xem Mua hàng đọc được, đúng nguyên tắc "Mua hàng chỉ xem nợ + hạn". Không hiện UNC hay người chi.
- **Nơi hiện:**
  - Danh sách đơn hàng: nhãn trạng thái thanh toán.
  - Chi tiết PO: mục "Thanh toán NCC" và nút "Xem ở Tài chính".

**Còn chờ chủ SP quyết:** tạm ứng NCC theo PO; mẫu xuất phiếu chi / UNC sang MISA.

## 14. Kiện toàn đợt 1: Tổng quan, Sức khỏe dự án, Việc cần làm (03/10/2026)

Chủ SP duyệt mockup `fn-v1` và 5 câu. Migration `20261008133900_finance_overview.sql`, RPC `get_finance_overview_v1`.

- **Khung tab:** Tổng quan · Việc cần làm · Phải thu · Phải trả · Thu chi & quỹ · Chi phí & ngân sách · Thiết lập (Phải thu, Thu chi & quỹ, Chi phí & ngân sách ở đợt sau). Mở `/finance` không chỉ định phần: Tài chính — Quản trị / Admin vào **Tổng quan**, kế toán vào **Việc cần làm**.
- **Tổng quan** (chỉ Tài chính — Quản trị / Admin): dải số lớn (đã thu, chi phí, thu − chi, phải trả NCC), số phụ (giá trị HĐ, còn phải thu, tạm ứng CĐT, sản lượng ước tính), "Cần Ban giám đốc chú ý", dòng tiền theo tháng, cơ cấu chi phí, bảng sức khỏe từng dự án; lọc kỳ (lũy kế / năm / quý / tháng) và dự án.
- **Sức khỏe dự án:** HĐ → sản lượng ước tính → nghiệm thu → đã thu → chi phí; thu chi theo tháng; chi phí theo khoản mục so với dự toán; phải thu CĐT theo đợt; phải trả NCC.
- **Nguồn số:** HĐ = HĐ chủ đầu tư; tiến độ = Gantt có trọng số (như màn dự án); sản lượng = tiến độ × HĐ, nhãn "ước tính" cho tới khi có nghiệm thu; đã thu = giao dịch thu; chi phí = giao dịch chi phí trừ dòng ghi sổ chi tiền NCC; phải trả = chứng từ công nợ còn nợ (trừ đơn vị nội bộ). Số chưa có nguồn hiện "Chưa có dữ liệu".
- **Đánh giá dự án:** Rủi ro (chi phí vượt số đã thu); Cần chú ý (chi phí % HĐ > tiến độ + 10, vật tư % dự toán > tiến độ + 15, nợ quá hạn ≥ 50 tr); Ổn định; Chưa phát sinh.
- **Việc cần làm:** đầu kỳ NCC, phiếu nhập trực tiếp chờ ghi nợ, bảng đối soát chờ ghi nợ, nợ quá hạn / đến hạn, đề nghị chi đang duyệt / chờ chi, chuyển kho chờ giá vốn, chứng từ cần soát xét — bấm mở đúng chỗ ở Phải trả.
- **Câu 5 (tiến độ trùng):** 17 dòng `project_finances` của SMB là lịch sử mỗi lần cập nhật (15% → 40%), chỉ là nguồn dự phòng khi không có Gantt. Tổng quan dùng Gantt (SMB 82%, DA29 7%) nên không sửa dữ liệu.

## 15. Tạm ứng NCC + Quản trị Tài chính (03/10/2026)

Chủ SP duyệt mockup `fa-v1` và 6 câu (03/10): tạm ứng gắn PO hoặc HĐ nguyên tắc; không chặn theo %, vượt ngưỡng thì duyệt thêm;
trừ hết vào các đợt giao đầu; cấn trừ tự động, kế toán hoàn tác được; dùng chung ma trận + luật 3 người của đề nghị chi;
quá hạn hoàn ứng thì cảnh báo ở Việc cần làm / Tổng quan. Chủ SP yêu cầu thêm phần **Quản trị** để cài thông số, trách nhiệm, ràng buộc.

Migration `20261008134000_finance_supplier_advances.sql`.

**Mô hình**
- Đề nghị tạm ứng = `finance_payment_requests.kind = 'advance'` (mã `TU-YYMM-NNN`), không có dòng chứng từ; gắn `purchase_order_id`
  hoặc `supplier_contract_id` + `project_id` (null = Kho Tổng, cấp công ty), `advance_base` (giá trị đơn gồm VAT / giá trị HĐ),
  `advance_percent`, `repay_due_date`. Duyệt, trả lại, rút, hủy dùng nguyên `decide_finance_payment_request_v1`.
- Xác nhận đã chi (`confirm_finance_payment_request_v1` → `finance_confirm_advance`): một `supplier_payment_batches` trạng thái
  `paid`, `metadata.kind = 'advance'`, không phân bổ; dòng tiền ra `project_transactions` source_ref `supplier_payment_batch:<id>`
  (như mọi khoản chi NCC — tiền thật, không phải chi phí).
- Cấn trừ = phân bổ của chính phiếu chi tạm ứng vào chứng từ công nợ (`supplier_payment_allocations`), mỗi lần ghi
  `supplier_advance_offsets` (tự động / tay, trả lại một phần / toàn bộ, lý do). Số dư tạm ứng = đã chi − đang cấn trừ − NCC đã hoàn.
- Trigger trên `supplier_payable_documents`: chứng từ mở lần đầu (nhận hàng PO, chốt đối soát HĐ) → trừ tạm ứng cùng NCC, cùng dự án,
  cùng PO / HĐ (chi trước trừ trước); lỗi không chặn kho, ghi `advance_offset_failed`. Giảm trừ tăng (trả hàng) làm vượt phần đã trả,
  hoặc chứng từ hủy / đảo → trả lại phần cấn trừ.
- `supplier_advance_adjustments`: NCC hoàn tiền (giấy báo có + file; dòng tiền ra âm `…:refund:<id>`, đảo được) và chuyển sang PO
  khác cùng NCC, cùng dự án — người khác người lập xác nhận. Đảo phiếu chi tạm ứng chỉ khi chưa cấn trừ / chưa có phiếu hoàn.
- Trạng thái hiển thị: đang duyệt · chờ chi · còn tạm ứng (quá hạn khi qua hạn hoàn ứng) · chờ hoàn (đơn giao đủ / kết thúc / hủy,
  HĐ đóng) · đã cấn trừ hết · đã đảo.

**Quản trị** (`finance_settings`): ngưỡng cảnh báo (30%), ngưỡng duyệt thêm (50%), người duyệt vượt ngưỡng (mặc định TGĐ),
số ngày cộng vào hạn hoàn ứng (0). `get_finance_settings_v1` trả thêm `responsibilities` (ai giữ Xem / Ghi nhận / Xác nhận / Quản trị).
Màn Quản trị chia 4 mục: Thông số chung · Duyệt chi & ủy quyền · Tạm ứng NCC · Trách nhiệm & ràng buộc.

**Màn hình**: Phải trả → thẻ "Tạm ứng NCC" (còn lại, quá hạn hoàn ứng, chờ hoàn, đang duyệt; chi tiết cấn trừ / hoàn / chuyển);
chi tiết NCC có "Tạm ứng còn lại · Phải trả ròng" và nút Lập tạm ứng; Đề nghị chi hiện đề nghị tạm ứng (đơn / HĐ, %, hạn hoàn ứng);
Việc cần làm + Tổng quan có tạm ứng quá hạn / chờ hoàn; Mua hàng thấy "Đã tạm ứng" trên PO (không lộ UNC, người chi).

**Kiểm thử** rollback trên production (`tools/adv-test.mjs`, `adv-test2.mjs`): lập–duyệt–chi PO-429 30%, nhận hàng tự cấn,
trả hàng 100tr trả lại tạm ứng, hoàn tác / cấn tay, NCC hoàn 20tr, chặn tự duyệt / tự xác nhận / vượt giá trị đơn / hạn quá khứ /
chuyển khác dự án / đảo khi còn cấn trừ; chuyển PO-116 → PO-259, chứng từ hủy trả lại tạm ứng, đảo phiếu thu hoàn rồi đảo phiếu chi;
tạm ứng theo HĐ tự cấn khi chốt đối soát.

## 16. Tài chính đợt 2 — Phải thu chủ đầu tư (03/10/2026)

Chủ SP duyệt mockup `rc-v1` + 8 câu (03/10): đợt nhập số tổng theo hồ sơ (không bắt buộc BOQ); thành phải thu khi CĐT xác nhận,
hạn = xác nhận + số ngày HĐ (mặc định 30); kế toán lập đợt và ghi thu, người khác xác nhận phiếu thu; khai % thu hồi tạm ứng,
% giữ lại, tháng bảo hành, số ngày thanh toán trên HĐ (sửa từng đợt phải có lý do); đối chiếu đầu kỳ MISA 30/09; bảo lãnh có hạn,
nhắc trước 30 ngày; phần CĐT ở Dự án → Hợp đồng chỉ xem; khoản thu ghi tay đưa vào "cần soát xét".

Migration `20261008134100_finance_customer_receivables.sql`.

**Mô hình**
- `finance_receivable_rounds` (đợt thu): loại (tạm ứng / nghiệm thu / quyết toán / trả giữ lại / khác / số dư đầu kỳ), giá trị trước VAT,
  VAT, gộp, thu hồi tạm ứng, giữ lại, `receivable` (cột tính), gợi ý + lý do khi khác; trạng thái nháp → đã gửi CĐT → CĐT xác nhận
  (lưu số gửi nếu CĐT duyệt khác) → hủy; hóa đơn; hạn thu. 6 dòng lịch thanh toán cũ chuyển thành đợt "từ lịch cũ" (đã thu đủ,
  chưa tách thu hồi / giữ lại).
- `finance_customer_receipts` + `_allocations`: phiếu thu (giấy báo có + file) trừ vào các đợt; xác nhận (người khác) ghi
  `project_transactions` revenue_received `finance_customer_receipt:<id>`; đảo ghi dòng âm `:reversal`. Phần chưa trừ = CĐT trả trước,
  trừ vào đợt sau (`kind = prepayment`).
- `finance_customer_openings`: đầu kỳ (phải thu còn lại, tạm ứng chưa thu hồi, giữ lại) — chốt sinh đợt "Số dư đầu kỳ" (số thứ tự 0).
- `customer_contracts`: `advance_recovery_percent`, `retention_percent`, `payment_term_days` (+ `warranty_months` có sẵn) — Quản trị Tài chính khai.
- Đợt thu đồng bộ sang `payment_schedules` (id `fr-<round>`) để Dự án / Tổng quan vẫn đọc đúng; trigger chặn ghi lịch thanh toán và
  chứng từ thanh toán của HĐ CĐT ngoài hàm Tài chính (`CUSTOMER_RECEIVABLE_FINANCE_ONLY`).
- Chỉ số HĐ: giá trị gồm VAT, sản lượng ước tính (Gantt), đã đề nghị, đã thu, phải thu, quá hạn, sản lượng chưa đề nghị,
  tạm ứng còn thu hồi (từ đầu kỳ nếu đã chốt), giữ lại, trả trước.

**Màn hình**: Tài chính → Phải thu (5 số lớn, Cần chú ý, danh sách HĐ với thanh đã thu / đã đề nghị / sản lượng); chi tiết HĐ
(đợt thu, phiếu thu, tạm ứng CĐT, giữ lại, bảo lãnh, đầu kỳ, lịch sử); Việc cần làm (quá hạn thu, phiếu thu chờ xác nhận, đợt gửi
quá 15 ngày, đầu kỳ, bảo lãnh); Tổng quan (phải thu quá hạn, sản lượng chưa đề nghị); Dự án → Hợp đồng (phần CĐT) chỉ xem.

**Kiểm thử** rollback (`tools/rcv-test.mjs`): gợi ý SMB 31,26% / 5%, sửa không lý do bị chặn, gửi → CĐT duyệt 26 tỷ (thấp hơn 27 tỷ,
có lý do) → hạn +30 ngày → hóa đơn → phiếu thu 10 tỷ (8 tỷ vào đợt, 2 tỷ trả trước) → tự xác nhận bị chặn → Hương xác nhận (dòng tiền
vào) → trừ trả trước → hủy đợt đã thu bị chặn → đảo phiếu thu; đầu kỳ DA29/SMB (tự chốt bị chặn); bảo lãnh thiếu hạn bị chặn;
Dự án sửa thẳng lịch thanh toán CĐT bị chặn, lịch NCC/thầu phụ vẫn sửa được; Tổng quan có phải thu; người không quyền bị chặn.

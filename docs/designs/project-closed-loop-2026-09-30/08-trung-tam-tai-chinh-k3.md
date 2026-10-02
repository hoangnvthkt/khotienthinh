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
- Phiếu chuyển bị hủy thì các dòng này về 0 kèm nhãn "[Phiếu chuyển đã hủy]".
- Dòng có giá vốn bằng 0 được ghi nhật ký `transfer_cost_missing` để xử lý sau.

**Đã kiểm trên production** (rollback):
- Tổng sổ thu chi không đổi.
- Mốc chi phí: về 0, khôi phục khi đổi ngày, về 0 lại.
- Chặn nhập vật tư sau mốc và dòng trùng; chi phí chung vẫn nhập được.
- Chỉ Quản trị Tài chính đổi được mốc.
- Đơn dự trữ: lập → gửi → duyệt → nhận. Công nợ 132.000 đ cấp công ty, không có chi phí dự án, Kho Tổng tăng 100.
- Chuyển 40 sang SMB → SMB +48.000 đ. Trả 10 về Kho Tổng → SMB −12.000 đ. Hủy phiếu → về 0.

# K5 — Kiểm kê kho có duyệt

Ngày: 30/09/2026. Dựng trên bảng `wms_inventory_counts` và `wms_inventory_count_lines` của G6: đã có trên production, chưa từng dùng.

## 1. Vì sao làm lại luồng

Hai công cụ hiện có đều thiếu kiểm soát.

**Trang "Kiểm kê" cũ (`/audit`)**
- Một người đếm, bấm lưu là tạo phiếu điều chỉnh ngay. Không có người duyệt.
- So với tồn trên danh mục vật tư (`stock_by_warehouse`), không so với sổ kho.
- Chênh lệch không có giá trị.

**RPC G6**
- Người đếm tự ghi sổ.
- Không có bước từ chối hay hủy phiên.
- Giá trị điều chỉnh bằng 0.
- Bị chặn khi tồn danh mục lệch sổ kho. Kho Sơn Miền Bắc đang có 11 vật tư lệch:
  - 4 dòng thép lệch do làm tròn;
  - 7 dòng lệch 0,36–6,5 đơn vị (Base B, bê tông, cát…).

## 2. Luồng mới

1. **Lập phiên kiểm** (thủ kho của kho, hoặc quản trị kho):
   - Chọn kho, lý do, và toàn bộ hoặc một số vật tư.
   - Hệ thống **chụp tồn sổ kho** tại thời điểm đó, kèm tồn danh mục để truy vết độ lệch cũ.
   - Nếu kho còn phiếu treo hoặc đợt giao chưa đối chiếu, hệ thống cảnh báo.
2. **Đếm** (một hoặc nhiều người, lưu dần):
   - Mặc định **đếm mù**: người đếm không thấy số trên sổ, để tránh "đếm cho khớp".
   - Hàng có thật nhưng không có trên sổ: thêm dòng.
3. **Nộp duyệt:**
   - Mọi dòng phải có số đếm.
   - Hệ thống chốt chênh lệch = số đếm − tồn sổ **tại lúc nộp**. Tồn sổ lúc nộp gồm cả hàng nhập, xuất trong lúc đang đếm.
   - Mỗi dòng chênh bắt buộc có nguyên nhân.
4. **Duyệt:** người duyệt là Admin hoặc quản trị kho, và **khác người lập, khác người nộp**.
   - **Duyệt** thì ghi sổ:
     - Dòng thiếu do "đã dùng cho thi công, chưa lập phiếu xuất" tạo **phiếu xuất dùng** vào chi phí dự án. Đây không phải hao hụt.
     - Các chênh lệch còn lại tạo **phiếu điều chỉnh**, giá trị theo **đơn giá bình quân** hiện tại.
     - Sau đó đồng bộ tồn danh mục bằng tồn sổ kho, xóa các độ lệch cũ.
   - **Từ chối** (kèm lý do) thì phiên quay về đang đếm.
5. **Hủy phiên** (kèm lý do): người lập hoặc người duyệt; chỉ khi chưa ghi sổ.

Mọi thao tác ghi vào nhật ký không sửa, không xóa được.

## 3. Phân cấp quyền

| Bậc | Ai | Được làm |
|---|---|---|
| Xem | Thủ kho của kho, quản trị kho, Admin | Xem phiên và kết quả. Đang đếm mù thì không thấy số sổ. |
| Đếm | Thủ kho của kho, quản trị kho, Admin | Lập phiên, nhập số đếm, thêm dòng, nộp, hủy phiên mình lập |
| Duyệt | Admin, quản trị kho | Duyệt ghi sổ hoặc từ chối. Không duyệt phiên mình lập hoặc nộp. |

## 4. Bảng tình huống

| Tình huống | Xử lý |
|---|---|
| Khớp sổ | Không tạo phiếu; phiên ghi nhận "khớp". |
| Thiếu: hao hụt, hư hỏng, mất, hết hạn, sai đo lường | Phiếu điều chỉnh giảm, giá bình quân. |
| Thiếu: đã dùng thi công, chưa lập phiếu xuất | Phiếu xuất dùng vào dự án (chi phí công trình). |
| Dư: hàng về chưa nhập sổ | Phiếu điều chỉnh tăng, kèm cảnh báo: nếu là hàng NCC giao thì nhận qua đợt giao hoặc đối chiếu để ghi công nợ. |
| Dư: công trường trả về chưa lập phiếu, ghi sổ sai trước đây | Phiếu điều chỉnh tăng. |
| Có nhập, xuất trong lúc đang đếm | Chênh lệch tính theo tồn sổ lúc nộp, nên không đếm trùng hay sót. |
| Có nhập, xuất sau khi nộp, trước khi duyệt | Chênh lệch đã chốt lúc nộp; ghi sổ cộng hoặc trừ đúng số chênh. |
| Duyệt làm tồn âm (đã xuất sau khi nộp) | Bị chặn bởi luật tồn âm K1; báo rõ để kiểm lại. |
| Tồn danh mục lệch sổ kho | Không chặn; ghi lại độ lệch cũ; sau khi ghi sổ, đồng bộ theo sổ kho. |
| Người đếm tự duyệt | Chặn. |

## 5. Cần chủ sản phẩm xác nhận (đang để mặc định)

1. Người duyệt kiểm kê là **Admin hoặc quản trị kho**. Anh có muốn thêm chỉ huy trưởng hoặc kế toán không?
2. **Đếm mù** bật mặc định: người đếm không thấy số trên sổ.

# Kiểm soát mua hàng – kho – công nợ – thanh toán (01/10/2026)

Góc nhìn kế toán, thủ kho và giám đốc tài chính. Số liệu lấy từ production ngày 01/10/2026.

## 1. Năm nguyên tắc kiểm soát

1. **Mỗi biến động có một chứng từ.** Tồn kho, công nợ và tiền chỉ thay đổi qua phiếu (nhập, xuất, trả NCC, đối soát, thanh toán). Không sửa số trực tiếp.
2. **Tách người.** Người lập đơn ≠ người duyệt đơn ≠ người nhận hàng (thủ kho) ≠ người ghi công nợ (kế toán) ≠ người duyệt chi. Một người không đi hết vòng từ lập đơn tới chi tiền.
3. **Đối chiếu 3 bên trước khi trả tiền.** Đơn hàng (giá, SL đặt) – phiếu nhập kho (SL thực nhận) – hóa đơn NCC. Chỉ trả theo phần đã nhận đúng giá.
4. **Không xóa sau khi đã phát sinh.** Nháp thì xóa được. Từ khi đã gửi duyệt trở đi chỉ được **hủy, đảo hoặc điều chỉnh bằng chứng từ mới**, bắt buộc lý do và lưu vết người, lúc.
5. **Khóa kỳ.** Hết tháng: kiểm kê, chốt tồn, chốt công nợ theo NCC. Sau khóa kỳ, chỉ điều chỉnh bằng chứng từ của kỳ sau.

## 2. Luồng chuẩn và người chịu trách nhiệm

| Bước | Chứng từ | Ai làm | Tác động |
|---|---|---|---|
| Nhu cầu | Đề xuất / KH vật tư | Công trường lập, CHT duyệt | — |
| Đặt hàng | Đơn hàng (PO) | Mua hàng lập, người khác duyệt | Cam kết chi |
| Giao nhận | Đợt giao + phiếu nhập (QR) | Thủ kho nhận SL/CL thực tế | **Tăng tồn** |
| Ghi nhận phải trả | Chứng từ phải trả (theo phiếu nhập hoặc bảng đối soát HĐ) | Tự động theo phiếu nhập × giá đơn; kế toán xác nhận | **Tăng công nợ** |
| Hóa đơn | Hóa đơn NCC đối chiếu 3 bên | Kế toán | Khớp / lệch |
| Thanh toán | Đề nghị → duyệt chi → phiếu chi | Kế toán lập, GĐ/KTT duyệt | **Giảm công nợ, giảm tiền** |
| Trả hàng NCC | Phiếu trả NCC + phiếu xuất trả | Thủ kho, Mua hàng xác nhận | **Giảm tồn, giảm công nợ** |

## 3. Các tình huống anh nêu

### 3.1. Hàng lỗi đã nhập kho → trả NCC → giảm công nợ

- **Hệ thống đã có ở tầng dữ liệu:** phiếu trả NCC → phiếu xuất trả của kho. Khi xuất trả hoàn tất, hệ thống tự ghi **giảm trừ** vào khoản phải trả của đúng đợt giao, và ghi cả sổ chi phí dự án. Hiện có 4 phiếu trả, đều trên đơn cũ lập ở dự án.
- **Còn thiếu:**
  - Chọn **"Đổi hàng"** (NCC giao lại, phần trả quay về "còn phải giao") hay **"Giảm trừ"** (không giao lại, giảm công nợ).
  - **Phân loại lý do** (lỗi chất lượng, sai quy cách, thừa, hỏng khi vận chuyển) để thống kê theo NCC.
  - Mua hàng **nhìn thấy** phiếu trả trong đơn.
  - Xử lý khi **đã thanh toán**: NCC thành ra nợ ngược, trừ vào lần trả tiền sau hoặc đòi hoàn.
- **Nên ưu tiên:** phát hiện lỗi **ngay lúc nhận** (thủ kho nhận thiếu, ghi lý do) thay vì nhập rồi mới trả. Luồng nhận thiếu hiện đã làm được.

### 3.2. Công nợ và thanh toán gộp theo NCC (gắn HĐ nếu có)

- **Hiện có:** 25 chứng từ phải trả, tổng ghi nhận khoảng **1,55 tỷ**, gồm 7 chứng từ theo phiếu nhập và 18 theo bảng đối soát HĐ. Hệ thống đang **gộp theo dự án + NCC**. Bảng đợt thanh toán và phân bổ thanh toán đã có sẵn nhưng **chưa có khoản thanh toán nào được ghi**, tức tiền đang trả ngoài hệ thống. Hóa đơn NCC chưa được nhập.
- **Đề xuất màn "Công nợ NCC" toàn công ty:**
  - Mỗi NCC một dòng: phải trả, giảm trừ, đã trả, còn nợ, quá hạn, và số trả trước (tạm ứng).
  - Mở ra theo **Hợp đồng → Đơn hàng / Đợt giao / Bảng đối soát → Chứng từ**.
  - **Đợt thanh toán** gộp nhiều chứng từ của 1 NCC, tự phân bổ chứng từ cũ trước (FIFO) hoặc chọn tay. Hạn thanh toán lấy theo điều khoản HĐ.
  - Trả tiền chỉ trong phạm vi đã đối chiếu 3 bên; phần lệch phải có lý do và người duyệt.

### 3.3. Quyền hủy, từ chối, xóa (lý do bắt buộc)

| Trạng thái đơn | Được làm | Ai |
|---|---|---|
| Nháp chưa gửi | Xóa hẳn | Người lập |
| Chờ duyệt | Trả lại (lý do) | Người duyệt |
| Bị trả lại | Sửa, gửi lại, hoặc **hủy đơn** (lý do) | Người lập |
| Đã duyệt, chưa giao | **Hủy đơn** (lý do): nhu cầu quay lại Cần mua, phiếu nhập chờ bị hủy | Người duyệt / Mua hàng — Quản trị |
| Đang giao / giao một phần | Kết thúc thiếu, hủy đợt chưa nhận, trả hàng | Mua hàng; trả hàng do thủ kho |
| Đã ghi công nợ / đã thanh toán | Chỉ **đảo chứng từ** (lý do) | Kế toán trưởng |

- Mọi hủy, đảo, trả lại đều lưu vết. Không có "xóa" sau khi đã gửi duyệt.
- Hiện đã có: xóa nháp, trả lại có lý do, hủy đợt chưa nhận, kết thúc thiếu.
- Còn thiếu: nút **"Hủy đơn đã duyệt"** riêng; hiện dùng "Kết thúc thiếu" khi chưa giao thì cho kết quả tương đương.

### 3.4. Kiểm soát tồn, nhập, xuất

- **Thực trạng:**
  - **18 dòng tồn âm** ở 2 kho.
  - **14 phiếu nhập treo** ở trạng thái chờ (cũ nhất từ 23/07).
  - **5 phiếu nhập đã duyệt SL/CL nhưng chưa xác nhận nhập kho.**
  - Đã có bảng kiểm kê kho (`wms_inventory_counts`).
- **Đề xuất:**
  - Chặn xuất làm âm tồn (trừ phiếu có người duyệt vượt).
  - Cảnh báo phiếu treo quá 3 ngày.
  - Kiểm kê cuối tháng, chênh lệch phải qua phiếu điều chỉnh có duyệt.
  - Khóa kỳ.
  - Xuất kho gắn công việc / BOQ để so sánh với định mức (Đợt 3 của vòng khép kín).

## 4. Lộ trình đề xuất

1. **M2b – Hợp đồng nguyên tắc** (đang làm): đơn giá có ngày hiệu lực, lũy kế và hạn mức, bảng đối soát theo tháng.
2. **Kho & Công nợ** (ưu tiên cao nhất sau M2b):
   - K1: dọn tồn âm và phiếu treo, chặn xuất âm, cảnh báo phiếu treo.
   - K2: trả hàng NCC trong Mua hàng (đổi hàng / giảm trừ, lý do chuẩn).
   - K3: màn Công nợ NCC toàn công ty và đợt thanh toán gộp theo NCC, gắn HĐ.
   - K4: hủy đơn đã duyệt theo ma trận quyền; đảo chứng từ công nợ.
   - K5: kiểm kê định kỳ và khóa kỳ.
3. **M2c – Mua nóng** vào Mua hàng.

## 5. Quyết định của chủ sản phẩm (01/10/2026)

- Bảng đối soát HĐ nguyên tắc cuối tháng: **Mua hàng lập và chốt với NCC; kế toán dự án** (quyền Room Thanh toán — Xác nhận) **hoặc Admin ghi công nợ.** Người ghi công nợ không phải người chốt. Công trường chỉ nhập phiếu giao, không ghi công nợ nữa.
- Thanh toán NCC **ghi trong Vioo** (đợt thanh toán gộp theo NCC → duyệt chi → phiếu chi).
- Thứ tự: M2b → Kho & Công nợ (K1–K5) → M2c.

# Luồng PO vật tư theo thực tế

**Ngày:** 2026-08-26  
**Trạng thái:** Đã thống nhất nguyên tắc, dùng làm nguồn nghiệp vụ cho kế hoạch triển khai  
**Thay thế:** Thiết kế MR/PO flow V3 và V4 ngày 2026-08-25/26

## 1. Mục tiêu

Luồng mua vật tư phải giống vận hành đời thường:

- phiếu đề xuất là nhu cầu tham chiếu, không phải trần giao dịch;
- số đặt, số nhà cung cấp giao và số kho chấp nhận có thể khác nhau;
- mọi chênh lệch đều được phép nếu có nguyên nhân;
- tồn kho chỉ phản ánh số thực tế đạt chất lượng và đã xác nhận nhập;
- giao một lần là một đơn mua hàng duy nhất;
- giao nhiều lần là một PO nhu cầu có nhiều đợt mua độc lập;
- không tạo thêm gói mua, dự toán tổng, receipt riêng, duyệt bổ sung hoặc flow version mới.

## 2. Mô hình dữ liệu tối thiểu

Chỉ dùng các thực thể đang có:

1. `purchase_orders`: đầu PO, nhà cung cấp, công trường, kho nhận và snapshot MR.
2. `purchase_order_delivery_batches`: đơn mua/đợt mua thực tế.
3. `purchase_order_delivery_lines`: số lượng, đơn giá và VAT của từng đợt.
4. `transactions`: phiếu WMS nhập kho và QR của đúng đơn/đợt.
5. `purchase_order_request_lines` và fulfillment hiện có: truy vết ngược về MR.

Không dùng `purchase_order_master_estimates`, `purchase_order_master_estimate_versions`,
`purchase_order_receipts` hoặc `purchase_order_receipt_lines` cho luồng mới.

Một PO chỉ có một nhà cung cấp. Nếu chọn vật tư của nhiều nhà cung cấp, hệ thống tách thành nhiều PO.

## 3. Snapshot từ phiếu đề xuất

Khi tạo PO, mỗi dòng sao chép và giữ nguyên:

- mã, tên và định danh vật tư;
- mã dòng MR và mã MR;
- số lượng, đơn vị đề xuất;
- dự án, công trường, kho nhận và ngày cần;
- BOQ/khoản mục chi phí nếu có;
- ghi chú và lý do của phiếu đề xuất.

Snapshot không đổi khi danh mục hoặc MR thay đổi sau đó. Số lượng snapshot chỉ dùng đối chiếu.

## 4. Ba lớp số lượng

Mỗi dòng phải phân biệt rõ:

1. `requested_qty`: số đề xuất tham chiếu.
2. `ordered_qty`: số đặt mua đã được duyệt của PO/đợt.
3. `delivered_qty`: số nhà cung cấp thực giao.
4. `accepted_qty`: số đạt chất lượng theo đơn vị mua.
5. `accepted_stock_qty`: số thực nhập theo đơn vị kho.

Quy tắc:

- tất cả số lượng không âm;
- `accepted_qty` không lớn hơn `delivered_qty`;
- `accepted_stock_qty` không lớn hơn số thực giao quy về/ghi theo đơn vị kho;
- `delivered_qty` có thể thấp hơn, bằng hoặc cao hơn `ordered_qty`;
- nếu đơn vị mua khác đơn vị kho, thủ kho nhập `accepted_stock_qty` thực tế, hệ thống không tự ép theo hệ số danh mục;
- mọi chênh lệch thực giao/thực đạt so với số đặt bắt buộc có lý do;
- tồn kho tăng đúng `accepted_stock_qty`, không tăng theo số đề xuất, số đặt hoặc số giao không đạt.

## 5. PO giao một lần

### 5.1. Tạo và duyệt

1. Chọn MR đã duyệt và bấm `Tạo đơn mua hàng`.
2. Hệ thống snapshot MR sang PO.
3. Người mua nhập nhà cung cấp, số đặt, đơn giá, VAT, ngày giao và ghi chú.
4. Người mua `Lưu nháp` hoặc `Gửi duyệt`.
5. Người duyệt duyệt PO.
6. Trong cùng giao dịch duyệt, hệ thống tạo đúng một batch kỹ thuật, một WMS nhập trạng thái `PENDING` và một QR của WMS.

Batch kỹ thuật không hiển thị là `Đợt 1`; người dùng chỉ thấy một đơn mua hàng và một phiếu giao/nhận.

### 5.2. Nhận kho

1. Thủ kho mở WMS/QR.
2. Nhập số thực giao, số đạt theo đơn vị mua, số thực nhập theo đơn vị kho và lý do chênh lệch.
3. `Duyệt SL/CL` khóa số liệu, chuyển WMS sang `APPROVED`, chưa tăng tồn.
4. `Nhập kho` chuyển WMS sang `COMPLETED` và tăng tồn đúng một lần.
5. PO hoàn thành sau lần nhập này, kể cả nhận đủ, thiếu hoặc dư; trạng thái chênh lệch được giữ để tra cứu.

Nếu cần mua bù sau một PO giao một lần bị thiếu, lập PO mới thay vì mở lại PO đã hoàn thành.

## 6. PO giao nhiều lần

### 6.1. PO nhu cầu

PO đầu chỉ giữ snapshot nhu cầu, nhà cung cấp, công trường và kho nhận. PO đầu không có một vòng duyệt chủ trương tổng.

### 6.2. Mỗi đợt mua

1. Người mua tạo đợt với số lượng, đơn giá, VAT và ngày giao riêng.
2. Đợt được lưu nháp hoặc gửi duyệt.
3. Người duyệt duyệt đúng đợt đó.
4. Trong cùng giao dịch duyệt, hệ thống tạo một WMS `PENDING` và QR riêng của đợt.
5. Kho thực hiện `Duyệt SL/CL` rồi `Nhập kho` giống PO giao một lần.

Nhiều đợt đã duyệt được phép cùng chờ nhận; hệ thống không ép phải nhận xong đợt trước mới duyệt đợt sau.

Tổng các đợt có thể thấp hơn hoặc cao hơn MR:

- tạo đợt nhỏ hơn nhu cầu không cần lý do vì phần còn lại vẫn mở;
- khi tổng số đã duyệt vượt nhu cầu, bắt buộc có lý do vượt;
- PO tự hoàn thành khi tổng thực nhập đạt/vượt nhu cầu;
- nếu dừng mua khi còn thiếu, người dùng đóng PO với lý do.

## 7. Trạng thái

### PO

- `draft`: đang lập;
- `sent`: PO giao một lần đang chờ duyệt;
- `confirmed`/`in_transit`: đã duyệt hoặc có đợt đang thực hiện;
- `partial`: đã nhập một phần nhưng nhu cầu còn mở;
- `delivered`: đã hoàn thành theo thực tế;
- `closed`: đóng thiếu có lý do;
- `returned`/`cancelled`: trả lại hoặc hủy.

### Đợt mua

Trạng thái duyệt:

`draft -> pending_approval -> approved | revision_requested | rejected`

Trạng thái kho:

`planned -> receiving -> quality_approved -> received | received_short | received_over`

### WMS

`PENDING -> APPROVED -> COMPLETED`

Lệnh duyệt đơn, Duyệt SL/CL và Nhập kho đều phải idempotent.

## 8. Sai lệch và nguyên nhân

Nguyên nhân được ghi tại đúng nơi phát sinh:

- PO giao một lần đặt khác MR: lý do trên dòng PO hoặc ghi chú PO;
- tổng các đợt vượt MR: lý do trên đợt;
- thực giao khác số đặt hoặc thực đạt khác thực giao: lý do trên dòng nhận;
- đóng PO khi còn thiếu: lý do đóng PO.

Không chặn giao dịch vì chênh lệch giá trị hoặc phần trăm. Chỉ chặn dữ liệu vô lý: số âm, vật tư không thuộc PO, sai kho, sai quyền, `accepted > delivered`, hoặc thao tác lặp gây nhập kho hai lần.

## 9. Chuyển đổi V3/V4 trên Cloud

Các migration đã chạy được giữ trong lịch sử, sau đó có migration bù để:

1. ngừng tạo PO `procurement_flow_version` 3/4;
2. chuyển PO-211, PO-259 và PO-414 về mô hình chung mà không xóa batch/WMS hiện hữu;
3. giữ batch đã duyệt, số SL/CL và WMS đã phát sinh;
4. tạo WMS còn thiếu cho batch đã duyệt nếu dữ liệu đủ;
5. vô hiệu hóa quyền gọi RPC V3/V4;
6. chỉ xóa bảng/RPC V3/V4 trong migration dọn sau khi đã nghiệm thu dữ liệu chuyển đổi.

Không sửa trực tiếp migration đã áp dụng và không dùng Supabase local hoặc Docker.

## 10. Giao diện

### Tạo PO

- mặc định `Giao một lần`;
- snapshot MR hiển thị chỉ đọc;
- trường nhập chính: NCC, SL đặt, đơn giá, VAT, ngày giao;
- hai nút: `Lưu nháp`, `Gửi duyệt`;
- không hiển thị flow version, gói mua, tổng chủ trương, duyệt bổ sung hoặc batch kỹ thuật.

### Giao nhiều lần

- đầu trang hiển thị nhu cầu, đã duyệt đặt, đã thực nhập và còn lại;
- mỗi đợt là một thẻ gọn có SL, giá, VAT, ngày giao và trạng thái;
- hành động duyệt nằm trên đúng thẻ đợt.

### Nhận kho

- hiển thị số đặt và các ô thực giao, thực đạt, thực nhập kho;
- cảnh báo chênh lệch nhưng vẫn cho tiếp tục khi có lý do;
- hai nút riêng: `Duyệt SL/CL`, sau đó `Nhập kho`;
- sau `COMPLETED` chỉ được xem, không sửa đè.

## 11. Tiêu chí nghiệm thu

### Giao một lần

- tạo PO từ MR giữ đủ snapshot;
- duyệt PO sinh đúng một WMS/QR;
- thực giao thiếu/dư được duyệt khi có nguyên nhân;
- Duyệt SL/CL không tăng tồn;
- Nhập kho tăng đúng `accepted_stock_qty` một lần và PO hoàn thành.

### Giao nhiều lần

- mỗi đợt có SL, đơn giá, VAT và duyệt riêng;
- duyệt mỗi đợt sinh đúng một WMS/QR;
- cho phép nhiều đợt cùng chờ nhận;
- tổng đợt vượt MR chỉ yêu cầu nguyên nhân, không yêu cầu duyệt bổ sung;
- tồn kho bằng tổng thực nhập đạt của các WMS đã hoàn thành.

### Chuyển đổi

- PO-211, PO-259 và PO-414 tiếp tục mở/xử lý được;
- không mất batch, WMS, QR, số SL/CL hoặc liên kết MR;
- không còn frontend gọi RPC V3/V4;
- test gửi lặp lệnh không sinh trùng WMS hoặc tồn kho.

## 12. Ngoài phạm vi

- hóa đơn, thanh toán và đối soát công nợ mới;
- tự động quy đổi đơn vị khác bản chất;
- thay đổi luồng xuất kho;
- hợp đồng khung, hạn mức mua hoặc duyệt ngân sách tổng;
- sửa/xóa chứng từ kho đã hoàn thành.

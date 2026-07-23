# WMS/QR cho mọi PO và ghi nhận theo thực nhận

Ngày: 2026-07-23  
Trạng thái: Đã duyệt thiết kế nghiệp vụ, chờ review tài liệu  
Phạm vi: PO, đợt giao, WMS nhập kho/xuất kho, duyệt SL/CL, công nợ phải trả NCC và tệp chứng minh thực nhận.

## 1. Mục tiêu và nguyên tắc

Hệ thống có hai luồng mua hàng hợp lệ:

1. Mua theo đề xuất vật tư (`source_mode = from_request`).
2. Mua chủ động, không có `requestId` (`source_mode = proactive_*`).

Cả hai luồng đều phải tạo được đợt giao và, tại từng đợt giao, tạo WMS/QR nhận hàng. Luồng mua chủ động không được tạo đề xuất giả để đi tiếp.

Số lượng trên PO là mức đặt mua/audit baseline. Số lượng được thủ kho xác nhận tại **Duyệt SL/CL** là số lượng thực nhận. Thực nhận có thể thấp hơn hoặc cao hơn số đặt; không cần duyệt bổ sung PO. Tồn kho, giá trị nhập và công nợ/thanh toán NCC đều dùng số thực nhận đã duyệt.

Ví dụ: PO đặt 2.000 kg nhưng cân được 2.010 kg. Khi Duyệt SL/CL chấp nhận 2.010 kg, nhập kho và công nợ NCC đều ghi 2.010 kg. PO vẫn hiển thị 2.000 kg là lượng đặt và có chênh lệch +10 kg để truy vết.

## 2. Phương án đã cân nhắc

### A. Chặn giao vượt PO, yêu cầu PO bổ sung

Ưu điểm là giữ PO và thực nhận luôn bằng nhau. Nhược điểm là không phản ánh thực tế cân hàng và tạo thêm một vòng duyệt không cần thiết. Không chọn.

### B. Ghi đè số lượng đặt trên PO bằng số cân thực tế

Giảm số cột phải hiển thị nhưng làm mất dấu vết cam kết ban đầu. Không chọn.

### C. Giữ số đặt, ghi nhận thực nhận và chênh lệch riêng

Đây là phương án được chọn. Duyệt SL/CL là thẩm quyền chấp nhận chênh lệch; lý do chênh lệch là bắt buộc khi thực nhận khác số phiếu. Nó giữ nguyên audit PO, phù hợp thực tế cân/đo, và làm cho tồn kho/công nợ nhất quán.

## 3. Luồng WMS/QR theo đợt giao

### 3.1. Quy tắc chung

- Mỗi đợt giao có tối đa một chứng từ WMS nhận hàng đang hiệu lực và một QR dẫn đến chứng từ đó.
- Nút **Tạo WMS/QR** được hiển thị với đợt giao `planned` của PO đã xác nhận/đang giao, bất kể PO có hay không có `requestId`.
- Nếu WMS/QR đã tồn tại, nút chuyển thành mở/in lại QR; không sinh trùng chứng từ.
- Phiếu nhập kho và phiếu xuất kho là chứng từ tự sinh từ thao tác WMS/Duyệt SL/CL; người dùng không phải lập riêng các phiếu này.

### 3.2. PO mua theo đề xuất

Giữ cơ chế fulfillment hiện có: đợt giao liên kết các dòng đề xuất và WMS có dòng allocation theo đề xuất. Khi duyệt, lượng thực nhận trả về cả PO và dòng đề xuất; trạng thái đề xuất chỉ hoàn tất khi tổng thực nhận đáp ứng nhu cầu, không dựa vào số lượng đặt bị giới hạn.

### 3.3. PO mua chủ động

Tạo trực tiếp WMS IMPORT từ `purchase_order_delivery_batch`, với các dòng là snapshot hàng hóa của batch/PO. Bổ sung cột `purchase_order_delivery_batches.wms_transaction_id` để batch gắn duy nhất với chứng từ WMS của nó. Không gọi các hàm đòi `purchase_order_request_lines`, không tạo fulfillment batch hay request giả.

QR của batch trỏ về WMS trực tiếp này; màn hình quét QR và màn hình nhận hàng dùng cùng bước chuẩn bị Duyệt SL/CL nhưng có nhánh nguồn `from_request` hoặc `proactive`.

## 4. Duyệt SL/CL và số lượng thực nhận

### 4.1. Giao diện và kiểm soát

- Modal Duyệt SL/CL cho phép nhập số thực nhận không âm, không áp dụng trần bằng số lượng trên phiếu/PO.
- Hiển thị đồng thời: số phiếu/số đặt, thực nhận, chênh lệch (+/-), đơn vị tính.
- Khi có chênh lệch, bắt buộc nhập lý do; lý do được lưu trên từng dòng để tra cứu sau này.
- Chỉ người có quyền Duyệt SL/CL/WMS hiện hữu được xác nhận. Đây là thẩm quyền duy nhất chấp nhận giao vượt; không phát sinh luồng duyệt PO bổ sung.
- Thay đổi danh tính vật tư, dòng PO/dòng đề xuất hoặc số lượng âm vẫn bị chặn.

### 4.2. Dữ liệu và đồng bộ

- `transactions.items[].quantity` sau duyệt là lượng thực nhận được dùng để post tồn kho.
- Mỗi dòng giữ thêm metadata audit tối thiểu: `orderedQty`, `receivedQty`, `varianceQty`, `varianceReason`; dữ liệu cũ được diễn giải `orderedQty = quantity` nếu chưa có metadata.
- RPC cập nhật lượng phiếu chỉ được gọi trong trạng thái cho phép và bỏ điều kiện chặn `newQty > oldQty`. RPC tiếp tục khoá transaction, kiểm quyền và kiểm toàn vẹn số dòng.
- Đồng bộ PO/fulfillment cộng toàn bộ lượng thực nhận, không dùng `least(ordered_qty, received_qty)` để cắt phần giao vượt. Với PO theo đề xuất, phần vượt được hiển thị là variance nhưng không tự tăng nhu cầu mở của đề xuất.
- Trạng thái batch/PO căn cứ vào WMS đã duyệt. Khi mọi batch cần nhận đã hoàn tất, PO chuyển đúng trạng thái nhận hàng như hiện tại.

## 5. Tồn kho, công nợ và thanh toán

Tại thời điểm Duyệt SL/CL thành công:

1. WMS tự hoàn tất phiếu nhập/xuất tương ứng và post tồn kho theo `receivedQty`.
2. Giá trị nhận hàng/cost được tính `receivedQty × unitPrice` theo snapshot PO; thuế và các quy tắc giá hiện có giữ nguyên.
3. Sổ công nợ NCC cập nhật theo tổng nhận ròng thực tế (`receivedQty - returnedQty`). Thanh toán lấy số dư công nợ này, nên trả theo 2.010 kg trong ví dụ trên.
4. Phiếu trả NCC/xuất kho sau này làm giảm lượng nhận ròng và công nợ theo luồng đảo chứng từ hiện hữu.

Không tạo bút toán tồn kho hoặc công nợ khi chỉ tạo QR/WMS; chỉ Duyệt SL/CL mới là điểm ghi nhận.

## 6. Tệp đính kèm chứng minh thực nhận

### 6.1. Tạo và khoá chứng từ

- Chỉ modal **Duyệt SL/CL** cho chọn ảnh/tệp (phiếu cân, biên bản giao nhận, ảnh chất lượng...). Không yêu cầu đính kèm khi phiếu nhập/xuất được tự tạo.
- Khi người dùng bấm duyệt, ứng dụng tải các file đã chọn vào bucket Storage riêng tư `wms-transaction-attachments`, lưu trên transaction metadata: tên file, MIME type, dung lượng, thời gian/người tải và `storagePath`; không lưu signed URL.
- Nếu upload hoặc cập nhật metadata/duyệt phiếu thất bại, thao tác thất bại nguyên tử ở góc nhìn nghiệp vụ: không post WMS; các object đã tải nhưng chưa tham chiếu sẽ được dọn dẹp theo xử lý bù.
- Sau khi Duyệt SL/CL thành công, tệp và metadata bị khoá: không sửa/xoá qua UI, phù hợp là chứng cứ của phiếu.

### 6.2. Hiển thị và lazy load

- Phiếu nhập kho và phiếu xuất kho cùng hiển thị danh sách metadata tệp đính kèm: tên, loại, dung lượng, người/timestamp.
- Mở modal phiếu không tạo signed URL và không tải nội dung file.
- Chỉ khi người dùng bấm **Xem** hoặc **Tải xuống**, ứng dụng mới gọi `createSignedUrl` cho đúng `storagePath`, mở/tải file và cache URL ngắn hạn trong phiên xem.
- Bucket là private; chính sách Storage chỉ cho người dùng authenticated có quyền ứng dụng hiện hữu đọc/tải file và chỉ cho người có quyền Duyệt SL/CL upload dưới namespace WMS. Không dùng public URL hay service key ở frontend.

## 7. Thành phần tác động

| Thành phần | Thay đổi trách nhiệm |
| --- | --- |
| `purchase_order_delivery_batches` | Thêm `wms_transaction_id`, là liên kết duy nhất tới WMS/QR của batch chủ động. |
| `materialRequestFulfillmentService` | Tách phần chung tạo/chuẩn bị nhận hàng khỏi phần chỉ dành cho dòng đề xuất. |
| WMS receipt RPC | Cho phép quantity thực nhận vượt baseline, lưu variance, vẫn kiểm quyền và integrity. |
| PO/fulfillment status sync | Cộng thực nhận không cắt theo ordered quantity; cập nhật batch/PO đúng sau post. |
| Supplier payable service | Dùng received net quantity thực tế đã duyệt; regression test cả overage và return. |
| `TransactionDetailModal` | Nhập/hiển thị variance và upload chứng từ lúc Duyệt SL/CL; xem tệp lazy-load ở import/export. |
| PO cockpit/SupplyChain UI | Hiện Tạo WMS/QR cho batch của cả hai nguồn, mở/in lại QR khi đã có. |
| Supabase Storage/RLS | Bucket private, metadata JSONB trên transaction, policies tối thiểu theo quyền WMS. |

## 8. Tình huống lỗi và an toàn dữ liệu

- Bấm Tạo WMS/QR lặp lại hoặc hai người thao tác cùng lúc phải trả lại cùng một WMS/QR; database cần unique/source guard.
- Không có kho nhận hoặc batch không còn ở trạng thái tạo WMS thì trả lỗi có hướng dẫn, không tạo chứng từ dang dở.
- Giao vượt thiếu lý do bị chặn ở UI và RPC/service validation; backend là lớp quyết định cuối cùng.
- Nếu modal mở bằng dữ liệu cũ sau khi WMS đổi trạng thái, thao tác phải reload/check trạng thái hiện tại trước khi RPC để tránh thông báo sai/stale state như PO-116.
- Khi tệp không thể tải, duyệt không post. Khi post thất bại sau upload, dọn object đã upload; khi cleanup thất bại, ghi audit để job dọn rác xử lý.
- Các quyền/Storage policy không dựa vào `user_metadata`; không để bucket public.

## 9. Tiêu chí nghiệm thu

1. PO-145 kiểu mua chủ động tạo được WMS/QR từ Đợt giao, quét QR dẫn đến luồng nhận hàng và không cần requestId.
2. PO theo đề xuất vẫn tạo/nhận WMS như trước, không regression allocation hoặc trạng thái đề xuất.
3. Duyệt một dòng 2.000 kg thành 2.010 kg yêu cầu lý do, post tồn kho đúng 2.010 kg, và công nợ/thanh toán hiển thị đúng giá trị 2.010 kg.
4. Thực nhận thiếu, bằng và vượt đều có status/balance chính xác; hàng trả làm giảm nhận ròng đúng một lần.
5. Phiếu import/export tự sinh và cùng hiển thị chứng từ đã tải tại Duyệt SL/CL.
6. Chỉ nhấn Xem/Tải mới sinh signed URL hoặc tải file; không có URL file trong payload list transaction.
7. Tạo WMS/QR, duyệt SL/CL, variance, cập nhật công nợ và Storage policies có test regression ở service/RPC và test UI trọng yếu.

## 10. Ngoài phạm vi đợt này

- Không thay đổi giá/đơn giá PO do giao vượt; thay đổi giá vẫn theo quy trình PO/điều chỉnh giá hiện hữu.
- Không thêm luồng duyệt PO bổ sung riêng cho variance.
- Không cho sửa/xoá chứng từ thực nhận sau duyệt trong giao diện này; nghiệp vụ đảo/return dùng chứng từ sau như hiện có.

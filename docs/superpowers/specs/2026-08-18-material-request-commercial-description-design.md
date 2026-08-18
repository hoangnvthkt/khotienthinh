# Thiết kế tên và quy cách riêng theo dòng MR/PO

Ngày: 2026-08-18

## 1. Mục tiêu

Cho phép nhiều dòng đề xuất vật tư (MR) và đơn mua hàng (PO) cùng tham chiếu một mã vật tư chính nhưng có tên hàng và quy cách khác nhau theo từng dòng chứng từ.

Ví dụ hợp lệ:

| Mã vật tư | Tên trên chứng từ | ĐVT | Số lượng |
|---|---|---|---:|
| `VT0001489` | Van chặn PPR D32 | Cái | 2 |
| `VT0001489` | Van PPR D32 | Cái | 10 |

Hai dòng trên cùng tham chiếu một `items.id`. Tồn kho được cộng vào một mã vật tư, nhưng nội dung thương mại và lịch sử của hai dòng chứng từ được giữ độc lập.

## 2. Nguyên tắc nghiệp vụ

Hệ thống phân biệt hai loại dữ liệu:

1. **Danh tính vật tư chuẩn**: `itemId`, SKU/mã vật tư và đơn vị tồn kho. Đây là khóa dùng cho tồn kho, sổ kho, cấp phát và đối soát.
2. **Nội dung dòng chứng từ**: tên trên chứng từ và quy cách/mô tả kỹ thuật. Nội dung này thuộc riêng từng dòng MR hoặc PO và không cập nhật ngược danh mục vật tư.

Không tạo bảng mã cha–con, không sinh SKU biến thể và không dùng `accounting_code` để giải quyết yêu cầu này.

Các quy tắc bắt buộc:

- Một MR hoặc PO được phép có nhiều dòng cùng `itemId`.
- Mỗi dòng luôn có `lineId` riêng.
- Không gộp dòng chứng từ chỉ vì trùng `itemId` hoặc SKU.
- Tên/quy cách dòng chứng từ không thay đổi `items.name`.
- Tồn kho và báo cáo thẻ kho vẫn tổng hợp theo `itemId`.
- Chứng từ, bản in và truy vết hiển thị tên/quy cách snapshot của dòng.
- SKU và đơn vị tồn kho không được sửa tự do cùng với tên/quy cách.
- MR/PO đã duyệt bị khóa. Muốn sửa phải qua luồng trả về nháp và ghi lịch sử thay đổi.

## 3. Mô hình dữ liệu

### 3.1 Danh mục vật tư

Bảng `public.items` tiếp tục là danh mục chuẩn:

- `id`: định danh vật tư.
- `sku`: mã vật tư duy nhất.
- `name`: tên chuẩn trong danh mục.
- `unit`: đơn vị tồn kho.
- `purchase_unit` và `purchase_conversion_factor`: đơn vị mua và hệ số quy đổi nếu có.

Không thay đổi danh mục khi người dùng sửa tên trên MR hoặc PO.

### 3.2 Dòng MR

Mỗi `RequestItem` sử dụng:

- `lineId`: định danh duy nhất của dòng.
- `itemId`: vật tư chuẩn được chọn.
- `skuSnapshot`: mã vật tư tại thời điểm tạo dòng; không cho người dùng sửa trực tiếp.
- `itemNameSnapshot`: tên hiển thị trên MR, được phép sửa khi phiếu còn nháp.
- `specification`: quy cách/mô tả kỹ thuật, được phép sửa khi phiếu còn nháp.
- `unitSnapshot`: đơn vị tồn kho tại thời điểm tạo dòng.
- Các trường số lượng, BOQ, ngày cần và ghi chú hiện có.

### 3.3 Dòng PO

Mỗi `PurchaseOrderItem` sử dụng cùng nguyên tắc:

- `lineId` và `itemId` là danh tính dòng và vật tư chuẩn.
- `sku`/`skuSnapshot` luôn lấy từ danh mục vật tư.
- `itemNameSnapshot` là tên hiển thị trên PO và có thể khác MR.
- `specification` là quy cách/mô tả trên PO và có thể khác MR.
- `requestId` và `requestLineId` giữ liên kết tới dòng MR gốc.

Trong giai đoạn tương thích, trường `name` hiện có trên `PurchaseOrderItem` được ghi đồng bộ cùng `itemNameSnapshot`. Khi đọc dữ liệu, ưu tiên `itemNameSnapshot`, sau đó `name`, cuối cùng mới fallback về `items.name`.

Các dòng MR/PO hiện lưu trong JSONB nên yêu cầu này không cần tạo bảng mã con. Không dự kiến migration database nếu dữ liệu hiện tại đã chấp nhận các thuộc tính snapshot nói trên.

## 4. Luồng tạo MR thủ công

1. Người dùng chọn vật tư từ danh mục bằng mã hoặc tên chuẩn.
2. Hệ thống gán `itemId`, `skuSnapshot`, `unitSnapshot` và điền tên chuẩn vào `itemNameSnapshot`.
3. Giao diện hiển thị rõ:
   - Mã vật tư: chỉ đọc.
   - Tên danh mục: chỉ đọc để đối chiếu.
   - Tên trên đề xuất: cho sửa.
   - Quy cách/mô tả: cho sửa.
4. Người dùng có thể thêm một dòng khác với cùng mã và nhập tên/quy cách khác.
5. Khi lưu, từng dòng được giữ độc lập theo `lineId`.

Tên/quy cách được phép giống hoặc khác tên danh mục. Sự khác nhau không tạo cảnh báo vì mã vật tư là danh tính có thẩm quyền.

## 5. Luồng import MR từ Excel

### 5.1 Cấu trúc file mẫu

File mẫu bổ sung cột `Quy cách/mô tả` riêng:

| Cột | Bắt buộc | Ý nghĩa |
|---|---|---|
| Mã/Tên phiếu đề xuất | Không | Gom các dòng vào cùng một MR |
| Mã vật tư/SKU | Có đối với vật tư đã có mã | Dùng để tìm `items.id` |
| Tên trên đề xuất | Không nếu mã hợp lệ | Snapshot tên dòng; để trống thì lấy tên danh mục |
| Quy cách/mô tả | Không | Snapshot quy cách riêng của dòng |
| Đơn vị tính | Không | Đối chiếu với đơn vị tồn kho |
| Số lượng đề xuất | Có | Phải lớn hơn 0 |
| Ngày cần hàng | Không | Ngày cần của dòng |
| Mã WBS/BOQ | Không | Liên kết dự toán nếu có |
| Kho nhận hàng | Không | Kho công trường nhận |
| Ghi chú | Không | Ghi chú nghiệp vụ khác |

Ví dụ:

| Phiếu | Mã vật tư | Tên trên đề xuất | Quy cách/mô tả | ĐVT | SL |
|---|---|---|---|---|---:|
| DX-VT-001 | VT0001489 | Van chặn PPR D32 | PN20 | Cái | 2 |
| DX-VT-001 | VT0001489 | Van PPR D32 | Loại thường | Cái | 10 |

### 5.2 Quy tắc parse và đối chiếu

- Khi có mã vật tư, mã là khóa đối chiếu có thẩm quyền.
- Tên khác tên danh mục là hợp lệ và được giữ nguyên; không lấy tên danh mục ghi đè.
- Nếu tên để trống nhưng mã hợp lệ, điền tên danh mục.
- Nếu đơn vị để trống, điền đơn vị tồn kho của danh mục.
- Nếu đơn vị Excel khác đơn vị tồn kho và không có quy đổi hợp lệ, cảnh báo hoặc chặn theo chính sách đơn vị hiện có; không âm thầm thay đổi số lượng.
- Mã không tồn tại là lỗi đối với dòng vật tư đã khai mã.
- Dòng không có mã tiếp tục theo cơ chế vật tư chưa cấp mã hiện có và không được tạo PO cho tới khi được cấp mã.
- Các dòng cùng mã không bị deduplicate hoặc cộng dồn.
- `requestCode` chỉ dùng để gom dòng vào cùng phiếu, không dùng để gom vật tư.

### 5.3 Tạo MR từ bản xem trước

Mỗi dòng import hợp lệ sinh một `RequestItem` với:

- `lineId` duy nhất.
- `itemId = matchedInventoryItem.id`.
- `skuSnapshot = matchedInventoryItem.sku`.
- `itemNameSnapshot = materialName || matchedInventoryItem.name`.
- `specification` lấy từ cột quy cách/mô tả.
- `unitSnapshot = matchedInventoryItem.unit`.

Bản xem trước phải hiển thị cả tên trong Excel và mã/tên danh mục đã đối chiếu để người dùng nhận biết đúng vật tư mà không làm mất nội dung dòng.

## 6. Luồng tạo PO từ MR

1. Mỗi dòng MR được đưa sang PO bằng `requestLineId`; không gom theo `itemId`.
2. PO kế thừa nguyên văn `itemNameSnapshot` và `specification` của dòng MR.
3. Người lập PO được sửa tên/quy cách theo báo giá hoặc cách gọi của nhà cung cấp khi PO còn nháp.
4. Chỉnh sửa trên PO chỉ cập nhật snapshot PO, không cập nhật MR và không cập nhật danh mục.
5. Liên kết `requestId`/`requestLineId` luôn được giữ để màn hình đối chiếu có thể hiển thị tên MR gốc và tên PO thực tế.

Ưu tiên dữ liệu khi dựng dòng PO:

- Mã và đơn vị chuẩn: ưu tiên danh mục vật tư.
- Tên thương mại: ưu tiên `row.line.itemNameSnapshot`, fallback về tên danh mục.
- Quy cách: ưu tiên `row.line.specification`.

## 7. Nhập kho và truy vết

Nhập kho sử dụng `itemId`, không sử dụng tên tự nhập làm khóa.

Với ví dụ hai dòng `VT0001489` có số lượng 2 và 10:

- Tồn kho `VT0001489` tăng tổng cộng 12 Cái.
- Phiếu giao nhận vẫn giữ hai dòng riêng.
- Mỗi dòng fulfillment/delivery giữ `requestLineId` hoặc `purchaseOrderLineId` tương ứng.
- Bản in nhận hàng hiển thị tên/quy cách PO của từng dòng.
- Sổ kho có thể tổng hợp theo mã nhưng truy vết nguồn vẫn mở được dòng PO/MR gốc.

Các hàm tính tồn hoặc báo cáo được phép aggregate theo `itemId`. Các màn hình và bản in chứng từ không được aggregate theo `itemId` nếu việc đó làm mất ranh giới dòng.

## 8. Thay đổi giao diện

### MR thủ công

- Sau bộ chọn vật tư, thêm trường `Tên trên đề xuất` và `Quy cách/mô tả`.
- Hiển thị mã và tên danh mục làm thông tin đối chiếu.
- Danh sách dòng dùng `lineId` làm khóa hiển thị, không dùng SKU làm khóa nhóm.

### Import Excel

- Cập nhật file mẫu và bộ ánh xạ cột với `specification`.
- Bản xem trước hiển thị tên Excel, quy cách Excel, SKU đã match và tên danh mục.
- Hai dòng cùng SKU xuất hiện thành hai dòng độc lập.

### PO

- Hiển thị trường `Tên trên PO` và `Quy cách/mô tả` sau khi chọn mã vật tư.
- Khi PO sinh từ MR, hai trường được điền từ MR nhưng vẫn sửa được ở trạng thái nháp.
- Khu vực đối chiếu có thể hiển thị tên MR gốc nếu tên PO đã thay đổi.

## 9. Hiện trạng và điểm cần sửa

Code hiện tại đã có `itemNameSnapshot`, `skuSnapshot`, `unitSnapshot`, `specification` và `lineId` trong các kiểu dữ liệu MR/PO.

Các khoảng trống đã xác định:

1. Khi xác nhận import Excel, `MaterialRequestTab` chưa đưa `materialName`, SKU, đơn vị và quy cách vào các trường snapshot của `RequestItem`.
2. `RequestModal` đang tạo nhóm hiển thị theo SKU hoặc `itemId`, có thể làm các dòng cùng mã nhưng khác tên bị gộp.
3. Khi tạo PO từ MR, `SupplyChainTab` và `purchaseOrderRequestCart` đang ưu tiên `inventory.name` trước `row.line.itemNameSnapshot`, làm mất tên đã sửa trên MR.
4. File mẫu import chưa có cột quy cách/mô tả riêng.
5. Các bản in và màn hình liên quan cần được rà để ưu tiên snapshot dòng trước tên danh mục.

## 10. Tương thích dữ liệu cũ

- Dòng cũ thiếu `itemNameSnapshot` fallback về `items.name`.
- Dòng PO cũ chỉ có `name` vẫn hiển thị bình thường.
- Dòng cũ thiếu `lineId` tiếp tục dùng fallback hiện tại để đọc, nhưng mọi dòng mới hoặc dòng được sửa phải được cấp `lineId` ổn định.
- Không backfill hoặc thay đổi lịch sử chứng từ nếu không cần thiết.
- Không thay đổi `itemId`, số lượng tồn hoặc ledger hiện có.

## 11. Kiểm thử chấp nhận

1. Tạo MR thủ công có hai dòng cùng mã, khác tên; lưu và mở lại vẫn còn hai dòng.
2. Import Excel có hai dòng `VT0001489` với hai tên khác nhau; bản xem trước và MR sau import giữ đúng hai tên.
3. Hai dòng import có `lineId` khác nhau nhưng `itemId` giống nhau.
4. Tạo PO từ MR giữ đúng tên/quy cách từng dòng.
5. Sửa tên trên PO không làm thay đổi MR hoặc `items.name`.
6. Nhận đủ hai dòng làm tồn kho mã chính tăng bằng tổng số lượng.
7. Fulfillment và truy vết vẫn liên kết đúng từng dòng MR/PO.
8. Bản in MR, PO và giao nhận hiển thị tên/quy cách snapshot.
9. Dữ liệu cũ thiếu snapshot vẫn hiển thị bằng tên danh mục.
10. Đơn vị Excel không hợp lệ không làm sai số lượng tồn.

## 12. Ngoài phạm vi

- Danh mục vật tư cha–con hoặc SKU biến thể.
- Tự động học mọi tên nhập trên chứng từ thành alias danh mục.
- Tự động sửa tên chuẩn trong `items`.
- Thay đổi cách tính giá hoặc hệ số quy đổi đơn vị.
- Gộp các dòng cùng mã trong MR/PO.

## 13. Tiêu chí hoàn thành

Yêu cầu hoàn thành khi người dùng có thể tạo thủ công hoặc import Excel nhiều dòng cùng mã nhưng khác tên/quy cách, tạo PO kế thừa và sửa độc lập các nội dung đó, đồng thời tồn kho vẫn được quản lý duy nhất theo mã vật tư chính và toàn bộ chuỗi MR → PO → giao nhận vẫn truy vết được theo từng dòng.

# Thiết kế tối giản MR -> PO -> đợt mua -> nhập kho

**Ngày:** 2026-08-26
**Trạng thái:** Đã thống nhất nghiệp vụ, chờ xác nhận bản ghi trước khi triển khai

## 1. Mục tiêu

Chuẩn hóa luồng mua hàng hiện tại theo cách vận hành thực tế:

- mua một lần là luồng mặc định và không hiển thị khái niệm đợt;
- mua nhiều lần dùng một PO tổng để quản lý, mỗi đợt là một quyết định mua mới;
- mỗi đợt được giao đủ trong một chuyến và kho chỉ nhận đúng một lần;
- một PO chỉ thuộc một nhà cung cấp;
- một QR ổn định ở cấp PO được dùng xuyên suốt các đợt;
- giao diện nhập liệu chỉ giữ các trường cần cho quyết định mua và nhận kho.

Luồng chính:

`MR -> PO -> duyệt mua -> kho xác nhận số lượng/chất lượng -> nhập kho`

Với PO nhiều lần:

`MR -> PO tổng -> đợt mua 01/02/... -> duyệt từng đợt -> nhận một lần từng đợt`

Không sử dụng khái niệm hợp đồng khung hoặc đề nghị duyệt chủ trương tổng.

## 2. Các chứng từ và vai trò

### 2.1. MR

MR là nhu cầu gốc đã được duyệt. Mỗi dòng PO phải giữ snapshot bất biến của:

- mã và tên vật tư;
- số lượng yêu cầu và đơn vị yêu cầu;
- công trình, kho nhận, ngày cần và ghi chú;
- tham chiếu dòng MR và BOQ nếu có.

PO không tự chuyển số lượng MR sang đơn vị mua bằng hệ số danh mục.

### 2.2. PO

PO là hồ sơ quản lý mua hàng với một nhà cung cấp. PO giữ:

- mã PO duy nhất, ví dụ `PO-01`;
- MR nguồn và snapshot nhu cầu;
- công trình và kho nhận;
- nhà cung cấp;
- chế độ mua một lần hoặc nhiều đợt;
- QR ổn định của PO;
- số tổng hợp đã đặt, đã nhận, còn thiếu hoặc vượt.

Một MR có thể tạo nhiều PO nếu mua từ nhiều nhà cung cấp. Hệ thống tự nhóm các dòng theo nhà cung cấp khi người dùng tạo nhiều PO trong một thao tác.

### 2.3. Đợt mua

Đợt mua chỉ hiển thị với PO nhiều lần. Mỗi đợt là một quyết định mua mới, có:

- số đợt trong PO, ví dụ `01`, `02`;
- mã tham chiếu nội bộ, ví dụ `PO-01-L01`;
- số lượng phân bổ cho nhu cầu MR;
- số lượng mua và đơn vị mua;
- đơn giá, VAT và thành tiền;
- ngày giao;
- lý do vượt nhu cầu nếu có;
- trạng thái duyệt và trạng thái nhận.

Mỗi đợt có giá, số lượng, VAT và lần duyệt riêng. Đợt không được đổi nhà cung cấp của PO.

### 2.4. Lần nhận kho

Mỗi đợt chỉ có đúng một lần nhận kho. Kho ghi nhận:

- số lượng thực giao theo đơn vị mua;
- số lượng đạt;
- số lượng không đạt;
- số lượng nhập kho theo đơn vị kho;
- kết quả chất lượng;
- lý do chênh lệch và tệp/hình ảnh nếu có.

Kho xác nhận thực tế giao nhận, không duyệt lại quyết định mua. Tồn kho chỉ tăng khi kho hoàn tất xác nhận lần nhận.
Phiếu WMS được tạo và hoàn tất trong cùng lệnh xác nhận nhận hàng; việc duyệt mua không tạo trước phiếu WMS.

## 3. Mua một lần

### 3.1. Trải nghiệm người dùng

Người dùng mở MR đã duyệt và chọn `Tạo đơn đặt hàng`. Form mặc định là `Mua một lần` và chỉ gồm:

- nhà cung cấp;
- bảng vật tư;
- số lượng mua;
- đơn vị mua;
- đơn giá;
- VAT;
- ngày giao;
- ghi chú nếu cần.

Nếu đơn vị MR và đơn vị mua giống nhau, giao diện chỉ hiển thị một ô số lượng. Nếu khác nhau, giao diện hiển thị thêm `SL phân bổ cho MR` theo đơn vị MR.

Hai hành động chính:

- `Lưu nháp`;
- `Lưu & gửi duyệt`.

Không hiển thị `Đợt 1`, danh sách đợt, chủ trương tổng, tổng đã duyệt, phần vượt tổng hoặc duyệt bổ sung.

### 3.2. Xử lý hệ thống

Hệ thống có thể duy trì một bản ghi đợt kỹ thuật phía sau để dùng chung mô hình dữ liệu, nhưng người dùng không nhìn thấy hoặc thao tác với bản ghi này.

PO mua một lần:

- có một lần duyệt;
- có một QR cấp PO;
- có đúng một lần nhận kho;
- hoàn thành ngay sau khi kho xác nhận nhận hàng.

## 4. Mua nhiều đợt

### 4.1. PO tổng

PO tổng dùng để quản lý chung nhu cầu và lịch sử mua. PO tổng không có duyệt chủ trương hoặc hạn mức giá trị tổng.

PO tổng hiển thị:

- nhu cầu MR;
- đã duyệt đặt;
- đã nhận đạt;
- còn cần mua hoặc số vượt;
- tổng giá trị các đợt thực tế.

### 4.2. Tạo và duyệt đợt

Người dùng tạo từng đợt khi đã biết số lượng, giá và ngày giao. Không khai báo trước số đợt và không tạo đợt rỗng.

Mỗi đợt có hai hành động:

- `Lưu nháp`;
- `Lưu & gửi duyệt`.

Mỗi đợt được duyệt độc lập. Một đợt đã duyệt và đang chờ nhận phải được hoàn thành hoặc hủy trước khi đợt tiếp theo chuyển sang trạng thái chờ nhận. Người dùng vẫn được lập nháp đợt tiếp theo trước đó.

Không có kiểm tra vượt giá trị PO tổng, duyệt bổ sung hoặc khóa WMS/QR vì vượt tổng.

### 4.3. Mã hiển thị

Mã quản lý chính luôn là mã PO, ví dụ `PO-01`. Trên màn hình hoặc bản in đợt có thể hiển thị:

```text
Mã PO: PO-01
Đợt mua: 02
```

Mã `PO-01-L02` là tham chiếu nội bộ phục vụ truy vết, không thay thế mã PO chính.

## 5. QR cấp PO

PO sử dụng một QR ổn định. QR chứa định danh an toàn của PO, không chứa quyền thực hiện nghiệp vụ.

Khi quét QR:

1. Hệ thống mở PO.
2. Tìm đợt đã duyệt và chưa nhận.
3. Nếu có đúng một đợt, mở thẳng màn hình nhận hàng.
4. Nếu không có đợt chờ nhận, thông báo trạng thái và không cho tạo phiếu kho.
5. Nếu dữ liệu lịch sử có nhiều đợt cùng chờ nhận, hiển thị danh sách để kho chọn thay vì tự đoán.

QR được tạo hoặc kích hoạt khi PO có lần mua đầu tiên được duyệt. Các đợt sau tiếp tục sử dụng cùng QR đó.

## 6. Số lượng và đơn vị

Mỗi dòng lưu riêng:

1. `SL yêu cầu MR`: snapshot nhu cầu gốc theo đơn vị MR.
2. `SL phân bổ cho MR`: phần đợt mua dự kiến đáp ứng theo đơn vị MR.
3. `SL mua`: số lượng thương mại theo đơn vị mua.
4. `SL nhập kho`: số lượng thực tế theo đơn vị kho.

Hệ số quy đổi danh mục chỉ dùng tham khảo và không tự sửa các số lượng. Snapshot hệ số có thể được lưu để giải thích chứng từ cũ.

Các chỉ tiêu PO:

```text
Đã duyệt đặt
= tổng SL phân bổ của các lần mua đã duyệt và còn hiệu lực

Còn lại chưa đặt
= SL yêu cầu MR - Đã duyệt đặt

Đã nhận đạt
= tổng SL đạt của lần nhận đã hoàn thành

Còn lại chưa nhận
= SL yêu cầu MR - Đã nhận đạt
```

Đợt nháp, bị từ chối hoặc bị hủy không chiếm nhu cầu MR. Kết quả âm hiển thị thành `Vượt`, không che bằng số 0.

## 7. Duyệt và trạng thái

Trạng thái duyệt:

`Nháp -> Chờ duyệt -> Đã duyệt | Yêu cầu sửa | Từ chối`

Trạng thái nhận:

`Chưa nhận -> Hoàn thành | Hoàn thành có chênh lệch`

Quy tắc:

- trước khi duyệt, đợt không cho phép kho nhận;
- duyệt khóa snapshot số lượng, giá, VAT và ngày giao;
- chứng từ đã duyệt không sửa đè; nếu sai thì hủy và tạo đợt thay thế;
- mỗi đợt chỉ được hoàn tất nhận một lần;
- thao tác lặp lại phải idempotent, không sinh trùng tồn kho hoặc phiếu WMS.

## 8. Chênh lệch và chất lượng

Luồng thường ngày giả định nhà cung cấp giao đủ trong một chuyến. Hệ thống vẫn giữ ngoại lệ tối thiểu:

- kho ghi đúng số thực giao, số đạt và số không đạt;
- nếu số thực nhận hoặc số đạt khác đợt đã duyệt, bắt buộc nhập lý do;
- kho nhập số đạt và đóng đợt ở trạng thái `Hoàn thành có chênh lệch`;
- không mở lại đợt để nhận bổ sung;
- nếu cần mua bù, mua hàng tạo đợt mới.

Mua vượt MR được phép lưu nháp. Khi gửi duyệt, người dùng bắt buộc nhập lý do vượt. Không có kiểm tra vượt giá trị tổng PO.

## 9. Công nợ

PO và đợt mua không trực tiếp tạo công nợ. Công nợ phát sinh từ hóa đơn nhà cung cấp được đối chiếu với PO, đợt mua và lần nhận kho đã hoàn thành.

Trong phạm vi thay đổi này, hệ thống chỉ cung cấp số lượng thực nhận đủ điều kiện và giá/VAT của đúng đợt để luồng hóa đơn sử dụng. Không tạo quy tắc một chứng từ công nợ cho mỗi PO hoặc mỗi đợt.

## 10. Tối giản giao diện

### 10.1. Màn hình tạo PO

Thứ tự nhập liệu:

1. Chọn `Mua một lần` hoặc `Mua nhiều đợt`, mặc định `Mua một lần`.
2. Chọn nhà cung cấp.
3. Nhập trực tiếp trong một bảng vật tư.
4. Chọn ngày giao chung; chỉ mở ngày riêng theo dòng khi người dùng yêu cầu.
5. Lưu nháp hoặc gửi duyệt.

Các thông tin snapshot MR, công trình và kho nhận hiển thị dạng tóm tắt chỉ đọc. Thông tin quy đổi và ghi chú nâng cao được đặt trong phần mở rộng, không chiếm diện tích mặc định.

### 10.2. Màn hình PO nhiều đợt

Đầu trang chỉ hiển thị số tổng hợp cần điều hành. Mỗi đợt là một hàng/thẻ gọn gồm:

- số đợt và trạng thái;
- ngày giao;
- số lượng;
- giá trị;
- hành động đúng theo trạng thái.

Chỉ mở form chi tiết khi tạo hoặc sửa đợt nháp. Không lặp lại bảng nhu cầu MR ở mọi đợt.

### 10.3. Màn hình nhận hàng

Sau khi quét QR, kho chỉ thấy:

- mã PO và đợt đang nhận;
- NCC, công trình và kho;
- số được duyệt;
- các ô số thực giao, số đạt, số không đạt;
- kết quả chất lượng và ghi chú chênh lệch;
- nút `Xác nhận nhập kho`.

Không hiển thị lịch sử nhiều lần nhận, nút nhận tiếp hoặc nút kết thúc thiếu.

## 11. Tính toàn vẹn và tương thích

- PO và đợt đã duyệt/đã nhận không được xóa cứng.
- Snapshot MR, đợt duyệt và lần nhận không phụ thuộc danh mục thay đổi sau đó.
- Nhà cung cấp của đợt phải khớp PO.
- Mỗi đợt có tối đa một lần nhận hoàn thành và một tác động tồn kho.
- Mỗi PO có tối đa một đợt đã duyệt đang chờ nhận trong luồng mới.
- Dữ liệu cũ có nhiều lần nhận vẫn được hiển thị chỉ đọc; không xóa hoặc gộp lịch sử.
- Dữ liệu cũ có QR theo đợt tiếp tục tra cứu được và điều hướng về PO tương ứng.
- Luồng mới chỉ phát hành QR cấp PO.

## 12. Ngoài phạm vi

- Hợp đồng khung hoặc call-off PO.
- Đề nghị duyệt chủ trương tổng.
- Tổng hạn mức đã duyệt và duyệt bổ sung.
- Nhiều chuyến hoặc nhiều lần nhận cho một đợt mới.
- Mở lại đợt đã nhận để nhập bổ sung.
- Tự động quy đổi giữa các đơn vị khác bản chất như Cây và Kg.
- Thay đổi luồng xuất kho hiện tại.
- Hoàn thiện phân hệ hóa đơn và thanh toán.

## 13. Tiêu chí nghiệm thu

### PO mua một lần

- Mặc định là mua một lần và chỉ hiển thị một form đặt hàng.
- Không hiển thị `Đợt 1`, chủ trương tổng hoặc số tổng duyệt.
- Lưu và gửi duyệt tạo đúng một cam kết mua phía sau.
- QR PO mở đúng lần mua đang chờ nhận.
- Kho xác nhận đúng một lần và PO chuyển hoàn thành.

### PO mua nhiều đợt

- Một PO chỉ có một NCC và nhiều đợt mua độc lập.
- Mỗi đợt có số lượng, giá, VAT, ngày giao và phê duyệt riêng.
- Không tạo đợt rỗng hoặc yêu cầu khai báo trước số đợt.
- Không cho hai đợt mới cùng ở trạng thái đã duyệt chờ nhận.
- Hoàn thành đợt trước mới kích hoạt nhận đợt tiếp theo.
- Không kiểm tra vượt giá trị tổng hoặc tạo duyệt bổ sung.

### Nhận hàng

- Một đợt mới chỉ có một lần nhận và một tác động tồn kho.
- Quét cùng QR hoặc gửi lại lệnh xác nhận không sinh trùng phiếu kho.
- Chênh lệch bắt buộc có lý do và kết thúc đợt ngay trong lần nhận.
- Mua bù được tạo thành đợt mới, không nhận tiếp vào đợt cũ.
- Dữ liệu lịch sử nhiều lần nhận vẫn xem được mà không bị thay đổi.

### Số lượng và giao diện

- MR giữ nguyên số lượng và đơn vị gốc.
- Đơn vị giống nhau chỉ hiển thị một ô số lượng.
- Đơn vị khác nhau hiển thị riêng SL phân bổ MR và SL mua.
- Còn lại nhu cầu chỉ tính các đợt đã duyệt còn hiệu lực.
- Form mặc định không hiển thị các trường kỹ thuật, quy đổi hoặc tài chính tổng hợp không cần nhập.

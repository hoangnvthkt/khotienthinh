# Thiết kế đơn giản hóa MR → PO → đợt đặt hàng → nhập kho

**Ngày:** 2026-08-25  
**Trạng thái:** Đã thống nhất nghiệp vụ, chờ duyệt đặc tả trước khi lập kế hoạch triển khai

## 1. Mục tiêu

Thiết kế một luồng mua hàng thống nhất cho hai trường hợp:

- mua một lần, là trường hợp phổ biến;
- mua chia nhiều đợt, chủ yếu áp dụng cho sắt thép hoặc vật tư có khối lượng, giá và thời điểm giao thay đổi.

Luồng phải giữ MR làm nhu cầu gốc, cho phép mua thiếu hoặc mua vượt có kiểm soát, không dùng hệ số quy đổi để tự sinh số lượng và ghi nhận chính xác số lượng thực nhập. Trường hợp mua một lần phải có ít thao tác nhất; trường hợp nhiều đợt vẫn phải theo dõi được tổng nhu cầu trên cùng một PO gốc.

Phạm vi nghiệp vụ:

`BOQ kế hoạch → MR → PO gốc → đợt đặt hàng → lần nhập kho → báo cáo nhập/xuất/tồn so với BOQ`

Phần xuất kho giữ nguyên luồng hiện tại và không liên kết với MR hoặc từng dòng BOQ.

## 2. Nguyên tắc nguồn dữ liệu

### 2.1. BOQ

BOQ là kế hoạch tổng theo công trình và vật tư. BOQ không giới hạn cứng số lượng đề xuất, mua, nhập hoặc xuất.

### 2.2. MR

MR là nhu cầu thực tế của công trường. Nhu cầu có thể khác BOQ. Sau khi MR được duyệt, mỗi dòng MR cung cấp snapshot bất biến gồm:

- mã và tên vật tư;
- số lượng yêu cầu;
- đơn vị yêu cầu;
- công trình, kho nhận, ngày cần và ghi chú;
- tham chiếu BOQ nếu có.

PO tạo từ MR phải sao chép đúng số lượng và đơn vị yêu cầu. Không chuyển số lượng MR sang đơn vị mua bằng hệ số danh mục.

### 2.3. PO gốc

PO gốc là hồ sơ quản lý nhu cầu mua với một nhà cung cấp. PO gốc giữ:

- MR nguồn và snapshot các dòng nhu cầu;
- công trình và kho nhận;
- nhà cung cấp;
- chế độ giao một lần hoặc nhiều đợt;
- đề nghị duyệt chủ trương tổng tùy chọn;
- danh sách các đợt đặt hàng;
- các số tổng hợp về đặt hàng, giao nhận và giá trị.

PO gốc không phải nguồn số lượng thương mại hoặc giá trị thực tế. Một MR có thể sinh nhiều PO nếu mua từ nhiều nhà cung cấp; mỗi PO chỉ có một nhà cung cấp và các đợt không được đổi nhà cung cấp.

### 2.4. Đợt đặt hàng

Đợt đặt hàng là cam kết mua thực tế và là đơn vị được duyệt. Mỗi dòng đợt lưu độc lập:

- số lượng đáp ứng nhu cầu và đơn vị MR;
- số lượng mua thương mại và đơn vị mua;
- đơn giá theo đơn vị mua;
- VAT;
- ngày dự kiến giao, có thể chưa xác định;
- lý do vượt MR nếu có;
- snapshot hệ số quy đổi chỉ để giải thích/tham khảo, nếu cần.

Thành tiền đợt được tính từ số lượng mua thương mại và đơn giá của chính đợt. Số lượng đáp ứng nhu cầu và số lượng mua thương mại không tự tính lại lẫn nhau.

### 2.5. Lần nhập kho

Một đợt đặt hàng đã duyệt được phép có nhiều lần nhập kho. Mỗi lần nhập là một chứng từ WMS độc lập và lưu:

- số lượng thương mại thực giao;
- số lượng lưu kho thực tế;
- số lượng đạt, không đạt hoặc bị từ chối;
- kết quả chất lượng;
- ghi chú, ảnh và chứng từ giao hàng nếu có.

Tồn kho chỉ tăng từ số lượng lưu kho thực tế được chấp nhận. Công nợ sử dụng số lượng mua thực nhận đủ điều kiện nhân với đơn giá của đợt.

## 3. Hai trải nghiệm mua hàng, một mô hình dữ liệu

### 3.1. Điểm bắt đầu chung

Tại MR đã duyệt, người mua bấm `Tạo đơn đặt hàng`. Hệ thống tự mang toàn bộ thông tin MR sang. Người mua chỉ chọn nhà cung cấp, cách giao hàng và nhập các điều khoản thương mại.

Chế độ mặc định là `Giao một lần` vì đây là trường hợp phổ biến.

### 3.2. Giao một lần

Người dùng thấy một form PO thông thường và không phải thao tác với khái niệm đợt. Khi lưu, hệ thống tự tạo PO gốc và Đợt 1 ở phía sau.

Nếu đơn vị MR và đơn vị mua giống nhau, giao diện chỉ hiển thị một ô số lượng đặt mua; dữ liệu nội bộ sử dụng cùng giá trị cho số lượng đáp ứng nhu cầu và số lượng thương mại.

Nếu hai đơn vị khác nhau, giao diện hiển thị hai ô độc lập:

- `SL đáp ứng nhu cầu (<ĐVT MR>)`;
- `SL mua (<ĐVT mua>)`.

Các trường còn lại gồm ngày dự kiến giao, đơn giá, VAT và ghi chú. Hai hành động chính là `Lưu & gửi duyệt` và `Lưu nháp`.

### 3.3. Chia nhiều đợt

Sau khi chọn `Chia nhiều đợt`, form mua đầu tiên được trình bày thành `Đợt đặt hàng 1`. Người dùng chỉ tạo các đợt đã biết, không phải khai báo trước tổng số đợt và không tạo đợt rỗng.

Sau khi có PO gốc, người dùng thêm đợt tiếp theo bằng `+ Thêm đợt đặt hàng`. Mỗi đợt dùng cùng một form và có trạng thái, bản in, giá, VAT, ngày giao và luồng duyệt riêng.

PO gốc hiển thị các chỉ tiêu:

- nhu cầu MR;
- đã gửi duyệt;
- đã duyệt đặt;
- đã nhập đạt;
- còn cần mua hoặc số vượt nhu cầu;
- giá trị dự kiến, cam kết và thực nhận ở khu vực tài chính riêng.

## 4. Hệ số quy đổi

Hệ số quy đổi giữa đơn vị mua và đơn vị lưu kho chỉ là thông tin tham khảo.

Ví dụ:

> Danh mục tham khảo: 1 Cây ≈ 17,84 Kg. Không dùng để tự tính số lượng.

Hệ thống có thể hiển thị số quy đổi tham khảo nhưng không được:

- tự điền số lượng mua;
- tự sửa số lượng đáp ứng nhu cầu;
- cập nhật chứng từ cũ khi hệ số danh mục thay đổi;
- dùng hệ số tham khảo để tính tiến độ MR, tồn kho hoặc công nợ.

Quy đổi chính xác cùng đại lượng, ví dụ Tấn ↔ Kg, được phép dùng để chuẩn hóa hiển thị và báo cáo. Quy đổi khác bản chất, ví dụ Cây ↔ Kg, không được dùng làm số liệu thật.

## 5. Đề nghị duyệt chủ trương tổng tùy chọn

Tùy chọn này chỉ xuất hiện khi PO chọn `Chia nhiều đợt`:

`□ Lập đề nghị duyệt chủ trương tổng`

Khi bật, giao diện mở khối `Dự toán tổng để trình duyệt`, gồm:

- nhu cầu MR chỉ đọc;
- số lượng dự kiến mua và đơn vị mua;
- giá và VAT dự kiến;
- tổng giá trị dự kiến;
- thời gian mua/giao dự kiến;
- ghi chú;
- thao tác lưu nháp và in.

Đề nghị tổng là snapshot dự toán phục vụ in trình duyệt. Nó không:

- tạo WMS hoặc QR;
- ghi nhận số lượng đã đặt;
- làm giảm số lượng còn cần mua;
- tạo công nợ;
- khóa số lượng hoặc giá của các đợt;
- thay thế duyệt từng đợt;
- tạo hạn mức cứng cho các đợt sau.

Mỗi lần phát hành/in phải lưu snapshot có phiên bản để tái hiện đúng chứng từ cũ. Sau khi có dữ liệu, người dùng dùng `Thu gọn/Mở rộng` để ẩn hoặc hiện nội dung. Tắt tùy chọn mang nghĩa xóa bản dự toán và phải xác nhận nếu đã có dữ liệu.

## 6. Duyệt và trạng thái đợt

Trạng thái duyệt và trạng thái giao nhận phải được tách riêng.

Trạng thái duyệt:

`Nháp → Chờ duyệt → Đã duyệt | Yêu cầu sửa | Từ chối`

Trạng thái giao nhận:

`Chưa giao → Đang giao → Đã hoàn tất`

Quy tắc:

- Tạo đợt chỉ tạo bản nháp, chưa có WMS hoặc tác động tồn kho.
- Gửi duyệt sinh chứng từ `PO-xxx / Đợt n`.
- Duyệt đợt khóa snapshot số lượng, giá và VAT; sinh quyền nhận hàng và QR ổn định cho đợt.
- QR đại diện cho đợt và được dùng để mở nhiều lần nhập; mỗi lần nhập mới sinh chứng từ WMS riêng.
- Yêu cầu sửa hoặc từ chối không tác động kho.
- Đợt đã duyệt không được sửa trực tiếp; thay đổi phải qua luồng điều chỉnh có lịch sử.

Mỗi thẻ đợt hiển thị hành động theo trạng thái thay vì dùng một nút chung cho toàn PO.

## 7. Mua thiếu, mua vượt và ngoại lệ giao nhận

### 7.1. So với MR

Mua thiếu được phép và chỉ hiển thị số còn thiếu. Mua vượt được phép nhưng khi gửi duyệt bắt buộc nhập lý do ngắn. Lưu nháp không bị chặn.

Số lượng còn cần đặt theo đơn vị MR:

`MR − tổng SL đáp ứng nhu cầu của các đợt đã duyệt`

Kết quả âm phải hiển thị thành `Vượt ...`, không che bằng số 0.

### 7.2. So với đợt đã duyệt

Kho luôn ghi nhận đúng thực tế:

- giao thiếu: đợt tiếp tục mở hoặc được người có quyền kết thúc thiếu;
- giao vượt: kho vẫn ghi đúng số nhận, bắt buộc ghi chú và đánh dấu ngoại lệ;
- phần vượt cần được mua hàng xác nhận trước khi chốt công nợ;
- tồn kho vẫn phản ánh số lượng thực tế đã được kiểm tra và chấp nhận.

Kho có hai thao tác kết thúc lần nhận:

- `Xác nhận lần nhập` để đợt tiếp tục nhận;
- `Xác nhận & kết thúc đợt` khi nhà cung cấp không giao tiếp.

## 8. Tính toán số lượng và giá trị

Các mốc số lượng không ghi đè lẫn nhau:

| Mốc | Nguồn sự thật |
|---|---|
| BOQ kế hoạch | BOQ công trình |
| MR yêu cầu | Snapshot dòng MR đã duyệt |
| Đã duyệt đặt | Tổng SL đáp ứng nhu cầu của các đợt đã duyệt |
| SL mua cam kết | Tổng SL thương mại của các đợt đã duyệt |
| Đã nhận đạt | Tổng SL lưu kho đạt của các lần nhập |
| SL mua thực nhận | Tổng SL thương mại đạt của các lần nhập |
| Đã xuất kho | Các giao dịch xuất kho hiện tại |

Giá trị cũng được tách:

- giá trị chủ trương dự kiến: chỉ tham khảo;
- giá trị đợt đã duyệt: cam kết mua;
- giá trị nhận đạt: số lượng mua thực nhận đạt × đơn giá đợt;
- công nợ: giá trị nhận đạt đủ điều kiện sau khi xử lý ngoại lệ và VAT.

Không dùng số lượng hoặc giá của đề nghị tổng để tính công nợ.

## 9. Nhập kho và xuất kho

### 9.1. Nhập kho

Kho mở đợt bằng QR hoặc danh sách chờ nhận. Màn hình hiển thị số lượng đợt đã duyệt, đã nhận trước đó, còn chờ giao và lịch sử các lần nhập.

Thao tác thường ngày:

`Quét QR → nhập SL/CL thực tế → xác nhận`

Kho không cần biết PO là giao một lần hay nhiều đợt.

### 9.2. Xuất kho

Luồng xuất kho giữ nguyên hiện trạng:

- còn tồn khả dụng thì được xuất;
- không chọn hoặc kiểm tra MR;
- không chọn hoặc kiểm tra dòng BOQ;
- không chặn theo nhu cầu hay kế hoạch;
- chỉ tuân thủ các kiểm soát tồn kho hiện có.

Sau khi hàng nhập, vật tư trở thành tồn kho chung của công trình. Thiết kế này không bổ sung truy vết phiếu xuất về MR hoặc đợt mua.

## 10. Báo cáo BOQ tổng

BOQ chỉ được so sánh tổng hợp theo `Công trình + Vật tư`. Báo cáo hiển thị:

- BOQ kế hoạch;
- lũy kế nhập kho;
- lũy kế xuất kho;
- tồn hiện tại;
- chênh lệch nhập so với BOQ;
- chênh lệch xuất so với BOQ.

Các số phải được đưa về cùng đơn vị bằng quy đổi chính xác cùng đại lượng. Nếu BOQ và tồn kho dùng hai đơn vị khác bản chất thì báo cáo hiển thị riêng, không dùng hệ số tham khảo để ép so sánh.

MR không tham gia kiểm soát xuất kho và không phải khóa liên kết cho báo cáo BOQ tổng.

## 11. Tính toàn vẹn và khả năng phục hồi

- Các lệnh gửi duyệt, duyệt đợt và xác nhận nhập phải có tính idempotent để thao tác lại không sinh trùng chứng từ.
- Duyệt đợt chỉ sinh quyền nhận/QR một lần; mỗi lần nhận sinh đúng một giao dịch WMS sau khi xác nhận.
- Chứng từ đã duyệt hoặc đã nhận không được xóa cứng; sử dụng điều chỉnh, hủy hoặc đảo nghiệp vụ có lịch sử.
- Snapshot MR, đề nghị tổng, đợt đã duyệt và lần nhập không phụ thuộc dữ liệu danh mục thay đổi sau đó.
- Nhà cung cấp của đợt phải luôn khớp nhà cung cấp PO gốc.
- Các phép tổng hợp phải lọc đúng trạng thái; nháp, từ chối và đã hủy không được tính là cam kết mua.

## 12. Tương thích dữ liệu hiện có

- PO giao một lần cũ tiếp tục hoạt động; giao diện mới có thể trình bày nó như PO thông thường trong khi dữ liệu nội bộ dùng Đợt 1.
- PO nhiều đợt đã duyệt hoặc đã nhận giữ nguyên số lượng và lịch sử chứng từ; không tính lại bằng hệ số hiện tại.
- PO nhiều đợt đang mở phải lấy lại baseline MR từ liên kết nguồn, không quy đổi baseline sang đơn vị mua.
- PO-408 phải giữ baseline D16 là `1.187 Cây`; Đợt 1 giữ độc lập `1.187 Cây`, `21.176 Kg` và giá hiện có.
- PO nhiều đợt cũ không mặc nhiên có đề nghị duyệt chủ trương tổng; người có quyền có thể lập mới nếu nghiệp vụ còn mở.

## 13. Ngoài phạm vi

- Quản lý xuất kho theo MR hoặc dòng BOQ.
- Phân bổ vật tư xuất cho từng hạng mục BOQ.
- Tự động quy đổi Cây ↔ Kg hoặc các đơn vị khác bản chất.
- Cho phép đổi nhà cung cấp ở cấp đợt.
- Dùng đề nghị chủ trương tổng làm hạn mức cứng.
- Tự tạo trước các đợt chưa biết ngày, số lượng hoặc giá.

## 14. Tiêu chí nghiệm thu

### Tạo PO

- Tạo PO từ MR sao chép đúng số lượng và đơn vị MR, không tự quy đổi.
- Chế độ mặc định là giao một lần.
- Giao một lần chỉ cần một form; hệ thống tự tạo cấu trúc Đợt 1 bên dưới.
- Một PO chỉ có một nhà cung cấp; cùng MR có thể tạo PO khác cho nhà cung cấp khác.

### Đơn vị và số lượng

- Đơn vị giống nhau chỉ cần một ô số lượng trên giao diện.
- Đơn vị khác nhau hiển thị hai ô độc lập và hệ số tham khảo.
- Thay đổi hệ số danh mục không thay đổi PO, đợt, bản in hoặc lần nhập đã lưu.
- Mua vượt MR chỉ gửi duyệt được khi có lý do; lưu nháp vẫn được.

### Đề nghị chủ trương tổng

- Chỉ xuất hiện cho PO nhiều đợt và là tùy chọn.
- Bản in lưu được snapshot/phiên bản và tái hiện đúng nội dung cũ.
- Lập, sửa hoặc in đề nghị tổng không thay đổi số lượng đã đặt, tồn kho, WMS hoặc công nợ.
- Các đợt sau được phép có số lượng và giá khác dự toán tổng.

### Duyệt và nhận hàng

- Mỗi đợt có luồng duyệt và bản in riêng.
- Không có WMS hoặc tác động kho trước khi đợt được duyệt và hàng được xác nhận nhận.
- Một QR đợt có thể tạo nhiều lần nhập độc lập mà không sinh trùng.
- Giao thiếu, giao vượt, hàng không đạt và kết thúc thiếu được ghi nhận rõ.
- Công nợ dùng số lượng mua thực nhận đủ điều kiện và giá/VAT của đúng đợt.

### Kho và BOQ

- Xuất kho hiện tại không phát sinh thêm trường hoặc kiểm soát MR/BOQ.
- Báo cáo theo công trình và vật tư hiển thị BOQ, nhập, xuất, tồn và chênh lệch.
- Báo cáo chỉ tự chuẩn hóa các đơn vị có quy đổi chính xác cùng đại lượng.

### Hồi quy và dữ liệu cũ

- PO một lần, PO chủ động và PO đã nhận hàng tiếp tục hoạt động.
- Dữ liệu lịch sử không bị tính lại hoặc thay đổi vì hệ số danh mục.
- PO-408 hiển thị đúng baseline MR và dữ liệu riêng của Đợt 1.


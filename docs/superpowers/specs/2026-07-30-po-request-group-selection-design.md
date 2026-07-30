# Gom và chọn dòng đề xuất khi tạo PO

## Mục tiêu

Trong hộp thoại **Tạo PO từ đề xuất công trường**, gom các dòng vật tư theo phiếu đề xuất (`request.code`) để người dùng chọn nhanh toàn bộ vật tư của một phiếu, nhưng vẫn có thể thay đổi lựa chọn ở từng vật tư.

## Phạm vi

- Áp dụng cho danh sách dòng đề xuất trong luồng tạo PO mới và thêm vào PO hiện có.
- Không thay đổi dữ liệu đề xuất, số lượng, hay quy tắc tạo PO sau khi người dùng xác nhận.

## Thiết kế giao diện và hành vi

1. Danh sách được chia thành các nhóm theo mã phiếu đề xuất. Mỗi nhóm có phần đầu nhóm hiển thị mã phiếu, thông tin công trường/kho và checkbox nhóm.
2. Checkbox nhóm có ba trạng thái:
   - Không chọn: không có dòng nào trong nhóm được chọn.
   - Chọn: mọi dòng trong nhóm được chọn.
   - Chọn một phần: có ít nhất một, nhưng không phải mọi dòng, được chọn.
3. Bấm checkbox nhóm sẽ chọn hoặc bỏ chọn toàn bộ dòng hiện có trong nhóm.
4. Bấm checkbox của một dòng chỉ thay đổi dòng đó. Trạng thái checkbox nhóm được tính lại từ các dòng đã chọn.
5. Mỗi dòng vẫn hiển thị số liệu tồn, đã chốt, PO mở và còn lại như hiện tại. Các dòng của nhóm hiển thị liền nhau để dễ rà soát.
6. Khi người dùng xác nhận tạo/thêm PO, chỉ các dòng được chọn cuối cùng được đưa vào xử lý. Các kiểm tra mã vật tư và liên kết nguồn hiện có tiếp tục áp dụng như trước.

## Kiến trúc

- Tách logic nhóm và tính trạng thái chọn nhóm thành các hàm thuần, dùng khóa dòng ổn định đang có trong danh sách.
- `SupplyChainTab` giữ `selectedRequestLineKeys` là nguồn dữ liệu duy nhất cho lựa chọn; nhóm không có state riêng để tránh lệch trạng thái.
- Các handler checkbox nhóm chỉ thêm/xóa khóa các dòng thuộc nhóm; handler checkbox dòng hiện tại tiếp tục dùng được.

## Xử lý biên

- Một nhóm chỉ có một dòng vẫn hoạt động như checkbox chọn cả nhóm.
- Dòng không đủ điều kiện tạo PO vẫn tuân theo điều kiện lọc/cảnh báo hiện hữu; checkbox nhóm chỉ tác động đến các dòng đang hiển thị thuộc nhóm.
- Nếu danh sách tải lại, trạng thái chọn được đối chiếu với các khóa dòng hợp lệ đang tải.

## Kiểm thử

- Unit test cho gom nhóm và ba trạng thái checkbox.
- Unit test cho thao tác chọn/bỏ chọn cả nhóm mà không ảnh hưởng nhóm khác.
- Kiểm thử giao diện xác nhận việc bỏ chọn một dòng sau khi đã chọn cả nhóm cho trạng thái "chọn một phần".
- Chạy toàn bộ test và kiểm tra kiểu TypeScript trước khi bàn giao.

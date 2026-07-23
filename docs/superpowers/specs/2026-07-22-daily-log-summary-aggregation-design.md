# Tổng hợp dữ liệu nhật ký ngày

## Mục tiêu

Khi người tổng hợp chọn nhiều phiếu nhật ký nguồn trong cùng ngày, bản tổng hợp phản ánh dữ liệu thi công của tất cả phiếu đã chọn, không chỉ phần mô tả và ảnh.

## Phạm vi

- Gộp nội dung thi công, vấn đề, kế hoạch ngày sau và ảnh theo hành vi hiện có.
- Cộng dồn khối lượng, nhân công và ca máy.
- Không đưa vật tư vào bản tổng hợp.
- Chỉ dùng các phiếu nguồn được người tổng hợp chọn trong modal.

## Quy tắc gộp

### Khối lượng

- Nhóm theo hạng mục BOQ, công việc hoặc hạng mục hợp đồng; kèm đơn vị.
- Cộng `quantity` của mọi dòng cùng nhóm.
- Giữ ghi chú và bằng chứng đính kèm đầu tiên không rỗng; hợp nhất các tệp đính kèm, loại trùng theo định danh hoặc URL.

### Nhân công

- Nhóm theo hạng mục/công việc, loại hoặc nhóm nhân công, đối tác và đơn vị.
- Cộng số lượng người (`count`) và giờ công (`hours`) của mọi dòng cùng nhóm.
- Giữ đơn giá và ghi chú đầu tiên không rỗng để không suy diễn giá trị mới.

### Ca máy

- Nhóm theo hạng mục/công việc, loại máy, đối tác và đơn vị.
- Cộng số ca (`shifts`) và giờ máy (`hours`) của mọi dòng cùng nhóm.
- Giữ đơn giá và ghi chú đầu tiên không rỗng.

### Vật tư

- Bản tổng hợp luôn lưu danh sách vật tư rỗng.
- Dữ liệu vật tư độc lập vẫn còn nguyên trong từng phiếu nguồn.

## Luồng lưu

1. Modal lấy các phiếu nguồn được chọn.
2. Hàm thuần tạo ba mảng tổng hợp: khối lượng, nhân công, ca máy.
3. `dailyLogService.upsert` lưu ba mảng vào các bảng chi tiết chuẩn hóa của bản tổng hợp.
4. Liên kết phiếu nguồn vẫn được giữ trong metadata hiện có để truy vết.

## Kiểm thử

- Hai dòng khối lượng cùng hạng mục 10 và 20 phải thành 30.
- Hai dòng nhân công cùng nhóm cộng số người và giờ công.
- Hai dòng ca máy cùng nhóm cộng số ca và giờ máy.
- Vật tư nguồn không xuất hiện ở bản tổng hợp.
- Các dòng khác nhóm vẫn được giữ riêng.

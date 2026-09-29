# Nhật ký công trường — Kế hoạch Đợt 2

Chủ sản phẩm duyệt ngày 29/09/2026. Đợt 1 (thông báo từng bước, mở khóa quyền
công bố, sửa chỉ số) đã lên production ở PR #15.

## Quyết định chủ sản phẩm

| Chủ đề | Quyết định |
| --- | --- |
| Người tổng hợp tự duyệt | Được phép. KTT tổng hợp; thiếu nhân sự thì CHT tự tổng hợp và duyệt. |
| % tiến độ | Kỹ sư nhập tay % (khối lượng vẫn nhập được nếu muốn). |
| "Mũi chưa gửi" | Tự suy: mũi có phiếu trong 7 ngày gần nhất mà hôm nay chưa có phiếu. |
| Tổ đội | Là đối tác trong danh mục đối tác, thêm loại "Tổ đội". |
| Công nhật | Hỗ trợ cả hai cách quy đổi, chọn theo từng dòng hợp đồng: 1 công = 8 giờ (người × giờ ÷ 8) hoặc 1 công = 1 người/ngày. |
| Dự án thử | RICO (đã hoàn thành, Room đủ nhân sự), chỉ bật chế độ thử nghiệm: duyệt để đối chiếu, không ghi tiến độ chính thức. SMB-2026 và DA29 là dự án thật đang chạy; các dự án "chưa có tiến độ" khác chỉ là dữ liệu tham khảo. |
| Giờ máy | Hai nguồn: máy công ty và máy thuê. Bài toán giờ máy chạy thực tư vấn sau. |

## 2A. Màn hình "Hôm nay tại công trường"

Chỉ hiện ở dự án đã bật luồng phiếu kỹ sư (pilot/enforced); dự án khác giữ màn
hình cũ.

- Hàm `get_daily_log_today_board_v1`: phiếu trong ngày theo mũi (hạng mục, % lũy
  kế, nhân công, giờ máy, ảnh, sự cố), mũi chưa gửi, bản tổng hợp, số liệu hôm
  qua, dải 7 ngày. Người có quyền "Xem" trong Room Nhật ký thấy các phiếu đã gửi
  của dự án; phiếu nháp chỉ tác giả thấy; không có quyền Xem thì bị từ chối.
- Giao diện: tiến trình 4 bước, "Việc của bạn" theo vai trò, "Cần chú ý"
  (hạng mục trễ, sự cố, phiếu bị trả, mũi chưa gửi), 4 chỉ số so với hôm qua,
  thẻ theo mũi có ảnh xem trước, dải 7 ngày. Danh sách cũ đổi tên "Lịch sử nhật ký".

## 2B. Làm gọn phiếu kỹ sư và báo cáo CHT

- Viết lại chữ cho người công trường; màu có nghĩa thống nhất (xanh đạt, vàng
  chờ, đỏ trễ hoặc sự cố); ảnh xem trước và xem ảnh lớn.
- Phiếu kỹ sư mặc định nhập %; bớt phần tiêu đề trên điện thoại.
- Người tổng hợp: thời tiết, nội dung, sự cố điền sẵn từ phiếu.
- Báo cáo đã duyệt: "Tạo bản điều chỉnh" thành thao tác phụ.

## 2C. Nhân công gắn hợp đồng

Hiện trạng production (29/09): 5 hợp đồng giao khoán nhân công, chưa hợp đồng
nào có dòng đơn giá; nhà thầu phụ chỉ lưu bằng tên. 827 dòng nhân công cũ, 685
dòng ghi chung "Tổ đội", phần còn lại gõ tên tổ không thống nhất.

1. Loại đối tác "Tổ đội"; hợp đồng giao khoán gắn đối tác bằng mã.
2. Dòng hợp đồng giao khoán: đơn vị (công, m³, tấn…), đơn giá, cách quy đổi công.
3. Phiếu kỹ sư: chọn tổ đội có hợp đồng tại dự án → chọn dòng công việc → số
   người, số giờ. Tổ chưa có: gõ tay, gắn nhãn "Chờ gắn hợp đồng".
4. Màn "Gắn hợp đồng" cho QS: gom tên gần giống, ghép một lần có audit; tùy chọn
   ghép cả dữ liệu cũ.
5. Nghiệm thu: theo khối lượng (chuỗi có sẵn: nghiệm thu từ khối lượng nhật ký →
   chứng chỉ thanh toán) và theo công nhật (mới: cộng dòng nhân công CHT đã duyệt
   theo dòng hợp đồng × đơn giá). Chỉ dòng đã gắn hợp đồng mới được tính.

# Lỗi và chỗ khó dùng phát hiện khi viết sổ tay (23/10/2026)

Đợt 1 hỗ trợ người dùng: 6 nhóm đọc mã từng module để viết 168 mục sổ tay đúng màn thật. Trong lúc đọc, các nhóm ghi lại chỗ mã làm sai,
báo sai hoặc khiến người dùng vướng. Chưa sửa gì trong danh sách này; chủ SP chọn mục cần làm. Mức: **Lỗi** = làm sai / mất chức năng,
**Khó dùng** = làm được nhưng dễ nhầm.

## Ưu tiên cao (người dùng đang vướng thật)

| # | Module | Mức | Vấn đề | Ghi chú |
|---|---|---|---|---|
| 1 | Tin nhắn | Lỗi | Mở thẳng /chat hoặc dùng Trung tâm điều hành: **Tạo hội thoại** ra danh sách người trống, nút Tạo mờ | Khớp góp ý thật "không bấm chọn được đối tượng". `AppDataWarmup` / `embedDataModules` không nạp danh bạ cho /chat |
| 2 | Tài chính | Lỗi | Người trong ma trận duyệt chi nhận thông báo nhưng thiếu quyền Tài chính · Xem thì màn duyệt không mở — nút duyệt duy nhất nằm ở đó | |
| 3 | Tài sản | Lỗi | Bảo trì tài sản: người không phải Admin lưu thất bại nhưng màn vẫn báo thành công (lỗi chỉ ra console) | RLS chỉ cho Admin sửa |
| 4 | Quy trình | Lỗi | /wf không có cách hủy phiếu đang chạy (hộp hủy / mở lại có mã nhưng không nút nào mở); quyền "Hủy phiên quy trình" không dùng | |
| 5 | Quy trình | Khó dùng | Phiếu bị "Yêu cầu bổ sung": người lập không sửa được tiêu đề / trường, chỉ thêm Thảo luận | Chỉ Admin / Quản trị phiên mới thấy Chỉnh sửa |
| 6 | Trợ lý | Khó dùng | Trợ lý chỉ có trong Trung tâm điều hành (đang thí điểm): người được cấp AI mà chưa bật Center thì không dùng được; menu "Trợ lý AI" dẫn tới /ai (chỉ Quản trị AI) | Ảnh hưởng trực tiếp Đợt 1 |
| 7 | Mua hàng | Khó dùng | Đơn đã duyệt không có nút **Hủy đơn** — phải Hủy đợt rồi Kết thúc thiếu | |
| 8 | Đề xuất vật tư | Khó dùng | Đã gửi thì người đề xuất không tự rút lại được, phải nhờ người duyệt Trả lại | |

## Nhân sự

- Khó dùng: **Sửa thông tin** cho nhân viên tự đổi Họ tên, Ngày sinh ngay; trong khi **Đề nghị cập nhật → Thông tin khác** ghi "sai tên, ngày sinh" phải qua HR duyệt — hai đường mâu thuẫn.
- Lỗi: đề xuất chấm công bù đã gửi không hủy được; link `/hrm/attendance?tab=proposals` (không kèm `&proposal=`) tự bật form tạo đề xuất, người duyệt bấm link cũng bị bật form.
- Khó dùng: "Công tháng của tôi" mở từ menu ra tháng trước, từ ô Tìm kiếm ra tháng này.
- Lỗi: Lịch của tôi không tự cập nhật sau khi chấm công; nút **Tải lại** đầu màn cũng không làm mới lịch.
- Khó dùng: Phiếu lương không có ô chọn tháng, không in được.
- Khó dùng: đặt quản lý trực tiếp hỏi lý do bằng hộp thoại trình duyệt (`window.prompt`).
- Sai chữ: ô Check-in trang chủ ghi "Chấm công GPS & Wifi" nhưng không dùng Wifi.
- Khó dùng: người duyệt không thống nhất — chấm bù theo quản lý địa điểm; nghỉ phép người ở công trường theo người duyệt công trường, còn lại theo sơ đồ tổ chức (sổ tay đã ghi rõ từng mục).

## Tài chính, Hợp đồng

- Khó dùng: đề nghị chi bị từ chối / rút / hủy không hiện ở màn nào (máy chủ có, giao diện không có tab); "phiếu chi khác" mất hẳn.
- Sai chữ: màn Phải thu trống bảo thêm HĐ chủ đầu tư ở "Dự án → Hợp đồng" (tab chỉ xem); đúng là Hợp đồng → HĐ Nhận thầu.
- Lỗi: HĐ NCC — form **Thêm đơn giá** hiện cả với người chỉ xem.
- Khó dùng: xóa HĐ NCC là xóa hẳn, xóa đối tác chỉ ngừng dùng.
- Sai chữ: form đối tác ghi "Tên/Mã khách hàng" cả với NCC, tổ đội.

## Mua hàng, Kho

- Lỗi: thao tác nhanh "Lập phiếu xuất kho", "Chuyển kho", "Kiểm kê kho" vẫn mở màn cũ `/operations`, `/audit`; "Lập phiếu xuất kho" đòi tab `EXPORT` không có ở `/operations`.
- Khó dùng: Trả hàng NCC chỉ tạo được từ màn PO dự án cũ, không có ở ngăn đơn trong Mua hàng.
- Sai chữ: duyệt kiểm kê báo "Chỉ Admin hoặc quản trị kho" nhưng máy chủ cho cả quyền Duyệt ngoại lệ.
- Khó dùng: ô chọn vật tư trong form đề xuất không có lối sang **Đề xuất mã mới**, phải rời form.
- Khó dùng: menu "⋯" ở Kho (Trả lại · quyết toán xuất cấp, Đối chiếu) mở màn kiểu cũ.

## Dự án, Nhật ký

- Sai chữ: màn trống khi thiếu quyền tab ghi "Cài đặt → Phân quyền module → DA - Dự án", nhưng tab Nhật ký, Tiến độ, Kế hoạch, Chất lượng, An toàn cấp ở tab Phân quyền của dự án.
- Sai chữ: màn "cần liên kết công trường HRM" bảo bấm nút "Dự án" (thật là **Sửa**) và hiện chữ kỹ thuật "HrmConstructionSite".
- Lỗi: tab Tổ chức — người đã "Kết thúc phân công" không thêm lại được, Sửa không mở lại; chỉ có cách Xóa dòng cũ (mất lịch sử).
- Khó dùng: chỉ khi Admin tạo dự án thì người được chọn mới tự có quyền Room; người khác tạo thì chỉ thấy cảnh báo "Chưa phân quyền Room".
- Lỗi: **Xuất PDF** nhật ký im lặng khi trình duyệt chặn cửa sổ bật lên.
- Khó dùng: trình xem ảnh không vuốt phóng to trên điện thoại (chỉ nút +/−); ảnh trong phiếu đang soạn mở tab mới.
- Sai chữ: màn Đa dự án (`/da/portfolio`) có tiêu đề "Trung tâm điều hành", trùng tên giao diện Trung tâm.
- Đã sửa trong PR này: hướng dẫn Dự án mục 4.3 (nút thật **Thêm dự án**) và 10.4 (dự án dùng Nhật ký thì % trên Gantt bị khóa).

## Quy trình, Văn bản, Đặt xe, Tài sản

- Thiếu: /wf không in / xuất Word được phiếu (`handleExportWord` có nhưng không có nút).
- Lỗi: "Chờ tôi duyệt" không thống nhất — danh sách hiện phiếu giao cho bạn, nhưng số đếm và nút Duyệt trên dòng còn đòi quyền "Xử lý được giao"; trang chi tiết thì cho duyệt.
- Lỗi: Đặt xe điền sẵn địa chỉ mẫu "Trụ sở Vioo ERP (123 Nguyễn Trãi, Hà Nội)" ở **Điểm đón ban đầu** (`pages/booking/VehicleBookingCreatePage.tsx:42`).
- Sai chữ: màn kiểm kê tài sản bảo cần quyền "Thực hiện kiểm kê", quyền thật là "Kiểm kê tài sản · Kiểm kê".
- Lỗi: nút Tạo mới / Import Excel ở Bảo trì tài sản không ẩn theo quyền.

## Chung, tài khoản

- Lỗi: tài khoản bị vô hiệu hóa đăng nhập chỉ thấy "Thông tin đăng nhập không hợp lệ hoặc lỗi kết nối" (`getApiErrorMessage` chưa xử lý `user_banned`).
- Lỗi: người có quyền Cài đặt · Quản trị (không phải Admin) thấy form **Đặt mật khẩu mới**, bấm thì 403.
- Khó dùng: điểm XP / Bảng xếp hạng đứng yên từ 27/08/2026 (`xp_events` không có dòng mới; #312 bỏ lời gọi cộng điểm) nhưng trang vẫn mời thi đua.
- Khó dùng: hàng chờ đồng bộ khi mất mạng (`queueMutation`) không được dùng ở đâu — dải "chờ sync" vô nghĩa, form không giữ nháp khi mất mạng.
- Không thống nhất: tự đổi mật khẩu cần ≥ 6 ký tự, Admin đặt cần ≥ 8.
- Sai chữ: Ảnh đại diện ghi "JPG, PNG" nhưng nhận cả WEBP, không ghi giới hạn 2 MB.

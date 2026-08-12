# Thiết kế thông tin Booking dễ đọc và thông báo giàu ngữ cảnh

## Mục tiêu

Loại bỏ UUID kỹ thuật khỏi phần thông tin xe và tài xế trong chi tiết đơn đặt xe. Đồng thời, làm cho mọi thông báo Booking đủ ngữ cảnh để người nhận hiểu nhanh chuyến đi mà không cần mở hồ sơ.

Thiết kế áp dụng cho tất cả sự kiện thông báo Booking. Khi chuyến chưa được điều phối, trường tài xế hiển thị `Chưa phân công`.

## Nguyên tắc nguồn dữ liệu

Database là nguồn tạo dữ liệu hiển thị chuẩn:

- Xe lấy từ `assets` qua `vehicle_booking_assignments.vehicle_asset_id`.
- Tài xế nội bộ và người đặt lấy từ `employees` qua `public.users.id`.
- Tài xế xe ngoài lấy từ snapshot trên assignment.
- Điểm đi, điểm đến và mục đích lấy từ booking.
- Frontend không tự hiển thị UUID làm giá trị dự phòng.

Tên và mã trong chi tiết đơn được đọc từ master data hiện tại. Dữ liệu trong thông báo được snapshot vào thời điểm phát thông báo để nội dung lịch sử không thay đổi nếu nhân sự hoặc tài sản được đổi tên sau đó.

## Chi tiết xe và tài xế đã xếp

Bổ sung một read RPC có phạm vi theo booking để trả dữ liệu assignment đã làm giàu. Public wrapper dùng `SECURITY INVOKER`; implementation đặc quyền nằm trong `app_private` và chỉ trả dữ liệu khi `vehicle_user_can_view_booking(current_app_user_id(), booking_id)` cho phép.

Kết quả hiển thị:

- `INTERNAL_WITH_DRIVER` → `Xe nội bộ + tài xế chuyên trách`.
- `INTERNAL_SELF_DRIVE` → `Xe nội bộ + nhân viên tự lái`.
- `EXTERNAL_TRANSPORT` → `Xe ngoài / Taxi`.
- Xe nội bộ → `TS-002 · Xe tải thùng`.
- Người lái nội bộ → `Nguyễn Văn Hoàng`.
- Xe ngoài → tên nhà cung cấp, biển số và tên tài xế ngoài khi có.
- Dữ liệu thiếu → `Chưa có thông tin` hoặc `Theo nhà cung cấp`, tùy ngữ cảnh; không dùng UUID.

RPC chỉ trả dữ liệu trình bày cần thiết: assignment ID/version, hình thức, mã/tên/ảnh xe, tên/chức danh/avatar người lái và snapshot xe ngoài. Không trả thông tin bằng lái hoặc dữ liệu HRM nhạy cảm.

## Nội dung thông báo Booking

Mọi notification Booking tiếp tục giữ tiêu đề sự kiện hiện có, ví dụ `Đã xếp phương án chuyến xe`. Mã booking hiển thị ngay dưới tiêu đề.

Phần nội dung có cấu trúc:

- Người đặt.
- Nội dung/mục đích chuyến đi.
- Tài xế.
- Điểm đi.
- Điểm đến.

`notifications.metadata` lưu các khóa chuẩn:

- `booking_id`
- `booking_code`
- `event_type`
- `requester_name`
- `purpose`
- `driver_name`
- `pickup_location`
- `destination`

Assignment dùng cho notification được chọn theo thứ tự: `assignment_id` trong payload, assignment liên quan trực tiếp tới recipient đối với sự kiện gỡ tài xế, rồi mới tới assignment đang active. Quy tắc này tránh thông báo đổi phương án của tài xế cũ hiển thị tên tài xế mới. Nếu là xe ngoài, dùng `external_driver_name`. Nếu chưa có assignment/người lái, dùng `Chưa phân công`.

`message` và `body` chứa phiên bản văn bản ngắn dùng cho thông báo trình duyệt và các client cũ. Notification Center và trang Thông báo ưu tiên metadata có cấu trúc; nếu metadata cũ chưa đầy đủ thì fallback về `message`.

Mục đích chuyến đi được giữ nguyên trong metadata. Frontend dùng một dòng với ellipsis bằng CSS, không cắt phá hủy dữ liệu trong database. Các trường điểm đi và điểm đến hiển thị riêng và cho phép xuống dòng tự nhiên.

## Pipeline và dữ liệu lịch sử

Migration tiến tiếp sẽ cập nhật cả hai đường giao thông báo hiện có:

- `app_private.deliver_vehicle_notification`
- `app_private.process_vehicle_notification_outbox`

Hai hàm dùng chung một helper private để tạo context, tránh khác biệt giữa worker gọi từng item và cron xử lý batch. Helper chỉ đọc booking/assignment/asset/employee và trả JSONB cùng chuỗi tóm tắt.

Migration backfill các bản ghi `public.notifications` thuộc `vehicle_booking` đã phát trước đó:

- Bổ sung metadata còn thiếu từ booking và assignment hiện tại.
- Cập nhật `message` và `body` sang nội dung ngắn có ngữ cảnh.
- Không thay đổi recipient, trạng thái đã đọc, thời điểm tạo, link hoặc action URL.
- Không tạo thông báo mới và không gửi lại web push.

Outbox chưa giao sẽ được làm giàu khi worker xử lý, không cần sửa payload cũ.

## Giao diện

Notification Center và trang Thông báo dùng một component trình bày Booking dùng chung:

- Tiêu đề một dòng.
- Mã booking một dòng phụ.
- Người đặt.
- Nội dung một dòng, ellipsis khi tràn.
- Tài xế.
- Điểm đi.
- Điểm đến.
- Thời gian và trạng thái đọc giữ như hiện tại.

Thông báo không thuộc Booking giữ nguyên giao diện hiện tại.

## Xử lý lỗi và tương thích

- RPC chi tiết bị từ chối hoặc booking không tồn tại: giữ hành vi modal lỗi hiện tại, không rò rỉ dữ liệu master.
- Asset hoặc employee bị thiếu: trả `null`; frontend dùng nhãn nghiệp vụ, không dùng khóa ID.
- Metadata notification cũ hoặc không hợp lệ: fallback về `message` để Notification Center không bị trắng.
- Không thay đổi chữ ký các command RPC điều phối hiện có.
- Canonical deep-link `/booking/vehicle/my?booking=<uuid>` tiếp tục được giữ nguyên.

## Kiểm thử

- Unit test ánh xạ hình thức điều phối sang tiếng Việt.
- Service test merge assignment display theo assignment ID và không fallback về UUID.
- Component test Notification Booking hiển thị đủ năm trường; purpose chỉ một dòng với ellipsis.
- Component test notification không phải Booking không hồi quy.
- SQL contract test RPC chỉ cho người có quyền xem booking và không trả dữ liệu nhạy cảm.
- SQL smoke test notification trước/sau điều phối, tài xế nội bộ, tự lái, xe ngoài và chưa phân công.
- SQL smoke test backfill không đổi recipient, read state, link và không tạo bản ghi mới.
- Chạy toàn bộ Vitest, TypeScript lint và production build.

## Rollout Supabase Cloud

Tạo một migration mới bằng Supabase CLI, không sửa migration đã chạy. Rollout dùng curated workdir vì repository còn migration lịch sử local-only. `db push --dry-run` phải chỉ liệt kê migration mới; không dùng `--include-all` hoặc `migration repair`.

Sau khi push:

- Xác nhận migration ledger.
- Gọi RPC bằng phiên requester và recipient hợp lệ.
- Kiểm tra notification Booking hiện tại đã được backfill.
- Xác nhận schema cache nhận RPC.
- Chỉ phát hành frontend sau khi smoke đạt.

## Ngoài phạm vi

- Không triển khai Google Maps hoặc km dự kiến trong thay đổi này.
- Không thay đổi nghiệp vụ cấp quyền tài xế/loại xe.
- Không đổi luồng recipient của notification.
- Không gửi lại thông báo lịch sử sau backfill.

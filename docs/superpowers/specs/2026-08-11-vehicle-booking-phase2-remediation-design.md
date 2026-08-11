# Vehicle Booking Phase 2 Remediation Design

## Goal

Đưa Phase 2 từ UI skeleton sang pilot vận hành được bằng cách sửa theo thứ tự: permission và migration, contract 25 RPC, các luồng dispatch/driver/handover, bằng chứng chuyến đi và timezone, Fleet Settings, cuối cùng là kiểm thử end-to-end.

## Constraints

- Chỉ dùng Supabase Cloud đã cấu hình trong `.env`; không dùng Supabase local hoặc Docker.
- Giữ module key `VEHICLE_BOOKING`, application `resource_booking`, permission module `resource_booking.vehicle`.
- Giữ nguyên các thay đổi Phase 2 của người dùng và sửa tại chỗ trên nhánh `feature/booking-app`.
- Mọi thay đổi hành vi phải có regression test chạy đỏ trước khi sửa.
- Không đưa `service_role` vào frontend; Storage upload dùng session authenticated và RLS.

## Architecture

### Permission and migration

Đăng ký `VEHICLE_BOOKING` trong frontend permission registry để `canAccessRoute` nhận đủ mười route. Đổi migration route/settings bị trùng version thành migration kế tiếp duy nhất, đồng thời bổ sung enforcement cho `allow_dispatch_approval_override` và quyền EXECUTE an toàn. Cloud phải có history tương ứng, không để schema drift.

### RPC contract

`vehicleBookingService.ts` là biên contract duy nhất giữa UI và PostgREST. Mỗi RPC dùng đúng tên tham số lấy từ `pg_proc`; một contract test mock tầng mạng Supabase và kiểm tra payload do service phát ra. Các API UI dùng booking ID, reason và enum đúng với backend thay vì chuyển đổi tùy tiện tại page.

### Operational read models

Các fetcher trả đúng tập dữ liệu theo màn hình: chuyến hôm nay lọc theo ngày Việt Nam và trạng thái; handover queue lấy assignment self-drive hợp lệ; dispatcher kết hợp unavailability/assignment để không gắn nhãn mọi tài xế là rảnh. Polling vẫn là fallback, còn Realtime Postgres Changes kích hoạt re-fetch và được cleanup khi unmount.

### Evidence and time

Datetime-local được hiểu cố định là giờ Việt Nam và chuyển sang ISO UTC không phụ thuộc timezone máy. Start/finish yêu cầu ảnh kilomet và một trong hai bằng chứng vị trí: tọa độ hoặc cờ thất bại kèm lý do. Ảnh luôn được chuẩn hóa JPEG, giảm kích thước lặp đến giới hạn cấu hình và từ chối nếu vẫn vượt ngưỡng.

### Fleet settings

Form settings giữ đủ chín giá trị từ Cloud và chỉ lưu giá trị người dùng thấy, không hardcode ghi đè. Vehicle edit giữ `home_base_id`. Driver authorization không gửi tham số không tồn tại. Các tab hoặc route nhạy cảm chỉ hiện khi người dùng có permission tương ứng.

## Error handling

Lỗi RPC được ánh xạ thành thông báo nghiệp vụ ngắn nhưng giữ message gốc cho debug. UI không optimistic-update dispatch/custody; sau mutation luôn re-fetch. Các validation bắt buộc chạy trước upload/RPC để tránh tạo file mồ côi.

## Verification

- Contract tests đủ 25 RPC và query filter quan trọng.
- Permission registry test xanh.
- Component/service tests cho dispatch override, driver response, handover queue, GPS/ảnh/timezone và settings preservation.
- `npm run lint`, `npm run build`, test suite chính.
- Supabase Cloud smoke test, migration history, RPC signatures, cron và security advisor trong phạm vi Booking.

## Scope boundary

Đợt này ưu tiên sửa các lỗi đã review. Timeline ngày/tuần, external completion UI, feedback UI, participant editor và Fleet ảnh giấy phép sẽ chỉ làm nếu cần để khép kín luồng đã cam kết sau khi P0/P1 xanh; không mở rộng sang báo cáo KPI mới.

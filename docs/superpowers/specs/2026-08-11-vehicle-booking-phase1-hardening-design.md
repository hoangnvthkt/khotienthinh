# Vehicle Booking Phase 1.1 Hardening Design

## Mục tiêu

Đưa nền tảng Booking xe đã triển khai trên Supabase Cloud về trạng thái an toàn và có thể tích hợp frontend: mọi mutation phải kiểm tra actor, trạng thái và invariant nghiệp vụ; file bằng chứng phải được cô lập theo booking/chủ sở hữu; migration history, cron, notification và audit phải vận hành được; smoke test phải đi qua public RPC dưới JWT `authenticated`.

## Chiến lược migration

Giữ nguyên bốn migration Phase 1 làm baseline vì SQL tương ứng đã tồn tại trên Cloud. Tạo ba migration additive, idempotent và áp dụng tuần tự bằng `supabase db query --linked`; sau mỗi migration chạy preflight/postflight query. Chỉ gọi `supabase migration repair <version> --status applied` sau khi SQL và assertions của version đó đều thành công. Không dùng `db push`, Supabase local hoặc Docker.

## Lớp A: Security containment

- Thay `vehicle_user_has_permission` bằng adapter gọi `app_private.has_permission`, giữ fallback mặc định chỉ cho nhân viên active ở các quyền create/view-own/trip/handover; quyền admin hệ thống không tự động thay thế quyền nghiệp vụ nhạy cảm.
- Thu hẹp RLS của authorization, operator unavailability và issue; dispatcher chỉ dùng safe view cho danh sách tài xế đủ điều kiện.
- Storage path chuẩn:
  - Trip/external evidence: `{booking_id}/trips/...` hoặc `{booking_id}/external/...`.
  - License evidence: `licenses/{user_id}/...`.
  - Fleet evidence: `fleet/{asset_id}/...`.
- Storage SELECT/INSERT được quyết định bởi helper private dựa trên booking, actor và permission; không revoke quyền UPDATE/DELETE toàn cục trên `storage.objects`. Bucket booking không có UPDATE/DELETE policy nên vẫn bất biến ở mức bucket.
- Mọi public wrapper có `SET search_path = ''`; private commands bị revoke khỏi `authenticated`.

## Lớp B: Business commands và invariant

- Thêm constraint theo `fulfillment_type`, cấu hình còn thiếu và index FK/RLS.
- Mọi command khóa booking/assignment cần thiết và xác thực actor trước mutation.
- Dispatch/reassign kiểm tra trạng thái xe, home base, inspection/insurance, authorization đúng loại, license/health/vehicle type, operator active, unavailability và overlap. Dispatcher override booking chưa duyệt luôn cần lý do.
- Handover chỉ dành cho self-drive; người được chỉ định thao tác trực tiếp, dispatcher thao tác thay phải có lý do.
- Start/finish bắt buộc ảnh và kilomet cho xe nội bộ; lỗi lấy vị trí cần lý do; tình trạng `ISSUE` cần ghi chú; self-drive cần handover hoặc dispatcher override có lý do; custody chỉ hard-block lúc start.
- Bổ sung `reassign_vehicle_booking`, `respond_to_vehicle_assignment`, `complete_external_transport`, `mark_vehicle_booking_no_show`, quản lý/cancel vehicle/operator unavailability và thay participants.
- Cancel không được dùng khi đã `IN_PROGRESS`; nếu assignment đã nhận custody thì phải giải phóng custody nhất quán.

## Lớp C: Audit, notification và cron

- Ghi explicit event vào `public.audit_trail`; issue audit chỉ ghi category/status/id, không ghi comment hoặc resolution note.
- Outbox dùng `FOR UPDATE SKIP LOCKED`, giới hạn retry, phục hồi item PROCESSING quá hạn và chỉ cho `service_role` claim/deliver/fail.
- Delivery ghi vào `public.notifications` để tái sử dụng in-app/web-push hiện hữu.
- Cron chạy auto-close feedback và delivery outbox bằng private worker functions; public auto-close RPC không cấp cho `authenticated`.

## Kiểm thử

Smoke test mới chạy trong transaction và rollback, chọn fixture hiện hữu nhưng fail rõ ràng nếu thiếu fixture. Mỗi actor được mô phỏng bằng `SET LOCAL ROLE authenticated` và JWT claims. Test bao phủ tối thiểu:

- Người ngoài không reject/cancel/start/finish/checkpoint/feedback booking.
- Manager snapshot và dispatcher đúng permission được thao tác đúng scope.
- Dispatch/start/finish hard-block đúng mã lỗi.
- Self-drive handover/custody, cancellation và return không để xe mắc custody.
- External completion, no-show, reassign và assignment response.
- RLS issue và Storage policy không lộ dữ liệu.
- Outbox retry/delivery và auto-close feedback.

## Tiêu chí hoàn thành

- Ba migration áp dụng thành công và có remote migration history.
- Public booking RPC đủ surface theo đặc tả và không có wrapper mới bị advisor cảnh báo mutable search path.
- Cron booking tồn tại, active và worker functions không callable bởi `authenticated`.
- Smoke security/integration pass; lint và build pass; full test suite được chạy và báo đúng mọi failure còn lại.

# Vận hành worker thông báo Yêu cầu

## Mục đích

`process-request-notifications` là Edge Function xử lý outbox thông báo của Module Yêu cầu. Runtime chỉ ghi sự kiện vào outbox trong cùng transaction; worker sẽ claim, tạo notification và retry theo backoff. Worker không được gọi từ trình duyệt.

## Điều kiện trước khi bật scheduler

- Edge Function `process-request-notifications` đã ở trạng thái `ACTIVE` và yêu cầu JWT.
- Migration `20260729073147_request_notification_delivery_phase1.sql` đã được áp dụng.
- Scheduler chạy trong môi trường tin cậy, có thể lưu secret; không dùng frontend, URL public hay source control để lưu secret.
- Scheduler có `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` của đúng Cloud project.

## Lịch gọi khuyến nghị

Gọi `POST /functions/v1/process-request-notifications` mỗi phút. Khi tải cao, có thể gọi mỗi 30 giây; worker claim tối đa 50 item mỗi lượt, hỗ trợ nhiều invocation song song bằng `FOR UPDATE SKIP LOCKED`.

Body có thể là `{}` hoặc `{ "limit": 50 }`. Giới hạn tối đa được database kiểm soát là 50.

Ví dụ cho môi trường scheduler (thay biến môi trường tại runner, không hard-code secret):

```sh
curl --fail-with-body --request POST "$SUPABASE_URL/functions/v1/process-request-notifications" \
  --header "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  --header "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  --header "Content-Type: application/json" \
  --data '{"limit":50}'
```

Response thành công có dạng `{ "claimed": 3, "delivered": 3, "failed": 0 }`.

## Retry và xử lý sự cố

- Lỗi delivery được ghi vào outbox, message bị giới hạn 500 ký tự.
- Backoff exponential bắt đầu từ 60 giây và tối đa 1 giờ.
- Sau 10 lần thất bại, item giữ trạng thái `FAILED` để đội vận hành điều tra/retry có chủ đích.
- Claim/delivery dùng lock và transaction; chạy trùng scheduler không tạo notification trùng.

Khi `failed > 0`, kiểm tra log Edge Function trước, sau đó kiểm tra outbox trên Cloud project bằng tài khoản vận hành có quyền service-role. Không sửa trực tiếp trạng thái outbox bằng client/browser.

## Kiểm tra sau khi cấu hình

1. Tạo một đề xuất có người duyệt.
2. Đợi một lượt scheduler và kiểm tra response/log worker không lỗi.
3. Xác nhận người nhận thấy notification, nhấn vào notification đi tới `/rq/:requestId` và vẫn bị kiểm tra quyền bởi runtime.
4. Theo dõi backlog/failed hàng ngày trong giai đoạn staging.

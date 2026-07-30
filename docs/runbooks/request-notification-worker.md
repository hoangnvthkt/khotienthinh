# Vận hành worker thông báo Yêu cầu

## Mục đích

`process-request-notifications` là Edge Function xử lý outbox thông báo của Module Yêu cầu. Runtime chỉ ghi sự kiện vào outbox trong cùng transaction; worker sẽ claim, tạo notification và retry theo backoff. Worker không được gọi từ trình duyệt.

## Điều kiện trước khi bật scheduler

- Edge Function `process-request-notifications` đã ở trạng thái `ACTIVE`, tắt gateway JWT và xác thực bằng Supabase secret API key tại runtime.
- Các migration `20260729073147_request_notification_delivery_phase1.sql`, `20260729082919_schedule_request_notification_worker.sql`, `20260729083646_request_notification_worker_schema_access.sql` và `20260729083734_request_notification_worker_private_rpc.sql` đã được áp dụng.
- Scheduler là Supabase Cron; secret API key được lưu trong Supabase Vault với tên `request_notification_worker_service_key`. Không dùng frontend, URL public hay source control để lưu secret.

## Rollback UI Phase 1

`VITE_ENABLE_REQUEST_APPROVAL_PHASE1` mặc định là bật. Khi cần dừng nhanh UI Request Phase 1, đặt biến này thành `false` trong môi trường frontend rồi redeploy. Các route `/rq` sẽ chuyển về Home; dữ liệu và migration không bị xóa. Bật lại bằng cách bỏ biến hoặc đặt `true` sau khi đã xử lý sự cố.

## Lịch gọi khuyến nghị

Gọi `POST /functions/v1/process-request-notifications` mỗi phút. Khi tải cao, có thể gọi mỗi 30 giây; worker claim tối đa 50 item mỗi lượt, hỗ trợ nhiều invocation song song bằng `FOR UPDATE SKIP LOCKED`.

Body có thể là `{}` hoặc `{ "limit": 50 }`. Giới hạn tối đa được database kiểm soát là 50. Cron gửi secret API key chỉ trong header `apikey`; không gửi key qua `Authorization`.

Ví dụ cho môi trường scheduler (thay biến môi trường tại runner, không hard-code secret):

```sh
curl --fail-with-body --request POST "$SUPABASE_URL/functions/v1/process-request-notifications" \
  --header "apikey: $SUPABASE_SECRET_KEY" \
  --header "Content-Type: application/json" \
  --data '{"limit":50}'
```

Response thành công có dạng `{ "claimed": 3, "delivered": 3, "failed": 0 }`.

Kiểm tra liveness của worker bằng secret API key (không claim outbox):

```sh
curl --fail-with-body "$SUPABASE_URL/functions/v1/process-request-notifications?health=1" \
  --header "apikey: $SUPABASE_SECRET_KEY"
```

Response thành công là `{ "ok": true }`.

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

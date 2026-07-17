# Thiết kế forward-fix cho Auth profile sync guard

Ngày: 2026-07-17
Trạng thái: Operator-approved direction; chờ duyệt văn bản
Phạm vi: Khôi phục luồng tạo Supabase Auth user mà không mở rộng quyền cập nhật `public.users`

## 1. Vấn đề đã xác nhận

Migration `20260716103946_allow_auth_profile_sync_guard_bypass.sql` cho phép phiên nội bộ Supabase Auth (`session_user = 'supabase_auth_admin'`) đi qua trigger `app_private.prevent_users_privilege_self_update()` khi đồng bộ `auth.users` sang `public.users`.

Migration sau đó là `20260716170745_user_account_lifecycle_operations.sql` đã thay lại cùng function nhưng chỉ giữ bypass cho lifecycle command của `service_role`. Vì vậy GoTrue `/admin/users` hiện bị trigger từ chối với SQLSTATE `42501` và thông báo `Only admins can update other user rows`.

Đây là lỗi ghi đè định nghĩa function giữa hai migration, không phải lỗi của Edge Function `create-user` và không liên quan tới ba rollout flag của Phase 2.

## 2. Mục tiêu và bất biến

Forward-fix phải đồng thời bảo đảm:

1. `supabase_auth_admin` có thể hoàn tất đồng bộ profile trong luồng tạo user của Supabase Auth.
2. `service_role` chỉ được bypass khi transaction đã bật `app.account_lifecycle_command = 'on'`.
3. User authenticated thông thường vẫn không thể cập nhật row của người khác hoặc tự sửa các trường quyền được bảo vệ.
4. Admin ứng dụng vẫn đi qua nhánh `public.is_admin()` hiện có; không thay đổi mô hình quyền nghiệp vụ.
5. Không sửa lịch sử của hai migration đã apply; chỉ thêm một migration tiến về phía trước.
6. Không bật rollout flag, không thay grant và không apply Cloud trước checkpoint phê duyệt riêng.

## 3. Thay đổi được chọn

Thêm một migration mới, chỉ `create or replace` function `app_private.prevent_users_privilege_self_update()`.

Phần đầu function có đúng hai bypass độc lập:

```sql
if session_user = 'supabase_auth_admin' then
  return new;
end if;

if auth.role() = 'service_role'
  and coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'
then
  return new;
end if;
```

Toàn bộ phần còn lại được giữ theo phiên bản lifecycle hiện tại:

- Admin ứng dụng được phép theo `public.is_admin()`.
- Actor thường chỉ sửa đúng profile của mình.
- Các trường `role`, `auth_id`, `email`, `username`, warehouse, module/submodule và `is_active` vẫn được bảo vệ.
- Function tiếp tục là `security definer`, `set search_path = ''` và bị revoke khỏi `public`, `anon`, `authenticated`.

Không khôi phục điều kiện rộng `or auth.role() = 'service_role'` từ migration cũ.

## 4. Kiểm thử và rollout gate

### 4.1 Regression test trong repository

Viết test contract trước khi viết migration. Test phải thất bại khi migration mới chưa tồn tại và sau đó xác nhận:

- Migration chứa bypass riêng cho `session_user = 'supabase_auth_admin'`.
- Bypass `service_role` vẫn phụ thuộc chính xác vào lifecycle GUC.
- Không có bypass rộng `session_user = 'supabase_auth_admin' or auth.role() = 'service_role'`.
- Các nhánh bảo vệ actor thường và danh sách trường nhạy cảm vẫn còn.
- Revoke của trigger function vẫn còn.

### 4.2 Supabase Cloud rollback-only verification

Trước khi apply thật, chạy migration và SQL smoke trong một transaction `begin ... rollback` trên Supabase Cloud. Bài smoke xác nhận định nghĩa function, hai bypass và các guard/revoke; transaction phải kết thúc bằng rollback và không tạo migration version.

### 4.3 Checkpoint apply riêng

Chỉ sau khi báo cáo rollback-only pass và được operator duyệt tiếp mới:

1. Apply đúng migration forward-fix lên Supabase Cloud.
2. Xác nhận đúng một migration version mới.
3. Tạo một tài khoản canary dùng một lần qua luồng ứng dụng.
4. Xác nhận Auth user và `public.users` profile được tạo đồng bộ.
5. Chạy negative canary bằng actor không có quyền để bảo đảm backend vẫn từ chối thao tác quản trị.
6. Thu hồi hoặc vô hiệu hóa canary theo account lifecycle chuẩn và ghi kết quả vào live apply log.

## 5. Rollback và giới hạn ảnh hưởng

- Nếu rollback-only verification lỗi: transaction rollback, Cloud không thay đổi.
- Nếu apply thật lỗi: dừng rollout, không repair migration version thủ công khi chưa đối chiếu trạng thái thực tế.
- Nếu post-apply canary lỗi: giữ ba rollout flag ở `false`, vô hiệu hóa canary nếu đã tạo được và lập migration khôi phục định nghĩa function trước forward-fix nếu cần.
- Forward-fix không thay đổi permission registry, direct grants, business role, Daily Log assignment hay dữ liệu nghiệp vụ.

## 6. Tiêu chí hoàn tất

Phương án chỉ hoàn tất khi có đủ bằng chứng:

- Regression test pass.
- Rollback-only Cloud verification pass và được duyệt apply.
- Migration version Cloud khớp đúng file forward-fix.
- Tạo user qua luồng ứng dụng pass.
- Negative authorization canary vẫn bị từ chối.
- Không có rollout flag hoặc grant ngoài phạm vi bị thay đổi.

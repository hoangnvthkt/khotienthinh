# Thiết kế forward-fix command hoàn thiện Auth profile

Ngày: 2026-07-18
Trạng thái: Phương án đã được operator duyệt; chờ duyệt bản spec viết
Phạm vi: Loại bỏ lần ghi `public.users` không có command context trong Edge Function `create-user`

## 1. Vấn đề đã xác nhận

Migration `20260718012151_auth_profile_sync_guard_forward_fix.sql` đã khôi phục
đúng bypass hẹp cho phiên nội bộ `supabase_auth_admin`. Auth trigger hiện có thể
tạo hoặc liên kết `public.users` trong transaction tạo Auth user.

Sau bước đó, `supabase/functions/create-user/index.ts` tiếp tục gọi
`admin.from('users').upsert(...)`. Lần ghi thứ hai đi qua PostgREST với database
role `authenticator` và JWT role `service_role`, nhưng không nằm trong
`app.account_lifecycle_command = 'on'`. Trigger
`app_private.prevent_users_privilege_self_update()` từ chối đúng với SQLSTATE
`42501` và thông báo `Only admins can update other user rows`.

Vì vậy không được nới guard. Forward-fix phải thay đường ghi profile của Edge
Function bằng một command có ranh giới, ACL và audit rõ ràng.

Self-review còn phát hiện một rủi ro cùng trust boundary: function
`public.sync_auth_user_profile()` hiện đọc `role`, warehouse và legacy
module/submodule từ `raw_user_meta_data` ở cả nhánh Auth INSERT/UPDATE. Sau khi
bypass Auth-admin được khôi phục, một authenticated user có thể tự sửa Auth user
metadata và làm trigger ghi các trường được bảo vệ. Forward-fix này vì vậy phải
đồng thời làm cho Auth trigger chỉ đồng bộ field hồ sơ an toàn; mọi role/quyền
đi qua command RPC.

## 2. Mục tiêu và bất biến

Forward-fix phải đồng thời bảo đảm:

1. Tạo Auth user qua UI tạo được một profile hoạt động và liên kết `auth_id`.
2. Profile cuối cùng giữ đúng role nền, warehouse và legacy module/submodule mà
   Admin đã khai báo; direct grant và Business Role không được tự tạo.
3. Không đặt role, warehouse hoặc permission data vào `user_metadata`/
   `raw_user_meta_data` vì người dùng Auth có thể tự sửa metadata này.
4. Không khôi phục bypass rộng cho mọi `service_role` update trên
   `public.users`.
5. Command chỉ được gọi bằng `service_role`, phải xác thực actor là active
   legacy Admin bằng seam hiện có và chỉ được tác động profile vừa liên kết với
   Auth ID đích.
6. Thất bại có bắt được phải bù trừ cả profile mới lẫn profile HRM có sẵn được
   liên kết theo email; không để lại `auth_id` mồ côi.
7. Không sửa migration `20260718012151`, không bật rollout flag và không thay
   production grant/Business Role/responsibility assignment.
8. Môi trường chỉ dùng Supabase Cloud. Mọi SQL behavior test trước apply thật
   chạy trong linked transaction kết thúc bằng `ROLLBACK`; không dùng Docker
   hoặc Supabase local.
9. Auth metadata update của user không được thay `role`, `username`, warehouse,
   legacy module/submodule hoặc trạng thái hoạt động trong `public.users`.

## 3. Các phương án đã cân nhắc

### 3.1 Nới guard cho `service_role`

Cho mọi `service_role` đi qua trigger sẽ làm canary tạo user chạy được, nhưng
xóa ranh giới lifecycle command vừa được thiết lập. Phương án này bị loại vì
mở rộng đặc quyền cho mọi Edge Function hoặc server client dùng service key.

### 3.2 Bootstrap profile bằng Auth metadata

`app_metadata` an toàn hơn `user_metadata` cho authorization, nhưng đưa toàn bộ
module/submodule map vào JWT làm tăng kích thước token và buộc Auth trigger hiểu
chi tiết permission projection của ứng dụng. `user_metadata` tuyệt đối không
được dùng cho field quyền vì user-editable. Phương án metadata bị loại để tránh
coupling và dữ liệu quyền tồn tại lâu trong Auth claims.

### 3.3 Command RPC hẹp — phương án chọn

Giữ Auth trigger chịu trách nhiệm tạo/liên kết profile cơ bản. Edge Function
sau đó gọi một RPC service-role-only để hoàn thiện đúng row vừa liên kết. RPC
bật command context chỉ trong transaction của chính nó, validate actor/target,
ghi audit và hỗ trợ compensation có kiểm soát. Đây là thay đổi nhỏ nhất giữ
được least privilege và không chuyển authorization data sang Auth metadata.

## 4. Kiến trúc command

### 4.1 Private command

Migration forward mới tạo:

```sql
app_private.apply_created_user_profile_command(
  p_actor_user_id uuid,
  p_auth_user_id uuid,
  p_action text,
  p_profile jsonb,
  p_before_state jsonb default '{}'::jsonb
) returns jsonb
```

Function là `SECURITY DEFINER`, `set search_path = ''`, và không được cấp cho
`public`, `anon` hoặc `authenticated`. Function kiểm tra:

- `auth.role() = 'service_role'`;
- `p_action` chỉ là `FINALIZE` hoặc `ROLLBACK`;
- `p_actor_user_id` pass `app_private.assert_legacy_system_admin(...)`;
- có đúng một `public.users` row với `auth_id = p_auth_user_id`;
- khi `FINALIZE`, email lấy từ `auth.users`, không tin email trong JSON;
- `p_profile` chỉ chứa whitelist field đã định nghĩa, đúng JSON type và role
  thuộc `public.user_role`;
- `is_active`/`account_status` của tài khoản mới bị ép về `true`/`ACTIVE`.

Ngay trước protected update, function gọi:

```sql
perform set_config('app.account_lifecycle_command', 'on', true);
```

GUC là transaction-local nên không tạo bypass lâu dài.

### 4.2 Public RPC wrapper

PostgREST chỉ gọi exposed schema, vì vậy migration tạo wrapper:

```sql
public.apply_created_user_profile_command(
  p_actor_user_id uuid,
  p_auth_user_id uuid,
  p_action text,
  p_profile jsonb,
  p_before_state jsonb default '{}'::jsonb
) returns jsonb
```

Wrapper là `SECURITY INVOKER`, `set search_path = ''`, chỉ chuyển tiếp sang
private command. Revoke toàn bộ khỏi `PUBLIC`, `anon`, `authenticated`; grant
`EXECUTE` đúng cho `service_role` trên cả wrapper và private command. Cấu trúc
này tránh đặt một
`SECURITY DEFINER` trực tiếp trong exposed schema.

### 4.3 Hardening Auth profile trigger

Cùng migration `create or replace` `public.sync_auth_user_profile()` để phân
tách dữ liệu theo trust level:

- Auth INSERT có thể tạo/liên kết profile cơ bản bằng `auth_id`, email, name,
  phone và avatar; role luôn bắt đầu từ `EMPLOYEE`, warehouse là `null`, các
  legacy module array là rỗng và submodule map là object rỗng;
- username ban đầu lấy từ local-part email hoặc Auth UUID, không lấy từ
  `raw_user_meta_data`; command sẽ đặt username Admin đã khai báo ngay sau đó;
- Auth UPDATE chỉ đồng bộ Auth ID, email và field hiển thị an toàn
  `name`/`phone`/`avatar`;
- Auth UPDATE không bao giờ đọc hoặc ghi `role`, `username`, warehouse,
  allowed/admin modules, allowed/admin submodules, `is_active` hoặc
  `account_status` từ user metadata;
- function vẫn là `SECURITY DEFINER`, empty search path và giữ trigger/ACL hiện
  có.

Việc harden trigger phải đứng trước Edge deployment để trong mọi cửa sổ rollout,
user-editable metadata không thể trở thành authorization source.

### 4.4 `FINALIZE`

Command khóa target row `FOR UPDATE`, chuẩn hóa payload và cập nhật:

- `name`, `username`, `phone`, `avatar`;
- `role`, `assigned_warehouse_id`;
- `allowed_modules`, `admin_modules`;
- `allowed_sub_modules`, `admin_sub_modules`;
- `is_active = true`, `account_status = 'ACTIVE'`.

Command không tạo direct grant, Business Role assignment hoặc responsibility
assignment. Sau update, command ghi `permission_audit_events` với event type
`account_created_profile_finalized`. Metadata audit chỉ lưu role, số lượng
legacy source và trạng thái profile; không lưu password, token hoặc toàn bộ
profile payload.

### 4.5 `ROLLBACK`

Trước khi tạo Auth user, Edge Function đọc tối đa hai profile cùng email:

- hơn một row: trả lỗi `Ambiguous application profile` trước Auth mutation;
- một row đã có `auth_id`: trả conflict trước Auth mutation;
- một row chưa liên kết: giữ `id` và snapshot các field mà Auth trigger có thể
  thay đổi trong biến request-local `beforeState`;
- không có row: `beforeState` đánh dấu profile sẽ là row mới.

Nếu bước sau Auth creation lỗi:

- profile mới (`id = p_auth_user_id`): command xóa đúng row có cả `id` và
  `auth_id` khớp;
- profile có sẵn: command chỉ restore snapshot đã chụp nếu row ID và
  `auth_id = p_auth_user_id` cùng khớp, bao gồm trả `auth_id` về `null`;
- command ghi audit `account_creation_profile_rolled_back` mà không đưa PII hay
  credential vào metadata.

Sau khi DB compensation thành công hoặc đã được thử, Edge Function gọi
`admin.auth.admin.deleteUser(...)`. Cleanup không dùng direct protected update
qua `admin.from('users').upsert(...)`.

## 5. Thay đổi Edge Function

`create-user` tiếp tục gọi `requireActiveAdmin(req, admin)` và giữ caller để lấy
`caller.appUser.id`. Luồng mới:

1. Parse/validate request và đọc pre-existing profile state theo email.
2. Gọi `admin.auth.admin.createUser(...)` với `user_metadata` chỉ gồm thông tin
   hiển thị không dùng cho authorization: `name`, `phone`, `avatar`. Username
   được command đặt trực tiếp, không đi qua user-editable metadata.
3. Query profile đã được Auth trigger liên kết bằng `auth_id`.
4. Gọi RPC action `FINALIZE` với actor ID, Auth ID và app profile payload.
5. Trả `profileId` từ response RPC.
6. Khi bước 3–4 lỗi, gọi action `ROLLBACK`, sau đó xóa Auth user và chỉ trả
   thông báo công khai an toàn.

Đoạn `admin.from('users').upsert(payload)` hiện tại bị xóa hoàn toàn. Edge
Function không tự bật GUC và không chứa service-role bypass logic.

## 6. Error contract và giới hạn dữ liệu

- Authorization/request validation tiếp tục trả public message cụ thể qua
  `EdgeAuthorizationError` hoặc request error an toàn.
- Lỗi Postgres/Auth nội bộ trả `Không thể xử lý yêu cầu tài khoản.`; không trả
  SQL, schema, function name, Auth ID hoặc profile ID.
- Password chỉ truyền vào `auth.admin.createUser`; không đưa vào RPC, audit,
  log hoặc response.
- Không ghi service-role key, bearer token, email canary hoặc random credential
  vào test output, docs hay chat.
- Profile payload bị giới hạn theo whitelist; unknown key hoặc sai JSON type bị
  từ chối trước update.

## 7. TDD và verification

### 7.1 Repository RED/GREEN

Viết test trước để chứng minh code hiện tại sai:

- migration contract yêu cầu private definer, public invoker wrapper, ACL hẹp,
  actor/target validation, command-local GUC, `FINALIZE` và `ROLLBACK`;
- migration/SQL contract yêu cầu Auth trigger không còn đọc protected field từ
  `raw_user_meta_data`, trong khi email và field hiển thị an toàn vẫn sync;
- Edge contract yêu cầu gọi RPC và cấm `from('users').upsert(...)`;
- Edge contract yêu cầu compensation RPC chạy trước `deleteUser`;
- contract giữ nguyên việc không đưa authorization data vào `user_metadata`;
- SQL smoke kiểm tra authenticated/anon không có execute, service-role
  `FINALIZE` hoạt động trong rollback transaction và normal update vẫn bị
  `42501` ngoài command.

Test mới phải RED vì migration/RPC chưa tồn tại hoặc Edge vẫn còn direct
upsert; sau implementation phải GREEN.

### 7.2 Cloud rollback-only gate

Tạo migration bằng `supabase migration new`, commit candidate rồi chạy migration
và smoke trong một linked transaction kết thúc bằng explicit `ROLLBACK`.
Sau rollback phải chứng minh:

- function/RPC mới không tồn tại trên committed Cloud;
- migration version chưa có remote marker;
- guard hash, ba rollout flag và inventory 467 sensitive grant không đổi.

Chỉ sau báo cáo rollback-only PASS và checkpoint apply riêng mới apply migration
và deploy đúng Edge Function `create-user`.

### 7.3 Post-apply canary

Sau apply/deploy:

1. Tạo zero-right `EMPLOYEE` canary qua UI.
2. Xác nhận một active profile có `auth_id`, zero direct grant và zero active
   Business Role.
3. Đăng nhập canary và gọi unauthorized Data API RPC; expected code `42501`,
   message `Authorization administration permission required`, details/hint an
   toàn và zero mutation.
4. Vô hiệu hóa canary qua account lifecycle; xác nhận login bị chặn và không
   còn active grant/role/assignment.
5. Chạy full test, lint, build, committed Cloud smoke, advisors và migration
   history check.

## 8. Rollout và rollback

- Apply migration command + Auth-trigger hardening trước, verify committed SQL
  smoke, repair đúng một version rồi mới deploy `create-user`; Edge cũ chỉ tiếp
  tục lỗi an toàn trong cửa sổ ngắn này, không được nới guard để che cửa sổ
  rollout.
- Nếu migration smoke lỗi: không repair history; lập forward migration mới.
- Nếu Edge deploy/canary lỗi: giữ ba rollout flag `false`, không sửa migration
  đã apply. Roll back Edge Function về version trước chỉ khi cần khôi phục hành
  vi công khai; lỗi tạo user an toàn vẫn được ưu tiên hơn bypass rộng.
- Mọi sửa schema sau apply dùng migration mới. Không xóa/repair ngược lịch sử
  để giả rollback.

## 9. Tiêu chí hoàn tất

Phương án chỉ hoàn tất khi có đủ bằng chứng:

- repository RED/GREEN và full verification pass;
- linked-Cloud rollback-only gate pass trước mutation;
- đúng một migration command mới được apply/repaired;
- đúng Edge Function `create-user` được deploy từ candidate đã verify;
- UI tạo zero-right canary pass;
- unauthorized canary bị từ chối `42501` và zero mutation;
- canary được disable qua lifecycle chuẩn;
- ba rollout flag vẫn `false`, inventory sensitive-null-expiry vẫn 467;
- live apply log ghi đúng evidence, không chứa secret hoặc identity canary.

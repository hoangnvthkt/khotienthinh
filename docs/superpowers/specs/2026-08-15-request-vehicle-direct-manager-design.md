# Thiết kế duyệt theo quản lý trực tiếp cho Yêu cầu và Đặt xe

Ngày: 2026-08-15
Trạng thái: Đã thống nhất thiết kế, chờ duyệt tài liệu trước khi lập kế hoạch triển khai

## 1. Mục tiêu

Chuẩn hóa cách hai module **Yêu cầu** và **Đặt xe** sử dụng quan hệ `users.manager_id` để xác định người quản lý trực tiếp của người tạo/gửi đơn.

Thiết kế phải bảo đảm:

- Module Yêu cầu cho phép mẫu duyệt chọn bắt buộc quản lý trực tiếp hoặc chọn người duyệt linh động.
- Module Đặt xe có cấu hình bật/tắt bước quản lý trực tiếp duyệt.
- Người duyệt được chốt tại thời điểm gửi; thay đổi quan hệ quản lý về sau không âm thầm đổi đơn đang chạy.
- Không cho người tạo tự duyệt yêu cầu của chính mình.
- Mọi trường hợp bỏ qua hoặc chuyển người duyệt đều có dấu vết kiểm toán.

## 2. Phạm vi

### Trong phạm vi

- Trình chỉnh sửa luồng duyệt của module Yêu cầu.
- Thao tác gửi Yêu cầu và phân công người duyệt.
- Trang Đặt xe → Cấu hình.
- Thao tác gửi đơn Đặt xe, hàng chờ quản lý và hàng chờ Điều phối.
- Thông báo, lịch sử và kiểm thử liên quan.
- Supabase Cloud thông qua cấu hình `.env` hiện có.

### Ngoài phạm vi

- Module Quy trình chung (`/wf`).
- Tự động suy ra quản lý từ sơ đồ tổ chức hoặc trưởng phòng.
- Thiết kế lại tài khoản, phòng ban hoặc sơ đồ tổ chức.
- Thay đổi chính sách `ALL`/`ANY_ONE` đang có của khối duyệt Yêu cầu.
- Giới hạn người được @mention theo phòng ban hoặc nhóm quyền.

## 3. Thuật ngữ và nguồn dữ liệu

- **Người gửi**: tài khoản thực hiện thao tác gửi Yêu cầu hoặc Đặt xe.
- **Quản lý trực tiếp**: tài khoản được tham chiếu bởi `users.manager_id` của người gửi.
- **Quản lý hợp lệ**: tài khoản tồn tại, đang hoạt động, có `account_status = 'ACTIVE'` và không phải chính người gửi.
- **Snapshot người duyệt**: ID người duyệt được lưu trên đơn/phân công tại thời điểm gửi.
- **Bypass**: người gửi xác nhận tiếp tục gửi đơn Đặt xe khi cấu hình yêu cầu quản lý duyệt nhưng tài khoản chưa có quản lý hợp lệ.

Quan hệ `users.manager_id` là nguồn dữ liệu duy nhất trong phạm vi thiết kế này. Sơ đồ tổ chức không tham gia phân giải người duyệt.

## 4. Kiến trúc chung

Hai module dùng chung hàm backend `app_private.resolve_active_direct_manager(p_user_id)` để phân giải quản lý hợp lệ. Hàm Request hiện tại được giữ làm wrapper để tương thích ngược.

Quy tắc chung:

1. Backend luôn tự lấy danh tính người gửi từ phiên đăng nhập; không tin `user_id` do client truyền vào.
2. Backend phân giải lại quản lý khi gửi, kể cả khi frontend đã xem trước kết quả.
3. Nếu có quản lý hợp lệ, ID quản lý được snapshot vào đơn/phân công.
4. Việc thay đổi `users.manager_id` chỉ ảnh hưởng các đơn gửi sau thời điểm thay đổi.
5. Đơn đã gửi chỉ được chuyển người duyệt bằng lệnh quản trị có lý do và sự kiện kiểm toán.
6. Nếu người duyệt snapshot bị khóa sau khi đơn đã gửi, đơn không tự đổi người; quản trị viên phải chuyển người duyệt hoặc xử lý theo quyền ngoại lệ hiện có.

## 5. Module Yêu cầu

### 5.1. Giao diện cấu hình mẫu

Trong trình chỉnh sửa khối **Quản lý trực tiếp**, hiển thị lựa chọn:

> Chỉ cho phép lấy quản lý trực tiếp đã thiết lập trong tài khoản?

#### Chọn Có

- Nguồn người duyệt là `DIRECT_MANAGER`.
- Ẩn các trường @mention người duyệt.
- Hiển thị chú thích: “Người duyệt sẽ là quản lý trực tiếp của người gửi tại thời điểm gửi yêu cầu.”
- Xóa dữ liệu người duyệt thủ công còn sót lại trong draft của khối để tránh cấu hình mâu thuẫn.

#### Chọn Không

Người thiết kế chọn một trong hai chế độ hiện có:

- **Chọn sẵn trong mẫu**: dùng `FIXED_SINGLE` hoặc `FIXED_MULTI`.
- **Người tạo chọn khi gửi**: dùng `DYNAMIC_CREATOR_SELECT`.

Danh sách @mention gồm mọi tài khoản hợp lệ trong hệ thống, không giới hạn theo phòng ban hoặc nhóm quyền.

Thiết kế dùng các giá trị `approver_source` hiện có, không thêm một nguồn phân công song song. Phiên bản mẫu đã publish tiếp tục bất biến theo cơ chế version hiện tại.

### 5.2. Xử lý khi gửi

Với `DIRECT_MANAGER`:

1. Phân giải quản lý trực tiếp hợp lệ của người gửi.
2. Nếu không có, chặn gửi với mã lỗi `REQUEST_DIRECT_MANAGER_MISSING`.
3. Hiển thị: “Tài khoản của bạn chưa được thiết lập người quản lý trực tiếp. Vui lòng liên hệ quản trị viên.”
4. Nếu có, tạo assignment và snapshot người quản lý vào cấu hình phê duyệt của instance như hiện tại.

Với `FIXED_SINGLE`, `FIXED_MULTI` và `DYNAMIC_CREATOR_SELECT`:

1. Xác minh toàn bộ người được chọn còn hợp lệ tại thời điểm gửi.
2. Từ chối nếu danh sách chứa chính người gửi, kể cả khi người đó được chọn sẵn trong mẫu.
3. Không lọc theo phòng ban hoặc nhóm quyền.
4. Giữ nguyên chính sách hoàn thành khối `ALL`/`ANY_ONE` của mẫu.

Backend dùng mã `REQUEST_APPROVER_SELF_NOT_ALLOWED` khi người gửi tự chọn mình và `REQUEST_APPROVER_INACTIVE` khi người được chọn không còn hợp lệ. Frontend ánh xạ hai mã này sang thông báo tiếng Việt rõ ràng.

### 5.3. Thay đổi quản lý sau khi gửi

- Thay đổi trước khi gửi: dùng quản lý mới khi gửi.
- Thay đổi sau khi gửi: assignment hiện tại không đổi.
- Quản trị viên có thể chuyển assignment đang chờ sang người khác bằng lệnh backend chuyên biệt.
- Lệnh chuyển bắt buộc có lý do, ghi người thao tác, người cũ, người mới và thời gian.

## 6. Module Đặt xe

### 6.1. Cấu hình hệ thống

Bổ sung cột vào singleton `fleet_system_settings`:

```text
require_direct_manager_approval boolean not null default true
```

Trang **Đặt xe → Cấu hình** hiển thị công tắc:

> Yêu cầu quản lý trực tiếp duyệt trước khi điều phối

Chỉ người có quyền quản trị cấu hình Booking hiện tại mới được thay đổi công tắc. RPC cập nhật cấu hình phải nhận, xác thực và lưu trường mới; client không được cập nhật trực tiếp bảng.

### 6.2. Luồng gửi đơn

Backend đọc cấu hình hiện hành trong cùng thao tác gửi và chọn một trong ba đường đi:

#### A. Cấu hình tắt

- Không yêu cầu hoặc phân giải quản lý.
- Đơn chuyển từ `DRAFT` sang `WAITING_DISPATCH`.
- Gửi thông báo cho nhân sự Điều phối đang được cấu hình.
- Ghi đường đi `CONFIG_DISABLED`.

#### B. Cấu hình bật và có quản lý hợp lệ

- Snapshot quản lý vào `manager_user_id_snapshot`.
- Đơn chuyển từ `DRAFT` sang `PENDING_APPROVAL`.
- Gửi thông báo cho quản lý snapshot.
- Ghi đường đi `MANAGER`.

#### C. Cấu hình bật nhưng thiếu quản lý hợp lệ

- Nếu người gửi chưa xác nhận bypass, backend không đổi trạng thái đơn và trả mã `VEHICLE_DIRECT_MANAGER_CONFIRMATION_REQUIRED`.
- Frontend hiển thị:

  > Bạn chưa được thiết lập người quản lý trực tiếp. Nếu tiếp tục, đơn sẽ bỏ qua bước duyệt và chuyển thẳng đến bộ phận Điều phối. Bạn có muốn gửi không?

- **Quay lại**: không gửi; giữ dữ liệu biểu mẫu.
- **Vẫn gửi**: gửi lại lệnh với cờ xác nhận; backend phân giải lại quản lý.
- Nếu vẫn thiếu quản lý, đơn chuyển sang `WAITING_DISPATCH`, thông báo cho Điều phối và ghi đường đi `MISSING_MANAGER_BYPASS`.
- Nếu trong thời gian xác nhận tài khoản đã có quản lý hợp lệ, backend bỏ qua cờ bypass và chuyển đơn sang `PENDING_APPROVAL` cho quản lý mới.

Trước khi tạo draft, frontend gọi RPC xem trước đường đi của thao tác gửi. Nếu kết quả là thiếu quản lý cần xác nhận, frontend phải hiển thị hộp thoại trước khi tạo bản ghi. Sau khi người dùng xác nhận, lệnh submit backend vẫn phân giải lại cấu hình và quản lý để chống race condition. Nếu trạng thái thay đổi giữa lúc xem trước và submit, quyết định của backend là kết quả cuối cùng.

### 6.3. Dữ liệu theo dõi đường đi

Bổ sung trường trên `vehicle_bookings` để phân biệt rõ nghiệp vụ:

```text
manager_approval_route text null
  check (manager_approval_route in (
    'MANAGER',
    'CONFIG_DISABLED',
    'MISSING_MANAGER_BYPASS',
    'LEGACY'
  ))

manager_bypass_confirmed_by_user_id uuid null references users(id)
manager_bypass_confirmed_at timestamptz null
```

- Draft chưa submit để `manager_approval_route` là `null`.
- Dữ liệu cũ đã submit được đánh dấu `LEGACY` khi không thể suy ra chắc chắn đường đi mà không thay đổi ý nghĩa nghiệp vụ.
- Trường `manager_resolution_status` và `approval_source` hiện có được giữ để tương thích; dữ liệu đường đi mới là nguồn báo cáo rõ lý do bỏ qua bước quản lý.
- Bypass do thiếu quản lý khác với “Điều phối duyệt thay”. Bypass chuyển thẳng vào hàng chờ Điều phối; nó không giả lập một quyết định duyệt của quản lý.

### 6.4. An toàn backend

Lệnh submit nhận thêm cờ `p_confirm_missing_manager_bypass boolean default false`, nhưng chỉ chấp nhận cờ khi:

- Cấu hình đang bật; và
- Backend vừa xác định người gửi không có quản lý hợp lệ.

Client không thể dùng cờ này để bỏ qua một quản lý đang tồn tại. Backend lấy người gửi từ phiên đăng nhập và kiểm tra quyền sở hữu draft như hiện tại.

### 6.5. Thay đổi quản lý sau khi gửi

- Đơn `PENDING_APPROVAL` giữ nguyên `manager_user_id_snapshot`.
- Không tự động thay đổi người duyệt khi `users.manager_id` đổi.
- Quản trị viên chuyển người duyệt bằng lệnh có lý do và audit.
- Đơn đã vào `WAITING_DISPATCH` do bypass không tự quay lại bước quản lý khi tài khoản được bổ sung quản lý sau đó.

## 7. Thông báo và kiểm toán

Tối thiểu phải có các sự kiện:

- Yêu cầu được phân công cho quản lý trực tiếp.
- Yêu cầu bị chuyển từ người duyệt cũ sang người duyệt mới.
- Đặt xe được gửi cho quản lý.
- Đặt xe bỏ qua quản lý vì cấu hình tắt.
- Đặt xe bypass vì thiếu quản lý và người gửi xác nhận.
- Đặt xe được chuyển người duyệt bởi quản trị viên.

Sự kiện phải lưu ID đơn, người thao tác, người duyệt cũ/mới nếu có, lý do, thời gian và metadata đường đi. Thông báo chỉ gửi sau khi transaction thay đổi trạng thái thành công.

## 8. Phân quyền

- Người thiết kế mẫu Yêu cầu tiếp tục dùng quyền quản lý mẫu hiện có.
- Người gửi chỉ được chọn người duyệt linh động trên chính yêu cầu của mình.
- Người gửi không được chọn chính mình.
- Chỉ quản trị viên có quyền cấu hình Booking mới thay đổi công tắc duyệt quản lý.
- Chỉ quản lý snapshot được duyệt/từ chối đơn Đặt xe, trừ các lệnh ngoại lệ đã được phân quyền rõ ràng.
- RLS và RPC là lớp thực thi quyền cuối cùng; ẩn nút trên frontend không được coi là kiểm soát quyền.

## 9. Tương thích và triển khai dữ liệu

- Migration chỉ chạy trên Supabase Cloud theo cấu hình `.env`; không dùng Supabase local hoặc Docker.
- `require_direct_manager_approval` mặc định `true` để giữ luồng Đặt xe hiện hành sau khi triển khai.
- Mẫu Yêu cầu hiện có giữ nguyên `approver_source` và không bị đổi hành vi.
- Đơn đã gửi giữ nguyên trạng thái và người duyệt snapshot.
- Không tự động tạo `manager_id` từ phòng ban trong migration này.

## 10. Kiểm thử và tiêu chí chấp nhận

### Yêu cầu

- `DIRECT_MANAGER` lấy đúng quản lý hợp lệ của người gửi.
- Thiếu, khóa hoặc vô hiệu hóa quản lý thì chặn gửi với đúng thông báo.
- Chế độ linh động cho chọn mọi user hợp lệ và không giới hạn phòng ban/nhóm quyền.
- Không cho người gửi tự chọn mình ở cả lựa chọn cố định và lựa chọn khi gửi.
- User bị vô hiệu hóa sau lúc cấu hình nhưng trước lúc gửi bị từ chối.
- Thay đổi quản lý trước khi gửi dùng người mới; sau khi gửi giữ snapshot cũ.
- Chuyển người duyệt bởi quản trị viên bắt buộc có lý do và có audit.

### Đặt xe

- Cấu hình tắt chuyển thẳng sang `WAITING_DISPATCH` và thông báo Điều phối.
- Cấu hình bật, có quản lý chuyển sang `PENDING_APPROVAL` và chỉ snapshot manager được duyệt.
- Cấu hình bật, thiếu quản lý trả yêu cầu xác nhận mà chưa đổi trạng thái.
- Xác nhận bypass chuyển sang `WAITING_DISPATCH`, lưu người xác nhận/thời gian/đường đi và thông báo Điều phối.
- Hủy hộp thoại không gửi đơn và giữ dữ liệu nhập.
- Cờ bypass giả mạo không bỏ qua quản lý hợp lệ.
- Thay đổi cấu hình hoặc quản lý giữa lần kiểm tra và submit được backend xử lý theo trạng thái mới nhất.
- Đổi quản lý sau submit không tự đổi snapshot.
- Dữ liệu cũ không đổi trạng thái sau migration.

### Chất lượng

- Unit test cho model giao diện, validation và mapping cấu hình.
- Contract test cho migration/RPC và mã lỗi.
- Integration test cho các chuyển trạng thái và quyền.
- Regression test cho các luồng Yêu cầu và Đặt xe hiện có.
- Build và toàn bộ test liên quan phải đạt trước khi merge.

## 11. Trình tự triển khai đề xuất

1. Migration cho resolver dùng chung, cấu hình Booking và dữ liệu đường đi.
2. Backend/RPC và kiểm thử quyền, chuyển trạng thái, audit.
3. Giao diện cấu hình và runtime của Yêu cầu.
4. Giao diện cấu hình, xác nhận bypass và runtime của Đặt xe.
5. Kiểm thử tích hợp trên Supabase Cloud với dữ liệu thử nghiệm có thể thu hồi.
6. Rà soát dữ liệu và phát hành.

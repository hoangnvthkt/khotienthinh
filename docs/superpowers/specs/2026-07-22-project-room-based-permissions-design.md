# Thiết kế phân quyền theo Room cho module Dự án

Ngày thiết kế: 2026-07-22

Trạng thái: Đã duyệt ngày 2026-07-22

Phạm vi: Module Dự án, ưu tiên Tab Phân quyền và các nghiệp vụ đang dùng quyền legacy

## 1. Mục tiêu

Thay ma trận quyền Dự án hiện tại bằng một giao diện trực quan gồm các **Room nghiệp vụ cố định**. Mỗi Room hiển thị thành viên bằng avatar và cho phép admin chỉnh quyền của một hoặc nhiều người rồi lưu một lần.

Thiết kế phải đồng thời giải quyết các vấn đề sau:

- Giữ lại đầy đủ ý nghĩa và dữ liệu của tám quyền legacy: `view`, `edit`, `delete`, `submit`, `verify`, `confirm`, `approve`, `view_available_stock`.
- Không để cùng một quyền generic làm trộn người xử lý của các nghiệp vụ khác nhau.
- Quyền phải được kiểm tra thật ở backend, không chỉ dùng để ẩn nút hoặc lọc danh sách người nhận.
- UI quản trị tập trung hoàn toàn tại Tab Phân quyền; các tab nghiệp vụ không có giao diện cấu hình Room.
- Chỉ system admin được thay đổi thành viên và quyền trong Room ở phase này.
- Không bổ sung cơ chế phát hiện ghi đè đồng thời trong phase này.

## 2. Các quyết định đã chốt

1. UI, API và dữ liệu cùng gọi phạm vi nghiệp vụ là **Room**; `room_code` là tên kỹ thuật duy nhất, không duy trì thêm khái niệm `pool` song song.
2. Room là danh mục hệ thống cố định. Admin không được tự tạo, đổi mã hoặc xóa Room.
3. Toàn bộ Room được quản trị tại một Tab Phân quyền duy nhất.
4. Mỗi Room đại diện cho một luồng có khả năng cần danh sách người xử lý riêng, không nhất thiết tương ứng một-một với tab chức năng.
5. Một người có thể thuộc nhiều Room. Đây là hành vi hợp lệ và có chủ đích.
6. Quyền được gắn với quan hệ người–Room. Không dùng một bộ quyền generic toàn dự án rồi kết hợp với danh sách Room của người đó.
7. Room kiểm soát cả quyền thao tác và eligibility nhận việc, không chỉ lọc UI.
8. Hệ thống tự suy ra Room từ loại chứng từ/nghiệp vụ. Người gửi không được tự chọn Room.
9. Admin override không làm admin tự động xuất hiện trong danh sách người nhận. Muốn là người nhận, admin cũng phải là thành viên có đúng action trong Room.
10. Room không thay thế assignment. Room quyết định ai đủ điều kiện; assignment quyết định ai đang được xử lý một hồ sơ cụ thể.

## 3. Kết luận audit quyền legacy

### 3.1 Bộ quyền cần giữ lại

| Action | Ý nghĩa chuẩn sau khi đưa vào Room |
| --- | --- |
| `view` | Xem dữ liệu thuộc Room/nghiệp vụ |
| `edit` | Tạo hoặc sửa dữ liệu khi trạng thái và quan hệ hồ sơ cho phép |
| `delete` | Xóa dữ liệu khi chính sách trạng thái cho phép |
| `submit` | Gửi hồ sơ vào luồng xử lý |
| `verify` | Kiểm tra/xác minh kỹ thuật tại bước tương ứng |
| `confirm` | Xác nhận nghiệp vụ hoặc xác nhận hoàn tất nghiệp vụ |
| `approve` | Phê duyệt ở bước duyệt |
| `view_available_stock` | Xem tồn kho khả dụng trong nghiệp vụ vật tư |

Các alias legacy chỉ được dùng khi đọc dữ liệu cũ:

- `reject`, `returned` → `verify`.
- `paid` → `confirm`.

Alias không được lưu thành action mới. Hành động `Trả lại` tuân theo assignment và trạng thái workflow; nó không tự tạo thêm quyền generic mới.

### 3.2 Nguyên nhân lỗi hiện tại

Quyền legacy chỉ chứa động từ, không chứa ngữ cảnh nghiệp vụ. Ví dụ `approve` không cho biết đó là duyệt Nhật ký, PO, Chất lượng hay Thanh toán.

Migration PBAC v2 hiện còn chiếu hai chiều làm mất ngữ cảnh:

- Một quyền legacy được trải sang mọi module có cùng action.
- Một quyền có namespace ở bất kỳ module nào lại được quy về quyền legacy generic.

Vì vậy danh sách người nhận truyền `approve`, `verify` hoặc `confirm` có thể trả về nhân sự của nhiều nghiệp vụ không liên quan.

### 3.3 Cách Room sửa lỗi

Một quyền hiệu lực được xác định bằng cặp:

```text
(room_code, action_code)
```

Ví dụ:

```text
(daily_log, approve)
(material_po, approve)
```

Hai cặp trên dùng lại cùng action `approve` nhưng là hai quyền hiệu lực độc lập. Về ý nghĩa, chúng tương đương quyền namespaced nhưng không cần hiển thị hàng trăm mã quyền trên UI.

## 4. Danh mục Room cố định

Room được nhóm theo khu vực nghiệp vụ để trình bày. Nhóm chỉ phục vụ UI; `room_code` mới là ranh giới authorization.

| Nhóm UI | Room | `room_code` | Action hợp lệ |
| --- | --- | --- | --- |
| Nhật ký | Nhật ký công trường | `daily_log` | `view`, `edit`, `delete`, `submit`, `verify`, `approve` |
| Vật tư | Kế hoạch & BOQ vật tư | `material_planning` | `view`, `edit`, `delete` |
| Vật tư | Đề xuất vật tư | `material_request` | `view`, `edit`, `delete`, `submit`, `verify`, `confirm`, `approve`, `view_available_stock` |
| Vật tư | Đơn hàng PO | `material_po` | `view`, `edit`, `delete`, `submit`, `approve`, `confirm` |
| Vật tư | Hao hụt vật tư | `material_waste` | `view`, `edit`, `approve` |
| Vật tư | Vật tư phi tiêu chuẩn | `custom_material` | `view`, `edit`, `approve` |
| Tiến độ | Tiến độ Gantt | `gantt` | `view`, `edit`, `delete`, `submit`, `verify`, `approve` |
| Chốt tiến độ | Chốt tiến độ ngày/tuần | `weekly_progress` | `view`, `edit`, `submit`, `verify`, `approve`, `confirm` |
| Tài chính | Nghiệm thu khối lượng | `quantity_acceptance` | `view`, `edit`, `delete`, `submit`, `verify`, `approve` |
| Tài chính | Thanh toán | `payment` | `view`, `edit`, `delete`, `submit`, `verify`, `approve`, `confirm` |
| Tài chính | Đối soát BOQ | `boq_reconciliation` | `view`, `edit`, `submit`, `verify`, `approve` |
| Chất lượng | Hồ sơ & checklist chất lượng | `quality` | `view`, `edit`, `delete`, `submit`, `verify`, `approve` |
| An toàn | Hồ sơ & sự cố an toàn | `safety` | `view`, `edit`, `delete`, `submit`, `verify`, `confirm`, `approve` |
| Nhà thầu | Nghiệm thu & thanh toán nhà thầu | `subcontract` | `view`, `edit`, `delete`, `submit`, `verify`, `approve`, `confirm` |

Action có nhãn theo ngữ cảnh nhưng mã lưu trữ không đổi. Các nhãn đặc thù phase này được chốt như sau:

- `edit` trong Hao hụt vật tư hiển thị **Ghi nhận hao hụt**.
- `edit` trong Vật tư phi tiêu chuẩn hiển thị **Tạo/sửa yêu cầu**.
- `submit` trong PO hiển thị **Gửi duyệt PO**.
- `confirm` trong PO hiển thị **Xác nhận nhận hàng**.
- `confirm` trong Thanh toán hiển thị **Xác nhận đã thanh toán**.
- `confirm` trong Chốt tiến độ hiển thị **Khóa/chốt kỳ**.
- `confirm` trong An toàn hiển thị **Đóng sự cố**.
- `confirm` trong Nhà thầu hiển thị **Xác nhận thanh toán**.

Bảng Room/action ở trên là nguồn sự thật của phase này. Mỗi nút và transition hiện có phải được ánh xạ vào đúng một action trong bảng; action không nằm trong whitelist của Room bị backend từ chối.

## 5. Các tab không dùng Room

| Tab | Quy tắc phase này |
| --- | --- |
| Tổ chức | Chỉ system admin được thêm, sửa, kết thúc hoặc xóa nhân sự |
| Tài liệu | Thành viên dự án được xem và upload; chính sách xóa vẫn phải tuân theo chủ sở hữu/admin |
| Báo cáo | Chỉ xem; thao tác xuất dữ liệu không được xem là quyền workflow riêng |
| Điều hành | Chỉ xem |
| Hợp đồng | Chỉ xem và deeplink sang module Hợp đồng; quyền hợp đồng/phát sinh thuộc module Hợp đồng |

Các tab trên không tạo Card Room giả chỉ để hiển thị `view`, vì như vậy sẽ làm UI quay lại ma trận thừa.

## 6. Thiết kế UI Tab Phân quyền

### 6.1 Màn hình tổng quan

Tab Phân quyền hiển thị tất cả Room trong một trang. Bố cục desktop là lưới Card responsive; mobile là danh sách Card một cột.

Phần đầu trang gồm:

- Tiêu đề **Phân quyền dự án**.
- Mô tả ngắn: “Phân nhân sự vào từng Room nghiệp vụ và cấp quyền trong phạm vi Room”.
- Ô tìm kiếm theo tên Room hoặc nhân viên.
- Bộ lọc theo nhóm nghiệp vụ.
- Thống kê gọn: tổng Room, số nhân sự đã phân quyền, Room chưa có người duyệt/xác nhận.

Mỗi Room Card gồm:

- Icon và màu nhận diện theo nhóm nghiệp vụ.
- Tên Room và một dòng mô tả.
- Số thành viên.
- Avatar stack tối đa 5 người và chỉ báo `+N`.
- Badge tổng hợp theo action quan trọng, ví dụ `Duyệt 2`, `Xác nhận 1`.
- Cảnh báo nếu action bắt buộc của workflow chưa có người phù hợp.
- Nút hoặc toàn bộ Card có thể bấm để mở chi tiết.

Card chỉ tóm tắt; không đặt toàn bộ checkbox quyền trực tiếp trên Card.

### 6.2 Chi tiết Room

Desktop mở Right Drawer rộng; mobile mở full-screen sheet. Người dùng không bị điều hướng khỏi Tab Phân quyền.

Header Drawer gồm:

- Tên, icon và mô tả Room.
- Scope hiện tại: toàn dự án hoặc công trường đang chọn.
- Số thành viên và trạng thái cấu hình.
- Nút **Thêm nhân viên**.

Danh sách thành viên hiển thị theo hàng:

- Checkbox chọn hàng.
- Avatar, họ tên, chức danh và công trường.
- Các action hợp lệ của riêng Room dưới dạng checkbox/chip rõ trạng thái.
- Nút gỡ người khỏi Room.

Không hiển thị action không hợp lệ đối với Room. Ví dụ Room Nhật ký không hiển thị `confirm`; Room Kế hoạch vật tư không hiển thị `approve`.

### 6.3 Chỉnh một hoặc nhiều nhân viên

Hai cách chỉnh cùng tồn tại:

1. Tick action ngay trên hàng để sửa một người.
2. Chọn nhiều hàng để mở thanh thao tác hàng loạt:
   - Cấp action.
   - Gỡ action.
   - Gỡ khỏi Room.

Nút **Thêm nhân viên** mở picker lấy từ nhân sự đang hoạt động của dự án/công trường. Picker hỗ trợ tìm kiếm và chọn nhiều người. Người đã có trong Room hiển thị trạng thái đã tham gia và không được thêm trùng.

Thay đổi chỉ nằm trong draft của Drawer cho tới khi bấm **Lưu thay đổi**. Footer cố định gồm:

- Số thay đổi chưa lưu.
- **Hủy thay đổi**.
- **Lưu thay đổi**.

Phase này không có version check hoặc cảnh báo ghi đè đồng thời theo quyết định đã chốt.

### 6.4 Trạng thái và phản hồi

- Loading Card dùng skeleton, không làm nhảy layout.
- Drawer lưu thành công cập nhật Card ngay và hiển thị toast ngắn.
- Lưu thất bại giữ nguyên draft để admin thử lại.
- Nếu Room thiếu người cho action bắt buộc, Card và Drawer hiển thị cảnh báo nhưng không tự cấp quyền.
- Nhân sự đã kết thúc phân công không được thêm mới; membership cũ được hiển thị trạng thái ngừng hoạt động trong audit, không xuất hiện trong recipient picker.

## 7. Mô hình dữ liệu

### 7.1 Bảng định nghĩa Room

`project_permission_rooms`

| Cột | Ý nghĩa |
| --- | --- |
| `code` | Mã Room cố định, khóa chính |
| `group_code` | Nhóm hiển thị |
| `name` | Tên Room |
| `description` | Mô tả nghiệp vụ |
| `allowed_actions` | Danh sách action hợp lệ |
| `sort_order` | Thứ tự hiển thị |
| `is_active` | Cho phép rollout/ẩn Room có kiểm soát |

Bảng được seed bằng migration. UI không có API tạo, sửa mã hoặc xóa Room.

### 7.2 Thành viên Room

`project_permission_room_members`

| Cột | Ý nghĩa |
| --- | --- |
| `id` | Khóa chính |
| `project_id` | Dự án |
| `construction_site_id` | Công trường, nullable nếu áp dụng toàn dự án |
| `room_code` | Room cố định |
| `project_staff_id` | Phân công nhân sự hiện hành |
| `is_active` | Trạng thái membership |
| `created_by`, `created_at`, `updated_at` | Audit cơ bản |

Ràng buộc unique ngăn cùng một `project_staff_id` tham gia trùng Room trong cùng scope.

### 7.3 Action của thành viên Room

`project_permission_room_member_actions`

| Cột | Ý nghĩa |
| --- | --- |
| `room_member_id` | Thành viên Room |
| `action_code` | Một trong tám action legacy đã chuẩn hóa |
| `is_active` | Trạng thái grant |
| `granted_by`, `granted_at`, `updated_at` | Audit cơ bản |

Constraint/trigger chỉ cho lưu action nằm trong `allowed_actions` của Room.

Membership và action được tách riêng để một người có thể được đưa vào Room trước khi hoàn tất cấu hình quyền. Người không có action không có quyền nghiệp vụ và không xuất hiện ở recipient picker.

### 7.4 Scope

- Membership `construction_site_id = null` áp dụng toàn dự án.
- Membership theo công trường chỉ áp dụng cho công trường đó.
- Khi đang ở một công trường, quyền hiệu lực là hợp của grant toàn dự án và grant đúng công trường.
- Phase này không có explicit deny hoặc cơ chế grant công trường ghi đè grant toàn dự án.

## 8. Authorization và workflow

### 8.1 Hàm kiểm tra chuẩn

Backend cung cấp một hàm/RPC chuẩn có ý nghĩa:

```text
project_user_has_room_action(
  user_id,
  project_id,
  construction_site_id,
  room_code,
  action_code
)
```

Kết quả chỉ true khi:

1. Tài khoản hoạt động.
2. Phân công dự án/công trường hoạt động.
3. Room tồn tại và đang hoạt động.
4. Action hợp lệ đối với Room.
5. Có membership Room phù hợp scope.
6. Có grant action đang hoạt động.

System admin được quản trị Room và được giữ cơ chế override thao tác nghiệp vụ hiện hành. Override phải được ghi audit và không làm admin trở thành candidate nhận việc; recipient picker vẫn yêu cầu Room membership và action như mọi người dùng khác.

### 8.2 Quyền thao tác trên một hồ sơ

Có Room action chưa đủ để xử lý mọi hồ sơ. Quyền cuối cùng tuân theo chuỗi:

```text
tài khoản hoạt động
→ có quan hệ với dự án/công trường
→ có action trong đúng Room
→ trạng thái hồ sơ cho phép action
→ nếu là workflow action: là assignee hiện tại
→ dữ liệu đầu vào hợp lệ
```

Ví dụ một người có `(payment, approve)` nhưng không phải assignee hiện tại không được duyệt chứng từ đang chờ người khác.

### 8.3 Danh sách người nhận

Recipient RPC nhận bắt buộc:

```text
project_id
construction_site_id
room_code
required_action
```

Candidate phải đồng thời:

- Là nhân sự hoạt động đúng scope.
- Thuộc đúng Room.
- Có đúng action.
- Đủ điều kiện VIEW App Dự án theo kiến trúc quyền cấp App.

Không còn API recipient nhận riêng `approve`, `verify` hoặc `confirm` mà thiếu `room_code`.

Ví dụ:

```text
Nhật ký → room=daily_log, action=approve
PO       → room=material_po, action=approve
```

Người thuộc cả hai Room và có `approve` ở cả hai sẽ xuất hiện ở cả hai. Đây là kết quả đúng.

### 8.4 RLS/RPC là authority

- Frontend chỉ tính capability để hiển thị trạng thái và vô hiệu hóa nút.
- Mọi mutation phải gọi RPC hoặc đi qua RLS kiểm tra Room action, trạng thái và assignment.
- Direct API không được bỏ qua Room chỉ vì client không dùng màn hình chính thức.
- Transition workflow, đóng assignment hiện tại, tạo assignment kế tiếp, ghi audit và notification phải cùng transaction khi nghiệp vụ yêu cầu tính nguyên tử.

## 9. API phục vụ UI

Tối thiểu cần các operation sau:

1. `list_project_permission_rooms(project_id, construction_site_id)`
   - Trả metadata Room, số thành viên, avatar preview, count theo action và warning cấu hình.
2. `get_project_permission_room(project_id, construction_site_id, room_code)`
   - Trả danh sách thành viên và action hiện tại.
3. `list_project_room_staff_candidates(project_id, construction_site_id, room_code)`
   - Trả nhân sự hoạt động, trạng thái đã thuộc Room và lý do không hợp lệ nếu có.
4. `replace_project_permission_room_members(room_scope, members_payload)`
   - Lưu toàn bộ draft Room trong một transaction.
5. `list_project_room_action_recipients(project_id, construction_site_id, room_code, action_code)`
   - Trả candidate chính xác cho workflow.
6. `project_user_has_room_action(...)`
   - Hàm authorization dùng chung cho RPC/RLS/service.

`replace_project_permission_room_members` phải:

- Chỉ system admin được gọi trong phase này.
- Validate Room/action/scope/staff trước khi ghi.
- Upsert membership và action được gửi lên.
- Soft-deactivate các action/membership bị gỡ để giữ lịch sử audit; không hard-delete qua UI.
- Ghi một audit event chứa before/after diff.
- Rollback toàn bộ nếu bất kỳ phần tử nào không hợp lệ.

Không có optimistic concurrency/version conflict trong phase này.

## 10. Migration từ legacy

### 10.1 Nguyên tắc

- Không xóa hoặc ghi đè dữ liệu legacy trước khi snapshot.
- Không tự động trải một quyền generic sang tất cả Room.
- Không coi các namespaced grant do migration cũ sinh ra là bằng chứng chắc chắn về ý định nghiệp vụ.
- Chuyển đổi theo từng Room để tránh big-bang và tránh làm gián đoạn toàn module Dự án.

### 10.2 Quy trình chuyển đổi

1. Snapshot các bảng legacy, namespaced grant, staff assignment và audit liên quan.
2. Tạo registry Room và các bảng membership/action mới.
3. Sinh gợi ý Room từ bằng chứng nghiệp vụ:
   - Lịch sử đã được chọn làm handler/recipient.
   - Assignment workflow.
   - Audit transition thực tế.
   - Quyền đặc thù không mơ hồ như `view_available_stock`.
4. Đưa quyền không đủ ngữ cảnh vào danh sách **Chưa phân loại**, không tự cấp vào mọi Room.
5. Admin rà soát và lưu cấu hình Room lần đầu.
6. Chuyển từng nghiệp vụ sang recipient + authorization theo Room.
7. Sau khi một nghiệp vụ đã cutover và kiểm thử, ngừng đọc legacy generic tại nghiệp vụ đó.
8. Chỉ gỡ projection legacy hai chiều sau khi tất cả Room trong phạm vi đã cutover và có báo cáo đối chiếu.

### 10.3 Không làm mất quyền cũ

“Giữ lại quyền legacy” có nghĩa:

- Lưu snapshot đầy đủ người–scope–quyền trước migration.
- Có báo cáo mapping từ grant cũ sang Room/action mới hoặc trạng thái chưa phân loại.
- Không có grant legacy nào biến mất khỏi báo cáo mà không có kết quả xử lý.
- Có thể rollback đọc quyền legacy theo từng nghiệp vụ trong thời gian chuyển đổi.

Nó không có nghĩa là tự cấp một quyền mơ hồ cho mọi Room, vì đó chính là nguyên nhân gây sai nghiệp vụ hiện tại.

## 11. Tích hợp từng tab

Mỗi tab/nghiệp vụ phải khai báo cố định `room_code` và mapping action. Không để component truyền tùy ý một chuỗi action generic mà không có Room.

Ví dụ:

| Nghiệp vụ | Kiểm tra mới |
| --- | --- |
| Duyệt Nhật ký | `daily_log + approve` |
| Kiểm tra Nhật ký | `daily_log + verify` |
| Duyệt PO | `material_po + approve` |
| Xác nhận nhận hàng PO | `material_po + confirm` |
| Duyệt nghiệm thu | `quantity_acceptance + approve` |
| Duyệt chứng từ thanh toán | `payment + approve` |
| Đánh dấu đã thanh toán | `payment + confirm` |
| Duyệt checklist chất lượng | `quality + approve` |

Các component hiện còn truyền `['approve']`, `['verify']` hoặc `['confirm']` phải được chuyển hết sang API Room. Không giữ fallback generic cho recipient picker sau khi Room tương ứng đã cutover.

## 12. Audit và thông báo

Mỗi lần lưu Room ghi một event gồm:

- Actor admin.
- Dự án/công trường.
- Room.
- Danh sách người được thêm/gỡ.
- Action được cấp/gỡ theo từng người.
- Thời gian và nguồn thao tác.

Thông báo workflow sử dụng assignment đã tạo từ candidate Room. Việc một người bị gỡ khỏi Room không được âm thầm chuyển assignment đang mở. Assignment đó trở thành không đủ điều kiện/bị chặn và phải được cấp lại quyền hoặc giao lại theo đặc tả workflow đã duyệt.

## 13. Xử lý lỗi

| Tình huống | Hành vi |
| --- | --- |
| Room/action không hợp lệ | Backend từ chối; UI hiển thị cấu hình không hợp lệ |
| Nhân sự đã kết thúc phân công | Không cho thêm hoặc cấp action mới |
| Người nhận mất quyền trước lúc gửi | Transaction gửi thất bại, yêu cầu chọn lại |
| Room không có approver/verifier | Cảnh báo trên Card và chặn bước gửi cần người nhận |
| Lưu batch có một dòng lỗi | Rollback toàn bộ, giữ draft trên UI |
| Người bị gỡ Room đang có assignment | Assignment bị chặn, không tự chuyển người |
| Người ở nhiều Room | Cho phép; mỗi Room/action được tính độc lập |

## 14. Kiểm thử và tiêu chí nghiệm thu

### 14.1 Unit test

- Registry chỉ chấp nhận Room cố định và action trong whitelist.
- Quyền `approve` ở Room PO không suy ra `approve` ở Room Nhật ký.
- Membership không có action không tạo quyền hiệu lực.
- Grant toàn dự án và grant công trường được hợp đúng quy tắc.
- Admin override không làm admin xuất hiện trong recipient picker.

### 14.2 Database/RLS test

- Employee không thể tự sửa Room membership/action qua direct API.
- RPC batch là nguyên tử và ghi đúng audit before/after.
- Recipient RPC lọc đúng project, site, Room, action và trạng thái staff.
- Mutation nghiệp vụ bị từ chối nếu chỉ có legacy generic nhưng không có Room action sau cutover.
- Assignee thiếu Room action không thể transition workflow.

### 14.3 UI test

- Card hiển thị đúng số người, avatar và count action.
- Mở Drawer, thêm nhiều người, chỉnh nhiều quyền và lưu một lần.
- Hủy Drawer không làm thay đổi dữ liệu đã lưu.
- Lỗi lưu không làm mất draft.
- Action không hợp lệ với Room không xuất hiện.
- Mobile dùng full-screen sheet và thao tác batch vẫn sử dụng được.

### 14.4 End-to-end bắt buộc

Tạo hai người cùng có action `approve` nhưng ở hai Room khác nhau:

- Chị A: `(material_po, approve)`.
- Anh B: `(daily_log, approve)`.

Kết quả:

- Gửi PO chỉ thấy chị A.
- Gửi Nhật ký chỉ thấy anh B.
- Chị A không thể direct-call duyệt Nhật ký.
- Anh B không thể direct-call duyệt PO.

Sau đó cấp chị A thêm `(daily_log, approve)` và xác nhận chị A xuất hiện hợp lệ ở cả hai luồng.

### 14.5 Acceptance criteria

- Tất cả quyền legacy có báo cáo tác động và mapping/ trạng thái chưa phân loại.
- Không còn recipient picker trong phạm vi cutover truy vấn action generic thiếu Room.
- Không còn nút nghiệp vụ chỉ dựa trên `canManageTab` cho các Room đã cutover.
- Backend và UI dùng cùng một mapping Room/action.
- Admin chỉnh một hoặc nhiều nhân viên trong một Room và lưu một lần.
- Không tạo/xóa/đổi mã Room từ UI.
- Không còn hiện tượng approver PO xuất hiện trong Nhật ký nếu không thuộc Room Nhật ký.

## 15. Thứ tự triển khai đề xuất

1. Registry Room, schema, RLS/RPC và audit.
2. Tab Phân quyền: Card, Drawer, multi-select, batch save.
3. Công cụ snapshot và báo cáo mapping legacy.
4. Cutover Nhật ký công trường làm mẫu chuẩn.
5. Cutover Đề xuất vật tư và PO.
6. Cutover Tài chính: nghiệm thu, thanh toán, đối soát BOQ.
7. Cutover Gantt, Chốt tiến độ, Chất lượng, An toàn, Nhà thầu.
8. Đối chiếu toàn bộ quyền cũ/mới, tắt projection generic hai chiều và dọn fallback.

Mỗi bước cutover gồm đủ UI capability, recipient query, service/RPC, RLS và test; không chỉ đổi màn hình chọn người.

## 16. Ngoài phạm vi phase này

- Admin tự tạo hoặc xóa Room.
- Phân quyền theo vai trò quản trị trung gian ngoài system admin.
- Phát hiện hoặc hòa giải hai admin cùng sửa một Room.
- Drag-and-drop nhân viên giữa các Room.
- Điều kiện quyền động theo giá trị tiền, loại hợp đồng hoặc ngưỡng phê duyệt.
- Thiết kế lại workflow builder.
- Rollout mô hình Room sang module ngoài Dự án.

## 17. Quan hệ với đặc tả workflow hiện có

Tài liệu này bổ sung, không thay thế `2026-07-21-view-relationship-assignment-workflow-design.md`:

- `VIEW App` vẫn là cổng vào ứng dụng.
- Project membership vẫn quyết định quan hệ với dự án.
- Room/action bổ sung capability và eligibility theo nghiệp vụ.
- Assignment vẫn là trách nhiệm xử lý một hồ sơ cụ thể.
- Workflow state vẫn quyết định action nào hợp lệ tại thời điểm hiện tại.
- Backend vẫn là authority cuối cùng.

Chuỗi đầy đủ sau khi kết hợp hai thiết kế:

```text
VIEW App
→ quan hệ dự án/công trường
→ Room + action
→ assignment hiện tại nếu là workflow action
→ trạng thái hợp lệ
→ cho phép thao tác
```

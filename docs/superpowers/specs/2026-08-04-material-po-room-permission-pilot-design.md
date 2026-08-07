# Thiết kế pilot phân quyền Room cho Đơn hàng PO

Ngày thiết kế: 2026-08-04

Trạng thái: Đã duyệt ngày 2026-08-04

Phạm vi: Room `material_po` trong module Dự án > Vật tư > Đơn hàng PO

## 1. Mục tiêu

Hoàn thiện Room `material_po` thành mẫu chuẩn để chuyển quyền nghiệp vụ Dự án
từ PBAC sang Room. Sáu action `view`, `edit`, `delete`, `submit`, `approve` và
`confirm` phải được nối đồng nhất qua giao diện, capability frontend, RPC,
trigger/RLS và dữ liệu Room.

Sau khi pilot được kiểm tra thực tế và ổn định, cùng một mô hình sẽ được áp
dụng tuần tự cho các Room còn lại. Trong thời gian chuyển tiếp, PBAC chỉ là
nguồn tương thích có thể truy vết, không phải mô hình quyền đích.

## 2. Phạm vi và nguyên tắc đã chốt

- Hoàn thiện toàn bộ sáu action PO trong một đợt rồi mới đưa người dùng kiểm
  tra.
- Chỉ Room PO được chuyển từ `audit_only` sang `pilot`; các Room chưa cutover
  tiếp tục bị khóa với nhãn **Chưa áp dụng đầy đủ**.
- Room quyết định người dùng có đủ quyền nghiệp vụ hay không. Quan hệ chủ sở
  hữu, assignment, trạng thái hồ sơ và scope là các điều kiện bắt buộc bổ sung,
  không phải nguồn cấp quyền độc lập.
- System Admin được override khi thao tác nhưng không tự xuất hiện trong danh
  sách người nhận hoặc người được giao duyệt.
- PO tổng hợp cấp công ty và nghiệp vụ nhập kho tiếp tục tuân theo kiểm soát
  riêng; Room dự án không mở rộng quyền vượt qua chính sách công ty/WMS.
- Không thay đổi PO theo hướng UI-only. Direct API phải bị chặn bằng RPC,
  trigger hoặc RLS tương ứng.

## 3. Hợp đồng action của Room PO

Sáu action độc lập, không tự suy diễn lẫn nhau:

| Action | Hợp đồng nghiệp vụ |
| --- | --- |
| `view` | Xem PO và dữ liệu giao nhận thuộc đúng dự án/công trường. |
| `edit` | Tạo PO; sửa PO do mình tạo hoặc được giao khi hồ sơ ở `draft` hoặc `returned`. |
| `delete` | Xóa PO do mình tạo khi trạng thái cho phép; người tạo vẫn bắt buộc phải có action này. |
| `submit` | Gửi PO `draft` hoặc `returned` vào quy trình duyệt; không suy ra từ `edit`. |
| `approve` | Người đang được giao duyệt có thể duyệt hoặc trả lại/yêu cầu chỉnh sửa. |
| `confirm` | Quản lý quá trình giao nhận, xác nhận giao một phần/đủ và đóng PO; ghi nhận tồn kho thực tế vẫn cần quyền WMS/Thủ kho. |

Mọi action đồng thời yêu cầu:

- scope project và construction site phù hợp;
- `project_staff` còn hiệu lực;
- trạng thái PO cho phép hành động;
- quan hệ owner hoặc assignment đúng với hành động tương ứng.

`edit` không suy ra `delete` hoặc `submit`; `approve` không suy ra `confirm`.
Người có `approve` nhưng không phải assignee của PO bị từ chối.

## 4. Luồng kiểm quyền

Frontend lấy capability PO từ `get_my_project_room_actions(project, site)` và
hiển thị theo cùng action hiệu lực mà backend sử dụng. Kết quả phải giữ nguồn
`admin`, `room` hoặc `pbac_fallback` để phục vụ audit và badge ngoại lệ.

Backend sử dụng
`app_private.project_actor_has_effective_room_action(...)` cho thao tác nghiệp
vụ. `project_user_has_room_action(...)` chỉ kiểm tra Room thuần cho recipient;
không thêm admin và không dùng PBAC fallback.

Danh sách người được giao duyệt chỉ gồm nhân sự có Room action `approve` thuần,
đúng scope và còn hiệu lực. Quyền admin hoặc PBAC fallback không làm người dùng
tự động xuất hiện trong danh sách này.

### 4.1 Transition PO

RPC chuyển trạng thái chuẩn hóa theo ma trận sau:

| Transition | Action bắt buộc | Điều kiện bổ sung |
| --- | --- | --- |
| `draft/returned → sent` | `submit` | Owner/assignee phù hợp |
| `sent → confirmed` | `approve` | Đúng approver đang được giao |
| `sent → returned` | `approve` | Đúng approver đang được giao |
| Các bước giao một phần/đủ/đóng | `confirm` | Đúng scope và điều kiện logistics |

Các field workflow không được cập nhật trực tiếp để đi vòng RPC. Transition
ngoài ma trận hoặc thiếu assignment bị backend từ chối.

### 4.2 Tạo, sửa và xóa

- Insert/update PO và dòng PO yêu cầu `edit`, đúng scope và trạng thái.
- RPC xóa yêu cầu đồng thời: action `delete`, là người tạo PO, trạng thái cho
  phép, staff còn hiệu lực và đúng project/site.
- Không còn nhánh cho phép xóa chỉ vì là người tạo, có `edit`, có `create` hoặc
  có một quyền quản lý rộng.
- UI ẩn/khóa hành động không đủ quyền, nhưng RLS/RPC vẫn là lớp quyết định cuối
  cùng đối với direct API.

### 4.3 Giao nhận và WMS

Room action `confirm` điều khiển các hành động logistics ở cấp PO như tạo đợt
giao, xác nhận giao một phần/đủ và đóng PO. Hành động làm biến đổi tồn kho thật
vẫn phải qua chính sách WMS/Thủ kho. Có `confirm` nhưng không có quyền kho thì
không được ghi nhận nhập kho.

Các policy đặc thù cho PO tổng hợp cấp công ty, keeper và consolidated source
được giữ riêng và phải có smoke test chống mở rộng quyền ngoài dự án.

## 5. Backfill PBAC sang Room

Migration hợp quyền vào cấu hình Room hiện có; không ghi đè, deactivate hoặc
thu hồi grant PBAC.

| PBAC hiện tại | Room action backfill |
| --- | --- |
| `project.material_po.view` | `view` |
| `project.material_po.create` | `edit`, `submit` |
| `project.material_po.delete` | `delete` |
| `project.material_po.approve` | `approve` |
| `project.material_po.receive` | `confirm` |
| `project.material_po.manage` | Không backfill; báo cáo là PBAC ngoại lệ |

Ánh xạ `create → edit + submit` chỉ áp dụng cho PO vì frontend hiện tại đã dùng
PBAC `create` cho cả lập và gửi PO. Đây là phép bảo toàn hành vi đã xác minh,
không phải quy tắc suy diễn cho Room khác. Sau backfill, `edit` và `submit` là
hai checkbox độc lập để admin có thể cấp hoặc thu hồi riêng.

Backfill chỉ áp dụng khi:

- `project_staff` đang hoạt động;
- project/site khớp duy nhất;
- grant có ánh xạ được xác minh ở bảng trên.

Mỗi batch ghi audit event với nguồn `project_room_pbac_backfill`. Grant sai
scope, staff hết hiệu lực, dữ liệu mồ côi hoặc `manage` được đưa vào Permission
Health, không tự suy diễn thành Room action.

## 6. Trạng thái rollout và giao diện quản trị

Sau khi mọi enforcement path và test đạt yêu cầu, sáu binding của
`material_po` chuyển sang `pilot`. Drawer Room PO khi đó cho phép chỉnh và lưu
checkbox; backend cũng chấp nhận thay đổi các action pilot.

Action của Room khác còn `audit_only` tiếp tục khóa. Khi lưu một Drawer có dữ
liệu cũ, frontend và backend phải giữ nguyên action chưa cutover, không vô tình
deactivate chúng.

Trong pilot:

- Room được ưu tiên;
- `project_room_pbac_fallback_enabled` vẫn bật để giữ tương thích;
- user chỉ có quyền nhờ fallback được hiển thị trong Permission Health;
- badge **PBAC ngoại lệ** nêu rõ quyền legacy còn làm quyền hiệu lực vượt quá
  checkbox Room;
- `project.material_po.manage` không được hiểu là toàn quyền Room.

Fallback chỉ được tắt cho PO sau khi không còn user fallback-only và mọi grant
ngoại lệ đã có quyết định rõ ràng.

## 7. Kiểm thử chấp nhận

### 7.1 Contract và UI

1. Registry có đúng một binding cho mỗi action PO và cả sáu binding ở `pilot`
   sau cutover.
2. Drawer PO cho chỉnh/lưu; action `audit_only` của Room khác vẫn khóa ở UI và
   backend.
3. Kết quả quyền trả đúng source `room`, `pbac_fallback` hoặc `admin`.
4. Admin override không làm admin xuất hiện trong recipient picker.
5. Save không gỡ action chưa cutover hoặc grant Room hiện có.

### 7.2 Allow/deny nghiệp vụ

1. User chỉ có `edit` tạo/sửa được nhưng không thấy nút và không thể direct API
   xóa hoặc gửi.
2. User có `delete` chỉ xóa được PO do mình tạo ở trạng thái cho phép.
3. Người tạo thiếu `delete` không xóa được PO của mình.
4. User có `submit` gửi được PO nhưng không tự duyệt.
5. User có `approve` và được giao duyệt/trả lại được; user không phải assignee
   bị từ chối.
6. User có `confirm` quản lý giao nhận được nhưng không nhập kho được khi thiếu
   quyền WMS/Thủ kho.
7. Sai project/site, staff hết hiệu lực, Room membership không có action và
   direct API vượt RLS đều bị từ chối.
8. PBAC fallback bật/tắt cho kết quả tương thích; `manage` không tự biến thành
   toàn bộ action Room.

### 7.3 Hồi quy

- Luồng PO tổng hợp công ty và consolidated source giữ nguyên kiểm soát đặc
  thù.
- Luồng WMS receipt không bị Room PO vượt quyền.
- Các Room Daily Log và Material BOQ pilot hiện hữu không đổi hành vi.
- Các Room `audit_only` khác tiếp tục chỉ đọc trong Drawer.

## 8. Phát hành và rollback

Trước Cloud, chụp snapshot Room, actions, PBAC grants, policy/function/trigger
definitions và chạy audit matrix. Migration mới được tạo bằng Supabase CLI,
kiểm thử bằng unit/contract test, SQL smoke, lint, build, local reset và database
advisors.

Do migration history local/remote hiện chưa đồng bộ, Cloud được áp trong một
transaction theo quy trình direct-query hiện tại. Sau apply phải chạy lại audit
matrix và smoke trên schema thật trước khi đưa người dùng kiểm tra.

Người dùng kiểm tra trọn luồng:

```text
tạo/sửa → gửi → duyệt hoặc trả lại → giao nhận → đóng PO
```

Khi pilot ổn định và không còn fallback-only user, sáu action được chuyển từ
`pilot` sang `enforced`. Sau đó thiết kế này là mẫu để rollout lần lượt các Room
còn lại.

Rollback không xóa dữ liệu: chuyển sáu action PO về `audit_only` và giữ/bật lại
PBAC fallback. Dữ liệu Room, backfill và audit log được giữ nguyên để truy vết.

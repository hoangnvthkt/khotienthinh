# Kiến trúc Principal - Permission - Scope - Assignment - Workflow - Notification

Ngày lập: 2026-07-16  
Phạm vi: kiến trúc đích cho toàn bộ ERP VIOO, dùng Daily Log làm pilot trước khi áp dụng sang các module còn lại.

## 1. Tuyên ngôn kiến trúc

Một người không có một bộ quyền cố định cho toàn hệ thống. Quyền thực tế của họ tại một thời điểm phụ thuộc vào:

- Họ là ai trong hệ thống.
- Họ có chìa khóa nào.
- Chìa khóa đó mở phạm vi nào.
- Họ có đang được giao việc trên hồ sơ cụ thể hay không.
- Workflow đang ở trạng thái nào.
- Quyền hoặc phân công đó còn hiệu lực về thời gian hay không.

Thông báo không đi theo việc ai đang sở hữu một permission chung. Thông báo đi theo trách nhiệm và mối liên quan với workflow subject: người đang phải xử lý, người tạo, người theo dõi, người bị trả việc, người được nhắc do SLA hoặc cảnh báo nghiệp vụ.

Nói theo hình ảnh ngôi nhà:

- `Principal` là người hoặc nhóm người đứng trước cửa.
- `Application` là cả ngôi nhà VIOO.
- `Module` là từng phòng trong nhà.
- `Permission` là chìa khóa loại nào.
- `Scope` là chìa khóa đó mở đúng phòng, tầng, công trường, dự án hoặc kho nào.
- `Assignment` là tờ giao việc đặt trên bàn: hôm nay ai chịu trách nhiệm xử lý việc này.
- `Workflow` là nội quy di chuyển giữa các phòng: đang ở bước nào thì ai được làm gì.
- `Notification` là chuông báo đúng người đang có trách nhiệm, không reo cho tất cả người từng có chìa khóa giống nhau.

Mục tiêu là đúng người, đúng việc, đúng phạm vi, đúng thời điểm; đồng thời bảo mật, riêng tư và thông báo chính xác.

## 2. Nguyên tắc bắt buộc cho mọi module

1. Backend là nơi quyết định cuối cùng.
   - Frontend chỉ dùng quyền để ẩn/hiện UI.
   - RLS, RPC, trigger và function backend mới là lớp chặn thật.

2. Permission chỉ nói một principal có thể được phép.
   - Permission không đồng nghĩa với đang có trách nhiệm.
   - Ví dụ: có `project.daily_log.verify` nghĩa là có thể được giao xác nhận nhật ký trong scope hợp lệ; không có nghĩa là nhận mọi thông báo xác nhận nhật ký.

3. Assignment nói ai đang chịu trách nhiệm.
   - Notification, inbox và task count phải dựa vào assignment hiện hành.
   - Workflow mutation phải kiểm tra assignment khi hành động yêu cầu "assigned".

4. Scope luôn là một phần của quyết định.
   - Không chấp nhận action nhạy cảm chỉ dựa vào role/module toàn cục.
   - Scope tối thiểu gồm `global`, `own`, `assigned`, `project`, `construction_site`, `warehouse`, `department`.

5. Thời gian hiệu lực là first-class.
   - Grant và assignment phải có `starts_at`, `expires_at` hoặc cơ chế tương đương.
   - Quyền hết hạn không được dùng cho UI, RLS, RPC hoặc notification routing.

6. Workflow state khóa hành động.
   - Cùng một user và cùng một permission nhưng trạng thái khác nhau có thể cho kết quả khác nhau.
   - Ví dụ: người lập nhật ký có thể sửa khi `draft/rejected`, nhưng không sửa khi `submitted/verified`.

7. Notification không dùng permission pool làm nguồn chính.
   - Permission pool chỉ dùng để chọn candidate lúc giao việc.
   - Sau khi workflow đã có assignment, notification đi theo assignment và relationship với subject.

8. Mọi thay đổi quyền và phân công phải có audit.
   - Ai cấp, cấp cho ai, quyền gì, phạm vi nào, hiệu lực từ lúc nào, lý do gì.
   - Ai giao việc, giao cho ai, bước workflow nào, SLA nào, kết quả ra sao.

### 2.1 Deep Link & Capability Link Policy

Link là địa chỉ đến một đối tượng, không phải chìa khóa mở đối tượng đó.

Ba loại link bắt buộc phải phân biệt:

| Loại | Mục đích | Quyền khi người dùng mở link |
| --- | --- | --- |
| `internal_deep_link` | Link nội bộ đến màn hình/hồ sơ ERP. | Bắt buộc đăng nhập, active profile, subject-level view và scope hợp lệ. Copy/forward link không tạo quyền. |
| `notification_action_link` | Link trong notification/inbox đến subject hoặc assignment. | Re-check lại toàn bộ auth, permission, scope, assignment và workflow state tại thời điểm click. Forward notification không chuyển assignment. |
| `public_capability_link` | Ngoại lệ được thiết kế riêng, ví dụ QR safety card. | Token chỉ cấp đúng capability đã công bố; không suy ra quyền ERP và mặc định read-only. |

Quy tắc cho `internal_deep_link` và `notification_action_link`:

1. Không có session: chuyển sang login, rồi kiểm tra lại từ đầu sau login.
2. Có session nhưng không có quyền xem subject: trả 403/empty state, không render dữ liệu nhạy cảm.
3. Có quyền xem nhưng không có assignment/action: chỉ đọc; không hiện hoặc không thực thi nút workflow.
4. Direct URL, refresh trang, REST query và RPC phải cho cùng một kết quả deny/allow. Frontend guard chỉ cải thiện UX; RLS/RPC là lớp quyết định cuối.
5. Chức năng “chia sẻ có quyền”, nếu phát sinh, phải tạo grant hoặc assignment riêng có thời hạn, lý do và audit; không bao giờ chỉ là copy URL.

`public_capability_link` chỉ được tạo khi module khai báo rõ token model, dữ liệu allowlist, thời hạn, revoke, audit và policy delivery. Token phải có entropy đủ cao, được lưu/đối chiếu an toàn, không dùng làm khóa gọi workflow mutation và không trả toàn bộ row ERP. QR Safety Card là case cần audit theo chuẩn này; route có `qrToken` không tự động trở thành public capability link chỉ vì có token trong URL.

## 3. Mô hình khái niệm

### 3.1 Principal

Principal là thực thể có thể được cấp quyền, được giao việc hoặc nhận thông báo.

Các loại principal mục tiêu:

- `user`: app user gắn với Supabase Auth.
- `employee`: nhân sự trong HRM, có thể map sang user.
- `department`: phòng ban hoặc đơn vị tổ chức.
- `work_group`: nhóm làm việc.
- `role_template`: mẫu vai trò nghiệp vụ, dùng để cấp quyền hàng loạt.
- `system`: tác nhân hệ thống chạy job, SLA hoặc escalation.

Trong giai đoạn đầu, VIOO có thể tiếp tục dùng `public.users` làm principal runtime chính, nhưng tài liệu này coi đó là một implementation detail. Kiến trúc đích phải cho phép mở rộng sang department, work group và system actor mà không phá mô hình quyền.

### 3.2 Permission

Permission mô tả khả năng được làm một action trên một resource/module.

Định dạng chuẩn:

```text
<application>.<module>.<action>
```

Ví dụ:

```text
project.daily_log.view
project.daily_log.create
project.daily_log.edit_own
project.daily_log.verify
project.daily_log.approve
wms.transaction.complete
hrm.attendance.edit
workflow.instance.act_assigned
```

Không dùng lại các code chung như `verify`, `approve`, `confirm`, `submit` mà không có namespace. Các code chung chỉ được tồn tại trong adapter legacy và phải có kế hoạch loại bỏ.

### 3.3 Scope

Scope giới hạn nơi permission có hiệu lực.

Scope chuẩn:

| Scope | Ý nghĩa |
| --- | --- |
| `global` | Toàn hệ thống hoặc toàn module, chỉ dùng cho quyền thật sự toàn cục. |
| `own` | Hồ sơ/chứng từ của chính actor. |
| `assigned` | Hồ sơ/chứng từ đang được giao cho actor. |
| `project` | Một dự án cụ thể. |
| `construction_site` | Một công trường cụ thể. |
| `warehouse` | Một kho cụ thể. |
| `department` | Một phòng ban hoặc đơn vị tổ chức. |

Scope resolver của từng module phải xác định subject đang thuộc phạm vi nào. Ví dụ Daily Log phải resolve được `project_id`, `construction_site_id`, owner và current assignment.

### 3.4 Assignment

Assignment là trách nhiệm runtime trên một subject cụ thể.

Assignment trả lời câu hỏi:

- Ai đang phải xử lý hồ sơ này?
- Ở bước workflow nào?
- Với vai trò trách nhiệm gì?
- Từ lúc nào đến lúc nào?
- Có SLA hoặc escalation không?
- Assignment còn active không?

Mô hình bảng khái niệm:

```sql
app_assignments (
  id uuid primary key,
  subject_type text not null,
  subject_id text not null,
  workflow_instance_id uuid,
  workflow_step_id text,
  principal_type text not null,
  principal_id text not null,
  responsibility text not null,
  permission_code text,
  scope_type text not null,
  scope_id text not null,
  status text not null,
  starts_at timestamptz not null,
  expires_at timestamptz,
  assigned_by uuid,
  assigned_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

`responsibility` là ngữ nghĩa nghiệp vụ, ví dụ `creator`, `current_verifier`, `current_approver`, `watcher`, `sla_owner`, `escalation_owner`.

`permission_code` là quyền cần có để nhận hoặc thực hiện assignment, nhưng assignment không được suy ra ngược thành quyền toàn cục.

### 3.5 Workflow

Workflow điều phối trạng thái và assignment.

Workflow phải quản lý:

- Subject đang ở trạng thái nào.
- Step hiện tại là gì.
- Ai có thể là candidate của step tiếp theo.
- Ai là assignee thực tế sau khi chọn.
- Action nào hợp lệ ở trạng thái hiện tại.
- Transition nào tạo, đóng hoặc chuyển assignment.
- Transition nào phát notification.

Tất cả transition quan trọng phải đi qua RPC hoặc function backend. Direct update status từ frontend không được phép.

### 3.6 Notification

Notification là kết quả của event nghiệp vụ đã được resolve responsibility.

Luồng chuẩn:

```text
Domain event
-> subject + workflow state
-> active assignment / relationship resolver
-> recipient principals
-> user notification preferences
-> dedupe + cooldown
-> notification rows + delivery rows
```

Nguồn recipient hợp lệ:

- Current assignment.
- Creator/owner của subject.
- Watcher theo subject hoặc workflow.
- Escalation owner do SLA.
- Người liên quan trực tiếp theo quan hệ nghiệp vụ.

Nguồn recipient không còn được coi là chuẩn:

- Tất cả user có permission chung.
- Tất cả admin module.
- Tất cả người có role giống nhau.

Các nguồn này chỉ được dùng làm fallback có kiểm soát khi subject chưa thể resolve responsibility, và fallback phải được ghi vào metadata để audit.

## 4. Quyết định quyền chuẩn

Mọi action nhạy cảm phải đi qua cùng một chuỗi kiểm tra:

```text
1. Actor có session Supabase hợp lệ không?
2. Actor có active app profile không?
3. Actor là principal nào?
4. Action yêu cầu permission code nào?
5. Subject thuộc scope nào?
6. Actor có grant active, đúng permission, đúng scope, chưa hết hạn không?
7. Nếu action yêu cầu assigned: actor có assignment active trên subject không?
8. Workflow state hiện tại có cho phép action không?
9. RPC thực thi mutation, ghi audit, cập nhật assignment, phát domain event.
```

Nếu một bước không khớp, quyết định là deny.

Admin không được dùng để phá invariant workflow. Admin có thể có quyền override qua RPC riêng, nhưng override phải ghi lý do và audit event.

## 5. Daily Log pilot

Daily Log là pilot phù hợp vì đã có namespace permission, scope project/site, owner, người xác nhận và RPC transition.

### 5.1 Subject

Subject pilot:

```text
subject_type = 'daily_log'
subject_id = daily_logs.id
```

Scope resolver:

- `project`: `daily_logs.project_id`
- `construction_site`: `daily_logs.construction_site_id`
- `own`: `created_by_id`, `submitted_by_id`, `created_by`, `submitted_by`
- `assigned`: active assignment trên `daily_log`

### 5.2 Permission set

Permission bắt buộc:

```text
project.daily_log.view
project.daily_log.create
project.daily_log.edit_own
project.daily_log.edit_all
project.daily_log.delete_own
project.daily_log.delete_all
project.daily_log.submit
project.daily_log.return
project.daily_log.verify
project.daily_log.approve
project.daily_log.summarize
project.daily_log.manage
```

Các permission này chỉ có hiệu lực khi scope khớp và grant còn hạn.

### 5.3 Assignment types

Daily Log pilot dùng các responsibility sau:

| Responsibility | Khi tạo | Người nhận | Khi đóng |
| --- | --- | --- | --- |
| `creator` | Khi tạo log | Người lập nhật ký | Khi log bị xóa hoặc archive. |
| `current_verifier` | Khi submit log | Người được chọn xác nhận | Khi verify, return, reject hoặc chuyển approver. |
| `current_approver` | Khi log cần duyệt cấp sau | Người được giao duyệt | Khi approve/return/reject. |
| `revision_owner` | Khi log bị trả lại | Người lập nhật ký | Khi submit lại hoặc hủy. |
| `watcher` | Khi được add theo dõi | Người liên quan | Khi remove watcher hoặc hết hiệu lực. |
| `sla_owner` | Khi quá hạn | Người chịu trách nhiệm SLA/escalation | Khi xử lý xong hoặc escalation chuyển cấp. |

### 5.4 Workflow transition

Luồng pilot:

```text
draft
-> submitted
-> verified
-> approved
```

Nhánh trả lại:

```text
submitted -> rejected/returned -> draft/revision -> submitted
verified -> returned -> revision -> submitted
```

Quy tắc:

- `draft`: creator có `edit_own` hoặc user có `edit_all` được sửa.
- `submit`: creator phải có `project.daily_log.submit`; submit tạo assignment `current_verifier`.
- `verify`: chỉ assignee active có `project.daily_log.verify` hoặc override RPC được audit.
- `return`: chỉ assignee active có `project.daily_log.return` hoặc `project.daily_log.verify` theo cấu hình pilot.
- `approve`: chỉ assignee active có `project.daily_log.approve`.
- Direct update workflow fields bị chặn.

### 5.5 Notification pilot

Notification của Daily Log phải đi theo assignment:

| Event | Recipient |
| --- | --- |
| Log submitted | `current_verifier` assignment. |
| Log verified and needs approval | `current_approver` assignment. |
| Log returned/rejected | `creator` hoặc `revision_owner`. |
| Log approved | `creator`, watcher liên quan nếu có. |
| SLA overdue | `current_verifier/current_approver`, sau đó `sla_owner` nếu escalation. |
| Comment/tag | Người được tag, watcher subject, current assignee nếu comment ảnh hưởng action. |

Không gửi cho toàn bộ user có `project.daily_log.verify`. Permission chỉ dùng để kiểm tra candidate trong responsibility slot; workflow resolver mới chọn assignee thực tế.

### 5.6 Pilot acceptance criteria

Pilot đạt khi:

- User có permission nhưng không được assigned thì không thấy task trong inbox xử lý.
- User được assigned nhưng thiếu permission hoặc hết hạn grant thì RPC deny.
- User được assigned đúng subject/scope/step thì xử lý được.
- Notification `submitted` chỉ gửi đến verifier được giao.
- Notification `returned` chỉ gửi về creator/revision owner.
- Alert quá hạn không broadcast cho admin nếu vẫn resolve được assignment.
- Direct API update status hoặc handler fields bị chặn.
- Audit cho biết ai tạo assignment, ai đóng assignment, notification vì assignment nào.

### 5.7 Gate cấu hình trước khi bật pilot

Pilot phải được cấu hình responsibility slot trước khi người dùng gửi Nhật ký. Đây là cấu hình trách nhiệm vận hành, không phải màn hình để người gửi tự chọn người duyệt.

- Mỗi phạm vi pilot phải resolve được đúng một `current_verifier`; Nhật ký tổng hợp cần thêm một `current_approver`.
- Resolver ưu tiên `construction_site` → `project` → `global`, sau đó `priority` tăng dần. Nếu không có slot hợp lệ hoặc người trong slot mất grant/hết hiệu lực, thao tác gửi phải fail-closed.
- Quản trị viên dự án cấu hình qua `public.upsert_daily_log_responsibility_slot(jsonb)`. RPC kiểm tra đồng thời quyền quản lý phạm vi hiện tại, phạm vi mới và grant còn hiệu lực của assignee.
- Mỗi lần tạo/sửa/deactivate slot phải tạo `app_responsibility_slot_events` với actor, dữ liệu trước/sau và thời điểm thay đổi.
- Trước rollout cần kiểm tra một lần với từng dự án/công trường pilot: submit tạo `current_verifier`; verify/return chỉ assignee xử lý; summary tạo `current_approver`.

## 6. Chuẩn áp dụng cho mọi module

Mỗi module muốn onboard vào kiến trúc này phải hoàn thành checklist sau:

1. Khai báo subject type.
   - Ví dụ: `daily_log`, `material_request`, `payment_certificate`, `quality_checklist`, `asset_assignment`.

2. Khai báo permission namespace.
   - Mọi action phải có dạng `<application>.<module>.<action>`.
   - Không dùng action chung không namespace.

3. Viết scope resolver.
   - Resolve project/site/warehouse/department/own/assigned từ subject.

4. Định nghĩa assignment responsibilities.
   - Tối thiểu có current handler cho workflow module.
   - Có owner/creator/watcher nếu module cần notification liên quan.

5. Định nghĩa workflow state machine.
   - State nào cho phép action nào.
   - Transition nào tạo/đóng/chuyển assignment.

6. Chuyển mutation quan trọng sang RPC.
   - RPC kiểm auth, permission, scope, assignment, workflow state.
   - Direct table update chỉ được dùng cho draft field an toàn nếu thật sự cần.

7. Thiết kế notification từ responsibility.
   - Notification phải nêu rõ event, subject, recipient resolver, dedupe key.

8. Thêm RLS và ACL theo deny-by-default.
   - `anon` không được đọc/ghi bảng nhạy cảm.
   - `authenticated` chỉ được theo policy rõ.

9. Thêm test bắt buộc.
   - Permission đúng scope.
   - Permission sai scope bị deny.
   - Assignment đúng được xử lý.
   - Assignment thiếu bị deny.
   - Notification gửi đúng người.
   - Direct API bypass bị chặn.

10. Thêm audit và monitoring.
    - Grant/assignment/workflow transition/notification routing đều có dấu vết.

## 7. Thứ tự rollout khuyến nghị

1. Daily Log pilot.
   - Dùng `project.daily_log.*`.
   - Tạo assignment runtime cho verifier/approver/revision owner.
   - Chuyển notification Daily Log sang assignment-first.

2. Material Request.
   - Vì đã có workflow và liên quan WMS/tồn kho.
   - Tách candidate permission khỏi current assignment.

3. Payment/Quantity Acceptance.
   - Vì dữ liệu tài chính cần integrity cao.
   - Không để `verify/confirm/approve` chung gây lẫn trách nhiệm.

4. Quality.
   - Vì audit từng chỉ ra policy rộng và dữ liệu nghiệm thu nhạy cảm.

5. WMS, HRM, Asset, Request, Contract.
   - Mỗi module áp checklist chung và không được tạo ngoại lệ permission riêng.

## 8. Điều không làm trong giai đoạn này

- Không xóa legacy permission fields ngay.
- Không chuyển toàn ERP trong một migration lớn.
- Không mở `anon` để chữa lỗi rollout.
- Không để frontend tự quyết định quyền xử lý workflow.
- Không dùng notification broadcast để thay thế assignment.

## 9. Quan hệ với roadmap hiện tại

Tài liệu này là kiến trúc đích cao hơn roadmap refactor phân quyền. Roadmap hiện tại mô tả các phase triển khai; tài liệu này định nghĩa luật nền mà mọi phase phải tuân theo.

Khi có mâu thuẫn, ưu tiên theo thứ tự:

1. Backend security và RLS/RPC deny-by-default.
2. Mô hình Principal - Permission - Scope - Assignment - Workflow - Notification trong tài liệu này.
3. Roadmap phase hiện tại.
4. Legacy UI/module permission chỉ để tương thích tạm thời.

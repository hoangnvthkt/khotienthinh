# Thiết kế Giai đoạn 1 — Module Yêu cầu dùng chung Workflow Engine

Ngày chốt: 2026-07-28

Trạng thái: Đã được Product Owner duyệt qua từng phần

Phạm vi triển khai: Chỉ Giai đoạn 1 — lõi phê duyệt dùng được thực tế

## 1. Tóm tắt quyết định

Module Yêu cầu tiếp tục là một sản phẩm và trải nghiệm riêng trong Vioo, nhưng không duy trì một approval runtime độc lập. Mọi đề xuất mới chạy trên Workflow Engine dùng chung với execution policy riêng `AUTO_ADVANCE_APPROVAL`.

Khác biệt với Module Quy trình:

- Module Quy trình cho phép người xử lý chủ động thực hiện hành động và chọn bước/người tiếp theo theo cấu hình workflow.
- Module Yêu cầu khóa sẵn toàn bộ khối duyệt trong phiên bản mẫu. Người duyệt chỉ chấp thuận, từ chối hoặc trả lại; backend tự chuyển bước.

Giai đoạn 1 triển khai:

- Bố cục danh sách, chi tiết và cấu hình mẫu theo hướng “Base × Vioo thích ứng”.
- Mẫu có phiên bản, form động, phạm vi sử dụng và khối duyệt.
- Người duyệt cố định, nhiều người cố định, quản lý trực tiếp và người duyệt linh động.
- Duyệt lần lượt hoặc đồng thời, với chính sách `ALL` hoặc `ANY_ONE`.
- Chấp thuận, từ chối tức thì, trả lại và gửi lại đúng khối.
- SLA từng khối, người theo dõi cố định, timeline, audit và thông báo trong ứng dụng.
- ID bất biến, mã đề xuất tuần tự toàn hệ thống và deep link riêng.
- In nhanh/xuất PDF và xuất Word theo mẫu riêng.

Giai đoạn 1 không triển khai điều kiện/rẽ nhánh, webhook, chữ ký điện tử, bộ đếm tùy chỉnh, tự động hóa ngoài hệ thống hoặc cộng tác nâng cao. Các nội dung này chỉ được thực hiện khi Product Owner duyệt Giai đoạn 2 hoặc 3.

## 2. Bối cảnh hiện tại

Vioo đang có:

- Module Yêu cầu với danh mục, form động, SLA tổng, người duyệt tuần tự, trạng thái phiếu, mẫu Word, realtime, log và dashboard.
- Workflow Engine với template, node/edge, template version, runtime snapshot, assignment ledger, participant ledger, watcher, SLA, timeline và quyền chuyển trạng thái.

Database hiện chỉ chứa dữ liệu test/mockup và đã được Product Owner làm sạch. Thiết kế này không cần:

- Migration dữ liệu nghiệp vụ cũ.
- Dual-read giữa runtime cũ và mới.
- Giữ phiếu đang chạy trên runtime cũ.
- Lớp tương thích legacy cho dữ liệu test.

Migration triển khai vẫn phải bảo toàn schema ngoài Module Yêu cầu và không được xóa dữ liệu thuộc module khác.

## 3. Mục tiêu và tiêu chí thành công

### 3.1. Mục tiêu

1. Admin tạo, chỉnh sửa, xem thử và xuất bản được Mẫu yêu cầu.
2. Nhân viên chỉ nhìn thấy các mẫu nằm trong phạm vi được cấp.
3. Người tạo gửi đề xuất với danh sách người duyệt được xác định đầy đủ tại thời điểm gửi.
4. Người duyệt thực hiện hành động từ danh sách, chi tiết hoặc deep link trong thông báo.
5. Workflow tự chuyển bước mà không yêu cầu người duyệt chọn bước/người tiếp theo.
6. Mọi hành động có quyền, audit, idempotency và xử lý concurrency tại database.
7. Phiếu có thể in/xuất PDF hoặc xuất Word theo mẫu.

### 3.2. Tiêu chí thành công

- Không có transition hợp lệ nào phụ thuộc vào việc frontend tự cập nhật trạng thái.
- Hai hành động đồng thời không làm chuyển bước hai lần.
- Template bị chỉnh sửa không làm thay đổi phiếu đã gửi.
- Deep link mở đúng phiếu và vẫn thực thi kiểm tra quyền server-side.
- Mã đề xuất không trùng khi tạo đồng thời.
- Các luồng tuần tự, đồng thời, `ALL`, `ANY_ONE`, từ chối và trả lại đều có automated test.

## 4. Ngoài phạm vi Giai đoạn 1

- Người duyệt hoặc watcher theo điều kiện.
- Bật/tắt khối hoặc rẽ nhánh theo dữ liệu form.
- Webhook, webhook trace và chuyển tiếp sang hệ thống ngoài.
- Chữ ký điện tử.
- Công thức mã/bộ đếm tùy chỉnh theo từng mẫu.
- Trình thiết kế mẫu in kéo-thả.
- Delegation/ủy quyền nâng cao và escalation đa tầng.
- Công việc, liên kết và luồng thảo luận độc lập kiểu collaboration suite.
- Dashboard phân tích chuyên sâu và thao tác hàng loạt nâng cao.

Schema có thể dự phòng enum/type cho các nguồn người duyệt tương lai, nhưng UI và API Giai đoạn 1 không được cho cấu hình tính năng chưa hỗ trợ.

## 5. Kiến trúc tổng thể

```text
Module Yêu cầu
├── Request Template Manager
│   ├── thông tin chung
│   ├── form schema
│   ├── phạm vi sử dụng
│   ├── khối người duyệt
│   ├── watcher cố định
│   └── cấu hình in/thông báo
├── Request Runtime UI
│   ├── danh sách
│   ├── chi tiết
│   ├── hành động duyệt
│   └── in / sao chép liên kết
└── Request–Workflow Adapter
    ├── biên dịch phiên bản mẫu sang workflow version
    ├── resolve người duyệt
    ├── khởi tạo workflow subject/instance
    └── áp dụng AUTO_ADVANCE_APPROVAL
                    │
                    ▼
Workflow Engine dùng chung
├── workflow_templates / workflow_template_versions
├── workflow_instance_nodes / workflow_instance_edges
├── workflow_instances / workflow_subjects
├── workflow_step_assignments
├── workflow_participants
└── timeline / audit / SLA
```

### 5.1. Ranh giới trách nhiệm

`Request Template Manager` chịu trách nhiệm:

- Form, phạm vi sử dụng và cách hiển thị.
- Cấu hình khối duyệt ở ngôn ngữ nghiệp vụ Yêu cầu.
- Cấu hình mẫu Word, in chuẩn và notification preference.

`Request–Workflow Adapter` chịu trách nhiệm:

- Kiểm tra cấu hình trước khi xuất bản.
- Tạo workflow template version tương ứng.
- Snapshot resolver result và cấu hình vào phiếu.
- Chuyển request action thành workflow transition.

`Workflow Engine` chịu trách nhiệm:

- Quyền xử lý, assignment, SLA, participant và timeline.
- State transition nguyên tử.
- Khóa concurrency và idempotency.
- Tự kích hoạt assignment kế tiếp.

Module Quy trình hiện hữu không thay đổi hành vi. Chỉ workflow instance có execution policy `AUTO_ADVANCE_APPROVAL` sử dụng quy tắc của Module Yêu cầu.

## 6. Mô hình dữ liệu

Các tên bảng dưới đây là tên chuẩn cho kế hoạch triển khai Giai đoạn 1.

### 6.1. `request_templates`

Đại diện danh tính lâu dài của một mẫu.

- `id uuid primary key`
- `name text not null`
- `description text`
- `lifecycle_status text` — `DRAFT`, `PUBLISHED`, `DEACTIVATED`
- `current_version_id uuid null`
- `created_by uuid not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Không sửa trực tiếp dữ liệu đã xuất bản. Mọi chỉnh sửa tạo draft version mới.

### 6.2. `request_template_versions`

Phiên bản bất biến sau khi xuất bản.

- `id uuid primary key`
- `request_template_id uuid not null`
- `version_number integer not null`
- `workflow_template_version_id uuid null`
- `form_schema jsonb not null`
- `usage_scope jsonb not null`
- `flow_mode text` — `SEQUENTIAL`, `PARALLEL`
- `completion_policy text` — `ALL`, `ANY_ONE`
- `request_sla_hours numeric null`
- `print_config jsonb not null`
- `notification_config jsonb not null`
- `status text` — `DRAFT`, `PUBLISHED`, `SUPERSEDED`
- `published_by uuid null`
- `published_at timestamptz null`
- unique `(request_template_id, version_number)`

`usage_scope` hỗ trợ hợp của:

- Toàn công ty.
- Một hoặc nhiều phòng ban/đơn vị.
- Một hoặc nhiều nhóm quyền.
- Một hoặc nhiều người dùng cụ thể.

Phạm vi này chỉ quyết định ai được thấy và khởi tạo mẫu; không tự cấp quyền xem mọi instance của mẫu.

### 6.3. `request_approval_blocks`

Danh sách khối duyệt thuộc một template version.

- `id uuid primary key`
- `request_template_version_id uuid not null`
- `block_key text not null`
- `name text not null`
- `sort_order integer not null`
- `approver_source text`
  - `FIXED_SINGLE`
  - `FIXED_MULTI`
  - `DIRECT_MANAGER`
  - `DYNAMIC_CREATOR_SELECT`
- `fixed_user_ids uuid[] not null default '{}'`
- `minimum_dynamic_approvers integer null`
- `sla_hours numeric null`
- `is_required boolean not null default true`
- unique `(request_template_version_id, block_key)`

Giai đoạn 1 không có `CONDITIONAL` hoặc branch config trong API công khai.

### 6.4. `request_template_watchers`

- `request_template_version_id uuid`
- `user_id uuid`
- unique `(request_template_version_id, user_id)`

Giai đoạn 1 chỉ hỗ trợ watcher cố định.

### 6.5. `request_instances`

Dữ liệu nghiệp vụ của một đề xuất.

- `id uuid primary key`
- `code text unique not null`
- `request_template_id uuid not null`
- `request_template_version_id uuid not null`
- `workflow_template_version_id uuid not null`
- `workflow_instance_id uuid not null unique`
- `workflow_subject_id uuid not null unique`
- `title text not null`
- `description text`
- `form_data jsonb not null`
- `form_schema_snapshot jsonb not null`
- `approval_config_snapshot jsonb not null`
- `print_config_snapshot jsonb not null`
- `created_by uuid not null`
- `status text not null`
- `submitted_at timestamptz null`
- `completed_at timestamptz null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Snapshot phải chứa:

- Danh sách khối đã áp dụng.
- Người duyệt đã resolve.
- Người duyệt linh động được người tạo chọn.
- Flow mode và completion policy.
- SLA.
- Watcher.
- Form schema và print config.

### 6.6. `request_sequence_counters`

- `year integer primary key`
- `last_value bigint not null`
- `updated_at timestamptz not null`

Mã hiển thị có định dạng:

```text
RQ-YYYY-NNNNNN
Ví dụ: RQ-2026-000001
```

Database tăng counter trong transaction. Mã đã cấp không được tái sử dụng khi phiếu bị hủy hoặc xóa.

### 6.7. ID và deep link

- UUID là ID bất biến dùng cho quan hệ dữ liệu và route.
- `code` là mã nghiệp vụ dùng để tìm kiếm/hiển thị.
- Route chuẩn: `/rq/:requestId`.
- Nút “Sao chép liên kết” sao chép URL route chuẩn.
- Notification payload lưu `requestId` và deep link.
- Người không có quyền không được suy luận nội dung phiếu từ deep link; backend trả kết quả không tiết lộ dữ liệu.

## 7. Lifecycle của Mẫu yêu cầu

```text
Tạo mẫu
→ Lưu nháp
→ Kiểm tra cấu hình
→ Xem thử
→ Xuất bản
→ Tạo Request Template Version bất biến
→ Biên dịch sang Workflow Template Version
→ Áp dụng cho phiếu tạo mới
```

Quy tắc:

- Mẫu chưa xuất bản không xuất hiện trong danh sách tạo đề xuất.
- Mẫu bị ngừng sử dụng không cho tạo phiếu mới nhưng phiếu cũ vẫn mở được.
- Sửa mẫu đã xuất bản tạo draft version kế tiếp.
- `Xuất bản thay đổi` là hành động quan trọng, cần kiểm tra quyền và confirmation.
- Không cho xuất bản nếu:
  - Không có tên hoặc form schema không hợp lệ.
  - Không có khối duyệt bắt buộc.
  - Người duyệt cố định không còn hoạt động.
  - SLA âm.
  - Flow mode hoặc completion policy không hợp lệ.
  - Mẫu Word được cấu hình nhưng không thể đọc/validate.

## 8. Resolve người duyệt

Resolver chạy tại thời điểm gửi, không chạy lại khi phiếu đang phê duyệt.

### 8.1. Người cố định

- Lấy user ID từ template version.
- Tất cả tài khoản phải thuộc công ty và đang hoạt động.
- Nếu một user không hợp lệ, chặn gửi và yêu cầu Admin sửa mẫu.

### 8.2. Quản lý trực tiếp

- Resolve từ quan hệ tổ chức/hồ sơ nhân sự hiện hành của người tạo.
- Nếu không có quản lý trực tiếp hợp lệ, chặn gửi.
- Thông báo lỗi phải chỉ rõ cần bổ sung quan hệ quản lý cho người tạo.

### 8.3. Người duyệt linh động

- Người tạo chọn bằng tìm kiếm hoặc `@mention` khi gửi.
- Có thể chọn bất kỳ nhân viên đang hoạt động trong cùng công ty.
- Phải đạt `minimum_dynamic_approvers`.
- Danh sách được snapshot vào request.
- Template version không chứa user cụ thể cho khối linh động.

### 8.4. Tài khoản bị khóa sau khi phiếu đã gửi

- Assignment đã tạo không tự chuyển cho người khác.
- User bị khóa không thể hành động.
- Template manager/Admin nhận cảnh báo và sử dụng hành động tái gán.
- Tái gán phải ghi actor, user cũ, user mới, lý do và thời điểm vào audit.

## 9. State machine và quy tắc runtime

### 9.1. Trạng thái request

- `DRAFT`
- `PENDING`
- `RETURNED`
- `APPROVED`
- `REJECTED`
- `CANCELLED`

### 9.2. Trạng thái assignment

- `PENDING`
- `APPROVED`
- `REJECTED`
- `RETURNED`
- `SKIPPED`
- `CANCELLED`

Assignment cần `assignment_round_id` để phân biệt các vòng gửi lại.

### 9.3. Duyệt lần lượt

1. Chỉ khối đầu tiên được kích hoạt khi gửi.
2. Khi tập assignment đang hoạt động thỏa completion policy, engine đóng khối.
3. Khối tiếp theo tự được kích hoạt.
4. Khối cuối hoàn tất thì request chuyển `APPROVED`.

### 9.4. Duyệt đồng thời

1. Tất cả khối bắt buộc được kích hoạt khi gửi.
2. `ALL`: tất cả assignment đang hoạt động phải chấp thuận.
3. `ANY_ONE`: một assignment chấp thuận là đủ; assignment còn lại chuyển `SKIPPED`.
4. Khi policy được thỏa, request chuyển `APPROVED`.

Completion policy thuộc template version và áp dụng cho tập assignment đang hoạt động:

- Với `SEQUENTIAL`, tập đang hoạt động là assignment của khối hiện tại.
- Với `PARALLEL`, tập đang hoạt động là assignment của toàn bộ khối.

### 9.5. Từ chối

- Một assignment từ chối làm request chuyển `REJECTED` ngay.
- Tất cả assignment `PENDING` khác chuyển `CANCELLED`.
- Không kích hoạt khối tiếp theo.
- Ý kiến từ chối là bắt buộc.

### 9.6. Trả lại và gửi lại

- Một assignment trả lại làm request chuyển `RETURNED`.
- Ý kiến trả lại là bắt buộc.
- Người tạo được phép sửa dữ liệu cho phép sửa.
- Assignment đã `APPROVED` được giữ nguyên.
- Assignment đang chờ bị đóng cho vòng hiện tại.
- Khi gửi lại:
  - `SEQUENTIAL`: tạo vòng assignment mới cho chính khối đã trả lại, chỉ cho các approver chưa có kết quả chấp thuận cần giữ.
  - `PARALLEL`: tạo vòng assignment mới cho người đã trả và mọi assignment chưa chấp thuận; kết quả đã chấp thuận được giữ.
- SLA của assignment được tạo lại tính từ thời điểm gửi lại.
- Lịch sử vòng cũ không bị ghi đè.

### 9.7. Hủy

- Chỉ người tạo hoặc Admin có quyền phù hợp được hủy theo policy.
- Request đã `APPROVED` hoặc `REJECTED` không hủy bằng action thông thường.
- Hủy đóng mọi assignment đang chờ và ghi lý do.

## 10. RPC/API bắt buộc

Các RPC dưới đây là contract chuẩn của Giai đoạn 1.

### 10.1. Template

- `publish_request_template_version`
  - Validate draft.
  - Tạo workflow template version.
  - Khóa request template version thành bất biến.
  - Cập nhật current version.

### 10.2. Request

- `create_request_draft`
- `submit_request`
- `approve_request`
- `reject_request`
- `return_request`
- `resubmit_request`
- `cancel_request`
- `reassign_request_assignment`

Mỗi action RPC nhận:

- `request_id`
- `actor_id` lấy từ authenticated context, không tin giá trị do client giả mạo.
- `comment` khi cần.
- `idempotency_key`
- version/expected state để phát hiện stale action.

RPC phải:

1. Khóa row request/workflow subject cần xử lý.
2. Kiểm tra trạng thái và assignment.
3. Kiểm tra quyền server-side.
4. Cập nhật assignment, request và workflow trong cùng transaction.
5. Ghi audit/timeline.
6. Ghi notification event vào outbox.
7. Trả snapshot trạng thái mới.

## 11. Quyền và RLS

### 11.1. Quyền với template

- Admin/Template Manager: tạo, sửa draft, xem thử, xuất bản, ngừng sử dụng.
- Người thuộc usage scope: xem mẫu đã xuất bản và tạo request.
- Usage scope không cấp quyền sửa template.

### 11.2. Quyền với instance

Được xem khi là một trong:

- Người tạo.
- Approver hiện tại hoặc đã từng tham gia.
- Watcher của request.
- Template manager/Admin có permission quản trị Yêu cầu.

Được hành động khi:

- Có assignment `PENDING` đang hoạt động trong đúng round.
- Request đang ở trạng thái cho phép hành động.
- User đang hoạt động.

Frontend chỉ dùng quyền trả về từ server để hiển thị action; RLS/RPC là nguồn quyết định cuối.

## 12. Thông báo và deep link

Giai đoạn 1 hỗ trợ notification trong ứng dụng cho:

- Có assignment mới.
- Request bị trả lại.
- Request bị từ chối.
- Request được chấp thuận hoàn toàn.
- SLA sắp đến hạn hoặc quá hạn.
- Assignment bị tái gán.

Notification chứa:

- `requestId`
- `requestCode`
- `eventType`
- `deepLink = /rq/:requestId`
- actor/recipient cần thiết

Nhấn notification mở đúng request. Nếu user không còn quyền, UI hiển thị trạng thái không có quyền/không tìm thấy mà không lộ nội dung.

Lỗi phát notification không rollback kết quả transition. Outbox worker thử lại và ghi lỗi có thể quan sát.

## 13. In đề xuất

### 13.1. In nhanh/xuất PDF

- Có nút `In đề xuất` tại màn chi tiết.
- Mở print preview trước khi gọi browser print hoặc xuất PDF.
- Bố cục chuẩn Vioo gồm:
  - Logo/thông tin công ty.
  - Mã đề xuất.
  - Tên mẫu và tiêu đề.
  - Người tạo, thời gian tạo.
  - Nội dung form.
  - Danh sách người duyệt, kết quả, ý kiến và thời điểm.
  - Trạng thái cuối.
- Dữ liệu lấy từ snapshot của request.

### 13.2. Xuất Word theo mẫu

- Admin upload `.docx` cho từng request template version.
- Hệ thống validate file và mapping placeholder trước khi xuất bản.
- Khi xuất, dùng snapshot form và approval của request.
- Nếu mẫu Word lỗi, UI báo lỗi có thể hành động và vẫn cho phép dùng bản in chuẩn/PDF.

### 13.3. Audit in/xuất

Ghi:

- Request ID/code.
- Người thực hiện.
- Loại `PRINT`, `PDF`, `WORD`.
- Template version.
- Thời điểm.
- Kết quả thành công/thất bại.

## 14. Trải nghiệm người dùng

### 14.1. Danh sách

Desktop khi chưa chọn request:

- Global Vioo rail.
- Context navigation của Module Yêu cầu.
- Bảng dùng toàn bộ chiều rộng còn lại.
- Tab: Tất cả, Quá hạn, Chờ duyệt, Đã chấp thuận, Đã từ chối, Đã trả lại.
- Tìm kiếm và filter server-side.
- Cột: tiêu đề/mẫu, trạng thái, người tạo, tiến trình duyệt, ngày tạo.
- Nút `Tạo đề xuất`, `Xuất Excel`.

Danh sách dùng cursor pagination; không giới hạn cứng 300 bản ghi ở client.

### 14.2. Chi tiết

Khi mở request:

- Danh sách thu thành master column bên trái.
- Nội dung request ở giữa.
- Inspector bên phải hiển thị tiến trình, watcher và timeline.
- URL đổi sang `/rq/:requestId`, hỗ trợ back/forward của browser.
- Filter/list scroll được giữ khi đóng chi tiết.
- Action bar chỉ xuất hiện khi server trả quyền hành động.
- Có `Sao chép liên kết`, `In đề xuất`, `Xuất Word`, `Theo dõi`.

Giai đoạn 1 hiển thị:

- Form snapshot.
- Tệp từ field file/form attachment cơ bản.
- Approval comment và timeline.

Khu vực công việc, liên kết và thảo luận độc lập được ẩn cho đến Giai đoạn 2.

### 14.3. Cấu hình mẫu

Menu dọc:

- Thiết lập chung.
- Mẫu form.
- Người duyệt & luồng.
- Người theo dõi.
- In đề xuất.
- Phân quyền.
- Thông báo.

Webhook và chữ ký điện tử không xuất hiện như chức năng hoạt động trong Giai đoạn 1; nếu cần truyền thông roadmap, chỉ hiển thị nhãn “Chưa khả dụng” không thể nhấn.

Approval builder:

- Chọn `SEQUENTIAL` hoặc `PARALLEL`.
- Chọn `ALL` hoặc `ANY_ONE`.
- Thêm/sửa/xóa/sắp xếp khối.
- Xem nguồn approver, người cụ thể và SLA.
- Xem thử resolver trước khi xuất bản với một user mẫu.

### 14.4. Responsive

- Desktop lớn: hiển thị đủ global rail, context navigation, master list, detail và inspector.
- Laptop: thu gọn context navigation; inspector mở theo panel.
- Mobile/tablet: list và detail là hai màn; action bar ghim cuối màn hình.

## 15. Xử lý lỗi

Các lỗi nghiệp vụ dùng code ổn định để UI dịch thông báo:

- `REQUEST_STALE_STATE`
- `REQUEST_ACTION_FORBIDDEN`
- `REQUEST_ASSIGNMENT_NOT_ACTIVE`
- `REQUEST_ALREADY_PROCESSED`
- `REQUEST_APPROVER_INACTIVE`
- `REQUEST_DIRECT_MANAGER_MISSING`
- `REQUEST_DYNAMIC_APPROVER_REQUIRED`
- `REQUEST_TEMPLATE_NOT_PUBLISHED`
- `REQUEST_TEMPLATE_OUT_OF_SCOPE`
- `REQUEST_PRINT_TEMPLATE_INVALID`
- `REQUEST_IDEMPOTENCY_CONFLICT`

Hành vi UI:

- Stale state: tải lại detail và giải thích request đã thay đổi.
- Forbidden: ẩn action sau refresh và không retry.
- Resolver error: giữ dữ liệu form, đưa focus đến khu vực cần sửa.
- Notification failure: không báo transition thất bại; ghi trạng thái delivery riêng.
- Word export failure: cho phép fallback PDF/print chuẩn.

## 16. Kiểm thử và nghiệm thu

### 16.1. Unit test

- Fixed/direct-manager/dynamic approver resolver.
- `ALL`/`ANY_ONE`.
- Sequential/parallel activation.
- Return/resubmit assignment-round calculation.
- Code formatter `RQ-YYYY-NNNNNN`.
- Print placeholder mapping.

### 16.2. Database integration test

- Publish template version.
- Submit request và snapshot.
- Approve sequential/parallel.
- Immediate rejection.
- Return/resubmit.
- Reassign inactive approver.
- RLS với creator/approver/watcher/admin/người ngoài.
- Concurrent approval.
- Concurrent request code allocation.
- Idempotency replay.

### 16.3. UI/component test

- Template builder validation.
- Dynamic approver mention selector.
- List filter và cursor pagination.
- Master–detail URL synchronization.
- Action visibility từ server capability.
- Copy link.
- Print preview/PDF và Word export error fallback.
- Responsive states.

### 16.4. End-to-end

1. Admin tạo và xuất bản mẫu tuần tự `ALL`.
2. Nhân viên trong scope tạo request.
3. Người tạo chọn dynamic approver.
4. Bước 1 duyệt, engine tự kích hoạt bước 2.
5. Bước 2 duyệt, request hoàn thành.
6. Notification mở đúng deep link.
7. In PDF và xuất Word thành công.

Thêm các E2E riêng cho:

- Parallel `ANY_ONE`.
- Immediate reject.
- Return, edit và resubmit đúng khối.
- Người ngoài scope không tạo được request.
- Người không phải participant không mở được deep link.

### 16.5. Visual regression

Chụp và so sánh ba màn đã duyệt:

- Danh sách toàn chiều rộng.
- Chi tiết master–detail.
- Cấu hình mẫu/approval builder.

## 17. Rollout Giai đoạn 1

Vì database nghiệp vụ Yêu cầu đã sạch:

1. Áp migration schema/RPC/RLS.
2. Seed một mẫu kiểm thử nội bộ.
3. Chạy database integration và E2E trên staging.
4. Bật feature flag cho nhóm Admin/QA.
5. Nghiệm thu template builder, runtime, deep link và in.
6. Bật cho toàn công ty.

Không drop bảng cũ trong cùng migration phát hành. Việc dọn schema legacy, nếu cần, là một thay đổi riêng sau khi xác nhận không còn consumer.

## 18. Các quyết định đã khóa

- Module Yêu cầu dùng chung Workflow Engine.
- Execution policy của Yêu cầu là tự động chuyển bước.
- Triển khai theo giai đoạn; hiện chỉ thực thi Giai đoạn 1.
- Flow hỗ trợ tuần tự và đồng thời.
- Completion policy do Admin chọn `ALL` hoặc `ANY_ONE` cho mẫu.
- Một người từ chối làm toàn request bị từ chối ngay.
- Trả lại và gửi lại đúng khối; giữ kết quả chấp thuận trước đó.
- Người duyệt linh động do người tạo chọn bằng `@mention`.
- Usage scope hỗ trợ công ty, đơn vị, nhóm quyền và user cụ thể.
- Bố cục giao diện là “Base × Vioo thích ứng”.
- Database hiện không có dữ liệu nghiệp vụ cần migrate.
- Hỗ trợ cả in/PDF chuẩn Vioo và Word template.
- Mã đề xuất tăng tuần tự toàn hệ thống theo năm.

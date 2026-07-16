# Thiết kế phân quyền, quản trị truy cập và chuyển đổi legacy cho VIOO

Ngày: 2026-07-16
Trạng thái: Approved
Phạm vi: Toàn bộ ERP nội bộ VIOO, triển khai tăng dần từ Daily Log
Đối tượng: Doanh nghiệp vừa và nhỏ, một tổ chức vận hành nội bộ

## 1. Quyết định kiến trúc

VIOO sử dụng mô hình thực dụng:

```text
Business Role
  + Direct Permission Exception
  + Scope
  + Subject Relationship / Assignment
  + Workflow State
  + Account Status
  + Minimal SoD
  -> Authorization Decision
```

Tên đầy đủ của kiến trúc lõi vẫn là:

```text
Principal - Permission - Scope - Assignment - Workflow - Notification
```

Đây là phương án cân bằng cho ERP nội bộ SME:

- Mạnh hơn RBAC thuần vì quyền còn phụ thuộc scope, assignment và workflow state.
- Dễ quản trị hơn ABAC hoặc policy engine tổng quát.
- Đủ kiểm soát các nghiệp vụ nhạy cảm bằng SoD tối thiểu.
- Cho phép chuyển đổi legacy theo từng user và từng module, không big-bang.
- Không biến VIOO thành hệ GRC hoặc IAM doanh nghiệp quá nặng.

## 2. Mục tiêu

1. Mọi quyết định quyền quan trọng được kiểm tra ở backend.
2. Quyền hiệu lực của một người luôn giải thích được theo nguồn, phạm vi và thời hạn.
3. Permission không bị nhầm với trách nhiệm xử lý một hồ sơ cụ thể.
4. Workflow mutation, assignment và notification dùng cùng một mô hình trách nhiệm.
5. System Admin không tự động có quyền duyệt nghiệp vụ.
6. Có thể tắt dần legacy permission mà không làm gián đoạn toàn ERP.
7. Có thể vô hiệu hóa tài khoản ngay lập tức mà không mất dữ liệu HRM hoặc lịch sử nghiệp vụ.
8. Người được khôi phục tài khoản không tự nhận lại quyền cũ.
9. Mỗi module có tiêu chí rõ ràng trước khi chuyển sang nguồn quyền mới hoàn toàn.
10. Audit đủ để trả lời ai đã cấp quyền, sử dụng quyền hoặc thay đổi trách nhiệm nào.

## 3. Ngoài phạm vi

Giai đoạn này không xây dựng:

- Multi-tenant authorization.
- Policy DSL cho quản trị viên tự viết biểu thức quyền.
- Nested group hoặc role hierarchy nhiều tầng.
- Negative grant tổng quát.
- Full GRC, access request catalog hoặc firefighter account dùng chung.
- Risk scoring tự động phức tạp.
- Audit mọi lần đọc dữ liệu thông thường.
- Một migration xóa toàn bộ legacy permission.

Các phần trên chỉ được xem xét khi VIOO thực sự có nhu cầu vận hành tương ứng.

## 4. Hiện trạng và khoảng trống

### 4.1 Phần đã có

- Permission registry theo application, module và action.
- `user_permission_grants` cho direct grant có scope và thời hạn.
- `role_permission_templates` và các item của template.
- `permission_audit_events`.
- Permission helper và legacy fallback bước đầu.
- Daily Log pilot có responsibility slot, runtime assignment và transition RPC.
- `can_view_subject(...)` và `can_act_on_subject(...)` ở pilot.
- `public.users.is_active` và frontend không tải profile inactive.

### 4.2 Phần còn thiếu hoặc chưa đủ an toàn

- Chưa có assignment từ Business Role đến user/principal.
- Legacy fallback mới ở mức cờ toàn cục, chưa theo user/module/scope.
- UI chưa giải thích rõ quyền đến từ Role, Direct hay Legacy.
- Save profile và save grant có thể tạo trạng thái cập nhật một phần.
- Replace grant hiện cần chuyển sang diff/revoke có lịch sử.
- Notification chưa assignment-first trên toàn bộ Daily Log và các module khác.
- Các module ngoài Daily Log chưa dùng authorization core thống nhất.
- `current_app_user_id()` chưa bảo đảm actor đang active cho mọi policy phụ thuộc helper này.
- UI quản trị vẫn có luồng xóa vĩnh viễn app user.
- Chưa có account lifecycle orchestrator đồng bộ app profile, permission và Supabase Auth.
- Chưa có hard SoD và quy trình override thống nhất.

## 5. Bất biến bảo mật

Các quy tắc sau là bắt buộc và không được frontend hoặc legacy adapter ghi đè:

1. Không có active session và active app profile thì không có actor hợp lệ.
2. Link, route, notification hoặc việc biết ID subject không tạo quyền.
3. Frontend chỉ hỗ trợ UX; RLS, RPC và trigger là lớp chặn thật.
4. Permission không tự tạo assignment.
5. Assignment không tự tạo permission.
6. Workflow action nhạy cảm cần đồng thời permission, scope, assignment và trạng thái hợp lệ.
7. System Admin không tự có business approval permission.
8. Account disabled không được đọc hoặc ghi dữ liệu bảo vệ qua Data API/RPC.
9. Grant hết hạn hoặc revoked không được tham gia bất kỳ phép tính quyền nào.
10. Direct update workflow state, handler hoặc trường tài chính nhạy cảm phải bị chặn.
11. Không được tự cấp quyền nhạy cảm hoặc tự vô hiệu hóa chính mình.
12. Không được vô hiệu hóa System Admin cuối cùng.
13. Legacy đã tắt cho user/module/scope không được projection tự bật lại.
14. Audit security event chỉ append qua đường ghi được kiểm soát.

## 6. Quyết định quyền chuẩn

Một action chỉ được phép khi tất cả điều kiện bắt buộc đều đúng:

```text
ALLOW =
  valid_session
  AND active_actor
  AND effective_permission
  AND matching_scope
  AND required_relationship_or_assignment
  AND allowed_workflow_state
  AND no_hard_sod_violation
```

Pseudo flow:

```text
resolve active actor
  -> resolve subject and its scopes
  -> calculate effective permission sources
  -> validate grant dates and scope
  -> validate owner/relationship/assignment when required
  -> validate workflow state and transition
  -> validate hard SoD
  -> allow or deny
  -> mutate, update assignment, append audit and emit domain event
```

Không dùng `Role.ADMIN`, URL, menu visibility hoặc notification recipient làm lối tắt cho phép action.

## 7. Mô hình quyền hiệu lực

### 7.1 Nguồn quyền

Quyền hiệu lực được hợp từ ba nguồn:

1. `Business Role`: nguồn chính cho quyền ổn định theo công việc.
2. `Direct Grant`: ngoại lệ rõ ràng cho một người, thường có lý do và thời hạn.
3. `Legacy`: nguồn chuyển tiếp, có thể tắt độc lập theo user/module/scope.

UI phải hiển thị nguồn quyền bằng badge hoặc thông tin tương đương:

- `Business Role`
- `Direct`
- `Legacy`

Một checkbox không được ngụ ý rằng quyền sẽ mất nếu quyền đó vẫn đến từ nguồn khác.

### 7.2 Business Role

`role_permission_templates` tiếp tục làm định nghĩa role trong giai đoạn đầu. Bổ sung assignment từ role đến principal, khái niệm như sau:

```text
principal_role_assignments
  id
  principal_type
  principal_id
  role_template_id
  scope_type
  scope_id
  starts_at
  expires_at
  status
  assigned_by
  assigned_reason
  revoked_at
  revoked_by
  revoked_reason
  created_at
  updated_at
```

Phiên bản đầu chỉ cần hỗ trợ `principal_type = user`. Schema không được ngăn khả năng bổ sung department hoặc work group về sau.

Khi sửa permission set của một Business Role, hệ thống phải preview số principal và scope bị ảnh hưởng. Thay đổi chỉ có hiệu lực qua command quản trị có audit; không cho frontend sửa trực tiếp từng role item mà không ghi nhận tác động.

### 7.3 Direct Grant

Direct grant dùng cho ngoại lệ, không thay Business Role làm cách quản trị chính.

- Grant thông thường có thể không hết hạn nếu nghiệp vụ cần.
- Grant nhạy cảm hoặc tạm thời phải có `expires_at`.
- Revoke bằng trạng thái và metadata, không xóa row để cấp lại.
- Thay đổi grant phải đi qua RPC quản trị và append audit.

### 7.4 Scope

Scope chuẩn tối thiểu:

- `global`
- `own`
- `assigned`
- `project`
- `construction_site`
- `warehouse`
- `department`

Không dùng `global` để chữa nhanh lỗi thiếu resolver. Module phải resolve scope từ subject ở backend.

## 8. Vai trò quản trị

### 8.1 System Admin

- Quản lý tài khoản, cấu hình hệ thống và vận hành kỹ thuật.
- Vô hiệu hóa hoặc khôi phục tài khoản.
- Không tự động có quyền duyệt chứng từ nghiệp vụ.

### 8.2 Permission Admin

- Quản lý Business Role, grant, scope và legacy cutover.
- Không tự cấp quyền nhạy cảm cho chính mình.
- Không được bỏ qua SoD hoặc last-admin guard.

### 8.3 Business Scope Admin

- Quản lý nhân sự, responsibility slot hoặc phân công trong scope được ủy quyền.
- Không quản trị toàn hệ thống nếu không có grant riêng.

### 8.4 Business User

- Thực hiện nghiệp vụ theo role, scope, assignment và workflow state.

### 8.5 Auditor

- Đọc cấu hình quyền, lịch sử thay đổi và báo cáo kiểm soát.
- Mặc định không có quyền sửa hoặc duyệt nghiệp vụ.

Trong SME, một người có thể giữ nhiều vai trò. Các nguồn vẫn phải tách biệt và audit được.

## 9. Phân loại rủi ro và SoD tối thiểu

### 9.1 Mức rủi ro permission

| Mức | Ví dụ | Kiểm soát |
| --- | --- | --- |
| `normal` | view, create, edit own | Có thể cấp qua Business Role thông thường. |
| `important` | edit all, master data, export | Cần scope rõ và lý do khi cấp trực tiếp. |
| `sensitive` | approve money, post, stock adjustment, payroll, grant permission | Cấp rõ ràng, áp SoD, audit tăng cường và thường có expiry nếu là ngoại lệ. |

### 9.2 Hard deny

Backend luôn chặn:

- Creator hoặc submitter final-approve chính subject của mình khi workflow khai báo maker-checker.
- Permission Admin tự cấp sensitive permission cho chính mình.
- Vô hiệu hóa System Admin cuối cùng.
- Payment executor final-approve cùng payment.
- Direct API thay đổi workflow state, current handler hoặc trường nhạy cảm ngoài transition RPC.

Rule SoD giai đoạn đầu được khai báo bằng typed registry hoặc dữ liệu seed được kiểm soát trong code/migration. Không cung cấp policy expression tự do cho quản trị viên.

### 9.3 Warning và biện pháp bù trừ

Các tổ hợp sau tạo warning, nhưng SME có thể chấp nhận nếu có lý do, owner, thời hạn hoặc biện pháp kiểm tra bù trừ:

- Tạo nhà cung cấp và duyệt thanh toán.
- Tạo PO và duyệt PO.
- Nhận hàng và duyệt thanh toán.
- Chuẩn bị payroll và duyệt payroll.
- Quản lý kho và phê duyệt điều chỉnh tồn.

### 9.4 Override

Override không dùng tài khoản dùng chung hoặc bypass `ADMIN`.

- Permission riêng, ví dụ `workflow.instance.override`.
- RPC riêng.
- Bắt buộc lý do.
- Ghi audit và notification cho owner kiểm soát.
- Không làm thay đổi role hoặc grant lâu dài của actor.

## 10. Assignment, workflow và notification

### 10.1 Responsibility slot

Responsibility slot là cấu hình người chịu trách nhiệm mặc định theo scope. Nó không phải permission.

Candidate chỉ hợp lệ khi:

- Account active.
- Có permission cần thiết.
- Permission đúng scope và còn hạn.
- Không vi phạm rule của responsibility.

### 10.2 Runtime assignment

Runtime assignment nói ai đang xử lý subject cụ thể. Action yêu cầu `assigned` phải kiểm tra active assignment tại thời điểm gọi RPC.

### 10.3 Workflow transaction

Transition nhạy cảm phải thực hiện trong một transaction DB:

1. Resolve active actor và subject.
2. Lock subject cần thay đổi.
3. Re-check permission, scope, assignment, state và SoD.
4. Mutate subject.
5. Đóng/tạo assignment liên quan.
6. Append audit và domain event.

### 10.4 Notification

Notification và inbox lấy recipient từ:

- Current assignment.
- Creator hoặc revision owner.
- Watcher hoặc subject relationship đã khai báo.
- SLA/escalation owner.

Không broadcast cho toàn bộ người có cùng permission.

## 11. Chuyển đổi legacy có kiểm soát

### 11.1 Trạng thái module

Mỗi module đi tuần tự:

```text
LEGACY_ONLY -> DUAL_READ -> NEW_READY -> NEW_ONLY -> RETIRED
```

- `LEGACY_ONLY`: runtime chỉ tin legacy.
- `DUAL_READ`: permission mới ưu tiên, legacy fallback theo cấu hình.
- `NEW_READY`: mapping, UI, backend, test và vận hành đã đủ để cutover.
- `NEW_ONLY`: runtime bỏ qua legacy cho cohort đã chọn.
- `RETIRED`: không còn runtime dependency hoặc write legacy.

### 11.2 Legacy mode theo user/module/scope

Mô hình khái niệm:

```text
user_permission_source_modes
  user_id
  module_code
  scope_type
  scope_id
  legacy_enabled
  changed_by
  changed_at
  reason
```

Module lifecycle là cấu hình riêng ở cấp module, ví dụ `permission_module_migration_states`.

### 11.3 Preview trước cutover

Trước khi bỏ legacy, UI/RPC phải trả về:

- Quyền legacy đã được permission mới bao phủ.
- Quyền sẽ mất sau cutover.
- Quyền legacy chưa map được.
- Quyền mới đang có theo Role và Direct Grant.
- Scope nào bị ảnh hưởng.

Admin được quyền tiếp tục dù có quyền sẽ mất, sau bước xác nhận rõ ràng. Quyền thiếu sau cutover phải bị deny thật và được bổ sung bằng hệ mới nếu nghiệp vụ yêu cầu.

### 11.4 Lưu thay đổi

Save user profile, role assignment, direct grants và source mode phải đi qua một command/RPC có transaction DB.

- Tính diff giữa trước và sau.
- Revoke bản ghi bị bỏ, không delete/reinsert toàn bộ.
- Append audit cho từng thay đổi có ý nghĩa.
- Projection không được ghi lại legacy cho module/user/scope đã cutover.
- Lỗi ở bất kỳ bước DB nào phải rollback toàn command.

Legacy data được giữ trong thời gian chuyển đổi để điều tra và rollback mode, nhưng không còn hiệu lực khi `legacy_enabled = false`.

## 12. Vòng đời tài khoản

### 12.1 Tách employee và app account

`Employee` trong HRM và `App User` có vòng đời độc lập.

- Employee record, hợp đồng, chấm công, chứng từ và lịch sử nghiệp vụ không bị xóa khi tài khoản bị vô hiệu.
- App account kiểm soát đăng nhập và quyền sử dụng VIOO.
- Quan hệ employee-user được giữ để truy vết lịch sử.

### 12.2 Trạng thái và metadata

Mục tiêu có hai trạng thái vận hành chính:

- `ACTIVE`
- `DISABLED`

Metadata tối thiểu:

- `account_status`
- `disabled_at`
- `disabled_by`
- `disabled_reason`
- `reactivated_at`
- `reactivated_by`
- `reactivation_reason`

`is_active` được duy trì làm compatibility field trong quá trình chuyển đổi và phải nhất quán với `account_status`.

### 12.3 Active actor

Backend actor resolver phải chỉ trả về user khi app profile active. Mọi RLS/RPC dùng user hiện tại phải dựa vào semantic active-only hoặc kiểm tra active tương đương.

Mục tiêu bắt buộc:

- JWT còn hạn không giúp disabled user vượt qua RLS/RPC.
- Owner policy không cho inactive owner tiếp tục đọc/ghi.
- Permission helper và direct relationship policy cho cùng kết quả deny.

### 12.4 Vô hiệu hóa

System Admin gọi một trusted orchestrator idempotent. Vì Postgres và Supabase Auth không nằm trong cùng transaction, flow dùng app profile làm điểm khóa bảo mật đầu tiên:

1. Authorize System Admin, chặn self-disable và last-admin violation.
2. Tạo operation/audit record có idempotency key.
3. Trong một DB transaction:
   - đặt app account thành `DISABLED`;
   - revoke active role assignments và direct grants;
   - tắt legacy source;
   - đóng hoặc đánh dấu responsibility/assignment hiện hành cần phân công lại;
   - append security audit.
4. Qua trusted server/Edge Function, chặn đăng nhập mới và revoke refresh sessions bằng Supabase Auth Admin API.
5. Đánh dấu operation hoàn tất; retry Auth step nếu lỗi.

DB active-actor guard bảo đảm deny ngay cả khi Auth revocation chậm hoặc access JWT chưa hết hạn.

Việc vô hiệu hóa không bị trì hoãn vì còn assignment. Hệ thống tạo danh sách cần tái phân công và cảnh báo Scope Admin. Không tự giao toàn bộ việc cho System Admin.

### 12.5 Khôi phục

Khôi phục là một operation idempotent riêng:

1. Authorize System Admin và ghi lý do.
2. Xác nhận không còn active role, direct grant, legacy fallback hoặc responsibility slot cũ cần tự mở lại.
3. Mở lại Auth identity qua trusted server.
4. Chuyển app account về `ACTIVE`.
5. Append audit và thông báo cho người quản trị liên quan.

Sau khôi phục:

- Không tự khôi phục Business Role cũ.
- Không tự khôi phục Direct Grant cũ.
- Không tự bật legacy permission.
- Không mở lại assignment hoặc responsibility slot cũ.
- Có thể cấp role nền self-service nếu VIOO quyết định dùng.
- Permission Admin cấp lại quyền ứng dụng từ đầu.

### 12.6 Xóa vĩnh viễn

Không hiển thị xóa vĩnh viễn trong luồng quản trị nhân sự thông thường.

Xóa chỉ được cân nhắc cho tài khoản tạo nhầm, chưa phát sinh HRM link, chứng từ, audit, assignment hoặc lịch sử nghiệp vụ. Đây là công cụ bảo trì riêng, không phải chức năng nghỉ việc.

## 13. Giao diện quản trị

### 13.1 Quản trị quyền

Màn hình cần có:

- Business Role theo scope.
- Permission matrix theo application/module/action.
- Badge nguồn quyền: Role, Direct, Legacy.
- Thời gian hiệu lực và lý do cho direct grant.
- Module migration state.
- Legacy toggle theo user/module/scope.
- Preview covered, missing, unmapped và diff trước khi lưu.
- Cảnh báo SoD và luồng ghi nhận biện pháp bù trừ.

Save phải gọi command/RPC quản trị duy nhất, không cập nhật từng bảng trực tiếp từ frontend.

### 13.2 Quản trị tài khoản

- Thay hành động xóa nhân sự bằng `Vô hiệu hóa tài khoản`.
- Bắt buộc lý do và hiển thị quyền/trách nhiệm hiện hành.
- Có bộ lọc tài khoản disabled.
- `Khôi phục tài khoản` phải nêu rõ quyền cũ không được phục hồi.
- Hiển thị trạng thái xử lý Auth nếu orchestrator đang retry.

## 14. Audit và vận hành

### 14.1 Sự kiện bắt buộc audit

- Role assignment được cấp, sửa, hết hạn hoặc revoke.
- Direct grant được cấp, sửa, hết hạn hoặc revoke.
- Legacy source mode và module migration state thay đổi.
- Account disable/reactivate và kết quả Auth orchestration.
- Responsibility slot và runtime assignment thay đổi.
- Workflow transition, return, final approval và override.
- Sensitive read/export tại các module khai báo cần giám sát.
- SoD warning được chấp nhận và biện pháp bù trừ.

### 14.2 Review định kỳ

- Hàng tháng: báo cáo grant sắp hết hạn, SoD warning, orphan assignment và legacy exception.
- Hàng quý: review sensitive permissions.
- Sáu tháng: review toàn bộ quyền đang hoạt động.
- Khi chuyển phòng ban, dự án, công trường hoặc kho: revoke scope cũ và yêu cầu assignment mới.

## 15. Roadmap triển khai

### Phase 0: Security Baseline

Phạm vi:

- Inventory route, RLS, RPC, grants, SECURITY DEFINER và legacy consumer.
- Live policy snapshot.
- Route deny-by-default.
- Khóa `anon` và direct API mutation còn mở.

Exit gate:

- Không protected route nào tự allow vì thiếu mapping.
- `anon` không ghi dữ liệu nghiệp vụ.
- Có danh sách policy và legacy consumer đầy đủ, có owner và severity.

### Phase 1: Identity và Account Lifecycle

Phạm vi:

- Active-only actor semantics.
- Rà và migrate các RLS/RPC phụ thuộc current actor.
- Account lifecycle metadata và audit.
- Disable/reactivate orchestrator.
- Thay delete UI bằng disable/reactivate.

Exit gate:

- Disabled user bị deny ở backend dù JWT còn hạn.
- Không đăng nhập/refresh được sau disable operation hoàn tất.
- HRM và lịch sử nghiệp vụ còn nguyên.
- Reactivation bắt đầu với không có quyền nghiệp vụ cũ.
- Self-disable và last-admin đều bị chặn.

### Phase 2: Business Role và Minimal SoD

Phạm vi:

- Principal role assignments.
- Effective permission resolver có source explanation.
- Tách System Admin, Permission Admin, Scope Admin, Business User và Auditor.
- Permission risk metadata, hard SoD, warning và override.

Exit gate:

- Mọi quyền hiệu lực giải thích được theo nguồn, scope và thời hạn.
- System Admin không tự có business approval.
- Sensitive self-grant và hard SoD bị backend chặn.
- Override có permission riêng, lý do, audit và notification.

### Phase 3: Controlled Legacy Migration

Phạm vi:

- Module lifecycle state.
- Source mode theo user/module/scope.
- Coverage preview và source badge.
- Atomic diff-based permission admin command.
- Projection guard cho cohort đã cutover.

Exit gate:

- Admin tắt legacy và quyền thiếu bị deny thật.
- Projection không tái sinh quyền đã tắt.
- Save lỗi không tạo trạng thái một phần.
- Có thể rollback source mode mà không mất audit hoặc legacy snapshot.

### Phase 4: Daily Log Golden Pilot

Phạm vi:

- E2E production verification.
- Assignment-first inbox và notification.
- UI hiển thị resolved recipient và missing-slot warning.
- Canary `NEW_ONLY` theo cohort.

Exit gate:

- Permission không assignment bị deny action và không nhận task.
- Assignment thiếu permission hoặc sai scope bị deny.
- Direct workflow update bị chặn.
- Notification không broadcast theo permission pool.
- Canary ổn định và production log sạch tối thiểu 24 giờ.

### Phase 5: Project High-Risk Modules

Thứ tự:

1. Project Core và Project Org.
2. Material Request và luồng liên quan WMS.
3. Payment và Quantity Acceptance.
4. Quality.

Mỗi module phải đạt `NEW_ONLY` trước khi bắt đầu module kế tiếp, trừ công việc inventory/test độc lập.

Exit gate:

- Project scope root và org assignment được bảo vệ.
- Material routing đúng project/site/warehouse responsibility.
- Payment áp maker-checker và tách approve/mark-paid.
- Quality không còn policy rộng và attachment theo subject visibility.

### Phase 6: ERP Rollout Waves

Thứ tự khuyến nghị theo phụ thuộc và rủi ro:

1. WMS.
2. Contract, Request và Expense.
3. HRM và Payroll.
4. Asset, Documents, Reporting và các module còn lại.

Exit gate:

- Không module nào tạo permission model riêng.
- Mọi module dùng authorization core, scope, workflow/assignment nếu có, notification và audit chuẩn.
- Mỗi module đạt module gate trước khi cutover.

### Phase 7: Legacy Retirement và Operations

Phạm vi:

- Chuyển mọi module sang `RETIRED`.
- Dừng projection và write legacy.
- Gỡ runtime fallback và old helper.
- Bật review/exception reporting định kỳ.

Exit gate:

- Code search và runtime telemetry không còn legacy read/write.
- Không module nào còn ở `LEGACY_ONLY`, `DUAL_READ` hoặc `NEW_ONLY` chờ cleanup.
- Access review và exception report có owner vận hành.

## 16. Module gate bắt buộc

Một module chỉ được chuyển sang `NEW_ONLY` khi đạt đủ:

1. Permission namespace và risk level đã khai báo.
2. Subject type, owner/relationship và scope resolver đã hoàn chỉnh.
3. Business Role và direct grant mapping đã seed/migrate.
4. Workflow state machine và responsibility đã xác định nếu module có workflow.
5. Mutation nhạy cảm đi qua RPC và direct API bypass bị chặn.
6. Notification recipient đi từ assignment/relationship.
7. Legacy coverage không còn quyền `unmapped` chưa có quyết định.
8. Audit trả lời được actor, action, subject, source permission và kết quả.
9. Positive, negative, wrong-scope, wrong-assignment và SoD tests đều đạt.
10. Có rollback source mode và canary production trước rollout toàn bộ.

## 17. Chiến lược kiểm thử

### 17.1 Static và contract tests

- Permission registry và route coverage.
- Module lifecycle và legacy mapping coverage.
- Không frontend nào direct-update workflow field bị bảo vệ.
- Không module mới gọi legacy helper ngoài adapter cho phép.

### 17.2 SQL/RLS integration tests

Persona tối thiểu:

- Inactive user có JWT còn hạn.
- User không quyền.
- Viewer đúng và sai scope.
- Creator/owner.
- Assigned verifier/approver.
- User có permission nhưng không assignment.
- System Admin không có business permission.
- Permission Admin thử self-grant sensitive permission.
- System Admin cuối cùng.

### 17.3 Workflow tests

- Mọi transition hợp lệ.
- State sai bị deny.
- Assignment sai hoặc hết hạn bị deny.
- Maker-checker và payment SoD bị chặn.
- Override tạo đúng audit và notification.

### 17.4 Account lifecycle tests

- Disable qua trusted orchestrator.
- Backend deny ngay sau DB disable.
- Auth step retry an toàn và idempotent.
- HRM, authored records và history còn nguyên.
- Reactivation không khôi phục grant, role, legacy hoặc assignment.

### 17.5 Production rollout

- Dry-run hoặc transaction rollback trước migration nhạy cảm.
- Canary theo user/module/scope.
- Theo dõi deny anomaly, RPC error, orphan assignment và notification routing.
- Quan sát tối thiểu 24 giờ trước khi mở rộng cohort hoặc module.

## 18. Migration và rollback

- Mỗi migration nhỏ, có mục tiêu đơn và có preflight query.
- Không dùng một migration để xóa toàn bộ legacy fields.
- Không mở `anon` để chữa regression.
- Không dùng frontend fallback để che lỗi schema/RPC.
- Schema mới được triển khai trước, backfill sau, cutover sau cùng.
- Rollback ưu tiên đổi source mode hoặc feature state; không đảo ngược dữ liệu nghiệp vụ đã tạo hợp lệ.
- Auth orchestrator phải idempotent và có trạng thái retry rõ ràng.
- Không dùng `supabase db push` trong quy trình hiện tại khi migration history Cloud đang cần quản lý thận trọng.

## 19. Tiêu chí hoàn thành toàn chương trình

Chương trình được coi là hoàn thành khi:

- Mọi protected mutation được backend authorization kiểm tra.
- Mọi active permission giải thích được theo source, scope và thời hạn.
- Mọi workflow action cần assignment đều thực sự kiểm assignment.
- System Admin không còn là business approval bypass.
- Disabled account không truy cập được backend và không mất dữ liệu HRM/history.
- Reactivated account không tự nhận lại quyền cũ.
- Không còn runtime legacy permission hoặc legacy projection.
- Tất cả module đạt module gate và trạng thái `RETIRED` cho legacy.
- Audit, access review và exception reporting có owner vận hành.

## 20. Tài liệu liên quan

- `docs/security/principal-permission-scope-assignment-workflow-notification-architecture.md`
- `docs/security/permission-refactor-roadmap.md`
- `docs/security/permission-audit.md`
- `supabase/migrations/20260712071535_phase1_permission_framework.sql`
- `supabase/migrations/20260713033241_phase5_legacy_permission_projection.sql`
- `supabase/migrations/20260716040851_daily_log_responsibility_assignment_pilot.sql`

Sau khi đặc tả này được review, roadmap cũ cần được cập nhật để dùng cùng phase, gate và thuật ngữ. Kế hoạch triển khai chi tiết sẽ tách theo database, backend authorization, Auth orchestration, frontend administration, testing và production rollout.

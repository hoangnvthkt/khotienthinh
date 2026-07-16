# Roadmap refactor phân quyền ERP VIOO

Ngày lập: 2026-07-12  
Nguồn đầu vào: `docs/security/permission-audit.md`  
Mục tiêu: đưa hệ thống phân quyền từ mô hình lai/rải rác hiện tại sang mô hình nhất quán theo `Ứng dụng -> Module -> Hành động -> Phạm vi`, ưu tiên vá Critical trước, sau đó chuẩn hóa nền tảng dùng chung, rồi refactor module Dự án và từng module con.

Kiến trúc đích chi tiết cho toàn ERP được chuẩn hóa trong `docs/security/principal-permission-scope-assignment-workflow-notification-architecture.md`. Roadmap này là kế hoạch triển khai theo phase; tài liệu kiến trúc đó là luật nền về Principal, Permission, Scope, Assignment, Workflow và Notification.

## 1. Nguyên tắc triển khai

1. Backend là nguồn quyết định cuối cùng.
   - UI chỉ hiển thị/ẩn nút.
   - RLS/RPC mới là lớp chặn thật.

2. Deny-by-default.
   - Route không map quyền thì không tự động cho qua.
   - Bảng chưa có policy rõ thì không mở write.
   - Project chưa cấu hình PBAC thì không mặc định cho mutation.

3. Permission phải có namespace.
   - Không dùng `verify`, `approve`, `submit` chung toàn hệ thống.
   - Dùng dạng rõ nghĩa: `project.daily_log.verify`, `project.material_request.approve`, `expense.budget_entry.edit_all`.

4. Tách rõ hành động và phạm vi.
   - Hành động: xem, tạo, sửa, xóa, gửi, trả lại, duyệt, xác nhận, export, quản trị danh mục.
   - Phạm vi: của mình, tất cả, được giao xử lý, theo project, theo công trường, theo kho.

5. Refactor theo adapter, không big-bang.
   - Giữ legacy fields trong giai đoạn chuyển tiếp.
   - Viết helper đọc cả permission mới và legacy để tránh gãy app.
   - Chỉ xóa legacy sau khi có migration dữ liệu và test coverage.

6. Mỗi phase phải có acceptance criteria rõ.
   - Có test.
   - Có migration rollback/backup plan.
   - Có audit log cho thay đổi quyền.

## 2. Mô hình đích

### 2.1 Ma trận quyền người dùng

Mô hình UI nên đi theo dạng anh đề xuất:

| Module | Xem | Tạo | Sửa của mình | Sửa tất cả | Gửi | Trả lại | Duyệt | Xóa | Quản trị |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nhật ký | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| Đề xuất vật tư | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| Kế hoạch chi | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ |  |  |

Backend không lưu checkbox thô. Backend lưu permission code có namespace:

```text
project.daily_log.view
project.daily_log.create
project.daily_log.edit_own
project.daily_log.edit_all
project.daily_log.submit
project.daily_log.return
project.daily_log.approve
project.daily_log.delete_own
project.daily_log.delete_all
```

### 2.2 Tầng phân quyền

Tầng 1: App access

- User có được vào ứng dụng/module lớn không.
- Ví dụ: `WMS`, `HRM`, `DA`, `EX`, `WF`, `RQ`, `TS`.

Tầng 2: Module/submodule access

- User có được thấy tab/nghiệp vụ không.
- Ví dụ trong Dự án: `daily_log`, `material_request`, `payment`, `quality`.

Tầng 3: Action permission

- User được làm gì.
- Ví dụ: `view`, `create`, `edit_own`, `edit_all`, `submit`, `return`, `approve`.

Tầng 4: Scope permission

- User được làm trong phạm vi nào.
- Ví dụ: project A, công trường B, kho C, phiếu do mình tạo, phiếu đang giao cho mình.

## 3. Roadmap tổng thể

| Phase | Ưu tiên | Mục tiêu | Phạm vi |
| --- | --- | --- | --- |
| Phase 0 | Critical | Vá lỗ hổng đang có thể bị khai thác | `users`, open RLS, route unknown, live policy snapshot |
| Phase 1 | Nền tảng | Dựng permission framework chung | schema, registry, helpers, route guard, tests |
| Phase 2 | Dự án foundation | Chuẩn hóa PBAC v2 cho module DA | project staff, project scoped grants, tab/action matrix |
| Phase 3 | Dự án module con | Refactor từng nghiệp vụ DA theo rủi ro | Daily Log, Material, Payment, Contract, Quality... |
| Phase 4 | Rollout module khác | Áp dụng framework cho WMS/HRM/EX/WF/RQ/TS/HD | từng module hiện có |
| Phase 5 | Cleanup | Gỡ legacy, harden, policy tests | legacy fields, old helpers, docs, monitoring |

## 4. Phase 0: Critical containment

Mục tiêu: chặn các đường leo quyền và direct API bypass trước khi refactor lớn.

### 4.1 Khóa self-update `public.users`

Vấn đề:

- User authenticated có thể update chính row của mình.
- Row chứa `role`, `allowed_modules`, `admin_modules`, `allowed_sub_modules`, `admin_sub_modules`, `is_active`.
- `is_admin()` và `is_module_admin()` tin các field này.

Việc cần làm:

1. Tách policy self-profile update và admin update.
2. Self update chỉ được sửa field an toàn:
   - avatar
   - phone
   - signature/preferences nếu có
3. Cột quyền bắt buộc admin-only:
   - role
   - allowed_modules
   - admin_modules
   - allowed_sub_modules
   - admin_sub_modules
   - is_active
   - auth_id
4. Thêm trigger reject thay đổi cột quyền nếu actor không phải admin thật.
5. User management chuyển sang RPC có audit log.

Acceptance criteria:

- Employee không thể tự update role thành `ADMIN`.
- Employee không thể tự thêm `admin_modules`.
- Admin vẫn cập nhật user được qua UI chính thức.
- Có audit log khi thay đổi quyền.

### 4.2 Revoke `anon` và policy mở

Bảng ưu tiên khóa ngay:

- `projects`
- `project_groups`
- `project_types`
- `project_sectors`
- `work_groups`
- `work_group_members`
- Quality/Inspection tables:
  - `quality_checklists`
  - `quality_inspection_attempts`
  - `inspection_categories`
  - `inspection_work_types`
  - `inspection_templates`
  - `template_sections`
  - `inspection_template_items`
  - `quality_checklist_templates`

Việc cần làm:

1. Revoke CRUD từ `anon`.
2. Write/delete chỉ cho Admin hoặc module admin phù hợp.
3. Select chỉ mở theo nhu cầu thật.
4. Tạo policy rõ ràng cho từng bảng master và bảng phát sinh.

Acceptance criteria:

- Anon key không thể insert/update/delete các bảng trên.
- Employee không có quyền không thể direct API mutate.
- UI vẫn hoạt động với user có quyền hợp lệ.

### 4.3 Snapshot live DB policy

Việc cần làm:

1. Export `pg_policies`.
2. Export grants cho `anon`, `authenticated`.
3. Export SECURITY DEFINER functions.
4. So sánh với expected permission matrix.

Deliverable:

- `docs/security/live-policy-snapshot-YYYY-MM-DD.md`
- Danh sách policy mở còn tồn tại.

### 4.4 Route deny-by-default tối thiểu

Việc cần làm:

1. Liệt kê toàn bộ route trong `App.tsx`.
2. Route nào không map thì đưa vào:
   - `ROUTE_TO_MODULE`, hoặc
   - `PUBLIC_ROUTES`, hoặc
   - `SELF_SERVICE_ROUTES`.
3. Guard protected route không map thì redirect/403.

Acceptance criteria:

- Không còn protected route tự động allow vì thiếu map.
- Có test so sánh route registry.

## 5. Phase 1: Nền tảng chung cho tất cả module

Mục tiêu: tạo một hệ permission dùng chung cho toàn ERP, thay cho logic rải rác.

### 5.1 Permission registry typed

Tạo registry trung tâm mô tả:

- app/module key
- route
- resource
- actions
- scopes
- legacy mapping

Ví dụ:

```ts
project: {
  daily_log: {
    route: '/da/tabs/dailylog',
    actions: ['view', 'create', 'edit_own', 'edit_all', 'submit', 'return', 'approve', 'delete_own', 'delete_all'],
    scopes: ['project', 'construction_site'],
  }
}
```

Deliverables:

- `permissionRegistry`
- Route registry sinh từ permission registry hoặc validate ngược lại.
- Constants UI lấy từ registry, không hardcode rải rác.

### 5.2 Schema permission chung

Mô hình đề xuất:

- `permission_applications`
  - `id`, `code`, `name`, `sort_order`
- `permission_modules`
  - `id`, `application_code`, `code`, `name`, `route`, `sort_order`
- `permission_actions`
  - `id`, `module_code`, `action`, `permission_code`, `label`, `scope_mode`
- `user_permission_grants`
  - `user_id`, `permission_code`, `scope_type`, `scope_id`, `is_active`
- `role_permission_templates`
  - template quyền theo vai trò/mẫu chức danh.

Scope examples:

- `global`
- `own`
- `assigned`
- `project`
- `construction_site`
- `warehouse`
- `department`

Giai đoạn đầu chưa cần thay hết legacy fields. Có thể dùng song song:

- New permission tables cho module Dự án trước.
- Legacy `allowedModules/adminModules/allowedSubModules/adminSubModules` vẫn đọc để không gãy app.

### 5.3 Permission service chung

Frontend:

- `canViewModule(app/module)`
- `canPerform(permissionCode, scope)`
- `canManageMaster(permissionCode)`
- `usePermissions()`

Backend SQL/RPC:

- `public.current_app_user_id()`
- `public.has_permission(permission_code text, scope_type text, scope_id text)`
- `public.has_any_permission(permission_codes text[], scope_type text, scope_id text)`
- `public.assert_permission(...)`

Nguyên tắc:

- Frontend helper chỉ để UX.
- Backend helper dùng trong RLS/RPC mới là quyết định cuối.

### 5.4 UI phân quyền chung

UI mục tiêu:

1. Chọn user hoặc nhóm vai trò.
2. Chọn ứng dụng.
3. Hiển thị ma trận module/action.
4. Nếu module có scope, chọn project/công trường/kho.
5. Có nút copy từ template/user khác nhưng phải preview diff.
6. Save qua RPC admin-only.

Ví dụ app Dự án:

| Module | Xem | Tạo | Sửa của mình | Sửa tất cả | Gửi | Trả lại | Duyệt | Xóa |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nhật ký | ✓ | ✓ | ✓ |  | ✓ |  |  |  |
| Đề xuất vật tư | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| Thanh toán | ✓ |  |  | ✓ | ✓ | ✓ | ✓ |  |

### 5.5 Test framework

Test bắt buộc:

- Route registry coverage.
- Permission registry snapshot.
- RLS integration tests với các account mẫu:
  - Admin
  - Employee không quyền
  - User chỉ xem
  - User tạo/sửa của mình
  - User duyệt
  - Module admin
- Direct API negative tests.

Acceptance criteria Phase 1:

- Có permission registry chung.
- Có schema hoặc adapter cho permission mới.
- Có helper frontend/backend thống nhất.
- Có UI matrix version đầu.
- Critical policies không phụ thuộc UI-only.

## 6. Phase 2: Ưu tiên module Dự án - Foundation PBAC v2

Mục tiêu: Dự án là module phức tạp nhất, nhiều nghiệp vụ phát sinh, nhiều approval flow. Refactor Dự án trước sẽ tạo mẫu cho các module còn lại.

### 6.1 Chuẩn hóa cây quyền Dự án

Application:

- `project`

Modules:

- `project.overview`
- `project.org`
- `project.executive`
- `project.daily_log`
- `project.material_request`
- `project.material_plan`
- `project.material_boq`
- `project.material_po`
- `project.custom_material`
- `project.gantt`
- `project.weekly_progress`
- `project.contract`
- `project.subcontract`
- `project.payment`
- `project.quantity_acceptance`
- `project.cashflow`
- `project.budget`
- `project.quality`
- `project.safety`
- `project.documents`
- `project.report`

### 6.2 Tách tab visibility khỏi action permission

Hiện tại:

- `allowedSubModules.DA` quyết định tab được xem.
- `adminSubModules.DA` quyết định tab được quản trị.
- PBAC project/site chạy riêng.

Mô hình mới:

- `project.<module>.view` quyết định có thấy tab/module không.
- `project.<module>.<action>` quyết định thao tác.
- Scope `project_id`/`construction_site_id` quyết định phạm vi.
- Global route admin chỉ còn dùng cho quản trị cấu hình hệ thống, không thay thế action permission.

Acceptance criteria:

- User có quyền Daily Log ở project A không tự có quyền project B.
- User có quyền xem tab không tự có quyền tạo/sửa/gửi/duyệt.
- User có quyền quản trị cấu hình DA không tự được duyệt chứng từ phát sinh.

### 6.3 Migration generic PBAC sang namespace

Mapping ban đầu:

| Legacy code | New candidates |
| --- | --- |
| `view` | `project.<module>.view` |
| `edit` | `project.<module>.create`, `project.<module>.edit_own`, `project.<module>.edit_all` |
| `delete` | `project.<module>.delete_own`, `project.<module>.delete_all` |
| `submit` | `project.<module>.submit` |
| `verify` | `project.<module>.verify`, `project.<module>.return` |
| `confirm` | `project.<module>.confirm` |
| `approve` | `project.<module>.approve`, `project.<module>.rollback` |
| `view_available_stock` | `project.material_request.view_available_stock` |

Migration nên làm theo hai bước:

1. Seed permission mới và tạo grant song song từ legacy.
2. Code đọc permission mới trước, fallback legacy có warning.
3. Sau ổn định mới tắt fallback legacy.

### 6.4 Project permission UI

Trong tab Tổ chức Dự án:

- Chọn nhân sự.
- Chọn phạm vi:
  - toàn project
  - công trường cụ thể
  - nhóm công việc nếu cần
- Hiển thị ma trận quyền theo module.
- Có template:
  - Chỉ xem
  - Kỹ sư hiện trường
  - Chỉ huy trưởng
  - QS/Khối lượng
  - Kế toán dự án
  - Thủ kho công trường
  - QA/QC
  - An toàn
  - Quản lý dự án

Acceptance criteria:

- Admin DA cấp quyền theo project bằng UI matrix.
- Người dùng nhìn vào matrix hiểu ngay được quyền.
- Lưu quyền qua RPC, không direct table write tùy tiện.

## 7. Phase 3: Refactor từng module con Dự án

Thứ tự ưu tiên nên dựa trên rủi ro integrity + mức độ đang dùng workflow.

## 7.1 Dự án core/master

Bao gồm:

- Project list/detail.
- Project categories: group/type/sector.
- Work groups.
- Project org/staff.

Lý do làm trước:

- Project master đang có policy mở trong audit.
- Đây là scope gốc cho mọi module con.

Permission target:

- `project.master.view`
- `project.master.create`
- `project.master.edit`
- `project.master.hide`
- `project.master.restore`
- `project.master.manage_categories`
- `project.org.view`
- `project.org.assign_staff`
- `project.org.grant_permissions`

Backend:

- Revoke anon.
- Project create/update/hide/restore qua RPC hoặc RLS `is_module_admin('DA')`.
- Project staff permission grant qua RPC admin-only.

Acceptance criteria:

- User không có quyền DA không thể direct API sửa project.
- User chỉ xem project không sửa master/category/org.
- Grant permission có audit log.

## 7.2 Daily Log

Lý do ưu tiên:

- Là pattern tốt nhất hiện tại.
- Có workflow rõ.
- Có thể dùng làm mẫu chuẩn cho các module khác.

Permission target:

- `project.daily_log.view`
- `project.daily_log.create`
- `project.daily_log.edit_own`
- `project.daily_log.edit_all`
- `project.daily_log.delete_own`
- `project.daily_log.delete_all`
- `project.daily_log.submit`
- `project.daily_log.return`
- `project.daily_log.verify`
- `project.daily_log.approve`
- `project.daily_log.summarize`

Backend:

- Bắt mọi transition qua RPC.
- `daily_logs_update WITH CHECK` mirror invariant.
- No-staff fallback không cho mutation.
- Owner chỉ sửa/xóa khi có `edit_own/delete_own` và status hợp lệ.
- Current handler chỉ return/verify/approve khi có permission tương ứng.

Acceptance criteria:

- Người tạo chỉ sửa nhật ký của mình khi còn draft/rejected.
- Người có `verify` không tự có `approve`.
- Người không được giao xử lý không duyệt thay.
- Direct update status ngoài RPC bị chặn.

## 7.3 Material trong Dự án

Bao gồm:

- Material summary.
- BOQ.
- Planning.
- Material request.
- Custom material.
- PO.
- Waste.
- Dashboard.

Lý do ưu tiên:

- Giao thoa giữa Project và WMS.
- Ảnh hưởng tồn kho, PO, yêu cầu mua/cấp vật tư.

Permission target:

- `project.material.view`
- `project.material_boq.view`
- `project.material_boq.edit`
- `project.material_plan.view`
- `project.material_plan.edit`
- `project.material_request.view`
- `project.material_request.create`
- `project.material_request.edit_own`
- `project.material_request.edit_all`
- `project.material_request.submit`
- `project.material_request.return`
- `project.material_request.approve`
- `project.material_request.confirm_fulfillment`
- `project.material_request.view_available_stock`
- `project.custom_material.create`
- `project.custom_material.approve`
- `project.material_po.create`
- `project.material_po.approve`
- `project.material_po.receive`
- `project.material_waste.record`
- `project.material_waste.approve`

Backend:

- Material request RLS dùng permission namespace.
- Custom material RLS dùng permission namespace.
- PO transition qua RPC.
- Tồn khả dụng chỉ trả về khi có `view_available_stock`.
- WMS transaction vẫn qua `process_transaction_status`.

Acceptance criteria:

- User có quyền tạo đề xuất không tự có quyền duyệt.
- User có quyền xem material không tự thấy tồn khả dụng nếu thiếu quyền.
- PO status không update trực tiếp ngoài RPC.

## 7.4 Payment, nghiệm thu, khối lượng

Bao gồm:

- Payment workbench.
- Payment certificate.
- Quantity acceptance.
- Contract payment schedule.
- Cashflow/budget liên quan dự án.

Lý do ưu tiên:

- Dữ liệu tài chính.
- Audit đã phát hiện migration lịch sử có policy mở cần snapshot runtime.

Permission target:

- `project.payment.view`
- `project.payment.create`
- `project.payment.edit_own`
- `project.payment.edit_all`
- `project.payment.submit`
- `project.payment.return`
- `project.payment.verify`
- `project.payment.confirm`
- `project.payment.approve`
- `project.payment.mark_paid`
- `project.quantity_acceptance.view`
- `project.quantity_acceptance.create`
- `project.quantity_acceptance.submit`
- `project.quantity_acceptance.verify`
- `project.quantity_acceptance.approve`
- `project.budget.view`
- `project.budget.edit`
- `project.cashflow.view`
- `project.cashflow.manage`

Backend:

- Snapshot runtime policy của finance/payment tables.
- Revoke policy mở còn sót.
- Payment/quantity transition qua RPC.
- Paid/confirm không map chung từ legacy `confirm` nữa.

Acceptance criteria:

- User có `verify` kỹ thuật không tự `mark_paid`.
- User có budget edit không tự approve payment.
- Direct API update amount/status bị chặn nếu không đúng quyền.

## 7.5 Contract và Subcontract

Bao gồm:

- Contract tab.
- Contract item table.
- Contract variation.
- Subcontract tab.

Permission target:

- `project.contract.view`
- `project.contract.create`
- `project.contract.edit`
- `project.contract.approve`
- `project.contract_item.view`
- `project.contract_item.edit`
- `project.contract_variation.create`
- `project.contract_variation.submit`
- `project.contract_variation.verify`
- `project.contract_variation.approve`
- `project.subcontract.view`
- `project.subcontract.manage`

Backend:

- Contract item mutation policy namespace.
- Variation transition qua RPC.
- Dependencies/rollback checks giữ trong project document policy nhưng dùng permission mới.

Acceptance criteria:

- User chỉ xem hợp đồng không sửa line item.
- User tạo variation không tự approve variation.

## 7.6 Gantt và Weekly Progress

Bao gồm:

- Gantt tasks.
- Task completion requests.
- Weekly progress lock/summary.

Permission target:

- `project.gantt.view`
- `project.gantt.create_task`
- `project.gantt.edit_task`
- `project.gantt.assign_task`
- `project.gantt.submit_completion`
- `project.gantt.verify_completion`
- `project.gantt.approve_completion`
- `project.weekly_progress.view`
- `project.weekly_progress.create`
- `project.weekly_progress.lock`
- `project.weekly_progress.approve`

Backend:

- Task completion requests dùng permission namespace.
- Không dùng generic `submit/approve`.
- Weekly progress write có RLS/RPC rõ.

Acceptance criteria:

- Người được giao task submit completion.
- Người verify/approve completion phải có quyền cụ thể.
- Weekly lock không thể direct update bởi user thường.

## 7.7 Quality

Lý do ưu tiên:

- Audit thấy Quality/Inspection tables đang mở rộng nhất.
- Đây là dữ liệu bằng chứng nghiệm thu/chất lượng.

Permission target:

- `project.quality.view`
- `project.quality.template_manage`
- `project.quality.checklist_create`
- `project.quality.checklist_edit_own`
- `project.quality.checklist_edit_all`
- `project.quality.submit`
- `project.quality.return`
- `project.quality.verify`
- `project.quality.approve`
- `project.quality.delete`

Backend:

- Revoke anon toàn bộ.
- Template master data chỉ quality admin/DA admin.
- Checklist/attempt theo project/site permission.
- File/attachment policy theo checklist visibility.

Acceptance criteria:

- User không quyền không thể direct API sửa checklist/template.
- QA/QC có thể verify nhưng không tự approve nếu thiếu quyền.
- Template không bị sửa bởi người chỉ tạo checklist.

## 7.8 Safety

Permission target:

- `project.safety.view`
- `project.safety.worker_manage`
- `project.safety.issue_create`
- `project.safety.issue_edit_own`
- `project.safety.issue_edit_all`
- `project.safety.issue_close`
- `project.safety.training_manage`
- `project.safety.document_verify`

Backend:

- Audit RLS safety hiện tại.
- Chuẩn hóa các bảng safety theo project/site.
- QR/public safety card tách riêng route public read-only.

Acceptance criteria:

- Public QR chỉ đọc đúng thông tin được phép.
- Safety officer quản lý issue/training trong project được cấp.
- User không quyền không sửa safety passport/document.

## 7.9 Documents

Permission target:

- `project.documents.view`
- `project.documents.upload`
- `project.documents.edit_metadata`
- `project.documents.delete_own`
- `project.documents.delete_all`
- `project.documents.approve`

Backend:

- Audit Supabase Storage policies.
- Document metadata theo project/site.
- File path không tự cho quyền nếu metadata không cho.

Acceptance criteria:

- User không thuộc project không đọc file project.
- Uploader chỉ xóa file của mình nếu được cấp quyền.
- Admin/project document manager có thể quản lý toàn bộ.

## 7.10 Report, Executive, Dashboard

Permission target:

- `project.report.view`
- `project.report.export`
- `project.executive.view`
- `project.dashboard.view_financials`
- `project.dashboard.view_progress`
- `project.dashboard.view_risk`

Backend:

- Report API/view tôn trọng project membership.
- Financial cards cần permission riêng nếu dữ liệu nhạy cảm.

Acceptance criteria:

- User chỉ có Daily Log không tự xem báo cáo tài chính.
- Export report cần quyền export.

## 8. Phase 4: Rollout sang các module hiện có khác

Sau khi Dự án ổn, áp dụng cùng framework cho các module còn lại.

### 8.1 WMS

Giữ điểm mạnh hiện có:

- `process_transaction_status`
- warehouse keeper scope

Permission target:

- `wms.inventory.view`
- `wms.inventory.edit`
- `wms.request.create`
- `wms.request.approve`
- `wms.request.export`
- `wms.request.receive`
- `wms.transaction.create`
- `wms.transaction.approve`
- `wms.transaction.complete`
- `wms.master_data.manage`

Scope:

- warehouse
- source warehouse
- target warehouse
- requester own

### 8.2 HRM

Permission target:

- `hrm.employee.view`
- `hrm.employee.create`
- `hrm.employee.edit`
- `hrm.attendance.view`
- `hrm.attendance.edit`
- `hrm.leave.approve`
- `hrm.payroll.view`
- `hrm.payroll.manage`
- `hrm.master_data.manage`

Scope:

- own
- department
- managed employees
- all

### 8.3 Expense

Giữ hardening hiện có nhưng chuyển sang namespace:

- `expense.budget.view`
- `expense.budget.create`
- `expense.budget.edit_all`
- `expense.expense_record.create`
- `expense.expense_record.edit_own`
- `expense.expense_record.approve`
- `expense.master_data.manage`

### 8.4 Workflow

Permission target:

- `workflow.instance.view`
- `workflow.instance.create`
- `workflow.instance.act_assigned`
- `workflow.template.view`
- `workflow.template.create`
- `workflow.template.edit`
- `workflow.template.publish`

### 8.5 Request Center

Permission target:

- `request.instance.view_own`
- `request.instance.create`
- `request.instance.act_assigned`
- `request.instance.view_all`
- `request.category.manage`
- `request.template.manage`

### 8.6 Assets

Permission target:

- `asset.catalog.view`
- `asset.catalog.manage`
- `asset.assignment.create`
- `asset.assignment.approve`
- `asset.maintenance.create`
- `asset.maintenance.manage`
- `asset.audit.perform`

### 8.7 Contract module

Permission target:

- `contract.partner.view`
- `contract.partner.manage`
- `contract.customer.view`
- `contract.customer.manage`
- `contract.supplier.view`
- `contract.supplier.manage`
- `contract.template.manage`
- `contract.cost_library.manage`

### 8.8 AI, Storage, KB, Analytics

Permission target:

- `ai.assistant.use`
- `ai.executive.view`
- `ai.report.generate`
- `storage.view`
- `storage.manage`
- `kb.view`
- `kb.manage`
- `analytics.view`
- `analytics.export`

## 9. Phase 5: Cleanup và hardening cuối

Việc cần làm:

1. Gỡ dần legacy fields:
   - `allowedModules`
   - `adminModules`
   - `allowedSubModules`
   - `adminSubModules`
2. Hoặc giữ làm cache/materialized projection, không còn là nguồn sự thật.
3. Gỡ fallback legacy trong permission checks.
4. Tạo dashboard health:
   - route chưa map
   - table có broad policy
   - permission code không namespace
   - project chưa PBAC enforced
5. Thêm audit log bắt buộc cho:
   - cấp quyền
   - thu hồi quyền
   - dùng admin override
   - thay đổi status workflow nhạy cảm

Acceptance criteria:

- Không còn direct mutation nhạy cảm qua table nếu chưa có policy rõ.
- Không còn permission generic cross-module trong code mới.
- Policy tests chạy trong CI.
- Admin có màn hình xem ai có quyền gì, ở project/kho/phòng ban nào.

## 10. Thứ tự triển khai đề xuất

### Sprint 1: Critical

1. Live DB policy snapshot.
2. Khóa self-update `users`.
3. Revoke anon/open policy ở Project master, Work Group, Quality.
4. Route deny-by-default baseline.

### Sprint 2: Permission foundation

1. Permission registry.
2. New permission schema draft.
3. Backend `has_permission`.
4. Frontend `usePermissions`.
5. Permission matrix UI prototype.

### Sprint 3: Project PBAC v2 foundation

1. Seed `project.*` permissions.
2. Adapter legacy -> namespace.
3. Project Org permission matrix.
4. RPC grant/revoke project permissions.

### Sprint 4: Daily Log

1. Migrate Daily Log permissions.
2. Tighten Daily Log RLS.
3. Force status transition through RPC.
4. Tests for owner/handler/approver.

### Sprint 5: Material

1. Material request namespace permissions.
2. Custom material namespace permissions.
3. PO transition protection.
4. Available stock permission.

### Sprint 6: Payment/Contract/Gantt

1. Payment/quantity/contract variation permissions.
2. Finance/payment RLS runtime cleanup.
3. Gantt completion request permissions.

### Sprint 7: Quality/Safety/Documents

1. Quality revoke/open policy cleanup.
2. Quality workflow permissions.
3. Safety RLS audit and namespace.
4. Storage/document policy.

### Sprint 8+: Rollout ERP-wide

1. WMS.
2. HRM.
3. Expense.
4. Workflow/RQ.
5. Assets/Contract/AI/Storage/KB/Analytics.

## 11. Rủi ro triển khai và cách giảm rủi ro

| Rủi ro | Cách giảm |
| --- | --- |
| Migration làm user mất quyền | Chạy adapter legacy song song; test account mẫu; rollout theo feature flag |
| RLS mới làm UI lỗi | Staging DB + Playwright smoke + direct API tests |
| Permission matrix quá phức tạp | Template quyền theo chức danh; hide advanced actions mặc định |
| Generic permission cũ còn sót | Static search CI cấm code mới dùng `verify/approve` không namespace |
| Project đang vận hành chưa PBAC | Có report project chưa setup; read-only fallback, mutation deny |
| Admin thao tác nhầm | Diff preview trước khi save, audit log, optional approval cho quyền Critical |

## 12. Definition of done toàn chương trình

Hoàn tất refactor phân quyền khi:

1. Không còn Critical finding trong audit.
2. Route protected không map bị chặn.
3. `public.users` không còn là điểm tự nâng quyền.
4. `anon` không có CRUD trên bảng nội bộ.
5. Mọi permission nghiệp vụ mới có namespace.
6. Dự án dùng PBAC theo project/site cho mutation.
7. Daily Log, Material, Payment, Quality có backend RPC/RLS rõ.
8. Permission matrix UI dùng được cho admin.
9. Có test direct API negative cases.
10. Có live policy snapshot và policy drift check định kỳ.

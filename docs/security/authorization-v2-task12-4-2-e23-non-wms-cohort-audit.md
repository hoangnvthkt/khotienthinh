# Task 12.4.2 — E23 audit cohort ngoài WMS và owner-decision gate

Ngày kiểm: 2026-09-15. Môi trường: Supabase Cloud linked project. E23 chỉ đọc và sinh preview trong evidence directory riêng; không apply migration, không tạo transition batch/item, không cấp hoặc thu hồi quyền tài khoản thật.

## Kết luận

E23 hoàn tất audit kỹ thuật, persona reconciliation, call graph, decision register và preview/reconciliation cho các cohort ngoài WMS. Có 356 direct source thuộc 36 mã đang hoạt động: 3 source canonical thuộc `system.authorization.*` được `retain`; 353 source còn lại là `manual_review`. Không có `replace`, không có `revoke`, không có executable manifest.

Lý do dừng đúng gate: 14 cohort ngoài authorization và cohort `system.wms.manage` vẫn thiếu quyết định owner về action, actor và scope. Xóa shell lúc này có thể làm mất truy cập thực tế; đổi shell thành quyền global có thể mở rộng truy cập vượt Project Room, workspace hoặc kho.

## 1. Audit cohort ngoài WMS

Snapshot Cloud có 56 tài khoản active: 2 `ADMIN`, 49 `EMPLOYEE`, 5 `WAREHOUSE_KEEPER`. Bốn hardening flag đúng trạng thái cutover:

- `legacy_fallback_disabled=true`
- `legacy_governance_fallback_disabled=true`
- `legacy_permission_writes_disabled=true`
- `legacy_projection_enabled=false`

Transition ledger vẫn sạch: 0 batch, 0 item. Catalog có 40 action `system.*` ngoài WMS; 36 mã đang có direct source. Tất cả 356 source đang hoạt động đều là `global/*`.

| Cohort | View | Manage | Persona đáng chú ý |
| --- | ---: | ---: | --- |
| Chat | 54 | 1 | View phủ 2 Admin, 47 Employee, 5 Warehouse Keeper |
| Project/DA | 52 | 39 | Manage phủ 1 Admin, 33 Employee, 5 Warehouse Keeper |
| Workflow | 45 | 24 | Manage phủ 1 Admin, 23 Employee |
| Request | 32 | 16 | Manage phủ cả 3 persona |
| Contract/HD | 19 | 8 | Cả view/manage phủ cả 3 persona |
| Asset/TS | 13 | 2 | Manage: 1 Admin, 1 Employee |
| Settings | 12 | 1 | `system.settings.manage` không cho direct grant mới |
| Expense | 10 | 1 | View: 2 Admin, 8 Employee |
| Employee/EP | 4 | 1 | Có dữ liệu nhân sự nhạy cảm cần tách scope |
| Procurement | 2 | 1 | View: 2 Admin; manage: 1 Admin |
| Tender AI | 2 | 1 | View: 2 Admin; manage: 1 Admin |
| Custom dashboard | 2 | 1 | View: 2 Admin; manage: 1 Admin |
| AI, Analytics, Audit trail, KB, Storage | mỗi mã 1 | mỗi mã 1 | Nguồn hiện tại thuộc Admin |
| Authorization control | view 2, audit 1 | 0 source manage active | 3 source canonical được giữ lại |

Các mã authorization manage/override có trong catalog nhưng không có direct source active tại snapshot. Chúng vẫn được mapping `retain` để batch shell trong tương lai không được phép suy diễn xóa capability quản trị nhạy cảm.

## 2. Reconcile persona thực tế

`users.role` chỉ là nhãn persona, không phải gói quyền đầy đủ. Snapshot assignment cho thấy:

- `SYSTEM_ADMIN`: 2 Admin, nhưng template này không đồng nghĩa full application.
- `PERMISSION_ADMIN`: 1 Admin; đây mới là assignment quản trị grant hiện hữu.
- `BUSINESS_USER`: 54 tài khoản (2 Admin, 47 Employee, 5 Warehouse Keeper).
- `AUDITOR`: 1 Employee; `HR`: 1 Employee; `HR_MANAGE`: 1 Admin.
- Bốn template `LEGACY_HR_*` vẫn có assignment active, tổng cộng theo cohort 2, 46, 1 và 5.

Boundary theo ngữ cảnh còn rõ hơn:

| Persona | Project Room memberships | Active Room actions |
| --- | ---: | ---: |
| Admin | 39 | 174 |
| Employee | 398 | 993 |
| Warehouse Keeper | 104 | 258 |

Workspace hiện có 2 membership `admin` của persona Admin và 1 membership `member` của Employee. Vì vậy không được dùng `ADMIN`, `EMPLOYEE` hay `WAREHOUSE_KEEPER` như một replacement grant. Quyền thay thế phải giữ nguyên membership/action/scope thực tế.

## 3. Call graph và phân loại consumer

Inventory quét function definition và RLS policy còn gọi literal `is_module_admin(...)` hoặc `can_access_module(...)`:

| Legacy module key | Functions | Policies | Phân loại chính |
| --- | ---: | ---: | --- |
| DA | 24 | 64 | Composite Project/Room; mutation và read theo project/site |
| EX | 1 | 0 | Expense action helper; cần own/department/global |
| FEEDBACK | 1 | 0 | Shared consumer, không có direct `system.feedback.*` source trong catalog E23 |
| HD | 0 | 76 | RLS-heavy contract boundary |
| PROCUREMENT | 1 | 0 | Shared procurement manager boundary |
| RQ | 2 | 0 | Request/workflow action boundary |
| SETTINGS | 2 | 26 | Project master, warehouse-site binding và settings RLS |
| TENDER_AI | 0 | 24 | RLS-heavy tender document boundary |
| TS | 2 | 6 | Asset creation/stock-transfer và RLS |
| WF | 14 | 8 | Template, actor, instance admin/cancel/reopen/start/watchers |

Nhóm AI, Analytics, Chat, Dashboard, EP, KB và Storage không xuất hiện trong phép quét literal này không có nghĩa là source vô dụng: chúng còn có thể được app route/service kiểm bằng permission code trực tiếp. E23 vì vậy phân loại chúng là `manual_review`, không tự động revoke từ bằng chứng âm.

Phân loại kỹ thuật:

- `retain`: chỉ sáu mã `system.authorization.*`; snapshot hiện có 3 source ở hai mã view/audit.
- `manual_review`: mọi shell còn lại, vì cần owner chốt action/scope hoặc còn consumer trực tiếp/RLS.
- `replace`: 0.
- `revoke`: 0.

## 4. Owner decision register

Decision register có cấu trúc nằm tại `scripts/authorization-v2/task12-4-2-owner-decisions.json`. Mỗi entry ghi owner role, mã nguồn, câu hỏi cần chốt và `status=owner_pending`. Các quyết định bắt buộc gồm:

1. AI: app entry, submit workload, provider/model admin, dữ liệu nhạy cảm.
2. Analytics/dashboard: dataset scope, read/export, author/publish/share, data-source admin.
3. Audit: domain có thể xem, export, retention và administration.
4. Chat: app entry, membership, moderation, channel/platform admin.
5. Project/DA: actor theo project/site và từng Room action; có cần residual global shell hay không.
6. HR/EP: self/team/department/company, payroll và field nhạy cảm.
7. Expense: own/assigned/department/global và submit/review/approve/settle/configure.
8. Contract: lifecycle action, project/company scope và confidential visibility.
9. Knowledge/storage: audience/record ownership, publish, object/bucket/retention controls.
10. Procurement/tender: membership/read, sourcing, evaluation, approval, PO/supplier, tender AI.
11. Request: instance visibility; template/category versus submit/act/approve/cancel.
12. Settings: general settings versus security/integration/project-master/warehouse binding.
13. Asset: catalog/custody/assignment/transfer/maintenance/stock/audit/disposal.
14. Workflow: template read/edit/publish versus instance start/act/admin/cancel/reopen by actor type.
15. WMS manage: replacement set theo từng actor và từng kho cho compatibility consumers còn lại.

Không coi disposition lịch sử của Phase 5 là owner approval cho việc gỡ shell hiện tại. Owner phải chấp thuận mapping hiện hành và scope cụ thể; với quyền nhạy cảm phải chốt expiry/approval rule.

## 5. Preview và reconciliation

Preview Cloud dùng snapshot hash và target version hiện tại, chỉ ghi file có định danh vào thư mục tạm mode `0700`; `input.json` và `review-required.json` mode `0600`.

Kết quả:

- 56 user snapshot.
- 356 source được đối chiếu, đủ 36/36 mã active.
- 353 `manual_review`.
- 3 `retain` (`system.authorization.audit`: 1; `system.authorization.view`: 2).
- 0 replacement reference, 0 revoke.
- Không có source không mapping và không có scope expansion.
- Cloud transition ledger sau preview vẫn 0 batch / 0 item.

Reconciliation đạt mục tiêu an toàn của E23: mọi source đều được phân loại; preview không tạo quyền mới, không xóa quyền cũ và không thay đổi Cloud.

## 6. Gate executable manifest

Script chỉ ghi `manifest.json` khi số item `manual_review` bằng 0. Với snapshot E23, script chủ ý exit code `2`, ghi `review-required.json`, và xác nhận `executableManifestCreated=false`.

Điều kiện để chạy vòng kế tiếp:

1. Owner tương ứng đổi từng decision từ `owner_pending` sang quyết định đã ký nhận.
2. Mỗi source có mapping `retain`, `replace` hoặc `revoke` rõ ràng theo actor và scope; không có wildcard persona.
3. Replacement không rộng hơn source/Room/workspace/warehouse hiện tại; quyền sensitive có expiry đúng catalog.
4. Preview mới có 0 manual review, stale-hash/scope-expansion tests đạt và reconciliation không có unexpected gain/loss.
5. Chỉ khi đó mới sinh executable manifest vào private evidence store và trình operator review trước apply.

## Evidence và lệnh kiểm

- Inventory: `supabase/tests/authorization_v2_task12_4_2_non_wms_inventory.sql`
- Mapping: `scripts/authorization-v2/task12-4-2-non-wms-mappings.json`
- Decision register: `scripts/authorization-v2/task12-4-2-owner-decisions.json`
- Preview: `scripts/authorization-v2/preview-task12-4-2-non-wms-transition.mjs <private-dir>`
- Unit invariants: `lib/__tests__/authorizationTransitionManifest.test.ts`

Không đưa input/manifest có UUID vào Git hoặc tài liệu này.

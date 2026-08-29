# Session Handoff — HRM 8 tab, scoped permissions và employee self-service

Ngày bàn giao: 2026-08-29  
Workspace: `/Users/admin/khotienthinh`  
Branch hiện tại: `feature/fix-audit-vioo`  
Ngôn ngữ làm việc với anh: tiếng Việt, xưng hô anh/em, trả lời ngắn gọn và đi thẳng vào kết quả.

## 1. Prompt dùng để bắt đầu phiên chat mới

Sao chép nguyên khối sau vào phiên chat mới:

```text
Tiếp tục công việc HRM trong repository /Users/admin/khotienthinh.

Hãy đọc đầy đủ:
- AGENTS.md của workspace.
- docs/session-handoff-2026-08-29-hrm.md
- docs/superpowers/specs/2026-08-28-hrm-personnel-information-scoped-permissions-design.md

Trạng thái gần nhất: nền tảng HRM 8 tab và scoped permissions đã triển khai; Supabase Cloud đã có các migration mới nhất. Việc cần làm tiếp theo là chuẩn hóa menu HRM mặc định cho nhân viên thường theo mục 7 của handoff: dùng Employee Dashboard, hiện Check-in/Chấm công/Nghỉ phép với scope own, đổi “Hồ sơ nhân sự” thành “Danh bạ nhân sự”, và không cho Business User vào Dashboard HR toàn công ty.

Trước khi sửa hãy tái hiện bằng test route/menu theo persona. Không mở lại raw table access, không thêm Admin bypass cho hrm.*, không dùng Supabase local/Docker, không chạm vào supabase/.temp/cli-latest. Sau khi sửa chạy lint, toàn bộ test, build và SQL persona smoke trên Supabase Cloud.
```

## 2. Quy tắc workspace bắt buộc

- Đọc và tuân thủ `AGENTS.md`.
- Không sử dụng sub-agent.
- Mọi việc Supabase dùng Supabase Cloud với cấu hình sẵn trong `.env`.
- Không dùng Supabase local hoặc Docker.
- Dùng `apply_patch` để sửa file.
- Không sửa, stage hoặc hoàn nguyên `supabase/.temp/cli-latest`; đây là thay đổi có sẵn của người dùng.
- Không mở lại blanket `Role.ADMIN => true` cho namespace `hrm.*`.
- Không cấp raw access cho các bảng HR nhạy cảm chỉ để chữa lỗi frontend; dùng RPC/projection có kiểm soát.
- Khi có bug: xác định root cause, tạo regression test đỏ, sửa tối thiểu, rồi chạy test xanh.

## 3. Trạng thái Git hiện tại

```text
branch: feature/fix-audit-vioo
upstream: origin/feature/fix-audit-vioo
ahead upstream: 14 commits
working tree user-owned change: M supabase/.temp/cli-latest
```

Chưa push 14 commit lên remote. Không tự ý push nếu người dùng chưa yêu cầu.

Các commit HRM quan trọng, mới nhất trước:

```text
31164b7 fix(hrm): restore check-in photo uploads
1dc6481 fix(hrm): load shared catalog employees via projection
b60f3a5 fix(auth): restore effective permission profile loading
1214fb6 feat(hrm): complete sensitive cutover and legacy cleanup
45446fa feat(hrm): add private personnel workbook pipeline
d77ba3e feat(hrm): add governed eight-section personnel profiles
364bd96 feat(hrm): scope organization and staffing controls
44b193d feat(hrm): harden sensitive permissions and health checks
f4f0363 feat(hrm): add governed HR role administration
db1acf9 feat(hrm): add scoped permission foundation
ae608cd docs(hrm): add HR Manage and admin self-grant
3b3cca9 docs(hrm): simplify roles and staffing workflow
```

## 4. Quyết định nghiệp vụ đã chốt

- Hồ sơ nhân sự dùng mô hình 8 tab.
- `Trưởng đơn vị` được gộp vào `Quản lý trực tiếp`; không có persona riêng.
- HR không tách Payroll/HR Manager/HR Employee. Chỉ có hai template nghiệp vụ:
  - `HR`
  - `HR_MANAGE`
- Không triển khai workflow đề xuất/phê duyệt định biên trong V1. HR nhận thông tin từ luồng khác và tạo định biên.
- Quản lý trực tiếp không mặc định xem lương hoặc pháp lý của cấp dưới.
- System Admin không mặc định xem dữ liệu HR nhạy cảm.
- System Admin được tự cấp/thu hồi `HR_MANAGE` qua luồng cảnh báo, lý do tối thiểu 10 ký tự và audit actor = target.
- `HR` được sửa C3, xem C4 nhưng không sửa C4/staffing/export.
- `HR_MANAGE` có toàn bộ HR cộng staffing, C4 mutation, master data và export.
- Employee V1 chưa self-service C3/C4.
- Manager scope chỉ bật khi manager readiness đạt; không fallback sang `users.manager_id`.
- `get_effective_permission_sources` là nguồn quyền hiệu lực chuẩn.

Đặc tả đầy đủ:

```text
docs/superpowers/specs/2026-08-28-hrm-personnel-information-scoped-permissions-design.md
```

## 5. Những phần đã triển khai

### Permission foundation

- Registry action/scope HRM đã được bổ sung.
- Có scope `direct_reports`, `org_unit`; adapter legacy có thời hạn.
- Template `BUSINESS_USER`, `HR`, `HR_MANAGE` đã có trên Cloud.
- Session loader nạp effective permission sources.
- Admin không còn HRM implicit bypass ở frontend/backend.
- Direct sensitive grants bị chặn; C3/C4 chỉ được mở qua HR template.

### Admin HR authorization

- Panel bốn tab:
  - Tổng quan.
  - Vai trò nghiệp vụ.
  - Quyền hiệu lực.
  - Lịch sử.
- RPC:
  - `get_user_hr_authorization`
  - `preview_user_hr_business_role`
  - `set_user_hr_business_role`
- System Admin self-grant/self-revoke `HR_MANAGE` đã hoạt động.

### Permission Health và security cutover

- Có các finding cho anon/broad policy/raw table/template drift/manager readiness/legacy resolver.
- Sensitive raw tables đã deny-by-default.
- Frontend phải dùng projection RPC, không được cấp lại raw table để tránh lỗi.

### Organization, staffing và manager

- Capability đã tách thành organization view/manage, staffing view/manage/assign/set_manager và master data.
- Mutation yêu cầu reason/source reference/audit.
- Cloud hiện có 45 nhân sự active.
- Trạng thái readiness đã kiểm tra trước đây:
  - 45 active employees.
  - 3 primary assignments hợp lệ.
  - 42 nhân sự thiếu primary assignment.
  - 20 đơn vị thiếu manager.
- Do đó `direct_reports` vẫn phải xem là chưa sẵn sàng để rollout rộng.

### Hồ sơ 8 tab và import/export

- Projection/mutation theo từng domain đã triển khai.
- C3/C4 không dùng generic JSON update.
- Workbook 8 data sheets + hướng dẫn, staging/dry-run/audit đã có.
- File nguồn/staging private; export nhạy cảm chỉ HR Manage.

## 6. Ba incident sau cutover đã sửa

### 6.1 Không thể mở hồ sơ người dùng sau đăng nhập

Triệu chứng:

```text
Không thể mở hồ sơ người dùng
Không thể hoàn tất tải hồ sơ người dùng.
```

Root cause:

- Public RPC `get_effective_permission_sources` là invoker và gọi private guarded worker.
- Migration cleanup đã thu hồi EXECUTE của `authenticated` trên worker nên bước tải quyền sau login thất bại.

Fix:

```text
supabase/migrations/20260829013745_auth_effective_permission_rpc_boundary_fix.sql
supabase/tests/auth_effective_permission_boundary_smoke.sql
commit b60f3a5
```

Giữ public/anon bị revoke; chỉ cấp authenticated/service_role vào guarded worker.

### 6.2 Danh mục dùng chung HRM báo không có quyền

Root cause:

- `hrmSharedCatalogService` còn đọc raw table `employees`.
- Sensitive cutover đã thu hồi raw access đúng thiết kế.

Fix:

- Hai loader tổ chức dùng `list_hrm_employee_directory()`.
- Không mở lại raw table access.

Files/commit:

```text
lib/hrmSharedCatalogService.ts
lib/__tests__/hrmSharedCatalogService.test.ts
commit 1dc6481
```

Cloud persona `@admin` trả đủ 45 nhân sự từ projection.

### 6.3 Check-in báo không có quyền

Triệu chứng:

```text
Chưa lưu được chấm công: Bạn không có quyền thực hiện thao tác này.
```

Root cause:

- RPC check-in vẫn hoạt động.
- Upload ảnh xảy ra trước RPC.
- Các HR document/import policy trên `storage.objects` gọi trực tiếp `app_private.has_hrm_template_permission(uuid,text)`.
- Helper tùy ý theo user đã bị revoke khỏi authenticated đúng thiết kế.
- PostgreSQL có thể đánh giá policy HRM khác dù row thuộc bucket `checkin-photos`, khiến mọi persona lỗi ở bước upload.

Fix:

- Đổi 7 storage policy sang actor-bound helper `current_user_has_hrm_template_permission(text)`.
- Không cấp lại direct helper cho authenticated.

Files/commit:

```text
supabase/migrations/20260829022431_hrm_storage_policy_actor_boundary_fix.sql
supabase/tests/hrm_checkin_persona_smoke.sql
commit 31164b7
```

Đã smoke bằng `@admin` HR Manage và một Employee thật; cả upload ảnh lẫn check-in đều thành công trong transaction rollback.

## 7. Công việc cần tiếp tục ngay — menu HRM cho Employee

Ảnh người dùng gửi cho thấy tài khoản thường chỉ thấy:

- Hồ sơ cá nhân.
- Dashboard NS.
- Hồ sơ nhân sự.

Đánh giá đã thống nhất: menu này chưa đúng.

### Root cause đã xác định

`BUSINESS_USER` hiện có các quyền HRM mặc định:

```text
hrm.employee.view_directory global
hrm.employee.view_profile own
hrm.employee.edit_profile own
hrm.attendance.view own
hrm.leave.view own
```

Trong `components/Sidebar.tsx`, item được lọc qua `canAccessRoute(user, item.to)`.

Trong `lib/routeAccess.ts`, route HRM gọi `canViewRoute` mà không truyền scope. Permission service mặc định kiểm scope `global`, vì vậy:

- `hrm.attendance.view own` không mở `/hrm/checkin` và `/hrm/attendance`.
- `hrm.leave.view own` không mở `/hrm/leave`.

`/hrm/dashboard` lại thuộc module `hrm.employee` cùng `/hrm/employees`. Quyền directory global khiến Business User nhìn thấy Dashboard NS, dù `pages/hrm/HrmDashboard.tsx` là dashboard HR toàn công ty và có tile/thống kê payroll, hợp đồng, nghỉ phép, chấm công toàn bộ nhân sự.

### Menu mặc định mong muốn cho Employee

1. `Tổng quan của tôi` → `/employee-dashboard`.
2. `Hồ sơ của tôi` → `/my-profile`.
3. `Danh bạ nhân sự` → `/hrm/employees`, chỉ C1 directory.
4. `Check-in / Check-out` → `/hrm/checkin`, scope own.
5. `Chấm công của tôi` → `/hrm/attendance`, scope own; có lịch sử và đề nghị điều chỉnh.
6. `Nghỉ phép của tôi` → `/hrm/leave`, scope own; có số dư, tạo đơn và lịch sử.
7. `Lịch/ca làm việc của tôi` nên là projection/read-only trong dashboard hoặc hồ sơ; không mở màn quản trị `Ca làm việc` cho Employee.

### Không mở mặc định trong V1

- Bảng lương.
- Hợp đồng.
- Pháp lý/bảo hiểm.
- Hồ sơ tài liệu nhạy cảm.
- Báo cáo HR toàn công ty.
- Quản trị ca làm việc/master data.
- Danh mục dùng chung HRM.

Own payslip/own contract có thể là roadmap sau V1 nhưng phải dùng projection riêng và thay đổi quyết định self-service C3/C4.

### Manager menu sau readiness

Khi readiness đạt mới mở động:

- Đội ngũ của tôi.
- Chấm công cấp dưới.
- Duyệt nghỉ phép cấp dưới.

Không cấp manager role thủ công và không dùng `users.manager_id` làm authorization fallback.

### Hướng triển khai đề xuất

1. Viết test persona cho route/menu trước khi sửa:
   - BUSINESS_USER có own attendance/leave nhìn thấy check-in, chấm công, nghỉ phép.
   - BUSINESS_USER không vào `/hrm/dashboard` HR-wide.
   - HR và HR Manage vào được `/hrm/dashboard`.
   - Employee không thấy payroll/contracts/documents/reports/master-data.
2. Sửa route scope cho ba route own:
   - `/hrm/checkin`
   - `/hrm/attendance`
   - `/hrm/leave`
3. Không dùng Admin blanket bypass cho `hrm.*`.
4. Chuyển menu Employee từ `Dashboard NS` sang `/employee-dashboard` với nhãn `Tổng quan của tôi`.
5. Đổi nhãn `Hồ sơ nhân sự` thành `Danh bạ nhân sự` cho persona Employee.
6. Guard `/hrm/dashboard` bằng quyền/template HR phù hợp, không chỉ `view_directory`.
7. Rà `pages/EmployeeDashboard.tsx` để không hiển thị shortcut/payload C3/C4 trái quyết định V1.
8. Giữ deep-link authorization ở `SubModuleGuard`, không chỉ ẩn menu.

Các file trọng tâm:

```text
components/Sidebar.tsx
components/UserModal.tsx
lib/routeAccess.ts
lib/permissions/permissionService.ts
lib/permissions/erpPermissionRegistry.ts
pages/hrm/HrmDashboard.tsx
pages/EmployeeDashboard.tsx
App.tsx
constants/routes.ts
lib/__tests__/routeAccess.test.ts
```

Lưu ý: `components/UserModal.tsx` còn chứa cấu hình sub-module legacy. Không để save system role/direct grants vô tình xóa business-role assignment.

## 8. Supabase Cloud hiện tại

Project ref:

```text
ftciqmqhmfvjtwoycswe
```

Các migration cuối đang khớp local/remote:

```text
20260828104500
20260828104600
20260828104700
20260828104800
20260828104900
20260828105000
20260828105100
20260828105200
20260829013745
20260829022431
```

Quy trình migration đang dùng:

1. Tạo file bằng CLI, không tự đặt timestamp:

```bash
npx supabase migration new <migration_name>
```

2. Apply lên Cloud qua pooler URL và password trong `.env`; không in secret ra log.
3. Verify bằng JWT persona dưới role `authenticated`, không lấy role `postgres` làm bằng chứng duy nhất.
4. Repair đúng một version sau khi migration đã apply và verify.
5. Chạy Permission Health và advisors.

## 9. Verification gần nhất

Sau incident check-in:

```text
npm run lint: passed
npm test: 317 files, 1531 tests passed
npm run build: passed
hrm_checkin_persona_smoke.sql: passed for Admin HR Manage + Employee
hrm_permission_health_smoke.sql: passed
Security Advisor: 0 Error
Performance Advisor: 0 Error
```

Build chỉ có cảnh báo chunk size đã tồn tại, không phải lỗi.

Các lệnh cần chạy sau thay đổi tiếp theo:

```bash
npm run lint
npm test
npm run build
```

Nếu đụng Supabase/authorization, chạy thêm các smoke liên quan bằng Cloud connection và JWT persona:

```text
supabase/tests/auth_effective_permission_boundary_smoke.sql
supabase/tests/hrm_checkin_persona_smoke.sql
supabase/tests/hrm_permission_health_smoke.sql
supabase/tests/hrm_business_role_self_grant_smoke.sql
supabase/tests/hrm_personnel_profile_persona_smoke.sql
```

## 10. Các điểm không được suy diễn sai ở phiên mới

- Tab `Dữ liệu gốc HRM` không bị xóa; đã gộp/đổi tên thành `Danh mục dùng chung HRM`.
- Tab này chỉ hiện khi có organization/master-data permission từ HR template.
- Tài khoản `@admin` hiện đã có `HR_MANAGE` global, hết hạn 01/01/2030 theo giờ nhập ở UI.
- Việc System Admin không thấy dữ liệu HR trước self-grant là đúng thiết kế.
- Lỗi danh mục HRM trước đây không được chữa bằng grant raw `employees`.
- Lỗi check-in trước đây không được chữa bằng cấp direct helper tùy ý theo user.
- Employee Dashboard và HR Dashboard là hai persona khác nhau; không dùng chung route chỉ vì đều có chữ “Dashboard NS”.
- Không đánh dấu manager readiness đạt khi 42/45 nhân sự còn thiếu primary assignment.

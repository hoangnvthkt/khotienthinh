# Audit hệ thống phân quyền ERP VIOO

Ngày audit: 2026-07-12  
Phạm vi: đọc code frontend, service layer, Supabase migrations, RLS policies, RPC/Edge Functions trong repository. Không thay đổi code nghiệp vụ, migration, RLS hoặc dữ liệu.

## 1. Tóm tắt điều hành

Hệ thống phân quyền VIOO hiện là kiến trúc lai gồm:

- Supabase Auth xác thực phiên đăng nhập.
- Bảng `public.users` làm nguồn sự thật cho app role và quyền module.
- Frontend route/menu guard dựa trên `allowedModules`, `allowedSubModules`, `adminModules`, `adminSubModules`.
- Supabase RLS/RPC bảo vệ một phần dữ liệu và workflow quan trọng.
- Project PBAC riêng cho module Dự án qua `project_staff`, `project_permission_types`, `project_staff_permissions`.

Kết luận chính:

- Có một lỗ hổng Critical ở `public.users`: user authenticated được phép update chính row của mình, trong khi row đó chứa `role`, `admin_modules`, `admin_sub_modules`, `allowed_modules`, `allowed_sub_modules`, `is_active`. Các hàm `is_admin()` và `is_module_admin()` lại tin các trường này. Đây là điểm gốc có thể làm suy yếu mọi policy phụ thuộc vào app role.
- Một số bảng master/operations của Project, Work Group và Quality đang có RLS bật nhưng policy mở cho `anon`/`authenticated`. Đây không phải chỉ là UI issue; API Data API có thể bị dùng trực tiếp nếu policy runtime đúng như migration.
- Module Dự án có hệ PBAC tốt hơn các module khác, nhưng permission code đang dùng chung quá rộng (`submit`, `verify`, `confirm`, `approve`...), có fallback default-allow khi chưa setup PBAC, và tab-admin toàn cục chưa tách theo từng project.
- Daily Log là case study có nhiều lớp guard tốt: frontend PBAC, RPC chuyển trạng thái, kiểm tra người xác nhận. Tuy vậy vẫn có khoảng trống ở fallback no-staff, generic permission code, delete returned/draft owner, và `daily_logs_update WITH CHECK` còn rộng.
- Frontend route guard đang allow route không có trong `ROUTE_TO_MODULE`, nên menu ẩn không đồng nghĩa với route bị chặn.

Mức độ ưu tiên khuyến nghị:

1. Vá `public.users` self-update và khóa cột phân quyền.
2. Thu hồi `anon` CRUD và policy mở ở Project master, Work Group, Quality.
3. Tách permission code theo module/action cụ thể cho Project PBAC.
4. Chuyển các mutation quan trọng sang RPC có kiểm tra actor.
5. Đổi route guard sang deny-by-default cho route không map.

## 2. Phạm vi và phương pháp

Đã đọc và đối chiếu:

- Route/menu/user permission: `App.tsx`, `constants/routes.ts`, `components/Sidebar.tsx`, `hooks/usePermission.ts`, `lib/routeAccess.ts`, `components/UserModal.tsx`, `lib/settingsPermissions.ts`.
- App context và service layer: `context/AppContext.tsx`, `lib/projectStaffService.ts`, `lib/projectService.ts`, `lib/projectMasterService.ts`, `lib/wmsPermissions.ts`, `lib/projectDocumentPolicy.ts`.
- Module Dự án: `pages/ProjectDashboard.tsx`, `lib/projectTabPermissions.ts`, `pages/project/*`, `components/project/*`.
- Supabase migrations: 216 files under `supabase/migrations`.
- Edge Functions có service role: `supabase/functions/create-user/index.ts`, `supabase/functions/reset-password/index.ts`.

Nhãn độ chắc chắn dùng trong báo cáo:

- Confirmed from code: có bằng chứng trực tiếp trong repository.
- Reasoned inference: suy luận hợp lý từ code/migration nhưng cần runtime test để chứng minh exploit hoàn chỉnh.
- Insufficient data: cần query DB live (`pg_policies`, grants hiện tại, dữ liệu mẫu, user thực tế) hoặc test môi trường deployed.

## 3. Kiến trúc phân quyền hiện tại

### 3.1 Xác thực

Confirmed from code:

- `ProtectedRoute` trong `App.tsx` dùng `supabase.auth.getSession()` và `supabase.auth.getUser()` để xác nhận phiên.
- `login()` trong `context/AppContext.tsx` đăng nhập bằng `supabase.auth.signInWithPassword()`, sau đó fetch profile từ `public.users` theo `auth_id` hoặc email.
- Frontend chỉ dùng `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY`; chưa thấy service role key trong frontend code. Service role chỉ xuất hiện trong Edge Functions.

### 3.2 Nguồn sự thật app permission

Confirmed from code:

- `Role` chỉ có 3 giá trị: `ADMIN`, `WAREHOUSE_KEEPER`, `EMPLOYEE` (`types.ts`).
- `User` chứa các trường quyền chính:
  - `role`
  - `assignedWarehouseId`
  - `allowedModules`
  - `adminModules`
  - `allowedSubModules`
  - `adminSubModules`
  - `isActive`
- `mapUserFromDb()` map các cột DB tương ứng từ `public.users`.
- `public.is_admin()` và `public.is_module_admin(text)` đọc trực tiếp từ `public.users`.

### 3.3 Frontend guard

Confirmed from code:

- `SubModuleGuard` trong `App.tsx`:
  - Admin bypass.
  - `/settings` và `/users` bypass route guard chính.
  - Route có module trong `ROUTE_TO_MODULE` thì check module/submodule.
  - Route không nằm trong map thì allow.
- `lib/routeAccess.ts` mirror logic này và cũng allow route không map.
- `hooks/usePermission.ts` dùng `canManage(route)` cho CRUD/master data; logic này lại trả `false` nếu route không map.
- `Sidebar` chỉ lọc hiển thị module/nav item; không phải lớp bảo mật.

### 3.4 Backend guard

Confirmed from code:

- Có nhiều RLS/RPC đã harden:
  - `process_transaction_status` cho WMS transaction.
  - `transition_daily_log_status` cho Daily Log.
  - Project document step helpers trong schema `app_private`.
  - Request RLS cho `requests` theo owner/current handler/WMS/project permission.
  - Expense RLS write/delete yêu cầu Admin hoặc module admin `EX`.
- Nhưng có nhiều bảng vẫn có policy mở hoặc `WITH CHECK(true)`.

## 4. Số liệu định lượng

Confirmed from local search:

| Nhóm | Số lượng |
| --- | ---: |
| Migration files | 216 |
| `CREATE POLICY` trong migrations | 749 |
| `DROP POLICY` trong migrations | 670 |
| `ENABLE ROW LEVEL SECURITY` trong migrations | 245 |
| `CREATE OR REPLACE FUNCTION` trong migrations | 425 |
| `SECURITY DEFINER` trong migrations | 351 |
| `GRANT EXECUTE` trong migrations | 208 |
| App routes trong `App.tsx` | 77 |
| Literal route map keys trong `ROUTE_TO_MODULE` | 66 |
| Frontend/source files có pattern phân quyền | 113 |
| Broad true policy matches (`USING(true)`/`WITH CHECK(true)`/similar) | 69 |

Insufficient data:

- Các con số migration không đảm bảo chính xác 100% runtime vì migration sau có thể drop/recreate policy. Cần query live DB để snapshot `pg_policies` hiện tại.

## 5. Inventory module và nguồn quyền

| Module | Frontend module key | Lớp quyền chính | Ghi chú audit |
| --- | --- | --- | --- |
| WMS/Vật tư | `WMS` | Role `WAREHOUSE_KEEPER`, assigned warehouse, WMS route/admin module, RPC | Transaction status có RPC tốt; request view frontend rộng cho project request nhưng backend request RLS đã harden hơn. |
| HRM | `HRM` | Route/submodule/admin module | Chưa deep-test toàn bộ RLS HRM trong audit này. |
| Workflow | `WF` | Route/submodule/admin route templates | Builder có special-case route. |
| Dự án | `DA` | Route tab permission + Project PBAC + document policy/RLS | Phần phức tạp nhất; có nhiều guard tốt nhưng permission dùng chung và fallback mở. |
| Procurement | `PROCUREMENT` | Route module + WMS/project request service | Phụ thuộc request/RLS/WMS. |
| Tài sản | `TS` | Route module + module admin | Có migration hardening WMS/assets ở lịch sử. |
| Yêu cầu | `RQ` | Route module + request workflow logic | Cần audit riêng RLS runtime. |
| Chi phí | `EX` | Route module + `is_module_admin('EX')` write policy | Write/delete đã có migration hardening. |
| Hồ sơ NV | `EP` | Route module | Route-level. |
| Hợp đồng | `HD` | Route module + project/contract component permissions | Một số panel Project dùng generic PBAC. |
| Tender AI | `TENDER_AI` | Route module | Route-level. |
| Storage/KB/AI/Analytics/Audit Trail | various | Route module/submodule | Cần review RLS riêng nếu chứa dữ liệu nhạy cảm. |
| Settings | `SETTINGS` | Settings feature token `/settings/<feature>` | Route bypass nhưng component filter feature; backend `users` hiện là điểm yếu. |

## 6. Findings Critical

### CRIT-001: User tự nâng quyền qua `public.users` self-update

Severity: Critical  
Confidence: Confirmed from code

Bằng chứng:

- `public.is_admin()` đọc `u.role = 'ADMIN'` từ `public.users`.
- `public.is_module_admin(p_module)` đọc `role`, `admin_modules`, `admin_sub_modules` từ `public.users`.
- Policy `users_update` cho phép:
  - `public.is_admin()`
  - hoặc `id = public.current_app_user_id()`
  - cả `USING` và `WITH CHECK`
- `public.users` grant `select, insert, update, delete` cho `authenticated`.
- Frontend `updateUser()` update payload user trực tiếp vào `public.users`.

Tác động:

- Một authenticated user có thể direct-update chính row của mình để đổi `role = 'ADMIN'` hoặc thêm `admin_modules`/`admin_sub_modules`.
- Sau đó các policy/RPC dựa trên `is_admin()` hoặc `is_module_admin()` có thể coi user đó là admin.
- Edge Functions `create-user` và `reset-password` cũng kiểm tra admin bằng `appUser.role === 'ADMIN'`; nếu app role đã bị tự nâng, lớp này bị suy yếu.

Rủi ro lan truyền:

- Project PBAC admin (`is_module_admin('DA')`).
- WMS RPC (`is_module_admin('WMS')`).
- Expense RLS (`is_module_admin('EX')`).
- User management.
- Settings/admin UI sau khi reload profile.

Khuyến nghị:

- Tách self-profile update khỏi admin update.
- Chỉ cho user tự update các cột vô hại như avatar, phone, signature, preference.
- Cấm self-update các cột: `role`, `allowed_modules`, `admin_modules`, `allowed_sub_modules`, `admin_sub_modules`, `is_active`, `auth_id`, `email` nếu chưa qua flow xác minh.
- Thêm trigger `BEFORE UPDATE` để reject thay đổi cột quyền khi actor không phải admin và không phải RPC được phép.
- Di chuyển admin user mutations sang SECURITY DEFINER RPC có audit log.

### CRIT-002: `projects` cho phép CRUD với `anon` và `authenticated`

Severity: Critical  
Confidence: Confirmed from migration; runtime current policy cần xác nhận

Bằng chứng:

- Migration `20260501084303_project_master_optional_site.sql`:
  - `GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO anon, authenticated`
  - Policy select/insert/update/delete dùng `auth.role() IN ('anon', 'authenticated')`.
- `projectMasterService` ghi trực tiếp vào `projects` bằng Supabase client.

Tác động:

- Nếu policy này là policy runtime hiện tại, người chưa đăng nhập nhưng có anon key hợp lệ có thể tạo/sửa/xóa project master qua API.
- Authenticated user không có quyền DA cũng có thể mutate project master bằng direct API.
- UI `canManageProjects` chỉ ẩn nút, không đủ bảo vệ backend.

Khuyến nghị:

- Revoke CRUD từ `anon`.
- `SELECT` tối thiểu chỉ `authenticated` và theo visibility cần thiết.
- `INSERT/UPDATE/DELETE` yêu cầu Admin hoặc `is_module_admin('DA')`.
- Nếu project-level admin cần chi tiết hơn, tạo RPC `create_project`, `update_project`, `hide_project`, `restore_project`.

### CRIT-003: Project master categories mở cho `anon`/`authenticated`

Severity: Critical  
Confidence: Confirmed from migration; runtime current policy cần xác nhận

Bảng:

- `project_groups`
- `project_types`
- `project_sectors`

Bằng chứng:

- Migration `20260505052902_add_project_master_categories.sql` grant CRUD cho `anon, authenticated`.
- Policies select/insert/update/delete cho phép `auth.role() IN ('anon','authenticated')`.

Tác động:

- Danh mục phân loại project có thể bị tạo/sửa/xóa ngoài UI.
- Có thể phá filter, workflow template mapping, báo cáo, phân quyền theo nhóm dự án.

Khuyến nghị:

- Revoke `anon` toàn bộ.
- Write/delete yêu cầu Admin hoặc `is_module_admin('DA')`.
- Nếu cần user thường đọc danh mục, chỉ grant `SELECT` cho `authenticated`.

### CRIT-004: Work Groups mở cho `anon`/`authenticated`

Severity: Critical  
Confidence: Confirmed from migration; runtime current policy cần xác nhận

Bảng:

- `work_groups`
- `work_group_members`

Bằng chứng:

- Migration `20260505080126_add_work_groups.sql` grant CRUD cho `anon, authenticated`.
- Policies select/insert/update/delete dùng `auth.role() IN ('anon','authenticated')`.

Tác động:

- Nhóm làm việc và membership có thể bị sửa ngoài UI.
- Nếu work groups được dùng làm nguồn gán người xử lý, báo cáo hoặc workflow, đây là đường sửa phân công gián tiếp.

Khuyến nghị:

- Revoke `anon`.
- Write/delete yêu cầu Admin hoặc settings feature admin tương ứng.
- Tách read membership theo nguyên tắc least privilege nếu có dữ liệu nhạy cảm.

### CRIT-005: Quality/Inspection tables có policy `for all to anon, authenticated using(true) with check(true)`

Severity: Critical  
Confidence: Confirmed from migration; runtime current policy cần xác nhận

Bảng trong migration:

- `quality_checklists`
- `quality_inspection_attempts`
- `inspection_categories`
- `inspection_work_types`
- `inspection_templates`
- `template_sections`
- `inspection_template_items`
- `quality_checklist_templates`

Bằng chứng:

- Migration `20260614125920_fix_quality_module_rls.sql` grant CRUD cho `anon, authenticated`.
- Tạo policy `quality_module_all` cho all operations với `using (true) with check (true)`.

Tác động:

- Dữ liệu nghiệm thu/chất lượng có thể bị tạo/sửa/xóa trực tiếp, kể cả không qua Project tab permission.
- Đây là rủi ro integrity nghiêm trọng vì Quality thường liên quan nghiệm thu, bằng chứng công trường, template kiểm tra.

Khuyến nghị:

- Revoke `anon`.
- Tách template master data khỏi checklist/attempt phát sinh.
- Write template yêu cầu Admin/DA quality admin.
- Checklist/attempt write yêu cầu project permission cụ thể như `quality.create`, `quality.verify`, `quality.approve`.
- Bổ sung audit log bắt buộc.

## 7. Findings High

### HIGH-001: Project PBAC dùng permission code chung quá rộng

Severity: High  
Confidence: Confirmed from code

Permission codes hiện có:

- `view`
- `edit`
- `delete`
- `submit`
- `verify`
- `confirm`
- `approve`
- `view_available_stock`

Bằng chứng:

- `ProjectPermissionCode` trong `lib/projectStaffService.ts`.
- `project_permission_types` seed các code generic, `module` có nhưng không được dùng để scope check trong `checkProjectPermission()`.
- `checkProjectPermission()` lookup permission type bằng `.eq('code', normalizedCode)` và không filter `module`.
- `normalizeProjectPermissionCode()` map `reject`/`returned` thành `verify`, `paid` thành `confirm`.

Tác động:

- User có `verify` cho Daily Log có thể bị hiểu là có quyền verify ở nghiệp vụ khác nếu component/backend dùng cùng code.
- `approve` có thể đồng thời nghĩa là duyệt Daily Log, duyệt payment, duyệt material, rollback/cancel.
- `confirm` có thể nghĩa là xác nhận nghiệp vụ, xác nhận khối lượng, xác nhận thanh toán, paid.

Khuyến nghị:

- Đổi sang action code có namespace:
  - `daily_log.submit`
  - `daily_log.verify`
  - `daily_log.approve`
  - `material_request.submit`
  - `material_request.approve`
  - `payment_certificate.confirm`
  - `payment_certificate.approve`
  - `quality.checklist.create`
  - `quality.checklist.verify`
- Dùng `module`/`resource_type` trong DB check, không chỉ `code`.
- Migration chuyển đổi quyền cũ sang quyền mới theo mapping explicit.

### HIGH-002: PBAC Project default-allow khi chưa setup staff

Severity: High  
Confidence: Confirmed from code

Bằng chứng:

- `projectStaffService.requireProjectPermission()` trả allow nếu `hasProjectPbac()` false.
- `DailyLogTab` grant all daily log permissions nếu không có staff/PBAC setup.
- `daily_log_user_has_project_permission()` trong migration trả true nếu scope không có staff.
- Nhiều helper Daily Log cho phép thao tác khi `not daily_log_scope_has_staff(...)`.

Tác động:

- Project mới hoặc project chưa cấu hình tổ chức có thể mặc định mở thao tác.
- Khi rollout PBAC từng phần, module chưa cấu hình staff có thể bypass permission mà UI vẫn trông “đã có phân quyền”.

Khuyến nghị:

- Đổi default từ allow sang deny cho mutation.
- Cho phép fallback chỉ trong giai đoạn migration qua feature flag có expiry.
- Thêm trạng thái `pbac_enforced` per project/site và dashboard báo project chưa cấu hình PBAC.

### HIGH-003: Route guard allow route không có trong `ROUTE_TO_MODULE`

Severity: High  
Confidence: Confirmed from code

Bằng chứng:

- Comment trong `constants/routes.ts`: route không có map thì guard bỏ qua.
- `SubModuleGuard`: `if (!moduleKey) return children`.
- `canAccessRoute`: `if (!moduleKey) return true`.

Route đáng chú ý chưa map hoặc được bypass:

- `/trace`
- `/feedback`
- `/leaderboard`
- `/notifications`
- `/my-profile`
- `/employee-dashboard`
- `/safety-card/:qrToken`

Lưu ý:

- Một số route như `my-profile` có thể chủ ý mở cho mọi user.
- Nhưng deny-by-default nên là rule, sau đó whitelist explicit route public/authenticated-self.

Khuyến nghị:

- Đổi guard sang deny-by-default cho protected routes không map.
- Thêm `PUBLIC_AUTH_ROUTES` hoặc `SELF_SERVICE_ROUTES`.
- Thêm test so sánh tất cả `<Route path>` với `ROUTE_TO_MODULE`/whitelist.

### HIGH-004: `users_select` cho mọi authenticated user đọc toàn bộ users

Severity: High  
Confidence: Confirmed from code

Bằng chứng:

- `users_select` policy: `to authenticated using (true)`.
- Bootstrap/login fetch all users bằng `.from('users').select('*')`.

Tác động:

- Mọi authenticated user có thể đọc email, phone, role, module grants, admin grants, active state và metadata user.
- Đây là privacy issue và cũng hỗ trợ attacker enumerate admin accounts/permission layout.

Khuyến nghị:

- Tách `profiles_public` view chỉ chứa field tối thiểu.
- Chỉ Admin/settings users admin được đọc full `users`.
- Self chỉ đọc chính mình.
- Các service cần name/avatar dùng view riêng hoặc RPC lookup hạn chế.

### HIGH-005: Project tab-admin là global theo route, không theo project

Severity: High  
Confidence: Confirmed from code

Bằng chứng:

- `canManageProjectTab(tabKey)` kiểm `adminModules.DA` hoặc `adminSubModules.DA` route `/da/tabs/...`.
- Giá trị này truyền xuống mọi tab của ProjectDashboard.
- PBAC project/site chạy riêng ở từng component.

Tác động:

- User có quyền admin tab `dailylog` hoặc `material` là quyền theo route/global, không theo project.
- Nếu backend component chỉ dựa `canManageTab`, quyền có thể áp dụng toàn bộ dự án.
- Dễ nhầm giữa “quản trị tab” và “được thao tác project cụ thể”.

Khuyến nghị:

- Tách `tab visibility`, `tab admin global`, `project action permission`.
- Mọi mutation phát sinh phải check PBAC theo `project_id`/`construction_site_id`.
- Tab admin chỉ cho quản trị cấu hình UI/master, không thay thế action permission.

### HIGH-006: `daily_logs_update WITH CHECK` quá rộng so với workflow invariant

Severity: High  
Confidence: Confirmed from migration; exploit cần runtime test

Bằng chứng:

- Latest migration `20260705115421_daily_log_verify_can_create_source_logs.sql`:
  - `USING` có nhiều điều kiện permission/owner/summary.
  - `WITH CHECK` chỉ yêu cầu `project_id is not null or construction_site_id is not null or public.is_admin()`.
- `dailyLogService.updateStatus()` có nhánh direct update khi reject log đã `verified`, không đi qua RPC `transition_daily_log_status`.

Tác động:

- Khi actor pass `USING`, `WITH CHECK` không khóa invariant mới của row như status, owner, submitted_to_user_id, submitted_to_permission.
- Direct API update có thể tạo trạng thái không hợp lệ nếu không bị trigger khác chặn.

Khuyến nghị:

- Bắt buộc status transition qua RPC.
- RLS update `WITH CHECK` mirror invariant của `USING` và workflow state.
- Thêm trigger validate status transition cho `daily_logs`.
- Loại bỏ hoặc giới hạn nhánh direct update reject verified.

### HIGH-007: Một số bảng finance/payment từng có policy mở trong migration lịch sử

Severity: High  
Confidence: Confirmed migration history; runtime current policy cần xác nhận

Bằng chứng:

- Migration `20260429_fastcons_boq_payment.sql` tạo policy `USING(true)`/`WITH CHECK(true)` cho:
  - `contract_items`
  - `payment_certificates`
  - `advance_payments`
  - `project_cost_items`
- Migration sau `project_document_step_permissions_v1` harden một số bảng như `payment_certificates`, nhưng cần xác nhận bảng nào còn policy cũ runtime.

Tác động:

- Nếu bảng finance nào còn broad policy, rủi ro integrity và financial data rất cao.

Khuyến nghị:

- Query live:
  - `select * from pg_policies where schemaname='public' and tablename in (...)`
  - `select * from information_schema.role_table_grants ...`
- Đảm bảo mọi bảng tài chính dùng project document policy hoặc RPC.

## 8. Findings Medium

### MED-001: Logic phân quyền phân tán nhiều nơi

Severity: Medium  
Confidence: Confirmed from code

Nguồn logic:

- `App.tsx` route guard.
- `lib/routeAccess.ts`.
- `hooks/usePermission.ts`.
- `components/Sidebar.tsx`.
- `lib/settingsPermissions.ts`.
- `pages/ProjectDashboard.tsx`.
- `lib/projectStaffService.ts`.
- `lib/projectDocumentPolicy.ts`.
- Component-level checks trong `pages/project/*` và `components/project/*`.

Tác động:

- Dễ drift giữa menu, route, CRUD button và backend RLS.
- Fix ở một nơi không đảm bảo fix toàn hệ thống.

Khuyến nghị:

- Tạo `permissionRegistry` typed.
- Có test coverage route/menu/action/RLS contract.

### MED-002: Settings route bypass guard chính

Severity: Medium  
Confidence: Confirmed from code

Bằng chứng:

- `SubModuleGuard` cho `/settings` và `/users` bypass.
- `Settings` component filter tabs bằng `canAccessSettingsFeature`.

Đánh giá:

- Đây không phải lỗ mở toàn bộ vì component có filter.
- Nhưng route-level và backend-level nên nhất quán hơn, đặc biệt với user management.

Khuyến nghị:

- Map `/settings` vào guard bình thường.
- Whitelist `/settings/account`.
- Các feature còn lại dùng `/settings/<feature>` token và backend policy tương ứng.

### MED-003: Permission clipboard trong UserModal có thể paste cấu hình admin

Severity: Medium  
Confidence: Confirmed from code

Đánh giá:

- Đây chủ yếu là UX/admin safety issue nếu chỉ admin/settings admin mở được.
- Nhưng khi `users_update` bị self-escalation, clipboard/paste làm việc cấp quyền sai dễ hơn.

Khuyến nghị:

- Backend reject mọi grant quyền nếu actor không phải admin thật.
- UI thêm diff preview và require confirmation khi paste grant admin.

### MED-004: Edge Functions tin role từ app table thay vì verified claim bất biến

Severity: Medium; tăng lên High khi kết hợp CRIT-001  
Confidence: Confirmed from code

Bằng chứng:

- `create-user` dùng service role nhưng `requireAdmin()` check `appUser.role === 'ADMIN'`.
- `reset-password` check `appUser.role === 'ADMIN'`.

Khuyến nghị:

- Sau khi khóa `users`, có thể chấp nhận.
- Tốt hơn: dùng custom claims/app_metadata hoặc RPC `assert_admin_actor()` có audit, column hardening và session validation.

## 9. Deep dive module Dự án

### 9.1 Cây module/tab

Confirmed from code:

Root:

- `/da`
- `/da/portfolio`

Project overview tabs:

- `executive`
- `org`
- `finance`
- `budget`
- `cashflow`
- `contract`
- `gantt`
- `weekly_progress`
- `dailylog`
- `material`
- `quality`
- `safety`
- `subcontract`
- `documents`
- `report`
- `payment`

Material sub-tabs:

- `summary`
- `boq`
- `planning`
- `request`
- `custom`
- `po`
- `waste`
- `dashboard`

Route permission tokens:

- Overview tabs dùng `/da/tabs/<tab>`.
- Material sub-tabs dùng `/da/tabs/material/<subtab>`.

### 9.2 Hai hệ quyền song song

Confirmed from code:

1. Route/tab permission:
   - Lưu trong `allowedSubModules.DA` và `adminSubModules.DA`.
   - Quyết định tab nào được xem/quản trị trong ProjectDashboard.
   - Global theo user, không scope theo project.

2. Project PBAC:
   - `project_staff` gán user vào project/site.
   - `project_staff_permissions` gán action permission.
   - `project_permission_types` chứa code permission.
   - Một số component check PBAC theo `projectId`/`constructionSiteId`.

Rủi ro:

- Người vận hành có thể hiểu “được quản trị tab Daily Log” là chỉ trong project A, nhưng code hiện là global route admin.
- Người có PBAC `verify` trong project A có thể dùng cùng permission code ở nhiều nghiệp vụ trong project đó, tùy component.

### 9.3 Ma trận đánh giá Project tabs

| Tab | Quyền frontend | Backend/RLS/RPC quan sát được | Đánh giá |
| --- | --- | --- | --- |
| `executive` | View tab | Chủ yếu read/aggregate | Rủi ro thấp hơn, cần RLS read scope. |
| `org` | `canManageProjectTab('org')` | PBAC tables write require `is_module_admin('DA')` | Tốt hơn ở backend nhưng phụ thuộc CRIT-001. |
| `finance`/`budget`/`cashflow` | Tab admin finance/budget/cashflow | Finance/payment migrations mixed; cần live policy snapshot | Cần hardening và kiểm runtime. |
| `contract` | `canManageTab` + component checks | Một số panel dùng PBAC generic | Cần tách permission contract-specific. |
| `gantt` | `canManageTab` + PBAC generic | Task completion document policy | Tương đối tốt nhưng generic permission. |
| `weekly_progress` | `canManageTab` | Chủ yếu component-level | Cần backend invariant. |
| `dailylog` | `canManageTab` + PBAC + RPC | `transition_daily_log_status`, RLS daily_logs | Tốt nhất nhưng còn fallback và WITH CHECK rộng. |
| `material` | Material tab/subtab permission + PBAC | Requests/custom material RLS tốt hơn; WMS RPC | Tương đối tốt, nhưng shared permission. |
| `quality` | `canManageTab` + một số PBAC call | Quality tables policy mở trong migration | Critical backend gap. |
| `safety` | `canManageTab` | Cần audit RLS safety riêng | Chưa đủ dữ liệu để kết luận mạnh. |
| `subcontract` | `canManageTab` | Contract/subcontract service | Cần audit RLS riêng. |
| `documents` | `canManageTab` | Storage/RLS chưa audit sâu | Insufficient data. |
| `report` | View tab | Read/aggregate | Rủi ro phụ thuộc read RLS. |
| `payment` | `canManageTab` + PBAC generic | Payment certificate panels use PBAC; migration history mixed | High priority live policy check. |

## 10. Quyền dùng chung trong Project

Confirmed from code:

Các permission code dùng chung trong nhiều module:

- `view`
- `edit`
- `delete`
- `submit`
- `verify`
- `confirm`
- `approve`

Nơi sử dụng quan sát được:

- Daily Log.
- Gantt/task completion.
- BOQ reconciliation.
- Quantity acceptance.
- Payment certificate.
- Contract variation.
- Contract payment schedule.
- Contract item table.
- Quality checklist.
- Material/custom material request.
- Project document policy generic.

Các xung đột ngữ nghĩa:

- `verify`: xác nhận nhật ký, trả lại/reject, xác nhận kỹ thuật, quantity/quality review.
- `approve`: duyệt cuối, duyệt Daily Log theo `submittedToPermission='approve'`, duyệt payment/material, rollback/cancel trong policy.
- `confirm`: xác nhận nghiệp vụ, xác nhận thanh toán, `paid` map thành `confirm`.
- `submit`: gửi nhật ký, gửi nghiệm thu, gửi material/payment vào workflow.

Khuyến nghị thiết kế:

- `permission_type` nên có các cột:
  - `module`
  - `resource_type`
  - `action`
  - `scope_level`
  - `workflow_step`
- Unique key nên là `(module, resource_type, action)` thay vì chỉ `code`.
- Service check phải filter theo resource/action cụ thể.

## 11. Case study Daily Log

### 11.1 Điểm mạnh

Confirmed from code:

- Frontend load PBAC per project/site.
- Nếu có PBAC, action check `edit/delete/submit/verify/approve`.
- Chọn verifier có check người được chọn có `verify`.
- Status transition chính dùng RPC `transition_daily_log_status`.
- RPC:
  - Lock row bằng `for update`.
  - Chỉ cho submit từ draft/rejected.
  - Chỉ owner submit nếu không phải admin.
  - Bắt buộc chọn verifier.
  - Check verifier có permission.
  - Chỉ current verifier hoặc admin verify/reject.

Đánh giá:

- Đây là pattern tốt nên nhân rộng: workflow mutation qua RPC có actor validation và transition rules.

### 11.2 Khoảng trống

Confirmed from code:

- Nếu không có staff/PBAC, frontend và SQL helper grant all/fallback allow.
- Permission `verify`/`approve` vẫn là generic project permission.
- Delete policy cho phép owner xóa `draft`/`rejected` mà không check PBAC.
- Latest `daily_logs_update WITH CHECK` không mirror đầy đủ invariant.
- Có nhánh direct update khi reject log đã `verified`.

Khuyến nghị:

- Daily Log nên có permission riêng:
  - `daily_log.create`
  - `daily_log.edit_own`
  - `daily_log.submit_own`
  - `daily_log.verify_assigned`
  - `daily_log.approve_assigned`
  - `daily_log.return_assigned`
  - `daily_log.delete_draft_own`
- Bắt mọi status transition qua RPC.
- No-staff fallback chỉ cho read hoặc disabled trong production.

## 12. Đánh giá RLS/RPC theo nhóm

### Tốt hoặc tương đối tốt

Confirmed from code:

- WMS transaction status:
  - `process_transaction_status` kiểm actor, warehouse keeper scope, stock availability, status transition.
- Project material request:
  - `requests` policies dùng helper `material_request_can_select/write/update/delete`.
  - Revoke `anon`, grant authenticated.
- Expense write:
  - `budget_categories`, `budget_entries`, `expense_records` write/delete yêu cầu `is_admin()` hoặc `is_module_admin('EX')`.
- Project PBAC tables:
  - `project_staff`, `project_staff_permissions`, `project_permission_types` write/delete yêu cầu `is_module_admin('DA')`.

Điểm cần nhớ:

- Tất cả policy phụ thuộc `is_admin()`/`is_module_admin()` bị ảnh hưởng bởi CRIT-001 cho đến khi `users` được khóa.

### Rủi ro cao hoặc mở

Confirmed from migration history:

- `projects`
- `project_groups`
- `project_types`
- `project_sectors`
- `work_groups`
- `work_group_members`
- Quality/inspection tables.
- Một số finance tables trong migration cũ cần snapshot runtime.

## 13. Rủi ro theo đường tấn công

### Attack path A: Self-escalation

Confidence: Reasoned inference từ code confirmed

1. User đăng nhập hợp lệ.
2. Direct update `public.users` row của chính mình:
   - `role = 'ADMIN'`, hoặc
   - thêm `admin_modules`, hoặc
   - thêm `admin_sub_modules`.
3. Reload app hoặc gọi API/RPC trực tiếp.
4. `is_admin()`/`is_module_admin()` trả true.
5. Truy cập/mutate bảng được bảo vệ bằng app role.

### Attack path B: Direct API bypass UI for Project master

Confidence: Confirmed nếu runtime policy giống migration

1. Gọi Supabase Data API bằng anon/authenticated role.
2. Insert/update/delete `projects` hoặc categories.
3. UI `canManageProjects` không tham gia.

### Attack path C: Generic project permission overreach

Confidence: Confirmed design issue; exploit phụ thuộc grant thực tế

1. User được gán `verify` cho một nhu cầu nghiệp vụ.
2. Component/backend khác chỉ check code `verify`, không check module/resource.
3. User có thể xử lý step khác cùng project/site ngoài ý định phân quyền.

## 14. Đề xuất refactor theo pha

### Phase 0: Hotfix bảo mật ngay

1. Khóa self-update `public.users`:
   - self chỉ update whitelist cột profile.
   - admin-only cho mọi cột quyền.
2. Revoke `anon` CRUD ở:
   - `projects`
   - project categories
   - work groups
   - quality tables.
3. Snapshot live policies:
   - export `pg_policies`
   - export grants
   - so sánh với expected matrix.
4. Add audit trigger/RPC cho thay đổi quyền user.

### Phase 1: Chuẩn hóa route/menu permission

1. Deny-by-default route guard.
2. Whitelist explicit:
   - login
   - profile self
   - notifications self
   - safety card public nếu thật sự public.
3. Test tự động:
   - mọi route trong `App.tsx` phải có module hoặc whitelist.
   - sidebar item phải map route hợp lệ.

### Phase 2: Project PBAC v2

1. Namespace permission code.
2. Thêm `resource_type` và `action`.
3. Migrate quyền generic sang quyền cụ thể.
4. Loại bỏ fallback allow cho mutation.
5. Tab admin không thay thế action permission.

### Phase 3: RPC-first workflow mutation

1. Daily Log, Payment Certificate, Quantity Acceptance, Contract Variation, Material Request, Quality Checklist đều có RPC transition riêng hoặc generic workflow RPC typed.
2. RLS direct update chỉ cho draft owner edit field whitelist.
3. Status/handler fields chỉ RPC được đổi.

### Phase 4: Least privilege data reads

1. Tách view user public.
2. Giới hạn read theo project membership.
3. Tách master data read và sensitive operational read.
4. Thêm policy tests bằng Supabase local/pgTAP hoặc integration tests.

## 15. Danh sách kiểm tra live DB cần chạy

Insufficient data hiện tại vì audit chưa có snapshot DB runtime.

SQL đề xuất:

```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

```sql
select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
```

```sql
select proname, prosecdef
from pg_proc
join pg_namespace n on n.oid = pg_proc.pronamespace
where n.nspname in ('public', 'app_private')
order by proname;
```

## 16. Commands đã dùng trong audit

Representative commands:

```bash
rg --files
rg -n "create policy|drop policy|enable row level security" supabase/migrations -i
rg -n "allowedModules|allowedSubModules|adminModules|adminSubModules|canManage" .
rg -n "using \\(true\\)|with check \\(true\\)" supabase/migrations -i
nl -ba App.tsx
nl -ba constants/routes.ts
nl -ba supabase/migrations/20260516135817_harden_user_crud_auth.sql
nl -ba supabase/migrations/20260501084303_project_master_optional_site.sql
nl -ba supabase/migrations/20260704143800_daily_log_member_contributions.sql
```

Verification sau khi tạo tài liệu:

- `test -f docs/security/permission-audit.md && wc -l docs/security/permission-audit.md`: file tồn tại, 915 dòng tại thời điểm kiểm.
- `npm run lint`: pass, `tsc` exit 0.

## 17. Kết luận

Hệ thống đã có nhiều nỗ lực hardening nghiêm túc, đặc biệt ở WMS transaction, Project material request, Project document workflow và Daily Log. Tuy nhiên, hiện có ba vấn đề kiến trúc cần xử lý trước khi mở rộng thêm quyền:

1. Nguồn sự thật quyền (`public.users`) đang cho self-update quá rộng.
2. Một số bảng vẫn đang có backend policy mở cho `anon`/`authenticated`.
3. Project PBAC dùng action code chung, gây rủi ro quyền chéo giữa các nghiệp vụ.

Nếu chỉ sửa UI/menu thì không đủ. Trọng tâm refactor nên là backend enforcement: RLS deny-by-default, RPC cho mutation nhạy cảm, permission code có namespace, và test policy tự động.

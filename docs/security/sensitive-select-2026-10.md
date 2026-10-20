# Thu hẹp quyền đọc chữ ký và bảng tiền / lương / hợp đồng — 10/2026

**Nguồn:** audit bảo mật 20/10/2026 (`docs/audits/security-performance-scale-2026-10-20/README.md`, mục S1, S2).
**Migration:** `supabase/migrations/20261021130000_rls_signatures_sensitive_select.sql` (chưa áp lên Cloud; chờ chủ sản phẩm duyệt PR).
**Phạm vi:** chỉ policy SELECT và cách client đọc ảnh chữ ký. Không đổi quyền ghi, không đổi RPC.
**Cách đo:** chạy migration + đếm `count(*)` theo 4 vai trong một transaction kết thúc bằng `rollback` trên Cloud `ftciqmqhmfvjtwoycswe` (20/10/2026). Không ghi tên / email / UUID.

## 1. Nguyên tắc

- Mọi điều kiện không phụ thuộc dòng bọc `(select …)` → Postgres tính một lần mỗi câu lệnh (InitPlan), không gọi hàm quyền theo từng dòng.
- Dùng hàm quyền có sẵn: `app_private.finance_can('view')` (gồm Admin), `app_private.sensitive_view_all / sensitive_view_project_ids / sensitive_view_site_ids` (công tắc xem tài chính / hợp đồng theo dự án + Room thanh toán, nghiệm thu — P0-C), `app_private.can_view_hrm_payroll_3p()` (`hrm.payroll.view`, `hrm.compensation.view`), `app_private.has_permission`, `public.is_admin()`.
- Hàm mới (đều `stable security definer`, chỉ `authenticated` được gọi):
  - `app_private.user_signature_can_read_all()` — Admin, `system.wf.manage`, `workflow.instance.view` / `administer` toàn cục.
  - `app_private.user_signature_visible_owner_ids()` — mình + người tạo / đã xử lý / tham gia các phiếu mình tham gia (tạo, được giao, theo dõi, đã xử lý, quản trị mẫu, giám sát mẫu, phiếu dự án mình tạo hoặc đang được giao).
  - `app_private.user_signature_can_read(uuid)`, `app_private.user_signature_object_can_read(text)` — dùng cho bảng và Storage.
  - `app_private.actor_staff_project_ids()`, `app_private.actor_staff_site_ids()` — dự án / công trường mình đang là nhân sự (`project_staff` còn hiệu lực).
  - `app_private.actor_employee_ids()` — hồ sơ nhân viên của mình (tự xem KPI).
- SELECT bị RLS lọc trả **0 dòng, không lỗi 42501**, nên màn của nhân viên thường hiện danh sách rỗng / trạng thái không có dữ liệu, không hiện lỗi đỏ.

## 2. Quyết định theo bảng

| Bảng | Policy SELECT mới | Màn đang đọc | Ghi chú |
|---|---|---|---|
| `user_signatures` | chủ sở hữu · `user_signature_can_read_all()` · `user_id` ∈ `user_signature_visible_owner_ids()` | AuthContext (chữ ký của mình), AppContext module `workflow-people` / `admin` (gắn vào danh sách người), in Word phiếu Quy trình | Người cùng xử lý một phiếu vẫn chèn được chữ ký của nhau khi in |
| Storage `workflow-templates` (`workflow_templates_read`) | tệp khác giữ như cũ; `signatures/<uuid>.png` qua `user_signature_object_can_read(name)`; tên lạ dưới `signatures/` chỉ Admin | như trên | Client đổi từ `getPublicUrl` sang `createSignedUrl` 10 phút (hiển thị) và `download` (chèn vào tệp in) |
| `cash_funds` | `finance_can('view')` · `sensitive_view_all('finance')` · có dự án trong `sensitive_view_project_ids('finance')` | Tài chính; `ProjectFinanceWorkspace` chọn quỹ khi lập bộ hoàn ứng | Room thanh toán vẫn chọn được quỹ |
| `cash_vouchers`, `cash_voucher_items` | `finance_can('view')` | không có màn đọc trực tiếp (RPC Tài chính) | |
| `payment_schedules` | `finance_can('view')` · `sensitive_view_all('finance'|'contract')` · dự án / công trường trong `sensitive_view_*('finance'|'contract')` | Thanh toán, Dòng tiền, Hợp đồng (bảng lịch thanh toán), bảng điều khiển dự án, danh mục đầu tư | Cùng quy tắc `project_finances` (P0-C) |
| `supplier_contracts`, `subcontractor_contracts` | `sensitive_view_all('contract')` · `contract.supplier.view` · `finance_can('view')` · dự án / công trường trong `sensitive_view_*('contract')` · dự án / công trường mình là nhân sự | Hợp đồng, Vận hành, Chuỗi cung ứng / Thầu phụ / Hợp đồng trong dự án, An toàn (nhà thầu), Xuất vật tư, form Kho | Mẫu "Cán bộ vật tư, kho" có `contract.supplier.view`; nhân sự dự án thấy hợp đồng dự án mình |
| `project_vendors` | `sensitive_view_all('finance'|'contract')` · `finance_can('view')` · dự án trong `sensitive_view_*('finance')` · dự án mình là nhân sự | Chuỗi cung ứng (dự án), danh mục đầu tư | |
| `salary_3p_settings` | Admin · `can_view_hrm_payroll_3p()` | không có màn đọc trực tiếp | |
| `kpi_scores` | Admin · `can_view_hrm_payroll_3p()` · `employee_id` ∈ `actor_employee_ids()` | không có màn đọc trực tiếp | Nhân viên tự xem điểm của mình |
| `kpi_periods` | Admin · `can_view_hrm_payroll_3p()` · kỳ có điểm của mình (qua RLS `kpi_scores`) | không có màn đọc trực tiếp | |
| `request_logs` | Admin · phiếu tương ứng đọc được (RLS `public.requests`) | không có màn đọc trực tiếp | |
| `asset_assignments` | bỏ policy `true`; còn `asset_assignments_select_action` (`asset.assignment.view` theo tài sản / người được cấp) | Tài sản (AppContext module `ts`) | Người không có quyền Tài sản thấy 0 dòng |
| `xp_events` | của mình · Admin | XPProgress, AchievementWall, BottomNav (đều truy vấn theo chính mình) | |

### Giữ `using (true)` — lý do

| Bảng | Lý do |
|---|---|
| `approval_rules` | Ai nộp phiếu cũng phải tra được người duyệt (`lib/approvalService.ts`, fallback khi PBAC lỗi). Không có số tiền cá nhân; chỉ ngưỡng và người duyệt theo module. |
| `contract_cost_items` | Danh mục mã chi phí (ký hiệu, tên, loại), không có số tiền; dùng ở bảng điều khiển dự án và danh mục Hợp đồng. |
| `hrm_salary_policies` | Danh mục tên chính sách lương (id, name, description), không có mức lương; HR cần khi lập hồ sơ nhân viên. |
| `user_xp` | Bảng xếp hạng XP là tính năng công khai nội bộ (`pages/Leaderboard.tsx`). |

Ngoài phạm vi (ghi nhận để làm sau): `users` (phone, email, manager_id) — audit S1 có nêu; cần quyết định riêng vì danh bạ dùng toàn hệ thống.

## 3. Số dòng thấy được theo vai (Cloud, rollback, 20/10/2026)

Vai mẫu: **Admin**; **Tài chính** (có `system.finance.view`); **HR lương** (có `hrm.payroll.view`); **Nhân viên thường** (không có quyền tài chính / lương / quản trị quy trình / hợp đồng, không có công tắc xem tài chính dự án, không là nhân sự dự án, có chữ ký).

| Bảng | Admin trước → sau | Tài chính trước → sau | HR lương trước → sau | Nhân viên trước → sau |
|---|---:|---:|---:|---:|
| `user_signatures` | 6 → 6 | 6 → 6 | 6 → 3 | 6 → **1** (của mình) |
| Storage `signatures/*` | 6 → 6 | 6 → 6 | 6 → 3 | 6 → **1** |
| `cash_funds` | 1 → 1 | 1 → 1 | 1 → 0 | 1 → **0** |
| `cash_vouchers` | 1 → 1 | 1 → 1 | 1 → 0 | 1 → **0** |
| `cash_voucher_items` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `payment_schedules` | 6 → 6 | 6 → 6 | 6 → 0 | 6 → **0** |
| `supplier_contracts` | 14 → 14 | 14 → 14 | 14 → 0 | 14 → **0** |
| `subcontractor_contracts` | 5 → 5 | 5 → 5 | 5 → 0 | 5 → **0** |
| `project_vendors` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `salary_3p_settings` | 1 → 1 | 1 → 0 | 1 → 1 | 1 → **0** |
| `kpi_scores` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `kpi_periods` | 1 → 1 | 1 → 0 | 1 → 1 | 1 → **0** |
| `request_logs` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `asset_assignments` | 17 → 17 | 17 → 0 | 17 → 17 | 17 → **0** |
| `xp_events` | 1.968 → 1.968 | 1.968 → 10 | 1.968 → 45 | 1.968 → **0** |
| `user_xp` (giữ) | 57 → 57 | 57 → 57 | 57 → 57 | 57 → 57 |
| `approval_rules` (giữ) | 5 → 5 | 5 → 5 | 5 → 5 | 5 → 5 |
| `contract_cost_items` (giữ) | 13 → 13 | 13 → 13 | 13 → 13 | 13 → 13 |
| `hrm_salary_policies` (giữ) | 3 → 3 | 3 → 3 | 3 → 3 | 3 → 3 |

Đọc kết quả:
- Admin không đổi ở mọi bảng.
- Tài chính giữ nguyên bảng tiền / hợp đồng; mất `asset_assignments` (17 → 0) vì tài khoản mẫu không có `asset.assignment.view` — đúng thiết kế module Tài sản, không phải hồi quy Tài chính. Mất `salary_3p_settings`, `kpi_periods` vì không có quyền lương.
- HR lương giữ nguyên lương / KPI; không thấy tiền / hợp đồng; chữ ký chỉ còn của mình và người cùng phiếu (3/6).
- Nhân viên thường: 0 dòng ở mọi bảng tiền / lương / hợp đồng; chữ ký chỉ của mình; XP chỉ của mình.
- Số Storage `signatures/*` khớp số dòng `user_signatures` ở mọi vai → policy Storage và policy bảng nhất quán.

Lệnh đo lại (thay `<migration>` bằng tệp migration; bỏ dòng migration để đo "trước"): tệp SQL gồm `begin;` + migration + phần đếm theo vai (xem lịch sử PR) + `commit;`, chạy `node scripts/cloud-sql.mjs --file <tệp> --rollback` (Management API, thay `commit;` bằng `rollback;`).

## 4. Thay đổi client

| Nơi | Trước | Sau |
|---|---|---|
| `lib/signatureService.ts` (mới) | — | `createSignatureUrl`, `createSignatureUrls` (ký 10 phút), `loadSignatureUrlForUser`, `downloadSignatureImage`, `signaturePathFor` |
| `context/AuthContext.tsx` `loadSignatureUrl` | `getPublicUrl` (bucket riêng tư, chỉ chạy nhờ policy đọc mở) | signed URL 10 phút qua Storage RLS |
| `context/AppContext.tsx` module `workflow-people`, `admin`, `saveSignature` | `getPublicUrl` cho mọi chữ ký | `createSignedUrls` một lần cho các chữ ký RLS trả về; chữ ký không được đọc thì không gắn |
| `pages/wf/WorkflowInstances.tsx` xuất Word | `fetch(actor.signatureUrl)` (URL công khai, có thể đã hết hạn) | `downloadSignatureImage(userId)` tải thẳng qua Storage RLS lúc in |
| `pages/Settings.tsx` ô Chữ ký số | dùng URL từ lúc đăng nhập | ký lại khi mở tab (URL 10 phút đã hết hạn) |

## 5. Walkthrough giao diện

Chưa đăng nhập được bằng tài khoản thật trong phiên này (không có tài khoản thử; không nhập mật khẩu người dùng), và migration chưa áp lên Cloud nên giao diện prod chưa phản ánh policy mới. Đã kiểm bằng SQL theo vai (mục 3) và rà mã:

- **Tài chính (tài khoản có quyền):** mọi màn Tài chính đọc qua RPC `list_finance_*` (security definer, tự kiểm `finance_can`) và các bảng trên với `finance_can('view')` → số dòng không đổi (bảng mục 3, cột Tài chính). Không có đường nào sinh 42501 mới vì chỉ đổi policy SELECT (RLS lọc dòng, không ném lỗi).
- **In phiếu có chữ ký:** người xử lý / người tạo / người theo dõi phiếu đọc được chữ ký của nhau (hàm `user_signature_visible_owner_ids`); tệp in tải ảnh bằng `download` qua RLS; ảnh không được phép → bỏ trống ô chữ ký, không lỗi.
- **Lương (HR có `hrm.payroll.view`):** `salary_3p_settings`, `kpi_*` giữ nguyên 1 → 1; màn Lương đọc qua `hrmSensitiveProjectionService` (đã gated `canViewPayroll`) không đổi.
- **Nhân viên thường:** các truy vấn trả danh sách rỗng, không lỗi đỏ: `fetchTableHelper` trả `[]`, `cashFundService.listActive` trả `[]`, `supplierContractService.list()` ở form Kho / Xuất vật tư đã `.catch(() => [])`. Ô Chữ ký số ở Cài đặt vẫn hiện chữ ký của mình (signed URL mới).

**Việc cần làm khi áp lên prod (chủ sản phẩm / Admin):** đăng nhập 3 tài khoản thật như mục 3, mở Tài chính → Phải trả, Quy trình → in Word một phiếu đã duyệt (kiểm có ảnh chữ ký), HRM → Lương; với nhân viên thường mở Dự án → Chuỗi cung ứng và Cài đặt → Chữ ký số. Nếu người in phiếu không thấy chữ ký của người duyệt, kiểm `workflow_instance_participants` của phiếu đó.

# Audit phân quyền ứng dụng, RLS và Notification — 27/09/2026

**Phạm vi:** Cài đặt → Người dùng → Chỉnh sửa, ma trận quyền module, vai trò nghiệp vụ, Room dự án, RLS/RPC trên Supabase, luồng thông báo. Có nhận xét về hai luồng đang chạy song song (Project/Procurement V2, Daily log) nhưng không can thiệp.

**Phương pháp:** Chỉ đọc. Không sửa code, không ghi dữ liệu và không đổi quyền.

- **Database:** Supabase Cloud main `ftciqmqhmfvjtwoycswe`, khớp `.env`. Chỉ chạy `SELECT` trên catalog Postgres (`pg_policies`, `pg_proc`) và bảng quyền; kết quả chỉ lấy số đếm.
- **Frontend:** đọc source nhánh `feature/refactor-du-an-t9-1`, gồm cả thay đổi chưa commit. Giao diện được xem trên `localhost:3000` do chủ sản phẩm tự đăng nhập Admin; chỉ mở/xem, không bấm Lưu.
- **Giới hạn:**
  - Chưa đối chiếu bản đang chạy trên Vercel Production, nên kết luận về UI là theo source/dev server.
  - Chưa chạy persona smoke bằng JWT của từng vai trò. Các kết luận RLS dựa trên định nghĩa policy/hàm, chưa phải phép thử tấn công thực tế.
  - Không ghi email, UUID hay tên người dùng vào tài liệu này.

---

## 1. Kết luận chính

Cảm nhận "đã cấp quyền mà không có tác dụng, đã gỡ mà vẫn còn quyền" là đúng. Nguyên nhân không nằm ở một lỗi đơn lẻ. Hiện có **năm nguồn quyết định quyền chồng lên nhau**, và màn hình quản trị chỉ cho sửa một nguồn:

| # | Nguồn quyết định | Nơi sửa | Còn tác dụng ở server? | Admin nhìn thấy trên màn Người dùng? |
|---|---|---|---|---|
| 1 | `users.role` (`ADMIN`, `WAREHOUSE_KEEPER`) | Select "Vai trò hệ thống" | Có. 33 hàm DB so khớp literal `role='ADMIN'`, `is_admin()`, 128 chỗ ở frontend | Có |
| 2 | Cột legacy `admin_modules` / `admin_sub_modules` / `allowed_*` | **Không sửa được** (đã khóa ghi) | **Có.** `is_module_admin()` vẫn đọc trực tiếp, nằm trong 124 policy và 48 hàm | Chỉ thấy một con số, ví dụ "29 gán legacy", kèm chú thích "không còn tác dụng" |
| 3 | Direct grant (capability + scope) | Ma trận quyền mới | Có, trừ các module đã chuyển sang Room | Có, nhưng bị ẩn sau từng nút "Quyền nâng cao" |
| 4 | Vai trò nghiệp vụ (role template) | Drawer → Phân quyền (chỉ HR); tab "Mẫu quyền" | Có | Tab "Mẫu quyền" **không hiện với ai, kể cả Admin** |
| 5 | Room dự án | Từng dự án → tab Phân quyền (chỉ role ADMIN) | Có, và là nguồn có thẩm quyền cho 10 nghiệp vụ dự án | Luôn báo "0 Room / 0 action" với người được sửa |

Hệ quả thực tế:

- **Gỡ quyền không hết.** 45/58 tài khoản active không phải Admin vẫn còn `admin_modules` legacy. Riêng module Dự án có 38 người, và nhóm này được ghi `project_finances`, `project_transactions`, `approval_rules`, mẫu nghiệm thu và nhật ký nháp của **mọi dự án**, bất kể Room.
- **Cấp quyền không ăn.**
  - Có 22 capability tồn tại ở DB (admin tick được) nhưng registry frontend không biết, nên giao diện luôn từ chối.
  - Có 904 direct grant trên 11 phân hệ dự án do Room quản lý. Server bỏ qua các grant này, nhưng frontend vẫn dùng chúng để hiện nút, nên người dùng bấm rồi bị lỗi.
- **Bảo mật dữ liệu còn lỗ lớn.**
  - Mọi tài khoản active đọc được tài chính, giao dịch và hợp đồng của cả 86 dự án.
  - Mọi tài khoản active sửa/xóa được chữ ký của người khác, tạm ứng, cost items, cấu hình lương 3P và KPI.
  - Mọi tài khoản active ghi được `audit_trail` và `request_logs`, tức là làm giả được lịch sử.
- **Thông báo chưa đảm bảo đúng người.**
  - Notification Workflow chung đang tắt: 72 sự kiện từ 18/09 đến 26/09 chưa gửi cho ai.
  - Cảnh báo định kỳ chỉ chạy khi một Admin đang mở trình duyệt.
  - Người nhận WMS được chọn theo `role` thay vì theo capability.
  - "Đọc tất cả" của một người đánh dấu đã đọc thông báo broadcast của mọi người.

Tài liệu [authorization-v2-operating-model.md](../../security/authorization-v2-operating-model.md) ghi rằng bốn trường legacy "không còn tham gia quyết định cho phép/từ chối". **Điều này không đúng với Cloud hiện tại.** Tài liệu [legacy-runtime-dependencies](../../security/authorization-v2-task12-4-2-legacy-runtime-dependencies.md) mô tả đúng hơn.

### Bổ sung trong ngày — truy cập từ bên ngoài (S0)

Khi chuẩn bị P0, em phát hiện thêm một lỗ nặng hơn các mục dưới: **người chưa đăng nhập** cũng truy cập được dữ liệu. Họ chỉ cần anon key, vốn nằm công khai trong bundle JS.

- Đọc được qua REST: `activities` (3.216 dòng), `payment_schedules`, `salary_3p_settings`, `cash_vouchers`, `project_documents`, `asset_assignments`, `org_units`…
- Liệt kê được file ở `checkin-photos`, `project-files`, `project-photos` và `workflow-templates/signatures`.
- Policy Storage cho phép ghi đè/xóa chữ ký, ảnh và tài liệu dự án.
- Auth đang mở đăng ký công khai, và tài khoản tự đăng ký được tạo hồ sơ EMPLOYEE/ACTIVE.

**Trạng thái:** P0-A đã được apply lên Cloud ngày 27/09/2026, anon hiện bị chặn ở REST, RPC và Storage. Riêng việc tắt đăng ký công khai cần chủ sản phẩm thao tác trên Dashboard. Chi tiết xem [kế hoạch](../../security/authorization-remediation-plan-2026-09-27.md) và [rollout log](../../security/authorization-remediation-rollout-log.md).

---

## 2. Phát hiện chi tiết

Mức độ:

- **P0:** lộ, sửa hoặc giả mạo dữ liệu. Cần đóng sớm.
- **P1:** sai quyền hoặc sai người nhận, trực tiếp gây ra triệu chứng "không có tác dụng".
- **P2:** UX quản trị gây nhầm lẫn.
- **P3:** dọn dẹp.

### P0 — RLS và bảo mật dữ liệu

**S1. Policy ghi `true`: mọi tài khoản active đều được INSERT/UPDATE/DELETE.** Restrictive gate duy nhất trên các bảng này chỉ kiểm "tài khoản đang active". Không có GRANT hay trigger nào chặn thêm, đã kiểm `has_table_privilege` và `pg_trigger`.

| Nhóm | Bảng | Tác động |
|---|---|---|
| Chữ ký | `user_signatures` | Policy tên "Users can update own signature" nhưng điều kiện là `true`, nên ai cũng thay hoặc xóa được chữ ký người khác. Chữ ký dùng trên chứng từ duyệt. |
| Tài chính | `advance_payments`, `project_cost_items`, `project_dashboard_snapshots` | Sửa/xóa tạm ứng, chi phí và snapshot dashboard của mọi dự án |
| Nhân sự | `salary_3p_settings`, `kpi_periods`, `kpi_rating_configs`, `kpi_scores`, `ranking_criteria` | Sửa cấu hình lương 3P, KPI và xếp hạng |
| Hợp đồng | `contract_items`, `contract_cost_items`, `contract_appendices`, `contract_item_resources`, `contract_*_catalogs`, `contract_material_norms` | Sửa nội dung hợp đồng và danh mục |
| Workflow | `workflow_step_tasks` (I/U/D), `workflow_print_templates` | Sửa checklist bước duyệt và mẫu in |
| Lịch sử | `audit_trail` (INSERT), `activities` (INSERT), `request_logs` (INSERT) | Giả mạo nhật ký audit và lịch sử phiếu |
| Khác | `dashboard_layouts`, `user_xp`, `xp_events` | Rủi ro thấp |

**S2. Đọc không theo scope: SELECT `true` trên dữ liệu nhạy cảm.** Gồm `project_finances`, `project_transactions` (~1.083 dòng), `project_cost_items`, `customer_contracts`, `supplier_contracts`, `subcontractor_contracts`, `contract_items`, `contract_guarantees`, `advance_payments`, `business_partners`, `user_signatures` và `users`.

- Bảng `users` lộ email, điện thoại, `disabled_reason` và các cột legacy của mọi người.
- Bất kỳ nhân viên nào cũng đọc được qua REST API, không cần giao diện.
- Điều này đi ngược nguyên tắc "quyền dự án chỉ bao phủ đúng dự án".

**S3. Notification cho phép giả mạo và dùng chung trạng thái đọc.**

- `notifications_insert` có `WITH CHECK true`. Trigger chỉ chặn nhóm Work/Workflow/Request, nên ai cũng tạo được thông báo (kèm Web Push) tới bất kỳ ai, với tiêu đề và link tùy ý. Đây là kênh phishing nội bộ.
- Thông báo broadcast (`user_id IS NULL`) cho phép mọi người UPDATE.
  - [notificationService.ts:655](../../../lib/notificationService.ts:655) `markAllRead`/`dismissAll` cập nhật luôn các dòng broadcast dùng chung. Một người bấm "Đọc tất cả" là thông báo broadcast biến mất với cả công ty.
- Đang có broadcast gửi toàn công ty cho nghiệp vụ thanh toán (42), tồn kho (562), vật tư (63), tiến độ (73) và an toàn (8). Thông tin thanh toán không nên đi tới mọi người.

**S4. Hàm `SECURITY DEFINER` gọi được bởi `anon` (chưa đăng nhập):** Security Advisor báo 11 hàm, và 192 hàm với `authenticated`.

- `daily_log_user_has_project_permission(p_user_id, …)`: hàm không còn ai gọi. Nó cho phép dò quyền của bất kỳ user nào, và trả về TRUE khi dự án chưa có nhân sự. Nên xóa.
- `process_project_workflow_sla_escalations()`: người chưa đăng nhập kích hoạt được việc sinh nhắc nhở SLA.
- Các hàm còn lại (`get_project_material_request_detail`, các board, `timeout_stale_user_sessions`…) có kiểm actor bên trong, nhưng vẫn nên `REVOKE EXECUTE … FROM anon` cho đúng nguyên tắc.

**S5. Lộ email ra dịch vụ bên ngoài.** Avatar mặc định là `https://i.pravatar.cc/150?u=<email>` ([UserModal.tsx:244](../../../components/UserModal.tsx:244), [UserModal.tsx:270](../../../components/UserModal.tsx:270)). 42/65 tài khoản đang lưu avatar dạng này, nên mỗi lần render email nhân viên bị gửi tới pravatar.cc.

**S6. Tài khoản test trên Production.**

- Có một tài khoản fixture `@example.invalid` với role **ADMIN**, đang active, không có Auth user. Nó được tính vào "Quản trị hệ thống (3)" và nhận toàn bộ cảnh báo gửi Admin, tức là thông báo rơi vào một hộp thư không có người.
- `current_app_user_id()` có nhánh ánh xạ theo email khi `auth_id IS NULL`. Nếu Auth cho phép đăng ký bằng email tùy ý, đây là đường leo thang quyền tiềm ẩn. Cần kiểm cấu hình signup.
- Nên vô hiệu hóa hoặc xóa các fixture G3 và canary khỏi Production.

### P1 — Legacy vẫn quyết định quyền: nguyên nhân "gỡ mà vẫn còn"

**L1. `public.is_module_admin(text)` vẫn đọc cột legacy.**

- Thân hàm là: `role='ADMIN' OR p_module = any(admin_modules) OR admin_sub_modules ? p_module`.
- Hàm được dùng ở 124 tham chiếu policy và 48 hàm.
- Hàm không kiểm `is_active`. Hiện chưa khai thác được vì tài khoản bị vô hiệu đã bị ban và đã xóa legacy.

| Module legacy | Số user active (không phải Admin) còn giữ | Tham chiếu policy | Số bảng | Ví dụ bảng |
|---|---:|---:|---:|---|
| `DA` | 38 | 68 | 25 | `project_finances`, `project_transactions` (ghi mọi dự án), `approval_rules`, `project_permission_types`, `inspection_*`, `estimate_*`, `safety_issue_*`; cùng `daily_log_can_edit` |
| `HD` | 7 | 108 | 35 | Hợp đồng, đối tác, NCC |
| `WMS` | 22 | 8 | 4 | cùng các helper compatibility WMS |
| `WF` | 23 | 2 | 2 | |
| `TS` | 1 | 8 | 2 | |
| `TENDER_AI`, `SETTINGS` | 0 (chỉ Admin) | 56 | 18 | |

Legacy đã khóa ghi, nên **admin không có cách nào gỡ các quyền này trên giao diện**. Màn Người dùng chỉ hiện "N gán legacy — chỉ đọc", ngụ ý rằng chúng không còn tác dụng.

**L2.** `app_private.can_access_module()` đọc `allowed_*` và nằm trong 11 policy.

**L3. Shell `system.*` còn giữ.**

- 432 grant trên 57 người, ví dụ `system.da.view`, `system.wf.manage`, `system.wms.view`.
- Giao diện hiện mã kỹ thuật thô và ghi rõ "không thể chỉnh sửa tại đây… cần được đối soát riêng". Nghĩa là bỏ tích Module vẫn còn quyền truy cập.

**L4.** Còn 4 template `LEGACY_HR_<hash>` với 54 assignment active, không có ngày hết hạn. Admin không đọc hiểu được tên dạng hash.

**L5. Kiểm `role` thay cho capability.** Có 128 chỗ ở frontend. Các chỗ ảnh hưởng nghiệp vụ nhiều nhất:

- **Quản trị Room dự án chỉ cho role ADMIN.**
  - Ở UI: [ProjectPermissionsTab.tsx:14](../../../pages/project/ProjectPermissionsTab.tsx:14), [ProjectDashboard.tsx:549](../../../pages/ProjectDashboard.tsx:549).
  - Ở RPC: `assert_project_permission_room_admin` kiểm `role='ADMIN'`.
  - Capability `project.org.grant_permissions` đã có trong catalog, nhưng không được dùng. Kết quả là 3 Admin phải quản trị Room cho 86 dự án; PM/CHT không tự phân công được.
- **Người duyệt và người nhận thông báo WMS chọn theo `Role.WAREHOUSE_KEEPER` + `assignedWarehouseId`.** Xem [AppContext.tsx:2248](../../../context/AppContext.tsx:2248), [AppContext.tsx:2260](../../../context/AppContext.tsx:2260). Trong khi đó WMS đã chuyển sang capability theo kho: 3 tài khoản `EMPLOYEE` có quyền xử lý WMS nhưng không nhận thông báo.
- **Sidebar** giới hạn Audit trail, Dự báo & Phân tích, Hoạt động hệ thống và MISA theo `Role.ADMIN`, dù đã có `system.audit_trail.view` và `analytics.view` ([Sidebar.tsx:722](../../../components/Sidebar.tsx:722)).
- **Vật tư dự án:** [MaterialTab.tsx:955](../../../pages/project/MaterialTab.tsx:955) chỉ cho `role === ADMIN` quản lý workflow phiếu.

### P1 — Lệch catalog và lệch nơi enforce: nguyên nhân "cấp mà không có tác dụng"

**D1. 22 capability có ở DB nhưng registry frontend không biết.** `evaluateCapability` trả `unknown_permission`, nên frontend luôn từ chối:

- `asset.catalog.create|edit|delete|dispose|import|transfer_stock`, `asset.maintenance.complete|import`, `asset.audit.export`
- `request.instance.approve_assigned|reject_assigned|return_assigned|reassign|cancel|resubmit_own|edit_own_content`
- `system.authorization.view|audit|manage_grants|manage_roles|manage_scopes|override`

Admin tick được những ô này và server cũng enforce (có tham chiếu trong hàm/policy), nhưng giao diện không bao giờ hiện nút tương ứng.

Hệ quả đã xác minh trên UI: tab **"Mẫu quyền"** ([Settings.tsx:121](../../../pages/Settings.tsx:121), [Settings.tsx:1115](../../../pages/Settings.tsx:1115)) phụ thuộc `system.authorization.manage_roles`, nên **không hiện với Admin**. Việc gán vai trò nghiệp vụ ngoài HR vì thế chỉ làm được bằng script.

Chiều ngược lại, frontend có mà DB chưa có: `project.v2_*` (30 mã), `project.daily_log.publish_progress` và `system.vehicle_booking.*`. Đây là phần của hai luồng V2 và Daily log chưa apply Cloud, xem mục 4.

**D2. 904 direct grant trên các phân hệ dự án do Room quản lý (54 người).**

- Ở server, quyền nghiệp vụ được suy từ Room action. Đã xác nhận với Nhật ký: `daily_log_has_action` map `project.daily_log.*` sang Room `daily_log`, và cờ `project_room_pbac_fallback_enabled = false`. Thanh toán, nghiệm thu và an toàn đi qua `authorization_v2_final_room_action`.
- Ở frontend, [projectPermissionService.ts:236](../../../lib/permissions/projectPermissionService.ts:236) `canManageProjectTab` vẫn dùng `project.<tab>.manage`, nên nút hiện ra rồi server từ chối.
- Ma trận ở Cài đặt vẫn cho tick "Nhật ký dự án → Duyệt · Nhạy cảm · Cần ngày hết hạn", nhưng ô này **không có tác dụng ở server**.

**D3. Grant dự án phạm vi `global`.**

- 54 người có `project.*.view` toàn công ty, tức là xem được cả 86 dự án.
- 39 người có `project.*.manage` toàn công ty. Gồm `project.master.manage` và `project.dashboard.manage` (39 người), `project.org.manage` (21), `project.budget/cashflow.manage` (13), `project.contract*.manage` (9).
- Các tab không thuộc Room (ngân sách, dòng tiền, hợp đồng, tài liệu, tổ chức) được quyết định bởi các grant này. Vì vậy trên thực tế, phân quyền dự án đang là phân quyền toàn công ty.

**D4. Room chỉ phủ 6/86 dự án.** Chỉ 6 dự án có `project_staff` và thành viên Room. 80 dự án còn lại vận hành nhờ Admin, legacy DA admin và grant global. Room "chặt chẽ" chưa áp dụng được trên diện rộng.

**D5. Code và DB lệch action Room.** `material_request` có binding `verify` ở DB nhưng không có trong `allowed_actions` hay trong code; binding này vô hiệu, cần dọn.

**D6. Mặc định fail-open ở UI.** 9 component nhận `canManageTab = true` làm mặc định, ví dụ [DailyLogTab.tsx:886](../../../pages/project/DailyLogTab.tsx:886), `PaymentWorkbenchTab`, `MaterialTab`, `SafetyTab`, `ContractTab`, `SupplyChainTab`, `DocumentsTab`. Chỉ cần quên truyền prop là nút quản trị hiện ra. Nên đổi mặc định thành `false`.

### P1 — Notification: đúng người nhận đúng việc

| Luồng | Cơ chế hiện tại | Vấn đề |
|---|---|---|
| Workflow chung | Worker server `process-workflow-notifications`, gate `enabled=false` | 72 sự kiện `PENDING` (18/09 → 26/09) **chưa gửi**. Client bị trigger chặn tự gửi (`TASK_NOTIFICATION_BACKEND_ONLY`). |
| Work | Worker server, gate `enabled=false` từ 12/09 | Outbox 31 sự kiện (07–09/09); không có luồng thay thế |
| Request | Outbox server | 406 đã gửi; **14 `FAILED`** (02–17/08) chưa xử lý lại |
| Cảnh báo định kỳ (tồn thấp, quá hạn…) | Chạy **trong trình duyệt Admin**, mỗi 15 phút, lưu mốc ở `localStorage` ([notificationService.ts:680](../../../lib/notificationService.ts:680)) | Không ai mở app thì không có cảnh báo. Người nhận lọc theo `role` (`mode: 'admin'`, `'roles'`), có cả tài khoản fixture ADMIN. |
| WMS, vật tư, nhật ký, PO | Client tự chọn người nhận rồi INSERT | Người nhận do code trình duyệt quyết định và dựa vào `role`, không qua capability/Room/assignment ở server |
| Broadcast | `user_id NULL` | Trạng thái đọc dùng chung toàn công ty; nội dung nhạy cảm (thanh toán) gửi tới mọi người |

### P2 — UX màn Cài đặt → Người dùng

Đã xem trên UI thật với một tài khoản mẫu; không lưu thay đổi.

1. **Quyền nằm rải rác ở 5 nơi**: drawer "Phân quyền" (chỉ vai trò HR), form Chỉnh sửa (direct grant), tab "Mẫu quyền" (đang ẩn), tab Phân quyền trong từng dự án (chỉ ADMIN) và Workspace. Không có màn nào trả lời được câu hỏi *"người này làm được gì, ở đâu, vì sao"*.
2. **Unknown bị hiển thị thành 0 hoặc thành trạng thái sai.** Snapshot quyền chỉ được tải cho người đang đăng nhập ([authState.ts:484](../../../context/authState.ts:484)). Với người được sửa:
   - Khối Room báo **"0 Room / 0 action hiệu lực"**, trong khi Cloud cho thấy tài khoản mẫu có **18 membership Room active**.
   - Khối legacy luôn báo "Đang theo dõi fallback" (màu cảnh báo), dù cờ fallback đã tắt.
3. **Phạm vi là UUID thô.** Hiển thị dạng "Cấp trực tiếp · Công trường · 240ac280-…", và khi cấp mới phải **tự gõ UUID** vào ô "Mã phạm vi cụ thể". Không có ô chọn dự án, công trường, kho hay phòng ban. Gõ sai thì cấp vào khoảng không.
4. **Không có tóm tắt.** Thẻ "Dự án" có 27 phân hệ, không hiện grant nào cho tới khi bấm "Quyền nâng cao" từng dòng. Tài khoản mẫu có 37 direct grant dự án nhưng nhìn tổng quan không thấy cái nào.
5. **Thuật ngữ kỹ thuật lộ ra người dùng:** "direct grants", "grants + scope", "PBAC fallback", "Room-authoritative", mã `system.da.view`, "Grant mới chưa thay đổi".
6. **Link "Mở quản trị Room" không đưa tới đúng nơi.** Link `href="/da?tab=permissions"` tải lại toàn trang, nên mất bản nháp đang sửa mà không cảnh báo. Nó cũng không mang `projectId`, nên chỉ mở danh sách dự án, không mở tab Phân quyền.
7. **Drawer người dùng có ngõ cụt và thông tin sai.**
   - Tab "Mật khẩu" mở form chỉnh sửa, nhưng form này **không có ô mật khẩu** với tài khoản đã tồn tại.
   - Tab "Kho phụ trách" hiện "Phòng vật tư - toàn bộ kho" khi *chưa gán kho*, tức là unknown bị hiển thị thành "toàn bộ".
   - Tab "Chỉnh sửa" chỉ chứa một nút mở form, tốn thêm một bước.
8. **"Vai trò hệ thống" gộp hai khái niệm.** Select gồm Quản trị viên / Tài khoản kho / Tài khoản thường, trộn tài khoản hệ thống với nghiệp vụ kho, trái với mô hình capability. Muốn đổi loại tài khoản phải lưu riêng một lần.
9. **Lý do tối thiểu 10 ký tự bắt buộc cả khi chỉ sửa số điện thoại.**
10. Danh sách người dùng không có cột tóm tắt quyền. Nhãn "ONLINE (65)" bằng tổng số tài khoản, kể cả tài khoản bị vô hiệu, nên nhiều khả năng sai.

### P3 — Dọn dẹp

- `pages/UserManagement.tsx` không còn route (`/users` chuyển hướng về `/settings`) nhưng vẫn có 5 chỗ kiểm `Role.ADMIN`.
- `daily_log_user_has_project_permission` không còn ai gọi.
- 59 bảng bật RLS nhưng không có policy (Advisor INFO). Cần xác nhận đây là chủ ý chỉ truy cập qua RPC.
- 15 hàm `search_path` mutable; Leaked Password Protection đang tắt.

---

## 3. Room dự án — đánh giá riêng

Mô hình Room đúng hướng: tách người xử lý theo nghiệp vụ, action có prerequisite, và server là nơi có thẩm quyền quyết định. Vấn đề nằm ở phần triển khai xung quanh:

1. **Hai hệ song song cho cùng một nghiệp vụ.** Room action (server tin) và direct capability `project.<module>.*` (frontend tin) cùng tồn tại (D2). Cần chọn **một**: với 10 Room đang enforce, bỏ các capability tương ứng khỏi ma trận Cài đặt và cho frontend đọc Room.
2. **Legacy DA admin bỏ qua Room.** 38 người `is_module_admin('DA')` bỏ qua Room ở tài chính/giao dịch dự án và nhật ký nháp (L1).
3. **Người được quản trị Room chưa đúng.** Hiện chỉ 3 Admin. Cần chốt có cho PM/CHT quản trị Room trong dự án của mình qua `project.org.grant_permissions` hay không.
4. **Độ phủ thấp.** 6/86 dự án (D4). Cần template Room theo vai trò (CHT, QS, kỹ thuật, thủ kho công trường, kế toán dự án) để gán nhanh khi mở dự án, thay vì tick từng action.
5. **Nhãn action không nói đúng nghiệp vụ.** Handoff V2 ghi nhận action "Sửa" trong Room PO thực chất là "Tạo PO nháp". Tài liệu này cũng ghi một lần chủ dự án bỏ tick "Gửi" nhưng payload lưu vẫn còn `submit`, phải lưu lại lần hai. Nên kiểm tra [ProjectPermissionRoomDrawer](../../../components/project/permissions/ProjectPermissionRoomDrawer.tsx) và đổi nhãn theo động từ nghiệp vụ.

---

## 4. Nhận xét hai luồng song song (chỉ quan sát, không can thiệp)

### Project V2 / Procurement V2

**Điểm tốt:**

- Route và schema tách riêng, có cohort gate.
- Có Room V2 với prerequisite rõ.
- Tự phát hiện và đóng rò rỉ `list_project_v2_cohort_ids_v1`.
- Không cấp quyền hay ghi dữ liệu trên Production khi chưa có signoff.
- Migration V2 không dùng `is_module_admin`, `role='ADMIN'` hay grant cho `anon`.

**Rủi ro nhìn từ audit này:**

- V2 thêm 3 Room **và** 30 capability `project.v2_*` có thể cấp trực tiếp, lặp lại đúng mô hình kép ở D2. Đề xuất: capability V2 chỉ đến từ Room, không hiện trong ma trận Cài đặt (`direct_grant_allowed=false`).
- Frontend nhánh này đã chứa mã và Room V2 trong khi Cloud chưa có schema. Frontend và migration phải phát hành cùng nhau, nếu không ma trận và nhãn sẽ lệch.
- Pilot RICO phụ thuộc hoàn toàn vào Room, nhưng Room hiện chỉ Admin quản trị được, và 38 legacy DA admin vẫn có đường ghi ngoài Room ở các bảng tài chính dự án cũ.

### Daily log

**Điểm tốt:**

- `publish_progress` là action Room riêng và yêu cầu `approve`.
- Có shadow gate và migration "enforced write boundary".
- Không dùng legacy helper mới.

**Cần lưu ý (trên Cloud hiện tại và trong migration mới):**

- `daily_log_can_edit` trên Cloud vẫn cho `is_module_admin('DA')` (38 người) sửa nhật ký nháp của mọi dự án.
- Các helper contribution (`can_view`, `can_submit`, `can_update`) **fail-open khi dự án chưa có nhân sự**: ai cũng xem, gửi và sửa được contribution. Hiện có 0 dòng nên chưa lộ dữ liệu.
  - Migration mới `20260925063126_daily_log_contribution_room_insert.sql` giữ lại nhánh `not daily_log_scope_has_staff(...)` và còn dùng `project_user_has_permission` (PBAC cũ theo `project_staff_permissions`) thay vì Room action.
  - Nên chuyển sang deny mặc định trước khi mở rộng pilot.
- Hàm `daily_log_user_has_project_permission` gọi được bởi `anon` (S4).

---

## 5. Lộ trình đề xuất

Thứ tự ưu tiên theo rủi ro. Mỗi bước làm theo quy trình sẵn có: rollback smoke trên Cloud → dry-run → apply → persona allow/deny → ghi log.

### Giai đoạn 0 — Đóng lỗ P0 (1–2 ngày, ít phụ thuộc quyết định nghiệp vụ)

1. Thay policy `true` ở S1:
   - `user_signatures`: chỉ chủ sở hữu.
   - `audit_trail`, `activities`, `request_logs`: chỉ ghi qua trigger hoặc RPC.
   - `salary_3p_settings`, `kpi_*`: theo template HR.
   - `advance_payments`, `project_cost_items`: theo Room hoặc capability dự án.
   - `contract_*`: theo `contract.*.manage`.
   - `workflow_step_tasks`: theo quyền instance.
2. `notifications`: INSERT chỉ qua RPC hoặc worker server. Tách trạng thái đọc của broadcast sang bảng theo từng người. Ngừng broadcast nội dung thanh toán.
3. `REVOKE EXECUTE … FROM anon` cho 11 hàm. Xóa `daily_log_user_has_project_permission`.
4. Bỏ avatar pravatar; dùng avatar chữ cái đầu tại chỗ.
5. Vô hiệu hóa fixture G3/canary trên Production. Kiểm cấu hình Auth signup; cân nhắc bỏ nhánh email fallback trong `current_app_user_id()` khi mọi user đã có `auth_id`.

### Giai đoạn 1 — Giao diện nói thật (khoảng 1 tuần)

1. **Một nguồn catalog.** Registry frontend lấy từ `permission_actions`, hoặc có contract test fail khi hai bên lệch (D1). Khôi phục tab "Mẫu quyền" cho người có `system.authorization.manage_roles`.
2. **Tải snapshot hiệu lực của người được sửa** qua RPC. Hiển thị đúng Room, nguồn quyền và trạng thái legacy. Khi chưa tải được thì hiện "Chưa xác định", không hiện 0.
3. **Hiện legacy đang còn hiệu lực đúng như thực tế**: "Còn quyền quản trị module Dự án (legacy) — đang có tác dụng ở 25 bảng", kèm nút yêu cầu thu hồi theo quy trình.
4. **Bộ chọn phạm vi** (dự án, công trường, kho, phòng ban) thay cho ô gõ UUID; hiển thị tên thay cho UUID.
5. Bỏ khỏi ma trận các capability dự án đã do Room quản lý. Frontend dùng Room action cho các tab đó (D2).
6. Sửa các ngõ cụt ở drawer (mật khẩu, kho phụ trách). Link Room mở đúng dự án và tab trong ứng dụng, không tải lại trang.

### Giai đoạn 2 — Gỡ legacy khỏi đường quyết định (2–3 tuần, theo cohort)

1. Theo từng module (DA → HD → WMS → WF → TS): thay `is_module_admin('<X>')` trong từng policy/hàm bằng capability hoặc Room đúng action và scope.
2. Siết SELECT trên tài chính, giao dịch và hợp đồng dự án theo scope dự án (S2).
3. Với 45 người đang giữ legacy admin: owner quyết định từng người nhận template/Room nào. Sau đó thu hồi shell `system.*` và `LEGACY_HR_*`.
4. Khi dependency query trả rỗng, chạy Task 13 theo [runbook](../../security/authorization-v2-task13-runbook.md).

### Giai đoạn 3 — Notification do server quyết định (song song Giai đoạn 2)

1. Chuyển cảnh báo định kỳ sang cron hoặc Edge Function server-side.
2. Người nhận xác định từ capability, Room hoặc assignment trên server, không dùng `role` ở client.
3. Canary rồi bật worker Workflow. Quyết định với 72 sự kiện tồn: gửi bù hay suppress có ghi chú. Xử lý 14 Request `FAILED`.

### Giai đoạn 4 — Màn "Hồ sơ quyền" hợp nhất

Mỗi người có một màn duy nhất gồm:

- **Tóm tắt:** vai trò nghiệp vụ, số dự án/kho được phép, quyền nhạy cảm và hạn.
- **Theo ứng dụng:** xem được gì, làm được gì, ở phạm vi nào.
- **Theo dự án:** Room và action.
- **Nguồn:** vì sao có quyền này, sửa ở đâu.

Cấp quyền ưu tiên theo template vai trò; direct grant chỉ dùng cho ngoại lệ có hạn.

---

## 6. Quyết định cần chủ sản phẩm chốt

1. **Dữ liệu tài chính và hợp đồng dự án:** ai được xem? Theo dự án (thành viên Room/tổ chức dự án) hay có nhóm xem toàn công ty (Ban lãnh đạo, Kế toán)?
2. **Quản trị Room:** chỉ System Admin, hay PM/CHT được phân quyền trong dự án của mình (`project.org.grant_permissions`)?
3. **38 người đang là legacy "quản trị module Dự án":** giữ vai trò nào? Có chuyển sang template "Quản lý dự án toàn công ty" hay chỉ Room ở dự án cụ thể?
4. **Thông báo broadcast** (tồn kho, thanh toán, tiến độ): gửi ai thay cho toàn công ty?
5. **72 thông báo Workflow tồn:** gửi bù hay bỏ qua?
6. **Tài khoản "Tài khoản kho":** còn là loại tài khoản, hay chỉ còn là vai trò nghiệp vụ theo kho?

---

## 7. Phụ lục — số liệu Cloud (27/09/2026, chỉ đọc)

| Chỉ số | Giá trị |
|---|---|
| Tài khoản active / Admin / Thủ kho | 61 / 3 (trong đó 1 fixture) / 6 |
| Active không phải Admin còn `admin_modules` legacy | 45 |
| Active không phải Admin còn `allowed_modules` legacy | 54 |
| Policy tham chiếu `is_module_admin` / `can_access_module` | 124 / 11 |
| Hàm gọi `is_module_admin` / đọc cột legacy / literal `role='ADMIN'` | 48 / 17 / 33 |
| Bảng public / bảng không bật RLS | 455 / 0 |
| Bảng có policy ghi `true` | 27 |
| Capability DB / frontend / chỉ có ở DB / chỉ có ở frontend | 384 / 395 / 22 / 33 |
| Direct grant `project.*` global (view / manage) | 843 grant (54 người) / 291 grant (39 người) |
| Direct grant trên phân hệ do Room quản lý | 904 (54 người) |
| Dự án / dự án có nhân sự hoặc Room | 86 / 6 |
| Role template / assignment active `LEGACY_HR_*` | 14 / 54 |
| Workflow outbox PENDING / Request outbox FAILED | 72 / 14 |
| Security Advisor: anon definer / authenticated definer / RLS không policy | 11 / 192 / 59 |

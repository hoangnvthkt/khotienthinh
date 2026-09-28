# Rollout log — Authorization remediation P0 → P3

Kế hoạch gốc: [authorization-remediation-plan-2026-09-27.md](authorization-remediation-plan-2026-09-27.md). Nhật ký chỉ ghi số đếm, tên object và kết quả; không ghi email, UUID hay dữ liệu nghiệp vụ.

## P0-A · Chặn truy cập từ bên ngoài

- **Migration:** `supabase/migrations/20260927023600_authorization_p0a_block_anonymous_access.sql`. Tên file khớp version do `apply_migration` ghi vào ledger; đã thêm vào allowlist `supabase/baseline/current.json`.
- **Smoke:** `supabase/tests/authorization_p0a_block_anonymous_access_smoke.sql`
- **Rollback:** `supabase/operations/authorization_p0a_rollback.sql`
- **Cloud:** main `ftciqmqhmfvjtwoycswe`

### Preflight 27/09/2026 (chỉ đọc)

**Auth**

- `GET /auth/v1/settings` trả `disable_signup=false`, `mailer_autoconfirm=false`, provider duy nhất là `email`.
- 62/62 tài khoản Auth do Admin tạo qua `create-user` (`email_confirm: true`). Có 0 email xác nhận đăng ký công khai và 0 tài khoản chưa xác nhận.
- Trigger `on_auth_user_profile_sync` (AFTER INSERT) tạo hồ sơ `EMPLOYEE/ACTIVE` cho mọi Auth user mới.

**REST với anon key** (`count=exact`, `limit=0`, không tải dữ liệu), số dòng đọc được:

| Bảng | Số dòng |
|---|---:|
| `activities` | 3.216 |
| `asset_assignments` | 17 |
| `org_units` | 24 |
| `project_documents` | 13 |
| `payment_schedules` | 6 |
| `salary_3p_settings` | 1 |
| `cash_vouchers` | 1 |

**Storage với anon key** (liệt kê tối đa 3 mục): liệt kê được `checkin-photos`, `project-files`, `project-photos` và `workflow-templates/signatures`.

**Catalog**

- `anon` có SELECT trên 174 relation (gồm 7 view, đều `security_invoker`) và TRUNCATE trên 162 relation.
- 11 hàm `SECURITY DEFINER` gọi được bởi anon.
- Default ACL của `postgres` cấp `anon=rDxtm` cho bảng mới.
- ACL anon trước P0-A: 182 relation/sequence, fingerprint tên `4dc511d84b8236af9689e15066749ed6`. Script rollback đã đối chiếu khớp.

**Consumer**

- Trước đăng nhập, app không đọc bảng nào: Login chỉ gọi `signInWithPassword`.
- Hai Edge Function dùng anon key đều chuyển JWT người dùng.
- Cron gọi `process_project_workflow_sla_reminders`, không gọi `..._escalations`.
- Đường dẫn upload: ảnh chấm công là duy nhất theo `Date.now()`; chữ ký là `signatures/<userId>.png` của chính người dùng; mẫu in là `<templateId>/...`.

### Rollback dry-run trên Cloud — PASS (27/09/2026)

Chạy `BEGIN → migration → smoke → ROLLBACK` trong một transaction.

**Lần 1 — dừng ở assertion mẫu in.** Nguyên nhân: bước chọn persona chạy dưới role `postgres` không có JWT, nên chọn nhầm nhân viên có quyền sửa mẫu qua legacy WF (`workflow_template_actor_can_edit` phụ thuộc `current_app_user_id()` và `can_access_module('WF')`). Đã sửa smoke để đánh giá quyền trong đúng ngữ cảnh JWT của từng ứng viên. Policy không cần sửa.

**Lần 2 — pass toàn bộ:**

- Catalog: anon không còn privilege trên relation/sequence `public`; default ACL `postgres` không còn anon; không hàm DEFINER nào anon gọi được; `authenticated` giữ đủ 6 RPC màn hình; 2 hàm không dùng bị thu hồi.
- anon: liệt kê Storage trả 0; ghi đè chữ ký, xóa và tải lên bị chặn; đọc `activities` và gọi RPC chi tiết đề xuất bị `42501`.
- Nhân viên:
  - Đọc được 6/6 object thử; không ghi đè hay xóa được file của người khác; sửa/xóa được file của mình.
  - Ghi được chữ ký của mình; không ghi đè, xóa hay tạo chữ ký của người khác.
  - Không tải được mẫu in khi không có quyền sửa mẫu.
  - Vẫn đọc được `activities` và `payment_schedules`.
- Admin: xóa được chữ ký và 5 file của người khác; tải được mẫu in.
- **Hậu kiểm:** policy, helper và object smoke đều không còn. Quyền anon giữ nguyên trạng thái trước (rollback có hiệu lực).

### Apply — 27/09/2026

Chủ sản phẩm xác nhận apply. `apply_migration` thành công, ledger ghi version `20260927023600_authorization_p0a_block_anonymous_access`.

### Postflight — PASS

**Truy cập ẩn danh**

- REST với anon key vào 8 bảng (`activities`, `payment_schedules`, `salary_3p_settings`, `cash_vouchers`, `project_documents`, `asset_assignments`, `org_units`, `users`) đều trả HTTP 401 `42501`.
  - Lỗi phát sinh ngay ở pre-request hook `enforce_active_app_actor` của PostgREST.
  - Quyền `authenticated` trên hook này được giữ nguyên có chủ đích.
- Liệt kê Storage với anon key trả 0 mục ở `project-photos`, `checkin-photos`, `workflow-templates/signatures`, `project-files`, `project-attachments`, `avatars`.

**Smoke và dữ liệu**

- Smoke sau apply (`authorization_p0a_block_anonymous_access_smoke.sql`, tự rollback) pass toàn bộ assertion anon, nhân viên và Admin.
- Không còn object smoke nào sót lại. 3 object chữ ký thật giữ nguyên. 0 policy Storage PERMISSIVE còn gán cho `anon`/`public`.

**Security Advisor**

- Hết lint `anon_security_definer_function_executable` (trước là 11).
- `authenticated_security_definer_function_executable` giảm 192 → 190.
- Các lint còn lại (RLS không policy 59, search_path 15, extension 5, leaked password 1) nằm ngoài P0-A.

**App đã đăng nhập** (dev server `localhost:3000`, phiên Admin, tải lại Cài đặt)

- 49/52 request Supabase trả 200/201; 1 request trạng thái 0.
- 2 request `rpc/award_my_daily_xp` trả 404. Nguyên nhân **có từ trước, không liên quan P0-A**: hàm này không tồn tại trên Cloud. `origin/main` đã gọi nó từ commit `9bc5eda` nhưng migration tương ứng chưa được apply. Cần xử lý riêng.

### Việc còn mở của P0-A

- **A1 (chủ sản phẩm):** Supabase Dashboard → Authentication → Sign In / Providers → tắt "Allow new users to sign up". Lúc postflight, `GET /auth/v1/settings` vẫn trả `disable_signup=false`.
- **Khi merge:** `supabase/baseline/current.json` cũng đang được một luồng khác sửa trong checkout chính (cùng thêm dòng cuối allowlist). Khi merge sẽ phải giữ cả hai dòng.
- Baseline checker trên `main` còn đỏ vì 2 migration Workflow (`20260925090000`, `20260926090000`) chưa được allowlist. Việc này thuộc luồng Workflow, P0-A không sửa.

## P0-B · Chặn nhân viên sửa dữ liệu không thuộc quyền

Quyết định của chủ sản phẩm ngày 27/09/2026:

- Tạm ứng, hạng mục chi phí và snapshot dashboard dự án: chỉ Admin ghi.
- Làm phần chống giả mạo thông báo và thay avatar.
- **Giữ nguyên các tài khoản test `@example.invalid`** (chủ sản phẩm đang dùng cho việc khác). B4 không thực hiện.

### Thứ tự triển khai (frontend đi trước server)

1. **B-1** `authorization_p0b_restrict_client_writes`: tương thích với frontend đang chạy.
2. **Frontend:**
   - Thông báo chuyển sang RPC `mark_my_notifications` và bảng biên nhận riêng từng người.
   - Avatar mặc định `/default-avatar.svg`; bỏ fallback pravatar.cc/ui-avatars.com.
   - Ẩn nút ghi tạm ứng và dự toán chi phí với người không phải Admin, kèm ghi chú.
3. **B-2** `authorization_p0b_broadcast_state_and_avatars`: chỉ áp sau khi frontend ở bước 2 đã lên Production.
   - Khóa cập nhật dùng chung trên thông báo broadcast.
   - Sửa trigger hồ sơ Auth để không ghi đè avatar và dùng avatar nội bộ.
   - Dọn 42 `users`, 30 `employees` và 412 `activities` đang chứa URL bên thứ ba.

### Consumer đã rà (code)

**Không có client ghi trực tiếp:**

- `activities`: không ai ghi.
- `request_logs`: chỉ `process_request_step` (DEFINER) ghi.
- `user_xp`/`xp_events`: chỉ đọc; XP cộng qua RPC.
- `salary_3p_settings`/`kpi_*`: không có consumer.

**Client ghi hợp lệ, được giữ:**

- `audit_trail`: 34 lời gọi, một số truyền `'system'` hoặc id người khác. Trigger đóng dấu người thật thay cho việc chặn.
- Chữ ký, bố cục dashboard: của chính người dùng.
- `ranking_criteria`: màn yêu cầu template HR `hrm.employee.view_sensitive`.
- Checklist bước quy trình: người xem được hồ sơ.
- Mẫu in: người sửa được mẫu.
- Hợp đồng/danh mục: Admin, legacy HD, `contract.*.manage`, `system.tender_ai.manage`, hoặc `project.contract*` theo dự án.

**Side effect của luồng đã duyệt:**

- Khi chứng từ chuyển "Đã thanh toán", trình duyệt người xác nhận (Room Thanh toán) cập nhật thu hồi tạm ứng và khóa hạng mục hợp đồng.
- Nghiệm thu khối lượng cập nhật khối lượng hoàn thành và khóa/mở khóa hạng mục.
- Các luồng này vẫn được ghi, nhưng trigger chỉ cho đổi các cột hệ quả.

**Thông báo:** 0 thông báo hiện có dùng link tuyệt đối; broadcast chỉ do luồng cảnh báo của Admin tạo.

### Rollback dry-run trên Cloud

**B-1:**

- **Lần 1:** dừng ở một lệnh `INSERT … RETURNING` vào thông báo của người khác. Postgres yêu cầu đọc lại được dòng vừa chèn. Frontend chèn không dùng `RETURNING`, nên đã sửa smoke.
- **Lần 2: PASS**, gồm các nhánh:
  - Nhân viên thường: bị chặn giả mạo audit, ghi `request_logs`, sửa chữ ký/bố cục/XP/HR/hợp đồng/tài chính người khác, và gửi thông báo link ngoài hoặc broadcast.
  - Người gửi được đóng dấu; biên nhận broadcast tạo đúng.
  - Người xác nhận thanh toán ghi được số thu hồi nhưng bị chặn sửa số tiền tạm ứng (12 thành viên Room Thanh toán ở dự án có tạm ứng).
  - Admin ghi được.
- Hậu kiểm: không còn object nào.

**B-2:**

- **Lần 1:** trigger `prevent_users_privilege_self_update` chặn việc dọn avatar vì migration không có actor. Migration đã được sửa để tắt đúng trigger này trong transaction, chỉ cho lệnh cập nhật cột `avatar` (cột không được trigger bảo vệ), rồi bật lại.
- **Lần 2: PASS.** Không còn URL bên thứ ba; trigger hồ sơ không còn pravatar; nhân viên không sửa được dòng broadcast. Hậu kiểm: trigger bảo vệ vẫn bật, dữ liệu thật chưa đổi.

### Kiểm thử local

Vitest 485 file, 2.290 test pass; `tsc` pass; build pass; `check:supabase-queries` có 0 truy vấn thiếu policy và 0 truy vấn chưa phân loại.

### Trạng thái

- **B-1: ĐÃ APPLY** ngày 27/09/2026 sau khi chủ sản phẩm xác nhận trực tiếp. Ledger ghi `20260927035001_authorization_p0b_restrict_client_writes`; file đã đổi tên và đưa vào allowlist.
  - Smoke sau apply PASS.
  - App đang chạy (frontend cũ, phiên Admin, trang Thông báo): 49 request 200/201. Chỉ còn 404 `award_my_daily_xp`, lỗi có từ trước.
- **Frontend: ĐÃ DEPLOY.**
  - `main` được fast-forward lên `62e27d8`; chủ sản phẩm tự push.
  - Vercel Production `khotienthinh.vercel.app` đã phục vụ `/default-avatar.svg` (`200 image/svg+xml`).
- **B-2: ĐÃ APPLY** ngày 27/09/2026 sau khi chủ sản phẩm xác nhận. Ledger ghi `20260927042947`.
  - Postflight: smoke B-2 và smoke B-1 đều PASS; trigger `trg_users_prevent_privilege_self_update` đã bật lại.
  - 42 `users` đã dùng avatar nội bộ; không còn URL pravatar hay ui-avatars.
- **A1: ĐÃ XONG.** Chủ sản phẩm đã tắt đăng ký công khai; `/auth/v1/settings` trả `disable_signup=true`.
- `award_my_daily_xp` (404): chủ sản phẩm xác nhận đây là chức năng phụ, bỏ qua trong các đợt sau.

**P0-A và P0-B hoàn tất. Tiếp theo là P0-C (công tắc xem Tài chính và Hợp đồng dự án).**

## P0-C · Tài chính và Hợp đồng dự án theo công tắc

Quyết định của chủ sản phẩm ngày 27/09/2026:

- Có 2 công tắc riêng: Tài chính và Hợp đồng.
- Có lựa chọn "Tất cả dự án".
- Thành viên Room Thanh toán / Nghiệm thu tự động được xem dự án của mình.
- Người quản trị hợp đồng cấp công ty xem được mọi hợp đồng.
- Chỉ Admin được bật/tắt công tắc.

### Kiểm kê

- **Mở cho mọi người, P0-C sẽ siết:**
  - `project_transactions` (~1.083 dòng), `project_finances`, `project_cost_items`, `project_cost_actuals`, `advance_payments`, `payment_schedules`, `acceptance_records`, `project_dashboard_snapshots`.
  - `customer_contracts`, `supplier_contracts`, `subcontractor_contracts`, `project_contracts`, `contract_items`, `contract_guarantees`, `contract_appendices`.
- **Đã giới hạn theo dự án, giữ nguyên:** chứng từ thanh toán, nghiệm thu, phát sinh hợp đồng, công nợ NCC, ngân sách vật tư.

### C-1 — bảng công tắc và RPC (chưa đổi quyền đọc)

- **Migration:** `20260927071707_authorization_p0c_sensitive_view_grants.sql`. **ĐÃ APPLY** ngày 27/09/2026 sau khi chủ sản phẩm xác nhận; smoke sau apply PASS.
- **Thành phần chính:**
  - Bảng `project_sensitive_view_grants`: `project_id` NULL nghĩa là tất cả dự án; có lịch sử bật/tắt kèm lý do.
  - Helper tính quyền một lần cho mỗi truy vấn: `sensitive_view_all`, `sensitive_view_project_ids`, `sensitive_view_site_ids`, `sensitive_can_view`.
  - RPC `get_my_project_sensitive_access` cho mọi người đã đăng nhập.
  - RPC `list_project_sensitive_view_access` và `set_project_sensitive_view_grant` chỉ cho Admin; yêu cầu lý do từ 10 ký tự và ghi `audit_trail`.
- **Rollback dry-run trên Cloud:**
  - Lần 1 và 2 lỗi do tên cột trùng biến PL/pgSQL, và do smoke đọc bảng Room dưới quyền `authenticated`. Đã sửa.
  - Lần 3 **PASS**: nhân viên không tự bật, không liệt kê, không ghi trực tiếp được công tắc; Admin bật được, có audit; công tắc có hiệu lực ngay; tắt thì mất quyền.

### C-2 — giao diện

- Dự án → tab Phân quyền → mục **"Ai được xem Tài chính & Hợp đồng"**:
  - Bộ đếm số người đang xem.
  - Lọc và tìm kiếm; thêm người ngoài dự án.
  - 2 công tắc mỗi người. Công tắc tự khóa và ghi rõ nguồn khi quyền đến từ Admin, Room Thanh toán / Nghiệm thu, Tất cả dự án hoặc Quản trị hợp đồng.
  - Mỗi lần đổi đều bắt nhập lý do.
  - Có đủ trạng thái đang tải, lỗi (kèm thử lại) và trống.
  - Mục thu gọn **"Xem tất cả dự án"**.
- Test mới cho logic công tắc: 4/4 pass. Vitest toàn repo 2.290 pass; `tsc` pass; build pass; kiểm tra truy vấn 0 lỗi.

### C-3 — siết quyền đọc

- **Điều kiện:** chủ sản phẩm xác nhận đã bật đủ công tắc, rồi đồng ý apply (27/09).
- **Migration:** `20260927074935_authorization_p0c_enforce_sensitive_reads`.
  - Chỉ đọc được khi có công tắc (dự án hoặc tất cả dự án), là người xử lý chứng từ trong Room Thanh toán / Nghiệm thu, là Admin, hoặc (riêng hợp đồng) quản trị hợp đồng cấp công ty.
  - Tài chính: `project_transactions`, `project_finances`, `project_cost_items`, `project_cost_actuals`, `advance_payments`, `project_dashboard_snapshots`.
  - Hợp đồng: `customer_contracts`, `project_contracts`; `contract_items` và `contract_appendices` loại `customer`; `contract_guarantees` theo hợp đồng cha.
  - `project_cost_actuals`: bỏ policy ALL cho mọi người; chỉ Admin được ghi.
  - Ghi `project_transactions` / `project_finances`: bỏ `is_module_admin('DA')`. Còn lại Admin, quyền dự án `edit`/`delete`, và (giao dịch) người xử lý chứng từ thanh toán / nghiệm thu.
  - RPC mới `get_my_sensitive_view_scope()` dùng cho danh sách và xuất Excel.
- **Cố ý chưa khóa** (để không làm hỏng màn hình khác): `supplier_contracts` và `subcontractor_contracts` (An toàn, Vật tư, Chuỗi cung ứng, Thầu phụ đang dùng); `payment_schedules` và `acceptance_records` (do Room Thanh toán quản lý). Chuyển sang P1.
- **Frontend** (đã push lên main trước khi apply):
  - Tab Điều hành, Tài chính, Dòng tiền, Báo cáo và phần ngân sách dùng quyền Tài chính; tab Hợp đồng dùng quyền Hợp đồng.
  - Khi chưa có quyền, tab hiện "Chưa được mở quyền xem…" thay vì số 0; có trạng thái đang kiểm tra và lỗi (kèm Thử lại).
  - Xuất Excel danh sách dự án để trống cột tiền của dự án không được xem.
- **Rollback dry-run trên Cloud:**
  - Lần 1 lỗi so sánh `text = text[]`; đã sửa bằng ép kiểu mảng.
  - Lần 2 **PASS**.
  - Script `supabase/operations/authorization_p0c3_rollback.sql` cũng đã chạy thử (rollback) **PASS**.
- **ĐÃ APPLY.** Smoke sau apply `supabase/tests/authorization_p0c_enforce_sensitive_reads_smoke.sql` **PASS**:
  - Nhân viên không có công tắc: không thấy giao dịch, tài chính, chi phí, snapshot, hợp đồng chủ đầu tư; vẫn thấy hợp đồng NCC.
  - Bật Tài chính: thấy đúng dự án đó, không thấy hợp đồng, không lộ dự án khác.
  - Bật Hợp đồng: thấy hợp đồng của đúng dự án đó.
  - Admin vẫn thấy toàn bộ. Nhân viên không có quyền sửa thì không ghi được giao dịch.
- Vitest toàn repo 2.297 pass; `tsc` pass; build pass; kiểm tra truy vấn 0 lỗi.

### C-1b — chỉ người xử lý chứng từ mới tự động được xem

- **Phát hiện khi chủ sản phẩm xem thử** (dự án mẫu): 25/28 người bị khóa ở trạng thái "được xem", vì họ có quyền **Xem** trong Room Thanh toán / Nghiệm thu.
  - Toàn hệ thống: Room Thanh toán có 44/67 thành viên chỉ có quyền Xem; Room Nghiệm thu có 47/64.
- **Sửa:** chỉ thành viên có thao tác `edit`, `submit`, `verify`, `approve` hoặc `confirm` mới tự động được xem, đúng với lý do "cần xem để lập và duyệt chứng từ". Thành viên chỉ có quyền Xem do công tắc quyết định.
- **Migration:** `20260927073423_authorization_p0c_room_workers_only`. Dry-run PASS, **ĐÃ APPLY**.
- **Kiểm lại trên UI** (dev server nhánh P0, cổng 3200): 18/28 người chỉnh được; 8 người khóa vì đang xử lý chứng từ, 2 người khóa vì là Admin.

### C-2b — thu gọn công tắc thành một ô Room

- Mục "Ai được xem Tài chính & Hợp đồng" giờ là một ô trong lưới Room (nhóm Tài chính), cho biết số người đang xem, số người theo từng loại, và số người được xem tất cả dự án.
- Bấm vào ô để mở ngăn kéo bên phải, dùng lại toàn bộ danh sách công tắc cũ.
- Ngăn kéo render qua portal để không dính CSS thu gọn chữ của lưới trên mobile.
- Đã xem lại trên desktop và mobile (375px): không tràn ngang, Esc để đóng.

## P1

### P1.1 — gỡ DA legacy (quyết định Q3)

- **Kiểm tác động trước khi siết:**
  - `is_module_admin('DA')` còn trong 23 bảng và 22 hàm (mẫu nghiệm thu, dự toán, quy tắc duyệt, loại quyền, vật tư, nhật ký, an toàn…).
  - 38 người có cờ DA, không ai là Admin: 33 nhân viên, 5 thủ kho. 33 người có mặt trong dự án; 28 người đã có Room.
  - Trong 60 ngày gần nhất, không có bản ghi vật tư tùy chỉnh, nhật ký, sự cố an toàn, dự toán hay mẫu nghiệm thu nào do nhóm này tạo ngoài dự án của họ.
  - Frontend không còn đọc cột legacy để quyết định quyền.
- **Migration** `20260927080700_authorization_p1_retire_legacy_da_admin`:
  - Sao lưu cờ cũ vào `app_private.legacy_da_admin_backup_20260927`.
  - Xóa `DA` khỏi `admin_modules` / `admin_sub_modules`, qua cờ migration chính thức của trigger chặn ghi legacy. Mỗi người được ghi một dòng `authorization_legacy_write_audit`.
  - `is_module_admin('DA')` chỉ còn đúng với Admin, kể cả khi cờ DA bị ghi lại sau này. Các module legacy khác (HD, WMS, WF, TS) không đổi.
- **Dry-run trên Cloud** (gồm cả script rollback `supabase/operations/authorization_p1_retire_legacy_da_rollback.sql`) **PASS**: 38 người được sao lưu và gỡ; người từng có DA không còn qua kiểm tra; Admin và HD legacy giữ nguyên; rollback khôi phục đủ.
- Chủ sản phẩm đồng ý. **ĐÃ APPLY.** Smoke sau apply **PASS**.

### P1.2 — đồng bộ catalog capability và khôi phục tab "Mẫu quyền"

Chỉ sửa frontend, không có migration.

- **Lệch đo lại trên Cloud** (384 action đang active):
  - 22 mã có ở DB nhưng frontend không biết: `asset.catalog.*` (6), `asset.maintenance.complete|import`, `asset.audit.export`, `request.instance.*` (7), `system.authorization.*` (6). Frontend từ chối các mã này với lý do `unknown_permission`.
  - Chiều ngược lại chỉ còn `system.vehicle_booking.view|manage` (luồng Đặt xe, chưa lên Cloud). Các mã `project.v2_*` đã có trên Cloud.
  - 4 action cho chọn phạm vi mà DB không nhận: `wms.inventory.edit`, `wms.master_data.manage`, `hrm.employee.edit_profile`, `hrm.attendance.approve`.
- **Sửa:**
  - Bổ sung 22 mã vào registry, đúng nhãn, phạm vi và thứ tự như DB. `system.authorization` là module riêng, không thêm route mới.
  - Chỉnh phạm vi 4 action theo DB.
  - Route `/settings/role-templates` mở cho người có `system.authorization.manage_roles`. Trước đây route này chưa được khai báo nên luôn bị đẩy về trang chủ.
- **Contract test** `lib/permissions/__tests__/permissionCatalogContract.test.ts` so registry với snapshot DB `fixtures/dbPermissionCatalog.json` theo cả hai chiều và theo phạm vi.
  - `FRONTEND_AHEAD_OF_DB` là allowlist cho mã chờ migration của luồng khác; test cũng fail nếu allowlist chứa mã đã có trên DB.
  - Làm mới snapshot: `node scripts/authorization-v2/export-permission-catalog.mjs ftciqmqhmfvjtwoycswe`.
- **Kiểm tra:**
  - Admin mở được tab "Mẫu quyền" và thấy danh sách mẫu.
  - Cả 22 mã đều `direct_grant_allowed`, nên tick trong màn Người dùng sẽ lưu được.
  - Vitest toàn repo 2.302 pass; `tsc` pass; build pass; kiểm tra truy vấn 0 lỗi.

### P1.3 — Room là nguồn quyền duy nhất cho nghiệp vụ dự án do Room quản lý

- **Đối chiếu lại 904 grant trực tiếp** trên 11 phân hệ, theo đúng đường kiểm quyền hiện tại của server:
  - **8 phân hệ server chỉ đọc Room** (binding `enforced`, `project_room_pbac_fallback_enabled = false`): Nhật ký 134, Thanh toán 94, Chất lượng 87, Chốt tiến độ 72, An toàn 66, PO 61, Tiến độ 49, Nghiệm thu 49. Tổng **612 grant không có tác dụng**.
    - Thanh toán, Nghiệm thu và An toàn đi qua `authorization_v2_final_room_action`.
    - Nhật ký qua `daily_log_has_action`; PO qua `material_has_action`.
    - Tiến độ, Chất lượng, Chốt tiến độ có policy gọi thẳng Room.
  - **3 phân hệ vật tư server vẫn dùng grant:** phiếu yêu cầu 138, kế hoạch 105, BOQ 49 (292 grant).
    - Nhánh `else` của `material_has_action` gọi `project_has_permission_v2`, hàm này đọc `user_permission_grants`.
    - Audit ngày 27/09 ghi "server bỏ qua cả 904" là chưa chính xác với nhóm này. **Giữ nguyên**, chuyển sang batch vật tư (phối hợp luồng Procurement V2).
  - Snapshot của Admin có Room action cho 86/86 dự án (nguồn `admin`), nên Admin không bị ảnh hưởng.
- **Frontend** (đã push lên main trước khi apply):
  - Tab Tiến độ, Chốt tiến độ, Nhật ký, Chất lượng, An toàn, Thanh toán chỉ đọc Room action: có quyền xem Room thì thấy tab; có thao tác khác "xem" thì được sửa.
  - Tab con PO: quyền sửa theo Room. Quyền xem giữ đường cũ, vì tab này còn chứa giao nhận NCC mà server vẫn nhận grant.
  - `canManageTab` / `canManage` mặc định `false` ở 7 component. Trang hợp đồng HD truyền quyền tường minh `contract.customer|supplier.manage`.
  - Không sửa `DailyLogTab`, `SupplyChainTab`, `MaterialTab` (thuộc hai luồng song song); mọi nơi gọi chúng đều đã truyền quyền tường minh.
  - Ma trận quyền ở màn Người dùng gắn nhãn "Phân quyền trong Room dự án" cho mã `project.*` không cấp trực tiếp được.
- **Migration** `20260927083431_authorization_p1_3_retire_room_managed_grants`:
  - Sao lưu 612 grant vào `app_private.p1_3_room_managed_grant_backup_20260927`.
  - Thu hồi mềm (`is_active = false`, có `revoked_at` và lý do; không xóa dòng).
  - Đặt `direct_grant_allowed = false` cho mã `project.*` của 8 phân hệ.
  - Không có mã `project.*` nào là "xem mặc định", nên catalog quản trị vẫn hợp lệ; smoke có kiểm điều này.
- **Dry-run trên Cloud** (gồm cả rollback `supabase/operations/authorization_p1_3_rollback.sql`) **PASS**. Chủ sản phẩm đồng ý. **ĐÃ APPLY.** Smoke sau apply **PASS**.
- Walkthrough Admin trên dự án mẫu: Nhật ký ("Ghi nhật ký"), Tiến độ, Chất lượng, Thanh toán và An toàn vẫn đủ thao tác.
- Vitest toàn repo pass (thêm test "chỉ Room action mới mở quyền sửa"); `tsc` pass; build pass.

### P1.4 — người nhận và người duyệt theo quyền thật, không theo vai trò

- **WMS:**
  - Trước đây frontend chọn người duyệt/người nhận thông báo phiếu vật tư theo vai trò `WAREHOUSE_KEEPER` + kho gán, cộng Admin. Server thì cho thao tác nếu có capability theo kho, là quản trị module WMS, hoặc là thủ kho.
  - Migration `20260927084905_authorization_p1_4_wms_action_recipients`:
    - `app_private.wms_user_has_action(user, code, kho…)` áp đúng luật của `wms_has_action` cho một người bất kỳ.
    - RPC `list_wms_action_recipients(code, kho[])` trả người đang hoạt động (capability, thủ kho, Admin); người gắn đúng kho đứng trước, Admin đứng cuối.
  - Smoke so khớp helper với `wms_has_action` (chạy dưới quyền từng người) trên **mọi người dùng × kho × 4 thao tác: 0 lệch**.
  - Cờ legacy "quản trị module WMS" (17 nhân viên) vẫn cho thao tác như cũ nhưng **tạm không tính là người nhận thông báo**, để khỏi báo cho cả 17 người ở mọi kho. Chủ sản phẩm chốt nhóm này ở P1.5.
  - So với cách cũ: không ai bị loại khỏi danh sách nhận; thêm người có capability xuất/nhận kho.
  - Frontend `lib/wmsRecipientService.ts`: phiếu chờ duyệt → `wms.request.approve` (kho nguồn); đã duyệt → `wms.request.export`; đang giao → `wms.request.receive` (kho công trường); hoàn tất → cả hai. Người xử lý mặc định ở bước kiểm tra tại công trường lấy từ `wms.request.receive`. Tra cứu chạy nền, lỗi thì chỉ bỏ qua thông báo.
- **Sidebar:**
  - Hoạt động hệ thống theo `canAccessRoute`.
  - Nhật ký thay đổi và Dự báo & Phân tích mở cho Admin hoặc người có capability. Chính Admin không có capability `system.audit_trail.view` / `analytics.view`, nên vai trò Admin vẫn được tính.
  - "Đồng bộ MISA" giữ chỉ Admin: route này chưa có capability riêng; chuyển sang theo route sẽ hiện menu cho khoảng 40 người có quyền xem giao dịch kho. Để chủ sản phẩm quyết ở P1.5.
- **Phát hiện và sửa: `audit_trail` cho mọi người đăng nhập đọc** (3.436 dòng, 30 bảng, 232 dòng về lương/tài chính/hợp đồng, gồm cả dữ liệu trước và sau khi sửa). Lỗ này vượt qua công tắc C-3.
  - Migration `20260927085747_authorization_p1_4_restrict_audit_trail_reads`: chỉ Admin hoặc `system.audit_trail.view` được đọc; ghi không đổi. Chỉ trang Nhật ký thay đổi và một hàm SECURITY DEFINER của Đặt xe đọc bảng này.
  - Trang Nhật ký thay đổi có màn "chưa có quyền" thay vì danh sách trống.
- **Không sửa:** `MaterialTab` (luồng Procurement V2; vẫn kiểm `role === ADMIN` cho workflow phiếu), `DailyLogTab` (luồng Daily log), cảnh báo định kỳ gửi Admin (thuộc P2).
- **Còn mở:** bảng `activities` vẫn `select true` (nội dung là mô tả thao tác, ít nhạy cảm hơn). Đề xuất đánh giá cùng P2.
- Dry-run và smoke sau apply của cả hai migration **PASS**. Chủ sản phẩm đồng ý apply. Script rollback `supabase/operations/authorization_p1_4_rollback.sql` đã chạy thử (rollback) **PASS**.
- Walkthrough Admin ở độ rộng desktop: đủ 4 mục hệ thống trong sidebar; trang Nhật ký thay đổi tải đủ dữ liệu.

### P1.5 — gỡ quản trị module legacy (HD, WMS, WF, TS)

- **Kiểm kê trước khi siết** (chỉ ghi số đếm):
  - Cờ legacy đang hoạt động: HD 7, WMS 22, WF 23, TS 1.
  - Server còn gọi cờ này ở: HD 76 policy + 1 hàm; WMS 7 policy + 10 hàm; WF 2 policy + 11 hàm; TS 6 policy + 2 hàm.
  - Nhiều chỗ **chỉ** chấp nhận cờ legacy, không có đường capability: tạo/sửa hợp đồng chủ đầu tư, đối tác, mẫu hợp đồng; tạo và điều chuyển tài sản.
  - 23 người có cờ WF không có `workflow.instance.act_assigned` / `create`: việc duyệt và tạo phiếu quy trình của họ đi qua cờ quản trị.
  - Hoạt động 90 ngày (audit trail và dữ liệu nghiệp vụ): HD 0/7; TS 0/1; WMS chỉ 5 thủ kho có hoạt động; WF có một số người sửa mẫu.
  - Capability `system.<x>.manage` là grant thật (tạo lúc migrate lên Authorization V2), và tập người giữ **trùng khớp** tập người có cờ legacy.
- **Bước 1 — migration `20260927091559_authorization_p1_5_module_admin_from_capability`** (không đổi quyền của ai):
  - `is_module_admin(X)` = Admin, hoặc có `system.<x>.manage` với X ∈ {HD, WMS, WF, TS, RQ, SETTINGS, TENDER_AI, EX, FEEDBACK}. Không còn đọc cột legacy; DA vẫn chỉ Admin.
  - PROCUREMENT (luồng V2) giữ chỉ Admin: 4 người có `system.procurement.manage` nhưng không có cờ, áp luật mới sẽ tự mở quyền cho họ.
  - `wms_user_has_action` và `list_project_sensitive_view_access` cũng chuyển sang capability.
  - Smoke so luật cũ và mới trên mọi người dùng × 11 module: **0 lệch**. Smoke người nhận WMS (P1.4) vẫn **0 lệch**.
  - Từ nay, bỏ tick "Quản trị" module trong Cài đặt có tác dụng thật ở server.
- **Bước 2 — migration `20260927091643_authorization_p1_5_owner_module_admin_decisions`**, theo quyết định chủ sản phẩm ngày 27/09:
  - Quy trình: cả 23 người được vai trò "Người dùng quy trình"; 7 người giữ `system.wf.manage`, thu hồi 16.
  - Kho: thu hồi `system.wms.manage` của cả 22. Thủ kho vẫn làm việc qua vai trò thủ kho; 2 nhân viên giữ capability theo kho.
  - Hợp đồng: thu hồi `system.hd.manage` của 7 người, và 30 quyền `contract.*.manage` của 6 người trong số đó. Quản trị hợp đồng chỉ còn Admin.
  - Tài sản: giữ nguyên người duy nhất đang quản lý.
  - Xóa cờ legacy HD/WMS/WF/TS của 33 người (đã vô tác dụng sau Bước 1); mỗi người có một dòng `authorization_legacy_write_audit`.
  - Sao lưu vào `app_private.p1_5_backup_20260927`: 75 grant, 23 vai trò, 33 bộ cờ.
- **Kiểm tra:**
  - Dry-run của cả hai bước và rollback `supabase/operations/authorization_p1_5_rollback.sql` **PASS**.
  - Chủ sản phẩm đồng ý. **ĐÃ APPLY.** Smoke sau apply **PASS**: không còn cờ legacy; không còn quản trị Kho/Hợp đồng ngoài Admin; đúng 7 quản trị quy trình và 1 quản trị tài sản; cả 23 người dùng quy trình vẫn duyệt và tạo phiếu được.
- **Không sửa frontend:** `isModuleAdmin` phía giao diện đã kiểm `system.<x>.manage` từ trước.
- **Còn lại:**
  - RQ (15 người) vẫn giữ `system.rq.manage` như cũ, chưa rà theo từng người.
  - "Đồng bộ MISA" vẫn chỉ Admin.
  - `can_access_module` và phép chiếu legacy (`allowed_modules`) để lại cho P3 (Task 13).

### P1.5b — quản trị Phiếu yêu cầu (RQ)

- **Rà soát:**
  - 15 nhân viên giữ `system.rq.manage` (grant chuyển từ cờ legacy RQ).
  - Tác dụng thật duy nhất trên server: cho phép duyệt thay / nhân danh người khác trong `process_request_step` (luồng phiếu cũ). Giao diện không gọi hàm này. `workflow_has_action` không có nơi nào gọi với mã `request.*`. Việc xem phiếu theo `request.template.manage` và người tham gia. Menu `/rq` theo module `request.*`.
  - 90 ngày: không ai duyệt thay. Việc tạo và duyệt phiếu hằng ngày không phụ thuộc quyền này; phần lớn nhân viên khác cũng không có capability `request.instance.*` mà vẫn dùng phiếu bình thường.
  - Rủi ro còn lại nếu giữ: gọi thẳng API để duyệt phiếu cũ thay người khác.
- **Quyết định của chủ sản phẩm:** thu hồi cả 15.
- **Migration** `20260927160018_authorization_p1_5_retire_request_module_admin`:
  - Thu hồi 15 grant `system.rq.manage`; xóa cờ legacy RQ; có sao lưu và audit.
  - `request.template.manage` của 4 người không đổi.
- Dry-run (gồm cả rollback, đã sửa để khôi phục đúng thứ tự hai bản sao lưu cờ) **PASS**. **ĐÃ APPLY.** Smoke sau apply **PASS**.

## P1.6 — bucket chứa dữ liệu nhạy cảm sang private

### P1.6a — ảnh chấm công (`checkin-photos`)

- **Hiện trạng:**
  - 819 ảnh khuôn mặt nằm trong bucket public; policy xem là `bucket_id = 'checkin-photos'`, nên ai có link đều mở được, kể cả chưa đăng nhập.
  - Dữ liệu chấm công lưu URL công khai trong `hrm_attendance.events[].image_url`.
  - Chỉ trang Chấm công và Check-in hiển thị ảnh; RPC chấm công không kiểm tra dạng URL.
- **Frontend** (đã push lên main trước khi khóa bucket):
  - `lib/storageSignedUrl.ts` nhận diện URL cũ của bucket đã private và đổi sang signed URL có hạn 1 giờ (có cache).
  - Hook `useSignedStorageUrl` có đủ trạng thái trống / đang tải / lỗi. Component `components/hrm/AttendancePhoto.tsx` hiện ô chờ, và "Không xem được ảnh" khi không có quyền.
  - Dữ liệu cũ không phải sửa.
- **Migration** `20260927160626_authorization_p1_6_private_checkin_photos`: bucket private. Xem (và ký link) được nếu là người tải ảnh, Admin, hoặc người được xem chấm công của nhân viên đó (thư mục `<employeeId>/`, cùng quy tắc với `hrm_attendance`).
- **Kiểm tra:**
  - Dry-run và smoke sau apply **PASS**: chủ ảnh và Admin xem được; nhân viên không liên quan không xem được.
  - Đã tải một ảnh thật qua signed URL trên dev server nhánh P0.
  - Script rollback: `supabase/operations/authorization_p1_6_rollback.sql`.
- **Còn chờ — purge CDN:**
  - Sau khi apply, URL công khai cũ (đúng nguyên văn) vẫn trả về 200 cho các ảnh đã từng được mở, do Smart CDN giữ bản cache. Cùng URL thêm tham số thì trả 400, tức origin đã chặn.
  - Theo tài liệu Supabase, đổi bucket sang private không tự xóa cache. Cần gọi `DELETE /storage/v1/cdn/checkin-photos` bằng secret key.
  - `.env` không có secret key và agent không xử lý key này, nên **chủ sản phẩm chạy lệnh purge**. Sau khi purge, kiểm lại URL mẫu phải trả 400.

### P1.6b — `project-attachments` và `project-files`

- **Hiện trạng:**
  - `project-attachments` có 102 tệp: `quality/` 91, `tx/` 5, `site-direct-purchases/` 3, `chat/` 2, `task-completions/` 1. `project-files` có 13 tài liệu dưới `<projectId>/`.
  - Cả hai bucket public, đọc bằng policy `bucket_id = …`.
  - Tham chiếu trong dữ liệu: `quality_checklists` (ảnh, đính kèm, bản vẽ), `chat_messages`, `project_documents.storage_path`. Tệp `tx/`, `site-direct-purchases/`, `task-completions/` không có bảng nào tham chiếu.
- **Frontend** (đã push lên main trước khi khóa bucket):
  - `components/storage/PrivateStorageLinkResolver.tsx`, gắn một lần trong `Layout`, đổi URL công khai cũ của các bucket đã private sang signed URL ở mọi `img`/`a`/`iframe`/`video`… khi chúng vào DOM.
  - Resolver chặn click vào link chưa kịp ký và bọc `window.open`, nên mọi màn hình (kể cả `SupplyChainTab` của luồng V2) chạy tiếp mà không phải sửa từng nơi.
  - Chỉ nhận URL dạng `/object/public/`, không ký lại URL đã ký. Lỗi quyền hiện toast "Không mở được tệp".
  - `documentService.getSignedUrl` báo lỗi thay vì âm thầm quay về URL công khai; nút Xem / Tải của tab Tài liệu hiện toast khi lỗi.
  - Tải tệp bằng `fetch` trong `QualityTab` và `MediaViewer` ký link trước khi tải.
- **Migration** `20260927161923_authorization_p1_6_private_project_attachments_files`: hai bucket private. Người tải lên và Admin luôn đọc được. Quy tắc theo thư mục:
  - `quality/`: Room Chất lượng quyền xem, cùng cách đọc đường dẫn với `quality_storage_can_mutate`.
  - `chat/`: thành viên cuộc trò chuyện.
  - `site-direct-purchases/`: nhân sự dự án hoặc quản lý mua hàng công ty.
  - `task-completions/`: Room Tiến độ quyền xem.
  - `tx/`: người được xem Tài chính tất cả dự án.
  - `project-files/<projectId>/`: `project.documents.view` của dự án.
- **Kiểm tra:**
  - Dry-run: Admin đọc 102/102 và 13/13; 25/51 nhân viên đọc một phần tệp đính kèm (chủ yếu ảnh chất lượng theo Room); 45/51 đọc tài liệu (quyền "xem tài liệu" toàn công ty sẵn có); người không liên quan không đọc được gì.
  - **ĐÃ APPLY.** Smoke sau apply **PASS**. URL công khai của ảnh chất lượng giờ trả 400.
  - Trên dev server: ảnh chất lượng qua resolver tải được; xem trước PDF ở tab Tài liệu dùng signed URL.
  - Rollback: `supabase/operations/authorization_p1_6b_rollback.sql`.
- **Còn chờ:**
  - Chủ sản phẩm purge cache CDN cho `project-attachments` và `project-files` (và `checkin-photos`), vì tệp từng được mở có thể còn trong Smart CDN.
  - `project_documents` vẫn cho mọi người đọc metadata (`select true`); đề xuất xử lý cùng P2.
  - `project-photos` (luồng Daily log) để phối hợp sau. `avatars` và `asset-images` giữ public.

### P1.6 — purge CDN (27/09)

- Chủ sản phẩm đã purge cache CDN cho `checkin-photos`, `project-attachments`, `project-files`.
- Kiểm lại URL công khai cũ: 25 ảnh chấm công, 25 tệp đính kèm và 13 tài liệu mẫu đều trả **400**, cả URL nguyên văn lẫn URL có tham số chống cache.
- Trong ứng dụng, ảnh chấm công và ảnh chất lượng vẫn hiển thị qua signed URL.
- **P1.6a và P1.6b hoàn tất.**

## P2 — thông báo do server quyết định

### P2.1 — bật lại thông báo Quy trình chung

- **Hiện trạng trước khi làm:**
  - Cổng `workflow_notification_settings.enabled = false` từ 18/09. Cron vẫn chạy mỗi phút nhưng không gửi.
  - 78 sự kiện `PENDING`: giao bước 36, đã duyệt 22, đã gửi 13, từ chối 3, bình luận 2, mở lại 1, nhắc tên 1.
  - 68/78 sự kiện thuộc phiếu có subject `material_request`. Theo thiết kế 18/09 §9, loại này do module vật tư tự báo. Hàm gửi chỉ bỏ qua subject `request`/`project`, nên với `material_request` nó ghi `DELIVERED` cho 0 người (người nhận bị lọc vì `workflow_instance_user_can_select` chỉ đúng với phiếu không có subject).
  - Chạy thử gửi trước khi sửa: `DELIVERED`, 0 thông báo.
- **Quyết định của chủ sản phẩm:** gửi bù bước còn chờ, bỏ phần lỗi thời; đóng 14 lỗi Phiếu yêu cầu, không gửi lại.
- **Migration** `20260927170749_notification_p2_1_enable_workflow_notifications`:
  - Hàm gửi bỏ qua thêm subject `material_request`, với nhãn `request_owned` như hai loại kia.
  - Backlog: chỉ giữ sự kiện "giao bước" của quy trình chung mà phiếu còn dừng đúng bước đó. Còn lại `SUPPRESSED` với lý do `request_owned` hoặc `p2_stale_backlog`.
  - 14 dòng `FAILED` của Phiếu yêu cầu (đã hết lượt thử, lịch dời tới 2126) được ghi chú `closed_p2_2026_09_27`.
  - Bật cổng.
- **Kiểm tra:**
  - Dry-run một chu kỳ worker dưới `service_role`: 1 sự kiện được claim, 1 thông báo tới đúng người được giao, link `/wf/<id>?node=<id>&event=workflow.step_assigned`.
  - **ĐÃ APPLY.** Chu kỳ cron thật: 1 `DELIVERED`, 1 thông báo WF mới, 0 dòng `PROCESSING` kẹt, 0 giao trùng, cron 5/5 thành công.
  - Bỏ qua: `request_owned` 68, `p2_stale_backlog` 9, `pre_rollout_backlog` 13 (từ trước).
  - Dừng khẩn cấp: `supabase/operations/notification_p2_1_rollback.sql` (tắt cổng).
- **Ghi chú cho luồng Procurement V2:** 11 bước duyệt phiếu Đề xuất vật tư đang chờ không được worker Quy trình chung báo (đúng thiết kế). Cần luồng vật tư xác nhận module của họ có báo cho người được giao.
- **Work** (cổng tắt từ 12/09, 31 sự kiện `dead`) chưa đụng tới: thuộc module Vioo Work.

### P2.2 — cảnh báo định kỳ chạy trên server (đợt 1: 6 loại)

- **Hiện trạng:**
  - 11 loại cảnh báo chỉ chạy trong trình duyệt khi có Admin mở app (15 phút/lần, mốc lưu `localStorage`).
  - 30 ngày gần nhất chỉ 4 loại từng gửi: thiếu bảng lương 48, sinh nhật 14, nhật ký trễ 3, nhắc chấm công 1.
  - Quy tắc Thanh toán quá hạn và Nhật ký trễ dùng mã quyền ngắn (`confirm`, `approve`, `verify`), không khớp grant nào, nên luôn rơi về chỉ gửi Admin.
- **Chủ sản phẩm chọn** làm trước 6 loại: thiếu bảng lương, sinh nhật, nhật ký trễ, nhắc chấm công, thanh toán quá hạn, HĐLĐ sắp hết hạn.
- **Migration** `20260928031025_notification_p2_2_server_scheduled_alerts`:
  - `app_private.run_scheduled_alerts()` theo giờ Việt Nam, pg_cron `server-scheduled-alerts` mỗi 5 phút.
  - Vẫn đọc ngưỡng, cooldown, kênh và cấu hình người nhận từ `notification_alert_rules`.
  - Người nhận:
    - quản trị module: capability `manage`, như `list_canonical_module_manager_ids`;
    - dự án: thành viên Room Thanh toán (xác nhận/duyệt) hoặc Room Nhật ký (kiểm tra);
    - chủ hồ sơ;
    - cộng Admin nếu cấu hình yêu cầu, hoặc Admin làm dự phòng khi không ai khớp. Chỉ tính Admin có tài khoản đăng nhập, bỏ fixture.
  - Cooldown theo `source_type`/`source_id` như bản cũ.
  - RPC `run_scheduled_alerts_now()` chỉ cho Admin, dùng cho nút "Chạy kiểm tra ngay".
  - **Nhắc chấm công tắt** theo quyết định chủ sản phẩm: chạy trên server sẽ nhắc mọi nhân viên chưa chấm công mỗi sáng (thử một văn phòng: 43 người). Bật lại ở Cài đặt → Cảnh báo sau khi đã báo trước cho nhân viên.
- **Frontend:**
  - Trình duyệt bỏ qua 6 loại này (`SERVER_SCHEDULED_ALERT_KEYS`), nên không gửi trùng; 5 loại còn lại vẫn chạy trong trình duyệt tới đợt 2.
  - Nút "Chạy kiểm tra ngay" gọi server.
  - Mỗi quy tắc có nhãn "Server tự chạy mỗi 5 phút" hoặc "Chỉ chạy khi Admin mở ứng dụng".
- **Kiểm tra:**
  - Dry-run với cooldown tạm đặt 0: thiếu bảng lương → 10 người (9 quản trị HRM và Admin).
  - Smoke dữ liệu giả: thanh toán quá hạn tới đúng người duyệt Room Thanh toán cộng Admin (7); nhắc chấm công chỉ tới nhân viên chưa chấm; lần chạy thứ hai trong cooldown không gửi lặp.
  - **ĐÃ APPLY** (server apply trước, sau đó mới push frontend). Smoke sau apply **PASS**; cron `*/5` đang active.
  - Dừng khẩn cấp: `supabase/operations/notification_p2_2_rollback.sql`.

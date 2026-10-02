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

### P2.2 — đợt 2: 5 cảnh báo còn lại lên server, bỏ quét trong trình duyệt

- **Hiện trạng trước khi làm:**
  - 5 loại còn chạy trong trình duyệt Admin: vượt ngân sách, tiến độ chậm (đang tắt), hao hụt vật tư, yêu cầu quá hạn, sự cố an toàn nghiêm trọng.
  - Yêu cầu quá hạn không bao giờ khớp: trình duyệt so trạng thái chữ thường, còn `request_instances` lưu chữ hoa. Ngoài ra chưa phiếu nào có `due_date` (0/24).
  - An toàn nghiêm trọng chỉ gửi một lần lúc thao tác, và chỉ khi sự cố hoặc thiết bị chưa giao người xử lý.
  - 18/20 dòng `project_finances` chỉ có công trường, không có `project_id`; cả 18 dòng đều tra ra dự án qua `projects.construction_site_id`.
  - Room Kế hoạch vật tư chỉ có quyền xem/sửa/xoá, nên mã `confirm`/`approve` của quy tắc hao hụt không khớp ai.
- **Migration** `20260928035750_notification_p2_2_server_scheduled_alerts_group2`:
  - `run_scheduled_alerts()` có đủ 11 loại. Người nhận theo Room:
    - vượt ngân sách: người được mở xem Tài chính (công tắc theo dự án hoặc tất cả dự án), cộng thành viên Room Thanh toán / Nghiệm thu có quyền xử lý khớp quy tắc; quyền chỉ xem không được tính;
    - tiến độ chậm: Room `gantt`;
    - hao hụt: Room `material_planning`, quy tắc đổi sang quyền `edit`; bảng vật tư của luồng V2 chỉ được đọc;
    - an toàn: Room `safety`; nhắc mỗi ngày (theo cooldown) khi sự cố nghiêm trọng hoặc quá hạn chưa đóng, và khi thiết bị hết hạn kiểm định;
    - yêu cầu quá hạn: quản trị module RQ.
  - Bộ giải người nhận hỗ trợ thêm chế độ "Theo vai trò" và "Broadcast" có trong Cài đặt; chế độ "Người nhận cụ thể" chỉ giữ tài khoản đang hoạt động.
- **Frontend:**
  - Bỏ hẳn phần quét trong trình duyệt, mốc `localStorage`, bộ giải người nhận phía client và `notifyAlert`. Tổng cộng xoá khoảng 700 dòng.
  - `safetyService` chỉ còn báo cho người được giao; cảnh báo không có người nhận cụ thể do server gửi.
  - Chuông thông báo: không tự quét mỗi 15 phút nữa; nút ↻ chỉ làm mới danh sách (nhãn "Làm mới thông báo").
  - Cài đặt → Cảnh báo:
    - bỏ nhãn từng quy tắc; tiêu đề ghi "máy chủ tự kiểm tra mỗi 5 phút";
    - quy tắc theo quyền dự án ghi rõ Room áp dụng;
    - "Chạy kiểm tra ngay" gọi `run_scheduled_alerts_now()`.
  - Contract test mới: `lib/__tests__/serverScheduledAlertsContract.test.ts`.
- **Kiểm tra:**
  - Dry-run với dữ liệu giả (ngân sách 120%, tiến độ 5%, hao hụt 12%, một phiếu quá hạn):
    - cả 5 loại đều gửi, lần chạy thứ hai trong cooldown không gửi lặp;
    - người nhận ngân sách = người xem Tài chính cộng Admin, nhiều hơn chỉ Admin;
    - người nhận hao hụt = người sửa Room Kế hoạch vật tư cộng Admin;
    - người nhận an toàn = người xác nhận/duyệt Room An toàn cộng Admin;
    - chế độ vai trò và người nhận cụ thể đúng.
  - Tác động trên dữ liệu thật hôm nay: chỉ An toàn gửi, 48 thông báo tới 12 người từ 4 nguồn (1 sự cố, 3 thiết bị). 4 loại còn lại gửi 0.
  - Dry-run script rollback: khôi phục hàm đợt 1, xoá helper tài chính, trả mã quyền hao hụt.
  - **ĐÃ APPLY** 28/09 sau khi chủ sản phẩm chọn "Apply như trên", gồm cả nhắc thiết bị hết hạn kiểm định. Server apply trước, frontend push sau. Smoke sau apply **PASS**; đã kiểm không còn dữ liệu giả.
  - Rollback: `supabase/operations/notification_p2_2_group2_rollback.sql`. Script này cần đi kèm rollback frontend, vì trình duyệt không còn quét.

## Thông báo đúng người — bước 1: ghi lý do nhận

- **Bối cảnh:** chủ sản phẩm muốn thông báo tới đúng người, tách thông báo hệ thống, được giao việc, được @nhắc, đang theo dõi và thuộc nghiệp vụ mình phụ trách. Bước 1 chỉ ghi lý do nhận và thêm tab lọc; **ai nhận thông báo nào không đổi**. Chưa có danh mục chức vụ BCH, nên việc chỉ định người nhận theo chức vụ để sang bước 2.
- **Migration** `20260928044404_notification_delivery_reason`:
  - Cột `notifications.delivery_reason` (bắt buộc), gồm 5 giá trị: `assigned`, `mentioned`, `watching`, `responsible`, `system`.
  - Hàm `app_private.notification_delivery_reason(...)` và trigger BEFORE INSERT tự gán lý do nếu nơi tạo thông báo không truyền. Phiếu yêu cầu và quy trình được tính là "cần xử lý" khi người nhận đang giữ bước duyệt `PENDING`.
  - Backfill 5.684 thông báo cũ theo cùng quy tắc. Với phiếu cũ, trạng thái bước duyệt lấy theo ngày 28/09.
  - Không sửa hàm gửi thông báo của luồng khác (Daily log, V2, Work, Chat); trigger tự phân loại cho họ.
- **Phân bố sau backfill:** cần xử lý 1.141, nhắc đến 287, theo dõi 883, phụ trách nghiệp vụ 2.602, thông báo chung 771. Ví dụ Phiếu yêu cầu 60 ngày qua: 68 cần xử lý, 5 nhắc đến, 341 theo dõi (trước đây trộn chung).
- **Frontend:**
  - Chuông và trang Thông báo có tab: Tất cả · Việc của tôi (giao việc + nhắc tên) · Theo dõi · Nghiệp vụ · Hệ thống. Mỗi tab có số chưa đọc, đếm chính xác trên máy chủ.
  - Mỗi thông báo có nhãn lý do. Có đủ trạng thái đang tải, lỗi (kèm Thử lại) và trống theo từng tab.
  - Trang Thông báo bỏ cách đoán nhóm cũ (`getNotificationWorkGroup`: cứ chưa đọc và thuộc quy trình là tính "cần xử lý").
- **Kiểm tra:**
  - Dry-run và smoke persona đều PASS: người duyệt đang chờ → cần xử lý, người tạo phiếu → theo dõi, được nhắc → nhắc đến, cảnh báo → phụ trách, broadcast → chung. Lý do truyền sẵn được giữ nguyên, giá trị sai bị chặn, người nhận đọc được lý do của mình.
  - Dry-run script rollback PASS.
  - **ĐÃ APPLY** 28/09 sau khi chủ sản phẩm đồng ý; server apply trước, frontend push sau. Smoke sau apply PASS, không còn dữ liệu giả.
  - Rollback: `supabase/operations/notification_delivery_reason_rollback.sql`; phải rollback frontend trước.

## Thông báo đúng người — bước 2 (phần 1): Ban chỉ huy công trường và xem trước người nhận

- **Quyết định chủ sản phẩm (28/09):**
  - BCH gồm Chỉ huy trưởng, Chỉ huy phó và Kỹ thuật trưởng.
  - Cảnh báo An toàn chỉ gửi Room An toàn và BCH; Admin chỉ nhận khi dự án không có ai phụ trách.
- **Dữ liệu:**
  - Chức vụ nằm ở `hrm_positions`, mỗi BCH một chức vụ: VT015/VT016 Chỉ huy trưởng BCH RICO/SMB, VT024/VT025 Chỉ huy phó, VT076 Kĩ thuật trưởng.
  - Chỉ 6/86 dự án có nhân sự dự án, và **chưa ai được gán chức vụ Chỉ huy trưởng**; hiện có 2 Chỉ huy phó và 2 Kĩ thuật trưởng.
- **Migration** `20260928052528_notification_site_command_recipients`:
  - Bảng `notification_site_command_positions` lưu chức vụ nào thuộc BCH. Không lưu thành cột trên `hrm_positions`, vì người quản lý danh mục nhân sự có quyền ghi mọi cột của bảng đó. Chỉ Admin sửa qua RPC `set_site_command_positions`, có ghi `audit_trail`.
  - `alert_site_command_ids(project, site)`: người đang giữ chức vụ BCH trong nhân sự của đúng dự án và công trường.
  - Cấu hình người nhận có thêm `includeSiteCommand`.
  - RPC `preview_alert_recipients(alertKey, project, config)` chỉ cho Admin: trả danh sách người nhận thật kèm lý do (Room/quyền, BCH, Admin, Admin dự phòng), tính theo cấu hình đang sửa kể cả khi chưa lưu.
  - Quy tắc `safety_critical`: `includeSiteCommand = true`, `includeAdmins = false`.
- **Tác động trên dữ liệu thật:** mỗi nguồn cảnh báo An toàn trước đây tới 12 người (Room 11, gồm 1 Admin, cộng 1 Admin khác); giờ vẫn 12 người nhưng đổi thành Room 11 + 1 người BCH chưa có trong Room, Admin không có trong Room không nhận nữa.
- **Frontend (Cài đặt → Cảnh báo):**
  - Thẻ "Ban chỉ huy công trường": chức vụ đang chọn kèm số người giữ, sửa bằng danh sách có tìm kiếm. Hiện cảnh báo khi chưa ai giữ chức vụ Chỉ huy trưởng.
  - Ô "Kèm Ban chỉ huy công trường" cho các quy tắc theo quyền dự án.
  - Phần "Xem trước người nhận" ở mỗi quy tắc: chọn dự án rồi xem danh sách tên kèm lý do. Có đủ trạng thái đang tải, lỗi và không ai nhận.
- **Kiểm tra:**
  - Dry-run, smoke persona và dry-run rollback đều PASS. Smoke kiểm: chỉ gồm người giữ CHT/CHP/KTT của đúng dự án; bật hoặc tắt tuỳ chọn chỉ thêm hoặc bớt đúng BCH; nhân viên không sửa được BCH và không xem trước được; Admin sửa được, có ghi nhật ký; chức vụ không tồn tại bị chặn; danh sách xem trước khớp người nhận thật.
  - **ĐÃ APPLY** 28/09. Smoke sau apply PASS, không để lại dữ liệu hay dòng nhật ký test.
  - Rollback: `supabase/operations/notification_site_command_recipients_rollback.sql`, kèm rollback màn Cài đặt.

## Thông báo đúng người — bước 2 (phần 2): thông báo theo sự kiện của Phiếu yêu cầu và An toàn

- **Số liệu 60 ngày trước khi sửa:**
  - Phiếu yêu cầu: người theo dõi (56 người do mẫu phiếu tự thêm) nhận mọi sự kiện, chỉ đọc 12%. Riêng bình luận: 123 thông báo, đọc 5%.
  - **Lỗi:** nhắc sắp đến hạn/quá hạn không tới người duyệt đang chậm (0 thông báo), chỉ tới người tạo và người theo dõi.
  - Sự cố An toàn: chỉ báo người được giao. Sự cố chưa giao thì không ai nhận, trừ nhắc định kỳ cho mức Nghiêm trọng.
- **Quyết định chủ sản phẩm (28/09):**
  - Người theo dõi chỉ nhận kết quả cuối và quá hạn.
  - Người duyệt đang chờ nhận nhắc hạn của bước mình và bình luận mới.
  - Sự cố mức Cao/Nghiêm trọng báo ngay Room An toàn + BCH.
- **Migration** `20260928062658_notification_event_recipients_request_safety`:
  - `enqueue_request_notification_event`: chỉ đổi phần chia thêm cho người liên quan; người nhận chính do module ghi giữ nguyên. Nhắc hạn chỉ tới người duyệt của đúng bước (`nodeId`).
  - Trigger `trg_safety_issue_notify` trên `safety_issues` (tạo mới, đổi người xử lý, đổi trạng thái):
    - người được giao → `assigned`;
    - Room An toàn (xác nhận/duyệt) + BCH khi mức Cao/Nghiêm trọng → `responsible`;
    - người ghi nhận khi đã khắc phục/đóng → `watching`;
    - không gửi cho người vừa thao tác.
  - `lib/safetyService.ts` bỏ toàn bộ việc gửi thông báo từ trình duyệt.
- **Ước tính tác động** (áp cho 60 ngày qua): người theo dõi phiếu yêu cầu bớt khoảng 228/305 thông báo (~75%).
- **Kiểm tra:**
  - Dry-run và smoke đều PASS. Smoke kiểm từng sự kiện phiếu với người tạo, người theo dõi và người duyệt; sự cố Cao tới đúng người được giao + Room + BCH, không tới người ghi nhận; sự cố Thấp chỉ tới người được giao; khi khắc phục xong báo người được giao và người ghi nhận.
  - Rollback dry-run PASS.
  - **ĐÃ APPLY** 28/09 sau khi chủ sản phẩm đồng ý. Frontend push sau khoảng vài chục phút vì công cụ agent bị gián đoạn; trong khoảng đó người được giao sự cố có thể nhận trùng. Smoke sau apply PASS, không để lại dữ liệu test.
  - Rollback: `supabase/operations/notification_event_recipients_request_safety_rollback.sql`, kèm rollback `safetyService`.
- **Đề xuất cho luồng khác (chưa sửa):** Nhật ký "đã xác nhận" gửi người lập (đọc 12%), "chờ CHT duyệt" (đọc 24%); SLA phiếu vật tư (đọc 33%).

## Thông báo đúng người — bước 3: tuỳ chọn cá nhân và tổng hợp cuối ngày

- **Quyết định chủ sản phẩm (28/09):** loại "Nghiệp vụ" chỉ được chuyển sang tổng hợp cuối ngày, không được tắt.
- **Migration** `20260928065520_notification_preferences_digest`:
  - Cột `notifications.delivery_mode` (`instant` / `digest` / `muted`, mặc định `instant`). Toàn bộ thông báo cũ giữ `instant`.
  - Bảng `notification_preferences`:
    - Theo dõi: báo ngay / tổng hợp / không báo.
    - Nghiệp vụ: báo ngay / tổng hợp; ràng buộc chặn việc tắt.
    - Giờ nhận tổng hợp: 06:00–22:00.
    - Mỗi người chỉ đọc dòng của mình (Admin đọc được tất cả). Chỉ ghi được qua RPC `set_my_notification_preferences`.
  - Trigger `notifications_set_delivery_reason` áp tuỳ chọn khi tạo thông báo, chỉ cho loại theo dõi và nghiệp vụ không nghiêm trọng:
    - tổng hợp → `digest`, không đẩy lên điện thoại;
    - không báo → `muted`, tự đánh dấu đã đọc, vẫn lưu trong hộp thư.
  - Cron `notification-digests` (`*/15`): đến giờ đã chọn, gửi một tin "📬 Tổng hợp thông báo hôm nay" kèm số lượng từng loại; mỗi ngày tối đa một lần và chỉ gửi khi có nội dung.
- **Frontend:**
  - Trang Thông báo có thẻ "Cách nhận thông báo", mở bằng nút ở đầu trang hoặc biểu tượng bánh răng ở chuông. Mục "Việc của tôi" hiện là "Luôn báo ngay".
  - Số đỏ trên chuông chỉ tính thông báo `instant`. Thông báo thuộc diện tổng hợp đến mà không kêu, không bật thông báo trình duyệt, nhưng vẫn tính vào số chưa đọc của từng tab.
- **Kiểm tra:**
  - Dry-run và smoke persona đều PASS:
    - thông báo cũ giữ nguyên;
    - tổng hợp và không báo áp đúng; cảnh báo nghiêm trọng và việc được giao vẫn báo ngay;
    - bản tổng hợp gửi đúng một lần, đúng số lượng, và không gửi trước giờ đã chọn;
    - người dùng lưu được tuỳ chọn của mình, không tắt được "Nghiệp vụ", không đọc hay ghi được tuỳ chọn của người khác.
  - Rollback dry-run PASS.
  - **ĐÃ APPLY** 28/09 sau khi chủ sản phẩm đồng ý. Chưa ai có tuỳ chọn riêng, nên không ai bị thay đổi cho tới khi tự chọn. Smoke sau apply PASS, không để lại dữ liệu test.
  - Rollback: `supabase/operations/notification_preferences_digest_rollback.sql`; phải rollback frontend trước.

## P2 — màn Cài đặt → Người dùng

- **Vấn đề** (audit P2, cộng hai lỗi phát hiện thêm khi làm):
  - Màn sửa người dùng hiện "0 Room" vì chỉ tải được snapshot quyền của người đang đăng nhập.
  - Phạm vi quyền phải gõ UUID và hiển thị UUID thô.
  - Lộ thuật ngữ kỹ thuật (direct grants, Template, mã quyền).
  - Khối "Dữ liệu legacy" luôn báo "Đang theo dõi fallback".
  - Link Room tải lại toàn trang và không mở đúng dự án.
  - Drawer có ngõ cụt ở tab Mật khẩu và tab Chỉnh sửa; "Kho phụ trách" hiện "toàn bộ kho" khi chưa gán.
  - **Mới phát hiện:** tab "Lịch sử đăng nhập" hiện dữ liệu bịa (IP cố định, thời gian tự sinh); trạng thái "Online" mặc định online cho mọi người.
- **Migration** `20260928080828_authorization_user_snapshot_for_admins`: RPC chỉ đọc `get_user_authorization_snapshot(p_user_id)`, cùng dạng với `get_my_authorization_snapshot`. Chỉ chính người đó, Admin hoặc người có `system.authorization.manage_grants` được gọi.
- **Frontend:**
  - `UserModal` tải snapshot của người đang sửa, có trạng thái đang tải và lỗi kèm Thử lại.
  - `ProjectRoomSummary` liệt kê dự án → Room → thao tác. Bấm tên dự án mở `#/da?projectId=…&tab=permissions` ở thẻ mới nên không mất bản đang sửa. Admin hiện "toàn quyền mọi dự án".
  - `permissionScopeEntities`: chọn dự án, công trường, kho, đơn vị từ danh sách. Tên thay UUID ở dòng quyền, phần xem trước thay đổi và phần gỡ theo phạm vi.
  - Bỏ `LegacyPermissionReadOnly`. Thay thuật ngữ bằng tiếng Việt; đổi "Vai trò hệ thống" thành "Loại tài khoản".
  - `SettingsUsers`:
    - Online lấy từ `user_sessions` (phiên hoạt động, thấy trong 5 phút); chưa biết thì không hiện.
    - "Lịch sử đăng nhập" mở `/admin/activity` (dữ liệu thật); bỏ modal dữ liệu giả.
    - Drawer: nút "Chỉnh sửa & phân quyền" ở đầu, bỏ tab Chỉnh sửa và Mật khẩu. Nói rõ màn này chưa hỗ trợ Admin đặt lại mật khẩu.
    - Kho phụ trách hiện đúng: chưa gán / toàn bộ kho / tên kho.
- **Kiểm tra:**
  - Dry-run và smoke persona PASS: Admin thấy đúng 22 thao tác Room trên 2 dự án của người được sửa, khớp với snapshot của chính người đó; nhân viên thường bị chặn.
  - **ĐÃ APPLY** 28/09 sau khi chủ sản phẩm đồng ý; smoke sau apply PASS.
  - Vitest 2.333 pass, `tsc` và build pass, kiểm tra truy vấn 0 lỗi.
  - Chưa walkthrough giao diện vì browser pane của agent chưa đăng nhập.
- **Còn mở:**
  - Lý do tối thiểu 10 ký tự vẫn bắt buộc cả khi chỉ sửa số điện thoại, vì RPC `update_user_authorization_v2` ép điều này.
  - Chưa có cách Admin đặt lại mật khẩu cho người khác.
  - Danh sách người dùng chưa có cột tóm tắt quyền; để P3 "Hồ sơ quyền".
- Rollback: `supabase/operations/authorization_user_snapshot_for_admins_rollback.sql`, kèm rollback frontend.

## P2 — `project_documents` và `activities` hết `select true`; Admin đặt mật khẩu cho người khác

### Tài liệu dự án và nhật ký hoạt động

- **Trước khi sửa:**
  - `project_documents` (13 tài liệu): mọi người đọc được. Ai cũng thêm được tài liệu vào bất kỳ dự án nào. Chỉ Admin sửa/xoá được; người khác bấm xoá thì không có gì xảy ra mà cũng không báo lỗi.
  - `uploaded_by` lưu **tên hiển thị**, không phải mã tài khoản.
  - `activities` (3.217 dòng, gồm 693 dòng thao tác quản trị về người dùng, nhân sự, tài sản): mọi người đọc được. Việc ghi dưới tên người khác đã bị trigger `activities_stamp_actor` (P0-B) chặn.
- **Migration** `20260928083215_authorization_p2_documents_activities_rls`:
  - Tài liệu:
    - Đọc: Admin hoặc quyền `project.documents` xem/quản trị của đúng dự án (cùng quy tắc với tệp ở P1.6).
    - Thêm: quyền tải lên hoặc quản trị.
    - Sửa: quyền sửa thông tin hoặc quản trị.
    - Xoá: quyền xoá/xoá tất cả/quản trị, hoặc người tải lên có quyền xoá của mình.
    - Thêm cột `created_by`, tự điền mã tài khoản người tải lên.
  - Nhật ký:
    - Dòng Kho (vật tư, phiếu, yêu cầu): người được xem kho đó.
    - Dòng quản trị: chỉ Admin và chính người làm.
    - Quyền kho tính **một lần cho mỗi truy vấn** qua `activity_wms_scope()`. Kiểm từng dòng mất hơn 2 phút trên 3.200 dòng; tải 50 dòng nhật ký giờ khoảng 0,16 giây.
- **Tác động đo trên dữ liệu thật:**
  - Tài liệu: 50 người vẫn xem đủ, 7 người không còn thấy.
  - Nhật ký: 41 người có quyền Kho vẫn thấy toàn bộ khoảng 2.524 dòng Kho nhưng không còn thấy thao tác quản trị của người khác; 12 người không có quyền Kho không còn thấy nhật ký.
- **Frontend:** `documentService`
  - Tải lên, sửa và xoá báo lỗi rõ, không còn im lặng khi thất bại. Trước đây ghi thông tin thất bại mà tab vẫn báo "Tải lên thành công".
  - Khi xoá, xoá thông tin trước rồi mới xoá tệp, để không mất tệp khi bị chặn.
- **Kiểm tra:** dry-run, smoke persona và rollback dry-run PASS. **ĐÃ APPLY** 28/09; smoke sau apply PASS, không để lại dữ liệu test.
- **Rollback:** `supabase/operations/authorization_p2_documents_activities_rls_rollback.sql`.

### Admin đặt mật khẩu mới cho người khác

- **Trước khi sửa:** Edge Function `reset-password` (v16) đã cho Admin đặt mật khẩu hoặc email của người khác qua API, nhưng:
  - không ghi nhật ký;
  - mật khẩu chỉ cần 6 ký tự;
  - đặt được cho cả tài khoản đã vô hiệu hoá, đi vòng qua luồng Khôi phục.
- **Đã deploy v17** (chủ sản phẩm đồng ý 28/09):
  - Mật khẩu ≥ 8 ký tự.
  - Khi đổi cho người khác: bắt buộc là Admin, tài khoản đang hoạt động, có lý do ≥ 10 ký tự, và ghi `audit_trail` (không lưu mật khẩu).
  - Tự đổi của chính mình giữ nguyên hành vi.
  - Kiểm tra sau deploy: lời gọi không có tài khoản bị từ chối 401. Chưa thử luồng Admin thật, vì agent không dùng mật khẩu thật.
- **Frontend:** drawer người dùng có nút "Đặt mật khẩu mới" (nhập hai lần, có nút hiện/ẩn, kèm lý do). Chỉ Admin thấy, không áp cho chính mình; tài khoản vô hiệu hoá được hướng sang "Khôi phục tài khoản".
- **Rollback:** deploy lại bản v16 từ git (commit trước `supabase/functions/reset-password/index.ts`).

## P1.6c — bucket `project-photos` (ảnh nhật ký) sang private

- **Trước khi sửa:**
  - Bucket công khai: 1.654 ảnh, khoảng 1,5 GB, tất cả dưới `dailylogs/<projectId>/`.
  - Ai có link đều mở được, kể cả không đăng nhập.
  - Ai đăng nhập cũng tải ảnh vào bất kỳ thư mục nào.
- **Migration** `20260928084924_authorization_p1_6_private_project_photos`:
  - Bucket private.
  - Đọc: người tải ảnh, Admin, hoặc người xem được nhật ký của dự án đó. Hàm `project_photo_folder_visible` tra công trường của dự án rồi gọi `daily_log_can_select`, vì hàm này cần đúng công trường; truyền `null` thì không ai qua được.
  - Tải lên: chỉ vào thư mục của dự án mình xem được nhật ký.
- **Tác động:** 21 / 7 / 12 người đọc được ảnh ở 3 dự án có ảnh, khớp với số người đọc được `daily_logs`.
- **Frontend:** thêm `project-photos` vào `PRIVATE_LEGACY_PUBLIC_BUCKETS`, push trước khi đổi bucket (`64927cc`).
  - `PrivateStorageLinkResolver` tự ký link công khai cũ khi hiển thị, nên `DailyLogTab` và `GanttTab` **không phải sửa**.
- **Ghi cho luồng Daily log:** `DailyLogTab.handleUploadPhoto` vẫn lưu `getPublicUrl(...)`. Link này vẫn hiển thị được nhờ resolver, nhưng nên chuyển sang lưu đường dẫn và ký bằng `useSignedStorageUrl` / `resolveStorageUrl`. Việc tải ảnh giờ cần quyền xem nhật ký của dự án.
- **Kiểm tra:** dry-run, smoke persona và rollback dry-run PASS.
- **Rollback:** `supabase/operations/authorization_p1_6_private_project_photos_rollback.sql`.
- **ĐÃ APPLY** 28/09 sau khi chủ sản phẩm đồng ý. Giao diện được push trước (chờ 2 phút cho bản deploy), rồi mới đổi bucket. Smoke sau apply PASS; URL công khai mẫu trả 400.
- **Còn chờ:** chủ sản phẩm purge CDN `DELETE /storage/v1/cdn/project-photos` bằng secret key, vì ảnh từng được mở có thể vẫn nằm trong cache Smart CDN.

## P3 — mẫu quyền dự án theo vai trò và phân quyền theo người

- **Vấn đề:**
  - Phân quyền dự án đi theo từng Room: muốn cấp cho một Chỉ huy trưởng phải mở khoảng 10 Room để tick. Hiện chỉ 6/86 dự án có Room (591 quyền, 74 người).
  - Bộ mẫu cũ trong code (`PROJECT_PERMISSION_TEMPLATES`) cấp mã `project.*`, không còn tác dụng với các phân hệ đã chuyển sang Room.
- **Chủ sản phẩm (28/09):** đồng ý phân nhanh theo vị trí, nhưng **phải chỉnh riêng được cho từng nhân viên khi áp**, ví dụ QS được thêm quyền xem nghiệp vụ khác hoặc bỏ một quyền trong mẫu.
- **Migration** `20260928092719_authorization_p3_project_room_templates`:
  - Bảng `project_room_templates`: mẫu gồm Room và thao tác, cùng chức vụ gợi ý. Mọi người đăng nhập được đọc; chỉ Admin sửa qua `save_project_room_template` (có kiểm tra thao tác hợp lệ, tự thêm "Xem" làm tiên quyết, ghi nhật ký).
  - `get_project_staff_room_actions`: quyền Room hiện có của một người.
  - `apply_project_room_template`, chỉ Admin:
    - chế độ `merge`, `replace`, hoặc `exact` (lưu đúng bộ quyền đã chỉnh riêng);
    - có chế độ chỉ xem trước (`p_dry_run`);
    - gọi lại `replace_project_permission_room_members` cho từng Room, nên giữ mọi ràng buộc Room;
    - ghi nhật ký "Áp mẫu … (có tùy chỉnh)".
  - Sáu mẫu mặc định: Chỉ huy trưởng/phó, Kỹ thuật hiện trường, QS, Thủ kho công trường, Kế toán dự án, Chỉ xem. Chức vụ gợi ý được gắn theo tên. **Migration không gán quyền cho ai.**
- **Frontend:**
  - Dự án → tab Phân quyền → "Phân quyền theo người":
    - chọn người → hiện quyền đang có → (tuỳ chọn) điền theo mẫu gợi ý theo chức vụ, kiểu thêm vào hoặc thay bằng mẫu;
    - bảng 10 Room để thêm hoặc bỏ từng quyền (xanh = sẽ thêm, gạch đỏ = sẽ gỡ) → Lưu.
  - Cài đặt → "Mẫu quyền dự án" để sửa mẫu.
  - Thay câu "Room-authoritative · PBAC fallback" bằng tiếng Việt.
- **Kiểm tra:**
  - Dry-run, smoke persona và rollback dry-run PASS. Smoke kiểm: xem trước khớp với khi áp; chế độ thay và chế độ lưu đúng bộ đã chỉnh; quyền của người khác không đổi; nhân viên thường bị chặn; có nhật ký.
  - **ĐÃ APPLY** 28/09; smoke sau apply PASS.
- **Còn mở:** form tạo dự án vẫn gán người bằng bộ mẫu cũ (`buildSeedProjectRoleGrants` trong `ProjectDashboard`), những người này không có quyền Room. Nên chuyển sang mẫu Room.
- **Rollback:** `supabase/operations/authorization_p3_project_room_templates_rollback.sql`.

### P3 — form tạo dự án áp mẫu Room (28/09)

- **Vấn đề:** người được thêm khi tạo dự án (Quản trị / Thực hiện / Người theo dõi, cả khi nhập Excel) chỉ nhận mã `project.*` từ bộ mẫu cũ, nên **không có quyền trong các Room**.
- **Sửa (frontend, không đổi máy chủ):**
  - Sau khi thêm người, áp mẫu Room qua `apply_project_room_template` (chế độ merge).
  - Mẫu chọn theo chức vụ gợi ý; nếu chức vụ không gợi ý mẫu nào thì: Quản trị → Chỉ huy trưởng, Thực hiện → Kỹ thuật hiện trường, Người theo dõi → Chỉ xem.
  - Vẫn giữ mã `project.*` cho các phân hệ chưa chuyển sang Room, ví dụ Tài liệu.
  - Người tạo không phải Admin: dự án vẫn được tạo, kèm thông báo nhờ Admin phân quyền Room.
  - Người nào áp mẫu lỗi thì có thông báo, kèm số người.
  - Nhập Excel chỉ báo khi có lỗi.
  - Form có dòng giải thích.

### P3 — chuyển vai trò thường sang quyền riêng từng người (28/09)

- Migration `20260928101825_authorization_p3_roles_to_personal_grants` (8aba991), **ĐÃ APPLY**:
  - chuyển BUSINESS_USER, WORKFLOW_USER, WORKFLOW_ADMIN, LEGACY_HR_*: 131 gán vai trò của 56 người thành 710 quyền riêng; thu hồi các gán vai trò đó;
  - kiểm tra trong migration: quyền hiệu lực của từng người không đổi;
  - bản sao lưu nằm ở `app_private.p3_roles_conversion_backup`.
- Giữ lại: AUDITOR 1, HR 2, HR_MANAGE 1, PERMISSION_ADMIN 1, SYSTEM_ADMIN 2. Mã HR nhạy cảm chỉ hiệu lực qua vai trò HR / HR_MANAGE.
- Rollback: `supabase/operations/authorization_p3_roles_to_personal_grants_rollback.sql`. Đã dry-run; khôi phục đúng từng dòng.
- **Lỗi hồi quy phát hiện sau apply (chưa sửa, chờ chủ sản phẩm):**
  - Có quyền cần ngày hết hạn nhưng được tạo không có hạn: `hrm.employee.edit_profile@own` ×54, global ×6, `hrm.attendance.approve` / `hrm.leave.approve` global ×6 mỗi loại.
  - `evaluate_direct_grant_replacement_impl` kiểm tra hạn cho mọi quyền trong lần lưu, nên lần lưu Người dùng tiếp theo của những người này bị từ chối (`expiry_required`).
  - Bản sửa đề xuất (miễn hạn cho quyền giữ nguyên, và quyền tự phục vụ phạm vi own, không nhạy cảm) bị bộ kiểm tra an toàn tự động chặn vì nới lỏng một kiểm tra.

### P3 — mẫu quyền theo vị trí cho toàn hệ thống (28/09)

- Migration `20260928113000_authorization_p3_user_permission_templates` (5aace83), **ĐÃ APPLY** (bản migration quá lớn cho MCP nên chạy bằng CLI trong một giao dịch và ghi `schema_migrations` trong cùng giao dịch đó):
  - bảng `user_permission_templates` (items: permissionCode, scopeType global/own/assigned, expiresInDays);
  - `save_user_permission_template`, chỉ Admin, có nhật ký;
  - chuẩn hóa mẫu: chỉ nhận mã cấp riêng được, không nhận mã dự án, không nhận phạm vi cần chọn đối tượng cụ thể; quyền cần hạn mặc định 365 ngày.
  - 14 mẫu theo bảng đã duyệt: Nhân viên cơ bản, Cán bộ vật tư/kho, Quản lý kho, Cán bộ công trường, Kế toán, Kế toán trưởng/TC, Nhân sự, Trưởng phòng NS, HC–Tài sản–Đội xe, Ban giám đốc, cùng 4 mẫu bổ sung Quản trị Quy trình / Phiếu yêu cầu / Tài sản / Công việc (651 dòng quyền). Chức vụ gợi ý gắn theo tên. **Không gán quyền cho ai.**
- Frontend:
  - Người dùng → Sửa → "Điền nhanh theo mẫu vị trí": mẫu gợi ý theo chức vụ (★), thêm vào quyền đang có hoặc thay bằng mẫu; bỏ qua quyền đã có từ vai trò; tự điền lý do; có nút Hoàn tác; lưu qua `update_user_authorization_v2`.
  - Cài đặt → "Mẫu quyền theo vị trí" để sửa mẫu.
- Kiểm tra:
  - dry-run và smoke persona PASS: nhân viên thường bị chặn sửa mẫu; mã không cấp riêng được và phạm vi kho bị từ chối; có nhật ký;
  - e2e fixture `tests/e2e/authorization-template-fill.spec.ts` PASS; Vitest 2.348 PASS.
- Rollback: `drop function public.save_user_permission_template(text,text,text,jsonb,uuid[],boolean); drop function app_private.normalize_user_permission_template_items(jsonb); drop table public.user_permission_templates;`

### P3 — giải thích ô quyền bị khóa (28/09, chỉ frontend)

- Người dùng → Sửa: ô không tick được có dòng 🔒 nói lý do và chỗ đổi. Mã HR nhạy cảm → tab Vai trò nhân sự (HR / HR Manage); vai trò quản trị → Cài đặt → Mẫu quyền (thu hồi); loại tài khoản → ô Loại tài khoản; mã dự án → Room dự án. Nhãn cũ "Cấp qua mẫu quyền" đổi thành "Qua vai trò HR" / "Chỉ vai trò quản trị", vì mẫu quyền theo vị trí không chứa các mã này.
- Test: `permissionLockReason.test.ts`, e2e phân quyền 5 PASS.

### P3 — giữ nguyên quyền cũ không có ngày hết hạn (02/10, mục 8.1)

- Nguyên nhân: bước chuyển vai trò → quyền riêng (28/09) không gắn hạn. Quyền vẫn chạy, nhưng Admin lưu bất kỳ thay đổi nào của người đó đều bị `expiry_required`; ô quyền không hạn còn bị khóa, không bỏ tick được.
- Chủ sản phẩm chọn phương án 1 (02/10). Migration `20261004100000_authorization_p3_keep_existing_no_expiry_grants`:
  - `evaluate_direct_grant_replacement_impl` không đòi hạn cho quyền **đã có**: đang hiệu lực, chưa thu hồi, không hạn, cùng mã + phạm vi + đối tượng. Quyền mới hoặc đổi phạm vi vẫn phải có hạn.
  - Frontend áp luật tương tự: `authorizationUpdateValidation.ts` và `PermissionModuleCard.tsx`.
  - Chưa miễn hạn cho phạm vi `own` không nhạy cảm (tùy chọn trong handoff); mẫu vị trí vẫn gắn hạn 365 ngày.
- Kiểm tra: dry-run (có rollback) PASS 4 tình huống; smoke trên hàm cũ thất bại đúng `expiry_required` (đối chứng); smoke sau apply PASS; Vitest 2.631 PASS; tsc sạch.
- Rollback: `supabase/operations/authorization_p3_keep_existing_no_expiry_grants_rollback.sql`.

### P3 — Hồ sơ quyền, bước 1: thẻ "Xem Tài chính và Hợp đồng" (02/10)

- Migration `20261004110000_authorization_p3_user_sensitive_view_summary`: RPC chỉ đọc `get_user_sensitive_view_summary(user_id)`, chỉ Admin. Trả về công tắc Tài chính / Hợp đồng của người đó (tất cả dự án, từng dự án), dự án tự động xem qua Room Thanh toán hoặc Nghiệm thu, và có phải người quản lý hợp đồng công ty không. Không đổi quyền của ai.
- Giao diện: Người dùng → Sửa có thêm thẻ chỉ đọc cùng kiểu thẻ Room; bật/tắt vẫn ở tab Phân quyền của dự án. Đủ trạng thái đang tải, lỗi (có Thử lại), chưa bật, Quản trị viên. Đã xem bằng fixture trong browser pane (5 trạng thái).
- Kiểm tra: dry-run PASS; smoke sau apply PASS (nhân viên bị chặn; bật/tắt từng dự án và tất cả dự án phản ánh đúng, không lẫn Tài chính ↔ Hợp đồng); Vitest 2.631 PASS; tsc, build, check-queries đạt. E2E Playwright không chạy được vì máy chưa cài trình duyệt Playwright.
- Rollback: `supabase/operations/authorization_p3_user_sensitive_view_summary_rollback.sql`.
- Còn lại của Hồ sơ quyền: gộp vai trò đặc biệt (HR, quản trị) vào cùng màn.

### P3 — bỏ lý do khi chỉ sửa hồ sơ; bỏ hạn cho phạm vi "Chính mình" (02/10, chủ sản phẩm duyệt)

- **Lý do:** Người dùng → Sửa không bắt lý do khi chỉ sửa hồ sơ (tên, điện thoại, ảnh, quản lý, kho). Vẫn bắt khi đổi quyền hoặc đổi loại tài khoản. Frontend tự ghi lý do mặc định "Cập nhật hồ sơ người dùng" để qua kiểm tra của server; server không đổi.
- **Hạn:** migration `20261004120000_authorization_p3_own_scope_no_expiry`:
  - `evaluate_direct_grant_replacement_impl` không đòi hạn cho phạm vi `own` của quyền không nhạy cảm (hiện chỉ `hrm.employee.edit_profile`);
  - `normalize_user_permission_template_items` không gắn hạn mặc định 365 ngày cho các dòng đó; 10 mẫu vị trí đã được chuẩn hóa lại (tất cả đều chỉ là mặc định 365, không có hạn tùy chỉnh bị mất);
  - frontend dùng chung hàm `grantRequiresExpiry(action, scope)`: ô nhập hạn, validation, điền theo mẫu, màn Cài đặt mẫu.
- Kiểm tra: dry-run PASS; smoke trên hàm cũ thất bại đúng (đối chứng); smoke sau apply PASS; smoke 8.1 chỉnh fixture sang quyền vẫn cần hạn, PASS; Vitest 2.633 PASS; tsc đạt.
- Rollback: `supabase/operations/authorization_p3_own_scope_no_expiry_rollback.sql`.

### P3 — màn Room cũ được thay bằng "Phân quyền theo người" (02/10, chủ sản phẩm duyệt)

- Tab Phân quyền của dự án không còn các thẻ Room + ngăn kéo sửa từng Room. Thay bằng:
  - **Phân quyền theo người** (`ProjectPersonRoomEditor`): chọn người → điền theo mẫu → thêm/bớt từng quyền → lưu. Nay theo đúng luật server: quyền "chưa áp dụng đầy đủ" (audit_only) bị khóa, quyền tiên quyết lấy từ bảng ràng buộc của server, mẫu không thêm được quyền audit_only (bỏ qua và báo số lượng), hiện nguồn quyền (Backfill từ PBAC) và cảnh báo PBAC ngoại lệ.
  - **Áp cho nhiều người** (`ProjectRoomBulkApply`): thêm theo mẫu / thay bằng mẫu / gỡ hết quyền Room, từng người một, cùng luật an toàn.
  - **Ai đang có quyền trong từng Room** (`ProjectRoomOverview`): tìm kiếm + lọc nhóm, số thành viên, cảnh báo thiếu người duyệt, số người chỉ có PBAC; bấm Room để xem người + quyền, nút "Sửa quyền" nhảy sang trình sửa theo người.
  - Công tắc Tài chính / Hợp đồng giữ nguyên.
- Logic nháp tách ra `lib/projectRoomPersonDraft.ts` (có test). Test viết bắt được một lỗi thật: "thay bằng mẫu" giữ quyền khóa nhưng bỏ mất quyền tiên quyết của nó (server sẽ từ chối), đã sửa.
- **Đối chiếu dữ liệu thật (giao dịch rollback, persona Admin, 7 phạm vi dự án/công trường, 84 người):**
  - mở từng người rồi lưu không đổi: **0 thay đổi** (server `apply_project_room_template` mode exact, dry-run);
  - quyền Room chỉ màn mới thấy: **0**;
  - quyền chỉ màn cũ thấy: **20**, đều thuộc đúng 8 thành viên đã rời dự án và tài khoản bị khóa; server không tính quyền cho họ (`project_user_has_room_action` đòi `end_date is null` và tài khoản đang hoạt động) → **0 quyền có hiệu lực bị bỏ sót**;
  - màn cũ còn đếm 8 người đó là "thành viên" và có thể tính họ là người duyệt (che cảnh báo thiếu người duyệt). Màn mới chỉ đếm người còn hiệu lực, đánh dấu và cho "Gỡ dòng cũ".
- Kiểm tra: Vitest 2.816 PASS; tsc, lint, build, check-queries, check-migrations đạt; giao diện xem bằng fixture ở desktop và mobile (không tràn ngang). E2E Playwright chưa chạy (máy chưa cài trình duyệt Playwright).

### P3 — Hồ sơ quyền, bước 2: vai trò đặc biệt trong màn theo người (02/10)

- Migration `20261004130000_authorization_p3_user_special_roles_summary`: RPC chỉ đọc `get_user_special_roles(user_id)`, chỉ Admin; trả các vai trò đang hiệu lực của một người (HR, HR Manage, Quản trị hệ thống, Quản trị phân quyền, Kiểm toán, ...). Không đổi quyền của ai.
- Người dùng → Sửa: khối **"Quyền đến từ nguồn khác"** gom 3 thẻ chỉ xem cạnh quyền riêng: Vai trò đặc biệt (kèm chỗ đổi), Xem Tài chính và Hợp đồng, Quyền trong Room dự án. Đủ trạng thái đang tải, lỗi (có Thử lại), rỗng.
- Lỗi bắt được khi viết smoke: `principal_type` lưu chữ thường `user`; smoke nay **bắt buộc** có người giữ vai trò (không âm thầm bỏ qua).
- Kiểm tra: dry-run PASS; smoke sau apply PASS (nhân viên bị chặn, người giữ vai trò thấy đúng vai trò, vai trò đã thu hồi không hiện); Vitest 2.819 PASS; tsc, lint, build, check-queries đạt; giao diện xem bằng fixture ở mobile.
- Rollback: `supabase/operations/authorization_p3_user_special_roles_summary_rollback.sql`.
- Hồ sơ quyền hoàn tất ở mức xem tổng hợp; việc gán/đổi vai trò vẫn ở Cài đặt → Vai trò đặc biệt và tab Vai trò nhân sự (chưa gộp vào một chỗ, chờ chủ sản phẩm quyết nếu muốn).

### Task 13 — bước 1: không còn quyết định quyền từ 4 cột legacy (02/10, chủ sản phẩm giao chọn phương án)

- Migration `20261004140000_authorization_task13_stop_reading_legacy_modules`:
  - 10 bảng danh mục dùng chung (loại / nhóm / lĩnh vực dự án, mẫu kiểm tra chất lượng, nhóm làm việc): **mọi tài khoản đang hoạt động được đọc**. Policy hạn chế `*_active_actor_gate` vẫn chặn tài khoản khóa. Ghi vẫn theo capability Cài đặt. Lý do chọn: dữ liệu tham chiếu không nhạy cảm, chỉ màn Dự án / Chất lượng / Cài đặt dùng; không ai mất quyền; không tốn hiệu năng như phương án "chỉ ai có quyền dự án".
  - `projects`: bỏ nhánh legacy `DA`; thêm `project_actor_is_active_staff`: **nhân sự đang làm ở dự án đọc được dòng dự án đó** (sửa lỗi có sẵn: thành viên Room không có grant `project.*` không đọc được dự án của mình).
  - 5 hàm Quy trình: bỏ nhánh `can_access_module('WF')`. 4 hàm chỉ chạy nhánh này khi hành động chưa enforced (mọi hành động đã enforced → nhánh chết). `workflow_actor_can_mutate_own_draft` có nhánh đang sống: 14 người có `WF` legacy thiếu quyền sửa/xóa bản nháp riêng, nhưng không ai trong số đó có quyền tạo quy trình và có 0 bản nháp đang mở → không mất thao tác thực tế.
  - 2 hàm Work workspace: bỏ nhánh `DA` (đã có đường grant dự án).
  - `can_access_module`: không còn ai gọi; chỉ còn trả đúng cho Admin, không đọc cột legacy.
- **Mô phỏng trước khi apply** (giao dịch rollback, persona từng người, 86 tài khoản đang hoạt động, đếm dòng đọc được ở 11 bảng trước/sau): **mất 0**; thêm: 32 người đọc được 10 bảng danh mục, 1 người đọc được dự án mình là nhân sự. Hàm/policy còn gọi `can_access_module`: 0.
- Smoke `authorization_task13_stop_reading_legacy_modules_smoke.sql` PASS sau apply (đối chứng trên schema cũ thất bại đúng). Các smoke P3 trước vẫn PASS. App thật (Admin): Dự án, danh mục dự án, Người dùng tải 200.
- **Frontend thôi đọc 4 cột:** bỏ khỏi kiểu `User`, hàm ánh xạ và câu select `users`; chỉ giữ nhãn trong `auditService` để đọc nhật ký cũ. Test cũ "trường legacy không cấp quyền" giữ nguyên ý nghĩa qua kiểu test `RetiredUserFields`.
- Kiểm tra: Vitest 2.819 PASS, tsc, lint, build, check-queries, check-migrations đạt; **e2e Playwright 5/5 PASS** (đã cài trình duyệt Playwright).
- **Mốc T0 quan sát Task 13: 02/10/2026** (apply bước 1). Theo runbook, xóa cột sớm nhất **09/10/2026**, sau khi backup + diễn tập khôi phục và dependency query rỗng.
- Rollback: `supabase/operations/authorization_task13_stop_reading_legacy_modules_rollback.sql`.

### Hợp đồng — quyền ghi theo đúng contract.*.manage (02/10, chủ sản phẩm cho phép apply)

- Báo lỗi: người được cấp đủ quyền Hợp đồng vẫn không tạo được hợp đồng đối tác; đã thành Admin vẫn không tạo được HĐ thầu phụ.
- Nguyên nhân 1 (máy chủ): ghi `business_partners`, `customer_contracts`, `supplier_contracts`, `contract_guarantees`, 4 bảng mẫu HĐ chỉ nhận `is_module_admin('HD')` (= `system.hd.manage`, không ai giữ); `subcontractor_contracts` chỉ nhận Admin (policy + trigger `authorization_v2_admin_write_guard`); 7 bảng thư viện đơn giá không nhận `contract.cost_library.manage`. Trong khi màn phân quyền/mẫu cấp `contract.*.manage`.
- Nguyên nhân 2 (giao diện): form HĐ thầu phụ và HĐ NCC thoát im lặng khi thiếu mã / tên / đơn vị; log máy chủ không có request tạo nào bị từ chối; giả lập tạo với tài khoản đó trên máy chủ thành công.
- Migration `20261004150000_authorization_contract_writes_follow_grants`: helper `app_private.contract_actor_can_manage(codes[])` (Admin, HD module admin, hoặc giữ một trong các mã); 34 policy ghi đổi sang mã tương ứng; bỏ trigger Admin-only trên riêng `subcontractor_contracts`. Không người không-Admin nào giữ `contract.*.manage` lúc apply → không ai tự có thêm quyền.
- Giao diện: nút Thêm/Sửa/Xóa/tải tệp ở Đối tác, HĐ khách hàng, HĐ NCC, HĐ thầu phụ, Loại & mẫu HĐ chỉ hiện khi có quyền; người chỉ xem thấy dòng giải thích cần quyền gì, cấp ở đâu; form báo rõ trường còn thiếu.
- Kiểm tra: dry-run đúng ma trận (chỉ xem: chặn hết; quản trị đối tác: chỉ đối tác; quản trị NCC: HĐ thầu phụ, không HĐ khách hàng); đối chứng trên schema cũ tái hiện đúng lỗi; smoke sau apply PASS; Vitest PASS, lint, build đạt.
- Rollback: `supabase/operations/authorization_contract_writes_follow_grants_rollback.sql`.
- Ghi nhận cho luồng khác (không sửa): trigger Admin-only còn trên `acceptance_records`, `boq_reconciliation_*`, `custom_material_*` (Mua hàng V2 / Dự án V2).

### Thu hồi quản trị Dự án legacy `system.da.manage` (02/10, chủ sản phẩm đồng ý)

- Theo quyết định 3. 39 grant đang hoạt động (37 người không phải Admin, 2 Admin); 27 trong số đó sinh ra từ bước chuyển dữ liệu legacy 10/09.
- Máy chủ không kiểm tra mã này. Giao diện chỉ dùng ở **Ma trận duyệt** (đường dự phòng cho dự án chưa có nhân sự dự án): 4 quy tắc duyệt thanh toán / xác nhận đã chi / duyệt phát sinh / duyệt nghiệm thu cho "quản trị Dự án". Dự án đã có nhân sự kiểm theo quyền dự án; Admin luôn duyệt được. Lịch sử: 1 lần duyệt thanh toán (do Admin), 0 lần qua mã này.
- Migration `20261004170000_authorization_revoke_legacy_da_admin`: sao lưu từng grant vào `app_private.da_admin_revocation_backup`, ghi 39 dòng `permission_audit_events`, thu hồi, tắt cấp trực tiếp mã này.
- Kiểm tra: dry-run kèm **diễn tập rollback** trong cùng giao dịch (khôi phục đủ 39 grant, 39 dòng audit); smoke sau apply PASS; smoke "giữ quyền cũ không hạn" vẫn PASS.
- Rollback: `supabase/operations/authorization_revoke_legacy_da_admin_rollback.sql` (khôi phục chính xác từng dòng từ bảng sao lưu).

### Ẩn 4 quyền "nhãn" khỏi màn phân quyền (02/10, chủ sản phẩm yêu cầu)

- Ẩn (ngừng kích hoạt): `booking.vehicle.trip.execute` (chuyến đi cấp theo phân công), `asset.catalog.manage`, `asset.maintenance.manage` (Tài sản dùng quyền chi tiết), `request.category.manage` (bảng danh mục phiếu không còn dùng). Không hàm, policy, màn hình hay vai trò đặc biệt nào dùng chúng.
- **Giữ** `booking.vehicle.handover` (giao diện dùng để hiện menu và trang Bàn giao xe) và `asset.audit.*` (việc sửa Kiểm kê tài sản sẽ dùng).
- Migration `20261004180000_authorization_retire_label_only_permissions`: sao lưu vào `app_private.label_permission_retirement_backup`; thu hồi 13 grant không có tác dụng (để Admin vẫn lưu được hồ sơ những người đó); gỡ 5 dòng khỏi mẫu vị trí; ngừng kích hoạt 4 mã.
- Kiểm tra: dry-run kèm diễn tập rollback (khôi phục đủ 4 mã, 13 grant, 5 dòng mẫu); smoke sau apply PASS; 14 mẫu còn 647 dòng, máy chủ công nhận 647/647; RPC danh mục của màn phân quyền không còn 4 mã. Danh mục giao diện và bản chụp `dbPermissionCatalog.json` cập nhật theo.
- Rollback: `supabase/operations/authorization_retire_label_only_permissions_rollback.sql`.

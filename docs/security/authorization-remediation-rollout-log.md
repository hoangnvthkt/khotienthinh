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

- **Migration:** `20260927140000_authorization_p0c_sensitive_view_grants.sql`. Tên file sẽ đổi theo version trong ledger khi apply.
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

Chưa làm. Chỉ làm sau khi Admin đã bật đủ công tắc. Frontend sẽ hiển thị "Chưa được mở quyền xem" thay vì số 0, và bỏ `is_module_admin('DA')` trên các bảng tài chính.

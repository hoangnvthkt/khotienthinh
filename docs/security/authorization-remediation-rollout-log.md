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

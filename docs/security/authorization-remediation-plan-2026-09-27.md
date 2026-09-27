# Phương án khắc phục Phân quyền, RLS và Notification — P0 → P3

**Ngày lập:** 27/09/2026 · **Căn cứ:** [audit 27/09](../audits/permission-rls-notification-2026-09-27/README.md) và quyết định của chủ sản phẩm cùng ngày.

**Môi trường:** Supabase Cloud main `ftciqmqhmfvjtwoycswe`. Không dùng Supabase local, Docker hay Branch.

**Nhánh làm việc:** `feature/authorization-p0-hardening` trong worktree `.worktrees/authorization-v2-task12-4-2`, tách khỏi checkout chính đang có thay đổi của hai luồng V2 và Daily log.

## 1. Quyết định của chủ sản phẩm (27/09/2026)

| # | Quyết định | Hệ quả thiết kế |
|---|---|---|
| Q1 | Tài chính dự án và Hợp đồng chỉ mở cho nhóm người nhất định trong dự án, bằng **công tắc bật/tắt quyền xem cho từng người**. Tạm thời **chỉ Admin** được điều chỉnh. | Tạo bảng công tắc theo dự án và người; RLS đọc/ghi của các bảng tài chính và hợp đồng dự án dựa trên công tắc cộng Admin. |
| Q2 | Hiện tại Admin quản trị toàn quyền trong dự án; PM/CHT phân quyền sau. | Chưa mở `project.org.grant_permissions`; RPC quản trị Room vẫn chỉ cho Admin. |
| Q3 | Bỏ hết quyền legacy "quản trị module Dự án" (38 người). | `is_module_admin('DA')` không còn đọc cột legacy. Bảng nào đang dựa vào nó phải chuyển sang Admin, capability hoặc Room đúng nghĩa trước. |
| Q4 | Triển khai theo thứ tự P0 → P3, bắt đầu từ P0. | Xem các mục dưới. |

## 2. Nguyên tắc triển khai cho mọi batch

1. **Kiểm consumer trước khi siết.** Với mỗi bảng, bucket hay hàm, liệt kê nơi frontend, Edge Function và cron đang dùng. Không siết cái đang có luồng hợp lệ nếu chưa có đường thay thế.
2. **Rollback smoke trên Cloud:** chạy `BEGIN → migration → assertion (anon / nhân viên / chủ sở hữu / Admin) → ROLLBACK`. Chỉ khi pass mới xin xác nhận để apply.
3. **Apply đúng ledger.** Áp bằng `apply_migration` rồi đặt tên file đúng version ghi trong ledger. Không để lặp lại tình trạng migration đã apply mà file chưa commit như `20260923042822`.
4. **Postflight:** chạy lại smoke không rollback, chạy Security Advisor, ghi [rollout log](authorization-remediation-rollout-log.md). Nhật ký chỉ ghi số đếm, không ghi PII.
5. **Frontend đi trước server** khi server phụ thuộc vào thay đổi giao diện: deploy frontend mới xong mới siết policy cũ.
6. **Mỗi batch có script rollback** đặt ở `supabase/operations/`.
7. **Không sửa migration hoặc code của hai luồng Project/Procurement V2 và Daily log.** Nếu batch của mình ảnh hưởng tới họ thì ghi rõ trong rollout log.

## 3. P0 — Đóng lỗ bảo mật (tuần này)

### P0-A · Chặn truy cập từ bên ngoài (ưu tiên cao nhất, không cần sửa frontend)

Phát hiện bổ sung ngày 27/09, đã xác minh bằng request chỉ đọc hoặc chỉ đếm:

- Auth đang cho **đăng ký công khai** (`disable_signup=false`). Trigger `on_auth_user_profile_sync` tạo ngay hồ sơ Vioo **EMPLOYEE, ACTIVE** cho mọi tài khoản Auth mới. Hiện chưa có tài khoản nào tự đăng ký: 62/62 tài khoản đều do Admin tạo qua `create-user`.
- `anon` (người chưa đăng nhập, chỉ cần anon key công khai trong bundle JS) có SELECT trên 174 bảng/view. Qua các policy `true` gán cho role `public`, người ngoài đọc được `activities` (3.216 dòng), `payment_schedules`, `salary_3p_settings`, `cash_vouchers`, `project_documents`, `asset_assignments`, `org_units`, v.v.
- Storage: `anon` liệt kê được file trong `checkin-photos`, `project-files`, `project-photos` và `workflow-templates/signatures`. Policy còn cho anon ghi đè/xóa chữ ký (`workflow-templates`), ảnh và tài liệu dự án (`project-photos`, `project-files`, `project-attachments`).
- 11 hàm `SECURITY DEFINER` gọi được bởi anon.

| Hạng mục | Nội dung | Người làm | Ảnh hưởng người dùng |
|---|---|---|---|
| A1 | Tắt "Allow new users to sign up" trong Supabase Auth. Luồng `create-user` dùng admin API nên không bị ảnh hưởng. Bật thêm Leaked Password Protection nếu gói hỗ trợ. | **Chủ sản phẩm** thao tác trên Dashboard | Không |
| A2 | Thu hồi mọi quyền của `anon` trên bảng, view và sequence schema `public`. Sửa default privileges để bảng tạo sau này không tự mở lại. | Migration | Không (app không có tính năng ẩn danh) |
| A3 | Thu hồi `EXECUTE` của `anon`/`PUBLIC` trên 11 hàm DEFINER. Thu hồi luôn quyền của `authenticated` với 2 hàm không còn ai gọi. | Migration | Không |
| A4 | Storage: thêm restrictive policy chặn `anon`. Link ảnh public trong app vẫn hoạt động. Ảnh chữ ký chỉ chủ sở hữu (hoặc Admin) được ghi hay xóa. File mẫu in chỉ người sửa được mẫu quy trình mới ghi. Ghi đè hoặc xóa file ở 5 bucket chỉ dành cho người tải lên hoặc Admin. | Migration | Không; file do người khác tải lên không còn bị xóa nhầm |

**Nghiệm thu P0-A:**

- `GET /auth/v1/settings` trả `disable_signup=true`.
- Request anon tới REST trả 401/42501; anon liệt kê Storage trả rỗng hoặc lỗi.
- Nhân viên vẫn đăng nhập, chấm công chụp ảnh, tải ảnh nhật ký, tải chứng từ và xem ảnh như trước.
- Security Advisor không còn lint `anon_security_definer_function_executable`.

### P0-B · Chặn nhân viên sửa dữ liệu không thuộc quyền (2–3 ngày)

| Hạng mục | Nội dung |
|---|---|
| B1 | 27 bảng có policy ghi `true` chuyển sang policy đúng chủ sở hữu, capability hoặc Admin. Làm theo từng nhóm: chữ ký; audit/nhật ký (chỉ ghi dưới danh nghĩa chính mình); lương 3P/KPI/xếp hạng (template HR); hợp đồng/danh mục (quyền Hợp đồng); checklist bước quy trình (người tham gia); mẫu in; dashboard/XP (chủ sở hữu). |
| B2 | Notification: server đóng dấu người gửi, không cho giả mạo. Chỉ chấp nhận link nội bộ (bắt đầu bằng `/`). Chỉ Admin hoặc hệ thống được gửi broadcast. Trạng thái đã đọc/ẩn của broadcast lưu riêng theo từng người (cần DB và frontend). |
| B3 | Bỏ avatar pravatar.cc (lộ email): sửa frontend, trigger hồ sơ và dọn 42 URL cũ. Dùng avatar chữ cái đầu. |
| B4 | Vô hiệu hóa tài khoản fixture/canary trên Production, gồm 1 tài khoản ADMIN không có Auth. Làm qua lệnh lifecycle có audit. Sau đó bỏ nhánh khớp email trong `current_app_user_id()`. |

**Nghiệm thu P0-B:** smoke theo persona (nhân viên, chủ sở hữu, HR, Admin) cho từng bảng; Advisor không còn policy ghi `true` cho `authenticated`; UI không báo "thành công" khi server từ chối.

### P0-C · Tài chính và Hợp đồng dự án theo công tắc (Q1, Q3 phần tài chính) — 3–5 ngày

1. **Dữ liệu:** bảng `project_sensitive_view_grants(project_id, user_id, domain ∈ {finance, contract}, enabled, reason, granted_by, updated_at)` cùng lịch sử thay đổi. Việc bật/tắt đi qua RPC chỉ Admin gọi được, có lý do và ghi audit.
2. **Giao diện:** Dự án → tab Phân quyền → mục **"Ai được xem Tài chính và Hợp đồng"**.
   - Danh sách người đang tham gia dự án (tổ chức dự án và thành viên Room) với 2 công tắc: *Tài chính*, *Hợp đồng*.
   - Có tìm kiếm, lọc "đang được xem" và lịch sử bật/tắt.
   - Người không có công tắc thấy trạng thái "Chưa được mở quyền xem tài chính dự án". Không hiển thị số 0.
3. **Chế độ bóng (1–2 ngày):** ghi nhận ai đang mở các màn tài chính/hợp đồng mà chưa có công tắc. Admin rà danh sách và bật đủ trước khi siết.
4. **Siết RLS:**
   - Các bảng tài chính dự án (`project_finances`, `project_transactions`, `project_cost_items`, `advance_payments`, `project_cost_actuals`, `payment_schedules`, `project_dashboard_snapshots` phần tài chính…) và hợp đồng gắn dự án (`project_contracts`, `contract_items`, `contract_guarantees`, `contract_appendices`, hợp đồng chủ đầu tư/NCC/thầu phụ theo `project_id`…) chỉ đọc được khi có công tắc hoặc là Admin.
   - Quyền ghi: Admin (Q2) và các Room nghiệp vụ đã có (thanh toán, nghiệm thu). Bỏ `is_module_admin('DA')` trên các bảng này (Q3).
   - Chốt danh sách bảng cuối cùng bằng inventory cột `project_id`/`construction_site_id` trước khi viết migration.
5. **Nghiệm thu:** persona trong dự án có công tắc, trong dự án không có công tắc, ngoài dự án và Admin; kiểm cả UI, REST trực tiếp và RPC tổng hợp (dashboard, báo cáo).

## 4. P1 — Gỡ legacy, để "tick là có tác dụng" (tuần 2–3)

| Hạng mục | Nội dung |
|---|---|
| P1.1 | **Q3 phần còn lại:** thay `is_module_admin('DA')` ở 25 bảng/68 tham chiếu (mẫu nghiệm thu, dự toán, `approval_rules`, `project_permission_types`, an toàn…) bằng Admin hoặc capability tương ứng, ví dụ `settings.inspection_templates.manage`. Sau đó `is_module_admin('DA')` chỉ còn là Admin. |
| P1.2 | Đồng bộ catalog capability giữa frontend và DB (22 mã chỉ có ở DB, 33 chỉ có ở frontend) và thêm contract test để CI fail khi lệch. Khôi phục tab "Mẫu quyền". |
| P1.3 | Room là nguồn duy nhất cho 10 nghiệp vụ dự án: bỏ capability tương ứng khỏi ma trận Cài đặt, frontend đọc Room action. Dọn 904 direct grant sau khi đối chiếu. Đổi mặc định `canManageTab` thành `false`. |
| P1.4 | Thay kiểm `role` bằng capability ở các chỗ đang quyết định người nhận hoặc người duyệt: WMS, Sidebar, MaterialTab… |
| P1.5 | Các module legacy còn lại (HD 7 người, WMS 22, WF 23, TS 1) làm theo từng cohort; chủ sản phẩm chốt actor/action/scope. |
| P1.6 | Chuyển các bucket public chứa dữ liệu nhạy cảm (`checkin-photos`, `project-*`) sang private và dùng signed URL. |

## 5. P2 — Notification do server quyết định và UX màn quyền (tuần 3–4)

- Cảnh báo định kỳ chạy bằng cron server-side, không phụ thuộc trình duyệt Admin. Người nhận xác định bằng capability, Room hoặc assignment tại server.
- Chạy canary rồi bật worker Workflow. Quyết định với 72 sự kiện tồn (gửi bù hoặc suppress có ghi chú) và xử lý lại 14 Request `FAILED`.
- Màn Người dùng:
  - Tải snapshot của người được sửa, để không còn hiện "0 Room".
  - Bộ chọn dự án/công trường/kho thay cho ô gõ UUID.
  - Bỏ thuật ngữ kỹ thuật.
  - Sửa các ngõ cụt ở drawer (mật khẩu, kho phụ trách).
  - Link Room mở đúng dự án.

## 6. P3 — Hợp nhất và dọn dẹp (từ tuần 5)

- Màn **"Hồ sơ quyền"** hợp nhất theo người: vai trò, dự án/kho được phép, quyền nhạy cảm, nguồn quyền và nơi sửa.
- Template quyền theo vai trò (CHT, QS, kỹ thuật, thủ kho công trường, kế toán dự án).
- Mở phân quyền Room cho PM/CHT khi chủ sản phẩm quyết định (Q2).
- Task 13: drop 4 cột legacy và các helper sau khi dependency rỗng và đủ 7 ngày quan sát.
- Dọn dead code (`UserManagement.tsx`, helper không dùng) và các cảnh báo Advisor còn lại.

## 7. Phối hợp với hai luồng song song

- **Project/Procurement V2:** đề nghị capability `project.v2_*` chỉ đến từ Room (`direct_grant_allowed=false`), tránh lặp lại mô hình kép. P0-A không chạm schema V2.
- **Daily log:** P0-A thu hồi quyền của hàm không còn ai gọi `daily_log_user_has_project_permission`. Đề nghị bỏ nhánh "dự án chưa có nhân sự thì ai cũng được" trong helper contribution trước khi mở rộng pilot.
- Default privileges mới (bảng tạo sau không tự cấp cho `anon`) áp dụng cho cả migration của hai luồng. Họ không cần anon, nên không phải làm gì thêm.

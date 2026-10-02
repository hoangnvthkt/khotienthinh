# Handoff — Phân quyền, RLS, Storage, Thông báo (P0 → P3)

**Cập nhật:** 02/10/2026. Đây là tài liệu **đầy đủ nhất** cho luồng này; thay cho `authorization-remediation-handoff-2026-09-28.md` (bản cũ vẫn giữ để tra cứu).
Đọc xong file này, agent mới làm tiếp được ngay mà không cần khảo sát lại.

---

## 0. Cách bắt đầu phiên mới

Dán vào phiên mới:

> Đọc `docs/security/authorization-handoff-2026-10-02.md` trong worktree `/Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2` rồi làm tiếp. Việc đầu tiên là mục 8.1 (lỗi thiếu ngày hết hạn). Anh chọn phương án: …

Agent mới nên:
1. Đọc `AGENTS.md` ở gốc repo (ràng buộc bắt buộc, xem mục 3).
2. Đọc file này, sau đó tra chi tiết trong [rollout log](authorization-remediation-rollout-log.md) khi cần số liệu từng bước.
3. Chạy `git fetch origin` và xem mục 2: nhánh đang **chậm hơn `main` khoảng 30 commit** của các luồng khác.

---

## 1. Tóm tắt trạng thái (02/10/2026)

- P0 → P2 và phần lớn P3 **đã apply trên Supabase Cloud và nằm trên `origin/main`**.
- Phiên 28–29/09 đã làm:
  - đợt 2 của cảnh báo định kỳ;
  - thông báo đúng người (B1, B2a, B2b, B3);
  - màn Cài đặt → Người dùng;
  - RLS cho Tài liệu và Nhật ký hoạt động; Admin đặt mật khẩu cho người khác;
  - ảnh nhật ký thành bucket private;
  - mẫu quyền Room dự án, và form tạo dự án tự áp mẫu Room;
  - chuyển vai trò thường sang quyền riêng từng người;
  - mẫu quyền theo vị trí cho toàn hệ thống;
  - giải thích lý do ô quyền bị khóa.
- **Đã xong 02/10 (xem rollout log):** lỗi thiếu ngày hết hạn (8.1), phạm vi `own` không nhạy cảm bỏ hạn, bỏ lý do khi chỉ sửa hồ sơ, thẻ Tài chính/Hợp đồng theo người, màn Room cũ được thay bằng "Phân quyền theo người", khảo sát Task 13.
- Kiểm tra lần cuối (29/09, sau khi gộp `main`): `tsc` sạch; Vitest 2.630 pass; e2e phân quyền 5 pass.

---

## 2. Môi trường

| Mục | Giá trị |
|---|---|
| Worktree | `/Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2` (worktree do agent tạo, không phải do app tạo) |
| Nhánh | `feature/authorization-p0-hardening`, HEAD `ef8350d`. Đã gộp `main` ở `59560f0`; sau đó `main` có thêm khoảng 30 PR của luồng khác. |
| Checkout chính | `/Users/admin/khotienthinh`: có thay đổi chưa commit của luồng khác, **không đụng vào**. |
| Supabase | Project `ftciqmqhmfvjtwoycswe` (Cloud, production). Migration mới nhất trên Cloud lúc viết: `20261004090000` (của luồng khác). |
| Truy vấn Cloud | `set -a && source /Users/admin/khotienthinh/.env && set +a && npx supabase db query --linked -f <file.sql>` |
| Apply migration | MCP `mcp__supabase__apply_migration` (tải schema bằng ToolSearch `select:mcp__supabase__apply_migration`). Migration quá lớn để truyền qua MCP (ví dụ có dữ liệu seed) thì chạy bằng CLI trong **một giao dịch**, gồm cả câu `insert into supabase_migrations.schema_migrations(version, name, statements)`; xem mẫu ở rollout log, mục "mẫu quyền theo vị trí". |
| GitHub CLI | `/opt/homebrew/bin/gh`, gọi bằng đường dẫn đầy đủ vì thư mục này không có trong PATH của Bash. |
| File tạm | Scratchpad của phiên, không ghi vào repo. |

**Mẹo khi dùng CLI:**
- Kết quả là JSON, cuối có kèm cảnh báo. Cắt từ `{` đầu tiên tới `}` cuối cùng rồi mới `json.loads`.
- Một file `-f` chỉ trả kết quả của câu lệnh **cuối cùng**. Dry-run viết theo dạng `begin; …; select jsonb_build_object(...) r; rollback;`.

**Cách đưa code lên `main` đã đổi:**
- Trước 29/09: push thẳng nhánh rồi fast-forward `origin/main`; chủ sản phẩm cho phép "mức 2".
- Từ 30/09: các luồng khác đều đi qua **PR, squash-merge**, tiêu đề tiếng Việt kèm `(#N)`.
- Việc tiếp theo nên:
  - tạo nhánh mới từ `origin/main` (hoặc gộp `origin/main` vào nhánh này) rồi mở PR theo checklist trong memory `pr-shipping-checklist`;
  - **hỏi chủ sản phẩm** trước khi push thẳng `main`.
- CI chạy: `npm ci` → `check:supabase-migrations` → lint → `check:supabase-queries` → `npm test` → build.
- Khi xâu chuỗi các bước kiểm tra trước khi merge, dùng `set -o pipefail`; không để `| tail` che lỗi.

**Xem trước giao diện bằng fixture (không cần đăng nhập):**
- `preview_start` đọc `.claude/launch.json` của **checkout chính**. Cách làm:
  1. Thêm tạm cấu hình `npm --prefix <worktree> run dev -- --host 127.0.0.1 --port 4193 --strictPort`.
  2. Mở `http://localhost:4193/tests/authorization/template-fill-fixture.html`.
  3. Xong thì xóa cấu hình tạm.
- Không dùng cổng 5173 hoặc 3000: đó là server của checkout chính.
- Màn thật cần đăng nhập Admin. Agent **không được nhập mật khẩu**; nhờ chủ sản phẩm đăng nhập sẵn trong browser pane.

---

## 3. Ràng buộc bắt buộc

- Từ `AGENTS.md`:
  - Chỉ Supabase Cloud qua `.env`; không Supabase local, không Docker.
  - Không dùng sub-agent.
  - Không dùng Superpowers cho việc đơn giản.
- **UI/UX:**
  - Thiết kế theo công việc của người dùng; có đủ trạng thái loading, empty, error, denied, pending, success.
  - Không che lỗi hoặc giá trị chưa biết bằng `0`.
  - Walkthrough trên desktop và mobile; không redesign ngoài phạm vi.
- **Phạm vi:** không sửa code hay migration của luồng khác: Nhật ký công trường (Daily log), Dự án / Mua hàng / Kho V2, Quy trình, Phiếu yêu cầu, K3 công nợ. Chỉ đề xuất, ghi vào "việc mở".
- **An toàn:**
  - Không nhập mật khẩu, API key hay token.
  - CDN purge do chủ sản phẩm tự chạy bằng secret key.
  - Khi bộ kiểm tra an toàn tự động **từ chối** một thao tác: không lách bằng cách khác; dừng lại và hỏi chủ sản phẩm.
  - Khi nó **không trả lời** (lỗi tạm thời): thử lại một lần; nếu vẫn lỗi thì dừng và báo.
- **Commit** kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Rollout log** chỉ ghi số đếm, không ghi dữ liệu cá nhân (PII).
- **Trả lời chủ sản phẩm** bằng tiếng Việt, xưng "em", gọi "anh".

---

## 4. Quy trình cho mọi thay đổi Cloud

1. **Kiểm mọi nơi đang dùng** bảng hoặc hàm sắp đổi: frontend, Edge Function, cron, các hàm SECURITY DEFINER. Lưu ý một số kiểm tra chỉ có **một chỗ** (ví dụ ngày hết hạn, mục 7).
2. Viết migration trong `supabase/migrations/<timestamp>_<tên>.sql`; smoke test (luôn kết thúc bằng `rollback`) trong `supabase/tests/`; script rollback trong `supabase/operations/`.
3. **Dry-run trên Cloud:** `begin; <migration>; <smoke với persona>; rollback;`.
   - Persona: `set_config('request.jwt.claims', jsonb_build_object('sub',auth_id,'email',email,'role','authenticated')::text, true)` rồi `set local role authenticated`. Trong khối DO dùng `execute 'set local role authenticated'` / `execute 'reset role'`.
   - Tra dữ liệu fixture **trước khi** đổi role.
   - Bảng tạm mà persona đọc hoặc ghi phải được `grant` cho `authenticated`.
   - Cột `principal_role_assignments` không có `user_id`; kiểm tra tên cột trước khi viết truy vấn.
4. Thay đổi làm đổi quyền của người thật: **hỏi chủ sản phẩm** (AskUserQuestion), nêu số người và số dòng bị ảnh hưởng, kèm lựa chọn "Chờ". Thay đổi chỉ thêm bảng hay dữ liệu mẫu, không đổi quyền ai, thì được apply sau khi dry-run đạt.
5. Apply. Tên file phải trùng `version` trên Cloud. Thêm file vào `supabase/baseline/current.json` → `allowedPostBaselineFiles`: parse JSON rồi ghi lại, không sửa chuỗi bằng tay.
6. Chạy smoke sau apply; ghi rollout log; commit; đưa lên `main` theo mục 2.
7. Kiểm tra cục bộ: `npx vitest run --maxWorkers=4`, `npx tsc --noEmit -p .`, `npm run build`, `npm run check:supabase-queries` (truy vấn mới phải có `.limit()`), `npx playwright test -c tests/authorization/playwright.config.ts`.

**Ghi trực tiếp vào `public.users`:**
- Bật cờ: `select set_config('app.authorization_legacy_migration','on',true)`.
- Tắt `trg_users_prevent_privilege_self_update` khi ghi, xong bật lại.
- Ghi audit vào `app_private.authorization_legacy_write_audit`.

---

## 5. Quyết định của chủ sản phẩm (đang có hiệu lực)

Các quyết định 1–11 cũng lưu trong memory `authorization-owner-decisions-2026-09-27`.

1. **Tài chính và Hợp đồng dự án:**
   - Có 2 công tắc xem riêng cho từng người, kèm lựa chọn "Tất cả dự án"; chỉ Admin bật/tắt.
   - Tự động được xem: người xử lý trong Room Thanh toán hoặc Nghiệm thu, và người quản trị hợp đồng cấp công ty.
2. **Admin toàn quyền trong dự án.** Chưa mở phân quyền Room cho PM/CHT; cần quyết định mới.
3. **Bỏ quản trị module legacy:**
   - DA: bỏ hết.
   - Quy trình: giữ quản trị 7 người, thu hồi 16.
   - Kho: thu hồi 22.
   - Hợp đồng: thu hồi 7.
   - Tài sản: giữ 1.
   - Phiếu yêu cầu: thu hồi 15.
4. Chỉ Admin ghi tạm ứng, hạng mục chi phí, snapshot dashboard dự án.
5. Giữ các tài khoản test `@example.invalid`.
6. Bỏ qua `award_my_daily_xp` / XP; lỗi 404 của nó không tính là lỗi hồi quy.
7. **Thông báo Quy trình** bật lại từ 27/09. **Nhắc chấm công** đang tắt, chờ chủ sản phẩm báo trước cho nhân viên.
8. **Cảnh báo định kỳ** chạy trên server: đủ 11 loại.
9. **BCH** = Chỉ huy trưởng, Chỉ huy phó, Kỹ thuật trưởng (chức vụ trong nhân sự dự án). Cảnh báo An toàn gửi Room An toàn + BCH; Admin chỉ nhận dự phòng.
10. **Thông báo Phiếu yêu cầu:**
    - Người theo dõi chỉ nhận kết quả cuối và quá hạn.
    - Người duyệt đang chờ nhận nhắc hạn và bình luận.
    - Sự cố An toàn mức Cao / Nghiêm trọng báo ngay.
    - Nghiệp vụ không tắt được, chỉ chuyển sang tổng hợp cuối ngày.
11. **Mẫu quyền Room:** phân nhanh theo vị trí, nhưng Admin phải chỉnh được riêng từng quyền cho từng người khi áp.
12. (28/09) **Mọi màn phân quyền làm theo người** (memory `permission-ux-person-first-templates`):
    - chọn người → mẫu gợi ý theo chức vụ → điền vào bảng → thêm hoặc bớt từng quyền → lưu;
    - vai trò thường có CRUD cơ bản trên việc của mình; quản trị module rộng hơn: sửa mẫu, cấu hình thao tác, chỉ định người xử lý.
13. (28/09) **Chuyển vai trò thường sang quyền riêng; giữ vai trò đặc biệt.**
    - Vai trò **HR / HR Manage có chủ đích**: dành cho chuyên viên và trưởng phòng nhân sự, những người xem dữ liệu nhạy cảm (lương, phúc lợi, hợp đồng lao động).
    - Mã HR nhạy cảm **chỉ hiệu lực qua 2 vai trò này**.
14. (28/09) **Duyệt bảng mẫu quyền theo vị trí** (ma trận ở mục 6.3).
15. (30/09, memory `permission-tiers-rule`) Mỗi tính năng mới phải liệt kê các bậc:
    - bậc: xem / lập-sửa / xác nhận-duyệt / ghi sổ / quản trị;
    - phạm vi: toàn công ty / dự án / kho;
    - tách nhiệm áp dụng cả với Admin;
    - UI khóa nút theo bậc và **giải thích vì sao** không thao tác được.
16. (02/10) **Mẫu Room giữ Admin-only**; PM/CHT chưa được quản lý Room.
17. (02/10) **Bỏ màn Room cũ**, thay bằng "Phân quyền theo người", với điều kiện không bỏ sót quyền (đã đối chiếu dữ liệu thật).
18. (02/10) Bỏ lý do khi chỉ sửa hồ sơ; bỏ hạn 365 ngày cho `edit_profile@own`.

---

## 6. Đã hoàn thành

### 6.1 Trước phiên này (27/09)

Xem bảng chi tiết trong `authorization-remediation-handoff-2026-09-28.md`, mục 5.
- **P0-A:** chặn truy cập ẩn danh.
- **P0-B:** chặn ghi `true` trên 27 bảng; chống giả mạo thông báo.
- **P0-C:** công tắc xem Tài chính / Hợp đồng.
- **P1.1–P1.5:**
  - bỏ quản trị legacy DA;
  - thu hồi grant do Room quản lý;
  - người nhận thông báo WMS; quyền đọc `audit_trail`;
  - quản trị module lấy từ capability.
- **P1.6:** 3 bucket private.
- **P2.1:** bật lại thông báo Quy trình.
- **P2.2 đợt 1:** 6 loại cảnh báo định kỳ chạy trên server.

### 6.2 Phiên 28–29/09: theo commit (tất cả đã apply Cloud và nằm trên `main`)

| Commit | Migration / thành phần | Nội dung |
|---|---|---|
| `165548d`, `9aea1f4` | `…031025_notification_p2_2_server_scheduled_alerts`, `20260928035750_…group2` | 11 loại cảnh báo định kỳ chạy bằng cron `server-scheduled-alerts` (`*/5`); RPC `run_scheduled_alerts_now()` |
| `3bf32fa` | `20260928044404_notification_delivery_reason` | Mỗi thông báo có `delivery_reason` (assigned / mentioned / watching / responsible / system); chuông và trang Thông báo chia tab Việc của tôi · Theo dõi · Nghiệp vụ · Hệ thống |
| `5e91301` | `20260928052528_notification_site_command_recipients` | BCH theo `notification_site_command_positions`; tuỳ chọn `includeSiteCommand`; RPC xem trước người nhận |
| `312214a` | `20260928062658_notification_event_recipients_request_safety` | Người nhận thông báo sự kiện Phiếu yêu cầu và An toàn (trigger sự cố An toàn) |
| `9a7cc0d` | `20260928065520_notification_preferences_digest` | Tuỳ chọn cá nhân (ngay / tổng hợp / không báo) và tổng hợp cuối ngày bằng cron `notification-digests` |
| `37d24b8` | `20260928080828_authorization_user_snapshot_for_admins` | Cài đặt → Người dùng: tải quyền thật của người đang sửa (`get_user_authorization_snapshot`); chọn phạm vi theo tên; trạng thái online thật; bỏ thuật ngữ kỹ thuật; xóa `LegacyPermissionReadOnly` |
| `d1508cc` | `20260928083215_authorization_p2_documents_activities_rls` + Edge Function `reset-password` v17 | `project_documents` theo quyền Tài liệu (`project_documents_can`, cột `created_by`); `activities` đọc qua `activity_wms_scope()`, tính một lần mỗi truy vấn (khoảng 160 ms); Admin đặt mật khẩu cho người khác (tối thiểu 8 ký tự, bắt buộc lý do, chặn tài khoản bị khóa, có audit) |
| `64927cc`, `779a459` | `20260928084924_authorization_p1_6_private_project_photos` | Bucket `project-photos` private; `project_photo_folder_visible`; resolver tự ký link cũ (`PRIVATE_LEGACY_PUBLIC_BUCKETS`) |
| `7c3c2bf` | `20260928092719_authorization_p3_project_room_templates` | 6 mẫu Room; `apply_project_room_template` (merge / replace / exact, dry-run, audit "có tùy chỉnh"); Dự án → tab Phân quyền → "Phân quyền theo người"; Cài đặt → "Mẫu quyền dự án" |
| `7d6a2d5` | (frontend) `pages/ProjectDashboard.tsx` | Người được thêm khi tạo dự án nhận mẫu Room: admin → site_commander, executor → field_engineer, watcher → viewer; chức vụ được ưu tiên |
| `8aba991` | `20260928101825_authorization_p3_roles_to_personal_grants` | 131 gán vai trò (BUSINESS_USER, WORKFLOW_USER, WORKFLOW_ADMIN, LEGACY_HR_*) của 56 người thành 710 grant riêng; bản sao lưu ở `app_private.p3_roles_conversion_backup`; rollback `supabase/operations/authorization_p3_roles_to_personal_grants_rollback.sql` (đã dry-run, khôi phục đúng từng dòng). **Gây lỗi ở mục 8.1.** |
| `5aace83` | `20260928113000_authorization_p3_user_permission_templates` | Mẫu quyền theo vị trí cho toàn hệ thống (mục 6.3) |
| `ef8350d` | (frontend) `lib/permissions/permissionLockReason.ts` | Ô quyền bị khóa có dòng 🔒 giải thích lý do và chỗ đổi |
| `59560f0` | merge | Gộp `origin/main` (4 PR Nhật ký công trường), không xung đột |

### 6.3 Mẫu quyền theo vị trí (đã duyệt, đang chạy)

- **Bảng dữ liệu:** `public.user_permission_templates`, gồm:
  - `code`, `name`, `description`;
  - `items` jsonb dạng `[{permissionCode, scopeType: global|own|assigned, expiresInDays?}]`;
  - `suggested_position_ids` (id trong `hrm_positions`), `sort_order`, `is_active`.
- **Hàm:**
  - `save_user_permission_template(...)`: chỉ Admin, có audit.
  - `app_private.normalize_user_permission_template_items`: chỉ nhận mã cấp riêng được; không nhận `project.*`; không nhận phạm vi theo đối tượng cụ thể; quyền cần hạn mặc định 365 ngày (tối đa 730).
- **Khi áp cho người:** không có RPC riêng. Frontend điền mẫu vào bản nháp grant (`buildGrantsFromTemplate`), rồi lưu qua `update_user_authorization_v2`. Mọi kiểm tra của server vẫn áp dụng.
- **Giao diện:**
  - Người dùng → Sửa: khối "Điền nhanh theo mẫu vị trí" (`components/permissions/PermissionTemplateFill.tsx`).
  - Cài đặt → "Mẫu quyền theo vị trí" (`pages/settings/SettingsUserPermissionTemplates.tsx`).
- **14 mẫu (651 dòng):**

| Mẫu | Ý chính |
|---|---|
| Nhân viên cơ bản | Hồ sơ của mình; Quy trình, Phiếu yêu cầu, Chi phí, Đặt xe, Công việc, AI ở mức cơ bản; xem Tri thức / Lưu trữ / Tin nhắn |
| Cán bộ vật tư, kho | Cơ bản + Kho (tạo đề xuất, nhận hàng, lập giao dịch); xem Mua hàng, Tài sản, Hợp đồng NCC |
| Quản lý kho | + duyệt, hoàn tất, đảo giao dịch, quyết toán xuất cấp, danh mục kho; Cài đặt kho bãi, định mức hao hụt, dữ liệu gốc; xem Phân tích |
| Cán bộ công trường | Cơ bản + xem Kho, Tài sản (quyền dự án đi qua Room) |
| Kế toán | Cơ bản + xem Kho, Mua hàng, Tài sản, Hợp đồng, Phân tích; Chi phí: xem tất cả, lập ngân sách, duyệt |
| Kế toán trưởng / TC | Kế toán + sửa mọi ngân sách, danh mục chi phí |
| Nhân sự | Cơ bản + hồ sơ, tổ chức, định biên; sửa và duyệt chấm công, duyệt nghỉ phép. **Không có lương / hợp đồng lao động / đãi ngộ** (đi qua vai trò HR) |
| Trưởng phòng nhân sự | Nhân sự + Phân tích (quản trị tổ chức và dữ liệu nhạy cảm đi qua HR Manage) |
| Hành chính – Tài sản – Đội xe | Cơ bản + Tài sản (tạo, cấp phát, bảo trì, kiểm kê) + Đặt xe (điều xe, chuyến, bàn giao, đội xe, người lái) |
| Ban giám đốc | Cơ bản + xem tổ chức; duyệt phiếu được giao; xem Kho, Mua hàng, Tài sản, Hợp đồng, Phân tích; duyệt chi phí, đặt xe; AI điều hành |
| Quản trị Quy trình / Phiếu yêu cầu / Tài sản / Công việc | Gói **cộng thêm** vào mẫu vị trí |

- Script sinh dữ liệu mẫu từ ma trận nằm trong scratchpad của phiên cũ, **không có trong repo**. Muốn sửa mẫu: dùng màn Cài đặt, hoặc viết migration `update`.

### 6.4 Vai trò còn lại trên Cloud (02/10)

`AUDITOR 1, HR 3, HR_MANAGE 2, PERMISSION_ADMIN 1, SYSTEM_ADMIN 5`. Sau ngày chuyển đổi (28/09), đã có người gán thêm HR, HR_MANAGE, SYSTEM_ADMIN; đây là việc bình thường.

---

## 7. Hiểu biết hệ thống quan trọng

**Nguồn quyền:**
- `app_private.resolve_effective_permission_sources(user, code, scope_type, scope_id, now())` trả về các nguồn DIRECT / ROLE / LEGACY. Với nguồn ROLE, `source_id` là id của assignment.
- Bảng: `user_permission_grants`, `principal_role_assignments` (`role_template_id`, `status`), `role_permission_templates` / `role_permission_template_items`.

**Quyền HR nhạy cảm:**
- `app_private.has_hrm_template_permission` **chỉ chấp nhận vai trò HR / HR_MANAGE**; 42 hàm và 51 policy dùng hàm này.
- Mã nhạy cảm là NODIRECT, nên cấp riêng cho từng người cũng **không có tác dụng**.

**Ngày hết hạn của grant:**
- Kiểm tra duy nhất nằm trong `app_private.evaluate_direct_grant_replacement_impl`, khối `if v_action.direct_grant_requires_expiry and v_grant.expires_at is null`.
- Khối này kiểm tra **mọi** grant trong payload, kể cả grant cũ không đổi.
- Frontend lặp lại kiểm tra này trong `lib/permissions/authorizationUpdateValidation.ts` (`expiry_required`) và `PermissionModuleCard` (`expiryReady`).
- Các preview `preview_direct_grant_replacement_impl`, `preview_direct_permission_grants_v3_impl`, `preview_user_permission_change_impl` đều gọi cùng hàm đó.

**Danh mục quyền:**
- 17 ứng dụng, 105 module, 384 action (`permission_actions`: `direct_grant_allowed`, `scope_modes`, `risk_level`, `direct_grant_requires_expiry`).
- Không có cột phạm vi mặc định trên server.
- App Dự án (165 mã) đi qua Room.

**Room:**
- Các bảng: `project_permission_rooms`, `project_permission_room_members` (`project_staff_id`), `project_permission_room_member_actions`, `app_private.project_permission_room_action_bindings`.
- Mọi action khác "view" đều cần có "view".
- Ghi qua `replace_project_permission_room_members`.
- Room là nguồn quyền cho các phân hệ: Nhật ký, Tiến độ, Chốt tiến độ, Chất lượng, An toàn, Thanh toán, Nghiệm thu, PO.
- **Ngoại lệ vật tư:** grant trực tiếp của phiếu vật tư, kế hoạch và BOQ vẫn có tác dụng (292 grant); không được thu hồi.

**Liên kết người dùng – chức vụ:** `employees.user_id` → `employees.position_id` → `hrm_positions`. Nhân sự dự án dùng `project_staff.position_id`.

**Storage:**
- Muốn đưa bucket sang private: thêm bucket vào `PRIVATE_LEGACY_PUBLIC_BUCKETS` (`lib/storageSignedUrl.ts`), sau đó purge CDN.

**Thông báo:**
- Nơi tạo thông báo mới nên truyền `delivery_reason`; trigger chỉ là dự phòng.
- Thông báo Quy trình: chỉ phiếu không có subject đi qua worker chung.

**Frontend phân quyền:**
- Trình sửa quyền: `components/permissions/AuthorizationEditor.tsx` → `PermissionTemplateFill` → `PermissionModuleEditor` / `PermissionModuleCard` → `PermissionDiffPreview` → `ProjectRoomSummary`.
- Lưu ở `components/UserModal.tsx` qua `updateUserAuthorizationV2`.

---

## 8. Việc đang mở (theo thứ tự ưu tiên)

### 8.1 ✅ Lỗi hồi quy thiếu ngày hết hạn — ĐÃ XONG (02/10)

Chủ sản phẩm chọn phương án 1. Migration `20261004100000` giữ nguyên quyền đang có không hạn; `20261004120000` bỏ hạn cho phạm vi `own` của quyền không nhạy cảm (hiện chỉ `hrm.employee.edit_profile`) cả ở kiểm tra grant và mẫu vị trí. Frontend dùng chung `grantRequiresExpiry(action, scope)`. Chi tiết và bằng chứng trong rollout log.

### 8.2 Việc chủ sản phẩm tự làm

- Purge CDN bucket `project-photos`: `curl -X DELETE …/storage/v1/cdn/project-photos`, cần secret key.
- Mở thử Cài đặt → "Mẫu quyền theo vị trí" bằng tài khoản Admin thật. Màn này agent **chưa xem được trên giao diện thật**; mới kiểm bằng type-check và bằng mẫu của màn "Mẫu quyền dự án". Luồng "Điền nhanh" đã kiểm bằng fixture và e2e.
- Bật lại nhắc chấm công ở Cài đặt → Cảnh báo, sau khi đã báo trước cho nhân viên.

### 8.3 P3 còn lại

- **Đã xong:** smoke cho `20260928101825` và `20260928113000`; tab "Mẫu quyền" đổi tên "Vai trò đặc biệt"; thẻ "Xem Tài chính và Hợp đồng" trong Người dùng → Sửa (RPC `get_user_sensitive_view_summary`); màn Room cũ thay bằng "Phân quyền theo người" (đã đối chiếu dữ liệu thật, không bỏ sót quyền).
- **Hồ sơ quyền: đã xong ở mức xem tổng hợp (02/10).** Người dùng → Sửa có khối "Quyền đến từ nguồn khác" (vai trò đặc biệt, Tài chính/Hợp đồng, Room dự án). Việc gán/đổi vai trò vẫn ở Cài đặt → Vai trò đặc biệt và tab Vai trò nhân sự; chưa gộp chỗ sửa vào một nơi (cần chủ sản phẩm quyết).
- **PM / CHT quản lý Room:** chủ sản phẩm quyết **giữ Admin-only** (02/10).
- **Task 13: xóa cột legacy:** đã khảo sát, **chưa xóa được**. Xem `authorization-task13-impact-survey-2026-10-02.md`: 49 người sẽ mất quyền đọc 10 bảng danh mục nếu bỏ `can_access_module`; cần chọn phương án thay policy (mục 5 của tài liệu đó) rồi mới làm từng bước.
- **E2E Playwright:** máy chưa cài trình duyệt (`npx playwright install`); các e2e phân quyền chưa chạy lại sau các thay đổi 02/10.

### 8.4 Thông báo đúng người: phần còn mở

- **Dữ liệu:** chưa ai được gán chức vụ Chỉ huy trưởng trong nhân sự dự án; chỉ 6/86 dự án có nhân sự dự án. BCH và Room template phụ thuộc dữ liệu này.
- Room An toàn có 11 người có quyền xác nhận / duyệt; nên rà lại cho đúng "người quản lý an toàn".
- `request_instances.due_date` chưa được màn Phiếu yêu cầu ghi, nên cảnh báo "Yêu cầu quá hạn" không có dữ liệu. Luồng Phiếu yêu cầu đã đổi nhiều sau 30/09 (#38, #45); kiểm tra lại trước khi làm.
- Quy tắc "Tiến độ chậm" đang tắt. Nếu bật lại, nên lấy người nhận theo Room `gantt` (`edit`).

### 8.5 Đề xuất cho luồng khác (không tự sửa)

- **Nhật ký công trường:** lưu đường dẫn ảnh và ký link khi hiển thị, thay vì URL công khai; rà người nhận thông báo Nhật ký và Vật tư.
- **Procurement / Kho V2:** phương án Room cho grant vật tư (292 grant đang có tác dụng ngoài Room); `MaterialTab` còn kiểm `role === ADMIN`.
- **"Đồng bộ MISA"** vẫn chỉ Admin vì chưa có capability riêng.
- **Vioo Work:** cổng thông báo tắt từ 12/09.

### 8.6 Câu hỏi UX còn treo

**Đã quyết 02/10:** bỏ yêu cầu lý do khi chỉ sửa hồ sơ. Frontend không đòi lý do và tự ghi "Cập nhật hồ sơ người dùng"; server vẫn đòi lý do khi đổi quyền hoặc loại tài khoản.

---

## 9. Bản đồ file chính

| Phần | File |
|---|---|
| Tài liệu | `docs/security/authorization-remediation-rollout-log.md` (bằng chứng từng bước), `authorization-remediation-handoff-2026-09-28.md` (bản cũ), `authorization-remediation-plan-2026-09-27.md`, `docs/audits/permission-rls-notification-2026-09-27/README.md` |
| Trình sửa quyền | `components/UserModal.tsx`, `components/permissions/{AuthorizationEditor,PermissionTemplateFill,PermissionModuleEditor,PermissionModuleCard,PermissionDiffPreview,ProjectRoomSummary,HrmAuthorizationPanel}.tsx` |
| Logic quyền | `lib/permissions/{authorizationUpdateValidation,permissionLockReason,permissionScopeEntities,permissionAdminService,permissionCatalogService}.ts`, `lib/userPermissionTemplateService.ts` |
| Room | `lib/projectRoomTemplateService.ts`, `components/project/permissions/ProjectRoomTemplateAssign.tsx`, `pages/project/ProjectPermissionsTab.tsx`, `pages/ProjectDashboard.tsx` (áp mẫu khi tạo dự án) |
| Cài đặt | `pages/Settings.tsx` (tab `user-permission-templates`, `project-room-templates`, `role-templates`), `pages/settings/{SettingsUsers,SettingsUserPermissionTemplates,SettingsProjectRoomTemplates,SettingsAlerts*}.tsx`, `components/AdminSetPasswordForm.tsx` |
| Thông báo | `lib/notificationService.ts`, `lib/notificationReasons.ts`, `components/NotificationCenter.tsx`, `pages/Notifications.tsx`, `components/NotificationPreferencesCard.tsx` |
| Storage | `lib/storageSignedUrl.ts`, `PrivateStorageLinkResolver`, `lib/documentService.ts` |
| Edge Function | `supabase/functions/reset-password/index.ts` (v17) |
| Test | `lib/__tests__/{userPermissionTemplates,permissionLockReason,projectRoomTemplates,settingsUsersUxContract,authorizationEditorUiContract,notification*}.test.ts`; e2e: `tests/e2e/authorization-{v2-module-access,template-fill}.spec.ts` + `tests/authorization/{editor,template-fill}-fixture.*`; chạy bằng `npx playwright test -c tests/authorization/playwright.config.ts` |
| Smoke / rollback | `supabase/tests/*_smoke.sql`, `supabase/operations/*_rollback.sql` |

---

## 10. Memory liên quan

Thư mục: `~/.claude/projects/-Users-admin-khotienthinh/memory/`.

- `authorization-remediation-handoff`: con trỏ tới file này.
- `authorization-owner-decisions-2026-09-27`: các quyết định 1–11.
- `permission-ux-person-first-templates`: cách chủ sản phẩm muốn phân quyền.
- `permission-tiers-rule`: phân cấp bậc quyền.
- `pr-shipping-checklist`: cách ship PR.
- `verify-chains-pipefail`: dùng `pipefail` khi kiểm tra trước merge.

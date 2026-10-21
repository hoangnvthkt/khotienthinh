# Audit bảo mật & hiệu năng Vioo — 20/10/2026

**Mục tiêu:** đánh giá hệ thống có phục vụ được **~200 người dùng đồng thời** hay không, về bảo mật và hiệu năng; chỉ ra ưu / nhược điểm và thứ tự khắc phục.

**Phạm vi & phương pháp (chỉ đọc, không sửa gì):**

- Mã nguồn nhánh `main` tại `0bf09615` (20/10/2026): 413 nghìn dòng TS/TSX, 192 màn, 456 component, 1.180 file lib, 357 migration, 18 Edge Function.
- Supabase Cloud `ftciqmqhmfvjtwoycswe` (Postgres 17.6) qua kết nối trong `.env`: chỉ `SELECT` catalog, `pg_stat_statements`, `pg_policies`, `storage.buckets`; đo `EXPLAIN ANALYZE` theo vai **nhân viên thường** trong transaction `rollback`. Không đọc nội dung hồ sơ, không ghi dữ liệu, không ghi tên/email/UUID vào tài liệu.
- Thử từ ngoài bằng anon key: REST, RPC, Storage, Auth signup. Đọc header HTTP của bản prod `khotienthinh.vercel.app`.
- Build thử `main` để đo bundle. `npm audit --omit=dev` trên lockfile `main`.
- Không chạy load test thật. Dự báo 200 người dựa trên số đo một truy vấn × tần suất ước tính.

---

## 1. Kết luận chính

**Bảo mật: nền tảng đã khá vững sau đợt P0→P3 (27/09–09/10). Không còn lỗ "người ngoài đọc được dữ liệu".** Còn lại là các lỗ *bên trong* (nhân viên đã đăng nhập đọc được nhiều hơn mức cần) và lớp bảo vệ trình duyệt (header, Tailwind CDN, thư viện có CVE).

**Hiệu năng: chưa sẵn sàng cho 200 người đồng thời, và nguyên nhân tập trung ở một chỗ.** Hàm kiểm tra quyền trong RLS được gọi **theo từng dòng**, mỗi lần gọi mất 6–100 ms. Hệ quả đo được với một nhân viên thường:

| Truy vấn | Số dòng quét | Thời gian | Ghi chú |
|---|---:|---:|---|
| Danh sách kho (`warehouses`) | 6 | **674 ms** | 10.353 buffer đọc cho 6 dòng |
| 50 phiếu quy trình mới nhất (`workflow_instances`) | 270 | **2.266 ms** | ~8 ms / dòng |
| Đề xuất chấm công (`hrm_attendance_proposals`) | 229 | **2.645 ms** | ~11 ms / dòng |
| Mẫu quy trình (`workflow_templates`) | 65 | 403 ms | |
| Vật tư 100 dòng (`items`) | 1.624 | 102 ms | đã bọc InitPlan, nhanh hơn 20× |

`pg_stat_statements` xác nhận trên prod: `workflow_instances` 6.038 lần gọi, **trung bình 2,18 s, tối đa 7,97 s** (chạm trần `statement_timeout` 8 s của vai `authenticated`); 28 dạng truy vấn từng chạy > 7,5 s. Máy DB hiện là gói **Small (2 vCPU chia sẻ, 2 GB RAM, 90 kết nối)**. Với chi phí này, ~10–15 người cùng mở danh sách quy trình là DB bão hòa; 200 người thì phần lớn sẽ gặp lỗi hết giờ. **Sửa RLS trước, nâng máy sau** — nâng máy mà không sửa chỉ kéo được 2–3×.

---

## 2. Ưu điểm (giữ nguyên)

| Lĩnh vực | Bằng chứng |
|---|---|
| RLS phủ 100% | 602/602 bảng `public` bật RLS; 1.489 policy; `anon` **không** có grant bảng nào; REST/RPC bằng anon trả 401; Storage anon bị policy `storage_objects_no_anon` chặn |
| Hàm `SECURITY DEFINER` an toàn | 628/628 đặt `search_path = ''`; 12 view đều `security_invoker` |
| Đăng ký công khai đã tắt | `/auth/v1/settings` → `disable_signup: true`; thử signup trả 422 |
| Pre-request gate | `pgrst.db_pre_request = enforce_active_app_actor` chặn tài khoản không có hồ sơ active (0,4 ms/lần) |
| Giới hạn truy vấn theo vai | `anon` 3 s, `authenticated` 8 s, `lock_timeout` 8 s; `safeupdate` chặn UPDATE/DELETE không WHERE |
| Secrets đúng chỗ | Không có `service_role` trong mã client; `.env` bị ignore; lịch sử git chỉ từng commit URL + anon key + VAPID public (đều là giá trị công khai) |
| Edge Function | Mọi hàm đều xác thực JWT bằng `auth.getUser` hoặc secret Vault; `create-user`, `manage-user-account` đòi Admin; `reset-password` chỉ cho tự đổi hoặc Admin kèm lý do; worker cron dùng secret riêng, không nhận JWT người dùng |
| Chống XSS | 7 chỗ `dangerouslySetInnerHTML` đều qua `escapeHtml` trước khi format markdown; cửa sổ in dùng `escapeHtml` |
| Client bền với mạng yếu | `lib/supabase.ts`: timeout 15 s, retry có backoff chỉ cho GET, khóa refresh token giữa các tab |
| CI | typecheck + 739 file test + build + kiểm tra baseline migration + kiểm kê truy vấn Supabase (`check:supabase-queries`) |
| Tải theo module | `AppContext` lúc khởi động chỉ tải `app_settings`; dữ liệu WMS/HRM/TS tải khi vào module, phân trang 1.000; 60+ màn đều `React.lazy` |
| Service worker | HTML network-first (không kẹt bản cũ), asset có hash cache-first, bỏ qua Supabase |
| Cache DB | tỉ lệ hit 100%, 0 deadlock; DB 475 MB, Storage 3,3 GB — còn rất nhỏ |

---

## 3. Phát hiện — Bảo mật

Mức: **Cao** = cần sửa trước khi mở rộng người dùng; **Vừa** = sửa trong 1–2 tháng; **Thấp** = dọn dẹp.

### S1 · Cao — ~100 bảng SELECT `USING (true)` cho mọi nhân viên, có bảng nhạy cảm

Mọi tài khoản active đọc toàn bộ: `salary_3p_settings`, `payment_schedules`, `cash_vouchers`, `cash_voucher_items`, `cash_funds`, `kpi_scores`, `subcontractor_contracts`, `supplier_contracts`, `contract_cost_items`, `asset_assignments`, `hrm_salary_policies`, `project_vendors`, `approval_rules`, `request_logs`, `user_signatures`, `users` (gồm `phone`, `email`, `manager_id`). Audit 27/09 đã nêu nhóm này; phần còn lại chưa thu hẹp. Số dòng hiện nhỏ (tiền, hợp đồng vài chục dòng) nên tác động chưa lớn, nhưng sẽ tăng khi Tài chính dùng thật.

**Cách sửa:** thay `true` bằng hàm quyền có sẵn (`app_private.finance_can('view')`, `hrm_can_access_employee_subject`, `is_admin()`), bọc `(select …)` để không tốn thêm chi phí. Các bảng danh mục thuần (`units`, `categories`, `hrm_offices`…) giữ `true` là đúng.

### S2 · Cao — Chữ ký của mọi người tải được

Policy `Users can read all signatures` (`user_signatures`, `USING (true)`) + Storage `workflow_templates_read` cho mọi `authenticated` đọc cả bucket `workflow-templates` (nơi chứa `signatures/`). Bất kỳ nhân viên nào cũng lấy được ảnh chữ ký Giám đốc để ghép vào tài liệu in.

**Cách sửa:** `user_signatures` chỉ cho chủ sở hữu, Admin, và người đang duyệt cùng phiếu; Storage tách `signatures/` khỏi `workflow-templates` hoặc thêm điều kiện đường dẫn; chuyển sang signed URL ngắn hạn khi in.

### S3 · Vừa — Storage cho tải lên tự do ở vài bucket

`workflow_attachments_insert` (bucket 52 MB/file), `auth_insert` (`project-files`), `Allow public upload to avatars` chỉ kiểm `bucket_id`. Bucket `avatars` và `Images` là **public**, không giới hạn MIME/kích thước → nhân viên có thể dùng Vioo làm nơi host file công khai (phishing, mã độc) và làm đầy dung lượng.

**Cách sửa:** giới hạn `file_size_limit` + `allowed_mime_types` (ảnh) cho `avatars`/`Images`; thêm điều kiện đường dẫn `<user_id>/…` khi upload; xóa bucket `Images` nếu không dùng (0 file).

### S4 · Vừa — Không có header bảo mật ở Vercel

Prod chỉ có HSTS (Vercel tự thêm). Thiếu `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. App có camera, vị trí, passkey → nên khai báo `Permissions-Policy` rõ.

**Cách sửa:** thêm `headers` vào `vercel.json`. CSP cần cho phép Supabase, Google Fonts, và (tạm) `cdn.tailwindcss.com`, `esm.sh` cho tới khi làm S5.

### S5 · Vừa — Tailwind Play CDN + importmap `esm.sh` chạy trong prod

`index.html` tải `https://cdn.tailwindcss.com` (bản JIT chạy trong trình duyệt, Tailwind ghi rõ *không dùng cho production*) và còn `importmap` trỏ React/recharts/xlsx tới `esm.sh`. Rủi ro chuỗi cung ứng (mã bên thứ ba không khóa phiên bản, không SRI) và là lý do không thể đặt CSP chặt. Đây cũng là mục hiệu năng (xem H6).

**Cách sửa:** cài `tailwindcss` + PostCSS, chuyển cấu hình inline (`tailwind.config`) sang `tailwind.config.js`; xóa `importmap` (Vite đã bundle, importmap không còn tác dụng).

### S6 · Vừa — Thư viện có CVE, chưa có cổng kiểm `npm audit` trong CI

| Gói | Mức | Vấn đề | Tình trạng |
|---|---|---|---|
| `xmldom` (qua `open-docxtemplater-image-module`) | critical | nhiều lỗi XML injection/DoS | không có bản vá qua gói cha |
| `xlsx` 0.18.5 | high | Prototype Pollution, ReDoS | SheetJS không phát hành bản vá trên npm |
| `react-router-dom` 6.30 | moderate | open redirect qua `\`; chỉ ảnh hưởng SSR | vá ở v7 (major) |
| `fflate` | moderate | vòng lặp vô hạn ZIP64 | có bản vá |

Vioo đọc Excel/Word do người dùng tải lên → `xlsx`/`xmldom` xử lý dữ liệu không tin cậy. Tác động thực tế là treo tab trình duyệt (DoS phía client), không lộ dữ liệu.

**Cách sửa:** `xlsx` → lấy từ CDN SheetJS chính thức (`cdn.sheetjs.com`, bản 0.20.x) hoặc `exceljs`; thay `open-docxtemplater-image-module` bằng `docxtemplater-image-module-free` bản mới hoặc bỏ nếu chỉ chèn ảnh đơn giản; thêm bước `npm audit --omit=dev --audit-level=high` vào CI (cho phép ngoại lệ có ghi lý do).

### S7 · Vừa — Chưa bật MFA; mật khẩu tối thiểu 6 ký tự

`mfa_enabled` = null; `create-user` chấp nhận mật khẩu ≥ 6 ký tự. Tài khoản Admin (cấp quyền cho 88 người, xem tài chính) chỉ có mật khẩu.

**Cách sửa:** bật TOTP trong Supabase Auth, bắt buộc cho `role = ADMIN` và nhóm Tài chính/HR (kiểm `aal2` trong RLS các bảng nhạy cảm); nâng tối thiểu 10 ký tự ở Dashboard và `create-user`/`reset-password`.

### S8 · Thấp — Tàn dư cơ chế quyền cũ

84 policy vẫn gọi `is_module_admin()`; 5 policy khai `TO anon` (vô hiệu vì anon không có grant); 363 hàm `public` cho `anon` EXECUTE theo mặc định (`enforce_active_app_actor` chỉ chặn vai `authenticated` không hồ sơ, còn anon bị chặn vì không EXECUTE được chính hàm gate — hiệu quả nhưng tình cờ). CORS `*` ở 11/18 Edge Function (chấp nhận được vì xác thực bằng JWT, nhưng nên khóa về domain prod).

**Cách sửa:** `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM anon` + revoke hàng loạt hàm hiện có; xóa 5 policy anon; thay `is_module_admin` dần theo lộ trình phân quyền.

### S9 · Thấp — Vệ sinh dev

`.env` máy dev chứa `SUPABASE_ACCESS_TOKEN`, mật khẩu DB prod/staging, `TYPESAFE_API_KEY`. Không bị commit, nhưng là một file chữ thường trên máy cá nhân; token MCP Supabase hiện đã hết hạn (server MCP báo 401). Anon key đang dùng là JWT kiểu cũ, chưa chuyển sang *publishable key* có thể xoay.

---

## 4. Phát hiện — Hiệu năng & khả năng mở rộng

### H1 · Cao — Hàm quyền gọi theo từng dòng trong RLS (nút thắt số 1)

186/949 policy SELECT/ALL gọi hàm phụ thuộc dòng (`wms_has_action(id)`, `workflow_instance_actor_can_select(id)`, `hrm_can_access_employee_subject(targetEmployeeId)`, `workflow_template_actor_can_view(template_id, …)`) nên Postgres phải gọi lại cho **mỗi dòng** quét, kể cả dòng bị loại. Mỗi lần gọi lại đi qua `resolve_effective_permission_sources` → `user_permission_grants` (46 triệu index scan tích lũy), `project_permission_room_members` (7 triệu), và với WMS còn thêm `is_module_admin` + 3 hàm thủ kho.

| Hàm | Một lần gọi | Buffer |
|---|---:|---:|
| `wms_has_action('wms.inventory.view', <kho>)` | **~100 ms** | ~1.500 |
| `workflow_instance_actor_can_select(<phiếu>)` | ~8 ms | ~130 |
| `has_permission(user, code, 'global', '*')` | 8 ms | 75 |
| `current_app_user_id()` | 0,5 ms | 12 |
| `is_admin()` | 0,9 ms | 26 |

Bằng chứng gián tiếp trên prod: `project_tasks` 203 nghìn seq scan / 165 triệu dòng đọc cho bảng 863 dòng; `warehouses` (vài dòng) trung bình **936 ms**; `assets` 1,29 s; `hrm_leave_logs` 867 ms; `warehouse_types` 493 ms.

**Cách sửa (theo thứ tự hiệu quả/chi phí):**

1. **Bọc InitPlan mọi điều kiện không phụ thuộc dòng** — mẫu đã làm cho `items` (#164, 100× nhanh): `(select app_private.wms_has_action('wms.inventory.view'))` thay vì gọi trần. Áp cho `warehouses`, `warehouse_types`, `suppliers`, `assets`, `hrm_leave_*`, `transactions`, `workflow_templates`.
2. **Điều kiện phụ thuộc dòng → semi-join với tập cho phép tính một lần:** `id in (select app_private.workflow_instances_visible_to(current_app_user_id()))` hoặc `warehouse_id = any((select app_private.my_wms_warehouses('wms.inventory.view'))::text[])`. Hàm trả tập là `STABLE`, chạy đúng một lần mỗi câu lệnh.
3. **Bộ nhớ đệm quyền theo phiên:** `get_my_authorization_snapshot` đã tính đủ (14 ms); ghi kết quả vào `request.jwt.claims`/custom claims hoặc bảng `user_effective_permissions` cập nhật bằng trigger khi grant/room thay đổi, để `has_permission` thành một lần tra index.
4. Thêm index cho `workflow_subjects(workflow_instance_id)`, `project_permission_room_members(user_id, room_id)` nếu chưa có khi làm bước 2.

Kỳ vọng: danh sách quy trình 2,3 s → < 50 ms; kho 674 ms → < 10 ms. Đây là **điều kiện tiên quyết** cho 200 người.

### H2 · Cao — Realtime `postgres_changes` nhân chi phí RLS theo số người nghe

Module WMS đăng ký `postgres_changes` trên 9 bảng (`items`, `transactions`, `requests`, `activities`, `warehouses`…), HRM 2 bảng; publication `supabase_realtime` có **67 bảng** (gồm `users`, `user_permission_grants`, `notifications`, `chat_*`). Với `postgres_changes`, Realtime phải chạy RLS **cho từng người đang nghe** mỗi khi có thay đổi: 1 phiếu nhập kho → 200 lần `wms_has_action` (~100 ms) = 20 s CPU DB. Ngoài ra Realtime Pro giới hạn 500 kết nối đồng thời; mỗi tab là 1 kết nối, 200 người × 1,5 tab là sát trần.

**Cách sửa:** (1) làm H1 trước — giảm 10–100× ngay; (2) chuyển các bảng có lưu lượng ghi cao (`transactions`, `activities`, `notifications`, `chat_v2_messages`) sang **Broadcast từ trigger** (`realtime.broadcast_changes`) theo kênh riêng (`wms:<warehouse_id>`, `user:<id>`), RLS chỉ kiểm một lần lúc join kênh; (3) rút publication về đúng các bảng client thật sự nghe (17 chỗ `.channel(` trong mã); (4) tắt realtime khi tab ẩn > 5 phút.

### H3 · Vừa — Máy DB gói Small, không có chỗ dự phòng

`max_connections` 90, `shared_buffers` 512 MB, `work_mem` 5 MB, `max_parallel_workers` 2 → gói Small (2 vCPU chia sẻ, 2 GB). Hiện đã 42 kết nối mở (PostgREST 22, Realtime 11, Storage, pg_net, exporter). 2 truy vấn hiện tại đã mất 2–3 s CPU → chỉ cần 1 CPU bận thường trực là mọi người chậm.

**Cách sửa:** sau H1, nâng **Medium (4 GB, 2 vCPU riêng)** là đủ 200 người với dự phòng; nếu dùng nhiều báo cáo/biểu đồ AI, cân nhắc Large. Bật `pg_stat_statements` reset định kỳ để theo dõi sau khi sửa (số hiện tại còn lẫn sự cố 8,4 triệu lỗi ngày 11/10).

### H4 · Vừa — 16 job cron, 4 job chạy mỗi phút, không có khóa chồng lấn

`process-request-notifications` (http_post tới Edge), `process_vehicle_notification_outbox`, `work_notification_tick`, `workflow_notification_tick` chạy `* * * * *`; `run_scheduled_alerts` mỗi 5 phút mất trung bình 404 ms. 7 lần thất bại/7 ngày. Khi DB bận (H1), job cron xếp hàng và chồng lên nhau.

**Cách sửa:** gộp các tick thông báo thành 1 job mỗi phút gọi lần lượt; thêm `pg_try_advisory_lock` trong mỗi tick; đổi sang 2–3 phút cho outbox ít việc.

### H5 · Vừa — Bảng telemetry phình, không có vòng đời

`user_session_events` 61 MB / 122 nghìn dòng, **2 lần đọc** từ khi tạo, 2 index 19 MB chưa dùng; `notifications` 21 MB / 11 nghìn dòng; `notification_deliveries`, `permission_audit_events`, `audit_trail` tăng đều. `project_daily_task_progress` 13 MB cho 8 dòng, `project_weekly_task_progress` 7 MB / 8 dòng (bloat, chưa autovacuum). 42 index không dùng (30 MB); 647 FK không có index (phần lớn bảng nhỏ, 30 cột trên bảng > 200 kB).

**Cách sửa:** policy giữ 90 ngày cho `user_session_events`/`notification_deliveries` bằng cron `delete … where created_at < now() - interval '90 days'` theo lô; `VACUUM (FULL)` hai bảng progress ngoài giờ; bỏ index không dùng sau 30 ngày theo dõi; thêm index FK cho `transactions(supplier_id, approver_id)`, `inventory_ledger_entries(created_by)`, `workflow_instances(template_version_id, current_instance_node_id)`.

### H6 · Vừa — Tải lần đầu ở trình duyệt nặng hơn cần thiết

| Thành phần | Raw | Gzip |
|---|---:|---:|
| `index` (entry) | 730 KB | 199 KB |
| `react-vendor` | 240 KB | 78 KB |
| `supabase` | 170 KB | 44 KB |
| `icons` (lucide) | 148 KB | 25 KB |
| Tailwind Play CDN (ước) | ~400 KB | ~110 KB |
| Google Fonts Inter 6 weight | | ~100 KB |

≈ 550 KB gzip trước khi thấy màn đầu, cộng thêm Tailwind JIT **biên dịch CSS bằng JS trên mỗi lần mở trang** (nặng với điện thoại công trường, gây nháy giao diện). Chunk lazy lớn nhất: `three` 1 MB (chỉ tải ở 3D), `FinanceHubView` 687 KB, `Settings` 609 KB. 26 `setInterval` đang chạy (đa số là UI); `KnowledgeBase` và `DispatcherWorkbench` poll 15 s, `Attendance` 60 s.

**Cách sửa:** làm S5 (Tailwind build-time: CSS tĩnh ~30–60 KB, bỏ 110 KB JS + CPU); giảm Inter về 3 weight hoặc self-host; tách `Settings` theo tab; đổi poll 15 s sang realtime/broadcast hoặc 60 s khi tab ẩn.

### H7 · Thấp — Tạm thời ổn, cần theo dõi

- `select('*')` 110 chỗ, `.from()` 693, `.rpc()` 461: đã có kiểm kê truy vấn (`docs/performance/supabase-query-inventory.json`) — nên bổ sung ngưỡng "không `select('*')` trên bảng > 20 cột".
- `enforce_active_app_actor` chạy mỗi request (0,4 ms) — tốt; nếu sau H1 còn thấy nhiều, chuyển kiểm tra sang claim JWT.
- `temp_files` 84 GB tích lũy chủ yếu do script `supabase migration list` của CLI (2 GB/lần), không phải app.
- Playwright e2e (38 spec) chưa chạy trong CI.

---

## 5. Thứ tự khắc phục

| # | Việc | Mức | Công sức | Tác dụng | Phụ thuộc |
|---|---|---|---|---|---|
| 1 | **H1** – Bọc InitPlan + semi-join cho policy WMS, Quy trình, HRM, Tài sản; thêm hàm trả tập cho phép | Cao | 2–3 tuần, theo từng module (WMS → WF → HRM → TS), mỗi module 1 PR + đo lại `pg_stat_statements` | Mở khóa 200 người; giảm 10–100× CPU | — |
| 2 | **S2** – Chữ ký: policy bảng + Storage + signed URL | Cao | 2–3 ngày | Chặn giả mạo chữ ký | — |
| 3 | **S1** – Thu hẹp ~15 bảng nhạy cảm (Tài chính, Lương, KPI, Hợp đồng, Phải trả) | Cao | 1 tuần | Dữ liệu tiền/lương đúng người | Dùng hàm quyền đã có; làm cùng #1 để không chậm thêm |
| 4 | **H2** – Realtime: rút publication, chuyển `transactions`/`activities`/`notifications`/chat sang Broadcast | Cao | 1–2 tuần | Chi phí không nhân theo số người | Sau #1 |
| 5 | **H3** – Nâng compute Medium; reset thống kê; đặt cảnh báo CPU > 60 % | Vừa | 1 giờ + thao tác Dashboard (chủ SP) | Dự phòng | Sau #1 để đo đúng |
| 6 | **S4 + S5** – Header bảo mật `vercel.json`; Tailwind build-time; bỏ importmap | Vừa | 2–4 ngày (CSP cần thử kỹ camera/3D/push) | Chống clickjacking/XSS, tải nhanh hơn | — |
| 7 | **S3** – Khóa MIME/kích thước bucket public; điều kiện đường dẫn upload; xóa `Images` | Vừa | 1 ngày | Chống lạm dụng storage | — |
| 8 | **S6** – Thay `xlsx`/`xmldom`; thêm `npm audit` vào CI | Vừa | 2–3 ngày (kiểm lại nhập Excel, in docx có ảnh) | Hết CVE critical/high | — |
| 9 | **S7** – MFA cho Admin/Tài chính/HR; mật khẩu ≥ 10 | Vừa | 2–3 ngày + hướng dẫn người dùng | Bảo vệ tài khoản quyền cao | Chủ SP quyết nhóm bắt buộc |
| 10 | **H4** – Gộp tick cron + advisory lock | Vừa | 1 ngày | Ổn định khi DB bận | — |
| 11 | **H5** – Retention telemetry; VACUUM FULL 2 bảng progress; index FK; bỏ index thừa | Vừa | 1–2 ngày | Giữ DB gọn | — |
| 12 | **H6** – Fonts, tách `Settings`, poll → realtime | Thấp | 2–3 ngày | Mở app nhanh hơn trên điện thoại | Sau #6 |
| 13 | **S8 + S9** – Revoke EXECUTE anon mặc định; xóa policy anon; thay `is_module_admin`; publishable key; xoay token dev | Thấp | rải theo các PR phân quyền | Dọn tàn dư | — |

**Mốc kiểm tra "sẵn sàng 200 người":** sau #1–#5, chạy load test 200 phiên ảo (k6 hoặc Playwright) với kịch bản: đăng nhập → mở Quy trình → mở Kho → tạo 1 phiếu → nghe realtime, trong 15 phút. Tiêu chí: p95 < 1 s cho danh sách, 0 lỗi hết giờ, CPU DB < 60 %.

---

## 6. Dự báo khả năng phục vụ 200 người

Giả định mỗi người thao tác 1 truy vấn danh sách / 30 s và 1 thay đổi dữ liệu / 5 phút.

| Kịch bản | CPU DB cần | Gói Small (2 vCPU chia sẻ ≈ 1,2 hiệu dụng) | Gói Medium (2 vCPU riêng) |
|---|---|---|---|
| Hiện trạng (danh sách 0,7–2,6 s, realtime ×200) | ~15–25 vCPU | ❌ quá tải ~15× | ❌ quá tải ~10× |
| Sau H1 (danh sách 20–50 ms), realtime còn `postgres_changes` | ~2–3 vCPU | ⚠️ sát trần | ⚠️ 100–120 % |
| Sau H1 + H2 (broadcast) | ~0,5–0,8 vCPU | ✅ | ✅ dự phòng 2–3× |

Các lớp khác không phải nút thắt ở 200 người: Vercel (tĩnh, CDN), PostgREST (pool 22 kết nối, mỗi request vài ms sau H1), Edge Functions (AI có hạn mức riêng theo người), Storage (3,3 GB).

---

## 7. Phụ lục — số liệu đo (20/10/2026)

- Bảng `public`: 602, RLS 602, policy 1.489, hàm 1.337 (SECDEF 628), trigger 441, index 2.172 (118 MB), DB 475 MB.
- Người dùng: 92 auth / 95 hồ sơ (88 active), 76 đăng nhập trong 30 ngày.
- Kết nối: 42 (PostgREST 22, Realtime 11, khác 9); `max_connections` 90.
- `pg_stat_statements` (tích lũy, có lẫn sự cố 11/10): 4.934 dạng, 125 triệu lần gọi, 183 nghìn giây. Top theo tổng thời gian: `workflow_instances` 13.168 s / 6.038 lần; RPC `p_filters,p_limit` 12.822 s / 20.515 lần (625 ms); `workflow_nodes` 12.419 s (2,14 s); `workflow_edges` 10.145 s (1,75 s); `workflow_instance_logs` 9.409 s (1,32 s); `hrm_attendance_proposals` 6.729 s (2,92 s); `workflow_templates` 5.785 s (1,07 s).
- Storage: 23 bucket, lớn nhất `project-photos` 1,7 GB / 2.083 file, `project-safety-attachments` 576 MB, `hr-documents` 374 MB. Public: `avatars`, `Images`, `asset-images`.
- Cron: 16 job active, 48.083 lần chạy/7 ngày, 7 thất bại.
- Build `main`: 274 chunk JS, 13,7 MB raw; entry 730 KB (199 KB gz).
- `npm audit --omit=dev`: 1 critical, 1 high, 4 moderate.
- Lệnh đo lại sau khi sửa (vai nhân viên thường, rollback):

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role','authenticated','email', email)::text, true)
from public.users where is_active and role <> 'ADMIN' and auth_id is not null limit 1;
set local role authenticated;
explain (analyze, buffers) select id, code, status from public.workflow_instances order by created_at desc limit 50;
explain (analyze, buffers) select * from public.warehouses;
rollback;
```

---

## 8. Kết quả sau khắc phục (cập nhật 20/10 tối)

- **PR #267 (H1, module Kho)** merged `f8e1d9d7`, migration `20261021120000_rls_initplan_wms` đã có hiệu lực trên Cloud (tích hợp Supabase GitHub tự áp khi merge vào `main`). Đo lại theo vai nhân viên thường:

| Truy vấn | Trước | Sau |
|---|---:|---:|
| `warehouses` (6 dòng) | 674 ms | **18 ms** |
| 50 phiếu kho `transactions` | ~1,3 s | **12 ms** |
| 50 yêu cầu `requests` | — | **6,7 ms** |
| `assets` 50 dòng | ~1,3 s | **10 ms** |

- **PR #266 (S1, S2)** CI xanh, migration đổi số `20261021130000_rls_signatures_sensitive_select`; chờ merge (migration sẽ tự áp khi merge).
- Còn lại theo thứ tự mục 5: H1 cho Quy trình (WF) → HRM → H2 Realtime → H3 nâng máy.
- **PR #266 (S1, S2)** merged `4501bd50`, migration `20261021130000` tự áp sau 60 s, Vercel prod đã lên `4501bd50`. Đếm theo vai sau áp: nhân viên thường thấy **0** dòng ở `cash_vouchers`, `payment_schedules`, `salary_3p_settings`, `kpi_scores`, `supplier_contracts`, `subcontractor_contracts`, `user_signatures` và 0 file `signatures/`; Admin thấy đủ (1 / 6 / 1 / 0 / 14 / 5 / 6 / 6) bằng tổng thật. `pg_stat_statements` đã reset lúc áp xong để đo nền mới.
- **PR #268 (H1 Quy trình)** merged `9d7b92bc`, tự áp: 50 phiếu 2.266 → **34 ms** (nhân viên thường), mẫu/nodes 19 ms, nhật ký phiếu 31 ms; 88 người 0 lệch (`docs/performance/rls-initplan-wf-2026-10.md`).
- **PR #269 (H1 Nhân sự)** merged `efcd9b63`, tự áp: đề xuất chấm công 2.645 → **30 ms**, nhật ký phép 853 → 33 ms, phép tồn 810 → 17 ms; 88 người × 7 bảng 0 lệch (`docs/performance/rls-initplan-hrm-2026-10.md`). **H1 xong** cho Kho, Quy trình, Nhân sự, Tài sản.
- **PR #270 (H2 đợt 1)** merged `d1a8d89e`, tự áp: publication Realtime 67 → **44 bảng** (đã kiểm trên Cloud), tab ẩn > 5 phút tạm ngắt kênh WMS/HRM và tải ngầm khi quay lại (`docs/performance/realtime-h2-2026-10.md`). Đợt 2 (Broadcast theo kho) để khi Kho > 50 người đồng thời.
- Còn lại theo mục 5: **H3** nâng máy Medium (Dashboard, chủ SP), S4+S5 header + Tailwind build, S3 bucket, S6 CVE, S7 MFA, H4 cron, H5 retention, H6 fonts.
- **PR #272 (S4 + S5)** merged `565581f2`, Vercel prod lên sau 60 s. Kiểm bằng `curl`: có `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`, CSP thực thi (`frame-ancestors`/`object-src`/`base-uri`) + CSP đầy đủ Report-Only; `index.html` không còn `cdn.tailwindcss`/importmap; `/assets/*` cache 1 năm, `/sw.js` no-cache. Trình duyệt prod (Admin): Trang chủ, Cài đặt, Quy trình, Kho, Check-in hiển thị đúng, không có `Refused` của CSP. Bước sau: bỏ `upgrade-insecure-requests` khỏi Report-Only và bật CSP thực thi khi anh duyệt đủ màn (hướng dẫn `docs/security/http-headers-2026-10.md`).
- **PR #276 + #279 (S3)** merged (`76ede1fe`, sửa `683a6318`): bản đầu lỗi vì `storage.protect_delete()` cấm xóa bucket bằng SQL nên tích hợp không áp; bản sửa khóa `Images` (private, 1 byte) thay vì xóa. Đã áp Cloud: `avatars` ảnh ≤ 5 MB + policy INSERT chỉ `employees/`; `project-files`/`project-attachments` 50 MB. Anh xóa hẳn `Images` trên Dashboard. Follow-up: `contract_files_select` còn mở cho mọi nhân viên.
- **PR #277 (S6)** merged `c753b299`, prod lên: `xlsx` 0.20.3 (tarball SheetJS), `xmldom` → `@xmldom/xmldom` 0.9.12, `fflate` 0.8.3; CI có `npm audit --audit-level=high` (đã chạy xanh trên main). Còn 2 moderate react-router (SSR, không dùng). Chưa thử in phiếu Quy trình có ảnh trên prod.
- **PR #280 (H4 + H5)** mở: 6 job cron → 2 tick có `pg_try_advisory_xact_lock` + exception riêng từng việc; retention `user_session_events`/`notification_deliveries` 90 ngày, `user_sessions` 180 ngày (mỗi ngày 03:15 UTC, lô 5.000); 21 index FK; bỏ 4 index 0 lần dùng; sửa job `cleanup-expired-hrm-imports` lỗi 7/7 ngày (xóa storage bằng SQL). **Đính chính H5:** `project_daily_task_progress` / `project_weekly_task_progress` / `cost_norm_import_raw_rows` không bloat — chưa từng ANALYZE nên `n_live_tup` báo 8 dòng, thực tế 14.318 / 7.702 / 3.865 dòng; đã `VACUUM (FULL, ANALYZE)` 20/10, kích thước gần như không đổi nhưng thống kê đã đúng.
- **PR #280 (H4 + H5)** merged `b394f6d9`, migration `20261022183000` áp sau 60 s: cron còn 13 job (2 tick có khóa + retention hằng ngày), 21 index FK, bỏ 4 index.

## 9. Việc tiếp theo ngày 21/10

Chủ sản phẩm để **sau** (không tự làm): H3 nâng compute Medium, S7 MFA cho Admin/Tài chính/HR, bật CSP thực thi (sau khi xem Console không còn `Refused`), xóa bucket `Images` trên Dashboard.

| PR | Việc | Kết quả trên Cloud / prod |
|---|---|---|
| #298 | Tệp hợp đồng (`contract-files`) chỉ đọc khi xem được dòng hợp đồng chủ | Migration `20261025200000` đã áp. Kiểm 88 người: 0 lệch so với RLS bảng hợp đồng; 41 nhân viên không còn đọc được tệp nào (trước 13/13) |
| #299 | Dọn tệp nhập nhân sự hết hạn (`hrm-private-imports`) | Migration `20261025210000` đã áp; Edge Function `hrm-checkin-photo-retention` bản 226 đã deploy (gọi không secret → 401). Lượt chạy thật đầu tiên 20:20 UTC 21/10 |
| #300 | H6: Inter tự host, tách mỗi mục Cài đặt, poll chỉ khi tab hiện | Prod: 0 request Google Fonts, 3 tệp woff2 cache 1 năm, CSP report-only bỏ 2 host font; chunk `Settings` 609 → 106 KB, mục Người dùng tải riêng khi mở |
| #301 | H2 đợt 2: Broadcast theo kênh phạm vi cho `transactions`, `activities`, `items` | Migration `20261025220000` đã áp (3 trigger, policy `wms_broadcast_receive`). Kiểm 88 người × 3 bảng: 0 lệch. Trên prod (Admin): client vào 4 kênh, không quay về cách cũ; WebSocket thử: kênh được phép vào được và nhận tin từ DB, kênh người khác / kênh lạ bị từ chối `Unauthorized`; `realtime.subscription` không còn 3 bảng này |

**Bài học vận hành:** từ #298, tích hợp Supabase GitHub **không tự áp** migration khi merge (không có lỗi, không báo). Sau mỗi merge có migration phải kiểm `supabase_migrations.schema_migrations`; nếu thiếu thì `supabase db push --linked` từ `main`.

**Phát hiện phụ (chưa sửa):** RPC `award_my_daily_xp` trả 404 trên mọi trang (hàm không tồn tại trên Cloud). Tab mở từ trước một lần deploy gặp chunk cũ 404 khi chuyển màn, nhưng `ErrorBoundary` đã tự tải lại (giới hạn 30 giây một lần) nên không cần sửa.

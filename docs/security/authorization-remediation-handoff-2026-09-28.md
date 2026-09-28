# Handoff — Phân quyền, RLS, Storage và Notification (P0 → P2)

**Cập nhật:** 28/09/2026. Mục đích của tài liệu: một agent mới đọc xong có thể làm tiếp ngay mà không phải khảo sát lại.

## 1. Đọc gì trước

1. `AGENTS.md` ở gốc repo. Ràng buộc bắt buộc:
   - Chỉ dùng Supabase Cloud qua `.env`; không dùng Supabase local, không Docker.
   - Không dùng sub-agent.
   - Chuẩn UI/UX: đủ trạng thái loading/empty/error/denied; không che lỗi hoặc giá trị chưa biết bằng `0`; walkthrough desktop/mobile.
2. Tài liệu này.
3. [Rollout log](authorization-remediation-rollout-log.md): bằng chứng chi tiết từng bước (số đếm, dry-run, smoke).
4. [Phương án P0 → P3](authorization-remediation-plan-2026-09-27.md) và [audit 27/09](../audits/permission-rls-notification-2026-09-27/README.md): bối cảnh gốc. Một số nhận định của audit đã được chỉnh lại, xem mục 6.

## 2. Môi trường làm việc

| Mục | Giá trị |
|---|---|
| Worktree | `/Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2` |
| Nhánh | `feature/authorization-p0-hardening`. Mỗi bước xong được push lên nhánh **và** fast-forward `origin/main`. |
| Checkout chính | `/Users/admin/khotienthinh`: có thay đổi chưa commit của luồng khác, **không đụng vào**. |
| Supabase | Project `ftciqmqhmfvjtwoycswe` (Cloud main). Truy vấn bằng CLI: `set -a && source /Users/admin/khotienthinh/.env && set +a && npx supabase db query --linked -f <file.sql>`. |
| Apply migration | MCP `mcp__supabase__apply_migration` (tải schema qua ToolSearch `select:mcp__supabase__apply_migration`). |
| Dev server | Cổng **3200** chạy từ worktree này: `npx vite --port 3200 --strictPort`. Cổng 3100 là worktree của luồng khác. Chủ sản phẩm đăng nhập Admin trong browser pane. |
| Quyền git | Chủ sản phẩm cho phép "mức 2": agent tự `git push`, kể cả lên `main`. |

**Mẹo dùng CLI:**
- Kết quả JSON có kèm cảnh báo ở cuối; parse bằng `json.JSONDecoder().raw_decode(t[t.index('{'):])`.
- Một file `-f` chỉ trả về kết quả của câu lệnh cuối cùng.

## 3. Quy trình bắt buộc cho mọi thay đổi Cloud

1. **Kiểm consumer trước khi siết:** frontend, Edge Function, cron, và các hàm SECURITY DEFINER dùng bảng hay hàm đó.
2. Viết migration trong `supabase/migrations/<timestamp tạm>_<tên>.sql`, smoke trong `supabase/tests/<tên>_smoke.sql` (luôn `rollback`), rollback trong `supabase/operations/`.
3. **Dry-run trên Cloud:** `begin; <migration>; <smoke>; <script rollback nếu có>; rollback;`.
4. Nếu frontend phụ thuộc thay đổi server thì apply server trước; nếu frontend đọc được cả trạng thái cũ thì push frontend trước.
5. **Xin chủ sản phẩm xác nhận** bằng AskUserQuestion, nói rõ tác động (số người, số dòng) và có phương án "Chờ".
6. Apply bằng MCP, rồi lấy version thật: `select version from supabase_migrations.schema_migrations where name='<tên>'`.
7. Đổi tên file theo version đó và thêm vào `supabase/baseline/current.json` (mảng `allowedPostBaselineFiles`, ngay sau file mới nhất).
8. Chạy smoke sau apply, ghi rollout log (**chỉ số đếm, không PII**), commit (kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), push nhánh và `origin/main`.
9. Chạy `npx vitest run`, `npx tsc --noEmit -p .`, `npm run build`, `npm run check:supabase-queries`; truy vấn mới phải có `.limit()`.

**Kiểm với persona trong smoke:**
- Dùng `set local role authenticated` rồi `set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role','authenticated')::text, true)`.
- Tra dữ liệu fixture **trước** khi đổi role, vì RLS của `users` chặn.
- Worker notification cần `request.jwt.claim.role = service_role`.

**Ghi dữ liệu vào `public.users`:**
- Có trigger chặn ghi cột legacy. Cách chính thức: `select set_config('app.authorization_legacy_migration','on',true)`, và `alter table public.users disable trigger trg_users_prevent_privilege_self_update` rồi bật lại.
- Ghi audit vào `app_private.authorization_legacy_write_audit`.

## 4. Quyết định của chủ sản phẩm

Đang có hiệu lực, cũng lưu trong memory `authorization-owner-decisions-2026-09-27`.

1. **Tài chính và Hợp đồng dự án:** công tắc xem theo từng người, **2 công tắc riêng**, có lựa chọn "Tất cả dự án". Chỉ Admin bật/tắt.
   - Tự động được xem: người **xử lý** chứng từ (edit/submit/verify/approve/confirm) trong Room Thanh toán hoặc Nghiệm thu, và người quản trị hợp đồng cấp công ty.
2. **Admin toàn quyền trong dự án.** Chưa mở phân quyền Room cho PM/CHT.
3. **Bỏ quản trị module legacy:**
   - DA: bỏ hết.
   - Quy trình: 23 người được mẫu "Người dùng quy trình"; giữ quản trị cho 7 người, thu hồi 16.
   - Kho: thu hồi 22 người.
   - Hợp đồng: thu hồi cả 7; quản trị hợp đồng chỉ còn Admin.
   - Tài sản: giữ 1 người.
   - Phiếu yêu cầu: thu hồi cả 15.
4. **Chỉ Admin ghi** tạm ứng, hạng mục chi phí, snapshot dashboard dự án.
5. **Giữ tài khoản test `@example.invalid`**: chủ sản phẩm dùng cho việc khác.
6. **`award_my_daily_xp` / XP** là tính năng phụ: bỏ qua; lỗi 404 của nó không tính là regression.
7. **Thông báo Quy trình** bật lại ngày 27/09. Backlog lỗi thời bỏ qua; 14 lỗi Phiếu yêu cầu tháng 8 đóng, không gửi lại.
8. **Cảnh báo định kỳ** chuyển lên server theo đợt; đợt 1 là 6 loại. **Nhắc chấm công đang tắt** cho tới khi chủ sản phẩm báo trước cho nhân viên.

## 5. Đã hoàn thành (tất cả đã apply Cloud và nằm trên `origin/main`)

| Bước | Migration | Tóm tắt |
|---|---|---|
| P0-A | `20260927023600_authorization_p0a_block_anonymous_access` | Chặn anon trên bảng, hàm và Storage |
| P0-B | `20260927035001_…restrict_client_writes`, `20260927042947_…broadcast_state_and_avatars` | Chặn ghi `true` trên 27 bảng; notification chống giả mạo; broadcast có trạng thái đọc riêng từng người; avatar mặc định |
| P0-C | `20260927071707_…sensitive_view_grants`, `20260927073423_…room_workers_only`, `20260927074935_…enforce_sensitive_reads` | Công tắc Tài chính/Hợp đồng và RLS đọc tương ứng; frontend khóa tab bằng `SensitiveDataGate`; công tắc hiện dạng ô Room có drawer |
| P1.1 | `20260927080700_authorization_p1_retire_legacy_da_admin` | `is_module_admin('DA')` chỉ còn Admin |
| P1.2 | (frontend) | Đồng bộ catalog capability; contract test `lib/permissions/__tests__/permissionCatalogContract.test.ts`; tab "Mẫu quyền" mở được |
| P1.3 | `20260927083431_…retire_room_managed_grants` | Thu hồi mềm 612 grant trên 8 phân hệ Room; frontend đọc Room action; `canManageTab` mặc định `false` |
| P1.4 | `20260927084905_…wms_action_recipients`, `20260927085747_…restrict_audit_trail_reads` | Người nhận WMS theo capability (RPC `list_wms_action_recipients`); `audit_trail` chỉ Admin hoặc `system.audit_trail.view` |
| P1.5 | `20260927091559_…module_admin_from_capability`, `20260927091643_…owner_module_admin_decisions`, `20260927160018_…retire_request_module_admin` | `is_module_admin(X)` = Admin hoặc `system.<x>.manage` (X ∈ HD, WMS, WF, TS, RQ, SETTINGS, TENDER_AI, EX, FEEDBACK; module khác chỉ Admin); áp các quyết định theo nhóm |
| P1.6 | `20260927160626_…private_checkin_photos`, `20260927161923_…private_project_attachments_files` | Ba bucket private; `PrivateStorageLinkResolver` ký lại link cũ ở mọi màn; CDN đã purge; link công khai trả 400 |
| P2.1 | `20260927170749_notification_p2_1_enable_workflow_notifications` | Bật lại worker thông báo Quy trình; subject `material_request` được bỏ qua rõ ràng |
| P2.2 đợt 1 | `20260928031025_notification_p2_2_server_scheduled_alerts` | `app_private.run_scheduled_alerts()` chạy qua cron `server-scheduled-alerts` (`*/5`), 6 loại; RPC `run_scheduled_alerts_now()` |
| P2.2 đợt 2 | `20260928035750_notification_p2_2_server_scheduled_alerts_group2` | Đủ 11 loại trên server; ngân sách → người xem Tài chính, tiến độ → Room `gantt`, hao hụt → Room `material_planning` (`edit`), an toàn → Room `safety` (nhắc hằng ngày, kể cả thiết bị hết hạn kiểm định); trình duyệt không còn quét |
| Thông báo B1 | `20260928044404_notification_delivery_reason` | Mỗi thông báo có `delivery_reason` (assigned/mentioned/watching/responsible/system), gán bằng trigger; chuông và trang Thông báo có tab Việc của tôi · Theo dõi · Nghiệp vụ · Hệ thống |
| Thông báo B2a | `20260928052528_notification_site_command_recipients` | BCH (CHT/CHP/KTT theo `notification_site_command_positions`), tuỳ chọn `includeSiteCommand`, RPC xem trước người nhận; cảnh báo An toàn = Room An toàn + BCH, Admin chỉ dự phòng |
| Thông báo B2b | `20260928062658_notification_event_recipients_request_safety` | Phiếu yêu cầu: người theo dõi chỉ nhận kết quả + quá hạn, người duyệt nhận nhắc hạn + bình luận; sự cố An toàn gửi từ trigger (Cao/Nghiêm trọng → Room AT + BCH) |
| Thông báo B3 | `20260928065520_notification_preferences_digest` | Tuỳ chọn cá nhân (Theo dõi: ngay/tổng hợp/không báo; Nghiệp vụ: ngay/tổng hợp) + tổng hợp cuối ngày qua cron `notification-digests` |
| P2 Người dùng | `20260928080828_authorization_user_snapshot_for_admins` | Màn sửa người dùng tải quyền thật của người được sửa (Room theo dự án, link mở đúng dự án); chọn phạm vi theo tên; bỏ thuật ngữ kỹ thuật, dữ liệu online/đăng nhập giả và ngõ cụt drawer |
| P2 Tài liệu + Nhật ký | `20260928083215_authorization_p2_documents_activities_rls` | `project_documents` theo quyền Tài liệu của dự án (có `created_by`); `activities`: nhật ký Kho theo kho được xem, thao tác quản trị chỉ Admin và người làm. Edge Function `reset-password` v17: Admin đặt mật khẩu cho người khác có lý do + nhật ký |
| P1.6c | `20260928084924_authorization_p1_6_private_project_photos` | Bucket `project-photos` (ảnh nhật ký) private; đọc = người tải, Admin, người xem được nhật ký dự án; resolver tự ký link cũ. **Chờ chủ sản phẩm purge CDN** |
| P3 Mẫu quyền dự án | `20260928092719_authorization_p3_project_room_templates` | 6 mẫu Room theo vai trò (Admin sửa ở Cài đặt → Mẫu quyền dự án); tab Phân quyền dự án có "Phân quyền theo người": điền theo mẫu gợi ý theo chức vụ rồi chỉnh riêng từng quyền |

Mỗi bước có smoke `supabase/tests/<tên>_smoke.sql` và rollback trong `supabase/operations/`.

## 6. Hiểu biết quan trọng về hệ thống (tránh làm lại hoặc làm sai)

**Phân quyền:**
- **Room là nguồn quyền** cho các phân hệ: Nhật ký, Tiến độ, Chốt tiến độ, Chất lượng, An toàn, Thanh toán, Nghiệm thu, PO. Binding đều `enforced`; `project_room_pbac_fallback_enabled = false`.
  - Thanh toán, Nghiệm thu và An toàn đi qua `project_has_permission_v2` → `authorization_v2_final_room_action`.
- **Ngoại lệ vật tư:** grant trực tiếp của phiếu yêu cầu, kế hoạch và BOQ **vẫn có tác dụng** ở server (nhánh `else` của `material_has_action`). Không được thu hồi 292 grant này khi chưa có phương án Room cho vật tư.
- **Snapshot Admin** (`resolve_authorization_snapshot`) có Room action cho mọi dự án (nguồn `admin`). Frontend **không** được tự cho Admin qua theo vai trò trong các hàm Room; test đã khóa hành vi này.
- **`system.<x>.manage`** là grant thật, tạo từ cờ legacy khi migrate. `system.procurement.manage` (4 người) thuộc luồng Procurement V2 và cố ý **không** được tính vào `is_module_admin`.
- **Thao tác phiếu hằng ngày không phụ thuộc capability `request.instance.*`**: phần lớn nhân viên không có các capability này mà vẫn dùng phiếu bình thường.

**Thông báo và dữ liệu:**
- **Thông báo Quy trình:** chỉ phiếu không có subject đi qua worker chung. Subject `request`/`project`/`material_request` do module riêng báo; nhãn bỏ qua là `request_owned` và test đang khóa nhãn này.
- **Storage:** URL công khai cũ vẫn nằm trong dữ liệu. Thêm bucket vào `PRIVATE_LEGACY_PUBLIC_BUCKETS` (`lib/storageSignedUrl.ts`) là resolver tự ký link. Sau khi chuyển bucket sang private phải **purge CDN** bằng secret key; agent không giữ key này, chủ sản phẩm tự chạy lệnh `curl -X DELETE …/storage/v1/cdn/<bucket>`.
- **Nhắc chấm công** trên server tới mọi nhân viên chưa chấm công (thử một văn phòng: 43 người/buổi sáng), vì vậy đang tắt.

**Công cụ:**
- Không dùng `sleep` ở foreground; muốn chờ thì dùng lệnh chạy nền.
- Một số truy vấn thống kê trên `audit_trail` từng bị classifier từ chối; khi đó dùng cách khác, không lách.

## 7. Việc tiếp theo (theo thứ tự đề xuất)

### 7.1 P2.2 đợt 2 — ĐÃ XONG (28/09)

Xem rollout log. Còn mở:
- `request_instances.due_date` chưa được màn Phiếu yêu cầu ghi, nên cảnh báo "Yêu cầu quá hạn" chưa có dữ liệu để chạy. Muốn dùng cần định nghĩa hạn (ví dụ `slaHours` của khối duyệt).
- Quy tắc "Tiến độ chậm" đang tắt và cấu hình `module_admins` với danh sách module rỗng. Nếu bật lại, nên chuyển sang "Nhân sự dự án theo quyền" (Room `gantt`, quyền `edit`).

### 7.1b Thông báo đúng người (chủ sản phẩm yêu cầu 28/09)

Bước 1 đã xong (xem rollout log). Còn lại:
- **Bước 2:** quy tắc người nhận cấu hình được cho từng loại sự kiện, gồm Room + quyền, chức vụ trong dự án (`project_staff.position_id`) và người liên quan, giới hạn trong đúng dự án hoặc công trường. Thêm nút "Xem trước người nhận" trong Cài đặt → Thông báo. Làm trước với Phiếu yêu cầu và Tiến độ, sau đó An toàn và Vật tư.
  - ĐÃ XONG phần BCH và xem trước người nhận cho cảnh báo định kỳ (B2a). **Dữ liệu cần bổ sung:** chưa ai được gán chức vụ Chỉ huy trưởng trong nhân sự dự án, và chỉ 6/86 dự án có nhân sự dự án.
  - ĐÃ XONG thông báo theo sự kiện cho Phiếu yêu cầu và An toàn (B2b, `20260928062658_notification_event_recipients_request_safety`): người theo dõi phiếu chỉ nhận kết quả cuối + quá hạn; người duyệt đang chờ nhận nhắc hạn + bình luận; sự cố Cao/Nghiêm trọng gửi từ trigger tới người được giao + Room An toàn + BCH.
  - Tiến độ (Work), Nhật ký, Vật tư/PO thuộc luồng khác: chỉ đề xuất (xem rollout log), không sửa.
  - Room An toàn (quyền xác nhận/duyệt) đang có 11 người; nên rà lại cho đúng "người quản lý an toàn".
  - Nơi tạo thông báo mới nên truyền `delivery_reason`; trigger chỉ là dự phòng.
- **Bước 3:** ĐÃ XONG (B3). Nghiệp vụ chỉ được chuyển sang tổng hợp, không tắt được (quyết định 28/09).

### 7.2 Màn Cài đặt → Người dùng (P2, UX) — ĐÃ XONG (28/09)

Xem rollout log. Còn mở, cần chủ sản phẩm quyết:
- Lý do tối thiểu 10 ký tự vẫn bắt buộc khi chỉ sửa thông tin hồ sơ (RPC `update_user_authorization_v2`).
- ĐÃ XONG: Admin đặt mật khẩu mới cho người khác (drawer người dùng, `reset-password` v17).

### 7.3 Hai bảng còn `select true` — ĐÃ XONG (28/09)

Xem rollout log. Không còn bảng nào mở `select true` cho mọi người trong phạm vi audit.

### 7.4 Bucket `project-photos` — ĐÃ XONG (28/09)

Xem rollout log P1.6c. Còn: chủ sản phẩm purge CDN `project-photos`; luồng Daily log nên chuyển `DailyLogTab` sang lưu đường dẫn và ký link (không bắt buộc).

### 7.5 P3 (theo phương án)

- Màn "Hồ sơ quyền" hợp nhất theo từng người.
- ĐÃ XONG (28/09): mẫu quyền Room theo vai trò + phân quyền theo người. Form tạo dự án cũng áp mẫu Room (7d6a2d5). 
- ĐÃ XONG (28/09): chuyển vai trò thường sang quyền riêng từng người (8aba991). Chỉ còn AUDITOR, HR, HR_MANAGE, PERMISSION_ADMIN, SYSTEM_ADMIN.
- ĐÃ XONG (28/09): mẫu quyền theo vị trí cho toàn hệ thống (5aace83). Gồm 14 mẫu, sửa ở Cài đặt → Mẫu quyền theo vị trí; "Điền nhanh theo mẫu vị trí" nằm trong Người dùng → Sửa.
- **CHỜ CHỦ SẢN PHẨM — lỗi hồi quy của bước chuyển vai trò:**
  - 55 người có `hrm.employee.edit_profile@own` không có ngày hết hạn, kèm 6 bản global và một số quyền duyệt chấm công / nghỉ phép.
  - `app_private.evaluate_direct_grant_replacement_impl` bắt buộc hạn cho mọi quyền cần hạn trong lần lưu, nên Admin **không lưu được hồ sơ / quyền của những người này** ở Người dùng.
  - Đề xuất: miễn hạn cho quyền đang có sẵn, không đổi; và (tùy chọn) miễn hạn cho quyền tự phục vụ phạm vi "Chính mình", không nhạy cảm.
  - Bộ kiểm tra an toàn tự động đã chặn thay đổi này vì nó nới lỏng một kiểm tra, nên cần chủ sản phẩm quyết.
- Tiếp: ô bị khóa do vai trò đặc biệt (HR, quản trị) phải giải thích lý do và chỉ chỗ đổi (tab Vai trò nhân sự).
- Mở Room cho PM/CHT khi chủ sản phẩm quyết định.
- Task 13: drop cột legacy (`allowed_modules`, `admin_modules`, …) sau khi hết phụ thuộc. `can_access_module` và `resolve_effective_permission_sources` vẫn đọc cột legacy.

### 7.6 Việc mở chờ người khác

- **Luồng Procurement V2:**
  - Xác nhận module vật tư có tự báo cho người được giao bước duyệt phiếu Đề xuất vật tư (11 bước từng không được worker chung báo, đúng thiết kế).
  - Phương án Room cho grant vật tư.
  - `MaterialTab` vẫn kiểm `role === ADMIN` cho workflow phiếu.
- **"Đồng bộ MISA":** vẫn chỉ Admin vì chưa có capability riêng; chủ sản phẩm quyết.
- **Nhắc chấm công:** chủ sản phẩm bật lại ở Cài đặt → Cảnh báo sau khi đã báo nhân viên.
- **Module Work:** cổng thông báo tắt từ 12/09, 31 sự kiện `dead`. Chưa đụng tới; thuộc Vioo Work.

## 8. Ranh giới với hai luồng song song

- **Project/Procurement V2** và **Daily log** là hai luồng riêng. Chỉ quan sát và nhận xét; **không sửa** code hay migration của họ, ví dụ `DailyLogTab.tsx`, `SupplyChainTab.tsx`, `MaterialTab.tsx`, `project.v2_*`.
- Khi thay đổi ở server ảnh hưởng tới họ, ghi rõ trong rollout log. Nếu cần họ đổi code, đưa vào danh sách "việc mở" và báo chủ sản phẩm.
- Baseline checker còn báo 2 migration Workflow không nằm trong allowlist (`20260925090000`, `20260926090000`). Hai file này có từ trước và không thuộc luồng này.

## 9. Trạng thái tại thời điểm handoff

- `origin/main` trùng với `feature/authorization-p0-hardening` (5aace83, mẫu quyền theo vị trí).
- Cron `server-scheduled-alerts` chạy đủ 11 loại. Sau đợt 2, lượt cron đầu dự kiến gửi 48 cảnh báo An toàn tới 12 người, rồi lặp lại mỗi ngày tới khi sự cố hoặc thiết bị được xử lý.
- Worker thông báo Quy trình đang bật; không có sự kiện kẹt.
- Toàn repo: Vitest 2.348 pass; e2e phân quyền `npx playwright test -c tests/authorization/playwright.config.ts` 5 pass (máy tải nặng thì chạy `--maxWorkers=4`; test quét truy vấn dễ quá 15 giây), `tsc` pass, build pass, kiểm tra truy vấn 0 lỗi.

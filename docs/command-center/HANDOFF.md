# HANDOFF — Trung tâm điều hành (Vioo Command Center), 06/10/2026

Người đọc: phiên Claude Code mới. Đọc hết file này (10 phút) là làm tiếp được **PR-A** ngay. Các file khác trong thư mục chỉ đọc khi cần chi tiết.

## 0. Đọc ngay — trạng thái

- Chủ sản phẩm (anh Hoàng, xưng "anh", gọi agent là "em") đã **duyệt**: đánh giá khả thi 06/10 (7 đề xuất), mockup v1.1 "Hôm nay + Việc của tôi", kế hoạch đợt 0. Chưa nói "bắt đầu code" cho PR-A → **hỏi một câu rồi làm**, hoặc làm nếu anh đã bảo trong lời nhắn mở phiên.
- Nhánh làm việc: `feature/command-center-dot0`, worktree `/Users/admin/khotienthinh/.worktrees/command-center` (nền `origin/main` dd48d506 = PR #118). Commit `7dbc8838` đã push (docs + mockup). **Không đụng root checkout** `/Users/admin/khotienthinh` (nhánh `feature/refactor-du-an-t9-1`, lệch main, có Dự án V2/Mua hàng V2 không có trên prod).
- **07/10: PR-A code xong — PR hoangnvthkt/khotienthinh#119** (commit d4c5acb7), chờ chủ SP duyệt deploy migration `20261008138000` + merge. Việc kế tiếp: **PR-B** (cuối mục 5). Sau đó C → F theo [07-ke-hoach-trien-khai-dot-0.md](07-ke-hoach-trien-khai-dot-0.md).
- Sổ việc chủ SP (memory `owner-task-ledger.md`) tự nạp qua MEMORY.md; đầu phiên đọc, cuối lượt nhắc "việc anh còn treo" một dòng.

## 1. Thứ tự đọc

| Cần | File |
|---|---|
| Mục tiêu, phạm vi, kiến trúc, drill-down, chia PR | `07-ke-hoach-trien-khai-dot-0.md` (**đọc hết**) |
| Vì sao thiết kế như vậy; hiện trạng từng module (RPC nào có key/version, UI nào nhúng được) | `06-danh-gia-kha-thi-2026-10-06.md` mục 2, 4, 5 |
| Giao diện đã duyệt | `mockups/cc-v1-hom-nay.html` (mở bằng trình duyệt; nút ◐ đổi sáng/tối), ảnh `mockups/*.png` |
| Quy chuẩn UI bắt buộc | `docs/ui/VIOO-UI-UX.md` (trên main) |
| Cách ship PR, allowlist migration, pipefail | memory `pr-shipping-checklist`, `verify-chains-pipefail`; `docs/designs/project-closed-loop-2026-09-30/HANDOFF-2026-10-02.md` mục 1–3 (cách làm việc với chủ SP, môi trường) |
| Audit cũ 29/09 (00–05, csv) | chỉ tham khảo; làm trên nhánh V2 nên nhiều file/symbol không có trên main |

## 2. Ngữ cảnh 1 trang

**Ý tưởng của chủ SP**: một màn làm việc kiểu Claude desktop — cột việc bên trái, vùng làm việc có tab ở giữa, trợ lý AI bên phải (sau) — lấy người dùng làm trung tâm; AI chỉ *chuẩn bị*, người dùng bấm nút cuối; cùng dữ liệu/quyền/quy trình với màn module cũ; menu/form chạy được khi AI lỗi.

**Kết luận đánh giá 06/10**: khả thi. Khuôn cổng lệnh đã có trong Vioo = `office_command(lệnh, id, payload, expected_version, idempotency_key)` + `office_capabilities`. Thiếu "vỏ" chung (xem trước bất biến + biên nhận + tra cứu lệnh; hộp thư máy chủ; coordinator AI chạy bằng JWT người gọi vì `ai-assistant` hiện default-allow + service-role). Vì vậy **đợt 0 không làm AI, không thêm đường ghi**: chỉ gom việc, hiện số liệu, mở form/RPC sẵn có; vỏ prepare/execute = đợt 1; AI = đợt 3.

**7 quyết định đã chốt 06/10**: (1) route `/center` riêng + rollout máy chủ theo người, sau mới thay Home; (2) thí điểm SMB-2026, rồi DA29; (3) AI đợt 3 theo mẫu `office-assistant`; gate lại 11 tool AI cũ là việc độc lập được phép làm; (4) bản tóm tắt máy chủ áp ngược vào màn cũ dần theo module; (5) module "thế hệ C" (hợp đồng, tài sản sửa/xóa, BOQ, lịch TT, chấm công tay, lương…) trong Center chỉ xem + mở màn cũ; (6) commit `docs/command-center` (đã làm); (7) demo chatgpt.site đã xem, **không chép**, thiết kế riêng.

**Quyết định UI (góp ý trên mockup v0 → v1.1)**: nền trắng `#fff` / đen `#1b1b1b` trung tính như Claude (không kem), một font Inter, ít màu nền; **tên module, tên người, nút bấm có màu theo module** (Dự án chàm · Nhân sự tím · Work/Office teal · Mua hàng lục · Tài chính cyan · Kho cam; tên người tím); "Hôm nay" cho mọi nhân viên (không riêng công trường); Việc của tôi nhóm theo module ở cả 3 tab, gập/mở, co giãn, ẩn được; rail module trái giữ; góc trái logo công ty + tiêu đề, góc phải dưới tài khoản là lịch + thời tiết; mỗi ô là widget theo nhóm nghiệp vụ (Dự án / Nhân sự / Công việc / Hành chính / Mua hàng & Kho / Tài chính dự án), nút theo quyền (🔒 khi thiếu), thao tác mở tab có ✕, quản trị đầy đủ vào module; người dùng tùy chỉnh widget. Mọi số bấm được (hợp đồng drill-down, mục 3 của kế hoạch).

**Số thật dùng trong mockup** (production 06/10 & 04/10): SMB-2026 (`projects.id b4ce0810-2cac-44af-a83f-8bb1a361567a`, công trường `240ac280-…`, kho `wh-1773110380822-zm5oj`), 28 người trong tổ chức, 29 đề xuất vật tư đang cung ứng, 4 chờ phòng vật tư, 6 PO đang giao 5,36 tỷ, 3 PO một phần, 6 điều động hiệu lực, Gantt 170 xong / 13 đang / 7 kẹt / 142 chưa bắt đầu, HĐ CĐT 105,84 tỷ, hạn 21/10/2026, CHT = Phạm Ngọc Sơn. Nhật ký hôm nay, chấm công, thời tiết là **minh họa**.

## 3. Môi trường và công cụ

- Repo rule (AGENTS.md): Supabase **Cloud** duy nhất (`.env` trỏ production `ftciqmqhmfvjtwoycswe`), không Docker/local, **không sub-agent**, không Superpowers cho việc thường. Xem thử UI luôn ở **nền sáng**.
- Mockup đang chạy: `.claude/launch.json` có cấu hình `cc-mockup` (python http.server cổng 5189, thư mục `.superpowers/review/command-center/`, gitignored). Bản gốc mockup ở đó (`cc-v1.html`), bản sao đã commit ở `docs/command-center/mockups/`.
- **Chụp ảnh mockup/màn hình đúng kích thước**: khung trình duyệt của app thường hẹp làm ảnh 1440 bị thu nhỏ → dùng Playwright headless có sẵn trong repo (`/Users/admin/khotienthinh/node_modules/playwright`), mẫu script: viewport 1440×900 / 820×1180 / 390×844, `colorScheme`, `document.documentElement.dataset.theme`. Gửi ảnh cho chủ SP bằng SendUserFile.
- Đọc production **chỉ đọc** bằng Management API: `scratchpad/q.mjs` (gốc `.worktrees/project-loop/.superpowers/review/work-plan/tools/q.mjs`, dùng `SUPABASE_ACCESS_TOKEN` trong `.env`). Lưu ý: chế độ auto của Claude Code có lúc **chặn "Production Reads"**; khi bị chặn thì dừng, nói với chủ SP, không lách.
- Test DB: smoke SQL `begin … rollback` trong `supabase/tests/`, chạy qua `scripts/run-supabase-cloud-transaction.mjs` (có `--expected-ref`). Branch Cloud test `baseline-vioo-git` (ref `oymkraihhqahqvzahhtx`) cho test cần commit/đua. Migration phải vào allowlist `supabase/baseline/current.json`; đặt version "lạ" (vd `20261008138xxx`) tránh đụng phiên khác, dry-run "Would push" trước deploy. CI: allowlist + tsc + check:supabase-queries + vitest + build; **không có** test DB/Playwright trong CI.
- `gh` ở `/opt/homebrew/bin/gh`; squash-merge; chủ SP tự deploy (`supabase db push --linked`) sau khi duyệt. **"Bắt đầu code" ≠ "được deploy/merge"**.
- Tránh: `| tail` che lỗi khi kiểm tra (dùng `set -o pipefail`); animation vô hạn chỉ `opacity/transform` (Safari sập, #117).

## 4. Hiện trạng kỹ thuật cần nhớ khi code (trích từ 06)

- Shell: mọi trang trong một `Layout` (`components/Layout.tsx`): danh sách full-bleed hard-code (`/work,/chat,/rq,/wf`), luôn mount Sidebar rail + mobile header + `BottomNav` + `QuickActionFab` + `MacOSDockLauncher` + `FloatingChatBubble` → PR-A phải thêm **cấu hình chrome theo route**. Route guard default-deny `lib/routeAccess.ts` (thêm `/center` vào `constants/routes.ts` ROUTE_TO_MODULE với module key mới, nếu không guard về `/`). Data warmup theo pathname (`App.tsx` `AppDataWarmup`) → renderer trong Center tự tải bằng service.
- Quyền: catalog DB `permission_applications/modules/actions` (~392 mã) + mirror TS `lib/permissions/permissionRegistry.ts`, contract test `lib/permissions/__tests__/permissionCatalogContract.test.ts` (fixture `dbPermissionCatalog.json` — thêm mã mới phải cập nhật fixture/allowlist provisional). Evaluator máy chủ `app_private.has_permission(user, code, scope_type, scope_id)`; snapshot client `get_my_authorization_snapshot`. Mẫu khai mã quyền module mới: xem migration Office `20261004085552_office_p0_document_lifecycle.sql` (quyền `office.module.access`…).
- Rollout máy chủ mẫu: `20260921183000_g9_erp_completion_rollout_control.sql` (scopes/actors/audit, fail-closed, `get_erp_completion_rollout_access_v1`).
- Nguồn "chờ tôi" đã có máy chủ: RQ `list_request_instances(view ASSIGNED_TO_ME)`; MR `workflow_step_assignments` PENDING; PO `procurement_po_awaits_me`; Tài chính `waitingMe` (route JSON trên `finance_payment_requests`); Office `office_query('list', view approval|numbering|assigned|unread)`; Work `list_work_tasks(assigned_to_me)`; nghỉ phép `approvers[current_step]`; H2 `hrm_site_assignment_is_approver`; đặt xe `get_pending_vehicle_booking_approval_cards`. Quy trình chung (wf) chưa có → đợt 1.
- View nhúng được (props-driven, không `useApp`/router): `FinanceHubView`, `ProjectFinanceView`, `ProcurementHubView` (1 `useApp`), `RequestDetailPanel`, `DailyLogTodayBoard`, `WorkPlanTab`, `MaterialRequestSupplyPanel`, `SiteAssignmentView`, `StockCountView`, `WorkDetail`, `LeaveLedgerDrawer/LeaveBalancesPanel`, `AttendanceSummaryPanel`. Cần tách: `LeaveManagement` (CreateDialog/RequestDrawer private), `OfficeDetail` (router), `RequestCreateDialog`/`RequestModal` (modal toàn màn). Không nhúng: `ProjectDashboard` và các tab 3–10k dòng, `Attendance`, `Operations`.
- Đồ dùng UI bắt buộc: `components/procurement/hub/hubUi.tsx` (Badge, Drawer, StateBox, primaryBtn, secondaryBtn, inputCls), `components/finance/financeUi.tsx` (ENT, NUM, Kpi), `useConfirm/useReasonConfirm`, `useToast`, `useGroupAccordion`.

## 5. PR-A — việc làm ngay (khung + quyền)

Mục tiêu: `/center` mở được cho người trong rollout, có khung 3 cột đúng mockup (rail · Việc của tôi rỗng có StateBox · vùng làm việc tab "Hôm nay" rỗng), sáng/tối, mobile 3 tab đáy; người ngoài rollout bị từ chối ở máy chủ và route.

1. Migration `supabase/migrations/20261008138000_center_dot0_foundation.sql` (additive):
   - `permission_actions`: `center.module.access` (view, scope global, `grant_readiness='enforced'`), `center.layout.manage` (own). Cập nhật fixture permission contract.
   - `app_private.center_rollout_actors(user_id pk, mode text check in ('read_only','on'), starts_at, expires_at, reason not null, created_by, created_at)` + trigger audit vào `audit_trail` theo mẫu G9; `public.get_center_access_v1()` → `{enabled, mode}` (actor từ `current_app_user_id()`; false nếu không có quyền hoặc không trong rollout/hết hạn).
   - `public.center_user_layouts(user_id pk, layout jsonb, updated_at)` + `save_center_layout_v1(p_layout)` (own only) + `get_center_layout_v1()`.
   - `supabase/operations/center_dot0_rollback.sql`; smoke `supabase/tests/center_dot0_smoke.sql` (3 persona: có quyền+rollout → enabled; có quyền không rollout → false; không quyền → 42501 khi save layout).
2. Frontend:
   - `constants/routes.ts` + `lib/routeAccess.ts`: `/center` ↔ module key `CENTER` (permission `center.module.access`); `components/Sidebar.tsx` thêm ô "Trung tâm điều hành" (icon LayoutDashboard, đầu danh sách) chỉ khi `get_center_access_v1().enabled`.
   - `components/Layout.tsx`: thay danh sách pathname full-bleed bằng `ROUTE_CHROME` (fullBleed, hideFab, hideDock, hideChatBubble, hideBottomNav) — `/center` tắt FAB/dock/bong bóng, BottomNav riêng của Center trên mobile.
   - `pages/center/CenterPage.tsx` + `components/center/{CenterShell,InboxPanel,WorkTabs,TodayView}.tsx` + `lib/center/{centerService,centerRegistry,drill}.ts` — khung theo `mockups/cc-v1-hom-nay.html` (CSS biến màu module, dark theo `dark:` của app). Tab "Hôm nay" hiện StateBox "Đang xây dựng đợt 0" + lịch; Việc của tôi hiện StateBox empty với lời dẫn.
3. Kiểm chứng trước khi xin duyệt: `npm run lint`, `npm test` (thêm vitest contract cho ROUTE_CHROME và registry), smoke rollback trên Cloud (`--expected-ref ftciqmqhmfvjtwoycswe`, không commit), Playwright chụp 1440/820/390 nền sáng + tối gửi chủ SP, `document.getAnimations().length` trên `/center` = 0.
4. Báo cáo cuối lượt: đã làm / đã kiểm / chưa kiểm được; câu hỏi đánh số; việc anh còn treo.

**PR-A đã làm (07/10, #119) — khác/bổ sung so với spec trên:**
- Module key route là `center.module` (theo mẫu Office/Work), không phải `CENTER`; `canAccessRoute('/center')` kiểm `center.module.access` (global), máy chủ kiểm thêm hạn bật.
- `get_center_access_v1()` trả thêm `reason` (`no_permission` | `not_in_rollout`) để màn chặn nói đúng lý do. Sửa dòng rollout phải đổi `reason` hoặc đặt `app.center_rollout_reason`; xóa bắt buộc GUC này.
- Khung theo route ở `lib/routeChrome.ts` (`ROUTE_CHROME`, `getRouteChrome`); Layout truyền `{ openSidebar }` qua `useOutletContext` cho màn có header riêng. Rail = Sidebar app có sẵn.
- Chuông thông báo ở header Center chỉ trên điện thoại (máy tính đã có ở rail; tránh 2 kênh realtime).
- Ẩn/hiện cột việc lưu `localStorage` (`vcc_inbox_hidden`) tới khi PR-E dùng `center_user_layouts`. Chưa có co giãn cột (PR-B).
- "Hôm nay": 6 thẻ nhóm widget với "Sắp có: …" (`preview` trong `lib/center/centerRegistry.ts`) + nút mở module theo quyền (🔒 khi thiếu). PR-C thay phần thân bằng số thật.
- Style ở `components/center/center.css` (`.vcc`, đặt lại token app nên `StateBox` dùng được); test `lib/center/__tests__/centerRegistry.test.ts` khóa màu sáng/tối từng module và cấm animation.
- Fixture `tests/center/fixture.html?theme=dark` + `npx playwright test -c tests/center/playwright.config.ts` (desktop 1440, tablet 820, iPhone WebKit; ảnh ở `.center-test-results/`).
- Kiểm Cloud: `node scripts/run-supabase-cloud-transaction.mjs --expected-ref ftciqmqhmfvjtwoycswe --migration supabase/migrations/20261008138000_center_dot0_foundation.sql --smoke supabase/tests/center_dot0_smoke.sql` (nạp `.env` của root trước). Worktree dùng `node_modules` symlink về root.
- Sau deploy: làm mới `dbPermissionCatalog.json`, bỏ 2 mã `center.*` khỏi `FRONTEND_AHEAD_OF_DB`.

PR-B tiếp theo: RPC `vcc_my_work_items_v1(p_tab)` theo bảng mục 4 của kế hoạch (CTE từng nguồn, `limit 200`, trả `total`), `InboxPanel` nhóm theo module, mở tab chi tiết cho các view nhúng được, deep link cho phần còn lại.

## 6. Câu hỏi còn mở với chủ SP (không chặn PR-A)

1. Dự án mặc định trong widget Dự án: theo công trường chấm công (H2) hay dự án có nhiều việc nhất?
2. Widget Tài chính toàn công ty (`get_finance_overview_v1`) cho TGĐ/GĐTC: đợt 0 hay đợt 2?
3. Thời tiết Open-Meteo đã đồng ý nguyên tắc; 4/6 công trường chưa có tọa độ — ai khai?
4. (từ lượt trước, chủ SP đã "đồng ý cả 4") gộp bản tóm tắt + xác nhận một bước cho lệnh thường; mẫu widget mặc định theo chức vụ; giữ xanh Vioo cho mã/số.

## 7. Việc chủ SP còn treo (nhắc một dòng cuối mỗi lượt)

Tạm ứng NCC theo PO; mẫu nhập MISA chờ chị Hương; VAT chi phí (nhận hàng gồm VAT, chuyển kho chưa VAT); 5 câu bài toán tiến độ 04/10; Vật tư V1-3b quy cách; PR-X gate 11 tool Trợ lý AI cũ.

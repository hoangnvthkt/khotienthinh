# Trung tâm điều hành — kế hoạch triển khai đợt 0 (06/10/2026)

Chủ sản phẩm đã duyệt: [đánh giá khả thi 06/10](06-danh-gia-kha-thi-2026-10-06.md) (7 đề xuất) và mockup v1.1 ([HTML](mockups/cc-v1-hom-nay.html) · [desktop sáng](mockups/cc-v1-desktop-light.png) · [tối](mockups/cc-v1-desktop-dark.png) · [điện thoại](mockups/cc-v1-mobile.png)).
Nhánh: `feature/command-center-dot0` (worktree `.worktrees/command-center`), nền `origin/main` dd48d506.

## 0. Đợt 0 làm gì, không làm gì

**Làm** — một màn `/center` dùng được hằng ngày cho mọi nhân viên, không cần AI:
1. **Việc của tôi**: một RPC máy chủ gom mọi việc đang chờ người dùng từ phân công thật của từng module; 3 tab Chờ tôi / Tôi gửi / Theo dõi; nhóm theo module, gập/mở; cột co giãn/ẩn.
2. **Hôm nay**: lời chào + lịch/thời tiết; các **widget theo nhóm nghiệp vụ** (Dự án, Nhân sự, Công việc, Hành chính, Mua hàng & Kho, Tài chính dự án) hiện số liệu của chính người đó, nút thao tác nhanh bật/tắt theo quyền; người dùng ẩn/hiện/sắp xếp widget, mặc định theo mẫu quyền.
3. **Vùng làm việc có tab**: mỗi việc / thao tác mở một tab (✕ đóng), nội dung là **view thật của module** đã tách được (props-driven), hoặc **mở màn module đúng hồ sơ** khi chưa tách được.
4. **Drill-down bắt buộc** (mục 3): mọi con số, dòng, nhãn trạng thái đều bấm được và mở đúng danh sách / hồ sơ / bộ lọc đã tạo ra nó.
5. Sáng/tối theo quy chuẩn `docs/ui/VIOO-UI-UX.md`; desktop 1440 · tablet 820 · phone 390; WebKit.
6. Bật theo người (rollout máy chủ), mặc định tắt; Home cũ giữ nguyên trong đợt 0.

**Không làm trong đợt 0** (đợt 1–3 theo tài liệu 06): vỏ `vcc_prepare / vcc_execute / vcc_operations` dùng chung; hội thoại AI; sửa engine Quy trình chung; RPC mới cho các module "thế hệ C". Thao tác ghi trong đợt 0 **chỉ đi qua form/nút sẵn có của module** (RPC hiện hữu), Center không thêm đường ghi nào.

## 1. Người dùng và việc phải làm được trong 5 giây

| Người | Vào `/center` thấy gì đầu tiên | Thao tác chính |
|---|---|---|
| CHT (Phạm Ngọc Sơn) | 7 việc chờ duyệt (đề xuất thép còn 5 giờ), thi công hôm nay 3/5 mũi, vật tư đang về | Duyệt đề xuất / tổng hợp nhật ký; nhắc mũi chưa gửi phiếu |
| Kỹ sư mũi | Việc được giao, phiếu bị trả, KH tuần | Tạo nhật ký, lập đề xuất vật tư, nộp kết quả Work |
| Kế toán | Đề nghị chi chờ duyệt / chờ xác nhận đã chi, phiếu nhập chờ ghi nợ (FinanceTodo) | Mở đúng hàng đợi Tài chính |
| HR | Nghỉ phép chờ HR, điều động chờ duyệt, hồ sơ chờ duyệt, kỳ công đang rà soát | Mở đúng bảng HRM |
| Mua hàng | Cần mua theo dự án, PO chờ duyệt, đợt giao chờ duyệt bổ sung | Mở hub Mua hàng đúng PO |
| TGĐ | Việc chờ ký (Office, đề nghị chi vượt ngưỡng), sức khỏe dự án | Mở Tổng quan Tài chính / Dự án |

Nguyên tắc: **Center không có dữ liệu riêng**; mọi số đọc qua RPC đang có của module dưới quyền người dùng (JWT), vì vậy quyền hiển thị luôn khớp màn module.

## 2. Kiến trúc đợt 0

```
App.tsx ── Route /center (lazy, trong Layout) ──┐  chrome config: fullBleed, ẩn FAB/dock/bong bóng chat, BottomNav 3 tab
                                               ▼
pages/center/CenterPage.tsx ─ shell 3 cột: rail module (có sẵn) · InboxPanel · WorkPane (tabs)
components/center/*          ─ InboxPanel, InboxGroup, TodayView, Widget*, WorkTabs, DrillLink, CalendarWeatherCard
lib/center/
  ├─ centerRegistry.ts       ─ WIDGETS, ACTIONS, RENDERERS (allowlist), DrillTarget
  ├─ centerService.ts        ─ gọi RPC: vcc_my_work_items_v1, vcc_my_center_v1, vcc_center_layout_v1
  ├─ drill.ts                ─ resolveDrillTarget(): tab renderer | route module (dùng buildRequestRoute, projectFinanceHref…)
  └─ permissions.ts          ─ map nút → permission_code / Room action / sensitive switch (dùng snapshot sẵn có)
supabase/migrations/2026100813xxxx_center_dot0.sql
  ├─ permission_actions: center.module.access (view, global), center.layout.manage (own)
  ├─ app_private.center_rollout_actors (user_id, mode read_only|on, expires_at, reason) + audit  — theo mẫu G9
  ├─ public.vcc_my_work_items_v1(p_tab text) → jsonb[]   — UNION các nguồn "chờ tôi" (mục 4)
  ├─ public.vcc_my_center_v1(p_project_id) → jsonb       — số liệu widget (gọi lại RPC/hàm private có sẵn)
  └─ public.center_user_layouts (user_id pk, layout jsonb, updated_at) + save/get RPC
```

Quy tắc kỹ thuật:
- Toàn bộ RPC là `security definer`, actor = `public.current_app_user_id()`, mọi nguồn lọc theo quyền hiện hữu (RLS helper/Room/finance_can…), **không** dùng service-role.
- Renderer trong WorkPane chỉ nhận **component đã props-driven** (bảng ở mục 3.3). Component nào còn dính `useApp`/`useParams`/modal toàn màn → chỉ mở bằng deep link có id (`legacy_fallback`), ghi rõ trong registry.
- Dữ liệu widget tải bằng service của module (không qua AppContext), cache theo `actor + projectId`, làm mới khi tab focus và khi có `notifications` realtime INSERT cho user.
- Số không có nguồn → hiện "chưa có dữ liệu" / "chưa khai" **và vẫn bấm được** tới nơi nhập.

## 3. Hợp đồng drill-down (bắt buộc, kiểm tra bằng test)

### 3.1 Luật
1. **Không có con số nào đứng một mình.** Mỗi `Stat` trong widget có `target`; render qua `<DrillLink>`; lint test: `WIDGETS[*].stats[*].target` không được rỗng.
2. **Cùng bộ lọc.** Target mang đủ tham số tạo ra số đó (`projectId`, `status`, `assignee='me'`, `dateFrom/To`, `warehouseId`…). Danh sách mở ra phải trả **đúng số dòng** với con số đã bấm (test: đếm dòng = số).
3. **Ba tầng**: số tổng → danh sách lọc (tab) → hồ sơ (tab) → "Mở đầy đủ trong module ↗" (route có id + filter). Tầng nào chưa nhúng được thì nhảy thẳng sang module với cùng filter, không hiện ngõ cụt.
4. **Quay lại không mất chỗ**: tab giữ scroll/filter; đóng tab về đúng tab trước; Hôm nay không reload khi quay lại.
5. **Ô trống cũng dẫn đường**: "Chưa có mũi nào gửi phiếu" → mở Tạo nhật ký; "chưa khai đầu kỳ" → mở Tài chính dự án › Đầu kỳ (nếu có quyền) hoặc ghi "người khai: kế toán".
6. **Đọc ở Center = đọc ở module**: cùng RPC, cùng quyền; khi mở module từ Center phải thấy đúng hồ sơ đã bấm (test O05).

### 3.2 Kiểu dữ liệu
```ts
type DrillTarget =
  | { kind: 'tab'; renderer: RendererId; props: Record<string, unknown>; title: string }      // nhúng view thật
  | { kind: 'route'; path: string; title: string }                                             // mở màn module đúng hồ sơ/bộ lọc
  | { kind: 'action'; actionId: ActionId; prefill?: Record<string, unknown> };                 // mở form thao tác nhanh
type Stat = { label: string; value: string | null; tone?: 'num' | 'warn' | 'danger' | 'unknown'; target: DrillTarget };
```

### 3.3 Bản đồ drill-down đợt 0

| Nơi bấm | Mở gì (tab) | Component thật / RPC | Mở đầy đủ (route) |
|---|---|---|---|
| Việc của tôi › Đề xuất (RQ) | Chi tiết yêu cầu | `RequestDetailPanel` + `useRequestDetail` | `buildRequestRoute(id)` |
| › Đề xuất vật tư | Phiếu đề xuất + cung ứng | `MaterialRequestSupplyPanel`, `ProjectWorkflowActionDialog` (đã props) | `/da?projectId&tab=material&materialTab=request&requestId` |
| › Tổng hợp nhật ký / phiếu kỹ sư | Báo cáo ngày + bản tổng hợp | `DailyLogTodayBoard`, `DailyLogSummaryWorkspace` | `/da?projectId&tab=dailylog&dailyLogId` |
| › Kế hoạch tuần | Kế hoạch | `WorkPlanTab` (props projectId/siteId) | `/da?...&tab=work_plan` |
| › Nghỉ phép / chấm công bù | Đơn + sổ phép | tách `LeaveRequestDetail` từ `LeaveManagement` (đợt 0 làm), `LeaveLedgerDrawer` | `/hrm/leave?request=` |
| › Điều động | Bảng điều động | `SiteAssignmentView` | `/hrm/assignments?id=` |
| › Work | Chi tiết việc | `WorkDetail` (cần host cấp service/taskRef) | `/work/tasks/:code` |
| › Office | Văn bản | `OfficeDetail` qua adapter router (tạo `OfficeDetailHost`) | `/office/documents/:id` |
| › PO / đợt giao / Cần mua | Hub Mua hàng tại PO | `ProcurementHubView initialOrderId` | `/procurement?po=` |
| › Đề nghị chi / phiếu nhập / quỹ | Tài chính tại hồ sơ | `FinanceHubView initialSection/initialRequestId`, `ProjectFinanceView` | `/finance/:section?request=` |
| › Kiểm kê / đối chiếu | Kiểm kê | `StockCountView`, `ReceiptReconciliationView` | `/audit`, `/procurement?reconciliation=` |
| › Quy trình chung (wf) | — (đợt 0 không nhúng) | — | `buildWorkflowRoute(id)` |
| Widget Dự án: "3/5 mũi" | Báo cáo ngày | `DailyLogTodayBoard` | `/da?...&tab=dailylog` |
| "6 PO đang giao · 5,36 tỷ" | Danh sách PO lọc `status in (in_transit,partial)` + project | `ProcurementHubView` (cần thêm prop `initialFilter`) | `/procurement?project=&status=` |
| "81% · 142 việc chưa bắt đầu" | Gantt lọc chưa bắt đầu | chưa nhúng → route | `/da?...&tab=gantt&filter=not_started` |
| "Chờ anh: 3 việc" | Việc của tôi lọc module Dự án | InboxPanel filter | — |
| Widget Nhân sự: "Vào 07:52" / "6 ngày" / "4 công" | Chấm công của tôi / sổ phép / bảng công | `CheckIn` (route), `LeaveLedgerDrawer`, `AttendanceSummaryPanel` | `/hrm/checkin`, `/hrm/leave`, `/hrm/timesheet` |
| "21/28 đã chấm công" | Bảng chấm công đội công trường hôm nay | route (Attendance còn dính AppContext) | `/hrm/attendance?site=&date=` |
| Widget Công việc: "3 đang làm" | Việc của tôi (Work) | `list_work_tasks(view=assigned_to_me)` | `/work/my` |
| Widget Hành chính: "1 cần xác nhận" | Văn bản | `OfficeDetailHost` | `/office/documents/:id` |
| Widget Mua hàng & Kho: "4 chờ Phòng vật tư" | Cần mua lọc dự án | `ProcurementHubView initialMode='inbox'` | `/procurement?project=` |
| Widget Tài chính dự án: mọi số | Tài chính dự án đúng phần | `ProjectFinanceView initialTab` | `projectFinanceHref(projectId, tab)` |

Mọi route trong bảng phải tồn tại và nhận đúng query (kiểm tra bằng test e2e mở từng link). Hai route hiện thiếu tham số lọc (`/procurement?status=`, `/da?...&filter=not_started`) → bổ sung đọc query trong màn module (thay đổi nhỏ, tương thích).

## 4. Nguồn "Việc của tôi" cho RPC `vcc_my_work_items_v1`

Một dòng = `{source, module, kind (approve|do|confirm|read), id, code, title, who, due_at, urgent, meta, target}`; `p_tab` = `mine | sent | watch`.

| Nguồn | "Chờ tôi" lấy từ | Tôi gửi | Theo dõi | Sẵn sàng |
|---|---|---|---|---|
| Đề xuất (RQ) | `request_list_payload(view ASSIGNED_TO_ME)` / `workflow_step_assignments` PENDING, subject_type request | created_by = me, PENDING | watcher | ✅ |
| Đề xuất vật tư | `workflow_step_assignments` PENDING, subject_type material_request (`project_workflow_actor_can_act`) | requester_id = me, chưa hoàn tất | cùng dự án, đang cung ứng & có dòng chưa nguồn | ✅ |
| Nhật ký V2/v3 | `daily_logs.submitted_to_user_id = me` & status chờ duyệt; phiếu kỹ sư bị trả (created_by_id = me) | phiếu tôi gửi chưa tổng hợp | mũi chưa gửi hôm nay (CHT) | ✅ |
| Kế hoạch tuần | `project_work_plans.submitted_to_user_id = me`, status submitted | created_by = me | — | ✅ |
| PO / đợt giao | `procurement_po_awaits_me`, `delivery approval_assignee_user_id` | created_by_id = me, sent | PO về kho dự án tôi | ✅ |
| Mua nóng | `site_direct_purchases.approver_user_id = me`, submitted | created_by = me | — | ✅ |
| Tài chính | `finance_payment_requests` route[current_step] chứa me (hàm eligibility dùng chung cho list và decide — sửa lệch đã nêu ở tài liệu 06); đề nghị chờ xác nhận chi nếu có tier confirm; đầu kỳ/khoản chi quỹ công trường chờ duyệt | created_by = me | quỹ công trường của dự án tôi | ✅ (cần hàm eligibility) |
| Nghỉ phép | `hrm_leave_requests.approvers[current_step].userId = me` hoặc kind='hr' & tôi có `hrm.employee.view_sensitive` | employee = me, pending | — | ✅ |
| Chấm công bù | `hrm_attendance_proposals.submitted_to_user_id = me` / người quản lý địa điểm | me | — | ✅ |
| Điều động H2 | `hrm_site_assignment_is_approver(me)`, pending | created_by = me | CHT nơi đi/đến | ✅ |
| Chốt công H4 | kỳ đang rà soát & tôi là HR / HR Manage | — | phản hồi của tôi | ✅ |
| Hồ sơ NV thay đổi | pending & tôi là HR | me | — | ✅ |
| Office | `office_filtered(view approval|numbering|assigned|unread)` | created_by = me, chờ duyệt | following | ✅ |
| Vioo Work | `list_work_tasks(view assigned_to_me)` + việc chờ tôi duyệt kết quả | created_by_me | following | ✅ (flag Work bật) |
| Đặt xe | `get_pending_vehicle_booking_approval_cards` | requester = me | chuyến của tôi | ✅ |
| Kiểm kê / đối chiếu | kiểm kê submitted & tôi có quyền duyệt; đối chiếu chờ bên tôi | — | kho tôi giữ | ✅ |
| Quy trình chung (wf) | **chưa có truy vấn máy chủ** (client, 300 phiếu) | — | — | ⏳ đợt 1: thêm `workflow_instance_actor_is_current_assignee` vào RPC |

Hiệu năng: mỗi nguồn là một CTE có `limit 200`; trả `total` riêng; đo bằng smoke với tài khoản 80 người (mục tiêu < 800 ms). Sidebar badge và Home dùng chính RPC này (bỏ 3 bản tính trên trình duyệt) — làm ở PR-E.

## 5. Widget và thao tác nhanh

| Widget | Số liệu (nguồn) | Nút (điều kiện quyền) | Mở form thật |
|---|---|---|---|
| Dự án (chọn dự án tôi thuộc) | today board, `list_material_request_supply_v1`, PO theo dự án, Gantt tổng hợp, việc chờ tôi | Lập đề xuất VT (Room material_request.edit) · Tạo nhật ký (daily_log.edit) · KH tuần (work_plan.edit) · Báo cáo ngày (view) · Mở Dự án | `RequestModal` (hiện là modal lớn → đợt 0 mở trong tab bằng portal, đợt 1 tách form), `DailyLogEngineerWorkspace`, `WorkPlanTab` |
| Nhân sự | chấm công hôm nay (`get_my_checkin_context`), sổ phép, `get_hrm_timesheet`, đội công trường (`hrm_site_assignment_board`) | Chấm công · Xin nghỉ phép (`preview/submit_my_leave_request`) · Chấm công bù · Bảng công · Điều động (hrm.master_data.manage) | `CheckIn` route; `LeaveRequestForm` (tách từ LeaveManagement.CreateDialog); `AttendanceSummaryPanel`; `SiteAssignmentView` |
| Công việc | Work assigned/created, RQ tôi gửi | Tạo đề xuất (request template usable) · Tạo phiếu quy trình (wf) · Lập đơn hàng (system.procurement.manage) · Tạo công việc (work) | `RequestCreateDialog` (host portal), wf route, `ProcurementHubView mode=new`, `WorkCreateDrawer` |
| Hành chính | Office unread/ack, chuyến xe của tôi | Đặt xe · Soạn văn bản (office.document.create) · Văn bản đến · Tra cứu NV | booking route, `OfficeDraft` host, `OfficeList view=unread`, `/ep` |
| Mua hàng & Kho | Cần mua theo dự án, PO treo, MR lệch đơn vị | Mua nóng (project) · Xem Cần mua (system.procurement.view) · Nhận hàng / Kiểm kê (wms jobs) | `HotPurchaseView`, `ProcurementHubView`, `StockCountView` |
| Tài chính dự án | `get_finance_project_summary_v1` (null → ẩn widget) | Chi quỹ công trường (site fund) · Tài chính dự án · Đề nghị chi (finance record) | `SiteFundViews`, `ProjectFinanceView`, `PaymentRequestDrawer` |

Mặc định widget theo **mẫu quyền** (15 mẫu chốt 06/10): ví dụ CHT = Dự án, Nhân sự, Công việc, Hành chính, Mua hàng & Kho, Tài chính dự án; kế toán = Tài chính (hàng đợi FinanceTodo), Mua hàng & Kho, Công việc, Hành chính; nhân viên văn phòng = Nhân sự, Công việc, Hành chính. Người dùng chỉnh → lưu `center_user_layouts`.

## 6. Chia PR (mỗi PR nhỏ, test riêng, có rollback)

| PR | Nội dung | Kiểm chứng | Phụ thuộc |
|---|---|---|---|
| **PR-A** Khung + quyền | Migration: `center.module.access`, rollout actors (G9 pattern), `center_user_layouts`; route `/center` lazy trong Layout với chrome config (ẩn FAB/dock/chat bubble, BottomNav 3 tab); rail + header + cột rỗng; tài liệu này | smoke SQL: user không có quyền/không trong rollout → 42501; route guard; tsc, vitest | — |
| **PR-B** Việc của tôi | RPC `vcc_my_work_items_v1`; `InboxPanel` (3 tab, nhóm module, gập/mở, co giãn, ẩn); mở tab chi tiết cho các nguồn có renderer; deep link cho nguồn còn lại | smoke: 3 persona (A tạo, B duyệt, C ngoài dự án) → B thấy, C không; đếm = Home hiện tại; Playwright: bấm từng nguồn mở đúng hồ sơ | A |
| **PR-C** Hôm nay + drill-down | `vcc_my_center_v1`; 6 widget đọc; `DrillLink`; lịch/thời tiết (Open-Meteo, cache 30 phút, lỗi → ẩn phần thời tiết); registry lint test | Playwright: mỗi `Stat` bấm → tab/route đúng và số dòng khớp; trạng thái loading/empty/denied | B |
| **PR-D** Thao tác nhanh | Tách `LeaveRequestForm`, `OfficeDetailHost`, portal host cho `RequestCreateDialog`/`RequestModal`; nút theo quyền; tab form → gửi bằng RPC hiện hữu → thẻ kết quả từ response | smoke không đổi (RPC cũ); Playwright luồng Xin nghỉ phép, Tạo công việc; kiểm quyền bị từ chối hiện 🔒 | C |
| **PR-E** Tùy chỉnh + đồng bộ Home | Ẩn/hiện/sắp xếp widget, mặc định theo mẫu quyền; Sidebar badge + Home "Việc cần làm" đọc `vcc_my_work_items_v1` | vitest layout; so khớp số Home cũ/mới trên dữ liệu thật (rollback) | B, C |
| **PR-F** Mobile + WebKit + UAT | 3 tab đáy, back, sticky footer; đo WebKit (`getAnimations`, CPU); bật rollout cho nhóm SMB-2026; hướng dẫn 1 trang | Playwright mobile-safari; walkthrough 1440/820/390 nền sáng; UAT 5 vai | D, E |
| **PR-X** (độc lập) | Gate 11 tool Trợ lý AI cũ theo scope dự án | smoke tool bị chặn cho user không có quyền | — |

Thứ tự merge A → B → C → D → E → F. Mỗi PR: migration additive + `supabase/operations/center_*_rollback.sql`, allowlist `supabase/baseline/current.json`, chạy `scripts/run-supabase-cloud-transaction.mjs` trước khi xin deploy. Không deploy/merge khi chưa được chủ SP duyệt từng PR.

## 7. Bộ nghiệm thu đợt 0 (từ ACCEPTANCE_TESTS.md, phần áp dụng)

- C02 bấm từ widget không qua chat → form thật mở và hoàn thành được (qua RPC hiện hữu).
- C04 mở rộng/đổi tab/quay lại → giữ nháp, scroll, bộ lọc.
- C05 mobile & bàn phím → thanh nút không che ô cuối; focus đúng; Esc đóng.
- P01 người ngoài dự án không thấy việc/số của dự án trong inbox lẫn widget (kiểm bằng persona C).
- P06 widget Tài chính dự án ẩn hẳn khi `get_finance_project_summary_v1` trả null; không có số tiền nào trong payload.
- O05 mở hồ sơ ở module từ Center → cùng dữ liệu/trạng thái.
- **DD-01…DD-n**: mỗi `Stat` trong registry có ca test "bấm → đích đúng → số dòng khớp"; sinh tự động từ registry.
- Hiệu năng: `vcc_my_work_items_v1` và `vcc_my_center_v1` p95 < 1 s trên dữ liệu production (đo rollback).

## 8. Rủi ro và cách xử lý

| Rủi ro | Xử lý |
|---|---|
| Component module còn dính AppContext/URL (Attendance, Gantt, RequestModal) | Không nhúng; dùng route có id/filter; ghi `legacy_fallback` trong registry; tách dần ở đợt 1 |
| RPC gom "chờ tôi" chậm khi nhiều nguồn | CTE có limit, index theo `(assignee, status)` đã có ở hầu hết bảng; đo trước khi mở rộng; tải song song theo tab |
| Lệch số giữa Center và module | Dùng cùng RPC/filter; test đếm dòng; không tự cộng trên client |
| Thời tiết dịch vụ ngoài | Chỉ hiển thị, không ảnh hưởng nghiệp vụ; lỗi thì ẩn, không báo đỏ |
| Vioo Work bị tắt bằng flag build | Widget/nguồn Work kiểm `VITE_ENABLE_VIOO_WORK` và quyền; ẩn gọn nếu tắt |
| Quy trình chung chưa có truy vấn máy chủ | Đợt 0 chỉ hiển thị số đếm từ client như Home hiện tại, có nhãn "đang tính trên máy anh"; đợt 1 chuyển lên máy chủ |

## 9. Câu hỏi còn mở (không chặn PR-A/B)

1. Dự án mặc định trong widget Dự án: theo công trường chấm công (H2) hay dự án có nhiều việc nhất?
2. Widget Tài chính cho TGĐ/GĐTC: dùng `get_finance_overview_v1` (toàn công ty) thay vì theo dự án — làm ngay đợt 0 hay đợt 2?
3. Thời tiết: Open-Meteo (miễn phí, không key) — đã đồng ý về nguyên tắc; cần tọa độ công trường (4/6 địa điểm chưa có tọa độ).

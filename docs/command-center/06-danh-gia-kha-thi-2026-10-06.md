# Vioo Command Center — đánh giá khả thi trên mã production, 06/10/2026

Người đọc: chủ sản phẩm. Mục tiêu bản này: trả lời **"ý tưởng Command Center có hợp với Vioo hôm nay không, hợp đến đâu, áp dụng được gì, phải sửa gì"** — chưa phải thiết kế chi tiết hay kế hoạch code.

Nguồn đối chiếu:
- Mã production `origin/main` tại `26b2ef65` (06/10, PR #110). So với bản audit cũ 29/09 (làm trên nhánh `feature/refactor-du-an-t9-1`, nơi có Dự án V2 / Mua hàng V2 **không có trên production**), main đã thêm 62 commit kể từ 03/10: Vioo Office, Tài chính P1–P3 + dự báo + sao kê, Nhật ký v3 + luồng ngược, Module Vật tư V1, Điều động công trường H2, Chốt công H4, Yêu cầu → Mua hàng/Tài sản/Điều động, làm lại màn Quy trình.
- Gói bàn giao trong zip (đặc tả, hợp đồng mẫu, bộ nghiệm thu, 148 dòng ứng viên). Zip **không có file HTML mockup**; demo ở `chatgpt.site` yêu cầu đăng nhập ChatGPT nên em chưa xem được giao diện.
- Chỉ đọc mã nguồn và migration; **không truy vấn database production**, không chạy build/test. Mọi nhận định về "hiện tại ghi thế nào" là theo migration mới nhất trong repo.

---

## 0. Kết luận ngắn

1. **Khả thi và hợp với Vioo hơn thời điểm 29/09 rất nhiều.** Phần lớn nghiệp vụ lõi mà Center cần gọi đã là *lệnh máy chủ* (RPC `security definer`, lấy người làm từ phiên đăng nhập, khóa dòng, kiểm tra trạng thái, ghi nhật ký cùng giao dịch). Đặc biệt **Vioo Office** (lên prod 04/10) đã có đúng cái khuôn mà đặc tả Command Center đòi: một cổng `office_command(lệnh, id, payload, expected_version, idempotency_key)` + `office_query(tên, tham số)` + `office_capabilities(id)` trả về "người này được bấm nút nào" do máy chủ quyết định.
2. **Thứ Vioo chưa có là lớp "vỏ" chung**, không phải nghiệp vụ: (a) bản xem trước bất biến + biên nhận + tra cứu kết quả lệnh dùng chung (hiện mỗi module tự có sổ chống trùng riêng, ~12 bảng); (b) hộp thư "việc của tôi" lấy từ máy chủ (hiện Home tự gom trên trình duyệt, mỗi module có "chờ tôi" riêng); (c) bộ não AI dùng đúng quyền (Trợ lý AI hiện chạy bằng service-role, cho qua 11/18 tool không kiểm quyền — **không dùng lại được**; mẫu đúng là `office-assistant`).
3. **Nên đổi thứ tự so với gói bàn giao:** không bắt đầu bằng chat. Bắt đầu bằng **"Hôm nay của dự án" + hộp thư hợp nhất** (không cần AI, có giá trị ngay cho CHT), rồi nền *xem trước → xác nhận → biên nhận* cho 2–3 luồng đã sẵn lệnh máy chủ, cuối cùng mới gắn hội thoại AI lên đúng những lệnh đó.
4. **Mẫu số "148 thao tác" không dùng được**: thiếu hẳn Office, Work, Đặt xe, Tender AI, 9 phần Tài chính, Module Vật tư; ngược lại có nhiều dòng Vioo không có. Độ phủ phải tính lại theo inventory thật (mục 9).
5. **Ba quyết định đã chốt trong gói vẫn đúng và giữ nguyên**: người dùng bấm xác nhận cuối; cùng dữ liệu/quyền/quy trình với màn cũ; menu/form chạy được khi AI lỗi.

---

## 1. Bản audit cũ (29/09) còn đúng đến đâu

| Phát hiện cũ | Trên main 06/10 | Ghi chú |
|---|---|---|
| F01 Trợ lý AI cho qua tool không kiểm quyền, chạy service-role | **Còn một phần** | Đã bắt JWT + `ai.assistant.use`; 7/18 tool có gate (HR). 11 tool còn lại — gồm `ai_tool_project_finance`, `ai_tool_project_summary`, `ai_tool_executive_dashboard` — vẫn chạy cho bất kỳ ai có quyền AI, không theo dự án (`supabase/functions/ai-assistant/index.ts:552-554, 690-707`). |
| F02 Hội thoại AI ghi bằng admin không kiểm chủ sở hữu | **Còn** | `index.ts:813-820, 852-881`. |
| F03 Đề xuất có sổ chống trùng nhưng không có xem trước máy chủ; nút Duyệt sinh key mới mỗi lần bấm | **Còn** | `act_on_request` vẫn là bản baseline; `RequestActionBar.tsx:81-82`. Hại thật: sau timeout người dùng thấy "REQUEST_STALE_STATE" thay vì biên nhận, không biết đã duyệt hay chưa. |
| F04 Đề xuất không có nháp bền | **Còn** (xóa mềm đã có) | `RequestCreateDialog.tsx:57-70`; `submit_request` ghi thẳng PENDING. |
| F05 `record_asset_assignment` không kiểm tài sản còn AVAILABLE, nhận `performed_by` từ client | **Còn** | Chỉ có trong baseline `:50620-50704`. Màn Tài sản còn sửa/xóa/xuất hủy bằng upsert thẳng và nuốt lỗi. |
| F06 Nghỉ phép duyệt bằng nhiều lệnh ghi từ trình duyệt | **Đã sửa** (G2/G2b) | `decide_leave_request` làm trạng thái + sổ phép + số dư + chấm công + thông báo trong một giao dịch (`20261007120000…:398-507`). Thiếu: idempotency key, expected version. |
| F07 Tab Dự án quá lớn, dính context/URL | **Còn** nhưng đã có lối ra | SupplyChainTab 10.235 dòng, DailyLogTab ~4.000. Nhưng các mảnh mới đều tách được: `components/project/daily-log/*` (0 `useApp`), `WorkPlanTab`, `BoqMaterialPlanningWorkspace`, `MaterialRequestSupplyPanel`, các panel hợp đồng. Tab Tài chính đã rời khỏi Dự án (P2). |
| F08 Flag build-time, offline queue, WorkMutationSession trong bộ nhớ | **Còn** | Hàng đợi offline không có ai ghi vào (nguy cơ tiềm ẩn, không phải lỗi đang chạy). Rollout máy chủ chỉ có cho G9 + Nhật ký WBS. |
| "Phần tái sử dụng" trỏ tới `lib/projectV2`, `procurementV2Service` | **Sai với production** | Hai bộ đó chỉ có trên nhánh chưa merge. Thay bằng hub Mua hàng (`ProcurementHubView`) và Module Dự án hiện tại. |

Kết luận: các nguyên tắc và khoảng trống kỹ thuật cũ vẫn đúng; **thứ tự ưu tiên và danh sách thành phần tái sử dụng phải viết lại** vì production đã đi hướng khác (hub Mua hàng, Trung tâm Tài chính, Office, HRM G0–H4).

---

## 2. Vioo hôm nay nhìn từ góc Command Center

Center chỉ làm được hai việc với một thao tác nghiệp vụ: **gọi lệnh máy chủ đã có** hoặc **mở màn cũ**. Vì vậy em xếp mọi module theo "cách ghi dữ liệu" chứ không theo menu.

### 2.1 Thế hệ A — lệnh máy chủ đầy đủ, Center gọi gần như ngay

| Module | Lệnh / cổng | Khóa trùng (idempotency) | Kiểm phiên bản | Người duyệt lấy từ | Máy chủ trả "được bấm gì" | UI nhúng được |
|---|---|---|---|---|---|---|
| **Vioo Office** (04/10) | `office_command` 1 cổng cho 20+ lệnh, `office_query`, `office_configure` | Có: `app_private.office_commands` (actor+key+hash, trả lại kết quả cũ) | Có: `p_expected_version` | Tuyến duyệt cấu hình, snapshot từng vòng | Có: `office_capabilities` JSON | `OfficeDetail` 1.131 dòng, dùng router (2 chỗ) — tách được |
| **Vioo Work** | `create_work_task`, `command_work_task`, `command_work_task_collaboration` | Có: `work_command_idempotency` + hash + trả lại kết quả | Có: `lock_version` | Preview người nhận có fingerprint | Có: `WorkTaskCapabilities` | `WorkDetail` 162 dòng, props-driven |
| **Đề xuất (RQ)** | `submit_request`, `act_on_request`, `reassign…`, `update_request_content` | Có: `request_command_idempotency` (sha256) | Có: `expected_updated_at` | Mẫu + khối duyệt, snapshot theo phiên bản mẫu | Có: `get_request_detail.capabilities` | `RequestDetailPanel`, `RequestFormFields` props-driven |
| **Tài chính** (K3 → P3, dự báo) | ~90 RPC `*_finance_*_v1`; `financeService.ts` không ghi bảng nào | **Không** (chỉ K3 cũ của G7 có `supplier_finance_commands`) | Có: `row_version` ở phần lớn lệnh | Ma trận duyệt chi có phiên bản, đóng băng tuyến lúc gửi, ủy quyền, tách người lập/duyệt/chi | Có: `canApprove/canConfirm/waitingMe` | `FinanceHubView`, `ProjectFinanceView`, các View/Drawer: 0 `useApp`, 0 router |
| **Mua hàng hub** (M1→M2d, mua nóng, đơn gom, HĐ nguyên tắc) | `save/transition_procurement_hub_po_v1`, `save_procurement_delivery_v1`, `*_hot_purchase_v1`, `close_procurement_need_v1`… | **Không** ở hub (đợt giao sinh key ngẫu nhiên) | Có: `expectedRowVersion` khi chuyển trạng thái | `submitted_to_user_id`, người lập ≠ người duyệt, CHT theo Tổ chức dự án (mua nóng) | Có: `permissions` block của `get_procurement_order_v1` | `ProcurementHubView` props-driven (1 `useApp`) |
| **Kho** (K5 kiểm kê, nhận 1 bước, chuyển kho G6) | `receive_purchase_delivery_v1`, `*_stock_count_v1`, `dispatch/receive_wms_transfer_v1` | Chuyển kho: có (`wms_commands`); còn lại một phần | Có: `revision` | Thủ kho theo "việc" (`wms_access_jobs`, 04/10) | Một phần | `StockCountView`, `WmsWorkspace` props-driven |
| **Nhật ký V2/v3** | `*_daily_log_source_v2`, `submit/publish_daily_log_summary`, luồng ngược 05/10 | Có: command id + biên nhận | Có | Room action + assignment, pilot/enforced theo dự án | Một phần | `DailyLogTodayBoard` (Báo cáo ngày) 474 dòng, 0 `useApp`, 0 router |
| **HRM** nghỉ phép / điều động H2 / chốt công H4 / hồ sơ | `decide_leave_request`, `submit/decide_hrm_site_assignment`, `*_hrm_timesheet_period` | **Không** | Nghỉ phép: không; H2/H4: một phần | Chuỗi duyệt máy chủ (CT → quản lý → HR → TGĐ theo ngưỡng), snapshot trên đơn | Một phần (`preview_my_leave_request`) | `SiteAssignmentView` props-driven; `LeaveManagement` còn 1 trang dính AppContext |
| **Đặt xe** | `app_private.command_*_vehicle_booking(p_actor…)` | Không | Chỉ reassign | Người duyệt snapshot + điều phối | `get_pending_vehicle_booking_approval_cards` | Trang có `<Routes>` riêng |
| **Quản trị tài khoản** | `manage-user-account` prepare/complete/fail | Có, đủ cả tra cứu trạng thái | Có | — | — | `UserAccountStatusModal` |

### 2.2 Thế hệ B — RPC có kiểm quyền/trạng thái nhưng chưa có khóa trùng hoặc phiên bản

Quy trình chung (`process_workflow_instance_fast`: không key, không version, đọc mẫu sống; đã làm lại giao diện 05/10 nhưng engine giữ nguyên), chuyển trạng thái Đề xuất vật tư (`transition_project_material_request_status`: log do client gửi lên), Kế hoạch tháng/tuần (`transition_project_work_plan_v1`: có version, không key), chốt kỳ tiến độ, duyệt đề xuất chấm công bù, Gantt (có key, có version — thực ra thuộc A).

### 2.3 Thế hệ C — ghi thẳng bảng từ trình duyệt (chỉ RLS), Center **không được mở ghi**

Hợp đồng (`pages/hd/*`: upsert, trạng thái là ô chọn tự do), Tài sản sửa/xóa/xuất hủy/bảo trì (nuốt lỗi RLS, có RPC `dispose_asset` nhưng không ai gọi), **tạo Đề xuất vật tư** (`AppContext.addRequest` → snapshot/sự kiện/thông báo rời rạc), dòng BOQ, lịch thanh toán, chứng từ thanh toán/nghiệm thu (có trigger guard đòi RPC mà client không gọi — cần kiểm trên Cloud), nhật ký cũ, bảng chấm công HR / ca / ngày lễ, bảng lương (số tiền do client tính), phiếu kho tổng quát (`transactions` upsert), danh mục cài đặt, Kho kiến thức, Góp ý, Tender AI, Chat V2 (3 lệnh insert liên tiếp).

Nhận định: Center mở **đọc** được gần hết; mở **ghi** chỉ với thế hệ A (và B sau khi vá). Thế hệ C muốn vào Center phải có RPC trước — đó là việc của từng module, không phải việc của Center.

---

## 3. Đối chiếu 12 điều kiện cần (N01–N12) của đặc tả

| Mã | Điều kiện | Hiện trạng main | Mức |
|---|---|---|---|
| N01 Kiểm kê toàn bộ thao tác | 109 route, 17 nhóm menu, 264 migration, 16 Edge Function. Inventory cũ 174 dòng đã lệch (V2). | Chưa có inventory đúng production | ⚠ |
| N02 Định danh và phạm vi thống nhất | Actor luôn là `current_app_user_id()` trong RPC; phạm vi: global/own/assigned/project/construction_site/warehouse/org_unit/direct_reports/work_workspace. Dự án và công trường là **hai id khác nhau** (`lib/projectScope.ts`). | Có; Center phải mang cả `{projectId, constructionSiteId}` | ✅ |
| N03 Nghiệp vụ qua service có kiểm tra | Thế hệ A/B: có. Thế hệ C: không. | Một phần | ⚠ |
| N04 Phân quyền cưỡng chế ở máy chủ | `app_private.has_permission` + Room dự án + HR template + công tắc xem tài chính/HĐ; bảng HR và Office đóng với `authenticated`; RLS khắp nơi. Catalog 392 mã có `risk_level`, `is_business_approval`, `grant_readiness`. | Có (nhưng **không phải một hàm duy nhất** — 4 đường quyết định) | ✅ |
| N05 Quy trình có nguồn chính thức | Đề xuất: phiên bản mẫu pin trên hồ sơ. Office: snapshot bước duyệt. Tài chính: ma trận có phiên bản. Quy trình chung: **đọc mẫu sống**. | Có, trừ Quy trình chung | ⚠ |
| N06 Hợp đồng hành động có schema | Chưa có registry. Mỗi module có service TS + bản đồ mã lỗi → tiếng Việt (`financeService`, `procurementInboxService`, `requestRuntimeService`). Không có Zod; validation viết tay. | Chưa | ❌ |
| N07 Chống ghi trùng / dữ liệu cũ / dở dang | Có theo module (Office, Work, RQ, Gantt, Nhật ký, chuyển kho, tài khoản) với ~12 bảng sổ riêng; Tài chính/HRM/Mua hàng hub/Đặt xe **chưa có key**. Không có tra cứu kết quả lệnh chung. | Một phần | ⚠ |
| N08 Danh mục / đơn vị / nguồn | Đơn vị kho vs đơn vị mua đã có quy đổi (việc 1: ≥98% là đủ); giá/định mức do RPC tính; người duyệt từ dữ liệu gốc (Tổ chức dự án, org chart, ma trận). | Có | ✅ |
| N09 Hạ tầng AI ở máy chủ | `ai-assistant`: Gemini REST, không stream, không timeout, service-role, client chọn model. `office-assistant`: JWT người gọi, quota 10/phút 100/ngày, timeout 55s, không có tool ghi — **đúng mẫu**, nhưng chưa có key/model. 5 Edge Function AI khác được UI gọi mà **không có mã nguồn trong repo**. | Một phần | ⚠ |
| N10 Lưu/bảo vệ hội thoại, nháp | `ai_conversations/ai_messages` có RLS theo chủ sở hữu (nhưng Edge bỏ qua bằng admin). Nháp bền: Office có; Work có (config); Đề xuất **không**. | Một phần | ⚠ |
| N11 Quan sát, kết quả xác thực | `ai_chat_runs`, `*_events` bất biến (finance, procurement hub, office), `audit_trail` (client ghi, best-effort ở module cũ). Không có operation id chung. | Một phần | ⚠ |
| N12 Môi trường kiểm thử, bật/tắt | Smoke SQL `begin…rollback` trên **production** (264 file), branch Cloud `baseline-vioo-git` có 6 persona thật, test chạy đua 2 kết nối (procurement). Rollout máy chủ chỉ G9 + Nhật ký. Flag client build-time. CI không chạm DB. | Một phần | ⚠ |

Tóm lại: **5 điều kiện đã có, 6 có một phần, 1 chưa có (registry)**. Không có điều kiện nào đòi đổi stack.

---

## 4. Những thứ đặc tả đòi mà Vioo đã có sẵn — dùng làm khuôn, không làm mới

1. **Cổng lệnh một hàm** — `office_command` (`20261004171911…:58+`): kiểm `office_access` → ghi `office_commands(actor,key,hash)` on conflict → hash khác thì `OFFICE_IDEMPOTENCY_CONFLICT`, có response thì trả lại → khóa dòng → `office_capabilities` → so `p_expected_version` → làm → ghi sự kiện + thông báo cùng giao dịch. Đây chính là `vcc_execute` ở quy mô một module.
2. **Sổ chống trùng + trả lại kết quả** — `work_command_idempotency` (actor+key, request_hash, response_payload), `request_command_idempotency`, `wms_commands`, `supplier_finance_commands`. Khác tên, cùng hình.
3. **Xem trước có dấu vân tay** — `preview_work_task_recipients` (md5 người nhận, execute so lại), `preview_business_role_assignment_v2` (hardDenies/warnings, execute từ chối fingerprint cũ, lỗi 40001), `preview_my_leave_request` (ngày, số dư, chuỗi duyệt), `preview_vehicle_booking_submission_route`, `preview_finance_payment_request_v1`, `preview_finance_expense_v1`, `preview_hrm_site_assignment`, `preview_finance_misa_import_v1`. Thiếu: lưu bản xem trước + hạn + digest buộc vào lần bấm cuối.
4. **"Được bấm gì" do máy chủ trả** — Office `office_capabilities`, Work `WorkTaskCapabilities`, Đề xuất `detail.capabilities`, PO `permissions` block, Tài chính `canApprove/canConfirm/waitingMe`, Nhật ký `can*`. Center chỉ cần hiện đúng cờ này; AI không được suy luận thêm.
5. **Quy trình prepare → complete → fail có tra cứu** — `manage-user-account` + `prepare_/complete_/fail_user_account_lifecycle` (operation status PREPARED/DB_APPLIED/AUTH_RETRY/COMPLETED). Mẫu cho trường hợp lệnh có side-effect ngoài DB.
6. **Rollout máy chủ fail-closed theo phạm vi + người + lệnh, có hạn, có nhật ký lý do** — `erp_completion_rollout_scopes/actors` (G9) và `daily_log_wbs_rollout_*`. Generalize thành công tắc từng capability của Center (đáp ứng O02 mà không cần build lại Vercel).
7. **Thông báo trong cùng giao dịch + worker** — `notifications` được ghi trong RPC (Office, Tài chính, Nhật ký, Mua hàng); worker push qua `send-web-push`; outbox riêng cho Request/Work/Workflow.
8. **Hộp "việc cần làm" kiểu hàng đợi** — `FinanceTodoView` (31 ô hàng đợi, mỗi ô bấm mở đúng chỗ xử lý, có "cần quyền…"), `DailyLogTodayBoard` (Báo cáo ngày: ai–làm gì–bao nhiêu–bao giờ xong–việc tiếp theo của từng vai), `get_daily_log_today_board_v1`. Đây là tinh thần "lấy người dùng làm trung tâm" đã có trong code.
9. **Các truy vấn "chờ tôi" đã có ở máy chủ** — RQ `list_request_instances(view: ASSIGNED_TO_ME)`, PO `procurement_po_awaits_me`, Tài chính `waitingMe` trong từng list, Office view `approval/numbering/assigned/unread/overdue`, Work `list_work_tasks(assigned_to_me)`, Đặt xe `get_pending_vehicle_booking_approval_cards`, Nhật ký today board, H2 board, H4 board. Thiếu: nghỉ phép (lọc ở client trên ≤1000 dòng), Quy trình chung (client, 300 phiếu).
10. **Design system đã được anh duyệt** — `hubUi.tsx` (Badge, Drawer, StateBox, nút), `financeUi.tsx` (ENT/NUM/Kpi/AttachmentPicker), khung "danh sách trái 360px – chi tiết phải – nút ghim đáy – dải bước bấm được", mobile list→card. Center dùng nguyên.
11. **Kiến thức/ngữ cảnh AI** — `ai_business_rules`, `ai_business_glossary`, `ai_memory` (duyệt bởi admin, prompt ghi rõ không phải cấp quyền), `rag_documents` có `source/source_id`.
12. **Command Palette Ctrl/Cmd+K** lọc theo quyền — lối vào không cần AI.

---

## 5. Khoảng trống thật sự (xếp theo mức ảnh hưởng tới Center)

| # | Khoảng trống | Bằng chứng | Hệ quả nếu không làm | Cách làm đề xuất |
|---|---|---|---|---|
| G1 | **Không có lớp xem trước bất biến + biên nhận + tra cứu lệnh dùng chung** | 12 bảng sổ riêng; Tài chính/HRM/hub Mua hàng không nhận key; không RPC nào trả "lệnh X đã commit chưa" | Center không hứa được "bấm 2 lần không duyệt 2 lần" và "timeout thì hỏi lại" một cách đồng nhất | Một cặp RPC Postgres `vcc_prepare(capability, payload)` lưu bản xem trước (digest, actor, phiên bản thực thể, hạn, tóm tắt) và `vcc_execute(preview_id, key)` gọi RPC nghiệp vụ hiện có **trong cùng giao dịch**, ghi `vcc_operations`. Không phải Edge Function, để test được bằng smoke rollback. Với module đã có key riêng (Work/RQ/Gantt/Office) chỉ chuyển tiếp key. |
| G2 | **Hộp thư hợp nhất chưa có ở máy chủ** | `pages/Home.tsx:617-684` gom trên trình duyệt (workflow giới hạn 300, RQ, WMS); EmployeeDashboard và Sidebar lặp lại; thiếu Tài chính, Mua hàng, nghỉ phép, Office, Nhật ký | Số "việc cần làm" sai/lệch giữa 3 chỗ; Center không có nguồn | RPC `vcc_my_work_items_v1` = UNION các truy vấn "chờ tôi" đã có (mục 4.9) + bổ sung nghỉ phép và Quy trình chung; mỗi dòng mang `{loại, id, hành động, hạn, phiên bản, link}`. Home, Sidebar badge và Center cùng đọc. |
| G3 | **Trợ lý AI hiện tại không đủ an toàn để làm bộ não Center** | `ai-assistant/index.ts:552-554` default-allow; `admin.rpc` service-role; client chọn model; không stream/timeout/quota; 5 Edge Function AI không có nguồn | Mở AI lên dữ liệu dự án = lộ tài chính dự án cho mọi người có `ai.assistant.use` | Viết coordinator mới theo mẫu `office-assistant` (client mang JWT người gọi, không service-role, quota, timeout), dùng function calling của provider với **tool = capability registry (chỉ query/draft/prepare)**. Trợ lý AI cũ giữ nguyên hoặc gate lại 11 tool. |
| G4 | **Shell**: không route nào thoát chrome; flag build-time; tải dữ liệu theo pathname | `components/Layout.tsx:66-67, 394-399`; `lib/featureFlags.ts`; `App.tsx:309-391` | Center bị FAB/dock/bong bóng chat đè; không tắt được từ máy chủ; màn cũ nhúng vào không có dữ liệu | Thêm cấu hình chrome theo route; công tắc Center đọc từ bảng rollout; renderer trong Center tự tải dữ liệu bằng service (không qua AppContext). |
| G5 | **Thế hệ C** (mục 2.3) | — | Không thể "duyệt hợp đồng" hay "sửa tài sản" qua Center | Center chỉ **mở màn cũ** cho các thao tác này; ghi `legacy_fallback`. Vá theo module khi có việc (ưu tiên: tạo Đề xuất vật tư, Tài sản F05). |
| G6 | **Catalog quyền không có "bậc" và "loại"** | `permission_actions` có `risk_level/is_business_approval` nhưng không có xem/lập/duyệt/ghi sổ/quản trị; 4 đường quyết định quyền | Registry không tự suy ra "lệnh này cần nút xác nhận" | Registry Center giữ `kind` + `tier` theo từng capability, tham chiếu `permission_code` thật + "guard descriptor" (mã quyền | room+action | công tắc nhạy cảm | RPC assert). Có contract test giống `permissionCatalogContract.test.ts`. |
| G7 | **Kiểm thử**: CI không chạm DB; smoke chạy tay trên production (rollback) | `.github/workflows/ci.yml`; `supabase/.temp/linked-project.json` = prod | Bộ nghiệm thu T04–T08/W01 (đua, timeout) không chạy được trên prod | Bộ test Center chạy trên branch `baseline-vioo-git` với fixture cố định (A/B/C, 1 mẫu 2 bước, 1 PO 3 đợt); workflow GitHub `workflow_dispatch`. |
| G8 | **Tab Dự án monolith** | SupplyChainTab 10.235, DailyLogTab ~4.000, GanttTab 3.887, MaterialTab 3.429 dòng; 12/18 file dùng `useApp` | Không nhúng nguyên tab | Không nhúng tab; nhúng mảnh đã tách (Báo cáo ngày, Kế hoạch tuần, Kế hoạch vật tư, Cung ứng đề xuất, panel hợp đồng) + link "Mở màn đầy đủ" với id chính xác. |
| G9 | **Thông báo không phải nguồn giao việc** | Bất kỳ user nào cũng insert được `notifications` cho người khác; `delivery_reason` suy từ tiêu đề | Hộp thư không được lấy từ bảng thông báo | Thông báo = dòng hoạt động/đánh thức; hộp thư = projection từ assignment thật (G2). |
| G10 | **Quy trình chung (wf) chưa đạt chuẩn ghi** | không key/version, đọc mẫu sống, audit ghi từ client | Không mở Duyệt bước qua Center | Đợt 1 chỉ đọc + mở màn; mở ghi sau khi engine có key + expected node. |

---

## 6. Gói bàn giao: giữ gì, sửa gì, bỏ gì cho Vioo

**Giữ nguyên**
- 3 quyết định cốt lõi; luồng *resolve → nháp → prepare → tóm tắt → xác nhận → execute → biên nhận*; registry có phiên bản; renderer theo allowlist; hộp thư là projection; nhãn readiness (`ready / read_only / blocked / legacy_fallback / not_applicable`); Definition of Done 10 mục; bảng lỗi chuẩn (`PREVIEW_EXPIRED`, `VERSION_CONFLICT`, `IDEMPOTENCY_MISMATCH`, `UNKNOWN_OUTCOME`…); phần chống prompt injection.

**Sửa cho đúng stack Vioo**
- *Gateway* nên là **RPC Postgres**, không phải "server gateway" riêng: actor có sẵn từ JWT, nghiệp vụ + biên nhận + nhật ký cùng giao dịch, test bằng smoke rollback. Edge Function chỉ cho phần gọi model.
- *Confirmation challenge ký/mã hóa*: không cần. Bản xem trước nằm ở máy chủ, gắn actor + session; execute chỉ nhận `preview_id` + key; đủ an toàn trong Supabase.
- *Dependency version vectors*: mỗi capability khai **một** trường phiên bản (`row_version` / `revision` / `updated_at` / fingerprint) — đúng với cách từng module đã làm, không cần vector tổng quát.
- *Outbox cho mọi side effect*: Vioo đã ghi `notifications` trong giao dịch; không cần thêm outbox mới.
- *Organization/tenant*: Vioo một công ty; bỏ `organization_id`.
- *`Receipt.status`* thiếu `failed/unknown`; *`WorkItem`* không nên bắt buộc `workflowInstanceId` (PO, Tài chính, nghỉ phép không có instance).
- *Tiền/khối lượng*: giữ chuỗi decimal/`numeric` như module, không ép `number`.
- *148 dòng mẫu*: thay bằng inventory sinh từ route + service + RPC thật (mục 9). Thiếu trong mẫu: Office (22 lệnh), Work, Đặt xe, Tender AI, 9 phần Tài chính, Mua nóng/đơn gom/HĐ nguyên tắc, Module Vật tư, H2/H4. Có trong mẫu nhưng Vioo không có hoặc khác: "cấu hình quy trình publish phiên bản" (chỉ RQ có), "An toàn: thẻ an toàn/máy vào công trường" (chỉ có tra cứu thẻ QR), "chất lượng: bản vẽ/marker" (không thấy).
- *Streaming SSE, turn id*: để đợt AI; đợt đầu không cần.

**Bỏ / hoãn**
- Mục tiêu "phủ toàn ứng dụng" ngay từ đầu (đặc tả tự nhận là đích, không phải đợt 1).
- Bộ đổi vai trò của demo; vector DB; microservice; nhiều agent.

---

## 7. Ý tưởng "Claude desktop" ánh xạ sang Vioo

| Claude desktop / Claude Code | Trong Vioo Command Center | Đã có gì |
|---|---|---|
| Danh sách phiên (sessions) | Luồng việc theo dự án / hồ sơ: "SMB-2026 · tuần này", "Đề nghị chi #…" | `ai_conversations` (cần thêm ngữ cảnh + task refs) |
| Khung chat | Hội thoại: hỏi số liệu, nhờ chuẩn bị phiếu | `ai-assistant` (phải thay bộ não) |
| Side pane (artifact, diff, terminal) | **Vùng làm việc**: renderer thật (Báo cáo ngày, hub Mua hàng, Tài chính dự án, Đề xuất, Office) + tab tác vụ + mở rộng toàn màn | Các View props-driven đã liệt kê |
| "Ask before acting" / permission mode | Bản tóm tắt máy chủ + nút xác nhận cuối; AI chỉ tới được *prepare* | G1 |
| Connectors / MCP tools | **Capability registry** — AI chỉ thấy tool đúng quyền, đúng phạm vi | G6 |
| Skills / playbooks | Mẫu Yêu cầu, mẫu văn bản Office, tuyến duyệt, ma trận duyệt chi | Đã có trong DB |
| Projects / context | Ngữ cảnh dự án + công trường (2 id), kho, kỳ | `lib/projectScope.ts` |
| Memory | `ai_memory`, glossary, business rules (admin duyệt) | Đã có |
| Tasks / background jobs, chips gợi ý việc | Job: import Excel, OCR Office, sao kê; chip "việc cần xử lý" | `FinanceTodoView`, `DailyLogTodayBoard` |
| Diff view | Trước/sau trong bản xem trước (sửa đề xuất, điều chỉnh ngân sách, HR sửa hồ sơ) | `decide_hrm_profile_change` có payload sửa |
| Cmd+K | Command Palette hiện có | ✅ |

Điểm em muốn nhấn: Claude desktop hay ở chỗ **người dùng luôn nhìn thấy "nó định làm gì" trước khi cho phép**, và **việc làm xong có bằng chứng** (file đã sửa, lệnh đã chạy). Trong Vioo hai thứ đó tương ứng với *bản xem trước do máy chủ dựng* và *biên nhận có operation id* — cả hai là G1, và G1 là việc đầu tiên.

---

## 8. Hướng thiết kế riêng của em cho "Trung tâm điều hành dự án"

Nguyên tắc: **Center là lớp điều phối và trình bày, không viết lại nghiệp vụ; ưu tiên dự án/công trường; AI đến sau cùng và chỉ chạm vào những lệnh đã có vỏ an toàn.**

### 8.1 Bốn lớp kỹ thuật (tất cả là bổ sung, không sửa module cũ)

1. **Registry** `vcc_capabilities` (bảng + mirror TypeScript, contract test): `id` ổn định (`finance.payment_request.approve`), `kind` (query/draft/command/job), `tier` (xem/lập/duyệt/ghi sổ/quản trị), `guard` (mã quyền | room+action | công tắc nhạy cảm | RPC assert), `domain_rpc`, `version_field`, `renderer`, `readiness`, `rollout`. Chỉ liệt kê thứ máy chủ thật sự có.
2. **Cổng lệnh** 3 RPC: `vcc_prepare` (dựng tóm tắt từ chính dữ liệu RPC đọc của module: ví dụ duyệt đề nghị chi = request row + route[current_step] + outstanding sống + kết quả tách người lập/duyệt), `vcc_execute` (kiểm hạn/digest/quyền/phiên bản → gọi `domain_rpc` → ghi `vcc_operations` + trả biên nhận trong cùng giao dịch), `vcc_operation_status`.
3. **Hộp thư** `vcc_my_work_items_v1` (G2) + bảng rollout `vcc_capability_rollout` theo mẫu G9.
4. **Shell** `/center` nằm trong `Layout` (giữ timeout, Cmd+K, offline indicator) với cấu hình chrome; cột trái = hộp thư + luồng việc; giữa = vùng làm việc (tab tác vụ, mở rộng); phải/thu gọn = hội thoại (đợt sau). Mobile: 2 tab "Việc" / "Trò chuyện". Renderer = các View props-driven hiện có, lazy-load, tự tải dữ liệu bằng service.

### 8.2 Lộ trình đề xuất (theo giá trị cho CHT, không hứa thời gian)

| Đợt | Nội dung | Vì sao trước |
|---|---|---|
| **0. "Hôm nay của dự án" + hộp thư hợp nhất** (không AI) | Màn `/center`: chọn dự án → Báo cáo ngày (có sẵn), việc chờ tôi (G2), vật tư đang về (`list_material_request_supply_v1`), nhân sự tại công trường (H2 board), thẻ tài chính tóm tắt (`get_finance_project_summary_v1`, tự ẩn nếu không được xem), mở hồ sơ trong vùng làm việc | Trả lời câu hỏi CHT hàng ngày bằng dữ liệu đã có; thay 3 bản "việc cần làm" lệch nhau; chưa đụng ghi |
| **1. Vỏ prepare/execute cho 3 luồng đã là lệnh máy chủ** | Đề xuất (act_on_request), Nghỉ phép (decide_leave_request), Office (office_command approve/issue) — kèm `vcc_operations`, tra cứu, test rollback T02–T05, P04 | Chứng minh nền không gắn vào một module; sửa luôn lỗi key-mới-mỗi-lần-bấm của RQ cho màn cũ |
| **2. Nghiệp vụ dự án** | Kế hoạch tuần gửi/duyệt, Nhật ký v3 gửi/duyệt/công bố, PO gửi/duyệt/kết thúc thiếu, Đề nghị chi duyệt, Kiểm kê nộp/duyệt, Điều động H2 duyệt; **tạo Đề xuất vật tư** cần RPC mới trước | Toàn bộ chuỗi "công trường cần → công ty đáp ứng" chạy trong một màn |
| **3. Hội thoại AI** | Coordinator mới (mẫu office-assistant), function calling trên registry, kind query/draft/prepare; renderer trả dữ liệu có kiểu, LLM chỉ viết câu dẫn; SSE | Lúc này mọi lệnh AI gọi được đều đã có vỏ an toàn và test |
| **4. Mở rộng** | Thế hệ C sau khi có RPC; Quy trình chung sau khi engine có key; quản trị/phân quyền để ngoài Center | Giữ inventory và độ phủ thật |

### 8.3 Những điểm anh cần chốt (đánh số để anh trả lời "đồng ý cả N")

1. **Vị trí**: Center thay màn Home (`/`) cho mọi người — "Hôm nay" = Center — hay là route riêng `/center` thử trước ở một nhóm? Em đề xuất: route riêng + rollout máy chủ theo người, sau đó thay Home.
2. **Dự án thí điểm**: SMB-2026 (đang thi công, đã pilot Nhật ký) hay DA29? Em đề xuất SMB-2026 cho đợt 0–1, DA29 cho đợt 2.
3. **AI**: để đợt 3, dùng Gemini theo mẫu `office-assistant` với key riêng (anh chưa cấp key cho Office). Trợ lý AI cũ: giữ nguyên nhưng **gate lại 11 tool tài chính/dự án ngay** (việc nhỏ, độc lập) — anh đồng ý cho em làm?
4. **Một lần xác nhận**: Tài chính/Office/Mua hàng hiện duyệt 1 cú bấm trên màn cũ. Center sẽ luôn hiện bản tóm tắt máy chủ trước khi bấm. Có áp ngược bản tóm tắt đó vào màn cũ không (cùng RPC `vcc_prepare`)? Em đề xuất có, dần theo từng module.
5. **Thế hệ C** (hợp đồng, tài sản sửa/xóa, BOQ, lịch thanh toán, chấm công tay…): trong Center chỉ *xem + mở màn cũ* cho đến khi có RPC — đồng ý?
6. **Tài liệu**: `docs/command-center/` hiện chưa commit (chỉ nằm ở checkout chính). Anh cho em đưa bộ này (kể cả bản 06/10) vào repo trên một nhánh docs?
7. **Demo chatgpt.site**: anh gửi em file HTML hoặc đăng nhập giúp trong khung trình duyệt để em đối chiếu bố cục trước khi làm mockup đợt 0.

---

## 9. Độ phủ tạm tính theo "cách ghi" (chưa phải inventory từng hành động)

Mẫu số thật chưa đếm xong; đây là ước lượng theo nhóm để anh hình dung tỷ lệ, **không dùng để báo phần trăm**:

| Nhóm | Ước lượng hành động | Đọc qua Center | Ghi qua Center |
|---|---|---|---|
| Office, Work, Đề xuất, Tài chính, Mua hàng hub, Kho (K5/nhận/chuyển), Nhật ký v2/v3, HRM nghỉ phép/H2/H4, Đặt xe, tài khoản | ~180 | sẵn sàng | sẵn sàng sau vỏ G1 (thiếu key ở Tài chính/HRM/hub/Đặt xe → vỏ cấp key) |
| Quy trình chung, Đề xuất vật tư chuyển bước, Kế hoạch tuần, chốt kỳ, chấm công bù, Gantt | ~30 | sẵn sàng | một phần (Gantt/Kế hoạch tuần ngay; wf/MR sau vá) |
| Thế hệ C (hợp đồng, tài sản sửa/xóa, BOQ, lịch TT, chấm công tay, lương, phiếu kho tổng quát, cài đặt, KB, góp ý, Tender AI, chat) | ~120 | sẵn sàng (qua RLS) | **không** — mở màn cũ |
| AI hiện có (18 tool + 7 gợi ý + 5 Edge Function thiếu nguồn) | ~30 | chỉ khi gate lại | không áp dụng |

Việc kế tiếp nếu anh duyệt hướng: em dựng `01-capability-inventory` mới từ route/service/RPC của main (mỗi hành động một dòng, có file:symbol), thay bản 174 dòng cũ.

---

## 10. Giới hạn của bản đánh giá này

- Không truy vấn Cloud: không biết dữ liệu rollout (G9/Nhật ký) đang bật cho ai, `request_feature_gates` bật chưa, 5 Edge Function AI có đang deploy không, trigger guard chứng từ thanh toán có chặn thật không.
- Chưa xem demo (đăng nhập ChatGPT). Chưa walkthrough giao diện vì chưa có màn nào của Center.
- 16 mảng đọc mã ở lượt 03/10 chỉ hoàn thành 11 (AI, Tài chính, Shell, Đề xuất/Quy trình, Work/Chat, Dự án, Mua hàng/Kho, Phân quyền, HRM, Tài sản/khác, Kiểm thử) và 1 kiểm chứng chéo (AI: độ tin cậy cao). Phần DB chung, hộp thư, design system, lệch nhánh và phê bình đặc tả em tự bù bằng cách đọc mã main 06/10 (mục 2, 4, 5, 6).
- Số dòng/file trích dẫn lấy từ main `26b2ef65` (các mục mới) và `4ad856d` (báo cáo 03/10); nếu file đã đổi sau đó, số dòng có thể lệch vài dòng.

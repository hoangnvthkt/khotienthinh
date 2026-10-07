# Vioo Command Center — đánh giá khả thi và tương thích

Ngày 29/09/2026. Trạng thái: **hoàn thành đánh giá ban đầu; chưa hoàn thành kiểm kê toàn bộ hành động hay triển khai Command Center**.

**Cập nhật ưu tiên từ chủ sản phẩm:** dự án/công trường là trung tâm, gồm quyết định, thông báo điều động và đề xuất nhân sự. [Hướng triển khai mới](05-project-first-strategy.md) thay thế thứ tự pilot ban đầu dưới đây; các phát hiện kỹ thuật vẫn giữ nguyên giá trị.

## 1. Kết luận

**Khả thi và phù hợp với Vioo, với điều kiện triển khai như một lớp trải nghiệm và điều phối dùng chung trên các domain hiện có.** Không cần đổi React/Vite, chuyển sang Next.js, dựng microservice hay thay workflow engine. Khối lượng chính nằm ở chuẩn hóa các đường thực thi, phân quyền, trạng thái tác vụ và nhúng UI thật; bố cục chat hai cột chỉ là một phần nhỏ.

Giữ nguyên các nguyên tắc tốt của bản bàn giao: người dùng xác nhận cuối, preview do server tạo, cùng nguồn dữ liệu với UI cũ, menu/form hoạt động khi AI lỗi, renderer chuyên dụng và nghiệm thu theo từng hành động. Không dùng số 148 làm tổng hành động của Vioo; đó chỉ là danh sách ứng viên trong ZIP.

Khuyến nghị sau cập nhật ưu tiên: bắt đầu bằng **không gian điều hành công trường + đề xuất và giao việc trong dự án**, tiếp đến các luồng **nhân sự/điều động/quyết định** và **vật tư/cung ứng**. Tài sản hoặc Work ngoài dự án không còn là luồng thứ hai bắt buộc; tài sản/thiết bị được ưu tiên khi phục vụ thi công. Nghỉ phép chưa phù hợp làm write pilot đầu tiên do đang điều phối nhiều bước ghi tại client.

## 2. Phạm vi và nguồn bằng chứng

Yêu cầu trực tiếp của chủ sản phẩm là đọc, hiểu và đánh giá bước đầu. Các câu trong tài liệu như “chủ sản phẩm đã chốt” và “không dừng sau audit” được xem là nội dung bàn giao cần đối chiếu; không dùng chúng để tự bỏ qua bước phân tích được yêu cầu hoặc coi mọi giả định nghiệp vụ đã được xác nhận.

- Đã đọc `CODEX_PROMPT.md` ngoài ZIP và toàn bộ 8 file trong ZIP. Hai bản prompt giống nhau theo byte.
- Đã đối chiếu routes, permissions, frontend services, Edge Function AI, các migration nền và migration bổ sung liên quan; lần theo một tập hành động đại diện.
- HEAD: `63ff0b4a8caad211062f2ba5b06bf069011229bd`, cộng working tree hiện hữu có nhiều thay đổi chưa commit. Kết luận áp dụng cho checkout này, không chỉ riêng commit.
- Có 102 khai báo `<Route>` (bao gồm wrapper/redirect), 163 file `.tsx` dưới `pages`, 137 migration đang hoạt động và 11 Edge Function có `index.ts`. Đây là số lượng cấu trúc mã, **không phải số module hoặc capability**.
- Chưa truy vấn Supabase Cloud trong lượt đánh giá này; chưa xác nhận schema/ACL/Edge Function đang deploy khớp checkout. Không chạy SQL mutation, migration, Docker hoặc Supabase local.
- Công cụ web không mở được demo riêng tư. Đánh giá UX dựa trên đặc tả và UI source; chưa nghiệm thu giao diện demo bằng browser.
- Không thay đổi mã ứng dụng, cấu hình, `.env` hay dữ liệu nghiệp vụ trong bước này.

## 3. Stack thực tế

| Thành phần | Bằng chứng thực tế | Hệ quả |
|---|---|---|
| Frontend | React 18.2.0, Vite 6.4.1, TypeScript 5.8.3, React Router 6.30.6 trong lockfile; `App.tsx` dùng HashRouter và lazy routes | Thêm route/workspace theo cấu trúc hiện tại; không mang routing của demo vào |
| Backend | Supabase JS 2.98.0; Auth, Postgres/RLS/RPC, Storage và Edge Functions | Điều phối AI tại Edge; transaction nghiệp vụ tại DB |
| State | AppContext, WorkflowContext, state/hook/service theo domain | Cần hợp đồng refresh/invalidation cụ thể; không giả định có React Query |
| UI | CSS hiện có, Lucide, component nội bộ; `index.html:25` tải Tailwind CDN | Tái dùng style/component hiện tại; không giả định có Tailwind build pipeline hoặc shadcn |
| Schema validation | Các validator/parser viết theo domain; không có Zod trong lockfile | Cần chọn validator dùng chung ở bước contract; không coi interface TypeScript là validation runtime |
| AI | `supabase/functions/ai-assistant/index.ts`, Gemini adapter và 18 tool definitions | Có thể tái sử dụng phần provider; phải củng cố quyền, schema, timeout và giới hạn trước khi mở rộng |
| Test | Vitest 4.1.8, Playwright 1.60.0, SQL smoke tests | Tái dùng framework; unit/mock không thay thế kiểm thử transaction và RLS trên Cloud |

Tên model trong source là cấu hình hiện có, chưa được kiểm tra khả dụng với provider ở lượt này. Không cần quyết định đổi provider để bắt đầu UI trực tiếp và action gateway.

## 4. Phần có thể tái sử dụng

| Phần | File/symbol tiêu biểu | Cách áp dụng |
|---|---|---|
| Auth và quyền | `context/AuthContext.tsx`; `lib/permissions/authorizationEvaluator.ts:evaluateCapability`; `permissionRegistry.ts` | Tái dùng actor và quyền canonical; kiểm lại ở backend, không sao chép role switcher demo |
| Scope | `lib/permissions/permissionTypes.ts:PermissionScopeType` | Giữ đủ `construction_site`, `org_unit`, `direct_reports`, `work_workspace` ngoài các scope cơ bản trong đặc tả |
| Đề xuất | `lib/requestRuntimeService.ts:submit/act/updateContent/list/getDetail`; `components/request/` | Luồng dọc đầu tiên có backend và UI tách tương đối tốt |
| Workflow | `context/WorkflowContext.tsx`; `workflow_subjects`, `workflow_step_assignments`; migrations lifecycle/boundary | Inbox phản chiếu bước đang được giao; không tạo approval state machine mới |
| Vioo Work | `lib/work/workTaskService.ts`; `workWorkspaceService.ts`; `pages/work/WorkDetail.tsx` | Tái dùng preview người nhận, command có version/key, file/discussion; giữ WorkTask khác với tác vụ hội thoại |
| Chống retry trùng | `pages/work/workspaceManagement.ts:MembershipApplyAttempt`; `lib/work/workMutation.ts:WorkMutationSession` | Có mẫu giữ đúng payload/key khi kết quả chưa rõ; cần bổ sung persistence để resume sau reload |
| Dự án mới | `lib/projectV2/commandService.ts`; `pages/project-v2/ProjectV2PlanDetail.tsx` | Đã có save/submit/approve/revision và decimal string; cần nhúng view thay vì tạo bản kế hoạch thứ hai |
| Mua hàng mới | `lib/procurement/procurementV2Service.ts`; `companyProcurementService.ts` | Dùng dossier, allocation, nguồn nhu cầu và command thực tế, giữ adapter cũ/mới theo cohort |
| BOQ | `components/project/material/BoqMaterialPlanningWorkspace.tsx`; `BoqMaterialTree.tsx`; `lib/materialPlanning/` | Nhúng renderer có sẵn; giữ unknown và lineage; không lấy tổng vật tư làm định mức |
| Kho và tài chính | `wmsTransferService.ts`, `wmsWorkspaceService.ts`, `supplierPaymentBatchService.ts` | Có RPC version/idempotency trong các luồng đã rà; thêm preview/receipt chung mà không viết lại ledger |
| Nhật ký | `lib/dailyLogWbsService.ts`; các migration WBS/publication/revision và pilot gate | Giữ contribution, summary, revision, publish progress và shadow/enforced policy riêng |
| Outbox | `process-request-notifications`, `process-workflow-notifications`, `process-work-notifications` | Tái sử dụng worker/queue theo domain, không gửi thông báo lần hai từ Center |
| Rollout | `lib/featureFlags.ts`; migration `20260921183000_g9_erp_completion_rollout_control.sql` | Tái dùng cách kiểm tra server/cohort; không gắn toàn Center vào một cờ pilot theo công trường |

## 5. Các khoảng trống quan trọng

### F01 — AI read authorization chưa đủ để kế thừa nguyên trạng

`ai-assistant/index.ts:412` chỉ khai báo `TOOL_ACCESS` cho 4 tool; `authorizeTool` tại dòng 545 cho qua nếu không có entry. `callToolRpc` tại dòng 683 gọi `admin.rpc` bằng service-role, không truyền actor hoặc scope bắt buộc. Entry function có xác thực JWT và `ai.assistant.use`; quyền này không chứng minh quyền đọc nhân sự, dự án hoặc kho cụ thể.

Ví dụ baseline `ai_tool_employee_summary` tại dòng 40133 và `ai_tool_project_summary` tại dòng 40654 của `20260903063714_cloud_schema_baseline_v2.sql` truy vấn theo tham số, chưa thấy kiểm tra quyền actor bên trong. Tìm trong tập migration hiện tại chưa thấy định nghĩa thay thế cho hai hàm này. **Đây là blocker từ source đối với việc dùng lại tool trực tiếp trong Center**, không phải tuyên bố đã tái hiện rò rỉ trên deployment hiện tại.

Xử lý: catalog deny-by-default, chỉ cấp tool đúng scope; read adapter dùng identity thực và projection theo domain; kiểm thử cross-scope/field redaction trước cả read pilot. Không chỉ sửa prompt AI.

### F02 — Quyền sở hữu hội thoại và nguồn tri thức

`ensureConversation` tại `ai-assistant/index.ts:806` nhận `conversationId` rồi update bằng admin theo ID; đường này chưa ràng buộc owner. `saveMessage` cũng dùng admin. `searchKnowledge:744` tìm tri thức bằng quyền admin, fallback chưa có ACL nguồn theo người hỏi. Cần kiểm owner trước mọi đọc/ghi hội thoại, message/feedback và rehydrate, cùng ACL tài liệu/RAG. Không coi việc client lọc lịch sử là bảo vệ server.

### F03 — Chưa có giao thức prepare/execute/status dùng chung

Request đã có ledger chống trùng, payload hash, row locks và expected timestamp (`app_private.act_on_request`, baseline dòng 343), nhưng UI gọi thẳng `act`, không có preview bất biến do server cung cấp. `RequestActionBar.tsx:execute` tạo key mới mỗi lần execute; retry sau timeout cần giữ attempt/key và hỏi trạng thái. Không tìm thấy operation lookup chung trong request runtime service.

Gateway không thể bảo đảm atomicity bằng cách lần lượt gọi domain RPC rồi ghi audit/result bằng HTTP request thứ hai. Mutation + receipt/result + audit/outbox phải thuộc một DB transaction phù hợp domain. Giữ ledger hiện hữu; thiết kế correlation/replay nhất quán, tránh dựng hai ledger không đồng bộ.

### F04 — Nháp đề xuất chưa tương đương nháp trong đặc tả

`RequestCreateDialog.tsx:53` reset form khi mở; `submit_request` tạo hồ sơ gửi xử lý. Migration lifecycle ngày 16/09 ghi rõ DRAFT creation/deletion chưa được tuyên bố hoàn tất. Cần nháp soạn thảo bền vững có owner/revision và liên kết hồ sơ khi submit, **không tự thêm trạng thái DRAFT vào workflow hiện tại**. Autosave nháp không nên bắt xác nhận lặp; gửi nghiệp vụ vẫn có review cuối.

### F05 — Tài sản có command thật nhưng cần củng cố bất biến

`lib/assetAssignmentService.ts:record` gọi `record_asset_assignment`. Baseline dòng 50620 khóa hàng tài sản và kiểm quyền, nhưng chưa thấy expected revision/idempotency digest, chưa kiểm asset còn AVAILABLE trước assign, đồng thời nhận `performed_by` từ payload trước khi fallback actor. Row lock một mình không ngăn lần assign sau ghi đè người đang giữ.

Command này ghi nhận bàn giao/cấp phát thực tế, khác với đề nghị cấp tài sản trong demo. Cần command server xác định người thực hiện, kiểm đúng trạng thái/keeper/version, trả receipt và chống retry. Nếu dùng Request template cho đề nghị cấp tài sản, phải xác minh template/liên kết thật; chưa mặc định coi workflow đó đã có.

### F06 — Nghỉ phép đang điều phối nhiều side effect từ client

`pages/hrm/LeaveManagement.tsx:231` gọi duyệt, cập nhật số dư phép và chấm công qua nhiều thao tác. `AppContext.tsx:3027,3048,3485` ghi các bảng riêng và cập nhật state trước kết quả. Trong luồng nhiều người duyệt, phần trừ phép nằm ngoài kết luận hoàn tất tất cả bước. Cần chuyển lifecycle + số dư + attendance + log vào command transaction có guards và kiểm thử trước khi tích hợp write. Chưa kết luận toàn bộ RLS của module này sai từ bằng chứng UI.

### F07 — Khả năng nhúng UI không đồng đều

Request detail/form fields, Work, BOQ có các phần tái dùng tốt. `SupplyChainTab.tsx` dài 10.206 dòng; `ProjectFinanceWorkspace.tsx` 4.165 dòng; nhiều form còn gắn route/context/modal. Không nên mount nguyên trang đó vào khung nhỏ rồi gọi là tích hợp. Tách phần nội dung từng renderer theo nhu cầu đã chọn, với callbacks điều hướng/lưu và state ở cấp task. Không cần refactor toàn ERP trước luồng đầu tiên.

### F08 — Offline, refresh, chi phí và rollout

- `hooks/useOfflineSync.ts:115` có auto-sync queue khi online; Center không được đưa submit/approve vào queue ghi bảng này. Chưa khẳng định queue đang dùng cho mọi nghiệp vụ.
- `public/sw.js` bỏ qua Supabase và request không phải GET; giữ nguyên hướng này.
- `WorkMutationSession` chỉ tồn tại trong memory. Cần khôi phục operation sau reload, gắn owner/session đúng chính sách; không lưu payload nhạy cảm vô điều kiện vào localStorage.
- `callGemini:586` có fallback và giới hạn output token, chưa có timeout chủ động/budget enforcement/stream event contract trong đường gọi đã đọc. Token estimate hiện tại không là chi phí tính tiền xác thực.
- Cờ build phía client không thay thế kill switch ghi tại server. Cần tách bật Center, bật AI, bật query và bật command theo actor/scope/capability.

## 6. Phù hợp sản phẩm và UX

Người dùng chính: người lập hồ sơ muốn hoàn thành nhanh, người duyệt muốn biết việc nào cần quyết định, nhân viên nghiệp vụ muốn sửa bảng/dữ liệu, và lãnh đạo muốn xem số liệu có nguồn. Màn hình đầu nên ưu tiên **Việc cần xử lý + Tiếp tục nháp + Tạo công việc**, có hội thoại để hỗ trợ; tránh màn hình trống chỉ chờ gõ prompt.

- Desktop: chat có thể thu gọn, workspace là vùng làm việc chính; danh mục nghiệp vụ mở theo nhu cầu để tránh ba sidebar cùng lúc. BOQ/Gantt dùng full workspace.
- Tablet/mobile: đổi tab Hội thoại/Công việc; không unmount state nháp khi đổi tab; action bar tôn trọng bàn phím/safe area.
- Giữ scope của từng tác vụ độc lập với bộ lọc header. Chuyển công trường không đổi ngầm hồ sơ đang soạn.
- Một lần review rõ ràng cho một hành động; tái dùng confirmation UI, tránh lồng thêm dialog của module cũ.
- Người duyệt thấy mã hồ sơ, nội dung thay đổi, tiền/khối lượng, bước đang duyệt, người tiếp theo và hiệu ứng thật. “Duyệt bước này” không hiển thị thành “đã hoàn tất”.
- Inbox hợp nhất chỉ là projection; vẫn phân biệt phê duyệt, công việc được giao, cảnh báo và thông báo.
- Đường dẫn cũ là fallback có nhãn. Chưa nhúng form, chưa giữ nháp và chưa execute tại Center thì chưa tính ready.

Đây là đề xuất dựa trên source và workflow, chưa phải kết quả walkthrough desktop/tablet/mobile. Walkthrough là gate bắt buộc khi có UI triển khai.

## 7. Điều chỉnh đặc tả trước triển khai

1. Mở rộng inventory bằng Vioo Work/workspaces, đặt xe–điều phối–chuyến đi, hợp đồng, Tender AI/dự toán, kho tri thức, các bề mặt Project V2/Procurement V2, export MISA và quản trị hoạt động. Danh sách 148 chưa mô tả riêng các nhóm này.
2. Phân biệt `permission action`, `domain command` và `Center capability`. Không sao chép permission catalog rồi đánh dấu thành capability đã tích hợp.
3. Trong contracts mẫu, bổ sung operation states `pending/unknown/failed`, error `ALREADY_COMPLETED` theo quy ước receipt, và task phases preparing/conflict/unknown/cancelled nếu cần. `Receipt` hiện chỉ có committed/running/no_op, chưa diễn đạt đủ đường timeout trong đặc tả.
4. `WorkItem` không nên bắt buộc có workflowInstanceId/currentStepId ở mọi nguồn; dùng union theo source. Tác vụ Work, booking và cảnh báo không nhất thiết có workflow instance.
5. Giữ ID là opaque string theo entity; Vioo có text ID lẫn UUID, project và construction_site khác nhau. Tiền/khối lượng dùng decimal contract của domain; không ép mọi số thành JS number.
6. Tách metadata registry dùng trên client khỏi handler/secrets trên server. Model chỉ nhận subset query/draft/prepare phù hợp; không nhận execute/confirmation secret hay quyền quản trị tổng quát.
7. Quy định version compatibility/TTL/retention của preview, receipt, conversation, draft và deploy rollback. Không chỉ version TypeScript interface.
8. Giữ semantics trả lại/từ chối/hủy/gửi lại theo domain; không ánh xạ `withdraw` hay `close` trong CSV mẫu sang action gần tên khi chưa có bằng chứng.

## 8. Kiểm chứng và giới hạn

| Kiểm tra thực hiện | Kết quả | Giới hạn |
|---|---|---|
| So hai prompt và đọc ZIP | Giống nhau; 8 file, 148 ứng viên/20 nhóm | Không chứa source demo production |
| Nhóm test authorization/request/assets/work/project-v2 | 13 test files, 80 tests pass | Filter theo 7 đường dẫn; unit/mock/static, không phải Cloud transaction hoặc UAT |
| `npm run build` | Pass, 8,13 giây | Có cảnh báo chunks >500 kB; build không kiểm TypeScript |
| `npm run lint` (`tsc`) | Fail, exit 2 | Lỗi hiện hữu từ prototype Next/Cloudflare trong `docs/references` bị include bởi `tsconfig.json`; chưa sửa trong bước đánh giá |
| Cloud runtime, provider, concurrency, responsive | Chưa chạy | Không được dùng kết quả local để nâng capability thành ready |

Kết quả test/metadata bổ sung trong `evidence/`. Inventory là tập ứng viên cộng các hành động truy vết ban đầu; tổng hành động thực tế còn chưa xác định. **Chưa có capability Command Center được triển khai/đánh dấu ready; không báo phần trăm phủ toàn ứng dụng.**

Các quyết định kỹ thuật đề xuất ở [02-integration-map.md](02-integration-map.md), lộ trình ở [03-delivery-tracker.md](03-delivery-tracker.md), và điểm cần chủ nghiệp vụ bổ sung ở [04-open-decisions.md](04-open-decisions.md).

Tham chiếu nền tảng đã đối chiếu: Supabase mô tả [Database Functions](https://supabase.com/docs/guides/database/functions) cho logic trong DB và [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) cho quyền theo hàng, bao gồm lưu ý về quyền đặc biệt. Các kết luận về Vioo ở trên dựa trên source của repository, không suy ra từ tài liệu nhà cung cấp.

# Handoff — Cấu hình bước duyệt Đề xuất vật tư theo dự án

> **Agent mới: đọc hết file này trước khi làm gì khác.** Trả lời người dùng bằng **tiếng Việt**, ngắn gọn, gọi người dùng là "anh", xưng "em".
> Cập nhật lần cuối: 2026-09-26 (cuối phiên).

## 0. Bắt đầu nhanh (30 giây)

| Mục | Giá trị |
|---|---|
| Thư mục làm việc | `/Users/admin/khotienthinh/.claude/worktrees/feature+Clone-UI-Base-Workflow` |
| Nhánh | `feature/Clone-UI-Base-Workflow` (base `main`, HEAD `dbf6b0f`) |
| Trạng thái git | **Đã hoàn thành** — người dùng nghiệm thu 2026-09-27; commit trên nhánh và merge `--no-ff` vào `main`, đã push. |
| Supabase | Cloud project `ftciqmqhmfvjtwoycswe`, truy cập qua MCP `mcp__supabase__*` (phải mở đúng thư mục worktree mới có tool) |
| Dev server | Người dùng tự chạy trong worktree: `npm run dev -- --port 3100 --strictPort` → **http://localhost:3100** |
| Verify | `mkdir -p node_modules/.vite-temp && npm run lint && npm test && npm run build` |
| Verify gần nhất | Xanh: lint, 483 file / 2286 test pass (2 skip), build OK |
| Plan gốc đã duyệt | `/Users/admin/.claude/plans/happy-wandering-bee.md` |

- **Không `cd` về `/Users/admin/khotienthinh`.** Thư mục gốc đang ở nhánh khác (`feature/refactor-du-an-t9-1`), app desktop hiển thị nhánh đó là bình thường.
- Port 3000 (và tiến trình cũ ở 3100 trước đây) từng chạy từ root checkout, tức **code cũ**. Nếu người dùng thấy hành vi lạ, trước tiên kiểm tra dev server chạy từ đâu: `lsof -iTCP:3100 -sTCP:LISTEN` rồi `lsof -p <pid> | grep cwd`.

**Việc cần làm ngay khi vào phiên mới:** hỏi kết quả người dùng thử lại 2 lỗi §4 (đã sửa, xem §3 mục 5–6), rồi tiếp checklist kiểm tra tay §5.3.

## 1. Quy tắc bắt buộc (AGENTS.md + người dùng)

**Supabase**
- Chỉ Supabase Cloud với cấu hình `.env`. Không Supabase local, không Docker, **không `supabase db push`**.
- Không áp lại migration `20260716040851`. Không grant cho `anon`.
- Thay đổi DB = migration **mới** có timestamp; không sửa migration đã áp.
- **Mọi thao tác ghi / áp migration lên Cloud phải hỏi người dùng trước.** Đọc (SELECT) thì tự do.

**Bảo mật**: không commit `.env`, key, service-role key, dữ liệu production. Service-role key không bao giờ ở browser. Không commit `.mcp.json` nếu có token (bản hiện tại không có token).

**Phân quyền**: thẩm quyền nằm ở RLS / DB function / Edge Function; check ở frontend chỉ hỗ trợ UX. Không dựng lại "manual verifier picker" làm thẩm quyền. Không định tuyến thông báo theo permission pool.

**Cách làm việc**: không dùng sub-agent; không dùng Superpowers skill cho việc đơn giản.

**UI/UX**: nghĩ như Product Designer + người dùng thật + FE engineer. Tái dùng Design System, progressive disclosure. Hiện đúng loading/empty/error/unknown/denied — không che bằng `0`. Walkthrough desktop/tablet/mobile. Không redesign ngoài scope.

**Commit/PR**: commit message kết thúc `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR kết thúc `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

**Công cụ / sandbox**
- Worktree guard từ chối lệnh phức tạp (heredoc, `source .env`, `git -C <thư mục khác>`) → dùng Edit/Write hoặc lệnh đơn giản.
- zsh: `grep --include=*.tsx` lỗi glob → viết `--include=\*.tsx` hoặc grep theo thư mục.
- Thư mục `.claude/` bị chặn ghi. Bash không gọi thẳng `*.supabase.co` được → dùng MCP.

## 2. Bài toán và các quyết định đã chốt

Người dùng muốn tab **Dự án » Vật tư » Đề xuất vật tư** không phụ thuộc template dùng chung "Quy trình cấp vật tư công trường" của module Quy trình, mà **tự thêm/bớt/đổi thứ tự bước duyệt ngay trong dự án**, với quyền theo room Đề xuất vật tư.

- Template được phân giải qua `project_workflow_bindings` theo ưu tiên **site > project > global** (`app_private.project_workflow_resolve_template`).

| # | Quyết định |
|---|---|
| 1 | Tách riêng **theo dự án** (`project_id`, `construction_site_id = null`) bằng cách clone template gốc |
| 2 | Template clone **ẩn** khỏi module Quy trình |
| 3 | Đồng bộ khi template gốc thay đổi: **hoãn** |
| 4 | Quyền sửa: **room `material_request` action `edit` + `view`**, không thêm action mới |

Bất biến phải giữ:
- **Snapshot**: lúc start, `project_workflow_snapshot_instance` copy node/edge sang `workflow_instance_nodes/edges`; `advance_project_workflow_v2` đọc snapshot → sửa template không làm lệch phiếu đang chạy.
- **Room là thẩm quyền cuối**: start cần `submit`, advance cần `approve`; người nhận phải có `approve`+`view` (hoặc `confirm` nếu bước kế là END), kiểm tra bởi `app_private.assert_material_request_room_recipients` → raise 42501.

## 3. Đã làm xong

### Phase 1 — Panel "Quy trình duyệt" trung thực
- `components/project/ProjectWorkflowBindingPanel.tsx`: không `return null` khi thiếu quyền; nút disable + lý do (`READ_ONLY_REASON`); hiện template hiệu lực, scope, danh sách bước; cảnh báo khi dùng global.
- `lib/workflowStepSummary.ts` (mới, tách từ WorkflowBuilder).
- `components/project/MaterialRequestKanbanBoard.tsx`: drop bị từ chối có lý do (`rejectDrop` + `aria-live`).
- `components/project/material/MaterialRequestTab.tsx`: lọc node `__templateRemoved`.

### Phase 2 — Migration `20260926090000_project_owned_material_request_workflow.sql` (**ĐÃ ÁP** bởi người dùng)
- Cột mới `workflow_templates`: `owner_subject_type`, `owner_project_id`, `cloned_from_template_id`.
- Helper `app_private.project_owned_workflow_actor_has_room_action`; nới `workflow_template_actor_can_view/can_edit`, `project_workflow_binding_can_manage` cho template owned.
- `set_project_workflow_binding` chặn bind template của dự án khác.
- RPC `public.clone_project_workflow_template` (security definer, idempotent, clone node id = `md5(template_id:source_node_id)`, chỉ grant `authenticated`).
- `get_project_workflow_configuration` trả thêm `canCustomize`, `templateName`, `templateOwnedByProject`, `clonedFromTemplateId`; bản gia cố raise **42501** nếu không có quyền xem → frontend hiện trạng thái *denied*.
- Frontend: `lib/projectWorkflowService.ts` (`cloneProjectTemplate`, `getConfiguration`, `getTemplateStartContext`); ẩn template owned qua `isProjectOwnedWorkflowTemplate` (`lib/workflowVisibility.ts`) ở `pages/wf/WorkflowTemplates.tsx`, `WorkflowDashboard.tsx`, `pages/Home.tsx`; `context/WorkflowContext.tsx`, `types.ts`.

### Phase 3 — Trình sửa bước trong dự án
- `lib/workflowStepDraft.ts` (mới, dùng chung với WorkflowBuilder): thao tác bước + `buildLinearTemplateStructure` (tự sinh START/END, nối tuyến tính theo `positionY`).
- `lib/projectWorkflowStepEditor.ts` (mới): 4 kiểu người xử lý `transition` / `fixed` / `pool` / `creator`, `validateStepDraft`, `getPreservedTargets`.
- `components/project/ProjectWorkflowStepEditor.tsx` (mới): sửa tên, người xử lý, duyệt đồng thời, SLA, watcher; thêm/xóa/lên/xuống; lưu qua `projectWorkflowService.saveTemplateStructure`.
- Panel: nút "Sửa bước duyệt" → nếu chưa có bản riêng thì xác nhận → clone → editor. Hỏi trước khi bỏ thay đổi chưa lưu. Khóa sửa khi binding ở scope `site`.

### Phase 4 — Tiền kiểm người nhận
- Editor lấy giao của `listRecipients(..., 'approve')` và `'view'`; `checkStepRecipients` → `unchecked/ok/partial/blocked/empty_room`; lỗi tải hiện "Thử lại"; lưu khi còn bước bị chặn phải xác nhận.

### Migration watcher `20260925090000_workflow_step_watcher_autotag.sql` (**ĐÃ ÁP**)
- Trigger merge `stepWatcherTargets` vào `workflow_instances.watchers` cho engine Quy trình thường; bỏ qua instance có `workflow_subjects` (project runtime tự xử lý từ snapshot).

### Clone UI Base.vn cho module Quy trình (xong từ trước trong cùng nhánh)
- Màu Base chỉ áp cho module Quy trình (`index.css`), sidebar, thẻ quá hạn, kéo thả card (`components/KanbanBoard.tsx`, `pages/wf/*`, `components/workflow/*`).

### Sửa lỗi phát sinh khi người dùng test (26/09) — đã verify xanh
1. **Chuyển bước báo "Không thể chuyển bước" + "[object Object]" dù server đã chuyển, phải xác nhận 2 lần.** Nguyên nhân: `WORKFLOW_ASSIGNMENT_SELECT` (`lib/projectWorkflowService.ts:40`) select cột không tồn tại `return_to_instance_node_id` → lần đọc lại 400. Đã bỏ cột; trong `performDynamicRequestTransition` (`pages/project/MaterialTab.tsx`) lỗi refresh sau khi đã chuyển chỉ hiện `toast.warning('Đã chuyển bước', ...)`. `getWorkflowActionErrorMessage` (`lib/projectOperationalUxPolicy.ts`) dùng `getApiErrorMessage` → không còn "[object Object]". Test: `lib/__tests__/projectOperationalUxPolicy.test.ts`.
2. **Kanban lặp cột sau khi clone** (node id clone khác node id gốc). Cột giờ gom theo **tên bước**: `getMaterialRequestWorkflowLaneId(label)` trong `lib/materialRequestService.ts` (NFC, trim, gộp space, lowercase `vi`). Test: `lib/__tests__/materialRequestWorkflowLaneId.test.ts`.
3. **Thứ tự cột sai (QLDA trước BCH)**: 4 phiếu cũ có snapshot "Tạo đề xuất"@100, BCH@200. `columns` trong `MaterialRequestKanbanBoard.tsx` giờ duyệt template node trước (lấy `positionY` của template), rồi mới runtime node, rồi fallback.
4. Dev server chạy nhầm từ root checkout → nay chạy từ worktree.
5. **Kéo thả Kanban bị chặn "Chỉ được chuyển sang đúng bước workflow kế tiếp"** (§4A). Nguyên nhân thật: nhánh hydrate từ board RPC (`MaterialTab.tsx` ~396) tạo runtime context chỉ có node hiện tại, `edges: []` → `getWorkflowNextNode` luôn `null` (không phải do clone). Sửa: sau hydrate, tải nền snapshot đủ (`listRuntimeContextsBySubjects`) cho phiếu RUNNING; khi chưa tải xong → toast "Đang tải quy trình của phiếu"; kéo sai cột → toast nêu tên bước kế tiếp + hướng dẫn "Trả lại" trong phiếu. Đã kiểm Thiện (`4a0b3a22…`) có `approve` ở công trường `240ac280…` của 9834/9833.
6. **"Chọn nhanh theo nhóm cấu hình" hiện phòng ban lạ** (§4B): `ProjectWorkflowAssigneeSelect.tsx` chỉ hiện phòng ban có trong `assignmentTargets` của bước (phương án 1). Test: `components/project/__tests__/ProjectWorkflowAssigneeSelect.test.tsx`.
- Verify sau khi sửa: lint, 484 file / 2288 test pass (2 skip), build OK. Chờ người dùng thử lại trên localhost:3100.
7. **"Tạo đề xuất" chen trước "BCH CT Duyệt"** (27/09, sau khi mục 5 tải đủ snapshot): snapshot của MR-2026-9828…9834 còn node "Tạo đề xuất" (ACTION, `position_y` 100 trùng BCH) nhưng không có cạnh nối. `getRuntimeWorkflowFlowNodes` (`lib/projectWorkflowService.ts`) chỉ giữ node đi được từ START theo cạnh; dùng cho cột Kanban và danh sách bước trong chi tiết phiếu. Test: `lib/__tests__/runtimeWorkflowFlowNodes.test.ts`.

## 4. (LƯU TRỮ) 2 lỗi người dùng báo 26/09 — đã sửa, xem §3 mục 5–6

### Lỗi A: Tài khoản Thiện kéo thả card sang bước kế tiếp bị chặn
- Toast: **"Không thể chuyển bước — Chỉ được chuyển sang đúng bước workflow kế tiếp."** Kéo ngược lại bước trước cũng không được.
- Ví dụ: MR-2026-9834 và MR-2026-9833 đang ở cột "PHÒNG TKĐT DUYỆT", kéo sang "PHÒNG VẬT TƯ DUYỆT".
- Toast phát ra ở `handleMoveMaterialRequest`, `pages/project/MaterialTab.tsx` ~dòng 1313–1318: `nextNode = getWorkflowNextNode(dynamicSubject)`; nếu `!nextNode || toStage !== getMaterialRequestWorkflowLaneId(nextNode.label)` thì chặn.
- **Dữ liệu Cloud đã kiểm (đúng):**

  | Phiếu | subject id | current_node_id | current_instance_node_id | Bước hiện tại | Bước kế (snapshot) |
  |---|---|---|---|---|---|
  | MR-2026-9834 | `9b9619a6-…` | `e7a0e0dc-f97f-411b-aa97-a1094eaffbf9` | `25b57c89-…` | Phòng TKĐT duyệt | Phòng vật tư duyệt |
  | MR-2026-9833 | `8953fe2f-…` | `e7a0e0dc-…` | `7cae50b4-…` | Phòng TKĐT duyệt | Phòng vật tư duyệt |
  | MR-2026-9832 | `c257851b-…` | `e533d290-b968-4846-9bf4-0f529cefffca` | `7f85131b-…` | Phòng vật tư duyệt | Kết thúc (END) |
  | MR-2026-9828 | `9dc8010d-…` | `e533d290-…` | `cb2fe89b-…` | Phòng vật tư duyệt | Kết thúc (END) |

  Assignee hiện tại của 9834/9833: `4a0b3a22-fb48-4d0e-8e10-b5558c42dbb5` (nghi là Thiện, chưa xác nhận).
- **Giả thuyết chính (chưa xác minh):** `getWorkflowNextNode` (`MaterialTab.tsx:667`) ưu tiên `requestWorkflowRuntimeContexts[subject.id]`. Nếu runtime context của phiếu chưa được tải (hoặc thiếu `currentInstanceNodeId` trên subject phía client), hàm fallback sang `workflowEdgesBySource.get(subject.currentNodeId)` — mà `workflowEdgesBySource` được build từ **template đang cấu hình (bản clone)**, còn `current_node_id` `e7a0e0dc` là node của **template gốc** → không có edge → `nextNode = null` → bị chặn. Đây là hệ quả phụ của việc clone đổi node id (giống lỗi lặp cột).
- **Cách xác minh:**
  1. SQL: `select id, label, workflow_template_id from workflow_nodes where id in ('e7a0e0dc-f97f-411b-aa97-a1094eaffbf9','e533d290-b968-4846-9bf4-0f529cefffca');` — nếu template là `37c42e8c-…` (gốc) thì khớp giả thuyết.
  2. Xem chỗ tải runtime contexts (`MaterialTab.tsx` ~395, ~471, ~1048) có tải cho mọi subject RUNNING không, và subject map có `currentInstanceNodeId` không.
- **Hướng sửa đề xuất:** so khớp bước kế tiếp luôn theo **snapshot** của phiếu (`workflow_instance_nodes/edges`), không fallback sang template hiện hành; nếu buộc phải fallback thì map qua `template_node_id` / label. Kiểm tra thêm `canMoveMaterialRequest` và `getWorkflowNodePermissionCodes` có cùng vấn đề node id không.
- **Kéo ngược:** theo thiết kế, lùi bước là thao tác "Trả lại" (qua modal), không phải kéo thả. Nếu giữ như vậy thì toast cần nói rõ: *"Muốn trả lại bước trước, mở phiếu và chọn Trả lại"* thay vì thông báo chung. Hỏi người dùng nếu họ muốn kéo ngược = trả lại.
- Nhớ: tài khoản Thiện phải có room `approve` ở dự án thì server mới cho advance; nếu vẫn lỗi sau khi sửa client thì kiểm tra quyền.

### Lỗi B: "Chọn nhanh theo nhóm cấu hình" hiện "Phòng Vật tư - Thiết bị", "Ban lãnh đạo" dù cấu hình không chọn pool phòng ban
- Vị trí: `components/project/ProjectWorkflowAssigneeSelect.tsx` (dùng trong `ProjectWorkflowActionDialog.tsx:289` và `ProjectWorkflowStartDialog.tsx:139`).
- Nguyên nhân (đã đọc code, dòng ~197–207): `departments` = phòng ban trong `configuredDepartmentIds` **HOẶC** bất kỳ phòng ban nào có ít nhất một ứng viên (candidate) thuộc về. Tức là nhóm được suy ra từ ứng viên đủ quyền, không phải từ cấu hình → tiêu đề "theo nhóm cấu hình" gây hiểu sai.
- **Hướng sửa đề xuất (UX):**
  - Chỉ hiện nhóm có trong `configuredDepartmentIds` dưới tiêu đề "Chọn nhanh theo nhóm cấu hình"; hoặc
  - Nếu vẫn muốn gợi ý theo phòng ban của ứng viên, đổi tiêu đề thành "Chọn nhanh theo phòng ban" và chỉ chọn những người **trong danh sách ứng viên** của phòng đó (kiểm tra `departmentUserIds` ở ~dòng 262–268 có lọc theo `candidateUserIds` không).
  - Nên hỏi người dùng chọn phương án nào; mặc định em đề xuất phương án 1 (đúng với tên gọi).
- Thêm test cho logic lọc nhóm.

Sau khi sửa A + B: chạy verify, cập nhật §3 và nhờ người dùng thử lại trên localhost:3100.

## 5. Việc còn lại để hoàn thành plan

1. ~~Kiểm tra Cloud~~ — xong.
2. ~~Áp 2 migration~~ — xong (người dùng tự apply bản gia cố). Báo cáo + recovery: `docs/audits/workflow-migrations-20260926/`. Smoke test SQL: `supabase/tests/workflow_migrations_20260926_safety_smoke.sql`.
3. **Kiểm tra tay trên http://localhost:3100** (người dùng đăng nhập; agent không làm thay được):
   - [ ] Tài khoản có room edit+view: thấy nút "Sửa bước duyệt", clone, sửa, lưu được.
   - [ ] Tài khoản chỉ view: nút bị khóa, có lý do.
   - [ ] Phiếu đang giữa luồng → đổi thứ tự / xóa bước → phiếu cũ đi đường cũ, phiếu mới theo cấu hình mới.
   - [ ] Gán cho người không có `approve`: editor cảnh báo đỏ; cố chuyển bước thì DB raise 42501.
   - [ ] Module Quy trình không thấy template clone.
   - [ ] Kéo thả Kanban sang bước kế tiếp hoạt động (đang lỗi — §4A).
   - [ ] Mobile (bottom sheet), tablet, desktop.
4. **Sửa lỗi phát sinh + verify lại** — đang làm (§4).
5. **Commit / PR khi người dùng yêu cầu.**

### Dữ liệu tham chiếu để test
- Dự án SMB-2026 `b4ce0810…`: đã có bản clone `75b04d4e-1dcc-45e1-9327-e3ef8c1e81b0` "(riêng dự án SMB-2026)", tạo 2026-09-26 12:01 UTC, clone từ template gốc `37c42e8c-7f36-46f7-8eb4-eb313af4d981`. Thứ tự hiện tại: BCH CT Duyệt → Phòng QLDA duyệt → Phòng TKĐT duyệt → Phòng vật tư duyệt. Dự án này **cũng có binding cấp công trường** → editor có thể bị khóa ở các công trường đó.
- Dự án chỉ có binding cấp dự án (tốt để test clone từ đầu): `dda93a4a…`, `96e517ef…`.
- Dự án có binding site: `d3d25b49`, `b4ce0810`, `12788c72` (binding `12788c72` có `project_id = construction_site_id` — nghi sai dữ liệu, chưa sửa).
- 4 phiếu cũ nhất có snapshot kiểu cũ ("Tạo đề xuất" @100, BCH @200).

### Lưu ý schema (tránh viết SQL sai)
- Không có bảng `material_requests`; phiếu nằm ở `requests` (mã ở `requests.code`), nối `workflow_subjects.subject_id`.
- `workflow_subjects` không có `subject_code`; có `current_node_id`, `current_instance_node_id`, `current_assignee_user_ids`, `return_to_instance_node_id`, `template_version_id`…
- `workflow_step_assignments` **không có** `return_to_instance_node_id`.
- `project_workflow_bindings` không có `template_id` trực tiếp như tên gợi ý — xem định nghĩa bảng trước khi query.
- Lỗi Supabase/PostgREST là object thường, không phải `Error` → luôn dùng `getApiErrorMessage` (`lib/apiError.ts`).

## 6. Follow-up ngoài scope (đã báo người dùng)
- Đồng bộ "template gốc đã đổi, có muốn sync?" — hoãn.
- Binding cấp công trường thắng bản dự án → editor bị khóa; cần phương án riêng.
- Cột legacy `requests.workflow_step` gộp mọi bước giữa thành `material_department_review`.
- Banner "cần quyền submit" chưa chính xác.
- `WorkflowTemplate` chưa có cột `settings` → các toggle "Tùy chỉnh quy trình" kiểu Base chưa lưu được.

## 7. File thay đổi (uncommitted)

Sửa: `components/KanbanBoard.tsx`, `components/project/MaterialRequestKanbanBoard.tsx`, `components/project/ProjectWorkflowBindingPanel.tsx`, `components/project/material/MaterialRequestTab.tsx`, `context/WorkflowContext.tsx`, `index.css`, `lib/materialRequestService.ts`, `lib/projectOperationalUxPolicy.ts`, `lib/projectWorkflowService.ts`, `lib/workflowVisibility.ts`, `pages/Home.tsx`, `pages/project/MaterialTab.tsx`, `pages/wf/WorkflowBuilder.tsx`, `pages/wf/WorkflowDashboard.tsx`, `pages/wf/WorkflowInstances.tsx`, `pages/wf/WorkflowTemplates.tsx`, `types.ts`, và các test `lib/__tests__/projectOperationalUxPolicy.test.ts`, `workflowInstanceCapabilityCommands.test.ts`, `workflowVisibility.test.ts`.

Mới: `components/project/ProjectWorkflowStepEditor.tsx`, `components/workflow/`, `lib/projectWorkflowStepEditor.ts`, `lib/workflowStepDraft.ts`, `lib/workflowStepSummary.ts`, 2 migration `supabase/migrations/20260925090000_*.sql` và `20260926090000_*.sql`, `supabase/tests/workflow_migrations_20260926_safety_smoke.sql`, `docs/audits/workflow-migrations-20260926/`, file handoff này, và các test `materialRequestWorkflowLaneId`, `materialRequestWorkflowPanelContract`, `projectOwnedWorkflowTemplateMigration`, `projectWorkflowStepEditor`, `workflowStepDraft`, `workflowStepWatcherAutotag`.

Không commit: `.claude/`, `.mcp.json` (nếu có token), `.env`.

## 8. Trả lời sẵn: đổi thứ tự / thêm / bớt bước thì phiếu cũ ra sao?
- **Phiếu đang chạy** giữ luồng cũ (snapshot lúc start).
- **Phiếu gửi sau khi lưu** theo cấu hình mới (`project_workflow_ensure_template_version` tạo phiên bản mới).
- **Bước bị xóa còn tham chiếu** chỉ đánh dấu `config.__templateRemoved = true`, không mất lịch sử.
- **Kanban** gom cột theo tên bước, thứ tự theo template hiện hành; giai đoạn chuyển tiếp có thể thấy cả cột cũ ("Tạo đề xuất") lẫn mới; `hideEmptyWorkflowLanes` ẩn cột rỗng.

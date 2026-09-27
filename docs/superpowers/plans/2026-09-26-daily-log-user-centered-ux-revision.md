# Daily Log User-Centered UX Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Một agent chính, không sub-agent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Trạng thái:** Đã được người dùng duyệt thiết kế và plan ngày 26/09/2026: “ok, bắt đầu đi em”. Bắt đầu Task 1, thực thi tuần tự; chưa nghiệm thu hoặc phát hành.

**Goal:** Kỹ sư ghi/gửi phiếu dễ như tờ giấy công việc, người tổng hợp rà soát theo phiếu, CHT duyệt hoặc trả đúng nguồn và kỹ sư sửa/gửi lại được trong ERP thật.

**Architecture:** Giữ contribution theo người/khu vực và summary theo ngày. Tách presentation/selection nhỏ trong Daily Log; thêm command v2 chọn nguồn cụ thể, lưu nguyên phiếu và trả/gửi lại theo transaction. V1/legacy và command publication/evidence giữ nguyên. Chế độ xem/duyệt render báo cáo thay vì form disabled.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind/token hiện có, Inter, Lucide, Vitest, Playwright, Supabase Cloud/PostgreSQL/RLS.

**Spec:** [Đề xuất thiết kế UX](../specs/2026-09-26-daily-log-user-centered-ux-revision-design.md), bổ sung có kiểm soát cho [đặc tả đã duyệt](../specs/2026-09-23-daily-log-wbs-progress-resources-cost-design.md).

## Global Constraints

- Một phiếu theo người + khu vực/mũi, một bản tổng hợp ngày; CHT duyệt bản tổng hợp. Một người có hai khu vực vẫn có hai phiếu.
- Người tổng hợp chỉnh bản sao, không sửa nguồn gốc; không cộng % giữa khu vực, không suy đoán/backfill lịch sử.
- Chỉ luồng WBS Nhật ký mới sau cutover. Không chỉnh Project V2, Procurement V2, BOQ, HRM, điều kiện vào Finance, giá/tiền/accrual/project transactions.
- Agent chính, tuần tự; Supabase Cloud từ `.env`, không local/Docker. Không merge/deploy/bật enforced theo kế hoạch này.
- Reuse React/Tailwind/Lucide, Inter và token hiện có; không thêm thư viện UI, sửa font/theme/CSS toàn app hoặc refactor toàn trang DailyLogTab.
- Unknown khác 0; không tự cộng khối lượng khác đơn vị hoặc tự xác nhận các phạm vi không trùng. Mỗi dòng nguồn lực mới có provider hợp lệ.
- Dùng canonical/effective Room actions đúng scope và actor từ server; không admin bypass hoặc user_metadata làm bằng chứng quyền.
- Migration mới sinh bằng CLI, không sửa SQL đã chạy hoặc repair ledger. Public RPC là adapter nhỏ kiểm tra quyền, helper/receipt nằm app_private.
- TDD RED → GREEN → regression, commit riêng từng task; stage explicit file list, không `git add .`.
- Giữ pilot shadow: `Đối chiếu thử nghiệm`, không thông báo đã công bố khi receipt false.

## Review Focus

1. Một kỹ sư có hai phiếu cùng ngày: sửa/gửi lại A không chạm B, không mặc định phiếu mới nhất — Task 2, 5, 8.
2. Unit/planned/baseline thiếu, nhập `12,5`, trống hoặc sai: không sinh khối lượng giả/unknown0 — Task 1, 3, 5, 8.
3. Trả nguồn tham gia nhiều summary, có hồ sơ verified: không mở sửa lịch sử, nhận xét tới đúng người — Task 4, 6, 7, 8.
4. Mất mạng/double-click/duyệt–trả–gửi lại đồng thời: không duplicate hoặc nửa trạng thái, conflict có hướng dẫn — Task 2, 4, 8.
5. Light/dark, tên/lý do dài, keyboard/mobile, nhiều WBS: không che lỗi/action, nguồn lực gắn đúng việc, số tổng đúng nghĩa — Task 1, 5, 6, 7, 8.

## File Map và cách thực thi

Worktree hiện có: `/Users/admin/.codex/worktrees/daily-log-clean-integration/khotienthinh`, branch `codex/daily-log-bootstrap-integration`. Khi bắt đầu kiểm tra HEAD/status lại; tài liệu đang chưa commit không phải code đã triển khai. Không chạy dev từ root dirty workspace.

Tạo các đơn vị nhỏ: `lib/dailyLogPresentation.ts`, `lib/dailyLogEntryRules.ts`, `components/project/daily-log/DailyLogDocumentHeader.tsx`, `DailyLogSourcePicker.tsx`, `DailyLogWorkItemReadTable.tsx`, `daily-log-document.css` trong cùng directory. CSS chỉ scoped `.daily-log-document` nếu cần chống global mobile override, không sửa `index.css`/`index.html`.

Điểm sửa chính: `types.ts`, `lib/dailyLogWbsService.ts`, `lib/dailyLogWorkflow.ts`, components Daily Log và nhánh WBS của `pages/project/DailyLogTab.tsx`. File test/SQL smoke nêu riêng từng task.

Migration: plan khóa suffix và phạm vi; timestamp do CLI sinh lúc thực thi. Kiểm tra CLI `--help`, chạy `supabase migration new <suffix>`, không tạo filename timestamp đoán trước. Chỉ apply đúng baseline Cloud sau quyền thực thi đã được duyệt.

---

### Task 1: Presentation contract và khung phiếu theo style tham khảo

**Files:** Create `lib/dailyLogPresentation.ts`, `lib/__tests__/dailyLogPresentation.test.ts`, `components/project/daily-log/DailyLogDocumentHeader.tsx`, `lib/__tests__/dailyLogDocumentHeader.test.tsx`; CSS scoped như File Map nếu cần.

**Interfaces:**
- `DailyLogDocumentMode = 'author' | 'summarize' | 'review' | 'verified'`.
- `formatDailyLogDate(value: string): string`, `formatDailyLogTime(value: string): string`: dd/mm/yyyy, HH:mm Asia/Ho_Chi_Minh; invalid → `Chưa xác định`.
- `formatDailyLogQuantity(value: number | null | undefined, unit?: string | null): string`: null → `Chưa xác định`, số 0 thật → `0` kèm unit có thật.
- `summarizeDailyLogPhysicalRows({ workItems, labor, machines }): { uniqueWbsCount: number; laborPersonEntries: number | null; totalLaborHours: number | null; machineEntries: number | null; totalMachineHours: number | null }`. Ruling khi pre-flight: thiếu semantics vật lý thì tổng tương ứng unknown, không lấy count/hours/shifts legacy để suy ra.
- Header props `{ title, date, authorName, areaName?, statusLabel, mode, busyAction?, primaryAction?, secondaryAction?, onClose }`; action `{ label, disabled, disabledReason?, onClick }`. Component presentational không tự suy quyền.

- [x] **Step 1 — RED:** Viết `formats_unknown_separately_from_zero`, `formats_vietnam_date_and_time`, `totals_hours_without_claiming_unique_headcount`, `header_has_one_primary_action_and_status`. Assertions pin null≠0, 2 dòng cùng 5 người→10 lượt chứ không 10 người duy nhất, chỉ một primary button.

  Assertions bắt buộc:

  ```ts
  expect(formatDailyLogQuantity(null, 'm³')).toBe('Chưa xác định');
  expect(formatDailyLogQuantity(0, 'm³')).toBe('0 m³');
  expect(formatDailyLogDate('2026-09-25')).toBe('25/09/2026');
  expect(formatDailyLogTime('2026-09-25T06:39:00Z')).toBe('13:39');
  ```
- [x] **Step 2:** `npm run test -- lib/__tests__/dailyLogPresentation.test.ts lib/__tests__/dailyLogDocumentHeader.test.tsx`; xác nhận fail vì contract chưa có, không lỗi môi trường.
- [x] **Step 3 — GREEN:** Implement signatures. Theo §5 spec: Inter, title20–22/600, dữ liệu14px, mobile input16px, viền1px, primary#0f766e. Một vùng action responsive: desktop top sticky, mobile bottom safe-area, không hai bộ nút cùng lúc.
- [x] **Step 4:** Chạy lại tests và `npm run lint`; kiểm tra thông tin chính không dùng font9–10px, action chưa đủ quyền có lời giải thích, không thay font/theme global.
- [x] **Step 5:** Stage đúng files task; commit `feat(daily-log): add user-centered document presentation` (`e75fa64`). Kiểm chứng sau commit: 29 tests targeted pass; full suite 2.395 pass, 2 skips có sẵn; typecheck pass. Header chưa nối ERP, walkthrough thuộc Tasks 5–8.

### Task 2: Chọn đúng phiếu và tạo phiếu khu vực thứ hai

**Checkpoint 26/09/2026 đã được xử lý theo phê duyệt “Anh cho phép”:** Index baseline unique theo ngày/người chặn A+B. Thêm marker phiên bản nguồn mặc định v1, giữ unique tương đương cho v1 và lọc `findMine` của legacy về v1; chỉ command kiểm quyền tạo v2. Không suy đoán/backfill lịch sử. Migration `20260926102824` đã apply riêng trên baseline-vioo-git, Cloud compatibility/concurrency qua kiểm chứng; xem `../evidence/2026-09-26-daily-log-source-selection-checkpoint.md`.

**Files:** Modify `lib/dailyLogWbsService.ts`, `lib/dailyLogWorkflow.ts`, `types.ts`; create `components/project/daily-log/DailyLogSourcePicker.tsx`, `lib/__tests__/dailyLogSourcePicker.test.tsx`, `lib/__tests__/dailyLogSourceSelectionMigration.test.ts`, `supabase/tests/daily_log_source_selection_smoke.sql`; extend `lib/__tests__/dailyLogWbsService.test.ts`. Migration suffix `daily_log_source_selection_v2`.

**File-map extension approved at checkpoint:** `lib/projectService.ts` (one lookup filter), `lib/__tests__/projectService.dailyLog.test.ts`, `supabase/baseline/current.json` (only this Daily Log entry), guarded Task 2 Cloud staging/concurrency runners and their boundary tests.

**Interfaces:**
- `getDocumentBundle(input: DailyLogWbsBundleInput & { contributionId?: string | null }): Promise<DailyLogDocumentBundle>` → `get_daily_log_document_bundle_v2(p_project_id text,p_construction_site_id text,p_log_date date,p_daily_log_id text,p_contribution_id uuid)`.
- Bundle mở rộng v1: `myContributions: DailyLogContribution[]`, contribution chọn đúng ID hoặc null, `baselineQuantityStates: Record<string,'none'|'known'|'unknown'>`, quyền nguồn cụ thể.
- `createSource({ commandId, projectId, constructionSiteId, date, workAreaCode, workAreaName }): Promise<{ contributionId: string; rowVersion: number; updatedAt: string }>` → `create_daily_log_source_v2(p_command_id uuid,p_project_id text,p_construction_site_id text,p_log_date date,p_work_area_code text,p_work_area_name text)`.
- Picker props `{ sources, selectedIds, selectionMode: 'single'|'multiple', onChange, onCreateArea? }`.
- Private table `app_private.daily_log_source_command_receipts`: commandUUID PK, actor/scope/operation/payloadFingerprint/receipt, không browser direct write. Retry cùngUUID/payload trả receipt; đổi payload với UUID cũ reject.

- [x] **Step 1 — RED:** Test chọn phiếu A cũ mà không lấy B mới, null selection bắt đầu rỗng, wrong owner/scope deny, project nullsite hợp lệ, tạo A+B được, retry create một nguồn, command reuse sai payload reject. Returned source nhìn thấy nhưng không chọn để gửi summary.
- [x] **Step 2:** Run service/picker/migration tests RED. SQL smoke authenticates non-admin đúng actor, expected missingRPC khác bootstrap/network error.
- [x] **Step 3 — GREEN:** Additive migration/RPC v2, v1 không đổi. Server author/current permissions. Serialize create theo scope+actor+ngày+khu vực chống hai tab; nếu trùng area mới trả lỗi có existing ID để UI mở phiếu. Không thêm constraint làm hỏng historical duplicates. Bundle chỉ nguồn có quyền xem. State `none` = không có prior official row, `unknown` = có row nhưng quantity null.
- [x] **Step 4:** Unit/RPC Cloud GREEN; nguồn A/B và receipt đúng, scope/denied tests pass, không progress/evidence/transaction mới. Không dùng service_role/admin làm persona.
- [x] **Step 5:** Commit `feat(daily-log): select source slips explicitly by area`; isolated task scope, Cloud gates and fresh verification recorded in checkpoint evidence.

### Task 3: Nhập khối lượng thuận tiện và lưu nguyên phiếu an toàn

**Files:** Create `lib/dailyLogEntryRules.ts`, `lib/__tests__/dailyLogEntryRules.test.ts`, `lib/__tests__/dailyLogSourceQuantityMigration.test.ts`, `supabase/tests/daily_log_source_quantity_smoke.sql`; modify `types.ts`, `lib/dailyLogWbsService.ts`, `lib/dailyLogWorkflow.ts`, service tests. Migration suffix `daily_log_source_quantity_entry_v2`.

**Interfaces:**
- `DailyLogEntryMode = 'daily_quantity' | 'cumulative_quantity' | 'percent'`.
- `deriveDailyLogEntry({ mode, enteredValue, plannedQuantity, unit, previousCumulativeQuantity, baselineQuantityState }): { valid: boolean; errorCode: string | null; cumulativePercent: number | null; cumulativeQuantity: number | null; dailyQuantity: number | null }`.
- `DailyLogSourceItemV2 = { clientKey, taskId, workBoqItemId?, areaPlannedQuantity?, entryMode, enteredValue, baselineFingerprint, forecastFinishDate?, forecastChangeReason?, note?, attachments? }`.
- `saveSourceDocument({ contributionId, expectedRowVersion, workAreaCode, workAreaName, content, issues, photos, items: DailyLogSourceItemV2[], labor: DailyLogLaborInput[], machines: DailyLogMachineInput[] }): Promise<DailyLogWorkSaveReceipt>` → `save_daily_log_source_document_v2(p_input jsonb)`.

- [x] **Step 1 — RED:** Pin plan100/baseline40/today12→52m³/52%/12m³; cumulative52/percent52 tương đương. Parser hiện có `12,5`→12.5, blank/NaN không→0. Unknown baseline→daily null hoặc daily entry bị chặn; none+unit/plan hợp lệ mới được baseline0. Missingunit/planned chỉ percent mode hợp lệ với qtynull. Leaf sai scope, stale baseline fingerprint, số âm, belowbaseline/abovenext, forecast đổi thiếu lý do reject toàn bộ.

  Test `daily_entry_preserves_cumulative_semantics` phải có:

  ```ts
  expect(deriveDailyLogEntry({ mode: 'daily_quantity', enteredValue: 12,
    plannedQuantity: 100, unit: 'm³', previousCumulativeQuantity: 40,
    baselineQuantityState: 'known' })).toMatchObject({ valid: true,
      cumulativePercent: 52, cumulativeQuantity: 52, dailyQuantity: 12 });
  ```
- [x] **Step 2:** `npm run test -- lib/__tests__/dailyLogEntryRules.test.ts lib/__tests__/dailyLogSourceQuantityMigration.test.ts lib/__tests__/dailyLogWbsService.test.ts`; RED do contract chưa có. Cloud SQL smoke pin metadata/work/resources rollback.
- [x] **Step 3 — GREEN:** Wrapper rule cho v2; reuse `lib/quantityInput.ts` preserve dấu phẩy/blank, không sửa shared parser. Server tính lại từ scoped task/BOQ/baseline, không tin total/clientplan. Check trước replace resources; không greatest(...,0) để che số âm. Metadata/work/resources cùng transaction kể cả nguồn đã tồn tại. Cho lưu nháp chưa hoàn chỉnh nhưng không lưu dòng resource sai/thiếu provider. Reject price/cost/amount payload, không ghi cột giá.
- [x] **Step 4:** GREEN unit/non-admin RPC; sửa nội dung/ảnh nguồn cũ rồi reload không mất. Chạy existing workItemRules/resourceRules/legacyCompatibility tests; draft chưa publication/evidence.
- [x] **Step 5:** Commit `feat(daily-log): capture physical quantities with safe source saves`.

Task3 verification/rulings: [quantity checkpoint](../evidence/2026-09-26-daily-log-source-quantity-checkpoint.md). Four additive test-Cloud migrations preserve applied history; PT409 prevents REST infinite retry; existing canonical leaf rules determine over-completion, not an invented task field. Safe incomplete drafts retained separately; submit completeness belongs to Task4. No ERP UI completion claim.

### Task 4: Khép vòng trả đúng phiếu → kỹ sư sửa → gửi lại

**Files:** Modify `lib/dailyLogWbsService.ts`, `lib/dailyLogWorkflow.ts`; create `lib/__tests__/dailyLogSourceReturnResubmit.test.ts`, `lib/__tests__/dailyLogSourceReturnResubmitMigration.test.ts`, `supabase/tests/daily_log_source_return_resubmit_smoke.sql`. Migration suffix `daily_log_source_return_resubmit_v2`.

**Interfaces:**
- `returnSource({ commandId, dailyLogId, summarySourceId, contributionId, expectedSummaryUpdatedAt, expectedRowVersion, reason }): Promise<DailyLogSourceTransitionReceipt>` → `return_daily_log_source_v2(p_input jsonb)`.
- `submitSource({ commandId, contributionId, expectedRowVersion }): Promise<DailyLogSourceTransitionReceipt>` → `submit_daily_log_source_v2(p_input jsonb)`; initial send/resubmit chung command.
- Receipt `{ contributionId: string; status: 'submitted'|'returned'; rowVersion: number; updatedAt: string; sourceFingerprint: string; dailyLogId?: string; summaryUpdatedAt?: string }`, private idempotency Task2.
- Return actions: verify→người tổng hợp, approve→CHT, scope room đúng; owner sửa draft/returned và submit own only. Trả bản tổng hợp giữ command riêng hiện có.

- [x] **Step 1 — RED:** Non-admin CHT trả phiếu A, B không đổi; người tổng hợp đúng scope trả được; tác giả chỉ gửi lại phiếu của mình; reader bị từ chối. Sai cặp source–summary, lý do trống, version cũ hoặc kỳ khóa đều reject. Source gắn bất kỳ hồ sơ verified còn hiệu lực không được trả. Retry có một receipt, duyệt–trả đồng thời không tạo nửa trạng thái.
- [x] **Step 2:** Run new unit/migration tests RED; SQL Cloud smoke ghi fingerprints/counts trước thao tác, không admin/service_role bypass làm bằng chứng.
- [x] **Step 3 — GREEN:** Transaction source→returned cùng reason/actor/time; summary source→change_requested/comment; pending summary→rejected. Không đổi nội dung/nguồn lực gốc hoặc verified snapshot. Pending summary khác giữ snapshot và bị chặn do returned/fingerprint. Lock logs theo ID→sources theo ID→contribution; save nguồn chỉ lock contribution, không khóa ngược log. Trigger support hẹp sau cutover, không fallback quyền legacy rộng. Submit validate completeness/provider/forecast/version, giữ reviewComment trước summary refresh.
- [x] **Step 4:** Cloud retry/concurrency/auth tests GREEN; A returned, B không đổi; source đã verified bị deny; gửi lại tăng version, chưa tạo evidence. Existing publication/revision/Room security tests pass. Browser WBS không `.update(status)` trực tiếp. Backend chặn bypass v2; wiring editor/workspace thực hiện tại Tasks5–7, không kết luận ERP UI đã xong.
- [x] **Step 5:** Commit `feat(daily-log): close scoped source return and resubmit workflow`.

Evidence: [Task4 checkpoint](../evidence/2026-09-27-daily-log-source-return-resubmit-checkpoint.md).

### Task 5: Phiếu kỹ sư — layout bảng và action theo trạng thái

**Files:** Modify `components/project/daily-log/DailyLogContributionWorkEditor.tsx`, `components/project/daily-log/DailyLogWorkItemTable.tsx`, `components/project/daily-log/DailyLogResourceEditor.tsx`, các điểm WBS trong `pages/project/DailyLogTab.tsx`; extend editor/picker/header tests.

**Interfaces:** Consumes Tasks1–4. Editor chọn contributionId rõ; row mang entryMode/enteredValue/baselineQuantityState/workBoqItemId/baselineFingerprint. Save nguồn mới=createSource→saveSourceDocument; nguồn có sẵn luôn save whole metadata. Submit chỉ sau save receipt thành công, version lấy receipt, commandId giữ qua retry cho tới khi xác định kết quả.

- [x] **Step 1 — RED:** Test khối lượng hôm nay là đầu vào chính khi đủ căn cứ; đổi mode không tạo hai input mâu thuẫn; lý do trả sửa/nút gửi lại rõ; submitted chỉ đọc; note/photo cũ không mất. Nháp rỗng lưu được nhưng chưa gửi được; lỗi giữ dữ liệu; chi tiết nguồn lực đúng WBS; chuyển A/B không mang draft A sang B.
- [x] **Step 2:** Run editor tests và targeted browser interaction RED; không chỉ renderToStaticMarkup để kết luận click/save hoạt động.
- [x] **Step 3 — GREEN:** Header/metadata thẳng hàng, nhóm cột khối lượng, WBS sticky, dòng con nguồn lực, chi tiết forecast/note/ảnh. Picker tạo khu vực thứ hai, không fallback phiếu mới nhất. Busy/lỗi đúng field, focus tới lỗi. Mobile card từng hạng mục, không ép bảng desktop nhỏ. Nút lưu nguồn legacy chỉ trong nhánh legacy. Phiếu đã gửi/đã trả cho thấy đúng hành động tiếp theo.
- [x] **Step 4:** Tests GREEN và Cloud save/reload A/B; kiểm tra số thập phân, tên dài, lỗi provider và metadata. Walkthrough sơ bộ desktop 1440/tablet 768/mobile 390; baseline null không thành 0; typecheck.
- [x] **Step 5:** Commit `feat(daily-log): redesign engineer slips around daily work`.

Evidence: `docs/superpowers/evidence/2026-09-27-daily-log-engineer-slip-checkpoint.md`.

### Task 6: Tổng hợp theo phiếu; chốt tiến độ là xử lý ngoại lệ

**Files:** Modify `components/project/daily-log/DailyLogSummaryWorkspace.tsx`, `components/project/daily-log/DailyLogAreaCard.tsx`, `components/project/daily-log/DailyLogConsolidatedWbsTable.tsx`, `components/project/daily-log/DailyLogSourceDiff.tsx`, WBS summary integration trong `pages/project/DailyLogTab.tsx`; extend workspace/picker tests.

**Interfaces:** Tổng vật lý Task 1, picker chọn nhiều Task 2, returnSource Task 4. Workspace thêm selected contribution IDs rõ ràng/onReturnSource cùng concurrency values Task 4; saveSummary/submitSummary entrypoints giữ nguyên. AreaCard render reviewComment/reviewStatus riêng sourceState; nhóm resource bằng dailyLogWorkItemId; mặc định thu gọn, blocker tự mở đúng card.

- [x] **Step 1 — RED:** Chọn 2/3 không sửa nguồn bị bỏ; tổng unique WBS/giờ đúng; nhận xét đã lưu hiển thị. Source gửi lại không tự ghi đè adjusted snapshot; nguồn lực/ảnh đúng item; hai 30% không thành 60%. Không thông báo đủ kỹ sư khi chưa biết danh sách phải báo cáo. Quyết định chưa chốt có thể lưu nháp an toàn nhưng không gửi.
- [x] **Step 2:** Run workspace/picker tests RED với fixture nhiều WBS/provider, không chỉ mỗi source một item.
- [x] **Step 3 — GREEN:** Tổng quan→chọn phiếu→source cards 2 cột desktop/1 cột mobile→ngoại lệ→kết quả tổng hợp dễ đọc. Sự cố/ảnh/ngày sau theo dữ liệu thật. Nút **Trả phiếu cho kỹ sư** có lý do; **Bỏ khỏi bản tổng hợp** không xóa nguồn. Source gửi lại mở diff/refresh có chủ đích. Chỉnh bản sao có lý do, quantity/forecast nhất quán, original không đổi. Quyết định đã chốt dùng nền trung tính; cách chốt/lý do mở rộng. Tổng người/máy ghi lượt theo hạng mục, không tạo unique headcount giả.
- [x] **Step 4:** Tests GREEN và Cloud chọn–bỏ–trả–refresh; summary chỉ selected IDs; giữ original fingerprints khi chỉnh bản sao; unresolved chặn gửi nhưng cho lưu nháp an toàn; typecheck.
- [x] **Step 5:** Commit `feat(daily-log): make daily consolidation source-slip driven`. Phạm vi backend nháp được anh cho phép bổ sung; [checkpoint kiểm chứng](../evidence/2026-09-27-daily-log-summary-slip-ux-checkpoint.md). Task 7/8 và nghiệm thu người dùng vẫn chưa hoàn tất.

### Task 7: CHT xem báo cáo; phiếu đã duyệt không còn form

**Files:** Create `components/project/daily-log/DailyLogWorkItemReadTable.tsx`, `lib/__tests__/dailyLogWorkItemReadTable.test.tsx`; modify workspace/area/consolidated/revision components cùng directory và viewer WBS trong `pages/project/DailyLogTab.tsx`; extend workspace/revision tests.

**Interfaces:** Readtable `{ items: DailyLogWorkItem[], resources: SummaryResourceLine[], mode: 'review'|'verified' }`, no mutation props. Consumes Tasks1/4/6. Viewer passes permissions/status/rollout; publishSummary/createSummaryRevision hiện có không đổi.

- [x] **Step 1 — RED:** Review không có quantity/percent input/select; verified không có submit/return/delete. Quyết định đã chốt là lịch sử, không cảnh báo cần làm. CHT trả đúng source và bắt buộc nhận xét. Pilot không dùng nhãn công bố chính thức; false publication receipt giữ review. Unit unknown không biến 30 thành m³; reader không có mutation; ngày khóa đi revision/reopen hiện có.
- [x] **Step 2:** Run readtable/workspace/revision tests RED. Pending review được có ô nhận xét nhưng không có trường sửa khối lượng; verified không có mutation form.
- [x] **Step 3 — GREEN:** Báo cáo tách editor, tổng quan trước. Header **Bản tổng hợp thi công ngày**; người duyệt/thời gian có thật hoặc unknown, không suy từ updatedAt. Trả summary và trả source là hai action khác nhau; trạng thái nguồn ở chi tiết. Fixture verified thiếu unit giữ unknown và thông báo chất lượng dữ liệu, không backfill. Pilot/publication/revision giữ đúng quyền/receipt.
- [x] **Step 4:** Tests GREEN và viewer ERP thật pending–verified bằng CHT/reader, unknown/revision/ngày khóa; legacy viewer và provider/sourceHref evidence không đổi; typecheck.
- [x] **Step 5:** Commit `feat(daily-log): separate commander review from editable forms`. Bổ sung migration V2 gửi lại bản tổng hợp được anh cho phép riêng; [checkpoint](../evidence/2026-09-27-daily-log-commander-report-ux-checkpoint.md). Task 8/nghiệm thu và release vẫn riêng.

### Task 8: Nghiệm thu ERP thật, responsive walkthrough và hướng dẫn

**Files:** Create `tests/e2e/daily-log-user-centered-workflow.spec.ts`, `tests/e2e/daily-log-user-centered-layout.spec.ts`, `tests/daily-log/ux-cloud-playwright.config.ts`, `tests/daily-log/ux-test-sessions.mjs`, `docs/superpowers/evidence/2026-09-26-daily-log-user-centered-ux-acceptance.md`; update hướng dẫn hiện có, giữ lịch sử rà soát.

**Interfaces:** Route thật `/#/da?projectId=DL-WBS-PILOT-20260925&tab=dailylog`; config Cloud một worker, reuseExistingServer true cho dev 4197 đúng target. Dedicated sessions từ root `.env`, guard baseline exact; tạo non-admin author A/B, summarizer, CHT, reader, denied với scope tối thiểu. Không reset admin/password persona cũ; secrets chỉ trong memory; browser dùng anon+session, không service_role. Không tạo Cloud project mới. Nếu test enforced, dùng fixture scope cô lập trên baseline được phép test; không đổi scope admin preview pilot→enforced.

- [ ] **Step 1 — RED:** E2E ERP thật: tác giả A có khu A+C, tác giả B có khu B; gửi→chọn→CHT trả A có lý do→A sửa khối lượng/metadata/nguồn lực và gửi lại→C/B không đổi→tổng hợp diff/refresh/gửi→CHT shadow hoặc enforced đúng scope→reader chỉ đọc/denied. Assert lineage/version/comments, evidence draft=0, receipt không duplicate. Raw RPC sai owner/scope bị deny dù UI ẩn. Layout tests tên/lý do dài, focus/lỗi, overflow và nút cuối.
- [ ] **Step 2:** Chạy targeted E2E RED. Phân biệt lỗi workflow với bootstrap/preload ngoài scope; không skip hoặc cấp global grant để pass.
- [ ] **Step 3 — GREEN:** Chỉ sửa điểm nối còn thiếu trong Tasks 1–7/config fixture. Chụp screenshots author/summary/review/verified/returned tại 1440×900, 1024×768, 768×1024, 390×844, 360×800, light/dark. Kiểm tra keyboard/tab/focus, target 44px, safe-area; bàn phím mobile thực tế hoặc ghi hạn chế giả lập. Không chỉnh global CSS.
- [ ] **Step 4:** `npm run test`, `npm run lint`, `npm run build`, `npm run check:supabase-migrations`, `npm run check:supabase-queries`; nếu inventory đổi, review chỉ entries Daily Log. Cloud SQL smokes Tasks 2–4 và `npx playwright test --config tests/daily-log/ux-cloud-playwright.config.ts`. Không lỗi bất ngờ trong flow; shell issues ngoài scope ghi finding. Người dùng thật kiểm tra khoảng 5 giây có nhận ra phiếu/trạng thái/action, không tự đánh dấu đạt bằng test count. Evidence ghi commands/output/screenshots/versions/quyền/giới hạn.
- [ ] **Step 5:** Commit `test(daily-log): verify user-centered Cloud workflow and responsive UI`.

## Completion Gate

- [ ] Tasks 1–8 qua tests và scoped commits; không skip để tránh thiếu workflow.
- [ ] Vòng gửi→tổng hợp→trả đúng phiếu→sửa/gửi lại→refresh→CHT được thao tác ERP thật bằng non-admin.
- [ ] Unknown≠0, A/B cùng author không nhầm, overlap percent không auto60%, counts không unique giả.
- [ ] Confirmed summary là báo cáo; legacy/evidence Plan 2 và lineage không regress; không tiền.
- [ ] Responsive/style/accessibility walkthrough có ảnh/nhận xét; không chỉ functional test pass.
- [ ] Anh trải nghiệm/xác nhận hiểu action; nếu chưa thì “chờ nghiệm thu”, không gọi UX hoàn tất.
- [ ] Diff/SQL guards chứng minh không chạm V2/Procurement/BOQ/HRM/global theme; production ledger/rollout không đổi.
- [ ] Guide theo nút thật/giới hạn thật; không thông báo pilot đã công bố.
- [ ] Release/merge/deploy gates trước đây vẫn riêng; plan không cho phép vượt qua.

## Tự rà soát

Mapping: intent→Tasks 5–7; hierarchy/style tham khảo→Tasks 1/5/6/7; quantities/unknown→Task 3; nhiều khu vực→Task 2; trả sửa/auth/concurrency→Task 4; chỉ đọc/revision→Task 7; responsive/Cloud/acceptance→Task 8. Interfaces giữ cùng contributionId/summarySourceId/expectedRowVersion/expectedSummaryUpdatedAt/commandId. Mỗi task có RED/GREEN/verify/commit, không sửa migration cũ. Hai bổ sung về nhập hôm nay/trả nguồn đã được duyệt cùng thiết kế; completion/release gates vẫn giữ nguyên.

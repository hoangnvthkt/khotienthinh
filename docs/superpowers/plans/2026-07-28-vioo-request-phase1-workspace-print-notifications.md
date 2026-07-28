# Vioo Request Phase 1 — Request Workspace, Print and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa lõi phê duyệt vào giao diện sử dụng thực tế: tạo phiếu, danh sách/chi tiết theo bố cục Base × Vioo thích ứng, duyệt tự động, deep link, in PDF/DOCX và thông báo có thể truy vết.

**Architecture:** `RequestContext` chỉ giữ cache nhẹ, summary và realtime invalidation; truy vấn phân trang/detail đi qua `requestRuntimeService`. Route `/rq/:requestId` là định danh chuẩn. UI gửi command bằng RPC, áp dụng command result do server trả rồi refresh detail; in và notification tách thành service riêng, không nhúng vào page.

**Tech Stack:** React 18, TypeScript 5.8, React Router 7, Supabase JS 2.98, Vitest 4, Playwright 1.55, PizZip, Docxtemplater.

**Depends on:**

- Gate R6 của [Runtime Foundation](./2026-07-28-vioo-request-phase1-runtime-foundation.md).
- Gate T5 của [Template Administration](./2026-07-28-vioo-request-phase1-template-admin.md).

## Scope Guard

- Bố cục desktop ưu tiên 3 vùng: điều hướng ngữ cảnh, danh sách phiếu, chi tiết; màn rộng có inspector duyệt bên phải.
- Tablet thu gọn điều hướng, mobile dùng list → detail riêng; không ép bảng desktop vào mobile.
- Chỉ người có quyền server xác nhận mới xem được deep link.
- Không dùng query string `?requestId=` làm URL chuẩn; chỉ đọc và redirect để tương thích.
- Không ghi trực tiếp `request_instances`, assignment hoặc log từ client.
- Không giữ tính năng task/link/discussion cũ trong Giai đoạn 1.
- Notification transaction chỉ ghi outbox; delivery chạy tách biệt và có idempotency.

## Delivery Gates

| Gate | Điều kiện qua gate |
| --- | --- |
| W0 | Query hooks dùng cursor và hủy stale request |
| W1 | Tạo phiếu resolve người duyệt linh động và mở đúng deep link |
| W2 | Danh sách/detail responsive khớp bố cục đã duyệt |
| W3 | Approve/reject/return/resubmit/cancel chạy đúng quyền và concurrency |
| W4 | Browser/PDF và DOCX in đúng dữ liệu snapshot, có audit |
| W5 | Notification deep link, outbox retry và quyền truy cập hoạt động |
| W6 | Dashboard/consumer cũ tương thích; E2E và runbook hoàn tất |

## File Map

**Data and state**

- Create `hooks/useRequestList.ts`
- Create `hooks/useRequestDetail.ts`
- Modify `context/RequestContext.tsx`
- Create `lib/__tests__/requestQueryState.test.ts`

**Workspace**

- Rewrite `pages/request/RequestList.tsx`
- Create `components/request/RequestContextNav.tsx`
- Create `components/request/RequestTable.tsx`
- Create `components/request/RequestMasterList.tsx`
- Create `components/request/RequestDetailPanel.tsx`
- Create `components/request/RequestApprovalInspector.tsx`
- Create `components/request/RequestActionBar.tsx`
- Create `components/request/RequestCreateDialog.tsx`
- Modify `App.tsx`

**Print**

- Create via CLI migration `request_print_audit_phase1`
- Create `lib/requestPrintService.ts`
- Create `lib/__tests__/requestPrintService.test.ts`
- Create `components/request/RequestPrintPreview.tsx`

**Notifications**

- Create via CLI migration `request_notification_delivery_phase1`
- Create `supabase/functions/process-request-notifications/index.ts`
- Create `supabase/functions/_shared/requestNotificationDelivery.ts`
- Create `lib/__tests__/requestNotificationDeliveryContract.test.ts`
- Create `lib/__tests__/requestNotificationRoute.test.ts`
- Modify `lib/notificationRoutes.ts`
- Modify `components/NotificationCenter.tsx`

**Compatibility and QA**

- Modify `pages/request/RequestDashboard.tsx`
- Modify `pages/EmployeeDashboard.tsx`
- Modify `pages/CustomDashboard.tsx`
- Modify `pages/Home.tsx`
- Modify `components/CommandPalette.tsx`
- Create `playwright.config.ts`
- Create `e2e/request-approval-phase1.spec.ts`
- Create `docs/runbooks/request-approval-phase1-rollout.md`

---

### Task 1: Replace Bulk Context Loading with Cursor Query Hooks

**Files:**

- Create: `hooks/useRequestList.ts`
- Create: `hooks/useRequestDetail.ts`
- Modify: `context/RequestContext.tsx`
- Create: `lib/__tests__/requestQueryState.test.ts`

**Interfaces:**

```ts
export interface RequestListFilter {
  view: 'ALL' | 'ASSIGNED_TO_ME' | 'CREATED_BY_ME' | 'WATCHING';
  status?: 'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  overdue?: boolean;
  templateId?: string;
  search?: string;
}

export interface UseRequestListResult {
  items: RequestListItem[];
  nextCursor: { createdAt: string; id: string } | null;
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
}
```

- [ ] **Step 1: Viết RED cho query state thuần**

```ts
import { describe, expect, it } from 'vitest';
import { mergeRequestPage, requestQueryKey } from '../requestQueryState';

it('deduplicates overlapping cursor pages and preserves server order', () => {
  expect(mergeRequestPage(
    [{ id: 'r2' }, { id: 'r1' }],
    [{ id: 'r1' }, { id: 'r0' }],
  ).map(item => item.id)).toEqual(['r2', 'r1', 'r0']);
});

it('normalizes filter keys independent of object insertion order', () => {
  expect(requestQueryKey({ view: 'ALL', status: 'PENDING' }))
    .toBe(requestQueryKey({ status: 'PENDING', view: 'ALL' }));
});
```

- [ ] **Step 2: Implement `lib/requestQueryState.ts`**

`requestQueryKey` trim search và serialize key theo thứ tự cố định. `mergeRequestPage` deduplicate theo UUID, không sort lại dữ liệu server.

- [ ] **Step 3: Implement `useRequestList`**

- Debounce search 300 ms.
- Mỗi filter change tăng `requestToken`; response cũ không được ghi state.
- Page size 40; gọi `requestRuntimeService.list({ filter, cursor, limit: 40 })`.
- `refresh` tải lại trang đầu và giữ row đang chọn nếu còn tồn tại.
- Không load toàn bộ bảng và không `.limit(300)`.

- [ ] **Step 4: Implement `useRequestDetail`**

- Không có `requestId` thì state idle.
- Gọi `requestRuntimeService.getDetail`.
- `NOT_FOUND_OR_FORBIDDEN` cùng hiển thị một màn không tiết lộ sự tồn tại.
- Có `refresh` và nhận snapshot trả về sau command.

- [ ] **Step 5: Slim `RequestContext`**

Context chỉ cung cấp:

```ts
interface RequestContextValue {
  templates: RequestTemplateSummary[];
  summary: RequestSummary;
  reloadTemplates(): Promise<void>;
  reloadSummary(): Promise<void>;
  subscribeToRequestInvalidation(listener: (requestId: string) => void): () => void;
}
```

Realtime event chỉ phát invalidation cho ID; hooks đang mở tự refetch. Xóa hàm direct write `approveRequest`, `rejectRequest`, `returnRequest`, `submitRequest` legacy sau khi consumer đã chuyển ở Task 8.

- [ ] **Step 6: Chạy test**

Run: `npx vitest run lib/__tests__/requestQueryState.test.ts lib/__tests__/requestRuntimeService.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add hooks/useRequestList.ts hooks/useRequestDetail.ts context/RequestContext.tsx \
  lib/requestQueryState.ts lib/__tests__/requestQueryState.test.ts
git commit -m "refactor(request): add cursor query state"
```

---

### Task 2: Add Canonical Deep-Link Routing and Create Request Flow

**Files:**

- Modify: `App.tsx`
- Create: `components/request/RequestCreateDialog.tsx`
- Create: `lib/__tests__/requestDeepLinkContract.test.ts`
- Modify: `pages/request/RequestList.tsx`

- [ ] **Step 1: Viết route contract RED**

```ts
it('registers the canonical request detail route', () => {
  const app = readFileSync('App.tsx', 'utf8');
  expect(app).toContain('path="rq/:requestId"');
});
```

Thêm test `buildRequestRoute('uuid-1') === '/rq/uuid-1'`.

- [ ] **Step 2: Add route helper**

```ts
export const buildRequestRoute = (requestId: string): string =>
  `/rq/${encodeURIComponent(requestId)}`;
```

Đặt trong `lib/requestRoutes.ts`, dùng chung cho notification, copy link và navigate.

- [ ] **Step 3: Add canonical route**

```tsx
<Route path="rq" element={<RequestList />} />
<Route path="rq/:requestId" element={<RequestList />} />
```

Khi `/rq?requestId=4f7d8a6e-0ad8-4b67-a89e-bc594db659af` hợp lệ, dùng `<Navigate replace>` sang `/rq/4f7d8a6e-0ad8-4b67-a89e-bc594db659af`; bỏ query parameter cũ. Không fetch trước khi redirect.

- [ ] **Step 4: Build create dialog**

Flow:

1. Chọn một template published user được quyền dùng.
2. Render field theo snapshot template.
3. Với mỗi block `DYNAMIC_CREATOR_SELECT`, người tạo @mention người dùng active trong cùng công ty.
4. Validate số lượng tối thiểu và không trùng người.
5. Upload attachment trước; payload chỉ chứa path/metadata.
6. Gọi `requestRuntimeService.submit`.
7. Navigate đến `buildRequestRoute(result.requestId)`.

Picker dynamic không tự giới hạn trong phòng ban vì yêu cầu đã duyệt là bất kỳ nhân viên trong công ty; backend vẫn kiểm tra active/company.

- [ ] **Step 5: Add idempotent submit**

Tạo `clientRequestId = crypto.randomUUID()` khi mở dialog, giữ nguyên qua retry. Disable nút gửi khi request đang chạy; nếu timeout, retry cùng key và backend trả cùng request.

- [ ] **Step 6: Chạy test**

Run: `npx vitest run lib/__tests__/requestDeepLinkContract.test.ts lib/__tests__/requestRuntimeService.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add App.tsx pages/request/RequestList.tsx components/request/RequestCreateDialog.tsx \
  lib/requestRoutes.ts lib/__tests__/requestDeepLinkContract.test.ts
git commit -m "feat(request): add create flow and deep links"
```

---

### Task 3: Build the Base × Vioo Adaptive List Workspace

**Files:**

- Rewrite: `pages/request/RequestList.tsx`
- Create: `components/request/RequestContextNav.tsx`
- Create: `components/request/RequestTable.tsx`
- Create: `components/request/RequestMasterList.tsx`
- Create: `lib/__tests__/requestWorkspaceContract.test.ts`

- [ ] **Step 1: Viết source contract test RED**

Test xác nhận:

- Workspace dùng `RequestContextNav`, `RequestTable`, `RequestMasterList`.
- Filter trạng thái gồm tất cả, quá hạn, chờ duyệt, đã chấp thuận, đã từ chối, đã trả lại.
- Không còn import `PizZip`, `Docxtemplater` hoặc gọi Supabase trực tiếp trong page.

- [ ] **Step 2: Build contextual navigation**

Nhóm:

- Tất cả.
- Gửi đến tôi.
- Tôi gửi đi.
- Đang theo dõi.
- Quan trọng.
- Danh sách template được user đánh dấu.

Desktop rộng 184–216 px; ở dưới 1280px thu gọn thành icon rail; dưới 768px mở bằng drawer.

- [ ] **Step 3: Build desktop table**

Các cột:

- Checkbox/đánh dấu.
- Tiêu đề + một dòng tóm tắt.
- Trạng thái.
- Người tạo.
- Tiến trình người duyệt dạng avatar/status.
- Ngày cập nhật.

Header sticky, row cao 44–52 px, load more bằng sentinel nhưng luôn giữ nút “Tải thêm” cho accessibility. Click row navigate deep link; không nhét detail state vào URL query.

- [ ] **Step 4: Build master list**

Ở chế độ detail desktop hoặc tablet, dùng danh sách giữa rộng 300–360 px: tiêu đề, template, creator, time và chấm trạng thái. Row active dùng màu thương hiệu Vioo vừa đủ, không sao chép màu tím Base nguyên bản.

- [ ] **Step 5: Responsive mode switching**

```ts
export type RequestWorkspaceMode =
  | 'DESKTOP_TABLE'
  | 'DESKTOP_MASTER_DETAIL'
  | 'MOBILE_LIST'
  | 'MOBILE_DETAIL';

export const getRequestWorkspaceMode = (
  width: number,
  hasSelection: boolean,
): RequestWorkspaceMode => {
  if (width < 768) return hasSelection ? 'MOBILE_DETAIL' : 'MOBILE_LIST';
  if (hasSelection) return 'DESKTOP_MASTER_DETAIL';
  return 'DESKTOP_TABLE';
};
```

Viết unit test ở các mốc 767, 768, 1279, 1280; không đọc `window.innerWidth` trực tiếp trong render, dùng hook media query.

- [ ] **Step 6: Chạy test và visual manual check**

Run: `npx vitest run lib/__tests__/requestWorkspaceContract.test.ts && npm run lint`

Manual: 1440×900, 1024×768, 390×844; không overflow ngang ngoài bảng desktop.

- [ ] **Step 7: Commit**

```bash
git add pages/request/RequestList.tsx components/request/RequestContextNav.tsx \
  components/request/RequestTable.tsx components/request/RequestMasterList.tsx \
  lib/__tests__/requestWorkspaceContract.test.ts
git commit -m "feat(request): build adaptive request workspace"
```

---

### Task 4: Build Detail, Approval Inspector and Safe Action Bar

**Files:**

- Create: `components/request/RequestDetailPanel.tsx`
- Create: `components/request/RequestApprovalInspector.tsx`
- Create: `components/request/RequestActionBar.tsx`
- Create: `lib/requestActionAvailability.ts`
- Create: `lib/__tests__/requestActionAvailability.test.ts`

- [ ] **Step 1: Viết action matrix test RED**

```ts
expect(getRequestActions({
  status: 'PENDING',
  canApprove: true,
  isCreator: false,
})).toEqual(['APPROVE', 'REJECT', 'RETURN']);

expect(getRequestActions({
  status: 'RETURNED',
  canApprove: false,
  isCreator: true,
})).toEqual(['RESUBMIT', 'CANCEL']);

expect(getRequestActions({
  status: 'PENDING',
  canApprove: false,
  canReassign: true,
  isCreator: false,
})).toEqual(['REASSIGN']);
```

Thêm các case terminal không có action, creator pending chỉ được `CANCEL` khi server flag cho phép, watcher chỉ read-only.

- [ ] **Step 2: Build detail body**

Hiển thị:

- Tiêu đề, mã `RQ-YYYY-NNNNNN`, status, copy link, in.
- Metadata: người tạo, mẫu/version, thời gian tạo/cập nhật.
- Field snapshot theo thứ tự.
- Attachment có kiểm tra signed URL.
- Lịch sử hành động từ audit event server.

Không render HTML chưa sanitize từ rich text hoặc DOCX.

Nút copy tạo URL tuyệt đối bằng `new URL(buildRequestRoute(detail.id), window.location.origin).toString()`, ghi qua Clipboard API và báo toast; không chép token/quyền hoặc dữ liệu form vào URL.

- [ ] **Step 3: Build approval inspector**

Mỗi block hiển thị tên, SLA/due time, approver snapshot và trạng thái. Với sequential, block sau ở trạng thái “Chưa kích hoạt”; với parallel, các block active cùng lúc. Có timeline event, nhưng không tự suy diễn trạng thái từ log client.

- [ ] **Step 4: Build action bar**

`APPROVE`, `REJECT`, `RETURN`, `RESUBMIT`, `CANCEL`, `REASSIGN` đều:

- Có comment dialog; reject/return bắt buộc lý do.
- Dùng `clientActionId` UUID mới cho mỗi ý định.
- Gửi `expectedUpdatedAt` từ detail.
- Disable trong khi chạy.
- Nhận status/block/`updatedAt` mới từ `requestRuntimeService.act`, cập nhật header rồi refresh detail để lấy snapshot đầy đủ.
- `VERSION_CONFLICT` refetch rồi báo người dùng; không retry tự động bằng version cũ.

`REASSIGN` chỉ hiện theo capability server, bắt buộc chọn user active cùng công ty và lý do; dialog hiển thị rõ approver cũ, approver mới và block/round được giữ nguyên.

- [ ] **Step 5: Add stale realtime behavior**

Nếu invalidation đến khi dialog đang mở, hiển thị banner “Phiếu đã thay đổi”; nút xác nhận bị khóa cho đến khi refetch. Không đóng dialog và mất comment người dùng đã nhập.

- [ ] **Step 6: Chạy test**

Run: `npx vitest run lib/__tests__/requestActionAvailability.test.ts lib/__tests__/requestRuntimeService.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/request/RequestDetailPanel.tsx \
  components/request/RequestApprovalInspector.tsx \
  components/request/RequestActionBar.tsx lib/requestActionAvailability.ts \
  lib/__tests__/requestActionAvailability.test.ts
git commit -m "feat(request): add request detail approval actions"
```

---

### Task 5: Extract Browser/PDF and DOCX Printing

**Files:**

- Create via CLI: migration `request_print_audit_phase1`
- Create: `lib/requestPrintService.ts`
- Create: `lib/__tests__/requestPrintService.test.ts`
- Create: `components/request/RequestPrintPreview.tsx`
- Modify: `pages/request/RequestList.tsx`

**Interface:**

```ts
export interface RequestPrintDocument {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface RequestPrintService {
  buildBrowserPrintModel(detail: RequestDetail): RequestPrintModel;
  renderDocx(detail: RequestDetail, templateBytes: ArrayBuffer): Promise<RequestPrintDocument>;
  recordExportAudit(input: {
    requestId: string;
    format: 'PRINT' | 'PDF' | 'WORD';
    result: 'SUCCEEDED' | 'FAILED';
    errorMessage?: string;
    clientActionId: string;
  }): Promise<void>;
}
```

- [ ] **Step 1: Tạo migration và viết RED cho token projection**

Run: `npx supabase migration new request_print_audit_phase1`

Expected: CLI in đúng đường dẫn migration; dùng chính file đó.

```ts
it('projects stable scalar and custom-field tokens', () => {
  expect(buildRequestPrintTokens(detail)).toMatchObject({
    code: 'RQ-2026-000001',
    title: 'Đề xuất mua máy tính',
    field_amount: '25000000',
  });
});

it('sanitizes the downloaded filename', () => {
  expect(buildRequestPrintFileName('RQ-2026-000001', 'Mua máy / văn phòng'))
    .toBe('RQ-2026-000001-Mua-may-van-phong.docx');
});
```

- [ ] **Step 2: Move DOCX logic out of the page**

Chuyển `PizZip`, `Docxtemplater` và mapping token từ `RequestList.tsx` sang service. Không chuyển logic `signatureUrl`/image module của request cũ vì chữ ký điện tử ngoài phạm vi Giai đoạn 1; approval summary chỉ dùng tên, kết quả, ý kiến và thời điểm. Giữ delimiter tương thích `${token}`; custom field dùng tiền tố như `${field_amount}` để không đụng token hệ thống. Template bytes tải qua signed URL ngắn hạn. Không log token values vì có thể chứa dữ liệu nhạy cảm.

Migration tạo `app_private.record_request_export_audit(...)` và public wrapper `security invoker`. RPC tự lấy actor từ auth, kiểm `request_instance_can_select`, validate format/result, ghi `app_private.request_export_audit` và deduplicate theo `(actor_id, client_action_id)`.

- [ ] **Step 3: Build browser print preview**

`RequestPrintPreview` cho người dùng chọn “In” hoặc “Lưu PDF” rồi dùng stylesheet riêng:

```css
@media print {
  body * { visibility: hidden; }
  [data-request-print-root],
  [data-request-print-root] * { visibility: visible; }
  [data-request-print-root] {
    position: absolute;
    inset: 0;
    color: #111827;
    background: #fff;
  }
  [data-no-print] { display: none !important; }
}
```

Khổ A4, header Vioo, mã phiếu, field và approval summary theo tên/kết quả/ý kiến/thời điểm; không hiển thị ảnh chữ ký điện tử.

- [ ] **Step 4: Record audit**

Mỗi lần thực hiện gọi `recordExportAudit`: `PRINT` hoặc `PDF` khi mở browser print theo lựa chọn người dùng; `WORD` khi dựng DOCX. Ghi `SUCCEEDED` khi document/dialog được tạo và `FAILED` khi validate/render lỗi. Nếu ghi audit thất bại, báo lỗi và không download để đảm bảo truy vết. Browser không xác nhận được người dùng đã thực sự in/lưu nên UI ghi rõ audit phản ánh thao tác đã khởi tạo thành công.

- [ ] **Step 5: Chạy test**

Run: `npx vitest run lib/__tests__/requestPrintService.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 6: Manual print acceptance**

- Browser print preview A4 không cắt tiêu đề/table.
- Save as PDF giữ tiếng Việt.
- DOCX mở được trong Word, token không tồn tại hiển thị rỗng có cảnh báo trước tải.
- DOCX lỗi vẫn giữ nút dùng bản in/PDF chuẩn.
- User không có quyền xem phiếu không lấy được template/data in.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations lib/requestPrintService.ts lib/__tests__/requestPrintService.test.ts \
  components/request/RequestPrintPreview.tsx pages/request/RequestList.tsx
git commit -m "feat(request): add audited request printing"
```

---

### Task 6: Add Transactional Notification Outbox and Canonical Routes

**Files:**

- Create via CLI: migration `request_notification_delivery_phase1`
- Create: `supabase/functions/process-request-notifications/index.ts`
- Create: `supabase/functions/_shared/requestNotificationDelivery.ts`
- Create: `lib/__tests__/requestNotificationDeliveryContract.test.ts`
- Create: `lib/__tests__/requestNotificationRoute.test.ts`
- Modify: `lib/notificationRoutes.ts`
- Modify: `components/NotificationCenter.tsx`
- Consume: outbox enqueue events already emitted by Runtime Foundation commands

- [ ] **Step 1: Viết RED cho route**

```ts
it('routes request approval notifications to the canonical detail URL', () => {
  expect(resolveNotificationPath({
    sourceType: 'request_instance',
    sourceId: 'rq-uuid',
    metadata: { requestInstanceId: 'rq-uuid' },
  } as AppNotification)).toBe('/rq/rq-uuid');
});
```

- [ ] **Step 2: Tạo migration delivery bằng CLI**

Run: `npx supabase migration new request_notification_delivery_phase1`

Expected: CLI in đúng đường dẫn migration; dùng chính file đó.

- [ ] **Step 3: Verify and index the private outbox**

Xác nhận `app_private.request_notification_outbox` từ Runtime Foundation có:

- `id uuid primary key`
- `event_key text unique not null`
- `request_id uuid not null`
- `recipient_user_id uuid not null`
- `event_type text not null`
- `payload jsonb not null`
- `status text check in ('PENDING','PROCESSING','DELIVERED','FAILED')`
- `attempt_count integer default 0`
- `available_at`, `locked_at`, `delivered_at`, `last_error`, timestamps

Migration delivery bổ sung idempotently index partial `(available_at, id) where status in ('PENDING','FAILED')`, index `request_id` và hàm claim; không grant bảng private cho authenticated.

- [ ] **Step 4: Enqueue in the same action transaction**

Mỗi submit/activate/return/approve/reject/reassign tạo event key xác định:

```sql
format(
  'request:%s:event:%s:recipient:%s',
  p_request_id,
  v_audit_event_id,
  v_recipient_user_id
)
```

`insert ... on conflict (event_key) do nothing`. Payload chứa `requestInstanceId`, `requestCode`, `eventType`; không chứa toàn bộ field values.

Migration đồng thời tạo `app_private.enqueue_request_sla_notifications(p_now timestamptz)` chỉ cho `service_role`. Hàm quét request và assignment `PENDING` đang active, tôn trọng notification config của template snapshot và enqueue idempotently hai mốc `SLA_DUE_SOON` và `SLA_OVERDUE`; event key gồm subject ID, round ID nếu có và mốc để mỗi mốc chỉ gửi một lần.

Recipient matrix:

| Event | Người nhận |
| --- | --- |
| `SUBMITTED` | Watcher cố định |
| `ASSIGNED` | Approver vừa được kích hoạt |
| `REASSIGNED` | Approver cũ và approver mới |
| `RETURNED` | Người tạo |
| `APPROVED` / `REJECTED` | Người tạo và watcher cố định |
| `SLA_DUE_SOON` / `SLA_OVERDUE` | Approver active; template manager nhận escalation quá hạn |

Loại actor ra khỏi recipient nếu event không cần self-notification; deduplicate theo user ID trước khi ghi outbox.

- [ ] **Step 5: Implement bounded server-side delivery**

Migration tạo RPC private chỉ cấp cho `service_role` để claim tối đa 50 row bằng `for update skip locked` và đặt `PROCESSING`. Edge Function `process-request-notifications` xác thực cron secret, gọi enqueue SLA trước, dùng service-role client ở server, tạo notification qua đường server hiện có rồi đánh dấu `DELIVERED`. Lỗi tăng attempt, ghi message đã cắt 500 ký tự và exponential backoff tối đa 1 giờ. Sau 10 lần giữ `FAILED` để admin retry. Không import worker hoặc service-role key vào bundle React.

- [ ] **Step 6: Update notification route and center**

Dùng `buildRequestRoute`; notification center kiểm tra access khi click bằng route/detail RPC. Nếu bị thu hồi quyền, hiển thị trang “Không thể truy cập” mà không lộ dữ liệu.

- [ ] **Step 7: Chạy test và Supabase advisors**

Run:

```bash
npx vitest run lib/__tests__/requestNotificationDeliveryContract.test.ts lib/__tests__/requestNotificationRoute.test.ts
npx supabase db reset
npm run smoke:request
npx supabase db lint --local --level warning --fail-on warning
```

Expected: PASS; không có RLS/performance warning mới.

Sau khi migration được push lên Supabase branch/staging, chạy `get_advisors` cho cả `security` và `performance` nếu Supabase MCP khả dụng; nếu không, xuất kết quả hai Advisor từ Dashboard và gắn vào PR.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations supabase/tests supabase/functions/process-request-notifications \
  supabase/functions/_shared/requestNotificationDelivery.ts \
  lib/notificationRoutes.ts components/NotificationCenter.tsx \
  lib/__tests__/requestNotificationDeliveryContract.test.ts \
  lib/__tests__/requestNotificationRoute.test.ts
git commit -m "feat(request): add approval notification outbox"
```

---

### Task 7: Update Dashboards and Legacy Consumers

**Files:**

- Modify: `pages/request/RequestDashboard.tsx`
- Modify: `pages/EmployeeDashboard.tsx`
- Modify: `pages/CustomDashboard.tsx`
- Modify: `pages/Home.tsx`
- Modify: `components/CommandPalette.tsx`
- Modify: `App.tsx`
- Create: `lib/__tests__/requestConsumerContract.test.ts`

- [ ] **Step 1: Inventory direct consumers**

Run:

```bash
rg -n "useRequest\\(|RequestContext|process_request_step|from\\('request_" \
  pages components context lib App.tsx
```

Expected: lưu danh sách vào PR description; sau task không còn direct request write ngoài services.

- [ ] **Step 2: Update dashboard data**

`RequestDashboard` gọi `requestRuntimeService.getSummary`, không tính số liệu từ list giới hạn. Các dashboard tổng hợp dùng summary từ context; card click tới filter tương ứng `/rq?status=PENDING&view=ASSIGNED_TO_ME`, không dùng `requestId` query.

- [ ] **Step 3: Update command palette/home**

- “Tạo yêu cầu” mở `/rq?create=1`.
- Search result request dùng `buildRequestRoute(id)`.
- Chỉ preload templates/summary, không preload 300 request rows.

- [ ] **Step 4: Remove legacy mutation surface**

Sau khi `rg` xác nhận không còn consumer, xóa legacy methods/direct Supabase writes khỏi `RequestContext`. Giữ mapper legacy chỉ khi còn dùng cho dashboard; ghi issue Phase 2 để xóa schema cũ, không drop trong Phase 1.

- [ ] **Step 5: Chạy contract test và full suite**

Run: `npx vitest run lib/__tests__/requestConsumerContract.test.ts && npm test && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pages/request/RequestDashboard.tsx pages/EmployeeDashboard.tsx \
  pages/CustomDashboard.tsx pages/Home.tsx components/CommandPalette.tsx \
  context/RequestContext.tsx App.tsx lib/__tests__/requestConsumerContract.test.ts
git commit -m "refactor(request): migrate request consumers"
```

---

### Task 8: Add End-to-End Coverage and Rollout Runbook

**Files:**

- Create: `playwright.config.ts`
- Create: `e2e/request-approval-phase1.spec.ts`
- Create: `docs/runbooks/request-approval-phase1-rollout.md`
- Modify: `package.json`

- [ ] **Step 1: Add Playwright scripts**

```json
{
  "scripts": {
    "test:e2e:request": "playwright test e2e/request-approval-phase1.spec.ts",
    "smoke:request": "npx supabase test db supabase/tests/request_approval_phase1_smoke.sql"
  }
}
```

Config chạy Chromium, base URL `http://127.0.0.1:4173`, screenshot on failure, trace on first retry. Credentials lấy từ environment test; không commit secret.

- [ ] **Step 2: Write E2E scenarios**

Fixtures tạo:

- Creator, manager, two directors, watcher.
- Template sequential `ALL`: direct manager → directors fixed multi.
- Template parallel `ANY_ONE`.
- Template có dynamic creator select.

Scenarios:

1. Creator submit → manager approve → director approve → completed.
2. First approver reject → whole request rejected.
3. Approver return → creator edit/resubmit → same block resumes, previous block remains approved.
4. Parallel ANY_ONE → one approve → remaining skipped.
5. Dynamic picker tags employee outside creator’s department but same company.
6. Deep link notification opens correct request.
7. Unauthorized user receives non-disclosing access screen.
8. Copy link, browser print and DOCX download.
9. Khóa approver hiện tại → template manager tái gán → approver mới nhận notification và duyệt.

- [ ] **Step 3: Add visual breakpoints**

Chụp ổn định:

- `/rq` at 1440×900.
- Route detail của request fixture at 1440×900.
- Detail at 1024×768.
- List/detail at 390×844.
- Template editor approval section at 1440×900.

Mask avatar/time động; không mask trạng thái hoặc approval steps.

- [ ] **Step 4: Write rollout runbook**

Runbook gồm:

- Thứ tự apply migration.
- Environment/storage bucket cần có.
- Cách tạo template đầu tiên.
- Smoke commands và expected results.
- Feature flag `REQUEST_APPROVAL_PHASE1`.
- Rollout: admin nội bộ → một phòng ban → toàn công ty.
- Monitoring: RPC error rate, outbox backlog/failed, action conflict, request latency.
- Rollback UI bằng flag; database rollback dùng forward migration, không xóa request đã tạo.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
npm run smoke:request
npm run test:e2e:request
git diff --check
```

Expected: mọi command exit 0; không có whitespace error.

- [ ] **Step 6: Security acceptance**

- RLS: creator, active approver, watcher, admin và người ngoài phạm vi.
- Replay cùng `clientActionId` không tạo hai event.
- Hai approve đồng thời không kích hoạt hai lần bước kế.
- Link copy sau khi user bị thu hồi quyền không mở dữ liệu.
- Signed URL attachment/print template hết hạn.
- Outbox payload không chứa nội dung field nhạy cảm.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e/request-approval-phase1.spec.ts \
  docs/runbooks/request-approval-phase1-rollout.md package.json package-lock.json
git commit -m "test(request): cover phase 1 approval rollout"
```

---

## Completion Gate

- [ ] Gate W0–W6 đều có bằng chứng trong PR.
- [ ] Không còn direct client write vào request runtime tables.
- [ ] Không còn URL notification chuẩn dạng `/rq?requestId=`.
- [ ] List 10.000 phiếu vẫn dùng cursor, không tải toàn bộ.
- [ ] Duyệt tuần tự, song song, từ chối, trả lại/gửi lại và dynamic approver đều qua E2E.
- [ ] In, PDF và Word đều có audit event gồm kết quả.
- [ ] Supabase RLS/performance advisors không có warning mới.
- [ ] Product owner nghiệm thu desktop, tablet, mobile trước khi bật flag toàn công ty.

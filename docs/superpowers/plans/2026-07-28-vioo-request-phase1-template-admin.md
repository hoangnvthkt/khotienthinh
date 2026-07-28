# Vioo Request Phase 1 — Template Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cung cấp màn quản trị Mẫu yêu cầu theo bố cục Base × Vioo thích ứng, cho phép cấu hình form, phạm vi sử dụng, khối người duyệt, luồng phê duyệt, người theo dõi, in và thông báo rồi phát hành thành phiên bản bất biến.

**Architecture:** UI chỉnh sửa thao tác trên một `RequestTemplateDraft` thuần TypeScript. Mỗi section chỉ phát `RequestTemplateDraftAction`; validator chung quyết định có được phát hành hay không. Lưu nháp và phát hành gọi `requestTemplateService` từ kế hoạch Runtime Foundation, không ghi trực tiếp Supabase.

**Tech Stack:** React 18, TypeScript 5.8, React Router 7, Lucide React, Vitest 4, Supabase JS 2.98.

**Depends on:** Hoàn tất Gate R2 của [Runtime Foundation](./2026-07-28-vioo-request-phase1-runtime-foundation.md).

## Scope Guard

- Giai đoạn 1 hỗ trợ người duyệt cố định một/nhiều người, quản lý trực tiếp và người duyệt linh động do người tạo chọn.
- Hỗ trợ tuần tự/song song và `ALL`/`ANY_ONE`; không hiển thị điều kiện hoặc nhánh.
- Phạm vi dùng mẫu gồm toàn công ty, phòng ban/đơn vị, nhóm quyền và người dùng cụ thể.
- Mẫu nháp được sửa tự do; phiên bản đã phát hành không sửa tại chỗ.
- Màn cũ `/rq/categories` chỉ giữ làm đường dẫn tương thích và chuyển sang `/rq/templates`.
- Không đưa tác vụ, liên kết, thảo luận, webhook, chữ ký điện tử và bộ đếm vào màn cấu hình Giai đoạn 1.

## Delivery Gates

| Gate | Điều kiện qua gate |
| --- | --- |
| T0 | Draft reducer và validator có unit test xanh |
| T1 | Danh sách mẫu, quyền và route hoạt động |
| T2 | Thông tin chung, phạm vi và form builder lưu nháp được |
| T3 | Approval builder tạo đủ bốn nguồn người duyệt và hai kiểu luồng |
| T4 | Theo dõi, in, thông báo và preview hoàn chỉnh |
| T5 | Publish chặn cấu hình lỗi, tạo version và hiển thị version vừa phát hành |

## File Map

**Domain/editor state**

- Create `lib/requestTemplateEditorModel.ts`
- Create `lib/__tests__/requestTemplateEditorModel.test.ts`

**Pages and routing**

- Create `pages/request/RequestTemplates.tsx`
- Create `pages/request/RequestTemplateEditor.tsx`
- Modify `App.tsx:104-105,215-217`
- Modify `components/Sidebar.tsx:248-250`
- Modify `components/UserModal.tsx:140-142`
- Modify `lib/permissions/erpPermissionRegistry.ts:152-166`

**Settings shell**

- Create `components/request/template/RequestTemplateSettingsNav.tsx`
- Create `components/request/template/RequestTemplateGeneralSection.tsx`
- Create `components/request/template/RequestTemplateScopeEditor.tsx`
- Create `components/request/template/RequestFormBuilder.tsx`
- Create `components/request/template/RequestApprovalBuilder.tsx`
- Create `components/request/template/RequestApproverBlockEditor.tsx`
- Create `components/request/template/RequestTemplateWatcherSection.tsx`
- Create `components/request/template/RequestTemplatePrintSection.tsx`
- Create `components/request/template/RequestTemplateNotificationSection.tsx`
- Create `components/request/template/RequestTemplatePreview.tsx`

---

### Task 1: Define the Editor State, Reducer and Publish Validator

**Files:**

- Create: `lib/requestTemplateEditorModel.ts`
- Create: `lib/__tests__/requestTemplateEditorModel.test.ts`

**Contract:**

```ts
import type {
  RequestApproverSource,
  RequestCompletionPolicy,
  RequestFieldType,
  RequestFlowMode,
} from './requestApprovalDomain';
import type { SaveRequestTemplateDraftInput } from './requestTemplateService';

export type RequestScopeKind =
  | 'COMPANY' | 'ORG_UNIT' | 'PERMISSION_GROUP' | 'USER';

export interface RequestTemplateFieldDraft {
  key: string;
  label: string;
  fieldType: RequestFieldType;
  required: boolean;
  options: string[];
  sortOrder: number;
}

export interface RequestApproverBlockDraft {
  key: string;
  name: string;
  source: RequestApproverSource;
  fixedUserIds: string[];
  minimumDynamicApprovers: number | null;
  slaHours: number | null;
  sortOrder: number;
}

export interface RequestTemplateDraft {
  id?: string;
  name: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED' | 'DEACTIVATED';
  requestSlaHours: number | null;
  flowMode: RequestFlowMode;
  completionPolicy: RequestCompletionPolicy;
  fields: RequestTemplateFieldDraft[];
  approverBlocks: RequestApproverBlockDraft[];
  scopes: Array<{ kind: RequestScopeKind; targetId: string | null }>;
  fixedWatcherIds: string[];
  print: { browserPrintEnabled: boolean; docxStoragePath: string | null };
  notificationEvents: Array<
    'SUBMITTED' | 'ASSIGNED' | 'REASSIGNED'
    | 'REMINDER' | 'RETURNED' | 'APPROVED' | 'REJECTED'
  >;
}

export type RequestTemplateDraftAction =
  | { type: 'PATCH_GENERAL'; patch: Pick<Partial<RequestTemplateDraft>, 'name' | 'description' | 'requestSlaHours'> }
  | { type: 'SET_FLOW'; flowMode: RequestFlowMode; completionPolicy: RequestCompletionPolicy }
  | { type: 'UPSERT_FIELD'; field: RequestTemplateFieldDraft }
  | { type: 'REMOVE_FIELD'; key: string }
  | { type: 'REORDER_FIELDS'; orderedKeys: string[] }
  | { type: 'UPSERT_APPROVER_BLOCK'; block: RequestApproverBlockDraft }
  | { type: 'REMOVE_APPROVER_BLOCK'; key: string }
  | { type: 'REORDER_APPROVER_BLOCKS'; orderedKeys: string[] }
  | { type: 'SET_SCOPES'; scopes: RequestTemplateDraft['scopes'] }
  | { type: 'SET_WATCHERS'; userIds: string[] }
  | { type: 'SET_PRINT'; print: RequestTemplateDraft['print'] }
  | { type: 'SET_NOTIFICATIONS'; events: RequestTemplateDraft['notificationEvents'] };

export interface RequestTemplateValidationIssue {
  section: 'GENERAL' | 'FORM' | 'APPROVAL' | 'SCOPE' | 'PRINT';
  code: string;
  message: string;
}
```

- [ ] **Step 1: Viết test RED cho reducer và validator**

```ts
import { describe, expect, it } from 'vitest';
import {
  createEmptyRequestTemplateDraft,
  requestTemplateDraftReducer,
  validateRequestTemplateForPublish,
} from '../requestTemplateEditorModel';

describe('request template editor model', () => {
  it('reorders approver blocks deterministically', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      approverBlocks: [
        { key: 'manager', name: 'Quản lý', source: 'DIRECT_MANAGER' as const,
          fixedUserIds: [], minimumDynamicApprovers: null, slaHours: 24, sortOrder: 1 },
        { key: 'director', name: 'Giám đốc', source: 'FIXED_SINGLE' as const,
          fixedUserIds: ['director-id'], minimumDynamicApprovers: null, slaHours: 24, sortOrder: 2 },
      ],
    };

    const next = requestTemplateDraftReducer(draft, {
      type: 'REORDER_APPROVER_BLOCKS',
      orderedKeys: ['director', 'manager'],
    });

    expect(next.approverBlocks.map(block => [block.key, block.sortOrder]))
      .toEqual([['director', 1], ['manager', 2]]);
  });

  it('blocks publish when a dynamic block has no valid minimum', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      name: 'Đề xuất mua hàng',
      fields: [{
        key: 'reason', label: 'Lý do', fieldType: 'textarea' as const,
        required: true, options: [], sortOrder: 1,
      }],
      scopes: [{ kind: 'COMPANY' as const, targetId: null }],
      approverBlocks: [{
        key: 'dynamic', name: 'Người duyệt được chọn khi gửi',
        source: 'DYNAMIC_CREATOR_SELECT' as const,
        fixedUserIds: [], minimumDynamicApprovers: 0, slaHours: null, sortOrder: 1,
      }],
    };

    expect(validateRequestTemplateForPublish(draft))
      .toContainEqual(expect.objectContaining({
        section: 'APPROVAL',
        code: 'DYNAMIC_MINIMUM_REQUIRED',
      }));
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `npx vitest run lib/__tests__/requestTemplateEditorModel.test.ts`

Expected: FAIL vì module chưa tồn tại.

- [ ] **Step 3: Implement reducer bất biến và validator**

Validator bắt buộc:

- Tên mẫu khác rỗng.
- Ít nhất một trường form và mọi `key` duy nhất.
- Ít nhất một scope; `COMPANY` phải có `targetId = null`, scope khác phải có target.
- Ít nhất một khối duyệt.
- `FIXED_SINGLE` đúng một người; `FIXED_MULTI` có ít nhất hai người.
- `DIRECT_MANAGER` không nhận `fixedUserIds`.
- `DYNAMIC_CREATOR_SELECT.minimumDynamicApprovers >= 1`; nguồn khác phải để `null`.
- `requestSlaHours` và `slaHours` từng block rỗng hoặc số nguyên từ 1 đến 8760.
- DOCX được bật bằng đường dẫn storage không rỗng.

Serializer dùng contract của Runtime Foundation, không truyền shape UI thẳng vào RPC:

```ts
export const toSaveDraftInput = (
  draft: RequestTemplateDraft,
  expectedUpdatedAt?: string,
): SaveRequestTemplateDraftInput => ({
  templateId: draft.id,
  expectedUpdatedAt,
  name: draft.name.trim(),
  description: draft.description.trim(),
  formSchema: draft.fields.map(field => ({
    key: field.key,
    label: field.label.trim(),
    fieldType: field.fieldType,
    required: field.required,
    options: field.fieldType === 'select' ? field.options : [],
    sortOrder: field.sortOrder,
  })),
  usageScope: {
    companyWide: draft.scopes.some(scope => scope.kind === 'COMPANY'),
    orgUnitIds: draft.scopes.filter(scope => scope.kind === 'ORG_UNIT')
      .map(scope => scope.targetId!).filter(Boolean),
    permissionCodes: draft.scopes.filter(scope => scope.kind === 'PERMISSION_GROUP')
      .map(scope => scope.targetId!).filter(Boolean),
    userIds: draft.scopes.filter(scope => scope.kind === 'USER')
      .map(scope => scope.targetId!).filter(Boolean),
  },
  flowMode: draft.flowMode,
  completionPolicy: draft.completionPolicy,
  requestSlaHours: draft.requestSlaHours,
  blocks: draft.approverBlocks,
  watcherUserIds: draft.fixedWatcherIds,
  printConfig: {
    browserPrintEnabled: draft.print.browserPrintEnabled,
    docxStoragePath: draft.print.docxStoragePath,
  },
  notificationConfig: Object.fromEntries(
    draft.notificationEvents.map(event => [event, true]),
  ),
});
```

```ts
export const reorderByKeys = <T extends { key: string; sortOrder: number }>(
  items: T[],
  orderedKeys: string[],
): T[] => {
  const byKey = new Map(items.map(item => [item.key, item]));
  if (orderedKeys.length !== items.length || orderedKeys.some(key => !byKey.has(key))) {
    return items;
  }
  return orderedKeys.map((key, index) => ({
    ...byKey.get(key)!,
    sortOrder: index + 1,
  }));
};
```

- [ ] **Step 4: Chạy unit test và kiểm tra TypeScript**

Run: `npx vitest run lib/__tests__/requestTemplateEditorModel.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/requestTemplateEditorModel.ts lib/__tests__/requestTemplateEditorModel.test.ts
git commit -m "feat(request): define template editor model"
```

---

### Task 2: Add Template Routes, Permission Registry and Navigation

**Files:**

- Create: `pages/request/RequestTemplates.tsx`
- Create: `pages/request/RequestTemplateEditor.tsx`
- Modify: `App.tsx:104-105,215-217`
- Modify: `components/Sidebar.tsx:248-250`
- Modify: `components/UserModal.tsx:140-142`
- Modify: `lib/permissions/erpPermissionRegistry.ts:152-166`
- Create: `lib/__tests__/requestTemplateRouteContract.test.ts`

- [ ] **Step 1: Viết route contract test RED**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('request template routes', () => {
  const app = readFileSync('App.tsx', 'utf8');
  const permissions = readFileSync('lib/permissions/erpPermissionRegistry.ts', 'utf8');

  it('registers list, create and edit routes', () => {
    expect(app).toContain('path="rq/templates"');
    expect(app).toContain('path="rq/templates/new"');
    expect(app).toContain('path="rq/templates/:templateId"');
  });

  it('protects template administration with the template permission', () => {
    expect(permissions).toContain("['/rq/templates']");
    expect(permissions).toContain("'request.template'");
  });
});
```

- [ ] **Step 2: Chạy RED**

Run: `npx vitest run lib/__tests__/requestTemplateRouteContract.test.ts`

Expected: FAIL vì route chưa có.

- [ ] **Step 3: Thêm lazy imports và routes**

```tsx
const RequestTemplates = React.lazy(() => import('./pages/request/RequestTemplates'));
const RequestTemplateEditor = React.lazy(
  () => import('./pages/request/RequestTemplateEditor'),
);

<Route path="rq/templates" element={<RequestTemplates />} />
<Route path="rq/templates/new" element={<RequestTemplateEditor />} />
<Route path="rq/templates/:templateId" element={<RequestTemplateEditor />} />
<Route path="rq/categories" element={<Navigate to="/rq/templates" replace />} />
```

- [ ] **Step 4: Cập nhật điều hướng và permission**

Đổi nhãn “Danh mục yêu cầu” thành “Mẫu yêu cầu”, route `/rq/templates`. Giữ đúng action permission hiện hữu `request.template.view` và `request.template.manage`; `manage` bao phủ tạo/sửa/publish/deactivate. Bỏ trùng route của `request.category` khỏi sidebar, nhưng không xóa permission legacy khỏi registry trong Giai đoạn 1.

- [ ] **Step 5: Tạo trang danh sách**

`RequestTemplates.tsx` gọi `requestTemplateService.list`, hiển thị tên, trạng thái, version phát hành, phạm vi, cập nhật gần nhất và hành động:

- Tạo mẫu.
- Sửa bản nháp.
- Tạo bản nháp mới từ version đã phát hành.
- Ngừng kích hoạt sau confirm.

Không thực hiện optimistic publish/deactivate; refetch sau RPC thành công.

- [ ] **Step 6: Chạy test**

Run: `npx vitest run lib/__tests__/requestTemplateRouteContract.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add App.tsx components/Sidebar.tsx components/UserModal.tsx \
  lib/permissions/erpPermissionRegistry.ts pages/request/RequestTemplates.tsx \
  pages/request/RequestTemplateEditor.tsx lib/__tests__/requestTemplateRouteContract.test.ts
git commit -m "feat(request): add template administration routes"
```

---

### Task 3: Build the Settings Shell, General Information and Scope Editor

**Files:**

- Modify: `pages/request/RequestTemplateEditor.tsx`
- Create: `components/request/template/RequestTemplateSettingsNav.tsx`
- Create: `components/request/template/RequestTemplateGeneralSection.tsx`
- Create: `components/request/template/RequestTemplateScopeEditor.tsx`
- Create: `lib/__tests__/requestTemplateSettingsContract.test.ts`

- [ ] **Step 1: Viết source contract test RED**

Test phải xác nhận menu có đúng các section Giai đoạn 1: `GENERAL`, `FORM`, `APPROVAL`, `WATCHERS`, `PRINT`, `NOTIFICATIONS`; không có `WEBHOOK`, `SIGNATURE`, `CONDITIONS`.

- [ ] **Step 2: Dựng shell Base × Vioo thích ứng**

```tsx
export type RequestTemplateSection =
  | 'GENERAL' | 'FORM' | 'APPROVAL'
  | 'WATCHERS' | 'PRINT' | 'NOTIFICATIONS';

<div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)] bg-slate-50">
  <RequestTemplateSettingsNav active={activeSection} onChange={setActiveSection} />
  <main className="min-w-0 overflow-y-auto">
    <div className="mx-auto max-w-5xl space-y-4 p-5">
      {renderSection(activeSection)}
    </div>
  </main>
</div>
```

Ở màn dưới 1024px, menu đổi thành thanh tab ngang cuộn được; không tạo sidebar thứ ba.

- [ ] **Step 3: Implement general section**

Form gồm tên, mô tả, SLA toàn đề xuất (tùy chọn), trạng thái chỉ đọc, version hiện tại, người tạo và thời điểm cập nhật. Mỗi thay đổi dispatch `PATCH_GENERAL`; lỗi hiển thị theo `validateRequestTemplateForPublish`.

- [ ] **Step 4: Implement scope editor**

Scope picker dùng nguồn dữ liệu hiện có của công ty:

- `COMPANY`: một lựa chọn duy nhất.
- `ORG_UNIT`: multi-select đơn vị/phòng ban.
- `PERMISSION_GROUP`: multi-select permission code từ registry hiện hữu; user thuộc nhóm khi có grant active cho code đó.
- `USER`: multi-select người dùng.

Khi chọn `COMPANY`, xóa scope chi tiết khác sau confirm. Deduplicate theo cặp `(kind, targetId)`.

- [ ] **Step 5: Save draft with dirty-state guard**

Trang editor:

- Tải draft bằng `requestTemplateService.getDraft(templateId)`.
- Autosave debounce 800 ms chỉ khi draft hợp lệ về cấu trúc.
- Nút “Lưu nháp” gọi ngay và hiển thị `saving/saved/error`.
- Chặn rời trang bằng `beforeunload` khi còn dirty.
- Dùng `updatedAt` làm version token; service trả `CONFLICT` khi người khác đã lưu trước.

- [ ] **Step 6: Chạy test**

Run: `npx vitest run lib/__tests__/requestTemplateSettingsContract.test.ts lib/__tests__/requestTemplateEditorModel.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add pages/request/RequestTemplateEditor.tsx components/request/template \
  lib/__tests__/requestTemplateSettingsContract.test.ts
git commit -m "feat(request): build template settings shell"
```

---

### Task 4: Build the Request Form Builder

**Files:**

- Create: `components/request/template/RequestFormBuilder.tsx`
- Create: `lib/__tests__/requestFormBuilderModel.test.ts`
- Modify: `lib/requestTemplateEditorModel.ts`

- [ ] **Step 1: Viết test RED cho key, option và reorder**

```ts
it('normalizes a field key without changing an existing stable key', () => {
  expect(createFieldKey('Số tiền đề xuất', [])).toBe('so_tien_de_xuat');
  expect(createFieldKey('Số tiền đề xuất', ['so_tien_de_xuat']))
    .toBe('so_tien_de_xuat_2');
});
```

Thêm test: `select` phải có ít nhất một option khác rỗng; kiểu khác luôn xóa options; xóa field phải cần confirm khi đã có dữ liệu preview.

- [ ] **Step 2: Implement field factory and validation**

```ts
export const createFieldKey = (label: string, existing: string[]): string => {
  const base = label.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'field';
  let candidate = base;
  let suffix = 2;
  while (existing.includes(candidate)) candidate = `${base}_${suffix++}`;
  return candidate;
};
```

- [ ] **Step 3: Implement builder UI**

Mỗi field card có drag handle, nhãn, loại, bắt buộc, options, preview và xóa. Add menu chỉ chứa các loại trong `RequestTemplateFieldDraft.fieldType`. Reorder dispatch `REORDER_FIELDS`; không ghi từng vị trí trực tiếp lên server.

- [ ] **Step 4: Keyboard and accessibility**

- Nút di chuyển lên/xuống hoạt động song song với drag.
- Label gắn đúng `htmlFor`.
- Thông báo lỗi dùng `aria-describedby`.
- Focus quay về field vừa thêm.

- [ ] **Step 5: Chạy test**

Run: `npx vitest run lib/__tests__/requestFormBuilderModel.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/request/template/RequestFormBuilder.tsx \
  lib/requestTemplateEditorModel.ts lib/__tests__/requestFormBuilderModel.test.ts
git commit -m "feat(request): add request form builder"
```

---

### Task 5: Build the Approval Flow and Approver Block Editors

**Files:**

- Create: `components/request/template/RequestApprovalBuilder.tsx`
- Create: `components/request/template/RequestApproverBlockEditor.tsx`
- Create: `lib/__tests__/requestApprovalBuilderModel.test.ts`
- Modify: `lib/requestTemplateEditorModel.ts`

- [ ] **Step 1: Viết test RED cho bốn nguồn người duyệt**

Test matrix:

| Source | fixedUserIds | minimumDynamicApprovers | Kết quả |
| --- | ---: | ---: | --- |
| `FIXED_SINGLE` | 1 | null | hợp lệ |
| `FIXED_MULTI` | >=2 | null | hợp lệ |
| `DIRECT_MANAGER` | 0 | null | hợp lệ |
| `DYNAMIC_CREATOR_SELECT` | 0 | >=1 | hợp lệ |

Thêm test `FIXED_MULTI` có dưới hai người bị chặn và duplicate user ID bị loại.

- [ ] **Step 2: Implement block factory**

```ts
export const createApproverBlock = (
  source: RequestApproverSource,
  sortOrder: number,
): RequestApproverBlockDraft => ({
  key: crypto.randomUUID(),
  name: source === 'DIRECT_MANAGER'
    ? 'Quản lý trực tiếp'
    : source === 'DYNAMIC_CREATOR_SELECT'
      ? 'Người duyệt được chọn khi gửi'
      : 'Khối người duyệt',
  source,
  fixedUserIds: [],
  minimumDynamicApprovers: source === 'DYNAMIC_CREATOR_SELECT' ? 1 : null,
  slaHours: null,
  sortOrder,
});
```

- [ ] **Step 3: Implement approval settings**

Header section có:

- Segmented control `Duyệt lần lượt` / `Duyệt đồng thời`.
- Select completion `Tất cả người duyệt` / `Một người duyệt`.
- Chú thích rõ: từ chối kết thúc toàn bộ; trả lại quay về người tạo và giữ kết quả bước trước.

Nếu chọn `ANY_ONE` trong luồng tuần tự, hiển thị giải thích rằng một người ở khối hiện tại chấp thuận sẽ hoàn thành khối và tự kích hoạt khối tiếp theo; chỉ khối cuối mới hoàn thành toàn đề xuất.

- [ ] **Step 4: Implement add/edit block**

Menu “+ Thêm” gồm:

- Thêm người duyệt cố định.
- Thêm nhiều người duyệt cố định.
- Thêm quản lý trực tiếp.
- Thêm người duyệt linh động.

Dialog cố định dùng employee picker; dynamic không chọn trước người dùng, chỉ cấu hình số lượng tối thiểu. SLA cho phép rỗng hoặc nhập giờ. Mỗi row có sửa, nhân bản, xóa và reorder.

- [ ] **Step 5: Add resolver and runtime preview**

Card preview diễn giải theo thứ tự:

```text
1. Quản lý trực tiếp · SLA 24 giờ
2. Ban giám đốc · 2 người · Tất cả phải duyệt
3. Người tạo chọn khi gửi · tối thiểu 1 người
```

Card mặc định không resolve tên quản lý trực tiếp; ghi rõ “được xác định khi gửi”.

Thêm “Xem thử với người tạo mẫu”: Admin chọn một user active, UI gọi `requestTemplateService.previewResolvers(toSaveDraftInput(draft), sampleCreatorId)` và hiển thị quản lý trực tiếp/fixed users sẽ resolve. Dynamic block luôn ghi “người tạo chọn khi gửi”. Fixed approver inactive chặn publish; sample creator thiếu manager là cảnh báo vì phụ thuộc người gửi thực tế, còn runtime sẽ chặn đúng người đó khi submit.

- [ ] **Step 6: Chạy test**

Run: `npx vitest run lib/__tests__/requestApprovalBuilderModel.test.ts lib/__tests__/requestTemplateEditorModel.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/request/template/RequestApprovalBuilder.tsx \
  components/request/template/RequestApproverBlockEditor.tsx \
  lib/requestTemplateEditorModel.ts lib/__tests__/requestApprovalBuilderModel.test.ts
git commit -m "feat(request): configure approval blocks"
```

---

### Task 6: Add Watchers, Print and Notification Settings

**Files:**

- Create: `components/request/template/RequestTemplateWatcherSection.tsx`
- Create: `components/request/template/RequestTemplatePrintSection.tsx`
- Create: `components/request/template/RequestTemplateNotificationSection.tsx`
- Create: `lib/__tests__/requestTemplateAuxiliarySettings.test.ts`

- [ ] **Step 1: Viết RED cho serialization**

Test `toSaveDraftInput(draft)` giữ `fixedWatcherIds`, `browserPrintEnabled`, `docxStoragePath`, notification event theo đúng contract; không đưa object `File` vào RPC payload.

- [ ] **Step 2: Implement watchers**

Cho phép chọn nhiều người theo dõi cố định. Người duyệt và người tạo luôn được runtime cấp quyền qua participant, nên không tự thêm trùng vào `fixedWatcherIds`.

- [ ] **Step 3: Implement print settings**

- Browser/PDF print bật mặc định.
- DOCX upload chỉ nhận `.docx`, tối đa 10 MB.
- Upload vào bucket private `workflow-templates`, path dựng bằng `request-template-versions/${draftVersionId}/template.docx`; sau upload chỉ lưu `docxStoragePath`.
- Trước upload, đọc DOCX bằng `PizZip` ở service, trích token, chặn token không thuộc danh sách hệ thống hoặc field key của draft; lưu `validationStatus` và `placeholderSchema` cùng metadata.
- Có tải lại, thay file, xóa file và danh sách token hỗ trợ:
  `${code}`, `${title}`, `${creator_name}`, `${created_at_full}`,
  `${field_amount}`, `${approval_summary}`.

- [ ] **Step 4: Implement notification settings**

Checkbox theo event. `ASSIGNED`, `RETURNED`, `APPROVED`, `REJECTED` bật mặc định và không cho bỏ `ASSIGNED`; `REMINDER` chỉ bật khi có SLA toàn đề xuất hoặc ít nhất một block có SLA.

- [ ] **Step 5: Chạy test**

Run: `npx vitest run lib/__tests__/requestTemplateAuxiliarySettings.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/request/template/RequestTemplateWatcherSection.tsx \
  components/request/template/RequestTemplatePrintSection.tsx \
  components/request/template/RequestTemplateNotificationSection.tsx \
  lib/__tests__/requestTemplateAuxiliarySettings.test.ts
git commit -m "feat(request): configure watchers print and notifications"
```

---

### Task 7: Add Preview, Publish and Immutable Version Feedback

**Files:**

- Create: `components/request/template/RequestTemplatePreview.tsx`
- Modify: `pages/request/RequestTemplateEditor.tsx`
- Create: `lib/__tests__/requestTemplatePublishFlow.test.ts`

- [ ] **Step 1: Viết publish orchestration test RED**

Mock `requestTemplateService.saveDraft` và `publish`; xác nhận:

- Validation lỗi thì không gọi service.
- Dirty draft được lưu trước khi publish.
- `publish` nhận đúng `templateId` và `expectedUpdatedAt`.
- Thành công cập nhật version, status và baseline dirty.
- `CONFLICT` yêu cầu reload; không tự ghi đè.

- [ ] **Step 2: Implement preview**

Preview có ba tab:

- Form người tạo sẽ nhập.
- Tiến trình người duyệt sẽ thấy.
- Trang in cơ bản.

Preview dùng chính draft state và renderer shared; không tạo request instance.

- [ ] **Step 3: Implement publish command**

```ts
const handlePublish = async () => {
  const issues = validateRequestTemplateForPublish(draft);
  if (issues.length > 0) {
    setIssues(issues);
    setActiveSection(issues[0].section);
    return;
  }
  const saved = dirty
    ? await requestTemplateService.saveDraft(toSaveDraftInput(draft))
    : currentDraftMeta;
  const published = await requestTemplateService.publish({
    templateId: saved.id,
    expectedUpdatedAt: saved.updatedAt,
  });
  setPublishedVersion(published.versionNumber);
  setDirty(false);
};
```

- [ ] **Step 4: Add publish confirmation**

Dialog hiển thị:

- Số người duyệt/block.
- Luồng tuần tự/song song.
- Chính sách ALL/ANY_ONE.
- Phạm vi sử dụng.
- Cảnh báo version đã phát hành bất biến.

- [ ] **Step 5: Chạy test và build**

Run: `npx vitest run lib/__tests__/requestTemplatePublishFlow.test.ts && npm run lint && npm run build`

Expected: PASS; build không có lỗi import/chunk.

- [ ] **Step 6: Manual acceptance**

- Tạo mẫu toàn công ty gồm trường text, select và file.
- Thêm manager → hai giám đốc cố định → người duyệt linh động.
- Đổi tuần tự/song song, ALL/ANY_ONE và kiểm tra preview.
- Bật browser print, upload DOCX, cấu hình thông báo.
- Publish, reload, xác nhận version đã phát hành không sửa trực tiếp.
- Mở lại và tạo draft mới từ version vừa phát hành.

- [ ] **Step 7: Commit**

```bash
git add components/request/template/RequestTemplatePreview.tsx \
  pages/request/RequestTemplateEditor.tsx lib/__tests__/requestTemplatePublishFlow.test.ts
git commit -m "feat(request): publish request templates"
```

---

## Completion Gate

- [ ] Run: `npx vitest run lib/__tests__/requestTemplateEditorModel.test.ts lib/__tests__/requestFormBuilderModel.test.ts lib/__tests__/requestApprovalBuilderModel.test.ts lib/__tests__/requestTemplateAuxiliarySettings.test.ts lib/__tests__/requestTemplatePublishFlow.test.ts lib/__tests__/requestTemplateRouteContract.test.ts`
- [ ] Run: `npm run lint`
- [ ] Run: `npm run build`
- [ ] Xác nhận user thiếu `request.template.view` không mở được `/rq/templates`.
- [ ] Xác nhận user chỉ có `request.template.view` không thấy nút tạo/sửa/publish/deactivate; các nút này cần `request.template.manage`.
- [ ] Xác nhận không có UI conditional branch ở Giai đoạn 1.
- [ ] Ghi kết quả Gate T0–T5 vào PR description trước khi chuyển sang kế hoạch Workspace.

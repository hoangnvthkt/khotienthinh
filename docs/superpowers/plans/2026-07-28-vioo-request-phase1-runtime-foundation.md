# Vioo Request Phase 1 — Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây nền tảng dữ liệu, RLS, versioning, resolver và RPC phê duyệt tự động để Module Yêu cầu chạy an toàn trên Workflow Engine dùng chung.

**Architecture:** `request_templates` và `request_template_versions` giữ cấu hình nghiệp vụ; khi phát hành, adapter biên dịch các khối duyệt sang `workflow_template_versions`. Mỗi `request_instance` liên kết 1–1 với `workflow_instance` và `workflow_subject`, còn mọi transition chạy qua RPC nguyên tử với execution policy `AUTO_ADVANCE_APPROVAL`.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, Supabase JS 2.98, Supabase CLI 2.95, PostgreSQL/PL/pgSQL.

## Global Constraints

- Chỉ triển khai Giai đoạn 1; không làm conditional approver, branch, webhook, chữ ký điện tử hoặc bộ đếm tùy chỉnh.
- Database Yêu cầu hiện không có dữ liệu nghiệp vụ cần migrate; không được xóa bảng hoặc dữ liệu của module khác.
- Giữ Module Quy trình ở execution policy hiện hữu; chỉ request workflow dùng `AUTO_ADVANCE_APPROVAL`.
- Flow mode chỉ có `SEQUENTIAL` và `PARALLEL`; completion policy chỉ có `ALL` và `ANY_ONE`.
- Một người từ chối làm toàn request `REJECTED` ngay; assignment đang chờ khác chuyển `CANCELLED`.
- Trả lại quay đúng khối; gửi lại giữ kết quả đã chấp thuận và tạo assignment round mới.
- Người duyệt linh động do người tạo chọn; quản lý trực tiếp resolve tại thời điểm gửi; tất cả approver được snapshot.
- Request có UUID nội bộ và mã toàn hệ thống `RQ-YYYY-NNNNNN`; mã không được tái sử dụng.
- Tất cả public table mới phải bật RLS và có grant rõ ràng; không cấp write trực tiếp cho `authenticated`.
- Privileged logic đặt trong `app_private`, `security definer`, `set search_path = ''`; public RPC chỉ là wrapper `security invoker`.
- Mọi foreign key phải có index; list dùng cursor `(created_at, id)`, không dùng OFFSET.
- Lock order cho command: `request_instances` → `workflow_subjects` → `workflow_step_assignments` theo `id` tăng dần.
- Transaction không gọi HTTP/storage; chỉ ghi outbox rồi trả kết quả.
- Migration mới phải được tạo bằng `npx supabase migration new request_approval_phase1_schema` hoặc tên cụ thể được nêu trong từng task; dùng đúng file CLI in ra, không tự đặt timestamp.

---

## Delivery Gates

| Gate | Điều kiện qua gate |
| --- | --- |
| R0 | Domain policy unit test xanh, type ổn định |
| R1 | Schema/RLS/advisor sạch, manager resolver có nguồn dữ liệu thật |
| R2 | Phát hành template tạo workflow version bất biến |
| R3 | Submit tạo code, snapshot, participant và assignment đúng |
| R4 | Approve/reject/return/resubmit chịu concurrency và idempotency |
| R5 | List/detail/summary RPC đúng quyền và cursor |
| R6 | Supabase smoke test chạy trọn vòng tuần tự, song song, trả lại |

## File Map

**Domain**

- Create `lib/requestApprovalDomain.ts`: type thuần, validator và policy projection.
- Create `lib/__tests__/requestApprovalDomain.test.ts`: unit test `ALL`/`ANY_ONE`, sequential/parallel, return round.
- Modify `types.ts:4331-4404`: mở rộng trạng thái và DTO request mới, giữ type legacy cho đến plan UI.

**Direct manager**

- Modify `context/authState.ts:275-300`: map `manager_id`.
- Modify `context/AppContext.tsx:63-80`: persist `manager_id`.
- Create `lib/__tests__/requestDirectManagerProfile.test.ts`.
- Create via CLI migration `request_direct_manager_phase1`.

**Database/runtime**

- Create via CLI migration `request_approval_phase1_schema`.
- Create via CLI migration `request_template_publish_phase1`.
- Create via CLI migration `request_submit_phase1`.
- Create via CLI migration `request_actions_phase1`.
- Create via CLI migration `request_queries_phase1`.
- Create `supabase/tests/request_approval_phase1_smoke.sql`.
- Create `lib/__tests__/requestApprovalMigration.test.ts`.

**Client boundary**

- Create `lib/requestTemplateService.ts`: draft/publish/list wrapper.
- Create `lib/requestRuntimeService.ts`: submit/action/list/detail/summary wrapper.
- Create `lib/__tests__/requestTemplateService.test.ts`.
- Create `lib/__tests__/requestRuntimeService.test.ts`.

---

### Task 1: Lock the Request Approval Domain Contract

**Files:**

- Create: `lib/requestApprovalDomain.ts`
- Create: `lib/__tests__/requestApprovalDomain.test.ts`
- Modify: `types.ts:4331-4404`

**Interfaces:**

- Consumes: existing workflow assignment conventions; request form schema remains request-specific.
- Produces:

```ts
export type RequestFlowMode = 'SEQUENTIAL' | 'PARALLEL';
export type RequestCompletionPolicy = 'ALL' | 'ANY_ONE';
export type RequestApproverSource =
  | 'FIXED_SINGLE' | 'FIXED_MULTI'
  | 'DIRECT_MANAGER' | 'DYNAMIC_CREATOR_SELECT';
export type RequestFieldType =
  | 'text' | 'textarea' | 'number' | 'date' | 'select' | 'user' | 'file';
export interface RequestTemplateFieldSchema {
  key: string;
  label: string;
  fieldType: RequestFieldType;
  required: boolean;
  options: string[];
  sortOrder: number;
}
export interface RequestApprovalBlock {
  key: string;
  name: string;
  source: RequestApproverSource;
  fixedUserIds: string[];
  minimumDynamicApprovers: number | null;
  slaHours: number | null;
  sortOrder: number;
}
export type RequestRuntimeStatus =
  | 'DRAFT' | 'PENDING' | 'RETURNED'
  | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type RequestAssignmentStatus =
  | 'PENDING' | 'APPROVED' | 'REJECTED'
  | 'RETURNED' | 'SKIPPED' | 'CANCELLED';

export interface RequestApprovalPolicyInput {
  flowMode: RequestFlowMode;
  completionPolicy: RequestCompletionPolicy;
  orderedBlockKeys: string[];
  currentBlockKey?: string;
  assignments: Array<{
    id: string;
    blockKey: string;
    status: RequestAssignmentStatus;
    sortOrder: number;
  }>;
}

export interface RequestApprovalProjection {
  isApproved: boolean;
  activeBlockKeys: string[];
  assignmentIdsToSkip: string[];
  nextBlockKey?: string;
}

export const projectRequestApproval: (
  input: RequestApprovalPolicyInput,
) => RequestApprovalProjection;
```

- [ ] **Step 1: Viết unit test RED cho policy**

```ts
import { describe, expect, it } from 'vitest';
import { projectRequestApproval } from '../requestApprovalDomain';

describe('projectRequestApproval', () => {
  it('advances a sequential ALL request only after the current block is complete', () => {
    expect(projectRequestApproval({
      flowMode: 'SEQUENTIAL',
      completionPolicy: 'ALL',
      orderedBlockKeys: ['manager', 'director'],
      currentBlockKey: 'manager',
      assignments: [
        { id: 'a1', blockKey: 'manager', status: 'APPROVED', sortOrder: 1 },
      ],
    })).toMatchObject({
      isApproved: false,
      activeBlockKeys: ['director'],
      nextBlockKey: 'director',
    });
  });

  it('finishes parallel ANY_ONE and skips every remaining assignment', () => {
    expect(projectRequestApproval({
      flowMode: 'PARALLEL',
      completionPolicy: 'ANY_ONE',
      orderedBlockKeys: ['manager', 'director'],
      assignments: [
        { id: 'a1', blockKey: 'manager', status: 'APPROVED', sortOrder: 1 },
        { id: 'a2', blockKey: 'director', status: 'PENDING', sortOrder: 2 },
      ],
    })).toEqual({
      isApproved: true,
      activeBlockKeys: [],
      assignmentIdsToSkip: ['a2'],
    });
  });

  it('does not count RETURNED or CANCELLED as approvals', () => {
    expect(projectRequestApproval({
      flowMode: 'PARALLEL',
      completionPolicy: 'ALL',
      orderedBlockKeys: ['manager', 'director'],
      assignments: [
        { id: 'a1', blockKey: 'manager', status: 'APPROVED', sortOrder: 1 },
        { id: 'a2', blockKey: 'director', status: 'RETURNED', sortOrder: 2 },
      ],
    }).isApproved).toBe(false);
  });

  it('advances sequential ANY_ONE after one approval in the current block', () => {
    expect(projectRequestApproval({
      flowMode: 'SEQUENTIAL',
      completionPolicy: 'ANY_ONE',
      orderedBlockKeys: ['board', 'finance'],
      currentBlockKey: 'board',
      assignments: [
        { id: 'a1', blockKey: 'board', status: 'APPROVED', sortOrder: 1 },
        { id: 'a2', blockKey: 'board', status: 'PENDING', sortOrder: 2 },
      ],
    })).toEqual({
      isApproved: false,
      activeBlockKeys: ['finance'],
      assignmentIdsToSkip: ['a2'],
      nextBlockKey: 'finance',
    });
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `npx vitest run lib/__tests__/requestApprovalDomain.test.ts`

Expected: FAIL vì `requestApprovalDomain.ts` chưa tồn tại.

- [ ] **Step 3: Thêm type vào `types.ts` và implementation tối thiểu**

```ts
const terminalApproved = (status: RequestAssignmentStatus) => status === 'APPROVED';

export const projectRequestApproval = (
  input: RequestApprovalPolicyInput,
): RequestApprovalProjection => {
  const ordered = [...input.assignments].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );

  if (input.flowMode === 'PARALLEL') {
    const pending = ordered.filter(item => item.status === 'PENDING');
    const approved = ordered.filter(item => terminalApproved(item.status));
    if (input.completionPolicy === 'ANY_ONE' && approved.length > 0) {
      return {
        isApproved: true,
        activeBlockKeys: [],
        assignmentIdsToSkip: pending.map(item => item.id),
      };
    }
    return {
      isApproved: ordered.length > 0 && ordered.every(item => terminalApproved(item.status)),
      activeBlockKeys: [...new Set(pending.map(item => item.blockKey))],
      assignmentIdsToSkip: [],
    };
  }

  const currentBlockKey = input.currentBlockKey ?? input.orderedBlockKeys[0];
  const currentAssignments = ordered.filter(item => item.blockKey === currentBlockKey);
  const currentPending = currentAssignments.filter(item => item.status === 'PENDING');
  const currentComplete = input.completionPolicy === 'ANY_ONE'
    ? currentAssignments.some(item => terminalApproved(item.status))
    : currentAssignments.length > 0 &&
      currentAssignments.every(item => terminalApproved(item.status));
  if (!currentComplete) {
    return {
      isApproved: false,
      activeBlockKeys: currentBlockKey ? [currentBlockKey] : [],
      assignmentIdsToSkip: [],
    };
  }
  const currentIndex = input.orderedBlockKeys.indexOf(currentBlockKey);
  const nextBlockKey = input.orderedBlockKeys[currentIndex + 1];
  return {
    isApproved: !nextBlockKey,
    activeBlockKeys: nextBlockKey ? [nextBlockKey] : [],
    assignmentIdsToSkip: input.completionPolicy === 'ANY_ONE'
      ? currentPending.map(item => item.id)
      : [],
    nextBlockKey,
  };
};
```

- [ ] **Step 4: Chạy test và kiểm tra TypeScript**

Run: `npx vitest run lib/__tests__/requestApprovalDomain.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add types.ts lib/requestApprovalDomain.ts lib/__tests__/requestApprovalDomain.test.ts
git commit -m "feat(request): define approval runtime contract"
```

### Task 2: Persist and Resolve the Direct Manager

**Files:**

- Create via CLI: migration output of `npx supabase migration new request_direct_manager_phase1`; refer to it below as `$DIRECT_MANAGER_MIGRATION`
- Modify: `context/authState.ts:275-300`
- Modify: `context/AppContext.tsx:63-80`
- Create: `lib/__tests__/requestDirectManagerProfile.test.ts`
- Create: `lib/__tests__/requestDirectManagerMigration.test.ts`

**Interfaces:**

- Produces `public.users.manager_id uuid null references public.users(id)`.
- Produces `app_private.resolve_request_direct_manager(uuid) returns uuid`.

- [ ] **Step 1: Tạo migration bằng CLI**

```bash
npx supabase migration new request_direct_manager_phase1
DIRECT_MANAGER_MIGRATION="$(ls -t supabase/migrations/*_request_direct_manager_phase1.sql | head -1)"
test -n "$DIRECT_MANAGER_MIGRATION"
```

- [ ] **Step 2: Viết test mapping RED**

```ts
import { describe, expect, it } from 'vitest';
import { mapUserProfileRow } from '../../context/authState';

describe('request direct manager profile mapping', () => {
  it('maps manager_id from the authoritative user profile', () => {
    expect(mapUserProfileRow({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Nhân viên',
      email: 'employee@vioo.vn',
      role: 'EMPLOYEE',
      manager_id: '22222222-2222-4222-8222-222222222222',
      is_active: true,
    }).managerId).toBe('22222222-2222-4222-8222-222222222222');
  });
});
```

- [ ] **Step 3: Viết migration contract test RED**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(dir).find(name => name.endsWith('_request_direct_manager_phase1.sql'));
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

describe('request direct manager migration', () => {
  it('stores and resolves only an active manager', () => {
    expect(sql).toContain('manager_id uuid');
    expect(sql).toContain('resolve_request_direct_manager');
    expect(sql).toContain('account_status');
    expect(sql).toContain("'ACTIVE'");
  });
});
```

- [ ] **Step 4: Chạy test để xác nhận RED**

Run: `npx vitest run lib/__tests__/requestDirectManagerProfile.test.ts lib/__tests__/requestDirectManagerMigration.test.ts`

Expected: FAIL vì mapping và SQL chưa có.

- [ ] **Step 5: Ghi migration và mapping**

Migration body:

```sql
alter table public.users
  add column if not exists manager_id uuid references public.users(id) on delete set null;

create index if not exists idx_users_manager_id
  on public.users(manager_id)
  where manager_id is not null;

create or replace function app_private.resolve_request_direct_manager(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select manager.id
  from public.users employee
  join public.users manager on manager.id = employee.manager_id
  where employee.id = p_user_id
    and coalesce(manager.is_active, true)
    and coalesce(manager.account_status, 'ACTIVE') = 'ACTIVE';
$$;

revoke all on function app_private.resolve_request_direct_manager(uuid) from public, anon;
revoke all on function app_private.resolve_request_direct_manager(uuid) from authenticated;
```

Thêm vào `mapUserProfileRow`:

```ts
managerId: row.manager_id ?? row.managerId ?? undefined,
```

Thêm vào `userToDbPayload`:

```ts
manager_id: data.managerId || null,
```

- [ ] **Step 6: Chạy test**

Run: `npx vitest run lib/__tests__/requestDirectManagerProfile.test.ts lib/__tests__/requestDirectManagerMigration.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "$DIRECT_MANAGER_MIGRATION" context/authState.ts context/AppContext.tsx \
  lib/__tests__/requestDirectManagerProfile.test.ts \
  lib/__tests__/requestDirectManagerMigration.test.ts
git commit -m "feat(request): persist direct manager relation"
```

### Task 3: Create the Versioned Request Schema and RLS Boundary

**Files:**

- Create via CLI: output of `npx supabase migration new request_approval_phase1_schema`; call it `$REQUEST_SCHEMA_MIGRATION`
- Create: `lib/__tests__/requestApprovalMigration.test.ts`

**Interfaces:**

- Produces the tables from design sections 6.1–6.6.
- Extends `workflow_subjects.subject_type` with `request`.
- Extends `workflow_step_assignments.status` with `CANCELLED`.

- [ ] **Step 1: Tạo migration bằng CLI**

```bash
npx supabase migration new request_approval_phase1_schema
REQUEST_SCHEMA_MIGRATION="$(ls -t supabase/migrations/*_request_approval_phase1_schema.sql | head -1)"
test -n "$REQUEST_SCHEMA_MIGRATION"
```

- [ ] **Step 2: Viết migration contract test RED**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(dir).find(name => name.endsWith('_request_approval_phase1_schema.sql'));
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

describe('request approval phase 1 schema', () => {
  it('creates versioned request tables and private runtime support tables', () => {
    for (const table of [
      'request_templates',
      'request_template_versions',
      'request_approval_blocks',
      'request_template_watchers',
      'request_sequence_counters',
    ]) expect(sql).toContain(`public.${table}`);
    for (const table of [
      'request_command_idempotency',
      'request_notification_outbox',
      'request_export_audit',
    ]) expect(sql).toContain(`app_private.${table}`);
  });

  it('enables RLS and revokes direct writes', () => {
    expect(sql.match(/enable row level security/g)?.length).toBeGreaterThanOrEqual(6);
    expect(sql).toMatch(/revoke\s+insert,\s*update,\s*delete[\s\S]*authenticated/i);
    expect(sql).toContain('request_instance_can_select');
    expect(sql).toContain("'workflow-templates'");
    expect(sql).toContain('storage.objects');
  });

  it('adds request to shared workflow subjects and CANCELLED assignments', () => {
    expect(sql).toContain("'request'");
    expect(sql).toContain("'CANCELLED'");
    expect(sql).toContain('assignment_round_id');
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận RED**

Run: `npx vitest run lib/__tests__/requestApprovalMigration.test.ts`

Expected: FAIL vì migration chưa có nội dung.

- [ ] **Step 4: Ghi schema, constraints và index**

Migration phải:

1. Tạo đúng bảng/cột trong design.
2. Alter `request_instances` hiện hữu theo hướng additive: thêm `request_template_id`, `request_template_version_id`, `workflow_template_version_id`, `workflow_instance_id`, `workflow_subject_id`, snapshot JSONB, `due_at` và timestamps; giữ cột legacy nhưng không dùng.
3. Alter `request_print_templates` thêm `request_template_version_id`, `validation_status`, `placeholder_schema`.
4. Tạo bảng hỗ trợ trong schema không expose `app_private`:
   - `request_command_idempotency` với unique `(actor_id, idempotency_key)`.
   - `request_notification_outbox` với unique `event_key`, trạng thái delivery và retry metadata.
   - `request_export_audit` với request, actor, format, template version, result và error.
5. Không grant trực tiếp các bảng private cho `anon` hoặc `authenticated`.
6. Tạo các index:

```sql
create unique index if not exists ux_request_instances_code
  on public.request_instances(code);
create index if not exists idx_request_instances_created_cursor
  on public.request_instances(created_at desc, id desc);
create index if not exists idx_request_instances_status_cursor
  on public.request_instances(status, created_at desc, id desc);
create index if not exists idx_request_instances_pending_due
  on public.request_instances(due_at, id)
  where status = 'PENDING' and due_at is not null;
create index if not exists idx_request_instances_creator_cursor
  on public.request_instances(created_by, created_at desc, id desc);
create index if not exists idx_request_template_versions_template
  on public.request_template_versions(request_template_id, version_number desc);
create index if not exists idx_request_blocks_version_order
  on public.request_approval_blocks(request_template_version_id, sort_order);
create index if not exists idx_request_outbox_recipient_pending
  on app_private.request_notification_outbox(recipient_user_id, available_at, id)
  where status in ('PENDING', 'FAILED');
create index if not exists idx_request_template_scope_gin
  on public.request_template_versions using gin(usage_scope jsonb_path_ops);
```

7. Tạo index cho mọi cột foreign key còn lại, kể cả watcher user, current version và ba liên kết workflow.
8. Tạo check constraints bằng `DO`/`pg_constraint`, không dùng `ADD CONSTRAINT IF NOT EXISTS`.
9. Bật RLS cho mọi bảng mới trong `public`.
10. Tạo helper `app_private.request_template_version_can_use(uuid, uuid)` và `app_private.request_instance_can_select(uuid, uuid)`. Scope helper hợp bốn nguồn: company-wide; `employees.department_id`/`employees.org_unit_id` qua `employees.user_id`; active permission grant theo `permissionCodes`; và user ID cụ thể.
11. Policy select dùng `(select public.current_app_user_id())` một lần và index participant/creator.
12. Template/version/block/watcher: bản published chỉ hiện khi user thuộc usage scope; draft và deactivated chỉ hiện cho template manager/Admin.
13. Instance: chỉ creator, approver hiện tại/đã từng tham gia, watcher hoặc template manager/Admin; dùng cùng helper cho detail RPC để trả `REQUEST_NOT_FOUND_OR_FORBIDDEN`.
14. Revoke `public, anon`; grant `select` cho `authenticated`; không grant direct write.
15. Đảm bảo bucket `workflow-templates` là private. Object path được dựng bằng `request-template-versions/${requestTemplateVersionId}/template.docx`; storage policy cho phép `request.template.manage` upload/update và cho phép select khi user quản trị mẫu hoặc có quyền xem ít nhất một request snapshot dùng version đó.

- [ ] **Step 5: Chạy test và kiểm tra định dạng**

Run:

```bash
npx vitest run lib/__tests__/requestApprovalMigration.test.ts
git diff --check -- "$REQUEST_SCHEMA_MIGRATION"
```

Expected: PASS.

- [ ] **Step 6: Apply local, lint và chạy advisor**

Run:

```bash
npx supabase --version
npx supabase db reset --local
npx supabase db lint --local --level warning --fail-on warning
```

Sau khi push lên Supabase branch/staging, chạy Security Advisor và Performance Advisor bằng Supabase MCP `get_advisors` nếu connector khả dụng, nếu không dùng cùng hai mục trong Dashboard. Lưu output vào PR.

Expected: migration apply thành công; db lint sạch; advisor không có cảnh báo RLS/index mới liên quan bảng Request.

- [ ] **Step 7: Commit**

```bash
git add "$REQUEST_SCHEMA_MIGRATION" lib/__tests__/requestApprovalMigration.test.ts
git commit -m "feat(request): add versioned approval schema"
```

### Task 4: Publish Request Templates into Workflow Versions

**Files:**

- Create via CLI: output of `npx supabase migration new request_template_publish_phase1`; call it `$REQUEST_PUBLISH_MIGRATION`
- Create: `lib/requestTemplateService.ts`
- Create: `lib/__tests__/requestTemplateService.test.ts`
- Modify: `lib/__tests__/requestApprovalMigration.test.ts`

**Interfaces:**

```ts
export interface SaveRequestTemplateDraftInput {
  templateId?: string;
  expectedUpdatedAt?: string;
  name: string;
  description: string;
  formSchema: RequestTemplateFieldSchema[];
  usageScope: {
    companyWide: boolean;
    orgUnitIds: string[];
    permissionCodes: string[];
    userIds: string[];
  };
  flowMode: RequestFlowMode;
  completionPolicy: RequestCompletionPolicy;
  requestSlaHours?: number | null;
  blocks: RequestApprovalBlock[];
  watcherUserIds: string[];
  printConfig: {
    browserPrintEnabled: boolean;
    docxStoragePath: string | null;
  };
  notificationConfig: Record<string, boolean>;
}

export interface RequestTemplateDraftRecord {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'DEACTIVATED';
  versionNumber: number | null;
  updatedAt: string;
  payload: SaveRequestTemplateDraftInput;
}

export interface RequestTemplateSummary {
  id: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED' | 'DEACTIVATED';
  publishedVersionNumber: number | null;
  usageScopeLabel: string;
  updatedAt: string;
}

export interface PublishRequestTemplateInput {
  templateId: string;
  expectedUpdatedAt: string;
}

export interface RequestResolverPreview {
  sampleCreatorId: string;
  blocks: Array<{
    blockKey: string;
    source: RequestApproverSource;
    resolvedUserIds: string[];
    errorCode: 'REQUEST_DIRECT_MANAGER_MISSING' | 'REQUEST_APPROVER_INACTIVE' | null;
  }>;
}

export interface PublishRequestTemplateResult {
  requestTemplateId: string;
  requestTemplateVersionId: string;
  versionNumber: number;
  workflowTemplateId: string;
  workflowTemplateVersionId: string;
}
```

- [ ] **Step 1: Tạo migration bằng CLI và viết service test RED**

```bash
npx supabase migration new request_template_publish_phase1
REQUEST_PUBLISH_MIGRATION="$(ls -t supabase/migrations/*_request_template_publish_phase1.sql | head -1)"
```

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));
import { requestTemplateService } from '../requestTemplateService';

describe('requestTemplateService', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('publishes through the atomic template command', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        requestTemplateId: 'rt-1',
        requestTemplateVersionId: 'rtv-1',
        versionNumber: 1,
        workflowTemplateId: 'wf-1',
        workflowTemplateVersionId: 'wfv-1',
      },
      error: null,
    });
    await requestTemplateService.publish({
      templateId: 'rt-1',
      expectedUpdatedAt: '2026-07-28T10:00:00.000Z',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('publish_request_template_version', {
      p_request_template_id: 'rt-1',
      p_expected_updated_at: '2026-07-28T10:00:00.000Z',
    });
  });
});
```

- [ ] **Step 2: Chạy RED**

Run: `npx vitest run lib/__tests__/requestTemplateService.test.ts`

Expected: FAIL vì service chưa tồn tại.

- [ ] **Step 3: Implement draft/publish RPC**

Migration tạo:

```sql
app_private.save_request_template_draft(p_payload jsonb) returns jsonb
app_private.publish_request_template_version(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
) returns jsonb
public.save_request_template_draft(p_payload jsonb) returns jsonb
public.publish_request_template_version(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
) returns jsonb
public.get_request_template_draft(p_request_template_id uuid) returns jsonb
public.list_request_templates(p_filters jsonb) returns jsonb
public.create_request_template_draft_from_published(p_request_template_id uuid) returns jsonb
public.deactivate_request_template(p_request_template_id uuid, p_expected_updated_at timestamptz) returns jsonb
public.preview_request_template_resolvers(p_payload jsonb, p_sample_creator_id uuid) returns jsonb
```

Publish command phải:

- Kiểm `request.template.manage`.
- Lock `request_templates`.
- So sánh `updated_at` với `p_expected_updated_at`; mismatch trả mã lỗi `CONFLICT`.
- Validate form, scope, block, active fixed users, SLA.
- Nếu có DOCX, yêu cầu print template cùng draft version có `validation_status = 'VALID'` và placeholder schema không chứa field key lạ.
- Tạo version number `max + 1` trong cùng lock.
- Upsert một hidden `workflow_template`.
- Tạo START, TASK cho từng block, END và edges.
- Ghi node config:

```json
{
  "executionPolicy": "AUTO_ADVANCE_APPROVAL",
  "requestBlockKey": "manager",
  "approverSource": "DIRECT_MANAGER",
  "fixedUserIds": [],
  "slaHours": 4
}
```

- Tạo `workflow_template_versions` snapshot.
- Chuyển request version `PUBLISHED`, version cũ `SUPERSEDED`.
- Trả JSONB camelCase đúng interface.

Public wrapper mẫu:

```sql
create or replace function public.publish_request_template_version(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.publish_request_template_version(
    p_request_template_id,
    p_expected_updated_at
  );
$$;
```

- [ ] **Step 4: Implement client service**

```ts
const run = async <T>(name: string, payload: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, payload);
  if (error) throw error;
  if (!data) throw new Error(`${name} không trả về dữ liệu.`);
  return data as T;
};

export const requestTemplateService = {
  getDraft(templateId: string) {
    return run<RequestTemplateDraftRecord>('get_request_template_draft', {
      p_request_template_id: templateId,
    });
  },
  list(filters: { status?: 'DRAFT' | 'PUBLISHED' | 'DEACTIVATED'; search?: string } = {}) {
    return run<{ items: RequestTemplateSummary[] }>('list_request_templates', {
      p_filters: filters,
    });
  },
  saveDraft(input: SaveRequestTemplateDraftInput) {
    return run<RequestTemplateDraftRecord>('save_request_template_draft', {
      p_payload: input,
    });
  },
  publish(input: PublishRequestTemplateInput) {
    return run<PublishRequestTemplateResult>('publish_request_template_version', {
      p_request_template_id: input.templateId,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
  },
  createDraftFromPublished(templateId: string) {
    return run<RequestTemplateDraftRecord>(
      'create_request_template_draft_from_published',
      { p_request_template_id: templateId },
    );
  },
  deactivate(input: PublishRequestTemplateInput) {
    return run<RequestTemplateSummary>('deactivate_request_template', {
      p_request_template_id: input.templateId,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
  },
  previewResolvers(input: SaveRequestTemplateDraftInput, sampleCreatorId: string) {
    return run<RequestResolverPreview>('preview_request_template_resolvers', {
      p_payload: input,
      p_sample_creator_id: sampleCreatorId,
    });
  },
};
```

- [ ] **Step 5: Chạy test, reset local, smoke publish**

Run:

```bash
npx vitest run lib/__tests__/requestTemplateService.test.ts \
  lib/__tests__/requestApprovalMigration.test.ts
npx supabase db reset --local
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "$REQUEST_PUBLISH_MIGRATION" lib/requestTemplateService.ts \
  lib/__tests__/requestTemplateService.test.ts \
  lib/__tests__/requestApprovalMigration.test.ts
git commit -m "feat(request): publish templates into workflow versions"
```

### Task 5: Submit Requests with Sequence, Scope and Approver Snapshot

**Files:**

- Create via CLI: output of `npx supabase migration new request_submit_phase1`; call it `$REQUEST_SUBMIT_MIGRATION`
- Create: `lib/requestRuntimeService.ts`
- Create: `lib/__tests__/requestRuntimeService.test.ts`

**Interfaces:**

```ts
export interface SubmitRequestInput {
  requestTemplateVersionId: string;
  title: string;
  description: string;
  formData: Record<string, unknown>;
  dynamicApproversByBlock: Record<string, string[]>;
  idempotencyKey: string;
}

export interface RequestCommandResult {
  requestId: string;
  requestCode: string;
  status: RequestRuntimeStatus;
  workflowInstanceId: string;
  workflowSubjectId: string;
  currentBlockKeys: string[];
  updatedAt: string;
}
```

- [ ] **Step 1: Tạo migration và service test RED**

```bash
npx supabase migration new request_submit_phase1
REQUEST_SUBMIT_MIGRATION="$(ls -t supabase/migrations/*_request_submit_phase1.sql | head -1)"
```

```ts
it('submits one immutable request snapshot', async () => {
  mocks.rpc.mockResolvedValue({
    data: {
      requestId: 'rq-1',
      requestCode: 'RQ-2026-000001',
      status: 'PENDING',
      workflowInstanceId: 'wf-1',
      workflowSubjectId: 'ws-1',
      currentBlockKeys: ['manager'],
      updatedAt: '2026-07-28T10:00:00.000Z',
    },
    error: null,
  });

  await requestRuntimeService.submit({
    requestTemplateVersionId: 'rtv-1',
    title: 'Đề xuất cấp tài khoản',
    description: 'Nội dung',
    formData: { employee_name: 'Nguyễn Văn A' },
    dynamicApproversByBlock: {},
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  });

  expect(mocks.rpc).toHaveBeenCalledWith('submit_request', expect.objectContaining({
    p_request_template_version_id: 'rtv-1',
    p_idempotency_key: '11111111-1111-4111-8111-111111111111',
  }));
});
```

- [ ] **Step 2: Chạy RED**

Run: `npx vitest run lib/__tests__/requestRuntimeService.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement submit transaction**

Migration tạo:

```sql
app_private.next_request_code() returns text
app_private.resolve_request_block_approvers(
  p_block_id uuid,
  p_creator_id uuid,
  p_dynamic_user_ids uuid[]
) returns uuid[]
app_private.submit_request(...) returns jsonb
public.submit_request(...) returns jsonb
```

`submit_request` phải:

1. Kiểm idempotency key trước khi cấp mã.
2. Kiểm published version và usage scope.
3. Validate form required fields.
4. Resolve từng block và xác nhận user active/cùng công ty.
5. Lock counter row; cấp `RQ-YYYY-NNNNNN`.
6. Tạo `request_instances`.
7. Tạo `workflow_instances` policy `AUTO_ADVANCE_APPROVAL`.
8. Snapshot workflow nodes/edges.
9. Tạo `workflow_subjects(subject_type='request')`.
10. Tạo participant `CREATOR`, `WATCHER`, `ASSIGNEE`.
11. Với sequential chỉ tạo assignment block 1; parallel tạo mọi block.
12. Ghi `assignment_round_id`, SLA/due_at từng assignment và `request_instances.due_at` từ SLA toàn đề xuất.
13. Ghi outbox cho approver.
14. Ghi idempotency result và trả JSON.

Sequence body dùng upsert nguyên tử:

```sql
insert into public.request_sequence_counters(year, last_value)
values (extract(year from now())::integer, 1)
on conflict (year) do update
set last_value = public.request_sequence_counters.last_value + 1,
    updated_at = now()
returning last_value;
```

- [ ] **Step 4: Implement service wrapper**

```ts
export const requestRuntimeService = {
  async submit(input: SubmitRequestInput): Promise<RequestCommandResult> {
    const { data, error } = await supabase.rpc('submit_request', {
      p_request_template_version_id: input.requestTemplateVersionId,
      p_title: input.title,
      p_description: input.description,
      p_form_data: input.formData,
      p_dynamic_approvers_by_block: input.dynamicApproversByBlock,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return assertRequestCommandResult(data);
  },
};
```

- [ ] **Step 5: Chạy test và local reset**

Run:

```bash
npx vitest run lib/__tests__/requestRuntimeService.test.ts
npx supabase db reset --local
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "$REQUEST_SUBMIT_MIGRATION" lib/requestRuntimeService.ts \
  lib/__tests__/requestRuntimeService.test.ts
git commit -m "feat(request): submit workflow-backed requests"
```

### Task 6: Implement Atomic Approval Actions

**Files:**

- Create via CLI: output of `npx supabase migration new request_actions_phase1`; call it `$REQUEST_ACTIONS_MIGRATION`
- Modify: `lib/requestRuntimeService.ts`
- Modify: `lib/__tests__/requestRuntimeService.test.ts`
- Modify: `lib/__tests__/requestApprovalMigration.test.ts`

**Interfaces:**

```ts
export type RequestAction =
  | 'APPROVE' | 'REJECT' | 'RETURN'
  | 'RESUBMIT' | 'CANCEL' | 'REASSIGN';

export interface ActOnRequestInput {
  requestId: string;
  action: RequestAction;
  comment?: string;
  formData?: Record<string, unknown>;
  assigneeUserId?: string;
  idempotencyKey: string;
  expectedUpdatedAt: string;
}

export type RequestRpcErrorCode =
  | 'REQUEST_STALE_STATE'
  | 'REQUEST_ACTION_FORBIDDEN'
  | 'REQUEST_ASSIGNMENT_NOT_ACTIVE'
  | 'REQUEST_ALREADY_PROCESSED'
  | 'REQUEST_APPROVER_INACTIVE'
  | 'REQUEST_DIRECT_MANAGER_MISSING'
  | 'REQUEST_DYNAMIC_APPROVER_REQUIRED'
  | 'REQUEST_TEMPLATE_NOT_PUBLISHED'
  | 'REQUEST_TEMPLATE_OUT_OF_SCOPE'
  | 'REQUEST_PRINT_TEMPLATE_INVALID'
  | 'REQUEST_IDEMPOTENCY_CONFLICT'
  | 'REQUEST_NOT_FOUND_OR_FORBIDDEN';
```

- [ ] **Step 1: Tạo migration và thêm service test RED**

```bash
npx supabase migration new request_actions_phase1
REQUEST_ACTIONS_MIGRATION="$(ls -t supabase/migrations/*_request_actions_phase1.sql | head -1)"
```

```ts
it('sends approve with stale-state and idempotency guards', async () => {
  mocks.rpc.mockResolvedValue({
    data: {
      requestId: 'rq-1',
      requestCode: 'RQ-2026-000001',
      status: 'APPROVED',
      workflowInstanceId: 'wf-1',
      workflowSubjectId: 'ws-1',
      currentBlockKeys: [],
      updatedAt: '2026-07-28T10:01:00.000Z',
    },
    error: null,
  });
  await requestRuntimeService.act({
    requestId: 'rq-1',
    action: 'APPROVE',
    comment: 'Đồng ý',
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    expectedUpdatedAt: '2026-07-28T00:00:00.000Z',
  });
  expect(mocks.rpc).toHaveBeenCalledWith('act_on_request', expect.objectContaining({
    p_request_id: 'rq-1',
    p_action: 'APPROVE',
    p_expected_updated_at: '2026-07-28T00:00:00.000Z',
  }));
});
```

- [ ] **Step 2: Chạy RED**

Run: `npx vitest run lib/__tests__/requestRuntimeService.test.ts`

Expected: FAIL vì `act` chưa có.

- [ ] **Step 3: Implement action RPC**

Tạo:

```sql
app_private.act_on_request(...) returns jsonb
app_private.activate_request_block(...) returns void
app_private.close_request_pending_assignments(...) returns void
public.act_on_request(...) returns jsonb
```

Command phải:

- Lock theo Global Constraints.
- So sánh `expected_updated_at`; lệch thì raise `REQUEST_STALE_STATE`.
- Xác thực assignment `PENDING` của actor.
- `APPROVE`:
  - `ANY_ONE`: assignment khác `SKIPPED`.
  - `SEQUENTIAL`: nếu block hoàn tất thì tự kích hoạt block tiếp.
  - Hết block thì `APPROVED`.
- `REJECT`: comment bắt buộc, request `REJECTED`, pending khác `CANCELLED`.
- `RETURN`: comment bắt buộc, request `RETURNED`, pending current round `CANCELLED`, lưu returned block.
- `RESUBMIT`: chỉ creator; cập nhật form snapshot được phép, tạo round mới đúng block, giữ assignment `APPROVED`.
- `CANCEL`: chỉ creator/Admin khi chưa terminal.
- `REASSIGN`: chỉ template manager/Admin; comment và `assignee_user_id` bắt buộc, user mới phải active/cùng công ty, assignment cũ `CANCELLED`, assignment mới giữ nguyên block/round/SLA còn lại.
- Mọi action ghi assignment, participant, workflow subject, workflow instance, audit và outbox trong một transaction.
- Idempotency replay trả đúng result cũ.
- `mapRequestRpcError` chỉ ánh xạ các code ổn định ở interface trên; message database được giữ làm diagnostic nội bộ, UI dùng bản dịch theo code.

- [ ] **Step 4: Implement service**

```ts
async act(input: ActOnRequestInput): Promise<RequestCommandResult> {
  const { data, error } = await supabase.rpc('act_on_request', {
    p_request_id: input.requestId,
    p_action: input.action,
    p_comment: input.comment ?? null,
    p_form_data: input.formData ?? null,
    p_assignee_user_id: input.assigneeUserId ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) throw mapRequestRpcError(error);
  return assertRequestCommandResult(data);
}
```

- [ ] **Step 5: Thêm migration assertions**

```ts
expect(sql).toContain('for update');
expect(sql).toContain('REQUEST_STALE_STATE');
expect(sql).toContain('REQUEST_ALREADY_PROCESSED');
expect(sql).toContain("'CANCELLED'");
expect(sql).toContain('assignment_round_id');
```

- [ ] **Step 6: Chạy test**

Run:

```bash
npx vitest run lib/__tests__/requestRuntimeService.test.ts \
  lib/__tests__/requestApprovalMigration.test.ts
npx supabase db reset --local
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "$REQUEST_ACTIONS_MIGRATION" lib/requestRuntimeService.ts \
  lib/__tests__/requestRuntimeService.test.ts \
  lib/__tests__/requestApprovalMigration.test.ts
git commit -m "feat(request): add atomic approval transitions"
```

### Task 7: Add Cursor Queries, Detail Capabilities and Smoke Coverage

**Files:**

- Create via CLI: output of `npx supabase migration new request_queries_phase1`; call it `$REQUEST_QUERIES_MIGRATION`
- Modify: `lib/requestRuntimeService.ts`
- Modify: `lib/__tests__/requestRuntimeService.test.ts`
- Create: `supabase/tests/request_approval_phase1_smoke.sql`
- Modify: `package.json`

**Interfaces:**

```ts
export interface RequestListFilters {
  view: 'ALL' | 'ASSIGNED_TO_ME' | 'CREATED_BY_ME' | 'WATCHING';
  status?: 'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  overdue?: boolean;
  search?: string;
  templateId?: string;
  cursor?: { createdAt: string; id: string };
  limit: number;
}

export interface RequestListPage {
  items: RequestListItem[];
  nextCursor?: { createdAt: string; id: string };
}

export interface RequestActionCapabilities {
  canApprove: boolean;
  canReject: boolean;
  canReturn: boolean;
  canResubmit: boolean;
  canCancel: boolean;
  canReassign: boolean;
  canPrint: boolean;
}

export interface RequestUserSnapshot {
  id: string;
  name: string;
  avatarUrl: string | null;
  position: string | null;
}

export interface RequestListItem {
  id: string;
  code: string;
  title: string;
  status: RequestRuntimeStatus;
  templateId: string;
  templateName: string;
  creator: RequestUserSnapshot;
  activeApprovers: Array<RequestUserSnapshot & { assignmentStatus: RequestAssignmentStatus }>;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestApprovalBlockSnapshot {
  key: string;
  name: string;
  sortOrder: number;
  status: 'NOT_ACTIVE' | 'ACTIVE' | 'COMPLETED' | 'RETURNED' | 'CANCELLED';
  slaHours: number | null;
  assignments: Array<{
    id: string;
    roundId: string;
    approver: RequestUserSnapshot;
    status: RequestAssignmentStatus;
    actedAt: string | null;
    comment: string | null;
  }>;
}

export interface RequestDetail extends RequestListItem {
  description: string;
  templateVersionId: string;
  templateVersionNumber: number;
  flowMode: RequestFlowMode;
  completionPolicy: RequestCompletionPolicy;
  formSchema: RequestTemplateFieldSchema[];
  formData: Record<string, unknown>;
  approvalBlocks: RequestApprovalBlockSnapshot[];
  watcherIds: string[];
  timeline: Array<{
    id: string;
    eventType: string;
    actor: RequestUserSnapshot | null;
    comment: string | null;
    createdAt: string;
  }>;
  printConfig: {
    browserPrintEnabled: boolean;
    docxStoragePath: string | null;
  };
  capabilities: RequestActionCapabilities;
}

export interface RequestSummary {
  all: number;
  assignedToMe: number;
  createdByMe: number;
  watching: number;
  pending: number;
  returned: number;
  overdue: number;
  approved: number;
  rejected: number;
}
```

- [ ] **Step 1: Tạo migration và service test RED**

```bash
npx supabase migration new request_queries_phase1
REQUEST_QUERIES_MIGRATION="$(ls -t supabase/migrations/*_request_queries_phase1.sql | head -1)"
```

Test:

```ts
it('requests the next page with a composite cursor', async () => {
  mocks.rpc.mockResolvedValue({ data: { items: [], nextCursor: null }, error: null });
  await requestRuntimeService.list({
    view: 'ASSIGNED_TO_ME',
    status: 'PENDING',
    cursor: { createdAt: '2026-07-28T10:00:00Z', id: 'rq-9' },
    limit: 50,
  });
  expect(mocks.rpc).toHaveBeenCalledWith('list_request_instances', {
    p_filters: expect.objectContaining({
      view: 'ASSIGNED_TO_ME',
      status: 'PENDING',
      cursorCreatedAt: '2026-07-28T10:00:00Z',
      cursorId: 'rq-9',
    }),
    p_limit: 50,
  });
});
```

- [ ] **Step 2: Chạy RED**

Run: `npx vitest run lib/__tests__/requestRuntimeService.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement query RPCs**

Migration tạo:

```sql
public.list_request_instances(p_filters jsonb, p_limit integer default 50) returns jsonb
public.get_request_detail(p_request_id uuid) returns jsonb
public.get_request_summary() returns jsonb
```

Yêu cầu:

- `p_limit` clamp `1..100`.
- Cursor condition:

```sql
and (
  v_cursor_created_at is null
  or (r.created_at, r.id) < (v_cursor_created_at, v_cursor_id)
)
order by r.created_at desc, r.id desc
limit v_limit + 1
```

- `view` được áp dụng ở server: active assignment, creator hoặc participant watcher.
- `overdue` dùng request hoặc assignment active có `due_at < now()`; không tin cờ overdue từ client.
- Search dùng code/title; không thêm full-text index ở Phase 1 nếu dữ liệu nhỏ.
- Detail trả request snapshot, assignments, participants, timeline, print templates và server capabilities.
- Summary trả counts theo trạng thái và “cần tôi duyệt”.
- Query đi qua `request_instance_can_select`.

- [ ] **Step 4: Implement service methods**

```ts
list(filters: RequestListFilters): Promise<RequestListPage>
getDetail(requestId: string): Promise<RequestDetail>
getSummary(): Promise<RequestSummary>
```

- [ ] **Step 5: Viết SQL smoke test**

Smoke phải tạo:

1. Admin, creator, manager, hai director và outsider.
2. Mẫu sequential `ALL`: manager → directors.
3. Submit và kiểm code `RQ-2026-000001`.
4. Manager approve, kiểm director block tự kích hoạt.
5. Director return, creator resubmit, kiểm round mới.
6. Hai director approve, kiểm request `APPROVED`.
7. Mẫu parallel `ANY_ONE`, một người approve, người còn lại `SKIPPED`.
8. Reject immediate, pending còn lại `CANCELLED`.
9. Outsider không select được request.
10. Idempotency replay không tạo thêm assignment/code.

- [ ] **Step 6: Thêm script**

```json
"smoke:request": "npx supabase db query --local -f supabase/tests/request_approval_phase1_smoke.sql"
```

- [ ] **Step 7: Chạy full runtime gate**

Run:

```bash
npx vitest run \
  lib/__tests__/requestApprovalDomain.test.ts \
  lib/__tests__/requestDirectManagerProfile.test.ts \
  lib/__tests__/requestDirectManagerMigration.test.ts \
  lib/__tests__/requestApprovalMigration.test.ts \
  lib/__tests__/requestTemplateService.test.ts \
  lib/__tests__/requestRuntimeService.test.ts
npm run lint
npm run build
npm run smoke:request
npx supabase db lint --local --level warning --fail-on warning
```

Expected: toàn bộ command PASS. Chạy lại Security/Performance Advisor trên branch/staging và đính kèm output không có cảnh báo mới cho schema Request.

- [ ] **Step 8: Commit**

```bash
git add "$REQUEST_QUERIES_MIGRATION" lib/requestRuntimeService.ts \
  lib/__tests__/requestRuntimeService.test.ts \
  supabase/tests/request_approval_phase1_smoke.sql package.json
git commit -m "feat(request): add secure request query API"
```

## Runtime Foundation Completion Gate

- [ ] `git status --short` chỉ còn thay đổi chủ ý.
- [ ] `npm run lint`, `npm test`, `npm run build` PASS.
- [ ] `npm run smoke:request` PASS trên local Supabase.
- [ ] `npx supabase db lint --local --level warning --fail-on warning` không có lỗi schema/RLS nghiêm trọng.
- [ ] Security Advisor và Performance Advisor trên Supabase branch/staging không có warning mới liên quan schema Request.
- [ ] Mỗi migration có grant/revoke và index foreign key.
- [ ] Không có client write trực tiếp vào request/workflow runtime.
- [ ] Commit cuối ghi lại gate:

```bash
git commit --allow-empty -m "test(request): verify runtime foundation gate"
```

# Vioo Work Pilot Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện trải nghiệm Vioo Work đã duyệt: công việc con đầy đủ, lịch dự kiến bắt đầu/kết thúc, quản lý watcher tại detail, bố cục bốn vùng có thanh thao tác luôn hiển thị, preview ảnh/PDF/TXT, mention trong dòng và nghiệm thu notification pilot an toàn.

**Architecture:** Giữ `work_tasks` là aggregate duy nhất và thêm quan hệ cha–con một cấp cùng `planned_start_at`; mọi mutation tiếp tục đi qua RPC có capability, expected version, idempotency, event và outbox. UI detail được tách thành các component nhỏ nhưng tái sử dụng `WorkMutationSession`, attachment service và feed hiện có; quyền luôn do server quyết định. Notification chỉ được bật sau một checkpoint xem xét backlog/người nhận và có xác nhận gửi tới tài khoản thật.

**Tech Stack:** React 18, TypeScript 5.8, React Router 6, Supabase Cloud/PostgreSQL/RLS/RPC/Storage/Edge Functions, Vitest, Playwright Chrome, Vite.

**Spec:** `docs/superpowers/specs/2026-09-08-vioo-work-pilot-feedback-design.md`

## Global Constraints

- Làm trong `/Users/admin/khotienthinh/.worktrees/vioo-work-r1a`, branch `feature/vioo-work-r1a`.
- Repository yêu cầu agent chính tự thực hiện; không dùng sub-agent. Khi thi công dùng `superpowers:executing-plans`.
- Mọi thao tác Supabase dùng linked Supabase Cloud với `.env` ở repository root; không dùng Supabase local hoặc Docker.
- Migration đã apply không được sửa; thay đổi schema bằng forward migration mới.
- Mỗi migration: Cloud rollback smoke → commit release candidate → linked dry-run → apply đúng candidate → postflight.
- Notification gate giữ `enabled=false` cho đến checkpoint có xác nhận rõ việc gửi tới người thật và cách xử lý 15 outbox events hiện tại.
- Không tạo handoff nếu người dùng chưa yêu cầu.
- Cha hoàn thành độc lập; chỉ cảnh báo còn con mở. Không cascade trạng thái, người nhận, lịch hoặc deadline sang con.
- Chỉ hỗ trợ một cấp cha–con trong đợt này. Checklist và công việc con là hai khái niệm độc lập.
- Upload allowlist giữ JPEG/PNG/WebP/PDF/TXT; không thêm viewer bên thứ ba hoặc Office preview.
- Thanh thao tác luôn hiện, dùng cùng một mutation session/capability, không tạo hai bộ handler có thể gửi lặp.
- Feature phải không tràn ngang và dùng được bằng bàn phím ở 360x800, 768x1024 và 1440x900; kiểm thêm thanh thao tác ở 320x700.

---

## File map

**Database and Cloud verification**

- Create `supabase/migrations/20260908052000_work_task_children_schedule_watchers.sql`: quan hệ cha–con, lịch dự kiến, read projection, capability và command lịch/watcher.
- Create `supabase/migrations/20260908060000_work_inline_comment_mentions.sql`: document mention node, server extraction/validation và event diff.
- Create `supabase/tests/work_task_children_schedule_watchers_smoke.sql`: quyền, lifecycle, aggregate, cascade denial, schedule và watcher.
- Create `supabase/tests/work_inline_comment_mentions_smoke.sql`: parser, quyền, edit diff và notification event.
- Create `scripts/inspect-work-notification-pilot.mjs`: inventory backlog/recipient read-only, không bật delivery.
- Modify `supabase/tests/work_r1a_notification_delivery_smoke.sql`: regression event mới và quyền thu hồi.

**TypeScript contracts and services**

- Modify `lib/work/workTypes.ts`: planned schedule, parent/child summary, child aggregate, schedule/watcher commands, mention node.
- Modify `lib/work/workTaskService.ts`: children/candidate reads và command wrappers.
- Modify `lib/work/workForm.ts`: document text/mention helpers, schedule validation, new errors.
- Modify `lib/work/workMutation.ts`: giữ nguyên single pending request nhưng nhận các collaboration command mới qua union.
- Modify `lib/work/workAttachmentService.ts`: đọc preview với MIME metadata và abort-safe result.
- Add/modify focused tests in `lib/__tests__/workTaskService.test.ts`, `workDetailService.test.ts`, `workForm.test.ts`, `workAttachmentService.test.ts`.

**React UI**

- Create `pages/work/WorkTaskHeader.tsx`: tags, scope/group, planned range, actual completion và edit schedule.
- Create `pages/work/WorkTaskChildren.tsx`: progress, paging, child navigation/create and parent completion warning data.
- Create `pages/work/WorkTaskPeople.tsx`: creator/assignees/reviewer/watchers, add/remove picker and mobile sheet content.
- Create `pages/work/WorkTaskSection.tsx`: section shell shared by description/result/children/discussion.
- Create `pages/work/WorkAttachmentPreview.tsx`: image/PDF/TXT viewer, expiry and focus behavior.
- Create `pages/work/WorkMentionComposer.tsx`: inline token editor with keyboard suggestions.
- Modify `pages/work/WorkDetail.tsx`: compose the approved information hierarchy.
- Modify `pages/work/WorkActions.tsx`: persistent single action bar and open-child warning before parent completion.
- Modify `pages/work/WorkAttachments.tsx`: route supported files to the preview component.
- Modify `pages/work/WorkDiscussion.tsx`: replace separate mention row with inline composer.
- Modify `pages/work/WorkCreateDrawer.tsx`: planned start/end labels and parent context.
- Modify `pages/work/WorkPage.tsx`: desktop task rail, child route/context and scroll ownership.
- Modify `pages/work/work.css`: approved desktop/tablet/mobile layout and persistent bar.

**Browser fixtures, QA and release evidence**

- Modify `tests/work/task8-fixture.tsx`: new types/services, children, schedule, watcher and inline mention fixture behavior.
- Modify `tests/work/workspace-fixture.tsx`: child creation within Workspace and member watcher candidates.
- Modify `scripts/verify-work-task8-browser.mjs` and `scripts/verify-work-task9-browser.mjs`.
- Create `scripts/verify-work-task-detail-redesign-browser.mjs`: approved layout, persistent bar, viewer, mention and child flows.
- Modify `scripts/verify-work-refresh-browser.mjs`: draft/focus/scroll survival for the new composer and action bar.
- Modify `docs/runbooks/vioo-work-r1a-rollout.md`: evidence only after each command succeeds.

---

### Task 1: Freeze the approved contracts with failing tests

**Files:**
- Modify: `lib/work/workTypes.ts`
- Modify: `lib/work/workForm.ts`
- Modify: `lib/__tests__/workTaskService.test.ts`
- Modify: `lib/__tests__/workDetailService.test.ts`
- Create: `lib/__tests__/workPilotFeedbackContracts.test.ts`

**Interfaces:**
- Consumes: existing `WorkTask`, `CreateWorkTaskInput`, `WorkTaskDetail`, `WorkCollaborationCommand`.
- Produces: `plannedStartAt`, `parentTaskId`, `WorkTaskChildSummary`, `WorkTaskChildrenPage`, `WorkMentionNode`, `validateWorkSchedule()`.

- [x] **Step 1: Add failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  documentText,
  mentionedUserIds,
  validateWorkSchedule,
  workDocument,
} from "../work/workForm";

describe("Work pilot feedback contracts", () => {
  it("keeps planned schedule distinct from actual execution", () => {
    expect(validateWorkSchedule("2026-09-08T08:00:00Z", "2026-09-10T10:00:00Z"))
      .toEqual({ plannedStartAt: "2026-09-08T08:00:00.000Z", deadlineAt: "2026-09-10T10:00:00.000Z" });
    expect(() => validateWorkSchedule("2026-09-11T08:00:00Z", "2026-09-10T10:00:00Z"))
      .toThrow("WORK_INVALID_SCHEDULE");
  });

  it("extracts stable mention ids from inline nodes", () => {
    const document = workDocument("Nhờ ");
    document.content[0].content.push({ type: "mention", userId: "user-1", label: "Phạm Ngọc Sơn" });
    expect(documentText(document)).toBe("Nhờ @Phạm Ngọc Sơn");
    expect(mentionedUserIds(document)).toEqual(["user-1"]);
  });
});
```

- [x] **Step 2: Run the focused tests and capture RED**

Run:

```bash
npx vitest run lib/__tests__/workPilotFeedbackContracts.test.ts lib/__tests__/workTaskService.test.ts lib/__tests__/workDetailService.test.ts
```

Expected: compile/test failure because the new functions and node types do not exist.

- [x] **Step 3: Add exact TypeScript contracts**

```ts
export type WorkInlineNode =
  | { type: "text"; text: string; marks?: Array<{ type: "bold" | "italic" | "strike" | "code" }> }
  | { type: "mention"; userId: string; label: string };

export interface WorkTaskChildSummary extends WorkTaskSummary {
  parent_task_id: string;
  assignee_names: string[];
  attachment_count: number;
}

export interface WorkTaskChildAggregate {
  visibleTotal: number;
  visibleCompleted: number;
  visibleCancelled: number;
  visibleOpen: number;
}

export interface WorkTaskChildrenPage {
  items: WorkTaskChildSummary[];
  aggregate: WorkTaskChildAggregate;
  nextCursor: WorkTaskCursor | null;
}
```

Extend `CreateWorkTaskInput` with optional `plannedStartAt?: string` and
`parentTaskId?: string`; extend read projections with `planned_start_at` and
`parent_task_id`. Add `canCreateChild`, `canManageSchedule`, and
`canManageWatchers` to `WorkTaskCapabilities`. Add collaboration commands:

```ts
| { command: "schedule_update"; payload: { plannedStartAt: string | null; deadlineAt: string | null; expectedLockVersion: number } }
| { command: "watchers_update"; payload: { addUserIds: string[]; removeUserIds: string[]; expectedLockVersion: number } };
```

- [x] **Step 4: Implement schedule/document helpers**

```ts
export function validateWorkSchedule(plannedStartAt?: string | null, deadlineAt?: string | null) {
  const start = plannedStartAt ? new Date(plannedStartAt) : null;
  const end = deadlineAt ? new Date(deadlineAt) : null;
  if ((start && Number.isNaN(start.valueOf())) || (end && Number.isNaN(end.valueOf())) ||
      (start && end && start > end)) throw new Error("WORK_INVALID_SCHEDULE");
  return {
    plannedStartAt: start?.toISOString() ?? null,
    deadlineAt: end?.toISOString() ?? null,
  };
}
```

Update `documentText()` to render mention nodes as `@${label}` and add
`mentionedUserIds()` that returns stable, deduplicated IDs in document order.

- [x] **Step 5: Update existing service/detail fixtures and run GREEN**

Run the command from Step 2. Expected: all selected tests pass and old text-only
documents still round-trip unchanged.

- [x] **Step 6: Commit the contract checkpoint**

```bash
git add lib/work/workTypes.ts lib/work/workForm.ts lib/__tests__/workTaskService.test.ts lib/__tests__/workDetailService.test.ts lib/__tests__/workPilotFeedbackContracts.test.ts
git commit -m "test(work): define child schedule watcher and mention contracts"
```

### Task 2: Add child-task and planned-schedule database model

**Files:**
- Create: `supabase/migrations/20260908052000_work_task_children_schedule_watchers.sql`
- Create: `supabase/tests/work_task_children_schedule_watchers_smoke.sql`

**Interfaces:**
- Consumes: existing `public.work_tasks`, `app_private.work_task_actor_can_view`, `app_private.work_task_capabilities` and Workspace access helpers.
- Produces: `parent_task_id`, `planned_start_at`, `list_work_task_children(uuid,jsonb,integer)` and extended task detail/capabilities.

- [x] **Step 1: Write a rollback smoke that fails before the migration**

The smoke creates creator, assignee, watcher, scoped manager and unrelated personas,
then asserts:

```sql
select throws_ok(
  $$select public.list_work_task_children('00000000-0000-0000-0000-000000000001',null,30)$$,
  '42883'
);
```

After applying the candidate inside the rollback transaction, replace the
pre-migration assertion with concrete checks: one-level relation accepted;
self-parent, grandchild, cross-Workspace parent and mismatched scope/privacy
rejected; parent completion leaves an open child unchanged; restricted child is
absent from another reader's items and aggregate; cancelled children are reported
separately and excluded from the completion denominator.

- [x] **Step 2: Run the smoke without the migration and record RED**

```bash
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration /dev/null \
  --smoke supabase/tests/work_task_children_schedule_watchers_smoke.sql
```

Expected: missing column/function failure. The smoke transaction rolls back all fixtures.

- [x] **Step 3: Add columns and structural constraints in the forward migration**

```sql
alter table public.work_tasks
  add column parent_task_id uuid references public.work_tasks(id),
  add column planned_start_at timestamptz;

alter table public.work_tasks
  add constraint work_tasks_not_own_parent check (parent_task_id is distinct from id),
  add constraint work_tasks_planned_range_check
    check (planned_start_at is null or deadline_at is null or planned_start_at <= deadline_at);

create index work_tasks_parent_active_idx
  on public.work_tasks(parent_task_id, updated_at desc, id desc)
  where parent_task_id is not null;
```

Use a guarded trigger for constraints requiring parent lookup: parent has no
parent, same `workspace_id`, same canonical scope IDs and same privacy. Do not
copy or update parent/child rows in this trigger.

- [x] **Step 4: Extend create/detail/clone/list projections**

`app_private.work_create_task` validates `plannedStartAt` and `parentTaskId` before
insert. Parent creation authority requires parent visibility plus the same scope
create permission. Detail returns `childAggregate` from a permission-filtered
query. Clone carries `plannedStartAt` only when future and never carries
`parentTaskId` unless the caller explicitly creates a child from the parent flow.

Create `app_private.work_list_task_children()` and public invoker wrapper with
cursor `{sortAt,id}`, limit 1..100 and `app_private.work_task_actor_can_view()` in
both row and aggregate queries.

- [x] **Step 5: Run candidate and regressions in one Cloud rollback transaction**

```bash
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration supabase/migrations/20260908052000_work_task_children_schedule_watchers.sql \
  --smoke supabase/tests/work_task_children_schedule_watchers_smoke.sql \
  --smoke supabase/tests/work_r1a_task_commands_smoke.sql \
  --smoke supabase/tests/work_r1a_lifecycle_commands_smoke.sql \
  --smoke supabase/tests/work_workspace_task_access_smoke.sql
```

Expected: every smoke ends with its PASS sentinel; transaction rolls back.

- [x] **Step 6: Check query shape and security before commit**

Add EXPLAIN assertions for `parent_task_id` paging to the smoke, run
`npm run check:supabase-migrations`, `npm run audit:supabase-queries`, and
`npx --no-install supabase db advisors --linked --type security --level error --fail-on error`.
Expected: migration baseline includes one new active file, query audit has zero
errors, security advisor has no ERROR finding caused by the candidate.

- [x] **Step 7: Commit the database candidate**

```bash
git add supabase/migrations/20260908052000_work_task_children_schedule_watchers.sql supabase/tests/work_task_children_schedule_watchers_smoke.sql docs/performance/supabase-query-inventory.json
git commit -m "feat(work): add child tasks and planned schedules"
```

### Task 3: Add guarded schedule and watcher mutations

**Files:**
- Modify: `supabase/migrations/20260908052000_work_task_children_schedule_watchers.sql` before it is applied
- Modify: `supabase/tests/work_task_children_schedule_watchers_smoke.sql`
- Modify: `lib/work/workTaskService.ts`
- Modify: `lib/__tests__/workTaskService.test.ts`

**Interfaces:**
- Consumes: `command_work_task_collaboration`, `work_task_capabilities`, canonical `work.task.manage_scope`.
- Produces: `schedule_update`, `watchers_update`, `list_work_task_watcher_candidates`, `canManageSchedule`, `canManageWatchers`.

- [x] **Step 1: Add failing SQL cases for exact authorization and atomicity**

Assert creator/scoped manager allowed; assignee-only/watcher/unrelated denied;
inactive/non-member/missing-module watcher rejected; duplicate IDs deduped;
remove ends only active watcher relation; reviewer/assignment rows unchanged;
stale version and reused idempotency-key mismatch rejected; injected event failure
rolls back schedule/watcher changes.

- [x] **Step 2: Add guarded commands to the unapplied candidate**

For `schedule_update`, lock task `FOR UPDATE`, check non-terminal status and
creator or `work.task.manage_scope` at exact scope, validate range, update
`planned_start_at/deadline_at`, bump lock version, record `task.schedule_updated`
with before/after and insert outbox.

For `watchers_update`, cap each list at 50, reject overlap, validate every added
candidate using Workspace membership/canonical access and restricted boundary,
insert or reactivate only matching watcher rows, end removed watcher rows, bump
lock version, record `task.watchers_updated` with added/removed IDs and outbox.

- [x] **Step 3: Add candidate listing and server capabilities**

Expose:

```sql
public.list_work_task_watcher_candidates(
  p_task_id uuid,
  p_search text default '',
  p_cursor uuid default null,
  p_limit integer default 30
) returns jsonb
```

Return only active app accounts with Work module access and valid task scope.
Do not return watcher candidates to actors lacking `canManageWatchers`.

- [x] **Step 4: Wire the TypeScript service**

```ts
watcherOptions: (taskId: string, search = "", cursor: string | null = null) =>
  call<WorkMentionCandidatePage>("list_work_task_watcher_candidates", {
    p_task_id: taskId,
    p_search: search,
    p_cursor: cursor,
    p_limit: 30,
  }),
children: (taskId: string, cursor: WorkTaskCursor | null = null) =>
  call<WorkTaskChildrenPage>("list_work_task_children", {
    p_task_id: taskId,
    p_cursor: cursor,
    p_limit: 30,
  }),
```

`collaborate()` already transports the expanded command union; add tests for exact
RPC names, payload casing and null schedule values.

- [x] **Step 5: Run focused unit and Cloud rollback tests**

```bash
npx vitest run lib/__tests__/workTaskService.test.ts lib/__tests__/workPilotFeedbackContracts.test.ts
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration supabase/migrations/20260908052000_work_task_children_schedule_watchers.sql \
  --smoke supabase/tests/work_task_children_schedule_watchers_smoke.sql \
  --smoke supabase/tests/work_r1a_collaboration_commands_smoke.sql
```

Expected: selected Vitest and all SQL smoke sentinels pass.

- [x] **Step 6: Amend the candidate commit only because it is still unapplied**

```bash
git add supabase/migrations/20260908052000_work_task_children_schedule_watchers.sql supabase/tests/work_task_children_schedule_watchers_smoke.sql lib/work/workTaskService.ts lib/__tests__/workTaskService.test.ts
git commit --amend --no-edit
```

Do not amend after linked apply. Any later correction uses a new forward migration.

> Verification note: the five Cloud smokes pass in isolated savepoints/batches. A single all-in-one API request exceeded the linked SQL endpoint timeout after 80 seconds, so the runner now isolates fixtures per smoke and the suite is executed in bounded batches.

### Task 4: Apply and postflight the child/schedule/watcher candidate

**Files:**
- Modify: `docs/runbooks/vioo-work-r1a-rollout.md`

**Interfaces:**
- Consumes: committed candidate from Tasks 2–3.
- Produces: Cloud schema/RPC checkpoint with rollback and postflight evidence.

- [x] **Step 1: Verify exact committed paths and clean diff for the candidate**

```bash
git status --short
git show --stat --oneline HEAD
npx --no-install supabase migration list --linked
```

Expected: only known plan progress/doc changes may be dirty; local/Cloud ledger
diff is exactly `20260908052000_work_task_children_schedule_watchers.sql`.

- [x] **Step 2: Run linked dry-run**

```bash
set -a
source /Users/admin/khotienthinh/.env
set +a
npx --no-install supabase db push --linked --dry-run
```

Expected: dry-run lists only `20260908052000_work_task_children_schedule_watchers.sql`.

- [x] **Step 3: Apply the exact migration**

Run `npx --no-install supabase db push --linked` only after Step 2 matches. Expected:
one migration applied successfully. This is authorized schema implementation;
it does not enable notifications or create real tasks.

- [x] **Step 4: Run postflight against applied schema without reapplying SQL**

```bash
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration /dev/null \
  --smoke supabase/tests/work_task_children_schedule_watchers_smoke.sql \
  --smoke supabase/tests/work_r1a_task_commands_smoke.sql \
  --smoke supabase/tests/work_r1a_lifecycle_commands_smoke.sql \
  --smoke supabase/tests/work_r1a_collaboration_commands_smoke.sql \
  --smoke supabase/tests/work_workspace_task_access_smoke.sql
npx --no-install supabase db advisors --linked --type security --level error --fail-on error
```

Expected: all smokes pass and advisor reports no ERROR.

- [x] **Step 5: Record factual evidence and commit**

Add migration hash, dry-run/apply/postflight output summary and ledger count to the
rollout. Do not mark UI, notification or Task 11 complete.

```bash
git add docs/runbooks/vioo-work-r1a-rollout.md
git commit -m "docs(work): record child task schema rollout"
```

### Task 5: Build child-task and people UI on the existing detail flow

**Files:**
- Create: `pages/work/WorkTaskHeader.tsx`
- Create: `pages/work/WorkTaskChildren.tsx`
- Create: `pages/work/WorkTaskPeople.tsx`
- Create: `pages/work/WorkTaskSection.tsx`
- Modify: `pages/work/WorkDetail.tsx`
- Modify: `pages/work/WorkCreateDrawer.tsx`
- Modify: `pages/work/WorkActions.tsx`
- Modify: `pages/work/WorkPage.tsx`
- Modify: `pages/work/work.css`
- Modify: `tests/work/task8-fixture.tsx`
- Modify: `tests/work/workspace-fixture.tsx`
- Create: `scripts/verify-work-task-detail-redesign-browser.mjs`

**Interfaces:**
- Consumes: Tasks 1–4 types/RPCs, `WorkMutationSession`, approved v2 preview.
- Produces: production child creation/listing, schedule editor, watcher editor and approved layout.

- [x] **Step 1: Extend browser fixtures and write RED journey**

The script opens one task and asserts before implementation:

```js
await page.getByRole("heading", { name: "Công việc con" }).waitFor();
await page.getByRole("button", { name: "Thêm công việc con" }).click();
await page.getByLabel("Tên công việc *").fill("Bổ sung ảnh hiện trường");
await page.getByRole("button", { name: "Tạo công việc" }).click();
await page.getByText("1/1 hoàn thành").waitFor();
await page.getByRole("button", { name: "Thêm / bỏ người theo dõi" }).click();
```

Add fixture behavior for child paging/aggregate, child creation with parent ID,
schedule validation, watchers update, stale version and permission denial.

- [x] **Step 2: Run browser RED**

```bash
node scripts/verify-work-task-detail-redesign-browser.mjs
```

Expected: missing children section or controls.

- [x] **Step 3: Create focused presentation components**

`WorkTaskHeader` renders tags, scope/group, planned range, actual completion and
invokes `schedule_update`. `WorkTaskChildren` loads `service.children()`, renders
server aggregate, pages by cursor and opens `WorkCreateDrawer` with locked parent
scope/privacy. `WorkTaskPeople` renders server detail participants and sends one
diff through `watchers_update`. `WorkTaskSection` only owns visual section markup.

- [x] **Step 4: Extend create drawer for parent and schedule**

Add start/end inputs labelled `Ngày bắt đầu` and `Ngày kết thúc`. Before preview,
call `validateWorkSchedule()`. A child drawer receives `parentTaskId`, locked scope,
parent privacy and default dates; it still runs recipient preview and attachment
pipeline. Do not copy parent files, checklist or watchers automatically.

- [x] **Step 5: Add parent completion warning to the existing action path**

`WorkActions` receives `childAggregate`. Before `submit` under auto-complete or
`review approve`, if `visibleOpen > 0`, show:

```text
Còn {n} công việc con bạn có thể xem chưa hoàn thành.
Các công việc con vẫn tiếp tục độc lập. Vẫn hoàn thành công việc cha?
```

Confirm continues with the same frozen command/version/key. Cancel creates no
mutation. Do not add a server precondition or cascade.

- [x] **Step 6: Compose the approved desktop/mobile layout**

Keep the route's existing master/detail behavior, use dark module navigation only
where the Work shell owns it, task rail next to detail, neutral canvas, white
sections and right people/SLA rail. At <=1000px collapse task rail to a sheet; at
<=700px render one detail column and people sheet. Keep names/avatars, never UUIDs.

- [x] **Step 7: Preserve one persistent action bar**

Move `WorkActions` outside the scrolling content container for desktop. On mobile
use sticky bottom above the app's 64px bottom navigation with safe-area. Add
content bottom padding based on action-bar height where overlay is unavoidable.
The DOM contains one `.work-action-bar`; tests assert it stays in viewport at top,
middle and end and that the last comment control is not obscured.

- [x] **Step 8: Run GREEN and focused regressions**

```bash
npx vitest run lib/__tests__/workTaskService.test.ts lib/__tests__/workDetailService.test.ts lib/__tests__/workPilotFeedbackContracts.test.ts
node scripts/verify-work-task-detail-redesign-browser.mjs
node scripts/verify-work-refresh-browser.mjs
node scripts/verify-work-task8-browser.mjs
node scripts/verify-work-task9-browser.mjs
npm run lint
```

Expected: all pass at 1440/768/360 plus persistent bar at 320; no horizontal
overflow, hidden final content or background-refresh scroll reset.

- [x] **Step 9: Commit the production UI checkpoint**

```bash
git add pages/work/WorkTaskHeader.tsx pages/work/WorkTaskChildren.tsx pages/work/WorkTaskPeople.tsx pages/work/WorkTaskSection.tsx pages/work/WorkDetail.tsx pages/work/WorkCreateDrawer.tsx pages/work/WorkActions.tsx pages/work/WorkPage.tsx pages/work/work.css tests/work/task8-fixture.tsx tests/work/workspace-fixture.tsx scripts/verify-work-task-detail-redesign-browser.mjs scripts/verify-work-refresh-browser.mjs
git commit -m "feat(work): add child tasks and redesigned task detail"
```

### Task 6: Add direct image, PDF and TXT preview

**Files:**
- Create: `pages/work/WorkAttachmentPreview.tsx`
- Modify: `pages/work/WorkAttachments.tsx`
- Modify: `lib/work/workAttachmentService.ts`
- Modify: `lib/__tests__/workAttachmentService.test.ts`
- Modify: `tests/work/task8-fixture.tsx`
- Modify: `scripts/verify-work-task-detail-redesign-browser.mjs`

**Interfaces:**
- Consumes: signed attachment read RPC and variants `display`, `fallback`, `original`.
- Produces: `WorkAttachmentPreview` for image/PDF/TXT without external viewer.

- [ ] **Step 1: Add failing service and browser tests**

Test MIME routing: image prefers display/fallback; PDF and TXT request original;
unsupported MIME offers download only. Browser asserts Escape closes, focus returns
to the exact file button, expired URL removes content and offers retry, task switch
closes viewer, and a denied read never retains prior content.

- [ ] **Step 2: Run RED**

```bash
npx vitest run lib/__tests__/workAttachmentService.test.ts
node scripts/verify-work-task-detail-redesign-browser.mjs
```

Expected: PDF/TXT viewer assertions fail.

- [ ] **Step 3: Implement an abort-safe preview component**

For images render `<img>` from display/fallback. For PDF render an `<iframe title>`
with the signed original URL and a download fallback. For TXT fetch the signed URL
with `AbortController`, reject non-OK responses, read at most 1 MiB and render as a
text node in `<pre>`; indicate truncation. Never use `innerHTML`.

On close/task change/unmount, abort fetch, clear URL/text and expiry timeout. Expiry
closes content and reports `WORK_ATTACHMENT_EXPIRED`. Dialog handles Escape/focus.

- [ ] **Step 4: Route supported files from WorkAttachments**

Expose `Xem trước` for JPEG/PNG/WebP/PDF/TXT and retain `Tải bản gốc`. Thumbnail
still loads lazily. All access goes through `service.read()` and signed URLs; do
not persist URLs in state outside the viewer lifecycle.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run lib/__tests__/workAttachmentService.test.ts
node scripts/verify-work-task-detail-redesign-browser.mjs
npm run lint
git add pages/work/WorkAttachmentPreview.tsx pages/work/WorkAttachments.tsx lib/work/workAttachmentService.ts lib/__tests__/workAttachmentService.test.ts tests/work/task8-fixture.tsx scripts/verify-work-task-detail-redesign-browser.mjs
git commit -m "feat(work): preview task images pdf and text files"
```

### Task 7: Store and edit inline mention nodes safely

**Files:**
- Create: `supabase/migrations/20260908060000_work_inline_comment_mentions.sql`
- Create: `supabase/tests/work_inline_comment_mentions_smoke.sql`
- Modify: `lib/work/workTypes.ts`
- Modify: `lib/work/workForm.ts`
- Create: `pages/work/WorkMentionComposer.tsx`
- Modify: `pages/work/WorkDiscussion.tsx`
- Modify: `lib/__tests__/workPilotFeedbackContracts.test.ts`
- Modify: `tests/work/task8-fixture.tsx`
- Modify: `scripts/verify-work-task-detail-redesign-browser.mjs`

**Interfaces:**
- Consumes: text documents and `list_work_task_mention_candidates`.
- Produces: server-derived mention recipients and inline keyboard composer.

- [ ] **Step 1: Write RED SQL tests for document validation and mention diff**

Cases: valid text+mention document; duplicate ID deduped; unknown node/mark rejected;
label length and UUID validated; candidate lost access rejected atomically; typed
`@name` text sends no mention; create emits one `comment.mentioned`; edit adding one
new ID emits only that ID; retaining or removing old IDs does not re-notify them;
same display names remain distinct by UUID; retry keeps one event/outbox record.

- [ ] **Step 2: Write RED browser keyboard journey**

```js
const composer = page.getByLabel("Nội dung bình luận");
await composer.fill("Nhờ @son");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
await expect(composer).toContainText("@Phạm Ngọc Sơn");
await page.getByRole("button", { name: "Gửi bình luận" }).click();
```

Also test Backspace removes a whole token, Escape closes suggestions, blur does not
lose selected IDs, and background refresh preserves draft/focus.

- [ ] **Step 3: Implement server document validation/extraction**

The migration replaces only affected functions with forward definitions. Accept
paragraph content nodes from exact allowlist `text|mention`. For mention nodes require
exact keys `type,userId,label`, valid UUID, label length 1..200 and current candidate
visibility. Derive recipient IDs in SQL from document nodes; compare old/new sets on
edit. Ignore or reject client `mentionedUserIds` as an authority; return the derived
list for backward-compatible reads.

- [ ] **Step 4: Implement inline composer**

Use a controlled sequence of text/mention segments with a textarea-compatible
accessible fallback. Typing `@query` opens the existing task-scoped candidate RPC;
ArrowUp/Down changes active option, Enter/Tab selects, Escape closes. The visible
token holds label and stable ID. Submission serializes `WorkTextDocument` nodes.
Editing a legacy comment loads text and its existing mention IDs as explicit tokens
at the top of the composer with a migration note; never guess offsets by name.

- [ ] **Step 5: Run candidate Cloud rollback and browser tests**

```bash
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration supabase/migrations/20260908060000_work_inline_comment_mentions.sql \
  --smoke supabase/tests/work_inline_comment_mentions_smoke.sql \
  --smoke supabase/tests/work_r1a_collaboration_commands_smoke.sql \
  --smoke supabase/tests/work_r1a_notification_delivery_smoke.sql
npx vitest run lib/__tests__/workPilotFeedbackContracts.test.ts lib/__tests__/workDetailService.test.ts
node scripts/verify-work-task-detail-redesign-browser.mjs
node scripts/verify-work-refresh-browser.mjs
npm run lint
```

Expected: all selected tests/smokes pass; no real notification is delivered because
the Cloud gate remains false and Cloud smoke rolls back.

- [ ] **Step 6: Commit, dry-run, apply and postflight**

```bash
git add supabase/migrations/20260908060000_work_inline_comment_mentions.sql supabase/tests/work_inline_comment_mentions_smoke.sql lib/work/workTypes.ts lib/work/workForm.ts pages/work/WorkMentionComposer.tsx pages/work/WorkDiscussion.tsx lib/__tests__/workPilotFeedbackContracts.test.ts tests/work/task8-fixture.tsx scripts/verify-work-task-detail-redesign-browser.mjs scripts/verify-work-refresh-browser.mjs
git commit -m "feat(work): add inline task mentions"
set -a
source /Users/admin/khotienthinh/.env
set +a
npx --no-install supabase db push --linked --dry-run
npx --no-install supabase db push --linked
```

Dry-run must list only `20260908060000_work_inline_comment_mentions.sql`. After
apply, rerun Step 5 with `--migration /dev/null`, then security advisor. Record
actual evidence in rollout and commit `docs(work): record inline mention rollout`.

### Task 8: Reconcile notification backlog before any real delivery

**Files:**
- Create: `scripts/inspect-work-notification-pilot.mjs`
- Modify: `supabase/tests/work_r1a_notification_delivery_smoke.sql`
- Modify: `docs/runbooks/vioo-work-r1a-rollout.md`

**Interfaces:**
- Consumes: outbox, deliveries, current task relationship/capability and gate.
- Produces: read-only pilot report grouped by event, age, task, candidate recipient and suppression reason.

- [ ] **Step 1: Implement a read-only inventory script**

The script loads root `.env`, verifies linked project ref, runs a SQL file inside a
read-only transaction and prints JSON without names/comment/task content. Output:

```ts
type PilotNotificationInventory = {
  enabled: boolean;
  outboxTotal: number;
  deliveryTotal: number;
  pushJobTotal: number;
  byEvent: Record<string, number>;
  byAgeBucket: Record<"under1h" | "under24h" | "older", number>;
  candidateRecipients: Array<{ eventId: string; userId: string; decision: "mandatory" | "routine" | "suppressed"; reason: string }>;
};
```

The script must not UPDATE settings/outbox/deliveries/jobs or call the worker.

- [ ] **Step 2: Add tests proving stale events are not implicitly broadcast**

Extend delivery smoke with old outbox events and assert the reviewed cutoff policy
can mark them suppressed through the existing decision path while preserving event,
outbox and dedupe audit. Do not delete rows or reset successful delivery markers.

- [ ] **Step 3: Run report and rollback smoke**

```bash
node scripts/inspect-work-notification-pilot.mjs
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration /dev/null \
  --smoke supabase/tests/work_r1a_notification_delivery_smoke.sql
```

Expected: report confirms current gate and exact live backlog; smoke passes without
creating real deliveries.

- [ ] **Step 4: Present the concrete recipient/backlog report for approval**

Pause before any setting change, worker invocation, browser notification permission
or test message to `admin@khoviet.vn` / `sonpn@tienthinhjsc.vn`. Ask for one decision:
drop/suppress pre-cutoff delivery attempts while preserving audit, or deliver selected
event IDs. This is the required external-send authorization gate.

- [ ] **Step 5: Commit the read-only checkpoint**

```bash
git add scripts/inspect-work-notification-pilot.mjs supabase/tests/work_r1a_notification_delivery_smoke.sql docs/runbooks/vioo-work-r1a-rollout.md
git commit -m "chore(work): prepare notification pilot review"
```

### Task 9: Activate and verify the named notification pilot after approval

**Files:**
- Modify: `docs/runbooks/vioo-work-r1a-rollout.md`
- Modify: `docs/runbooks/vioo-work-workspace-acceptance.md`

**Interfaces:**
- Consumes: explicit Task 8 approval, reviewed event IDs/cutoff, deployed worker and two named pilot accounts.
- Produces: real in-app/push acceptance evidence and activation timestamp.

- [ ] **Step 1: Re-run inventory immediately before mutation**

Confirm linked ref, gate false, named users/grants not expired, active cron and no
unexpected recipient/backlog drift. If drift exists, regenerate the report and use
the newly approved set; do not reuse a stale fingerprint.

- [ ] **Step 2: Apply the approved backlog decision atomically**

Use one explicit SQL transaction referencing exact reviewed event IDs or cutoff.
Preserve domain events/outbox and record suppression/delivery decision in the marker
structure. Enable `app_private.work_notification_settings.enabled=true` only in the
same reviewed pilot operation. Never mass-reset delivery or push jobs.

- [ ] **Step 3: Run one user-triggered acceptance matrix**

With the two signed-in pilot accounts, verify assignment/create, mention, transfer,
schedule update, watcher update, result submission and completion. Assert actor self
suppression where intended, required recipient only, one in-app row, correct deep
link and no duplicate after worker retry. Push needs actual registered device consent;
record “not registered” separately from failed delivery.

- [ ] **Step 4: Verify permission revocation and mute**

Routine muted comment/checklist/file does not notify; mandatory mention/transfer/review
still follows policy. Removing a watcher or revoking task access before processing
suppresses their queued delivery and cannot be bypassed by deep link.

- [ ] **Step 5: Record activation and commit evidence**

Document exact Vietnam/UTC time, gate value, reviewed backlog handling, delivery IDs
without payload content, device registration status and any known limit. Commit:

```bash
git add docs/runbooks/vioo-work-r1a-rollout.md docs/runbooks/vioo-work-workspace-acceptance.md
git commit -m "chore(work): verify named notification pilot"
```

### Task 10: Full regression, rollout reconciliation and Task 11 observation

**Files:**
- Modify: `docs/runbooks/vioo-work-r1a-rollout.md`
- Modify: `docs/runbooks/vioo-work-workspace-acceptance.md`

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: final dev acceptance evidence; Task 11 remains open until 48 elapsed hours actually pass.

- [ ] **Step 1: Run the complete local suite once**

```bash
npm test -- --reporter=dot
npm run lint
npm run build
npm run check:supabase-migrations
npm run audit:supabase-queries
node scripts/verify-work-workspace-browser.mjs
node scripts/verify-work-task8-browser.mjs
node scripts/verify-work-task9-browser.mjs
node scripts/verify-work-task10-browser.mjs
node scripts/verify-work-refresh-browser.mjs
node scripts/verify-work-task-detail-redesign-browser.mjs
```

Expected: zero failures; existing Vite chunk-size warning may remain if unchanged.
Do not rerun broad tests unless a later change or failure justifies it.

- [ ] **Step 2: Run every Work Cloud postflight and ledger/security checks**

Run all Work smoke files against applied schema using `--migration /dev/null`, then:

```bash
npx --no-install supabase migration list --linked
npx --no-install supabase db push --linked --dry-run
npx --no-install supabase db advisors --linked --type security --level error --fail-on error
```

Expected: local/Cloud ledgers match, dry-run says database up to date, all smokes and
ERROR-level advisor pass.

- [ ] **Step 3: Complete the real-user UI checklist**

Admin and Sơn verify correct Workspace visibility/role, create direct/Workspace task,
planned dates, child task full details, parent warning, watcher changes, transfer,
review, preview, inline mention, notification link and responsive action bar. An
unrelated account cannot discover restricted task or child aggregate.

- [ ] **Step 4: Start and observe the 48-hour window**

Record the actual start only after notification activation and real-user checklist.
During the next 48 elapsed hours inspect worker errors, dead outbox rows, failed push
jobs, duplicate in-app deliveries, Realtime refresh and access changes. Do not mark
complete early or substitute synthetic time.

- [ ] **Step 5: Close Task 11 only with evidence**

After 48 hours, record counts before/after, incidents and resolutions, device/browser
coverage, permission regression and final known limitations. Update the authoritative
table at the top of rollout. Leave R1B/R2/R3 explicitly unimplemented.

- [ ] **Step 6: Final commit and branch review**

```bash
git diff --check
git status --short
git log --oneline --decorate -15
git add docs/runbooks/vioo-work-r1a-rollout.md docs/runbooks/vioo-work-workspace-acceptance.md
git commit -m "docs(work): complete R1A pilot observation"
```

Use `superpowers:requesting-code-review` before integration. Do not merge, deploy
production, send a handoff or stop dev unless the user separately requests it.

---

## Self-review record

- Spec coverage: every section maps to Tasks 1–10; existing refresh/Workspace cover
  fixes are already committed as `2991031` and remain regression inputs.
- Type consistency: planned schedule is `plannedStartAt` in command input and
  `planned_start_at` in read projections; deadline remains `deadlineAt/deadline_at`;
  actual execution remains `started_at/completed_at`.
- Parent completion: warning occurs in UI from permission-filtered aggregate and never
  becomes a blocking database condition or cascade.
- Permission boundary: child relation never grants access; watcher mutation uses a
  server capability and candidate endpoint; mention recipients derive from validated nodes.
- External effect gate: Task 8 is read-only and requires explicit approval before Task 9.
- Placeholder scan: no unassigned implementation decision remains in the plan.

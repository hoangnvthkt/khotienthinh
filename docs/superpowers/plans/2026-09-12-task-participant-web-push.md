# Task Participant Web Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Main agent only; do not use sub-agents per workspace `AGENTS.md`.

**Goal:** Mọi người đang tham gia một Work task, Workflow instance hoặc Request instance nhận đúng thông báo liên quan, với preview đủ hiểu và deeplink tới đúng task/bước/bình luận; chưa triển khai broadcast toàn công ty.

**Architecture:** `public.notifications` tiếp tục là nguồn in-app duy nhất và Web Push là bản sao của cùng notification. Giữ outbox Work và Request, bổ sung outbox Workflow; mọi event được enqueue nguyên tử tại backend, resolve recipient theo quan hệ còn hiệu lực, tạo nội dung an toàn theo event và dùng route nội bộ canonical. Work giữ worker riêng để revalidate trước từng device; Request/Workflow dùng worker tạo notification rồi trigger Web Push chung.

**Tech Stack:** React 18, TypeScript 5.8, Vitest 4, Supabase JS 2.98, PostgreSQL/Supabase Cloud, Supabase Edge Functions, Web Push Service Worker.

**Spec:** `docs/superpowers/specs/2026-09-12-task-participant-web-push-design.md`

## Global Constraints

- Chỉ triển khai Work, Workflow và Request. Không bật hoặc sửa broadcast `user_id is null`, chấm công diện rộng hay Vioo Office.
- Supabase project ref là `ftciqmqhmfvjtwoycswe`; dùng Supabase Cloud và cấu hình `.env`. Không dùng Supabase local hoặc Docker.
- Bắt đầu implementation trong worktree/branch sạch vì workspace hiện có thay đổi không liên quan ở `CheckIn.tsx`, procurement và `supabase/.temp/cli-latest`.
- Không stage, sửa hoặc revert các file không thuộc kế hoạch.
- Migration chỉ được tạo bằng `npx --no-install supabase migration new <name>`; sau lệnh phải ghi lại đúng path do CLI sinh ra.
- Mọi migration phải qua `scripts/run-supabase-cloud-transaction.mjs` và smoke có `begin/rollback` trước `db push --linked`.
- Mỗi task: failing test trước, targeted tests sau, `git diff --check`, rồi commit riêng.
- Không gửi nguyên văn comment, lý do từ chối, dữ liệu form, tên file hoặc signed URL trong Web Push preview.
- Không cấp quyền truy cập do mention; màn hình đích vẫn tái kiểm tra RLS/RPC.
- Actor bị loại khỏi recipient trừ notification bắt buộc hướng chính actor. Dedupe theo event/user/channel, không coalesce hai event nghiệp vụ khác nhau.
- Workflow thuộc Request chỉ do Request pipeline phát notification để tránh gửi trùng.
- Work notification gate và Workflow notification gate phải giữ `false` cho đến checkpoint rollout.

---

## File map

- `lib/taskNotificationContract.ts`: kiểu dữ liệu, giới hạn preview và builder deeplink canonical.
- `lib/notificationRoutes.ts`: resolve Work/Workflow/Request từ metadata canonical.
- `lib/__tests__/taskNotificationContract.test.ts`: route/preview/security contract.
- `scripts/run-supabase-cloud-transaction.mjs`: nhận nhiều `--migration` theo đúng thứ tự.
- `scripts/lib/supabase-cloud-transaction.mjs`: ghép nhiều migration vào một rollback transaction.
- `lib/__tests__/supabaseCloudTransactionRunner.test.ts`: bảo vệ transaction boundary khi test chuỗi migration phụ thuộc.
- `public/sw.js`: điều hướng Web Push cùng origin và giữ hash route/query.
- `lib/__tests__/serviceWorkerNotificationClick.test.ts`: click push khi app mở/đóng.
- `supabase/migrations/*_work_notification_preview_recipients.sql`: Work content builder, reminder watcher, dedupe và rollout cutoff.
- `supabase/tests/work_r1a_notification_delivery_smoke.sql`: Work recipient/content/deeplink smoke.
- `lib/__tests__/workNotificationMigration.test.ts`: static contract cho migration Work mới.
- `supabase/migrations/*_workflow_notification_outbox.sql`: outbox, delivery functions, gate và cron Workflow.
- `supabase/migrations/*_workflow_notification_commands.sql`: enqueue trong command/create/watcher/cancel/reopen/comment.
- `supabase/functions/process-workflow-notifications/index.ts`: HTTP boundary của Workflow worker.
- `supabase/functions/process-workflow-notifications/worker.ts`: claim/deliver/fail orchestration có thể unit test.
- `supabase/functions/process-workflow-notifications/deno.json`: Edge Function imports.
- `supabase/config.toml`: cấu hình worker Workflow.
- `supabase/tests/workflow_participant_notifications_smoke.sql`: persona/outbox/content/deeplink Workflow.
- `lib/__tests__/workflowNotificationWorker.test.ts`: worker retries/bounds.
- `lib/__tests__/workflowNotificationBackendContract.test.ts`: đảm bảo React không tự phát notification.
- `context/WorkflowContext.tsx`: chuyển sang RPC backend và bỏ fan-out client-side.
- `lib/workflowInstanceCommentService.ts`: giữ API UI, tạo comment qua command/RPC nếu cần để enqueue nguyên tử.
- `supabase/migrations/*_request_participant_notifications.sql`: canonical event, watcher fan-out, preview và reminder Request.
- `supabase/tests/request_participant_notifications_smoke.sql`: recipient/event/preview/deeplink Request.
- `lib/__tests__/requestNotificationDeliveryContract.test.ts`: cập nhật contract theo baseline + migration mới.
- `supabase/functions/process-request-notifications/index.ts`: gọi reminder enqueue trước khi claim nếu reminder được bật.
- `pages/wf/WorkflowInstances.tsx`: đọc `instanceId`, `nodeId`, `commentId`.
- `pages/wf/WorkflowInstanceDetail.tsx`: focus/highlight node/comment và fallback detail.
- `pages/request/RequestList.tsx`: giữ query anchor khi mở detail.
- `components/request/RequestDetailPanel.tsx`: truyền block/event anchor.
- `components/request/RequestApprovalInspector.tsx`: focus/highlight block/event.
- `docs/security/task-participant-notification-rollout-log.md`: preflight, apply, canary, metrics và rollback evidence.

---

### Task 1: Khóa hợp đồng preview và deeplink dùng chung

**Files:**
- Create: `lib/taskNotificationContract.ts`
- Create: `lib/__tests__/taskNotificationContract.test.ts`
- Modify: `lib/notificationRoutes.ts`
- Modify: `scripts/run-supabase-cloud-transaction.mjs`
- Modify: `scripts/lib/supabase-cloud-transaction.mjs`
- Modify: `lib/__tests__/supabaseCloudTransactionRunner.test.ts`

**Interfaces:**

```ts
export const TASK_NOTIFICATION_LIMITS = { title: 100, message: 220 } as const;

export type TaskNotificationTarget =
  | { domain: 'work'; taskCode: string; commentId?: string }
  | { domain: 'workflow'; instanceId: string; nodeId?: string; commentId?: string }
  | { domain: 'request'; requestId: string; blockKey?: string; eventId?: string };

export const buildTaskNotificationLink: (target: TaskNotificationTarget) => string;
export const toPushActionUrl: (link: string) => string;
export const isSafeTaskNotificationLink: (link: string) => boolean;
```

- [ ] **Step 1: Viết failing contract tests**

Test đủ ba route, encode ID/query, bỏ query rỗng và từ chối URL ngoài origin:

```ts
expect(buildTaskNotificationLink({
  domain: 'workflow', instanceId: 'wf/1', nodeId: 'node 2', commentId: 'c&3',
})).toBe('/wf?instanceId=wf%2F1&nodeId=node+2&commentId=c%263');

expect(toPushActionUrl('/rq/rq-1?block=finance')).toBe('/#/rq/rq-1?block=finance');
expect(isSafeTaskNotificationLink('https://evil.test/x')).toBe(false);
```

Thêm test `resolveNotificationPath` ưu tiên metadata canonical cho từng domain và
fallback về detail khi thiếu anchor.

Run:

```bash
npx vitest run lib/__tests__/taskNotificationContract.test.ts \
  lib/__tests__/workNotificationWorker.test.ts \
  lib/__tests__/requestNotificationRoute.test.ts
```

Expected: FAIL vì module/builder mới chưa tồn tại hoặc route Workflow/Request chưa
giữ đủ anchor.

- [ ] **Step 2: Viết failing test cho chuỗi migration Cloud rollback**

Mở rộng runner để nhận lặp lại `--migration` và ghép SQL theo thứ tự trước các
savepoint smoke:

```ts
expect(buildRollbackSql(['select 1;', 'select 2;'], ['select 3;']))
  .toMatch(/^begin;[\s\S]*select 1;[\s\S]*select 2;[\s\S]*savepoint smoke_1;[\s\S]*rollback;$/i);
```

Run `npx vitest run lib/__tests__/supabaseCloudTransactionRunner.test.ts`; expected
FAIL vì runner hiện chỉ nhận migration cuối cùng.

- [ ] **Step 3: Implement builder, route resolver và multi-migration runner**

Trong `lib/taskNotificationContract.ts`:

1. Dùng `URLSearchParams`, không ghép query thủ công.
2. Chỉ chấp nhận link bắt đầu bằng đúng `/work/`, `/wf` hoặc `/rq/`; không nhận
   protocol, `//`, backslash hoặc control character.
3. `toPushActionUrl()` trả `/#` + link và không double-hash.

Trong `resolveNotificationPath()`:

1. Work lấy `taskCode`, `commentId`.
2. Workflow lấy `instanceId`, `nodeId`, `commentId` cho mọi `source_type` bắt đầu
   bằng `workflow`, nhưng vẫn giữ nhánh material request hiện hữu trước fallback.
3. Request lấy `requestInstanceId`, `blockKey`, `eventId`.
4. Không dùng external `notification.link` cho ba source type này.

Trong Cloud transaction runner, đổi `migrationFile` thành `migrationFiles`, bắt
buộc ít nhất một file và đọc/ghép đúng thứ tự xuất hiện trên CLI. Không thay cách
redact secret hay cách cô lập smoke bằng savepoint.

- [ ] **Step 4: Chạy targeted tests và kiểm tra type**

```bash
npx vitest run lib/__tests__/taskNotificationContract.test.ts \
  lib/__tests__/workNotificationWorker.test.ts \
  lib/__tests__/requestNotificationRoute.test.ts \
  lib/__tests__/supabaseCloudTransactionRunner.test.ts
npm run lint
git diff --check
```

Expected: PASS; không đổi route các module ngoài Work/Workflow/Request.

- [ ] **Step 5: Commit hợp đồng**

```bash
git add lib/taskNotificationContract.ts \
  lib/__tests__/taskNotificationContract.test.ts \
  lib/notificationRoutes.ts \
  lib/__tests__/workNotificationWorker.test.ts \
  lib/__tests__/requestNotificationRoute.test.ts \
  scripts/run-supabase-cloud-transaction.mjs \
  scripts/lib/supabase-cloud-transaction.mjs \
  lib/__tests__/supabaseCloudTransactionRunner.test.ts
git commit -m "feat(notifications): define task notification contract"
```

---

### Task 2: Nâng Work preview, recipient và rollout cutoff

**Files:**
- Create via CLI: migration ending `_work_notification_preview_recipients.sql`
- Create: `lib/__tests__/workNotificationMigration.test.ts`
- Modify: `supabase/tests/work_r1a_notification_delivery_smoke.sql`

**Database interfaces:**

- `app_private.work_notification_content(p_event_id uuid) returns jsonb`
- Extend `app_private.work_notification_settings` with `rollout_started_at timestamptz`
- Replace `app_private.work_process_notifications(integer)` and, only if needed,
  `app_private.work_notification_mandatory(uuid, uuid)` without changing public RPC signatures.

- [ ] **Step 1: Viết failing static migration test**

Test tìm đúng một migration suffix và assert:

```ts
expect(sql).toContain('app_private.work_notification_content');
expect(sql).toContain('rollout_started_at');
expect(sql).toContain("'tasktitle'");
expect(sql).toContain("'actorname'");
expect(sql).not.toContain("'Mở Vioo để xem công việc.'");
```

Thêm matrix assertion cho watcher ở `task.deadline_soon`/`task.overdue`, actor
exclusion, mention-only dedupe và không còn cooldown suppress giữa hai event khác ID.

Run `npx vitest run lib/__tests__/workNotificationMigration.test.ts`; expected FAIL.

- [ ] **Step 2: Mở rộng Cloud rollback smoke trước implementation**

Trong `supabase/tests/work_r1a_notification_delivery_smoke.sql` đổi/đưa thêm các
assertion:

- assignee và watcher active nhận lifecycle liên quan; outsider/inactive không nhận;
- watcher muted vẫn nhận mention và reminder mandatory;
- watcher active không mute nhận sắp đến hạn/quá hạn;
- hai comment event khác nhau tạo hai notification, retry một event không tạo bản sao;
- title/message chứa task code/title + action/actor, nằm trong 100/220 ký tự;
- message không chứa raw fixture `Sensitive text never sent in push`;
- `link` là `/work/tasks/VW-...`, `action_url` là `/#/work/tasks/VW-...` và comment
  anchor được giữ;
- outbox cũ trước `rollout_started_at` bị đánh dấu `pre_rollout_backlog`, không deliver.

- [ ] **Step 3: Tạo migration bằng CLI và implement**

```bash
npx --no-install supabase migration new work_notification_preview_recipients
```

Trong migration do CLI sinh:

1. Thêm `rollout_started_at`, giữ `enabled=false`.
2. Tạo helper sanitize plain text, giới hạn 100/220 ký tự và builder map toàn bộ
   Work event đang phát sinh sang title/message/type/severity/priority.
3. Metadata bắt buộc có `eventType`, `eventKey`/event ID, `workTaskId`, `taskCode`,
   `taskTitle`, `actorUserId`, `actorName`, `commentId`, `mandatory` khi có.
4. Sửa recipient resolver: creator + active assignment + active participant/watcher
   + reviewer phù hợp + mention target; reminder deadline gồm watcher; transfer giữ
   old/new assignee snapshot.
5. Bỏ nhánh cooldown làm mất event khác nhau; idempotency tiếp tục dựa vào event ID.
6. `link` dùng route app, `action_url` dùng hash route; `push_enabled=false` vẫn giữ
   vì Work worker tự gửi theo device.
7. Quarantine outbox `created_at < rollout_started_at` bằng `dead_at` và mã lỗi rõ,
   không xóa dữ liệu. Không đặt cutoff cho đến lúc rollout ở Task 9.
8. Revoke helper privileged khỏi PUBLIC/anon/authenticated.

- [ ] **Step 4: Static test và Cloud rollback**

```bash
WORK_NOTIFICATION_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_work_notification_preview_recipients\.sql$' | tail -1)"
test -f "$WORK_NOTIFICATION_MIGRATION"
npx vitest run lib/__tests__/workNotificationMigration.test.ts \
  lib/__tests__/workNotificationWorker.test.ts
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration "$WORK_NOTIFICATION_MIGRATION" \
  --smoke supabase/tests/work_r1a_notification_delivery_smoke.sql
git diff --check
```

Expected: tests PASS; smoke rollback kết thúc bằng
`WORK_NOTIFICATION_DELIVERY_SMOKE_PASSED`; Cloud ledger/data không đổi.

- [ ] **Step 5: Commit Work candidate, chưa apply/chưa bật gate**

```bash
git add "$WORK_NOTIFICATION_MIGRATION" \
  lib/__tests__/workNotificationMigration.test.ts \
  supabase/tests/work_r1a_notification_delivery_smoke.sql
git commit -m "feat(work): add readable participant notifications"
```

---

### Task 3: Xây Workflow outbox và worker có gate

**Files:**
- Create via CLI: migration ending `_workflow_notification_outbox.sql`
- Create: `supabase/functions/process-workflow-notifications/index.ts`
- Create: `supabase/functions/process-workflow-notifications/worker.ts`
- Create: `supabase/functions/process-workflow-notifications/deno.json`
- Create: `lib/__tests__/workflowNotificationWorker.test.ts`
- Create: `supabase/tests/workflow_participant_notifications_smoke.sql`
- Modify: `supabase/config.toml`

**Database interfaces:**

- `app_private.workflow_notification_settings(singleton, enabled, due_soon_minutes, rollout_started_at)`
- `app_private.workflow_notification_outbox(id, event_key, instance_id, event_type, actor_user_id, recipient_user_ids, payload, status, attempt_count, available_at, locked_at, delivered_at, last_error, created_at, updated_at)`
- `public.claim_workflow_notification_outbox(p_limit integer default 50) returns jsonb`
- `public.deliver_workflow_notification(p_outbox_id uuid) returns jsonb`
- `public.fail_workflow_notification_outbox(p_outbox_id uuid, p_error_message text) returns void`

- [ ] **Step 1: Viết failing worker tests**

Test `runWorkflowNotificationWorker()`:

- limit bị clamp 1..50;
- gate false không claim/deliver;
- mỗi item gọi deliver độc lập;
- một item lỗi gọi fail nhưng không chặn item sau;
- response trả `{ enabled, claimed, delivered, failed }`;
- không log raw payload/comment.

Run `npx vitest run lib/__tests__/workflowNotificationWorker.test.ts`; expected FAIL.

- [ ] **Step 2: Viết rollback smoke skeleton**

Smoke tạo các persona creator, current assignee, watcher, mention-only, ended
assignee, inactive, outsider; assert worker RPC chỉ có service role được gọi và gate
mặc định false. Chuẩn bị fixtures cho submit, step action, comment mention, cancel,
reopen và due assignment, nhưng để assertions fail cho đến khi migration hoàn tất.

- [ ] **Step 3: Tạo và implement migration outbox**

```bash
npx --no-install supabase migration new workflow_notification_outbox
```

Migration phải:

1. Tạo settings/outbox/index/unique `event_key`; RLS on và revoke table access.
2. Claim bằng `for update skip locked`, lease timeout, attempt cap 10 và exponential
   backoff tối đa một giờ.
3. Delivery khóa row, bỏ qua Request-owned workflow, revalidate active user + quyền
   xem instance, dedupe recipient và loại actor.
4. Builder nội dung theo event, giới hạn preview, route `/wf?...` và `/#/wf?...`.
5. Insert mọi recipient trong cùng transaction; chỉ mark DELIVERED sau khi insert
   hoàn tất để retry không tạo partial fan-out.
6. Expose wrapper chỉ cho service role.
7. Tạo `app_private.workflow_notification_tick()` gọi Edge Function bằng Vault
   secret và cron mỗi phút, nhưng return ngay khi gate false.

- [ ] **Step 4: Implement Edge worker boundary**

Dùng pattern secret-boundary hiện có của `process-request-notifications`; tách logic
testable vào `worker.ts`. Health GET không claim. POST chỉ nhận integer limit 1..50.
Thêm vào `supabase/config.toml`:

```toml
[functions.process-workflow-notifications]
enabled = true
verify_jwt = false
```

- [ ] **Step 5: Chạy targeted tests và Cloud rollback**

```bash
WORKFLOW_OUTBOX_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_workflow_notification_outbox\.sql$' | tail -1)"
test -f "$WORKFLOW_OUTBOX_MIGRATION"
npx vitest run lib/__tests__/workflowNotificationWorker.test.ts
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration "$WORKFLOW_OUTBOX_MIGRATION" \
  --smoke supabase/tests/workflow_participant_notifications_smoke.sql
npm run lint
git diff --check
```

Expected: worker tests PASS; smoke xác nhận gate/ACL/outbox schema và rollback.

- [ ] **Step 6: Commit, chưa deploy function/chưa apply migration**

```bash
git add "$WORKFLOW_OUTBOX_MIGRATION" \
  supabase/functions/process-workflow-notifications \
  supabase/config.toml \
  supabase/tests/workflow_participant_notifications_smoke.sql \
  lib/__tests__/workflowNotificationWorker.test.ts
git commit -m "feat(workflow): add guarded notification outbox"
```

---

### Task 4: Ghi Workflow event nguyên tử và bỏ fan-out ở React

**Files:**
- Create via CLI: migration ending `_workflow_notification_commands.sql`
- Create: `lib/__tests__/workflowNotificationBackendContract.test.ts`
- Modify: `supabase/tests/workflow_participant_notifications_smoke.sql`
- Modify: `context/WorkflowContext.tsx`
- Modify: `lib/workflowInstanceCommentService.ts`
- Modify: `lib/__tests__/workflowCommentMentionMigration.test.ts`

**Database interfaces:**

- `app_private.enqueue_workflow_notification_event(...)`
- `public.create_workflow_instance_v2(p_input jsonb, p_idempotency_key uuid) returns jsonb`
- `public.update_workflow_instance_watchers(p_instance_id uuid, p_watcher_user_ids uuid[], p_idempotency_key uuid) returns jsonb`
- `public.cancel_workflow_instance(p_instance_id uuid, p_comment text, p_idempotency_key uuid) returns jsonb`
- `public.reopen_workflow_instance(p_instance_id uuid, p_target_node_id uuid, p_comment text, p_idempotency_key uuid) returns jsonb`
- Existing `public.process_workflow_instance_fast(...uuid[])` keeps its client-visible
  signature but enqueue event before return.

- [ ] **Step 1: Viết failing backend-boundary tests**

Static test phải fail nếu `WorkflowContext.tsx` còn gọi
`notificationService.notifyProjectUsers` hoặc tự resolve recipients để phát
notification. Assert migration có enqueue cho:

- `workflow.submitted`, `workflow.step_approved`, `workflow.step_assigned`;
- `workflow.rejected`, `workflow.revision_requested`, `workflow.completed`;
- `workflow.watchers_added`, `workflow.watchers_removed`;
- `workflow.cancelled`, `workflow.reopened`;
- `workflow.commented`, `workflow.mentioned`.

Run:

```bash
npx vitest run lib/__tests__/workflowNotificationBackendContract.test.ts \
  lib/__tests__/workflowCommentMentionMigration.test.ts
```

Expected: FAIL vì lifecycle còn phát notification từ React và comment mention
chưa đi qua outbox/anchor đầy đủ.

- [ ] **Step 2: Tạo migration và implement command boundary**

```bash
npx --no-install supabase migration new workflow_notification_commands
```

Implementation rules:

1. Mỗi RPC xác thực actor bằng `current_app_user_id()`, kiểm tra quyền hiện có và
   dùng idempotency key; không tin `userId` từ client.
2. Enqueue trong cùng transaction sau khi có trạng thái mới; payload snapshot gồm
   current/next node, current/outgoing/incoming assignee và watcher tại thời điểm event.
3. Resolver lifecycle: creator khi nhận kết quả; current assignee; watcher active;
   outgoing assignee cho kết quả bước; mention target chỉ cho mention event.
4. Không enqueue pipeline Workflow khi instance có row `request_instances.workflow_instance_id`.
5. Thay comment mention trigger hiện tại: enqueue `workflow.commented` cho active
   participants và `workflow.mentioned` cho mentioned users; không insert trực tiếp
   `public.notifications`. `commentId` luôn có trong payload.
6. Helper ở `app_private`, revoke toàn bộ; wrapper chỉ cấp authenticated khi cần.

- [ ] **Step 3: Chuyển React sang RPC và xóa notification orchestration**

Trong `WorkflowContext.tsx`:

1. `createInstance`, `cancelInstance`, `reopenInstance`, `updateInstanceWatchers`
   gọi RPC mới, rồi map receipt để cập nhật state.
2. `processInstance` giữ call hiện có nhưng xóa fetch node/user chỉ phục vụ notification.
3. Xóa `notifyWorkflowUsers`, import `notificationService` và toàn bộ khối try/catch
   fan-out sau action.
4. Không đổi public Context API để tránh lan sang UI.

Trong `workflowInstanceCommentService.ts`, nếu insert trigger đủ đảm bảo atomic thì
giữ insert hiện có; nếu cần command để có event key/idempotency thì chuyển `create`
sang RPC mà không đổi return type.

- [ ] **Step 4: Hoàn thiện persona smoke**

Assert:

- submit: assignee + watcher nhận, creator actor không nhận;
- approve chuyển bước: creator, watcher, outgoing assignee và incoming assignee nhận
  đúng biến thể; một user nhiều vai trò vẫn chỉ một notification;
- remove watcher: watcher bị gỡ không nhận event sau;
- mention-only nhận đúng mention nhưng không nhận lifecycle sau;
- inactive/outsider không nhận;
- Request-owned workflow tạo zero Workflow outbox;
- content có actor/action/code/title/node và không có raw comment;
- action URL có `instanceId`, `nodeId`, `commentId` đúng event.

- [ ] **Step 5: Targeted tests và Cloud rollback cả hai Workflow migrations**

```bash
WORKFLOW_OUTBOX_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_workflow_notification_outbox\.sql$' | tail -1)"
WORKFLOW_COMMAND_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_workflow_notification_commands\.sql$' | tail -1)"
test -f "$WORKFLOW_OUTBOX_MIGRATION"
test -f "$WORKFLOW_COMMAND_MIGRATION"
npx vitest run lib/__tests__/workflowNotificationBackendContract.test.ts \
  lib/__tests__/workflowNotificationWorker.test.ts \
  lib/__tests__/workflowCommentMentionMigration.test.ts \
  lib/__tests__/workflowCurrentAssignees.test.ts
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration "$WORKFLOW_OUTBOX_MIGRATION" \
  --migration "$WORKFLOW_COMMAND_MIGRATION" \
  --smoke supabase/tests/workflow_participant_notifications_smoke.sql
npm run lint
git diff --check
```

Expected: runner ghép outbox trước command trong cùng rollback transaction; không
apply rời một migration phụ thuộc lên Cloud.

- [ ] **Step 6: Commit**

```bash
git add "$WORKFLOW_COMMAND_MIGRATION" \
  context/WorkflowContext.tsx \
  lib/workflowInstanceCommentService.ts \
  lib/__tests__/workflowNotificationBackendContract.test.ts \
  lib/__tests__/workflowCommentMentionMigration.test.ts \
  supabase/tests/workflow_participant_notifications_smoke.sql
git commit -m "refactor(workflow): emit participant notifications on backend"
```

---

### Task 5: Chuẩn hóa Request event, watcher và preview

**Files:**
- Create via CLI: migration ending `_request_participant_notifications.sql`
- Create: `supabase/tests/request_participant_notifications_smoke.sql`
- Modify: `lib/__tests__/requestNotificationDeliveryContract.test.ts`
- Modify: `lib/__tests__/requestNotificationRoute.test.ts`

**Database interfaces:**

- `app_private.enqueue_request_notification_event(p_request_id uuid, p_event_type text, p_actor_id uuid, p_event_key text, p_payload jsonb) returns integer`
- Replace `app_private.deliver_request_notification(uuid)` without changing public signature.
- Canonical event types: `REQUEST_SUBMITTED`, `REQUEST_APPROVAL_REQUIRED`,
  `REQUEST_STEP_APPROVED`, `REQUEST_REASSIGNED`, `REQUEST_RETURNED`,
  `REQUEST_RESUBMITTED`, `REQUEST_APPROVED`, `REQUEST_REJECTED`,
  `REQUEST_CANCELLED`, `REQUEST_DUE_SOON`, `REQUEST_OVERDUE`.

- [ ] **Step 1: Sửa test path cũ và viết failing Request contract**

`requestNotificationDeliveryContract.test.ts` hiện đọc migration đã được chuyển vào
archive. Đổi test để đọc baseline hiện tại cộng migration suffix mới, sau đó assert:

```ts
expect(sql).not.toContain("'REQUEST_ACTION_APPLIED'");
expect(sql).toContain('app_private.enqueue_request_notification_event');
expect(sql).toContain("'REQUEST_CANCELLED'");
expect(sql).toContain("'REQUEST_RESUBMITTED'");
expect(sql).toContain("'blockKey'");
expect(sql).toContain("'actorName'");
```

Run targeted tests; expected FAIL do migration chưa có và event còn generic.

- [ ] **Step 2: Viết Request persona smoke**

Tạo request từ template có creator, hai approver, watcher, inactive, outsider.
Exercise `APPROVE`, chuyển block, `RETURN`, `RESUBMIT`, `REASSIGN`, `REJECT`,
`CANCEL`; mỗi nhánh dùng savepoint/fixture riêng. Assert:

- current pending approver nhận việc cần xử lý, approver lịch sử không nhận việc mới;
- watcher snapshot nhận lifecycle, không trở thành approver;
- creator nhận kết quả nhưng không nhận chính hành động RESUBMIT/CANCEL của mình;
- actor exclusion và recipient dedupe;
- title/message map đúng action và có code/title/actor/block;
- payload không lộ `p_comment` nhưng detail audit vẫn giữ comment;
- link `/rq/{id}?block=...`, action URL `/#/rq/{id}?block=...`;
- retry không tạo duplicate notification.

- [ ] **Step 3: Tạo migration và implement canonical enqueue**

```bash
npx --no-install supabase migration new request_participant_notifications
```

Migration phải:

1. Thêm helper map `p_action` sang event type thực tế; xóa việc enqueue
   `REQUEST_ACTION_APPLIED` trong `act_on_request`.
2. Snapshot recipient trước khi đóng assignment: creator, watcher active từ
   `workflow_participants`, current/outgoing/incoming approvers tùy event.
3. Event key deterministic từ request + command idempotency + event + recipient;
   không dùng `now()::text` cho reassign.
4. Builder preview theo event, actor/code/title/block, giới hạn 100/220 ký tự.
5. Delivery revalidate active user, quan hệ/visibility; metadata có request ID/code/
   title, event type/key, actor, block và event ID nếu có.
6. `push_enabled=true`; `link` route app và `action_url` hash route.
7. `notification_config` chỉ điều khiển optional/reminder; submit, assignment,
   mention, return/reject/approve/cancel không bị tắt.
8. Revoke helper private và giữ public worker RPC service-role only.

- [ ] **Step 4: Test và Cloud rollback**

```bash
REQUEST_NOTIFICATION_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_request_participant_notifications\.sql$' | tail -1)"
test -f "$REQUEST_NOTIFICATION_MIGRATION"
npx vitest run lib/__tests__/requestNotificationDeliveryContract.test.ts \
  lib/__tests__/requestNotificationRoute.test.ts
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration "$REQUEST_NOTIFICATION_MIGRATION" \
  --smoke supabase/tests/request_participant_notifications_smoke.sql
git diff --check
```

Expected: tests PASS; rollback smoke không để lại request/outbox/notification.

- [ ] **Step 5: Commit**

```bash
git add "$REQUEST_NOTIFICATION_MIGRATION" \
  supabase/tests/request_participant_notifications_smoke.sql \
  lib/__tests__/requestNotificationDeliveryContract.test.ts \
  lib/__tests__/requestNotificationRoute.test.ts
git commit -m "feat(request): notify active participants by event"
```

---

### Task 6: Nhắc sắp đến hạn/quá hạn không trùng giữa ba module

**Files:**
- Create via CLI: migration ending `_task_notification_deadline_reminders.sql`
- Modify: `supabase/functions/process-request-notifications/index.ts`
- Modify: `supabase/functions/process-workflow-notifications/worker.ts`
- Modify: `supabase/tests/work_r1a_notification_delivery_smoke.sql`
- Modify: `supabase/tests/workflow_participant_notifications_smoke.sql`
- Modify: `supabase/tests/request_participant_notifications_smoke.sql`
- Modify: `lib/__tests__/workflowNotificationWorker.test.ts`
- Modify: `lib/__tests__/requestNotificationDeliveryContract.test.ts`

**Interfaces:**

- `app_private.enqueue_request_notification_reminders(p_limit integer) returns integer`
- `app_private.enqueue_workflow_notification_reminders(p_limit integer) returns integer`
- Work tiếp tục `app_private.work_enqueue_reminders(integer)`.

- [ ] **Step 1: Viết failing reminder matrix tests**

Các tests phải phân biệt:

- `due soon`: chỉ phát một lần cho cùng due timestamp/recipient/window;
- `overdue`: tối đa một lần/ngày nếu vẫn overdue;
- reschedule tạo key mới, complete/cancel không phát;
- Work watcher nhận; Workflow watcher nhận khi instance có assignment due
  authoritative; Request watcher nhận từ Request pipeline;
- Request-owned workflow bị loại khỏi Workflow scanner;
- reminder của chính assignee là mandatory, mute không suppress.

- [ ] **Step 2: Tạo migration và implement scanners**

```bash
npx --no-install supabase migration new task_notification_deadline_reminders
```

1. Dùng bảng key riêng theo domain hoặc unique event key; không scan vô hạn.
2. Mỗi tick giới hạn 100 candidates, dùng index theo status/due time.
3. Request lấy `request_instances.due_at` và current pending assignment due; Workflow
   chỉ lấy non-Request instance có `workflow_step_assignments.due_at`; Work dùng
   `work_tasks.deadline_at`/ack due hiện hữu.
4. Preview ghi mốc hạn đã format theo timezone công ty hoặc ISO metadata; frontend
   không phải đoán timezone.
5. Scanner chỉ enqueue; worker chịu trách nhiệm deliver/retry.

- [ ] **Step 3: Gọi scanner ở đầu worker tick**

`process-request-notifications` và `process-workflow-notifications` gọi reminder RPC
trước claim, chỉ khi gate/module config cho phép. Một scanner lỗi phải trả HTTP 500
và không báo delivery thành công giả.

- [ ] **Step 4: Test, query-plan guard và rollback smoke**

```bash
REMINDER_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_task_notification_deadline_reminders\.sql$' | tail -1)"
WORK_NOTIFICATION_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_work_notification_preview_recipients\.sql$' | tail -1)"
WORKFLOW_OUTBOX_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_workflow_notification_outbox\.sql$' | tail -1)"
WORKFLOW_COMMAND_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_workflow_notification_commands\.sql$' | tail -1)"
REQUEST_NOTIFICATION_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_request_participant_notifications\.sql$' | tail -1)"
test -f "$REMINDER_MIGRATION"
npx vitest run lib/__tests__/workflowNotificationWorker.test.ts \
  lib/__tests__/requestNotificationDeliveryContract.test.ts \
  lib/__tests__/workNotificationWorker.test.ts
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration "$WORK_NOTIFICATION_MIGRATION" \
  --migration "$WORKFLOW_OUTBOX_MIGRATION" \
  --migration "$WORKFLOW_COMMAND_MIGRATION" \
  --migration "$REQUEST_NOTIFICATION_MIGRATION" \
  --migration "$REMINDER_MIGRATION" \
  --smoke supabase/tests/work_r1a_notification_delivery_smoke.sql \
  --smoke supabase/tests/workflow_participant_notifications_smoke.sql \
  --smoke supabase/tests/request_participant_notifications_smoke.sql
npm run lint
git diff --check
```

Expected: cả ba smoke chạy trong các savepoint của cùng rollback transaction; key
dedupe ổn định, query dùng index due/status và không phát chéo module.

- [ ] **Step 5: Commit**

```bash
git add "$REMINDER_MIGRATION" \
  supabase/functions/process-request-notifications/index.ts \
  supabase/functions/process-workflow-notifications/worker.ts \
  supabase/tests/work_r1a_notification_delivery_smoke.sql \
  supabase/tests/workflow_participant_notifications_smoke.sql \
  supabase/tests/request_participant_notifications_smoke.sql \
  lib/__tests__/workflowNotificationWorker.test.ts \
  lib/__tests__/requestNotificationDeliveryContract.test.ts
git commit -m "feat(notifications): add participant deadline reminders"
```

---

### Task 7: Hoàn thiện điểm đến deeplink và focus anchor

**Files:**
- Create: `lib/__tests__/serviceWorkerNotificationClick.test.ts`
- Create: `lib/__tests__/workflowNotificationDeepLink.test.tsx`
- Create: `lib/__tests__/requestNotificationDeepLink.test.tsx`
- Modify: `public/sw.js`
- Modify: `pages/wf/WorkflowInstances.tsx`
- Modify: `pages/wf/WorkflowInstanceDetail.tsx`
- Modify: `pages/request/RequestList.tsx`
- Modify: `components/request/RequestDetailPanel.tsx`
- Modify: `components/request/RequestApprovalInspector.tsx`

- [ ] **Step 1: Viết failing Service Worker click tests**

Dùng VM pattern hiện có để phát `notificationclick`:

- không có app client → `openWindow('/#/...')`;
- có app client ở route khác → `focus()` rồi `navigate()` đúng hash + query;
- external/malformed URL → fallback `/` cùng origin;
- Work comment, Workflow node/comment và Request block/event không mất query.

- [ ] **Step 2: Viết failing component route tests**

Workflow test route `/wf?instanceId=wf-1&nodeId=n-2&commentId=c-3`:

- mở instance `wf-1`;
- mở tab/thảo luận chứa `c-3`, scroll + highlight;
- nếu comment không còn, vẫn render detail và banner “Nội dung liên kết không còn”.

Request test `/rq/rq-1?block=finance&event=e-2`:

- mở request `rq-1`;
- expand/scroll block `finance` và highlight event `e-2`;
- anchor sai fallback detail.

- [ ] **Step 3: Implement safe click normalization**

Trong `public/sw.js`, route notification phải cùng origin; external URL không được
điều hướng. Giữ hash/query nguyên vẹn, không double-normalize `/#/...`. Tăng
`CACHE_NAME` sau thay đổi Service Worker.

- [ ] **Step 4: Implement anchor handling**

Dùng search params làm initial intent, không làm state nguồn lâu dài. Sau khi data
load, focus đúng element bằng stable DOM ID và `scrollIntoView`; highlight có timeout
và hỗ trợ reduced motion. Không tự đánh dấu notification read nếu detail load bị từ chối.

- [ ] **Step 5: Test, lint và build**

```bash
npx vitest run lib/__tests__/serviceWorkerNotificationClick.test.ts \
  lib/__tests__/taskNotificationContract.test.ts \
  lib/__tests__/workflowNotificationDeepLink.test.tsx \
  lib/__tests__/requestNotificationDeepLink.test.tsx \
  lib/__tests__/serviceWorkerAssetCache.test.ts
npm run lint
npm run build
git diff --check
```

Expected: PASS; production bundle có Service Worker mới. Nếu `qa:pwa` còn fail vì
verifier cũ chỉ nhận lowercase `create or replace function`, sửa riêng verifier bằng
test tái hiện; không sửa SQL notification để chiều false positive.

- [ ] **Step 6: Commit**

```bash
git add public/sw.js \
  pages/wf/WorkflowInstances.tsx pages/wf/WorkflowInstanceDetail.tsx \
  pages/request/RequestList.tsx \
  components/request/RequestDetailPanel.tsx \
  components/request/RequestApprovalInspector.tsx \
  lib/__tests__/serviceWorkerNotificationClick.test.ts \
  lib/__tests__/workflowNotificationDeepLink.test.tsx \
  lib/__tests__/requestNotificationDeepLink.test.tsx
git commit -m "feat(notifications): open exact task notification targets"
```

---

### Task 8: Khóa nguồn tạo notification và chạy regression toàn hệ thống

**Files:**
- Create via CLI: migration ending `_task_notification_source_guards.sql`
- Create: `lib/__tests__/taskNotificationSourceGuardMigration.test.ts`
- Create: `supabase/tests/task_notification_source_guards_smoke.sql`
- Modify: `docs/security/task-participant-notification-rollout-log.md`

- [ ] **Step 1: Viết failing spoof tests**

Authenticated user thử insert notification với `source_type/entity_type/category`
của Work, Workflow, Request cho chính mình và người khác; tất cả phải bị SQLSTATE
`42501`. Service role/private delivery vẫn insert được. Update chỉ cho phép owner
đổi read/dismiss fields, không retarget hoặc sửa title/link/metadata.

- [ ] **Step 2: Tạo migration guard có phạm vi hẹp**

```bash
npx --no-install supabase migration new task_notification_source_guards
```

Thêm trigger tương tự Work guard cho `workflow%`, `request_instance` và category
canonical tương ứng. Không drop policy `notifications_insert` toàn cục trong đợt
này vì module cũ còn dùng client service; ghi debt riêng trong rollout log.

- [ ] **Step 3: Cloud rollback security smoke**

```bash
SOURCE_GUARD_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_task_notification_source_guards\.sql$' | tail -1)"
WORK_NOTIFICATION_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_work_notification_preview_recipients\.sql$' | tail -1)"
WORKFLOW_OUTBOX_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_workflow_notification_outbox\.sql$' | tail -1)"
WORKFLOW_COMMAND_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_workflow_notification_commands\.sql$' | tail -1)"
REQUEST_NOTIFICATION_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_request_participant_notifications\.sql$' | tail -1)"
REMINDER_MIGRATION="$(rg --files supabase/migrations | rg '/[0-9]+_task_notification_deadline_reminders\.sql$' | tail -1)"
test -f "$SOURCE_GUARD_MIGRATION"
npx vitest run lib/__tests__/taskNotificationSourceGuardMigration.test.ts
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration "$WORK_NOTIFICATION_MIGRATION" \
  --migration "$WORKFLOW_OUTBOX_MIGRATION" \
  --migration "$WORKFLOW_COMMAND_MIGRATION" \
  --migration "$REQUEST_NOTIFICATION_MIGRATION" \
  --migration "$REMINDER_MIGRATION" \
  --migration "$SOURCE_GUARD_MIGRATION" \
  --smoke supabase/tests/task_notification_source_guards_smoke.sql
git diff --check
```

- [ ] **Step 4: Full local regression**

```bash
npm test
npm run lint
npm run build
npm run check:supabase-migrations
npm run audit:supabase-queries
git diff --check
```

Expected: tất cả PASS. Ghi rõ mọi failure đã có từ trước; không lẫn sửa module khác.

- [ ] **Step 5: Commit release candidate**

```bash
git add "$SOURCE_GUARD_MIGRATION" \
  lib/__tests__/taskNotificationSourceGuardMigration.test.ts \
  supabase/tests/task_notification_source_guards_smoke.sql \
  docs/security/task-participant-notification-rollout-log.md
git commit -m "security(notifications): guard task notification sources"
```

---

### Task 9: Apply Cloud, canary và mở gate có kiểm soát

**Files:**
- Modify: `docs/security/task-participant-notification-rollout-log.md`

- [ ] **Step 1: Chụp preflight read-only**

Ghi vào rollout log:

```bash
npx --no-install supabase --version
npx --no-install supabase migration list --linked
npx --no-install supabase db push --linked --dry-run
```

Chạy query read-only thống kê:

- Work outbox pending/dead/oldest age và gate hiện tại;
- Request outbox pending/failed/oldest age;
- notification 7/30 ngày theo source type;
- delivery sent/failed/skipped, 404/410 và `no_active_subscriptions`;
- active users, users có active subscription, subscription/user.

Expected: dry-run chỉ liệt kê migration của kế hoạch; nếu có migration lạ thì dừng.

- [ ] **Step 2: Apply migrations khi gate vẫn tắt**

```bash
npx --no-install supabase db push --linked --dry-run
npx --no-install supabase db push --linked
npx --no-install supabase migration list --linked
```

Expected: ledger local/remote khớp; Work/Workflow settings vẫn `enabled=false`.

- [ ] **Step 3: Deploy Edge Functions không Docker**

```bash
npx --no-install supabase functions deploy process-workflow-notifications \
  --project-ref ftciqmqhmfvjtwoycswe --use-api
npx --no-install supabase functions deploy process-request-notifications \
  --project-ref ftciqmqhmfvjtwoycswe --use-api
npx --no-install supabase functions deploy process-work-notifications \
  --project-ref ftciqmqhmfvjtwoycswe --use-api
```

Expected: cả ba deploy thành công. Gọi health endpoint bằng secret-safe helper; không
in secret ra terminal/log.

- [ ] **Step 4: Chạy postflight smoke khi gate tắt**

Chạy ba smoke transaction rollback bằng `supabase db query --linked --agent=no
--file ...`. Expected: recipient/content/deeplink/ACL PASS và không có notification
fixture tồn tại sau rollback.

- [ ] **Step 5: Đặt rollout cutoff và quarantine backlog Work cũ**

Trong một transaction Cloud được ghi log:

1. Re-query số pending Work và oldest timestamp.
2. Set `rollout_started_at=now()`.
3. Mark các row trước cutoff `dead_at=now(), last_error='pre_rollout_backlog'`;
   không delete.
4. Ghi count/ID range vào rollout log.
5. Giữ gate false và xác nhận worker không claim backlog.

- [ ] **Step 6: Canary chức năng**

Dùng dữ liệu canary không nhạy cảm và ba tài khoản có subscription:

1. creator tạo Work có assignee + watcher;
2. comment + mention; assignee gửi review; reviewer approve;
3. Workflow submit → chuyển bước → return/reopen;
4. Request submit → approve/reassign/return/resubmit;
5. tạo due-soon fixture rồi hủy/complete sau kiểm tra.

Đối chiếu từng notification: recipient set, actor exclusion, title/message, metadata,
link/action URL, in-app realtime, push device và click target. Không dùng nội dung
thật của công ty trong preview test.

- [ ] **Step 7: Bật gate theo thứ tự và quan sát**

1. Bật Workflow canary trước; quan sát 30 phút.
2. Bật Work canary; quan sát 30 phút.
3. Request đã active: xác nhận event mới không spike/duplicate.
4. Mở toàn bộ user khi các ngưỡng đều đạt.

Ngưỡng dừng/rollback:

- bất kỳ notification gửi outsider/inactive/actor không đúng;
- duplicate > 0 cho cùng event/user/channel;
- deeplink sai hoặc external;
- outbox oldest age > 5 phút liên tiếp 10 phút;
- failure không gồm 404/410 > 5% trong 15 phút;
- preview lộ raw comment/form/file.

Rollback an toàn: set Work/Workflow gate false trước, giữ outbox để điều tra; Request
worker có thể tạm dừng cron/function schedule nhưng không xóa notification hay
subscription. Revert app chỉ sau khi chặn producer để tránh tiếp tục tạo event lỗi.

- [ ] **Step 8: Theo dõi 24 giờ và chốt evidence**

Ghi snapshot sau 1h và 24h:

- outbox processed/failed/dead/age;
- notifications theo domain/event type;
- deliveries sent/skipped/failed và inactive subscriptions;
- ba deeplink click persona desktop/mobile/iOS PWA nếu có;
- xác nhận broadcast vẫn không đổi.

Run cuối:

```bash
npm test
npm run lint
npm run build
npm run check:supabase-migrations
git diff --check
```

- [ ] **Step 9: Commit rollout evidence**

```bash
git add docs/security/task-participant-notification-rollout-log.md
git commit -m "docs(notifications): record participant push rollout"
```

---

## Definition of Done

- Work, Workflow, Request đều phát notification từ backend/outbox, không phụ thuộc
  tab React còn mở.
- Recipient matrix đúng với creator/active assignee/active watcher/current reviewer/
  mention, loại actor và participant đã kết thúc.
- Mọi event có preview actor + hành động + mã/tên + bước/hạn phù hợp, không lộ dữ
  liệu nhạy cảm và không còn câu preview chung chung.
- Web Push mở đúng detail và anchor trong cả app đang mở/đóng; access bị thu hồi thì
  fail closed.
- Retry/idempotency không nhân đôi, 404/410 vô hiệu subscription, backlog Work cũ
  không bị gửi sau activation.
- Full tests/lint/build, Cloud rollback smoke, canary và quan sát 24h đều có evidence.
- Broadcast toàn công ty vẫn nằm ngoài thay đổi của kế hoạch này.

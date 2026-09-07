# Vioo Work R1A — handoff trước Task 3

> Cập nhật: 2026-09-07 (Asia/Ho_Chi_Minh)  
> Trạng thái: Task 0–2 đã hoàn thành; bắt đầu tiếp từ Task 3  
> Phạm vi: triển khai R1A, không triển khai R1B–R3 trong nhánh này

## 1. Điểm bắt đầu cho phiên chat mới

Làm việc tại:

```text
/Users/admin/khotienthinh/.worktrees/vioo-work-r1a
```

- Branch: `feature/vioo-work-r1a`
- Implementation checkpoint trước handoff: `c9cc08d`
- Base đã chọn: `74d18a1`
- Commit đặc tả đã cherry-pick: `e251c9a`
- Supabase Cloud project duy nhất được phép dùng: `ftciqmqhmfvjtwoycswe`
- Feature flag: `VITE_ENABLE_VIOO_WORK=false`
- Không làm việc trong checkout gốc `/Users/admin/khotienthinh`.
- Không dùng Supabase local hoặc Docker.
- Không dùng `db push --include-all`.
- Không sử dụng sub-agent theo `AGENTS.md`.

Trước khi chỉnh sửa, chạy:

```bash
cd /Users/admin/khotienthinh/.worktrees/vioo-work-r1a
git status --short
git log -8 --oneline
```

Kỳ vọng tại thời điểm handoff: worktree sạch. Nếu có thay đổi ngoài file handoff,
phải coi đó là thay đổi của người dùng và kiểm tra trước khi sửa.

## 2. Nguồn sự thật cần đọc

Đọc theo thứ tự:

1. `AGENTS.md` — ràng buộc workspace và Supabase Cloud.
2. `docs/superpowers/specs/2026-09-05-vioo-work-task-management-design.md`
   — đặc tả nghiệp vụ đã duyệt.
3. `docs/runbooks/vioo-work-r1a-rollout.md` — bằng chứng rollout đang tích lũy.
4. Kế hoạch R1A trong yêu cầu người dùng của phiên trước, đặc biệt Task 3–11.
5. Các migration Work đã áp dụng; không được sửa nội dung các file này.

Nếu phiên chat mới không còn nội dung kế hoạch đầy đủ, Task 3 được khóa tại mục 6
của handoff này; các Task 4–11 được tóm tắt tại mục 7.

## 3. Các checkpoint đã hoàn thành

### Task 0 — worktree và baseline

Commit: `2887eac chore(work): establish R1A delivery baseline`

- Tạo worktree/branch đúng base.
- Thêm `VITE_ENABLE_VIOO_WORK=false` vào `.env.example`.
- Thêm `isViooWorkEnabled` trong `lib/featureFlags.ts`.
- Chưa đăng ký UI route Work.
- Baseline ban đầu: 346 test files, 1.639 tests; lint/build/migration checker/query
  audit đạt.

### Task 1 — permission registry và route boundary

Commits:

- `c47433a feat(work): register canonical Work permissions`
- `791b363 fix(work): preserve authenticated permission helper execution`
- `de0c696 fix(work): deny unknown routes and enforce canonical module visibility`

Đã áp dụng lên Cloud:

- `20260907012229_work_r1a_permission_registry.sql`
- `20260907015936_work_r1a_restore_permission_execution.sql`

Permission canonical đã đăng ký:

```text
work.module.access
work.task.create
work.task.view_related
work.task.assign_user
work.task.assign_group
work.task.view_scope
work.task.view_restricted
work.task.manage_scope
work.task.review
work.task.audit_view
work.task.configure
```

Quy tắc quan trọng:

- Work không có legacy alias trong `allowed_modules`.
- `Role.ADMIN` không bypass nếu thiếu canonical Work grant.
- Route Work không biết trước bị deny.
- Module visibility dùng action canonical `access`.
- Không cấp quyền hàng loạt cho 57 user đang hoạt động.

Sự cố đã xử lý: migration registry ban đầu revoke EXECUTE trên helper
`app_private.has_permission`, ảnh hưởng RLS hiện có. Migration forward
`20260907015936...` đã khôi phục quyền EXECUTE cho `authenticated`; postflight đạt.
Không được sửa lại hai migration đã chạy.

### Task 2 — core schema, constraints và RLS

Commits:

- `7a7daf0 feat(work): add secure task domain schema`
- `c9cc08d docs(work): record core schema Cloud postflight`

Đã áp dụng lên Cloud:

- `20260907021001_work_r1a_core_schema.sql`

Các nhóm bảng đã tạo:

- Task/bucket: `work_tasks`, `work_task_groups`.
- Recipient snapshot: `work_task_recipient_specs`,
  `work_task_recipient_members`, `work_task_recipient_member_sources`.
- Vòng đời: `work_task_assignments`, `work_task_participants`,
  `work_task_submissions`.
- Nội dung: checklist, comments, mentions, attachments.
- Audit/cá nhân: versions, events, pins, notification preferences.
- SLA: calendars, exceptions, policies.
- Private: code counter, command idempotency, notification outbox/deliveries.

Đặc tính đã kiểm chứng:

- Mã `VW-YYYY-NNNNNN` sinh nguyên tử theo `Asia/Ho_Chi_Minh`, không cắt khi vượt
  sáu chữ số.
- `department_id uuid` và `project_id text` giữ riêng, scope có constraint độc quyền.
- Bucket không thể đổi scope sau khi tạo; task/bucket phải cùng scope.
- Không cho liên kết reply, mention hoặc transfer chéo task.
- Task identity, event/version history bất biến; không hard-delete assignment và
  submission.
- Bảng public chỉ cấp SELECT phù hợp cho `authenticated`; mutation sẽ đi qua RPC.
- Bảng private revoke client access và bật RLS defense-in-depth.
- `app_private.work_task_actor_can_view(uuid)` thực thi canonical module + quan hệ
  hoặc scope + privacy.
- Task `restricted` chỉ mở cho quan hệ trực tiếp hoặc `view_restricted` đúng scope.

Cloud smoke dùng `SET LOCAL ROLE authenticated` với 10 persona:

```text
creator, assignee, watcher, reviewer, manager, unrelated, inactive,
restricted_manager, technical_admin, scoped_watcher
```

Mọi fixture nằm trong transaction rollback. Postflight đạt; local/Cloud ledger
khớp 11/11 migration. Cloud security advisor ở mức `error` không có issue. Không
tuyên bố sạch warning/info vì chưa xử lý hai mức đó.

Verification gần nhất:

```text
npm test -- --reporter=dot       349 files / 1.654 tests / 0 failures
npm run lint                     passed
npm run build                    passed; chỉ có chunk-size warning cũ
npm run check:supabase-migrations 11 active / 402 archived
npm run audit:supabase-queries   0 findings / 0 errors
```

## 4. Trạng thái hệ thống hiện tại

- Core schema đã tồn tại trên Supabase Cloud.
- Chưa có RPC Task 3: preview/create/list/detail/clone.
- Chưa có task nghiệp vụ/pilot được tạo bởi rollout.
- Chưa có UI route/menu Work.
- Feature flag vẫn tắt.
- Chưa cấp canonical Work grant cho cohort pilot.
- Chưa có notification worker, Edge Function upload hoặc Realtime publication.
- Chưa cấu hình lịch làm việc/SLA; không được tự đoán lịch công ty.

Không sửa migration đã áp dụng. Nếu phát hiện lỗi schema sau đây, tạo migration
forward mới.

## 5. Chu trình bắt buộc cho mỗi task/migration

Mỗi tính năng:

1. Viết failing test.
2. Chạy và xác nhận fail đúng lý do.
3. Viết implementation tối thiểu.
4. Chạy targeted tests.
5. Chạy `npm run lint`; chạy `npm run build` nếu có UI.

Mỗi migration:

1. Tạo file bằng `npx --no-install supabase migration new <name>`.
2. Viết behavioral smoke trong `supabase/tests/`.
3. Nạp `.env` gốc và chạy Cloud rollback transaction.
4. Commit release candidate bằng danh sách file cụ thể; không `git add .`.
5. Chạy `supabase db push --linked --dry-run` và xác nhận chỉ migration dự kiến.
6. Apply bằng `supabase db push --linked --yes`.
7. Chạy postflight và ghi bằng chứng vào rollout runbook.

Nạp cấu hình Cloud mà không in secret:

```bash
set -a
source /Users/admin/khotienthinh/.env
set +a
```

Rollback smoke mẫu:

```bash
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration supabase/migrations/<migration>.sql \
  --smoke supabase/tests/<smoke>.sql
```

Tuyệt đối không dùng local Supabase, Docker hay `--include-all`.

## 6. Việc tiếp theo — Task 3

Tên checkpoint: **Recipient preview, create, list, detail và clone draft**.

Commit dự kiến:

```text
feat(work): add recipient and task creation commands
```

### 6.1 TypeScript contracts

Tạo `lib/work/workTypes.ts`, không mở rộng `ProjectTask` trong `types.ts`.

Các contract tối thiểu:

```ts
type WorkScope =
  | { type: 'direct' }
  | { type: 'department'; departmentId: string }
  | { type: 'project'; projectId: string };

type WorkRecipientSource =
  | { type: 'user'; id: string }
  | { type: 'work_group'; id: string };

interface CreateWorkTaskInput {
  title: string;
  description: WorkTextDocument;
  scope: WorkScope;
  taskGroupId?: string;
  recipientSources: WorkRecipientSource[];
  watcherUserIds: string[];
  reviewerUserId?: string;
  deadlineAt?: string;
  priority: 'normal' | 'important' | 'urgent';
  privacy: 'standard' | 'restricted';
  labels: string[];
  checklist: Array<{ title: string; assigneeUserId?: string }>;
  clonedFromTaskId?: string;
}
```

Thêm `WorkTaskCommandResult`, `WorkTaskPage<T>`, `WorkTaskDetail` và capability
types feature-local. Comments/events phải tải riêng bằng cursor, không nhồi vào
detail.

### 6.2 RPC cần triển khai trong Task 3

```text
preview_work_task_recipients
create_work_task
list_work_tasks
get_work_task_detail
get_work_task_clone_draft
list_work_task_groups
```

Mọi RPC phải xác định actor bằng `current_app_user_id()`; không nhận actor từ
client. Security-definer function phải nằm trong private schema hoặc public
wrapper được revoke/grant chính xác, `search_path=''`, kiểm actor và capability.

### 6.3 Recipient preview

- R1A chỉ nhận nguồn `user` và `work_group`.
- `work_group_members.user_id` là `text`, còn `users.id` là `uuid`.
- Join an toàn theo `work_group_members.user_id = users.id::text`; không cast dữ
  liệu legacy text sang UUID.
- Chỉ lấy group/member active.
- Loại user inactive, `account_status <> 'ACTIVE'`, không có app account hoặc
  thiếu `work.module.access` canonical.
- Dedupe user nhưng giữ đầy đủ provenance từ từng source.
- Trả cả valid/invalid counts, lý do loại và fingerprint ổn định.
- Fingerprint phải phụ thuộc tập source + member hợp lệ/provenance; create từ chối
  nếu group/member/quyền thay đổi sau preview.
- Không cho preview rỗng tạo task.

### 6.4 Create task

- Nhận `p_idempotency_key uuid` và fingerprint đã preview.
- Toàn bộ task, snapshot, assignments, participants, checklist, initial version,
  event và outbox nằm trong một transaction/function call.
- Kiểm `work.task.create`, `assign_user`/`assign_group`, scope, bucket và privacy.
- Từ chối nếu calendar cần thiết chưa cấu hình theo quy tắc đã duyệt; nếu quyết
  định này làm Task 3 phụ thuộc Task 4/10, triển khai private assertion tối thiểu
  có mã `WORK_CALENDAR_NOT_CONFIGURED`, không tự seed lịch.
- Self-assignment tự xác nhận và chuyển assignment sang `not_started`.
- Self-only direct task mặc định `auto_complete`.
- Task khác mặc định reviewer là creator và dùng creator review, trừ override hợp
  lệ.
- Ghi `cloned_from_task_id` chỉ để truy vết; không kế thừa quyền từ task nguồn.
- Retry cùng actor/key/payload trả cùng response; cùng key payload khác phải bị
  từ chối.

### 6.5 List/detail/clone

- `list_work_tasks` dùng cursor `{sortAt,id}`, giới hạn cứng; không query unbounded.
- Views R1A: `assigned_to_me`, `created_by_me`, `following`, `pinned`.
- Filters: status, priority, scope, bucket, deadline và search.
- Sort ổn định theo thời gian + UUID.
- Detail trả task, assignments, participants, checklist, submission hiện hành,
  attachments ready và capabilities. Comments/history không nằm trong payload.
- Clone chỉ trả draft prefill; không INSERT cho tới `create_work_task`.
- Clone sao chép allowlist: title, description, scope, bucket, labels, priority,
  recipient sources/snapshot draft, watchers/reviewer/review policy, checklist
  chưa hoàn thành.
- Không clone UUID/code/status/timestamps/SLA/progress/submission/comments/events/
  file kết quả/completion checklist.
- Deadline hết hiệu lực không được âm thầm dùng lại; UI sau này bắt xác nhận.

### 6.6 Test bắt buộc của Task 3

- Nhóm có thành viên trùng và một user từ nhiều nguồn.
- Thành viên nhóm thay đổi sau preview.
- User inactive/no app account/không module access bị loại đúng lý do.
- Zero valid recipient.
- Self-assignment.
- Code concurrency, không trùng mã.
- Idempotent retry và key/payload conflict.
- Scope/bucket/capability deny.
- Clone allowlist và không tạo row.
- Cursor không trùng/không bỏ row ở cùng timestamp.
- Detail không chứa comments/events và không lộ restricted task.
- Cloud smoke phải dùng role `authenticated`, không chỉ chạy bằng owner.

## 7. Roadmap còn lại của R1A

- Task 4: lifecycle assignment, review, transfer/co-assignee và SLA/calendar engine.
- Task 5: checklist CRUD, discussion/reply/edit audit, mention, history, pin/mute.
- Task 6: transactional notification outbox, worker dedupe/retry, deep link và
  Realtime invalidation.
- Task 7: private Storage, two-phase upload, image compression và Edge Function.
- Task 8: module shell, cursor list và drawer/full-screen create.
- Task 9: responsive task detail, capability actions và screenshot QA.
- Task 10: scoped bucket/calendar/SLA settings và named pilot enablement.
- Task 11: full Cloud rollout evidence, EXPLAIN, six-plus JWT personas, deployment
  và 48-hour observation.

R1B giao department/company, R2 Dashboard V2 và R3 AI runtime vẫn chỉ là roadmap.

## 8. Các bẫy đã biết

- Không revoke/grant blanket trên helper dùng chung; smoke phải test bằng
  `SET LOCAL ROLE authenticated`.
- `Role.ADMIN` kỹ thuật không có quyền Work nếu thiếu grant canonical.
- Không cast `work_group_members.user_id` sang UUID vì dữ liệu legacy có thể lỗi.
- RLS helper không thay thế table privilege; phải kiểm cả GRANT và policy.
- Không đưa toàn bộ task vào `AppContext`; services/hooks phải feature-local.
- Không mở route/menu khi flag tắt.
- Không nhận user ID do client truyền làm actor.
- Không sửa migration đã apply; mọi repair là forward migration.
- Không ghi rằng advisor sạch hoàn toàn khi mới chạy `--level error`.
- Không bật pilot trước khi calendar, commands, notifications và Storage smoke đạt.

## 9. Prompt khởi động đề xuất cho phiên chat mới

```text
Tiếp tục triển khai Vioo Work R1A từ Task 3 trong worktree
/Users/admin/khotienthinh/.worktrees/vioo-work-r1a.

Đọc đầy đủ AGENTS.md, docs/runbooks/vioo-work-r1a-handoff.md,
docs/runbooks/vioo-work-r1a-rollout.md và đặc tả
docs/superpowers/specs/2026-09-05-vioo-work-task-management-design.md trước khi sửa.

Thực hiện Task 3 theo TDD và migration checkpoint trong handoff. Chỉ dùng Supabase
Cloud project ftciqmqhmfvjtwoycswe với .env ở repo gốc; không local, không Docker,
không --include-all, không sub-agent. Feature flag tiếp tục false và không cấp
pilot grants. Không sửa ba migration Work đã apply. Tiếp tục tự chủ đến khi Task 3
được kiểm chứng, commit, dry-run/apply/postflight và cập nhật rollout evidence.
```

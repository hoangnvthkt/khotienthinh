# Vioo Work R1A rollout

## Trạng thái hiện tại — đối chiếu pilot 2026-09-08

**Chưa nghiệm thu toàn bộ R1A.** Task 1–10 và WS1–8 đã có triển khai kỹ thuật;
gửi notification thật, nghiệm thu thiết bị và quan sát 48 giờ còn thiếu. Các mục
evidence phía dưới ghi trạng thái tại thời điểm thực hiện, không thay thế bảng này.

| Lộ trình | Đã triển khai | Còn thiếu hoặc đang điều chỉnh |
| --- | --- | --- |
| Task 1–2 | Permission/module boundary, schema, RLS | Tiếp tục hồi quy theo thay đổi mới |
| Task 3 | Tạo/list/detail/clone, recipient preview và công việc con đầy đủ một cấp | Nghiệm thu người dùng thật còn thiếu |
| Task 4 | Vòng đời, nhận/chuyển việc, review, lịch và SLA; cha đóng độc lập ở server | UI đã cảnh báo mềm khi còn việc con mở |
| Task 5 | Checklist, thảo luận, mention, lịch sử | Chưa có mention trong dòng; checklist không phải task con |
| Task 6 | Event/outbox, worker, cron, mute/dedupe, Realtime | Delivery gate=false; chưa nghiệm thu notification/push thật |
| Task 7 | Private Storage, upload, xử lý ảnh, đọc/tải tệp | Preview trong trang mới có ảnh; PDF/TXT còn cần bổ sung |
| Task 8–9 | Danh sách/tạo/chi tiết và thao tác responsive | Đã sửa refresh nhấp nháy, nối bố cục v2 và việc con; còn preview PDF/TXT và mention trong dòng |
| Task 10 | Cấu hình nhóm/lịch/SLA; hai người dùng pilot và dev | Lịch thứ Hai–thứ Bảy 08–12/13–17 đã cấu hình; delivery pilot chưa bật |
| Task 11 | Có test kỹ thuật và checklist nghiệm thu | Chưa hoàn tất kiểm tra thiết bị thật và quan sát 48 giờ |
| WS1–5 | Workspace, membership/quyền, gợi ý tổ chức, task scope, cấu hình | Hồi quy quyền công việc con đã qua Cloud smoke; tiếp tục nghiệm thu UI |
| WS6–7 | Menu Workspace, trang làm việc/thành viên/cấu hình | Đã sửa payload tạo Workspace; người dùng cần thử lại trường hợp thực tế |
| WS8 | Cutover Cloud vào Workspace pilot và kiểm thử kỹ thuật | Nghiệm thu người dùng đang diễn ra; phản hồi 08/09 chưa đóng hết |
| R1B / R2 / R3 | Chưa triển khai | Dispatch hàng loạt / dashboard phân tích / AI & automation |

Phản hồi 08/09 và bản bố cục tương tác được ghi tại
[thiết kế điều chỉnh pilot](../superpowers/specs/2026-09-08-vioo-work-pilot-feedback-design.md).
Quyết định đã chốt: **cha hoàn thành độc lập; cảnh báo nếu còn con mở, không đóng
con theo cha**. Backend giữ trạng thái con độc lập và UI đã cảnh báo trước thao
tác hoàn thành cha nhưng vẫn cho phép người dùng tiếp tục.

Thiết kế tiếp tục được điều chỉnh theo ảnh tham khảo của người dùng: **bản v2**
giữ danh sách bên cạnh detail, menu tối, nhãn nhẹ, các khối mô tả/kết quả/việc con,
watcher bên phải với thêm/bỏ; thay nhãn thời hạn bằng cặp **Ngày bắt đầu – Ngày
kết thúc**. Ngày bắt đầu là lịch dự kiến mới; `started_at` và `completed_at` giữ
ý nghĩa thời gian thực tế. Bản tương tác đã kiểm tra ở 1850/1440/768/360. Schema,
RPC lịch và watcher đã lên Cloud; bố cục này đã được nối vào mã nguồn giao diện.

Yêu cầu UX tiếp theo đã được ghi vào thiết kế: giữ **thanh thao tác luôn hiển thị
khi cuộn**, với hành động chính, Chuyển việc, Thêm đồng thực hiện và Hủy công việc.
Bản mẫu đặt thanh ở đáy cột detail; mobile bám đáy và chừa khoảng trống theo chiều
cao thanh. Khi triển khai phải giữ safe-area/bottom-navigation và quyền/mutation
của `WorkActions` hiện có. Kiểm tra trình duyệt hiện xác nhận chỉ có một thanh
thao tác và thanh vẫn trong viewport ở đầu, giữa và cuối trang, kể cả chiều rộng 320px.

### Bản sửa và kiểm chứng 08/09

- Commit sửa lỗi: `2991031` trên `feature/vioo-work-r1a`.
- Refresh: giữ nội dung cùng query trong khi tải nền; access revision vẫn tải lại
  quyền; khi đổi phạm vi/tài khoản/filter hoặc server từ chối, dữ liệu tương ứng
  được xóa. Khôi phục scroll theo route entry, không theo mỗi lần refresh.
- Workspace: sửa cover mặc định từ `office/site/team` sang
  `blueprint/sunrise/grid`, đúng allowlist RPC/constraint. Cloud rollback tái hiện
  cover `team` bị từ chối và cùng payload `grid` tạo được dưới persona admin.
  Fixture browser nay kiểm tra allowlist thay vì luôn chấp nhận payload.
- RED: browser refresh tháo nội dung đang đọc; browser tạo Workspace thất bại khi
  fixture kiểm tra đúng contract. GREEN: refresh, Workspace và Task 9 browser
  suites đạt, gồm refresh khi bị thu hồi quyền, đổi bộ lọc và giữ scroll.
- Toàn bộ Vitest: **365 files / 1.731 tests**, TypeScript/lint và production build
  đạt; build còn cảnh báo chunk lớn đã có trước. Không có migration mới trong đợt
  sửa này. Bản thiết kế mock cũng đã kiểm tra ở 1440/768/360; chưa nối dữ liệu thật.
- Cloud inventory 08/09 lúc 11:19 giờ Việt Nam: outbox **15**, deliveries **0**,
  push jobs **0**, enabled **false**; cron `work-notification-outbox` active mỗi
  phút, cleanup active mỗi 5 phút. Event tạo/nhận/chuyển việc/mention/nộp/hoàn thành
  đã được ghi. Chưa thay đổi gate hay phát thông báo; cần xử lý backlog và xác nhận
  gửi pilot trước khi kích hoạt.
- Dev đang phục vụ worktree tại `http://127.0.0.1:5187/#/work`; production không
  được triển khai trong đợt này. Fingerprint/outbox cũ ở WS8 là snapshot lịch sử;
  không chạy lại phép so sánh cố định sau khi người dùng đã thao tác dữ liệu.

## Release controls

- Supabase project: `ftciqmqhmfvjtwoycswe`
- Delivery branch: `feature/vioo-work-r1a`
- Source baseline: `74d18a1`
- Approved design: `e251c9a`
- Feature flag: `VITE_ENABLE_VIOO_WORK=false`
- Pilot access: canonical grants to named users only
- Database target: linked Supabase Cloud only; no local database or Docker

## Baseline evidence

Captured on 2026-09-07 before Work implementation:

- Local and Cloud migration ledgers match through
  `20260905041938_material_issue_approval_reversal_return.sql` (8/8 active migrations).
- `npm test -- --reporter=dot`: 346 files and 1,639 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed with the existing chunk-size warning only.
- `npm run check:supabase-migrations`: passed; 8 active and 402 archived SQL files.
- `npm run audit:supabase-queries`: 0 findings and 0 errors.
- `npm ci`: completed without tracked-file changes. Existing dependency audit result:
  14 vulnerabilities (1 low, 5 moderate, 6 high, 2 critical); remediation is not
  included in the Work rollout because forced upgrades may be breaking.

## Mandatory migration checkpoint

For every Work migration:

1. Run its Cloud rollback smoke test.
2. Commit the release candidate with explicit paths only.
3. Run `supabase db push --linked --dry-run` with the repository `.env` loaded.
4. Apply only the expected migration to project `ftciqmqhmfvjtwoycswe`.
5. Run postflight checks and record evidence below.

Never amend a migration that has been applied. Roll back behavior with the feature
flag and repair schema or data with a forward migration.

## Rollout gates

- [x] Permission catalog and route boundary verified.
- [x] Core schema/RLS and ten-persona Cloud smoke verified.
- [x] Commands, lifecycle, SLA, collaboration, and outbox verified.
- [x] Private Storage and upload processor verified.
- [x] Responsive UI verified at 360x800, 768x1024, and 1440x900 in isolated Chrome QA; named-device pilot remains Task 11.
- [x] Named pilot grants reviewed; no bulk grants exist.
- [x] Feature flag enabled only for the approved deployment environment.
- [ ] Forty-eight-hour observation completed.

## Cloud rollout evidence

Append migration dry-run/apply output, smoke personas, query plans, advisor results,
Edge Function deployment, pilot grants, and the 48-hour observation summary here.

### Task 1 — canonical permission boundary (2026-09-07)

- Applied `20260907012229_work_r1a_permission_registry.sql` after rollback smoke,
  release-candidate commit and linked dry-run.
- Authenticated-role regression exposed an overly broad EXECUTE revocation on
  the existing `app_private.has_permission` helper. Forward migration
  `20260907015936_work_r1a_restore_permission_execution.sql` restored the baseline
  authenticated EXECUTE grant. Its rollback smoke, isolated dry-run/apply and
  authenticated-role postflight passed. Applied migration files were not amended.
- Frontend denies unknown Work routes and technical ADMIN without canonical
  grants. Module visibility uses the canonical `access` action, not a legacy key.
- Flag remains off; no pilot grants or Work legacy aliases were created.

### Task 2 — core schema release candidate (2026-09-07)

- Candidate: `20260907021001_work_r1a_core_schema.sql`.
- Real Cloud transaction smoke uses `SET LOCAL ROLE authenticated` with ten
  synthetic JWT contexts: creator, assignee, watcher, reviewer, scoped manager,
  unrelated user, inactive user, restricted manager, technical ADMIN without
  Work grants, and department-scoped watcher. All fixtures roll back.
- RED/GREEN checks caught and fixed: helper EXECUTE access, seven-digit code
  truncation, mutable task identity/history, cross-task reply/mention/transfer,
  bucket scope rewriting, missing FK indexes/private RLS, scoped view grants,
  and audit scope incorrectly treating an unrelated manager as assigned.
- Cloud smoke passed for standard/restricted visibility, department/project
  isolation, audit grants, direct UPDATE denial, immutable histories and schema
  integrity. This is database-role testing, not yet the R1A HTTP/JWT acceptance
  suite, Storage smoke, concurrency/load tests or scaled EXPLAIN evidence.
- Targeted frontend/migration regression: 53 tests across 7 files passed.
- Post-apply full regression: `npm test -- --reporter=dot` passed 349 files and
  1,654 tests (0 failures).
- `npm run lint` and `npm run build` passed (existing chunk-size warning).
- Migration baseline: 11 active files, 402 archived; query audit: 0 findings.
- Pre-apply Cloud security advisor at `--level error`: no issues.
- Security design follows the grants-plus-RLS separation in
  [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Release candidate: `7a7daf0` (`feat(work): add secure task domain schema`).
- Linked dry-run listed only `20260907021001_work_r1a_core_schema.sql`; apply
  succeeded. Postflight core smoke and authenticated permission-helper smoke
  passed. Local/Cloud migration ledgers match at 11/11. Post-apply Cloud security
  advisor at `--level error` reported no issues. Lower-severity advisor findings
  have not been claimed clean.
- Core schema is deployed; no task command RPCs/UI or pilot activation are
  included in this checkpoint. Next: Task 3 recipient preview, create/list/detail
  and clone draft. Feature remains disabled.

### Task 3 — recipient and task commands release candidate (2026-09-07)

- Candidate: `20260907023329_work_r1a_task_commands.sql`; six public invoker
  wrappers delegate to guarded private functions with `search_path=''`.
- `lib/work/workTypes.ts` defines independent Work input/read/cursor/capability
  contracts. Detail excludes discussion and history; list pages cap at 100 rows.
- Authenticated-role rollback smoke passed: overlapping group/user provenance,
  legacy non-UUID membership, inactive/disabled/missing-account/module exclusions,
  stable preview ordering, membership and canonical permission drift, zero valid
  recipients, self and collaborative defaults, creator/scoped permissions,
  department/project creation, bucket mismatch, reviewer override denial,
  document allowlist, atomic rollback, idempotent retry/conflict, version/event/
  outbox, ready attachments, restricted detail, read-only clone and expired
  deadline handling. Pagination covered 103 tied timestamps across 100+3 rows.
- Existing account lifecycle trigger synchronizes disabled accounts to inactive;
  both fixtures are excluded as `INACTIVE_USER`. Missing `users` records are
  `NO_APP_ACCOUNT`; an unlinked `auth_id` alone is not a missing app account,
  because the existing actor resolver supports the email fallback.
- Missing calendar returns `WORK_CALENDAR_NOT_CONFIGURED`. The small creation
  helper applies default priority acknowledgement durations using configured
  weekdays/hours and date exceptions; weekend/holiday smoke passed. Task 4 must
  finish policy overrides, execution SLA and lifecycle integration. No company
  calendar was inferred or persisted.
- `scripts/smoke-work-code-concurrency.mjs`: two concurrent Cloud transactions
  allocated 16 distinct codes. Only the shared code counter advanced; no task,
  user, grant, calendar, event or notification was persisted. The unused code
  gaps are intentional and the counter was not rewound.
- Frontend regression: 349 files / 1,654 tests passed; lint/build passed (existing
  chunk-size warning). Query audit: 0 findings/errors. Cloud security advisor
  at `--level error`: no issues before apply.
- Security approach checked against [Supabase database function documentation](https://supabase.com/docs/guides/database/functions).
- Feature flag remains false; no UI routes, pilot grants or user tasks added.
- Release candidate commit: `806dedb`. Linked dry-run listed only the candidate;
  apply succeeded. Postflight ran commands + core schema + authenticated helper
  smokes inside one rollback transaction without reapplying the migration.
  Local/Cloud ledgers match 12/12; post-apply security advisor at error level
  reported no issues. Task 3 is complete; Task 4 follows from the approved spec.

### Task 4A — business calendar/SLA engine candidate (2026-09-07)

- Candidate: `20260907024703_work_r1a_sla_engine.sql`.
- Adds ordered non-overlapping workday intervals (including lunch breaks), date
  exception intervals, priority-specific policy overrides and optional execution
  minutes. Policy resolution: matching scope before global; matching priority
  before scope default; only active/effective policies and active calendars.
- Assignments snapshot acknowledgement/execution configuration and relevant
  exception dates. Execution starts at acknowledgement; no configured duration
  means no execution due timestamp. Task deadline is never rewritten by SLA.
- Engine rollback smoke passed split day, break start, weekend, holiday, working
  exception, three priority defaults, policy/scope precedence and expiry,
  overlapping-interval rejection, missing calendar and authenticated self-create.
- Task 3 regression rollback smoke also passed with the forward create command.
- No real company calendar/policy was seeded. Lifecycle commands are Task 4B.
- Release candidate `92bea7b`: dry-run listed only the SLA migration; apply and
  engine postflight passed. Cloud ledger contains all 13 intended migrations;
  the next lifecycle candidate is pending locally. Post-apply security advisor
  at error level reported no issues. Lint and migration baseline check passed.

### Task 4B — lifecycle and responsibility commands candidate (2026-09-07)

- Candidate: `20260907025138_work_r1a_lifecycle_commands.sql`.
- Public `command_work_task` accepts the fixed command allowlist, expected task
  version and actor-scoped idempotency key. Task lock, assignments/submission,
  version/event/outbox and response are one atomic operation.
- Authenticated smoke passed acknowledgement/self retry, stale version/key
  conflict, clarification during collaborative work, start/block/unblock,
  submission/rejection/resubmission/approval, creator-only auto-complete, cancel,
  scoped manager permission/isolation, transfer/new-assignee SLA, duplicate
  rejection, reviewer checks, inactive/unrelated denial and restricted recipient
  pre-access checks. Eight synthetic accounts are used; no account is persisted.
- Completed/cancelled assignments close without deleting their acknowledgement
  history. Historical assignees retain canonical-related read access; mutation
  capabilities require a live assignment and valid task state.
- Regression caught and fixed transfer incorrectly clearing a shared blocker.
  Clone now prefills current responsibility after transfer/co-assignee changes,
  clears stale checklist assignees, and preserves stored original provenance.
- Terminal mutations are denied; retries return their original stored response
  even after later transitions. Self-only auto-complete becomes creator-review
  when responsibility changes and the creator must be an eligible reviewer.
- Lifecycle and SLA engine Cloud rollback smokes passed. Task 3/core/helper
  regressions passed; full frontend regression: 349 files / 1,654 tests; lint
  passed; query audit 0 findings/errors; pre-apply security advisor error level
  no issues. No UI/pilot/notification delivery activation is included here.
- Release candidate `d745072`: dry-run listed only the lifecycle migration;
  apply succeeded. Postflight lifecycle, SLA engine, Task 3 commands, core RLS
  and authenticated helper regression smokes all passed against the applied
  schema. Local/Cloud ledgers match 14/14. Post-apply security advisor at error
  level: no issues. Lower severities were not claimed clean.
- Postflight persisted Work counts: tasks 0, calendars 0, policies 0, direct Work
  grants 0, outbox 0. Only the 16 unused concurrency-test code allocations remain.
  Task 0–4 checkpoints are complete; Task 5 is the next implementation checkpoint.

### Task 5 — checklist, discussion and personal preferences (2026-09-07)

- Candidate: `20260907032728_work_r1a_collaboration_commands.sql`.
- `command_work_task_collaboration` provides eight fixed commands: checklist
  create/update/complete-or-reopen/soft-delete, comment create/edit, pin and
  notification preference. Actor-scoped idempotency and a task row lock cover
  the complete mutation, immutable event/outbox and original response.
- Checklist requires creator, accepted live assignee or scoped manager and is
  frozen during review/closure. Item versions detect conflicting edits; task
  versions also advance. Deleted items remain stored with completion evidence
  but disappear from detail, direct RLS reads and clone drafts.
- Discussion uses independent comment versions. Current participants can comment
  on open tasks; only the author can edit. Edits replace the content/full mention
  list (an omitted list means empty), retaining before/after evidence in events.
  Replies cannot cross tasks. Attachment support follows in Task 7.
- Mention picker and writes use the same target visibility predicate as task
  reads. No relationship or permission is created. Newly introduced mention IDs
  produce separate `comment.mentioned` outbox events with mandatory recipients
  and comment deep-link IDs. Actual delivery/mute enforcement follows in Task 6.
- Fixed the demonstrated event RLS leak for viewers without `audit_view`.
  Events, task versions, history RPC and capabilities now use one audit predicate,
  including canonical access for historical assignees. Watcher/scoped-view access
  alone does not grant history access or restricted task access.
- Comment/history readers use descending `(created_at,id)` cursors, max 100;
  history supports category/actor filters. Mention picker returns ID/name only,
  UUID cursor, max 50. Detail adds personal preferences and capabilities only.
  Pin/mute changes are private and do not change shared task versions/events.
- Cloud rollback smoke passed eight authenticated personas, cross-task rejection,
  stale versions/retries, immutable edit/completion evidence, permission revocation,
  restricted manager/mention boundaries, review freeze, personal isolation,
  cursor ties/picker pagination, hard limits and function ACLs. The initial red
  smoke reproduced `TEST_HISTORY_LEAK_WITHOUT_AUDIT_PERMISSION` before the fix.
- Task 3/core/authenticated helper and Task 4 lifecycle/SLA rollback regressions
  passed. Full frontend regression: 349 files / 1,654 tests, no failures. TypeScript
  passed; query audit: 0 findings/errors; migration checker: 15 active/402 archived.
  The feature flag remains false; no real calendar, pilot grants or UI activation.
- Pre-apply Cloud security advisor at error level reported no issues. Inline review
  checked command allowlists, per-actor private preferences, authenticated wrapper
  ACLs, immutable audit and the shared visibility predicate. No applied migration
  file was edited; only the new forward migration is a rollout candidate.
- Release candidate `8926cd0`: linked dry-run listed only the Task 5 migration;
  apply succeeded. Collaboration, lifecycle, SLA engine, Task 3 commands, core RLS
  and authenticated helper postflight smokes all passed against the applied
  schema (`--migration /dev/null`). Local/Cloud ledgers match 15/15. Post-apply
  Cloud security advisor at error level: no issues; lower severities were not
  claimed clean.
- Persisted Work counts after postflight: tasks 0, comments 0, calendars 0,
  policies 0, direct Work grants 0, outbox 0, collaboration fixture users 0.
  Task 5 is complete at the backend/RPC checkpoint. Task 6 is notification
  delivery, retry/deduplication, mandatory-event mute rules and invalidation;
  UI and Storage remain at their later roadmap checkpoints.

### Task 6 — notification delivery and invalidation (2026-09-07)

- Candidate: `20260907034255_work_r1a_notification_delivery.sql`; Edge worker
  `process-work-notifications`. The minute Cron calls the worker through the
  existing Vault/Edge `send_web_push_secret` / `SEND_WEB_PUSH_SECRET` pair.
  `app_private.work_notification_settings.enabled` defaults to false. Task 10
  enables delivery with the named pilot; the frontend feature flag also remains off.
- In-app delivery resolves actual creator, current assignments/participants and
  explicit mention targets, with task visibility rechecked. Completed/cancelled
  assignments remain recipients of closure updates; transferred historical rows
  do not become recipients of subsequent activity. Technical admin/scope permission
  holders are not broadcast recipients. Strict current-manager resolution is used
  only for acknowledgement escalation, and the manager must already see the task.
- Actor-generated routine self-notifications, muted activity and routine bursts
  are suppressed. Direct assignment/transfer, mentions, pending review, requested
  changes, own/creator deadline reminders, acknowledgement escalation and security
  events retain mandatory behavior. Routine comment/checklist/file cooldown is
  five minutes. Mentions have one dedicated event, avoiding a second comment alert.
- In-app notification, delivery marker and device queue are atomic. Work rows in
  the shared notification table have an additional restrictive RLS boundary and
  immutable routing/recipient fields; authenticated users can mark them read or
  dismiss them, but cannot fabricate/retarget official Work notifications.
- Push uses separate device jobs with stable notification tags and `renotify=false`.
  A successful device is not intentionally retried; gone endpoints are deactivated.
  Claims recheck access, relationship, preference and subscription. Two-minute
  leases use fresh UUID fencing tokens. Failures back off and stop after eight
  attempts. In-app processing skips busy task rows; short push claims are serialized,
  while network sends run four at a time with a five-second transport timeout.
  Worker batches max at 20; more than 1,000 active devices for one user records a
  push failure instead of silently truncating delivery or blocking their in-app alert.
- Browser push remains at-least-once across an ambiguous provider timeout/crash;
  there is no claim of exactly-once external delivery. Payloads use generic text,
  canonical `/#/work/tasks/<code>?comment=<id>` links and no task/comment content.
  Supported transport hosts cover FCM, Mozilla, Apple and Windows push services.
- Due-soon (default 60 elapsed minutes), overdue and acknowledgement-overdue events
  use daily UTC dedupe keys tied to the actual due timestamp and assignment. This
  does not change the business calendar, SLA snapshot or task deadline.
- `work_task_revisions` publishes task ID/revision/time only under task RLS. The
  feature-local subscription coalesces changes and refetches on reconnect, focus
  and every 30 seconds, including when permission revocation hides later signals.
  Actual Work screen mounting and denied-link presentation follow in Tasks 8–9.
- Cloud rollback worker smoke passed mandatory/mute decisions, delivery dedupe,
  per-device retry/gone outcomes, stale lease recovery/fencing, permission revocation,
  private notification/Realtime visibility, technical-admin denial, deadline and
  acknowledgement reminders, manager recipient boundary, routine cooldown,
  review-required mute bypass and completed-assignment notifications. The manager
  resolver is adapted inside the rollback fixture to test the Work boundary;
  actual HRM manager readiness remains the existing strict resolver's responsibility.
- Injected notification insert failures verified transaction rollback, bounded
  retry and quarantine. Full Task 3/core/helper and Task 4–5 Cloud regressions passed.
  Frontend: 351 test files / 1,661 tests; lint and build passed (existing chunk-size
  warning only). Deno check passed with a dependency lock. Migration checker:
  16 active / 402 archived; query audit: 0 findings/errors. Pre-apply security
  advisor at error level: no issues. Transport tests use mocks; no real device/user
  receives a test push in this checkpoint.

Task 6 operations: inspect `work_notification_outbox.dead_at/last_error`,
`work_notification_deliveries.status/last_error` and `work_push_jobs` lease/retry
state through an authorized server/SQL session. Correct the root cause before
requeuing a specific failed ID; never reset all delivery markers or replay successful
jobs. An outbox quarantine can be retried by clearing that row's `dead_at`, resetting
its attempt count and setting `available_at=now()`. A failed device job can be retried
by clearing its finish/lease timestamps, setting status to pending and resetting its
attempt count. Existing event/user/channel markers continue to prevent in-app duplicates.

Task 6 postflight: release candidate `b28f26d` had only the notification delivery
migration in its linked dry-run; apply succeeded. `process-work-notifications`
was deployed through the API without Docker. Worker, collaboration, lifecycle,
SLA, Task 3 commands, core RLS and authenticated helper postflight smokes passed
against the applied schema (`--migration /dev/null`). Local/Cloud ledgers match
16/16. Post-apply Cloud security advisor at error level found no issues; lower
severities were not claimed clean.

Deployed HTTP probes: missing secret 401, invalid secret 401, existing Vault-held
secret 200 with `{"enabled":false}` and no timeout. The minute Cron is active,
but its delivery gate remains false. Persisted counts after rollback smokes:
tasks 0, Work notifications 0, outbox 0, deliveries 0, push jobs 0, calendars 0,
policies 0, direct Work grants 0, fixture users 0. No test push was sent to a real
recipient. Task 6 is complete at the delivery/invalidation infrastructure checkpoint;
real device delivery and screen integration remain in the named pilot/UI/observation
checkpoints. Task 7 adds private Storage and attachment processing.

### Task 7 — private Storage and attachments (2026-09-07)

Candidate `20260907041036_work_r1a_private_attachments.sql` creates private bucket
`work-attachments`. `command_work_attachment` reserves an immutable path for 15
minutes, with 20 live reservations per uploader. Authenticated INSERT requires
that exact pending reservation, current uploader and current task authority.
Restrictive bucket boundaries deny client read/list/sign/overwrite/delete even if
an unrelated permissive policy would otherwise match. No Storage SQL deletion is
used by the application or cleanup worker.

`work-attachments` Edge validates the user JWT through Auth.getUser before using
user-scoped claim/read RPCs. Finalize, expiry and cleanup worker RPCs are service-only.
Finalization rechecks uploader authority after transformation. Input/result follow
checklist editing authority; discussion/evidence follow current discussion authority.
Creator/scope managers may delete others' files only while that kind remains mutable;
uploaders may delete their own under the same current authority. Terminal tasks are
read-only. Detail returns per-kind upload and per-file delete capabilities.

Initial supported formats are JPEG, PNG, static WebP, PDF and UTF-8 text. Image input
is bounded to 5 MiB / 4 megapixels / 4096 per dimension; other input to 25 MiB. These
are conservative processor limits, not company policy. SVG, animation, HEIC, Office
files and archives currently fail explicitly. MIME/signature/size are checked on
actual bytes; image decoding is forced to the declared allowlisted format, with
resource limits and dimension checks. PDF validation checks header/EOF signature;
this is not a full PDF sanitizer. No malware scanning infrastructure is configured,
so this checkpoint makes no antivirus claim. Non-image files and originals are
served as downloads, not embedded documents.

WASM normalizes image orientation and strips profiles/properties from derivatives.
Default display edge is 1920, configurable with Edge `WORK_IMAGE_MAX_EDGE` from 320
through 1920; thumbnail edge is 320. WebP display/thumbnail and PNG fallback preserve
aspect ratio and do not upscale. Evidence images always retain the untouched source;
other images retain it only on `keepOriginal=true`. Non-image documents retain their
original bytes. An original retained by explicit choice can contain EXIF; derivatives
never inherit that metadata. No legal retention period is invented here.

Processing uses a three-minute UUID lease, at most three claims within the reservation.
Every possible attempt output path is registered for durable cleanup before a byte
is written. Attempts use different prefixes. An ambiguous finalization response never
causes eager deletion: the ready transaction may already have committed. Successful
finalization atomically removes retained output cleanup jobs and writes attachment
metadata, one audit event and one outbox row. Retried ready/delete operations do not
emit duplicate events. Attachment changes publish the existing Work revision signal.

Temp source cleanup starts one hour after upload expiry; abandoned output cleanup
starts one hour after its processing lease. This grace window covers in-flight writes.
Delete hides metadata immediately and queues retained objects after 60 seconds. A
five-minute Cron invokes the secret-authenticated cleanup action. Claims are bounded
at 30 paths with three-minute fences and retry backoff capped at one hour. There is
no retry exhaustion that silently abandons failed deletion. Monitor
`app_private.work_attachment_cleanup.available_at/attempts/last_error` and rejected
attachment metadata; resolve Storage errors before forcing a targeted retry. Physical
delete must always use Storage API. Pending/rejected records remain diagnostic metadata.

Read resolves only an existing ready variant after current subject authorization,
then signs for 60 seconds. Direct Storage reads/signing remain denied. Revocation
blocks new URLs immediately; an already issued bearer URL can remain valid until its
short expiry. The feature-local service requests a fresh URL each time and defaults
to thumbnails. It does not persist signed URLs. Responsive/lazy image rendering and
camera preprocessing belong to the upcoming UI tasks; preprocessing must honor the
original retention choice. Task 7 does not enable the Work UI or notification gate.

Verification commands include the rollback persona/Storage RLS/lease smoke, actual
WASM image fixtures (`deno test --allow-read` with the function's locked config),
worker/service Vitest tests, and `scripts/verify-work-attachment-storage.mjs` for a
Cloud physical Storage probe. The probe uses a random synthetic `_probe` path,
verifies upload/anonymous/public deny/signed download, and removes/verifies the object
in `finally`; credentials and signed URLs stay in process memory. It creates no task,
user or notification fixtures. The internal `health` action transforms only a fixed
synthetic image to check the deployed WASM; it accepts no user-provided test bytes.

Task 7 pre-apply verification: 353 Vitest files / 1,669 tests, five real WASM image
checks, TypeScript lint, locked Deno check and build passed (existing chunk warning
only). Task 7, notification, collaboration, lifecycle, SLA, Task 3, core RLS and
permission helper Cloud rollback smokes all passed with the candidate migration.
Migration audit: 17 active / 402 archived; query audit: zero findings/errors.
Pre-apply security advisor at error level found no issues. Rollout/postflight status
is recorded below after actual Cloud apply and Edge deployment.

The final policy review added forward migration
`20260907042716_work_r1a_upload_operation_guard.sql`: Storage INSERT also covers
signed-upload URL creation and other transports. Restrict Work inserts to the exact
server-set `storage.object.upload` operation so a client cannot mint a capability
that outlives the reservation/cleanup window. Signed upload, copy, S3, TUS and unset
operation contexts are denied. The regression first reproduced the signed-upload
policy gap, then passed with the guard; standard upload and the full Task 7 persona/
lease suite remained green. See Supabase's [operation helper documentation](https://supabase.com/docs/guides/storage/schema/helper-functions)
and [operation names](https://github.com/supabase/storage/blob/master/src/http/routes/operations.ts).
The original applied migration remains immutable.

Task 7 postflight: candidates `6034762` and `f9ab102` each had only their own new
migration in the linked dry-run and were applied successfully. Local/Cloud ledgers
now match 18/18 (402 archived). `work-attachments` deployed through `--use-api`,
without Docker. All Task 3–7/core/helper postflight smokes passed after the main
migration; the expanded Task 7 operation/role/cleanup suite passed again after the
forward guard. Post-apply security advisor at error level found no issues; lower
severities are not claimed clean.

Cloud physical Storage probes passed before and after the operation guard: upload,
anonymous/public deny, 60-second signed download with byte comparison, actual API
delete and empty-prefix verification. Edge HTTP rejected missing/invalid internal
secrets with 401. Vault-authenticated health request 61491 returned 200 with
`{"ok":true,"processor":"magick-wasm","formats":["webp","png"]}`; cleanup request
61492 returned 200 with `{"claimed":0,"removed":0}`. Neither timed out. The health
fixture verifies deployed execution/bundling, not a worst-case image performance SLA.

Final persisted counts: Work tasks 0, attachments 0, bucket objects 0, cleanup jobs 0,
outbox 0; calendar/direct Work grants/fixture users remain 0. Bucket public=false;
cleanup Cron active every five minutes; notification enabled=false. No real user
message was sent. Main feature flag remains disabled. End-user JWT HTTP flows and
named-device/browser performance are still the pilot/UI/observation checkpoints;
SQL personas, physical service-authorized Storage, and fixed deployed image health
are recorded separately rather than described as a complete user journey.

Task 7 is complete at the Storage/processing/service checkpoint. Task 8 can use the
feature-local attachment service and authoritative capabilities when building the
Work shell/list/create UI. No handoff was created or updated.

### Task 8 — module shell, lists and creation UI (2026-09-07)

Lazy routes `/work/my` and `/work/tasks/:taskCode`, Home entry and Sidebar navigation
use the existing feature flag and canonical module permission. Four personal lists
support search, status/priority/scope/deadline filters, 30-row cursor pagination and
confirmation counts. Feature-local requests discard stale results after query/task
changes; account changes remount the workspace. Realtime revision, focus and polling
invalidation use Task 6's subscription. No global directory warmup was added.

Desktop creation uses a modal drawer; phones use a full-screen sheet. Scope and
recipient options come from guarded RPCs, with a maximum of 50 minimal ID/name/kind
records per page (client requests 30). Scope filters expose department/project names
only through visible tasks. Creation context resolves the selected priority's SLA
calendar and canonical action permissions. Missing calendars block creation.
Clone labels are limited to references in the authorized clone draft.

The form supports user/work-group recipients, authoritative recipient preview,
scope/bucket, deadline shortcuts, priority, plain-text description, labels, watchers,
review policy and an expanded checklist editor. Unknown create failures retain the
same immutable payload, preview fingerprint and idempotency key; the form stays
locked until the result is known. A reload warning protects an uncertain in-memory
attempt; this is not persistent draft recovery. File failures retry upload/finalize
against the already created task. Expired/invalid reservations can be restarted or
removed. Clone is read-only until Create, and expired deadlines require confirmation.

Basic authorized detail and copy-link support list navigation and cloning. The rich
detail layout, lifecycle actions, thread/history, attachment viewing and complete
device acceptance remain Task 9/11. No department/company distribution (R1B), pilot
calendar/grants (Task 10), production frontend activation or handoff is included.

Verification: full Vitest suite passed 354 files / 1,674 tests. The isolated Chrome
fixture in `tests/work/task8-fixture.html`, driven by
`scripts/verify-work-task8-browser.mjs`, covers pagination, tab changes, stale search,
preview/calendar gates, ambiguous creation with identical retry arguments, attachment
retry without another task/reservation, clone/deadline gating, denied detail and
desktop/mobile overflow. Screenshots are written to `/tmp/vioo-work-task8-qa`.
The fixture uses synthetic services and blocks Cloud traffic; it does not claim a
real authenticated pilot journey. Cloud persona tests are recorded separately.

Pre-apply: TypeScript lint, production build (existing chunk-size warning), migration
baseline (19 active / 402 archived) and query audit (zero findings/errors) passed.
Final service tests and Chrome checks passed after the last UI fixes. Candidate
`20260907043333_work_r1a_creation_options.sql` passed creation-options, Task 3–7,
core RLS and authenticated permission-helper Cloud rollback smokes, each in its own
transaction. Security advisor at error level reported no issues.

Postflight: candidate `9892ea0` had only
`20260907043333_work_r1a_creation_options.sql` in the linked dry-run, and apply
succeeded. Local/Cloud ledgers match 19/19. Creation-options, Task 3/4/5, core RLS
and permission-helper smokes passed again against the deployed schema. All three
new public read RPCs are present. Post-apply security advisor at error level found
no issues; lower severities are not claimed clean.

Persisted Work tasks, attachments, Storage objects, cleanup jobs, outbox, calendars,
policies, direct Work grants and fixture users are all zero. Storage remains private;
notification enabled=false and the environment Work feature flag is false. No real
user notification was sent. Task 8 is complete at the shell/list/create checkpoint.
Next is Task 9: rich task detail and lifecycle/collaboration UI.

### Task 9 — responsive detail and capability actions (2026-09-07)

The detail route now retains a contextual task rail on desktop, with task content,
result/checklist/files/discussion in the center and responsibility/SLA on the right.
Tablet/phone metadata opens a modal sheet; the phone action bar stays above the
application's bottom navigation. Work uses Layout's scroll container directly.
Returning to the list preserves its filter query and scroll position. Account changes
remount the workspace and clear feature-local data.

Action availability comes from the existing server capabilities. Acknowledge,
clarification, start/block/unblock, submit, approve/request changes, cancel, transfer
and add co-assignees call the existing lifecycle RPC with the captured task version.
Transfer/cancel/request changes require a reason and explicit confirmation. A
workspace-owned in-memory mutation session preserves the exact task, payload,
version and key across ambiguous retries and detail navigation. It prevents another
command until resolved. Version conflicts require inspecting the latest task/item/
comment before submitting anew. Reload warnings cover uncertain commands and pending
uploads; no persistent/offline draft recovery is claimed.

Checklist create/update/order/assignee/complete/delete, author-only comment editing,
replies, authorized mention selection, personal pin/mute and filtered activity history
use Task 5 commands/readers. Comments and history load only when expanded, in 30-row
cursor pages. A notification `?comment=<uuid>` fetches the exact authorized comment
and its immediate parent, highlights and scrolls to it without crawling every page.
History displays actor/source/time and expandable recorded payload/correlation data.
Mention selection does not add assignments, watchers or grants.

Migration `20260907052234_work_r1a_detail_ui_reads.sql` adds three guarded public read
entry points backed by private definers: minimal context names (at most 100 requested
IDs, each tied to the subject), eligible transfer/co-assignee choices (30 client /
50 server maximum, UUID cursor), and a two-record comment anchor. Candidate eligibility
reuses the exact lifecycle helper, including restricted-task rules. An assignee can
transfer without a task-create grant; a watcher cannot use assignment selection.
No existing mutation contract or applied migration was changed. RPC calls follow the
[Supabase JavaScript RPC contract](https://supabase.com/docs/reference/javascript/rpc).

Files support input/discussion/result/evidence categories, authorized delete, lazy
thumbnail reads and fresh signed display/fallback/download requests. Signed image
state is cleared before expiry and on unmount. Upload retry reuses reservations and
never resubmits a task command; submission is blocked while selected files remain
unfinished. Camera JPEGs without original retention are oriented and reduced to a
1920-pixel maximum edge before upload (32 MiB client source ceiling). PNG/WebP pass
through so animated containers remain detectable by the server. Retained originals
and all evidence bypass client rewriting and retain Task 7's input limits. Real
4032x3024 synthetic JPEG browser QA produced 1920x1440 WebP; retention returned the
same original File. The server still validates and processes uploaded bytes.

Verification: 356 Vitest files / 1,681 tests passed. Isolated Chrome QA at 1440x900,
768x1024 and 360x800 exercised capability personas, lazy feeds, checklist/mentions,
version conflict, lost-response retry (including leave/return), transfer reason,
review, exact comment navigation, private image requests, upload retry/submission
blocking and actual Layout-style scroll/bottom navigation. Task 8 browser regression
also passed. Scripts: `scripts/verify-work-task9-browser.mjs` and
`scripts/verify-work-task8-browser.mjs`; screenshots are under
`/tmp/vioo-work-task9-qa`. These use synthetic services and block Cloud traffic;
real JWT/device/pilot observation remains Task 10/11.

Pre-apply Cloud rollback suites passed: new detail reads, lifecycle, collaboration,
Storage/processing permissions, Task 8 options, core RLS and authenticated helper
execution, each in its own transaction. Security advisor at error level reported no
issues. Migration baseline is 20 active / 402 archived; query audit has zero findings
or errors. TypeScript and production build passed with the existing chunk warning.

Postflight: candidate `ab78c4b` listed only its Task 9 migration in the linked
dry-run; apply succeeded and local/Cloud ledgers match 20/20. New detail readers,
lifecycle, collaboration and core RLS smokes passed against the deployed schema.
All three new public readers are present. Post-apply security advisor at error
level found no issues; lower severities are not claimed clean. Work tasks,
attachments, Storage objects, cleanup jobs, outbox, calendars, policies, direct
Work grants and fixture users all remain zero. Storage is private; notification
enabled=false and the environment feature flag is false.

Final browser regression reproduced an edit conflict on an older comment page:
refreshing the thread evicted the edited comment from the first page. Recovery now
fetches that exact comment through the authorized anchor reader, allowing explicit
reload and a new-version submission. The regression failed before the fix and
passed afterward, together with the full Task 9 browser script, TypeScript and build.
This was a frontend correction; the applied migration was not changed.

Task 9 is complete at the responsive detail/actions checkpoint. No handoff was
created or updated. Next: Task 10 scoped bucket/calendar/SLA settings and the named
pilot checkpoint; production UI and notification activation remain gated.

## Task 10 — scoped configuration and named pilot preparation

Settings at `/work/settings` require the feature gate, canonical module access and
an active `work.task.configure` source. The server lists only authorized scopes;
technical ADMIN status adds no Work permission. Groups stay department/project
scoped. Calendar ownership is explicit; only global configurators edit shared
calendars, while department/project policies can select an active shared calendar.
Calendar exceptions can override hours, mark a holiday, or restore the weekly day.
Policies specify priority, effective interval and working-minute ACK/execution SLA.
A server preview shows the resolved calendar and both due dates for a supplied
start time. It does not change a task deadline.

Migration `20260907062813_work_r1a_configuration.sql` adds guarded, bounded reads and
versioned/idempotent writes. A short configuration-only advisory lock serializes
policy overlap checks and calendar dependencies. Every mutation records actor,
reason, before/after values and command key in private audit storage; scoped audit
reads are bounded too. Writes cannot change ownership, bypass the scope grant,
remove an in-use calendar or silently recalculate existing task/assignment data.
The UI freezes unresolved saves and preserves their exact request in per-actor
session storage for retry after navigation; no credentials are stored there.

Named pilot preflight verified active accounts `admin@khoviet.vn` (Admin Hoàng,
`928d3473-49a2-4427-a319-19729689a084`) and `sonpn@tienthinhjsc.vn` (Phạm Ngọc Sơn,
`d0a300a0-1586-4748-b6e7-71773addc004`), and department `Phòng Quản lý dự án`
(`6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9`). No Work grants existed for either account.
The reviewable manifest is `docs/runbooks/vioo-work-r1a-pilot.json`: module access
for both, business permissions confined to this department, configure/manage only
for the named admin, and 14-day temporary grants. No restricted-view, global
business, work-group distribution, or other-user grants are proposed.

The user supplied Monday–Saturday, 08:00–17:00. Lunch exclusion and the deployment
target are still being clarified. The manifest contains that supplied span as a
draft and must not be applied until those fields are resolved. After confirmation,
create one department-owned calendar and three department priority policies:
normal = one confirmed working day, important = 240 minutes, urgent = 60 minutes;
execution SLA stays unset. This follows design §9.1 and avoids a global fallback
calendar changing other scopes. Resolve accounts/scope again before grants, set
explicit expiries, verify recipient preview and task lifecycle in a rollback
transaction, then activate only the selected frontend target and agreed delivery.
Record the actual activation time before Task 11's 48-hour observation begins.

Task 10's named pilot is not yet active. Gates remain off while the two outstanding
configuration choices are pending. No handoff was created or updated.

Pre-apply verification: 357 Vitest files / 1,686 tests passed, TypeScript and
production build passed (existing bundle-size warning). Query audit: zero findings
and errors; migration baseline: 21 active / 402 archived. Task 10 isolated Chrome
QA passed at 1440x900, 768x1024 and 360x800, including same-key recovery after a full
page reload, version conflict with exact-record reload, holiday creation, policy
selection and SLA preview. Screenshots: `/tmp/vioo-work-task10-qa`. Task 8 and Task 9
browser regressions passed. Task 9's test now waits for the initial animation-frame
scroll restoration before setting a simulated user scroll, avoiding a detected
race in the test; production detail behavior was not changed.

Cloud candidate rollback suites passed for configuration (scoped/global/outsider,
shared calendars, audit, overlap, invalid intervals, same-key retry, unchanged
assignment rows), SLA engine, task commands, core RLS and authenticated permission
helper execution. The final configuration smoke passed after scope-before-version
checks and the scoped history index were added. Linked security advisor at error
level reported no issues on the pre-apply schema; post-apply evidence follows.

Postflight: candidate `2242648` dry-run listed only
`20260907062813_work_r1a_configuration.sql`; apply succeeded. Local and Cloud
migration ledgers match 21/21. Configuration, SLA, task-command and core RLS smokes
passed against the deployed schema, each rolled back. All five new public RPC
entry points are present. Post-apply security advisor at error level found no
issues; lower severities are not claimed clean. Persisted Work tasks, calendars,
policies, configuration events, direct Work grants, fixture users and outbox rows
all remain zero. Notification delivery is disabled; the frontend flag remains off
by its default (no enable override was introduced). The two named accounts and
department are verified; pilot activation awaits the pending calendar/deployment
choices in the manifest, then real authenticated/device acceptance and observation.

### Named dev review activated — 2026-09-07

The user confirmed lunch 12:00–13:00 and requested the actual application from
this worktree via `npm run dev`. Dev runs at `http://127.0.0.1:5187/#/work/my`
with `VITE_ENABLE_VIOO_WORK=true` for that process and the existing root `.env`
Cloud configuration. Headless Chrome verified HTTP 200, the login screen, enabled
Work flag, configured Supabase client and no page errors. No production frontend
flag was changed, and notification delivery remains disabled for this UI review.

Applied the named manifest after a successful rollback rehearsal using
`supabase/operations/work_r1a_named_pilot.sql` (the tracked script defaults to
ROLLBACK). Existing accounts use their mapped `auth_id` during SQL role simulation;
this tests the canonical backend identity/grants, not a real browser login.
Postflight confirms 15 temporary grants for exactly the two named users, expiring
2026-09-21 14:02:36 Asia/Ho_Chi_Minh; one department calendar
`3f1e7dc6-9bd5-47ed-b057-6de1abcb04ee`; Monday–Saturday shifts 08:00–12:00 and
13:00–17:00; three department policies with ACK 480/240/60 working minutes for
normal/important/urgent, and no execution SLA override. Admin can configure only
this department; Sơn has no configure grant. No global business grants were added.

SLA checks passed for Monday 11:30 + 60 minutes = 13:30 and Saturday 16:00 + 480
minutes = Monday 16:00. No sample tasks were persisted (task count was zero at
postflight). Users can log in, select Phòng Quản lý dự án and create their first
work item. Admin settings are at `/#/work/settings`. Real user UI review is now
available; notification/device acceptance and the 48-hour observation remain
separate pending checkpoints. No handoff was created.

### Workspace implementation started — WS1

Executing the approved WS1–WS8 plan from this worktree. The user explicitly
selected GPT 5.6 Luna / xhigh for sub-agents; the main agent owns integration,
Cloud tests/applies and review. No handoff. WS1 is additive foundation only;
existing task access, pilot membership/grants, deadlines and SLA stay unchanged.
Foundation smoke was run before the new schema and failed as expected with
`WORK_WORKSPACE_FOUNDATION_MISSING`. Contracts and schema are assigned to separate
files; the main agent owns the Cloud smoke and baseline verification.

WS1 candidate verification: Cloud rollback smoke passed source uniqueness including
archived sources, immutable linkage, forbidden hard delete, append-only private
audit, finite membership dates, RLS and denied browser membership writes. The
legacy business snapshots inside the transaction are unchanged. Contracts: 6/6
Vitest tests passed; TypeScript passed; baseline checker 22 active / 402 archived.
Linked security advisor has zero ERROR findings (225 lower-severity findings;
not claimed globally clean). Cloud application/postflight follows this candidate.

WS1 applied from candidate `9de0b10`; dry-run listed only
`20260907090453_work_workspace_foundation.sql`. Post-apply rollback smoke passed
and local/Cloud ledgers match 22/22. Pre/post hashes for the one existing task,
assignments, calendar and policies are identical. Work grants remain 15 and
notification delivery remains disabled. No Workspace or fixture data persisted.
Continuing WS2 membership commands and canonical sources.

WS1 post-apply linked security advisor at ERROR level reports no issues. WS2
Cloud smoke first failed with `WORK_WORKSPACE_MEMBERSHIP_MISSING`, as expected.
Canonical-source candidate rollback passes member/admin scope, snapshot parity,
archived read-only access and disabled-account checks. Synthetic account-state
changes in the rollback fixture use the existing trusted lifecycle context; no
account guard was changed. Frontend contracts, Workspace services/permissions,
Work route boundary and authorization evaluator: 5 files / 26 tests passed.
Command integration and expanded membership smoke are still in progress.

### Workspace membership — WS2 candidate

The final candidate adds canonical `WORKSPACE_MEMBER` sources and guarded
Workspace/source/member/audit readers, create/profile/archive/restore/recovery,
membership preview/apply and user preferences. Non-Work resolver branches are
preserved exactly; rollback comparison of the two pilot accounts' non-Work
sources was unchanged. Source visibility follows the existing source SELECT
policies: active actors can read the organization catalog; project visibility
uses the existing project predicate. Workspace creation still requires its own
canonical capability. No membership automatically grants restricted/group-task
capabilities; those remain available only as separately authorized grants.

Final Cloud rollback passed creation and replay/key conflicts, canonical snapshot
parity, outsider/self-promotion/expired/disabled denials, last-admin batch guard,
open assignment/review removal blockers, source uniqueness and legacy-calendar
migration guard, Workspace/member/source keyset pagination, pin/open persistence,
archive/restore/read-only behavior, version and stale-preview conflicts, expiry
escalation (including explicit null), UUID alias deduplication, removed-actor
replay denial and explicit recovery without task-read access for the recovery
actor. R1A task-command regression passed on the candidate. These checks exercise
serialized mutations and version conflicts; separate simultaneous-client race
testing is not claimed. Task/resource membership enforcement is WS4.

Frontend verification: 6 files / 44 tests passed; TypeScript passed. Query audit
reports zero findings/errors; migration baseline 23 active / 402 archived. Review
fixes included source authorization before status probing, indexed calendar
checks, effective last-admin calculation, nullable expiry semantics, cursor
queries and invoker-to-private RPC execution grants. Pilot data/activation is
unchanged; Cloud apply/postflight follows this candidate.

WS2 applied from `4396c7a`; dry-run listed only
`20260907090818_work_workspace_membership.sql`. Postflight membership smoke passes,
local and Cloud ledgers match 23/23, and security advisor at ERROR level reports
no issues. Existing task/assignment/calendar/policy hashes are unchanged from the
pre-WS baseline; Work grants remain 15 and notifications remain disabled. No
Workspace fixture data persisted. Continuing WS3 authoritative people projections.

### Workspace people and source diff — WS3

WS3 applied from `a828564` as
`20260907093106_work_workspace_people.sql`. Cloud rollback and postflight smokes
cover organization/project/directory projections, secondary assignments, accountless
employees, source-bound removals, manual-member preservation, pagination, bounded
selection and stale fingerprints. Local and Cloud ledgers matched 24/24; the ERROR
security advisor had no issue. No fixture Workspace persisted and notifications
remained disabled.

### Workspace task boundary — WS4

WS4 is recorded as `20260907100124_work_workspace_task_access.sql`. It makes current
Workspace membership mandatory across task list/detail/search/counts, lifecycle and
collaboration commands, recipients/reviewers/watchers, legacy mapped department/project
tasks, task subresources, private attachments and notification delivery. Membership
revision invalidation fences in-flight client reads. Attachment signing performs a
second path/revision check after Storage signs and before the URL is returned.

Independent review found and the final candidate fixed concurrent revoke/write
serialization, legacy-task membership blockers and archive checks, archived task
preferences, clone compatibility with legacy task groups, and Workspace calendar/SLA
RLS. The expanded rollback smoke proves those cases, including private calendar and
policy negatives for a non-member with a broad legacy Work grant.

A Management API timeout completed the DDL but lost the response before the migration
ledger write. Postflight verified the migration tail, task list RPC, attachment fence,
notification guard and SLA policy; all synthetic fixture counts were zero. The ledger
was repaired for the exact version with `supabase migration repair --status applied`.
Local and Cloud now match 25/25 and `db push --dry-run` reports the remote database is
up to date. All Task3–9, membership, people and WS4 Cloud smokes pass. Full Vitest is
362 files / 1713 tests; TypeScript, production build, migration baseline (25 active /
402 archived), query audit (0 findings) and ERROR security advisor pass. The
`work-attachments` Edge Function is ACTIVE at version 2. Notifications remain disabled,
Work grants remain 15, no fixture Workspace persisted, and the existing task count is 1.

### Workspace configuration bridge — WS5

WS5 is deployed as `20260908013042_work_workspace_configuration.sql`. Configuration
keys now accept `workspace:<uuid>` and legacy department/project input normalizes to
the mapped Workspace. Workspace admin role is mandatory for list, save, history and
SLA preview even if a member receives a direct configure grant. New groups, calendars
and policies are owned by Workspace; active global calendars remain selectable but
cannot be edited through Workspace settings. Group selection is capped at 50 and
excludes inactive or foreign Workspace groups. Policy overlap is serialized and
checked within the same Workspace and priority.

The Workspace smoke failed red before migration, then passed candidate and postflight.
It covers canonical scope discovery, CRUD, exceptions, lunch-break SLA calculation,
same-priority isolation, global-calendar read-only behavior, member overgrant denial,
outsider denial and raw-table RLS. The original R1A configuration smoke also passes.
Independent SQL review found three P1 cases; the final implementation requires admin
role for readers, refuses to reactivate an existing membership whose manifest state
differs, rejects non-null bridges to another Workspace and only fills null bridges.

`work_workspace_pilot_backfill.sql` rehearsed twice in one transaction and rolled
back. Current inventory is 1 task, 1 full assignment row, 0 groups, 1 calendar and
3 policies for Phòng Quản lý dự án; no other department/project task scope exists.
The rehearsal preserves task business fields, full assignment and SLA snapshots,
outbox/deliveries, attachments, events, versions and direct-task null bridges. Exact
pilot members and expiry `2026-09-21T07:02:36.939209Z` are validated. Commit mode was
not run: Cloud still has 0 Workspaces and 0 mapped task/config rows; notifications
remain disabled. Local and Cloud migration ledgers match 26/26. Full Vitest is 363
files / 1,717 tests; TypeScript, production build, migration baseline (26 active /
402 archived) and query audit (0 findings) pass.

### Workspace dashboard — WS6

The `/work` module landing page is now a visual directory of the signed-in user's
active Workspace memberships. It presents separate local covers for departments,
projects and collaboration groups, server-provided action/open counts, pin controls,
search, kind filters and keyset pagination. `/work/my` remains the existing personal
task list. The direct-task action appears only with the existing own-scope create
capability and opens the current creation drawer, whose server context still blocks
submission when the selected scope has no ready calendar.

The list hook fences stale actor/search/filter responses, merges later pages by ID
and restores optimistic pin state after a failed persistence call. Workspace routes
are registered under the Work module; opening a restricted or expired Workspace is
still decided by the member-only server endpoint. The sidebar now opens `/work` and
keeps explicit links to the personal list and configuration.

Isolated Chrome QA passed pin persistence, page deduplication, delayed-search fencing,
card navigation, error/retry, empty and expired-member fixtures. Responsive captures
at 1440×900, 768×1024 and 360×800 have no horizontal overflow and were inspected at
`/tmp/vioo-work-workspace-qa`. Focus states and reduced-motion behavior are included.
Focused route/service tests pass (2 files / 8 tests); the full suite passes (364 files /
1,720 tests), and TypeScript, lint and the production build pass. The
dev server remains process-only at `http://127.0.0.1:5187/#/work`; production flag
and notification delivery are unchanged. No handoff was created.

### Workspace operations UI — WS7

Workspace cards now open an operational page with Công việc, Thành viên and Cấu hình
tabs. The task tab uses the member-guarded WS4 endpoint and fixes the creation drawer
to the current Workspace; personal `/work/my` behavior remains intact. Task detail
keeps the established `/work/tasks/:taskCode` URL and carries a Workspace return
context for the breadcrumb, filters and rail. Task 8/9 browser regressions continue
to pass, including create retry, attachments, lifecycle, review and history.

The creation wizard supports department, project and independent collaboration
Workspaces. Source readers remain server-authoritative; a linked source with an
existing visible Workspace opens that record rather than creating a duplicate. The
creator is shown as the first admin, and unknown create responses freeze the exact
input/idempotency key for retry. Global and source-scoped canonical create grants can
open the wizard; the server still verifies the selected source.

Admins can search and page through source-prioritized people, select a page, review a
bounded batch and apply it once. Canonical department/project additions include the
server-projected source reference; cross-source additions remain manual. Network-lost
membership applies preserve the exact preview, expected version, reason and key, and
the review cannot be replaced until retry succeeds. Server rejections clear the
attempt and show a reload/review instruction. Removal, role changes and source diff
reconciliation all require preview; source diff never removes manual members silently.
Archived Workspaces expose readonly task/member state and hide mutating controls.

Workspace configuration reuses the Task 10 group/calendar/exception/SLA editor with
an actor-and-Workspace-scoped persisted attempt. Workspace access-revision realtime
events refresh both the current record and the signed-in permission snapshot. Chrome
QA passed the dashboard, linked create, old task URL, fixed-scope task drawer, member
retry with identical payload/key, scoped configuration, archived readonly mode,
restricted direct navigation and 1440×900/768×1024/360×800 screenshots. Task 8, Task 9
and Task 10 browser suites pass. The full suite/build evidence is recorded with the
WS7 commit: 365 Vitest files / 1,728 tests, TypeScript, lint and production build all
pass (the existing large-chunk warning remains). No Cloud schema or pilot data changed; notifications remain disabled and
no handoff was created.

### Workspace named pilot cutover — WS8

WS8 cut over **Phòng Quản lý dự án** to Workspace
`a4a5782f-4cd8-4f10-af22-ae2448bd1e45` at
`2026-09-08T03:10:11.667329Z`. The tracked operation remains rollback by
default. The applied candidate came from commit `2ebf3e4`, SHA-256
`bcfc81e4f51ca0dc10f0a8c498780e13af2f80be1eb72dca23e45c04c384450e`;
the reviewed apply copy differed only in its final `ROLLBACK`/ `COMMIT`
statement. It briefly blocked writes while leaving reads available, backfilled
the task/calendar/policies and switched `access_mode` in one transaction.

The Workspace has exactly two active source-bound members through
`2026-09-21T07:02:36.939209Z`: admin
`7fa2d219-fcb4-4ca7-9667-12d81c8f43bf` for `admin@khoviet.vn`, and member
`3ee9d305-d7d0-4dc0-86cc-292916c85db6` for
`sonpn@tienthinhjsc.vn`. Both membership rows use the canonical department UUID
as their organization source reference.

Membership parity was proven before retirement. The exact 15 named-pilot direct
grants, including both old module-access grants, were soft revoked and retained
with their original expiry. Permission audit events
`a7f0ef25-51b2-470e-853b-e6f234b35592`,
`d30d8c36-f367-4eb8-bb4d-edbf2c36490d` and
`c4be49d4-f4f7-4700-9ff6-213fc6482b42` record the two before/after retirements
and the admin bootstrap. Admin alone received global `work.workspace.create`
grant `680f7574-2e97-42e7-a038-658025b70fbc` with the same expiry. Sơn received
no Workspace-create/configure capability; neither account received recovery or
restricted-view bootstrap.

Before and after fingerprints are identical for task business fields
`d74eadfd341f2c01e515e1baa6a9c6f1`, assignment
`0e9e7ac5f5ddc8f56a77cd27cb73772a`, calendar
`ebf8adafa642c61eb5853271ca0e476d` and policies
`8ba38c1c49589bde2fb7099ae0447d48`. Task `VW-2026-000017` remains in progress,
the Monday–Saturday 08:00–12:00/13:00–17:00 calendar and normal/important/urgent
SLA values remain 480/240/60 minutes. Existing outbox count remains 2; deliveries
remain 0 and notification settings remain disabled.

Persistent-state acceptance passed with both real auth IDs through guarded RPCs
and an unknown-principal RLS denial. All five Workspace Cloud smokes pass after
rollback. The WS4 regression fixture was corrected to declare its synthetic
private calendar/policy as `scope_type='workspace'`, matching the deployed WS5
constraint and avoiding any dependency on an empty Cloud. Full Vitest passes
365 files / 1,728 tests; TypeScript/lint, production build, migration baseline
(26 active / 402 archived) and query audit (0 findings/errors) pass. Local and
Cloud migration ledgers match 26/26, linked dry-run is up to date, and the Cloud
ERROR security advisor reports no issues.

The isolated Workspace, Task 8, Task 9 and Task 10 browser suites pass. Dev at
`http://127.0.0.1:5187/#/work` returns HTTP 200 with the Workspace flag enabled
for that process only. Real browser login for the two named users and the UI
checklist in `vioo-work-workspace-acceptance.md` remain for user acceptance.
The 48-hour observation has not started and is not marked complete. Production
deployment is unchanged; no handoff was created.

### Pilot feedback data foundation — child tasks, planned dates and watchers

Migration `20260908052000_work_task_children_schedule_watchers.sql` was applied
from commit `78af195` on 2026-09-08. Its SHA-256 is
`0bb5a9c3299f47d3b4a5abdca691979669ff698d1a2b5529f60fb1233784d422`.
The linked dry-run listed this migration only; local and Cloud ledgers now match
27/27.

The data model supports one child level, a nullable planned start, and a guarded
same-Workspace/scope/privacy parent boundary. Parent completion does not update
open children. Child paging and its completion aggregate both filter by the
reader's own task visibility; cancelled children are counted separately and are
excluded from the completion denominator. Create, detail, clone, personal lists
and Workspace lists expose the new fields without changing actual `started_at`
or `completed_at` semantics.

Schedule and watcher updates use the existing collaboration command with task
version checks, actor-scoped idempotency, before/after audit, version snapshots
and outbox writes in one transaction. Watcher candidates must be active, have
Work access, satisfy Workspace membership where applicable and pass the task's
privacy boundary. Removing a watcher ends only that participant relation; it
does not alter assignee or reviewer rows.

Cloud rollback and postflight passed the new smoke plus task creation, lifecycle,
Workspace access and collaboration regressions. The smoke also proves index use,
stale-version rejection and rollback when outbox insertion is forced to fail.
The runner now isolates multiple smoke fixtures with savepoints. The complete
five-smoke request exceeded the Management API timeout, so the same set passed in
bounded savepoint batches. Full Vitest passes 366 files / 1,736 tests; TypeScript,
migration baseline (27 active / 402 archived), query audit (0 findings/errors)
and the linked ERROR security advisor pass.

Postflight confirms the child and watcher RPCs and `planned_start_at` on Cloud.
Notification delivery remains disabled; the current outbox is 16 pending with
0 processed, 0 deliveries and 0 push jobs. No backlog item was delivered by this
rollout. Production frontend deployment remains unchanged.

### Pilot feedback UI — child tasks, people and persistent actions

The approved detail layout is now implemented in the frontend source. The task
rail remains beside the detail on desktop; the center uses a clear header and
white content sections on a neutral canvas, while creator, active assignees,
reviewer and watchers appear in a dedicated people rail. Names and avatars are
shown instead of internal IDs. Tablet/mobile retain the responsibility sheet.

Parent tasks load permission-filtered child pages and the server aggregate. The
full creation drawer is reused for child tasks with the parent ID, scope and
privacy fixed; planned dates and active assignees are initial defaults, while
files, checklist and watchers are not copied. Children keep their own lifecycle.
Auto-complete submit and reviewer approval show the agreed warning when visible
children remain open; cancelling the warning sends no command and accepting it
does not cascade any child state.

The header now separates planned start/end from actual start/completion and sends
versioned `schedule_update` commands. Authorized users can add or remove watchers
with one versioned diff. The single action bar sits outside the scrolling detail
content and remains reachable while scrolling, including safe-area handling above
the application bottom navigation.

Synthetic Chrome QA passed child creation, inherited boundary fields, schedule
validation/update, watcher diff, parent warning cancel/continue, one persistent
action bar, 1440/768/360 layouts and 320px overflow checks. Task 8, Task 9 and
refresh regressions pass. Full verification passes **366 files / 1,736 tests**,
TypeScript and the production build; the pre-existing large-chunk warning remains.
Dev continues at `http://127.0.0.1:5187/#/work`. Notifications stay disabled and
no production deployment or handoff was performed.

### Pilot feedback UI — direct attachment preview

Task attachments now route JPEG/PNG/WebP to the preferred processed display or
fallback variant and route PDF/TXT to the signed original. Unsupported MIME types
remain download-only. The viewer keeps each signed URL inside its dialog lifecycle:
closing, pressing Escape, changing task/route or unmounting aborts pending text reads
and clears content. Expiry removes the old content and exposes an explicit retry.

Image preview uses contained media, PDF uses a titled internal frame with the existing
original-download action retained, and TXT is rendered as text in a `pre` element.
TXT streaming stops at 1 MiB and marks a truncated preview; no file content is passed
to `innerHTML`. Focus returns to the exact attachment button after close.

Unit routing checks and synthetic Chrome QA pass for image/PDF/TXT, unsupported
download-only files, Escape/focus return, expiry/retry, read denial without retained
content and route-change cleanup. Notification delivery and production deployment
remain unchanged; no handoff was created.

### Pilot feedback collaboration — inline mentions

Migration `20260908060000_work_inline_comment_mentions.sql` was applied from commit
`4e77e7b` on 2026-09-08. Its SHA-256 is
`d7b5446f2297911d4e8d93e88a31dc543623ebe3de3424f9f05b68898cd99ab6`.
The linked dry-run listed this migration only; local and Cloud migration ledgers
now match 28/28.

Comment create/edit now validates an exact safe document-node allowlist and derives
mention recipients from inline `mention` nodes on the server. A client-supplied
`mentionedUserIds` list has no authority. UUID and label validation, current task
visibility, a 50-recipient limit, deduplication and old/new edit diffing are enforced
inside the collaboration command transaction. Plain typed `@name` text creates no
mention; retained or removed recipients are not notified again, while a newly added
recipient creates one mandatory `comment.mentioned` event and outbox item.

The discussion composer now opens the task-scoped people suggestions directly while
typing `@`. Arrow keys, Enter/Tab, Escape and whole-token Backspace are supported.
Selected labels remain tied to stable user IDs through blur and background refresh.
Existing comments that predate inline nodes are loaded for editing with explicit
mention tokens at the top and a migration note.

Candidate rollback and applied-schema postflight passed the inline mention,
collaboration and notification-delivery Cloud smokes. Full Vitest passes **366 files /
1,739 tests**; TypeScript, production build, migration baseline (28 active / 402
archived), query audit (0 findings/errors), Task 9 keyboard/browser, detail redesign
and refresh browser suites pass. The post-apply Cloud security advisor at ERROR level
reports no issues.

Notification delivery remains disabled. Cloud state after rollout is 16 pending
outbox records, 0 processed records, 0 deliveries and 0 push jobs. No backlog item was
delivered. Dev remains available at `http://127.0.0.1:5187/#/work` with HTTP 200.
Production deployment is unchanged, and no handoff was created.

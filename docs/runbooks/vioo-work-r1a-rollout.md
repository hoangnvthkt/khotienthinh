# Vioo Work R1A rollout

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
- [ ] Commands, lifecycle, SLA, collaboration, and outbox verified.
- [ ] Private Storage and upload processor verified.
- [ ] Responsive UI verified at 360x800, 768x1024, and 1440x900.
- [ ] Named pilot grants reviewed; no bulk grants exist.
- [ ] Feature flag enabled only for the approved deployment environment.
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

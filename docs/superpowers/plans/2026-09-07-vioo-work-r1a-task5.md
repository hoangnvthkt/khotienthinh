# Vioo Work R1A Task 5 Implementation Plan

Approved basis: task-management design sections 11–12, 20 and the R1A roadmap. Execute in the existing feature worktree, main agent only, Supabase Cloud `ftciqmqhmfvjtwoycswe`. Keep the feature flag false. No handoff is part of this task.

## Contract decisions

- Checklist commands create, update, complete/reopen and soft-delete items. Creator, accepted live assignee or scoped manager can act before review/closure. Assignee must be a current task assignee with view access. Per-item expected versions prevent lost edits; task lock serializes lifecycle and collaboration. Immutable events retain completion and deletion evidence.
- Current creator, live assignee, active watcher/reviewer or scoped manager can discuss an open task. Only the author may edit their comment while they retain this capability. There is no invented time-window policy. Each edit preserves before/after content and mention IDs in immutable audit. Attachments remain Task 7.
- Comments use their own versions; discussion and personal preferences do not invalidate lifecycle versions. Replies must belong to the same task. Mention selection and submit both verify actual current target visibility; no new relationship/grant is created. Newly added mentions emit mandatory-target outbox events; routine comment events remain separate.
- History requires the same canonical audit permission in RLS, capabilities and RPC, including historical assignees. Comment/history cursors use `(created_at, id)` descending with a hard cap. History supports category and actor filters. Mention picker returns only user ID/name with a bounded UUID cursor.
- Personal pin/mute uses actor identity from the session. Preferences apply only to routine notifications; mandatory delivery enforcement is Task 6. Personal changes do not broadcast a shared event. Detail adds only personal preferences and collaboration capabilities; comment/history are lazy pages.

## Implementation and checks

- [x] Failing authenticated Cloud rollback smoke against empty CLI-created migration.
- [x] Forward migration: shared visibility/audit predicates, checklist soft-delete, collaboration commands, bounded readers, detail/clone filters and explicit ACLs.
- [x] Feature-local TypeScript contracts and authenticated persona smoke: cross-task input, restricted visibility, historical audit, version/idempotency, immutable evidence, cursors and private preferences.
- [x] Task 3/4/core/helper regression, lint, migration/query checks and security advisor.
- [x] Explicit candidate commit, isolated dry-run/apply, postflight and rollout evidence.

Release candidate `8926cd0` was applied after a dry-run listing only the Task 5
migration. Collaboration, lifecycle, SLA, Task 3, core RLS and authenticated helper
postflight smokes passed against the applied schema. Local/Cloud ledgers match
15/15; security advisor error level has no issues. Persisted tasks, comments,
calendars, policies, direct Work grants, outbox and collaboration fixture users are
all zero. Rollout evidence is recorded in `docs/runbooks/vioo-work-r1a-rollout.md`.

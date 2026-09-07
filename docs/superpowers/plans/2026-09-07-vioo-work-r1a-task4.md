# Vioo Work R1A Task 4 Implementation Plan

> Execute inline with `superpowers:executing-plans`; workspace instructions prohibit sub-agents.

**Goal:** Complete assignment lifecycle, review, transfer/co-assignee and business-calendar SLA.

**Architecture:** Keep `work_tasks` locked per command and check its expected version before mutation. Actor comes from `current_app_user_id()`. Each mutation writes its event/outbox and idempotency response in the same transaction. Extend the applied schema only with forward migrations.

**Tech Stack:** Supabase Cloud PostgreSQL, SQL rollback smoke, feature-local TypeScript contracts.

**Spec:** `docs/superpowers/specs/2026-09-05-vioo-work-task-management-design.md`, sections 8–10, 19–20, 25.

## Constraints

- Work only in `.worktrees/vioo-work-r1a` on `feature/vioo-work-r1a`.
- Cloud project `ftciqmqhmfvjtwoycswe`, root `.env`; no Docker/local Supabase.
- Flag remains false; no production calendar or pilot grant without named configuration.
- Applied migrations are immutable. Create new filenames with the Supabase CLI.
- Every migration: failing behavioral smoke, implementation, Cloud rollback green, explicit-path commit, isolated linked dry-run, apply, postflight.

## Task 4A: Calendar and SLA engine

**Files:** new CLI-generated `work_r1a_sla_engine` migration, `supabase/tests/work_r1a_sla_engine_smoke.sql`, `supabase/baseline/current.json`, `lib/work/workTypes.ts`, rollout runbook.

**Interfaces:** private `work_add_business_minutes(uuid,timestamptz,integer) -> timestamptz`; private `work_resolve_sla(jsonb,text,timestamptz) -> jsonb`; assignment fields `execution_sla_started_at`, `execution_sla_due_at`, `sla_snapshot`. The snapshot records the calendar/policy and configured/default durations. No execution SLA exists unless a duration is explicitly configured.

- [x] Add rollback tests with a synthetic split workday, closed day, exceptional working day and three priorities. Assert exact timestamps and missing-calendar rejection. Assert self-assignment starts execution at acknowledgement and configured execution duration never rewrites task deadline.
- [x] Run against an empty CLI-created migration; verify the engine assertions fail for the missing implementation.
- [x] Extend calendar/exception intervals, add optional policy priority/execution duration, replace old policy uniqueness with scope+priority uniqueness. Validate interval ordering and overlap. Resolve exact-scope priority policy, scope default, global priority, global default, then configured default calendar. Compute normal default acknowledgement as one configured workday; important 240 minutes; urgent 60 minutes.
- [x] Iterate day/interval boundaries in the calendar timezone, apply date exceptions, reject invalid/absent calendars and an exhausted bounded search. Use forward replacement of create so snapshot and SLA fields are filled inside its original transaction.
- [x] Run Task 3 regression plus engine rollback smoke, lint, migration checker and advisor. Commit, dry-run/apply/postflight and record evidence.

Calendar acceptance example (fixture only): Friday 2026-09-04 11:30 +07 plus 120 working minutes on 08:00–12:00 / 13:00–17:00 equals Friday 14:30 +07. Friday 16:30 plus 60 minutes with Monday closed equals Tuesday 08:30 +07.

## Task 4B: Lifecycle and responsibility commands

**Files:** new CLI-generated `work_r1a_lifecycle_commands` migration, `supabase/tests/work_r1a_lifecycle_commands_smoke.sql`, `lib/work/workTypes.ts`, baseline marker and rollout runbook.

**Interface:** public `command_work_task(p_task_id uuid,p_command text,p_payload jsonb,p_expected_lock_version bigint,p_idempotency_key uuid) -> WorkTaskCommandResult`. Supported commands: `acknowledge`, `request_clarification`, `start`, `block`, `unblock`, `submit`, `review`, `cancel`, `transfer`, `add_assignees`. One private guarded dispatcher implements the fixed command allowlist; no client-selected actor/source.

- [ ] Create authenticated fixtures for creator, two assignees, watcher, reviewer, manager, unrelated/inactive accounts. For a task with pending assignments assert: watcher cannot start; acknowledgement affects only caller; first acknowledgement moves task to not_started; other pending assignments remain pending.
- [ ] Assert stale expected version returns `WORK_VERSION_CONFLICT`; same actor/key/payload returns original response; changed payload fails `WORK_IDEMPOTENCY_CONFLICT`.
- [ ] Implement per-task row lock, authorization/capability and exact transition allowlists. Actor's accepted live assignment permits start/block/unblock/submit; clarification never blocks accepted collaborators. Require notes for clarification/block/cancel/reject/transfer.
- [ ] Add tests for submission iteration, pending-review uniqueness, reviewer-only approval/rejection, auto-complete, terminal task denial and event/outbox atomicity. Complete all live assignments without deleting pending acknowledgement history.
- [ ] Add transfer and co-assignee tests: only actor's assignment transfers; no duplicate live assignment; validate receiver module/scope/privacy access, preserve the common deadline, reset acknowledgement/execution SLA for new assignee, preserve old rows and transfer pointers.
- [ ] Recompute capabilities from actual relationships/state. Include them in detail and command result; readonly actors have no mutation actions. Preserve original idempotent response after later state changes.
- [ ] Run lifecycle + Task 3/4A/core permission smoke, lint/full tests/checker/advisor. Commit, dry-run/apply/postflight and record evidence.

## Remaining R1A sequence

Task 5 adds checklist/discussion/history/pin/preferences; Task 6 delivers the transactional outbox and invalidation; Task 7 private Storage/upload; Tasks 8–9 UI and responsive QA. Task 10 consumes the actual calendar/pilot/environment information requested from the user. Task 11 verifies HTTP/JWT personas, query plans, rollout and the actual 48-hour observation. These remain separate checkpoints and cannot be claimed complete from Task 4 database smoke.

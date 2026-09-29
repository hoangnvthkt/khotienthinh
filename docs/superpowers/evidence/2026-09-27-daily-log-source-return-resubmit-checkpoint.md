# Daily Log UX — Task 4 source return/resubmit checkpoint

Plan: `docs/superpowers/plans/2026-09-26-daily-log-user-centered-ux-revision.md`.
Scope: isolated `codex/daily-log-bootstrap-integration` worktree; main agent only.
Cloud: baseline-vioo-git (`oymkraihhqahqvzahhtx`) only. No production writes,
local/Docker, history repair, merge/push, or operator rollout promotion.

## Delivered contract

- `returnSource`: stable command ID, exact summary/card/source relationship,
  expected summary timestamp and source version, required correction reason.
- Canonical scoped Room verify permits the summarizer; approve permits CHT.
  No legacy reviewer fallback, admin bypass, or user-editable metadata authority.
- One transaction returns the source with actor/time/reason and version+1,
  marks only the selected card `change_requested`/`returned`, and rejects the
  target pending summary. Established summary assignments close and the
  existing correction-owner assignment is created. Other pending snapshots,
  physical source content/resources, and verified history are not rewritten.
- `submitSource`: own-author canonical submit only, for draft/returned sources.
  It validates complete saved raw/normalized inputs, qualified baseline,
  forecast reason, active provider, physical counts/hours, and resource scope
  plus work-item ownership. Exactly version+1; no physical replacement and no
  publication/evidence/financial transaction. Return comments remain recorded.
- Current-transaction, owner-execution receipts authorize narrow v2 trigger
  exceptions. Direct browser status changes and old receipt replay cannot bypass
  the command. Marker1 legacy transitions and original guard bodies remain.
- Idempotency key then rollout scope precede sorted logs, sorted cards, source.
  Source save/submit do not acquire a summary after locking a contribution.
  V2 publication shares the same prefix, preventing approval/return half-states.
- New semantic conflicts use HTTP409/PT409, not custom serialization failures.

## TDD findings and scoped rulings

Client RED: 10 missing-method failures; unit migration boundary RED: missing
selection implementation, later two failures for the follow-up allowlist.
Cloud RED: missing `submit_daily_log_source_v2` after correcting a fixture that
incorrectly assumed a materialized evidence table existed.

Further regression RED→GREEN:

1. Mutated area allocation was accepted at submit; validate saved allocation,
   scoped work metadata, and raw/normalized agreement.
2. V2 approval rejected the qualified fingerprint as a legacy whole-WBS MD5.
   V2 publication now revalidates its qualified context; marker1 retains its
   original predicate. No snapshot/fingerprint rewrite to trick validation.
3. V2 revision publication considered derived task progress changes a new
   quantity basis. Diagnostic showed progress0→12, row_version1→2,
   progress_mode manual→weekly_report, and actual_start_date. The Daily Log
   token excludes derived progress/version/actual dates/update timestamp;
   material plan, unit, scope, schedule, BOQ and prior/next evidence remain.
   Existing two old v2 test drafts need reload/explicit resave; no backfill.
   Before apply there were zero historically verified v2 sources on this Cloud.
4. Return left an active approval assignment; reuse the established close and
   correction-assignment helpers atomically, without new grants.
5. A physical resource with project_id=null passed submit. Follow-up migration
   adds resource scope and own-work/task linkage validation. Both SQL and real
   Auth HTTP tests watched this fail before apply, then pass after apply.

The privileged publication implementation moved to the private schema, with
an inaccessible public invoker alias for existing internal callers. The public
publication adapter preserves legacy-only behavior and all pilot/shadow/revision
checks; only v2 adds lock ordering and HTTP-safe semantic conflict handling.
No Project V2/Procurement schema or commands were changed.

## Fresh verification

- Full suite: **2448 tests /509 files passed**, 2 pre-existing skipped tests/files.
- Typecheck and build: exit0; existing large-chunk warning remains.
- Migration check: **133 active /402 archived**. Query audit: all findings0.
- Diff check clean; dev `http://127.0.0.1:4197/` HTTP200.
- Two additive migrations applied independently with exact pending allowlists:
  `20260926165732_daily_log_source_return_resubmit_v2.sql` and
  `20260926174010_daily_log_source_readiness_scope_v2.sql`.
  Cloud ledger **37→38→39**, recorded prefixes preserved. Applied files immutable.
- **15/15** final applied-schema rollback smokes passed, including new lifecycle,
  readiness, non-admin v2 approval/revision, existing publication, Room, pilot,
  cutover, returned-summary guard, and resource-evidence compatibility.
- Real anon-key/Auth: **five existing EMPLOYEE accounts**, each `is_admin=false`.
  Duplicate submits share one receipt/version; competing returns produce one
  success and one HTTP409; A return leaves B untouched; own correction/resubmit
  reaches version6; reader/other-author denied; correction comment preserved.
  No official progress or project-transaction writes in this lifecycle test.
- Real two-session approval/return race, both winner orders: second command
  observed waiting on a PostgreSQL lock, then denied; verified+included or
  rejected+returned remained coherent; other pending snapshot unchanged.
  Enforced scope was a named disposable fixture project only; existing pilot
  configuration compared before/after and unchanged. Fixture scope removed.
- Advisors **61→61**, **zero new warnings**, compared by warning identity.

Test tooling corrections: pg parameterized multi-statement cleanup was split
into individual parameterized queries. The exact leftover own fixture project
`__DL_UX_RACE_66a5bfe9-edc8-4949-b358-4fc6d587584b` was checked and removed,
remaining0. The pooler's protocol PID was not the actual PostgreSQL backend PID;
the lock witness now uses `pg_backend_pid()`. Final race runs clean up normally.
Auth fixture counts restore to their pre-test values; no retained Task4 fixtures.

## Boundary / next consumer

This checkpoint completes the backend and client-command producer for Task4.
The v2 browser status-write bypass is denied by the server, and service adapters
use RPC only. Live editor/workspace consumers are explicitly Tasks5–7; no new
ERP screen, responsive walkthrough, usage guide, or user acceptance is claimed
here. Task5 must wire save+submit to these commands, never direct `.update(status)`.
Task6 must deliberately refresh returned cards after resubmission; do not erase
comments or silently treat old snapshots as current.

Skills used: executing-plans, TDD, systematic-debugging, Supabase,
Supabase Postgres best practices, verification-before-completion.

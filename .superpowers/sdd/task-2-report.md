# Task 2 Report: Daily XP Database Repair and Hardening

## Outcome

Implemented a transaction-neutral Supabase migration that repairs legacy XP data and hardens the XP schema, archive trail, indexes, foreign keys, RLS, ACLs, legacy RPC exposure, and actor-bound daily award RPC.

The migration is intentionally externally transactional: it contains no top-level `BEGIN` or `COMMIT`. Rollout and dry-run execution must wrap it in an explicit transaction (or an equivalent single-transaction migration runner).

## Task 2 files

- `lib/__tests__/dailyXpMigrationContract.test.ts`
- `supabase/migrations/20260715170312_repair_and_harden_daily_xp.sql`
- `supabase/tests/daily_xp_legacy_fixture.sql`
- `supabase/tests/daily_xp_repair_and_rpc_smoke.sql`
- `.superpowers/sdd/task-2-report.md`

No historical migration, frontend XP service/call site, `package-lock.json`, or `supabase/.temp` file was changed.

## TDD evidence

1. Initial focused RED, before the production migration existed:
   - `npx vitest run lib/__tests__/dailyXpMigrationContract.test.ts`
   - Result: 9 failed / 9 tests.
2. Rollout-transaction correction RED:
   - Contract changed to require an externally rollbackable migration with no internal transaction boundary.
   - Result before implementation change: 1 failed / 9 tests (`begin;` was present).
3. Strengthened hostile-fixture RED after independent review:
   - Static contract: 4 failed / 9 tests (missing pre-snapshot lock, canonical key overwrite, column ACL cleanup, and routine containment/drop behavior).
   - Runtime dry run failed with PostgreSQL `42P13` because a hostile legacy `award_my_daily_xp(text, uuid)` had a different return type and was not dropped before replacement.
4. Focused GREEN:
   - `npx vitest run lib/__tests__/dailyXpMigrationContract.test.ts`
   - Result: 9 passed / 9 tests.

## Hostile fixture and smoke coverage

The committed fixture/smoke pair exercises:

- Direct app-user UUIDs, employee legacy UUIDs, uppercase/braced/whitespace UUID text, and unmappable orphans.
- Profile collisions where the direct app-user profile must win.
- Cross-identity daily duplicates and deterministic earliest-row retention.
- Noncanonical daily idempotency keys and a non-daily key collision; the historical event is retained while its conflicting key is archived and cleared.
- All level thresholds and first-earned timestamps for every badge, including 7-day and 30-day streaks.
- Permissive legacy RLS policies, broad table ACLs, explicit column ACLs, and private-schema access.
- Wrong same-named indexes and foreign-key constraints.
- Hostile legacy `add_xp` and `get_xp` functions, a private `record_xp` procedure, and an incompatible legacy daily wrapper.
- Exact authenticated/service-role table privilege matrices, no untrusted column privileges, and no untrusted legacy XP routine execution.
- Auth-ID-bound actor switching, exact RPC payload keys, SQLSTATE `22023` validation failures, daily idempotency, owned attendance verification, and own-event RLS.

The legacy containment predicate is XP-token-safe: it targets XP tokens/action names or routine bodies that reference `user_xp`/`xp_events`, without treating an unrelated name such as `export_*` as XP merely because it contains the letters `xp`.

## Reviewer findings resolved

- Added a consistent `SHARE ROW EXCLUSIVE` lock before source snapshots so concurrent DML cannot escape the repair archive.
- Replaced scan-order-sensitive timestamp fills with `transaction_timestamp()`.
- Added guarded UUID normalization before UUID-to-UUID identity joins.
- Overwrote daily keys with canonical server keys and archived/reconciled pre-existing key collisions without deleting non-daily events.
- Revoked table and column privileges from untrusted roles; retained only authenticated SELECT and explicit service-role DML.
- Validated index/FK definitions structurally and repaired wrong same-named objects after archival.
- Revoked all untrusted execution from identified legacy XP routines using `ON ROUTINE`, normalized ownership, removed obsolete daily API overloads, then created/re-granted only the new wrapper/core pair.
- Strengthened smoke assertions for complete source/catalog archives, both duplicate losers, exact ACLs, exact leaderboard visibility, intended validation SQLSTATEs, consistent JWT switching, and every badge timestamp.

## Verification

- Focused contract: 9/9 passed.
- Full test suite: 67 files passed; 369 tests passed.
- TypeScript lint/typecheck: `npm run lint` passed.
- PostgreSQL raw parsing (`libpg-query`): migration 72 statements, fixture 54 statements, smoke 11 statements parsed.
- Disposable local PGlite PostgreSQL 18 harness:
  - fixture setup passed;
  - external `BEGIN` + migration + `ROLLBACK` dry run passed;
  - separate external transaction apply passed;
  - committed runtime SQL smoke passed.
- `git diff --check` passed.
- Forbidden-scope status check for `package-lock.json` and `supabase/.temp` passed.

## Runtime limitation and rollout note

The Docker daemon was unavailable, so the Supabase CLI local stack could not be started and the SQL smoke was not executed against the exact bundled Supabase PostgreSQL image. PGlite provided real local PostgreSQL parsing/execution, PL/pgSQL compilation, transactions, roles, RLS, ACLs, constraints, indexes, and RPC behavior, but it is not a substitute for the final Docker-backed Supabase dry run.

Before Cloud apply, run the committed fixture/migration/smoke sequence against an isolated local Supabase database, then perform the prescribed external transaction dry run against the target and inspect the repair batch before committing the real transaction. No Cloud or linked-database write was performed in this task.

# Daily Log forward-upgrade rehearsal — 2026-09-26

## Authorization and isolation

User approved reconciling authoritative migration sources and rehearsing an
upgrade on isolated Cloud test, without modifying Project/Procurement behavior
or deploying production. Main agent only, executing-plans and Supabase skills.

Dedicated with_data=false Cloud branch `daily-log-forward-upgrade-rehearsal`:
`jtgtubyvwvohxfipygvy`, branch ID `63a05aec-fe40-41b8-8695-10a5df788cd8`.
Bootstrap Git source `codex/hrm-bootstrap-guard` at `f1a4dca`, provider action
`aef3ce7dab2845ef939a3ea1b94d6347`: 113 applied migrations before rehearsal.
No production data copied. The other two existing Cloud branches were retained.

Separate native worktree at
`/Users/admin/.codex/worktrees/daily-log-forward-upgrade-rehearsal/khotienthinh`
started from `f1a4dca`. Its immutable migration copies are test staging only;
the four other-stream migrations were not added to PR #13. The root dirty
workspace was only read, never edited/staged/restored. No local/Docker database.

## Authoritative source reconciliation

Read production migration statements through the read-only Management API.
All four corresponding root SQL files match after removing comments/whitespace
and normalizing statement terminators. This is textual comparison, not a SQL
semantic-equivalence parser. Original file SHA-256 values:

| Version | Source SHA-256 | Provenance |
| --- | --- | --- |
| 20260923042822 | 76627f3d07668a309a1bd74a3371fc6f512ce6a3cfbe949da8b0220dfb4fa7e8 | Root untracked Auth SQL; not yet a committed integration dependency |
| 20260924094500 | 173db3df98e92faa696ea0ef21950f0d15cddd4cf9e8865829a01e59d1b116ae | Commit 678a01290d1cb56753d835609990cf4f4979a69b; later correction 38c3afd295a8fbbe4ebbc5c21aae74a8ff5897c6 |
| 20260924164000 | b9a30de2b7ace1890148f27f8e8611d99c2e39171f22c436c3dc20e35d9e36c5 | Commit 6a3d8b36dfa2e07a8e7926e60b881d1da95bafb5 |
| 20260924165000 | 6fd64d5a873b1ff34ee861344ae0bb40ccae139023e8dde0c7a2d60085aab893 | Commit 6a3d8b36dfa2e07a8e7926e60b881d1da95bafb5 |

These files change Auth profile compatibility and the scoped site-stock RPC,
not Daily Log tables. Their hashes are prerequisites for rehearsal, not authority
to implement or merge the other stream.

## Actual forward upgrade — PASS

1. CLI dry-run identified exactly four prerequisite migrations.
2. First push via transaction pooler failed before applying anything with
   `42P05 prepared statement already exists`; ledger remained 113.
   Connection inventory confirmed port 6543. Session pooler port 5432 supports
   prepared statements; only the connection mode changed, not schema/guards.
   Reference: https://supabase.com/docs/guides/database/connecting-to-postgres
3. Session-mode dry-run and actual push applied exactly those four files:
   ledger 117, latest `20260924165000`.
4. Executed `supabase/tests/daily_log_forward_upgrade_legacy_fixture.sql`
   after verifying the exact dedicated test ref. Persisted synthetic rows only.
5. Copied all 13 Daily Log migration files from PR #13 and verified byte equality.
6. Ordinary dry-run rejected six older Plan 1 versions as preceding the latest
   remote migration. This reproduces the historical-order issue without writes.
7. Reconciled `--include-all --dry-run` selected exactly 13 Daily Log migrations.
   Guarded actual CLI push applied all 13 successfully, ending at **130 versions**.
   No seed/roles push, manual ledger writes, repair, or PERF02/HRM replay.

CLI v2.95.6, session-mode URL resolved in memory from the dedicated branch;
Supabase URL ref and database username suffix were checked before every push.
Credentials were never emitted. Commands were run from the test staging worktree:

```text
supabase db push --db-url <guarded test session URL> --dry-run --yes --agent=no
supabase db push --db-url <guarded test session URL> --yes --agent=no
# After adding the byte-identical 13 Daily Log files:
supabase db push --db-url <guarded test session URL> --dry-run --yes --agent=no
supabase db push --db-url <guarded test session URL> --include-all --dry-run --yes --agent=no
supabase db push --db-url <guarded test session URL> --include-all --yes --agent=no
```

## Data, legacy and authorization assertions — PASS

Captured the before snapshot in
`2026-09-26-daily-log-forward-upgrade-before.json`.
After upgrade, projected every row onto all its original column keys and compared
exact values/row counts: projects 1, tasks 1, Daily Logs 3 (verified/draft/rejected),
labor 1, machines 1, contributions 1, manual progress 1 — all unchanged.
Historical price sentinels remain untouched; they were synthetic legacy data
created before migration, never new physical reporting or financial transactions.

Both resource rows retain semantics_version=1. New provider, physical quantity,
physical hours and lineage columns remain null. Zero inferred work items,
decisions, publications, rollout scopes and project transactions.
The Auth profile function and both site-stock RPC entry/implementation function
hashes are unchanged by the Daily Log upgrade.

Room bootstrap re-execution in a rollback transaction with an existing catalog
and populated project was a strict no-op: every Room/binding field unchanged.

Three Cloud rollback smokes pass after upgrade:

- Existing WBS/area foundation smoke.
- Existing summary/progress publication smoke.
- New `daily_log_forward_upgrade_evidence_smoke.sql`: ungranted EMPLOYEE denied;
  a scoped test Payment evidence grant returns unknownLegacyCount=2, no inferred
  current evidence, no monetary JSON keys, no transactions/publications/activation.

The new evidence smoke initially precreated a profile then inserted Auth, which
correctly failed the protected-profile update guard. Fixed the test fixture to
let the real Auth trigger create its canonical profile; no application function,
trigger, permission guard or administrator bypass was changed. Retry passes.
Every test Auth/profile/staff/grant and binding change rolls back.
Final inventory: zero auth/public users, staff, Room members, rollout scopes,
publications and project transactions. Only named synthetic legacy rows remain
in this dedicated test branch for reproducibility; nothing was deleted.

## Limits and production release disposition

This test is a populated synthetic upgrade, not a production-data clone.
Its initial 113-version bootstrap already includes the new Room metadata version.
Production has 116 versions without that entry; therefore it still needs the
Room no-op migration plus the 13 Daily Log versions. The rollback no-op check
covers the existing-catalog behavior separately; it is not claimed as a rehearsal
of recording that missing version in production history.

The test-only four-file overlay reconciles migration history for rehearsal.
PR #13 itself still omits those other-stream files. Confirmed with a fresh
`--include-all --dry-run` against the dedicated test branch: exit 1,
`Remote migration versions not found in local migrations directory`, identifying
exactly the four prerequisite versions above. The CLI suggests marking them
reverted; that suggestion was not executed. This negative check proves include-all
does not resolve remote-only history and is not permission to push production.
Authoritative owners must integrate their exact migration files, including the
currently untracked Auth repair, into the agreed release history. No invented
replacement, reverted marking or ledger repair is an acceptable shortcut.

Read-only organization GitHub-connection inspection returned 403, so automatic
production-deployment configuration remains unverified. No attempt was made to
change permissions or bypass that denial. A main merge must not be assumed
code-only. Production release remains held pending authoritative integration,
configuration confirmation and explicit release approval.

Final production read-only inventory remains 116 versions, latest
`20260924165000`, Room bootstrap absent, all 13 Daily Log versions absent.
No merge or production deployment was performed.

## Fresh candidate verification

- Full unit/contract suite: 2,366 passed, 2 skipped; 499 test files passed, 2 skipped.
- Typecheck, migration baseline (126 active / 402 archived), query inventory
  (zero findings/errors), and build: exit 0.
- Build retains its existing large-chunk warning; no bundling redesign was made.
- No application or production migration file changed during this task.
- Self-review only, per the no-subagent restriction; release gate remains held.

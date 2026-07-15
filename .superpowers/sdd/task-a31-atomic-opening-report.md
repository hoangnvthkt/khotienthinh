# Task A3.1 — Atomic project opening balance report

## Outcome

Configured opening-balance locking now crosses one client mutation boundary:
`public.lock_project_opening_balance(p_command jsonb)`. The database command
derives the active actor, checks current project and per-warehouse permissions,
resolves and locks inventory items, persists finance/project/WMS documents,
completes positive WMS adjustments, and locks the opening document in one outer
transaction. The local/offline branch remains local.

The final SQL also closes direct-write bypasses with a protected, one-use exact
row-image authorization for `draft -> locked`. Locked and void history and its
child lines are immutable through `ENABLE ALWAYS` guards, and API roles cannot
truncate the protected tables.

Configured voiding is deliberately fail-closed: the former direct status update
is rejected before any database call. Controlled reversal is owned by its
separately ordered migration and is not claimed by this hardening addendum.

### Forward-only hardening addendum (20260715120000)

The reviewed `20260715102000` migration remains immutable. A new forward-only
migration renames its RPC body to the fully revoked
`lock_project_opening_balance_v1(jsonb)` implementation and exposes a thin
same-signature wrapper. The wrapper preserves the JWT-derived actor, derives the
canonical project/site scope, requires strict `wms.transaction.create` and
`wms.transaction.complete` for every target warehouse with requester/assigned
fallback disabled, and establishes a protected backend/XID capability for the
old atomic body.

The hardening also:

- backfills nullable finance concurrency fields, makes them defaulted and
  non-null, and advances `updatedAt` monotonically on semantic changes through
  an `ENABLE ALWAYS` trigger;
- reserves `project_opening_balance` WMS sources to the wrapper capability and
  `wf001-opening-v1`, with a partial source-identity unique index;
- enforces existing project/canonical HRM-site identity and replaces the
  client-supplied scope-key uniqueness boundary with the authoritative locked
  `(project_id, construction_site_id)` pair;
- validates SKU/accounting/unit/item coherence, including two colliding new
  item lines in one command, at every transition into `locked`;
- checks `wms.inventory.edit OR wms.master_data.manage` only when the core
  actually inserts an item or changes a price, so exact replay and an existing
  priced item do not over-require catalog permission.

## Owned changes

- `lib/projectOpeningBalanceService.ts`
- `lib/__tests__/projectOpeningBalancePosting.test.ts`
- `lib/__tests__/atomicProjectOpeningBalanceMigration.test.ts`
- `lib/__tests__/atomicProjectOpeningBalanceHardeningMigration.test.ts`
- `supabase/migrations/20260715102000_atomic_project_opening_balance.sql`
- `supabase/migrations/20260715120000_atomic_project_opening_balance_hardening.sql`
- `supabase/perf/atomic_project_opening_balance_preflight.sql`
- `supabase/tests/atomic_project_opening_balance_smoke.sql`
- `.superpowers/sdd/task-a31-atomic-opening-report.md`

The migration was created through the required CLI workflow after inspecting
the CLI help:

```text
npx supabase migration --help
npx supabase migration new --help
npx supabase db query --help
npx supabase migration new atomic_project_opening_balance
```

The CLI-generated timestamp was renamed to `20260715102000` so the migration is
ordered after `20260715090000_wms_posting_path_containment.sql`, on whose guarded
posting path it depends.

## Database contract

- Security-definer JSONB RPC with empty search path; execution granted only to
  `authenticated`.
- Active actor from `public.current_app_user_id()`; no client actor is trusted.
- Current `project.budget.manage` and `wms.transaction.complete` checks occur on
  every request, including exact retries. Cross-actor retry is denied.
- Command and normalized-scope advisory locks, canonical server-side request
  hash, unique command identity, and normalized locked-scope uniqueness.
- Every runtime lock acquisition is bounded by a transaction-local five-second
  `lock_timeout`; the migration-time setting is not relied upon after deploy.
- Duplicate normalized locked-scope preflight runs before restoring the partial
  unique index.
- Deterministic, exact item resolution: explicit ID + case-insensitive exact SKU
  + equivalent unit; otherwise case-insensitive exact SKU, then exact accounting
  code. Ambiguity fails; only no-match creates a deterministic empty-cache item.
- Catalog resolution is serialized against concurrent item writers, normalized
  SKU/accounting identities are advisory-locked in stable order, and SKU plus
  accounting pointers to different rows fail closed. A2 unit
  normalization/equivalence and quantity precision are enforced before and
  after authoritative item resolution. Item locks and warehouse locks/posting
  are acquired in ascending ID order.
- Zero-quantity lines remain document evidence. Only positive remaining quantity
  becomes a deterministic WMS adjustment completed through
  `public.process_transaction_status`; the command never updates stock cache
  directly.
- WMS source and transaction advisory locks use the shared A3 namespaces, and
  `posting_request_hash` hashes `app_private.wms_transaction_intent` from the
  exact persisted row.
- Existing finance requires a complete semantic snapshot; every field the RPC
  may overwrite is compared under row lock. Ambiguous scope finance fails rather
  than selecting an arbitrary row, and stale snapshots fail with `40001`.
- Quantities, money, and value inputs reject `NaN` and positive/negative
  infinity at the SQL boundary.
- Project opening, lines, finance, optional material expense, all warehouse
  movements, and final lock state share the same transaction.
- Exact retries return a protected logged result snapshot after rechecking the
  current actor and warehouse permissions; later finance/catalog changes cannot
  alter the replay response.
- One-use authorization rows are scoped to backend PID + transaction XID and
  exact OLD/NEW images. Direct locked inserts, direct draft-to-lock updates,
  locked/void edits, line insert/update/delete, and uncontrolled void transitions
  fail closed. Line guards lock all affected parents in stable order before
  rechecking status.

## Client contract

- Configured mode calls only `rpc('lock_project_opening_balance', { p_command })`
  for the authoritative mutation; no configured `.from(...)` orchestration
  remains.
- The command excludes `actorUserId` and `existingItems` and serializes every
  numeric leaf as a canonical dot-decimal string (including exponent expansion).
- RPC rows are mapped to the existing camel-case result shape while
  `stock_by_warehouse` contents are copied as an opaque identifier map, so keys
  such as `zone_a` are never rewritten to `zoneA`.
- Weekly progress snapshot refresh runs only after RPC success as a derived cache.
- RPC errors prevent snapshot work. The offline branch still produces the local
  locked result without database calls.
- `voidOpeningBalance` in configured mode now throws a deliberate
  controlled-reversal-required error before `.from(...)` or RPC work. This
  removes the fake direct path but does not implement the future reversal flow.

## TDD evidence

RED evidence captured during development:

```text
npm test -- --run lib/__tests__/projectOpeningBalancePosting.test.ts
1/6 failed: legacy client called process_transaction_status instead of the lock RPC

# After expanding service and migration contracts, before implementation
16/16 failed: legacy orchestration, missing RPC migration, missing SQL artifacts

# Finance snapshot boundary test before payload support
1 failed: financeSnapshot absent from p_command

# Canonical numeric boundary before conversion
2 failed: payload numeric leaves remained JavaScript numbers

# Exact accounting-code fallback before correction
1 failed: accounting-code predicate was case-folded instead of exact

# Independent database review expansion before hardening
6/12 failed: no stable replay snapshot, shared WMS locks/full intent hash,
catalog-writer serialization, stable parent locking, full finance comparison,
or finite-value guard

# Client review regressions before correction
npm test -- --run lib/__tests__/projectOpeningBalancePosting.test.ts
2/12 failed: opaque warehouse key `zone_a` became `zoneA`; configured void still
attempted a direct table update

# Final contention/smoke contract before correction
npm test -- --run lib/__tests__/atomicProjectOpeningBalanceMigration.test.ts
2/12 failed: runtime function had no bounded lock timeout and smoke lacked the
new non-finite/line-update-delete assertions

# Forward-hardening contract before the new migration/artifacts
npx vitest run lib/__tests__/atomicProjectOpeningBalanceHardeningMigration.test.ts
7/7 failed: no finance hardening, protected source reservation, authoritative
scope/index, lock-time line coherence, strict PBAC wrapper, or extended smoke
```

GREEN evidence (fresh final runs):

```text
npm test -- --run \
  lib/__tests__/projectOpeningBalancePosting.test.ts \
  lib/__tests__/atomicProjectOpeningBalanceMigration.test.ts \
  lib/__tests__/projectOpeningBalanceService.test.ts \
  lib/__tests__/projectOpeningBalanceCommand.test.ts \
  lib/__tests__/projectOpeningBalanceModalAtomic.test.ts

5 files passed; 41 tests passed

npm test -- --run lib/__tests__/atomicProjectOpeningBalanceMigration.test.ts
1 file passed; 12 tests passed

node /tmp/wf001-pglite/a31-check.mjs
A3.1 PGlite runtime checks passed

node /tmp/wf001-pglite/a31-smoke.mjs
A3.1 rollback-only SQL smoke passed in PGlite

npx vitest run lib/__tests__/atomicProjectOpeningBalanceHardeningMigration.test.ts
1 file passed; 8 tests passed

npm run lint
tsc exited 0

npm test
76 files passed; 431 tests passed

npx supabase db query --linked --agent=no \
  -f supabase/perf/atomic_project_opening_balance_preflight.sql
exit 0; no duplicate normalized locked scopes returned
```

The final full repository run is green: 76/76 files and 431/431 tests.

## Operational notes

- The SQL smoke is rollback-only and intended for a disposable migrated
  PostgreSQL/PGlite database. In addition to the original cases, it covers
  nullable-finance hardening and semantic timestamps, authoritative scope and
  project/site mismatch, generic/direct/service-role reserved-source denial,
  intra-command item identity collision, strict own/assigned and multi-warehouse
  PBAC denial, existing priced-item success without catalog permission,
  catalog-mutation rollback, and exact retry after catalog permission removal.
- The preflight is explicitly read-only and inlines the normalization expression
  so it can run before the migration creates the helper.
- Deployment was not applied to the linked project. The migration intentionally
  aborts if preflight finds invalid reserved sources, non-authoritative locked
  scope, duplicate authoritative pairs, or incoherent locked lines; operators
  must reconcile those rows rather than bypassing the checks.
- Finance locking and non-concurrent index creation use the migration's
  five-second lock timeout. A busy deployment may need a quiet write window and
  a safe retry; no partial migration state is committed on timeout.
- `supabase/.temp/cli-latest` is intentionally excluded from staging and commit.

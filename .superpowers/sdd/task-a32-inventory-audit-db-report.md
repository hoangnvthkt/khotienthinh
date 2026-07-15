# A3.2 database implementation report

## Scope delivered

- Added forward-only migration `20260715140000_atomic_inventory_audit.sql`.
- Added `public.post_inventory_audit(uuid,text,timestamptz,jsonb)` as the only
  API write path for physical audit evidence and its deterministic WMS
  adjustment.
- Added strict canonical decimal parsing, A2 unit precision enforcement,
  stable UTC request hashing, exact retry snapshots and conflicting-payload
  rejection.
- Added strict warehouse-scoped `wms.transaction.create` plus
  `wms.transaction.complete` checks using the JWT-derived active actor.
- Added command -> WMS source -> WMS transaction -> sorted item lock ordering.
- Added stale expected-cache rejection (`40001`) and exact comparison against
  `SUM(inventory_balances.on_hand_qty)` across every scope.
- Added server-authoritative audit item details, discrepancy/loss/norm totals,
  immutable audit evidence and all-zero evidence without a WMS movement.
- Reused `public.post_wms_transaction` for non-zero signed adjustments, so a
  failure rolls back the session, cache, ledger and result snapshot together.
- Reserved `(source_type, source_id) = ('inventory_audit', command_id)` with a
  private one-use capability and a partial unique index. Generic posting and
  direct API DML cannot mint this source.
- Revoked direct audit-session INSERT/UPDATE/DELETE/TRUNCATE from API roles and
  installed an `ENABLE ALWAYS` immutable guard.
- RPC response has exactly `audit_session`, `stock_transaction`, and
  `updated_items`; audit decimal fields are canonical strings.

## Verification

- Red-first contract test was observed: 7/7 failed before the migration and
  artifacts existed.
- Focused contract: 7/7 passed.
- `git diff --check` passed for every A3.2 DB artifact.
- PGlite 0.5.4 with pgcrypto executed the migration against a minimal A1-A3
  compatible catalog and exercised decimal posting (`0.25`, `1.75`), exact
  retry, all-zero evidence, stale cache `40001`, all-scope balance mismatch,
  and permission denial. Output: `A3.2 PGlite runtime: PASS`.
- The repository SQL smoke contains clone-runtime coverage for `0.25`, `1.75`,
  `2.375`, `0.123456`, retry/conflict, all-zero, duplicate item, stale cache,
  all-scope mismatch, negative legacy price, injected multi-item rollback,
  permission denial, direct DML/TRUNCATE denial and deterministic source.

The full `supabase/tests/atomic_inventory_audit_smoke.sql` was not executed in
this workstation session because the local Docker/Supabase database is not
running. It must be executed on the disposable fully migrated clone; the
PGlite harness validates migration syntax and the core runtime contract but is
not a substitute for the full trigger/ledger stack.

## Required deployment gates and open risks

- Run `supabase/perf/atomic_inventory_audit_preflight.sql` on live read-only
  catalog. Migration intentionally refuses any pre-existing
  `inventory_audit` source because its provenance cannot be trusted.
- Run the complete rollback-only SQL smoke on the masked production clone.
- A negative physical delta can be rejected by the existing posting engine if
  open reservations leave insufficient available stock. This is intentional
  fail-closed behavior: resolve/rescan via reconciliation; never bypass the
  posting engine.
- The migration makes historical `audit_sessions` immutable too. Any existing
  workflow that edits old audit rows must be retired before promotion.
- Production canary/24-hour observation and live operator approval remain
  external gates; they are not claimed by this implementation.

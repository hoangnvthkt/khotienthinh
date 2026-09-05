# Authorization V2 — Supabase Cloud Main Rollout Log

Cloud project: `ftciqmqhmfvjtwoycswe`

This log records non-PII reconciliation counts, release-candidate SHAs, migration dry-runs, rollback-only smoke results, apply results, advisors, and postflight checks for Permission Unification V2.

## Phase 1 / Task 1 — Rollout controls

- Baseline commit: `60a739c`
- Baseline test: 336 files / 1,596 tests passed before feature work.
- Migration ledger: local and Cloud both contain five migrations through `20260904081841`.
- Reconciliation snapshot (2026-09-05): 57 active users; 57 with legacy columns; 26 legacy-only employees; 1,181 active grants (1,164 `project.*`, 17 other); effective sources 1,181 DIRECT / 5,606 LEGACY / 333 ROLE; collisions 768 LEGACY+DIRECT / 261 LEGACY+ROLE; 14 rooms with 38 audit-only / 34 pilot / 0 enforced bindings; 38 audit-only fallback bindings; 0 stale active room members.
- Delta from the 2026-09-04 plan baseline: +2 active users, +2 legacy-column users, +2 legacy-only employees, +244 LEGACY source rows, fallback-only metric is now defined as all audit-only bindings (38), and stale active room members fell from 2 to 0. Grant and collision counts are unchanged.
- Security advisor: passed `--fail-on error`; pre-existing warnings remain and no error-level finding was reported.

## Phase 1 / Task 2 — Legacy write guard

Pending.

## Phase 2 / Task 3 — Source-aware snapshot

Pending.

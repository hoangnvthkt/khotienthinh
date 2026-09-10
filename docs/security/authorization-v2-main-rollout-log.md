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

- Migration: `20260905034726_authorization_v2_phase1_legacy_write_guard.sql`.
- Contract tests: passed.
- Cloud rollback transaction: passed all audit-only, disabled-write, and controlled-migration branches; fixture rolled back.
- Release candidate: `aa2a4e0`.
- Dry-run: exactly one migration, `20260905034726`.
- Applied to Cloud main: success; local/remote ledger aligned through `20260905034726`.
- Postflight smoke: passed and rolled back. The flag remains `false`; audit table and trigger exist.
- Privileges: `PUBLIC`, `anon`, and `authenticated` have neither table access nor direct function execution.
- Security advisor: no error-level findings (pre-existing warnings remain).

## Phase 2 / Task 3 — Source-aware snapshot

- Migration: `20260905035047_authorization_v2_phase2_snapshot_rpc.sql`.
- Contract tests: passed.
- Cloud rollback transaction: passed self-only active snapshot, inactive deny, expired-source exclusion, exact project scope, and Room action isolation; fixtures rolled back.
- Release candidate: `75d662c`.
- Dry-run: exactly one migration, `20260905035047`.
- Applied to Cloud main: success; local/remote ledger aligned through `20260905035047`.
- Postflight smoke: passed and rolled back.
- Privileges: `PUBLIC`/`anon` cannot execute the public wrapper; `authenticated` can execute only the public wrapper and cannot execute the private resolver.
- Security advisor: no error-level findings (pre-existing warnings remain).

## Phase 2 / Task 4 — Canonical frontend evaluator

- Auth loads `get_my_authorization_snapshot()` and projects its source list into `effectivePermissionSources` / legacy-compatible `permissionGrants`.
- Capability, route, Project scope, and Room helpers delegate to `authorizationEvaluator`.
- Domain routes take precedence over broad system shell modules; unknown routes and contradictory legacy fields deny when an authoritative snapshot is present.
- Targeted authorization regression: 6 files / 75 tests passed.
- Full regression: 341 files / 1,614 tests passed.
- Lint and production build: passed; only the existing Vite chunk-size warning remains.

## Task 0 reconciliation — 2026-09-10

- Target: Git branch `feature/audit-phan-quyen-v2`; linked Cloud main project `ftciqmqhmfvjtwoycswe`.
- Baseline repair commit: `d828ad2`; removed one brittle source-format assertion already covered by route behavior tests. Baseline after repair: 338 files / 1,603 tests passed.
- Source lineage merged: `f109477`, which contains the deployed Authorization chain `959cce1..6fc94d4`, WMS reversal from `8a2b11f`, and Work delivery from `c47433a` through `f109477`.
- Reconciliation merge commit: `6585fdf`; parents `d828ad2` and `f109477`.
- Migration reconciliation: 24 formerly remote-only files restored locally; all file SHA-256 values match the deployed source branch. Migration baseline check reports 29 active / 402 archived SQL files.
- Linked ledger: all 29 local versions equal Cloud versions through `20260909023239`; no local-only or remote-only entry remains.
- Preserved concurrent changes: Request Template routes `/rq/templates`, `/rq/templates/new`, `/rq/templates/:templateId`; PO delivery-batch/supplemental notification deep-links and centralized projection.
- Targeted Authorization/WMS/Work regression: 53 files / 279 tests passed.
- Full regression after merge: 368 files / 1,747 tests passed.
- TypeScript lint and production build: passed; only the existing Vite chunk-size warning remains.
- Cloud object check: authorization snapshot exists; `wms.transaction.reverse` is active; 15 active `work.*` permissions; Work task/workspace tables exist; authenticated helper EXECUTE smoke passed and rolled back.
- `db push --linked --dry-run`: `Remote database is up to date`; no migration was applied and no Cloud data was changed during Task 0.

## Phase 3 / Task 5 — Transactional authorization administration

- Migration: `20260910022617_authorization_v2_phase3_admin_transaction.sql`.
- Release candidate: `1306c81` (`feat(auth): make user authorization updates transactional`).
- Contract/service tests: 2 files / 7 tests passed; full checkout regression: 370 files / 1,754 tests passed.
- Migration baseline check, TypeScript lint, production build, and `git diff --check`: passed; only the existing Vite chunk-size warning remains.
- Cloud preflight transaction: migration plus smoke passed and rolled back without retaining fixtures or schema changes.
- Smoke coverage: non-manager deny, blank reason deny, stale `updated_at` conflict, invalid-grant profile rollback, and valid atomic profile/grant/audit update.
- Dry-run: exactly one migration, `20260910022617`.
- Applied to Cloud main: success; linked ledger contains `20260910022617`.
- Postflight smoke: passed and rolled back. The wrapper exists; `authenticated` can execute it and `anon` cannot.
- Cloud database lint still reports nine pre-existing error-level findings in unrelated AI, direct-purchase, quick-template, contract, and safety functions; no finding names the new Authorization V2 functions.
- `npm test` without an exclusion also scanned historical `.worktrees/**`: 11,903 tests passed and 39 historical-worktree failures occurred. The authoritative checkout-only run used `--exclude '.worktrees/**'` and passed all 1,754 tests.

## Phase 3 / Task 6 — Unified authorization editor

- Commit: `41af7e2` (`feat(auth): unify permission administration UI`).
- `UserModal` no longer renders or mutates the legacy module/sub-module editors. Edit saves call `update_user_authorization_v2` once, then reload the committed Cloud row.
- The unified editor contains module-shell filtering, scoped direct capabilities, Project Room summary/link, grant diff, and a mandatory reason.
- Clipboard version 2 contains direct grants and their scopes only; it excludes account role, warehouse identity, and all four legacy permission fields.
- Inherited capabilities are shown as locked `Kế thừa` provenance; legacy source count, collision count, and fallback migration state are read-only.
- Targeted regression: 4 files / 14 tests passed. Full checkout regression: 371 files / 1,759 tests passed. TypeScript lint and production build passed; only the existing Vite chunk-size warning remains.

## Phase 4 / Task 7 — Frozen regression baseline for seven cutover Rooms

- Frozen scope: `daily_log`, `material_planning`, `material_request`, `material_po`, `gantt`, `weekly_progress`, and `quality`. Task 7 created no migration, performed no backfill, and changed no Room policy, function, binding, membership, or UI.
- Before/after Cloud checksum snapshot was unchanged: 35 bindings (`8440dc8c6f750a92b7ef46b146f21a05`); 323 memberships / 316 active (`cfac9913cc24b9acb0259b19979783c1`); 118 relevant RLS policies (`73f9906693d3fddc637b1589606b5cdc`); 240 relevant function definitions (`6f895eddeeee49d8c42e4acec0fe876b`). Values contain no PII.
- Static regression passed: 8 files / 35 tests covering the seven-room registry and migration contracts.
- Cloud rollback smoke passed for Material Request and Quality. Six historical smokes exposed pre-existing test debt and were not rewritten in this evidence-only task:
  - the generic Room smoke expects an unknown action to raise, while the deployed replacement function filters unknown/unbound actions;
  - the audit-pilot smoke hard-codes 25 pilot actions from an earlier rollout state;
  - the Material PO smoke assumes no other Room has disabled fallback;
  - the Daily Log and Gantt fixtures no longer establish the assignment/grant state required by their current authoritative evaluators;
  - the Weekly Progress fixture expects an older out-of-order aggregate result.
- These failures occurred inside rollback-only transactions and did not mutate Cloud. They are recorded as test-harness drift rather than reported as passing production regression.
- `project.material_request.verify` has one `audit_only` binding with PBAC fallback enabled, but no exact policy reference, database function reference, or frontend/service business path. Its approved disposition is metadata-only retirement in Task 9; other Material Request actions remain untouched.

## Phase 4 / Task 8 — Four retired view-only Rooms

- Migration: `20260910025910_authorization_v2_phase4_retire_view_only_rooms.sql`; release candidate: `1eb71f7`.
- Preflight snapshot: 17 bindings; 39 active memberships; 66 active member-actions; 136 related active direct grants including the shared Material BOQ surface; zero role-template items; 30 relevant functions and 55 relevant policies. Domain row counts were unchanged: 0 Custom Material requests, 0 BOQ reconciliation groups, 0 acceptance records, and 5 subcontractor contracts.
- The migration preserves a private, non-PII disposition snapshot for each retired Room; no Room, membership, action, binding, grant, or domain row was hard-deleted.
- Cloud rollback preflight passed. Dry-run listed exactly migration `20260910025910`; apply to Cloud main succeeded and the linked ledger is aligned.
- Postflight: 10 active Rooms; four retirement dispositions; all 17 retired bindings are `enforced` with fallback disabled; 0 active retired memberships; 0 active retired member-actions; 32 non-view direct grants revoked; 65 view grants retained; 0 active non-view grants remain.
- Database authority: 15 mutation tables are protected by a common `public.is_admin()` trigger guard. Custom Material mutation helper, BOQ reconciliation write policies/status guard, acceptance writes, subcontract writes, and attachment storage mutation all require System Admin. Existing SELECT policies remain in place.
- Persona smoke proved ordinary-account custom-material denial, ordinary subcontract SELECT plus zero-row UPDATE denial, System Admin mutation allowance, and rollback isolation. The initial expanded smoke expected an RLS exception; PostgreSQL correctly returned zero affected rows instead, so the assertion was corrected to verify `ROW_COUNT = 0`.
- Frontend registry exposes only the view actions for Material Waste, Custom Material, and Subcontract; BOQ reconciliation remains under `project.material_boq.view`. Mutation controls are System Admin-only and retired Room recipient lookup was removed.
- Frozen seven-Room counts remain 35 bindings and 323 memberships / 316 active; no old Room was re-cutover.
- Full checkout regression passed: 373 files / 1,765 tests. TypeScript lint, production build, migration baseline check, and `git diff --check` passed; only the existing Vite chunk-size warning remains.
- Cloud database lint still reports the same nine pre-existing unrelated error-level findings; none names the Phase 4 migration, retirement guard, or modified policies/functions.

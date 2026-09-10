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

## Phase 4 / Task 9 — Final three Room cutover and fallback shutdown

- Migration: `20260910031856_authorization_v2_phase4_remaining_enforced_rooms.sql`; release candidate: `e235c72`.
- Preflight drift was handled explicitly: seven active memberships belonged to ended Project staff, and 24 Weekly Progress actions (15 view, 8 edit, 1 confirm) still depended on Room fallback. The migration did not rerun any of the seven prior Room cutovers; it only deactivated the stale rows, materialized measured Weekly Progress gaps, and updated binding disposition metadata.
- Final Room mapping covers 20 bindings across Quantity Acceptance, Payment, and Safety. Backfill evaluates the pre-cutover DIRECT/ROLE/LEGACY source decision per active Project staff scope and materializes the view prerequisite for every mutation.
- `project.material_request.verify` had no exact runtime business path and is now inactive in the canonical registry and Room registry. Its prior binding/member-action state is retained in `app_private.authorization_room_action_dispositions` with disposition `retired_no_business_path` and reason.
- Finance create/read/update/delete policies and workflow status guards are Room-authoritative. Safety read/edit assignment behavior remains explicit; incident `waiting_verification`, `resolved`/`rejected`, and `closed` transitions require submit, verify, and confirm Room actions respectively. System Admin remains an explicit bypass through the authoritative evaluator.
- Cloud rollback preflight and postflight smoke passed assignment validation, assigned versus unassigned Safety mutation, wrong project/site denial, Quantity Acceptance approval, Payment final-state immutability, all Phase 4 exit gates, and the four retired view/admin-write regressions. Existing Payment/Contract and Quality/Safety permission catalog smokes also passed.
- The historical Safety Passport smoke still fails before authorization assertions because its fixture omits the now-required `safety_worker_profiles.worker_kind`; it was not reported as passing and remains separate test-harness debt.
- Dry-run listed exactly `20260910031856`; apply to Cloud main succeeded and the local/remote ledger is aligned. Postflight: 10 active Rooms; 0 audit-only bindings; 0 fallback-enabled bindings; global Room fallback false; 0 stale members; four Room retirements; one action-level retirement; 63 active memberships in each final Room.
- Frozen-seven snapshot changed only in approved categories: bindings remain 35 but metadata checksum changed `4b39ee8b050d9e0a9d7f8148626b49c9` → `6bf7d15b9780befde61bdf892353bc64`; membership count changed 323/316 active → 368/354 active because Weekly Progress fallback gaps were materialized and stale memberships deactivated. Domain rows remained unchanged at 1 Quantity Acceptance, 1 Payment Certificate, and 5 Safety Issues.
- Room health: actions-not-connected 0, fallback-only 0, invalid-scope-or-staff 0. It still reports 644 inactive legacy PBAC audit rows and caps the broad unmapped-grant preview at 500; these are inputs to Phase 5, not hidden Phase 4 passes.
- Checkout regression passed: 374 files / 1,769 tests. TypeScript lint, production build, migration baseline check, and `git diff --check` passed; only the existing Vite chunk-size warning remains.
- Cloud database lint reports the same nine pre-existing unrelated error-level findings; none names the Task 9 migration or its new/changed authorization functions.

## Phase 5 / Task 10 — Deterministic legacy grant migration

- Read-only preview classified 5,551 effective legacy sources with 0 unknown module keys, 0 unknown routes, and 0 manual review. Raw routes without current action metadata use an explicit alias catalog; retired `CHIBIBOT` is recorded rather than silently mapped.
- Migration: `20260910033302_authorization_v2_phase5_legacy_grant_migration.sql`; release candidate: `d4dc7e2`; cutover ID `6aa37d8c-1d58-4eb4-a5a9-709100333020`.
- All 57 active users have private snapshots of the four legacy fields with verified SHA-256 checksums. Client roles have no access to snapshot or disposition tables.
- Postflight dispositions: 1,741 `mapped_view`; 565 `mapped_manage`; 1,605 `room_owned`; 550 `role_owned`; 1,376 `retired`; 0 `manual_review`. View-only Project modules receive view grants only; module/submodule legacy access never infers submit, verify, confirm, or approve.
- HR migration generated four deterministic `LEGACY_HR_*` templates from exact per-user effective permission sets. This avoids assigning the broad built-in HR/HR_MANAGE templates to 55 users with heterogeneous legacy access.
- Canonical active grants increased from 1,181 to 3,271. Sensitive mapped grants that require expiry receive a 90-day review window. Unique grant tuples remain enforced and the shadow comparison found no missing mapped grant.
- Postflight gate: 0 manual review, 0 legacy-only active user, 0 duplicate active grant tuple. The admin-only summary RPC exposes aggregate migration health without PII.
- Cloud rollback preflight, smoke, dry-run (exactly `20260910033302`), apply, postflight smoke, and ledger reconciliation passed.
- Checkout regression passed: 375 files / 1,774 tests. TypeScript lint, production build, migration baseline check, and `git diff --check` passed; only the existing Vite chunk-size warning remains.

## Phase 5 / Task 11 — Legacy fallback disabled

- Migration: `20260910034121_authorization_v2_phase5_disable_legacy_fallback.sql`; release candidate: `2594a6e`.
- TDD first proved a fallback-disabled snapshot cannot authorize a `LEGACY` source and that canonical `DIRECT` still wins when a stale legacy source is mixed into the payload. The auth mapper now drops stale `LEGACY` sources at the client boundary after cutover.
- Cloud rollback preflight initially caught the real mixed storage types (`text[]` module columns and `jsonb` submodule columns) in the health counter. The failed transaction retained no changes; the counter was corrected and the exact migration plus smoke then passed in rollback.
- Dry-run listed exactly `20260910034121`; apply to Cloud main succeeded and the local/remote migration ledger is aligned.
- Postflight flags: `legacy_fallback_disabled=true`, `legacy_governance_fallback_disabled=true`, `legacy_projection_enabled=false`. Effective resolver and authenticated snapshot both report zero `LEGACY` sources.
- Rollback evidence remains intact: 57 active-user snapshots pass SHA-256 verification; all four legacy columns remain present. Health reports 59 user rows with legacy configuration for Phase 6 cleanup without using those values for an allow decision.
- Existing feature-gated no-fallback smoke and the new permanent-cutover smoke both passed. Permission regression passed 7 files / 83 tests; full checkout regression passed 376 files / 1,778 tests. TypeScript lint, production build, migration baseline check, query inventory check, and `git diff --check` passed.
- Cloud database lint still reports the same nine pre-existing unrelated error-level findings; none names the Task 11 migration or authorization snapshot functions.

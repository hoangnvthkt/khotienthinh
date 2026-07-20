# VIOO Pilot Hard Cutover Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Legacy module/submodule authorization with exactly one System Admin, ordinary Members, Member application membership, explicit business mutations, global read-only System Admin oversight, and one controlled hard cutover.

**Architecture:** Deliver three gated workstreams in order: (A) account/application foundation, (B) backend enforcement readiness for the pilot workflows, and (C) immutable snapshot plus atomic cutover/rollback. Legacy stays read-only and active during A/B, then is disabled globally only after every required pilot action has passed positive and negative backend evidence.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Supabase/Postgres, RLS, governed RPCs, Edge Functions, SQL smoke tests, existing permission registry and governance services.

## Global Constraints

- Work only on branch `refactor/module-du-an-v1` unless the operator explicitly chooses another branch.
- The approved design is `docs/superpowers/specs/2026-07-20-vioo-system-admin-member-permission-model-design.md`.
- This program supersedes Legacy conversion tasks in `docs/superpowers/plans/2026-07-20-vioo-application-permission-workbench.md`; do not build a product-facing Legacy conversion panel.
- Do not stage, rewrite, or discard unrelated dirty files. At plan creation time these include the realtime permission-refresh work in `DirectUserPermissionWorkspace.tsx`, `AuthContext.tsx`, `authState.ts`, two tests, and `20260720110000_current_user_permission_grant_realtime.sql`.
- Do not run Cloud migrations, mutate Cloud users/grants, repair migration history, or enable rollout flags without a separate explicit approval for that exact operation.
- Use the exact `npx supabase migration new migration_name` command stated in each child-plan task. Do not invent timestamped migration filenames in advance.
- Browser clients never write membership, grant, audit, role, cutover, or Legacy authorization fields directly.
- RLS/RPC/private helpers are the enforcement boundary; UI hiding is supporting evidence only.
- Exactly one active System Admin coordinates accounts, application access, configuration, and permission grants.
- There is no Application Administrator role, assignment, access level, source, or UI control.
- System Admin can open every application and view business data across every project, warehouse, department, ownership, and assignment.
- System Admin's implicit authority is read-only plus an explicit configuration allowlist; every business mutation requires a separate permission.
- System Admin cannot self-grant or implicitly perform sensitive business actions.
- Application membership is a prerequisite, never a substitute, for business action + scope + assignment.
- `Role.WAREHOUSE_KEEPER` must be replaced by warehouse assignment and scoped WMS permissions before it is removed from the UI/resolver.
- Every permission action required by a pilot workflow must be `enforced` or `verified`; `declared` and `legacy` are cutover blockers.
- Use TDD. Each implementation task begins with a failing test or smoke assertion and ends with targeted verification plus a focused commit.

---

## Current-State Evidence (2026-07-20)

Read-only inventory establishes the planning baseline:

- Active accounts: `42` total — `1 ADMIN`, `36 EMPLOYEE`, `5 WAREHOUSE_KEEPER`.
- Active Legacy application assignments include `CHAT 40`, `HRM 39`, `DA 37`, `WF 26`, `WMS 23`, `HD 11`, `TS 10`, `EX 8`, `RQ 6`, `SETTINGS 5`, `EP 2`.
- No active `admin_modules` rows were returned, but Legacy `admin_sub_modules` remain in Project, Workflow, WMS, Contract, HRM, and Request.
- Current rollout flags: `legacy_fallback_disabled=false`, `business_role_resolver_enabled=false`.
- Permission readiness is incomplete. Notable totals: Project `135 declared / 25 legacy / 19 verified`; HRM `6 declared / 3 enforced / 2 legacy`; WMS `11 declared / 1 legacy`; Asset `2 declared / 16 enforced / 4 legacy`.
- The codebase still contains broad `Role.ADMIN`, SQL `is_admin()`, `is_module_admin(...)`, and `Role.WAREHOUSE_KEEPER` data paths.
- Project BOQ currently has separate `view/edit/delete` declarations, but `manage` remains Legacy and DELETE enforcement still accepts edit in at least one RLS path.
- The existing Direct Grant readiness guard rejects actions that are not `enforced` or `verified`; this guard must remain in force.

These numbers are evidence, not entitlement decisions. The target matrix must be approved user-by-user.

## Program Dependency Graph

```text
Plan A: Account + Application Foundation
  -> application catalog and membership commands
  -> exactly-one-System-Admin invariant and Member-only membership
  -> SYSTEM_ADMIN_VIEW and SYSTEM_ADMIN_CONFIGURATION resolver sources
  -> application prerequisite in route/backend helpers

Plan B: Permission Enforcement Readiness
  -> retire ADMIN / module-admin / keeper business-data shortcuts
  -> enforce required pilot actions per app
  -> approve immutable pilot entitlement manifest

Plan C: Hard Cutover + Recovery
  -> snapshot and fingerprint current Legacy state
  -> local/staging rehearsal
  -> atomic apply + Legacy disable
  -> user-by-user verification or tested rollback
```

Plan C may start its tooling implementation after Plan A schema stabilizes, but its production gate cannot pass until Plan B is complete.

## Child Plans

1. `docs/superpowers/plans/2026-07-20-vioo-account-application-foundation.md`
   - canonical app catalog and Member assignability;
   - governed membership Preview/Apply;
   - effective `SYSTEM_ADMIN_VIEW` and `SYSTEM_ADMIN_CONFIGURATION` sources;
   - two-role Base-style account/application UI;
   - realtime/session refresh;
   - account-disable and last-admin integration.

2. `docs/superpowers/plans/2026-07-20-vioo-permission-enforcement-readiness.md`
   - machine-readable readiness inventory;
   - application membership prerequisite;
   - Project/BOQ reference slice;
   - WMS keeper-role replacement;
   - removal of broad admin data bypasses;
   - per-app positive, wrong-scope, state, ownership, and adjacent-action tests;
   - approved pilot entitlement manifest.

3. `docs/superpowers/plans/2026-07-20-vioo-pilot-cutover-and-recovery.md`
   - immutable encrypted/off-repo snapshot export;
   - governed cutover Preview/Apply with fingerprint and idempotency;
   - rollback artifact and command;
   - local/staging rehearsals;
   - maintenance window, verification, monitoring, and rollback decision.

---

### Task 1: Verify Supersession and Protect the Approved Direction

**Files:**
- Modify: `docs/superpowers/plans/2026-07-20-vioo-application-permission-workbench.md`
- Test: documentation contract command below

- [ ] **Step 1: Verify the supersession notice beneath the old plan header**

The existing notice must remain:

```md
> **Superseded on 2026-07-20:** Tasks that build editable Legacy controls or
> Legacy conversion drafts must not be executed. The approved pilot hard-cutover
> program is `2026-07-20-vioo-pilot-hard-cutover-program.md`. Registry and
> backend-enforcement findings in this document remain useful inventory only.
```

- [ ] **Step 2: Verify no child plan requires a Legacy conversion UI**

Run:

```bash
rg -n "Legacy conversion panel|editable Legacy|convert Legacy" \
  docs/superpowers/plans/2026-07-20-vioo-{account-application-foundation,permission-enforcement-readiness,pilot-cutover-and-recovery}.md
```

Expected: no matches that instruct implementation of those features; references may only prohibit them.

- [ ] **Step 3: Commit the program-plan boundary**

```bash
git add \
  docs/superpowers/plans/2026-07-20-vioo-pilot-hard-cutover-program.md \
  docs/superpowers/plans/2026-07-20-vioo-account-application-foundation.md \
  docs/superpowers/plans/2026-07-20-vioo-permission-enforcement-readiness.md \
  docs/superpowers/plans/2026-07-20-vioo-pilot-cutover-and-recovery.md \
  docs/superpowers/plans/2026-07-20-vioo-application-permission-workbench.md
git commit -m "docs: plan pilot permission hard cutover"
```

---

### Task 2: Execute Plan A and Pass Foundation Gate

**Plan:** `docs/superpowers/plans/2026-07-20-vioo-account-application-foundation.md`

- [ ] **Step 1:** Implement every Plan A checkbox in order.
- [ ] **Step 2:** Run the Plan A final verification block.
- [ ] **Step 3:** Produce an aggregate-only foundation report containing active Member membership counts by application, no account PII.
- [ ] **Step 4:** Confirm all membership mutations use governed RPCs and audit events.
- [ ] **Step 5:** Confirm the sole System Admin receives all-app/global read-only access and only allowlisted configuration mutations, never business mutations by role alone.
- [ ] **Step 6:** Confirm membership removal revokes the app's active Direct Grants atomically and re-adding does not restore them.
- [ ] **Step 7:** Stop if any assertion fails; do not begin Plan B rollout work against an unstable foundation.

**Foundation exit gate:** local schema/tests pass, frontend contract passes, account lifecycle integration passes, and no Cloud mutation has occurred without approval.

---

### Task 3: Execute Plan B and Pass Enforcement Gate

**Plan:** `docs/superpowers/plans/2026-07-20-vioo-permission-enforcement-readiness.md`

- [ ] **Step 1:** Generate the current readiness/bypass inventories from code and database catalog.
- [ ] **Step 2:** Finish the Project BOQ reference slice and prove edit/delete independence.
- [ ] **Step 3:** Replace WMS keeper-role decisions with warehouse assignment + action permissions.
- [ ] **Step 4:** Replace broad administrator/module-admin mutation bypasses with explicit actions and relationships while retaining the reviewed System Admin SELECT/read-only path.
- [ ] **Step 5:** Complete per-app waves only for workflows that the approved pilot entitlement manifest requires.
- [ ] **Step 6:** Reject any manifest row whose permission is not `enforced` or `verified`.
- [ ] **Step 7:** Run all positive and required negative backend smokes.
- [ ] **Step 8:** Obtain operator approval of the user-by-user entitlement manifest fingerprint.

**Enforcement exit gate:** zero required manifest actions in `declared`/`legacy`; zero required runtime paths dependent on Legacy, broad admin, module-admin, or keeper-role bypass; every target scope has an assignment.

---

### Task 4: Execute Plan C Through Rehearsal Gate

**Plan:** `docs/superpowers/plans/2026-07-20-vioo-pilot-cutover-and-recovery.md`

- [ ] **Step 1:** Implement snapshot, Preview, Apply, status, rollback, and audit commands locally.
- [ ] **Step 2:** Run local empty-database and seeded-pilot tests.
- [ ] **Step 3:** Rehearse on an approved non-production environment using sanitized or controlled account data.
- [ ] **Step 4:** Prove rollback restores the exact pre-cutover fingerprint.
- [ ] **Step 5:** Produce the maintenance checklist and aggregate expected counts.
- [ ] **Step 6:** Request separate production cutover approval with exact migration hashes, manifest fingerprint, snapshot destination, commands, and rollback threshold.

**Rehearsal exit gate:** two successful rehearsals, one successful rollback rehearsal, no unresolved blocker, and explicit production approval.

---

### Task 5: Run the Single Pilot Maintenance Event

**Authorization:** This task is intentionally not pre-authorized by approving this plan. Execute only after the operator approves the exact production packet from Plan C.

- [ ] **Step 1:** Freeze account/permission administration and record the start time.
- [ ] **Step 2:** Verify database migration history and deployed application version match the approved packet.
- [ ] **Step 3:** Export the immutable Legacy snapshot and independently verify its fingerprint and account count.
- [ ] **Step 4:** Run cutover Preview; require zero blockers and exact manifest fingerprint.
- [ ] **Step 5:** Apply once with the approved idempotency key.
- [ ] **Step 6:** Verify application memberships, explicit grants, assignments, cleared Legacy sources, enabled fallback-disable flag, audit, and refresh events.
- [ ] **Step 7:** Run the operator checklist for System Admin global view, System Admin mutation denial, Member application access, project member, warehouse assignee, and sensitive-action denial.
- [ ] **Step 8:** Roll back immediately if a hard threshold in Plan C is met; otherwise end the freeze and monitor.

---

### Task 6: Retire Legacy Product Surfaces After Stabilization

**Files:**
- Modify: `components/permissions/DirectUserPermissionWorkspace.tsx`
- Modify: `components/permissions/UnifiedPermissionMatrix.tsx`
- Modify: `lib/permissions/unifiedPermissionViewModel.ts`
- Modify: `lib/permissions/permissionService.ts`
- Modify: `lib/permissions/authorizationGovernanceTypes.ts`
- Modify: `lib/permissions/authorizationGovernanceService.ts`
- Modify: `components/UserModal.tsx`
- Test: `lib/__tests__/applicationPermissionWorkbenchUiContract.test.tsx`
- Test: `lib/__tests__/unifiedPermissionViewModel.test.ts`
- Test: `lib/__tests__/permissionRouteRegistry.test.ts`

- [ ] **Step 1:** Write failing contract tests proving no editable Legacy inputs or conversion command render post-cutover.
- [ ] **Step 2:** Remove Legacy editing/conversion props and view-model branches; retain audit/snapshot evidence only in operational tooling.
- [ ] **Step 3:** Remove frontend Legacy authorization fallback and require effective membership/permission sources.
- [ ] **Step 4:** Keep database Legacy columns for the agreed rollback-retention window; do not drop them during the maintenance event.
- [ ] **Step 5:** After the retention window and separate approval, create a dedicated cleanup plan for column/function removal.
- [ ] **Step 6:** Run full verification and commit.

---

## Program Acceptance Criteria

- Exactly two operator-facing account roles: System Admin and Member, with exactly one active System Admin.
- There is no Application Administrator concept in the target database, resolver, command payload, UI, or cutover manifest.
- System Admin opens every application and can read all business data across all supported scopes.
- System Admin role cannot create, edit, delete, transition, export, or otherwise mutate business data.
- System Admin configuration mutations are restricted to the explicit `system_admin` permission group.
- A user without membership cannot open or call an app's protected operations.
- A user with membership but no matching action/scope/assignment cannot access business data.
- Every required pilot workflow has backend allow plus wrong-scope/ownership/state/adjacent-action denial evidence.
- WMS responsibilities no longer depend on `Role.WAREHOUSE_KEEPER`.
- Project BOQ edit cannot delete; delete requires `project.material_boq.delete`.
- Membership removal atomically revokes app grants and takes effect in active sessions.
- Cutover produces no effective `LEGACY` source and sets `legacy_fallback_disabled=true`.
- Snapshot, manifest, Preview, Apply, audit, refresh, and rollback fingerprints are traceable.
- Re-adding an app does not silently restore revoked permissions.
- No Legacy product administration surface remains after stabilization.

## Program Verification Commands

Run at the end of implementation, before requesting the production cutover:

```bash
npm test
npm run lint
npm run build
npx supabase db reset
npx supabase test db
rg -n "Role\.WAREHOUSE_KEEPER|current_user_is_(global_)?wms_keeper|is_module_admin\(|is_admin\(\)" \
  --glob '!docs/**' \
  --glob '!supabase/migrations_archive/**' \
  --glob '!supabase/migrations/20260720095234_remote_schema_baseline.sql'
```

Expected:

- tests, typecheck, build, local reset, and SQL tests pass;
- remaining grep matches are either account-administration checks, compatibility parsing covered by tests, or explicitly documented non-business exceptions;
- no remaining match grants scoped business data or sensitive actions solely because of account/app-admin status.

## Execution Handoff

Execute the child plans in this order:

1. `2026-07-20-vioo-account-application-foundation.md`
2. `2026-07-20-vioo-permission-enforcement-readiness.md`
3. `2026-07-20-vioo-pilot-cutover-and-recovery.md`

Use `superpowers:subagent-driven-development` for task-by-task work in the current session, or `superpowers:executing-plans` in a separate implementation session with review checkpoints. Never combine the production maintenance event with ordinary code implementation.

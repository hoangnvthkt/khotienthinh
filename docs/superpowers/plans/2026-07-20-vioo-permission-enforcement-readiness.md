# VIOO Permission Enforcement Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every permission required by the approved pilot entitlement set enforceable at the backend, remove broad role/module/keeper business-data bypasses, and produce a zero-blocker readiness fingerprint for hard cutover.

**Architecture:** Treat the permission registry as vocabulary, the database readiness state as the grantability gate, and RLS/RPC/private guards as the decision boundary. Each application wave starts from real pilot workflows, adds membership + action + scope + assignment enforcement, proves positive and four negative dimensions, then promotes only the proven codes. A machine-readable validator blocks the cutover manifest when any required code is Legacy/declared or any assignment is missing.

**Tech Stack:** TypeScript/Vitest, Supabase/Postgres/RLS/PLpgSQL, SQL smoke tests, existing permission registries and action services, project/warehouse/department/workflow assignment tables.

## Global Constraints

- Complete `2026-07-20-vioo-account-application-foundation.md` before applying membership prerequisites broadly.
- Keep `app_private.assert_unified_direct_grant_readiness` fail-closed; never bypass it to save a draft.
- Readiness is evidence, not a label chosen for UI convenience.
- Promote an action only after intended allow, wrong-scope denial, state/ownership denial, adjacent-action denial, and direct-API denial pass.
- A required pilot action in `legacy` or `declared` blocks cutover. Unused catalog actions may remain declared if no route/service grants them during the pilot.
- Do not make App Admin a shortcut for business CRUD, all records, project membership, warehouse responsibility, approval, payment, payroll, or stock adjustment.
- High-level Administrator business-data paths must use explicit permission + assignment like members. Account administration checks may still use the canonical high-level role.
- Replace `WAREHOUSE_KEEPER` behavior before relabelling the five existing accounts as Members.
- Every new migration is created with `npx supabase migration new`; do not hand-invent timestamped paths.
- Do not promote readiness in the same migration that first implements an operation. First pass behavior smoke, then use a separate promotion migration/smoke.
- Cloud testing/apply requires a separate approval packet; local planning and implementation do not authorize it.

---

## File Structure

**Create:**

- `scripts/authorization/permission-readiness-report.mjs`
- `scripts/authorization/validate-pilot-entitlement-manifest.mjs`
- `scripts/authorization/pilot-entitlement-manifest.schema.json`
- `docs/security/pilot-permission-readiness.md`
- `supabase/tests/application_membership_prerequisite_smoke.sql`
- `supabase/tests/project_material_boq_action_smoke.sql`
- `supabase/tests/wms_assignment_permissions_smoke.sql`
- `supabase/tests/pilot_permission_readiness_gate.sql`
- targeted app smoke files created by each wave.

**Modify as evidence requires:**

- `lib/permissions/permissionService.ts`
- `lib/permissions/projectPermissionService.ts`
- `lib/permissions/projectMaterialPermissions.ts`
- `lib/wmsPermissions.ts`
- `lib/homeCapabilities.ts`
- `context/AppContext.tsx`
- `components/Sidebar.tsx`
- application pages/services that mutate protected data
- Supabase policies, RPCs, private helpers, triggers through new migrations
- existing phase smoke tests when extending an already-owned action contract

---

### Task 1: Generate Reproducible Readiness and Bypass Inventories

**Files:**
- Create: `scripts/authorization/permission-readiness-report.mjs`
- Create: `docs/security/pilot-permission-readiness.md`
- Test: `lib/__tests__/pilotPermissionReadinessReport.test.ts`

- [ ] **Step 1: Write a failing report contract test**

The test supplies fixture rows and expects deterministic Markdown/JSON grouped by application with counts for `legacy`, `declared`, `enforced`, `verified`, plus source references for frontend guards and SQL bypasses.

- [ ] **Step 2: Implement the report script**

Inputs:

```text
--permission-actions-json <exported aggregate rows>
--code-inventory-json <rg-generated references>
--output <markdown path>
```

The script must not require or emit user identities. It fails on unknown readiness values, duplicate permission codes, or a required field missing.

- [ ] **Step 3: Generate code bypass inputs**

```bash
mkdir -p .tmp/authorization-readiness
rg -n "Role\.ADMIN|Role\.WAREHOUSE_KEEPER|is_admin\(\)|is_module_admin\(|current_user_is_(global_)?wms_keeper" \
  --glob '!docs/**' \
  --glob '!supabase/migrations_archive/**' \
  --glob '!supabase/migrations/20260720095234_remote_schema_baseline.sql' \
  > .tmp/authorization-readiness/bypass-references.txt
```

Convert only path/line/token category to JSON; do not include source lines that may contain sensitive values.

- [ ] **Step 4: Export aggregate readiness**

Use a read-only query against the approved environment:

```sql
select split_part(permission_code, '.', 1) as application,
       grant_readiness,
       count(*) as action_count
from public.permission_actions
where is_active
group by 1, 2
order by 1, 2;
```

For actionable rows, export `permission_code`, `grant_readiness`, `risk_level`, `is_business_approval`, and `scope_modes`; never export principal/grant rows into the repo.

- [ ] **Step 5: Generate and test the report**

```bash
npm test -- lib/__tests__/pilotPermissionReadinessReport.test.ts
node scripts/authorization/permission-readiness-report.mjs \
  --permission-actions-json .tmp/authorization-readiness/actions.json \
  --code-inventory-json .tmp/authorization-readiness/bypasses.json \
  --output docs/security/pilot-permission-readiness.md
```

- [ ] **Step 6: Commit only aggregate evidence**

```bash
git add scripts/authorization/permission-readiness-report.mjs docs/security/pilot-permission-readiness.md lib/__tests__/pilotPermissionReadinessReport.test.ts
git commit -m "test: inventory pilot permission readiness"
```

---

### Task 2: Enforce Application Membership as a Common Prerequisite

**Files:**
- Modify: `lib/permissions/permissionService.ts`
- Modify: `lib/permissions/applicationAccessCatalog.ts`
- Modify: route guards in the existing app shell
- Create: `supabase/tests/application_membership_prerequisite_smoke.sql`
- Create via CLI: migration named `application_membership_prerequisite`
- Test: `lib/__tests__/applicationMembershipPrerequisite.test.ts`
- Test: `lib/__tests__/permissionRouteRegistry.test.ts`

- [ ] **Step 1: Write frontend failures**

Prove:

- a Direct Grant without app membership cannot open a route or pass `canPerform`;
- membership without action cannot pass `canPerform`;
- membership + action can pass only for a compatible scope;
- High-level Administrator can open customization routes but not business routes without required action/assignment;
- unknown protected routes deny by default.

- [ ] **Step 2: Write backend failures**

The SQL smoke creates two users with identical grants/scopes but only one app membership. Direct SELECT, public RPC, and mutation must deny the non-member.

- [ ] **Step 3: Implement a shared authorization predicate**

Private helper shape:

```sql
app_private.user_has_permission_in_application(
  p_user_id uuid,
  p_application_code text,
  p_permission_code text,
  p_scope_type text,
  p_scope_id text
) returns boolean
```

It requires active account, application access, active effective permission, and scope match. Application-specific helpers add relationship/workflow checks.

- [ ] **Step 4: Integrate frontend navigation and service checks**

Add `applicationMemberships`/effective app access to the authenticated user state. Do not infer membership from Legacy arrays once a new membership snapshot is present. During pre-cutover compatibility, Legacy may keep old routes functioning only for users not yet staged; tests must distinguish the two modes.

- [ ] **Step 5: Protect against permission-code/app mismatch**

Reject a request where `project.*` is evaluated under `wms`, including malformed/unknown codes.

- [ ] **Step 6: Verify and commit**

```bash
npm test -- lib/__tests__/applicationMembershipPrerequisite.test.ts lib/__tests__/permissionRouteRegistry.test.ts lib/__tests__/permissionService.test.ts
npx supabase db reset
npx supabase test db supabase/tests/application_membership_prerequisite_smoke.sql
git add lib/permissions/permissionService.ts lib/permissions/applicationAccessCatalog.ts lib/__tests__/applicationMembershipPrerequisite.test.ts lib/__tests__/permissionRouteRegistry.test.ts supabase/migrations/*_application_membership_prerequisite.sql supabase/tests/application_membership_prerequisite_smoke.sql
git commit -m "feat: require application membership for permissions"
```

---

### Task 3: Make Project BOQ the Golden Fine-grained Slice

**Files:**
- Modify: `lib/permissions/projectPermissionRegistry.ts`
- Modify: `lib/permissions/projectMaterialPermissions.ts`
- Modify: `pages/project/MaterialTab.tsx`
- Create: `supabase/tests/project_material_boq_action_smoke.sql`
- Create via CLI: migration named `project_material_boq_action_guards`
- Test: `lib/__tests__/materialPermissions.phase3.test.ts`

**Required action contract:**

```text
project.material_boq.view
project.material_boq.edit
project.material_boq.delete
project.material_boq.manage
```

- [ ] **Step 1: Write failing frontend/service tests**

Prove view sees BOQ, edit mutates but cannot delete, delete deletes but cannot edit, manage opens BOQ configuration only, and no action works outside `project_staff` plus matching project/site scope.

- [ ] **Step 2: Write failing backend smoke**

For each code, cover intended allow, no-membership denial, wrong-project denial, no-project-staff denial, adjacent-action denial, and direct table/API denial.

- [ ] **Step 3: Split DELETE from EDIT in RLS/private helpers**

Remove every policy/helper branch where BOQ delete accepts `project.material_boq.edit`. Delete must require `.delete`; edit/update must require `.edit`. `manage` must not imply either.

- [ ] **Step 4: Define BOQ manage precisely**

Bind `.manage` only to real BOQ configuration/import-mapping/catalog operations. If no distinct operation exists, remove it from the pilot UI instead of mapping it to all CRUD.

- [ ] **Step 5: Run behavior smoke without changing readiness**

```bash
npx supabase db reset
npx supabase test db supabase/tests/project_material_boq_action_smoke.sql
npm test -- lib/__tests__/materialPermissions.phase3.test.ts
```

- [ ] **Step 6: Create a separate readiness promotion migration**

After behavior passes, create `project_material_boq_readiness`, update only the proven codes from `declared/legacy` to `verified`, and add a promotion smoke that asserts no other code changed.

- [ ] **Step 7: Verify and commit in two commits**

```bash
git add lib/permissions/projectPermissionRegistry.ts lib/permissions/projectMaterialPermissions.ts pages/project/MaterialTab.tsx supabase/migrations/*_project_material_boq_action_guards.sql supabase/tests/project_material_boq_action_smoke.sql lib/__tests__/materialPermissions.phase3.test.ts
git commit -m "fix: enforce independent BOQ actions"

git add supabase/migrations/*_project_material_boq_readiness.sql supabase/tests/project_material_boq_readiness_smoke.sql
git commit -m "test: verify project BOQ permission readiness"
```

---

### Task 4: Build and Validate the Pilot Entitlement Manifest Format

**Files:**
- Create: `scripts/authorization/pilot-entitlement-manifest.schema.json`
- Create: `scripts/authorization/validate-pilot-entitlement-manifest.mjs`
- Test: `lib/__tests__/pilotEntitlementManifest.test.ts`

**Artifact rule:** The real manifest contains user IDs and business assignments, so it is encrypted and stored outside Git. Only its JSON Schema, validator, aggregate report, and SHA-256 fingerprint enter the repository/audit packet.

**Manifest shape:**

```json
{
  "version": 1,
  "generatedAt": "RFC3339",
  "users": [{
    "userId": "uuid",
    "accountRole": "MEMBER",
    "applications": [{"applicationCode":"project","accessLevel":"MEMBER"}],
    "grants": [{
      "permissionCode":"project.material_boq.view",
      "scopeType":"project",
      "scopeId":"project-id",
      "expiresAt": null,
      "reason":"Pilot entitlement rebuild"
    }],
    "assignmentAssertions": [{
      "kind":"project_staff",
      "subjectId":"project-id"
    }]
  }]
}
```

- [ ] **Step 1: Write validator failures**

Reject duplicate users/apps/grants, unknown app/code/scope, inactive user, missing membership, App Admin without membership, sensitive self-grant, missing expiry/reason where required, missing assignment assertion, and any action not `enforced`/`verified`.

- [ ] **Step 2: Implement offline structural validation**

Use existing Node dependencies only. Output normalized JSON to stdout only when `--normalized-output` is explicitly supplied; default output is aggregate counts and fingerprint.

- [ ] **Step 3: Implement DB-backed validation mode**

`--readiness-json` and `--assignments-json` consume read-only exported evidence. Never embed service keys or fetch Cloud data inside the script.

- [ ] **Step 4: Verify deterministic fingerprints**

Sort users, applications, grants, and assertions before SHA-256. Equivalent ordering must produce the same fingerprint.

- [ ] **Step 5: Commit**

```bash
npm test -- lib/__tests__/pilotEntitlementManifest.test.ts
git add scripts/authorization/pilot-entitlement-manifest.schema.json scripts/authorization/validate-pilot-entitlement-manifest.mjs lib/__tests__/pilotEntitlementManifest.test.ts
git commit -m "feat: validate pilot entitlement manifest"
```

---

### Task 5: Replace Warehouse Keeper Role with WMS Assignment + Actions

**Files:**
- Modify: `lib/wmsPermissions.ts`
- Modify: `context/AppContext.tsx`
- Modify: `lib/homeCapabilities.ts`
- Modify: WMS pages/services using keeper checks
- Create: `supabase/tests/wms_assignment_permissions_smoke.sql`
- Create via CLI: migration named `wms_assignment_permission_guards`
- Test: `lib/__tests__/wmsPermissions.phase4.test.ts`

- [ ] **Step 1: Inventory every keeper decision**

```bash
rg -n "WAREHOUSE_KEEPER|current_user_is_(global_)?wms_keeper|assignedWarehouseId|assigned_warehouse_id" \
  context lib pages components supabase/migrations/20260720095234_remote_schema_baseline.sql \
  > .tmp/authorization-readiness/wms-keeper-paths.txt
```

Classify each path as assignment, action, ownership, compatibility parser, or obsolete.

- [ ] **Step 2: Write failing WMS contracts**

For view/approve/export/receive/complete, prove:

- warehouse assignment alone does not imply every action;
- matching action without warehouse assignment does not access warehouse data;
- assignment + action works only for the assigned warehouse;
- global WMS access requires explicit global scope, not `assignedWarehouseId=null`;
- High-level Administrator/App Admin has no automatic stock action;
- creator/owner self-service remains only where explicitly designed.

- [ ] **Step 3: Introduce canonical warehouse responsibility**

If the current single `users.assigned_warehouse_id` cannot represent multiple assignments or history, add an audited `warehouse_user_assignments` relation with ACTIVE/REVOKED status and governed commands. If one warehouse is a confirmed invariant for the pilot, keep the column temporarily but make it a relationship input, never a role predicate. Record the choice in `docs/security/pilot-permission-readiness.md`.

- [ ] **Step 4: Replace frontend keeper shortcuts**

Refactor `canApproveWmsTransaction`, `canReceiveWmsTransaction`, `canViewWmsTransaction`, material request helpers, and AppContext assignee resolution to use assignment + `wms.*` permission codes.

- [ ] **Step 5: Replace SQL keeper shortcuts**

Change policies/RPC guards that call `current_user_is_global_wms_keeper` or `current_user_is_wms_keeper_for` to explicit membership, WMS action, warehouse scope, and responsibility checks.

- [ ] **Step 6: Migrate five active keeper accounts in the cutover manifest**

Do not mutate them yet. The encrypted manifest assigns account role MEMBER, WMS membership, exact WMS action grants, and warehouse/global scopes supported by approved responsibilities.

- [ ] **Step 7: Verify behavior, then promote proven WMS codes separately**

```bash
npm test -- lib/__tests__/wmsPermissions.phase4.test.ts
npx supabase db reset
npx supabase test db supabase/tests/wms_assignment_permissions_smoke.sql
```

Create a separate `wms_assignment_permission_readiness` migration/smoke for only proven codes.

- [ ] **Step 8: Commit behavior and promotion separately**

```bash
git add \
  lib/wmsPermissions.ts \
  lib/homeCapabilities.ts \
  context/AppContext.tsx \
  components/ReceiveFulfillmentBatchModal.tsx \
  components/RequestModal.tsx \
  components/Sidebar.tsx \
  pages/Dashboard.tsx \
  pages/Home.tsx \
  pages/Operations.tsx \
  pages/project/MaterialTab.tsx \
  pages/project/SupplyChainTab.tsx \
  pages/request/RequestCategories.tsx \
  pages/wf/WorkflowBuilder.tsx \
  supabase/migrations/*_wms_assignment_permission_guards.sql \
  supabase/tests/wms_assignment_permissions_smoke.sql \
  lib/__tests__/wmsPermissions.phase4.test.ts
git commit -m "refactor: replace warehouse keeper role checks"
git add supabase/migrations/*_wms_assignment_permission_readiness.sql supabase/tests/wms_assignment_permission_readiness_smoke.sql
git commit -m "test: verify WMS assignment permission readiness"
```

---

### Task 6: Complete the Project Pilot Workflow Wave

**Files:**
- Modify: `lib/permissions/projectPermissionRegistry.ts`
- Modify: relevant `pages/project/**`, `lib/permissions/project*`, and RPC/RLS migrations
- Modify/create targeted `supabase/tests/phase3_*_permissions_smoke.sql`
- Modify: `docs/security/phase02-task3-permission-readiness-matrix.md`

- [ ] **Step 1: Extract only Project codes required by the approved manifest**

Run the manifest validator in aggregate mode and save the sorted code list/fingerprint without user IDs.

- [ ] **Step 2: Partition into operation-owned slices**

Use these boundaries:

```text
core/org: master, overview, org, executive
delivery: daily_log, gantt, weekly_progress
materials: material_request, material_plan, material_boq, material_po, material_waste, custom_material
commercial: contract, contract_item, contract_variation, subcontract, payment, quantity_acceptance, cashflow, budget
compliance: quality, safety, documents, report, dashboard
```

Do not make one migration edit unrelated policy families.

- [ ] **Step 3: For each required code, bind a real operation**

Record table/RPC/Edge Function, route/control, supported scopes, assignment rule, workflow preconditions, and adjacent actions in `docs/security/pilot-permission-readiness.md`. Codes with no real operation are removed from the manifest, not marked verified.

- [ ] **Step 4: Implement TDD slice by slice**

Each slice follows:

1. failing frontend/service test;
2. failing rollback-only SQL smoke;
3. private guard/RPC/RLS implementation;
4. intended allow;
5. wrong project/site denial;
6. missing project_staff denial;
7. invalid state/ownership denial;
8. adjacent-action denial;
9. separate readiness promotion migration;
10. focused commit.

- [ ] **Step 5: Resolve known blockers explicitly**

Do not leave these ambiguous:

- `project.material_request.confirm` vs `confirm_fulfillment` code mismatch;
- missing operations for daily-log confirm, project contract/quality/safety/subcontract/weekly approvals where the manifest requires them;
- payment `mark_paid` versus confirm semantics;
- all broad `is_admin()`/`is_module_admin('DA')` paths;
- Project registry/database module mismatch for direct purchase and supplier delivery.

- [ ] **Step 6: Run Project gate**

```bash
npm test -- lib/__tests__/projectPermissionService.test.ts lib/__tests__/materialPermissions.phase3.test.ts lib/__tests__/permissionRegistry.test.ts
npx supabase test db supabase/tests/phase2_project_pbac_v2_smoke.sql
npx supabase test db supabase/tests/phase3_project_core_smoke.sql
npx supabase test db supabase/tests/phase3_project_org_assignment_smoke.sql
npx supabase test db supabase/tests/phase3_daily_log_permissions_smoke.sql
npx supabase test db supabase/tests/phase3_material_permissions_smoke.sql
npx supabase test db supabase/tests/phase3_payment_contract_permissions_smoke.sql
npx supabase test db supabase/tests/phase3_quality_safety_documents_smoke.sql
```

Expected: all required manifest Project codes are enforced/verified; unused declarations may remain declared and absent from the manifest.

---

### Task 7: Complete Non-Project Application Waves

**Files:**
- Modify app registries, pages/services, and new migrations per wave
- Extend/create app SQL smokes
- Modify: `docs/security/pilot-permission-readiness.md`

Run these waves in active-pilot prevalence/risk order:

1. HRM (`39` Legacy app assignments): employee, attendance, leave, payroll, master data.
2. Workflow (`26`): instance own/assigned actions; template customization.
3. WMS (`23`): completed in Task 5, plus any manifest gaps.
4. Contract (`11`), Asset (`10`), Expense (`8`), Request (`6`).
5. Chat (`40`) and low-risk shell/member operations.
6. Storage, KB, AI, Analytics, Settings only where required by the manifest.

For each wave:

- [ ] **Step 1:** Extract required codes/scopes from the manifest aggregate.
- [ ] **Step 2:** Map every code to actual frontend control and backend operation.
- [ ] **Step 3:** Add application membership prerequisite.
- [ ] **Step 4:** Add assignment/ownership/scope/workflow checks.
- [ ] **Step 5:** Remove role/module-admin business-data bypasses.
- [ ] **Step 6:** Run intended allow plus four negative dimensions.
- [ ] **Step 7:** Promote proven codes in a separate migration.
- [ ] **Step 8:** Update aggregate readiness report and commit the wave.

Minimum existing smokes to preserve/extend:

```bash
npx supabase test db supabase/tests/hrm_employee_permission_guards_smoke.sql
npx supabase test db supabase/tests/phase4_global_modules_enforcement_smoke.sql
npx supabase test db supabase/tests/phase4_ai_kb_storage_analytics_smoke.sql
npx supabase test db supabase/tests/chat_v2_user_access_smoke.sql
npx supabase test db supabase/tests/phase5_readiness_smoke.sql
```

Sensitive HRM payroll, stock adjustment, financial approval, permission administration, and equivalent actions require explicit High-level Admin grant authority, no self-grant, reason, expiry where policy requires, and SoD evidence.

---

### Task 8: Remove Broad Administrator Business-Data Bypasses

**Files:**
- Modify: `lib/permissions/permissionService.ts`
- Modify: `lib/wmsPermissions.ts`
- Modify: affected pages/services
- Create via multiple operation-owned migrations; never one unreviewable global search/replace migration
- Test: `lib/__tests__/highLevelAdminBusinessBoundary.test.ts`
- Create: `supabase/tests/high_level_admin_business_boundary_smoke.sql`

- [ ] **Step 1: Write the global boundary test**

An ADMIN/App Admin can administer accounts/apps/customization, but cannot view/mutate an unassigned project, warehouse, HRM department record, workflow item, or sensitive approval by role alone.

- [ ] **Step 2: Classify all bypass references**

Allowed categories:

- account/session/application administration;
- catalog/customization operations explicitly tagged `app_admin`;
- emergency operations separately governed and audited.

Everything else must be replaced with explicit action + relationship.

- [ ] **Step 3: Remove frontend `Role.ADMIN -> all permission codes`**

In `permissionService.ts`, stop returning every action for ADMIN. Consume the backend effective sources: APP_ADMIN for customization, Direct/Role for business actions.

- [ ] **Step 4: Replace SQL data bypasses operation by operation**

For each `is_admin()`/`is_module_admin(...)` path, add a negative smoke before changing it. Keep account authority checks where appropriate; remove business-data shortcuts.

- [ ] **Step 5: Prove sensitive boundaries**

Cover no self-grant, no implicit approval, wrong scope, missing assignment, invalid workflow state, and SoD conflict.

- [ ] **Step 6: Run the residual scan**

```bash
rg -n "Role\.ADMIN|is_admin\(\)|is_module_admin\(" \
  --glob '!docs/**' \
  --glob '!supabase/migrations_archive/**' \
  --glob '!supabase/migrations/20260720095234_remote_schema_baseline.sql'
```

Every remaining occurrence must be listed with its allowed category in `docs/security/pilot-permission-readiness.md`. Unclassified matches fail the gate.

- [ ] **Step 7: Verify and commit per operation family**

```bash
npm test -- lib/__tests__/highLevelAdminBusinessBoundary.test.ts
npx supabase test db supabase/tests/high_level_admin_business_boundary_smoke.sql
```

---

### Task 9: Implement the Database Cutover Readiness Gate

**Files:**
- Create via CLI: migration named `pilot_permission_readiness_gate`
- Create: `supabase/tests/pilot_permission_readiness_gate.sql`

**Public read-only wrapper:**

```sql
public.preview_pilot_permission_readiness(p_manifest jsonb) returns jsonb
```

- [ ] **Step 1: Write failing gate cases**

Reject inactive/unknown user, last-admin absence, unknown app/action, missing membership, declared/legacy action, unsupported scope, missing assignment, sensitive self-grant, missing expiry/reason, duplicate row, and a required app with no gateway/view action.

- [ ] **Step 2: Implement private validator**

Return only aggregate counts, sorted blockers, and normalized manifest fingerprint. Never return another user's raw grants to an unauthorized caller.

- [ ] **Step 3: Cross-check offline and database fingerprints**

The Node validator and DB validator must compute the same fingerprint for the normalized fixture.

- [ ] **Step 4: Prove zero mutation**

Snapshot membership/grant/audit counts before Preview and assert they are identical after.

- [ ] **Step 5: Verify and commit**

```bash
npx supabase db reset
npx supabase test db supabase/tests/pilot_permission_readiness_gate.sql
npm test -- lib/__tests__/pilotEntitlementManifest.test.ts
git add supabase/migrations/*_pilot_permission_readiness_gate.sql supabase/tests/pilot_permission_readiness_gate.sql
git commit -m "feat: gate pilot permission cutover readiness"
```

---

## Enforcement Final Gate

With the encrypted approved manifest supplied locally through a protected path:

```bash
node scripts/authorization/validate-pilot-entitlement-manifest.mjs \
  --manifest "$VIOO_PILOT_MANIFEST_PATH" \
  --readiness-json .tmp/authorization-readiness/actions.json \
  --assignments-json .tmp/authorization-readiness/assignments.json
npm test
npm run lint
npm run build
npx supabase db reset
npx supabase test db
```

The operator sets `VIOO_PILOT_MANIFEST_PATH` to an explicit protected file; never default it to `$HOME`, a repository file, or a glob.

Exit criteria:

- validator returns zero blockers and one stable manifest SHA-256;
- all required action codes are `enforced` or `verified`;
- all required app memberships/scopes/assignments are valid;
- Project BOQ edit/delete are independent;
- no active pilot decision relies on `Role.WAREHOUSE_KEEPER`;
- no active pilot business-data path relies solely on ADMIN/App Admin/module-admin;
- frontend and backend test suites pass;
- residual bypass references are classified and non-business;
- aggregate readiness report is current;
- no Cloud mutation occurred without separate approval.

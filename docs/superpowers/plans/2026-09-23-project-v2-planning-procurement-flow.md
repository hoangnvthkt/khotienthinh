# Project V2 Planning and Procurement Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Do not use sub-agents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parallel Project V2 workspace in which the site turns the approved baseline schedule into monthly and weekly construction plans, derives material plans from approved construction work, and sends approved material-plan demand directly to a document-first Procurement V2 flow that can create traceable purchase orders.

**Architecture:** Keep the current Project and Procurement modules operational. Project V2 gets a separate cohort, routes, planning aggregate, workflow, and UI, while reusing existing project/contract/BOQ/inventory identities and the G1–G9 authorization, procurement demand, allocation, PO, WMS, finance, and lineage foundations. An approved V2 material plan is registered with the existing canonical `material_plan` source adapter and produces a ready procurement demand atomically; it never creates a PO, stock movement, receipt, or payable by approval alone.

**Tech Stack:** React 18, TypeScript 5.8, React Router 6, Tailwind utility classes and existing `components/erp` primitives, Supabase Cloud/PostgreSQL, Vitest 4, Playwright 1.60, Vite 6.

**Spec:** `docs/designs/erp-completion-2026-09-19/project-planning-workflow-20260922.md`

**UX reference:** `docs/references/vioo-project-v2-codex-handoff/docs/02_BEHAVIOR_SPEC.md`, `docs/references/vioo-project-v2-codex-handoff/prototype-source/app/workspace.tsx`, and `docs/references/vioo-project-v2-codex-handoff/references/06-v2-overview.jpg`.

## Global Constraints

- G1–G9 stay implemented and are reused; this plan must not re-plan or replace their authoritative services.
- Current routes `/da` and `/procurement` remain available and behavior-compatible. New routes are `/project-v2` and `/procurement-v2`.
- One branch and one worktree only. Preserve all existing dirty changes and never touch, stage, restore, or commit `docs/audits/erp-end-to-end-2026-09-19/README.md`.
- Do not use sub-agents and do not use the taste skill.
- All Supabase work uses the configured Cloud project through `.env`; never use local Supabase or Docker.
- Use `npx --no-install supabase migration new <name>` to create each migration. Never invent a migration timestamp and never edit an applied migration.
- Do not apply a migration to production, deploy, enable a production cohort, push, merge, or create production sample data without a separate explicit instruction.
- Use `numeric(20,6)` and canonical six-decimal strings at RPC boundaries for quantities and conversion factors. Currency snapshots use the existing project/contract currency semantics and must not be derived from a mutable catalog price after approval.
- `null`, unknown, denied, failed, and numeric zero are distinct states. UI, aggregation, CSV, and tests must never coerce unknown to zero.
- Server code obtains actor, scope, approval state, source revision/hash, permissions, and totals authoritatively. The client cannot assert actor identity, approval evidence, project membership, price visibility, or remaining quantity.
- Approved plan revisions are immutable. Corrections create a new revision; they do not edit the approved snapshot in place.
- Project V2 forbids self-approval: the actor approving a plan cannot be its creator or submitter. The first release has no silent admin bypass; any future override requires a separate audited policy.
- Approving a material plan creates or updates one canonical procurement demand idempotently. It does not create a second material request and does not create downstream commercial or accounting effects.
- Independent site material requests continue through `project_material_request` and appear beside approved material plans in Procurement V2 as a different source type.
- The existing rejected Workbench UI patch is not the target design. New V2 UI lives in new files; do not rewrite `pages/procurement/ProcurementWorkbench.tsx` or its components as part of this plan.
- Use the existing Vioo app shell and `components/erp` primitives. Do not copy the prototype's Next.js/shadcn shell, hardcoded demo data, `Date.now()` IDs, client-side approval, silent `Math.min` clipping, or fixed KPI values.
- Every UI slice must distinguish loading, empty, filtered-empty, denied, error, stale/conflict, unknown, pending, and success where applicable and must be walked through at 390px, 768px, and 1440px plus 200% zoom.
- Automation proves technical behavior only. Pilot acceptance still requires named business users and evidence; it is not inferred from passing tests.

## Review Focus

1. **Overlapping sources:** the same monthly quantity must not be consumed twice by two construction plans, and the same derived material need must not be published twice by two material plans; the user must see the source conflict rather than a clipped number.
2. **Unknown norms or conversions:** missing material identity, norm revision, UOM conversion, inventory item, required date, or destination blocks approval/intake for that line and renders “Chưa xác định”, never `0`.
3. **Revision after downstream commitment:** when an approved material plan already has reserved/committed/fulfilled quantities, a lower replacement revision must enter reconciliation and may not silently shrink or delete the existing demand, PO, receipt, or payable lineage.
4. **Mixed source types in one PO:** MR-backed demand keeps exact request-line links, material-plan-backed demand uses canonical demand/allocation lineage without fabricated MR links, and a mixed PO remains traceable line by line.
5. **Authorization and stale sessions:** list counts, plan contents, price fields, actions, exports, comments, and deep links must be scoped server-side; revoked or stale users receive denial/conflict, not empty data or successful UI-only actions.

---

## Product and data boundaries

### Product surfaces

| Surface | Route | First user question answered | Primary action |
| --- | --- | --- | --- |
| Project V2 overview | `/project-v2` | “Dự án này đang có kế hoạch nào cần lập hoặc duyệt?” | Tạo kế hoạch |
| Plan detail | `/project-v2/plans/:planId` | “Kỳ này làm gì, lấy từ đâu, ai chịu trách nhiệm?” | Action allowed by current state |
| Procurement V2 inbox | `/procurement-v2` | “Hồ sơ nào đã được duyệt và Mua hàng cần xử lý?” | Mở hồ sơ |
| Procurement V2 dossier | `/procurement-v2/demands/:demandId` | “Còn phải bố trí bao nhiêu và bước tiếp theo là gì?” | Lập phương án cung ứng |
| Purchase draft | dialog/drawer from dossier | “Dòng nào mua, mua bao nhiêu, của NCC nào, giao khi nào?” | Tạo PO nháp |

The sidebar may show “Dự án V2” and “Mua hàng V2” as separate app entries, but authorization continues to use the existing `DA` and `PROCUREMENT` module foundations plus scoped Project V2 plan permissions. This avoids duplicating the authorization system merely to create a parallel experience.

### Planning chain

```text
Baseline schedule / linked contract BOQ
        ↓ selected work and target quantity
Approved monthly plan
        ↓ selected work, dates, and crew
Approved construction plan (week or custom period)
        ↓ work quantity × versioned material norm × explicit UOM conversion
Approved material plan
        ↓ canonical `material_plan` demand intake
Procurement V2 dossier
        ↓ stock / transfer / existing contract / external purchase decision
PO only for quantities actually purchased externally
```

### Reuse versus new work

| Capability | Reuse | New work |
| --- | --- | --- |
| Project, site, contract item, task, BOQ, inventory identity | Existing tables and services | V2 cohort mapping and source readers |
| Authorization | Existing module guards, project scope, Room action model | V2 plan-type permission entries and command guards |
| Quantity/revision/lineage | G2 registry, revision, demand, allocation | V2 plan revisions and exact plan-line source links |
| BOQ/material norms | `contract_item_resources`, `material_budget_items`, G8 norm mappings | One authoritative candidate adapter with missing-data diagnostics |
| Purchase order creation | G5 atomic PO allocation and existing PO aggregate | Generalize request-link handling for `material_plan` source lines |
| WMS, AP, finance, management lineage | G6–G8 | No new posting engine |
| Pilot controls | G9 | Separate V2 cohort and rollout evidence |

---

## File map

### Shared contracts and domain

- Create `types/projectV2.ts`: project cohort, plan, line, source, revision, workflow, candidate, comment, activity, capability, and command DTOs.
- Create `types/procurementV2.ts`: document-level inbox, dossier, line, and purchase-draft DTOs.
- Create `lib/projectV2/planDomain.ts`: pure state machine, plan-type validation, line grouping, source-allocation checks, and material derivation rules.
- Create `lib/projectV2/presentation.ts`: Vietnamese status, quantity, source, and next-action presentation with explicit unknown states.
- Create `lib/projectV2/readService.ts`: strict RPC response mapping for workspaces, list/detail, candidates, comments, and activity.
- Create `lib/projectV2/commandService.ts`: save/submit/return/approve/revise/cancel/delete-draft/comment command calls.
- Create `lib/projectV2/queryState.ts`: parse/serialize project, plan type, status, search, period, sort, and page state.
- Create `lib/procurement/procurementV2Service.ts`: document-level inbox/detail calls and typed PO-draft submission.
- Create `lib/procurement/procurementV2Presentation.ts`: buyer-facing source/status/quantity labels.
- Create `lib/procurement/procurementPurchaseDraft.ts`: pure line selection, supplier grouping, conversion, and request-link partitioning.

### Project V2 UI

- Create `pages/project-v2/ProjectV2Workspace.tsx`: route container, project picker, overview/list, filters, KPI provenance, and create flow.
- Create `pages/project-v2/ProjectV2PlanDetail.tsx`: detail loader, dirty guard, actions, tabs, and source/related-plan navigation.
- Create `components/project-v2/ProjectV2Shell.tsx`: compact project header, flow navigation, responsive layout, and state surfaces.
- Create `components/project-v2/ProjectV2PlanList.tsx`: document-first plan table/cards.
- Create `components/project-v2/ProjectV2CreatePlanDialog.tsx`: two-step plan header and source selection flow.
- Create `components/project-v2/ProjectV2SourcePicker.tsx`: approved-source candidates, search, selection, available quantity, and blocking reasons.
- Create `components/project-v2/MonthPlanEditor.tsx`: monthly contract-production lines.
- Create `components/project-v2/ConstructionPlanEditor.tsx`: weekly/custom-period work, dates, and crew.
- Create `components/project-v2/MaterialPlanEditor.tsx`: material quantity/date/destination editor with a “Cơ sở tính toán” drawer.
- Create `components/project-v2/ProjectV2PlanWorkflowActions.tsx`: capability-driven save/submit/return/approve/revise/delete actions.
- Create `components/project-v2/ProjectV2PlanDiscussion.tsx` and `ProjectV2PlanActivity.tsx`: persisted collaboration and audit views.

### Procurement V2 UI

- Create `pages/procurement-v2/ProcurementV2Inbox.tsx`: document inbox with source type, project, required date, owner, status, and next action.
- Create `pages/procurement-v2/ProcurementV2DemandDetail.tsx`: source header, material lines, balance, issues, assignments, and linked documents.
- Create `components/procurement-v2/ProcurementV2Filters.tsx`: search/project/source/status/date filters.
- Create `components/procurement-v2/ProcurementV2DossierList.tsx`: desktop table and mobile cards.
- Create `components/procurement-v2/ProcurementV2DemandLines.tsx`: approved/arranged/remaining/required date/destination with unknown-safe display.
- Create `components/procurement-v2/ProcurementV2SupplyDialog.tsx`: supply method choices; only server-supported methods are enabled.
- Create `components/procurement-v2/ProcurementV2PurchaseDialog.tsx`: line selection, supplier, quantity, price visibility, delivery date, and confirmation.

### Existing integration files

- Modify `App.tsx`: lazy routes for Project V2 and Procurement V2.
- Modify `constants/routes.ts`: map V2 list and dynamic detail routes to existing `DA`/`PROCUREMENT` authorization foundations.
- Modify `components/Sidebar.tsx`: separate V2 app entries while using explicit permission keys `DA` and `PROCUREMENT`.
- Modify `components/erp/NeuralAppHub.tsx` and `components/CommandPalette.tsx`: discoverable V2 entries.
- Modify `lib/permissions/projectPermissionRegistry.ts`, `lib/permissions/projectPermissionRooms.ts`, and relevant permission tests: scoped V2 plan actions.
- Modify `types/procurementIdentity.ts` and `types/procurementWorkbench.ts`: include `material_plan` source/document types without weakening existing MR contracts.
- Modify `lib/procurement/documentAdapters.ts`: route plan source references to Project V2 detail.
- Modify `lib/companyProcurementService.ts` or extract a shared service: submit both MR-backed and material-plan-backed demand lines through the atomic PO command without fabricated links.

### Supabase migrations and tests

- Create via CLI `*_project_v2_planning_foundation.sql`: cohort, crews, plan aggregate, line sources, revision snapshots, comments/events/command ledger, indexes, grants, RLS, and read RPCs.
- Create via CLI `*_project_v2_planning_commands.sql`: save, submit, return, approve, revise, cancel, delete-draft, comment, and month/construction source-candidate commands.
- Create via CLI `*_project_v2_material_candidates.sql`: authoritative construction-work-to-material derivation candidates and diagnostics.
- Create via CLI `*_material_plan_procurement_intake.sql`: canonical `material_plan` registry/demand sync and approval integration.
- Create via CLI `*_procurement_v2_dossier_read_model.sql`: document-level inbox/detail readers.
- Create via CLI `*_procurement_material_plan_po_allocation.sql`: generalize atomic PO allocation for material-plan demand and mixed-source POs.
- Create `supabase/tests/project_v2_planning_smoke.sql`.
- Create `supabase/tests/project_v2_material_plan_procurement_smoke.sql`.
- Create `supabase/tests/procurement_v2_mixed_source_po_smoke.sql`.

---

### Task 1: Lock V2 contracts, state machine, and quantity invariants

**Files:**
- Create: `types/projectV2.ts`
- Create: `lib/projectV2/planDomain.ts`
- Create: `lib/projectV2/presentation.ts`
- Create: `lib/__tests__/projectV2PlanDomain.test.ts`
- Create: `lib/__tests__/projectV2Presentation.test.ts`

**Interfaces:**
- Produces `ProjectV2PlanType = 'month' | 'construction' | 'material'`.
- Produces `ProjectV2PlanStatus = 'draft' | 'pending_approval' | 'returned' | 'approved' | 'superseded' | 'cancelled'`.
- Produces `getProjectV2AllowedActions(input)`, `validateProjectV2PlanDraft(input)`, `calculateMaterialRequirement(input)`, `groupMaterialRequirementLines(input)`, and `formatProjectV2Quantity(value, unit)`.
- Consumes `parseQuantity6` and `formatDecimal6` from `lib/procurement/decimal.ts`; no JavaScript floating-point quantity arithmetic.

- [ ] **Step 1: Write failing state and material derivation tests**

```ts
it('allows only draft or returned plans to be edited', () => {
  expect(getProjectV2AllowedActions({ status: 'draft', capabilities: allCapabilities }).edit).toBe(true);
  expect(getProjectV2AllowedActions({ status: 'pending_approval', capabilities: allCapabilities }).edit).toBe(false);
  expect(getProjectV2AllowedActions({ status: 'approved', capabilities: allCapabilities }).revise).toBe(true);
});

it('derives exact material quantity from work, norm and conversion', () => {
  expect(calculateMaterialRequirement({
    workQty: '12.500000', normFactor: '8.000000', coefficient: '1.050000',
    conversionNumerator: '1.000000', conversionDenominator: '1.000000',
  })).toBe('105.000000');
});

it('keeps missing norm and conversion unknown', () => {
  expect(calculateMaterialRequirement({
    workQty: '12.500000', normFactor: null, coefficient: '1.000000',
    conversionNumerator: '1.000000', conversionDenominator: '1.000000',
  })).toBeNull();
});

it('does not merge equal items across different required dates or destinations', () => {
  const groups = groupMaterialRequirementLines([
    materialCandidate({ itemId: 'steel', neededDate: '2026-10-01', destination: 'Khu A' }),
    materialCandidate({ itemId: 'steel', neededDate: '2026-10-08', destination: 'Khu A' }),
  ]);
  expect(groups).toHaveLength(2);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx --no-install vitest run lib/__tests__/projectV2PlanDomain.test.ts lib/__tests__/projectV2Presentation.test.ts`

Expected: FAIL because the V2 contracts and helpers do not exist.

- [ ] **Step 3: Implement the minimal pure domain**

Use discriminated DTOs for month, construction, and material lines. A material line carries its own stable line ID and one or more derivations; each derivation records source plan ID/revision/line, source work quantity, norm resource/revision, norm factor, coefficient, conversion numerator/denominator, and derived quantity. Validation returns field-addressable issues rather than clipping quantities.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx --no-install vitest run lib/__tests__/projectV2PlanDomain.test.ts lib/__tests__/projectV2Presentation.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit only the Task 1 paths**

```bash
git add types/projectV2.ts lib/projectV2/planDomain.ts lib/projectV2/presentation.ts lib/__tests__/projectV2PlanDomain.test.ts lib/__tests__/projectV2Presentation.test.ts
git commit -m "feat(project-v2): define planning domain contracts"
```

---

### Task 2: Add the isolated V2 cohort and authoritative planning aggregate

**Files:**
- Create via CLI: `supabase/migrations/*_project_v2_planning_foundation.sql`
- Create: `lib/__tests__/projectV2PlanningMigration.test.ts`
- Create: `supabase/tests/project_v2_planning_smoke.sql`

**Interfaces:**
- Produces relational tables `project_v2_workspaces`, `project_v2_crews`, `project_v2_crew_members`, `project_v2_plans`, `project_v2_plan_lines`, `project_v2_plan_line_sources`, `project_v2_plan_revisions`, `project_v2_plan_comments`, and `project_v2_plan_events`.
- Produces private command ledger `app_private.project_v2_commands`.
- Produces read RPCs `list_project_v2_workspaces_v1`, `list_project_v2_plans_v1`, and `get_project_v2_plan_v1`.

- [ ] **Step 1: Create the migration using the installed CLI**

Run: `npx --no-install supabase migration new project_v2_planning_foundation`

Expected: the CLI prints the exact new migration path. Use that generated file for every following step in this task.

- [ ] **Step 2: Write the failing migration contract test**

Assert all exposed tables have RLS enabled, `authenticated` has no direct DML on plan/revision/event tables, revision rows are immutable, all public wrappers pin `search_path=''`, and private definer functions are not executable by `anon` or `authenticated` except through reviewed wrappers.

```ts
expect(sql).toMatch(/create table public\.project_v2_plans/);
expect(sql).toMatch(/alter table public\.project_v2_plans enable row level security/);
expect(sql).toMatch(/revoke all on public\.project_v2_plan_revisions from public, anon, authenticated/);
expect(sql).toMatch(/project_v2_plan_revision_immutable/);
expect(sql).toMatch(/set search_path\s*=\s*''/);
```

- [ ] **Step 3: Define the V2 cohort without copying project master data**

`project_v2_workspaces.project_id` references the existing project identity; one project can have at most one active V2 workspace. Store the primary construction site and lifecycle `pilot | active | archived`. Do not seed a project. Provide an admin-scoped activation command that enrolls an existing project and is idempotent.

- [ ] **Step 4: Define the plan aggregate and typed checks**

Use a shared plan header and shared line table, with database checks tied to `plan_type`:

- month lines require a contract/BOQ or task source and planned quantity;
- construction lines require an approved month-plan source except for an explicit baseline exception carrying a reason;
- material lines require an inventory item, canonical UOM, needed date, destination, and at least one complete derivation before submit;
- all source links store source plan revision/hash and quantities; no header-only `sourceIds` model;
- current plan `version` is optimistic-lock state, while immutable `revision_no` identifies approved snapshots.

- [ ] **Step 5: Define scoped read models**

Readers resolve actor with `current_app_user_id()`, apply workspace/project/site scope before counts and aggregates, and return capabilities from the server. List results use stable cursor pagination and return `asOf`, `snapshotToken`, and counters over the full filter, not the loaded page.

- [ ] **Step 6: Add rollback-only smoke fixtures**

The smoke test must prove:

1. authorized actor reads one pilot workspace;
2. cross-project and inactive actor are denied;
3. month/construction/material source links preserve revision and line identity;
4. direct authenticated DML fails;
5. revision update/delete fails;
6. quantities preserve six decimals;
7. no project, PO, inventory, or finance rows are mutated merely by reading or saving a draft fixture.

- [ ] **Step 7: Run local static checks only**

Run:

```bash
npx --no-install vitest run lib/__tests__/projectV2PlanningMigration.test.ts
npm run check:supabase-migrations
npm run check:supabase-queries
```

Expected: PASS. Do not start local Supabase.

- [ ] **Step 8: Commit the generated migration and tests**

Stage the exact generated migration path, the contract test, and the smoke file only.

---

### Task 3: Add V2 permissions and parallel navigation without replacing current modules

**Files:**
- Modify: `constants/routes.ts`
- Modify: `App.tsx`
- Modify: `components/Sidebar.tsx`
- Modify: `components/erp/NeuralAppHub.tsx`
- Modify: `components/CommandPalette.tsx`
- Modify: `lib/permissions/projectPermissionRegistry.ts`
- Modify: `lib/permissions/projectPermissionRooms.ts`
- Create: `lib/__tests__/projectV2RouteAccess.test.ts`
- Create: `lib/__tests__/projectV2PermissionRegistry.test.ts`

**Interfaces:**
- Routes `/project-v2` and `/project-v2/plans/:planId` use module foundation `DA`.
- Routes `/procurement-v2` and `/procurement-v2/demands/:demandId` use module foundation `PROCUREMENT`.
- Adds scoped permission modules `project.v2_month_plan`, `project.v2_construction_plan`, and `project.v2_material_plan` with workflow actions `view/create/edit_own/edit_all/delete_own/delete_all/submit/return/approve/manage`.

- [ ] **Step 1: Write failing route and permission tests**

```ts
expect(getRouteModuleKey('/project-v2/plans/plan-1')).toBe('DA');
expect(getRouteModuleKey('/procurement-v2/demands/demand-1')).toBe('PROCUREMENT');
expect(getPermissionActionByCode('project.v2_material_plan.approve')?.scopeTypes)
  .toEqual(['global', 'project', 'construction_site']);
```

Assert that a user with only legacy `/da` permission cannot mutate V2 plans unless the scoped V2 action is present, and a Procurement viewer can open the inbox but cannot create a PO without the existing scoped PO action.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx --no-install vitest run lib/__tests__/projectV2RouteAccess.test.ts lib/__tests__/projectV2PermissionRegistry.test.ts`

- [ ] **Step 3: Add lazy placeholder routes and separate app entries**

The visual entries are separate, but each config entry has an explicit authorization key (`DA` or `PROCUREMENT`) instead of inventing a duplicate system permission. Existing `/da` and `/procurement` links remain labeled “Dự án hiện tại” and “Mua hàng hiện tại” inside their respective navigation views.

- [ ] **Step 4: Add plan-type scoped permissions**

Extend the existing registry and Room model; do not use roles or client labels as authorization. Database helpers in later tasks must check the exact plan-type action and project/site scope.

- [ ] **Step 5: Run route, authorization, and UI contract regressions**

Run:

```bash
npx --no-install vitest run \
  lib/__tests__/projectV2RouteAccess.test.ts \
  lib/__tests__/projectV2PermissionRegistry.test.ts \
  lib/__tests__/routeAccess.test.ts \
  lib/__tests__/permissionService.test.ts \
  lib/__tests__/authorizationSurfaceParity.test.ts
npm run lint
```

- [ ] **Step 6: Commit only navigation and permission paths**

Commit message: `feat(project-v2): add isolated routes and permissions`.

---

### Task 4: Implement server-authoritative planning commands and workflow

**Files:**
- Create via CLI: `supabase/migrations/*_project_v2_planning_commands.sql`
- Create: `lib/projectV2/commandService.ts`
- Create: `lib/__tests__/projectV2CommandService.test.ts`
- Create: `lib/__tests__/projectV2PlanningCommandsMigration.test.ts`
- Modify: `supabase/tests/project_v2_planning_smoke.sql`

**Interfaces:**
- Produces `save_project_v2_plan_v1`, `submit_project_v2_plan_v1`, `return_project_v2_plan_v1`, `approve_project_v2_plan_v1`, `create_project_v2_plan_revision_v1`, `cancel_project_v2_plan_v1`, `delete_project_v2_plan_draft_v1`, and `add_project_v2_plan_comment_v1`.
- Produces `list_project_v2_source_candidates_v1` for BOQ/baseline → month and approved month → construction selection.
- Every mutation receives expected version and idempotency key. Return/cancel requires a non-empty reason.

- [ ] **Step 1: Create the migration with `supabase migration new project_v2_planning_commands`**

- [ ] **Step 2: Write failing service request-shape tests**

```ts
await projectV2CommandService.submit({
  planId: 'plan-1', expectedVersion: 3, idempotencyKey: 'key-1', reason: 'Đủ hồ sơ',
});
expect(rpc).toHaveBeenCalledWith('submit_project_v2_plan_v1', {
  p_plan_id: 'plan-1', p_expected_version: 3, p_idempotency_key: 'key-1', p_reason: 'Đủ hồ sơ',
});
```

Add cases for blank reason, stale version, repeated key/same payload, repeated key/different payload, and malformed quantities.

- [ ] **Step 3: Implement lock order and state transitions**

All command paths lock workspace → plan → source plans/lines in sorted ID order → current lines/sources → command row. Save accepts only `draft` or `returned`. Submit recalculates validity and records an immutable revision/hash. Return accepts only `pending_approval`. Approve rechecks current source revisions and available quantities before changing state and rejects the plan creator or submitter as approver.

- [ ] **Step 4: Enforce no silent over-allocation**

For month→construction consumption, sum active approved/pending reservations from exact source plan line/revision. If requested total exceeds approved source quantity, fail with `PROJECT_V2_SOURCE_QUANTITY_EXCEEDED` and return the current available quantity in the error detail. For material derivations, reserve the exact derived material source identity; do not deduplicate by SKU or display name.

- [ ] **Step 5: Preserve immutable approvals and revisions**

Approved plans cannot be edited. `create_project_v2_plan_revision_v1` creates a new draft linked to the approved predecessor with stable line/source identities where still valid. Only the new revision becomes effective after approval; predecessor becomes `superseded` in the same transaction.

Cancellation requires a reason. An approved material plan can be cancelled and its demand withdrawn only when every downstream reserved, committed, fulfilled, and closed quantity is zero. Otherwise the command fails with a reconciliation explanation and leaves the plan, demand, PO, receipt, and finance lineage unchanged.

- [ ] **Step 6: Record system events and actor-owned comments**

Events are append-only and system-authored from command facts. Comment author and timestamp come from the session/server. Client text is comment content only; it cannot supply actor, event wording, or approval metadata.

- [ ] **Step 7: Run contract and smoke checks**

Run targeted Vitest, migration/query checks, then run the SQL smoke only on a temporary Supabase Cloud branch. Test two concurrent writers trying 60 + 60 against source quantity 100; at most one conflicting total may commit and no partial revision/event rows may remain.

- [ ] **Step 8: Commit the generated migration, service, and tests**

Commit message: `feat(project-v2): add revisioned planning workflow`.

---

### Task 5: Build strict read/query services and the Project V2 overview shell

**Files:**
- Create: `lib/projectV2/readService.ts`
- Create: `lib/projectV2/queryState.ts`
- Create: `pages/project-v2/ProjectV2Workspace.tsx`
- Create: `components/project-v2/ProjectV2Shell.tsx`
- Create: `components/project-v2/ProjectV2PlanList.tsx`
- Create: `lib/__tests__/projectV2ReadService.test.ts`
- Create: `lib/__tests__/projectV2QueryState.test.ts`
- Create: `lib/__tests__/projectV2WorkspaceUiContract.test.ts`
- Modify: `pages/ProjectDashboard.tsx`

**Interfaces:**
- `projectV2ReadService.listWorkspaces()`, `.listPlans(query)`, and `.getPlan(planId)` strictly map RPC payloads without defaulting unknown fields.
- URL query owns project, plan type, status, search, period, sort, and page; refresh/back/deep-link are supported.

- [ ] **Step 1: Write failing mapper and query-state tests**

Test exact scope match, duplicate IDs, malformed decimals, unknown preservation, stale snapshot rejection, cursor stability, invalid query fallback, and denied/network propagation.

- [ ] **Step 2: Implement strict services and request-generation gates**

Responses from an older project/filter generation cannot overwrite the current view. Legitimate empty arrays render empty states; denied and errors throw typed errors.

- [ ] **Step 3: Build the overview information hierarchy from the Astra reference**

Render:

1. compact project identity and contract/site metadata;
2. three-step flow strip: Kế hoạch tháng → Thi công → Vật tư;
3. only source-backed KPIs: plans awaiting the current user, approved current month, current week plan, material dossiers handed to Purchasing;
4. plan-type tabs, search/status/period/sort filters, responsive list;
5. a small “Cần anh xem” rail on wide screens, inline section on narrow screens.

No fixed 68%, 91%, demo date, or sum of unlike plan values is allowed.

- [ ] **Step 4: Add enrollment empty state**

When no V2 workspace exists, authorized admins see “Đưa dự án thử nghiệm vào V2”, choose an existing project/site, and call the idempotent activation command. Other users see a permission-aware empty state. Do not auto-seed or create production projects.

An active V2 cohort project is excluded from the project picker on the current `/da` experience, but remains a standard shared project identity for authorization, contracts, inventory, procurement, WMS, finance, and reporting. Archiving the V2 workspace makes it eligible for the current picker again. Test this through a small pure cohort filter instead of spreading `project_v2` conditionals across the legacy page.

- [ ] **Step 5: Verify first-use comprehension**

Component tests must assert the first viewport contains project name, current plan type, status, owner, period, and one clear primary action. At 390px, list rows become cards; no horizontal page overflow is permitted.

- [ ] **Step 6: Run tests, lint, and build; commit**

Commit message: `feat(project-v2): add planning workspace overview`.

---

### Task 6: Implement month and construction plan creation/detail UX

**Files:**
- Create: `components/project-v2/ProjectV2CreatePlanDialog.tsx`
- Create: `components/project-v2/ProjectV2SourcePicker.tsx`
- Create: `components/project-v2/MonthPlanEditor.tsx`
- Create: `components/project-v2/ConstructionPlanEditor.tsx`
- Create: `components/project-v2/ProjectV2PlanWorkflowActions.tsx`
- Create: `pages/project-v2/ProjectV2PlanDetail.tsx`
- Create: `lib/__tests__/projectV2SourcePicker.test.ts`
- Create: `lib/__tests__/projectV2PlanDetailUiContract.test.ts`
- Create: `tests/project-v2/planning-fixture.tsx`
- Create: `tests/e2e/project-v2-planning.spec.ts`

**Interfaces:**
- Source candidates come from server RPC `list_project_v2_source_candidates_v1`; the client never calculates “available” from page-local data.
- The create dialog stores no record until the user completes header plus at least one valid source line, then calls save with one idempotency key.

- [ ] **Step 1: Write failing source-picker tests**

Cover approved-only sources, cross-project rejection, search that preserves selected valid rows, “select all displayed results” semantics, explicit unavailable reasons, source revision change, and no silent quantity clipping.

- [ ] **Step 2: Implement monthly plan flow**

The monthly editor presents WBS/contract hierarchy and these business columns: Công việc, Đơn vị, Khối lượng hợp đồng, Đã lập trước kỳ, Kế hoạch kỳ này, Đơn giá hợp đồng, Thành tiền. Group/subtotal rows are not editable or double-counted. Price fields disappear when capability is false; they do not render zero.

- [ ] **Step 3: Implement construction plan flow**

The construction editor presents Công việc, Nguồn tháng, Đơn vị, Khối lượng khả dụng, Khối lượng tuần, Bắt đầu, Kết thúc, Tổ đội. Source defaults to approved monthly plans. A baseline exception requires an explicit reason and permission. End date cannot precede start or leave the plan period.

- [ ] **Step 4: Add a real V2 crew selector**

Use V2 crew records scoped to project/site. Do not reuse `safety_teams` merely because a table exists, and do not persist free-text crew names as authoritative assignment.

- [ ] **Step 5: Implement detail header and workflow actions**

Match the Astra interaction model while using Vioo components: back link, title/code/status, period/contract/owner/follower/source summary, tabs “Khối lượng kế hoạch / Trao đổi / Hoạt động”, and capability-driven actions. Draft primary action is “Gửi duyệt”; pending primary action is “Phê duyệt” only for an authorized current handler; approved primary action is “Tạo bản điều chỉnh”.

- [ ] **Step 6: Add dirty-form and conflict behavior**

Navigation/reload asks the user to stay or discard. Save errors preserve fields. A stale version shows who/when changed the plan and offers reload; it never overwrites server state.

- [ ] **Step 7: Run unit/component/e2e fixtures at 390/768/1440 and commit**

Commit message: `feat(project-v2): add month and construction planning`.

---

### Task 7: Derive and approve material plans from construction work

**Files:**
- Modify: `lib/projectV2/planDomain.ts`
- Create: `lib/projectV2/materialCandidateService.ts`
- Create via CLI: `supabase/migrations/*_project_v2_material_candidates.sql`
- Create: `components/project-v2/MaterialPlanEditor.tsx`
- Create: `components/project-v2/MaterialBasisDrawer.tsx`
- Create: `lib/__tests__/projectV2MaterialCandidates.test.ts`
- Create: `lib/__tests__/projectV2MaterialCandidatesMigration.test.ts`
- Create: `lib/__tests__/projectV2MaterialPlanUiContract.test.ts`
- Modify: `tests/e2e/project-v2-planning.spec.ts`

**Interfaces:**
- `materialCandidateService.list({ projectId, constructionSiteId, sourcePlanIds })` consumes approved construction-plan lines plus authoritative norm/resource mappings.
- Each candidate returns `calculatedQty: string | null`, diagnostics, selectable flag, and complete derivation evidence.

- [ ] **Step 1: Write failing candidate tests**

Cover one work line with multiple material resources, one material across multiple work lines, same material with different UOM, missing inventory identity, missing norm revision, missing conversion, previous allocation, exact repeated request, and source-plan revision change.

- [ ] **Step 2: Create the migration with `supabase migration new project_v2_material_candidates`**

- [ ] **Step 3: Implement authoritative candidate RPC and mapper**

Candidate priority is an exact V2 construction line → contract/work BOQ identity → versioned `contract_item_resources` or G8/material-budget norm mapping. No match by material name or SKU. If more than one incompatible authoritative mapping exists, return a blocking diagnostic for review.

- [ ] **Step 4: Implement material-plan main editor for site users**

The main table contains only:

- Mã và tên vật tư;
- Đơn vị;
- Nhu cầu tính toán;
- Số lượng đề nghị;
- Ngày cần tại công trường;
- Điểm nhận;
- Ghi chú.

Technical BOQ IDs, hashes, B/I/O/C abbreviations, adapter names, and raw diagnostic codes stay out of the main row.

- [ ] **Step 5: Put derivation evidence in progressive disclosure**

“Cơ sở tính toán” shows source construction plans/work lines, work quantity, norm resource/revision, factor/coefficient, conversion, already planned quantity, available quantity, and human-readable blocking reason. It links back to exact source plans.

- [ ] **Step 6: Enforce approval completeness**

Drafts may retain incomplete lines with explicit warnings. Submit/approve fails if any approved quantity lacks inventory identity, UOM, derivation, needed date, destination, or exact source availability. User overrides require an entered reason and keep both calculated and approved quantities in the snapshot.

- [ ] **Step 7: Run tests and responsive walkthrough; commit**

Commit message: `feat(project-v2): derive material plans from construction work`.

---

### Task 8: Publish approved material plans into the G2 canonical demand ledger

**Files:**
- Create via CLI: `supabase/migrations/*_material_plan_procurement_intake.sql`
- Modify: `types/procurementIdentity.ts`
- Create: `lib/procurement/materialPlanSourceAdapter.ts`
- Modify: `lib/procurement/demandService.ts`
- Create: `lib/__tests__/materialPlanProcurementSourceAdapter.test.ts`
- Create: `lib/__tests__/materialPlanProcurementIntakeMigration.test.ts`
- Create: `supabase/tests/project_v2_material_plan_procurement_smoke.sql`

**Interfaces:**
- Extends `ProcurementSourceSnapshot.adapter` to `'project_material_request' | 'material_plan'`.
- Produces private sync helper plus public command `sync_material_plan_demand_v1(planId, expectedRevision, idempotencyKey)` for replay/recovery.
- Normal approval uses the same private helper inside `approve_project_v2_plan_v1`, so plan approval and demand intake commit or roll back together.

- [ ] **Step 1: Create the migration with `supabase migration new material_plan_procurement_intake`**

- [ ] **Step 2: Write failing adapter and migration tests**

```ts
expect(normalizeMaterialPlanSnapshot(approvedPlan).adapter).toBe('material_plan');
expect(snapshot.lines[0].approvedQty).toBe('105.000000');
expect(snapshot.lines[0].sourceLineId).toBe(approvedPlan.lines[0].id);
```

Migration tests assert one source document per owner/adapter/plan, stable source-line registry IDs, immutable source revisions, and demand uniqueness by canonical source document.

- [ ] **Step 3: Implement atomic approval intake**

Within the approval transaction:

1. lock and validate the pending plan and current sources;
2. create immutable approved plan revision/hash;
3. upsert `procurement_source_documents` with adapter `material_plan`;
4. upsert exact source line registry rows;
5. create the source revision snapshot;
6. create/update one ready, healthy demand and its lines;
7. write one outbox event and one plan activity event;
8. mark the plan approved.

Any failure rolls back all eight effects. Retry with the same key returns the same demand.

- [ ] **Step 4: Define revision/cancellation dispositions**

If a replacement plan increases quantity, publish a new source revision and mark the demand `source_changed` until the authorized disposition accepts it. If it decreases below reserved/committed/fulfilled quantity, create a blocking reconciliation issue and preserve downstream commitments. If no downstream quantity exists, the replacement may update the ready demand atomically.

- [ ] **Step 5: Prove no duplicate or unintended side effects**

Cloud branch smoke asserts double approval/retry creates one demand, no request row is created, and no purchase order, stock transaction, receipt, payable, cash entry, or finance journal is created.

- [ ] **Step 6: Run G2/G4/G5 regression suites and commit**

Commit message: `feat(procurement): ingest approved material plans`.

---

### Task 9: Add the document-first Procurement V2 read model and routes

**Files:**
- Create via CLI: `supabase/migrations/*_procurement_v2_dossier_read_model.sql`
- Create: `types/procurementV2.ts`
- Create: `lib/procurement/procurementV2Service.ts`
- Create: `lib/procurement/procurementV2Presentation.ts`
- Create: `lib/__tests__/procurementV2ReadModelMigration.test.ts`
- Create: `lib/__tests__/procurementV2Service.test.ts`
- Create: `lib/__tests__/procurementV2Presentation.test.ts`

**Interfaces:**
- Produces `list_procurement_dossiers_v2(filter, cursor, limit)` at document grain.
- Produces `get_procurement_dossier_v2(demandId)` with source, lines, balances, issues, assignments, and document references.
- Supports `project_material_request` and `material_plan` source adapters explicitly.

- [ ] **Step 1: Create the migration with `supabase migration new procurement_v2_dossier_read_model`**

- [ ] **Step 2: Write failing read-model tests**

Assert one card per source document, source type labels, counters at document grain, stable cursor, scope filtering before counts, no price payload without price capability, and preservation of nullable balance fields.

- [ ] **Step 3: Implement document-first list semantics**

Each row returns source code/type, project/site, owner/assignee, earliest known required date, destination summary, line count, dossier stage, next action, version, and issues. Do not flatten every material line into an indistinguishable work queue.

- [ ] **Step 4: Implement dossier detail semantics**

Each line returns approved need, reserved, committed, fulfilled, closed, available to plan, required date, destination, and exact source refs. Mixed/unknown UOM or incomplete attribution remains nullable with a diagnostic; no mixed-unit totals are produced.

- [ ] **Step 5: Extend document routing**

`material_plan` source refs open `/project-v2/plans/:planId`; MR refs retain their existing trace/detail route. PO/WMS/AP references continue through the existing trace engine with validated internal `returnTo`.

- [ ] **Step 6: Run G5 reader regressions and commit**

Commit message: `feat(procurement-v2): add document dossier read model`.

---

### Task 10: Build the Procurement V2 inbox and dossier UX

**Files:**
- Create: `pages/procurement-v2/ProcurementV2Inbox.tsx`
- Create: `pages/procurement-v2/ProcurementV2DemandDetail.tsx`
- Create: `components/procurement-v2/ProcurementV2Filters.tsx`
- Create: `components/procurement-v2/ProcurementV2DossierList.tsx`
- Create: `components/procurement-v2/ProcurementV2DemandLines.tsx`
- Create: `components/procurement-v2/ProcurementV2SupplyDialog.tsx`
- Create: `lib/__tests__/procurementV2UiContract.test.ts`
- Create: `tests/procurement-v2/dossier-fixture.tsx`
- Create: `tests/e2e/procurement-v2-dossier.spec.ts`

**Interfaces:**
- URL owns search, project, source type, status, needed-date range, and `demandId`/detail route.
- Main list is dossier/document grain; material aggregation is a secondary view and not part of the first implementation slice.

- [ ] **Step 1: Write failing first-use UI contract tests**

The first viewport must show “Hồ sơ cần xử lý”, explain that approved plans/requests arrive here, show source badges “Kế hoạch vật tư” or “Đề xuất vật tư”, and expose one clear “Mở hồ sơ” action. Raw adapter names, UUIDs, B/I/O/C labels, and unexplained counters must not appear.

- [ ] **Step 2: Implement inbox filters and states**

Filters: search, project, source type, processing status, required date. Summary cards use document grain and label the denominator. Loading, denied, error, stale, no dossier, and no filter results are separate.

- [ ] **Step 3: Implement dossier detail**

Header answers: nguồn nào, dự án/công trường nào, ai phụ trách, ngày cần sớm nhất, trạng thái xử lý. Main lines show Vật tư, ĐVT, Nhu cầu đã duyệt, Đã bố trí, Còn phải bố trí, Ngày cần, Điểm nhận, Bước tiếp theo. Allocation/receipt/finance details are drill-down, not the default row.

- [ ] **Step 4: Implement supply-method dialog honestly**

Present “Cấp từ kho”, “Điều chuyển”, “Gọi theo hợp đồng”, and “Mua theo PO”. Enable only methods that have authoritative backend commands in the current release. Disabled methods state exactly what is missing. The MVP primary enabled method is PO; approval of the material plan is never described as already purchasing.

- [ ] **Step 5: Verify responsive and keyboard behavior**

Desktop uses list/detail navigation or split view only when it improves context. Tablet/mobile use full-screen detail and bottom-safe actions. Escape/focus restore, dialog focus trap, labeled controls, 44px targets, dark mode, and 200% zoom are required.

- [ ] **Step 6: Run component/e2e fixture tests and commit**

Commit message: `feat(procurement-v2): add document-first buyer workspace`.

---

### Task 11: Generalize atomic PO creation for material-plan and mixed-source demand

**Files:**
- Create via CLI: `supabase/migrations/*_procurement_material_plan_po_allocation.sql`
- Create: `lib/procurement/procurementPurchaseDraft.ts`
- Modify: `lib/companyProcurementService.ts` or create `lib/procurement/procurementPurchaseOrderService.ts` and delegate the old caller to it.
- Create: `components/procurement-v2/ProcurementV2PurchaseDialog.tsx`
- Create: `lib/__tests__/procurementPurchaseDraft.test.ts`
- Create: `lib/__tests__/procurementMaterialPlanPoMigration.test.ts`
- Create: `lib/__tests__/procurementV2PurchaseUiContract.test.ts`
- Create: `supabase/tests/procurement_v2_mixed_source_po_smoke.sql`
- Modify: `tests/e2e/procurement-v2-dossier.spec.ts`

**Interfaces:**
- Pure builder returns `{ purchaseOrder, requestLineLinks, allocations }`.
- `requestLineLinks` contains entries only for `project_material_request` demand lines.
- Every selected demand line has exactly one G2 allocation entry, regardless of source adapter.
- The server command remains `create_procurement_purchase_order_v1` so G5 stays the atomic authority.

- [ ] **Step 1: Write failing partition tests**

```ts
const payload = buildProcurementPurchaseDraft([
  demandLine({ adapter: 'project_material_request', requestLineId: 'mr-line' }),
  demandLine({ adapter: 'material_plan', requestLineId: null }),
]);
expect(payload.requestLineLinks).toHaveLength(1);
expect(payload.allocations).toHaveLength(2);
```

Add same-item/different-source, same-item/different-price, mixed UOM, missing conversion, unavailable quantity, hidden price, and duplicate line identity cases.

- [ ] **Step 2: Create the migration with `supabase migration new procurement_material_plan_po_allocation`**

- [ ] **Step 3: Replace the equal-count request-link invariant**

The command must validate every allocation against its canonical demand/source adapter. It requires a matching legacy request-line link only when the demand source adapter is `project_material_request`; it requires no fabricated request link for `material_plan`. All selected demand lines still lock and validate before any PO row is inserted.

- [ ] **Step 4: Preserve exact line lineage**

The PO line gets a stable `lineId`. Allocation links PO line registry → demand line → source revision → plan/request source line. A mixed-source PO remains attributable without using item ID, array index, SKU, or display name as identity.

- [ ] **Step 5: Implement the purchase dialog**

Buyer selects remaining quantities, supplier, purchase unit/conversion, unit price if authorized, expected delivery date, warehouse/destination, and note. The confirmation summarizes PO count by supplier and warns about lines excluded by conflicts. Timeout retry reuses the same idempotency key.

- [ ] **Step 6: Prove concurrency and rollback on Cloud branch**

Two buyers attempt to purchase 60 + 60 from available 100: committed allocations cannot exceed 100. Inject failure after PO aggregate save and prove the PO/allocation transaction fully rolls back. Retry returns the same PO ID. Mixed MR + material-plan lines preserve only the real MR link.

- [ ] **Step 7: Run G5/G6/G7 regressions and commit**

Commit message: `feat(procurement): create POs from material-plan demand`.

---

### Task 12: Complete collaboration, CSV export, lineage, and related-plan navigation

**Files:**
- Create: `components/project-v2/ProjectV2PlanDiscussion.tsx`
- Create: `components/project-v2/ProjectV2PlanActivity.tsx`
- Create: `lib/projectV2/csvExport.ts`
- Create: `lib/__tests__/projectV2CsvExport.test.ts`
- Create: `lib/__tests__/projectV2Collaboration.test.ts`
- Modify: `pages/project-v2/ProjectV2PlanDetail.tsx`
- Modify: `pages/procurement-v2/ProcurementV2DemandDetail.tsx`

**Interfaces:**
- Comments use persisted server actor/time and paginate.
- Activity is append-only and renders command facts.
- CSV exports the authorized approved/draft revision currently viewed and neutralizes spreadsheet formulas.

- [ ] **Step 1: Write failing collaboration and CSV tests**

Cover empty/whitespace comment, actor spoof attempt, comment while local form is dirty, pagination, denied history, Vietnamese text, commas/newlines/quotes, and cells beginning with `=`, `+`, `-`, `@`, tab, or carriage return.

- [ ] **Step 2: Implement comments and activity tabs**

When the detail form is dirty, comment submission is disabled with “Lưu hoặc bỏ thay đổi trước khi trao đổi.” Activity text is produced from typed server event codes and metadata, not arbitrary client-supplied audit sentences.

- [ ] **Step 3: Implement safe CSV export**

Prefix formula-like text with a single quote before CSV quoting. Export headers and number strings in Vietnamese-readable form, preserve six-decimal source values, and do not include price columns when capability is false.

- [ ] **Step 4: Add bidirectional lineage links**

Plan detail links to source and downstream plans. Procurement dossier links to the exact approved material plan revision. PO and receipt links use existing document trace. If the user lacks permission, render a protected-reference label without leaking document details.

- [ ] **Step 5: Run tests and commit**

Commit message: `feat(project-v2): add collaboration export and lineage`.

---

### Task 13: Integration verification, Cloud preview, and controlled pilot handoff

**Files:**
- Create: `docs/runbooks/project-v2-pilot-rollout.md`
- Create: `docs/designs/erp-completion-2026-09-19/evidence/project-v2-validation-20260923.md`
- Modify: `docs/designs/erp-completion-2026-09-19/HANDOFF.md`

**Interfaces:**
- Produces a read-only/preview validation record, rollout gates, recovery steps, and business UAT checklist. It does not change the active DA29 G9 manifest.

- [ ] **Step 1: Protect the dirty worktree before integration**

Record `git status --short`, `git diff --name-only`, branch, HEAD, and migration parity. Do not stage unrelated changes. Review every overlapping file explicitly, especially procurement files already modified locally.

- [ ] **Step 2: Run the complete local verification set**

```bash
npx --no-install vitest run \
  lib/__tests__/projectV2*.test.ts \
  lib/__tests__/materialPlanProcurement*.test.ts \
  lib/__tests__/procurementV2*.test.ts \
  lib/__tests__/procurementPurchaseDraft.test.ts \
  lib/__tests__/procurementMaterialPlanPoMigration.test.ts
npm test
npm run lint
npm run build
npm run check:supabase-migrations
npm run check:supabase-queries
git diff --check
```

Expected: all commands PASS. If the repo's shell does not expand a Vitest glob, replace it with the explicit filenames created by Tasks 1–12.

- [ ] **Step 3: Run browser walkthroughs**

Use component fixtures and the actual app routes at 390, 768, and 1440 widths plus 200% zoom. Validate these journeys:

1. enroll a sample project into the V2 cohort;
2. create, save, submit, return, and approve a monthly plan;
3. create and approve a weekly construction plan from it;
4. create a material plan, inspect missing norm, fix source, submit, and approve;
5. see exactly one new Procurement V2 dossier;
6. combine eligible MR and material-plan lines into PO drafts by supplier;
7. retry a timeout without duplicate demand or PO;
8. open plan → demand → PO → receipt lineage and return to the dossier.

- [ ] **Step 4: Replay migrations and smokes on a temporary Cloud branch**

Use only `.env` configuration. Replay the full migration chain, run advisors, RLS/ACL/search-path checks, rollback-only smokes, concurrency tests, and actor/scope negatives. Delete the temporary branch and temporary credentials/logs afterward. Do not apply to production.

- [ ] **Step 5: Define pilot entry criteria**

The V2 pilot may be enabled only when:

- a named sample project/site is enrolled;
- planner, approver, buyer, warehouse, and finance personas are assigned;
- plan-type permissions and no-self-approval policy are explicitly configured;
- at least one contract/BOQ task has a complete versioned material norm and UOM mapping;
- source overlap, unknown norms, revision decrease, duplicate approval, PO race, price hiding, and cross-scope tests pass;
- rollback disables only V2 navigation/cohort without deleting approved plans or stranding persisted demands/POs.

- [ ] **Step 6: Define business UAT separately from automation**

The runbook records actor, project/site, source revision, expected/actual result, evidence, cleanup, and business signoff for each journey. Passing technical tests must remain labeled technical verification, not business approval.

- [ ] **Step 7: Update handoff and commit only the new V2 docs/evidence**

Never include the protected audit README or unrelated daily-log/procurement UI changes in this commit.

---

## Delivery order and release gates

| Increment | Tasks | User-visible result | Release rule |
| --- | --- | --- | --- |
| A — Foundation | 1–4 | Isolated, permissioned planning aggregate and workflow | Cloud branch only; no production route |
| B — Site planning | 5–7 | Monthly → construction → material planning works with real data | Feature flag/cohort off by default |
| C — Purchasing intake | 8–10 | Approved material plans appear as readable dossiers | Read-only pilot before PO action |
| D — PO execution | 11 | Buyer creates traceable PO from plan/MR demand | Concurrency and rollback proof required |
| E — Completion | 12–13 | Collaboration, export, lineage, runbook, evidence | Named business UAT required |

## Explicit non-goals for the first V2 release

- Replacing or deleting current Project/Procurement screens or migrating their historical documents.
- Automatically generating a PO when a material plan is approved.
- Treating current material-plan `confirmed` as the new business approval state.
- Creating a second MR for quantities already approved in a V2 material plan.
- Enabling stock reservation, transfer, or contract call-off before its authoritative command/policy exists.
- Reusing safety teams as construction crews without an explicit domain mapping.
- Backfilling ambiguous legacy BOQ/MR/issue links by SKU, name, array position, or guessed quantities.
- Expanding the DA29 production cohort or marking G9 business UAT complete.

## Definition of done

The implementation is complete only when a permitted site planner can derive a material plan from an approved construction plan, an independent approver can approve an immutable revision, Purchasing sees one understandable dossier with exact source lineage, and a permitted buyer can create a PO for selected external-purchase quantities without exceeding the canonical remaining demand. Reload/deep-link, error/conflict recovery, price hiding, responsive use, cross-scope denial, idempotent retry, mixed MR/material-plan lineage, Cloud replay, and named business UAT must all have evidence. No step may convert unknown values into zero or treat automation as business signoff.

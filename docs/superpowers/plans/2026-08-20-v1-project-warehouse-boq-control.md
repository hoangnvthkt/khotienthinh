# V1 Project Warehouse and BOQ Control Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every posted movement at a site warehouse inherit its project scope, record actual construction use through auditable settlements, and compare confirmed use with project BOQ and planned progress by inventory material code.

**Architecture:** Extend the existing warehouse, WMS inventory ledger, material issue, and project material modules rather than creating parallel stock records. PostgreSQL resolves project/site scope from the movement warehouse and exposes one reconciliation RPC; TypeScript maps the new fields and renders the reconciliation in the existing project Material Summary. Existing legacy rows are backfilled in the same forward migration with before/after stock assertions.

**Tech Stack:** PostgreSQL/Supabase Cloud, Supabase RPC and RLS, React 18, TypeScript 5.8, Vitest 4, Vite 6.

**Design reference:** `docs/v1-kiem-soat-vat-tu-boq-kho-cong-truong-design.md`

---

### Task 1: Lock the V1 contracts with failing tests

**Files:**
- Create: `lib/__tests__/projectWarehouseMaterialControlMigration.test.ts`
- Create: `lib/__tests__/projectMaterialReconciliation.test.ts`
- Modify: `lib/__tests__/warehouseSiteBinding.test.ts`
- Modify: `lib/__tests__/warehouseSiteBindingService.test.ts`

- [x] **Step 1: Add a migration contract test before the migration exists**

Assert that the future migration defines `warehouses.project_id`, `transactions.business_event_type`, scope guards, warehouse-derived ledger scope, settlement documents, reversal, reconciliation RPC, RLS, grants, and the three approved warehouse/project backfills. Assert that it never maps `PRJ-240AC280` and never converts legacy direct issues into consumption.

- [x] **Step 2: Run the targeted test and confirm RED**

Run: `npx vitest run lib/__tests__/projectWarehouseMaterialControlMigration.test.ts`

Expected: FAIL because the migration does not exist.

- [x] **Step 3: Add pure reconciliation contract tests**

Cover:

```ts
issued = returned + consumed + lost + open
plannedQtyToDate = totalBoqQty * plannedProgressPercent / 100
usedVarianceToPlan = confirmedUsedQty - plannedQtyToDate
```

Also cover unit mismatch/unmapped material warnings and ensure direct receipts never increase confirmed use.

- [x] **Step 4: Extend warehouse mapping/service tests**

Require `projectId` across the database mapper and both warehouse RPC payloads, and require available project choices to be restricted to the selected construction site.

- [x] **Step 5: Run all four target tests and confirm only the new expectations fail**

Run: `npx vitest run lib/__tests__/projectWarehouseMaterialControlMigration.test.ts lib/__tests__/projectMaterialReconciliation.test.ts lib/__tests__/warehouseSiteBinding.test.ts lib/__tests__/warehouseSiteBindingService.test.ts`

### Task 2: Add the atomic Cloud schema, backfill, and database commands

**Files:**
- Create: `supabase/migrations/20260820025355_project_warehouse_material_control_v1.sql`
- Create: `supabase/tests/project_warehouse_material_control_v1_smoke.sql`

- [x] **Step 1: Generate the migration file with the repository Supabase CLI**

Run: `npx supabase migration new project_warehouse_material_control_v1`

Rename only if needed to the timestamp above so tests use a deterministic path.

- [x] **Step 2: Add warehouse/project scope and business-event columns**

Add indexed foreign-key-backed `warehouses.project_id`; add checked `business_event_type` and reason to WMS and inventory ledger tables. Preserve physical `transactions.type`.

- [x] **Step 3: Harden warehouse binding RPCs and trigger guards**

Extend `create_warehouse_with_site_binding` and `set_warehouse_construction_site_binding` with `p_project_id`. Validate project/site equality and require an active `SITE` warehouse to have both fields. Block scope changes after WMS, ledger, balance, or issue-order use.

- [x] **Step 4: Centralize warehouse-derived scope and event classification**

Replace `app_private.sync_wms_transaction_to_inventory_ledger` so each entry resolves scope from its own warehouse. Derive known events from source references, require an explicit event/reason for new direct movements, and keep transfer out/in scopes independent.

- [x] **Step 5: Add settlement documents and idempotent post/reverse RPCs**

Create `material_issue_settlements` and lines with RLS. Posting must lock issue lines, validate open quantity, update `consumed_qty` or `lost_qty`, and append a party-ledger event in one transaction. Reversal must preserve the original record and append a compensating event.

- [x] **Step 6: Backfill approved Cloud records with invariant assertions**

Map site warehouses by their already-linked construction site to the unique live project; explicitly map `SMB-2026` and `DA29`, exclude `PRJ-240AC280`, backfill ledger/issue scope and event classification, synthesize legacy settlement headers without changing counters, rebuild scoped balances, and abort if any `(warehouse_id, material_id)` physical balance changes.

- [x] **Step 7: Add reconciliation RPC**

Expose `get_project_material_boq_reconciliation(project, site, report_date, planned_progress)` grouped by `inventory_item_id`. Use BOQ for plan, inventory ledger for receipts/current stock, and party ledger for issued/return/consume/loss/open. Return explicit data-quality flags.

- [x] **Step 8: Write a transactional SQL smoke test**

The smoke test must create temporary test records inside `begin ... rollback`, verify all four receipt origins inherit scope, verify settlement/reversal equations, reject cross-scope posting, and verify report totals/drill-down equality.

- [x] **Step 9: Run migration contract tests and confirm GREEN**

Run: `npx vitest run lib/__tests__/projectWarehouseMaterialControlMigration.test.ts`

### Task 3: Carry project scope through warehouse settings

**Files:**
- Modify: `types.ts`
- Modify: `lib/warehouseSiteBinding.ts`
- Modify: `lib/warehouseSiteBindingService.ts`
- Modify: `pages/Settings.tsx`
- Modify: `pages/settings/SettingsWarehouses.tsx`

- [x] **Step 1: Add domain fields and project-choice helper**

Add `Warehouse.projectId`, map `project_id`, and implement a pure helper that returns projects for exactly the selected construction site.

- [x] **Step 2: Pass `projectId` through create/update RPC calls**

Keep the RPC operations atomic; do not fall back to a direct table update.

- [x] **Step 3: Load project choices and render the dependent selector**

For a `SITE` warehouse, selecting a construction site filters the project selector to projects on that site. Require project selection before save. Show the project code/name and a locked-scope badge for used warehouses.

- [x] **Step 4: Run targeted tests**

Run: `npx vitest run lib/__tests__/warehouseSiteBinding.test.ts lib/__tests__/warehouseSiteBindingService.test.ts`

Expected: PASS.

### Task 4: Add settlement audit and reversal to the material issue flow

**Files:**
- Modify: `types.ts`
- Modify: `lib/materialIssueService.ts`
- Create: `lib/__tests__/materialIssueSettlementService.test.ts`
- Modify: `components/project/MaterialIssuePanel.tsx`

- [x] **Step 1: Write service tests first**

Verify post requests include settlement date/idempotency key and reversal requests include settlement id/reason. Verify settlement rows map from snake case.

- [x] **Step 2: Run the service test and confirm RED**

Run: `npx vitest run lib/__tests__/materialIssueSettlementService.test.ts`

- [x] **Step 3: Implement settlement service types and RPC calls**

List settlement history with lines, post `consume`/`loss`, and reverse an eligible posted settlement. Keep `recordSettlement` as a compatibility wrapper only if current callers require it.

- [x] **Step 4: Extend the issue UI**

Show per-line equation (issued, returned, consumed, lost, open), settlement date, history, and reversal action with a mandatory reason. Keep WMS return completion as the only source that increases `returned_qty`.

- [x] **Step 5: Run the service and material-issue regression tests**

Run: `npx vitest run lib/__tests__/materialIssueSettlementService.test.ts lib/__tests__/materialIssueCreatePermissionRegression.test.ts lib/__tests__/materialIssueWmsNoteMigration.test.ts`

Expected: PASS.

### Task 5: Add BOQ reconciliation service and project UI

**Files:**
- Create: `lib/projectMaterialReconciliation.ts`
- Create: `lib/projectMaterialReconciliationService.ts`
- Modify: `types.ts`
- Modify: `pages/project/MaterialTab.tsx`
- Modify: `components/project/material/MaterialSummaryTab.tsx`

- [x] **Step 1: Implement the pure report mapper/calculator to satisfy Task 1 tests**

Keep all quantities numeric and rounded consistently. Never use `material_budget_items.actual_qty`, `cumulative_imported`, or `cumulative_exported` as actual-use truth.

- [x] **Step 2: Implement the Supabase RPC service**

Accept report date and planned progress percentage; return rows and aggregate data-quality counts.

- [x] **Step 3: Load planned progress with the existing schedule projection**

Use the existing project schedule calculation at the selected report date, then call the reconciliation RPC. Do not create weekly snapshots in V1.

- [x] **Step 4: Render V1 reconciliation in the Material Summary**

Add report date, summary cards, columns for BOQ/plan/receipts/stock/issued/returned/used/loss/open/variances, and quality badges. Preserve the existing request/forecast functions as a separate planning view.

- [x] **Step 5: Run focused frontend tests**

Run: `npx vitest run lib/__tests__/projectMaterialReconciliation.test.ts lib/__tests__/projectMaterialPlanningService.aggregate.test.ts lib/__tests__/projectMaterialTabUtils.test.ts`

Expected: PASS.

### Task 6: Validate locally, deploy once to Supabase Cloud, and audit

**Files:**
- Modify: `docs/v1-kiem-soat-vat-tu-boq-kho-cong-truong-design.md`

- [x] **Step 1: Run the complete local verification suite**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all tests pass, TypeScript exits 0, Vite build exits 0.

- [x] **Step 2: Capture read-only Cloud preflight totals**

Use the configured `.env` project and Management SQL endpoint. Record warehouse/site/project mappings, ledger row counts, issue/party totals, and physical balances. Do not run Supabase local or Docker.

- [x] **Step 3: Apply the forward migration to Supabase Cloud**

Submit the exact migration file contents as one database query so PostgreSQL transaction semantics protect the cut-over. Stop on any invariant assertion.

- [x] **Step 4: Run the Cloud smoke test and post-deploy audits**

Run the SQL smoke test against the linked Cloud project, then compare pre/post physical balances, scoped ledger counts, issue scope counts, and `issued = returned + consumed + lost + open` violations.

- [x] **Step 5: Mark the design implemented and document evidence**

Update status, migration timestamp, test results, Cloud audit counts, and any intentionally deferred acceptance item. Do not claim an item complete without verification output.

- [x] **Step 6: Review the diff**

Run: `git status --short && git diff --check && git diff --stat`

Expected: only V1 files plus the approved design/plan are changed; no secrets or unrelated booking work are included.

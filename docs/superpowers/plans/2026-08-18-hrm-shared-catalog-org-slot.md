# HRM Shared Catalog and Organization Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first production release of shared HRM catalogs, organization hierarchy, position slots, employee assignments, direct-manager resolution, and manual allowances.

**Architecture:** Extend the existing HRM tables instead of duplicating them. New effective-dated slot, assignment, and allowance tables are protected by RLS and database constraints; a focused frontend service and settings workspace consume them without adding more state to `AppContext`.

**Tech Stack:** PostgreSQL/Supabase Cloud, React 18, TypeScript, Supabase JS, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-hrm-shared-catalog-org-slot-design.md`

## Global Constraints

- Supabase Cloud only through the repository `.env`; no local Supabase and no Docker.
- Do not change or calculate P3 in this release.
- Business level codes are `E1` through `E11`.
- K4, VPHN, and C6 are inactive, not hard-deleted.
- No sub-agents.

---

### Task 1: Database contract and normalization

**Files:**
- Create: `supabase/migrations/<generated>_hrm_shared_catalog_org_slots.sql`
- Create: `supabase/tests/hrm_shared_catalog_org_slots_smoke.sql`
- Create: `lib/__tests__/hrmSharedCatalogMigration.test.ts`

**Interfaces:**
- Produces tables `hrm_org_position_slots`, `hrm_employee_slot_assignments`, `hrm_employee_manual_allowances` and column `org_units.manager_slot_id`.
- Produces `app_private.resolve_slot_direct_manager(uuid)` and updates `app_private.resolve_active_direct_manager(uuid)`.

- [ ] Write a migration contract test that checks table names, RLS, E-level normalization, CG seed, inactive K4/C6 and slot-first manager resolution.
- [ ] Run `npx vitest run lib/__tests__/hrmSharedCatalogMigration.test.ts` and verify it fails because the migration does not exist.
- [ ] Create the migration filename with `npx supabase@2.110.0 migration new hrm_shared_catalog_org_slots`.
- [ ] Implement schema, constraints, indexes, RLS, hierarchy normalization, baseline slot backfill and resolver functions in one transaction.
- [ ] Add a rollback-safe Cloud smoke script whose transaction ends with `rollback` after exercising slot, assignment, manager and allowance constraints.
- [ ] Run the migration contract test and verify it passes.

### Task 2: Typed domain model

**Files:**
- Create: `types/hrmSharedCatalog.ts`
- Create: `lib/hrmSharedCatalogModel.ts`
- Create: `lib/__tests__/hrmSharedCatalogModel.test.ts`
- Modify: `types.ts`

**Interfaces:**
- Produces `HrmSharedCatalogBundle`, `HrmOrgPositionSlot`, `HrmEmployeeSlotAssignment`, `HrmManualAllowance`, catalog record types, `deriveSlotOccupancy`, `buildOrgTree`, and validation helpers.

- [ ] Write failing tests for vacant/occupied derivation, one primary assignment, reporting cycle detection and Vietnamese search normalization.
- [ ] Run the model test and verify missing exports cause the expected failure.
- [ ] Implement minimal pure functions and public types; export them from `types.ts`.
- [ ] Run the model tests and verify they pass.

### Task 3: Supabase service

**Files:**
- Create: `lib/hrmSharedCatalogService.ts`
- Create: `lib/__tests__/hrmSharedCatalogService.test.ts`

**Interfaces:**
- Consumes the tables from Task 1 and types from Task 2.
- Produces `listBundle`, catalog upsert/archive, org-unit update, slot upsert/archive, assignment create/end, manager-slot update and manual-allowance upsert/archive methods.

- [ ] Write failing service tests with complete Supabase response fixtures and assert mapped user-visible results, payload validation and error propagation.
- [ ] Run the service test and verify it fails because the service is missing.
- [ ] Implement row mappers, queries and mutations with snake-case payloads.
- [ ] Run the service test and verify it passes.

### Task 4: Shared HRM settings workspace

**Files:**
- Create: `pages/settings/SettingsHrmSharedCatalog.tsx`
- Create: `components/hrm-shared/HrmSharedOverview.tsx`
- Create: `components/hrm-shared/HrmCatalogManager.tsx`
- Create: `components/hrm-shared/HrmOrganizationWorkspace.tsx`
- Create: `components/hrm-shared/HrmSlotWorkspace.tsx`
- Create: `components/hrm-shared/HrmManualAllowanceWorkspace.tsx`
- Create: `components/hrm-shared/HrmEditorDialog.tsx`
- Create: `lib/__tests__/hrmSharedCatalogUiContract.test.ts`
- Modify: `pages/Settings.tsx`
- Modify: `lib/settingsPermissions.ts`

**Interfaces:**
- Consumes `hrmSharedCatalogService.listBundle()` and mutation methods.
- Produces the single settings entry `Danh mục dùng chung HRM` with five internal tabs.

- [ ] Write a failing UI contract test for the single navigation label, removal of the separate org-chart entry, internal tab copy and accessible form labels.
- [ ] Run the UI contract test and verify it fails against the existing settings page.
- [ ] Implement the page shell, bundle loading, error/retry states and mutation refresh flow.
- [ ] Implement catalog, hierarchy, slot/assignment, and manual allowance editors using the existing slate/teal ERP visual language.
- [ ] Replace the two old settings entries with the shared entry while accepting either legacy permission token.
- [ ] Run UI contract and model/service tests.

### Task 5: Cloud deployment and integration verification

**Files:**
- Modify: `package.json` only if a reusable smoke script is needed.

**Interfaces:**
- Deploys Task 1 migration to the linked Cloud project.
- Validates frontend against the deployed schema.

- [ ] Run `npx supabase@2.110.0 db advisors --linked` and record pre-existing findings separately from this migration.
- [ ] Apply the migration to Cloud using the supported linked Cloud command discovered from `--help`.
- [ ] Run `supabase/tests/hrm_shared_catalog_org_slots_smoke.sql` against Cloud and verify rollback leaves no test rows.
- [ ] Query aggregate integrity: K1–K3 active, K4/C6 inactive, E1–E11 active, CG active, no invalid active slot assignments and no reporting cycles.
- [ ] Run targeted Vitest files, `npm run lint`, full `npm test`, and `npm run build`.
- [ ] Inspect the settings workspace at desktop and mobile widths; fix clipping, contrast, empty states and action feedback.


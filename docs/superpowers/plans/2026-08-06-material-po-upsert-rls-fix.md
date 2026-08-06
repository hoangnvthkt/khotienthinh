# Material PO UPSERT RLS Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore creation of draft project POs through the existing UPSERT call for non-admin members who have Room PO `view` and `edit`.

**Architecture:** Keep Room PO authoritative and change only the `purchase_orders_select` RLS policy so it evaluates the candidate row's columns directly. Keep `app_private.purchase_order_can_view(id)` for dependent tables, and prove the fix with both a migration contract test and a real linked-Cloud UPSERT transaction that always rolls back.

**Tech Stack:** PostgreSQL/Supabase RLS, Supabase CLI 2.95+, TypeScript, Vitest.

## Global Constraints

- Do not add PBAC fallback, module-admin bypass, or frontend save branching.
- Preserve company-consolidated PO, WMS keeper, archived-row, and dependent-record visibility semantics.
- Create the migration with `supabase migration new`; apply Cloud only after local tests and a rollback-only Cloud dry-run pass.
- Every diagnostic SQL write must be enclosed in a transaction that rolls back.

---

### Task 1: Add the failing migration regression contract

**Files:**
- Create: `lib/__tests__/materialPoUpsertRlsFixMigration.test.ts`
- Reference: `supabase/migrations/20260804095711_material_po_room_authoritative_cutover.sql`

**Interfaces:**
- Consumes: migration files under `supabase/migrations`.
- Produces: a regression gate requiring one `_material_po_upsert_rls_fix.sql` migration with a direct row predicate.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_material_po_upsert_rls_fix.sql'));
const sql = migrationFile ? readFileSync(join(migrationDirectory, migrationFile), 'utf8') : '';

describe('Material PO UPSERT RLS fix migration', () => {
  it('authorizes purchase_orders SELECT from candidate row columns', () => {
    expect(migrationFile).toBeDefined();
    expect(sql).toContain('drop policy if exists purchase_orders_select');
    expect(sql).toContain("source_mode = 'company_consolidated'");
    expect(sql).toContain('app_private.current_actor_has_effective_room_action(');
    expect(sql).toContain("'material_po', 'view'");
    expect(sql).toContain('app_private.current_user_is_global_wms_keeper()');
    expect(sql).toContain('app_private.current_user_is_wms_keeper_for(target_warehouse_id)');
    expect(sql).not.toContain('using (app_private.purchase_order_can_view(id))');
  });
});
```

The production change caught by this test is restoring the broken helper-by-id SELECT policy or omitting one of the existing visibility paths.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run lib/__tests__/materialPoUpsertRlsFixMigration.test.ts
```

Expected: FAIL because `migrationFile` is undefined.

---

### Task 2: Add the minimal policy migration and Cloud smoke test

**Files:**
- Create via CLI: `supabase/migrations/<timestamp>_material_po_upsert_rls_fix.sql`
- Create: `supabase/tests/material_po_upsert_rls_fix_smoke.sql`
- Test: `lib/__tests__/materialPoUpsertRlsFixMigration.test.ts`

**Interfaces:**
- Consumes: `app_private.current_actor_has_effective_room_action`, `company_procurement_can_manage`, `company_purchase_order_can_view_from_links`, and WMS keeper helpers.
- Produces: `purchase_orders_select` policy with unchanged visibility semantics and UPSERT-safe row evaluation.

- [ ] **Step 1: Generate the migration file**

Run:

```bash
npx supabase migration new material_po_upsert_rls_fix
```

- [ ] **Step 2: Implement the minimal migration**

```sql
-- Keep parent PO visibility Room-authoritative while allowing INSERT ... ON
-- CONFLICT to evaluate the candidate row before its id is queryable.
drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select
  on public.purchase_orders
  for select
  to authenticated
  using (
    archived_at is null
    and (
      (
        source_mode = 'company_consolidated'
        and (
          app_private.company_procurement_can_manage()
          or app_private.company_purchase_order_can_view_from_links(id)
        )
      )
      or (
        source_mode is distinct from 'company_consolidated'
        and (
          app_private.current_actor_has_effective_room_action(
            project_id, construction_site_id, 'material_po', 'view'
          )
          or app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
        )
      )
    )
  );

notify pgrst, 'reload schema';
```

- [ ] **Step 3: Write the rollback-only behavioral smoke test**

Create a SQL transaction that:

1. Selects one active non-admin user with Room PO `view` and `edit`, plus one existing normal PO in that exact project/site scope, into a temporary fixture table.
2. Grants the authenticated role access to that temporary fixture.
3. Sets local role `authenticated` and JWT claims for the selected user.
4. Calls `next_purchase_order_number_v2()` and executes `INSERT ... ON CONFLICT (id) DO UPDATE` with `status='draft'`, `source_mode='from_request'`, and `created_by_id` equal to the actor.
5. Raises an exception unless the new row is selectable through RLS.
6. Resets the role, returns `material_po_upsert_rls_fix_smoke_passed`, and rolls back.

Use literal assertions for the expected success marker and do not use a service-role bypass.

- [ ] **Step 4: Run the focused migration tests and verify GREEN**

Run:

```bash
npx vitest run \
  lib/__tests__/materialPoUpsertRlsFixMigration.test.ts \
  lib/__tests__/materialPoRoomAuthoritativeCutoverMigration.test.ts \
  lib/__tests__/materialPoRoomFrontendCutoverContract.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the implementation and regression assets**

```bash
git add lib/__tests__/materialPoUpsertRlsFixMigration.test.ts \
  supabase/migrations/*_material_po_upsert_rls_fix.sql \
  supabase/tests/material_po_upsert_rls_fix_smoke.sql
git commit -m "fix: allow Room-authorized PO upserts"
```

---

### Task 3: Verify and release the Cloud policy

**Files:**
- Read: `supabase/migrations/<timestamp>_material_po_upsert_rls_fix.sql`
- Read: `supabase/tests/material_po_upsert_rls_fix_smoke.sql`
- Modify: `docs/security/material-po-room-authoritative-cutover-live-apply-log.md`

**Interfaces:**
- Consumes: the migration and rollback-only smoke test from Task 2.
- Produces: verified Cloud policy and an auditable release note.

- [ ] **Step 1: Run static verification**

```bash
npm test -- --run
npm run build
git diff --check HEAD~1
```

Expected: zero test failures, build exit code 0, and no whitespace errors.

- [ ] **Step 2: Run a linked-Cloud dry-run with the migration and smoke in one outer transaction**

```bash
set -a
source .env
set +a
awk 'FNR == 1 && NR == 1 { print "begin;" } { print }' \
  supabase/migrations/*_material_po_upsert_rls_fix.sql \
  supabase/tests/material_po_upsert_rls_fix_smoke.sql \
  | npx supabase db query --linked --agent=no -o table -f -
```

Expected: `material_po_upsert_rls_fix_smoke_passed`; the smoke's final rollback also rolls back the migration and diagnostic PO.

- [ ] **Step 3: Confirm dry-run left no diagnostic data or policy change**

Query Cloud for the current `purchase_orders_select` definition and confirm it still equals `using (app_private.purchase_order_can_view(id))`. Confirm no PO number allocated by the smoke is attached to a diagnostic id.

- [ ] **Step 4: Apply the migration to Cloud**

```bash
set -a
source .env
set +a
npx supabase db query --linked --agent=no -o table \
  -f supabase/migrations/*_material_po_upsert_rls_fix.sql
```

Expected: command exits 0 and PostgREST receives the schema reload notification.

- [ ] **Step 5: Run the post-apply smoke**

```bash
set -a
source .env
set +a
npx supabase db query --linked --agent=no -o table \
  -f supabase/tests/material_po_upsert_rls_fix_smoke.sql
```

Expected: `material_po_upsert_rls_fix_smoke_passed`; diagnostic row and number allocation are rolled back.

- [ ] **Step 6: Record release evidence**

Append the date, migration filename, pre/post policy hashes, focused/full test results, build result, dry-run marker, post-apply smoke marker, and rollback policy definition to the existing live apply log.

- [ ] **Step 7: Commit the release evidence**

```bash
git add docs/security/material-po-room-authoritative-cutover-live-apply-log.md
git commit -m "docs: record material PO upsert RLS release"
```

- [ ] **Step 8: Run final verification**

```bash
npm test -- --run
npm run build
git status --short
```

Expected: zero failures, build exit code 0, and only intentional committed changes.


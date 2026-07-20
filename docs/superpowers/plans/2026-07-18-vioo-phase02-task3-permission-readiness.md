# VIOO Phase 02 Task 3 Permission Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify all 21 permission codes blocking Phase 02 Closure Task 3, promote only the exact codes with complete backend evidence through a new forward migration, and return to Task 3 only when read-only Cloud evidence reports zero blocking rows for all 12 pending principals.

**Architecture:** Use an evidence-first readiness tranche. Freeze the Cloud-derived 21-code inventory without principal data, classify each code against its real backend handler, strengthen the existing transactional Material smoke for the three current promotion candidates, and keep every catalog-only or mismatched code at `declared`. A static migration contract, local frontend readiness mapping, rollback-only Cloud smoke, exact apply/repair gate, and post-apply aggregate verification keep the database and UI aligned without weakening `app_private.assert_unified_direct_grant_readiness(...)`.

**Tech Stack:** TypeScript 5.8, Vitest 4, PostgreSQL 15+, Supabase CLI 2.95.6+, transactional SQL smoke tests, Supabase linked Cloud project.

## Global Constraints

- This work remains inside **Phase 02 — Business Role and Minimal SoD**. Do not begin Phase 03 source-mode or module-lifecycle implementation.
- Do not Save or partially Save any of the 12 pending principals while any approved row remains blocked.
- Do not print or commit user IDs, emails, Auth IDs, tokens, database URLs, `.env` contents, raw manifest rows, or private runtime paths.
- Do not mutate Supabase Cloud without explicit approval for the exact checkpoint.
- Cloud Gate A authorizes only rollback-only backend smoke before promotion. Cloud Gate B separately authorizes exact migration apply/repair.
- Do not edit applied migrations `20260718092455_unified_permission_change_command.sql` or `20260718123119_authorization_audit_readiness.sql`; every defect uses a new forward migration.
- Create this migration with `npx supabase migration new phase02_task3_permission_readiness` after checking the relevant CLI `--help` output.
- Do not use `supabase db push`, local Supabase, Docker, `--local`, `supabase start`, or `supabase reset`.
- Do not edit, stage, format, overwrite, or revert `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.
- Keep all four authorization rollout flags `false` throughout this prerequisite.
- Preserve the approved grant arithmetic and non-sensitive baseline: `467 = 421 REGRANT + 46 DROP`, `103` active sensitive rows, `318` pending approved rows, `2179` active non-sensitive rows, and fingerprint `632d0ce644dcec52126eabf7b44909ca` until Task 3 is explicitly resumed.
- A code may become `verified` only after its backend action proves intended allow, wrong-scope denial, invalid state or ownership denial where applicable, and adjacent-action denial.
- Existing frontend checks or permission-catalog presence are supporting evidence only; they are not sufficient for readiness promotion.

---

## Readiness Disposition Before Implementation

The 21-code set is frozen from read-only Cloud evidence. Initial repository inspection gives three categories; tests, not this table, make the final promotion decision.

| Disposition | Permission codes | Required result |
| --- | --- | --- |
| Promotion candidates | `project.material_request.approve`, `project.material_po.approve`, `project.custom_material.approve` | Strengthen the existing Material backend smoke; promote only if every required negative and positive assertion passes. |
| Catalog/handler mismatch | `project.material_request.confirm` | Keep `declared`; the modern handler uses `project.material_request.confirm_fulfillment`. Resolve alias/deprecation semantics in a separate approved design before any promotion. |
| No complete backend behavior evidence | `project.contract.approve`, `project.daily_log.confirm`, `project.material_request.verify`, `project.payment.approve`, `project.payment.confirm`, `project.payment.mark_paid`, `project.payment.verify`, `project.quality.approve`, `project.quality.confirm`, `project.quality.verify`, `project.quantity_acceptance.approve`, `project.quantity_acceptance.verify`, `project.safety.approve`, `project.safety.verify`, `project.subcontract.approve`, `project.weekly_progress.approve`, `project.weekly_progress.verify` | Keep `declared`; record the exact missing handler/state/scope/adjacent-action evidence and split later implementation by module. |

This tranche can reduce the blocker but may not unblock a principal. Task 3 remains stopped unless post-apply Cloud evidence proves every pending approved row is `verified` or `enforced` and all 12 principals have complete grantable drafts.

## Execution Order Correction

The original numbered draft incorrectly placed the Cloud smoke after the readiness migration even though the smoke is the evidence required to justify that migration. The binding execution sequence is: Tasks 1–3, the Task 5 immutable preflight without a generated-migration check, Cloud Gate A and Task 6 rollback-only Material smoke, Task 4 local migration/frontend work, a repeated complete Task 5 preflight, then Cloud Gate B and Task 7 apply/repair. No readiness migration is created, executed, or repaired before the Material smoke passes.

Cloud Gate A executed on `2026-07-18T22:07:56+07:00` and failed at the
Material Request invalid-state assertion: the current handler accepted
`DRAFT -> APPROVED`. The transaction rolled back and post-failure aggregate
evidence matched the baseline. Therefore Task 4 is blocked: no migration or
frontend readiness change may be created until a separately designed forward
handler fix proves the `PENDING -> APPROVED` state guard and the full smoke
passes.

### Task 1: Freeze the 21-code evidence inventory

**Files:**

- Create: `docs/security/phase02-task3-permission-readiness-matrix.md`
- Verify: `docs/session-handoff-2026-07-18-phase02-task3-readiness.md`
- Verify: `lib/permissions/permissionReadiness.ts`
- Verify: `supabase/tests/phase3_material_permissions_smoke.sql`
- Verify: `supabase/tests/phase3_payment_contract_permissions_smoke.sql`
- Verify: `supabase/tests/phase3_quality_safety_documents_smoke.sql`

**Interfaces:**

- Consumes: read-only aggregate Cloud evidence and repository handler/smoke references.
- Produces: a principal-free evidence matrix with one row per blocking code and an explicit `CANDIDATE`, `MISMATCH`, or `BLOCKED` disposition.

- [ ] **Step 1: Reconfirm Git boundaries**

Run:

```bash
git branch --show-current
git rev-parse HEAD
git status --short --branch
git diff --cached --name-only
```

Expected: branch `refactor/module-du-an-v1`, expected handoff HEAD or a clearly explained forward commit, the user-owned roadmap still dirty, and no staged files.

- [ ] **Step 2: Reconfirm the Cloud inventory read-only**

First discover the CLI surface:

```bash
npx supabase --version
npx supabase db query --help
```

Run one linked `SELECT` that returns only `permission_code`, pending row count, `grant_readiness`, risk level, allowed scope types, and expiry requirement. It must return exactly these 21 codes and no principal columns:

```text
project.contract.approve
project.custom_material.approve
project.daily_log.confirm
project.material_po.approve
project.material_request.approve
project.material_request.confirm
project.material_request.verify
project.payment.approve
project.payment.confirm
project.payment.mark_paid
project.payment.verify
project.quality.approve
project.quality.confirm
project.quality.verify
project.quantity_acceptance.approve
project.quantity_acceptance.verify
project.safety.approve
project.safety.verify
project.subcontract.approve
project.weekly_progress.approve
project.weekly_progress.verify
```

Expected aggregate: `21` declared blocking codes, `291` pending declared rows, and `12/12` pending principals blocked. Any mismatch stops the tranche and updates the handoff before code changes.

- [ ] **Step 3: Write the evidence matrix**

Create `docs/security/phase02-task3-permission-readiness-matrix.md` with this exact schema:

```markdown
| Permission code | Backend entry point | Intended allow | Scope denial | State/ownership denial | Adjacent-action denial | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `project.material_request.approve` | `public.transition_project_material_request_status(...)` | `phase3_material_permissions_smoke.sql` | missing | existing state transition | missing | `CANDIDATE` |
```

Add all 21 rows. Use `missing` when evidence does not exist; never infer enforcement from a template, UI capability, or catalog seed.

- [ ] **Step 4: Verify matrix completeness**

Run:

```bash
test "$(rg -c '^\| `project\.' docs/security/phase02-task3-permission-readiness-matrix.md)" -eq 21
rg -n 'T[B]D|T[O]DO|unknown|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+' docs/security/phase02-task3-permission-readiness-matrix.md
```

Expected: row count check passes; the second command has no output. Replace ambiguous entries with `missing` plus the exact missing evidence.

- [ ] **Step 5: Commit only the evidence matrix**

Before staging, run `git diff --cached --name-only` and require empty output. Then:

```bash
git add docs/security/phase02-task3-permission-readiness-matrix.md
git diff --cached --name-only
git commit -m "docs(authz): classify task 3 readiness blockers"
```

Expected staged path before commit: only `docs/security/phase02-task3-permission-readiness-matrix.md`. The dirty roadmap and handoff remain unstaged.

### Task 2: Add a failing exact promotion contract

**Files:**

- Create: `lib/__tests__/phase02Task3PermissionReadinessMigration.test.ts`
- Create through Supabase CLI: the unique migration ending `_phase02_task3_permission_readiness.sql`
- Modify: `lib/__tests__/permissionReadiness.test.ts`
- Modify later: `lib/permissions/permissionReadiness.ts`

**Interfaces:**

- Consumes: the three `CANDIDATE` rows from Task 1.
- Produces: a static guard that permits exactly three candidate promotions and forbids mismatch, catalog-only codes, rollout changes, or edits to historical migrations.

- [ ] **Step 1: Write the failing migration contract**

Create `lib/__tests__/phase02Task3PermissionReadinessMigration.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_phase02_task3_permission_readiness.sql'));

const promotable = [
  'project.material_request.approve',
  'project.material_po.approve',
  'project.custom_material.approve',
] as const;

describe('Phase 02 Task 3 permission readiness migration', () => {
  it('promotes only the exact evidence-backed tranche', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');
    for (const code of promotable) expect(sql).toContain(`'${code}'`);
    expect(sql).toMatch(/grant_readiness\s*=\s*'verified'/i);
    expect(sql).toMatch(/grant_readiness\s*=\s*'declared'/i);
    expect(sql).toMatch(/get diagnostics\s+v_updated\s*=\s*row_count/i);
    expect(sql).toMatch(/v_updated\s*<>\s*3/i);
    expect(sql).not.toContain("'project.material_request.confirm'");
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
    expect(sql).not.toMatch(/user_permission_grants/i);
  });
});
```

- [ ] **Step 2: Extend frontend readiness tests first**

Add to `lib/__tests__/permissionReadiness.test.ts`:

```ts
it('marks only the evidence-backed Task 3 tranche as verified', () => {
  expect(resolvePermissionActionReadiness(action('project.material_request.approve'))).toBe('verified');
  expect(resolvePermissionActionReadiness(action('project.material_po.approve'))).toBe('verified');
  expect(resolvePermissionActionReadiness(action('project.custom_material.approve'))).toBe('verified');
  expect(resolvePermissionActionReadiness(action('project.material_request.confirm'))).toBe('declared');
  expect(resolvePermissionActionReadiness(action('project.payment.approve'))).toBe('declared');
});
```

- [ ] **Step 3: Run the focused tests and prove RED**

Run:

```bash
npx vitest run lib/__tests__/phase02Task3PermissionReadinessMigration.test.ts lib/__tests__/permissionReadiness.test.ts
```

Expected: FAIL because the new migration does not exist and the three candidate codes still resolve to `declared`.

- [ ] **Step 4: Commit tests only**

```bash
git add lib/__tests__/phase02Task3PermissionReadinessMigration.test.ts lib/__tests__/permissionReadiness.test.ts
git diff --cached --name-only
git commit -m "test(authz): lock task 3 readiness tranche"
```

Expected: only the two test files are staged.

### Task 3: Strengthen Material backend evidence

**Files:**

- Modify: `supabase/tests/phase3_material_permissions_smoke.sql`
- Verify: `supabase/migrations/20260712145251_phase3_material_namespace.sql`
- Verify: `supabase/migrations/20260713171218_po_master_release_supplemental_approval.sql`

**Interfaces:**

- Consumes: `public.transition_project_material_request_status(...)`, `public.transition_project_purchase_order_status(...)`, and `public.transition_custom_material_request_status(...)`.
- Produces: transactional positive and negative evidence for the exact three candidate codes; all test users and rows roll back.

- [ ] **Step 1: Add wrong-scope fixtures**

Reuse the existing `no_staff_project_id` as the second project and keep each candidate actor granted only on `project_id`. Add `MR-2026-9305` to `app_private.material_request_code_registry`, then append these exact workflow rows to the existing fixture inserts:

```sql
union all
select 'phase3-mat-approve-wrong-scope', 'MR-2026-9305', warehouse_id, submitter_id,
       'PENDING'::public.request_status, '[]'::jsonb, now(), now() + interval '1 day',
       no_staff_project_id, site_id, 'project', 'site_manager_review', approver_id::text
from phase3_material_smoke_ids;

insert into public.purchase_orders(
  id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
  total_amount, order_date, status, source_mode, target_warehouse_id, created_by_id, created_at
)
select 'phase3-po-approve-wrong-scope', no_staff_project_id, site_id, 'phase3-vendor',
       'NCC Smoke', 'PO-20269308', '[]'::jsonb, 0, current_date::text, 'draft',
       'proactive_project', warehouse_id, po_creator_id::text, now()
from phase3_material_smoke_ids;

insert into public.custom_material_requests(
  id, code, title, project_id, construction_site_id, status, created_by, updated_by
)
select '22222222-2222-4222-8222-222222222222'::uuid, 'PHASE3-CMR-WRONG-SCOPE',
       'Phase 3 CMR wrong scope', no_staff_project_id, site_id, 'submitted',
       custom_creator_id, custom_creator_id
from phase3_material_smoke_ids
union all
select '33333333-3333-4333-8333-333333333333'::uuid, 'PHASE3-CMR-DRAFT',
       'Phase 3 CMR invalid state', project_id, site_id, 'draft',
       custom_creator_id, custom_creator_id
from phase3_material_smoke_ids;
```

Also add `PO-20269308` to `app_private.purchase_order_number_registry` if the fixture registry enforces uniqueness.

- [ ] **Step 2: Prove material-request approve boundaries**

Keep the existing intended approval. Add two exception blocks using `pg_temp.phase3_material_smoke_set_user(approver_id)`:

```sql
do $$
declare
  v_blocked boolean;
begin
  v_blocked := false;
  begin
    perform public.transition_project_material_request_status(
      'phase3-mat-approve-wrong-scope', 'APPROVED', 'APPROVED',
      (select approver_id::text from phase3_material_smoke_ids),
      null, null, null,
      jsonb_build_object('status', 'APPROVED', 'workflow_step', 'batch_planning')
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.material_request.approve incorrectly crossed project scope';
  end if;

  v_blocked := false;
  begin
    perform public.transition_project_material_request_status(
      'phase3-mat-create-only', 'APPROVED', 'APPROVED',
      (select approver_id::text from phase3_material_smoke_ids),
      null, null, null,
      jsonb_build_object('status', 'APPROVED', 'workflow_step', 'batch_planning')
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.material_request.approve incorrectly bypassed workflow state';
  end if;
end $$;
```

Preserve the existing adjacent denial that a Create-only actor cannot submit or approve. If the invalid-state assertion exposes a real handler gap, stop here and write a focused forward handler fix; do not weaken the assertion or create a readiness migration.

- [ ] **Step 3: Prove purchase-order approve boundaries**

Keep the existing intended `draft -> confirmed` transition and existing denial that Approve cannot Receive. With `po_approver_id` active, add:

```sql
do $$
declare
  v_blocked boolean;
begin
  v_blocked := false;
  begin
    perform public.transition_project_purchase_order_status(
      'phase3-po-approve-wrong-scope', 'confirmed', jsonb_build_object('status', 'confirmed')
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.material_po.approve incorrectly crossed project scope';
  end if;

  v_blocked := false;
  begin
    perform public.transition_project_purchase_order_status(
      'phase3-po-receive', 'confirmed', jsonb_build_object('status', 'confirmed')
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.material_po.approve incorrectly bypassed workflow state';
  end if;
end $$;
```

If the invalid-state assertion exposes a handler gap, stop and keep `project.material_po.approve` declared.

- [ ] **Step 4: Prove custom-material approve boundaries**

Keep the existing intended approval. With `custom_approver_id` active, add:

```sql
do $$
declare
  v_blocked boolean;
begin
  v_blocked := false;
  begin
    perform public.transition_custom_material_request_status(
      '22222222-2222-4222-8222-222222222222'::uuid,
      'approved',
      (select custom_approver_id from phase3_material_smoke_ids),
      'Wrong-scope denial'
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.custom_material.approve incorrectly crossed project scope';
  end if;

  v_blocked := false;
  begin
    perform public.transition_custom_material_request_status(
      '33333333-3333-4333-8333-333333333333'::uuid,
      'approved',
      (select custom_approver_id from phase3_material_smoke_ids),
      'Invalid-state denial'
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.custom_material.approve incorrectly bypassed workflow state';
  end if;

  begin
    insert into public.custom_material_requests(
      id, code, title, project_id, construction_site_id, status, created_by, updated_by
    )
    select gen_random_uuid(), 'PHASE3-CMR-APPROVER-CREATE-DENY', 'Adjacent denial',
           project_id, site_id, 'draft', custom_approver_id, custom_approver_id
    from phase3_material_smoke_ids;
    raise exception 'project.custom_material.approve incorrectly allowed create';
  exception when insufficient_privilege then
    null;
  end;
end $$;
```

If the invalid-state assertion exposes a handler gap, stop and keep `project.custom_material.approve` declared.

- [ ] **Step 5: Add one deterministic checkpoint**

Immediately before the final `rollback`, add:

```sql
select 'phase02_task3_material_readiness_smoke_passed' as checkpoint;
```

- [ ] **Step 6: Review the SQL without Cloud execution**

Run:

```bash
rg -n 'phase02_task3_material_readiness_smoke_passed|crossed project scope|bypassed workflow state|incorrectly allowed' supabase/tests/phase3_material_permissions_smoke.sql
git diff --check
```

Expected: all three candidate sections have positive and negative assertions; `git diff --check` exits `0`.

- [ ] **Step 7: Commit the strengthened rollback-only smoke**

```bash
git add supabase/tests/phase3_material_permissions_smoke.sql
git diff --cached --name-only
git commit -m "test(authz): prove material approval readiness"
```

Expected: only the Material smoke is staged.

### Task 4: Implement the exact local readiness tranche

**Files:**

- Create through CLI: `supabase/migrations/<generated>_phase02_task3_permission_readiness.sql`
- Modify: `lib/permissions/permissionReadiness.ts`

**Interfaces:**

- Consumes: passing rollback-only Material smoke evidence from Task 6 and failing tests from Task 2.
- Produces: exactly three database and frontend `verified` codes; every other blocking code remains `declared`.

- [ ] **Step 1: Discover and create the migration**

Run:

```bash
npx supabase migration --help
npx supabase migration new --help
npx supabase migration new phase02_task3_permission_readiness
```

Resolve the generated path with:

```bash
rg --files supabase/migrations | rg '_phase02_task3_permission_readiness\.sql$'
```

Expected: exactly one path.

- [ ] **Step 2: Write the fail-closed forward migration**

Use this complete migration body:

```sql
do $$
declare
  v_updated integer;
begin
  update public.permission_actions
  set grant_readiness = 'verified',
      updated_at = now()
  where permission_code in (
    'project.material_request.approve',
    'project.material_po.approve',
    'project.custom_material.approve'
  )
    and is_active
    and grant_readiness = 'declared';

  get diagnostics v_updated = row_count;
  if v_updated <> 3 then
    raise exception 'Expected exactly 3 Phase 02 Task 3 readiness promotions, updated %', v_updated;
  end if;

  if (
    select count(*)
    from public.permission_actions
    where permission_code in (
      'project.material_request.approve',
      'project.material_po.approve',
      'project.custom_material.approve'
    )
      and is_active
      and grant_readiness = 'verified'
  ) <> 3 then
    raise exception 'Phase 02 Task 3 readiness postcondition failed';
  end if;
end $$;
```

- [ ] **Step 3: Align frontend readiness**

Add only these entries to `VERIFIED_PERMISSION_CODES` in `lib/permissions/permissionReadiness.ts`:

```ts
'project.material_request.approve',
'project.material_po.approve',
'project.custom_material.approve',
```

Do not add `project.material_request.confirm`, any payment/contract/quality/safety/progress code, or any umbrella `manage` action.

- [ ] **Step 4: Run focused tests and prove GREEN**

Run:

```bash
npx vitest run lib/__tests__/phase02Task3PermissionReadinessMigration.test.ts lib/__tests__/permissionReadiness.test.ts lib/__tests__/materialPermissions.phase3.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Run broader local verification**

Run:

```bash
npm run lint
npm test
git diff --check
```

Expected: TypeScript and Vitest suites pass; no whitespace errors. Existing unrelated failures must be recorded and separated from this tranche before continuing.

- [ ] **Step 6: Commit only local implementation files**

```bash
git add lib/permissions/permissionReadiness.ts supabase/migrations/*_phase02_task3_permission_readiness.sql
git diff --cached --name-only
git commit -m "feat(authz): verify material approval readiness"
```

Expected staged paths: exactly the readiness source and generated migration. Never use `git add .`.

### Task 5: Reconfirm immutable Cloud preflight

**Files:**

- Modify after evidence exists: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Verify: `supabase/migrations/<generated>_phase02_task3_permission_readiness.sql`
- Verify: `supabase/tests/phase3_material_permissions_smoke.sql`

**Interfaces:**

- Consumes: the locally verified exact candidate commit.
- Produces: read-only evidence that Cloud still matches the Task 3 handoff and that the forward migration is unapplied.

- [ ] **Step 1: Verify no accidental staging or protected-file edits**

Run:

```bash
git status --short --branch
git diff --cached --name-only
git diff --name-only -- docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md
```

Expected: nothing staged; the final command may show the user's pre-existing dirty roadmap but this task has not modified it.

- [ ] **Step 2: Verify migration history read-only**

Run `npx supabase migration list --help`, then a linked migration-list read. Confirm applied versions `20260718092455` and `20260718123119` remain present and the new generated version is not yet applied.

- [ ] **Step 3: Re-run aggregate baseline SELECTs**

Return only counts, booleans, and fingerprints. Require:

```text
source = 467
approved regrant = 421
drop = 46
active sensitive = 103 across 10 principals
pending approved = 318 across 12 principals
pending declared rows = 291
blocking codes = 21
blocked principals = 12
active non-sensitive = 2179
non-sensitive fingerprint = 632d0ce644dcec52126eabf7b44909ca
Audit-capable actors = 2
active Business Role assignments = 3
rollout false flags = 4/4
warning acceptances = 0
```

Any mismatch stops before Cloud Gate A.

- [ ] **Step 4: Record read-only preflight evidence**

Append only aggregate values, migration filename/hash, Git commit, and timestamp to `docs/security/phase02-business-role-sod-live-apply-log.md`. Do not include identities or raw rows.

- [ ] **Step 5: Stop for explicit Cloud Gate A approval**

Before a migration exists, ask approval for exactly: execute the strengthened Material smoke in one linked Cloud transaction that always rolls back. This approval does not authorize migration creation, migration apply/repair, or Task 3 Save.

### Task 6: Run rollback-only Cloud backend smoke before promotion

**Files:**

- Execute rollback-only: `supabase/tests/phase3_material_permissions_smoke.sql`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: explicit Cloud Gate A approval.
- Produces: proof that all three backend behavior checks pass while persistent Cloud state remains unchanged.

- [ ] **Step 1: Re-read CLI help and build one transactional input**

Use `npx supabase db query --help`. Execute the strengthened Material smoke in its existing `BEGIN`/`ROLLBACK` wrapper through one linked session. Do not create a migration, use `db push`, or change migration history.

- [ ] **Step 2: Require the deterministic checkpoint**

Expected output includes only the normal command status and:

```text
phase02_task3_material_readiness_smoke_passed
```

Any SQL exception fails Gate A. Do not create a migration, patch an applied migration, or retry after changing Cloud state.

- [ ] **Step 3: Prove rollback with read-only evidence**

Require readiness totals to remain `229 declared / 59 legacy / 13 verified`, blocking codes to remain `21`, active grants and fingerprints to match Task 5, rollout flags to remain `false`, and no new migration-history entry.

- [ ] **Step 4: Record Gate A evidence and stop for Cloud Gate B**

Append the rollback timestamp, checkpoint, smoke-file hash, and unchanged aggregate totals to the apply log. Only after the smoke passes may Task 4 create a local forward migration; after a repeated Task 5 preflight, ask separate approval to apply and repair that exact generated migration. Do not Save any principal.

### Task 7: Apply and repair the exact forward migration

**Files:**

- Apply exactly: `supabase/migrations/<generated>_phase02_task3_permission_readiness.sql`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: explicit Cloud Gate B approval and passing Gate A evidence.
- Produces: one new applied migration-history entry and exactly three additional `verified` permission actions.

- [ ] **Step 1: Reconfirm exact artifact identity**

Recompute the migration SHA-256, compare it with Gate A, confirm `git status --short --branch`, and require no staged files. A hash or HEAD mismatch invalidates the approval.

- [ ] **Step 2: Apply only the migration body**

Use the previously discovered linked `db query` syntax to execute the exact migration file once. Do not execute the smoke in this persistent step.

- [ ] **Step 3: Repair only the generated migration version**

Run `npx supabase migration repair --help`, then mark exactly the generated version applied using the documented linked flag. Do not repair any other migration version.

- [ ] **Step 4: Verify migration history and readiness read-only**

Expected immediately after apply:

```text
readiness totals = 226 declared / 59 legacy / 16 verified
new readiness migration = applied exactly once
rollout false flags = 4/4
```

Also require the three candidate codes to be `verified` and all other 18 blockers to remain `declared`.

- [ ] **Step 5: Re-run the backend smoke transactionally**

Run the strengthened Material smoke in its own linked `BEGIN/ROLLBACK` session. Require `phase02_task3_material_readiness_smoke_passed` and unchanged post-rollback aggregates.

### Task 8: Recalculate Task 3 blocker status and decompose remaining work

**Files:**

- Modify: `docs/security/phase02-task3-permission-readiness-matrix.md`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Create only after evidence: one focused plan per remaining backend module under `docs/superpowers/plans/`

**Interfaces:**

- Consumes: post-apply read-only Cloud state.
- Produces: exact principal-free blocker totals and an explicit `RESUME TASK 3` or `KEEP TASK 3 BLOCKED` decision.

- [ ] **Step 1: Recompute pending readiness without identifiers**

Return only:

- pending row totals by `declared` versus `verified/enforced`;
- blocking code plus row count;
- number of blocked principals;
- number of principals whose complete approved draft is now grantable.

The expected first-tranche row movement is `44` rows (`13 + 15 + 16`) from declared to verified, but use Cloud output as authority and fail closed if it differs. Do not assume any principal becomes complete.

- [ ] **Step 2: Keep Task 3 blocked unless the exact gate is zero**

The only resume condition is:

```text
pending declared rows = 0
blocking permission codes = 0
blocked principals = 0
complete grantable pending principals = 12
```

If any value differs, do not Preview or Save a principal and do not split off only verified rows.

- [ ] **Step 3: Split remaining work by independent backend boundary**

Create separate design/implementation cycles, in this order, using the remaining rows from the matrix:

1. Material catalog mismatch: `project.material_request.confirm` versus `project.material_request.confirm_fulfillment`, plus `project.material_request.verify`.
2. Daily/weekly progress: `project.daily_log.confirm`, `project.weekly_progress.verify`, `project.weekly_progress.approve`.
3. Payment/quantity/contract: the seven payment, quantity-acceptance, and contract codes.
4. Quality/safety: the five quality and safety codes.
5. Subcontract: `project.subcontract.approve`.

Each cycle must define the real backend entry point and state machine before adding readiness. Do not put all remaining codes into one blanket migration.

- [ ] **Step 4: Record the checkpoint and commit documentation only**

Append aggregate post-apply evidence and the explicit blocker decision to the matrix and apply log. Then:

```bash
git add docs/security/phase02-task3-permission-readiness-matrix.md docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --name-only
git commit -m "docs(authz): record task 3 readiness tranche"
```

Expected: only the two evidence documents are staged.

### Task 9: Return to Phase 02 Closure Task 3 only after zero blockers

**Files:**

- Verify: `docs/superpowers/plans/2026-07-18-vioo-phase02-closure-and-phase03-entry.md`
- Verify: `docs/superpowers/plans/2026-07-18-vioo-sensitive-direct-grant-revoke-all-regrant.md`
- Modify during execution only: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: zero readiness blockers, complete 12-principal grantability, unchanged grant baselines, and a fresh explicit Task 3 approval.
- Produces: authorization to begin Task 3 Step 1 preflight; it does not itself Save a principal.

- [ ] **Step 1: Reconfirm the full immutable preflight**

Require the source/grant/fingerprint/Auditor/Role/flag baselines in the closure plan plus zero readiness blockers. Stop on any drift.

- [ ] **Step 2: Ask for explicit Task 3 resume approval**

Report only aggregate evidence and the exact next bounded batch. The readiness approvals from Tasks 6 and 7 do not authorize Preview/Save.

- [ ] **Step 3: Resume at Task 3 Step 1, not mid-batch**

After approval, follow `2026-07-18-vioo-phase02-closure-and-phase03-entry.md` Task 3 from its immutable preflight. Use fresh backend warnings and complete per-principal drafts; never reuse the failed readiness preview as acceptance evidence.

---

## Final Verification Checklist

- [ ] All 21 codes appear exactly once in the readiness matrix.
- [ ] Only evidence-backed codes appear in each readiness migration.
- [ ] `project.material_request.confirm` remains `declared` until its catalog/handler mismatch is explicitly resolved.
- [ ] Frontend readiness and Cloud `permission_actions.grant_readiness` agree.
- [ ] Applied migration files remain byte-for-byte unchanged.
- [ ] The dirty roadmap was never staged or modified by this work.
- [ ] Cloud Gate A and Gate B have separate operator approvals and evidence.
- [ ] No principal identifiers or raw manifest rows appear in logs, docs, commits, or chat.
- [ ] Task 3 remains blocked until all four zero-blocker resume conditions pass.

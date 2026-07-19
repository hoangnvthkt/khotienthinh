# Material Approval Readiness Atomic Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the three evidence-backed Material approval permissions through one auditable Cloud apply and align the frontend readiness resolver with all eight Task 3 codes that are verified at release time.

**Architecture:** Keep the work inside Phase 02 Task 3 readiness. The three already-reviewed Material state-guard migrations and one new fail-closed readiness migration are loaded in one outer Cloud transaction. The existing Material behavior smoke and the new readiness-promotion smoke run after a savepoint; only the migration objects survive the savepoint rollback. A later, separately approved history repair records exactly the four applied versions. The frontend resolver remains a local static allowlist and is released only after Cloud evidence matches it.

**Tech Stack:** PostgreSQL 15+, Supabase CLI 2.95.6, linked Supabase Cloud, transactional SQL smoke, TypeScript 5.8, Vitest 4.1.8, Vite.

## Global Constraints

- This remains **Phase 02 - Business Role and Minimal SoD**, inside the readiness prerequisite of Closure Task 3. Do not start Phase 03.
- Promote exactly project.material_request.approve, project.material_po.approve, and project.custom_material.approve.
- Keep project.payment.mark_paid, project.material_request.confirm, and project.material_request.verify declared.
- Align the frontend with the five already-verified Payment/Quantity codes plus the three Material approval codes; no dynamic Cloud-read refactor is introduced.
- Do not Preview or Save any of the 12 pending principals while any approved permission row remains blocked.
- Do not print or commit identities, emails, Auth IDs, tokens, database URLs, raw grant rows, or the approved manifest.
- Do not mutate Cloud without approval for the exact gate described in the task.
- Do not edit any applied migration, including 20260718092455_unified_permission_change_command.sql and 20260718123119_authorization_audit_readiness.sql.
- Do not use db push, local Supabase, Docker, --local, supabase start, or db reset.
- Do not edit, stage, format, overwrite, or revert docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md.
- Keep all authorization rollout flags disabled and preserve the pre-gate Direct Grant baseline.
- The local frontend change is deployment-blocked until Cloud Gate A12 postchecks pass.

## Current Evidence And Boundaries

At the starting HEAD 52d7ebe:

- The existing Material state-guard migrations are local forward artifacts and are not in Cloud migration history:
  - supabase/migrations/20260718151157_material_request_approve_state_guard.sql
  - supabase/migrations/20260718152445_purchase_order_approve_state_guard.sql
  - supabase/migrations/20260718154050_custom_material_approve_state_guard.sql
- The existing behavior smoke is supabase/tests/phase3_material_permissions_smoke.sql and reaches phase02_task3_material_readiness_smoke_passed in rollback-only evidence.
- The five Payment/Quantity codes are already Cloud-verified and persistently enforced. project.payment.mark_paid remains declared.
- The frontend currently has only the Daily Log verified allowlist. The committed Material expectations in lib/__tests__/permissionReadiness.test.ts are intentionally red until this plan updates the resolver.
- The three Material approval codes and the two named adjacent Material actions remain declared until A12.
- Existing aggregate evidence records 2282 active Direct Grants and zero enabled hardening flags. Recheck these values read-only immediately before and after A12; do not assume they remain unchanged without evidence.

## File Map

| File | Responsibility in this plan |
| --- | --- |
| lib/permissions/permissionReadiness.ts | Frontend release-time verified allowlist. |
| lib/__tests__/permissionReadiness.test.ts | Resolver behavior for Daily Log, Payment/Quantity, Material, and exclusions. |
| The generated migration file ending in `_material_approval_readiness.sql` | Fail-closed promotion of exactly three active declared actions. |
| lib/__tests__/materialApprovalReadinessMigration.test.ts | Static contract for the new readiness migration. |
| supabase/tests/material_approval_readiness_promotion_smoke.sql | Rollback-only Cloud proof that exactly three Material codes are verified. |
| lib/__tests__/materialApprovalReadinessPromotionSmoke.test.ts | Static contract for the promotion smoke. |
| lib/__tests__/materialRequestApproveStateGuardMigration.test.ts | Existing Material Request guard contract; verify only. |
| lib/__tests__/purchaseOrderApproveStateGuardMigration.test.ts | Existing PO guard contract; verify only. |
| lib/__tests__/customMaterialApproveStateGuardMigration.test.ts | Existing Custom Material guard contract; verify only. |
| docs/security/phase02-task3-permission-readiness-matrix.md | Aggregate readiness evidence after approved Cloud gates. |
| docs/security/phase02-business-role-sod-live-apply-log.md | Timestamped A12/A13 evidence and exact mutation boundary. |

---

### Task 1: Freeze The Boundary And Confirm The Red Frontend Test

**Files:**
- Verify: supabase/migrations/20260718151157_material_request_approve_state_guard.sql
- Verify: supabase/migrations/20260718152445_purchase_order_approve_state_guard.sql
- Verify: supabase/migrations/20260718154050_custom_material_approve_state_guard.sql
- Verify: supabase/tests/phase3_material_permissions_smoke.sql
- Test: lib/__tests__/permissionReadiness.test.ts

**Interfaces:**
- Consumes the approved Material guard artifacts and the intentionally red frontend assertion.
- Produces a clean scope baseline and hash evidence. This task changes no file and mutates no Cloud state.

- [ ] **Step 1: Confirm the Git boundary**

Run:

~~~bash
git branch --show-current
git rev-parse HEAD
git status --short --branch
git diff --cached --name-only
~~~

Expected: branch refactor/module-du-an-v1, no staged files, the user-owned roadmap still appears dirty, and the existing handoff/plans remain unstaged.

- [ ] **Step 2: Hash the exact Material artifacts**

Run:

~~~bash
shasum -a 256 \
  supabase/migrations/20260718151157_material_request_approve_state_guard.sql \
  supabase/migrations/20260718152445_purchase_order_approve_state_guard.sql \
  supabase/migrations/20260718154050_custom_material_approve_state_guard.sql \
  supabase/tests/phase3_material_permissions_smoke.sql
~~~

Record only the file names and hashes in the local checkpoint. Do not print SQL bodies or Cloud data.

- [ ] **Step 3: Run the known red frontend test**

Run:

~~~bash
npm test -- --run lib/__tests__/permissionReadiness.test.ts
~~~

Expected: FAIL in marks only the evidence-backed Task 3 Material tranche as verified because the current resolver returns declared for the three Material approval codes. This is the required test-first failure; do not weaken the assertion.

- [ ] **Step 4: Confirm no Cloud mutation is part of the baseline**

Run only read-only local checks in this task. Do not call db push, migration repair, db reset, a transition RPC, a grant RPC, or a principal Save.

### Task 2: Align The Frontend Readiness Allowlist

**Files:**
- Modify: lib/permissions/permissionReadiness.ts
- Modify: lib/__tests__/permissionReadiness.test.ts
- Test: lib/__tests__/permissionRegistry.test.ts

**Interfaces:**
- Consumes PermissionActionDefinition from lib/permissions/permissionTypes.
- Produces resolvePermissionActionReadiness results of verified for the existing Daily Log set plus the five Cloud-verified Payment/Quantity codes and the three Material approval codes.

- [ ] **Step 1: Update the test expectations first**

Keep the existing Daily Log and legacy assertions. Replace the Task 3 readiness test with this exact assertion block:

~~~ts
  it('marks only the Cloud-verified Payment/Quantity and Material approval tranche as verified', () => {
    const verifiedCodes = [
      'project.payment.verify',
      'project.payment.approve',
      'project.payment.confirm',
      'project.quantity_acceptance.verify',
      'project.quantity_acceptance.approve',
      'project.material_request.approve',
      'project.material_po.approve',
      'project.custom_material.approve',
    ];

    for (const permissionCode of verifiedCodes) {
      expect(resolvePermissionActionReadiness(action(permissionCode))).toBe('verified');
    }

    for (const permissionCode of [
      'project.payment.mark_paid',
      'project.material_request.confirm',
      'project.material_request.verify',
    ]) {
      expect(resolvePermissionActionReadiness(action(permissionCode))).toBe('declared');
    }
  });
~~~

Run:

~~~bash
npm test -- --run lib/__tests__/permissionReadiness.test.ts
~~~

Expected: FAIL because the resolver allowlist has not yet been expanded.

- [ ] **Step 2: Add the eight non-Daily-Log codes to the resolver**

Change only the VERIFIED_PERMISSION_CODES set in lib/permissions/permissionReadiness.ts so it contains the existing eleven Daily Log values followed by these exact values:

~~~ts
  'project.payment.verify',
  'project.payment.approve',
  'project.payment.confirm',
  'project.quantity_acceptance.verify',
  'project.quantity_acceptance.approve',
  'project.material_request.approve',
  'project.material_po.approve',
  'project.custom_material.approve',
~~~

Do not add project.payment.mark_paid, project.material_request.confirm, or project.material_request.verify. Do not change ENFORCED_PERMISSION_CODES, canAddDirectGrant, or canRemoveDirectGrant.

- [ ] **Step 3: Run the focused frontend tests**

Run:

~~~bash
npm test -- --run lib/__tests__/permissionReadiness.test.ts lib/__tests__/permissionRegistry.test.ts
npx tsc --noEmit
~~~

Expected: both Vitest files pass and TypeScript exits zero. The unified permission view model now sees the same eight non-Daily-Log verified codes that Cloud must expose after A12.

- [ ] **Step 4: Commit the frontend-only change**

Run:

~~~bash
git add lib/permissions/permissionReadiness.ts lib/__tests__/permissionReadiness.test.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat(authz): align frontend task 3 readiness"
~~~

Expected: exactly the two frontend files are staged. Do not stage the roadmap, handoff, or any existing plan.

### Task 3: Add The Fail-Closed Material Readiness Migration

**Files:**
- Create through the Supabase CLI: one file ending in _material_approval_readiness.sql under supabase/migrations
- Create: lib/__tests__/materialApprovalReadinessMigration.test.ts

**Interfaces:**
- Consumes the three active declared rows in public.permission_actions.
- Produces exactly three active verified rows and no grant, principal, flag, or unrelated permission mutation.

- [ ] **Step 1: Write the static migration contract test**

Create lib/__tests__/materialApprovalReadinessMigration.test.ts with:

~~~ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_material_approval_readiness.sql'));

const promotedCodes = [
  'project.material_request.approve',
  'project.material_po.approve',
  'project.custom_material.approve',
];

describe('Material approval readiness migration', () => {
  it('promotes only the three active declared approval actions', () => {
    expect(candidates).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');

    for (const permissionCode of promotedCodes) {
      expect(sql).toContain("'" + permissionCode + "'");
    }
    expect(sql).toMatch(/is_active\s+and\s+grant_readiness\s*=\s*'declared'/i);
    expect(sql).toMatch(/set\s+grant_readiness\s*=\s*'verified'/i);
    expect(sql).toMatch(/cardinality\(v_codes\)/i);
    expect(sql).not.toContain('project.material_request.confirm');
    expect(sql).not.toContain('project.material_request.verify');
    expect(sql).not.toContain('project.payment.mark_paid');
    expect(sql).not.toMatch(/user_permission_grants/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
~~~

Run:

~~~bash
npm test -- --run lib/__tests__/materialApprovalReadinessMigration.test.ts
~~~

Expected: FAIL because the new migration does not exist yet.

- [ ] **Step 2: Generate the migration path with the installed CLI**

Re-read the command surface, then generate the migration:

~~~bash
node_modules/.bin/supabase migration new --help
node_modules/.bin/supabase migration new material_approval_readiness
generated_material_migration="$(rg --files supabase/migrations | rg '_material_approval_readiness\.sql$' | sort | tail -n 1)"
printf '%s\n' "$generated_material_migration"
~~~

The command must create exactly one candidate. Resolve and use the printed path for all subsequent commands; do not invent a timestamp and do not edit an applied migration.

- [ ] **Step 3: Write the exact forward-only migration body**

Replace the generated file body with:

~~~sql
do $$
declare
  v_codes text[] := array[
    'project.material_request.approve',
    'project.material_po.approve',
    'project.custom_material.approve'
  ];
begin
  if (
    select count(*)
    from public.permission_actions
    where permission_code = any(v_codes)
      and is_active
      and grant_readiness = 'declared'
  ) <> cardinality(v_codes) then
    raise exception 'Material approval readiness promotion requires three active declared actions.';
  end if;

  update public.permission_actions
  set grant_readiness = 'verified',
      updated_at = now()
  where permission_code = any(v_codes)
    and is_active
    and grant_readiness = 'declared';

  if (
    select count(*)
    from public.permission_actions
    where permission_code = any(v_codes)
      and is_active
      and grant_readiness = 'verified'
  ) <> cardinality(v_codes) then
    raise exception 'Material approval readiness promotion failed.';
  end if;
end;
$$;
~~~

The migration must contain no user_permission_grants, principal writes, role assignment writes, warning acceptance writes, rollout flag calls, or unrelated permission codes.

- [ ] **Step 4: Run the migration contract and source checks**

Run:

~~~bash
npm test -- --run lib/__tests__/materialApprovalReadinessMigration.test.ts
shasum -a 256 "$generated_material_migration"
git diff --check
~~~

Expected: the new Vitest file passes, one migration candidate exists, and the migration hash is recorded without printing its SQL body.

- [ ] **Step 5: Commit the readiness migration and its static test**

Run with the resolved migration path:

~~~bash
git add "$generated_material_migration" lib/__tests__/materialApprovalReadinessMigration.test.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat(authz): add material approval readiness promotion"
~~~

Expected: only the generated readiness migration and its static test are staged.

### Task 4: Add The Rollback-Only Promotion Smoke

**Files:**
- Create: supabase/tests/material_approval_readiness_promotion_smoke.sql
- Create: lib/__tests__/materialApprovalReadinessPromotionSmoke.test.ts

**Interfaces:**
- Consumes the exact readiness migration from Task 3.
- Produces checkpoint phase02_task3_material_approval_readiness_promotion_smoke_passed and verifies the excluded adjacent actions remain unpromoted.

- [ ] **Step 1: Write the static smoke contract test**

Create lib/__tests__/materialApprovalReadinessPromotionSmoke.test.ts with:

~~~ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const smokePath = path.resolve(process.cwd(), 'supabase/tests/material_approval_readiness_promotion_smoke.sql');

describe('Material approval readiness-promotion smoke', () => {
  it('proves exactly three Material approval codes are verified', () => {
    const sql = fs.readFileSync(smokePath, 'utf8');

    expect(sql).toMatch(/begin;/i);
    expect(sql).toMatch(/rollback;/i);
    expect(sql).toMatch(/project\.material_request\.approve/i);
    expect(sql).toMatch(/project\.material_po\.approve/i);
    expect(sql).toMatch(/project\.custom_material\.approve/i);
    expect(sql).toMatch(/project\.material_request\.confirm/i);
    expect(sql).toMatch(/project\.material_request\.verify/i);
    expect(sql).toMatch(/grant_readiness\s*=\s*'verified'/i);
    expect(sql).toMatch(/phase02_task3_material_approval_readiness_promotion_smoke_passed/i);
    expect(sql).not.toMatch(/user_permission_grants/i);
    expect(sql).not.toMatch(/set_authorization_rollout_flags/i);
  });
});
~~~

Run:

~~~bash
npm test -- --run lib/__tests__/materialApprovalReadinessPromotionSmoke.test.ts
~~~

Expected: FAIL because the SQL smoke file does not exist yet.

- [ ] **Step 2: Create the exact rollback-only smoke SQL**

Create supabase/tests/material_approval_readiness_promotion_smoke.sql with:

~~~sql
-- Material approval readiness-promotion smoke.
-- Run after the exact readiness migration inside a rollback-only transaction.

begin;

do $$
declare
  v_codes text[] := array[
    'project.material_request.approve',
    'project.material_po.approve',
    'project.custom_material.approve'
  ];
begin
  if (
    select count(*)
    from public.permission_actions
    where permission_code = any(v_codes)
      and is_active
      and grant_readiness = 'verified'
  ) <> cardinality(v_codes) then
    raise exception 'Material approval readiness promotion did not verify the exact three actions.';
  end if;

  if exists (
    select 1
    from public.permission_actions
    where permission_code in (
      'project.material_request.confirm',
      'project.material_request.verify'
    )
      and grant_readiness = 'verified'
  ) then
    raise exception 'An unpromoted Material adjacent action was verified.';
  end if;
end;
$$;

select 'phase02_task3_material_approval_readiness_promotion_smoke_passed' as checkpoint;

rollback;
~~~

- [ ] **Step 3: Run the smoke contract tests**

Run:

~~~bash
npm test -- --run lib/__tests__/materialApprovalReadinessPromotionSmoke.test.ts lib/__tests__/materialApprovalReadinessMigration.test.ts
~~~

Expected: both new static contract tests pass.

- [ ] **Step 4: Commit the smoke and static test**

Run:

~~~bash
git add supabase/tests/material_approval_readiness_promotion_smoke.sql lib/__tests__/materialApprovalReadinessPromotionSmoke.test.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "test(authz): add material readiness promotion smoke"
~~~

Expected: exactly the smoke SQL and its static test are staged.

### Task 5: Complete Local Verification And Prepare A12 Evidence

**Files:**
- Verify: all three existing Material guard migration tests.
- Verify: supabase/tests/phase3_material_permissions_smoke.sql.
- Verify: the generated Material readiness migration and both new static tests.
- Modify only after Cloud evidence: docs/security/phase02-task3-permission-readiness-matrix.md, docs/security/phase02-business-role-sod-live-apply-log.md.

**Interfaces:**
- Consumes the local commits from Tasks 2-4.
- Produces the exact hash set, test results, and a read-only A12 preflight request. It does not mutate Cloud.

- [ ] **Step 1: Run all focused local tests**

Run:

~~~bash
npm test -- --run \
  lib/__tests__/permissionReadiness.test.ts \
  lib/__tests__/permissionRegistry.test.ts \
  lib/__tests__/materialRequestApproveStateGuardMigration.test.ts \
  lib/__tests__/purchaseOrderApproveStateGuardMigration.test.ts \
  lib/__tests__/customMaterialApproveStateGuardMigration.test.ts \
  lib/__tests__/materialApprovalReadinessMigration.test.ts \
  lib/__tests__/materialApprovalReadinessPromotionSmoke.test.ts
npx tsc --noEmit
git diff --check
~~~

Expected: every listed test passes, TypeScript exits zero, and the diff check is clean. Do not treat unrelated full-suite failures as a reason to widen this tranche.

- [ ] **Step 2: Recheck exact local artifact hashes**

Run:

~~~bash
shasum -a 256 \
  supabase/migrations/20260718151157_material_request_approve_state_guard.sql \
  supabase/migrations/20260718152445_purchase_order_approve_state_guard.sql \
  supabase/migrations/20260718154050_custom_material_approve_state_guard.sql \
  supabase/tests/phase3_material_permissions_smoke.sql \
  "$generated_material_migration" \
  supabase/tests/material_approval_readiness_promotion_smoke.sql
~~~

Record only paths and hashes in the A12 evidence note. Do not include SQL bodies.

- [ ] **Step 3: Re-read the linked query interfaces**

Run:

~~~bash
node_modules/.bin/supabase db query --help
node_modules/.bin/supabase migration list --help
~~~

Use the documented linked read-only syntax discovered from these commands. The preflight must return aggregate booleans/counts only: the three Material RPC signatures are present or absent, the five Payment/Quantity RPC/guard contracts remain present, the three Material readiness values are still declared, the five Payment/Quantity values remain verified, project.payment.mark_paid remains declared, project.material_request.confirm and project.material_request.verify remain declared, active Direct Grants equal the recorded preflight baseline, enabled hardening flags equal zero, and all four candidate migration-history rows remain absent.

- [ ] **Step 4: Request Cloud Gate A12**

The approval text must name one atomic linked transaction containing exactly:

1. The three exact Material state-guard migration files.
2. The generated Material readiness migration from Task 3.
3. Savepoint material_readiness_smoke.
4. supabase/tests/phase3_material_permissions_smoke.sql with only its outer BEGIN/ROLLBACK wrapper removed.
5. supabase/tests/material_approval_readiness_promotion_smoke.sql with only its outer BEGIN/ROLLBACK wrapper removed.
6. ROLLBACK TO SAVEPOINT material_readiness_smoke, followed by COMMIT.

The gate must explicitly exclude principal Preview/Save, grants, role assignments, flags, warnings, unrelated SQL, and migration-history repair. Stop for the user approval before executing it.

### Task 6: Execute A12, Record Evidence, Then Request A13 Repair

**Files:**
- Execute exactly: the three Material guard migrations and the generated readiness migration.
- Execute transactionally: the existing Material behavior smoke and the new readiness-promotion smoke.
- Modify after passing A12: docs/security/phase02-task3-permission-readiness-matrix.md, docs/security/phase02-business-role-sod-live-apply-log.md.
- No source file is modified for A13.

**Interfaces:**
- Consumes explicit A12 approval and the exact hashes from Task 5.
- Produces persistent Material guard/readiness state, rollback-free smoke fixtures, aggregate-only evidence, then a separate A13 request for four history rows.

- [ ] **Step 1: Build the A12 bundle in memory**

Use the exact savepoint pattern below, substituting only the resolved local path held in generated_material_migration:

~~~bash
material_request_guard='supabase/migrations/20260718151157_material_request_approve_state_guard.sql'
purchase_order_guard='supabase/migrations/20260718152445_purchase_order_approve_state_guard.sql'
custom_material_guard='supabase/migrations/20260718154050_custom_material_approve_state_guard.sql'
material_behavior_smoke='supabase/tests/phase3_material_permissions_smoke.sql'
material_readiness_smoke='supabase/tests/material_approval_readiness_promotion_smoke.sql'

material_bundle="$({
  printf 'begin;\n'
  sed -n '1,$p' "$material_request_guard"
  sed -n '1,$p' "$purchase_order_guard"
  sed -n '1,$p' "$custom_material_guard"
  sed -n '1,$p' "$generated_material_migration"
  printf '\nsavepoint material_readiness_smoke;\n'
  for smoke_file in "$material_behavior_smoke" "$material_readiness_smoke"; do
    awk '
      /^[[:space:]]*begin;[[:space:]]*$/ && !removed_begin {
        removed_begin = 1
        next
      }
      { lines[++line_count] = $0 }
      END {
        last_nonblank = line_count
        while (last_nonblank > 0 && lines[last_nonblank] ~ /^[[:space:]]*$/) last_nonblank--
        for (position = 1; position <= line_count; position++) {
          if (position == last_nonblank && lines[position] ~ /^[[:space:]]*rollback;[[:space:]]*$/) continue
          print lines[position]
        }
      }
    ' "$smoke_file"
  done
  printf '\nrollback to savepoint material_readiness_smoke;\n'
  printf 'commit;\n'
})"
~~~

The migration objects execute before the savepoint. Smoke fixtures execute after it and are removed before commit. Any smoke exception aborts the outer transaction.

- [ ] **Step 2: Verify the bundle hash and execute only after A12 approval**

Run without printing the SQL:

~~~bash
printf '%s' "$material_bundle" | shasum -a 256
node_modules/.bin/supabase db query --linked --agent=no --output json "$material_bundle"
~~~

Expected output includes both checkpoints:

~~~text
phase02_task3_material_readiness_smoke_passed
phase02_task3_material_approval_readiness_promotion_smoke_passed
~~~

Any error is an A12 failure. Do not retry with altered SQL or apply individual fragments.

- [ ] **Step 3: Run aggregate-only A12 postchecks**

Require read-only evidence that the three Material transition RPCs/guards persist, the three Material approval codes are verified, the five Payment/Quantity codes remain verified, project.payment.mark_paid remains declared, project.material_request.confirm and project.material_request.verify remain declared, active Direct Grants equal the preflight baseline, enabled hardening flags remain zero, and all four migration-history rows remain absent.

Do not print identities, emails, grant rows, tokens, raw function bodies, or SQL payloads.

- [ ] **Step 4: Record and commit only A12 evidence**

Append the A12 timestamp, HEAD, six artifact hashes, bundle hash, both checkpoints, aggregate postconditions, and explicit no-Save/no-grant/no-flag statement to the two security evidence files. Then run:

~~~bash
git add docs/security/phase02-task3-permission-readiness-matrix.md docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs(authz): record material readiness atomic apply"
~~~

Expected: exactly the two security evidence files are staged; the roadmap and all pre-existing handoff/plans remain untouched and unstaged.

- [ ] **Step 5: Request Cloud Gate A13 for history repair only**

After A12 postchecks pass, request a separate approval to mark exactly these four versions as applied:

~~~text
20260718151157
20260718152445
20260718154050
the generated readiness migration version printed by the CLI
~~~

The generated version is resolved from the actual migration path; no other version is included. The approval excludes SQL execution, grants, readiness changes, flags, role assignments, warnings, principal Preview/Save, and rollouts.

- [ ] **Step 6: Repair and verify only the four approved history versions**

Re-read the command syntax and run the exact four-version repair after A13 approval:

~~~bash
node_modules/.bin/supabase migration repair --help
generated_material_version="$(basename "$generated_material_migration" | cut -d_ -f1)"
node_modules/.bin/supabase migration repair 20260718151157 20260718152445 20260718154050 "$generated_material_version" --status applied --linked --agent=no
~~~

Verify one history row for each of the four versions and recheck the aggregate readiness/grant/flag invariants read-only.

- [ ] **Step 7: Record A13 and recompute Task 3 readiness**

Append only aggregate A13 history evidence and the post-repair Task 3 readiness recomputation to the two security documents. Record the resulting blocker count from Cloud; do not predict it locally. Confirm that no principal Save occurred and that Phase 03 remains unopened.

## Final Verification Checklist

- [ ] Frontend resolver and Cloud readiness agree for the eight non-Daily-Log codes verified at release time.
- [ ] project.payment.mark_paid, project.material_request.confirm, and project.material_request.verify remain declared.
- [ ] The three Material runtime guards and the readiness promotion passed their exact smoke checkpoints.
- [ ] Smoke fixtures were rolled back before A12 commit.
- [ ] A12 and A13 had separate explicit approvals and separate evidence.
- [ ] Only four exact migration-history versions were repaired.
- [ ] Active Direct Grants and rollout flags match aggregate preflight/postcheck evidence.
- [ ] No principal identifier, raw grant row, token, SQL payload, or approved manifest was printed or committed.
- [ ] The applied migrations 20260718092455_unified_permission_change_command.sql and 20260718123119_authorization_audit_readiness.sql are byte-for-byte unchanged.
- [ ] The dirty roadmap was never modified, staged, or committed by this work.
- [ ] No batch Save, partial Save, rollout, or Phase 03 transition began.

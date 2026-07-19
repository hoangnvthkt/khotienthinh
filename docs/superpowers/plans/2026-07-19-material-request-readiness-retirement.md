# Material Request Readiness Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Retire the obsolete Material Request Confirm and Verify actions from the approved sensitive-regrant decision through an exact, aggregate-only, read-only manifest-revision gate.

**Architecture:** The catalog and Material Request lifecycle remain unchanged. A rollback-only SQL gate reconstructs the frozen source from standardized revoke/regrant history, verifies the old source and regrant fingerprints, excludes only the two retired codes, and validates the revised aggregate. It stops if a retired key is active; any governed revoke then needs separate approval.

**Tech Stack:** PostgreSQL 15+, Supabase CLI 2.95.6 linked Cloud query, transactional SQL, TypeScript 5.8, Vitest 4.1.8.

## Global Constraints

- Remain in Phase 02 Closure Task 3 readiness; do not start Phase 03.
- Retire only project.material_request.confirm and project.material_request.verify from the approved regrant subset.
- Keep both catalog actions active and declared. Do not add them to the frontend verified mapping.
- project.material_request.confirm_fulfillment remains the only fulfilment confirmation permission.
- Do not edit an applied migration, Preview or Save a principal, change a Direct Grant, accept a warning, modify a Business Role, repair migration history, or change a rollout flag.
- Do not print or commit identities, grant keys, raw manifest rows, credentials, database URLs, or private runtime artifacts.
- Do not edit docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md.
- Do not use db push, --local, Docker, supabase start, or supabase db reset.
- A nonzero retired-active count is a hard stop, not a reason to bypass the governed direct-grant command.

## File Map

| File | Responsibility |
| --- | --- |
| lib/__tests__/materialRequestReadinessRetirement.test.ts | Locks the runtime/catalog retirement boundary. |
| supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql | Rollback-only aggregate gate for old and revised manifest invariants. |
| lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts | Static contract proving the gate is read-only and excludes exactly two codes. |
| docs/security/phase02-task3-permission-readiness-matrix.md | Aggregate-only Tranche B evidence and blocker status. |
| docs/security/phase02-business-role-sod-live-apply-log.md | Timestamped Cloud-gate evidence and no-mutation boundary. |

---

### Task 1: Lock The Retirement Boundary

**Files:**
- Create: lib/__tests__/materialRequestReadinessRetirement.test.ts
- Verify: lib/permissions/projectMaterialPermissions.ts
- Verify: pages/project/MaterialTab.tsx
- Verify: supabase/migrations/20260718151157_material_request_approve_state_guard.sql

**Interfaces:**
- Consumes the Material capability list, UI confirmation constant, and transition RPC source.
- Produces a static guarantee that neither obsolete code is a current runtime Material capability, while confirm_fulfillment remains present.

- [ ] **Step 1: Write the boundary test**

Create lib/__tests__/materialRequestReadinessRetirement.test.ts:

~~~ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Material Request readiness retirement', () => {
  it('keeps fulfillment confirmation separate from obsolete readiness codes', () => {
    const permissions = read('lib/permissions/projectMaterialPermissions.ts');
    const materialTab = read('pages/project/MaterialTab.tsx');
    const transition = read('supabase/migrations/20260718151157_material_request_approve_state_guard.sql');

    expect(permissions).toContain("'project.material_request.confirm_fulfillment'");
    expect(permissions).not.toContain("'project.material_request.confirm',");
    expect(permissions).not.toContain("'project.material_request.verify',");
    expect(materialTab).toMatch(/MATERIAL_REQUEST_CONFIRM_PERMISSION\s*=\s*'project\.material_request\.confirm_fulfillment'/);
    expect(transition).toContain("'project.material_request.confirm_fulfillment'");
    expect(transition).not.toContain("'project.material_request.verify'");
  });
});
~~~

- [ ] **Step 2: Run the focused test**

Run:

~~~bash
npx vitest run lib/__tests__/materialRequestReadinessRetirement.test.ts
~~~

Expected: PASS. This documents an existing boundary; it does not change production code.

- [ ] **Step 3: Commit the boundary test**

~~~bash
git add lib/__tests__/materialRequestReadinessRetirement.test.ts
git diff --cached --check
git commit -m "test(authz): lock material request retirement boundary"
~~~

### Task 2: Add The Read-Only Manifest Revision Gate

**Files:**
- Create: supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql
- Create: lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts

**Interfaces:**
- Consumes private session settings for old source/regrant counts and fingerprints, non-sensitive fingerprint, Direct Grant baseline, shared expiry, and revised regrant count/fingerprint.
- Produces authorization_sensitive_grant_manifest_revision_gate_passed only when original and revised arithmetic match and no retired key is active.

- [ ] **Step 1: Write the failing static gate test**

Create lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts:

~~~ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const gate = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql'),
  'utf8',
);

describe('sensitive grant manifest revision gate', () => {
  it('is rollback-only and retires exactly the two obsolete Material Request codes', () => {
    expect(gate).toMatch(/^begin;/im);
    expect(gate).toMatch(/rollback;\s*$/im);
    expect(gate).toContain("'project.material_request.confirm'");
    expect(gate).toContain("'project.material_request.verify'");
    expect(gate).toContain('authorization_sensitive_grant_manifest_revision_gate_passed');
    expect(gate).toMatch(/active_retired_count\s*<>\s*0/i);
    expect(gate).toMatch(/expected_original_regrant_fingerprint/i);
    expect(gate).toMatch(/expected_revised_regrant_fingerprint/i);
    expect(gate).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create)\b/i);
  });
});
~~~

- [ ] **Step 2: Prove the test is red**

~~~bash
npx vitest run lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts
~~~

Expected: FAIL because the SQL gate does not exist.

- [ ] **Step 3: Implement the rollback-only gate**

Create supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql with BEGIN, one DO assertion block, a checkpoint SELECT, and ROLLBACK. Parse and reject missing values for these session settings:

~~~text
app.expected_source_count
app.expected_source_fingerprint
app.expected_original_regrant_count
app.expected_original_regrant_fingerprint
app.expected_original_drop_count
app.expected_non_sensitive_fingerprint
app.expected_active_direct_grant_count
app.expected_regrant_expires_at
app.expected_revised_regrant_count
app.expected_revised_regrant_fingerprint
~~~

Inside the DO block, use a CTE with these exact source and decision boundaries:

~~~sql
with source_rows as (
  select grant_row.user_id, grant_row.permission_code,
         grant_row.scope_type, grant_row.scope_id, grant_row.is_active,
         grant_row.expires_at, grant_row.grant_reason
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
   and action_row.is_active
  where action_row.risk_level = 'sensitive'
    and (
      (not grant_row.is_active and grant_row.revoked_reason =
        'Task 13 Step 5: thu hồi toàn bộ quyền nhạy cảm trước tái cấp')
      or (grant_row.is_active and grant_row.grant_reason =
        'Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt')
    )
),
original_regrant as (
  select source_row.*
  from source_rows source_row
  where not exists (
    select 1
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates role_row
      on role_row.id = assignment_row.role_template_id
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = source_row.user_id
      and assignment_row.status = 'ACTIVE'
      and assignment_row.scope_type = 'global'
      and assignment_row.scope_id = '*'
      and role_row.code = 'PERMISSION_ADMIN'
  )
),
revised_regrant as (
  select *
  from original_regrant
  where permission_code not in (
    'project.material_request.confirm',
    'project.material_request.verify'
  )
)
select count(*) filter (
  where source_rows.is_active
    and source_rows.permission_code in (
      'project.material_request.confirm',
      'project.material_request.verify'
    )
) as active_retired_count
from source_rows;
~~~

Use separate CTE aggregates to avoid join multiplication. Compare source/original/revised counts and canonical fingerprints, revised DROP arithmetic, canonical expiry/regrant reason, unchanged non-sensitive fingerprint, active Direct Grant count, durable rollout-operator count, and disabled rollout flags. Raise when active_retired_count <> 0.

- [ ] **Step 4: Make the contracts green**

~~~bash
npx vitest run   lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts   lib/__tests__/materialRequestReadinessRetirement.test.ts
git diff --check
~~~

Expected: both tests pass and whitespace verification exits 0.

- [ ] **Step 5: Commit the gate and static contracts**

~~~bash
git add   supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql   lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts
git diff --cached --check
git commit -m "test(authz): add material request manifest revision gate"
~~~

### Task 3: Run The Private Read-Only Revision Gate

**Files:**
- Verify: supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql
- Modify: docs/security/phase02-task3-permission-readiness-matrix.md
- Modify: docs/security/phase02-business-role-sod-live-apply-log.md

**Interfaces:**
- Consumes approved prior fingerprints and private session settings.
- Produces aggregate-only original/revised counts and fingerprints, or a hard stop without a Cloud write.

- [ ] **Step 1: Build a mode-0600 bundle outside Git**

Create a private directory with mktemp -d and chmod 700. Use Node readFileSync/writeFileSync to inject set_config calls for every app.expected_* setting before the gate transaction. The temporary file is mode 0600 and is deleted after the command. It never contains output rows in Git or chat.

- [ ] **Step 2: Run only after explicit read-only Cloud Gate B0 approval**

Discover syntax first:

~~~bash
node_modules/.bin/supabase db query --help
~~~

Then execute the private bundle against linked Cloud with --agent=no. Expected checkpoint: authorization_sensitive_grant_manifest_revision_gate_passed. Do not use a local database, service-role connection, or Direct Grant RPC.

- [ ] **Step 3: Enforce the hard-stop branch**

If retired-active count is nonzero, record only that count and stop. Do not revise the manifest, preview a principal, or change a grant. Prepare a separately approved governed-revoke checkpoint for the affected active keys.

- [ ] **Step 4: Record evidence on the passing branch**

Append aggregate-only evidence to both security documents:

~~~markdown
- Tranche B retired project.material_request.confirm and
  project.material_request.verify from the approved regrant decision only.
  Both catalog actions remain active and declared; no Cloud row was changed.
- The exact read-only revision gate matched the old source/regrant baselines,
  found zero active retired keys, and produced a revised regrant count and
  fingerprint. Closure Task 3 remains paused pending a refreshed
  exact-manifest readiness aggregate.
~~~

Insert count and fingerprint values only after the gate passes. Change the blocker-code count from 13 to 11 only when the exact revised-manifest query proves both actions were in the approved blocker surface.

- [ ] **Step 5: Verify and commit evidence**

~~~bash
npx vitest run   lib/__tests__/materialRequestReadinessRetirement.test.ts   lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts
npx tsc --noEmit
git diff --check
git status --short
~~~

Commit only the evidence documents after the gate exists:

~~~bash
git add   docs/security/phase02-task3-permission-readiness-matrix.md   docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --check
git commit -m "docs(authz): record material request manifest retirement"
~~~

## Exit Criteria

- The two obsolete codes are proved absent from the live Material Request capability path and remain outside the frontend verified mapping.
- The SQL gate has no persistent data-definition or data-manipulation statement and always ends in ROLLBACK.
- The old manifest baseline is verified before the revised subset is accepted.
- The gate proves zero active retired keys, or stops with no mutation.
- No principal Preview/Save, grant, warning, role, flag, migration, or history change occurs in this tranche.
- Security evidence records aggregate-only results and does not claim Closure Task 3 is unblocked until the exact revised-manifest gate proves it.

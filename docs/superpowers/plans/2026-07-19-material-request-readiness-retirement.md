# Material Request Readiness Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire two obsolete Material Request permission codes from the exact Task 3 sensitive-regrant decision while preserving the permission catalog and proving the result with aggregate-only Cloud evidence.

**Architecture:** A rollback-only linked Cloud gate reconstructs the frozen source from its maintenance reasons, validates the old source/regrant fingerprints, then derives a revised regrant set excluding the two retired codes. It never writes. A nonzero count of already-active retired keys is a hard stop for a separate governed-revoke decision.

**Tech Stack:** PostgreSQL 15+, Supabase CLI 2.95.6, linked Supabase Cloud, transactional SQL, TypeScript 5.8, Vitest 4.1.8.

## Global Constraints

- Remain in Phase 02 Task 3 readiness; do not start Phase 03.
- Retire only `project.material_request.confirm` and `project.material_request.verify` from the approved regrant decision.
- Keep both catalog actions active and `declared`; do not promote, deactivate, rename, or remap them.
- Keep `project.material_request.confirm_fulfillment` as the only fulfilment-confirmation permission.
- Do not print or commit identities, grant rows, manifest records, tokens, database URLs, or private runtime paths.
- Do not Preview or Save any pending principal.
- Do not mutate a Direct Grant, warning acceptance, Business Role, rollout flag, migration history, or applied migration.
- Do not use `db push`, local Supabase, Docker, `--local`, `supabase start`, or `supabase db reset`.
- Do not edit or stage `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.

## File Map

| File | Responsibility |
| --- | --- |
| `lib/__tests__/materialRequestReadinessRetirement.test.ts` | Locks the runtime/UI retirement boundary and the frontend declared result. |
| `supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql` | Rollback-only exact source/revision gate. |
| `lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts` | Statically rejects persistent SQL writes and missing gate conditions. |
| `docs/security/phase02-task3-permission-readiness-matrix.md` | Aggregate retirement and revised blocker evidence. |
| `docs/security/phase02-business-role-sod-live-apply-log.md` | Timestamped Cloud gate boundary and stop/go decision. |

---

### Task 1: Lock The Runtime Retirement Boundary

**Files:**
- Create: `lib/__tests__/materialRequestReadinessRetirement.test.ts`
- Verify: `lib/permissions/projectMaterialPermissions.ts`
- Verify: `pages/project/MaterialTab.tsx`
- Verify: `lib/permissions/permissionReadiness.ts`

**Interfaces:**
- Consumes the Project Material action list, UI normalization, and frontend readiness resolver.
- Produces a regression contract: fulfilment uses `confirm_fulfillment`; the retired codes remain declared.

- [ ] **Step 1: Write the static contract test**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPermissionActionByCode } from '../permissions/permissionRegistry';
import { resolvePermissionActionReadiness } from '../permissions/permissionReadiness';

const permissions = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/permissions/projectMaterialPermissions.ts'), 'utf8',
);
const materialTab = fs.readFileSync(
  path.resolve(process.cwd(), 'pages/project/MaterialTab.tsx'), 'utf8',
);
const action = (permissionCode: string) => {
  const found = getPermissionActionByCode(permissionCode);
  if (!found) throw new Error('Missing fixture ' + permissionCode);
  return found;
};

describe('Material Request readiness retirement', () => {
  it('keeps fulfilment confirmation on its dedicated permission', () => {
    expect(permissions).toContain("'project.material_request.confirm_fulfillment'");
    expect(permissions).not.toContain("'project.material_request.confirm',");
    expect(permissions).not.toContain("'project.material_request.verify',");
    expect(materialTab).toMatch(
      /MATERIAL_REQUEST_CONFIRM_PERMISSION\s*=\s*'project\.material_request\.confirm_fulfillment'/,
    );
  });

  it('keeps retired actions out of the frontend verified set', () => {
    for (const permissionCode of [
      'project.material_request.confirm',
      'project.material_request.verify',
    ]) {
      expect(resolvePermissionActionReadiness(action(permissionCode))).toBe('declared');
    }
  });
});
```

- [ ] **Step 2: Run the test without changing production behavior**

Run:

```bash
npx vitest run lib/__tests__/materialRequestReadinessRetirement.test.ts
```

Expected: PASS. This tranche classifies existing behavior; it must not create a fake lifecycle solely to make a test turn red.

- [ ] **Step 3: Commit the boundary test**

```bash
git add lib/__tests__/materialRequestReadinessRetirement.test.ts
git diff --cached --check
git commit -m "test(authz): lock material request retirement boundary"
```

### Task 2: Add A Rollback-Only Manifest Revision Gate

**Files:**
- Create: `supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql`
- Create: `lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts`

**Interfaces:**
- Reads private session settings for the old source/regrant count/fingerprint, revised regrant count/fingerprint, non-sensitive fingerprint, and canonical expiry.
- Emits only `authorization_sensitive_grant_manifest_revision_gate_passed`, otherwise an exception; always rolls back.

- [ ] **Step 1: Write the failing gate test**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const gatePath = path.resolve(
  process.cwd(), 'supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql',
);

describe('sensitive grant manifest revision gate', () => {
  it('is rollback-only and retires only the two obsolete codes', () => {
    const sql = fs.readFileSync(gatePath, 'utf8');
    expect(sql).toMatch(/^begin;[\s\S]*rollback;\s*$/i);
    expect(sql).toContain("'project.material_request.confirm'");
    expect(sql).toContain("'project.material_request.verify'");
    expect(sql).toMatch(/active_retired_count/i);
    expect(sql).toMatch(/expected_original_source_fingerprint/i);
    expect(sql).toMatch(/expected_revised_regrant_fingerprint/i);
    expect(sql).toMatch(/authorization_sensitive_grant_manifest_revision_gate_passed/i);
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create)\b/i);
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts
```

Expected: FAIL with `ENOENT` for the absent SQL gate.

- [ ] **Step 3: Implement the SQL gate**

Create a `BEGIN`/`ROLLBACK` SQL file with one `DO` block. The block must:

1. Read:
   `app.expected_original_source_count`,
   `app.expected_original_source_fingerprint`,
   `app.expected_original_regrant_count`,
   `app.expected_original_regrant_fingerprint`,
   `app.expected_revised_regrant_count`,
   `app.expected_revised_regrant_fingerprint`,
   `app.expected_non_sensitive_fingerprint`, and
   `app.expected_regrant_expires_at`.
2. Reject any empty setting.
3. Build a `source_rows` CTE of active permission actions with
   `risk_level = 'sensitive'`, accepting only:
   - inactive rows with revoke reason
     `Task 13 Step 5: thu hồi toàn bộ quyền nhạy cảm trước tái cấp`; or
   - active rows with regrant reason
     `Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt`.
4. Build `original_regrant` by excluding the active
   `PERMISSION_ADMIN` principal through
   `principal_role_assignments` and `role_permission_templates`.
5. Build `revised_regrant` with this exact predicate:

```sql
where permission_code not in (
  'project.material_request.confirm',
  'project.material_request.verify'
)
```

6. Compute each set's count and canonical-key MD5 using:

```sql
md5(coalesce(string_agg(
  concat_ws('|', user_id::text, permission_code, scope_type, scope_id),
  E'\n' order by user_id, permission_code, scope_type, scope_id
), ''))
```

7. Assert old source/regrant count and fingerprints match their supplied values.
8. Assert revised count/fingerprint match their supplied values.
9. Assert `active_retired_count = 0`, where that count is active source rows
   of either retired code.
10. Assert every active revised row has the canonical expiry and standard
    regrant reason.
11. Recompute and assert the active non-sensitive fingerprint, then assert zero
    enabled rows in `app_private.permission_hardening_settings`; also compare
    the active Direct Grant count and durable rollout-operator count against
    private expected settings captured in the same session.
12. Return the checkpoint and roll back. The file may contain no DDL or
    persistent DML.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run \
  lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts \
  lib/__tests__/materialRequestReadinessRetirement.test.ts \
  lib/__tests__/permissionReadiness.test.ts
git diff --check
```

Expected: all tests pass; the SQL gate contains no persistent write token.

- [ ] **Step 5: Commit the gate**

```bash
git add \
  supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql \
  lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts
git diff --cached --check
git commit -m "test(authz): add manifest revision retirement gate"
```

### Task 3: Cloud Gate B0 - Read-Only Revision Evidence

**Files:**
- Verify: `supabase/tests/authorization_sensitive_grant_manifest_revision_gate.sql`
- Modify only after PASS: `docs/security/phase02-task3-permission-readiness-matrix.md`
- Modify only after PASS: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**
- Consumes only private session settings and the linked Cloud read-only state.
- Produces a stop/go decision for the revised manifest; it never authorizes a principal mutation.

- [ ] **Step 1: Discover the linked query syntax**

```bash
node_modules/.bin/supabase db query --help
```

Expected: linked syntax is available. Do not use `--local`.

- [ ] **Step 2: Construct the private session bundle**

Outside Git, create a `0600` SQL bundle that injects only the original values:

```sql
select set_config('app.expected_original_source_count', '467', true);
select set_config('app.expected_original_source_fingerprint', 'a3d0cf9514e487111c5ae27873c8f6cd', true);
select set_config('app.expected_original_regrant_count', '421', true);
select set_config('app.expected_original_regrant_fingerprint', '00a8f7f0f3a39721474a582592cf0b2e', true);
select set_config('app.expected_non_sensitive_fingerprint', '632d0ce644dcec52126eabf7b44909ca', true);
select set_config('app.expected_regrant_expires_at', '2026-10-16T12:10:00+07:00', true);
```

The first private CTE calculation retains the revised count/fingerprint only in
the protected session artifact. It must not expose raw rows, principal IDs, or
keys.

- [ ] **Step 3: Request explicit Cloud Gate B0**

Announce that B0 is read-only and covers original source/regrant validation,
two-code revised arithmetic, active-retired count, expiry/reason contract,
non-sensitive fingerprint, Direct Grant aggregate, durable operator aggregate,
and rollout flags. Await explicit approval before the linked command.

- [ ] **Step 4: Execute the approved rollback-only bundle**

```bash
node_modules/.bin/supabase db query --linked --agent=no --file "$PRIVATE_GATE_BUNDLE"
```

Expected:
- PASS only if every old and revised value matches and `active_retired_count`
  is zero.
- Any mismatch, including an active retired key, is a hard stop with aggregate
  evidence only. Do not weaken a predicate or retry with different inputs.

- [ ] **Step 5: Branch from the evidence**

If PASS, the revised manifest is the sole input to the next exact Task 3
readiness calculation; it still does not allow Preview or Save.

If `active_retired_count > 0`, stop and prepare a new, separate governed
revoke proposal that identifies no principal. Do not change those rows in this
plan.

### Task 4: Record The Aggregate Result

**Files:**
- Modify: `docs/security/phase02-task3-permission-readiness-matrix.md`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**
- Consumes a Gate B0 result.
- Produces an auditable Task 3 blocker state containing no raw manifest data.

- [ ] **Step 1: Update the readiness matrix after a PASS**

Record only: the two retired codes, confirmation that
`confirm_fulfillment` remains operational, old/revised regrant and DROP
arithmetic, revised pending rows/principals, remaining blocker-code count,
active-retired count, active Direct Grant count, and enabled-flag count.

- [ ] **Step 2: Update the live apply log**

Record that B0 was read-only; no catalog, readiness, grant, principal, warning,
role, history, or flag mutation occurred. State whether the next checkpoint is
a fresh exact-manifest readiness test or a separate governed-revoke proposal.

- [ ] **Step 3: Verify and commit the evidence**

```bash
npx vitest run \
  lib/__tests__/materialRequestReadinessRetirement.test.ts \
  lib/__tests__/authorizationSensitiveGrantManifestRevisionGate.test.ts
npx tsc --noEmit
git diff --check
git add \
  docs/security/phase02-task3-permission-readiness-matrix.md \
  docs/security/phase02-business-role-sod-live-apply-log.md
git commit -m "docs(authz): record material request retirement readiness"
```

Expected: only aggregate evidence is committed. The user-owned roadmap remains
unstaged.

## Exit Criteria

- The two retired codes are excluded only from the revised exact regrant decision and remain active `declared` catalog actions.
- Old source/regrant fingerprints match before the revision is accepted.
- Revised count/fingerprint exist only as approved aggregate runtime evidence.
- Active retired count is zero; otherwise the tranche stops before mutation.
- Non-sensitive fingerprint and rollout flags remain unchanged.
- No principal is previewed or saved, and no Cloud mutation occurs.

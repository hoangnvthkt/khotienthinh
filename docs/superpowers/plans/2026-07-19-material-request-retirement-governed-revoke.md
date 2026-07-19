# Material Request Retirement Governed Revoke Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove exactly the eight active retired Material Request keys through the existing governed Direct Grant command, then rerun B0.

**Architecture:** Add a rollback-only post-revoke aggregate gate. Each mutation uses a fresh complete Direct Grant draft in the authenticated UI, removes only private-set retired keys, Previews first, and Saves once. Batches contain at most three principals and require a new approval between batches.

**Tech Stack:** React Settings authorization UI, existing governed Direct Grant RPCs, Supabase Cloud, rollback-only SQL, Vitest.

## Global Constraints

- Retire only `project.material_request.confirm` and `project.material_request.verify`.
- Use reason `Task 13 Step 5: thu hồi quyền Material Request đã retire`.
- No direct SQL grant mutation, service-role bypass, catalog/readiness change, migration repair, or flag change.
- Do not print identities, raw drafts, grant keys, private-manifest paths, or audit payloads.
- Each batch has at most three principals. Hard deny stops immediately; warning needs fresh valid independent acceptance.
- Do not edit/stage the user-owned roadmap.

### Task 1: Add A Post-Revoke Aggregate Gate

**Files:**
- Create: `supabase/tests/authorization_sensitive_grant_retirement_postcheck.sql`
- Create: `lib/__tests__/authorizationSensitiveGrantRetirementPostcheck.test.ts`

**Interfaces:**
- Consumes session settings for expected active-retired count, active-sensitive count, non-sensitive fingerprint, Direct Grant count, retirement audit count, durable operator count, and enabled-flag count.
- Produces checkpoint `authorization_sensitive_grant_retirement_postcheck_passed` or fails in a rollback-only transaction.

- [ ] **Step 1: Write the failing static test**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('sensitive grant retirement postcheck', () => {
  it('is rollback-only and checks only aggregate retirement controls', () => {
    const sql = fs.readFileSync(path.resolve(
      process.cwd(),
      'supabase/tests/authorization_sensitive_grant_retirement_postcheck.sql',
    ), 'utf8');
    expect(sql).toMatch(/^begin;[\s\S]*rollback;\s*$/i);
    expect(sql).toMatch(/expected_active_retired_count/i);
    expect(sql).toMatch(/expected_retirement_audit_count/i);
    expect(sql).toContain("'project.material_request.confirm'");
    expect(sql).toContain("'project.material_request.verify'");
    expect(sql).toMatch(/authorization_sensitive_grant_retirement_postcheck_passed/i);
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create)\b/i);
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run lib/__tests__/authorizationSensitiveGrantRetirementPostcheck.test.ts
```

Expected: `ENOENT` because the gate does not exist.

- [ ] **Step 3: Implement the rollback-only gate**

The SQL file must contain only `BEGIN`, one `DO` block, checkpoint `SELECT`, and `ROLLBACK`. It reads the expected settings, rejects empty values, then asserts:

```sql
select count(*)
from public.user_permission_grants
where is_active
  and permission_code in (
    'project.material_request.confirm',
    'project.material_request.verify'
  );
```

matches `app.expected_active_retired_count`; active sensitive count, non-sensitive fingerprint, active Direct Grant count, durable operator count, zero enabled flags, and the count of `direct_permission_grants_changed` events with the exact retirement reason also match their expected settings.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run lib/__tests__/authorizationSensitiveGrantRetirementPostcheck.test.ts
npx tsc --noEmit
git diff --check
git add \
  supabase/tests/authorization_sensitive_grant_retirement_postcheck.sql \
  lib/__tests__/authorizationSensitiveGrantRetirementPostcheck.test.ts
git commit -m "test(authz): add retired key revoke postcheck"
```

### Task 2: Cloud Gate B1 Preflight

**Files:**
- Verify: `supabase/tests/authorization_sensitive_grant_retirement_postcheck.sql`
- Modify after every batch: both Phase 02 security evidence documents.

- [ ] **Step 1: Build the private runtime set**

Use the B0 source CTE and filter only active rows for the two retired codes. Group the eight keys by principal in a mode-`0600` private artifact; do not print the groups or keys.

- [ ] **Step 2: Read-only preflight**

Confirm aggregates: active retired `8`, active sensitive `103`, active Direct Grants `2282`, unchanged non-sensitive fingerprint, durable operator `1`, zero enabled flags, and no prior retirement-revoke audit event.

- [ ] **Step 3: Request explicit Cloud Gate B1a**

State that B1a permits at most three private-set principals, each via authenticated governed Preview then one Save, using only the exact retirement reason. It does not authorize any other principal, grant key, warning acceptance, or flag/history action.

### Task 3: Execute One Governed Batch

- [ ] **Step 1: For each private-set principal, reload the complete current draft**

Keep every row other than the private-set retired keys byte-for-byte equivalent in permission, scope, expiry, and reason.

- [ ] **Step 2: Run fresh backend Preview**

Stop on hard deny. For a warning, stop unless the fresh preview has valid independent-control acceptance already approved.

- [ ] **Step 3: Save once with the exact reason**

```text
Task 13 Step 5: thu hồi quyền Material Request đã retire
```

Immediately reload the principal and submit the identical draft only if the UI allows it. Expected: no additional grant or audit event.

- [ ] **Step 4: Run aggregate postcheck**

Inject the precomputed expected counts into the postcheck. Expected: active retired and active sensitive decrease exactly by the processed key count; other approved baselines are unchanged; retirement audit count rises by the processed principal count.

- [ ] **Step 5: Record aggregate evidence and stop**

Append only batch key count, aggregate deltas, retry no-op result, and baselines. Stop for a new B1 batch approval unless active retired is zero.

### Task 4: Finish And Rerun B0

- [ ] **Step 1: After the final approved batch, run the postcheck with active retired `0` and active sensitive `95`.**

- [ ] **Step 2: Rerun B0 with revised regrant `383`, DROP `84`, and fingerprint `43676e109ad8c48a83243adedcfa6e33`.**

Expected: B0 checkpoint passes and adopts the revised manifest; it still does not allow any of the 12 pending principal regrants.

- [ ] **Step 3: Commit only aggregate evidence**

```bash
npm test
npx tsc --noEmit
git diff --check
git add docs/security/phase02-task3-permission-readiness-matrix.md \
  docs/security/phase02-business-role-sod-live-apply-log.md
git commit -m "docs(authz): record governed material retirement revoke"
```


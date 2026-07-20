# Material Request Retired Direct Grant UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the two approved retired Material Request Direct Grants for governed removal only.

**Architecture:** Keep the full Direct Grant draft authoritative. Derive a two-code retired subset and render removal-only controls which delete a selected draft item; existing Preview and Save submit the unified draft unchanged.

**Tech Stack:** React, TypeScript, Vitest.

## Global Constraints

- Permit removal only for `project.material_request.confirm` and `project.material_request.verify`.
- Do not add either retired action to the registry or allow a new grant.
- Preserve the authenticated Preview and governed Save path.
- Do not modify applied migrations or the user-owned roadmap.

---

### Task 1: Retired Direct Grant Removal Surface

**Files:**
- Modify: `lib/__tests__/authorizationAdminUiContract.test.ts`
- Modify: `components/permissions/PrincipalDirectGrantPanel.tsx`

**Interfaces:**
- Consumes: `drafts: UserPermissionGrant[]` from the Direct Grant panel state.
- Produces: removal-only controls which call `updateDrafts` with one selected retired draft removed.

- [ ] **Step 1: Write the failing contract test**

```ts
it('exposes only approved retired Direct Grants for removal', () => {
  const panel = read('components/permissions/PrincipalDirectGrantPanel.tsx');
  expect(panel).toContain('RETIRED_MATERIAL_REQUEST_PERMISSION_CODES');
  expect(panel).toContain("'project.material_request.confirm'");
  expect(panel).toContain("'project.material_request.verify'");
  expect(panel).toContain('retiredDirectGrants');
  expect(panel).toContain('Quyền retire chỉ được thu hồi');
  expect(panel).toContain('updateDrafts(drafts.filter(candidate => candidate !== grant))');
});
```

- [ ] **Step 2: Verify the test is red**

Run: `npx vitest run lib/__tests__/authorizationAdminUiContract.test.ts`

Expected: FAIL because the retired-only surface is absent.

- [ ] **Step 3: Add the minimal removal-only panel**

```tsx
const RETIRED_MATERIAL_REQUEST_PERMISSION_CODES = new Set([
  'project.material_request.confirm',
  'project.material_request.verify',
]);

const retiredDirectGrants = drafts.filter(grant =>
  grant.isActive !== false
  && RETIRED_MATERIAL_REQUEST_PERMISSION_CODES.has(grant.permissionCode),
);
```

Render a checked checkbox for each `retiredDirectGrants` item. On uncheck,
call `updateDrafts(drafts.filter(candidate => candidate !== grant))`; never
create a draft entry.

- [ ] **Step 4: Verify the focused test is green**

Run: `npx vitest run lib/__tests__/authorizationAdminUiContract.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify and commit the implementation**

Run: `npm test && npx tsc --noEmit && git diff --check`

Commit message: `feat(authz): allow governed retired grant removal`.

### Task 2: Governed Retirement Execution

**Files:**
- Modify after mutation: `docs/security/phase02-task3-permission-readiness-matrix.md`
- Modify after mutation: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**
- Consumes: the removal-only UI surface and the private B1 runtime set.
- Produces: aggregate-only B1 postcheck evidence and B0 result.

- [ ] **Step 1: Reload each private-set principal and remove only retired controls**

Use the authenticated Direct Grant panel and preserve every remaining draft entry.

- [ ] **Step 2: Preview and save through the existing backend command**

Use reason `Task 13 Step 5: thu hồi quyền Material Request đã retire`. Stop for a hard deny or warning without a valid independent acceptance.

- [ ] **Step 3: Run aggregate postcheck after each batch**

Expected: only sensitive retirement totals change; non-sensitive fingerprint, durable operator, and flags stay unchanged.

- [ ] **Step 4: Rerun B0 at active retired zero and commit evidence**

Expected: the rollback-only revision gate passes with regrant `383`, DROP `84`, and fingerprint `43676e109ad8c48a83243adedcfa6e33`.

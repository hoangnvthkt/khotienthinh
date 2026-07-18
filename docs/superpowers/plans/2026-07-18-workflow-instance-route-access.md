# Workflow Instance Route Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let legacy users who can open `/wf` open workflow instance details without exposing workflow template administration.

**Architecture:** Extend the existing narrow legacy workflow child-route handling in `canOpenLegacyRoute`. Keep the change inside the centralized permission service and cover both allowed and admin submodule grants with direct behavior tests.

**Tech Stack:** TypeScript, React Router route matching, Vitest.

## Global Constraints

- Do not modify production data, database policies, permission records, or UI.
- Do not generalize parent-route inheritance to other modules.
- Keep `/wf/templates` and `/wf/builder/:id` unavailable when the only WF route grant is `/wf`.
- Deliver only the isolated workflow route fix to `main`.

---

### Task 1: Add legacy workflow instance child-route access

**Files:**
- Modify: `lib/__tests__/permissionService.test.ts`
- Modify: `lib/permissions/permissionService.ts:135-160`

**Interfaces:**
- Consumes: `canViewRoute(user, route, scope?) => boolean`
- Produces: legacy `/wf` grant inheritance for `/wf/instances/:id`

- [ ] **Step 1: Write the failing regression tests**

Add tests which exercise the public `canViewRoute` boundary:

```ts
it.each([
  ['allowed submodule', { allowedSubModules: { WF: ['/wf'] } }],
  ['admin submodule', { adminSubModules: { WF: ['/wf'] } }],
])('opens workflow instance details from a legacy %s grant', (_, overrides) => {
  expect(canViewRoute(user({ allowedModules: [], ...overrides }), '/wf/instances/instance-1')).toBe(true);
});

it('does not expose workflow template routes from a legacy workflow list grant', () => {
  const workflowUser = user({ allowedModules: [], allowedSubModules: { WF: ['/wf'] } });
  expect(canViewRoute(workflowUser, '/wf/templates')).toBe(false);
  expect(canViewRoute(workflowUser, '/wf/builder/template-1')).toBe(false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run lib/__tests__/permissionService.test.ts
```

Expected: both workflow instance detail cases fail with `expected false to be true`; the template containment case passes.

- [ ] **Step 3: Implement the minimal route rule**

Add this narrow rule after exact legacy route matching and before the existing workflow builder rule:

```ts
if (
  legacyModuleKey === 'WF' &&
  routeMatches('/wf/instances/:id', route) &&
  (allowedSubs.includes('/wf') || adminSubs.includes('/wf'))
) return true;
```

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
npx vitest run lib/__tests__/permissionService.test.ts
npm test
npm run lint
npm run build
git diff --check
```

Expected: all commands exit `0`, with no test failures or TypeScript/build errors.

- [ ] **Step 5: Commit the isolated change**

Review the diff to confirm only the design/plan, permission service, and permission tests are included, then commit:

```bash
git add docs/superpowers/specs/2026-07-18-workflow-instance-route-access-design.md \
  docs/superpowers/plans/2026-07-18-workflow-instance-route-access.md \
  lib/permissions/permissionService.ts \
  lib/__tests__/permissionService.test.ts
git commit -m "fix(authz): allow workflow list grants to open instances"
```

- [ ] **Step 6: Integrate only the fix into main**

Fetch `origin/main`, create a clean main integration worktree, cherry-pick the isolated implementation commit, verify the result again, and push with a normal fast-forward update to `origin/main`. Do not merge `refactor/module-du-an-v1` into `main` and do not force-push.

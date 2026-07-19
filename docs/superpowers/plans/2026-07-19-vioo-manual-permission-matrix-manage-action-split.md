# VIOO Manual Permission Matrix and Manage Action Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline and sequentially in the current session. Do not use subagents for this corrective pass. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the permission administration path so it edits manual per-user Direct Grants across all modules, removes quick-template/project-only behavior from the primary UX, preserves Legacy/Role evidence, and keeps broad legacy `manage` rights as compatibility-only while explicit action permissions are granted one by one.

**Architecture:** Keep enforcement in the existing governed Preview/Apply Direct Grant commands and do not introduce new Cloud schema in this pass. Reuse the current permission registry, unified source-aware rows, readiness gates, and compact tree, but make the tree all-module and scope-adaptive. Treat Legacy `manage` as a visible compatibility source; do not make broad `manage` newly grantable.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, Supabase JS 2.98 through existing services only, existing `permissionRegistry`, `unifiedPermissionViewModel`, `authorizationGovernanceViewModel`, and governed `permissionAdminService` RPC wrappers.

## Global Constraints

- Work only in `/Users/admin/khotienthinh/.worktrees/material-request-readiness-tranche-b`.
- Do not edit root checkout files.
- Do not edit dirty roadmap files.
- Do not edit applied migrations.
- Do not change the Save 12 principals.
- No Supabase Cloud mutation from this plan.
- Use aggregate-only read-only evidence for any Cloud check; do not print identity, raw grants, tokens, or URLs.
- No direct SQL mutation of grant tables.
- No `supabase db push`.
- No local Supabase/Docker requirement.
- Stop fail-closed at any hard deny, warning, or invariant drift.
- No quick templates.
- No role presets as checkbox shortcuts.
- No `all projects` shortcut.
- No automatic legacy-to-new migration.
- No Phase 03 source-mode implementation.
- No negative grants or deny overrides.
- Legacy permissions remain parallel and visibly labeled.
- Declared or legacy-only actions may be shown but must not be newly grantable.
- Project is one application group inside the all-module matrix, not the whole permission administration page.
- Keep Remediation C for Material Request provenance separate unless the operator explicitly resumes it.

---

## File Structure

- Modify `lib/permissions/directUserPermissionMatrixViewModel.ts`: keep only Direct Grant dedupe/copy/paste helpers; remove quick-template apply contracts.
- Modify `lib/__tests__/directUserPermissionMatrixViewModel.test.ts`: cover copy/paste replacement and prove quick-template helpers are gone.
- Modify `lib/__tests__/authorizationAdminUiContract.test.ts`: update the primary UX contract so it rejects `Mẫu quyền`, quick-template editor/service imports, project-only filters, direct table mutation, and browser actor payloads.
- Modify `pages/settings/SettingsAuthorizationGovernance.tsx`: remove the `Mẫu quyền` tab and `PermissionQuickTemplateEditor` mount; keep `Phân quyền user` and advanced evidence.
- Modify `components/permissions/DirectUserPermissionWorkspace.tsx`: remove quick-template/project-only state, load no template data, use `PermissionScopePicker`, render the compact tree across all applications, and keep governed Preview/Save/copy/paste.
- Modify `components/permissions/CompactDirectPermissionTree.tsx`: enforce view-first child action behavior and keep Role/Legacy badges read-only.
- Modify `lib/__tests__/compactDirectPermissionTree.test.tsx`: add source-level contract for view-first child behavior and all-module rendering.
- Create `lib/__tests__/manualPermissionCatalogContract.test.ts`: guard the catalog shape for legacy `manage` compatibility and explicit action grantability.
- Create `docs/security/manual-permission-matrix-inventory.md`: record the reviewed inventory boundary and the fact that broad `manage` remains compatibility-only.

---

### Task 1: Remove Quick Template Draft Logic

**Files:**
- Modify: `lib/permissions/directUserPermissionMatrixViewModel.ts`
- Modify: `lib/__tests__/directUserPermissionMatrixViewModel.test.ts`

**Interfaces:**
- Consumes: `UserPermissionGrant` from `types.ts`; `PermissionScopeType` from `lib/permissions/permissionTypes.ts`.
- Produces:
  - `DirectPermissionClipboardGrant`
  - `DirectPermissionClipboard`
  - `dedupeDirectGrantDrafts(grants: readonly UserPermissionGrant[]): UserPermissionGrant[]`
  - `copyDirectPermissionDraft(grants: readonly UserPermissionGrant[]): DirectPermissionClipboard`
  - `pasteDirectPermissionClipboard(targetUserId: string, clipboard: DirectPermissionClipboard): UserPermissionGrant[]`

- [ ] **Step 1: Replace the test with manual draft-only coverage**

Replace `lib/__tests__/directUserPermissionMatrixViewModel.test.ts` with:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import {
  copyDirectPermissionDraft,
  dedupeDirectGrantDrafts,
  pasteDirectPermissionClipboard,
} from '../permissions/directUserPermissionMatrixViewModel';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const grant = (
  userId: string,
  permissionCode: string,
  scopeId: string,
  overrides: Partial<UserPermissionGrant> = {},
): UserPermissionGrant => ({
  userId,
  permissionCode,
  scopeType: 'project',
  scopeId,
  ...overrides,
});

describe('direct user permission matrix view model', () => {
  it('dedupes active grants by user, code, scope, and expiry without carrying database or audit fields', () => {
    const next = dedupeDirectGrantDrafts([
      {
        id: 'db-1',
        grantedBy: 'actor-1',
        grantedAt: '2026-07-18T00:00:00.000Z',
        ...grant('user-1', 'project.daily_log.view', 'project-1'),
      },
      grant('user-1', 'project.daily_log.view', 'project-1'),
      {
        ...grant('user-1', 'project.daily_log.view', 'project-1'),
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
      { ...grant('user-1', 'project.daily_log.create', 'project-1'), isActive: false },
    ]);

    expect(next).toEqual([
      grant('user-1', 'project.daily_log.view', 'project-1'),
      {
        ...grant('user-1', 'project.daily_log.view', 'project-1'),
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });

  it('copies active Direct drafts without identity, row, actor, timestamp, Role, Legacy, or audit fields', () => {
    const clipboard = copyDirectPermissionDraft([
      {
        id: 'db-1',
        grantedBy: 'actor-1',
        grantedAt: '2026-07-18T00:00:00.000Z',
        ...grant('user-a', 'project.daily_log.view', 'project-1'),
      },
      { ...grant('user-a', 'project.payment.view', 'project-1'), isActive: false },
      {
        ...grant('user-a', 'project.payment.verify', 'project-2'),
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ]);

    expect(clipboard.grants).toEqual([
      {
        permissionCode: 'project.daily_log.view',
        scopeType: 'project',
        scopeId: 'project-1',
        expiresAt: undefined,
      },
      {
        permissionCode: 'project.payment.verify',
        scopeType: 'project',
        scopeId: 'project-2',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    expect(clipboard.copiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('pastes by replacing the receiving user Direct Grant draft', () => {
    const clipboard = {
      copiedAt: '2026-07-19T00:00:00.000Z',
      grants: [
        {
          permissionCode: 'project.daily_log.view',
          scopeType: 'project' as const,
          scopeId: 'project-1',
          expiresAt: undefined,
        },
        {
          permissionCode: 'system.authorization.audit',
          scopeType: 'global' as const,
          scopeId: '*',
          expiresAt: undefined,
        },
      ],
    };

    expect(pasteDirectPermissionClipboard('user-b', clipboard)).toEqual([
      {
        userId: 'user-b',
        permissionCode: 'project.daily_log.view',
        scopeType: 'project',
        scopeId: 'project-1',
        expiresAt: undefined,
      },
      {
        userId: 'user-b',
        permissionCode: 'system.authorization.audit',
        scopeType: 'global',
        scopeId: '*',
        expiresAt: undefined,
      },
    ]);
  });

  it('does not expose quick-template draft behavior', () => {
    const source = read('lib/permissions/directUserPermissionMatrixViewModel.ts');

    expect(source).not.toContain('PermissionQuickTemplateDraft');
    expect(source).not.toContain('ApplyPermissionQuickTemplateInput');
    expect(source).not.toContain('applyPermissionQuickTemplateToDraft');
    expect(source).not.toContain('projectPermissionTemplates');
  });
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```bash
npm test -- lib/__tests__/directUserPermissionMatrixViewModel.test.ts
```

Expected: FAIL because `directUserPermissionMatrixViewModel.ts` still exposes `PermissionQuickTemplateDraft`, `ApplyPermissionQuickTemplateInput`, and `applyPermissionQuickTemplateToDraft`.

- [ ] **Step 3: Replace the draft helper implementation**

Replace `lib/permissions/directUserPermissionMatrixViewModel.ts` with:

```ts
import type { UserPermissionGrant } from '../../types';
import type { PermissionScopeType } from './permissionTypes';

export interface DirectPermissionClipboardGrant {
  permissionCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  expiresAt?: string;
}

export interface DirectPermissionClipboard {
  copiedAt: string;
  grants: DirectPermissionClipboardGrant[];
}

const draftKey = (
  grant: Pick<UserPermissionGrant, 'userId' | 'permissionCode' | 'scopeType' | 'scopeId' | 'expiresAt'>,
): string => [
  grant.userId,
  grant.permissionCode,
  grant.scopeType || 'global',
  grant.scopeId || '*',
  grant.expiresAt || '',
].join('\u001f');

export const dedupeDirectGrantDrafts = (
  grants: readonly UserPermissionGrant[],
): UserPermissionGrant[] => {
  const byKey = new Map<string, UserPermissionGrant>();

  for (const grant of grants) {
    if (grant.isActive === false) continue;
    const normalized: UserPermissionGrant = {
      userId: grant.userId,
      permissionCode: grant.permissionCode,
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      expiresAt: grant.expiresAt,
    };
    byKey.set(draftKey(normalized), normalized);
  }

  return [...byKey.values()].sort((left, right) =>
    `${left.permissionCode}:${left.scopeType}:${left.scopeId}:${left.expiresAt || ''}`
      .localeCompare(`${right.permissionCode}:${right.scopeType}:${right.scopeId}:${right.expiresAt || ''}`));
};

export const copyDirectPermissionDraft = (
  grants: readonly UserPermissionGrant[],
): DirectPermissionClipboard => ({
  copiedAt: new Date().toISOString(),
  grants: dedupeDirectGrantDrafts(grants).map(grant => ({
    permissionCode: grant.permissionCode,
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
    expiresAt: grant.expiresAt,
  })),
});

export const pasteDirectPermissionClipboard = (
  targetUserId: string,
  clipboard: DirectPermissionClipboard,
): UserPermissionGrant[] => dedupeDirectGrantDrafts(
  clipboard.grants.map(grant => ({
    userId: targetUserId,
    permissionCode: grant.permissionCode,
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
    expiresAt: grant.expiresAt,
  })),
);
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- lib/__tests__/directUserPermissionMatrixViewModel.test.ts
git diff --check -- lib/permissions/directUserPermissionMatrixViewModel.ts lib/__tests__/directUserPermissionMatrixViewModel.test.ts
```

Expected: PASS and no whitespace findings.

- [ ] **Step 5: Commit Task 1**

```bash
git add lib/permissions/directUserPermissionMatrixViewModel.ts lib/__tests__/directUserPermissionMatrixViewModel.test.ts
git commit -m "refactor(authz): keep direct permission draft copy paste only"
```

---

### Task 2: Remove Quick Template UI From The Primary Page

**Files:**
- Modify: `lib/__tests__/authorizationAdminUiContract.test.ts`
- Modify: `pages/settings/SettingsAuthorizationGovernance.tsx`
- Modify: `components/permissions/DirectUserPermissionWorkspace.tsx`

**Interfaces:**
- Consumes: Task 1 `DirectPermissionClipboard`, `copyDirectPermissionDraft`, and `pasteDirectPermissionClipboard`.
- Produces: one primary tab `Phân quyền user`, no `Mẫu quyền` tab, no quick-template editor mount, and no quick-template service load in the primary workflow.

- [ ] **Step 1: Update the UI contract test**

In `lib/__tests__/authorizationAdminUiContract.test.ts`, replace the two quick-template/project-only tests at the bottom with:

```ts
  it('makes manual direct user permission matrix the only primary governance workflow', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    const workspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');

    expect(page).toContain('Phân quyền user');
    expect(page).toContain('DirectUserPermissionWorkspace');
    expect(page).not.toContain('Mẫu quyền');
    expect(page).not.toContain('PermissionQuickTemplateEditor');
    expect(page).not.toContain("activeTab === 'templates'");
    expect(workspace).toContain('Copy quyền');
    expect(workspace).toContain('Dán quyền');
    expect(workspace).toContain('Preview backend');
    expect(workspace).toContain('Lưu phân quyền');
    expect(workspace).not.toContain('permissionQuickTemplateService');
    expect(workspace).not.toContain('PROJECT_PERMISSION_TEMPLATES');
    expect(workspace).not.toContain('applyPermissionQuickTemplateToDraft');
  });

  it('keeps direct save governed and does not mutate identity, role assignment, audit, grant tables, or source mode from the browser', () => {
    const workspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');

    expect(workspace).toContain('previewUserPermissionChange');
    expect(workspace).toContain('applyUserPermissionChange');
    expect(workspace).not.toContain(".from('user_permission_grants')");
    expect(workspace).not.toContain('principal_role_assignments');
    expect(workspace).not.toContain('permission_audit_events');
    expect(workspace).not.toContain('source_mode');
    expect(workspace).not.toMatch(/actorUserId|requestedBy|p_actor/);
  });
```

Delete the old `edits quick templates as presets, not live Business Role assignments` test entirely.

- [ ] **Step 2: Run the contract and observe RED**

Run:

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: FAIL because `SettingsAuthorizationGovernance.tsx` still imports and mounts `PermissionQuickTemplateEditor`, and `DirectUserPermissionWorkspace.tsx` still imports quick-template/template helpers.

- [ ] **Step 3: Remove the templates tab from SettingsAuthorizationGovernance**

In `pages/settings/SettingsAuthorizationGovernance.tsx`:

1. Remove this import:

```ts
import PermissionQuickTemplateEditor from '../../components/permissions/PermissionQuickTemplateEditor';
```

2. Change the tab state:

```ts
const [activeTab, setActiveTab] = useState<'users' | 'advanced'>('users');
```

3. Replace the tab list with:

```tsx
{([
  ['users', 'Phân quyền user'],
  ['advanced', 'Nguồn nâng cao'],
] as const).map(([tab, label]) => (
```

4. Delete the entire render branch:

```tsx
{activeTab === 'templates' && (
  <PermissionQuickTemplateEditor disabled={!canManageGrants} />
)}
```

- [ ] **Step 4: Remove quick-template imports and state from DirectUserPermissionWorkspace**

In `components/permissions/DirectUserPermissionWorkspace.tsx`:

1. Remove these imports:

```ts
import { projectMasterService } from '../../lib/projectMasterService';
import {
  getProjectPermissionTemplateCodes,
  PROJECT_PERMISSION_TEMPLATES,
} from '../../lib/permissions/projectPermissionTemplates';
import {
  permissionQuickTemplateService,
  type PermissionQuickTemplate,
} from '../../lib/permissions/permissionQuickTemplateService';
import {
  applyPermissionQuickTemplateToDraft,
  copyDirectPermissionDraft,
  pasteDirectPermissionClipboard,
  type DirectPermissionClipboard,
} from '../../lib/permissions/directUserPermissionMatrixViewModel';
```

2. Replace them with:

```ts
import {
  copyDirectPermissionDraft,
  pasteDirectPermissionClipboard,
  type DirectPermissionClipboard,
} from '../../lib/permissions/directUserPermissionMatrixViewModel';
```

3. Delete the state declarations named `projects`, `customTemplates`,
   `selectedProjectId`, and `selectedTemplateId`.

4. Delete the derived values named `projectModules`, `staticTemplates`,
   `templates`, `selectedTemplate`, and `selectedProject`.

5. Delete the loading effect that calls:

```ts
projectMasterService.list()
permissionQuickTemplateService.list()
```

6. Delete the effect that auto-selects a template.

7. Delete the `applyTemplate` handler and the template selector/button from the left side.

- [ ] **Step 5: Run the focused contract and verify GREEN for template removal**

Run:

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
git diff --check -- pages/settings/SettingsAuthorizationGovernance.tsx components/permissions/DirectUserPermissionWorkspace.tsx lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: PASS for the updated quick-template contract. TypeScript may still fail until Task 3 finishes scope cleanup if project state references remain; remove every dead reference before committing this task.

- [ ] **Step 6: Commit Task 2**

```bash
git add pages/settings/SettingsAuthorizationGovernance.tsx components/permissions/DirectUserPermissionWorkspace.tsx lib/__tests__/authorizationAdminUiContract.test.ts
git commit -m "refactor(authz): remove quick templates from permission admin"
```

---

### Task 3: Make The Direct User Matrix All-Module And Scope-Adaptive

**Files:**
- Modify: `lib/__tests__/authorizationAdminUiContract.test.ts`
- Modify: `components/permissions/DirectUserPermissionWorkspace.tsx`

**Interfaces:**
- Consumes: `PermissionScopePicker`, `CompactDirectPermissionTree`, `previewUserPermissionChange`, `applyUserPermissionChange`.
- Produces: the primary workflow renders all applications/modules from `permissionRegistry` and uses a generic `PermissionScope` instead of fixed Project scope.

- [ ] **Step 1: Extend the UI contract**

Add this test to `lib/__tests__/authorizationAdminUiContract.test.ts`:

```ts
  it('renders all-module matrix with adaptive scope instead of project-only filtering', () => {
    const workspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');

    expect(workspace).toContain('PermissionScopePicker');
    expect(workspace).toContain('<CompactDirectPermissionTree');
    expect(workspace).not.toContain('applicationFilter="project"');
    expect(workspace).not.toContain('projectMasterService.list');
    expect(workspace).not.toContain('__missing_project__');
    expect(workspace).not.toContain('Hay chon mot du an');
    expect(workspace).not.toContain('Tất cả dự án');
  });
```

- [ ] **Step 2: Run the contract and observe RED**

Run:

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: FAIL because `DirectUserPermissionWorkspace.tsx` still uses fixed Project scope and `applicationFilter="project"`.

- [ ] **Step 3: Add scope state and PermissionScopePicker**

In `components/permissions/DirectUserPermissionWorkspace.tsx`:

1. Add imports:

```ts
import type { PermissionScope } from '../../lib/permissions/permissionTypes';
import PermissionScopePicker from './PermissionScopePicker';
```

2. Replace the fixed Project scope with:

```ts
const [scope, setScope] = useState<PermissionScope>({ scopeType: 'global', scopeId: '*' });
const normalizedScope = useMemo(() => ({
  scopeType: scope.scopeType || 'global',
  scopeId: scope.scopeId || '*',
}), [scope]);
```

3. Update the selected principal reset effect so it also clears preview but does not reset scope:

```ts
useEffect(() => {
  setDrafts([...grants]);
  setPreview(null);
  setPreviewedDraftKey(null);
  setAcceptances([]);
  setMessage('');
}, [grants, principal.userId]);
```

4. Add a scope picker in the left side:

```tsx
<div className="space-y-1.5">
  <div className="text-xs font-bold text-slate-600">Scope đang chỉnh</div>
  <PermissionScopePicker
    value={scope}
    onChange={nextScope => {
      setScope(nextScope);
      setPreview(null);
      setPreviewedDraftKey(null);
      setAcceptances([]);
      setMessage('');
    }}
    disabled={panelDisabled}
  />
</div>
```

- [ ] **Step 4: Remove Project gating from Preview and rendering**

In `handlePreview`, delete the project-specific guard:

```ts
if (!selectedProjectId) {
  setMessage('Hay chon mot du an cu the truoc khi preview.');
  return;
}
```

In the main header, replace the scope line with:

```tsx
<div className="mt-1 text-[10px] font-bold text-slate-400">
  Scope {normalizedScope.scopeType}/{normalizedScope.scopeId}
</div>
```

Render the tree without a project filter:

```tsx
<CompactDirectPermissionTree
  targetUserId={principal.userId}
  grants={drafts}
  effectiveSources={effectiveSources}
  scope={scope}
  disabled={panelDisabled}
  onGrantsChange={updateDrafts}
/>
```

- [ ] **Step 5: Run focused tests and type check for the workspace**

Run:

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
npx tsc --noEmit
git diff --check -- components/permissions/DirectUserPermissionWorkspace.tsx lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: PASS; no unused imports, no project-only gate, no TypeScript errors.

- [ ] **Step 6: Commit Task 3**

```bash
git add components/permissions/DirectUserPermissionWorkspace.tsx lib/__tests__/authorizationAdminUiContract.test.ts
git commit -m "feat(authz): make direct permission matrix all module"
```

---

### Task 4: Enforce View-First UX In The Compact Tree

**Files:**
- Modify: `lib/__tests__/compactDirectPermissionTree.test.tsx`
- Modify: `components/permissions/CompactDirectPermissionTree.tsx`

**Interfaces:**
- Consumes: `buildUnifiedPermissionRows(...)` and `toggleUnifiedDirectGrant(...)`.
- Produces: child action checkboxes can be added only after the matching module `view` is direct or effective for the current scope; Role/Legacy badges remain read-only.

- [ ] **Step 1: Extend the compact tree contract**

Add this test to `lib/__tests__/compactDirectPermissionTree.test.tsx`:

```ts
  it('requires module view before a child action can be added in the current scope', () => {
    const source = read('components/permissions/CompactDirectPermissionTree.tsx');

    expect(source).toContain('const hasViewAccess = viewRow.hasDirectGrant || viewRow.isEffective;');
    expect(source).toContain('!hasViewAccess');
    expect(source).toContain('Cần có quyền xem trước khi cấp thao tác này.');
    expect(source).toContain('toggleUnifiedDirectGrant');
  });

  it('does not filter the registry to Project in the reusable tree', () => {
    const source = read('components/permissions/CompactDirectPermissionTree.tsx');

    expect(source).toContain('permissionRegistry');
    expect(source).not.toContain('application.code === \\'project\\'');
  });
```

- [ ] **Step 2: Run the contract and observe RED**

Run:

```bash
npm test -- lib/__tests__/compactDirectPermissionTree.test.tsx
```

Expected: FAIL because `CompactDirectPermissionTree.tsx` does not compute `hasViewAccess` for child action addition.

- [ ] **Step 3: Add view-first child state**

In `components/permissions/CompactDirectPermissionTree.tsx`, inside `renderModule` after `viewDisabled`, add:

```ts
const hasViewAccess = viewRow.hasDirectGrant || viewRow.isEffective;
```

Inside `childRows.map`, replace the child `additionBlocked` and `disabledReason` block with:

```ts
const additionBlocked = !row.hasDirectGrant && (!row.canAdd || !childScopeAllowed || !hasViewAccess);
const inputDisabled = disabled || (row.hasDirectGrant ? !row.canRemove : additionBlocked);
const disabledReason = !childScopeAllowed
  ? 'Scope này không hỗ trợ tác vụ.'
  : !hasViewAccess
    ? 'Cần có quyền xem trước khi cấp thao tác này.'
    : row.readiness === 'declared'
      ? 'Chưa đủ bằng chứng để cấp mới.'
      : row.readiness === 'legacy'
        ? 'Legacy chỉ hiển thị tương thích.'
        : '';
```

Keep the existing `toggleUnifiedDirectGrant(...)` call. It still protects the model by adding `view` when a child action is toggled through an allowed path and by removing same-scope child Direct Grants when Direct `view` is removed.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- lib/__tests__/compactDirectPermissionTree.test.tsx
npm test -- lib/__tests__/unifiedPermissionViewModel.test.ts
git diff --check -- components/permissions/CompactDirectPermissionTree.tsx lib/__tests__/compactDirectPermissionTree.test.tsx
```

Expected: PASS and no whitespace findings.

- [ ] **Step 5: Commit Task 4**

```bash
git add components/permissions/CompactDirectPermissionTree.tsx lib/__tests__/compactDirectPermissionTree.test.tsx
git commit -m "feat(authz): require view before child grant"
```

---

### Task 5: Guard Legacy Manage As Compatibility-Only And Record Inventory Boundary

**Files:**
- Create: `lib/__tests__/manualPermissionCatalogContract.test.ts`
- Create: `docs/security/manual-permission-matrix-inventory.md`

**Interfaces:**
- Consumes: `getPermissionApplications()`, `getPermissionModules()`, `getAllPermissionActions()`, `resolvePermissionActionReadiness(...)`, `canAddDirectGrant(...)`.
- Produces: a static catalog guard proving every module has `view`, broad `manage` remains legacy-only, and explicit non-manage actions are the future grant surface.

- [ ] **Step 1: Write the catalog contract test**

Create `lib/__tests__/manualPermissionCatalogContract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getAllPermissionActions,
  getPermissionApplications,
  getPermissionModules,
} from '../permissions/permissionRegistry';
import {
  canAddDirectGrant,
  resolvePermissionActionReadiness,
} from '../permissions/permissionReadiness';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('manual permission matrix catalog contract', () => {
  it('keeps the matrix all-application and every module anchored by view', () => {
    const applicationCodes = getPermissionApplications().map(application => application.code);

    expect(applicationCodes).toEqual(expect.arrayContaining([
      'system',
      'project',
      'wms',
      'hrm',
      'expense',
      'workflow',
      'request',
      'asset',
      'contract',
    ]));

    for (const module of getPermissionModules()) {
      expect(
        module.actions.some(action => action.action === 'view' && action.permissionCode.endsWith('.view')),
        module.code,
      ).toBe(true);
    }
  });

  it('does not make broad legacy manage actions newly grantable', () => {
    const manageActions = getAllPermissionActions().filter(action => action.action === 'manage');

    expect(manageActions.length).toBeGreaterThan(0);
    for (const action of manageActions) {
      expect(resolvePermissionActionReadiness(action), action.permissionCode).toBe('legacy');
      expect(canAddDirectGrant(action), action.permissionCode).toBe(false);
    }
  });

  it('keeps explicit action permissions separate from broad manage', () => {
    const actionCodes = getAllPermissionActions().map(action => action.permissionCode);

    expect(actionCodes).toEqual(expect.arrayContaining([
      'project.daily_log.create',
      'project.daily_log.verify',
      'project.daily_log.approve',
      'project.payment.verify',
      'project.payment.approve',
      'project.payment.mark_paid',
      'project.documents.upload',
      'project.report.export',
      'system.authorization.manage_grants',
    ]));
  });

  it('records the manual matrix inventory boundary', () => {
    const inventory = read('docs/security/manual-permission-matrix-inventory.md');

    expect(inventory).toContain('Manual Permission Matrix Inventory');
    expect(inventory).toContain('Legacy manage remains compatibility-only');
    expect(inventory).toContain('Direct Grant matrix uses explicit action permissions');
    expect(inventory).toContain('Project is one application group, not the entire matrix');
    expect(inventory).toContain('No quick templates');
  });
});
```

- [ ] **Step 2: Run the contract and observe RED**

Run:

```bash
npm test -- lib/__tests__/manualPermissionCatalogContract.test.ts
```

Expected: FAIL because `docs/security/manual-permission-matrix-inventory.md` does not exist yet.

- [ ] **Step 3: Create the inventory boundary document**

Create `docs/security/manual-permission-matrix-inventory.md`:

```markdown
# Manual Permission Matrix Inventory

Date: 2026-07-19
Status: corrective implementation boundary

## Boundary

The manual permission matrix keeps the existing legacy administration mental
model but changes the new grant surface to explicit action permissions.

## Legacy manage remains compatibility-only

Legacy module and submodule administration rights remain visible as effective
Legacy evidence during migration. Broad `manage` actions are not newly
grantable from the Direct Grant matrix. They exist to explain compatibility
behavior and to guide module-by-module action splitting.

## Direct Grant matrix uses explicit action permissions

The Direct Grant matrix grants concrete actions such as `view`, `create`,
`edit`, `verify`, `approve`, `return`, `reject`, `mark_paid`, `upload`,
`delete`, and `export` only when those actions exist in the permission
registry and readiness allows new grants.

## Project is one application group, not the entire matrix

Project contains the most complex workflow surface, but the permission
administration page must also render System, WMS, HRM, Expense, Workflow,
Request, Asset, Contract, and other registered applications.

## No quick templates

The primary operator workflow has no quick templates, role presets, or custom
template editor. The operator manually checks user permissions and may copy
and paste one user's new Direct Grant draft to another user before previewing
and saving through the governed backend command.

## Backend boundary

The UI is not the security boundary. Backend RPC/RLS/module guards must deny
without effective `view` plus the requested child action, deny wrong scope,
and derive the actor server-side. This corrective pass does not add Cloud
schema or mutate grants directly.
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- lib/__tests__/manualPermissionCatalogContract.test.ts
git diff --check -- lib/__tests__/manualPermissionCatalogContract.test.ts docs/security/manual-permission-matrix-inventory.md
```

Expected: PASS and no whitespace findings.

- [ ] **Step 5: Commit Task 5**

```bash
git add lib/__tests__/manualPermissionCatalogContract.test.ts docs/security/manual-permission-matrix-inventory.md
git commit -m "test(authz): guard manual permission catalog boundary"
```

---

### Task 6: Run Focused Regression, Build, And Source Boundary Checks

**Files:**
- Verify only; do not edit unless a focused test exposes a defect from Tasks 1-5.

**Interfaces:**
- Consumes: completed Tasks 1-5.
- Produces: local verification evidence for the corrective UI and catalog boundary; no Cloud mutation.

- [ ] **Step 1: Run focused permission tests**

Run:

```bash
npm test -- \
  lib/__tests__/directUserPermissionMatrixViewModel.test.ts \
  lib/__tests__/authorizationAdminUiContract.test.ts \
  lib/__tests__/compactDirectPermissionTree.test.tsx \
  lib/__tests__/manualPermissionCatalogContract.test.ts \
  lib/__tests__/unifiedPermissionViewModel.test.ts \
  lib/__tests__/permissionRegistry.test.ts
```

Expected: PASS. Any fail must be fixed in the smallest file from Tasks 1-5, then this exact command rerun.

- [ ] **Step 2: Run full frontend safety checks**

Run:

```bash
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Expected: lint PASS, TypeScript PASS, build exits `0`, and `git diff --check` has no output. If Vite emits the known chunk-size warning while exiting `0`, record it as existing accepted build warning rather than a new failure.

- [ ] **Step 3: Confirm forbidden primary-path references are absent**

Run:

```bash
rg -n "PermissionQuickTemplateEditor|permissionQuickTemplateService|applyPermissionQuickTemplateToDraft|PROJECT_PERMISSION_TEMPLATES|applicationFilter=\"project\"|__missing_project__|Tất cả dự án" \
  pages/settings/SettingsAuthorizationGovernance.tsx \
  components/permissions/DirectUserPermissionWorkspace.tsx \
  lib/permissions/directUserPermissionMatrixViewModel.ts
```

Expected: exit `1` with no matches. Matches inside old committed docs/plans are allowed only outside these runtime files.

- [ ] **Step 4: Confirm browser mutation boundary remains governed**

Run:

```bash
rg -n "from\\('user_permission_grants'\\)|from\\('principal_role_assignments'\\)|from\\('permission_audit_events'\\)|actorUserId|requestedBy|p_actor|source_mode" \
  components/permissions/DirectUserPermissionWorkspace.tsx \
  pages/settings/SettingsAuthorizationGovernance.tsx
```

Expected: exit `1` with no matches.

- [ ] **Step 5: Inspect worktree status**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: only known unrelated untracked files remain, if any. Do not stage:

```text
docs/superpowers/plans/2026-07-19-material-request-provenance-remediation.md
lib/__tests__/permissionQuickTemplateGrantForwardFix.test.ts
supabase/migrations/20260719092735_permission_quick_template_private_impl_grants.sql
```

- [ ] **Step 6: Commit verification-only doc adjustment if needed**

If no file changed in Task 6, do not create a commit. If a focused defect from Tasks 1-5 required a small correction, return to the task that introduced the defect, update that task's exact files, rerun that task's focused commands, and commit with that task's commit command.

---

## Self-Review Checklist

- Spec coverage: Tasks 1-4 implement no templates, all-module matrix, adaptive scope, view-first UX, copy/paste, governed Preview/Save, and no browser actor/table mutation. Task 5 records the legacy `manage` split boundary and prevents broad `manage` from becoming newly grantable. Task 6 verifies focused and wider checks.
- Supabase boundary: no migration, no Cloud mutation, no direct SQL grant mutation, no `supabase db push`, and no local Docker/Supabase.
- Remediation C boundary: no `PrincipalDirectGrantPanel` repair/provenance implementation is changed by this plan; the old untracked Remediation C plan remains separate.
- Type consistency: exported helper names are `dedupeDirectGrantDrafts`, `copyDirectPermissionDraft`, `pasteDirectPermissionClipboard`, and `DirectPermissionClipboard`; UI imports match those names.
- No quick-template runtime path remains in the primary page or direct-user workspace.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-19-vioo-manual-permission-matrix-manage-action-split.md`.

Two execution options:

1. **Inline Execution (recommended for this correction)** - Execute tasks in this session using `superpowers:executing-plans`, with a checkpoint after each task and no Cloud mutation.
2. **Pause After Plan** - Stop here so the operator can review the plan before any code change.

Which approach?

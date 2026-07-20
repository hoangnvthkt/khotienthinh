# Vioo Application Permission Workbench Implementation Plan

> **Superseded on 2026-07-20:** Tasks that build editable Legacy controls or Legacy conversion drafts must not be executed. The approved pilot hard-cutover program is `2026-07-20-vioo-pilot-hard-cutover-program.md`. Registry and backend-enforcement findings in this document remain useful inventory only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single admin workbench where an administrator grants, revokes, previews, and explains application/module/action/scope permissions without needing to understand Direct Grant, Business Role, Legacy, or App Access internals.

**Architecture:** Keep the backend permission model layered, but collapse the admin workflow into one UI. Extend the existing permission registry/view-model/workspace, use Asset permissions as the enforced reference, and keep legacy as visible/revocable/convertible compatibility data rather than a primary grant path.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Supabase/Postgres migrations, existing permission modules under `lib/permissions`, existing settings workspace under `components/permissions`.

## Global Constraints

- Work only on branch `refactor/module-du-an-v1`.
- Do not create a second permission admin page; improve `components/permissions/DirectUserPermissionWorkspace.tsx`.
- Do not reintroduce archived migrations into `supabase/migrations`; active migrations must remain baseline-style after `20260720095234`.
- Do not run Supabase Cloud schema or migration-history changes without explicit approval.
- Do not create new legacy grants from the new UI.
- `view` is mandatory gateway: selecting any non-view action selects `view`; removing `view` is blocked while sibling actions remain.
- App Admin is not all-data access. Represent it with explicit app/module admin actions.
- Frontend can hide controls, but every real action must have backend or service-layer enforcement before it is marked `enforced`.
- Use TDD: each task starts with failing tests and ends with passing targeted tests.

---

## File Structure

- Modify `lib/permissions/permissionTypes.ts` to add registry metadata for app access and app admin grouping if not already present.
- Modify `lib/permissions/erpPermissionRegistry.ts` to add explicit admin/config actions where the app currently relies on vague `manage` or legacy.
- Modify `lib/permissions/unifiedPermissionViewModel.ts` to produce the current permission overview, app/module editor view state, app access derivation, and legacy conversion drafts.
- Modify `components/permissions/DirectUserPermissionWorkspace.tsx` to show current permissions, grant editor, source explanations, and legacy conversion controls.
- Modify `components/permissions/UnifiedPermissionMatrix.tsx` to make `view` gateway behavior and readiness labels clear.
- Add/modify tests under `lib/__tests__` for view gateway, current permission overview, source revocation, legacy conversion, app access derivation, and route/action enforcement.
- Add Supabase migrations only after inventory confirms the backend tables/functions/policies needed for a specific app. Use Asset `20260720100000_asset_action_operation_guards.sql` as the reference style.

---

### Task 1: Define App Access and App Admin Semantics in the Registry

**Files:**
- Modify: `lib/permissions/permissionTypes.ts`
- Modify: `lib/permissions/erpPermissionRegistry.ts`
- Test: `lib/__tests__/applicationPermissionRegistryContract.test.ts`

**Interfaces:**
- Consumes: existing `PermissionApplicationDefinition`, `PermissionModuleDefinition`, `PermissionActionDefinition`.
- Produces:
  - `PermissionActionDefinition.permissionGroup?: 'access' | 'action' | 'admin'`
  - registry actions whose admin/config permissions are explicit, not hidden behind legacy.

- [ ] **Step 1: Write failing registry contract tests**

Create `lib/__tests__/applicationPermissionRegistryContract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  getAllPermissionActions,
  getPermissionApplications,
  getPermissionModules,
} from '../permissions/permissionRegistry';

describe('application permission registry contract', () => {
  it('has one view gateway action for every module', () => {
    for (const module of getPermissionModules()) {
      const viewActions = module.actions.filter(action => action.action === 'view');
      expect(viewActions, module.code).toHaveLength(1);
      expect(viewActions[0].permissionCode).toBe(`${module.code}.view`);
      expect(viewActions[0].permissionGroup).toBe('access');
    }
  });

  it('labels non-view ordinary actions as action group', () => {
    const ordinaryActions = getAllPermissionActions()
      .filter(action => action.action !== 'view' && action.action !== 'manage' && !action.permissionCode.includes('.settings.'));

    expect(ordinaryActions.length).toBeGreaterThan(20);
    for (const action of ordinaryActions) {
      expect(action.permissionGroup, action.permissionCode).toBe('action');
    }
  });

  it('labels app administration permissions explicitly', () => {
    const adminActions = getAllPermissionActions()
      .filter(action => action.action === 'manage' || action.permissionCode.includes('.settings.'));

    expect(adminActions.map(action => action.permissionCode)).toEqual(expect.arrayContaining([
      'hrm.master_data.manage',
      'asset.catalog.manage',
      'asset.maintenance.manage',
    ]));

    for (const action of adminActions) {
      expect(action.permissionGroup, action.permissionCode).toBe('admin');
    }
  });

  it('keeps application list stable and complete for the workbench', () => {
    expect(getPermissionApplications().map(app => app.code)).toEqual(expect.arrayContaining([
      'wms',
      'hrm',
      'workflow',
      'request',
      'asset',
      'contract',
      'ai',
      'storage',
      'kb',
      'analytics',
    ]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- lib/__tests__/applicationPermissionRegistryContract.test.ts
```

Expected: FAIL because `permissionGroup` does not exist yet.

- [ ] **Step 3: Add `permissionGroup` type**

Modify `lib/permissions/permissionTypes.ts`:

```ts
export type PermissionActionGroup = 'access' | 'action' | 'admin';

export interface PermissionActionDefinition {
  action: string;
  label: string;
  permissionCode: string;
  riskLevel?: PermissionRiskLevel;
  riskReason?: string;
  isBusinessAction?: boolean;
  isBusinessApproval?: boolean;
  directGrantRequiresExpiry?: boolean;
  legacyModuleKey?: string;
  legacyRoute?: string;
  legacyAdminOnly?: boolean;
  scopeTypes?: readonly PermissionScopeType[];
  permissionGroup?: PermissionActionGroup;
  sortOrder?: number;
}
```

If the interface already exists with more fields, add only `permissionGroup?: PermissionActionGroup` and the exported type.

- [ ] **Step 4: Populate registry groups**

Modify the `actions` helper in `lib/permissions/erpPermissionRegistry.ts`:

```ts
const resolvePermissionGroup = (action: string): 'access' | 'action' | 'admin' => {
  if (action === 'view') return 'access';
  if (action === 'manage' || action === 'settings_manage') return 'admin';
  return 'action';
};

const actions = (
  prefix: string,
  legacyModuleKey: string,
  legacyRoute: string | undefined,
  scopeTypes: readonly PermissionScopeType[],
  entries: readonly ActionTuple[],
): readonly PermissionActionDefinition[] =>
  entries.map(([action, label, sortOrder, actionScopes, riskMetadata]) => ({
    action,
    label,
    permissionCode: `${prefix}.${action}`,
    ...resolvePermissionRiskMetadata(prefix, action, riskMetadata),
    legacyModuleKey,
    legacyRoute,
    legacyAdminOnly: !action.startsWith('view') && action !== 'use',
    permissionGroup: resolvePermissionGroup(action),
    scopeTypes: actionScopes || scopeTypes,
    sortOrder,
  }));
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm test -- lib/__tests__/applicationPermissionRegistryContract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/permissions/permissionTypes.ts lib/permissions/erpPermissionRegistry.ts lib/__tests__/applicationPermissionRegistryContract.test.ts
git commit -m "feat: label permission registry groups"
```

---

### Task 2: Build App Access Derivation and Current Permission Summary

**Files:**
- Modify: `lib/permissions/unifiedPermissionViewModel.ts`
- Test: `lib/__tests__/applicationPermissionOverview.test.ts`

**Interfaces:**
- Consumes:
  - `CurrentPermissionOverviewRow`
  - `buildCurrentPermissionOverview(input)`
- Produces:
  - `ApplicationAccessOverviewRow`
  - `buildApplicationAccessOverview(input)`
  - `getDirectGrantRevokeDraft(input)`

- [ ] **Step 1: Write failing tests for app access derivation**

Create `lib/__tests__/applicationPermissionOverview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import {
  buildApplicationAccessOverview,
  buildCurrentPermissionOverview,
  getDirectGrantRevokeDraft,
} from '../permissions/unifiedPermissionViewModel';

const directSource = (permissionCode: string, scopeType = 'global', scopeId = '*'): EffectivePermissionSource => ({
  permissionCode,
  scopeType,
  scopeId,
  sourceType: 'DIRECT',
  sourceId: `direct:${permissionCode}`,
  sourceCode: permissionCode,
  sourceLabel: 'Direct grant',
});

describe('application permission overview', () => {
  it('derives app access from effective view permissions', () => {
    const rows = buildApplicationAccessOverview({
      effectiveSources: [
        directSource('asset.catalog.view'),
        directSource('asset.assignment.assign'),
        directSource('hrm.employee.view', 'department', 'dept-1'),
      ],
    });

    expect(rows.find(row => row.applicationCode === 'asset')).toMatchObject({
      applicationLabel: 'Tài sản',
      hasAccess: true,
      viewPermissionCount: 1,
      actionPermissionCount: 1,
    });
    expect(rows.find(row => row.applicationCode === 'hrm')).toMatchObject({
      hasAccess: true,
      viewPermissionCount: 1,
    });
    expect(rows.find(row => row.applicationCode === 'workflow')?.hasAccess).toBe(false);
  });

  it('summarizes source labels and revocation availability by permission row', () => {
    const rows = buildCurrentPermissionOverview({
      directGrants: [{
        userId: 'user-1',
        permissionCode: 'asset.catalog.view',
        scopeType: 'global',
        scopeId: '*',
      }],
      effectiveSources: [
        directSource('asset.catalog.view'),
        {
          ...directSource('asset.catalog.create'),
          sourceType: 'ROLE',
          sourceId: 'role-1',
          sourceCode: 'ASSET_OPERATOR',
          sourceLabel: 'Asset Operator',
        },
      ],
    });

    expect(rows.map(row => row.permissionCode)).toEqual([
      'asset.catalog.view',
      'asset.catalog.create',
    ]);
    expect(rows[0]).toMatchObject({
      sourceTypes: ['DIRECT'],
      canRevokeDirect: true,
    });
    expect(rows[1]).toMatchObject({
      sourceTypes: ['ROLE'],
      canRevokeDirect: false,
    });
  });

  it('removes only the selected direct grant scope when revoking inline', () => {
    const grants: UserPermissionGrant[] = [
      { userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'global', scopeId: '*' },
      { userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'warehouse', scopeId: 'wh-1' },
      { userId: 'user-1', permissionCode: 'asset.catalog.create', scopeType: 'global', scopeId: '*' },
    ];

    expect(getDirectGrantRevokeDraft({
      grants,
      targetUserId: 'user-1',
      permissionCode: 'asset.catalog.view',
      scopeType: 'global',
      scopeId: '*',
    })).toEqual([
      { userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'warehouse', scopeId: 'wh-1' },
      { userId: 'user-1', permissionCode: 'asset.catalog.create', scopeType: 'global', scopeId: '*' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- lib/__tests__/applicationPermissionOverview.test.ts
```

Expected: FAIL because `buildApplicationAccessOverview` and `getDirectGrantRevokeDraft` do not exist.

- [ ] **Step 3: Add overview interfaces and functions**

Append to `lib/permissions/unifiedPermissionViewModel.ts`:

```ts
export interface ApplicationAccessOverviewRow {
  applicationCode: string;
  applicationLabel: string;
  hasAccess: boolean;
  viewPermissionCount: number;
  actionPermissionCount: number;
  adminPermissionCount: number;
  sourceTypes: EffectivePermissionSourceType[];
}

const uniqueSourceTypes = (sources: readonly EffectivePermissionSource[]): EffectivePermissionSourceType[] =>
  [...new Set(sources.map(source => source.sourceType))]
    .sort((left, right) => SOURCE_TYPE_ORDER[left] - SOURCE_TYPE_ORDER[right]);

export const buildApplicationAccessOverview = (input: {
  effectiveSources: readonly EffectivePermissionSource[];
}): ApplicationAccessOverviewRow[] => getPermissionApplications()
  .map(application => {
    const modules = application.modules || [];
    const actionCodes = new Set(modules.flatMap(module => module.actions.map(action => action.permissionCode)));
    const actionsByCode = new Map(modules.flatMap(module => module.actions.map(action => [action.permissionCode, action] as const)));
    const sources = input.effectiveSources.filter(source => actionCodes.has(source.permissionCode));
    const viewSources = sources.filter(source => actionsByCode.get(source.permissionCode)?.action === 'view');
    const adminSources = sources.filter(source => actionsByCode.get(source.permissionCode)?.permissionGroup === 'admin');
    const actionSources = sources.filter(source => {
      const action = actionsByCode.get(source.permissionCode);
      return action && action.action !== 'view' && action.permissionGroup !== 'admin';
    });

    return {
      applicationCode: application.code,
      applicationLabel: application.label,
      hasAccess: viewSources.length > 0,
      viewPermissionCount: viewSources.length,
      actionPermissionCount: actionSources.length,
      adminPermissionCount: adminSources.length,
      sourceTypes: uniqueSourceTypes(sources),
    };
  });

export const getDirectGrantRevokeDraft = (input: {
  grants: readonly UserPermissionGrant[];
  targetUserId: string;
  permissionCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
}): UserPermissionGrant[] => input.grants.filter(grant => !(
  grant.userId === input.targetUserId
  && grant.permissionCode === input.permissionCode
  && grant.scopeType === input.scopeType
  && grant.scopeId === input.scopeId
));
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
npm test -- lib/__tests__/applicationPermissionOverview.test.ts lib/__tests__/unifiedPermissionViewModel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/permissions/unifiedPermissionViewModel.ts lib/__tests__/applicationPermissionOverview.test.ts
git commit -m "feat: summarize application permission access"
```

---

### Task 3: Add Legacy Conversion Drafts

**Files:**
- Modify: `lib/permissions/unifiedPermissionViewModel.ts`
- Test: `lib/__tests__/legacyPermissionConversion.test.ts`

**Interfaces:**
- Consumes:
  - `LegacyPermissionState`
  - `PermissionScope`
  - `UserPermissionGrant`
- Produces:
  - `LegacyConversionCandidate`
  - `buildLegacyConversionCandidates(input)`
  - `applyLegacyConversionDraft(input)`

- [ ] **Step 1: Write failing legacy conversion tests**

Create `lib/__tests__/legacyPermissionConversion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import type { LegacyPermissionState } from '../permissions/permissionTypes';
import {
  applyLegacyConversionDraft,
  buildLegacyConversionCandidates,
} from '../permissions/unifiedPermissionViewModel';

const emptyLegacy: LegacyPermissionState = {
  allowedModules: [],
  allowedSubModules: {},
  adminModules: [],
  adminSubModules: {},
};

describe('legacy permission conversion', () => {
  it('maps legacy module access to view permissions only', () => {
    const candidates = buildLegacyConversionCandidates({
      legacyState: {
        ...emptyLegacy,
        allowedModules: ['TS'],
      },
      scope: { scopeType: 'global', scopeId: '*' },
    });

    const asset = candidates.find(candidate => candidate.legacyModuleKey === 'TS');
    expect(asset?.permissionCodes).toEqual(expect.arrayContaining([
      'asset.catalog.view',
      'asset.assignment.view',
      'asset.maintenance.view',
      'asset.audit.view',
    ]));
    expect(asset?.permissionCodes.some(code => code !== 'asset.catalog.view' && code.endsWith('.create'))).toBe(false);
  });

  it('maps legacy admin access only to admin-compatible permissions', () => {
    const candidates = buildLegacyConversionCandidates({
      legacyState: {
        ...emptyLegacy,
        adminModules: ['TS'],
      },
      scope: { scopeType: 'global', scopeId: '*' },
    });

    const asset = candidates.find(candidate => candidate.legacyModuleKey === 'TS');
    expect(asset?.permissionCodes).toEqual(expect.arrayContaining([
      'asset.catalog.manage',
      'asset.maintenance.manage',
    ]));
    expect(asset?.permissionCodes).not.toContain('asset.catalog.delete');
    expect(asset?.permissionCodes).not.toContain('asset.audit.perform');
  });

  it('creates direct grants and removes converted legacy module key', () => {
    const grants: UserPermissionGrant[] = [];
    const result = applyLegacyConversionDraft({
      targetUserId: 'user-1',
      grants,
      legacyState: {
        ...emptyLegacy,
        allowedModules: ['TS'],
      },
      conversion: {
        legacyModuleKey: 'TS',
        label: 'Tài sản',
        sourceKind: 'allowedModule',
        scopeType: 'global',
        scopeId: '*',
        permissionCodes: ['asset.catalog.view', 'asset.assignment.view'],
      },
    });

    expect(result.grants).toEqual([
      { userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'global', scopeId: '*' },
      { userId: 'user-1', permissionCode: 'asset.assignment.view', scopeType: 'global', scopeId: '*' },
    ]);
    expect(result.legacyState.allowedModules).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- lib/__tests__/legacyPermissionConversion.test.ts
```

Expected: FAIL because conversion functions do not exist.

- [ ] **Step 3: Add conversion interfaces and candidate builder**

Append to `lib/permissions/unifiedPermissionViewModel.ts`:

```ts
export type LegacyConversionSourceKind = 'allowedModule' | 'adminModule';

export interface LegacyConversionCandidate {
  legacyModuleKey: string;
  label: string;
  sourceKind: LegacyConversionSourceKind;
  scopeType: PermissionScopeType;
  scopeId: string;
  permissionCodes: string[];
}

const actionsForLegacyConversion = (
  legacyModuleKey: string,
  sourceKind: LegacyConversionSourceKind,
): string[] => getPermissionModulesByLegacyKey(legacyModuleKey)
  .flatMap(module => module.actions)
  .filter(action => {
    if (sourceKind === 'allowedModule') return action.action === 'view';
    return action.permissionGroup === 'admin' || action.action === 'manage';
  })
  .filter(action => canAddDirectGrant(action))
  .map(action => action.permissionCode);

export const buildLegacyConversionCandidates = (input: {
  legacyState: LegacyPermissionState;
  scope: PermissionScope;
}): LegacyConversionCandidate[] => {
  const scope = normalizeScope(input.scope);
  const catalogByKey = new Map(buildLegacyPermissionCatalog().map(entry => [entry.legacyModuleKey, entry]));
  const candidates: LegacyConversionCandidate[] = [];

  for (const legacyModuleKey of input.legacyState.allowedModules) {
    candidates.push({
      legacyModuleKey,
      label: catalogByKey.get(legacyModuleKey)?.label || legacyModuleKey,
      sourceKind: 'allowedModule',
      scopeType: scope.scopeType as PermissionScopeType,
      scopeId: scope.scopeId,
      permissionCodes: actionsForLegacyConversion(legacyModuleKey, 'allowedModule'),
    });
  }

  for (const legacyModuleKey of input.legacyState.adminModules) {
    candidates.push({
      legacyModuleKey,
      label: catalogByKey.get(legacyModuleKey)?.label || legacyModuleKey,
      sourceKind: 'adminModule',
      scopeType: scope.scopeType as PermissionScopeType,
      scopeId: scope.scopeId,
      permissionCodes: actionsForLegacyConversion(legacyModuleKey, 'adminModule'),
    });
  }

  return candidates.filter(candidate => candidate.permissionCodes.length > 0);
};
```

- [ ] **Step 4: Add conversion draft applier**

Append to the same file:

```ts
export const applyLegacyConversionDraft = (input: {
  targetUserId: string;
  grants: readonly UserPermissionGrant[];
  legacyState: LegacyPermissionState;
  conversion: LegacyConversionCandidate;
}): { grants: UserPermissionGrant[]; legacyState: LegacyPermissionState } => {
  const nextGrants = [...input.grants];
  for (const permissionCode of input.conversion.permissionCodes) {
    const exists = nextGrants.some(grant =>
      grant.userId === input.targetUserId
      && grant.permissionCode === permissionCode
      && grant.scopeType === input.conversion.scopeType
      && grant.scopeId === input.conversion.scopeId
      && grant.isActive !== false
    );
    if (!exists) {
      nextGrants.push({
        userId: input.targetUserId,
        permissionCode,
        scopeType: input.conversion.scopeType,
        scopeId: input.conversion.scopeId,
      });
    }
  }

  const nextLegacyState = cloneLegacyState(input.legacyState);
  if (input.conversion.sourceKind === 'allowedModule') {
    nextLegacyState.allowedModules = nextLegacyState.allowedModules
      .filter(key => key !== input.conversion.legacyModuleKey);
  } else {
    nextLegacyState.adminModules = nextLegacyState.adminModules
      .filter(key => key !== input.conversion.legacyModuleKey);
  }

  return { grants: nextGrants, legacyState: nextLegacyState };
};
```

- [ ] **Step 5: Export registry helper if needed**

If TypeScript cannot find `getPermissionModulesByLegacyKey`, add it to the import list in `lib/permissions/unifiedPermissionViewModel.ts`:

```ts
import { getPermissionApplications, getPermissionModules, getPermissionModulesByLegacyKey } from './permissionRegistry';
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
npm test -- lib/__tests__/legacyPermissionConversion.test.ts lib/__tests__/unifiedPermissionViewModel.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/permissions/unifiedPermissionViewModel.ts lib/__tests__/legacyPermissionConversion.test.ts
git commit -m "feat: draft legacy permission conversion"
```

---

### Task 4: Upgrade the Workbench UI Around Current Permissions and Grant Editor

**Files:**
- Modify: `components/permissions/DirectUserPermissionWorkspace.tsx`
- Modify: `components/permissions/UnifiedPermissionMatrix.tsx`
- Test: `lib/__tests__/applicationPermissionWorkbenchUiContract.test.tsx`

**Interfaces:**
- Consumes:
  - `buildApplicationAccessOverview(input)`
  - `buildCurrentPermissionOverview(input)`
  - `getDirectGrantRevokeDraft(input)`
  - `applyLegacyConversionDraft(input)`
- Produces:
  - A single UI where admins can inspect current permissions, navigate to the right app/module, revoke Direct Grants, and convert legacy.

- [ ] **Step 1: Write failing UI contract tests**

Create `lib/__tests__/applicationPermissionWorkbenchUiContract.test.tsx`:

```tsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthorizationPrincipal, EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import DirectUserPermissionWorkspace from '../../components/permissions/DirectUserPermissionWorkspace';

const principal: AuthorizationPrincipal = {
  userId: 'user-1',
  displayName: 'Hà Thị Hải Hồng',
  email: 'honghh@tienthinhjsc.vn',
  accountStatus: 'ACTIVE',
  legacyState: {
    allowedModules: ['TS'],
    adminModules: [],
    allowedSubModules: {},
    adminSubModules: {},
  },
};

const directSource = (permissionCode: string): EffectivePermissionSource => ({
  permissionCode,
  scopeType: 'global',
  scopeId: '*',
  sourceType: 'DIRECT',
  sourceId: `direct:${permissionCode}`,
  sourceCode: permissionCode,
  sourceLabel: 'Direct grant',
});

describe('application permission workbench UI contract', () => {
  it('renders current permission source and revoke/convert affordances', () => {
    const html = renderToStaticMarkup(
      <DirectUserPermissionWorkspace
        principal={principal}
        grants={[{ userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'global', scopeId: '*' }]}
        effectiveSources={[
          directSource('asset.catalog.view'),
          { ...directSource('asset.assignment.view'), sourceType: 'LEGACY', sourceId: 'TS', sourceCode: 'TS', sourceLabel: 'Legacy TS' },
        ]}
        principals={[principal]}
        currentUserId="admin-1"
        disabled={false}
        clipboard={null}
        onClipboardChange={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
      />
    );

    expect(html).toContain('Quyền hiện có');
    expect(html).toContain('asset.catalog.view');
    expect(html).toContain('Direct');
    expect(html).toContain('Thu hồi');
    expect(html).toContain('Legacy');
    expect(html).toContain('Chuyển sang quyền mới');
  });

  it('labels the editor as app module action scope workflow', () => {
    const html = renderToStaticMarkup(
      <DirectUserPermissionWorkspace
        principal={principal}
        grants={[]}
        effectiveSources={[]}
        principals={[principal]}
        currentUserId="admin-1"
        disabled={false}
        clipboard={null}
        onClipboardChange={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
      />
    );

    expect(html).toContain('Ứng dụng');
    expect(html).toContain('Module');
    expect(html).toContain('Phạm vi');
    expect(html).toContain('Preview backend');
    expect(html).toContain('Lưu phân quyền');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- lib/__tests__/applicationPermissionWorkbenchUiContract.test.tsx
```

Expected: FAIL because current UI does not include the new labels/actions.

- [ ] **Step 3: Add current permission section**

In `components/permissions/DirectUserPermissionWorkspace.tsx`, render a section above the grant editor:

```tsx
<section className="rounded-lg border border-slate-200 bg-white">
  <div className="border-b border-slate-200 px-4 py-3">
    <h3 className="text-base font-bold text-slate-900">Quyền hiện có</h3>
  </div>
  <div className="divide-y divide-slate-100">
    {currentPermissionOverview.length === 0 ? (
      <div className="px-4 py-4 text-sm font-semibold text-slate-500">Chưa có quyền hiệu lực</div>
    ) : currentPermissionOverview.map(row => (
      <button
        key={row.key}
        type="button"
        onClick={() => handleOpenPermissionLocation(row)}
        className="grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <span>
          <span className="block text-sm font-bold text-slate-900">
            {row.applicationLabel} / {row.moduleLabel} / {row.actionLabel}
          </span>
          <span className="block text-xs font-semibold text-slate-500">
            {row.permissionCode} · {row.scopeType}/{row.scopeId}
          </span>
          <span className="mt-1 block text-xs font-bold text-slate-500">
            {row.sourceLabels.join(', ')}
          </span>
        </span>
        {row.canRevokeDirect && (
          <span className="rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-600">
            Thu hồi
          </span>
        )}
      </button>
    ))}
  </div>
</section>
```

When wiring the revoke action, do not put the revoke button inside the row button. Use a separate `button` with `event.stopPropagation()` or convert the row to a non-button container.

- [ ] **Step 4: Add direct revoke handler**

In the same component:

```tsx
const handleRevokeDirectGrant = (row: CurrentPermissionOverviewRow) => {
  updateDrafts(getDirectGrantRevokeDraft({
    grants: drafts,
    targetUserId: principal.userId,
    permissionCode: row.permissionCode,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
  }));
};
```

Import `getDirectGrantRevokeDraft` from `unifiedPermissionViewModel`.

- [ ] **Step 5: Add legacy conversion panel**

Use `buildLegacyConversionCandidates` and `applyLegacyConversionDraft` to show one conversion row per legacy source. The button text must be exactly `Chuyển sang quyền mới`.

```tsx
const legacyConversionCandidates = useMemo(
  () => buildLegacyConversionCandidates({ legacyState: legacyDraft, scope }),
  [legacyDraft, scope],
);

const handleConvertLegacy = (conversion: LegacyConversionCandidate) => {
  const result = applyLegacyConversionDraft({
    targetUserId: principal.userId,
    grants: drafts,
    legacyState: legacyDraft,
    conversion,
  });
  updateDrafts(result.grants);
  updateLegacyDraft(result.legacyState);
};
```

- [ ] **Step 6: Run UI contract and existing matrix tests**

Run:

```bash
npm test -- lib/__tests__/applicationPermissionWorkbenchUiContract.test.tsx lib/__tests__/unifiedPermissionMatrix.test.tsx lib/__tests__/unifiedPermissionViewModel.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/permissions/DirectUserPermissionWorkspace.tsx components/permissions/UnifiedPermissionMatrix.tsx lib/__tests__/applicationPermissionWorkbenchUiContract.test.tsx
git commit -m "feat: clarify application permission workbench"
```

---

### Task 5: Enforce HRM Gateway Checks at Route and Handler Level

**Files:**
- Modify: `pages/hrm` or current HRM page files under `pages/`
- Modify: `lib/permissions/permissionService.ts`
- Test: `lib/__tests__/hrmPermissionGateway.test.ts`

**Interfaces:**
- Consumes:
  - `canViewRoute(user, route, scope?)`
  - `canPerform(user, permissionCode, scope?)`
- Produces:
  - HRM pages use `hrm.*.view` for route/menu visibility.
  - HRM create/edit controls use `hrm.*.create` or `hrm.*.edit`.

- [ ] **Step 1: Inventory HRM page paths**

Run:

```bash
rg -n "hrm|HRM|canViewRoute|canPerform|create|edit" pages components lib | head -200
```

Expected: identify the concrete HRM files for employees, attendance, leave, payroll, master data, and reports.

- [ ] **Step 2: Write route and action tests**

Create `lib/__tests__/hrmPermissionGateway.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Role, type User, type UserPermissionGrant } from '../../types';
import { canPerform, canViewRoute } from '../permissions/permissionService';

const userWith = (permissionCodes: string[], scopeType: UserPermissionGrant['scopeType'] = 'global'): User => ({
  id: 'user-1',
  name: 'Member',
  email: 'member@example.com',
  role: Role.EMPLOYEE,
  allowedModules: [],
  adminModules: [],
  allowedSubModules: {},
  adminSubModules: {},
  permissionGrants: permissionCodes.map(permissionCode => ({
    userId: 'user-1',
    permissionCode,
    scopeType,
    scopeId: scopeType === 'global' ? '*' : 'dept-1',
  })),
});

describe('HRM permission gateway', () => {
  it('requires HRM employee view to open employee routes', () => {
    expect(canViewRoute(userWith([]), '/hrm/employees')).toBe(false);
    expect(canViewRoute(userWith(['hrm.employee.view']), '/hrm/employees')).toBe(true);
  });

  it('requires create and edit actions for employee mutations', () => {
    expect(canPerform(userWith(['hrm.employee.view']), 'hrm.employee.create')).toBe(false);
    expect(canPerform(userWith(['hrm.employee.view', 'hrm.employee.create']), 'hrm.employee.create')).toBe(true);
    expect(canPerform(userWith(['hrm.employee.view']), 'hrm.employee.edit')).toBe(false);
    expect(canPerform(userWith(['hrm.employee.view', 'hrm.employee.edit']), 'hrm.employee.edit')).toBe(true);
  });

  it('respects department scope for HRM actions', () => {
    const actor = userWith(['hrm.employee.view', 'hrm.employee.edit'], 'department');
    expect(canPerform(actor, 'hrm.employee.edit', { scopeType: 'department', scopeId: 'dept-1' })).toBe(true);
    expect(canPerform(actor, 'hrm.employee.edit', { scopeType: 'department', scopeId: 'dept-2' })).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

Run:

```bash
npm test -- lib/__tests__/hrmPermissionGateway.test.ts
```

Expected: PASS if service already supports this, FAIL if route/action mapping has gaps.

- [ ] **Step 4: Patch HRM UI controls**

For each HRM page identified in Step 1:

```tsx
const canCreateEmployee = canPerform(currentUser, 'hrm.employee.create', employeeScope);
const canEditEmployee = canPerform(currentUser, 'hrm.employee.edit', employeeScope);
```

Then hide or disable create/edit controls:

```tsx
{canCreateEmployee && (
  <button type="button" onClick={handleCreateEmployee}>
    Tạo nhân viên
  </button>
)}
```

Use the real page's existing button component and styling; do not introduce a new design system.

- [ ] **Step 5: Run targeted HRM and permission tests**

Run:

```bash
npm test -- lib/__tests__/hrmPermissionGateway.test.ts lib/__tests__/routeAccess.test.ts lib/__tests__/permissionService.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pages lib/__tests__/hrmPermissionGateway.test.ts lib/permissions/permissionService.ts
git commit -m "feat: gate hrm routes and actions by permissions"
```

---

### Task 6: Backend Inventory Before HRM or Other App Enforcement

**Files:**
- Create: `docs/superpowers/plans/artifacts/application-permission-backend-inventory.md`
- No schema migration in this task.

**Interfaces:**
- Consumes: Supabase linked project read-only metadata.
- Produces: inventory document listing tables, columns, functions, policies, and action candidates for the next backend-enforced app.

- [x] **Step 1: Create inventory document skeleton**

Create `docs/superpowers/plans/artifacts/application-permission-backend-inventory.md`:

```md
# Application Permission Backend Inventory

## Scope

This inventory records the backend objects needed before promoting another application's permissions from `declared` to `enforced`.

## HRM Candidate Actions

- `hrm.employee.view`
- `hrm.employee.create`
- `hrm.employee.edit`
- `hrm.attendance.view`
- `hrm.attendance.edit`
- `hrm.leave.view`
- `hrm.leave.approve`
- `hrm.payroll.view`
- `hrm.payroll.manage`
- `hrm.master_data.view`
- `hrm.master_data.manage`

## Tables

| Table | Existing RLS | Current policies | Required action checks | Notes |
| --- | --- | --- | --- | --- |

## Functions / RPC

| Function | Current execute grants | Required permission | Notes |
| --- | --- | --- | --- |

## UI Mutation Flows

| Flow | UI file | Backend operation | Required permission | Scope source |
| --- | --- | --- | --- | --- |

## Enforcement Gaps

| Gap | Risk | Proposed fix |
| --- | --- | --- |
```

- [x] **Step 2: Collect table metadata without mutating Cloud**

Run read-only commands:

```bash
supabase db query --linked --agent=no -c "select table_schema, table_name from information_schema.tables where table_schema = 'public' and (table_name like 'hrm_%' or table_name in ('employees','users')) order by 1, 2;"
supabase db query --linked --agent=no -c "select schemaname, tablename, policyname, cmd from pg_policies where schemaname = 'public' and (tablename like 'hrm_%' or tablename in ('employees','users')) order by tablename, policyname;"
supabase db query --linked --agent=no -c "select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app_private') and p.proname ilike '%hrm%' order by 1, 2, 3;"
```

Expected: output only metadata. Do not run `db push`, `migration repair`, or any write statement.

Implementation note: local Supabase CLI `2.95.6` uses positional SQL for `supabase db query`; the actual read-only commands used `npx supabase db query --linked --agent=no --output csv "<sql>"`.

- [x] **Step 3: Fill inventory document**

Paste summarized metadata into the markdown tables. For every HRM mutation flow, include the file path and the exact permission code to enforce.

- [x] **Step 4: Commit inventory only**

```bash
git add docs/superpowers/plans/artifacts/application-permission-backend-inventory.md
git commit -m "docs: inventory application permission backend gaps"
```

---

### Task 7: Add Backend Enforcement Migration for One HRM Slice

**Files:**
- Create: `supabase/migrations/<timestamp>_hrm_employee_permission_guards.sql`
- Create: `supabase/tests/hrm_employee_permission_guards_smoke.sql`
- Modify: `lib/permissions/permissionReadiness.ts`
- Test: `lib/__tests__/hrmEmployeeBackendMigrationContract.test.ts`

**Interfaces:**
- Consumes: inventory from Task 6.
- Produces:
  - backend guard functions/policies for `hrm.employee.view/create/edit`
  - readiness promotion only for backend-enforced HRM employee actions

- [x] **Step 1: Write migration contract test**

Create `lib/__tests__/hrmEmployeeBackendMigrationContract.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name.endsWith('_hrm_employee_permission_guards.sql'));

const readMigration = () => {
  expect(candidates).toHaveLength(1);
  return fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');
};

const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('HRM employee backend permission guards', () => {
  it('creates operation-specific permission helper for HRM employee records', () => {
    const sql = normalized(readMigration());
    expect(sql).toMatch(/create or replace function app_private\.hrm_employee_has_action/i);
    expect(sql).toContain("'hrm.employee.view'");
    expect(sql).toContain("'hrm.employee.create'");
    expect(sql).toContain("'hrm.employee.edit'");
  });

  it('does not use broad FOR ALL policy for mutations', () => {
    const sql = normalized(readMigration());
    expect(sql).not.toMatch(/for all to authenticated/i);
    expect(sql).toMatch(/for select/i);
    expect(sql).toMatch(/for insert/i);
    expect(sql).toMatch(/for update/i);
  });

  it('promotes only HRM employee actions to enforced readiness', () => {
    const sql = readMigration();
    for (const code of ['hrm.employee.view', 'hrm.employee.create', 'hrm.employee.edit']) {
      expect(sql).toContain(`'${code}'`);
    }
    expect(sql).not.toContain("'hrm.payroll.manage'");
  });
});
```

- [x] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- lib/__tests__/hrmEmployeeBackendMigrationContract.test.ts
```

Expected: FAIL because migration does not exist.

- [x] **Step 3: Generate migration**

Run:

```bash
supabase migration new hrm_employee_permission_guards
```

Expected: creates `supabase/migrations/<timestamp>_hrm_employee_permission_guards.sql`.

Implementation note: `npx supabase migration new hrm_employee_permission_guards` created `20260720064623_hrm_employee_permission_guards.sql` using UTC, which sorted before the accepted baseline. The generated empty file was renamed to `20260720104623_hrm_employee_permission_guards.sql` so active migrations remain after `20260720095234` and `20260720100000`.

- [x] **Step 4: Confirm concrete HRM backend targets from inventory**

Before writing policy SQL, open `docs/superpowers/plans/artifacts/application-permission-backend-inventory.md` and copy the exact table, primary key, department/scope column, and current policy names for the HRM employee slice into the migration header comment. The comment must contain real object names from the inventory, not example names.

If the inventory does not identify those concrete objects, stop this task and finish Task 6 first. Do not write guessed HRM policy SQL.

- [x] **Step 5: Implement migration using Asset style**

The migration must follow the pattern in `supabase/migrations/20260720100000_asset_action_operation_guards.sql`:

```sql
create or replace function app_private.hrm_employee_has_action(
  p_permission_code text,
  p_department_id text default null,
  p_target_user_id uuid default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app_private.has_permission(
    public.current_app_user_id(),
    p_permission_code,
    case
      when p_department_id is not null then 'department'
      when p_target_user_id = public.current_app_user_id() then 'own'
      else 'global'
    end,
    coalesce(p_department_id, p_target_user_id::text, '*')
  );
end;
$$;
```

After the helper exists, add operation-specific policies for the confirmed HRM employee table:

- `for select` must check `hrm.employee.view`.
- `for insert` must check `hrm.employee.create`.
- `for update` must check `hrm.employee.edit`.
- Do not add `for all`.
- Do not let `edit` imply payroll, delete, approval, or master-data management.
- If the HRM employee table has a department column, evaluate department scope before global fallback.
- If the operation targets the current user's own profile, evaluate `own/<current-user-id>` before global fallback.

- [x] **Step 6: Add smoke test with rollback**

Create `supabase/tests/hrm_employee_permission_guards_smoke.sql`:

```sql
begin;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'hrm_employee_has_action'
  ) then
    raise exception 'hrm employee helper is not installed';
  end if;

  if not exists (
    select 1
    from public.permission_actions
    where code = 'hrm.employee.view'
  ) then
    raise exception 'hrm.employee.view is not registered';
  end if;

  if not exists (
    select 1
    from public.permission_actions
    where code = 'hrm.employee.create'
  ) then
    raise exception 'hrm.employee.create is not registered';
  end if;

  if not exists (
    select 1
    from public.permission_actions
    where code = 'hrm.employee.edit'
  ) then
    raise exception 'hrm.employee.edit is not registered';
  end if;
end $$;

rollback;
```

- [x] **Step 7: Promote readiness in frontend**

Modify `lib/permissions/permissionReadiness.ts`:

```ts
[
  'hrm.employee.view',
  'hrm.employee.create',
  'hrm.employee.edit',
].forEach(code => ENFORCED_PERMISSION_CODES.add(code));
```

- [x] **Step 8: Run local gates**

Run:

```bash
npm test -- lib/__tests__/hrmEmployeeBackendMigrationContract.test.ts lib/__tests__/permissionReadiness.test.ts
npm run lint
```

Expected: PASS.

- [x] **Step 9: Ask approval before Cloud change**

Stop and report:

- migration filename
- contract test output
- smoke test path
- exact SQL operations summary

Do not run `supabase db push --linked` until the user approves.

Post-approval evidence:

- User approved pushing linked migration `20260720104623_hrm_employee_permission_guards.sql`.
- Actual push applied only `20260720104623_hrm_employee_permission_guards.sql`.
- Push notices were limited to idempotent `drop policy if exists` skips for new action policy names that did not already exist.
- Rollback smoke test `supabase/tests/hrm_employee_permission_guards_smoke.sql` passed.
- Smoke fixture counts for `users`, `employees`, and `org_units` were `0` before and `0` after rollback.
- Final linked migration list shows `20260720095234`, `20260720100000`, and `20260720104623` on both Local and Remote.
- Post-push dry-run reports `Remote database is up to date`.
- Remote policy snapshot shows `employees_select_action`, `employees_insert_action`, and `employees_update_action` using `app_private.hrm_employee_has_action(...)`; `employees_delete` remains legacy until a separate delete action exists.

- [x] **Step 10: Commit local migration and tests after approval strategy is accepted**

```bash
git add supabase/migrations supabase/tests lib/permissions/permissionReadiness.ts lib/__tests__/hrmEmployeeBackendMigrationContract.test.ts
git commit -m "feat: enforce hrm employee permissions"
```

---

## Final Verification

After all approved tasks are complete, run:

```bash
git diff --check
npm run lint
npm test
npm run build
```

Expected:

- `git diff --check` has no whitespace errors.
- TypeScript passes.
- Vitest passes.
- Vite build passes. Existing chunk-size warnings are acceptable if no new build errors appear.

## Handoff Notes

- Asset permissions are the reference implementation. Do not weaken them while generalizing the workbench.
- The new workbench must make "effective but not directly revocable" obvious for Role and Legacy sources.
- Direct revocation is only for Direct Grant rows.
- Legacy conversion must preview and save through the same governed permission-change command as ordinary Direct Grant changes.
- Backend enforcement should advance app by app, starting with one thin slice such as HRM Employee before wider HRM payroll/attendance/leave enforcement.

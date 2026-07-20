# Asset Action Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Asset (`Tài sản`) permissions enforce real end-to-end operations: route/menu/view, UI control, handler, Supabase RPC/RLS, preview canary, and linked cloud verification all agree on the same action grant and scope.

**Architecture:** `view` is the mandatory gate for every Asset module route and menu item. Direct action grants depend on `view`; the admin UI auto-adds `view` when granting an action and prevents removing `view` while any action remains. Frontend capability helpers evaluate the actual target scope/record, while Supabase mutation RPCs enforce the same action codes and deny direct table writes that bypass operation guards.

**Tech Stack:** React + TypeScript + Vite, Vitest, React Testing Library where existing setup supports it, Supabase/Postgres migrations, current in-repo authorization registry/service.

## Global Constraints

- Work only in `/Users/admin/khotienthinh` on branch `refactor/module-du-an-v1`; confirm the branch before code edits.
- Do not create new git worktrees unless the user explicitly asks.
- Do not run `supabase db push`.
- Use `node_modules/.bin/supabase migration new <name>` for new migrations.
- Use `node_modules/.bin/supabase db query --linked --agent=no --file <file>` for linked database dry-run/apply checks.
- Do not mark a permission `verified` until route/menu, UI handler, backend operation, preview canary, and linked cloud smoke are all exercised.
- Direct action permissions must not imply route access by themselves. `view` is required for route/menu/SELECT.
- Legacy module/submodule grants map to `view` only.
- Legacy admin module/submodule grants map only to the action umbrella that legacy actually allowed for that route/module.
- No blanket `GLOBAL_SCOPE` capability for Asset actions. Each action must evaluate the requested record/target scope: warehouse, department, assigned user, or global when the grant is explicitly global.
- Do not enable RLS on an Asset table without inventorying existing columns, existing policies, read paths, write paths, RPCs, and side tables.
- Prefer operation RPCs for state transitions such as dispose, complete maintenance, transfer, assignment return, and audit save. Do not use broad RLS `FOR ALL` or broad `edit OR dispose` update policies for semantically different operations.
- Source-level `toContain` tests are allowed only as secondary contract tests. Each action needs success/deny tests at capability/handler/backend layers.

---

## Technical Review Response

1. `view` as mandatory gate: accepted. The previous plan's "mutating grant implies canView" rule is wrong for this system. The grant UI may auto-add `view`, but route/menu/SELECT must require the `view` permission itself.

2. Legacy mapping split: accepted with one nuance. The existing frontend service already distinguishes `allowedModules` from `adminModules`, and non-view actions are marked `legacyAdminOnly`. The plan must preserve that distinction and must not describe "legacy TS" as unlocking all actions. Only `adminModules/adminSubModules` can act as a legacy admin umbrella, and only for actions that the old route/module actually exposed.

3. No `GLOBAL_SCOPE` blanket: accepted. For list routes without a selected record, use `view` for route/menu. For record operations, pass the record or operation target into a helper that checks global OR matching warehouse OR matching department OR matching assigned user.

4. Inventory before migration: accepted. The first implementation task is now a database/UI inventory task that records tables, columns, enum/type values, RPCs, direct writes, and existing policies before writing migration SQL.

5. No broad RLS updates for semantic operations: accepted. Dispose, complete maintenance, assignment return/transfer, stock transfer, and audit perform must be operation-specific RPCs or guards. `audit.perform` must not get `FOR ALL` unless delete is explicitly part of the action, and it is not.

6. Side tables and transfer scope: accepted. Transfer must check both source and destination scope. RLS changes must include `asset_categories` and all side tables discovered by inventory, or leave tables locked behind RPCs with explicit read policies.

7. Route/menu/view enforcement: accepted. `canViewRoute` and `canViewModule` must stop treating any effective action as navigation access. They must require `*.view`.

8. Tests: accepted. Source text tests are only guardrails. Add capability tests, grant dependency tests, route/menu tests, handler tests, SQL/RPC tests, and browser canary.

9. Execution must not split frontend-only from backend: accepted. No frontend-only merge/deploy; complete Registry -> UI/Route -> Handler -> Backend -> Preview canary -> Cloud as one chain.

10. Branch confirmation: accepted. Verified current branch is `refactor/module-du-an-v1`.

---

## File Structure

### Registry And Permission Core

- Modify: `/Users/admin/khotienthinh/lib/permissions/erpPermissionRegistry.ts`
  - Defines Asset modules and explicit action codes.
- Modify: `/Users/admin/khotienthinh/lib/permissions/permissionService.ts`
  - Enforces view-only navigation for effective permission sources.
- Modify: `/Users/admin/khotienthinh/lib/permissions/unifiedPermissionViewModel.ts`
  - Keeps action -> view dependency and prevents removing view while action grants remain.
- Modify: `/Users/admin/khotienthinh/lib/permissions/permissionReadiness.ts`
  - Moves actions from `declared` to `enforced` or `verified` only after proof.

### Asset Capability Layer

- Create: `/Users/admin/khotienthinh/lib/permissions/assetPermissionCapabilities.ts`
  - Converts user + record/operation target to scoped Asset capabilities.
- Create: `/Users/admin/khotienthinh/lib/permissions/assetPermissionScope.ts`
  - Normalizes Asset records and operation targets into warehouse/department/assigned scopes.

### Asset UI And Handlers

- Modify: `/Users/admin/khotienthinh/components/Sidebar.tsx`
  - Asset submenus rely on `canAccessRoute`, which must require view.
- Modify: `/Users/admin/khotienthinh/lib/routeAccess.ts`
  - Route access remains centralized; tests lock view requirement.
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetCatalog.tsx`
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetProfile.tsx`
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetAssignment.tsx`
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetMaintenance.tsx`
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetAudit.tsx`
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetReports.tsx`
  - Each page gates visible actions and handler execution using scoped capabilities.

### Data Operations

- Modify: `/Users/admin/khotienthinh/context/AppContext.tsx`
  - Supabase-backed Asset mutations call guarded RPCs; local/offline state still updates only after permission checks in handlers.
- Create migration: generated by `node_modules/.bin/supabase migration new asset_action_operation_guards`
  - Adds operation-specific RPCs and RLS policies after inventory.

### Tests

- Modify: `/Users/admin/khotienthinh/lib/__tests__/manualPermissionCatalogContract.test.ts`
- Modify: `/Users/admin/khotienthinh/lib/__tests__/permissionService.test.ts`
- Modify: `/Users/admin/khotienthinh/lib/__tests__/unifiedPermissionViewModel.test.ts`
- Modify: `/Users/admin/khotienthinh/lib/__tests__/permissionReadiness.test.ts`
- Create: `/Users/admin/khotienthinh/lib/__tests__/assetPermissionCapabilities.test.ts`
- Create: `/Users/admin/khotienthinh/lib/__tests__/assetActionHandlerGuards.test.ts`
- Create: `/Users/admin/khotienthinh/lib/__tests__/assetActionBackendMigrationContract.test.ts`
- Create: `/Users/admin/khotienthinh/docs/superpowers/plans/artifacts/asset-action-inventory.md`

---

## Task 0: Confirm Branch And Inventory Current Asset Surface

**Files:**

- Create: `/Users/admin/khotienthinh/docs/superpowers/plans/artifacts/asset-action-inventory.md`

**Interfaces:**

- Produces: inventory table used by migration tasks.
- Consumes: current migrations, current TS pages, current Supabase linked schema.

- [ ] **Step 0.1: Confirm branch**

Run:

```bash
git branch --show-current
```

Expected:

```text
refactor/module-du-an-v1
```

- [ ] **Step 0.2: Inventory current frontend Asset handlers**

Run:

```bash
rg -n "const handle|function handle|async function|syncToSupabase|supabase\\.rpc|updateAsset|addAsset|removeAsset|transferAssetStock|addAssetAssignment|addAssetMaintenance|updateAssetMaintenance" pages/ts context/AppContext.tsx
```

Record each operation in `asset-action-inventory.md` using this exact table:

```markdown
| Operation | Page/handler | Context method | Supabase path today | Required permission | Required scope |
| --- | --- | --- | --- | --- | --- |
| Create asset | `AssetCatalog.handleSave` new asset | `addAssetWithInitialStock` | `rpc:create_asset_with_initial_stock` | `asset.catalog.create` | target warehouse/department |
| Edit asset | `AssetCatalog.handleSave` existing asset, `AssetProfile` edit | `updateAsset` | direct table write today | `asset.catalog.edit` | asset warehouse/department/assigned |
| Delete asset | `AssetCatalog.handleDelete` | `removeAsset` | direct table delete today | `asset.catalog.delete` | asset warehouse/department/assigned |
| Dispose asset | `AssetCatalog.handleDispose` | `updateAsset` today | direct table update today | `asset.catalog.dispose` | asset warehouse/department/assigned |
| Import create asset | `AssetCatalog.handleBulkImport` create mode | `addAssetWithInitialStock` | `rpc:create_asset_with_initial_stock` | `asset.catalog.import` + `asset.catalog.create` | target warehouse/department |
| Import update asset | `AssetCatalog.handleBulkImport` update mode | `updateAsset` | direct table write today | `asset.catalog.import` + `asset.catalog.edit` | asset warehouse/department/assigned |
| Transfer stock | `AssetCatalog` batch/detail transfer | `transferAssetStock` | `rpc:transfer_asset_stock` | `asset.catalog.transfer_stock` | source and destination warehouse/assigned |
| Assign asset | `AssetAssignment.handleAssign` | `addAssetAssignment` + `updateAsset` | direct table writes today | `asset.assignment.assign` | asset warehouse/department/assigned |
| Return asset | `AssetAssignment.handleReturn` | `addAssetAssignment` + `updateAsset` | direct table writes today | `asset.assignment.return` | asset warehouse/department/assigned |
| Transfer assignment | `AssetAssignment.handleTransfer` | `addAssetAssignment` + `updateAsset` | direct table writes today | `asset.assignment.transfer` | source and destination assigned/department |
| Create maintenance | `AssetMaintenance.handleSave` | `addAssetMaintenance` | direct table write today | `asset.maintenance.create` | asset warehouse/department/assigned |
| Complete maintenance | `AssetMaintenance.handleComplete` | `updateAssetMaintenance` + `updateAsset` | direct table writes today | `asset.maintenance.complete` | asset warehouse/department/assigned |
| Import maintenance | `AssetMaintenance.handleExcelImport` | `addAssetMaintenance` | direct table writes today | `asset.maintenance.import` + `asset.maintenance.create` | asset warehouse/department/assigned |
| Perform audit | `AssetAudit.handleSaveAudit` | audit context method discovered by inventory | direct table writes today | `asset.audit.perform` | audited asset warehouse/department/assigned |
| Export audit | `AssetAudit.exportSessionToExcel` | none | client export | `asset.audit.export` + `asset.audit.view` | audit session scope |
```

- [ ] **Step 0.3: Inventory linked database schema**

Create `/tmp/list-asset-schema.sql`:

```sql
select table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    table_name like 'asset%'
    or table_name in ('warehouses', 'departments', 'users')
  )
order by table_name, ordinal_position;

select n.nspname as schema_name,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app_private')
  and (
    p.proname like '%asset%'
    or p.proname in ('current_app_user_id', 'is_module_admin')
  )
order by schema_name, function_name, args;

select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename like 'asset%'
order by tablename, policyname;

select t.typname as enum_name, e.enumlabel as enum_value
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname like 'asset%'
order by t.typname, e.enumsortorder;
```

Run:

```bash
node_modules/.bin/supabase db query --linked --agent=no --file /tmp/list-asset-schema.sql
```

Expected: command exits `0`. Copy relevant output into `asset-action-inventory.md`.

- [ ] **Step 0.4: Stop if table or RPC names differ**

If linked DB lacks any table/function named in later tasks, update the plan sections for the real names before writing migration SQL. Do not write migration SQL against guessed names.

---

## Task 1: Registry Defines Action Codes And View Dependency

**Files:**

- Modify: `/Users/admin/khotienthinh/lib/permissions/erpPermissionRegistry.ts`
- Modify: `/Users/admin/khotienthinh/lib/__tests__/manualPermissionCatalogContract.test.ts`

**Interfaces:**

- Produces action codes consumed by capability helpers, UI, and RPC guards.

- [ ] **Step 1.1: Write registry tests**

Add tests:

```ts
const actionCodesFor = (moduleCode: string) =>
  ERP_PERMISSION_MODULES.find((module) => module.module === moduleCode)?.actions.map((action) => action.code) ?? [];

it('defines asset catalog action codes with view first and legacy manage last', () => {
  expect(actionCodesFor('asset.catalog')).toEqual([
    'asset.catalog.view',
    'asset.catalog.create',
    'asset.catalog.edit',
    'asset.catalog.delete',
    'asset.catalog.dispose',
    'asset.catalog.import',
    'asset.catalog.transfer_stock',
    'asset.catalog.manage',
  ]);
});

it('defines asset assignment, maintenance, audit, and report action codes', () => {
  expect(actionCodesFor('asset.assignment')).toEqual([
    'asset.assignment.view',
    'asset.assignment.assign',
    'asset.assignment.return',
    'asset.assignment.transfer',
  ]);
  expect(actionCodesFor('asset.maintenance')).toEqual([
    'asset.maintenance.view',
    'asset.maintenance.create',
    'asset.maintenance.complete',
    'asset.maintenance.import',
    'asset.maintenance.manage',
  ]);
  expect(actionCodesFor('asset.audit')).toEqual([
    'asset.audit.view',
    'asset.audit.perform',
    'asset.audit.export',
  ]);
});
```

- [ ] **Step 1.2: Verify test fails**

Run:

```bash
npm test -- --run lib/__tests__/manualPermissionCatalogContract.test.ts
```

Expected: fails because current Asset registry only has broad or mismatched actions.

- [ ] **Step 1.3: Update Asset registry**

Set Asset action lists:

```ts
module('asset.catalog', 'Danh mục tài sản', 'TS', ['/ts/dashboard', '/ts/catalog', '/ts/asset/:id'], 10, actions('asset.catalog', 'TS', '/ts/catalog', ASSET_SCOPE, [
  ['view', 'Xem', 10],
  ['create', 'Tạo', 20],
  ['edit', 'Sửa', 30],
  ['delete', 'Xóa', 40],
  ['dispose', 'Xuất hủy', 50],
  ['import', 'Import Excel', 60],
  ['transfer_stock', 'Điều chuyển tồn', 70],
  ['manage', 'Quản trị Legacy', 90],
])),
module('asset.assignment', 'Cấp phát tài sản', 'TS', ['/ts/assignment'], 20, actions('asset.assignment', 'TS', '/ts/assignment', ASSET_SCOPE, [
  ['view', 'Xem', 10],
  ['assign', 'Cấp phát', 20],
  ['return', 'Thu hồi', 30],
  ['transfer', 'Luân chuyển', 40],
])),
module('asset.maintenance', 'Bảo trì tài sản', 'TS', ['/ts/maintenance'], 30, actions('asset.maintenance', 'TS', '/ts/maintenance', ASSET_SCOPE, [
  ['view', 'Xem', 10],
  ['create', 'Tạo phiếu', 20],
  ['complete', 'Hoàn tất', 30],
  ['import', 'Import Excel', 40],
  ['manage', 'Quản trị Legacy', 90],
])),
module('asset.audit', 'Kiểm kê tài sản', 'TS', ['/ts/audit', '/ts/reports'], 40, actions('asset.audit', 'TS', '/ts/audit', ASSET_SCOPE, [
  ['view', 'Xem', 10],
  ['perform', 'Thực hiện kiểm kê', 20],
  ['export', 'Xuất Excel', 30],
])),
```

- [ ] **Step 1.4: Verify registry tests pass**

Run:

```bash
npm test -- --run lib/__tests__/manualPermissionCatalogContract.test.ts
```

Expected: test file passes.

---

## Task 2: Enforce View-Only Route And Menu Access

**Files:**

- Modify: `/Users/admin/khotienthinh/lib/permissions/permissionService.ts`
- Modify: `/Users/admin/khotienthinh/lib/__tests__/permissionService.test.ts`
- Modify: `/Users/admin/khotienthinh/lib/__tests__/routeAccess.test.ts`

**Interfaces:**

- Produces `canViewRoute` and `canViewModule` behavior that only recognizes view actions for navigation.

- [ ] **Step 2.1: Write failing navigation tests**

Add tests:

```ts
it('does not open asset routes from a non-view effective action alone', () => {
  const actor = user({
    effectivePermissions: [{
      permissionCode: 'asset.catalog.create',
      sourceType: 'DIRECT',
      sourceId: 'grant-create',
      sourceCode: 'DIRECT',
      sourceLabel: 'Direct grant',
      scopeType: 'warehouse',
      scopeId: 'wh-1',
      riskLevel: 'normal',
      isBusinessApproval: false,
      metadata: {},
    }],
  });

  expect(canViewModule(actor, 'asset')).toBe(false);
  expect(canViewRoute(actor, '/ts/catalog')).toBe(false);
});

it('opens asset routes only when the matching view source exists', () => {
  const actor = user({
    effectivePermissions: [{
      permissionCode: 'asset.catalog.view',
      sourceType: 'DIRECT',
      sourceId: 'grant-view',
      sourceCode: 'DIRECT',
      sourceLabel: 'Direct grant',
      scopeType: 'warehouse',
      scopeId: 'wh-1',
      riskLevel: 'normal',
      isBusinessApproval: false,
      metadata: {},
    }],
  });

  expect(canViewModule(actor, 'asset')).toBe(true);
  expect(canViewRoute(actor, '/ts/catalog')).toBe(true);
  expect(canViewRoute(actor, '/ts/assignment')).toBe(false);
});
```

- [ ] **Step 2.2: Verify tests fail**

Run:

```bash
npm test -- --run lib/__tests__/permissionService.test.ts lib/__tests__/routeAccess.test.ts
```

Expected: at least the non-view route test fails because current effective-source navigation accepts any action.

- [ ] **Step 2.3: Change effective navigation helpers**

Update `canViewModuleFromEffectiveSources` to filter only `action.action === 'view'`.

Update the effective-source branch in `canViewRoute` to require `action.action === 'view'` before route matching.

Implementation shape:

```ts
const isViewAction = (action: PermissionActionDefinition): boolean => action.action === 'view';

const canViewModuleFromEffectiveSources = (
  user: Pick<User, 'effectivePermissions'>,
  moduleCodeOrLegacyKey: string,
  scope?: PermissionScope,
): boolean => getPermissionModules()
  .filter(module => moduleMatchesIdentifier(module.code, module.legacyModuleKey, moduleCodeOrLegacyKey))
  .some(module => module.actions.some(action =>
    isViewAction(action) && userHasEffectivePermissionForNavigation(user, action.permissionCode, scope)
  ));
```

In `canViewRoute`, keep the route matching code but short-circuit non-view actions:

```ts
if (user.effectivePermissions !== undefined) {
  return getPermissionModules().some(module => module.actions.some(action => {
    if (!isViewAction(action)) return false;
    if (!userHasEffectivePermissionForNavigation(user, action.permissionCode, scope)) return false;
    ...
  }));
}
```

- [ ] **Step 2.4: Verify navigation tests pass**

Run:

```bash
npm test -- --run lib/__tests__/permissionService.test.ts lib/__tests__/routeAccess.test.ts
```

Expected: navigation tests pass.

---

## Task 3: Lock Direct Grant View Dependency In Admin UI Model

**Files:**

- Modify: `/Users/admin/khotienthinh/lib/permissions/unifiedPermissionViewModel.ts`
- Modify: `/Users/admin/khotienthinh/lib/__tests__/unifiedPermissionViewModel.test.ts`
- Modify: `/Users/admin/khotienthinh/components/permissions/UnifiedPermissionMatrix.tsx`

**Interfaces:**

- Produces grant behavior:
  - Checking action adds matching module `view`.
  - View cannot be removed while action direct grants exist.
  - Bulk module revoke remains explicit.

- [ ] **Step 3.1: Write grant dependency tests**

Add:

```ts
it('auto-adds module view when an asset action is checked', () => {
  const module = getPermissionModules().find(candidate => candidate.code === 'asset.catalog')!;
  const grants = toggleUnifiedDirectGrant({
    module,
    grants: [],
    targetUserId: 'user-1',
    permissionCode: 'asset.catalog.create',
    checked: true,
    scope: { scopeType: 'warehouse', scopeId: 'wh-1' },
  });

  expect(grants.map(grant => grant.permissionCode).sort()).toEqual([
    'asset.catalog.create',
    'asset.catalog.view',
  ]);
});

it('keeps asset view when action grants remain', () => {
  const module = getPermissionModules().find(candidate => candidate.code === 'asset.catalog')!;
  const existing = [
    { userId: 'user-1', permissionCode: 'asset.catalog.view', scopeType: 'warehouse' as const, scopeId: 'wh-1' },
    { userId: 'user-1', permissionCode: 'asset.catalog.create', scopeType: 'warehouse' as const, scopeId: 'wh-1' },
  ];

  const grants = toggleUnifiedDirectGrant({
    module,
    grants: existing,
    targetUserId: 'user-1',
    permissionCode: 'asset.catalog.view',
    checked: false,
    scope: { scopeType: 'warehouse', scopeId: 'wh-1' },
  });

  expect(grants).toEqual(existing);
});
```

- [ ] **Step 3.2: Verify test fails**

Run:

```bash
npm test -- --run lib/__tests__/unifiedPermissionViewModel.test.ts
```

Expected: second test fails if current behavior removes all module grants when unchecking view.

- [ ] **Step 3.3: Update toggle logic**

Change `toggleUnifiedDirectGrant`:

```ts
if (!input.checked) {
  if (action.action === 'view') {
    const hasSiblingActionGrant = input.grants.some(grant =>
      grant.userId === input.targetUserId
      && grant.permissionCode !== action.permissionCode
      && moduleCodes.has(grant.permissionCode)
      && grantMatchesScope(grant, scope)
      && grant.isActive !== false
    );
    if (hasSiblingActionGrant) return [...input.grants];
  }
  return input.grants.filter(grant => !sameDraftKey(grant));
}
```

Add a separate explicit helper for bulk revoke:

```ts
export const revokeUnifiedModuleDirectGrants = (input: {
  module: PermissionModuleDefinition;
  grants: readonly UserPermissionGrant[];
  targetUserId: string;
  scope: PermissionScope;
}): UserPermissionGrant[] => {
  const scope = normalizeScope(input.scope);
  const moduleCodes = new Set(input.module.actions.map(candidate => candidate.permissionCode));
  return input.grants.filter(grant => !(
    grant.userId === input.targetUserId
    && moduleCodes.has(grant.permissionCode)
    && grantMatchesScope(grant, scope)
  ));
};
```

- [ ] **Step 3.4: Update matrix UI**

In `UnifiedPermissionMatrix.tsx`, disable the `view` checkbox when sibling action grants remain and show concise helper text:

```tsx
const hasSiblingDirectActions = row.action === 'view' && rows.some(candidate =>
  candidate.action !== 'view' && candidate.hasDirectGrant
);

<input
  type="checkbox"
  checked={row.hasDirectGrant}
  disabled={!row.canAdd && !row.hasDirectGrant || hasSiblingDirectActions}
  onChange={(event) => onToggle(row.permissionCode, event.target.checked)}
/>
```

Use existing component patterns for disabled styling; do not add explanatory paragraphs outside the permission matrix.

- [ ] **Step 3.5: Verify**

Run:

```bash
npm test -- --run lib/__tests__/unifiedPermissionViewModel.test.ts lib/__tests__/unifiedPermissionMatrix.test.tsx
```

Expected: tests pass.

---

## Task 4: Scoped Asset Capability Helpers

**Files:**

- Create: `/Users/admin/khotienthinh/lib/permissions/assetPermissionScope.ts`
- Create: `/Users/admin/khotienthinh/lib/permissions/assetPermissionCapabilities.ts`
- Create: `/Users/admin/khotienthinh/lib/__tests__/assetPermissionCapabilities.test.ts`

**Interfaces:**

- Produces:

```ts
export interface AssetPermissionTarget {
  warehouseId?: string | null;
  departmentId?: string | null;
  assignedUserId?: string | null;
}

export const hasAssetAction: (
  user: User | null | undefined,
  permissionCode: string,
  target?: AssetPermissionTarget,
) => boolean;
```

- [ ] **Step 4.1: Write scoped capability tests**

Add tests:

```ts
it('requires view separately from create', () => {
  const actor = userWith(['asset.catalog.create'], { scopeType: 'warehouse', scopeId: 'wh-1' });

  expect(getAssetCatalogRouteCapabilities(actor).canViewCatalog).toBe(false);
  expect(getAssetCatalogRecordCapabilities(actor, { warehouseId: 'wh-1' }).canCreate).toBe(true);
});

it('allows scoped edit only for matching asset scope', () => {
  const actor = userWith(['asset.catalog.view', 'asset.catalog.edit'], { scopeType: 'warehouse', scopeId: 'wh-1' });

  expect(getAssetCatalogRecordCapabilities(actor, { warehouseId: 'wh-1' }).canEdit).toBe(true);
  expect(getAssetCatalogRecordCapabilities(actor, { warehouseId: 'wh-2' }).canEdit).toBe(false);
});

it('checks transfer stock against both source and destination scopes', () => {
  const actor = userWith(['asset.catalog.view', 'asset.catalog.transfer_stock'], { scopeType: 'warehouse', scopeId: 'wh-1' });

  expect(getAssetTransferCapabilities(actor, {
    source: { warehouseId: 'wh-1' },
    destination: { warehouseId: 'wh-1' },
  }).canTransferStock).toBe(true);

  expect(getAssetTransferCapabilities(actor, {
    source: { warehouseId: 'wh-1' },
    destination: { warehouseId: 'wh-2' },
  }).canTransferStock).toBe(false);
});
```

- [ ] **Step 4.2: Implement scope helper**

```ts
import type { Asset, User } from '../../types';
import { canPerform } from './permissionService';
import type { PermissionScope } from './permissionTypes';

export interface AssetPermissionTarget {
  warehouseId?: string | null;
  departmentId?: string | null;
  assignedUserId?: string | null;
}

const present = (value: string | null | undefined): value is string => Boolean(value && value.trim());

export const targetFromAsset = (asset: Pick<Asset, 'warehouseId' | 'managingDeptId' | 'assignedToUserId'> | null | undefined): AssetPermissionTarget => ({
  warehouseId: asset?.warehouseId,
  departmentId: asset?.managingDeptId,
  assignedUserId: asset?.assignedToUserId,
});

const candidateScopes = (target?: AssetPermissionTarget): PermissionScope[] => {
  const scopes: PermissionScope[] = [{ scopeType: 'global', scopeId: '*' }];
  if (present(target?.warehouseId)) scopes.push({ scopeType: 'warehouse', scopeId: target.warehouseId });
  if (present(target?.departmentId)) scopes.push({ scopeType: 'department', scopeId: target.departmentId });
  if (present(target?.assignedUserId)) scopes.push({ scopeType: 'assigned', scopeId: target.assignedUserId });
  return scopes;
};

export const hasAssetAction = (
  user: User | null | undefined,
  permissionCode: string,
  target?: AssetPermissionTarget,
): boolean => candidateScopes(target).some(scope => canPerform(user, permissionCode, scope));
```

- [ ] **Step 4.3: Implement capability helper**

```ts
import type { User } from '../../types';
import { canViewRoute } from './permissionService';
import { AssetPermissionTarget, hasAssetAction } from './assetPermissionScope';

export const getAssetCatalogRouteCapabilities = (user: User | null | undefined) => ({
  canViewCatalog: canViewRoute(user, '/ts/catalog'),
  canViewDashboard: canViewRoute(user, '/ts/dashboard'),
});

export const getAssetCatalogRecordCapabilities = (user: User | null | undefined, target?: AssetPermissionTarget) => ({
  canCreate: hasAssetAction(user, 'asset.catalog.create', target),
  canEdit: hasAssetAction(user, 'asset.catalog.edit', target),
  canDelete: hasAssetAction(user, 'asset.catalog.delete', target),
  canDispose: hasAssetAction(user, 'asset.catalog.dispose', target),
  canImport: hasAssetAction(user, 'asset.catalog.import', target),
});

export const getAssetTransferCapabilities = (
  user: User | null | undefined,
  input: { source: AssetPermissionTarget; destination: AssetPermissionTarget },
) => {
  const canSource = hasAssetAction(user, 'asset.catalog.transfer_stock', input.source);
  const canDestination = hasAssetAction(user, 'asset.catalog.transfer_stock', input.destination);
  return { canTransferStock: canSource && canDestination };
};
```

Add assignment, maintenance, audit helpers using the same `hasAssetAction(user, code, target)` pattern.

- [ ] **Step 4.4: Verify**

Run:

```bash
npm test -- --run lib/__tests__/assetPermissionCapabilities.test.ts
```

Expected: tests pass.

---

## Task 5: UI And Handler Gates For Asset Pages

**Files:**

- Modify: `/Users/admin/khotienthinh/pages/ts/AssetCatalog.tsx`
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetProfile.tsx`
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetAssignment.tsx`
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetMaintenance.tsx`
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetAudit.tsx`
- Modify: `/Users/admin/khotienthinh/pages/ts/AssetReports.tsx`
- Create: `/Users/admin/khotienthinh/lib/__tests__/assetActionHandlerGuards.test.ts`

**Interfaces:**

- Consumes capability helpers from Task 4.
- Produces handler behavior: no permission -> no mutation call; permission -> mutation call.

- [ ] **Step 5.1: Write handler tests**

Use the repo's existing test style. If full page rendering is too heavy, extract pure handler policy helpers into `lib/permissions/assetActionUiPolicy.ts` and test them directly.

Required test matrix:

```ts
const catalogActions = [
  ['asset.catalog.create', 'create'],
  ['asset.catalog.edit', 'edit'],
  ['asset.catalog.delete', 'delete'],
  ['asset.catalog.dispose', 'dispose'],
  ['asset.catalog.import', 'import'],
  ['asset.catalog.transfer_stock', 'transfer_stock'],
] as const;

it.each(catalogActions)('blocks catalog %s without permission and allows with permission', (permissionCode, operation) => {
  expect(buildAssetCatalogActionPolicy(userWith(['asset.catalog.view']), operation, { warehouseId: 'wh-1' }).allowed).toBe(false);
  expect(buildAssetCatalogActionPolicy(userWith(['asset.catalog.view', permissionCode], { scopeType: 'warehouse', scopeId: 'wh-1' }), operation, { warehouseId: 'wh-1' }).allowed).toBe(true);
});
```

Repeat for assignment, maintenance, audit, and reports.

- [ ] **Step 5.2: Verify tests fail**

Run:

```bash
npm test -- --run lib/__tests__/assetActionHandlerGuards.test.ts
```

Expected: fails because policy/helper wiring is not implemented.

- [ ] **Step 5.3: Gate page handlers**

For each handler:

- Compute target scope from the selected asset, selected source/destination stock, selected employee, or form target.
- Call the operation-specific capability helper.
- If denied, show existing toast/error pattern and return before any context method or RPC call.
- Disable or hide the matching button using the same boolean.

Examples:

```ts
const target = targetFromAsset(asset);
if (!getAssetCatalogRecordCapabilities(user, target).canEdit) {
  toast.error('Bạn chưa được cấp quyền sửa tài sản trong phạm vi này.');
  return;
}
```

Transfer example:

```ts
const transferPermission = getAssetTransferCapabilities(user, {
  source: { warehouseId: sourceStock.warehouseId, assignedUserId: sourceStock.assignedToUserId },
  destination: { warehouseId: toWarehouseId, assignedUserId: toUserId },
});
if (!transferPermission.canTransferStock) {
  toast.error('Bạn chưa được cấp quyền điều chuyển tồn giữa hai phạm vi này.');
  return;
}
```

- [ ] **Step 5.4: Verify UI/handler tests pass**

Run:

```bash
npm test -- --run lib/__tests__/assetActionHandlerGuards.test.ts lib/__tests__/assetPermissionCapabilities.test.ts
```

Expected: tests pass.

---

## Task 6: Backend Operation RPCs And RLS Inventory Contract

**Files:**

- Create migration via Supabase CLI.
- Create: `/Users/admin/khotienthinh/lib/__tests__/assetActionBackendMigrationContract.test.ts`

**Interfaces:**

- Consumes inventory from Task 0.
- Produces migration that exposes guarded operations and blocks direct bypass writes.

- [ ] **Step 6.1: Create migration**

Run:

```bash
node_modules/.bin/supabase migration new asset_action_operation_guards
```

Expected: CLI prints a new file path under `/Users/admin/khotienthinh/supabase/migrations/`.

- [ ] **Step 6.2: Write migration contract tests**

Test file reads the generated migration and asserts operation guards exist:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readdirSync(join(process.cwd(), 'supabase/migrations'))
  .filter((file) => file.endsWith('_asset_action_operation_guards.sql'))
  .sort()
  .at(-1);

if (!migration) throw new Error('asset_action_operation_guards migration is missing');

const sql = readFileSync(join(process.cwd(), 'supabase/migrations', migration), 'utf8');

describe('asset action backend migration contract', () => {
  it('uses operation-specific permission codes instead of TS module admin only', () => {
    for (const code of [
      'asset.catalog.create',
      'asset.catalog.edit',
      'asset.catalog.delete',
      'asset.catalog.dispose',
      'asset.catalog.import',
      'asset.catalog.transfer_stock',
      'asset.assignment.assign',
      'asset.assignment.return',
      'asset.assignment.transfer',
      'asset.maintenance.create',
      'asset.maintenance.complete',
      'asset.maintenance.import',
      'asset.audit.perform',
    ]) {
      expect(sql).toContain(code);
    }
    expect(sql).not.toMatch(/for all\\s+to authenticated[\\s\\S]*asset\\.audit\\.perform/i);
    expect(sql).not.toContain("if not public.is_module_admin('TS') then");
  });

  it('checks both source and destination scope for stock transfer', () => {
    expect(sql).toContain('asset.catalog.transfer_stock');
    expect(sql).toContain('v_source_allowed');
    expect(sql).toContain('v_destination_allowed');
  });
});
```

- [ ] **Step 6.3: Write migration SQL**

Required backend pattern:

- Keep SELECT policies tied to the module's `view` permission.
- Revoke or deny broad direct writes from `authenticated` on Asset mutation tables unless there is an exact safe policy from inventory.
- Use security definer RPCs for operation writes:
  - `public.create_asset_with_initial_stock(p_asset jsonb)` -> `asset.catalog.create`
  - `public.update_asset_catalog(p_asset_id text, p_patch jsonb)` -> `asset.catalog.edit`, whitelist editable fields
  - `public.delete_asset_catalog(p_asset_id text)` -> `asset.catalog.delete`
  - `public.dispose_asset(p_asset_id text, p_disposal jsonb)` -> `asset.catalog.dispose`
  - `public.import_asset_catalog_row(p_mode text, p_asset jsonb)` -> `asset.catalog.import` plus `create` or `edit`
  - `public.transfer_asset_stock(...)` -> `asset.catalog.transfer_stock` on both source and destination
  - `public.create_asset_assignment(p_payload jsonb)` -> `asset.assignment.assign`
  - `public.return_asset_assignment(p_payload jsonb)` -> `asset.assignment.return`
  - `public.transfer_asset_assignment(p_payload jsonb)` -> `asset.assignment.transfer`
  - `public.create_asset_maintenance(p_payload jsonb)` -> `asset.maintenance.create`
  - `public.import_asset_maintenance_row(p_payload jsonb)` -> `asset.maintenance.import` plus `asset.maintenance.create`
  - `public.complete_asset_maintenance(p_maintenance_id text, p_payload jsonb)` -> `asset.maintenance.complete`, only completion fields and asset status changes
  - `public.save_asset_audit_result(p_payload jsonb)` -> `asset.audit.perform`

Permission guard helper in SQL:

```sql
create or replace function app_private.asset_require_action(
  p_permission_code text,
  p_warehouse_id text default null,
  p_department_id text default null,
  p_assigned_user_id uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.asset_has_action(
    p_permission_code,
    p_warehouse_id,
    p_department_id,
    p_assigned_user_id,
    public.current_app_user_id()
  ) then
    raise exception 'insufficient privilege for %', p_permission_code;
  end if;
end;
$$;
```

Transfer guard must look like:

```sql
v_source_allowed := app_private.asset_has_action(
  'asset.catalog.transfer_stock',
  v_from.warehouse_id,
  v_from.department_id,
  nullif(v_from.assigned_to_user_id, '')::uuid,
  public.current_app_user_id()
);

v_destination_allowed := app_private.asset_has_action(
  'asset.catalog.transfer_stock',
  nullif(p_to_warehouse_id, ''),
  null::text,
  nullif(p_to_user_id, '')::uuid,
  public.current_app_user_id()
);

if not (v_source_allowed and v_destination_allowed) then
  raise exception 'insufficient privilege to transfer asset stock';
end if;
```

If inventory shows `assigned_to_user_id` is uuid, remove `nullif(..., '')::uuid` and pass the uuid column directly.

- [ ] **Step 6.4: Verify contract tests**

Run:

```bash
npm test -- --run lib/__tests__/assetActionBackendMigrationContract.test.ts
```

Expected: contract tests pass.

---

## Task 7: Wire Context Methods To Guarded RPCs

**Files:**

- Modify: `/Users/admin/khotienthinh/context/AppContext.tsx`
- Modify or create focused tests if existing AppContext tests cover Supabase calls.

**Interfaces:**

- Consumes RPCs from Task 6.
- Produces frontend data calls that cannot bypass backend operation guards.

- [ ] **Step 7.1: Replace direct Supabase mutation paths**

Map context methods:

```ts
addAssetWithInitialStock -> supabase.rpc('create_asset_with_initial_stock', { p_asset: payload })
updateAsset for catalog edit -> supabase.rpc('update_asset_catalog', { p_asset_id: asset.id, p_patch: payload })
removeAsset -> supabase.rpc('delete_asset_catalog', { p_asset_id: id })
dispose asset path -> supabase.rpc('dispose_asset', { p_asset_id: id, p_disposal: payload })
transferAssetStock -> supabase.rpc('transfer_asset_stock', existing args)
assignment assign -> supabase.rpc('create_asset_assignment', { p_payload: payload })
assignment return -> supabase.rpc('return_asset_assignment', { p_payload: payload })
assignment transfer -> supabase.rpc('transfer_asset_assignment', { p_payload: payload })
maintenance create -> supabase.rpc('create_asset_maintenance', { p_payload: payload })
maintenance complete -> supabase.rpc('complete_asset_maintenance', { p_maintenance_id: id, p_payload: payload })
audit save -> supabase.rpc('save_asset_audit_result', { p_payload: payload })
```

If one generic context method is used by non-Asset pages, split Asset-specific methods instead of changing unrelated behavior.

- [ ] **Step 7.2: Verify context calls**

Run:

```bash
rg -n "from\\('assets'\\).*delete|from\\('assets'\\).*update|from\\('asset_assignments'\\).*insert|from\\('asset_maintenances'\\).*insert|syncToSupabase\\('assets'|syncToSupabase\\('asset_assignments'|syncToSupabase\\('asset_maintenances'" context/AppContext.tsx pages/ts
```

Expected: no unguarded Asset mutation path remains for operations covered by Task 6.

---

## Task 8: Readiness Labels After Enforcement

**Files:**

- Modify: `/Users/admin/khotienthinh/lib/permissions/permissionReadiness.ts`
- Modify: `/Users/admin/khotienthinh/lib/__tests__/permissionReadiness.test.ts`

**Interfaces:**

- Produces honest readiness labels.

- [ ] **Step 8.1: Add tests for enforced, not verified**

```ts
it('marks asset operation permissions enforced before cloud canary verification', () => {
  for (const code of [
    'asset.catalog.create',
    'asset.catalog.edit',
    'asset.catalog.delete',
    'asset.catalog.dispose',
    'asset.catalog.import',
    'asset.catalog.transfer_stock',
    'asset.assignment.assign',
    'asset.assignment.return',
    'asset.assignment.transfer',
    'asset.maintenance.create',
    'asset.maintenance.complete',
    'asset.maintenance.import',
    'asset.audit.perform',
    'asset.audit.export',
  ]) {
    const action = getPermissionActionByCode(code)!;
    expect(resolvePermissionActionReadiness(action)).toBe('enforced');
  }
});
```

- [ ] **Step 8.2: Add enforced codes only after Tasks 5-7 pass**

Put the codes above in `ENFORCED_PERMISSION_CODES`. Keep `VERIFIED_PERMISSION_CODES` unchanged until Task 10 cloud smoke.

- [ ] **Step 8.3: Verify**

Run:

```bash
npm test -- --run lib/__tests__/permissionReadiness.test.ts
```

Expected: tests pass.

---

## Task 9: Preview Canary

**Files:**

- No code file unless test fixtures are needed.

**Interfaces:**

- Produces proof on local/preview environment before linked cloud apply.

- [ ] **Step 9.1: Run local app checks**

Run:

```bash
npm run lint
npm test
npm run build
```

Expected:

- Lint exits `0`.
- Tests exit `0`.
- Build exits `0`; existing Vite chunk warnings are acceptable if no errors appear.

- [ ] **Step 9.2: Start dev server**

Run:

```bash
npm run dev
```

Expected: server prints a local URL.

- [ ] **Step 9.3: Browser canary with admin**

Using Chrome admin session:

1. Open permission admin.
2. Select `Hà Thị Hải Hồng`.
3. App `Tài sản`, module `Danh mục tài sản`.
4. Grant `Xem` + `Tạo`.
5. Confirm view cannot be removed while create remains.
6. Save.

Expected:

- Direct grants contain `asset.catalog.view` and `asset.catalog.create`.
- No legacy `TS` admin grant is added.

- [ ] **Step 9.4: Employee behavior canary**

Using app-supported impersonation or a separate employee session:

- Asset catalog menu and route are visible because `view` exists.
- Create asset succeeds.
- Edit/delete/dispose/import-update/transfer buttons are unavailable.
- Direct API/RPC attempts for denied operations return insufficient privilege.

---

## Task 10: Linked Cloud Migration And Verification

**Files:**

- Migration generated in Task 6.
- Modify: `/Users/admin/khotienthinh/lib/permissions/permissionReadiness.ts` only after smoke passes.

- [ ] **Step 10.1: Dry-run migration in rollback transaction**

Use the generated migration path:

```bash
ASSET_ACTION_MIGRATION="$(ls -1 supabase/migrations/*_asset_action_operation_guards.sql | tail -n 1)"
printf 'begin;\n\\i %s\nrollback;\n' "$ASSET_ACTION_MIGRATION" > /tmp/asset-action-operation-guards-dry-run.sql
node_modules/.bin/supabase db query --linked --agent=no --file /tmp/asset-action-operation-guards-dry-run.sql
```

Expected: command exits `0`.

- [ ] **Step 10.2: Apply migration**

```bash
node_modules/.bin/supabase db query --linked --agent=no --file "$ASSET_ACTION_MIGRATION"
node_modules/.bin/supabase migration repair "$(basename "$ASSET_ACTION_MIGRATION" | cut -d_ -f1)" --status applied --linked --agent=no --yes
```

Expected: apply and repair exit `0`.

- [ ] **Step 10.3: Cloud negative/positive SQL smoke**

Create `/tmp/asset-action-cloud-smoke.sql` with transaction-safe checks from inventory. It must include:

- one actor with `asset.catalog.view + asset.catalog.create` in one warehouse;
- create succeeds in that warehouse;
- edit/delete/dispose/transfer fail without their permission;
- after granting `asset.catalog.edit`, edit succeeds;
- transfer fails if destination scope is not granted.

Run:

```bash
node_modules/.bin/supabase db query --linked --agent=no --file /tmp/asset-action-cloud-smoke.sql
```

Expected: command exits `0`; all intended denied operations are caught and asserted inside the SQL script.

- [ ] **Step 10.4: Promote verified labels only for smoked actions**

Move only cloud-smoked codes to `VERIFIED_PERMISSION_CODES`, such as:

```ts
const VERIFIED_PERMISSION_CODES = new Set<string>([
  'asset.catalog.view',
  'asset.catalog.create',
  'asset.catalog.edit',
]);
```

Run:

```bash
npm test -- --run lib/__tests__/permissionReadiness.test.ts
```

Expected: tests pass.

---

## Task 11: Final Verification

- [ ] **Step 11.1: Focused tests**

Run:

```bash
npm test -- --run lib/__tests__/manualPermissionCatalogContract.test.ts lib/__tests__/permissionService.test.ts lib/__tests__/routeAccess.test.ts lib/__tests__/unifiedPermissionViewModel.test.ts lib/__tests__/assetPermissionCapabilities.test.ts lib/__tests__/assetActionHandlerGuards.test.ts lib/__tests__/assetActionBackendMigrationContract.test.ts lib/__tests__/permissionReadiness.test.ts
```

Expected: all focused test files pass.

- [ ] **Step 11.2: Full repo checks**

Run:

```bash
npm run lint
npm test
npm run build
```

Expected:

- `npm run lint` exits `0`.
- `npm test` exits `0`.
- `npm run build` exits `0`; existing Vite chunk warnings are acceptable if no new errors appear.

- [ ] **Step 11.3: Final permission UX check**

With `Hà Thị Hải Hồng`:

- Grant `Tài sản -> Danh mục tài sản -> Xem + Tạo`; save.
- Confirm module route/menu visible.
- Confirm create works.
- Confirm edit/delete/dispose/transfer do not work.
- Grant `Sửa`; save.
- Confirm edit works and delete still does not.
- Revoke `Tạo`; confirm create disappears.
- Attempt to revoke `Xem` while `Sửa` remains; UI prevents it.
- Revoke `Sửa`, then revoke `Xem`; route/menu disappear.

---

## Self-Review Checklist

- `view` is the only route/menu/SELECT gate.
- Action grants depend on `view`; action grants never silently open routes by themselves.
- Legacy view and legacy admin are distinct in frontend and backend.
- Scoped grants are evaluated against record/operation target.
- Transfer checks source and destination.
- Dispose, complete maintenance, return/transfer assignment, and audit perform are operation-specific.
- No broad `FOR ALL` policy grants mutation privileges that the action does not name.
- `asset_categories` and side tables are inventoried before any RLS change.
- UI, handler, backend, preview canary, and cloud verification all run before marking permissions verified.
- No worktree is created.
- Branch remains `refactor/module-du-an-v1`.

## Task 0 Inventory Checkpoint

Task 0 was executed on 2026-07-20 and recorded in `/Users/admin/khotienthinh/docs/superpowers/plans/artifacts/asset-action-inventory.md`.

Implementation consequences from the real linked schema:

- There are no linked `asset_audit_sessions` or `asset_audit_items` tables today. `asset.audit.perform` can be UI/handler enforced now, but cannot be marked backend-enforced or verified until audit persistence exists.
- Existing Asset mutation tables have broad `*_active_actor_gate FOR ALL authenticated` policies. Backend enforcement must drop/replace those policies.
- `asset_location_stocks.assigned_to_user_id` and `assets.assigned_to_user_id` are `text`, while `users.id` is `uuid`; SQL must avoid unsafe casts.
- The linked `assets` column inventory did not show `managing_dept_id`; use warehouse and assigned-user scope for `assets` operations unless a later schema query confirms a real department column.
- `asset_location_stocks.dept_id`, `asset_transfers.from_dept_id`, and `asset_transfers.to_dept_id` exist and can be used for stock/transfer department scope.

---

## Execution Choice

Recommended execution: run Tasks 0 through 11 inline in this branch, without splitting frontend and backend into separate deployments. This avoids a false-safe state where checkboxes appear to work but Supabase still accepts or rejects the wrong operations.

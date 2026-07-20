# Permission Admin Searchable Scope And Module Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline and sequentially in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make permission administration usable by replacing raw principal/scope IDs with searchable pickers and replacing flat Business Role permission lists with application/module groups.

**Architecture:** Keep all authorization mutations behind the existing governed preview/save RPCs. Add read-only lookup helpers for scope entity labels, upgrade `PermissionScopePicker` to display searchable entity choices, and refactor `BusinessRoleEditor` rendering through a small grouping view model.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, existing `SearchableSelect`, existing permission registry/readiness services, Supabase JS read-only selects only.

## Global Constraints

- Work only in `/Users/admin/khotienthinh/.worktrees/permission-ux-searchable-scope`.
- Do not edit root checkout files.
- No Supabase migration.
- No Supabase Cloud mutation.
- No direct SQL mutation.
- Do not change permission semantics, readiness, SoD, audit, or backend preview/apply commands.
- Keep raw ID fallback when lookup data is unavailable.
- Preserve existing `PermissionScope` payload shape: `{ scopeType, scopeId }`.
- Every behavior change follows TDD: write failing focused test, observe RED, implement, observe GREEN, commit.

---

## File Structure

- Create `lib/permissions/permissionScopeLookupService.ts`: read-only lookup service and pure row mapping helpers for project, warehouse, construction site, and department scope options.
- Create `lib/__tests__/permissionScopeLookupService.test.ts`: pure mapping tests and source guard against mutation calls.
- Modify `components/permissions/PermissionScopePicker.tsx`: support searchable entity options and raw fallback while keeping current props backward compatible.
- Create `lib/__tests__/permissionScopePickerContract.test.tsx`: source contract for searchable scope behavior.
- Create `components/permissions/PrincipalSearchSelect.tsx`: searchable principal picker using existing `SearchableSelect`.
- Modify `pages/settings/SettingsAuthorizationGovernance.tsx`: use `PrincipalSearchSelect`, load scope lookup options, and pass options to role/direct panels.
- Modify `components/UserModal.tsx`: load/pass scope lookup options to the embedded permission matrix.
- Modify `components/permissions/PrincipalRoleAssignmentPanel.tsx`: accept and pass `scopeLookupOptions`.
- Modify `components/permissions/PrincipalDirectGrantPanel.tsx`: accept and pass `scopeLookupOptions`.
- Modify `components/permissions/DirectUserPermissionWorkspace.tsx`: accept and pass `scopeLookupOptions`.
- Create `lib/permissions/businessRolePermissionCatalogViewModel.ts`: build grouped application/module/action data for the Business Role editor.
- Create `lib/__tests__/businessRolePermissionCatalogViewModel.test.ts`: grouping, selected count, search, selected-only, and default scope tests.
- Modify `components/permissions/BusinessRoleEditor.tsx`: render grouped module accordions, search, selected-only toggle, default scope picker, and per-selected-action scope controls.
- Modify `lib/__tests__/authorizationAdminUiContract.test.ts`: source guards for searchable principal/scope and grouped role editor behavior.

---

### Task 1: Add Scope Lookup Service

**Files:**
- Create: `lib/permissions/permissionScopeLookupService.ts`
- Create: `lib/__tests__/permissionScopeLookupService.test.ts`

**Interfaces:**
- Produces:
  - `PermissionScopeLookupOption`
  - `PermissionScopeLookupOptionsByType`
  - `mapPermissionScopeLookupRows(input)`
  - `permissionScopeLookupService.listLookupOptions()`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/permissionScopeLookupService.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapPermissionScopeLookupRows } from '../permissions/permissionScopeLookupService';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('permission scope lookup service', () => {
  it('maps project, warehouse, construction site, and department rows to searchable labels', () => {
    const options = mapPermissionScopeLookupRows({
      projects: [
        { id: 'project-1', code: 'PRJ-A', name: 'Dự án Alpha', clientName: 'Chủ đầu tư A' },
      ],
      warehouses: [
        { id: 'warehouse-1', code: 'KHO-A', name: 'Kho trung tâm', type: 'main' },
      ],
      constructionSites: [
        { id: 'site-1', code: 'CT-A', name: 'Công trình A' },
      ],
      departments: [
        { id: 'dept-1', code: 'KT', name: 'Phòng Kế toán', type: 'department' },
        { id: 'company-1', code: 'CTY', name: 'Công ty', type: 'company' },
      ],
    });

    expect(options.project).toEqual([
      {
        id: 'project-1',
        label: 'PRJ-A · Dự án Alpha',
        subtitle: 'Chủ đầu tư A',
        searchText: 'project-1 PRJ-A Dự án Alpha Chủ đầu tư A',
      },
    ]);
    expect(options.warehouse?.[0]).toMatchObject({
      id: 'warehouse-1',
      label: 'KHO-A · Kho trung tâm',
      subtitle: 'main',
    });
    expect(options.construction_site?.[0]).toMatchObject({
      id: 'site-1',
      label: 'CT-A · Công trình A',
    });
    expect(options.department).toHaveLength(1);
    expect(options.department?.[0]).toMatchObject({
      id: 'dept-1',
      label: 'KT · Phòng Kế toán',
    });
  });

  it('keeps lookup reads mutation-free', () => {
    const source = read('lib/permissions/permissionScopeLookupService.ts');

    expect(source).toContain('supabase.from');
    expect(source).not.toMatch(/\\.insert\\(|\\.update\\(|\\.delete\\(|\\.upsert\\(|\\.rpc\\(/);
  });
});
```

- [ ] **Step 2: Run the test and observe RED**

```bash
npm test -- lib/__tests__/permissionScopeLookupService.test.ts
```

Expected: FAIL because `permissionScopeLookupService.ts` does not exist.

- [ ] **Step 3: Implement the service**

Create `lib/permissions/permissionScopeLookupService.ts`:

```ts
import { isSupabaseConfigured, supabase } from '../supabase';
import type { PermissionScopeType } from './permissionTypes';

export interface PermissionScopeLookupOption {
  id: string;
  label: string;
  subtitle?: string;
  searchText: string;
}

export type LookupScopeType = Extract<PermissionScopeType, 'project' | 'construction_site' | 'warehouse' | 'department'>;

export type PermissionScopeLookupOptionsByType = Partial<Record<LookupScopeType, PermissionScopeLookupOption[]>>;

interface RawLookupRow {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  clientName?: string | null;
  client_name?: string | null;
  type?: string | null;
}

export interface PermissionScopeLookupRowsInput {
  projects?: RawLookupRow[];
  warehouses?: RawLookupRow[];
  constructionSites?: RawLookupRow[];
  departments?: RawLookupRow[];
}

const compact = (values: Array<string | null | undefined>): string[] =>
  values.map(value => String(value || '').trim()).filter(Boolean);

const toOption = (row: RawLookupRow, subtitleValues: Array<string | null | undefined> = []): PermissionScopeLookupOption | null => {
  const id = String(row.id || '').trim();
  if (!id) return null;
  const code = String(row.code || '').trim();
  const name = String(row.name || '').trim();
  const label = compact([code, name]).join(' · ') || id;
  const subtitle = compact(subtitleValues)[0];
  return {
    id,
    label,
    subtitle,
    searchText: compact([id, code, name, subtitle]).join(' '),
  };
};

const mapRows = (
  rows: RawLookupRow[] | undefined,
  subtitle: (row: RawLookupRow) => Array<string | null | undefined> = () => [],
): PermissionScopeLookupOption[] => (rows || [])
  .map(row => toOption(row, subtitle(row)))
  .filter((option): option is PermissionScopeLookupOption => Boolean(option))
  .sort((left, right) => left.label.localeCompare(right.label, 'vi'));

export const mapPermissionScopeLookupRows = (input: PermissionScopeLookupRowsInput): PermissionScopeLookupOptionsByType => ({
  project: mapRows(input.projects, row => [row.clientName || row.client_name]),
  warehouse: mapRows(input.warehouses, row => [row.type]),
  construction_site: mapRows(input.constructionSites),
  department: mapRows(
    (input.departments || []).filter(row => !row.type || row.type === 'department'),
    row => [row.type],
  ),
});

const safeSelect = async (table: string, columns: string) => {
  const { data, error } = await supabase.from(table).select(columns);
  if (error) return [];
  return data || [];
};

export const permissionScopeLookupService = {
  async listLookupOptions(): Promise<PermissionScopeLookupOptionsByType> {
    if (!isSupabaseConfigured) return {};
    const [projects, warehouses, constructionSites, departments] = await Promise.all([
      safeSelect('projects', 'id,code,name,client_name'),
      safeSelect('warehouses', 'id,code,name,type'),
      safeSelect('hrm_construction_sites', 'id,code,name'),
      safeSelect('org_units', 'id,code,name,type'),
    ]);

    return mapPermissionScopeLookupRows({
      projects,
      warehouses,
      constructionSites,
      departments,
    });
  },
};
```

- [ ] **Step 4: Run GREEN**

```bash
npm test -- lib/__tests__/permissionScopeLookupService.test.ts
git diff --check -- lib/permissions/permissionScopeLookupService.ts lib/__tests__/permissionScopeLookupService.test.ts
```

Expected: PASS and no whitespace findings.

- [ ] **Step 5: Commit Task 1**

```bash
git add lib/permissions/permissionScopeLookupService.ts lib/__tests__/permissionScopeLookupService.test.ts
git commit -m "feat(authz): add searchable scope lookup options"
```

---

### Task 2: Upgrade Permission Scope Picker

**Files:**
- Modify: `components/permissions/PermissionScopePicker.tsx`
- Create: `lib/__tests__/permissionScopePickerContract.test.tsx`

**Interfaces:**
- Consumes: `PermissionScopeLookupOptionsByType` and `PermissionScopeLookupOption`.
- Produces: backward-compatible `PermissionScopePicker` with optional `lookupOptions`.

- [ ] **Step 1: Write the failing contract**

Create `lib/__tests__/permissionScopePickerContract.test.tsx`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('PermissionScopePicker contract', () => {
  it('uses searchable lookup options for entity scopes and keeps raw id fallback', () => {
    const source = read('components/permissions/PermissionScopePicker.tsx');

    expect(source).toContain('SearchableSelect');
    expect(source).toContain('lookupOptions');
    expect(source).toContain('raw id');
    expect(source).toContain('PermissionScopeLookupOptionsByType');
    expect(source).toContain("scopeId: '*'");
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- lib/__tests__/permissionScopePickerContract.test.tsx
```

Expected: FAIL because `PermissionScopePicker` does not import `SearchableSelect` or accept `lookupOptions`.

- [ ] **Step 3: Implement the picker**

Update `components/permissions/PermissionScopePicker.tsx` so it:

- imports `SearchableSelect` from `../common/SearchableSelect`;
- imports `PermissionScopeLookupOptionsByType`;
- exports a props interface with `lookupOptions?: PermissionScopeLookupOptionsByType`;
- keeps global/own/assigned as `scopeId: '*'`;
- for project/construction_site/warehouse/department, renders `SearchableSelect` when options exist;
- renders the existing text input as raw ID fallback when no options exist or no option matches the selected ID.

The key branches must include:

```tsx
const ENTITY_SCOPE_TYPES = new Set(['project', 'construction_site', 'warehouse', 'department']);
const scopeType = value.scopeType || 'global';
const isEntityScope = ENTITY_SCOPE_TYPES.has(scopeType);
const options = isEntityScope ? lookupOptions?.[scopeType as keyof PermissionScopeLookupOptionsByType] || [] : [];
```

and:

```tsx
{isEntityScope && options.length > 0 ? (
  <SearchableSelect
    value={value.scopeId || ''}
    options={options}
    onChange={option => onChange({ scopeType, scopeId: option?.id || '*' })}
    getOptionValue={option => option.id}
    getOptionLabel={option => option.label}
    getOptionSearchText={option => option.searchText}
    renderOption={option => (
      <span className="block">
        <span className="block font-black">{option.label}</span>
        {option.subtitle && <span className="block text-[10px] text-slate-400">{option.subtitle}</span>}
      </span>
    )}
    placeholder="Gõ để tìm scope..."
    emptyLabel="Không tìm thấy scope phù hợp"
    disabled={disabled}
    clearable={false}
  />
) : (
  <input aria-label="raw id" ... />
)}
```

- [ ] **Step 4: Run GREEN**

```bash
npm test -- lib/__tests__/permissionScopePickerContract.test.tsx
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
git diff --check -- components/permissions/PermissionScopePicker.tsx lib/__tests__/permissionScopePickerContract.test.tsx
```

Expected: PASS and no whitespace findings.

- [ ] **Step 5: Commit Task 2**

```bash
git add components/permissions/PermissionScopePicker.tsx lib/__tests__/permissionScopePickerContract.test.tsx
git commit -m "feat(authz): make permission scope picker searchable"
```

---

### Task 3: Wire Searchable Principals And Scope Lookups

**Files:**
- Create: `components/permissions/PrincipalSearchSelect.tsx`
- Modify: `pages/settings/SettingsAuthorizationGovernance.tsx`
- Modify: `components/UserModal.tsx`
- Modify: `components/permissions/PrincipalRoleAssignmentPanel.tsx`
- Modify: `components/permissions/PrincipalDirectGrantPanel.tsx`
- Modify: `components/permissions/DirectUserPermissionWorkspace.tsx`
- Modify: `lib/__tests__/authorizationAdminUiContract.test.ts`

**Interfaces:**
- Consumes: `PermissionScopeLookupOptionsByType` and `permissionScopeLookupService.listLookupOptions()`.
- Produces: all permission scope pickers receive lookup options; principal selector is searchable by name/email.

- [ ] **Step 1: Extend UI contract**

Add this test to `lib/__tests__/authorizationAdminUiContract.test.ts`:

```ts
  it('uses searchable principal and human-readable scope lookups in permission administration', () => {
    const settings = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    const principalSearch = read('components/permissions/PrincipalSearchSelect.tsx');
    const rolePanel = read('components/permissions/PrincipalRoleAssignmentPanel.tsx');
    const directPanel = read('components/permissions/PrincipalDirectGrantPanel.tsx');

    expect(settings).toContain('PrincipalSearchSelect');
    expect(settings).toContain('permissionScopeLookupService.listLookupOptions');
    expect(settings).toContain('scopeLookupOptions');
    expect(principalSearch).toContain('SearchableSelect');
    expect(principalSearch).toContain('principal.email');
    expect(rolePanel).toContain('scopeLookupOptions');
    expect(directPanel).toContain('scopeLookupOptions');
  });
```

- [ ] **Step 2: Run RED**

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: FAIL because `PrincipalSearchSelect` and lookup wiring do not exist.

- [ ] **Step 3: Create PrincipalSearchSelect**

Create `components/permissions/PrincipalSearchSelect.tsx`:

```tsx
import React from 'react';
import type { AuthorizationPrincipal } from '../../lib/permissions/authorizationGovernanceTypes';
import SearchableSelect from '../common/SearchableSelect';

interface PrincipalSearchSelectProps {
  value: string;
  principals: readonly AuthorizationPrincipal[];
  disabled?: boolean;
  onChange: (principalId: string) => void;
}

const PrincipalSearchSelect: React.FC<PrincipalSearchSelectProps> = ({
  value,
  principals,
  disabled = false,
  onChange,
}) => (
  <SearchableSelect
    value={value}
    options={[...principals]}
    onChange={principal => onChange(principal?.userId || '')}
    getOptionValue={principal => principal.userId}
    getOptionLabel={principal => `${principal.name} · ${principal.email}`}
    getOptionSearchText={principal => `${principal.name} ${principal.email}`}
    renderOption={principal => (
      <span className="block">
        <span className="block font-black">{principal.name}</span>
        <span className="block text-[10px] text-slate-400">{principal.email}</span>
      </span>
    )}
    placeholder="Gõ tên hoặc email..."
    emptyLabel="Không tìm thấy nhân viên"
    disabled={disabled}
    clearable={false}
  />
);

export default PrincipalSearchSelect;
```

- [ ] **Step 4: Load and pass lookup options**

In `pages/settings/SettingsAuthorizationGovernance.tsx`:

- import `PrincipalSearchSelect`;
- import `permissionScopeLookupService`;
- import `PermissionScopeLookupOptionsByType`;
- add `const [scopeLookupOptions, setScopeLookupOptions] = useState<PermissionScopeLookupOptionsByType>({});`;
- in `loadPage`, include `permissionScopeLookupService.listLookupOptions()` in the read-only `Promise.all`;
- replace the principal `<select>` with `PrincipalSearchSelect`;
- pass `scopeLookupOptions` to `PrincipalRoleAssignmentPanel`, `PrincipalDirectGrantPanel`, and `DirectUserPermissionWorkspace` if mounted.

In `components/UserModal.tsx`:

- import `permissionScopeLookupService`;
- add local `scopeLookupOptions` state;
- load options when modal opens and `canManageDirectGrants` is true;
- pass `scopeLookupOptions` to `PermissionScopePicker`.

In each panel component, add:

```ts
scopeLookupOptions?: PermissionScopeLookupOptionsByType;
```

and pass it to `PermissionScopePicker`.

- [ ] **Step 5: Run GREEN**

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
npm test -- lib/__tests__/permissionScopeLookupService.test.ts
git diff --check -- pages/settings/SettingsAuthorizationGovernance.tsx components/UserModal.tsx components/permissions/PrincipalSearchSelect.tsx components/permissions/PrincipalRoleAssignmentPanel.tsx components/permissions/PrincipalDirectGrantPanel.tsx components/permissions/DirectUserPermissionWorkspace.tsx lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: PASS and no whitespace findings.

- [ ] **Step 6: Commit Task 3**

```bash
git add pages/settings/SettingsAuthorizationGovernance.tsx components/UserModal.tsx components/permissions/PrincipalSearchSelect.tsx components/permissions/PrincipalRoleAssignmentPanel.tsx components/permissions/PrincipalDirectGrantPanel.tsx components/permissions/DirectUserPermissionWorkspace.tsx lib/__tests__/authorizationAdminUiContract.test.ts
git commit -m "feat(authz): wire searchable permission selectors"
```

---

### Task 4: Add Business Role Permission Grouping View Model

**Files:**
- Create: `lib/permissions/businessRolePermissionCatalogViewModel.ts`
- Create: `lib/__tests__/businessRolePermissionCatalogViewModel.test.ts`

**Interfaces:**
- Produces:
  - `BusinessRolePermissionActionRow`
  - `BusinessRolePermissionModuleGroup`
  - `BusinessRolePermissionApplicationGroup`
  - `buildBusinessRolePermissionGroups(...)`
  - `resolveBusinessRoleItemScope(...)`

- [ ] **Step 1: Write failing tests**

Create `lib/__tests__/businessRolePermissionCatalogViewModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildBusinessRolePermissionGroups,
  resolveBusinessRoleItemScope,
} from '../permissions/businessRolePermissionCatalogViewModel';
import { getAllPermissionActions } from '../permissions/permissionRegistry';

describe('business role permission catalog view model', () => {
  it('groups editable actions by application and module with selected counts', () => {
    const groups = buildBusinessRolePermissionGroups({
      actions: getAllPermissionActions(),
      selectedItems: [
        { permissionCode: 'project.daily_log.view', scopeType: 'project', scopeId: 'project-1', sortOrder: 10 },
        { permissionCode: 'project.daily_log.create', scopeType: 'project', scopeId: 'project-1', sortOrder: 20 },
      ],
      query: '',
      selectedOnly: false,
    });

    const project = groups.find(group => group.applicationCode === 'project');
    const dailyLog = project?.modules.find(module => module.moduleCode === 'project.daily_log');

    expect(project?.selectedCount).toBeGreaterThanOrEqual(2);
    expect(dailyLog?.selectedCount).toBe(2);
    expect(dailyLog?.actions.map(action => action.permissionCode)).toEqual(expect.arrayContaining([
      'project.daily_log.view',
      'project.daily_log.create',
    ]));
  });

  it('filters by search query and selected-only mode', () => {
    const selectedItems = [
      { permissionCode: 'project.daily_log.view', scopeType: 'project' as const, scopeId: 'project-1', sortOrder: 10 },
    ];

    const searched = buildBusinessRolePermissionGroups({
      actions: getAllPermissionActions(),
      selectedItems,
      query: 'nhật ký',
      selectedOnly: false,
    });
    expect(searched.flatMap(group => group.modules).some(module => module.moduleCode === 'project.daily_log')).toBe(true);

    const selectedOnly = buildBusinessRolePermissionGroups({
      actions: getAllPermissionActions(),
      selectedItems,
      query: '',
      selectedOnly: true,
    });
    expect(selectedOnly.flatMap(group => group.modules)).toHaveLength(1);
    expect(selectedOnly[0].modules[0].moduleCode).toBe('project.daily_log');
  });

  it('uses requested scope only when the action supports it', () => {
    const actions = getAllPermissionActions();
    const projectAction = actions.find(action => action.permissionCode === 'project.daily_log.view');
    const systemAction = actions.find(action => action.permissionCode === 'system.wms.view');
    if (!projectAction || !systemAction) throw new Error('Missing fixture actions');

    expect(resolveBusinessRoleItemScope(projectAction, { scopeType: 'project', scopeId: 'project-1' })).toEqual({
      scopeType: 'project',
      scopeId: 'project-1',
    });
    expect(resolveBusinessRoleItemScope(systemAction, { scopeType: 'project', scopeId: 'project-1' })).toEqual({
      scopeType: 'global',
      scopeId: '*',
    });
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- lib/__tests__/businessRolePermissionCatalogViewModel.test.ts
```

Expected: FAIL because the view model file does not exist.

- [ ] **Step 3: Implement the view model**

Implement `lib/permissions/businessRolePermissionCatalogViewModel.ts` with:

- `permissionRegistry` to preserve application/module labels;
- `isIdentityBoundPermission` to filter non-editable identity-bound actions;
- `isPermissionActionScopeAllowed` to validate requested scopes;
- selected count propagation from action to module to application;
- query matching against application label, module label, action label, and permission code.

The `resolveBusinessRoleItemScope` function must return the requested scope if allowed, otherwise the action's first supported scope or `global/*`.

- [ ] **Step 4: Run GREEN**

```bash
npm test -- lib/__tests__/businessRolePermissionCatalogViewModel.test.ts
git diff --check -- lib/permissions/businessRolePermissionCatalogViewModel.ts lib/__tests__/businessRolePermissionCatalogViewModel.test.ts
```

Expected: PASS and no whitespace findings.

- [ ] **Step 5: Commit Task 4**

```bash
git add lib/permissions/businessRolePermissionCatalogViewModel.ts lib/__tests__/businessRolePermissionCatalogViewModel.test.ts
git commit -m "feat(authz): group business role permission catalog"
```

---

### Task 5: Replace Flat Business Role Editor With Module Groups

**Files:**
- Modify: `components/permissions/BusinessRoleEditor.tsx`
- Modify: `lib/__tests__/authorizationAdminUiContract.test.ts`

**Interfaces:**
- Consumes: `buildBusinessRolePermissionGroups`, `resolveBusinessRoleItemScope`, and searchable `PermissionScopePicker`.
- Produces: grouped Business Role editor with search, selected-only filter, module selected counts, and default scope picker.

- [ ] **Step 1: Extend UI contract**

Add this test to `lib/__tests__/authorizationAdminUiContract.test.ts`:

```ts
  it('groups Business Role permissions by module instead of rendering a flat action list', () => {
    const editor = read('components/permissions/BusinessRoleEditor.tsx');

    expect(editor).toContain('buildBusinessRolePermissionGroups');
    expect(editor).toContain('selectedOnly');
    expect(editor).toContain('permissionSearch');
    expect(editor).toContain('expandedModules');
    expect(editor).toContain('quyền đã chọn');
    expect(editor).not.toContain('editableActions.map(action =>');
  });
```

- [ ] **Step 2: Run RED**

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: FAIL because `BusinessRoleEditor` still renders the flat list.

- [ ] **Step 3: Implement grouped editor UI**

In `BusinessRoleEditor.tsx`:

- add props `scopeLookupOptions?: PermissionScopeLookupOptionsByType`;
- import `Search`, `ChevronDown`, and `ChevronRight` from `lucide-react`;
- import `PermissionScopePicker`;
- import `buildBusinessRolePermissionGroups` and `resolveBusinessRoleItemScope`;
- add states:

```ts
const [permissionSearch, setPermissionSearch] = useState('');
const [selectedOnly, setSelectedOnly] = useState(false);
const [defaultScope, setDefaultScope] = useState<PermissionScope>({ scopeType: 'global', scopeId: '*' });
const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
```

- replace the flat `editableActions.map(...)` block with grouped rendering;
- module headers show label and `selectedCount`;
- checking a new action uses `resolveBusinessRoleItemScope(action, defaultScope)`;
- selected rows render a compact `PermissionScopePicker` to change that item's scope;
- existing `Preview tác động` and `Lưu role` validation remains unchanged.

- [ ] **Step 4: Pass scope lookup options to BusinessRoleEditor**

In `SettingsAuthorizationGovernance.tsx`, pass:

```tsx
scopeLookupOptions={scopeLookupOptions}
```

to `BusinessRoleEditor`.

- [ ] **Step 5: Run GREEN**

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
npm test -- lib/__tests__/businessRolePermissionCatalogViewModel.test.ts
git diff --check -- components/permissions/BusinessRoleEditor.tsx pages/settings/SettingsAuthorizationGovernance.tsx lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: PASS and no whitespace findings.

- [ ] **Step 6: Commit Task 5**

```bash
git add components/permissions/BusinessRoleEditor.tsx pages/settings/SettingsAuthorizationGovernance.tsx lib/__tests__/authorizationAdminUiContract.test.ts
git commit -m "feat(authz): group business role permissions by module"
```

---

### Task 6: Focused Regression And Build Checks

**Files:**
- Verify only unless a focused failure exposes a defect from Tasks 1-5.

- [ ] **Step 1: Run focused permission UX tests**

```bash
npm test -- \
  lib/__tests__/permissionScopeLookupService.test.ts \
  lib/__tests__/permissionScopePickerContract.test.tsx \
  lib/__tests__/businessRolePermissionCatalogViewModel.test.ts \
  lib/__tests__/authorizationAdminUiContract.test.ts \
  lib/__tests__/permissionRegistry.test.ts \
  lib/__tests__/unifiedPermissionViewModel.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend safety checks**

```bash
npm run lint
npm run build
git diff --check
```

Expected: lint PASS, build exits `0`, and diff check has no output. Vite chunk-size warning is acceptable if build exits `0`.

- [ ] **Step 3: Inspect forbidden boundaries**

```bash
rg -n "supabase\\.from\\([^)]*\\)\\.(insert|update|delete|upsert)|supabase\\.rpc\\(" \
  lib/permissions/permissionScopeLookupService.ts
```

Expected: exit `1` with no matches.

```bash
rg -n "editableActions\\.map\\(action =>|projectId|warehouseId|departmentId" \
  components/permissions/BusinessRoleEditor.tsx \
  components/permissions/PermissionScopePicker.tsx \
  pages/settings/SettingsAuthorizationGovernance.tsx
```

Expected: no flat action list. Mentions of IDs are allowed only in fallback copy or type names.

- [ ] **Step 4: Inspect status and commits**

```bash
git status --short
git log --oneline -8
```

Expected: clean tracked worktree after committed tasks.

---

## Self-Review Checklist

- Spec coverage: principal search, entity scope search, raw fallback, module grouping, search, selected-only, and no semantics change are covered.
- No migration: plan creates no migration and runs no Supabase CLI.
- No Cloud mutation: implementation uses only read-only selects for lookup labels.
- Existing security boundary remains: preview/save RPCs still perform mutation and SoD checks.
- Type consistency: `PermissionScopeLookupOptionsByType` flows from service to scope pickers and panels.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-19-permission-admin-searchable-scope-and-module-groups.md`.

Two execution options:

1. **Inline Execution (recommended for this UX correction)** - Execute tasks in this session using `superpowers:executing-plans`, checkpoint after each task.
2. **Pause After Plan** - Stop here so the operator can review the plan before code changes.

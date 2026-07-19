import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('searchable permission admin UX contract', () => {
  it('uses searchable principal selection by name and email', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');

    expect(page).toContain('SearchableSelect');
    expect(page).toContain('getPrincipalSearchText');
    expect(page).toContain('renderPrincipalOption');
    expect(page).toContain('selectPrincipal');
    expect(page).not.toContain('value={selectedPrincipalId}\n              onChange={event => {');
  });

  it('loads named scope lookup options and passes them into scope pickers', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    const directWorkspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');
    const roleAssignment = read('components/permissions/PrincipalRoleAssignmentPanel.tsx');
    const directPanel = read('components/permissions/PrincipalDirectGrantPanel.tsx');
    const userModal = read('components/UserModal.tsx');

    expect(page).toContain('permissionScopeLookupService.listLookupOptions()');
    expect(page).toContain('setScopeLookupOptions');
    expect((page.match(/scopeLookupOptions=\{scopeLookupOptions\}/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(directWorkspace).toContain('scopeLookupOptions?: PermissionScopeLookupOptionsByType');
    expect(roleAssignment).toContain('scopeLookupOptions?: PermissionScopeLookupOptionsByType');
    expect(directPanel).toContain('scopeLookupOptions?: PermissionScopeLookupOptionsByType');
    expect(userModal).toContain('permissionScopeLookupService.listLookupOptions()');
    expect(userModal).toContain('lookupOptions={scopeLookupOptions}');
  });

  it('groups the Business Role editor by app and module with search filters', () => {
    const editor = read('components/permissions/BusinessRoleEditor.tsx');
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');

    expect(editor).toContain('permissionRegistry');
    expect(editor).toContain('expandedModules');
    expect(editor).toContain('searchQuery');
    expect(editor).toContain('showSelectedOnly');
    expect(editor).toContain('PermissionScopePicker');
    expect(editor).toContain('scopeLookupOptions?: PermissionScopeLookupOptionsByType');
    expect(page).toContain('<BusinessRoleEditor');
    expect(page).toContain('scopeLookupOptions={scopeLookupOptions}');
    expect(editor).not.toContain('max-h-72 space-y-2 overflow-auto');
  });
});

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
});

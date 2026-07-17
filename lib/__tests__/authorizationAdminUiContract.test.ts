import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('authorization admin UI contract', () => {
  it('gates the governance tab with the new permission', () => {
    const settings = read('pages/Settings.tsx');
    expect(settings).toContain('system.authorization.view');
    expect(settings).toContain('SettingsAuthorizationGovernance');
  });

  it('uses source explanation and the governed V2 direct-grant service', () => {
    const modal = read('components/UserModal.tsx');
    expect(modal).toContain('listEffectivePermissionSources');
    expect(modal).toContain('replaceUserPermissionGrants');
    expect(modal).toContain('previewDirectGrantReplacement');
    expect(modal).toContain('isIdentityBoundPermission');
    expect(modal).toContain('canManageDirectGrants');
    expect(modal).not.toMatch(/formData\.role !== Role\.ADMIN\s*&&\s*\([\s\S]*PermissionMatrix/);
    expect(modal).toContain('permissionChangeReason');
    expect(modal).toContain('warningAcceptances');
    expect(modal).toContain('Lưu phân quyền');
  });

  it('does not pretend profile and permissions save atomically in Phase 2', () => {
    const modal = read('components/UserModal.tsx');
    expect(modal).toContain('handleSaveDirectPermissions');
    expect(modal).not.toMatch(/await onSave\(finalUser\);\s*if \(isSupabaseConfigured\) \{\s*await replaceUserPermissionGrants/s);
  });

  it('contains no browser actor payload', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    expect(page).toContain('PrincipalDirectGrantPanel');
    expect(page).toContain('previewBusinessRoleAssignment');
    expect(page).not.toMatch(/p_actor|actorUserId|requestedBy/);
  });
});

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

  it('uses one unified source-aware editor and governed permission save', () => {
    const modal = read('components/UserModal.tsx');
    const panel = read('components/permissions/PrincipalDirectGrantPanel.tsx');
    expect(modal).toContain('listEffectivePermissionSources');
    expect(modal).toContain('UnifiedPermissionMatrix');
    expect(modal).toContain('previewUserPermissionChange');
    expect(modal).toContain('applyUserPermissionChange');
    expect(modal).toContain('isIdentityBoundPermission');
    expect(modal).toContain('canManageDirectGrants');
    expect(modal).not.toContain('Phân quyền module');
    expect(modal).not.toContain('Quản trị Sub-module');
    expect(panel).toContain('UnifiedPermissionMatrix');
    expect(panel).toContain('buildUnifiedPermissionDraftKey');
    expect(modal).toContain('permissionChangeReason');
    expect(modal).toContain('warningAcceptances');
    expect(modal).toContain('Lưu phân quyền');
  });

  it('keeps profile save separate from protected permission drafts', () => {
    const modal = read('components/UserModal.tsx');
    expect(modal).toContain('persistedLegacyState');
    expect(modal).not.toMatch(/await onSave\([^)]*legacyDraft/);
  });

  it('contains no browser actor payload', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    expect(page).toContain('PrincipalDirectGrantPanel');
    expect(page).toContain('previewBusinessRoleAssignment');
    expect(page).not.toMatch(/p_actor|actorUserId|requestedBy/);
  });

  it('remounts the direct-grant draft when the selected principal changes', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    expect(page).toMatch(/<PrincipalDirectGrantPanel\s+key=\{selectedPrincipal\.userId\}/);
  });

  it('preserves the latest principal across overlapping page loads', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    expect(page).toContain("const selectedPrincipalIdRef = useRef('');");
    expect(page).toContain('selectedPrincipalIdRef.current = principalId;');
    expect(page).toContain('const preferredPrincipalId = selectedPrincipalIdRef.current;');
  });

  it('does not mount a principal draft before that principal details load', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    expect(page).toContain("const [loadedPrincipalId, setLoadedPrincipalId] = useState('');");
    expect(page).toContain('if (selectedPrincipalIdRef.current !== principalId) return;');
    expect(page).toContain('selectedPrincipal && loadedPrincipalId === selectedPrincipal.userId');
  });
});

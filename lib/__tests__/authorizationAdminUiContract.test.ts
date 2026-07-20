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

  it('keeps user profile editing separate from the unified permission workflow', () => {
    const modal = read('components/UserModal.tsx');
    const workspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');
    expect(modal).not.toContain('UnifiedPermissionMatrix');
    expect(modal).not.toContain('previewUserPermissionChange');
    expect(modal).not.toContain('applyUserPermissionChange');
    expect(modal).not.toContain('PermissionChangeSummary');
    expect(modal).not.toContain('SodWarningPanel');
    expect(modal).not.toContain('Lưu phân quyền');
    expect(workspace).toContain('UnifiedPermissionMatrix');
    expect(workspace).toContain('legacyDraft');
    expect(workspace).toContain('setLegacyDraft');
    expect(workspace).toContain('previewUserPermissionChange(principal.userId, legacyDraft, drafts)');
    expect(workspace).toContain('applyUserPermissionChange(principal.userId, previewToApply.beforeFingerprint, legacyToApply, drafts');
    expect(modal).not.toContain('Phân quyền module');
    expect(modal).not.toContain('Quản trị Sub-module');
    expect(workspace).toContain('permissionChangeReason');
    expect(workspace).toContain('warningAcceptances');
    expect(workspace).toContain('Lưu phân quyền');
  });

  it('lets Save run backend preview on demand instead of forcing a separate Preview click', () => {
    const workspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');

    expect(workspace).toContain('let previewToApply: UnifiedPermissionPreview | null = previewMatches ? preview : null;');
    expect(workspace).toContain('previewToApply = await previewUserPermissionChange(principal.userId, legacyDraft, drafts);');
    expect(workspace).toContain('|| !unifiedDraftChanged');
    expect(workspace).not.toContain('|| !previewMatches\n    || Boolean');
    expect(workspace).not.toContain('Draft da thay doi; hay preview lai.');
  });

  it('exposes only approved retired Direct Grants for removal', () => {
    const panel = read('components/permissions/PrincipalDirectGrantPanel.tsx');
    expect(panel).toContain('RETIRED_MATERIAL_REQUEST_PERMISSION_CODES');
    expect(panel).toContain("'project.material_request.confirm'");
    expect(panel).toContain("'project.material_request.verify'");
    expect(panel).toContain('retiredDirectGrants');
    expect(panel).toContain('Quyền retire chỉ được thu hồi');
    expect(panel).toContain('updateDrafts(drafts.filter(candidate => candidate !== grant))');
  });

  it('keeps profile save separate from protected permission drafts', () => {
    const modal = read('components/UserModal.tsx');
    expect(modal).not.toContain('legacyDraft');
    expect(modal).not.toContain('permissionGrants');
    expect(modal).not.toMatch(/await onSave\([^)]*legacyDraft/);
    expect(modal).not.toMatch(/await onSave\([^)]*permissionGrants/);
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
    expect(workspace).toContain('beforeLegacy={preview.legacyBefore}');
    expect(workspace).toContain('afterLegacy={legacyDraft}');
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

  it('renders all-module matrix with adaptive scope instead of project-only filtering', () => {
    const workspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');

    expect(workspace).toContain('PermissionScopePicker');
    expect(workspace).toContain('<UnifiedPermissionMatrix');
    expect(workspace).not.toContain('applicationFilter="project"');
    expect(workspace).not.toContain('projectMasterService.list');
    expect(workspace).not.toContain('__missing_project__');
    expect(workspace).not.toContain('Hay chon mot du an');
    expect(workspace).not.toContain('Tất cả dự án');
  });

  it('shows current permissions in the same user workflow with navigation and revocation affordances', () => {
    const workspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');
    const matrix = read('components/permissions/UnifiedPermissionMatrix.tsx');

    expect(workspace).toContain('buildCurrentPermissionOverview');
    expect(workspace).toContain('Quyền đang có');
    expect(workspace).toContain('handleOpenPermissionLocation');
    expect(workspace).toContain('handleRevokeDirectGrant');
    expect(workspace).toContain('Thu hồi Direct');
    expect(workspace).toContain('Mở module');
    expect(matrix).toContain('buildPermissionWorkbenchApplications');
    expect(matrix).not.toContain('Hệ thống ERP');
  });

  it('explains optional scope selection and prioritizes modules compatible with the current scope', () => {
    const workspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');
    const tree = read('components/permissions/CompactDirectPermissionTree.tsx');

    expect(workspace).toContain('Không bắt buộc chọn Dự án');
    expect(workspace).toContain('Scope Dự án chỉ cấp được quyền hỗ trợ Dự án');
    expect(tree).toContain('sortModulesByScopeCompatibility');
    expect(tree).toContain('moduleSupportsScope');
    expect(tree).toContain('scope.scopeType');
  });

  it('groups Business Role permissions by module instead of rendering a flat action list', () => {
    const editor = read('components/permissions/BusinessRoleEditor.tsx');

    expect(editor).toContain('buildBusinessRolePermissionGroups');
    expect(editor).toContain('selectedOnly');
    expect(editor).toContain('permissionSearch');
    expect(editor).toContain('expandedModules');
    expect(editor).toContain('quyền đã chọn');
    expect(editor).not.toContain('editableActions.map(action =>');
  });
});

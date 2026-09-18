import { describe, expect, it, vi } from 'vitest';
import {
  assignBusinessRole,
  getBusinessRoleAdminSnapshot,
  previewBusinessRoleAssignment,
  saveBusinessRole,
} from '../permissions/businessRoleAdminService';

describe('businessRoleAdminService', () => {
  it('loads the protected administration snapshot', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { generatedAt: '2026-09-16T00:00:00Z', templates: [] }, error: null });
    await expect(getBusinessRoleAdminSnapshot({ rpc })).resolves.toMatchObject({ templates: [] });
    expect(rpc).toHaveBeenCalledWith('get_business_role_admin_snapshot');
  });

  it('passes preview fingerprint and optimistic role version to assignment', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { roleTemplateId: 'r1', roleCode: 'TEST', roleVersion: 3, dynamic: false, futureActionPolicy: 'manual_review', assignmentScopeType: 'global', assignmentScopeId: '*', permissionCount: 1, sensitivePermissionCount: 0, businessApprovalPermissionCount: 0, permissions: [], hardDenies: [], warnings: [], fingerprint: 'fp1' }, error: null })
      .mockResolvedValueOnce({ data: { assignmentId: 'a1', assignedAt: '2026-09-16T00:00:00Z' }, error: null });
    const gateway = { rpc };
    const preview = await previewBusinessRoleAssignment({ targetUserId: 'u1', roleTemplateId: 'r1', scopeType: 'global', scopeId: '*' }, gateway);
    await assignBusinessRole({ targetUserId: 'u1', roleTemplateId: 'r1', expectedRoleVersion: preview.roleVersion, scopeType: 'global', scopeId: '*', reason: 'Approved business need', warningAcceptances: [], expectedPreviewFingerprint: preview.fingerprint }, gateway);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_expected_role_version: 3, p_expected_preview_fingerprint: 'fp1' });
  });

  it('maps stale template versions to a reload instruction', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '40001', message: 'AUTHORIZATION_STALE_ROLE_VERSION' } });
    await expect(saveBusinessRole({ roleTemplateId: 'r1', expectedRoleVersion: 1, code: 'TEST', name: 'Test role', items: [], reason: 'Concurrent edit check' }, { rpc }))
      .rejects.toThrow('Vui lòng tải lại');
  });
});

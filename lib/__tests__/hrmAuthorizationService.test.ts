import { describe, expect, it, vi } from 'vitest';
import {
  getUserHrmAuthorization,
  previewUserHrmBusinessRole,
  setUserHrmBusinessRole,
  type HrmAuthorizationRpcGateway,
} from '../hrmAuthorizationService';

const gateway = (data: unknown): HrmAuthorizationRpcGateway => ({
  rpc: vi.fn(async () => ({ data, error: null })),
});

describe('hrmAuthorizationService', () => {
  it('loads the governed HR authorization summary for one account', async () => {
    const client = gateway({
      targetUserId: 'user-1',
      systemRole: 'ADMIN',
      hrRole: 'HR_MANAGE',
      fingerprint: 'fingerprint-1',
      effectivePermissions: [],
      history: [],
    });

    const result = await getUserHrmAuthorization('user-1', client);

    expect(result.hrRole).toBe('HR_MANAGE');
    expect(client.rpc).toHaveBeenCalledWith('get_user_hr_authorization', {
      p_target_user_id: 'user-1',
    });
  });

  it('previews a role replacement with the server fingerprint', async () => {
    const client = gateway({
      targetRoleCode: 'HR',
      fingerprint: 'fingerprint-1',
      added: ['hrm.employee.view_sensitive'],
      removed: [],
      warnings: [],
      hardDenies: [],
    });

    const result = await previewUserHrmBusinessRole('user-2', 'HR', null, client);

    expect(result.added).toEqual(['hrm.employee.view_sensitive']);
    expect(client.rpc).toHaveBeenCalledWith('preview_user_hr_business_role', {
      p_target_user_id: 'user-2',
      p_target_role_code: 'HR',
      p_expires_at: null,
    });
  });

  it('rejects a short reason before applying an HR role change', async () => {
    const client = gateway({});

    await expect(setUserHrmBusinessRole({
      targetUserId: 'user-2',
      targetRoleCode: 'HR_MANAGE',
      expiresAt: null,
      reason: 'short',
      warningAcceptances: [],
      expectedFingerprint: 'fingerprint-1',
    }, client)).rejects.toThrow('ít nhất 10 ký tự');

    expect(client.rpc).not.toHaveBeenCalled();
  });
});

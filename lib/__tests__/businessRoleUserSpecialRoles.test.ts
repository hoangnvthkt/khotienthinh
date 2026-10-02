import { describe, expect, it, vi } from 'vitest';
import { getUserSpecialRoles } from '../permissions/businessRoleAdminService';

describe('getUserSpecialRoles', () => {
  it('maps the roles a person holds', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ assignmentId: 'a1', roleCode: 'HR', roleName: 'HR', scopeType: 'global', scopeId: '*', startsAt: '2026-09-28T00:00:00Z', expiresAt: null }],
      error: null,
    });
    const roles = await getUserSpecialRoles('user-1', { rpc });
    expect(rpc).toHaveBeenCalledWith('get_user_special_roles', { p_user_id: 'user-1' });
    expect(roles).toEqual([{
      assignmentId: 'a1', roleCode: 'HR', roleName: 'HR', scopeType: 'global', scopeId: '*',
      startsAt: '2026-09-28T00:00:00Z', expiresAt: undefined,
    }]);
  });

  it('fails loudly instead of showing "no roles" when the data is invalid', async () => {
    await expect(getUserSpecialRoles('user-1', { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }))
      .rejects.toThrow('không hợp lệ');
    await expect(getUserSpecialRoles('user-1', { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) }))
      .rejects.toBeTruthy();
  });
});

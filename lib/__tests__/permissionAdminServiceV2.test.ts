import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: mocks.rpc },
}));

import { updateUserAuthorizationV2 } from '../permissions/permissionAdminService';

describe('permissionAdminService Authorization V2 command', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('sends the approved profile fields and grants through one RPC', async () => {
    const receipt = {
      userId: 'user-1',
      updatedAt: '2026-09-10T03:00:00.000Z',
      activeGrantCount: 1,
      auditEventId: 'audit-1',
    };
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });

    await expect(updateUserAuthorizationV2({
      userId: 'user-1',
      profile: {
        name: 'Nguyen Van A',
        phone: null,
        avatar: 'avatar.png',
        managerId: 'manager-1',
        assignedWarehouseId: 'warehouse-1',
      },
      grants: [{
        id: 'grant-1',
        userId: 'user-1',
        permissionCode: 'analytics.export',
        scopeType: 'global',
        scopeId: '*',
        isActive: true,
      }],
      reason: 'Cap nhat pham vi cong viec',
      expectedUpdatedAt: '2026-09-10T02:00:00.000Z',
    })).resolves.toEqual(receipt);

    expect(mocks.rpc).toHaveBeenCalledWith('update_user_authorization_v2', {
      p_user_id: 'user-1',
      p_profile: {
        name: 'Nguyen Van A',
        phone: null,
        avatar: 'avatar.png',
        manager_id: 'manager-1',
        assigned_warehouse_id: 'warehouse-1',
      },
      p_grants: [{
        permission_code: 'analytics.export',
        scope_type: 'global',
        scope_id: '*',
        is_active: true,
        expires_at: null,
      }],
      p_reason: 'Cap nhat pham vi cong viec',
      p_expected_updated_at: '2026-09-10T02:00:00.000Z',
    });
  });

  it('requires a meaningful reason before calling Supabase', async () => {
    await expect(updateUserAuthorizationV2({
      userId: 'user-1', profile: {}, grants: [], reason: '   ',
      expectedUpdatedAt: '2026-09-10T02:00:00.000Z',
    })).rejects.toThrow('Lý do thay đổi phân quyền là bắt buộc.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps optimistic-lock conflicts to an actionable message', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'stale' } });
    await expect(updateUserAuthorizationV2({
      userId: 'user-1', profile: {}, grants: [], reason: 'Cap nhat theo yeu cau',
      expectedUpdatedAt: '2026-09-10T02:00:00.000Z',
    })).rejects.toThrow('Thông tin người dùng đã thay đổi. Vui lòng tải lại trước khi lưu.');
  });

  it('rejects direct grants that must come from managed templates', async () => {
    await expect(updateUserAuthorizationV2({
      userId: 'user-1', profile: {},
      grants: [{
        id: 'grant-1', userId: 'user-1', permissionCode: 'hrm.employee.view_sensitive',
        scopeType: 'global', scopeId: '*', isActive: true,
      }],
      reason: 'Cap nhat theo yeu cau', expectedUpdatedAt: '2026-09-10T02:00:00.000Z',
    })).rejects.toThrow('chỉ được cấp qua template HR hoặc HR Manage.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

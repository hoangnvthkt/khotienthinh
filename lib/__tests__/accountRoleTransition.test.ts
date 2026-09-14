import { describe, expect, it } from 'vitest';
import { Role } from '../../types';
import { changeUserAccountRoleV2 } from '../permissions/permissionAdminService';

describe('account role transition command', () => {
  it('sends a warehouse keeper transition with an explicit warehouse scope', async () => {
    let call: { name: string; args: Record<string, unknown> } | undefined;
    const receipt = await changeUserAccountRoleV2({
      userId: 'person-a', role: Role.WAREHOUSE_KEEPER, warehouseId: 'warehouse-a',
      expectedUpdatedAt: '2026-09-14T00:00:00Z', reason: 'Phân công phụ trách kho A',
    }, { rpc: async (name, args) => {
      call = { name, args };
      return { data: { userId: 'person-a', role: 'WAREHOUSE_KEEPER', updatedAt: 'later' }, error: null };
    } });
    expect(call).toEqual({ name: 'change_user_account_role_v2', args: {
      p_user_id: 'person-a', p_role: 'WAREHOUSE_KEEPER', p_warehouse_id: 'warehouse-a',
      p_expected_updated_at: '2026-09-14T00:00:00Z', p_reason: 'Phân công phụ trách kho A',
    } });
    expect(receipt.role).toBe(Role.WAREHOUSE_KEEPER);
  });

  it('requires an explicit warehouse or all-warehouses marker for keeper', async () => {
    await expect(changeUserAccountRoleV2({
      userId: 'person-a', role: Role.WAREHOUSE_KEEPER, warehouseId: '',
      expectedUpdatedAt: '2026-09-14T00:00:00Z', reason: 'Phân công tài khoản thủ kho',
    }, { rpc: async () => ({ data: null, error: null }) })).rejects.toThrow('phạm vi kho');
  });

  it('does not send a stale warehouse when changing to employee', async () => {
    let args: Record<string, unknown> = {};
    await changeUserAccountRoleV2({
      userId: 'person-a', role: Role.EMPLOYEE, warehouseId: 'warehouse-old',
      expectedUpdatedAt: '2026-09-14T00:00:00Z', reason: 'Chuyển về tài khoản nhân viên',
    }, { rpc: async (_name, payload) => {
      args = payload;
      return { data: { userId: 'person-a', role: 'EMPLOYEE', updatedAt: 'later' }, error: null };
    } });
    expect(args.p_warehouse_id).toBeNull();
  });

  it('rejects a short audit reason before calling the backend', async () => {
    let called = false;
    await expect(changeUserAccountRoleV2({
      userId: 'person-a', role: Role.ADMIN, warehouseId: null,
      expectedUpdatedAt: '2026-09-14T00:00:00Z', reason: 'admin',
    }, { rpc: async () => { called = true; return { data: null, error: null }; } })).rejects.toThrow('ít nhất 10');
    expect(called).toBe(false);
  });
});

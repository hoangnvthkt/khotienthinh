import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../types';
import { canManageContracts, contractManageCode, contractManageLockReason } from '../permissions/contractPermissions';

const user = (role: Role, codes: string[] = []): User => ({
  id: 'u1', name: 'A', email: 'a@example.com', role,
  permissionGrants: codes.map(permissionCode => ({
    userId: 'u1', permissionCode, scopeType: 'global', scopeId: '*', isActive: true,
  })),
} as User);

describe('contract manage permissions', () => {
  it('follows the same codes as the server', () => {
    expect(contractManageCode('partner')).toBe('contract.partner.manage');
    expect(contractManageCode('supplier')).toBe('contract.supplier.manage');
  });

  it('lets Admin manage and keeps view-only people out', () => {
    expect(canManageContracts(user(Role.ADMIN), 'customer')).toBe(true);
    expect(canManageContracts(user(Role.EMPLOYEE, ['contract.customer.view']), 'customer')).toBe(false);
    expect(canManageContracts(null, 'customer')).toBe(false);
  });

  it('explains where the missing permission is given', () => {
    expect(contractManageLockReason('supplier')).toContain('Hợp đồng nhà cung cấp');
    expect(contractManageLockReason('supplier')).toContain('Cài đặt → Người dùng');
  });
});

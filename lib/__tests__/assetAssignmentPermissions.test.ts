import { describe, expect, it } from 'vitest';
import { AssetStatus, Role, type Asset, type User } from '../../types';
import {
  canAssignAsset,
  canReturnAsset,
  canStartAssetAssignmentAction,
  canTransferAsset,
} from '../assetAssignmentPermissions';

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'asset-1',
  code: 'TS-001',
  name: 'Laptop',
  categoryId: 'category-1',
  status: AssetStatus.IN_USE,
  warehouseId: 'warehouse-1',
  managingDeptId: 'department-1',
  assignedToUserId: 'holder-1',
  assignedToName: 'Holder',
  originalValue: 1,
  purchaseDate: '2026-01-01',
  depreciationYears: 3,
  residualValue: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const user = (permissionCode: string, scopeType = 'global', scopeId = '*'): User => ({
  id: 'actor-1',
  name: 'Actor',
  email: 'actor@example.com',
  role: Role.EMPLOYEE,
  permissionGrants: [{
    id: 'grant-1',
    userId: 'actor-1',
    permissionCode,
    scopeType: scopeType as 'global',
    scopeId,
    isActive: true,
  }],
} as User);

describe('asset assignment capabilities', () => {
  it('keeps a view-only user read-only', () => {
    const viewer = user('asset.assignment.view');

    expect(canStartAssetAssignmentAction(viewer, 'assign', asset())).toBe(false);
    expect(canStartAssetAssignmentAction(viewer, 'return', asset())).toBe(false);
    expect(canStartAssetAssignmentAction(viewer, 'transfer', asset())).toBe(false);
    expect(canAssignAsset(viewer, asset(), 'target-1')).toBe(false);
    expect(canReturnAsset(viewer, asset())).toBe(false);
    expect(canTransferAsset(viewer, asset(), 'target-1')).toBe(false);
  });

  it('does not let one action capability imply another', () => {
    const assigner = user('asset.assignment.assign');

    expect(canAssignAsset(assigner, asset(), 'target-1')).toBe(true);
    expect(canReturnAsset(assigner, asset())).toBe(false);
    expect(canTransferAsset(assigner, asset(), 'target-1')).toBe(false);
  });

  it('matches warehouse and department scopes to the asset', () => {
    expect(canReturnAsset(user('asset.assignment.return', 'warehouse', 'warehouse-1'), asset())).toBe(true);
    expect(canReturnAsset(user('asset.assignment.return', 'warehouse', 'warehouse-2'), asset())).toBe(false);
    expect(canAssignAsset(user('asset.assignment.assign', 'department', 'department-1'), asset(), 'target-1')).toBe(true);
  });

  it('limits assigned scope to the actor and requires both sides for transfer', () => {
    const assignedReturner = user('asset.assignment.return', 'assigned', 'actor-1');
    const assignedTransfer = user('asset.assignment.transfer', 'assigned', 'actor-1');

    expect(canReturnAsset(assignedReturner, asset({ assignedToUserId: 'actor-1' }))).toBe(true);
    expect(canReturnAsset(assignedReturner, asset({ assignedToUserId: 'holder-1' }))).toBe(false);
    expect(canTransferAsset(assignedTransfer, asset({ assignedToUserId: 'actor-1' }), 'target-1')).toBe(false);
  });
});

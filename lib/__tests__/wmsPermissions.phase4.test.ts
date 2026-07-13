import { describe, expect, it } from 'vitest';
import { MaterialRequestFulfillmentMode, RequestStatus, Role, TransactionStatus, TransactionType, User } from '../../types';
import {
  canApproveMaterialRequest,
  canApproveWmsTransaction,
  canReceiveMaterialRequest,
  canReceiveWmsTransaction,
  canViewMaterialRequest,
  canViewWmsTransaction,
} from '../wmsPermissions';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  role: Role.EMPLOYEE,
  allowedModules: [],
  adminModules: [],
  allowedSubModules: {},
  adminSubModules: {},
  permissionGrants: [],
  ...overrides,
});

const tx = {
  id: 'tx-1',
  type: TransactionType.TRANSFER,
  date: '2026-07-13',
  status: TransactionStatus.PENDING,
  items: [],
  sourceWarehouseId: 'wh-source',
  targetWarehouseId: 'wh-target',
  requesterId: 'requester-1',
} as any;

const request = {
  id: 'req-1',
  code: 'REQ-1',
  requesterId: 'requester-1',
  status: RequestStatus.APPROVED,
  items: [],
  sourceWarehouseId: 'wh-source',
  siteWarehouseId: 'wh-target',
  fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
} as any;

describe('Phase 4 WMS permission adapter', () => {
  it('allows explicit warehouse-scoped transaction grants before legacy role checks', () => {
    const granted = user({
      permissionGrants: [{
        id: 'grant-1',
        userId: 'user-1',
        permissionCode: 'wms.transaction.approve',
        scopeType: 'warehouse',
        scopeId: 'wh-source',
        isActive: true,
      }],
    });

    expect(canApproveWmsTransaction(granted, tx)).toBe(true);
    expect(canReceiveWmsTransaction(granted, tx)).toBe(false);
  });

  it('matches WMS receive permissions against the target warehouse', () => {
    const granted = user({
      permissionGrants: [{
        id: 'grant-1',
        userId: 'user-1',
        permissionCode: 'wms.transaction.complete',
        scopeType: 'warehouse',
        scopeId: 'wh-target',
        isActive: true,
      }],
    });

    expect(canReceiveWmsTransaction(granted, tx)).toBe(true);
    expect(canApproveWmsTransaction(granted, tx)).toBe(false);
  });

  it('does not let request view/create grants approve or receive material requests', () => {
    const granted = user({
      permissionGrants: [
        {
          id: 'view',
          userId: 'user-1',
          permissionCode: 'wms.request.view',
          scopeType: 'warehouse',
          scopeId: 'wh-source',
          isActive: true,
        },
        {
          id: 'create',
          userId: 'user-1',
          permissionCode: 'wms.request.create',
          scopeType: 'global',
          scopeId: '*',
          isActive: true,
        },
      ],
    });

    expect(canViewMaterialRequest(granted, request)).toBe(true);
    expect(canApproveMaterialRequest(granted, request)).toBe(false);
    expect(canReceiveMaterialRequest(granted, { ...request, status: RequestStatus.IN_TRANSIT })).toBe(false);
  });

  it('still keeps legacy warehouse keeper fallback during the transition', () => {
    const keeper = user({
      role: Role.WAREHOUSE_KEEPER,
      assignedWarehouseId: 'wh-source',
    });

    expect(canViewWmsTransaction(keeper, tx)).toBe(true);
    expect(canApproveWmsTransaction(keeper, tx)).toBe(true);
  });
});

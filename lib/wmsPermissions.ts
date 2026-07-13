import { MaterialRequest, MaterialRequestFulfillmentMode, RequestStatus, Role, Transaction, TransactionType, User } from '../types';
import { canPerform } from './permissions/permissionService';

const hasWmsPermission = (user: User, permissionCode: string, scopes: Array<{ scopeType: 'global' | 'warehouse' | 'own' | 'assigned'; scopeId: string | undefined }>): boolean =>
  scopes.some(scope => canPerform(user, permissionCode, {
    scopeType: scope.scopeType,
    scopeId: scope.scopeId || '*',
  }));

const wmsScopes = (warehouseIds: Array<string | undefined>, userId?: string): Array<{ scopeType: 'global' | 'warehouse' | 'own' | 'assigned'; scopeId: string | undefined }> => [
  { scopeType: 'global', scopeId: '*' },
  ...(userId ? [{ scopeType: 'own' as const, scopeId: userId }] : []),
  ...warehouseIds.filter(Boolean).map(warehouseId => ({ scopeType: 'warehouse' as const, scopeId: warehouseId })),
];

const canUseWmsTransactionPermission = (user: User, tx: Transaction, permissionCode: string, warehouseIds: Array<string | undefined>): boolean =>
  hasWmsPermission(user, permissionCode, wmsScopes(warehouseIds, tx.requesterId));

const canUseWmsRequestPermission = (user: User, request: MaterialRequest, permissionCode: string, warehouseIds: Array<string | undefined>): boolean =>
  hasWmsPermission(user, permissionCode, wmsScopes(warehouseIds, request.requesterId));

export const isAdmin = (user: User): boolean => user.role === Role.ADMIN;

export const isWarehouseKeeper = (user: User): boolean => user.role === Role.WAREHOUSE_KEEPER;

export const isGlobalWarehouseKeeper = (user: User): boolean =>
  isWarehouseKeeper(user) && !user.assignedWarehouseId;

export const isWarehouseKeeperFor = (user: User, warehouseId?: string): boolean =>
  isWarehouseKeeper(user) && !!warehouseId && user.assignedWarehouseId === warehouseId;

export const isFulfillmentBatchTransaction = (tx: Transaction): boolean =>
  (tx.items || []).some(item => !!item.fulfillmentBatchId);

export const canApproveWmsTransaction = (user: User, tx: Transaction): boolean => {
  const approvalWarehouses = tx.type === TransactionType.IMPORT
    ? [tx.targetWarehouseId]
    : tx.type === TransactionType.TRANSFER && isFulfillmentBatchTransaction(tx) && tx.targetWarehouseId
      ? [tx.targetWarehouseId]
      : [tx.sourceWarehouseId];
  if (canUseWmsTransactionPermission(user, tx, 'wms.transaction.approve', approvalWarehouses)) return true;
  if (isAdmin(user)) return true;
  if (isGlobalWarehouseKeeper(user)) return true;
  if (!isWarehouseKeeper(user)) return false;

  if (tx.type === TransactionType.IMPORT) return isWarehouseKeeperFor(user, tx.targetWarehouseId);
  if (tx.type === TransactionType.TRANSFER) {
    if (isFulfillmentBatchTransaction(tx) && tx.targetWarehouseId) {
      return isWarehouseKeeperFor(user, tx.targetWarehouseId);
    }
    return isWarehouseKeeperFor(user, tx.sourceWarehouseId);
  }
  if (tx.type === TransactionType.EXPORT || tx.type === TransactionType.LIQUIDATION) {
    return isWarehouseKeeperFor(user, tx.sourceWarehouseId);
  }
  return false;
};

export const canReceiveWmsTransaction = (user: User, tx: Transaction): boolean => {
  const completionWarehouses = tx.type === TransactionType.IMPORT || tx.type === TransactionType.TRANSFER
    ? [tx.targetWarehouseId]
    : [tx.sourceWarehouseId];
  if (canUseWmsTransactionPermission(user, tx, 'wms.transaction.complete', completionWarehouses)) return true;
  if (isAdmin(user)) return true;
  if (isGlobalWarehouseKeeper(user)) return true;
  if (!isWarehouseKeeper(user)) return false;

  if (tx.type === TransactionType.IMPORT || tx.type === TransactionType.TRANSFER) {
    return isWarehouseKeeperFor(user, tx.targetWarehouseId);
  }
  if (tx.type === TransactionType.EXPORT || tx.type === TransactionType.LIQUIDATION) {
    return isWarehouseKeeperFor(user, tx.sourceWarehouseId);
  }
  return false;
};

export const canViewWmsTransaction = (user: User, tx: Transaction): boolean => {
  if (canUseWmsTransactionPermission(user, tx, 'wms.transaction.view', [tx.sourceWarehouseId, tx.targetWarehouseId])) return true;
  if (isAdmin(user)) return true;
  if (tx.requesterId === user.id) return true;
  if (isGlobalWarehouseKeeper(user)) return true;
  if (!isWarehouseKeeper(user)) return false;
  return user.assignedWarehouseId === tx.sourceWarehouseId || user.assignedWarehouseId === tx.targetWarehouseId;
};

export const canApproveMaterialRequest = (user: User, request: MaterialRequest): boolean =>
  canUseWmsRequestPermission(user, request, 'wms.request.approve', [request.sourceWarehouseId])
  || isAdmin(user) || isGlobalWarehouseKeeper(user) || isWarehouseKeeperFor(user, request.sourceWarehouseId);

export const canExportMaterialRequest = (user: User, request: MaterialRequest): boolean =>
  request.status === RequestStatus.APPROVED
  && !!request.sourceWarehouseId
  && (
    canUseWmsRequestPermission(user, request, 'wms.request.export', [request.sourceWarehouseId])
    || canApproveMaterialRequest(user, request)
  );

export const canReceiveMaterialRequest = (user: User, request: MaterialRequest): boolean => {
  if (request.status !== RequestStatus.IN_TRANSIT) return false;
  if (canUseWmsRequestPermission(user, request, 'wms.request.receive', [request.siteWarehouseId, request.sourceWarehouseId])) return true;
  if (isAdmin(user)) return true;
  if (isGlobalWarehouseKeeper(user)) return true;
  if (request.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION) {
    return isWarehouseKeeperFor(user, request.sourceWarehouseId) || isWarehouseKeeperFor(user, request.siteWarehouseId);
  }
  return isWarehouseKeeperFor(user, request.siteWarehouseId);
};

export const canViewMaterialRequest = (user: User, request: MaterialRequest): boolean => {
  if (canUseWmsRequestPermission(user, request, 'wms.request.view', [request.sourceWarehouseId, request.siteWarehouseId])) return true;
  if (isAdmin(user)) return true;
  if (request.requesterId === user.id) return true;
  if (isGlobalWarehouseKeeper(user)) return true;
  if (request.requestOrigin === 'project' || request.projectId) return true;
  if (!isWarehouseKeeper(user)) return false;
  return user.assignedWarehouseId === request.sourceWarehouseId || user.assignedWarehouseId === request.siteWarehouseId;
};

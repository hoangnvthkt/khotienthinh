import { MaterialRequest, MaterialRequestFulfillmentMode, RequestStatus, Role, Transaction, TransactionType, User, Warehouse } from '../types';
import { evaluateCapability } from './permissions/authorizationEvaluator';
import { canPerform, getUserAuthorizationSnapshot } from './permissions/permissionService';

type WmsWarehouseGrantScope = 'global' | 'warehouse';

export type WmsWarehouseAccess = {
  canViewAll: boolean;
  warehouseIds: string[];
};

const isActiveGrant = (grant: NonNullable<User['permissionGrants']>[number], now = new Date()): boolean =>
  grant.isActive !== false && (!grant.expiresAt || new Date(grant.expiresAt).getTime() > now.getTime());

const hasExplicitWmsGrant = (
  user: User,
  permissionCode: string,
  scopeType: WmsWarehouseGrantScope,
  scopeId: string,
): boolean =>
  Boolean(user.permissionGrants?.some(grant =>
    grant.permissionCode === permissionCode &&
    grant.scopeType === scopeType &&
    (grant.scopeId === '*' || grant.scopeId === scopeId) &&
    isActiveGrant(grant)
  ));

const getActiveWarehouseIds = (warehouses: Warehouse[]): string[] =>
  warehouses.filter(warehouse => !warehouse.isArchived).map(warehouse => warehouse.id);

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

// V1-2 Module Vật tư: thủ kho theo ô quyền "Giao dịch kho → Thủ kho" (wms.transaction.keeper) theo từng kho,
// không còn theo vai trò tài khoản + một kho được gán (khớp app_private.wms_user_is_keeper).
const KEEPER_CODE = 'wms.transaction.keeper';
const EXCEPTION_CODE = 'wms.transaction.exception_approve';

/** Các kho người dùng là thủ kho (ô Thủ kho theo kho). */
export const getKeeperWarehouseIds = (user: User): string[] => [...new Set((user.permissionGrants || [])
  .filter(grant => grant.permissionCode === KEEPER_CODE && grant.scopeType === 'warehouse' && grant.scopeId && grant.scopeId !== '*' && isActiveGrant(grant))
  .map(grant => grant.scopeId as string))];

export const isGlobalWarehouseKeeper = (user: User): boolean =>
  hasExplicitWmsGrant(user, KEEPER_CODE, 'global', '*') || hasExplicitWmsGrant(user, KEEPER_CODE, 'warehouse', '*');

export const isWarehouseKeeper = (user: User): boolean =>
  isGlobalWarehouseKeeper(user) || getKeeperWarehouseIds(user).length > 0;

export const isWarehouseKeeperFor = (user: User, warehouseId?: string): boolean =>
  !!warehouseId && (isGlobalWarehouseKeeper(user) || getKeeperWarehouseIds(user).includes(warehouseId));

/** Duyệt ngoại lệ (xuất hủy, điều chỉnh, chênh lệch kiểm kê). Admin luôn có. */
export const canApproveWmsException = (user: User, warehouseId?: string): boolean =>
  isAdmin(user) || hasExplicitWmsGrant(user, EXCEPTION_CODE, 'global', '*')
  || (!!warehouseId && hasExplicitWmsGrant(user, EXCEPTION_CODE, 'warehouse', warehouseId));

const isExceptionTransaction = (tx: Transaction): boolean =>
  tx.type === TransactionType.LIQUIDATION || String(tx.type) === 'ADJUSTMENT';

export const getWmsWarehouseAccess = (
  user: User,
  warehouses: Warehouse[],
  permissionCode = 'wms.transaction.view',
): WmsWarehouseAccess => {
  const activeWarehouseIds = getActiveWarehouseIds(warehouses);
  const activeWarehouseSet = new Set(activeWarehouseIds);

  if (
    isAdmin(user) ||
    isGlobalWarehouseKeeper(user) ||
    hasExplicitWmsGrant(user, permissionCode, 'global', '*') ||
    hasExplicitWmsGrant(user, permissionCode, 'warehouse', '*')
  ) {
    return { canViewAll: true, warehouseIds: activeWarehouseIds };
  }

  const visibleWarehouseIds = new Set<string>(getKeeperWarehouseIds(user));
  user.permissionGrants?.forEach(grant => {
    if (
      grant.permissionCode === permissionCode &&
      grant.scopeType === 'warehouse' &&
      grant.scopeId &&
      grant.scopeId !== '*' &&
      isActiveGrant(grant)
    ) {
      visibleWarehouseIds.add(grant.scopeId);
    }
  });

  const orderedIds = activeWarehouseIds.filter(id => visibleWarehouseIds.has(id));
  visibleWarehouseIds.forEach(id => {
    if (!activeWarehouseSet.has(id)) orderedIds.push(id);
  });

  const coversEveryWarehouse = activeWarehouseIds.length > 0 && activeWarehouseIds.every(id => visibleWarehouseIds.has(id));
  return {
    canViewAll: coversEveryWarehouse,
    warehouseIds: coversEveryWarehouse ? activeWarehouseIds : orderedIds,
  };
};

export const getDefaultWmsWarehouseFilter = (
  user: User,
  warehouses: Warehouse[],
  permissionCode = 'wms.transaction.view',
): string => {
  const access = getWmsWarehouseAccess(user, warehouses, permissionCode);
  // Thủ kho đúng một kho: mặc định mở kho của mình.
  const keeperWarehouses = getKeeperWarehouseIds(user).filter(id => access.warehouseIds.includes(id));
  if (keeperWarehouses.length === 1 && !isGlobalWarehouseKeeper(user)) return keeperWarehouses[0];
  if (access.canViewAll) return 'ALL';
  return access.warehouseIds[0] || user.assignedWarehouseId || 'ALL';
};

export const isFulfillmentBatchTransaction = (tx: Transaction): boolean =>
  (tx.items || []).some(item => !!item.fulfillmentBatchId);

export const canApproveWmsTransaction = (user: User, tx: Transaction): boolean => {
  // Xuất hủy / điều chỉnh: chỉ người Duyệt ngoại lệ, và khác người lập (tách nhiệm, cả Admin).
  if (isExceptionTransaction(tx)) return tx.requesterId !== user.id && canApproveWmsException(user, tx.sourceWarehouseId || tx.targetWarehouseId);
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
  if (isExceptionTransaction(tx) && canApproveWmsException(user, tx.sourceWarehouseId || tx.targetWarehouseId)) return true;
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

export const canReverseWmsTransaction = (
  user: User,
  sourceWarehouseId: string,
): boolean => {
  const snapshot = getUserAuthorizationSnapshot(user);
  if (!snapshot) return false;

  return evaluateCapability({
    ...snapshot,
    sources: snapshot.sources.filter(source => source.sourceType.toUpperCase() !== 'LEGACY'),
  }, 'wms.transaction.reverse', {
    scopeType: 'warehouse',
    scopeId: sourceWarehouseId,
  }).allowed;
};

export const canViewWmsTransaction = (user: User, tx: Transaction): boolean => {
  if (canUseWmsTransactionPermission(user, tx, 'wms.transaction.view', [tx.sourceWarehouseId, tx.targetWarehouseId])) return true;
  if (isAdmin(user)) return true;
  if (tx.requesterId === user.id) return true;
  if (isGlobalWarehouseKeeper(user)) return true;
  return isWarehouseKeeperFor(user, tx.sourceWarehouseId) || isWarehouseKeeperFor(user, tx.targetWarehouseId);
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
  return isWarehouseKeeperFor(user, request.sourceWarehouseId) || isWarehouseKeeperFor(user, request.siteWarehouseId);
};

export const canDeleteWmsMaterialRequest = (user: User, request: MaterialRequest): boolean => {
  if (request.requestOrigin === 'project') return false;
  if (![RequestStatus.DRAFT, RequestStatus.PENDING, RequestStatus.REJECTED].includes(request.status)) return false;
  if (isAdmin(user)) return true;
  if (
    request.requesterId === user.id
    && [RequestStatus.DRAFT, RequestStatus.REJECTED].includes(request.status)
  ) return true;
  return canUseWmsRequestPermission(
    user,
    request,
    'wms.request.delete',
    [request.sourceWarehouseId, request.siteWarehouseId],
  );
};

import { MaterialRequest, MaterialRequestFulfillmentMode, RequestStatus, Role, Transaction, TransactionType, User } from '../types';

export const isAdmin = (user: User): boolean => user.role === Role.ADMIN;

export const isWarehouseKeeper = (user: User): boolean => user.role === Role.WAREHOUSE_KEEPER;

export const isWarehouseKeeperFor = (user: User, warehouseId?: string): boolean =>
  isWarehouseKeeper(user) && !!warehouseId && user.assignedWarehouseId === warehouseId;

export const canApproveWmsTransaction = (user: User, tx: Transaction): boolean => {
  if (isAdmin(user)) return true;
  if (!isWarehouseKeeper(user)) return false;

  if (tx.type === TransactionType.IMPORT) return isWarehouseKeeperFor(user, tx.targetWarehouseId);
  if (tx.type === TransactionType.TRANSFER) return isWarehouseKeeperFor(user, tx.sourceWarehouseId);
  if (tx.type === TransactionType.EXPORT || tx.type === TransactionType.LIQUIDATION) {
    return isWarehouseKeeperFor(user, tx.sourceWarehouseId);
  }
  return false;
};

export const canReceiveWmsTransaction = (user: User, tx: Transaction): boolean => {
  if (isAdmin(user)) return true;
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
  if (isAdmin(user)) return true;
  if (tx.requesterId === user.id) return true;
  if (!isWarehouseKeeper(user)) return false;
  return user.assignedWarehouseId === tx.sourceWarehouseId || user.assignedWarehouseId === tx.targetWarehouseId;
};

export const canApproveMaterialRequest = (user: User, request: MaterialRequest): boolean =>
  isAdmin(user) || isWarehouseKeeperFor(user, request.sourceWarehouseId);

export const canExportMaterialRequest = (user: User, request: MaterialRequest): boolean =>
  request.status === RequestStatus.APPROVED && canApproveMaterialRequest(user, request);

export const canReceiveMaterialRequest = (user: User, request: MaterialRequest): boolean => {
  if (request.status !== RequestStatus.IN_TRANSIT) return false;
  if (isAdmin(user)) return true;
  if (request.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION) {
    return isWarehouseKeeperFor(user, request.sourceWarehouseId);
  }
  return isWarehouseKeeperFor(user, request.siteWarehouseId);
};

export const canViewMaterialRequest = (user: User, request: MaterialRequest): boolean => {
  if (isAdmin(user)) return true;
  if (request.requesterId === user.id) return true;
  if (!isWarehouseKeeper(user)) return false;
  return user.assignedWarehouseId === request.sourceWarehouseId || user.assignedWarehouseId === request.siteWarehouseId;
};

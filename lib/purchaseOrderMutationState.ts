import {
  MaterialRequestFulfillmentBatch,
  PurchaseOrder,
  PurchaseOrderDeliveryBatch,
  PurchaseOrderSupplierReturn,
  User,
} from '../types';
import { isAdmin } from './wmsPermissions';

const PENDING_FULFILLMENT_STATUSES = new Set(['issued', 'variance_pending']);
const LOCKED_SCHEDULE_STATUSES = new Set(['wms_pending']);
const FAILED_SCHEDULE_STATUSES = new Set(['cancelled']);

export type PurchaseOrderMutationCapabilities = {
  canEditPo?: boolean;
  canDeletePo?: boolean;
};

const hasAnyReceivedQty = (batch: MaterialRequestFulfillmentBatch): boolean =>
  (batch.lines || []).some(line => Number(line.receivedQty || 0) > 0);

const isFailedBeforeReceiptFulfillment = (batch: MaterialRequestFulfillmentBatch): boolean => {
  const status = String(batch.status || '').toLowerCase();
  if (status === 'cancelled') return !hasAnyReceivedQty(batch);
  if (status === 'returned') return !hasAnyReceivedQty(batch);
  return false;
};

export const getPurchaseOrderCreatorId = (po?: PurchaseOrder | null): string | null => {
  if (!po) return null;
  const row = po as PurchaseOrder & {
    createdById?: string | null;
    createdBy?: string | null;
  };
  return row.createdById || row.createdBy || null;
};

export const isPurchaseOrderCreator = (po: PurchaseOrder, user?: User | null): boolean => {
  const creatorId = getPurchaseOrderCreatorId(po);
  if (!creatorId || !user) return false;
  return creatorId === user.id || creatorId === user.authId;
};

export const canUserMutatePurchaseOrder = (
  po: PurchaseOrder,
  user?: User | null,
  capabilities: PurchaseOrderMutationCapabilities = {},
): boolean => {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const usesProjectRoomContract = Object.prototype.hasOwnProperty.call(capabilities, 'canEditPo');
  if (!usesProjectRoomContract) return isPurchaseOrderCreator(po, user);
  return Boolean(
    capabilities.canEditPo
    && isPurchaseOrderCreator(po, user)
    && ['draft', 'returned'].includes(po.status),
  );
};

export const canUserRemovePurchaseOrder = (
  po: PurchaseOrder,
  user?: User | null,
  capabilities: PurchaseOrderMutationCapabilities = {},
): boolean => {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const usesProjectRoomContract = Object.prototype.hasOwnProperty.call(capabilities, 'canDeletePo');
  if (!usesProjectRoomContract) return isPurchaseOrderCreator(po, user);
  return Boolean(capabilities.canDeletePo && isPurchaseOrderCreator(po, user));
};

export const purchaseOrderHasStockImpact = (
  po: PurchaseOrder,
  supplierReturns: PurchaseOrderSupplierReturn[] = [],
): boolean => {
  const hasReceivedQty = po.items.some(item => Number(item.receivedQty || 0) > 0 || Number(item.returnedQty || 0) > 0);
  const hasReceiptTransactions = (po.receivedTransactionIds || []).length > 0;
  const hasCompletedSupplierReturn = supplierReturns.some(item => item.status === 'completed');
  return hasReceivedQty || hasReceiptTransactions || hasCompletedSupplierReturn;
};

export const summarizePurchaseOrderWork = (
  po: PurchaseOrder,
  fulfillmentBatches: MaterialRequestFulfillmentBatch[] = [],
  scheduleBatches: PurchaseOrderDeliveryBatch[] = [],
) => {
  const relevantFulfillmentBatches = fulfillmentBatches
    .map(batch => ({
      ...batch,
      lines: (batch.lines || []).filter(line => line.poId === po.id),
    }))
    .filter(batch => batch.lines.length > 0);

  const hasPendingFulfillment = relevantFulfillmentBatches.some(batch =>
    PENDING_FULFILLMENT_STATUSES.has(String(batch.status || '').toLowerCase())
  );
  const hasReceivedFulfillment = relevantFulfillmentBatches.some(batch =>
    batch.status === 'received' || hasAnyReceivedQty(batch)
  );
  const hasRejectedFulfillment = relevantFulfillmentBatches.some(batch =>
    isFailedBeforeReceiptFulfillment(batch)
  );
  const hasFailedFulfillment = relevantFulfillmentBatches.some(batch =>
    isFailedBeforeReceiptFulfillment(batch)
  );
  const hasLockedSchedule = scheduleBatches.some(batch =>
    LOCKED_SCHEDULE_STATUSES.has(String(batch.status || '').toLowerCase())
  );
  const hasFailedSchedule = scheduleBatches.some(batch =>
    FAILED_SCHEDULE_STATUSES.has(String(batch.status || '').toLowerCase())
  );

  return {
    fulfillmentCount: relevantFulfillmentBatches.length,
    hasPendingFulfillment,
    hasReceivedFulfillment,
    hasRejectedFulfillment,
    hasFailedFulfillment,
    hasLockedSchedule,
    hasFailedSchedule,
    hasPendingWork: hasPendingFulfillment || hasLockedSchedule,
    hasFailedDeliveryWork: hasFailedFulfillment || hasFailedSchedule,
    isRejectedBeforeReceipt: po.status === 'in_transit'
      && relevantFulfillmentBatches.length > 0
      && hasRejectedFulfillment
      && !hasPendingFulfillment
      && !hasReceivedFulfillment
      && !hasLockedSchedule
      && !po.items.some(item => Number(item.receivedQty || 0) > 0)
      && (po.receivedTransactionIds || []).length === 0,
  };
};

export const getPurchaseOrderRemovalBlockReason = (
  po: PurchaseOrder,
  user?: User | null,
  fulfillmentBatches: MaterialRequestFulfillmentBatch[] = [],
  scheduleBatches: PurchaseOrderDeliveryBatch[] = [],
  _supplierReturns: PurchaseOrderSupplierReturn[] = [],
  capabilities: PurchaseOrderMutationCapabilities = {},
): string | null => {
  if (!canUserRemovePurchaseOrder(po, user, capabilities)) {
    return 'Bạn phải là người tạo PO và có quyền Xóa trong Room Đơn hàng PO để xoá/lưu trữ phiếu này.';
  }
  const work = summarizePurchaseOrderWork(po, fulfillmentBatches, scheduleBatches);
  if (work.hasPendingWork) {
    return 'PO đang có đợt giao/giao dịch chờ xử lý. Vui lòng huỷ hoặc xử lý xong trước.';
  }
  if (work.hasFailedDeliveryWork) {
    return 'PO còn đợt giao bị từ chối. Vui lòng xoá các đợt giao thất bại trước khi xoá PO.';
  }
  return null;
};

export const getPurchaseOrderEditBlockReason = (
  po: PurchaseOrder,
  user?: User | null,
  fulfillmentBatches: MaterialRequestFulfillmentBatch[] = [],
  scheduleBatches: PurchaseOrderDeliveryBatch[] = [],
  _supplierReturns: PurchaseOrderSupplierReturn[] = [],
  capabilities: PurchaseOrderMutationCapabilities = {},
): string | null => {
  if (!canUserMutatePurchaseOrder(po, user, capabilities)) {
    return 'Bạn phải là người tạo PO, có quyền Sửa trong Room Đơn hàng PO và PO đang ở trạng thái Nháp/Trả lại.';
  }
  const work = summarizePurchaseOrderWork(po, fulfillmentBatches, scheduleBatches);
  if (work.hasPendingWork) {
    return 'PO đang có đợt giao/giao dịch chờ xử lý. Vui lòng huỷ hoặc xử lý xong trước.';
  }
  if (work.hasFailedDeliveryWork) {
    return 'PO còn đợt giao bị từ chối. Vui lòng xoá các đợt giao thất bại trước khi sửa PO.';
  }
  return null;
};

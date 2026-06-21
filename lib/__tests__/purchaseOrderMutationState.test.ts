import { describe, expect, it } from 'vitest';
import { Role, PurchaseOrder, MaterialRequestFulfillmentBatch, User, MaterialRequestFulfillmentMode, PurchaseOrderDeliveryBatch } from '../../types';
import {
  canUserMutatePurchaseOrder,
  getPurchaseOrderRemovalBlockReason,
  summarizePurchaseOrderWork,
} from '../purchaseOrderMutationState';

const user = (id: string, role: Role = Role.EMPLOYEE): User => ({
  id,
  name: id,
  email: `${id}@example.test`,
  role,
});

const po = (patch: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po-1',
  projectId: null,
  constructionSiteId: null,
  vendorId: 'vendor-1',
  vendorName: 'NCC',
  poNumber: 'PO-017',
  items: [{
    lineId: 'line-1',
    itemId: 'item-1',
    sku: 'VT-1',
    name: 'Vật tư',
    unit: 'Kg',
    qty: 100,
    unitPrice: 1,
  }],
  totalAmount: 100,
  orderDate: '2026-06-21',
  status: 'in_transit',
  sourceMode: 'company_consolidated',
  createdById: 'creator-1',
  createdAt: '2026-06-21T00:00:00.000Z',
  ...patch,
});

const fulfillmentBatch = (status: MaterialRequestFulfillmentBatch['status']): MaterialRequestFulfillmentBatch => ({
  id: `batch-${status}`,
  materialRequestId: 'mr-1',
  batchNo: `B-${status}`,
  batchDate: '2026-06-21T00:00:00.000Z',
  fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
  sourceType: 'po_receipt',
  status,
  lines: [{
    id: `line-${status}`,
    batchId: `batch-${status}`,
    materialRequestId: 'mr-1',
    requestLineId: 'req-line-1',
    itemId: 'item-1',
    poId: 'po-1',
    poLineId: 'line-1',
    requestedQtySnapshot: 100,
    committedQtySnapshot: 100,
    issuedQty: 100,
    receivedQty: 0,
  }],
});

const fulfillmentBatchWithReceipt = (
  status: MaterialRequestFulfillmentBatch['status'],
  receivedQty = 25,
): MaterialRequestFulfillmentBatch => ({
  ...fulfillmentBatch(status),
  lines: [{
    ...fulfillmentBatch(status).lines[0],
    receivedQty,
  }],
});

const deliveryBatch = (status: PurchaseOrderDeliveryBatch['status']): PurchaseOrderDeliveryBatch => ({
  id: `delivery-${status}`,
  purchaseOrderId: 'po-1',
  deliveryNo: 1,
  status,
  lines: [],
});

describe('purchaseOrderMutationState', () => {
  it('allows admin and creator to mutate purchase orders', () => {
    const item = po();

    expect(canUserMutatePurchaseOrder(item, user('admin-1', Role.ADMIN))).toBe(true);
    expect(canUserMutatePurchaseOrder(item, user('creator-1'))).toBe(true);
    expect(canUserMutatePurchaseOrder(item, user('other-1'))).toBe(false);
  });

  it('marks cancelled/legacy-returned in-transit PO before receipt and blocks parent removal until failed delivery is deleted', () => {
    const item = po();
    const summary = summarizePurchaseOrderWork(item, [
      fulfillmentBatch('cancelled'),
      fulfillmentBatch('returned'),
    ]);

    expect(summary.isRejectedBeforeReceipt).toBe(true);
    expect(summary.hasPendingWork).toBe(false);
    expect(summary.hasFailedDeliveryWork).toBe(true);
    expect(getPurchaseOrderRemovalBlockReason(item, user('creator-1'), [
      fulfillmentBatch('cancelled'),
    ])).toContain('đợt giao bị từ chối');
  });

  it('does not treat returned batches with receipt as rejected before receipt', () => {
    const item = po({
      items: [{
        ...po().items[0],
        receivedQty: 25,
        returnedQty: 25,
      }],
      receivedTransactionIds: ['tx-1'],
    });
    const summary = summarizePurchaseOrderWork(item, [
      fulfillmentBatchWithReceipt('returned'),
    ]);

    expect(summary.hasRejectedFulfillment).toBe(false);
    expect(summary.hasFailedDeliveryWork).toBe(false);
    expect(summary.isRejectedBeforeReceipt).toBe(false);
  });

  it('treats cancelled schedule as failed work without marking it pending', () => {
    const item = po();
    const summary = summarizePurchaseOrderWork(item, [], [deliveryBatch('cancelled')]);

    expect(summary.hasPendingWork).toBe(false);
    expect(summary.hasFailedDeliveryWork).toBe(true);
    expect(getPurchaseOrderRemovalBlockReason(item, user('creator-1'), [], [
      deliveryBatch('cancelled'),
    ])).toContain('đợt giao bị từ chối');
  });

  it('blocks removal while fulfillment is pending', () => {
    const item = po();
    const reason = getPurchaseOrderRemovalBlockReason(item, user('creator-1'), [
      fulfillmentBatch('issued'),
    ]);

    expect(reason).toContain('chờ xử lý');
  });
});

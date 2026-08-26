import { describe, expect, it } from 'vitest';
import { TransactionStatus, TransactionType, type Transaction } from '../../types';
import {
  PURCHASE_DELIVERY_QR_PARAM,
  buildPurchaseDeliveryReceiveUrl,
  extractPurchaseDeliveryToken,
} from '../purchaseDeliveryQr';
import { buildPurchaseReceiptQualityPayloadFromTransaction, getPurchaseReceiptStep } from '../purchaseReceiptWorkflow';

describe('purchase receipt workflow', () => {
  it('keeps purchase delivery receipt steps separate', () => {
    expect(getPurchaseReceiptStep(TransactionStatus.PENDING, 'po_delivery_batch')).toBe('quality');
    expect(getPurchaseReceiptStep(TransactionStatus.APPROVED, 'po_delivery_batch')).toBe('confirm');
    expect(getPurchaseReceiptStep(TransactionStatus.COMPLETED, 'po_delivery_batch')).toBe('completed');
  });

  it('extracts purchase delivery QR tokens from urls and raw scans', () => {
    expect(PURCHASE_DELIVERY_QR_PARAM).toBe('deliveryToken');
    expect(extractPurchaseDeliveryToken('https://vioo.vn/#/inventory?deliveryToken=pod_123')).toBe('pod_123');
    expect(extractPurchaseDeliveryToken('pod_123')).toBe('pod_123');
    expect(buildPurchaseDeliveryReceiveUrl('pod_123')).toContain('deliveryToken=pod_123');
  });

  it('builds quality payload from purchase delivery WMS transaction drafts', () => {
    const transaction: Transaction = {
      id: 'tx-1',
      type: TransactionType.IMPORT,
      date: '2026-07-26T00:00:00.000Z',
      requesterId: 'user-1',
      status: TransactionStatus.PENDING,
      sourceType: 'po_delivery_batch',
      sourceId: 'delivery-1',
      items: [
        {
          itemId: 'item-1',
          quantity: 20,
          orderedQty: 20,
          accountingQty: 10,
          purchaseOrderDeliveryLineId: 'delivery-line-1',
        },
        {
          itemId: 'item-2',
          quantity: 5,
          orderedQty: 8,
          purchaseOrderDeliveryLineId: 'delivery-line-2',
        },
      ],
    };

    const payload = buildPurchaseReceiptQualityPayloadFromTransaction(transaction, [
      { index: 0, quantity: 16, reason: 'Thiếu hàng' },
      { index: 1, quantity: 5, reason: '' },
    ]);

    expect(payload.qualityResult).toBe('partial');
    expect(payload.lines).toEqual([
      {
        deliveryLineId: 'delivery-line-1',
        itemId: 'item-1',
        deliveredPurchaseQty: 8,
        acceptedPurchaseQty: 8,
        deliveredStockQty: 16,
        acceptedStockQty: 16,
        varianceReason: 'Thiếu hàng',
      },
      {
        deliveryLineId: 'delivery-line-2',
        itemId: 'item-2',
        deliveredPurchaseQty: 5,
        acceptedPurchaseQty: 5,
        deliveredStockQty: 5,
        acceptedStockQty: 5,
        varianceReason: null,
      },
    ]);
  });
});

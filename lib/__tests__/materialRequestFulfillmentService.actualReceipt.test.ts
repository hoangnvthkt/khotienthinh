import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: supabaseMocks,
}));

vi.mock('../featureFlags', () => ({
  isPurchasePackageV2Enabled: true,
  isPurchasePackageV2EnabledForSite: vi.fn(() => true),
}));

import { materialRequestFulfillmentService } from '../materialRequestFulfillmentService';

const po: PurchaseOrder = {
  id: 'po-1',
  vendorId: 'vendor-1',
  vendorName: 'NCC A',
  poNumber: 'PO-001',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  targetWarehouseId: 'warehouse-1',
  items: [{
    lineId: 'po-line-1',
    itemId: 'item-1',
    sku: 'VT001',
    name: 'Thép D16',
    unit: 'Cay',
    unitSnapshot: 'Kg',
    stockUnitSnapshot: 'Kg',
    purchaseUnitSnapshot: 'Cay',
    purchaseConversionFactor: 7.2,
    qty: 10,
    unitPrice: 72000,
  }],
  totalAmount: 720000,
  orderDate: '2026-07-25',
  status: 'in_transit',
  sourceMode: 'from_request',
  createdAt: '2026-07-25T00:00:00.000Z',
};

const deliveryBatch: PurchaseOrderDeliveryBatch = {
  id: 'batch-1',
  purchaseOrderId: 'po-1',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  supplierId: 'vendor-1',
  supplierNameSnapshot: 'NCC A',
  deliveryNo: 1,
  plannedDeliveryDate: '2026-07-25',
  status: 'wms_pending',
  vatRate: 0,
  wmsTransactionId: 'tx-1',
  lines: [{
    id: 'delivery-line-1',
    deliveryBatchId: 'batch-1',
    purchaseOrderId: 'po-1',
    purchaseOrderLineId: 'po-line-1',
    itemId: 'item-1',
    plannedQty: 10,
    stockPlannedQty: 72,
    unit: 'Cay',
    stockUnit: 'Kg',
    deliveryUnitPrice: 72000,
  }],
};

describe('actual PO receipt contract', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('approves V2 actual receipt by delivery batch and WMS ids without PO-wide lookup', async () => {
    supabaseMocks.from.mockImplementation(() => {
      throw new Error('legacy PO-wide receipt lookup should not run for V2 batches');
    });
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        deliveryBatchId: 'batch-1',
        wmsTransactionId: 'tx-1',
        deliveryStatus: 'quality_approved',
        transactionStatus: 'APPROVED',
        acceptedGrossAmount: 684000,
      },
      error: null,
    });

    const result = await materialRequestFulfillmentService.preparePoReceiptForQualityReview({
      po,
      deliveryBatch,
      actorUserId: 'keeper-1',
      qualityResult: 'partial',
      receiptLines: [{
        lineId: 'po-line-1',
        itemId: 'item-1',
        quantity: 9.5,
        varianceReason: 'NCC giao thiếu',
      }],
      attachments: [],
    });

    expect(supabaseMocks.from).not.toHaveBeenCalled();
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('approve_material_po_quality', {
      p_delivery_batch_id: 'batch-1',
      p_wms_transaction_id: 'tx-1',
      p_actor_user_id: 'keeper-1',
      p_quality_result: 'partial',
      p_lines: [{
        deliveryLineId: 'delivery-line-1',
        itemId: 'item-1',
        deliveredPurchaseQty: 9.5,
        acceptedPurchaseQty: 9.5,
        deliveredStockQty: 68.4,
        acceptedStockQty: 68.4,
        varianceReason: 'NCC giao thiếu',
      }],
      p_attachments: [],
    });
    expect(result).toEqual({
      transactionIds: ['tx-1'],
      materialRequestIds: [],
    });
  });
});

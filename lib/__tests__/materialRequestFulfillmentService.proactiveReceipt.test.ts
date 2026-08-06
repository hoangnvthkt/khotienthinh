import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';
import { buildReceiptQuantitySnapshot } from '../materialUnitConversion';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
  },
}));

import { materialRequestFulfillmentService } from '../materialRequestFulfillmentService';

describe('proactive PO WMS receipt contract', () => {
  beforeEach(() => {
    const sourceTransactionQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const inventoryQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{
          id: 'item-commercial',
          sku: 'COMMERCIAL-SKU',
          name: 'Repeated commercial material',
          category: 'Material',
          unit: 'Kg',
          purchase_unit: 'Cay',
          purchase_conversion_factor: 2,
          price_in: 0,
          price_out: 0,
          min_stock: 0,
          stock_by_warehouse: {},
        }],
        error: null,
      }),
    };
    const scheduleQuery = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ error: null }),
    };

    supabaseMocks.from.mockReset().mockImplementation((table: string) => {
      if (table === 'transactions') return sourceTransactionQuery;
      if (table === 'items') return inventoryQuery;
      if (table === 'purchase_order_delivery_batches') return scheduleQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('keeps accepted purchase and stock quantities in their own units', () => {
    expect(buildReceiptQuantitySnapshot({
      acceptedPurchaseQty: 9.5,
      purchaseUnit: 'Cay',
      stockUnit: 'Kg',
      conversionFactor: 7.2,
    })).toEqual({
      acceptedPurchaseQty: 9.5,
      acceptedStockQty: 68.4,
      purchaseUnit: 'Cay',
      stockUnit: 'Kg',
      conversionFactor: 7.2,
    });
  });

  it('keeps repeated-SKU receipt payloads tied to their commercial lines and prices', async () => {
    const po: PurchaseOrder = {
      id: 'po-commercial-lines',
      vendorId: 'vendor-1',
      poNumber: 'PO-COMMERCIAL-LINES',
      targetWarehouseId: 'warehouse-1',
      sourceMode: 'proactive_project',
      items: [
        {
          lineId: 'commercial-10k',
          itemId: 'item-commercial',
          sku: 'COMMERCIAL-SKU',
          name: 'Repeated commercial material',
          unit: 'Cay',
          unitSnapshot: 'Kg',
          stockUnitSnapshot: 'Kg',
          purchaseUnitSnapshot: 'Cay',
          purchaseConversionFactor: 2,
          qty: 3,
          unitPrice: 10_000,
        },
        {
          lineId: 'commercial-12k',
          itemId: 'item-commercial',
          sku: 'COMMERCIAL-SKU',
          name: 'Repeated commercial material',
          unit: 'Cay',
          unitSnapshot: 'Kg',
          stockUnitSnapshot: 'Kg',
          purchaseUnitSnapshot: 'Cay',
          purchaseConversionFactor: 2,
          qty: 7,
          unitPrice: 12_000,
        },
      ],
      totalAmount: 114_000,
      orderDate: '2026-08-06',
      status: 'confirmed',
      createdAt: '2026-08-06T00:00:00.000Z',
    };
    const deliveryBatch: PurchaseOrderDeliveryBatch = {
      id: 'batch-commercial-lines',
      purchaseOrderId: po.id,
      deliveryNo: 1,
      plannedDeliveryDate: '2026-08-06',
      status: 'planned',
      lines: [
        {
          id: 'delivery-commercial-10k',
          deliveryBatchId: 'batch-commercial-lines',
          purchaseOrderId: po.id,
          purchaseOrderLineId: 'commercial-10k',
          itemId: 'item-commercial',
          plannedQty: 3,
          stockPlannedQty: 6,
          deliveryUnitPrice: 10_000,
        },
        {
          id: 'delivery-commercial-12k',
          deliveryBatchId: 'batch-commercial-lines',
          purchaseOrderId: po.id,
          purchaseOrderLineId: 'commercial-12k',
          itemId: 'item-commercial',
          plannedQty: 7,
          stockPlannedQty: 14,
          deliveryUnitPrice: 12_000,
        },
      ],
    };

    await materialRequestFulfillmentService.createPoDeliveryReceiptBatch({
      po,
      deliveryBatch,
      actorUserId: 'user-1',
    });

    const transactionInsert = supabaseMocks.from.mock.results
      .map(result => result.value)
      .find(query => query.insert)?.insert;
    expect(transactionInsert).toHaveBeenCalledWith(expect.objectContaining({
      items: [
        expect.objectContaining({
          purchaseOrderLineId: 'commercial-10k',
          price: 5_000,
          accountingPrice: 10_000,
        }),
        expect.objectContaining({
          purchaseOrderLineId: 'commercial-12k',
          price: 6_000,
          accountingPrice: 12_000,
        }),
      ],
    }));
  });
});

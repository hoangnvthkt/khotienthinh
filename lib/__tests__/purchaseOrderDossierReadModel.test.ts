import { describe, expect, it } from 'vitest';
import type { PurchaseOrderDeliveryBatch } from '../../types';
import { buildPurchaseOrderDossierQuantitySummary } from '../purchaseOrderDossierReadModel';

const batch = (
  id: string,
  status: PurchaseOrderDeliveryBatch['status'],
  approvalStatus: PurchaseOrderDeliveryBatch['approvalStatus'],
  lines: PurchaseOrderDeliveryBatch['lines'],
): PurchaseOrderDeliveryBatch => ({
  id,
  purchaseOrderId: 'po-360',
  deliveryNo: 1,
  status,
  approvalStatus,
  lines,
});

const line = (
  id: string,
  itemId: string,
  plannedQty: number,
  acceptedStockQty: number,
  stockPlannedQty = plannedQty,
  unit = 'kg',
  stockUnit = 'kg',
) => ({
  id,
  deliveryBatchId: 'batch',
  purchaseOrderId: 'po-360',
  purchaseOrderLineId: `po-line-${itemId}`,
  itemId,
  plannedQty,
  acceptedStockQty,
  stockPlannedQty,
  unit,
  stockUnit,
});

describe('purchase order dossier quantity summary', () => {
  it('counts terminal receipts by lifecycle even when legacy approval remains draft', () => {
    const result = buildPurchaseOrderDossierQuantitySummary({
      demandLines: [{
        purchaseOrderLineId: 'po-line-steel',
        itemId: 'steel',
        purchaseQty: 100,
        purchaseUnit: 'kg',
        stockUnit: 'kg',
        conversionFactor: 1,
      }],
      deliveryBatches: [
        batch('received-draft', 'received', 'draft', [line('line-1', 'steel', 30, 30)]),
        batch('approved-planned', 'planned', 'approved', [line('line-2', 'steel', 40, 0)]),
        batch('cancelled', 'cancelled', 'approved', [line('line-3', 'steel', 50, 50)]),
        batch('received-short', 'received_short', 'approved', [line('line-4', 'steel', 20, 10)]),
        batch('received-over', 'received_over', 'approved', [line('line-5', 'steel', 30, 35)]),
      ],
    });

    expect(result.groups).toEqual([expect.objectContaining({
      itemId: 'steel',
      stockUnit: 'kg',
      demandStockQty: 100,
      approvedPlannedStockQty: 90,
      receivedAcceptedStockQty: 75,
      remainingStockQty: 25,
    })]);
    expect(result.counts).toEqual({
      demandLines: 1,
      approvedLines: 3,
      receivedLines: 3,
      terminalBatches: 3,
    });
    expect(result.aggregate).toEqual(expect.objectContaining({
      stockUnit: 'kg',
      demandQty: 100,
      approvedQty: 90,
      receivedQty: 75,
      remainingQty: 25,
      receivedPercent: 75,
    }));
  });

  it('does not create a grand physical quantity or percentage across SKU and UOM groups', () => {
    const result = buildPurchaseOrderDossierQuantitySummary({
      demandLines: [
        {
          purchaseOrderLineId: 'po-line-cement',
          itemId: 'cement',
          purchaseQty: 2,
          purchaseUnit: 'bao',
          stockUnit: 'kg',
          conversionFactor: 25,
        },
        {
          purchaseOrderLineId: 'po-line-steel',
          itemId: 'steel',
          purchaseQty: 10,
          purchaseUnit: 'cây',
          stockUnit: 'cây',
          conversionFactor: 1,
        },
      ],
      deliveryBatches: [
        batch('received-cement', 'received', 'draft', [line('line-cement', 'cement', 2, 25, 50, 'bao', 'kg')]),
        batch('received-steel', 'received_over', 'approved', [line('line-steel', 'steel', 10, 11, 10, 'cây', 'cây')]),
      ],
    });

    expect(result.groups).toHaveLength(2);
    expect(result.aggregate).toBeNull();
    expect(result.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'cement', stockUnit: 'kg', demandStockQty: 50, receivedAcceptedStockQty: 25 }),
      expect.objectContaining({ itemId: 'steel', stockUnit: 'cây', demandStockQty: 10, receivedAcceptedStockQty: 11 }),
    ]));
  });

  it('flags a missing stock conversion snapshot instead of comparing unlike units', () => {
    const result = buildPurchaseOrderDossierQuantitySummary({
      demandLines: [{
        purchaseOrderLineId: 'po-line-cement',
        itemId: 'cement',
        purchaseQty: 2,
        purchaseUnit: 'bao',
        stockUnit: 'kg',
        conversionFactor: null,
      }],
      deliveryBatches: [
        batch('approved-cement', 'planned', 'approved', [{
          ...line('line-cement', 'cement', 2, 0, 0, 'bao', 'kg'),
          stockPlannedQty: undefined,
        }]),
      ],
    });

    expect(result.groups[0]).toEqual(expect.objectContaining({
      demandStockQty: null,
      approvedPlannedStockQty: null,
    }));
    expect(result.aggregate).toBeNull();
    expect(result.qualityIssues.map(issue => issue.code)).toEqual([
      'missing_demand_conversion',
      'missing_planned_conversion',
    ]);
  });
});

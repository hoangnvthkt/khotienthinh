import { describe, expect, it } from 'vitest';
import {
  assertMaterialPoPhysicalQuantities,
  deriveMaterialPoCompletion,
  getMaterialPoVariance,
  requiresMaterialPoVarianceReason,
} from '../materialPoPracticalFlow';

describe('materialPoPracticalFlow', () => {
  it('calculates delivery and acceptance variances from actual quantities', () => {
    expect(
      getMaterialPoVariance({
        orderedQty: 100,
        documentedQty: 98.5,
        countedQty: 98.2,
        acceptedQty: 90,
        documentedStockQty: 98.5,
        countedStockQty: 98.2,
        acceptedStockQty: 89,
      }),
    ).toEqual({
      documentVarianceQty: -1.5,
      physicalVarianceQty: -0.3,
      custodyPurchaseQty: 8.2,
      custodyStockQty: 9.2,
    });
  });

  it('keeps supplier document, physical count, acceptance and custody separate', () => {
    expect(
      getMaterialPoVariance({
        orderedQty: 100,
        documentedQty: 98.5,
        countedQty: 98.2,
        acceptedQty: 98,
        documentedStockQty: 98.5,
        countedStockQty: 98.2,
        acceptedStockQty: 98,
      }),
    ).toEqual({
      documentVarianceQty: -1.5,
      physicalVarianceQty: -0.3,
      custodyPurchaseQty: 0.2,
      custodyStockQty: 0.2,
    });
  });

  it('requires a reason whenever an actual quantity differs', () => {
    expect(
      requiresMaterialPoVarianceReason({
        orderedQty: 100,
        documentedQty: 100,
        countedQty: 100,
        acceptedQty: 100,
        documentedStockQty: 100,
        countedStockQty: 100,
        acceptedStockQty: 100,
      }),
    ).toBe(false);

    expect(
      requiresMaterialPoVarianceReason({
        orderedQty: 100,
        documentedQty: 103,
        countedQty: 102,
        acceptedQty: 102,
        documentedStockQty: 103,
        countedStockQty: 102,
        acceptedStockQty: 101,
      }),
    ).toBe(true);
  });

  it('rejects an accepted purchase quantity greater than delivered quantity', () => {
    expect(() =>
      assertMaterialPoPhysicalQuantities({
        orderedQty: 100,
        documentedQty: 95,
        countedQty: 95,
        acceptedQty: 96,
        documentedStockQty: 95,
        countedStockQty: 95,
        acceptedStockQty: 95,
      }),
    ).toThrow('Số lượng đạt không được lớn hơn số lượng đếm/cân thực tế.');
  });

  it('rejects an accepted stock quantity greater than delivered stock quantity', () => {
    expect(() =>
      assertMaterialPoPhysicalQuantities({
        orderedQty: 100,
        documentedQty: 95,
        countedQty: 95,
        acceptedQty: 95,
        documentedStockQty: 95,
        countedStockQty: 95,
        acceptedStockQty: 96,
      }),
    ).toThrow('Số lượng đạt theo đơn vị kho không được lớn hơn số lượng đếm/cân.');
  });

  it('completes a single-delivery PO after its one receipt regardless of shortage', () => {
    expect(
      deriveMaterialPoCompletion({
        purchaseMode: 'single',
        requestedQty: 100,
        receivedQty: 90,
        hasCompletedReceipt: true,
      }),
    ).toBe('delivered');
  });

  it('keeps a multi-delivery PO partial until actual received quantity meets demand', () => {
    expect(
      deriveMaterialPoCompletion({
        purchaseMode: 'multiple',
        requestedQty: 100,
        receivedQty: 90,
        hasCompletedReceipt: true,
      }),
    ).toBe('partial');

    expect(
      deriveMaterialPoCompletion({
        purchaseMode: 'multiple',
        requestedQty: 100,
        receivedQty: 101,
        hasCompletedReceipt: true,
      }),
    ).toBe('delivered');
  });

  it('keeps the PO open before any receipt is completed', () => {
    expect(
      deriveMaterialPoCompletion({
        purchaseMode: 'single',
        requestedQty: 100,
        receivedQty: 0,
        hasCompletedReceipt: false,
      }),
    ).toBe('open');
  });
});

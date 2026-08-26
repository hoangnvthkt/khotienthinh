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
        deliveredQty: 95,
        acceptedQty: 90,
        deliveredStockQty: 95,
        acceptedStockQty: 89,
      }),
    ).toEqual({
      deliveryVarianceQty: -5,
      rejectedPurchaseQty: 5,
      rejectedStockQty: 6,
    });
  });

  it('requires a reason whenever an actual quantity differs', () => {
    expect(
      requiresMaterialPoVarianceReason({
        orderedQty: 100,
        deliveredQty: 100,
        acceptedQty: 100,
        deliveredStockQty: 100,
        acceptedStockQty: 100,
      }),
    ).toBe(false);

    expect(
      requiresMaterialPoVarianceReason({
        orderedQty: 100,
        deliveredQty: 103,
        acceptedQty: 102,
        deliveredStockQty: 103,
        acceptedStockQty: 101,
      }),
    ).toBe(true);
  });

  it('rejects an accepted purchase quantity greater than delivered quantity', () => {
    expect(() =>
      assertMaterialPoPhysicalQuantities({
        orderedQty: 100,
        deliveredQty: 95,
        acceptedQty: 96,
        deliveredStockQty: 95,
        acceptedStockQty: 95,
      }),
    ).toThrow('Số lượng chấp nhận không được lớn hơn số lượng giao thực tế.');
  });

  it('rejects an accepted stock quantity greater than delivered stock quantity', () => {
    expect(() =>
      assertMaterialPoPhysicalQuantities({
        orderedQty: 100,
        deliveredQty: 95,
        acceptedQty: 95,
        deliveredStockQty: 95,
        acceptedStockQty: 96,
      }),
    ).toThrow('Số lượng nhập kho không được lớn hơn số lượng giao theo đơn vị tồn kho.');
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

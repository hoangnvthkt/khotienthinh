import type { PurchaseMode } from '../types';

export interface MaterialPoVarianceInput {
  orderedQty: number;
  deliveredQty: number;
  acceptedQty: number;
  deliveredStockQty: number;
  acceptedStockQty: number;
}

export interface MaterialPoVariance {
  deliveryVarianceQty: number;
  rejectedPurchaseQty: number;
  rejectedStockQty: number;
}

export type MaterialPoCompletion = 'open' | 'partial' | 'delivered';

const QUANTITY_LABELS: Record<keyof MaterialPoVarianceInput, string> = {
  orderedQty: 'Số lượng đặt',
  deliveredQty: 'Số lượng giao thực tế',
  acceptedQty: 'Số lượng chấp nhận',
  deliveredStockQty: 'Số lượng giao theo đơn vị tồn kho',
  acceptedStockQty: 'Số lượng nhập kho',
};

export const getMaterialPoVariance = (
  input: MaterialPoVarianceInput,
): MaterialPoVariance => ({
  deliveryVarianceQty: input.deliveredQty - input.orderedQty,
  rejectedPurchaseQty: input.deliveredQty - input.acceptedQty,
  rejectedStockQty: input.deliveredStockQty - input.acceptedStockQty,
});

export const requiresMaterialPoVarianceReason = (
  input: MaterialPoVarianceInput,
): boolean => Object.values(getMaterialPoVariance(input)).some((quantity) => quantity !== 0);

export const assertMaterialPoPhysicalQuantities = (
  input: MaterialPoVarianceInput,
): void => {
  for (const [key, label] of Object.entries(QUANTITY_LABELS) as Array<
    [keyof MaterialPoVarianceInput, string]
  >) {
    const quantity = input[key];
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`${label} phải là số không âm.`);
    }
  }

  if (input.acceptedQty > input.deliveredQty) {
    throw new Error('Số lượng chấp nhận không được lớn hơn số lượng giao thực tế.');
  }

  if (input.acceptedStockQty > input.deliveredStockQty) {
    throw new Error('Số lượng nhập kho không được lớn hơn số lượng giao theo đơn vị tồn kho.');
  }
};

export const deriveMaterialPoCompletion = (input: {
  purchaseMode: PurchaseMode;
  requestedQty: number;
  receivedQty: number;
  hasCompletedReceipt: boolean;
}): MaterialPoCompletion => {
  if (!input.hasCompletedReceipt) return 'open';
  if (input.purchaseMode === 'single') return 'delivered';
  return input.receivedQty >= input.requestedQty ? 'delivered' : 'partial';
};

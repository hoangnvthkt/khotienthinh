import type { PurchaseMode } from '../types';

export interface MaterialPoVarianceInput {
  orderedQty: number;
  documentedQty: number;
  countedQty: number;
  acceptedQty: number;
  documentedStockQty: number;
  countedStockQty: number;
  acceptedStockQty: number;
}

export interface MaterialPoVariance {
  documentVarianceQty: number;
  physicalVarianceQty: number;
  custodyPurchaseQty: number;
  custodyStockQty: number;
}

export type MaterialPoCompletion = 'open' | 'partial' | 'delivered';

const QUANTITY_LABELS: Record<keyof MaterialPoVarianceInput, string> = {
  orderedQty: 'Số lượng đặt',
  documentedQty: 'Số lượng trên chứng từ nhà cung cấp',
  countedQty: 'Số lượng đếm/cân thực tế',
  acceptedQty: 'Số lượng đạt',
  documentedStockQty: 'Số lượng chứng từ theo đơn vị kho',
  countedStockQty: 'Số lượng đếm/cân theo đơn vị kho',
  acceptedStockQty: 'Số lượng đạt theo đơn vị kho',
};

export const getMaterialPoVariance = (
  input: MaterialPoVarianceInput,
): MaterialPoVariance => ({
  documentVarianceQty: input.documentedQty - input.orderedQty,
  physicalVarianceQty: Number((input.countedQty - input.documentedQty).toFixed(6)),
  custodyPurchaseQty: Number((input.countedQty - input.acceptedQty).toFixed(6)),
  custodyStockQty: Number((input.countedStockQty - input.acceptedStockQty).toFixed(6)),
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

  if (input.acceptedQty > input.countedQty) {
    throw new Error('Số lượng đạt không được lớn hơn số lượng đếm/cân thực tế.');
  }

  if (input.acceptedStockQty > input.countedStockQty) {
    throw new Error('Số lượng đạt theo đơn vị kho không được lớn hơn số lượng đếm/cân.');
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

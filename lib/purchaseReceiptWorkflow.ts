import { TransactionStatus, type Transaction } from '../types';
import type { MaterialPoQualityLineInput } from './purchaseReceiptService';
import {
  assertMaterialPoPhysicalQuantities,
  requiresMaterialPoVarianceReason,
} from './materialPoPracticalFlow';

export type PurchaseReceiptStep = 'quality' | 'confirm' | 'completed';

export const getPurchaseReceiptStep = (
  status: TransactionStatus,
  sourceType?: string | null,
): PurchaseReceiptStep => {
  if (sourceType !== 'po_delivery_batch') return status === TransactionStatus.COMPLETED ? 'completed' : 'quality';
  if (status === TransactionStatus.COMPLETED) return 'completed';
  if (status === TransactionStatus.APPROVED) return 'confirm';
  return 'quality';
};

export interface PurchaseReceiptQuantityLine {
  index: number;
  quantity: number;
  documentedPurchaseQty?: number;
  countedPurchaseQty?: number;
  acceptedPurchaseQty?: number;
  documentedStockQty?: number;
  countedStockQty?: number;
  acceptedStockQty?: number;
  reason: string;
}

export interface PurchaseReceiptQualityPayload {
  qualityResult: 'passed' | 'partial' | 'rejected';
  lines: MaterialPoQualityLineInput[];
}

export const buildPurchaseReceiptQualityPayloadFromTransaction = (
  transaction: Transaction,
  quantityLines: PurchaseReceiptQuantityLine[],
): PurchaseReceiptQualityPayload => {
  const lineByIndex = new Map(quantityLines.map(line => [line.index, line]));
  const lines = transaction.items.map((item, index): MaterialPoQualityLineInput => {
    const draft = lineByIndex.get(index);
    const acceptedStockQty = Number(draft?.acceptedStockQty ?? draft?.quantity ?? item.quantity ?? 0);
    const documentedStockQty = Number(draft?.documentedStockQty ?? acceptedStockQty);
    const countedStockQty = Number(draft?.countedStockQty ?? documentedStockQty);
    const stockBaselineQty = Number(item.quantity || 0);
    const purchaseBaselineQty = Number(item.accountingQty || stockBaselineQty);
    const acceptedPurchaseQty = Number(draft?.acceptedPurchaseQty ?? (
      stockBaselineQty > 0
        ? acceptedStockQty * (purchaseBaselineQty / stockBaselineQty)
        : acceptedStockQty
    ));
    const documentedPurchaseQty = Number(draft?.documentedPurchaseQty ?? acceptedPurchaseQty);
    const countedPurchaseQty = Number(draft?.countedPurchaseQty ?? documentedPurchaseQty);
    const varianceReason = draft?.reason.trim() || null;
    const quantities = {
      orderedQty: purchaseBaselineQty,
      documentedQty: documentedPurchaseQty,
      countedQty: countedPurchaseQty,
      acceptedQty: acceptedPurchaseQty,
      documentedStockQty,
      countedStockQty,
      acceptedStockQty,
    };
    assertMaterialPoPhysicalQuantities(quantities);
    if (requiresMaterialPoVarianceReason(quantities) && !varianceReason) {
      throw new Error('Phải nhập lý do khi số đặt, giao hoặc chấp nhận chênh lệch.');
    }
    return {
      deliveryLineId: item.purchaseOrderDeliveryLineId || '',
      itemId: item.itemId,
      documentedPurchaseQty,
      countedPurchaseQty,
      acceptedPurchaseQty,
      documentedStockQty,
      countedStockQty,
      acceptedStockQty,
      varianceReason,
    };
  });

  if (lines.some(line => !line.deliveryLineId || !line.itemId)) {
    throw new Error('Phiếu WMS thiếu liên kết dòng Đợt giao.');
  }
  const hasAcceptedQty = lines.some(line => line.acceptedStockQty > 0 || line.acceptedPurchaseQty > 0);
  if (!hasAcceptedQty) {
    return { qualityResult: 'rejected', lines };
  }
  const isFullReceipt = transaction.items.every((item, index) => {
    const draft = lineByIndex.get(index);
    const acceptedStockQty = Number(draft?.acceptedStockQty ?? draft?.quantity ?? item.quantity ?? 0);
    const documentedStockQty = Number(draft?.documentedStockQty ?? acceptedStockQty);
    const countedStockQty = Number(draft?.countedStockQty ?? documentedStockQty);
    return acceptedStockQty === countedStockQty
      && countedStockQty === documentedStockQty
      && documentedStockQty === Number(item.orderedQty ?? item.quantity ?? 0);
  });
  return {
    qualityResult: isFullReceipt ? 'passed' : 'partial',
    lines,
  };
};

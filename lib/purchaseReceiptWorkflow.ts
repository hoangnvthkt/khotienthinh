import { TransactionStatus, type Transaction } from '../types';
import type { ReceiptQualityLineInput } from './purchaseReceiptService';

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
  reason: string;
}

export interface PurchaseReceiptQualityPayload {
  qualityResult: 'passed' | 'partial' | 'rejected';
  lines: ReceiptQualityLineInput[];
}

export const buildPurchaseReceiptQualityPayloadFromTransaction = (
  transaction: Transaction,
  quantityLines: PurchaseReceiptQuantityLine[],
): PurchaseReceiptQualityPayload => {
  const lineByIndex = new Map(quantityLines.map(line => [line.index, line]));
  const lines = transaction.items.map((item, index): ReceiptQualityLineInput => {
    const draft = lineByIndex.get(index);
    const acceptedStockQty = Number(draft?.quantity ?? item.quantity ?? 0);
    const stockBaselineQty = Number(item.quantity || 0);
    const purchaseBaselineQty = Number(item.accountingQty || stockBaselineQty);
    const acceptedPurchaseQty = stockBaselineQty > 0
      ? acceptedStockQty * (purchaseBaselineQty / stockBaselineQty)
      : acceptedStockQty;
    return {
      deliveryLineId: item.purchaseOrderDeliveryLineId || '',
      itemId: item.itemId,
      acceptedPurchaseQty,
      acceptedStockQty,
      varianceReason: draft?.reason.trim() || null,
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
    const acceptedStockQty = Number(lineByIndex.get(index)?.quantity ?? item.quantity ?? 0);
    return acceptedStockQty === Number(item.orderedQty ?? item.quantity ?? 0);
  });
  return {
    qualityResult: isFullReceipt ? 'passed' : 'partial',
    lines,
  };
};

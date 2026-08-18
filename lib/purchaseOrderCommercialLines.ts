import type { PurchaseOrderItem, PurchaseOrderSourceMode } from '../types';

export type PurchaseOrderCommercialLineIssue = {
  code: 'duplicate_request_source' | 'duplicate_commercial_price' | 'missing_line_id' | 'duplicate_line_id';
  sku: string;
  unitPrice?: number;
  lineId?: string;
};

const requestKey = (line: PurchaseOrderItem) => [
  line.vendorId || '',
  line.itemId,
  line.materialBudgetItemId || '',
  line.requestLineId || '',
].join('|');

const normalizeDescription = (value?: string | null) => (value || '').trim().toLocaleLowerCase('vi-VN');

const commercialKey = (line: PurchaseOrderItem) => [
  line.vendorId || '',
  line.itemId,
  line.materialBudgetItemId || '',
  Number(line.unitPrice),
  normalizeDescription(line.itemNameSnapshot || line.name),
  normalizeDescription(line.specification),
].join('|');

const isProactiveMode = (sourceMode: PurchaseOrderSourceMode) =>
  sourceMode === 'proactive_project' || sourceMode === 'proactive_stock';

export const findPurchaseOrderCommercialLineIssue = (input: {
  items: PurchaseOrderItem[];
  sourceMode: PurchaseOrderSourceMode;
}): PurchaseOrderCommercialLineIssue | null => {
  const seenKeys = new Set<string>();

  for (const line of input.items) {
    const key = isProactiveMode(input.sourceMode) ? commercialKey(line) : requestKey(line);
    if (seenKeys.has(key)) {
      return isProactiveMode(input.sourceMode)
        ? { code: 'duplicate_commercial_price', sku: line.sku, unitPrice: Number(line.unitPrice) }
        : { code: 'duplicate_request_source', sku: line.sku };
    }
    seenKeys.add(key);
  }

  const itemCounts = new Map<string, number>();
  for (const line of input.items) {
    itemCounts.set(line.itemId, (itemCounts.get(line.itemId) || 0) + 1);
  }

  for (const line of input.items) {
    if ((itemCounts.get(line.itemId) || 0) > 1 && !line.lineId?.trim()) {
      return { code: 'missing_line_id', sku: line.sku };
    }
  }

  const seenLineIds = new Set<string>();
  for (const line of input.items) {
    if (line.lineId?.trim()) {
      if (seenLineIds.has(line.lineId)) {
        return { code: 'duplicate_line_id', sku: line.sku, lineId: line.lineId };
      }
      seenLineIds.add(line.lineId);
    }
  }

  return null;
};

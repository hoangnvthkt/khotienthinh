import type { PurchaseOrderItem, PurchaseOrderSourceMode } from '../types';
import { getExcelCell, normalizeImportKey } from './excelImport';
import { parseNonNegativeLocaleNumber } from './localeNumberInput';

const PO_EXCEL_SKU_ALIASES = ['Mã SKU *', 'Mã SKU', 'SKU'];

export const getPoExcelCreateCommercialKey = (sku: unknown, unitPrice: unknown): string =>
  `${normalizeImportKey(sku)}|${parseNonNegativeLocaleNumber(unitPrice)}`;

export const getPoExcelCreateImportKey = (
  sourceMode: PurchaseOrderSourceMode,
  sku: unknown,
  unitPrice: unknown,
): string => sourceMode === 'proactive_project' || sourceMode === 'proactive_stock'
  ? getPoExcelCreateCommercialKey(sku, unitPrice)
  : normalizeImportKey(sku);

export const replacePoExcelCreateDuplicateErrors = (
  errors: string[],
  sku: unknown,
  unitPrice: unknown,
): string[] => {
  const duplicateMessage = `SKU "${String(sku ?? '').trim()}" với Đơn giá ${parseNonNegativeLocaleNumber(unitPrice).toLocaleString('vi-VN')} bị trùng. Vui lòng gộp số lượng.`;
  return errors.map(error => error.includes('bị trùng với dòng') || error.includes('đã tồn tại')
    ? duplicateMessage
    : error);
};

export const preparePoExcelUpdateRows = (input: {
  rows: Record<string, unknown>[];
  existingItems: PurchaseOrderItem[];
}): Array<Record<string, unknown> & {
  __poImportKey: string;
  __poImportError?: string;
}> => input.rows.map(row => {
  const explicitLineId = getExcelCell(row, ['Mã dòng PO']);
  if (explicitLineId) return { ...row, __poImportKey: explicitLineId };

  const sku = getExcelCell(row, PO_EXCEL_SKU_ALIASES);
  const normalizedSku = normalizeImportKey(sku);
  const matchingItems = input.existingItems.filter(item => normalizeImportKey(item.sku) === normalizedSku);

  if (matchingItems.length === 1) {
    const [matchingItem] = matchingItems;
    return { ...row, __poImportKey: matchingItem.lineId || matchingItem.itemId };
  }

  if (matchingItems.length > 1) {
    return {
      ...row,
      __poImportKey: '',
      __poImportError: `SKU "${sku}" có nhiều dòng giá; cần Mã dòng PO để cập nhật đúng dòng.`,
    };
  }

  return { ...row, __poImportKey: sku };
});

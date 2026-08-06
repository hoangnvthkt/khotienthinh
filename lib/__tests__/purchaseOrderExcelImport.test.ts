import { describe, expect, it } from 'vitest';
import type { PurchaseOrderItem } from '../../types';
import {
  getPoExcelCreateCommercialKey,
  getPoExcelCreateImportKey,
  preparePoExcelUpdateRows,
  replacePoExcelCreateDuplicateErrors,
} from '../purchaseOrderExcelImport';

const makeItem = (overrides: Partial<PurchaseOrderItem>): PurchaseOrderItem => ({
  lineId: 'line-default',
  itemId: 'item-default',
  sku: 'SKU-DEFAULT',
  name: 'Vật tư',
  unit: 'cái',
  qty: 1,
  unitPrice: 0,
  ...overrides,
});

describe('PO Excel commercial-line identity', () => {
  it('distinguishes repeated SKUs by normalized unit price during create', () => {
    expect(getPoExcelCreateCommercialKey(' SKU-1 ', '10.000')).toBe('sku-1|10000');
    expect(getPoExcelCreateCommercialKey('SKU-1', '10000')).toBe('sku-1|10000');
    expect(getPoExcelCreateCommercialKey('SKU-1', '11.000')).toBe('sku-1|11000');
  });

  it('uses commercial identity only for proactive project and stock source modes', () => {
    expect(getPoExcelCreateImportKey('from_request', 'SKU-1', '10.000')).toBe('sku-1');
    expect(getPoExcelCreateImportKey('from_request', 'SKU-1', '11.000')).toBe('sku-1');
    expect(getPoExcelCreateImportKey('proactive_project', 'SKU-1', '10.000')).toBe('sku-1|10000');
    expect(getPoExcelCreateImportKey('proactive_project', 'SKU-1', '11.000')).toBe('sku-1|11000');
    expect(getPoExcelCreateImportKey('proactive_stock', 'SKU-1', '10.000')).toBe('sku-1|10000');
    expect(getPoExcelCreateImportKey('proactive_stock', 'SKU-1', '11.000')).toBe('sku-1|11000');
  });

  it('replaces a workbook duplicate with merge-quantity guidance that names SKU and price', () => {
    expect(replacePoExcelCreateDuplicateErrors(
      ['Mã SKU "sku-1|10000" bị trùng với dòng 2.'],
      'SKU-1',
      '10.000',
    )).toEqual(['SKU "SKU-1" với Đơn giá 10.000 bị trùng. Vui lòng gộp số lượng.']);
  });

  it('replaces an existing-line conflict with the same actionable merge guidance', () => {
    expect(replacePoExcelCreateDuplicateErrors(
      ['Mã SKU "sku-1|10000" đã tồn tại.'],
      'SKU-1',
      10_000,
    )).toEqual(['SKU "SKU-1" với Đơn giá 10.000 bị trùng. Vui lòng gộp số lượng.']);
  });

  it('resolves an update by Mã dòng PO before considering the SKU', () => {
    const [row] = preparePoExcelUpdateRows({
      rows: [{ 'Mã dòng PO': 'line-2', 'Mã SKU': 'SKU-1' }],
      existingItems: [
        makeItem({ lineId: 'line-1', itemId: 'item-1', sku: 'SKU-1', unitPrice: 10_000 }),
        makeItem({ lineId: 'line-2', itemId: 'item-1', sku: 'SKU-1', unitPrice: 11_000 }),
      ],
    });

    expect(row).toMatchObject({ __poImportKey: 'line-2' });
    expect(row.__poImportError).toBeUndefined();
  });

  it('falls back from SKU to the sole matching existing PO line', () => {
    const [row] = preparePoExcelUpdateRows({
      rows: [{ 'Mã SKU *': ' sku-unique ' }],
      existingItems: [makeItem({ lineId: 'line-unique', itemId: 'item-unique', sku: 'SKU-UNIQUE' })],
    });

    expect(row).toMatchObject({ __poImportKey: 'line-unique' });
    expect(row.__poImportError).toBeUndefined();
  });

  it('rejects an ambiguous repeated-SKU update without Mã dòng PO', () => {
    const [row] = preparePoExcelUpdateRows({
      rows: [{ 'Mã SKU': 'SKU-1' }],
      existingItems: [
        makeItem({ lineId: 'line-1', itemId: 'item-1', sku: 'SKU-1', unitPrice: 10_000 }),
        makeItem({ lineId: 'line-2', itemId: 'item-1', sku: 'SKU-1', unitPrice: 11_000 }),
      ],
    });

    expect(row.__poImportKey).toBe('');
    expect(row.__poImportError).toContain('Mã dòng PO');
  });
});

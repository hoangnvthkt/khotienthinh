import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  calculateOpeningRecognizedValue,
  projectOpeningBalanceService,
} from '../projectOpeningBalanceService';

vi.mock('../supabase', () => ({
  isSupabaseConfigured: false,
  supabase: {},
}));

const makeAccountingWorkbookFile = () => {
  const rows = [
    ['Mã hàng', 'Tên hàng', 'ĐVT', 'Nhập kho', '', '', 'Xuất kho', '', ''],
    ['', '', '', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Số lượng', 'Đơn giá', 'Thành tiền'],
    ['VT0000852', 'Cọc ly tâm D400-2*7m', 'Mét', '14,000', '343.000,00', '4.802.000', '14,000', '343.000,00', '4.802.000'],
    ['VT0000852', 'Cọc ly tâm D400-6*13m', 'Mét', '78,000', '343.000,00', '26.754.000', '78,000', '343.000,00', '26.754.000'],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Ke toan');
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([output], 'ke-toan-vat-tu.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

describe('projectOpeningBalanceService accounting import', () => {
  it('parses two-level accounting headers and generates per-spec SKUs', async () => {
    const result = await projectOpeningBalanceService.parseOpeningBalanceImport(makeAccountingWorkbookFile(), {
      defaultWarehouseId: 'wh-site',
    });

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map(row => row.sku)).toEqual(['VT0000852-001', 'VT0000852-002']);
    expect(result.rows[0]).toMatchObject({
      accountingCode: 'VT0000852',
      itemName: 'Cọc ly tâm D400-2*7m',
      unit: 'Mét',
      warehouseId: 'wh-site',
      purchasedQty: 14,
      issuedQty: 14,
      usedQty: 14,
      remainingQty: 0,
      unitPrice: 343000,
      remainingValue: 0,
      purchasedAmount: 4802000,
      issuedAmount: 4802000,
    });
    expect(result.totals.purchasedValue).toBe(31556000);
    expect(result.totals.issuedValue).toBe(31556000);
    expect(result.totals.remainingQty).toBe(0);
  });

  it('uses issued/used value as recognized material cost before purchased value', async () => {
    expect(calculateOpeningRecognizedValue(1_000_000_000, 800_000_000, 800_000_000)).toBe(800_000_000);

    const result = await projectOpeningBalanceService.lockOpeningBalance({
      openingBalance: {
        scopeKey: 'project-1_site-1',
        projectId: 'project-1',
        constructionSiteId: 'site-1',
        asOfDate: '2026-06-20',
        contractValue: 2_000_000_000,
        constructionProgressPercent: 40,
        purchasedValue: 1_000_000_000,
        issuedValue: 800_000_000,
        usedValue: 800_000_000,
        recognizedValue: 800_000_000,
        status: 'draft',
      },
      lines: [{
        accountingCode: 'VT0000852',
        sku: 'VT0000852-001',
        itemName: 'Cọc ly tâm D400-2*7m',
        unit: 'Mét',
        warehouseId: 'wh-site',
        purchasedQty: 14,
        issuedQty: 14,
        usedQty: 14,
        remainingQty: 0,
        unitPrice: 343000,
        remainingValue: 0,
      }],
      existingItems: [],
      actorUserId: 'user-1',
    });

    expect(result.materialProjectTransaction?.amount).toBe(800_000_000);
    expect(result.stockTransactions).toHaveLength(0);
    expect(result.createdItems).toHaveLength(1);
    expect(result.createdItems[0]).toMatchObject({
      sku: 'VT0000852-001',
      accountingCode: 'VT0000852',
      name: 'Cọc ly tâm D400-2*7m',
    });
  });
});

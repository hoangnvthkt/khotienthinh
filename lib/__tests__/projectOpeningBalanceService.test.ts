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
  it('parses two-level accounting headers and aggregates specs by root accounting code', async () => {
    const result = await projectOpeningBalanceService.parseOpeningBalanceImport(makeAccountingWorkbookFile(), {
      defaultWarehouseId: 'wh-site',
    });

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      accountingCode: 'VT0000852',
      sku: 'VT0000852',
      itemName: 'Cọc ly tâm D400',
      unit: 'Mét',
      warehouseId: 'wh-site',
      purchasedQty: 92,
      issuedQty: 92,
      usedQty: 92,
      remainingQty: 0,
      unitPrice: 343000,
      remainingValue: 0,
      purchasedAmount: 31556000,
      issuedAmount: 31556000,
    });
    expect(result.totals.purchasedValue).toBe(31556000);
    expect(result.totals.issuedValue).toBe(31556000);
    expect(result.totals.remainingQty).toBe(0);
  });

  it('uses an existing root inventory item name when aggregating accounting rows', async () => {
    const result = await projectOpeningBalanceService.parseOpeningBalanceImport(makeAccountingWorkbookFile(), {
      defaultWarehouseId: 'wh-site',
      existingItems: [{
        id: 'item-root',
        sku: 'VT0000852',
        accountingCode: 'VT0000852',
        name: 'Cọc ly tâm D400',
        category: 'Đầu kỳ',
        unit: 'Mét',
        priceIn: 343000,
        priceOut: 343000,
        minStock: 0,
        stockByWarehouse: {},
      }],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      inventoryItemId: 'item-root',
      sku: 'VT0000852',
      itemName: 'Cọc ly tâm D400',
    });
  });

  it('keeps comma-formatted accounting unit prices as thousands for money columns', async () => {
    const rows = [
      ['Mã hàng', 'Tên hàng', 'ĐVT', 'Nhập kho', '', '', 'Xuất kho', '', ''],
      ['', '', '', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Số lượng', 'Đơn giá', 'Thành tiền'],
      ['VT0000852', 'Cọc ly tâm D400', 'Mét', '14,000', '343,000', '', '', '', ''],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Ke toan');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const file = new File([output], 'don-gia-comma.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const result = await projectOpeningBalanceService.parseOpeningBalanceImport(file, {
      defaultWarehouseId: 'wh-site',
    });

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      accountingCode: 'VT0000852',
      purchasedQty: 14,
      unitPrice: 343000,
      remainingQty: 14,
      remainingValue: 4802000,
      purchasedAmount: 4802000,
    });
  });

  it('uses weighted remaining value when aggregating specs with different prices', async () => {
    const rows = [
      ['Mã hàng', 'Tên hàng', 'ĐVT', 'Nhập kho', '', '', 'Xuất kho', '', ''],
      ['', '', '', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Số lượng', 'Đơn giá', 'Thành tiền'],
      ['VT0000100', 'Gạch block A-10', 'Viên', '10,000', '100,00', '1.000', '4,000', '100,00', '400'],
      ['VT0000100', 'Gạch block A-20', 'Viên', '5,000', '200,00', '1.000', '2,000', '200,00', '400'],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Ke toan');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const file = new File([output], 'gia-khac-nhau.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const result = await projectOpeningBalanceService.parseOpeningBalanceImport(file, {
      defaultWarehouseId: 'wh-site',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      accountingCode: 'VT0000100',
      sku: 'VT0000100',
      itemName: 'Gạch block A',
      purchasedQty: 15,
      issuedQty: 6,
      remainingQty: 9,
      remainingValue: 1200,
      purchasedAmount: 2000,
      issuedAmount: 800,
    });
    expect(result.rows[0].unitPrice).toBeCloseTo(1200 / 9, 6);
  });

  it('warns but still accepts factory-issued quantities without matching site warehouse receipts', async () => {
    const rows = [
      ['Mã hàng', 'Tên hàng', 'ĐVT', 'Nhập kho', '', '', 'Xuất kho', '', ''],
      ['', '', '', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Số lượng', 'Đơn giá', 'Thành tiền'],
      ['VT0000999', 'Thép hình H200', 'Kg', '', '', '', '1.000,000', '25.000,00', '25.000.000'],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Ke toan');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const file = new File([output], 'xuat-tu-kho-nha-may.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const result = await projectOpeningBalanceService.parseOpeningBalanceImport(file, {
      defaultWarehouseId: 'wh-site',
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(['Dòng 3: Số lượng xuất lớn hơn nhập, tồn được tính bằng 0.']);
    expect(result.rows[0]).toMatchObject({
      accountingCode: 'VT0000999',
      purchasedQty: 0,
      issuedQty: 1000,
      usedQty: 1000,
      remainingQty: 0,
      unitPrice: 25000,
      purchasedAmount: 0,
      issuedAmount: 25000000,
    });
    expect(result.totals.purchasedValue).toBe(0);
    expect(result.totals.issuedValue).toBe(25000000);
    expect(result.totals.usedValue).toBe(25000000);
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
        sku: 'VT0000852',
        itemName: 'Cọc ly tâm D400',
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
      sku: 'VT0000852',
      accountingCode: 'VT0000852',
      name: 'Cọc ly tâm D400',
    });
  });
});

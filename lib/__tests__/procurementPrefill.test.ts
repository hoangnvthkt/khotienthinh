import { describe, expect, it, vi } from 'vitest';

vi.mock('../uiSuggestionEvents', () => ({ recordSuggestionEvent: vi.fn() }));

import { recordSuggestionEvent } from '../uiSuggestionEvents';
import type { ProcurementVendorPrefill, ProcurementVendorPrefillLine } from '../procurementInboxService';
import {
  headerGhostRows, matchPrefillLine, prefillOutcome, prefillSourceLabel, priceDeviationPercent, priceGhost, recordPrefillOutcome, specGhost,
} from '../procurementPrefill';

const line = (over: Partial<ProcurementVendorPrefillLine>): ProcurementVendorPrefillLine => ({
  itemId: 'i1', specification: '', unit: 'm³', stockUnit: 'm³', factor: 1, unitPrice: 1_250_000, poNumber: 'PO-627', orderDate: '2026-10-08', ...over,
});

describe('matchPrefillLine', () => {
  const lines = [line({ specification: 'M300 R28' }), line({ specification: 'M250', unitPrice: 1_100_000, poNumber: 'PO-610' }), line({ itemId: 'i2' })];
  it('ô quy cách trống thì lấy dòng mới nhất của mã (kèm quy cách của nó)', () => {
    expect(matchPrefillLine(lines, 'i1', '')?.specification).toBe('M300 R28');
  });
  it('đang gõ quy cách thì phải đúng quy cách; khác hẳn thì không gợi ý giá', () => {
    expect(matchPrefillLine(lines, 'i1', 'm250')?.poNumber).toBe('PO-610');
    expect(matchPrefillLine(lines, 'i1', 'M400')).toBeNull();
    expect(matchPrefillLine(lines, 'i9', '')).toBeNull();
  });
});

describe('giá', () => {
  it('lệch % làm tròn 1 chữ số, dương là đắt hơn', () => {
    expect(priceDeviationPercent(1_400_000, 1_250_000)).toBe(12);
    expect(priceDeviationPercent(1_200_000, 1_250_000)).toBe(-4);
    expect(priceDeviationPercent(null, 1_250_000)).toBeNull();
    expect(priceDeviationPercent(100, 0)).toBeNull();
  });
  it('chữ mờ giá có định dạng và nguồn; quy cách trống thì không có chữ mờ quy cách', () => {
    const l = line({ specification: 'M300 R28' });
    expect(priceGhost(l)).toEqual({ text: '1.250.000', value: '1250000', title: 'Theo PO-627 (8/10) · /m³' });
    expect(specGhost(l)).toEqual({ text: 'M300 R28', value: 'M300 R28', title: 'Theo PO-627 (8/10)' });
    expect(specGhost(line({}))).toBeNull();
    expect(prefillSourceLabel({ poNumber: null, orderDate: '2026-10-08' })).toBe('đơn trước (8/10)');
  });
});

describe('headerGhostRows', () => {
  const order = { poNumber: 'PO-627', orderDate: '2026-10-08', vatRate: 8, purchaseMode: 'multiple' as const, projectId: 'p1', constructionSiteId: null, targetWarehouseId: 'w1' };
  it('chỉ nêu ô khác với đơn đang lập', () => {
    expect(headerGhostRows(order, { vat: '10', mode: 'single' })).toEqual(['VAT 8%', 'Giao nhiều đợt']);
    expect(headerGhostRows(order, { vat: '8', mode: 'multiple' })).toEqual([]);
    expect(headerGhostRows(order, { vat: '10', mode: 'single', allowMode: false })).toEqual(['VAT 8%']);
  });
  it('dự án / kho chỉ khi màn đưa tên vào và khác lựa chọn hiện tại', () => {
    expect(headerGhostRows(order, { vat: '8', mode: 'multiple', projectId: '', warehouseId: '', projectName: 'SMB', warehouseName: 'Kho SMB' })).toEqual(['Dự án SMB', 'Kho nhận Kho SMB']);
    expect(headerGhostRows(order, { vat: '8', mode: 'multiple', projectId: 'p1', warehouseId: 'w1', projectName: 'SMB', warehouseName: 'Kho SMB' })).toEqual([]);
  });
});

describe('đo lúc lưu', () => {
  const prefill: ProcurementVendorPrefill = { order: null, lines: [line({ specification: 'M300 R28' }), line({ itemId: 'i2', unitPrice: 50_000 })] };
  it('đếm dòng có gợi ý và dòng giữ nguyên', () => {
    const out = prefillOutcome(prefill, [
      { itemId: 'i1', specification: 'M300 R28', price: 1_250_000 },
      { itemId: 'i2', specification: '', price: 55_000 },
      { itemId: 'i3', specification: '', price: 1 },
    ]);
    expect(out).toEqual({ price: { suggested: 2, accepted: 1 }, spec: { suggested: 1, accepted: 1 } });
  });
  it('ghi một sự kiện mỗi nhóm ô, bỏ qua nhóm không có gợi ý', () => {
    recordPrefillOutcome(prefill, [{ itemId: 'i2', specification: '', price: 50_000 }], { vendorId: 'v1' });
    expect(recordSuggestionEvent).toHaveBeenCalledTimes(1);
    expect(recordSuggestionEvent).toHaveBeenCalledWith({ screen: 'purchase_order', field: 'price', outcome: 'accepted', suggested: 1, accepted: 1, source: { vendorId: 'v1' } });
    expect(prefillOutcome(null, [])).toEqual({ price: { suggested: 0, accepted: 0 }, spec: { suggested: 0, accepted: 0 } });
  });
});

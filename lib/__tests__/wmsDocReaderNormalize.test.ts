import { describe, expect, it } from 'vitest';
import { normalizeRead } from '../../supabase/functions/wms-doc-reader/prompt';

const doc = (supplierName: string, lines: Array<{ name: string; qty: number }>) => ({
  docType: 'hoa_don_ban_le', supplierName, supplierTaxCode: null, supplierAddress: null, docNo: null, docDate: '2026-10-07', docTime: null, truckNo: null,
  lines: lines.map(l => ({ ...l, unit: 'cái', note: null, confidence: 'high' })), warnings: ['Phiếu viết tay'],
});

describe('wms-doc-reader — chuẩn hóa kết quả AI', () => {
  it('một phiếu: giữ nguyên số liệu, cảnh báo của AI', () => {
    const r = normalizeRead(doc('Huy Hoàng', [{ name: 'Cáp 6', qty: 0.8 }]));
    expect(r).toMatchObject({ supplierName: 'Huy Hoàng', docDate: '2026-10-07', lines: [{ name: 'Cáp 6', qty: 0.8, confidence: 'high' }], warnings: ['Phiếu viết tay'] });
  });

  it('ảnh có 2 hóa đơn → AI trả mảng: đọc phiếu đầu, cảnh báo chụp riêng đứng đầu', () => {
    const r = normalizeRead([doc('Huy Hoàng', [{ name: 'Cáp 6', qty: 0.8 }, { name: 'Mũi khoan 16', qty: 2 }]), doc('Hay Hoan', [{ name: 'Ống lưới φ27', qty: 1 }])]);
    expect(r.supplierName).toBe('Huy Hoàng');
    expect(r.lines.map(l => l.name)).toEqual(['Cáp 6', 'Mũi khoan 16']);
    expect(r.warnings[0]).toBe('Ảnh có 2 phiếu — mới đọc phiếu đầu, chụp riêng từng phiếu còn lại.');
    expect(r.warnings).toContain('Phiếu viết tay');
  });

  it('mảng một phiếu không cảnh báo; mảng rỗng / rác ra phiếu trống', () => {
    expect(normalizeRead([doc('Hợp Thành', [{ name: 'Bê tông M250', qty: 7.5 }])]).warnings).toEqual(['Phiếu viết tay']);
    expect(normalizeRead([])).toMatchObject({ docType: 'khac', supplierName: null, lines: [], warnings: [] });
    expect(normalizeRead('x')).toMatchObject({ docType: 'khac', lines: [] });
  });
});

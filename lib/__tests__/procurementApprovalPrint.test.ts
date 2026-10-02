import { describe, expect, it } from 'vitest';
import { buildPoApprovalPrintHtml, lineDisplayName, vietnameseMoneyWords } from '../procurementApprovalPrint';

describe('vietnameseMoneyWords', () => {
  it('reads common amounts the way invoices do', () => {
    expect(vietnameseMoneyWords(0)).toBe('Không đồng');
    expect(vietnameseMoneyWords(15)).toBe('Mười lăm đồng');
    expect(vietnameseMoneyWords(21)).toBe('Hai mươi mốt đồng');
    expect(vietnameseMoneyWords(105)).toBe('Một trăm lẻ năm đồng');
    expect(vietnameseMoneyWords(1_250_000)).toBe('Một triệu hai trăm năm mươi nghìn đồng');
    expect(vietnameseMoneyWords(1_000_005)).toBe('Một triệu không trăm lẻ năm đồng');
    expect(vietnameseMoneyWords(262_513_440)).toBe('Hai trăm sáu mươi hai triệu năm trăm mười ba nghìn bốn trăm bốn mươi đồng');
  });
});

describe('buildPoApprovalPrintHtml', () => {
  const base = {
    poNumber: 'PO-555', orderDate: '2026-10-02', subject: 'GẠCH ĐẶC TUYNEL SMB --> NCC A', vendorName: 'NCC A', projectLabel: 'SMB-2026',
    warehouseName: 'Kho SMB', expectedDeliveryDate: '2026-10-05', requesterName: 'Bùi Quang Chung', requesterPosition: 'Chuyên viên Vật tư',
    vatRate: 10, note: null, signers: [{ role: 'BP Vật tư - TB', name: 'Bùi Quang Chung' }, { role: 'Tổng giám đốc', name: 'Dương Xuân Thịnh' }],
    lines: [{ sku: 'VT00035', name: 'Gạch đặc Tuynel', specification: 'KT 30x30', unit: 'Viên', qty: 1000, unitPrice: 1200 }],
  };
  it('shows the official name plus the display specification, without per-line note rows', () => {
    const html = buildPoApprovalPrintHtml(base);
    expect(lineDisplayName('Gạch đặc Tuynel', 'KT 30x30')).toBe('Gạch đặc Tuynel - KT 30x30');
    expect(html).toContain('Gạch đặc Tuynel - KT 30x30');
    expect(html).not.toContain('approval-muted');
    expect(html).toContain('ĐỀ NGHỊ DUYỆT ĐƠN HÀNG');
    expect(html).toContain('1.320.000');
    expect(html).toContain('Một triệu ba trăm hai mươi nghìn đồng');
  });
  it('escapes user text', () => {
    expect(buildPoApprovalPrintHtml({ ...base, note: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

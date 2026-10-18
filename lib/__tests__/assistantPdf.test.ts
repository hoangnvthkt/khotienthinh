import { describe, expect, it } from 'vitest';
import { PDF_MAX_MB, isPdfFile, pdfKind, pdfText } from '../assistantPdf';

describe('Trợ lý · PDF đọc trên máy', () => {
  it('nhận PDF theo loại / đuôi; giới hạn 50 MB', () => {
    expect(isPdfFile({ name: 'BG.PDF', type: '' })).toBe(true);
    expect(isPdfFile({ name: 'x', type: 'application/pdf' })).toBe(true);
    expect(isPdfFile({ name: 'a.xlsx', type: '' })).toBe(false);
    expect(PDF_MAX_MB).toBe(50);
  });

  it('PDF có chữ hay PDF scan: trung bình dưới 40 ký tự / trang là scan', () => {
    expect(pdfKind(['CÔNG TY HANAKA báo giá thép vằn D16 CB400 6.300 kg 15.850 đ', 'Trang 2 có đủ chữ của hợp đồng mua bán vật tư'])).toBe('text');
    expect(pdfKind(['1', '', '2'])).toBe('scan');
    expect(pdfKind([])).toBe('scan');
  });

  it('chữ các trang: cột cách " | ", ghi số trang, cắt theo ngân sách và báo cắt', () => {
    const t = pdfText(['STT   Tên hàng   Số lượng \n1   Thép D16   6.300', '', 'Trang ba'], 3);
    expect(t.text).toBe('[PDF · 3 trang]\n[Trang 1]\nSTT | Tên hàng | Số lượng\n1 | Thép D16 | 6.300\n\n[Trang 3]\nTrang ba');
    expect(t.truncated).toBe(false);
    const long = pdfText(Array.from({ length: 10 }, (_, i) => `Trang ${i + 1} `.repeat(200)), 80, 3000);
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBeLessThan(3200);
    expect(long.text).toContain('đã cắt bớt');
    expect(pdfText(['ngắn'], 61).truncated).toBe(true);
  });
});

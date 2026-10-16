import { describe, expect, it } from 'vitest';
import { findMerges, runLimited, samePaper } from '../wmsCaptureBatch';
import type { DeliveryCapture } from '../wmsDeliveryCaptureService';

const cap = (id: string, p: Partial<DeliveryCapture>): DeliveryCapture => ({
  id, warehouseId: 'wh-1', status: 'read', supplierName: null, docNo: null, docDate: null, docTime: null, truckNo: null, lines: [], photos: [], ai: null,
  note: null, purchaseOrderId: null, poNumber: null, deliveryBatchId: null, wmsTransactionId: null, code: null, createdBy: null, createdAt: '2026-10-16T03:00:00Z',
  receivedAt: null, receivedBy: null, ...p,
});

describe('Xấp phiếu — gộp trang cùng phiếu (16/10)', () => {
  it('cùng số phiếu, tên NCC viết tắt khác nhau → cùng giấy', () => {
    expect(samePaper(
      cap('a', { docNo: '0010015', supplierName: 'Công ty TNHH Xây dựng và ĐTTM Hợp Thành', docDate: '2026-10-07' }),
      cap('b', { docNo: '0010015', supplierName: 'Hợp Thành', docDate: null }),
    )).toBe(true);
  });

  it('bẫy đợt 0: 3 xe cùng số biên bản 007/10 nhưng khác biển số → không gộp', () => {
    const list = [
      cap('a', { docNo: '007/10', supplierName: 'Poshaco', truckNo: '29CD-00280' }),
      cap('b', { docNo: '007/10', supplierName: 'Poshaco', truckNo: '29C-12345' }),
      cap('c', { docNo: '007 / 10', supplierName: 'Poshaco', truckNo: null }),
    ];
    expect(findMerges(list)).toEqual([['a', 'c']]);
  });

  it('không có số phiếu, khác NCC hoặc khác ngày → không gộp', () => {
    expect(samePaper(cap('a', { supplierName: 'Hợp Thành' }), cap('b', { supplierName: 'Hợp Thành' }))).toBe(false);
    expect(samePaper(cap('a', { docNo: '12', supplierName: 'Hợp Thành' }), cap('b', { docNo: '12', supplierName: 'Tương Thiên' }))).toBe(false);
    expect(samePaper(cap('a', { docNo: '12', docDate: '2026-10-07' }), cap('b', { docNo: '12', docDate: '2026-10-08' }))).toBe(false);
  });

  it('chạy giới hạn số luồng và đủ mọi việc', async () => {
    let running = 0; let peak = 0; const seen: number[] = [];
    await runLimited([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      running++; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 2));
      seen.push(n); running--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

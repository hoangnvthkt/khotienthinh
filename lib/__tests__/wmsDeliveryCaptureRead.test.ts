import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock('../supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, rpc: (...a: unknown[]) => rpc(...a) } }));

import { wmsDeliveryCaptureService as svc, type DeliveryCapture } from '../wmsDeliveryCaptureService';

const cap = (ai: DeliveryCapture['ai'] = null): DeliveryCapture => ({
  id: 'c1', warehouseId: 'wh-1', status: 'new', supplierName: null, docNo: null, docDate: null, docTime: null, truckNo: null,
  lines: [], photos: [{ path: 'cap-c1/a.jpg', name: 'a.jpg', size: 1, mimeType: 'image/jpeg' }], ai, note: null, purchaseOrderId: null, poNumber: null,
  deliveryBatchId: null, wmsTransactionId: null, code: null, createdBy: null, createdAt: '2026-10-16T03:32:00Z', receivedAt: null, receivedBy: null,
});
const fetchError = () => Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' });

describe('AI đọc phiếu khi mất kết nối (16/10)', () => {
  afterEach(() => { vi.useRealTimers(); invoke.mockReset(); rpc.mockReset(); });

  it('máy chủ đã đọc xong và lưu → lấy kết quả, không báo lỗi', async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValue({ data: null, error: fetchError() });
    const done = { ...cap({ provider: 'openai_compatible', readAt: new Date(Date.now() + 1000).toISOString() }), status: 'read' as const, docNo: '1' };
    rpc.mockResolvedValueOnce({ data: [cap()] }).mockResolvedValueOnce({ data: [done] });
    const p = svc.read(cap());
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toEqual({ code: 'OK', capture: done });
    expect(rpc).toHaveBeenCalledWith('list_delivery_captures_v1', { p: { warehouseId: 'wh-1' } });
  });

  it('không có kết quả mới → báo tiếng Việt, không lộ câu tiếng Anh', async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValue({ data: null, error: fetchError() });
    const old = cap({ readAt: '2026-10-15T00:00:00Z' });
    rpc.mockResolvedValue({ data: [old] });
    const p = svc.read(old);
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(p).resolves.toEqual({ code: 'AI_FAILED', error: 'Mất kết nối khi AI đang đọc — bấm Đọc lại.' });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: vi.fn() } } }));

import { aiLearning, aliasNorm, parseLearned, recall, type LearnedAlias } from '../aiLearning';
import { toFormRows, type MrCatalogItem } from '../assistantMrForm';
import { buildRows } from '../assistantPoForm';
import { aiGateway } from '../aiGateway';
import type { ProcurementCatalogItem } from '../procurementInboxService';
import { isDailyReportTurn } from '../../supabase/functions/ai-gateway/chat';

afterEach(() => { mocks.rpc.mockReset(); });

const mem = (o: Partial<LearnedAlias> & Pick<LearnedAlias, 'aliasNorm' | 'targetId'>): LearnedAlias =>
  ({ kind: 'item', alias: o.aliasNorm, targetLabel: '', hits: 1, ...o });

describe('Trợ lý T4a · AI học từ việc người dùng đã xác nhận', () => {
  it('chuẩn hóa cách gọi như máy chủ (bỏ dấu, đ → d, chỉ chữ + số); nhớ đúng loại, nhiều lượt xác nhận thắng', () => {
    expect(aliasNorm('  Ống  PVC-42 (C1) ')).toBe('ong pvc 42 c1');
    expect(aliasNorm('Dây thép buộc Đen')).toBe('day thep buoc den');
    const memory = [mem({ aliasNorm: 'ong pvc', targetId: 'a', hits: 1 }), mem({ aliasNorm: 'ong pvc', targetId: 'b', hits: 4 }), mem({ kind: 'vendor', aliasNorm: 'hanaka', targetId: 'v' })];
    expect(recall(memory, 'item', 'Ống PVC')?.targetId).toBe('b');
    expect(recall(memory, 'item', 'Hanaka')).toBeNull();
    expect(recall(memory, 'vendor', 'HANAKA')?.targetId).toBe('v');
    // Chữ quá ngắn không dùng làm khóa.
    expect(recall([mem({ aliasNorm: 'x', targetId: 'q' })], 'item', 'X')).toBeNull();
    expect(parseLearned([{ kind: 'item', aliasNorm: 'xm', targetId: 't', hits: '3' }, { kind: 'task', aliasNorm: 'a', targetId: 'b' }, null]))
      .toEqual([{ kind: 'item', alias: 'xm', aliasNorm: 'xm', targetId: 't', targetLabel: '', hits: 3 }]);
  });

  it('dạy: bỏ cặp thiếu chữ / đích; lỗi máy chủ chỉ cảnh báo, không chặn việc chính', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { saved: 1 }, error: null });
    expect(await aiLearning.learn('material_request', 'p-smb', [
      { kind: 'item', alias: 'xi măng', targetId: 'xm', targetLabel: 'Xi măng PCB40' }, { kind: 'item', alias: ' ', targetId: 'xm', targetLabel: 'X' }, { kind: 'item', alias: 'thép', targetId: '', targetLabel: 'X' },
    ])).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledWith('learn_ai_aliases_v2', { p_context: 'material_request', p_project_id: 'p-smb',
      p_pairs: [{ kind: 'item', alias: 'xi măng', targetId: 'xm', targetLabel: 'Xi măng PCB40' }] });
    expect(await aiLearning.learn('purchase_order', null, [])).toBe(0);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'AI_MEMORY_DENIED' } });
    expect(await aiLearning.learn('purchase_order', null, [{ kind: 'vendor', alias: 'Hanaka', targetId: 'v', targetLabel: 'HANAKA' }])).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('thẻ đề xuất: cách gọi đã nhớ của dự án chọn sẵn mã (nhãn "Đã nhớ") thay vì để người dùng chọn lại; mã đã ngừng thì bỏ qua trí nhớ', () => {
    const catalog: MrCatalogItem[] = [{ id: 'pvc42', name: 'Ống PVC 42', unit: 'Cây' }, { id: 'pvc34', name: 'Ống PVC 34', unit: 'Cây' }, { id: 'gone', name: 'Ống PVC 60', unit: 'Cây', status: 'retired' }];
    const lines = [{ name: 'Ống PVC', spec: null, qty: 20, unit: 'cây', note: null }];
    expect(toFormRows(lines, catalog)[0].itemId).toBeNull();
    const row = toFormRows(lines, catalog, [mem({ aliasNorm: 'ong pvc', targetId: 'pvc42' })])[0];
    expect(row).toMatchObject({ itemId: 'pvc42', qty: '20', remembered: true });
    expect(toFormRows(lines, catalog, [mem({ aliasNorm: 'ong pvc', targetId: 'gone' })])[0]).toMatchObject({ itemId: null });
  });

  it('thẻ đơn mua: tên hàng trên báo giá đã gắn mã lần trước → lấy lại đúng mã qua ô tìm của dự án (độ tin "memory")', async () => {
    const item = (id: string, name: string): ProcurementCatalogItem => ({ id, name, unit: 'Kg', sku: null, purchaseUnit: null, purchaseFactor: null, inBoq: false, boqQty: 0, orderedQty: 0 });
    const catalog = [item('d16-a', 'Thép XD D16 Hòa Phát'), item('d16-b', 'Thép XD D16 Việt Úc')];
    const search = vi.fn(async (q: string) => catalog.filter(i => i.name.toLowerCase().includes(q.toLowerCase().split(' ')[0])));
    const rows = await buildRows([{ name: 'Thép vằn D16', spec: 'CB400', qty: 6300, unit: 'kg', price: 15850 }], search,
      [mem({ aliasNorm: 'thep van d16 cb400', targetId: 'd16-b', targetLabel: 'Thép XD D16 Việt Úc' })]);
    expect(rows[0]).toMatchObject({ item: { id: 'd16-b' }, confidence: 'memory', price: '15850' });
    expect(search).toHaveBeenCalledWith('Thép XD D16 Việt Úc');
  });

  it('dislike có lý do + ghi chú gửi về ai_gateway_feedback_v2; like không kèm lý do', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    aiGateway.feedback('run-1', false, { reason: 'misunderstood', note: 'Hỏi dự án SMB mà trả XinHai' });
    aiGateway.feedback('run-2', true);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'ai_gateway_feedback_v2', { p_run_id: 'run-1', p_accepted: false, p_reason: 'misunderstood', p_note: 'Hỏi dự án SMB mà trả XinHai' });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'ai_gateway_feedback_v2', { p_run_id: 'run-2', p_accepted: true, p_reason: null, p_note: null });
  });

  it('bấm chọn dự án ngay sau báo cáo Zalo vẫn buộc gọi công cụ nhật ký (bộ kiểm hồi quy 18/10)', () => {
    const report = 'BC ngày 15/10\nNhà xưởng: Tổ Mr Ích 20 người\n- Lắp dựng cofa cổ cột\nNhà văn phòng: công nhật a Đoàn 2 người';
    const asked = [{ role: 'user' as const, content: report }, { role: 'assistant' as const, content: 'Báo cáo của dự án nào? [[goi_y:DA29]] [[goi_y:SMB-2026]]' }];
    expect(isDailyReportTurn(report, [])).toBe(true);
    expect(isDailyReportTurn('DA29', asked)).toBe(true);
    expect(isDailyReportTurn('DA29', [asked[0], { role: 'assistant', content: 'Em đã chuẩn bị thẻ.' }])).toBe(false);
    expect(isDailyReportTurn('PO-116 thế nào?', [{ role: 'user', content: 'Việc gì gấp?' }, asked[1]])).toBe(false);
  });
});

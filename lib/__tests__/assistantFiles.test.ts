import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

import { addAttachments, attachmentLabel, readTableFile, sheetToText, workbookToText, type ChatAttachment } from '../assistantFiles';
import { SourceBook, toAnthropicMessages, toOpenAIMessages } from '../../supabase/functions/ai-gateway/agent';
import { attachmentNote, buildChatPrompt, parseChatInput } from '../../supabase/functions/ai-gateway/chat';
import { converse } from '../../supabase/functions/ai-gateway/loop';
import { runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';

const B64 = 'A'.repeat(400);
const IMG = { mime: 'image/jpeg' as const, b64: B64 };

describe('Trợ lý T3 · tệp trong chat — đọc trên máy', () => {
  it('bảng → chữ: số giữ dạng máy (6300, không 6.300), bỏ hàng / cột trống, ký tự | không phá bảng; dài thì cắt và ghi rõ', () => {
    const t = sheetToText([['STT', 'Tên hàng', null, 'Số lượng', 'Đơn giá'], [], [1, 'Thép D16 | CB400', null, 6300, 15850.5], [null, null, null, null, null]]);
    expect(t.text).toBe('| STT | Tên hàng | Số lượng | Đơn giá |\n| 1 | Thép D16 / CB400 | 6300 | 15850.5 |');
    expect(t.rows).toBe(2);
    const big = workbookToText([{ name: 'Dài', matrix: Array.from({ length: 260 }, (_, i) => [i + 1, `Vật tư ${i + 1}`, 10]) }, { name: 'Trống', matrix: [[]] }]);
    expect(big.rows).toBe(260);
    expect(big.truncated).toBe(true);
    expect(big.sheets).toEqual(['Dài']);
    expect(big.text).toContain('[Sheet Dài · 260 hàng, chỉ gửi 200 hàng đầu]');
    expect(big.text.length).toBeLessThanOrEqual(14100);
    expect(big.text).toContain('đã cắt bớt');
  });

  it('đọc tệp Excel thật; tệp lạ / quá số ảnh báo lý do mà không chặn tệp khác', async () => {
    const xlsx = new File([readFileSync('tests/center/files/bao-gia-hanaka.xlsx')], 'bao-gia-hanaka.xlsx');
    const table = await readTableFile(xlsx);
    expect(table).toMatchObject({ kind: 'table', name: 'bao-gia-hanaka.xlsx', rows: 6, sheets: ['Báo giá'], truncated: false });
    expect(table.text).toContain('| 1 | Thép vằn D16 CB400 | kg | 6300 | 15850 | 99855000 |');
    const images: ChatAttachment[] = Array.from({ length: 4 }, (_, i) => ({ kind: 'image', id: `i${i}`, name: `a${i}.jpg`, mime: 'image/jpeg', b64: B64, previewUrl: '' }));
    const out = await addAttachments(images, [new File(['x'], 'hop-dong.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), new File(['x'], 'b.jpg', { type: 'image/jpeg' }), xlsx]);
    expect(out.list.map(a => a.name)).toEqual(['a0.jpg', 'a1.jpg', 'a2.jpg', 'a3.jpg', 'bao-gia-hanaka.xlsx']);
    expect(out.errors).toEqual(['hop-dong.docx: chưa đọc được loại tệp này (dùng ảnh, PDF, Excel hoặc CSV).', 'Tối đa 4 ảnh mỗi lần.']);
    expect(attachmentLabel(out.list)).toBe('📎 bao-gia-hanaka.xlsx · 4 ảnh');
  });
});

describe('Trợ lý T3 · cổng AI nhận tệp', () => {
  it('kiểm đầu vào: ảnh đúng loại / cỡ, tối đa 4 ảnh + 3 bảng; chỉ gửi tệp thì có câu mặc định; dòng tên tệp lưu vào hội thoại', () => {
    const ok = parseChatInput({ question: '', images: [IMG], files: [{ name: 'bg<x>.xlsx', text: '| a |' }] });
    expect(ok).toMatchObject({ question: 'Xem tệp đính kèm.', images: [IMG], files: [{ name: 'bg x .xlsx', text: '| a |' }] });
    expect(attachmentNote(ok)).toBe('📎 bg x .xlsx · 1 ảnh');
    expect(() => parseChatInput({ question: 'x', images: [{ mime: 'image/gif', b64: B64 }] })).toThrow('AI_BAD_INPUT');
    expect(() => parseChatInput({ question: 'Đọc giúp', images: Array(5).fill(IMG) })).toThrow('AI_BAD_INPUT');
    expect(() => parseChatInput({ question: 'Đọc giúp', files: [{ name: 'a', text: 'x'.repeat(15000) }, { name: 'b', text: 'x'.repeat(15000) }, { name: 'c', text: 'x' }] })).toThrow('AI_BAD_INPUT');
    expect(() => parseChatInput({ question: '' })).toThrow('AI_BAD_INPUT');
    expect(parseChatInput({ question: 'Việc gì gấp?' })).not.toHaveProperty('images');
  });

  it('lời nhắc: bảng trong <du_lieu loai="tep"> (dữ liệu, che SĐT), ghi có ảnh; ảnh gắn vào lượt hỏi cuối, đúng định dạng từng nhà cung cấp', async () => {
    const input = parseChatInput({ question: 'Lập đơn mua theo báo giá', images: [IMG], files: [{ name: 'bg.xlsx', text: '| NCC | 0912345678 |' }] });
    const prompt = buildChatPrompt(input, [{ role: 'user', content: 'trước' }, { role: 'assistant', content: 'ok' }], true);
    const last = prompt.messages.at(-1)!.content;
    expect(last).toContain('<du_lieu loai="tep">\nTệp bg.xlsx');
    expect(last).not.toContain('0912345678');
    expect(last).toContain('(Kèm 1 ảnh ở trên.)');
    expect(prompt.system).toContain('6.300 = 6300');
    const seen: unknown[] = [];
    await converse({ step: async req => { seen.push(req.messages); return { text: 'Xong', toolCalls: [], usage: { tokensIn: 1, tokensOut: 1 } }; }, rpc: (async () => ({ data: null, error: null })) as Rpc,
      emit: () => {}, redact: t => t, system: prompt.system, turns: prompt.messages, images: input.images, book: new SourceBook(), used: [], started: Date.now() });
    const msgs = seen[0] as Array<{ role: string; images?: unknown[] }>;
    expect(msgs.map(m => Boolean(m.images))).toEqual([false, false, true]);
    expect(toOpenAIMessages('s', [{ role: 'user', content: 'Đọc', images: [IMG] }])[1]).toEqual({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${B64}` } }, { type: 'text', text: 'Đọc' }] });
    expect(toAnthropicMessages([{ role: 'user', content: 'Đọc', images: [IMG] }])[0]).toEqual({ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: B64 } }, { type: 'text', text: 'Đọc' }] });
  });

  it('đơn mua từ ảnh: SL × giá lệch đúng 1.000 lần thành tiền (đọc nhầm 6.300 thành 6,3) thì sửa SL; lệch khác thì báo kiểm', async () => {
    const created: Array<Record<string, unknown>> = [];
    const rpc = (async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'list_procurement_proactive_options_v1') return { data: { projects: [{ id: 'p-smb', code: 'SMB-2026', name: 'SMB', warehouses: [] }] }, error: null };
      if (fn === 'assistant_command_create_v1') { created.push(args); return { data: { id: 'c1' }, error: null }; }
      return { data: [], error: null };
    }) as Rpc;
    const out = JSON.parse(await runTool('chuan_bi_don_mua', { du_an: 'SMB', vat: 8, dong: [
      { ten: 'Thép D16', so_luong: 6.3, don_vi: 'kg', don_gia: 15850, thanh_tien: 99855000 },
      { ten: 'Thép D20', so_luong: 4928, don_vi: 'kg', don_gia: 15750, thanh_tien: 77616000 },
      { ten: 'Thép D8', so_luong: 2000, don_vi: 'kg', don_gia: 16100, thanh_tien: 30000000 },
    ] }, { rpc, book: new SourceBook(), runId: 'r', emit: () => {} }, new Map()));
    expect((created[0].p_payload as { lines: Array<{ qty: number }> }).lines.map(l => l.qty)).toEqual([6300, 4928, 2000]);
    // 19/10: thành tiền báo giá đi theo thẻ để thẻ cảnh báo trên dòng lệch (D8).
    expect((created[0].p_payload as { lines: Array<{ amount?: number }> }).lines.map(l => l.amount)).toEqual([99855000, 77616000, 30000000]);
    expect(out.doi_chieu).toEqual(['Thép D16: sửa SL 6.3 → 6300 theo thành tiền', 'Thép D8: SL × đơn giá khác thành tiền trên báo giá — kiểm lại']);
  });

  it('nhật ký từ ảnh: báo cáo nằm trong ảnh thì dùng chữ model chép (noi_dung); báo cáo dán chữ vẫn lấy nguyên văn tin', async () => {
    const created: Array<Record<string, unknown>> = [];
    const rpc = (async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'assistant_daily_log_projects_v1') return { data: [{ id: 'da29', code: 'DA29', name: 'Nhà xưởng', siteId: 's' }], error: null };
      if (fn === 'assistant_command_create_v1') { created.push(args); return { data: { id: 'c1' }, error: null }; }
      return { data: null, error: { message: 'x' } };
    }) as Rpc;
    const ctx = (question: string) => ({ rpc, book: new SourceBook(), runId: 'r', emit: () => {}, question });
    const fromImage = 'BC ngày 15/10\nNhà xưởng: Tổ Mr Ích 20 người\n- Lắp dựng cofa cổ cột';
    await runTool('chuan_bi_nhat_ky', { noi_dung: fromImage }, ctx('Ghi nhật ký theo ảnh này'), new Map());
    expect((created[0].p_payload as { text: string }).text).toBe(fromImage);
    const pasted = `${fromImage}\n- Xây tường hành lang trục A, đổ bê tông giằng móng`;
    await runTool('chuan_bi_nhat_ky', { noi_dung: 'chép khác' }, ctx(pasted), new Map());
    expect((created[1].p_payload as { text: string }).text).toBe(pasted);
  });
});

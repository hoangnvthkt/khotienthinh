import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }));
vi.mock('../supabase', () => ({
  supabase: { rpc: mocks.rpc, auth: { getSession: mocks.getSession } },
  supabaseUrl: 'https://demo.supabase.co',
  supabaseAnonKey: 'anon-key',
}));

import {
  assistantChat, boldParts, displayText, isTodayThread, parseSources, takeSseEvents, textBlocks, threadDayLabel, threadTimeLabel,
} from '../assistantChat';

const sse = (...events: unknown[]) => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
const streamResponse = (chunks: string[]) => new Response(new ReadableStream({
  start(controller) { const enc = new TextEncoder(); chunks.forEach(c => controller.enqueue(enc.encode(c))); controller.close(); },
}), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
const input = { threadId: null, question: 'Việc gì gấp?', facts: 'a | b', pronoun: 'Anh' as const, context: { tab: 'assistant' } };

afterEach(() => { vi.unstubAllGlobals(); mocks.rpc.mockReset(); mocks.getSession.mockReset(); });

describe('Trợ lý v2 · màn hình — chữ', () => {
  it('tách sự kiện SSE, giữ phần dở cho lần đọc sau, bỏ nhịp ping', () => {
    const first = takeSseEvents('data: {"type":"start","runId":"r1"}\n\n: ping\n\ndata: {"type":"delta","te');
    expect(first.events).toEqual([{ type: 'start', runId: 'r1' }]);
    const second = takeSseEvents(`${first.rest}xt":"Chào"}\r\n\r\n`);
    expect(second.events).toEqual([{ type: 'delta', text: 'Chào' }]);
    expect(second.rest).toBe('');
  });

  it('ẩn khóa [[…]] đã thành nút, kể cả khóa đang gõ dở khi chữ còn chạy', () => {
    expect(displayText('PO-116 quá hạn [[item.po.po-116]]. Tiến độ trễ [[project.progress]]')).toBe('PO-116 quá hạn. Tiến độ trễ');
    expect(displayText('PO-116 quá hạn [[item.po')).toBe('PO-116 quá hạn');
    expect(displayText('PO-116 quá hạn [')).toBe('PO-116 quá hạn');
  });

  it('đoạn, gạch đầu dòng, danh sách số, chữ đậm', () => {
    expect(textBlocks('Gấp nhất:\n- **PO-116** quá hạn\n• MR chờ duyệt\n\n1. Gọi NCC\n2) Nhắc kho')).toEqual([
      { kind: 'p', text: 'Gấp nhất:' },
      { kind: 'ul', items: ['**PO-116** quá hạn', 'MR chờ duyệt'] },
      { kind: 'ol', items: ['Gọi NCC', 'Nhắc kho'] },
    ]);
    expect(boldParts('**PO-116** quá hạn')).toEqual([{ text: 'PO-116', bold: true }, { text: ' quá hạn', bold: false }]);
  });

  it('mốc trong Lịch sử: giờ nếu hôm nay, "Hôm qua", còn lại ngày/tháng', () => {
    const now = new Date(2026, 9, 18, 10, 0);
    expect(threadTimeLabel(new Date(2026, 9, 18, 9, 41).toISOString(), now)).toBe('09:41');
    expect(threadTimeLabel(new Date(2026, 9, 17, 22, 5).toISOString(), now)).toBe('Hôm qua');
    expect(threadTimeLabel(new Date(2026, 9, 4, 9, 15).toISOString(), now)).toBe('04/10');
    expect(threadDayLabel(new Date(2026, 9, 4, 9, 15).toISOString())).toBe('04/10');
    expect(isTodayThread({ lastMessageAt: new Date(2026, 9, 18, 7, 0).toISOString() }, now)).toBe(true);
    expect(isTodayThread({ lastMessageAt: new Date(2026, 9, 17, 23, 59).toISOString() }, now)).toBe(false);
  });
});

describe('Trợ lý T1 · màn hình — nguồn và công cụ', () => {
  it('nguồn: khóa bản tin giữ nguyên; hồ sơ / việc đọc thành đối tượng mở được; mục hỏng bỏ', () => {
    const out = parseSources(['item.po.po-116', { ref: 'h1', type: 'record', record: { kind: 'purchase_order', id: 'po-1', code: 'PO-646', title: 'Thép' } },
      { ref: 'h2', type: 'work', item: { source: 'po', module: 'procurement', id: 'po-9', code: 'PO-655', title: 'Xi măng' } },
      { ref: 'h3', type: 'record', record: { kind: 'bịa', id: 'x' } }, { type: 'khác' }, '']);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('item.po.po-116');
    expect(out[1]).toMatchObject({ ref: 'h1', type: 'record', record: { kind: 'purchase_order', code: 'PO-646' } });
    expect(out[2]).toMatchObject({ ref: 'h2', type: 'work', item: { source: 'po', code: 'PO-655' } });
  });

  it('sự kiện "tool" → onTool (đang tra gì)', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([sse({ type: 'start', runId: 'r1' }, { type: 'tool', name: 'ton_kho', label: 'Tồn kho', query: 'thép D16' },
      { type: 'delta', text: 'Còn 12,4 tấn' }, { type: 'done', answer: 'Còn 12,4 tấn [[h1]]', sources: [{ ref: 'h1', type: 'record', record: { kind: 'item', id: 'it-1', code: 'THEP-D16' } }] })])));
    const tools: unknown[] = [];
    const result = await assistantChat.send(input, { onDelta: () => {}, onTool: t => tools.push(t) });
    expect(tools).toEqual([{ name: 'ton_kho', label: 'Tồn kho', query: 'thép D16' }]);
    expect(result).toMatchObject({ code: 'OK', sources: [{ ref: 'h1', type: 'record', record: { code: 'THEP-D16' } }] });
  });
});

describe('Trợ lý v2 · màn hình — gửi', () => {
  it('đổ chữ dần qua onDelta, trả kết quả cuối có hội thoại, nguồn; gửi JWT người dùng', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-user' } } });
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([
      sse({ type: 'start', runId: 'run-1', model: 'claude-sonnet-5-5' }, { type: 'delta', text: 'PO-116 ' }),
      sse({ type: 'delta', text: 'quá hạn' }).slice(0, 12), sse({ type: 'delta', text: 'quá hạn' }).slice(12),
      sse({ type: 'done', threadId: 't-1', messageId: 'm-1', answer: 'PO-116 quá hạn [[item.po.po-116]]', sources: ['item.po.po-116'], model: 'claude-sonnet-5-5', saved: true }),
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];
    const onStart = vi.fn();
    const result = await assistantChat.send(input, { onStart, onDelta: d => deltas.push(d) });
    expect(deltas).toEqual(['PO-116 ', 'quá hạn']);
    expect(onStart).toHaveBeenCalledWith({ runId: 'run-1', model: 'claude-sonnet-5-5' });
    expect(result).toMatchObject({ code: 'OK', runId: 'run-1', threadId: 't-1', messageId: 'm-1', sources: ['item.po.po-116'] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://demo.supabase.co/functions/v1/ai-gateway');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-user', apikey: 'anon-key' });
    expect(JSON.parse(init.body)).toEqual({ skill: 'assistant_chat', input: { threadId: null, question: 'Việc gì gấp?', facts: 'a | b', pronoun: 'Anh' }, context: { tab: 'assistant' } });
  });

  it('lỗi trước khi chạy (JSON) → mã + số lượt; lỗi giữa chừng → mã lỗi kèm phần đã nhận; mất luồng → AI_STREAM_CUT', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-user' } } });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'AI_QUOTA', reason: 'day', usedToday: 80, dailyLimit: 80 }))
      .mockResolvedValueOnce(streamResponse([sse({ type: 'start', runId: 'r2' }, { type: 'delta', text: 'Anh có' }, { type: 'error', code: 'AI_FAILED', error: 'AI_HTTP_502' })]))
      .mockResolvedValueOnce(streamResponse([sse({ type: 'start', runId: 'r3' }, { type: 'delta', text: 'Anh' })])));
    expect(await assistantChat.send(input, { onDelta: () => {} })).toMatchObject({ code: 'AI_QUOTA', reason: 'day', usedToday: 80, dailyLimit: 80 });
    expect(await assistantChat.send(input, { onDelta: () => {} })).toMatchObject({ code: 'AI_FAILED', runId: 'r2', error: 'AI_HTTP_502', partial: 'Anh có' });
    expect(await assistantChat.send(input, { onDelta: () => {} })).toMatchObject({ code: 'AI_FAILED', runId: 'r3', error: 'AI_STREAM_CUT', partial: 'Anh' });
  });

  it('chưa đăng nhập → AI_DENIED, không gọi máy chủ; hàm chưa triển khai → AI_NOT_CONFIGURED', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.getSession.mockResolvedValueOnce({ data: { session: null } });
    expect(await assistantChat.send(input, { onDelta: () => {} })).toMatchObject({ code: 'AI_DENIED' });
    expect(fetchMock).not.toHaveBeenCalled();
    mocks.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt' } } });
    expect(await assistantChat.send(input, { onDelta: () => {} })).toMatchObject({ code: 'AI_NOT_CONFIGURED', error: 'AI_NOT_DEPLOYED' });
  });

  it('Lịch sử và mở hội thoại qua RPC; bỏ tin hỏng', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [{ id: 't-1', title: 'PO nào sắp giao?', messageCount: 2, lastMessageAt: '2026-10-04T02:15:00Z' }], error: null })
      .mockResolvedValueOnce({ data: { id: 't-1', title: 'PO nào sắp giao?', lastMessageAt: '2026-10-04T02:15:00Z', messages: [
        { id: 'm1', role: 'user', content: 'PO nào sắp giao?', createdAt: '2026-10-04T02:14:00Z' },
        { id: 'x', role: 'system', content: 'bỏ' },
        { id: 'm2', role: 'assistant', content: 'PO-116 [[item.po.po-116]]', sources: ['item.po.po-116'], runId: 'run-old', accepted: true, createdAt: '2026-10-04T02:15:00Z' },
      ] }, error: null });
    expect(await assistantChat.listThreads()).toEqual([{ id: 't-1', title: 'PO nào sắp giao?', messageCount: 2, lastMessageAt: '2026-10-04T02:15:00Z' }]);
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_ai_threads_v1', { p_limit: 30 });
    const thread = await assistantChat.getThread('t-1');
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_ai_thread_v1', { p_thread_id: 't-1', p_limit: 200 });
    expect(thread.messages.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(thread.messages[1]).toMatchObject({ runId: 'run-old', accepted: true, sources: ['item.po.po-116'] });
  });
});

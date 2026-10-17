import { describe, expect, it } from 'vitest';
import {
  buildChatPrompt, chatSystem, parseChatInput, readSse, sourceKeysOf, splitRefusal, sseEvent, threadTurns, trimHistory, type ChatTurn,
} from '../../supabase/functions/ai-gateway/chat';

const turns = (n: number, size = 40): ChatTurn[] => Array.from({ length: n }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant', content: `${i % 2 === 0 ? 'Hỏi' : 'Đáp'} ${i} ${'x'.repeat(size)}`,
}));
const streamOf = (...chunks: string[]) => new ReadableStream<Uint8Array>({
  start(controller) { const enc = new TextEncoder(); chunks.forEach(c => controller.enqueue(enc.encode(c))); controller.close(); },
});

describe('Trợ lý v2 · hội thoại — đầu vào', () => {
  it('nhận câu hỏi, số liệu, xưng hô; threadId chỉ nhận uuid', () => {
    expect(parseChatInput({ question: '  Việc gì gấp? ', facts: 'a | b', pronoun: 'Chị', threadId: 'abc' }))
      .toEqual({ threadId: null, question: 'Việc gì gấp?', facts: 'a | b', pronoun: 'Chị' });
    expect(parseChatInput({ question: 'Hỏi', threadId: '0d4c2f1e-8a5b-4c3d-9e2f-1a2b3c4d5e6f' }).threadId).toBe('0d4c2f1e-8a5b-4c3d-9e2f-1a2b3c4d5e6f');
    expect(parseChatInput({ question: 'Hỏi', pronoun: 'Ông' }).pronoun).toBe('Bạn');
    expect(() => parseChatInput({ question: ' ' })).toThrow('AI_BAD_INPUT');
  });

  it('tin của hội thoại: bỏ vai lạ và tin rỗng', () => {
    expect(threadTurns({ messages: [{ role: 'user', content: 'A' }, { role: 'system', content: 'B' }, { role: 'assistant', content: ' ' }, { role: 'assistant', content: 'C' }] }))
      .toEqual([{ role: 'user', content: 'A' }, { role: 'assistant', content: 'C' }]);
    expect(threadTurns(null)).toEqual([]);
  });
});

describe('Trợ lý v2 · hội thoại — hỏi tiếp', () => {
  it('giữ tối đa 12 tin gần nhất, bắt đầu bằng câu hỏi, câu hỏi cũ hơn thành danh sách', () => {
    const { recent, older } = trimHistory(turns(20));
    expect(recent).toHaveLength(12);
    expect(recent[0].role).toBe('user');
    expect(recent[0].content).toContain('Hỏi 8');
    expect(recent.at(-1)?.content).toContain('Đáp 19');
    expect(older).toHaveLength(4);
    expect(older[0]).toContain('Hỏi 0');
  });

  it('cắt theo 9.000 ký tự; không bao giờ bắt đầu bằng câu trả lời', () => {
    const { recent } = trimHistory(turns(8, 2000));
    expect(recent.length).toBeLessThan(8);
    expect(recent[0].role).toBe('user');
    expect(recent.reduce((n, t) => n + t.content.length, 0)).toBeLessThanOrEqual(9000 + 2100);
  });

  it('lượt hỏi chưa có trả lời bị bỏ; hai tin cùng vai liền nhau được gộp', () => {
    const { recent } = trimHistory([{ role: 'user', content: 'A' }, { role: 'user', content: 'B' }, { role: 'assistant', content: 'C' }, { role: 'user', content: 'D' }]);
    expect(recent).toEqual([{ role: 'user', content: 'A\n\nB' }, { role: 'assistant', content: 'C' }]);
  });

  it('lời nhắc: số liệu bọc <du_lieu>, câu hỏi là tin cuối, che SĐT ở mọi phần, liệt kê câu hỏi cũ', () => {
    const prompt = buildChatPrompt(
      { threadId: null, question: 'Gọi 0912 345 678 hỏi PO-116 được không?', facts: 'item.po.po-116 | Việc · PO-116: quá hạn 2 ngày', pronoun: 'Anh' },
      [...turns(16), { role: 'user', content: 'Số anh Hùng 0987654321' }, { role: 'assistant', content: 'Đã ghi.' }],
    );
    const last = prompt.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toMatch(/^<du_lieu loai="so_lieu_hom_nay">\nitem\.po\.po-116/);
    expect(last.content).toContain('Gọi [SĐT] hỏi PO-116');
    expect(prompt.messages.some(m => m.content.includes('0987654321'))).toBe(false);
    expect(prompt.hits.phone).toBe(2);
    expect(prompt.system).toContain('Gọi người dùng là "anh", xưng "em"');
    expect(prompt.system).toContain('Các câu anh đã hỏi trước đó');
    expect(prompt.historyUsed).toBe(12);
  });

  it('không xóa, không duyệt, không trả lại: lời dặn có trong mọi hội thoại', () => {
    expect(chatSystem('Bạn', [])).toMatch(/không tự gửi, duyệt, trả lại, xóa, ghi sổ/);
    expect(chatSystem('Bạn', [])).toContain('xưng "mình"');
  });
});

describe('Trợ lý v2 · hội thoại — phạm vi, từ chối lịch sự, nhiều câu hỏi (chủ SP 18/10)', () => {
  const system = chatSystem('Anh', []);

  it('lời nhắc: chỉ việc công ty; 5 loại từ chối có nhãn; trả lời lần lượt nhiều câu hỏi', () => {
    expect(system).toContain('Phạm vi: chỉ hỗ trợ công việc trong Vioo');
    for (const kind of ['ngoai_cong_viec', 'khiem_nha', 'thao_tac_cam', 'vi_pham', 'thao_tung']) expect(system).toContain(`[[tu_choi:${kind}]]`);
    expect(system).toMatch(/đòi xóa, sửa, định dạng lại, hủy, trả lại, duyệt, ghi sổ dữ liệu/);
    expect(system).toMatch(/không lặp lại lời lẽ xấu/);
    expect(system).toContain('mời anh trao đổi về công việc');
    expect(system).toContain('quá 5 câu thì trả lời 5 câu đầu');
  });

  it('tách nhãn từ chối: chữ lưu không còn nhãn, loại ghi nhật ký; nhãn lạ bị bỏ, không tính', () => {
    expect(splitRefusal('[[tu_choi:khiem_nha]] Em xin phép không trả lời câu này. Anh cần xem việc nào hôm nay?'))
      .toEqual({ text: 'Em xin phép không trả lời câu này. Anh cần xem việc nào hôm nay?', refusal: 'khiem_nha' });
    expect(splitRefusal('[[tu_choi:thao_tac_cam]]Trợ lý không xóa dữ liệu.').refusal).toBe('thao_tac_cam');
    expect(splitRefusal('[[tu_choi:linh_tinh]] Chào anh.')).toEqual({ text: 'Chào anh.', refusal: null });
    expect(splitRefusal('PO-116 quá hạn [[item.po.po-116]]')).toEqual({ text: 'PO-116 quá hạn [[item.po.po-116]]', refusal: null });
  });
});

describe('Trợ lý v2 · hội thoại — nguồn và luồng chữ', () => {
  const facts = ['project.progress | Dự án · Tiến độ: 7 việc trễ', 'item.po.po-116 | Việc · PO-116: quá hạn 2 ngày'].join('\n');

  it('chỉ giữ khóa có thật trong số liệu, không trùng', () => {
    expect(sourceKeysOf('Trễ [[project.progress]], PO [[item.po.po-116]] [[item.po.po-116]] và [[bịa.khoa]]', facts))
      .toEqual(['project.progress', 'item.po.po-116']);
  });

  it('đọc SSE cắt giữa chừng, \\r\\n, nhiều dòng data, sự kiện cuối không có dòng trống', async () => {
    const out: string[] = [];
    await readSse(streamOf('data: {"a":1}\r\n\r\nda', 'ta: {"b":2}\n\n: ping\n\ndata: x\ndata: y\n\n', 'data: [DONE]'), d => out.push(d));
    expect(out).toEqual(['{"a":1}', '{"b":2}', 'x\ny', '[DONE]']);
  });

  it('sự kiện gửi màn hình đúng định dạng SSE', () => {
    expect(sseEvent({ type: 'delta', text: 'Chào' })).toBe('data: {"type":"delta","text":"Chào"}\n\n');
  });
});

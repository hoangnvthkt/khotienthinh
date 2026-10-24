import { describe, expect, it } from 'vitest';
import { SourceBook, type AgentMsg } from '../../supabase/functions/ai-gateway/agent';
import { converse, looksLikeFabricatedRows, type StepRequest, type StepResult } from '../../supabase/functions/ai-gateway/loop';
import { chatSystem } from '../../supabase/functions/ai-gateway/chat';

// Sự cố 24/10/2026: hỏi "phòng HCNS ai chưa chấm công" → gọi công cụ, trả 8 người THẬT. Hỏi tiếp "tìm trong cả
// công ty" → model KHÔNG gọi lại công cụ, bịa 56/101 người, bịa cả tên lẫn mã (TT039 "Nguyễn Ngọc Điệp" không có
// thật) và tên phòng ("Kỹ thuật xây dựng" không tồn tại). ai_runs lượt đó ghi "0 nguồn".
// Chặn bằng mã: lượt không tra công cụ mà nêu mã nhân viên / chứng từ thì bắt đi tra thật, đúng một lần.
const BIA = 'Hôm nay toàn công ty có 56 người chưa chấm công (trong 101 người anh xem được):\n'
  + '- Bùi Thùy Linh (TT021)\n- Nguyễn Ngọc Điệp (TT039)\n- Phan Ngọc Ngân (TT029)';

const deps = (steps: Array<(req: StepRequest) => StepResult>) => {
  const seen: StepRequest[] = [];
  let i = 0;
  const used: string[] = [];
  return {
    seen, used,
    d: {
      // converse lấy chữ trả lời từ luồng delta, không từ out.text — mock phải phát delta.
      step: async (req: StepRequest, onDelta: (t: string) => void) => {
        seen.push({ ...req, messages: req.messages.map(m => ({ ...m })) as AgentMsg[] });
        const out = steps[Math.min(i++, steps.length - 1)](req);
        if (out.text) onDelta(out.text);
        return out;
      },
      rpc: (async () => ({ data: { loai: 'cham_cong', tong_so: 0, tong_nguoi_xem_duoc: 1, da_cham: 1, ket_qua: [], tom_tat: [] }, error: null })) as never,
      emit: () => {}, redact: (t: string) => t, system: 'S',
      turns: [{ role: 'user' as const, content: 'tìm trong cả công ty' }],
      book: new SourceBook(), used, started: Date.now(),
    },
  };
};
const noTool = (text: string) => (): StepResult => ({ text, toolCalls: [], usage: { tokensIn: 1, tokensOut: 1 } });
const withTool = (): StepResult => ({ text: '', toolCalls: [{ id: 't1', name: 'tinh_hinh_hom_nay', args: { loai: 'cham_cong' } }], usage: { tokensIn: 1, tokensOut: 1 } });

describe('Trợ lý · chặn bịa danh sách', () => {
  it('nhận ra câu trả lời nêu từ 2 mã trở lên', () => {
    expect(looksLikeFabricatedRows(BIA)).toBe(true);
    expect(looksLikeFabricatedRows('Đơn PO-351 và PO-349 chưa có phiếu nhận')).toBe(true);
    expect(looksLikeFabricatedRows('Anh vào màn Nhân sự > Chấm công để xem nhé.')).toBe(false);
    expect(looksLikeFabricatedRows('Em đã lưu ghi nhớ cho anh.')).toBe(false);
  });

  it('không tra công cụ mà liệt kê mã → bắt tra lại rồi mới trả lời', async () => {
    const h = deps([noTool(BIA), withTool, noTool('Hôm nay có 38 người chưa chấm công.')]);
    const out = await converse(h.d as never);
    expect(h.used).toEqual(['tinh_hinh_hom_nay']);
    expect(out.text).toBe('Hôm nay có 38 người chưa chấm công.');
    // Lời nhắc ép tra phải được đưa vào hội thoại.
    const nhac = h.seen[1].messages.find(m => m.role === 'user' && String((m as { content?: unknown }).content ?? '').includes('PHẢI gọi công cụ'));
    expect(nhac).toBeTruthy();
    expect(String((nhac as { content: string }).content)).toMatch(/đổi phạm vi .* thì phải tra lại/);
  });

  it('chỉ bắt tra lại MỘT lần, không lặp vô hạn', async () => {
    const h = deps([noTool(BIA)]);
    const out = await converse(h.d as never);
    expect(out.text).toBe(BIA);
    expect(h.seen.length).toBe(2);
  });

  it('đã tra công cụ rồi thì không bắt tra lại', async () => {
    const h = deps([withTool, noTool(BIA)]);
    await converse(h.d as never);
    expect(h.seen.length).toBe(2);
    expect(h.seen[1].messages.some(m => m.role === 'user' && String((m as { content?: unknown }).content ?? '').includes('PHẢI gọi công cụ'))).toBe(false);
  });

  it('câu trả lời không nêu mã thì để nguyên', async () => {
    const h = deps([noTool('Anh vào màn Nhân sự > Chấm công để xem nhé.')]);
    const out = await converse(h.d as never);
    expect(out.text).toMatch(/Nhân sự/);
    expect(h.seen.length).toBe(1);
  });

  it('lời nhắc cấm nêu dữ liệu công cụ không trả về ở lượt này', () => {
    const system = chatSystem('Anh', [], true, 'Thứ bảy 24/10/2026');
    expect(system).toMatch(/KHÔNG BAO GIỜ nêu tên người, mã nhân viên, mã chứng từ hay con số tổng mà công cụ ở LƯỢT NÀY không trả về/);
    expect(system).toMatch(/phải GỌI LẠI công cụ với phạm vi mới/);
    expect(system).toMatch(/tuyệt đối không tự bịa cho đủ/);
  });
});

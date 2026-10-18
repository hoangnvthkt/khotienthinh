import { describe, expect, it, vi } from 'vitest';
import {
  SourceBook, accumulateToolDeltas, finishToolCalls, parseToolArgs, toAnthropicMessages, toOpenAIMessages, type AgentMsg,
} from '../../supabase/functions/ai-gateway/agent';
import { TOOLS, runTool, searchTerms, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { converse, type StepRequest, type StepResult } from '../../supabase/functions/ai-gateway/loop';

const rpcOf = (table: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>): Rpc & { calls: Array<[string, Record<string, unknown>]> } => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const fn = (async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    const hit = table[name];
    if (hit === undefined) return { data: null, error: { message: 'PROCUREMENT_VIEW_DENIED', code: '42501' } };
    return { data: typeof hit === 'function' ? (hit as (a: Record<string, unknown>) => unknown)(args) : hit, error: null };
  }) as Rpc & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};
const PO = { kind: 'purchase_order', id: 'po-1', code: 'PO-646', title: 'Kết cấu thép 568', status: 'sent', projectId: 'smb', extra: {} };
const ITEM = { kind: 'item', id: 'it-1', code: 'THEP-D16', title: 'Thép CB400 D16', extra: { unit: 'tấn' } };
const EMP = { kind: 'employee', id: 'e-1', code: 'NV01', title: 'Nguyễn Văn A', subtitle: 'CHT · 0912345678', extra: { phone: '0912345678', email: 'a@x.vn' } };

describe('Trợ lý T1 · tin nhắn và lệnh gọi công cụ', () => {
  it('ghép mảnh tool_calls của luồng chuẩn OpenAI; tham số hỏng thành {}', () => {
    const acc = accumulateToolDeltas([], [{ index: 0, id: 'call_1', function: { name: 'ton_kho', arguments: '{"vat_' } }]);
    accumulateToolDeltas(acc, [{ index: 0, function: { arguments: 'tu":"thép D16"}' } }, { index: 1, id: 'call_2', function: { name: 'tim_ho_so', arguments: '{bad' } }]);
    expect(finishToolCalls(acc)).toEqual([{ id: 'call_1', name: 'ton_kho', args: { vat_tu: 'thép D16' } }, { id: 'call_2', name: 'tim_ho_so', args: {} }]);
    expect(parseToolArgs('')).toEqual({});
  });

  it('đổi tin nhắn trung lập sang OpenAI (tool_calls + role tool) và Anthropic (tool_use + tool_result)', () => {
    const msgs: AgentMsg[] = [
      { role: 'user', content: 'Thép D16?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'ton_kho', args: { vat_tu: 'D16' } }] },
      { role: 'tool', results: [{ id: 'c1', name: 'ton_kho', content: '{"ket_qua":[]}' }] },
    ];
    expect(toOpenAIMessages('SYS', msgs)).toEqual([
      { role: 'system', content: 'SYS' }, { role: 'user', content: 'Thép D16?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ton_kho', arguments: '{"vat_tu":"D16"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"ket_qua":[]}' },
    ]);
    expect(toAnthropicMessages(msgs)[1]).toEqual({ role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'ton_kho', input: { vat_tu: 'D16' } }] });
    expect(toAnthropicMessages(msgs)[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ket_qua":[]}' }] });
  });

  it('sổ nguồn: cấp h1, h2…; hồ sơ trùng dùng lại mã; chỉ giữ mã AI dẫn', () => {
    const book = new SourceBook();
    expect(book.record(PO)).toBe('h1');
    expect(book.work({ source: 'po', id: 'po-9', code: 'PO-655' })).toBe('h2');
    expect(book.record(PO)).toBe('h1');
    expect(book.cited('PO-646 [[h1]] và [[h9]] [[h1]]').map(s => s.ref)).toEqual(['h1']);
  });
});

describe('Trợ lý T1 · công cụ đọc (lệnh máy chủ giả)', () => {
  it('chữ tìm kiếm như ô Tìm kiếm: bỏ dấu, tối đa 6 cụm', () => {
    expect(searchTerms('Thép D16 – PCB40 đổ bê tông móng M3 khối A')).toEqual([['thep'], ['d16'], ['pcb40'], ['do'], ['be'], ['tong']]);
  });

  it('tim_ho_so: gọi search_global_v1 đúng loại, trả mã nguồn; bỏ SĐT / email nhân viên khỏi nguồn gửi màn hình', async () => {
    const rpc = rpcOf({ search_global_v1: { records: [PO, EMP] } });
    const book = new SourceBook();
    const out = JSON.parse(await runTool('tim_ho_so', { tu_khoa: 'PO-646', loai: ['purchase_order', 'employee', 'bịa'] }, { rpc, book }, new Map()));
    expect(rpc.calls[0]).toEqual(['search_global_v1', { p_terms: [['po-646']], p_kinds: ['purchase_order', 'employee'], p_limit: 8 }]);
    expect(out.ket_qua.map((r: Record<string, unknown>) => [r.ref, r.loai, r.ma])).toEqual([['h1', 'Đơn hàng', 'PO-646'], ['h2', 'Nhân viên', 'NV01']]);
    const emp = book.cited('[[h2]]')[0];
    expect(emp.type === 'record' && emp.record.extra).toEqual({});
  });

  it('ton_kho: tìm vật tư rồi đọc tồn theo kho người hỏi xem được; không còn tồn thì ghi chú', async () => {
    const rpc = rpcOf({ search_global_v1: { records: [ITEM] }, ai_stock_by_items_v1: [{ itemId: 'it-1', warehouseName: 'Kho SMB', qty: 12.4, unit: 'tấn' }, { itemId: 'it-1', warehouseName: 'Kho tổng', qty: 30 }] });
    const out = JSON.parse(await runTool('ton_kho', { vat_tu: 'thép D16' }, { rpc, book: new SourceBook() }, new Map()));
    expect(rpc.calls.map(c => c[0])).toEqual(['search_global_v1', 'ai_stock_by_items_v1']);
    expect(rpc.calls[0][1]).toMatchObject({ p_kinds: ['item'] });
    expect(out.ket_qua[0]).toMatchObject({ ref: 'h1', ma: 'THEP-D16', tong_ton: 42.4, theo_kho: [{ kho: 'Kho SMB', ton: 12.4, don_vi: 'tấn' }, { kho: 'Kho tổng', ton: 30 }] });
    const empty = JSON.parse(await runTool('ton_kho', { vat_tu: 'thép D16' }, { rpc: rpcOf({ search_global_v1: { records: [ITEM] }, ai_stock_by_items_v1: [] }), book: new SourceBook() }, new Map()));
    expect(empty.ket_qua[0].ghi_chu).toContain('Không còn tồn');
  });

  it('chi_tiet_don_mua: mã hN đã tìm dùng thẳng; không quyền → nói rõ ngoài phạm vi, không bịa', async () => {
    const refBook = new Map<string, Record<string, unknown>>();
    const book = new SourceBook();
    const rpc = rpcOf({
      search_global_v1: { records: [PO] },
      get_procurement_order_v1: { poNumber: 'PO-646', status: 'sent', vendorName: 'Hòa Phát', totalAmount: 1325000000, deliveries: [{}],
        lines: [{ name: 'Thép D16', unit: 'tấn', qty: 40, receivedQty: 32, remainingToDeliver: 8, unitPrice: 15800000 }] },
      get_procurement_po_payment_status_v1: { 'po-1': { status: 'partial', paid: 400000000, outstanding: 280000000, overdue: false } },
    });
    await runTool('tim_ho_so', { tu_khoa: 'PO-646' }, { rpc, book }, refBook);
    const out = JSON.parse(await runTool('chi_tiet_don_mua', { ma: 'h1' }, { rpc, book }, refBook));
    expect(rpc.calls.map(c => c[0])).toEqual(['search_global_v1', 'get_procurement_order_v1', 'get_procurement_po_payment_status_v1']);
    expect(out).toMatchObject({ ref: 'h1', so_po: 'PO-646', ncc: 'Hòa Phát', so_dot_giao: 1, dong: [{ dat: 40, da_nhan: 32, con_phai_giao: 8 }], thanh_toan: { da_tra: 400000000, con_no: 280000000 } });
    const denied = JSON.parse(await runTool('chi_tiet_don_mua', { ma: 'PO-646' }, { rpc: rpcOf({ search_global_v1: { records: [PO] } }), book: new SourceBook() }, new Map()));
    expect(denied.loi).toBe('Không thấy đơn hàng trong phạm vi người hỏi được xem.');
  });

  it('viec_cua_toi: nhóm tôi gửi → tab sent; lọc theo chữ; việc có mã nguồn', async () => {
    const rpc = rpcOf({ vcc_my_work_items_v1: { items: [{ source: 'po', id: 'po-9', code: 'PO-655', title: 'Xi măng', who: 'Tâm', kind: 'wait' }, { source: 'rq', id: 'rq-1', code: 'RQ-1', title: 'Máy cắt' }] } });
    const out = JSON.parse(await runTool('viec_cua_toi', { nhom: 'toi_gui', tu_khoa: 'xi măng' }, { rpc, book: new SourceBook() }, new Map()));
    expect(rpc.calls[0]).toEqual(['vcc_my_work_items_v1', { p_tab: 'sent' }]);
    expect(out).toMatchObject({ tong: 1, viec: [{ ref: 'h1', ma: 'PO-655', nguoi: 'Tâm' }] });
  });

  it('công cụ đọc + chuẩn bị nháp; không công cụ nào sửa / xóa / duyệt / gửi', () => {
    expect(TOOLS.map(t => t.name)).toEqual(['tim_ho_so', 'ton_kho', 'chi_tiet_don_mua', 'chi_tiet_de_xuat', 'viec_cua_toi', 'chuan_bi_don_nghi_phep', 'chuan_bi_de_xuat_vat_tu']);
    for (const t of TOOLS) expect(t.name).not.toMatch(/tao|sua|xoa|duyet|tra_lai|huy|gui/);
  });
});

describe('Trợ lý T1 · vòng gọi công cụ (model giả)', () => {
  const base = (step: (req: StepRequest, onDelta: (t: string) => void) => Promise<StepResult>, extra: Partial<Parameters<typeof converse>[0]> = {}) => {
    const events: Array<Record<string, unknown>> = [];
    const used: string[] = [];
    const book = new SourceBook();
    const run = converse({ step, rpc: rpcOf({ search_global_v1: { records: [ITEM, EMP] }, ai_stock_by_items_v1: [{ itemId: 'it-1', warehouseName: 'Kho SMB', qty: 12.4, unit: 'tấn' }] }),
      emit: e => events.push(e), redact: t => t.replace(/0\d{9}/g, '[SĐT]'), system: 'SYS', turns: [{ role: 'user', content: 'Thép D16?' }], book, used, started: 0, now: () => 0, ...extra });
    return { run, events, used, book };
  };

  it('tra → nhận kết quả (đã che SĐT) → trả lời; báo màn hình đang tra; nối chữ các bước', async () => {
    const seen: StepRequest[] = [];
    const step = vi.fn(async (req: StepRequest, onDelta: (t: string) => void): Promise<StepResult> => {
      seen.push(JSON.parse(JSON.stringify(req)));
      if (seen.length === 1) { onDelta('Để em tra.'); return { text: 'Để em tra.', toolCalls: [{ id: 'c1', name: 'ton_kho', args: { vat_tu: 'thép D16' } }, { id: 'c2', name: 'tim_ho_so', args: { tu_khoa: 'A' } }], usage: { tokensIn: 100, tokensOut: 5 } }; }
      onDelta('Còn 12,4 tấn [[h1]].'); return { text: 'Còn 12,4 tấn [[h1]].', toolCalls: [], usage: { tokensIn: 300, tokensOut: 20 } };
    });
    const { run, events, used, book } = base(step);
    const out = await run;
    expect(out.text).toBe('Để em tra.\n\nCòn 12,4 tấn [[h1]].');
    expect(out.usage).toEqual({ tokensIn: 400, tokensOut: 25, calls: 2 });
    expect(used).toEqual(['ton_kho', 'tim_ho_so']);
    expect(events.filter(e => e.type === 'tool')).toEqual([{ type: 'tool', name: 'ton_kho', label: 'Tồn kho', query: 'thép D16' }, { type: 'tool', name: 'tim_ho_so', label: 'Tìm hồ sơ', query: 'A' }]);
    const toolMsg = seen[1].messages.at(-1) as Extract<AgentMsg, { role: 'tool' }>;
    expect(toolMsg.results.map(r => r.id)).toEqual(['c1', 'c2']);
    expect(toolMsg.results[1].content).not.toContain('0912345678');
    expect(seen[0].toolChoice).toBe('auto');
    expect(book.cited(out.text)[0]).toMatchObject({ type: 'record', record: { code: 'THEP-D16' } });
  });

  it('hết bước / hết thời gian: bước cuối bắt trả lời, không gọi thêm công cụ', async () => {
    let n = 0;
    const step = vi.fn(async (req: StepRequest, onDelta: (t: string) => void): Promise<StepResult> => {
      n++;
      if (req.toolChoice === 'none') { onDelta('Trả lời từ dữ liệu đã có.'); return { text: 'Trả lời từ dữ liệu đã có.', toolCalls: [], usage: { tokensIn: 1, tokensOut: 1 } }; }
      return { text: '', toolCalls: [{ id: `c${n}`, name: 'tim_ho_so', args: { tu_khoa: 'x' } }], usage: { tokensIn: 1, tokensOut: 1 } };
    });
    const { run, used } = base(step);
    expect((await run).text).toBe('Trả lời từ dữ liệu đã có.');
    expect(used).toHaveLength(5);
    let clock = 0;
    const slow = base(step, { now: () => (clock += 50_000) });
    await slow.run;
    expect(slow.used.length).toBeLessThan(3);
  });
});

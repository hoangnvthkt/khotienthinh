import { describe, expect, it } from 'vitest';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { TOOLS, TOOL_LABEL, headcountChart, headcountRange, runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { chatSystem } from '../../supabase/functions/ai-gateway/chat';
import { lineAxis, panelRows, parseChart, seriesMissing } from '../assistantChart';
import { parseMessage, parseSources, takeSseEvents } from '../assistantChat';

// Chủ SP 19/10: "Hãy thống kê giúp tôi biểu đồ biến động nhân sự 6 tháng đầu năm" → công cụ lấy số theo quyền, thẻ biểu đồ trong chat.
// Số giống prod 19/10: 61 → 68 người, 8 người chưa có ngày vào, 3 người đã nghỉ chưa có ngày nghỉ.
const TREND = {
  from: '2026-01-01', to: '2026-06-30', today: '2026-10-19', opening: 61,
  months: [
    { month: '2026-01', endDate: '2026-01-31', hired: 0, left: 0, headcount: 61 },
    { month: '2026-02', endDate: '2026-02-28', hired: 0, left: 0, headcount: 61 },
    { month: '2026-03', endDate: '2026-03-31', hired: 0, left: 0, headcount: 61 },
    { month: '2026-04', endDate: '2026-04-30', hired: 2, left: 0, headcount: 63 },
    { month: '2026-05', endDate: '2026-05-31', hired: 2, left: 0, headcount: 65 },
    { month: '2026-06', endDate: '2026-06-30', hired: 3, left: 0, headcount: 68 },
  ],
  activeNow: 91, activeNoStartDate: 8, resignedNoExitDate: 3, resignedWithExitDate: 0,
};
const rpcOf = (data: unknown, error: { message?: string; code?: string } | null = null): Rpc & { calls: Array<[string, Record<string, unknown>]> } => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const fn = (async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return { data, error }; }) as Rpc & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};

describe('Trợ lý · biến động nhân sự — khoảng tháng', () => {
  it('"6 tháng đầu năm" → 01/01 đến hết 30/06; thiếu → 6 tháng gần nhất đến tháng này', () => {
    expect(headcountRange({ tu_thang: '2026-01', den_thang: '2026-06' }, '2026-10-19')).toEqual({ from: '2026-01-01', to: '2026-06-30' });
    expect(headcountRange({}, '2026-10-19')).toEqual({ from: '2026-05-01', to: '2026-10-31' });
    expect(headcountRange({ den_thang: '2026-02' }, '2026-10-19')).toEqual({ from: '2025-09-01', to: '2026-02-28' });
  });
  it('tháng hỏng, đảo, ở tương lai, quá 24 tháng → lỗi để hỏi lại', () => {
    expect(headcountRange({ tu_thang: '2026-13' }, '2026-10-19')).toHaveProperty('loi');
    expect(headcountRange({ tu_thang: '2026-06', den_thang: '2026-01' }, '2026-10-19')).toHaveProperty('loi');
    expect(headcountRange({ tu_thang: '2027-01', den_thang: '2027-03' }, '2026-10-19')).toHaveProperty('loi');
    expect(headcountRange({ tu_thang: '2024-01', den_thang: '2026-01' }, '2026-10-19')).toHaveProperty('loi');
  });
});

describe('Trợ lý · biến động nhân sự — thẻ biểu đồ', () => {
  it('ô số: đầu kỳ, cuối kỳ, vào làm cộng đúng; nghỉ việc chưa ai có ngày → "chưa có số" (null), không ghi 0', () => {
    const built = headcountChart(TREND)!;
    expect(built.chart.title).toBe('Biến động nhân sự T1–T6/2026');
    expect(built.chart.stats.map(s => [s.label, s.value])).toEqual([['Đầu kỳ', 61], ['Cuối kỳ', 68], ['Vào làm', 7], ['Nghỉ việc', null]]);
    expect(built.chart.labels).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
    expect(built.chart.panels[1].series[1].values.every(v => v === null)).toBe(true);
    expect(built.chart.notes).toEqual([
      '8 người đang làm chưa có ngày vào làm — chưa tính vào tháng nào.',
      '3 người đã nghỉ chưa có ngày nghỉ việc — chưa có số nghỉ việc theo tháng.',
    ]);
    expect(built.forModel).toMatchObject({ dau_ky: 61, cuoi_ky: 68, chenh_lech: 7, tong_vao_lam: 7, tong_nghi_viec: 'chưa có số (chưa ghi ngày nghỉ việc)' });
  });
  it('đã có người ghi ngày nghỉ → cột nghỉ có số; còn người thiếu ngày thì ghi "có thể thiếu"', () => {
    const built = headcountChart({ ...TREND, resignedWithExitDate: 2, months: TREND.months.map(m => (m.month === '2026-03' ? { ...m, left: 1 } : m)) })!;
    expect(built.chart.stats[3]).toMatchObject({ label: 'Nghỉ việc', value: 1 });
    expect(built.chart.notes[1]).toContain('có thể thiếu');
  });
  it('khoảng qua năm → nhãn có năm: "T11/25"…; một tháng → "T6/2026"', () => {
    const cross = headcountChart({ ...TREND, months: [{ month: '2025-11', endDate: '2025-11-30', hired: 1, left: 0, headcount: 60 }, { month: '2026-01', endDate: '2026-01-31', hired: 0, left: 0, headcount: 60 }] })!;
    expect(cross.chart.labels).toEqual(['T11/25', 'T1/26']);
    expect(cross.chart.title).toBe('Biến động nhân sự T11/25–T1/26');
    expect(headcountChart({ ...TREND, months: [TREND.months[5]] })!.chart.title).toBe('Biến động nhân sự T6/2026');
    expect(headcountChart({ months: [] })).toBeNull();
  });
});

describe('Trợ lý · công cụ bien_dong_nhan_su', () => {
  it('mô tả có các cách hỏi thường gặp để model tự chọn; có nhãn trạng thái; lời nhắc dặn không tự vẽ biểu đồ khác', () => {
    const tool = TOOLS.find(t => t.name === 'bien_dong_nhan_su')!;
    for (const phrase of ['biểu đồ', 'biến động', 'nghỉ việc', '6 tháng đầu năm']) expect(tool.description).toContain(phrase);
    expect(TOOL_LABEL.bien_dong_nhan_su).toBe('Biến động nhân sự');
    expect(chatSystem('Anh', [], true)).toContain('bien_dong_nhan_su');
    expect(chatSystem('Anh', [], true)).toContain('chưa vẽ được biểu đồ đó');
  });
  it('gọi RPC đúng khoảng, hiện thẻ (sự kiện chart) và ghi vào sổ nguồn để lưu cùng câu trả lời', async () => {
    const rpc = rpcOf(TREND);
    const book = new SourceBook();
    const events: Array<Record<string, unknown>> = [];
    const out = JSON.parse(await runTool('bien_dong_nhan_su', { tu_thang: '2026-01', den_thang: '2026-06' }, { rpc, book, emit: e => events.push(e) }, new Map()));
    expect(rpc.calls).toEqual([['get_hrm_headcount_trend_v1', { p_from: '2026-01-01', p_to: '2026-06-30' }]]);
    expect(out).toMatchObject({ da_hien_bieu_do: true, dau_ky: 61, cuoi_ky: 68 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'chart', chart: { ref: 'b1', type: 'chart' } });
    expect(book.chartSources).toHaveLength(1);
    expect(book.cited('Tăng 7 người.')).toEqual([]);
  });
  it('máy chủ chặn 42501 → báo ngoài quyền xem, không hiện thẻ, không bịa số', async () => {
    const book = new SourceBook();
    const events: unknown[] = [];
    const out = JSON.parse(await runTool('bien_dong_nhan_su', {}, { rpc: rpcOf(null, { code: '42501', message: 'HRM_HEADCOUNT_DENIED' }), book, emit: e => events.push(e) }, new Map()));
    expect(out.loi).toContain('Ngoài phạm vi người hỏi được xem');
    expect(events).toEqual([]);
    expect(book.chartSources).toEqual([]);
  });
  it('tối đa 2 thẻ mỗi lượt (vừa chỗ lưu hội thoại)', () => {
    const book = new SourceBook();
    expect([book.chart({}), book.chart({}), book.chart({})]).toEqual(['b1', 'b2', null]);
  });
});

describe('Màn hình · đọc thẻ biểu đồ', () => {
  const chart = headcountChart(TREND)!.chart;
  it('đọc lại thẻ máy chủ dựng; lưu trong sources nên mở Lịch sử vẫn thấy; bản cũ không có thẻ vẫn đọc được', () => {
    const spec = parseChart(chart)!;
    expect(spec.stats[3]).toEqual({ label: 'Nghỉ việc', value: null, hint: 'chưa có ngày nghỉ' });
    expect(spec.link).toEqual({ route: '/hrm/employees', label: 'Hồ sơ nhân sự' });
    expect(seriesMissing(spec.panels[1].series[1])).toBe(true);
    expect(panelRows(spec, spec.panels[0])[5]).toEqual({ label: 'T6', values: [68] });
    const msg = parseMessage({ id: 'm1', role: 'assistant', content: 'Tăng 7 người.', sources: ['item.x', { ref: 'b1', type: 'chart', chart }], createdAt: '' })!;
    expect(msg.sources.filter(s => typeof s !== 'string' && s.type === 'chart')).toHaveLength(1);
  });
  it('thẻ hỏng / lạ bị bỏ; link phải là đường dẫn trong app', () => {
    expect(parseChart({ labels: [], panels: [] })).toBeNull();
    expect(parseChart({ labels: ['T1'], panels: [{ series: [] }] })).toBeNull();
    expect(parseChart({ ...chart, link: { route: 'https://x.vn', label: 'x' } })!.link).toBeNull();
    expect(parseSources([{ ref: 'b1', type: 'chart', chart: { labels: [] } }])).toEqual([]);
  });
  it('trục khung đường bám sát số (61→68), mốc tròn, không âm', () => {
    expect(lineAxis(parseChart(chart)!.panels[0])).toEqual({ domain: [60, 70], ticks: [60, 65, 70] });
    expect(lineAxis({ title: '', kind: 'line', unit: '', series: [{ label: '', values: [0, 1] }] })).toEqual({ domain: [0, 2], ticks: [0, 1, 2] });
    expect(lineAxis({ title: '', kind: 'line', unit: '', series: [{ label: '', values: [120, 180] }] }).ticks).toEqual([100, 120, 140, 160, 180, 200]);
  });
  it('sự kiện chart trong luồng SSE', () => {
    const { events } = takeSseEvents(`data: ${JSON.stringify({ type: 'chart', chart: { ref: 'b1', type: 'chart', chart } })}\n\n`);
    expect(parseSources([events[0].chart])).toHaveLength(1);
  });
});

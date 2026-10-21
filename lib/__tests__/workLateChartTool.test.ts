import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { TOOLS, TOOL_INFO, TOOL_LABEL, runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { isoWeekOf, latePeriod, lateChart } from '../../supabase/functions/ai-gateway/workTools';
import { chatSystem } from '../../supabase/functions/ai-gateway/chat';
import { parseChart } from '../assistantChart';

// Vioo Work Đợt 2 PR-7 · công cụ Trợ lý tre_han_theo_don_vi: "Phòng nào trễ nhiều nhất tuần trước?" → thẻ biểu đồ theo quyền người hỏi.
// Tên người giả. Hôm nay cố định: thứ 4 21/10/2026 10:00 giờ VN.
const UNITS = [
  { id: 'u-qlda', code: 'QLDA', name: 'Phòng Quản lý dự án', people: 6, due: 10, ontime: 6, overdue: 3, prevDue: 8, prevOntime: 7 },
  { id: 'u-tckt', code: 'TCKT', name: 'Phòng Tài chính kế toán', people: 4, due: 5, ontime: 5, overdue: 0, prevDue: 4, prevOntime: 4 },
  { id: 'u-kh', code: 'KH', name: 'Phòng Kế hoạch', people: 3, due: 0, ontime: 0, overdue: 0, prevDue: 0, prevOntime: 0 },
  { id: 'u-xd', code: null, name: 'Ban chỉ huy công trường XinHai', people: 9, due: 4, ontime: 1, overdue: 1, prevDue: 3, prevOntime: 3 },
];
const MEMBERS = [
  { userId: 'p-an', name: 'Lê Minh An', due: 3, ontime: 3, overdue: 0, prevDue: 2, prevOntime: 1 },
  { userId: 'p-khoi', name: 'Tạ Minh Khôi', due: 4, ontime: 1, overdue: 2, prevDue: 3, prevOntime: 3 },
  { userId: 'p-huy', name: 'Ngô Gia Huy', due: 0, ontime: 0, overdue: 0, prevDue: 0, prevOntime: 0 },
];
const QLDA = { id: 'u-qlda', code: 'QLDA', name: 'Phòng Quản lý dự án' };
const DENIED = { code: '42501', message: 'WORK_BOARD_DENIED' };

type Role = 'bld' | 'head' | 'staff';
/** Lệnh máy chủ giả theo vai: BLĐ xem toàn công ty + mọi đơn vị; trưởng QLDA chỉ đơn vị mình; nhân viên không bảng nào. */
const rpcFor = (role: Role, overrides: Record<string, unknown> = {}) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const rpc = (async (fn: string, args: Record<string, unknown>) => {
    calls.push([fn, args]);
    if (fn in overrides) return { data: overrides[fn], error: null };
    if (fn === 'work_company_board_v1') return role === 'bld' ? { data: { units: UNITS }, error: null } : { data: null, error: DENIED };
    if (fn === 'work_board_access_v1') return { data: { myUnits: role === 'head' ? [QLDA] : [], company: role === 'bld' }, error: null };
    if (fn === 'work_team_board_v1') return role === 'bld' || (role === 'head' && args.p_org_unit_id === 'u-qlda') ? { data: { unit: QLDA, members: MEMBERS }, error: null } : { data: null, error: DENIED };
    if (fn === 'work_tasks_overview_v1') return /qlda|quan ly/i.test(String(args.p_unit_query)) ? { data: { unit: QLDA, total: 0, items: [] }, error: null }
      : /phong/i.test(String(args.p_unit_query)) ? { data: { code: 'UNIT_AMBIGUOUS', units: [QLDA, { id: 'u-tckt', code: 'TCKT', name: 'Phòng Tài chính kế toán' }] }, error: null }
        : { data: { code: 'UNIT_NOT_FOUND' }, error: null };
    return { data: null, error: { message: 'not in fixture', code: 'X' } };
  }) as Rpc & { calls: typeof calls };
  rpc.calls = calls;
  return rpc;
};
const run = async (role: Role, args: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
  const rpc = rpcFor(role, overrides);
  const book = new SourceBook();
  const events: Array<Record<string, unknown>> = [];
  const out = JSON.parse(await runTool('tre_han_theo_don_vi', args, { rpc, book, emit: e => events.push(e) }, new Map()));
  const chart = (events[0]?.chart as { chart?: unknown } | undefined)?.chart;
  return { out, rpc, book, events, spec: chart ? parseChart(chart) : null, raw: chart as Record<string, unknown> | undefined };
};

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T03:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('Vioo Work PR-7 · kỳ của tre_han_theo_don_vi (giờ VN, như màn Vioo Work)', () => {
  it('tuần / tháng / quý: kỳ trước liền trước, kỳ đang chạy cắt đến hôm nay, nhãn như màn', () => {
    expect(latePeriod({}, '2026-10-21')).toEqual({ from: '2026-10-12', to: '2026-10-18', fullTo: '2026-10-18', prevFrom: '2026-10-05', prevTo: '2026-10-11',
      label: 'Tuần 42 · 12–18/10', prevLabel: 'tuần 41', running: false });
    expect(latePeriod({ ky: 'tuan_nay' }, '2026-10-21')).toMatchObject({ from: '2026-10-19', to: '2026-10-21', fullTo: '2026-10-25', prevFrom: '2026-10-12', prevTo: '2026-10-18', running: true });
    expect(latePeriod({ ky: 'thang_nay' }, '2026-10-21')).toMatchObject({ from: '2026-10-01', to: '2026-10-21', prevFrom: '2026-09-01', prevTo: '2026-09-30', label: 'Tháng 10/2026', prevLabel: 'tháng 9' });
    expect(latePeriod({ ky: 'thang_truoc' }, '2026-03-10')).toMatchObject({ from: '2026-02-01', to: '2026-02-28', prevFrom: '2026-01-01', prevTo: '2026-01-31', running: false });
    expect(latePeriod({ ky: 'quy_nay' }, '2026-10-21')).toMatchObject({ from: '2026-10-01', to: '2026-10-21', fullTo: '2026-12-31', prevFrom: '2026-07-01', prevTo: '2026-09-30', label: 'Quý 4/2026', prevLabel: 'quý 3' });
    expect(latePeriod({ ky: 'quy_truoc' }, '2026-01-05')).toMatchObject({ from: '2025-10-01', to: '2025-12-31', prevFrom: '2025-07-01', prevTo: '2025-09-30', label: 'Quý 4/2025' });
    expect(latePeriod({ ky: 'thang_truoc' }, '2026-01-05')).toMatchObject({ from: '2025-12-01', to: '2025-12-31', prevFrom: '2025-11-01', prevTo: '2025-11-30' });
    expect(latePeriod({ ky: 'linh_tinh' }, '2026-10-21')).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
    expect([isoWeekOf('2026-10-12'), isoWeekOf('2025-12-29'), isoWeekOf('2027-01-01')]).toEqual([42, 1, 53]);
  });

  it('khoảng ngày tùy chọn: sắp lại hai đầu, cắt đến hôm nay, kỳ trước cùng số ngày; tương lai / sai dạng báo lỗi', () => {
    expect(latePeriod({ tu_ngay: '2026-10-10', den_ngay: '2026-10-01' }, '2026-10-21')).toMatchObject({ from: '2026-10-01', to: '2026-10-10', prevFrom: '2026-09-21', prevTo: '2026-09-30', label: '01/10 – 10/10', prevLabel: 'kỳ trước' });
    expect(latePeriod({ tu_ngay: '2026-10-15' }, '2026-10-21')).toMatchObject({ from: '2026-10-15', to: '2026-10-21' });
    expect(latePeriod({ tu_ngay: '2026-10-15', den_ngay: '2026-12-01' }, '2026-10-21')).toMatchObject({ to: '2026-10-21' });
    expect(latePeriod({ tu_ngay: '2026-11-01' }, '2026-10-21')).toHaveProperty('loi');
    expect(latePeriod({ tu_ngay: '2026-02-30' }, '2026-10-21')).toHaveProperty('loi');
    expect(latePeriod({ den_ngay: '2026-10-10' }, '2026-10-21')).toHaveProperty('loi');
  });
});

describe('Vioo Work PR-7 · công cụ tre_han_theo_don_vi theo quyền', () => {
  it('đăng ký đủ: mô tả có cách hỏi, nhãn, dòng "Xem bên trong" loại biểu đồ, lời nhắc Trợ lý có hướng dẫn', () => {
    const tool = TOOLS.find(t => t.name === 'tre_han_theo_don_vi')!;
    for (const phrase of ['phòng nào trễ nhiều nhất', 'BIỂU ĐỒ', 'don_vi']) expect(tool.description).toContain(phrase);
    expect(TOOL_LABEL.tre_han_theo_don_vi).toBe('Trễ hạn theo đơn vị');
    expect(TOOL_INFO.tre_han_theo_don_vi).toMatchObject({ kind: 'bieu_do' });
    expect(chatSystem('Anh', [], true)).toContain('tre_han_theo_don_vi');
  });

  it('BLĐ: bảng toàn công ty đúng kỳ → thẻ theo đơn vị xếp trễ giảm dần, bỏ đơn vị chưa có việc đến hạn, số gọn cho model', async () => {
    const { out, rpc, book, events, spec, raw } = await run('bld', { ky: 'tuan_truoc' });
    expect(rpc.calls).toEqual([['work_company_board_v1', { p_week_start: null, p_from: '2026-10-12', p_to: '2026-10-18', p_prev_from: '2026-10-05', p_prev_to: '2026-10-11' }]]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'chart', chart: { ref: 'b1', type: 'chart' } });
    expect(book.chartSources).toHaveLength(1);
    expect(raw?.v).toBe(1);
    expect(spec).not.toBeNull();
    expect(spec!.title).toBe('Trễ hạn theo đơn vị · Tuần 42 · 12–18/10');
    expect(spec!.stats).toEqual([
      { label: 'Đúng hạn %', value: 63, hint: 'tuần 41: 93% (−30 điểm)' },
      { label: 'Không đúng hạn', value: 7, hint: 'trên 19 việc đến hạn' },
      { label: 'Đang quá hạn', value: 4, hint: 'việc đang mở, tính đến hôm nay' },
      { label: 'Trễ nhiều nhất', value: 7, hint: 'QLDA' },
    ]);
    const [stacked, bar] = spec!.panels;
    expect(stacked).toMatchObject({ kind: 'stacked', unit: 'việc', labels: ['QLDA', 'Ban chỉ huy công trường XinHai', 'TCKT'] });
    expect(stacked.series).toEqual([{ label: 'Không đúng hạn trong kỳ', values: [4, 3, 0] }, { label: 'Đang quá hạn', values: [3, 1, 0] }]);
    expect(bar).toMatchObject({ kind: 'bar', unit: '%', series: [{ label: 'Đúng hạn', values: [60, 25, 100] }] });
    expect(spec!.labels.every(l => l.length <= 16)).toBe(true);
    expect(spec!.notes).toContain('1 đơn vị chưa có việc đến hạn, không có việc quá hạn — không vẽ.');
    expect(spec!.source).toBe('Vioo Work · Tuần 42 · 12–18/10');
    expect(spec!.link).toEqual({ route: '/work/my?space=company&from=2026-10-12&to=2026-10-18', label: 'Toàn công ty' });
    expect(out).toMatchObject({ pham_vi: 'Toàn công ty', dung_han: '63%', ky_truoc: 'tuần 41: 93%', khong_dung_han: 7, dang_qua_han: 4, da_hien_bieu_do: true,
      tre_nhieu_nhat: 'QLDA: 4 không đúng hạn, 3 đang quá hạn', chua_co_viec_den_han: 1 });
    expect(out.xep_hang[0]).toEqual({ ten: 'QLDA', den_han: 10, khong_dung_han: 4, dang_qua_han: 3, dung_han: '60%' });
    expect(out.pham_vi_xem).toBeUndefined();
  });

  it('BLĐ hỏi một phòng: khớp đơn vị rồi bảng đơn vị → thẻ theo người; tháng này là kỳ đang chạy', async () => {
    const { out, rpc, spec } = await run('bld', { ky: 'thang_nay', don_vi: 'QLDA' });
    expect(rpc.calls.map(c => c[0])).toEqual(['work_tasks_overview_v1', 'work_team_board_v1']);
    expect(rpc.calls[0][1]).toMatchObject({ p_unit_query: 'QLDA', p_limit: 1 });
    expect(rpc.calls[1][1]).toEqual({ p_org_unit_id: 'u-qlda', p_week_start: null, p_from: '2026-10-01', p_to: '2026-10-21', p_prev_from: '2026-09-01', p_prev_to: '2026-09-30' });
    expect(spec!.title).toBe('Trễ hạn theo người · QLDA · Tháng 10/2026');
    expect(spec!.panels[0].labels).toEqual(['Tạ Minh Khôi', 'Lê Minh An']);
    expect(spec!.panels[1].series[0].values).toEqual([25, 100]);
    expect(spec!.stats[3]).toEqual({ label: 'Trễ nhiều nhất', value: 5, hint: 'Tạ Minh Khôi' });
    expect(spec!.notes[0]).toBe('Kỳ đang chạy: số tính đến 21/10.');
    expect(spec!.link).toEqual({ route: '/work/my?space=team&unit=u-qlda&from=2026-10-01&to=2026-10-31', label: 'QLDA' });
    expect(out).toMatchObject({ pham_vi: 'Phòng Quản lý dự án', theo: 'từng người trong đơn vị', dung_han: '57%', ky_truoc: 'tháng 9: 80%', tre_nhieu_nhat: 'Tạ Minh Khôi: 3 không đúng hạn, 2 đang quá hạn' });
  });

  it('trưởng đơn vị hỏi toàn công ty: máy chủ chặn → tự xem đơn vị mình làm trưởng, nói rõ phạm vi', async () => {
    const { out, rpc, spec } = await run('head', {});
    expect(rpc.calls.map(c => c[0])).toEqual(['work_company_board_v1', 'work_board_access_v1', 'work_team_board_v1']);
    expect(rpc.calls[2][1]).toMatchObject({ p_org_unit_id: 'u-qlda', p_from: '2026-10-12', p_to: '2026-10-18' });
    expect(spec!.title).toBe('Trễ hạn theo người · QLDA · Tuần 42 · 12–18/10');
    expect(spec!.link).toEqual({ route: '/work/my?space=team&unit=u-qlda&from=2026-10-12&to=2026-10-18', label: 'Phòng tôi' });
    expect(out.pham_vi_xem).toMatch(/không xem được toàn công ty/);
    expect(out.loi).toBeUndefined();
  });

  it('trưởng đơn vị hỏi phòng khác / nhân viên: ngoài phạm vi, không thẻ, không số', async () => {
    const other = await run('head', { don_vi: 'Quản lý' }, { work_tasks_overview_v1: { unit: { id: 'u-tckt', code: 'TCKT', name: 'Phòng Tài chính kế toán' } } });
    expect(other.out.loi).toContain('Ngoài phạm vi người hỏi được xem');
    expect(other.events).toEqual([]);
    const staff = await run('staff', {});
    expect(staff.rpc.calls.map(c => c[0])).toEqual(['work_company_board_v1', 'work_board_access_v1']);
    expect(staff.out.loi).toContain('Ngoài phạm vi người hỏi được xem');
    expect(staff.events).toEqual([]);
    expect(staff.book.chartSources).toEqual([]);
    const staffUnit = await run('staff', { don_vi: 'QLDA' });
    expect(staffUnit.out.loi).toContain('Ngoài phạm vi người hỏi được xem');
    expect(JSON.stringify(staffUnit.out)).not.toMatch(/Tạ Minh Khôi|\d+%/);
  });

  it('đơn vị trùng / không thấy → hỏi lại bằng danh sách; không gọi bảng', async () => {
    const many = await run('bld', { don_vi: 'Phong' });
    expect(many.out.trung_don_vi).toEqual(['QLDA · Phòng Quản lý dự án', 'TCKT · Phòng Tài chính kế toán']);
    expect(many.rpc.calls.map(c => c[0])).toEqual(['work_tasks_overview_v1']);
    const none = await run('bld', { don_vi: 'Xưởng' });
    expect(none.out.loi).toContain('Không thấy đơn vị');
  });

  it('kỳ chưa có việc đến hạn, không ai quá hạn → không vẽ, không ghi 0%', async () => {
    const empty = await run('bld', { ky: 'tuan_nay' }, { work_company_board_v1: { units: UNITS.map(u => ({ ...u, due: 0, ontime: 0, overdue: 0, prevDue: 0, prevOntime: 0 })) } });
    expect(empty.events).toEqual([]);
    expect(empty.out).toMatchObject({ da_hien_bieu_do: false, dung_han: 'chưa có việc đến hạn' });
    expect(JSON.stringify({ ...empty.out, ghi_chu: '' })).not.toContain('0%');
  });

  it('nhiều hơn 12 đơn vị → vẽ 12 trễ nhất + ghi chú còn lại; tối đa 4 ghi chú; thẻ qua parseChart', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `u${i}`, code: `P${i}`, name: `Phòng ${i}`, due: 10, ontime: 10 - (i % 5), overdue: i % 3, prevDue: 10, prevOntime: 9 }));
    const p = latePeriod({ ky: 'tuan_nay' }, '2026-10-21');
    if ('loi' in p) throw new Error(p.loi);
    const built = lateChart({ units: [...many, { id: 'z', code: 'Z', name: 'Z', due: 0, ontime: 0, overdue: 0 }] }, { unit: null }, p, '2026-10-21');
    const spec = parseChart(built.chart)!;
    expect(spec.panels[0].labels).toHaveLength(12);
    expect(spec.notes).toHaveLength(4);
    expect(spec.notes).toContain('Còn 3 đơn vị ít trễ hơn không vẽ — mở bảng để xem đủ.');
    const badness = spec.panels[0].labels!.map((_, i) => (spec.panels[0].series[0].values[i] ?? 0) + (spec.panels[0].series[1].values[i] ?? 0));
    expect([...badness].sort((a, b) => b - a)).toEqual(badness);
  });
});

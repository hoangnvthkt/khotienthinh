import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), submit: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../leaveService', () => ({ leaveService: { submit: mocks.submit } }));

import { executeCommand, finishCommand, getCommand, isCommandExpired, leaveRangeLabel, leaveView, mrDraftRoute, mrRequestRoute, mrView, notifyCommandChanged,
  onCommandChanged, parseCommand, parseCommands } from '../assistantCommands';
import { displayText, suggestionsOf } from '../assistantChat';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { TOOLS, matchLeaveType, matchProjects, runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { buildChatPrompt, chatSystem, leaveTypesLine, mentionsLeave, vnTodayLabel } from '../../supabase/functions/ai-gateway/chat';

afterEach(() => { mocks.rpc.mockReset(); mocks.submit.mockReset(); });

const RAW = { id: 'c1', kind: 'leave_request', status: 'prepared', title: 'Đơn phép năm 21/10', createdAt: '2026-10-18T02:00:00Z',
  payload: { type: 'annual', typeName: 'Phép năm', start: '2026-10-21', end: '2026-10-22', startSession: 'afternoon', endSession: 'morning', reason: 'Việc gia đình' },
  preview: { days: 1, annualRemaining: 6, steps: [{ label: 'Quản lý trực tiếp', name: 'Hà Đức Chuẩn' }], problems: [] } };
const TYPES = [
  { code: 'annual', name: 'Phép năm', unit: 'day', requiresAttachment: false },
  { code: 'sick', name: 'Nghỉ ốm', unit: 'day', requiresAttachment: true },
  { code: 'late', name: 'Đi muộn / về sớm', unit: 'minute' },
  { code: 'unpaid', name: 'Việc riêng không lương', unit: 'day' },
];
const rpcOf = (table: Record<string, unknown>) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const rpc = (async (fn: string, args: Record<string, unknown>) => {
    calls.push([fn, args]);
    const hit = table[fn];
    if (hit instanceof Error) return { data: null, error: { message: hit.message, code: 'P0001' } };
    return { data: hit ?? null, error: hit === undefined ? { message: 'unknown', code: 'X' } : null };
  }) as Rpc;
  return { rpc, calls };
};

describe('Trợ lý T2a · lệnh nháp — màn hình', () => {
  it('đọc lệnh: bỏ loại lạ; thẻ nghỉ phép: buổi, số ngày, người duyệt', () => {
    // Loại lạ (bản app cũ gặp loại lệnh mới) vẫn giữ để thẻ nhắc tải lại; thiếu id / kind thì bỏ.
    expect(parseCommands([RAW, { id: 'x', kind: 'loai_moi' }, { id: 'y' }, null]).map(c => c.kind)).toEqual(['leave_request', 'unknown']);
    const v = leaveView(parseCommand(RAW)!);
    expect(v).toMatchObject({ typeName: 'Phép năm', days: 1, annualRemaining: 6, steps: [{ label: 'Quản lý trực tiếp', name: 'Hà Đức Chuẩn' }], problems: [] });
    expect(leaveRangeLabel(v)).toBe('21/10 buổi chiều → 22/10 buổi sáng');
    expect(leaveRangeLabel({ ...v, end: v.start, startSession: 'full' })).toBe('21/10 cả ngày');
  });

  it('thẻ nháp quá 24 giờ thì hết hạn; đã gửi thì không', () => {
    const c = parseCommand(RAW)!;
    expect(isCommandExpired(c, new Date('2026-10-18T20:00:00Z'))).toBe(false);
    expect(isCommandExpired(c, new Date('2026-10-19T03:00:00Z'))).toBe(true);
    expect(isCommandExpired({ ...c, status: 'done' }, new Date('2026-10-30T00:00:00Z'))).toBe(false);
  });

  it('Gửi đơn: đúng lệnh gửi của module Nghỉ phép, lý do đã sửa, trả mã đơn cho biên nhận', async () => {
    mocks.submit.mockResolvedValue({ id: 'lr-1', code: 'NP-2026-0099' });
    const result = await executeCommand(parseCommand(RAW)!, { reason: '  Đưa con đi khám ' });
    expect(mocks.submit).toHaveBeenCalledWith({ type: 'annual', start: '2026-10-21', end: '2026-10-22', startSession: 'afternoon', endSession: 'morning',
      minutes: null, subtype: null, reason: 'Đưa con đi khám' });
    expect(result).toEqual({ code: 'NP-2026-0099', id: 'lr-1', route: '/hrm/leave' });
    mocks.rpc.mockResolvedValue({ data: { ...RAW, status: 'done', result }, error: null });
    expect((await finishCommand('c1', 'done', result))?.status).toBe('done');
    expect(mocks.rpc).toHaveBeenCalledWith('assistant_command_finish_v1', { p_id: 'c1', p_status: 'done', p_result: result, p_error: null });
  });
});

describe('Trợ lý T2a · công cụ chuẩn bị đơn nghỉ phép (lệnh máy chủ giả)', () => {
  const ctx = (table: Record<string, unknown>) => {
    const { rpc, calls } = rpcOf(table);
    const events: Array<Record<string, unknown>> = [];
    return { calls, events, ctx: { rpc, book: new SourceBook(), runId: 'run-1', emit: (e: Record<string, unknown>) => events.push(e) } };
  };
  const ok = { assistant_leave_types_v1: TYPES, preview_my_leave_request: { days: 1, annualRemaining: 6, steps: [{ label: 'Quản lý trực tiếp', name: 'Hà Đức Chuẩn' }], problems: [] },
    assistant_command_create_v1: { ...RAW, id: 'cmd-9' } };

  it('khớp loại theo tên (bỏ dấu); tên mơ hồ / không có → hỏi lại', () => {
    expect(matchLeaveType('phep nam', TYPES)?.code).toBe('annual');
    expect(matchLeaveType('ốm', TYPES)?.code).toBe('sick');
    expect(matchLeaveType('nghỉ', TYPES)).toBeNull();
    expect(matchLeaveType('xin nghỉ phép', TYPES)?.code).toBe('annual');
    expect(matchLeaveType('đi muộn', TYPES)?.code).toBe('late');
    expect(matchLeaveType('', TYPES)).toBeNull();
  });

  it('chuẩn bị: xem trước đúng tham số, ghi lệnh vào lượt AI, hiện thẻ; AI chỉ nhận "đã hiện thẻ", không có lệnh gửi', async () => {
    const t = ctx(ok);
    const out = JSON.parse(await runTool('chuan_bi_don_nghi_phep', { loai: 'phép năm', tu_ngay: '2026-10-21', ly_do: 'Việc gia đình', buoi_bat_dau: 'chieu' }, t.ctx, new Map()));
    expect(t.calls.map(c => c[0])).toEqual(['assistant_leave_types_v1', 'preview_my_leave_request', 'assistant_command_create_v1']);
    expect(t.calls[1][1]).toEqual({ p_type: 'annual', p_start: '2026-10-21', p_end: '2026-10-21', p_start_session: 'afternoon', p_end_session: 'afternoon', p_minutes: null, p_subtype: null });
    expect(t.calls[2][1]).toMatchObject({ p_run_id: 'run-1', p_kind: 'leave_request', p_title: 'Đơn phép năm 21/10', p_payload: { type: 'annual', reason: 'Việc gia đình', startSession: 'afternoon' } });
    expect(t.events).toEqual([{ type: 'command', command: { ...RAW, id: 'cmd-9' } }]);
    expect(out).toMatchObject({ da_hien_the: true, loai: 'Phép năm', so_ngay: 1, phep_nam_con: 6, nguoi_duyet: [{ buoc: 'Quản lý trực tiếp', nguoi: 'Hà Đức Chuẩn' }] });
    expect(out.ghi_chu).toContain('Không nói là đã gửi');
    expect(t.calls.some(c => /submit/.test(c[0]))).toBe(false);
  });

  it('thiếu / sai thông tin → hỏi lại, không ghi lệnh; loại tính phút → mở màn Nghỉ phép; xem trước báo lỗi → nói lỗi', async () => {
    for (const [args, expected] of [
      [{ loai: 'nghỉ', tu_ngay: '2026-10-21', ly_do: 'abc' }, 'Chưa rõ loại nghỉ'],
      [{ loai: 'phép năm', tu_ngay: '21/10', ly_do: 'abc' }, 'Ngày chưa đúng'],
      [{ loai: 'phép năm', tu_ngay: '2026-10-22', den_ngay: '2026-10-21', ly_do: 'abc' }, 'Ngày chưa đúng'],
      [{ loai: 'phép năm', tu_ngay: '2026-10-21', ly_do: 'a' }, 'Thiếu lý do'],
      [{ loai: 'đi muộn', tu_ngay: '2026-10-21', ly_do: 'kẹt xe' }, 'tính theo phút'],
    ] as const) {
      const t = ctx(ok);
      const out = JSON.parse(await runTool('chuan_bi_don_nghi_phep', args, t.ctx, new Map()));
      expect(out.loi).toContain(expected);
      expect(t.calls.some(c => c[0] === 'assistant_command_create_v1')).toBe(false);
      expect(t.events).toEqual([]);
    }
    const t = ctx({ ...ok, preview_my_leave_request: new Error('Tài khoản chưa liên kết hồ sơ nhân sự.') });
    expect(JSON.parse(await runTool('chuan_bi_don_nghi_phep', { loai: 'phép năm', tu_ngay: '2026-10-21', ly_do: 'abc' }, t.ctx, new Map())).loi).toBe('Tài khoản chưa liên kết hồ sơ nhân sự.');
  });

  it('danh sách công cụ: chỉ đọc + chuẩn bị; không có công cụ gửi / xóa / duyệt / trả lại', () => {
    expect(TOOLS.map(t => t.name)).toEqual(['tim_ho_so', 'ton_kho', 'chi_tiet_don_mua', 'chi_tiet_de_xuat', 'viec_cua_toi', 'phep_nhan_vien', 'chi_tiet_ho_so', 'so_tay', 'quyen_cua_toi', 'lech_kiem_soat', 'giai_thich_loi', 'bao_cao', 'bien_dong_nhan_su', 'chuan_bi_don_nghi_phep', 'chuan_bi_de_xuat_vat_tu', 'chuan_bi_don_mua', 'chuan_bi_nhat_ky', 'chuan_bi_ghi_nho', 'chuan_bi_su_co', 'viec_giao', 'tom_tat_viec', 'chuan_bi_giao_viec', 'tre_han_theo_don_vi']);
    for (const t of TOOLS) expect(t.name).not.toMatch(/gui|xoa|duyet|tra_lai|huy|ghi_so|submit|delete|approve/);
  });

  it('lời nhắc biết hôm nay (giờ VN) và luật lệnh nháp: hỏi lại khi thiếu, không bao giờ nói đã gửi', () => {
    expect(vnTodayLabel(new Date('2026-10-17T20:30:00Z'))).toBe('Chủ nhật 18/10/2026 (2026-10-18)');
    const system = chatSystem('Anh', [], true, 'Thứ bảy 18/10/2026 (2026-10-18)');
    expect(system).toContain('Hôm nay là Thứ bảy 18/10/2026 (2026-10-18) (giờ Việt Nam).');
    expect(system).toContain('Không bao giờ nói là đã gửi, đã tạo hay đã duyệt');
    expect(system).toContain('điều còn thiếu (loại, ngày, lý do…) để hỏi lại');
  });
});

// ── T2b: đề xuất vật tư + gợi ý bấm ─────────────────────────────────────────────────────────────────────────────────────
const MR = { id: 'm1', kind: 'material_request', status: 'prepared', title: 'Đề xuất vật tư SMB-2026', createdAt: '2026-10-18T02:00:00Z',
  payload: { projectId: 'p-smb', projectCode: 'SMB-2026', projectName: 'Nhà máy SMB', siteId: 's-1', title: 'Vật tư đổ bê tông sàn tầng 4',
    purpose: 'Đổ bê tông sàn tầng 4', neededDate: '2026-10-23',
    lines: [{ name: 'Xi măng PCB40', qty: 2, unit: 'tấn' }, { name: 'Thép', spec: 'D16', qty: 0, unit: 'cây' }, { name: '' }] }, preview: { lineCount: 2 } };
const PROJECTS = [
  { id: 'p-smb', code: 'SMB-2026', name: 'Nhà máy SMB Hưng Yên', siteId: 's-1' },
  { id: 'p-da29', code: 'DA29', name: 'Nhà xưởng XinHai', siteId: 's-2' },
  { id: 'p-hy', code: 'HY-VPP', name: 'Văn phòng Hưng Yên' },
];

describe('Trợ lý T2b · đề xuất vật tư — màn hình', () => {
  it('thẻ: dòng không tên bỏ, số lượng 0 coi như chưa có; mở form đúng dự án + lệnh; biên nhận mở đúng phiếu', () => {
    const c = parseCommand(MR)!;
    const v = mrView(c);
    expect(v.lines).toEqual([
      { name: 'Xi măng PCB40', spec: null, qty: 2, unit: 'tấn', note: null },
      { name: 'Thép', spec: 'D16', qty: null, unit: 'cây', note: null },
    ]);
    expect(v).toMatchObject({ projectCode: 'SMB-2026', neededDate: '2026-10-23', title: 'Vật tư đổ bê tông sàn tầng 4' });
    expect(mrDraftRoute(c)).toBe('/da?projectId=p-smb&tab=material&materialTab=request&assistantDraft=m1&siteId=s-1');
    expect(mrRequestRoute({ ...c, status: 'done', result: { id: 'mr-9', code: 'MR-2026-0042' } })).toBe('/da?projectId=p-smb&tab=material&materialTab=request&requestId=mr-9');
  });

  it('form đọc lệnh của chính mình; lưu xong báo thẻ cùng trang đổi thành biên nhận', async () => {
    mocks.rpc.mockResolvedValue({ data: MR, error: null });
    expect((await getCommand('m1'))?.kind).toBe('material_request');
    expect(mocks.rpc).toHaveBeenCalledWith('assistant_command_get_v1', { p_id: 'm1' });
    vi.stubGlobal('window', new EventTarget()); // thẻ và form cùng trang: sự kiện trên window
    const seen: string[] = [];
    const off = onCommandChanged('m1', c => seen.push(c.status));
    notifyCommandChanged({ ...parseCommand(MR)!, id: 'other', status: 'done' });
    notifyCommandChanged({ ...parseCommand(MR)!, status: 'done' });
    off();
    notifyCommandChanged({ ...parseCommand(MR)!, status: 'cancelled' });
    expect(seen).toEqual(['done']);
    vi.unstubAllGlobals();
  });

  it('gợi ý bấm: lấy nhãn [[goi_y:…]] (bỏ trùng, tối đa 6), chữ hiện không còn nhãn', () => {
    const text = 'Anh nghỉ loại nào? [[goi_y:Phép năm]] [[goi_y:Ốm đau (BHXH)]] [[goi_y:phép năm]] [[goi_y: Việc riêng không lương ]]';
    expect(suggestionsOf(text)).toEqual(['Phép năm', 'Ốm đau (BHXH)', 'Việc riêng không lương']);
    expect(displayText(text)).toBe('Anh nghỉ loại nào?');
    expect(suggestionsOf(Array.from({ length: 9 }, (_, i) => `[[goi_y:Dự án ${i}]]`).join(' '))).toHaveLength(6);
    expect(suggestionsOf('PO-116 quá hạn [[item.po.po-116]]')).toEqual([]);
  });
});

describe('Trợ lý T2b · công cụ chuẩn bị đề xuất vật tư (lệnh máy chủ giả)', () => {
  const ctx = (table: Record<string, unknown>, projectId: string | null = null) => {
    const { rpc, calls } = rpcOf(table);
    const events: Array<Record<string, unknown>> = [];
    return { calls, events, ctx: { rpc, book: new SourceBook(), runId: 'run-2', projectId, emit: (e: Record<string, unknown>) => events.push(e) } };
  };
  const ok = { assistant_mr_projects_v1: PROJECTS, assistant_command_create_v1: { ...MR, id: 'cmd-mr' } };
  const LINES = [{ ten: 'xi măng PCB40', so_luong: 2, don_vi: 'tấn' }, { ten: 'thép', quy_cach: 'D16', don_vi: 'cây' }];

  it('khớp dự án theo mã / tên (bỏ dấu, bỏ "dự án"); mơ hồ thì trả nhiều', () => {
    expect(matchProjects('smb', PROJECTS).map(p => p.id)).toEqual(['p-smb']);
    expect(matchProjects('dự án DA29', PROJECTS).map(p => p.id)).toEqual(['p-da29']);
    expect(matchProjects('xinhai', PROJECTS).map(p => p.id)).toEqual(['p-da29']);
    expect(matchProjects('hưng yên', PROJECTS).map(p => p.id)).toEqual(['p-smb', 'p-hy']);
    expect(matchProjects('dự án', PROJECTS)).toEqual([]);
  });

  it('chuẩn bị: dự án theo lời người dùng, ghi lệnh material_request vào lượt AI, hiện thẻ; không gọi lệnh lập / gửi phiếu', async () => {
    const t = ctx(ok, 'p-da29');
    const out = JSON.parse(await runTool('chuan_bi_de_xuat_vat_tu', { du_an: 'SMB-2026 · Nhà máy SMB Hưng Yên', muc_dich: 'Đổ bê tông sàn tầng 4', ngay_can: '2099-12-31', dong: LINES }, t.ctx, new Map()));
    expect(t.calls.map(c => c[0])).toEqual(['assistant_mr_projects_v1', 'assistant_command_create_v1']);
    expect(t.calls[1][1]).toMatchObject({ p_run_id: 'run-2', p_kind: 'material_request', p_title: 'Đề xuất vật tư SMB-2026',
      p_payload: { projectId: 'p-smb', siteId: 's-1', title: 'Đổ bê tông sàn tầng 4', neededDate: '2099-12-31',
        lines: [{ name: 'xi măng PCB40', qty: 2, unit: 'tấn' }, { name: 'thép', spec: 'D16', unit: 'cây' }] },
      p_preview: { lineCount: 2, missingQty: 1 } });
    expect(t.events).toEqual([{ type: 'command', command: { ...MR, id: 'cmd-mr' } }]);
    expect(out).toMatchObject({ da_hien_the: true, du_an: 'SMB-2026 · Nhà máy SMB Hưng Yên', so_dong: 2, dong_chua_co_so_luong: 1 });
    expect(out.ghi_chu).toContain('Không nói là đã gửi');
  });

  it('chưa nói dự án → KHÔNG tự lấy dự án đang xem: hỏi lại, dự án đang xem đứng đầu gợi ý (chủ SP 18/10)', async () => {
    const t = ctx(ok, 'p-da29');
    const out = JSON.parse(await runTool('chuan_bi_de_xuat_vat_tu', { dong: LINES }, t.ctx, new Map()));
    expect(out.cac_du_an).toEqual(['DA29 · Nhà xưởng XinHai', 'SMB-2026 · Nhà máy SMB Hưng Yên', 'HY-VPP · Văn phòng Hưng Yên']);
    expect(out.du_an_dang_xem).toBe('DA29 · Nhà xưởng XinHai');
    expect(out.can_hoi).toContain('Chưa chuẩn bị gì');
    expect(t.calls.some(c => c[0] === 'assistant_command_create_v1')).toBe(false);
    expect(t.events).toEqual([]);
  });

  it('dự án chưa rõ → trả danh sách để hỏi bằng gợi ý bấm, không ghi lệnh; chỉ có một dự án thì dùng luôn', async () => {
    const t = ctx(ok);
    const out = JSON.parse(await runTool('chuan_bi_de_xuat_vat_tu', { du_an: 'Hưng Yên', dong: LINES }, t.ctx, new Map()));
    expect(out.cac_du_an).toEqual(['SMB-2026 · Nhà máy SMB Hưng Yên', 'HY-VPP · Văn phòng Hưng Yên']);
    expect(out.can_hoi).toContain('gợi ý bấm');
    expect(t.calls.some(c => c[0] === 'assistant_command_create_v1')).toBe(false);
    const none = JSON.parse(await runTool('chuan_bi_de_xuat_vat_tu', { du_an: 'ABC', dong: LINES }, ctx(ok).ctx, new Map()));
    expect(none.loi).toContain('Không thấy dự án "ABC"');
    expect(none.cac_du_an).toHaveLength(3);
    const single = ctx({ ...ok, assistant_mr_projects_v1: [PROJECTS[1]] });
    expect(JSON.parse(await runTool('chuan_bi_de_xuat_vat_tu', { dong: LINES }, single.ctx, new Map())).da_hien_the).toBe(true);
  });

  it('không có dòng / ngày cần đã qua / không có quyền dự án nào → nói rõ, không ghi lệnh', async () => {
    for (const [table, args, expected] of [
      [ok, { dong: [{ ten: '' }] }, 'Chưa có vật tư'],
      [ok, { du_an: 'smb', ngay_can: '2020-01-01', dong: LINES }, 'Ngày cần chưa đúng'],
      [{ ...ok, assistant_mr_projects_v1: [] }, { dong: LINES }, 'chưa được lập đề xuất vật tư'],
    ] as const) {
      const t = ctx(table as Record<string, unknown>);
      const out = JSON.parse(await runTool('chuan_bi_de_xuat_vat_tu', args as Record<string, unknown>, t.ctx, new Map()));
      expect(out.loi).toContain(expected);
      expect(t.calls.some(c => c[0] === 'assistant_command_create_v1')).toBe(false);
    }
  });

  it('lời nhắc: gợi ý bấm [[goi_y:…]] khi có từ 2 phương án; đề xuất vật tư nhắc mở form', () => {
    const system = chatSystem('Anh', [], true);
    expect(system).toContain('[[goi_y:Phép năm]]');
    expect(system).toContain('không liệt kê lại các phương án bằng chữ');
    expect(system).toContain('bấm **Gửi duyệt** ngay trên thẻ');
    expect(chatSystem('Anh', [], false)).toContain('Gợi ý bấm');
  });

  it('hỏi về nghỉ phép → nạp đúng tên loại nghỉ thật vào lời nhắc (bỏ loại tính phút) để gợi ý không bịa', () => {
    expect(mentionsLeave('Xin nghỉ')).toBe(true);
    expect(mentionsLeave('Phép năm', [])).toBe(true);
    expect(mentionsLeave('Ngày mai', [{ role: 'user', content: 'Anh muốn xin nghỉ' }, { role: 'assistant', content: 'Loại nào?' }])).toBe(true);
    expect(mentionsLeave('PO-646 giao đủ chưa?')).toBe(false);
    const line = leaveTypesLine(TYPES);
    expect(line).toEqual(['Loại nghỉ phép đang dùng ở công ty (chỉ dùng đúng các tên này): Phép năm; Nghỉ ốm; Việc riêng không lương.']);
    expect(leaveTypesLine([])).toEqual([]);
    const prompt = buildChatPrompt({ threadId: null, question: 'Xin nghỉ', facts: '', pronoun: 'Anh' }, [], true, '', line);
    expect(prompt.system).toContain('Phép năm; Nghỉ ốm; Việc riêng không lương');
  });
});

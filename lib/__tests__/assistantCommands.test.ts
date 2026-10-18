import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), submit: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../leaveService', () => ({ leaveService: { submit: mocks.submit } }));

import { executeCommand, finishCommand, isCommandExpired, leaveRangeLabel, leaveView, parseCommand, parseCommands } from '../assistantCommands';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { TOOLS, matchLeaveType, runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { chatSystem, vnTodayLabel } from '../../supabase/functions/ai-gateway/chat';

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
    expect(parseCommands([RAW, { id: 'x', kind: 'xoa_du_lieu' }, null])).toHaveLength(1);
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
    expect(TOOLS.map(t => t.name)).toEqual(['tim_ho_so', 'ton_kho', 'chi_tiet_don_mua', 'chi_tiet_de_xuat', 'viec_cua_toi', 'chuan_bi_don_nghi_phep']);
    for (const t of TOOLS) expect(t.name).not.toMatch(/gui|xoa|duyet|tra_lai|huy|ghi_so|submit|delete|approve/);
  });

  it('lời nhắc biết hôm nay (giờ VN) và luật lệnh nháp: hỏi lại khi thiếu, không bao giờ nói đã gửi', () => {
    expect(vnTodayLabel(new Date('2026-10-17T20:30:00Z'))).toBe('Chủ nhật 18/10/2026 (2026-10-18)');
    const system = chatSystem('Anh', [], true, 'Thứ bảy 18/10/2026 (2026-10-18)');
    expect(system).toContain('Hôm nay là Thứ bảy 18/10/2026 (2026-10-18) (giờ Việt Nam).');
    expect(system).toContain('Không bao giờ nói là đã gửi, đã tạo hay đã duyệt');
    expect(system).toContain('thiếu thông tin (loại, ngày, lý do…) thì hỏi lại');
  });
});

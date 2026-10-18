import { describe, expect, it } from 'vitest';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { TOOLS, TOOL_LABEL, leaveBalanceOf, leaveYearOf, matchEmployees, runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { chatSystem } from '../../supabase/functions/ai-gateway/chat';

// Chủ SP 18/10 tối: Admin hỏi "nhân viên Hương còn bao nhiêu ngày phép năm" → Trợ lý tự nói "chỉ xem được của chính anh"
// dù Admin có quyền HR. Quyền do RPC get_hrm_leave_ledger quyết (42501), không phải lời nhắc.
const rpcOf = (table: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>, deniedCode = '42501'): Rpc & { calls: Array<[string, Record<string, unknown>]> } => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const fn = (async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    const hit = table[name];
    if (hit === undefined) return { data: null, error: { message: 'Chỉ xem được sổ phép của chính mình.', code: deniedCode } };
    return { data: typeof hit === 'function' ? (hit as (a: Record<string, unknown>) => unknown)(args) : hit, error: null };
  }) as Rpc & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};
const HUONG = { kind: 'employee', id: 'e-huong', code: 'TT123456', title: 'Nguyễn Thị Hương', subtitle: 'TP TCKT · 0912345678', status: 'Đang làm việc', extra: { phone: '0912345678', email: 'h@x.vn' } };
const HUONG2 = { kind: 'employee', id: 'e-huong2', code: 'TT654321', title: 'Trần Thu Hương', subtitle: 'Kế toán · 0987654321', status: 'Đang làm việc', extra: {} };
const BALANCE = { year: 2026, accruedDays: 12, usedPaidDays: 4.5, usedUnpaidDays: 1, carriedDays: 2, carryUsedDays: 2, carryExpiredDays: 0, carryExpiresOn: '2026-03-31', carryLeft: 0, availableDays: 9.5, pendingDays: 1 };
const LEDGER = { balance: BALANCE, entries: [
  { id: 'l2', kind: 'leave', days: -1.5, balanceAfter: 9.5, note: null, createdAt: '2026-10-02T03:00:00Z', leaveCode: 'NP-2026-031', leaveStart: '2026-10-06', leaveEnd: '2026-10-07' },
  { id: 'l1', kind: 'accrual', days: 12, balanceAfter: 14, note: 'Cấp phép năm 2026', createdAt: '2026-01-01T00:00:00Z' },
] };
const ctx = (rpc: Rpc) => ({ rpc, book: new SourceBook() });

describe('Trợ lý · số phép nhân viên — tham số', () => {
  it('năm: số hợp lệ 2000–2100, chuỗi "2025" cũng được; thiếu / hỏng → năm hiện tại giờ VN', () => {
    expect(leaveYearOf(2025, '2026-10-18')).toBe(2025);
    expect(leaveYearOf('2024', '2026-10-18')).toBe(2024);
    expect(leaveYearOf(undefined, '2026-10-18')).toBe(2026);
    expect(leaveYearOf(1999, '2026-10-18')).toBe(2026);
    expect(leaveYearOf('năm nay', '2026-10-18')).toBe(2026);
  });

  it('chọn nhân viên: trùng mã → một người; trùng tên đầy đủ → đúng người; chỉ tên gọi → mọi người có tên đó (hỏi lại); bỏ "nhân viên", "chị"', () => {
    expect(matchEmployees('tt123456', [HUONG, HUONG2])).toEqual([HUONG]);
    expect(matchEmployees('Nguyễn Thị Hương', [HUONG, HUONG2])).toEqual([HUONG]);
    expect(matchEmployees('chị Hương', [HUONG, HUONG2])).toEqual([HUONG, HUONG2]);
    expect(matchEmployees('nhân viên Thu Hương', [HUONG, HUONG2])).toEqual([HUONG2]);
    expect(matchEmployees('', [HUONG])).toEqual([]);
  });

  it('số dư: khóa tiếng Việt, không có sổ → null (không ghi 0)', () => {
    expect(leaveBalanceOf(BALANCE)).toEqual({ duoc_huong: 12, chuyen_tu_nam_truoc: 2, phep_chuyen_het_han: 0, phep_chuyen_con_dung_duoc: 0, han_dung_phep_chuyen: '2026-03-31',
      da_nghi_co_luong: 4.5, da_nghi_khong_luong: 1, con_lai: 9.5, dang_cho_duyet: 1 });
    expect(leaveBalanceOf(null)).toBeNull();
    expect(leaveBalanceOf({})).toBeNull();
  });

  it('công cụ có trong danh sách với nhãn "Số phép nhân viên"; lời nhắc không tự giới hạn nhân sự của chính người hỏi', () => {
    expect(TOOLS.find(t => t.name === 'phep_nhan_vien')?.parameters).toMatchObject({ properties: { ten: expect.anything(), nam: expect.anything(), toan_cong_ty: expect.anything() } });
    expect(TOOL_LABEL.phep_nhan_vien).toBe('Số phép nhân viên');
    const system = chatSystem('Anh', [], true, 'Chủ nhật 18/10/2026');
    expect(system).not.toContain('nhân sự của chính người hỏi');
    expect(system).toContain('của người khác khi có quyền HR');
    expect(system).toMatch(/phep_nhan_vien.*không tự kết luận là không có quyền/);
  });
});

describe('Trợ lý · số phép nhân viên — tra bằng lệnh máy chủ giả', () => {
  it('HR / Admin hỏi người khác: tìm danh bạ → get_hrm_leave_ledger đúng người, đúng năm; có mã nguồn, số còn lại, ghi sổ gần nhất', async () => {
    const rpc = rpcOf({ search_global_v1: { records: [HUONG] }, get_hrm_leave_ledger: LEDGER });
    const c = ctx(rpc);
    const out = JSON.parse(await runTool('phep_nhan_vien', { ten: 'Hương', nam: 2026 }, c, new Map()));
    expect(rpc.calls.map(x => x[0])).toEqual(['search_global_v1', 'get_hrm_leave_ledger']);
    expect(rpc.calls[0][1]).toMatchObject({ p_kinds: ['employee'], p_terms: [['huong']] });
    expect(rpc.calls[1][1]).toEqual({ p_employee_id: 'e-huong', p_year: 2026 });
    expect(out).toMatchObject({ ref: 'h1', ten: 'Nguyễn Thị Hương', ma_nv: 'TT123456', nam: 2026, phep_nam: { con_lai: 9.5, dang_cho_duyet: 1, da_nghi_co_luong: 4.5 }, so_lan_ghi_so: 2 });
    expect(out.ghi_so_gan_nhat[0]).toEqual({ ngay: '2026-10-02', loai: 'nghỉ phép', so_ngay: -1.5, don: 'NP-2026-031', nghi_tu: '2026-10-06', nghi_den: '2026-10-07', con_sau_do: 9.5 });
    expect(out.ghi_chu).toBeUndefined();
    const src = c.book.cited('[[h1]]')[0];
    expect(src.type === 'record' && src.record).toMatchObject({ kind: 'employee', id: 'e-huong', code: 'TT123456', extra: {} });
  });

  it('nhân viên thường hỏi người khác: RPC chặn 42501 → nói rõ không có quyền, không bịa số; không gọi gì thêm', async () => {
    const rpc = rpcOf({ search_global_v1: { records: [HUONG] } });
    const out = JSON.parse(await runTool('phep_nhan_vien', { ten: 'Nguyễn Thị Hương' }, ctx(rpc), new Map()));
    expect(rpc.calls.map(x => x[0])).toEqual(['search_global_v1', 'get_hrm_leave_ledger']);
    expect(out).toEqual({ loi: expect.stringContaining('không có quyền xem số phép của Nguyễn Thị Hương') });
    expect(out.loi).toContain('không đoán số');
  });

  it('trùng tên: trả danh sách để hỏi lại bằng gợi ý bấm, chưa tra sổ phép; chức danh không kèm SĐT', async () => {
    const rpc = rpcOf({ search_global_v1: { records: [HUONG, HUONG2] }, get_hrm_leave_ledger: LEDGER });
    const out = JSON.parse(await runTool('phep_nhan_vien', { ten: 'Hương' }, ctx(rpc), new Map()));
    expect(rpc.calls.map(x => x[0])).toEqual(['search_global_v1']);
    expect(out.can_hoi).toContain('gợi ý bấm');
    expect(out.cac_nhan_vien).toEqual([
      { ref: 'h1', ma_nv: 'TT123456', ten: 'Nguyễn Thị Hương', chuc_danh: 'TP TCKT', trang_thai: 'Đang làm việc' },
      { ref: 'h2', ma_nv: 'TT654321', ten: 'Trần Thu Hương', chuc_danh: 'Kế toán', trang_thai: 'Đang làm việc' },
    ]);
  });

  it('không thấy tên / không có quyền danh bạ → nói rõ, không bịa', async () => {
    const none = JSON.parse(await runTool('phep_nhan_vien', { ten: 'Xyz' }, ctx(rpcOf({ search_global_v1: { records: [] } })), new Map()));
    expect(none.loi).toContain('Không thấy nhân viên "Xyz"');
    const denied = JSON.parse(await runTool('phep_nhan_vien', { ten: 'Hương' }, ctx(rpcOf({})), new Map()));
    expect(denied.loi).toBe('Không thấy danh bạ nhân viên trong phạm vi người hỏi được xem.');
  });

  it('bỏ trống tên = chính mình: current_app_user_id → danh bạ (hồ sơ gắn tài khoản, ưu tiên đang làm việc) → sổ phép; chưa có sổ thì nói chưa có, không ghi 0', async () => {
    const rpc = rpcOf({ current_app_user_id: 'u-1', list_hrm_employee_directory: [
      { id: 'e-old', employee_code: 'NV00', full_name: 'Tôi (cũ)', user_id: 'u-1', status: 'Đã nghỉ việc' },
      { id: 'e-me', employee_code: 'TT000001', full_name: 'Nguyễn Văn Hoàng', title: 'Admin', user_id: 'u-1', status: 'Đang làm việc' },
      { id: 'e-x', employee_code: 'TT9', full_name: 'Người khác', user_id: 'u-2', status: 'Đang làm việc' },
    ], get_hrm_leave_ledger: { balance: null, entries: [] } });
    const out = JSON.parse(await runTool('phep_nhan_vien', {}, ctx(rpc), new Map()));
    expect(rpc.calls.map(x => x[0])).toEqual(['current_app_user_id', 'list_hrm_employee_directory', 'get_hrm_leave_ledger']);
    expect(rpc.calls[2][1]).toEqual({ p_employee_id: 'e-me', p_year: new Date(Date.now() + 7 * 3_600_000).getUTCFullYear() });
    expect(out).toMatchObject({ ref: 'h1', ten: 'Nguyễn Văn Hoàng', ma_nv: 'TT000001', chuc_danh: 'Admin' });
    expect(out.phep_nam).toBeUndefined();
    expect(out.ghi_chu).toContain('Chưa có sổ phép năm');
    const noProfile = JSON.parse(await runTool('phep_nhan_vien', {}, ctx(rpcOf({ current_app_user_id: 'u-9', list_hrm_employee_directory: [] })), new Map()));
    expect(noProfile.loi).toContain('Không thấy hồ sơ nhân viên gắn với tài khoản');
  });

  it('toàn công ty: HR → list_hrm_leave_balances xếp theo phép còn lại, mỗi người có mã nguồn; không phải HR → nói rõ chỉ HR', async () => {
    const rpc = rpcOf({ list_hrm_leave_balances: [
      { employeeId: 'e-1', employeeCode: 'A1', fullName: 'An', orgUnitName: 'Kỹ thuật', balance: { ...BALANCE, availableDays: 3 } },
      { employeeId: 'e-2', employeeCode: 'B2', fullName: 'Bình', orgUnitName: 'Kế toán', balance: null },
      { employeeId: 'e-3', employeeCode: 'C3', fullName: 'Cường', orgUnitName: 'Kỹ thuật', balance: { ...BALANCE, availableDays: 11 } },
    ] });
    const out = JSON.parse(await runTool('phep_nhan_vien', { toan_cong_ty: true, nam: 2026 }, ctx(rpc), new Map()));
    expect(rpc.calls).toEqual([['list_hrm_leave_balances', { p_year: 2026 }]]);
    expect(out).toMatchObject({ nam: 2026, tong_nhan_vien: 3, chua_co_so_phep: 1 });
    expect(out.nhan_vien.map((r: Record<string, unknown>) => [r.ref, r.ten, (r.phep_nam as Record<string, unknown> | undefined)?.con_lai ?? r.ghi_chu]))
      .toEqual([['h1', 'Cường', 11], ['h2', 'An', 3], ['h3', 'Bình', 'chưa có sổ phép năm này']]);
    const denied = JSON.parse(await runTool('phep_nhan_vien', { toan_cong_ty: true }, ctx(rpcOf({})), new Map()));
    expect(denied.loi).toContain('chỉ HR');
  });
});

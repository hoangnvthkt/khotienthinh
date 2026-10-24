import { describe, expect, it } from 'vitest';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { TOOLS, runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { chatSystem } from '../../supabase/functions/ai-gateway/chat';

// Chủ SP 24/10: hỏi "3 người đã nghỉ việc mà chưa ghi ngày nghỉ là ai" → Trợ lý nói không có danh sách và đẩy sang màn Nhân sự.
// Nguyên nhân: lech_kiem_soat bắt buộc mã chứng từ, mà câu này không có mã nào. Nay công cụ tra được theo luật / người /
// phân hệ, và không lọc thì ra bảng tổng hợp. Quyền vẫn do control_can_view ở máy chủ quyết.
const rpcOf = (table: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>): Rpc & { calls: Array<[string, Record<string, unknown>]> } => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const fn = (async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    const hit = table[name];
    if (hit === undefined) return { data: null, error: { message: 'CONTROL_LOGIN_REQUIRED', code: '42501' } };
    return { data: typeof hit === 'function' ? (hit as (a: Record<string, unknown>) => unknown)(args) : hit, error: null };
  }) as Rpc & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};
const ctx = (rpc: Rpc) => ({ rpc, book: new SourceBook() });

const NGHI_VIEC = {
  tong_so: 3, da_tra: 3,
  tom_tat: [{ ma_luat: 'employee_resigned_no_exit_date', luat: 'Đã nghỉ việc mà chưa ghi ngày nghỉ việc', muc: 'P1', phan_he: 'Nhân sự',
    dang_chay_thu: false, so_lech: 3, so_lech_cu: 0, so_tien: null, cach_xu_ly: 'HR mở hồ sơ nhân viên, đổi trạng thái lại cho đúng.', ai_xu_ly: 'Nhân sự' }],
  ket_qua: [
    { ma: 'TT055', lech: 'A đã đánh dấu nghỉ việc nhưng chưa ghi ngày nghỉ việc (còn 38 bản ghi chấm công, 0 bảng lương)', luat: 'Đã nghỉ việc mà chưa ghi ngày nghỉ việc', ma_luat: 'employee_resigned_no_exit_date', muc: 'P1', phan_he: 'Nhân sự', chenh: null, ngay: '2026-10-01', trang_thai: 'đang mở', cach_xu_ly: 'HR mở hồ sơ nhân viên.', ai_xu_ly: 'Nhân sự', link: '/hrm/employees?view=roster&person=e-1' },
    { ma: 'TT026', lech: 'B đã đánh dấu nghỉ việc nhưng chưa ghi ngày nghỉ việc (còn 89 bản ghi chấm công, 1 bảng lương)', luat: 'Đã nghỉ việc mà chưa ghi ngày nghỉ việc', ma_luat: 'employee_resigned_no_exit_date', muc: 'P1', phan_he: 'Nhân sự', chenh: null, ngay: '2026-10-01', trang_thai: 'đang mở', cach_xu_ly: 'HR mở hồ sơ nhân viên.', ai_xu_ly: 'Nhân sự', link: '/hrm/employees?view=roster&person=e-2' },
    { ma: 'TT029', lech: 'C đã đánh dấu nghỉ việc nhưng chưa ghi ngày nghỉ việc (còn 1 bản ghi chấm công, 1 bảng lương)', luat: 'Đã nghỉ việc mà chưa ghi ngày nghỉ việc', ma_luat: 'employee_resigned_no_exit_date', muc: 'P1', phan_he: 'Nhân sự', chenh: null, ngay: '2026-10-01', trang_thai: 'đang mở', cach_xu_ly: 'HR mở hồ sơ nhân viên.', ai_xu_ly: 'Nhân sự', link: '/hrm/employees?view=roster&person=e-3' },
  ],
};

describe('Trợ lý · sổ lệch Kiểm soát viên — công cụ và lời nhắc', () => {
  it('tra được theo luật / người / phân hệ / mức, không bắt buộc mã nào', () => {
    const spec = TOOLS.find(t => t.name === 'lech_kiem_soat');
    expect((spec?.parameters as { required?: string[] }).required).toBeUndefined();
    expect(spec?.parameters).toMatchObject({ properties: { ma: expect.anything(), luat: expect.anything(), nguoi: expect.anything(), phan_he: expect.anything(), muc: expect.anything() } });
    expect(spec?.description).toMatch(/KHÔNG truyền gì → bảng tổng hợp/);
  });

  it('lời nhắc không còn bảo đẩy câu hỏi chung sang màn khác, mà bắt liệt kê ra', () => {
    const system = chatSystem('Anh', [], true, 'Thứ sáu 24/10/2026');
    expect(system).toMatch(/hỏi chung "tôi có lệch nào cần sửa" thì gọi KHÔNG tham số/);
    expect(system).toMatch(/phải LIỆT KÊ ra, đừng chỉ nói số lượng/);
    expect(system).not.toMatch(/Hỏi chung "tôi có lệch nào cần sửa" → chỉ/);
  });
});

describe('Trợ lý · sổ lệch Kiểm soát viên — chạy bằng lệnh máy chủ giả', () => {
  it('đúng câu chủ SP hỏi: trả về 3 người kèm mã, kèm nút mở hồ sơ, và nhắc phải liệt kê', async () => {
    const rpc = rpcOf({ control_findings_search_v1: NGHI_VIEC });
    const out = JSON.parse(await runTool('lech_kiem_soat', { luat: 'nghỉ việc' }, ctx(rpc), new Map()));
    expect(rpc.calls[0][0]).toBe('control_findings_search_v1');
    expect(rpc.calls[0][1]).toMatchObject({ p_rule: 'nghỉ việc', p_who: null, p_module: null, p_severity: null });
    expect(out.tong_so).toBe(3);
    expect(out.ket_qua.map((x: { ma: string }) => x.ma)).toEqual(['TT055', 'TT026', 'TT029']);
    expect(out.ket_qua[0].mo_man).toHaveLength(1);
    expect(out.tom_tat[0]).toMatchObject({ ma_luat: 'employee_resigned_no_exit_date', so_lech: 3, ai_xu_ly: 'Nhân sự' });
    expect(out.ghi_chu).toMatch(/LIỆT KÊ/);
  });

  it('một mã chứng từ thì vẫn đi đường cũ control_findings_for_code_v1', async () => {
    const rpc = rpcOf({ control_findings_for_code_v1: [{ ma: 'PO-609', luat: 'Giá đối soát khác giá phiếu giao', muc: 'P0', lech: 'PO-609 lệch giá', chenh: 1000, trang_thai: 'open', cach_xu_ly: 'Ghi lý do', ai_xu_ly: 'Kế toán công nợ', link: '/procurement?po=p1' }] });
    const out = JSON.parse(await runTool('lech_kiem_soat', { ma: 'PO-609' }, ctx(rpc), new Map()));
    expect(rpc.calls[0][0]).toBe('control_findings_for_code_v1');
    expect(out.ket_qua[0].ma).toBe('PO-609');
  });

  it('mã chứng từ kèm bộ lọc khác thì dùng đường tra sổ, mã đưa vào ô tìm tự do', async () => {
    const rpc = rpcOf({ control_findings_search_v1: { tong_so: 0, da_tra: 0, tom_tat: [], ket_qua: [] } });
    await runTool('lech_kiem_soat', { ma: 'PO-609', muc: 'P0' }, ctx(rpc), new Map());
    expect(rpc.calls[0][0]).toBe('control_findings_search_v1');
    expect(rpc.calls[0][1]).toMatchObject({ p_who: 'PO-609', p_severity: 'P0' });
  });

  it('không lọc gì → bảng tổng hợp, không có danh sách dài', async () => {
    const rpc = rpcOf({ control_findings_search_v1: { tong_so: 16, da_tra: 0, tom_tat: NGHI_VIEC.tom_tat, ket_qua: [] } });
    const out = JSON.parse(await runTool('lech_kiem_soat', {}, ctx(rpc), new Map()));
    expect(rpc.calls[0][1]).toMatchObject({ p_rule: null, p_who: null, p_module: null, p_severity: null });
    expect(out.tong_so).toBe(16);
    expect(out.ket_qua).toEqual([]);
    expect(out.tom_tat[0].luat).toMatch(/nghỉ việc/);
  });

  it('không có kết quả: nói rõ "không thấy trong phạm vi xem được", không khẳng định là không có lỗi', async () => {
    const rpc = rpcOf({ control_findings_search_v1: { tong_so: 0, da_tra: 0, tom_tat: [], ket_qua: [] } });
    const loc = JSON.parse(await runTool('lech_kiem_soat', { luat: 'tồn kho' }, ctx(rpc), new Map()));
    expect(loc.tong_so).toBe(0);
    expect(loc.ghi_chu).toMatch(/KHÔNG khẳng định là không có lỗi/);
    const chung = JSON.parse(await runTool('lech_kiem_soat', {}, ctx(rpcOf({ control_findings_search_v1: { tong_so: 0, da_tra: 0, tom_tat: [], ket_qua: [] } })), new Map()));
    expect(chung.ghi_chu).toMatch(/không có lệch nào cần sửa trong phạm vi xem được/);
  });

  it('luật đang chạy thử và dữ liệu cũ được đánh dấu để Trợ lý nói đúng', async () => {
    const rpc = rpcOf({ control_findings_search_v1: { tong_so: 1, da_tra: 1, tom_tat: [], ket_qua: [
      { ma: 'TT001', lech: 'x', luat: 'Tồn kho âm', ma_luat: 'stock_negative', muc: 'P0', phan_he: 'Kho', chenh: null, trang_thai: 'đang mở', du_lieu_cu: true, dang_chay_thu: true, cach_xu_ly: 'y', ai_xu_ly: 'Kho', link: '/inventory' }] } });
    const out = JSON.parse(await runTool('lech_kiem_soat', { phan_he: 'Kho' }, ctx(rpc), new Map()));
    expect(out.ket_qua[0]).toMatchObject({ du_lieu_cu: true, dang_chay_thu: true });
    expect(out.ghi_chu).toMatch(/dang_chay_thu = luật đang chạy thử/);
  });

  it('máy chủ từ chối thì báo lỗi, không bịa', async () => {
    const out = JSON.parse(await runTool('lech_kiem_soat', { luat: 'nghỉ việc' }, ctx(rpcOf({})), new Map()));
    expect(JSON.stringify(out)).toMatch(/sổ lệch kiểm soát|CONTROL_LOGIN_REQUIRED/);
    expect(out.ket_qua).toBeUndefined();
  });
});

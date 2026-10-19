import { describe, expect, it } from 'vitest';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { TOOLS, TOOL_LABEL, runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { chatSystem } from '../../supabase/functions/ai-gateway/chat';

// Chủ SP 19/10: hỏi "hồ sơ nhân sự chi tiết" của một nhân viên → Trợ lý nói chưa có công cụ. chi_tiet_ho_so gọi 3 RPC hồ sơ sẵn có
// (tổng quan, công việc – tổ chức, hợp đồng); mức xem do app_private.hrm_employee_profile_access_level quyết, không phải lời nhắc.
const rpcOf = (table: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>): Rpc & { calls: Array<[string, Record<string, unknown>]> } => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const fn = (async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    const hit = table[name];
    if (hit === undefined) return { data: null, error: { message: 'HRM_PROFILE_SECTION_ACCESS_DENIED', code: '42501' } };
    return { data: typeof hit === 'function' ? (hit as (a: Record<string, unknown>) => unknown)(args) : hit, error: null };
  }) as Rpc & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};
const HUONG = { kind: 'employee', id: 'e-huong', code: 'TT123456', title: 'Nguyễn Thị Hương', subtitle: 'TP TCKT · 0912345678', status: 'Đang làm việc',
  extra: { phone: '0912345678', email: 'huong@vioo.vn', jobTitle: 'TP TCKT' } };
const HUONG2 = { kind: 'employee', id: 'e-huong2', code: 'TT654321', title: 'Trần Thu Hương', subtitle: 'Kế toán', status: 'Đang làm việc', extra: {} };
const OVERVIEW = (level: string, sections: string[]) => ({ employeeId: 'e-huong', employeeCode: 'TT123456', fullName: 'Nguyễn Thị Hương', title: 'Trưởng phòng TCKT', status: 'Đang làm việc',
  accessLevel: level, visibleSections: sections, maskedFields: [], canEditSections: [], summary: { startDate: '2019-03-01', officialDate: '2019-05-01', orgUnitName: 'Phòng Tài chính kế toán', positionName: 'Trưởng phòng' } });
const WORK = { employeeId: 'e-huong', title: 'Trưởng phòng TCKT', startDate: '2019-03-01', officialDate: '2019-05-01',
  orgUnit: { id: 'ou-tckt', code: 'TCKT', name: 'Phòng Tài chính kế toán' }, position: { id: 'pos-tp', code: 'TP', name: 'Trưởng phòng' },
  directManager: { employeeId: 'e-chuan', employeeCode: 'TT000002', fullName: 'Hà Đức Chuẩn', title: 'Phó TGĐ Tài chính' } };
const CONTRACTS = { employeeId: 'e-huong', contracts: [
  { id: 'c2', contractNumber: 'HĐLĐ-2021-015', type: 'indefinite', status: 'active', effectiveFrom: '2021-03-01', effectiveTo: null, signedBy: 'Dương Xuân Thịnh', note: null },
  { id: 'c1', contractNumber: 'HĐLĐ-2019-004', type: 'fixed_term', status: 'expired', effectiveFrom: '2019-05-01', effectiveTo: '2021-02-28', signedBy: null, note: null },
], employmentEvents: [
  { recordCode: 'EV-3', eventTypeCode: 'BO_NHIEM', eventDate: '2023-01-01', titleSnapshot: 'Trưởng phòng TCKT', orgUnitName: 'Phòng Tài chính kế toán' },
  { recordCode: 'EV-1', eventTypeCode: 'TIEP_NHAN', eventDate: '2019-03-01', titleSnapshot: 'Kế toán tổng hợp', orgUnitName: 'Phòng Tài chính kế toán' },
] };
const HR_LEVEL = ['overview', 'personal_contact', 'work_organization', 'attendance_leave', 'contracts_employment', 'legal_insurance', 'compensation_tax_bank', 'qualifications_documents'];
const ctx = (rpc: Rpc) => ({ rpc, book: new SourceBook() });

describe('Trợ lý · hồ sơ nhân viên — công cụ và lời nhắc', () => {
  it('có trong danh sách với nhãn "Hồ sơ nhân viên", tham số ma không bắt buộc; lời nhắc chỉ sang chi_tiet_ho_so và nói rõ không tra lương / CCCD / STK', () => {
    const spec = TOOLS.find(t => t.name === 'chi_tiet_ho_so');
    expect(spec?.parameters).toMatchObject({ properties: { ma: expect.anything() } });
    expect((spec?.parameters as { required?: string[] }).required).toBeUndefined();
    expect(spec?.description).toMatch(/Không tra lương, CCCD, số tài khoản, SĐT cá nhân/);
    expect(TOOL_LABEL.chi_tiet_ho_so).toBe('Hồ sơ nhân viên');
    const system = chatSystem('Anh', [], true, 'Thứ hai 19/10/2026');
    expect(system).toMatch(/ai quản lý trực tiếp một nhân viên: gọi chi_tiet_ho_so/);
    expect(system).toMatch(/Lương, CCCD, số tài khoản, SĐT cá nhân không tra ở Trợ lý/);
    expect(chatSystem('Anh', [], false)).not.toContain('chi_tiet_ho_so');
  });
});

describe('Trợ lý · hồ sơ nhân viên — tra bằng lệnh máy chủ giả', () => {
  it('HR hỏi theo tên: danh bạ → tổng quan → công việc → hợp đồng; trả thông tin công việc, quản lý trực tiếp có mã nguồn riêng, hợp đồng hiện tại; không SĐT / CCCD / lương', async () => {
    const rpc = rpcOf({ search_global_v1: { records: [HUONG] }, get_hrm_employee_overview: OVERVIEW('HR', HR_LEVEL), get_hrm_employee_work_organization: WORK, get_hrm_employee_contract_employment: CONTRACTS });
    const c = ctx(rpc);
    const raw = await runTool('chi_tiet_ho_so', { ma: 'Hương' }, c, new Map());
    const out = JSON.parse(raw);
    expect(rpc.calls.map(x => x[0])).toEqual(['search_global_v1', 'get_hrm_employee_overview', 'get_hrm_employee_work_organization', 'get_hrm_employee_contract_employment']);
    expect(rpc.calls.slice(1).map(x => x[1])).toEqual([{ p_employee_id: 'e-huong' }, { p_employee_id: 'e-huong' }, { p_employee_id: 'e-huong' }]);
    expect(out).toMatchObject({
      ref: 'h1', ho_ten: 'Nguyễn Thị Hương', ma_nv: 'TT123456', chuc_danh: 'Trưởng phòng TCKT', vi_tri: 'Trưởng phòng', phong_ban: 'Phòng Tài chính kế toán',
      quan_ly_truc_tiep: { ref: 'h2', ten: 'Hà Đức Chuẩn', ma_nv: 'TT000002', chuc_danh: 'Phó TGĐ Tài chính' },
      ngay_vao: '2019-03-01', ngay_chinh_thuc: '2019-05-01', trang_thai: 'Đang làm việc', email_cong_viec: 'huong@vioo.vn',
      hop_dong_hien_tai: { so: 'HĐLĐ-2021-015', loai: 'không xác định thời hạn', hieu_luc_tu: '2021-03-01', han: 'không xác định thời hạn' },
      so_hop_dong: 2, muc_xem: 'HR',
    });
    expect(out.qua_trinh_gan_nhat).toEqual([
      { ngay: '2023-01-01', loai: 'bổ nhiệm', chuc_danh: 'Trưởng phòng TCKT', don_vi: 'Phòng Tài chính kế toán' },
      { ngay: '2019-03-01', loai: 'tiếp nhận', chuc_danh: 'Kế toán tổng hợp', don_vi: 'Phòng Tài chính kế toán' },
    ]);
    expect(out.ghi_chu).toContain('Lương, CCCD, số tài khoản, SĐT cá nhân không tra ở Trợ lý');
    expect(out.ghi_chu).not.toContain('chỉ hiện với HR');
    expect(raw).not.toMatch(/0912345678|signedBy|Dương Xuân Thịnh/);
    // Nguồn màn hình: người được hỏi và quản lý trực tiếp đều mở được hồ sơ (/ep/…), không kèm SĐT / email.
    const cited = c.book.cited('xem [[h1]] và [[h2]]');
    expect(cited.map(s => (s.type === 'record' ? [s.record.kind, s.record.id, s.record.code] : null))).toEqual([['employee', 'e-huong', 'TT123456'], ['employee', 'e-chuan', 'TT000002']]);
    expect(cited.every(s => s.type === 'record' && !('phone' in (s.record.extra as object)) && !('email' in (s.record.extra as object)))).toBe(true);
  });

  it('mức danh bạ (nhân viên thường có Office): tổng quan + quản lý trực tiếp, KHÔNG gọi hợp đồng; ghi chú hợp đồng chỉ HR / chính người đó', async () => {
    const rpc = rpcOf({ search_global_v1: { records: [HUONG] }, get_hrm_employee_overview: OVERVIEW('DIRECTORY', ['overview', 'work_organization']), get_hrm_employee_work_organization: WORK });
    const out = JSON.parse(await runTool('chi_tiet_ho_so', { ma: 'TT123456' }, ctx(rpc), new Map()));
    expect(rpc.calls.map(x => x[0])).toEqual(['search_global_v1', 'get_hrm_employee_overview', 'get_hrm_employee_work_organization']);
    expect(out).toMatchObject({ ho_ten: 'Nguyễn Thị Hương', chuc_danh: 'Trưởng phòng TCKT', quan_ly_truc_tiep: { ten: 'Hà Đức Chuẩn' }, muc_xem: 'danh bạ' });
    expect(out.hop_dong_hien_tai).toBeUndefined();
    expect(out.so_hop_dong).toBeUndefined();
    expect(out.qua_trinh_gan_nhat).toBeUndefined();
    expect(out.ghi_chu).toContain('Hợp đồng và quá trình công tác chỉ hiện với HR hoặc chính người đó');
  });

  it('máy chủ chặn 42501 ở tổng quan (không có cả quyền danh bạ): "ngoài phạm vi được xem", không gọi gì thêm, không bịa', async () => {
    const rpc = rpcOf({ search_global_v1: { records: [HUONG] } });
    const out = JSON.parse(await runTool('chi_tiet_ho_so', { ma: 'Nguyễn Thị Hương' }, ctx(rpc), new Map()));
    expect(rpc.calls.map(x => x[0])).toEqual(['search_global_v1', 'get_hrm_employee_overview']);
    expect(out).toEqual({ loi: expect.stringContaining('Ngoài phạm vi người hỏi được xem: hồ sơ nhân sự của Nguyễn Thị Hương') });
    expect(out.loi).toContain('không nói là không tồn tại');
    // Danh bạ bị chặn ngay từ bước tìm → cũng là ngoài quyền, không phải "không thấy".
    const dirDenied = JSON.parse(await runTool('chi_tiet_ho_so', { ma: 'Hương' }, ctx(rpcOf({})), new Map()));
    expect(dirDenied.loi).toContain('Ngoài phạm vi người hỏi được xem: danh bạ nhân viên');
  });

  it('mã hN của hồ sơ ô tìm ngay gửi kèm (SourceBook) dùng được ngay, không tìm lại danh bạ; cùng người thì giữ cùng mã nguồn', async () => {
    const rpc = rpcOf({ get_hrm_employee_overview: OVERVIEW('HR', HR_LEVEL), get_hrm_employee_work_organization: WORK, get_hrm_employee_contract_employment: CONTRACTS });
    const c = ctx(rpc);
    expect(c.book.record({ kind: 'employee', id: 'e-huong', code: 'TT123456', title: 'Nguyễn Thị Hương', extra: {} })).toBe('h1');
    const out = JSON.parse(await runTool('chi_tiet_ho_so', { ma: 'h1' }, c, new Map()));
    expect(rpc.calls.map(x => x[0])).toEqual(['get_hrm_employee_overview', 'get_hrm_employee_work_organization', 'get_hrm_employee_contract_employment']);
    expect(out).toMatchObject({ ref: 'h1', ho_ten: 'Nguyễn Thị Hương', quan_ly_truc_tiep: { ref: 'h2' } });
    // Mã hN không phải nhân viên (VD đơn mua) → không nhận, tìm danh bạ theo chữ.
    const other = ctx(rpcOf({ search_global_v1: { records: [] } }));
    other.book.record({ kind: 'purchase_order', id: 'po-1', code: 'PO-1', extra: {} });
    const miss = JSON.parse(await runTool('chi_tiet_ho_so', { ma: 'h1' }, other, new Map()));
    expect(miss.loi).toContain('Không thấy nhân viên "h1"');
  });

  it('trùng tên → danh sách gợi ý bấm, chưa tra hồ sơ; không thấy tên → nói rõ', async () => {
    const rpc = rpcOf({ search_global_v1: { records: [HUONG, HUONG2] } });
    const out = JSON.parse(await runTool('chi_tiet_ho_so', { ma: 'Hương' }, ctx(rpc), new Map()));
    expect(rpc.calls.map(x => x[0])).toEqual(['search_global_v1']);
    expect(out.can_hoi).toContain('Chưa tra hồ sơ.');
    expect(out.cac_nhan_vien.map((r: Record<string, unknown>) => [r.ref, r.ten, r.chuc_danh])).toEqual([['h1', 'Nguyễn Thị Hương', 'TP TCKT'], ['h2', 'Trần Thu Hương', 'Kế toán']]);
    const none = JSON.parse(await runTool('chi_tiet_ho_so', { ma: 'Xyz' }, ctx(rpcOf({ search_global_v1: { records: [] } })), new Map()));
    expect(none.loi).toContain('Không thấy nhân viên "Xyz"');
  });

  it('bỏ trống ma = chính mình: tài khoản → danh bạ → hồ sơ (mức chính mình, có hợp đồng); email công việc lấy từ danh bạ', async () => {
    const rpc = rpcOf({ current_app_user_id: 'u-1', list_hrm_employee_directory: [
      { id: 'e-me', employee_code: 'TT000001', full_name: 'Nguyễn Văn Hoàng', title: 'Admin', user_id: 'u-1', status: 'Đang làm việc', email: 'hoang@vioo.vn', phone: '0900000000' },
      { id: 'e-x', employee_code: 'TT9', full_name: 'Người khác', user_id: 'u-2', status: 'Đang làm việc' },
    ], get_hrm_employee_overview: { ...OVERVIEW('SELF', ['overview', 'personal_contact', 'work_organization', 'attendance_leave', 'contracts_employment']), employeeId: 'e-me', employeeCode: 'TT000001', fullName: 'Nguyễn Văn Hoàng', title: 'Admin' },
      get_hrm_employee_work_organization: { ...WORK, directManager: null }, get_hrm_employee_contract_employment: { employeeId: 'e-me', contracts: [], employmentEvents: [] } });
    const raw = await runTool('chi_tiet_ho_so', {}, ctx(rpc), new Map());
    const out = JSON.parse(raw);
    expect(rpc.calls.map(x => x[0])).toEqual(['current_app_user_id', 'list_hrm_employee_directory', 'get_hrm_employee_overview', 'get_hrm_employee_work_organization', 'get_hrm_employee_contract_employment']);
    expect(rpc.calls[2][1]).toEqual({ p_employee_id: 'e-me' });
    expect(out).toMatchObject({ ref: 'h1', ho_ten: 'Nguyễn Văn Hoàng', ma_nv: 'TT000001', email_cong_viec: 'hoang@vioo.vn', quan_ly_truc_tiep: 'chưa gán trong sơ đồ tổ chức', hop_dong_hien_tai: 'chưa có hợp đồng đang hiệu lực', muc_xem: 'chính mình' });
    expect(raw).not.toContain('0900000000');
  });
});

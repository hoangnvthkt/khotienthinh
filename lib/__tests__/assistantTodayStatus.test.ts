import { describe, expect, it } from 'vitest';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { TOOLS, TOOL_LABEL, runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { chatSystem } from '../../supabase/functions/ai-gateway/chat';

// Chủ SP 24/10: đo trên 82 câu hỏi thật thấy Trợ lý thiếu hẳn dạng "tình hình hôm nay của một nhóm"
// (hỏi "hôm nay phòng HCNS ai chưa chấm công" thì không trả lời được). Một công cụ, 4 loại; quyền do
// helper của từng phân hệ quyết, không nới ở lời nhắc.
const rpcOf = (table: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>): Rpc & { calls: Array<[string, Record<string, unknown>]> } => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const fn = (async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    const hit = table[name];
    if (hit === undefined) return { data: null, error: { message: 'ASSISTANT_LOGIN_REQUIRED', code: '42501' } };
    return { data: typeof hit === 'function' ? (hit as (a: Record<string, unknown>) => unknown)(args) : hit, error: null };
  }) as Rpc & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};
const ctx = (rpc: Rpc) => ({ rpc, book: new SourceBook() });

const HCNS = { loai: 'cham_cong', ngay: '2026-10-24', tong_nguoi_xem_duoc: 14, da_cham: 6, dang_nghi_phep: 0, tong_so: 8,
  tom_tat: [{ don_vi: 'Phòng Hành chính - Nhân sự', so_nguoi: 8 }],
  ket_qua: [
    { ma: 'TT001', ten: 'A', don_vi: 'Phòng Hành chính - Nhân sự', link: '/hrm/attendance?tab=timesheet&q=TT001' },
    { ma: 'TT002', ten: 'B', don_vi: 'Phòng Hành chính - Nhân sự', link: '/hrm/attendance?tab=timesheet&q=TT002' },
  ] };

describe('Trợ lý · tình hình hôm nay — công cụ và lời nhắc', () => {
  it('có 4 loại, pham_vi và ngay không bắt buộc, nhãn đúng', () => {
    const spec = TOOLS.find(t => t.name === 'tinh_hinh_hom_nay');
    expect((spec?.parameters as { required?: string[] }).required).toEqual(['loai']);
    expect((spec?.parameters as { properties: { loai: { enum: string[] } } }).properties.loai.enum)
      .toEqual(['cham_cong', 'nghi_phep', 'nhat_ky', 'phieu_dung']);
    expect(spec?.description).toMatch(/đã trừ người nghỉ phép đã duyệt/);
    expect(spec?.description).toMatch(/nhân viên thường chỉ thấy chính mình/);
    expect(TOOL_LABEL.tinh_hinh_hom_nay).toBe('Tình hình hôm nay');
  });

  it('lời nhắc tách bạch với bao_cao theo kỳ', () => {
    const system = chatSystem('Anh', [], true, 'Thứ bảy 24/10/2026');
    expect(system).toMatch(/gọi tinh_hinh_hom_nay, KHÔNG dùng bao_cao/);
    expect(system).toMatch(/liệt kê ra, nói rõ số liệu trong phạm vi/);
  });
});

describe('Trợ lý · tình hình hôm nay — chạy bằng lệnh máy chủ giả', () => {
  it('đúng câu chủ SP hỏi: trả số đã chấm / nghỉ phép / chưa chấm và danh sách tên', async () => {
    const rpc = rpcOf({ assistant_today_status_v1: HCNS });
    const out = JSON.parse(await runTool('tinh_hinh_hom_nay', { loai: 'cham_cong', pham_vi: 'hành chính nhân sự' }, ctx(rpc), new Map()));
    expect(rpc.calls[0][0]).toBe('assistant_today_status_v1');
    expect(rpc.calls[0][1]).toMatchObject({ p_kind: 'cham_cong', p_scope: 'hành chính nhân sự', p_date: null, p_days: null });
    expect(out).toMatchObject({ tong_nguoi_xem_duoc: 14, da_cham: 6, dang_nghi_phep: 0, tong_so: 8 });
    expect(out.ket_qua.map((x: { ma: string }) => x.ma)).toEqual(['TT001', 'TT002']);
    expect(out.ket_qua[0].mo_man).toHaveLength(1);
    expect(out.ghi_chu).toMatch(/LIỆT KÊ tên/);
    expect(out.ghi_chu).toMatch(/phạm vi người hỏi được xem/);
  });

  it('chỉ truyền so_ngay_dung cho loai phieu_dung', async () => {
    const rpc = rpcOf({ assistant_today_status_v1: { loai: 'phieu_dung', tong_so: 0, ket_qua: [], tom_tat: [] } });
    await runTool('tinh_hinh_hom_nay', { loai: 'phieu_dung', so_ngay_dung: 14 }, ctx(rpc), new Map());
    expect(rpc.calls[0][1]).toMatchObject({ p_kind: 'phieu_dung', p_days: 14 });
    const rpc2 = rpcOf({ assistant_today_status_v1: { loai: 'cham_cong', tong_so: 0, ket_qua: [], tom_tat: [] } });
    await runTool('tinh_hinh_hom_nay', { loai: 'cham_cong', so_ngay_dung: 14 }, ctx(rpc2), new Map());
    expect(rpc2.calls[0][1]).toMatchObject({ p_days: null });
  });

  it('ngày sai định dạng thì bỏ qua, không đẩy xuống máy chủ', async () => {
    const rpc = rpcOf({ assistant_today_status_v1: { loai: 'nghi_phep', tong_so: 0, ket_qua: [], tom_tat: [] } });
    await runTool('tinh_hinh_hom_nay', { loai: 'nghi_phep', ngay: 'hôm qua' }, ctx(rpc), new Map());
    expect(rpc.calls[0][1]).toMatchObject({ p_date: null });
    const rpc2 = rpcOf({ assistant_today_status_v1: { loai: 'nghi_phep', tong_so: 0, ket_qua: [], tom_tat: [] } });
    await runTool('tinh_hinh_hom_nay', { loai: 'nghi_phep', ngay: '2026-10-20' }, ctx(rpc2), new Map());
    expect(rpc2.calls[0][1]).toMatchObject({ p_date: '2026-10-20' });
  });

  it('không có ai: nói rõ là trong phạm vi xem được, không khẳng định cả công ty', async () => {
    const rpc = rpcOf({ assistant_today_status_v1: { loai: 'cham_cong', tong_so: 0, tong_nguoi_xem_duoc: 1, da_cham: 1, ket_qua: [], tom_tat: [] } });
    const out = JSON.parse(await runTool('tinh_hinh_hom_nay', { loai: 'cham_cong' }, ctx(rpc), new Map()));
    expect(out.tong_so).toBe(0);
    expect(out.ghi_chu).toMatch(/trong phạm vi xem được/);
  });

  it('loai sai thì báo lỗi, không gọi máy chủ', async () => {
    const rpc = rpcOf({ assistant_today_status_v1: {} });
    const out = JSON.parse(await runTool('tinh_hinh_hom_nay', { loai: 'linh_tinh' }, ctx(rpc), new Map()));
    expect(out.loi).toMatch(/cham_cong/);
    expect(rpc.calls).toHaveLength(0);
  });

  it('máy chủ từ chối thì báo lỗi, không bịa', async () => {
    const out = JSON.parse(await runTool('tinh_hinh_hom_nay', { loai: 'cham_cong' }, ctx(rpcOf({})), new Map()));
    expect(JSON.stringify(out)).toMatch(/tình hình hôm nay|ASSISTANT_LOGIN_REQUIRED/);
    expect(out.ket_qua).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { dailyLogSlipRoute, dailyLogView, parseCommand } from '../assistantCommands';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { matchProjects, projectsMentioned, runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { looksLikeDailyReport, reportTextOf } from '../../supabase/functions/ai-gateway/chat';
import { converse } from '../../supabase/functions/ai-gateway/loop';

const REPORT = `BC ngày 15/10
Nhà xưởng: Tổ Mr Ích 20 người
- Lắp dựng cofa cổ cột, dầm chân tường
- GCLD cốt thép giằng trục F6→F16
- Xây tường hành lang`;
const PROJECTS = [{ id: 'da29', code: 'DA29', name: 'Nhà xưởng XinHai', siteId: 'site-da29' }, { id: 'smb', code: 'SMB-2026', name: 'Nhà máy SMB', siteId: 's-smb' }];
const ctxOf = (table: Record<string, unknown>, question: string, projectId: string | null = null) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const events: Array<Record<string, unknown>> = [];
  const rpc = (async (fn: string, args: Record<string, unknown>) => {
    calls.push([fn, args]);
    const hit = table[fn];
    return { data: hit ?? null, error: hit === undefined ? { message: 'unknown', code: 'X' } : null };
  }) as Rpc;
  return { calls, events, ctx: { rpc, book: new SourceBook(), runId: 'run-dl', projectId, question, emit: (e: Record<string, unknown>) => events.push(e) } };
};
const ok = { assistant_daily_log_projects_v1: PROJECTS, assistant_command_create_v1: { id: 'cmd-dl', kind: 'daily_log', status: 'prepared', title: 'x', payload: {}, preview: {} } };

describe('Trợ lý T2d · nhật ký từ báo cáo Zalo', () => {
  it('chuẩn bị: lưu NGUYÊN VĂN tin dán (không để model chép), dự án theo lời, ngày báo cáo; không tạo phiếu', async () => {
    const t = ctxOf(ok, REPORT, 'smb');
    const out = JSON.parse(await runTool('chuan_bi_nhat_ky', { du_an: 'DA29', ngay_bao_cao: '2026-10-15' }, t.ctx, new Map()));
    expect(t.calls.map(c => c[0])).toEqual(['assistant_daily_log_projects_v1', 'assistant_command_create_v1']);
    expect(t.calls[1][1]).toMatchObject({ p_kind: 'daily_log', p_title: 'Nhật ký từ báo cáo Zalo · DA29',
      p_payload: { projectId: 'da29', siteId: 'site-da29', reportDate: '2026-10-15', text: REPORT } });
    expect(t.events).toHaveLength(1);
    expect(out).toMatchObject({ da_hien_the: true, du_an: 'DA29 · Nhà xưởng XinHai', ngay_bao_cao: '2026-10-15' });
    expect(out.ghi_chu).toContain('không nói là đã ghi nhật ký');
  });

  it('chưa rõ dự án → hỏi lại bằng gợi ý (dự án đang xem đứng đầu); tin quá ngắn / ngày tương lai / không quyền → nói rõ', async () => {
    const ask = ctxOf(ok, REPORT, 'smb');
    const out = JSON.parse(await runTool('chuan_bi_nhat_ky', {}, ask.ctx, new Map()));
    expect(out.cac_du_an).toEqual(['SMB-2026 · Nhà máy SMB', 'DA29 · Nhà xưởng XinHai']);
    expect(ask.calls.some(c => c[0] === 'assistant_command_create_v1')).toBe(false);
    expect(JSON.parse(await runTool('chuan_bi_nhat_ky', { du_an: 'DA29' }, ctxOf(ok, 'BC ngày 15/10').ctx, new Map())).loi).toContain('Chưa thấy nội dung báo cáo');
    expect(JSON.parse(await runTool('chuan_bi_nhat_ky', { du_an: 'DA29', ngay_bao_cao: '2099-01-01' }, ctxOf(ok, REPORT).ctx, new Map())).loi).toContain('Ngày báo cáo chưa đúng');
    expect(JSON.parse(await runTool('chuan_bi_nhat_ky', {}, ctxOf({ ...ok, assistant_daily_log_projects_v1: [] }, REPORT).ctx, new Map())).loi).toContain('chưa được ghi nhật ký');
    // Chỉ một dự án ghi được → dùng luôn.
    const one = ctxOf({ ...ok, assistant_daily_log_projects_v1: [PROJECTS[0]] }, REPORT);
    expect(JSON.parse(await runTool('chuan_bi_nhat_ky', {}, one.ctx, new Map())).da_hien_the).toBe(true);
  });

  it('bấm chọn dự án ở lượt sau: báo cáo vẫn là tin dài dán trước đó', () => {
    const history = [{ role: 'user' as const, content: REPORT }, { role: 'assistant' as const, content: 'Báo cáo của dự án nào? [[goi_y:DA29 · Nhà xưởng XinHai]]' }];
    expect(reportTextOf('DA29 · Nhà xưởng XinHai', history)).toBe(REPORT);
    expect(reportTextOf(REPORT, [])).toBe(REPORT);
    expect(reportTextOf('Ghi nhật ký giúp anh', [])).toBe('Ghi nhật ký giúp anh');
  });

  it('thẻ: đọc lệnh, mở đúng phiếu nháp ở màn Nhật ký', () => {
    const c = parseCommand({ id: 'd1', kind: 'daily_log', status: 'prepared', title: 'Nhật ký', createdAt: '2026-10-18T02:00:00Z',
      payload: { projectId: 'da29', projectCode: 'DA29', siteId: 'site-da29', reportDate: '2026-10-15', text: REPORT } })!;
    const v = dailyLogView(c);
    expect(v).toMatchObject({ projectId: 'da29', reportDate: '2026-10-15', text: REPORT });
    expect(dailyLogSlipRoute(v, '2026-10-13', 'c-1')).toBe('/da?projectId=da29&tab=dailylog&slipDate=2026-10-13&slipContribution=c-1&siteId=site-da29');
  });

  it('nhận ra tin báo cáo thi công (buộc gọi công cụ nhật ký) — câu hỏi thường thì không', () => {
    expect(looksLikeDailyReport(REPORT)).toBe(true);
    expect(looksLikeDailyReport('Báo cáo ngày 16/10\nTổ a Ích 35 người: đổ bê tông giằng móng\nTổ nề 6 người: xây tường bao')).toBe(true);
    expect(looksLikeDailyReport('Báo cáo tiến độ SMB tuần này thế nào?')).toBe(false);
    expect(looksLikeDailyReport('PO-646 giao đủ chưa\ncòn nợ bao nhiêu\ntổ nào nhận')).toBe(false);
  });

  it('dự án theo tên chủ đầu tư (thật 18/10: "Dự án xinhai" ↔ DA29, CĐT "CÔNG TY TNHH XIN HAI VINA")', () => {
    const P = [{ id: 'da29', code: 'DA29', name: 'NHÀ MÁY SẢN XUẤT, GIA CÔNG  CÁC SẢN PHẨM THÚ NHỒI BÔNG - GIAI ĐOẠN 2', client: 'CÔNG TY TNHH XIN HAI VINA' },
      { id: 'smb', code: 'SMB-2026', name: 'DỰ ÁN SƠN MIỀN BẮC', client: 'Công ty TNHH Dragon' }];
    expect(matchProjects('Dự án xinhai', P).map(p => p.id)).toEqual(['da29']);
    expect(matchProjects('xin hai', P).map(p => p.id)).toEqual(['da29']);
    expect(matchProjects('Sơn Miền Bắc', P).map(p => p.id)).toEqual(['smb']);
    expect(projectsMentioned('Báo cáo công việc ngày 18/10 XinHai\n1) Nhà xưởng: Tổ Mr Ích 11 người', P).map(p => p.id)).toEqual(['da29']);
    // Bộ kiểm hồi quy 18/10: tin ghi tách "Xin Hai" (đúng như tên CĐT) cũng nhận ra; một chữ "hai" lẻ thì không.
    expect(projectsMentioned('BC ngày 15/10 Xin Hai\nNhà xưởng: Tổ Mr Ích 20 người', P).map(p => p.id)).toEqual(['da29']);
    expect(projectsMentioned('BC ngày 15/10\nTổ Ích 20 người, hai ca', P)).toEqual([]);
    expect(projectsMentioned('Báo cáo công việc ngày:18/10/2026\n1)Nhà xưởng:\n*Tổ Mr Ích: 11 người\n- Lắp dựng cofa cổ cột, hố pít thang máy 2\n-GCLD cốt thép khu cầu công\n-Xây tường hàng lang trục A', P)).toEqual([]);
  });

  it('nhận dự án từ tin: mã (DA29, SMB) hoặc chữ riêng trong tên (XinHai); chữ chung (nhà xưởng, Hưng Yên) không tính', () => {
    const P = [{ id: 'da29', code: 'DA29', name: 'Nhà máy sản xuất thú nhồi bông XinHai GĐ2' }, { id: 'smb', code: 'SMB-2026', name: 'Nhà máy SMB Hưng Yên' }];
    expect(projectsMentioned('BC ngày 15/10 XinHai\nNhà xưởng: Tổ Ích', P).map(p => p.id)).toEqual(['da29']);
    expect(projectsMentioned('Báo cáo DA29 ngày 14/10', P).map(p => p.id)).toEqual(['da29']);
    expect(projectsMentioned('BC SMB 16/10 tổ nề', P).map(p => p.id)).toEqual(['smb']);
    expect(projectsMentioned('Nhà xưởng Hưng Yên: tổ Ích 20 người', P)).toEqual([]);
  });

  it('bước đầu buộc gọi đúng công cụ khi máy chủ đã nhận ra loại tin; các bước sau tự do', async () => {
    const choices: unknown[] = [];
    let n = 0;
    await converse({
      step: async req => { choices.push(req.toolChoice); n += 1; return n === 1
        ? { text: '', toolCalls: [{ id: 't1', name: 'chuan_bi_nhat_ky', args: { du_an: 'DA29' } }], usage: { tokensIn: 1, tokensOut: 1 } }
        : { text: 'Thẻ đang đọc báo cáo.', toolCalls: [], usage: { tokensIn: 1, tokensOut: 1 } }; },
      rpc: (async () => ({ data: null, error: { message: 'x', code: 'X' } })) as Rpc, emit: () => undefined, redact: t => t, system: 's',
      turns: [{ role: 'user', content: REPORT }], book: new SourceBook(), used: [], started: Date.now(), runId: 'r', question: REPORT, forceTool: 'chuan_bi_nhat_ky',
    });
    expect(choices).toEqual([{ name: 'chuan_bi_nhat_ky' }, 'auto']);
  });
});

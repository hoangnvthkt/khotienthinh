// B2 (21/10/2026) — phiếu sự cố từ Trợ lý: công cụ chuan_bi_su_co (thẻ issue_report, Jev chọn loại / mức khẩn khi tự tin), bộ đọc Jev,
// thẻ phía máy (issueView, mô tả gửi Admin kèm ngữ cảnh), sổ lỗi gần nhất trên máy. Không mạng, không model.
import { afterEach, describe, expect, it } from 'vitest';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { ISSUE_JEV_AUTO, TOOLS, TOOL_INFO, runTool, type IssueClass, type ToolContext } from '../../supabase/functions/ai-gateway/tools';
import { ISSUE_TYPE_CRITERIA, buildIssueRequest, issueDecisionLog, parseIssueAnswer } from '../../supabase/functions/ai-gateway/jev';
import { issueView, parseCommand } from '../assistantCommands';
import { imageToFile, issueDescription } from '../assistantIssue';
import { clearClientErrors, clientErrorsText, recentClientErrors, recordClientError, recordHttpError } from '../clientErrorLog';

const makeCtx = (classifier?: ToolContext['issueClassifier']) => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const events: Array<Record<string, unknown>> = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return { data: { id: 'cmd-1', kind: args.p_kind, status: 'prepared', title: args.p_title, payload: args.p_payload, preview: {} }, error: null };
  };
  const ctx: ToolContext = { rpc, book: new SourceBook(), runId: 'run-1', emit: e => events.push(e), issueClassifier: classifier };
  return { ctx, calls, events };
};
const args = { tieu_de: 'Xuất kho SMB báo lỗi khi lưu phiếu', mo_ta: 'Chị Phương bấm Lưu ở Xuất kho SMB, phần mềm báo "Không lưu được phiếu, thử lại sau", làm 3 lần vẫn vậy.',
  man_hinh: 'Kho · Xuất kho', loai: 'bug', muc_khan: 'high', module: 'warehouse' };

describe('công cụ chuan_bi_su_co', () => {
  it('có trong danh sách công cụ, là loại chuẩn bị (thẻ issue_report), tham số bắt buộc đủ', () => {
    const def = TOOLS.find(t => t.name === 'chuan_bi_su_co')!;
    expect(def).toBeTruthy();
    expect((def.parameters as { required: string[] }).required).toEqual(['tieu_de', 'mo_ta', 'loai', 'muc_khan']);
    expect(TOOL_INFO.chuan_bi_su_co).toMatchObject({ kind: 'chuan_bi', commandKind: 'issue_report' });
  });

  it('không có Jev: thẻ theo lựa chọn của model; lời nhắc nhắc bấm Gửi Admin, không nói đã gửi', async () => {
    const { ctx, calls, events } = makeCtx();
    const out = JSON.parse(await runTool('chuan_bi_su_co', args, ctx, new Map()));
    expect(out).toMatchObject({ da_hien_the: true, loai: 'bug', muc_khan: 'high' });
    expect(out.ghi_chu).toMatch(/Gửi Admin/);
    expect(out.ghi_chu).toMatch(/không nói là đã gửi/);
    expect(calls.map(c => c.fn)).toEqual(['assistant_command_create_v1']);
    expect(calls[0].args).toMatchObject({ p_kind: 'issue_report', p_title: 'Sự cố: Xuất kho SMB báo lỗi khi lưu phiếu' });
    expect(calls[0].args.p_payload).toMatchObject({ type: 'bug', priority: 'high', module: 'warehouse', screen: 'Kho · Xuất kho', modelType: 'bug', modelPriority: 'high' });
    expect((calls[0].args.p_payload as Record<string, unknown>).jev).toBeUndefined();
    expect(events[0]).toMatchObject({ type: 'command', command: { kind: 'issue_report' } });
  });

  it('Jev tự tin ≥ 0,85 → lấy loại / mức khẩn của Jev; dưới ngưỡng giữ của model; cả hai ghi vào thẻ', async () => {
    const confident: IssueClass = { type: 'permission', typeConfidence: 0.93, priority: 'medium', priorityConfidence: 0.6, model: 'jev-1.14.0', ms: 180 };
    const seen: unknown[] = [];
    const a = makeCtx(async input => { seen.push(input); return confident; });
    const out = JSON.parse(await runTool('chuan_bi_su_co', args, a.ctx, new Map()));
    expect(out).toMatchObject({ loai: 'permission', muc_khan: 'high', jev_chon: true });
    expect(seen[0]).toMatchObject({ title: args.tieu_de, screen: 'Kho · Xuất kho', modelType: 'bug', modelPriority: 'high' });
    expect(a.calls[0].args.p_payload).toMatchObject({ type: 'permission', priority: 'high', modelType: 'bug', jev: { type: 'permission', typeConfidence: 0.93 } });
    expect(ISSUE_JEV_AUTO).toBe(0.85);
    const b = makeCtx(async () => { throw new Error('JEV_HTTP_500'); });
    const out2 = JSON.parse(await runTool('chuan_bi_su_co', args, b.ctx, new Map()));
    expect(out2).toMatchObject({ loai: 'bug', muc_khan: 'high' });
    expect(out2.jev_chon).toBeUndefined();
  });

  it('thiếu chi tiết → không lập thẻ, bảo hỏi lại; loại / mức lạ → mặc định bug / medium / other', async () => {
    const a = makeCtx();
    expect(JSON.parse(await runTool('chuan_bi_su_co', { tieu_de: 'Lỗi', mo_ta: 'lỗi' }, a.ctx, new Map())).loi).toMatch(/hỏi lại/i);
    expect(a.calls).toHaveLength(0);
    const b = makeCtx();
    await runTool('chuan_bi_su_co', { ...args, loai: 'xyz', muc_khan: 'ngay', module: 'kho' }, b.ctx, new Map());
    expect(b.calls[0].args.p_payload).toMatchObject({ type: 'bug', priority: 'medium', module: 'other' });
  });
});

describe('Jev phân loại sự cố', () => {
  it('yêu cầu: hai câu Choice có tiêu chí, state cắt độ dài', () => {
    const req = buildIssueRequest('T'.repeat(300), 'M'.repeat(5000), null, 'jev-1.14.0');
    expect(req.state.tieu_de).toHaveLength(200);
    expect(req.state.mo_ta).toHaveLength(3000);
    expect(req.state.man_hinh).toBe('chưa rõ');
    expect(Object.keys(req.questions)).toEqual(['loai', 'muc_khan']);
    expect((req.questions.loai as { criteria: unknown }).criteria).toBe(ISSUE_TYPE_CRITERIA);
  });
  it('đọc câu trả lời; sai nhãn → AI_BAD_JSON; ghi quyết định với tier và agree', () => {
    const a = parseIssueAnswer({ model: 'jev-1.14.0', usage: { input_tokens: 120 }, answers: { loai: { choice: 'data', confidence: 0.88 }, muc_khan: { choice: 'urgent', confidence: 0.71 } } });
    expect(a).toEqual({ type: 'data', typeConfidence: 0.88, priority: 'urgent', priorityConfidence: 0.71, model: 'jev-1.14.0', tokensIn: 120 });
    expect(() => parseIssueAnswer({ answers: { loai: { choice: 'bug' }, muc_khan: { choice: 'ngay' } } })).toThrow('AI_BAD_JSON');
    const log = issueDecisionLog({ ok: true, answer: { ...a, ms: 150 } }, { type: 'bug', priority: 'high' }, 'jev-1.14.0');
    expect(log).toMatchObject({ kind: 'issue_class', status: 'ok', agree: false, predicted: { type: 'data', tier: 'auto' }, actual: { type: 'bug', priority: 'high' } });
    expect(issueDecisionLog({ ok: false, error: 'JEV_HTTP_503' }, { type: 'bug', priority: 'high' }, 'jev-1.14.0')).toMatchObject({ kind: 'issue_class', status: 'error', error: 'JEV_HTTP_503', agree: null });
  });
});

describe('thẻ phía máy', () => {
  it('issueView đọc payload, thiếu thì mặc định; ảnh base64 → File đúng tên / loại', () => {
    const c = parseCommand({ id: 'c1', kind: 'issue_report', status: 'prepared', title: 'Sự cố', createdAt: '2026-10-21T10:00:00Z',
      payload: { title: 'A', description: 'B', type: 'permission', priority: 'high', module: 'warehouse', screen: 'Kho', modelType: 'bug', modelPriority: 'medium', jev: { type: 'permission', typeConfidence: 0.9, priority: 'high', priorityConfidence: 0.5 } } })!;
    expect(c.kind).toBe('issue_report');
    expect(issueView(c)).toMatchObject({ type: 'permission', priority: 'high', module: 'warehouse', screen: 'Kho', modelType: 'bug', jev: { type: 'permission', typeConfidence: 0.9 } });
    expect(issueView(parseCommand({ id: 'c2', kind: 'issue_report', status: 'prepared', payload: {} })!)).toMatchObject({ type: 'bug', priority: 'medium', module: 'other', screen: null, jev: null });
    const f = imageToFile({ kind: 'image', id: 'i', name: 'x', mime: 'image/png', b64: btoa('abc'), previewUrl: '' }, 1);
    expect(f.name).toBe('su-co-2.png'); expect(f.type).toBe('image/png'); expect(f.size).toBe(3);
  });
  it('mô tả gửi Admin = lời kể + màn hình + bản + lỗi gần nhất', () => {
    const text = issueDescription({ description: 'Không lưu được phiếu.', screen: 'Kho · Xuất kho' }, { route: '/wms?tab=xuat', version: 'abc123' }, '- 10:01 máy chủ: POST rpc/save_x → 409', new Date(2026, 9, 21, 10, 2));
    expect(text).toContain('Không lưu được phiếu.');
    expect(text).toContain('Màn hình liên quan: Kho · Xuất kho · đang mở: /wms?tab=xuat · bản: abc123');
    expect(text).toContain('Lỗi gần nhất trên máy người báo:\n- 10:01 máy chủ: POST rpc/save_x → 409');
    expect(issueDescription({ description: 'x', screen: null }, { route: '', version: 'local' }, '', new Date())).not.toContain('Lỗi gần nhất');
  });
});

describe('sổ lỗi gần nhất trên máy', () => {
  afterEach(() => clearClientErrors());
  it('giữ 10 dòng, bỏ lặp trong 5 s, chỉ REST / functions / storage, không URL có tham số, bỏ 401', () => {
    recordHttpError('POST', 'https://x.supabase.co/rest/v1/rpc/save_delivery_capture_v1?select=*', 409);
    recordHttpError('POST', 'https://x.supabase.co/rest/v1/rpc/save_delivery_capture_v1?select=*', 409);
    recordHttpError('GET', 'https://x.supabase.co/auth/v1/user', 500);
    recordHttpError('POST', 'https://x.supabase.co/rest/v1/rpc/secret', 401);
    recordHttpError('POST', 'https://x.supabase.co/functions/v1/ai-gateway', 503);
    const now = new Date();
    const errs = recentClientErrors(now);
    expect(errs.map(e => e.text)).toEqual(['POST rpc/save_delivery_capture_v1 → 409', 'POST ai-gateway → 503']);
    for (let i = 0; i < 12; i++) recordClientError('js', `lỗi ${i}`);
    expect(recentClientErrors(now)).toHaveLength(10);
    expect(clientErrorsText(recentClientErrors(now)).split('\n')).toHaveLength(5);
  });
  it('chỉ lấy lỗi trong 30 phút', () => {
    recordClientError('js', 'cũ', () => new Date(2026, 9, 21, 9, 0));
    recordClientError('js', 'mới', () => new Date(2026, 9, 21, 9, 50));
    expect(recentClientErrors(new Date(2026, 9, 21, 10, 0)).map(e => e.text)).toEqual(['mới']);
  });
});

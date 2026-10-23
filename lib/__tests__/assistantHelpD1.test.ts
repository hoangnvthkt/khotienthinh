// Đợt 1 hỗ trợ người dùng (chủ SP 23/10/2026): Trợ lý biết màn vừa mở + lỗi vừa gặp, từ điển lỗi, công cụ quyen_cua_toi / giai_thich_loi.
import { afterEach, describe, expect, it } from 'vitest';
import { clearScreen, lastScreen, noteScreen, screenContextFor, screenPath } from '../assistantScreen';
import { clearClientErrors, clientErrorsText, httpErrorDetail, recentClientErrors, recordHttpError, recordUiMessage } from '../clientErrorLog';
import { explainError, errorRuleIds } from '../../supabase/functions/ai-gateway/errorGuide';
import { buildChatPrompt, parseChatInput, parseChatScreen, screenBlock } from '../../supabase/functions/ai-gateway/chat';
import { runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { HANDBOOK_AMBIGUOUS, HANDBOOK_STOP, tokens } from '../../supabase/functions/ai-gateway/handbook';
import { AMBIGUOUS_STOP, STOP_WORDS, questionKeywords } from '../../scripts/handbook/lib.mjs';
import { issueDescription } from '../assistantIssue';

afterEach(() => { clearScreen(); clearClientErrors(); });

describe('màn vừa mở (lib/assistantScreen)', () => {
  it('giữ đường dẫn + tham số chọn tab, bỏ ô tìm / bộ lọc; bỏ trang chủ, Trung tâm, đăng nhập', () => {
    expect(screenPath('/procurement?mode=orders&q=thép D16&po=abc')).toBe('/procurement?mode=orders');
    expect(screenPath('/da?projectId=x&tab=dailylog&dailyLogId=y')).toBe('/da?tab=dailylog');
    expect(screenPath('/hrm/leave/')).toBe('/hrm/leave');
    expect(screenPath('/')).toBeNull();
    expect(screenPath('/center?view=assistant')).toBeNull();
    expect(screenPath('/login')).toBeNull();
  });
  it('ghi màn + tên; cùng màn không tên thì giữ tên cũ; ngữ cảnh chỉ lấy màn trong 60 phút và 5 lỗi 30 phút gần nhất', () => {
    const t0 = new Date(2026, 9, 23, 9, 0);
    noteScreen('/procurement?mode=orders', 'Mua hàng công ty', t0);
    noteScreen('/procurement?mode=orders&q=abc', null, new Date(2026, 9, 23, 9, 5));
    expect(lastScreen()).toMatchObject({ path: '/procurement?mode=orders', title: 'Mua hàng công ty' });
    const ctx = screenContextFor(new Date(2026, 9, 23, 9, 20));
    expect(ctx).toMatchObject({ path: '/procurement?mode=orders', title: 'Mua hàng công ty', minutesAgo: 15, errors: [] });
    expect(screenContextFor(new Date(2026, 9, 23, 10, 30))).toBeNull();
    noteScreen('/', 'Hôm nay', new Date(2026, 9, 23, 9, 30));
    expect(lastScreen()?.path).toBe('/procurement?mode=orders');
  });
  it('lỗi gần đây đi kèm cả khi không có màn', () => {
    recordUiMessage('Không lưu được phiếu', 'Vui lòng chọn kho');
    const ctx = screenContextFor(new Date());
    expect(ctx).toMatchObject({ path: '', title: null, minutesAgo: -1 });
    expect(ctx?.errors[0]).toMatchObject({ kind: 'ui', text: 'Không lưu được phiếu: Vui lòng chọn kho' });
  });
});

describe('sổ lỗi trên máy — mã + câu báo của máy chủ, lời báo màn hình', () => {
  it('đọc mã + câu báo từ thân PostgREST / hàm Edge; HTML / rỗng → không', () => {
    expect(httpErrorDetail('{"code":"PT409","message":"Đơn hàng vừa được người khác cập nhật","details":null}')).toBe('PT409 Đơn hàng vừa được người khác cập nhật');
    expect(httpErrorDetail('{"code":"42501","message":"PROCUREMENT_MANAGE_DENIED"}')).toBe('42501 PROCUREMENT_MANAGE_DENIED');
    expect(httpErrorDetail('{"error":"AI_TIMEOUT"}')).toBe('AI_TIMEOUT');
    expect(httpErrorDetail('<html>502</html>')).toBeNull();
    expect(httpErrorDetail('')).toBeNull();
  });
  it('dòng máy chủ có mã lỗi; 401 bỏ qua; lời báo màn hình ghi nhãn "màn hình báo"', () => {
    recordHttpError('POST', 'https://x.supabase.co/rest/v1/rpc/save_procurement_hub_po_v1?select=*', 409, 'PT409 Đơn vừa được người khác cập nhật');
    recordHttpError('POST', 'https://x.supabase.co/rest/v1/rpc/abc', 401, 'JWT expired');
    recordUiMessage('Không đủ tồn kho');
    const errs = recentClientErrors(new Date());
    expect(errs.map(e => e.text)).toEqual(['POST rpc/save_procurement_hub_po_v1 → 409 PT409 Đơn vừa được người khác cập nhật', 'Không đủ tồn kho']);
    expect(clientErrorsText(errs)).toMatch(/màn hình báo: Không đủ tồn kho/);
  });
});

describe('từ điển lỗi (errorGuide)', () => {
  const first = (t: string) => explainError(t)[0]?.id;
  it('mã cụ thể của máy chủ ra đúng luật, trước luật theo họ', () => {
    expect(first('FINANCE_PERIOD_LOCKED')).toBe('finance_period_locked');
    expect(first('LINK_OVER_PO: 12 > còn lại 10')).toBe('link_over_po');
    expect(first('WMS_STOCK_NEGATIVE_RECONCILIATION_REQUIRED')).toBe('stock_reconcile');
    expect(first('REQUEST_PURCHASE_HAS_ORDERS')).toBe('request_has_orders');
    expect(first('PROCUREMENT_CLOSE_REASON_REQUIRED')).toBe('close_reason');
    expect(first('SUPPLIER_PAYABLE_SETTLEMENT_EXCEEDED')).toBe('settlement_exceeded');
  });
  it('họ mã, SQLSTATE, HTTP, mạng, phiên, AI', () => {
    expect(first('PROCUREMENT_MANAGE_DENIED')).toBe('denied');
    expect(first('409 PT409 Đơn hàng vừa được người khác cập nhật')).toBe('stale');
    expect(first('PURCHASE_ORDER_VERSION_CONFLICT')).toBe('stale');
    expect(first('WMS_IDEMPOTENCY_CONFLICT')).toBe('duplicate');
    expect(first('duplicate key value violates unique constraint "x"')).toBe('duplicate');
    expect(first('SUPPLIER_INVOICE_NOT_FOUND')).toBe('not_found');
    expect(first('WMS_TRANSFER_LINES_REQUIRED')).toBe('invalid');
    expect(first('Vui lòng chọn kho nhận')).toBe('invalid');
    expect(first('Failed to fetch')).toBe('network');
    expect(first('TypeError: Load failed')).toBe('network');
    expect(first('Edge Function returned a non-2xx status code')).toBe('server');
    expect(first('canceling statement due to statement timeout')).toBe('timeout');
    expect(first('AI_TIMEOUT')).toBe('timeout');
    expect(first('Payload too large')).toBe('too_large');
    expect(first('JWT expired')).toBe('session');
    expect(first('Không có quyền thực hiện thao tác này')).toBe('denied');
    expect(first('Phiếu đã được duyệt, không thể sửa')).toBe('locked_state');
    expect(first('xin chào')).toBeUndefined();
  });
  it('mã hiện lại cho người dùng; luật thiếu quyền có cờ access, lỗi máy chủ có cờ bug; id không trùng', () => {
    const g = explainError('POST rpc/x → 403 PROCUREMENT_VIEW_DENIED')[0];
    expect(g).toMatchObject({ id: 'denied', code: 'PROCUREMENT_VIEW_DENIED', access: true });
    expect(explainError('500 Internal Server Error')[0]).toMatchObject({ id: 'server', bug: true });
    expect(new Set(errorRuleIds()).size).toBe(errorRuleIds().length);
  });
});

describe('cổng: khối man_hinh trong lời nhắc', () => {
  it('lọc đường dẫn lạ, cắt lỗi tối đa 5, loại lạ thành js; rỗng → null', () => {
    expect(parseChatScreen({ path: 'javascript:alert(1)', errors: [] })).toBeNull();
    const s = parseChatScreen({ path: '/procurement?mode=orders', title: 'Mua hàng công ty', minutesAgo: 3.4,
      errors: Array.from({ length: 7 }, (_, i) => ({ at: '2026-10-23T02:00:00Z', kind: i === 0 ? 'weird' : 'http', text: `POST rpc/x → 409 PT409 lần ${i}` })) });
    expect(s).toMatchObject({ path: '/procurement?mode=orders', title: 'Mua hàng công ty', minutesAgo: 3 });
    expect(s?.errors).toHaveLength(5);
    expect(parseChatInput({ question: 'sao không lưu được', screen: { path: '/inventory' } }).screen?.path).toBe('/inventory');
  });
  it('lỗi máy chủ được giải thích theo phần sau mũi tên, giờ theo giờ VN; chỉ đưa vào lời nhắc khi có công cụ', () => {
    const screen = parseChatScreen({ path: '/procurement', title: 'Mua hàng công ty', minutesAgo: 2,
      errors: [{ at: '2026-10-23T02:31:00Z', kind: 'http', text: 'POST rpc/get_finance_period_locked_v1 → 409 PT409 Đơn vừa được người khác cập nhật' }] })!;
    const block = screenBlock(screen);
    expect(block).toMatch(/Màn vừa mở: Mua hàng công ty \(\/procurement\), 2 phút trước/);
    expect(block).toMatch(/09:31 máy chủ: .* → Người khác vừa sửa/);
    expect(block).not.toMatch(/Kỳ tài chính đã khóa/);
    const input = { threadId: null, question: 'sao em không lưu được đơn', facts: '', pronoun: 'Anh' as const, screen };
    expect(buildChatPrompt(input, [], true).messages.at(-1)?.content).toContain('<du_lieu loai="man_hinh">');
    expect(buildChatPrompt(input, [], false).messages.at(-1)?.content).not.toContain('man_hinh');
    expect(buildChatPrompt(input, [], true).system).toMatch(/quyen_cua_toi/);
  });
});

describe('công cụ giai_thich_loi + quyen_cua_toi', () => {
  const call = async (name: string, args: Record<string, unknown>, rpc: Rpc, screenPath: string | null = null) =>
    JSON.parse(await runTool(name, args, { rpc, book: new SourceBook(), screenPath }, new Map()));
  const noRpc: Rpc = async () => { throw new Error('không được gọi máy chủ'); };

  it('giai_thich_loi: không gọi máy chủ; khớp → nghĩa + cách xử lý + cờ quyền; không khớp → rỗng + ghi chú không đoán', async () => {
    const out = await call('giai_thich_loi', { cau_loi: 'Lỗi: PROCUREMENT_MANAGE_DENIED' }, noRpc);
    expect(out.ket_qua[0]).toMatchObject({ ma: 'PROCUREMENT_MANAGE_DENIED', loai: 'Thiếu quyền', co_the_thieu_quyen: true });
    expect(out.ket_qua[0].cach_xu_ly).toBeTruthy();
    const none = await call('giai_thich_loi', { cau_loi: 'abc xyz' }, noRpc);
    expect(none.ket_qua).toEqual([]); expect(none.ghi_chu).toMatch(/không đoán/);
  });
  it('quyen_cua_toi: màn mặc định là màn vừa mở; màn người dùng nói rõ thì dùng màn đó; trả quyền thiếu + người cấp', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const rpc: Rpc = async (fn, args) => {
      calls.push({ fn, ...args });
      return { data: { la_admin: false, nguon: ['Mẫu quyền: Cán bộ kho'], quyen: [{ phan_he: 'Tồn kho', viec: 'Xem (kho Kho SMB)' }], so_phan_he: 3, phong_du_an: [],
        man_hinh: { duong_dan: '/procurement', phan_he: [{ ten: 'Mua hàng', da_co: [], chua_co: ['Xem', 'Quản trị'] }] },
        viec_can: [{ phan_he: 'Đơn hàng PO dự án', viec: 'Duyệt', da_co: false }], nguoi_cap: ['Admin Hoàng', 'Hà Đức Chuẩn'] }, error: null };
    };
    const out = await call('quyen_cua_toi', { viec: 'duyệt đơn mua' }, rpc, '/procurement');
    expect(calls[0]).toEqual({ fn: 'assistant_my_access_v1', p_route: '/procurement', p_viec: 'duyệt đơn mua' });
    expect(out).toMatchObject({ nguoi_cap: 'Admin Hoàng, Hà Đức Chuẩn', viec_can: [{ viec: 'Duyệt', da_co: false }] });
    expect(out.ghi_chu).toMatch(/Cài đặt → Người dùng/);
    await call('quyen_cua_toi', { man: '/inventory' }, rpc, '/procurement');
    expect(calls[1]).toMatchObject({ p_route: '/inventory', p_viec: null });
  });
  it('quyen_cua_toi: Admin → có mọi quyền, nguyên nhân không phải quyền; máy chủ chặn → ngoài phạm vi', async () => {
    const admin = await call('quyen_cua_toi', {}, async () => ({ data: { la_admin: true, quyen: [], nguoi_cap: [] }, error: null }));
    expect(admin).toMatchObject({ la_admin: true }); expect(admin.ghi_chu).toMatch(/KHÔNG phải quyền/);
    const denied = await call('quyen_cua_toi', {}, async () => ({ data: null, error: { code: '42501', message: 'AI_DENIED' } }));
    expect(denied.loi).toMatch(/Ngoài phạm vi/);
  });
});

describe('sổ tay — câu hỏi mẫu thành từ khóa', () => {
  it('từ đệm ở bộ dựng giống hệt lúc khớp câu hỏi', () => {
    expect([...HANDBOOK_STOP].sort()).toEqual([...STOP_WORDS].sort());
    expect(HANDBOOK_AMBIGUOUS).toEqual(AMBIGUOUS_STOP);
  });
  it('từ đệm trùng chữ nghiệp vụ: chỉ bỏ đúng dạng của từ đệm (chị, để, đâu, đó, bằng, cái, thì, mà, cho…)', () => {
    expect(tokens('Làm sao để lập đề nghị chi trả NCC hả chị')).toEqual(['lap', 'de', 'nghi', 'chi', 'tra', 'ncc', 'ha']);
    expect(tokens('thử xem phải thu chủ đầu tư từ tháng 9')).toEqual(['phai', 'thu', 'chu', 'dau', 'tu', 'thang']);
    expect(tokens('cài đặt bàn giao xe, tiến độ thi công, bảng công, mã vật tư chờ duyệt, nghỉ việc')).toEqual(['cai', 'dat', 'ban', 'giao', 'xe', 'tien', 'do', 'thi', 'cong', 'bang', 'cong', 'ma', 'vat', 'tu', 'cho', 'duyet', 'nghi', 'viec']);
    expect(tokens('ở đâu thì cho mình hỏi cái này bằng gì')).toEqual([]);
    expect(tokens('em muốn xin đến muộn')).toEqual(['muon']);
    expect(tokens('Làm sao để xin nghỉ phép vậy em?')).toEqual(['nghi', 'phep']);
    expect(questionKeywords('Lập đề nghị chi ở đâu chị')).toBe('lap de nghi chi');
  });
  it('bỏ dấu, bỏ từ đệm, giữ cụm liền nhau', () => {
    expect(questionKeywords('Sao em không chấm công được? | cham cong bao ngoai vung')).toBe('cham cong · cham cong bao ngoai vung');
  });
});

describe('phiếu sự cố ghi màn vừa làm', () => {
  it('có màn vừa làm thì thêm vào dòng màn hình', () => {
    const text = issueDescription({ description: 'Bấm Lưu báo lỗi', screen: 'Lập đơn' }, { route: '/center', version: '1.0', lastScreen: 'Mua hàng công ty /procurement' }, '', new Date(2026, 9, 23, 9, 0));
    expect(text).toMatch(/đang mở: \/center · màn vừa làm: Mua hàng công ty \/procurement · bản: 1\.0/);
  });
});

describe('mã lỗi trong câu hỏi được giải thích sẵn', () => {
  it('có mã kiểu máy → ghi chú từ từ điển trong man_hinh (kể cả không có màn); câu thường → không', async () => {
    const { questionErrorNote } = await import('../../supabase/functions/ai-gateway/chat');
    expect(questionErrorNote('Phần mềm báo FINANCE_PERIOD_LOCKED là lỗi gì em?')).toMatch(/FINANCE_PERIOD_LOCKED → Kỳ tài chính đã khóa/);
    expect(questionErrorNote('Sao em không có quyền duyệt đơn?')).toBeNull();
    const content = buildChatPrompt({ threadId: null, question: 'Lưu báo Failed to fetch là sao', facts: '', pronoun: 'Anh' }, [], true).messages.at(-1)?.content || '';
    expect(content).toMatch(/<du_lieu loai="man_hinh">[\s\S]*Mất kết nối mạng/);
    expect(buildChatPrompt({ threadId: null, question: 'Lưu báo Failed to fetch là sao', facts: '', pronoun: 'Anh' }, [], false).messages.at(-1)?.content).not.toContain('man_hinh');
  });
});

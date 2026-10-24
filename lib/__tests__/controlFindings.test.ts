// Kiểm soát viên K0: đọc dữ liệu RPC an toàn (đường dẫn chỉ trong app), đếm ô số, lời báo lỗi tiếng Việt.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { controlErrorMessage, controlTotals, parseFinding, parseRule, parseRun } from '../controlFindings';

describe('kiểm soát — đọc dữ liệu', () => {
  it('lệch: chỉ nhận đường dẫn trong app; trạng thái / mức lạ thành mặc định an toàn; số tiền dạng chữ đọc được', () => {
    const f = parseFinding({ id: 'a', rule: 'r', severity: 'PX', status: 'weird', link: 'javascript:alert(1)', amount: '1500000', legacy: true, detail: [1] });
    expect(f).toMatchObject({ severity: 'P2', status: 'open', link: null, amount: 1_500_000, legacy: true, detail: {} });
    expect(parseFinding({ link: '/procurement?po=x' }).link).toBe('/procurement?po=x');
    expect(parseFinding({ link: '//evil.example/x' }).link).toBeNull();
    expect(parseFinding({ link: 'https://evil.example' }).link).toBeNull();
  });
  it('luật + lượt chạy; ô số cộng đúng, P0 chỉ tính lệch mới', () => {
    const rules = [parseRule({ code: 'a', severity: 'P0', open: 2, openLegacy: 1, accepted: 1, resolved7d: 3 }), parseRule({ code: 'b', severity: 'P1', open: '4', openLegacy: 0 })];
    expect(controlTotals(rules)).toEqual({ open: 6, p0: 2, legacy: 1, accepted: 1, resolved7d: 3 });
    expect(parseRun(null)).toBeNull();
    expect(parseRun({ id: 3, errors: [{ rule: 'x', error: 'lỗi' }] })).toMatchObject({ id: 3, errors: [{ rule: 'x', error: 'lỗi' }] });
  });
  it('lời báo lỗi nói đúng chuyện', () => {
    expect(controlErrorMessage(new Error('42501 CONTROL_ADMIN_REQUIRED'))).toMatch(/Chỉ Admin/);
    expect(controlErrorMessage({ message: '22023 CONTROL_REASON_REQUIRED' })).toMatch(/ít nhất 10 ký tự/);
    expect(controlErrorMessage(new Error('PT409 CONTROL_FINDING_NOT_OPEN'))).toMatch(/tải lại/);
    expect(controlErrorMessage(new Error('gì đó'))).toBe('Chưa làm được, thử lại sau.');
  });
});

describe('kiểm soát K1 — người xử lý, quyền chấp nhận, mở chứng từ từ Việc của tôi', () => {
  it('lệch có người xử lý, quyền chấp nhận, quá 3 ngày; tổng quan biết có phải Admin', async () => {
    const f = parseFinding({ id: 'a', assignees: ['Bùi A', 3, 'Trần B'], canAccept: true, escalated: true });
    expect(f).toMatchObject({ assignees: ['Bùi A', 'Trần B'], canAccept: true, escalated: true });
    expect(parseFinding({}).canAccept).toBe(false);
    expect(controlErrorMessage(new Error('42501 CONTROL_ACCEPT_DENIED'))).toMatch(/trưởng bộ phận/);
  });
  it('việc nguồn control mở đúng đơn trong tab Mua hàng; đường dẫn lạ → màn Lệch cần sửa', async () => {
    const { resolveDrillTarget, moduleRouteFor } = await import('../center/drill');
    const item = (link: unknown) => ({ source: 'control', module: 'procurement', kind: 'do', id: 'f1', code: 'PO-609', title: 't', who: null, whoId: null, meta: null, dueAt: null, status: 'open', ref: { link } }) as never;
    expect(moduleRouteFor(item('/procurement?po=abc-1'))).toBe('/procurement?po=abc-1');
    expect(resolveDrillTarget(item('/procurement?po=abc-1'))).toMatchObject({ kind: 'tab', renderer: 'procurement', props: { initialOrderId: 'abc-1' } });
    expect(moduleRouteFor(item('javascript:alert(1)'))).toBe('/kiem-soat');
    expect(moduleRouteFor(item('//evil.example'))).toBe('/kiem-soat');
    expect(resolveDrillTarget(item('/da?projectId=p&tab=material'))).toMatchObject({ kind: 'tab', renderer: 'route', props: { path: '/da?projectId=p&tab=material' } });
  });
});

describe('dải cảnh báo trên chứng từ', () => {
  it('giữ cách sửa của luật, không có thì bỏ trống', () => {
    expect(parseFinding({ id: 'a', title: 'PO-694 · Nilong', fixHint: 'Ghi lý do trên dòng đơn' }).fixHint).toBe('Ghi lý do trên dòng đơn');
    expect(parseFinding({ id: 'a', title: 'PO-694 · Nilong' }).fixHint).toBeUndefined();
  });
  it('máy chủ lọc theo đơn (đường dẫn) hoặc đề xuất, cùng quyền xem với Lệch cần sửa', () => {
    const sql = readFileSync('supabase/migrations/20261030170000_control_doc_strip.sql', 'utf8');
    expect(sql).toContain("f.link = '/procurement?po=' || p_po_id");
    expect(sql).toContain("f.object_type = 'material_request' and f.object_id = p_request_id");
    expect(sql).toContain('app_private.control_can_view(f)');
  });
});

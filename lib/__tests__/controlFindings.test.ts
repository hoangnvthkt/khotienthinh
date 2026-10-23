// Kiểm soát viên K0: đọc dữ liệu RPC an toàn (đường dẫn chỉ trong app), đếm ô số, lời báo lỗi tiếng Việt.
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

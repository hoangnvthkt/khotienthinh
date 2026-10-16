import { describe, expect, it } from 'vitest';
import { buildPoReview, normalizePoReview, poReviewFacts, type PoReviewData, type PoReviewLine } from '../procurementPoReview';
import { SKILLS } from '../../supabase/functions/ai-gateway/skills';

const line = (over: Partial<PoReviewLine> = {}): PoReviewLine => ({
  lineId: 'l1', itemId: 'i1', name: 'Gạch 2 lỗ A1', specification: null, unit: 'Viên', qty: 22000, price: 1150, boq: null,
  last: null, cheaper: null, contract: null, duplicates: [], excessReason: null, ...over,
});
const po = (over: Partial<PoReviewData> = {}): PoReviewData => ({
  poId: 'po-627', poNumber: 'PO-627', status: 'sent', vendorId: 'v-hg', vendorName: 'Hoàng Gia Việt Nam', createdAt: '2026-10-10T02:00:00Z',
  lines: [line()], budget: null, vendor: { orders: 4, received: 3, short: 0 }, captures: [], ...over,
});
const texts = (r: ReturnType<typeof buildPoReview>) => r.needs.map(n => `${n.level}:${n.text}`);

describe('Tóm tắt trước khi duyệt Đơn mua — quy tắc', () => {
  it('giá cao hơn lần trước cùng NCC > 5% → cần xem, có PO nguồn; trong ±5% → Ổn "Giá như lần trước"', () => {
    const up = buildPoReview(po({ lines: [line({ last: { poId: 'po-621', poNumber: 'PO-621', date: '2026-10-08', price: 1085 } })] }));
    expect(up.needs[0]).toMatchObject({ level: 'warn', key: 'gia:l1', href: '#/procurement?po=po-621',
      text: 'Gạch 2 lỗ A1: 1.150 đ/Viên, cao hơn lần trước 6% (PO-621 08/10, 1.085 đ)' });
    const same = buildPoReview(po({ lines: [line({ last: { poId: 'po-621', poNumber: 'PO-621', date: '2026-10-08', price: 1120 } })] }));
    expect(same.needs).toEqual([]);
    expect(same.ok.map(o => o.text)).toEqual(['Giá như lần trước', 'NCC đã mua 4 đơn']);
  });

  it('gấp đôi giá lần trước → nhắc kiểm lại đơn giá (ống PVC 110: 239.632 vs 59.908 đ/Cây); rẻ hơn lần trước → Ổn', () => {
    const r = buildPoReview(po({ lines: [
      line({ lineId: 'a', name: 'Ống PVC 110 C1', unit: 'Cây', price: 239632, last: { poId: 'p370', poNumber: 'PO-370', date: '2026-08-18', price: 59908 } }),
      line({ lineId: 'b', name: 'Cút PVC 140', unit: 'Cái', price: 86564, last: { poId: 'p370', poNumber: 'PO-370', date: '2026-08-18', price: 111588 } }),
    ] }));
    expect(r.needs[0].text).toBe('Ống PVC 110 C1: 239.632 đ/Cây, cao hơn lần trước 300% (PO-370 18/08, 59.908 đ) — kiểm lại đơn giá');
    expect(r.ok.map(o => o.text)).toContain('1 dòng rẻ hơn lần trước');
  });

  it('nghi trùng đơn đang mở và hàng đã về trước (phiếu Kho chụp chưa gắn đơn) đứng đầu', () => {
    const r = buildPoReview(po({
      lines: [line({ name: 'Đinh nở đạn M6 (vách ALC)', unit: 'Cái', qty: 2000, price: 1200, duplicates: [{ poId: 'po-618', poNumber: 'PO-618', status: 'sent', qty: 2000, unit: 'Cái' }] })],
      captures: [{ id: 'c1', docNo: 'XK21044', docDate: '2026-10-07', createdAt: '2026-10-07T03:00:00Z', warehouseName: 'Kho SMB' }],
    }));
    expect(texts(r).slice(0, 2)).toEqual([
      'warn:Hàng đã về trước: Kho chụp phiếu giao của NCC này ngày 07/10 (Kho SMB), chưa gắn đơn',
      'warn:Có thể trùng PO-618 (chờ duyệt): cùng Đinh nở đạn M6 (vách ALC), 2.000 Cái',
    ]);
    expect(r.needs[1].href).toBe('#/procurement?po=po-618');
  });

  it('giá HĐ nguyên tắc: cao hơn → cần xem (không so thêm lần trước); bằng → Ổn "Đúng giá HĐ"', () => {
    const over = buildPoReview(po({ lines: [line({ price: 1200, contract: { contractId: 'hd1', code: 'HĐNT-07', price: 1100 }, last: { poId: 'x', poNumber: 'PO-1', date: null, price: 1000 } })] }));
    expect(texts(over)).toEqual(['warn:Gạch 2 lỗ A1: 1.200 đ/Viên, cao hơn giá HĐ HĐNT-07 9% (1.100 đ)']);
    const eq = buildPoReview(po({ lines: [line({ price: 1100, contract: { contractId: 'hd1', code: 'HĐNT-07', price: 1100 } })] }));
    expect(eq.needs).toEqual([]);
    expect(eq.ok[0].text).toBe('Đúng giá HĐ');
  });

  it('NCC khác bán rẻ hơn > 5% → lưu ý (không phải cảnh báo)', () => {
    const r = buildPoReview(po({ lines: [line({ cheaper: { poId: 'p2', poNumber: 'PO-600', vendorName: 'Gạch Đồng Tâm', date: '2026-09-30', price: 1000 } })] }));
    expect(r.needs).toEqual([expect.objectContaining({ level: 'info', text: 'Gạch 2 lỗ A1: Gạch Đồng Tâm bán 1.000 đ (PO-600 30/09), rẻ hơn 15%' })]);
  });

  it('dự toán: chờ duyệt vượt (kể cả khi số hiện tại đủ) · vượt · đã duyệt vượt · trong dự toán · chưa có dự toán · đơn không gắn dự án', () => {
    const check = (projected: number) => ({ over: projected > 1000, budget: 1000, projected });
    const b = (budget: PoReviewData['budget']) => buildPoReview(po({ budget, vendor: null }));
    expect(texts(b({ check: check(900), approval: { status: 'pending', approverNames: ['Lan'] } })))
      .toEqual(['warn:Chờ duyệt vượt dự toán vật tư: sau đơn dùng 90% (900 đ / 1.000 đ) — Lan duyệt ở Tài chính trước']);
    expect(texts(b({ check: check(1200), approval: null }))).toEqual(['warn:Vượt dự toán vật tư: sau đơn dùng 120% (1.200 đ / 1.000 đ)']);
    expect(texts(b({ check: check(1200), approval: { status: 'approved', decidedByName: 'Lan' } }))).toEqual(['info:Đã duyệt vượt dự toán (Lan): sau đơn dùng 120% dự toán vật tư']);
    expect(b({ check: check(560), approval: null }).ok.map(o => o.text)).toEqual(['Trong dự toán (56%)']);
    expect(texts(buildPoReview(po({ vendor: null, budget: { check: { over: true, budget: 4_200_000_000, projected: 4_386_500_000 }, approval: null } }))))
      .toEqual(['warn:Vượt dự toán vật tư: sau đơn dùng 104% (4,39 tỷ / 4,2 tỷ)']);
    const none = b({ check: null, approval: null });
    expect(none.ok).toEqual([]); expect(none.unknown.map(o => o.text)).toEqual(['Dự án chưa có dự toán vật tư']);
    expect(b(null)).toEqual({ needs: [], ok: [], unknown: [] });
  });

  it('BOQ gộp một dòng (đo 16/10: 50/108 dòng ngoài BOQ) kèm lý do của đơn; đặt vượt nhu cầu từng dòng', () => {
    const r = buildPoReview(po({ vendor: null, lines: [line({ boq: 'outside' }), line({ lineId: 'l2', name: 'Vữa', boq: 'outside' }), line({ lineId: 'l3', name: 'Xi măng', boq: 'over' })] }), { overBoqReason: 'Phát sinh tường rào' });
    expect(texts(r)).toEqual(['warn:Xi măng vượt BOQ — Phát sinh tường rào', 'info:2/3 dòng ngoài BOQ']);
    const all = buildPoReview(po({ vendor: null, lines: [line({ boq: 'outside' })] }), { overBoqReason: 'Vật tư phụ' });
    expect(texts(all)).toEqual(['info:Cả đơn ngoài BOQ — Vật tư phụ']);
    expect(buildPoReview(po({ vendor: null, lines: [line({ boq: 'within' })] })).ok.map(o => o.text)).toEqual(['Trong BOQ']);
    expect(texts(buildPoReview(po({ vendor: null, lines: [line({ excessReason: 'Dự phòng hao hụt' })] })))).toEqual(['warn:Gạch 2 lỗ A1: đặt vượt nhu cầu — Dự phòng hao hụt']);
  });

  it('NCC mới · hay giao thiếu · quen; không có NCC thì không xét', () => {
    expect(texts(buildPoReview(po({ vendor: { orders: 0, received: 0, short: 0 } })))).toEqual(['info:NCC mới: chưa có đơn nào trong 12 tháng']);
    const short = buildPoReview(po({ vendor: { orders: 7, received: 3, short: 2 } }));
    expect(texts(short)).toEqual(['info:NCC giao thiếu 2/3 lần nhận trong 6 tháng']); expect(short.ok).toEqual([]);
    expect(buildPoReview(po({ vendorId: null, vendor: { orders: 0, received: 0, short: 0 } })).needs).toEqual([]);
  });

  it('cảnh báo trước lưu ý; dòng gửi AI đúng các dòng trên màn', () => {
    const r = buildPoReview(po({ vendor: { orders: 0, received: 0, short: 0 }, lines: [line({ last: { poId: 'p', poNumber: 'PO-621', date: null, price: 1000 } })] }));
    expect(r.needs.map(n => n.level)).toEqual(['warn', 'info']);
    expect(poReviewFacts(r, { poNumber: 'PO-627', vendorName: 'Hoàng Gia Việt Nam', total: 25300000 }).split('\n')).toEqual([
      'don | Đơn PO-627 · Hoàng Gia Việt Nam · 25.300.000 đ',
      'gia:l1 | Cần xem · Gạch 2 lỗ A1: 1.150 đ/Viên, cao hơn lần trước 15% (PO-621, 1.000 đ)',
      'ncc-moi | Lưu ý · NCC mới: chưa có đơn nào trong 12 tháng',
    ]);
  });

  it('chuẩn hóa JSON RPC: số dạng chuỗi, thiếu mảng', () => {
    const d = normalizePoReview({ poId: 'p', status: 'sent', lines: [{ lineId: 'a', itemId: 'i', qty: '3', price: '1500.5', last: { poId: 'x', price: '1400' } }],
      budget: { check: { over: false, budget: '1000', projected: '500' }, approval: null }, vendor: { orders: '2', received: '1', short: '0' } });
    expect(d).toMatchObject({ lines: [{ qty: 3, price: 1500.5, last: { price: 1400 }, duplicates: [] }], budget: { check: { budget: 1000, projected: 500 } }, vendor: { orders: 2 }, captures: [] });
    expect(normalizePoReview(null)).toBeNull();
  });
});

describe('skill po_review_brief', () => {
  const skill = SKILLS.po_review_brief;
  it('bọc dòng kiểm tra trong <du_lieu>, trả đúng một câu; đầu vào quá ngắn bị chặn', () => {
    const input = skill.parseInput({ facts: 'don | Đơn PO-627 · Hoàng Gia · 25.300.000 đ' });
    expect(skill.user(input)).toContain('kiem_tra');
    expect(skill.user(input)).toContain('{"sentence"');
    expect(skill.parseOutput({ sentence: '  Đơn có thể trùng PO-618.  ' })).toEqual({ sentence: 'Đơn có thể trùng PO-618.' });
    expect(() => skill.parseInput({ facts: 'x' })).toThrow('AI_BAD_INPUT');
    expect(skill.maxOutputTokens).toBeLessThanOrEqual(300);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateReceiptGuards, type ReceiptGuardInput, type ReceiptGuardLine } from '../receiptGuards';

// Ca thật PO-272: đặt 45.230 kg, đã nhận 9.300 (lần 2 6.000 nhập ngoài đơn), đợt 2 trên phiếu 35.930, thực nhận 21.000.
const sika = (patch: Partial<ReceiptGuardLine> = {}): ReceiptGuardLine => ({
  name: 'Sika màu xám', unit: 'Kg', plannedQty: 35930, actualQty: 21000, purchasePerStock: 1, purchaseUnit: 'Kg',
  orderedQty: 45230, receivedQty: 9300, pendingOtherQty: 0, maxWithoutOver: 35930, ...patch,
});
const input = (patch: Partial<ReceiptGuardInput> = {}, line: Partial<ReceiptGuardLine> = {}): ReceiptGuardInput => ({
  lines: [sika(line)], arrivalDate: '2026-10-10', today: '2026-10-13', poCreatedAt: '2026-07-31T02:00:00Z', shortPlan: 'continue', ...patch,
});
const codes = (result: ReturnType<typeof evaluateReceiptGuards>) => result.issues.map(issue => issue.code);

describe('evaluateReceiptGuards — kiểm lại trước khi kho ghi sổ nhận hàng', () => {
  it('nhận thiếu 21.000/35.930: hiện đúng số, tiến độ đơn sau khi nhận, phần thiếu mở đợt kế', () => {
    const result = evaluateReceiptGuards(input());
    expect(result.blocked).toBe(false);
    expect(result.rows[0]).toMatchObject({ actualQty: 21000, diff: -14930, receivedAfter: 30300, remainingAfter: 14930 });
    expect(codes(result)).toContain('short_continue');
    expect(result.totalShort).toBe(14930);
  });

  it('ô số bị trả về số phiếu (35.930 = số phiếu): nói rõ "Nhận đủ" để người dùng thấy trước khi ghi', () => {
    const result = evaluateReceiptGuards(input({ shortPlan: null }, { actualQty: 35930 }));
    expect(result.issues[0]).toMatchObject({ level: 'info', code: 'full' });
    expect(result.issues[0].text).toContain('Nhận đủ 35.930 Kg');
    expect(result.blocked).toBe(false);
  });

  it('nhận thiếu chưa chọn phần thiếu → chặn', () => {
    const result = evaluateReceiptGuards(input({ shortPlan: null }));
    expect(result.blocked).toBe(true);
    expect(codes(result)).toContain('short_plan');
  });

  it('phiếu nhập ngoài đơn cùng vật tư → phải tích xác nhận', () => {
    const result = evaluateReceiptGuards(input({}, { outsideImports: [{ code: 'NK20260918-00511', date: '2026-09-08T12:00:00Z', qty: 6000 }] }));
    expect(result.needsAck).toBe(true);
    expect(result.issues.find(issue => issue.code === 'outside_import')?.text).toContain('NK20260918-00511 ngày 08/09/2026: 6.000 Kg');
  });

  it('gõ thừa chữ số 0 (210.000) → vượt đơn + gấp 5 lần: phải tích xác nhận, đánh dấu dòng vượt đơn', () => {
    const result = evaluateReceiptGuards(input({}, { actualQty: 210000 }));
    expect(result.needsAck).toBe(true);
    expect(result.overLineIndexes).toEqual([0]);
    expect(codes(result)).toEqual(expect.arrayContaining(['over_po', 'over_batch']));
    expect(result.rows[0].remainingAfter).toBe(45230 - 9300 - 210000);
  });

  it('gấp ≥ 10 lần số phiếu → cảnh báo gõ thừa chữ số', () => {
    const result = evaluateReceiptGuards(input({}, { plannedQty: 100, actualQty: 1000, maxWithoutOver: 5000 }));
    expect(codes(result)).toContain('huge');
    expect(result.overLineIndexes).toEqual([]);
  });

  it('nhầm dấu phẩy (21,000 → 21) → chỉ 0% số phiếu: phải tích xác nhận', () => {
    const result = evaluateReceiptGuards(input({}, { actualQty: 21 }));
    expect(codes(result)).toContain('tiny');
    expect(result.needsAck).toBe(true);
  });

  it('không nhận gì (0) → cảnh báo cả đợt thiếu', () => {
    const result = evaluateReceiptGuards(input({}, { actualQty: 0 }));
    expect(codes(result)).toContain('zero');
    expect(result.totalShort).toBe(35930);
  });

  it('chưa nhập số / ngày tương lai / thiếu ngày → chặn', () => {
    expect(evaluateReceiptGuards(input({}, { actualQty: Number.NaN })).blocked).toBe(true);
    expect(codes(evaluateReceiptGuards(input({ arrivalDate: '2026-10-14' })))).toContain('date_future');
    expect(codes(evaluateReceiptGuards(input({ arrivalDate: '' })))).toContain('date_missing');
  });

  it('ngày hàng về trước ngày lập đơn / lùi quá 7 ngày → cảnh báo', () => {
    const result = evaluateReceiptGuards(input({ arrivalDate: '2026-07-20' }));
    expect(codes(result)).toEqual(expect.arrayContaining(['date_before_po', 'date_backdated']));
  });

  it('đơn còn đợt khác đang chờ nhận → nhắc đối chiếu đúng xe', () => {
    const result = evaluateReceiptGuards(input({ otherOpenBatches: [{ deliveryNo: 3, qty: 8930 }] }));
    expect(result.issues.find(issue => issue.code === 'other_batch')?.text).toContain('đợt giao 3');
  });

  it('chưa tải được tiến độ đơn → không cảnh báo theo đơn nhưng nhắc tự đối chiếu', () => {
    const result = evaluateReceiptGuards(input({ contextUnavailable: true }, { orderedQty: undefined, receivedQty: undefined, maxWithoutOver: undefined }));
    expect(codes(result)).toContain('context_missing');
    expect(result.rows[0].remainingAfter).toBeNull();
  });

  it('điểm chặn đứng đầu, thông tin đứng cuối', () => {
    const levels = evaluateReceiptGuards(input({ shortPlan: null, otherOpenBatches: [{ deliveryNo: 3, qty: 1 }] }, { actualQty: 21 })).issues.map(issue => issue.level);
    expect(levels).toEqual([...levels].sort((a, b) => ['block', 'confirm', 'warn', 'info'].indexOf(a) - ['block', 'confirm', 'warn', 'info'].indexOf(b)));
  });
});

describe('hợp đồng máy chủ + màn phiếu (14/10/2026)', () => {
  const migration = readFileSync('supabase/migrations/20261014100000_purchase_receipt_guards.sql', 'utf8');
  const modal = readFileSync('components/TransactionDetailModal.tsx', 'utf8');

  it('chặn nhận vượt phần đơn còn lại khi chưa xác nhận NCC giao dư', () => {
    expect(migration).toContain("coalesce((v_line->>'overConfirmed')::boolean, false) is not true");
    expect(migration).toContain('PURCHASE_RECEIPT_OVER_PO');
    expect(modal).toContain('overLineIndexes.includes(index) ? { ...line, overConfirmed: true } : line');
  });

  it('sửa số nhận: chỉ giảm, người Duyệt ngoại lệ khác người duyệt nhận, công nợ đã dùng thì chặn, ghi phiếu điều chỉnh', () => {
    expect(migration).toContain('PURCHASE_FIX_INCREASE');
    expect(migration).toContain('app_private.wms_user_can_approve_exception(v_actor, v_wh)');
    expect(migration).toContain('PURCHASE_FIX_SELF');
    expect(migration).toContain('PURCHASE_FIX_AP_USED');
    expect(migration).toContain("'ADJUSTMENT', v_tx.date");
    expect(migration).toContain("'receipt_correction'");
  });

  it('không đặt lại ô thực nhận khi cùng phiếu được tải lại; lưu bản nháp', () => {
    expect(modal).toContain('}, [propTxId, propTxStatus, propTxLines]);');
    expect(modal).not.toMatch(/useEffect\(\(\) => \{\s*if \(transactionProp\) \{\s*setLocalTransaction\(transactionProp\);\s*setQuantityDrafts/);
    expect(modal).toContain('writeReceiptDraft(transactionProp');
  });
});

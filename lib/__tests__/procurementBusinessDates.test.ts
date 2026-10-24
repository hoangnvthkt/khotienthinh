import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backdateHint, businessDateIssue, daysBack, earliestBusinessDate } from '../businessDate';
import { getApiErrorMessage } from '../apiError';

const sql = readFileSync(new URL('../../supabase/migrations/20261008137600_procurement_business_dates.sql', import.meta.url), 'utf8');

describe('Ngày nghiệp vụ — gợi ý ở ô ngày', () => {
  it('lùi tối đa 7 ngày không cần quyền; quá 7 ngày nhắc quyền; không tương lai', () => {
    expect(daysBack('2026-10-01', '2026-10-08')).toBe(7);
    expect(backdateHint('2026-10-01', '2026-10-08')).toBeNull();
    expect(backdateHint('2026-09-26', '2026-10-08')).toContain('Nhập dữ liệu quá khứ');
    expect(backdateHint('2026-10-09', '2026-10-08')).toContain('sau hôm nay');
  });
  it('lỗi nghiệp vụ hiện đúng câu tiếng Việt', () => {
    expect(getApiErrorMessage({ message: 'PURCHASE_RECEIPT_RECON_OPEN: Đợt này đang đối chiếu ở Mua hàng.', code: '22023' })).toBe('Đợt này đang đối chiếu ở Mua hàng.');
    expect(getApiErrorMessage({ message: 'BUSINESS_DATE_BACKDATE: Ngày 26/09/2026 lùi quá 7 ngày — cần quyền.', code: '42501', status: 403 })).toBe('Ngày 26/09/2026 lùi quá 7 ngày — cần quyền.');
  });
});

// 24/10/2026 (PO-703/704/705): đơn đã lưu, bước đặt ngày 14/10 bị 403 vì thiếu quyền, màn lại báo câu chung chung
// "Không tải được dữ liệu Mua hàng" nên người lập bấm lưu lại 3 lần → 3 đơn nháp trùng.
describe('Ngày đặt hàng — chặn ngay ở ô ngày khi thiếu quyền', () => {
  it('thiếu quyền: lùi quá 7 ngày bị chặn, nói rõ cách xử lý; trong 7 ngày thì không sao', () => {
    expect(businessDateIssue('2026-10-01', false, '2026-10-08')).toBeNull();
    const blocked = businessDateIssue('2026-10-14', false, '2026-10-24');
    expect(blocked).toMatchObject({ blocked: true });
    expect(blocked?.text).toContain('Lùi 10 ngày');
    expect(blocked?.text).toContain('Nhập dữ liệu quá khứ');
  });
  it('có quyền: lùi xa chỉ nhắc, không chặn', () => {
    expect(businessDateIssue('2026-10-14', true, '2026-10-24')).toMatchObject({ blocked: false });
  });
  it('không ai được chọn ngày sau hôm nay', () => {
    for (const can of [true, false]) expect(businessDateIssue('2026-10-25', can, '2026-10-24')).toMatchObject({ blocked: true });
  });
  it('lịch chỉ mở 7 ngày gần đây khi thiếu quyền', () => {
    expect(earliestBusinessDate('2026-10-24')).toBe('2026-10-17');
    expect(businessDateIssue(earliestBusinessDate('2026-10-24'), false, '2026-10-24')).toBeNull();
  });
});

describe('Ngày nghiệp vụ — migration', () => {
  it('nhận 1 bước không còn ép "Đã nhận đủ"; chặn khi đợt đang đối chiếu', () => {
    expect(sql).not.toMatch(/set status = 'delivered',\s*actual_delivery_date = coalesce\(actual_delivery_date, current_date::text\)/);
    expect(sql.match(/PURCHASE_RECEIPT_RECON_OPEN/g)?.length).toBe(2);
  });
  it('công nợ, chi phí dự án, phiếu giao HĐ theo ngày hàng về', () => {
    expect(sql).toContain("coalesce((v_tx.date at time zone 'Asia/Ho_Chi_Minh')::date, current_date), -- công nợ theo ngày hàng về");
    expect(sql).toContain('from public.transactions t where t.id = v_b.wms_transaction_id');
    expect(sql).toContain("update public.supplier_payable_documents set document_date = (p->>'date')::date");
    expect(sql).toContain('WMS_DOC_DATE_STATEMENTED');
  });
  it('lùi quá 7 ngày cần quyền Nhập dữ liệu quá khứ ở mọi chỗ ghi ngày', () => {
    expect(sql).toContain("'system.procurement.backdate'");
    expect(sql.match(/perform app_private\.assert_business_date/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain('create function public.set_purchase_order_order_date_v1');
  });
});

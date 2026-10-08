import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backdateHint, daysBack } from '../businessDate';
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

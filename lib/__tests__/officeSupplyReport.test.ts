import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deptSheetRows, monthLabel, peopleSheetRows, reportFileName, shiftMonth, xntActive, xntSheetRows } from '../officeSupplyReport';
import { vppErrorMessage, isVppConflict, type VppReport, type VppXntRow } from '../officeSupplyService';

const sql = readFileSync(new URL('../../supabase/migrations/20261024150000_vpp_report_finance.sql', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../../supabase/tests/vpp_report_finance_smoke.sql', import.meta.url), 'utf8');
const baseline = JSON.parse(readFileSync(new URL('../../supabase/baseline/current.json', import.meta.url), 'utf8'));

const row = (o: Partial<VppXntRow>): VppXntRow => ({ itemId: 'it', sku: 'VPP001', name: 'Giấy A4', unit: 'Gam', openQty: 0, inQty: 0, outQty: 0, closeQty: 0,
  openValue: 0, inValue: 0, outValue: 0, closeValue: 0, unitPrice: 62500, note: null, ...o });
const report: VppReport = {
  month: '2026-10', warehouseId: 'wh', warehouseName: 'Kho VPP Hưng Yên', firstMonth: '2026-10', can: { post: false, reverse: false },
  totals: { openValue: 625000, inValue: 0, outValue: 125000, closeValue: 500000, cost: 125000, returned: 0, requestCount: 1, issuedRequestCount: 1 },
  xnt: [row({ openQty: 10, outQty: 2, closeQty: 8, openValue: 625000, outValue: 125000, closeValue: 500000, note: 'Nguyễn Thị Hương 2' }),
    row({ itemId: 'it2', sku: 'VPP010', name: 'Chân ghim số 10 Plus', unit: 'Hộp', unitPrice: 3500 })],
  people: [{ userId: 'u1', name: 'Nguyễn Thị Hương', orgUnitName: 'Phòng Hành chính - Nhân sự', requestCount: 1, requestedQty: 5, issuedQty: 2, value: 125000, items: [] }],
  departments: [
    { orgUnitId: 'ou1', name: 'Phòng Hành chính - Nhân sự', people: 1, requestCount: 1, requestedQty: 5, issuedQty: 2, issuedValue: 128500, returnedValue: 3500, value: 125000 },
    { orgUnitId: null, name: 'Chưa có phòng ban', people: 1, requestCount: 2, requestedQty: 3, issuedQty: 0, issuedValue: 0, returnedValue: 0, value: 0 },
  ],
  posting: { month: '2026-10', liveTotal: 125000, liveIssued: 128500, liveReturned: 3500, closed: false, allocation: null, posted: null, history: [] },
};

describe('VPP báo cáo — tháng và bảng tính XNT', () => {
  it('lùi / tiến tháng qua năm, nhãn MM/YYYY', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthLabel('2026-10')).toBe('10/2026');
  });
  it('mã không tồn, không phát sinh bị ẩn khi lọc', () => {
    expect(report.xnt.filter(xntActive).map(r => r.sku)).toEqual(['VPP001']);
  });
  it('trang XNT theo mẫu thủ kho: tiêu đề, kho, 11 cột, dòng Cộng = tổng thành tiền tồn cuối', () => {
    const rows = xntSheetRows(report);
    expect(rows[0][0]).toBe('BẢNG NHẬP – XUẤT – TỒN VĂN PHÒNG PHẨM THÁNG 10/2026');
    expect(rows[1][0]).toBe('Kho VPP Hưng Yên');
    expect(rows[2]).toEqual(['STT', 'Mã', 'Tên vật tư', 'ĐVT', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối', 'Ghi chú', 'Đơn giá', 'Thành tiền']);
    expect(rows[3]).toEqual([1, 'VPP001', 'Giấy A4', 'Gam', 10, 0, 2, 8, 'Nguyễn Thị Hương 2', 62500, 500000]);
    expect(rows.at(-1)).toEqual(['', '', 'Cộng', '', '', '', '', '', '', '', 500000]);
    expect(reportFileName(report)).toBe('XNT-VPP-2026-10.xlsx');
  });
  it('trang theo người / phòng ban có dòng Cộng; chi phí phòng = cấp − trả lại', () => {
    expect(peopleSheetRows(report).at(-1)).toEqual(['Cộng', '', 1, '', '', 125000]);
    const d = deptSheetRows(report);
    expect(d[1]).toEqual(['Phòng Hành chính - Nhân sự', 1, 1, 5, 2, 128500, 3500, 125000]);
    expect(d.at(-1)).toEqual(['Cộng', '', 3, '', '', 128500, 3500, 125000]);
  });
  it('thông báo lỗi chốt chi phí dễ hiểu; số liệu đổi coi như xung đột để tải lại', () => {
    expect(vppErrorMessage({ message: 'VPP_MONTH_OPEN' })).toBe('Tháng chưa kết thúc, chưa chốt được.');
    expect(vppErrorMessage({ message: 'VPP_ALLOCATION_LOCKED' })).toContain('Phân bổ tháng');
    expect(isVppConflict({ code: 'PT409', message: 'VPP_COST_CHANGED' })).toBe(true);
  });
});

describe('VPP báo cáo — migration', () => {
  it('nằm trong allowlist', () => {
    expect(baseline.allowedPostBaselineFiles).toContain('20261024150000_vpp_report_finance.sql');
  });
  it('mọi hàm security definer có search_path rỗng; xung đột dùng PT409, không dùng 40001', () => {
    const fns = [...sql.matchAll(/create or replace function ([\w.]+)\(/g)].map(m => m[1]);
    expect(fns).toEqual(expect.arrayContaining(['public.get_office_supply_report_v1', 'public.post_office_supply_costs_v1', 'public.reverse_office_supply_costs_v1']));
    for (const block of sql.split(/create or replace function /).slice(1)) {
      const head = block.slice(0, block.indexOf('$$'));
      if (head.includes('security definer')) expect(head).toContain("set search_path = ''");
    }
    expect(sql).toContain("errcode = 'PT409', message = 'VPP_COST_CHANGED'");
    expect(sql).not.toContain("'40001'");
  });
  it('quyền: báo cáo cho Xem báo cáo / Quản trị VPP, thủ kho, người xem Tài chính; chốt cần Tài chính — Ghi nhận', () => {
    expect(sql).toMatch(/vpp_can_report\(p_user\) or app_private\.vpp_is_keeper\(p_warehouse_id, p_user\)\s+or app_private\.finance_can\('view'\)/);
    expect(sql).toContain("if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'");
    expect(sql).toMatch(/grant execute on function public\.get_office_supply_report_v1\(jsonb\), public\.post_office_supply_costs_v1\(jsonb\), public\.reverse_office_supply_costs_v1\(jsonb\)\s+to authenticated/);
    expect(sql).toMatch(/revoke all on function app_private\.vpp_default_warehouse\(\)[\s\S]+from public, anon, authenticated;/);
  });
  it('chỉ chốt tháng đã qua; chốt lại phải có lý do; phân bổ đã gửi chốt thì khóa', () => {
    expect(sql).toContain("message = 'VPP_MONTH_OPEN'");
    expect(sql).toContain("message = 'VPP_REASON_REQUIRED'");
    expect(sql.match(/message = 'VPP_ALLOCATION_LOCKED'/g)).toHaveLength(2);
  });
  it('chi phí = ra − vào của dòng sổ kho gắn phiếu VPP (trả lại giảm chi phí tháng trả)', () => {
    expect(sql).toContain("join public.office_supply_requests r on r.id::text = e.metadata->>'officeSupplyRequestId'");
    expect(sql).toContain('round(sum(m.value_out) - sum(m.value_in), 2)');
  });
  it('Phân bổ tháng: VPP đã chốt vào Chi phí chung, phiếu chi "Mua VPP nhập kho" mặc định không tính', () => {
    expect(sql).toContain("check (source_type in ('expense_request', 'office_salary', 'office_supply', 'manual'))");
    expect(sql).toContain("not in ('salary', 'loan_repay', 'staff_advance', 'tax', 'office_supply_stock')");
    expect(sql).toContain("select p_run, 'office_supply', x.id::text");
  });
  it('smoke trên Cloud kiểm cả chốt, chốt lại, đảo và dựng lại phân bổ nháp, kết thúc ROLLBACK', () => {
    expect(smoke.trim().endsWith('rollback;')).toBe(true);
    for (const k of ["'post'", "'repost'", "'reverse'", "'pool'", "'poolAfter'"]) expect(smoke).toContain(k);
  });
});

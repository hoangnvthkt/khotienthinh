import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changedPrices, docDelta, lineDelta, priceWarnings, routeFor } from '../../components/finance/PriceSettlement';
import type { InvoiceDocument, PriceApproval, PriceLine } from '../financeService';

// Chốt giá NCC (doc 17-chot-gia-ncc.md). Rollback: .superpowers/price/price-test.mjs 74/74.

const sql = readFileSync('supabase/migrations/20261010170000_finance_price_settlements.sql', 'utf8');

const line = (p: Partial<PriceLine> = {}): PriceLine => ({ lineId: 'l1', kind: 'po_delivery_line', itemName: 'Sika 214', unit: 'Bao', qty: 55, orderedPrice: 300000, currentPrice: 300000, vatRate: 0, ...p });
const doc = (p: Partial<InvoiceDocument> = {}): InvoiceDocument => ({ id: 'd1', code: 'AP-1', documentNo: 'PO-474-01', sourceType: 'purchase_delivery_receipt', projectCode: 'SMB-2026',
  contractCode: null, documentDate: '2026-08-18', recognized: 21450000, outstanding: 21450000, invoiced: 0, remaining: 21450000, requireInvoice: false, poNumber: 'PO-474',
  lines: [line()], priceDelta: 0, paid: 0, companyScope: false, ...p });
const approval: PriceApproval = {
  decrease: [{ label: 'Kế toán trưởng xác nhận', names: ['Hương'] }],
  tiers: [{ tierNo: 1, min: 0, max: 100e6, steps: [{ label: 'KTT duyệt', names: ['Hương'] }] },
    { tierNo: 2, min: 100e6, max: 1e9, steps: [{ label: 'KTT kiểm tra', names: ['Hương'] }, { label: 'GĐTC duyệt', names: ['Chuẩn'] }] },
    { tierNo: 3, min: 1e9, max: null, steps: [{ label: 'a', names: [] }, { label: 'b', names: [] }, { label: 'TGĐ', names: ['Thịnh'] }] }],
};

describe('Chốt giá NCC — tính chênh và luồng duyệt', () => {
  it('chênh có VAT = SL thực nhận × (giá mới − giá đang áp) × (1 + VAT)', () => {
    expect(lineDelta(line(), 280000)).toBe(-1100000);
    expect(lineDelta(line({ qty: 22000, orderedPrice: 1481.48, currentPrice: 1481.48, vatRate: 8 }), 1400)).toBe(-1935965);
    // Chốt lần 2 tính từ giá đã chốt, không từ giá đặt.
    expect(lineDelta(line({ currentPrice: 280000 }), 270000)).toBe(-550000);
  });

  it('chỉ lấy dòng có giá khác giá đang áp; ô trống / giá cũ / chữ không hợp lệ bỏ qua', () => {
    const d = doc({ lines: [line(), line({ lineId: 'l2', itemName: 'Sikadur', qty: 15, orderedPrice: 330000, currentPrice: 330000 })] });
    expect(changedPrices([d], { 'd1:l1': '280.000', 'd1:l2': '330.000' }).map(x => x.lineId)).toEqual(['l1']);
    expect(changedPrices([d], { 'd1:l1': '', 'd1:l2': 'abc' })).toEqual([]);
    expect(docDelta(d, { 'd1:l1': '280.000' })).toBe(-1100000);
  });

  it('chỉ giảm → bước Kế toán trưởng; có tăng → ma trận theo số tăng', () => {
    expect(routeFor(approval, 0).map(s => s.label)).toEqual(['Kế toán trưởng xác nhận']);
    expect(routeFor(approval, 616000).map(s => s.label)).toEqual(['KTT duyệt']);
    expect(routeFor(approval, 148.5e6).map(s => s.label)).toEqual(['KTT kiểm tra', 'GĐTC duyệt']);
    expect(routeFor(approval, 2e9)).toHaveLength(3);
  });

  it('cảnh báo: đã có hóa đơn giá cũ (biên bản), giảm vượt số còn nợ → NCC nợ lại, hàng Kho Tổng', () => {
    const d = doc({ invoiced: 21450000, outstanding: 500000, paid: 20950000, companyScope: true });
    const w = priceWarnings([d], { 'd1:l1': '280.000' }, false);
    expect(w.some(x => x.includes('hóa đơn điều chỉnh giảm'))).toBe(true);
    expect(w.some(x => x.includes('NCC nợ lại'))).toBe(true);
    expect(w.some(x => x.includes('Kho Tổng'))).toBe(true);
    expect(priceWarnings([d], { 'd1:l1': '280.000' }, true).some(x => x.includes('hóa đơn điều chỉnh'))).toBe(false);
  });
});

describe('Chốt giá NCC — máy chủ', () => {
  it('không sửa đơn / phiếu kho: giảm = giảm trừ chứng từ, tăng = chứng từ mới, chi phí dự án theo, Kho Tổng chỉ gắn nhãn', () => {
    expect(sql).toContain("'subcontract_round', 'subcontract_retention', 'subcontract_opening', 'supplier_price_adjustment']");
    expect(sql).toContain('update public.supplier_payable_documents set credit_amount = credit_amount + v_take');
    expect(sql).toContain("'supplier_price_adjustment', s.id::text");
    expect(sql).toContain("'supplier_price_settlement:' || s.id || ':' || b.id");
    expect(sql).toContain('v_inv := v_inv || to_jsonb(coalesce(b.document_no, b.code));');
    expect(sql).not.toMatch(/update public\.purchase_order(_delivery_lines|s) set/);
  });

  it('duyệt: người lập / người nhận hàng không duyệt; một dòng một bản chờ duyệt; đang đề nghị chi thì chặn giảm', () => {
    expect(sql).toContain('p_actor is distinct from p_creator');
    expect(sql).toContain('app_private.finance_doc_handlers(d)');
    expect(sql).toContain("message = 'FINANCE_PRICE_LINE_PENDING'");
    expect(sql).toContain("message = 'FINANCE_PRICE_DOC_RESERVED'");
  });

  it('NCC nợ lại: tự trừ cùng NCC + cùng dự án; hoàn tiền người khác xác nhận mới vào sổ thu chi; đã dùng thì không đảo', () => {
    expect(sql).toContain('app_private.finance_scope_key(x.project_id, x.construction_site_id) = app_private.finance_scope_key(c.project_id, c.construction_site_id)');
    expect(sql).toContain("if u.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'");
    expect(sql).toContain("'in', u.amount, 'supplier_credit_refund'");
    expect(sql).toContain("message = 'FINANCE_PRICE_CREDIT_USED'");
  });

  it('đã có hóa đơn giá cũ → chờ HĐ điều chỉnh; báo người lập PO; Mua hàng xem giá chốt', () => {
    expect(sql).toContain("if s.basis = 'agreement' and app_private.finance_doc_invoiced(b.id, null) > 0.5 then v_needs := true; end if;");
    expect(sql).toContain("'/#/procurement?po=' || v_po.id");
    expect(sql).toContain('create function public.get_procurement_po_price_settlements_v1(p_po_id text)');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { suggestDocuments } from '../../components/finance/InvoicesView';
import type { InvoiceDocument } from '../financeService';

// K3c hóa đơn đầu vào + khớp 3 bên (doc 08 quyết định 8, tình huống 5, 6, 12). Rollback: tools/k3c-test.mjs 43/43.

const sql = readFileSync('supabase/migrations/20261008135100_finance_k3c_invoices.sql', 'utf8');
const hub = readFileSync('components/finance/FinanceHubView.tsx', 'utf8');

describe('Tài chính — K3c hóa đơn NCC', () => {
  it('dung sai 0,5% hoặc 50.000 đ; trong dung sai ghi ngay, vượt thì lý do + người khác duyệt', () => {
    expect(sql).toContain('greatest(round(abs(coalesce(p_expected, 0)) * 0.005, 2), 50000::numeric)');
    expect(sql).toContain("if abs(v_var) <= v_tol then v_status := 'posted';");
    expect(sql).toContain("message = 'FINANCE_INVOICE_VARIANCE_REASON'");
    expect(sql).toContain("if i.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SAME_PERSON'");
  });

  it('hóa đơn đến trước hàng = chờ hàng; lệch dương thành chứng từ điều chỉnh, lệch âm giảm trừ công nợ; chi phí dự án theo', () => {
    expect(sql).toContain("if jsonb_array_length(v_lines) = 0 then v_status := 'awaiting_goods'");
    expect(sql).toContain("'supplier_invoice_adjustment', i.id::text");
    expect(sql).toContain('update public.supplier_payable_documents set credit_amount = credit_amount + v_take');
    expect(sql).toContain("'supplier_invoice_adjustment:' || i.id");
  });

  it('HĐ bắt buộc hóa đơn chặn đề nghị chi; khoá cách ghi hóa đơn cũ', () => {
    expect(sql).toContain("message = 'FINANCE_CONTRACT_NEEDS_INVOICE'");
    expect(sql).toContain('revoke execute on function public.record_supplier_invoice_reconciliation_v3(jsonb, jsonb, jsonb, text) from authenticated');
    expect(sql).toContain("create policy supplier_invoices_finance_select on public.supplier_invoices for select to authenticated using (app_private.finance_can('view'))");
  });

  it('có bước "Hóa đơn NCC" ở Phải trả', () => {
    expect(hub).toContain("['invoices', 'Hóa đơn NCC'");
    expect(hub).toContain("stage === 'invoices' ? <InvoicesView");
  });

  it('gợi ý chứng từ: một chứng từ trong dung sai, không có thì cộng dần từ chứng từ cũ nhất', () => {
    const doc = (id: string, remaining: number, documentDate: string) => ({ id, remaining, documentDate } as InvoiceDocument);
    const docs = [doc('a', 168091500, '2026-09-01'), doc('b', 112140000, '2026-09-05'), doc('c', 109130000, '2026-09-03')];
    expect(suggestDocuments(docs, 112180000)).toEqual({ b: 112140000 });
    expect(suggestDocuments(docs, 277221500)).toEqual({ a: 168091500, c: 109130000 });
    expect(suggestDocuments(docs, 0)).toEqual({});
  });
});

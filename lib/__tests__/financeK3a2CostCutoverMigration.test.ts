import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMisaImportGuards, type ProjectTransactionImportPreviewResult } from '../projectTransactionImport';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261006150000_finance_k3a2_cost_cutover_stock.sql'), 'utf8').toLowerCase();

describe('K3a-2 — mốc chi phí MISA, chặn nhập trùng, dự trữ Kho Tổng', () => {
  it('zeroes Vioo supplier costs dated before the project cut-over and keeps the original amount', () => {
    expect(sql).toContain('new.misa_overlap_amount := new.amount; new.amount := 0;');
    expect(sql).toContain("('b4ce0810-2cac-44af-a83f-8bb1a361567a', date '2026-08-01'");
    expect(sql).toContain("('d3d25b49-0623-40eb-99ac-b96f6ac0855a', date '2026-08-20'");
  });

  it('refuses MISA material rows from the cut-over and duplicate rows', () => {
    expect(sql).toContain("message = 'misa_import_after_cutover'");
    expect(sql).toContain("message = 'misa_import_duplicate'");
  });

  it('keeps stock purchases at company scope and moves cost with inter-project transfers', () => {
    expect(sql).toContain("check (project_id is not null or construction_site_id is not null or coalesce(metadata->>'scope', '') = 'company')");
    expect(sql).toContain("'stock_transfer:' || new.id || ':in'");
    expect(sql).toContain("case v_purpose when 'stock' then 'proactive_stock' else 'proactive_project' end");
  });

  it('values transfers at the source weighted average and costs only goods received at the target', () => {
    expect(sql).toContain("v_price_source := case when v_avg is not null then 'weighted_average' else 'document' end;");
    expect(sql).toContain("le.transaction_type = 'transfer_issue' and le.source_code = p_source_code and le.material_id = p_material_id");
    expect(sql).toContain("and le.warehouse_id = new.target_warehouse_id;");
  });
});

describe('applyMisaImportGuards', () => {
  const row = (n: number, tx: Record<string, unknown>) => ({ rowNumber: n, selected: true, isTotal: false, status: 'valid' as const, rawCostItemInput: '', rawPartnerInput: '',
    tx: { id: `t${n}`, type: 'expense', category: 'materials', amount: 100, date: '2026-07-10', description: 'Mua hàng', invoiceNo: `MH${n}`, ...tx } as never });
  const preview = (items: ReturnType<typeof row>[]): ProjectTransactionImportPreviewResult => ({ items, totalRows: items.length, totalExpenseCount: 0, totalRevenueCount: 0, totalExpenseAmount: 0, totalRevenueAmount: 0, warningCount: 0 });

  it('blocks materials from the cut-over date but keeps other categories', () => {
    const r = applyMisaImportGuards(preview([row(1, { date: '2026-08-02' }), row(2, { date: '2026-08-02', category: 'overhead' }), row(3, {})]), { cutoverDate: '2026-08-01', existing: [] });
    expect(r.items.map(i => i.status)).toEqual(['blocked_after_cutover', 'valid', 'valid']);
    expect(r.items[0].selected).toBe(false);
  });

  it('blocks rows already imported and duplicates inside the file', () => {
    const existing = [{ source: 'import' as const, invoiceNo: 'MH1', amount: 100, date: '2026-07-10', description: 'Mua hàng' }];
    const r = applyMisaImportGuards(preview([row(1, {}), row(2, {}), row(9, { invoiceNo: 'MH2' })]), { cutoverDate: null, existing });
    expect(r.items.map(i => i.status)).toEqual(['blocked_duplicate', 'valid', 'blocked_duplicate']);
  });
});

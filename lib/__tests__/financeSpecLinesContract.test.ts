import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20261010181700_finance_spec_lines.sql');

// Chủ SP 10/10/2026: quy cách đi tiếp sang Tài chính — công nợ, chốt giá, phiếu nhập trực tiếp, bảng đối soát chờ ghi sổ.
describe('quy cách ở Tài chính — máy chủ', () => {
  it('dòng giá chứng từ công nợ và dòng chốt giá mang quy cách', () => {
    expect(migration).toContain("'specification', app_private.finance_price_line_spec(x.kind, x.line_id)");
    expect(migration).toContain('create trigger trg_snapshot_price_settlement_line_spec before insert on public.supplier_price_settlement_lines');
    expect(migration).toContain("'itemName', l.item_name, 'specification', l.specification");
  });

  it('bảng đối soát chờ ghi sổ trả danh sách dòng, phiếu nhập trực tiếp trả quy cách', () => {
    expect(migration).toContain("'lines', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'itemName', x.item_name_snapshot, 'specification', x.specification,");
    expect(migration).toContain("'specification', nullif(btrim(coalesce(x->>'specification', '')), '')");
  });
});

describe('quy cách ở Tài chính — giao diện', () => {
  it('chốt giá, phiếu nhập trực tiếp, bảng đối soát chờ ghi sổ hiện quy cách', () => {
    expect(read('components/finance/PriceSettlement.tsx').match(/\{l\.specification && /g)?.length).toBe(2);
    expect(read('components/finance/DirectReceiptsView.tsx')).toContain('{l.specification && ');
    const pending = read('components/finance/PendingStatementsView.tsx');
    expect(pending).toContain('Xem {s.lines!.length} dòng hàng');
    expect(pending).toContain('{l.specification && ');
  });
});

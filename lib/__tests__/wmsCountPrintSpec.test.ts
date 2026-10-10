import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { specCountTotal, specCountInvalid } from '../../components/wms/SpecCountRows';
import { lineSpecAllocations, specAllocationText } from '../wmsSpecStockService';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

// V4 kiểm kê theo quy cách + in quy cách trên phiếu xuất (doc 13 mục 9.4, 16.3).
describe('kiểm kê theo quy cách', () => {
  it('số đếm của mã = cộng các quy cách; còn quy cách chưa đếm = chưa xong', () => {
    expect(specCountTotal([{ specification: null, value: '110' }, { specification: 'A', value: '5' }, { specification: 'B', value: '2,5' }])).toBe('117,5');
    expect(specCountTotal([{ specification: null, value: '110' }, { specification: 'A', value: '' }])).toBe('');
    expect(specCountInvalid([{ specification: 'A', value: 'abc' }])).toBe(true);
  });
  it('máy chủ: chụp tồn từng quy cách, gộp số đếm, duyệt thì chuyển quy cách theo số đếm', () => {
    const m = read('supabase/migrations/20261010221700_wms_count_print_spec.sql');
    expect(m).toContain('create trigger trg_stock_count_line_specs before insert on public.wms_inventory_count_lines');
    expect(m).toContain('perform app_private.stock_count_apply_specs(v_c.id, v_actor);');
    expect(m).toContain("'specCounts', case when v_show then l.spec_counts else (select jsonb_agg(x - 'snapshotQty')");
  });
  it('màn kiểm kê dùng ô đếm theo quy cách', () => {
    expect(read('components/wms/StockCountView.tsx')).toContain('<SpecCountRows rows={specRows[l.id]}');
  });
});

describe('quy cách thực trên phiếu xuất', () => {
  const ledger = [
    { itemId: 'a', direction: 'out' as const, qty: 3, allocations: [{ specification: 'R7', qty: 3 }] },
    { itemId: 'a', direction: 'out' as const, qty: 5, allocations: [{ specification: null, qty: 2 }, { specification: '14+2', qty: 3 }] },
    { itemId: 'b', direction: 'out' as const, qty: 1, allocations: [{ specification: null, qty: 1 }] },
  ];
  it('ghép dòng sổ vào dòng phiếu theo mã và thứ tự', () => {
    const r = lineSpecAllocations(false, [{ itemId: 'a' }, { itemId: 'b' }, { itemId: 'a' }], ledger);
    expect(r[0]?.[0].specification).toBe('R7');
    expect(r[1]).toBeNull();
    expect(specAllocationText(r[2]!, n => String(n))).toBe('chưa ghi quy cách · 2; 14+2 · 3');
  });
  it('phiếu in và màn xem phiếu đọc quy cách thực từ sổ kho', () => {
    expect(read('pages/Operations.tsx')).toContain('${specLine(line, index)}');
    expect(read('components/TransactionDetailModal.tsx')).toContain('fetchTxSpecAllocations(transactionProp.id)');
  });
});

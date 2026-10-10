import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20261010173300_procurement_spec_through_documents.sql');

// Chủ SP 10/10/2026: phiếu tạo ghi gì thì phiếu duyệt, nhập kho, đối soát giữ nguyên — mã vẫn là khóa cộng tồn / BOQ.
describe('quy cách đi xuyên chứng từ — máy chủ', () => {
  it('chép tên + quy cách dòng đơn vào phiếu kho, phiếu giao nhận, bảng đối soát', () => {
    expect(migration).toContain('create trigger trg_snapshot_po_line_desc before insert or update of items on public.transactions');
    expect(migration).toContain('create trigger trg_snapshot_supplier_delivery_line_spec before insert on public.supplier_direct_delivery_lines');
    expect(migration).toContain('create trigger trg_snapshot_statement_line_spec before insert on public.supplier_delivery_statement_lines');
    // Chỉ thêm khi chưa có: ảnh chụp lúc tạo không bị ghi đè.
    expect(migration).toContain("not x.value ? 'itemNameSnapshot'");
  });

  it('giá HĐ khi đối soát theo đúng quy cách, không lấy giá quy cách khác', () => {
    expect(migration).toContain('app_private.procurement_contract_line_price(n.supplier_contract_id, l.item_id, l.specification, n.delivery_date)');
    expect(migration).toContain('app_private.procurement_contract_line_price(v_c.id, l.item_id, l.specification, n.delivery_date)');
    expect(migration).toContain("app_private.spec_key(l.specification) in ('', app_private.spec_key(p_spec))");
  });

  it('thẻ kho và chi tiết HĐ trả quy cách từng dòng, sử dụng cộng theo mã kèm từng quy cách', () => {
    expect(migration).toContain("'specification', nullif(btrim(coalesce(e.metadata->>'specification', '')), '')");
    expect(migration).toContain("'name', item_name, 'specification', spec, 'unit', unit,");
    expect(migration).toContain("'specs', coalesce(");
  });
});

describe('quy cách đi xuyên chứng từ — giao diện', () => {
  it('phiếu kho hiện tên + quy cách theo dòng đơn', () => {
    const modal = read('components/TransactionDetailModal.tsx');
    expect(modal).toContain("{ti.itemNameSnapshot || item?.name || 'Vật tư mới'}");
    expect(modal).toContain('{ti.specification && ');
  });

  it('đối chiếu đợt giao, đối soát HĐ, thẻ kho hiện quy cách', () => {
    expect(read('components/procurement/receipt/ReceiptReconciliationView.tsx')).toContain('{l.specification && ');
    const contracts = read('components/procurement/hub/ContractsView.tsx');
    expect(contracts).toContain('{r.line.specification && ');
    expect(contracts).toContain('specRows(u.specs)');
    // V1-3b: thẻ kho hiện phân bổ quy cách của dòng sổ (fallback quy cách trên chứng từ).
    expect(read('components/wms/WmsStockView.tsx')).toContain('fallback={c.specification}');
  });
});

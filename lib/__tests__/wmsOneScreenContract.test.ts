import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20261011090500_wms_v2_one_screen.sql');

// V2 Kho một màn (doc 13 mục 26–27; chủ SP duyệt câu 33–39).
describe('Kho một màn — máy chủ', () => {
  it('bỏ phiếu nhập tự do: chặn nhập từ đối tác / HĐ NCC không qua đợt giao', () => {
    expect(migration).toContain("message = 'WMS_FREE_IMPORT_REMOVED'");
    expect(migration).toContain("lower(coalesce(new.source_type, '')) in ('business_partner', 'supplier_contract')");
    expect(migration).toContain('create trigger trg_block_free_import before insert on public.transactions');
  });

  it('xuất cấp 1 bước: thủ kho kho xuất lập + ghi sổ ngay', () => {
    expect(migration).toContain("app_private.wms_has_action('wms.transaction.approve', p->>'sourceWarehouseId', p->>'sourceWarehouseId')");
    expect(migration).toContain("public.process_transaction_approval(v_order.transaction_id, 'COMPLETED'::public.transaction_status, v_actor, null, null)");
    expect(migration).toContain('grant execute on function public.issue_material_now_v1(jsonb) to authenticated');
  });

  it('chuyển kho mang quy cách dòng; duyệt số lẻ không ép integer', () => {
    expect(migration).toContain("jsonb_build_object('specification', btrim(v_line.value ->> 'specification'))");
    const status = migration.slice(migration.indexOf('FUNCTION public.process_transaction_status'));
    expect(status).toContain("v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);");
    expect(status).not.toContain("'quantity', '')::integer");
  });
});

describe('Kho một màn — giao diện', () => {
  const kho = read('components/wms/KhoView.tsx');
  const forms = read('components/wms/KhoForms.tsx');
  it('một màn: việc cần làm, tồn kho, sổ phiếu; thao tác mở ở cột phải', () => {
    expect(kho).toContain("seg('todo', 'Việc cần làm'");
    expect(kho).toContain("seg('stock', 'Tồn kho'");
    expect(kho).toContain("seg('book', 'Sổ phiếu'");
    expect(kho).toContain('<CountPanel');
    expect(kho).toContain('<TransactionDetailModal');
    expect(read('pages/Inventory.tsx')).toContain('<KhoView />');
  });

  it('xuất 1 bước, chuyển kho gửi ngay, người nhận chỉ chọn trong danh sách', () => {
    expect(forms).toContain('materialIssueService.issueNow(');
    expect(forms).toContain('wmsTransferService.dispatch(');
    expect(forms).toContain('nhờ Mua hàng thêm đối tác');
    expect(forms).not.toContain('recipientType: \'manual\'');
  });

  it('menu Vật tư 4 mục; không còn lối lập phiếu nhập tự do', () => {
    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar).toContain("{ to: '/inventory', icon: Package, label: 'Kho'");
    expect(sidebar).not.toContain("label: 'Phiếu kho'");
    expect(sidebar).not.toContain("{ to: '/audit', icon: ClipboardCheck, label: 'Kiểm kê' }");
    expect(read('pages/Operations.tsx')).not.toContain("handleTabChange('IMPORT')");
    expect(read('components/wms/WmsWorkspace.tsx')).not.toContain("kind: 'IMPORT', label: 'Phiếu nhập'");
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261016220000_procurement_capture_queue.sql', 'utf8');
const hub = readFileSync('components/procurement/hub/ProcurementHubView.tsx', 'utf8');
const view = readFileSync('components/procurement/hub/CaptureQueueView.tsx', 'utf8');

// Mua hàng · Phiếu giao chờ (chủ SP 16/10): NCC chưa có → Mua hàng tạo; không khớp đơn → Mua hàng lập đơn.
describe('Mua hàng nhận phiếu giao chờ', () => {
  it('2 việc: cần NCC, cần lập đơn (không có đơn mở của NCC về kho)', () => {
    expect(sql).toContain("case when c.supplier_id is null then 'supplier' else 'order' end queue");
    expect(sql).toContain('po.vendor_id = c.supplier_id and po.archived_at is null');
    expect(sql).toContain("app_private.procurement_can('view')");
  });

  it('tạo NCC: quyền Mua hàng quản trị / Đối tác, chặn trùng MST hoặc tên ≥ 0,9, mã NCC tăng dần', () => {
    expect(sql).toContain("app_private.procurement_can('manage')");
    expect(sql).toContain("array['contract.partner.manage']");
    expect(sql).toContain("message = 'PARTNER_DUPLICATE'");
    expect(sql).toContain('where x.score >= 0.9 limit 1');
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('business_partners_ncc_code'))");
    expect(sql).toContain("array['supplier']");
  });

  it('gắn NCC cho mọi phiếu cùng tên / MST và học tên', () => {
    expect(sql).toContain("app_private.capture_supplier_core(c.supplier_name) = v_core");
    expect(sql).toContain('insert into public.wms_supplier_aliases (alias_key, alias_text, partner_id, created_by)');
    expect(sql).toContain('|cua hang|ch|');
  });

  it('tab Phiếu giao chờ trong Mua hàng, Lập đơn điền sẵn NCC', () => {
    expect(hub).toContain("['captures', 'Phiếu giao chờ']");
    expect(hub).toContain('onCreateOrder={seed => setProactive({ order: null, seed })}');
    expect(view).toContain('Vẫn tạo NCC mới');
  });
});

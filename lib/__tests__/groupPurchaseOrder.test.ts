import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPoApprovalPrintHtml } from '../procurementApprovalPrint';

// Việc 2 — đơn gom nhiều dự án, phương án A: giao thẳng từng công trường.

describe('Đơn gom nhiều dự án', () => {
  it('mẫu in thêm bảng phân bổ theo dự án, cộng theo dự án gồm VAT', () => {
    const html = buildPoApprovalPrintHtml({
      poNumber: 'PO-560', orderDate: '2026-10-03', subject: 'DẦU DIEZEL', vendorName: 'Dầu Mỡ Quân Sen', projectLabel: 'Đơn gom: DA29, SMB-2026',
      warehouseName: null, expectedDeliveryDate: null, requesterName: 'Bùi Quang Chung', requesterPosition: '', vatRate: 10, note: null,
      lines: [{ sku: 'VTM019', name: 'Dầu Diezel', unit: 'Lít', qty: 1670, unitPrice: 21500 }], signers: [],
      allocations: [
        { project: 'DA29', warehouse: 'Kho Xin Hai Vina', item: 'Dầu Diezel', unit: 'Lít', qty: 400, amount: 8600000 },
        { project: 'SMB-2026', warehouse: 'Kho Sơn Miền Bắc', item: 'Dầu Diezel', unit: 'Lít', qty: 1270, amount: 27305000 },
      ],
    });
    expect(html).toContain('Phân bổ theo dự án');
    expect(html).toContain('Kho Xin Hai Vina');
    expect(html).toContain('9.460.000');
    expect(html).toContain('30.035.500');
  });

  it('migration giữ đúng luật đã duyệt', () => {
    const sql = readFileSync('supabase/migrations/20261008133500_procurement_group_po_multi_project.sql', 'utf8');
    expect(sql).toContain("v_group := v_scopes > 1");
    expect(sql).toContain("'PROCUREMENT_GROUP_SITE_REQUIRED'");
    expect(sql).toContain("allocation_mode text not null default 'earliest' check (allocation_mode in ('earliest', 'ratio'))");
    expect(sql).toContain("v_po.project_id := coalesce(v_batch.project_id, v_po.project_id)");
    expect(sql).toContain("v_req.project_id is distinct from v_project");
    expect(sql).toContain("message = 'PROCUREMENT_EXCESS_REASON_REQUIRED'");
    expect(sql).not.toContain("message = 'PROCUREMENT_PO_SCOPE_MIXED'; end if;\n  if v_warehouse is null then");
  });
});

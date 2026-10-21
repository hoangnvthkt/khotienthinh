import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

// V2 (doc 13 mục 9.4, 16.3): chọn quy cách tay khi xuất; trống = tự lấy quy cách nhập trước.
describe('chọn quy cách khi xuất — máy chủ', () => {
  const m = read('supabase/migrations/20261010211500_wms_issue_pick_spec.sql');
  it('dòng xuất cấp lưu quy cách và mang xuống phiếu kho', () => {
    expect(m).toContain('alter table public.material_issue_lines add column if not exists specification text');
    expect(m).toContain("subcontractor_contract_id, note, specification");
    expect(m).toContain("|| case when v_line.specification is not null then jsonb_build_object('specification', v_line.specification) else '{}'::jsonb end);");
  });
  it('xuất có quy cách lấy quy cách đó trước, thiếu thì theo nhập trước; hàng trả lại về đúng quy cách đã xuất', () => {
    expect(m).toContain("order by (v_spec is not null and b.spec_key = app_private.spec_key(v_spec)) desc, b.first_in nulls last");
    expect(m).toContain("e.metadata->>'materialIssueLineId' = v_issue_line");
  });
});

describe('chọn quy cách khi xuất — giao diện', () => {
  it('Xuất cấp thi công: chọn quy cách từng dòng, tách được nhiều quy cách', () => {
    const p = read('components/project/MaterialIssuePanel.tsx');
    expect(p).toContain('<IssueSpecSelect');
    expect(p).toContain('+ Xuất thêm quy cách khác');
    expect(p).toContain('specification: line.specification || null');
  });
  it('Xuất hủy: chọn quy cách từng mã', () => {
    const o = read('pages/Operations.tsx');
    expect(o).toContain('activeTab === TransactionType.LIQUIDATION ? selectedWarehouseId : null');
    expect(o).toContain('onChange={value => setTxItemSpec(item.itemId, value)}');
  });
});

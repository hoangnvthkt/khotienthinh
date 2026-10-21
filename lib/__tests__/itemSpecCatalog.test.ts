import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchItemSpec, specSizeConflict } from '../itemSpecService';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

// Danh sách quy cách chuẩn của từng mã (doc 13 mục 9.3, 16.3).
describe('khớp quy cách theo danh sách chuẩn', () => {
  const options = [
    { id: 'a', name: 'Hòa Phát CB300', status: 'active' as const, aliases: ['HP CB 300 cũ'] },
    { id: 'b', name: 'M350CV, R7', status: 'pending' as const, aliases: [] },
  ];
  it('gõ khác cách viết vẫn ra đúng tên (bỏ dấu, dấu cách, dấu câu)', () => {
    expect(matchItemSpec(options, 'hoa phat cb 300')?.id).toBe('a');
    expect(matchItemSpec(options, 'm350 cv r7')?.id).toBe('b');
    expect(matchItemSpec(options, 'hp cb300 cu')?.id).toBe('a');
    expect(matchItemSpec(options, 'Việt Nhật CB300')).toBeNull();
    expect(matchItemSpec(options, '  ')).toBeNull();
  });
  it('cảnh báo quy cách khác kích thước với tên mã (có thể là vật tư khác)', () => {
    expect(specSizeConflict('Thép XD D8', 'D10')).toMatch(/D8.*D10/);
    expect(specSizeConflict('Bulong móng M24x650', 'M20')).toMatch(/M24.*M20/);
    expect(specSizeConflict('Thép XD D8', 'Hòa Phát CB240')).toBeNull();
    expect(specSizeConflict('Tôn 0.45mm', 'Tôn 0,45 ly')).toBeNull();
    expect(specSizeConflict('Tôn 0.45mm', '0.5mm')).toMatch(/0\.45mm/);
  });
});

describe('danh sách quy cách — nối dây', () => {
  it('máy chủ: danh sách, tự ghi quy cách mới từ chứng từ, rà bởi người Cấp mã', () => {
    const m = read('supabase/migrations/20261010201300_item_spec_catalog.sql');
    expect(m).toContain('create table if not exists public.item_specs');
    expect(m).toContain('create trigger trg_item_spec_from_po after insert or update of items on public.purchase_orders');
    expect(m).toContain("if not app_private.wms_can_issue_code() then raise exception using errcode = '42501', message = 'CATALOG_ISSUE_DENIED'");
    expect(m).toContain("message = 'ITEM_SPEC_HAS_STOCK'");
  });
  it('mọi ô quy cách trên chứng từ dùng ô chung có gợi ý', () => {
    for (const f of ['components/procurement/hub/OrderEditor.tsx', 'components/procurement/hub/ProactiveOrderEditor.tsx',
      'components/procurement/hub/ContractOrderEditor.tsx', 'components/procurement/hub/ContractsView.tsx',
      'components/material/MaterialCommercialDescriptionFields.tsx', 'components/wms/SpecStockSection.tsx']) {
      expect(read(f), f).toContain('<SpecInput');
    }
    const catalog = read('components/wms/CatalogView.tsx');
    expect(catalog).toContain("label: 'Quy cách chờ rà'");
    expect(catalog).toContain('<ItemSpecsSection itemId={it.id}');
  });
});

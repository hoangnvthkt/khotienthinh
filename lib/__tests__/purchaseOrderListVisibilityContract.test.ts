import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'pages/project/SupplyChainTab.tsx'), 'utf8');

describe('purchase order list visibility contract', () => {
  it('does not hide existing PO rows when WMS catalog data is unavailable', () => {
    const poTabStart = source.indexOf("{/* PO Tab */}");
    expect(poTabStart).toBeGreaterThan(-1);

    const poTabSection = source.slice(poTabStart, source.indexOf('{selectedPo &&', poTabStart));
    const missingCatalogIndex = poTabSection.indexOf('title="Thiếu danh mục vật tư hoặc kho nhận"');
    const emptyPoIndex = poTabSection.indexOf('pos.length === 0');

    expect(missingCatalogIndex).toBeGreaterThan(-1);
    expect(emptyPoIndex).toBeGreaterThan(-1);
    expect(emptyPoIndex).toBeLessThan(missingCatalogIndex);
    expect(poTabSection).not.toContain('partners.length > 0 && inventoryItems.length > 0 && warehouses.length > 0 && pos.length > 0');
  });
});

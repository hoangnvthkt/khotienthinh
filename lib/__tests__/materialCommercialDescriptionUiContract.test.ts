import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const requestModal = readFileSync(join(process.cwd(), 'components/RequestModal.tsx'), 'utf8');
const supplyChainTab = readFileSync(join(process.cwd(), 'pages/project/SupplyChainTab.tsx'), 'utf8');

describe('material commercial description UI wiring', () => {
  it('uses line identity and editable snapshots in the MR form', () => {
    expect(requestModal).toContain('getMaterialDocumentLineKey(row, index)');
    expect(requestModal).toContain('<MaterialCommercialDescriptionFields');
    expect(requestModal).toContain("handleUpdateItem(primary.index, 'itemNameSnapshot'");
    expect(requestModal).toContain("handleUpdateItem(primary.index, 'specification'");
    expect(requestModal).not.toContain("? `sku:${sku.toLowerCase()}`");
  });

  it('allows the same catalog item to be added to an MR more than once', () => {
    expect(requestModal).not.toContain('!isProjectRequest && reqItems.some(i => i.itemId === item.id)');
  });

  it('prints the line specification with the snapshot name', () => {
    expect(requestModal).toContain("line.specification ? `<div class=\"line-spec\">Quy cách:");
    expect(requestModal).toContain("requestLine?.specification ? `<div class=\"line-spec\">Quy cách:");
  });
});

describe('purchase order commercial description UI wiring', () => {
  it('edits the PO snapshot and specification independently from the catalog', () => {
    expect(supplyChainTab).toContain('<MaterialCommercialDescriptionFields');
    expect(supplyChainTab).toContain("updatePoItem(i, { name: value, itemNameSnapshot: value })");
    expect(supplyChainTab).toContain("updatePoItem(i, { specification: value })");
  });

  it('prints snapshot names and free-form specifications', () => {
    expect(supplyChainTab).toContain('resolveMaterialLineName(item)');
    expect(supplyChainTab).toContain('item.specification ? `<div class="line-specification">');
  });
});

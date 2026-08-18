import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const requestModal = readFileSync(join(process.cwd(), 'components/RequestModal.tsx'), 'utf8');

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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'pages/project/SupplyChainTab.tsx'), 'utf8');

describe('material PO commercial-lines UI contract', () => {
  it('delegates normalized save-line validation to the commercial-line validator', () => {
    expect(source).toContain("from '../../lib/purchaseOrderCommercialLines'");
    expect(source).toContain('findPurchaseOrderCommercialLineIssue({');
    expect(source).toContain('sourceMode: pSourceMode');
    expect(source).not.toContain('const duplicatedSku = validItems.find');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'pages/project/SupplyChainTab.tsx'), 'utf8');

describe('direct-purchase lifecycle UI contract', () => {
  it('uses understandable supplier-payable actions and a whole-document rejection', () => {
    expect(source).toContain('Xác nhận công nợ nhà cung cấp');
    expect(source).toContain('Bỏ xác nhận công nợ');
    expect(source).toContain('Từ chối phiếu');
    expect(source).toContain('siteDirectPurchaseService.recordPayable');
    expect(source).toContain('siteDirectPurchaseService.unrecordPayable');
    expect(source).toContain('siteDirectPurchaseService.rejectDocument');
  });

  it('does not render direct-purchase AP jargon or line-level rejection controls', () => {
    expect(source).not.toContain('Ghi AP</button>');
    expect(source).not.toContain('reviewDirectPurchaseLine');
  });

  it('only makes never-submitted drafts eligible for deletion in the UI', () => {
    expect(source).toMatch(/purchase\.status === 'draft'[\s\S]{0,160}!purchase\.everSubmitted/);
  });
});

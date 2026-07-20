import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const supplyChainTabPath = path.resolve(process.cwd(), 'pages/project/SupplyChainTab.tsx');

describe('Purchase Order revision workflow', () => {
  it('returns a sent PO instead of silently reopening it as draft', () => {
    const source = fs.readFileSync(supplyChainTabPath, 'utf8');

    expect(source).toMatch(/case 'request_revision':[\s\S]*?updatePoStatus\(po\.id, 'returned'\)/);
    expect(source).not.toMatch(/case 'request_revision':[\s\S]*?updatePoStatus\(po\.id, 'draft'\)/);
    expect(source).toMatch(/status === 'returned' && po\.status === 'sent'[\s\S]*?ensureCanApprovePo\('yêu cầu chỉnh sửa PO'\)/);
    expect(source).toMatch(/if \(status === 'returned' && po\.status !== 'sent'\)/);
  });
});

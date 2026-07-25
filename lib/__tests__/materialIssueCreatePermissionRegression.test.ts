import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const service = readFileSync(join(process.cwd(), 'lib/materialIssueService.ts'), 'utf8');
const panel = readFileSync(join(process.cwd(), 'components/project/MaterialIssuePanel.tsx'), 'utf8');

describe('material issue create permission regression', () => {
  it('passes recipient source through the create RPC without a direct table update', () => {
    expect(service).toContain('p_recipient_source_type: input.recipientSourceType || null');
    expect(service).toContain('p_recipient_source_id: input.recipientSourceId || null');
    expect(service).not.toMatch(/\.from\(ORDER_TABLE\)[\s\S]{0,300}\.update\(\{[\s\S]{0,200}recipient_source_type/);
  });

  it('expands a successful order and refreshes orders after an error', () => {
    expect(panel).toContain('setExpandedOrderIds(prev => new Set([...prev, created.id]))');
    const errorLogIndex = panel.indexOf("logApiError('materialIssueService.createAndSubmit'");
    const catchBlock = panel.slice(errorLogIndex, panel.indexOf('} finally {', errorLogIndex));
    expect(catchBlock).toContain('void loadOrders()');
  });
});

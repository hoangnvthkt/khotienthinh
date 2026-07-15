import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(process.cwd(), 'pages/Audit.tsx'), 'utf8');

describe('inventory audit page atomic mutation boundary', () => {
  it('uses localized text drafts and one server-side audit command', () => {
    expect(source).toContain('<LocalizedNumberInput');
    expect(source).toContain('inventoryAuditService.post');
    expect(source).toContain('getOrCreateInventoryAuditCommand');
    expect(source).toContain('clearInventoryAuditCommandId');
    expect(source).not.toContain('type="number"');
    expect(source).not.toContain('parseInt(');
  });

  it('does not persist an audit session and WMS transaction in separate browser calls', () => {
    expect(source).not.toContain('addAuditSession(');
    expect(source).not.toContain('addTransaction(');
    expect(source).not.toContain('TransactionType.ADJUSTMENT');
  });

  it('separates authoritative success from best-effort postcommit refresh', () => {
    const rpc = source.indexOf('await inventoryAuditService.post');
    const clear = source.lastIndexOf('clearInventoryAuditCommandId');
    expect(rpc).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(rpc);
    expect(source).toContain('audit.postCommitRefresh');
    expect(source).toContain('Dữ liệu kiểm kê đã được ghi nhận an toàn');
  });
});

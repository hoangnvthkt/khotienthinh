import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'components', 'project', 'ProjectOpeningBalanceModal.tsx'),
  'utf8',
);

describe('ProjectOpeningBalanceModal atomic lock boundary', () => {
  it('persists one retry-safe command id until the server confirms success', () => {
    expect(source).toContain('getOrCreateProjectOpeningBalanceCommandId');
    expect(source).toContain('clearProjectOpeningBalanceCommandId');
    expect(source).toMatch(/lockOpeningBalance\s*\(\s*\{[\s\S]*?commandId[\s\S]*?openingBalance/);

    const rpcAwait = source.indexOf('await projectOpeningBalanceService.lockOpeningBalance');
    const clearConfirmedCommand = source.lastIndexOf('clearProjectOpeningBalanceCommandId');
    expect(rpcAwait).toBeGreaterThan(-1);
    expect(clearConfirmedCommand).toBeGreaterThan(rpcAwait);
    expect(source).toContain('ProjectOpeningBalanceModal.postCommitRefresh');
    expect(source).toContain('Dữ liệu đã được khóa an toàn');
    expect(source).toContain('result.warnings');
  });

  it('does not persist finance or material transactions again after the atomic RPC', () => {
    expect(source).not.toMatch(/await\s+(?:update|add)ProjectFinance\s*\(/);
    expect(source).not.toMatch(/await\s+addProjectTransaction\s*\(/);
  });

  it('uses the shared locale input contract and keeps line cells as draft text', () => {
    expect(source).toContain('LocalizedNumberInput');
    expect(source).toContain('LocalizedMoneyInput');
    expect(source).toContain('value={line[key]}');
    expect(source).toMatch(/onDraftChange=\{\(draft\)[\s\S]*?\[key\]: draft/);
    expect(source).not.toContain('parseVietnameseNumber');
    expect(source).not.toContain('parseVietnameseMoney');
    expect(source).not.toContain('formatVietnameseNumber');
    expect(source).not.toContain('formatVietnameseMoney');
    expect(source).not.toContain('.toLocaleString(');
  });

  it('strictly parses every business draft before building the atomic command', () => {
    expect(source).toContain('inspectLocalizedNumberDraft');
    expect(source).toContain('QUANTITY_POLICY');
    expect(source).toContain('UNIT_PRICE_POLICY');
    expect(source).toContain('PERCENT_POLICY');
    expect(source).toContain('VND_TOTAL_POLICY');
    expect(source).toMatch(/maxFractionDigits:\s*6/);
    expect(source).toMatch(/maxFractionDigits:\s*2/);
    expect(source).toMatch(/max:\s*100/);

    const preparation = source.indexOf('prepareLockInput');
    const rpcAwait = source.indexOf('await projectOpeningBalanceService.lockOpeningBalance');
    expect(preparation).toBeGreaterThan(-1);
    expect(rpcAwait).toBeGreaterThan(preparation);
    expect(source).toMatch(/prepared\.lines/);
    expect(source).toMatch(/prepared\.contractValue/);
  });
});

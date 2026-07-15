import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(join(process.cwd(), ...relativePath.split('/')), 'utf8');

const extractBetween = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Unable to extract source between ${start} and ${end}`);
  }
  return source.slice(startIndex, endIndex);
};

describe('WMS posting path containment', () => {
  it('routes every immediate completed transaction through the posting RPC, including adjustments', () => {
    const source = readSource('context/AppContext.tsx');
    const addTransaction = extractBetween(
      source,
      'const addTransaction = async',
      'const syncFulfillmentBatchFromCompletedTransaction',
    );

    expect(addTransaction).toMatch(
      /const shouldProcessCompletedViaRpc = isImmediateCompleted\s*;/,
    );
    expect(addTransaction).not.toMatch(
      /shouldProcessCompletedViaRpc[^;]*TransactionType\.ADJUSTMENT/,
    );
    expect(addTransaction).not.toMatch(/applyStockChange\s*\(/);
    expect(addTransaction).toMatch(
      /supabase\.rpc\('post_wms_transaction',[\s\S]*p_transaction:\s*tx/,
    );
    expect(addTransaction).not.toMatch(/shouldProcessCompletedViaRpc[\s\S]+syncToSupabase\('transactions', initialTx\)/);
  });

  it('keeps the offline stock projection local and never persists item stock from the client', () => {
    const source = readSource('context/AppContext.tsx');

    expect(source).not.toMatch(/const applyStockChange\s*=/);

    const localProjection = extractBetween(
      source,
      'const applyLocalStockProjection =',
      'const addTransaction = async',
    );
    expect(localProjection).not.toMatch(/syncToSupabase\s*\(\s*['"]items['"]/);

    const itemSyncPayload = extractBetween(
      source,
      "if (table === 'items')",
      "} else if (table === 'transactions')",
    );
    expect(itemSyncPayload).not.toContain('stock_by_warehouse');
  });
});

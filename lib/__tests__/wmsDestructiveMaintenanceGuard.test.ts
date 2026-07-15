import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const functionBlock = (source: string, name: string, nextName: string): string => {
  const start = source.indexOf(`const ${name}`);
  const end = source.indexOf(`const ${nextName}`, start + 1);
  if (start < 0 || end < 0) throw new Error(`Missing ${name}`);
  return source.slice(start, end);
};

const historyMigration = (): string => {
  const directory = join(process.cwd(), 'supabase', 'migrations');
  const file = readdirSync(directory)
    .filter(name => name > '20260715140000_atomic_inventory_audit.sql' && name.endsWith('.sql'))
    .sort()
    .find(name => /guard_inventory_item_history_delete/i.test(readFileSync(join(directory, name), 'utf8')));
  if (!file) throw new Error('Missing forward WMS history hardening migration');
  return readFileSync(join(directory, file), 'utf8');
};

describe('WMS destructive maintenance stop-loss', () => {
  it('never issues browser-side bulk deletes for transaction history or all data', () => {
    const source = read('context/AppContext.tsx');
    const history = functionBlock(source, 'clearTransactionHistory', 'clearAllData');
    const allData = functionBlock(source, 'clearAllData', 'addWarehouse');

    expect(history).toContain('WMS destructive maintenance is disabled');
    expect(allData).toContain('WMS destructive maintenance is disabled');
    expect(history).not.toMatch(/supabase\.from\(['"]transactions['"]\)\.delete/);
    expect(allData).not.toMatch(/supabase\.from\(.+\)\.delete/);
    expect(allData).not.toContain('Promise.all([');
  });

  it('renders the destructive settings action disabled and explains the correction path', () => {
    const source = read('pages/settings/SettingsMaintenance.tsx');

    expect(source).toContain('disabled');
    expect(source).toContain('Đã khóa để bảo toàn ledger');
    expect(source).not.toContain('await clearAllData()');
  });

  it('blocks deleting an item with ledger or completed WMS history and protects truncation', () => {
    const sql = historyMigration();

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+app_private\.guard_inventory_item_history_delete/i);
    expect(sql).toMatch(/from\s+public\.inventory_ledger_entries[\s\S]+material_id/i);
    expect(sql).toMatch(/from\s+public\.transactions[\s\S]+status[\s\S]+COMPLETED/i);
    expect(sql).toMatch(/jsonb_array_elements[\s\S]+itemId/i);
    expect(sql).toMatch(/before\s+delete\s+on\s+public\.items/i);
    expect(sql).toMatch(/revoke\s+truncate\s+on\s+table[\s\S]+public\.transactions[\s\S]+public\.items[\s\S]+public\.inventory_ledger_entries[\s\S]+authenticated/i);
  });
});

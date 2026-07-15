import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = () => {
  const files = require('node:fs').readdirSync(join(process.cwd(), 'supabase', 'migrations')) as string[];
  const file = files.find((name) => name === '20260715170000_wms_posting_lock_hardening.sql');
  if (!file) throw new Error('A3.3 migration missing');
  return readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8');
};
const executableSql = () => migration().replace(/--[^\n]*/g, '');
const smoke = () => readFileSync(join(process.cwd(), 'supabase', 'tests', 'wms_posting_lock_hardening_smoke.sql'), 'utf8');

describe('A3.3 posting lock hardening migration contract', () => {
  it('defines canonical business-to-transaction-to-item lock helpers and fail-closed identity checks', () => {
    const sql = executableSql();
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+app_private\.wms_business_lock_key/i);
    expect(sql).toMatch(/pg_advisory_xact_lock[\s\S]+wms_business_lock_key/i);
    expect(sql).toMatch(/order\s+by[\s\S]+item_id/i);
    expect(sql).toMatch(/stale|ambiguous/i);
    expect(sql).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.create_purchase_order_supplier_return[\s\S]+app_private\.lock_wms_business_transaction_items/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.process_transaction_status[\s\S]+app_private\.lock_wms_business_transaction_items/i);
    const completion = sql.slice(sql.indexOf('create or replace function public.process_transaction_status'));
    expect(completion.indexOf('for update')).toBe(-1);
    expect(completion).toMatch(/purchase_order_supplier_returns[\s\S]+purchase-order:/i);
  });

  it('replaces supplier-return and completion paths without exposing bypass helpers', () => {
    const sql = migration();
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.create_purchase_order_supplier_return/i);
    expect(sql).toMatch(/v_match_count[\s\S]+if\s+v_match_count\s*<>\s*1[\s\S]+stale\s+or\s+ambiguous/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.process_transaction_status/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+app_private\./i);
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+app_private\./i);
  });

  it('ships rollback-only persona and catalog smoke evidence', () => {
    const sql = smoke();
    expect(sql).toMatch(/begin\s*;/i);
    expect(sql).toMatch(/rollback\s*;/i);
    expect(sql).toMatch(/has_function_privilege\s*\(\s*'anon'/i);
    expect(sql).toMatch(/has_function_privilege\s*\(\s*'authenticated'/i);
    expect(sql).toMatch(/prosecdef|proconfig|proacl/i);
    expect(sql).toMatch(/pg_trigger/i);
  });
});

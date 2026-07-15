import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface MigrationSource {
  file: string;
  sql: string;
}

const migrations = (): MigrationSource[] => {
  const directory = join(process.cwd(), 'supabase', 'migrations');
  return readdirSync(directory)
    .filter(file => file.endsWith('.sql'))
    .sort()
    .map(file => ({ file, sql: readFileSync(join(directory, file), 'utf8') }));
};

const atomicMigration = (): MigrationSource => {
  const migration = migrations().find(({ sql }) =>
    /create\s+or\s+replace\s+function\s+public\.lock_project_opening_balance\s*\(/i.test(sql));
  if (!migration) throw new Error('No atomic project opening-balance migration found');
  return migration;
};

const functionDefinition = (sql: string, qualifiedName: string): string => {
  const escaped = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`create\\s+or\\s+replace\\s+function\\s+${escaped}\\s*\\(`, 'i').exec(sql);
  if (!match || match.index === undefined) throw new Error(`Missing ${qualifiedName}`);
  const remainder = sql.slice(match.index);
  const bodyTag = /\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/i.exec(remainder);
  if (!bodyTag || bodyTag.index === undefined) throw new Error(`Missing body tag for ${qualifiedName}`);
  const bodyStart = bodyTag.index + bodyTag[0].length;
  const bodyEnd = remainder.indexOf(`${bodyTag[1]};`, bodyStart);
  if (bodyEnd === -1) throw new Error(`Unterminated ${qualifiedName}`);
  return remainder.slice(0, bodyEnd + bodyTag[1].length + 1);
};

const artifact = (relativePath: string): string => {
  const path = join(process.cwd(), ...relativePath.split('/'));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

describe('atomic project opening-balance migration contract', () => {
  it('adds command metadata, rejects normalized duplicate locks, and restores one locked scope', () => {
    const { sql } = atomicMigration();
    const preflightIndex = sql.search(/duplicate[\s_-]+locked[\s_-]+scope/i);
    const uniqueIndex = sql.search(/create\s+unique\s+index[\s\S]+project_opening_balances/i);

    expect(sql).toMatch(/alter\s+table\s+public\.project_opening_balances[\s\S]+lock_command_id\s+uuid/i);
    expect(sql).toMatch(/lock_request_hash\s+text/i);
    expect(sql).toMatch(/project_finance_id\s+text/i);
    expect(sql).toMatch(/posting_engine_version\s+text/i);
    expect(sql).toMatch(/group\s+by[\s\S]+normalize_project_opening_scope_key/i);
    expect(sql).toMatch(/having\s+count\s*\(\s*\*\s*\)\s*>\s*1/i);
    expect(preflightIndex).toBeGreaterThan(-1);
    expect(uniqueIndex).toBeGreaterThan(preflightIndex);
    expect(sql).toMatch(/create\s+unique\s+index[\s\S]+normalize_project_opening_scope_key\s*\(\s*scope_key\s*\)[\s\S]+where\s+status\s*=\s*'locked'/i);
  });

  it('exposes one authenticated security-definer command with server-derived active actor and scoped authorization', () => {
    const { sql } = atomicMigration();
    const command = functionDefinition(sql, 'public.lock_project_opening_balance');

    expect(command).toMatch(/p_command\s+jsonb/i);
    expect(command).toMatch(/returns\s+jsonb/i);
    expect(command).toMatch(/security\s+definer/i);
    expect(command).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(command).toContain('public.current_app_user_id()');
    expect(command).toMatch(/public\.users[\s\S]+is_active/i);
    expect(command).toContain("'project.budget.manage'");
    expect(command).toContain('app_private.project_has_permission_v2');
    expect(command).toContain("'wms.transaction.complete'");
    expect(command).toContain('app_private.wms_has_action');
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.lock_project_opening_balance\s*\(\s*jsonb\s*\)\s+from\s+public\s*,\s*anon/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.lock_project_opening_balance\s*\(\s*jsonb\s*\)\s+to\s+authenticated/i);
  });

  it('serializes normalized scope commands and rejects conflicting command hashes', () => {
    const { sql } = atomicMigration();
    const command = functionDefinition(sql, 'public.lock_project_opening_balance');

    expect(command).toContain('app_private.normalize_project_opening_scope_key');
    expect(command).toMatch(/pg_advisory_xact_lock/i);
    expect(command).toMatch(/hashtextextended\s*\([\s\S]+scope/i);
    expect(command).toMatch(/p_command\s*->>\s*'commandId'/i);
    expect(command).toContain('app_private.sha256_text');
    expect(command).toMatch(/lock_command_id[\s\S]+lock_request_hash/i);
    expect(command).toMatch(/reused with different content/i);
    expect(command).toContain('app_private.project_opening_balance_result');
    expect(command).toMatch(/set_config\s*\(\s*'lock_timeout'\s*,\s*'5s'\s*,\s*true\s*\)/i);
  });

  it('persists an immutable command-result snapshot and returns it on exact replay', () => {
    const { sql } = atomicMigration();
    const command = functionDefinition(sql, 'public.lock_project_opening_balance');

    expect(sql).toMatch(/create\s+table\s+app_private\.project_opening_command_results/i);
    expect(sql).toMatch(/command_id\s+uuid\s+primary\s+key/i);
    expect(sql).toMatch(/request_hash\s+text[\s\S]+result\s+jsonb/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+app_private\.project_opening_command_results[\s\S]+service_role/i);
    expect(command).toMatch(/from\s+app_private\.project_opening_command_results/i);
    expect(command).toMatch(/insert\s+into\s+app_private\.project_opening_command_results/i);
    expect(command).toMatch(/return\s+v_saved_result/i);
  });

  it('rechecks the retry actor and every current warehouse permission before returning an idempotent result', () => {
    const { sql } = atomicMigration();
    const command = functionDefinition(sql, 'public.lock_project_opening_balance');
    const warehousePermission = command.indexOf('app_private.wms_has_action');
    const retryLookup = command.search(/where\s+opening\.lock_command_id\s*=\s*v_command_id/i);

    expect(warehousePermission).toBeGreaterThan(-1);
    expect(retryLookup).toBeGreaterThan(warehousePermission);
    expect(command).toMatch(/v_command_balance\.locked_by\s+is\s+distinct\s+from\s+v_actor::text/i);
    expect(command).toMatch(/cross-actor[\s_-]+retry|command actor/i);
    expect(command).toMatch(/from\s+public\.warehouses[\s\S]+order\s+by[\s\S]+for\s+update/i);
  });

  it('resolves catalog items exactly, validates A2 units and precision, and locks item rows in id order', () => {
    const { sql } = atomicMigration();
    const command = functionDefinition(sql, 'public.lock_project_opening_balance');

    expect(command).toMatch(/inventoryItemId/i);
    expect(command).toMatch(/from\s+public\.items[\s\S]+where[\s\S]+id\s*=/i);
    expect(command).toMatch(/lower\s*\([\s\S]+sku/i);
    expect(command).toMatch(/accounting_code/i);
    expect(command).toMatch(/btrim\s*\(\s*item\.accounting_code\s*\)\s*=\s*(?:pg_catalog\.)?btrim\s*\(\s*v_accounting_code\s*\)/i);
    expect(command).toMatch(/ambiguous[\s\S]+sku/i);
    expect(command).toMatch(/ambiguous[\s\S]+accounting/i);
    expect(command).toContain('app_private.quantity_units_are_equivalent');
    expect(command).toContain('app_private.assert_quantity_precision');
    expect(command).toContain('app_private.normalize_quantity_unit');
    expect(command).toMatch(/from\s+public\.warehouses/i);
    expect(command).toMatch(/stock_by_warehouse[\s\S]+'\{\}'::jsonb/i);
    expect(command).toMatch(/opening-item:/i);
    expect(command).toMatch(/select\s+distinct[\s\S]+itemId[\s\S]+order\s+by[\s\S]+item/i);
    expect(command).toMatch(/from\s+public\.items[\s\S]+for\s+update/i);
    expect(command).toMatch(/resolutionKind[\s\S]+resolved opening item no longer agrees with/i);
    expect(command).toMatch(/lock\s+table\s+public\.items\s+in\s+share\s+row\s+exclusive\s+mode/i);
    expect(command).toMatch(/project-opening-accounting:/i);
    expect(command).toMatch(/SKU and accounting code resolve to different items/i);
  });

  it('shares WMS source/transaction serialization and hashes the exact A3 transaction intent', () => {
    const { sql } = atomicMigration();
    const command = functionDefinition(sql, 'public.lock_project_opening_balance');
    const sourceLock = command.indexOf('wms-source:');
    const transactionLock = command.indexOf('wms-transaction:');
    const itemRowLock = command.search(/from\s+public\.items\s+item[\s\S]+for\s+update/i);

    expect(sourceLock).toBeGreaterThan(-1);
    expect(transactionLock).toBeGreaterThan(sourceLock);
    expect(itemRowLock).toBeGreaterThan(transactionLock);
    expect(command).toContain('app_private.wms_transaction_intent');
    expect(command).toMatch(/posting_request_hash[\s\S]+v_transaction_hash/i);
  });

  it('persists all documents and posts positive warehouses in deterministic order inside the outer transaction', () => {
    const { sql } = atomicMigration();
    const command = functionDefinition(sql, 'public.lock_project_opening_balance');

    expect(command).toMatch(/insert\s+into\s+public\.project_opening_balances|update\s+public\.project_opening_balances/i);
    expect(command).toMatch(/insert\s+into\s+public\.project_opening_balance_lines/i);
    expect(command).toMatch(/insert\s+into\s+public\.project_finances/i);
    expect(command).toMatch(/insert\s+into\s+public\.project_transactions/i);
    expect(command).toMatch(/insert\s+into\s+public\.transactions/i);
    expect(command).toContain('public.process_transaction_status');
    expect(command).toMatch(/remainingQty[\s\S]+>\s*0/i);
    expect(command).toMatch(/warehouseId[\s\S]+order\s+by[\s\S]+warehouse/i);
    expect(command).toContain("'project_opening_balance'");
    expect(command).toMatch(/posting_engine_version/i);
    expect(command).not.toMatch(/update\s+public\.items\s+set\s+stock_by_warehouse/i);
    for (const key of [
      'opening_balance',
      'lines',
      'project_finance',
      'material_project_transaction',
      'stock_transactions',
      'created_items',
      'updated_items',
    ]) {
      expect(command).toContain(`'${key}'`);
    }
  });

  it('authorizes draft locking with a one-use exact row image and keeps locked/void history immutable', () => {
    const { sql } = atomicMigration();
    const balanceGuard = functionDefinition(sql, 'app_private.guard_locked_project_opening_balance');
    const lineGuard = functionDefinition(sql, 'app_private.guard_locked_project_opening_balance_line');

    expect(sql).toMatch(/create\s+unlogged\s+table\s+app_private\.project_opening_write_authorizations/i);
    expect(sql).toMatch(/backend_pid[\s\S]+transaction_xid[\s\S]+expected_before[\s\S]+expected_after/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+app_private\.authorize_project_opening_write/i);
    expect(balanceGuard).toMatch(/pg_backend_pid\s*\(\s*\)/i);
    expect(balanceGuard).toMatch(/txid_current\s*\(\s*\)/i);
    expect(balanceGuard).toMatch(/expected_before\s*=\s*(?:pg_catalog\.)?to_jsonb\s*\(\s*old\s*\)/i);
    expect(balanceGuard).toMatch(/expected_after\s*=\s*(?:pg_catalog\.)?to_jsonb\s*\(\s*new\s*\)/i);
    expect(balanceGuard).toMatch(/old\.status\s+in\s*\(\s*'locked'\s*,\s*'void'\s*\)/i);
    expect(balanceGuard).toMatch(/new\.status\s*=\s*'locked'/i);
    expect(balanceGuard).toMatch(/direct[\s\S]+lock[\s\S]+forbidden/i);
    expect(balanceGuard).toMatch(/locked opening balance content is immutable/i);
    expect(lineGuard).toMatch(/from\s+public\.project_opening_balances/i);
    expect(lineGuard).toMatch(/status\s+in\s*\(\s*'locked'\s*,\s*'void'\s*\)/i);
    expect(lineGuard).toMatch(/order\s+by\s+opening\.id[\s\S]+for\s+update/i);
    expect(lineGuard).toMatch(/locked opening balance lines are immutable/i);
    expect(sql).toMatch(/before\s+insert\s+or\s+update\s+or\s+delete\s+on\s+public\.project_opening_balances/i);
    expect(sql).toMatch(/before\s+insert\s+or\s+update\s+or\s+delete\s+on\s+public\.project_opening_balance_lines/i);
    expect(sql).toMatch(/enable\s+always\s+trigger\s+trg_guard_locked_project_opening_balance\b/i);
    expect(sql).toMatch(/enable\s+always\s+trigger\s+trg_guard_locked_project_opening_balance_line\b/i);
    expect(sql).toMatch(/revoke\s+truncate\s+on\s+table\s+public\.project_opening_balances[\s\S]+service_role/i);
    expect(sql).toMatch(/revoke\s+truncate\s+on\s+table\s+public\.project_opening_balance_lines[\s\S]+service_role/i);
  });

  it('rejects a stale supplied finance snapshot before overwriting a locked finance row', () => {
    const { sql } = atomicMigration();
    const command = functionDefinition(sql, 'public.lock_project_opening_balance');

    expect(command).toMatch(/financeSnapshot/i);
    expect(command).toMatch(/finance_snapshot[\s\S]+updatedAt/i);
    expect(command).toMatch(/v_finance\."updatedAt"[\s\S]+is\s+distinct\s+from/i);
    expect(command).toMatch(/finance snapshot is stale/i);
    expect(command).toContain("errcode = '40001'");
    expect(command).toMatch(/ambiguous project finance/i);
    expect(command).toMatch(/v_finance_current_snapshot\s+is\s+distinct\s+from\s+v_canonical_finance_snapshot/i);
    expect(command).toMatch(/'contractValue'[\s\S]+'progressPercent'[\s\S]+'status'[\s\S]+'notes'[\s\S]+'updatedAt'/i);
  });

  it('rejects non-finite money and value inputs at the SQL boundary', () => {
    const { sql } = atomicMigration();
    const command = functionDefinition(sql, 'public.lock_project_opening_balance');

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+app_private\.parse_project_opening_nonnegative_numeric/i);
    expect(sql).toMatch(/'nan'\s*,\s*'infinity'\s*,\s*'-infinity'/i);
    expect(command).toMatch(/parse_project_opening_nonnegative_numeric[\s\S]+contractValue/i);
    expect(command).toMatch(/parse_project_opening_nonnegative_numeric[\s\S]+purchasedQty/i);
    expect(command).toMatch(/parse_project_opening_nonnegative_numeric[\s\S]+remainingQty/i);
    expect(command).toMatch(/parse_project_opening_nonnegative_numeric[\s\S]+unitPrice/i);
    expect(command).toMatch(/parse_project_opening_nonnegative_numeric[\s\S]+remainingValue/i);
  });

  it('ships a read-only duplicate preflight and rollback-only transactional SQL smoke coverage', () => {
    const preflight = artifact('supabase/perf/atomic_project_opening_balance_preflight.sql');
    const smoke = artifact('supabase/tests/atomic_project_opening_balance_smoke.sql');

    expect(preflight).toMatch(/^begin\s*;/im);
    expect(preflight).toMatch(/set\s+transaction\s+read\s+only/i);
    expect(preflight).toMatch(/duplicate[\s_-]+locked[\s_-]+scope/i);
    expect(preflight).toMatch(/normalize_project_opening_scope_key/i);
    expect(preflight).toMatch(/rollback\s*;\s*$/i);

    expect(smoke).toMatch(/^begin\s*;/im);
    expect(smoke).toMatch(/exact retry/i);
    expect(smoke).toMatch(/conflicting retry/i);
    expect(smoke).toMatch(/zero quantity/i);
    expect(smoke).toMatch(/multi-warehouse[\s\S]+all-or-nothing/i);
    expect(smoke).toMatch(/ambiguous item/i);
    expect(smoke).toMatch(/stale[\s/]+locked scope/i);
    expect(smoke).toMatch(/permission denial/i);
    expect(smoke).toMatch(/non-finite quantity[\s\S]+NaN/i);
    expect(smoke).toMatch(/non-finite value[\s\S]+Infinity/i);
    expect(smoke).toMatch(/locked opening balance line insert unexpectedly succeeded/i);
    expect(smoke).toMatch(/locked opening balance line update unexpectedly succeeded/i);
    expect(smoke).toMatch(/locked opening balance line delete unexpectedly succeeded/i);
    expect(smoke).toMatch(/rollback\s*;\s*$/i);
  });
});

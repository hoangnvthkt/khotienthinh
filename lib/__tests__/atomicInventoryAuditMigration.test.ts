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

const auditMigration = (): MigrationSource => {
  const migration = migrations().find(({ sql }) =>
    /create\s+or\s+replace\s+function\s+public\.post_inventory_audit\s*\(/i.test(sql));
  if (!migration) throw new Error('No atomic inventory-audit migration found');
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

describe('atomic inventory-audit migration contract', () => {
  it('extends legacy audit sessions with immutable command metadata and protected stable results', () => {
    const { sql } = auditMigration();

    expect(sql).toMatch(/alter\s+table\s+public\.audit_sessions[\s\S]+command_id\s+uuid/i);
    expect(sql).toMatch(/request_hash\s+text/i);
    expect(sql).toMatch(/posting_engine_version\s+text/i);
    expect(sql).toMatch(/create\s+unique\s+index[\s\S]+audit_sessions[\s\S]+command_id/i);
    expect(sql).toMatch(/create\s+table\s+app_private\.inventory_audit_command_results/i);
    expect(sql).toMatch(/command_id\s+uuid\s+primary\s+key/i);
    expect(sql).toMatch(/request_hash\s+text[\s\S]+actor_id\s+uuid[\s\S]+result\s+jsonb/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+app_private\.inventory_audit_command_results[\s\S]+service_role/i);
  });

  it('exposes one authenticated security-definer command with an active JWT actor and warehouse-scoped create plus complete permissions', () => {
    const { sql } = auditMigration();
    const command = functionDefinition(sql, 'public.post_inventory_audit');

    expect(command).toMatch(/p_command_id\s+uuid/i);
    expect(command).toMatch(/p_warehouse_id\s+text/i);
    expect(command).toMatch(/p_audited_at\s+timestamptz/i);
    expect(command).toMatch(/p_observations\s+jsonb/i);
    expect(command).toMatch(/returns\s+jsonb/i);
    expect(command).toMatch(/security\s+definer/i);
    expect(command).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(command).toMatch(/set\s+timezone\s*=\s*'UTC'/i);
    expect(command).toContain('public.current_app_user_id()');
    expect(command).toMatch(/public\.users[\s\S]+is_active/i);
    expect(command).toContain("'wms.transaction.create'");
    expect(command).toContain("'wms.transaction.complete'");
    expect(command).toContain('app_private.wms_has_action');
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.post_inventory_audit\s*\(\s*uuid\s*,\s*text\s*,\s*timestamptz\s*,\s*jsonb\s*\)\s+from\s+public\s*,\s*anon/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.post_inventory_audit\s*\(\s*uuid\s*,\s*text\s*,\s*timestamptz\s*,\s*jsonb\s*\)\s+to\s+authenticated/i);
  });

  it('validates 1..500 canonical nonnegative decimal observations, duplicates, reasons, and A2 precision', () => {
    const { sql } = auditMigration();
    const command = functionDefinition(sql, 'public.post_inventory_audit');

    expect(command).toMatch(/jsonb_typeof\s*\(\s*p_observations\s*\)\s*<>\s*'array'/i);
    expect(command).toMatch(/jsonb_array_length\s*\(\s*p_observations\s*\)[\s\S]+(?:500|between\s+1\s+and\s+500)/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+app_private\.parse_inventory_audit_nonnegative_decimal/i);
    expect(sql).toMatch(/canonical[\s\S]+decimal/i);
    expect(sql).toMatch(/nan|infinity/i);
    expect(command).toMatch(/duplicate[\s\S]+item/i);
    expect(command).toMatch(/NATURAL_LOSS[\s\S]+DAMAGE[\s\S]+THEFT[\s\S]+MEASUREMENT[\s\S]+EXPIRED[\s\S]+PROCESS_WASTE/i);
    expect(command).toMatch(/loss[\s_-]+reason[\s\S]+non-zero/i);
    expect(command).toContain('app_private.assert_quantity_precision');
    expect(command).toContain('app_private.sha256_text');
    expect(command).toMatch(/order\s+by[\s\S]+item_id/i);
  });

  it('serializes command, source and transaction before sorted item locks, then checks exact cache and all balance scopes', () => {
    const { sql } = auditMigration();
    const command = functionDefinition(sql, 'public.post_inventory_audit');
    const commandLock = command.indexOf('inventory-audit-command:');
    const sourceLock = command.indexOf('wms-source:inventory_audit:');
    const transactionLock = command.indexOf('wms-transaction:');
    const itemLock = command.search(/from\s+public\.items[\s\S]+for\s+update/i);

    expect(commandLock).toBeGreaterThan(-1);
    expect(sourceLock).toBeGreaterThan(commandLock);
    expect(transactionLock).toBeGreaterThan(sourceLock);
    expect(itemLock).toBeGreaterThan(transactionLock);
    expect(command).toMatch(/stock_by_warehouse/i);
    expect(command).toMatch(/expected_system_qty/i);
    expect(command).toContain("errcode = '40001'");
    expect(command).toMatch(/sum\s*\(\s*balance\.on_hand_qty\s*\)/i);
    expect(command).toMatch(/balance\.material_id[\s\S]+balance\.warehouse_id/i);
    expect(command).not.toMatch(/balance\.scope_key\s*=/i);
    expect(command).toMatch(/reconciliation/i);
    expect(command).toMatch(/price_in[\s\S]+<\s*0/i);
  });

  it('reserves inventory_audit sources with one-use capabilities and makes sessions immutable to API roles', () => {
    const { sql } = auditMigration();
    const sourceGuard = functionDefinition(sql, 'app_private.guard_inventory_audit_wms_source');
    const sessionGuard = functionDefinition(sql, 'app_private.guard_inventory_audit_session_write');

    expect(sql).toMatch(/create\s+unlogged\s+table\s+app_private\.inventory_audit_write_authorizations/i);
    expect(sql).toMatch(/backend_pid[\s\S]+transaction_xid[\s\S]+write_kind[\s\S]+target_key/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+app_private\.inventory_audit_write_authorizations[\s\S]+service_role/i);
    expect(sourceGuard).toMatch(/inventory_audit/i);
    expect(sourceGuard).toMatch(/delete\s+from\s+app_private\.inventory_audit_write_authorizations/i);
    expect(sourceGuard).toMatch(/direct|reserved/i);
    expect(sql).toMatch(/before\s+insert\s+or\s+update[\s\S]+on\s+public\.transactions[\s\S]+guard_inventory_audit_wms_source/i);
    expect(sql).toMatch(/create\s+unique\s+index[\s\S]+transactions[\s\S]+source_type[\s\S]+source_id[\s\S]+inventory_audit/i);
    expect(sessionGuard).toMatch(/tg_op\s*=\s*'UPDATE'|immutable/i);
    expect(sessionGuard).toMatch(/tg_op\s*=\s*'DELETE'|immutable/i);
    expect(sessionGuard).toMatch(/delete\s+from\s+app_private\.inventory_audit_write_authorizations/i);
    expect(sql).toMatch(/enable\s+always\s+trigger[\s\S]+guard_inventory_audit_session/i);
    expect(sql).toMatch(/revoke\s+(?:insert\s*,\s*update\s*,\s*delete|all)[\s\S]+public\.audit_sessions[\s\S]+authenticated[\s\S]+service_role/i);
    expect(sql).toMatch(/revoke\s+truncate[\s\S]+public\.audit_sessions[\s\S]+authenticated[\s\S]+service_role/i);
  });

  it('builds server-authoritative evidence and posts one deterministic signed adjustment only for non-zero deltas', () => {
    const { sql } = auditMigration();
    const command = functionDefinition(sql, 'public.post_inventory_audit');

    for (const field of [
      'itemId',
      'itemName',
      'sku',
      'unit',
      'systemStock',
      'actualStock',
      'delta',
      'lossReason',
      'note',
      'exceedsNorm',
      'lossPercent',
      'normPercent',
      'lossValue',
    ]) {
      expect(command).toContain(`'${field}'`);
    }
    expect(command).toMatch(/insert\s+into\s+public\.audit_sessions/i);
    expect(command).toContain("'ADJUSTMENT'");
    expect(command).toContain("'inventory_audit'");
    expect(command).toContain('public.post_wms_transaction');
    expect(command).toMatch(/v_nonzero_count\s*>\s*0/i);
    expect(command).toMatch(/audit-adjustment-/i);
    expect(command).toMatch(/insert\s+into\s+app_private\.inventory_audit_command_results/i);
    expect(command).toMatch(/return\s+v_result/i);
    expect(command).toContain("'audit_session'");
    expect(command).toContain("'stock_transaction'");
    expect(command).toContain("'updated_items'");
  });

  it('ships a read-only live preflight and rollback-only SQL smoke for atomic and idempotent behavior', () => {
    const preflight = artifact('supabase/perf/atomic_inventory_audit_preflight.sql');
    const smoke = artifact('supabase/tests/atomic_inventory_audit_smoke.sql');

    expect(preflight).toMatch(/^begin\s*;/im);
    expect(preflight).toMatch(/set\s+transaction\s+read\s+only/i);
    expect(preflight).toMatch(/audit_sessions/i);
    expect(preflight).toMatch(/inventory_audit/i);
    expect(preflight).toMatch(/duplicate/i);
    expect(preflight).toMatch(/rollback\s*;\s*$/i);

    expect(smoke).toMatch(/^begin\s*;/im);
    expect(smoke).toMatch(/0\.25[\s\S]+1\.75[\s\S]+2\.375[\s\S]+0\.123456/i);
    expect(smoke).toMatch(/exact retry/i);
    expect(smoke).toMatch(/conflicting retry/i);
    expect(smoke).toMatch(/all-zero/i);
    expect(smoke).toMatch(/duplicate item/i);
    expect(smoke).toMatch(/40001/i);
    expect(smoke).toMatch(/balance[\s/-]+cache mismatch/i);
    expect(smoke).toMatch(/multi-item[\s\S]+rollback/i);
    expect(smoke).toMatch(/permission denial/i);
    expect(smoke).toMatch(/direct DML/i);
    expect(smoke).toMatch(/TRUNCATE denial/i);
    expect(smoke).toMatch(/deterministic source/i);
    expect(smoke).toMatch(/rollback\s*;\s*$/i);
  });
});

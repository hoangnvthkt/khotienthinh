import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface MigrationSource {
  file: string;
  sql: string;
}

const reversalMigration = (): MigrationSource => {
  const directory = join(process.cwd(), 'supabase', 'migrations');
  const migration = readdirSync(directory)
    .filter(file => file.endsWith('.sql') && file > '20260715140000_atomic_inventory_audit.sql')
    .sort()
    .map(file => ({ file, sql: readFileSync(join(directory, file), 'utf8') }))
    .find(({ sql }) => /reverse_project_opening_balance\s*\(\s*p_command\s+jsonb\s*\)/i.test(sql));
  if (!migration) throw new Error('No forward project opening-balance reversal migration found');
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

describe('controlled project opening-balance reversal migration contract', () => {
  it('is forward-only and stores immutable command, finance, and compensation evidence', () => {
    const { file, sql } = reversalMigration();

    expect(file.localeCompare('20260715140000_atomic_inventory_audit.sql')).toBeGreaterThan(0);
    expect(sql).toMatch(/alter\s+table\s+public\.project_opening_balances[\s\S]+reversal_command_id\s+uuid/i);
    expect(sql).toMatch(/reversal_request_hash\s+text/i);
    expect(sql).toMatch(/reversed_by\s+text/i);
    expect(sql).toMatch(/reversed_at\s+timestamptz/i);
    expect(sql).toMatch(/reversal_reason\s+text/i);
    expect(sql).toMatch(/reversal_stock_transaction_ids\s+jsonb/i);
    expect(sql).toMatch(/reversal_material_project_transaction_id\s+text/i);
    expect(sql).toMatch(/create\s+table\s+app_private\.project_opening_reversal_results/i);
    expect(sql).toMatch(/command_id\s+uuid\s+primary\s+key/i);
    expect(sql).toMatch(/opening_balance_id\s+uuid\s+not\s+null\s+unique/i);
    expect(sql).toMatch(/finance_before\s+jsonb[\s\S]+finance_after\s+jsonb/i);
    expect(sql).toMatch(/stock_transaction_map\s+jsonb/i);
    expect(sql).toMatch(/result\s+jsonb\s+not\s+null/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+app_private\.project_opening_reversal_results[\s\S]+service_role/i);
  });

  it('exposes one least-privilege command and derives an active actor with scoped PBAC', () => {
    const { sql } = reversalMigration();
    const command = functionDefinition(sql, 'public.reverse_project_opening_balance');

    expect(command).toMatch(/returns\s+jsonb/i);
    expect(command).toMatch(/security\s+definer/i);
    expect(command).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(command).toContain('public.current_app_user_id()');
    expect(command).toMatch(/public\.users[\s\S]+is_active/i);
    expect(command).toContain("'project.budget.manage'");
    expect(command).toContain('app_private.project_has_permission_v2');
    expect(command).toContain("'wms.transaction.create'");
    expect(command).toContain("'wms.transaction.complete'");
    expect(command).toContain('app_private.wms_has_action');
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.reverse_project_opening_balance\s*\(\s*jsonb\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.reverse_project_opening_balance\s*\(\s*jsonb\s*\)\s+to\s+authenticated/i);
  });

  it('serializes scope, command, source and transaction identities before sorted item locks', () => {
    const { sql } = reversalMigration();
    const command = functionDefinition(sql, 'public.reverse_project_opening_balance');
    const scopeLock = command.search(/project-opening-scope:/i);
    const commandLock = command.search(/project-opening-reversal-command:/i);
    const sourceLock = command.search(/wms-source:project_opening_balance_reversal:/i);
    const transactionLock = command.search(/wms-transaction:/i);
    const itemLock = command.search(/from\s+public\.items[\s\S]+order\s+by[\s\S]+for\s+update/i);

    expect(scopeLock).toBeGreaterThan(-1);
    expect(commandLock).toBeGreaterThan(scopeLock);
    expect(sourceLock).toBeGreaterThan(commandLock);
    expect(transactionLock).toBeGreaterThan(sourceLock);
    expect(itemLock).toBeGreaterThan(transactionLock);
    expect(command).toMatch(/set_config\s*\(\s*'lock_timeout'\s*,\s*'5s'\s*,\s*true\s*\)/i);
  });

  it('uses exact idempotency, rejects cross-actor/conflicting replay, and returns a saved result', () => {
    const { sql } = reversalMigration();
    const command = functionDefinition(sql, 'public.reverse_project_opening_balance');

    expect(command).toMatch(/p_command\s*->>\s*'commandId'/i);
    expect(command).toContain('app_private.sha256_text');
    expect(command).toMatch(/from\s+app_private\.project_opening_reversal_results/i);
    expect(command).toMatch(/reused with different content/i);
    expect(command).toMatch(/cross-actor/i);
    expect(command).toMatch(/insert\s+into\s+app_private\.project_opening_reversal_results/i);
    expect(command).toMatch(/return\s+v_saved_result/i);
  });

  it('requires complete original lineage and never mutates posted WMS or inventory ledger history', () => {
    const { sql } = reversalMigration();
    const command = functionDefinition(sql, 'public.reverse_project_opening_balance');

    expect(command).toMatch(/status\s*<>\s*'locked'|status\s+is\s+distinct\s+from\s+'locked'/i);
    expect(command).toContain("'wf001-opening-v1'");
    expect(command).toMatch(/from\s+public\.transactions[\s\S]+source_type[\s\S]+'project_opening_balance'/i);
    expect(command).toMatch(/from\s+public\.inventory_transactions/i);
    expect(command).toMatch(/from\s+public\.inventory_ledger_entries/i);
    expect(command).toMatch(/lineage[\s\S]+reconciliation|reconciliation[\s\S]+lineage/i);
    expect(command).not.toMatch(/update\s+public\.inventory_ledger_entries/i);
    expect(command).not.toMatch(/delete\s+from\s+public\.inventory_ledger_entries/i);
    expect(command).not.toMatch(/update\s+public\.inventory_transactions/i);
    expect(command).not.toMatch(/delete\s+from\s+public\.inventory_transactions/i);
    expect(command).not.toMatch(/update\s+public\.transactions\s+[\s\S]*source_type\s*=\s*'project_opening_balance'/i);
    expect(command).not.toMatch(/delete\s+from\s+public\.transactions/i);
  });

  it('posts deterministic decimal inverse adjustments and a negative project expense', () => {
    const { sql } = reversalMigration();
    const command = functionDefinition(sql, 'public.reverse_project_opening_balance');

    expect(command).toContain("'project_opening_balance_reversal'");
    expect(command).toContain("'wf001-opening-reversal-v1'");
    expect(command).toMatch(/'ADJUSTMENT'::public\.transaction_type/i);
    expect(command).toMatch(/['"]quantity['"]\s*,\s*-\s*\(\(/i);
    expect(command).toContain('app_private.assert_quantity_precision');
    expect(command).toContain('app_private.wms_transaction_intent');
    expect(command).toContain('public.process_transaction_status');
    expect(command).toMatch(/opening-material-reversal:/i);
    expect(command).toMatch(/opening_balance_reversal:/i);
    expect(command).toMatch(/amount[\s\S]+-\s*pg_catalog\.abs|amount[\s\S]+-\s*abs/i);
  });

  it('fails closed on stale cache/balance/reservation and stores explicit finance before/after evidence', () => {
    const { sql } = reversalMigration();
    const command = functionDefinition(sql, 'public.reverse_project_opening_balance');

    expect(command).toMatch(/sum\s*\([\s\S]+inventory_balances[\s\S]+stock_by_warehouse/i);
    expect(command).toMatch(/reservation|reserved/i);
    expect(command).toMatch(/using\s+errcode\s*=\s*'40001'/i);
    expect(command).toMatch(/expectedFinanceSnapshot/i);
    expect(command).toMatch(/correctedFinanceSnapshot/i);
    expect(command).toMatch(/finance snapshot is stale/i);
    expect(command).toMatch(/update\s+public\.project_finances/i);
    expect(command).not.toMatch(/delete\s+from\s+public\.project_finances/i);
    expect(command).toMatch(/finance_before[\s\S]+finance_after/i);
  });

  it('authorizes exactly one locked-to-void row image and protects reversal source identities', () => {
    const { sql } = reversalMigration();
    const command = functionDefinition(sql, 'public.reverse_project_opening_balance');
    const guard = functionDefinition(sql, 'app_private.guard_project_opening_reversal_source');

    expect(sql).toMatch(/create\s+unlogged\s+table\s+app_private\.project_opening_reversal_write_authorizations/i);
    expect(sql).toMatch(/expected_before\s+jsonb[\s\S]+expected_after\s+jsonb/i);
    expect(command).toContain('app_private.authorize_project_opening_reversal_write');
    expect(command).toMatch(/status\s*=\s*'void'/i);
    expect(sql).toMatch(/old\.status\s*=\s*'locked'[\s\S]+new\.status\s*=\s*'void'/i);
    expect(sql).toMatch(/create\s+unlogged\s+table\s+app_private\.project_opening_reversal_source_authorizations/i);
    expect(guard).toMatch(/delete\s+from\s+app_private\.project_opening_reversal_source_authorizations/i);
    expect(guard).toMatch(/posting_engine_version[\s\S]+wf001-opening-reversal-v1/i);
    expect(sql).toMatch(/enable\s+always\s+trigger\s+trg_guard_project_opening_reversal_source/i);
    expect(sql).toMatch(/create\s+trigger\s+trg_guard_project_opening_reversal_material_source[\s\S]+before\s+insert\s+or\s+update\s+or\s+delete/i);
    expect(sql).toMatch(/tg_op\s*=\s*'DELETE'[\s\S]+project opening reversal material evidence is immutable/i);
    expect(sql).toMatch(/create\s+unique\s+index[\s\S]+on\s+public\.transactions\s*\(\s*source_type\s*,\s*source_id\s*\)[\s\S]+where\s+source_type\s*=\s*'project_opening_balance_reversal'/i);
  });

  it('ships a read-only preflight and rollback-only runtime smoke with the critical cases', () => {
    const preflight = artifact('supabase/perf/project_opening_balance_reversal_preflight.sql');
    const smoke = artifact('supabase/tests/project_opening_balance_reversal_smoke.sql');

    expect(preflight).toMatch(/^begin\s*;/im);
    expect(preflight).toMatch(/set\s+transaction\s+read\s+only/i);
    expect(preflight).toMatch(/missing[\s_-]+lineage/i);
    expect(preflight).toMatch(/duplicate[\s_-]+reversal[\s_-]+source/i);
    expect(preflight).toMatch(/finance/i);
    expect(preflight).toMatch(/rollback\s*;\s*$/i);

    expect(smoke).toMatch(/^begin\s*;/im);
    expect(smoke).toMatch(/decimal inverse/i);
    expect(smoke).toMatch(/exact retry/i);
    expect(smoke).toMatch(/conflicting retry/i);
    expect(smoke).toMatch(/cross-actor/i);
    expect(smoke).toMatch(/insufficient stock/i);
    expect(smoke).toMatch(/stale finance/i);
    expect(smoke).toMatch(/permission denial/i);
    expect(smoke).toMatch(/ledger immutability/i);
    expect(smoke).toMatch(/source spoofing/i);
    expect(smoke).toMatch(/all-or-nothing|rollback/i);
    expect(smoke).toMatch(/rollback\s*;\s*$/i);
  });
});

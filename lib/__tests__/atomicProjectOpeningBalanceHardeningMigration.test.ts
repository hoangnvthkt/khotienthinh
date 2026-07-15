import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface MigrationSource {
  file: string;
  sql: string;
}

const migrationDirectory = join(process.cwd(), 'supabase', 'migrations');

const forwardHardeningMigration = (): MigrationSource => {
  const migration = readdirSync(migrationDirectory)
    .filter(file => file.endsWith('.sql') && file > '20260715102000_atomic_project_opening_balance.sql')
    .sort()
    .map(file => ({ file, sql: readFileSync(join(migrationDirectory, file), 'utf8') }))
    .find(({ sql }) => /lock_project_opening_balance_v1|guard_project_opening_transaction_source/i.test(sql));

  if (!migration) throw new Error('No forward-only atomic opening hardening migration found');
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

describe('atomic project opening-balance forward hardening migration', () => {
  it('is forward-only and keeps the original A3.1 migration immutable', () => {
    const migration = forwardHardeningMigration();

    expect(migration.file).toMatch(/^20260715\d{6}_.*\.sql$/);
    expect(migration.file.localeCompare('20260715102000_atomic_project_opening_balance.sql'))
      .toBeGreaterThan(0);
    expect(migration.sql).toMatch(/alter\s+function\s+public\.lock_project_opening_balance\s*\(\s*jsonb\s*\)\s+rename\s+to\s+lock_project_opening_balance_v1/i);
  });

  it('backfills finance concurrency fields and makes semantic changes advance updatedAt', () => {
    const { sql } = forwardHardeningMigration();
    const touch = functionDefinition(sql, 'app_private.touch_project_finance_updated_at');

    expect(sql).toMatch(/update\s+public\.project_finances[\s\S]+"contractValue"\s*=\s*coalesce/i);
    expect(sql).toMatch(/"progressPercent"\s*=\s*coalesce/i);
    expect(sql).toMatch(/"updatedAt"\s*=\s*coalesce/i);
    expect(sql).toMatch(/alter\s+table\s+public\.project_finances[\s\S]+"contractValue"\s+set\s+default\s+0[\s\S]+"contractValue"\s+set\s+not\s+null/i);
    expect(sql).toMatch(/"progressPercent"\s+set\s+default\s+0[\s\S]+"progressPercent"\s+set\s+not\s+null/i);
    expect(sql).toMatch(/"updatedAt"\s+set\s+default[\s\S]+"updatedAt"\s+set\s+not\s+null/i);
    expect(touch).toMatch(/to_jsonb\s*\(\s*new\s*\)\s*-\s*'updatedAt'/i);
    expect(touch).toMatch(/to_jsonb\s*\(\s*old\s*\)\s*-\s*'updatedAt'/i);
    expect(touch).toMatch(/new\."updatedAt"\s*:=\s*greatest[\s\S]+pg_catalog\.clock_timestamp\s*\(\s*\)[\s\S]+old\."updatedAt"\s*\+\s*interval\s+'1 microsecond'/i);
    expect(sql).toMatch(/before\s+update\s+on\s+public\.project_finances[\s\S]+touch_project_finance_updated_at/i);
    expect(sql).toMatch(/enable\s+always\s+trigger\s+trg_touch_project_finance_updated_at/i);
  });

  it('reserves opening WMS sources to the owner-only opening engine and enforces uniqueness', () => {
    const { sql } = forwardHardeningMigration();
    const guard = functionDefinition(sql, 'app_private.guard_project_opening_transaction_source');
    const preflight = sql.search(/duplicate[\s_-]+project[\s_-]+opening[\s_-]+transaction[\s_-]+source/i);
    const index = sql.search(/create\s+unique\s+index[\s\S]+transactions[\s\S]+source_type[\s\S]+source_id/i);

    expect(guard).toMatch(/security\s+invoker/i);
    expect(guard).toMatch(/current_user/i);
    expect(guard).toMatch(/pg_catalog\.pg_class[\s\S]+pg_catalog\.pg_roles/i);
    expect(sql).toMatch(/create\s+unlogged\s+table\s+app_private\.project_opening_call_contexts/i);
    expect(sql).toMatch(/backend_pid[\s\S]+transaction_xid[\s\S]+command_id[\s\S]+target_warehouse_ids/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+app_private\.project_opening_call_contexts[\s\S]+service_role/i);
    expect(guard).toMatch(/from\s+app_private\.project_opening_call_contexts[\s\S]+for\s+update/i);
    expect(guard).toMatch(/backend_pid\s*=\s*pg_catalog\.pg_backend_pid\s*\(\s*\)/i);
    expect(guard).toMatch(/transaction_xid\s*=\s*pg_catalog\.txid_current\s*\(\s*\)/i);
    expect(guard).toContain("'project_opening_balance'");
    expect(guard).toContain("'wf001-opening-v1'");
    expect(guard).toMatch(/source_id[\s\S]+required/i);
    expect(sql).toMatch(/before\s+insert\s+or\s+update\s+on\s+public\.transactions[\s\S]+guard_project_opening_transaction_source/i);
    expect(sql).toMatch(/enable\s+always\s+trigger\s+trg_guard_project_opening_transaction_source/i);
    expect(preflight).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(preflight);
    expect(sql).toMatch(/create\s+unique\s+index[\s\S]+on\s+public\.transactions\s*\(\s*source_type\s*,\s*source_id\s*\)[\s\S]+where\s+source_type\s*=\s*'project_opening_balance'/i);
  });

  it('locks transaction DML and fails closed unless every legacy reserved source proves deterministic provenance', () => {
    const { sql } = forwardHardeningMigration();
    const provenance = functionDefinition(
      sql,
      'app_private.project_opening_transaction_provenance_error',
    );
    const transactionLock = sql.search(
      /lock\s+table\s+public\.transactions\s+in\s+share\s+row\s+exclusive\s+mode/i,
    );
    const legacyPreflight = sql.search(/project[\s_-]+opening[\s_-]+transaction[\s_-]+provenance[\s_-]+preflight/i);
    const sourceIndex = sql.search(/create\s+unique\s+index\s+transactions_project_opening_source_uidx/i);

    expect(transactionLock).toBeGreaterThan(-1);
    expect(legacyPreflight).toBeGreaterThan(transactionLock);
    expect(sourceIndex).toBeGreaterThan(legacyPreflight);
    expect(provenance).toMatch(/source_id[\s\S]+uuid[\s\S]+target_warehouse_id/i);
    expect(provenance).toMatch(/opening-balance:[\s\S]+sha256_text/i);
    expect(provenance).toContain("'project_opening_balance'");
    expect(provenance).toContain("'wf001-opening-v1'");
    expect(provenance).toMatch(/status::text\s*<>\s*'COMPLETED'/i);
    expect(provenance).toMatch(/type::text\s*<>\s*'ADJUSTMENT'/i);
    expect(provenance).toMatch(/source_warehouse_id\s+is\s+not\s+null/i);
    expect(provenance).toContain('app_private.wms_transaction_intent');
    expect(provenance).toMatch(/sha256_text[\s\S]+posting_request_hash/i);
    expect(provenance).toMatch(/project_opening_balances[\s\S]+status\s*=\s*'locked'/i);
    expect(provenance).toMatch(/stock_transaction_ids[\s\S]+jsonb_build_array/i);
    expect(provenance).toMatch(/project_opening_balance_lines[\s\S]+remaining_qty\s*>\s*0/i);
    expect(provenance).toMatch(/jsonb_array_elements[\s\S]+itemId[\s\S]+quantity[\s\S]+unit/i);
    expect(provenance).toMatch(/inventory_transactions[\s\S]+inventory_ledger_entries/i);
    expect(sql).toMatch(/project[\s_-]+opening[\s_-]+transaction[\s_-]+provenance[\s_-]+preflight[\s\S]+project_opening_transaction_provenance_error[\s\S]+raise\s+exception/i);
  });

  it('checks catalog PBAC only when the opening command actually mutates an item', () => {
    const { sql } = forwardHardeningMigration();
    const guard = functionDefinition(sql, 'app_private.guard_project_opening_catalog_write');

    expect(guard).toMatch(/security\s+definer/i);
    expect(guard).toMatch(/from\s+app_private\.project_opening_call_contexts/i);
    expect(guard).toContain("'wms.inventory.edit'");
    expect(guard).toContain("'wms.master_data.manage'");
    expect(guard).toMatch(/wms_has_action\s*\(\s*'wms\.inventory\.edit'\s*,\s*null\s*,\s*null\s*,\s*null\s*,\s*null\s*,/i);
    expect(guard).toMatch(/wms_has_action\s*\(\s*'wms\.master_data\.manage'\s*,\s*null\s*,\s*null\s*,\s*null\s*,\s*null\s*,/i);
    expect(sql).toMatch(/after\s+insert\s+or\s+update\s+of\s+price_in\s*,\s*price_out\s+on\s+public\.items[\s\S]+guard_project_opening_catalog_write/i);
    expect(sql).toMatch(/enable\s+always\s+trigger\s+trg_guard_project_opening_catalog_write/i);
  });

  it('wraps the atomic command with authoritative scope and least-privilege PBAC checks', () => {
    const { sql } = forwardHardeningMigration();
    const wrapper = functionDefinition(sql, 'public.lock_project_opening_balance');

    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.lock_project_opening_balance_v1\s*\(\s*jsonb\s*\)[\s\S]+authenticated[\s\S]+service_role/i);
    expect(wrapper).toMatch(/security\s+definer/i);
    expect(wrapper).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(wrapper).toContain('public.current_app_user_id()');
    expect(wrapper).toContain('app_private.lock_project_opening_authoritative_scope');
    expect(wrapper).toContain('app_private.normalize_project_opening_scope_key');
    expect(wrapper).toMatch(/scopeKey[\s\S]+authoritative|authoritative[\s\S]+scopeKey/i);
    expect(wrapper).toContain("'wms.transaction.create'");
    expect(wrapper).toContain("'wms.transaction.complete'");
    expect(wrapper).toMatch(/wms_has_action\s*\(\s*'wms\.transaction\.create'\s*,\s*null\s*,\s*v_warehouse_id\s*,\s*null\s*,\s*null\s*,\s*v_actor/i);
    expect(wrapper).toMatch(/wms_has_action\s*\(\s*'wms\.transaction\.complete'\s*,\s*null\s*,\s*v_warehouse_id\s*,\s*null\s*,\s*null\s*,\s*v_actor/i);
    expect(wrapper).toMatch(/project_opening_call_contexts/i);
    expect(wrapper).toMatch(/lock_project_opening_balance_v1\s*\(\s*v_[A-Za-z0-9_]+\s*\)/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.lock_project_opening_balance\s*\(\s*jsonb\s*\)\s+to\s+authenticated/i);
  });

  it('holds authoritative project and site row locks through the core call and revalidates before return', () => {
    const { sql } = forwardHardeningMigration();
    const scopeLock = functionDefinition(
      sql,
      'app_private.lock_project_opening_authoritative_scope',
    );
    const transition = functionDefinition(sql, 'app_private.validate_project_opening_lock');
    const wrapper = functionDefinition(sql, 'public.lock_project_opening_balance');
    const coreCall = wrapper.search(/lock_project_opening_balance_v1\s*\(/i);
    const firstScopeLock = wrapper.search(/lock_project_opening_authoritative_scope\s*\(/i);
    const secondScopeLock = wrapper.indexOf('lock_project_opening_authoritative_scope', firstScopeLock + 1);

    expect(scopeLock).toMatch(/from\s+public\.projects[\s\S]+for\s+(?:no\s+key\s+)?update/i);
    expect(scopeLock).toMatch(/from\s+public\.hrm_construction_sites[\s\S]+for\s+(?:no\s+key\s+)?update/i);
    expect(scopeLock).toMatch(/project-site mismatch|project[\s_-]+site[\s_-]+mismatch/i);
    expect(transition).toContain('app_private.lock_project_opening_authoritative_scope');
    expect(firstScopeLock).toBeGreaterThan(-1);
    expect(coreCall).toBeGreaterThan(firstScopeLock);
    expect(secondScopeLock).toBeGreaterThan(coreCall);
    expect(wrapper).toMatch(/authoritative[\s_-]+scope[\s_-]+changed|revalidat/i);
  });

  it('preflights and uniquely indexes authoritative locked project/site scope', () => {
    const { sql } = forwardHardeningMigration();
    const preflight = sql.search(/duplicate[\s_-]+authoritative[\s_-]+locked[\s_-]+scope/i);
    const index = sql.search(/create\s+unique\s+index\s+project_opening_balances_locked_authoritative_scope_uidx/i);

    expect(sql).toMatch(/project[\s_-]+site[\s_-]+mismatch/i);
    expect(sql).toMatch(/hrm_construction_sites/i);
    expect(preflight).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(preflight);
    expect(sql).toMatch(/create\s+unique\s+index[\s\S]+on\s+public\.project_opening_balances[\s\S]+coalesce[\s\S]+project_id[\s\S]+coalesce[\s\S]+construction_site_id[\s\S]+where\s+status\s*=\s*'locked'/i);
  });

  it('validates resolved line identity coherence at every draft-to-locked transition', () => {
    const { sql } = forwardHardeningMigration();
    const guard = functionDefinition(sql, 'app_private.validate_project_opening_lock');

    expect(guard).toMatch(/old\.status\s+is\s+distinct\s+from\s+'locked'[\s\S]+new\.status\s*=\s*'locked'/i);
    expect(guard).toMatch(/from\s+public\.project_opening_balance_lines/i);
    expect(guard).toMatch(/group\s+by[\s\S]+lower[\s\S]+sku[\s\S]+count\s*\(\s*distinct[\s\S]+accounting/i);
    expect(guard).toMatch(/accounting[\s\S]+count\s*\(\s*distinct[\s\S]+sku/i);
    expect(guard).toMatch(/inventory_item_id/i);
    expect(guard).toMatch(/(?:from|join)\s+public\.items/i);
    expect(guard).toContain('app_private.quantity_units_are_equivalent');
    expect(guard).toMatch(/identity[\s_-]+coherence/i);
    expect(sql).toMatch(/before\s+update\s+on\s+public\.project_opening_balances[\s\S]+validate_project_opening_lock/i);
    expect(sql).toMatch(/enable\s+always\s+trigger\s+trg_validate_project_opening_lock/i);
  });

  it('extends read-only preflight diagnostics and rollback smoke personas', () => {
    const preflight = artifact('supabase/perf/atomic_project_opening_balance_preflight.sql');
    const smoke = artifact('supabase/tests/atomic_project_opening_balance_smoke.sql');

    expect(preflight).toMatch(/finance[\s_-]+nullable|nullable[\s_-]+finance/i);
    expect(preflight).toMatch(/duplicate[\s_-]+project[\s_-]+opening[\s_-]+transaction[\s_-]+source/i);
    expect(preflight).toMatch(/duplicate[\s_-]+authoritative[\s_-]+locked[\s_-]+scope/i);
    expect(preflight).toMatch(/project[\s_-]+site[\s_-]+mismatch/i);
    expect(preflight).toMatch(/line[\s_-]+identity[\s_-]+coherence/i);
    expect(preflight).toMatch(/set\s+transaction\s+read\s+only/i);
    expect(preflight).toMatch(/project[\s_-]+opening[\s_-]+transaction[\s_-]+provenance/i);
    expect(preflight).toMatch(/do\s+\$atomic_project_opening_balance_preflight_assertions\$[\s\S]+raise\s+exception/i);
    expect(preflight.search(/raise\s+exception/i)).toBeLessThan(preflight.search(/rollback\s*;/i));

    expect(smoke).toMatch(/legacy nullable finance/i);
    expect(smoke).toMatch(/semantic finance update[\s\S]+updatedAt/i);
    expect(smoke).toMatch(/reserved opening source/i);
    expect(smoke).toMatch(/generic[\s_-]+post_wms_transaction/i);
    expect(smoke).toMatch(/authoritative scope/i);
    expect(smoke).toMatch(/project[\s_-]+site mismatch/i);
    expect(smoke).toMatch(/intra-command[\s_-]+item identity/i);
    expect(smoke).toMatch(/missing wms\.transaction\.create/i);
    expect(smoke).toMatch(/missing catalog permission/i);
    expect(smoke).toMatch(/rollback\s*;\s*$/i);
  });
});

import { readdirSync, readFileSync } from 'node:fs';
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

const latestMigrationMatching = (pattern: RegExp, description: string): MigrationSource => {
  let result: MigrationSource | undefined;
  for (const migration of migrations()) {
    pattern.lastIndex = 0;
    if (pattern.test(migration.sql)) result = migration;
  }
  if (!result) throw new Error(`No migration found for ${description}`);
  return result;
};

const latestFunction = (pattern: RegExp, description: string): string => {
  let result: string | undefined;

  for (const migration of migrations()) {
    pattern.lastIndex = 0;
    for (const match of migration.sql.matchAll(pattern)) {
      const remaining = migration.sql.slice(match.index);
      const bodyTag = /\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/i.exec(remaining);
      if (!bodyTag || bodyTag.index === undefined) {
        throw new Error(`Missing body tag for ${description} in ${migration.file}`);
      }
      const start = bodyTag.index + bodyTag[0].length;
      const end = remaining.indexOf(`${bodyTag[1]};`, start);
      if (end === -1) throw new Error(`Unterminated ${description} in ${migration.file}`);
      const candidate = remaining.slice(0, end + bodyTag[1].length + 1);
      if (/process_transaction_status/i.test(description)
          && !candidate.includes('app_private.assert_quantity_precision')) continue;
      result = candidate;
    }
  }

  if (!result) throw new Error(`No function found for ${description}`);
  return result;
};

const artifact = (path: string): string =>
  readFileSync(join(process.cwd(), ...path.split('/')), 'utf8');

describe('WMS posting-path containment migration contract', () => {
  it('forces new WMS documents through PENDING and consumes exact one-use status authorization', () => {
    const { sql } = latestMigrationMatching(
      /create\s+unlogged\s+table\s+app_private\.wms_write_authorizations/i,
      'WMS one-use write authorization table',
    );
    const guard = latestFunction(
      /create\s+or\s+replace\s+function\s+app_private\.guard_wms_transaction_write\s*\(/gi,
      'guard_wms_transaction_write',
    );

    expect(sql).toMatch(/backend_pid\s+integer\s+not\s+null/i);
    expect(sql).toMatch(/transaction_xid\s+bigint\s+not\s+null/i);
    expect(sql).toMatch(/write_kind\s+text\s+not\s+null/i);
    expect(sql).toMatch(/target_key\s+text\s+not\s+null/i);
    expect(sql).toMatch(/expected_before\s+jsonb\s+not\s+null/i);
    expect(sql).toMatch(/expected_after\s+jsonb\s+not\s+null/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+app_private\.wms_write_authorizations\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
    expect(sql).toMatch(/create\s+policy\s+transactions_phase4_insert[\s\S]+status\s*=\s*'PENDING'/i);

    expect(guard).toMatch(/security\s+definer/i);
    expect(guard).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(guard).toMatch(/completed transaction is immutable/i);
    expect(guard).toMatch(/delete\s+from\s+app_private\.wms_write_authorizations/i);
    expect(guard).toMatch(/expected_before\s*=\s*to_jsonb\s*\(\s*old\s*\)/i);
    expect(guard).toMatch(/expected_after\s*=\s*to_jsonb\s*\(\s*new\s*\)/i);
    expect(guard).not.toMatch(/current_setting\s*\(|set_config\s*\(/i);
    expect(sql).toMatch(/before\s+insert\s+or\s+update\s+or\s+delete\s+on\s+public\.transactions/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+app_private\.authorize_wms_write\s*\([^;]+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  });

  it('rejects direct stock cache writes and lets the revoked helper authorize only its exact row image', () => {
    const stockGuard = latestFunction(
      /create\s+or\s+replace\s+function\s+app_private\.guard_item_stock_cache_write\s*\(/gi,
      'guard_item_stock_cache_write',
    );
    const helper = latestFunction(
      /create\s+or\s+replace\s+function\s+app_private\.apply_stock_change_internal\s*\(/gi,
      'apply_stock_change_internal',
    );
    const publicStub = latestFunction(
      /create\s+or\s+replace\s+function\s+public\.apply_stock_change\s*\(/gi,
      'public apply_stock_change fail-closed stub',
    );
    const { sql } = latestMigrationMatching(
      /create\s+or\s+replace\s+function\s+app_private\.guard_item_stock_cache_write/i,
      'stock cache write guard',
    );

    expect(stockGuard).toMatch(/security\s+definer/i);
    expect(stockGuard).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(stockGuard).toMatch(/tg_op\s*=\s*'INSERT'/i);
    expect(stockGuard).toMatch(/tg_op\s*=\s*'DELETE'/i);
    expect(stockGuard).toMatch(/inventory item with stock history is immutable/i);
    expect(stockGuard).toContain('inventory_ledger_entries');
    expect(stockGuard).toContain('inventory_balances');
    expect(stockGuard).toMatch(/coalesce\s*\(\s*new\.stock_by_warehouse\s*,\s*'\{\}'::jsonb\s*\)\s*<>\s*'\{\}'::jsonb/i);
    expect(stockGuard).toMatch(/delete\s+from\s+app_private\.wms_write_authorizations/i);
    expect(stockGuard).toMatch(/expected_before\s*=\s*to_jsonb\s*\(\s*old\s*\)/i);
    expect(stockGuard).toMatch(/expected_after\s*=\s*to_jsonb\s*\(\s*new\s*\)/i);
    expect(stockGuard).not.toMatch(/current_setting\s*\(|set_config\s*\(/i);

    expect(helper).toMatch(/security\s+definer/i);
    expect(helper).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(helper).toMatch(/for\s+update/i);
    expect(helper).toContain('app_private.assert_quantity_precision');
    expect(helper).toContain('app_private.authorize_wms_write');
    expect(helper).toMatch(/to_jsonb\s*\(\s*v_item\s*\)/i);
    expect(publicStub).toMatch(/security\s+invoker/i);
    expect(publicStub).toMatch(/errcode\s*=\s*'42501'/i);
    expect(publicStub).not.toMatch(/update\s+public\.items/i);
    expect(sql).toMatch(/before\s+insert\s+or\s+delete\s+on\s+public\.items/i);
    expect(sql).toMatch(/before\s+update\s+on\s+public\.items/i);
    expect(stockGuard).toMatch(/inventory item identity is immutable/i);
    expect(sql).toMatch(/revoke\s+(?:all|execute)\s+on\s+function\s+public\.apply_stock_change\s*\(\s*text\s*,\s*text\s*,\s*numeric\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  });

  it('locks item rows in stable order, creates empty pending caches, and preserves idempotence', () => {
    const process = latestFunction(
      /create\s+or\s+replace\s+function\s+(?:public\.process_transaction_status|app_private\.process_transaction_status_a3_core)\s*\(/gi,
      'process_transaction_status',
    );

    expect(process).toContain('app_private.assert_quantity_precision');
    expect(process).toMatch(/if\s+v_tx\.status\s*=\s*p_status\s+then[\s\S]+return\s+v_tx/i);
    expect(process).toMatch(/select\s+distinct[\s\S]+line\.value->>'itemId'[\s\S]+order\s+by[\s\S]+item_id/i);
    expect(process).toMatch(/from\s+public\.items[\s\S]+for\s+update/i);
    expect(process).toMatch(/jsonb_array_elements\s*\(\s*coalesce\s*\(\s*v_tx\.pending_items[\s\S]+order\s+by\s+value->>'id'/i);
    expect(process).toMatch(/stock_by_warehouse[\s\S]+values[\s\S]+'\{\}'::jsonb/i);
    expect(process).toContain('app_private.authorize_wms_write');
    expect(process).toContain('app_private.apply_stock_change_internal');
    expect(process).not.toContain('public.apply_stock_change');
    expect(process).toMatch(/authorize_wms_write[\s\S]+update\s+public\.transactions\s+set\s+status/i);
    expect(process).not.toMatch(/\bv_qty\s+integer\s*;/i);
    expect(process).not.toMatch(/\b(?:v_qty|v_check\.qty)[^;]*::integer/i);
  });

  it('allows only canonical forward status commands and binds the approver to the authenticated actor', () => {
    const process = latestFunction(
      /create\s+or\s+replace\s+function\s+(?:public\.process_transaction_status|app_private\.process_transaction_status_a3_core)\s*\(/gi,
      'process_transaction_status',
    );

    expect(process).toMatch(/p_status\s+not\s+in\s*\(\s*'APPROVED'[\s\S]+?'COMPLETED'[\s\S]+?'CANCELLED'/i);
    expect(process).toMatch(/unsupported transaction status command/i);
    expect(process).toMatch(/p_approver_id\s+is\s+distinct\s+from\s+v_user\.id/i);
    expect(process).toMatch(/approver must match the authenticated actor/i);
    expect(process).toMatch(/inactive user cannot execute WMS status commands/i);
    expect(process).toMatch(/v_tx\.status\s*=\s*'APPROVED'[\s\S]+p_status\s+not\s+in\s*\(\s*'COMPLETED'[\s\S]+?'CANCELLED'/i);
    expect(process).not.toMatch(/p_status\s*=\s*'PENDING'/i);
    expect(process).toMatch(/inventory ledger already exists for non-completed transaction/i);
  });

  it('provides one atomic idempotent command for immediate completed WMS documents', () => {
    const post = latestFunction(
      /create\s+or\s+replace\s+function\s+public\.post_wms_transaction\s*\(/gi,
      'post_wms_transaction',
    );
    const { sql } = latestMigrationMatching(
      /create\s+or\s+replace\s+function\s+public\.post_wms_transaction\s*\(/i,
      'post_wms_transaction owner migration',
    );

    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+posting_request_hash\s+text/i);
    expect(post).toMatch(/security\s+definer/i);
    expect(post).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(post).toContain('pg_advisory_xact_lock');
    expect(post).toContain('app_private.transaction_can_insert');
    expect(post).toContain('app_private.wms_transaction_intent');
    expect(post).toContain('posting request payload does not match');
    expect(post).toContain("'wms-source:' || v_source_type || ':' || v_source_id");
    expect(post).toMatch(/where\s+transaction_row\.source_type\s*=\s*v_source_type[\s\S]+transaction_row\.source_id\s*=\s*v_source_id[\s\S]+transaction_row\.id\s*<>\s*v_id/i);
    expect(post).toContain('business source is already posted by transaction');
    expect(post).toContain('public.process_transaction_status');
    expect(post).toMatch(/'PENDING'::public\.transaction_status/i);
    expect(post).toMatch(/'COMPLETED'::public\.transaction_status/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.post_wms_transaction\s*\(\s*jsonb\s*\)\s+to\s+authenticated/i);
  });

  it('stamps immutable ledger metadata with engine, policy, actor, timestamp, and unit snapshots', () => {
    const headerMetadata = latestFunction(
      /create\s+or\s+replace\s+function\s+app_private\.enrich_inventory_transaction_metadata\s*\(/gi,
      'enrich_inventory_transaction_metadata',
    );
    const entryMetadata = latestFunction(
      /create\s+or\s+replace\s+function\s+app_private\.enrich_inventory_ledger_entry_metadata\s*\(/gi,
      'enrich_inventory_ledger_entry_metadata',
    );
    const { sql } = latestMigrationMatching(
      /create\s+or\s+replace\s+function\s+app_private\.enrich_inventory_transaction_metadata\s*\(/i,
      'posting metadata enrichment owner migration',
    );

    for (const definition of [headerMetadata, entryMetadata]) {
      expect(definition).toMatch(/security\s+definer/i);
      expect(definition).toMatch(/set\s+search_path\s*=\s*''/i);
      expect(definition).toContain('posting_engine_version');
      expect(definition).toContain('actor_id');
      expect(definition).toContain('posted_at');
    }
    expect(headerMetadata).toContain('quantity_policy_snapshots');
    expect(headerMetadata).toContain('app_private.resolve_quantity_precision_policy');
    expect(entryMetadata).toContain('quantity_policy_version');
    expect(entryMetadata).toContain('stock_unit_snapshot');
    expect(entryMetadata).toContain('source_quantity_text');
    expect(sql).toMatch(/before\s+insert\s+on\s+public\.inventory_transactions/i);
    expect(sql).toMatch(/before\s+insert\s+on\s+public\.inventory_ledger_entries/i);
    expect(sql).toMatch(/before\s+update\s+or\s+delete\s+on\s+public\.inventory_transactions/i);
    expect(sql).toMatch(/before\s+update\s+or\s+delete\s+on\s+public\.inventory_ledger_entries/i);
    expect(sql).toMatch(/revoke\s+truncate\s+on\s+table\s+public\.transactions\s*,\s*public\.items\s*,\s*public\.inventory_transactions\s*,\s*public\.inventory_ledger_entries[\s\S]+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  });

  it('routes material-issue cancellation through the guarded status command', () => {
    const cancel = latestFunction(
      /create\s+or\s+replace\s+function\s+public\.cancel_material_issue_order\s*\(/gi,
      'cancel_material_issue_order',
    );

    expect(cancel).toContain('public.process_transaction_status');
    expect(cancel).not.toMatch(/update\s+public\.transactions\s+set\s+status/i);
    expect(cancel.indexOf('from public.transactions')).toBeLessThan(
      cancel.indexOf('from public.material_issue_orders where id = p_order_id for update'),
    );
    expect(cancel).toMatch(/transaction changed while cancellation was acquiring canonical locks/i);
  });

  it('ships read-only catalog gates and transactional containment smoke coverage', () => {
    const preflight = artifact('supabase/perf/wms_posting_containment_preflight.sql');
    const postflight = artifact('supabase/perf/wms_posting_containment_postflight.sql');
    const smoke = artifact('supabase/tests/wms_posting_containment_smoke.sql');

    expect(preflight).toMatch(/^begin\s*;/im);
    expect(preflight).toMatch(/set\s+transaction\s+read\s+only/i);
    expect(preflight).toMatch(/rollback\s*;\s*$/i);
    expect(preflight).toMatch(/pg_get_functiondef/i);
    expect(preflight).toMatch(/pg_get_triggerdef/i);
    expect(preflight).toMatch(/pg_policies/i);
    expect(preflight).toMatch(/pg_enum/i);
    expect(preflight).toMatch(/stock_by_warehouse/i);
    expect(preflight).toMatch(/status::text\s*=\s*'COMPLETED'/i);
    expect(preflight).toMatch(/noncompleted_with_ledger_header/i);

    expect(postflight).toMatch(/^begin\s*;/im);
    expect(postflight).toMatch(/set\s+transaction\s+read\s+only/i);
    expect(postflight).toMatch(/rollback\s*;\s*$/i);
    expect(postflight).toMatch(/has_function_privilege/i);
    expect(postflight).toMatch(/wms_write_authorizations/i);
    expect(postflight).toMatch(/post_wms_transaction/i);
    expect(postflight).toMatch(/posting_request_hash/i);

    expect(smoke).toMatch(/^begin\s*;/im);
    expect(smoke).toMatch(/rollback\s*;\s*$/i);
    expect(smoke).toMatch(/direct completed insert/i);
    expect(smoke).toMatch(/direct stock cache/i);
    expect(smoke).toMatch(/idempotent/i);
    expect(smoke).toMatch(/posting_engine_version/i);
    expect(smoke).toMatch(/quantity_policy_version/i);
    expect(smoke).toMatch(/unchanged stock/i);
    expect(smoke).toMatch(/unchanged ledger/i);
    expect(smoke).toMatch(/post_wms_transaction/i);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
const previousMigration = '20260715190000_wms_reconciliation_model_hardening.sql';
const migrationSuffix = '_wms_reconciliation_read_foundation.sql';

const stripSqlComments = (value: string): string => value
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '');

const loadMigration = (): { file: string; sql: string } => {
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith(migrationSuffix));

  expect(files, `expected exactly one *${migrationSuffix} migration`).toHaveLength(1);
  if (files.length !== 1) return { file: '', sql: '' };

  return {
    file: files[0],
    sql: stripSqlComments(fs.readFileSync(path.join(migrationsDir, files[0]), 'utf8')),
  };
};

const functionBody = (sql: string, qualifiedName: string): string => {
  const escapedName = qualifiedName.replace('.', '\\.');
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escapedName}\\s*\\([\\s\\S]*?\\)\\s*returns[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$`,
    'i',
  ));
  expect(match, `${qualifiedName} is missing`).not.toBeNull();
  return match?.[1] ?? '';
};

const publicRpcs = [
  'create_wms_reconciliation_run(jsonb,timestamptz,text)',
  'scan_wms_reconciliation_run(uuid,integer)',
  'verify_wms_reconciliation_run(uuid)',
  'list_wms_reconciliation_runs(jsonb,integer,jsonb)',
  'get_wms_reconciliation_workspace(uuid,jsonb,jsonb,jsonb,integer)',
];

const phases = [
  'physical_anchor',
  'opening_balance',
  'transaction_ledger',
  'ledger_balance',
  'stock_cache',
  'reservation',
  'batch',
  'po_mr_uom',
  'lineage',
];

describe('WMS reconciliation B2a read foundation migration', () => {
  it('is a forward-only CLI migration after B1', () => {
    const { file } = loadMigration();
    expect(file.localeCompare(previousMigration)).toBeGreaterThan(0);
  });

  it('adds immutable frozen source snapshots and a private resumable work table', () => {
    const { sql } = loadMigration();

    expect(sql).toMatch(/alter\s+table\s+public\.wms_reconciliation_runs[\s\S]*add\s+column(?:\s+if\s+not\s+exists)?\s+source_snapshot\s+jsonb/i);
    expect(sql).toMatch(/old\.source_snapshot\s+is\s+distinct\s+from\s+new\.source_snapshot/i);
    expect(sql).toMatch(/create\s+table\s+app_private\.wms_reconciliation_run_work/i);
    expect(sql).toMatch(/primary\s+key\s*\(\s*run_id\s*,\s*phase\s*,\s*source_key\s*,\s*warehouse_id\s*,\s*item_id\s*\)/i);
    expect(sql).toMatch(/run_id\s+uuid[\s\S]*references\s+public\.wms_reconciliation_runs\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i);
    expect(sql).toMatch(/revoke\s+all(?:\s+privileges)?\s+on\s+table\s+app_private\.wms_reconciliation_run_work\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  });

  it('validates the exact scope contract and every warehouse permission in a private helper', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'app_private.require_wms_reconciliation_permission');
    const normalization = functionBody(sql, 'app_private.normalize_wms_reconciliation_scope');
    const contract = `${normalization}\n${body}`;

    expect(sql).toMatch(/function\s+app_private\.require_wms_reconciliation_permission\s*\(\s*p_actor\s+uuid\s*,\s*p_permission_code\s+text\s*,\s*p_scope\s+jsonb\s*\)/i);
    expect(body).toMatch(/public\.users/i);
    expect(body).toMatch(/is_active/i);
    expect(contract).toMatch(/warehouseIds/);
    expect(contract).toMatch(/itemIds/);
    expect(contract).toMatch(/sourceTypes/);
    expect(contract).toMatch(/affectedFrom/);
    expect(contract).toMatch(/jsonb_object_keys/i);
    expect(body).toMatch(/app_private\.has_permission/i);
    expect(body).toMatch(/public\.warehouses/i);
    expect(body).toMatch(/public\.items/i);
    expect(body).toMatch(/errcode\s*=\s*'22023'/i);
    expect(body).toMatch(/errcode\s*=\s*'42501'/i);
  });

  it('fails closed on catalog drift and exposes canonical decimal text privately', () => {
    const { sql } = loadMigration();
    const preflight = functionBody(sql, 'app_private.preflight_wms_reconciliation_catalog');
    const decimal = functionBody(sql, 'app_private.wms_reconciliation_decimal_text');

    for (const relation of [
      'transactions', 'items', 'warehouses', 'requests', 'purchase_orders',
      'audit_sessions', 'inventory_transactions', 'inventory_ledger_entries',
      'inventory_balances', 'project_opening_balances', 'project_opening_balance_lines',
    ]) {
      expect(preflight).toContain(relation);
    }
    expect(preflight).toMatch(/pg_catalog\.pg_attribute/i);
    expect(preflight).toMatch(/pg_catalog\.format_type/i);
    expect(preflight).toMatch(/errcode\s*=\s*'(?:55000|P0002)'/i);
    expect(decimal).toMatch(/trim|regexp_replace|to_char/i);
  });

  it('creates all nine concrete private phase shells with a stable cursor contract', () => {
    const { sql } = loadMigration();
    let previousOffset = -1;

    for (const phase of phases) {
      const name = `app_private.scan_wms_reconciliation_phase_${phase}`;
      const offset = sql.toLowerCase().indexOf(`function ${name}`);
      expect(offset, `${name} must exist`).toBeGreaterThan(previousOffset);
      previousOffset = offset;

      const body = functionBody(sql, name);
      expect(body).toContain(`'phase', '${phase}'`);
      expect(body).toMatch(/'lastKey'\s*,/);
      expect(body).toMatch(/'processed'\s*,\s*0/i);
    }
  });

  it('creates a gated run with normalized scope, deterministic hash, frozen high waters and hashes', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'public.create_wms_reconciliation_run');

    expect(body).toMatch(/public\.current_app_user_id\s*\(\s*\)/i);
    expect(body).toMatch(/scan_enabled/i);
    expect(body).toMatch(/wms\.reconciliation\.generate/i);
    expect(body).toMatch(/app_private\.require_wms_reconciliation_permission/i);
    expect(body).toMatch(/app_private\.preflight_wms_reconciliation_catalog/i);
    expect(body).toMatch(/p_as_of\s*>\s*pg_catalog\.(?:now|clock_timestamp)\s*\(\s*\)/i);
    expect(body).toMatch(/order\s+by/i);
    expect(body).toMatch(/sha256_text|digest|encode/i);
    expect(body).toContain("'phase', 'physical_anchor'");
    expect(body).toContain("'lastKey', null");
    expect(body).toMatch(/inventory_transactions/i);
    expect(body).toMatch(/inventory_ledger_entries/i);
    expect(body).toMatch(/inventory_audit_command_results/i);
    expect(body).toMatch(/project_opening_balances/i);
    expect(body).toMatch(/wms_reconciliation_function_hash/i);
    expect(functionBody(sql, 'app_private.wms_reconciliation_function_hash')).toMatch(/pg_get_functiondef/i);
    expect(body).toMatch(/schema_hash/i);
  });

  it('scans with a locked run, bounded batches and explicit ordered phase dispatch', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'public.scan_wms_reconciliation_run');

    expect(body).toMatch(/p_batch_size\s+(?:not\s+between\s+1\s+and\s+500|<\s*1|>\s*500)/i);
    expect(body).toMatch(/for\s+update/i);
    expect(body).toMatch(/wms\.reconciliation\.generate/i);
    expect(body).toMatch(/app_private\.require_wms_reconciliation_permission/i);
    expect(body).toMatch(/case\s+v_phase/i);
    for (const phase of phases) {
      expect(body).toContain(`app_private.scan_wms_reconciliation_phase_${phase}`);
    }
    expect(body).toMatch(/scan_completed_at/i);
    expect(body).toMatch(/status\s*=\s*'scanned'/i);
  });

  it('validates every private phase result before advancing the run cursor', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'public.scan_wms_reconciliation_run');

    expect(body).toMatch(/jsonb_typeof\s*\(\s*v_result\s*\)\s*<>\s*'object'/i);
    expect(body).toMatch(/jsonb_typeof\s*\(\s*v_result\s*->\s*'cursor'\s*\)\s*<>\s*'object'/i);
    expect(body).toMatch(/v_result\s*->\s*'cursor'\s*->>\s*'phase'[\s\S]*v_phase/i);
    expect(body).toMatch(/v_processed\s*<\s*0/i);
    expect(body).toMatch(/v_processed\s*>\s*p_batch_size/i);
    expect(body).toMatch(/errcode\s*=\s*'55000'/i);
  });

  it('verifies by ordered finding hash and remains read-only to WMS source tables', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'public.verify_wms_reconciliation_run');

    expect(body).toMatch(/wms\.reconciliation\.view/i);
    expect(body).toMatch(/precondition_hash/i);
    expect(body).toMatch(/order\s+by/i);
    expect(body).toMatch(/run_hash/i);
    expect(body).toMatch(/verification_pending/i);
    expect(body).toMatch(/when\s+v_verification_pending\s*>\s*0\s+or\s+v_stale_count\s*>\s*0[\s\S]*'scanned'/i);
    expect(body).toMatch(/verified_at\s*=\s*case[\s\S]*then\s+null/i);

    for (const relation of [
      'transactions', 'inventory_transactions', 'inventory_ledger_entries',
      'inventory_balances', 'items', 'purchase_orders', 'requests',
    ]) {
      expect(body).not.toMatch(new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${relation}\\b`, 'i'));
    }
  });

  it('exposes only permission-scoped run lists and bounded canonical workspaces', () => {
    const { sql } = loadMigration();
    const listBody = functionBody(sql, 'public.list_wms_reconciliation_runs');
    const workspaceBody = functionBody(sql, 'public.get_wms_reconciliation_workspace');

    expect(listBody).toMatch(/p_limit\s+(?:not\s+between\s+1\s+and\s+\d+|<\s*1|>\s*\d+)/i);
    expect(listBody).toMatch(/wms\.reconciliation\.view/i);
    expect(listBody).toMatch(/app_private\.can_view_wms_reconciliation_scope/i);
    expect(listBody).toMatch(/p_before\s*->>\s*'createdAt'/i);
    expect(listBody).toMatch(/p_before\s*->>\s*'id'/i);
    expect(listBody).toMatch(/run\.created_at\s*<\s*v_before_created_at[\s\S]*run\.created_at\s*=\s*v_before_created_at[\s\S]*run\.id\s*<\s*v_before_id/i);
    expect(listBody).toMatch(/'nextBefore'[\s\S]*'createdAt'[\s\S]*'id'/i);
    expect(workspaceBody).toMatch(/wms\.reconciliation\.view/i);
    expect(workspaceBody).toMatch(/app_private\.require_wms_reconciliation_permission/i);
    for (const cursor of ['p_findings_after', 'p_actions_after', 'p_approvals_after']) {
      expect(sql).toMatch(new RegExp(`function\\s+public\\.get_wms_reconciliation_workspace\\s*\\([\\s\\S]*${cursor}\\s+jsonb`, 'i'));
    }
    expect(workspaceBody).toMatch(/p_page_size\s+(?:not\s+between\s+1\s+and\s+500|<\s*1|>\s*500)/i);
    expect(workspaceBody).toMatch(/'nextFindingsAfter'/i);
    expect(workspaceBody).toMatch(/'nextActionsAfter'/i);
    expect(workspaceBody).toMatch(/'nextApprovalsAfter'/i);
    expect(workspaceBody).toMatch(/scan_enabled/i);
    expect(workspaceBody).toMatch(/apply_enabled/i);
    expect(workspaceBody).toMatch(/rollback_enabled/i);
    expect(workspaceBody).toMatch(/app_private\.wms_reconciliation_decimal_text\s*\(\s*finding\.(?:before_qty|expected_qty|delta_qty)/i);
    expect(workspaceBody).toMatch(/app_private\.canonicalize_wms_reconciliation_json_numbers/i);
  });

  it('freezes hashes for every phase and the recheck algorithm', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'public.create_wms_reconciliation_run');

    for (const phase of phases) {
      expect(body).toContain(`app_private.scan_wms_reconciliation_phase_${phase}`);
    }
    expect(body).toContain('app_private.recheck_wms_reconciliation_finding');
  });

  it('captures coherent composite high-water rows under one database snapshot', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'public.create_wms_reconciliation_run');

    expect(body).toMatch(/pg_catalog\.pg_current_snapshot\s*\(\s*\)/i);
    expect(body).toMatch(/order\s+by\s+header\.created_at\s+desc\s*,\s*header\.id\s+desc[\s\S]*limit\s+1/i);
    expect(body).toMatch(/order\s+by\s+entry\.created_at\s+desc\s*,\s*entry\.id\s+desc[\s\S]*limit\s+1/i);
    expect(body).not.toMatch(/max\s*\(\s*(?:header|entry)\.id::text\s*\)/i);
    expect(body).toMatch(/'createdAt'[\s\S]*'id'/i);
  });

  it('preflights all scanner source fields, relation kinds, primary keys and identity indexes', () => {
    const { sql } = loadMigration();
    const preflight = functionBody(sql, 'app_private.preflight_wms_reconciliation_catalog');

    for (const required of [
      'transaction_type', 'movement_direction', 'material_id', 'warehouse_id',
      'transaction_date', 'source_line_id', 'scope_key', 'project_id',
      'construction_site_id', 'lot_no', 'batch_no', 'serial_no',
      'purchase_unit', 'purchase_conversion_factor', 'as_of_date',
      'lock_command_id', 'lock_request_hash', 'posting_engine_version',
      'material_request_id', 'request_line_id', 'purchase_order_line_id',
      'stock_unit', 'purchase_order_supplier_return_lines',
    ]) {
      expect(preflight).toContain(required);
    }
    expect(preflight).toMatch(/pg_catalog\.pg_class/i);
    expect(preflight).toMatch(/relkind/i);
    expect(preflight).toMatch(/pg_catalog\.pg_index/i);
    expect(preflight).toMatch(/indisprimary/i);
    expect(preflight).toMatch(/indisunique/i);
  });

  it('hardens all RPC and private ACLs with empty search paths', () => {
    const { sql } = loadMigration();

    for (const rpc of publicRpcs) {
      const name = rpc.slice(0, rpc.indexOf('('));
      expect(sql).toMatch(new RegExp(`function\\s+public\\.${name}[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*''`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${rpc.replace(/[()]/g, '\\$&')}\\s+from\\s+public\\s*,\\s*anon`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc.replace(/[()]/g, '\\$&')}\\s+to\\s+authenticated`, 'i'));
    }

    expect(sql).toMatch(/revoke\s+all\s+on\s+function[\s\S]*app_private\.require_wms_reconciliation_permission\(uuid,text,jsonb\)[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  });

  it('ships rollback-only persona, gate, scope, ACL and source non-mutation SQL checks', () => {
    const smokePath = path.resolve(process.cwd(), 'supabase/tests/wms_reconciliation_read_foundation_smoke.sql');
    const preflightPath = path.resolve(process.cwd(), 'supabase/perf/wms_reconciliation_read_foundation_preflight.sql');
    expect(fs.existsSync(smokePath)).toBe(true);
    expect(fs.existsSync(preflightPath)).toBe(true);

    const smoke = stripSqlComments(fs.readFileSync(smokePath, 'utf8'));
    expect(smoke).toMatch(/^\s*begin\s*;/i);
    expect(smoke).toMatch(/rollback\s*;\s*$/i);
    expect(smoke).toMatch(/set\s+local\s+role\s+anon/i);
    expect(smoke).toMatch(/set\s+local\s+role\s+authenticated/i);
    expect(smoke).toMatch(/scan_enabled/i);
    expect(smoke).toMatch(/warehouseIds/i);
    expect(smoke).toMatch(/p_batch_size|501/i);
    expect(smoke).toMatch(/source_snapshot/i);
    expect(smoke).toMatch(/inventory_ledger_entries/i);
    expect(smoke).toMatch(/create_wms_reconciliation_run/i);
    expect(smoke).toMatch(/for\s+v_scan_step\s+in\s+1\.\.9/i);
    expect(smoke).toMatch(/scan_wms_reconciliation_run/i);
    expect(smoke).toMatch(/verify_wms_reconciliation_run/i);

    const preflight = stripSqlComments(fs.readFileSync(preflightPath, 'utf8'));
    expect(preflight).toMatch(/pg_catalog\.pg_proc/i);
    expect(preflight).toMatch(/prosecdef/i);
    expect(preflight).toMatch(/proconfig/i);
    expect(preflight).toMatch(/proacl/i);
    expect(preflight).toMatch(/app_private\.preflight_wms_reconciliation_catalog/i);
  });
});

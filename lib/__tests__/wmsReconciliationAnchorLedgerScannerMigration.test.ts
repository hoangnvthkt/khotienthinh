import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
const migrationSuffix = '_wms_reconciliation_anchor_ledger_scanner.sql';
const previousMigration = '20260715200000_wms_reconciliation_read_foundation.sql';

const stripSqlComments = (value: string): string => value
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '');

const loadMigration = (): { file: string; sql: string } => {
  const files = fs.readdirSync(migrationsDir).filter(file => file.endsWith(migrationSuffix));
  expect(files, `expected exactly one *${migrationSuffix} migration`).toHaveLength(1);
  if (files.length !== 1) return { file: '', sql: '' };
  return {
    file: files[0],
    sql: stripSqlComments(fs.readFileSync(path.join(migrationsDir, files[0]), 'utf8')),
  };
};

const functionBody = (sql: string, name: string): string => {
  const escaped = name.replace('.', '\\.');
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escaped}\\s*\\([\\s\\S]*?\\)\\s*returns\\s+jsonb[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$`,
    'i',
  ));
  expect(match, `${name} is missing`).not.toBeNull();
  return match?.[1] ?? '';
};

const phaseNames = ['physical_anchor', 'opening_balance', 'transaction_ledger'];

describe('WMS reconciliation B2b anchor and ledger scanner migration', () => {
  it('is a forward-only CLI migration that replaces only the three owned phase shells', () => {
    const { file, sql } = loadMigration();
    expect(file.localeCompare(previousMigration)).toBeGreaterThan(0);
    for (const phase of phaseNames) {
      expect(sql).toMatch(new RegExp(`create\\s+or\\s+replace\\s+function\\s+app_private\\.scan_wms_reconciliation_phase_${phase}`, 'i'));
    }
    for (const untouched of ['ledger_balance', 'stock_cache', 'reservation', 'batch', 'po_mr_uom', 'lineage']) {
      expect(sql).not.toMatch(new RegExp(`function\\s+app_private\\.scan_wms_reconciliation_phase_${untouched}`, 'i'));
    }
    expect(sql).not.toMatch(/function\s+public\.scan_wms_reconciliation_run/i);
  });

  it('keeps private SECURITY DEFINER ACLs and validates the stable input/cursor contract', () => {
    const { sql } = loadMigration();
    for (const phase of phaseNames) {
      const name = `app_private.scan_wms_reconciliation_phase_${phase}`;
      const body = functionBody(sql, name);
      expect(sql).toMatch(new RegExp(`${name.replace('.', '\\.')}\\s*\\(\\s*p_run_id\\s+uuid\\s*,\\s*p_batch_size\\s+integer\\s*,\\s*p_cursor\\s+jsonb\\s*,\\s*p_source_snapshot\\s+jsonb`, 'i'));
      expect(sql).toMatch(new RegExp(`${name.replace('.', '\\.')}[\\s\\S]*security\\s+definer[\\s\\S]*set\\s+search_path\\s*=\\s*''`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${name.replace('.', '\\.')}\\(uuid,\\s*integer,\\s*jsonb,\\s*jsonb\\)[\\s\\S]*public[\\s\\S]*anon[\\s\\S]*authenticated[\\s\\S]*service_role`, 'i'));
      expect(body).toMatch(/p_batch_size\s+(?:not\s+between\s+1\s+and\s+500|<\s*1|>\s*500)/i);
      expect(body).toContain(`'phase', '${phase}'`);
      expect(body).toMatch(/'lastKey'\s*,/i);
      expect(body).toMatch(/'processed'\s*,/i);
      expect(body).toMatch(/'complete'\s*,/i);
      expect(body).not.toMatch(/\boffset\b/i);
    }
  });

  it('scans only frozen, scoped physical anchors and quarantines invalid provenance/raw values', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'app_private.scan_wms_reconciliation_phase_physical_anchor');
    expect(body).toMatch(/public\.wms_reconciliation_runs/i);
    expect(body).toMatch(/public\.audit_sessions/i);
    expect(body).toMatch(/app_private\.inventory_audit_command_results/i);
    expect(body).toMatch(/auditCommandCutoff/i);
    expect(body).toMatch(/warehouseIds/i);
    expect(body).toMatch(/itemIds/i);
    expect(body).toMatch(/sourceTypes/i);
    expect(body).toMatch(/affectedFrom|affected_from/i);
    expect(body).toMatch(/with\s+ordinality/i);
    expect(body).toMatch(/wf001-audit-v1/i);
    expect(body).toMatch(/request_hash/i);
    expect(body).toMatch(/command_result[\s\S]*result/i);
    expect(body).toMatch(/audit-adjustment-/i);
    expect(body).toMatch(/inventory_audit/i);
    expect(body).toMatch(/PHYSICAL_ANCHOR/i);
    expect(body).toMatch(/LINEAGE_GAP/i);
    expect(body).toMatch(/UOM_PRECISION/i);
    expect(body).toMatch(/actualStock/i);
    expect(body).toMatch(/systemStock/i);
    expect(body).toMatch(/raw_values/i);
    expect(body).toMatch(/quarantined/i);
  });

  it('uses controlled locked/valid-void opening anchors and preserves exclusion lineage', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'app_private.scan_wms_reconciliation_phase_opening_balance');
    expect(body).toMatch(/public\.project_opening_balances/i);
    expect(body).toMatch(/public\.project_opening_balance_lines/i);
    expect(body).toMatch(/app_private\.project_opening_command_results/i);
    expect(body).toMatch(/app_private\.project_opening_reversal_results/i);
    expect(body).toMatch(/openingCutoff/i);
    expect(body).toMatch(/lock_command_id/i);
    expect(body).toMatch(/lock_request_hash/i);
    expect(body).toMatch(/wf001-opening-v1/i);
    expect(body).toMatch(/status\s+in\s*\(\s*'locked'\s*,\s*'void'\s*\)/i);
    expect(body).toMatch(/reversed_at/i);
    expect(body).toMatch(/remaining_qty/i);
    expect(body).toMatch(/stock_transaction_ids/i);
    expect(body).toMatch(/reversal_stock_transaction_ids/i);
    expect(body).toMatch(/LINEAGE_GAP/i);
    expect(body).toMatch(/UOM_PRECISION/i);
    expect(body).toMatch(/quarantined/i);
  });

  it('derives decimal WMS movements by direction and compares immutable ledger aggregates', () => {
    const { sql } = loadMigration();
    const body = functionBody(sql, 'app_private.scan_wms_reconciliation_phase_transaction_ledger');
    expect(body).toMatch(/public\.transactions/i);
    expect(body).toMatch(/public\.inventory_transactions/i);
    expect(body).toMatch(/public\.inventory_ledger_entries/i);
    expect(body).toMatch(/status::text\s*=\s*'COMPLETED'/i);
    for (const type of ['IMPORT', 'EXPORT', 'TRANSFER', 'LIQUIDATION', 'ADJUSTMENT']) {
      expect(body).toContain(`'${type}'`);
    }
    expect(body).toMatch(/with\s+ordinality/i);
    expect(body).toMatch(/::numeric/i);
    expect(body).not.toMatch(/math\.trunc|\btrunc\s*\(/i);
    expect(body).toMatch(/source_type\s*=\s*'wms_transaction'/i);
    expect(body).toMatch(/source_id/i);
    expect(body).toMatch(/movement_direction/i);
    expect(body).toMatch(/quantity_in/i);
    expect(body).toMatch(/quantity_out/i);
    expect(body).toMatch(/TX_LEDGER_MISSING/i);
    expect(body).toMatch(/TX_LEDGER_MISMATCH/i);
    expect(body).toMatch(/DECIMAL_APPLY/i);
    expect(body).toMatch(/::integer\)::numeric|::integer\s*::numeric/i);
    expect(body).toMatch(/LINEAGE_GAP/i);
    expect(body).toMatch(/UOM_PRECISION/i);
  });

  it('uses header keysets, bounded LIMITs and advances only after complete per-header finding work', () => {
    const { sql } = loadMigration();
    for (const phase of phaseNames) {
      const body = functionBody(sql, `app_private.scan_wms_reconciliation_phase_${phase}`);
      expect(body).toMatch(/order\s+by/i);
      expect(body).toMatch(/limit\s+p_batch_size/i);
      expect(body).toMatch(/lastKey/i);
      expect(body).toMatch(/v_last_/i);
      expect(body).toMatch(/v_processed\s*:=\s*v_processed\s*\+\s*1/i);
      expect(body.indexOf('v_processed := v_processed + 1')).toBeGreaterThan(body.toLowerCase().lastIndexOf('insert into public.wms_reconciliation_findings'));
    }
  });

  it('hashes exact provenance/high-water evidence and makes finding retries idempotent', () => {
    const { sql } = loadMigration();
    for (const phase of phaseNames) {
      const body = functionBody(sql, `app_private.scan_wms_reconciliation_phase_${phase}`);
      expect(body).toMatch(/app_private\.sha256_text/i);
      expect(body).toMatch(/p_source_snapshot/i);
      expect(body).toMatch(/policyVersion/i);
      expect(body).toMatch(/precondition_hash/i);
      expect(body).toMatch(/not\s+exists|on\s+conflict/i);
      expect(body).toMatch(/insert\s+into\s+public\.wms_reconciliation_findings/i);
    }
  });

  it('ships rollback smoke and read-only preflight/EXPLAIN artifacts', () => {
    const smokePath = path.resolve(process.cwd(), 'supabase/tests/wms_reconciliation_anchor_ledger_scanner_smoke.sql');
    const preflightPath = path.resolve(process.cwd(), 'supabase/perf/wms_reconciliation_anchor_ledger_scanner_preflight.sql');
    expect(fs.existsSync(smokePath)).toBe(true);
    expect(fs.existsSync(preflightPath)).toBe(true);
    const smoke = stripSqlComments(fs.readFileSync(smokePath, 'utf8'));
    const preflight = stripSqlComments(fs.readFileSync(preflightPath, 'utf8'));
    expect(smoke).toMatch(/^\s*begin\s*;/i);
    expect(smoke).toMatch(/rollback\s*;\s*$/i);
    for (const decimal of ['0.25', '1.75', '2.375']) expect(smoke).toContain(decimal);
    expect(smoke).toMatch(/audit-adjustment-/i);
    expect(smoke).toMatch(/opening-balance:/i);
    expect(smoke).toMatch(/TX_LEDGER_MISSING/i);
    expect(smoke).toMatch(/TX_LEDGER_MISMATCH/i);
    expect(smoke).toMatch(/LINEAGE_GAP/i);
    expect(smoke).toMatch(/idempot|resume/i);
    expect(smoke).toMatch(/reconciliation_source_counts_before/i);
    expect(preflight).toMatch(/pg_get_functiondef/i);
    expect(preflight).toMatch(/explain/i);
    expect(preflight).not.toMatch(/create\s+(?:unique\s+)?index/i);
  });
});

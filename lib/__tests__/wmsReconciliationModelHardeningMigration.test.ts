import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERP_PERMISSION_APPLICATIONS } from '../permissions/erpPermissionRegistry';

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
const baseMigration = '20260715180000_wms_reconciliation_model.sql';
const migrationSuffix = '_wms_reconciliation_model_hardening.sql';

const stripSqlComments = (value: string): string => value
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '');

const loadHardeningMigration = (): { file: string; sql: string } => {
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith(migrationSuffix));

  expect(files, `expected exactly one *${migrationSuffix} migration`).toHaveLength(1);
  if (files.length !== 1) return { file: '', sql: '' };

  return {
    file: files[0],
    sql: stripSqlComments(fs.readFileSync(path.join(migrationsDir, files[0]), 'utf8')),
  };
};

describe('WMS reconciliation model hardening migration', () => {
  it('is forward-only and alters every reconciliation table after the foundation migration', () => {
    const { file, sql } = loadHardeningMigration();

    expect(file.localeCompare(baseMigration)).toBeGreaterThan(0);
    expect(sql).not.toMatch(/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.wms_reconciliation_(?:runs|findings|approvals|actions)/i);
    for (const table of ['runs', 'findings', 'approvals', 'actions']) {
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.wms_reconciliation_${table}`, 'i'));
    }
  });

  it('adds run hashes, affected range, lifecycle timestamps, errors, and immutable source fingerprints', () => {
    const { sql } = loadHardeningMigration();

    for (const column of [
      'scope_hash',
      'affected_from',
      'scan_started_at',
      'scan_completed_at',
      'apply_started_at',
      'apply_completed_at',
      'verified_at',
      'error_text',
    ]) {
      expect(sql).toMatch(new RegExp(`add\\s+column(?:\\s+if\\s+not\\s+exists)?\\s+${column}\\b`, 'i'));
    }

    expect(sql).toMatch(/old\.schema_hash\s+is\s+distinct\s+from\s+new\.schema_hash/i);
    expect(sql).toMatch(/old\.function_hash\s+is\s+distinct\s+from\s+new\.function_hash/i);
    expect(sql).toMatch(/create\s+trigger\s+[^\s]+[\s\S]*before\s+update\s+on\s+public\.wms_reconciliation_runs/i);
  });

  it('constrains finding taxonomy and adds resolution and raw evidence fields', () => {
    const { sql } = loadHardeningMigration();

    for (const column of ['resolution_owner', 'quarantine_reason', 'raw_values']) {
      expect(sql).toMatch(new RegExp(`add\\s+column(?:\\s+if\\s+not\\s+exists)?\\s+${column}\\b`, 'i'));
    }
    expect(sql).toMatch(/raw_values\s+jsonb\s+not\s+null\s+default\s+'\{\}'::jsonb/i);

    for (const findingType of [
      'DECIMAL_APPLY',
      'TX_LEDGER_MISSING',
      'TX_LEDGER_MISMATCH',
      'LEDGER_BALANCE_CACHE',
      'STOCK_CACHE_EXPECTED',
      'RESERVATION_CURRENT',
      'BATCH_TX',
      'PO_RECEIPT_UOM',
      'MR_RECEIPT',
      'PHYSICAL_ANCHOR',
      'UOM_PRECISION',
      'LINEAGE_GAP',
    ]) {
      expect(sql).toContain(`'${findingType}'`);
    }
    expect(sql).toMatch(/check\s*\(\s*severity\s+in\s*\(\s*'P0'\s*,\s*'P1'\s*,\s*'P2'\s*,\s*'P3'\s*\)\s*\)/i);
    expect(sql).toMatch(/check\s*\(\s*confidence\s+in\s*\(\s*'low'\s*,\s*'medium'\s*,\s*'high'\s*\)\s*\)/i);
  });

  it('keeps approvals append-only and narrows approval kind to wms or business', () => {
    const { sql } = loadHardeningMigration();

    expect(sql).toMatch(/check\s*\(\s*kind\s+in\s*\(\s*'wms'\s*,\s*'business'\s*\)\s*\)/i);
    expect(sql).not.toMatch(/check\s*\(\s*kind\s+in\s*\(\s*'cache'\s*,\s*'business'\s*\)\s*\)/i);
    expect(sql).toMatch(/create\s+trigger\s+[^\s]+[\s\S]*before\s+update\s+or\s+delete\s+on\s+public\.wms_reconciliation_approvals/i);
    expect(sql).toMatch(/raise\s+exception\s+'[^']*append-only/i);
  });

  it('fails closed before converting action idempotency keys to uuid and scopes uniqueness per finding', () => {
    const { sql } = loadHardeningMigration();

    expect(sql).toMatch(/idempotency_key\s*!~\s*'\^\[0-9a-fA-F\]/i);
    expect(sql).toMatch(/raise\s+exception[\s\S]*errcode\s*=\s*'22023'/i);
    expect(sql).toMatch(/alter\s+column\s+idempotency_key\s+type\s+uuid\s+using\s+idempotency_key::uuid/i);
    expect(sql).toMatch(/unique\s*\(\s*finding_id\s*,\s*idempotency_key\s*\)/i);
  });

  it('adds targeted partial indexes for active work and approval lookup', () => {
    const { sql } = loadHardeningMigration();

    expect(sql).toMatch(/create\s+index[^;]+on\s+public\.wms_reconciliation_runs[^;]+where\s+status\s+in\s*\(/i);
    expect(sql).toMatch(/create\s+index[^;]+on\s+public\.wms_reconciliation_findings[^;]+where\s+status\s+in\s*\(\s*'open'\s*,\s*'stale'\s*\)/i);
    expect(sql).toMatch(/create\s+index[^;]+on\s+public\.wms_reconciliation_approvals[^;]+where\s+decision\s*=\s*'approved'/i);
  });

  it('stores private feature gates with exact defaults and denies direct API table access', () => {
    const { sql } = loadHardeningMigration();

    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists\s+app_private\.wms_reconciliation_settings/i);
    expect(sql).toMatch(/\('scan_enabled'\s*,\s*true\)/i);
    expect(sql).toMatch(/\('apply_enabled'\s*,\s*false\)/i);
    expect(sql).toMatch(/\('rollback_enabled'\s*,\s*false\)/i);
    expect(sql).toMatch(/revoke\s+all\s+privileges\s+on\s+table\s+app_private\.wms_reconciliation_settings\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);

    for (const table of ['runs', 'findings', 'approvals', 'actions']) {
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.wms_reconciliation_${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
    }
    expect(sql).toMatch(/revoke\s+all\s+privileges\s+on\s+table\s+public\.wms_reconciliation_runs\s*,\s*public\.wms_reconciliation_findings\s*,\s*public\.wms_reconciliation_approvals\s*,\s*public\.wms_reconciliation_actions\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  });

  it('keeps frontend permission registry in parity with database permission seeds', () => {
    const wms = ERP_PERMISSION_APPLICATIONS.find(application => application.code === 'wms');
    const reconciliation = wms?.modules.find(module => module.code === 'wms.reconciliation');

    expect(reconciliation).toBeDefined();
    expect(reconciliation).toMatchObject({
      label: 'Đối soát tồn kho',
      legacyModuleKey: 'WMS',
      routes: ['/wms/reconciliation'],
      sortOrder: 35,
    });
    expect(reconciliation?.actions.map(action => ({
      action: action.action,
      permissionCode: action.permissionCode,
      legacyRoute: action.legacyRoute,
      scopeTypes: action.scopeTypes,
      sortOrder: action.sortOrder,
    }))).toEqual([
      { action: 'view', permissionCode: 'wms.reconciliation.view', legacyRoute: '/wms/reconciliation', scopeTypes: ['global', 'warehouse'], sortOrder: 10 },
      { action: 'generate', permissionCode: 'wms.reconciliation.generate', legacyRoute: '/wms/reconciliation', scopeTypes: ['global', 'warehouse'], sortOrder: 20 },
      { action: 'approve_cache', permissionCode: 'wms.reconciliation.approve_cache', legacyRoute: '/wms/reconciliation', scopeTypes: ['global', 'warehouse'], sortOrder: 30 },
      { action: 'approve_business', permissionCode: 'wms.reconciliation.approve_business', legacyRoute: '/wms/reconciliation', scopeTypes: ['global', 'warehouse'], sortOrder: 40 },
      { action: 'apply', permissionCode: 'wms.reconciliation.apply', legacyRoute: '/wms/reconciliation', scopeTypes: ['global', 'warehouse'], sortOrder: 50 },
      { action: 'rollback', permissionCode: 'wms.reconciliation.rollback', legacyRoute: '/wms/reconciliation', scopeTypes: ['global', 'warehouse'], sortOrder: 60 },
    ]);
  });
});

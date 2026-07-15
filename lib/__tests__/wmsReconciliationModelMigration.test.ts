import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20260715180000_wms_reconciliation_model.sql'), 'utf8');

describe('WMS reconciliation model', () => {
  it('defines immutable run/finding/approval/action tables with numeric(20,6) quantities', () => {
    for (const table of ['wms_reconciliation_runs', 'wms_reconciliation_findings', 'wms_reconciliation_approvals', 'wms_reconciliation_actions']) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${table}`));
    }
    expect(sql).toMatch(/numeric\(20,\s*6\)/g);
    expect(sql).toMatch(/raw_quantity_text|raw_value_text/);
    expect(sql).toMatch(/precondition_hash/);
    expect(sql).toMatch(/idempotency_key/);
  });

  it('seeds reconciliation permission actions and locks table DML behind RPCs', () => {
    expect(sql).toMatch(/wms\.reconciliation/);
    for (const action of ['view', 'generate', 'approve_cache', 'approve_business', 'apply', 'rollback']) {
      expect(sql).toMatch(new RegExp(`wms\\.reconciliation\\.${action}`));
    }
    expect(sql).toMatch(/revoke all privileges on table public\.wms_reconciliation_/);
    expect(sql).toMatch(/enable row level security/);
  });
});

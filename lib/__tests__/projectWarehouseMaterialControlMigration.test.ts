import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = readdirSync(migrationsDir)
  .find(file => file.endsWith('_project_warehouse_material_control_v1.sql'));
const migrationPath = migrationFile ? join(migrationsDir, migrationFile) : '';
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const normalized = migration.replace(/\s+/g, ' ').trim().toLowerCase();

describe('project warehouse material control V1 migration', () => {
  it('adds project ownership and business-event snapshots across WMS and ledger', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(normalized).toContain('alter table public.warehouses');
    expect(normalized).toContain('add column if not exists project_id text');
    expect(normalized).toContain('add column if not exists business_event_type text');
    expect(normalized).toContain('public.inventory_transactions');
    expect(normalized).toContain('public.inventory_ledger_entries');
    expect(normalized).toContain('resolve_warehouse_project_scope');
    expect(normalized).toContain('sync_wms_transaction_to_inventory_ledger');
  });

  it('guards site warehouse scope and derives posting scope from movement warehouses', () => {
    expect(normalized).toContain('validate_warehouse_project_scope');
    expect(normalized).toContain('guard_used_warehouse_project_reassignment');
    expect(normalized).toMatch(/warehouse\.project_id\s+as\s+project_id/);
    expect(normalized).toMatch(/warehouse\.construction_site_id(?:::\w+)?\s+as\s+construction_site_id/);
    expect(normalized).toContain('scope chứng từ không khớp scope kho');
  });

  it('creates auditable idempotent settlements and reversal commands', () => {
    expect(normalized).toContain('create table if not exists public.material_issue_settlements');
    expect(normalized).toContain('create table if not exists public.material_issue_settlement_lines');
    expect(normalized).toContain('idempotency_key text not null unique');
    expect(normalized).toContain('post_material_issue_settlement_v1');
    expect(normalized).toContain('reverse_material_issue_settlement_v1');
    expect(normalized).toContain('alter table public.material_issue_settlements enable row level security');
    expect(normalized).toContain('grant select on table public.material_issue_settlements to authenticated');
  });

  it('exposes the BOQ reconciliation report from event sources', () => {
    expect(normalized).toContain('get_project_material_boq_reconciliation');
    expect(normalized).toContain('planned_qty_to_date');
    expect(normalized).toContain('confirmed_used_qty');
    expect(normalized).toContain('open_with_recipient_qty');
    expect(normalized).toContain('data_quality_flags');
    expect(normalized).toContain('asia/ho_chi_minh');
  });

  it('backfills the approved mappings without treating the removed project or legacy issue as use', () => {
    expect(normalized).toContain("'smb-2026'");
    expect(normalized).toContain("'da29'");
    expect(normalized).toContain("project.code <> 'prj-240ac280'");
    expect(normalized).not.toMatch(/project_id\s*=\s*'prj-240ac280'/);
    expect(normalized).toContain("'legacy_direct_issue'");
    expect(normalized).not.toMatch(/legacy_direct_issue[^;]{0,300}ledger_type\s*=\s*'consume'/);
    expect(normalized).toContain('v_balance_mismatch_count');
  });
});

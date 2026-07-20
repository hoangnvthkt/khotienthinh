import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDir = path.resolve(process.cwd(), 'supabase/migrations');
const candidates = fs
  .readdirSync(migrationDir)
  .filter(name => name === '20260720100000_asset_action_operation_guards.sql');

const readMigration = () => {
  expect(candidates).toHaveLength(1);
  return fs.readFileSync(path.join(migrationDir, candidates[0]), 'utf8');
};

const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('Asset action backend migration contract', () => {
  it('removes broad authenticated actor write gates from Asset tables', () => {
    const sql = readMigration();

    for (const policy of [
      'assets_active_actor_gate',
      'asset_categories_active_actor_gate',
      'asset_assignments_active_actor_gate',
      'asset_maintenances_active_actor_gate',
      'asset_location_stocks_active_actor_gate',
      'asset_transfers_active_actor_gate',
    ]) {
      expect(sql).toMatch(new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${policy}`, 'i'));
    }

    expect(sql).not.toMatch(/create\s+policy\s+\w+_active_actor_gate[\s\S]*for\s+all/i);
  });

  it('requires Asset view permission for every readable Asset surface table', () => {
    const sql = normalized(readMigration());

    for (const table of [
      'assets',
      'asset_categories',
      'asset_assignments',
      'asset_maintenances',
      'asset_location_stocks',
      'asset_transfers',
    ]) {
      expect(sql).toMatch(new RegExp(`create policy ${table}_select_action[\\s\\S]*on public\\.${table} for select`, 'i'));
    }

    expect(sql).toContain("'asset.catalog.view'");
    expect(sql).toContain("'asset.assignment.view'");
    expect(sql).toContain("'asset.maintenance.view'");
  });

  it('uses operation-specific RPCs and guards instead of edit-or-dispose RLS shortcuts', () => {
    const sql = normalized(readMigration());

    expect(sql).toMatch(/create or replace function public\.dispose_asset\s*\(/i);
    expect(sql).toMatch(/app_private\.asset_has_action\('asset\.catalog\.dispose'/i);
    expect(sql).not.toMatch(/asset\.catalog\.edit'\s+or\s+app_private\.asset_has_action\('asset\.catalog\.dispose'/i);

    expect(sql).toMatch(/create or replace function public\.record_asset_assignment\s*\(/i);
    expect(sql).toContain("'asset.assignment.assign'");
    expect(sql).toContain("'asset.assignment.return'");
    expect(sql).toContain("'asset.assignment.transfer'");

    expect(sql).toMatch(/create or replace function public\.complete_asset_maintenance\s*\(/i);
    expect(sql).toMatch(/app_private\.asset_has_action\('asset\.maintenance\.complete'/i);
  });

  it('checks both source and destination scope for stock transfers', () => {
    const sql = normalized(readMigration());

    expect(sql).toMatch(/app_private\.asset_has_action\('asset\.catalog\.transfer_stock'[\s\S]*v_from\.warehouse_id[\s\S]*v_from\.dept_id/i);
    expect(sql).toMatch(/app_private\.asset_has_action\('asset\.catalog\.transfer_stock'[\s\S]*nullif\(p_to_warehouse_id,\s*''\)[\s\S]*nullif\(p_to_dept_id,\s*''\)/i);
  });

  it('promotes only backend-enforced Asset actions to enforced readiness', () => {
    const sql = readMigration();

    for (const code of [
      'asset.catalog.view',
      'asset.catalog.create',
      'asset.catalog.edit',
      'asset.catalog.delete',
      'asset.catalog.dispose',
      'asset.catalog.import',
      'asset.catalog.transfer_stock',
      'asset.assignment.view',
      'asset.assignment.assign',
      'asset.assignment.return',
      'asset.assignment.transfer',
      'asset.maintenance.view',
      'asset.maintenance.create',
      'asset.maintenance.complete',
      'asset.maintenance.import',
      'asset.audit.view',
    ]) {
      expect(sql).toContain(`'${code}'`);
    }

    expect(sql).toMatch(/'asset\.audit\.perform'[\s\S]*?'declared'/i);
    expect(sql).toMatch(/'asset\.audit\.export'[\s\S]*?'declared'/i);
    expect(sql).not.toMatch(/'asset\.audit\.perform'[\s\S]{0,240}'enforced'/i);
    expect(sql).not.toMatch(/'asset\.audit\.export'[\s\S]{0,240}'enforced'/i);
    expect(sql).toMatch(/set\s+grant_readiness\s*=\s*'enforced'/i);
  });
});
